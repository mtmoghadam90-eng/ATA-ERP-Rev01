import { getShamsiDaysDifference } from '../dateUtils';

/**
 * How long each stage of an import actually took.
 *
 * The purchase-order card lists the stages of the import — ordered, paid,
 * ready, shipped, cleared, received — each with the date it finished on. What
 * people want from that row is not the dates; it is where the time went, and
 * working that out by subtracting Shamsi dates in your head is exactly the sort
 * of arithmetic a screen should be doing.
 *
 * A stage's duration is its own date minus the date the stage before it
 * finished. Two things make that less obvious than it sounds:
 *
 *  - **The first stage has no predecessor**, so it has no duration. Ordering
 *    the goods is a moment, not a span.
 *  - **Stages get skipped.** Plenty of orders never record a payment date, or
 *    are cleared without a separate shipment date. Measuring against the
 *    immediately preceding *slot* would then give a blank for the stage after
 *    the gap, hiding the very interval that took longest. So each stage
 *    measures from the most recent earlier stage that has a date — the elapsed
 *    days then still add up across the whole row.
 *
 * A negative result is left as-is rather than clamped or hidden. Dates entered
 * out of order are a data-entry mistake, and showing "-۴ روز" is how someone
 * notices; silently rendering nothing is how it survives.
 */

export interface ImportStage {
  label: string;
  date?: string;
  color: string;
}

export interface ImportStageWithDuration extends ImportStage {
  /** Days this stage took, or null when there is nothing to measure from. */
  days: number | null;
}

export function importStageDurations(stages: ImportStage[]): ImportStageWithDuration[] {
  let previousDate: string | undefined;

  return stages.map((stage) => {
    if (!stage.date) return { ...stage, days: null };

    const days = previousDate ? getShamsiDaysDifference(previousDate, stage.date) : null;
    previousDate = stage.date;
    return { ...stage, days };
  });
}
