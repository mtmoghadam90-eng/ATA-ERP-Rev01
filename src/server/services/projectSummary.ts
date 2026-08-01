import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { dateToJalali } from "../dates";
import { getProformaOutcome, getWonItems } from "../proformaStatus";
import { addDaysToShamsi, addWorkingDaysToShamsi, getTodayShamsi } from "../../dateUtils";

/**
 * Per-project figures the projects grid shows: pipeline value, prepayment date,
 * and the agreed-versus-actual delivery picture.
 *
 * None of it is stored — it is derived from a project's proformas, its receipts
 * and its packing lists. The client used to derive it by holding all four
 * collections in memory and scanning them once per visible row, which is both
 * the memory problem this migration exists to fix and an O(rows x records) loop.
 *
 * Here it is computed for a whole page at once: three queries scoped to the
 * project ids on that page, then the arithmetic. Not one query per row.
 */

export interface DeliveryLine {
  id: string;
  productName: string;
  /** What the proforma promised, e.g. "۴ هفته کاری پس از پیش‌پرداخت". */
  deliveryText: string;
  /** That promise resolved against the project's base date. */
  calculatedDate: string | null;
}

export interface ActualDeliveryLine {
  id: string;
  productName: string;
  actualDate: string;
  boxNumber: string | null;
}

/**
 * A won line, with how it is to be supplied.
 *
 * The supply panel needs this per project; it is assembled from the proformas
 * this function has already loaded, so it costs nothing extra.
 */
export interface WonItem {
  id: string;
  productName: string;
  productCode: string;
  brand: string;
  quantity: string;
  supplyMethod: string;
  proformaId: string;
  proformaNumber: string;
  proformaStatus: string;
}

export interface ProjectSummary {
  /** Won lines across the project's proformas, for the supply panel. */
  wonItems: WonItem[];
  /** Latest proforma's final amount, and the currency it was quoted in. */
  pipelineValue: string;
  pipelineCurrency: string;
  /** First receipt against the project — the clock most delivery terms run from. */
  prepaymentDate: string | null;
  /** Delivery date on the won proforma, when there is one. */
  approvedDeliveryDate: string | null;
  /** Actual delivery date from the packing list. */
  actualDeliveryDate: string | null;
  agreedItems: DeliveryLine[];
  actualItems: ActualDeliveryLine[];
  /** Set when every actual line shares one date, which is the common case. */
  singleActualDate: string | null;
  counts: { proformas: number; deliveries: number; receipts: number };
}

const EMPTY: ProjectSummary = {
  wonItems: [],
  pipelineValue: "0",
  pipelineCurrency: "",
  prepaymentDate: null,
  approvedDeliveryDate: null,
  actualDeliveryDate: null,
  agreedItems: [],
  actualItems: [],
  singleActualDate: null,
  counts: { proformas: 0, deliveries: 0, receipts: 0 },
};

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Days implied by a delivery term like "۳ تا ۴ هفته".
 *
 * Takes the *last* number, because a range is quoted best-to-worst and the
 * commitment is the worst case.
 */
function termToDays(range: string | null, unit: string | null): number {
  if (!range) return 0;
  const ascii = range
    .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)));
  const numbers = ascii.match(/\d+/g);
  if (!numbers || numbers.length === 0) return 0;

  const value = parseInt(numbers[numbers.length - 1], 10);
  if (unit === "هفته") return value * 7;
  if (unit === "ماه") return value * 30;
  return value;
}

interface SupplyProduct { id: string; code: string; supplyType: string; stockLevel: unknown }
interface SupplyLine { productId: string | null; productCode: string | null; supplyMethod: string | null }

/**
 * How a won line will actually be supplied.
 *
 * Three sources disagree in practice, so they are consulted in order of how
 * specific they are: what the proforma line says, then what the project's own
 * requested-items grid says, then the product's default. A product with nothing
 * in stock has to be ordered whatever its default says, which is the case the
 * fallback exists for.
 */
function resolveSupplyMethod(
  line: SupplyLine,
  projectItems: { productId: string | null; supplyMethod: string | null }[] | undefined,
  productsById: Map<string, SupplyProduct>,
): string {
  const fromProject = projectItems?.find((i) => i.productId && i.productId === line.productId);
  const product = line.productId ? productsById.get(line.productId) : undefined;

  // An explicit non-default choice on the line wins outright.
  if (line.supplyMethod && line.supplyMethod !== "INVENTORY") return line.supplyMethod;
  if (fromProject?.supplyMethod && fromProject.supplyMethod !== "INVENTORY") return fromProject.supplyMethod;

  if (product) {
    const outOfStock = Number(product.stockLevel) === 0;
    if (outOfStock || product.supplyType === "ORDER") return "ORDER";
  }

  return line.supplyMethod || fromProject?.supplyMethod || product?.supplyType || "INVENTORY";
}

/** The proforma whose figures represent the project: latest by issue date. */
function latestProforma<T extends { issueDate: Date | null; createdAt: Date }>(rows: T[]): T | undefined {
  if (rows.length === 0) return undefined;
  return [...rows].sort((a, b) => {
    const byIssue = (b.issueDate?.getTime() ?? 0) - (a.issueDate?.getTime() ?? 0);
    if (byIssue !== 0) return byIssue;
    // Two proformas issued the same day: the one entered later is the current one.
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

/**
 * Summaries for a set of projects, in three queries regardless of how many.
 *
 * `projects` carries the base dates, which the delivery arithmetic needs and
 * which the caller has already loaded.
 */
export async function summarizeProjects(
  projects: {
    id: string;
    creationDateJalali: string | null;
    winningDateJalali: string | null;
    opportunityDateJalali: string | null;
    agreedDeliveryDateJalali: string | null;
  }[],
): Promise<Map<string, ProjectSummary>> {
  const result = new Map<string, ProjectSummary>();
  if (projects.length === 0) return result;

  const ids = projects.map((p) => p.id);
  const db = getDb();

  const [proformas, receipts, deliveries] = await Promise.all([
    db.proforma.findMany({
      where: { projectId: { in: ids } },
      select: {
        id: true, projectId: true, proformaNumber: true, status: true,
        isCancelled: true, currency: true,
        finalAmount: true, issueDate: true, createdAt: true,
        deliveryDateJalali: true,
        items: {
          select: {
            id: true, productId: true, productName: true, productCode: true, brand: true, quantity: true,
            status: true, supplyMethod: true,
            deliveryRange: true, deliveryUnit: true, deliveryType: true, deliveryPostfix: true,
          },
        },
      },
    }),
    // Only receipts: a payment out is not a prepayment in.
    db.transaction.findMany({
      where: { projectId: { in: ids }, type: "دریافت" },
      select: { projectId: true, occurredAt: true, occurredAtJalali: true },
      orderBy: { occurredAt: "asc" },
    }),
    db.packagingDelivery.findMany({
      where: { projectId: { in: ids } },
      select: {
        projectId: true, actualDeliveryDateJalali: true,
        items: {
          select: { id: true, itemOrDocName: true, actualDeliveryDateJalali: true, boxNumber: true },
        },
      },
    }),
  ]);

  const byProject = <T extends { projectId: string | null }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.projectId) continue;
      const list = map.get(row.projectId) ?? [];
      list.push(row);
      map.set(row.projectId, list);
    }
    return map;
  };

  const proformasBy = byProject(proformas);
  const receiptsBy = byProject(receipts);
  const deliveriesBy = byProject(deliveries);

  // The supply fallback consults the project's own requested items and the
  // product's stock. Both are fetched once for the page, not per line.
  const db2 = getDb();
  const projectItems = await db2.projectItem.findMany({
    where: { projectId: { in: ids } },
    select: { projectId: true, productId: true, supplyMethod: true },
  });
  const projectItemsBy = byProject(projectItems);

  const productIds = [...new Set(
    proformas.flatMap((pf) => pf.items.map((i) => i.productId)).filter((id): id is string => !!id),
  )];
  const productsById = new Map<string, SupplyProduct>();
  if (productIds.length > 0) {
    const rows = await db2.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, supplyType: true, stockLevel: true },
    });
    for (const row of rows) productsById.set(row.id, row);
  }

  for (const project of projects) {
    const pfs = proformasBy.get(project.id) ?? [];
    const rcs = receiptsBy.get(project.id) ?? [];
    const dls = deliveriesBy.get(project.id) ?? [];

    const latest = latestProforma(pfs);
    // Already ordered by date, so the first is the earliest.
    const prepaymentDate = rcs[0]?.occurredAtJalali ?? dateToJalali(rcs[0]?.occurredAt ?? null);

    const won = pfs.filter((pf) => {
      const outcome = getProformaOutcome(pf);
      return outcome === "تأیید شده (برنده)" || outcome === "نیمه برنده";
    });

    // Delivery terms are quoted relative to a starting point: the prepayment if
    // there is one, else the best date the project itself offers.
    const baseDate =
      prepaymentDate
      || project.winningDateJalali
      || project.opportunityDateJalali
      || project.creationDateJalali
      || getTodayShamsi();

    const agreedItems: DeliveryLine[] = [];
    for (const pf of won) {
      for (const item of getWonItems(pf, true)) {
        if (item.deliveryRange && item.deliveryUnit) {
          const days = termToDays(item.deliveryRange, item.deliveryUnit);
          const type = item.deliveryType || "کاری";
          const postfix = item.deliveryPostfix ? ` ${item.deliveryPostfix}` : "";
          agreedItems.push({
            id: item.id,
            productName: item.productName,
            deliveryText: `${item.deliveryRange} ${item.deliveryUnit} ${type}${postfix}`,
            // Working days skip weekends and holidays, which is what "کاری" means.
            calculatedDate: type === "کاری"
              ? addWorkingDaysToShamsi(baseDate, days)
              : addDaysToShamsi(baseDate, days),
          });
        } else {
          // No per-line term: the proforma's own date, else the project's.
          const fallback = pf.deliveryDateJalali || project.agreedDeliveryDateJalali || "";
          agreedItems.push({
            id: item.id,
            productName: item.productName,
            deliveryText: fallback || "فوری",
            calculatedDate: project.agreedDeliveryDateJalali || baseDate,
          });
        }
      }
    }

    const actualItems: ActualDeliveryLine[] = [];
    for (const delivery of dls) {
      for (const item of delivery.items) {
        // A line without its own date inherits the packing list's.
        const date = item.actualDeliveryDateJalali || delivery.actualDeliveryDateJalali || "";
        if (!date) continue;
        actualItems.push({
          id: item.id,
          productName: item.itemOrDocName,
          actualDate: date,
          boxNumber: item.boxNumber,
        });
      }
    }

    const distinctActual = new Set(actualItems.map((i) => i.actualDate));
    const approved = won[0];

    // The same won lines the schedule is built from, with how each is supplied.
    const wonItems: WonItem[] = [];
    for (const pf of won) {
      for (const item of getWonItems(pf, true)) {
        wonItems.push({
          id: item.id,
          productName: item.productName,
          productCode: item.productCode ?? "",
          brand: item.brand ?? "",
          quantity: item.quantity.toString(),
          supplyMethod: resolveSupplyMethod(item, projectItemsBy.get(project.id), productsById),
          proformaId: pf.id,
          proformaNumber: pf.proformaNumber,
          proformaStatus: getProformaOutcome(pf),
        });
      }
    }

    result.set(project.id, {
      wonItems,
      pipelineValue: latest?.finalAmount?.toString() ?? "0",
      pipelineCurrency: latest?.currency ?? "",
      prepaymentDate: prepaymentDate ?? null,
      approvedDeliveryDate: approved?.deliveryDateJalali ?? null,
      actualDeliveryDate: dls.find((d) => d.actualDeliveryDateJalali)?.actualDeliveryDateJalali ?? null,
      agreedItems,
      actualItems,
      singleActualDate: distinctActual.size === 1 ? [...distinctActual][0] : null,
      counts: { proformas: pfs.length, deliveries: dls.length, receipts: rcs.length },
    });
  }

  return result;
}

/** One project's summary, for the detail view. */
export async function summarizeProject(projectId: string): Promise<ProjectSummary> {
  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, creationDateJalali: true, winningDateJalali: true,
      opportunityDateJalali: true, agreedDeliveryDateJalali: true,
    },
  });
  if (!project) return EMPTY;

  const summaries = await summarizeProjects([project]);
  return summaries.get(projectId) ?? EMPTY;
}

export type { Prisma };
