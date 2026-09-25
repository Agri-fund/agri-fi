import fs from 'fs';
import path from 'path';

function getFiles(dir, files = []) {
  const fileList = fs.readdirSync(dir);
  for (const file of fileList) {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      getFiles(name, files);
    } else if (name.endsWith('.entity.ts')) {
      files.push(name);
    }
  }
  return files;
}

const domainMapping = {
  users: ['users', 'auth', 'achievements', 'notifications', 'email-sequence'],
  deals: ['trade-deals', 'shipments', 'upgrade'],
  investments: ['investments', 'escrow', 'outbox'],
  payments: ['stellar'],
  compliance: ['compliance', 'audit', 'archival', 'database', 'webhooks'],
};

function getDomain(filePath) {
  for (const [domain, dirs] of Object.entries(domainMapping)) {
    if (dirs.some((d) => filePath.includes(`/${d}/`))) {
      return domain;
    }
  }
  return 'users';
}

function parseEntities() {
  const rootDir = path.resolve(process.cwd(), 'backend/src');
  const files = getFiles(rootDir);
  const entities = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const classMatch = content.match(/export\s+class\s+([A-Za-z0-9_]+)/);
    if (!classMatch) continue;
    const className = classMatch[1];
    const domain = getDomain(file);

    const relations = [];
    const relRegex = /@(ManyToOne|OneToMany|OneToOne|ManyToMany)\s*\(\s*\(?\)?\s*=>\s*([A-Za-z0-9_]+)/g;
    let match;
    while ((match = relRegex.exec(content)) !== null) {
      relations.push({
        type: match[1],
        target: match[2],
      });
    }

    entities.push({ className, domain, relations });
  }

  return entities;
}

function generateMermaid() {
  const entities = parseEntities();
  const domains = ['users', 'deals', 'investments', 'payments', 'compliance'];

  let output = '```mermaid\nerDiagram\n';

  for (const domain of domains) {
    const domainEntities = entities.filter((e) => e.domain === domain);
    output += `    %% Domain: ${domain.toUpperCase()}\n`;
    for (const entity of domainEntities) {
      output += `    ${entity.className} {\n        string id PK\n    }\n`;
    }
  }

  output += '\n    %% Relationships\n';
  const drawn = new Set();

  for (const entity of entities) {
    for (const rel of entity.relations) {
      let symbol = '||--o{';
      if (rel.type === 'ManyToOne') symbol = '}o--||';
      else if (rel.type === 'OneToMany') symbol = '||--o{';
      else if (rel.type === 'OneToOne') symbol = '||--||';
      else if (rel.type === 'ManyToMany') symbol = '}o--o{';

      const key = `${entity.className}-${rel.target}-${rel.type}`;
      if (!drawn.has(key)) {
        drawn.add(key);
        output += `    ${entity.className} ${symbol} ${rel.target} : "${rel.type}"\n`;
      }
    }
  }

  output += '```\n';
  return output;
}

function main() {
  const docsDir = path.resolve(process.cwd(), 'docs/database');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const diagram = generateMermaid();
  const content = `# Database Schema ER Diagram

> Auto-generated from TypeORM entities by \`npm run doc:diagram\`. Do not edit manually.

${diagram}
`;

  const outputPath = path.join(docsDir, 'schema.md');
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Generated ER diagram at ${outputPath}`);
}

main();
