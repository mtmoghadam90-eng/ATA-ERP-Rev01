/**
 * How much work one person may have in «در حال انجام» at once.
 *
 * Two numbers on the account, and they answer two different questions.
 *
 * **The maximum is a refusal.** Somebody with eleven cards in the middle column
 * is not doing eleven things; they are doing one and have lost sight of ten. So
 * a move into «در حال انجام» that would take them past the cap is refused, and
 * refused *with the numbers in it* — a limit that stops a person without saying
 * what the limit is reads as the board being broken.
 *
 * **The minimum is a promotion.** It is the opposite failure: an empty middle
 * column beside a full «برای انجام» means somebody has to decide what to start,
 * every time, and the thing that gets started is whatever is at the top of the
 * screen rather than what is due. Below the minimum the system pulls the most
 * pressing cards up itself (`rankForTopUp`).
 *
 * **Absent means no limit, in both directions**, which is what makes this
 * additive: every account written before these columns existed has neither, and
 * a company that does not want the feature simply leaves them blank. Zero is
 * spelled the same way as absent on purpose — a maximum of zero would mean
 * «this person may never work», which nobody means by typing 0 into a box, and
 * a minimum of zero is the plain default.
 */

/** The account columns, named once so the form, the route and the service agree. */
export const WORK_LIMIT_FIELDS = ["minActiveTasks", "maxActiveTasks"] as const;
export type WorkLimitField = (typeof WORK_LIMIT_FIELDS)[number];

export interface WorkLimits {
  /** Below this, the board fills itself up. Null = never. */
  min: number | null;
  /** At this, a move into «در حال انجام» is refused. Null = no cap. */
  max: number | null;
}

/**
 * A stored number, or null for «not set».
 *
 * Anything that is not a positive whole number is not a limit: an empty box, a
 * zero, a negative, a decimal somebody typed by accident, or the string a JSON
 * body arrives as.
 */
export function normalizeLimit(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const whole = Math.floor(n);
  return whole > 0 ? whole : null;
}

export function readWorkLimits(row: {
  minActiveTasks?: unknown; maxActiveTasks?: unknown;
} | null | undefined): WorkLimits {
  return {
    min: normalizeLimit(row?.minActiveTasks),
    max: normalizeLimit(row?.maxActiveTasks),
  };
}

/**
 * Why the pair cannot be saved, or null.
 *
 * A minimum above the maximum is not a configuration, it is a contradiction:
 * the board would promote a card to reach the floor and refuse it for breaking
 * the ceiling, on the same press. Refused where it is typed rather than
 * discovered later by somebody whose cards will not move.
 */
export function workLimitRefusalReason(limits: WorkLimits): string | null {
  if (limits.min !== null && limits.max !== null && limits.min > limits.max) {
    return "حداقل کار همزمان نمی‌تواند از حداکثر بیشتر باشد.";
  }
  return null;
}

/**
 * How many more cards this person may take into «در حال انجام».
 *
 * Never negative: somebody already over the cap — because the limit was
 * lowered, or because a chase reached its due date on its own — may take on
 * nothing more, but nothing is thrown out of the column they are already
 * working in either. A limit is about what you *start*, not a thing that
 * empties your desk behind you.
 */
export function remainingCapacity(active: number, max: number | null): number {
  if (max === null) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, max - active);
}

/** How many cards should be pulled up to reach the floor. */
export function topUpShortfall(active: number, limits: WorkLimits): number {
  if (limits.min === null) return 0;
  const wanted = Math.max(0, limits.min - active);
  // The floor can never push somebody past the ceiling — see the refusal above,
  // but a stored pair from before that check still has to behave.
  return Math.min(wanted, remainingCapacity(active, limits.max));
}

/**
 * What to tell somebody whose cards would not move.
 *
 * The numbers are in the sentence because the alternative — «ظرفیت شما پر
 * است» — leaves them looking for a setting they cannot see, on a screen most
 * of them cannot open.
 */
export function capacityRefusalMessage(
  name: string | null,
  active: number,
  max: number,
  refused: number,
): string {
  const who = name ? `${name} ` : "";
  return `${refused} مورد منتقل نشد: ${who}هم‌اکنون ${active} کار در حال انجام دارد و حداکثر مجاز ${max} است.`
    + " ابتدا کارهای جاری را تمام کنید.";
}
