# Demo runbook

The scripted path through the full monetisation loop, in Salable test mode. Roughly five minutes end to end.

## Before the demo

- Web app deployed and healthy (`/pricing` shows the Pro plan with a live price — that data comes from Salable, proving the API connection).
- Pack released and installable; OAuth credentials set.
- `FREE_SNIPPET_ALLOWANCE` set low (2 or 3) so the paywall arrives quickly.
- A fresh identity: either an email not used before, or reset state (below).

## The loop

1. **Install and connect.** In Superhuman Go, open Snippet Vault. The sign-in prompt leads to the app's consent page — enter a name and email, land back in Superhuman connected. *Point out: this is the install-time details step; the account and the Salable grantee ID were just minted.*
2. **The front door.** The agent greets you knowing your plan — the bench skill ran `CheckAccess`, which checked Salable's entitlement checker and verified the response signature before anything else happened. Ask "what plan am I on?" to see it again explicitly.
3. **Free usage.** Highlight some text on any page; ask the agent to save it. Repeat until the allowance runs out — each save reports how many free saves remain.
4. **The paywall.** The next save is refused by the backend (HTTP 402 under the hood) and the agent relays a personal checkout link. *Point out: the link was minted server-side for the verified grantee; the LLM only carried it.*
5. **Purchase.** Open the link → Stripe Checkout (hosted by Salable). Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
6. **Entitled.** Back in the chat, save again — it works, no reconnection, nothing refreshed. *Point out: Salable's `subscription.created` webhook invalidated the entitlement cache the moment payment completed.* Ask the agent to tag a snippet — the Pro-only feature now works too.
7. **The receipts.** In the Salable dashboard show: the subscription against the grantee, and recorded usage on the `snippet_saves` meter ticking up per save. Optionally ask the agent for "my account" to show the plan page and Stripe billing portal.

## Reset between runs

- Cancel the test subscription: Salable dashboard → the subscription → cancel immediately (or `POST /api/subscriptions/{id}/cancel?when=now`).
- Clear the app user so the email can be reused:

  ```bash
  cd web
  npx prisma studio   # delete the User row (cascades tokens, snippets, cache)
  ```

- Salable test-mode data can also be wiped wholesale from the dashboard if the catalogue should be reseeded (`npm run seed:salable` recreates it).

## If something goes wrong live

- **Agent says it cannot confirm access:** the signature verification failed or Salable was unreachable — the Pack fails closed. Retry; check the relay endpoint directly.
- **Paywall does not lift after payment:** the webhook has not arrived or is misconfigured. The cache TTL (60 s default) is the backstop — wait it out, or lower `ENTITLEMENT_CACHE_TTL_SECONDS`.
- **Connection prompt loops:** OAuth client credentials or the redirect URI allowlist do not match between Vercel env and Pack settings.
