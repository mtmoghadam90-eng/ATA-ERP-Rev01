import { normalizeJalali } from "../server/dates";

/**
 * «چقدر است که در این وضعیت مانده؟» — the clock behind a dwell rule.
 *
 * The workflow engine has always been able to say «N days after a date the
 * record carries». What it could not say is how long a record has been *stuck*,
 * which is the question people actually have about a purchase order sitting in
 * transit or an after-sales job nobody has closed.
 *
 * The dates it had to count from were the wrong ones. `orderDateJalali` answers
 * «how long since the order was placed», and that gets worse the longer the job
 * runs: an order placed six months ago that reached customs yesterday is not
 * late, and a rule counting from its order date insists that it is.
 *
 * So each model with a real status of its own carries `statusChangedAt`, and
 * the whole discipline is in one sentence: **it is written only on a real
 * move.** Stamped on every save it would mean «last edited», every dwell rule
 * built on it would be silent for ever, and nothing on any screen would say
 * why. That is exactly the rule `Project.stageChangedAt` already follows, which
 * is why the two read the same way.
 *
 * This is the single writer, shared by every service that moves a status —
 * `test:rules` fails a hand-written `statusChangedAt:` assignment beside it.
 */

export interface StatusChangeColumns {
  statusChangedAt: Date;
  statusChangedAtJalali: string | null;
}

/**
 * The columns to write, or **null when nothing moved** — which is the answer
 * that matters, because the caller spreads this into a `data` object and null
 * has to leave the stored date alone.
 *
 * Three cases, and each one is a decision:
 *
 * - **The same value is not a move.** This is the whole rule; see above.
 * - **A first value where there was none *is* a move.** A record's first status
 *   is what it is waiting in, and the clock has to start there or the longest
 *   leg of the job — a freshly placed order sitting at the manufacturer — is
 *   the one leg no rule can ever see.
 * - **A save that says nothing about the status has not moved it.** A partial
 *   write omits the field, and reading an absent value as «it became blank»
 *   would restart the clock on every unrelated edit, which is the same fault as
 *   stamping on every save wearing a different hat.
 */
export function statusChangeColumns(
  previous: string | null | undefined,
  next: string | null | undefined,
  todayJalali: string,
): StatusChangeColumns | null {
  // Not sent, so not moved.
  if (next === undefined || next === null) return null;

  const to = String(next).trim();
  if (!to) return null;

  const from = previous === undefined || previous === null ? "" : String(previous).trim();
  if (from === to) return null;

  return { statusChangedAt: new Date(), statusChangedAtJalali: normalizeJalali(todayJalali) };
}
