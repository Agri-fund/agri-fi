import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';

/**
 * Envelope format version tags.
 *  - v1: legacy classical envelope (AES-256-CBC, DEK wrapped by KMS)
 *  - v2: hybrid envelope (AES-256-GCM, DEK wrapped by KMS, plus a
 *        post-quantum KEM layer whose shared secret is combined with the
 *        classical DEK through HKDF-SHA-256).
 */
const ENVELOPE_V1 = 'v1';
const ENVELOPE_V2 = 'v2';

/**
 * Post-quantum KEM identifier. The hybrid layer is designed around
 * ML-KEM-768 (FIPS 203, the standardized form of CRYSTALS-Kyber).
 */
export const PQ_KEM_ALGORITHM = 'ML-KEM-768';

/** Classification of a payload's quantum-resistance status. */
export type QuantumResistanceStatus = 'hybrid-pq' | 'classical-only' | 'invalid';

export interface EnvelopeMetadata {
  version: string;
  quantumResistant: boolean;
  kemAlgorithm?: string;
}

/**
 * Abstraction over a post-quantum KEM provider (e.g. liboqs bindings or a
 * FIPS-validated HSM / cloud service). Implementations must provide real
 * keypair generation, encapsulation and decapsulation.
 */
export interface PqKemProvider {
  readonly algorithm: string;
  generateKeyPair(): Promise<{ publicKey: Buffer; privateKey: Buffer }>;
  encapsulate(publicKey: Buffer): Promise<{ ciphertext: Buffer; sharedSecret: Buffer }>;
  decapsulate(privateKey: Buffer, ciphertext: Buffer): Promise<Buffer>;
}

/** Injection token used to supply the PQ KEM provider. */
export const PQ_KEM_PROVIDER = Symbol('PQ_KEM_PROVIDER');

/**
 * KmsService provides envelope encryption using AWS KMS.
 *
 * Encryption produces a hybrid (v2) envelope when a post-quantum KEM provider
 * is configured: the data encryption key is derived from BOTH the KMS-wrapped
 * classical DEK and a post-quantum KEM shared secret, so the data remains
 * confidential as long as either primitive holds. If the PQ provider is not
 * available or fails, the service falls back to a classical v1 envelope and
 * logs a warning, so availability is preserved.
 *
 * Decryption accepts both v1 (legacy) and v2 (hybrid) envelopes, enabling
 * gradual migration of stored data via {@link migrateLegacyPayload}.
 */
@Injectable()
export class KmsService {
  private readonly logger = new Logger(KmsService.name);
  private readonly kmsClient: KMSClient;
  private readonly keyId: string;
  private readonly pqProvider: PqKemProvider | null;
  private readonly pqPublicKey: Buffer | null;
  private readonly pqPrivateKey: Buffer | null;
  private readonly allowClassicalFallback: boolean;
  private readonly requirePqForNewData: boolean;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(PQ_KEM_PROVIDER) pqProvider?: PqKemProvider,
  ) {
    const region = this.config.get<string>('AWS_REGION', 'us-east-1');
    this.keyId = this.config.get<string>('KMS_KEY_ID');
    if (!this.keyId) {
      throw new Error('KMS_KEY_ID environment variable is required');
    }
    this.kmsClient = new KMSClient({ region });

    this.pqProvider = pqProvider ?? null;
    this.pqPublicKey = this.loadKeyFromEnv('PQ_KEM_PUBLIC_KEY_B64');
    this.pqPrivateKey = this.loadKeyFromEnv('PQ_KEM_PRIVATE_KEY_B64');
    this.allowClassicalFallback =
      this.config.get<string>('PQ_ALLOW_CLASSICAL_FALLBACK', 'true') === 'true';
    this.requirePqForNewData =
      this.config.get<string>('PQ_REQUIRED', 'false') === 'true';

    if (this.requirePqForNewData && !this.pqProvider) {
      throw new Error('PQ_REQUIRED is set but no PQ KEM provider is configured');
    }
    if (this.pqProvider && !this.pqPublicKey) {
      this.logger.warn('PQ provider configured without PQ_KEM_PUBLIC_KEY_B64; hybrid encryption disabled');
    }
  }

  /**
   * Encrypt a plaintext secret using hybrid envelope encryption.
   * Falls back to a classical envelope when the PQ layer is unavailable,
   * unless PQ_REQUIRED is enabled.
   */
  async encrypt(plainText: string): Promise<string> {
    if (this.pqProvider && this.pqPublicKey) {
      try {
        return await this.encryptHybrid(plainText);
      } catch (err) {
        if (this.requirePqForNewData || !this.allowClassicalFallback) {
          this.logger.error('Post-quantum encryption failed and fallback is disallowed', err as Error);
          throw err;
        }
        this.logger.warn(`Post-quantum encryption failed, falling back to classical: ${(err as Error).message}`);
      }
    } else if (this.requirePqForNewData) {
      throw new Error('PQ_REQUIRED is set but PQ public key is not configured');
    }
    return this.encryptClassical(plainText);
  }

  /**
   * Decrypt a payload produced by {@link encrypt} (v1 or v2).
   */
  async decrypt(payload: string): Promise<string> {
    const parsed = this.parsePayload(payload);
    if (parsed.v === ENVELOPE_V2) {
      return this.decryptHybrid(parsed);
    }
    return this.decryptClassical(parsed);
  }

  /**
   * Inspect a payload's quantum-resistance status without decrypting it.
   */
  inspectPayload(payload: string): EnvelopeMetadata & { status: QuantumResistanceStatus } {
    try {
      const parsed = this.parsePayload(payload);
      if (parsed.v === ENVELOPE_V2) {
        return {
          version: ENVELOPE_V2,
          quantumResistant: true,
          kemAlgorithm: parsed.kem?.alg,
          status: 'hybrid-pq',
        };
      }
      return { version: ENVELOPE_V1, quantumResistant: false, status: 'classical-only' };
    } catch {
      return { version: 'unknown', quantumResistant: false, status: 'invalid' };
    }
  }

  /**
   * Quantum-resistance audit: checks a set of stored payloads and reports
   * which are still classical-only and therefore require migration.
   */
  auditPayloads(payloads: Array<{ id: string; payload: string }>): {
    total: number;
    hybridPq: number;
    classicalOnly: string[];
    invalid: string[];
    compliant: boolean;
  } {
    const classicalOnly: string[] = [];
    const invalid: string[] = [];
    let hybridPq = 0;
    for (const { id, payload } of payloads) {
      const { status } = this.inspectPayload(payload);
      if (status === 'hybrid-pq') hybridPq++;
      else if (status === 'classical-only') classicalOnly.push(id);
      else invalid.push(id);
    }
    const result = {
      total: payloads.length,
      hybridPq,
      classicalOnly,
      invalid,
      compliant: classicalOnly.length === 0 && invalid.length === 0,
    };
    this.logger.log(
      `Quantum-resistance audit: ${hybridPq}/${payloads.length} hybrid, ${classicalOnly.length} classical-only, ${invalid.length} invalid`,
    );
    return result;
  }

  /**
   * Migrate a legacy v1 payload to the hybrid v2 format. Payloads that are
   * already v2 are returned unchanged.
   */
  async migrateLegacyPayload(payload: string): Promise<string> {
    const { version } = this.parsePayload(payload);
    if (version === ENVELOPE_V2) return payload;
    const plain = await this.decrypt(payload);
    if (!this.pqProvider || !this.pqPublicKey) {
      throw new Error('Cannot migrate: post-quantum provider is not configured');
    }
    return this.encryptHybrid(plain);
  }

  /**
   * Generate a new post-quantum KEM keypair, returned base64-encoded for
   * storage in the secret manager. Rotation procedure: generate, store as the
   * new key pair, migrate payloads, then retire the old private key.
   */
  async rotatePqKeyPair(): Promise<{ publicKeyB64: string; privateKeyB64: string; algorithm: string }> {
    if (!this.pqProvider) {
      throw new Error('No PQ KEM provider configured');
    }
    const { publicKey, privateKey } = await this.pqProvider.generateKeyPair();
    this.logger.log(`Generated new ${this.pqProvider.algorithm} keypair for rotation`);
    return {
      publicKeyB64: publicKey.toString('base64'),
      privateKeyB64: privateKey.toString('base64'),
      algorithm: this.pqProvider.algorithm,
    };
  }

  /** Compliance check: confirms the configured KEM is an approved NIST algorithm. */
  isCompliant(): { compliant: boolean; algorithm: string | null; reason?: string } {
    if (!this.pqProvider) {
      return { compliant: false, algorithm: null, reason: 'No PQ KEM provider configured' };
    }
    const approved = [PQ_KEM_ALGORITHM, 'ML-KEM-512', 'ML-KEM-1024'];
    if (!approved.includes(this.pqProvider.algorithm)) {
      return {
        compliant: false,
        algorithm: this.pqProvider.algorithm,
        reason: 'Algorithm is not a FIPS 203 ML-KEM parameter set',
      };
    }
    return { compliant: true, algorithm: this.pqProvider.algorithm };
  }

  // ---------------------------------------------------------------------------
  // Classical (v1) path
  // ---------------------------------------------------------------------------

  private async encryptClassical(plainText: string): Promise<string> {
    const genCmd = new GenerateDataKeyCommand({
      KeyId: this.keyId,
      KeySpec: 'AES_256',
    });
    const genResult = await this.kmsClient.send(genCmd);
    if (!genResult.Plaintext || !genResult.CiphertextBlob) {
      throw new Error('Failed to generate data key from KMS');
    }
    const dek = Buffer.from(genResult.Plaintext);
    const encryptedDek = Buffer.from(genResult.CiphertextBlob);

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', dek, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);

    return JSON.stringify({
      v: ENVELOPE_V1,
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      encryptedKey: encryptedDek.toString('hex'),
    });
  }

  private async decryptClassical(parsed: ParsedPayload): Promise<string> {
    const dek = await this.unwrapDek(parsed.encryptedKey!);
    const decipher = createDecipheriv('aes-256-cbc', dek, Buffer.from(parsed.iv!, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext!, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  // ---------------------------------------------------------------------------
  // Hybrid (v2) path
  // ---------------------------------------------------------------------------

  /**
   * Hybrid envelope:
   *  1. Generate classical DEK via KMS (wrapped form stored).
   *  2. Encapsulate a PQ shared secret to the PQ public key.
   *  3. Derive the content key = HKDF-SHA256(classicalDEK || pqSecret, salt, info).
   *  4. Encrypt the plaintext with AES-256-GCM under the derived key.
   */
  private async encryptHybrid(plainText: string): Promise<string> {
    if (!this.pqProvider || !this.pqPublicKey) {
      throw new Error('PQ provider not configured');
    }
    const genResult = await this.kmsClient.send(
      new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: 'AES_256' }),
    );
    if (!genResult.Plaintext || !genResult.CiphertextBlob) {
      throw new Error('Failed to generate data key from KMS');
    }
    const classicalDek = Buffer.from(genResult.Plaintext);
    const encryptedDek = Buffer.from(genResult.CiphertextBlob);

    const { ciphertext: kemCt, sharedSecret } = await this.pqProvider.encapsulate(this.pqPublicKey);
    const salt = randomBytes(32);
    const contentKey = this.deriveContentKey(classicalDek, sharedSecret, salt);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    zero(classicalDek);
    zero(sharedSecret);
    zero(contentKey);

    return JSON.stringify({
      v: ENVELOPE_V2,
      alg: 'AES-256-GCM',
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      salt: salt.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      encryptedKey: encryptedDek.toString('hex'),
      kem: {
        alg: this.pqProvider.algorithm,
        ciphertext: kemCt.toString('hex'),
      },
    });
  }

  private async decryptHybrid(parsed: ParsedPayload): Promise<string> {
    if (!parsed.kem) {
      throw new Error('Hybrid payload missing KEM block');
    }
    if (!this.pqProvider || !this.pqPrivateKey) {
      throw new Error('Hybrid payload requires PQ private key, which is not configured');
    }
    if (parsed.kem.alg !== this.pqProvider.algorithm) {
      throw new Error(`KEM algorithm mismatch: payload=${parsed.kem.alg}, configured=${this.pqProvider.algorithm}`);
    }
    const classicalDek = await this.unwrapDek(parsed.encryptedKey!);
    const sharedSecret = await this.pqProvider.decapsulate(
      this.pqPrivateKey,
      Buffer.from(parsed.kem.ciphertext, 'hex'),
    );
    const contentKey = this.deriveContentKey(classicalDek, sharedSecret, Buffer.from(parsed.salt!, 'hex'));

    const decipher = createDecipheriv('aes-256-gcm', contentKey, Buffer.from(parsed.iv!, 'hex'));
    decipher.setAuthTag(Buffer.from(parsed.tag!, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext!, 'hex')),
      decipher.final(),
    ]).toString('utf8');

    zero(classicalDek);
    zero(sharedSecret);
    zero(contentKey);
    return plain;
  }

  private deriveContentKey(classicalDek: Buffer, pqSecret: Buffer, salt: Buffer): Buffer {
    const ikm = Buffer.concat([classicalDek, pqSecret]);
    const info = Buffer.from('kms-hybrid-envelope-v2');
    const derived = hkdfSync('sha256', ikm, salt, info, 32);
    zero(ikm);
    return Buffer.from(derived);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async unwrapDek(encryptedKeyHex: string): Promise<Buffer> {
    const result = await this.kmsClient.send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedKeyHex, 'hex') }),
    );
    if (!result.Plaintext) {
      throw new Error('Failed to decrypt data key via KMS');
    }
    return Buffer.from(result.Plaintext);
  }

  private parsePayload(payload: string): ParsedPayload {
    let parsed: ParsedPayload;
    try {
      parsed = JSON.parse(payload);
    } catch {
      this.logger.error('Invalid encrypted payload format');
      throw new Error('Invalid encrypted payload format');
    }
    // Legacy payloads have no version tag and are treated as v1.
    if (!parsed.v) parsed.v = ENVELOPE_V1;
    if (parsed.v !== ENVELOPE_V1 && parsed.v !== ENVELOPE_V2) {
      throw new Error(`Unsupported envelope version: ${parsed.v}`);
    }
    return parsed;
  }

  private loadKeyFromEnv(name: string): Buffer | null {
    const value = this.config.get<string>(name);
    return value ? Buffer.from(value, 'base64') : null;
  }
}

interface ParsedPayload {
  v: string;
  iv?: string;
  tag?: string;
  salt?: string;
  ciphertext?: string;
  encryptedKey?: string;
  alg?: string;
  kem?: { alg: string; ciphertext: string };
}

function zero(buf: Buffer): void {
  buf.fill(0);
}
