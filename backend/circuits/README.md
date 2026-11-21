# ZKP circuits

Circom circuits and the compiled Groth16 artifacts used for zero-knowledge
proofs (`ZKP_CIRCUITS_DIR=./circuits` in `backend/.env.example`; the path is
resolved relative to the `backend/` working directory).

```
circuits/
├── src/age_range.circom                       circuit source
└── build/                                     committed runtime artifacts
    ├── age_range.wasm                         witness generator
    ├── age_range_final.zkey                   Groth16 proving key
    └── age_range_verification_key.json        verification key
```

## Circuits

### `age_range` — KYC age-range proof

Proves `minAge <= currentYear - birthYear <= maxAge` **without revealing
`birthYear`**.

| Signal        | Visibility | Meaning                          |
| ------------- | ---------- | -------------------------------- |
| `birthYear`   | private    | the prover's year of birth       |
| `currentYear` | public     | reference year                   |
| `minAge`      | public     | inclusive lower bound (0–255)    |
| `maxAge`      | public     | inclusive upper bound (0–255)    |

The public signals of a proof are `[currentYear, minAge, maxAge]`. A witness
that violates the range cannot be generated, so no proof exists for a false
statement.

## Using the artifacts

```ts
const snarkjs = require('snarkjs');
const dir = path.resolve(process.cwd(), process.env.ZKP_CIRCUITS_DIR ?? './circuits');

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { birthYear: 1990, currentYear: 2026, minAge: 18, maxAge: 120 },
  `${dir}/build/age_range.wasm`,
  `${dir}/build/age_range_final.zkey`,
);
const ok = await snarkjs.groth16.verify(
  JSON.parse(fs.readFileSync(`${dir}/build/age_range_verification_key.json`, 'utf8')),
  publicSignals,
  proof,
);
```

`snarkjs` is currently a dev dependency (it backs the build script and the
integration test). Move it to `dependencies` before importing it from
production code.

## Rebuilding the artifacts

No native `circom` install is needed — the build uses the WASM `circom2`
compiler and `snarkjs`, both installed by `npm ci` in `backend/`.

```bash
cd backend
npm run zkp:build      # compile + trusted setup -> circuits/build/
npm run zkp:compile    # compile only (what CI runs); writes nothing
npm run test:zkp       # generate + verify a real proof with the artifacts
```

`zkp:build` runs: `circom2` compile → `snarkjs powersoftau` (bn128, 2^8) →
`groth16 setup` → `zkey contribute` → `zkey verify` → export verification key.

Re-run `zkp:build` and commit `circuits/build/` whenever a `.circom` file
changes — the `.zkey` is bound to the exact constraint system, so stale
artifacts will fail `npm run test:zkp`. Each build draws fresh randomness, so
the `.zkey` and verification key change on every build.

### ⚠️ Trusted setup

The committed `.zkey` comes from a **single-party development setup**
(`scripts/build-circuits.mjs`). Anyone who knows that contribution's entropy
could forge proofs. Before relying on these proofs for anything of value,
replace the setup with a multi-party ceremony (or a published powers-of-tau
such as Hermez/PSE) and publish the transcript.

## Adding a circuit

1. Add `circuits/src/<name>.circom`.
2. Add `<name>` to the `CIRCUITS` list in `scripts/build-circuits.mjs`.
3. `npm run zkp:build`, commit `circuits/build/`, and add a test next to
   `src/zkp/zkp-circuits.integration.spec.ts`.

## CI

`.github/workflows/zkp-ci.yml` runs on changes to `backend/circuits/**`,
the build scripts or `backend/src/zkp/**`: it compiles every circuit and runs
the integration test against the committed artifacts.
