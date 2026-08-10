import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { refuseCostWrite } from "../costs";
import { getTodayShamsi } from "../../dateUtils";
import {
  INQUIRY_FILTERABLE, INQUIRY_SORTABLE, InquiryInput,
  addInquiryStep, createInquiry, deleteInquiry, deleteInquiryStep,
  getInquiry, listInquiries, updateInquiry, updateInquiryStep,
} from "../services/inquiryService";

/**
 * Supplier inquiries REST API.
 *
 * Workflow steps are derived from what the user does — a price arriving, an
 * offer being confirmed, a winner declared — so they are not part of the write
 * body. Manual steps get their own endpoint.
 */

const WRITABLE: (keyof InquiryInput)[] = [
  "projectId", "supplierId", "isWinner", "offerConfirmed",
  "creationDate", "winnerDate", "offerConfirmedDate",
  "technicalOfferUrl", "financialOfferUrl", "discountPercent", "discountAmount",
  "items", "initialStep",
];

function pickInput(body: unknown): InquiryInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as InquiryInput;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });

export function registerInquiryRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_supplier_inquiries";

  app.get("/api/supplier-inquiries", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, INQUIRY_SORTABLE, INQUIRY_FILTERABLE);
      const result = await listInquiries(q, user, { isWinner: req.query.isWinner });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/supplier-inquiries");
    }
  });

  app.get("/api/supplier-inquiries/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const inquiry = await getInquiry(req.params.id, user);
      if (!inquiry) {
        res.status(404).json({ success: false, error: "استعلام یافت نشد." });
        return;
      }
      res.json({ success: true, inquiry });
    } catch (err) {
      sendError(res, err, "GET /api/supplier-inquiries/:id");
    }
  });

  app.post("/api/supplier-inquiries", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    // An offer is the purchase price before it becomes one; a user who cannot
    // see it was served this record with the amounts blanked.
    if (refuseCostWrite(res, user)) return;
    try {
      const input = pickInput(req.body);
      if (!input.projectId) {
        res.status(400).json({ success: false, error: "انتخاب پروژه الزامی است." });
        return;
      }
      if (!input.supplierId) {
        res.status(400).json({ success: false, error: "انتخاب تأمین‌کننده الزامی است." });
        return;
      }
      if (!input.creationDate) input.creationDate = getTodayShamsi();

      const inquiry = await createInquiry(input, user, getTodayShamsi());
      if (!inquiry) return denied(res);
      res.status(201).json({ success: true, inquiry });
    } catch (err) {
      sendError(res, err, "POST /api/supplier-inquiries");
    }
  });

  app.put("/api/supplier-inquiries/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    // An offer is the purchase price before it becomes one; a user who cannot
    // see it was served this record with the amounts blanked.
    if (refuseCostWrite(res, user)) return;
    try {
      const inquiry = await updateInquiry(req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (!inquiry) {
        res.status(404).json({ success: false, error: "استعلام یافت نشد." });
        return;
      }
      res.json({ success: true, inquiry });
    } catch (err) {
      sendError(res, err, "PUT /api/supplier-inquiries/:id");
    }
  });

  app.post("/api/supplier-inquiries/:id/steps", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        res.status(400).json({ success: false, error: "عنوان اقدام الزامی است." });
        return;
      }

      const outcome = await addInquiryStep(req.params.id, {
        title,
        occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
        method: typeof body.method === "string" ? body.method : null,
        recipientName: typeof body.recipientName === "string" ? body.recipientName : null,
        notes: typeof body.notes === "string" ? body.notes : null,
      }, user, getTodayShamsi());

      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "استعلام یافت نشد." });
        return;
      }
      res.status(201).json({ success: true, step: outcome.step });
    } catch (err) {
      sendError(res, err, "POST /api/supplier-inquiries/:id/steps");
    }
  });

  /**
   * Corrects a recorded step.
   *
   * A derived step is dated when the system noticed the change, not when the
   * thing happened, so its date is editable — but only its date. The service
   * ignores everything else for those.
   */
  app.put("/api/supplier-inquiries/:id/steps/:stepId", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    if (refuseCostWrite(res, user)) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await updateInquiryStep(req.params.id, req.params.stepId, {
        occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        method: typeof body.method === "string" ? body.method : undefined,
        recipientName: typeof body.recipientName === "string" ? body.recipientName : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      }, user);
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "اقدام یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/supplier-inquiries/:id/steps/:stepId");
    }
  });

  app.delete("/api/supplier-inquiries/:id/steps/:stepId", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteInquiryStep(req.params.id, req.params.stepId, user);
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "اقدام یافت نشد." });
        return;
      }
      if (outcome === "auto") {
        res.status(409).json({
          success: false,
          code: "AUTO_STEP",
          error: "اقدام‌های خودکار حذف نمی‌شوند؛ این اقدام از روی رویدادهای واقعی استعلام ثبت شده است.",
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/supplier-inquiries/:id/steps/:stepId");
    }
  });

  app.delete("/api/supplier-inquiries/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    // An offer is the purchase price before it becomes one; a user who cannot
    // see it was served this record with the amounts blanked.
    if (refuseCostWrite(res, user)) return;
    try {
      // `?removeActivities=true` takes the record's automatic timeline entries
      // with it. Absent means keep them, which is the safe default: the entry
      // recording the deletion then joins them.
      const outcome = await deleteInquiry(
        req.params.id, user, getTodayShamsi(),
        req.query.removeActivities === "true",
      );
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "استعلام یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/supplier-inquiries/:id");
    }
  });
}
