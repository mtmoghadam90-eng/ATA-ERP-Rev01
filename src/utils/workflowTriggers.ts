/**
 * The one catalogue of workflow triggers: what fires, what a condition may ask
 * about, and which values that field can actually hold.
 *
 * There were three copies of this in the settings screen — the `<option>` list,
 * a `fieldMap` for the default condition, and a `triggerLabelMap` for the rule
 * cards — plus a forty-branch `if/else if` chain of hand-typed value lists. The
 * same shape as the four copies of the module list that `appModules.ts` exists
 * to hold, and it drifted the same way, only worse: a module missing from a
 * copy is visibly missing, while a **status value the engine never emits** is
 * invisible. The rule saves, it looks right on the card, and it never runs.
 *
 * What was actually wrong, measured against what the services emit:
 *  - the purchase order offered «در انتظار تأیید / تأیید شده / ارسال شده», three
 *    words this application has never stored — its statuses are «پرداخت و سفارش
 *    به سازنده», «حمل و ترانزیت», «ترخیص گمرک» and so on;
 *  - the project offered «پیشنهاد فنی مالی / در دست بررسی / برنده شده / باخته
 *    شده», four values, none of which exists;
 *  - the delivery offered seven where the engine emits two;
 *  - the inquiry offered seven where the engine emits four;
 *  - the task offered «در انتظار / تکمیل شده» and priorities «کم / زیاد /
 *    بحرانی», none of which is a value this application stores;
 *  - the referral offered «در حال انجام» and «لغو شده», where it stores «در حال
 *    اقدام» and cannot be cancelled at all;
 *  - `proforma_created` offered a `status` condition against a payload that has
 *    never carried one, and `customer_updated` offered `newStatus` against a
 *    payload whose field is `type`;
 *  - and `task_completed` was emitted by the engine and offered nowhere.
 *
 * So the values come from the modules' own lists (`moduleStatuses.ts`,
 * `workBoard.ts`) rather than being typed again here, and the fields are the
 * payload keys the services really put on the event. `test:rules` holds the
 * catalogue against the trigger union in both directions and reads the services
 * for the keys they emit.
 */

import type { WorkflowRule } from "../types";
import { APP_MODULES } from "../appModules";
import {
  AFTER_SALES_STATUSES, CUSTOMER_TYPES, DELIVERY_WORKFLOW_STATUSES,
  INQUIRY_WORKFLOW_STATUSES, PROFORMA_OUTCOMES, PROFORMA_STORED_STATUSES, PROJECT_STATUSES,
  PURCHASE_ORDER_STATUSES, TASK_PRIORITIES, TRANSACTION_TYPES,
} from "./moduleStatuses";
import { REFERRAL_STATUSES, TASK_STATUSES } from "./workBoard";
import { PROJECT_STAGES } from "./projectStage";

export type WorkflowTriggerType = WorkflowRule["triggerType"];

export interface TriggerField {
  /** The payload key. A field the payload never carries is a rule that never runs. */
  value: string;
  label: string;
  /**
   * What this field can hold, when it is a closed list.
   *
   * Absent means free text — an amount, a city, a stock level — where offering
   * a dropdown would be worse than a box.
   */
  options?: readonly string[];
  /**
   * One Persian sentence saying what this field *answers*, for a reader who has
   * only its name and its values.
   *
   * Written for the assistant's rule drafter, and it exists because of a real
   * refusal: «اگر ۳ روز از ایجاد پروژه گذشت و استعلام قیمت ثبت نشد…» was turned
   * down as inexpressible, when `stage = جدید` says exactly that. A **derived**
   * field is the case that needs it — the value «جدید» does not announce that it
   * means «نه استعلامی ثبت شده و نه پیش‌فاکتوری», so a reader looking for a
   * field *named* «استعلام ثبت نشده» finds none and concludes the system cannot
   * answer, which is the trigger catalogue's own silent failure arriving from
   * the other side: not a rule that never fires, but a rule never written.
   *
   * A stored column whose values speak for themselves needs none.
   */
  hint?: string;
}

export interface TriggerSpec {
  label: string;
  /** The heading it sits under in the trigger dropdown. */
  group: string;
  fields: readonly TriggerField[];
}

/** «برای انجام» and the rest, plus the value every automation actually writes. */
const TASK_STATUS_OPTIONS = TASK_STATUSES;

const G = {
  SALES: "پیش‌فاکتورها و پروژه‌ها",
  BUYING: "خرید و تأمین‌کنندگان",
  STOCK: "کالاها و انبار",
  SERVICE: "خدمات پس از فروش",
  MONEY: "مالی و پرداخت‌ها",
  WORK: "وظایف و ارجاعات",
  DONE: "پایان کار",
  TIME: "زمان‌بندی",
} as const;

export const WORKFLOW_TRIGGERS: Record<WorkflowTriggerType, TriggerSpec> = {
  /* ------------------------------ sales -------------------------------- */
  proforma_created: {
    label: "ایجاد پیش‌فاکتور جدید",
    group: G.SALES,
    /*
     * The **stored** status, and only the two values a new document can be in.
     *
     * The editor offered six derived *outcome* values here — «تأیید شده
     * (برنده)», «باخته» and the rest — against a payload that carried no status
     * at all, so every condition on it silently matched nothing. The service
     * emits it now, and a new proforma is «پیش‌نویس» or «ارسال شده».
     */
    fields: [
      { value: "status", label: "وضعیت پیش‌فاکتور", options: PROFORMA_STORED_STATUSES },
      { value: "currency", label: "ارز سند" },
      { value: "totalAmount", label: "مبلغ کل" },
      { value: "finalAmount", label: "مبلغ نهایی" },
    ],
  },
  proforma_outcome_change: {
    label: "تغییر وضعیت نهایی پیش‌فاکتور",
    group: G.SALES,
    fields: [
      { value: "newOutcome", label: "وضعیت نهایی جدید", options: PROFORMA_OUTCOMES },
      { value: "oldOutcome", label: "وضعیت نهایی قبلی", options: PROFORMA_OUTCOMES },
      { value: "proformaAmount", label: "مبلغ پیش‌فاکتور" },
    ],
  },
  proforma_status_change: {
    label: "تغییر وضعیت ثبت‌شده پیش‌فاکتور (مثلاً ارسال شده)",
    group: G.SALES,
    /*
     * The stored column, not the derived outcome — and **not** a user-editable
     * list either. The editor used to prefer `settings.dropdownItems.
     * proformaStatuses` over these, a five-entry leftover from before the
     * outcome and the status were separated, so it offered «تأیید شده (برنده)»,
     * «لغو شده» and «باخته» on a column that has never held any of them: the
     * rule saved, printed correctly on its card, and never fired. Those three
     * belong to `proforma_outcome_change` one trigger above.
     */
    fields: [
      { value: "newStatus", label: "وضعیت جدید ثبت‌شده", options: PROFORMA_STORED_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی ثبت‌شده", options: PROFORMA_STORED_STATUSES },
      { value: "proformaAmount", label: "مبلغ پیش‌فاکتور" },
    ],
  },
  project_created: {
    label: "ایجاد پروژه جدید",
    group: G.SALES,
    fields: [{ value: "status", label: "وضعیت پروژه", options: PROJECT_STATUSES }],
  },
  project_status_change: {
    label: "تغییر وضعیت پروژه",
    group: G.SALES,
    fields: [
      { value: "newStatus", label: "وضعیت جدید پروژه", options: PROJECT_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی پروژه", options: PROJECT_STATUSES },
    ],
  },
  project_stage_change: {
    label: "تغییر مرحله جاری پروژه (مثلاً رسیدن به ترخیص گمرک)",
    group: G.SALES,
    /*
     * The stage, not the status. They are two axes — a project is «برنده
     * (موفق)» and «ترخیص گمرک» at the same time — so the outcome rides along
     * as a field rather than being conflated with the stage.
     */
    fields: [
      { value: "newStage", label: "مرحله جدید", options: PROJECT_STAGES },
      { value: "oldStage", label: "مرحله قبلی", options: PROJECT_STAGES },
      { value: "status", label: "وضعیت تجاری پروژه", options: PROJECT_STATUSES },
    ],
  },

  /* ------------------------------ buying ------------------------------- */
  customer_created: {
    label: "ثبت مشتری جدید",
    group: G.BUYING,
    fields: [
      { value: "type", label: "نوع مشتری", options: CUSTOMER_TYPES },
      { value: "city", label: "شهر" },
      { value: "province", label: "استان" },
      { value: "industry", label: "صنعت" },
    ],
  },
  customer_updated: {
    label: "ویرایش اطلاعات مشتری",
    group: G.BUYING,
    // `type`, not `newStatus`: that is the key the service puts on the event.
    fields: [
      { value: "type", label: "نوع جدید مشتری", options: CUSTOMER_TYPES },
      { value: "oldType", label: "نوع قبلی مشتری", options: CUSTOMER_TYPES },
      { value: "city", label: "شهر" },
      { value: "province", label: "استان" },
      { value: "industry", label: "صنعت" },
    ],
  },
  supplier_created: {
    label: "ثبت تامین‌کننده جدید",
    group: G.BUYING,
    fields: [
      { value: "country", label: "کشور" },
      { value: "city", label: "شهر" },
    ],
  },
  supplier_inquiry_created: {
    label: "ثبت استعلام قیمت جدید",
    group: G.BUYING,
    fields: [
      { value: "price", label: "مبلغ کل استعلام (ریال)" },
      { value: "supplierId", label: "تامین‌کننده" },
    ],
  },
  supplier_inquiry_status_change: {
    label: "تغییر وضعیت استعلام تامین‌کننده",
    group: G.BUYING,
    fields: [
      { value: "newStatus", label: "وضعیت جدید", options: INQUIRY_WORKFLOW_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی", options: INQUIRY_WORKFLOW_STATUSES },
    ],
  },
  purchase_order_created: {
    label: "ثبت سفارش خرید جدید",
    group: G.BUYING,
    fields: [
      { value: "status", label: "وضعیت سفارش خرید", options: PURCHASE_ORDER_STATUSES },
      { value: "totalAmount", label: "مبلغ کل" },
    ],
  },
  purchase_order_status_change: {
    label: "تغییر وضعیت سفارش خرید",
    group: G.BUYING,
    fields: [
      { value: "newStatus", label: "وضعیت جدید سفارش خرید", options: PURCHASE_ORDER_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی سفارش خرید", options: PURCHASE_ORDER_STATUSES },
    ],
  },

  /* ------------------------------- stock ------------------------------- */
  product_created: {
    label: "ثبت کالای جدید",
    group: G.STOCK,
    fields: [
      { value: "category", label: "دسته محصول" },
      { value: "stockLevel", label: "موجودی" },
      { value: "minStockLevel", label: "حداقل موجودی" },
    ],
  },
  product_low_stock: {
    label: "کاهش موجودی کالا به کمتر از حد مجاز",
    group: G.STOCK,
    fields: [
      { value: "stockLevel", label: "موجودی" },
      { value: "minStockLevel", label: "حداقل موجودی" },
    ],
  },
  packaging_delivery_created: {
    label: "ثبت بسته‌بندی و تحویل",
    group: G.STOCK,
    fields: [{ value: "action", label: "عملیات", options: ["ایجاد"] }],
  },
  packaging_delivery_status_change: {
    label: "تغییر وضعیت بسته‌بندی و تحویل",
    group: G.STOCK,
    /*
     * Two values, because a packing list has no status column: the engine
     * derives one from whether the goods have gone out. Seven were offered.
     */
    fields: [
      { value: "newStatus", label: "وضعیت جدید", options: DELIVERY_WORKFLOW_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی", options: DELIVERY_WORKFLOW_STATUSES },
    ],
  },

  /* ------------------------------ service ------------------------------ */
  after_sales_service_created: {
    label: "ثبت درخواست خدمات پس از فروش جدید",
    group: G.SERVICE,
    fields: [{ value: "status", label: "وضعیت خدمات", options: AFTER_SALES_STATUSES }],
  },
  after_sales_service_status_change: {
    label: "تغییر وضعیت خدمات پس از فروش",
    group: G.SERVICE,
    fields: [
      { value: "newStatus", label: "وضعیت جدید", options: AFTER_SALES_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی", options: AFTER_SALES_STATUSES },
    ],
  },

  /* ------------------------------- money ------------------------------- */
  transaction_created: {
    label: "ثبت تراکنش مالی جدید",
    group: G.MONEY,
    fields: [
      { value: "type", label: "نوع تراکنش", options: TRANSACTION_TYPES },
      { value: "paymentType", label: "روش پرداخت" },
      { value: "amountRIYAL", label: "مبلغ ریالی" },
      { value: "currency", label: "ارز سند", options: ["rial", "foreign"] },
    ],
  },
  transaction_status_change: {
    label: "تغییر وضعیت سند مالی",
    group: G.MONEY,
    fields: [
      { value: "newStatus", label: "وضعیت جدید سند" },
      { value: "oldStatus", label: "وضعیت قبلی سند" },
    ],
  },

  /* ------------------------------- work -------------------------------- */
  task_created: {
    label: "ایجاد وظیفه جدید",
    group: G.WORK,
    fields: [
      { value: "priority", label: "اولویت", options: TASK_PRIORITIES },
      { value: "taskKind", label: "نوع وظیفه", options: ["GENERAL", "SALES_FOLLOW_UP"] },
    ],
  },
  task_status_change: {
    label: "تغییر وضعیت وظیفه",
    group: G.WORK,
    fields: [
      { value: "newStatus", label: "وضعیت جدید", options: TASK_STATUS_OPTIONS },
      { value: "oldStatus", label: "وضعیت قبلی", options: TASK_STATUS_OPTIONS },
      { value: "priority", label: "اولویت", options: TASK_PRIORITIES },
    ],
  },
  task_completed: {
    label: "اتمام یک وظیفه",
    group: G.WORK,
    /*
     * Fired by `updateTask` since the module was written and offered nowhere,
     * so the one event people actually want to automate on could not be chosen.
     */
    fields: [{ value: "oldStatus", label: "وضعیت قبلی", options: TASK_STATUS_OPTIONS }],
  },
  referral_created: {
    label: "ثبت ارجاع جدید",
    group: G.WORK,
    // Every referral is raised «در انتظار اقدام», so a status condition here
    // would either always match or never — the assignee is the useful question.
    fields: [{ value: "assignedToName", label: "ارجاع‌شده به" }],
  },
  referral_status_change: {
    label: "تغییر وضعیت ارجاع",
    group: G.WORK,
    fields: [
      { value: "newStatus", label: "وضعیت جدید", options: REFERRAL_STATUSES },
      { value: "oldStatus", label: "وضعیت قبلی", options: REFERRAL_STATUSES },
    ],
  },

  /* -------------------------------- time ------------------------------- */
  /* --------------------------- end of work ------------------------------ */
  /*
   * The three plainest «پایان کار» events, none of which had a trigger.
   *
   * Closing an activity category only ever reached the *per-project* milestone
   * engine, so «وقتی دستهٔ خرید این پروژه تمام شد …» had to be rebuilt by hand on
   * every job; a milestone closing was the same fault from the other side; and a
   * sales chase closing fired nothing unless its result happened to settle the
   * sale, which is one result out of eight.
   */
  activity_category_completed: {
    label: "اتمام کار یک دستهٔ فعالیت پروژه",
    group: G.DONE,
    fields: [
      /*
       * Free text, not a dropdown: the categories are
       * `settings.activityCategories` — a company's own editable list — so a
       * fixed option list here would be a second copy that drifts from it, and
       * offering the wrong words is the fault this catalogue exists to end.
       */
      { value: "categoryName", label: "نام دستهٔ فعالیت" },
    ],
  },
  project_milestone_completed: {
    label: "تکمیل یک مرحلهٔ (Milestone) پروژه",
    group: G.DONE,
    fields: [
      { value: "milestoneTitle", label: "عنوان مرحله" },
    ],
  },
  follow_up_completed: {
    label: "ثبت نتیجهٔ یک پیگیری فروش",
    group: G.DONE,
    fields: [
      /*
       * The result is `settings.dropdownItems.followUpResults`, editable by the
       * company, so free text for the same reason as the category above.
       */
      { value: "followUpResult", label: "نتیجهٔ پیگیری" },
      {
        value: "settledOutcome", label: "وضعیت نهایی ثبت‌شده", options: PROFORMA_OUTCOMES,
        hint: "فقط وقتی پر می‌شود که همان تماس فروش را قطعی کرده باشد — «تأیید نهایی خرید»، "
          + "«لغو خرید توسط مشتری» یا «واگذاری به رقیب». تعویق و بی‌پاسخی چیزی اینجا نمی‌گذارند.",
      },
    ],
  },
  time_elapsed: {
    label: "زمان‌بندی‌شده (N روز پیش از/پس از یک تاریخ)",
    group: G.TIME,
    /*
     * A scheduled rule matches the record itself, so its fields depend on which
     * record the schedule counts from — `scheduleFields` below, not this list,
     * which is only what every subject shares.
     */
    fields: [],
  },
};

/** The dropdown, grouped, in the order the catalogue declares. */
/**
 * Which record each event fires on, and the payload key holding its id.
 *
 * The scheduled sweep has had this since `ScheduleSubject.payloadIdKey`: a rule
 * has to *name* the row it fired on, or the task it raises belongs to nothing.
 * The event half never did — `workflowEntityType`/`workflowEntityId` were filled
 * in from `relatedToType`/`relatedToId`, which `create_task` sets from the
 * proforma or the project and otherwise leaves null. So a rule on a purchase
 * order with **no project** — a general warehouse purchase, which this
 * application supports on purpose — raised a task carrying no record at all:
 * `closeWhenResolved` could never retire it, the escalation could never find it,
 * and `skipIfOpenSameKind` **silently did nothing**, because it needs a
 * `relatedToId` to compare. Nothing failed; the reminders simply piled up.
 *
 * Spelled out per trigger rather than derived as `${entity}Id`, exactly as the
 * schedule's own key is, so it sits beside the trigger it belongs to and
 * `test:rules` can hold each key against what the service really emits.
 *
 * `time_elapsed` is null because the sweep supplies its own — it knows which row
 * it selected, and this map would be a second answer to that question.
 */
export const TRIGGER_ENTITY: Record<
  WorkflowTriggerType, { entityType: string; idKey: string } | null
> = {
  proforma_created: { entityType: "proforma", idKey: "proformaId" },
  proforma_status_change: { entityType: "proforma", idKey: "proformaId" },
  proforma_outcome_change: { entityType: "proforma", idKey: "proformaId" },
  project_created: { entityType: "project", idKey: "projectId" },
  project_status_change: { entityType: "project", idKey: "projectId" },
  project_stage_change: { entityType: "project", idKey: "projectId" },
  customer_created: { entityType: "customer", idKey: "customerId" },
  customer_updated: { entityType: "customer", idKey: "customerId" },
  supplier_created: { entityType: "supplier", idKey: "supplierId" },
  supplier_inquiry_created: { entityType: "supplierInquiry", idKey: "inquiryId" },
  supplier_inquiry_status_change: { entityType: "supplierInquiry", idKey: "inquiryId" },
  purchase_order_created: { entityType: "purchaseOrder", idKey: "purchaseOrderId" },
  purchase_order_status_change: { entityType: "purchaseOrder", idKey: "purchaseOrderId" },
  product_created: { entityType: "product", idKey: "productId" },
  product_low_stock: { entityType: "product", idKey: "productId" },
  packaging_delivery_created: { entityType: "delivery", idKey: "deliveryId" },
  packaging_delivery_status_change: { entityType: "delivery", idKey: "deliveryId" },
  after_sales_service_created: { entityType: "afterSalesService", idKey: "serviceId" },
  after_sales_service_status_change: { entityType: "afterSalesService", idKey: "serviceId" },
  transaction_created: { entityType: "transaction", idKey: "transactionId" },
  transaction_status_change: { entityType: "transaction", idKey: "transactionId" },
  task_created: { entityType: "task", idKey: "taskId" },
  task_status_change: { entityType: "task", idKey: "taskId" },
  task_completed: { entityType: "task", idKey: "taskId" },
  referral_created: { entityType: "referral", idKey: "referralId" },
  referral_status_change: { entityType: "referral", idKey: "referralId" },
  activity_category_completed: { entityType: "categoryGroup", idKey: "groupId" },
  project_milestone_completed: { entityType: "milestone", idKey: "milestoneId" },
  follow_up_completed: { entityType: "task", idKey: "taskId" },
  time_elapsed: null,
};

export function triggerGroups(): { group: string; triggers: WorkflowTriggerType[] }[] {
  const out: { group: string; triggers: WorkflowTriggerType[] }[] = [];
  for (const [id, spec] of Object.entries(WORKFLOW_TRIGGERS) as [WorkflowTriggerType, TriggerSpec][]) {
    const found = out.find((g) => g.group === spec.group);
    if (found) found.triggers.push(id);
    else out.push({ group: spec.group, triggers: [id] });
  }
  return out;
}

/** The Persian name of a trigger, or the raw id for one stored by an older build. */
export function triggerLabel(triggerType: string): string {
  return WORKFLOW_TRIGGERS[triggerType as WorkflowTriggerType]?.label ?? triggerType;
}

/** The condition fields a trigger offers. Empty for an unknown one. */
export function triggerFields(triggerType: string): readonly TriggerField[] {
  return WORKFLOW_TRIGGERS[triggerType as WorkflowTriggerType]?.fields ?? [];
}

/**
 * The field a newly added condition starts on.
 *
 * The first one the trigger declares, because that is the one people mean
 * almost every time — «وضعیت جدید» on a status change, «نوع مشتری» on a
 * customer. `status` was the old fallback and is wrong for most triggers.
 */
export function defaultConditionField(triggerType: string): string {
  return triggerFields(triggerType)[0]?.value ?? "status";
}

/** What that field may hold, when it is a closed list. */
export function conditionValues(triggerType: string, field: string): readonly string[] {
  return triggerFields(triggerType).find((f) => f.value === field)?.options ?? [];
}

/**
 * The fields a `time_elapsed` rule may match, by the record its schedule counts
 * from. Kept beside the catalogue so both come from one file.
 */
/**
 * The modules a workflow rule may hand a task to, and the one list that decides
 * it.
 *
 * `create_task` resolves «MODULE_RESPONSIBLE_<id>» through
 * `settings.moduleResponsibles[id]`, so two lists have to agree: the assignee
 * dropdown in the rule editor, and the table in Settings where a responsible is
 * actually named. They were both hand-typed and did not — the dropdown offered
 * `MODULE_RESPONSIBLE_tasks` and the table had no row for it, so a rule
 * assigned to it silently fell back to «admin». Both read this now, and it is
 * derived from `APP_MODULES` for the same reason everything else about the
 * modules is.
 *
 * Three are excluded because they are not work anybody is handed: the front
 * page, the users screen and the settings screen.
 */
const NOT_ASSIGNABLE = new Set(["dashboard", "users", "settings"]);

export interface AssigneeToken {
  value: string;
  label: string;
}

/** The modules that carry a responsible, in the catalogue's own order. */
export const RESPONSIBLE_MODULES = APP_MODULES.filter((m) => !NOT_ASSIGNABLE.has(m.id));

/**
 * What the assignee box may hold, besides a person's own name.
 *
 * `SALES_EXPERT` leads because it is the answer for anything about a sale: it
 * resolves through the proforma's *project*, which is where the owner of a
 * quotation is recorded.
 */
export const WORKFLOW_ASSIGNEE_TOKENS: readonly AssigneeToken[] = [
  { value: "SALES_EXPERT", label: "کارشناس فروش پروژه" },
  ...RESPONSIBLE_MODULES.map((m) => ({
    value: `MODULE_RESPONSIBLE_${m.id}`,
    label: `مسئول ماژول ${m.name}`,
  })),
];

/** True when the string is one of the dynamic tokens rather than a person. */
export function isAssigneeToken(value: string): boolean {
  return WORKFLOW_ASSIGNEE_TOKENS.some((t) => t.value === value);
}

export const SCHEDULE_MODEL_FIELDS: Record<string, readonly TriggerField[]> = {
  proforma: [
    {
      value: "status", label: "وضعیت ارسال پیش‌فاکتور", options: PROFORMA_STORED_STATUSES,
      hint: "فقط همین دو مقدار را دارد. «برنده»، «باخته» و «لغو شده» نتیجه نهایی‌اند، "
        + "ستون دیگری هستند و اینجا هرگز ذخیره نمی‌شوند.",
    },
    { value: "currency", label: "ارز سند" },
    { value: "finalAmount", label: "مبلغ نهایی" },
  ],
  project: [
    {
      value: "status", label: "وضعیت پروژه", options: PROJECT_STATUSES,
      hint: "نتیجه تجاری فروش است و بس — برنده/باخته/در جریان. با ترخیص گمرک یا "
        + "تحویل کالا تکان نمی‌خورد؛ برای «کار کجاست» از فیلد stage «مرحله پروژه» استفاده کن.",
    },
    /*
     * The stage, which is what a dwell rule on a project asks about: «۷ روز در
     * انتظار پاسخ تأمین‌کننده مانده» is this field plus the
     * `project_stage_changed` schedule. The status beside it is the sales
     * outcome and does not move when goods clear customs, which is exactly why
     * the two are separate columns.
     *
     * The hint is the fix for a reported refusal — see `TriggerField.hint`.
     */
    {
      value: "stage", label: "مرحله پروژه", options: PROJECT_STAGES,
      hint: "کار روی این پروژه تا کجا رسیده — محاسبه‌شده از رکوردهای خودش، نه دستی. "
        + "«جدید» یعنی هنوز نه استعلام قیمتی ثبت شده و نه پیش‌فاکتوری صادر شده؛ "
        + "«در حال مذاکره» همان و فقط وضعیت پروژه دستی روی مذاکره است؛ "
        + "«در انتظار پاسخ تأمین‌کننده» یعنی استعلام رفته و قیمتی برنگشته؛ "
        + "«بررسی پیشنهاد تأمین‌کننده» یعنی قیمت آمده و هنوز برنده انتخاب نشده؛ "
        + "«تهیه پیش‌فاکتور» یعنی پیش‌فاکتور در دست تهیه است؛ «پیگیری پیش‌فاکتور» یعنی "
        + "برای مشتری ارسال شده. پس هر پرسشی از جنس «فلان کار هنوز انجام نشده» یا "
        + "«اینجا گیر کرده» را با همین فیلد بپرس.",
    },
  ],
  purchaseOrder: [
    { value: "status", label: "وضعیت سفارش خرید", options: PURCHASE_ORDER_STATUSES },
  ],
  supplierInquiry: [{
    value: "isWinner", label: "آفر برنده است", options: ["true", "false"],
    hint: "false یعنی این استعلام هنوز برنده اعلام نشده — که هم «جواب نیامده» را می‌گیرد "
      + "و هم «جواب آمده و تصمیم گرفته نشده»؛ این دو را از هم جدا نمی‌کند.",
  }],
  delivery: [{ value: "actualDeliveryDateJalali", label: "تاریخ تحویل قطعی" }],
  afterSalesService: [
    { value: "status", label: "وضعیت خدمات پس از فروش", options: AFTER_SALES_STATUSES },
  ],
};
