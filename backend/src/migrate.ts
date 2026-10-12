import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoolFromEnv } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../sql/001_cards.sql');

async function main(): Promise<void> {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  // Strip line comments for simple execution; keep statements
  const cleaned = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const pool = createPoolFromEnv();
  try {
    await pool.query(cleaned);
    console.log('Migration 001_cards.sql applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
