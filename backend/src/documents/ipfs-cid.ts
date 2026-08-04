const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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
  let shift = 0;

  for (let index = offset; index < bytes.length && shift < 35; index += 1) {
    const byte = bytes[index];
    if ((byte & 0x80) === 0) return index + 1;
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
