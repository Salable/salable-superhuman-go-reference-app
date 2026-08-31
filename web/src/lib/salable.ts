// Thin client for the Salable REST API (https://salable.app/docs/openapi/scalar).
//
// Envelope: detail responses are { type: 'object', data }, lists are
// { type: 'list', data, nextCursor, previousCursor, hasMore }. Errors carry
// { title, errors? }. All calls authenticate with `Authorization: Bearer <key>`.

import { randomUUID } from 'crypto';
import { config } from './config';

export interface SalableEntitlement {
  type: 'entitlement' | 'meter';
  value: string;
  /** End of the current billing period; null means the grant never expires. */
  expiryDate: string | null;
}

export interface EntitlementCheckResult {
  entitlements: SalableEntitlement[];
  signature: string;
}

export interface SalablePlan {
  id: string;
  name: string;
  productId: string;
  isActive?: boolean;
  trialPeriodDays?: number | null;
  entitlements?: unknown[];
  lineItems?: SalableLineItem[];
}

export interface SalableLineItem {
  id: string;
  name: string;
  slug: string;
  priceType: 'flat_rate' | 'per_seat' | 'metered' | 'token';
  intervalType: 'one_off' | 'recurring';
  prices?: SalablePrice[];
}

export interface SalablePrice {
  id: string;
  interval: 'day' | 'week' | 'month' | 'year' | null;
  intervalCount: number | null;
  currencyOptions?: Array<{ currency: string; unitAmount: number; isDefault?: boolean }>;
}

class SalableError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly body: unknown
  ) {
    super(`Salable API ${status}: ${title}`);
  }
}

async function salableFetch(
  path: string,
  init: { method?: string; body?: unknown; key?: string; idempotencyKey?: string } = {}
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${init.key ?? config.salable.secretKey}`
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;

  const response = await fetch(`${config.salable.apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store'
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function unwrap<T>(result: { status: number; body: unknown }, allow: number[] = [200, 201]): T {
  if (!allow.includes(result.status)) {
    const title =
      typeof result.body === 'object' && result.body !== null && 'title' in result.body
        ? String((result.body as { title: unknown }).title)
        : 'Unexpected response';
    throw new SalableError(result.status, title, result.body);
  }
  return (result.body as { data: T }).data;
}

/**
 * The integration hot path. Returns the grantee's active entitlements together
 * with Salable's signature over them, or null when Salable does not know the
 * grantee (404 means "unknown grantee", not "no access").
 */
export async function checkEntitlements(
  granteeId: string,
  owner?: string
): Promise<EntitlementCheckResult | null> {
  const params = new URLSearchParams({ granteeId });
  if (owner) params.set('owner', owner);
  const result = await salableFetch(`/api/entitlements/check?${params}`);
  if (result.status === 404) return null;
  return unwrap<EntitlementCheckResult>(result);
}

/**
 * Same check, made with the publishable key. Used by the relay endpoint that
 * backs the Pack's direct (Path 1) check, so the Pack exercises exactly what a
 * browser client would be allowed to call.
 */
export async function checkEntitlementsPublishable(granteeId: string, owner?: string) {
  const params = new URLSearchParams({ granteeId });
  if (owner) params.set('owner', owner);
  return salableFetch(`/api/entitlements/check?${params}`, { key: config.salable.publishableKey });
}

/** Mints a hosted Stripe Checkout link for the Pro plan, keyed on the grantee. */
export async function createCheckoutLink(options: {
  granteeId: string;
  email?: string;
}): Promise<string> {
  const { url } = unwrap<{ url: string }>(
    await salableFetch('/api/checkout', {
      method: 'POST',
      body: {
        planId: config.salable.proPlanId,
        // Single-user product: the payer and the beneficiary are the same person,
        // so Owner and Grantee share one identifier. A team product would put the
        // organisation as owner and a `grp_` group as grantee.
        owner: options.granteeId,
        grantee: options.granteeId,
        interval: 'month',
        intervalCount: 1,
        email: options.email,
        successUrl: `${config.appUrl}/purchase/success`,
        cancelUrl: `${config.appUrl}/purchase/cancelled`
      },
      idempotencyKey: randomUUID()
    })
  );
  return url;
}

/**
 * Records one unit of usage against the owner's meter. Fire-and-forget: Salable
 * queues it (204) and aggregates per billing period. A 404 means the owner has
 * no active subscription with this meter — expected for free-tier users, so it
 * is reported rather than thrown.
 */
export async function recordUsage(owner: string, increment = 1): Promise<'recorded' | 'no-metered-subscription'> {
  const result = await salableFetch('/api/usage/record', {
    method: 'POST',
    body: { owner, meterSlug: config.salable.meterSlug, increment },
    idempotencyKey: randomUUID()
  });
  if (result.status === 204) return 'recorded';
  if (result.status === 404) return 'no-metered-subscription';
  throw new SalableError(result.status, 'Failed to record usage', result.body);
}

/**
 * Fetches the Pro plan with enough detail to render a pricing page. The API's
 * `expand` only takes top-level tokens (verified live: `lineItems`,
 * `entitlements`, `product`, …), so prices and currency options are joined
 * from their list endpoints.
 */
export async function getProPlan(): Promise<SalablePlan | null> {
  const planResult = await salableFetch(
    `/api/plans/${config.salable.proPlanId}?expand=lineItems`
  );
  if (planResult.status === 404) return null;
  // Expanded relations come back as embedded list envelopes ({ data: [...] }).
  const plan = unwrap<Omit<SalablePlan, 'lineItems'> & { lineItems?: unknown }>(planResult);
  const rawLineItems = plan.lineItems as { data?: SalableLineItem[] } | SalableLineItem[] | undefined;
  const lineItems: SalableLineItem[] = Array.isArray(rawLineItems)
    ? rawLineItems
    : (rawLineItems?.data ?? []);

  const prices = unwrap<Array<SalablePrice & { lineItemId: string }>>(
    await salableFetch('/api/prices?limit=100')
  );
  const currencyOptions = unwrap<
    Array<{ priceId: string; currency: string; unitAmount: number; isDefault?: boolean }>
  >(await salableFetch('/api/currency-options?limit=100'));

  for (const lineItem of lineItems) {
    lineItem.prices = prices
      .filter(price => price.lineItemId === lineItem.id)
      .map(price => ({
        ...price,
        currencyOptions: currencyOptions.filter(option => option.priceId === price.id)
      }));
  }
  return { ...plan, lineItems };
}

/** Fetches the organisation's public signing key for entitlement signatures. */
export async function getSigningKey(): Promise<{ publicKey: string }> {
  const result = await salableFetch('/api/signing-keys');
  return unwrap<{ publicKey: string }>(result);
}

/** Creates a Stripe billing-portal session for the owner's self-service. */
export async function createOwnerPortalLink(owner: string): Promise<string | null> {
  const owners = unwrap<Array<{ id: string; value: string }>>(
    await salableFetch(`/api/owners?search=${encodeURIComponent(owner)}&limit=25`)
  );
  const match = owners.find(o => o.value === owner);
  if (!match) return null;
  const { url } = unwrap<{ url: string }>(
    await salableFetch(`/api/owners/${match.id}/portal`, {
      method: 'POST',
      body: { returnUrl: `${config.appUrl}/purchase/success` }
    })
  );
  return url;
}
