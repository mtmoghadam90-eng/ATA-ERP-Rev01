/**
 * What the assistant may *ask* to do, and the rules around a pending request.
 *
 * The whole design is in one sentence: the assistant never writes anything. It
 * prepares a complete proposal, the proposal is stored on the server, and a
 * person presses a button. That was an explicit decision — «با تایید شما، قبل
 * از هر ثبت» — and it is what makes an assistant that can issue a proforma
 * something other than a liability.
 *
 * Everything here is pure so `test:rules` can hold it. The half that reads the
 * database and writes the records is `src/server/services/assistant/actions.ts`.
 */

/** One row of the confirmation card: «مشتری: فولاد مبارکه». */
export interface ActionSummaryLine {
  label: string;
  value: string;
}

export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "failed";

/** A prepared write, as the browser sees it. Never carries the payload. */
export interface AssistantProposal {
  id: string;
  action: string;
  /** The heading on the card: «صدور پیش‌فاکتور». */
  title: string;
  lines: ActionSummaryLine[];
  /**
   * Things that are true and worth reading before confirming — a line with no
   * matched product, a quantity above what is outstanding. Not errors: a
   * proposal that cannot be executed is never offered in the first place.
   */
  warnings: string[];
  status: ProposalStatus;
  /** ISO, from the server clock. Expiry is measured against it. */
  createdAt: string;
  /** What was written, once it was: «پیش‌فاکتور QT-ATA-05-19-C3». */
  resultLabel?: string | null;
  resultId?: string | null;
  error?: string | null;
}

/**
 * How long a prepared proposal may wait.
 *
 * It is a photograph of the data at the moment it was prepared: the price it
 * quotes, the stock it draws on, the outstanding quantity it ships. Confirming
 * one from this morning would write this morning's answer into this afternoon's
 * database, and nobody re-reads a summary they approved an hour ago.
 */
export const PROPOSAL_TTL_MINUTES = 30;
export const PROPOSAL_TTL_MS = PROPOSAL_TTL_MINUTES * 60_000;

export function proposalExpired(createdAt: string | Date, now: number): boolean {
  const at = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(at)) return true;
  return now - at > PROPOSAL_TTL_MS;
}

/**
 * Why this proposal cannot be confirmed now, or null when it can.
 *
 * Re-asked at confirmation time rather than trusted from preparation: the
 * settings switch may have been turned off, the proposal may have gone stale,
 * and the button may have been pressed twice.
 */
export function confirmRefusalReason(
  proposal: { status: ProposalStatus; createdAt: string | Date },
  now: number,
  actionsAllowed: boolean,
): string | null {
  if (!actionsAllowed) {
    return "ثبت خودکار توسط دستیار در تنظیمات فعال نیست.";
  }
  if (proposal.status === "confirmed") return "این درخواست قبلاً ثبت شده است.";
  if (proposal.status === "cancelled") return "این درخواست لغو شده است.";
  if (proposal.status === "failed") return "این درخواست قبلاً با خطا مواجه شده است. دوباره از دستیار بخواهید.";
  if (proposalExpired(proposal.createdAt, now)) {
    return `مهلت تایید این درخواست (${PROPOSAL_TTL_MINUTES} دقیقه) گذشته است. دوباره از دستیار بخواهید.`;
  }
  return null;
}

/**
 * The actions that exist.
 *
 * `permissionKey` is the collection key the executing user must be able to
 * write — the same key the module's own REST route checks, so the assistant can
 * never be a way around a permission. `test:rules` reads
 * `services/assistant/actions.ts` and fails when the two lists disagree either
 * way: an implementation with no catalogue entry is invisible to the settings
 * screen, and a catalogue entry with no implementation is a tool the model will
 * try to call.
 */
export interface AssistantActionMeta {
  name: string;
  label: string;
  /** An `erp_*` key from `KEY_PERMISSION`. */
  permissionKey: string;
  /**
   * The live-data resource a confirmed action writes, as in its URL.
   *
   * The confirm call posts to `/api/assistant/…`, so the automatic
   * announcement in the API client names «assistant» — a resource nothing
   * reads. Without this the proforma would exist and the grid behind the panel
   * would go on showing the old list until it was reloaded by hand.
   */
  resource: string;
}

export const ASSISTANT_ACTIONS: readonly AssistantActionMeta[] = [
  { name: "propose_task", label: "ثبت وظیفه", permissionKey: "erp_tasks", resource: "tasks" },
  { name: "propose_project_activity", label: "ثبت فعالیت پروژه", permissionKey: "erp_project_category_groups", resource: "activities" },
  { name: "propose_proforma", label: "صدور پیش‌فاکتور", permissionKey: "erp_proformas", resource: "proformas" },
  { name: "propose_packing_list", label: "صدور پکینگ لیست", permissionKey: "erp_packaging_deliveries", resource: "deliveries" },
] as const;

/** Which resource a confirmed action of this name changed. */
export function actionResource(name: string): string | null {
  return ASSISTANT_ACTIONS.find((a) => a.name === name)?.resource ?? null;
}

export function actionLabel(name: string): string {
  return ASSISTANT_ACTIONS.find((a) => a.name === name)?.label ?? name;
}
