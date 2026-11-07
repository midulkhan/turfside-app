import { Redis } from '@upstash/redis';
import { LRUCache } from 'lru-cache';

import { config } from './config';

/**
 * Two-level cache.
 *
 *  L1  in-process memory (free, microseconds) — absorbs bursts so most reads never leave Node.
 *  L2  Upstash Redis over HTTPS (shared by every Node process, survives restarts) — absorbs
 *      what L1 misses so it doesn't reach Postgres. Without Upstash configured, L2 is a second
 *      in-process store, so the API behaves the same (just per-process).
 *
 * Upstash's free plan bills every command (500K/month), so this layer is frugal on purpose:
 *  - a read is one command; a booking change is one script (EVAL), never a fan-out;
 *  - a per-process daily budget stops *reads* going to Redis once spent (writes that keep
 *    the shared copy correct always go through);
 *  - a failed write takes Redis out of the read path for longer than any entry lives, so a
 *    copy that missed an update is never served;
 *  - every call is time-limited and best-effort: the cache can slow nothing down or fail
 *    nothing. A request that can't use it goes to the database, exactly as without a cache.
 */

const PREFIX = config.CACHE_PREFIX;
/** Longest TTL of anything stored in Redis (the catalog). Used for the poison window. */
export const MAX_TTL_S = 3600;
const TIMEOUT_MS = 1200;

const redis =
  config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: config.UPSTASH_REDIS_REST_URL,
        token: config.UPSTASH_REDIS_REST_TOKEN,
        automaticDeserialization: false,
        retry: { retries: 1, backoff: () => 80 },
        signal: () => AbortSignal.timeout(TIMEOUT_MS),
      })
    : null;
export const cacheBackend = redis ? 'upstash-redis' : 'memory';

// ── health of the Redis path ────────────────────────────────────────────────
const state = {
  readsOffUntil: 0, // reads skip Redis until then (errors / poisoned / budget)
  reason: '' as '' | 'errors' | 'missed-write' | 'budget',
  day: '',
  used: 0, // commands sent by this process today (UTC)
  hits: 0,
  misses: 0,
  l1: 0,
  lastLatencyMs: 0,
};
const today = () => new Date().toISOString().slice(0, 10);
function count() {
  const d = today();
  if (d !== state.day) {
    state.day = d;
    state.used = 0;
    if (state.reason === 'budget') state.readsOffUntil = 0;
  }
  state.used++;
  if (state.used >= config.REDIS_DAILY_BUDGET && state.reason !== 'missed-write') {
    // Out of today's share: serve from memory + DB until midnight UTC.
    state.reason = 'budget';
    state.readsOffUntil = Date.parse(`${d}T23:59:59.999Z`);
  }
}
const readsOn = () => !!redis && Date.now() >= state.readsOffUntil;
/** Whether a read can reach the shared store right now (always true for the in-process stand-in). */
export const sharedReadable = () => !redis || readsOn();

/** One Redis command, timed and counted. `write` failures poison the read path (see top). */
async function send<T>(kind: 'read' | 'write', fn: (r: Redis) => Promise<T>): Promise<T | undefined> {
  if (!redis) return undefined;
  count();
  const t0 = Date.now();
  try {
    const out = await fn(redis);
    state.lastLatencyMs = Date.now() - t0;
    return out;
  } catch {
    if (kind === 'write') {
      // The shared copy may now be missing an update: don't read it until it has expired.
      state.reason = 'missed-write';
      state.readsOffUntil = Date.now() + MAX_TTL_S * 1000;
    } else if (state.reason !== 'missed-write') {
      state.reason = 'errors';
      state.readsOffUntil = Date.now() + 30_000;
    }
    return undefined;
  }
}

// ── in-process stores ───────────────────────────────────────────────────────
type L1Entry = { v: unknown };
const l1 = new LRUCache<string, L1Entry>({ max: 4000 });
/** Stand-in for Redis when it isn't configured (strings and hashes, with TTL). */
const mem = new LRUCache<string, string | Map<string, string>>({ max: 20_000 });

/** Concurrent misses for the same key share one computation (no thundering herd). */
const inflight = new Map<string, Promise<unknown>>();
export function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function l1Get<T>(key: string): T | undefined {
  const e = l1.get(key);
  if (e) state.l1++;
  return e?.v as T | undefined;
}
export function l1Set(key: string, v: unknown, ttlMs: number) {
  if (ttlMs > 0) l1.set(key, { v }, { ttl: ttlMs });
}
export function l1Del(...keys: string[]) {
  keys.forEach((k) => l1.delete(k));
}

// ── strings ─────────────────────────────────────────────────────────────────
export async function cacheGet<T>(key: string): Promise<T | null> {
  let raw: string | null | undefined;
  if (redis) raw = readsOn() ? await send('read', (r) => r.get<string>(PREFIX + key)) : undefined;
  else raw = mem.get(key) as string | undefined;
  if (raw == null) {
    state.misses++;
    return null;
  }
  try {
    state.hits++;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const raw = JSON.stringify(value);
  if (redis) await send('write', (r) => r.set(PREFIX + key, raw, { ex: ttlSeconds }));
  else mem.set(key, raw, { ttl: ttlSeconds * 1000 });
}

export async function cacheDel(...keys: string[]) {
  l1Del(...keys);
  if (redis) await send('write', (r) => r.del(...keys.map((k) => PREFIX + k)));
  else keys.forEach((k) => mem.delete(k));
}

export async function cacheIncr(key: string): Promise<number | null> {
  if (redis) return (await send('write', (r) => r.incr(PREFIX + key))) ?? null;
  const n = Number(mem.get(key) ?? 0) + 1;
  mem.set(key, String(n));
  return n;
}

/**
 * Read-through: L1 → Redis → compute (once per process at a time) → store in both.
 * Only for data whose writers call cacheDel; TTLs bound anything changed outside the API.
 */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>, l1Seconds = 0): Promise<T> {
  const local = l1Get<T>(key);
  if (local !== undefined) return local;
  return singleflight(`c:${key}`, async () => {
    const hit = await cacheGet<T>(key);
    if (hit !== null) {
      l1Set(key, hit, l1Seconds * 1000);
      return hit;
    }
    const value = await compute();
    await cacheSet(key, value, ttlSeconds);
    l1Set(key, value, l1Seconds * 1000);
    return value;
  });
}

// ── hashes with "newest write wins" (used for slot availability) ────────────
/**
 * Each field is "<stamp>|<json>". A write only replaces a field whose stamp is older, so a
 * slow reader can never overwrite fresher data written by a booking a moment later.
 * With `prune`, fields older than `prune` that aren't in this write are removed (a full
 * recompute knows those pitches have nothing booked). One EVAL = one billed command.
 */
const HASH_WRITE = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local prune = tonumber(ARGV[2])
local seen = {}
for i = 3, #ARGV, 2 do
  local f, v = ARGV[i], ARGV[i + 1]
  seen[f] = true
  local ns = tonumber(string.match(v, '^(%d+)|'))
  local cur = redis.call('HGET', key, f)
  local cs = cur and tonumber(string.match(cur, '^(%d+)|'))
  if not cs or cs <= ns then redis.call('HSET', key, f, v) end
end
if prune > 0 then
  local all = redis.call('HGETALL', key)
  for i = 1, #all, 2 do
    local f = all[i]
    if not seen[f] then
      local cs = tonumber(string.match(all[i + 1], '^(%d+)|'))
      if cs and cs < prune then redis.call('HDEL', key, f) end
    end
  end
end
redis.call('EXPIRE', key, ttl)
return 1`;

const stampOf = (v: string) => Number(v.slice(0, v.indexOf('|')));

export async function hashWrite(key: string, fields: Record<string, string>, ttlSeconds: number, prune = 0): Promise<boolean> {
  if (redis) {
    const args = [String(ttlSeconds), String(prune), ...Object.entries(fields).flat()];
    return (await send('write', (r) => r.eval(HASH_WRITE, [PREFIX + key], args))) !== undefined;
  }
  let h = mem.get(key) as Map<string, string> | undefined;
  if (!(h instanceof Map)) h = new Map();
  for (const [f, v] of Object.entries(fields)) {
    const cur = h.get(f);
    if (!cur || stampOf(cur) <= stampOf(v)) h.set(f, v);
  }
  if (prune > 0) for (const [f, v] of h) if (!(f in fields) && stampOf(v) < prune) h.delete(f);
  mem.set(key, h, { ttl: ttlSeconds * 1000 });
  return true;
}

/** Drop one field (fallback when a writer couldn't recompute it). */
export async function hashDel(key: string, field: string) {
  if (redis) await send('write', (r) => r.hdel(PREFIX + key, field));
  else (mem.get(key) as Map<string, string> | undefined)?.delete?.(field);
}

/** Several fields of one hash in one command (missing fields are null). */
export async function hashGetMany(key: string, fields: string[]): Promise<(string | null)[] | null> {
  if (redis) {
    if (!readsOn()) return null;
    // Raw replies (automaticDeserialization off) arrive as an array in field order.
    const out = (await send('read', (r) => r.hmget(PREFIX + key, ...fields))) as unknown;
    if (out === undefined) return null;
    if (Array.isArray(out)) return fields.map((_, i) => (out[i] as string | null) ?? null);
    const obj = out as Record<string, string | null> | null;
    return fields.map((f) => obj?.[f] ?? null);
  }
  const h = mem.get(key);
  return fields.map((f) => (h instanceof Map ? (h.get(f) ?? null) : null));
}

export async function hashGetAll(key: string): Promise<Record<string, string> | null> {
  if (redis) {
    if (!readsOn()) return null;
    const out = (await send('read', (r) => r.hgetall(PREFIX + key))) as unknown;
    if (out == null) return null;
    if (!Array.isArray(out)) return out as Record<string, string>;
    if (!out.length) return null; // no such key
    const obj: Record<string, string> = {};
    for (let i = 0; i < out.length; i += 2) obj[String(out[i])] = String(out[i + 1]);
    return obj;
  }
  const h = mem.get(key);
  return h instanceof Map ? Object.fromEntries(h) : null;
}

// ── rate-limit counters ─────────────────────────────────────────────────────
const HIT = `local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n`;

/** Fixed-window counter shared across processes (one command per hit). */
export async function hit(key: string, windowSeconds: number): Promise<number> {
  if (redis) {
    const n = await send('write', (r) => r.eval<string[], number>(HIT, [PREFIX + 'rl:' + key], [String(windowSeconds)]));
    if (n !== undefined) return Number(n);
  }
  const k = 'rl:' + key;
  const n = Number(mem.get(k) ?? 0) + 1;
  mem.set(k, String(n), { ttl: n === 1 ? windowSeconds * 1000 : undefined, noUpdateTTL: n > 1 });
  return n;
}

// ── health ──────────────────────────────────────────────────────────────────
let lastPing = { at: 0, ok: true };
/** At most one PING a minute, however often /health is polled. */
export async function pingCache() {
  if (!redis) return true;
  if (Date.now() - lastPing.at < 60_000) return lastPing.ok;
  const ok = (await send('read', (r) => r.ping())) === 'PONG';
  lastPing = { at: Date.now(), ok };
  return ok;
}

export const cacheStats = () => ({
  backend: cacheBackend,
  readsFromRedis: readsOn() ? 'on' : `off (${state.reason})`,
  commandsToday: state.used,
  dailyBudget: config.REDIS_DAILY_BUDGET,
  hits: state.hits,
  misses: state.misses,
  memoryHits: state.l1,
  latencyMs: state.lastLatencyMs,
});

/** Tests only: forget everything this process holds. */
export function resetLocalCache() {
  l1.clear();
  mem.clear();
}
