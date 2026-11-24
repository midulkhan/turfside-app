import type { PoolClient } from 'pg';

import { getPool } from './db';
// Bundled as text by esbuild (see build.mjs), so the single dist file carries its migrations.
import m001 from '../db/migrations/001_init.sql';
import m002 from '../db/migrations/002_seed.sql';
import m003 from '../db/migrations/003_security_realtime.sql';
import m004 from '../db/migrations/004_user_places.sql';
import m005 from '../db/migrations/005_avatars.sql';
import m006 from '../db/migrations/006_orders.sql';
import m007 from '../db/migrations/007_account_settings.sql';
import m008 from '../db/migrations/008_slot_update_xid.sql';
import m009 from '../db/migrations/009_matches.sql';
import m010 from '../db/migrations/010_match_spots_live.sql';
import m011 from '../db/migrations/011_phone_change.sql';
import m012 from '../db/migrations/012_login_otp.sql';
import m013 from '../db/migrations/013_squad_slot_signal.sql';
import m014 from '../db/migrations/014_push.sql';
import m015 from '../db/migrations/015_phone_consent.sql';
import m016 from '../db/migrations/016_reviews.sql';
import m019 from '../db/migrations/019_member_contact_phone.sql';
import m018 from '../db/migrations/018_contact_phone.sql';
import m017 from '../db/migrations/017_two_factor.sql';
import m020 from '../db/migrations/020_owner_dashboard.sql';
import m021 from '../db/migrations/021_session_sets_pause.sql';
import m024 from '../db/migrations/024_push_tokens_follow_session.sql';
import m025 from '../db/migrations/025_venue_codes.sql';
import m026 from '../db/migrations/026_venue_map_url.sql';
import m027 from '../db/migrations/027_match_codes.sql';
import m028 from '../db/migrations/028_ticket_links.sql';
import m029 from '../db/migrations/029_price_per_slot.sql';
import m030 from '../db/migrations/030_owner_payouts.sql';
import m031 from '../db/migrations/031_venue_location_source.sql';
import m023 from '../db/migrations/023_opponents.sql';
import m022 from '../db/migrations/022_owner_accounts.sql';

const MIGRATIONS: [string, string][] = [
  ['001_init', m001],
  ['002_seed', m002],
  ['003_security_realtime', m003],
  ['004_user_places', m004],
  ['005_avatars', m005],
  ['006_orders', m006],
  ['007_account_settings', m007],
  ['008_slot_update_xid', m008],
  ['009_matches', m009],
  ['010_match_spots_live', m010],
  ['011_phone_change', m011],
  ['012_login_otp', m012],
  ['013_squad_slot_signal', m013],
  ['014_push', m014],
  ['015_phone_consent', m015],
  ['016_reviews', m016],
  ['017_two_factor', m017],
  ['018_contact_phone', m018],
  ['019_member_contact_phone', m019],
  ['020_owner_dashboard', m020],
  ['021_session_sets_pause', m021],
  ['022_owner_accounts', m022],
  ['023_opponents', m023],
  ['024_push_tokens_follow_session', m024],
  ['025_venue_codes', m025],
  ['026_venue_map_url', m026],
  ['027_match_codes', m027],
  ['028_ticket_links', m028],
  ['029_price_per_slot', m029],
  ['030_owner_payouts', m030],
  ['031_venue_location_source', m031],
];

/** Reported on /health: 'pending' until migrations have run on this process. */
export const schema = { state: 'pending' as 'pending' | 'ok' | 'skipped' | 'error', error: '' };

/**
 * Applies pending migrations once, inside a transaction each, guarded by an
 * advisory lock so several Node processes starting together can't race.
 */
export async function migrate(log: (m: string) => void = console.info) {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query('select pg_advisory_lock(727001)');
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    for (const [name, sql] of MIGRATIONS) {
      if (done.has(name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(name) values ($1)', [name]);
        await client.query('COMMIT');
        log(`migration applied: ${name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    schema.state = 'ok';
    schema.error = '';
  } catch (e) {
    schema.state = 'error';
    schema.error = String((e as Error).message || (e as { code?: string }).code || 'unknown').slice(0, 120);
    throw e;
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}
