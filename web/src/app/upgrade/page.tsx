// Personalised upgrade page, reached from a signed link the agent hands out in
// chat. The signature carries the grantee, so no login is needed and the
// checkout is minted for the right person.

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { verifySignedLink } from '@/lib/links';
import { createCheckoutLink } from '@/lib/salable';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function goToCheckout(formData: FormData) {
  'use server';
  const token = formData.get('t');
  if (typeof token !== 'string') redirect('/pricing');
  const granteeId = verifySignedLink(token, 'upgrade');
  if (!granteeId) redirect('/upgrade?t=expired');
  const user = await prisma.user.findUnique({ where: { granteeId } });
  if (!user) redirect('/pricing');
  const url = await createCheckoutLink({ granteeId: user.granteeId, email: user.email });
  redirect(url);
}

export default async function UpgradePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = typeof params.t === 'string' ? params.t : '';
  const granteeId = token ? verifySignedLink(token, 'upgrade') : null;
  const user = granteeId
    ? await prisma.user.findUnique({ where: { granteeId } })
    : null;

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">This upgrade link has expired</h1>
        <p className="text-neutral-600 dark:text-neutral-300">
          Upgrade links from the agent are personal and short-lived. Ask the agent to
          upgrade again and it will hand you a fresh one.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Upgrade to Pro</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Hello {user.name} — you are upgrading the vault connected to Superhuman Go.
          Unlimited saves and AI tagging, billed monthly, cancel any time.
        </p>
      </div>
      <form action={goToCheckout}>
        <input type="hidden" name="t" value={token} />
        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Continue to secure checkout
        </button>
      </form>
      <p className="text-xs text-neutral-500">
        Checkout is hosted by Stripe and managed by Salable. In test mode use card number
        4242&nbsp;4242&nbsp;4242&nbsp;4242 with any future expiry and CVC.
      </p>
    </div>
  );
}
