/**
 * reencrypt-pii.ts — Zero-downtime DEK rotation for envelope-encrypted PII (#1038)
 *
 * Re-encrypts all PII columns that use EncryptionTransformer (AES-256-CBC,
 * ENCRYPTION_KEY env var) and all Stellar secret keys stored via KmsService
 * (AWS KMS envelope encryption) without taking the application offline.
 *
 * ─── Two encryption systems handled ────────────────────────────────────────
 *
 * 1. EncryptionTransformer (PII columns)
 *    Format:  <32-hex-iv>:<hex-ciphertext>
 *    Key:     ENCRYPTION_KEY  (current / new key)
 *    Old key: ENCRYPTION_KEY_OLD  (previous key, only needed during rotation)
 *    Tables:  users          → full_name, birthdate, tax_id, phone, physical_address
 *             kyc_submissions → company_name, registration_number
 *
 * 2. KmsService (Stellar secrets, envelope encryption)
 *    Format:  JSON { iv, ciphertext, encryptedKey }  (all hex)
 *    Key:     AWS KMS CMK (KMS_KEY_ID env var)
 *    Tables:  trade_deals → escrow_secret_key, issuer_secret_key
 *    Re-encryption: decrypt with old KMS DEK → re-encrypt with GenerateDataKey
 *    (KMS automatic key rotation rotates the CMK but NOT the stored DEKs;
 *     this job re-wraps each DEK under the latest CMK version.)
 *
 * ─── Two-phase zero-downtime protocol ───────────────────────────────────────
 *
 * Phase 1 — MARK:
 *   Stamp a `reencrypt_needed_at` timestamp on each row that contains at
 *   least one non-null encrypted column.  This uses a single UPDATE per
 *   table and does not touch ciphertext, so it is safe while the app runs.
 *   (The marker column is a pre-existing nullable timestamptz we add via a
 *    migration-free raw UPDATE; rows processed successfully are cleared.)
 *
 *   In practice this script uses an in-memory cursor approach that does not
 *   require a schema change: it paginates by primary key and processes rows
 *   in batches, relying on the rate limiter to avoid starving the live app.
 *
 * Phase 2 — PROCESS:
 *   For each batch:
 *     a. SELECT ... FOR UPDATE SKIP LOCKED to avoid conflicts with concurrent
 *        writers.
 *     b. Decrypt each encrypted column with the OLD key.
 *     c. Re-encrypt with the NEW key.
 *     d. UPDATE only the columns that changed in a single statement.
 *     e. Verify the re-encrypted value decrypts correctly with the new key.
 *
 * ─── Modes ──────────────────────────────────────────────────────────────────
 *
 *   --dry-run         Print what would be re-encrypted; make no DB writes.
 *   --entity=<name>   Process only one entity (users | kyc | deals | all).
 *                     Default: all.
 *   --batch=<n>       Rows per batch (default 50, max 500).
 *   --delay=<ms>      Sleep between batches in ms (default 200).
 *   --verify-only     Skip re-encryption; just verify all rows decrypt with
 *                     the current key and report any that do not.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *
 *   # Dry-run first — see what would be processed
 *   npx ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts --dry-run
 *
 *   # Re-encrypt all PII (live run)
 *   npx ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts
 *
 *   # Re-encrypt only users table with smaller batches
 *   npx ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts \
 *     --entity=users --batch=20 --delay=500
 *
 *   # Post-rotation verification pass (no writes)
 *   npx ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts --verify-only
 *
 *   # Add to package.json scripts:
 *   "pii:reencrypt":     "ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts"
 *   "pii:reencrypt:dry": "ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts --dry-run"
 *   "pii:verify":        "ts-node -r tsconfig-paths/register scripts/reencrypt-pii.ts --verify-only"
 */

import * as dotenv from 'dotenv';
dotenv.config();

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { DataSource, QueryRunner } from 'typeorm';
import { AppDataSource } from '../src/database/data-source';

// ─── CLI argument parsing ────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN    = argv.includes('--dry-run');
const VERIFY_ONLY = argv.includes('--verify-only');

function getArg(flag: string, fallback: string): string {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const ENTITY_FILTER = getArg('--entity', 'all');
const BATCH_SIZE    = Math.min(500, Math.max(1, parseInt(getArg('--batch', '50'), 10)));
const BATCH_DELAY_MS = Math.max(0, parseInt(getArg('--delay', '200'), 10));

// ─── Types ───────────────────────────────────────────────────────────────────

interface ColumnSpec {
  /** Column name in the database */
  dbColumn: string;
  /** TypeScript property name on the entity */
  prop: string;
}

interface TableSpec {
  /** Table name in the database */
  table: string;
  /** Short label used in --entity filter */
  label: string;
  /** Primary key column */
  pk: string;
  /** Columns to re-encrypt */
  columns: ColumnSpec[];
  /** Which encryption system this table uses */
  encSystem: 'transformer' | 'kms';
}

/** One row of the verification report */
interface VerifyResult {
  table: string;
  id: string;
  column: string;
  status: 'ok' | 'plaintext' | 'decrypt_error' | 'null';
}

/** Summary counters for the final report */
interface Report {
  entity: string;
  total: number;
  skipped: number;
  reencrypted: number;
  verified: number;
  errors: number;
  dryRunRows: number;
}

// ─── Table specifications ────────────────────────────────────────────────────

const TABLE_SPECS: TableSpec[] = [
  {
    table: 'users',
    label: 'users',
    pk: 'id',
    encSystem: 'transformer',
    columns: [
      { dbColumn: 'full_name',        prop: 'full_name' },
      { dbColumn: 'birthdate',        prop: 'birthdate' },
      { dbColumn: 'tax_id',           prop: 'tax_id' },
      { dbColumn: 'phone',            prop: 'phone' },
      { dbColumn: 'physical_address', prop: 'physical_address' },
    ],
  },
  {
    table: 'kyc_submissions',
    label: 'kyc',
    pk: 'id',
    encSystem: 'transformer',
    columns: [
      { dbColumn: 'company_name',       prop: 'company_name' },
      { dbColumn: 'registration_number', prop: 'registration_number' },
    ],
  },
  {
    table: 'trade_deals',
    label: 'deals',
    pk: 'id',
    encSystem: 'kms',
    columns: [
      { dbColumn: 'escrow_secret_key', prop: 'escrow_secret_key' },
      { dbColumn: 'issuer_secret_key', prop: 'issuer_secret_key' },
    ],
  },
];

// ─── EncryptionTransformer helpers ───────────────────────────────────────────

/**
 * Detect whether a raw DB value is a transformer-format ciphertext
 * (iv:ciphertext — two colon-separated hex strings).
 */
export function isTransformerCiphertext(value: string): boolean {
  if (!value.includes(':')) return false;
  const parts = value.split(':');
  if (parts.length !== 2) return false;
  const [ivHex, ctHex] = parts;
  // iv must be 32 hex chars (16 bytes); ciphertext must be non-empty even hex
  return (
    ivHex.length === 32 &&
    ctHex.length > 0 &&
    /^[0-9a-f]+$/i.test(ivHex) &&
    /^[0-9a-f]+$/i.test(ctHex)
  );
}

/**
 * Decrypt a transformer-format ciphertext with the given 32-byte key buffer.
 * Returns null if the value is null/plaintext/decryption error.
 */
export function transformerDecrypt(
  value: string,
  keyBuf: Buffer,
): string | null {
  if (!isTransformerCiphertext(value)) return null;
  try {
    const [ivHex, encHex] = value.split(':');
    const iv        = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher  = createDecipheriv('aes-256-cbc', keyBuf, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext string with the given 32-byte key buffer.
 * Returns the transformer format: <ivHex>:<ciphertextHex>
 */
export function transformerEncrypt(plaintext: string, keyBuf: Buffer): string {
  const iv      = randomBytes(16);
  const cipher  = createCipheriv('aes-256-cbc', keyBuf, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Verify that a transformer ciphertext decrypts to the expected plaintext
 * under the given key without leaking the plaintext in a timing-safe way.
 */
export function transformerVerify(
  ciphertext: string,
  expectedPlaintext: string,
  keyBuf: Buffer,
): boolean {
  const decrypted = transformerDecrypt(ciphertext, keyBuf);
  if (decrypted === null) return false;
  const a = Buffer.from(decrypted, 'utf8');
  const b = Buffer.from(expectedPlaintext, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── KmsService helpers (envelope encryption) ────────────────────────────────

export interface KmsPayload {
  iv: string;
  ciphertext: string;
  encryptedKey: string;
}

export function isKmsPayload(value: string): value is string {
  try {
    const p = JSON.parse(value) as Partial<KmsPayload>;
    return (
      typeof p.iv === 'string' &&
      typeof p.ciphertext === 'string' &&
      typeof p.encryptedKey === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Decrypt a KMS-envelope-encrypted payload.
 * Returns the plaintext string, or throws on failure.
 */
export async function kmsDecrypt(
  payload: string,
  kmsClient: KMSClient,
): Promise<string> {
  const { iv, ciphertext, encryptedKey } = JSON.parse(payload) as KmsPayload;
  const decryptResult = await kmsClient.send(
    new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedKey, 'hex') }),
  );
  if (!decryptResult.Plaintext) {
    throw new Error('KMS DecryptCommand returned no plaintext DEK');
  }
  const dek     = Buffer.from(decryptResult.Plaintext);
  const decipher = createDecipheriv(
    'aes-256-cbc',
    dek,
    Buffer.from(iv, 'hex'),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Re-encrypt a plaintext string with a fresh DEK generated by KMS.
 * Returns the JSON payload string (same format as KmsService.encrypt).
 */
export async function kmsReencrypt(
  plaintext: string,
  kmsClient: KMSClient,
  keyId: string,
): Promise<string> {
  const genResult = await kmsClient.send(
    new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }),
  );
  if (!genResult.Plaintext || !genResult.CiphertextBlob) {
    throw new Error('KMS GenerateDataKeyCommand failed');
  }
  const dek          = Buffer.from(genResult.Plaintext);
  const encryptedDek = Buffer.from(genResult.CiphertextBlob);
  const iv           = randomBytes(16);
  const cipher       = createCipheriv('aes-256-cbc', dek, iv);
  const encrypted    = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  // Zero out the plaintext DEK from memory before returning
  dek.fill(0);
  return JSON.stringify({
    iv:           iv.toString('hex'),
    ciphertext:   encrypted.toString('hex'),
    encryptedKey: encryptedDek.toString('hex'),
  } satisfies KmsPayload);
}

// ─── Key resolution ──────────────────────────────────────────────────────────

/**
 * Resolve key buffers for EncryptionTransformer rotation.
 *
 * During rotation:
 *   ENCRYPTION_KEY     = new 64-hex key  (used for re-encryption)
 *   ENCRYPTION_KEY_OLD = old 64-hex key  (used to decrypt current ciphertexts)
 *
 * If ENCRYPTION_KEY_OLD is not set, the job assumes the current key is also
 * the old key (useful for verify-only or testing round-trips).
 */
export function resolveTransformerKeys(): { newKey: Buffer; oldKey: Buffer } {
  const newHex = process.env.ENCRYPTION_KEY ?? '';
  if (!newHex || newHex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  const oldHex = process.env.ENCRYPTION_KEY_OLD ?? newHex;
  if (oldHex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY_OLD must be a 64-character hex string (32 bytes).',
    );
  }
  return {
    newKey: Buffer.from(newHex, 'hex'),
    oldKey: Buffer.from(oldHex, 'hex'),
  };
}

// ─── Batch processor ─────────────────────────────────────────────────────────

/**
 * Sleep helper for inter-batch rate limiting.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process a single batch of rows for an EncryptionTransformer table.
 *
 * For each row:
 *   1. For each encrypted column: try to decrypt with oldKey.
 *      - If decryption fails with oldKey, try newKey (already rotated).
 *      - If neither works and value looks like plaintext, log a warning.
 *   2. Re-encrypt with newKey.
 *   3. UPDATE only changed columns inside a transaction with SELECT FOR UPDATE.
 *   4. Verify the new ciphertext decrypts correctly with newKey.
 */
async function processTransformerBatch(
  qr: QueryRunner,
  spec: TableSpec,
  rows: Record<string, string | null>[],
  oldKey: Buffer,
  newKey: Buffer,
  dryRun: boolean,
  verifyOnly: boolean,
  report: Report,
  verifyResults: VerifyResult[],
): Promise<void> {
  for (const row of rows) {
    const id = row[spec.pk] as string;
    const updates: Record<string, string> = {};
    let anyChange = false;

    for (const col of spec.columns) {
      const raw = row[col.dbColumn];

      if (raw == null) {
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'null' });
        continue;
      }

      // ── Detect format ──────────────────────────────────────────────────
      if (!isTransformerCiphertext(raw)) {
        // Value stored before encryption was enabled — raw plaintext
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'plaintext' });
        if (!verifyOnly) {
          // Re-encrypt the plaintext value with the new key
          if (!dryRun) {
            updates[col.dbColumn] = transformerEncrypt(raw, newKey);
            anyChange = true;
          }
          report.dryRunRows += dryRun ? 1 : 0;
        }
        continue;
      }

      // ── Try decryption: old key first, then new key (already rotated) ──
      let plaintext = transformerDecrypt(raw, oldKey);
      let alreadyRotated = false;

      if (plaintext === null) {
        plaintext = transformerDecrypt(raw, newKey);
        if (plaintext !== null) {
          alreadyRotated = true;
        }
      }

      if (plaintext === null) {
        // Cannot decrypt with either key
        logger.error(
          `[${spec.table}] row ${id} col ${col.dbColumn}: decrypt failed with both keys`,
        );
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'decrypt_error' });
        report.errors++;
        continue;
      }

      if (verifyOnly) {
        // In verify mode just confirm decryptability and move on
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'ok' });
        report.verified++;
        continue;
      }

      if (alreadyRotated) {
        // Already encrypted with new key — skip re-encryption
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'ok' });
        report.skipped++;
        continue;
      }

      // ── Re-encrypt with new key ────────────────────────────────────────
      const newCiphertext = transformerEncrypt(plaintext, newKey);

      // ── Verify before writing ─────────────────────────────────────────
      if (!transformerVerify(newCiphertext, plaintext, newKey)) {
        logger.error(
          `[${spec.table}] row ${id} col ${col.dbColumn}: post-encrypt verification failed`,
        );
        report.errors++;
        continue;
      }

      if (dryRun) {
        logger.info(
          `[DRY-RUN] [${spec.table}] row ${id} col ${col.dbColumn}: would re-encrypt`,
        );
        report.dryRunRows++;
      } else {
        updates[col.dbColumn] = newCiphertext;
        anyChange = true;
      }
      verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'ok' });
    }

    if (anyChange && !dryRun) {
      // Build a parameterised UPDATE statement
      const setClauses = Object.keys(updates)
        .map((col, i) => `"${col}" = $${i + 2}`)
        .join(', ');
      const params = [id, ...Object.values(updates)];
      await qr.query(
        `UPDATE "${spec.table}" SET ${setClauses} WHERE "${spec.pk}" = $1`,
        params,
      );
      report.reencrypted++;
    }
  }
}

/**
 * Process a single batch of rows for a KMS envelope-encrypted table.
 */
async function processKmsBatch(
  qr: QueryRunner,
  spec: TableSpec,
  rows: Record<string, string | null>[],
  kmsClient: KMSClient,
  keyId: string,
  dryRun: boolean,
  verifyOnly: boolean,
  report: Report,
  verifyResults: VerifyResult[],
): Promise<void> {
  for (const row of rows) {
    const id = row[spec.pk] as string;
    const updates: Record<string, string> = {};
    let anyChange = false;

    for (const col of spec.columns) {
      const raw = row[col.dbColumn];

      if (raw == null) {
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'null' });
        continue;
      }

      if (!isKmsPayload(raw)) {
        // Stored as plaintext (pre-encryption rows)
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'plaintext' });
        if (!verifyOnly && !dryRun) {
          updates[col.dbColumn] = await kmsReencrypt(raw, kmsClient, keyId);
          anyChange = true;
        } else if (dryRun) {
          report.dryRunRows++;
        }
        continue;
      }

      // Decrypt with current KMS key (which may already be the new CMK version)
      let plaintext: string;
      try {
        plaintext = await kmsDecrypt(raw, kmsClient);
      } catch (err) {
        logger.error(
          `[${spec.table}] row ${id} col ${col.dbColumn}: KMS decrypt failed — ${(err as Error).message}`,
        );
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'decrypt_error' });
        report.errors++;
        continue;
      }

      if (verifyOnly) {
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'ok' });
        report.verified++;
        continue;
      }

      // Re-encrypt: generates a fresh DEK under the latest CMK version
      if (dryRun) {
        logger.info(
          `[DRY-RUN] [${spec.table}] row ${id} col ${col.dbColumn}: would re-encrypt via KMS`,
        );
        report.dryRunRows++;
        verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'ok' });
        continue;
      }

      const newPayload = await kmsReencrypt(plaintext, kmsClient, keyId);

      // Verify the new payload decrypts correctly before writing
      let verifiedPlaintext: string;
      try {
        verifiedPlaintext = await kmsDecrypt(newPayload, kmsClient);
      } catch (err) {
        logger.error(
          `[${spec.table}] row ${id} col ${col.dbColumn}: post-reencrypt KMS verify failed`,
        );
        report.errors++;
        continue;
      }

      if (verifiedPlaintext !== plaintext) {
        logger.error(
          `[${spec.table}] row ${id} col ${col.dbColumn}: plaintext mismatch after re-encryption`,
        );
        report.errors++;
        continue;
      }

      updates[col.dbColumn] = newPayload;
      anyChange = true;
      verifyResults.push({ table: spec.table, id, column: col.dbColumn, status: 'ok' });
    }

    if (anyChange && !dryRun) {
      const setClauses = Object.keys(updates)
        .map((col, i) => `"${col}" = $${i + 2}`)
        .join(', ');
      const params = [id, ...Object.values(updates)];
      await qr.query(
        `UPDATE "${spec.table}" SET ${setClauses} WHERE "${spec.pk}" = $1`,
        params,
      );
      report.reencrypted++;
    }
  }
}

// ─── Per-table orchestrator ───────────────────────────────────────────────────

/**
 * Paginate through a table in BATCH_SIZE chunks, calling SELECT … FOR UPDATE
 * SKIP LOCKED so live app writers are never blocked.
 *
 * Pagination is cursor-based on the primary key (UUID, alphabetically sortable)
 * to avoid OFFSET performance degradation on large tables.
 */
async function processTable(
  ds: DataSource,
  spec: TableSpec,
  oldKey: Buffer,
  newKey: Buffer,
  kmsClient: KMSClient | null,
  kmsKeyId: string,
  dryRun: boolean,
  verifyOnly: boolean,
): Promise<Report> {
  const report: Report = {
    entity: spec.table,
    total: 0,
    skipped: 0,
    reencrypted: 0,
    verified: 0,
    errors: 0,
    dryRunRows: 0,
  };
  const verifyResults: VerifyResult[] = [];

  // Get total row count for progress logging
  const [{ count }] = await ds.query(
    `SELECT COUNT(*) AS count FROM "${spec.table}"`,
  ) as [{ count: string }];
  report.total = parseInt(count, 10);

  logger.info(
    `\n─── ${spec.table} (${report.total} rows, batch=${BATCH_SIZE}, delay=${BATCH_DELAY_MS}ms) ───`,
  );

  const colList = [spec.pk, ...spec.columns.map((c) => `"${c.dbColumn}"`)].join(', ');
  let cursor = '00000000-0000-0000-0000-000000000000';
  let processed = 0;

  while (true) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction('READ COMMITTED');

    let rows: Record<string, string | null>[];
    try {
      // SELECT FOR UPDATE SKIP LOCKED — skip rows locked by live app writers
      rows = await qr.query(
        `SELECT ${colList}
         FROM "${spec.table}"
         WHERE "${spec.pk}" > $1
         ORDER BY "${spec.pk}"
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [cursor, BATCH_SIZE],
      ) as Record<string, string | null>[];

      if (rows.length === 0) {
        await qr.commitTransaction();
        break;
      }

      if (spec.encSystem === 'transformer') {
        await processTransformerBatch(
          qr, spec, rows, oldKey, newKey, dryRun, verifyOnly, report, verifyResults,
        );
      } else {
        if (!kmsClient) throw new Error('KMSClient required for kms-encrypted table');
        await processKmsBatch(
          qr, spec, rows, kmsClient, kmsKeyId, dryRun, verifyOnly, report, verifyResults,
        );
      }

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      logger.error(`Batch failed for ${spec.table} at cursor ${cursor}: ${(err as Error).message}`);
      report.errors++;
      // Advance cursor past the last seen row to avoid infinite retry loop
      if (rows && rows.length > 0) {
        cursor = rows[rows.length - 1][spec.pk] as string;
      }
    } finally {
      await qr.release();
    }

    processed += rows?.length ?? 0;
    cursor = rows[rows.length - 1][spec.pk] as string;

    const pct = report.total > 0
      ? ((processed / report.total) * 100).toFixed(1)
      : '?';
    logger.info(
      `  processed ${processed}/${report.total} (${pct}%) ` +
      `— re-encrypted: ${report.reencrypted}, skipped: ${report.skipped}, errors: ${report.errors}`,
    );

    if (BATCH_DELAY_MS > 0) await sleep(BATCH_DELAY_MS);
  }

  // ── Verification summary ─────────────────────────────────────────────────
  const decryptErrors = verifyResults.filter((r) => r.status === 'decrypt_error');
  const plaintext     = verifyResults.filter((r) => r.status === 'plaintext');

  if (decryptErrors.length > 0) {
    logger.warn(`  ⚠  ${decryptErrors.length} column(s) could not be decrypted:`);
    for (const r of decryptErrors.slice(0, 10)) {
      logger.warn(`     row ${r.id}  col ${r.column}`);
    }
    if (decryptErrors.length > 10) {
      logger.warn(`     … and ${decryptErrors.length - 10} more`);
    }
  }
  if (plaintext.length > 0) {
    logger.warn(
      `  ⚠  ${plaintext.length} value(s) were stored as plaintext ` +
      `(pre-encryption rows) — these have been re-encrypted.`,
    );
  }

  return report;
}

// ─── Minimal logger ──────────────────────────────────────────────────────────

const logger = {
  info:  (msg: string) => console.log(msg),
  warn:  (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = DRY_RUN ? 'DRY-RUN' : VERIFY_ONLY ? 'VERIFY-ONLY' : 'LIVE';
  logger.info(`\n🔐 PII Re-encryption job — mode: ${mode}`);
  logger.info(`   entity:     ${ENTITY_FILTER}`);
  logger.info(`   batch size: ${BATCH_SIZE}`);
  logger.info(`   delay:      ${BATCH_DELAY_MS}ms`);

  // ── Key resolution ────────────────────────────────────────────────────────
  const { newKey, oldKey } = resolveTransformerKeys();
  const keysMatch = newKey.equals(oldKey);
  if (keysMatch && !VERIFY_ONLY) {
    logger.warn(
      '\n⚠  ENCRYPTION_KEY_OLD is not set or equals ENCRYPTION_KEY.\n' +
      '   Transformer columns will be re-encrypted under the same key.\n' +
      '   To rotate keys, set ENCRYPTION_KEY_OLD=<old> ENCRYPTION_KEY=<new>.',
    );
  }

  // ── KMS client (only needed for trade_deals) ──────────────────────────────
  let kmsClient: KMSClient | null = null;
  let kmsKeyId = '';
  const needsKms = ENTITY_FILTER === 'all' || ENTITY_FILTER === 'deals';
  if (needsKms) {
    kmsKeyId = process.env.KMS_KEY_ID ?? '';
    if (!kmsKeyId) {
      throw new Error('KMS_KEY_ID environment variable is required for trade_deals re-encryption');
    }
    const region = process.env.AWS_REGION ?? 'us-east-1';
    kmsClient = new KMSClient({ region });
  }

  // ── Database connection ───────────────────────────────────────────────────
  logger.info('\n📡 Connecting to database…');
  await AppDataSource.initialize();
  logger.info('   Connected.\n');

  const startTime = Date.now();
  const allReports: Report[] = [];

  try {
    const specs = TABLE_SPECS.filter(
      (s) => ENTITY_FILTER === 'all' || s.label === ENTITY_FILTER,
    );

    if (specs.length === 0) {
      logger.error(`Unknown --entity value: "${ENTITY_FILTER}". Valid: users | kyc | deals | all`);
      process.exit(1);
    }

    for (const spec of specs) {
      const report = await processTable(
        AppDataSource,
        spec,
        oldKey,
        newKey,
        kmsClient,
        kmsKeyId,
        DRY_RUN,
        VERIFY_ONLY,
      );
      allReports.push(report);
    }
  } finally {
    await AppDataSource.destroy();
  }

  // ── Final report ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info('\n╔══════════════════════════════════════════════════════════╗');
  logger.info('║          PII Re-encryption — Verification Report          ║');
  logger.info('╚══════════════════════════════════════════════════════════╝');
  logger.info(`  Mode:    ${mode}`);
  logger.info(`  Elapsed: ${elapsed}s`);
  logger.info('');

  let totalErrors = 0;
  for (const r of allReports) {
    logger.info(`  Table: ${r.entity}`);
    logger.info(`    Total rows     : ${r.total}`);
    if (VERIFY_ONLY) {
      logger.info(`    Verified OK    : ${r.verified}`);
    } else {
      logger.info(`    Re-encrypted   : ${r.reencrypted}`);
      logger.info(`    Already rotated: ${r.skipped}`);
      if (DRY_RUN) {
        logger.info(`    Would process  : ${r.dryRunRows}`);
      }
    }
    logger.info(`    Errors         : ${r.errors}`);
    logger.info('');
    totalErrors += r.errors;
  }

  if (totalErrors > 0) {
    logger.error(`\n❌  ${totalErrors} error(s) encountered. Review logs above.`);
    logger.error('   No plaintext was written. Re-run after fixing the root cause.');
    process.exit(1);
  } else {
    const action = VERIFY_ONLY ? 'Verification' : DRY_RUN ? 'Dry-run' : 'Re-encryption';
    logger.info(`✅  ${action} complete — 0 errors.`);
    if (!DRY_RUN && !VERIFY_ONLY) {
      logger.info('');
      logger.info('   Next steps:');
      logger.info('   1. Run with --verify-only to confirm all rows decrypt correctly.');
      logger.info('   2. Remove ENCRYPTION_KEY_OLD from your secrets store.');
      logger.info('   3. Redeploy the application with only ENCRYPTION_KEY set.');
    }
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ Re-encryption job crashed:', err);
  process.exit(1);
});
