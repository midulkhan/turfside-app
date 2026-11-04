import * as Crypto from 'expo-crypto';

/** Idempotency key for any request that creates money movement or a booking. */
export const newIdempotencyKey = () => Crypto.randomUUID();
