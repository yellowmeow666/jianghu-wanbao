import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoolFromEnv } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, '../sql');

/** MySQL errno for duplicate column / key name (idempotent ALTER). */
const IGNORABLE = new Set([1060, 1061]);

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pool = createPoolFromEnv();
  try {
    for (const file of files) {
      const raw = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      const statements = splitStatements(stripComments(raw));
      for (const stmt of statements) {
        try {
          await pool.query(stmt);
        } catch (err) {
          const e = err as { errno?: number; code?: string; message?: string };
          if (e.errno && IGNORABLE.has(e.errno)) {
            console.log(`  skip (already applied): ${e.message}`);
            continue;
          }
          throw err;
        }
      }
      console.log(`Migration ${file} applied.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
