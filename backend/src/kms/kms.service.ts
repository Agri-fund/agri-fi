import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * KmsService provides envelope encryption using AWS KMS.
 * It generates a data key (DEK) for each secret, encrypts the secret locally with the DEK,
 * and stores the encrypted DEK alongside the ciphertext.
 */
@Injectable()
export class KmsService {
  private readonly logger = new Logger(KmsService.name);
  private readonly kmsClient: KMSClient;
  private readonly keyId: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION', 'us-east-1');
    this.keyId = this.config.get<string>('KMS_KEY_ID');
    if (!this.keyId) {
      throw new Error('KMS_KEY_ID environment variable is required');
    }
    this.kmsClient = new KMSClient({ region });
  }

  /**
   * Encrypt a plaintext secret using envelope encryption.
   * Returns a JSON string containing iv, ciphertext, and encrypted DEK, all hex‑encoded.
   */
  async encrypt(plainText: string): Promise<string> {
    // 1. Generate a data key from KMS
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

    // 2. Encrypt the secret locally with the DEK (AES‑256‑CBC)
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', dek, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);

    // 3. Return a JSON payload
    const payload = {
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      encryptedKey: encryptedDek.toString('hex'),
    };
    return JSON.stringify(payload);
  }

  /**
   * Decrypt a payload produced by {@link encrypt}.
   */
  async decrypt(payload: string): Promise<string> {
    let parsed: { iv: string; ciphertext: string; encryptedKey: string };
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      this.logger.error('Invalid encrypted payload format');
      throw new Error('Invalid encrypted payload format');
    }
    const { iv, ciphertext, encryptedKey } = parsed;
    // 1. Decrypt the DEK via KMS
    const decryptCmd = new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedKey, 'hex'),
    });
    const decryptResult = await this.kmsClient.send(decryptCmd);
    if (!decryptResult.Plaintext) {
      throw new Error('Failed to decrypt data key via KMS');
    }
    const dek = Buffer.from(decryptResult.Plaintext);

    // 2. Decrypt the secret locally
    const decipher = createDecipheriv('aes-256-cbc', dek, Buffer.from(iv, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    return decrypted;
  }
}
