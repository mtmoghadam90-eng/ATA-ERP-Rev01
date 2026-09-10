/**
 * Makes a *copy* of the live database safe to open.
 *
 *   npx tsx scripts/prepareTestDb.ts
 *
 * A restored copy is not a test database yet — it is the live database under
 * another name, and the difference matters because this application does things
 * on its own the moment it starts:
 *
 * - a one-minute `setInterval` drains the message outbox, so anything queued in
 *   the copy is **really sent**, by SMS, Bale or e-mail, to the real customers
 *   whose real numbers the copy carries;
 * - the workflow sweep runs once per Shamsi day at the first sign-in, raising
 *   tasks and queueing more messages against every record it finds past its due
 *   day — and every one of those records is a real job.
 *
 * So the first thing anybody does with a copy must be to switch the sending off,
 * and «must remember to» is not a mechanism. This script is the mechanism.
 *
 * It changes nothing about the data itself: the customers, the quotations and
 * the money are exactly as they were copied, because a test database that has
 * been scrubbed is a test database that no longer reproduces the bug you were
 * chasing. Only the switch that decides whether a message leaves the building
 * is moved.
 *
 * English output: Persian in a Windows console comes out as question marks.
 */

import "dotenv/config";
import { getDb } from "../src/server/db";

/**
 * What a test database has to be called.
 *
 * The whole risk here is one command run against the wrong `DATABASE_URL` — the
 * live `.env` is the one already sitting in the folder, and it is the easiest
 * possible mistake. So the name is the guard: a database this refuses to touch
 * is a database it cannot damage, and «test» in the name is something a person
 * chooses deliberately when they create the copy.
 *
 * It is not a perfect rule and does not pretend to be. It is the one property of
 * a connection string that is visible without asking the server anything, and it
 * turns a silent catastrophe into a refusal with a sentence.
 */
const TEST_NAME_MARKER = "test";

/** The database name out of the JDBC-style connection string. */
export function databaseNameFrom(url: string | undefined): string | null {
  const match = /(?:^|;)\s*database\s*=\s*([^;]+)/i.exec(String(url ?? ""));
  return match ? match[1].trim() : null;
}

/**
 * Why this connection must not be prepared, or null.
 *
 * Pure so `test:rules` can hold it — the one function here whose being wrong is
 * expensive.
 */
export function prepareRefusal(url: string | undefined): string | null {
  if (!String(url ?? "").trim()) {
    return "DATABASE_URL is not set. Point .env at the copy first.";
  }
  const name = databaseNameFrom(url);
  if (!name) {
    return "DATABASE_URL names no database. Expected ...;database=ata_erp_test;...";
  }
  if (!name.toLowerCase().includes(TEST_NAME_MARKER)) {
    return `Refusing to touch "${name}": a test database must have "${TEST_NAME_MARKER}"`
      + " in its name. This script switches message sending OFF, which is not"
      + " something to do to the live database by accident.";
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  const refusal = prepareRefusal(url);
  if (refusal) {
    console.error(`\n  REFUSED\n  ${refusal}\n`);
    process.exitCode = 1;
    return;
  }

  const name = databaseNameFrom(url);
  console.log(`\nPreparing "${name}" as a test copy.\n`);

  const db = getDb();
  const row = await db.appSetting.findFirst();
  if (!row) {
    console.log("  ! No settings row found — nothing to switch off.");
    console.log("    An empty database needs `npm run seed:db`, not this script.");
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    console.error("  ! The settings document is not readable JSON. Stopping.");
    process.exitCode = 1;
    return;
  }

  /*
   * `dryRun` is the application's own switch, checked *before* the provider is
   * looked up — so a dry run never reaches a panel and does not even need one
   * configured. Using it rather than blanking the credentials means the copy
   * still exercises the whole sending path (the templates, the quiet hours, the
   * outbox rows, the retry policy) and simply stops at the door.
   */
  const messaging = (settings.messaging ?? {}) as Record<string, unknown>;
  const wasDryRun = messaging.dryRun === true;
  settings.messaging = { ...messaging, dryRun: true };

  await db.appSetting.update({
    where: { id: row.id },
    data: { data: JSON.stringify(settings) },
  });

  console.log(wasDryRun
    ? "  = messaging.dryRun was already on."
    : "  * messaging.dryRun switched ON — no SMS, Bale or e-mail will leave this copy.");

  /*
   * What is deliberately *not* done here, and why each one is a decision:
   *
   * - **The data is not scrubbed.** A copy with the names changed is a copy that
   *   no longer reproduces what you were investigating, which is the only reason
   *   it exists.
   * - **The API tokens are left alone.** They authenticate against *this*
   *   instance, so a copied token is a test token; revoking them would only mean
   *   re-issuing one to test an integration.
   * - **The users are left alone**, passwords included. Signing in as the person
   *   who reported a fault is usually the whole point.
   */
  console.log("\n  Data, users and tokens are untouched — only the sending switch moved.");
  console.log("  Reporting sync: point ERP_SQL_DATABASE somewhere else in this .env,");
  console.log("  or a sync from the copy overwrites the real Power BI tables.\n");
}

/*
 * Run only when this file is what was invoked.
 *
 * `test:rules` imports the two pure rules above to hold them, and a top-level
 * call would make that import *perform the write* — against whatever `.env`
 * happens to be in the folder, which on a developer's machine is the live one.
 * A guard that can be defeated by importing the module is not a guard.
 */
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("prepareTestDb.ts");
if (invokedDirectly) void main();
