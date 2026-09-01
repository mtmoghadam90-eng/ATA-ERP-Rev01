/**
 * Attaches an account to tasks that carry an assignee's name and no id.
 *
 * `assignedToUserId` is what «به من ارجاع شده» filters on and half of what
 * `visibilityClause` shows at all — so a task with a name and no id reads as
 * assigned on the card and belongs to nobody: it is missing from its own
 * assignee's board, and from every board but «همه وظایف». That is how it was
 * reported, and it is invisible precisely to the person who should act on it.
 *
 * The automations produced these by matching the name **exactly**, which is not
 * the same question — SQL Server's collation treats ی/ي, ک/ك and the two digit
 * sets as different characters, and a name typed into a project and one typed
 * into an account are two different typings. `nameKey` folds those away, and
 * every writer goes through `resolveAssignee` from here on; this walks what is
 * already on disk through the same rule once.
 *
 *   npm run fix:task-assignees -- --dry-run   # report, write nothing
 *   npm run fix:task-assignees
 *
 * Safe to run twice: a task that now has an id is not looked at again. It only
 * ever fills in a **missing** id — a task already assigned to somebody is never
 * moved, whatever the name beside it says.
 *
 * Output is English on purpose: the Windows console codepage mangles Persian.
 */
import "dotenv/config";
import { getDb, disconnectDb, isDbConfigured } from "../src/server/db";
import { matchAssignee } from "../src/utils/assigneeName";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const [orphans, directory] = await Promise.all([
    db.task.findMany({
      where: { assignedToUserId: null, NOT: { assignedToName: null } },
      select: { id: true, title: true, assignedToName: true },
    }),
    // Inactive accounts included: a task raised for somebody who has since left
    // still belongs to them, and their board is where its history reads.
    db.user.findMany({ select: { id: true, fullName: true, username: true } }),
  ]);

  let linked = 0;
  let unmatched = 0;

  for (const task of orphans) {
    const match = matchAssignee(task.assignedToName, directory);
    if (!match) {
      unmatched++;
      console.log(`no account for "${task.assignedToName}": ${task.title}`);
      continue;
    }
    console.log(`${task.title} -> ${match.fullName ?? match.username}`);
    linked++;
    if (!dryRun) {
      await db.task.update({
        where: { id: task.id },
        data: { assignedToUserId: match.id },
      });
    }
  }

  console.log(
    `\n${orphans.length} tasks with a name and no account: `
    + `${linked} linked, ${unmatched} left alone (no matching account).`,
  );
  if (dryRun) console.log("Dry run — nothing was written.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => disconnectDb());
