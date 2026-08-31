// A deliberately small OAuth2 authorisation server with two kinds of client:
//
//   - the static client (env-configured) used by Superhuman's Packs platform
//     with manually entered credentials, and
//   - dynamic clients registered at runtime via RFC 7591 Dynamic Client
//     Registration — the mechanism MCP hosts (Claude, Codex, and Superhuman's
//     own DCR mode) use to obtain credentials without a console.
//
// Token exchange accepts the client secret in the body or as Basic auth, and
// form-encoded or JSON bodies. PKCE (S256) is supported everywhere and
// REQUIRED for public dynamic clients (token_endpoint_auth_method "none").

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config';
import { prisma } from './db';

export const AUTH_CODE_TTL_SECONDS = 10 * 60;

export type ResolvedClient =
  | { kind: 'static'; clientId: string }
  | {
      kind: 'dynamic';
      clientId: string;
      clientSecretHash: string | null;
      redirectUris: string[];
      tokenEndpointAuthMethod: string;
    };

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  if (safeEqual(clientId, config.oauth.clientId)) {
    return { kind: 'static', clientId };
  }
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) return null;
  return {
    kind: 'dynamic',
    clientId: client.clientId,
    clientSecretHash: client.clientSecretHash,
    redirectUris: client.redirectUris,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod
  };
}

export function isValidRedirectForClient(client: ResolvedClient, uri: string): boolean {
  if (client.kind === 'static') return config.oauth.redirectUris.includes(uri);
  return client.redirectUris.includes(uri);
}

/** RFC 7591 registration. Returns the raw secret once; only a hash is kept. */
export async function registerDynamicClient(options: {
  redirectUris: string[];
  name: string;
  tokenEndpointAuthMethod: string;
}): Promise<{ clientId: string; clientSecret: string | null }> {
  const clientId = `svc_${randomBytes(12).toString('hex')}`;
  const isPublic = options.tokenEndpointAuthMethod === 'none';
  const clientSecret = isPublic ? null : `svcs_${randomBytes(24).toString('hex')}`;
  await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash: clientSecret
        ? createHash('sha256').update(clientSecret).digest('hex')
        : null,
      name: options.name,
      redirectUris: options.redirectUris,
      tokenEndpointAuthMethod: options.tokenEndpointAuthMethod
    }
  });
  return { clientId, clientSecret };
}

export async function createAuthCode(options: {
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): Promise<string> {
  const code = `svac_${randomBytes(24).toString('hex')}`;
  await prisma.authCode.create({
    data: {
      code,
      userId: options.userId,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      scope: options.scope,
      codeChallenge: options.codeChallenge,
      codeChallengeMethod: options.codeChallengeMethod,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000)
    }
  });
  return code;
}

export interface TokenRequestParams {
  grantType?: string;
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  codeVerifier?: string;
}

/** Reads token-endpoint parameters from JSON or form bodies plus Basic auth. */
export async function parseTokenRequest(request: Request): Promise<TokenRequestParams> {
  const params: TokenRequestParams = {};
  const contentType = request.headers.get('content-type') ?? '';

  let raw: Record<string, unknown> = {};
  if (contentType.includes('application/json')) {
    raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const text = await request.text();
    raw = Object.fromEntries(new URLSearchParams(text));
  }

  const str = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  params.grantType = str('grant_type');
  params.code = str('code');
  params.redirectUri = str('redirect_uri');
  params.refreshToken = str('refresh_token');
  params.clientId = str('client_id');
  params.clientSecret = str('client_secret');
  params.codeVerifier = str('code_verifier');

  const authHeader = request.headers.get('authorization') ?? '';
  const basic = /^Basic\s+(.+)$/i.exec(authHeader);
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator > -1) {
      params.clientId ??= decodeURIComponent(decoded.slice(0, separator));
      params.clientSecret ??= decodeURIComponent(decoded.slice(separator + 1));
    }
  }

  return params;
}

/**
 * Authenticates the token-endpoint caller. Static and confidential dynamic
 * clients must present their secret; public dynamic clients authenticate by
 * client_id alone and MUST complete PKCE (enforced by the token route via
 * the returned `requiresPkce`).
 */
export async function authenticateTokenClient(
  clientId?: string,
  clientSecret?: string
): Promise<{ clientId: string; requiresPkce: boolean } | null> {
  if (!clientId) return null;

  if (safeEqual(clientId, config.oauth.clientId)) {
    if (!clientSecret || !safeEqual(clientSecret, config.oauth.clientSecret)) return null;
    return { clientId, requiresPkce: false };
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) return null;
  if (client.clientSecretHash === null) {
    return { clientId, requiresPkce: true };
  }
  if (!clientSecret) return null;
  const presented = createHash('sha256').update(clientSecret).digest('hex');
  if (!safeEqual(presented, client.clientSecretHash)) return null;
  return { clientId, requiresPkce: false };
}

export function verifyPkce(
  codeChallenge: string | null,
  codeChallengeMethod: string | null,
  codeVerifier?: string
): boolean {
  // Codes issued without a challenge don't require a verifier.
  if (!codeChallenge) return true;
  if (!codeVerifier) return false;
  if ((codeChallengeMethod ?? 'plain') === 'S256') {
    const derived = createHash('sha256').update(codeVerifier).digest('base64url');
    return safeEqual(derived, codeChallenge);
  }
  return safeEqual(codeVerifier, codeChallenge);
}

/** Consumes an auth code atomically; a second use fails. */
export async function consumeAuthCode(code: string) {
  const record = await prisma.authCode.findUnique({ where: { code } });
  if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) return null;
  const updated = await prisma.authCode.updateMany({
    where: { code, consumedAt: null },
    data: { consumedAt: new Date() }
  });
  if (updated.count !== 1) return null;
  return record;
}
