import { Prisma } from "@prisma/client";
import { parseMentions } from "../../utils/mentions";
import { ActivityAttachment, attachmentColumns, normalizeAttachments } from "../../utils/attachments";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields } from "../dates";
import { getTodayShamsi } from "../../dateUtils";
import { toNullableString } from "../childSync";
import { applyCategoryMilestoneTriggers } from "./milestoneAutomation";
import { processWorkflowRules } from "./workflowService";
import { notifyUser } from "./notificationService";
import { ACTIVITY_CATEGORY, logProjectFact } from "./projectActivityLog";
import { afterCommit } from "../afterCommit";

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
        include: ACTIVITY_INCLUDE,
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
    select: { id: true, status: true },
  });
  const wasClosed = existing?.status === "اتمام کار";

  const group = existing
    ? await db.projectCategoryGroup.update({ where: { id: existing.id }, data })
    : await db.projectCategoryGroup.create({
        data: {
          projectId: input.projectId,
          categoryId: input.categoryId,
          ...data,
        } as Prisma.ProjectCategoryGroupUncheckedCreateInput,
      });

  /*
   * The project's "تریگر هوشمند" milestones.
   *
   * A checkpoint can be bound to a category rather than ticked by hand — done
   * when the category opens, or when it closes. This is where that happens; the
   * flag was stored and displayed with a pulsing badge and nothing ever acted
   * on it.
   *
   * Only on the transitions, not on every save of the group: opening fires when
   * the group is created, closing when its status becomes "اتمام کار" having not
   * been. `applyCategoryMilestoneTriggers` is idempotent anyway — it only moves
   * a milestone from open to done — but a re-closed category should not look
   * like a fresh event.
   */
  if (!existing) {
    await applyCategoryMilestoneTriggers(
      input.projectId, data.categoryName, "category_start", user, getTodayShamsi());
  }
  if (closing && !wasClosed) {
    await applyCategoryMilestoneTriggers(
      input.projectId, data.categoryName, "category_complete", user, getTodayShamsi());
  }

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
        ...ACTIVITY_INCLUDE,
      },
      ...paginationArgs(q),
    }),
    db.projectActivity.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

/**
 * How many project groups use each activity category, in one query.
 *
 * The settings screen shows a «در حال استفاده» column for every category, and
 * asking per row would be one request per category on every render. The
 * per-category endpoint stays for the delete check, which needs the count for
 * exactly one.
 */
export async function categoryUsage(): Promise<Record<string, number>> {
  const rows = await getDb().projectCategoryGroup.groupBy({
    by: ["categoryId"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const row of rows) out[row.categoryId] = row._count._all;
  return out;
}

/**
 * Renames a category everywhere it has already been used.
 *
 * `ProjectCategoryGroup.categoryName` is denormalised so a project's history
 * stays readable when a category is removed from the settings — but that also
 * means a rename that only touched the settings would leave every existing
 * project showing the old wording, and the two would disagree for good. A
 * rename is a correction, so it follows.
 *
 * The activity entries themselves are untouched: they record what somebody
 * did, not what the category was called.
 */
export async function renameCategory(
  categoryId: string,
  name: string,
): Promise<{ updated: number }> {
  const clean = toNullableString(name, 200);
  if (!clean) return { updated: 0 };
  const result = await getDb().projectCategoryGroup.updateMany({
    where: { categoryId },
    data: { categoryName: clean },
  });
  return { updated: result.count };
}

export interface ActivityInput {
  groupId?: string;
  text?: string;
  /**
   * Every file on the entry. The three fields below are the older shape, one
   * file, and are still accepted so nothing that sends them breaks.
   */
  attachments?: ActivityAttachment[];
  attachmentName?: string | null;
  attachmentSize?: string | null;
  attachmentUrl?: string | null;
  /**
   * The message this one answers.
   *
   * Checked against the same category group, so a reply cannot be attached to
   * a message on another project — the id comes from a browser.
   */
  replyToId?: string | null;
  /**
   * Kept for callers written before mentions existed.
   *
   * A referral is raised by naming somebody in the text now, so this is no
   * longer how the screens ask for one. It is still honoured because an
   * integration may send it, and dropping it silently would lose a request.
   */
  referral?: {
    assignedToUserId?: string | null;
    assignedToName?: string | null;
    actionRequired?: string;
  };
}

/**
 * What an activity is read with, everywhere.
 *
 * `referrals` is a list: a message naming two colleagues is a request to two
 * people, each with its own thread and its own status. `replyTo` is a narrow
 * projection — the feed prints a quoted line above the answer, not the whole
 * parent again.
 */
const ACTIVITY_INCLUDE = {
  referrals: {
    orderBy: { createdAt: "asc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  },
  replyTo: {
    select: { id: true, text: true, authorName: true, createdAt: true },
  },
} as const;

/**
 * The files an input carries, whichever shape it used.
 *
 * A list wins over the single-file fields; a caller that sends only the old
 * three still works, which is what keeps the referral reply path — which has
 * not moved to lists — sending what it always sent.
 */
function attachmentsOf(input: ActivityInput): ActivityAttachment[] {
  const list = normalizeAttachments(input.attachments);
  if (list.length > 0) return list;
  return normalizeAttachments([
    { name: input.attachmentName, size: input.attachmentSize, url: input.attachmentUrl },
  ]);
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
    select: { id: true, project: { select: { id: true, code: true, ownerUserId: true } } },
  });
  if (!group) return "not-found";
  if (!canSeeProjects(user) && group.project.ownerUserId !== user.id) return "forbidden";

  const author = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });

  /*
   * A reply belongs to the same conversation.
   *
   * The parent id comes from a browser, so it is checked against this group
   * rather than trusted — otherwise a message on one project could be hung
   * under a message on another, and the feed would print a quotation from a
   * job the reader cannot see.
   */
  let replyToId: string | null = null;
  const requestedReply = toNullableString(input.replyToId, 36);
  if (requestedReply) {
    const parent = await db.projectActivity.findFirst({
      where: { id: requestedReply, groupId: input.groupId },
      select: { id: true },
    });
    replyToId = parent?.id ?? null;
  }

  /*
   * The people the message named, each of whom is being asked to do something.
   *
   * Naming somebody *is* the referral — the form used to carry a checkbox, a
   * colleague picker and a "what should they do" box saying what the sentence
   * already said. The action required is the message itself, so there is one
   * text and not two that drift apart.
   *
   * Matched against the real directory rather than a pattern, because a name
   * here is two or three words with spaces in it. Never the author: writing
   * your own name is not asking yourself, and it would put a referral in your
   * own inbox every time you signed a note.
   */
  const directory = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true },
  });
  const mentioned = parseMentions(text, directory).filter((u) => u.id !== user.id);

  const result = await db.$transaction(async (tx) => {
    const activity = await tx.projectActivity.create({
      data: {
        groupId: input.groupId!,
        text,
        replyToId,
        authorUserId: user.id,
        // Kept alongside the FK so the history stays readable if the account goes.
        authorName: author?.fullName ?? null,
        ...attachmentColumns(attachmentsOf(input)),
      } as Prisma.ProjectActivityUncheckedCreateInput,
    });

    /*
     * One referral per person named, plus the explicit one an older caller
     * may still send.
     *
     * The action required is the message itself for a mention: writing
     * «@علی لطفاً دیتاشیت را چک کن» *is* the request, and a second copy of it
     * in a field of its own is a second thing to keep in step.
     */
    const requests: {
      assignedToUserId: string | null;
      assignedToName: string | null;
      actionRequired: string;
    }[] = mentioned.map((u) => ({
      assignedToUserId: u.id,
      assignedToName: u.fullName,
      actionRequired: text,
    }));

    if (input.referral?.actionRequired) {
      const explicitId = toNullableString(input.referral.assignedToUserId, 36);
      // Not twice for the same person: a caller that both mentions somebody
      // and sends the old shape is asking once.
      if (!explicitId || !requests.some((r) => r.assignedToUserId === explicitId)) {
        requests.push({
          assignedToUserId: explicitId,
          assignedToName: toNullableString(input.referral.assignedToName, 200),
          actionRequired: toNullableString(input.referral.actionRequired)!,
        });
      }
    }

    const created = [];
    for (const request of requests) {
      created.push(await tx.projectReferral.create({
        data: {
          activityId: activity.id,
          assignedToUserId: request.assignedToUserId,
          assignedToName: request.assignedToName,
          assignedByUserId: user.id,
          assignedByName: author?.fullName ?? null,
          actionRequired: request.actionRequired,
        } as Prisma.ProjectReferralUncheckedCreateInput,
      }));
    }

    return {
      created,
      activity: await tx.projectActivity.findUnique({
        where: { id: activity.id },
        include: ACTIVITY_INCLUDE,
      }),
    };
  });

  /*
   * Told after the write, and never allowed to fail it.
   *
   * Somebody named in a message has been asked to do something and has no
   * reason to be looking at that project's feed; the notice is what makes a
   * mention worth anything. `afterCommit` logs and swallows, like every other
   * side effect here.
   */
  await afterCommit("activity mentions", async () => {
    for (const referral of result.created) {
      if (referral.assignedToUserId) {
        await notifyUser({
          userId: referral.assignedToUserId,
          module: "ارجاعات",
          title: "ارجاع جدید",
          description: `${author?.fullName ?? "یک همکار"} شما را در پروژه ${
            group.project.code ?? ""} نام برد: ${referral.actionRequired}`,
          projectId: group.project.id,
          actorUserId: user.id,
        });
      }

      await processWorkflowRules(
        "referral_created",
        {
          referralId: referral.id,
          projectId: group.project.id,
          assignedToUserId: referral.assignedToUserId,
          assignedToName: referral.assignedToName,
          actionRequired: referral.actionRequired,
        },
        user,
      );
    }
  });

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
  /**
   * The files the entry should now have. Absent means "not edited" — the same
   * rule the line-item grids follow, and for the same reason: a caller that
   * only renames the text must not silently drop what is attached to it.
   */
  attachments?: ActivityAttachment[] | undefined,
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

  await db.projectActivity.update({
    where: { id },
    data: {
      text: trimmed,
      ...(attachments === undefined
        ? {}
        : attachmentColumns(normalizeAttachments(attachments))),
    },
  });
  return {
    activity: await db.projectActivity.findUnique({
      where: { id },
      include: ACTIVITY_INCLUDE,
    }),
  };
}

/**
 * Removes an activity.
 *
 * Only its author, and only while nothing has been said back — once any
 * referral on it has answers, or somebody has replied to the message, deleting
 * it would leave a thread quoting something that is no longer there.
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
      referrals: { select: { id: true, _count: { select: { messages: true } } } },
      _count: { select: { replies: true } },
    },
  });
  if (!activity) return "not-found";
  if (activity.authorUserId !== user.id && !user.isSystemAdmin) return "forbidden";
  // Any answered referral, or any reply to the message itself. `replyToId` is
  // NoAction precisely so the database cannot quietly take the answers too.
  if (activity.referrals.some((r) => r._count.messages > 0)) return "has-replies";
  if (activity._count.replies > 0) return "has-replies";

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
  /**
   * Set when a reply was posted in the same action, which has already told the
   * other party — and told them the part that matters, the message itself. The
   * bare "so-and-so reopened it" on top of that says the same thing twice. Same
   * reasoning as `andForwarded` on a reply.
   */
  options: { silent?: boolean } = {},
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
  if (oldStatus !== newStatus && !options.silent) {
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

/**
 * Corrects what a referral is asking for.
 *
 * A referral is a request somebody typed, and the first version of it is
 * routinely wrong — a tag number transposed, a deadline that moved, a sentence
 * that reads two ways. There was no way to change it: the only recourse was to
 * cancel the referral and raise another, which loses the thread.
 *
 * Only the person who **raised** it may edit, because it is their request; the
 * assignee answers it and says what they think in the thread. Everything said
 * so far stays exactly where it is, and the assignee is told the request moved
 * — a silently rewritten request is worse than none.
 */
export async function updateReferralAction(
  id: string,
  actionRequired: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found" | "invalid"> {
  const db = getDb();
  const text = toNullableString(actionRequired);
  if (!text) return "invalid";

  const referral = await db.projectReferral.findUnique({
    where: { id },
    select: {
      id: true, actionRequired: true, assignedToUserId: true, assignedByUserId: true,
      activity: { select: { group: { select: { project: { select: { id: true, name: true, code: true } } } } } },
    },
  });
  if (!referral) return "not-found";

  // Not `involved`: the assignee changing what was asked of them is how a
  // referral comes to be marked done against a request nobody made.
  if (referral.assignedByUserId !== user.id && !user.isSystemAdmin) return "forbidden";
  if (referral.actionRequired === text) return "ok";

  await db.projectReferral.update({ where: { id }, data: { actionRequired: text } });

  if (referral.assignedToUserId && referral.assignedToUserId !== user.id) {
    const actor = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    const project = referral.activity?.group?.project;
    const where = project ? ` در پروژه ${project.name}${project.code ? ` (${project.code})` : ""}` : "";
    await notifyUser({
      userId: referral.assignedToUserId,
      module: "ارجاعات",
      title: "ویرایش متن ارجاع",
      description: `${actor?.fullName ?? "یک همکار"} متن ارجاع${where} را ویرایش کرد: ${text}`,
      projectId: project?.id ?? null,
      actorUserId: user.id,
    });
  }

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

  // A note written on a document belongs on that project's timeline too — the
  // agreement a salesperson records under a proforma is exactly the kind of
  // thing somebody reading the project's history needs, and it was visible
  // only to whoever opened that one document.
  await afterCommit("module note timeline entry", () =>
    logNoteOnTimeline(entityType, entityId, trimmed, user));

  return { note };
}

/** Which document a note is on, and where its project's timeline is. */
const NOTE_SUBJECTS: Record<string, {
  category: string;
  find: (id: string) => Promise<{ projectId: string | null; label: string } | null>;
}> = {
  proforma: {
    category: ACTIVITY_CATEGORY.PROFORMAS,
    find: async (id) => {
      const row = await getDb().proforma.findUnique({
        where: { id }, select: { projectId: true, proformaNumber: true },
      });
      return row && { projectId: row.projectId, label: `پیش‌فاکتور شماره ${row.proformaNumber}` };
    },
  },
  purchaseOrder: {
    category: ACTIVITY_CATEGORY.PURCHASE_ORDERS,
    find: async (id) => {
      const row = await getDb().purchaseOrder.findUnique({
        where: { id }, select: { projectId: true, poNumber: true },
      });
      return row && { projectId: row.projectId, label: `سفارش خرید شماره ${row.poNumber}` };
    },
  },
  packagingDelivery: {
    category: ACTIVITY_CATEGORY.DELIVERIES,
    find: async (id) => {
      const row = await getDb().packagingDelivery.findUnique({
        where: { id }, select: { projectId: true, packingListNumber: true },
      });
      return row && { projectId: row.projectId, label: `پکینگ‌لیست شماره ${row.packingListNumber}` };
    },
  },
};

async function logNoteOnTimeline(
  entityType: string,
  entityId: string,
  text: string,
  user: AuthUser,
): Promise<void> {
  const subject = NOTE_SUBJECTS[entityType];
  if (!subject) return;

  const found = await subject.find(entityId);
  // No project means no timeline to write on, which is the ordinary case for a
  // document raised outside a job.
  if (!found?.projectId) return;

  await logProjectFact(
    {
      projectId: found.projectId,
      categoryName: subject.category,
      sourceType: "NOTE",
      sourceId: entityId,
      text: `یادداشت {actor} روی ${found.label}: «${text}»`,
    },
    user,
    getTodayShamsi(),
  );
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
