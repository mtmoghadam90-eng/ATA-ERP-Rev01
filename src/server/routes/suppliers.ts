import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import {
  SUPPLIER_FILTERABLE, SUPPLIER_SORTABLE, SupplierInput,
  countSupplierReferences, createSupplier, deleteSupplier, findDuplicateSupplier, getSupplier,
  listSuppliers, mergeSuppliers, updateSupplier,
} from "../services/supplierService";
import { duplicateSupplierRefusal, supplierNameKey } from "../../utils/supplierDuplicates";
import { getTodayShamsi } from "../../dateUtils";

const WRITABLE: (keyof SupplierInput)[] = [
  "name", "country", "city", "contactName", "phone", "email", "website",
  "paymentTerms", "status", "description", "providedCategories", "customValues",
  "documents",
];

function pickInput(body: unknown): SupplierInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as SupplierInput;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });

export function registerSupplierRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_suppliers";

  app.get("/api/suppliers", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, SUPPLIER_SORTABLE, SUPPLIER_FILTERABLE);
      const result = await listSuppliers(q, user);
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/suppliers");
    }
  });

  app.get("/api/suppliers/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const supplier = await getSupplier(req.params.id, user);
      if (!supplier) {
        res.status(404).json({ success: false, error: "تأمین‌کننده یافت نشد." });
        return;
      }
      res.json({ success: true, supplier });
    } catch (err) {
      sendError(res, err, "GET /api/suppliers/:id");
    }
  });

  app.get("/api/suppliers/:id/references", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countSupplierReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/suppliers/:id/references");
    }
  });

  // Registered before `/api/suppliers/:id` routes that could read «merge» as an id.
  app.post("/api/suppliers/merge", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await mergeSuppliers(
        String(body.sourceId ?? ""), String(body.targetId ?? ""), user, getTodayShamsi());
      if (!outcome.ok) {
        res.status(outcome.status).json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, moved: outcome.moved });
    } catch (err) {
      sendError(res, err, "POST /api/suppliers/merge");
    }
  });

  app.post("/api/suppliers", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (!input.name || !String(input.name).trim()) {
        res.status(400).json({ success: false, error: "نام تأمین‌کننده الزامی است." });
        return;
      }
      // One company, one record: a second «Ningbo Sanmin» splits its history
      // in two and cannot be deleted once anything points at it.
      const dup = await findDuplicateSupplier(input.name);
      if (dup) {
        res.status(409).json({ success: false, code: "DUPLICATE", error: duplicateSupplierRefusal(dup.name), duplicateId: dup.id });
        return;
      }
      const supplier = await createSupplier(input, user, getTodayShamsi());
      if (!supplier) return denied(res);
      res.status(201).json({ success: true, supplier });
    } catch (err) {
      sendError(res, err, "POST /api/suppliers");
    }
  });

  app.put("/api/suppliers/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      // Only a *changed* name is checked: two duplicates already on disk must
      // stay editable (a phone number corrected) until somebody merges them.
      const stored = "name" in input ? await getSupplier(req.params.id, user) : null;
      if ("name" in input && supplierNameKey(stored?.name) !== supplierNameKey(String(input.name ?? ""))) {
        const dup = await findDuplicateSupplier(input.name, req.params.id);
        if (dup) {
          res.status(409).json({ success: false, code: "DUPLICATE", error: duplicateSupplierRefusal(dup.name), duplicateId: dup.id });
          return;
        }
      }
      const supplier = await updateSupplier(req.params.id, input, user, getTodayShamsi());
      if (!supplier) {
        res.status(404).json({ success: false, error: "تأمین‌کننده یافت نشد." });
        return;
      }
      res.json({ success: true, supplier });
    } catch (err) {
      sendError(res, err, "PUT /api/suppliers/:id");
    }
  });

  app.delete("/api/suppliers/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteSupplier(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "تأمین‌کننده یافت نشد." });
        return;
      }
      if (outcome === "in-use") {
        res.status(409).json({
          success: false,
          code: "IN_USE",
          error: "این تأمین‌کننده در سفارش خرید، استعلام یا تراکنش استفاده شده و قابل حذف نیست. اگر رکورد تکراری است، با دکمهٔ «ادغام» آن را در تأمین‌کنندهٔ اصلی ادغام کنید.",
          references: await countSupplierReferences(req.params.id),
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/suppliers/:id");
    }
  });
}
