// Salable webhook receiver.
//
// Contract (https://salable.app/docs/webhooks): HMAC-SHA256 over
// `${timestamp}.${rawBody}` in x-salable-signature (hex), ISO-8601 timestamp in
// x-salable-timestamp, reject anything older than five minutes, compare in
// constant time, respond 2xx within 15 seconds, and stay idempotent — Salable
// retries up to ten times with the same event id.

import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { invalidateEntitlements } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  const expected = createHmac('sha256', config.salable.webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

interface SalableEvent {
  id?: string;
  type?: string;
  data?: {
    subscription?: {
      owner?: string;
      subscriptionPlans?: Array<{ group?: { memberships?: Array<{ grantee?: { granteeId?: string } }> } }>;
    };
    owner?: { value?: string };
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-salable-timestamp') ?? '';
  const signature = request.headers.get('x-salable-signature') ?? '';

  if (!timestamp || !signature || !verifySignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  const age = Math.abs(Date.now() - Date.parse(timestamp));
  if (!Number.isFinite(age) || age > TIMESTAMP_TOLERANCE_MS) {
    return NextResponse.json({ error: 'stale timestamp' }, { status: 401 });
  }

  let event: SalableEvent;
  try {
    event = JSON.parse(rawBody) as SalableEvent;
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  // Subscription lifecycle events invalidate the cached entitlements so a
  // purchase or cancellation is visible on the very next agent request.
  // Invalidation is naturally idempotent, satisfying the retry contract.
  if (event.type?.startsWith('subscription.') || event.type === 'owner.updated') {
    const owners = new Set<string>();
    const subscription = event.data?.subscription;
    if (subscription?.owner) owners.add(subscription.owner);
    if (event.data?.owner?.value) owners.add(event.data.owner.value);
    for (const plan of subscription?.subscriptionPlans ?? []) {
      for (const membership of plan.group?.memberships ?? []) {
        if (membership.grantee?.granteeId) owners.add(membership.grantee.granteeId);
      }
    }
    // Owner and grantee share a value in this single-user product, so
    // invalidating by every identifier seen covers both shapes of payload.
    await Promise.all([...owners].map(value => invalidateEntitlements(value)));
  }

  return NextResponse.json({ received: true });
}
