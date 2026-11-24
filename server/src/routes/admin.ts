/**
 * TurfSides business dashboard API: owner payouts and commission. Every request needs the
 * X-Admin-Key header (ADMIN_API_KEY). Optional X-Admin-User names the staff member for the audit
 * log. Money is integer poisha everywhere.
 *
 *   GET  /v1/admin/finance/summary?from&to            platform totals (sales, commission, refunds, payouts, owed now)
 *   GET  /v1/admin/payouts/preview?cutoff&ownerId     what each owner is due before the cutoff (default: last Dhaka midnight)
 *   POST /v1/admin/payouts                            mark one owner paid { ownerId, cutoff?, expectedAmount?, reference?, method?, note? }
 *   POST /v1/admin/payouts/settle-all                 the nightly run: every owner with a positive balance { cutoff?, method?, note? }
 *   GET  /v1/admin/payouts?ownerId&status&from&to     payouts made
 *   GET  /v1/admin/payouts/:id                        one payout and the bookings in it
 *   POST /v1/admin/payouts/:id/void                   undo a payout { reason }: its earnings go back to pending
 *   GET  /v1/admin/owners/:id/balance                 an owner's pending, paid and lifetime totals
 *   GET  /v1/admin/earnings?ownerId&status&payoutId   booking-by-booking earnings
 *   GET  /v1/admin/commission                         commission rates (history)
 *   POST /v1/admin/commission                         set a rate { rateBp, ownerId?, effectiveFrom?, note? }
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { config } from '../config';
import { ApiError } from '../errors';
import * as payouts from '../services/payouts';

type Parse = <T extends z.ZodType>(schema: T, data: unknown) => z.infer<T>;
const digest = (s: string) => createHash('sha256').update(s).digest();

export function registerAdminRoutes(app: FastifyInstance, { parse }: { parse: Parse }) {
  const requireAdmin = async (req: FastifyRequest) => {
    if (!config.ADMIN_API_KEY) throw new ApiError('not_configured', 'The admin API is not set up on this server.');
    const key = req.headers['x-admin-key'];
    if (typeof key !== 'string' || !timingSafeEqual(digest(key), digest(config.ADMIN_API_KEY))) throw new ApiError('unauthorized', 'Admin key missing or wrong.');
  };
  const actor = (req: FastifyRequest) => {
    const who = req.headers['x-admin-user'];
    return `admin${typeof who === 'string' && who.trim() ? `:${who.trim().slice(0, 60)}` : ''}`;
  };
  const read = { preHandler: requireAdmin, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  const write = { preHandler: requireAdmin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const id = (req: FastifyRequest) => parse(z.object({ id: z.string().uuid('Not found.') }), req.params).id;

  app.get('/v1/admin/finance/summary', read, async (req) => payouts.adminSummary(parse(payouts.summaryQuery, req.query)));
  app.get('/v1/admin/payouts/preview', read, async (req) => payouts.previewPayouts(parse(payouts.previewQuery, req.query)));
  app.post('/v1/admin/payouts', write, async (req) => payouts.settle(parse(payouts.settleInput, req.body), actor(req)));
  app.post('/v1/admin/payouts/settle-all', write, async (req) => payouts.settleAll(parse(payouts.settleAllInput, req.body ?? {}), actor(req)));
  app.get('/v1/admin/payouts', read, async (req) => payouts.adminPayouts(parse(payouts.adminPayoutsQuery, req.query)));
  app.get('/v1/admin/payouts/:id', read, async (req) => payouts.adminPayout(id(req)));
  app.post('/v1/admin/payouts/:id/void', write, async (req) => payouts.voidPayout(id(req), parse(payouts.voidInput, req.body).reason, actor(req)));
  app.get('/v1/admin/owners/:id/balance', read, async (req) => payouts.adminOwnerBalance(id(req)));
  app.get('/v1/admin/earnings', read, async (req) => payouts.adminEntries(parse(payouts.adminEntriesQuery, req.query)));
  app.get('/v1/admin/commission', read, async () => payouts.listRates());
  app.post('/v1/admin/commission', write, async (req) => payouts.setRate(parse(payouts.rateInput, req.body), actor(req)));
}
