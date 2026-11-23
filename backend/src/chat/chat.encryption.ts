import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'crypto';
import { ValueTransformer } from 'typeorm';

const MESSAGE_PREFIX = 'enc:v1:';
const HYBRID_MESSAGE_PREFIX = 'enc:v2:';
const FILE_PREFIX = Buffer.from('AGF1');
const HYBRID_FILE_PREFIX = Buffer.from('AGF2');
const HYBRID_INFO = Buffer.from('chat-encryption-hybrid-v2');

function encryptionKey(): Buffer {
  const value = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string for chat encryption',
    );
  }
  return Buffer.from(value, 'hex');
}

/**
 * Post-quantum key material is supplied via PQ_ENCRYPTION_KEY (64 hex chars,
 * a 256-bit symmetric secret distributed out-of-band, e.g. from a KEM such as
 * ML-KEM / CRYSTAL-Kyber run by the key management service). When present, all
 * new writes use hybrid derivation: the final AES-256 key is HKDF-SHA256 over
 * the concatenation of the classical and PQ secrets, so confidentiality holds
 * as long as either component remains unbroken.
 */
function pqEncryptionKey(): Buffer | null {
  const value = process.env.PQ_ENCRYPTION_KEY;
  if (value == null || value === '') return null;
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('PQ_ENCRYPTION_KEY must be a 64-character hex string');
  }
  return Buffer.from(value, 'hex');
}

function hybridKey(classical: Buffer, pq: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.concat([classical, pq]), Buffer.alloc(0), HYBRID_INFO, 32),
  );
}

/** Returns the active key and whether hybrid mode is in effect. */
function activeKey(): { key: Buffer; hybrid: boolean } {
  const classical = encryptionKey();
  const pq = pqEncryptionKey();
  if (pq == null) return { key: classical, hybrid: false };
  return { key: hybridKey(classical, pq), hybrid: true };
}

/**
 * Decryption key for a record written in a given mode. Hybrid records require
 * the PQ key; if it is absent the record cannot be opened and we fail closed.
 */
function keyForMode(hybrid: boolean): Buffer {
  const classical = encryptionKey();
  if (!hybrid) return classical;
  const pq = pqEncryptionKey();
  if (pq == null) {
    throw new Error(
      'Hybrid-encrypted chat data requires PQ_ENCRYPTION_KEY to decrypt',
    );
  }
  return hybridKey(classical, pq);
}

/**
 * Classical-only fallback: used when PQ_ENCRYPTION_KEY is unset so the system
 * keeps operating. Reads of legacy v1 records always go through this path.
 */
function legacyKey(): Buffer {
  return encryptionKey();
}

function encryptBytes(value: Buffer): Buffer {
  const { key, hybrid } = activeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  const prefix = hybrid ? HYBRID_FILE_PREFIX : FILE_PREFIX;
  return Buffer.concat([prefix, iv, cipher.getAuthTag(), encrypted]);
}

function decryptBytes(value: Buffer): Buffer {
  const isHybrid =
    value.length >= HYBRID_FILE_PREFIX.length &&
    value.subarray(0, HYBRID_FILE_PREFIX.length).equals(HYBRID_FILE_PREFIX);
  const isClassical =
    value.length >= FILE_PREFIX.length &&
    value.subarray(0, FILE_PREFIX.length).equals(FILE_PREFIX);

  if (!isHybrid && !isClassical) {
    throw new Error(
      'Stored chat attachment is not encrypted or has an invalid format',
    );
  }

  const prefixLength = isHybrid
    ? HYBRID_FILE_PREFIX.length
    : FILE_PREFIX.length;
  if (value.length < prefixLength + 12 + 16) {
    throw new Error(
      'Stored chat attachment is not encrypted or has an invalid format',
    );
  }

  const ivStart = prefixLength;
  const tagStart = ivStart + 12;
  const dataStart = tagStart + 16;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    isHybrid ? keyForMode(true) : legacyKey(),
    value.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(value.subarray(tagStart, dataStart));
  return Buffer.concat([
    decipher.update(value.subarray(dataStart)),
    decipher.final(),
  ]);
}

/**
 * Audit helper: reports whether a stored value was protected with the hybrid
 * (post-quantum-resistant) scheme. Used for quantum-resistance verification.
 */
export function isPostQuantumProtected(stored: string | Buffer | null | undefined): boolean {
  if (stored == null) return false;
  if (typeof stored === 'string') return stored.startsWith(HYBRID_MESSAGE_PREFIX);
  return (
    stored.length >= HYBRID_FILE_PREFIX.length &&
    stored.subarray(0, HYBRID_FILE_PREFIX.length).equals(HYBRID_FILE_PREFIX)
  );
}

/** Digest of key configuration, suitable for audit logs (never the key itself). */
export function encryptionPolicyFingerprint(): string {
  const { hybrid } = activeKey();
  return createHash('sha256')
    .update(hybrid ? 'hybrid-v2' : 'classical-v1')
    .digest('hex');
}

export const encryptedChatMessageTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null {
    if (value == null) return null;
    const { key, hybrid } = activeKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const prefix = hybrid ? HYBRID_MESSAGE_PREFIX : MESSAGE_PREFIX;
    return `${prefix}${iv.toString('hex')}:${cipher
      .getAuthTag()
      .toString('hex')}:${encrypted.toString('hex')}`;
  },
  from(value: string | null | undefined): string | null {
    if (value == null) return null;
    const isHybrid = value.startsWith(HYBRID_MESSAGE_PREFIX);
    const isClassical = value.startsWith(MESSAGE_PREFIX);
    if (!isHybrid && !isClassical) {
      throw new Error(
        'Stored chat message is not encrypted or has an invalid format',
      );
    }

    const prefix = isHybrid ? HYBRID_MESSAGE_PREFIX : MESSAGE_PREFIX;
    const [ivHex, tagHex, encryptedHex] = value.slice(prefix.length).split(':');
    if (!ivHex || !tagHex || !encryptedHex) {
      throw new Error(
        'Stored chat message is not encrypted or has an invalid format',
      );
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      isHybrid ? keyForMode(true) : legacyKey(),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  },
};

export const chatFileEncryption = {
  encrypt: encryptBytes,
  decrypt: decryptBytes,
};
