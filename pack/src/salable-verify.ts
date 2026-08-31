// Client-side verification of Salable entitlement-check signatures.
//
// Salable signs every entitlement check response with a per-organisation
// ECDSA P-256 key (SHA-256, DER-encoded signature, hex). Verifying it here
// means the Pack trusts Salable's signing key — not whichever server relayed
// the response. That is the point of Path 1: even routed through the app's
// relay endpoint, a tampered entitlement list fails verification.
//
// Implemented against ./p256.ts (dependency-free SHA-256 + ECDSA verify)
// because Pack code runs in an isolated VM whose bundler cannot resolve the
// `node:crypto` imports mainstream crypto libraries use.
//
// Signed payload shape (from Salable's implementation): JSON of a record keyed
// by entitlement value, in response order, each entry {value, type, expiryDate}
// — i.e. the internal map the response array is derived from.

import { sha256, verifyP256 } from "./p256";

export interface SalableEntitlement {
  type: string;
  value: string;
  expiryDate: string | null;
}

/** Extracts the uncompressed EC point from a PEM SPKI public key. */
function publicKeyPointFromPem(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  // For P-256 SPKI the BIT STRING payload is the final 65 bytes: 0x04 || X || Y.
  const point = der.slice(der.length - 65);
  if (point[0] !== 0x04) {
    throw new Error("Unsupported public key format: expected an uncompressed P-256 point.");
  }
  return point;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex signature.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Rebuilds the exact byte string Salable signed, from the response array. */
export function signedPayload(entitlements: SalableEntitlement[]): string {
  const record: Record<string, SalableEntitlement> = {};
  for (const entitlement of entitlements) {
    record[entitlement.value] = {
      value: entitlement.value,
      type: entitlement.type,
      expiryDate: entitlement.expiryDate,
    };
  }
  return JSON.stringify(record);
}

export function verifyEntitlementsSignature(
  entitlements: SalableEntitlement[],
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  try {
    const message = new TextEncoder().encode(signedPayload(entitlements));
    const digest = sha256(message);
    return verifyP256(digest, hexToBytes(signatureHex), publicKeyPointFromPem(publicKeyPem));
  } catch {
    return false;
  }
}
