import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

import { compressImage, type CompressPreset } from '@/lib/images';

import * as api from './client';
import { ApiError } from './types';

/**
 * PUT the file to the signed URL; returns the HTTP status.
 * Phones: a native file upload, so the body is exactly the file and its length matches the
 * Content-Length the URL was signed for (React Native's fetch with a Blob body could send a
 * different length or a chunked body, which R2 rejects). Web: a normal fetch with the Blob.
 */
async function putFile(uri: string, url: string, headers: Record<string, string>) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    return (await fetch(url, { method: 'PUT', headers, body: blob })).status;
  }
  const res = await new File(uri).upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers, mimeType: headers['Content-Type'] });
  return res.status;
}

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
      const status = await putFile(img.uri, ticket.uploadUrl, ticket.headers);
      if (status >= 200 && status < 300) return ticket.key;
      lastError = new ApiError(status >= 500 ? 'network' : 'invalid', `The photo upload was rejected (${status}). Please try again.`);
      if (status < 500 && status !== 403) break; // a bad request won't get better by retrying
    } catch (e) {
      lastError = e instanceof ApiError ? e : new ApiError('network', 'Couldn’t upload the photo. Check your connection.');
      if (e instanceof ApiError && e.code !== 'network') break;
    }
    await new Promise((r) => setTimeout(r, 600 * 2 ** i + Math.random() * 300));
  }
  throw lastError instanceof Error ? lastError : new ApiError('network', 'Couldn’t upload the photo. Check your connection.');
}
