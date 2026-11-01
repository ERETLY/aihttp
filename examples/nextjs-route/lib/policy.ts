import { timingSafeEqual } from 'node:crypto';

export const POLICY = {
  allow: ['checkout_submit', 'support_lookup'],
  deny: ['delete_account'],
  confirm: ['checkout_submit'],
  readOnly: false,
  maxActions: 40
};

export function authorized(request: Request): boolean {
  const expected = process.env.AGENT_TOKEN || '';
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
