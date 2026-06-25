import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-cbc';

function getKey(): Buffer {
  const hex = process.env.QUEUE_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'QUEUE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptPayload(data: unknown): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  return `v1:${iv.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptPayload<T = unknown>(ciphertext: string): T {
  const parts = ciphertext.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid ciphertext format — expected v1:<iv>:<data>');
  }
  const [, ivHex, encHex] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivHex, 'hex'),
  );
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8')) as T;
}
