import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

/**
 * Photo compression before upload.
 *
 * 1. Decode downsampled: the picture is decoded straight to at most `maxEdge`
 *    pixels on its longest side, so a 48 MP camera photo never fills memory.
 * 2. Encode as WebP, starting at high quality (0.82, visually lossless for
 *    photos) and stepping down only if the file is still over the size target.
 *    The decoded image is reused for every attempt, so retries are cheap.
 * 3. Re-encoding drops EXIF metadata, including the GPS position some cameras
 *    write into photos, so we never upload where a photo was taken.
 *
 * Typical result: a 4–8 MB phone photo becomes 150–400 KB with no visible loss.
 */
export type CompressPreset = { maxEdge: number; targetBytes: number };
export const PRESETS = {
  avatar: { maxEdge: 640, targetBytes: 120 * 1024 },
  photo: { maxEdge: 1600, targetBytes: 400 * 1024 },
} satisfies Record<string, CompressPreset>;

const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58];

export type Compressed = { uri: string; width: number; height: number; bytes: number };

/**
 * Exact size of the encoded file. On phones it's read from the file itself (reading it back
 * through fetch() as a Blob is unreliable there); the browser has only blob: URLs.
 */
async function byteSize(uri: string) {
  if (Platform.OS === 'web') return (await (await fetch(uri)).blob()).size;
  return new File(uri).size ?? 0;
}

export async function compressImage(uri: string, { maxEdge, targetBytes }: CompressPreset = PRESETS.photo): Promise<Compressed> {
  const image = await ImageManipulator.manipulate(uri, { maxWidth: maxEdge, maxHeight: maxEdge }).renderAsync();
  let best: Compressed | null = null;
  for (const quality of QUALITY_STEPS) {
    const out = await image.saveAsync({ compress: quality, format: SaveFormat.WEBP });
    const bytes = await byteSize(out.uri);
    best = { uri: out.uri, width: out.width, height: out.height, bytes };
    if (bytes > 0 && bytes <= targetBytes) break; // good enough: keep the highest quality that fits
  }
  return best!;
}
