import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { refuseCostWrite } from "../costs";
import { getDb } from "../db";
import { nextDocumentNumber } from "../documentNumbers";
import { getTodayShamsi } from "../../dateUtils";
import {
  PO_FILTERABLE, PO_SORTABLE, PurchaseOrderInput,
  countPurchaseOrderReferences, createPurchaseOrder, deletePurchaseOrder,
  getPurchaseOrder, listPurchaseOrders, updatePurchaseOrder,
} from "../services/purchaseOrderService";

/**
 * Purchase orders REST API.
 *
 * Order value and landed cost are computed from the stored lines, and reaching
 * the received status puts the goods into stock — both handled by the service,
 * so a client cannot send a landed cost or move inventory by other means.
 */

const WRITABLE: (keyof PurchaseOrderInput)[] = [
  "poNumber", "supplierId", "projectId", "proformaId", "status", "currency", "exchangeRate",
  "orderDate", "expectedDeliveryDate", "paymentDate", "goodsReadyDate",
  "shipmentDate", "clearanceDate", "receivedDate",
  "shippingCostRial", "customsDutyRial", "remittanceFeeRial",
  "shippingCostForeign", "remittanceFeeForeign",
  "notes", "customValues", "items",
];

function pickInput(body: unknown): PurchaseOrderInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as PurchaseOrderInput;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });


export function registerPurchaseOrderRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_purchase_orders";

  app.get("/api/purchase-orders", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, PO_SORTABLE, PO_FILTERABLE);
      const result = await listPurchaseOrders(q, user, {
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
      });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/purchase-orders");
    }
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const purchaseOrder = await getPurchaseOrder(req.params.id, user);
      if (!purchaseOrder) {
        res.status(404).json({ success: false, error: "سفارش خرید یافت نشد." });
        return;
      }
      res.json({ success: true, purchaseOrder });
    } catch (err) {
      sendError(res, err, "GET /api/purchase-orders/:id");
    }
  });

  app.get("/api/purchase-orders/:id/references", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countPurchaseOrderReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/purchase-orders/:id/references");
    }
  });

  app.post("/api/purchase-orders", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    if (refuseCostWrite(res, user)) return;
    try {
      const input = pickInput(req.body);
      if (!input.supplierId) {
        res.status(400).json({ success: false, error: "انتخاب تأمین‌کننده الزامی است." });
        return;
      }
      if (!input.orderDate) {
        res.status(400).json({ success: false, error: "تاریخ سفارش الزامی است." });
        return;
      }
      // Blank means "make one up" — see documentNumbers.ts.
      if (!input.poNumber || !String(input.poNumber).trim()) {
        const db = getDb();
        const [supplier, project] = await Promise.all([
          db.supplier.findUnique({ where: { id: input.supplierId }, select: { name: true } }),
          input.projectId
            ? db.project.findUnique({ where: { id: input.projectId }, select: { code: true } })
            : Promise.resolve(null),
        ]);
        input.poNumber = await nextDocumentNumber({
          formatKey: "poFormat", startSeqKey: "poStartSeq",
          fallbackFormat: "PO-{YYYY}-{SEQ:4}",
          count: () => db.purchaseOrder.count(),
          taken: async (v) => !!(await db.purchaseOrder.findUnique({
            where: { poNumber: v }, select: { id: true },
          })),
          context: { supplierName: supplier?.name, projectCode: project?.code },
        });
      }
      if (!input.status) input.status = "پیش‌نویس";

      const purchaseOrder = await createPurchaseOrder(input, user, getTodayShamsi());
      if (!purchaseOrder) return denied(res);
      res.status(201).json({ success: true, purchaseOrder });
    } catch (err) {
      sendError(res, err, "POST /api/purchase-orders");
    }
  });

  app.put("/api/purchase-orders/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    if (refuseCostWrite(res, user)) return;
    try {
      const purchaseOrder = await updatePurchaseOrder(
        req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (!purchaseOrder) {
        res.status(404).json({ success: false, error: "سفارش خرید یافت نشد." });
        return;
      }
      res.json({ success: true, purchaseOrder });
    } catch (err) {
      sendError(res, err, "PUT /api/purchase-orders/:id");
    }
  });

  app.delete("/api/purchase-orders/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    if (refuseCostWrite(res, user)) return;
    try {
      const outcome = await deletePurchaseOrder(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "سفارش خرید یافت نشد." });
        return;
      }
      if (outcome === "in-use") {
        res.status(409).json({
          success: false,
          code: "IN_USE",
          error: "این سفارش خرید تراکنش مالی ثبت‌شده دارد و قابل حذف نیست.",
          references: await countPurchaseOrderReferences(req.params.id),
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/purchase-orders/:id");
    }
  });
}
