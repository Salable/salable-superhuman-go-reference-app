// RFC 7591 Dynamic Client Registration.
//
// Open registration, as the MCP authorisation spec expects: any host may
// mint a client, but a client is only a *name* for the code flow — every
// token still requires a user completing consent, and a public client
// (token_endpoint_auth_method "none") must use PKCE. Redirect URIs are
// restricted to https (plus http://localhost for local development tools).

import { NextResponse } from 'next/server';
import { registerDynamicClient } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

const ALLOWED_AUTH_METHODS = new Set(['client_secret_post', 'client_secret_basic', 'none']);

function isAcceptableRedirect(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    redirect_uris?: unknown;
    client_name?: unknown;
    token_endpoint_auth_method?: unknown;
  };

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
    : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAcceptableRedirect)) {
    return NextResponse.json(
      {
        error: 'invalid_redirect_uri',
        error_description: '1-10 redirect_uris required; https only (http allowed for localhost).'
      },
      { status: 400 }
    );
  }

  const authMethod =
    typeof body.token_endpoint_auth_method === 'string' && ALLOWED_AUTH_METHODS.has(body.token_endpoint_auth_method)
      ? body.token_endpoint_auth_method
      : 'client_secret_post';
  const name =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : 'Unnamed MCP client';

  const { clientId, clientSecret } = await registerDynamicClient({
    redirectUris,
    name,
    tokenEndpointAuthMethod: authMethod
  });

  return NextResponse.json(
    {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    },
    { status: 201 }
  );
}
