#!/usr/bin/env bash
# Full local end-to-end run: dev database + mock Salable + next dev + e2e suite.
# Usage: npm run test:e2e   (from web/)
set -euo pipefail

cd "$(dirname "$0")/.."
WEB_DIR="$(pwd)"
TEST_DIR="$WEB_DIR/test"
PORT=3999
MOCK_PORT=4600
DB_URL="postgresql://postgres:postgres@localhost:5439/snippet_vault"

cleanup() {
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null || true
  [[ -n "${NEXT_PID:-}" ]] && kill "$NEXT_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 1. The Pack's signature-verification code, bundled so the suite exercises the
#    exact bytes the Pack will run.
npx --prefix ../pack esbuild ../pack/src/salable-verify.ts \
  --bundle --format=cjs --platform=node \
  --outfile="$TEST_DIR/pack-verify-bundle.cjs" >/dev/null

# 2. Database
docker compose up -d >/dev/null
sleep 2
DATABASE_URL="$DB_URL" npx prisma db push --skip-generate >/dev/null

# 3. Mock Salable
node "$TEST_DIR/mock-salable.mjs" & MOCK_PID=$!

# 4. App under test
env \
  APP_URL="http://localhost:$PORT" \
  DATABASE_URL="$DB_URL" \
  LINK_SECRET=test-link-secret \
  FREE_SNIPPET_ALLOWANCE=2 \
  ENTITLEMENT_CACHE_TTL_SECONDS=1 \
  SALABLE_API_BASE="http://localhost:$MOCK_PORT" \
  SALABLE_API_KEY=sk_test_mock \
  SALABLE_PUBLISHABLE_KEY=pk_test_mock \
  SALABLE_PRO_PLAN_ID=plan_mock \
  SALABLE_WEBHOOK_SECRET=whsec_mock \
  SHGO_OAUTH_CLIENT_ID=superhuman-go \
  SHGO_OAUTH_CLIENT_SECRET=sh-secret \
  SHGO_OAUTH_REDIRECT_URIS=https://docs.superhuman.com/packsAuth/oauth2/123 \
  npx next dev -p "$PORT" >/dev/null 2>&1 & NEXT_PID=$!

for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

# 5. The suite
node "$TEST_DIR/e2e.mjs"
