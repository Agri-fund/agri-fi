import { createHash } from 'crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value: string): Uint8Array | null {
  const bytes = [0];

  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit === -1) return null;

    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

function decodeBase32(value: string): Uint8Array | null {
  if (!/^b[a-z2-7]+$/.test(value)) return null;

  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const char of value.slice(1)) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Uint8Array.from(bytes);
}

function readVarint(bytes: Uint8Array, offset: number): number | null {
  let value = 0;
  let shift = 0;

  for (let index = offset; index < bytes.length && shift < 35; index += 1) {
    const byte = bytes[index];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return index + 1;
    shift += 7;
  }

  return null;
}

function readVarintValue(
  bytes: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } | null {
  let value = 0;
  let shift = 0;

  for (let index = offset; index < bytes.length && shift < 35; index += 1) {
    const byte = bytes[index];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, nextOffset: index + 1 };
    shift += 7;
  }

  return null;
}

export function isValidIpfsCid(value: string): boolean {
  if (!value || /\s/.test(value)) return false;

  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) {
    const bytes = decodeBase58(value);
    return bytes?.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20;
  }

  const bytes = value.startsWith('b') ? decodeBase32(value) : null;
  if (!bytes) return false;

  const versionEnd = readVarint(bytes, 0);
  if (versionEnd === null || bytes[0] !== 1) return false;

  const codecEnd = readVarint(bytes, versionEnd);
  const hashCodeEnd = codecEnd === null ? null : readVarint(bytes, codecEnd);
  const digestLengthEnd =
    hashCodeEnd === null ? null : readVarint(bytes, hashCodeEnd);

  return digestLengthEnd !== null && digestLengthEnd < bytes.length;
}

/** Verify content against CIDv0/CIDv1 SHA-256 or SHA-512 multihashes. */
export function verifyIpfsContent(cid: string, content: Buffer): boolean {
  if (!isValidIpfsCid(cid)) return false;

  const encoded = cid.startsWith('Qm') ? decodeBase58(cid) : decodeBase32(cid);
  if (!encoded) return false;

  let hashCode: number;
  let digest: Uint8Array;
  if (cid.startsWith('Qm')) {
    hashCode = encoded[0];
    digest = encoded.slice(2);
  } else {
    const version = readVarintValue(encoded, 0);
    const codec = version && readVarintValue(encoded, version.nextOffset);
    const hash = codec && readVarintValue(encoded, codec.nextOffset);
    const length = hash && readVarintValue(encoded, hash.nextOffset);
    if (!version || !codec || !hash || !length || length.value !== encoded.length - length.nextOffset) {
      return false;
    }
    hashCode = hash.value;
    digest = encoded.slice(length.nextOffset);
  }

  const algorithm = hashCode === 0x12 ? 'sha256' : hashCode === 0x13 ? 'sha512' : null;
  if (!algorithm) return false;
  const calculated = createHash(algorithm).update(content).digest();
  return calculated.length === digest.length && calculated.equals(Buffer.from(digest));
}
