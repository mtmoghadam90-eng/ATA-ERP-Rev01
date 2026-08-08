import { ListResponse, api } from "./client";
import { assertComplete, markComplete, markPartial } from "./partial";
import type { Transaction } from "../types";

/**
 * Transaction endpoints.
 *
 * Money that has been recorded is never edited into a different shape or
 * deleted — a confirmed entry is corrected by a reversing entry that points back
 * at it, and both stay visible. That is why `remove` only works on a draft, and
 * why there is a `reverse` here at all.
 */

export interface TransactionRow {
  id: string;
  documentNumber: string;
  type: string;
  receiptType: string | null;
  status: string;
  occurredAt: string | null;
  occurredAtJalali: string | null;
  customerId: string | null;
  supplierId: string | null;
  projectId: string | null;
  proformaId: string | null;
  purchaseOrderId: string | null;
  partyName: string | null;
  amountRial: string;
  amountForeign: string | null;
  exchangeRate: string | null;
  isDirectForeign: boolean;
  paymentType: string;
  referenceNumber: string | null;
  /** Set on a reversal, naming the entry it corrects. */
  reversalOfTransactionId: string | null;
  createdAt: string;
  customer: { id: string; companyName: string } | null;
  supplier: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
}

export interface TransactionDetail extends TransactionRow {
  notes: string | null;
  customValues: string | null;
  proforma: { id: string; proformaNumber: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
}

export interface TransactionSummary {
  receivedRial: string;
  paidRial: string;
  /** Received minus paid. Positive means more came in than went out. */
  balanceRial: string;
  receiptCount: number;
  paymentCount: number;
}

export interface TransactionWriteInput {
  documentNumber?: string;
  type?: string;
  receiptType?: string | null;
  status?: string;
  occurredAt?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  projectId?: string | null;
  proformaId?: string | null;
  purchaseOrderId?: string | null;
  partyName?: string | null;
  amountRial?: unknown;
  amountForeign?: unknown;
  exchangeRate?: unknown;
  isDirectForeign?: boolean;
  paymentType?: string;
  referenceNumber?: string | null;
  notes?: string | null;
  customValues?: unknown;
}

export const transactionsApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<TransactionRow>>("/api/transactions", query, signal),

  get: (id: string) =>
    api.get<{ transaction: TransactionDetail }>(`/api/transactions/${id}`).then((r) => r.transaction),

  /**
   * Totals for the same filters as the list, over confirmed and reversed
   * entries — both halves of a correction count, so the pair cancels.
   */
  summary: (query: Record<string, string | number | undefined>) =>
    api.get<{ summary: TransactionSummary }>("/api/transactions/summary", query)
      .then((r) => r.summary),

  create: (input: TransactionWriteInput) =>
    api.post<{ transaction: TransactionDetail }>("/api/transactions", input)
      .then((r) => r.transaction),

  /** Throws with code FROZEN for a reversed entry or a reversal. */
  update: (id: string, input: TransactionWriteInput) =>
    api.put<{ transaction: TransactionDetail }>(`/api/transactions/${id}`, input)
      .then((r) => r.transaction),

  /** Corrects a confirmed entry with an opposite one, keeping both visible. */
  reverse: (id: string, documentNumber: string) =>
    api.post<{ reversal: TransactionDetail }>(`/api/transactions/${id}/reverse`, { documentNumber })
      .then((r) => r.reversal),

  /** Only a draft. A confirmed entry throws with code MUST_REVERSE. */
  remove: (id: string) => api.delete<Record<string, never>>(`/api/transactions/${id}`),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number } = {},
  ): Promise<TransactionRow[]> => {
    const { limit = 20_000 } = options;
    const rows: TransactionRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<TransactionRow>>("/api/transactions", {
        ...query, page, pageSize: 200,
      });
      rows.push(...batch.rows);
      if (rows.length >= Math.min(batch.total, limit)) break;
      if (batch.rows.length === 0 || page >= batch.totalPages) break;
      page++;
    }
    return rows.slice(0, limit);
  },
};

/* ------------------------------- adapter ------------------------------- */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const money = (value: string | null | undefined): number => Number(value ?? 0);

/** A row, in the shape the existing markup expects. */
export function rowToTransaction(row: TransactionRow): Transaction {
  return markPartial({
    id: row.id,
    documentNumber: row.documentNumber,
    type: row.type as Transaction["type"],
    receiptType: (row.receiptType ?? undefined) as Transaction["receiptType"],
    status: row.status as Transaction["status"],
    date: row.occurredAtJalali ?? "",
    customerId: row.customerId ?? undefined,
    supplierId: row.supplierId ?? undefined,
    projectId: row.projectId ?? undefined,
    proformaId: row.proformaId ?? undefined,
    purchaseOrderId: row.purchaseOrderId ?? undefined,
    // Joined by the server, so the grid does not resolve names itself.
    partyName: row.partyName
      ?? row.customer?.companyName
      ?? row.supplier?.name
      ?? "",
    projectName: row.project?.name ?? undefined,
    amountRIYAL: money(row.amountRial),
    amountForeign: row.amountForeign ? money(row.amountForeign) : undefined,
    exchangeRate: row.exchangeRate ? money(row.exchangeRate) : undefined,
    isDirectForeign: row.isDirectForeign,
    paymentType: row.paymentType as Transaction["paymentType"],
    referenceNumber: row.referenceNumber ?? undefined,
    reversalOfTransactionId: row.reversalOfTransactionId ?? undefined,
    notes: "",
  } as unknown as Transaction);
}

export function detailToTransaction(detail: TransactionDetail): Transaction {
  return markComplete({
    ...rowToTransaction(detail),
    notes: detail.notes ?? "",
    customValues: parseJson<Record<string, unknown>>(detail.customValues, {}),
    proformaNumber: detail.proforma?.proformaNumber,
    poNumber: detail.purchaseOrder?.poNumber,
  } as unknown as Transaction);
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * The rial amount is sent, but the server derives it from the foreign amount and
 * the document's rate whenever both are present — so an entry cannot claim a
 * rial figure inconsistent with its own currency.
 */
export function transactionToWriteInput(tx: Partial<Transaction>): TransactionWriteInput {
  assertComplete(tx, "تراکنش");
  const t = tx as unknown as Record<string, unknown>;
  return {
    documentNumber: tx.documentNumber,
    type: tx.type,
    receiptType: (t.receiptType as string) ?? null,
    status: tx.status,
    occurredAt: (t.date as string) ?? null,
    customerId: tx.customerId ?? null,
    supplierId: tx.supplierId ?? null,
    projectId: tx.projectId ?? null,
    proformaId: tx.proformaId ?? null,
    purchaseOrderId: (t.purchaseOrderId as string) ?? null,
    partyName: (t.partyName as string) ?? null,
    amountRial: t.amountRIYAL,
    amountForeign: t.amountForeign,
    exchangeRate: t.exchangeRate,
    isDirectForeign: t.isDirectForeign as boolean,
    paymentType: tx.paymentType,
    referenceNumber: (t.referenceNumber as string) ?? null,
    notes: tx.notes ?? null,
    customValues: t.customValues,
  };
}
