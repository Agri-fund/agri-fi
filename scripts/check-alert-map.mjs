import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const alertsPath = path.join(rootDir, 'devops', 'prometheus', 'alerts.yaml');
const mapPath = path.join(rootDir, 'docs', 'monitoring', 'alert-map.md');

const alertsText = fs.readFileSync(alertsPath, 'utf8');
const mapText = fs.readFileSync(mapPath, 'utf8');

const alertNames = [];
const alertMeta = new Map();

let currentAlert = null;
for (const line of alertsText.split('\n')) {
  const alertMatch = /^\s*-\s*alert:\s*(\S+)\s*$/.exec(line);
  if (alertMatch) {
    currentAlert = alertMatch[1];
    alertNames.push(currentAlert);
    alertMeta.set(currentAlert, { severity: null, team: null, owner: null, runbook: null });
    continue;
  }

  if (!currentAlert) continue;

  const severityMatch = /^\s*severity:\s*(\S+)\s*$/.exec(line);
  if (severityMatch) {
    alertMeta.get(currentAlert).severity = severityMatch[1];
  }

  const teamMatch = /^\s*team:\s*(\S+)\s*$/.exec(line);
  if (teamMatch) {
    alertMeta.get(currentAlert).team = teamMatch[1];
  }

  const ownerMatch = /^\s*owner:\s*(\S+)\s*$/.exec(line);
  if (ownerMatch) {
    alertMeta.get(currentAlert).owner = ownerMatch[1];
  }

  const runbookMatch = /^\s*runbook:\s*(.+?)\s*$/.exec(line);
  if (runbookMatch) {
    alertMeta.get(currentAlert).runbook = runbookMatch[1].replace(/^['"]|['"]$/g, '');
  }
}

const missingOwner = alertNames.filter((name) => !alertMeta.get(name).owner || !alertMeta.get(name).runbook);
if (missingOwner.length > 0) {
  throw new Error(`Missing owner/runbook labels for: ${missingOwner.join(', ')}`);
}

const missingDocs = alertNames.filter((name) => !mapText.includes(name));
if (missingDocs.length > 0) {
  throw new Error(`Alert map is missing entries for: ${missingDocs.join(', ')}`);
}

console.log(`Validated ${alertNames.length} Prometheus alerts with owner/runbook metadata.`);
console.log(`Alert map includes all ${alertNames.length} entries.`);
