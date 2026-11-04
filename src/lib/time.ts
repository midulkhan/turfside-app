/**
 * Venue times are in Asia/Dhaka (UTC+6, no DST). We represent a session start
 * as minutes after local midnight and a calendar day as 'YYYY-MM-DD' so that
 * formatting never depends on the phone's own time zone.
 */
const DHAKA_OFFSET_MIN = 6 * 60;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export type DayKey = string; // YYYY-MM-DD in Dhaka

export function dhakaToday(now = Date.now()): DayKey {
  const d = new Date(now + DHAKA_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: DayKey, n: number): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parts(day: DayKey) {
  const d = new Date(`${day}T00:00:00Z`);
  return { dow: d.getUTCDay(), date: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

export const weekday = (day: DayKey) => DAYS[parts(day).dow];
export const dayOfMonth = (day: DayKey) => parts(day).date;
export const dayOfWeekIndex = (day: DayKey) => parts(day).dow;
export const monthYear = (day: DayKey) => `${MONTHS_LONG[parts(day).month]} ${parts(day).year}`;
/** "Sun, 1 Nov 2026" */
export function formatDay(day: DayKey, opts: { year?: boolean } = { year: true }) {
  const p = parts(day);
  return `${DAYS[p.dow]}, ${p.date} ${MONTHS[p.month]}${opts.year ? ` ${p.year}` : ''}`;
}

/** 1140 → "7:00 PM" (wraps after midnight). */
export function formatClock(minutes: number, withPeriod = true) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return withPeriod ? `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}` : `${h12}:${mm}`;
}

/** "7:00–8:00 PM" — drops the first period when both are the same. */
export function formatRange(start: number, end: number) {
  const samePeriod = Math.floor((start % 1440) / 720) === Math.floor((end % 1440) / 720);
  return `${formatClock(start, !samePeriod)}–${formatClock(end)}`;
}

/** "7:00 – 8:00 PM" (spaced, for prominent labels). */
export function formatRangeSpaced(start: number, end: number) {
  return formatRange(start, end).replace('–', ' – ');
}

export function formatDuration(mins: number) {
  if (mins % 60 === 0) return mins === 60 ? '1 hour' : `${mins / 60} hours`;
  if (mins > 60) return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `${mins} minutes`;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
/** Morning 6–12 · Afternoon 12–5 PM · Evening 5–9 PM · Night 9 PM–6 AM (incl. after midnight). */
export function dayPart(startMin: number): DayPart {
  if (startMin < 6 * 60 || startMin >= 21 * 60) return 'night';
  if (startMin < 12 * 60) return 'morning';
  if (startMin < 17 * 60) return 'afternoon';
  return 'evening';
}

/** Epoch ms for a Dhaka wall-clock time (Dhaka is UTC+6 all year, no DST). */
export function dhakaInstant(day: DayKey, minutes: number) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, minutes) - 6 * 3600_000;
}
