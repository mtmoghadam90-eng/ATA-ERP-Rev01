/**
 * «اقدام بعدی» — the next thing to do, asked beside the save button of the form
 * that has just recorded the work.
 *
 * The first attempt put the question on a *record* — «انجام شد و اقدام بعدی»
 * beside the tick on the tasks board — and that was the wrong door: it asks
 * only about work that was already a task, so the moment somebody actually
 * wants a reminder (they have just written a customer down, raised an order,
 * closed a delivery) there was nothing to press. The place a person is standing
 * when they finish something here is a **form**, and the button they are
 * already reaching for is **ذخیره**.
 *
 * So the choice is in the button, next to the one that was going to be pressed
 * anyway: «ذخیره» and «ذخیره و ثبت اقدام بعدی». It costs nothing when the
 * answer is no — which is the great majority of saves, since people save to
 * correct a typo, attach a file or fix a phone number — and it is there at the
 * one moment the person knows what follows. That is Odoo's rule; a prompt after
 * *every* save is the version that gets switched off within a week, and the
 * tenth prompt, the one that mattered, goes with it.
 *
 * Pure and clock-free — the day is an argument — so `test:rules` can hold it and
 * the ten forms that offer it read one rule rather than each deciding for
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
/**
 * `Task.taskKind` for a next action raised by «ذخیره و اقدام بعدی».
 *
 * A kind of its own, and not `GENERAL`, because the board treats it
 * differently: it is work agreed for a **day**, so until that day comes it sits
 * in «در انتظار» rather than in «برای انجام» — see `taskBoardLane`. Nothing
 * else about it differs from an ordinary task: it is ticked, edited, moved and
 * texted exactly as one, which is the whole reason it is not a second kind of
 * follow-up.
 */
export const NEXT_ACTION_KIND = "NEXT_ACTION";

export const DEFAULT_NEXT_ACTION_DAYS = 3;

/**
 * The kinds of next action a fresh installation offers.
 *
 * A company's own list, editable in Settings like every other dropdown — these
 * are only what it starts as. Nothing in the code keys on any of these strings,
 * which is why they can be renamed freely; contrast
 * `dropdownItems.followUpResults`, where three entries *are* read by name.
 */
export const DEFAULT_NEXT_ACTION_KINDS: readonly string[] = [
  "تماس تلفنی",
  "ارسال ایمیل / مدارک",
  "جلسه یا بازدید",
  "پیگیری داخلی",
  "بررسی و تصمیم‌گیری",
  "اقدام اداری / مالی",
];

/**
 * The record that has just been saved, as the rule needs to see it.
 *
 * It is deliberately the *saved* record and never the form's own state: a new
 * record has no id until the server has written it, and a next action carrying
 * no id is a card nobody can trace back to the job it belongs to.
 */
export interface NextActionSource {
  /** `مشتری`, `پروژه`, … — one of `Task.relatedToType`. */
  relatedToType: string;
  relatedToId: string;
  /** What the record is called, printed on the card and used in the title. */
  relatedToName: string;
  /** Whoever pressed save; the next action starts with them. */
  assignedTo?: string | null;
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

/**
 * What the next action starts as, given the record just saved.
 *
 * Everything here is a **default a person then corrects**, and each one is the
 * answer that is right more often than any other:
 *
 * - the **record** carries over, because the next action is about the thing
 *   that was just written down and re-picking it is the commonest reason a
 *   prompt like this gets abandoned half way;
 * - the **assignee** is whoever pressed save — handing it to somebody else is a
 *   decision, and it belongs to the person, not to a default;
 * - and the **date** is a few working days out rather than tomorrow, since
 *   `addWorkingDaysToShamsi` already knows the holidays and a next action
 *   landing on Nowruz is one nobody does.
 *
 * The description is left **empty on purpose**. Seeding it with the name of
 * what was just saved is the `description: completionNote` fault the follow-up
 * card was corrected for: a card telling somebody what to do would describe
 * what somebody else had already done.
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
 * The kind leads, because that is what a person scans a board for, and the
 * record is named after it so a card raised this way is never a bare verb with
 * no context — the same reason the milestone rules write their provenance line.
 * The description the person typed is a separate field and is not folded in
 * here.
 */
export function nextActionTitle(kind: string, source: NextActionSource): string {
  const name = String(source.relatedToName ?? "").trim();
  const head = kind.trim();
  return name ? `${head} — ${name}` : head;
}
