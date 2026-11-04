import { secure } from '@/lib/storage';

/**
 * Auth tokens.
 *  - Access token (15 min JWT): kept in memory, mirrored to SecureStore so a cold
 *    start can reuse it until it expires.
 *  - Refresh token (30 days, rotated on every use): SecureStore only
 *    (Keychain / Android Keystore), never AsyncStorage or logs.
 */
const ACCESS = 'ts.access';
const REFRESH = 'ts.refresh';

let access: string | null = null;
let refresh: string | null = null;
let loaded: Promise<void> | null = null;
const expiredListeners = new Set<() => void>();

export const tokens = {
  /** Read tokens from secure storage once per launch. */
  load() {
    loaded ??= Promise.all([secure.get(ACCESS), secure.get(REFRESH), secure.remove('ts.token')]).then(([a, r]) => {
      access = a;
      refresh = r;
    });
    return loaded;
  },
  get access() {
    return access;
  },
  get refresh() {
    return refresh;
  },
  async set(a: string, r: string) {
    access = a;
    refresh = r;
    loaded = Promise.resolve();
    await Promise.all([secure.set(ACCESS, a), secure.set(REFRESH, r)]);
  },
  async clear() {
    access = null;
    refresh = null;
    loaded = Promise.resolve();
    await Promise.all([secure.remove(ACCESS), secure.remove(REFRESH)]);
  },
  /** The session was revoked or expired server-side; the UI should sign out. */
  onExpired(fn: () => void) {
    expiredListeners.add(fn);
    return () => {
      expiredListeners.delete(fn);
    };
  },
  emitExpired() {
    expiredListeners.forEach((fn) => fn());
  },
};
