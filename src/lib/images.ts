import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { PixelRatio } from 'react-native';

/**
 * Image pipeline helpers.
 *
 * 1. Display: request the smallest server variant that is still sharp on this
 *    screen (width buckets keep the CDN cache hit-rate high).
 * 2. Upload: downscale while decoding + re-encode as WebP before upload, so a
 *    6 MB camera photo becomes ~150–300 KB.
 * 3. Upload queue: parallel (3 at a time) with retry + exponential backoff.
 */
const WIDTH_BUCKETS = [160, 320, 480, 720, 1080, 1440];

export function variantWidth(displayWidth: number) {
  const px = Math.ceil(displayWidth * PixelRatio.get());
  return WIDTH_BUCKETS.find((w) => w >= px) ?? WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1];
}

/** Build a CDN URL for an uploaded photo key (e.g. Cloudflare R2 + resizing). */
export function photoUrl(cdnBase: string, key: string, displayWidth: number) {
  return `${cdnBase}/${encodeURIComponent(key)}?w=${variantWidth(displayWidth)}&f=webp`;
}

export async function compressForUpload(uri: string, maxWidth = 1600, quality = 0.72) {
  const context = ImageManipulator.manipulate(uri, { maxWidth });
  const ref = await context.renderAsync();
  const result = await ref.saveAsync({ compress: quality, format: SaveFormat.WEBP });
  return result; // { uri, width, height }
}

type UploadTask = { uri: string; getSignedUrl: () => Promise<string> };

async function putWithRetry(task: UploadTask, attempts = 4) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const compressed = await compressForUpload(task.uri);
      const url = await task.getSignedUrl(); // short-lived URL from our API; no storage keys in the app
      const body = await (await fetch(compressed.uri)).blob();
      const res = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'image/webp' } });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return url.split('?')[0];
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i + Math.random() * 200));
    }
  }
  throw lastError;
}

/** Upload many photos with bounded concurrency. Results keep the input order. */
export async function uploadAll(tasks: UploadTask[], concurrency = 3, onProgress?: (done: number) => void) {
  const results: string[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await putWithRetry(tasks[i]);
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
