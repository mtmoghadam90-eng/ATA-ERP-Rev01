import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { nextProformaNumber } from "../documentNumberSpecs";
import { getTodayShamsi } from "../../dateUtils";
import { redactProforma } from "../costs";
import { lostLineWithoutReason } from "../proformaStatus";
import {
  PROFORMA_FILTERABLE, PROFORMA_SORTABLE, ProformaInput,
  cancelSupersededVersion, countProformaReferences, createProforma, deleteProforma, getProforma,
  listProformas, setItemOutcomes, updateProforma,
} from "../services/proformaService";

/**
 * Proformas REST API.
 *
 * Money totals and the outcome status are computed server-side from the stored
 * lines, so the response is the authority rather than whatever the form last
 * calculated.
 */

const WRITABLE: (keyof ProformaInput)[] = [
  "proformaNumber", "proformaType", "customerId", "contactCustomerId", "contactPrefix",
  "projectId", "status", "isCancelled", "lossReason", "currency",
  "issueDate", "expiryDate", "deliveryDate", "sentDate",
  "discountPercent", "discountAmount", "taxPercent", "taxAmount", "extraCosts",
  "historicalExchangeRate", "notes", "sentMethod", "sentRecipients", "customValues",
  // A revision names what it revises. Explicit and writable, because it can
  // never be inferred: a project routinely carries several open quotations.
  "previousVersionId",
  "items",
];

function pickInput(body: unknown): ProformaInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as ProformaInput;
}

export function registerProformaRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_proformas";

  app.get("/api/proformas", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, PROFORMA_SORTABLE, PROFORMA_FILTERABLE);
      const result = await listProformas(q, user, {
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        isCancelled: req.query.isCancelled,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/proformas");
    }
  });

  app.get("/api/proformas/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const proforma = await getProforma(req.params.id, user);
      if (!proforma) {
        res.status(404).json({ success: false, error: "پیش‌فاکتور یافت نشد." });
        return;
      }
      res.json({ success: true, proforma: redactProforma(proforma, user) });
    } catch (err) {
      sendError(res, err, "GET /api/proformas/:id");
    }
  });

  app.get("/api/proformas/:id/references", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countProformaReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/proformas/:id/references");
    }
  });

  app.post("/api/proformas", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (!input.customerId) {
        res.status(400).json({ success: false, error: "انتخاب مشتری الزامی است." });
        return;
      }
      if (!input.issueDate) {
        res.status(400).json({ success: false, error: "تاریخ صدور الزامی است." });
        return;
      }
      if (!input.status) input.status = "پیش‌نویس";

      // Blank means "make one up" — see documentNumbers.ts.
      if (!input.proformaNumber || !String(input.proformaNumber).trim()) {
        input.proformaNumber = await nextProformaNumber({
          projectId: input.projectId, customerId: input.customerId,
        });
      }

      // "Today" is resolved here, where a request exists, rather than inside the
      // service — so the stamped winning/closing dates use the same clock the
      // rest of the request does.
      const proforma = await createProforma(input, user, getTodayShamsi());
      res.status(201).json({ success: true, proforma: redactProforma(proforma, user) });
    } catch (err) {
      sendError(res, err, "POST /api/proformas");
    }
  });

  /**
   * Cancels the document this revision replaced.
   *
   * A separate call because it is a separate decision, made after the revision
   * is saved and answered by a person: «لغو نسخه قبلی» or «بدون تغییر باقی
   * بماند». Nothing here assigns a loss reason — a revision is not a lost sale.
   */
  app.post("/api/proformas/:id/cancel-previous-version", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await cancelSupersededVersion(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این پیش‌فاکتور را ندارید." });
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "نسخه قبلی یافت نشد." });
        return;
      }
      if (outcome === "no-previous") {
        res.status(400).json({ success: false, error: "این پیش‌فاکتور نسخه قبلی ندارد." });
        return;
      }
      if (outcome === "already-closed") {
        res.status(409).json({
          success: false,
          code: "ALREADY_CLOSED",
          error: "نتیجه نهایی نسخه قبلی قبلاً مشخص شده است و تغییر داده نمی‌شود.",
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "POST /api/proformas/:id/cancel-previous-version");
    }
  });

  app.put("/api/proformas/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const proforma = await updateProforma(req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (!proforma) {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این پیش‌فاکتور را ندارید." });
        return;
      }
      res.json({ success: true, proforma: redactProforma(proforma, user) });
    } catch (err) {
      sendError(res, err, "PUT /api/proformas/:id");
    }
  });

  /**
   * Sets per-line outcomes (won / lost / cancelled). This is what decides a deal,
   * and it re-derives the parent project's status in the same transaction.
   */
  app.post("/api/proformas/:id/item-outcomes", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const raw = (req.body as { outcomes?: unknown })?.outcomes;
      if (!Array.isArray(raw) || raw.length === 0) {
        res.status(400).json({ success: false, error: "فهرست وضعیت اقلام خالی است." });
        return;
      }

      const allowed = new Set(["جاری", "برنده", "بازنده", "لغو شده"]);
      const outcomes: { itemId: string; status: string; lossReason?: string | null }[] = [];
      for (const entry of raw) {
        const e = (entry ?? {}) as Record<string, unknown>;
        const itemId = typeof e.itemId === "string" ? e.itemId : "";
        const status = typeof e.status === "string" ? e.status : "";
        if (!itemId || !allowed.has(status)) {
          res.status(400).json({ success: false, error: "وضعیت قلم نامعتبر است." });
          return;
        }
        outcomes.push({
          itemId,
          status,
          lossReason: typeof e.lossReason === "string" ? e.lossReason : null,
        });
      }

      /*
       * A lost line has to say why. The project's own loss reason is derived
       * from these lines now, so one left blank is a lost job the report cannot
       * explain — and the form already marks the field required, which makes
       * this the server saying the same thing rather than a new demand.
       */
      const blank = lostLineWithoutReason(outcomes);
      if (blank !== null) {
        res.status(400).json({
          success: false,
          error: `برای ردیف ${blank + 1} که «بازنده» شده، انتخاب دلیل باخت الزامی است.`,
        });
        return;
      }

      const outcome = await setItemOutcomes(req.params.id, outcomes, user, getTodayShamsi());
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این پیش‌فاکتور را ندارید." });
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "یکی از اقلام در این پیش‌فاکتور یافت نشد." });
        return;
      }
      res.json({
        success: true,
        proforma: redactProforma(await getProforma(req.params.id, user), user),
      });
    } catch (err) {
      sendError(res, err, "POST /api/proformas/:id/item-outcomes");
    }
  });

  app.delete("/api/proformas/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      // `?removeActivities=true` takes the record's automatic timeline entries
      // with it. Absent means keep them, which is the safe default: the entry
      // recording the deletion then joins them.
      const outcome = await deleteProforma(
        req.params.id, user, getTodayShamsi(),
        req.query.removeActivities === "true",
      );
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه حذف این پیش‌فاکتور را ندارید." });
        return;
      }
      if (outcome === "in-use") {
        const references = await countProformaReferences(req.params.id);
        res.status(409).json({
          success: false,
          code: "IN_USE",
          // Being the base of a revision is a different problem from having a
          // purchase order against it, and it has a different answer — cancel
          // it, do not delete it — so it says so rather than naming documents
          // the user will go looking for and not find.
          error: references.nextVersions > 0
            ? "این پیش‌فاکتور مبنای یک نسخه جدید است و قابل حذف نیست. در صورت نیاز آن را لغو کنید."
            : "این پیش‌فاکتور اسناد وابسته دارد (سفارش خرید، تراکنش یا ارسال) و قابل حذف نیست.",
          references,
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/proformas/:id");
    }
  });
}
