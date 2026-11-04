import { Redis } from '@upstash/redis';
import { LRUCache } from 'lru-cache';

import { config } from './config';

/**
 * Cache layer.
 * - Upstash Redis over HTTPS when configured: works from shared hosting (port 443,
 *   no raw TCP) and is shared by every Node process.
 * - Otherwise an in-process LRU, so the API still runs (and stays fast) without Redis.
 * Every call is best-effort: a cache failure never fails a request.
 */
const memory = new LRUCache<string, string>({ max: 5000, ttlAutopurge: false });
const redis = config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN ? new Redis({ url: config.UPSTASH_REDIS_REST_URL, token: config.UPSTASH_REDIS_REST_TOKEN, automaticDeserialization: false }) : null;

export const cacheBackend = redis ? 'upstash-redis' : 'memory';
const PREFIX = 'ts:';

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = redis ? await redis.get<string>(PREFIX + key) : memory.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const raw = JSON.stringify(value);
  try {
    if (redis) await redis.set(PREFIX + key, raw, { ex: ttlSeconds });
    else memory.set(key, raw, { ttl: ttlSeconds * 1000 });
  } catch {
    /* best effort */
  }
}

export async function cacheDel(...keys: string[]) {
  try {
    if (redis) await redis.del(...keys.map((k) => PREFIX + k));
    else keys.forEach((k) => memory.delete(k));
  } catch {
    /* best effort */
  }
}

/** Read-through helper: return cached value or compute, store and return it. */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

/** Simple fixed-window counter for rate limits that must survive across processes. */
export async function hit(key: string, windowSeconds: number): Promise<number> {
  try {
    if (redis) {
      const n = await redis.incr(PREFIX + 'rl:' + key);
      if (n === 1) await redis.expire(PREFIX + 'rl:' + key, windowSeconds);
      return n;
    }
    const k = 'rl:' + key;
    const n = Number(memory.get(k) ?? 0) + 1;
    memory.set(k, String(n), { ttl: n === 1 ? windowSeconds * 1000 : undefined, noUpdateTTL: n > 1 });
    return n;
  } catch {
    return 0;
  }
}

export async function pingCache() {
  if (!redis) return true;
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
