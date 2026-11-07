// Local stand-in for Upstash's REST API in front of a real redis-server, for tests and CI.
// Speaks just what @upstash/redis uses: POST / (one command), POST /pipeline, base64 replies.
//   node scripts/upstash-local.mjs [httpPort=8079] [redisPort=6379]
import { createServer } from 'node:http';
import { connect } from 'node:net';

const HTTP_PORT = Number(process.argv[2] ?? 8079);
const REDIS_PORT = Number(process.argv[3] ?? 6379);
const TOKEN = process.env.UPSTASH_LOCAL_TOKEN ?? 'local-token';

/** Minimal RESP2 client: one connection, replies matched to requests in order. */
function redisClient() {
  const sock = connect(REDIS_PORT, '127.0.0.1');
  let buf = Buffer.alloc(0);
  const waiting = [];
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const r = parse(buf, 0);
      if (!r) break;
      buf = buf.subarray(r.next);
      waiting.shift()(r.value);
    }
  });
  const parse = (b, i) => {
    const eol = b.indexOf('\r\n', i);
    if (eol < 0) return null;
    const type = String.fromCharCode(b[i]);
    const line = b.toString('utf8', i + 1, eol);
    const after = eol + 2;
    if (type === '+') return { value: { s: line }, next: after };
    if (type === '-') return { value: { err: line }, next: after };
    if (type === ':') return { value: Number(line), next: after };
    if (type === '$') {
      const n = Number(line);
      if (n < 0) return { value: null, next: after };
      if (b.length < after + n + 2) return null;
      return { value: b.subarray(after, after + n), next: after + n + 2 };
    }
    if (type === '*') {
      const n = Number(line);
      if (n < 0) return { value: null, next: after };
      const out = [];
      let at = after;
      for (let k = 0; k < n; k++) {
        const r = parse(b, at);
        if (!r) return null;
        out.push(r.value);
        at = r.next;
      }
      return { value: out, next: at };
    }
    throw new Error('bad RESP ' + type);
  };
  return (args) =>
    new Promise((resolve) => {
      waiting.push(resolve);
      const parts = args.map((a) => Buffer.from(String(a)));
      sock.write(`*${parts.length}\r\n`);
      for (const p of parts) sock.write(Buffer.concat([Buffer.from(`$${p.length}\r\n`), p, Buffer.from('\r\n')]));
    });
}
const send = redisClient();

/** RESP value → Upstash JSON ({ result } or { error }). Strings base64 when asked. */
function toJson(v, b64) {
  if (v && typeof v === 'object' && 'err' in v) return { error: v.err };
  const enc = (x) => {
    if (x === null) return null;
    if (typeof x === 'number') return x;
    if (Array.isArray(x)) return x.map(enc);
    if (Buffer.isBuffer(x)) return b64 ? x.toString('base64') : x.toString('utf8');
    if ('s' in x) return b64 ? Buffer.from(x.s).toString('base64') : x.s;
    return x;
  };
  return { result: enc(v) };
}

createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end('{"error":"Unauthorized"}');
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  const b64 = String(req.headers['upstash-encoding'] ?? '').toLowerCase() === 'base64';
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : req.url.slice(1).split('/').map(decodeURIComponent);
  } catch {
    res.writeHead(400).end('{"error":"bad json"}');
    return;
  }
  const out =
    req.url.startsWith('/pipeline') || req.url.startsWith('/multi-exec')
      ? await Promise.all(parsed.map(async (cmd) => toJson(await send(cmd), b64)))
      : toJson(await send(parsed), b64);
  const failed = !Array.isArray(out) && out.error;
  res.writeHead(failed ? 400 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
}).listen(HTTP_PORT, '127.0.0.1', () => console.log(`upstash-local on :${HTTP_PORT} → redis :${REDIS_PORT}`));
