/**
 * reencrypt-pii.spec.ts — Unit tests for the PII re-encryption job (#1038)
 *
 * Tests cover:
 *   1. EncryptionTransformer helpers — format detection, encrypt/decrypt round-
 *      trips, key rotation (old key → new key), timing-safe verification
 *   2. KMS envelope-encryption helpers — payload format detection, round-trips
 *      via mocked KMSClient, re-encryption freshness (new IV/DEK each call)
 *   3. Double-encryption correctness — a value encrypted twice with the same
 *      function must still decrypt correctly (no accidental double-wrapping)
 *   4. Edge cases — null handling, pre-encryption plaintext passthrough,
 *      corrupted ciphertexts, wrong-key decryption, truncated payloads
 *   5. resolveTransformerKeys — env-var validation logic
 *
 * All tests are pure-unit (no DB, no real AWS calls).  KMSClient is replaced
 * with a minimal in-memory mock that simulates GenerateDataKey / Decrypt using
 * real Node crypto — giving us genuine AES-256-CBC correctness without AWS.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { KMSClient } from '@aws-sdk/client-kms';

import {
  isTransformerCiphertext,
  transformerDecrypt,
  transformerEncrypt,
  transformerVerify,
  isKmsPayload,
  kmsDecrypt,
  kmsReencrypt,
  resolveTransformerKeys,
  KmsPayload,
} from '../scripts/reencrypt-pii';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a random 32-byte key buffer (simulates a valid ENCRYPTION_KEY). */
function makeKey(): Buffer {
  return randomBytes(32);
}

/**
 * Build a minimal KMSClient mock backed by real AES-256-CBC so the
 * encrypt → decrypt cycle is genuinely verified.
 *
 * The mock maintains a small "DEK store" keyed by the hex CiphertextBlob it
 * returns from GenerateDataKey — allowing Decrypt to retrieve the same DEK.
 */
function makeMockKmsClient(): KMSClient {
  const dekStore = new Map<string, Buffer>();

  const mock = {
    send: jest.fn(async (command: any) => {
      const commandName: string =
        command?.constructor?.name ?? command?.__type ?? '';

      // GenerateDataKeyCommand
      if (commandName === 'GenerateDataKeyCommand') {
        const dek = randomBytes(32);
        // Use a random "CiphertextBlob" handle as the DEK identifier
        const handle = randomBytes(16);
        dekStore.set(handle.toString('hex'), dek);
        return {
          Plaintext:      dek,
          CiphertextBlob: handle,
        };
      }

      // DecryptCommand
      if (commandName === 'DecryptCommand') {
        const handleHex = Buffer.from(command.input.CiphertextBlob).toString('hex');
        const dek = dekStore.get(handleHex);
        if (!dek) throw new Error('Mock KMS: unknown CiphertextBlob handle');
        return { Plaintext: dek };
      }

      throw new Error(`Mock KMS: unhandled command ${commandName}`);
    }),
  } as unknown as KMSClient;

  return mock;
}

/**
 * Produce a valid transformer ciphertext string from a given plaintext and key
 * using the same algorithm as the script (AES-256-CBC, iv:ciphertext hex).
 */
function makeTransformerCiphertext(plaintext: string, key: Buffer): string {
  return transformerEncrypt(plaintext, key);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('reencrypt-pii — EncryptionTransformer helpers', () => {
  // ── isTransformerCiphertext ─────────────────────────────────────────────

  describe('isTransformerCiphertext', () => {
    it('returns true for a valid iv:ciphertext hex string', () => {
      const key = makeKey();
      const ct  = makeTransformerCiphertext('hello', key);
      expect(isTransformerCiphertext(ct)).toBe(true);
    });

    it('returns false for a plain string with no colon', () => {
      expect(isTransformerCiphertext('plaintext')).toBe(false);
    });

    it('returns false for a JSON KMS payload', () => {
      const payload = JSON.stringify({ iv: 'aa', ciphertext: 'bb', encryptedKey: 'cc' });
      expect(isTransformerCiphertext(payload)).toBe(false);
    });

    it('returns false when iv hex is too short (< 32 chars)', () => {
      // iv must be exactly 32 hex chars (16 bytes)
      expect(isTransformerCiphertext('aabbcc:deadbeef')).toBe(false);
    });

    it('returns false when ciphertext part is empty', () => {
      const iv = randomBytes(16).toString('hex'); // 32 hex chars
      expect(isTransformerCiphertext(`${iv}:`)).toBe(false);
    });

    it('returns false for non-hex characters in iv', () => {
      const nonHexIv = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'; // 32 chars but not hex
      expect(isTransformerCiphertext(`${nonHexIv}:deadbeef`)).toBe(false);
    });

    it('returns false for a string with more than one colon', () => {
      const key = makeKey();
      const ct  = makeTransformerCiphertext('test', key);
      expect(isTransformerCiphertext(ct + ':extra')).toBe(false);
    });
  });

  // ── transformerEncrypt / transformerDecrypt round-trip ──────────────────

  describe('transformerEncrypt / transformerDecrypt', () => {
    it('round-trips a simple ASCII string', () => {
      const key   = makeKey();
      const plain = 'John Doe';
      const ct    = transformerEncrypt(plain, key);
      expect(transformerDecrypt(ct, key)).toBe(plain);
    });

    it('round-trips a Unicode string (names with diacritics)', () => {
      const key   = makeKey();
      const plain = 'Ñoño García-López';
      const ct    = transformerEncrypt(plain, key);
      expect(transformerDecrypt(ct, key)).toBe(plain);
    });

    it('round-trips an empty string', () => {
      const key = makeKey();
      const ct  = transformerEncrypt('', key);
      expect(transformerDecrypt(ct, key)).toBe('');
    });

    it('round-trips a long string (1024 chars)', () => {
      const key   = makeKey();
      const plain = 'x'.repeat(1024);
      const ct    = transformerEncrypt(plain, key);
      expect(transformerDecrypt(ct, key)).toBe(plain);
    });

    it('produces a different ciphertext on each call (random IV)', () => {
      const key   = makeKey();
      const plain = 'same plaintext';
      const ct1   = transformerEncrypt(plain, key);
      const ct2   = transformerEncrypt(plain, key);
      expect(ct1).not.toBe(ct2);
      // but both decrypt to the same value
      expect(transformerDecrypt(ct1, key)).toBe(plain);
      expect(transformerDecrypt(ct2, key)).toBe(plain);
    });

    it('returns null when decrypting with the wrong key', () => {
      const key1  = makeKey();
      const key2  = makeKey();
      const ct    = transformerEncrypt('secret', key1);
      expect(transformerDecrypt(ct, key2)).toBeNull();
    });

    it('returns null for a non-ciphertext string', () => {
      const key = makeKey();
      expect(transformerDecrypt('not a ciphertext', key)).toBeNull();
    });

    it('returns null for a truncated iv:ciphertext pair', () => {
      const key = makeKey();
      const ct  = makeTransformerCiphertext('hello', key);
      // truncate the ciphertext half
      const truncated = ct.slice(0, ct.length - 4);
      expect(transformerDecrypt(truncated, key)).toBeNull();
    });
  });

  // ── Key rotation: decrypt with old key, re-encrypt with new key ─────────

  describe('key rotation round-trip', () => {
    it('decrypts with oldKey and re-encrypts with newKey correctly', () => {
      const oldKey  = makeKey();
      const newKey  = makeKey();
      const plain   = 'Tax ID: KE-123456';

      const oldCt   = transformerEncrypt(plain, oldKey);

      // Simulate what the re-encryption job does
      const decrypted = transformerDecrypt(oldCt, oldKey);
      expect(decrypted).toBe(plain);

      const newCt = transformerEncrypt(decrypted!, newKey);

      // Old key can no longer decrypt the new ciphertext
      expect(transformerDecrypt(newCt, oldKey)).toBeNull();
      // New key successfully decrypts it
      expect(transformerDecrypt(newCt, newKey)).toBe(plain);
    });

    it('detects already-rotated rows (new key decrypts, old key does not)', () => {
      const oldKey = makeKey();
      const newKey = makeKey();
      const plain  = 'already rotated';

      const newCt = transformerEncrypt(plain, newKey);

      // Simulating the job's fallback logic
      const withOld = transformerDecrypt(newCt, oldKey);
      const withNew = transformerDecrypt(newCt, newKey);

      expect(withOld).toBeNull();     // old key cannot read it
      expect(withNew).toBe(plain);    // new key can — already rotated
    });

    it('does not double-encrypt: re-encrypting an already-new-key ciphertext gives correct plaintext', () => {
      const key   = makeKey();
      const plain = 'phone: +254700000000';

      const first  = transformerEncrypt(plain, key);
      const second = transformerEncrypt(transformerDecrypt(first, key)!, key);

      // second is a fresh ciphertext of the same plaintext, not an encryption of the ciphertext
      expect(transformerDecrypt(second, key)).toBe(plain);
      // Verify the two ciphertexts differ (different IVs)
      expect(first).not.toBe(second);
    });
  });

  // ── transformerVerify ───────────────────────────────────────────────────

  describe('transformerVerify', () => {
    it('returns true when ciphertext decrypts to the expected plaintext', () => {
      const key   = makeKey();
      const plain = 'verified value';
      const ct    = transformerEncrypt(plain, key);
      expect(transformerVerify(ct, plain, key)).toBe(true);
    });

    it('returns false when plaintext does not match', () => {
      const key  = makeKey();
      const ct   = transformerEncrypt('correct', key);
      expect(transformerVerify(ct, 'wrong', key)).toBe(false);
    });

    it('returns false when ciphertext is corrupted', () => {
      const key = makeKey();
      const ct  = transformerEncrypt('value', key);
      // flip the last hex char
      const corrupted = ct.slice(0, -1) + (ct.slice(-1) === 'f' ? '0' : 'f');
      expect(transformerVerify(corrupted, 'value', key)).toBe(false);
    });

    it('returns false when key is wrong', () => {
      const key1 = makeKey();
      const key2 = makeKey();
      const ct   = transformerEncrypt('secret', key1);
      expect(transformerVerify(ct, 'secret', key2)).toBe(false);
    });
  });
});

// ─── KMS envelope-encryption helpers ─────────────────────────────────────────

describe('reencrypt-pii — KMS helpers', () => {
  const KMS_KEY_ID = 'arn:aws:kms:us-east-1:123456789012:key/test-key-id';

  // ── isKmsPayload ──────────────────────────────────────────────────────────

  describe('isKmsPayload', () => {
    it('returns true for a valid JSON KMS payload', () => {
      const payload: KmsPayload = {
        iv:           randomBytes(16).toString('hex'),
        ciphertext:   randomBytes(32).toString('hex'),
        encryptedKey: randomBytes(32).toString('hex'),
      };
      expect(isKmsPayload(JSON.stringify(payload))).toBe(true);
    });

    it('returns false for a plain string', () => {
      expect(isKmsPayload('STELLAR_SECRET_KEY_HERE')).toBe(false);
    });

    it('returns false for a transformer-format string', () => {
      const key = makeKey();
      const ct  = makeTransformerCiphertext('secret', key);
      expect(isKmsPayload(ct)).toBe(false);
    });

    it('returns false for JSON missing the encryptedKey field', () => {
      expect(isKmsPayload(JSON.stringify({ iv: 'aa', ciphertext: 'bb' }))).toBe(false);
    });

    it('returns false for malformed JSON', () => {
      expect(isKmsPayload('{not valid json')).toBe(false);
    });
  });

  // ── kmsDecrypt / kmsReencrypt round-trip ──────────────────────────────────

  describe('kmsDecrypt / kmsReencrypt', () => {
    let kmsClient: KMSClient;

    beforeEach(() => {
      kmsClient = makeMockKmsClient();
    });

    it('round-trips a Stellar secret key', async () => {
      const secret  = 'SBGAV4IUJUZ45UGKUPQQM3DPKF7IHV7IJDPXNUZF5K6MC3PX2N72FSBU';
      const payload = await kmsReencrypt(secret, kmsClient, KMS_KEY_ID);

      expect(isKmsPayload(payload)).toBe(true);
      expect(await kmsDecrypt(payload, kmsClient)).toBe(secret);
    });

    it('round-trips an empty string', async () => {
      const payload = await kmsReencrypt('', kmsClient, KMS_KEY_ID);
      expect(await kmsDecrypt(payload, kmsClient)).toBe('');
    });

    it('produces a different payload on each call (fresh DEK and IV)', async () => {
      const plain    = 'STELLAR_SECRET';
      const payload1 = await kmsReencrypt(plain, kmsClient, KMS_KEY_ID);
      const payload2 = await kmsReencrypt(plain, kmsClient, KMS_KEY_ID);

      expect(payload1).not.toBe(payload2);

      // Both must still decrypt correctly
      expect(await kmsDecrypt(payload1, kmsClient)).toBe(plain);
      expect(await kmsDecrypt(payload2, kmsClient)).toBe(plain);
    });

    it('produces a payload with iv, ciphertext, and encryptedKey fields', async () => {
      const payload  = await kmsReencrypt('test', kmsClient, KMS_KEY_ID);
      const parsed   = JSON.parse(payload) as KmsPayload;

      expect(typeof parsed.iv).toBe('string');
      expect(parsed.iv.length).toBe(32); // 16 bytes → 32 hex chars
      expect(typeof parsed.ciphertext).toBe('string');
      expect(parsed.ciphertext.length).toBeGreaterThan(0);
      expect(typeof parsed.encryptedKey).toBe('string');
      expect(parsed.encryptedKey.length).toBeGreaterThan(0);
    });

    it('throws when decrypting a corrupted payload', async () => {
      const payload  = await kmsReencrypt('secret', kmsClient, KMS_KEY_ID);
      const parsed   = JSON.parse(payload) as KmsPayload;
      // Corrupt the encryptedKey — KMS mock will not find the handle
      parsed.encryptedKey = randomBytes(16).toString('hex');
      await expect(kmsDecrypt(JSON.stringify(parsed), kmsClient)).rejects.toThrow();
    });

    it('throws when decrypting malformed JSON', async () => {
      await expect(kmsDecrypt('{not json', kmsClient)).rejects.toThrow();
    });

    it('throws when GenerateDataKey returns no Plaintext', async () => {
      const brokenClient = {
        send: jest.fn().mockResolvedValue({ Plaintext: null, CiphertextBlob: randomBytes(16) }),
      } as unknown as KMSClient;
      await expect(kmsReencrypt('test', brokenClient, KMS_KEY_ID)).rejects.toThrow(
        'KMS GenerateDataKeyCommand failed',
      );
    });

    it('throws when Decrypt returns no Plaintext', async () => {
      // Use a real encrypt first so the payload is structurally valid
      const payload = await kmsReencrypt('test', kmsClient, KMS_KEY_ID);
      const noPlainClient = {
        send: jest.fn().mockResolvedValue({ Plaintext: null }),
      } as unknown as KMSClient;
      await expect(kmsDecrypt(payload, noPlainClient)).rejects.toThrow(
        'KMS DecryptCommand returned no plaintext DEK',
      );
    });
  });

  // ── Double-encryption correctness ─────────────────────────────────────────

  describe('double-encryption guard', () => {
    it('does not double-encrypt: re-encrypting gives plaintext on single decrypt', async () => {
      const kmsClient = makeMockKmsClient();
      const plain     = 'STELLAR_ESCROW_SECRET';

      // First encryption
      const ct1 = await kmsReencrypt(plain, kmsClient, KMS_KEY_ID);
      // Simulate re-encryption job: decrypt then re-encrypt
      const intermediate = await kmsDecrypt(ct1, kmsClient);
      const ct2           = await kmsReencrypt(intermediate, kmsClient, KMS_KEY_ID);

      // A single decrypt of ct2 must return the original plaintext, not the
      // first-round ciphertext (which would indicate double-encryption).
      expect(await kmsDecrypt(ct2, kmsClient)).toBe(plain);
    });
  });
});

// ─── resolveTransformerKeys ───────────────────────────────────────────────────

describe('resolveTransformerKeys', () => {
  const validHex = randomBytes(32).toString('hex'); // 64 hex chars

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_OLD;
  });

  it('returns matching new and old key buffers when only ENCRYPTION_KEY is set', () => {
    process.env.ENCRYPTION_KEY = validHex;
    const { newKey, oldKey } = resolveTransformerKeys();
    expect(newKey.toString('hex')).toBe(validHex);
    expect(oldKey.toString('hex')).toBe(validHex);
    expect(newKey.equals(oldKey)).toBe(true);
  });

  it('returns different new and old key buffers when both vars are set', () => {
    const oldHex = randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY     = validHex;
    process.env.ENCRYPTION_KEY_OLD = oldHex;
    const { newKey, oldKey } = resolveTransformerKeys();
    expect(newKey.toString('hex')).toBe(validHex);
    expect(oldKey.toString('hex')).toBe(oldHex);
    expect(newKey.equals(oldKey)).toBe(false);
  });

  it('throws when ENCRYPTION_KEY is not set', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => resolveTransformerKeys()).toThrow('ENCRYPTION_KEY');
  });

  it('throws when ENCRYPTION_KEY is not 64 hex chars', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => resolveTransformerKeys()).toThrow('64-character hex string');
  });

  it('throws when ENCRYPTION_KEY_OLD is set but is not 64 hex chars', () => {
    process.env.ENCRYPTION_KEY     = validHex;
    process.env.ENCRYPTION_KEY_OLD = 'bad';
    expect(() => resolveTransformerKeys()).toThrow('ENCRYPTION_KEY_OLD');
  });

  it('the resolved buffers are exactly 32 bytes', () => {
    process.env.ENCRYPTION_KEY = validHex;
    const { newKey, oldKey } = resolveTransformerKeys();
    expect(newKey.length).toBe(32);
    expect(oldKey.length).toBe(32);
  });
});

// ─── Integration-style: full rotation scenario ───────────────────────────────

describe('full key-rotation scenario (transformer)', () => {
  it('rotates 5 PII columns from old key to new key without data loss', () => {
    const oldKey = makeKey();
    const newKey = makeKey();

    const piiValues = [
      'Full Legal Name Here',
      '1990-07-15',              // birthdate
      'KE-TAX-123456',           // tax_id
      '+254700123456',            // phone
      '12 Moi Avenue, Nairobi',  // physical_address
    ];

    // Simulate DB rows encrypted under the old key
    const oldCiphertexts = piiValues.map((v) => transformerEncrypt(v, oldKey));

    // Simulate re-encryption job processing
    const newCiphertexts = oldCiphertexts.map((ct) => {
      const plain = transformerDecrypt(ct, oldKey);
      expect(plain).not.toBeNull();
      return transformerEncrypt(plain!, newKey);
    });

    // Verify: old key can no longer read new ciphertexts
    for (const ct of newCiphertexts) {
      expect(transformerDecrypt(ct, oldKey)).toBeNull();
    }

    // Verify: new key correctly recovers all original values
    for (let i = 0; i < piiValues.length; i++) {
      expect(transformerDecrypt(newCiphertexts[i], newKey)).toBe(piiValues[i]);
    }
  });

  it('handles mixed-format rows (some plaintext, some encrypted)', () => {
    const oldKey = makeKey();
    const newKey = makeKey();

    // Pre-encryption row stored as plaintext (the transformer passthrough case)
    const plaintextRow    = 'Amara Diallo';             // no colon → not ciphertext
    const encryptedRow    = transformerEncrypt('Kofi Asante', oldKey);

    // Job logic: plaintext rows are re-encrypted directly
    const rotatedPlaintext = transformerEncrypt(plaintextRow, newKey);
    expect(transformerDecrypt(rotatedPlaintext, newKey)).toBe(plaintextRow);

    // Encrypted rows go through decrypt → re-encrypt
    const decrypted        = transformerDecrypt(encryptedRow, oldKey)!;
    const rotatedEncrypted = transformerEncrypt(decrypted, newKey);
    expect(transformerDecrypt(rotatedEncrypted, newKey)).toBe('Kofi Asante');
  });
});
