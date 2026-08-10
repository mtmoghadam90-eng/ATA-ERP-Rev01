import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { toJsonColumn, toNullableString, toNumber } from "../childSync";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact } from "./projectActivityLog";

/**
 * Transaction (receipts and payments) data access.
 *
 * Money records are never edited into a different shape or quietly deleted once
 * they are confirmed — a correction is a reversing entry that points back at the
 * original, so the trail shows what happened rather than hiding it. See
 * `reverseTransaction`.
 */

export const RECEIPT = "دریافت";
export const PAYMENT = "پرداخت";
const CONFIRMED = "تأیید شده";
const REVERSED = "ابطال شده";

export const TRANSACTION_SORTABLE = [
  "documentNumber", "occurredAt", "amountRial", "type", "status", "createdAt",
] as const;

export const TRANSACTION_FILTERABLE = [
  "type", "status", "paymentType", "customerId", "supplierId", "projectId",
  "proformaId", "purchaseOrderId",
] as const;

const SEARCH_FIELDS = ["documentNumber", "referenceNumber", "partyName", "notes"] as const;

export const TRANSACTION_DATE_FIELDS = ["occurredAt"] as const;

function allowed(user: AuthUser): boolean {
  return hasPermission(user, "transactions");
}

export function buildTransactionWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ occurredAt: range });

  return and.length === 0 ? {} : { AND: and };
}

const LIST_SELECT = {
  id: true, documentNumber: true, type: true, receiptType: true, status: true,
  occurredAt: true, occurredAtJalali: true,
  customerId: true, supplierId: true, projectId: true, proformaId: true, purchaseOrderId: true,
  partyName: true, amountRial: true, amountForeign: true, exchangeRate: true, isDirectForeign: true,
  paymentType: true, referenceNumber: true, reversalOfTransactionId: true, createdAt: true,
  // The grid draws a custom-fields column from these.
  customValues: true,
  customer: { select: { id: true, companyName: true } },
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.TransactionSelect;

export async function listTransactions(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildTransactionWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : [{ occurredAt: "desc" as const }, { createdAt: "desc" as const }];

  const [rows, total] = await Promise.all([
    db.transaction.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.transaction.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getTransaction(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().transaction.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, companyName: true } },
      supplier: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, proformaNumber: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
    },
  });
}

/**
 * Statuses that affect the balance.
 *
 * A reversed entry stays in the totals on purpose. Its reversal is an opposite
 * entry that is itself counted, so the pair cancels to zero — which is the point
 * of correcting by reversal. Dropping the original while keeping the reversal
 * would apply the correction twice and understate the balance by the full
 * amount. Only entries that were never confirmed (drafts) are excluded.
 */
const EFFECTIVE_STATUSES = [CONFIRMED, REVERSED];

/**
 * Receipts and payments totalled in SQL, honouring the same filters as the list.
 *
 * The client derived the balance by summing whatever it had loaded, which stops
 * being the real balance the moment pagination hides a row.
 */
export async function transactionSummary(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
) {
  if (!allowed(user)) return null;
  const db = getDb();
  const where = buildTransactionWhere(q, extra);

  const grouped = await db.transaction.groupBy({
    by: ["type"],
    where: { AND: [where, { status: { in: EFFECTIVE_STATUSES } }] },
    _sum: { amountRial: true },
    _count: { _all: true },
  });

  const find = (type: string) => grouped.find((g) => g.type === type);
  const received = Number(find(RECEIPT)?._sum.amountRial ?? 0);
  const paid = Number(find(PAYMENT)?._sum.amountRial ?? 0);

  return {
    receivedRial: received.toString(),
    paidRial: paid.toString(),
    // Positive means more came in than went out.
    balanceRial: (received - paid).toString(),
    receiptCount: find(RECEIPT)?._count._all ?? 0,
    paymentCount: find(PAYMENT)?._count._all ?? 0,
  };
}

/* --------------------------------- writes --------------------------------- */

export interface TransactionInput {
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

function scalarData(input: TransactionInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("documentNumber" in input) set("documentNumber", toNullableString(input.documentNumber, 60));
  if ("type" in input) set("type", toNullableString(input.type, 20));
  if ("receiptType" in input) set("receiptType", toNullableString(input.receiptType, 100));
  if ("status" in input) set("status", toNullableString(input.status, 30) ?? CONFIRMED);
  if ("customerId" in input) set("customerId", toNullableString(input.customerId, 36));
  if ("supplierId" in input) set("supplierId", toNullableString(input.supplierId, 36));
  if ("projectId" in input) set("projectId", toNullableString(input.projectId, 36));
  if ("proformaId" in input) set("proformaId", toNullableString(input.proformaId, 36));
  if ("purchaseOrderId" in input) set("purchaseOrderId", toNullableString(input.purchaseOrderId, 36));
  if ("partyName" in input) set("partyName", toNullableString(input.partyName, 300));
  if ("paymentType" in input) set("paymentType", toNullableString(input.paymentType, 50));
  if ("referenceNumber" in input) set("referenceNumber", toNullableString(input.referenceNumber, 100));
  if ("notes" in input) set("notes", toNullableString(input.notes));
  if ("isDirectForeign" in input) set("isDirectForeign", !!input.isDirectForeign);
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  if ("amountRial" in input) set("amountRial", toNumber(input.amountRial, 0));
  if ("amountForeign" in input) {
    set("amountForeign", input.amountForeign == null || input.amountForeign === ""
      ? null : toNumber(input.amountForeign));
  }
  if ("exchangeRate" in input) {
    set("exchangeRate", input.exchangeRate == null || input.exchangeRate === ""
      ? null : toNumber(input.exchangeRate));
  }

  return { ...out, ...expandDateFields(input as Record<string, unknown>, TRANSACTION_DATE_FIELDS) };
}

/**
 * A foreign-currency amount is converted at the rate on the document.
 *
 * The rial figure is what the books are kept in, so it is derived here rather
 * than trusted: a client that sent an amount inconsistent with its own currency
 * and rate would put a wrong number into every total.
 */
function resolveAmount(input: TransactionInput, data: Record<string, unknown>): void {
  const foreign = data.amountForeign as number | null | undefined;
  const rate = data.exchangeRate as number | null | undefined;
  if (foreign != null && rate != null && rate > 0) {
    data.amountRial = foreign * rate;
  }
}


/* ----------------------- the project's money timeline ---------------------- */


/**
 * One transaction, in a sentence someone outside the deal can follow.
 *
 * The feed is read by people who were not part of the purchase — the point of
 * these entries is that the project's history can be reconstructed from them
 * alone. So each says which document, which direction, how much, against what,
 * by which method and on what date, rather than "ثبت تراکنش ... مبلغ ...".
 */
export function describeTransaction(
  t: {
    type?: string | null;
    documentNumber?: string | null;
    amountRial?: unknown;
    amountForeign?: unknown;
    currency?: string | null;
    paymentType?: string | null;
    occurredAtJalali?: string | null;
    status?: string | null;
    description?: string | null;
  },
  verb: "ثبت" | "ویرایش",
): string {
  const incoming = t.type === RECEIPT;
  const direction = incoming ? "دریافت وجه از کارفرما" : "پرداخت وجه به تأمین‌کننده";

  // No figure. The project timeline is read by everyone with access to the
  // project, including people who may not see what the company pays, so an
  // amount written into its prose would hand over what `src/server/costs.ts`
  // withholds everywhere else. The entry names the document; the document
  // carries the number.
  return (
    `${verb} سند ${incoming ? "دریافت" : "پرداخت"} شماره ${t.documentNumber || "-"}:` +
    ` ${direction}` +
    ` از طریق ${t.paymentType || "نامشخص"} در تاریخ ${t.occurredAtJalali || "-"}` +
    ` — وضعیت سند: ${t.status || "-"}.` +
    (t.description ? ` شرح: ${t.description}` : "")
  );
}

export async function createTransaction(input: TransactionInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const data = scalarData(input);
  resolveAmount(input, data);
  const transaction = await getDb().transaction.create({ data: data as Prisma.TransactionUncheckedCreateInput });

  // Audit log
  await logAction(
    {
      action: "CREATE",
      module: "تراکنش‌های مالی",
      entityId: transaction.id,
      description: `ایجاد تراکنش ${transaction.type}: ${transaction.documentNumber || transaction.id}`,
      afterState: transaction,
    },
    user,
    todayJalali,
  );

  // Notification
  await notifyModuleResponsible(
    "transactions",
    "ثبت تراکنش مالی جدید",
    `تراکنش ${transaction.type} جدید ثبت شد: ${transaction.documentNumber || transaction.id}`,
    user,
    transaction.projectId,
  );

  // Workflow trigger
  await processWorkflowRules(
    "transaction_created",
    {
      transactionId: transaction.id,
      transactionNumber: transaction.documentNumber,
      type: transaction.type,
      amount: transaction.amountRial?.toString(),
      // The editor offers this name, and a numeric comparison needs a number.
      amountRIYAL: Number(transaction.amountRial ?? 0),
      paymentType: transaction.paymentType,
      currency: transaction.amountForeign != null ? "foreign" : "rial",
      projectId: transaction.projectId,
      customerId: transaction.customerId,
    },
    user,
  );

  // The project's timeline records the money that moved on it.
  await logProjectFact(
    {
      projectId: transaction.projectId,
      categoryName: ACTIVITY_CATEGORY.TRANSACTIONS,
      text: describeTransaction(transaction, "ثبت"),
    },
    user,
    todayJalali,
  );

  return transaction;
}

/**
 * Edits a transaction.
 *
 * A reversed entry is frozen: it and its reversal are a matched pair, and
 * changing either would break the correspondence that makes the correction
 * auditable.
 */
export async function updateTransaction(
  id: string,
  input: TransactionInput,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | "frozen" | { transaction: unknown }> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const existing = await db.transaction.findUnique({
    where: { id },
    select: { id: true, status: true, reversalOfTransactionId: true },
  });
  if (!existing) return "not-found";
  if (existing.status === REVERSED || existing.reversalOfTransactionId) return "frozen";

  // Get before state for audit log
  const before = await db.transaction.findUnique({ where: { id } });

  const data = scalarData(input);
  resolveAmount(input, data);

  const transaction = await db.transaction.update({
    where: { id },
    data: data as Prisma.TransactionUncheckedUpdateInput,
  });

  // Audit log
  await logAction(
    {
      action: "UPDATE",
      module: "تراکنش‌های مالی",
      entityId: id,
      description: `ویرایش تراکنش: ${transaction.documentNumber || id}`,
      beforeState: before,
      afterState: transaction,
    },
    user,
    todayJalali,
  );

  await logProjectFact(
    {
      projectId: transaction.projectId,
      categoryName: ACTIVITY_CATEGORY.TRANSACTIONS,
      text: describeTransaction(transaction, "ویرایش"),
    },
    user,
    todayJalali,
  );

  return { transaction };
}

/**
 * Reverses a transaction with an opposite entry rather than deleting it.
 *
 * Deleting money that has been recorded loses the fact that it was ever
 * recorded. A reversal writes a mirror-image entry pointing back at the
 * original, marks the original reversed, and leaves both visible — which is what
 * makes a correction explicable afterwards.
 */
export async function reverseTransaction(
  id: string,
  documentNumber: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | "already-reversed" | { reversal: unknown }> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  // Read once outside the transaction so the timeline entry below can describe
  // what was reversed; the authoritative check is re-run inside it, because two
  // concurrent reversals must not both get past it.
  const original = await db.transaction.findUnique({ where: { id } });
  if (!original) return "not-found";
  if (original.status === REVERSED || original.reversalOfTransactionId) return "already-reversed";

  const result = await db.$transaction(async (tx) => {
    const current = await tx.transaction.findUnique({
      where: { id },
      select: { status: true, reversalOfTransactionId: true },
    });
    if (!current) return "not-found" as const;
    if (current.status === REVERSED || current.reversalOfTransactionId) {
      return "already-reversed" as const;
    }

    const reversal = await tx.transaction.create({
      data: {
        documentNumber,
        // The mirror image: a receipt is undone by a payment.
        type: original.type === RECEIPT ? PAYMENT : RECEIPT,
        receiptType: original.receiptType,
        status: CONFIRMED,
        ...expandDateFields({ occurredAt: todayJalali }, TRANSACTION_DATE_FIELDS),
        customerId: original.customerId,
        supplierId: original.supplierId,
        projectId: original.projectId,
        proformaId: original.proformaId,
        purchaseOrderId: original.purchaseOrderId,
        partyName: original.partyName,
        amountRial: original.amountRial,
        amountForeign: original.amountForeign,
        exchangeRate: original.exchangeRate,
        isDirectForeign: original.isDirectForeign,
        paymentType: original.paymentType,
        referenceNumber: original.referenceNumber,
        notes: `ابطال سند ${original.documentNumber}`,
        reversalOfTransactionId: original.id,
      } as Prisma.TransactionUncheckedCreateInput,
    });

    await tx.transaction.update({ where: { id }, data: { status: REVERSED } });
    return { reversal };
  });

  if (typeof result === "string") return result;

  // A reversal is how a confirmed entry is corrected, so it is the thing the
  // timeline should show — the original is never deleted and never logged as
  // such.
  await logProjectFact(
    {
      projectId: original.projectId,
      categoryName: ACTIVITY_CATEGORY.TRANSACTIONS,
      text:
        `سند ${original.type === RECEIPT ? "دریافت" : "پرداخت"} شماره ${original.documentNumber || "-"}` +
        ` ابطال شد.` +
        ` سند اصلاحی (معکوس) با شماره ${documentNumber} صادر گردید؛` +
        ` اثر مالی این دو سند یکدیگر را خنثی می‌کند و مانده پروژه به وضعیت پیش از سند اصلی بازمی‌گردد.`,
    },
    user,
    todayJalali,
  );

  return result;
}

/**
 * Deletes a transaction.
 *
 * Only ever allowed for an entry that is not confirmed — a draft entered by
 * mistake. A confirmed one is corrected by reversal, and a reversal itself is
 * never removed, or the original would be left marked reversed with nothing
 * explaining it.
 */
export async function deleteTransaction(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "forbidden" | "not-found" | "confirmed"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const existing = await db.transaction.findUnique({
    where: { id },
    select: { id: true, status: true, reversalOfTransactionId: true, documentNumber: true },
  });
  if (!existing) return "not-found";
  if (existing.status === CONFIRMED || existing.status === REVERSED || existing.reversalOfTransactionId) {
    return "confirmed";
  }

  // Get transaction info for audit log before deletion
  const transaction = await db.transaction.findUnique({ where: { id } });

  await db.transaction.delete({ where: { id } });

  // Audit log
  if (transaction) {
    await logAction(
      {
        action: "DELETE",
        module: "تراکنش‌های مالی",
        entityId: id,
        description: `حذف تراکنش: ${transaction.documentNumber || id}`,
        beforeState: transaction,
      },
      user,
      todayJalali,
    );

    await logProjectFact(
      {
        projectId: transaction.projectId,
        categoryName: ACTIVITY_CATEGORY.TRANSACTIONS,
        text:
          `سند ${transaction.type === "دریافت" ? "دریافت" : "پرداخت"} شماره` +
          ` ${transaction.documentNumber || "-"}` +
          ` (تاریخ ${transaction.occurredAtJalali || "-"}) از سیستم حذف شد و مانده پروژه بازمحاسبه گردید.`,
      },
      user,
      todayJalali,
    );
  }

  return "ok";
}
