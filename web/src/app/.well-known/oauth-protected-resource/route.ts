// RFC 9728 protected-resource metadata. The MCP endpoint's 401 challenge
// points here so hosts can find the authorisation server on their own.

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    resource: `${config.appUrl}/api/mcp`,
    authorization_servers: [config.appUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: ['agent']
  });
}
