import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * test/app/* runs the mobile app's real API client (../src/features/api) against
 * the server, with React Native storage swapped for an in-memory stub.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@/lib/storage', replacement: r('./test/app/storage-stub.ts') },
      { find: /^@\/(.*)$/, replacement: r('../src/$1') },
    ],
  },
  test: { testTimeout: 30_000, hookTimeout: 30_000, fileParallelism: false },
});
