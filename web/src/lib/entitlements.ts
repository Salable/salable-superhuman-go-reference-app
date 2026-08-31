// The server-side entitlement guard (Path 2). Every agent-facing endpoint calls
// through here; the Pack cannot route around it whatever the LLM decides.
//
// Results are cached briefly (default 60s) and invalidated by Salable's
// subscription webhooks, so a cancellation propagates on the webhook rather than
// waiting out a long TTL.

import type { User } from '@prisma/client';
import { config } from './config';
import { prisma } from './db';
import { checkEntitlements, type SalableEntitlement } from './salable';

export interface EntitlementState {
  /** Active entitlement/meter values, e.g. "unlimited_saves". */
  values: string[];
  entitlements: SalableEntitlement[];
  /** True when Salable has never seen this grantee (no purchase yet). */
  unknownGrantee: boolean;
  fromCache: boolean;
}

export async function getEntitlements(user: User): Promise<EntitlementState> {
  const cached = await prisma.entitlementCache.findUnique({ where: { userId: user.id } });
  if (cached) {
    const ageSeconds = (Date.now() - cached.fetchedAt.getTime()) / 1000;
    if (ageSeconds < config.entitlementCacheTtlSeconds) {
      const payload = cached.payload as unknown as Omit<EntitlementState, 'fromCache'>;
      return { ...payload, fromCache: true };
    }
  }

  // Passing owner as well as granteeId scopes the check and includes any meter
  // slugs the owner's subscriptions carry.
  const result = await checkEntitlements(user.granteeId, user.granteeId);
  const state: Omit<EntitlementState, 'fromCache'> = result
    ? {
        values: result.entitlements.map(e => e.value),
        entitlements: result.entitlements,
        unknownGrantee: false
      }
    : { values: [], entitlements: [], unknownGrantee: true };

  await prisma.entitlementCache.upsert({
    where: { userId: user.id },
    create: { userId: user.id, payload: state as object },
    update: { payload: state as object, fetchedAt: new Date() }
  });

  return { ...state, fromCache: false };
}

export async function hasEntitlement(user: User, value: string): Promise<boolean> {
  const state = await getEntitlements(user);
  return state.values.includes(value);
}

/** Called by the Salable webhook receiver when a subscription changes. */
export async function invalidateEntitlements(granteeId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { granteeId } });
  if (!user) return;
  await prisma.entitlementCache.deleteMany({ where: { userId: user.id } });
}
