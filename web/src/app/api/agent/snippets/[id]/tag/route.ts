// AI tagging — a Pro-only capability guarded by a boolean entitlement in the
// shared vault layer. Contrast with the allowance logic behind POST
// /api/agent/snippets: this is the simplest possible gate.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { tagSnippet } from '@/lib/vault';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await tagSnippet(user, id);
  if (!result.ok) {
    if ('notFound' in result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ error: 'payment_required', ...result.paywall }, { status: 402 });
  }
  return NextResponse.json({ snippet: result.snippet });
}
