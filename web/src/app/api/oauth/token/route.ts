// OAuth2 token endpoint. Superhuman calls this to exchange an authorisation
// code (and later refresh tokens) for the bearer credential its fetcher will
// inject into every agent request.

import { NextResponse } from 'next/server';
import { issueTokens, rotateTokens } from '@/lib/agent-auth';
import { consumeAuthCode, isValidClient, parseTokenRequest, verifyPkce } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status });
}

export async function POST(request: Request) {
  const params = await parseTokenRequest(request);

  if (!isValidClient(params.clientId, params.clientSecret)) {
    return oauthError('invalid_client', 'Client authentication failed.', 401);
  }

  if (params.grantType === 'authorization_code') {
    if (!params.code) return oauthError('invalid_request', 'Missing code.');

    const authCode = await consumeAuthCode(params.code);
    if (!authCode) return oauthError('invalid_grant', 'Code is invalid, expired or already used.');
    if (params.redirectUri && params.redirectUri !== authCode.redirectUri) {
      return oauthError('invalid_grant', 'redirect_uri does not match the authorisation request.');
    }
    if (!verifyPkce(authCode.codeChallenge, authCode.codeChallengeMethod, params.codeVerifier)) {
      return oauthError('invalid_grant', 'PKCE verification failed.');
    }

    const tokens = await issueTokens(authCode.userId, authCode.scope);
    return NextResponse.json({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: authCode.scope
    });
  }

  if (params.grantType === 'refresh_token') {
    if (!params.refreshToken) return oauthError('invalid_request', 'Missing refresh_token.');

    const tokens = await rotateTokens(params.refreshToken);
    if (!tokens) return oauthError('invalid_grant', 'Refresh token is invalid or revoked.');
    return NextResponse.json({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken
    });
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}
