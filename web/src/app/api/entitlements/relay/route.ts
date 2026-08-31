// Path 1 relay: the Pack's direct entitlement check, without a second network
// domain.
//
// The Pack's one network domain is this app, so its "direct" Salable check is
// relayed here verbatim: we resolve the caller's verified grantee from their
// bearer token, make the check with the *publishable* key (exactly what a
// browser client is allowed to do), and return Salable's body untouched —
// signature included. The Pack then verifies the ECDSA signature itself, so it
// trusts Salable's signing key, not this server.
//
// If Superhuman approves salable.app as a second network domain for the Pack,
// the Pack can call Salable directly and this route becomes unnecessary; the
// verification code in the Pack is identical either way.

import { NextResponse } from 'next/server';
import { resolveBearerUser } from '@/lib/agent-auth';
import { checkEntitlementsPublishable, getSigningKey } from '@/lib/salable';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const result = await checkEntitlementsPublishable(user.granteeId, user.granteeId);

  // Salable's response body passes through untouched so the signature stays
  // verifiable. Only the grantee context and public key ride alongside.
  const publicKey = await getSigningKey()
    .then(k => k.publicKey)
    .catch(() => null);

  return NextResponse.json(
    {
      granteeId: user.granteeId,
      salableStatus: result.status,
      salableBody: result.body,
      publicKey
    },
    { status: 200 }
  );
}
