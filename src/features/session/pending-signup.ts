import { ApiError } from '@/features/api/types';

/**
 * Sign-up details kept in memory between the form and the code screen, so
 * "Resend code" works without passing the password through route params.
 * Never persisted; gone when the app restarts.
 */
export type PendingSignup = { name: string; phone: string; email?: string; password: string };

let pending: PendingSignup | null = null;
export const pendingSignup = {
  set: (p: PendingSignup) => {
    pending = p;
  },
  get: () => pending,
  clear: () => {
    pending = null;
  },
};

/** Human message for any thrown value. */
export const errorMessage = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
