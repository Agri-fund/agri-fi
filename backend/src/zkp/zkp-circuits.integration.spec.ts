/**
 * Integration test for the real circom/snarkjs artifacts in `circuits/` (#1300).
 *
 * Unlike zkp.service.spec.ts (which exercises the HMAC-based service), this
 * generates and verifies an actual Groth16 proof with the compiled
 * `age_range.wasm` + `age_range_final.zkey` + verification key. Rebuild the
 * artifacts with `npm run zkp:build` (see circuits/README.md).
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require('snarkjs');

/** Resolve ZKP_CIRCUITS_DIR (default ./circuits) the same way the app does: relative to the backend root. */
const CIRCUITS_DIR = path.resolve(
  process.cwd(),
  process.env.ZKP_CIRCUITS_DIR ?? './circuits',
);
const BUILD_DIR = path.join(CIRCUITS_DIR, 'build');
const WASM = path.join(BUILD_DIR, 'age_range.wasm');
const ZKEY = path.join(BUILD_DIR, 'age_range_final.zkey');
const VKEY = path.join(BUILD_DIR, 'age_range_verification_key.json');

const PROOF_BUDGET_MS = 30_000;

describe('ZKP circuits — age_range (real snarkjs proofs, #1300)', () => {
  let vkey: unknown;

  beforeAll(() => {
    vkey = JSON.parse(readFileSync(VKEY, 'utf8'));
  });

  afterAll(async () => {
    // snarkjs/ffjavascript keep worker threads alive; release them so jest exits.
    await (globalThis as any).curve_bn128?.terminate?.();
  });

  it('ships the compiled circuit artifacts', () => {
    for (const file of [WASM, ZKEY, VKEY]) {
      expect(existsSync(file)).toBe(true);
    }
    expect((vkey as { protocol: string }).protocol).toBe('groth16');
    expect((vkey as { curve: string }).curve).toBe('bn128');
  });

  it('generates a proof that verifies, without revealing the birth year', async () => {
    const input = {
      birthYear: 1990,
      currentYear: 2026,
      minAge: 18,
      maxAge: 120,
    };

    const started = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      WASM,
      ZKEY,
    );
    expect(Date.now() - started).toBeLessThan(PROOF_BUDGET_MS);

    // Only the declared public inputs are exposed — never the birth year.
    expect(publicSignals).toEqual(['2026', '18', '120']);
    expect(JSON.stringify({ proof, publicSignals })).not.toContain('1990');

    await expect(
      snarkjs.groth16.verify(vkey, publicSignals, proof),
    ).resolves.toBe(true);
  });

  it('accepts the boundary ages (exactly min and exactly max)', async () => {
    for (const birthYear of [2008, 1906]) {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { birthYear, currentYear: 2026, minAge: 18, maxAge: 120 },
        WASM,
        ZKEY,
      );
      await expect(
        snarkjs.groth16.verify(vkey, publicSignals, proof),
      ).resolves.toBe(true);
    }
  });

  it('refuses to prove a false statement (under minimum age)', async () => {
    await expect(
      snarkjs.groth16.fullProve(
        { birthYear: 2015, currentYear: 2026, minAge: 18, maxAge: 120 },
        WASM,
        ZKEY,
      ),
    ).rejects.toThrow();
  });

  it('refuses to prove a false statement (over maximum age)', async () => {
    await expect(
      snarkjs.groth16.fullProve(
        { birthYear: 1800, currentYear: 2026, minAge: 18, maxAge: 120 },
        WASM,
        ZKEY,
      ),
    ).rejects.toThrow();
  });

  it('rejects a proof whose public inputs were tampered with', async () => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { birthYear: 2000, currentYear: 2026, minAge: 18, maxAge: 120 },
      WASM,
      ZKEY,
    );

    // Verifier is told a stricter policy than the one the proof was made for.
    const tampered = [publicSignals[0], '21', publicSignals[2]];
    await expect(snarkjs.groth16.verify(vkey, tampered, proof)).resolves.toBe(
      false,
    );
  });
});
