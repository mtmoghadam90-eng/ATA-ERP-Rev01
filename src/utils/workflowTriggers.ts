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
import {
  AFTER_SALES_STATUSES, CUSTOMER_TYPES, DELIVERY_WORKFLOW_STATUSES,
  INQUIRY_WORKFLOW_STATUSES, PROFORMA_OUTCOMES, PROJECT_STATUSES,
  PURCHASE_ORDER_STATUSES, TRANSACTION_TYPES,
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
}

export interface TriggerSpec {
  label: string;
  /** The heading it sits under in the trigger dropdown. */
  group: string;
  fields: readonly TriggerField[];
}

const TASK_PRIORITIES = ["پایین", "متوسط", "بالا", "فوری"] as const;

/** «برای انجام» and the rest, plus the value every automation actually writes. */
const TASK_STATUS_OPTIONS = TASK_STATUSES;

const G = {
  SALES: "پیش‌فاکتورها و پروژه‌ها",
  BUYING: "خرید و تأمین‌کنندگان",
  STOCK: "کالاها و انبار",
  SERVICE: "خدمات پس از فروش",
  MONEY: "مالی و پرداخت‌ها",
  WORK: "وظایف و ارجاعات",
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
      { value: "status", label: "وضعیت پیش‌فاکتور", options: ["پیش‌نویس", "ارسال شده"] },
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
     * The stored column, not the derived outcome: only «پیش‌نویس» and «ارسال
     * شده» ever live there, and that list is the user's own — the editor reads
     * `settings.dropdownItems.proformaStatuses` over these.
     */
    fields: [
      { value: "newStatus", label: "وضعیت جدید ثبت‌شده", options: ["پیش‌نویس", "ارسال شده"] },
      { value: "oldStatus", label: "وضعیت قبلی ثبت‌شده", options: ["پیش‌نویس", "ارسال شده"] },
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
export const SCHEDULE_MODEL_FIELDS: Record<string, readonly TriggerField[]> = {
  proforma: [
    { value: "status", label: "وضعیت ارسال پیش‌فاکتور", options: ["پیش‌نویس", "ارسال شده"] },
    { value: "currency", label: "ارز سند" },
    { value: "finalAmount", label: "مبلغ نهایی" },
  ],
  project: [{ value: "status", label: "وضعیت پروژه", options: PROJECT_STATUSES }],
  purchaseOrder: [
    { value: "status", label: "وضعیت سفارش خرید", options: PURCHASE_ORDER_STATUSES },
  ],
  supplierInquiry: [{ value: "isWinner", label: "آفر برنده است", options: ["true", "false"] }],
  delivery: [{ value: "actualDeliveryDateJalali", label: "تاریخ تحویل قطعی" }],
};
