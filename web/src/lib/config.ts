// Environment configuration, read lazily and validated at the point of use so a
// missing variable surfaces as a clear error from the code path that needs it.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  /** Public origin of this deployment, e.g. https://snippet-vault.vercel.app */
  get appUrl(): string {
    return required('APP_URL').replace(/\/$/, '');
  },

  salable: {
    get apiBase(): string {
      return optional('SALABLE_API_BASE', 'https://salable.app').replace(/\/$/, '');
    },
    /** Secret API key. Server-side only — never reaches the Pack or the browser. */
    get secretKey(): string {
      return required('SALABLE_API_KEY');
    },
    /** Publishable API key, safe for clients. Used by the entitlement relay. */
    get publishableKey(): string {
      return required('SALABLE_PUBLISHABLE_KEY');
    },
    /** The Pro plan to sell. Produced by scripts/seed-salable.mjs. */
    get proPlanId(): string {
      return required('SALABLE_PRO_PLAN_ID');
    },
    /** Signing secret of the Salable webhook destination for this app. */
    get webhookSecret(): string {
      return required('SALABLE_WEBHOOK_SECRET');
    },
    get meterSlug(): string {
      return optional('SALABLE_METER_SLUG', 'snippet_saves');
    }
  },

  oauth: {
    /** Client credentials Superhuman uses. Set the same values in Pack settings. */
    get clientId(): string {
      return required('SHGO_OAUTH_CLIENT_ID');
    },
    get clientSecret(): string {
      return required('SHGO_OAUTH_CLIENT_SECRET');
    },
    /**
     * Allowed redirect URIs, comma-separated. Superhuman's is
     * https://docs.superhuman.com/packsAuth/oauth2/{PACK_ID}; legacy Packs used
     * coda.io hosts. Exact-match checked.
     */
    get redirectUris(): string[] {
      return required('SHGO_OAUTH_REDIRECT_URIS')
        .split(',')
        .map(uri => uri.trim())
        .filter(Boolean);
    }
  },

  /** Secret for signing short-lived upgrade/account links handed out in chat. */
  get linkSecret(): string {
    return required('LINK_SECRET');
  },

  get freeSnippetAllowance(): number {
    return parseInt(optional('FREE_SNIPPET_ALLOWANCE', '10'), 10);
  },

  get entitlementCacheTtlSeconds(): number {
    return parseInt(optional('ENTITLEMENT_CACHE_TTL_SECONDS', '60'), 10);
  }
};

export const ENTITLEMENTS = {
  unlimitedSaves: 'unlimited_saves',
  aiTagging: 'ai_tagging'
} as const;
