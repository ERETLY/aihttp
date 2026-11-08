import { NextResponse } from 'next/server';
import { authorized, POLICY } from '../../../../lib/policy';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    owner: 'demo',
    ttlSeconds: 60,
    policy: POLICY
  });
}
