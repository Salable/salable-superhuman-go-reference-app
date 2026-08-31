// Mints a Salable quick-checkout link. Reachable two ways:
//   - by the Pack (bearer token) when the agent needs an upgrade link, and
//   - by the /upgrade page (signed link token) when the user clicks through.
// Both resolve to a verified grantee before anything is minted.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { verifySignedLink } from '@/lib/links';
import { createCheckoutLink } from '@/lib/salable';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let granteeId: string | null = null;

  const bearerUser = await resolveBearerUser(request);
  if (bearerUser && bearerUser !== 'expired') {
    granteeId = bearerUser.granteeId;
  } else {
    const body = (await request.json().catch(() => ({}))) as { linkToken?: unknown };
    if (typeof body.linkToken === 'string') {
      granteeId = verifySignedLink(body.linkToken, 'upgrade');
    }
  }

  if (!granteeId) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { granteeId } });
  if (!user) {
    return NextResponse.json({ error: 'unknown grantee' }, { status: 404 });
  }

  const url = await createCheckoutLink({ granteeId: user.granteeId, email: user.email });
  return NextResponse.json({ url });
}
