// Snippet endpoints — the pass-through path (Path 2).
//
// POST is the paywall in action: resolve verified identity, then hand off to
// the shared vault layer (src/lib/vault.ts), which checks entitlements
// server-side, enforces the free allowance, records usage, and reports
// paywall hits. A 402 here carries a freshly minted checkout URL for the
// Pack to relay.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { listSnippets, saveSnippet } from '@/lib/vault';

export const dynamic = 'force-dynamic';

function unauthorised() {
  return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
}

export async function GET(request: Request) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') return unauthorised();

  const query = new URL(request.url).searchParams.get('query');
  return NextResponse.json({ snippets: await listSnippets(user, query) });
}

export async function POST(request: Request) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') return unauthorised();

  const body = (await request.json().catch(() => ({}))) as { content?: unknown; source?: unknown };
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : null;
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const result = await saveSnippet(user, content, source);
  if (!result.ok) {
    return NextResponse.json({ error: 'payment_required', ...result.paywall }, { status: 402 });
  }
  const { ok: _ok, ...payload } = result;
  return NextResponse.json(payload, { status: 201 });
}
