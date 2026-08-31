// The vault's capability layer, shared by both transports that expose it:
// the agent REST API (/api/agent/*) and the MCP server (/api/mcp).
//
// Every function takes an already-verified User and applies the same
// server-side entitlement guard — whichever protocol the request arrived by,
// the enforcement is this code.

import type { User } from '@prisma/client';
import { config, ENTITLEMENTS } from './config';
import { prisma } from './db';
import { getEntitlements } from './entitlements';
import { createSignedLink } from './links';
import { createCheckoutLink, recordUsage } from './salable';
import { suggestTags } from './tagging';

export interface PaywallInfo {
  message: string;
  checkoutUrl: string;
  pricingUrl: string;
}

export type SaveResult =
  | {
      ok: true;
      snippet: { id: string; content: string; source: string | null };
      plan: 'free' | 'pro';
      remainingFreeSaves: number | null;
      usageRecorded: boolean;
    }
  | { ok: false; paywall: PaywallInfo };

export type TagResult =
  | { ok: true; snippet: { id: string; tags: string[] } }
  | { ok: false; paywall: PaywallInfo }
  | { ok: false; notFound: true };

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function paywall(user: User, message: string): Promise<PaywallInfo> {
  return {
    message,
    checkoutUrl: await createCheckoutLink({ granteeId: user.granteeId, email: user.email }),
    pricingUrl: createSignedLink(user.granteeId, 'upgrade')
  };
}

export async function saveSnippet(
  user: User,
  content: string,
  source?: string | null
): Promise<SaveResult> {
  const entitlements = await getEntitlements(user);
  const isPro = entitlements.values.includes(ENTITLEMENTS.unlimitedSaves);

  if (!isPro) {
    const savedThisMonth = await prisma.snippet.count({
      where: { userId: user.id, createdAt: { gte: monthStart() } }
    });
    if (savedThisMonth >= config.freeSnippetAllowance) {
      return {
        ok: false,
        paywall: await paywall(
          user,
          `You have used all ${config.freeSnippetAllowance} free saves for this month. ` +
            'Upgrade to Pro for unlimited saves and AI tagging.'
        )
      };
    }
  }

  const snippet = await prisma.snippet.create({
    data: { userId: user.id, content, source: source ?? null }
  });
  const usage = await recordUsage(user.granteeId).catch(() => 'error' as const);
  const remaining = isPro
    ? null
    : config.freeSnippetAllowance -
      (await prisma.snippet.count({
        where: { userId: user.id, createdAt: { gte: monthStart() } }
      }));

  return {
    ok: true,
    snippet: { id: snippet.id, content: snippet.content, source: snippet.source },
    plan: isPro ? 'pro' : 'free',
    remainingFreeSaves: remaining,
    usageRecorded: usage === 'recorded'
  };
}

export async function listSnippets(user: User, query?: string | null) {
  const snippets = await prisma.snippet.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  const needle = query?.toLowerCase() ?? '';
  const matches = needle
    ? snippets.filter(
        s => s.content.toLowerCase().includes(needle) || s.tags.some(t => t.includes(needle))
      )
    : snippets;
  return matches.slice(0, 25).map(s => ({
    id: s.id,
    content: s.content,
    source: s.source,
    tags: s.tags,
    createdAt: s.createdAt.toISOString()
  }));
}

export async function tagSnippet(user: User, snippetId: string): Promise<TagResult> {
  const entitlements = await getEntitlements(user);
  if (!entitlements.values.includes(ENTITLEMENTS.aiTagging)) {
    return {
      ok: false,
      paywall: await paywall(
        user,
        'AI tagging is a Pro feature. Upgrade to tag snippets automatically.'
      )
    };
  }

  const snippet = await prisma.snippet.findFirst({ where: { id: snippetId, userId: user.id } });
  if (!snippet) return { ok: false, notFound: true };

  const tags = suggestTags(snippet.content);
  await prisma.snippet.update({ where: { id: snippet.id }, data: { tags } });
  return { ok: true, snippet: { id: snippet.id, tags } };
}
