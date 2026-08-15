import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { expandDateFields } from "../dates";
import { toNullableString } from "../childSync";
import { GROUP_DATE_FIELDS } from "./activityService";
import { canonicalCategoryName, sameCategory } from "../../utils/activityCategories";

/**
 * The project timeline's automatic entries.
 *
 * A project's activity feed is part narrative — notes people write — and part
 * record: issuing a proforma, paying an instalment, shipping a packing list.
 * The second half was written by `autoLogFactActivity` in the client store,
 * from twenty mutations. Those mutations now happen on the server and the store
 * is no longer the thing that performs them, so all twenty calls became dead
 * code and the automatic half of every project's timeline stopped being
 * recorded. This is that half, moved to where the writes actually are.
 *
 * The original's two behaviours are kept deliberately:
 *
 * - **Category names are canonicalised before matching.** The same category was
 *   spelled several ways across the app, and the feed groups by it, so a
 *   variant spelling would silently start a second group for the same thing.
 * - **A group is matched on its *name*, not its id.** The auto-created group
 *   carries a synthetic `categoryId`, so matching by id would never find the
 *   group a user had already made for that category and the timeline would
 *   split in two.
 *
 * Matching is done in memory rather than in SQL because normalising means
 * stripping spaces and ZWNJ, which SQL Server's collation will not do; a
 * project has a handful of groups, so this is one small read.
 *
 * `sourceId` is not carried over. The original attached it to four of the
 * entries, but nothing has ever read it back — there is no column for it and no
 * client code refers to it — so reintroducing it would add a field that only
 * ever gets written.
 */

// Re-exported so the twenty call sites in this package keep their import, and
// so the browser and the server cannot drift apart on what a category is
// called. See src/utils/activityCategories.ts.
export { ACTIVITY_CATEGORY, canonicalCategoryName, sameCategory } from "../../utils/activityCategories";

export interface ProjectFact {
  projectId?: string | null;
  categoryName: string;
  text: string;
  /**
   * The record this entry is about.
   *
   * Carried so that deleting that record can offer to remove what the system
   * wrote about it. Omit it for an entry that describes something *becoming*
   * gone — the sentence recording a deletion belongs to the project, not to the
   * record it is the obituary of, and would otherwise delete itself.
   */
  sourceType?: string | null;
  sourceId?: string | null;
}

/**
 * Records one fact on a project's timeline.
 *
 * A no-op without a project, which is the common case — a transaction or a
 * proforma need not belong to one, and the original returned early on exactly
 * this check.
 */
export async function logProjectFact(
  fact: ProjectFact,
  user: AuthUser,
  todayJalali: string,
): Promise<void> {
  if (!fact.projectId) return;

  const text = toNullableString(fact.text);
  if (!text) return;

  const db = getDb();
  const categoryName = canonicalCategoryName(fact.categoryName);

  const groups = await db.projectCategoryGroup.findMany({
    where: { projectId: fact.projectId },
    select: { id: true, categoryName: true },
  });
  // Compared as categories, not as strings: a project's group may be stored
  // under a spelling — or a previous name — that is not the one being recorded.
  // Matching on the raw text would quietly open a second group for the same
  // thing, which is exactly what renaming a category would otherwise cause.
  let groupId = groups.find((g) => sameCategory(g.categoryName, categoryName))?.id;

  if (!groupId) {
    // The category has not been opened on this project yet. The id is
    // synthetic: these groups are keyed by what they are called, not by any
    // catalogue entry.
    const created = await db.projectCategoryGroup.create({
      data: {
        projectId: fact.projectId,
        categoryId: `cat-fact-${randomSuffix()}`,
        categoryName,
        status: "جاری",
        ...expandDateFields({ startDate: todayJalali }, GROUP_DATE_FIELDS),
      } as Prisma.ProjectCategoryGroupUncheckedCreateInput,
      select: { id: true },
    });
    groupId = created.id;
  }

  const author = await db.user.findUnique({
    where: { id: user.id },
    select: { fullName: true },
  });
  const authorName = author?.fullName ?? "سیستم";

  await db.projectActivity.create({
    data: {
      groupId,
      sourceType: toNullableString(fact.sourceType, 30),
      sourceId: toNullableString(fact.sourceId, 36),
      // Several of these sentences name whoever did the thing. `AuthUser`
      // carries only an id, so the placeholder is filled from the lookup the
      // entry needs anyway rather than every caller querying for a name.
      text: text.replace(/\{actor\}/g, authorName),
      authorUserId: user.id,
      // Kept beside the FK so the entry stays readable if the account goes.
      authorName: author?.fullName ?? null,
    } as Prisma.ProjectActivityUncheckedCreateInput,
  });
}

/**
 * Removes the automatic entries written about one record.
 *
 * Matched on the stored link alone. The previous version of this fell back to
 * matching the *wording* of an entry when no link was stored, which could
 * delete a sibling document's entry that happened to name the same product —
 * so entries written before the link existed are left alone rather than
 * guessed at.
 *
 * A category group left with nothing in it is removed too: it was opened by
 * these entries, and an empty heading on the timeline is noise. One a user
 * opened themselves survives, because it will still hold whatever else they
 * put in it.
 *
 * Returns how many entries went, so the caller can say.
 */
export async function removeFactsForRecord(
  tx: Prisma.TransactionClient,
  projectId: string | null | undefined,
  sourceId: string,
): Promise<number> {
  if (!projectId || !sourceId) return 0;

  const doomed = await tx.projectActivity.findMany({
    where: { sourceId, group: { projectId } },
    select: { id: true, groupId: true },
  });
  if (doomed.length === 0) return 0;

  const groupIds = [...new Set(doomed.map((a) => a.groupId))];
  await tx.projectActivity.deleteMany({ where: { id: { in: doomed.map((a) => a.id) } } });

  for (const groupId of groupIds) {
    const left = await tx.projectActivity.count({ where: { groupId } });
    if (left === 0) await tx.projectCategoryGroup.delete({ where: { id: groupId } });
  }

  return doomed.length;
}

/**
 * What happens to a record's timeline entries when the record is deleted.
 *
 * Two coherent outcomes, and the caller picks by asking the user:
 *
 *  - **Keep** (the default): the automatic entries stay, and one more is added
 *    saying the document was removed. The project's history reads continuously
 *    — a proforma was issued, was won, and was later deleted.
 *  - **Remove**: the entries about that record go, along with a category group
 *    they leave empty. The timeline reads as though the document never existed,
 *    which is what someone who created it by mistake wants.
 *
 * The deletion sentence deliberately carries no source link. It is about the
 * project, not about the record — a record that is gone cannot be deleted
 * again, and linking it would make the entry delete itself.
 */
export async function settleRecordHistory(
  removeActivities: boolean,
  projectId: string | null | undefined,
  sourceId: string,
  deletionFact: ProjectFact,
  user: AuthUser,
  todayJalali: string,
): Promise<void> {
  if (removeActivities) {
    await getDb().$transaction(async (tx) => {
      await removeFactsForRecord(tx, projectId, sourceId);
    });
    return;
  }
  await logProjectFact(deletionFact, user, todayJalali);
}

function randomSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
