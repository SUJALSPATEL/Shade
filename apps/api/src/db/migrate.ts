import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, query } from './client.js';

/**
 * Migration runner.
 *
 * Applies every `migrations/*.sql` file whose version is not already recorded
 * in `schema_migrations`, in filename order, each inside its own transaction.
 *
 * The SQL files are themselves idempotent (`CREATE TABLE IF NOT EXISTS`), which
 * matters because a fresh Docker volume also runs them through the postgres
 * entrypoint. Both paths agree, and whichever runs second is a no-op.
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:migrate -- --list  show applied / pending without changing anything
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(migrationsDir);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

async function appliedVersions(): Promise<Set<string>> {
  const result = await query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((row) => row.version));
}

export async function migrate({ listOnly = false } = {}): Promise<void> {
  await ensureMigrationsTable();
  const files = await listMigrationFiles();
  const applied = await appliedVersions();

  if (listOnly) {
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      console.log(`${applied.has(version) ? '  applied' : '  pending'}  ${file}`);
    }
    return;
  }

  let ran = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    process.stdout.write(`[migrate] applying ${file} ... `);
    try {
      await query('BEGIN');
      await query(sql);
      await query('COMMIT');
      ran += 1;
      console.log('ok');
    } catch (error) {
      await query('ROLLBACK').catch(() => undefined);
      console.log('failed');
      throw error;
    }
  }

  console.log(
    ran === 0
      ? '[migrate] database is up to date'
      : `[migrate] applied ${ran} migration${ran === 1 ? '' : 's'}`,
  );
}

/**
 * True when this file was the process entry point (`tsx src/db/migrate.ts`)
 * rather than an import from the server bootstrap. Compares real paths so it
 * works under tsx, where `argv[1]` and `import.meta.url` are both `.ts`.
 */
const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  migrate({ listOnly: process.argv.includes('--list') })
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('[migrate] failed:', error instanceof Error ? error.message : error);
      void closePool().finally(() => process.exit(1));
    });
}
