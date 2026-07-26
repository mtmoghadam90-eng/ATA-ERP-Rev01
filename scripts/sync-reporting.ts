/**
 * Standalone reporting sync — for Windows Task Scheduler / cron.
 *
 *   npm run sync:report
 *
 * Reads the app's data file directly (no HTTP), flattens it, and loads the
 * SQL Server reporting schema. Exits non-zero on failure so a scheduler can
 * detect a bad run.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { syncToSqlServer, readConfigFromEnv } from "../src/reporting/sqlSync";
import { StoreCollections } from "../src/reporting/flatten";

const DB_PATH = process.env.ERP_DB_PATH
  ? path.resolve(process.env.ERP_DB_PATH)
  : path.join(process.cwd(), "database.json");

function readStore(): StoreCollections {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Data file not found: ${DB_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf-8")) as Record<string, string>;
  const out: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "erp_settings") continue; // not tabular
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) out[key] = parsed;
    } catch {
      /* skip unparsable */
    }
  }
  return out as StoreCollections;
}

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

  console.log(`Source : ${DB_PATH}`);
  console.log(`Target : ${cfg.server}:${cfg.port || 1433}/${cfg.database}`);

  const result = await syncToSqlServer(readStore(), cfg);

  if (!result.ok) {
    console.error(`\n[FAILED] ${result.error}`);
    process.exit(1);
  }

  console.log(`\n[OK] Sync completed at ${result.syncedAt}`);
  for (const t of result.tables) {
    console.log(`   ${t.table.padEnd(30)} ${String(t.rows).padStart(6)} rows`);
  }
  console.log(`   ${"TOTAL".padEnd(30)} ${String(result.totalRows).padStart(6)} rows`);
}

main().catch((err) => {
  console.error("Unexpected error:", err?.message || err);
  process.exit(1);
});
