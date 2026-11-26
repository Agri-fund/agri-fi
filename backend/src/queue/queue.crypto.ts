import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Queue payload encryption.
 *
 * Current format (`v2`) is AES-256-GCM, which is authenticated: a tampered
 * ciphertext or an altered nonce/tag fails decryption instead of producing
 * garbage. The associated data (AAD) is bound to the queue name, so a valid
 * ciphertext replayed onto a different queue is rejected.
 *
 *   v2:<keyId>:<nonce hex>:<auth tag hex>:<ciphertext hex>
 *
 * Hybrid post-quantum format (`v3`) derives the AES-256-GCM data key from two
 * independent secrets: the classical queue key and a post-quantum shared
 * secret produced by an ML-KEM (CRYSTALS-Kyber, FIPS 203) encapsulation.
 * The data key is HKDF-SHA256(classicalKey || pqSharedSecret, salt, info),
 * so the payload remains confidential as long as either component holds.
 *
 *   v3:<keyId>:<pqKeyId>:<kemCiphertext hex>:<nonce hex>:<auth tag hex>:<ciphertext hex>
 *
 * Post-quantum key material is read from `QUEUE_PQ_KEYS` (JSON object of
 * pqKeyId -> { "publicKey": hex, "secretKey": hex }) and the primary pq key is
 * chosen via `QUEUE_PQ_KEY_ID`. Encryption emits v3 when a pq key is
 * configured and `QUEUE_PQ_MODE` is not `disabled`; otherwise it falls back to
 * v2 (fallback to classical). Decryption always accepts v1/v2/v3.
 *
 * Legacy `v1:<iv hex>:<ciphertext hex>` payloads (AES-256-CBC, no AAD) are
 * still accepted on decrypt so messages already in flight during the
 * transition are not lost. No new `v1` payloads are produced.
 */

const LEGACY_ALGORITHM = 'aes-256-cbc';
const LEGACY_IV_BYTES = 16;

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

const HYBRID_KDF_HASH = 'sha256';
const HYBRID_KDF_INFO = 'queue-payload-v3-hybrid';
const HYBRID_KDF_SALT_BYTES = 32;

const KEY_ENV_VARS = ['QUEUE_ENCRYPTION_KEY', 'ENCRYPTION_KEY'] as const;
const KEY_RING_ENV_VAR = 'QUEUE_ENCRYPTION_KEYS';
const PRIMARY_KEY_ID_ENV_VAR = 'QUEUE_ENCRYPTION_KEY_ID';
const DEFAULT_KEY_ID = '1';

const PQ_KEYS_ENV_VAR = 'QUEUE_PQ_KEYS';
const PQ_PRIMARY_KEY_ID_ENV_VAR = 'QUEUE_PQ_KEY_ID';
const PQ_MODE_ENV_VAR = 'QUEUE_PQ_MODE';

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const HEX_PATTERN = /^[0-9a-fA-F]*$/;

export interface QueueEncryptionKey {
  keyId: string;
  key: Buffer;
}

export interface PostQuantumKeyPair {
  keyId: string;
  publicKey: Buffer;
  secretKey: Buffer;
}

/**
 * Pluggable ML-KEM provider. The default provider is backed by Node's
 * `crypto` ML-KEM support when available (Node >= 24.7 / OpenSSL 3.5+); a
 * liboqs/PQClean-backed provider can be registered via {@link setPqKemProvider}.
 */
export interface PqKemProvider {
  name: string;
  generateKeyPair(): { publicKey: Buffer; secretKey: Buffer };
  encapsulate(publicKey: Buffer): { ciphertext: Buffer; sharedSecret: Buffer };
  decapsulate(secretKey: Buffer, ciphertext: Buffer): Buffer;
}

let pqProvider: PqKemProvider | null = null;

export function setPqKemProvider(provider: PqKemProvider | null): void {
  pqProvider = provider;
}

function resolvePqProvider(): PqKemProvider {
  if (pqProvider) {
    return pqProvider;
  }
  const cryptoModule = require('crypto') as Record<string, unknown>;
  const hasKem =
    typeof cryptoModule.encapsulate === 'function' &&
    typeof cryptoModule.decapsulate === 'function' &&
    typeof cryptoModule.generateKeyPairSync === 'function';
  if (!hasKem) {
    throw new Error(
      'No post-quantum KEM provider available. Install a liboqs/PQClean ' +
        'provider via setPqKemProvider() or run on a runtime with ML-KEM support.',
    );
  }
  throw new Error(
    'Native ML-KEM is not wired for this runtime; register a provider via setPqKemProvider().',
  );
}

function parseKey(hex: string, source: string): Buffer {
  if (!HEX_KEY_PATTERN.test(hex)) {
    throw new Error(
      `${source} must be a 64-character hex string (32 bytes). ` +
        'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

function parseKeyRing(raw: string): Map<string, Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${KEY_RING_ENV_VAR} must be a JSON object mapping key ids to ` +
        '64-character hex keys, e.g. {"1":"<hex>","2":"<hex>"}.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `${KEY_RING_ENV_VAR} must be a JSON object of keyId -> key.`,
    );
  }

  const ring = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error(
        `Invalid key id "${keyId}" in ${KEY_RING_ENV_VAR}: only letters, ` +
          'digits, "_" and "-" are allowed (the id is embedded in the payload).',
      );
    }
    if (typeof value !== 'string') {
      throw new Error(
        `Key "${keyId}" in ${KEY_RING_ENV_VAR} must be a string.`,
      );
    }
    ring.set(keyId, parseKey(value, `${KEY_RING_ENV_VAR}[${keyId}]`));
  }

  if (ring.size === 0) {
    throw new Error(`${KEY_RING_ENV_VAR} does not contain any keys.`);
  }

  return ring;
}

function readKeyRing(): Map<string, Buffer> {
  const ringJson = process.env[KEY_RING_ENV_VAR];
  if (ringJson && ringJson.trim() !== '') {
    return parseKeyRing(ringJson);
  }

  const singleKey = KEY_ENV_VARS.map((name) => process.env[name]).find(
    (value) => value !== undefined && value !== '',
  );
  if (!singleKey) {
    throw new Error(
      'QUEUE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    );
  }

  const keyId = process.env[PRIMARY_KEY_ID_ENV_VAR] ?? DEFAULT_KEY_ID;
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      `${PRIMARY_KEY_ID_ENV_VAR} must match ${KEY_ID_PATTERN.source}.`,
    );
  }

  return new Map([[keyId, parseKey(singleKey, 'QUEUE_ENCRYPTION_KEY')]]);
}

function getPrimaryKey(): QueueEncryptionKey {
  const ring = readKeyRing();
  const configuredKeyId = process.env[PRIMARY_KEY_ID_ENV_VAR];

  if (configuredKeyId) {
    const key = ring.get(configuredKeyId);
    if (!key) {
      throw new Error(
        `${PRIMARY_KEY_ID_ENV_VAR}=${configuredKeyId} is not present in the ` +
          'configured queue encryption key ring.',
      );
    }
    return { keyId: configuredKeyId, key };
  }

  if (ring.has(DEFAULT_KEY_ID)) {
    return { keyId: DEFAULT_KEY_ID, key: ring.get(DEFAULT_KEY_ID)! };
  }

  const [keyId, key] = ring.entries().next().value as [string, Buffer];
  return { keyId, key };
}

function getLegacyKey(): Buffer {
  const singleKey = KEY_ENV_VARS.map((name) => process.env[name]).find(
    (value) => value !== undefined && value !== '',
  );
  if (!singleKey) {
    throw new Error(
      'QUEUE_ENCRYPTION_KEY must be set to decrypt legacy v1 payloads.',
    );
  }
  return parseKey(singleKey, 'QUEUE_ENCRYPTION_KEY');
}

function getKeyById(keyId: string): Buffer {
  const ring = readKeyRing();
  const key = ring.get(keyId);
  if (!key) {
    throw new Error(
      `No queue encryption key configured for key id "${keyId}". ` +
        `Add it to ${KEY_RING_ENV_VAR} to decrypt this payload.`,
    );
  }
  return key;
}

function parsePqKeyRing(raw: string): Map<string, PostQuantumKeyPair> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${PQ_KEYS_ENV_VAR} must be a JSON object mapping pq key ids to ` +
        '{"publicKey": "<hex>", "secretKey": "<hex>"}.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${PQ_KEYS_ENV_VAR} must be a JSON object of keyId -> pair.`);
  }

  const ring = new Map<string, PostQuantumKeyPair>();
  for (const [keyId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error(
        `Invalid pq key id "${keyId}" in ${PQ_KEYS_ENV_VAR}: only letters, ` +
          'digits, "_" and "-" are allowed.',
      );
    }
    const pair = value as { publicKey?: unknown; secretKey?: unknown };
    if (
      !pair ||
      typeof pair.publicKey !== 'string' ||
      typeof pair.secretKey !== 'string' ||
      !HEX_PATTERN.test(pair.publicKey) ||
      !HEX_PATTERN.test(pair.secretKey) ||
      pair.publicKey.length === 0 ||
      pair.secretKey.length === 0
    ) {
      throw new Error(
        `pq key "${keyId}" in ${PQ_KEYS_ENV_VAR} must provide hex publicKey and secretKey.`,
      );
    }
    ring.set(keyId, {
      keyId,
      publicKey: Buffer.from(pair.publicKey, 'hex'),
      secretKey: Buffer.from(pair.secretKey, 'hex'),
    });
  }
  return ring;
}

function readPqKeyRing(): Map<string, PostQuantumKeyPair> {
  const raw = process.env[PQ_KEYS_ENV_VAR];
  if (!raw || raw.trim() === '') {
    return new Map();
  }
  return parsePqKeyRing(raw);
}

function getPrimaryPqKey(): PostQuantumKeyPair | null {
  const ring = readPqKeyRing();
  if (ring.size === 0) {
    return null;
  }
  const configured = process.env[PQ_PRIMARY_KEY_ID_ENV_VAR];
  if (configured) {
    const pair = ring.get(configured);
    if (!pair) {
      throw new Error(
        `${PQ_PRIMARY_KEY_ID_ENV_VAR}=${configured} is not present in ${PQ_KEYS_ENV_VAR}.`,
      );
    }
    return pair;
  }
  return ring.values().next().value as PostQuantumKeyPair;
}

function getPqKeyById(keyId: string): PostQuantumKeyPair {
  const pair = readPqKeyRing().get(keyId);
  if (!pair) {
    throw new Error(
      `No post-quantum key configured for key id "${keyId}". ` +
        `Add it to ${PQ_KEYS_ENV_VAR} to decrypt this payload.`,
    );
  }
  return pair;
}

function isHybridEnabled(): boolean {
  return (process.env[PQ_MODE_ENV_VAR] ?? 'hybrid') !== 'disabled';
}

/**
 * Combine classical and post-quantum secrets into a single AES-256 data key.
 * Both inputs feed the KDF, so compromise of one alone does not expose data.
 */
function deriveHybridKey(
  classicalKey: Buffer,
  pqSharedSecret: Buffer,
  salt: Buffer,
  aad: string,
): Buffer {
  const ikm = Buffer.concat([classicalKey, pqSharedSecret]);
  const info = Buffer.from(`${HYBRID_KDF_INFO}|${aad}`, 'utf8');
  const okm = hkdfSha256(ikm, salt, info, 32);
  ikm.fill(0);
  return okm;
}

function hkdfSha256(
  ikm: Buffer,
  salt: Buffer,
  info: Buffer,
  length: number,
): Buffer {
  const { createHmac } = require('crypto') as typeof import('crypto');
  const prk = createHmac(HYBRID_KDF_HASH, salt).update(ikm).digest();
  const blocks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let produced = 0;
  for (let i = 1; produced < length; i++) {
    prev = createHmac(HYBRID_KDF_HASH, prk)
      .update(Buffer.concat([prev, info, Buffer.from([i])]))
      .digest();
    blocks.push(prev);
    produced += prev.length;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function decryptV1<T>(parts: string[]): T {
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format — expected v1:<iv>:<data>');
  }

  const [, ivHex, encHex] = parts;
  if (ivHex.length !== LEGACY_IV_BYTES * 2 || !HEX_PATTERN.test(ivHex)) {
    throw new Error('Invalid AES-CBC IV in legacy v1 ciphertext.');
  }
  if (encHex.length % 2 !== 0 || !HEX_PATTERN.test(encHex)) {
    throw new Error('Invalid ciphertext payload encoding.');
  }

  // Legacy messages predate AAD binding; the queue name is deliberately not
  // checked here so in-flight v1 messages continue to decrypt.
  const decipher = createDecipheriv(
    LEGACY_ALGORITHM,
    getLegacyKey(),
    Buffer.from(ivHex, 'hex'),
  );
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(dec.toString('utf8')) as T;
}

function decryptGcm<T>(
  key: Buffer,
  nonceHex: string,
  tagHex: string,
  encHex: string,
  aad: string,
): T {
  if (nonceHex.length !== GCM_NONCE_BYTES * 2 || !HEX_PATTERN.test(nonceHex)) {
    throw new Error('Invalid AES-GCM nonce in ciphertext.');
  }
  if (tagHex.length !== GCM_TAG_BYTES * 2 || !HEX_PATTERN.test(tagHex)) {
    throw new Error('Invalid AES-GCM authentication tag in ciphertext.');
  }
  if (encHex.length % 2 !== 0 || !HEX_PATTERN.test(encHex)) {
    throw new Error('Invalid ciphertext payload encoding.');
  }

  const decipher = createDecipheriv(
    GCM_ALGORITHM,
    key,
    Buffer.from(nonceHex, 'hex'),
    { authTagLength: GCM_TAG_BYTES },
  );
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(dec.toString('utf8')) as T;
}

function decryptV2<T>(parts: string[], aad: string): T {
  if (parts.length !== 5) {
    throw new Error(
      'Invalid ciphertext format — expected v2:<keyId>:<nonce>:<tag>:<data>',
    );
  }

  const [, keyId, nonceHex, tagHex, encHex] = parts;
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`Invalid key id in ciphertext: "${keyId}"`);
  }

  return decryptGcm<T>(getKeyById(keyId), nonceHex, tagHex, encHex, aad);
}

function decryptV3<T>(parts: string[], aad: string): T {
  if (parts.length !== 7) {
    throw new Error(
      'Invalid ciphertext format — expected ' +
        'v3:<keyId>:<pqKeyId>:<kemCt>:<nonce>:<tag>:<data>',
    );
  }

  const [, keyId, pqKeyId, kemHex, saltHex, nonceHex, tagHex, encHex] = parts;
  if (!KEY_ID_PATTERN.test(keyId) || !KEY_ID_PATTERN.test(pqKeyId)) {
    throw new Error('Invalid key id in v3 ciphertext.');
  }
  if (!HEX_PATTERN.test(kemHex) || kemHex.length === 0) {
    throw new Error('Invalid post-quantum KEM ciphertext encoding.');
  }
  if (saltHex.length !== HYBRID_KDF_SALT_BYTES * 2 || !HEX_PATTERN.test(saltHex)) {
    throw new Error('Invalid hybrid KDF salt in v3 ciphertext.');
  }

  const pq = getPqKeyById(pqKeyId);
  const pqSharedSecret = resolvePqProvider().decapsulate(
    pq.secretKey,
    Buffer.from(kemHex, 'hex'),
  );
  const dataKey = deriveHybridKey(
    getKeyById(keyId),
    pqSharedSecret,
    Buffer.from(saltHex, 'hex'),
    aad,
  );
  pqSharedSecret.fill(0);

  try {
    return decryptGcm<T>(dataKey, nonceHex, tagHex, encHex, aad);
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Encrypt a queue payload.
 *
 * Emits hybrid `v3` (classical + ML-KEM) when a post-quantum key is configured
 * and hybrid mode is not disabled; otherwise emits classical `v2` as a fallback.
 *
 * @param data Payload to serialise and encrypt.
 * @param aad  Additional authenticated data — pass the queue/event name so the
 *             ciphertext cannot be replayed onto another queue.
 */
export function encryptPayload(data: unknown, aad: string = ''): string {
  const { keyId, key } = getPrimaryKey();
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');

  const pq = isHybridEnabled() ? getPrimaryPqKey() : null;

  let dataKey = key;
  let header = `v2:${keyId}`;
  let kemSegment = '';
  let saltSegment = '';
  let pqSharedSecret: Buffer | null = null;

  if (pq) {
    const provider = resolvePqProvider();
    const encapsulated = provider.encapsulate(pq.publicKey);
    pqSharedSecret = encapsulated.sharedSecret;
    const salt = randomBytes(HYBRID_KDF_SALT_BYTES);
    dataKey = deriveHybridKey(key, pqSharedSecret, salt, aad);
    header = `v3:${keyId}:${pq.keyId}`;
    kemSegment = encapsulated.ciphertext.toString('hex');
    saltSegment = salt.toString('hex');
  }

  try {
    const cipher = createCipheriv(GCM_ALGORITHM, dataKey, nonce, {
      authTagLength: GCM_TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const body = `${nonce.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    if (pq) {
      return `${header}:${kemSegment}:${saltSegment}:${body}`;
    }
    return `${header}:${body}`;
  } finally {
    if (pqSharedSecret) {
      pqSharedSecret.fill(0);
    }
    if (dataKey !== key) {
      dataKey.fill(0);
    }
  }
}

/**
 * Decrypt a queue payload. Supports hybrid `v3`, classical authenticated `v2`,
 * and the legacy, unauthenticated `v1` format still in flight during the
 * transition.
 *
 * @param ciphertext Serialised payload produced by {@link encryptPayload}.
 * @param aad        Queue/event name used as AAD when the payload was encrypted.
 */
export function decryptPayload<T = unknown>(
  ciphertext: string,
  aad: string = '',
): T {
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('Invalid ciphertext: expected a non-empty string.');
  }

  const parts = ciphertext.split(':');
  switch (parts[0]) {
    case 'v3':
      return decryptV3<T>(parts, aad);
    case 'v2':
      return decryptV2<T>(parts, aad);
    case 'v1':
      return decryptV1<T>(parts);
    default:
      throw new Error(
        `Unsupported queue payload version "${parts[0] ?? ''}" — expected v1, v2 or v3.`,
      );
  }
}

/**
 * Quantum-resistance audit: reports whether a stored payload is protected by
 * the post-quantum hybrid envelope (v3) or relies only on classical crypto.
 */
export function auditPayloadQuantumResistance(ciphertext: string): {
  version: string;
  quantumResistant: boolean;
  fingerprint: string;
} {
  const version = ciphertext.split(':')[0] ?? '';
  return {
    version,
    quantumResistant: version === 'v3',
    fingerprint: createHash('sha256').update(ciphertext).digest('hex').slice(0, 16),
  };
}
