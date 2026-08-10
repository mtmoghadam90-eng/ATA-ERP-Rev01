import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { expandDateFields } from "../dates";
import { toNullableString } from "../childSync";
import { GROUP_DATE_FIELDS } from "./activityService";
import { ACTIVITY_CATEGORY, canonicalCategoryName, sameCategory } from "../../utils/activityCategories";

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

function randomSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
