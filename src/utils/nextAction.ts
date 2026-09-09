/**
 * «اقدام بعدی» — the next thing to do, asked at the one moment the answer is
 * usually yes.
 *
 * The request was to ask after every save. That is the version that gets turned
 * off: a save is not an event — people save to correct a typo, attach a file,
 * fix a phone number — so the great majority of those prompts arrive when the
 * honest answer is «no», and a dialog answered «no» nine times in ten becomes a
 * reflex within a week. The tenth, the one that mattered, goes with it. Every
 * ERP that has solved this converged on the same two moves instead: Odoo offers
 * «Done» and «Done & Schedule Next» as two buttons rather than a dialog, and
 * Pipedrive makes «no next activity» a mark on the record that never goes away.
 *
 * This is the first of those. **The choice is in the button**, so it costs
 * nothing when the answer is no, and it is offered at the moment a person has
 * just finished something and is the only one who knows what follows.
 *
 * Pure and clock-free — the day is an argument — so `test:rules` can hold it and
 * the two screens that offer it read one rule rather than each deciding for
 * themselves what a next action inherits.
 */

import { addWorkingDaysToShamsi } from "../dateUtils";

/**
 * How far ahead a next action is proposed, in **working** days.
 *
 * One number rather than one per action type: a per-type figure would make the
 * settings list `{label, days}` instead of the plain string array every other
 * dropdown here is, which is a second shape to maintain for something the person
 * can change in the date box in front of them. It is a starting point, not a
 * rule.
 */
export const DEFAULT_NEXT_ACTION_DAYS = 3;

/**
 * The kinds of next action a fresh installation offers.
 *
 * A company's own list, editable in Settings like every other dropdown — these
 * are only what it starts as. Nothing in the code keys on any of these strings,
 * which is why they can be renamed freely; contrast
 * `dropdownItems.followUpResults`, where three entries *are* read by name and
 * therefore need a settings patch.
 */
export const DEFAULT_NEXT_ACTION_KINDS: readonly string[] = [
  "تماس تلفنی",
  "ارسال ایمیل / مدارک",
  "جلسه یا بازدید",
  "پیگیری داخلی",
  "بررسی و تصمیم‌گیری",
  "اقدام اداری / مالی",
];

/** The record that has just been finished, as the rule needs to see it. */
export interface NextActionSource {
  /** What was just completed, so the new task can say what it follows. */
  title: string;
  /** `GENERAL`, `SALES_FOLLOW_UP`, … — a chase is refused, see below. */
  taskKind?: string | null;
  /**
   * The record being finished, when that is not the same thing as what the next
   * action is *about*.
   *
   * A referral is closed by its own id while the task it raises belongs to the
   * project — the same distinction `workflowEntityId` draws against
   * `relatedToId`, and for the same reason: «which record am I completing» and
   * «what will the new card say it concerns» are two questions. A task answers
   * both with itself and leaves this unset.
   */
  recordId?: string | null;
  /** Carried over so the next action sits on the same job. */
  relatedToType?: string | null;
  relatedToId?: string | null;
  relatedToName?: string | null;
  /** Who was doing it; the next action starts with them. */
  assignedTo?: string | null;
  assignedToUserId?: string | null;
  priority?: string | null;
}

/** The fields the modal edits, before anything is written. */
export interface NextActionDraft {
  kind: string;
  description: string;
  dueDate: string;
  assignedTo: string;
  priority: string;
}

export const FOLLOW_UP_KIND_NAME = "SALES_FOLLOW_UP";

/**
 * Whether finishing this record may raise a next action from here.
 *
 * **A sales follow-up is refused**, and that is the sharpest rule in the file: a
 * chase already *has* a next action — `completeFollowUp` records what the
 * customer said, moves the quotation's follow-up state and raises the
 * replacement in one transaction. Offering this beside it would put an ordinary
 * `GENERAL` task next to the chase, so the quotation would show one next action
 * and the board two, which is the two-columns-disagreeing fault this codebase
 * keeps repairing.
 */
export function offersNextAction(taskKind?: string | null): boolean {
  return String(taskKind ?? "").trim() !== FOLLOW_UP_KIND_NAME;
}

/**
 * What the next action starts as, given what was just finished.
 *
 * Everything here is a **default a person then corrects**, and each one is the
 * answer that is right more often than any other:
 *
 * - the **job** carries over, because the next action is almost always about the
 *   same project or quotation and re-picking it is the commonest reason a
 *   prompt like this gets abandoned half way;
 * - the **assignee** is whoever just did the work — handing it to somebody else
 *   is a decision, and it belongs to the person, not to a default;
 * - the **priority** is inherited, because urgent work rarely becomes routine
 *   the moment one step of it is done;
 * - and the **date** is a few working days out rather than tomorrow, since
 *   `addWorkingDaysToShamsi` already knows the holidays and a next action landing
 *   on Nowruz is one nobody does.
 *
 * The description is left **empty on purpose**. Seeding it with the title of
 * what was just finished is the `description: completionNote` fault the
 * follow-up card was corrected for: a card telling somebody what to do would
 * describe what somebody else had already done.
 */
export function nextActionDraft(
  source: NextActionSource,
  todayJalali: string,
  days: number = DEFAULT_NEXT_ACTION_DAYS,
): NextActionDraft {
  return {
    kind: "",
    description: "",
    dueDate: addWorkingDaysToShamsi(todayJalali, days),
    assignedTo: String(source.assignedTo ?? "").trim(),
    priority: String(source.priority ?? "").trim() || "متوسط",
  };
}

/**
 * Why this draft cannot be saved, or null.
 *
 * Two fields and no more. **The kind is required** because it is what the list
 * is for — «پیگیری» with no kind is the note somebody would have written anyway
 * — and **the date is required** because a task with no due date never reaches
 * the column that would put it in front of anybody: it sorts last on the board
 * by `laneTimestamps`' own rule and is exactly the work that goes missing.
 *
 * The description is optional: a kind plus a date is a complete instruction for
 * «تماس تلفنی», and demanding a sentence for it teaches people to type a full
 * stop.
 */
export function nextActionRefusal(draft: NextActionDraft): string | null {
  if (!draft.kind.trim()) return "نوع اقدام را انتخاب کنید.";
  if (!draft.dueDate.trim()) return "تاریخ اقدام بعدی را وارد کنید.";
  return null;
}

/**
 * The title the created task carries.
 *
 * The kind leads, because that is what a person scans a board for, and what it
 * follows is named after it so a card raised automatically is never a sentence
 * with no context — the same reason the milestone rules write their provenance
 * line. The description the person typed is a separate field and is not folded
 * in here.
 */
export function nextActionTitle(kind: string, source: NextActionSource): string {
  const after = String(source.title ?? "").trim();
  const head = kind.trim();
  return after ? `${head} — پس از «${after}»` : head;
}
