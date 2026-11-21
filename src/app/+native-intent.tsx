/**
 * Links into the app from outside (Expo Router calls this before routing; native only).
 *
 * Turf share links are turfsides.com/FDJV346: the 7-character code is the whole path. Those go to
 * /t/FDJV346, which looks the code up and opens the turf. Everything else passes through as is.
 * This must never throw: a bad link falls back to the path the system gave us.
 */
const SHORT_CODE = /^\/([A-HJ-NP-Z2-9]{7})\/?$/; // capitals only: never matches app pages like /privacy

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    // `path` may be a full URL (https://turfsides.com/FDJV346) or just a path (/FDJV346).
    const url = new URL(path, 'turfsides://app');
    const pathname = url.protocol === 'turfsides:' && url.host && url.host !== 'app' ? `/${url.host}${url.pathname}` : url.pathname;
    const m = SHORT_CODE.exec(pathname);
    if (m) return `/t/${m[1]}`;
    return path;
  } catch {
    return path;
  }
}
