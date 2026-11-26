import { ValueTransformer } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Envelope format produced by this transformer:
 *
 *   v2:<kemCiphertextHex>:<ivHex>:<authTagHex>:<ciphertextHex>
 *
 * The data-encryption key is derived from BOTH a classical secret (the
 * ENCRYPTION_KEY master key, mixed with a per-record ephemeral value) and a
 * post-quantum KEM shared secret. An attacker must break both to recover the
 * plaintext (hybrid construction). Ciphertext uses AES-256-GCM for
 * authenticated encryption.
 *
 * Legacy formats are still readable:
 *   - v1: <ivHex>:<ciphertextHex>           (AES-256-CBC, classical only)
 *   - plain: values without ':' stored before encryption was enabled
 *
 * Environment:
 *   ENCRYPTION_KEY       64-char hex (32 bytes) classical master key
 *   PQ_KEM_PRIVATE_KEY   optional hex-encoded post-quantum KEM secret key
 *   PQ_KEM_PUBLIC_KEY    optional hex-encoded post-quantum KEM public key
 *   PQ_ENABLED           'false' disables PQ and falls back to classical v1-style
 *                        AES-256-GCM envelopes (default: enabled when keys exist)
 */

const V2_PREFIX = 'v2';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

/**
 * Minimal post-quantum KEM abstraction. Implementations wrap a NIST-selected
 * KEM (ML-KEM / CRYSTAL-Kyber) via an installed library. The transformer
 * consumes it through this interface so that the library can be swapped
 * without touching encryption logic.
 */
export interface PostQuantumKem {
  readonly algorithm: string;
  encapsulate(publicKey: Buffer): { ciphertext: Buffer; sharedSecret: Buffer };
  decapsulate(ciphertext: Buffer, secretKey: Buffer): Buffer;
}

/**
 * Key-management record for post-quantum keys: supports rotation by key id.
 */
export interface PqKeyRecord {
  id: string;
  publicKey: Buffer;
  secretKey: Buffer;
}

export class PqKeyring {
  private readonly keys = new Map<string, PqKeyRecord>();
  private activeId: string | null = null;

  add(record: PqKeyRecord, makeActive = true): void {
    this.keys.set(record.id, record);
    if (makeActive || this.activeId === null) this.activeId = record.id;
  }

  active(): PqKeyRecord | null {
    return this.activeId ? this.keys.get(this.activeId) ?? null : null;
  }

  get(id: string): PqKeyRecord | undefined {
    return this.keys.get(id);
  }

  retire(id: string): void {
    this.keys.delete(id);
    if (this.activeId === id) this.activeId = null;
  }
}

/**
 * Audit hook used to verify quantum-resistance coverage of sensitive data.
 */
export interface QuantumAuditSink {
  record(event: {
    operation: 'encrypt' | 'decrypt';
    scheme: 'hybrid-pq' | 'classical-fallback' | 'legacy-v1' | 'plaintext';
    timestamp: Date;
  }): void;
}

const noopAudit: QuantumAuditSink = { record: () => undefined };

export class EncryptionTransformer implements ValueTransformer {
  private readonly keyring = new PqKeyring();
  private readonly kem: PostQuantumKem | null;
  private readonly pqEnabled: boolean;
  private readonly audit: QuantumAuditSink;

  constructor(options: { kem?: PostQuantumKem | null; audit?: QuantumAuditSink } = {}) {
    this.kem = options.kem ?? null;
    this.audit = options.audit ?? noopAudit;
    this.pqEnabled = process.env.PQ_ENABLED !== 'false' && this.kem !== null;

    const pubHex = process.env.PQ_KEM_PUBLIC_KEY;
    const secHex = process.env.PQ_KEM_PRIVATE_KEY;
    if (pubHex && secHex) {
      this.keyring.add({
        id: process.env.PQ_KEM_KEY_ID ?? 'default',
        publicKey: Buffer.from(pubHex, 'hex'),
        secretKey: Buffer.from(secHex, 'hex'),
      });
    }
  }

  /** Register or rotate a PQ key pair at runtime. */
  rotateKey(record: PqKeyRecord): void {
    this.keyring.add(record, true);
  }

  /** Retire a PQ key; records encrypted under it become undecryptable via PQ. */
  retireKey(id: string): void {
    this.keyring.retire(id);
  }

  /** Reports whether the PQ layer is active (used by compliance/audit checks). */
  isQuantumResistant(): boolean {
    return this.pqEnabled && this.keyring.active() !== null;
  }

  private getMasterKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY ?? '';
    if (!raw) {
      throw new Error('ENCRYPTION_KEY environment variable is not set');
    }
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
    }
    return key;
  }

  /** Derive a 32-byte AES key from classical and optional PQ secrets. */
  private deriveKey(classical: Buffer, pqSecret: Buffer | null, context: Buffer): Buffer {
    const parts = [classical, context];
    if (pqSecret) parts.push(pqSecret);
    return createHash('sha256')
      .update(Buffer.from('enc-hybrid-v2\0'))
      .update(Buffer.concat(parts))
      .digest();
  }

  private encryptGcm(key: Buffer, plaintext: string): { iv: Buffer; tag: Buffer; ct: Buffer } {
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LENGTH });
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { iv, tag: cipher.getAuthTag(), ct };
  }

  to(value: string | null | undefined): string | null {
    if (value == null) return null;
    const master = this.getMasterKey();
    const ephemeral = randomBytes(32);
    const context = ephemeral;

    const active = this.isQuantumResistant() ? this.keyring.active() : null;
    if (active && this.kem) {
      const { ciphertext: kemCt, sharedSecret } = this.kem.encapsulate(active.publicKey);
      const key = this.deriveKey(
        Buffer.concat([master, ephemeral]),
        sharedSecret,
        Buffer.from(active.id, 'utf8'),
      );
      const { iv, tag, ct } = this.encryptGcm(key, value);
      this.audit.record({ operation: 'encrypt', scheme: 'hybrid-pq', timestamp: new Date() });
      return [
        V2_PREFIX,
        Buffer.from(active.id, 'utf8').toString('hex'),
        kemCt.toString('hex'),
        ephemeral.toString('hex'),
        iv.toString('hex'),
        tag.toString('hex'),
        ct.toString('hex'),
      ].join(':');
    }

    // Classical fallback: still AES-256-GCM, keyed only from the master key.
    const key = this.deriveKey(Buffer.concat([master, ephemeral]), null, context);
    const { iv, tag, ct } = this.encryptGcm(key, value);
    this.audit.record({ operation: 'encrypt', scheme: 'classical-fallback', timestamp: new Date() });
    return [
      V2_PREFIX,
      '',
      '',
      ephemeral.toString('hex'),
      iv.toString('hex'),
      tag.toString('hex'),
      ct.toString('hex'),
    ].join(':');
  }

  from(value: string | null | undefined): string | null {
    if (value == null) return null;
    if (!value.includes(':')) {
      this.audit.record({ operation: 'decrypt', scheme: 'plaintext', timestamp: new Date() });
      return value;
    }
    try {
      if (value.startsWith(V2_PREFIX + ':')) {
        return this.decryptV2(value);
      }
      return this.decryptLegacyV1(value);
    } catch {
      return null;
    }
  }

  private decryptV2(value: string): string | null {
    const parts = value.split(':');
    if (parts.length !== 7) return null;
    const [, keyIdHex, kemCtHex, ephHex, ivHex, tagHex, ctHex] = parts;
    const master = this.getMasterKey();
    const ephemeral = Buffer.from(ephHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');

    let pqSecret: Buffer | null = null;
    let keyId = '';
    if (keyIdHex.length > 0) {
      keyId = Buffer.from(keyIdHex, 'hex').toString('utf8');
      const record = this.keyring.get(keyId);
      if (!record || !this.kem) return null; // PQ key unavailable: cannot decrypt hybrid record
      pqSecret = this.kem.decapsulate(Buffer.from(kemCtHex, 'hex'), record.secretKey);
    }

    const key = this.deriveKey(
      Buffer.concat([master, ephemeral]),
      pqSecret,
      pqSecret ? Buffer.from(keyId, 'utf8') : ephemeral,
    );
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LENGTH });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    this.audit.record({
      operation: 'decrypt',
      scheme: pqSecret ? 'hybrid-pq' : 'classical-fallback',
      timestamp: new Date(),
    });
    return plain;
  }

  /** Legacy AES-256-CBC records written before the hybrid scheme. */
  private decryptLegacyV1(value: string): string | null {
    const master = this.getMasterKey();
    const [ivHex, encHex] = value.split(':');
    const decipher = createDecipheriv('aes-256-cbc', master, Buffer.from(ivHex, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    this.audit.record({ operation: 'decrypt', scheme: 'legacy-v1', timestamp: new Date() });
    return plain;
  }
}

export const encryptionTransformer = new EncryptionTransformer();
