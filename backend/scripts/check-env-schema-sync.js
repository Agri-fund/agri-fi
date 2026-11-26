#!/usr/bin/env node

/**
 * CI check (#1399) verifying that backend/.env.example stays in sync with
 * the Joi validationSchema in backend/src/config/env.validation.ts.
 *
 * Ensures:
 *  1. Every key declared in envValidationSchema is present in backend/.env.example.
 *  2. Every variable in REQUIRED_ENV_VARS is marked `[Required: yes]` in backend/.env.example.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const VALIDATION_FILE = path.join(BACKEND_ROOT, 'src/config/env.validation.ts');
const ENV_EXAMPLE_FILE = path.join(BACKEND_ROOT, '.env.example');

function extractSchemaInfo(source) {
  const schemaMatch = source.match(
    /export const envValidationSchema\s*=\s*Joi\.object\(\{([\s\S]*?)\}\)/,
  );
  if (!schemaMatch) {
    throw new Error('Could not locate envValidationSchema in env.validation.ts');
  }

  const schemaBody = schemaMatch[1];
  const schemaKeys = [];
  const keyRegex = /^\s*([A-Z][A-Z0-9_]*)\s*:/gm;
  let match;
  while ((match = keyRegex.exec(schemaBody)) !== null) {
    schemaKeys.push(match[1]);
  }

  const requiredMatch = source.match(
    /export const REQUIRED_ENV_VARS\s*=\s*\[([\s\S]*?)\]/,
  );
  const requiredKeys = [];
  if (requiredMatch) {
    const reqRegex = /['"]([A-Z][A-Z0-9_]*)['"]/g;
    let rMatch;
    while ((rMatch = reqRegex.exec(requiredMatch[1])) !== null) {
      requiredKeys.push(rMatch[1]);
    }
  }

  return { schemaKeys, requiredKeys };
}

function parseEnvExample(source) {
  const lines = source.split('\n');
  const vars = new Map();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = trimmed.match(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/);
    if (!match) continue;

    const varName = match[1];
    let requiredMarker = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prev = lines[j].trim();
      if (!prev.startsWith('#')) break;
      const reqMatch = prev.match(/\[Required:\s*([^\]]+)\]/i);
      if (reqMatch) {
        requiredMarker = reqMatch[1].trim().toLowerCase();
        break;
      }
    }
    vars.set(varName, { requiredMarker });
  }

  return vars;
}

function main() {
  const validationSrc = fs.readFileSync(VALIDATION_FILE, 'utf8');
  const exampleSrc = fs.readFileSync(ENV_EXAMPLE_FILE, 'utf8');

  const { schemaKeys, requiredKeys } = extractSchemaInfo(validationSrc);
  const exampleVars = parseEnvExample(exampleSrc);

  const errors = [];

  for (const key of schemaKeys) {
    if (!exampleVars.has(key)) {
      errors.push(
        `Validated variable ${key} in envValidationSchema is missing from backend/.env.example`,
      );
    }
  }

  for (const key of requiredKeys) {
    const entry = exampleVars.get(key);
    if (!entry) {
      errors.push(
        `Required variable ${key} in REQUIRED_ENV_VARS is missing from backend/.env.example`,
      );
    } else if (entry.requiredMarker !== 'yes') {
      errors.push(
        `Required variable ${key} must be marked [Required: yes] in backend/.env.example (found: ${entry.requiredMarker ?? 'none'})`,
      );
    }
  }

  if (errors.length > 0) {
    console.error('Env schema sync check failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    `Env schema sync check passed (${schemaKeys.length} validated keys, ${requiredKeys.length} required keys).`,
  );
}

main();
