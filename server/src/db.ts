import { AsyncLocalStorage } from 'node:async_hooks';

import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

import { config } from './config';
import { ApiError } from './errors';

// Return BIGINT (money in poisha) as JS numbers. Safe: amounts stay far below 2^53.
types.setTypeParser(20, (v) => Number(v));
// Return DATE as a plain 'YYYY-MM-DD' string (no timezone shifting).
types.setTypeParser(1082, (v) => v);

let pool: Pool | null = null;
/** Statements/transactions sent since start (shown on /health; lets tests prove what is cached). */
export const dbStats = { queries: 0 };
/** Per-request count (sent as x-db-queries outside production, so tests can see what was cached). */
export const requestDb = new AsyncLocalStorage<{ n: number }>();
const counted = () => {
  dbStats.queries++;
  const r = requestDb.getStore();
  if (r) r.n++;
};

export function getPool() {
  if (!config.DATABASE_URL) throw new ApiError('not_configured', 'Database is not configured yet.');
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX, // shared hosting: keep the pool small
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 8_000,
      query_timeout: 10_000,
      ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined,
      application_name: 'turfsides-api',
    });
    pool.on('error', (e) => console.error('pg pool error', e.message));
  }
  return pool;
}

/** Parameterised queries only — never string-concatenate user input into SQL. */
export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  counted();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Run work in a transaction; rolls back on any error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  counted();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}
