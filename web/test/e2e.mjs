// End-to-end exercise of the reference app against the mock Salable.
//
// Run with: npm run test:e2e   (starts nothing itself — see test/README.md for
// the three processes it expects: dev db, mock Salable, and `next dev` with the
// test environment).
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { verifyEntitlementsSignature } from './pack-verify-bundle.cjs';

const APP = 'http://localhost:3999';
const MOCK = 'http://localhost:4600';
const REDIRECT = 'https://docs.superhuman.com/packsAuth/oauth2/123';

let failures = 0;
function check(name, condition, extra = '') {
  console.log(`${condition ? '✓' : '✗ FAIL'} ${name}${condition ? '' : ' ' + extra}`);
  if (!condition) failures++;
}

// --- 1. OAuth: consent form post (as the browser would) with PKCE ---------
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const consentRes = await fetch(`${APP}/api/oauth/consent`, {
  method: 'POST',
  redirect: 'manual',
  body: new URLSearchParams({
    name: 'Test User',
    email: `test.user+${randomBytes(4).toString('hex')}@example.com`,
    client_id: 'superhuman-go',
    redirect_uri: REDIRECT,
    state: 'xyz123',
    scope: 'agent',
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
});
const location = consentRes.headers.get('location') ?? '';
const redirectUrl = new URL(location);
const code = redirectUrl.searchParams.get('code');
check('consent redirects to Superhuman with code + state',
  consentRes.status === 303 && location.startsWith(REDIRECT) && !!code &&
  redirectUrl.searchParams.get('state') === 'xyz123', `status=${consentRes.status} loc=${location}`);

// --- 2. Token exchange: JSON body + secret in body (one Superhuman variant) -
const tokenRes = await fetch(`${APP}/api/oauth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: 'superhuman-go',
    client_secret: 'sh-secret',
    code_verifier: verifier
  })
});
const tokens = await tokenRes.json();
check('token exchange (JSON body + PKCE)', tokenRes.status === 200 && !!tokens.access_token && !!tokens.refresh_token, JSON.stringify(tokens));

// Reuse should fail
const reuse = await fetch(`${APP}/api/oauth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'superhuman-go', client_secret: 'sh-secret', code_verifier: verifier })
});
check('auth code cannot be reused', reuse.status === 400);

const bearer = { authorization: `Bearer ${tokens.access_token}` };

// --- 3. whoami: free plan, unknown to Salable yet --------------------------
const who = await (await fetch(`${APP}/api/agent/whoami`, { headers: bearer })).json();
check('whoami resolves verified identity', who.granteeId?.startsWith('usr_') && who.plan === 'free', JSON.stringify(who));
check('whoami provides signed account/upgrade links', who.accountUrl?.includes('/account?t=') && who.upgradeUrl?.includes('/upgrade?t='));

// --- 4. Path 1 relay: Salable answers 404 (no purchase) --------------------
const relay1 = await (await fetch(`${APP}/api/entitlements/relay`, { headers: bearer })).json();
check('relay reports unknown grantee before purchase', relay1.salableStatus === 404 && relay1.granteeId === who.granteeId);

// --- 5. Free saves then the paywall ---------------------------------------
const save = body => fetch(`${APP}/api/agent/snippets`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const s1 = await save({ content: 'First snippet about pricing pages', source: 'https://example.com/a' });
const s1Body = await s1.json();
check('first free save succeeds', s1.status === 201 && s1Body.remainingFreeSaves === 1, JSON.stringify(s1Body));
const s2 = await save({ content: 'Second snippet about entitlement checks' });
check('second free save succeeds', s2.status === 201);
const s3 = await save({ content: 'Third snippet should hit the wall' });
const s3Body = await s3.json();
check('third save returns 402 with checkout + pricing links',
  s3.status === 402 && s3Body.error === 'payment_required' && s3Body.checkoutUrl?.includes('fake-checkout') && s3Body.pricingUrl?.includes('/upgrade?t='),
  JSON.stringify(s3Body));

// --- 6. Tagging gated pre-purchase ----------------------------------------
const list1 = await (await fetch(`${APP}/api/agent/snippets`, { headers: bearer })).json();
const firstId = list1.snippets.at(-1).id;
const tagBlocked = await fetch(`${APP}/api/agent/snippets/${firstId}/tag`, { method: 'POST', headers: bearer });
check('tagging returns 402 on free plan', tagBlocked.status === 402);

// --- 7. Purchase: flip the mock, deliver the webhook ----------------------
await fetch(`${MOCK}/test/purchase`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ granteeId: who.granteeId }) });
const event = JSON.stringify({ id: 'evt_1', type: 'subscription.created', data: { livemode: false, subscription: { owner: who.granteeId } } });
const ts = new Date().toISOString();
const sig = createHmac('sha256', 'whsec_mock').update(`${ts}.${event}`).digest('hex');
const hook = await fetch(`${APP}/api/webhooks/salable`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-salable-timestamp': ts, 'x-salable-signature': sig }, body: event });
check('webhook accepted with valid HMAC', hook.status === 200);
const badHook = await fetch(`${APP}/api/webhooks/salable`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-salable-timestamp': ts, 'x-salable-signature': 'deadbeef' }, body: event });
check('webhook rejected with invalid HMAC', badHook.status === 401);

// --- 8. Pro is live: saves unlimited, usage recorded, tagging works -------
const who2 = await (await fetch(`${APP}/api/agent/whoami`, { headers: bearer })).json();
check('plan flips to pro after purchase + webhook', who2.plan === 'pro', JSON.stringify(who2));
const s4 = await save({ content: 'Fourth snippet, now on Pro' });
const s4Body = await s4.json();
check('post-purchase save succeeds with usage recorded', s4.status === 201 && s4Body.plan === 'pro' && s4Body.usageRecorded === true, JSON.stringify(s4Body));
const usage = await (await fetch(`${MOCK}/test/usage`)).json();
check('usage record reached Salable meter', usage.usageRecords.some(u => u.owner === who.granteeId && u.meterSlug === 'snippet_saves'));
const tagOk = await fetch(`${APP}/api/agent/snippets/${firstId}/tag`, { method: 'POST', headers: bearer });
const tagBody = await tagOk.json();
check('tagging works on pro', tagOk.status === 200 && Array.isArray(tagBody.snippet?.tags) && tagBody.snippet.tags.length > 0, JSON.stringify(tagBody));

// --- 9. Path 1 with signature verification (as the Pack does) -------------
const relay2 = await (await fetch(`${APP}/api/entitlements/relay`, { headers: bearer })).json();
const entitlements = relay2.salableBody?.data?.entitlements ?? [];
const signature = relay2.salableBody?.data?.signature ?? '';
check('relay passes Salable body through with entitlements', relay2.salableStatus === 200 && entitlements.length === 3);
check('Pack-side ECDSA verification of relayed response', verifyEntitlementsSignature(entitlements, signature, relay2.publicKey) === true);
const tampered = entitlements.map(e => ({ ...e }));
tampered[0].value = 'everything_free';
check('tampered relay payload fails verification', verifyEntitlementsSignature(tampered, signature, relay2.publicKey) === false);

// --- 10. Refresh flow + Basic-auth client style ---------------------------
const refresh = await fetch(`${APP}/api/oauth/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from('superhuman-go:sh-secret').toString('base64')}`
  },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
});
const refreshed = await refresh.json();
check('refresh grant works (form body + Basic auth)', refresh.status === 200 && !!refreshed.access_token);
const oldTokenWho = await fetch(`${APP}/api/agent/whoami`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
check('old access token revoked after refresh', oldTokenWho.status === 401);
const newWho = await (await fetch(`${APP}/api/agent/whoami`, { headers: { authorization: `Bearer ${refreshed.access_token}` } })).json();
check('new access token maps to the same grantee', newWho.granteeId === who.granteeId);

// --- 11. Web pages ---------------------------------------------------------
const upgradePage = await fetch(`${APP}${new URL(s3Body.pricingUrl).pathname}${new URL(s3Body.pricingUrl).search}`);
const upgradeHtml = await upgradePage.text();
check('personalised upgrade page renders', upgradePage.status === 200 && upgradeHtml.includes('Test User'));
const accountPage = await fetch(who.accountUrl);
const accountHtml = await accountPage.text();
check('account page renders with plan', accountPage.status === 200 && accountHtml.includes('Pro'));
const pricing = await fetch(`${APP}/pricing`);
const pricingHtml = await pricing.text();
check('pricing page renders live Salable plan (£9.99)', pricing.status === 200 && pricingHtml.includes('9.99'));
const badConsent = await fetch(`${APP}/api/oauth/consent`, { method: 'POST', body: new URLSearchParams({ name: 'X', email: 'x@example.com', client_id: 'superhuman-go', redirect_uri: 'https://evil.example.com/cb', scope: 'agent' }) });
check('consent rejects unlisted redirect_uri', badConsent.status === 400);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
