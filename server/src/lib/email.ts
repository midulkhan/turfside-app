import nodemailer, { type Transporter } from 'nodemailer';

import { config } from '../config';
import { ApiError } from '../errors';

/**
 * Transactional email through Sender (sender.net): POST {SENDER_API_URL}/message/send with a
 * Bearer token. The From address (noreply@turfsides.com) must be on a domain verified in Sender.
 */
const smtpReady = () => !!(config.SMTP_HOST && config.SMTP_PASS);
export const emailEnabled = () => smtpReady() || !!config.SENDER_API_TOKEN;

/**
 * SMTP (preferred when configured): the noreply@ mailbox on the hosting server. Use the server's
 * own name (e.g. server350-1.web-hosting.com): its certificate doesn't cover mail.turfsides.com.
 */
let smtp: Transporter | null = null;
const transport = () =>
  (smtp ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER || config.EMAIL_FROM, pass: config.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }));

async function sendSmtp(m: { to: string; toName?: string; subject: string; html: string; text: string }) {
  try {
    const info = await transport().sendMail({
      from: { name: config.EMAIL_FROM_NAME, address: config.EMAIL_FROM },
      to: m.toName ? { name: m.toName, address: m.to } : m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    lastSend = { at: new Date().toISOString(), ok: true, detail: `smtp ${String(info.response ?? '').slice(0, 80)}` };
  } catch (e) {
    const detail = `smtp ${(e as { code?: string }).code ?? ''} ${(e as Error).message ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 300);
    lastSend = { at: new Date().toISOString(), ok: false, detail };
    console.error(`[email] send failed: ${detail}`);
    smtp = null; // reconnect next time
    throw new ApiError('internal', 'We couldn’t send the email. Try again in a moment.');
  }
}

const headers = () => ({
  Authorization: `Bearer ${config.SENDER_API_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

export async function sendEmail(m: { to: string; toName?: string; subject: string; html: string; text: string }) {
  if (!emailEnabled()) throw new ApiError('not_configured', 'Email is not configured yet.');
  if (smtpReady()) return sendSmtp(m);
  const res = await fetch(`${config.SENDER_API_URL}/message/send`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      from: { email: config.EMAIL_FROM, name: config.EMAIL_FROM_NAME },
      to: { email: m.to, ...(m.toName ? { name: m.toName } : {}) },
      subject: m.subject,
      html: m.html,
      text: m.text,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const raw = (await res?.text().catch(() => '')) ?? '';
  let body: { success?: boolean; message?: string; errors?: unknown } | null = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    /* not JSON */
  }
  if (!res?.ok || body?.success === false) {
    const detail = `${res?.status ?? 'network'} ${body?.message ?? raw.slice(0, 200)}${body?.errors ? ` ${JSON.stringify(body.errors).slice(0, 300)}` : ''}`.trim();
    lastSend = { at: new Date().toISOString(), ok: false, detail };
    console.error(`[email] send failed: ${detail}`);
    throw new ApiError('internal', 'We couldn’t send the email. Try again in a moment.');
  }
  lastSend = { at: new Date().toISOString(), ok: true, detail: `sent ${(body as { emailId?: string } | null)?.emailId ?? ''}`.trim() };
}

/** The last send's outcome (no addresses or secrets), for /health: how a failure is diagnosed. */
let lastSend: { at: string; ok: boolean; detail: string } | null = null;
export const lastEmailSend = () => lastSend;

/** For /health: is the token accepted? Checked at most hourly (a read-only call). */
let state: { at: number; value: string } | null = null;
export async function emailState() {
  if (!emailEnabled()) return 'not_configured';
  if (state && Date.now() - state.at < 3600_000) return state.value;
  if (smtpReady()) {
    const ok = await transport().verify().then(() => true, () => false);
    if (!ok) smtp = null;
    state = { at: Date.now(), value: ok ? 'smtp:ok' : 'smtp:login failed' };
    return state.value;
  }
  const res = await fetch(`${config.SENDER_API_URL}/groups?limit=1`, { headers: headers(), signal: AbortSignal.timeout(5000) }).catch(() => null);
  const value = !res ? 'unreachable' : res.ok ? 'sender:ok' : res.status === 401 || res.status === 403 ? 'sender:token rejected' : `sender:http ${res.status}`;
  state = { at: Date.now(), value };
  return value;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The verification-code email: plain, branded, readable everywhere (inline styles only). */
export function codeEmail(o: { name?: string; code: string; minutes: number; purpose: 'signup' | 'reset' | 'login' }) {
  const what = o.purpose === 'signup' ? 'finish creating your account' : o.purpose === 'login' ? 'sign in to your account' : 'reset your password';
  const hello = o.name ? `Hi ${esc(o.name.split(' ')[0])},` : 'Hi,';
  // Plain wording that mail apps recognise as a one-time code (Gmail's "Copy code" button):
  // the code in the subject and the first line, labelled "verification code", as plain digits.
  const subject = `${o.code} is your TurfSides verification code`;
  const logo = `${config.PUBLIC_URL.replace(/\/+$/, '')}/static/brand/email-wordmark.png`;
  const text = `Your TurfSides verification code is ${o.code}\n\n${hello.replace(/&[^;]+;/g, '')}\n\nUse this code to ${what}: ${o.code}\n\nIt expires in ${o.minutes} minutes. Never share it with anyone, including TurfSides staff.\n\nIf you didn't ask for this, you can ignore this email.\n\nTurfSides`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F3EF;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#161B1D">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your TurfSides verification code is ${o.code}. It expires in ${o.minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px;overflow:hidden">
<tr><td style="background:#161B1D;padding:24px 28px"><img src="${logo}" width="171" height="32" alt="TurfSides" style="display:block;border:0;outline:none;height:32px;width:171px;color:#FFFFFF;font-size:22px;font-weight:800"></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 8px;font-size:16px">${hello}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:24px;color:#5C6468">Your verification code to ${what}:</p>
<div style="font-size:36px;font-weight:800;letter-spacing:10px;background:#F1FBC4;border-radius:16px;padding:18px 0;text-align:center;color:#161B1D">${o.code}</div>
<p style="margin:20px 0 0;font-size:14px;line-height:21px;color:#5C6468">It expires in ${o.minutes} minutes. Never share it with anyone, including TurfSides staff. If you didn’t ask for this, you can ignore this email.</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8A9196">TurfSides · Book a turf. Find your squad.</p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}
