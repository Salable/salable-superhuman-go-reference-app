// RFC 8414 authorisation-server metadata. MCP hosts discover the endpoints
// here before running Dynamic Client Registration and the code flow.

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const issuer = config.appUrl;
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    scopes_supported: ['agent']
  });
}
