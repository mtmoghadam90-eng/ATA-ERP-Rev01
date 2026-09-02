import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import {
  ITEM_CANCELLED, ITEM_LOST, ITEM_WON, decidingProformas, getProformaOutcome,
} from "../proformaStatus";
import {
  averageProformasPerProject, opportunityGroups, opportunityOutcome, wonValueRial,
} from "../dashboardMetrics";
import { countsTowardBalance } from "./transactionService";

/**
 * The figures the front page shows.
 *
 * This is the screen the migration exists for. It used to be handed eight whole
 * collections — every customer, product, project, proforma, order, transaction,
 * task and category group — so that it could reduce them down to about a dozen
 * numbers. At the volumes this system is being built for that is minutes of
 * transfer to render one page.
 *
 * Almost everything here is counted or summed in SQL, in one request. What
 * cannot be is the sales figures: a proforma's outcome is derived from its line
 * statuses, an opportunity's outcome from the proformas that decide it, and a
 * won contract's rial value from the receipts against it — none of which SQL
 * can express without a second copy of the rules. Those read rows, through one
 * query with a narrow projection.
 */

export interface DashboardSummary {
  counts: {
    customers: number;
    products: number;
    projects: number;
    lowStock: number;
    activePurchaseOrders: number;
  };
  revenue: {
    /**
     * Won value across every won and partly-won proforma, in rial — frozen at
     * what was actually paid for the settled part, at today's rate for the rest.
     */
    wonRial: string;
    /** Value of proformas still in play. */
    activeRial: string;
    activeCount: number;
    /**
     * Won opportunities as a percentage of every opportunity, where an
     * opportunity is a **project**, not a document.
     */
    winRatePercent: number;
    wonCount: number;
    lostCount: number;
    /** Withdrawn rather than lost — see `opportunityOutcome`. */
    cancelledCount: number;
    totalCount: number;
    /** «چقدر رفت و برگشت» — proformas issued per project, to one decimal. */
    averageProformasPerProject: number;
  };
  projectsByStatus: { status: string; count: number }[];
  /** Won revenue per product category, largest first. */
  revenueByCategory: { category: string; rial: string }[];
  /** How much of what was quoted in each category was actually won, by quantity. */
  conversionByCategory: { category: string; won: number; total: number; percent: number }[];
}

/** Persian currency names as the documents store them, to their rate codes. */
const CURRENCY_CODES: Record<string, string> = {
  "دلار": "USD",
  "یورو": "EUR",
  "درهم": "AED",
  "یوان": "CNY",
};

async function rateLookup(): Promise<(currency: string | null | undefined) => number> {
  const rates = await getDb().exchangeRate.findMany({ select: { currency: true, rateToRial: true } });
  const byCode = new Map(rates.map((r) => [r.currency, Number(r.rateToRial)]));

  return (currency) => {
    if (!currency || currency === "ریال") return 1;
    const code = CURRENCY_CODES[currency] ?? currency;
    // An unknown currency converts at 1 rather than 0: treating it as worthless
    // would quietly delete revenue from the total.
    return byCode.get(code) ?? 1;
  };
}

/**
 * Every proforma the caller may see, with just enough of each to derive what
 * became of it and what it is worth.
 *
 * The whole set rather than the won ones, because the conversion figures are
 * per **project** and a project's deciding quotation cannot be picked out in
 * SQL. The projection is scalar columns plus line statuses and quantities, so
 * this is a fraction of what the browser used to pull for the same screen.
 */
async function dashboardProformas(where: Prisma.ProformaWhereInput) {
  return getDb().proforma.findMany({
    where,
    select: {
      id: true, projectId: true, createdAt: true,
      status: true, isCancelled: true, currency: true,
      finalAmount: true, totalAmount: true, historicalExchangeRate: true,
      items: {
        select: {
          status: true, quantity: true, totalPriceRial: true,
          product: { select: { category: true } },
        },
      },
      transactions: {
        select: {
          type: true, status: true, amountRial: true,
          amountForeign: true, exchangeRate: true, isDirectForeign: true,
        },
      },
    },
  });
}

export async function dashboardSummary(user: AuthUser): Promise<DashboardSummary> {
  const db = getDb();
  const rateFor = await rateLookup();

  // Proformas the caller may see. Projects and customers carry per-record
  // visibility; the front page respects it rather than reporting totals that
  // include records the user cannot open.
  const canSeeAll = hasPermission(user, "proformas");
  const proformaWhere: Prisma.ProformaWhereInput = canSeeAll ? {} : { creatorUserId: user.id };

  const [
    customers, products, lowStock, activePurchaseOrders,
    projectsByStatus, rows, activeAgg,
  ] = await Promise.all([
    db.customer.count(),
    db.product.count(),
    // "At or below its own minimum" is a column-to-column comparison, which
    // Prisma cannot express, so it is one raw scalar rather than loading stock
    // levels into the browser to compare them there.
    db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM [dbo].[products]
      WHERE [stockLevel] <= [minStockLevel]
    `.then((rows) => Number(rows[0]?.n ?? 0)),
    db.purchaseOrder.count({ where: { status: { not: "تحویل شده (رسید انبار)" } } }),
    db.project.groupBy({ by: ["status"], _count: { _all: true } }),
    dashboardProformas(proformaWhere),
    /* Everything still in play, summed per currency so each converts at its own
       rate rather than being added together first.

       "In play" cannot come from the stored status: that is the workflow stage
       (draft, sent) and stays "sent" after the deal is decided. What decides it
       is the lines — so a proforma counts here only when none of them has been
       won, and at least one is still open. Filtering on the stored status alone
       counted every won proforma a second time. */
    db.proforma.groupBy({
      by: ["currency"],
      where: {
        ...proformaWhere,
        isCancelled: false,
        status: { in: ["پیش‌نویس", "ارسال شده"] },
        NOT: { items: { some: { status: ITEM_WON } } },
        OR: [
          // No lines at all: the stored status is all there is to go on.
          { items: { none: {} } },
          { items: { some: { OR: [{ status: null }, { status: { notIn: [ITEM_LOST, ITEM_CANCELLED] } }] } } },
        ],
      },
      _sum: { finalAmount: true },
      _count: { _all: true },
    }),
  ]);

  /* Won revenue, and the same value split by product category. */
  let wonRial = 0;
  const byCategory = new Map<string, number>();

  for (const pf of rows) {
    const outcome = getProformaOutcome(pf);
    if (outcome !== "تأیید شده (برنده)" && outcome !== "نیمه برنده") continue;

    const finalAmount = Number(pf.finalAmount);
    const totalAmount = Number(pf.totalAmount);
    const wonLinesTotal = pf.items
      .filter((i) => i.status === ITEM_WON)
      .reduce((sum, i) => sum + Number(i.totalPriceRial), 0);

    // A wholly won proforma is worth its final amount. A partly won one is
    // worth the same proportion of it that its won lines are of its total, so
    // that discounts and taxes on the document are shared fairly rather than
    // credited entirely to the lines that happened to win.
    const wonAmount = outcome === "تأیید شده (برنده)"
      ? finalAmount
      : totalAmount > 0
        ? Math.round(finalAmount * (wonLinesTotal / totalAmount))
        : 0;

    const { rial, effectiveRate } = wonValueRial({
      wonAmount,
      todayRate: rateFor(pf.currency),
      historicalRate: pf.historicalExchangeRate === null ? null : Number(pf.historicalExchangeRate),
      entries: pf.transactions
        .filter((t) => countsTowardBalance(t.status))
        .map((t) => ({
          type: t.type,
          amountRial: Number(t.amountRial),
          amountForeign: t.amountForeign === null ? null : Number(t.amountForeign),
          exchangeRate: t.exchangeRate === null ? null : Number(t.exchangeRate),
          isDirectForeign: t.isDirectForeign,
        })),
    });

    wonRial += rial;

    // The lines are converted at the rate the document as a whole came out at,
    // so the categories still add up to the total beside them.
    for (const item of pf.items) {
      if (item.status !== ITEM_WON) continue;
      const category = item.product?.category || "سایر تجهیزات";
      byCategory.set(category, (byCategory.get(category) ?? 0) + Number(item.totalPriceRial) * effectiveRate);
    }
  }

  const activeRial = activeAgg.reduce(
    (sum, row) => sum + Number(row._sum.finalAmount ?? 0) * rateFor(row.currency), 0);

  /* Conversion, counted per opportunity rather than per document.
     A project quoted ten times and won once is one win, not one in ten. */
  const groups = opportunityGroups(rows);
  let wonCount = 0;
  let lostCount = 0;
  /* Counted apart from the losses: a job the customer withdrew says nothing
     about how the sales desk is performing, and mixing the two makes «چرا
     می‌بازیم» unanswerable. See `opportunityOutcome`. */
  let cancelledCount = 0;
  for (const group of groups) {
    const result = opportunityOutcome(group);
    if (result === "won") wonCount++;
    else if (result === "lost") lostCount++;
    else if (result === "cancelled") cancelledCount++;
  }
  const totalCount = groups.length;

  /* Conversion by category: of everything quoted in a category, how much was
     won — by quantity, not by value, so a category is not dominated by one
     expensive line. Only the proformas that decide their project count, for the
     same reason the rate above does; cancelled documents are excluded, since
     they were withdrawn rather than lost. */
  const conversion = new Map<string, { won: number; total: number }>();
  for (const group of groups) {
    for (const pf of decidingProformas(group)) {
      if (pf.isCancelled || pf.status === "لغو شده") continue;
      for (const item of pf.items) {
        const category = item.product?.category || "سایر تجهیزات";
        const bucket = conversion.get(category) ?? { won: 0, total: 0 };
        const quantity = Number(item.quantity);
        bucket.total += quantity;
        if (item.status === ITEM_WON) bucket.won += quantity;
        conversion.set(category, bucket);
      }
    }
  }

  /* «چقدر رفت و برگشت داریم» — quotations issued per project. Proformas with
     no project are left out of both halves rather than counted against a
     project that does not exist. */
  const projectIds = new Set<string>();
  let proformasOnProjects = 0;
  for (const pf of rows) {
    if (!pf.projectId) continue;
    proformasOnProjects++;
    projectIds.add(pf.projectId);
  }

  return {
    counts: {
      customers, products, lowStock, activePurchaseOrders,
      projects: projectsByStatus.reduce((sum, s) => sum + s._count._all, 0),
    },
    revenue: {
      wonRial: String(Math.round(wonRial)),
      activeRial: String(Math.round(activeRial)),
      activeCount: activeAgg.reduce((sum, row) => sum + row._count._all, 0),
      winRatePercent: totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0,
      wonCount,
      lostCount,
      cancelledCount,
      totalCount,
      averageProformasPerProject: averageProformasPerProject(proformasOnProjects, projectIds.size),
    },
    projectsByStatus: projectsByStatus
      .map((s) => ({ status: s.status, count: s._count._all }))
      .sort((a, b) => b.count - a.count),
    revenueByCategory: [...byCategory.entries()]
      .map(([category, rial]) => ({ category, rial: String(Math.round(rial)) }))
      .sort((a, b) => Number(b.rial) - Number(a.rial)),
    conversionByCategory: [...conversion.entries()]
      .map(([category, { won, total }]) => ({
        category, won, total,
        percent: total > 0 ? Math.round((won / total) * 100) : 0,
      }))
      .sort((a, b) => b.percent - a.percent || b.total - a.total),
  };
}
