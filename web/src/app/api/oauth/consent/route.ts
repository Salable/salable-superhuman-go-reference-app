// Handles the consent form posted from /oauth/authorize.
//
// This is the install-time moment where the user supplies their details. It is
// intentionally passwordless — a reference stand-in for whatever real
// authentication your product already has (see docs/approaches.md). Users are
// upserted by email so reconnecting maps back to the same account and the same
// grantee ID.

import { NextResponse } from 'next/server';
import { newGranteeId } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { createAuthCode, isValidRedirectForClient, resolveClient } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const form = await request.formData();
  const get = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };

  const name = get('name');
  const email = get('email').toLowerCase();
  const clientId = get('client_id');
  const redirectUri = get('redirect_uri');
  const state = get('state');
  const scope = get('scope') || 'agent';
  const codeChallenge = get('code_challenge');
  const codeChallengeMethod = get('code_challenge_method');

  // Re-validated here, not just at render time: the form is an untrusted client.
  const client = await resolveClient(clientId);
  if (!client || !isValidRedirectForClient(client, redirectUri)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const retry = new URL('/oauth/authorize', request.url);
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string' && key !== 'name' && key !== 'email') retry.searchParams.set(key, value);
    }
    retry.searchParams.set('error', 'invalid_details');
    return NextResponse.redirect(retry, 303);
  }

  // The grantee ID is minted once per account and never derived from the email:
  // Salable rejects email identifiers, and opaque IDs survive address changes.
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, granteeId: newGranteeId() },
    update: { name }
  });

  const code = await createAuthCode({
    userId: user.id,
    clientId,
    redirectUri,
    scope,
    codeChallenge: codeChallenge || undefined,
    codeChallengeMethod: codeChallengeMethod || undefined
  });

  const destination = new URL(redirectUri);
  destination.searchParams.set('code', code);
  if (state) destination.searchParams.set('state', state);
  return NextResponse.redirect(destination, 303);
}
