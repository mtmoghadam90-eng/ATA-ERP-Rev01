import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { hasPermission } from "../auth";
import {
  customerValueSummary, getCustomerValueDetail, listPotentialHistory, recalculateAll,
  setManualRank,
} from "../services/customerValueService";
import { logAction } from "../services/auditService";
import { getTodayShamsi } from "../../dateUtils";
import {
  CUSTOMER_FILTERABLE,
  CUSTOMER_METRIC_SORTABLE,
  CUSTOMER_SORTABLE,
  CustomerInput,
  countCustomerReferences,
  createCustomer,
  deleteCustomer,
  deleteCustomerWithMigration,
  findDuplicateCandidates,
  getCustomer,
  listCustomers,
  setCustomerAgreements,
  setCustomerLinks,
  updateCustomer,
} from "../services/customerService";
// The duplicate rules live here and are shared with the client, so the two can
// never disagree about what counts as a duplicate.
import {
  CustomerCandidate, findCustomerDuplicates, hasHardDuplicate,
} from "../../utils/customerDuplicates";
import type { Customer } from "../../types";

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
  // The manual half of customer value. Everything computed — the rank, the
  // scores, the gross profit — is deliberately absent: a client that could set
  // its own rank could set it to A.
  "potentialConsumption", "potentialCompanySize", "potentialProjects",
  "potentialPortfolioFit", "potentialRepeatPurchase",
  "paymentBehaviour", "costToServe",
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
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(
        req.query as Record<string, unknown>,
        // Metric columns live on the joined table; both lists stay allowlists.
        [...CUSTOMER_SORTABLE, ...CUSTOMER_METRIC_SORTABLE],
        CUSTOMER_FILTERABLE,
      );
      // `customField=<id>:<value>`, repeatable. Kept out of parseListQuery's
      // allowlist because the field ids are defined by users at runtime.
      // `linkedTo=<customerId>` filters to contacts linked to that company.
      const result = await listCustomers(q, user, {
        customField: req.query.customField,
        linkedTo: req.query.linkedTo,
        // Ranges and a relation rather than plain equality, so they travel
        // separately from parseListQuery's column allowlist.
        value: {
          rank: req.query.rank,
          minRealized: req.query.minRealized,
          maxRealized: req.query.maxRealized,
          minPotential: req.query.minPotential,
          maxPotential: req.query.maxPotential,
          minGrossProfit: req.query.minGrossProfit,
          maxGrossProfit: req.query.maxGrossProfit,
          lastPurchaseWithinMonths: req.query.lastPurchaseWithinMonths,
          paymentBehaviour: req.query.paymentBehaviour,
          costToServe: req.query.costToServe,
          notAssessed: req.query.notAssessed,
        },
        // The grid's per-column header inputs. Allowlisted by column name.
        columns: {
          type: req.query.colType,
          name: req.query.colName,
          industry: req.query.colIndustry,
          keyPerson: req.query.colKeyPerson,
          contact: req.query.colContact,
          province: req.query.colProvince,
          tags: req.query.colTags,
        },
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/customers");
    }
  });

  /**
   * Recomputes every customer's value metrics.
   *
   * Whole-population by necessity: gross profit and frequency are scored by
   * percentile, so one customer's sale moves everyone else's standing. Gated on
   * `settings` rather than `customers` — it rewrites a derived table, which is
   * an administrative act rather than customer data entry.
   *
   * Registered ahead of `/api/customers/:id`, which would otherwise match
   * "recalculate-value" as an id.
   */
  app.post("/api/customers/recalculate-value", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    if (!hasPermission(user, "settings")) {
      res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
      return;
    }
    try {
      // Awaited here, unlike the write triggers: the user pressed a button and
      // is waiting to be told how many customers were re-ranked.
      res.json({ success: true, ...(await recalculateAll()) });
    } catch (err) {
      sendError(res, err, "POST /api/customers/recalculate-value");
    }
  });

  /** Rank counts and totals, for the value dashboard's summary cards. */
  app.get("/api/customers/value-summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, summary: await customerValueSummary() });
    } catch (err) {
      sendError(res, err, "GET /api/customers/value-summary");
    }
  });

  /** Everything behind one customer's rank, so the card can show its working. */
  app.get("/api/customers/:id/value", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const detail = await getCustomerValueDetail(req.params.id);
      if (!detail) {
        res.status(404).json({ success: false, error: "مشتری یافت نشد." });
        return;
      }
      res.json({ success: true, value: detail });
    } catch (err) {
      sendError(res, err, "GET /api/customers/:id/value");
    }
  });

  /** The potential assessment log: how the company's view of them moved. */
  app.get("/api/customers/:id/potential-history", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, history: await listPotentialHistory(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/customers/:id/potential-history");
    }
  });

  /**
   * Sets or clears a customer's rank by hand.
   *
   * `mode` says what the override means — `locked` to keep it whatever the
   * figures do, `resume` to show it now and let the evaluation take back over
   * at the next recalculation. A null rank clears it outright.
   *
   * Gated on write access to customers rather than on `settings`: this is a
   * judgement about one customer, not a change to how everyone is scored.
   */
  app.put("/api/customers/:id/rank", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawRank = body.rank;
      const rank = rawRank === null || rawRank === "" ? null : String(rawRank);

      if (rank !== null && !["A", "B", "C", "D"].includes(rank)) {
        res.status(400).json({ success: false, error: "رتبه انتخاب‌شده معتبر نیست." });
        return;
      }
      const mode = body.mode === "locked" ? "locked" : "resume";
      const note = typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 400) : null;

      const result = await setManualRank(req.params.id, rank as never, mode, note, user.id);
      if (!result) {
        res.status(404).json({ success: false, error: "مشتری یافت نشد." });
        return;
      }

      await logAction(
        {
          action: "UPDATE",
          module: "مشتریان",
          entityId: req.params.id,
          description: rank === null
            ? "حذف رتبه دستی مشتری و بازگشت به ارزیابی خودکار"
            : `تعیین دستی رتبه مشتری: ${rank}` +
              (mode === "locked" ? " (حفظ دائمی)" : " (ارزیابی خودکار ادامه می‌یابد)"),
        },
        user,
        getTodayShamsi(),
      );

      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "PUT /api/customers/:id/rank");
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
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
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countCustomerReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/customers/:id/references");
    }
  });

  /**
   * Existing customers that look like the one being entered.
   *
   * A check, not a gate: it answers with matches and their severity and lets the
   * form decide what to say. Hard duplicates (a colliding economic code) are
   * refused by the database anyway; everything else is a warning, because a
   * shared office line or a genuine namesake must not block data entry.
   *
   * POST rather than GET because the candidate is a record, not a lookup key.
   */
  app.post("/api/customers/check-duplicates", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customerType = typeof body.customerType === "string" ? body.customerType : "";
      if (!customerType) {
        res.status(400).json({ success: false, error: "نوع مشتری الزامی است." });
        return;
      }

      const candidate = {
        id: typeof body.id === "string" ? body.id : undefined,
        customerType,
        companyName: typeof body.companyName === "string" ? body.companyName : null,
        firstName: typeof body.firstName === "string" ? body.firstName : null,
        lastName: typeof body.lastName === "string" ? body.lastName : null,
        mobile: typeof body.mobile === "string" ? body.mobile : null,
        phone: typeof body.phone === "string" ? body.phone : null,
        email: typeof body.email === "string" ? body.email : null,
        province: typeof body.province === "string" ? body.province : null,
        economicCode: typeof body.economicCode === "string" ? body.economicCode : null,
      };

      const nearby = await findDuplicateCandidates(candidate, user);

      // The narrowed set is scored by the same rules the client has always used,
      // so server and client can never disagree about what counts as a duplicate.
      const matches = findCustomerDuplicates(
        candidate as CustomerCandidate,
        nearby as unknown as Customer[],
      );

      res.json({
        success: true,
        matches: matches.map((m) => ({
          customer: m.customer,
          severity: m.severity,
          primaryField: m.primaryField,
          reason: m.reason,
        })),
        hasHardDuplicate: hasHardDuplicate(matches),
      });
    } catch (err) {
      sendError(res, err, "POST /api/customers/check-duplicates");
    }
  });

  app.post("/api/customers", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
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
        getTodayShamsi(),
      );
      res.status(201).json({ success: true, customer });
    } catch (err) {
      sendError(res, err, "POST /api/customers");
    }
  });

  app.put("/api/customers/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const customer = await updateCustomer(req.params.id, pickInput(req.body), user, getTodayShamsi());
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
   * Replaces this customer's links. Symmetric: both directions are written, so
   * the link shows from either side.
   */
  app.put("/api/customers/:id/links", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const raw = (req.body as { linkedIds?: unknown })?.linkedIds;
      if (!Array.isArray(raw)) {
        res.status(400).json({ success: false, error: "فهرست ارتباطات نامعتبر است." });
        return;
      }
      const linkedIds = raw.filter((v): v is string => typeof v === "string");

      const outcome = await setCustomerLinks(req.params.id, linkedIds, user);
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این مشتری را ندارید." });
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "مشتری یافت نشد." });
        return;
      }
      res.json({ success: true, customer: await getCustomer(req.params.id, user) });
    } catch (err) {
      sendError(res, err, "PUT /api/customers/:id/links");
    }
  });

  /** Replaces this customer's per-module agreement texts. */
  app.put("/api/customers/:id/agreements", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const raw = (req.body as { agreements?: unknown })?.agreements;
      if (!Array.isArray(raw)) {
        res.status(400).json({ success: false, error: "فهرست توافق‌ها نامعتبر است." });
        return;
      }

      const agreements = raw.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        return {
          moduleName: typeof e.moduleName === "string" ? e.moduleName : "",
          text: typeof e.text === "string" ? e.text : "",
          createdBy: typeof e.createdBy === "string" ? e.createdBy : null,
        };
      });

      const outcome = await setCustomerAgreements(req.params.id, agreements, user);
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این مشتری را ندارید." });
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "مشتری یافت نشد." });
        return;
      }
      res.json({ success: true, customer: await getCustomer(req.params.id, user) });
    } catch (err) {
      sendError(res, err, "PUT /api/customers/:id/agreements");
    }
  });

  /**
   * Delete. `?replaceWith=<id>` moves every dependent record to the replacement
   * first; without it, a customer that has history is refused rather than
   * silently orphaning (or cascading away) that history.
   */
  app.delete("/api/customers/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
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

      const ok = await deleteCustomer(id, user, getTodayShamsi());
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
