/**
 * Fills in «مرحله جاری» for the projects already on disk, once.
 *
 * The column is derived and written by `syncProjectStage` on every write that
 * could move it — a proforma, a purchase order, a packing list, an after-sales
 * record. That fixes everything from here on and nothing already there: a
 * project nobody re-saves keeps a blank stage and its row prints «—».
 *
 * The backfill lives here and not in the migration on purpose. SQL Server
 * compiles a whole batch before running any of it, so a statement reading a
 * column the same file adds dies with «Invalid column name» however carefully
 * it is guarded — the trap `20260906000000_holiday_calendar_kind` fell into.
 *
 *   npm run fix:project-stages -- --dry-run   # report, write nothing
 *   npm run fix:project-stages
 *
 * Safe to run twice: the same pure function over the same rows, so a second run
 * reports nothing to do. It never touches a project whose stage is pinned by
 * hand, and it never writes `manualStage`.
 *
 * Output is English on purpose: the Windows console codepage mangles Persian.
 */
import "dotenv/config";
import { getDb, disconnectDb, isDbConfigured } from "../src/server/db";
import { deriveProjectStage, resolveStage } from "../src/utils/projectStage";
import { isWonStatus } from "../src/server/proformaStatus";
import { getTodayShamsi } from "../src/dateUtils";
import { normalizeJalali } from "../src/server/dates";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const todayJalali = getTodayShamsi();

  const projects = await db.project.findMany({
    select: {
      id: true, code: true, status: true, stage: true,
      manualStage: true, manualStageLocked: true,
      proformas: { select: { status: true, isCancelled: true } },
      purchaseOrders: { select: { status: true } },
      deliveries: { select: { actualDeliveryDate: true } },
      services: { select: { status: true } },
    },
  });

  let changed = 0;
  let pinned = 0;

  for (const p of projects) {
    const derived = deriveProjectStage({
      projectStatus: p.status,
      proformas: p.proformas,
      isWon: isWonStatus(p.status),
      isLost: p.status === "باخته",
      isCancelled: p.status === "لغو شده",
      purchaseOrders: p.purchaseOrders,
      deliveries: p.deliveries.map((d) => ({ delivered: !!d.actualDeliveryDate })),
      afterSales: p.services.map((s) => ({ open: s.status !== "تحویل داده شده" })),
    });

    /*
     * `recalculating: false`, unlike the service.
     *
     * This is a repair, not an event. An unlocked override is a person saying
     * «show this now»; consuming it here would silently throw away an answer
     * nothing has actually superseded.
     */
    const resolved = resolveStage(derived, p, false);
    if (resolved.isManual) { pinned += 1; continue; }
    if (resolved.stage === p.stage) continue;

    changed += 1;
    console.log(`  ${p.code ?? p.id}: ${p.stage ?? "(none)"} -> ${resolved.stage}`);
    if (!dryRun) {
      await db.project.update({
        where: { id: p.id },
        data: {
          stage: resolved.stage,
          stageChangedAt: new Date(),
          stageChangedAtJalali: normalizeJalali(todayJalali),
        },
      });
    }
  }

  console.log(
    `\n${projects.length} projects read, ${changed} ${dryRun ? "would change" : "updated"}`
    + `, ${pinned} left alone (set by hand).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
