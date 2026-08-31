# Salable × Superhuman Go — reference application

A worked example of a **paid Superhuman Go agent monetised with [Salable](https://salable.app)**: install the agent, connect an account, use a free tier, hit a paywall, buy through a Salable-hosted Stripe checkout, and carry on — entitled — without leaving the chat.

Superhuman Go has no native monetisation for third-party agents, so billing must live on the developer's side. This repository shows where every piece goes.

## What it demonstrates

- **Checking Salable's entitlement response before the agent is used in Go** (Path 1): the Pack calls the entitlement checker for the verified user and **verifies Salable's ECDSA signature in Pack code**, so the decision is trusted end-to-end — then gates entry accordingly.
- **Pass-through API access to a Vercel web application** (Path 2): every agent action goes through the app, which re-checks entitlements server-side with the secret key, enforces the free allowance, records metered usage, and answers paywall hits with **402 + a freshly minted checkout URL** for the agent to relay in chat.
- **A monetised MCP server** (Path 3): the same backend serves `/api/mcp` (Streamable HTTP, OAuth2 with **Dynamic Client Registration** and PKCE), so the Pack (via `addMCPServer`) *and* any MCP host — Claude, Codex — get the same entitlement-guarded tools, with paywall hits returning the checkout link as the tool result.
- **Install-time identity capture**: connecting the agent runs OAuth2 against this app; the consent step creates the account and mints the stable, non-email **grantee ID** used for every Salable call.
- **The commercial surface** any paid agent needs anyway: landing page, pricing page rendering the live Salable catalogue, personalised upgrade page, account page with billing portal, checkout success/cancel pages.
- **Lifecycle**: HMAC-verified Salable webhooks invalidate the entitlement cache the moment a subscription changes, and usage lands on a Salable meter per save.

## Layout

| Path | Contents |
| --- | --- |
| [`pack/`](pack/) | The Superhuman Go agent (a Pack). [`src/pack.ts`](pack/src/pack.ts) is the whole agent; [`src/salable-verify.ts`](pack/src/salable-verify.ts) + [`src/p256.ts`](pack/src/p256.ts) verify entitlement signatures in the Pack sandbox. |
| [`web/`](web/) | Next.js (App Router) on Vercel: OAuth2 provider, agent API with the entitlement guard, checkout minting, webhook receiver, and the public pages. Postgres via Prisma. |
| [`web/scripts/seed-salable.mjs`](web/scripts/seed-salable.mjs) | Idempotent Salable catalogue seed (product, Pro plan, entitlements, meter). |
| [`docs/`](docs/) | [approaches.md](docs/approaches.md) — the integration approaches and why; [setup.md](docs/setup.md) — full setup; [runbook.md](docs/runbook.md) — scripted demo. |
| [`scope.md`](scope.md) | The scope this was built against. |

## The demo agent

**Snippet Vault** — save highlighted text from any page to a personal vault and find it again. Free: a monthly save allowance. Pro (flat-rate monthly via Salable): unlimited saves plus AI tagging. The capability is deliberately small; the monetisation flow is the subject.

## Quick start

```bash
# 1. Seed the Salable catalogue (test-mode secret key)
cd web && SALABLE_API_KEY=sk_test_... npm run seed:salable

# 2. Run the web app locally
docker compose up -d && cp .env.example .env   # fill in values
npx prisma db push && npm run dev

# 3. Upload the Pack (after editing APP_DOMAIN in pack/src/pack.ts)
cd ../pack && npm install && npx packs create src/pack.ts && npm run upload
```

Full instructions: [docs/setup.md](docs/setup.md).

## Verification status

- Both projects typecheck; the web app production-builds; the Pack passes `packs validate`.
- A local end-to-end suite (mock Salable with genuine ECDSA-signed responses) exercises the full loop — consent → PKCE token exchange → verified identity → free saves → 402 paywall → HMAC webhook → entitlement flip → usage metering → Pack-side signature verification → refresh rotation → **DCR + PKCE public client + MCP tool calls to the paywall**. 39/39 checks pass (`npm run test:e2e` in `web/`).
- **Proven live** against the real Salable API (test mode), real Stripe sandbox checkouts, and Superhuman's real Pack runtime: the OAuth connect flow, `CheckAccess`/`WhoAmI` formulas, the Save snippet paywall (3 free saves, 4th refused), a sandbox purchase flipping the plan to Pro, and metered usage landing on the Salable meter.
