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
  /**
   * Columns the migrations create that the database does not have, as
   * `table.column`.
   *
   * Not the same question as `missing`, and the more important one. A migration
   * that has shipped is recorded by name and never runs again — so editing one
   * to add a column reaches every repository and no database, and every name
   * still matches. That happened here: `discountAmount` was added to a migration
   * that had already run, and the supplier-inquiry module answered P2022 on
   * every read and write while the migration list looked perfect.
   */
  missingColumns: string[];
  /** Set when the check itself could not run; the lists are then meaningless. */
  error?: string;
}

/** `table.column` for every column the migrations add, in file order. */
function columnsMigrationsCreate(): { table: string; column: string }[] {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const wanted: { table: string; column: string }[] = [];
  const seen = new Set<string>();

  for (const name of expectedMigrations()) {
    let sql = "";
    try {
      sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf-8");
    } catch {
      continue;
    }

    // Both spellings Prisma and these hand-written files use, with or without
    // the schema and the brackets. `ADD CONSTRAINT` is excluded: every foreign
    // key in `0_init` is one, and without the exclusion this reports two dozen
    // tables as missing a column called CONSTRAINT.
    const pattern =
      /ALTER\s+TABLE\s+(?:\[?dbo\]?\.)?\[?(\w+)\]?\s+ADD\s+(?!CONSTRAINT\b)\[?(\w+)\]?/gi;
    for (const match of sql.matchAll(pattern)) {
      const key = `${match[1]}.${match[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push({ table: match[1], column: match[2] });
    }
  }
  return wanted;
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
    return {
      expected: [], applied: [], missing: [], missingColumns: [],
      error: `cannot read prisma/migrations: ${(err as Error).message}`,
    };
  }

  try {
    const db = getDb();

    // `finished_at` is null for a migration that started and failed, which is
    // exactly as bad as one that never ran — so both count as missing.
    const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL",
    );
    const applied = rows.map((row) => row.migration_name).sort();
    const appliedSet = new Set(applied);
    const missing = expected.filter((name) => !appliedSet.has(name));

    // What the database actually has, which is the question that matters.
    const present = await db.$queryRawUnsafe<{ TABLE_NAME: string; COLUMN_NAME: string }[]>(
      "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo'",
    );
    const have = new Set(present.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`.toLowerCase()));
    const missingColumns = columnsMigrationsCreate()
      .filter(({ table, column }) => !have.has(`${table}.${column}`.toLowerCase()))
      .map(({ table, column }) => `${table}.${column}`);

    return { expected, applied, missing, missingColumns };
  } catch (err) {
    return { expected, applied: [], missing: [], missingColumns: [], error: (err as Error).message };
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

  if (state.missing.length > 0) {
    console.error(
      `[schema] ${state.missing.length} migration(s) NOT applied to this database: `
      + state.missing.join(", "),
    );
  }

  if (state.missingColumns.length > 0) {
    console.error(
      `[schema] ${state.missingColumns.length} column(s) the migrations create are `
      + `NOT in this database: ${state.missingColumns.join(", ")}`,
    );
  }

  if (state.missing.length === 0 && state.missingColumns.length === 0) {
    console.log(`[schema] all ${state.expected.length} migrations applied, every column present`);
    return;
  }

  console.error(
    "[schema] the modules using those tables will fail on every read and write. "
    + "Run: npm run db:deploy",
  );
}
