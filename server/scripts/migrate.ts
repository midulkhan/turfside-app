// Run migrations from your machine or CI:  DATABASE_URL=... npm run migrate
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const dir = join(__dirname, '..', 'db', 'migrations');
const client = new Client({ connectionString: url, ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  await client.query('select pg_advisory_lock(727001)');
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const name = f.replace(/\.sql$/, '');
    if (done.has(name)) continue;
    await client.query('BEGIN');
    await client.query(readFileSync(join(dir, f), 'utf8'));
    await client.query('insert into schema_migrations(name) values ($1)', [name]);
    await client.query('COMMIT');
    console.log('applied', name);
  }
  await client.end();
})().catch(async (e) => {
  console.error(e);
  await client.end().catch(() => {});
  process.exit(1);
});
