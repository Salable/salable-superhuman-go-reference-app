// Minimal, dependency-free SHA-256 and ECDSA P-256 signature VERIFICATION.
//
// Why hand-rolled: Pack code runs in an isolated ES2022 VM and is bundled by
// the Packs CLI (esbuild → browserify), which cannot resolve the `node:crypto`
// imports that crypto libraries reach for. Verification needs no randomness
// and handles no secrets, so a small pure implementation is safe here — do NOT
// extend this file to signing or key generation.
//
// Verify path: SHA-256 digest → DER-decode (r, s) → check r,s in [1, n-1] →
// R = (z·s⁻¹)·G + (r·s⁻¹)·Q → valid iff R.x ≡ r (mod n). Standard ECDSA over
// NIST P-256 (secp256r1).

// --------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// --------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(message: Uint8Array): Uint8Array {
  const length = message.length;
  const bitLength = length * 8;
  // Pad: 0x80, zeros, 64-bit big-endian bit length, to a multiple of 64 bytes.
  const paddedLength = (((length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) digestView.setUint32(i * 4, h[i]);
  return digest;
}

// --------------------------------------------------------------------------
// P-256 (secp256r1) arithmetic — verification only
// --------------------------------------------------------------------------

// Curve: y² = x³ + ax + b over F_p
const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const A = BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc');
const B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');
const GX = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
const GY = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

type Point = { x: bigint; y: bigint } | null; // null = point at infinity

function mod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = mod(base, modulus);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, modulus);
    b = mod(b * b, modulus);
    e >>= 1n;
  }
  return result;
}

/** Modular inverse via Fermat's little theorem (modulus prime). */
function modInverse(value: bigint, modulus: bigint): bigint {
  return modPow(value, modulus - 2n, modulus);
}

function pointAdd(p1: Point, p2: Point): Point {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, P) === 0n) return null; // p2 = -p1
    // Doubling: λ = (3x² + a) / 2y
    const lambda = mod((3n * p1.x * p1.x + A) * modInverse(2n * p1.y, P), P);
    const x = mod(lambda * lambda - 2n * p1.x, P);
    return { x, y: mod(lambda * (p1.x - x) - p1.y, P) };
  }
  const lambda = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, P), P);
  const x = mod(lambda * lambda - p1.x - p2.x, P);
  return { x, y: mod(lambda * (p1.x - x) - p1.y, P) };
}

function pointMultiply(scalar: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}

function isOnCurve(point: { x: bigint; y: bigint }): boolean {
  const { x, y } = point;
  if (x <= 0n || x >= P || y <= 0n || y >= P) return false;
  return mod(y * y - (x * x * x + A * x + B), P) === 0n;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

/** Parses a DER ECDSA signature: SEQUENCE { INTEGER r, INTEGER s }. */
function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } | null {
  let index = 0;
  const readLength = (): number => {
    let length = der[index++];
    if (length & 0x80) {
      const byteCount = length & 0x7f;
      length = 0;
      for (let i = 0; i < byteCount; i++) length = (length << 8) | der[index++];
    }
    return length;
  };
  if (der[index++] !== 0x30) return null;
  readLength();
  if (der[index++] !== 0x02) return null;
  const rLength = readLength();
  const r = bytesToBigInt(der.slice(index, index + rLength));
  index += rLength;
  if (der[index++] !== 0x02) return null;
  const sLength = readLength();
  const s = bytesToBigInt(der.slice(index, index + sLength));
  return { r, s };
}

/**
 * Verifies an ECDSA P-256 / SHA-256 signature.
 *
 * @param messageDigest 32-byte SHA-256 digest of the signed data
 * @param derSignature  DER-encoded signature bytes
 * @param publicKeyPoint 65-byte uncompressed public key (0x04 || X || Y)
 */
export function verifyP256(
  messageDigest: Uint8Array,
  derSignature: Uint8Array,
  publicKeyPoint: Uint8Array
): boolean {
  if (publicKeyPoint.length !== 65 || publicKeyPoint[0] !== 0x04) return false;
  const publicKey = {
    x: bytesToBigInt(publicKeyPoint.slice(1, 33)),
    y: bytesToBigInt(publicKeyPoint.slice(33, 65)),
  };
  if (!isOnCurve(publicKey)) return false;

  const signature = parseDerSignature(derSignature);
  if (!signature) return false;
  const { r, s } = signature;
  if (r <= 0n || r >= N || s <= 0n || s >= N) return false;

  const z = bytesToBigInt(messageDigest);
  const sInverse = modInverse(s, N);
  const u1 = mod(z * sInverse, N);
  const u2 = mod(r * sInverse, N);

  const point = pointAdd(
    pointMultiply(u1, { x: GX, y: GY }),
    pointMultiply(u2, publicKey)
  );
  if (point === null) return false;
  return mod(point.x, N) === r;
}
