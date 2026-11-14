import { config } from '../config';
import { q } from '../db';

/**
 * Push notifications through Expo's push service (it forwards to Firebase on Android and
 * Apple on iOS, using the credentials uploaded to the EAS project).
 *
 * Outbox: every row in `notifications` is pushed once. Code anywhere (inside transactions
 * too) just inserts the row; `kickPush()` after a request, plus a slow timer, sends whatever
 * is waiting. A notification is never pushed twice, even with several server processes
 * (`for update skip locked`).
 */
const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo's limit per request
const MAX_AGE_MIN = 30; // older unsent news is not worth a buzz any more

export const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/.test(t);

type Row = { id: string; user_id: string; kind: string; title: string; body: string; data: Record<string, unknown> | null };
type Ticket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

let running: Promise<void> | null = null;
let again = false;
let lastRun = { at: null as string | null, sent: 0, error: null as string | null };
export const pushStatus = () => lastRun;

/** Send waiting notifications now (coalesced: one run at a time, one follow-up if asked again). */
export function kickPush() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await flush();
      } while (again);
      lastRun = { ...lastRun, at: new Date().toISOString(), error: null }; // healthy (even if nothing to send)
    } catch (e) {
      lastRun = { ...lastRun, at: new Date().toISOString(), error: String((e as Error).message ?? e).slice(0, 200) };
    } finally {
      running = null;
    }
  })();
  return running;
}

/** While the process is up, also look every few seconds (news made outside a request). */
export function startPushLoop(everyMs = 5000) {
  const t = setInterval(() => void kickPush(), everyMs);
  t.unref?.();
  return () => clearInterval(t);
}

async function flush() {
  // Claim a batch atomically: marked as pushed in the same statement that reads it.
  const rows = await q<Row>(
    `update notifications n set pushed_at = now()
      where n.id in (select id from notifications
                      where pushed_at is null and created_at > now() - make_interval(mins => $1)
                      order by created_at limit 200 for update skip locked)
      returning n.id, n.user_id, n.kind, n.title, n.body, n.data`,
    [MAX_AGE_MIN],
  );
  if (!rows.length) return;
  const users = [...new Set(rows.map((r) => r.user_id))];
  // Only people who have notifications switched on, on every phone they're signed in on.
  const tokens = await q<{ user_id: string; token: string; unread: number }>(
    `select t.user_id, t.token,
            (select count(*) from notifications x where x.user_id = t.user_id and x.read_at is null)::int unread
       from push_tokens t join users u on u.id = t.user_id
       left join sessions s on s.id = t.session_id
      where t.user_id = any($1) and u.notify_enabled and u.deleted_at is null
        and (t.session_id is null or s.revoked_at is null) -- signed out everywhere (e.g. password reset)`,
    [users],
  );
  const byUser = new Map<string, { token: string; unread: number }[]>();
  for (const t of tokens) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t]);

  const messages = rows.flatMap((r) =>
    (byUser.get(r.user_id) ?? []).map((t) => ({
      to: t.token,
      title: r.title,
      body: r.body,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      badge: t.unread,
      // The app opens the matching screen from these (same as tapping it in the list).
      data: { notificationId: r.id, kind: r.kind, ...(r.data ?? {}) },
    })),
  );
  let sent = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    const tickets = await send(chunk);
    sent += chunk.length;
    // An uninstalled app / revoked permission: forget that token.
    const dead = tickets.flatMap((t, k) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? [chunk[k]!.to] : []));
    if (dead.length) await q('delete from push_tokens where token = any($1)', [dead]);
  }
  lastRun = { ...lastRun, sent: lastRun.sent + sent };
}

async function send(messages: unknown[]): Promise<Ticket[]> {
  if (config.PUSH_DRY_RUN) {
    sentForTests.push(...(messages as object[]));
    return messages.map(() => ({ status: 'ok' as const }));
  }
  const res = await fetch(EXPO_SEND, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(config.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Ticket[]; errors?: { message: string }[] };
  if (!res.ok || !json.data) throw new Error(`expo push ${res.status}: ${json.errors?.[0]?.message ?? 'no tickets'}`);
  return json.data;
}

/** Test servers (PUSH_DRY_RUN): what would have been sent. */
export const sentForTests: object[] = [];
