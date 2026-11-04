import { config } from './config';
import { q } from './db';

/**
 * Schedules background jobs inside Supabase (pg_cron + pg_net), so they run even
 * when shared hosting has put the Node process to sleep:
 *  - every minute: release expired holds (pure SQL)
 *  - every minute: POST /internal/reconcile (settles missed bKash callbacks;
 *    the request also wakes / keeps the API warm)
 * Idempotent: cron.schedule with the same job name replaces the old definition.
 * Silently skipped on databases without pg_cron (e.g. local Postgres).
 */
export async function ensureCronJobs(log: (m: string) => void) {
  try {
    await q('create extension if not exists pg_cron');
    await q('create extension if not exists pg_net');
  } catch {
    log('pg_cron/pg_net not available — skipping scheduled jobs (enable them in Supabase → Database → Extensions)');
    return;
  }
  await q(`select cron.schedule('turfsides-release-holds', '* * * * *', 'select public.release_expired_holds()')`);
  if (config.CRON_SECRET && config.PUBLIC_URL.startsWith('https://')) {
    const cmd = `select net.http_post(url := ${lit(`${config.PUBLIC_URL}/internal/reconcile`)}, headers := jsonb_build_object('x-cron-secret', ${lit(config.CRON_SECRET)}, 'content-type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 20000)`;
    await q(`select cron.schedule('turfsides-reconcile', '* * * * *', $1)`, [cmd]);
  }
  log('scheduled jobs ensured (pg_cron)');
}

/** SQL string literal (single quotes doubled). Values come from our own env, never from users. */
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
