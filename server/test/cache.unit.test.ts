/**
 * Cache building blocks, on the in-process store and (when UPSTASH_TEST_URL is set) on Redis
 * through the Upstash REST API: the same script runs in both.
 */
import { describe, expect, it, vi } from 'vitest';

const backends: [string, Record<string, string | undefined>][] = [['memory', { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }]];
if (process.env.UPSTASH_TEST_URL)
  backends.push(['redis', { UPSTASH_REDIS_REST_URL: process.env.UPSTASH_TEST_URL, UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_TEST_TOKEN, CACHE_PREFIX: `unit${Date.now() % 1e6}:` }]);

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('../src/cache');
}

describe.each(backends)('cache on %s', (_name, env) => {
  it('keeps the newest write: an older picture never replaces a newer one', async () => {
    const c = await load(env);
    await c.hashWrite('avail:test', { p1: '200|{"v":"new"}' }, 60);
    await c.hashWrite('avail:test', { p1: '100|{"v":"old"}' }, 60); // a slow reader, late
    expect(await c.hashGetMany('avail:test', ['p1'])).toEqual(['200|{"v":"new"}']);
    await c.hashWrite('avail:test', { p1: '300|{"v":"newer"}' }, 60);
    expect((await c.hashGetMany('avail:test', ['p1', 'nope']))).toEqual(['300|{"v":"newer"}', null]);
  });

  it('a full-day write removes older pitches it no longer sees, keeps newer ones', async () => {
    const c = await load(env);
    await c.hashWrite('avail:full', { a: '100|{}', b: '500|{}' }, 60);
    await c.hashWrite('avail:full', { _full: '300|{}', c: '300|{}' }, 60, 300);
    const all = await c.hashGetAll('avail:full');
    expect(Object.keys(all ?? {}).sort()).toEqual(['_full', 'b', 'c']);
  });

  it('counts rate-limit hits in one shared window', async () => {
    const c = await load(env);
    const k = `t${Math.random()}`;
    expect(await c.hit(k, 60)).toBe(1);
    expect(await c.hit(k, 60)).toBe(2);
  });

  it('read-through computes once for concurrent misses', async () => {
    const c = await load(env);
    let runs = 0;
    const compute = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 30));
      return { n: 1 };
    };
    const key = `rt${Math.random()}`;
    const got = await Promise.all([1, 2, 3, 4, 5].map(() => c.cached(key, 60, compute, 5)));
    expect(got.every((g) => g.n === 1)).toBe(true);
    expect(runs).toBe(1);
  });
});

describe('snapshot visibility', () => {
  it('knows which committed transactions a snapshot includes', async () => {
    vi.resetModules();
    const { snapshotIncludes } = await import('../src/services/venues');
    const snap = '100:105:100,103'; // as Postgres prints it: xmin:xmax:in-progress
    expect(snapshotIncludes(snap, 99n)).toBe(true); // finished before the snapshot
    expect(snapshotIncludes(snap, 100n)).toBe(false); // oldest still running
    expect(snapshotIncludes(snap, 101n)).toBe(true); // committed in between
    expect(snapshotIncludes(snap, 102n)).toBe(true);
    expect(snapshotIncludes(snap, 103n)).toBe(false);
    expect(snapshotIncludes(snap, 105n)).toBe(false); // started after the snapshot
    expect(snapshotIncludes('200:200:', 199n)).toBe(true);
    expect(snapshotIncludes('200:200:', 200n)).toBe(false);
  });
});
