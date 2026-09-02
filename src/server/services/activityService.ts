import { Prisma } from "@prisma/client";
import { parseMentions } from "../../utils/mentions";
import { isAllowedReaction } from "../../utils/reactions";
import {
  MovableLane, REFERRAL_DOING, REFERRAL_DONE, REFERRAL_PENDING, referralLane, referralStatusForLane,
} from "../../utils/workBoard";
import {
  activityRecipients, noticeExcerpt, parseMemberIds, serializeMemberIds,
} from "../../utils/activityMembers";
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
import { capacityRefusalMessage } from "../../utils/workLimits";
import { MoveOutcome } from "./taskService";
import { capacityByUser } from "./workLoadService";

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

  /*
   * Two orders, deliberately opposite, and neither is the other's default.
   *
   * **Messages read oldest first**, so the newest sits at the bottom, directly
   * above the box you reply in — the order every messenger uses, and the one a
   * conversation is written in. Reversed, a reply appears above the message it
   * answers.
   *
   * **Categories read newest first**, because they are not a conversation: they
   * are the parallel strands of work on a job, and the one somebody opened most
   * recently is the one being worked. An old finished category should not sit
   * between you and it.
   *
   * The screen renders this order as it arrives and the composer is drawn below
   * the list, so the two together are what put the newest message beside the
   * reply box. `test:rules` pins both, because flipping one back is a one-word
   * edit that nothing else would notice.
   */
  return db.projectCategoryGroup.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      activities: {
        orderBy: { createdAt: "asc" },
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
  /**
   * The people who follow this conversation.
   *
   * **Absent means «not edited»**, the same distinction `syncChildren` draws
   * and for a sharper reason here: this function is also what the date editors
   * and the «اتمام کار» / «به جریان انداختن مجدد» buttons call, and none of
   * them sends a member list. Reading absent as «nobody» would silently empty
   * the membership every time somebody closed a category.
   *
   * An empty array is a real answer and does clear it.
   */
  memberUserIds?: string[];
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

  /*
   * Only real, active accounts are stored.
   *
   * An id naming nobody would raise a notice into a void on every message for
   * ever, and no screen would ever show that. Absent leaves the column alone —
   * see `CategoryGroupInput.memberUserIds`.
   */
  let members: { memberUserIds: string | null } | Record<string, never> = {};
  if (input.memberUserIds !== undefined) {
    const directory = await db.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    members = { memberUserIds: serializeMemberIds(input.memberUserIds, directory) };
  }

  const data = {
    status,
    categoryName: toNullableString(input.categoryName, 200)!,
    ...dates,
    ...members,
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
  /*
   * The reactions travel with the feed; the readers do not.
   *
   * A chip row has to be drawn for every message on screen, so its rows come
   * with the fetch — they are three short columns and there are a handful per
   * message. «چه کسانی دیده‌اند» is a **count** here and a list only when the
   * eye is pressed (`listActivityReaders`): in a team of twenty, every reader
   * of every message would be the largest thing in the response and nobody is
   * looking at more than one of them at a time.
   */
  reactions: {
    orderBy: { createdAt: "asc" },
    select: { emoji: true, userId: true, userName: true },
  },
  _count: { select: { reads: true } },
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
    select: {
      id: true,
      categoryName: true,
      memberUserIds: true,
      project: { select: { id: true, code: true, ownerUserId: true } },
    },
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
  /*
   * The requests on the message being answered that belong to this author.
   *
   * Replying to a message you were named in *is* answering the referral — the
   * feed no longer draws a box with its own compose field, because the message
   * and the mention already say everything the box repeated. So the reply is
   * mirrored into the referral's thread and the request is marked as picked up:
   * the inbox, the board and whoever raised it all read the same conversation
   * whichever screen it was written from.
   */
  let answering: { id: string; status: string; assignedToUserId: string | null }[] = [];
  const requestedReply = toNullableString(input.replyToId, 36);
  if (requestedReply) {
    const parent = await db.projectActivity.findFirst({
      where: { id: requestedReply, groupId: input.groupId },
      select: {
        id: true,
        /*
         * Either party, not only the assignee: whoever raised the request reads
         * the answer in the feed and says «این آن چیزی نیست که خواستم» there,
         * and that belongs in the thread as much as the answer does. Only the
         * assignee replying moves the status, though — somebody chasing their
         * own request has not picked anything up.
         */
        referrals: {
          where: {
            status: { not: REFERRAL_DONE },
            OR: [{ assignedToUserId: user.id }, { assignedByUserId: user.id }],
          },
          select: { id: true, status: true, assignedToUserId: true },
        },
      },
    });
    replyToId = parent?.id ?? null;
    answering = parent?.referrals ?? [];
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

    /*
     * The same words, into the thread of every request being answered.
     *
     * In the same transaction as the message: a reply that reached the feed and
     * not the referral would leave the person who asked looking at «در انتظار
     * اقدام» under a message that plainly answers them. `startedAt` is stamped
     * once and never cleared, the same rule `setReferralStatus` follows.
     */
    for (const request of answering) {
      await tx.referralMessage.create({
        data: {
          referralId: request.id,
          text,
          responderUserId: user.id,
          responderName: author?.fullName ?? null,
        } as Prisma.ReferralMessageUncheckedCreateInput,
      });
      if (request.assignedToUserId === user.id && request.status !== REFERRAL_DOING) {
        await tx.projectReferral.update({
          where: { id: request.id },
          data: { status: REFERRAL_DOING, startedAt: new Date() },
        });
      }
    }

    return {
      created,
      answered: answering,
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
    /*
     * Whoever asked, told that they have been answered.
     *
     * The message's own notices reach the people the *category* follows and the
     * people it names — and the person who raised the referral is usually
     * neither, so without this the answer would be as silent as it was before
     * a reply notified anybody at all. Same shape as `addReferralMessage`.
     */
    for (const request of result.answered) {
      const parties = await db.projectReferral.findUnique({
        where: { id: request.id },
        select: { assignedByUserId: true, assignedToUserId: true },
      });
      // The counterpart, whichever side wrote. `notifyUser` refuses to notify
      // the author anyway, but working it out here keeps the message honest.
      const counterpart = user.id === parties?.assignedByUserId
        ? parties?.assignedToUserId
        : parties?.assignedByUserId;
      if (counterpart) {
        await notifyUser({
          userId: counterpart,
          module: "ارجاعات",
          title: "پاسخ جدید به ارجاع",
          description:
            `${author?.fullName ?? "یک همکار"} به ارجاع در پروژه ${
              group.project.code ?? ""} پاسخ داد: ` +
            (text.length > 160 ? `${text.slice(0, 160)}…` : text),
          projectId: group.project.id,
          actorUserId: user.id,
        });
      }
    }

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

  /*
   * And the people who follow this category, whom nobody named.
   *
   * The quieter half of the messenger: «the shipment cleared customs» is worth
   * knowing to the three people working the job and is not a request to any of
   * them. `activityRecipients` is the rule — never the author, never somebody
   * the message named (their referral notice already says more), never an
   * account that has since been deactivated.
   *
   * Its own `afterCommit` rather than the block above: a failure here must not
   * stop the mention notices, which are the ones somebody is waiting on.
   */
  await afterCommit("activity group members", async () => {
    const members = parseMemberIds(group.memberUserIds);
    if (!members.length) return;

    // Asked for by id, so a deactivated account drops out even though the
    // stored list still carries it.
    const active = await db.user.findMany({
      where: { id: { in: members }, isActive: true },
      select: { id: true },
    });

    const recipients = activityRecipients({
      memberUserIds: members,
      authorUserId: user.id,
      mentionedUserIds: mentioned.map((u) => u.id),
      directory: active,
    });

    for (const userId of recipients) {
      await notifyUser({
        userId,
        module: "فعالیت‌ها",
        title: `پیام جدید در ${group.categoryName}`,
        description: `${author?.fullName ?? "یک همکار"} در پروژه ${
          group.project.code ?? ""} نوشت: ${noticeExcerpt(text)}`,
        projectId: group.project.id,
        actorUserId: user.id,
      });
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
    select: { id: true, authorUserId: true, text: true },
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

  /*
   * The requests the message raised say the same thing it does.
   *
   * A mention's `actionRequired` *is* the message — one text, not two that
   * drift apart — but editing the message only rewrote one of the copies, so
   * the inbox went on quoting a sentence the feed no longer contains. That was
   * survivable while the feed drew the referral's own text beside it and is not
   * now: the feed shows only a status label, so a divergence is invisible.
   *
   * Only where the copy still matches what was there. A referrer who corrected
   * the request through `updateReferralAction` said something deliberate, and
   * this must not quietly undo it.
   */
  await db.projectReferral.updateMany({
    where: { activityId: id, actionRequired: activity.text },
    data: { actionRequired: trimmed },
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

/* ==================== reactions and read receipts ======================== */

/**
 * The ids of the activities among these that the caller may actually see.
 *
 * Reactions and read receipts are written by id from a browser, so the scope
 * has to be re-derived from the record rather than trusted: an id from another
 * project would otherwise let somebody stamp a message they cannot read — and,
 * through the eye, learn who is working on a job they have no access to.
 *
 * One query for the whole batch, since the read receipts arrive a screenful at
 * a time.
 */
async function visibleActivityIds(ids: string[], user: AuthUser): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db.projectActivity.findMany({
    where: canSeeProjects(user)
      ? { id: { in: ids } }
      : { AND: [{ id: { in: ids } }, { group: { project: { ownerUserId: user.id } } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Adds this person's reaction to a message, or takes it away again.
 *
 * A toggle, because that is what pressing the same button twice means
 * everywhere else — and it is a real insert or delete against the unique index
 * on `(activityId, userId, emoji)`, so two people reacting in the same instant
 * cannot lose each other's, which a JSON column on the message would.
 *
 * The emoji is checked against the allowlist on the way in: it is rendered on
 * everybody else's screen, so a free-text column here is a free-text column
 * there. The check guards **creation** only — see `isAllowedReaction`.
 */
export async function toggleActivityReaction(
  activityId: string,
  emoji: string,
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "invalid" | { reactions: unknown[] }> {
  if (!isAllowedReaction(emoji)) return "invalid";

  const db = getDb();
  const activity = await db.projectActivity.findUnique({
    where: { id: activityId },
    select: { id: true, group: { select: { project: { select: { ownerUserId: true } } } } },
  });
  if (!activity) return "not-found";
  if (!canSeeProjects(user) && activity.group.project.ownerUserId !== user.id) return "forbidden";

  const existing = await db.activityReaction.findFirst({
    where: { activityId, userId: user.id, emoji },
    select: { id: true },
  });
  if (existing) {
    await db.activityReaction.delete({ where: { id: existing.id } });
  } else {
    await db.activityReaction.create({
      data: { activityId, userId: user.id, userName: user.fullName ?? null, emoji },
    });
  }

  return {
    reactions: await db.activityReaction.findMany({
      where: { activityId },
      orderBy: { createdAt: "asc" },
      select: { emoji: true, userId: true, userName: true },
    }),
  };
}

/**
 * Records that the caller has seen these messages.
 *
 * **The author is never recorded against their own message.** «چه کسانی دیده‌اند»
 * answers «did this reach anybody», and the person who wrote it is not an answer
 * to that — listing them makes every message look as though it had one reader.
 *
 * Existing receipts are read first and only the difference inserted, rather than
 * `createMany({ skipDuplicates })`, which the SQL Server connector does not
 * support: writing them blind would violate the unique index and fail the whole
 * batch on the second visit to a conversation, which is every visit.
 *
 * Returns how many were newly recorded, so a caller can tell "nothing to do"
 * from "done" — the screen uses it to avoid a pointless refresh.
 */
export async function markActivitiesRead(
  activityIds: string[],
  user: AuthUser,
): Promise<{ recorded: number }> {
  const db = getDb();
  const ids = [...new Set(activityIds.filter((id) => typeof id === "string" && id))].slice(0, 200);
  const visible = await visibleActivityIds(ids, user);
  if (visible.length === 0) return { recorded: 0 };

  const [mine, already] = await Promise.all([
    db.projectActivity.findMany({
      where: { id: { in: visible }, authorUserId: user.id },
      select: { id: true },
    }),
    db.activityRead.findMany({
      where: { activityId: { in: visible }, userId: user.id },
      select: { activityId: true },
    }),
  ]);

  const skip = new Set([...mine.map((r) => r.id), ...already.map((r) => r.activityId)]);
  const fresh = visible.filter((id) => !skip.has(id));
  if (fresh.length === 0) return { recorded: 0 };

  /*
   * Written one at a time and each failure swallowed.
   *
   * Two tabs open on the same conversation race here, and the loser hits the
   * unique index — which is the index doing its job, not an error worth showing
   * somebody who was only reading. A receipt is never worth failing a read over.
   */
  let recorded = 0;
  for (const activityId of fresh) {
    try {
      await db.activityRead.create({
        data: { activityId, userId: user.id, userName: user.fullName ?? null },
      });
      recorded++;
    } catch {
      /* already recorded by another tab */
    }
  }
  return { recorded };
}

/**
 * Who has seen one message, newest first.
 *
 * Fetched when the eye is pressed rather than with the feed: in a team of
 * twenty, every reader of every message would be the largest thing in the
 * response and nobody looks at more than one at a time. The feed carries the
 * count, which is all the icon needs to draw.
 *
 * The **current** name wins over the stored one — a colleague who has been
 * renamed should read under the name they have now — and the stored copy is
 * what answers for an account that has since been removed.
 */
export async function listActivityReaders(
  activityId: string,
  user: AuthUser,
): Promise<"forbidden" | { readers: { userId: string; name: string; readAt: Date }[] }> {
  const db = getDb();
  const visible = await visibleActivityIds([activityId], user);
  if (visible.length === 0) return "forbidden";

  const rows = await db.activityRead.findMany({
    where: { activityId },
    orderBy: { readAt: "desc" },
    select: { userId: true, userName: true, readAt: true },
  });
  if (rows.length === 0) return { readers: [] };

  const directory = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(directory.map((u) => [u.id, u.fullName]));

  return {
    readers: rows.map((row) => ({
      userId: row.userId,
      name: nameOf.get(row.userId) || row.userName || "همکار",
      readAt: row.readAt,
    })),
  };
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
  filters: { mine?: boolean; scope?: "toMe" | "fromMe" | "mine"; open?: boolean } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const and: Record<string, unknown>[] = [];

  if (filters.scope === "fromMe") {
    and.push({ assignedByUserId: user.id });
  } else if (filters.scope === "mine") {
    /*
     * Both directions, which is what a referral being «mine» actually means.
     *
     * A referral belongs to two people exactly as a task does — the one it was
     * given to and the one who gave it — and `visibilityClause` says so for
     * tasks. The sidebar badge asked only for `toMe`, so a request somebody
     * raised and is waiting on sat on their own board and in nobody's count.
     */
    and.push({ OR: [{ assignedToUserId: user.id }, { assignedByUserId: user.id }] });
  } else if (filters.scope === "toMe" || filters.mine || !canSeeProjects(user)) {
    and.push({ assignedToUserId: user.id });
  }
  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }
  /*
   * «still needs action», which is not the same as «در انتظار اقدام».
   *
   * The inbox badge filtered on that exact status, and a referral now has a
   * middle state — so picking one up would have made it vanish from the count
   * of what is on your plate, which reads as the work having gone away. This is
   * written as an exclusion for the same reason `countsTowardBalance` is: a
   * status nobody anticipated must count as open rather than silently close.
   */
  if (filters.open) and.push({ status: { not: REFERRAL_DONE } });

  /*
   * The same box that searches the tasks searches these.
   *
   * A referral is a card on the board beside the tasks, so one search field has
   * to answer for both — and what people type is the job, not the sentence: a
   * project code, a customer, a colleague's name. `actionRequired` is the
   * request itself and the message it was raised from is the text people
   * actually read, so both are matched, and the project and its customer are
   * reached through the relation the same way the transactions ledger does it.
   */
  const search = searchClause(q.search, ["actionRequired", "assignedToName", "assignedByName"]);
  if (search) {
    const term = q.search;
    const activityText = searchClause(term, ["text"]);
    const projectMatch = searchClause(term, ["code", "name"]);
    const customerMatch = searchClause(term, ["companyName"]);
    and.push({
      OR: [
        ...search.OR,
        ...(activityText ? [{ activity: activityText }] : []),
        ...(projectMatch
          ? [{ activity: { group: { project: projectMatch } } }] : []),
        ...(customerMatch
          ? [{ activity: { group: { project: { customer: customerMatch } } } }] : []),
      ],
    });
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
 * Moves several referrals into one column at once.
 *
 * The board's counterpart to `moveTasksToLane`, and it reuses
 * `setReferralStatus` rather than writing the column itself: that function is
 * where the notice to the other party, the start and finish dates and the
 * access check all live, and a second writer would be a second set of rules to
 * keep in step.
 *
 * The notices are **not** suppressed. Somebody who asked for something wants to
 * know it has been picked up, and a batch of three is three people to tell.
 */
export async function moveReferralsToLane(
  ids: string[],
  lane: MovableLane,
  user: AuthUser,
  todayJalali: string,
): Promise<MoveOutcome> {
  const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id))].slice(0, 200);
  let moved = 0;
  let refused = 0;
  const reasons = new Set<string>();

  /*
   * The work-in-progress cap applies here too.
   *
   * A referral picked up is exactly as much of somebody's afternoon as a task
   * picked up, so a limit enforced on one and not the other is a limit that
   * anyone whose work arrives as referrals walks straight past. Read once for
   * the batch and decremented as cards are admitted.
   */
  const assignees = wanted.length > 0 && lane === "DOING"
    ? await getDb().projectReferral.findMany({
      where: { id: { in: wanted } },
      select: { id: true, assignedToUserId: true, assignedToName: true, status: true },
    })
    : [];
  const room = lane === "DOING"
    ? await capacityByUser(
      assignees.map((r) => r.assignedToUserId).filter((id): id is string => !!id), todayJalali)
    : new Map();

  for (const id of wanted) {
    const target = assignees.find((r) => r.id === id);
    // Already in the column: no move, and therefore no capacity consumed.
    if (target && referralLane(target.status) === lane) continue;

    const seat = target?.assignedToUserId ? room.get(target.assignedToUserId) : undefined;
    if (seat && seat.limits.max !== null) {
      if (seat.remaining <= 0) {
        refused++;
        reasons.add(capacityRefusalMessage(
          target?.assignedToName ?? null, seat.active, seat.limits.max, 1,
        ));
        continue;
      }
      seat.remaining -= 1;
    }

    const outcome = await setReferralStatus(id, referralStatusForLane(lane), user);
    if (outcome === "ok") moved++;
    else {
      refused++;
      reasons.add("انتقال بعضی ارجاع‌ها انجام نشد؛ تنها ارجاع‌دهنده و مسئول می‌توانند وضعیت را تغییر دهند.");
    }
  }
  return { moved, refused, reasons: [...reasons] };
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
      startedAt: true,
      activity: { select: { group: { select: { project: { select: { id: true, name: true, code: true } } } } } },
    },
  });
  if (!referral) return "not-found";

  const involved = referral.assignedToUserId === user.id || referral.assignedByUserId === user.id;
  if (!involved && !canSeeProjects(user)) return "forbidden";

  const oldStatus = referral.status;
  const newStatus = toNullableString(status, 40) ?? REFERRAL_PENDING;

  /*
   * The two dates a piece of work has, recorded here because this is the one
   * place a referral's status moves.
   *
   * Same rules as a task (`laneTimestamps`): starting is stamped once and never
   * cleared — the day work began is a fact and a referral handed back and
   * picked up again did not start twice — while a completion date is cleared on
   * reopening, because a date saying it finished is the very claim reopening
   * contradicts.
   */
  const from = referralLane(oldStatus);
  const to = referralLane(newStatus);
  const dates: Record<string, unknown> = {};
  if (from !== to) {
    if (to !== "TODO" && !referral.startedAt) dates.startedAt = new Date();
    dates.completedAt = to === "DONE" ? new Date() : null;
  }

  await db.projectReferral.update({
    where: { id },
    data: { status: newStatus, ...dates },
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
      /*
       * «انجام شده», through the named constant.
       *
       * This compared against «اتمام کار» — which is a *category group's*
       * closing status, from another table entirely — so the true branch could
       * never fire and every completion told the person who raised the referral
       * that it had been **reopened**. Nothing else here reads the value, which
       * is why it went unnoticed.
       */
      const done = referralLane(newStatus) === "DONE";

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
