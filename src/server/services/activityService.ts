import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields } from "../dates";
import { getTodayShamsi } from "../../dateUtils";
import { toNullableString } from "../childSync";
import { processWorkflowRules } from "./workflowService";
import { notifyUser } from "./notificationService";

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

  const status = toNullableString(input.status, 30) ?? "جاری";

  /*
   * Closing a category stamps the day it closed.
   *
   * The caller sends `endDate: undefined` and a comment saying the server will
   * fill it in. It did not: `expandDateFields` sees the key, finds no value, and
   * writes NULL — so confirming "بستن دسته‌بندی" cleared the completion date
   * instead of setting it, and a closed category could never say when it closed.
   * An explicit date still wins; this only supplies the one nobody gave.
   */
  const closing = status === "اتمام کار";
  const dates = expandDateFields(input as Record<string, unknown>, GROUP_DATE_FIELDS);
  if (closing && !dates.endDate) {
    Object.assign(dates, expandDateFields({ endDate: getTodayShamsi() }, ["endDate"]));
  }

  const data = {
    status,
    categoryName: toNullableString(input.categoryName, 200)!,
    ...dates,
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

/**
 * Removes a category group and everything under it.
 *
 * The group -> activity -> referral -> message chain is a single cascade path,
 * so one delete takes the whole subtree with it. A user restricted to their own
 * projects may only delete a group on a project they own.
 */
export async function deleteCategoryGroup(
  id: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const group = await db.projectCategoryGroup.findUnique({
    where: { id },
    select: { id: true, project: { select: { ownerUserId: true } } },
  });
  if (!group) return "not-found";
  if (!canSeeProjects(user) && group.project.ownerUserId !== user.id) return "forbidden";

  await db.projectCategoryGroup.delete({ where: { id } });
  return "ok";
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

  const result = await db.$transaction(async (tx) => {
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
      const referral = await tx.projectReferral.create({
        data: {
          activityId: activity.id,
          assignedToUserId: toNullableString(input.referral.assignedToUserId, 36),
          assignedToName: toNullableString(input.referral.assignedToName, 200),
          assignedByUserId: user.id,
          assignedByName: author?.fullName ?? null,
          actionRequired: toNullableString(input.referral.actionRequired)!,
        } as Prisma.ProjectReferralUncheckedCreateInput,
      });

      // Get project info for workflow trigger
      const group = await tx.projectCategoryGroup.findUnique({
        where: { id: input.groupId! },
        select: { project: { select: { id: true } } },
      });

      // Workflow trigger for referral created (outside transaction)
      if (group?.project?.id) {
        // Store for later execution
        (referral as any).__triggerWorkflow = {
          projectId: group.project.id,
          assignedToUserId: referral.assignedToUserId,
          assignedToName: referral.assignedToName,
          actionRequired: referral.actionRequired,
        };
      }
    }

    return {
      activity: await tx.projectActivity.findUnique({
        where: { id: activity.id },
        include: { referral: { include: { messages: true } } },
      }),
    };
  });

  // Workflow trigger for referral (after transaction)
  if (result.activity?.referral && (result.activity.referral as any).__triggerWorkflow) {
    const trigger = (result.activity.referral as any).__triggerWorkflow;
    await processWorkflowRules(
      "referral_created",
      {
        referralId: result.activity.referral.id,
        projectId: trigger.projectId,
        assignedToUserId: trigger.assignedToUserId,
        assignedToName: trigger.assignedToName,
        actionRequired: trigger.actionRequired,
      },
      user,
    );
  }

  return result;
}

/**
 * Edits an activity's text.
 *
 * Only its author may — an activity is a record of what someone said, so putting
 * words in it must stay their own act. The referral and any replies are left
 * untouched; only the note itself changes.
 */
export async function updateActivity(
  id: string,
  text: string,
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "invalid" | { activity: unknown }> {
  const db = getDb();
  const trimmed = toNullableString(text);
  if (!trimmed) return "invalid";

  const activity = await db.projectActivity.findUnique({
    where: { id },
    select: { id: true, authorUserId: true },
  });
  if (!activity) return "not-found";
  if (activity.authorUserId !== user.id && !user.isSystemAdmin) return "forbidden";

  await db.projectActivity.update({ where: { id }, data: { text: trimmed } });
  return {
    activity: await db.projectActivity.findUnique({
      where: { id },
      include: { referral: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
    }),
  };
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
 * Referrals addressed to the caller, raised by the caller, or all of them for a
 * projects holder.
 *
 * Unlike the other modules the default here is *always* self-scoped, because
 * "my referrals" is what the screen is for; passing an explicit assignee filter
 * is what widens it, and only a permitted user may do that.
 *
 * `scope` is what the two tabs select: what I have been asked to do, versus what
 * I have asked of others. Both are the caller's own either way, so neither
 * needs a permission — and neither can be pointed at somebody else, because the
 * caller's id is what goes into the query.
 */
export async function listReferrals(
  q: ListQuery,
  user: AuthUser,
  filters: { mine?: boolean; scope?: "toMe" | "fromMe" } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const and: Record<string, unknown>[] = [];

  if (filters.scope === "fromMe") {
    and.push({ assignedByUserId: user.id });
  } else if (filters.scope === "toMe" || filters.mine || !canSeeProjects(user)) {
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
            group: {
              select: {
                id: true, categoryName: true,
                // The customer's name comes along because the inbox shows it
                // beside the project and links through to them.
                project: {
                  select: {
                    id: true, code: true, name: true,
                    customer: { select: { id: true, companyName: true } },
                  },
                },
              },
            },
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
    select: {
      id: true, assignedToUserId: true, assignedByUserId: true, status: true, activityId: true,
      activity: { select: { group: { select: { project: { select: { id: true, name: true, code: true } } } } } },
    },
  });
  if (!referral) return "not-found";

  const involved = referral.assignedToUserId === user.id || referral.assignedByUserId === user.id;
  if (!involved && !canSeeProjects(user)) return "forbidden";

  const oldStatus = referral.status;
  const newStatus = toNullableString(status, 40) ?? "در انتظار اقدام";

  await db.projectReferral.update({
    where: { id },
    data: { status: newStatus },
  });

  /*
   * Tell the other party the referral moved.
   *
   * Marking a referral done with no accompanying message was completely silent:
   * whoever raised it had to go and look. Reopening was silent the same way, and
   * that one is a request for more work.
   */
  if (oldStatus !== newStatus) {
    const counterpart = user.id === referral.assignedByUserId
      ? referral.assignedToUserId
      : referral.assignedByUserId;

    if (counterpart) {
      const actor = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
      const project = referral.activity?.group?.project;
      const where = project ? ` در پروژه ${project.name}${project.code ? ` (${project.code})` : ""}` : "";
      const done = newStatus === "انجام شده";

      await notifyUser({
        userId: counterpart,
        module: "ارجاعات",
        title: done ? "اتمام کار ارجاع" : "بازگشایی ارجاع",
        description: done
          ? `${actor?.fullName ?? "یک همکار"} کار ارجاع${where} را انجام‌شده اعلام کرد.`
          : `${actor?.fullName ?? "یک همکار"} ارجاع${where} را دوباره باز کرد و در انتظار اقدام قرار داد.`,
        projectId: project?.id ?? null,
        actorUserId: user.id,
      });
    }
  }

  // Workflow trigger for status change
  if (oldStatus !== newStatus) {
    // Get project info
    const activity = await db.projectActivity.findUnique({
      where: { id: referral.activityId },
      select: { group: { select: { project: { select: { id: true } } } } },
    });

    if (activity?.group?.project?.id) {
      await processWorkflowRules(
        "referral_status_change",
        {
          referralId: id,
          projectId: activity.group.project.id,
          assignedToUserId: referral.assignedToUserId,
          oldStatus,
          newStatus,
          status: newStatus,
        },
        user,
      );
    }
  }

  return "ok";
}

/**
 * Hands a referral to someone else.
 *
 * Forwarding is not a new referral — the thread and everything said in it stay
 * put, the assignee changes and the clock restarts, which is what "در انتظار
 * اقدام" means. Either party may do it: the assignee passes it on, the person
 * who raised it redirects.
 */
export async function reassignReferral(
  id: string,
  assignedToUserId: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found" | "no-such-user"> {
  const db = getDb();
  const referral = await db.projectReferral.findUnique({
    where: { id },
    select: { id: true, assignedToUserId: true, assignedByUserId: true },
  });
  if (!referral) return "not-found";

  const involved = referral.assignedToUserId === user.id || referral.assignedByUserId === user.id;
  if (!involved && !canSeeProjects(user)) return "forbidden";

  const target = await db.user.findUnique({
    where: { id: assignedToUserId },
    select: { id: true, fullName: true, isActive: true },
  });
  if (!target || !target.isActive) return "no-such-user";

  await db.projectReferral.update({
    where: { id },
    data: {
      assignedToUserId: target.id,
      assignedToName: target.fullName,
      status: "در انتظار اقدام",
    },
  });
  return "ok";
}

/** Appends a reply to a referral thread. */
export async function addReferralMessage(
  referralId: string,
  input: {
    text?: string;
    attachmentName?: string | null;
    attachmentSize?: string | null;
    attachmentUrl?: string | null;
    /**
     * Set when this reply is being handed on to someone else in the same
     * action. The forwarding itself puts the thread in the new assignee's
     * referral inbox, so a notice on top of it would say the same thing twice.
     */
    andForwarded?: boolean;
  },
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "invalid" | { message: unknown }> {
  const db = getDb();
  const text = toNullableString(input.text);
  if (!text) return "invalid";

  const referral = await db.projectReferral.findUnique({
    where: { id: referralId },
    select: {
      id: true, assignedToUserId: true, assignedByUserId: true, status: true,
      activity: { select: { group: { select: { project: { select: { id: true, name: true, code: true } } } } } },
    },
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

  /*
   * Tell the other party.
   *
   * A reply used to be silent: whoever raised the referral only found out that
   * it had been answered by opening it and looking. The notice goes to the
   * counterpart — the assignee when the person who raised it writes, the
   * raiser when the assignee does — and never to the author, which `notifyUser`
   * enforces anyway.
   *
   * Not when the reply is also being forwarded: that lands in the new
   * assignee's referral inbox on its own, and the user asked for one or the
   * other, not both.
   */
  if (!input.andForwarded) {
    const counterpart = user.id === referral.assignedByUserId
      ? referral.assignedToUserId
      : referral.assignedByUserId;

    const project = referral.activity?.group?.project;
    const where = project ? ` در پروژه ${project.name}${project.code ? ` (${project.code})` : ""}` : "";

    if (counterpart) {
      await notifyUser({
        userId: counterpart,
        module: "ارجاعات",
        title: "پاسخ جدید به ارجاع",
        description:
          `${author?.fullName ?? "یک همکار"} به ارجاع${where} پاسخ داد: ` +
          (text.length > 160 ? `${text.slice(0, 160)}…` : text),
        projectId: project?.id ?? null,
        actorUserId: user.id,
      });
    }
  }

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
