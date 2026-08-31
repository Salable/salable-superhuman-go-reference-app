# Scope — Salable × Superhuman Go reference application

**Status:** Built — see [README.md](README.md). Milestones M1–M5 delivered (approach C remains the documented stretch); local end-to-end suite passing.
**Owner:** Neal
**Date:** 2026-08-31

## Objective

A runnable reference application demonstrating how to monetise a Superhuman Go agent with Salable, end to end:

1. A user installs the agent in Superhuman Go.
2. On install, the user connects their account — the step Superhuman provides for supplying user details — which creates an identity in our backend and a stable, non-email **grantee ID**.
3. Before the agent is used in Go, the Pack checks the response from Salable's entitlement checker directly (signed, publishable-key) and gates entry accordingly.
4. The user exercises the agent's free capability via pass-through API access to our Vercel web application, which enforces entitlements server-side on every action.
5. When a paid capability is invoked, the agent responds with an upgrade link; the user completes purchase via a Salable-hosted Stripe checkout keyed on their grantee ID.
6. The agent's paid capability now works, verified by a live Salable entitlement check on both paths.

Everything web-facing (landing page, pricing page, checkout hand-off, post-purchase page) is hosted on **Vercel** — assumed present by default, as any commercial agent would have this surface anyway.

The repository doubles as written guidance: it documents the alternative integration approaches and why this one is the primary pattern.

## Architectural approach

The reference **builds two enforcement paths side by side**, because they answer different questions and a real agent will usually combine them:

**Path 1 — direct entitlement check from the Pack, before the agent is used** (approach A from research). The Pack calls Salable's `GET /api/entitlements/check` itself, from inside Go, using the client-safe **publishable key**, and gates entry to the agent on the response:

- The check runs at the front door: a gate inside the chat/bench-initialisation skill's entry formula and at the top of every gated skill — so an unentitled user is told their status (and given an upgrade link) *before* any capability runs.
- The grantee ID it checks is never LLM-supplied: the Pack first resolves the verified user from our backend (`/api/agent/whoami`, driven by the platform-injected credential), then checks that ID against Salable directly.
- The Pack **verifies the ECDSA-P256 signature** on Salable's entitlement response against the organisation's public signing key — demonstrating that a client-side consumer can trust the response without a server in the loop.
- Entitlement fetches set `cacheTtlSecs: 0` so a cancelled subscription doesn't keep working out of the Pack's response cache.
- Constraint this path carries: it needs a **second network domain** (`salable.app` alongside our Vercel domain), which requires a Superhuman support approval — the reference documents that request as part of setup.

**Path 2 — pass-through API access to the Vercel web application** (approach B from research). Agent actions call our own API; the backend resolves the user from the bearer credential, holds the Salable **secret key**, and does the full round trip — entitlement check (cached, webhook-invalidated), usage recording, and minting checkout URLs when the caller is unentitled. This is the enforcement layer the LLM cannot route around, and the only place secret-key operations (usage, checkout, subscriptions) can live.

The two paths are complementary and the docs say so plainly: Path 1 is fast, front-of-house gating and a demonstration of client-side trust via signed responses; Path 2 is the authoritative guard on every side-effectful action. Shared constraints both respect:

- Identity is resolved from the platform-injected credential on every invocation. Nothing the LLM supplies is trusted; enforcement lives in code the LLM must call, not in prompts.
- A Pack cannot redirect or store state, so checkout is delivered as a URL in the chat reply, minted fresh by our backend.

The docs deliverable also covers the remaining variants without building them: **C** (hosted Streamable-HTTP MCP server with OAuth2 dynamic client registration; the forward-looking partner-agent path — stretch milestone) and **D** (out-of-band worker gating for async agents).

## The demo agent

The agent's capability is deliberately small so the monetisation flow is the star: **Snippet Vault** — the user asks the agent to save highlighted or dictated text to their personal vault and retrieve it later.

- **Free plan:** save up to N snippets per month (N enforced by our backend; usage also recorded to Salable so metering is demonstrated).
- **Pro plan (flat-rate monthly):** unlimited saves plus one visibly premium entitlement, e.g. `ai_tagging` (auto-tagging of saved snippets).

This exercises the two hot paths every paid agent needs: a boolean entitlement gate and a usage counter.

## Components

### 1. Salable catalogue (test mode)
- One Product ("Snippet Vault"), Pro Plan with a flat-rate Line Item, and entitlements `unlimited_saves` and `ai_tagging`; a Meter `snippet_saves`.
- Provisioned by an **idempotent seed script** using the Salable API (secret key from env), so anyone can reproduce the setup. Test mode throughout; Stripe test cards for the demo.

### 2. Web app (`web/`) — Next.js on Vercel
- **Pages:** landing `/`, pricing `/pricing` (plans and prices fetched live from Salable), checkout success and cancel pages, and a minimal `/account` page (plan status, snippet count, Stripe billing-portal link via Salable).
- **Connect flow (install-time details):** OAuth2 authorization-code endpoints (`/oauth/authorize` + consent screen, `/api/oauth/token`) that Superhuman's Pack auth drives. On first consent we create the user, derive `granteeId` (`usr_…`, never an email — Salable rejects email identifiers), and set `owner = granteeId` (single-user product; the docs note how teams map to Owners + grantee Groups).
- **Agent API (`/api/agent/*`):** bearer-token authenticated endpoints the Pack calls — save snippet, list snippets, tag snippet. Each request: resolve user from token → Salable entitlement check (short-TTL cache, invalidated by webhooks) → allow, or return a structured "payment required" response containing a freshly minted checkout URL for the Pack to relay in chat.
- **Checkout minting:** server-side `POST /api/checkout` wrapping Salable quick checkout (`planId`, `owner`, `grantee`, success/cancel URLs on our domain).
- **Webhook receiver (`/api/webhooks/salable`):** HMAC-SHA256 verification over `${timestamp}.${rawBody}` with ±5-minute window; handles `subscription.created/updated/cancelled` to invalidate the entitlement cache and update account state.
- **Storage:** Postgres (Neon via Vercel) with Prisma — users, OAuth tokens/codes, snippets, cached entitlements. No Redis; one database keeps the reference easy to stand up.

### 3. The Pack (`pack/`)
- TypeScript on `@codahq/packs-sdk`; network domains: our Vercel domain **and** `salable.app` (second domain via Superhuman support approval — see risks); `setUserAuthentication` with OAuth2 against our endpoints.
- **Path 1 machinery:** a `CheckAccess` formula that resolves the verified grantee ID from our backend, calls Salable's entitlement check directly with the publishable key, verifies the response signature, and returns entitlement status; invoked as the entry gate before gated skills run, and available to the LLM for "what plan am I on?" conversations.
- **Path 2 machinery:** `SaveSnippet` (action), `ListSnippets`, `TagSnippet` (action, Pro-gated) — all pass-through calls to `/api/agent/*`, guarded server-side regardless of what Path 1 reported.
- A chat skill whose prompt explains free vs Pro behaviour and relays upgrade links; suggested prompts for the demo.
- Guard placement: first line of every action's `execute` — never in prompt text. Entitlement-relevant fetches set `cacheTtlSecs: 0`.
- npm scripts for `packs upload` / `packs release`; the Pack is shared directly (store verification out of scope).

### 4. Documentation (`docs/`)
- `approaches.md` — the A/B/C/D comparison with trade-offs and the platform constraints that drive them.
- `setup.md` — Salable account, seed script, Vercel deploy, Pack upload, Superhuman install; all env vars in `.env.example` files.
- `runbook.md` — scripted demo path (install → free saves → paywall → test-card purchase → entitled use), including a reset step.

## Delivery milestones

1. **M1 — Web foundation:** Next.js app deployed to Vercel; Salable seed script; landing and pricing pages rendering live catalogue data.
2. **M2 — Identity:** OAuth2 provider + user model + grantee derivation; Pack skeleton connects and a `WhoAmI`-style formula proves verified identity round-trip.
3. **M3 — The paywall (Path 2):** agent actions passing through to the Vercel API with the server-side entitlement guard; checkout minting; full test-mode purchase loop working end to end. *(The core demo — everything before/after supports this.)*
4. **M4 — Front-door gating (Path 1) + lifecycle:** the Pack's direct Salable entitlement check with signature verification gating agent entry; Salable webhooks, entitlement caching + invalidation, usage recording, account page. Includes submitting the second-network-domain request to Superhuman (raise early — it can run in parallel from M2).
5. **M5 — Reference polish:** docs, runbook, `.env.example`s, seed/reset scripts hardened.
- **Stretch:** approach C variant — the same backend exposed as a Streamable-HTTP MCP server with OAuth2 DCR, attached via `pack.addMCPServer`.

## Out of scope

- Superhuman Store publication/verification and the partner-agent private beta (documented as the distribution path, not exercised).
- Teams: per-seat pricing, grantee Groups, multi-tenant Owners (design noted in docs only).
- Salable token/credit billing (beta, feature-flagged) — mentioned in docs as the natural AI-credits model.
- Live-mode Stripe, real payments, tax, refunds.
- The agent's capability beyond what the paywall demo needs.

## Decisions taken (flag if you disagree)

- **Both enforcement paths build**: direct Salable entitlement checking from the Pack before agent access (approach A) *and* pass-through API access to the Vercel app (approach B). C and D are documented (C as stretch). Path 2 is the authoritative guard; Path 1 is front-of-house gating and the signed-response demonstration.
- **Next.js App Router** rather than salable-two's Pages Router — this is a greenfield public reference and App Router is the current default for its audience.
- **Flat-rate Pro + metered free allowance** as the pricing shape; per-seat and credits documented only.
- **OAuth2 (auth code)** as the Pack auth type — it is the install-time "supply your details" experience Superhuman gives users, and it doubles as the account-creation moment.
- **Single-user product** (`owner = grantee`) to keep the identity story legible.

## Risks and open questions

- **Second network domain (Path 1):** calling `salable.app` alongside our own domain from one Pack requires a Superhuman support approval. Raise the request at M2; if it stalls, Path 1 falls back to checking via a thin `/api/entitlements/relay` on our domain that forwards the publishable-key check verbatim and returns Salable's signed body untouched — the Pack still verifies the signature, preserving the client-side-trust demonstration.
- **Manual auth header on a second domain (Path 1):** the Pack's user auth binds to our domain; the Salable call must carry the publishable key as a `Authorization: Bearer` header set manually in the fetch. Verify at M4 that the Packs fetcher permits a manually set Authorization header on a non-auth domain; if it does not, the relay fallback above applies.
- **OAuth2 redirect URI:** Superhuman publishes the exact redirect URL Packs use; confirm it against the current SDK docs at M2 and whether PKCE is required.
- **Free-plan modelling:** backend counter (chosen) vs a Salable-only subscription on signup; revisit at M3 if we want the free tier visible in Salable too.
- **Docs drift:** the mirrored Packs SDK docs in `.context/` are a 1 Aug 2026 snapshot; verify auth and skill APIs against live docs when building the Pack.
- **Credential hygiene:** rotate the Superhuman CLI token found in plaintext under `.context/shgo-trello-demo/pack/` before sharing this repo.
