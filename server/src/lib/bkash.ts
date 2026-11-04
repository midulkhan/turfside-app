import { cacheGet, cacheSet } from '../cache';
import { config } from '../config';
import { ApiError } from '../errors';

/**
 * bKash Tokenized Checkout client.
 * Flow: grant token → create payment (returns bkashURL) → user pays on bKash →
 * bKash redirects to our callback → we EXECUTE server-side → verify amount/status.
 * Nothing the app sends can mark a payment as paid.
 */
const BASE = {
  sandbox: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout',
  live: 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout',
};

export const bkashEnabled = () => config.BKASH_MODE !== 'off';
export const isSimulated = () => config.BKASH_MODE === 'simulate';
export const toTaka = (poisha: number) => (poisha / 100).toFixed(2);
export const fromTaka = (s: string) => Math.round(Number(s) * 100);

type CreateRes = { paymentID: string; bkashURL: string; statusCode: string; statusMessage: string };
export type ExecRes = { paymentID: string; trxID?: string; transactionStatus?: string; amount?: string; statusCode: string; statusMessage: string; merchantInvoiceNumber?: string };

function base() {
  if (config.BKASH_MODE !== 'sandbox' && config.BKASH_MODE !== 'live') throw new ApiError('not_configured', 'Payments are not configured yet.');
  if (!(config.BKASH_APP_KEY && config.BKASH_APP_SECRET && config.BKASH_USERNAME && config.BKASH_PASSWORD)) throw new ApiError('not_configured', 'Payments are not configured yet.');
  return BASE[config.BKASH_MODE];
}

async function call<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new ApiError('payment_failed', 'bKash is not responding. You have not been charged.');
  return json;
}

/** id_token is valid for 1 hour; cache it for 50 minutes so we don't grant on every payment. */
async function token() {
  const cachedTok = await cacheGet<string>('bkash:id_token');
  if (cachedTok) return cachedTok;
  const res = await call<{ id_token?: string; statusMessage?: string }>(
    '/token/grant',
    { app_key: config.BKASH_APP_KEY, app_secret: config.BKASH_APP_SECRET },
    { username: config.BKASH_USERNAME!, password: config.BKASH_PASSWORD! },
  );
  if (!res.id_token) throw new ApiError('payment_failed', 'Could not start the payment with bKash.');
  await cacheSet('bkash:id_token', res.id_token, 50 * 60);
  return res.id_token;
}

const authHeaders = async () => ({ Authorization: await token(), 'X-APP-Key': config.BKASH_APP_KEY! });

export async function createPayment(p: { amountPoisha: number; invoice: string; payerReference: string; callbackURL: string }) {
  const res = await call<CreateRes>(
    '/create',
    { mode: '0011', payerReference: p.payerReference, callbackURL: p.callbackURL, amount: toTaka(p.amountPoisha), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: p.invoice },
    await authHeaders(),
  );
  if (res.statusCode !== '0000' || !res.paymentID || !res.bkashURL) throw new ApiError('payment_failed', res.statusMessage || 'bKash could not create the payment.');
  return { paymentID: res.paymentID, bkashURL: res.bkashURL };
}

export async function executePayment(paymentID: string) {
  return call<ExecRes>('/execute', { paymentID }, await authHeaders());
}

export async function queryPayment(paymentID: string) {
  return call<ExecRes>('/payment/status', { paymentID }, await authHeaders());
}

export async function refundPayment(p: { paymentID: string; trxID: string; amountPoisha: number; reason: string }) {
  return call<{ statusCode: string; refundTrxID?: string; statusMessage: string }>(
    '/payment/refund',
    { paymentID: p.paymentID, trxID: p.trxID, amount: toTaka(p.amountPoisha), sku: 'booking', reason: p.reason.slice(0, 250) },
    await authHeaders(),
  );
}
