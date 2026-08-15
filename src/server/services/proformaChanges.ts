import { toPersianDigits } from "../../numUtils";
import { formatMoney } from "../../numUtils";
import { getProformaOutcome } from "../proformaStatus";

/**
 * What actually changed in a proforma, written out for the project timeline.
 *
 * The entry used to read «پیش‌فاکتور شماره X توسط Y ویرایش شد» and stop there,
 * which tells a reader that something happened and nothing about what. The
 * timeline is meant to bring somebody who knows nothing about the job up to
 * date, so an edit has to say what it did: the price moved, a line was added,
 * the document was sent, the validity was extended.
 *
 * It also said the wrong thing. «نتیجه اقلام این پیش‌فاکتور از پیش‌نویس به
 * ارسال شده تغییر یافت» describes the *document's* send status as though it
 * were the outcome of its lines — two different things that happen to share one
 * function, because `getProformaOutcome` falls back to the workflow status
 * while no line has been marked won or lost. Sending a quotation is not a
 * result, and it does not re-derive the project's status; only a line outcome
 * does. The two are told apart here, and the project is only mentioned when its
 * status genuinely moved.
 *
 * Pure, so the wording is covered by `npm run test:rules`.
 */

export interface ChangeItem {
  productName?: string | null;
  quantity?: unknown;
  unitPriceRial?: unknown;
  status?: string | null;
  supplyMethod?: string | null;
}

export interface ChangeSnapshot {
  status?: string | null;
  isCancelled?: boolean | null;
  currency?: string | null;
  finalAmount?: unknown;
  discountPercent?: unknown;
  taxPercent?: unknown;
  issueDateJalali?: string | null;
  expiryDateJalali?: string | null;
  deliveryDateJalali?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  notes?: string | null;
  items?: ChangeItem[] | null;
}

/** Names the ids cannot carry, resolved by the caller that has the database. */
export interface ChangeLabels {
  customerBefore?: string | null;
  customerAfter?: string | null;
  projectBefore?: string | null;
  projectAfter?: string | null;
  /** The project's own status, read before and after the write. */
  projectStatusBefore?: string | null;
  projectStatusAfter?: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => String(v ?? "").trim();
const count = (n: number): string => toPersianDigits(n);

/** An outcome that the lines decided, as opposed to the document's send status. */
function isLineOutcome(outcome: string): boolean {
  return outcome === "تأیید شده (برنده)" || outcome === "نیمه برنده"
    || outcome === "باخته" || outcome === "لغو شده";
}

/** Lines are re-inserted on every save, so they are matched by name, not by id. */
function byName(items: ChangeItem[] | null | undefined): Map<string, ChangeItem> {
  const map = new Map<string, ChangeItem>();
  for (const item of items ?? []) {
    const name = text(item.productName);
    if (name && !map.has(name)) map.set(name, item);
  }
  return map;
}

function itemClauses(before: ChangeItem[], after: ChangeItem[]): string[] {
  const clauses: string[] = [];
  const was = byName(before);
  const now = byName(after);

  const added = [...now.keys()].filter((n) => !was.has(n));
  const removed = [...was.keys()].filter((n) => !now.has(n));
  const naming = (names: string[]) =>
    names.slice(0, 3).map((n) => `«${n}»`).join("، ")
    + (names.length > 3 ? ` و ${count(names.length - 3)} قلم دیگر` : "");

  if (added.length) clauses.push(`${count(added.length)} قلم به سند اضافه شد: ${naming(added)}`);
  if (removed.length) clauses.push(`${count(removed.length)} قلم از سند حذف شد: ${naming(removed)}`);

  const won: string[] = [], lost: string[] = [], cancelled: string[] = [];
  for (const [name, item] of now) {
    const previous = was.get(name);
    if (!previous) continue;

    if (text(previous.status) !== text(item.status)) {
      if (item.status === "برنده") won.push(name);
      else if (item.status === "بازنده") lost.push(name);
      else if (item.status === "لغو شده") cancelled.push(name);
    }
    if (num(previous.quantity) !== num(item.quantity)) {
      clauses.push(
        `تعداد ${`«${name}»`} از ${formatMoney(num(previous.quantity))}`
        + ` به ${formatMoney(num(item.quantity))} تغییر کرد`,
      );
    }
    if (num(previous.unitPriceRial) !== num(item.unitPriceRial)) {
      clauses.push(
        `بهای واحد ${`«${name}»`} از ${formatMoney(num(previous.unitPriceRial))}`
        + ` به ${formatMoney(num(item.unitPriceRial))} تغییر کرد`,
      );
    }
  }
  if (won.length) clauses.push(`${count(won.length)} قلم برنده شد: ${naming(won)}`);
  if (lost.length) clauses.push(`${count(lost.length)} قلم بازنده شد: ${naming(lost)}`);
  if (cancelled.length) clauses.push(`${count(cancelled.length)} قلم لغو شد: ${naming(cancelled)}`);

  return clauses;
}

/**
 * The list of changes, each a complete sentence fragment. Empty when the save
 * touched nothing worth telling anybody about.
 */
export function describeProformaChanges(
  before: ChangeSnapshot | null | undefined,
  after: ChangeSnapshot,
  labels: ChangeLabels = {},
): string[] {
  if (!before) return [];
  const clauses: string[] = [];

  if (!before.isCancelled && after.isCancelled) clauses.push("سند لغو شد");
  if (before.isCancelled && !after.isCancelled) clauses.push("لغو سند برداشته شد");

  // The send status: a workflow step on the document itself.
  if (text(before.status) !== text(after.status)) {
    clauses.push(
      `وضعیت ارسال پیش‌فاکتور از «${text(before.status) || "نامشخص"}»`
      + ` به «${text(after.status) || "نامشخص"}» تغییر کرد`,
    );
  }

  // The lines first, then the conclusion they add up to: what happened, and
  // then what it made the document.
  clauses.push(...itemClauses(before.items ?? [], after.items ?? []));

  // The outcome is reported only when the lines are what decided it —
  // otherwise it is the send status again, under another name.
  const outcomeBefore = getProformaOutcome(before);
  const outcomeAfter = getProformaOutcome(after);
  if (outcomeBefore !== outcomeAfter && (isLineOutcome(outcomeBefore) || isLineOutcome(outcomeAfter))) {
    clauses.push(`نتیجه کلی سند از «${outcomeBefore}» به «${outcomeAfter}» تغییر کرد`);
  }

  const currency = text(after.currency) || text(before.currency);
  if (text(before.currency) !== text(after.currency)) {
    clauses.push(`ارز سند از «${text(before.currency) || "نامشخص"}» به «${text(after.currency) || "نامشخص"}» تغییر کرد`);
  }
  if (num(before.finalAmount) !== num(after.finalAmount)) {
    clauses.push(
      `مبلغ نهایی از ${formatMoney(num(before.finalAmount))}`
      + ` به ${formatMoney(num(after.finalAmount))} ${currency || "ریال"} تغییر کرد`,
    );
  }
  if (num(before.discountPercent) !== num(after.discountPercent)) {
    clauses.push(`درصد تخفیف از ${formatMoney(num(before.discountPercent))} به ${formatMoney(num(after.discountPercent))} تغییر کرد`);
  }
  if (num(before.taxPercent) !== num(after.taxPercent)) {
    clauses.push(`درصد مالیات از ${formatMoney(num(before.taxPercent))} به ${formatMoney(num(after.taxPercent))} تغییر کرد`);
  }

  const dates: [keyof ChangeSnapshot, string][] = [
    ["issueDateJalali", "تاریخ صدور"],
    ["expiryDateJalali", "تاریخ اعتبار"],
    ["deliveryDateJalali", "تاریخ تحویل"],
  ];
  for (const [field, label] of dates) {
    const was = text(before[field]);
    const now = text(after[field]);
    if (was === now) continue;
    if (!was) clauses.push(`${label} روی ${now} تنظیم شد`);
    else if (!now) clauses.push(`${label} حذف شد`);
    else clauses.push(`${label} از ${was} به ${now} تغییر کرد`);
  }

  if (text(before.customerId) !== text(after.customerId)) {
    clauses.push(
      `خریدار سند از «${text(labels.customerBefore) || "نامشخص"}»`
      + ` به «${text(labels.customerAfter) || "نامشخص"}» تغییر کرد`,
    );
  }
  if (text(before.projectId) !== text(after.projectId)) {
    clauses.push(
      `سند از پروژه «${text(labels.projectBefore) || "بدون پروژه"}»`
      + ` به پروژه «${text(labels.projectAfter) || "بدون پروژه"}» منتقل شد`,
    );
  }
  if (text(before.notes) !== text(after.notes)) clauses.push("توضیحات و شرایط فروش ویرایش شد");

  // The project's status is derived from its proformas, so it may have moved as
  // a consequence — but only say so when it actually did.
  const projectWas = text(labels.projectStatusBefore);
  const projectNow = text(labels.projectStatusAfter);
  if (projectWas && projectNow && projectWas !== projectNow) {
    clauses.push(`وضعیت پروژه بر همین اساس از «${projectWas}» به «${projectNow}» بازمحاسبه شد`);
  }

  return clauses;
}

/** The whole sentence, ready for the timeline. */
export function proformaChangeSentence(
  proformaNumber: string,
  changes: string[],
): string {
  const head = `پیش‌فاکتور شماره ${proformaNumber} توسط {actor} ویرایش شد`;
  if (changes.length === 0) {
    // A save that changed nothing recordable still happened, and hiding it
    // would leave a gap between two entries that do mention the document.
    return `${head} (بدون تغییر در اطلاعات اصلی سند).`;
  }
  return `${head}: ${changes.join("؛ ")}.`;
}
