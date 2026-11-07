import { tokens } from './tokens';
import { ApiError, type ApiErrorCode, type AuthResult } from './types';

/** Device label for "Signed-in devices" (set at app start, see lib/device-label). */
let DEVICE = 'Unknown device';
export function setDeviceLabel(label: string) {
  DEVICE = label.slice(0, 60);
}

/** Set EXPO_PUBLIC_API_URL in .env to point the app at another server (e.g. a local one). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.turfsides.com').replace(/\/+$/, '');

const KNOWN_CODES = new Set<ApiErrorCode>([
  'slot_taken',
  'hold_expired',
  'payment_failed',
  'not_found',
  'invalid',
  'network',
  'unauthorized',
  'forbidden',
  'conflict',
  'rate_limited',
  'not_configured',
  'internal',
]);

type Options = {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** 'required' sends the token and refreshes it on 401; 'optional' sends it if signed in. */
  auth?: 'required' | 'optional' | 'none';
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
};

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** One refresh at a time: parallel 401s all wait for the same rotation. */
let refreshing: Promise<boolean> | null = null;
function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = tokens.refresh;
    if (!rt) return false;
    try {
      const res = await send<AuthResult>('POST', '/v1/auth/refresh', { body: { refreshToken: rt }, auth: 'none' });
      await tokens.set(res.accessToken, res.refreshToken);
      return true;
    } catch (e) {
      // Only a definite rejection signs the user out; a network blip keeps the session.
      if (e instanceof ApiError && e.code === 'unauthorized') {
        await tokens.clear();
        tokens.emitExpired();
      }
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function send<T>(method: string, path: string, o: Options): Promise<T> {
  const url = new URL(API_URL + path);
  Object.entries(o.query ?? {}).forEach(([k, v]) => v !== undefined && v !== '' && url.searchParams.set(k, String(v)));

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;
  headers['X-Device'] = DEVICE; // shown under Privacy & security → Signed-in devices
  if (o.auth && o.auth !== 'none') {
    await tokens.load();
    if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
    else if (o.auth === 'required') throw new ApiError('unauthorized', 'Please sign in.');
  }

  // Timeout + caller cancellation (React Query aborts stale searches) on one controller.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 15_000);
  const onAbort = () => ctrl.abort();
  o.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e; // the caller cancelled; let React Query drop it quietly
    throw new ApiError(
      'network',
      isAbort(e) ? 'The server took too long to answer. Try again.' : 'Can’t reach TurfSides. Check your internet connection.',
    );
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (e.g. a hosting error page)
  }
  if (res.ok) return data as T;

  const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
  const code = (
    err?.code && KNOWN_CODES.has(err.code as ApiErrorCode)
      ? err.code
      : res.status === 401
        ? 'unauthorized'
        : res.status >= 500
          ? 'internal'
          : 'invalid'
  ) as ApiErrorCode;
  throw new ApiError(code, err?.message ?? (res.status >= 500 ? 'Something went wrong on our side. Try again.' : 'Request failed.'));
}

/** JSON request to the TurfSides API with auth, refresh-on-401, timeouts and typed errors. */
export async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, o: Options = {}): Promise<T> {
  try {
    return await send<T>(method, path, o);
  } catch (e) {
    if (o.auth && o.auth !== 'none' && e instanceof ApiError && e.code === 'unauthorized' && tokens.refresh) {
      if (await refreshTokens()) return send<T>(method, path, o);
      if (o.auth === 'optional') return send<T>(method, path, { ...o, auth: 'none' });
    }
    throw e;
  }
}
