import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { cached, cacheBackend, cacheStats, pingCache } from './cache';
import { config, isProd, missingConfig } from './config';
import { dbStats, one, q, requestDb } from './db';
import { schema } from './migrations';
import { ApiError } from './errors';
import { bkashEnabled, isSimulated } from './lib/bkash';
import { safeEqual } from './lib/crypto';
import { addDays, dhakaToday, isDayKey } from './lib/time';
import { deleteObject, headObject, MAX_UPLOAD_BYTES, newKey, pingStorage, presignPut, publicUrl, UPLOAD_TYPES, type UploadType } from './lib/storage';
import { emailState, lastEmailSend } from './lib/email';
import { isExpoToken, kickPush, pushStatus, sentForTests } from './lib/push';
import { verifyAccess, verifyAnyPass } from './lib/tokens';
import * as account from './services/account';
import * as auth from './services/auth';
import * as bookings from './services/bookings';
import * as owner from './services/owner';
import * as matches from './services/matches';
import * as reviews from './services/reviews';
import * as payments from './services/payments';
import { registerOwnerRoutes } from './routes/owner';
import { allVenueRows, availabilityFor, daySlots, detail, getVenueRow, haversineKm, summary } from './services/venues';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; roles: string[]; sessionId: string };
  }
}

// ── Validation helpers ──────────────────────────────────────────────────────
const phone10 = z
  .string()
  .transform((v) => {
    let d = v.replace(/\D/g, '');
    if (d.startsWith('880')) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    return d;
  })
  .refine((d) => /^1[3-9]\d{8}$/.test(d), 'Enter a valid Bangladesh mobile number.');
const password = z.string().min(8, 'Use at least 8 characters.').max(128);
const email = z.string().trim().toLowerCase().email().max(254);

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    // Name the field ("schedule.opens: …") so API clients like Postman see what to fix.
    const at = i?.path?.length ? `${i.path.join('.')}: ` : '';
    throw new ApiError('invalid', i ? `${at}${i.message}` : 'Invalid request.');
  }
  return r.data;
}

// "x-device" is a short label the app sends ("iPhone 15 · iOS 18.1"), shown under Signed-in devices.
const deviceLabel = (h: unknown) => {
  if (typeof h !== 'string') return undefined;
  let v = h;
  try {
    v = decodeURIComponent(h); // the app URL-encodes it (header values must be ASCII)
  } catch {
    /* use as sent */
  }
  return v.replace(/[^\p{L}\p{N} .,·()+-]/gu, '').trim().slice(0, 60) || undefined;
};
const meta = (req: FastifyRequest) => ({ ip: req.ip, ua: req.headers['user-agent'], device: deviceLabel(req.headers['x-device']) });
const idem = (req: FastifyRequest) => (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined);

async function requireUser(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new ApiError('unauthorized', 'Please sign in.');
  req.user = await verifyAccess(h.slice(7));
}
/** For account-security actions: the session itself must still be signed in (not just a valid 15-min token). */
async function requireLiveUser(req: FastifyRequest) {
  await requireUser(req);
  await account.assertLiveSession(req.user!.sessionId);
}
async function requireOwner(req: FastifyRequest) {
  await requireUser(req);
  if (!req.user!.roles.includes('owner')) throw new ApiError('forbidden', 'This needs a turf owner account.');
}
async function optionalUser(req: FastifyRequest) {
  if (req.headers.authorization?.startsWith('Bearer ')) await requireUser(req).catch(() => undefined);
}

const RADIUS_STEPS = [5, 10, 20, 30];
const STARTED_AT = new Date().toISOString();
const MIN_RESULTS = 5;

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY, // behind cPanel's Apache/Passenger proxy
    bodyLimit: 32 * 1024,
    logger: {
      level: isProd ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.newPassword', 'req.body.code', 'req.body.refreshToken'],
    },
    genReqId: () => Math.random().toString(36).slice(2, 10),
  });

  // Count this request's database work (the header is left out in production).
  app.addHook('onRequest', (req, _reply, done) => {
    const scope = { n: 0 };
    (req as unknown as { db: typeof scope }).db = scope;
    requestDb.run(scope, done);
  });
  if (!isProd)
    app.addHook('onSend', async (req, reply) => {
      reply.header('x-db-queries', String((req as unknown as { db?: { n: number } }).db?.n ?? 0));
    });

  // Anything that changed data may have written a notification: push it out right away.
  if (config.DATABASE_URL)
    app.addHook('onResponse', async (req, reply) => {
      if (req.method !== 'GET' && reply.statusCode < 400) void kickPush();
    });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // images are loaded by the app
  });
  await app.register(cors, { origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MIN, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  // Per signed-in session rather than per IP: many players can share one carrier IP, and rate
  // limiting runs before auth, so the bearer token is the session key (IP for signed-out users).
  const perSession = (r: { headers: { authorization?: string }; ip: string }) => r.headers.authorization ?? r.ip;

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } });
    if (status && status < 500) return reply.status(status).send({ error: { code: 'invalid', message: 'Invalid request.' } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } }));

  // ── Health ────────────────────────────────────────────────────────────────
  /** Live slot updates need both the Supabase keys (for the app) and slot_updates in the realtime publication. */
  const realtimeState = async () => {
    const published = await one<{ ok: boolean }>(
      "select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'slot_updates') ok",
    ).then((r) => !!r?.ok, () => false);
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return published ? 'needs SUPABASE_URL + SUPABASE_ANON_KEY' : 'not_configured';
    return published ? 'ok' : 'slot_updates not in supabase_realtime publication';
  };
  app.get('/health', async () => {
    const dbQueries = dbStats.queries; // before this check's own queries
    let db = 'not_configured';
    if (config.DATABASE_URL) db = await one('select 1 ok')
        .then(() => 'ok')
        .catch((e: Error & { code?: string; errors?: { code?: string; address?: string; port?: number }[] }) => {
          // Connection failures arrive as an AggregateError with an empty message; show the socket codes instead.
          const inner = e.errors?.map((x) => `${x.code ?? '?'} ${x.address ?? ''}:${x.port ?? ''}`).join(', ');
          return `error: ${(e.message || e.code || inner || 'unknown').slice(0, 120)}${inner && e.message ? ` (${inner})` : ''}`;
        });
    return {
      status: db === 'ok' && (schema.state === 'ok' || schema.state === 'skipped') ? 'ok' : 'degraded',
      env: config.NODE_ENV,
      db,
      schema: schema.state === 'error' ? `error: ${schema.error}` : schema.state,
      cache: `${cacheBackend}:${(await pingCache()) ? 'ok' : 'error'}`,
      cacheStats: { ...cacheStats(), dbQueries },
      storage: await pingStorage(),
      payments: config.BKASH_MODE,
      realtime: db === 'ok' ? await realtimeState() : 'unknown',
      email: await emailState(), // sender:ok once SENDER_API_TOKEN is set and accepted
      emailLastSend: lastEmailSend(),
      push: pushStatus(), // last outbox run: when, how many sent, last error
      missing: missingConfig(),
      startedAt: STARTED_AT, // changes on every restart: shows whether new settings were picked up
      time: new Date().toISOString(),
    };
  });
  app.get('/', async () => ({ name: 'TurfSides API', health: '/health' }));

  // ── Static seed photos (long cache) ───────────────────────────────────────
  const publicDir = join(__dirname, '..', 'public');
  app.get('/static/seed/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[a-z0-9-]+\.webp$/.test(file)) throw new ApiError('not_found', 'Not found.');
    const path = join(publicDir, 'seed', file);
    if (!existsSync(path)) throw new ApiError('not_found', 'Not found.');
    reply.header('Cache-Control', 'public, max-age=604800, immutable').type('image/webp');
    return reply.send(createReadStream(path));
  });

  // Brand images for emails (mail apps fetch them by URL; PNG because Gmail won't show SVG).
  app.get('/static/brand/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[a-z0-9-]+\.png$/.test(file)) throw new ApiError('not_found', 'Not found.');
    const path = join(publicDir, 'brand', file);
    if (!existsSync(path)) throw new ApiError('not_found', 'Not found.');
    reply.header('Cache-Control', 'public, max-age=86400').type('image/png');
    return reply.send(createReadStream(path));
  });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authLimit = { config: { rateLimit: { max: config.AUTH_RATE_LIMIT, timeWindow: '1 minute' } } };
  app.post('/v1/auth/signup/start', authLimit, async (req) => {
    // Both a mobile number (sign-in, SMS codes, bKash) and an email (receipts, recovery) are required.
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: phone10, email, password, role: z.enum(['player', 'owner']).default('player') }), req.body);
    return auth.signupStart(b, req.ip);
  });
  app.post('/v1/auth/signup/verify', authLimit, async (req) => {
    const b = parse(z.object({ phone: phone10, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }), req.body);
    return auth.signupVerify(b.phone, b.code, meta(req));
  });
  app.post('/v1/auth/login', authLimit, async (req) => {
    const b = parse(z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) }), req.body);
    const isEmail = b.identifier.includes('@');
    const ident = isEmail ? { kind: 'email' as const, value: parse(email, b.identifier) } : { kind: 'phone' as const, value: parse(phone10, b.identifier) };
    return auth.login(ident, b.password, meta(req));
  });
  const challenge = z.string().min(20).max(300);
  app.post('/v1/auth/login/verify', authLimit, async (req) => {
    const b = parse(z.object({ challenge, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }), req.body);
    return auth.loginVerify(b.challenge, b.code, meta(req));
  });
  app.post('/v1/auth/login/resend', authLimit, async (req) => auth.loginResend(parse(z.object({ challenge }), req.body).challenge, req.ip));
  app.post('/v1/auth/refresh', authLimit, async (req) => auth.refresh(parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body).refreshToken, meta(req)));
  app.post('/v1/auth/logout', { preHandler: requireUser }, async (req) => auth.logout(req.user!.sessionId));
  // Reset by account email (owner dashboard) or by mobile number (player app). The code is
  // emailed either way; an unknown email or number gets the same answer (no account discovery).
  const resetWho = z.union([z.object({ email }), z.object({ phone: phone10 })]);
  app.post('/v1/auth/password/reset/start', authLimit, async (req) => {
    const b = parse(resetWho, req.body);
    const phone = 'email' in b ? await auth.phoneForEmail(b.email) : b.phone;
    return phone ? auth.resetStart(phone, req.ip) : { sent: true };
  });
  app.post('/v1/auth/password/reset/verify', authLimit, async (req) => {
    const b = parse(z.intersection(resetWho, z.object({ code: z.string().regex(/^\d{6}$/), newPassword: password })), req.body);
    const phone = 'email' in b ? await auth.phoneForEmail(b.email) : b.phone;
    if (!phone) throw new ApiError('invalid', 'That code is not right. Try again.');
    return auth.resetVerify(phone, b.code, b.newPassword, meta(req));
  });

  // ── Venues (public; hearts filled in when signed in) ──────────────────────
  // Explore + search. The app debounces, narrows locally and caches, so a person typing sends a
  // handful of requests; 60/min per session only ever stops scripts or runaway loops.
  app.get('/v1/venues/explore', { preHandler: optionalUser, config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) => {
    const p = parse(
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        day: z.string().refine(isDayKey).optional(),
        format: z.enum(['any', '5-a-side', '6-a-side', '7-a-side']).default('any'),
        floodlit: z.enum(['true', 'false']).optional(),
        q: z.string().trim().max(60).optional(),
        /** Fixed search radius in km (the app's distance slider). Omit for the adaptive 5→30 km search. */
        radius: z.coerce.number().int().min(1).max(50).optional(),
        /** Paging (10 at a time in the app). Without `limit` the old single response (up to 60). */
        cursor: z.coerce.number().int().min(0).max(1000).optional(),
        limit: z.coerce.number().int().min(1).max(30).optional(),
      }),
      req.query,
    );
    const day = p.day ?? dhakaToday();
    // Everything here comes from the cached catalog (memory, re-checked once a minute) and one
    // shared availability read for the day: searching and filtering cost no database queries.
    const lat = p.lat;
    const lng = p.lng;
    const ql = p.q?.toLowerCase();
    const rows = (await allVenueRows())
      .filter((v) => (p.format === 'any' ? true : v.formats.includes(p.format)))
      .filter((v) => (p.floodlit === 'true' ? v.floodlit : true))
      .filter((v) => (ql ? `${v.name} ${v.area}`.toLowerCase().includes(ql) : true))
      .map((v) => ({ v, d: haversineKm(lat, lng, v.lat, v.lng) }))
      .sort((a, b) => a.d - b.d || Number(b.v.rating) - Number(a.v.rating));
    let radiusKm = p.radius ?? RADIUS_STEPS[RADIUS_STEPS.length - 1];
    if (!p.radius) for (const r of RADIUS_STEPS) {
      if (rows.filter((x) => x.d <= r).length >= MIN_RESULTS) {
        radiusKm = r;
        break;
      }
    }
    const matching = rows.filter((x) => x.d <= radiusKm || !!ql);
    const from = p.limit ? (p.cursor ?? 0) : 0;
    const inRange = matching.slice(from, p.limit ? from + p.limit : 60);
    const nextCursor = p.limit && from + p.limit < matching.length ? from + p.limit : null;
    const avail = await availabilityFor(inRange.map((x) => x.v), day);
    const withAvail = inRange.map(({ v }) => summary(v, { lat, lng, availableToday: avail.get(v.id) ?? false }));
    const base = {
      radiusKm,
      near: withAvail.filter((x) => (x.distanceKm ?? 0) <= RADIUS_STEPS[0]),
      further: withAvail.filter((x) => (x.distanceKm ?? 0) > RADIUS_STEPS[0]),
      ...(p.limit ? { nextCursor, total: matching.length } : {}),
    };
    if (!req.user) return base;
    const saved = new Set((await q<{ venue_id: string }>('select venue_id from saved_venues where user_id = $1', [req.user.userId])).map((r) => r.venue_id));
    const mark = (v: { id: string }) => ({ ...v, isSaved: saved.has(v.id) });
    return { ...base, near: base.near.map(mark), further: base.further.map(mark) };
  });

  app.get('/v1/venues/:id', { preHandler: optionalUser }, async (req) => {
    const { id } = req.params as { id: string };
    const v = await getVenueRow(id);
    const saved = req.user ? !!(await one('select 1 from saved_venues where user_id = $1 and venue_id = $2', [req.user.userId, id])) : false;
    return detail(v, saved);
  });

  app.get('/v1/venues/:id/slots', { preHandler: optionalUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { day, fresh, v: since } = parse(
      z.object({
        day: z.string().refine(isDayKey, 'Invalid date.'),
        fresh: z.literal('1').optional(),
        /** Transaction id from the realtime event: the answer must include that change. */
        v: z.string().regex(/^\d{1,20}$/).optional(),
      }),
      req.query,
    );
    const venue = await getVenueRow(id);
    reply.header('Cache-Control', 'no-store');
    // `fresh` / `v` are accepted from older apps but no longer matter: every answer is live.
    void fresh;
    void since;
    const slots = await daySlots(venue, day, req.user?.userId);
    return { venueId: id, day, slots, fetchedAt: Date.now() };
  });

  // Public reviews, plus (signed in) whether you can review this turf and your own review.
  // A review is posted once and is final (no edit or delete).
  app.get('/v1/venues/:id/reviews', { preHandler: optionalUser }, async (req) => {
    const { id } = req.params as { id: string };
    await getVenueRow(id); // 404 for unknown turfs
    const pub = await reviews.publicReviews(id);
    return req.user ? { ...pub, ...(await reviews.myReviewState(req.user.userId, id)) } : { ...pub, canReview: false, mine: null };
  });
  app.put('/v1/venues/:id/reviews/mine', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) => {
    const { id } = req.params as { id: string };
    await getVenueRow(id);
    const b = parse(z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().max(1000).default('') }), req.body);
    return reviews.saveReview(req.user!.userId, id, b);
  });

  // ── Me ────────────────────────────────────────────────────────────────────
  app.get('/v1/me', { preHandler: requireUser }, async (req) => auth.me(req.user!.userId));
  // ── Account: settings, devices, password, deletion ──────────────────────
  app.get('/v1/me/settings', { preHandler: requireUser }, async (req) => account.getSettings(req.user!.userId));
  app.put('/v1/me/settings', { preHandler: requireUser }, async (req) =>
    account.updateSettings(req.user!.userId, parse(z.object({ notifications: z.boolean().optional(), twoFactor: z.boolean().optional() }).strict(), req.body)),
  );
  app.get('/v1/me/sessions', { preHandler: requireLiveUser }, async (req) => account.listSessions(req.user!.userId, req.user!.sessionId));
  app.delete('/v1/me/sessions/:id', { preHandler: requireLiveUser }, async (req) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('not_found', 'That device is already signed out.');
    return account.revokeSession(req.user!.userId, id);
  });
  app.post('/v1/me/sessions/revoke-others', { preHandler: requireLiveUser }, async (req) => account.revokeOtherSessions(req.user!.userId, req.user!.sessionId));
  const sensitive = { preHandler: requireLiveUser, config: { rateLimit: { max: 8, timeWindow: '15 minutes', keyGenerator: perSession } } };
  app.post('/v1/me/password', sensitive, async (req) => {
    const b = parse(z.object({ current: z.string().min(1).max(200), next: password }), req.body);
    return account.changePassword(req.user!.userId, req.user!.sessionId, b.current, b.next);
  });
  app.patch('/v1/me', { preHandler: requireLiveUser }, async (req) =>
    auth.updateProfile(req.user!.userId, parse(z.object({ name: z.string().trim().min(2, 'Enter your name.').max(80) }), req.body)),
  );
  app.post('/v1/me/phone/start', sensitive, async (req) => {
    const b = parse(z.object({ phone: phone10, password: z.string().min(1).max(200) }), req.body);
    return auth.phoneChangeStart(req.user!.userId, b.phone, b.password, req.ip);
  });
  app.post('/v1/me/phone/verify', sensitive, async (req) => {
    const b = parse(z.object({ phone: phone10, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }), req.body);
    return auth.phoneChangeVerify(req.user!.userId, b.phone, b.code);
  });
  app.post('/v1/me/delete', sensitive, async (req) => account.deleteAccount(req.user!.userId, parse(z.object({ password: z.string().min(1).max(200) }), req.body).password));
  app.get('/v1/me/saved', { preHandler: requireUser }, async (req) => {
    const ids = await q<{ venue_id: string }>('select venue_id from saved_venues where user_id = $1 order by created_at desc', [req.user!.userId]);
    const rows = await allVenueRows();
    return ids.map((s) => rows.find((r) => r.id === s.venue_id)).filter(Boolean).map((v) => summary(v!, { saved: true }));
  });
  app.put('/v1/me/saved/:venueId', { preHandler: requireUser }, async (req) => {
    const { venueId } = req.params as { venueId: string };
    await getVenueRow(venueId);
    await q('insert into saved_venues (user_id, venue_id) values ($1,$2) on conflict do nothing', [req.user!.userId, venueId]);
    return { venueId, isSaved: true };
  });
  app.delete('/v1/me/saved/:venueId', { preHandler: requireUser }, async (req) => {
    const { venueId } = req.params as { venueId: string };
    await q('delete from saved_venues where user_id = $1 and venue_id = $2', [req.user!.userId, venueId]);
    return { venueId, isSaved: false };
  });
  // ── Owner: turfs (owner app; also handy for demo data from Postman) ────────
  const venueId = (req: FastifyRequest) => parse(z.object({ id: z.string().regex(/^v_[A-Za-z0-9_]{1,40}$/, 'Unknown turf.') }), req.params).id;
  app.get('/v1/owner/venues', { preHandler: requireOwner }, async (req) => owner.listOwnerVenues(req.user!.userId));
  app.get('/v1/owner/venues/:id', { preHandler: requireOwner }, async (req) => owner.getOwnerVenue(req.user!.userId, venueId(req)));
  app.post('/v1/owner/venues', { preHandler: requireOwner, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) =>
    owner.createVenue(req.user!.userId, parse(owner.venueInput, req.body)),
  );
  app.put('/v1/owner/venues/:id', { preHandler: requireOwner }, async (req) => owner.updateVenue(req.user!.userId, venueId(req), parse(owner.venueInput, req.body)));
  app.put('/v1/owner/venues/:id/booking-pause', { preHandler: requireOwner }, async (req) =>
    owner.setBookingPause(req.user!.userId, venueId(req), parse(owner.bookingPauseInput, req.body)),
  );
  app.delete('/v1/owner/venues/:id', { preHandler: requireOwner }, async (req) => owner.removeVenue(req.user!.userId, venueId(req)));
  // Owner dashboard: bookings, day sheet, closures, stats, reviews, tournaments, inbox.
  registerOwnerRoutes(app, { requireOwner, parse });

  // ── Photo uploads (Cloudflare R2, direct from the app) ──────────────────────
  app.post('/v1/uploads', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(
      z.object({
        purpose: z.enum(['avatar', 'venue']),
        contentType: z.enum(Object.keys(UPLOAD_TYPES) as [UploadType, ...UploadType[]]),
        size: z.number().int().min(1).max(MAX_UPLOAD_BYTES, 'Photos must be under 5 MB.'),
      }),
      req.body,
    );
    // Turf photos are for owners only; each user uploads under their own prefix.
    if (b.purpose === 'venue' && !req.user!.roles.includes('owner')) throw new ApiError('forbidden', 'Only turf owners can upload turf photos.');
    const key = newKey(`${b.purpose === 'venue' ? 'venues' : 'avatars'}/${req.user!.userId}`, b.contentType);
    // publicUrl: where the photo will be served from (owner dashboards put it in the turf's photos).
    return { key, ...(await presignPut(key, b.contentType, b.size)), publicUrl: publicUrl(key) };
  });

  app.put('/v1/me/avatar', { preHandler: requireUser }, async (req) => {
    const { key } = parse(z.object({ key: z.string().max(200) }), req.body);
    // Only keys we issued to this user, and only once the file is really in R2.
    if (!key.startsWith(`avatars/${req.user!.userId}/`)) throw new ApiError('forbidden', 'That photo doesn’t belong to you.');
    const obj = await headObject(key);
    if (!obj) throw new ApiError('invalid', 'The photo hasn’t finished uploading. Try again.');
    if (obj.size > MAX_UPLOAD_BYTES || !obj.type.startsWith('image/')) {
      await deleteObject(key).catch(() => {});
      throw new ApiError('invalid', 'That file isn’t a valid photo.');
    }
    const prev = await one<{ avatar_key: string | null }>('select avatar_key from users where id = $1', [req.user!.userId]);
    await q('update users set avatar_key = $2, updated_at = now() where id = $1', [req.user!.userId, key]);
    if (prev?.avatar_key && prev.avatar_key !== key) await deleteObject(prev.avatar_key).catch(() => {});
    return auth.me(req.user!.userId);
  });

  app.delete('/v1/me/avatar', { preHandler: requireUser }, async (req) => {
    const prev = await one<{ avatar_key: string | null }>('update users u set avatar_key = null, updated_at = now() from (select avatar_key from users where id = $1) old where u.id = $1 returning old.avatar_key', [req.user!.userId]);
    if (prev?.avatar_key) await deleteObject(prev.avatar_key).catch(() => {});
    return auth.me(req.user!.userId);
  });

  // ── Saved locations ─────────────────────────────────────────────────────────
  const MAX_PLACES = 20;
  const round3 = (n: number) => Math.round(n * 1000) / 1000; // ~100 m: never store a precise position
  const placeBody = z.object({
    label: z.string().trim().min(1, 'Give this location a name.').max(30),
    name: z.string().trim().min(1).max(80),
    city: z.string().trim().max(80).default(''),
    address: z.string().trim().max(200).default(''),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  });
  type PlaceRow = { id: string; label: string; name: string; city: string; address: string; lat: number; lng: number; created_at: Date };
  const placeOut = (r: PlaceRow) => ({ id: r.id, label: r.label, name: r.name, city: r.city, address: r.address, lat: r.lat, lng: r.lng, createdAt: new Date(r.created_at).getTime() });
  const PLACE_COLS = 'id, label, name, city, address, lat, lng, created_at';

  app.get('/v1/me/places', { preHandler: requireUser }, async (req) =>
    (await q<PlaceRow>(`select ${PLACE_COLS} from user_places where user_id = $1 order by created_at`, [req.user!.userId])).map(placeOut),
  );
  app.post('/v1/me/places', { preHandler: requireUser }, async (req) => {
    const b = parse(placeBody, req.body);
    const n = await one<{ n: number }>('select count(*)::int n from user_places where user_id = $1', [req.user!.userId]);
    if ((n?.n ?? 0) >= MAX_PLACES) throw new ApiError('conflict', `You can save up to ${MAX_PLACES} locations. Delete one first.`);
    const r = await one<PlaceRow>(
      `insert into user_places (user_id, label, name, city, address, lat, lng) values ($1,$2,$3,$4,$5,$6,$7) returning ${PLACE_COLS}`,
      [req.user!.userId, b.label, b.name, b.city, b.address, round3(b.lat), round3(b.lng)],
    );
    return placeOut(r!);
  });
  app.put('/v1/me/places/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(placeBody, req.body);
    const r = await one<PlaceRow>(
      `update user_places set label = $3, name = $4, city = $5, address = $6, lat = $7, lng = $8, updated_at = now()
        where id = $1 and user_id = $2 returning ${PLACE_COLS}`,
      [id, req.user!.userId, b.label, b.name, b.city, b.address, round3(b.lat), round3(b.lng)],
    );
    if (!r) throw new ApiError('not_found', 'Location not found.');
    return placeOut(r);
  });
  app.delete('/v1/me/places/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await q('delete from user_places where id = $1 and user_id = $2', [id, req.user!.userId]);
    return { ok: true };
  });

  app.get('/v1/me/bookings', { preHandler: requireUser }, async (req) => {
    const p = parse(
      z.object({
        filter: z.enum(['all', 'open', 'closed']).default('all'),
        cursor: z.coerce.number().int().min(0).max(5000).optional(),
        limit: z.coerce.number().int().min(1).max(30).optional(),
      }),
      req.query,
    );
    // Without `limit`: the old full list (older app builds).
    return p.limit ? bookings.pageBookings(req.user!.userId, p.filter, p.cursor ?? 0, p.limit) : bookings.listBookings(req.user!.userId);
  });
  // ── Push: this phone's Expo push token (one per device, tied to this login) ──
  app.put('/v1/me/push-token', { preHandler: requireUser }, async (req) => {
    const b = parse(z.object({ token: z.string().max(200).refine(isExpoToken, 'Not a push token.'), platform: z.enum(['ios', 'android']) }), req.body);
    await q(
      `insert into push_tokens (token, user_id, session_id, platform) values ($1, $2, $3, $4)
       on conflict (token) do update set user_id = excluded.user_id, session_id = excluded.session_id,
         platform = excluded.platform, updated_at = now()`,
      [b.token, req.user!.userId, req.user!.sessionId, b.platform],
    );
    return { ok: true };
  });
  app.delete('/v1/me/push-token', { preHandler: requireUser }, async (req) => {
    const b = parse(z.object({ token: z.string().max(200) }), req.body ?? {});
    await q('delete from push_tokens where token = $1 and user_id = $2', [b.token, req.user!.userId]);
    return { ok: true };
  });
  if (config.PUSH_DRY_RUN && config.NODE_ENV !== 'production') {
    app.get('/v1/test/pushes', async () => {
      await kickPush();
      return { sent: sentForTests };
    });
  }

  app.get('/v1/me/notifications', { preHandler: requireUser }, async (req) => {
    const rows = await q<{ id: string; kind: string; title: string; body: string; read_at: Date | null; created_at: Date; data: Record<string, unknown> | null }>(
      'select id, kind, title, body, read_at, created_at, data from notifications where user_id = $1 order by created_at desc limit 50',
      [req.user!.userId],
    );
    return rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, read: !!n.read_at, at: new Date(n.created_at).getTime(), data: n.data ?? undefined }));
  });
  app.get('/v1/me/requests', { preHandler: requireUser }, async (req) => {
    const rows = await q<{ id: string; kind: string; venue_name: string; area: string; day: string; start_min: number; end_min: number; spots_total: number; spots_filled: number; share: number; status: string }>(
      `select r.id, 'posted' kind, v.name venue_name, v.area, b.day::text, b.start_min, b.end_min, r.spots_total, r.spots_filled, r.share, r.status
         from player_requests r join bookings b on b.id = r.booking_id join venues v on v.id = b.venue_id where r.user_id = $1
       union all
       select r.id, 'joined', v.name, v.area, b.day::text, b.start_min, b.end_min, r.spots_total, r.spots_filled, r.share, m.status
         from player_request_members m join player_requests r on r.id = m.request_id join bookings b on b.id = r.booking_id join venues v on v.id = b.venue_id
        where m.user_id = $1
       order by day desc limit 100`,
      [req.user!.userId],
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, venueName: r.venue_name, area: r.area, day: r.day, start: r.start_min, end: r.end_min, spotsTotal: r.spots_total, spotsFilled: r.spots_filled, sharePerPlayer: r.share, status: r.status }));
  });

  // ── Find players (matches) ────────────────────────────────────────────────
  const matchId = (req: FastifyRequest) => parse(z.object({ id: z.string().uuid() }), req.params).id;
  const level = z.enum(['casual', 'regular', 'competitive']);
  app.get('/v1/matches', { preHandler: optionalUser }, async (req) => {
    const p = parse(
      z.object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        nearby: z.enum(['true', 'false']).optional(),
        day: z.string().refine(isDayKey, 'Invalid date.').optional(),
        cursor: z.coerce.number().int().min(0).max(10_000).optional(),
        limit: z.coerce.number().int().min(1).max(20).optional(),
      }),
      req.query,
    );
    return matches.feed(req.user?.userId ?? null, { ...p, nearby: p.nearby === 'true' });
  });
  // Explicit agreement to share your phone number in a squad (organiser ⇄ paid players only).
  const sharePhone = z.literal(true, { message: 'Agree to share your phone number to continue.' });
  app.get('/v1/matches/:id', { preHandler: optionalUser }, async (req) => matches.getMatch(req.user?.userId ?? null, matchId(req)));
  app.post('/v1/matches', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) =>
    matches.createMatch(
      req.user!.userId,
      parse(z.object({ bookingId: z.string().uuid(), title: z.string().trim().min(2).max(60).optional(), level, openSpots: z.number().int().min(1).max(29), sharePhone, contactPhone: phone10.optional() }), req.body),
    ),
  );
  app.get('/v1/matches/joined', { preHandler: requireUser }, async (req) => matches.joined(req.user!.userId));
  app.get('/v1/matches/mine', { preHandler: requireUser }, async (req) => matches.mine(req.user!.userId));
  app.get('/v1/matches/:id/manage', { preHandler: requireUser }, async (req) => matches.manage(req.user!.userId, matchId(req)));
  app.patch('/v1/matches/:id', { preHandler: requireUser }, async (req) =>
    matches.updateMatch(req.user!.userId, matchId(req), parse(z.object({ title: z.string().trim().min(2).max(60).optional(), paused: z.boolean().optional() }), req.body)),
  );
  app.post('/v1/matches/:id/requests/:userId/:decision', { preHandler: requireUser }, async (req) => {
    const { userId, decision } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid(), decision: z.enum(['accept', 'decline']) }), req.params);
    return matches.decide(req.user!.userId, matchId(req), userId, decision === 'accept');
  });
  app.post('/v1/matches/:id/join', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) =>
    matches.requestToJoin(
      req.user!.userId,
      matchId(req),
      parse(z.object({ position: z.enum(['any', 'goalkeeper', 'defender', 'midfielder', 'forward']).default('any'), level: level.default('casual'), spots: z.number().int().min(1).max(29).default(1), sharePhone, contactPhone: phone10.optional() }), req.body ?? {}),
    ),
  );
  app.delete('/v1/matches/:id/join', { preHandler: requireUser }, async (req) => matches.withdraw(req.user!.userId, matchId(req)));
  app.post('/v1/matches/:id/pay', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) => {
    const { returnUrl } = parse(z.object({ returnUrl: z.string().max(300).optional() }), req.body ?? {});
    return payments.startSharePayment(req.user!.userId, matchId(req), idem(req) ?? '', returnUrl);
  });

  // ── Holds & checkout ──────────────────────────────────────────────────────
  app.post('/v1/holds', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) => {
    // One cart per player: a new selection replaces the old cart. `slotId` (single) is still accepted.
    const body = parse(
      z.union([
        z.object({ slotIds: z.array(z.string().max(80)).min(1).max(bookings.MAX_SLOTS_PER_ORDER) }),
        z.object({ slotId: z.string().max(80) }),
      ]),
      req.body,
    );
    const ids = 'slotIds' in body ? body.slotIds : [body.slotId];
    return bookings.remembered(idem(req), req.user!.userId, 'hold', () => bookings.createHold(req.user!.userId, ids));
  });
  app.get('/v1/holds/:id', { preHandler: requireUser }, async (req) => bookings.getHold(req.user!.userId, (req.params as { id: string }).id));
  /** Leaving checkout without paying frees the slots for everyone straight away. */
  app.delete('/v1/holds/:id/slots/:slotId', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) => {
    const { id, slotId } = req.params as { id: string; slotId: string };
    return bookings.removeHoldSlot(req.user!.userId, id, slotId);
  });
  app.delete('/v1/holds/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return bookings.releaseHold(req.user!.userId, id);
  });
  app.get('/v1/me/holds', { preHandler: requireUser }, async (req) => bookings.listHolds(req.user!.userId));

  app.post('/v1/payments', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: perSession } } }, async (req) => {
    const { holdId, returnUrl } = parse(z.object({ holdId: z.string().uuid(), returnUrl: z.string().max(300).optional() }), req.body);
    return payments.startPayment(req.user!.userId, holdId, idem(req) ?? '', returnUrl);
  });
  app.get('/v1/payments/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return payments.paymentStatus(req.user!.userId, id);
  });

  /** bKash redirects the user's browser here. We verify server-side, then hand back to the app. */
  const backToApp = async (reply: FastifyReply, paymentId: string, status: string) => {
    const r = await one<{ url: string | null }>("select last_response->>'returnUrl' url from payments where id = $1", [paymentId]).catch(() => null);
    const base = payments.safeReturnUrl(r?.url ?? undefined) ?? `${config.APP_SCHEME}://payment-return`;
    const sep = base.includes('?') ? '&' : '?';
    return reply.redirect(`${base}${sep}paymentId=${encodeURIComponent(paymentId)}&status=${encodeURIComponent(status)}`, 302);
  };

  app.get('/v1/payments/bkash/callback', async (req, reply) => {
    const { paymentID, status } = parse(z.object({ paymentID: z.string().max(100), status: z.enum(['success', 'failure', 'cancel']) }), req.query);
    const p = await one<{ id: string }>('select id from payments where provider_payment_id = $1', [paymentID]);
    if (!p) throw new ApiError('not_found', 'Payment not found.');
    if (status !== 'success') {
      await payments.abandon(p.id, status === 'cancel' ? 'cancelled' : 'failed');
      return backToApp(reply, p.id, status);
    }
    // The query-string "success" is NOT trusted: finalize() executes & verifies with bKash.
    const r = await payments.finalize(p.id).catch(() => ({ status: 'pending' }));
    return backToApp(reply, p.id, r.status);
  });

  if (isSimulated()) {
    // Fake checkout page for end-to-end testing without bKash credentials. Disabled in production.
    app.get('/v1/payments/simulate/:id', async (req, reply) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const p = await one<{ amount: number; status: string }>('select amount, status from payments where id = $1', [id]);
      if (!p) throw new ApiError('not_found', 'Payment not found.');
      // form-action must also allow the app schemes: browsers apply it to the redirect after submit.
      reply.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${config.APP_SCHEME}: exp: exps:`).type('text/html');
      return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated bKash</title>
<body style="font-family:system-ui;background:#FFF1F7;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" style="background:#fff;padding:28px;border-radius:24px;text-align:center;max-width:320px">
<h2 style="color:#E2136E;margin:0 0 6px">bKash (simulated)</h2><p>Test payment of <b>৳${(p.amount / 100).toLocaleString('en-IN')}</b>. No real money moves.</p>
<button name="action" value="pay" style="background:#E2136E;color:#fff;border:0;border-radius:999px;padding:14px 28px;font-size:16px">Pay</button>
<button name="action" value="cancel" style="background:none;border:0;margin-left:8px;font-size:16px">Cancel</button></form></body>`;
    });
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
    app.post('/v1/payments/simulate/:id', async (req, reply) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const { action } = parse(z.object({ action: z.enum(['pay', 'cancel']) }), req.body);
      if (action === 'cancel') {
        await payments.abandon(id, 'cancelled');
        return backToApp(reply, id, 'cancel');
      }
      await q("update payments set last_response = coalesce(last_response, '{}'::jsonb) || '{\"simApproved\": true}'::jsonb where id = $1 and status = 'pending'", [id]);
      const r = await payments.finalize(id);
      return backToApp(reply, id, r.status);
    });
  }

  // ── Bookings ──────────────────────────────────────────────────────────────
  app.get('/v1/bookings/:id', { preHandler: requireUser }, async (req) => bookings.getBooking(req.user!.userId, (req.params as { id: string }).id));
  app.post('/v1/bookings/:id/cancel', { preHandler: requireUser }, async (req) => bookings.cancelBooking(req.user!.userId, (req.params as { id: string }).id));

  /**
   * Owner scanner (admin app). A pass is checked against the database every time: the QR's
   * signature proves it's ours, the booking row says whether it's still good (cancelled,
   * already used, another venue's). verify = show the ticket; check-in = admit the player.
   */
  const passLookup = async (token: string, ownerId: string) => {
    const pass = verifyAnyPass(token);
    if (!pass) throw new ApiError('invalid', 'This pass is not valid or has expired.');
    const where = 'bookingId' in pass ? 'b.id = $1' : 'b.code = $1';
    const b = await one<{ id: string; code: string; status: string; day: string; start_min: number; end_min: number; total: number; venue_id: string; owner_id: string; name: string; phone: string }>(
      `select b.id, b.code, b.status, b.day::text, b.start_min, b.end_min, b.total, b.venue_id, v.owner_id, u.name, u.phone
         from bookings b join venues v on v.id = b.venue_id left join users u on u.id = b.user_id where ${where}`,
      ['bookingId' in pass ? pass.bookingId : pass.code],
    );
    if (!b || b.owner_id !== ownerId) throw new ApiError('forbidden', 'This pass is for another venue.');
    return { b, ticket: 'ticket' in pass ? pass.ticket : null };
  };
  const passView = (b: { id: string; code: string; status: string; day: string; start_min: number; end_min: number; total: number; venue_id: string; name: string; phone: string }) => ({
    bookingId: b.id,
    code: b.code,
    status: b.status, // confirmed = can check in; checked_in = already used; cancelled/expired = refuse
    venueId: b.venue_id,
    day: b.day,
    start: b.start_min,
    end: b.end_min,
    paid: b.total,
    holder: { name: b.name, phone: b.phone },
  });
  const ownerOnly = (roles: string[]) => {
    if (!roles.includes('owner')) throw new ApiError('forbidden', 'Only venue owners can scan passes.');
  };
  const tokenBody = z.object({ token: z.string().max(1200) });

  app.post('/v1/passes/verify', { preHandler: requireUser }, async (req) => {
    ownerOnly(req.user!.roles);
    const { b, ticket } = await passLookup(parse(tokenBody, req.body).token, req.user!.userId);
    return { ok: b.status === 'confirmed', booking: passView(b), ticket };
  });

  app.post('/v1/passes/check-in', { preHandler: requireUser }, async (req) => {
    ownerOnly(req.user!.roles);
    const { b, ticket } = await passLookup(parse(tokenBody, req.body).token, req.user!.userId);
    // One pass admits its whole ticket: every back-to-back slot it covers (not other tickets).
    const ids = await bookings.ticketBookingIds(b.id);
    const done = await one<{ n: number }>(
      `with u as (update bookings set status = 'checked_in' where id = any($1::uuid[]) and status = 'confirmed' returning 1)
       select count(*)::int n from u`,
      [ids],
    );
    if (!done?.n) throw new ApiError('conflict', b.status === 'checked_in' ? 'This pass was already used.' : 'This booking is cancelled or no longer valid.');
    return { ok: true, code: b.code, booking: passView({ ...b, status: 'checked_in' }), ticket };
  });

  // ── Internal jobs (called by Supabase pg_cron + pg_net every minute) ───────
  app.post('/internal/reconcile', async (req) => {
    const secret = req.headers['x-cron-secret'];
    if (!config.CRON_SECRET || typeof secret !== 'string' || !safeEqual(secret, config.CRON_SECRET)) throw new ApiError('unauthorized', 'Unauthorized.');
    const out = await payments.reconcile();
    await kickPush(); // anything that piled up while the process was asleep
    return out;
  });

  app.get('/v1/config', async () => ({
    paymentsEnabled: bkashEnabled(),
    horizonDays: config.BOOKING_HORIZON_DAYS,
    horizonEnd: addDays(dhakaToday(), config.BOOKING_HORIZON_DAYS),
    // Public realtime settings: the anon key can only read slot_updates (see migration 003).
    realtime: config.SUPABASE_URL && config.SUPABASE_ANON_KEY ? { url: config.SUPABASE_URL, anonKey: config.SUPABASE_ANON_KEY, table: 'slot_updates', matchTable: 'match_updates' } : null,
  }));

  return app;
}
