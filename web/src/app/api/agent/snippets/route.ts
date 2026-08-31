// Snippet endpoints — the pass-through path (Path 2).
//
// POST is the paywall in action: resolve verified identity, check entitlements
// server-side, enforce the free allowance, record usage, and when the wall is
// hit answer 402 with a freshly minted checkout URL for the Pack to relay.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { config, ENTITLEMENTS } from '@/lib/config';
import { prisma } from '@/lib/db';
import { getEntitlements } from '@/lib/entitlements';
import { createSignedLink } from '@/lib/links';
import { createCheckoutLink, recordUsage } from '@/lib/salable';

export const dynamic = 'force-dynamic';

function unauthorised() {
  return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function GET(request: Request) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') return unauthorised();

  const url = new URL(request.url);
  const query = url.searchParams.get('query')?.toLowerCase() ?? '';

  const snippets = await prisma.snippet.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  const matches = query
    ? snippets.filter(
        s => s.content.toLowerCase().includes(query) || s.tags.some(t => t.includes(query))
      )
    : snippets;

  return NextResponse.json({
    snippets: matches.slice(0, 25).map(s => ({
      id: s.id,
      content: s.content,
      source: s.source,
      tags: s.tags,
      createdAt: s.createdAt.toISOString()
    }))
  });
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

  const entitlements = await getEntitlements(user);
  const isPro = entitlements.values.includes(ENTITLEMENTS.unlimitedSaves);

  if (!isPro) {
    const savedThisMonth = await prisma.snippet.count({
      where: { userId: user.id, createdAt: { gte: monthStart() } }
    });
    if (savedThisMonth >= config.freeSnippetAllowance) {
      // The paywall. The checkout URL is minted per-request and carries the
      // verified grantee — the LLM only ever relays it.
      const checkoutUrl = await createCheckoutLink({
        granteeId: user.granteeId,
        email: user.email
      });
      return NextResponse.json(
        {
          error: 'payment_required',
          message:
            `You have used all ${config.freeSnippetAllowance} free saves for this month. ` +
            'Upgrade to Pro for unlimited saves and AI tagging.',
          checkoutUrl,
          pricingUrl: createSignedLink(user.granteeId, 'upgrade')
        },
        { status: 402 }
      );
    }
  }

  const snippet = await prisma.snippet.create({
    data: { userId: user.id, content, source }
  });

  // Metering demo: Pro subscriptions carry a zero-cost metered line item on the
  // snippet_saves meter, so recorded usage is visible in Salable per billing
  // period. Free users have no metered subscription — Salable answers 404 and
  // we carry on; their allowance is the local count above.
  const usage = await recordUsage(user.granteeId).catch(() => 'error' as const);

  const remaining = isPro
    ? null
    : config.freeSnippetAllowance -
      (await prisma.snippet.count({ where: { userId: user.id, createdAt: { gte: monthStart() } } }));

  return NextResponse.json(
    {
      snippet: { id: snippet.id, content: snippet.content, source: snippet.source },
      plan: isPro ? 'pro' : 'free',
      remainingFreeSaves: remaining,
      usageRecorded: usage === 'recorded'
    },
    { status: 201 }
  );
}
