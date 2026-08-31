// Approach C — the monetised MCP server.
//
// The same vault capabilities as /api/agent/*, exposed as MCP tools over
// Streamable HTTP (POST-only JSON-RPC 2.0; no SSE stream, like Salable's own
// server). Any MCP host — Claude, Codex, or a Superhuman Pack via
// `pack.addMCPServer` — can attach. Auth is a bearer token from this app's
// OAuth server; an unauthenticated request gets the RFC 9728 challenge so
// hosts can discover registration and the code flow on their own.
//
// Enforcement lives in the shared vault layer: when the free allowance is
// gone, `save_snippet` returns the paywall message and a freshly minted
// checkout URL as the tool result — the calling agent relays the link, which
// is exactly the pattern the REST path uses.

import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { resolveBearerUser } from '@/lib/agent-auth';
import { config } from '@/lib/config';
import { getEntitlements } from '@/lib/entitlements';
import { listSnippets, saveSnippet, tagSnippet } from '@/lib/vault';

export const dynamic = 'force-dynamic';

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'check_access',
    description:
      "Check the user's Snippet Vault plan and entitlements (via Salable). Call before pitching gated features.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'save_snippet',
    description:
      "Save a snippet of text to the user's vault. Free accounts have a monthly allowance; when it is used up the result contains an upgrade link to share with the user.",
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The text to save.' },
        source: { type: 'string', description: 'URL of the page the text came from.' }
      },
      required: ['content'],
      additionalProperties: false
    }
  },
  {
    name: 'list_snippets',
    description: "List or search the user's saved snippets.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for; omit to list recent.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'tag_snippet',
    description:
      'Automatically tag a saved snippet (Pro feature). Returns an upgrade link when the plan does not include AI tagging.',
    inputSchema: {
      type: 'object',
      properties: {
        snippetId: { type: 'string', description: 'Id of the snippet, from save_snippet or list_snippets.' }
      },
      required: ['snippetId'],
      additionalProperties: false
    }
  }
];

function textResult(text: string, structured?: unknown) {
  return {
    content: [{ type: 'text', text }],
    ...(structured !== undefined ? { structuredContent: structured } : {})
  };
}

async function callTool(user: User, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'check_access': {
      const entitlements = await getEntitlements(user);
      const plan = entitlements.values.includes('unlimited_saves') ? 'pro' : 'free';
      return textResult(
        `Plan: ${plan}. Active entitlements: ${entitlements.values.join(', ') || 'none'}.`,
        { plan, entitlements: entitlements.values, granteeId: user.granteeId }
      );
    }
    case 'save_snippet': {
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      if (!content) return { ...textResult('content is required'), isError: true };
      const result = await saveSnippet(user, content, typeof args.source === 'string' ? args.source : null);
      if (!result.ok) {
        return textResult(
          `${result.paywall.message}\nCheckout link (share with the user): ${result.paywall.checkoutUrl}\nPlan details: ${result.paywall.pricingUrl}`,
          { paymentRequired: true, ...result.paywall }
        );
      }
      const remaining =
        result.plan === 'pro'
          ? 'Saved to the vault.'
          : `Saved to the vault. ${result.remainingFreeSaves} free save${result.remainingFreeSaves === 1 ? '' : 's'} left this month.`;
      return textResult(remaining, result);
    }
    case 'list_snippets': {
      const snippets = await listSnippets(user, typeof args.query === 'string' ? args.query : null);
      return textResult(
        snippets.length
          ? snippets.map(s => `- [${s.id}] ${s.content}${s.tags.length ? ` (tags: ${s.tags.join(', ')})` : ''}`).join('\n')
          : 'No snippets found.',
        { snippets }
      );
    }
    case 'tag_snippet': {
      const snippetId = typeof args.snippetId === 'string' ? args.snippetId : '';
      const result = await tagSnippet(user, snippetId);
      if (!result.ok) {
        if ('notFound' in result) return { ...textResult('Snippet not found.'), isError: true };
        return textResult(
          `${result.paywall.message}\nCheckout link (share with the user): ${result.paywall.checkoutUrl}`,
          { paymentRequired: true, ...result.paywall }
        );
      }
      return textResult(`Tagged: ${result.snippet.tags.join(', ') || 'no tags suggested'}.`, result.snippet);
    }
    default:
      return null;
  }
}

function unauthorised() {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorised' }, id: null },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${config.appUrl}/.well-known/oauth-protected-resource"`
      }
    }
  );
}

export async function POST(request: Request) {
  const user = await resolveBearerUser(request);
  if (!user || user === 'expired') return unauthorised();

  const rpc = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      { status: 400 }
    );
  }

  const reply = (result: unknown) => NextResponse.json({ jsonrpc: '2.0', id: rpc.id ?? null, result });
  const fail = (code: number, message: string, status = 400) =>
    NextResponse.json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code, message } }, { status });

  switch (rpc.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'snippet-vault', version: '1.0.0' },
        instructions:
          'Snippet Vault: save and retrieve text snippets. Call check_access before pitching gated features; when a tool result contains a checkout link, share it with the user.'
      });
    case 'notifications/initialized':
      // Notification — acknowledge with no body.
      return new Response(null, { status: 202 });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = typeof rpc.params?.name === 'string' ? rpc.params.name : '';
      const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      const result = await callTool(user, name, args);
      if (!result) return fail(-32602, `Unknown tool: ${name}`);
      return reply(result);
    }
    default:
      return fail(-32601, `Method not implemented: ${rpc.method}`, 404);
  }
}

// Streamable HTTP without an SSE stream: GET is explicitly not supported.
export async function GET() {
  return NextResponse.json(
    { error: 'GET stream transport is not supported; POST JSON-RPC requests instead.' },
    { status: 405 }
  );
}
