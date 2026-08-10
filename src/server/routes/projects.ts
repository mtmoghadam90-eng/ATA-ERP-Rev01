import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { getDb } from "../db";
import { nextDocumentNumber } from "../documentNumbers";
import {
  PROJECT_FILTERABLE, PROJECT_SORTABLE, ProjectInput,
  countProjectReferences, createProject, deleteProject, getProject,
  listProjects, listProjectStatuses, projectSummary, updateProject,
} from "../services/projectService";
import { DOCUMENT_FOLDERS, listProjectDocuments } from "../services/projectDocuments";
import { findMissingExchangeRates, summarizeProjectFinance } from "../services/projectFinance";
import { getTodayShamsi } from "../../dateUtils";

/**
 * Projects REST API. Follows the customers pattern: paginated reads, a picked
 * body, module permission here and record-level visibility in the service.
 *
 * Projects add nested grids — requested items and milestones — which are sent
 * with the parent and written in the same transaction.
 */

const WRITABLE: (keyof ProjectInput)[] = [
  "code", "name", "customerId", "status", "lossReason", "description",
  "estimatedValueRial", "probabilityPercent", "marketingChannel", "leadQuality",
  "referrerName", "communicationMethod", "customerInquiryNumber",
  "salesExpert", "financialContact", "technicalContact", "endUser",
  "ownerUserId", "endUserCustomerId", "financialContactId", "technicalContactId",
  "attachments", "manualDocuments", "milestoneRules", "customValues",
  "creationDate", "opportunityDate", "expectedCloseDate",
  "winningDate", "agreedDeliveryDate", "closingDate",
  "items", "milestones",
];

function pickInput(body: unknown): ProjectInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as ProjectInput;
}

export function registerProjectRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_projects";

  app.get("/api/projects", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, PROJECT_SORTABLE, PROJECT_FILTERABLE);
      // Shamsi range bounds are separate from the equality filters.
      const result = await listProjects(q, user, {
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        customField: req.query.customField,
        // The derived figures are the grid's columns, but a picker listing
        // projects does not need them and they cost three extra queries.
        withSummary: req.query.withSummary !== "false",
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/projects");
    }
  });

  /**
   * Financial position per project: sold, received, remaining, settled.
   *
   * Takes the same list query as /api/projects, so the financial view pages
   * through the same result the grid does rather than pulling every project.
   */
  app.get("/api/projects/finance", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, PROJECT_SORTABLE, PROJECT_FILTERABLE);
      // The derived delivery figures are irrelevant here and cost three queries.
      const page = await listProjects(q, user, {
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        customField: req.query.customField,
        withSummary: false,
      });

      const finance = await summarizeProjectFinance(page.rows.map((row) => String(row.id)));
      res.json({
        success: true,
        ...page,
        rows: page.rows.map((row) => finance.get(String(row.id)) ?? row),
      });
    } catch (err) {
      sendError(res, err, "GET /api/projects/finance");
    }
  });

  /**
   * Documents whose exchange rate is missing, which makes a rial total
   * unknowable rather than merely smaller.
   */
  app.get("/api/projects/finance/missing-rates", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, ...(await findMissingExchangeRates()) });
    } catch (err) {
      sendError(res, err, "GET /api/projects/finance/missing-rates");
    }
  });

  /** Status counts and value totals, aggregated in SQL for the dashboard. */
  app.get("/api/projects/summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, summary: await projectSummary(user) });
    } catch (err) {
      sendError(res, err, "GET /api/projects/summary");
    }
  });

  /**
   * Ids and statuses only, for the client that watches a project being won.
   * Registered before /:id so the literal path is not read as an id.
   */
  app.get("/api/projects/statuses", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, projects: await listProjectStatuses(user) });
    } catch (err) {
      sendError(res, err, "GET /api/projects/statuses");
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const project = await getProject(req.params.id, user);
      if (!project) {
        res.status(404).json({ success: false, error: "پروژه یافت نشد." });
        return;
      }
      res.json({ success: true, project });
    } catch (err) {
      sendError(res, err, "GET /api/projects/:id");
    }
  });

  /**
   * The financial position of one project.
   *
   * `/api/projects/finance` answers the same question for a page of the grid,
   * but a caller that has just written a receipt needs the position of *that*
   * project and cannot assume it is on the page in hand — which is exactly the
   * mistake the migration exists to stop repeating. Visibility is checked
   * against the project first, because the finance summariser takes ids and
   * applies none.
   */
  app.get("/api/projects/:id/finance", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const project = await getProject(req.params.id, user);
      if (!project) {
        res.status(404).json({ success: false, error: "پروژه یافت نشد." });
        return;
      }
      const finance = (await summarizeProjectFinance([req.params.id])).get(req.params.id);
      if (!finance) {
        res.status(404).json({ success: false, error: "پروژه یافت نشد." });
        return;
      }
      res.json({ success: true, finance });
    } catch (err) {
      sendError(res, err, "GET /api/projects/:id/finance");
    }
  });

  /**
   * Every document attached to the project, grouped by folder. Fetched when the
   * documents tab is opened, not with the project — it touches seven tables.
   */
  app.get("/api/projects/:id/documents", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      // Visibility is checked against the project itself, since the documents
      // belong to it.
      const project = await getProject(req.params.id, user);
      if (!project) {
        res.status(404).json({ success: false, error: "پروژه یافت نشد." });
        return;
      }
      res.json({
        success: true,
        folders: DOCUMENT_FOLDERS,
        documents: await listProjectDocuments(req.params.id),
      });
    } catch (err) {
      sendError(res, err, "GET /api/projects/:id/documents");
    }
  });

  app.get("/api/projects/:id/references", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, references: await countProjectReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/projects/:id/references");
    }
  });

  app.post("/api/projects", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (!input.name || !String(input.name).trim()) {
        res.status(400).json({ success: false, error: "نام پروژه الزامی است." });
        return;
      }
      if (!input.customerId) {
        res.status(400).json({ success: false, error: "انتخاب مشتری الزامی است." });
        return;
      }
      if (!input.creationDate) {
        res.status(400).json({ success: false, error: "تاریخ ایجاد پروژه الزامی است." });
        return;
      }
      if (!input.status) input.status = "جدید";

      // Blank means "make one up" — see documentNumbers.ts.
      if (!input.code || !String(input.code).trim()) {
        const db = getDb();
        const customer = await db.customer.findUnique({
          where: { id: input.customerId }, select: { companyName: true },
        });
        input.code = await nextDocumentNumber({
          formatKey: "projectFormat", startSeqKey: "projectStartSeq",
          fallbackFormat: "ATA-{YYYY}-{SEQ:3}",
          count: () => db.project.count(),
          taken: async (v) => !!(await db.project.findUnique({ where: { code: v }, select: { id: true } })),
          context: { customerName: customer?.companyName },
        });
      }

      const project = await createProject(input, user, getTodayShamsi());
      res.status(201).json({ success: true, project });
    } catch (err) {
      sendError(res, err, "POST /api/projects");
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const project = await updateProject(req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (!project) {
        res.status(403).json({ success: false, error: "شما اجازه تغییر این پروژه را ندارید." });
        return;
      }
      res.json({ success: true, project });
    } catch (err) {
      sendError(res, err, "PUT /api/projects/:id");
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteProject(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه حذف این پروژه را ندارید." });
        return;
      }
      if (outcome === "in-use") {
        res.status(409).json({
          success: false,
          code: "IN_USE",
          error: "این پروژه اسناد وابسته دارد (پیش‌فاکتور، سفارش، تراکنش یا خدمات) و قابل حذف نیست.",
          references: await countProjectReferences(req.params.id),
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/projects/:id");
    }
  });
}
