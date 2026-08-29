import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter, jalaliToDate, normalizeJalali } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";
import { scrubProductRefs } from "../refIntegrity";
import { summarizeProject, summarizeProjects } from "./projectSummary";
// The custom-field clause is identical for every module; defined once with customers.
import { customFieldClause } from "./customerService";
import { logAction } from "./auditService";
import { runMilestoneRules } from "./milestoneAutomation";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";

/**
 * Project data access.
 *
 * Projects are the sales opportunities the whole app hangs off, so this is the
 * busiest list in the system and the one that made the in-memory client model
 * untenable. Every read is a page; the requested-items and milestones grids are
 * written with their parent inside one transaction.
 */

export const PROJECT_SORTABLE = [
  "code", "name", "status", "creationDate", "expectedCloseDate",
  "estimatedValueRial", "createdAt", "updatedAt",
] as const;

export const PROJECT_FILTERABLE = [
  "status", "customerId", "ownerUserId", "marketingChannel", "leadQuality",
] as const;

const SEARCH_FIELDS = [
  "code", "name", "description", "customerInquiryNumber", "referrerName",
] as const;

/** Business dates on a project, each stored as a DATE + Jalali string pair. */
export const PROJECT_DATE_FIELDS = [
  "creationDate", "opportunityDate", "expectedCloseDate",
  "winningDate", "agreedDeliveryDate", "closingDate",
] as const;

/**
 * Restricts a query to what `user` may see. Same rule as customers: the module
 * permission grants the whole module, otherwise only owned records — expressed
 * as a clause so pagination totals cannot leak records outside the scope.
 */
export function visibilityClause(user: AuthUser): Record<string, unknown> | undefined {
  if (hasPermission(user, "projects")) return undefined;
  return { ownerUserId: user.id };
}

/** Exported so the visibility rules can be asserted without a database. */
export function buildProjectWhere(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown; customField?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  if (q.search) {
    // The grid's search box also matches a customer's name and an equipment tag
    // number, neither of which is a column on the project.
    const own = searchClause(q.search, SEARCH_FIELDS);
    const byCustomer = searchClause(q.search, ["companyName"]);
    const byItem = searchClause(q.search, ["tagNumber", "name", "equipmentType"]);

    const alternatives: Record<string, unknown>[] = [];
    if (own) alternatives.push(...own.OR);
    if (byCustomer) alternatives.push({ customer: byCustomer });
    if (byItem) alternatives.push({ items: { some: byItem } });
    if (alternatives.length > 0) and.push({ OR: alternatives });
  }

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  // Custom fields live in the customValues JSON column; same rules and the same
  // caveats as customers — see customFieldClause there.
  const specs = Array.isArray(extra.customField) ? extra.customField : [extra.customField];
  for (const entry of specs) {
    if (typeof entry !== "string") continue;
    for (const spec of entry.split("|")) {
      const clause = customFieldClause(spec);
      if (clause) and.push(clause);
    }
  }

  // Date range comes from Shamsi inputs but filters the real DATE column, so a
  // range works correctly across month and year boundaries.
  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ creationDate: range });

  return and.length === 0 ? {} : { AND: and };
}

/** List columns. The grids need the customer's name, so it is joined, not stored. */
const LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  customerId: true,
  creationDate: true,
  creationDateJalali: true,
  expectedCloseDate: true,
  expectedCloseDateJalali: true,
  winningDateJalali: true,
  opportunityDateJalali: true,
  agreedDeliveryDateJalali: true,
  estimatedValueRial: true,
  probabilityPercent: true,
  marketingChannel: true,
  leadQuality: true,
  salesExpert: true,
  messagingContactId: true,
  messagingChannel: true,
  suppressAutoMessages: true,
  ownerUserId: true,
  createdAt: true,
  // Printed on the grid row or in the Excel export, and none of it used to
  // arrive: the reason a lost project was lost, the customer's own inquiry
  // number, who referred it, how they were reached, the three named contacts,
  // the closing date, and the custom-field column.
  lossReason: true,
  closingDateJalali: true,
  communicationMethod: true,
  customerInquiryNumber: true,
  referrerName: true,
  endUser: true,
  financialContact: true,
  technicalContact: true,
  customValues: true,
  customer: { select: { id: true, companyName: true } },
  owner: { select: { id: true, fullName: true } },
  // `categoryGroups` is a filtered relation count: how many activity categories
  // are currently in progress on the project, which the grid shows as a pulse on
  // the row. The browser used to derive it by holding every category group.
  _count: {
    select: {
      items: true,
      proformas: true,
      categoryGroups: { where: { status: "جاری" } },
    },
  },
} satisfies Prisma.ProjectSelect;

export async function listProjects(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown; withSummary?: boolean; customField?: unknown } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const where = buildProjectWhere(q, user, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.project.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.project.count({ where }),
  ]);

  // The grid's derived columns — pipeline value, prepayment date, agreed versus
  // actual delivery. Computed for the whole page in three queries; the client
  // used to derive them by scanning four whole collections once per row.
  if (extra.withSummary !== false && rows.length > 0) {
    const summaries = await summarizeProjects(rows.map((r) => ({
      id: r.id,
      creationDateJalali: r.creationDateJalali,
      winningDateJalali: r.winningDateJalali,
      opportunityDateJalali: r.opportunityDateJalali,
      agreedDeliveryDateJalali: r.agreedDeliveryDateJalali,
    })));
    const withSummary = rows.map((row) => ({ ...row, summary: summaries.get(row.id) ?? null }));
    return buildResult(withSummary as unknown as Record<string, unknown>[], total, q);
  }

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

/**
 * Full record with its children and its derived figures, for the detail view.
 * Null when the caller may not see it.
 */
export async function getProject(id: string, user: AuthUser) {
  const project = await getProjectRecord(id, user);
  if (!project) return null;
  return { ...project, summary: await summarizeProject(id) };
}

/** The stored record alone, without the derived figures. */
async function getProjectRecord(id: string, user: AuthUser) {
  const db = getDb();
  const visibility = visibilityClause(user);

  return db.project.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    include: {
      customer: { select: { id: true, companyName: true, customerType: true } },
      owner: { select: { id: true, fullName: true } },
      // The two key people are individuals, whose name lives in first/last —
      // selecting only `companyName` gave the panel a blank to render.
      endUserCustomer: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      financialContactCustomer: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      technicalContactCustomer: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      items: { orderBy: { lineNo: "asc" } },
      milestones: { orderBy: { lineNo: "asc" } },
      categoryGroups: {
        orderBy: { createdAt: "asc" },
        include: {
          activities: {
            orderBy: { createdAt: "desc" },
            include: {
              // A message may name several colleagues, and each is its own request.
              referrals: {
                orderBy: { createdAt: "asc" },
                include: { messages: { orderBy: { createdAt: "asc" } } },
              },
              replyTo: { select: { id: true, text: true, authorName: true, createdAt: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Aggregate figures for the dashboard, computed in SQL.
 *
 * The client used to derive these by looping every project it had loaded, which
 * is both a full table read and wrong as soon as pagination hides rows.
 */
/**
 * Every visible project's id and status, and nothing else.
 *
 * Deliberately unpaginated, and deliberately not reusing `listProjects`: the
 * caller watches for a project becoming won, so it has to see all of them at
 * once — a page would make the prompt depend on which page happened to be
 * loaded. Two short columns per project keeps that affordable where a page of
 * full rows would not be.
 *
 * Visibility is applied in the query, so a restricted user is not told that
 * projects they cannot see exist.
 */
export async function listProjectStatuses(
  user: AuthUser,
): Promise<{ id: string; status: string }[]> {
  const visibility = visibilityClause(user);
  return getDb().project.findMany({
    where: visibility ?? {},
    select: { id: true, status: true },
  });
}

export async function projectSummary(user: AuthUser) {
  const db = getDb();
  const visibility = visibilityClause(user);
  const where = visibility ?? {};

  const [byStatus, totals] = await Promise.all([
    db.project.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { estimatedValueRial: true } }),
    db.project.aggregate({ where, _count: { _all: true }, _sum: { estimatedValueRial: true } }),
  ]);

  return {
    total: totals._count._all,
    totalEstimatedValueRial: totals._sum.estimatedValueRial?.toString() ?? "0",
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: s._count._all,
      estimatedValueRial: s._sum.estimatedValueRial?.toString() ?? "0",
    })),
  };
}

/* --------------------------------- writes --------------------------------- */

export interface ProjectItemInput {
  productId?: string | null;
  variantId?: string | null;
  name?: string;
  quantity?: unknown;
  supplyMethod?: string | null;
  category?: string | null;
  equipmentType?: string | null;
  size?: string | null;
  tagNumber?: string | null;
}

export interface ProjectMilestoneInput {
  /** The row's own id, when it is an existing one — see `syncMilestones`. */
  id?: string | null;
  name?: string;
  isCompleted?: boolean;
  completedAt?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  triggerType?: string | null;
  triggerCategoryName?: string | null;
}

/** Scalar columns a client may set, before date expansion. */
export interface ProjectScalarInput {
  code?: string;
  name?: string;
  customerId?: string;
  status?: string;
  lossReason?: string | null;
  description?: string | null;
  estimatedValueRial?: unknown;
  probabilityPercent?: unknown;
  marketingChannel?: string | null;
  leadQuality?: string | null;
  referrerName?: string | null;
  communicationMethod?: string | null;
  customerInquiryNumber?: string | null;
  salesExpert?: string | null;
  /** Who to write to about this job, and how — see the messaging module. */
  messagingContactId?: string | null;
  messagingChannel?: string | null;
  suppressAutoMessages?: boolean;
  financialContact?: string | null;
  technicalContact?: string | null;
  endUser?: string | null;
  ownerUserId?: string | null;
  endUserCustomerId?: string | null;
  financialContactId?: string | null;
  technicalContactId?: string | null;
  attachments?: unknown;
  manualDocuments?: unknown;
  milestoneRules?: unknown;
  customValues?: unknown;
}

export interface ProjectInput extends ProjectScalarInput {
  /** Shamsi strings; expanded into DATE + Jalali column pairs. */
  creationDate?: string | null;
  opportunityDate?: string | null;
  expectedCloseDate?: string | null;
  winningDate?: string | null;
  agreedDeliveryDate?: string | null;
  closingDate?: string | null;
  items?: ProjectItemInput[];
  milestones?: ProjectMilestoneInput[];
}

/** Maps the scalar half of an input to Prisma column values. */
function scalarData(input: ProjectInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };

  if ("code" in input) set("code", toNullableString(input.code, 60));
  if ("name" in input) set("name", toNullableString(input.name, 400));
  if ("customerId" in input) set("customerId", input.customerId);
  if ("status" in input) set("status", toNullableString(input.status, 50));
  if ("lossReason" in input) set("lossReason", toNullableString(input.lossReason, 300));
  if ("description" in input) set("description", toNullableString(input.description));
  if ("estimatedValueRial" in input) {
    set("estimatedValueRial", input.estimatedValueRial == null || input.estimatedValueRial === ""
      ? null : toNumber(input.estimatedValueRial));
  }
  if ("probabilityPercent" in input) {
    set("probabilityPercent", input.probabilityPercent == null || input.probabilityPercent === ""
      ? null : Math.round(toNumber(input.probabilityPercent)));
  }
  if ("marketingChannel" in input) set("marketingChannel", toNullableString(input.marketingChannel, 150));
  if ("leadQuality" in input) set("leadQuality", toNullableString(input.leadQuality, 100));
  if ("referrerName" in input) set("referrerName", toNullableString(input.referrerName, 200));
  if ("communicationMethod" in input) set("communicationMethod", toNullableString(input.communicationMethod, 100));
  if ("customerInquiryNumber" in input) set("customerInquiryNumber", toNullableString(input.customerInquiryNumber, 100));
  if ("salesExpert" in input) set("salesExpert", toNullableString(input.salesExpert, 200));
  if ("messagingContactId" in input) set("messagingContactId", toNullableString(input.messagingContactId, 36));
  if ("messagingChannel" in input) set("messagingChannel", toNullableString(input.messagingChannel, 20));
  if ("suppressAutoMessages" in input) set("suppressAutoMessages", !!input.suppressAutoMessages);
  if ("financialContact" in input) set("financialContact", toNullableString(input.financialContact, 200));
  if ("technicalContact" in input) set("technicalContact", toNullableString(input.technicalContact, 200));
  if ("endUser" in input) set("endUser", toNullableString(input.endUser, 200));
  if ("ownerUserId" in input) set("ownerUserId", toNullableString(input.ownerUserId, 36));
  if ("endUserCustomerId" in input) set("endUserCustomerId", toNullableString(input.endUserCustomerId, 36));
  if ("financialContactId" in input) set("financialContactId", toNullableString(input.financialContactId, 36));
  if ("technicalContactId" in input) set("technicalContactId", toNullableString(input.technicalContactId, 36));
  if ("attachments" in input) set("attachments", toJsonColumn(input.attachments));
  if ("manualDocuments" in input) set("manualDocuments", toJsonColumn(input.manualDocuments));
  if ("milestoneRules" in input) set("milestoneRules", toJsonColumn(input.milestoneRules));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, PROJECT_DATE_FIELDS) };
}

/**
 * What the project form puts in `productId` for a line that describes a
 * requirement rather than a stock item. The column stores NULL for these; the
 * client adapter maps NULL back to this word.
 */
const GENERIC_PRODUCT = "generic";

/** Drops the blank trailing row these grids always carry. */
function mapItem(row: ProjectItemInput): Record<string, unknown> | null {
  const name = toNullableString(row?.name, 400);
  if (!name) return null;
  const productId = toNullableString(row.productId, 36);
  return {
    // "generic" is the form's word for "a requirement, not a catalogue item".
    // `productId` is a real foreign key, so the sentinel has to become NULL —
    // sent through as-is it failed the constraint and the whole save was
    // refused, with a message about the record being referenced elsewhere.
    productId: productId === GENERIC_PRODUCT ? null : productId,
    variantId: toNullableString(row.variantId, 36),
    name,
    quantity: toNumber(row.quantity, 1),
    supplyMethod: toNullableString(row.supplyMethod, 20),
    category: toNullableString(row.category, 30),
    equipmentType: toNullableString(row.equipmentType, 200),
    size: toNullableString(row.size, 100),
    tagNumber: toNullableString(row.tagNumber, 100),
  };
}

function mapMilestone(row: ProjectMilestoneInput): Record<string, unknown> | null {
  const name = toNullableString(row?.name, 300);
  if (!name) return null;
  return {
    name,
    isCompleted: !!row.isCompleted,
    notes: toNullableString(row.notes),
    triggerType: toNullableString(row.triggerType, 30),
    triggerCategoryName: toNullableString(row.triggerCategoryName, 200),
    ...expandDateFields(row as Record<string, unknown>, ["completedAt", "dueDate"]),
  };
}

/**
 * Writes the milestones grid, keeping each row's id.
 *
 * **Not `syncChildren`**, and this is the same rule that keeps product variants
 * out of it: a milestone is *referenced*. The project's automation rules are
 * stored as JSON naming a `triggerMilestoneId`, so delete-and-reinsert handed
 * every milestone a new uuid on every project save and silently detached every
 * rule from its trigger. The panel showed it as «رویداد: اتمام حذف‌شده», and
 * nothing would ever have fired for it again.
 *
 * Rows are matched by id, then — for a row the client invented an id for, which
 * the add form does — by name among the rows not already claimed. Anything left
 * over was removed in the form and is deleted. `lineNo` still records the
 * user's order.
 *
 * Returns the milestones that went from open to completed in this write, which
 * is what the automation runs on.
 */
async function syncMilestones(
  tx: Prisma.TransactionClient,
  projectId: string,
  rows: ProjectMilestoneInput[],
): Promise<{ id: string; name: string }[]> {
  const existing = await tx.projectMilestone.findMany({
    where: { projectId },
    select: { id: true, name: true, isCompleted: true },
  });
  const byId = new Map(existing.map((m) => [m.id, m]));
  const byName = new Map<string, typeof existing[number]>();
  for (const m of existing) if (!byName.has(m.name)) byName.set(m.name, m);

  const seen = new Set<string>();
  const newlyCompleted: { id: string; name: string }[] = [];
  let lineNo = 0;

  for (const row of rows ?? []) {
    const data = mapMilestone(row);
    if (!data) continue; // a blank trailing line
    lineNo++;

    const id = toNullableString(row.id, 36);
    let match = id ? byId.get(id) : undefined;
    if (match && seen.has(match.id)) match = undefined;
    if (!match) {
      const named = byName.get(String(data.name));
      if (named && !seen.has(named.id)) match = named;
    }

    if (match) {
      seen.add(match.id);
      await tx.projectMilestone.update({ where: { id: match.id }, data: { ...data, lineNo } });
      if (!match.isCompleted && data.isCompleted) {
        newlyCompleted.push({ id: match.id, name: String(data.name) });
      }
    } else {
      const fresh = await tx.projectMilestone.create({
        data: { projectId, ...data, lineNo } as Prisma.ProjectMilestoneUncheckedCreateInput,
      });
      seen.add(fresh.id);
      // A milestone created already ticked still counts: the rules the user
      // attached to it are about the checkpoint being reached, not about which
      // save reached it.
      if (data.isCompleted) newlyCompleted.push({ id: fresh.id, name: fresh.name });
    }
  }

  const removed = existing.filter((m) => !seen.has(m.id)).map((m) => m.id);
  if (removed.length > 0) {
    await tx.projectMilestone.deleteMany({ where: { id: { in: removed } } });
  }
  return newlyCompleted;
}

export async function createProject(input: ProjectInput, user: AuthUser, todayJalali: string) {
  const db = getDb();

  const project = await db.$transaction(async (tx) => {
    const data = scalarData(input) as Prisma.ProjectUncheckedCreateInput;

    // Default creationDate to today if not provided
    if (!data.creationDate) {
      const today = jalaliToDate(todayJalali) ?? new Date();
      data.creationDate = today;
      data.creationDateJalali = normalizeJalali(todayJalali);
    }

    const project = await tx.project.create({
      data: {
        ...data,
        // Ownership defaults to the creator so record-level rules have a subject.
        ownerUserId: input.ownerUserId ?? user.id,
      } as Prisma.ProjectUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.projectItem, parentWhere: { projectId: project.id },
      rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapItem,
    });
    await syncMilestones(tx, project.id, input.milestones ?? []);

    return project;
  });

  // Audit log
  await logAction(
    {
      action: "CREATE",
      module: "پروژه‌ها",
      entityId: project.id,
      description: `ایجاد پروژه جدید: ${project.name || project.code || project.id}`,
      afterState: project,
    },
    user,
    todayJalali,
  );

  // Notification
  await notifyModuleResponsible(
    "projects",
    "ثبت پروژه جدید",
    `پروژه جدید ثبت شد: ${project.name || project.code || project.id}`,
    user,
    project.id,
  );

  // Workflow trigger
  await processWorkflowRules(
    "project_created",
    {
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      customerId: project.customerId,
      salesExpert: project.ownerUserId,
      status: project.status,
    },
    user,
  );

  // The full record, not the bare row: the client's `detailToProject` reads
  // `items` and `milestones` unguarded, so answering with the row threw in the
  // browser after the project had already been written.
  return getProjectRecord(project.id, user);
}

export async function updateProject(id: string, input: ProjectInput, user: AuthUser, todayJalali: string) {
  const db = getDb();
  const visibility = visibilityClause(user);

  // Get before state for audit log
  const before = await db.project.findUnique({ where: { id } });
  if (!before) return null;

  /*
   * Checkpoints ticked by this save, collected inside the transaction and acted
   * on after it commits. The tasks and notices a rule raises are separate
   * records: one that cannot be created must not roll back the tick itself.
   */
  let completedNow: { id: string; name: string }[] = [];

  const project = await db.$transaction(async (tx) => {
    // Re-check visibility inside the transaction, before anything is written.
    const existing = await tx.project.findFirst({
      where: visibility ? { AND: [{ id }, visibility] } : { id },
      select: { id: true },
    });
    if (!existing) return null;

    const project = await tx.project.update({
      where: { id },
      data: scalarData(input) as Prisma.ProjectUncheckedUpdateInput,
    });

    // Absent means "not edited"; an empty array means "the user removed them all".
    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.projectItem, parentWhere: { projectId: id },
        rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapItem,
      });
    }
    if (input.milestones !== undefined) {
      completedNow = await syncMilestones(tx, id, input.milestones);
    }

    return project;
  });

  if (!project) return null;

  // Audit log
  await logAction(
    {
      action: "UPDATE",
      module: "پروژه‌ها",
      entityId: id,
      description: `ویرایش پروژه: ${project.name || project.code || id}`,
      beforeState: before,
      afterState: project,
    },
    user,
    todayJalali,
  );

  // The project's own automation: a checkpoint reached raises what the user
  // attached to it. Fires only for the ones that changed in this save.
  await runMilestoneRules(id, completedNow, user, todayJalali);

  // Workflow trigger for status change
  if (before.status !== project.status) {
    await processWorkflowRules(
      "project_status_change",
      {
        projectId: project.id,
        projectName: project.name,
        projectCode: project.code,
        customerId: project.customerId,
        oldStatus: before.status,
        newStatus: project.status,
        status: project.status,
      },
      user,
    );
  }

  return getProjectRecord(project.id, user);
}

/** Records that would block deleting a project, for the confirmation dialog. */
export async function countProjectReferences(id: string) {
  const db = getDb();
  const [proformas, purchaseOrders, transactions, inquiries, deliveries, services] =
    await Promise.all([
      db.proforma.count({ where: { projectId: id } }),
      db.purchaseOrder.count({ where: { projectId: id } }),
      db.transaction.count({ where: { projectId: id } }),
      db.supplierInquiry.count({ where: { projectId: id } }),
      db.packagingDelivery.count({ where: { projectId: id } }),
      db.afterSalesService.count({ where: { projectId: id } }),
    ]);
  const total = proformas + purchaseOrders + transactions + inquiries + deliveries + services;
  return { proformas, purchaseOrders, transactions, inquiries, deliveries, services, total };
}

/**
 * Deletes a project. Items, milestones and category groups cascade with it;
 * anything else (proformas, orders, transactions) does not, and blocks the
 * delete instead — losing a proforma because its project was removed would be
 * silent data loss.
 */
export async function deleteProject(id: string, user: AuthUser, todayJalali: string): Promise<"ok" | "forbidden" | "in-use"> {
  const db = getDb();
  const visibility = visibilityClause(user);
  if (visibility) {
    const allowed = await db.project.findFirst({
      where: { AND: [{ id }, visibility] }, select: { id: true },
    });
    if (!allowed) return "forbidden";
  }

  const refs = await countProjectReferences(id);
  if (refs.total > 0) return "in-use";

  // Get project info for audit log before deletion
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return "ok";

  await db.project.delete({ where: { id } });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "پروژه‌ها",
      entityId: id,
      description: `حذف پروژه: ${project.name || project.code || id}`,
      beforeState: project,
    },
    user,
    todayJalali,
  );

  return "ok";
}
