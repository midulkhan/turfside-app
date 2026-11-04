import { taka } from '@/lib/money';
import type { PriceRules, SessionRule } from '@/lib/schedule';

import type { PitchFormat } from './types';

// Placeholder photos (cropped from the design mockups). Replace with CDN keys.
export const photos = {
  arena: require('@/assets/photos/venue-arena.webp'),
  sunset: require('@/assets/photos/venue-sunset.webp'),
  floodlit: require('@/assets/photos/venue-floodlit.webp'),
  evening: require('@/assets/photos/venue-evening.webp'),
  dusk: require('@/assets/photos/venue-dusk.webp'),
  players: require('@/assets/photos/players.webp'),
};

export type DbVenue = {
  id: string;
  name: string;
  area: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  formats: PitchFormat[];
  floodlit: boolean;
  photos: (number | null)[];
  amenities: string[];
  session: SessionRule;
  prices: PriceRules;
};

const std = (t: number, weekend?: number): PriceRules => ({
  standardHourly: taka(t),
  weekdayHourly: weekend ? { 5: taka(weekend), 6: taka(weekend) } : {},
  specialDates: {},
});

export const venues: DbVenue[] = [
  {
    id: 'v_bashundhara',
    name: 'Bashundhara Arena',
    area: 'Bashundhara',
    city: 'Dhaka',
    address: 'Block C, Road 5, Bashundhara R/A, Dhaka',
    lat: 23.8191,
    lng: 90.4526,
    rating: 4.8,
    reviewCount: 212,
    formats: ['5-a-side'],
    floodlit: true,
    photos: [photos.sunset, photos.floodlit, photos.arena],
    amenities: ['Floodlights', 'Changing room', 'Parking', 'Drinking water', 'Washroom'],
    session: { openMin: 6 * 60, closeMin: 30 * 60, lengthMin: 60, breakMin: 0 },
    prices: std(1500, 1800),
  },
  {
    id: 'v_kickoff_uttara',
    name: 'Kickoff Turf Uttara',
    area: 'Uttara',
    city: 'Dhaka',
    address: 'Sector 13, Uttara, Dhaka',
    lat: 23.8728,
    lng: 90.3984,
    rating: 4.6,
    reviewCount: 148,
    formats: ['5-a-side', '7-a-side'],
    floodlit: true,
    photos: [photos.evening, photos.dusk],
    amenities: ['Floodlights', 'Parking', 'Café', 'Washroom'],
    session: { openMin: 6 * 60, closeMin: 27 * 60, lengthMin: 90, breakMin: 0 },
    prices: std(2500, 4500),
  },
  {
    id: 'v_gulshan_goal',
    name: 'Goal Zone Gulshan',
    area: 'Gulshan',
    city: 'Dhaka',
    address: 'Road 79, Gulshan 2, Dhaka',
    lat: 23.7925,
    lng: 90.4078,
    rating: 4.7,
    reviewCount: 96,
    formats: ['6-a-side'],
    floodlit: true,
    photos: [photos.floodlit, photos.sunset],
    amenities: ['Floodlights', 'Changing room', 'Showers', 'Parking'],
    session: { openMin: 7 * 60, closeMin: 28 * 60, lengthMin: 60, breakMin: 0 },
    prices: std(2200, 2800),
  },
  {
    id: 'v_badda_pitch',
    name: 'The Pitch Badda',
    area: 'Badda',
    city: 'Dhaka',
    address: 'Progoti Sarani, Middle Badda, Dhaka',
    lat: 23.7806,
    lng: 90.4265,
    rating: 4.4,
    reviewCount: 61,
    formats: ['5-a-side'],
    floodlit: false,
    photos: [photos.dusk, null],
    amenities: ['Parking', 'Drinking water'],
    session: { openMin: 6 * 60, closeMin: 24 * 60, lengthMin: 60, breakMin: 0 },
    prices: std(1200),
  },
  {
    id: 'v_mirpur_dome',
    name: 'Mirpur Dome',
    area: 'Mirpur',
    city: 'Dhaka',
    address: 'Section 10, Mirpur, Dhaka',
    lat: 23.8069,
    lng: 90.3687,
    rating: 4.5,
    reviewCount: 133,
    formats: ['5-a-side', '6-a-side'],
    floodlit: true,
    photos: [photos.arena, photos.evening],
    amenities: ['Floodlights', 'Roof', 'Changing room', 'Café'],
    session: { openMin: 6 * 60, closeMin: 30 * 60, lengthMin: 60, breakMin: 0 },
    prices: std(1800, 2400),
  },
  {
    id: 'v_dhanmondi_box',
    name: 'Box Turf Dhanmondi',
    area: 'Dhanmondi',
    city: 'Dhaka',
    address: 'Road 27, Dhanmondi, Dhaka',
    lat: 23.7461,
    lng: 90.3742,
    rating: 4.3,
    reviewCount: 40,
    formats: ['5-a-side'],
    floodlit: true,
    photos: [null],
    amenities: ['Floodlights', 'Washroom'],
    session: { openMin: 8 * 60, closeMin: 26 * 60, lengthMin: 60, breakMin: 0 },
    prices: std(1600, 2000),
  },
];

/** Deterministic pseudo-random so mock availability is stable across renders. */
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const KNOWN_AREAS = [
  { name: 'Bashundhara', city: 'Dhaka', lat: 23.8191, lng: 90.4526 },
  { name: 'Uttara', city: 'Dhaka', lat: 23.8728, lng: 90.3984 },
  { name: 'Gulshan', city: 'Dhaka', lat: 23.7925, lng: 90.4078 },
  { name: 'Banani', city: 'Dhaka', lat: 23.7937, lng: 90.4066 },
  { name: 'Badda', city: 'Dhaka', lat: 23.7806, lng: 90.4265 },
  { name: 'Mirpur', city: 'Dhaka', lat: 23.8069, lng: 90.3687 },
  { name: 'Dhanmondi', city: 'Dhaka', lat: 23.7461, lng: 90.3742 },
  { name: 'Mohammadpur', city: 'Dhaka', lat: 23.7662, lng: 90.3589 },
];
