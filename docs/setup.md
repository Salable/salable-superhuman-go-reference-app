# Setup

End-to-end setup: Salable catalogue → web app on Vercel → Pack in Superhuman Go. Everything runs in Salable **test mode** with Stripe test cards.

## 1. Salable

1. Create a Salable account at [salable.app](https://salable.app) and complete Stripe onboarding (test mode is fine).
2. From **Settings → API keys**, copy a **test-mode secret key** and a **test-mode publishable key**.
3. Seed the catalogue (product, Pro plan, entitlements, meter):

   ```bash
   cd web
   SALABLE_API_KEY=sk_test_... npm run seed:salable
   ```

   The script is idempotent and prints `SALABLE_PRO_PLAN_ID` when done. If `APP_URL` is set to a public origin it also registers the webhook destination; otherwise register `https://<your-app>/api/webhooks/salable` in the dashboard for the `subscription.*` events and copy its signing secret.

## 2. Web app (Vercel)

1. Create a Postgres database (Vercel → Storage → Neon works well) and note `DATABASE_URL`.
2. Deploy `web/` to Vercel. Set every variable from [web/.env.example](../web/.env.example):
   - `APP_URL` — the deployment origin.
   - `SALABLE_API_KEY`, `SALABLE_PUBLISHABLE_KEY`, `SALABLE_PRO_PLAN_ID`, `SALABLE_WEBHOOK_SECRET`.
   - `SHGO_OAUTH_CLIENT_ID` / `SHGO_OAUTH_CLIENT_SECRET` — invent these; they are this app's OAuth client credentials for Superhuman. Long random values.
   - `SHGO_OAUTH_REDIRECT_URIS` — fill in after step 3 shows the Pack's exact redirect URL.
   - `LINK_SECRET` — long random value.
3. Apply the schema: `npx prisma db push` (or wire `prisma migrate deploy` into the build).

Local development:

```bash
cd web
docker compose up -d          # Postgres on localhost:5439
cp .env.example .env          # then fill in values
npx prisma db push
npm run dev
```

## 3. The Pack

1. Edit the constants at the top of [pack/src/pack.ts](../pack/src/pack.ts):
   - `APP_DOMAIN` — your Vercel domain.
   - Leave `SALABLE_CHECK_MODE = "relay"` unless salable.app has been approved as a second network domain (see below).
   - Optionally pin `SALABLE_SIGNING_PUBLIC_KEY` with the PEM from `GET https://salable.app/api/signing-keys` (test-mode key).
2. Register and upload:

   ```bash
   cd pack
   npm install
   npx packs create src/pack.ts     # one-time; writes the pack id
   npm run upload
   npm run release -- <version>
   ```

3. In the Pack's **Settings → Add OAuth Credentials**, enter the `SHGO_OAUTH_CLIENT_ID` / `SHGO_OAUTH_CLIENT_SECRET` values from step 2. The dialog shows the **redirect URL** (`https://docs.superhuman.com/packsAuth/oauth2/<PACK_ID>`) — put that exact value in `SHGO_OAUTH_REDIRECT_URIS` on Vercel.
4. In Superhuman Go: **+ More agents** → find Snippet Vault → open → sign in when prompted. The consent page is this app's `/oauth/authorize`; completing it creates the account and grantee ID.

### Second network domain (direct Path 1)

To let the Pack call `salable.app` directly, request an additional network domain through [Superhuman Packs support](https://docs.superhuman.com/packs/build/latest/support/). Once approved: uncomment `pack.addNetworkDomain("salable.app")`, set `SALABLE_CHECK_MODE = "direct"`, paste your publishable key, and re-upload. The relay endpoint can stay — it is harmless.

## 4. Verify

Follow [runbook.md](runbook.md). In test mode, Stripe checkout accepts card `4242 4242 4242 4242` with any future expiry and any CVC.

## Notes on things that commonly bite

- **Grantee/Owner values must not be emails** — the Salable API rejects them. This app mints opaque `usr_…` IDs at consent time.
- **404 from `/api/entitlements/check` means "unknown grantee"**, not "no access". First-time users are 404 until their first purchase.
- **404 from `/api/usage/record`** means the owner has no active subscription carrying that meter — expected for free-tier users.
- **Webhook signature** is HMAC-SHA256 over `"<timestamp>.<rawBody>"`; reject stale timestamps and compare in constant time (see [web/src/app/api/webhooks/salable/route.ts](../web/src/app/api/webhooks/salable/route.ts)).
- **Never cache entitlement fetches in the Pack** (`cacheTtlSecs: 0`) — the platform's default GET cache would keep a cancelled subscription alive for minutes.
- The consent step is **passwordless by design** in this reference; in a real product substitute your existing sign-in and keep everything from the grantee ID onwards.
