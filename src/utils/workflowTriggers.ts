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
import { FOLLOW_UP_STATES } from "./salesFollowUp";
import { REFERRAL_STATUSES, TASK_STATUSES } from "./workBoard";
import { PROJECT_STAGES } from "./projectStage";
import { conditionValueList } from "./workflowConditions";

export type WorkflowTriggerType = WorkflowRule["triggerType"];

/** `true` only when every member of the union appears in the list. */
type Covers<Union extends string, List extends readonly string[]> =
  [Exclude<Union, List[number]>] extends [never] ? true : never;

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
  /**
   * Not a column: the scheduled sweep computes it and puts it on the payload.
   *
   * The distinction is load-bearing for `test:rules`, which holds every
   * condition field against the sweep's own `PAYLOAD_SELECT` — a field the
   * payload does not carry is a rule that saves, prints correctly and never
   * matches. A derived field can never be in that select, so it is held against
   * the sweep *assigning* it instead, which is the same guarantee from the
   * other end and exactly how `ENRICHED_PAYLOAD_VARIABLES` is checked.
   */
  derived?: boolean;
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

/**
 * The three things a rule can do, and the four ways a condition can compare.
 *
 * These are here for the reason everything else in this file is: they were
 * written out at the call sites, and one of them drifted the moment a third
 * action type arrived. The rule card summarised its actions as
 * `act.type === "create_task" ? … : "ارسال اعلان به مسئول ماژول"` — a two-way
 * ternary written when there were only two kinds — so **every `send_message`
 * rule read on that screen as a notification to a module owner**. Nothing was
 * wrong with the rule; the card was describing a different one, which is the
 * silent-drift fault this catalogue exists to end, arriving through the one
 * control whose whole job is to say what a rule does.
 *
 * The operator list had the same shape and the same fault: two of the four were
 * rendered, so a `greater_than` condition printed «مخالف باشد با» — very nearly
 * its opposite — on a rule that was perfectly correct.
 */
export const WORKFLOW_ACTION_TYPES = [
  { value: "create_task", label: "ایجاد وظیفه" },
  { value: "send_notification", label: "ارسال اعلان به مسئول ماژول" },
  { value: "send_message", label: "ارسال پیام به مشتری (پیامک/بله/ایمیل)" },
] as const satisfies readonly { value: WorkflowRule["actions"][number]["type"]; label: string }[];

/** Fails `npm run lint` for an action type the settings screen cannot offer. */
const _everyActionTypeIsOffered: Covers<
  WorkflowRule["actions"][number]["type"],
  readonly typeof WORKFLOW_ACTION_TYPES[number]["value"][]
> = true;
void _everyActionTypeIsOffered;

export const WORKFLOW_OPERATORS = [
  { value: "equals", label: "برابر باشد با" },
  { value: "not_equals", label: "مخالف باشد با" },
  { value: "greater_than", label: "بیشتر باشد از" },
  { value: "less_than", label: "کمتر باشد از" },
  /*
   * The one a rule could not be written without, and it was reported as the
   * assistant refusing to build one: «اگر پروژه در وضعیت جدید **یا** در حال
   * مذاکره بود».
   *
   * Conditions are ANDed, so two values of one field was not a condition at
   * all — it was two rules, which is two cards saying one thing and drifting
   * apart, or five «مخالف باشد با …» that have to be revisited every time the
   * module gains a status. Neither is what anybody means.
   */
  { value: "in", label: "یکی از این‌ها باشد" },
] as const satisfies readonly { value: WorkflowRule["conditions"][number]["operator"]; label: string }[];

/**
 * An `in` condition that names nothing, or null.
 *
 * Asked at save time for the reason `staleConditionField` is: an empty list
 * matches no record, so the rule saves cleanly, prints on its card and never
 * fires — the catalogue's own silent failure, reached this time by choosing an
 * operator and then not answering it. The field is **named**, because «یک شرط
 * ناقص» sends somebody hunting through six rows.
 */
export function emptyInCondition(
  rule: { conditions?: readonly { field?: string; operator?: string; value?: string }[] | null },
): string | null {
  for (const cond of rule.conditions ?? []) {
    if (cond?.operator !== "in") continue;
    if (conditionValueList(cond?.value).length === 0) return String(cond?.field ?? "");
  }
  return null;
}

/** Fails `npm run lint` for an operator the rule card cannot name. */
const _everyOperatorIsOffered: Covers<
  WorkflowRule["conditions"][number]["operator"],
  readonly typeof WORKFLOW_OPERATORS[number]["value"][]
> = true;
void _everyOperatorIsOffered;

/**
 * «این پیام فقط یک بار برود» — and *once per what* is the whole question.
 *
 * A rule fires on a record, and for a customer-facing message the record is
 * usually not the thing the customer experiences. A project here carries
 * several supplier inquiries (one per part of the scope) and can be delivered
 * in several consignments, so «وقتی نتیجهٔ استعلام ثبت شد به مشتری خبر بده»
 * sends three identical messages for one job, and «یک ماه پس از تحویل» sends
 * one per packing list. Neither is a repeat *of a record* — each firing is a
 * different record — so nothing scoped to the record could have stopped them.
 *
 * There is therefore no sensible default, and the field is the switch: absent
 * is off, and choosing an option **is** choosing the scope. Guessing one would
 * be the code picking a number nobody typed, the way `escalateAfterOccurrences`
 * refuses to.
 */
export const MESSAGE_ONCE_SCOPES = [
  {
    value: "RECORD", label: "یک بار برای همین رکورد",
    hint: "همان رکوردی که قانون رویش اجرا شد. جلوی تکرار روی یک سند را می‌گیرد "
      + "(مثلاً استعلامی که وضعیتش چند بار عوض می‌شود) و دربارهٔ سندهای دیگرِ "
      + "همان پروژه چیزی نمی‌گوید.",
  },
  {
    value: "PROJECT", label: "یک بار برای هر پروژه",
    hint: "برای پیام‌هایی که دربارهٔ خودِ کار است، نه دربارهٔ یک سند. سه استعلام "
      + "یا سه محمولهٔ یک پروژه یک پیام می‌گیرند.",
  },
  {
    value: "CUSTOMER", label: "یک بار برای هر مشتری",
    hint: "این جمله هرگز دو بار به این آدم نرود، از هر پروژه‌ای که باشد. برای "
      + "پیام‌های معرفی و خوش‌آمد.",
  },
] as const;

export type MessageOnceScope = typeof MESSAGE_ONCE_SCOPES[number]["value"];

export function isMessageOnceScope(value: unknown): value is MessageOnceScope {
  return MESSAGE_ONCE_SCOPES.some((s) => s.value === value);
}

/**
 * What this firing is «once per», or null when the scope cannot be answered.
 *
 * **Null is refused rather than sent**, and that is the safe direction here: a
 * rule whose author asked for one message per project, firing on a payload that
 * names no project, cannot keep that promise — and sending anyway is exactly
 * the duplicate the switch was turned on to prevent. The outbox says nothing
 * either way, so the engine reports it the way every other unreachable message
 * is reported.
 */
export function messageOnceKey(
  scope: MessageOnceScope,
  payload: Record<string, unknown>,
): string | null {
  const text = (value: unknown) => {
    const out = String(value ?? "").trim();
    return out || null;
  };
  if (scope === "PROJECT") return text(payload.projectId);
  if (scope === "CUSTOMER") return text(payload.customerId);
  const id = text(payload.entityId);
  const type = text(payload.entityType);
  return id && type ? `${type}:${id}` : null;
}

/** The Persian name of an action, or its raw id for one a stored rule invented. */
export function actionLabel(type: string): string {
  return WORKFLOW_ACTION_TYPES.find((a) => a.value === type)?.label ?? type;
}

/** The Persian name of an operator, or its raw id. */
export function operatorLabel(operator: string): string {
  return WORKFLOW_OPERATORS.find((o) => o.value === operator)?.label ?? operator;
}

/**
 * What a condition's field is *called*, for a card that has only its key.
 *
 * Takes the **model** rather than the schedule subject, exactly as
 * `templateVariablesFor` does and for the same reason: it keeps
 * `workflowSchedule.ts` out of this file's imports, and the caller already
 * knows which record its rule counts from.
 */
export function conditionFieldLabel(
  triggerType: string,
  model: string | null,
  field: string,
): string {
  const fields = triggerType === "time_elapsed"
    ? (model && SCHEDULE_MODEL_FIELDS[model]) || []
    : triggerFields(triggerType);
  return fields.find((f) => f.value === field)?.label ?? field;
}

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

/**
 * A condition naming a field its own rule cannot offer, or null.
 *
 * A scheduled rule's conditions are about the **record its date belongs to**, so
 * changing the schedule's subject changes which fields exist — and the subject
 * `<select>` changed it while leaving the conditions exactly as they were. A rule
 * written on «تاریخ ارسال پیش‌فاکتور» with a condition on `settled`, re-pointed at
 * «آخرین تغییر وضعیت سفارش خرید», then stored `settled` against a payload that
 * never carries it: the rule saved cleanly, printed a condition on its card, and
 * **never fired**.
 *
 * And the form could not show it either: a `<select>` whose value matches no
 * option renders the **first** one, so the screen read «وضعیت سفارش خرید» while
 * the rule held `settled` — two different things, one of them invisible.
 *
 * Refusing the save is where this can be noticed, which is the same answer the
 * speechless `send_message` gets. It names the field rather than counting them,
 * because «یک شرط نامعتبر» sends somebody looking through a list of six.
 */
export function staleConditionField(
  rule: {
    triggerType?: string;
    schedule?: { subject?: string } | null;
    conditions?: readonly { field?: string }[] | null;
  },
  model?: string | null,
): string | null {
  const offered = rule.triggerType === "time_elapsed"
    ? (model ? SCHEDULE_MODEL_FIELDS[model] ?? [] : [])
    : triggerFields(String(rule.triggerType ?? ""));
  const names = offered.map((f) => f.value);
  for (const cond of rule.conditions ?? []) {
    const field = String(cond?.field ?? "").trim();
    if (field && !names.includes(field)) return field;
  }
  return null;
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
  /*
   * A scheduled rule's date says **when to look**; its condition says whether
   * the situation is still the one the rule was written about. The sweep
   * re-reads the record and `matchesConditions` runs at fire time, so that half
   * always worked — what was missing was anything to ask.
   *
   * This list was `status`, `currency`, `finalAmount`, and `status` is the
   * two-value *stored* column: a quotation that had been **won a week ago**
   * still reads «ارسال شده». So «یک هفته پس از ارسال پیش‌فاکتور، نتیجهٔ بررسی را
   * از مشتری بپرس» wrote to customers whose order the company had already won,
   * lost, or cancelled, and to ones who had asked to be approached after
   * Nowruz — every time, with nothing on any screen saying so. Reported from
   * the other end («فیدبکش را داده و توپ در زمین ماست») and true of far more
   * cases than the one reported.
   *
   * The four below are the states that answer «is this still the situation»,
   * and each catches a different way it stops being true.
   */
  proforma: [
    {
      value: "status", label: "وضعیت ارسال پیش‌فاکتور", options: PROFORMA_STORED_STATUSES,
      hint: "فقط همین دو مقدار را دارد و می‌گوید سند ارسال شده یا نه — نه اینکه "
        + "معامله چه شد. برای آن از outcome استفاده کن.",
    },
    {
      value: "settled", label: "معامله تعیین تکلیف شده", options: ["true", "false"],
      derived: true,
      hint: "true یعنی این پیش‌فاکتور برنده، باخته، لغو یا نیمه‌برنده شده و دیگر "
        + "چیزی برای پرسیدن از مشتری نمانده. **هر پیام خودکاری که از مشتری «نتیجه "
        + "چه شد؟» می‌پرسد باید شرط «برابر با false» داشته باشد** — وگرنه برای "
        + "مشتری‌ای هم می‌رود که هفتهٔ پیش سفارشش را قطعی کرده. یک شرط است به‌جای "
        + "چهار شرط «مخالف با …» روی outcome.",
    },
    {
      value: "outcome", label: "نتیجه نهایی پیش‌فاکتور", options: PROFORMA_OUTCOMES,
      derived: true,
      hint: "از وضعیت ردیف‌ها و لغو سند محاسبه می‌شود، نه از ستون status. برای "
        + "«هنوز تصمیمی گرفته نشده» از settled استفاده کن؛ این فیلد وقتی به کار "
        + "می‌آید که یک نتیجهٔ مشخص را نام ببری — مثلاً نظرسنجی فقط برای "
        + "«تأیید شده (برنده)». توجه: سندی که ارسال شده و هنوز تصمیمی رویش گرفته "
        + "نشده «ارسال شده» است، نه «جاری»؛ «جاری» برای سندی است که وضعیت "
        + "ثبت‌شده‌اش هیچ‌کدام از آن دو نیست.",
    },
    {
      value: "followUpState", label: "وضعیت پیگیری فروش", options: FOLLOW_UP_STATES,
      hint: "OPEN یعنی پیگیری باز است؛ DEFERRED یعنی خودِ مشتری خواسته بعداً تماس "
        + "بگیریم (تاریخش در همان سند است) و پیام خودکار در این حالت دقیقاً همان "
        + "چیزی است که او خواسته نشود؛ NO_RESPONSE یعنی جواب نداده.",
    },
    {
      value: "superseded", label: "نسخهٔ جدیدتری از آن صادر شده", options: ["true", "false"],
      derived: true,
      hint: "true یعنی کسی «نسخه جدید همین پیش‌فاکتور» زده — یعنی بازخورد مشتری "
        + "اعمال شده و این سند دیگر آن چیزی نیست که روی میز اوست.",
    },
    {
      value: "chaseCount", label: "تعداد پیگیری‌های ثبت‌شده", derived: true,
      hint: "چند بار نتیجهٔ تماس روی این پیش‌فاکتور ثبت شده. «برابر با ۰» یعنی از "
        + "زمان ارسال هیچ‌کس چیزی ثبت نکرده — که تنها حالتی است که پرسیدن «نتیجهٔ "
        + "بررسی چه شد؟» از مشتری واقعاً بی‌خطر است.",
    },
    { value: "currency", label: "ارز سند" },
    { value: "finalAmount", label: "مبلغ نهایی" },
  ],
  project: [
    {
      value: "status", label: "وضعیت پروژه", options: PROJECT_STATUSES,
      hint: "نتیجه تجاری فروش است و بس — برنده/باخته/در جریان. با ترخیص گمرک یا "
        + "تحویل کالا تکان نمی‌خورد؛ برای «کار کجاست» از فیلد stage «مرحله پروژه» استفاده کن. "
        + "«۳ روز پس از ثبت باخت» هم با همین فیلد گفته می‌شود: schedule.subject را "
        + "project_status_changed بگذار (آخرین تغییر وضعیت پروژه) و شرط status = باخته.",
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
      hint: "کار روی این پروژه تا کجا رسیده — محاسبه‌شده از رکوردهای خودش (به‌جز "
        + "«در حال بررسی فنی» که فقط دستی انتخاب می‌شود). "
        + "«جدید» یعنی هنوز نه استعلام قیمتی ثبت شده و نه پیش‌فاکتوری صادر شده؛ "
        + "«در حال مذاکره» همان و فقط وضعیت پروژه دستی روی مذاکره است؛ "
        + "«در حال بررسی فنی» تنها مرحله‌ای است که محاسبه نمی‌شود و فقط دستی "
        + "انتخاب می‌شود — یعنی هنوز هیچ سندی صادر نشده و داریم بررسی می‌کنیم تا "
        + "آفر مناسب بدهیم؛ "
        + "«در انتظار پاسخ تأمین‌کننده» یعنی استعلام رفته و قیمتی برنگشته؛ "
        + "«بررسی پیشنهاد تأمین‌کننده» یعنی قیمت آمده و هنوز برنده انتخاب نشده؛ "
        + "«تهیه پیش‌فاکتور» یعنی پیش‌فاکتور در دست تهیه است؛ «بررسی آفر توسط مشتری» یعنی "
        + "برای مشتری ارسال شده. پس هر پرسشی از جنس «فلان کار هنوز انجام نشده» یا "
        + "«اینجا گیر کرده» را با همین فیلد بپرس.",
    },
    /*
     * «هنوز پیش‌فاکتوری برایش صادر نشده», asked directly.
     *
     * The stage *nearly* answers it — «جدید» and «در حال مذاکره» both mean no
     * inquiry and no quotation — and that «and no inquiry» is the difference:
     * a job somebody has already sent three supplier inquiries for reads
     * «در انتظار پاسخ تأمین‌کننده», so a rule written on the stage silently
     * excludes it. For «has anybody quoted this» that narrowing is somebody
     * else's question, and the two are worth being able to ask apart.
     *
     * It counts **every** kind of document, technical offers included, exactly
     * as `quotationWhere`'s «بدون هیچ پیش‌فاکتوری» does: the label says «no
     * document», a technical offer is a document, and two readings of «does
     * this project have a quotation» disagreeing is the fault that clause was
     * corrected for. A rule that means the priced kind asks the stage instead.
     */
    {
      value: "proformaCount", label: "تعداد پیش‌فاکتورهای صادرشده", derived: true,
      hint: "چند پیش‌فاکتور تا حالا برای این پروژه صادر شده — از هر نوعی، فنی و "
        + "مالی و خدمات پس از فروش. «برابر با ۰» یعنی هنوز هیچ سندی صادر نشده، که "
        + "همان «پیش‌فاکتور صادر نشده» است. توجه: این با مرحلهٔ «جدید» یکی نیست — "
        + "«جدید» علاوه بر نداشتن پیش‌فاکتور، نداشتنِ استعلام قیمت را هم شرط می‌کند، "
        + "پس پروژه‌ای که برایش استعلام رفته از «جدید» بیرون می‌رود ولی اینجا هنوز ۰ است.",
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
  /*
   * The key is the **schedule subject's `model`**, and this one was spelled
   * `delivery` while every packing-list subject says `packagingDelivery` — so
   * the lookup missed and a scheduled rule on a packing list offered *no
   * condition field at all*. The rule editor happened to hide it, because it
   * falls back to a named entry when the model is unknown and this was the
   * entry it fell back to; the drafter has no fallback, so the assistant could
   * never write a condition on such a rule and its prompt advertised a model
   * nothing could select. Exactly the drift this catalogue exists to end,
   * arriving as a plain misspelling. `test:rules` now holds the two key sets
   * against each other in both directions.
   */
  packagingDelivery: [
    { value: "actualDeliveryDateJalali", label: "تاریخ تحویل قطعی به کارفرما" },
    {
      value: "openAfterSalesCount", label: "خدمات پس از فروش باز روی این پروژه",
      derived: true,
      hint: "چند پروندهٔ خدمات پس از فروشِ هنوز بازْ روی همین پروژه هست. پیام "
        + "«امیدواریم نصب خوب پیش رفته باشد و اگر کمکی لازم دارید ما هستیم» باید "
        + "شرط «برابر با ۰» داشته باشد — وگرنه برای مشتری‌ای هم می‌رود که شکایت "
        + "گارانتی‌اش همین حالا روی میز ماست، و آن پیام یعنی «خبر نداریم».",
    },
  ],
  afterSalesService: [
    { value: "status", label: "وضعیت خدمات پس از فروش", options: AFTER_SALES_STATUSES },
  ],
  /*
   * Only a recorded sales chase — the subject narrows to it, so a condition
   * naming `taskKind` here would be one nobody has to remember to write.
   *
   * `followUpResult` is **free text** for the reason every list drawn from
   * `settings.dropdownItems` is: it is the company's own editable wording, and
   * a fixed option list here would be a second copy of it that drifts.
   */
  task: [
    {
      value: "followUpResult", label: "نتیجهٔ پیگیری",
      hint: "همان چیزی که مشتری گفت، از فهرست «نتایج پیگیری» در تنظیمات — مثلاً "
        + "«تأیید نهایی خرید» یا «موکول به تاریخ دیگر». دقیقاً همان نوشتهٔ فهرست "
        + "را بنویس، وگرنه شرط هیچ‌وقت برقرار نمی‌شود.",
    },
    { value: "priority", label: "اولویت پیگیری", options: TASK_PRIORITIES },
    {
      value: "proformaId", label: "به پیش‌فاکتور وصل است", derived: true,
      hint: "شناسهٔ پیش‌فاکتوری که این پیگیری روی آن ثبت شده. معمولاً شرطی روی آن "
        + "نمی‌گذاری؛ همین که روی payload هست باعث می‌شود «{proformaNumber}» در "
        + "متن کار کند و پیام به مشتریِ همان سند برسد.",
    },
    /*
     * And what became of the quotation, which is the half this subject could not
     * ask. «۲ روز پس از ثبت نتیجهٔ پیگیری، لینک نظرسنجی بفرست» is the rule it
     * exists for, and with only the result and the priority to condition on the
     * survey went to a customer who had cancelled the next morning — the same
     * fault the `proforma` subject's `status` field once had, arriving here
     * instead. These are the *quotation's* state and share the proforma
     * subject's own names, so one condition is written whichever subject the
     * rule counts from.
     */
    {
      value: "settled", label: "معامله تمام شده", options: ["true", "false"],
      derived: true,
      hint: "true یعنی همین سند برنده/باخته/لغو شده یا نیمه‌برنده است — یعنی تمام "
        + "شده و دیگر در صف پیگیری نیست. هر پیامی که فرض می‌گیرد «هنوز در جریان "
        + "است» (نظرسنجی، یادآوری، پرسیدن نتیجهٔ بررسی) باید شرط «برابر با false» "
        + "داشته باشد؛ وگرنه دو روز بعد از تماس برای مشتری‌ای می‌رود که همان فردا "
        + "خریدش را لغو کرده.",
    },
    {
      value: "outcome", label: "نتیجهٔ پیش‌فاکتور", options: PROFORMA_OUTCOMES,
      derived: true,
      hint: "وضعیت محاسبه‌شدهٔ همان پیش‌فاکتور از ردیف‌هایش. اگر فقط می‌خواهی «تمام "
        + "نشده باشد» را بگویی، شرط روی settled کوتاه‌تر و مطمئن‌تر است.",
    },
    {
      value: "superseded", label: "نسخهٔ جدیدتری از آن صادر شده",
      options: ["true", "false"], derived: true,
      hint: "true یعنی «نسخه جدید همین پیش‌فاکتور» صادر شده؛ سندی که این پیگیری "
        + "روی آن ثبت شده دیگر آن چیزی نیست که روی میز مشتری است.",
    },
  ],
};


/* ------------------------ what a template may say ------------------------- */

/**
 * The variables `enrichPayload` puts on **every** payload before a rule's
 * templates are rendered, whatever the trigger.
 *
 * `replaceTemplateVars` prints a token it has no value for **exactly as
 * written**, so `{customerName}` in a title the payload cannot fill reaches a
 * colleague's task card as the literal six characters plus braces — the
 * `{dueDate}` fault the staff templates were corrected for, arriving on the one
 * screen where nobody would think to look for it.
 *
 * This list is therefore the *guarantee*, not a suggestion, and `test:rules`
 * holds every entry against an `enriched.<key> =` in `enrichPayload` — because
 * a hand-typed list beside the thing it describes is how the assignee dropdown
 * came to offer eleven options the responsibles table did not have.
 *
 * A trigger's **own** fields are variables too (they are the payload's own
 * keys, which is the same fact that lets a condition name them), so the usable
 * set is this list plus `triggerFields` — see `templateVariablesFor`.
 */
export interface TemplateVariable {
  key: string;
  label: string;
  /**
   * The payload keys `enrichPayload` resolves this one from.
   *
   * **A guarantee has to be conditional or it is not one.** Every entry below
   * was offered for every trigger, and `enrichPayload` resolves each of them
   * from an id — `proformaNumber` from `proformaId`, `projectName` from
   * `projectId` — so a trigger whose payload carries no such id could never
   * fill it in. The screen offered `{proformaNumber}` on a project rule, the
   * renderer printed those sixteen characters verbatim, and a colleague read
   * «پیش‌فاکتور شماره {proformaNumber}» on their task card. Reported exactly
   * that way, on a job that had no quotation at all.
   *
   * So a variable is offered only where the trigger can reach the record
   * behind it — `TRIGGER_PAYLOAD_KEYS` below says what each one carries.
   */
  needs: readonly string[];
}

export const ENRICHED_PAYLOAD_VARIABLES: readonly TemplateVariable[] = [
  { key: "projectName", label: "نام پروژه", needs: ["projectId", "proformaId"] },
  { key: "projectCode", label: "کد پروژه", needs: ["projectId", "proformaId"] },
  /*
   * A customer is reached from its own id or from a quotation's, and **never
   * from a project**: `enrichPayload` reads `customerId` and nothing resolves
   * one from a job, so the project triggers carry it themselves.
   */
  { key: "customerName", label: "نام مشتری", needs: ["customerId", "proformaId"] },
  { key: "supplierName", label: "نام تأمین‌کننده", needs: ["supplierId"] },
  { key: "productName", label: "نام کالا", needs: ["productId"] },
  { key: "proformaNumber", label: "شماره پیش‌فاکتور", needs: ["proformaId", "proformaNumber"] },
  { key: "poNumber", label: "شماره سفارش خرید", needs: ["purchaseOrderId", "poNumber"] },
  /*
   * Both spellings, because `enrichPayload` syncs them in both directions: a
   * trigger that emits `status` gets `newStatus` and the other way round, so a
   * template may use either and neither is the "wrong" one — which is also why
   * each names the other among the keys that produce it.
   */
  { key: "newStatus", label: "وضعیت جدید", needs: ["newStatus", "status"] },
  { key: "status", label: "وضعیت", needs: ["newStatus", "status"] },
  { key: "newOutcome", label: "نتیجه جدید", needs: ["newOutcome", "outcome"] },
  { key: "outcome", label: "نتیجه", needs: ["newOutcome", "outcome"] },
];

/**
 * What each event's payload actually carries, for the enrichment to key on.
 *
 * Spelled out per trigger rather than derived, exactly as `TRIGGER_ENTITY` is
 * and for the same reason: it sits beside the trigger it describes, and
 * `test:rules` holds every entry against the keys the service really emits —
 * in **both** directions, so a payload that gains an id and a table that
 * claims one the service does not send both fail here rather than shipping as
 * a variable that prints itself.
 *
 * Only the keys a `TemplateVariable` can be produced from are listed; a
 * trigger's own condition fields are variables through `triggerFields` and
 * need no entry. **A status is listed in the spelling the service actually
 * sends and no other** — `task_completed` emits `newStatus` alone — because
 * `enrichPayload` syncs the two in both directions and the variable's own
 * `needs` names both, so `{status}` still resolves there. Claiming a spelling
 * the emitter does not send would make this table a second, softer answer to
 * what the payload holds, which is the drift it exists to prevent. `time_elapsed` is null because a scheduled rule's record is
 * its schedule *model*, which `SCHEDULE_MODEL_PAYLOAD_KEYS` answers.
 */
export const TRIGGER_PAYLOAD_KEYS: Record<
  WorkflowTriggerType, readonly string[] | null
> = {
  proforma_created: ["proformaId", "proformaNumber", "projectId", "customerId", "status"],
  proforma_status_change: ["proformaId", "proformaNumber", "projectId", "customerId", "newStatus", "status"],
  proforma_outcome_change: ["proformaId", "proformaNumber", "projectId", "customerId", "newOutcome", "outcome"],
  project_created: ["projectId", "customerId", "status"],
  project_status_change: ["projectId", "customerId", "newStatus", "status"],
  project_stage_change: ["projectId", "customerId", "status"],
  customer_created: ["customerId"],
  customer_updated: ["customerId"],
  supplier_created: ["supplierId"],
  supplier_inquiry_created: ["inquiryId", "projectId", "supplierId"],
  supplier_inquiry_status_change: ["inquiryId", "projectId", "supplierId", "newStatus", "status"],
  purchase_order_created: ["purchaseOrderId", "poNumber", "projectId", "supplierId", "status"],
  purchase_order_status_change: ["purchaseOrderId", "poNumber", "projectId", "supplierId", "newStatus", "status"],
  product_created: ["productId"],
  product_low_stock: ["productId"],
  packaging_delivery_created: ["deliveryId", "proformaId", "projectId"],
  packaging_delivery_status_change: ["deliveryId", "proformaId", "projectId", "newStatus", "status"],
  after_sales_service_created: ["serviceId", "projectId", "status"],
  after_sales_service_status_change: ["serviceId", "projectId", "newStatus", "status"],
  transaction_created: ["transactionId", "projectId", "customerId"],
  transaction_status_change: ["transactionId", "projectId", "customerId", "newStatus", "status"],
  /*
   * A task names its project only when it is *about* one — `relatedToType`
   * decides that — so `{projectName}` is offered and may still be blank on a
   * task raised against a quotation or a customer. That is the honest reading:
   * the trigger can reach a project, and a particular record may not have one.
   * It reaches no quotation at all, which is why `{proformaNumber}` is not
   * offered here even for a sales chase.
   */
  task_created: ["taskId", "projectId"],
  task_status_change: ["taskId", "projectId", "newStatus", "status"],
  task_completed: ["taskId", "projectId", "newStatus"],
  referral_created: ["referralId", "projectId"],
  referral_status_change: ["referralId", "projectId", "newStatus", "status"],
  activity_category_completed: ["groupId", "projectId"],
  project_milestone_completed: ["milestoneId", "projectId"],
  follow_up_completed: ["taskId", "proformaId", "proformaNumber", "projectId"],
  time_elapsed: null,
};

/**
 * The same question for a scheduled rule, asked of the record it counts from.
 *
 * Keyed by the schedule **model** for the reason `SCHEDULE_MODEL_FIELDS` is:
 * it keeps `workflowSchedule.ts` out of this file's imports, and a scheduled
 * rule's variables are about the record its date belongs to rather than about
 * the trigger. `test:rules` holds the two key sets against each other in both
 * directions, so a model with no entry here cannot pass by having nothing to
 * check — which is precisely how the `delivery`/`packagingDelivery` misspelling
 * survived.
 */
export const SCHEDULE_MODEL_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  proforma: ["proformaId", "proformaNumber", "projectId", "customerId", "status"],
  project: ["projectId", "customerId", "status"],
  purchaseOrder: ["purchaseOrderId", "poNumber", "projectId", "supplierId", "status"],
  afterSalesService: ["serviceId", "projectId", "proformaNumber", "status"],
  packagingDelivery: ["deliveryId", "proformaId", "projectId"],
  supplierInquiry: ["inquiryId", "projectId", "supplierId"],
  /*
   * The sales chase, and it **does** reach its quotation: the sweep projects
   * `relatedToId` across into `proformaId` precisely so `enrichPayload` can
   * find the document's project and customer, which is the step the event
   * triggers above have no equivalent of.
   */
  task: ["taskId", "proformaId", "projectId"],
};

/**
 * Every variable a rule's title, description or notification may use.
 *
 * The trigger's own condition fields first — they are what makes «عنوان: تمدید
 * {milestoneTitle}» possible at all, and a hand-typed list of six could never
 * have named them — then the enrichment keys above.
 *
 * For a scheduled rule the fields come from the *record* its date belongs to,
 * exactly as a condition's do — so this takes the **model** rather than the
 * subject, which keeps the subject catalogue (`workflowSchedule.ts`) out of
 * this file's imports and mirrors `fieldsFor` in the drafter, where the same
 * resolution already happens.
 */
export function templateVariablesFor(
  triggerType: string,
  model?: string | null,
): TemplateVariable[] {
  const scheduled = triggerType === "time_elapsed";
  const own = scheduled
    ? (model && SCHEDULE_MODEL_FIELDS[model]) || []
    : triggerFields(triggerType);

  /*
   * What this event's payload can be keyed on, which is what decides whether
   * an enriched variable resolves at all.
   *
   * A trigger this build does not know answers **nothing**, so it offers only
   * its own fields rather than the whole list — the safe direction, since the
   * cost of withholding a variable is somebody typing a key by hand, while the
   * cost of offering one is a token printed verbatim to a colleague, which is
   * the fault being corrected.
   */
  const carried = new Set<string>(
    scheduled
      ? (model && SCHEDULE_MODEL_PAYLOAD_KEYS[model]) || []
      : TRIGGER_PAYLOAD_KEYS[triggerType as WorkflowTriggerType] ?? [],
  );

  const seen = new Set<string>();
  const all: TemplateVariable[] = [];
  for (const field of own) {
    if (seen.has(field.value)) continue;
    seen.add(field.value);
    // A condition field *is* a payload key, so it always resolves: it needs
    // itself and nothing else.
    all.push({ key: field.value, label: field.label, needs: [field.value] });
  }
  for (const variable of ENRICHED_PAYLOAD_VARIABLES) {
    if (seen.has(variable.key)) continue;
    if (!variable.needs.some((key) => carried.has(key))) continue;
    seen.add(variable.key);
    all.push(variable);
  }
  return all;
}

/**
 * The `{tokens}` in a template this rule's own payload cannot fill in.
 *
 * **The pattern is `replaceTemplateVars`'s own** — it matches one or two
 * braces and prints anything it cannot resolve exactly as written, so a check
 * reading tokens differently would pass while the card still says
 * `{proformaNumber}`; `test:rules` holds the two against each other, as it
 * already does for the drafter's copy.
 *
 * It **warns and never refuses**: a template is free text and a person may
 * legitimately write braces, so blocking the save would be a refusal about the
 * wrong thing — the drafter's own rule, one screen along.
 */
const TEMPLATE_TOKEN_PATTERN = /\{{1,2}([^{}]+)\}{1,2}/g;

export function unresolvableTemplateTokens(
  template: string,
  triggerType: string,
  model?: string | null,
  extraKeys: readonly string[] = [],
): string[] {
  const allowed = new Set<string>([
    ...templateVariablesFor(triggerType, model).map((v) => v.key),
    ...extraKeys,
  ]);
  const found: string[] = [];
  for (const match of String(template ?? "").matchAll(TEMPLATE_TOKEN_PATTERN)) {
    const key = match[1].trim();
    if (key && !allowed.has(key) && !found.includes(key)) found.push(key);
  }
  return found;
}

/** True when the id is a module that can carry a responsible. */
export function isResponsibleModule(value: string): boolean {
  return RESPONSIBLE_MODULES.some((m) => m.id === value);
}
