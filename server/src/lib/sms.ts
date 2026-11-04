import { config, isProd } from '../config';
import { ApiError } from '../errors';

/**
 * SMS sender. 'console' logs codes (development only). 'http' posts to any
 * Bangladeshi SMS gateway that accepts a JSON request — adapt the body in one place.
 */
export async function sendSms(phone10: string, text: string) {
  const to = `880${phone10}`;
  if (config.SMS_PROVIDER === 'console') {
    if (isProd) throw new ApiError('not_configured', 'SMS is not configured yet.');
    console.info(`[sms:console] to=${to} text="${text}"`);
    return;
  }
  if (!config.SMS_HTTP_URL) throw new ApiError('not_configured', 'SMS is not configured yet.');
  const res = await fetch(config.SMS_HTTP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.SMS_HTTP_TOKEN ? { Authorization: `Bearer ${config.SMS_HTTP_TOKEN}` } : {}) },
    body: JSON.stringify({ to, message: text, sender_id: config.SMS_SENDER_ID }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new ApiError('internal', 'Could not send the SMS. Try again in a moment.');
}
