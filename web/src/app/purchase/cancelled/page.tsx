import Link from 'next/link';

export default function PurchaseCancelledPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <h1 className="text-3xl font-bold">Checkout cancelled</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        No payment was taken. Your free plan carries on as before — ask the agent to
        upgrade whenever you are ready.
      </p>
      <Link href="/pricing" className="text-sm underline">
        Back to pricing
      </Link>
    </div>
  );
}
