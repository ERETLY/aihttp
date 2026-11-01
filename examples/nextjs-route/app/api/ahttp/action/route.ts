import { NextResponse } from 'next/server';
import { authorized, POLICY } from '../../../../lib/policy';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let body: { id?: string; intent?: string };
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const intent = String(body.intent || '');
  if (POLICY.deny.includes(intent)) {
    return NextResponse.json({ ok: false, error: 'policy_denied' }, { status: 403 });
  }
  if (!POLICY.allow.includes(intent)) {
    return NextResponse.json({ ok: false, error: 'not_allowed' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, intent });
}
