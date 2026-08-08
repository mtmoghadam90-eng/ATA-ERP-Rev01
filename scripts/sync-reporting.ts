/**
 * Standalone reporting sync — for Windows Task Scheduler / cron.
 *
 *   npm run sync:report
 *
 * Reads the application database (no HTTP), flattens it, and loads the SQL
 * Server reporting schema. Exits non-zero on failure so a scheduler can detect
 * a bad run.
 *
 * This read the document store until the screens moved to SQL, after which that
 * file stopped being written and every run copied the same frozen
 * pre-migration data into the reporting database.
 */
import "dotenv/config";
import { syncToSqlServer, readConfigFromEnv } from "../src/reporting/sqlSync";
import { readSqlCollections } from "../src/reporting/loadFromSql";
import { disconnectDb, isDbConfigured } from "../src/server/db";

/**
 * Output is intentionally ASCII/English: this runs unattended under Windows Task
 * Scheduler, whose console/log encoding mangles Persian text and makes the log
 * useless for troubleshooting.
 */
async function main() {
  const cfg = readConfigFromEnv();
  if (!cfg) {
    console.error(
      "ERROR: SQL Server connection is not configured.\n" +
        "Set ERP_SQL_SERVER and ERP_SQL_DATABASE in the .env file " +
        "(see .env.example).",
    );
    process.exit(2);
  }

  if (!isDbConfigured()) {
    console.error(
      "ERROR: the application database is not configured.\n" +
        "Set DATABASE_URL in the .env file (see .env.example).",
    );
    process.exit(2);
  }

  console.log(`Source : application database (SQL Server)`);
  console.log(`Target : ${cfg.server}:${cfg.port || 1433}/${cfg.database}`);

  const result = await syncToSqlServer(await readSqlCollections(), cfg);

  if (!result.ok) {
    // Not process.exit: the pool still has to be released in the finally below.
    console.error(`\n[FAILED] ${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[OK] Sync completed at ${result.syncedAt}`);
  for (const t of result.tables) {
    console.log(`   ${t.table.padEnd(30)} ${String(t.rows).padStart(6)} rows`);
  }
  console.log(`   ${"TOTAL".padEnd(30)} ${String(result.totalRows).padStart(6)} rows`);
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err?.message || err);
    process.exitCode = 1;
  })
  // The application database is now a real connection pool, not a file read.
  // Without this the scheduled task finishes its work and then hangs holding it
  // open, which reads as a failed run.
  .finally(() => disconnectDb().catch(() => {}));
