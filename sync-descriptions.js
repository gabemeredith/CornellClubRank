#!/usr/bin/env node
// Usage: node sync-descriptions.js [--local]
// Pushes descriptions.json to the remote (or local) D1 database.

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const local = process.argv.includes('--local');
const flag = local ? '--local' : '--remote';
const descriptions = JSON.parse(readFileSync('./descriptions.json', 'utf8'));

for (const [name, description] of Object.entries(descriptions)) {
  const escaped = description.replace(/'/g, "''");
  const nameEscaped = name.replace(/'/g, "''");
  const sql = `UPDATE clubs SET description = '${escaped}' WHERE name = '${nameEscaped}'`;
  console.log(`Setting: ${name}`);
  execSync(
    `npx wrangler d1 execute cornell-clubs ${flag} --command="${sql}"`,
    { cwd: './worker', stdio: 'inherit' }
  );
}

console.log('Done.');
