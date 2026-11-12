import { ApiError } from '@/features/api/types';

/**
 * Sign-up details kept in memory between the form and the code screen, so
 * "Resend code" works without passing the password through route params.
 * Never persisted; gone when the app restarts.
 */
/** "your email mi****@gmail.com" / "+880 1712 ••• 345" / both, for the code screens. */
export function sentToLabel(res: { channels?: ('email' | 'sms')[]; email?: string }, phone: string) {
  const num = phone.length === 10 ? `+880 ${phone.slice(0, 4)} ••• ${phone.slice(-3)}` : 'your number';
  // Codes go by email now; the number is named only when the server texted it (phone changes).
  const mail = res.email ?? null;
  const sms = res.channels ? res.channels.includes('sms') : !mail;
  return mail && sms ? `${mail} and ${num}` : mail ?? num;
}

export type PendingSignup = { name: string; phone: string; email: string; password: string };

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
export const errorMessage = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.';
