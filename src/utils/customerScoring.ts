/**
 * Customer levels, from what each customer has actually bought.
 *
 * Three criteria, in the order of importance the business gave them:
 *
 *   1. how often they buy   (weight 3)
 *   2. how much they spend  (weight 2)
 *   3. how many items       (weight 1)
 *
 * Each criterion scores 1, 2 or 3 against two configurable thresholds, and the
 * weighted average decides the level. Weighting rather than a strict priority
 * order because a strict order is not what "in order of importance" means in
 * practice: it would let one extra repeat purchase outrank any amount of money,
 * and a customer who buys twice a year for a billion rial would outrank nobody.
 * With these weights frequency still dominates — it alone can carry a customer
 * from برنزی to نقره‌ای — but it cannot decide the level on its own.
 *
 * The levels are internal. They exist so the company can decide who gets
 * special service and gifts, and are never shown to the customer.
 *
 * This is the single definition of the rule. It is pure so `test:rules` can
 * cover it without a database, and it runs on the server — `customerLevel` is
 * stored on the row so the grid can filter, sort, page and export by it, the
 * same way a project's derived status is stored rather than recomputed by every
 * reader.
 */

export const CUSTOMER_LEVELS = {
  GOLD: "طلایی",
  SILVER: "نقره‌ای",
  BRONZE: "برنزی",
  /** Never bought anything. Kept apart so "registered but never bought" is a
   *  list you can actually pull, rather than being mixed into the lowest tier. */
  NONE: "بدون خرید",
} as const;

export type CustomerLevel = typeof CUSTOMER_LEVELS[keyof typeof CUSTOMER_LEVELS];

/** Every level a filter may offer, best first. */
export const CUSTOMER_LEVEL_OPTIONS: CustomerLevel[] = [
  CUSTOMER_LEVELS.GOLD,
  CUSTOMER_LEVELS.SILVER,
  CUSTOMER_LEVELS.BRONZE,
  CUSTOMER_LEVELS.NONE,
];

/**
 * Where one criterion stops being worth 1 point and starts being worth 2, then
 * 3. `good` must not be below `fair`; `normalizeScoringSettings` repairs that
 * rather than producing a band no customer can ever land in.
 */
export interface ScoreBand {
  fair: number;
  good: number;
}

export interface CustomerScoringSettings {
  /** Distinct won proformas. */
  purchaseCount: ScoreBand;
  /** Won value in rial. */
  purchaseAmountRial: ScoreBand;
  /** Total quantity across won lines. */
  purchaseItemCount: ScoreBand;
  /** Weighted score at or above which a customer is طلایی / نقره‌ای. */
  goldFrom: number;
  silverFrom: number;
}

/**
 * Starting points, not a recommendation: every business has its own idea of a
 * big order. They are editable in settings, and changing them re-levels
 * everyone on the next recompute.
 */
export const DEFAULT_CUSTOMER_SCORING: CustomerScoringSettings = {
  purchaseCount: { fair: 2, good: 5 },
  purchaseAmountRial: { fair: 1_000_000_000, good: 5_000_000_000 },
  purchaseItemCount: { fair: 5, good: 20 },
  goldFrom: 2.5,
  silverFrom: 1.75,
};

/**
 * Weights, highest first. Their sum is the divisor, so the score stays 1..3.
 *
 * 3 against 2 + 1 balances deliberately: buying often is worth exactly as much
 * as buying big and broad put together. A regular small customer and a one-off
 * large one both come out نقره‌ای, which is the right answer — both are worth
 * keeping, and neither is obviously the better customer. Raising this to 4
 * would let frequency alone outrank everything else, which is a different
 * business decision, not a more accurate one.
 */
const WEIGHTS = { purchaseCount: 3, purchaseAmountRial: 2, purchaseItemCount: 1 } as const;
const WEIGHT_TOTAL = WEIGHTS.purchaseCount + WEIGHTS.purchaseAmountRial + WEIGHTS.purchaseItemCount;

export interface PurchaseTotals {
  purchaseCount: number;
  purchaseAmountRial: number;
  purchaseItemCount: number;
}

export interface CustomerScore extends PurchaseTotals {
  level: CustomerLevel;
  /** 1..3, or 0 for a customer who has never bought. Rounded to two places. */
  score: number;
  /** Each criterion's own 1..3, for explaining a level to whoever asks. */
  breakdown: { purchaseCount: number; purchaseAmountRial: number; purchaseItemCount: number };
}

const finite = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Fills in anything missing or nonsensical in the stored settings.
 *
 * Settings are user-editable JSON, so every field here can arrive absent, as a
 * string, or negative. A band whose `good` is below its `fair` would make the
 * top score unreachable, and a `silverFrom` above `goldFrom` would make نقره‌ای
 * unreachable — both are silently ordered instead of trusted.
 */
export function normalizeScoringSettings(
  raw: Partial<CustomerScoringSettings> | null | undefined,
): CustomerScoringSettings {
  const band = (input: Partial<ScoreBand> | undefined, fallback: ScoreBand): ScoreBand => {
    const fair = Math.max(0, finite(input?.fair, fallback.fair));
    const good = Math.max(0, finite(input?.good, fallback.good));
    return { fair: Math.min(fair, good), good: Math.max(fair, good) };
  };

  const goldFrom = finite(raw?.goldFrom, DEFAULT_CUSTOMER_SCORING.goldFrom);
  const silverFrom = finite(raw?.silverFrom, DEFAULT_CUSTOMER_SCORING.silverFrom);

  return {
    purchaseCount: band(raw?.purchaseCount, DEFAULT_CUSTOMER_SCORING.purchaseCount),
    purchaseAmountRial: band(raw?.purchaseAmountRial, DEFAULT_CUSTOMER_SCORING.purchaseAmountRial),
    purchaseItemCount: band(raw?.purchaseItemCount, DEFAULT_CUSTOMER_SCORING.purchaseItemCount),
    goldFrom: Math.max(goldFrom, silverFrom),
    silverFrom: Math.min(goldFrom, silverFrom),
  };
}

/** One criterion's 1..3. At the threshold counts as having reached it. */
export function bandScore(value: number, band: ScoreBand): 1 | 2 | 3 {
  const n = finite(value, 0);
  if (n >= band.good) return 3;
  if (n >= band.fair) return 2;
  return 1;
}

/**
 * The level a customer's purchase totals earn.
 *
 * Zero purchases is not a low score, it is the absence of one — such a customer
 * gets «بدون خرید» and a score of 0, never برنزی. Otherwise a customer with a
 * single small order and one who has never bought would be indistinguishable,
 * and the first is a customer while the second is a prospect.
 */
export function scoreCustomer(
  totals: Partial<PurchaseTotals> | null | undefined,
  settings?: Partial<CustomerScoringSettings> | null,
): CustomerScore {
  const config = normalizeScoringSettings(settings);

  const purchaseCount = Math.max(0, finite(totals?.purchaseCount, 0));
  const purchaseAmountRial = Math.max(0, finite(totals?.purchaseAmountRial, 0));
  const purchaseItemCount = Math.max(0, finite(totals?.purchaseItemCount, 0));

  const empty = { purchaseCount: 0, purchaseAmountRial: 0, purchaseItemCount: 0 };

  if (purchaseCount <= 0) {
    return {
      purchaseCount: 0, purchaseAmountRial, purchaseItemCount,
      level: CUSTOMER_LEVELS.NONE, score: 0, breakdown: empty,
    };
  }

  const breakdown = {
    purchaseCount: bandScore(purchaseCount, config.purchaseCount),
    purchaseAmountRial: bandScore(purchaseAmountRial, config.purchaseAmountRial),
    purchaseItemCount: bandScore(purchaseItemCount, config.purchaseItemCount),
  };

  const weighted =
    breakdown.purchaseCount * WEIGHTS.purchaseCount +
    breakdown.purchaseAmountRial * WEIGHTS.purchaseAmountRial +
    breakdown.purchaseItemCount * WEIGHTS.purchaseItemCount;

  const score = Math.round((weighted / WEIGHT_TOTAL) * 100) / 100;

  const level = score >= config.goldFrom
    ? CUSTOMER_LEVELS.GOLD
    : score >= config.silverFrom
      ? CUSTOMER_LEVELS.SILVER
      : CUSTOMER_LEVELS.BRONZE;

  return { purchaseCount, purchaseAmountRial, purchaseItemCount, level, score, breakdown };
}

/** True for a value that is one of the four levels — used to reject a filter. */
export function isCustomerLevel(value: unknown): value is CustomerLevel {
  return typeof value === "string" && (CUSTOMER_LEVEL_OPTIONS as string[]).includes(value);
}
