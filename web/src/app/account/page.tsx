// Minimal account view, reached from a signed link the agent provides. Shows
// current plan (live from Salable), snippet count, and a Stripe billing-portal
// link for self-service subscription management.

import { prisma } from '@/lib/db';
import { getEntitlements } from '@/lib/entitlements';
import { verifySignedLink } from '@/lib/links';
import { createOwnerPortalLink } from '@/lib/salable';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = typeof params.t === 'string' ? params.t : '';
  const granteeId = token ? verifySignedLink(token, 'account') : null;
  const user = granteeId ? await prisma.user.findUnique({ where: { granteeId } }) : null;

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">This account link has expired</h1>
        <p className="text-neutral-600 dark:text-neutral-300">
          Ask the agent for your account and it will hand you a fresh link.
        </p>
      </div>
    );
  }

  const [entitlements, snippetCount, portalUrl] = await Promise.all([
    getEntitlements(user),
    prisma.snippet.count({ where: { userId: user.id } }),
    createOwnerPortalLink(user.granteeId).catch(() => null)
  ]);
  const isPro = entitlements.values.includes('unlimited_saves');

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Your account</h1>
      <dl className="space-y-3 rounded-xl border border-neutral-200 p-5 text-sm dark:border-neutral-800">
        <div className="flex justify-between">
          <dt className="text-neutral-500">Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-500">Plan</dt>
          <dd className="font-medium">{isPro ? 'Pro' : 'Free'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-500">Snippets saved</dt>
          <dd>{snippetCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-500">Active entitlements</dt>
          <dd>{entitlements.values.length ? entitlements.values.join(', ') : 'none'}</dd>
        </div>
      </dl>
      {isPro && portalUrl && (
        <a
          href={portalUrl}
          className="block w-full rounded-lg border border-neutral-300 px-5 py-2.5 text-center font-medium dark:border-neutral-700"
        >
          Manage billing
        </a>
      )}
    </div>
  );
}
