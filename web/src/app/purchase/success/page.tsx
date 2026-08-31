export default function PurchaseSuccessPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <h1 className="text-3xl font-bold">You&apos;re on Pro 🎉</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        Your payment is confirmed. Head back to Superhuman Go — the agent picks up your new
        plan on its next request. Unlimited saves and AI tagging are live.
      </p>
      <p className="text-sm text-neutral-500">
        (Salable notifies this application by webhook the moment the subscription is
        created, so there is nothing to refresh or re-connect.)
      </p>
    </div>
  );
}
