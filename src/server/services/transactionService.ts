import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { toJsonColumn, toNullableString, toNumber } from "../childSync";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact, settleRecordHistory } from "./projectActivityLog";

/**
 * Transaction (receipts and payments) data access.
 *
 * **A document entered by mistake is corrected by editing it or deleting it.**
 * This module used to insist on a reversing entry instead — the textbook
 * answer, and the right one for a general ledger — but the screen never grew
 * anywhere to issue one, so in practice a confirmed document could be neither
 * edited in amount nor removed, and the error told the user to do something the
 * application gave them no way to do. Deleting takes the row's effect with it,
 * because a transaction's only effect is the money it contributes to the
 * totals; the deletion itself is recorded in the audit log with a full before
 * snapshot, which is where the trail lives.
 */

export const RECEIPT = "دریافت";
export const PAYMENT = "پرداخت";
const CONFIRMED = "تأیید شده";

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
 * Statuses that do **not** affect the balance.
 *
 * Written as an exclusion rather than a list of the ones that count, because
 * that is the safer default: a status nobody thought of counts as real money
 * rather than silently vanishing from the balance. Only a document explicitly
 * marked a draft or cancelled is left out.
 *
 * «ابطال شده» is deliberately still counted. Reversal is no longer how a
 * mistake is corrected here, but a database written before that may hold a
 * reversed original *and* its opposite entry — and those two cancel only if
 * both are counted. Dropping the original while keeping its reversal would
 * apply the correction twice.
 */
export const IGNORED_STATUSES = ["پیش‌نویس", "لغو شده"];

/** Whether a document with this status is money. Pure, and covered by `test:rules`. */
export function countsTowardBalance(status: string | null | undefined): boolean {
  return !IGNORED_STATUSES.includes(String(status ?? ""));
}

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
    where: { AND: [where, { status: { notIn: IGNORED_STATUSES } }] },
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
      sourceType: "TRANSACTION",
      sourceId: transaction.id,
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
 * Nothing is frozen. A document with a wrong figure on it is a wrong figure in
 * the balance, and the correction is to put the right one there; the audit log
 * keeps the before and after, which is what makes the change explicable
 * afterwards.
 */
export async function updateTransaction(
  id: string,
  input: TransactionInput,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | { transaction: unknown }> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  // Read once, for the audit entry's before snapshot and to answer "not-found"
  // before attempting a write that would throw P2025 instead.
  const before = await db.transaction.findUnique({ where: { id } });
  if (!before) return "not-found";

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
      sourceType: "TRANSACTION",
      sourceId: transaction.id,
      text: describeTransaction(transaction, "ویرایش"),
    },
    user,
    todayJalali,
  );

  return { transaction };
}

/**
 * Deletes a transaction, whatever its status.
 *
 * It used to refuse a confirmed one and tell the user to issue a reversing
 * entry instead. Every document this screen writes is confirmed and the screen
 * has no way to issue a reversal, so that refusal made a mistyped receipt
 * permanent — the error named a remedy the application did not offer.
 *
 * Deleting the row removes its effect in full, because the effect *is* the row:
 * a transaction moves no stock and reconciles nothing, it only contributes its
 * amount to the balances, and those are computed from the rows that exist. What
 * survives is the audit entry, which carries the whole document as it stood.
 *
 * `removeActivities` takes the automatic timeline entries about this record
 * with it — matched on the link each entry stores, never on its wording — and
 * drops a category group that is left empty. The default keeps them, and the
 * entry recording the deletion joins them, so the project's history stays
 * whole.
 */
export async function deleteTransaction(
  id: string,
  user: AuthUser,
  todayJalali: string,
  removeActivities = false,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  // Read in full first: this is the only copy of the document that will exist
  // after the next line, and it is what the audit entry carries.
  const transaction = await db.transaction.findUnique({ where: { id } });
  if (!transaction) return "not-found";

  await db.transaction.delete({ where: { id } });

  // Audit log
  {
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

    await settleRecordHistory(
      removeActivities,
      transaction.projectId,
      id,
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
