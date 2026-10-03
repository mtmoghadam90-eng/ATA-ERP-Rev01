/**
 * A queued message waits on the quiet-time rules as they stand, not as they
 * stood when it was queued.
 *
 * `queueMessage` applies the quiet hours and days at insert and stores the
 * answer on the row as `scheduledAt` — deliberately, so the outbox says when a
 * message will go out. The flaw is that the answer was then final. Reported as
 * a referral notice stuck in «در صف ارسال»: the colleagues' quiet window had
 * been set back to front (08:30 to 19:30, i.e. quiet all working day), the
 * notice was queued under it and given 19:30, the window was corrected — and the
 * row went on waiting for 19:30, because nothing ever looks at a queued row's
 * time again, and «اجرای صف» only sends what is already due.
 *
 * So the time is re-derived when the rules change: from what was **asked for**
 * (`requestedAt` — now, a chosen time, a `delayDays`, a retry's backoff), through
 * the same `nextSendableTime` the insert used. Re-deriving from the *stored*
 * time instead would be wrong in the other direction: 19:30 under the corrected
 * window is the start of quiet hours, and the notice would move to tomorrow.
 *
 * **A row with no `requestedAt` is not guessed at, with one exception.** Every
 * row queued before the column has none, and for most of them the creation time
 * is not what was asked for — a workflow message with `delayDays: 2` was created
 * now and asked for two days from now, and re-deriving it from `createdAt` would
 * send it to a customer early. A **staff notice** is the exception: it is never
 * scheduled (`notifyStaff` passes no time), so for one that has not yet been
 * attempted the creation time *is* what was asked for — and that is exactly the
 * row this was reported on. Anything else without the column keeps its time.
 */
import { nextSendableTime, type MessageAudience, type QuietHours } from "./messaging";

export interface QueuedRowTiming {
  requestedAt: Date | null;
  createdAt: Date;
  scheduledAt: Date;
  audience: MessageAudience;
  attempts: number;
}

/** What the row asked for, or null when that cannot be known. */
export function requestedTimeOf(row: QueuedRowTiming): Date | null {
  if (row.requestedAt) return row.requestedAt;
  if (row.audience === "STAFF" && row.attempts === 0) return row.createdAt;
  return null;
}

/**
 * The row's time under the rules in force, or null when it should be left
 * alone (nothing to derive from, or the answer is the time it already has).
 */
export function replannedTime(
  row: QueuedRowTiming,
  quiet: QuietHours | null | undefined,
  isQuietDay?: ((day: Date) => boolean) | null,
): Date | null {
  const base = requestedTimeOf(row);
  if (!base) return null;
  const next = nextSendableTime(base, quiet, isQuietDay);
  return next.getTime() === row.scheduledAt.getTime() ? null : next;
}
