import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../errors';
import { sendWalkinTicket } from '../services/booking-emails';
import * as dash from '../services/owner-dash';
import * as payouts from '../services/payouts';
import { ticketForOwner } from '../services/tickets';
import { qrSvgMarkup } from '../lib/ticket-pdf';
import { resolveLocation } from '../services/geo';

/**
 * Owner dashboard routes (/v1/owner/*, plus the public tournaments list). Registered from
 * app.ts with its own guard and parser so this module has no say over player routes.
 * Each owner query is scoped to the signed-in owner's own turfs inside the service.
 */
type Helpers = {
  requireOwner: (req: FastifyRequest) => Promise<void>;
  parse: <T extends z.ZodType>(schema: T, data: unknown) => z.infer<T>;
};

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, 'Not found.');
const venueParam = z.object({ id: z.string().regex(/^v_[A-Za-z0-9_]{1,40}$/, 'Unknown turf.') });

export function registerOwnerRoutes(app: FastifyInstance, { requireOwner, parse }: Helpers) {
  const owner = { preHandler: requireOwner };
  // Writes: generous for a person clicking around, tight enough to stop a runaway script.
  const write = { preHandler: requireOwner, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  // Map picker: a pasted Google Maps link (or coordinates) → the exact point. No Google API.
  app.post('/v1/owner/geo/resolve', { preHandler: requireOwner, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    resolveLocation(parse(z.object({ text: z.string().trim().min(3).max(2000) }), req.body).text),
  );
  const me = (req: FastifyRequest) => req.user!.userId;
  const id = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;

  // Overview
  app.get('/v1/owner/stats', owner, async (req) => dash.stats(me(req), parse(dash.statsQuery, req.query)));
  app.get('/v1/owner/calendar', owner, async (req) => {
    const p = parse(z.object({ venueId: z.string().max(60).optional(), month: z.string().max(7) }), req.query);
    return dash.calendar(me(req), p.venueId, p.month);
  });

  // Earnings and payouts (amounts in poisha). Balance is for all the owner's turfs.
  app.get('/v1/owner/earnings', owner, async (req) => {
    const f = parse(payouts.earningsQuery, req.query);
    return payouts.ownerEarnings(me(req), f, await dash.venueScope(me(req), f.venueId));
  });
  app.get('/v1/owner/earnings/entries', owner, async (req) => payouts.ownerEntries(me(req), parse(payouts.entriesQuery, req.query)));
  app.get('/v1/owner/payouts', owner, async (req) => payouts.ownerPayouts(me(req), parse(payouts.listQuery, req.query)));
  app.get('/v1/owner/payouts/:id', owner, async (req) => payouts.ownerPayout(me(req), id(req)));

  // Bookings
  app.get('/v1/owner/bookings', owner, async (req) => dash.listBookings(me(req), parse(dash.bookingQuery, req.query)));
  app.get('/v1/owner/bookings/:id', owner, async (req) => dash.getBooking(me(req), id(req)));
  app.post('/v1/owner/bookings', write, async (req) => dash.createWalkin(me(req), parse(dash.walkinInput, req.body)));
  // Edit a booking the owner added (walk-in / phone). App bookings can't be edited.
  app.patch('/v1/owner/bookings/:id', write, async (req) => dash.updateWalkin(me(req), id(req), parse(dash.walkinEditInput, req.body)));
  app.post('/v1/owner/bookings/:id/cancel', write, async (req) =>
    dash.cancelBooking(me(req), id(req), parse(z.object({ reason: z.string().trim().max(200).default('') }), req.body ?? {}).reason),
  );
  app.post('/v1/owner/bookings/:id/check-in', write, async (req) => dash.checkIn(me(req), id(req)));

  // A day's sessions with who has them (never cached: live, like player slots)
  app.get('/v1/owner/venues/:id/day', owner, async (req) => {
    const v = parse(venueParam, req.params).id;
    return dash.daySheet(me(req), v, parse(z.object({ day: dash.dayKey }), req.query).day);
  });

  // Closures
  app.get('/v1/owner/venues/:id/blocks', owner, async (req) => {
    const p = parse(z.object({ from: dash.dayKey, to: dash.dayKey }), req.query);
    return dash.listBlocks(me(req), parse(venueParam, req.params).id, p.from, p.to);
  });
  // A booking's ticket: the QR players show at reception (the same pass as their app) and the
  // ticket link. Walk-ins can have the ticket emailed again (e.g. after fixing the address).
  app.get('/v1/owner/bookings/:id/ticket', owner, async (req) => {
    const t = await ticketForOwner(me(req), id(req));
    return { code: t.code, status: t.status, url: t.url, email: t.email, pass: t.pass || null, qrSvg: t.pass ? qrSvgMarkup(t.pass, 240) : null };
  });
  app.post('/v1/owner/bookings/:id/ticket/send', { preHandler: requireOwner, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const t = await ticketForOwner(me(req), id(req));
    if (t.source !== 'walkin') throw new ApiError('forbidden', 'App bookings already have their ticket in the player’s app.');
    if (!t.pass) throw new ApiError('conflict', 'This booking has no valid ticket any more.');
    if (!t.email) throw new ApiError('invalid', 'Add the customer’s email first (Edit).');
    const sent = await sendWalkinTicket([t.id]);
    if (!sent) throw new ApiError('internal', 'We couldn’t send the email. Try again in a moment.');
    return { sent: true, to: t.email };
  });
  app.post('/v1/owner/blocks', write, async (req) => dash.createBlocks(me(req), parse(dash.blockInput, req.body)));
  app.delete('/v1/owner/blocks/:id', write, async (req) => dash.deleteBlock(me(req), id(req)));

  // Reviews
  app.get('/v1/owner/reviews', owner, async (req) => {
    const p = parse(
      z.object({ venueId: z.string().max(60).optional(), cursor: z.coerce.number().int().min(0).max(100_000).default(0) }),
      req.query,
    );
    return dash.listReviews(me(req), p.venueId, p.cursor);
  });

  // Tournaments
  app.get('/v1/owner/tournaments', owner, async (req) =>
    dash.listTournaments(me(req), parse(z.object({ venueId: z.string().max(60).optional() }), req.query).venueId),
  );
  app.get('/v1/owner/tournaments/:id', owner, async (req) => dash.getTournament(me(req), id(req)));
  app.post('/v1/owner/tournaments', write, async (req) => dash.saveTournament(me(req), parse(dash.tournamentInput, req.body)));
  app.put('/v1/owner/tournaments/:id', write, async (req) => dash.saveTournament(me(req), parse(dash.tournamentInput, req.body), id(req)));
  app.delete('/v1/owner/tournaments/:id', write, async (req) => dash.deleteTournament(me(req), id(req)));
  app.post('/v1/owner/tournaments/:id/teams', write, async (req) => dash.saveTeam(me(req), id(req), parse(dash.teamInput, req.body)));
  app.put('/v1/owner/tournaments/:id/teams/:teamId', write, async (req) => {
    const p = parse(z.object({ id: uuid, teamId: uuid }), req.params);
    return dash.saveTeam(me(req), p.id, parse(dash.teamInput, req.body), p.teamId);
  });
  app.delete('/v1/owner/tournaments/:id/teams/:teamId', write, async (req) => {
    const p = parse(z.object({ id: uuid, teamId: uuid }), req.params);
    return dash.deleteTeam(me(req), p.id, p.teamId);
  });

  // Inbox
  app.get('/v1/owner/notifications', owner, async (req) => dash.notifications(me(req)));
  app.post('/v1/owner/notifications/seen', write, async (req) => dash.markNotificationsSeen(me(req)));

  // Public: a turf's upcoming tournaments (players; the app can show them later).
  app.get('/v1/venues/:id/tournaments', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) =>
    dash.publicTournaments(parse(venueParam, req.params).id),
  );
}
