import { compressImage, type CompressPreset } from '@/lib/images';

import * as api from './client';
import { ApiError } from './types';

/**
 * Compress → ask our API for a signed URL → PUT straight to Cloudflare R2.
 * Each attempt gets a fresh signed URL (they expire after 5 minutes), and
 * network failures retry with exponential backoff. Returns the object key,
 * which the caller then attaches (e.g. setAvatar).
 */
export async function uploadPhoto(purpose: 'avatar', uri: string, preset: CompressPreset, attempts = 3): Promise<string> {
  const img = await compressImage(uri, preset);
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ticket = await api.requestUpload({ purpose, contentType: 'image/webp', size: img.bytes });
      const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: img.blob });
      if (res.ok) return ticket.key;
      lastError = new ApiError(res.status >= 500 ? 'network' : 'invalid', 'The photo upload was rejected. Please try again.');
      if (res.status < 500 && res.status !== 403) break; // a bad request won't get better by retrying
    } catch (e) {
      lastError = e;
      if (e instanceof ApiError && e.code !== 'network') break;
    }
    await new Promise((r) => setTimeout(r, 600 * 2 ** i + Math.random() * 300));
  }
  throw lastError instanceof Error ? lastError : new ApiError('network', 'Couldn’t upload the photo. Check your connection.');
}
