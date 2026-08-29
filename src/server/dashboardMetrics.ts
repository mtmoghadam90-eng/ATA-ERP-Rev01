import { StatusProforma, decidingProformas, getProformaOutcome } from "./proformaStatus";

/**
 * The pure arithmetic behind the front page's revenue and conversion figures.
 *
 * Separated from the service because both rules were reported wrong from live
 * data and neither can be checked against a database that is not reachable
 * from here: `test:rules` runs them instead.
 */

/* ----------------------- won value, once it is paid ---------------------- */

/**
 * A receipt (or a refund) as this calculation needs to see it.
 *
 * `countsTowardBalance` in `transactionService.ts` decides which rows are
 * money; this takes only the ones that are.
 */
export interface SettlementEntry {
  /** «دریافت» or «پرداخت» — the direction, and nothing else decides it. */
  type: string;
  amountRial: number;
  amountForeign: number | null;
  /** The rate on the day the money arrived. Never the invoice's own rate. */
  exchangeRate: number | null;
  isDirectForeign: boolean;
}

export interface WonValueInput {
  /** The won part of the document, in the document's own currency. */
  wonAmount: number;
  /** Rial per unit of the document's currency, today. 1 for a rial document. */
  todayRate: number;
  /** The rate stored on the document, used only when a receipt carries none. */
  historicalRate: number | null;
  entries: SettlementEntry[];
}

export interface WonValueResult {
  /** What this sale is worth in rial, for the front page's total. */
  rial: number;
  /**
   * `rial / wonAmount`, so the same figure can be split across the document's
   * lines without the parts drifting from the whole.
   */
  effectiveRate: number;
  /** How much of the sale the receipts covered, in the document's currency. */
  settledAmount: number;
}

const RECEIPT = "دریافت";
const PAYMENT = "پرداخت";

/**
 * What a won proforma contributes to «مجموع قراردادهای برنده».
 *
 * The widget used to report every won document at **today's** rate, so the
 * total moved every time the dollar did — including for contracts that were
 * invoiced, paid and closed years ago. A sale that has been settled is a
 * historical fact in rial: the customer handed over a number of rial and that
 * number does not change.
 *
 * So the value is in two parts. The settled part is frozen at the rial that
 * actually arrived, at the rate on the day it arrived. The outstanding part is
 * still exposed to the rate and converts at today's, which is what the sales
 * desk wants to see for a debt that has not been collected. A fully paid
 * contract therefore stops moving altogether, an unpaid one floats exactly as
 * before, and a half-paid one moves by half — no special case for any of them.
 *
 * A rial document comes out at its own amount whatever the receipts say, since
 * every rate in the arithmetic is 1.
 *
 * A foreign receipt carrying **no** settlement rate settles nothing here: there
 * is no way to say what proportion of the sale it covered, and guessing at
 * today's rate would move the frozen figure with the rate again. That sale goes
 * on floating until the rate is filled in, which is visible on the finance
 * screen rather than silently wrong here.
 */
export function wonValueRial(input: WonValueInput): WonValueResult {
  const { wonAmount, todayRate, historicalRate, entries } = input;
  const isRial = todayRate === 1 && (historicalRate === null || historicalRate === 1);

  let receivedRial = 0;
  let coveredAmount = 0;

  for (const t of entries) {
    const sign = t.type === PAYMENT ? -1 : t.type === RECEIPT ? 1 : 0;
    if (sign === 0) continue;

    if (isRial) {
      const rial = t.amountRial * sign;
      receivedRial += rial;
      coveredAmount += rial;
      continue;
    }

    // The receipt's own rate first: the difference between it and the
    // invoice's rate *is* the exchange gain, so the invoice's rate is only a
    // fallback for a row written before that box existed.
    const rate = positive(t.exchangeRate) ?? positive(historicalRate);
    if (!rate) continue;

    if (t.isDirectForeign) {
      const foreign = (t.amountForeign ?? 0) * sign;
      coveredAmount += foreign;
      receivedRial += foreign * rate;
    } else {
      const rial = t.amountRial * sign;
      receivedRial += rial;
      coveredAmount += rial / rate;
    }
  }

  // Money paid above the invoice is not sale value — it sits on account — so
  // the settled part is capped at what was sold, and the rial that went with
  // the excess is carved off in the same proportion.
  const settledAmount = Math.min(Math.max(coveredAmount, 0), Math.max(wonAmount, 0));
  const allocatedRial = coveredAmount > 0 ? receivedRial * (settledAmount / coveredAmount) : 0;

  const outstanding = Math.max(wonAmount - settledAmount, 0);
  const rial = allocatedRial + outstanding * todayRate;

  return {
    rial,
    effectiveRate: wonAmount > 0 ? rial / wonAmount : todayRate,
    settledAmount,
  };
}

function positive(n: number | null | undefined): number | null {
  return typeof n === "number" && n > 0 ? n : null;
}

/* --------------------- conversion, one per opportunity ------------------- */

export interface GroupedProforma extends StatusProforma {
  projectId?: string | null;
}

/**
 * One opportunity per project, and one per proforma that has no project.
 *
 * The front page's conversion rate counted **documents**: a project quoted ten
 * times and won once read as one win in ten, and a revision issued to correct a
 * typo pushed the whole company's conversion down. What the sales desk is
 * asking is how many of the jobs it chased were won, so a project is one data
 * point however many quotations it took.
 *
 * A proforma with no project stands alone rather than being dropped — it is
 * still a quotation somebody sent to a customer.
 */
export function opportunityGroups<T extends GroupedProforma>(proformas: T[]): T[][] {
  const byProject = new Map<string, T[]>();
  const alone: T[][] = [];

  for (const pf of proformas) {
    if (!pf.projectId) { alone.push([pf]); continue; }
    const bucket = byProject.get(pf.projectId);
    if (bucket) bucket.push(pf);
    else byProject.set(pf.projectId, [pf]);
  }

  return [...byProject.values(), ...alone];
}

export type OpportunityOutcome = "won" | "lost" | "open";

/**
 * What became of one opportunity, from the proformas that decide it.
 *
 * `decidingProformas` is the same selection the project's own status is
 * derived from, so the front page and the project card cannot disagree about
 * who won. Anything neither won nor closed is still in play and belongs in
 * neither the numerator nor the "lost" tally.
 */
export function opportunityOutcome<T extends GroupedProforma>(group: T[]): OpportunityOutcome {
  const deciders = decidingProformas(group);
  const outcomes = deciders.map((pf) => getProformaOutcome(pf));

  if (outcomes.some((o) => o === "تأیید شده (برنده)" || o === "نیمه برنده")) return "won";
  if (outcomes.length > 0 && outcomes.every((o) => o === "باخته" || o === "لغو شده")) return "lost";
  return "open";
}

/**
 * «میانگین تعداد پیش‌فاکتور برای هر پروژه» — how much back and forth a job takes.
 *
 * Rounded to one decimal because 1 and 2 are very different answers here and
 * whole numbers would hide the difference between them.
 */
export function averageProformasPerProject(proformas: number, projects: number): number {
  if (projects <= 0) return 0;
  return Math.round((proformas / projects) * 10) / 10;
}
