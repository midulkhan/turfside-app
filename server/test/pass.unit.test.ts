/** Entry pass v2: the QR carries a signed ticket. */
import { beforeAll, describe, expect, it } from 'vitest';

let t: typeof import('../src/lib/tokens');
beforeAll(async () => {
  process.env.PASS_SECRET ??= 'unit-test-pass-secret-0123456789abcdef';
  process.env.JWT_SECRET ??= 'unit-test-jwt-secret-0123456789abcdef';
  t = await import('../src/lib/tokens');
});

const ticket = {
  code: 'TS-261111-6700',
  venue: 'Mohammadpur Football Hub',
  area: 'Mohammadpur',
  pitch: 'Main pitch',
  format: '5-a-side',
  date: '2026-11-11',
  from: '07:00',
  to: '08:00',
  name: 'Rafi Ahmed',
  phone: '017*****907',
  paid: 1200,
  via: 'bKash',
};

describe('entry pass v2', () => {
  it('round-trips: readable by anyone, verifiable only with our secret', () => {
    const token = t.signPass2({ ...ticket, exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(token.startsWith('TSP2.')).toBe(true);
    expect(token.length).toBeLessThan(330); // small enough for a phone-screen QR
    expect(t.readPass2(token)?.ticket).toMatchObject({ v: 2, ...ticket });
    expect(t.verifyAnyPass(token)).toMatchObject({ code: ticket.code, ticket: { venue: ticket.venue } });
  });

  it('rejects an edited ticket, a bad signature, an expired pass and junk', () => {
    const token = t.signPass2({ ...ticket, exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(t.verifyAnyPass(token.replace('"paid":1200', '"paid":1'))).toBeNull();
    expect(t.verifyAnyPass(token.replace(/^TSP2\.[\w-]{22}/, 'TSP2.AAAAAAAAAAAAAAAAAAAAAA'))).toBeNull();
    expect(t.verifyAnyPass(t.signPass2({ ...ticket, exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    expect(t.verifyAnyPass('hello')).toBeNull();
    expect(t.readPass2('TSP2.x.{not json')).toBeNull();
  });

  it('still accepts v1 passes', () => {
    const v1 = t.signPass('00000000-0000-4000-8000-000000000000', Math.floor(Date.now() / 1000) + 60);
    expect(t.verifyAnyPass(v1)).toEqual({ bookingId: '00000000-0000-4000-8000-000000000000' });
  });
});
