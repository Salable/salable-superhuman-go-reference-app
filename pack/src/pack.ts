import * as sdk from "@codahq/packs-sdk";
import { verifyEntitlementsSignature, type SalableEntitlement } from "./salable-verify";

/**
 * Snippet Vault — a paid Superhuman Go agent, monetised with Salable.
 *
 * This Pack demonstrates the two enforcement paths a paid agent needs:
 *
 *   Path 1 — the agent checks Salable's entitlement checker BEFORE the user
 *   accesses gated capability. `CheckAccess` fetches the entitlement check
 *   (publishable key semantics), verifies Salable's ECDSA signature over the
 *   response in Pack code, and reports plan status. The chat skill is
 *   instructed to call it first.
 *
 *   Path 2 — every action passes through the Vercel web application, which
 *   re-checks entitlements server-side with the secret key. Path 1 is fast,
 *   front-of-house gating; Path 2 is the guard the LLM cannot route around.
 *   When Path 2 answers 402, the formula returns the checkout link for the
 *   agent to relay — a Pack cannot open a browser, so links in chat are the
 *   whole upgrade UX.
 *
 * Identity: the platform injects the user's own OAuth token into every fetch
 * to APP_DOMAIN. Whoever that token resolves to *is* the user — nothing the
 * LLM asserts about identity is ever sent or believed.
 */
export const pack = sdk.newPack();

/**
 * Deployment constants. A Pack has no runtime configuration, so these are
 * compile-time values — edit before `packs upload`.
 */
const APP_DOMAIN = "snippet-vault-liard.vercel.app"; // your Vercel deployment
const APP_API = `https://${APP_DOMAIN}/api`;

/**
 * Path 1 transport. `relay` routes the Salable check through the app's
 * /api/entitlements/relay endpoint (single network domain, no approval
 * needed); the response body and signature come from Salable untouched, and
 * are verified here regardless. Switch to `direct` once Superhuman support
 * has approved salable.app as a second network domain for this Pack — then
 * also uncomment the addNetworkDomain line and set the publishable key.
 */
const SALABLE_CHECK_MODE: "relay" | "direct" = "relay";
const SALABLE_API_BASE = "https://salable.app";
const SALABLE_PUBLISHABLE_KEY = "pk_test_replace_me"; // client-safe by design
/**
 * Pinning the signing key in the Pack makes the trust chain explicit: paste
 * your organisation's public key (GET /api/signing-keys) here. Left empty,
 * the relay's copy of the key is used — fine for the demo, weaker in
 * principle since the relay could then swap both body and key.
 */
const SALABLE_SIGNING_PUBLIC_KEY = "";

pack.addNetworkDomain(APP_DOMAIN);
// Second domains need Superhuman support approval — see docs/approaches.md.
// pack.addNetworkDomain("salable.app");

/**
 * Per-user OAuth against the web application. Connecting the agent walks the
 * user through /oauth/authorize (where they supply their details and the app
 * mints their grantee ID) and hands Superhuman the bearer token its fetcher
 * injects from then on.
 */
pack.setUserAuthentication({
  type: sdk.AuthenticationType.OAuth2,
  authorizationUrl: `https://${APP_DOMAIN}/oauth/authorize`,
  tokenUrl: `https://${APP_DOMAIN}/api/oauth/token`,
  scopes: ["agent"],
  useProofKeyForCodeExchange: true,
  getConnectionName: async function (context) {
    const response = await context.fetcher.fetch({
      method: "GET",
      url: `${APP_API}/agent/whoami`,
    });
    return `${response.body.name} (${response.body.plan})`;
  },
});

interface WhoAmI {
  granteeId: string;
  name: string;
  email: string;
  plan: "free" | "pro";
  entitlements: string[];
  accountUrl: string;
  upgradeUrl: string;
}

/** Verified identity — resolved from the injected token, never from the LLM. */
async function getCurrentUser(context: sdk.ExecutionContext): Promise<WhoAmI> {
  const response = await context.fetcher.fetch({
    method: "GET",
    url: `${APP_API}/agent/whoami`,
    // Entitlement-bearing responses must never be served stale from the
    // fetcher cache — a cancelled subscription has to take effect.
    cacheTtlSecs: 0,
  });
  return response.body as WhoAmI;
}

/**
 * 402 handling: the backend's paywall responses carry a message and links.
 * Returning them as the formula result (rather than throwing) lets the agent
 * relay the upgrade link in chat.
 */
function paywallReply(body: {
  message?: string;
  checkoutUrl?: string;
  pricingUrl?: string;
}): string {
  const parts = [body.message ?? "This feature needs a Pro subscription."];
  if (body.checkoutUrl) parts.push(`Checkout link (share with the user): ${body.checkoutUrl}`);
  if (body.pricingUrl) parts.push(`Plan details: ${body.pricingUrl}`);
  return parts.join("\n");
}

function isPaymentRequired(error: unknown): error is sdk.StatusCodeError {
  return sdk.StatusCodeError.isStatusCodeError(error) && error.statusCode === 402;
}

// ---------------------------------------------------------------------------
// Path 1 — check Salable's entitlement response before using the agent
// ---------------------------------------------------------------------------

interface AccessReport {
  plan: string;
  entitlements: string[];
  signatureVerified: boolean;
  checkedVia: string;
  upgradeUrl: string;
  detail: string;
}

const accessSchema = sdk.makeObjectSchema({
  properties: {
    plan: { type: sdk.ValueType.String },
    entitlements: { type: sdk.ValueType.Array, items: { type: sdk.ValueType.String } },
    signatureVerified: { type: sdk.ValueType.Boolean },
    checkedVia: { type: sdk.ValueType.String },
    upgradeUrl: { type: sdk.ValueType.String },
    detail: { type: sdk.ValueType.String },
  },
  displayProperty: "plan",
});

async function checkAccess(context: sdk.ExecutionContext): Promise<AccessReport> {
  const user = await getCurrentUser(context);

  let entitlements: SalableEntitlement[] = [];
  let signature = "";
  let publicKey = SALABLE_SIGNING_PUBLIC_KEY;
  let checkedVia: string;
  let salableStatus: number;

  if ((SALABLE_CHECK_MODE as string) === "direct") {
    // Direct to Salable with the publishable key — requires salable.app as an
    // approved second network domain. The manually set Authorization header is
    // possible because the Pack's OAuth credential is bound to APP_DOMAIN.
    checkedVia = "direct (salable.app)";
    const params = `granteeId=${encodeURIComponent(user.granteeId)}&owner=${encodeURIComponent(user.granteeId)}`;
    try {
      const response = await context.fetcher.fetch({
        method: "GET",
        url: `${SALABLE_API_BASE}/api/entitlements/check?${params}`,
        headers: { Authorization: `Bearer ${SALABLE_PUBLISHABLE_KEY}` },
        cacheTtlSecs: 0,
        disableAuthentication: true,
      });
      salableStatus = response.status;
      entitlements = response.body?.data?.entitlements ?? [];
      signature = response.body?.data?.signature ?? "";
    } catch (error) {
      if (sdk.StatusCodeError.isStatusCodeError(error) && error.statusCode === 404) {
        salableStatus = 404; // unknown grantee — no purchase yet
      } else {
        throw error;
      }
    }
  } else {
    // Relayed through the app: Salable's body and signature pass through
    // untouched, and are verified below against Salable's signing key.
    checkedVia = "relay (app domain)";
    const response = await context.fetcher.fetch({
      method: "GET",
      url: `${APP_API}/entitlements/relay`,
      cacheTtlSecs: 0,
    });
    salableStatus = response.body.salableStatus;
    const salableBody = response.body.salableBody;
    entitlements = salableBody?.data?.entitlements ?? [];
    signature = salableBody?.data?.signature ?? "";
    if (!publicKey && response.body.publicKey) {
      publicKey = response.body.publicKey;
    }
  }

  const values = entitlements.map(e => e.value);
  const signatureVerified =
    salableStatus === 200 && !!signature && !!publicKey
      ? verifyEntitlementsSignature(entitlements, signature, publicKey)
      : false;

  if (salableStatus === 200 && signature && publicKey && !signatureVerified) {
    // A present-but-invalid signature means the response cannot be trusted.
    // Fail closed and say so.
    throw new sdk.UserVisibleError(
      "The entitlement response failed signature verification, so access cannot be confirmed. Please try again."
    );
  }

  const plan = values.includes("unlimited_saves") ? "pro" : "free";
  const detail =
    salableStatus === 404
      ? "Salable has not seen this grantee yet — no purchase has been made. Free tier applies."
      : plan === "pro"
        ? "Pro subscription active."
        : "Free tier. Upgrade unlocks unlimited saves and AI tagging.";

  return {
    plan,
    entitlements: values,
    signatureVerified,
    checkedVia,
    upgradeUrl: user.upgradeUrl,
    detail,
  };
}

pack.addFormula({
  name: "CheckAccess",
  description:
    "Checks the user's Snippet Vault plan against Salable's entitlement checker, " +
    "verifying the response signature. Call before using gated features, and to " +
    "answer questions about the user's plan.",
  parameters: [],
  resultType: sdk.ValueType.Object,
  schema: accessSchema,
  // Never cache an entitlement decision at the formula layer either.
  cacheTtlSecs: 0,
  execute: async function ([], context) {
    return checkAccess(context);
  },
});

// ---------------------------------------------------------------------------
// Path 2 — pass-through API access, enforced by the web application
// ---------------------------------------------------------------------------

pack.addFormula({
  name: "WhoAmI",
  description: "Returns the account the agent is acting for, and its plan.",
  parameters: [],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([], context) {
    const user = await getCurrentUser(context);
    return `${user.name} <${user.email}> — ${user.plan} plan. Account: ${user.accountUrl}`;
  },
});

pack.addFormula({
  name: "SaveSnippet",
  description:
    "Saves a snippet of text to the user's vault. Free accounts have a monthly " +
    "allowance; when it is used up this returns an upgrade link to share.",
  isAction: true,
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "content",
      description: "The text to save, exactly as the user wants it kept.",
    }),
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "source",
      description: "URL of the page the text came from.",
      instructions: "The URL of the page on screen, if there is one. Omit rather than invent.",
      optional: true,
    }),
  ],
  resultType: sdk.ValueType.String,
  execute: async function ([content, source], context) {
    try {
      const response = await context.fetcher.fetch({
        method: "POST",
        url: `${APP_API}/agent/snippets`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source }),
      });
      const { plan, remainingFreeSaves } = response.body;
      if (plan === "pro") {
        return "Saved to your vault.";
      }
      return `Saved to your vault. ${remainingFreeSaves} free save${remainingFreeSaves === 1 ? "" : "s"} left this month.`;
    } catch (error) {
      if (isPaymentRequired(error)) {
        return paywallReply(error.body ?? {});
      }
      throw error;
    }
  },
});

const snippetSchema = sdk.makeObjectSchema({
  properties: {
    id: { type: sdk.ValueType.String },
    content: { type: sdk.ValueType.String },
    source: { type: sdk.ValueType.String },
    tags: { type: sdk.ValueType.Array, items: { type: sdk.ValueType.String } },
    createdAt: { type: sdk.ValueType.String },
  },
  displayProperty: "content",
  idProperty: "id",
});

pack.addFormula({
  name: "ListSnippets",
  description: "Lists or searches the user's saved snippets.",
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "query",
      description: "Keywords to search for. Omit to list the most recent snippets.",
      optional: true,
    }),
  ],
  resultType: sdk.ValueType.Array,
  items: snippetSchema,
  execute: async function ([query], context) {
    const url = query
      ? `${APP_API}/agent/snippets?query=${encodeURIComponent(query)}`
      : `${APP_API}/agent/snippets`;
    const response = await context.fetcher.fetch({ method: "GET", url, cacheTtlSecs: 0 });
    return response.body.snippets ?? [];
  },
});

pack.addFormula({
  name: "TagSnippet",
  description:
    "Automatically tags a saved snippet (Pro feature). Returns an upgrade link " +
    "when the user's plan does not include AI tagging.",
  isAction: true,
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "snippetId",
      description: "The id of the snippet to tag, from ListSnippets or SaveSnippet.",
    }),
  ],
  resultType: sdk.ValueType.String,
  execute: async function ([snippetId], context) {
    try {
      const response = await context.fetcher.fetch({
        method: "POST",
        url: `${APP_API}/agent/snippets/${encodeURIComponent(snippetId)}/tag`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const tags: string[] = response.body.snippet?.tags ?? [];
      return tags.length ? `Tagged: ${tags.join(", ")}.` : "No tags suggested for this snippet.";
    } catch (error) {
      if (isPaymentRequired(error)) {
        return paywallReply(error.body ?? {});
      }
      throw error;
    }
  },
});

// ---------------------------------------------------------------------------
// Skills — routing and behaviour. Prompts are UX, never enforcement: both
// paths above hold regardless of what the LLM decides to do.
// ---------------------------------------------------------------------------

pack.addSkill({
  name: "SnippetVault",
  displayName: "Snippet Vault",
  description:
    "Save snippets of text from any page to a personal vault, find them again, " +
    "and manage the user's Snippet Vault plan.",
  prompt: `
    You are Snippet Vault: you save text the user wants to keep and find it again
    later. Keep replies short and act quickly.

    Before the first save or tag in a conversation, call CheckAccess once so you
    know the user's plan. Do not repeat it before every action.

    Saving: when the user asks to save something (often highlighted text on
    screen), call SaveSnippet with the exact text and the page URL as source.
    If the result contains a checkout or plan link, share the link with the user
    and explain what Pro adds — do not apologise repeatedly or push.

    Finding: use ListSnippets, with a query when the user is looking for
    something specific.

    Tagging: TagSnippet is a Pro feature. If the user asks for it on the free
    plan, the result gives you an upgrade link to share.

    Questions about their plan or account: use CheckAccess and WhoAmI; share the
    account link when they want to manage billing.

    Never ask the user who they are and never pass identity to any tool — the
    connected account decides that. Links you receive from tools are personal to
    this user; share them in chat as-is.
  `,
  tools: [{ type: sdk.ToolType.Pack }],
  // Pinned so behaviour doesn't drift with the platform default.
  models: [{ model: sdk.SkillModel.OpenAIGPT5 }],
});

/**
 * The front door (Path 1 in action): the entitlement check runs the moment the
 * panel opens, before any capability is used, and the greeting reflects it.
 */
pack.setBenchInitializationSkill({
  name: "Welcome",
  displayName: "Welcome",
  description: "Check the user's plan and greet them accordingly.",
  prompt: `
    Call CheckAccess. Then greet the user in one short sentence: on pro, confirm
    everything is unlocked; on free, mention how to save and that Pro adds
    unlimited saves and AI tagging (do not include links unless they ask).
  `,
  tools: [{ type: sdk.ToolType.Pack, formulas: [{ formulaName: "CheckAccess" }] }],
});
