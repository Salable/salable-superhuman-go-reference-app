// Mock Salable server for local end-to-end testing of the reference app.
// Mirrors the real API's shapes, including genuine ECDSA-signed entitlement
// responses (same signing construction as Salable's implementation).
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';

const PORT = 4600;
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const purchased = new Set(); // granteeIds with an active Pro subscription
let usageRecords = [];

function signEntitlements(record) {
  const sign = createSign('sha256');
  sign.write(JSON.stringify(record));
  sign.end();
  return sign.sign(privateKey, 'hex');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};

  if (url.pathname === '/api/entitlements/check') {
    const granteeId = url.searchParams.get('granteeId');
    if (!purchased.has(granteeId)) return json(res, 404, { title: 'Not found' });
    const expiry = new Date(Date.now() + 30 * 86400000);
    const record = {};
    for (const value of ['unlimited_saves', 'ai_tagging']) {
      record[value] = { value, type: 'entitlement', expiryDate: expiry };
    }
    if (url.searchParams.get('owner')) {
      record.snippet_saves = { value: 'snippet_saves', type: 'meter', expiryDate: expiry };
    }
    const signature = signEntitlements(record);
    return json(res, 200, {
      type: 'object',
      data: {
        entitlements: Object.values(record).map(e => ({
          ...e,
          expiryDate: e.expiryDate?.toISOString() ?? null
        })),
        signature
      }
    });
  }

  if (url.pathname === '/api/signing-keys') {
    return json(res, 200, {
      type: 'object',
      data: { id: 'sk_1', organisation: 'test_org', publicKey, createdAt: '', updatedAt: '' }
    });
  }

  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    if (!body.planId || !body.owner || !body.grantee) {
      return json(res, 400, { title: 'Validation error', received: body });
    }
    return json(res, 200, {
      type: 'object',
      data: { url: `http://localhost:${PORT}/fake-checkout?grantee=${body.grantee}` }
    });
  }

  if (url.pathname === '/api/usage/record' && req.method === 'POST') {
    if (!purchased.has(body.owner)) return json(res, 404, { title: 'Not found' });
    usageRecords.push(body);
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === '/api/plans/plan_mock') {
    return json(res, 200, {
      type: 'object',
      data: {
        id: 'plan_mock', name: 'Pro', productId: 'prod_mock',
        lineItems: { type: 'list', data: [
          { id: 'li_1', name: 'Pro subscription', slug: 'snippet_vault_pro',
            priceType: 'flat_rate', intervalType: 'recurring' }
        ] }
      }
    });
  }

  if (url.pathname === '/api/prices') {
    return json(res, 200, { type: 'list', hasMore: false, data: [
      { id: 'price_1', lineItemId: 'li_1', interval: 'month', intervalCount: 1 }
    ] });
  }

  if (url.pathname === '/api/currency-options') {
    return json(res, 200, { type: 'list', hasMore: false, data: [
      { id: 'co_1', priceId: 'price_1', currency: 'GBP', unitAmount: 999, isDefault: true }
    ] });
  }

  if (url.pathname === '/api/plans') {
    return json(res, 200, {
      type: 'list',
      hasMore: false,
      data: [
        {
          id: 'plan_mock',
          name: 'Pro',
          productId: 'prod_mock',
          lineItems: [
            {
              id: 'li_1', name: 'Pro subscription', slug: 'pro_subscription',
              priceType: 'flat_rate', intervalType: 'recurring',
              prices: [{
                id: 'price_1', interval: 'month', intervalCount: 1,
                currencyOptions: [{ currency: 'GBP', unitAmount: 999, isDefault: true }]
              }]
            }
          ]
        }
      ]
    });
  }

  if (url.pathname === '/api/owners') {
    return json(res, 200, { type: 'list', hasMore: false, data: [] });
  }

  // Test helpers
  if (url.pathname === '/test/purchase' && req.method === 'POST') {
    purchased.add(body.granteeId);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/test/usage') {
    return json(res, 200, { usageRecords });
  }

  json(res, 404, { title: 'Not found', path: url.pathname });
}).listen(PORT, () => console.log(`mock salable on :${PORT}`));
