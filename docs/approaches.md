# Integration approaches: Salable × Superhuman Go

This reference application demonstrates how to monetise a Superhuman Go agent with [Salable](https://salable.app). This page explains the approaches available, which ones the code builds, and the platform constraints that drive the design.

## The platform constraints that shape everything

A Superhuman Go agent is a **Pack**: TypeScript uploaded to and executed by Superhuman's platform in an isolated VM. Five constraints dominate any payments design:

1. **One authentication type per Pack.** The platform injects the user's credential into fetches; Pack code never sees it. You cannot hold a second credential (such as a Salable secret key) safely in a Pack.
2. **One network domain by default.** Additional domains need a Superhuman support approval.
3. **No persistent storage, no redirects, ~60-second execution ceiling.** Checkout can only ever be a URL handed to the user in chat.
4. **The only trustworthy identity is resolved server-side from the injected credential.** The user's name and email that Go injects into prompts are convenience context, not proof — and anything the LLM passes as a parameter can be manipulated. Enforcement must live in code the LLM calls, never in prompt text.
5. **Caching lies about entitlements.** GET fetches and formula results are cached (5 minutes by default). Entitlement checks must set `cacheTtlSecs: 0`; action formulas are never cached, which is why guards inside actions are inherently fresh.

There is **no native monetisation for third-party agents** in Superhuman Go today: no paid listings, no revenue share, no billing APIs. Whatever you charge, you charge on your side. That is the gap Salable fills.

## Path 1 — check Salable's entitlement response before the agent is used

**Built in this repo.** The Pack's `CheckAccess` formula ([pack/src/pack.ts](../pack/src/pack.ts)) checks Salable's entitlement checker for the verified grantee *before* gated capability runs — the bench-initialisation skill calls it the moment the panel opens, and the chat skill is instructed to call it before the first save.

What makes this trustworthy rather than decorative is **signature verification**. Every Salable entitlement response is signed (ECDSA P-256/SHA-256) with a per-organisation key. The Pack verifies that signature itself ([pack/src/salable-verify.ts](../pack/src/salable-verify.ts), [pack/src/p256.ts](../pack/src/p256.ts)), so it trusts Salable's signing key — not whichever server relayed the bytes.

Two transports, switched by a constant in the Pack:

- **`relay` (default):** the check is routed through `/api/entitlements/relay` on the app's own domain. Salable's body and signature pass through verbatim; the Pack verifies them regardless. No second network domain needed.
- **`direct`:** the Pack calls `salable.app` itself with the **publishable** key (client-safe by design, sent as a manually set bearer header with `disableAuthentication: true`). Requires Superhuman support approval for `salable.app` as a second network domain.

The verified payload is Salable's actual construction: JSON of a record keyed by entitlement value (`{value, type, expiryDate}` per entry, response order), DER-encoded signature in hex, public key from `GET /api/signing-keys`. Pin the public key in the Pack (`SALABLE_SIGNING_PUBLIC_KEY`) to make the trust chain fully independent of the relay.

**Limits of Path 1:** it can *check* but not act — usage recording, checkout minting and anything needing the secret key cannot live in a Pack. And because skills route by LLM judgment, a prompt that says "call CheckAccess first" is UX, not enforcement. Which is why:

## Path 2 — pass-through API access to the web application

**Built in this repo, and authoritative.** Every capability formula (`SaveSnippet`, `ListSnippets`, `TagSnippet`) passes through the Vercel app's `/api/agent/*` endpoints. The backend:

1. resolves the caller from the bearer token Superhuman injects ([web/src/lib/agent-auth.ts](../web/src/lib/agent-auth.ts)) — the only identity anywhere in the system;
2. re-checks entitlements with the **secret** key, cached ~60 seconds and invalidated by Salable's `subscription.*` webhooks ([web/src/lib/entitlements.ts](../web/src/lib/entitlements.ts));
3. enforces the free allowance and the Pro-only gates;
4. records metered usage (`POST /api/usage/record`) per save;
5. on a paywall hit, answers **402 with a freshly minted Salable checkout URL** keyed to the verified grantee — the formula returns it as text and the agent relays it in chat.

The LLM cannot route around this path: whatever it calls, the server decides. Path 1 is the fast front door; Path 2 is the lock.

### How identity is established (both paths depend on it)

Connecting the agent runs a standard OAuth2 authorisation-code flow **against this app** — that is the "supply your details on install" step Superhuman provides. The consent page creates the account and mints an opaque `granteeId` (`usr_…`). Two rules carried over from Salable's own validation:

- **Grantee and Owner IDs are never email addresses** — the Salable API rejects them, and opaque IDs survive address changes.
- In this single-user product, `owner = granteeId`. A team product would use the organisation as Owner and a Salable grantee **Group** (`grp_…`) with per-seat line items — the checkout call is the only code that changes.

## Approaches documented but not built

### C — hosted MCP server

A Pack may declare one hosted MCP server (`pack.addMCPServer`) speaking Streamable HTTP, tools only, with OAuth2 + dynamic client registration as the preferred auth. Enforcement then lives inside each MCP tool handler — the same trust model as Path 2 with different wiring. This is the forward-looking route (Superhuman's partner agents lean this way) and it makes one monetised server reusable from other MCP hosts (Claude, Codex, etc.). The backend in this repo would need: an MCP endpoint, DCR support, and the same guard functions — the entitlement logic is already factored to move there.

### D — out-of-band worker gating

Agents with asynchronous backends (queues, workers, schedulers) get a second, stateful gate for free: quota accounting, overage handling, throttling and webhook-driven suspension live naturally in the worker. Complements rather than replaces Paths 1–2.

## Choosing a pricing model

Salable supports flat-rate, per-seat, metered/usage, tiered, hybrid and one-off pricing. This reference uses:

- **Flat-rate Pro plan** carrying two entitlements (`unlimited_saves`, `ai_tagging`) — the boolean gate.
- **Metered line item at £0** on the meter `snippet_saves` — every save is recorded, so usage is visible per owner per billing period in Salable without charging for it. Price the unit (or tier it) and it becomes pay-per-use; that is a dashboard change, not a code change.
- The **free tier is app-side** (a monthly count against `FREE_SNIPPET_ALLOWANCE`) because free users have no Salable subscription; Salable answers `404` to usage records for them, which the code treats as expected.

Per-seat (grantee Groups + seat counts) and Salable's credit/token billing (in beta) are the natural next models for agent products — per-task credits map especially well to agent invocations.
