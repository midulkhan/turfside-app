// Live realtime probe: reads the public realtime settings from the API and checks that
// Supabase Realtime accepts the key and lets anonymous clients subscribe to slot_updates.
// Usage: node server/scripts/realtime-check.mjs https://api.turfsides.com
import { RealtimeClient } from '@supabase/realtime-js';

const api = process.argv[2] ?? 'https://api.turfsides.com';
const cfg = await (await fetch(`${api}/v1/config`)).json();
if (!cfg.realtime) {
  console.log('realtime: not configured on the API (SUPABASE_URL / SUPABASE_ANON_KEY missing)');
  process.exit(1);
}
const { url, anonKey, table } = cfg.realtime;
console.log(`realtime: ${url}  key ${anonKey.slice(0, 16)}…  table ${table}`);
const client = new RealtimeClient(`${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/realtime/v1`, { params: { apikey: anonKey } });
const done = (code, msg) => {
  console.log(msg);
  process.exit(code);
};
const t0 = Date.now();
client
  .channel('diagnose-probe')
  .on('postgres_changes', { event: '*', schema: 'public', table }, (p) => console.log('event', JSON.stringify(p.new)))
  .subscribe((status, err) => {
    if (status === 'SUBSCRIBED') done(0, `SUBSCRIBED in ${Date.now() - t0} ms: the app will get live slot updates`);
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') done(1, `${status}: ${err?.message ?? ''}`);
  });
setTimeout(() => done(1, 'no answer from Supabase Realtime within 20 s'), 20_000);
