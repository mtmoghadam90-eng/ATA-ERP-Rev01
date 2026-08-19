import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { loadSettings } from "../settings";
import { getWonItemsCurrencyAmount } from "../../utils/finance";
import { getProformaOutcome } from "../proformaStatus";
import { scoreCustomer, CustomerScoringSettings } from "../../utils/customerScoring";
import type { Proforma } from "../../types";

/**
 * What a customer has bought, and the level it earns them.
 *
 * Re-derived whenever one of their proformas changes, inside the same
 * transaction — the treatment a project's status already gets, and for the same
 * reason: the customers grid filters, sorts, pages and exports on the level, and
 * a figure computed after the page has been fetched cannot do any of those.
 *
 * The arithmetic is **not** reimplemented here. `getWonItemsCurrencyAmount` in
 * `src/utils/finance.ts` is the authority on what a won proforma is worth —
 * it prorates discount, tax and extra costs across the won lines, which is
 * fiddly and already right. This maps database rows into the shape those rules
 * expect and applies the document's own stored exchange rate, exactly as
 * `projectFinance.ts` does. A second copy of the rule would drift, and the
 * weaker copy would be the one deciding who gets treated as a gold customer.
 */

/** The fields the finance rules read. Selected once, used by both callers. */
const SCORE_PROFORMA_SELECT = {
  id: true, status: true, isCancelled: true, currency: true,
  finalAmount: true, totalAmount: true,
  discountPercent: true, discountAmount: true, taxPercent: true, taxAmount: true,
  extraCosts: true, historicalExchangeRate: true,
  items: {
    select: {
      id: true, productName: true, quantity: true,
      unitPriceRial: true, totalPriceRial: true, status: true, supplyMethod: true,
    },
  },
} satisfies Prisma.ProformaSelect;

type ScoreProformaRow = Prisma.ProformaGetPayload<{ select: typeof SCORE_PROFORMA_SELECT }>;

const money = (value: unknown): number => Number(value ?? 0);

/**
 * A row in the shape `src/utils/finance.ts` expects.
 *
 * The line columns are `unitPriceRial`/`totalPriceRial` but hold the value in
 * the **proforma's own currency**, not rial — the names predate multi-currency
 * documents. The rules know that and call the field `RIYAL` for the same
 * historical reason, so the mapping is name-for-name and the conversion to rial
 * happens once, below, against the document's stored rate.
 */
function toFinanceProforma(row: ScoreProformaRow): Proforma {
  return {
    id: row.id,
    status: row.status,
    isCancelled: row.isCancelled,
    currency: row.currency,
    totalAmount: money(row.totalAmount),
    finalAmount: money(row.finalAmount),
    discountPercent: money(row.discountPercent),
    discountAmount: money(row.discountAmount),
    taxPercent: money(row.taxPercent),
    taxAmount: money(row.taxAmount),
    extraCosts: money(row.extraCosts),
    historicalExchangeRate: row.historicalExchangeRate ? money(row.historicalExchangeRate) : undefined,
    items: row.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: Number(item.quantity),
      unitPriceRIYAL: money(item.unitPriceRial),
      totalPriceRIYAL: money(item.totalPriceRial),
      status: item.status ?? undefined,
      supplyMethod: item.supplyMethod ?? undefined,
    })),
  } as unknown as Proforma;
}

export interface PurchaseTotalsResult {
  purchaseCount: number;
  purchaseAmountRial: number;
  purchaseItemCount: number;
}

/**
 * Totals across one customer's proformas.
 *
 * A "purchase" is a proforma that ended with at least one won line — a document
 * still being negotiated is not one, and neither is a lost or cancelled one.
 *
 * A foreign-currency document with no stored rate contributes its lines and its
 * count but **nothing to the amount**: its rial value is unknown, and guessing
 * at today's rate would restate a historical sale every time the rate moved.
 * The customer is not penalised on the criterion that can still be measured.
 */
export function totalsFromProformas(rows: ScoreProformaRow[]): PurchaseTotalsResult {
  let purchaseCount = 0;
  let purchaseAmountRial = 0;
  let purchaseItemCount = 0;

  for (const row of rows) {
    // The document's own outcome decides whether this is a sale, before any
    // line is looked at. A cancelled proforma keeps whatever its lines last
    // said — a line still marked برنده on a document that was withdrawn is not
    // a purchase, and counting it credited customers for deals that fell
    // through.
    const outcome = getProformaOutcome(row);
    if (outcome !== "تأیید شده (برنده)" && outcome !== "نیمه برنده") continue;

    const pf = toFinanceProforma(row);
    const wonAmountInCurrency = getWonItemsCurrencyAmount(pf);

    // Then the won lines — including ones that will be bought in rather than
    // taken from stock, because both are sales.
    const wonLines = row.items.filter((item) => item.status === "برنده");
    if (wonLines.length === 0 && wonAmountInCurrency <= 0) continue;

    purchaseCount += 1;
    purchaseItemCount += wonLines.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

    const isRial = !row.currency || row.currency === "ریال";
    const rate = isRial ? 1 : money(row.historicalExchangeRate);
    if (rate > 0) purchaseAmountRial += wonAmountInCurrency * rate;
  }

  return {
    purchaseCount,
    purchaseAmountRial: Math.round(purchaseAmountRial * 100) / 100,
    purchaseItemCount: Math.round(purchaseItemCount * 1000) / 1000,
  };
}

/**
 * Re-derives one customer's totals and level, inside the caller's transaction.
 *
 * Silent when the id is missing so callers can pass a nullable column without
 * checking first, and when the customer is gone — a proforma may outlive a
 * deleted customer only long enough for a cascade to finish.
 */
export async function syncCustomerScore(
  tx: Prisma.TransactionClient,
  customerId: string | null | undefined,
  scoring?: CustomerScoringSettings | null,
): Promise<void> {
  if (!customerId) return;

  const exists = await tx.customer.count({ where: { id: customerId } });
  if (exists === 0) return;

  const rows = await tx.proforma.findMany({
    where: { customerId },
    select: SCORE_PROFORMA_SELECT,
  });

  const totals = totalsFromProformas(rows);
  const settings = scoring ?? await loadScoringSettings();
  const scored = scoreCustomer(totals, settings);

  await tx.customer.update({
    where: { id: customerId },
    data: {
      purchaseCount: scored.purchaseCount,
      purchaseAmountRial: scored.purchaseAmountRial,
      purchaseItemCount: scored.purchaseItemCount,
      customerLevel: scored.level,
    },
  });
}

/** The thresholds as stored, or the defaults when nothing has been configured. */
export async function loadScoringSettings(): Promise<CustomerScoringSettings | null> {
  const settings = await loadSettings() as { customerScoring?: CustomerScoringSettings } | null;
  return settings?.customerScoring ?? null;
}

/**
 * Re-levels every customer.
 *
 * Needed because the thresholds live in settings while the level lives on the
 * row: editing the thresholds changes nobody until this runs. Also the only way
 * to fill in levels for customers that existed before the column did.
 *
 * Deliberately batched rather than one transaction over the whole table: this
 * touches every customer, and holding that many rows would block the
 * application for as long as it took. Each batch is consistent on its own,
 * which is all a scoreboard needs.
 */
export async function recomputeAllCustomerLevels(
  batchSize = 200,
): Promise<{ updated: number }> {
  const db = getDb();
  const scoring = await loadScoringSettings();

  let updated = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await db.customer.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (batch.length === 0) break;

    await db.$transaction(async (tx) => {
      for (const customer of batch) {
        await syncCustomerScore(tx, customer.id, scoring);
      }
    });

    updated += batch.length;
    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }

  return { updated };
}
