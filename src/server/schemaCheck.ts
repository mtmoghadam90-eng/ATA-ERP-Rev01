import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";

/**
 * Whether the database has every migration this build expects.
 *
 * A migration that did not apply produces the worst kind of failure this
 * application has: the generated client selects a column the table does not
 * have, SQL Server answers "Invalid column name", and `sendError` — correctly —
 * turns that into a generic Persian sentence. So one module 500s on every read
 * and every write, every other module is fine, and nothing anywhere says why.
 * That took a full diagnostic round trip to place once; it should take none.
 *
 * The check is cheap (one query against a table with a handful of rows) and is
 * run at startup and exposed on `/api/db-health`.
 */

export interface SchemaState {
  /** Migration folders in the repository, oldest first. */
  expected: string[];
  /** Names recorded as finished in `_prisma_migrations`. */
  applied: string[];
  /** Expected but not applied — the ones that explain a broken module. */
  missing: string[];
  /** Set when the check itself could not run; `missing` is then meaningless. */
  error?: string;
}

/** Migration directory names, which are exactly the names Prisma records. */
function expectedMigrations(): string[] {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function checkSchema(): Promise<SchemaState> {
  let expected: string[] = [];
  try {
    expected = expectedMigrations();
  } catch (err) {
    return { expected: [], applied: [], missing: [], error: `cannot read prisma/migrations: ${(err as Error).message}` };
  }

  try {
    // `finished_at` is null for a migration that started and failed, which is
    // exactly as bad as one that never ran — so both count as missing.
    const rows = await getDb().$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL",
    );
    const applied = rows.map((row) => row.migration_name).sort();
    const appliedSet = new Set(applied);
    return { expected, applied, missing: expected.filter((name) => !appliedSet.has(name)) };
  } catch (err) {
    return { expected, applied: [], missing: [], error: (err as Error).message };
  }
}

/**
 * Says so, loudly, at startup.
 *
 * Never throws and never prevents the server from starting: a database that is
 * briefly unreachable at boot must not stop the application coming up, and a
 * partially migrated one still serves every module that is not affected.
 */
export async function reportSchemaState(): Promise<void> {
  const state = await checkSchema();

  if (state.error) {
    console.warn(`[schema] could not verify migrations: ${state.error}`);
    return;
  }

  if (state.missing.length === 0) {
    console.log(`[schema] all ${state.expected.length} migrations applied`);
    return;
  }

  console.error(
    `[schema] ${state.missing.length} migration(s) NOT applied to this database: `
    + state.missing.join(", "),
  );
  console.error(
    "[schema] modules whose tables those migrations change will fail with "
    + "\"Invalid column name\" on every read and write. Run: npm run db:deploy",
  );
}
