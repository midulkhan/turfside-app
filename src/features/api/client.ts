/**
 * TurfSides API client — every call goes to the live server (see http.ts).
 *
 * Security contract (enforced by the server, respected here):
 *  - Prices, fees and totals are computed by the server. The app sends ids only.
 *  - A booking is confirmed only after the server verifies the bKash payment.
 *    Redirects, deep links, screenshots or typed transaction IDs never confirm one.
 *  - Booking/payment requests carry an idempotency key, so retries are harmless.
 *  - Auth tokens live in SecureStore (Keychain/Keystore), never AsyncStorage.
 */
import type { DayKey } from '@/lib/time';

import { request } from './http';
import type { MatchType,
  AppConfig,
  AuthResult,
  Booking,
  BookingFilter,
  BookingPage,
  CodeSent,
  DaySlots,
  ExploreParams,
  ExploreResult,
  Hold,
  LoginChallenge,
  MyReview,
  Match,
  MatchFeedParams,
  MatchLevel,
  MatchManage,
  MyMatches,
  MatchPosition,
  NotificationItem,
  Page,
  PlayerRequest,
  SavedPlace,
  SavedPlaceInput,
  UploadTicket,
  ReviewSummary,
  User,
  VenueDetail,
  VenueSummary,
} from './types';

const enc = encodeURIComponent;

// ---- config -----------------------------------------------------------------
export const getConfig = (signal?: AbortSignal) => request<AppConfig>('GET', '/v1/config', { signal });

// ---- auth -------------------------------------------------------------------
/** The player app only creates player accounts; owners sign up in the owner app. */
export const signupStart = (b: { name: string; phone: string; email: string; password: string }) =>
  request<CodeSent>('POST', '/v1/auth/signup/start', { body: { ...b, role: 'player' } });

export const signupVerify = (phone: string, code: string) =>
  request<AuthResult>('POST', '/v1/auth/signup/verify', { body: { phone, code } });

/** Step 1: password. The server then emails a code (two-step sign-in). */
export const login = (identifier: string, password: string) =>
  request<LoginChallenge>('POST', '/v1/auth/login', { body: { identifier, password } });

/** Step 2: the emailed code opens the session. */
export const loginVerify = (challenge: string, code: string) =>
  request<AuthResult>('POST', '/v1/auth/login/verify', { body: { challenge, code } });

export const loginResend = (challenge: string) => request<LoginChallenge>('POST', '/v1/auth/login/resend', { body: { challenge } });

export const resetStart = (phone: string) => request<CodeSent>('POST', '/v1/auth/password/reset/start', { body: { phone } });

export const resetVerify = (phone: string, code: string, newPassword: string) =>
  request<AuthResult>('POST', '/v1/auth/password/reset/verify', { body: { phone, code, newPassword } });

/** This phone's Expo push token (server sends booking/squad news to it). */
export const registerPushToken = (token: string, platform: 'ios' | 'android') =>
  request<{ ok: true }>('PUT', '/v1/me/push-token', { auth: 'required', body: { token, platform } });

export const logout = () => request<{ ok: true }>('POST', '/v1/auth/logout', { auth: 'required', timeoutMs: 5000 });

export const me = (signal?: AbortSignal) => request<User>('GET', '/v1/me', { auth: 'required', signal });

// ---- venues -----------------------------------------------------------------
/** `page`: 10 at a time from `cursor` (omit for the old single response). */
export const explore = (p: ExploreParams, signal?: AbortSignal, page?: { cursor: number; limit: number }) =>
  request<ExploreResult>('GET', '/v1/venues/explore', {
    auth: 'optional',
    signal,
    query: {
      lat: p.lat,
      lng: p.lng,
      day: p.day,
      format: p.format,
      floodlit: p.floodlitOnly ? 'true' : undefined,
      q: p.query?.trim(),
      radius: p.radiusKm,
      cursor: page?.cursor,
      limit: page?.limit,
    },
  });

export const getVenue = (id: string, signal?: AbortSignal) =>
  request<VenueDetail>('GET', `/v1/venues/${enc(id)}`, { auth: 'optional', signal });

/** A share link's code (turfsides.com/FDJV346) → the turf it points to. */
export const getVenueByCode = (code: string, signal?: AbortSignal) =>
  request<{ id: string; name: string }>('GET', `/v1/venues/code/${enc(code)}`, { auth: 'optional', signal });

/** Any share link's code: a turf or a player/opponent request. */
export const getLink = (code: string, signal?: AbortSignal) =>
  request<{ kind: 'turf' | 'match'; id: string }>('GET', `/v1/links/${enc(code)}`, { auth: 'optional', signal });

/**
 * `after`: the database transaction a realtime event reported. The server answers from its
 * cache only if that cache already includes the change, otherwise straight from the database.
 * `true` (no transaction id known) always skips the cache.
 */
export const getSlots = (venueId: string, day: DayKey, signal?: AbortSignal, after?: string | true) =>
  request<DaySlots>('GET', `/v1/venues/${enc(venueId)}/slots`, {
    auth: 'optional',
    query: after === true ? { day, fresh: '1' } : after ? { day, v: after } : { day },
    signal,
  });

export const getReviews = (venueId: string, signal?: AbortSignal) =>
  request<ReviewSummary>('GET', `/v1/venues/${enc(venueId)}/reviews`, { auth: 'optional', signal });
/** Post your review, once (only after you've played there). */
export const saveReview = (venueId: string, b: { rating: number; text: string }) =>
  request<{ canReview: boolean; mine: MyReview | null }>('PUT', `/v1/venues/${enc(venueId)}/reviews/mine`, { auth: 'required', body: b });

export const getSaved = (signal?: AbortSignal) => request<VenueSummary[]>('GET', '/v1/me/saved', { auth: 'required', signal });

export const setSaved = (venueId: string, value: boolean) =>
  request<{ venueId: string; isSaved: boolean }>(value ? 'PUT' : 'DELETE', `/v1/me/saved/${enc(venueId)}`, { auth: 'required' });

// ---- checkout ---------------------------------------------------------------
/** Reserve slots for 5 minutes. The server re-checks availability atomically. */
/** Put slots (one turf) in the cart. Replaces any previous cart; its slots are freed at once. */
export const createHold = (slotIds: string | string[], idempotencyKey: string) =>
  request<Hold>('POST', '/v1/holds', { auth: 'required', body: { slotIds: Array.isArray(slotIds) ? slotIds : [slotIds] }, idempotencyKey });

export const getHold = (holdId: string, signal?: AbortSignal) =>
  request<Hold>('GET', `/v1/holds/${enc(holdId)}`, { auth: 'required', signal });

/** Give the slot back (leaving checkout without paying). Holds with a payment in progress are kept. */
export const releaseHold = (holdId: string) =>
  request<{ released: boolean }>('DELETE', `/v1/holds/${enc(holdId)}`, { auth: 'required', timeoutMs: 8000 });

/** Take one slot out of the cart. Removing the last one empties it (`released: true`). */
export const removeHoldSlot = (holdId: string, slotId: string) =>
  request<{ released: boolean; hold: Hold | null }>('DELETE', `/v1/holds/${enc(holdId)}/slots/${enc(slotId)}`, {
    auth: 'required',
    timeoutMs: 8000,
  });

/** Active holds: the cart. */
export const getMyHolds = (signal?: AbortSignal) => request<Hold[]>('GET', '/v1/me/holds', { auth: 'required', signal });

/**
 * Start a bKash payment for a hold. The server calls bKash "create payment" and
 * returns its checkout URL; the app opens it and then polls getPaymentStatus.
 * `returnUrl` is where the server sends the browser back to (validated server-side).
 */
/** `note`: the customer's note to the turf (up to 300 characters); the owner sees it with the booking. */
/** `mode`: 'partial' pays 500 tk per slot now and the rest at the turf. */
export const startPayment = (holdId: string, idempotencyKey: string, returnUrl?: string, note?: string, mode: 'full' | 'partial' = 'full') =>
  request<{ paymentId: string; checkoutUrl: string | null }>('POST', '/v1/payments', {
    auth: 'required',
    body: { holdId, returnUrl, mode, ...(note ? { note } : {}) },
    idempotencyKey,
    timeoutMs: 30_000,
  });

/** Ask the server to verify the payment with bKash. Idempotent; safe to poll. */
export const getPaymentStatus = (paymentId: string) =>
  request<{ status: 'pending' | 'confirmed' | 'failed'; bookingId?: string; kind?: 'share'; matchId?: string }>('GET', `/v1/payments/${enc(paymentId)}`, {
    auth: 'required',
    timeoutMs: 30_000,
  });

// ---- bookings ---------------------------------------------------------------
export const getBookings = (signal?: AbortSignal) => request<Booking[]>('GET', '/v1/me/bookings', { auth: 'required', signal });
export const getBookingPage = (filter: BookingFilter, cursor: number, signal?: AbortSignal) =>
  request<BookingPage>('GET', '/v1/me/bookings', { auth: 'required', signal, query: { filter, cursor, limit: PAGE } });

// ---- find players -----------------------------------------------------------
export const PAGE = 10;
export const getMatches = (p: MatchFeedParams, cursor: number, signal?: AbortSignal) =>
  request<Page<Match>>('GET', '/v1/matches', {
    auth: 'optional',
    signal,
    query: { lat: p.lat, lng: p.lng, nearby: p.nearby ? 'true' : undefined, day: p.day, type: p.type, cursor, limit: PAGE },
  });
export const getMatch = (id: string, signal?: AbortSignal) => request<Match>('GET', `/v1/matches/${enc(id)}`, { auth: 'optional', signal });
/** The UI only allows this after the organiser agrees to share their number (sharePhone). */
export type CreateMatchInput = {
  bookingId: string;
  title?: string;
  level: MatchLevel;
  contactPhone?: string;
  /** Default 'players' (needs openSpots). 'opponent' needs teamName; opponentPercent defaults to 50. */
  type?: MatchType;
  openSpots?: number;
  teamName?: string;
  opponentPercent?: 50 | 40 | 30;
};
export const createMatch = (b: CreateMatchInput) =>
  request<Match>('POST', '/v1/matches', { auth: 'required', body: { ...b, sharePhone: true } });
export const getMatchManage = (id: string, signal?: AbortSignal) =>
  request<MatchManage>('GET', `/v1/matches/${enc(id)}/manage`, { auth: 'required', signal });
export const updateMatch = (id: string, patch: { title?: string; paused?: boolean }) =>
  request<MatchManage>('PATCH', `/v1/matches/${enc(id)}`, { auth: 'required', body: patch });
export const decideRequest = (id: string, userId: string, accept: boolean) =>
  request<MatchManage>('POST', `/v1/matches/${enc(id)}/requests/${enc(userId)}/${accept ? 'accept' : 'decline'}`, { auth: 'required' });
export const getJoinedMatches = (signal?: AbortSignal) => request<Match[]>('GET', '/v1/matches/joined', { auth: 'required', signal });
export const getMyMatches = (signal?: AbortSignal) => request<MyMatches>('GET', '/v1/matches/mine', { auth: 'required', signal });
/** The UI only allows this after the player agrees to share their number (sharePhone). */
/** Opponent posts: send `teamName` and `teamSize` (spots is always 1, the team). */
export type JoinMatchInput = { position: MatchPosition; level: MatchLevel; spots: number; contactPhone?: string; teamName?: string; teamSize?: number };
export const joinMatch = (id: string, b: JoinMatchInput) =>
  request<Match>('POST', `/v1/matches/${enc(id)}/join`, { auth: 'required', body: { ...b, sharePhone: true } });
export const leaveMatch = (id: string) => request<Match>('DELETE', `/v1/matches/${enc(id)}/join`, { auth: 'required' });
/** Pay your share of a match you were accepted into (bKash, like a booking). */
export const startSharePayment = (id: string, idempotencyKey: string, returnUrl?: string) =>
  request<{ paymentId: string; checkoutUrl: string | null }>('POST', `/v1/matches/${enc(id)}/pay`, {
    auth: 'required',
    body: { returnUrl },
    idempotencyKey,
    timeoutMs: 30_000,
  });

export const getBooking = (id: string, signal?: AbortSignal) =>
  request<Booking>('GET', `/v1/bookings/${enc(id)}`, { auth: 'required', signal });

export const cancelBooking = (id: string) => request<{ ok: true }>('POST', `/v1/bookings/${enc(id)}/cancel`, { auth: 'required' });

export const getNotifications = (signal?: AbortSignal) =>
  request<NotificationItem[]>('GET', '/v1/me/notifications', { auth: 'required', signal });

/** Notifications a page at a time, newest first. `before`: the last item's cursor from the previous page. */
export const NOTIFICATION_PAGE = 10;
export const getNotificationPage = (before: string | undefined, signal?: AbortSignal) =>
  request<NotificationItem[]>(
    'GET',
    `/v1/me/notifications?limit=${NOTIFICATION_PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    { auth: 'required', signal },
  );

export const getRequests = (signal?: AbortSignal) => request<PlayerRequest[]>('GET', '/v1/me/requests', { auth: 'required', signal });

// ---- photos (Cloudflare R2) ---------------------------------------------------
export const requestUpload = (b: { purpose: 'avatar'; contentType: 'image/webp' | 'image/jpeg' | 'image/png'; size: number }) =>
  request<UploadTicket>('POST', '/v1/uploads', { auth: 'required', body: b });
export const setAvatar = (key: string) => request<User>('PUT', '/v1/me/avatar', { auth: 'required', body: { key } });
export const removeAvatar = () => request<User>('DELETE', '/v1/me/avatar', { auth: 'required' });

// ---- saved locations --------------------------------------------------------
export const getPlaces = (signal?: AbortSignal) => request<SavedPlace[]>('GET', '/v1/me/places', { auth: 'required', signal });
export const createPlace = (p: SavedPlaceInput) => request<SavedPlace>('POST', '/v1/me/places', { auth: 'required', body: p });
export const updatePlace = (id: string, p: SavedPlaceInput) =>
  request<SavedPlace>('PUT', `/v1/me/places/${enc(id)}`, { auth: 'required', body: p });
export const deletePlace = (id: string) => request<{ ok: true }>('DELETE', `/v1/me/places/${enc(id)}`, { auth: 'required' });

export type ExploreLike = ExploreResult;

// ── Account: settings, devices, password, deletion ──────────────────────
/** `twoFactor`: two-step sign-in (an emailed code after the password), off by default. */
export type Settings = { notifications: boolean; twoFactor?: boolean; hasEmail?: boolean };
export type DeviceSession = { id: string; device: string; lastActive: number; current: boolean };
export const getSettings = (signal?: AbortSignal) => request<Settings>('GET', '/v1/me/settings', { auth: 'required', signal });
/** Turning `twoFactor` off needs the account `password`. */
export const updateSettings = (patch: Partial<Settings> & { password?: string }) =>
  request<Settings>('PUT', '/v1/me/settings', { auth: 'required', body: patch });
export const getSessions = (signal?: AbortSignal) => request<DeviceSession[]>('GET', '/v1/me/sessions', { auth: 'required', signal });
export const revokeSession = (id: string) => request<{ ok: true }>('DELETE', `/v1/me/sessions/${enc(id)}`, { auth: 'required' });
export const revokeOtherSessions = () => request<{ signedOut: number }>('POST', '/v1/me/sessions/revoke-others', { auth: 'required', body: {} });
export const changePassword = (current: string, next: string) =>
  request<{ ok: true; signedOut: number }>('POST', '/v1/me/password', { auth: 'required', body: { current, next } });
// Edit profile. The phone is the sign-in, so it changes only after a code sent to the new number.
export const updateProfile = (b: { name: string }) => request<User>('PATCH', '/v1/me', { auth: 'required', body: b });
export const startPhoneChange = (phone: string, password: string) =>
  request<{ sent: true; devCode?: string }>('POST', '/v1/me/phone/start', { auth: 'required', body: { phone, password } });
export const verifyPhoneChange = (phone: string, code: string) => request<User>('POST', '/v1/me/phone/verify', { auth: 'required', body: { phone, code } });
export const deleteAccount = (password: string) => request<{ deleted: true }>('POST', '/v1/me/delete', { auth: 'required', body: { password } });
