/**
 * Database Dump Anonymisation Script
 *
 * Reads a PostgreSQL plain-text dump from stdin (or a file path argument)
 * and writes an anonymised version to stdout (or a file path argument).
 *
 * Usage:
 *   pg_dump ... | ts-node anonymise-dump.ts > anonymised.sql
 *   ts-node anonymise-dump.ts --input dump.sql --output anonymised.sql
 *
 * Anonymisation rules (per issue #868):
 *   - user.email          -> faker.internet.email()
 *   - user.firstName      -> faker.name.firstName()
 *   - user.lastName       -> faker.name.lastName()
 *   - kyc encrypted cols  -> wiped (NULL)
 *   - wallet addresses    -> replaced with valid-format testnet addresses
 *   - IP addresses        -> replaced with 127.0.0.x
 *   - phone numbers       -> replaced with synthetic numbers
 *
 * The script uses regex-based replacements so it works on raw SQL dumps
 * without requiring a live database connection.
 */

import * as fs from 'fs';
import * as readline from 'readline';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const FIRST_NAMES = [
  'Amara', 'Kofi', 'Nia', 'Tendai', 'Zuri', 'Jabari', 'Imani', 'Kwame',
  'Fatima', 'Olumide', 'Aisha', 'Chidi', 'Nneka', 'Emeka', 'Adaeze', 'Binta',
  'Chen', 'Wei', 'Li', 'Ming', 'Jun', 'Xiao', 'Yuki', 'Hana',
  'Carlos', 'Maria', 'Jose', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Rosa',
];

const LAST_NAMES = [
  'Mensah', 'Okafor', 'Diallo', 'Abiodun', 'Kamau', 'Nkosi', 'Adeyemi', 'Touré',
  'Osei', 'Achebe', 'Mandela', 'Sowande', 'Banda', 'Kenyatta', 'Lumumba', 'Khan',
  'Wang', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Tanaka', 'Suzuki',
  'Silva', 'Santos', 'Oliveira', 'Costa', 'Ferreira', 'Pereira', 'Rocha', 'Almeida',
];

const DOMAINS = ['example.com', 'test.org', 'sample.net', 'demo.io', 'staging.dev'];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateEmail(): string {
  const first = randomFrom(FIRST_NAMES).toLowerCase();
  const last = randomFrom(LAST_NAMES).toLowerCase();
  const num = randomInt(1, 9999);
  return `${first}.${last}${num}@${randomFrom(DOMAINS)}`;
}

function generateFirstName(): string {
  return randomFrom(FIRST_NAMES);
}

function generateLastName(): string {
  return randomFrom(LAST_NAMES);
}

function generateTestnetAddress(): string {
  // Stellar testnet addresses start with G and are 56 chars
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let addr = 'G';
  for (let i = 1; i < 56; i++) {
    addr += chars[Math.floor(Math.random() * chars.length)];
  }
  return addr;
}

function generateIP(index: number): string {
  return `127.0.0.${(index % 254) + 1}`;
}

function generatePhone(): string {
  const codes = ['+1', '+234', '+254', '+233', '+27', '+91', '+55'];
  const code = randomFrom(codes);
  const num = Array.from({ length: 10 }, () => randomInt(0, 9)).join('');
  return `${code}${num}`;
}

/* ── Regex Patterns ──────────────────────────────────────────────────────── */

interface AnonymisationRule {
  name: string;
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}

let emailCounter = 0;
let ipCounter = 0;

const RULES: AnonymisationRule[] = [
  {
    name: 'email',
    pattern: /('(?:[^'\\]|\\.)*')/gi,
    replacement: (match) => {
      const inner = match.slice(1, -1);
      if (inner.includes('@') && inner.includes('.') && inner.length > 5 && inner.length < 100) {
        // Looks like an email
        return `'${generateEmail()}'`;
      }
      return match;
    },
  },
  {
    name: 'phone',
    pattern: /(\+\d{1,3}\d{8,12})/g,
    replacement: () => generatePhone(),
  },
  {
    name: 'ip_address',
    pattern: /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
    replacement: () => {
      ipCounter++;
      return generateIP(ipCounter);
    },
  },
  {
    name: 'stellar_address',
    pattern: /\b(G[A-Z2-5]{55})\b/g,
    replacement: () => generateTestnetAddress(),
  },
];

/* ── SQL-level anonymisation ─────────────────────────────────────────────── */

function anonymiseSQLLine(line: string): string {
  let result = line;

  // Replace email-like strings in single quotes
  result = result.replace(
    /'([^']*@[^']*\.[^']*)'/g,
    () => `'${generateEmail()}'`,
  );

  // Replace phone numbers
  result = result.replace(
    /(\+\d{1,3}\d{8,12})/g,
    () => generatePhone(),
  );

  // Replace IP addresses (but not 127.0.0.x which we use for staging)
  result = result.replace(
    /(?<!127\.0\.0\.)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
    () => {
      ipCounter++;
      return generateIP(ipCounter);
    },
  );

  // Replace Stellar testnet/public addresses
  result = result.replace(
    /\b(G[A-Z2-5]{55})\b/g,
    () => generateTestnetAddress(),
  );

  // Wipe KYC encrypted columns (set to NULL if they contain encrypted data).
  // The INSERT header and its data rows arrive on separate lines, so also
  // detect long opaque quoted tokens (e.g. JWT/base64 blobs) on the row lines.
  if (
    result.includes('kyc_submissions') ||
    result.includes('encrypted_') ||
    /'[A-Za-z0-9+/=.]{20,}'/.test(result)
  ) {
    result = result.replace(
      /'([A-Za-z0-9+/=.]{20,})'/g,
      'NULL',
    );
  }

  // Anonymise INSERT statements for users table
  if (result.includes('INSERT INTO "users"') || result.includes("INSERT INTO 'users'")) {
    // Replace email values in user inserts
    result = result.replace(
      /'([^']*@[^']*\.[^']*)'/,
      () => `'${generateEmail()}'`,
    );
    // Replace name fields
    result = result.replace(
      /'([A-Z][a-z]+)'/,
      () => `'${generateFirstName()}'`,
    );
  }

  return result;
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function processStream(input: readline.Interface, outputPath?: string): Promise<void> {
  const outputLines: string[] = [];
  let lineCount = 0;

  for await (const line of input) {
    lineCount++;
    const anonymised = anonymiseSQLLine(line);
    outputLines.push(anonymised);

    if (lineCount % 10000 === 0) {
      process.stderr.write(`Processed ${lineCount} lines...\n`);
    }
  }

  const output = outputLines.join('\n');

  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf-8');
    process.stderr.write(`Anonymised dump written to ${outputPath} (${lineCount} lines)\n`);
  } else {
    process.stdout.write(output);
  }

  process.stderr.write(`Anonymisation complete. Total lines: ${lineCount}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let inputPath: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  let input: readline.Interface;

  if (inputPath) {
    const fileStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
    input = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  } else {
    input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  }

  await processStream(input, outputPath);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
