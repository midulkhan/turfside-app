/** Verification emails through Sender: the request we make, against a local stand-in for the API. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: Server;
const seen: { url: string; auth: string; body: Record<string, any> }[] = [];
let reply = { status: 200, body: { success: true, message: 'Email sent', emailId: 'e1' } as Record<string, unknown> };
let email: typeof import('../src/lib/email');

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', auth: String(req.headers.authorization), body: raw ? JSON.parse(raw) : {} });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.SENDER_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2`;
  process.env.SENDER_API_TOKEN = 'test-token';
  email = await import('../src/lib/email');
});
afterAll(() => server.close());

describe('email via Sender', () => {
  it('sends the code email from noreply@turfsides.com with the token', async () => {
    const m = email.codeEmail({ name: 'Rafi Ahmed', code: '482913', minutes: 10, purpose: 'signup' });
    expect(m.subject).toBe('482913 is your TurfSides code');
    expect(m.html).toContain('482913');
    expect(m.text).toContain('finish creating your account');
    await email.sendEmail({ to: 'rafi@example.com', toName: 'Rafi Ahmed', ...m });
    const r = seen.at(-1)!;
    expect(r.url).toBe('/v2/message/send');
    expect(r.auth).toBe('Bearer test-token');
    expect(r.body).toMatchObject({ from: { email: 'noreply@turfsides.com', name: 'TurfSides' }, to: { email: 'rafi@example.com', name: 'Rafi Ahmed' }, subject: m.subject });
    expect(r.body.html).toContain('482913');
  });

  it('escapes names in the HTML', () => {
    expect(email.codeEmail({ name: '<b>x</b>', code: '1', minutes: 1, purpose: 'reset' }).html).not.toContain('<b>x</b>');
  });

  it('surfaces a rejected send as an error the app can show', async () => {
    reply = { status: 401, body: { success: false, message: 'Unauthenticated.' } };
    await expect(email.sendEmail({ to: 'a@b.co', subject: 's', html: 'h', text: 't' })).rejects.toMatchObject({ code: 'internal' });
    reply = { status: 200, body: { success: true } };
  });
});
