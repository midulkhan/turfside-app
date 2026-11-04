// Bundles the API and all its dependencies into ONE file: dist/index.js.
// Shared hosting then needs no `npm install` — FTP uploads a single file.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false, // keep FTP uploads small
  minify: true,
  keepNames: true,
  legalComments: 'none',
  external: ['pg-native'], // optional native driver; pure-JS pg is used
  loader: { '.sql': 'text' }, // migrations ship inside the bundle
  logLevel: 'info',
});
