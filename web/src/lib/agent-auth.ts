// Bearer-token authentication for the agent API.
//
// The Pack's OAuth connection means every formula invocation reaches us with
// the *user's own* access token, injected by Superhuman's fetcher. Resolving
// that token here is the only trustworthy source of identity in the whole
// system — nothing the LLM says about who is asking is ever believed.

import { createHash, randomBytes } from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from './db';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour; refresh handles the rest.

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newGranteeId(): string {
  return `usr_${randomBytes(10).toString('hex')}`;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function issueTokens(userId: string, scope: string): Promise<IssuedTokens> {
  const accessToken = `svat_${randomBytes(24).toString('hex')}`;
  const refreshToken = `svrt_${randomBytes(24).toString('hex')}`;
  await prisma.agentToken.create({
    data: {
      userId,
      scope,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000)
    }
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export async function rotateTokens(refreshToken: string): Promise<IssuedTokens | null> {
  const existing = await prisma.agentToken.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) }
  });
  if (!existing || existing.revokedAt) return null;

  const issued = await issueTokens(existing.userId, existing.scope);
  await prisma.agentToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() }
  });
  return issued;
}

/**
 * Resolves the calling user from an Authorization: Bearer header. Returns null
 * for missing/unknown tokens and 'expired' for expired ones — the token
 * endpoint's refresh flow relies on the 401 the caller sends back for both.
 */
export async function resolveBearerUser(request: Request): Promise<User | 'expired' | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;

  const token = await prisma.agentToken.findUnique({
    where: { accessTokenHash: hashToken(match[1]) },
    include: { user: true }
  });
  if (!token || token.revokedAt) return null;
  if (token.accessExpiresAt.getTime() < Date.now()) return 'expired';
  return token.user;
}
