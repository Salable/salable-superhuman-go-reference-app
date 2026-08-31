// The identity anchor. The Pack calls this first in every flow: the bearer
// token Superhuman injects resolves to a user here, and the granteeId in the
// response is the only identity the rest of the system trusts.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { getEntitlements } from '@/lib/entitlements';
import { createSignedLink } from '@/lib/links';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') {
    // 401 signals Superhuman to run its refresh flow.
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const entitlements = await getEntitlements(user);
  return NextResponse.json({
    granteeId: user.granteeId,
    name: user.name,
    email: user.email,
    plan: entitlements.values.includes('unlimited_saves') ? 'pro' : 'free',
    entitlements: entitlements.values,
    // Signed, short-lived links the agent can hand to the user in chat — the
    // only way a Pack can take someone to the web.
    accountUrl: createSignedLink(user.granteeId, 'account'),
    upgradeUrl: createSignedLink(user.granteeId, 'upgrade')
  });
}
