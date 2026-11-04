/** Client-side validation is for UX only — the server re-validates everything. */
export const isBdMobile = (digits: string) => /^1[3-9]\d{8}$/.test(digits);
export const isEmail = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(v.trim());
export const isStrongPassword = (v: string) => v.length >= 8 && v.length <= 128;
export const isName = (v: string) => v.trim().length >= 2 && v.trim().length <= 80;
/** Sign-in identifier: email or BD mobile (any common format). */
export function normaliseIdentifier(v: string): { kind: 'phone' | 'email'; value: string } | null {
  const t = v.trim();
  if (isEmail(t)) return { kind: 'email', value: t.toLowerCase() };
  let d = t.replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return isBdMobile(d) ? { kind: 'phone', value: d } : null;
}
