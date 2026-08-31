/**
 * Brings every project's loss reason into line with its proformas, once.
 *
 * The reason a job was lost used to be recordable in two places that meant the
 * same thing — the lines of the project's quotations, and a box on the project
 * form — so a report of loss reasons found two answers for one project, or an
 * answer in a place nobody had filled in. The proformas are now the authority
 * (`deriveProjectLossReason`), and `syncProjectStatus` writes the project's copy
 * on every proforma save.
 *
 * That fixes everything written from here on and nothing already on disk: a
 * project nobody re-saves keeps whatever the two paths left it with. This walks
 * the whole table once and applies the same rule to what is there.
 *
 *   npm run fix:project-loss-reasons -- --dry-run   # report, write nothing
 *   npm run fix:project-loss-reasons
 *
 * Safe to run twice: it is the same pure function over the same rows, so a
 * second run reports nothing to do. It only ever touches `lossReason`.
 *
 * Output is English on purpose: the Windows console codepage mangles Persian.
 */
import "dotenv/config";
import { getDb, disconnectDb, isDbConfigured } from "../src/server/db";
import { deriveProjectLossReason } from "../src/server/proformaStatus";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const projects = await db.project.findMany({
    select: {
      id: true, code: true, lossReason: true,
      proformas: {
        select: {
          id: true, status: true, isCancelled: true, createdAt: true, lossReason: true,
          items: { select: { status: true, supplyMethod: true, lossReason: true } },
        },
      },
    },
  });

  let changed = 0;
  let cleared = 0;
  let untouched = 0;

  for (const project of projects) {
    const derived = deriveProjectLossReason(project.proformas);
    // `undefined` is "the proformas have nothing to say" — the project keeps
    // what a person typed before the first quotation went out.
    if (derived === undefined) { untouched++; continue; }

    const current = (project.lossReason ?? "").trim();
    const next = derived === null ? "" : derived;
    if (current === next) { untouched++; continue; }

    console.log(
      `${project.code}: ${current || "(none)"} -> ${next || "(cleared)"}`,
    );
    if (derived === null) cleared++; else changed++;

    if (!dryRun) {
      await db.project.update({ where: { id: project.id }, data: { lossReason: derived } });
    }
  }

  console.log(
    `\n${projects.length} projects: ${changed} set from proforma lines, `
    + `${cleared} cleared (nothing lost), ${untouched} already right or left alone.`,
  );
  if (dryRun) console.log("Dry run — nothing was written.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => disconnectDb());
