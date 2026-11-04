/** Dhaka areas offered in the area picker and used to name a GPS fix. */
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

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
