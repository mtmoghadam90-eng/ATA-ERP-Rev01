import { randomUUID } from "node:crypto";
import { getDb } from "../../db";
import { AuthUser, canSeeCosts, checkKeyAccess } from "../../auth";
import { logAction } from "../auditService";
import { formatMoney } from "../../../numUtils";
import {
  ASSISTANT_ACTIONS, ActionSummaryLine, AssistantActionMeta, AssistantProposal,
  actionLabel, confirmRefusalReason,
} from "../../../utils/assistantActions";
import { COST_SOURCES } from "../../../utils/costOfGoods";
import { createTask, TaskInput } from "../taskService";
import { addActivity, listCategoryGroups } from "../activityService";
import { createProforma, ProformaInput, ProformaItemInput } from "../proformaService";
import { createDelivery, getDeliveryRemaining, DeliveryInput } from "../deliveryService";
import { nextPackingListNumber, nextProformaNumber } from "../../documentNumberSpecs";
import type { ChatToolDefinition } from "./provider";

/**
 * The writes the assistant may propose.
 *
 * Every one of them is two halves. `prepare` reads the database, resolves what
 * the model asked for into a complete, valid write, and describes it in Persian
 * — and touches nothing. `execute` takes that stored payload and calls the very
 * same service the module's own REST route calls, as the confirming user, so
 * record-level visibility, derived status, stock reconciliation, notifications
 * and the audit entry all happen exactly as they do from the screen.
 *
 * Two rules hold the whole thing up:
 *
 *  - **`prepare` never writes and `execute` never re-reads the model's words.**
 *    What is executed is the payload a person approved, not a fresh
 *    interpretation of a sentence.
 *  - **The permission is the module's own.** `permissionKey` is checked with
 *    `checkKeyAccess` at both ends, so the assistant is never a way around a
 *    permission somebody was deliberately not given. It is checked twice
 *    because a permission can be withdrawn between the proposal and the
 *    confirmation, and withdrawing it has to mean something.
 *
 * Document numbers are issued in `execute`, never in `prepare`: a proposal
 * nobody confirms must not burn a number out of the series.
 */

export interface ActionContext {
  user: AuthUser;
  todayJalali: string;
}

/** What `prepare` produces: a card to read, and the write behind it. */
export interface PreparedAction {
  title: string;
  lines: ActionSummaryLine[];
  warnings: string[];
  payload: unknown;
}

export interface AssistantActionImpl extends AssistantActionMeta {
  definition: ChatToolDefinition;
  prepare(args: Record<string, unknown>, ctx: ActionContext): Promise<PreparedAction | { error: string }>;
  execute(payload: unknown, ctx: ActionContext): Promise<{ id: string; label: string }>;
}

/* ------------------------------- helpers -------------------------------- */

const str = (value: unknown): string => String(value ?? "").trim();
const numberOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((r) => r && typeof r === "object") as Record<string, unknown>[] : [];

const isError = (value: unknown): value is { error: string } =>
  !!value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string";

/* -------------------------------- actions -------------------------------- */

const proposeTask: AssistantActionImpl = {
  name: "propose_task",
  label: "ثبت وظیفه",
  permissionKey: "erp_tasks",
  resource: "tasks",
  definition: {
    name: "propose_task",
    description:
      "پیشنهاد ثبت یک وظیفه‌ی جدید. چیزی ثبت نمی‌شود؛ خلاصه‌ای برای تایید کاربر"
      + " ساخته می‌شود. پیش از فراخوانی، عنوان و مهلت را از کاربر بپرس.",
    parameters: object({
      title: { type: "string", description: "عنوان وظیفه" },
      description: { type: "string" },
      dueDate: { type: "string", description: "مهلت انجام، شمسی به شکل YYYY/MM/DD" },
      priority: { type: "string", description: "کم | متوسط | زیاد | فوری" },
      assigneeName: { type: "string", description: "نام کامل کاربری که وظیفه به او سپرده می‌شود" },
      projectId: { type: "string", description: "شناسه پروژه‌ی مرتبط، در صورت وجود" },
    }, ["title"]),
  },

  async prepare(args, ctx) {
    const db = getDb();
    const title = str(args.title);
    if (!title) return { error: "عنوان وظیفه لازم است." };

    const warnings: string[] = [];
    let assigneeId: string | null = null;
    let assigneeName: string | null = null;

    const wanted = str(args.assigneeName);
    if (wanted) {
      const matches = await db.user.findMany({
        where: { isActive: true, fullName: { contains: wanted } },
        select: { id: true, fullName: true },
        take: 5,
      });
      if (matches.length === 0) {
        return { error: `کاربری با نام «${wanted}» پیدا نشد. نام دقیق را بپرس.` };
      }
      if (matches.length > 1) {
        return {
          error: `چند کاربر با نام «${wanted}» هست: ${matches.map((m) => m.fullName).join("، ")}.`
            + " کدام‌یک؟",
        };
      }
      assigneeId = matches[0].id;
      assigneeName = matches[0].fullName;
    }

    let projectName: string | null = null;
    const projectId = str(args.projectId) || null;
    if (projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId }, select: { name: true, code: true },
      });
      if (!project) return { error: "پروژه‌ی مورد اشاره پیدا نشد." };
      projectName = `${project.name}${project.code ? ` (${project.code})` : ""}`;
    }

    const dueDate = str(args.dueDate) || null;
    if (!dueDate) warnings.push("مهلت انجام مشخص نشده است.");

    const payload: TaskInput = {
      title,
      description: str(args.description) || null,
      priority: str(args.priority) || "متوسط",
      status: "در حال انجام",
      dueDate,
      assignedToUserId: assigneeId,
      assignedToName: assigneeName,
      relatedToType: projectId ? "project" : null,
      relatedToId: projectId,
      relatedToName: projectName,
    };

    return {
      title: "ثبت وظیفه جدید",
      lines: [
        { label: "عنوان", value: title },
        { label: "مسئول", value: assigneeName ?? "خودِ شما" },
        { label: "مهلت", value: dueDate ?? "—" },
        { label: "اولویت", value: payload.priority! },
        ...(projectName ? [{ label: "پروژه", value: projectName }] : []),
        ...(payload.description ? [{ label: "توضیح", value: payload.description }] : []),
      ],
      warnings,
      payload,
    };
  },

  async execute(payload, ctx) {
    const task = await createTask(payload as TaskInput, ctx.user, ctx.todayJalali);
    return { id: task.id, label: `وظیفه «${task.title}»` };
  },
};

const proposeProjectActivity: AssistantActionImpl = {
  name: "propose_project_activity",
  label: "ثبت فعالیت پروژه",
  permissionKey: "erp_project_category_groups",
  resource: "activities",
  definition: {
    name: "propose_project_activity",
    description:
      "پیشنهاد ثبت یک فعالیت روی یکی از دسته‌بندی‌های موجود پروژه. دسته‌بندی باید"
      + " از قبل روی پروژه باز شده باشد؛ با project_timeline فهرست آن را ببین.",
    parameters: object({
      projectId: { type: "string" },
      categoryName: { type: "string", description: "نام دسته‌بندی فعالیت روی همین پروژه" },
      text: { type: "string", description: "متن فعالیت" },
    }, ["projectId", "categoryName", "text"]),
  },

  async prepare(args, ctx) {
    const projectId = str(args.projectId);
    const wanted = str(args.categoryName);
    const text = str(args.text);
    if (!projectId || !wanted || !text) {
      return { error: "پروژه، دسته‌بندی و متن فعالیت هر سه لازم‌اند." };
    }

    const groups = await listCategoryGroups(projectId, ctx.user);
    if (!groups) return { error: "پروژه پیدا نشد یا در دسترس شما نیست." };
    if (groups.length === 0) {
      return { error: "روی این پروژه هنوز هیچ دسته‌بندی فعالیتی باز نشده است." };
    }

    /*
     * Matched against the groups the project already has, never created.
     *
     * Opening a category on a job is a decision about how that job is run, and
     * the categories themselves are settings-level. An assistant that invented
     * one because a sentence mentioned it would fill the timeline with
     * near-duplicate headings nobody chose.
     */
    const group = groups.find((g) => g.categoryName === wanted)
      ?? groups.find((g) => g.categoryName.includes(wanted) || wanted.includes(g.categoryName));
    if (!group) {
      return {
        error: `دسته‌بندی «${wanted}» روی این پروژه باز نشده است.`
          + ` دسته‌بندی‌های موجود: ${groups.map((g) => g.categoryName).join("، ")}.`,
      };
    }

    const project = await getDb().project.findUnique({
      where: { id: projectId }, select: { name: true, code: true },
    });

    return {
      title: "ثبت فعالیت روی پروژه",
      lines: [
        { label: "پروژه", value: `${project?.name ?? ""}${project?.code ? ` (${project.code})` : ""}`.trim() || projectId },
        { label: "دسته‌بندی", value: group.categoryName },
        { label: "متن", value: text },
      ],
      warnings: group.status === "اتمام کار"
        ? ["این دسته‌بندی بسته شده است؛ فعالیت روی یک دسته‌بندی خاتمه‌یافته ثبت می‌شود."]
        : [],
      payload: { groupId: group.id, text },
    };
  },

  async execute(payload, ctx) {
    const input = payload as { groupId: string; text: string };
    const result = await addActivity(input, ctx.user);
    if (typeof result === "string") {
      throw new Error(
        result === "forbidden" ? "اجازه ثبت فعالیت روی این پروژه را ندارید."
          : result === "not-found" ? "دسته‌بندی دیگر وجود ندارد."
            : "اطلاعات فعالیت ناقص است.",
      );
    }
    const activity = (result.activity ?? {}) as { id?: string };
    return { id: activity.id ?? "", label: "فعالیت پروژه" };
  },
};

const proposeProforma: AssistantActionImpl = {
  name: "propose_proforma",
  label: "صدور پیش‌فاکتور",
  permissionKey: "erp_proformas",
  resource: "proformas",
  definition: {
    name: "propose_proforma",
    description:
      "پیشنهاد صدور یک پیش‌فاکتور پیش‌نویس. شماره‌ی سند هنگام تایید و به‌صورت"
      + " خودکار صادر می‌شود. برای هر ردیف، بهای تمام‌شده را یا به‌صورت عدد بده یا"
      + " با costNone صراحتاً «بدون بهای تمام‌شده» اعلام کن؛ اگر نمی‌دانی، از کاربر"
      + " بپرس و حدس نزن.",
    parameters: object({
      customerId: { type: "string", description: "شناسه مشتری؛ اگر پروژه داده شود از آن برداشته می‌شود" },
      projectId: { type: "string" },
      currency: { type: "string", description: "ریال | دلار | یورو | درهم | یوان" },
      issueDate: { type: "string", description: "تاریخ صدور شمسی؛ پیش‌فرض امروز" },
      expiryDate: { type: "string" },
      notes: { type: "string", description: "شرایط و توضیحات انتهای سند" },
      items: {
        type: "array",
        description: "ردیف‌های پیش‌فاکتور",
        items: object({
          productId: { type: "string", description: "شناسه کالای انبار، در صورت وجود" },
          variantId: { type: "string", description: "شناسه SKU، وقتی کالا تنوع دارد" },
          productName: { type: "string", description: "نام قلم؛ برای کالای انبار اختیاری است" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unitPriceRial: { type: "number", description: "قیمت واحد فروش، در واحد پول همین سند" },
          unitCost: { type: "number", description: "بهای تمام‌شده واحد، در واحد پول همین سند" },
          costNone: { type: "boolean", description: "این ردیف عمداً بهای تمام‌شده ندارد" },
          techSpecs: { type: "string" },
        }, ["quantity", "unitPriceRial"]),
      },
    }, ["items"]),
  },

  async prepare(args, ctx) {
    const db = getDb();

    let customerId = str(args.customerId) || null;
    let projectLabel: string | null = null;
    const projectId = str(args.projectId) || null;

    if (projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { name: true, code: true, customerId: true },
      });
      if (!project) return { error: "پروژه پیدا نشد." };
      projectLabel = `${project.name}${project.code ? ` (${project.code})` : ""}`;
      if (!customerId) customerId = project.customerId;
    }

    if (!customerId) return { error: "مشتری پیش‌فاکتور مشخص نیست." };
    const customer = await db.customer.findUnique({
      where: { id: customerId }, select: { companyName: true },
    });
    if (!customer) return { error: "مشتری پیدا نشد." };

    const currency = str(args.currency) || "ریال";
    const lines = rows(args.items);
    if (lines.length === 0) return { error: "پیش‌فاکتور بدون ردیف صادر نمی‌شود." };

    const items: ProformaItemInput[] = [];
    const uncosted: string[] = [];

    for (const row of lines) {
      const productId = str(row.productId) || null;
      let name = str(row.productName);
      let unit = str(row.unit) || null;

      if (productId) {
        const product = await db.product.findUnique({
          where: { id: productId }, select: { name: true, code: true, unit: true },
        });
        if (!product) return { error: `کالایی با شناسه ${productId} پیدا نشد.` };
        if (!name) name = product.name;
        if (!unit) unit = product.unit;
      }
      if (!name) return { error: "یکی از ردیف‌ها نام ندارد." };

      const quantity = numberOr(row.quantity, 0);
      if (quantity <= 0) return { error: `تعداد ردیف «${name}» معتبر نیست.` };
      const unitPrice = numberOr(row.unitPriceRial, -1);
      if (unitPrice < 0) return { error: `قیمت واحد ردیف «${name}» مشخص نیست.` };

      /*
       * Cost is asked for, never inferred.
       *
       * The service refuses a save whose lines carry neither a figure nor an
       * explicit «بدون بهای تمام‌شده», and it is right to: an uncosted line
       * reads as pure margin and flatters the customer ranking. The assistant
       * could look a standard cost up, but the figure would be in the
       * product's currency and this document may be in another — so it asks
       * instead of quietly writing a number in the wrong unit.
       */
      const costNone = row.costNone === true;
      const hasCost = row.unitCost !== undefined && row.unitCost !== null && Number.isFinite(Number(row.unitCost));
      if (!costNone && !hasCost) uncosted.push(name);

      items.push({
        productId,
        variantId: str(row.variantId) || null,
        productName: name,
        quantity,
        unit,
        unitPriceRial: unitPrice,
        unitCost: costNone ? 0 : (hasCost ? Number(row.unitCost) : undefined),
        costCurrency: currency,
        costSource: costNone ? COST_SOURCES.NONE : (hasCost ? COST_SOURCES.MANUAL : undefined),
        techSpecs: str(row.techSpecs) || null,
        status: "در انتظار",
      });
    }

    if (uncosted.length > 0 && canSeeCosts(ctx.user)) {
      return {
        error: `بهای تمام‌شده این ردیف‌ها مشخص نیست: ${uncosted.join("، ")}.`
          + " مبلغ هر کدام را از کاربر بپرس، یا اگر عمداً بهای تمام‌شده ندارند"
          + " costNone را برای آن ردیف true بگذار.",
      };
    }

    const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPriceRial), 0);

    const payload: ProformaInput = {
      customerId,
      projectId,
      currency,
      issueDate: str(args.issueDate) || ctx.todayJalali,
      expiryDate: str(args.expiryDate) || null,
      notes: str(args.notes) || null,
      // Always a draft. Whether a quotation has been sent, won or lost is a
      // fact about the world, not something to be asserted at creation.
      status: "پیش‌نویس",
      proformaType: "عادی",
      items,
    };

    return {
      title: "صدور پیش‌فاکتور (پیش‌نویس)",
      lines: [
        { label: "مشتری", value: customer.companyName },
        ...(projectLabel ? [{ label: "پروژه", value: projectLabel }] : []),
        { label: "تاریخ صدور", value: payload.issueDate! },
        { label: "واحد پول", value: currency },
        { label: "تعداد ردیف", value: String(items.length) },
        ...items.slice(0, 12).map((item) => ({
          label: `— ${item.productName}`,
          value: `${formatMoney(Number(item.quantity))} × ${formatMoney(Number(item.unitPriceRial))}`,
        })),
        { label: "جمع ردیف‌ها", value: `${formatMoney(total)} ${currency}` },
        { label: "شماره سند", value: "هنگام تایید به‌صورت خودکار صادر می‌شود" },
      ],
      warnings: [
        ...(items.length > 12 ? [`${items.length - 12} ردیف دیگر در خلاصه نشان داده نشده است.`] : []),
        "پیش‌فاکتور به‌صورت پیش‌نویس ثبت می‌شود؛ تخفیف، مالیات و شرایط تحویل را در فرم کامل کنید.",
      ],
      payload,
    };
  },

  async execute(payload, ctx) {
    const input = payload as ProformaInput;
    // Numbered here, at the moment it becomes a document.
    const proformaNumber = await nextProformaNumber({
      projectId: input.projectId, customerId: input.customerId,
    });
    const proforma = await createProforma(
      { ...input, proformaNumber }, ctx.user, ctx.todayJalali,
    );
    return { id: proforma.id, label: `پیش‌فاکتور ${proforma.proformaNumber}` };
  },
};

const proposePackingList: AssistantActionImpl = {
  name: "propose_packing_list",
  label: "صدور پکینگ لیست",
  permissionKey: "erp_packaging_deliveries",
  resource: "deliveries",
  definition: {
    name: "propose_packing_list",
    description:
      "پیشنهاد صدور پکینگ لیست برای اقلام تحویل‌نشده‌ی یک پروژه. اگر ردیفی مشخص"
      + " نکنی، همه‌ی باقی‌مانده‌ها آورده می‌شوند. شماره سند هنگام تایید صادر می‌شود.",
    parameters: object({
      projectId: { type: "string" },
      proformaId: { type: "string", description: "برای محدود کردن به یک پیش‌فاکتور" },
      deliveryDate: { type: "string", description: "تاریخ تحویل شمسی؛ پیش‌فرض امروز" },
      shippingMethod: { type: "string" },
      items: {
        type: "array",
        description: "ردیف‌های انتخابی؛ نام قلم و تعداد",
        items: object({
          productName: { type: "string" },
          quantity: { type: "number" },
        }, ["productName", "quantity"]),
      },
    }, ["projectId"]),
  },

  async prepare(args, ctx) {
    const projectId = str(args.projectId);
    if (!projectId) return { error: "پروژه مشخص نشده است." };

    const remaining = await getDeliveryRemaining(
      { projectId, proformaId: str(args.proformaId) || null }, ctx.user,
    );
    if (remaining === null) return { error: "اجازه دسترسی به بسته‌بندی و ارسال را ندارید." };

    const outstanding = remaining.filter((line) => line.remaining > 0);
    if (outstanding.length === 0) {
      return { error: "روی این پروژه قلم تحویل‌نشده‌ای باقی نمانده است." };
    }

    const warnings: string[] = [];
    const wanted = rows(args.items);
    const chosen: { line: typeof outstanding[number]; quantity: number }[] = [];

    if (wanted.length === 0) {
      for (const line of outstanding) chosen.push({ line, quantity: line.remaining });
    } else {
      for (const row of wanted) {
        const name = str(row.productName);
        const line = outstanding.find((l) => l.productName === name)
          ?? outstanding.find((l) => l.productName.includes(name) || name.includes(l.productName));
        if (!line) {
          return {
            error: `قلم «${name}» جزو باقی‌مانده‌های این پروژه نیست.`
              + ` باقی‌مانده‌ها: ${outstanding.map((l) => l.productName).join("، ")}.`,
          };
        }
        const quantity = numberOr(row.quantity, 0);
        if (quantity <= 0) return { error: `تعداد قلم «${name}» معتبر نیست.` };
        if (quantity > line.remaining) {
          // Not refused: over-shipping happens and the document has to be able
          // to say so. It is put in front of the person confirming instead.
          warnings.push(
            `تعداد «${line.productName}» (${formatMoney(quantity)}) از باقی‌مانده`
            + ` (${formatMoney(line.remaining)}) بیشتر است.`,
          );
        }
        chosen.push({ line, quantity });
      }
    }

    const project = await getDb().project.findUnique({
      where: { id: projectId }, select: { name: true, code: true },
    });

    const payload: DeliveryInput = {
      projectId,
      proformaId: str(args.proformaId) || null,
      deliveryDate: str(args.deliveryDate) || ctx.todayJalali,
      shippingMethod: str(args.shippingMethod) || null,
      items: chosen.map(({ line, quantity }) => ({
        itemOrDocName: line.productName,
        productId: line.productId,
        variantId: line.variantId,
        tagNumber: line.tagNumber,
        unit: line.unit,
        quantity,
      })),
    };

    return {
      title: "صدور پکینگ لیست",
      lines: [
        { label: "پروژه", value: `${project?.name ?? ""}${project?.code ? ` (${project.code})` : ""}`.trim() || projectId },
        { label: "تاریخ تحویل", value: payload.deliveryDate! },
        ...chosen.map(({ line, quantity }) => ({
          label: `— ${line.productName}`,
          value: `${formatMoney(quantity)} از ${formatMoney(line.remaining)} باقی‌مانده`,
        })),
        { label: "شماره سند", value: "هنگام تایید به‌صورت خودکار صادر می‌شود" },
      ],
      warnings: [
        ...warnings,
        "صدور پکینگ لیست، کالا را در دفتر انبار خارج‌شده ثبت می‌کند.",
      ],
      payload,
    };
  },

  async execute(payload, ctx) {
    const input = payload as DeliveryInput;
    const packingListNumber = await nextPackingListNumber(input.projectId!);
    const delivery = await createDelivery(
      { ...input, packingListNumber }, ctx.user, ctx.todayJalali,
    );
    if (!delivery) throw new Error("اجازه ثبت بسته‌بندی و ارسال را ندارید.");
    return { id: delivery.id, label: `پکینگ لیست ${delivery.packingListNumber}` };
  },
};

const IMPLEMENTATIONS: AssistantActionImpl[] = [
  proposeTask,
  proposeProjectActivity,
  proposeProforma,
  proposePackingList,
];

/**
 * The actions this user may be offered.
 *
 * Filtered by the module permission rather than shown-and-refused: a tool the
 * model can call and never succeed with wastes a round trip and produces an
 * apology instead of an answer.
 */
export function assistantActionsFor(user: AuthUser): AssistantActionImpl[] {
  return IMPLEMENTATIONS.filter((action) => checkKeyAccess(user, action.permissionKey, "write") === null);
}

export function findAction(name: string): AssistantActionImpl | undefined {
  return IMPLEMENTATIONS.find((action) => action.name === name);
}

/* ------------------------------ proposals -------------------------------- */

interface StoredRow {
  id: string;
  action: string;
  userId: string;
  status: string;
  title: string;
  summary: string | null;
  payload: string | null;
  resultId: string | null;
  resultLabel: string | null;
  error: string | null;
  createdAt: Date;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** A stored row as the browser sees it. The payload is deliberately not here. */
export function toProposal(row: StoredRow): AssistantProposal {
  const summary = parseJson<{ lines?: ActionSummaryLine[]; warnings?: string[] }>(row.summary, {});
  return {
    id: row.id,
    action: row.action,
    title: row.title,
    lines: summary.lines ?? [],
    warnings: summary.warnings ?? [],
    status: row.status as AssistantProposal["status"],
    createdAt: row.createdAt.toISOString(),
    resultId: row.resultId,
    resultLabel: row.resultLabel,
    error: row.error,
  };
}

/** Prepares an action and stores the proposal. Writes nothing else. */
export async function prepareProposal(
  action: AssistantActionImpl,
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<{ error: string } | AssistantProposal> {
  const denied = checkKeyAccess(ctx.user, action.permissionKey, "write");
  if (denied) return { error: denied };

  const prepared = await action.prepare(args, ctx);
  if (isError(prepared)) return prepared;

  const row = await getDb().assistantAction.create({
    data: {
      id: randomUUID(),
      action: action.name,
      userId: ctx.user.id,
      status: "pending",
      title: prepared.title.slice(0, 400),
      summary: JSON.stringify({ lines: prepared.lines, warnings: prepared.warnings }),
      payload: JSON.stringify(prepared.payload ?? null),
      arguments: JSON.stringify(args ?? {}),
    },
  });

  return toProposal(row as StoredRow);
}

/**
 * Executes a proposal the user has confirmed.
 *
 * The status moves to `confirmed` **before** the write, with a conditional
 * update that only matches a row still `pending`. That single statement is what
 * makes a double-clicked confirm button issue one proforma rather than two: the
 * second call finds nothing to update and stops. A write that then fails puts
 * the row into `failed`, which is terminal — the assistant is asked again
 * rather than the same stale payload being retried against a database that has
 * moved on.
 */
export async function confirmProposal(
  id: string,
  ctx: ActionContext,
  actionsAllowed: boolean,
): Promise<{ error: string } | AssistantProposal> {
  const db = getDb();
  const row = await db.assistantAction.findUnique({ where: { id } }) as StoredRow | null;
  if (!row) return { error: "این درخواست پیدا نشد." };
  // A proposal belongs to the person it was prepared for. Somebody else's is
  // not theirs to approve, and must not even be described to them.
  if (row.userId !== ctx.user.id) return { error: "این درخواست پیدا نشد." };

  const refusal = confirmRefusalReason(
    { status: row.status as AssistantProposal["status"], createdAt: row.createdAt },
    Date.now(),
    actionsAllowed,
  );
  if (refusal) return { error: refusal };

  const action = findAction(row.action);
  if (!action) return { error: "این نوع درخواست دیگر پشتیبانی نمی‌شود." };

  // Re-checked: a permission may have been withdrawn since the proposal.
  const denied = checkKeyAccess(ctx.user, action.permissionKey, "write");
  if (denied) return { error: denied };

  const claimed = await db.assistantAction.updateMany({
    where: { id, status: "pending" },
    data: { status: "confirmed", resolvedAt: new Date() },
  });
  if (claimed.count === 0) return { error: "این درخواست همین حالا ثبت شد." };

  try {
    const result = await action.execute(parseJson<unknown>(row.payload, null), ctx);
    const saved = await db.assistantAction.update({
      where: { id },
      data: { resultId: result.id || null, resultLabel: result.label.slice(0, 400) },
    });

    /*
     * A second audit entry, on top of the one the service writes.
     *
     * The service's entry says a proforma was created by this user, which is
     * true and is not the whole story: that it was drafted by the assistant and
     * approved rather than typed is exactly what somebody reading the log later
     * needs to know.
     */
    await logAction(
      {
        action: "CREATE",
        module: "دستیار هوشمند",
        entityId: result.id || id,
        description: `${actionLabel(row.action)} با تایید کاربر از طریق دستیار هوشمند: ${result.label}`,
        afterState: { proposalId: id, action: row.action, summary: parseJson(row.summary, null) },
      },
      ctx.user,
      ctx.todayJalali,
    );

    return toProposal(saved as StoredRow);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`assistant action ${row.action} failed`, err);
    const failed = await db.assistantAction.update({
      where: { id },
      data: { status: "failed", error: message.slice(0, 2000), resolvedAt: new Date() },
    });
    return toProposal(failed as StoredRow);
  }
}

export async function cancelProposal(
  id: string,
  user: AuthUser,
): Promise<{ error: string } | AssistantProposal> {
  const db = getDb();
  const row = await db.assistantAction.findUnique({ where: { id } }) as StoredRow | null;
  if (!row || row.userId !== user.id) return { error: "این درخواست پیدا نشد." };
  if (row.status !== "pending") return toProposal(row);

  const updated = await db.assistantAction.update({
    where: { id },
    data: { status: "cancelled", resolvedAt: new Date() },
  });
  return toProposal(updated as StoredRow);
}

/** Used by `test:rules` and the settings screen: what exists, and its label. */
export function actionCatalogue(): AssistantActionMeta[] {
  return IMPLEMENTATIONS.map(({ name, label, permissionKey, resource }) =>
    ({ name, label, permissionKey, resource }));
}

/** True when the catalogue and the implementations agree. */
export function catalogueMatchesImplementations(): boolean {
  const key = (a: AssistantActionMeta) => `${a.name}:${a.permissionKey}:${a.resource}`;
  const declared = ASSISTANT_ACTIONS.map(key).sort();
  const built = actionCatalogue().map(key).sort();
  return declared.length === built.length && declared.every((v, i) => v === built[i]);
}
