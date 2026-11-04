// Local S3-compatible server for tests (stands in for Cloudflare R2). Not for production.
import S3rver from 's3rver';

const dir = process.argv[2] ?? '/tmp/s3-local';
await new S3rver({ port: 4569, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'turfsides-test' }] }).run();
console.log('s3-local on http://127.0.0.1:4569 (bucket turfsides-test)');
