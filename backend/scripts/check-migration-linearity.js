#!/usr/bin/env node

/**
 * CI script (#951) that guards against the exact failure class that caused
 * the duplicate CreateOutboxTable migrations: two migrations racing to
 * create the same database object, so whichever runs second on a fresh
 * environment fails with "relation already exists" and migration:run can
 * never complete.
 *
 * Two checks, deliberately different strictness:
 *
 * 1. HARD FAIL — two migration files both `CREATE TABLE`/`CREATE INDEX`/
 *    `CREATE TYPE` the same named object. This is the actual, concrete risk
 *    (a guaranteed conflict on migration:run) and is kept at zero from this
 *    point on — exit code 1 blocks CI.
 *
 * 2. REPORT ONLY — two migration files share the exact same leading
 *    timestamp. This repo's migration history has ~16 pre-existing
 *    timestamp collisions accumulated over time (different features'
 *    authors independently picking round numbers), none of which create
 *    conflicting objects — they're cosmetic, not the outbox bug's class of
 *    problem, and renumbering 30+ unrelated migration files is out of
 *    scope for #951 and risky to do blind. New duplicates are reported
 *    (and fail CI, see BASELINE_DUPLICATE_TIMESTAMPS below) so the mess
 *    doesn't grow, without requiring every pre-existing one to be fixed
 *    first.
 *
 * Exit code 0: both checks clean (respecting the baseline for check 2).
 * Exit code 1: a genuine object-creation conflict, or a NEW timestamp
 * duplicate beyond the recorded baseline.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/database/migrations');

// Pre-existing timestamp collisions as of #951, verified to NOT create
// conflicting objects (spot-checked: each file in every group creates a
// differently-named table/column addition). Grandfathered in rather than
// renumbered, since touching 30+ unrelated migration files' timestamps is
// out of scope here and risks silently reordering unrelated migrations.
// Do not add to this list for new migrations — pick a timestamp that
// isn't already used instead.
const BASELINE_DUPLICATE_TIMESTAMPS = new Set([
  // 1810000000000 and 1820000000000: #951 reconciled the CreateOutboxTable
  // pair itself (see 1810000000000-CreateOutboxTable.ts's doc comment —
  // it's now a no-op; 1820000000000-CreateOutboxTable.ts is authoritative)
  // but each of those two timestamps also happens to collide with one
  // other, unrelated pre-existing migration (AddKycAlertColumns.ts and
  // AddDealMetadataAndKycDraft.ts respectively) that creates different
  // objects entirely. Left as-is for the same reason the no-op file wasn't
  // deleted or renamed: changing either outbox migration's timestamp/class
  // name would change its identity in any environment's migrations
  // tracking table that already recorded it.
  '1810000000000',
  '1820000000000',
  '1699900000007',
  '1765000000000',
  '1766000000000',
  '1800000000000',
  '1830000000000',
  '1840000000000',
  '1850000000000',
  '1860000000000',
  '1870000000000',
  '1920000000000',
  '1940000000000',
  '1940000000001',
  '1940000000002',
  '1950000000000',
]);

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .sort();
}

function extractTimestamp(filename) {
  const match = filename.match(/^(\d+)-/);
  return match ? match[1] : null;
}

/**
 * Isolates the `up(...)` method body. Only `up()` represents the forward
 * migration path that runs on a fresh database — `down()` legitimately
 * re-creates old objects when reverting a migration that replaced them
 * (see 1960000000000-MigrateSecondaryOrdersToUnifiedTable.ts, whose
 * down() recreates the tables its own up() dropped), which would
 * otherwise look like a false conflict with the original migration that
 * first created them.
 */
function extractUpMethodBody(source) {
  const upStart = source.search(/public\s+async\s+up\s*\(/);
  if (upStart === -1) return '';
  const downStart = source.slice(upStart).search(/public\s+async\s+down\s*\(/);
  return downStart === -1 ? source.slice(upStart) : source.slice(upStart, upStart + downStart);
}

/**
 * Extracts every `CREATE TABLE "x"` / `CREATE INDEX "x"` / `CREATE TYPE "x"`
 * object name from a migration's up() body. `CREATE ... IF NOT EXISTS` is
 * excluded — it's idempotent by construction and can't conflict even if
 * another migration also creates the same object defensively.
 */
function extractCreatedObjects(source) {
  const objects = [];
  const upBody = extractUpMethodBody(source);
  const pattern = /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TYPE)\s+(IF NOT EXISTS\s+)?"?([\w.]+)"?/gi;
  let match;
  while ((match = pattern.exec(upBody)) !== null) {
    if (match[2]) continue; // "IF NOT EXISTS" — idempotent, not a real conflict
    objects.push({ kind: match[1].toUpperCase(), name: match[3] });
  }
  return objects;
}

function main() {
  const files = listMigrationFiles();
  const errors = [];
  const warnings = [];

  // ── Check 1: no two migrations create the same named object ──────────────
  const creators = new Map(); // "KIND:name" -> [filenames]
  for (const file of files) {
    const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const { kind, name } of extractCreatedObjects(source)) {
      const key = `${kind}:${name.toLowerCase()}`;
      if (!creators.has(key)) creators.set(key, []);
      creators.get(key).push(file);
    }
  }
  for (const [key, creatingFiles] of creators) {
    if (creatingFiles.length > 1) {
      const [kind, name] = key.split(':');
      errors.push(
        `${kind} "${name}" is created by ${creatingFiles.length} migrations, which will conflict on a fresh database: ${creatingFiles.join(', ')}`,
      );
    }
  }

  // ── Check 2: report (and gate on new) duplicate timestamps ────────────────
  const byTimestamp = new Map();
  for (const file of files) {
    const ts = extractTimestamp(file);
    if (!ts) continue;
    if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
    byTimestamp.get(ts).push(file);
  }
  for (const [ts, filesForTs] of byTimestamp) {
    if (filesForTs.length <= 1) continue;
    if (BASELINE_DUPLICATE_TIMESTAMPS.has(ts)) {
      warnings.push(`(baseline, not blocking) timestamp ${ts} is shared by: ${filesForTs.join(', ')}`);
    } else {
      errors.push(
        `New duplicate timestamp ${ts} shared by: ${filesForTs.join(', ')}. Pick a unique timestamp for new migrations.`,
      );
    }
  }

  console.log(`Checked ${files.length} migration files.\n`);

  if (warnings.length > 0) {
    console.log('⚠️  Pre-existing, non-blocking timestamp duplicates (grandfathered):');
    for (const warning of warnings) console.log(`   - ${warning}`);
    console.log('');
  }

  if (errors.length > 0) {
    console.error('❌ Migration linearity check failed:');
    for (const error of errors) console.error(`   - ${error}`);
    process.exit(1);
  }

  console.log('✅ No object-creation conflicts, and no new duplicate timestamps.');
}

main();
