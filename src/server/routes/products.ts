import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import { toNumber } from "../childSync";
import {
  INVENTORY_SORTABLE, PRODUCT_FILTERABLE, PRODUCT_SORTABLE, ProductInput,
  adjustStock, copyProduct, countProductReferences, createProduct, deleteProduct,
  deleteInventoryTransaction, getProduct, listInventoryTransactions, listProducts,
  listCategoryUsage, lowStockProducts, mergeCategory, updateInventoryTransaction,
  updateProduct,
} from "../services/productService";

/**
 * Products and inventory REST API.
 *
 * Stock is never set directly through these routes: it moves by delta, and every
 * movement is recorded in the ledger by the service. The one exception is the
 * product form's editable stock field, which the service turns into a movement by
 * diffing against the stored level.
 */

const WRITABLE: (keyof ProductInput)[] = [
  "code", "name", "displayName", "category", "brand", "modelNumber", "unit",
  "description", "supplyType", "hasVariants", "stockLevel", "minStockLevel",
  "basePriceRial", "priceForeign", "currencyForeign",
  "features", "configRules", "images", "documents", "priceCalc", "customValues", "variants",
];

function pickInput(body: unknown): ProductInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as ProductInput;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });

export function registerProductRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_products";

  app.get("/api/products", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, PRODUCT_SORTABLE, PRODUCT_FILTERABLE);
      const result = await listProducts(q, user, { hasVariants: req.query.hasVariants });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/products");
    }
  });

  /** Products at or below their reorder point. A column-to-column comparison,
   *  so it is its own endpoint rather than a filter on the list. */
  app.get("/api/products/low-stock", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const rows = await lowStockProducts(user, toNumber(req.query.limit, 100));
      if (!rows) return denied(res);
      res.json({ success: true, rows });
    } catch (err) {
      sendError(res, err, "GET /api/products/low-stock");
    }
  });

  /*
   * Which categories products are actually filed under, beside the list.
   *
   * Registered before `/api/products/:id`, or Express answers 404 for a product
   * whose id is the literal string «categories».
   */
  app.get("/api/products/categories", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const rows = await listCategoryUsage(user);
      if (rows === "forbidden") return denied(res);
      res.json({ success: true, categories: rows });
    } catch (err) {
      sendError(res, err, "GET /api/products/categories");
    }
  });

  /**
   * Files every product under one category onto another.
   *
   * Needs `settings`, not `products`: this edits the taxonomy every report
   * groups by, which is not the same authority as editing a product.
   */
  app.post("/api/products/merge-category", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
      const outcome = await mergeCategory(
        String(body.from ?? ""), String(body.to ?? ""), user, getTodayShamsi(),
      );
      if (outcome === "forbidden") {
        res.status(403).json({
          success: false, error: "شما اجازه تغییر دسته‌بندی‌ها را ندارید.",
        });
        return;
      }
      if ("error" in outcome) {
        res.status(400).json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/products/merge-category");
    }
  });

  /** Stock ledger, optionally for one product or SKU. */
  app.get("/api/inventory-transactions", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, INVENTORY_SORTABLE);
      const result = await listInventoryTransactions(q, user, {
        productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
        variantId: typeof req.query.variantId === "string" ? req.query.variantId : undefined,
      });
      if (!result) return denied(res);
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/inventory-transactions");
    }
  });

  /*
   * Correcting the ledger: system administrator only.
   *
   * The gate is `isSystemAdmin`, not the products permission, and it is checked
   * again in the service — a warehouse user with full write access to stock
   * still cannot rewrite what the warehouse did, which is the whole point of
   * keeping a history. `requireKeyAccess` runs first only so an unauthenticated
   * caller gets the ordinary session answer rather than this one.
   */
  const adminOnly = (res: express.Response) =>
    res.status(403).json({
      success: false,
      error: "ویرایش یا حذف ردیف‌های تاریخچه انبار فقط توسط مدیر سیستم امکان‌پذیر است.",
    });

  app.put("/api/inventory-transactions/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await updateInventoryTransaction(req.params.id, {
        // Picked, not spread: the product, the SKU and the source document are
        // not writable — moving a row between products is two corrections, and
        // rewriting its source would detach it from the document that
        // reconciles against it.
        ...("quantity" in body ? { quantity: body.quantity } : {}),
        ...(typeof body.type === "string" ? { type: body.type } : {}),
        ...("occurredAtJalali" in body
          ? { occurredAtJalali: typeof body.occurredAtJalali === "string" ? body.occurredAtJalali : null }
          : {}),
        ...("notes" in body ? { notes: typeof body.notes === "string" ? body.notes : null } : {}),
      }, user, getTodayShamsi());

      if (outcome === "forbidden") return adminOnly(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "ردیف تاریخچه انبار یافت نشد." });
        return;
      }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "تعداد باید عددی بزرگ‌تر از صفر باشد. برای صفر کردن، ردیف را حذف کنید." });
        return;
      }
      res.json({ success: true, movement: outcome.after });
    } catch (err) {
      sendError(res, err, "PUT /api/inventory-transactions/:id");
    }
  });

  app.delete("/api/inventory-transactions/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteInventoryTransaction(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") return adminOnly(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "ردیف تاریخچه انبار یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/inventory-transactions/:id");
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const product = await getProduct(req.params.id, user);
      if (!product) {
        res.status(404).json({ success: false, error: "کالا یافت نشد." });
        return;
      }
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, "GET /api/products/:id");
    }
  });

  app.get("/api/products/:id/references", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countProductReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/products/:id/references");
    }
  });

  app.post("/api/products", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (!input.code || !String(input.code).trim()) {
        res.status(400).json({ success: false, error: "کد کالا الزامی است." });
        return;
      }
      if (!input.name || !String(input.name).trim()) {
        res.status(400).json({ success: false, error: "نام کالا الزامی است." });
        return;
      }
      if (!input.displayName) input.displayName = input.name;

      const product = await createProduct(input, user, getTodayShamsi());
      if (!product) return denied(res);
      res.status(201).json({ success: true, product });
    } catch (err) {
      sendError(res, err, "POST /api/products");
    }
  });

  app.put("/api/products/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const product = await updateProduct(req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (!product) {
        res.status(404).json({ success: false, error: "کالا یافت نشد." });
        return;
      }
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, "PUT /api/products/:id");
    }
  });

  /** Copies a product definition. Stock is not copied — it belongs to the item. */
  app.post("/api/products/:id/copy", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Optional: omitted, the service derives the next free {code}-C{n}, which
      // is a question only the unique index can answer correctly.
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const product = await copyProduct(req.params.id, {
        code: code || undefined,
        name: typeof body.name === "string" ? body.name : undefined,
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      }, user);
      if (!product) {
        res.status(404).json({ success: false, error: "کالای مبدأ یافت نشد." });
        return;
      }
      res.status(201).json({ success: true, product });
    } catch (err) {
      sendError(res, err, "POST /api/products/:id/copy");
    }
  });

  /**
   * Manual stock adjustment. Takes a signed delta rather than a new level, so two
   * users adjusting at once add up instead of overwriting each other.
   */
  app.post("/api/products/:id/stock", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const delta = toNumber(body.delta, 0);
      if (!delta) {
        res.status(400).json({ success: false, error: "مقدار تغییر موجودی باید عددی غیر صفر باشد." });
        return;
      }

      const outcome = await adjustStock({
        productId: req.params.id,
        variantId: typeof body.variantId === "string" ? body.variantId : null,
        delta,
        referenceId: typeof body.referenceId === "string" ? body.referenceId : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        occurredAtJalali: typeof body.occurredAtJalali === "string" ? body.occurredAtJalali : getTodayShamsi(),
      }, user);

      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({
          success: false,
          error: "کالا یا SKU یافت نشد. برای کالای دارای SKU باید موجودی هر SKU را جداگانه تغییر دهید.",
        });
        return;
      }
      res.json({ success: true, product: await getProduct(req.params.id, user) });
    } catch (err) {
      sendError(res, err, "POST /api/products/:id/stock");
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteProduct(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "کالا یافت نشد." });
        return;
      }
      if (outcome === "in-use") {
        res.status(409).json({
          success: false,
          code: "IN_USE",
          error: "این کالا در پیش‌فاکتور، سفارش خرید یا پروژه استفاده شده و قابل حذف نیست.",
          references: await countProductReferences(req.params.id),
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/products/:id");
    }
  });
}
