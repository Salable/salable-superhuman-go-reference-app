"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod2) => __copyProps(__defProp({}, "__esModule", { value: true }), mod2);

// ../pack/src/salable-verify.ts
var salable_verify_exports = {};
__export(salable_verify_exports, {
  signedPayload: () => signedPayload,
  verifyEntitlementsSignature: () => verifyEntitlementsSignature
});
module.exports = __toCommonJS(salable_verify_exports);

// ../pack/src/p256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256(message) {
  const length = message.length;
  const bitLength = length * 8;
  const paddedLength = (length + 8 >> 6) + 1 << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const h = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) digestView.setUint32(i * 4, h[i]);
  return digest;
}
var P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
var N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
var A = BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc");
var B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
var GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
var GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
function mod(value, modulus) {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}
function modPow(base, exponent, modulus) {
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
function modInverse(value, modulus) {
  return modPow(value, modulus - 2n, modulus);
}
function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, P) === 0n) return null;
    const lambda2 = mod((3n * p1.x * p1.x + A) * modInverse(2n * p1.y, P), P);
    const x2 = mod(lambda2 * lambda2 - 2n * p1.x, P);
    return { x: x2, y: mod(lambda2 * (p1.x - x2) - p1.y, P) };
  }
  const lambda = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, P), P);
  const x = mod(lambda * lambda - p1.x - p2.x, P);
  return { x, y: mod(lambda * (p1.x - x) - p1.y, P) };
}
function pointMultiply(scalar, point) {
  let result = null;
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}
function isOnCurve(point) {
  const { x, y } = point;
  if (x <= 0n || x >= P || y <= 0n || y >= P) return false;
  return mod(y * y - (x * x * x + A * x + B), P) === 0n;
}
function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) result = result << 8n | BigInt(byte);
  return result;
}
function parseDerSignature(der) {
  let index = 0;
  const readLength = () => {
    let length = der[index++];
    if (length & 128) {
      const byteCount = length & 127;
      length = 0;
      for (let i = 0; i < byteCount; i++) length = length << 8 | der[index++];
    }
    return length;
  };
  if (der[index++] !== 48) return null;
  readLength();
  if (der[index++] !== 2) return null;
  const rLength = readLength();
  const r = bytesToBigInt(der.slice(index, index + rLength));
  index += rLength;
  if (der[index++] !== 2) return null;
  const sLength = readLength();
  const s = bytesToBigInt(der.slice(index, index + sLength));
  return { r, s };
}
function verifyP256(messageDigest, derSignature, publicKeyPoint) {
  if (publicKeyPoint.length !== 65 || publicKeyPoint[0] !== 4) return false;
  const publicKey = {
    x: bytesToBigInt(publicKeyPoint.slice(1, 33)),
    y: bytesToBigInt(publicKeyPoint.slice(33, 65))
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

// ../pack/src/salable-verify.ts
function publicKeyPointFromPem(pem) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const point = der.slice(der.length - 65);
  if (point[0] !== 4) {
    throw new Error("Unsupported public key format: expected an uncompressed P-256 point.");
  }
  return point;
}
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex signature.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
function signedPayload(entitlements) {
  const record = {};
  for (const entitlement of entitlements) {
    record[entitlement.value] = {
      value: entitlement.value,
      type: entitlement.type,
      expiryDate: entitlement.expiryDate
    };
  }
  return JSON.stringify(record);
}
function verifyEntitlementsSignature(entitlements, signatureHex, publicKeyPem) {
  try {
    const message = new TextEncoder().encode(signedPayload(entitlements));
    const digest = sha256(message);
    return verifyP256(digest, hexToBytes(signatureHex), publicKeyPointFromPem(publicKeyPem));
  } catch {
    return false;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  signedPayload,
  verifyEntitlementsSignature
});
