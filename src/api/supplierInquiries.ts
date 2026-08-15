import { ListResponse, api } from "./client";
import type { InquiryStep, SupplierInquiry, SupplierInquiryItem } from "../types";

/**
 * Supplier inquiry endpoints.
 *
 * Two things this module does not send, because the server owns them:
 *
 *  - **The event timeline.** Most steps are derived from what the user did — a
 *    price arriving, an offer confirmed, a winner declared — and the server
 *    appends them keyed so the same save cannot record the same event twice.
 *    There is no `steps` field on the write body; a step the user types has its
 *    own endpoint.
 *  - **Which inquiry is the winner.** Declaring one demotes the project's
 *    previous winner in the same transaction.
 */

export interface InquiryItemRow {
  id: string;
  /** The catalogue item and SKU being priced, when the line names one. */
  productId: string | null;
  variantId: string | null;
  name: string;
  brand: string | null;
  partNumber: string | null;
  tagNumber: string | null;
  quantity: string;
  currency: string;
  priceForeign: string;
  priceRial: string;
  deliveryTime: string | null;
  notes: string | null;
}

export interface InquiryStepRow {
  id: string;
  title: string;
  occurredAtJalali: string | null;
  method: string | null;
  recipientName: string | null;
  notes: string | null;
  isAuto: boolean;
}

export interface InquiryRow {
  id: string;
  projectId: string;
  supplierId: string;
  isWinner: boolean;
  winnerDateJalali: string | null;
  offerConfirmed: boolean;
  offerConfirmedDateJalali: string | null;
  creationDateJalali: string | null;
  technicalOfferUrl: string | null;
  financialOfferUrl: string | null;
  discountPercent: string | null;
  discountAmount: string | null;
  createdAt: string;
  supplier: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  /** Whole lines and whole timeline — the card renders both inline. */
  items: InquiryItemRow[];
  steps: InquiryStepRow[];
  _count: { items: number; steps: number };
}

export interface InquiryWriteInput {
  projectId?: string;
  supplierId?: string;
  isWinner?: boolean;
  offerConfirmed?: boolean;
  creationDate?: string | null;
  winnerDate?: string | null;
  offerConfirmedDate?: string | null;
  technicalOfferUrl?: string | null;
  financialOfferUrl?: string | null;
  discountPercent?: number;
  discountAmount?: number;
  items?: Record<string, unknown>[];
  /** How the inquiry was sent. Enriches the derived first step; create only. */
  initialStep?: {
    occurredAt?: string | null;
    method?: string | null;
    recipientName?: string | null;
    notes?: string | null;
  };
}

export interface InquiryStepInput {
  title: string;
  occurredAt?: string;
  method?: string | null;
  recipientName?: string | null;
  notes?: string | null;
}

export const supplierInquiriesApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<InquiryRow>>("/api/supplier-inquiries", query, signal),

  get: (id: string) =>
    api.get<{ inquiry: InquiryRow }>(`/api/supplier-inquiries/${id}`).then((r) => r.inquiry),

  create: (input: InquiryWriteInput) =>
    api.post<{ inquiry: InquiryRow }>("/api/supplier-inquiries", input).then((r) => r.inquiry),

  update: (id: string, input: InquiryWriteInput) =>
    api.put<{ inquiry: InquiryRow }>(`/api/supplier-inquiries/${id}`, input).then((r) => r.inquiry),

  /**
   * `removeActivities` also deletes the automatic project-timeline entries this
   * record produced, and any category group they leave empty. Omitted, the
   * entries stay and one more records the deletion.
   */
  remove: (id: string, removeActivities = false) =>
    api.delete<Record<string, never>>(
      `/api/supplier-inquiries/${id}`,
      removeActivities ? { removeActivities: "true" } : undefined,
    ),

  addStep: (id: string, step: InquiryStepInput) =>
    api.post<{ step: InquiryStepRow }>(`/api/supplier-inquiries/${id}/steps`, step)
      .then((r) => r.step),

  /**
   * Corrects a recorded step. For a derived one only `occurredAt` is applied —
   * its wording comes from the offer and would be re-derived anyway.
   */
  updateStep: (id: string, stepId: string, step: Partial<InquiryStepInput>) =>
    api.put<Record<string, never>>(`/api/supplier-inquiries/${id}/steps/${stepId}`, step),

  /** Rejected with 409 `AUTO_STEP` for a derived step. */
  removeStep: (id: string, stepId: string) =>
    api.delete<Record<string, never>>(`/api/supplier-inquiries/${id}/steps/${stepId}`),
};

/* ------------------------------- adapter ------------------------------- */

const money = (value: string | null | undefined): number => Number(value ?? 0);

function rowToItem(item: InquiryItemRow): SupplierInquiryItem {
  return {
    id: item.id,
    productId: item.productId ?? undefined,
    variantId: item.variantId ?? undefined,
    name: item.name,
    brand: item.brand ?? undefined,
    partNumber: item.partNumber ?? undefined,
    tagNumber: item.tagNumber ?? undefined,
    quantity: Number(item.quantity),
    currency: item.currency as SupplierInquiryItem["currency"],
    priceForeign: money(item.priceForeign),
    // The column is priceRial; the client type has always spelled it priceRiyal.
    priceRiyal: money(item.priceRial),
    deliveryTime: item.deliveryTime ?? undefined,
    notes: item.notes ?? undefined,
  };
}

function rowToStep(step: InquiryStepRow): InquiryStep {
  return {
    id: step.id,
    title: step.title,
    date: step.occurredAtJalali ?? "",
    method: step.method ?? undefined,
    recipientName: step.recipientName ?? undefined,
    notes: step.notes ?? undefined,
    auto: step.isAuto,
  };
}

/** A row, in the shape the existing card markup expects. */
export function rowToInquiry(row: InquiryRow): SupplierInquiry {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? undefined,
    supplierId: row.supplierId,
    // The card reads this directly; on the server it is a join, not a column.
    supplierName: row.supplier?.name ?? "",
    items: (row.items ?? []).map(rowToItem),
    steps: (row.steps ?? []).map(rowToStep),
    technicalOfferUrl: row.technicalOfferUrl ?? undefined,
    financialOfferUrl: row.financialOfferUrl ?? undefined,
    discountPercent: Number(row.discountPercent ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
    isWinner: row.isWinner,
    winnerDate: row.winnerDateJalali ?? undefined,
    offerConfirmed: row.offerConfirmed,
    offerConfirmedDate: row.offerConfirmedDateJalali ?? undefined,
    creationDate: row.creationDateJalali ?? "",
  };
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * `steps` is deliberately absent — see the note at the top of this file.
 */
export function inquiryToWriteInput(inquiry: Partial<SupplierInquiry>): InquiryWriteInput {
  return {
    projectId: inquiry.projectId,
    supplierId: inquiry.supplierId,
    isWinner: inquiry.isWinner,
    offerConfirmed: inquiry.offerConfirmed,
    creationDate: inquiry.creationDate || null,
    winnerDate: inquiry.winnerDate ?? null,
    offerConfirmedDate: inquiry.offerConfirmedDate ?? null,
    technicalOfferUrl: inquiry.technicalOfferUrl ?? null,
    financialOfferUrl: inquiry.financialOfferUrl ?? null,
    discountPercent: Number(inquiry.discountPercent) || 0,
    discountAmount: Number(inquiry.discountAmount) || 0,
    items: (inquiry.items ?? []).map((item) => ({
      // Sent back, so an offer stays tied to the thing that was quoted; blank
      // means the line names no catalogue item, which is normal.
      productId: item.productId || null,
      variantId: item.variantId || null,
      name: item.name,
      brand: item.brand || null,
      partNumber: item.partNumber || null,
      tagNumber: item.tagNumber || null,
      quantity: item.quantity,
      currency: item.currency,
      priceForeign: item.priceForeign,
      priceRial: item.priceRiyal,
      deliveryTime: item.deliveryTime || null,
      notes: item.notes || null,
    })),
  };
}
