import { config, missingConfig } from './config';
import { buildApp } from './app';
import { closeDb } from './db';
import { ensureCronJobs } from './jobs';
import { startPushLoop } from './lib/push';
import { migrate, schema } from './migrations';
import { reconcile } from './services/payments';
import { invalidateVenue } from './services/venues';

async function main() {
  const app = await buildApp();

  const missing = missingConfig();
  if (missing.length) app.log.warn({ missing }, 'Some configuration is missing — see /health');

  // Fallback while the process is awake. The reliable schedule is Supabase pg_cron
  // calling POST /internal/reconcile (works even if shared hosting put Node to sleep).
  if (config.DATABASE_URL) {
    setInterval(() => reconcile().catch((e) => app.log.warn(e, 'reconcile failed')), 60_000).unref();
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  if (config.DATABASE_URL) startPushLoop(); // news made outside a request (expiries, jobs)

  // Migrate after listening, and keep retrying: if the database is unreachable at
  // start-up (e.g. a firewall), the tables still get created as soon as it's reachable.
  if (config.DATABASE_URL && process.env.AUTO_MIGRATE !== 'false') {
    const run = async (attempt = 1): Promise<void> => {
      try {
        await migrate((m) => app.log.info(m));
        await invalidateVenue(); // drop anything cached while the tables were still empty
        await ensureCronJobs((m) => app.log.info(m)).catch((e) => app.log.warn(e, 'could not schedule jobs'));
      } catch (e) {
        const wait = Math.min(15_000 * attempt, 120_000);
        app.log.error(e, `Migration failed — retrying in ${wait / 1000}s`);
        setTimeout(() => void run(attempt + 1), wait).unref();
      }
    };
    void run();
  } else {
    schema.state = 'skipped'; // migrations are run separately (npm run migrate)
  }

  const stop = async () => {
    await app.close().catch(() => {});
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error('Failed to start', e);
  process.exit(1);
});
