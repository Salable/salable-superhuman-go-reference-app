// A deliberately small OAuth2 authorisation server — just enough for one
// client: Superhuman's Packs platform.
//
// Superhuman's token exchange (per the Packs SDK docs) may send the client
// secret either in the request body or as an Authorization: Basic header, and
// the body may be form-encoded or JSON; all four combinations are accepted.
// PKCE (S256) is supported and enabled in the Pack definition.

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config';
import { prisma } from './db';

export const AUTH_CODE_TTL_SECONDS = 10 * 60;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isValidRedirectUri(uri: string): boolean {
  return config.oauth.redirectUris.includes(uri);
}

export function isValidClientId(clientId: string): boolean {
  return safeEqual(clientId, config.oauth.clientId);
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

export function isValidClient(clientId?: string, clientSecret?: string): boolean {
  if (!clientId || !clientSecret) return false;
  return safeEqual(clientId, config.oauth.clientId) && safeEqual(clientSecret, config.oauth.clientSecret);
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
