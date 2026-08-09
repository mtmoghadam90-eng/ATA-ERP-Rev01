import type { Proforma, ProformaItem } from "../types";
import type { ProformaDetail, ProformaRow, ProformaWriteInput } from "./proformas";
import { assertComplete, markComplete, markPartial } from "./partial";

/**
 * Translation between the proformas API and the `Proforma` shape the view was
 * written against — the same temporary seam as the customer and project
 * adapters.
 *
 * The differences: names are joined rather than denormalized onto the row, money
 * is decimal strings rather than JS numbers, lines are a child table, and the
 * status the grid shows is the *derived* outcome rather than the stored
 * workflow status.
 */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Money arrives as a decimal string, because a SQL DECIMAL does not fit a JS
 * number without losing precision at the top of the range. The view does
 * arithmetic on numbers, so it is converted here — the authoritative figure
 * stays on the server, which is what recomputes every total on write.
 */
const money = (value: string | null | undefined): number => Number(value ?? 0);

export function rowToProforma(row: ProformaRow): Proforma {
  return markPartial({
    id: row.id,
    proformaNumber: row.proformaNumber,
    proformaType: row.proformaType as Proforma["proformaType"],
    customerId: row.customerId,
    customerName: row.customer?.companyName ?? "",
    projectId: row.projectId ?? undefined,
    projectName: row.project?.name ?? undefined,
    issueDate: row.issueDateJalali ?? "",
    expiryDate: row.expiryDateJalali ?? "",
    /*
     * Both statuses, under their own names.
     *
     * These were one field, holding the derived outcome — and the two mean
     * different things. The edit form's "وضعیت سند" select offers the stored
     * workflow status (پیش‌نویس / ارسال شده), so once a line had been decided it
     * was handed an outcome like "نیمه برنده", which is not one of its options:
     * the select fell back to its first entry and showed a sent proforma as a
     * draft. Saving then wrote that back over the real status. The two locks
     * that ask whether a proforma has been sent were reading the outcome too.
     */
    status: row.status as Proforma["status"],
    outcomeStatus: row.outcomeStatus as Proforma["status"],
    isCancelled: row.isCancelled,
    currency: row.currency as Proforma["currency"],
    totalAmount: money(row.totalAmount),
    finalAmount: money(row.finalAmount),
    creatorId: row.creatorUserId ?? undefined,
    // A list row carries only what the grid prints beside the customer — each
    // line's name, quantity and status. Prices and specs arrive with the detail
    // record, which is the only place they are needed.
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: Number(item.quantity),
      status: (item.status ?? undefined) as ProformaItem["status"],
      supplyMethod: (item.supplyMethod ?? undefined) as ProformaItem["supplyMethod"],
    })) as ProformaItem[],
    discountPercent: 0,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    notes: "",
  } as Proforma);
}

export function detailToProforma(detail: ProformaDetail): Proforma {
  return markComplete({
    ...rowToProforma({ ...detail, items: [] } as unknown as ProformaRow),
    contactCustomerId: detail.contactCustomerId ?? undefined,
    contactName: detail.contact?.companyName ?? undefined,
    contactPrefix: detail.contactPrefix ?? undefined,
    deliveryDate: detail.deliveryDateJalali ?? undefined,
    lossReason: detail.lossReason ?? undefined,
    discountPercent: money(detail.discountPercent),
    discountAmount: money(detail.discountAmount),
    taxPercent: money(detail.taxPercent),
    taxAmount: money(detail.taxAmount),
    extraCosts: money(detail.extraCosts),
    historicalExchangeRate: detail.historicalExchangeRate
      ? money(detail.historicalExchangeRate) : undefined,
    notes: detail.notes ?? "",
    sentMethod: detail.sentMethod ?? undefined,
    sentRecipients: parseJson<string[]>(detail.sentRecipients, []),
    customValues: parseJson<Record<string, unknown>>(detail.customValues, {}),
    items: (detail.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId ?? "",
      variantId: item.variantId ?? undefined,
      productName: item.productName,
      productCode: item.productCode ?? "",
      brand: item.brand ?? "",
      tagNumber: item.tagNumber ?? undefined,
      quantity: Number(item.quantity),
      unitPriceRIYAL: money(item.unitPriceRial),
      totalPriceRIYAL: money(item.totalPriceRial),
      supplyMethod: (item.supplyMethod ?? undefined) as ProformaItem["supplyMethod"],
      status: (item.status ?? undefined) as ProformaItem["status"],
      lossReason: item.lossReason ?? undefined,
      techSpecs: item.techSpecs ?? undefined,
      deliveryRange: item.deliveryRange ?? undefined,
      deliveryUnit: (item.deliveryUnit ?? undefined) as ProformaItem["deliveryUnit"],
      deliveryType: (item.deliveryType ?? undefined) as ProformaItem["deliveryType"],
      deliveryPostfix: item.deliveryPostfix ?? undefined,
      selectedFeatures: parseJson<Record<string, string>>(item.selectedFeatures, {}),
      selectedImage: item.selectedImage ?? undefined,
    })),
  } as Proforma);
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * Totals are deliberately absent: the server recomputes them from the lines it
 * stores, so sending them would only invite the two to disagree. The percentages
 * and extra costs *are* sent, because they are inputs rather than results.
 */
export function proformaToWriteInput(proforma: Partial<Proforma>): ProformaWriteInput {
  assertComplete(proforma, "پیش‌فاکتور");
  return {
    proformaNumber: proforma.proformaNumber,
    proformaType: proforma.proformaType,
    customerId: proforma.customerId,
    contactCustomerId: proforma.contactCustomerId ?? null,
    contactPrefix: proforma.contactPrefix ?? null,
    projectId: proforma.projectId ?? null,
    status: proforma.status,
    isCancelled: proforma.isCancelled,
    lossReason: proforma.lossReason ?? null,
    currency: proforma.currency,
    issueDate: proforma.issueDate ?? null,
    expiryDate: proforma.expiryDate ?? null,
    deliveryDate: proforma.deliveryDate ?? null,
    discountPercent: proforma.discountPercent,
    discountAmount: proforma.discountAmount,
    taxPercent: proforma.taxPercent,
    taxAmount: proforma.taxAmount,
    extraCosts: proforma.extraCosts,
    historicalExchangeRate: proforma.historicalExchangeRate,
    notes: proforma.notes ?? null,
    sentMethod: proforma.sentMethod ?? null,
    sentRecipients: proforma.sentRecipients,
    customValues: proforma.customValues,
    items: (proforma.items ?? []).map((item) => ({
      productId: item.productId || null,
      variantId: item.variantId || null,
      productName: item.productName,
      productCode: item.productCode || null,
      brand: item.brand || null,
      tagNumber: item.tagNumber || null,
      quantity: item.quantity,
      unitPriceRial: item.unitPriceRIYAL,
      supplyMethod: item.supplyMethod ?? null,
      status: item.status ?? null,
      lossReason: item.lossReason ?? null,
      techSpecs: item.techSpecs ?? null,
      deliveryRange: item.deliveryRange ?? null,
      deliveryUnit: item.deliveryUnit ?? null,
      deliveryType: item.deliveryType ?? null,
      deliveryPostfix: item.deliveryPostfix ?? null,
      selectedFeatures: item.selectedFeatures,
      selectedImage: item.selectedImage ?? null,
    })),
  };
}
