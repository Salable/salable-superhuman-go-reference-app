#!/usr/bin/env node
// Idempotent Salable catalogue seed for the Snippet Vault reference app.
//
// Creates (or finds) in the org your SALABLE_API_KEY belongs to:
//   Product "Snippet Vault"
//     Plan "Pro"
//       entitlements: unlimited_saves, ai_tagging
//       line item "Pro subscription"  — flat_rate, recurring, monthly, £9.99/mo (GBP default, USD option)
//         (unitAmount is given in MAJOR currency units — 9.99 means £9.99)
//       line item "Snippet saves"     — metered on `snippet_saves`, £0.00/unit
//         (zero-cost so usage recording is visible in Salable without charging;
//          real products would price this or drop it)
//
// Run with a TEST-mode secret key. Re-running updates the same objects.
//
//   SALABLE_API_KEY=sk_test_... node scripts/seed-salable.mjs
//
// Prints the env values to copy into .env when done.

const API_BASE = (process.env.SALABLE_API_BASE ?? 'https://salable.app').replace(/\/$/, '');
const API_KEY = process.env.SALABLE_API_KEY;
const PRODUCT_NAME = process.env.SEED_PRODUCT_NAME ?? 'Snippet Vault';
const PLAN_NAME = process.env.SEED_PLAN_NAME ?? 'Pro';
const METER_SLUG = process.env.SALABLE_METER_SLUG ?? 'snippet_saves';

if (!API_KEY) {
  console.error('Set SALABLE_API_KEY (a test-mode secret key) before running.');
  process.exit(1);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} -> ${response.status}\n${JSON.stringify(parsed, null, 2)}`
    );
  }
  return parsed;
}

async function findByName(path, name) {
  const result = await api(`${path}?limit=100`);
  const items = Array.isArray(result?.data) ? result.data : [];
  return items.find(item => item.name === name) ?? null;
}

async function main() {
  console.log(`Seeding Salable catalogue at ${API_BASE} ...`);

  // 1. Product (create once, reuse thereafter).
  let product = await findByName('/api/products', PRODUCT_NAME);
  if (product) {
    console.log(`✓ Product "${PRODUCT_NAME}" already exists (${product.id})`);
  } else {
    product = (await api('/api/products', { method: 'POST', body: { name: PRODUCT_NAME } })).data;
    console.log(`✓ Created product "${PRODUCT_NAME}" (${product.id})`);
  }

  // 2. Entitlements must exist before the plan can reference them (by id).
  const entitlementIds = [];
  for (const name of ['unlimited_saves', 'ai_tagging']) {
    let entitlement = await findByName('/api/entitlements', name);
    if (entitlement) {
      console.log(`✓ Entitlement "${name}" already exists`);
    } else {
      entitlement = (await api('/api/entitlements', { method: 'POST', body: { name } })).data;
      console.log(`✓ Created entitlement "${name}"`);
    }
    entitlementIds.push(entitlement.id);
  }

  // 3. The Pro plan, saved whole via /api/plans/save — line items, prices and
  //    entitlements in a single call. Passing the existing plan id makes the
  //    save an update, keeping the script idempotent.
  const planList = await api('/api/plans?limit=100');
  const existingPlan = (planList?.data ?? []).find(
    plan => plan.name === PLAN_NAME && plan.productId === product.id
  ) ?? null;

  const planBody = {
    ...(existingPlan ? { id: existingPlan.id } : {}),
    productId: product.id,
    name: PLAN_NAME,
    entitlements: entitlementIds,
    isActive: true,
    lineItems: [
      {
        name: 'Pro subscription',
        slug: 'snippet_vault_pro',
        priceType: 'flat_rate',
        intervalType: 'recurring',
        billingScheme: 'fixed',
        tiersMode: null,
        minQuantity: 1,
        isUnlimited: true,
        prices: [
          {
            defaultCurrency: 'GBP',
            interval: 'month',
            intervalCount: 1,
            currencyOptions: [
              { currency: 'GBP', unitAmount: 9.99 },
              { currency: 'USD', unitAmount: 12.99 }
            ]
          }
        ]
      },
      {
        name: 'Snippet saves',
        slug: 'snippet_vault_saves',
        priceType: 'metered',
        intervalType: 'recurring',
        billingScheme: 'per_unit',
        tiersMode: null,
        minQuantity: 1,
        isUnlimited: false,
        meterSlug: METER_SLUG,
        unitLabel: 'save',
        prices: [
          {
            defaultCurrency: 'GBP',
            interval: 'month',
            intervalCount: 1,
            currencyOptions: [
              { currency: 'GBP', unitAmount: 0 },
              { currency: 'USD', unitAmount: 0 }
            ]
          }
        ]
      }
    ]
  };

  const saved = await api('/api/plans/save', { method: 'POST', body: planBody });
  const planId = saved?.data?.id ?? existingPlan?.id;
  console.log(`✓ ${existingPlan ? 'Updated' : 'Created'} plan "${PLAN_NAME}" (${planId})`);

  // 3. Optional: webhook destination, when APP_URL is a public origin.
  const appUrl = process.env.APP_URL;
  if (appUrl && !appUrl.includes('localhost')) {
    const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/salable`;
    const existing = await api('/api/webhooks?limit=100').catch(() => null);
    const already = (existing?.data ?? []).find(w => w.url === webhookUrl);
    if (already) {
      console.log(`✓ Webhook already registered for ${webhookUrl}`);
    } else {
      const webhook = await api('/api/webhooks', {
        method: 'POST',
        body: {
          url: webhookUrl,
          events: ['subscription_created', 'subscription_updated', 'subscription_cancelled']
        }
      }).catch(error => {
        console.warn(`! Could not register webhook automatically:\n${error.message}`);
        return null;
      });
      if (webhook) {
        console.log(`✓ Registered webhook for ${webhookUrl}`);
        console.log(`  SALABLE_WEBHOOK_SECRET=${webhook.data.secret}`);
      }
    }
  } else {
    console.log('- Skipped webhook registration (APP_URL unset or localhost). Register');
    console.log(`  <your-app>/api/webhooks/salable in the dashboard for subscription.* events.`);
  }

  console.log('\nAdd to web/.env:');
  console.log(`  SALABLE_PRO_PLAN_ID=${planId}`);
  console.log(`  SALABLE_METER_SLUG=${METER_SLUG}`);
  console.log('\nStill needed from the Salable dashboard:');
  console.log('  SALABLE_PUBLISHABLE_KEY  (Settings -> API keys)');
  console.log('  SALABLE_WEBHOOK_SECRET   (printed when the webhook is registered, or from the dashboard)');
}

main().catch(error => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
