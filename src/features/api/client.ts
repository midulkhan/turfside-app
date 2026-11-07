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
import type {
  AppConfig,
  AuthResult,
  Booking,
  CodeSent,
  DaySlots,
  ExploreParams,
  ExploreResult,
  Hold,
  NotificationItem,
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
export const signupStart = (b: { name: string; phone: string; email?: string; password: string }) =>
  request<CodeSent>('POST', '/v1/auth/signup/start', { body: { ...b, role: 'player' } });

export const signupVerify = (phone: string, code: string) => request<AuthResult>('POST', '/v1/auth/signup/verify', { body: { phone, code } });

export const login = (identifier: string, password: string) => request<AuthResult>('POST', '/v1/auth/login', { body: { identifier, password } });

export const resetStart = (phone: string) => request<CodeSent>('POST', '/v1/auth/password/reset/start', { body: { phone } });

export const resetVerify = (phone: string, code: string, newPassword: string) =>
  request<AuthResult>('POST', '/v1/auth/password/reset/verify', { body: { phone, code, newPassword } });

export const logout = () => request<{ ok: true }>('POST', '/v1/auth/logout', { auth: 'required', timeoutMs: 5000 });

export const me = (signal?: AbortSignal) => request<User>('GET', '/v1/me', { auth: 'required', signal });

// ---- venues -----------------------------------------------------------------
export const explore = (p: ExploreParams, signal?: AbortSignal) =>
  request<ExploreResult>('GET', '/v1/venues/explore', {
    auth: 'optional',
    signal,
    query: { lat: p.lat, lng: p.lng, day: p.day, format: p.format, floodlit: p.floodlitOnly ? 'true' : undefined, q: p.query?.trim(), radius: p.radiusKm },
  });

export const getVenue = (id: string, signal?: AbortSignal) => request<VenueDetail>('GET', `/v1/venues/${enc(id)}`, { auth: 'optional', signal });

/** `fresh`: skip the server's short cache (used right after a realtime change). */
export const getSlots = (venueId: string, day: DayKey, signal?: AbortSignal, fresh?: boolean) =>
  request<DaySlots>('GET', `/v1/venues/${enc(venueId)}/slots`, { auth: 'optional', query: fresh ? { day, fresh: '1' } : { day }, signal });

export const getReviews = (venueId: string, signal?: AbortSignal) => request<ReviewSummary>('GET', `/v1/venues/${enc(venueId)}/reviews`, { signal });

export const getSaved = (signal?: AbortSignal) => request<VenueSummary[]>('GET', '/v1/me/saved', { auth: 'required', signal });

export const setSaved = (venueId: string, value: boolean) =>
  request<{ venueId: string; isSaved: boolean }>(value ? 'PUT' : 'DELETE', `/v1/me/saved/${enc(venueId)}`, { auth: 'required' });

// ---- checkout ---------------------------------------------------------------
/** Reserve a slot for 10 minutes. The server re-checks availability atomically. */
/** Put slots (one turf) in the cart. Replaces any previous cart; its slots are freed at once. */
export const createHold = (slotIds: string | string[], idempotencyKey: string) =>
  request<Hold>('POST', '/v1/holds', { auth: 'required', body: { slotIds: Array.isArray(slotIds) ? slotIds : [slotIds] }, idempotencyKey });

export const getHold = (holdId: string, signal?: AbortSignal) => request<Hold>('GET', `/v1/holds/${enc(holdId)}`, { auth: 'required', signal });

/** Give the slot back (leaving checkout without paying). Holds with a payment in progress are kept. */
export const releaseHold = (holdId: string) =>
  request<{ released: boolean }>('DELETE', `/v1/holds/${enc(holdId)}`, { auth: 'required', timeoutMs: 8000 });

/** Take one slot out of the cart. Removing the last one empties it (`released: true`). */
export const removeHoldSlot = (holdId: string, slotId: string) =>
  request<{ released: boolean; hold: Hold | null }>('DELETE', `/v1/holds/${enc(holdId)}/slots/${enc(slotId)}`, { auth: 'required', timeoutMs: 8000 });

/** Active holds: the cart. */
export const getMyHolds = (signal?: AbortSignal) => request<Hold[]>('GET', '/v1/me/holds', { auth: 'required', signal });

/**
 * Start a bKash payment for a hold. The server calls bKash "create payment" and
 * returns its checkout URL; the app opens it and then polls getPaymentStatus.
 * `returnUrl` is where the server sends the browser back to (validated server-side).
 */
export const startPayment = (holdId: string, idempotencyKey: string, returnUrl?: string) =>
  request<{ paymentId: string; checkoutUrl: string | null }>('POST', '/v1/payments', {
    auth: 'required',
    body: { holdId, returnUrl },
    idempotencyKey,
    timeoutMs: 30_000,
  });

/** Ask the server to verify the payment with bKash. Idempotent; safe to poll. */
export const getPaymentStatus = (paymentId: string) =>
  request<{ status: 'pending' | 'confirmed' | 'failed'; bookingId?: string }>('GET', `/v1/payments/${enc(paymentId)}`, {
    auth: 'required',
    timeoutMs: 30_000,
  });

// ---- bookings ---------------------------------------------------------------
export const getBookings = (signal?: AbortSignal) => request<Booking[]>('GET', '/v1/me/bookings', { auth: 'required', signal });

export const getBooking = (id: string, signal?: AbortSignal) => request<Booking>('GET', `/v1/bookings/${enc(id)}`, { auth: 'required', signal });

export const cancelBooking = (id: string) => request<{ ok: true }>('POST', `/v1/bookings/${enc(id)}/cancel`, { auth: 'required' });

export const getNotifications = (signal?: AbortSignal) => request<NotificationItem[]>('GET', '/v1/me/notifications', { auth: 'required', signal });

export const getRequests = (signal?: AbortSignal) => request<PlayerRequest[]>('GET', '/v1/me/requests', { auth: 'required', signal });

// ---- photos (Cloudflare R2) ---------------------------------------------------
export const requestUpload = (b: { purpose: 'avatar'; contentType: 'image/webp' | 'image/jpeg' | 'image/png'; size: number }) =>
  request<UploadTicket>('POST', '/v1/uploads', { auth: 'required', body: b });
export const setAvatar = (key: string) => request<User>('PUT', '/v1/me/avatar', { auth: 'required', body: { key } });
export const removeAvatar = () => request<User>('DELETE', '/v1/me/avatar', { auth: 'required' });

// ---- saved locations --------------------------------------------------------
export const getPlaces = (signal?: AbortSignal) => request<SavedPlace[]>('GET', '/v1/me/places', { auth: 'required', signal });
export const createPlace = (p: SavedPlaceInput) => request<SavedPlace>('POST', '/v1/me/places', { auth: 'required', body: p });
export const updatePlace = (id: string, p: SavedPlaceInput) => request<SavedPlace>('PUT', `/v1/me/places/${enc(id)}`, { auth: 'required', body: p });
export const deletePlace = (id: string) => request<{ ok: true }>('DELETE', `/v1/me/places/${enc(id)}`, { auth: 'required' });

export type ExploreLike = ExploreResult;
