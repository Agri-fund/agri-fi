import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The k6 performance gate must be able to fail CI (#1322). It used to run
 * `k6 run ... || echo "k6 execution completed"`, which swallowed k6's non-zero
 * exit code, so a breached threshold (p95 latency, error rate) never failed
 * the step. These tests read the workflow file and fail if that comes back.
 */
const root = resolve(__dirname, '../../..');
const workflow = readFileSync(resolve(root, '.github/workflows/k6-performance-gate.yml'), 'utf8');
const k6Script = readFileSync(resolve(root, 'tests/load/k6-performance.js'), 'utf8');

/** The workflow's steps, split on each "- name:" line, keyed by their name. */
function steps(): Map<string, string> {
  const parts = workflow.split(/^\s{6}- name: /m).slice(1);
  return new Map(parts.map((part) => [part.split('\n', 1)[0].trim(), part]));
}

const stepContaining = (needle: string): [string, string] => {
  const found = [...steps()].find(([, body]) => body.includes(needle));
  if (!found) throw new Error(`no step contains "${needle}"`);
  return found;
};

describe('k6 performance gate workflow (#1322)', () => {
  const [, runStep] = stepContaining('k6 run');
  const commandLines = runStep
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const k6Line = commandLines.find((line) => line.startsWith('k6 run')) ?? '';

  it('runs the k6 suite', () => {
    expect(k6Line).toContain('tests/load/k6-performance.js');
  });

  it("does not swallow k6's exit code", () => {
    expect(k6Line).not.toMatch(/\|\||;\s*(true|echo|exit\s+0)|&&\s*true/);
    expect(commandLines.join('\n')).not.toMatch(/\|\|\s*(true|echo|:)|exit\s+0/);
  });

  it('does not let the step continue on error', () => {
    expect(runStep).not.toMatch(/continue-on-error:\s*(true|\$\{\{)/);
  });

  it('is not skipped or disabled by a condition on the step', () => {
    expect(commandLines.some((line) => line.startsWith('if:'))).toBe(false);
  });

  it('still saves the summary when k6 fails, so a breach can be investigated', () => {
    const [, upload] = stepContaining('upload-artifact');
    expect(upload).toMatch(/if:\s*\$\{\{\s*(always\(\)|!cancelled\(\))\s*\}\}|if:\s*always\(\)/);
    expect(upload).toContain('test-results/k6-summary.json');
    expect(k6Line).toContain('--summary-export=test-results/k6-summary.json');
  });
});

describe('k6 thresholds (so a non-zero exit actually means a breach)', () => {
  it('defines an error-rate and latency thresholds', () => {
    expect(k6Script).toMatch(/thresholds:\s*{/);
    expect(k6Script).toMatch(/http_req_failed:\s*\['rate<0\.05'\]/);
    expect(k6Script).toMatch(/p\(95\)<250/);
  });
});
