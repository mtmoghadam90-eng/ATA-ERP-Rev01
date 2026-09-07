import { categoryKey } from "./productCategories";

/**
 * Who we lose to, and win against.
 *
 * The loss *reason* has been recorded per line since the sales follow-up
 * shipped and answers «چرا می‌بازیم». It cannot answer «به چه کسی» — and for a
 * company competing on price and lead time that is the half a salesperson can
 * act on: «به فراسو باختیم چون ۱۲٪ گران‌تر بودیم» is a decision, «قیمت» is not.
 *
 * Three rules decide the shape.
 *
 * **A competitor is a record, not a word on a document.** One competitor typed
 * onto two quotations is two competitors, and every figure about either is half
 * the truth — the exact fault the product categories were corrected for, so the
 * same folding refuses the duplicates it can see: case, ی/ي, ک/ك and the
 * zero-width joiner. It cannot know «فرا سو» is «فراسو», which is why the list
 * is a short one somebody curates rather than a box on every document.
 *
 * **The price is in the document's own currency**, beside `finalAmount` and for
 * the same reason `ProformaItem.unitCost` is: that is what makes the gap a
 * *percentage* independent of the exchange rate. A rial figure would need a
 * rate to compare against and would drift every time the dollar moved.
 *
 * **A competitor is named on a won document too.** «در برابر چه کسی بردیم» is
 * the same question and the same field; recording them only on losses would
 * make every win rate against them read as zero, which is worse than no figure.
 */

/* ------------------------------ the catalogue ----------------------------- */

/** What only differs by spelling, folded away. Two of these are one competitor. */
export function competitorKey(value: unknown): string {
  return categoryKey(value);
}

/**
 * Why this name cannot be added, or null.
 *
 * A duplicate is refused rather than merged: the two documents naming each
 * spelling are already on disk, and a person deciding which is the real name is
 * the only thing that can be right.
 */
export function competitorNameRefusal(
  name: unknown,
  existing: readonly { id?: string; name: string }[],
  /** The record being edited, which is not its own duplicate. */
  selfId?: string | null,
): string | null {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "نام رقیب را وارد کنید.";
  if (trimmed.length > 200) return "نام رقیب طولانی‌تر از حد مجاز است.";

  const key = competitorKey(trimmed);
  const clash = existing.find((c) => c.id !== selfId && competitorKey(c.name) === key);
  return clash ? `رقیبی با نام «${clash.name}» از قبل ثبت شده است.` : null;
}

/* -------------------------------- the gap -------------------------------- */

/**
 * How much more expensive we were, as a percentage of their price.
 *
 * Positive means we quoted above them, which is the ordinary case on a loss;
 * negative means we were cheaper and lost for some other reason, which is
 * exactly the finding worth having.
 *
 * **A competitor price of zero is «not recorded», never «free»** — the box is
 * left empty far more often than a competitor quotes nothing, and dividing by it
 * would produce an infinity the report would print. Our own amount of zero is
 * refused for the same reason: a technical quotation prices nothing.
 */
export function priceGapPercent(
  ourAmount: unknown,
  competitorAmount: unknown,
): number | null {
  const ours = Number(ourAmount);
  const theirs = Number(competitorAmount);
  if (!Number.isFinite(ours) || !Number.isFinite(theirs)) return null;
  if (ours <= 0 || theirs <= 0) return null;
  return ((ours - theirs) / theirs) * 100;
}

/* --------------------------- the project's copy --------------------------- */

export interface CompetitorProforma {
  competitorId?: string | null;
}

/**
 * The competitor a project was contested against, from its deciding quotations.
 *
 * The caller passes the **deciding** set — the same selection `deriveProjectStatus`
 * and `deriveProjectLossReason` make — so a superseded revision cannot name a
 * competitor the live quotation does not.
 *
 * Where they disagree the commonest wins, ties by document order, because a
 * report needs one value per project and picking one deterministically is the
 * point. It answers **null** rather than `undefined` when nothing names one,
 * which is where it differs from the loss reason: that column has a box on the
 * project form whose answer must be preserved, and this one has none — nothing
 * but this rule ever writes it, so there is nothing to keep.
 */
export function deriveProjectCompetitor(
  deciding: readonly CompetitorProforma[],
): string | null {
  const tally = new Map<string, number>();
  const order: string[] = [];

  for (const pf of deciding ?? []) {
    const id = String(pf.competitorId ?? "").trim();
    if (!id) continue;
    if (!tally.has(id)) order.push(id);
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }

  if (order.length === 0) return null;
  let best = order[0];
  for (const id of order) {
    if ((tally.get(id) ?? 0) > (tally.get(best) ?? 0)) best = id;
  }
  return best;
}

/* ------------------------------- the report ------------------------------- */

export interface CompetitorEncounter {
  competitorId: string;
  /** The derived outcome of the quotation, as `getProformaOutcome` gives it. */
  outcome: string;
  ourAmount?: unknown;
  competitorAmount?: unknown;
}

export interface CompetitorStanding {
  competitorId: string;
  /** Every quotation naming them, decided or not. */
  encounters: number;
  won: number;
  lost: number;
  /** Neither won nor lost yet — still being fought. */
  open: number;
  /** Of the decided ones only. Null when nothing has been decided. */
  winRatePercent: number | null;
  /** The median gap over the encounters that recorded both prices. */
  medianGapPercent: number | null;
  /** How many encounters could be priced at all — the figure's own coverage. */
  pricedEncounters: number;
}

const WON_OUTCOMES = new Set(["تأیید شده (برنده)", "نیمه برنده"]);
const LOST_OUTCOMES = new Set(["باخته"]);

/** The middle value, or the mean of the middle two. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How we stand against each competitor.
 *
 * **The median, not the mean.** One quotation where somebody typed the
 * competitor's rial price into a dollar document moves a mean by hundreds of
 * percent and the report reads as nonsense; the median absorbs it and the
 * coverage figure beside it says how much was priced at all.
 *
 * A cancelled or draft quotation is **neither won nor lost** — it is counted as
 * an encounter and left out of the win rate, because a customer who withdrew is
 * not a competitor's win, which is the same distinction `opportunityOutcome`
 * draws on the front page.
 */
export function competitorStandings(
  encounters: readonly CompetitorEncounter[],
): CompetitorStanding[] {
  const byId = new Map<string, { won: number; lost: number; open: number; gaps: number[]; total: number }>();

  for (const e of encounters ?? []) {
    const id = String(e.competitorId ?? "").trim();
    if (!id) continue;
    const row = byId.get(id) ?? { won: 0, lost: 0, open: 0, gaps: [], total: 0 };
    row.total += 1;
    if (WON_OUTCOMES.has(e.outcome)) row.won += 1;
    else if (LOST_OUTCOMES.has(e.outcome)) row.lost += 1;
    else row.open += 1;

    const gap = priceGapPercent(e.ourAmount, e.competitorAmount);
    if (gap !== null) row.gaps.push(gap);
    byId.set(id, row);
  }

  return [...byId.entries()]
    .map(([competitorId, row]) => {
      const decided = row.won + row.lost;
      return {
        competitorId,
        encounters: row.total,
        won: row.won,
        lost: row.lost,
        open: row.open,
        winRatePercent: decided === 0 ? null : (row.won / decided) * 100,
        medianGapPercent: median(row.gaps),
        pricedEncounters: row.gaps.length,
      };
    })
    // Most-met first: the competitor you meet twice a week is the one to know.
    .sort((a, b) => b.encounters - a.encounters || b.lost - a.lost);
}
