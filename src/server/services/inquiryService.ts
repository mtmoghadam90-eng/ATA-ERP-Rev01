import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields } from "../dates";
import { syncChildren, toNullableString, toNumber } from "../childSync";
import { loadSettings } from "../settings";
import { INQUIRY_STEP_KEYS, InquiryStepKey, resolveStepTitle } from "../../utils/inquirySteps";

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
  technicalOfferUrl: true, financialOfferUrl: true, createdAt: true,
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  items: {
    orderBy: { lineNo: "asc" },
    select: {
      id: true, name: true, brand: true, partNumber: true, tagNumber: true,
      quantity: true, currency: true, priceForeign: true, priceRial: true,
      deliveryTime: true, notes: true,
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

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getInquiry(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().supplierInquiry.findUnique({
    where: { id },
    include: {
      supplier: true,
      project: { select: { id: true, code: true, name: true } },
      items: { orderBy: { lineNo: "asc" } },
      steps: { orderBy: { stepNo: "asc" } },
    },
  });
}

/* --------------------------------- writes --------------------------------- */

export interface InquiryItemInput {
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
  projectId?: string;
  supplierId?: string;
  isWinner?: boolean;
  offerConfirmed?: boolean;
  creationDate?: string | null;
  winnerDate?: string | null;
  offerConfirmedDate?: string | null;
  technicalOfferUrl?: string | null;
  financialOfferUrl?: string | null;
  items?: InquiryItemInput[];
  initialStep?: InquiryInitialStepInput;
}

function mapItem(row: InquiryItemInput): Record<string, unknown> | null {
  const name = toNullableString(row?.name, 400);
  if (!name) return null;
  return {
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

  if ("projectId" in input) set("projectId", input.projectId);
  if ("supplierId" in input) set("supplierId", input.supplierId);
  if ("isWinner" in input) set("isWinner", !!input.isWinner);
  if ("offerConfirmed" in input) set("offerConfirmed", !!input.offerConfirmed);
  if ("technicalOfferUrl" in input) set("technicalOfferUrl", toNullableString(input.technicalOfferUrl, 500));
  if ("financialOfferUrl" in input) set("financialOfferUrl", toNullableString(input.financialOfferUrl, 500));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, INQUIRY_DATE_FIELDS) };
}

/**
 * A project has at most one winning inquiry.
 *
 * The client used to enforce this by walking every inquiry it held and clearing
 * the others, which only worked while the browser had them all. Paged, it would
 * silently leave a winner on a page nobody had loaded — two winners for one
 * project, and the proforma built from "the winner" then depends on which one is
 * read first. Declaring a winner and demoting the previous one is one decision,
 * so it happens in one transaction, here.
 */
async function enforceSingleWinner(
  tx: Prisma.TransactionClient,
  inquiryId: string,
  projectId: string,
): Promise<void> {
  await tx.supplierInquiry.updateMany({
    where: { projectId, isWinner: true, id: { not: inquiryId } },
    data: { isWinner: false, winnerDate: null, winnerDateJalali: null },
  });
}

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

export async function createInquiry(input: InquiryInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const inquiry = await tx.supplierInquiry.create({
      data: scalarData(input) as Prisma.SupplierInquiryUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.supplierInquiryItem, parentWhere: { inquiryId: inquiry.id },
      rows: input.items ?? [], map: mapItem,
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

    if (inquiry.isWinner) await enforceSingleWinner(tx, inquiry.id, inquiry.projectId);

    return tx.supplierInquiry.findUnique({
      where: { id: inquiry.id },
      include: { items: { orderBy: { lineNo: "asc" } }, steps: { orderBy: { stepNo: "asc" } } },
    });
  });
}

export async function updateInquiry(
  id: string,
  input: InquiryInput,
  user: AuthUser,
  todayJalali: string,
) {
  if (!allowed(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const before = await tx.supplierInquiry.findUnique({
      where: { id },
      select: {
        offerConfirmed: true, isWinner: true, projectId: true,
        items: { select: { quantity: true, currency: true, priceForeign: true, priceRial: true } },
      },
    });
    if (!before) return null;

    const updated = await tx.supplierInquiry.update({
      where: { id },
      data: scalarData(input) as Prisma.SupplierInquiryUncheckedUpdateInput,
    });

    if (updated.isWinner) await enforceSingleWinner(tx, id, updated.projectId);

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.supplierInquiryItem, parentWhere: { inquiryId: id },
        rows: input.items, map: mapItem,
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

export async function deleteInquiry(
  id: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const existing = await db.supplierInquiry.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return "not-found";

  // Items and steps cascade; an inquiry is not referenced by anything else.
  await db.supplierInquiry.delete({ where: { id } });
  return "ok";
}
