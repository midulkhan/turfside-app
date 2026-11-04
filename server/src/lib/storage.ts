import { randomUUID } from 'node:crypto';

import { AwsClient } from 'aws4fetch';

import { config } from '../config';
import { ApiError } from '../errors';

/**
 * Cloudflare R2 through its S3 API.
 *
 * Photos never pass through this server: the app asks for a short-lived signed
 * PUT URL, uploads the (already compressed) file straight to R2, then tells us
 * the key. The signature pins the exact content type and byte size, and expires
 * in 5 minutes, so a leaked URL can't be reused for anything else.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
export type UploadType = keyof typeof UPLOAD_TYPES;

let client: AwsClient | null = null;
export const storageEnabled = () =>
  !!(config.R2_ENDPOINT && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET && config.R2_PUBLIC_URL);

function r2() {
  if (!storageEnabled()) throw new ApiError('not_configured', 'Photo uploads are not available yet.');
  client ??= new AwsClient({ accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY!, service: 's3', region: 'auto' });
  return client;
}

const objectUrl = (key: string) => `${config.R2_ENDPOINT!.replace(/\/+$/, '')}/${encodeURIComponent(config.R2_BUCKET!)}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Public, cacheable URL for a stored object (r2.dev or a custom domain). */
export const publicUrl = (key: string) => `${config.R2_PUBLIC_URL!.replace(/\/+$/, '')}/${key}`;

/** New object key under a fixed prefix, e.g. avatars/<userId>/<uuid>.webp */
export const newKey = (prefix: string, type: UploadType) => `${prefix}/${randomUUID()}.${UPLOAD_TYPES[type]}`;

export async function presignPut(key: string, contentType: UploadType, size: number, expiresSec = 300) {
  const url = new URL(objectUrl(key));
  url.searchParams.set('X-Amz-Expires', String(expiresSec));
  const headers = { 'Content-Type': contentType, 'Content-Length': String(size), 'Cache-Control': 'public, max-age=31536000, immutable' };
  const signed = await r2().sign(url.toString(), { method: 'PUT', headers, aws: { signQuery: true, allHeaders: true } });
  return { uploadUrl: signed.url, headers, expiresAt: Date.now() + expiresSec * 1000 };
}

/** Size and type of an uploaded object, or null if it isn't there. */
export async function headObject(key: string) {
  const res = await r2().fetch(objectUrl(key), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError('internal', 'Could not check the uploaded photo.');
  return { size: Number(res.headers.get('content-length') ?? 0), type: res.headers.get('content-type') ?? '' };
}

export async function deleteObject(key: string) {
  const res = await r2().fetch(objectUrl(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new ApiError('internal', 'Could not delete the photo.');
}

/** For /health: can we reach the bucket with these credentials? */
export async function pingStorage(): Promise<string> {
  if (!storageEnabled()) return 'not_configured';
  try {
    const res = await r2().fetch(`${config.R2_ENDPOINT!.replace(/\/+$/, '')}/${encodeURIComponent(config.R2_BUCKET!)}?list-type=2&max-keys=1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return 'ok';
    const text = await res.text();
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    return `error: ${res.status}${code ? ` ${code}` : ''}`;
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 80)}`;
  }
}
