import Link from 'next/link';

// The agent's landing page. Any commercial agent needs one of these anyway —
// it is where the Superhuman Store listing, support links and pricing live.

export default function LandingPage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Save anything, from anywhere you work.
        </h1>
        <p className="max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
          Snippet Vault is an agent for Superhuman Go. Highlight text on any page, ask the
          agent to save it, and find it again later — without leaving what you were doing.
        </p>
        <div className="flex gap-4">
          <Link
            href="/pricing"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            See pricing
          </Link>
          <a
            href="https://superhuman.com/go"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-neutral-300 px-5 py-2.5 font-medium dark:border-neutral-700"
          >
            Get Superhuman Go
          </a>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          {
            title: '1. Install the agent',
            body: 'Add Snippet Vault from Superhuman Go and connect your account — that one sign-in is all the setup there is.'
          },
          {
            title: '2. Save as you browse',
            body: 'Highlight anything and tell the agent to save it. Ten free saves a month, unlimited on Pro.'
          },
          {
            title: '3. Find it later',
            body: 'Ask the agent for what you saved. Pro adds automatic tagging so retrieval gets smarter as you go.'
          }
        ].map(step => (
          <div
            key={step.title}
            className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800"
          >
            <h2 className="mb-2 font-semibold">{step.title}</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 font-semibold">For developers</h2>
        <p className="text-neutral-600 dark:text-neutral-300">
          This whole product is a reference application: a worked example of monetising a
          Superhuman Go agent with{' '}
          <a href="https://salable.app" className="underline" target="_blank" rel="noreferrer">
            Salable
          </a>
          . The source shows entitlement checks made directly from the agent before use, and
          pass-through API access enforced server-side, with checkout, webhooks and metering.
        </p>
      </section>
    </div>
  );
}
