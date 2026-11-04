import type { ImageSourcePropType } from 'react-native';

import type { Poisha } from '@/lib/money';
import type { DayKey } from '@/lib/time';

/**
 * API contracts shared by the mock and the real server client.
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
  photo: ImageSourcePropType | null; // remote URI in production
  isSaved: boolean;
};

export type VenueDetail = VenueSummary & {
  address: string;
  latitude: number;
  longitude: number;
  photos: (ImageSourcePropType | null)[];
  amenities: string[];
  rules: string[];
  about: string;
  shortAddress: string;
  openingHours: string;
  sessionLengthMin: number;
  cancellationPolicy: string;
};

export type Review = { id: string; author: string; rating: number; at: number; text: string };
export type ReviewSummary = { average: number; count: number; histogram: Record<1 | 2 | 3 | 4 | 5, number>; items: Review[] };

export type SlotStatus = 'available' | 'booked' | 'blocked';
export type Slot = { id: string; start: number; end: number; price: Poisha; status: SlotStatus };
export type DaySlots = { venueId: string; day: DayKey; slots: Slot[]; fetchedAt: number };

export type QuoteLine = { label: string; detail?: string; amount: Poisha };
export type Hold = {
  holdId: string;
  expiresAt: number;
  venue: Pick<VenueDetail, 'id' | 'name' | 'area' | 'city' | 'photo' | 'formats'>;
  day: DayKey;
  start: number;
  end: number;
  lines: QuoteLine[];
  total: Poisha;
  cancellationPolicy: string;
};

export type BookingStatus = 'confirmed' | 'checked_in' | 'completed' | 'cancelled';
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
};

export type ExploreParams = {
  lat: number;
  lng: number;
  day: DayKey;
  format: PitchFormat | 'any';
  floodlitOnly?: boolean;
  query?: string;
};

export type ExploreResult = {
  radiusKm: number;
  near: VenueSummary[]; // within the first radius step
  further: VenueSummary[];
};

export type User = { id: string; name: string; phone: string; email?: string; roles: ('player' | 'owner')[] };

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  at: number;
  kind: 'booking' | 'payment' | 'promo';
  read: boolean;
};

export class ApiError extends Error {
  constructor(
    public code: 'slot_taken' | 'hold_expired' | 'payment_failed' | 'not_found' | 'invalid' | 'network' | 'unauthorized',
    message: string,
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
