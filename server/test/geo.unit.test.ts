/** Owner map picker: reading exact points out of Google Maps links and pasted coordinates. */
import { describe, expect, it } from 'vitest';

import { coordsFromHtml, coordsFromMapsUrl, coordsFromText, isGoogleMapsHost, resolveLocation } from '../src/services/geo';

describe('coordinates from pasted text', () => {
  it('reads decimal, degree and DMS forms', () => {
    expect(coordsFromText('23.845123, 90.257456')).toEqual({ lat: 23.845123, lng: 90.257456 });
    expect(coordsFromText('23.845,90.257')).toEqual({ lat: 23.845, lng: 90.257 });
    expect(coordsFromText('23.845° N, 90.257° E')).toEqual({ lat: 23.845, lng: 90.257 });
    expect(coordsFromText(`23°50'42.0"N 90°15'25.2"E`)).toEqual({ lat: 23.845, lng: 90.257 });
    expect(coordsFromText('0, 0')).toBeNull();
    expect(coordsFromText('95, 10')).toBeNull();
    expect(coordsFromText('Savar')).toBeNull();
  });
});

describe('coordinates from Google Maps URLs', () => {
  it('prefers the place pin over the map view', () => {
    const u =
      'https://www.google.com/maps/place/KickOff+Turf+Savar/@23.8461,90.2551,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d23.845801!4d90.257712!16s%2Fg%2F11';
    expect(coordsFromMapsUrl(u)).toEqual({ lat: 23.845801, lng: 90.257712, name: 'KickOff Turf Savar' });
  });
  it('reads q=, query= and ll=', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/?q=23.8458,90.2577')).toEqual({ lat: 23.8458, lng: 90.2577 });
    expect(coordsFromMapsUrl('https://www.google.com/maps/search/?api=1&query=23.8458%2C90.2577')).toEqual({ lat: 23.8458, lng: 90.2577 });
    expect(coordsFromMapsUrl('https://maps.google.com/maps?ll=23.8458,90.2577&z=16')).toEqual({ lat: 23.8458, lng: 90.2577 });
    expect(coordsFromMapsUrl('https://maps.google.com/?q=loc:23.8458,90.2577')).toEqual({ lat: 23.8458, lng: 90.2577 });
  });
  it('reads a dropped pin and the @view as a last resort', () => {
    expect(coordsFromMapsUrl('https://www.google.com/maps/place/23%C2%B050\'44.9%22N+90%C2%B015\'27.8%22E/@23.8458,90.2577,17z')).toEqual({ lat: 23.8458, lng: 90.2577 });
    expect(coordsFromMapsUrl('https://www.google.com/maps/search/23.8458,+90.2577')).toEqual({ lat: 23.8458, lng: 90.2577 });
    expect(coordsFromMapsUrl('https://www.google.com/maps/@23.8458,90.2577,15z')).toEqual({ lat: 23.8458, lng: 90.2577 });
  });
  it('returns null when there is no location in the URL', () => {
    expect(coordsFromMapsUrl('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(coordsFromMapsUrl('https://www.google.com/maps?q=KickOff+Turf')).toBeNull();
  });
  it('reads coordinates from a place page', () => {
    expect(coordsFromHtml('<meta content="https://maps.google.com/maps/api/staticmap?center=23.8458%2C90.2577&amp;zoom=15">')).toEqual({ lat: 23.8458, lng: 90.2577 });
    expect(coordsFromHtml('...[null,null,23.8458,90.2577]...')).toEqual({ lat: 23.8458, lng: 90.2577 });
  });
});

describe('only Google is ever fetched', () => {
  it('accepts Google Maps hosts and nothing else', () => {
    for (const h of ['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'maps.google.com', 'google.com.bd', 'www.google.co.uk']) expect(isGoogleMapsHost(h)).toBe(true);
    for (const h of ['evil.com', 'google.com.evil.com', 'maps.app.goo.gl.evil.com', 'localhost', '127.0.0.1', 'googleusercontent.com'])
      expect(isGoogleMapsHost(h)).toBe(false);
  });
  it('rejects other links without fetching them', async () => {
    await expect(resolveLocation('http://127.0.0.1:4010/health')).rejects.toThrow(/Google Maps link/);
    await expect(resolveLocation('look at this')).rejects.toThrow(/Paste a Google Maps link/);
  });
  it('answers coordinates and full links without any network call', async () => {
    expect(await resolveLocation('KickOff Turf\nhttps://www.google.com/maps/place/X/@1,1,17z/data=!3d23.8458!4d90.2577')).toEqual({ lat: 23.8458, lng: 90.2577, name: 'X' });
    expect(await resolveLocation(' 23.8458, 90.2577 ')).toEqual({ lat: 23.8458, lng: 90.2577 });
  });
});

describe('links shared from the Google Maps phone app', () => {
  const realFetch = globalThis.fetch;
  const route = (map: Record<string, { status: number; location?: string; body?: string }>) => {
    globalThis.fetch = (async (input: string | URL) => {
      const u = String(input);
      const hit = Object.entries(map).find(([k]) => u.startsWith(k))?.[1];
      if (!hit) throw new Error('offline');
      return new Response(hit.body ?? '', { status: hit.status, headers: hit.location ? { location: hit.location } : {} });
    }) as typeof fetch;
  };
  const restore = () => {
    globalThis.fetch = realFetch;
  };

  it('a short link to ?q=<name, address> with Google answering a check page gives the place to look up', async () => {
    route({
      'https://maps.app.goo.gl/': { status: 302, location: 'https://maps.google.com/?q=KickOff+Turf+Savar,+Bank+Colony+Rd,+Savar&ftid=0x1:0x2&entry=gps&g_st=ic' },
      'https://maps.google.com/': { status: 302, location: 'https://www.google.com/sorry/index?continue=x' },
    });
    try {
      expect(await resolveLocation('https://maps.app.goo.gl/YTRojxSy8butnuB4A')).toEqual({ query: 'KickOff Turf Savar, Bank Colony Rd, Savar', name: 'KickOff Turf Savar' });
    } finally {
      restore();
    }
  });

  it('a short link straight to a place with a pin gives the exact point (no more fetching)', async () => {
    route({ 'https://maps.app.goo.gl/': { status: 302, location: 'https://www.google.com/maps/place/KickOff+Turf/@23.84,90.25,17z/data=!3d23.845801!4d90.257712' } });
    try {
      expect(await resolveLocation('https://maps.app.goo.gl/abc')).toEqual({ lat: 23.845801, lng: 90.257712, name: 'KickOff Turf' });
    } finally {
      restore();
    }
  });

  it('a page that redirects with JavaScript to a place with a pin is followed', async () => {
    route({
      'https://maps.app.goo.gl/': {
        status: 200,
        body: '<script>window.location.replace("https:\\/\\/www.google.com\\/maps\\/place\\/X\\/@1,1,17z\\/data=!3d23.8458!4d90.2577")</script>',
      },
    });
    try {
      expect(await resolveLocation('https://maps.app.goo.gl/js')).toEqual({ lat: 23.8458, lng: 90.2577, name: 'X' });
    } finally {
      restore();
    }
  });

  it('the real Baratia Playground link: a plain request gets the redirect even when a browser-looking one gets a page', async () => {
    const real =
      'https://www.google.com/maps/place/Baratia+Playground/@24.0473132,90.0711074,17z/data=!3m1!4b1!4m6!3m5!1s0x3755f95541d71fcd:0x8f13c9ba43fbcbbc!8m2!3d24.0473132!4d90.0736823!16s%2Fg%2F11c2k6qv4c!18m1!1e1?entry=tts&g_ep=EgoyMDI2MTExOC4xIOC7DCoASAFQAw%3D%3D&skid=c6ff7ca7-2d18-4393-9945-b7a805f56731';
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const browser = !!(init?.headers as Record<string, string> | undefined)?.['User-Agent'];
      seen.push(browser ? 'browser' : 'plain');
      if (!String(input).startsWith('https://maps.app.goo.gl/')) throw new Error('offline');
      return browser ? new Response('<html>Before you continue to Google</html>', { status: 200 }) : new Response('', { status: 302, headers: { location: real } });
    }) as typeof fetch;
    try {
      expect(await resolveLocation('https://maps.app.goo.gl/2m5QmFohHo5xcnkQA')).toEqual({ lat: 24.047313, lng: 90.073682, name: 'Baratia Playground' });
      expect(seen).toEqual(['plain']);
    } finally {
      restore();
    }
  });

  it('a page with the place link written in escaped JSON (\\u003d) is read too', async () => {
    route({
      'https://maps.app.goo.gl/': {
        status: 200,
        body: '{"url":"https:\\/\\/www.google.com\\/maps\\/place\\/Y\\/data\\u003d!3d23.81!4d90.41?entry\\u003dtts"}',
      },
    });
    try {
      expect(await resolveLocation('https://maps.app.goo.gl/json')).toEqual({ lat: 23.81, lng: 90.41, name: 'Y' });
    } finally {
      restore();
    }
  });

  it('Google unreachable and nothing in the link: a clear error', async () => {
    route({});
    try {
      await expect(resolveLocation('https://maps.app.goo.gl/none')).rejects.toThrow(/no location/);
    } finally {
      restore();
    }
  });
});
