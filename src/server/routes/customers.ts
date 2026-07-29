import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import {
  CUSTOMER_FILTERABLE,
  CUSTOMER_SORTABLE,
  CustomerInput,
  countCustomerReferences,
  createCustomer,
  deleteCustomer,
  deleteCustomerWithMigration,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../services/customerService";

/**
 * Customers REST API — the reference shape for every other module.
 *
 * `GET /api/customers` returns a page, never the whole table: the browser used
 * to hold every record in memory, which is what breaks at a few thousand rows.
 * Permission is checked here (module level) and again inside the service
 * (record level, via ownerUserId), because a caller who may open the module is
 * not automatically allowed to see every record in it.
 */

/** Fields a client may set. Anything else in the body is ignored, so a caller
 *  cannot write `id`, `createdAt`, or someone else's `ownerUserId` by accident. */
const WRITABLE: (keyof CustomerInput)[] = [
  "customerType", "status", "companyName", "firstName", "lastName", "gender",
  "position", "economicCode", "industry", "keyPerson", "phone", "mobile",
  "email", "province", "city", "address", "notes", "tags", "customValues",
];

function pickInput(body: unknown): Partial<CustomerInput> {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as Partial<CustomerInput>;
}

export function registerCustomerRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_customers";

  app.get("/api/customers", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(
        req.query as Record<string, unknown>,
        CUSTOMER_SORTABLE,
        CUSTOMER_FILTERABLE,
      );
      // `customField=<id>:<value>`, repeatable. Kept out of parseListQuery's
      // allowlist because the field ids are defined by users at runtime.
      const result = await listCustomers(q, user, { customField: req.query.customField });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/customers");
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const customer = await getCustomer(req.params.id, user);
      if (!customer) {
        res.status(404).json({ success: false, error: "مشتری یافت نشد." });
        return;
      }
      res.json({ success: true, customer });
    } catch (err) {
      sendError(res, err, "GET /api/customers/:id");
    }
  });

  /** What would be affected by deleting this customer — drives the migrate-or-cancel prompt. */
  app.get("/api/customers/:id/references", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countCustomerReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/customers/:id/references");
    }
  });

  app.post("/api/customers", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (!input.companyName || !String(input.companyName).trim()) {
        res.status(400).json({ success: false, error: "نام مشتری الزامی است." });
        return;
      }
      const customer = await createCustomer(
        { customerType: "حقوقی", ...input } as CustomerInput,
        user,
      );
      res.status(201).json({ success: true, customer });
    } catch (err) {
      sendError(res, err, "POST /api/customers");
    }
  });

  app.put("/api/customers/:id", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const customer = await updateCustomer(req.params.id, pickInput(req.body), user);
      if (!customer) {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این مشتری را ندارید." });
        return;
      }
      res.json({ success: true, customer });
    } catch (err) {
      sendError(res, err, "PUT /api/customers/:id");
    }
  });

  /**
   * Delete. `?replaceWith=<id>` moves every dependent record to the replacement
   * first; without it, a customer that has history is refused rather than
   * silently orphaning (or cascading away) that history.
   */
  app.delete("/api/customers/:id", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const id = req.params.id;
      const replaceWith = typeof req.query.replaceWith === "string" ? req.query.replaceWith : "";

      if (replaceWith) {
        const result = await deleteCustomerWithMigration(id, replaceWith);
        res.json({ success: true, ...result });
        return;
      }

      const refs = await countCustomerReferences(id);
      if (refs.total > 0) {
        res.status(409).json({
          success: false,
          code: "HAS_HISTORY",
          error: "این مشتری سابقه دارد. برای حذف باید مشتری جانشین انتخاب شود.",
          references: refs,
        });
        return;
      }

      const ok = await deleteCustomer(id, user);
      if (!ok) {
        res.status(403).json({ success: false, error: "شما اجازه حذف این مشتری را ندارید." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/customers/:id");
    }
  });
}
