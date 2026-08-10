import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import { getDb } from "../db";
import { nextDocumentNumber } from "../documentNumbers";
import {
  TRANSACTION_FILTERABLE, TRANSACTION_SORTABLE, TransactionInput,
  createTransaction, deleteTransaction, getTransaction, listTransactions,
  reverseTransaction, transactionSummary, updateTransaction,
} from "../services/transactionService";

const WRITABLE: (keyof TransactionInput)[] = [
  "documentNumber", "type", "receiptType", "status", "occurredAt",
  "customerId", "supplierId", "projectId", "proformaId", "purchaseOrderId",
  "partyName", "amountRial", "amountForeign", "exchangeRate", "isDirectForeign",
  "paymentType", "referenceNumber", "notes", "customValues",
];

function pickInput(body: unknown): TransactionInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as TransactionInput;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });

export function registerTransactionRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_transactions";

  app.get("/api/transactions", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, TRANSACTION_SORTABLE, TRANSACTION_FILTERABLE);
      const result = await listTransactions(q, user, {
        dateFrom: req.query.dateFrom, dateTo: req.query.dateTo,
      });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/transactions");
    }
  });

  /** Totals for the same filters as the list — confirmed entries only. */
  app.get("/api/transactions/summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, TRANSACTION_SORTABLE, TRANSACTION_FILTERABLE);
      const summary = await transactionSummary(q, user, {
        dateFrom: req.query.dateFrom, dateTo: req.query.dateTo,
      });
      if (!summary) return denied(res);
      res.json({ success: true, summary });
    } catch (err) {
      sendError(res, err, "GET /api/transactions/summary");
    }
  });

  app.get("/api/transactions/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const transaction = await getTransaction(req.params.id, user);
      if (!transaction) {
        res.status(404).json({ success: false, error: "تراکنش یافت نشد." });
        return;
      }
      res.json({ success: true, transaction });
    } catch (err) {
      sendError(res, err, "GET /api/transactions/:id");
    }
  });

  app.post("/api/transactions", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (input.type !== "دریافت" && input.type !== "پرداخت") {
        res.status(400).json({ success: false, error: "نوع تراکنش باید دریافت یا پرداخت باشد." });
        return;
      }
      if (!input.occurredAt) {
        res.status(400).json({ success: false, error: "تاریخ تراکنش الزامی است." });
        return;
      }
      if (!input.paymentType) {
        res.status(400).json({ success: false, error: "نوع پرداخت الزامی است." });
        return;
      }

      // Blank means "make one up", as it does for projects, proformas, purchase
      // orders and packing lists. This endpoint alone demanded the number from
      // the caller, although the format and the starting sequence were already
      // in settings and the generator already existed — so every client had to
      // reimplement the numbering, and one that did not simply could not write
      // a transaction.
      if (!input.documentNumber || !String(input.documentNumber).trim()) {
        const db = getDb();
        const [customer, supplier, project] = await Promise.all([
          input.customerId
            ? db.customer.findUnique({ where: { id: input.customerId }, select: { companyName: true } })
            : Promise.resolve(null),
          input.supplierId
            ? db.supplier.findUnique({ where: { id: input.supplierId }, select: { name: true } })
            : Promise.resolve(null),
          input.projectId
            ? db.project.findUnique({ where: { id: input.projectId }, select: { code: true } })
            : Promise.resolve(null),
        ]);
        input.documentNumber = await nextDocumentNumber({
          formatKey: "transactionFormat", startSeqKey: "transactionStartSeq",
          fallbackFormat: "TR-{TYPE}-{YYYY}{MM}-{SEQ:3}",
          count: () => db.transaction.count(),
          taken: async (v) => !!(await db.transaction.findUnique({
            where: { documentNumber: v }, select: { id: true },
          })),
          context: {
            transactionType: input.type as "دریافت" | "پرداخت",
            customerName: customer?.companyName,
            supplierName: supplier?.name,
            projectCode: project?.code,
          },
        });
      }

      const transaction = await createTransaction(input, user, getTodayShamsi());
      if (!transaction) return denied(res);
      res.status(201).json({ success: true, transaction });
    } catch (err) {
      sendError(res, err, "POST /api/transactions");
    }
  });

  app.put("/api/transactions/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await updateTransaction(req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "تراکنش یافت نشد." });
        return;
      }
      if (outcome === "frozen") {
        res.status(409).json({
          success: false,
          code: "FROZEN",
          error: "سند ابطال‌شده یا سند ابطال قابل ویرایش نیست.",
        });
        return;
      }
      res.json({ success: true, transaction: outcome.transaction });
    } catch (err) {
      sendError(res, err, "PUT /api/transactions/:id");
    }
  });

  /** Corrects a confirmed entry with an opposite one, keeping both visible. */
  app.post("/api/transactions/:id/reverse", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      let documentNumber = typeof body.documentNumber === "string" ? body.documentNumber.trim() : "";

      // Generated when the caller does not name one — and a caller rarely
      // should. A reversal is the system's own correcting entry, issued because
      // a confirmed transaction may not be edited or deleted; asking whoever
      // pressed the button to invent its number is asking them to do the
      // application's bookkeeping.
      if (!documentNumber) {
        const db = getDb();
        const original = await db.transaction.findUnique({
          where: { id: req.params.id },
          select: {
            type: true,
            customer: { select: { companyName: true } },
            supplier: { select: { name: true } },
            project: { select: { code: true } },
          },
        });
        if (!original) {
          res.status(404).json({ success: false, error: "تراکنش یافت نشد." });
          return;
        }
        documentNumber = await nextDocumentNumber({
          formatKey: "transactionFormat", startSeqKey: "transactionStartSeq",
          fallbackFormat: "TR-{TYPE}-{YYYY}{MM}-{SEQ:3}",
          count: () => db.transaction.count(),
          taken: async (v) => !!(await db.transaction.findUnique({
            where: { documentNumber: v }, select: { id: true },
          })),
          context: {
            transactionType: original.type as "دریافت" | "پرداخت",
            customerName: original.customer?.companyName,
            supplierName: original.supplier?.name,
            projectCode: original.project?.code,
          },
        });
      }

      const outcome = await reverseTransaction(req.params.id, documentNumber, user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "تراکنش یافت نشد." });
        return;
      }
      if (outcome === "already-reversed") {
        res.status(409).json({ success: false, code: "ALREADY_REVERSED", error: "این سند قبلاً ابطال شده است." });
        return;
      }
      res.status(201).json({ success: true, reversal: outcome.reversal });
    } catch (err) {
      sendError(res, err, "POST /api/transactions/:id/reverse");
    }
  });

  app.delete("/api/transactions/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      // `?removeActivities=true` takes the record's automatic timeline entries
      // with it. Absent means keep them, which is the safe default: the entry
      // recording the deletion then joins them.
      const outcome = await deleteTransaction(
        req.params.id, user, getTodayShamsi(),
        req.query.removeActivities === "true",
      );
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "تراکنش یافت نشد." });
        return;
      }
      if (outcome === "confirmed") {
        res.status(409).json({
          success: false,
          code: "MUST_REVERSE",
          error: "سند تأییدشده حذف نمی‌شود؛ برای اصلاح باید سند ابطال صادر شود.",
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/transactions/:id");
    }
  });
}
