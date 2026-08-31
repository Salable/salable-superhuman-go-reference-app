// AI tagging — a Pro-only capability guarded by a boolean entitlement.
// Contrast with the allowance logic in ../route.ts: this is the simplest
// possible gate, one entitlement value checked server-side.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { ENTITLEMENTS } from '@/lib/config';
import { prisma } from '@/lib/db';
import { hasEntitlement } from '@/lib/entitlements';
import { createSignedLink } from '@/lib/links';
import { createCheckoutLink } from '@/lib/salable';
import { suggestTags } from '@/lib/tagging';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  if (!(await hasEntitlement(user, ENTITLEMENTS.aiTagging))) {
    const checkoutUrl = await createCheckoutLink({ granteeId: user.granteeId, email: user.email });
    return NextResponse.json(
      {
        error: 'payment_required',
        message: 'AI tagging is a Pro feature. Upgrade to tag snippets automatically.',
        checkoutUrl,
        pricingUrl: createSignedLink(user.granteeId, 'upgrade')
      },
      { status: 402 }
    );
  }

  const { id } = await context.params;
  const snippet = await prisma.snippet.findFirst({ where: { id, userId: user.id } });
  if (!snippet) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const tags = suggestTags(snippet.content);
  await prisma.snippet.update({ where: { id: snippet.id }, data: { tags } });

  return NextResponse.json({ snippet: { id: snippet.id, tags } });
}
