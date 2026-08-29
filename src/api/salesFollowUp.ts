import { ListResponse, api } from "./client";
import type { FollowUpDecision, FollowUpHealth, FollowUpState } from "../utils/salesFollowUp";

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
  nextActionDueDateJalali: string | null;
  nextActionAssignee: string | null;
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
  nextDueDate?: string;
  nextAssignedToName?: string;
  deferredUntil?: string;
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
   * One call, because it is one transaction.
   *
   * Closing the task, recording the result, moving the proforma's follow-up
   * state and raising the replacement have to succeed together — three
   * requests could stop half way and leave a quotation marked as actively
   * followed up with nothing chasing it.
   */
  complete: (taskId: string, body: FollowUpCompletionBody) =>
    api.post<{ taskId: string; nextTaskId: string | null; followUpState: string }>(
      `/api/sales-follow-up/tasks/${taskId}/complete`, body,
    ),

  /** Reactivation *is* the new task; the state follows from it. */
  reactivate: (proformaId: string, body: { title?: string; dueDate: string; assignedToName?: string }) =>
    api.post<{ taskId: string }>(`/api/sales-follow-up/${proformaId}/reactivate`, body),
};
