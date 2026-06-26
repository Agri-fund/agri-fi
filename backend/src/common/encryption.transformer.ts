import { ValueTransformer } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * TypeORM column transformer that encrypts values using AES-256-CBC before
 * writing to the database and decrypts them on read.
 *
 * Requires ENCRYPTION_KEY environment variable: 64-character hex string (32 bytes).
 * Generate with: openssl rand -hex 32
 */
export class EncryptionTransformer implements ValueTransformer {
  private getKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY ?? '';
    if (!raw) {
      throw new Error('ENCRYPTION_KEY environment variable is not set');
    }
    return Buffer.from(raw, 'hex');
  }

  to(value: string | null | undefined): string | null {
    if (value == null) return null;
    const key = this.getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  from(value: string | null | undefined): string | null {
    if (value == null) return null;
    // Return plain value if it was stored before encryption was enabled
    if (!value.includes(':')) return value;
    try {
      const key = this.getKey();
      const [ivHex, encHex] = value.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const encrypted = Buffer.from(encHex, 'hex');
      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export const encryptionTransformer = new EncryptionTransformer();
