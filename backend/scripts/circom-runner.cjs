/**
 * Thin wrapper around the `circom2` (WASM) compiler API.
 *
 * The bundled `circom2` CLI converts file arguments with `path.relative()`,
 * which yields backslash paths on Windows that the WASI layer cannot write to
 * ("Could not write the output in the given path"). Calling the API with
 * forward-slash paths works on every platform.
 *
 * Usage (cwd must contain the paths): node circom-runner.cjs <circom args…>
 */
const fs = require('node:fs');
const path = require('node:path');
const { CircomRunner, bindings } = require('circom2');

const args = process.argv.slice(2).map((a) => a.split(path.sep).join('/'));
const runner = new CircomRunner({
  args,
  env: process.env,
  preopens: { '.': '.' },
  bindings: {
    ...bindings,
    exit(code) {
      process.exit(code);
    },
    kill(signal) {
      process.kill(process.pid, signal);
    },
    fs,
  },
});
const wasm = fs.readFileSync(require.resolve('circom2/circom.wasm'));
runner.execute(wasm).catch((err) => {
  console.error(err);
  process.exit(1);
});
