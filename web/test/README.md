# End-to-end suite

`npm run test:e2e` (from `web/`) runs the whole monetisation loop locally with no Salable account needed:

- [mock-salable.mjs](mock-salable.mjs) — a mock of the Salable API endpoints this app uses, including **genuinely ECDSA-signed** entitlement responses built the same way Salable builds them.
- [e2e.mjs](e2e.mjs) — 26 checks across the loop: OAuth consent → PKCE token exchange (JSON-body and Basic-auth client styles) → verified identity → free-tier saves → 402 paywall with checkout link → HMAC-verified webhook → entitlement flip → usage metering → Path 1 relay with **the Pack's own bundled verification code** (including tamper rejection) → refresh-token rotation → page rendering.
- [run-e2e.sh](run-e2e.sh) — orchestration: dev Postgres (docker compose, port 5439), the mock, `next dev` with a test environment, then the suite.

The signature checks import `pack-verify-bundle.cjs`, built from `pack/src/salable-verify.ts` at run time — so the suite proves the exact code the Pack ships can verify what Salable signs.
