import type { Poisha } from '@/lib/money';
import type { DayKey } from '@/lib/time';

/**
 * API contracts — these mirror the TurfSides server responses (server/src).
 * The app never sends prices or totals to the server — only ids — and never
 * treats anything other than a server-verified payment as a confirmed booking.
 */
export type PitchFormat = '5-a-side' | '6-a-side' | '7-a-side';

export type VenueSummary = {
  id: string;
  name: string;
  area: string;
  city: string;
  distanceKm: number | null;
  rating: number;
  reviewCount: number;
  formats: PitchFormat[];
  floodlit: boolean;
  hourlyFrom: Poisha;
  availableToday: boolean;
  photo: string | null; // absolute URL served by the API
  isSaved: boolean;
  /** The owner paused new bookings (missing from older APIs = not paused). */
  bookingPaused?: boolean;
};

export type VenueDetail = VenueSummary & {
  address: string;
  latitude: number;
  longitude: number;
  photos: (string | null)[];
  amenities: string[];
  rules: string[];
  about: string;
  shortAddress: string;
  openingHours: string;
  sessionLengthMin: number;
  cancellationPolicy: string;
  /** Set while the owner has paused bookings: why, in the owner's words. */
  bookingNotice?: string | null;
  /** "TS-5356": the turf's public reference number. Older servers omit it. */
  ref?: string | null;
  /** turfsides.com/FDJV346: the turf's share link (opens the app when installed). */
  shareUrl?: string | null;
  shortCode?: string | null;
};

export type Review = { id: string; author: string; rating: number; at: number; text: string };
/** `canReview`: signed in, played here, not reviewed yet. `mine`: your own review (final once posted). */
export type MyReview = { id: string; rating: number; text: string; at: number };
export type ReviewSummary = {
  average: number;
  count: number;
  histogram: Record<1 | 2 | 3 | 4 | 5, number>;
  items: Review[];
  canReview?: boolean;
  mine?: MyReview | null;
};

/** held = another player is checking out (up to 5 min); mine = your own hold, resumable via holdId. */
export type SlotStatus = 'available' | 'booked' | 'blocked' | 'held' | 'mine';
/** A booked slot whose organiser is recruiting players: `spotsLeft` free to request. */
/** `opponent`: the organiser is looking for a whole opposing team (not single players). */
export type SlotSquad = { id: string; spotsLeft: number; host?: boolean; opponent?: boolean };
export type Slot = { id: string; start: number; end: number; price: Poisha; status: SlotStatus; holdId?: string; squad?: SlotSquad };
export type DaySlots = { venueId: string; day: DayKey; slots: Slot[]; fetchedAt: number };

export type QuoteLine = { label: string; detail?: string; amount: Poisha };
export type Hold = {
  holdId: string;
  expiresAt: number;
  venue: Pick<VenueDetail, 'id' | 'name' | 'area' | 'city' | 'photo' | 'formats'>;
  /** Every slot in this order (one turf, possibly several days). Older servers omit it. */
  slots?: { id: string; day: DayKey; start: number; end: number; price?: Poisha }[];
  /** First slot (kept for older code paths). */
  day: DayKey;
  start: number;
  end: number;
  lines: QuoteLine[];
  total: Poisha;
  cancellationPolicy: string;
};

export type BookingStatus = 'confirmed' | 'checked_in' | 'completed' | 'cancelled';
/** Another ticket bought in the same payment. */
export type OtherTicket = { id: string; code: string; day: DayKey; start: number; end: number; status: BookingStatus };

export type Booking = {
  id: string;
  code: string; // human code shown at reception
  venue: Pick<VenueDetail, 'id' | 'name' | 'area' | 'city' | 'photo' | 'formats' | 'latitude' | 'longitude'>;
  day: DayKey;
  start: number;
  end: number;
  amountPaid: Poisha;
  method: 'bKash';
  status: BookingStatus;
  /** Opaque signed token issued by the server; the QR encodes this, never raw ids. */
  passToken: string;
  /** Open spots posted on this booking (detail only). */
  matchId?: string | null;
  /** Booked slots this ticket covers: back-to-back slots bought together merge into one ticket. */
  slotCount?: number;
  /** Other tickets from the same payment (slots that weren't back to back). */
  otherTickets?: OtherTicket[];
  /** The customer's note to the turf, added at checkout. */
  note?: string | null;
};
export type BookingFilter = 'all' | 'open' | 'closed';
export type BookingPage = { items: Booking[]; next: Booking | null; nextCursor: number | null };

export type ExploreParams = {
  lat: number;
  lng: number;
  day: DayKey;
  format: PitchFormat | 'any';
  floodlitOnly?: boolean;
  query?: string;
  /** Fixed search radius from the distance slider (km). */
  radiusKm?: number;
};

export type ExploreResult = {
  radiusKm: number;
  near: VenueSummary[]; // within the first radius step
  further: VenueSummary[];
  /** Paged requests only: where the next page starts (null = no more). */
  nextCursor?: number | null;
  total?: number;
};

export type User = { id: string; name: string; phone: string; email?: string; roles: ('player' | 'owner')[]; avatarUrl?: string | null };

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  at: number;
  kind: 'booking' | 'payment' | 'promo' | 'match';
  read: boolean;
  /** Where tapping it should go (e.g. { type: 'match_accepted', matchId }). */
  data?: { type?: string; matchId?: string };
  /** Paging position: pass the last item's cursor as `before` to get the next page. */
  cursor?: string;
};

// ---- find players -----------------------------------------------------------
export type MatchLevel = 'casual' | 'regular' | 'competitive';
export type MatchPosition = 'any' | 'goalkeeper' | 'defender' | 'midfielder' | 'forward';
/** The viewer's relation to a match. */
export type MatchMine = 'owner' | 'none' | 'pending' | 'accepted' | 'paid' | 'declined' | 'withdrawn' | 'expired';

/** Open spots on a booking the organiser has already paid for. Prices are set by the server. */
export type Match = {
  id: string;
  title: string;
  level: MatchLevel;
  format: string;
  status: 'open' | 'paused' | 'full' | 'closed' | 'cancelled';
  venue: { id: string; name: string; area: string; photo: string | null; city?: string; latitude?: number | null; longitude?: number | null };
  day: DayKey;
  start: number;
  end: number;
  playersTotal: number;
  playersIn: number;
  openSpots: number;
  /** Spots still free for new requests (open minus paid minus reserved). */
  spotsLeft: number;
  /** Price per player (poisha). */
  share: Poisha;
  faces: { name: string; avatar: string | null }[];
  moreCount: number;
  my: MatchMine;
  /** Spots the viewer asked for / holds / paid for (1 = just them). */
  mySpots?: number;
  /** Accepted, not yet paid: pay before this (ms). */
  payBy: number | null;
  /** When the next held (unpaid) spot is released back to everyone (ms). */
  reservedUntil?: number | null;
  /** Paid players only: the organiser's entry pass (same code and QR as their ticket). */
  pass?: { code: string; passToken: string } | null;
  /** Paid players only: the organiser's contact (they agreed when opening spots). */
  host?: { name: string; phone: string };
  /** 'players': open spots for individuals. 'opponent': looking for one whole team. Older servers omit it. */
  type?: MatchType;
  /** Opponent posts: the host's team name. */
  teamName?: string;
  /** Opponent posts: the share of the turf the opposing team pays (percent). */
  opponentPercent?: number;
  /** Opponent posts: the team that paid and will play (null until then). */
  opponent?: { teamName: string; size: number | null } | null;
};
export type MatchType = 'players' | 'opponent';
/** On opponent posts the person is the captain of `teamName` (`teamSize` players). */
export type MatchPerson = { userId: string; name: string; avatar: string | null; position: MatchPosition; level: MatchLevel; games: number; spots?: number; teamName?: string; teamSize?: number | null };
export type MatchManage = Match & {
  booking: { id: string; code: string };
  requests: MatchPerson[];
  /** `phone`: only for players who have paid (and agreed to share it); never shown to other players. */
  squad: (MatchPerson & { paid: boolean; payBy: number | null; phone?: string })[];
};
/** Find players (organiser): your matches, and paid bookings that could still take players. */
export type MyMatches = {
  matches: Match[];
  bookings: { id: string; venue: { id: string; name: string; area: string; photo: string | null }; format: string; day: DayKey; start: number; end: number; amountPaid: Poisha }[];
};
export type Page<T> = { items: T[]; nextCursor: number | null };
export type MatchFeedParams = { lat?: number; lng?: number; nearby: boolean; day?: DayKey; type?: MatchType };

export type ApiErrorCode =
  | 'slot_taken'
  | 'hold_expired'
  | 'payment_failed'
  | 'not_found'
  | 'invalid'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'not_configured'
  | 'internal';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    /** The form field it's about (e.g. 'email'), when the server says. */
    public field?: string,
  ) {
    super(message);
  }
}

/** "Find players" request posted on a booking, or one the user asked to join. */
export type PlayerRequest = {
  id: string;
  kind: 'posted' | 'joined';
  venueName: string;
  area: string;
  day: DayKey;
  start: number;
  end: number;
  spotsTotal: number;
  spotsFilled: number;
  sharePerPlayer: Poisha;
  status: 'open' | 'full' | 'pending' | 'accepted' | 'declined';
};

/** Returned by sign-in, sign-up verification, password reset and token refresh. */
export type AuthResult = { user: User; accessToken: string; refreshToken: string };

/** Returned when the server texts a code. `devCode` is only sent by non-production servers. */
/** A code went out: where (email via Sender, SMS) and, for email, the masked address. */
export type CodeSent = { sent: true; devCode?: string; channels?: ('email' | 'sms')[]; email?: string };
/** Sign-in step 1 passed (password right): a code went to the account's email. */
export type LoginChallenge = CodeSent & { otpRequired: true; challenge: string };

export type AppConfig = {
  paymentsEnabled: boolean;
  horizonDays: number;
  horizonEnd: DayKey;
  realtime: { url: string; anonKey: string; table: string; matchTable?: string } | null;
};

/** A location the player saved ("Home", "Work", …). Coordinates are rounded to ~100 m. */
export type SavedPlace = {
  id: string;
  label: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  createdAt: number;
};
export type SavedPlaceInput = Omit<SavedPlace, 'id' | 'createdAt'>;

/** A short-lived signed upload to Cloudflare R2. Send exactly these headers with the PUT. */
export type UploadTicket = { key: string; uploadUrl: string; headers: Record<string, string>; expiresAt: number };
