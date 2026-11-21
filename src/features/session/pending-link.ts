/**
 * A turf share link opened while signed out (or before onboarding): the code waits here until the
 * person is in, then the start screen opens that turf. Memory only: if the app is closed, it's gone.
 */
let code: string | null = null;
export const pendingTurfLink = {
  set: (c: string) => {
    code = c;
  },
  /** Returns the waiting code once and forgets it. */
  take: () => {
    const c = code;
    code = null;
    return c;
  },
};
