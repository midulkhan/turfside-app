import { config, missingConfig } from './config';
import { buildApp } from './app';
import { closeDb } from './db';
import { ensureCronJobs } from './jobs';
import { migrate } from './migrations';
import { reconcile } from './services/payments';

async function main() {
  const app = await buildApp();

  const missing = missingConfig();
  if (missing.length) app.log.warn({ missing }, 'Some configuration is missing — see /health');

  if (config.DATABASE_URL && process.env.AUTO_MIGRATE !== 'false') {
    try {
      await migrate((m) => app.log.info(m));
      await ensureCronJobs((m) => app.log.info(m)).catch((e) => app.log.warn(e, 'could not schedule jobs'));
    } catch (e) {
      app.log.error(e, 'Migration failed — API keeps running so /health can report it');
    }
  }

  // Fallback while the process is awake. The reliable schedule is Supabase pg_cron
  // calling POST /internal/reconcile (works even if shared hosting put Node to sleep).
  if (config.DATABASE_URL) {
    setInterval(() => reconcile().catch((e) => app.log.warn(e, 'reconcile failed')), 60_000).unref();
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

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
