/**
 * «نتیجهٔ تماس با مشتری» — what a call to a customer came to.
 *
 * Asked for as calling prospects to ask whether they need anything now, then
 * recording what came of it. The call is an ordinary task related to the
 * customer, and the only place its answer could go was the free-text «شرح
 * اقدام» — so «از ۵۰ تماس این ماه چند تا نیاز داشتند» could not be asked.
 *
 * It is **its own column**, not `followUpResult`: that one is what a customer
 * said about a *quotation*, written only by `completeFollowUp`, and three of its
 * values settle a sale. A call to a prospect has no quotation behind it, and
 * reusing the column would put a prospect's «نیاز ندارد» beside a lost sale in
 * every reading of follow-up results.
 *
 * The list is the company's own (`settings.dropdownItems.contactResults`);
 * nothing in the code keys on any of its words. The report folds spelling
 * (`resultKey`'s rule — the hamza, ی/ي, ک/ك, spacing) so «تماس بعدی» typed two
 * ways is one row rather than two halves.
 */
import { taskRelationKind } from "./taskRelations";

export const DEFAULT_CONTACT_RESULTS = [
  "نیاز دارد — درخواست ثبت شد",
  "نیاز آتی دارد — تماس بعدی",
  "فعلاً نیازی ندارد",
  "پاسخ نداد",
  "شماره اشتباه / نامعتبر",
  "باید با شخص دیگری صحبت شود",
  "تمایلی به همکاری ندارد",
] as const;

/** What the report calls a completed call with no result chosen. */
export const CONTACT_RESULT_UNRECORDED = "ثبت نشده";

/**
 * Whether ticking this task off asks for a contact result.
 *
 * A task related to a customer, in either spelling the column is written in,
 * and never a sales chase — that one records `followUpResult` through its own
 * flow, and offering a second result box there would be two answers to one
 * call.
 */
export function takesContactResult(task: {
  relatedToType?: unknown; taskKind?: unknown;
} | null | undefined): boolean {
  if (!task) return false;
  if (String(task.taskKind ?? "").trim() === "SALES_FOLLOW_UP") return false;
  return taskRelationKind(task.relatedToType) === "customer";
}

/** The fold two spellings of one result share. */
export function contactResultKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‏‎]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export interface ContactResultRow {
  contactResult?: string | null;
  assignedToName?: string | null;
}

export interface ContactResultTally {
  result: string;
  count: number;
  percent: number;
}

export interface ContactResultSummary {
  total: number;
  recorded: number;
  byResult: ContactResultTally[];
  /** One row per person, with their own count per result (keys are `byResult[].result`). */
  byAssignee: { name: string; total: number; counts: Record<string, number> }[];
}

/**
 * Counts the calls by result and by person.
 *
 * A call completed without a result is counted under
 * `CONTACT_RESULT_UNRECORDED` rather than dropped: a report that silently leaves
 * out half the calls reads as half as many calls, and «ثبت نشده» is itself the
 * thing to fix. The first spelling seen names a folded group; groups are ordered
 * by count, ties by the company's own list order, then by name.
 */
export function summarizeContactResults(
  rows: readonly ContactResultRow[],
  listOrder: readonly string[] = [],
): ContactResultSummary {
  const label = new Map<string, string>();
  for (const entry of listOrder) {
    const key = contactResultKey(entry);
    if (key && !label.has(key)) label.set(key, entry);
  }
  const resultOf = (row: ContactResultRow): string => {
    const key = contactResultKey(row.contactResult);
    if (!key) return CONTACT_RESULT_UNRECORDED;
    if (!label.has(key)) label.set(key, String(row.contactResult).trim());
    return label.get(key)!;
  };

  const counts = new Map<string, number>();
  const people = new Map<string, { total: number; counts: Record<string, number> }>();
  let recorded = 0;
  for (const row of rows) {
    const result = resultOf(row);
    if (result !== CONTACT_RESULT_UNRECORDED) recorded += 1;
    counts.set(result, (counts.get(result) ?? 0) + 1);
    const name = String(row.assignedToName ?? "").trim() || "بدون مسئول";
    const person = people.get(name) ?? { total: 0, counts: {} };
    person.total += 1;
    person.counts[result] = (person.counts[result] ?? 0) + 1;
    people.set(name, person);
  }

  const orderOf = (result: string): number => {
    const i = listOrder.findIndex((e) => contactResultKey(e) === contactResultKey(result));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const total = rows.length;
  const byResult = [...counts.entries()]
    .map(([result, count]) => ({
      result, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || orderOf(a.result) - orderOf(b.result)
      || a.result.localeCompare(b.result, "fa"));
  const byAssignee = [...people.entries()]
    .map(([name, p]) => ({ name, ...p }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "fa"));

  return { total, recorded, byResult, byAssignee };
}
