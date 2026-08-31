// The OAuth consent screen — the install-time step where the user supplies
// their details. Superhuman opens this page when the user connects the agent;
// submitting posts to /api/oauth/consent which mints the code and redirects
// back to Superhuman.

import { isValidRedirectForClient, resolveClient } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const clientId = first(params.client_id);
  const redirectUri = first(params.redirect_uri);
  const responseType = first(params.response_type) || 'code';
  const state = first(params.state);
  const scope = first(params.scope) || 'agent';
  const codeChallenge = first(params.code_challenge);
  const codeChallengeMethod = first(params.code_challenge_method);
  const error = first(params.error);

  const client = clientId ? await resolveClient(clientId) : null;
  const requestValid =
    responseType === 'code' && !!client && isValidRedirectForClient(client, redirectUri);

  if (!requestValid) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Connection request invalid</h1>
        <p className="text-neutral-600 dark:text-neutral-300">
          This page is opened by Superhuman Go when you connect the Snippet Vault agent. The
          request is missing or carries an unrecognised client or redirect URI, so it cannot
          be approved. If you are setting the Pack up, check the OAuth client ID and the
          redirect URI allowlist match on both sides.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Connect Snippet Vault</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Superhuman Go is asking to connect your Snippet Vault account. Tell us who you are
          and we will create your vault — your free saves start straight away.
        </p>
      </div>

      {error === 'invalid_details' && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Please provide your name and a valid email address.
        </p>
      )}

      <form method="POST" action="/api/oauth/consent" className="space-y-4">
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />

        <label className="block text-sm font-medium">
          Your name
          <input
            name="name"
            type="text"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Connect and continue to Superhuman
        </button>
      </form>

      <p className="text-xs text-neutral-500">
        Reference-app note: this consent step is passwordless on purpose. In a real product
        this screen is your existing sign-in; the part that matters is that a stable,
        non-email grantee ID is minted here and used for every Salable call thereafter.
      </p>
    </div>
  );
}
