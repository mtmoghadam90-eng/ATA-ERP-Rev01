import { getDb } from "../db";
import { calculateProjectFinance } from "../../utils/finance";
import type { ExchangeRate, Project, Proforma, Transaction } from "../../types";

/**
 * Per-project financial position: what was sold, what has been received, what
 * remains, and how much of it is settled.
 *
 * The arithmetic is genuinely intricate — foreign-currency proformas are valued
 * at the rate stored on the document, receipts are allocated to the proforma
 * they name and otherwise to the project, and the remaining balance is restated
 * at today's rate. `src/utils/finance.ts` holds those rules and is **not**
 * reimplemented here: a second copy would drift, and the weaker one would be the
 * one producing the numbers the business acts on.
 *
 * What this adds is where the data comes from. The client used to run those
 * rules over every proforma and every transaction it had loaded, once per
 * project. Here each page's related records are fetched in three queries and the
 * same functions run over them.
 */

export interface ProjectFinanceRow {
  id: string;
  code: string;
  name: string;
  status: string;
  customerName: string;
  /** Null when a foreign-currency sale has no stored rate to value it at. */
  salesAmount: number | null;
  paidAmount: number;
  remainingAmount: number | null;
  settlementPercent: number;
}

/** DB rows carry Decimal and Date; the finance rules expect the client shapes. */
const money = (value: unknown): number => Number(value ?? 0);

/**
 * Financial positions for a set of projects, in three queries regardless of how
 * many projects are asked for.
 */
export async function summarizeProjectFinance(
  projectIds: string[],
): Promise<Map<string, ProjectFinanceRow>> {
  const result = new Map<string, ProjectFinanceRow>();
  if (projectIds.length === 0) return result;

  const db = getDb();

  const [projects, proformas, transactions, rates] = await Promise.all([
    db.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true, code: true, name: true, status: true,
        customer: { select: { companyName: true } },
      },
    }),
    db.proforma.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true, projectId: true, proformaNumber: true, status: true, isCancelled: true,
        currency: true, finalAmount: true, totalAmount: true,
        discountPercent: true, discountAmount: true, taxPercent: true, taxAmount: true,
        extraCosts: true, historicalExchangeRate: true,
        issueDateJalali: true,
        items: {
          select: {
            id: true, productName: true, quantity: true,
            unitPriceRial: true, totalPriceRial: true, status: true, supplyMethod: true,
          },
        },
      },
    }),
    db.transaction.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true, projectId: true, proformaId: true, customerId: true, supplierId: true,
        type: true, status: true, amountRial: true, amountForeign: true,
        exchangeRate: true, isDirectForeign: true, occurredAtJalali: true,
        reversalOfTransactionId: true,
      },
    }),
    db.exchangeRate.findMany(),
  ]);

  // The pure rules are written against the client types, so the rows are shaped
  // to match rather than the rules being rewritten to match the rows.
  const asProformas: Proforma[] = proformas.map((pf) => ({
    id: pf.id,
    projectId: pf.projectId ?? undefined,
    proformaNumber: pf.proformaNumber,
    status: pf.status,
    isCancelled: pf.isCancelled,
    currency: pf.currency,
    issueDate: pf.issueDateJalali ?? "",
    totalAmount: money(pf.totalAmount),
    finalAmount: money(pf.finalAmount),
    discountPercent: money(pf.discountPercent),
    discountAmount: money(pf.discountAmount),
    taxPercent: money(pf.taxPercent),
    taxAmount: money(pf.taxAmount),
    extraCosts: money(pf.extraCosts),
    historicalExchangeRate: pf.historicalExchangeRate ? money(pf.historicalExchangeRate) : undefined,
    items: pf.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: Number(item.quantity),
      unitPriceRIYAL: money(item.unitPriceRial),
      totalPriceRIYAL: money(item.totalPriceRial),
      status: item.status ?? undefined,
      supplyMethod: item.supplyMethod ?? undefined,
    })),
  })) as unknown as Proforma[];

  const asTransactions: Transaction[] = transactions.map((tx) => ({
    id: tx.id,
    projectId: tx.projectId ?? undefined,
    proformaId: tx.proformaId ?? undefined,
    customerId: tx.customerId ?? undefined,
    supplierId: tx.supplierId ?? undefined,
    type: tx.type,
    status: tx.status,
    date: tx.occurredAtJalali ?? "",
    amountRIYAL: money(tx.amountRial),
    amountForeign: tx.amountForeign ? money(tx.amountForeign) : undefined,
    exchangeRate: tx.exchangeRate ? money(tx.exchangeRate) : undefined,
    isDirectForeign: tx.isDirectForeign,
    reversalOfTransactionId: tx.reversalOfTransactionId ?? undefined,
  })) as unknown as Transaction[];

  const asRates: ExchangeRate[] = rates.map((rate) => ({
    id: rate.id,
    currency: rate.currency,
    name: rate.name,
    rateToRIYAL: money(rate.rateToRial),
    lastUpdated: rate.lastUpdated.toISOString(),
  })) as unknown as ExchangeRate[];

  for (const project of projects) {
    const asProject = {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      customerName: project.customer?.companyName ?? "",
    } as unknown as Project;

    const summary = calculateProjectFinance(asProject, asProformas, asTransactions, asRates);

    result.set(project.id, {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      customerName: project.customer?.companyName ?? "",
      salesAmount: summary.totalSalesHistoricalRiyal,
      paidAmount: summary.totalReceivedRiyal,
      remainingAmount: summary.totalRemainingCurrentRiyal,
      settlementPercent: summary.settlementPercent,
    });
  }

  return result;
}

/**
 * Records whose exchange rate is missing, which is what makes a total
 * unknowable rather than merely large.
 *
 * A foreign-currency sale with no stored rate cannot be valued in rial at all,
 * so the screen has to name those documents rather than quietly showing a
 * smaller number.
 */
export async function findMissingExchangeRates() {
  const db = getDb();

  const [proformas, transactions] = await Promise.all([
    db.proforma.findMany({
      where: {
        currency: { not: "ریال" },
        OR: [{ historicalExchangeRate: null }, { historicalExchangeRate: { lte: 0 } }],
      },
      select: {
        id: true, proformaNumber: true, currency: true, status: true,
        project: { select: { id: true, code: true, name: true } },
        customer: { select: { companyName: true } },
      },
      take: 200,
    }),
    db.transaction.findMany({
      where: {
        isDirectForeign: true,
        OR: [{ exchangeRate: null }, { exchangeRate: { lte: 0 } }],
      },
      select: {
        id: true, documentNumber: true, type: true, occurredAtJalali: true,
        project: { select: { id: true, code: true, name: true } },
      },
      take: 200,
    }),
  ]);

  return { proformas, transactions };
}
