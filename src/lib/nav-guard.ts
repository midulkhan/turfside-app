import { router } from 'expo-router';

/**
 * Navigation safety, installed once at start-up.
 *
 * Back with nothing behind: a screen opened straight from a link or a notification is the only
 * screen in the stack, so `router.back()` would do nothing (and warn in dev). It goes home instead.
 *
 * Double-tap guard for navigation. A quick second tap on a card or button
 * would push the same screen twice (back then needs two presses). Any repeat
 * of the same push/navigate within 700 ms is ignored, app-wide.
 */
const WINDOW_MS = 700;
let last = { key: '', at: 0 };

function guard<F extends (...args: never[]) => unknown>(fn: F): F {
  return ((...args: Parameters<F>) => {
    const key = JSON.stringify(args[0]);
    const now = Date.now();
    if (key === last.key && now - last.at < WINDOW_MS) return;
    last = { key, at: now };
    return fn(...args);
  }) as F;
}

let installed = false;
export function installNavGuard() {
  if (installed) return;
  installed = true;
  router.push = guard(router.push.bind(router));
  router.navigate = guard(router.navigate.bind(router));
  const back = router.back.bind(router);
  router.back = () => (router.canGoBack() ? back() : router.replace('/'));
}
