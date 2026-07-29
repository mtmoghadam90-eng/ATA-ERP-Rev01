import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields } from "../dates";
import { toNullableString } from "../childSync";

/**
 * Project category groups, activities, referrals and module notes.
 *
 * Everything here is an **append-only stream**: a record of something somebody
 * said or did, at a time. None of it may go through `syncChildren` — rebuilding
 * a conversation would destroy it. Entries are added one at a time, and removal
 * is restricted to the person who wrote it, while nothing has replied.
 */

/* ============================ category groups ============================ */

export const GROUP_DATE_FIELDS = ["startDate", "endDate"] as const;

function canSeeProjects(user: AuthUser): boolean {
  return hasPermission(user, "projects");
}

export async function listCategoryGroups(projectId: string, user: AuthUser) {
  const db = getDb();

  // A user restricted to their own projects must not read another's activity.
  if (!canSeeProjects(user)) {
    const owned = await db.project.count({ where: { id: projectId, ownerUserId: user.id } });
    if (owned === 0) return null;
  }

  return db.projectCategoryGroup.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: {
      activities: {
        orderBy: { createdAt: "desc" },
        include: { referral: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
      },
    },
  });
}

export interface CategoryGroupInput {
  projectId?: string;
  categoryId?: string;
  categoryName?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export async function upsertCategoryGroup(
  input: CategoryGroupInput,
  user: AuthUser,
): Promise<"forbidden" | "invalid" | { group: unknown }> {
  const db = getDb();
  if (!input.projectId || !input.categoryId || !input.categoryName) return "invalid";

  if (!canSeeProjects(user)) {
    const owned = await db.project.count({ where: { id: input.projectId, ownerUserId: user.id } });
    if (owned === 0) return "forbidden";
  }

  const data = {
    status: toNullableString(input.status, 30) ?? "جاری",
    categoryName: toNullableString(input.categoryName, 200)!,
    ...expandDateFields(input as Record<string, unknown>, GROUP_DATE_FIELDS),
  };

  // One group per category per project: the pair is the natural key even though
  // the table carries a surrogate id.
  const existing = await db.projectCategoryGroup.findFirst({
    where: { projectId: input.projectId, categoryId: input.categoryId },
    select: { id: true },
  });

  const group = existing
    ? await db.projectCategoryGroup.update({ where: { id: existing.id }, data })
    : await db.projectCategoryGroup.create({
        data: {
          projectId: input.projectId,
          categoryId: input.categoryId,
          ...data,
        } as Prisma.ProjectCategoryGroupUncheckedCreateInput,
      });

  return { group };
}

/* =============================== activities ============================== */

export const ACTIVITY_SORTABLE = ["createdAt"] as const;

/**
 * Activities across projects — the feed the dashboard shows.
 *
 * Scoped through the group to the project, so a restricted user's feed contains
 * only their own projects and the totals do not reveal the rest.
 */
export async function listActivities(
  q: ListQuery,
  user: AuthUser,
  filters: { projectId?: string; groupId?: string } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const and: Record<string, unknown>[] = [];

  if (!canSeeProjects(user)) {
    and.push({ group: { project: { ownerUserId: user.id } } });
  }
  if (filters.groupId) and.push({ groupId: filters.groupId });
  if (filters.projectId) and.push({ group: { projectId: filters.projectId } });

  const search = searchClause(q.search, ["text", "authorName"]);
  if (search) and.push(search);

  const where = and.length === 0 ? {} : { AND: and };

  const [rows, total] = await Promise.all([
    db.projectActivity.findMany({
      where,
      orderBy: { createdAt: q.order === "asc" ? "asc" : "desc" },
      include: {
        group: { select: { id: true, categoryName: true, project: { select: { id: true, code: true, name: true } } } },
        referral: { include: { messages: { orderBy: { createdAt: "asc" } } } },
      },
      ...paginationArgs(q),
    }),
    db.projectActivity.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export interface ActivityInput {
  groupId?: string;
  text?: string;
  attachmentName?: string | null;
  attachmentSize?: string | null;
  attachmentUrl?: string | null;
  /** Optional referral raised together with the activity. */
  referral?: {
    assignedToUserId?: string | null;
    assignedToName?: string | null;
    actionRequired?: string;
  };
}

/**
 * Appends an activity, and the referral it may carry, in one transaction.
 *
 * The author is taken from the session, never the body — an entry attributable
 * to whoever the client claims is not a record of anything.
 */
export async function addActivity(
  input: ActivityInput,
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "invalid" | { activity: unknown }> {
  const db = getDb();
  const text = toNullableString(input.text);
  if (!input.groupId || !text) return "invalid";

  const group = await db.projectCategoryGroup.findUnique({
    where: { id: input.groupId },
    select: { id: true, project: { select: { id: true, ownerUserId: true } } },
  });
  if (!group) return "not-found";
  if (!canSeeProjects(user) && group.project.ownerUserId !== user.id) return "forbidden";

  const author = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });

  return db.$transaction(async (tx) => {
    const activity = await tx.projectActivity.create({
      data: {
        groupId: input.groupId!,
        text,
        authorUserId: user.id,
        // Kept alongside the FK so the history stays readable if the account goes.
        authorName: author?.fullName ?? null,
        attachmentName: toNullableString(input.attachmentName, 300),
        attachmentSize: toNullableString(input.attachmentSize, 50),
        attachmentUrl: toNullableString(input.attachmentUrl, 500),
      } as Prisma.ProjectActivityUncheckedCreateInput,
    });

    if (input.referral?.actionRequired) {
      await tx.projectReferral.create({
        data: {
          activityId: activity.id,
          assignedToUserId: toNullableString(input.referral.assignedToUserId, 36),
          assignedToName: toNullableString(input.referral.assignedToName, 200),
          assignedByUserId: user.id,
          assignedByName: author?.fullName ?? null,
          actionRequired: toNullableString(input.referral.actionRequired)!,
        } as Prisma.ProjectReferralUncheckedCreateInput,
      });
    }

    return {
      activity: await tx.projectActivity.findUnique({
        where: { id: activity.id },
        include: { referral: { include: { messages: true } } },
      }),
    };
  });
}

/**
 * Removes an activity.
 *
 * Only its author, and only while nothing has been said in reply — once a
 * referral has answers, deleting the entry they answer would leave the thread
 * incoherent.
 */
export async function deleteActivity(
  id: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found" | "has-replies"> {
  const db = getDb();
  const activity = await db.projectActivity.findUnique({
    where: { id },
    select: {
      id: true, authorUserId: true,
      referral: { select: { id: true, _count: { select: { messages: true } } } },
    },
  });
  if (!activity) return "not-found";
  if (activity.authorUserId !== user.id && !user.isSystemAdmin) return "forbidden";
  if ((activity.referral?._count.messages ?? 0) > 0) return "has-replies";

  await db.projectActivity.delete({ where: { id } });
  return "ok";
}

/* =============================== referrals =============================== */

export const REFERRAL_SORTABLE = ["createdAt", "status"] as const;
export const REFERRAL_FILTERABLE = ["status", "assignedToUserId"] as const;

/**
 * Referrals addressed to the caller, or all of them for a projects holder.
 *
 * Unlike the other modules the default here is *always* self-scoped, because
 * "my referrals" is what the screen is for; passing an explicit assignee filter
 * is what widens it, and only a permitted user may do that.
 */
export async function listReferrals(
  q: ListQuery,
  user: AuthUser,
  filters: { mine?: boolean } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const and: Record<string, unknown>[] = [];

  if (filters.mine || !canSeeProjects(user)) {
    and.push({ assignedToUserId: user.id });
  }
  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const where = and.length === 0 ? {} : { AND: and };

  const [rows, total] = await Promise.all([
    db.projectReferral.findMany({
      where,
      orderBy: q.sort ? { [q.sort]: q.order } : { createdAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        activity: {
          select: {
            id: true, text: true, createdAt: true,
            group: { select: { id: true, categoryName: true, project: { select: { id: true, code: true, name: true } } } },
          },
        },
      },
      ...paginationArgs(q),
    }),
    db.projectReferral.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

/**
 * Changes a referral's status.
 *
 * Either party may move it: the assignee reports progress, the person who raised
 * it accepts or reopens.
 */
export async function setReferralStatus(
  id: string,
  status: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const referral = await db.projectReferral.findUnique({
    where: { id },
    select: { id: true, assignedToUserId: true, assignedByUserId: true },
  });
  if (!referral) return "not-found";

  const involved = referral.assignedToUserId === user.id || referral.assignedByUserId === user.id;
  if (!involved && !canSeeProjects(user)) return "forbidden";

  await db.projectReferral.update({
    where: { id },
    data: { status: toNullableString(status, 40) ?? "در انتظار اقدام" },
  });
  return "ok";
}

/** Appends a reply to a referral thread. */
export async function addReferralMessage(
  referralId: string,
  input: { text?: string; attachmentName?: string | null; attachmentSize?: string | null; attachmentUrl?: string | null },
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "invalid" | { message: unknown }> {
  const db = getDb();
  const text = toNullableString(input.text);
  if (!text) return "invalid";

  const referral = await db.projectReferral.findUnique({
    where: { id: referralId },
    select: { id: true, assignedToUserId: true, assignedByUserId: true },
  });
  if (!referral) return "not-found";

  const involved = referral.assignedToUserId === user.id || referral.assignedByUserId === user.id;
  if (!involved && !canSeeProjects(user)) return "forbidden";

  const author = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });

  const message = await db.referralMessage.create({
    data: {
      referralId,
      text,
      responderUserId: user.id,
      responderName: author?.fullName ?? null,
      attachmentName: toNullableString(input.attachmentName, 300),
      attachmentSize: toNullableString(input.attachmentSize, 50),
      attachmentUrl: toNullableString(input.attachmentUrl, 500),
    } as Prisma.ReferralMessageUncheckedCreateInput,
  });
  return { message };
}

/* ============================== module notes ============================= */

/** Free-form notes attached to any record type, by a discriminator pair. */
export async function listModuleNotes(entityType: string, entityId: string) {
  return getDb().moduleNote.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
  });
}

export async function addModuleNote(
  entityType: string,
  entityId: string,
  text: string,
  user: AuthUser,
): Promise<"invalid" | { note: unknown }> {
  const trimmed = toNullableString(text);
  if (!entityType || !entityId || !trimmed) return "invalid";

  const db = getDb();
  const author = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });

  const note = await db.moduleNote.create({
    data: {
      entityType: toNullableString(entityType, 40)!,
      entityId: toNullableString(entityId, 36)!,
      text: trimmed,
      authorName: author?.fullName ?? null,
    },
  });
  return { note };
}

export async function deleteModuleNote(
  id: string,
  user: AuthUser,
): Promise<"ok" | "not-found" | "forbidden"> {
  const db = getDb();
  const note = await db.moduleNote.findUnique({ where: { id }, select: { id: true, authorName: true } });
  if (!note) return "not-found";

  // Notes carry a name rather than a user id, so authorship is matched by name;
  // an administrator can always remove one.
  if (!user.isSystemAdmin) {
    const me = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    if (!me || note.authorName !== me.fullName) return "forbidden";
  }

  await db.moduleNote.delete({ where: { id } });
  return "ok";
}
