import { cacheDel, cached } from '../cache';
import { one, q } from '../db';
import { ApiError } from '../errors';
import { invalidateVenue } from './venues';

/**
 * Reviews: only from players who booked (or paid into a squad at) the turf and whose game
 * has finished. One per player per turf; writing again edits it. The turf's rating and
 * count are recalculated in the database on every change (migration 016).
 */
type Item = { id: string; author: string; rating: number; at: number; text: string };

const publicKey = (venueId: string) => `reviews:v2:${venueId}`;

/** The public part (cached briefly; dropped on every write). */
export async function publicReviews(venueId: string) {
  return cached(publicKey(venueId), 3600, async () => {
    const [agg, hist, items] = await Promise.all([
      one<{ average: string | null; count: number }>('select round(avg(rating)::numeric, 1) average, count(*)::int count from reviews where venue_id = $1', [venueId]),
      q<{ rating: number; n: number }>('select rating, count(*)::int n from reviews where venue_id = $1 group by rating', [venueId]),
      q<{ id: string; author_name: string; rating: number; created_at: Date; updated_at: Date; body: string }>(
        'select id, author_name, rating, created_at, updated_at, body from reviews where venue_id = $1 order by updated_at desc limit 30',
        [venueId],
      ),
    ]);
    const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    hist.forEach((h) => (histogram[h.rating as 1 | 2 | 3 | 4 | 5] = h.n));
    return {
      average: Number(agg?.average ?? 0),
      count: agg?.count ?? 0,
      histogram,
      items: items.map<Item>((r) => ({ id: r.id, author: r.author_name, rating: r.rating, at: new Date(r.updated_at).getTime(), text: r.body })),
    };
  }, 120);
}

/** The latest finished game this player had at the turf (own booking or a paid squad spot). */
async function playedBooking(userId: string, venueId: string) {
  return one<{ id: string }>(
    `select b.id from bookings b
      where b.venue_id = $2 and upper(b.during) < now() and b.status in ('confirmed', 'checked_in', 'completed')
        and (b.user_id = $1 or exists (
          select 1 from player_requests r join player_request_members m on m.request_id = r.id
           where r.booking_id = b.id and m.user_id = $1 and m.status = 'paid'))
      order by upper(b.during) desc limit 1`,
    [userId, venueId],
  );
}

/** For the signed-in player: can they review, and their own review if they wrote one. */
export async function myReviewState(userId: string, venueId: string) {
  const [mine, played] = await Promise.all([
    one<{ id: string; rating: number; body: string; updated_at: Date }>('select id, rating, body, updated_at from reviews where venue_id = $1 and user_id = $2', [venueId, userId]),
    playedBooking(userId, venueId),
  ]);
  return {
    canReview: !!played || !!mine,
    mine: mine ? { id: mine.id, rating: mine.rating, text: mine.body, at: new Date(mine.updated_at).getTime() } : null,
  };
}

/** Write or edit your review. */
export async function saveReview(userId: string, venueId: string, input: { rating: number; text: string }) {
  const existing = await one<{ id: string }>('select id from reviews where venue_id = $1 and user_id = $2', [venueId, userId]);
  const played = existing ? null : await playedBooking(userId, venueId);
  if (!existing && !played) throw new ApiError('forbidden', 'You can review a turf after you’ve played there.');
  const u = await one<{ name: string }>('select name from users where id = $1 and deleted_at is null', [userId]);
  if (!u) throw new ApiError('unauthorized', 'Sign in again.');
  // First name + initial: friendly, and not a full name on a public page.
  const parts = u.name.trim().split(/\s+/);
  const author = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0]!;
  if (existing) {
    await q('update reviews set rating = $2, body = $3, author_name = $4, updated_at = now() where id = $1', [existing.id, input.rating, input.text, author]);
  } else {
    await q(
      `insert into reviews (venue_id, user_id, booking_id, author_name, rating, body) values ($1, $2, $3, $4, $5, $6)
       on conflict (venue_id, user_id) where user_id is not null
       do update set rating = excluded.rating, body = excluded.body, author_name = excluded.author_name, updated_at = now()`,
      [venueId, userId, played!.id, author, input.rating, input.text],
    );
  }
  await Promise.all([cacheDel(publicKey(venueId)), invalidateVenue(venueId)]); // list + turf rating
  return myReviewState(userId, venueId);
}

/** Remove your review. */
export async function deleteReview(userId: string, venueId: string) {
  await q('delete from reviews where venue_id = $1 and user_id = $2', [venueId, userId]);
  await Promise.all([cacheDel(publicKey(venueId)), invalidateVenue(venueId)]);
  return { ok: true };
}
