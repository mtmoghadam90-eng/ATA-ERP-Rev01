import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { ITEM_CANCELLED, ITEM_LOST, ITEM_WON, getProformaOutcome } from "../proformaStatus";

/**
 * The figures the front page shows.
 *
 * This is the screen the migration exists for. It used to be handed eight whole
 * collections — every customer, product, project, proforma, order, transaction,
 * task and category group — so that it could reduce them down to about a dozen
 * numbers. At the volumes this system is being built for that is minutes of
 * transfer to render one page.
 *
 * Everything here is counted or summed in SQL, in one request. The two figures
 * that cannot be (won revenue and revenue by category) are explained where they
 * are computed.
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
    /** Won value across every won and partly-won proforma, converted to rial. */
    wonRial: string;
    /** Value of proformas still in play. */
    activeRial: string;
    activeCount: number;
    /** Won proformas as a percentage of every proforma issued. */
    winRatePercent: number;
    wonCount: number;
    totalCount: number;
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
 * Won proformas, with just enough of each to derive its outcome and its value.
 *
 * The one place that still reads rows rather than aggregating them, because the
 * outcome is derived from the line statuses and a partly-won proforma counts
 * only the proportion actually won — neither of which SQL can express without
 * duplicating the rules. The projection is narrow and the set is bounded by
 * "has at least one won line", so this is a fraction of what the browser used
 * to pull.
 */
async function wonProformaValues(where: Prisma.ProformaWhereInput) {
  return getDb().proforma.findMany({
    where: { ...where, items: { some: { status: "برنده" } } },
    select: {
      status: true, isCancelled: true, currency: true,
      finalAmount: true, totalAmount: true,
      items: {
        select: {
          status: true, supplyMethod: true, totalPriceRial: true,
          product: { select: { category: true } },
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
    projectsByStatus, wonRows, activeAgg,
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
    wonProformaValues(proformaWhere),
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
  let wonCount = 0;
  const byCategory = new Map<string, number>();

  for (const pf of wonRows) {
    const outcome = getProformaOutcome(pf);
    if (outcome !== "تأیید شده (برنده)" && outcome !== "نیمه برنده") continue;
    wonCount++;

    const rate = rateFor(pf.currency);
    const finalAmount = Number(pf.finalAmount);
    const totalAmount = Number(pf.totalAmount);
    const wonLinesTotal = pf.items
      .filter((i) => i.status === "برنده")
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

    wonRial += wonAmount * rate;

    for (const item of pf.items) {
      if (item.status !== "برنده") continue;
      const category = item.product?.category || "سایر تجهیزات";
      byCategory.set(category, (byCategory.get(category) ?? 0) + Number(item.totalPriceRial) * rate);
    }
  }

  const activeRial = activeAgg.reduce(
    (sum, row) => sum + Number(row._sum.finalAmount ?? 0) * rateFor(row.currency), 0);

  // The denominator is every proforma the caller may see, cancelled ones
  // included — a deal that was called off is still one that was not won.
  const totalCount = await db.proforma.count({ where: proformaWhere });

  /* Conversion by category: of everything quoted in a category, how much was
     won — by quantity, not by value, so a category is not dominated by one
     expensive line. Grouped in SQL because the category lives on the product
     rather than the line, which `groupBy` cannot reach. Cancelled documents are
     excluded: they were withdrawn, not lost. */
  const conversionRows = await db.$queryRaw<
    { category: string; won: number; total: number }[]
  >`
    SELECT ISNULL(p.[category], N'سایر تجهیزات') AS [category],
           SUM(CASE WHEN i.[status] = N'برنده' THEN i.[quantity] ELSE 0 END) AS [won],
           SUM(i.[quantity]) AS [total]
    FROM [dbo].[proforma_items] i
    INNER JOIN [dbo].[proformas] pf ON pf.[id] = i.[proformaId]
    LEFT JOIN [dbo].[products] p ON p.[id] = i.[productId]
    WHERE pf.[isCancelled] = 0 AND pf.[status] <> N'لغو شده'
      ${canSeeAll ? Prisma.empty : Prisma.sql`AND pf.[creatorUserId] = ${user.id}`}
    GROUP BY ISNULL(p.[category], N'سایر تجهیزات')
  `;

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
      totalCount,
    },
    projectsByStatus: projectsByStatus
      .map((s) => ({ status: s.status, count: s._count._all }))
      .sort((a, b) => b.count - a.count),
    revenueByCategory: [...byCategory.entries()]
      .map(([category, rial]) => ({ category, rial: String(Math.round(rial)) }))
      .sort((a, b) => Number(b.rial) - Number(a.rial)),
    conversionByCategory: conversionRows
      .map((row) => {
        const won = Number(row.won);
        const total = Number(row.total);
        return {
          category: row.category,
          won, total,
          percent: total > 0 ? Math.round((won / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.percent - a.percent || b.total - a.total),
  };
}
