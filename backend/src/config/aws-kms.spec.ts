import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

class MockKMSProvider {
  private encryptionKey: Buffer;

  constructor(keyHex: string) {
    this.encryptionKey = Buffer.from(keyHex, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}

describe('MockKMSProvider', () => {
  let kmsProvider: MockKMSProvider;
  const testKey = '0'.repeat(64);

  beforeEach(() => {
    kmsProvider = new MockKMSProvider(testKey);
  });

  describe('Encrypt and decrypt operations', () => {
    it('encrypts plaintext string using KMS', () => {
      const plaintext = 'test-secret-key';
      const ciphertext = kmsProvider.encrypt(plaintext);

      expect(ciphertext).toBeTruthy();
      expect(ciphertext).toContain(':');
      expect(ciphertext).not.toBe(plaintext);
    });

    it('decrypts ciphertext to yield original plaintext string', () => {
      const plaintext = 'test-secret-key';
      const ciphertext = kmsProvider.encrypt(plaintext);
      const decrypted = kmsProvider.decrypt(ciphertext);

      expect(decrypted).toBe(plaintext);
    });

    it('handles multiple encryption-decryption cycles', () => {
      const plaintexts = [
        'secret-one',
        'secret-two-longer',
        'STELLARKEYWITHSPECIALCHARS_12345',
      ];

      plaintexts.forEach((plaintext) => {
        const ciphertext = kmsProvider.encrypt(plaintext);
        const decrypted = kmsProvider.decrypt(ciphertext);
        expect(decrypted).toBe(plaintext);
      });
    });

    it('produces different ciphertexts for same plaintext due to random IV', () => {
      const plaintext = 'same-plaintext';
      const ciphertext1 = kmsProvider.encrypt(plaintext);
      const ciphertext2 = kmsProvider.encrypt(plaintext);

      expect(ciphertext1).not.toBe(ciphertext2);

      const decrypted1 = kmsProvider.decrypt(ciphertext1);
      const decrypted2 = kmsProvider.decrypt(ciphertext2);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });
  });
});
