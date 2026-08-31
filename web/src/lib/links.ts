// Signed, short-lived links the agent hands out in chat.
//
// A Pack cannot open a browser or hold a session, so anything the user must do
// on the web — upgrade, view their account — arrives as a URL in the chat
// reply. These links carry the grantee identity as a signed token so the web
// page knows who it is acting for without any login step.

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from './config';

const LINK_TTL_SECONDS = 60 * 60; // 1 hour

interface LinkPayload {
  granteeId: string;
  purpose: 'upgrade' | 'account';
  exp: number;
}

function sign(data: string): string {
  return createHmac('sha256', config.linkSecret).update(data).digest('base64url');
}

export function createSignedLink(granteeId: string, purpose: LinkPayload['purpose']): string {
  const payload: LinkPayload = {
    granteeId,
    purpose,
    exp: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${encoded}.${sign(encoded)}`;
  const path = purpose === 'upgrade' ? '/upgrade' : '/account';
  return `${config.appUrl}${path}?t=${token}`;
}

export function verifySignedLink(token: string, purpose: LinkPayload['purpose']): string | null {
  const separator = token.lastIndexOf('.');
  if (separator === -1) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as LinkPayload;
    if (payload.purpose !== purpose) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.granteeId;
  } catch {
    return null;
  }
}
