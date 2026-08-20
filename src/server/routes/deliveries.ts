import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { getDb } from "../db";
import { nextDocumentNumber } from "../documentNumbers";
import {
  DELIVERY_FILTERABLE, DELIVERY_SORTABLE, DeliveryInput,
  SERVICE_FILTERABLE, SERVICE_SORTABLE, ServiceInput,
  createDelivery, createService, deleteDelivery, deleteService,
  getDelivery, getDeliveryRemaining, getService, listDeliveries, listServices,
  updateDelivery, updateService,
} from "../services/deliveryService";
import { getTodayShamsi } from "../../dateUtils";

/** Packing lists and after-sales service records. Both gated by `packagingDelivery`. */

const DELIVERY_WRITABLE: (keyof DeliveryInput)[] = [
  "packingListNumber", "projectId", "proformaId", "deliveryDate", "actualDeliveryDate",
  "shippingMethod", "preDeliveryTestNotes", "checklist", "photos", "items",
  "waybillNumber", "driverName", "driverPhone", "vehiclePlate", "trackingCode",
  "customValues",
];

const SERVICE_WRITABLE: (keyof ServiceInput)[] = [
  "projectId", "proformaNumber", "proformaItemName", "itemName", "status",
  "issueDescription", "actionsTaken", "startDate", "endDate", "returnDate",
  "createdBy", "items", "customValues",
];

function pick<T>(body: unknown, keys: (keyof T)[]): T {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in src) out[key as string] = src[key as string];
  }
  return out as T;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });

export function registerDeliveryRoutes(app: express.Express, deps: RouteDeps): void {
  const DELIVERY_KEY = "erp_packaging_deliveries";
  const SERVICE_KEY = "erp_after_sales_services";

  /* ---------------------------- packing lists ---------------------------- */

  app.get("/api/deliveries", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, DELIVERY_KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, DELIVERY_SORTABLE, DELIVERY_FILTERABLE);
      const result = await listDeliveries(q, user, { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/deliveries");
    }
  });

  /* Declared before `/:id` so "remaining" is not read as a delivery id. */
  app.get("/api/deliveries/remaining", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, DELIVERY_KEY, "read");
    if (!user) return;
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
      if (!projectId) {
        res.status(400).json({ success: false, error: "انتخاب پروژه الزامی است." });
        return;
      }
      const lines = await getDeliveryRemaining({
        projectId,
        proformaId: typeof req.query.proformaId === "string" ? req.query.proformaId : null,
        excludeDeliveryId: typeof req.query.excludeDeliveryId === "string" ? req.query.excludeDeliveryId : null,
      }, user);
      if (!lines) return denied(res);
      res.json({ success: true, lines });
    } catch (err) {
      sendError(res, err, "GET /api/deliveries/remaining");
    }
  });

  app.get("/api/deliveries/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, DELIVERY_KEY, "read");
    if (!user) return;
    try {
      const delivery = await getDelivery(req.params.id, user);
      if (!delivery) {
        res.status(404).json({ success: false, error: "لیست بسته‌بندی یافت نشد." });
        return;
      }
      res.json({ success: true, delivery });
    } catch (err) {
      sendError(res, err, "GET /api/deliveries/:id");
    }
  });

  app.post("/api/deliveries", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, DELIVERY_KEY, "write");
    if (!user) return;
    try {
      const input = pick<DeliveryInput>(req.body, DELIVERY_WRITABLE);
      if (!input.projectId) {
        res.status(400).json({ success: false, error: "انتخاب پروژه الزامی است." });
        return;
      }
      if (!input.deliveryDate) {
        res.status(400).json({ success: false, error: "تاریخ تحویل الزامی است." });
        return;
      }
      // Blank means "make one up", which the form says and only the server can
      // honour — the browser sees one page of existing numbers, not all of them.
      if (!input.packingListNumber || !String(input.packingListNumber).trim()) {
        const db = getDb();
        const project = await db.project.findUnique({
          where: { id: input.projectId }, select: { code: true },
        });
        input.packingListNumber = await nextDocumentNumber({
          formatKey: "packingListFormat", startSeqKey: "packingListStartSeq",
          fallbackFormat: "PL-{PROJECT}-{SEQ:3}",
          existing: async (prefix) => (await db.packagingDelivery.findMany({
            where: { packingListNumber: { startsWith: prefix } },
            select: { packingListNumber: true },
          })).map((r) => r.packingListNumber),
          taken: async (v) => !!(await db.packagingDelivery.findUnique({
            where: { packingListNumber: v }, select: { id: true },
          })),
          context: { projectCode: project?.code ?? "GEN" },
        });
      }
      const delivery = await createDelivery(input, user, getTodayShamsi());
      if (!delivery) return denied(res);
      res.status(201).json({ success: true, delivery });
    } catch (err) {
      sendError(res, err, "POST /api/deliveries");
    }
  });

  app.put("/api/deliveries/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, DELIVERY_KEY, "write");
    if (!user) return;
    try {
      const delivery = await updateDelivery(req.params.id, pick<DeliveryInput>(req.body, DELIVERY_WRITABLE), user, getTodayShamsi());
      if (!delivery) {
        res.status(404).json({ success: false, error: "لیست بسته‌بندی یافت نشد." });
        return;
      }
      res.json({ success: true, delivery });
    } catch (err) {
      sendError(res, err, "PUT /api/deliveries/:id");
    }
  });

  app.delete("/api/deliveries/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, DELIVERY_KEY, "write");
    if (!user) return;
    try {
      // `?removeActivities=true` takes the record's automatic timeline entries
      // with it. Absent means keep them, which is the safe default: the entry
      // recording the deletion then joins them.
      const outcome = await deleteDelivery(
        req.params.id, user, getTodayShamsi(),
        req.query.removeActivities === "true",
      );
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "لیست بسته‌بندی یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/deliveries/:id");
    }
  });

  /* -------------------------- after-sales service ------------------------- */

  app.get("/api/after-sales", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, SERVICE_KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, SERVICE_SORTABLE, SERVICE_FILTERABLE);
      const result = await listServices(q, user, { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/after-sales");
    }
  });

  app.get("/api/after-sales/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, SERVICE_KEY, "read");
    if (!user) return;
    try {
      const service = await getService(req.params.id, user);
      if (!service) {
        res.status(404).json({ success: false, error: "خدمات پس از فروش یافت نشد." });
        return;
      }
      res.json({ success: true, service });
    } catch (err) {
      sendError(res, err, "GET /api/after-sales/:id");
    }
  });

  app.post("/api/after-sales", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, SERVICE_KEY, "write");
    if (!user) return;
    try {
      const input = pick<ServiceInput>(req.body, SERVICE_WRITABLE);
      if (!input.projectId) {
        res.status(400).json({ success: false, error: "انتخاب پروژه الزامی است." });
        return;
      }
      // The record's name, dates and status are rolled up from its rows, so the
      // rows are what has to be there.
      if (!Array.isArray(input.items) || input.items.length === 0) {
        res.status(400).json({ success: false, error: "ثبت حداقل یک قلم کالا الزامی است." });
        return;
      }

      const service = await createService(input, user, getTodayShamsi());
      if (!service) return denied(res);
      res.status(201).json({ success: true, service });
    } catch (err) {
      sendError(res, err, "POST /api/after-sales");
    }
  });

  app.put("/api/after-sales/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, SERVICE_KEY, "write");
    if (!user) return;
    try {
      const service = await updateService(req.params.id, pick<ServiceInput>(req.body, SERVICE_WRITABLE), user, getTodayShamsi());
      if (!service) {
        res.status(404).json({ success: false, error: "خدمات پس از فروش یافت نشد." });
        return;
      }
      res.json({ success: true, service });
    } catch (err) {
      sendError(res, err, "PUT /api/after-sales/:id");
    }
  });

  app.delete("/api/after-sales/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, SERVICE_KEY, "write");
    if (!user) return;
    try {
      // `?removeActivities=true` takes the record's automatic timeline entries
      // with it. Absent means keep them, which is the safe default: the entry
      // recording the deletion then joins them.
      const outcome = await deleteService(
        req.params.id, user, getTodayShamsi(),
        req.query.removeActivities === "true",
      );
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "خدمات پس از فروش یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/after-sales/:id");
    }
  });
}
