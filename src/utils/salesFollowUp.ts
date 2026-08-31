import type { ProformaOutcome } from "../server/proformaStatus";

/**
 * Chasing a quotation — the rules, with nothing that needs a database.
 *
 * ## Why this is a separate axis from the commercial outcome
 *
 * A proforma already has an outcome, and it is *derived*: won, part-won, lost,
 * cancelled or still running, computed from the line statuses and `isCancelled`
 * (`src/server/proformaStatus.ts`). That axis answers "how did the sale go".
 *
 * It cannot answer the question this file exists for, which is "is anybody
 * still chasing this, and if not, why not". A quotation sent three weeks ago
 * with nobody assigned to it and a quotation the customer explicitly asked us
 * to raise again after Nowruz have the *same* commercial outcome — «جاری» — and
 * are completely different situations for the sales desk. So follow-up gets its
 * own small state, and it deliberately spells only the three things the outcome
 * cannot: OPEN, DEFERRED, NO_RESPONSE. There is no WON, LOST, CANCELLED or
 * SUPERSEDED here; those exist already, one column away, and a second copy is
 * how two columns come to disagree about one fact.
 *
 * ## Where the next action lives
 *
 * Not on the proforma. The open `SALES_FOLLOW_UP` task related to it *is* the
 * next action, its due date, its assignee and its priority — one record, edited
 * on one screen. A `nextAction` column beside it would be a second copy of all
 * four, kept in step by hand.
 *
 * ## Who owns the chase
 *
 * `Project.salesExpert`, never the proforma's creator. A support engineer
 * routinely prepares the document for a job somebody else is selling, and
 * making the author the follow-up owner puts the chase on the wrong desk on the
 * day the model is meant to separate them.
 */

/* --------------------------------- states --------------------------------- */

export const FOLLOW_UP_STATES = ["OPEN", "DEFERRED", "NO_RESPONSE"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

export const FOLLOW_UP_STATE_LABELS: Record<FollowUpState, string> = {
  OPEN: "در حال پیگیری",
  DEFERRED: "موکول‌شده",
  NO_RESPONSE: "بدون پاسخ",
};

/** Anything unrecognised is treated as an active chase rather than dropped. */
export function normalizeFollowUpState(value: unknown): FollowUpState {
  const text = String(value ?? "").trim().toUpperCase();
  return (FOLLOW_UP_STATES as readonly string[]).includes(text)
    ? (text as FollowUpState)
    : "OPEN";
}

/* -------------------------------- task kind ------------------------------- */

export const TASK_KINDS = ["GENERAL", "SALES_FOLLOW_UP"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  GENERAL: "وظیفه عمومی",
  SALES_FOLLOW_UP: "پیگیری فروش",
};

/**
 * Absent means GENERAL, and that is what makes the migration a no-op.
 *
 * Every task written before this feature existed has no kind, and none of them
 * is a sales follow-up: the automatic closing, the duplicate check and the
 * queue must all pass straight over them.
 */
export function normalizeTaskKind(value: unknown): TaskKind {
  const text = String(value ?? "").trim().toUpperCase();
  return text === "SALES_FOLLOW_UP" ? "SALES_FOLLOW_UP" : "GENERAL";
}

/* ------------------------------ task lifecycle ----------------------------- */

/**
 * The statuses that mean a task is over.
 *
 * Written as an **exclusion**, like `countsTowardBalance` on the ledger: the
 * automatic rules here ask "is one still open", and a status nobody anticipated
 * must read as still open — a forgotten follow-up is the failure this whole
 * feature exists to prevent, so the safe default is to keep chasing.
 */
export const FINISHED_TASK_STATUSES = ["انجام شده", "کنسل شده"] as const;

export function isTaskFinished(status: unknown): boolean {
  return (FINISHED_TASK_STATUSES as readonly string[]).includes(String(status ?? "").trim());
}

/* ---------------------------- terminal outcomes ---------------------------- */

/**
 * The outcomes that end the sale, and therefore end the chase.
 *
 * «نیمه برنده» is one of them, on the business's own reading: a document
 * reaches it when some lines were won and the rest were closed off, so its
 * fate is decided and there is nothing left to ask the customer. It was
 * treated as still-live at first — "part of it is still being sold" — which is
 * a plausible reading of the words and not how these documents are actually
 * used here.
 *
 * Note what the outcome rule does and does not distinguish: it returns
 * «نیمه برنده» whenever at least one line is won and not all are, which also
 * covers a document with lines still «جاری». Those are treated as settled too.
 * If a part-won quotation ever does need chasing for its remaining lines, this
 * is the constant to split — see `getProformaOutcome`.
 */
export const TERMINAL_OUTCOMES: readonly ProformaOutcome[] = [
  "تأیید شده (برنده)",
  "نیمه برنده",
  "باخته",
  "لغو شده",
];

export function isTerminalOutcome(outcome: unknown): boolean {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(String(outcome ?? ""));
}

/**
 * The outcomes a follow-up queue is about at all.
 *
 * A quotation whose result is known needs no next action — that is what
 * "settled" means — so a won, part-won, lost or cancelled document has no
 * business on this screen, and asking somebody to plan a next step for one is
 * nonsense. «پیش‌نویس» is excluded for the opposite reason: it has not been sent
 * to anybody, so there is nothing yet to chase.
 *
 * What is left is exactly the two open outcomes: sent and awaiting an answer,
 * or running with nothing decided on any line.
 *
 * This is a *derived* value, so it cannot be a column filter — the server
 * builds the query with `outcomeWhere` (`src/server/proformaStatus.ts`), the
 * same machinery the proforma grid's status filter uses. Excluding by outcome
 * rather than by having swept the tasks is also what makes the screen correct
 * for documents that predate the feature: those were never swept and never
 * will be, and they must still not appear.
 */
export const CHASEABLE_OUTCOMES: readonly ProformaOutcome[] = [
  "ارسال شده",
  "جاری",
];

export function isChaseableOutcome(outcome: unknown): boolean {
  return (CHASEABLE_OUTCOMES as readonly string[]).includes(String(outcome ?? ""));
}

/** What is written on a follow-up task the system closes by itself. */
export const AUTO_CLOSE_NOTE = "پیگیری بسته شد؛ نتیجه نهایی پیش‌فاکتور مشخص شد.";

/* ------------------------- the follow-up result list ----------------------- */

/*
 * The three results that end a sale, named so the rule below and the list above
 * cannot drift into two spellings of the same sentence.
 */
export const RESULT_PURCHASE_CONFIRMED = "تأیید نهایی خرید";
export const RESULT_PURCHASE_CANCELLED = "لغو خرید توسط مشتری";
export const RESULT_LOST_TO_COMPETITOR = "واگذاری به رقیب (باخت)";


/**
 * What the customer said, as a controlled list.
 *
 * A user-editable `settings.dropdownItems.followUpResults`, managed by the same
 * settings screen as every other dropdown. It is still **not** a loss reason —
 * `settings.lossReasons` stays exactly where it is, and a loss reason is asked
 * for separately when a document is actually being marked lost.
 *
 * Three of these entries do carry a commercial meaning, and the rest carry
 * none. That distinction is the whole of `impliedSettlement` below: «تأیید
 * نهایی خرید» ends the sale, while «خرید به تعویق افتاد» and «عدم پاسخ» are
 * follow-up states and must never be read as one. The three decisive entries
 * only *suggest*; a person confirms before anything is written.
 */
export const DEFAULT_FOLLOW_UP_RESULTS = [
  "دریافت پیش‌فاکتور تأیید شد",
  "در حال بررسی فنی",
  "در حال بررسی مالی/مدیریتی",
  "درخواست اصلاح قیمت",
  "درخواست اصلاح مشخصات یا تعداد",
  "زمان تصمیم خرید اعلام شد",
  "خرید به تعویق افتاد",
  "عدم پاسخ",
  // The three that end a sale. Kept last so the list still reads as a
  // conversation from first contact to decision.
  RESULT_PURCHASE_CONFIRMED,
  RESULT_PURCHASE_CANCELLED,
  RESULT_LOST_TO_COMPETITOR,
  "سایر",
];

/* ------------------- the commercial outcome, when there is one ------------- */

/**
 * What the sales desk can settle a quotation to from the follow-up screen.
 *
 * Deliberately the three a follow-up call can actually establish. «نیمه برنده»
 * is not here: a part-won document is decided line by line, which is what the
 * proforma's own outcome modal is for, and offering it as a single button would
 * mean guessing which lines the customer took.
 */
export const SETTLE_OUTCOMES = ["WON", "LOST", "CANCELLED"] as const;
export type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];

export const SETTLE_OUTCOME_LABELS: Record<SettleOutcome, string> = {
  WON: "تأیید شده (برنده)",
  LOST: "باخته",
  CANCELLED: "لغو شده",
};

/**
 * The outcome a result suggests, or null when it suggests nothing.
 *
 * A **suggestion**, never an action: the screen asks before anything is
 * written, because the person on the call is the only one who knows whether
 * «تأیید نهایی خرید» meant the whole quotation or two lines of it.
 *
 * Matched against the default entries by name. A renamed entry simply stops
 * suggesting — the outcome can still be chosen by hand — which is the right way
 * for this to degrade: a wrong guess about a sale is worse than no guess.
 */
export function impliedSettlement(result: unknown): SettleOutcome | null {
  const text = String(result ?? "").trim();
  if (text === RESULT_PURCHASE_CONFIRMED) return "WON";
  if (text === RESULT_PURCHASE_CANCELLED) return "CANCELLED";
  if (text === RESULT_LOST_TO_COMPETITOR) return "LOST";
  return null;
}

/* --------------------------------- health --------------------------------- */

/**
 * How a row of the queue is doing, and therefore where it sorts.
 *
 * The order is the order the sales desk should work in, which is why it is one
 * ranked list rather than a set of independent flags: overdue first, then what
 * is due today, then the quotations nobody has planned a next step for — that
 * last one being the health check the whole screen exists for, because a
 * quotation with no next action is exactly the one that gets forgotten.
 */
export const FOLLOW_UP_HEALTH = [
  "OVERDUE",
  "DUE_TODAY",
  "NO_NEXT_ACTION",
  "UPCOMING",
  "DEFERRED",
  "NO_RESPONSE",
] as const;
export type FollowUpHealth = (typeof FOLLOW_UP_HEALTH)[number];

export const FOLLOW_UP_HEALTH_LABELS: Record<FollowUpHealth, string> = {
  OVERDUE: "عقب‌افتاده",
  DUE_TODAY: "پیگیری امروز",
  NO_NEXT_ACTION: "بدون اقدام بعدی",
  UPCOMING: "پیگیری آینده",
  DEFERRED: "موکول‌شده",
  NO_RESPONSE: "بدون پاسخ",
};

/** Operational order: the first thing in this list is the first thing to do. */
export function healthRank(health: FollowUpHealth): number {
  const at = FOLLOW_UP_HEALTH.indexOf(health);
  return at === -1 ? FOLLOW_UP_HEALTH.length : at;
}

export interface FollowUpRowState {
  followUpState: FollowUpState;
  /** Jalali `YYYY/MM/DD` of the open follow-up task, or null when there is none. */
  nextActionDueDateJalali: string | null;
  /** True when an unfinished SALES_FOLLOW_UP task exists for this proforma. */
  hasOpenFollowUpTask: boolean;
  /** Jalali `YYYY/MM/DD`, from DEFERRED. */
  deferredUntilJalali?: string | null;
}

/**
 * Classifies one row.
 *
 * Two decisions worth stating. **A deferred quotation is not overdue** while its
 * date is still ahead — that is the entire point of deferring, and letting the
 * open task it carries mark it overdue would put it back in front of the person
 * who agreed to leave it alone. Once the date arrives it rejoins the ordinary
 * ranking, so nothing is deferred for ever. And **a quotation with no open task
 * is not "fine"**: it has no next step, which is worse than a late one, so it
 * ranks above what is merely upcoming.
 */
export function followUpHealthOf(row: FollowUpRowState, todayJalali: string): FollowUpHealth {
  if (row.followUpState === "NO_RESPONSE") return "NO_RESPONSE";

  if (row.followUpState === "DEFERRED") {
    const until = row.deferredUntilJalali ?? null;
    // Still inside the agreed pause. Past it, the deferral has expired and the
    // row is judged like any other.
    if (until && until > todayJalali) return "DEFERRED";
  }

  if (!row.hasOpenFollowUpTask || !row.nextActionDueDateJalali) return "NO_NEXT_ACTION";
  if (row.nextActionDueDateJalali < todayJalali) return "OVERDUE";
  if (row.nextActionDueDateJalali === todayJalali) return "DUE_TODAY";
  return "UPCOMING";
}

/**
 * The health check the dashboard reports a target of zero for.
 *
 * An actively followed quotation with nothing planned. Deferred and abandoned
 * ones are excluded on purpose: both are decisions somebody made, and counting
 * them as neglect would make the figure impossible to drive to zero and
 * therefore worth ignoring.
 */
export function isOpenWithoutNextAction(row: FollowUpRowState): boolean {
  return row.followUpState === "OPEN" && !row.hasOpenFollowUpTask;
}

/* ------------------------------ the decisions ------------------------------ */

/**
 * What the person completing a follow-up says happens next.
 *
 * `TERMINAL` is only offered when the proforma's derived outcome already says
 * the sale is over — the commercial close belongs to the outcome machinery and
 * is not re-decided here.
 */
export const FOLLOW_UP_DECISIONS = ["NEXT_ACTION", "DEFER", "NO_RESPONSE", "TERMINAL"] as const;
export type FollowUpDecision = (typeof FOLLOW_UP_DECISIONS)[number];

export interface FollowUpCompletionInput {
  decision: FollowUpDecision;
  followUpResult?: string | null;
  completionNote?: string | null;
  /** NEXT_ACTION: the task to raise in place of this one. */
  nextTitle?: string | null;
  nextDueDate?: string | null;
  nextAssignedToName?: string | null;
  /** DEFER: the day the customer asked to be approached again. */
  deferredUntil?: string | null;
  /**
   * The commercial outcome to write onto the proforma along with this result.
   *
   * Absent means «only record what the customer said» — the previous and still
   * the default behaviour. Present, it is a person's explicit answer to the
   * question the screen asked, never something a result string decided on its
   * own.
   */
  settleOutcome?: SettleOutcome | null;
  /** LOST only: which of `settings.lossReasons` this was. */
  settleLossReason?: string | null;
}

/**
 * Why a completion cannot be recorded, in Persian, or null when it can.
 *
 * Pure, and shared by the modal and the route: the form should not be able to
 * submit something the server will refuse, and the server must not rely on the
 * form having checked.
 */
export function completionRefusalReason(
  input: FollowUpCompletionInput,
  context: { todayJalali: string; outcomeIsTerminal: boolean },
): string | null {
  if (!(FOLLOW_UP_DECISIONS as readonly string[]).includes(input.decision)) {
    return "تصمیم پیگیری نامعتبر است.";
  }
  if (!String(input.followUpResult ?? "").trim()) {
    return "ثبت نتیجه پیگیری الزامی است.";
  }

  if (input.decision === "NEXT_ACTION") {
    if (!String(input.nextTitle ?? "").trim()) return "عنوان اقدام بعدی الزامی است.";
    if (!String(input.nextDueDate ?? "").trim()) return "تاریخ اقدام بعدی الزامی است.";
  }

  if (input.decision === "DEFER") {
    const until = String(input.deferredUntil ?? "").trim();
    if (!until) return "تاریخ پیگیری مجدد الزامی است.";
    // A deferral into the past is not a deferral: it would come back overdue
    // the moment it was saved, which is not what the customer asked for.
    if (until <= context.todayJalali) return "تاریخ پیگیری مجدد باید در آینده باشد.";
  }

  if (input.settleOutcome) {
    if (!(SETTLE_OUTCOMES as readonly string[]).includes(input.settleOutcome)) {
      return "وضعیت تجاری انتخاب‌شده نامعتبر است.";
    }
    /*
     * Nothing to settle twice. A won or lost document reaching this screen is
     * already decided, and writing the outcome again would re-stamp every line
     * — and, on a won one, re-date the sale that customer-value ranking counts.
     */
    if (context.outcomeIsTerminal) {
      return "نتیجه تجاری این پیش‌فاکتور قبلاً مشخص شده است.";
    }
    /*
     * A loss is the one outcome that has to say why.
     *
     * The project's own loss reason is derived from these lines — it is no
     * longer typed a second time on the project form — so a document settled as
     * «باخته» with the box left empty is a lost job whose reason nothing else
     * can supply, and «چرا پروژه‌ها را می‌بازیم» comes back blank for it.
     * A win and a cancellation carry no reason by design.
     */
    if (input.settleOutcome === "LOST" && !String(input.settleLossReason ?? "").trim()) {
      return "برای ثبت باخت، انتخاب دلیل باخت الزامی است.";
    }
  }

  /*
   * «بدون اقدام بعدی» needs a settled sale — and settling it *here* counts.
   *
   * The check used to read only the outcome as it stands, so the option was
   * greyed out at exactly the moment it was wanted: the call where the customer
   * confirms the purchase is the call after which no next action is needed.
   */
  if (input.decision === "TERMINAL" && !context.outcomeIsTerminal && !input.settleOutcome) {
    return "بستن پیگیری بدون اقدام بعدی فقط وقتی ممکن است که نتیجه نهایی پیش‌فاکتور مشخص شده باشد"
      + " یا هم‌زمان در همین فرم ثبت شود.";
  }

  return null;
}

/**
 * The follow-up state a decision leaves the proforma in.
 *
 * TERMINAL keeps OPEN deliberately: the chase ended because the *sale* ended,
 * which the outcome already records. Writing NO_RESPONSE there would claim the
 * customer went quiet on a quotation they had just approved.
 */
export function stateAfterDecision(decision: FollowUpDecision): FollowUpState {
  if (decision === "DEFER") return "DEFERRED";
  if (decision === "NO_RESPONSE") return "NO_RESPONSE";
  return "OPEN";
}

/* -------------------------------- timeline -------------------------------- */

/**
 * The sentence that goes on the project's timeline.
 *
 * The task stays the structured record — the result, the note, the dates, who
 * it was on — and this is the human-readable half somebody scrolling the
 * project reads. Deliberately one place, so the two halves cannot describe the
 * same follow-up differently.
 */
export function followUpActivityText(entry: {
  proformaNumber: string;
  followUpResult?: string | null;
  completionNote?: string | null;
  nextTitle?: string | null;
  nextDueDateJalali?: string | null;
  deferredUntilJalali?: string | null;
  decision: FollowUpDecision;
}): string {
  const head = `پیگیری پیش‌فاکتور ${entry.proformaNumber}${
    entry.followUpResult ? ` — ${entry.followUpResult}` : ""
  }`;

  const lines = [head];
  const note = String(entry.completionNote ?? "").trim();
  if (note) lines.push(note);

  if (entry.decision === "NEXT_ACTION" && entry.nextTitle) {
    lines.push(
      `اقدام بعدی: ${entry.nextTitle}${
        entry.nextDueDateJalali ? ` در ${entry.nextDueDateJalali}` : ""
      }`,
    );
  } else if (entry.decision === "DEFER" && entry.deferredUntilJalali) {
    lines.push(`پیگیری تا ${entry.deferredUntilJalali} موکول شد.`);
  } else if (entry.decision === "NO_RESPONSE") {
    lines.push("پیگیری به دلیل عدم پاسخ مشتری بسته شد.");
  } else if (entry.decision === "TERMINAL") {
    lines.push("پیگیری بسته شد؛ نتیجه نهایی پیش‌فاکتور مشخص شده است.");
  }

  return lines.join("\n");
}

/* --------------------------------- copying -------------------------------- */

export const COPY_MODES = ["INDEPENDENT", "NEW_VERSION"] as const;
export type CopyMode = (typeof COPY_MODES)[number];

/**
 * Why a revision cannot be created from this document, or null.
 *
 * One rule, and it is about keeping the chain a chain: if A already has B as
 * its revision, a second revision of A would fork the history and neither
 * branch would be "the current one". The revision is made from B instead, which
 * is what the person almost always means anyway.
 */
export function versionRefusalReason(source: {
  proformaNumber?: string | null;
  nextVersionNumber?: string | null;
}): string | null {
  if (source.nextVersionNumber) {
    return `این پیش‌فاکتور قبلاً نسخه جدیدی دارد (${source.nextVersionNumber}). نسخه بعدی را از روی همان بسازید.`;
  }
  return null;
}
