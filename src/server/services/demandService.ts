import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { jalaliRangeFilter } from "../dates";
import { ITEM_CANCELLED, ITEM_LOST, ITEM_WON } from "../proformaStatus";
import { visibilityClause as proformaVisibility } from "./proformaService";
import { visibilityClause as projectVisibility } from "./projectService";

import {
  DEMAND_SOURCE_SPECS, DemandGrouping, DemandLine, DemandOutcome, DemandRow,
  DemandSource, demandRefusal, describeDemand, foldDemand, lineMatchesOutcome,
} from "../../utils/demandAnalysis";

/**
 * Which goods are being asked for.
 *
 * The rules are `src/utils/demandAnalysis.ts`; this is the reading. It exists
 * because the assistant had no way to answer «بیشترین درخواست برای چه کالایی
 * بوده» and answered it from `revenueByCategory` instead — won revenue, per
 * category — which is a different measure of a different thing at a different
 * level. See that module's opening note.
 *
 * Every source goes through the module's **own** visibility rule, so this is
 * not a second door onto the data: a user who cannot see a colleague's
 * quotations cannot count their lines here either.
 */

/**
 * How many lines one question may read.
 *
 * A scan rather than a `groupBy`, and deliberately: the answer has to count
 * **distinct documents and distinct customers**, which no single aggregate
 * gives, and it has to bucket the free-text lines by their folded words, which
 * SQL Server's collation cannot be asked to do. The projection is four or five
 * short columns, so this is a cheap read of a small table — and when it is not,
 * `truncated` says so in the answer's own sentence rather than quietly
 * reporting a number that is missing its oldest half.
 */
export const DEMAND_SCAN_LIMIT = 20_000;

export interface DemandQuery {
  source: DemandSource;
  grouping: DemandGrouping;
  outcome: DemandOutcome;
  fromJalali?: string | null;
  toJalali?: string | null;
  /** Only this product category. Matched exactly, as the column stores it. */
  category?: string | null;
  /** Free text against the line's own words and the catalogue name. */
  search?: string | null;
  limit: number;
}

export interface DemandReport {
  /** The sentence saying what this measured. The answer is told to repeat it. */
  measured: string;
  source: DemandSource;
  sourceLabel: string;
  grouping: DemandGrouping;
  linesScanned: number;
  truncated: boolean;
  totals: { lines: number; documents: number; groups: number };
  rows: DemandRow[];
  /** Set instead of `rows` when the question cannot be answered as asked. */
  error?: string;
}

const WORDS = { won: ITEM_WON, lost: ITEM_LOST, cancelled: ITEM_CANCELLED };

const contains = (value: string) => ({ contains: value });

export async function productDemand(
  query: DemandQuery,
  user: AuthUser,
): Promise<DemandReport> {
  const spec = DEMAND_SOURCE_SPECS[query.source];
  const base: Omit<DemandReport, "rows"> = {
    measured: "",
    source: query.source,
    sourceLabel: spec.label,
    grouping: query.grouping,
    linesScanned: 0,
    truncated: false,
    totals: { lines: 0, documents: 0, groups: 0 },
  };

  const refusal = demandRefusal(String(query.fromJalali ?? ""), String(query.toJalali ?? ""));
  if (refusal) return { ...base, measured: refusal, rows: [], error: refusal };

  const range = jalaliRangeFilter(query.fromJalali, query.toJalali);
  const search = String(query.search ?? "").trim();
  const category = String(query.category ?? "").trim();

  const lines = query.source === "PROFORMA"
    ? await proformaLines(user, range, category, search)
    : query.source === "PROJECT"
      ? await projectLines(user, range, category, search)
      : await inquiryLines(user, range, category, search);

  if ("error" in lines) {
    return { ...base, measured: lines.error, rows: [], error: lines.error };
  }

  /*
   * The outcome filter runs here rather than in the query on purpose. OPEN is
   * «not won, not lost, not cancelled» — an exclusion over a nullable column,
   * which is exactly the shape that drops the undecided rows when it is written
   * as a `NOT` and handed to SQL, and the undecided rows are most of them.
   */
  const kept = spec.hasOutcome && query.outcome !== "ALL"
    ? lines.rows.filter((line) => lineMatchesOutcome(line.status, query.outcome, WORDS))
    : lines.rows;

  const rows = foldDemand(kept, query.grouping, WORDS);
  const documents = new Set(kept.map((line) => line.documentId)).size;

  return {
    ...base,
    measured: describeDemand({
      source: query.source,
      grouping: query.grouping,
      outcome: query.outcome,
      fromJalali: query.fromJalali,
      toJalali: query.toJalali,
      category,
      truncated: lines.truncated,
    }),
    linesScanned: lines.rows.length,
    truncated: lines.truncated,
    totals: { lines: kept.length, documents, groups: rows.length },
    rows: rows.slice(0, query.limit),
  };
}

type LineResult = { rows: DemandLine[]; truncated: boolean } | { error: string };

/* ------------------------------- proformas ------------------------------- */

/**
 * Quotation lines: the primary evidence of what customers ask for.
 *
 * Cancelled documents are excluded — a quotation the customer withdrew before
 * it was ever priced is not a request anybody made — while the individual
 * lines' own statuses are kept, so «کدام کالا را بیشتر باخته‌ایم» is the same
 * query with a different outcome filter rather than a second one.
 */
async function proformaLines(
  user: AuthUser,
  range: { gte?: Date; lte?: Date } | undefined,
  category: string,
  search: string,
): Promise<LineResult> {
  const visibility = proformaVisibility(user);
  const rows = await getDb().proformaItem.findMany({
    where: {
      proforma: {
        isCancelled: false,
        ...(visibility ?? {}),
        ...(range ? { issueDate: range } : {}),
      },
      ...(category ? { product: { category } } : {}),
      ...(search
        ? { OR: [{ productName: contains(search) }, { product: { displayName: contains(search) } }] }
        : {}),
    },
    select: {
      proformaId: true, productId: true, variantId: true,
      productName: true, productCode: true, quantity: true,
      totalPriceRial: true, status: true,
      proforma: { select: { customerId: true } },
      product: { select: { displayName: true, category: true, code: true } },
      variant: { select: { sku: true } },
    },
    // Newest first, so a truncated scan is missing the oldest history rather
    // than an arbitrary slice — which is what makes the warning actionable.
    orderBy: { proforma: { issueDate: "desc" } },
    take: DEMAND_SCAN_LIMIT + 1,
  });

  return {
    truncated: rows.length > DEMAND_SCAN_LIMIT,
    rows: rows.slice(0, DEMAND_SCAN_LIMIT).map((row) => ({
      documentId: row.proformaId,
      partyId: row.proforma?.customerId ?? null,
      productId: row.productId,
      variantId: row.variantId,
      name: row.productName,
      productName: row.product?.displayName ?? row.productName,
      productCode: row.product?.code ?? row.productCode,
      variantSku: row.variant?.sku ?? null,
      category: row.product?.category ?? null,
      quantity: Number(row.quantity),
      /*
       * `totalPriceRial` holds the **document's own currency**, like
       * `unitPriceRial` beside it, so this is only summed as a tie-breaker and
       * as a rough weight — never reported as a rial total, which would add
       * dollars to rial. The ranking that matters is the count.
       */
      valueRial: Number(row.totalPriceRial),
      status: row.status,
    })),
  };
}

/* -------------------------------- projects ------------------------------- */

async function projectLines(
  user: AuthUser,
  range: { gte?: Date; lte?: Date } | undefined,
  category: string,
  search: string,
): Promise<LineResult> {
  const visibility = projectVisibility(user);
  const rows = await getDb().projectItem.findMany({
    where: {
      project: { ...(visibility ?? {}), ...(range ? { createdAt: range } : {}) },
      ...(category ? { OR: [{ category }, { product: { category } }] } : {}),
      ...(search
        ? { OR: [{ name: contains(search) }, { product: { displayName: contains(search) } }] }
        : {}),
    },
    select: {
      projectId: true, productId: true, variantId: true, name: true,
      quantity: true, category: true,
      project: { select: { customerId: true } },
      product: { select: { displayName: true, category: true, code: true } },
    },
    orderBy: { project: { createdAt: "desc" } },
    take: DEMAND_SCAN_LIMIT + 1,
  });

  return {
    truncated: rows.length > DEMAND_SCAN_LIMIT,
    rows: rows.slice(0, DEMAND_SCAN_LIMIT).map((row) => ({
      documentId: row.projectId,
      partyId: row.project?.customerId ?? null,
      productId: row.productId,
      // The client stores the sentinel 'generic' here to mean «this product, no
      // particular SKU» — grouping by it would invent a variant nobody chose.
      variantId: row.variantId === "generic" ? null : row.variantId,
      name: row.name,
      productName: row.product?.displayName ?? row.name,
      productCode: row.product?.code ?? null,
      variantSku: null,
      category: row.product?.category ?? row.category ?? null,
      quantity: Number(row.quantity),
      valueRial: 0,
      status: null,
    })),
  };
}

/* ------------------------------- inquiries ------------------------------- */

async function inquiryLines(
  user: AuthUser,
  range: { gte?: Date; lte?: Date } | undefined,
  category: string,
  search: string,
): Promise<LineResult> {
  /*
   * Refused rather than answered emptily. An empty list reads as «we have never
   * asked a supplier for anything», which is a sentence somebody would act on;
   * the module gates on `suppliers` and so does this.
   */
  // The same gate the module itself uses (`KEY_PERMISSION`), asked here
  // because this reads its rows without going through its list endpoint.
  if (!hasPermission(user, "suppliers")) {
    return { error: "برای دیدن استعلام‌های خرید دسترسی «تأمین‌کنندگان» لازم است." };
  }

  const rows = await getDb().supplierInquiryItem.findMany({
    where: {
      ...(range ? { inquiry: { createdAt: range } } : {}),
      ...(category ? { product: { category } } : {}),
      ...(search
        ? { OR: [{ name: contains(search) }, { product: { displayName: contains(search) } }] }
        : {}),
    },
    select: {
      inquiryId: true, productId: true, variantId: true, name: true, quantity: true,
      inquiry: { select: { supplierId: true } },
      product: { select: { displayName: true, category: true, code: true } },
      variant: { select: { sku: true } },
    },
    orderBy: { inquiry: { createdAt: "desc" } },
    take: DEMAND_SCAN_LIMIT + 1,
  });

  return {
    truncated: rows.length > DEMAND_SCAN_LIMIT,
    rows: rows.slice(0, DEMAND_SCAN_LIMIT).map((row) => ({
      documentId: row.inquiryId,
      partyId: row.inquiry?.supplierId ?? null,
      productId: row.productId,
      variantId: row.variantId,
      name: row.name,
      productName: row.product?.displayName ?? row.name,
      productCode: row.product?.code ?? null,
      variantSku: row.variant?.sku ?? null,
      category: row.product?.category ?? null,
      quantity: Number(row.quantity),
      valueRial: 0,
      status: null,
    })),
  };
}
