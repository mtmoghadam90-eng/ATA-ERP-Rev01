import { ListResponse, api } from "./client";
import type { SettleOutcome, FollowUpDecision, FollowUpHealth, FollowUpState } from "../utils/salesFollowUp";

/**
 * The sales follow-up queue and the completion flow.
 *
 * Everything on a row is **derived**, not stored: the age of the quotation, the
 * next action and its date, who it is on, when it was last chased and what came
 * of it. All of it is read back from the open follow-up task and the proforma
 * on every request, because a stored copy is a copy somebody has to keep in
 * step — and the whole point of putting the next action on the task is that
 * there is one of it.
 */

export interface FollowUpRow {
  id: string;
  proformaNumber: string;
  customerId: string;
  customerName: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  /** The commercial owner: the project's sales engineer, never the creator. */
  salesExpert: string | null;
  /** The project's own expected decision date — no second field on the quote. */
  expectedCloseDateJalali: string | null;
  finalAmount: string;
  currency: string;
  status: string;
  outcome: string;
  sentDateJalali: string | null;
  issueDateJalali: string | null;
  ageDays: number | null;
  followUpState: FollowUpState;
  deferredUntilJalali: string | null;
  nextAction: string | null;
  /** «شرح اقدام بعدی» and its urgency — what the edit form needs to show. */
  nextActionDescription: string | null;
  nextActionDueDateJalali: string | null;
  nextActionAssignee: string | null;
  nextActionPriority: string | null;
  /** The task to complete. Null is exactly what «بدون اقدام بعدی» means. */
  nextActionTaskId: string | null;
  lastFollowUpDateJalali: string | null;
  lastFollowUpResult: string | null;
  followUpHealth: FollowUpHealth;
}

export interface FollowUpSummary {
  dueToday: number;
  overdue: number;
  /** The health check with a target of zero. */
  openWithoutNextAction: number;
  deferred: number;
  noResponse: number;
  openTotal: number;
  olderThan14Days: number;
}

export interface FollowUpCompletionBody {
  decision: FollowUpDecision;
  followUpResult: string;
  completionNote?: string;
  nextTitle?: string;
  /** «شرح اقدام بعدی» — what the next chase is for. See the input type. */
  nextDescription?: string;
  nextDueDate?: string;
  nextAssignedToName?: string;
  /** «اولویت» of the next chase; absent inherits the one being closed. */
  nextPriority?: string;
  deferredUntil?: string;
  /**
   * The commercial outcome to write onto the proforma alongside the result.
   *
   * Sent only when a person answered the screen's question — a decisive result
   * string on its own never settles a sale.
   */
  settleOutcome?: SettleOutcome;
  settleLossReason?: string;
}

/** One completed chase on a quotation: what was done, and what came of it. */
export interface FollowUpHistoryEntry {
  taskId: string;
  title: string;
  completedAtJalali: string | null;
  result: string | null;
  note: string | null;
  assignee: string | null;
}

export interface ProjectFollowUpQuote {
  id: string;
  proformaNumber: string;
  status: string;
  outcome: string;
  currency: string;
  finalAmount: string;
  sentDateJalali: string | null;
  issueDateJalali: string | null;
  ageDays: number | null;
  followUpState: FollowUpState;
  deferredUntilJalali: string | null;
  /** The sale is decided, so no next action is wanted on it. */
  settled: boolean;
  followUpHealth: FollowUpHealth;
  nextAction: string | null;
  nextActionDueDateJalali: string | null;
  nextActionAssignee: string | null;
  nextActionTaskId: string | null;
  /** Every completed chase, most recent first. */
  history: FollowUpHistoryEntry[];
}

export interface ProjectFollowUpReport {
  projectId: string;
  quotes: ProjectFollowUpQuote[];
  summary: {
    quotes: number;
    chaseable: number;
    settled: number;
    withoutNextAction: number;
    overdue: number;
    followUps: number;
    lastFollowUpDateJalali: string | null;
    lastFollowUpResult: string | null;
  };
}

export const salesFollowUpApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<FollowUpRow> & { summary: FollowUpSummary }>(
      "/api/sales-follow-up", query, signal,
    ),

  summary: (signal?: AbortSignal) =>
    api.get<{ summary: FollowUpSummary }>("/api/sales-follow-up/summary", undefined, signal)
      .then((r) => r.summary),

  /**
   * The queue row behind one follow-up task.
   *
   * What lets the merged work board open the *same* completion modal the
   * follow-up screen opens. The row is derived — the next action, its due date,
   * the health — so it is built on the server rather than assembled out of what
   * a task card happens to carry, which is how two screens come to disagree
   * about a quotation's next step.
   */
  rowForTask: (taskId: string) =>
    api.get<{ row: FollowUpRow }>(`/api/sales-follow-up/tasks/${taskId}`).then((r) => r.row),

  /**
   * One call, because it is one transaction.
   *
   * Closing the task, recording the result, moving the proforma's follow-up
   * state and raising the replacement have to succeed together — three
   * requests could stop half way and leave a quotation marked as actively
   * followed up with nothing chasing it.
   */
  complete: (taskId: string, body: FollowUpCompletionBody) =>
    api.post<{
      taskId: string;
      nextTaskId: string | null;
      followUpState: string;
      /**
       * What the completion wrote onto the quotation, and the job it belongs
       * to — `settlementCategoryPrompt` turns these into the question about
       * closing the project's «پیش‌فاکتور» activity category, which is the
       * same question the proforma's own outcome modal asks.
       */
      settledOutcome: SettleOutcome | null;
      projectId: string | null;
      proformaNumber: string;
    }>(`/api/sales-follow-up/tasks/${taskId}/complete`, body),

  /**
   * Corrects what was recorded on a chase that is already closed.
   *
   * Two columns and nothing else: the completion's other work — the task
   * closing, the follow-up state, the replacement task, a settled sale — has
   * already happened, and re-running any of it would raise a second next
   * action or re-date a sale the ranking counts from.
   */
  updateResult: (taskId: string, body: { followUpResult: string; completionNote?: string }) =>
    api.put<{ taskId: string }>(`/api/sales-follow-up/tasks/${taskId}/result`, body),

  /**
   * One project's whole follow-up story, settled quotations included.
   *
   * The queue answers «what should the sales desk do next, across the
   * company» and deliberately leaves out finished sales; a project tab is
   * asking what *happened* here, and a won document with three recorded
   * chases behind it is exactly that.
   */
  project: (projectId: string, signal?: AbortSignal) =>
    api.get<ProjectFollowUpReport>(
      `/api/sales-follow-up/project/${projectId}`, undefined, signal,
    ),

  /** Reactivation *is* the new task; the state follows from it. */
  reactivate: (proformaId: string, body: { title?: string; dueDate: string; assignedToName?: string }) =>
    api.post<{ taskId: string }>(`/api/sales-follow-up/${proformaId}/reactivate`, body),
};
