#!/usr/bin/env node
/**
 * Build the ZKP circuit artifacts (#1300).
 *
 *   node scripts/build-circuits.mjs                # compile + trusted setup -> circuits/build/
 *   node scripts/build-circuits.mjs --compile-only # compile to a temp dir only (CI check)
 *
 * Uses the pure-JS/WASM `circom2` compiler and `snarkjs`, so no native circom
 * binary is required. See circuits/README.md.
 *
 * SECURITY: the powers-of-tau + zkey contribution performed here is a
 * single-party DEVELOPMENT setup. Production keys must come from a real
 * multi-party ceremony.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'circuits');
const CIRCUITS = ['age_range'];
const PTAU_POWER = 8; // supports up to 2^8 constraints — plenty for age_range
const compileOnly = process.argv.includes('--compile-only');

function binOf(pkg) {
  // Some packages (snarkjs) don't export ./package.json, so read it directly.
  const pkgJsonPath = path.resolve(root, '..', 'node_modules', pkg, 'package.json');
  const { bin } = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const rel = typeof bin === 'string' ? bin : Object.values(bin)[0];
  return path.resolve(path.dirname(pkgJsonPath), rel);
}

const circom = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'circom-runner.cjs');
const snarkjs = binOf('snarkjs');
const run = (script, args, opts = {}) =>
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit', ...opts });
const entropy = () => randomBytes(32).toString('hex');

mkdirSync(path.join(root, 'tmp'), { recursive: true });
const work = compileOnly
  ? mkdtempSync(path.join(root, 'tmp', 'compile-'))
  : path.join(root, 'tmp');
const out = compileOnly ? work : path.join(root, 'build');
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

try {
  for (const name of CIRCUITS) {
    const src = path.join(root, 'src', `${name}.circom`);
    console.log(`\n▶ Compiling ${name}`);
    // circom2 runs in a WASI sandbox that only sees relative paths under cwd,
    // so compile from the circuits dir and write into a dir beneath it
    // (see scripts/circom-runner.cjs for why we don't use the circom2 CLI).
    run(circom, [path.relative(root, src), '--r1cs', '--wasm', '--sym', '-o', path.relative(root, work)], { cwd: root });
    run(snarkjs, ['r1cs', 'info', path.join(work, `${name}.r1cs`)]);

    if (compileOnly) continue;

    const ptau0 = path.join(work, `pot${PTAU_POWER}_0000.ptau`);
    const ptau1 = path.join(work, `pot${PTAU_POWER}_0001.ptau`);
    const ptauFinal = path.join(work, `pot${PTAU_POWER}_final.ptau`);
    const zkey0 = path.join(work, `${name}_0000.zkey`);
    const zkeyFinal = path.join(out, `${name}_final.zkey`);

    console.log(`\n▶ Trusted setup (DEV ONLY) for ${name}`);
    run(snarkjs, ['powersoftau', 'new', 'bn128', String(PTAU_POWER), ptau0]);
    run(snarkjs, ['powersoftau', 'contribute', ptau0, ptau1, `--name=dev`, `-e=${entropy()}`]);
    run(snarkjs, ['powersoftau', 'prepare', 'phase2', ptau1, ptauFinal]);
    run(snarkjs, ['groth16', 'setup', path.join(work, `${name}.r1cs`), ptauFinal, zkey0]);
    run(snarkjs, ['zkey', 'contribute', zkey0, zkeyFinal, `--name=dev`, `-e=${entropy()}`]);
    run(snarkjs, ['zkey', 'verify', path.join(work, `${name}.r1cs`), ptauFinal, zkeyFinal]);
    run(snarkjs, [
      'zkey', 'export', 'verificationkey', zkeyFinal,
      path.join(out, `${name}_verification_key.json`),
    ]);
    cpSync(
      path.join(work, `${name}_js`, `${name}.wasm`),
      path.join(out, `${name}.wasm`),
    );
    console.log(`\n✔ ${name}: artifacts written to ${path.relative(process.cwd(), out)}`);
  }
  if (compileOnly) console.log('\n✔ All circuits compile cleanly.');
} finally {
  if (compileOnly || existsSync(work)) rmSync(work, { recursive: true, force: true });
}
