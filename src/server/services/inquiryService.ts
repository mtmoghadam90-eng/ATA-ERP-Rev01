import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { normalizeAttachments, offerFileColumns } from "../../utils/attachments";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause, searchVariants } from "../listing";
import { AuthUser, canSeeCosts, hasPermission } from "../auth";
import { redactInquiries, redactInquiry } from "../costs";
import { expandDateFields } from "../dates";
import { syncChildren, toNullableString, toNumber } from "../childSync";
import { scrubProductRefs } from "../refIntegrity";
import { loadSettings } from "../settings";
import {
  INQUIRY_STEP_KEYS, InquiryStepKey, resolveStepTitle,
  describeInquiryStatus, inquiryTotalRiyal,
} from "../../utils/inquirySteps";
import { notifyModuleResponsible } from "./notificationService";
import { logAction } from "./auditService";
import { processWorkflowRules } from "./workflowService";
import { inquiryWorkflowStatus } from "../../utils/moduleStatuses";
import { ACTIVITY_CATEGORY, logProjectFact, settleRecordHistory } from "./projectActivityLog";
import {
  HistorySummary, discountKeepFraction, netUnitPrice, summarizeHistory,
} from "../../utils/inquiryPriceHistory";

/**
 * Supplier inquiry data access.
 *
 * Two child collections with opposite rules, which is the whole shape of this
 * module:
 *
 *  - **items** are a line-item grid, rebuilt with the parent (`syncChildren`).
 *  - **steps** are an append-only history of what happened to the inquiry, so
 *    they must never be rebuilt. Most are derived from the user's actions rather
 *    than typed, and `autoKey` makes that derivation idempotent — a step is only
 *    added if one with the same key is not already recorded.
 */

export const INQUIRY_SORTABLE = ["creationDate", "createdAt", "updatedAt"] as const;
export const INQUIRY_FILTERABLE = ["projectId", "supplierId"] as const;

export const INQUIRY_DATE_FIELDS = ["creationDate", "winnerDate", "offerConfirmedDate"] as const;

function allowed(user: AuthUser): boolean {
  return hasPermission(user, "suppliers");
}

export function buildInquiryWhere(
  q: ListQuery,
  extra: { isWinner?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  // Inquiries carry no text of their own worth searching. What the user has in
  // mind is either the supplier they asked or the part they asked about, so the
  // term reaches the joined supplier and into the lines.
  if (q.search) {
    const alternatives: Record<string, unknown>[] = [];

    const itemSearch = searchClause(q.search, ["name", "brand", "partNumber", "tagNumber"]);
    if (itemSearch) alternatives.push({ items: { some: itemSearch } });

    const supplierSearch = searchClause(q.search, ["name"]);
    if (supplierSearch) alternatives.push({ supplier: supplierSearch });

    if (alternatives.length > 0) and.push({ OR: alternatives });
  }

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  if (extra.isWinner === "true") and.push({ isWinner: true });
  else if (extra.isWinner === "false") and.push({ isWinner: false });

  return and.length === 0 ? {} : { AND: and };
}

/**
 * The list projection.
 *
 * Wider than a grid row would need, because this module has no grid: a row is
 * rendered as a card that shows every line and the whole event timeline. Sending
 * only totals and counts would leave the cards to fetch each inquiry separately,
 * which is the request-per-row problem the pagination exists to avoid.
 */
const LIST_SELECT = {
  id: true, projectId: true, supplierId: true,
  isWinner: true, winnerDateJalali: true,
  offerConfirmed: true, offerConfirmedDateJalali: true,
  creationDate: true, creationDateJalali: true,
  technicalOfferUrl: true, financialOfferUrl: true,
  technicalOfferFiles: true, financialOfferFiles: true,
  discountPercent: true, discountAmount: true, createdAt: true,
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  items: {
    orderBy: { lineNo: "asc" },
    select: {
      id: true, name: true, brand: true, partNumber: true, tagNumber: true,
      quantity: true, currency: true, priceForeign: true, priceRial: true,
      deliveryTime: true, notes: true,
      // The card offers to build a purchase order from a winning offer, and
      // that order's lines need the product the offer was actually for.
      productId: true, variantId: true,
    },
  },
  steps: {
    orderBy: { stepNo: "asc" },
    select: {
      id: true, title: true, occurredAtJalali: true,
      method: true, recipientName: true, notes: true, isAuto: true,
    },
  },
  _count: { select: { items: true, steps: true } },
} satisfies Prisma.SupplierInquirySelect;

export async function listInquiries(
  q: ListQuery,
  user: AuthUser,
  extra: { isWinner?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildInquiryWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.supplierInquiry.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.supplierInquiry.count({ where }),
  ]);

  return buildResult(
    redactInquiries(rows as unknown as Record<string, unknown>[], user),
    total,
    q,
  );
}

export async function getInquiry(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  const inquiry = await getDb().supplierInquiry.findUnique({
    where: { id },
    include: {
      supplier: true,
      project: { select: { id: true, code: true, name: true } },
      items: { orderBy: { lineNo: "asc" } },
      steps: { orderBy: { stepNo: "asc" } },
    },
  });
  return redactInquiry(inquiry, user);
}

/* --------------------------------- writes --------------------------------- */

export interface InquiryItemInput {
  /** The catalogue item being priced, and its SKU, when the line names one. */
  productId?: string | null;
  variantId?: string | null;
  name?: string;
  brand?: string | null;
  partNumber?: string | null;
  tagNumber?: string | null;
  quantity?: unknown;
  currency?: string;
  priceForeign?: unknown;
  priceRial?: unknown;
  deliveryTime?: string | null;
  notes?: string | null;
}

/**
 * How the inquiry was sent, for the step the creation records anyway.
 *
 * Sending it is not a separate event the user chooses to log — it is what
 * creating the inquiry means — so this enriches the derived first step rather
 * than adding a second one beside it. Create only.
 */
export interface InquiryInitialStepInput {
  occurredAt?: string | null;
  method?: string | null;
  recipientName?: string | null;
  notes?: string | null;
}

export interface InquiryInput {
  projectId?: string | null;
  supplierId?: string;
  isWinner?: boolean;
  offerConfirmed?: boolean;
  creationDate?: string | null;
  winnerDate?: string | null;
  offerConfirmedDate?: string | null;
  /**
   * The offer's files.
   *
   * The list is what a person edits; `technicalOfferUrl`/`financialOfferUrl`
   * are derived from it, so a caller sending only the list still leaves the
   * single-URL columns — read by the grid, the download button and the Power
   * BI export — pointing at the first file. A caller sending only a URL, which
   * is every integration written before this, is still understood.
   */
  technicalOfferUrl?: string | null;
  financialOfferUrl?: string | null;
  technicalOfferFiles?: unknown;
  financialOfferFiles?: unknown;
  discountPercent?: unknown;
  discountAmount?: unknown;
  items?: InquiryItemInput[];
  initialStep?: InquiryInitialStepInput;
}

function mapItem(row: InquiryItemInput): Record<string, unknown> | null {
  const name = toNullableString(row?.name, 400);
  if (!name) return null;
  return {
    // Optional by design: an inquiry is often the first time a part is
    // mentioned, priced before anyone decides to carry it. A blank string from
    // an empty picker must land as NULL, not as a foreign key to nothing.
    productId: toNullableString(row.productId, 36),
    variantId: toNullableString(row.variantId, 36),
    name,
    brand: toNullableString(row.brand, 150),
    partNumber: toNullableString(row.partNumber, 150),
    tagNumber: toNullableString(row.tagNumber, 100),
    quantity: toNumber(row.quantity, 1),
    currency: toNullableString(row.currency, 20) ?? "دلار",
    priceForeign: toNumber(row.priceForeign, 0),
    priceRial: toNumber(row.priceRial, 0),
    deliveryTime: toNullableString(row.deliveryTime, 100),
    notes: toNullableString(row.notes),
  };
}

function scalarData(input: InquiryInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("projectId" in input) set("projectId", toNullableString(input.projectId, 36));
  if ("supplierId" in input) set("supplierId", input.supplierId);
  if ("isWinner" in input) set("isWinner", !!input.isWinner);
  if ("offerConfirmed" in input) set("offerConfirmed", !!input.offerConfirmed);
  // The list wins when it is sent, because it is what the form edits; the
  // single-URL column is written from its first entry either way, so the two
  // can never disagree.
  if ("technicalOfferFiles" in input) {
    const columns = offerFileColumns(normalizeAttachments(input.technicalOfferFiles));
    set("technicalOfferFiles", columns.files);
    set("technicalOfferUrl", columns.url);
  } else if ("technicalOfferUrl" in input) {
    const columns = offerFileColumns(normalizeAttachments([{ url: input.technicalOfferUrl }]));
    set("technicalOfferFiles", columns.files);
    set("technicalOfferUrl", columns.url);
  }
  // Clamped: a percentage outside 0-100 would inflate the offer or make it
  // negative, and the figure is never taken from the client for money.
  if ("discountPercent" in input) {
    const pct = Number(input.discountPercent) || 0;
    set("discountPercent", Math.min(Math.max(pct, 0), 100));
  }
  // A negative amount would add to the offer rather than take off it.
  if ("discountAmount" in input) {
    set("discountAmount", Math.max(Number(input.discountAmount) || 0, 0));
  }
  if ("financialOfferFiles" in input) {
    const columns = offerFileColumns(normalizeAttachments(input.financialOfferFiles));
    set("financialOfferFiles", columns.files);
    set("financialOfferUrl", columns.url);
  } else if ("financialOfferUrl" in input) {
    const columns = offerFileColumns(normalizeAttachments([{ url: input.financialOfferUrl }]));
    set("financialOfferFiles", columns.files);
    set("financialOfferUrl", columns.url);
  }

  return { ...out, ...expandDateFields(input as Record<string, unknown>, INQUIRY_DATE_FIELDS) };
}

/*
 * A project may have several winning inquiries.
 *
 * It used to have at most one: declaring a winner demoted the project's
 * previous one in the same transaction. That is wrong for how these projects
 * are actually supplied — the flow meters from one supplier and the valves from
 * another are two winning offers for one project, and marking the second
 * silently cancelled the first. Each inquiry now stands on its own, and every
 * reader of "the winning offer" was already written against a list of them:
 * the purchase-order form offers them all to choose from.
 */

/* ------------------------------- auto steps ------------------------------- */

interface PricedItem { quantity: unknown; currency: string; priceForeign: unknown; priceRial: unknown }

/** True once at least one line carries a real price — i.e. an offer arrived. */
function hasOfferPrices(items: PricedItem[]): boolean {
  return items.some((i) => Number(i.priceForeign) > 0 || Number(i.priceRial) > 0);
}

/** Totals per currency, for the step text. */
function describeAmount(items: PricedItem[]): string {
  const byCurrency = new Map<string, number>();
  let rial = 0;
  for (const i of items) {
    const qty = Number(i.quantity) || 1;
    if (Number(i.priceForeign) > 0) {
      const cur = i.currency || "دلار";
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(i.priceForeign) * qty);
    }
    if (Number(i.priceRial) > 0) rial += Number(i.priceRial) * qty;
  }
  const parts = [...byCurrency.entries()].map(([cur, amount]) => `${amount.toLocaleString("en-US")} ${cur}`);
  if (rial > 0) parts.push(`${rial.toLocaleString("en-US")} ریال`);
  return parts.length > 0 ? parts.join(" + ") : "بدون مبلغ";
}

/** True when any line's price or quantity differs between the two versions. */
function pricingChanged(before: PricedItem[], after: PricedItem[]): boolean {
  if (before.length !== after.length) return true;
  const key = (i: PricedItem) =>
    `${Number(i.quantity) || 0}|${i.currency}|${Number(i.priceForeign) || 0}|${Number(i.priceRial) || 0}`;
  const beforeKeys = before.map(key).sort();
  const afterKeys = after.map(key).sort();
  return beforeKeys.some((k, idx) => k !== afterKeys[idx]);
}

/**
 * Appends the steps the user's actions imply.
 *
 * Every step carries an `autoKey`, and a keyed step is written only once — so
 * saving the same inquiry repeatedly does not accumulate duplicate history. The
 * revision step is the exception: each price change is a genuinely new event, so
 * it is keyed uniquely and can repeat.
 *
 * Titles resolve against `settings.dropdownItems.supplierInquirySteps` by
 * keyword rather than by a fixed string, because that list is user-editable.
 */
async function appendAutoSteps(
  tx: Prisma.TransactionClient,
  inquiryId: string,
  before: { offerConfirmed: boolean; isWinner: boolean; items: PricedItem[] } | null,
  todayJalali: string,
): Promise<number> {
  const settings = await loadSettings();

  const current = await tx.supplierInquiry.findUnique({
    where: { id: inquiryId },
    select: {
      offerConfirmed: true, offerConfirmedDateJalali: true,
      isWinner: true, winnerDateJalali: true,
      items: { select: { quantity: true, currency: true, priceForeign: true, priceRial: true } },
      steps: { select: { autoKey: true, stepNo: true } },
    },
  });
  if (!current) return 0;

  const items = current.items as unknown as PricedItem[];
  const beforeItems = before?.items ?? [];
  const logged = new Set(current.steps.map((s) => s.autoKey).filter(Boolean) as string[]);
  let nextStepNo = current.steps.reduce((max, s) => Math.max(max, s.stepNo), 0);

  const additions: { key: string; title: InquiryStepKey; when: string; notes: string }[] = [];

  const nowHasOffer = hasOfferPrices(items);
  const hadOffer = hasOfferPrices(beforeItems);

  if (nowHasOffer && !logged.has(INQUIRY_STEP_KEYS.INITIAL_OFFER)) {
    additions.push({
      key: INQUIRY_STEP_KEYS.INITIAL_OFFER,
      title: INQUIRY_STEP_KEYS.INITIAL_OFFER,
      when: todayJalali,
      notes: `ثبت خودکار: آفر اولیه با مبلغ ${describeAmount(items)} برای ${items.length} قلم کالا ثبت شد.`,
    });
  } else if (nowHasOffer && hadOffer && pricingChanged(beforeItems, items)) {
    // A revision is a real event each time, so it is not deduplicated.
    additions.push({
      key: `${INQUIRY_STEP_KEYS.REVISED}-${Date.now().toString(36)}`,
      title: INQUIRY_STEP_KEYS.REVISED,
      when: todayJalali,
      notes: `ثبت خودکار: آفر بازنگری شد. مبلغ جدید: ${describeAmount(items)}.`,
    });
  }

  if (current.offerConfirmed && !before?.offerConfirmed && !logged.has(INQUIRY_STEP_KEYS.FINAL_OFFER)) {
    additions.push({
      key: INQUIRY_STEP_KEYS.FINAL_OFFER,
      title: INQUIRY_STEP_KEYS.FINAL_OFFER,
      when: current.offerConfirmedDateJalali || todayJalali,
      notes: `ثبت خودکار: صحت آفر تأیید شد و به عنوان آفر نهایی با مبلغ ${describeAmount(items)} ثبت گردید.`,
    });
  }

  if (current.isWinner && !before?.isWinner && !logged.has(INQUIRY_STEP_KEYS.WINNER)) {
    additions.push({
      key: INQUIRY_STEP_KEYS.WINNER,
      title: INQUIRY_STEP_KEYS.WINNER,
      when: current.winnerDateJalali || todayJalali,
      notes: `ثبت خودکار: این استعلام با مبلغ ${describeAmount(items)} به عنوان پیشنهاد برنده انتخاب شد.`,
    });
  }

  for (const step of additions) {
    nextStepNo++;
    await tx.supplierInquiryStep.create({
      data: {
        inquiryId,
        stepNo: nextStepNo,
        title: resolveStepTitle(settings, step.title),
        ...expandDateFields({ occurredAt: step.when }, ["occurredAt"]),
        notes: step.notes,
        isAuto: true,
        autoKey: step.key,
      } as Prisma.SupplierInquiryStepUncheckedCreateInput,
    });
  }

  return additions.length;
}

/** The supplier's name, for the timeline entries that quote it. */
async function inquirySupplierName(supplierId: string | null | undefined): Promise<string> {
  if (!supplierId) return "نامشخص";
  const supplier = await getDb().supplier.findUnique({
    where: { id: supplierId },
    select: { name: true },
  });
  return supplier?.name || "نامشخص";
}

export async function createInquiry(input: InquiryInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  const inquiry = await db.$transaction(async (tx) => {
    const inquiry = await tx.supplierInquiry.create({
      data: scalarData(input) as Prisma.SupplierInquiryUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.supplierInquiryItem, parentWhere: { inquiryId: inquiry.id },
      rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapItem,
    });

    // Sending the inquiry is the first thing that happened to it. The form can
    // say how it was sent and to whom; the event itself is not optional.
    const settings = await loadSettings();
    const first = input.initialStep ?? {};
    await tx.supplierInquiryStep.create({
      data: {
        inquiryId: inquiry.id,
        stepNo: 1,
        title: resolveStepTitle(settings, INQUIRY_STEP_KEYS.SENT),
        ...expandDateFields(
          { occurredAt: first.occurredAt || input.creationDate || todayJalali },
          ["occurredAt"],
        ),
        method: toNullableString(first.method, 50),
        recipientName: toNullableString(first.recipientName, 200),
        notes: toNullableString(first.notes) ?? "ثبت خودکار: استعلام قیمت ایجاد شد.",
        isAuto: true,
        autoKey: INQUIRY_STEP_KEYS.SENT,
      } as Prisma.SupplierInquiryStepUncheckedCreateInput,
    });

    await appendAutoSteps(tx, inquiry.id, null, todayJalali);

    return tx.supplierInquiry.findUnique({
      where: { id: inquiry.id },
      include: { items: { orderBy: { lineNo: "asc" } }, steps: { orderBy: { stepNo: "asc" } } },
    });
  });

  if (inquiry) {
    // Notification
    await notifyModuleResponsible(
      "inquiries",
      "ثبت استعلام جدید",
      inquiry.projectId ? `استعلام جدید ثبت شد برای پروژه` : `استعلام جدید ثبت شد (خرید انبار، بدون پروژه)`,
      user,
      inquiry.projectId,
    );

    // Audit log
    await logAction(
      {
        action: "CREATE",
        module: "استعلام از تامین‌کنندگان",
        entityId: inquiry.id,
        description: inquiry.projectId
          ? `ایجاد استعلام جدید برای پروژه: ${inquiry.projectId}`
          : `ایجاد استعلام جدید (خرید انبار، بدون پروژه)`,
        afterState: inquiry,
      },
      user,
      todayJalali,
    );

    // Workflow rules
    await processWorkflowRules(
      "supplier_inquiry_created",
      {
        inquiryId: inquiry.id,
        projectId: inquiry.projectId,
        supplierId: inquiry.supplierId,
        // The editor offers `price` as a condition field: the quoted total in
        // rial, which is what "price greater than X" is asking about.
        price: inquiryTotalRiyal(
          (inquiry.items || []).map((i) => ({
            priceRiyal: Number(i.priceRial ?? 0),
            quantity: Number(i.quantity ?? 0),
          })) as never,
          Number(inquiry.discountPercent ?? 0),
          Number(inquiry.discountAmount ?? 0),
        ),
      },
      user,
    );

    const summary = describeInquiry(inquiry);
    await logProjectFact(
      {
        projectId: inquiry.projectId,
        categoryName: ACTIVITY_CATEGORY.INQUIRIES,
        sourceType: "SUPPLIER_INQUIRY",
        sourceId: inquiry.id,
        text:
          `استعلام قیمت از تأمین‌کننده «${await inquirySupplierName(inquiry.supplierId)}»` +
          ` برای ${(inquiry.items || []).length} قلم از اقلام پروژه توسط {actor} ثبت شد` +
          (inquiry.creationDateJalali ? ` (تاریخ استعلام: ${inquiry.creationDateJalali})` : "") +
          `. مرحله فعلی: ${summary.status}.`,
      },
      user,
      todayJalali,
    );
  }

  return inquiry;
}

export async function updateInquiry(
  id: string,
  input: InquiryInput,
  user: AuthUser,
  todayJalali: string,
) {
  if (!allowed(user)) return null;
  const db = getDb();

  // Get before state for audit log
  const beforeAudit = await db.supplierInquiry.findUnique({ where: { id } });

  const inquiry = await db.$transaction(async (tx) => {
    const before = await tx.supplierInquiry.findUnique({
      where: { id },
      select: {
        offerConfirmed: true, isWinner: true, projectId: true,
        items: { select: { quantity: true, currency: true, priceForeign: true, priceRial: true } },
      },
    });
    if (!before) return null;

    await tx.supplierInquiry.update({
      where: { id },
      data: scalarData(input) as Prisma.SupplierInquiryUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.supplierInquiryItem, parentWhere: { inquiryId: id },
        rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapItem,
      });
    }

    await appendAutoSteps(tx, id, {
      offerConfirmed: before.offerConfirmed,
      isWinner: before.isWinner,
      items: before.items as unknown as PricedItem[],
    }, todayJalali);

    return tx.supplierInquiry.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: "asc" } }, steps: { orderBy: { stepNo: "asc" } } },
    });
  });

  // Audit log
  if (inquiry && beforeAudit) {
    await logAction(
      {
        action: "UPDATE",
        module: "استعلام از تامین‌کنندگان",
        entityId: id,
        description: inquiry.projectId
          ? `ویرایش استعلام برای پروژه: ${inquiry.projectId}`
          : `ویرایش استعلام (خرید انبار، بدون پروژه)`,
        beforeState: beforeAudit,
        afterState: inquiry,
      },
      user,
      todayJalali,
    );

    /*
     * An inquiry has no status column either — its state is where the offer has
     * got to. Four values, and the rule editor used to offer seven invented
     * ones; `inquiryWorkflowStatus` is the single rule both sides read.
     */
    const oldStatus = inquiryWorkflowStatus(beforeAudit as never);
    const newStatus = inquiryWorkflowStatus(inquiry as never);

    if (oldStatus !== newStatus) {
      await processWorkflowRules(
        "supplier_inquiry_status_change",
        {
          inquiryId: inquiry.id,
          projectId: inquiry.projectId,
          supplierId: inquiry.supplierId,
          oldStatus,
          newStatus,
          status: newStatus,
        },
        user,
      );
    }

    const summary = describeInquiry(inquiry);
    await logProjectFact(
      {
        projectId: inquiry.projectId,
        categoryName: ACTIVITY_CATEGORY.INQUIRIES,
        sourceType: "SUPPLIER_INQUIRY",
        sourceId: inquiry.id,
        text:
          `استعلام قیمت تأمین‌کننده «${await inquirySupplierName(inquiry.supplierId)}» بروزرسانی شد` +
          ` — مرحله فعلی: ${summary.status}.` +
          (inquiry.isWinner
            ? ` این آفر به عنوان یکی از پیشنهادهای برنده پروژه انتخاب شده است` +
              (inquiry.winnerDateJalali ? ` (تاریخ انتخاب: ${inquiry.winnerDateJalali})` : "") + "."
            : ""),
      },
      user,
      todayJalali,
    );
  }

  return inquiry;
}

/**
 * The amount and stage summaries reuse the client's own helpers so the timeline
 * reads identically to the inquiry screen. Both coerce with `Number()`, which
 * is what makes them safe to hand Prisma's `Decimal` columns.
 */
function describeInquiry(inquiry: unknown) {
  const inq = inquiry as {
    items?: unknown[]; discountPercent?: unknown; discountAmount?: unknown;
  };
  // The offer total used to be part of this. It is gone on purpose: these
  // sentences go on the project timeline, which is read by anyone with the
  // project — including people the cost permission withholds prices from.
  return { status: describeInquiryStatus(inq as never) };
}

/** Records a step the user typed, alongside the derived ones. */
export async function addInquiryStep(
  inquiryId: string,
  step: { title: string; occurredAt?: string; method?: string | null; recipientName?: string | null; notes?: string | null },
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | { step: unknown }> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  return db.$transaction(async (tx) => {
    const inquiry = await tx.supplierInquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true, steps: { select: { stepNo: true } } },
    });
    if (!inquiry) return "not-found";

    const nextStepNo = inquiry.steps.reduce((max, s) => Math.max(max, s.stepNo), 0) + 1;
    const created = await tx.supplierInquiryStep.create({
      data: {
        inquiryId,
        stepNo: nextStepNo,
        title: toNullableString(step.title, 300),
        ...expandDateFields({ occurredAt: step.occurredAt || todayJalali }, ["occurredAt"]),
        method: toNullableString(step.method, 50),
        recipientName: toNullableString(step.recipientName, 200),
        notes: toNullableString(step.notes),
        isAuto: false,
      } as Prisma.SupplierInquiryStepUncheckedCreateInput,
    });
    return { step: created };
  });
}

/**
 * Corrects a step that has already been recorded.
 *
 * A derived step is dated when the system noticed the change, which is not
 * always when the thing happened — an offer received on Sunday and entered on
 * Tuesday reads as Tuesday. So its date is editable. Nothing else about it is:
 * its title and notes are derived from the offer, and `appendAutoSteps` would
 * simply describe it again the same way. A step somebody typed is theirs to
 * change entirely.
 */
export async function updateInquiryStep(
  inquiryId: string,
  stepId: string,
  input: { occurredAt?: string | null; title?: string; method?: string | null; recipientName?: string | null; notes?: string | null },
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const step = await db.supplierInquiryStep.findFirst({
    where: { id: stepId, inquiryId },
    select: { id: true, isAuto: true },
  });
  if (!step) return "not-found";

  const data: Record<string, unknown> = {};
  if (input.occurredAt) {
    Object.assign(data, expandDateFields({ occurredAt: input.occurredAt }, ["occurredAt"]));
  }
  if (!step.isAuto) {
    if ("title" in input) data.title = toNullableString(input.title, 300);
    if ("method" in input) data.method = toNullableString(input.method, 50);
    if ("recipientName" in input) data.recipientName = toNullableString(input.recipientName, 200);
    if ("notes" in input) data.notes = toNullableString(input.notes);
  }
  if (Object.keys(data).length === 0) return "ok";

  await db.supplierInquiryStep.update({ where: { id: stepId }, data });
  return "ok";
}

/**
 * Removes a step. Only a manually recorded one — a derived step describes
 * something that actually happened to the inquiry, and deleting it would just
 * mean it reappears on the next save.
 */
export async function deleteInquiryStep(
  inquiryId: string,
  stepId: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found" | "auto"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const step = await db.supplierInquiryStep.findFirst({
    where: { id: stepId, inquiryId },
    select: { id: true, isAuto: true },
  });
  if (!step) return "not-found";
  if (step.isAuto) return "auto";

  await db.supplierInquiryStep.delete({ where: { id: stepId } });
  return "ok";
}

/**
 * `removeActivities` takes the automatic timeline entries about this record
 * with it — matched on the link each entry stores, never on its wording — and
 * drops a category group that is left empty. The default keeps them, and the
 * entry recording the deletion joins them, so the project's history stays
 * whole.
 */
export async function deleteInquiry(
  id: string,
  user: AuthUser,
  todayJalali: string,
  removeActivities = false,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const existing = await db.supplierInquiry.findUnique({ where: { id } });
  if (!existing) return "not-found";

  // Items and steps cascade; an inquiry is not referenced by anything else.
  await db.supplierInquiry.delete({ where: { id } });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "استعلام از تامین‌کنندگان",
      entityId: id,
      description: existing.projectId
        ? `حذف استعلام برای پروژه: ${existing.projectId}`
        : `حذف استعلام (خرید انبار، بدون پروژه)`,
      beforeState: existing,
    },
    user,
    todayJalali,
  );

  await settleRecordHistory(
    removeActivities,
    existing.projectId,
    id,
    {
      projectId: existing.projectId,
      categoryName: ACTIVITY_CATEGORY.INQUIRIES,
      text:
        `استعلام قیمت تأمین‌کننده «${await inquirySupplierName(existing.supplierId)}»` +
        ` توسط {actor} حذف شد و دیگر در مقایسه پیشنهادهای پروژه لحاظ نمی‌شود.`,
    },
    user,
    todayJalali,
  );

  return "ok";
}

/* ----------------------------- price history ----------------------------- */

/**
 * Every price this company has been quoted, searchable by the item.
 *
 * The question a buyer has is never "show me inquiry 4718"; it is "what did the
 * last 6-inch turbine flow meter cost me, and from whom". That is a query over
 * inquiry *lines*, not over inquiries, which is why it does not reuse
 * `listInquiries`: paging inquiries and then picking the matching lines out of
 * each page would page the wrong set — a supplier whose one matching line sits
 * on inquiry 200 falls off page 1 and the answer silently changes with the page
 * size.
 *
 * Nothing is stored for this. `supplier_inquiry_items` has carried `productId`
 * and `variantId` since the module was written, so the whole history is already
 * on disk; what was missing was a way to ask.
 *
 * Three rules it has to get right:
 *
 *  - **A line with no price is not a price.** An inquiry sent and never answered
 *    has lines at zero, and listing them as "prices obtained" is the same class
 *    of error as an uncosted proforma line reading as pure margin.
 *  - **The discount belongs to the offer, not to the line**, so a line's stored
 *    price is a pre-discount figure and quoting it overstates every discounted
 *    offer. `discountKeepFraction` apportions it, which is why the inquiry's
 *    *whole* item set comes down with each row.
 *  - **The range spans every match, not the page.** A "cheapest price ever" that
 *    changes when you turn the page is worse than none, so the summary is
 *    computed over a bounded scan of the whole matched set and says when it hit
 *    the bound.
 */

/*
 * Date only, and deliberately.
 *
 * Sorting by price is the obvious second option and it cannot be done here: the
 * price the screen shows is the line's figure *after* the offer's discount, and
 * that is not a column — `priceRial` is the pre-discount figure. Offering it
 * would sort by a number the table does not display, cheapest-first putting a
 * heavily discounted offer below an undiscounted one. Same shape as filtering
 * proformas by a derived outcome; unlike that one, there is no `where` that
 * expresses it, so it is not offered.
 */
export const PRICE_HISTORY_SORTABLE = ["creationDate"] as const;
export const PRICE_HISTORY_FILTERABLE = ["productId", "variantId", "supplierId", "projectId"] as const;

/**
 * How much of the matched history the summary is measured over.
 *
 * The same shape as the satisfaction-letters screen: the whole-set work happens
 * on the server, bounded, and says so rather than quietly dropping rows.
 */
const SUMMARY_SCAN_LIMIT = 1000;

function priceHistorySearchClause(term: string): Prisma.SupplierInquiryItemWhereInput | undefined {
  const variants = searchVariants(term);
  if (variants.length === 0) return undefined;

  const OR: Prisma.SupplierInquiryItemWhereInput[] = [];
  for (const v of variants) {
    // The line's own words: what the buyer typed when asking for the price.
    OR.push({ name: { contains: v } });
    OR.push({ brand: { contains: v } });
    OR.push({ partNumber: { contains: v } });
    OR.push({ tagNumber: { contains: v } });
    // The catalogue item and the SKU, which is the whole point of the screen —
    // a line often names a part in prose while the SKU is what identifies it.
    OR.push({ variant: { is: { sku: { contains: v } } } });
    OR.push({ product: { is: { name: { contains: v } } } });
    OR.push({ product: { is: { displayName: { contains: v } } } });
    OR.push({ product: { is: { code: { contains: v } } } });
    // And who quoted it, so "the last price from that Turkish supplier" works.
    OR.push({ inquiry: { is: { supplier: { is: { name: { contains: v } } } } } });
  }
  return { OR };
}

export interface PriceHistoryExtra {
  /** "winner" | "confirmed" — narrows to offers that were accepted. */
  outcome?: unknown;
}

export function buildPriceHistoryWhere(
  q: ListQuery,
  extra: PriceHistoryExtra = {},
): Prisma.SupplierInquiryItemWhereInput {
  const and: Prisma.SupplierInquiryItemWhereInput[] = [];

  // An unanswered inquiry's lines sit at zero. They are not prices.
  and.push({ OR: [{ priceForeign: { gt: 0 } }, { priceRial: { gt: 0 } }] });

  const search = priceHistorySearchClause(q.search);
  if (search) and.push(search);

  // Two of the four allowlisted filters are columns of the line and two belong
  // to its parent, so they are translated here rather than spread blindly.
  if (q.filters.productId) and.push({ productId: q.filters.productId });
  if (q.filters.variantId) and.push({ variantId: q.filters.variantId });
  if (q.filters.supplierId) and.push({ inquiry: { is: { supplierId: q.filters.supplierId } } });
  if (q.filters.projectId) and.push({ inquiry: { is: { projectId: q.filters.projectId } } });

  if (extra.outcome === "winner") and.push({ inquiry: { is: { isWinner: true } } });
  else if (extra.outcome === "confirmed") and.push({ inquiry: { is: { offerConfirmed: true } } });

  return { AND: and };
}

/**
 * The offer's own lines ride along with each row.
 *
 * They are what the discount is apportioned against — the fraction is a
 * property of the whole offer — and there is no cheaper way to get it: the
 * figure cannot be computed in SQL because the percentage and the fixed amount
 * apply in order. Offers here carry a handful of lines, and the page is capped
 * at `MAX_PAGE_SIZE`.
 */
const PRICE_HISTORY_SELECT = {
  id: true, name: true, brand: true, partNumber: true, tagNumber: true,
  quantity: true, currency: true, priceForeign: true, priceRial: true,
  deliveryTime: true, notes: true, productId: true, variantId: true,
  product: { select: { id: true, code: true, displayName: true, unit: true } },
  variant: { select: { id: true, sku: true } },
  inquiry: {
    select: {
      id: true, creationDate: true, creationDateJalali: true,
      isWinner: true, offerConfirmed: true,
      discountPercent: true, discountAmount: true,
      supplier: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      items: { select: { quantity: true, currency: true, priceForeign: true, priceRial: true } },
    },
  },
} satisfies Prisma.SupplierInquiryItemSelect;

type PriceHistoryRecord = Prisma.SupplierInquiryItemGetPayload<{ select: typeof PRICE_HISTORY_SELECT }>;

/** One row of the answer: a line, its net unit price, and who quoted it when. */
export interface PriceHistoryRow {
  id: string;
  inquiryId: string;
  name: string;
  brand: string | null;
  partNumber: string | null;
  tagNumber: string | null;
  quantity: number;
  currency: string;
  /** After the offer's discount — see `netUnitPrice`. */
  unitForeign: number;
  unitRial: number;
  /** Before it, so the screen can show what the discount took off. */
  grossUnitForeign: number;
  grossUnitRial: number;
  discounted: boolean;
  deliveryTime: string | null;
  notes: string | null;
  dateJalali: string | null;
  isWinner: boolean;
  offerConfirmed: boolean;
  supplier: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  product: { id: string; code: string; displayName: string; unit: string | null } | null;
  variant: { id: string; sku: string } | null;
}

function toHistoryRow(row: PriceHistoryRecord): PriceHistoryRow {
  const inquiry = row.inquiry;
  const keep = discountKeepFraction(
    (inquiry.items ?? []).map((line) => ({
      quantity: Number(line.quantity),
      currency: line.currency,
      priceForeign: Number(line.priceForeign),
      priceRial: Number(line.priceRial),
    })),
    Number(inquiry.discountPercent ?? 0),
    Number(inquiry.discountAmount ?? 0),
  );

  const net = netUnitPrice(
    {
      quantity: Number(row.quantity),
      currency: row.currency,
      priceForeign: Number(row.priceForeign),
      priceRial: Number(row.priceRial),
    },
    keep,
  );

  return {
    id: row.id,
    inquiryId: inquiry.id,
    name: row.name,
    brand: row.brand,
    partNumber: row.partNumber,
    tagNumber: row.tagNumber,
    quantity: Number(row.quantity),
    currency: row.currency,
    unitForeign: net.unitForeign,
    unitRial: net.unitRial,
    grossUnitForeign: Number(row.priceForeign),
    grossUnitRial: Number(row.priceRial),
    discounted: net.discounted,
    deliveryTime: row.deliveryTime,
    notes: row.notes,
    dateJalali: inquiry.creationDateJalali,
    isWinner: inquiry.isWinner,
    offerConfirmed: inquiry.offerConfirmed,
    supplier: inquiry.supplier,
    project: inquiry.project,
    product: row.product,
    variant: row.variant,
  };
}

export interface PriceHistoryResult extends ListResult<PriceHistoryRow> {
  summary: HistorySummary & { truncated: boolean };
}

export async function listPriceHistory(
  q: ListQuery,
  user: AuthUser,
  extra: PriceHistoryExtra = {},
): Promise<PriceHistoryResult | "forbidden" | "cost-blind"> {
  if (!allowed(user)) return "forbidden";
  /*
   * Refused rather than redacted, unlike every other read in this module.
   *
   * The usual rule is that a cost-blind user is served the record with the
   * amounts blanked — right for an inquiry, which is a document about a part, a
   * supplier and a date that happens to carry a price. This screen *is* the
   * price: blanking it leaves a table of empty money columns and no way to tell
   * that from "no prices recorded". Saying so is the honest answer.
   */
  if (!canSeeCosts(user)) return "cost-blind";

  const db = getDb();
  const where = buildPriceHistoryWhere(q, extra);

  // What the question asks for: the most recent price first. Ordered by the
  // offer's own date, not by when the row happened to be typed.
  const orderBy: Prisma.SupplierInquiryItemOrderByWithRelationInput =
    { inquiry: { creationDate: q.order } };

  /*
   * The range is only computed once the question has been narrowed to something.
   *
   * "The cheapest unit price across every part this company has ever been
   * quoted" is not an answer to anything — it mixes flow meters with bolts, and
   * the figure it produces is a bolt. It also costs a thousand-row scan on the
   * first render of the tab, before the user has typed. So an unfiltered
   * history is a list and nothing more; the summary appears with the search.
   */
  const narrowed = !!q.search || !!q.filters.productId || !!q.filters.variantId;

  const [rows, total, scan] = await Promise.all([
    db.supplierInquiryItem.findMany({ where, orderBy, select: PRICE_HISTORY_SELECT, ...paginationArgs(q) }),
    db.supplierInquiryItem.count({ where }),
    // The range across every match, not the page. Compact — it needs the price
    // and the supplier, plus the offer's lines to apportion the discount.
    narrowed ? db.supplierInquiryItem.findMany({
      where,
      orderBy,
      take: SUMMARY_SCAN_LIMIT,
      select: {
        quantity: true, currency: true, priceForeign: true, priceRial: true,
        inquiry: {
          select: {
            supplierId: true, discountPercent: true, discountAmount: true,
            items: { select: { quantity: true, currency: true, priceForeign: true, priceRial: true } },
          },
        },
      },
    }) : [],
  ]);

  const summary = summarizeHistory(
    scan.map((row) => {
      const keep = discountKeepFraction(
        (row.inquiry.items ?? []).map((line) => ({
          quantity: Number(line.quantity),
          currency: line.currency,
          priceForeign: Number(line.priceForeign),
          priceRial: Number(line.priceRial),
        })),
        Number(row.inquiry.discountPercent ?? 0),
        Number(row.inquiry.discountAmount ?? 0),
      );
      return {
        unitRial: netUnitPrice(
          {
            quantity: Number(row.quantity),
            currency: row.currency,
            priceForeign: Number(row.priceForeign),
            priceRial: Number(row.priceRial),
          },
          keep,
        ).unitRial,
        supplierId: row.inquiry.supplierId,
      };
    }),
  );

  return {
    ...buildResult(rows.map(toHistoryRow), total, q),
    summary: { ...summary, truncated: narrowed && total > SUMMARY_SCAN_LIMIT },
  };
}
