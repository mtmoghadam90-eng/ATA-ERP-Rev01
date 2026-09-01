import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { matchAssignee } from "../../utils/assigneeName";

/**
 * The account behind an assignee's name, for the automations that raise tasks.
 *
 * Four writers did this with the same exact-match query, spelled out four
 * times: the sales follow-up (twice), the workflow engine and the milestone
 * automation. An exact match is the wrong question — see `assigneeName.ts` —
 * and getting it wrong produced a task with a name on it and no id, which reads
 * as assigned and belongs to nobody.
 *
 * **The fallback is the important half.** A task nobody could be matched to
 * must still land on somebody's board: `assignedToUserId` is what «به من ارجاع
 * شده» filters on and half of what `visibilityClause` shows at all, so a null
 * there on an automation-raised task (which has no creator either) makes the
 * record invisible to everybody without «همه وظایف». The caller says who takes
 * it — the previous follow-up's assignee, or the person who pressed the button.
 */
export async function resolveAssignee(
  name: string | null | undefined,
  fallbackUserId?: string | null,
  tx?: Prisma.TransactionClient,
): Promise<{ assignedToUserId: string | null; assignedToName: string }> {
  const trimmed = String(name ?? "").trim();
  const db = tx ?? getDb();

  /*
   * The whole directory, not a filtered query.
   *
   * The comparison folds ی/ي, the half-space and repeated whitespace, which SQL
   * Server's collation does not — so it cannot be asked of the database. There
   * are tens of accounts here, not thousands, and this runs when a task is
   * raised rather than on any read path.
   */
  const directory = trimmed
    ? await db.user.findMany({
        where: { isActive: true },
        select: { id: true, fullName: true, username: true },
      })
    : [];

  const match = matchAssignee(trimmed, directory);
  if (match) return { assignedToUserId: match.id, assignedToName: match.fullName || trimmed };

  // Nobody matched. The name is kept — it is what somebody wrote, and it is
  // still the best label — but the task goes to whoever the caller named, so it
  // is on a board rather than nowhere.
  return { assignedToUserId: fallbackUserId ?? null, assignedToName: trimmed };
}
