/** Errors with a stable `code` the app can switch on. Messages are safe to show users. */
export type ErrorCode =
  | 'invalid'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'slot_taken'
  | 'hold_expired'
  | 'payment_failed'
  | 'rate_limited'
  | 'conflict'
  | 'not_configured'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  slot_taken: 409,
  hold_expired: 410,
  payment_failed: 402,
  rate_limited: 429,
  conflict: 409,
  not_configured: 503,
  internal: 500,
};

export class ApiError extends Error {
  status: number;
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
