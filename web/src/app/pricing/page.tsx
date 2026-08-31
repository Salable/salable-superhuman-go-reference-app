// The pricing page renders live catalogue data from Salable, so a price or
// plan change in the Salable dashboard shows here without a deploy.

import { config } from '@/lib/config';
import { getProPlan, type SalablePlan } from '@/lib/salable';

export const dynamic = 'force-dynamic';

function formatPrice(plan: SalablePlan): string {
  const lineItem = plan.lineItems?.find(li => li.priceType === 'flat_rate');
  const price = lineItem?.prices?.find(p => p.interval === 'month');
  const option =
    price?.currencyOptions?.find(o => o.isDefault) ?? price?.currencyOptions?.[0];
  if (!option) return '—';
  const amount = (option.unitAmount / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: option.currency
  });
  return `${amount}/month`;
}

async function loadProPlan(): Promise<SalablePlan | null> {
  try {
    return await getProPlan();
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const proPlan = await loadProPlan();

  return (
    <div className="space-y-10">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
        <p className="text-neutral-600 dark:text-neutral-300">
          Start free. Upgrade from inside the agent when you need more.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-6 dark:border-neutral-800">
          <h2 className="text-xl font-semibold">Free</h2>
          <p className="mt-1 text-2xl font-bold">£0</p>
          <ul className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
            <li>✓ {config.freeSnippetAllowance} saves per month</li>
            <li>✓ Search your vault</li>
            <li>✗ AI tagging</li>
          </ul>
          <p className="mt-6 text-sm text-neutral-500">
            Included when you connect the agent — no card required.
          </p>
        </div>

        <div className="rounded-xl border-2 border-neutral-900 p-6 dark:border-white">
          <h2 className="text-xl font-semibold">{proPlan?.name ?? 'Pro'}</h2>
          <p className="mt-1 text-2xl font-bold">
            {proPlan ? formatPrice(proPlan) : '£—/month'}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
            <li>✓ Unlimited saves</li>
            <li>✓ Search your vault</li>
            <li>✓ AI tagging</li>
          </ul>
          <p className="mt-6 text-sm text-neutral-500">
            Upgrade from the agent: when you hit the free limit it hands you a personal
            checkout link. Purchases are tied to your connected account, so there is no
            separate sign-up here.
          </p>
          {!proPlan && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Live plan data unavailable — check SALABLE_API_KEY and SALABLE_PRO_PLAN_ID, and
              that the seed script has run.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
