/**
 * «گزارش نتیجه تماس‌ها» — what the calls to customers came to.
 *
 * Every row is an ordinary task related to a customer, ticked off, in the
 * period asked for. The counts are made over the **whole bounded scan**, never
 * over a page: «از ۵۰ تماس، ۸ نیاز داشتند» measured over the twenty rows a page
 * happened to hold is a different figure every time the page turns. A scan that
 * reaches the bound says so (`truncated`) rather than reporting a short total
 * as the whole.
 *
 * It reads through the tasks module's own `visibilityClause`, inside the query,
 * so somebody who may see only their own tasks counts only their own calls —
 * this is not a second way into the tasks table.
 */
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { jalaliRangeFilter } from "../dates";
import { visibilityClause } from "./taskService";
import { TASK_DONE } from "../../utils/workBoard";
import { FOLLOW_UP_KIND } from "../../utils/salesFollowUp";
import { relationSpellings } from "../../utils/taskRelations";
import {
  CONTACT_RESULT_UNRECORDED, contactResultKey, summarizeContactResults,
} from "../../utils/contactResults";
import { loadSettings } from "../settings";

/** How many completed calls one report reads. */
export const CONTACT_REPORT_SCAN_LIMIT = 3000;
/** How many of them it lists, newest first. */
export const CONTACT_REPORT_ROW_LIMIT = 300;

export interface ContactReportQuery {
  from?: string;
  to?: string;
  assigneeUserId?: string;
  /** Narrows the *listed* rows to one result; the counts stay whole. */
  result?: string;
}

export async function contactResultReport(user: AuthUser, query: ContactReportQuery) {
  const db = getDb();
  const and: Record<string, unknown>[] = [
    { relatedToType: { in: relationSpellings("customer") } },
    { taskKind: { not: FOLLOW_UP_KIND } },
    { status: TASK_DONE },
  ];
  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);
  const range = jalaliRangeFilter(query.from, query.to);
  if (range) and.push({ completedAt: range });
  if (query.assigneeUserId) and.push({ assignedToUserId: query.assigneeUserId });

  const tasks = await db.task.findMany({
    where: { AND: and },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: CONTACT_REPORT_SCAN_LIMIT + 1,
    select: {
      id: true, title: true, relatedToId: true, relatedToName: true,
      assignedToName: true, contactResult: true, completionNote: true,
      completedAtJalali: true,
    },
  });
  const truncated = tasks.length > CONTACT_REPORT_SCAN_LIMIT;
  const scanned = truncated ? tasks.slice(0, CONTACT_REPORT_SCAN_LIMIT) : tasks;

  const settings = await loadSettings();
  const summary = summarizeContactResults(scanned, settings?.dropdownItems?.contactResults ?? []);

  const wanted = String(query.result ?? "").trim();
  const listed = wanted
    ? scanned.filter((t) => wanted === CONTACT_RESULT_UNRECORDED
      ? !contactResultKey(t.contactResult)
      : contactResultKey(t.contactResult) === contactResultKey(wanted))
    : scanned;
  const page = listed.slice(0, CONTACT_REPORT_ROW_LIMIT);

  // The customer's name as it stands now, not as it was copied onto the task.
  const ids = [...new Set(page.map((t) => t.relatedToId).filter((id): id is string => !!id))];
  const customers = ids.length === 0 ? [] : await db.customer.findMany({
    where: { id: { in: ids } }, select: { id: true, companyName: true },
  });
  const nameOf = new Map(customers.map((c) => [c.id, c.companyName]));

  return {
    summary,
    truncated,
    listedTotal: listed.length,
    rows: page.map((t) => ({
      id: t.id,
      title: t.title,
      customerId: t.relatedToId,
      customerName: (t.relatedToId && nameOf.get(t.relatedToId)) || t.relatedToName || "",
      assignedToName: t.assignedToName ?? "",
      contactResult: t.contactResult ?? null,
      completionNote: t.completionNote ?? null,
      completedAtJalali: t.completedAtJalali ?? null,
    })),
  };
}
