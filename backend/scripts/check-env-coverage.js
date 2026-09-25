#!/usr/bin/env node

/**
 * CI script to verify that backend/.env.example defines every environment variable
 * read via process.env or ConfigService in backend/src.
 *
 * Exit code 0: All referenced environment variables are present in .env.example.
 * Exit code 1: One or more referenced variables are missing from .env.example.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(BACKEND_ROOT, 'src');
const ENV_EXAMPLE_FILE = path.join(BACKEND_ROOT, '.env.example');

// Variables that are Node/runtime builtins, dynamic keys, or test-only globals
const IGNORED_VARS = new Set([
  'NODE_ENV',
  'npm_package_version',
  'userId',
  'correlationId',
  'token',
]);

function walk(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractEnvVarsFromCode(files) {
  const envVars = new Set();
  const patterns = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[['"]([A-Z0-9_]+)['"]\]/g,
    /config(?:Service)?\.get(?:<[^>]+>)?\(\s*['"]([A-Z0-9_]+)['"]/g,
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const varName = match[1];
        if (/^[A-Z][A-Z0-9_]+$/.test(varName) && !IGNORED_VARS.has(varName)) {
          envVars.add(varName);
        }
      }
    }
  }

  return envVars;
}

function extractEnvVarsFromExample(exampleFilePath) {
  if (!fs.existsSync(exampleFilePath)) {
    throw new Error(`.env.example file not found at ${exampleFilePath}`);
  }

  const content = fs.readFileSync(exampleFilePath, 'utf8');
  const lines = content.split('\n');
  const definedVars = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    // Matches VAR_NAME= or # VAR_NAME= or # [Type: ...] VAR_NAME=
    const match = trimmed.match(/^(?:#\s*)?([A-Z0-9_]+)=/);
    if (match) {
      definedVars.add(match[1]);
    }
  }

  return definedVars;
}

function main() {
  console.log('🔍 Checking environment variable coverage in backend/.env.example...');

  const srcFiles = walk(SRC_DIR);
  const referencedVars = extractEnvVarsFromCode(srcFiles);
  const definedVars = extractEnvVarsFromExample(ENV_EXAMPLE_FILE);

  const missing = [];
  for (const v of referencedVars) {
    if (!definedVars.has(v)) {
      missing.push(v);
    }
  }

  console.log(`📊 Found ${referencedVars.size} referenced env variables in backend/src.`);
  console.log(`📄 Found ${definedVars.size} env variables declared in .env.example.`);

  if (missing.length > 0) {
    console.error('\n❌ Missing environment variables in backend/.env.example:');
    for (const v of missing.sort()) {
      console.error(`   - ${v}`);
    }
    console.error(`\nPlease document all ${missing.length} missing variables in backend/.env.example with type, required status, and secret markers.`);
    process.exit(1);
  }

  console.log('\n✅ All referenced environment variables are documented in backend/.env.example!');
  process.exit(0);
}

main();
