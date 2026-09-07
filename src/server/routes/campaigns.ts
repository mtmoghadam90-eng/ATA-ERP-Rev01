import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { CUSTOMER_QUERY_KEYS } from "../services/customerService";
import { sanitizeSegmentQuery } from "../../utils/campaigns";
import {
  CAMPAIGN_FILTERABLE, CAMPAIGN_SORTABLE, CampaignInput, SegmentInput,
  cancelCampaign, createSegment, deleteCampaign, deleteSegment, getCampaign,
  listCampaigns, listSegments, previewSegment, saveCampaign, segmentQueryOf,
  sendCampaign, updateSegment,
} from "../services/messaging/campaignService";

/**
 * Segments and campaigns REST API.
 *
 * Everything here is gated by the messaging module's own key. A segment
 * *resolves* against the customers table, but no separate customers permission
 * is checked and none is needed: `buildCustomerWhere` applies the caller's own
 * `visibilityClause`, so somebody who may see only their own customers previews
 * and addresses only their own customers, with nothing extra written to make
 * that true.
 *
 * The literal-path routes are registered before their `/:id` neighbours, or
 * Express answers 404 for a segment whose id is the word «preview».
 */

const KEY = "erp_messaging";

const SEGMENT_WRITABLE: (keyof SegmentInput)[] = ["name", "description", "query"];
const CAMPAIGN_WRITABLE: (keyof CampaignInput)[] = [
  "name", "segmentId", "channel", "templateId", "subject", "body",
  "scheduledDate", "scheduledTime",
];

function pick<T>(body: unknown, allowed: (keyof T)[]): T {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if ((key as string) in src) out[key as string] = src[key as string];
  }
  return out as T;
}

export function registerCampaignRoutes(app: express.Express, deps: RouteDeps): void {
  /* ------------------------------- segments ------------------------------ */

  app.get("/api/messaging/segments", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, segments: await listSegments(user) });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/segments");
    }
  });

  /**
   * How many customers a query matches, and a few of them.
   *
   * A POST because the body is the query, and because a preview of an unsaved
   * segment is the whole point — somebody builds the filters, sees the count,
   * and only then decides whether it is worth saving. Registered ahead of
   * `/segments/:id`.
   */
  app.post("/api/messaging/segments/preview", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as { query?: unknown; segmentId?: unknown };
      const query = typeof body.segmentId === "string" && body.segmentId
        ? await segmentQueryOf(body.segmentId)
        : sanitizeSegmentQuery(body.query, CUSTOMER_QUERY_KEYS);

      if (!query) {
        res.status(404).json({ success: false, error: "سگمنت یافت نشد." });
        return;
      }
      res.json({ success: true, preview: await previewSegment(query, user) });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/segments/preview");
    }
  });

  app.post("/api/messaging/segments", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const { segment, refusal } = await createSegment(pick(req.body, SEGMENT_WRITABLE), user);
      if (refusal) {
        res.status(400).json({ success: false, error: refusal });
        return;
      }
      res.status(201).json({ success: true, segment });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/segments");
    }
  });

  app.put("/api/messaging/segments/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const { segment, refusal } = await updateSegment(
        req.params.id, pick(req.body, SEGMENT_WRITABLE), user,
      );
      if (refusal) {
        res.status(400).json({ success: false, error: refusal });
        return;
      }
      res.json({ success: true, segment });
    } catch (err) {
      sendError(res, err, "PUT /api/messaging/segments/:id");
    }
  });

  app.delete("/api/messaging/segments/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const { ok, refusal } = await deleteSegment(req.params.id);
      if (!ok) {
        res.status(409).json({ success: false, error: refusal });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/messaging/segments/:id");
    }
  });

  /* ------------------------------- campaigns ----------------------------- */

  app.get("/api/messaging/campaigns", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(
        req.query as Record<string, unknown>, CAMPAIGN_SORTABLE, CAMPAIGN_FILTERABLE,
      );
      res.json({ success: true, ...await listCampaigns(q) });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/campaigns");
    }
  });

  app.get("/api/messaging/campaigns/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const campaign = await getCampaign(req.params.id);
      if (!campaign) {
        res.status(404).json({ success: false, error: "کمپین یافت نشد." });
        return;
      }
      res.json({ success: true, campaign });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/campaigns/:id");
    }
  });

  app.post("/api/messaging/campaigns", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const { campaign, refusal } = await saveCampaign(
        null, pick(req.body, CAMPAIGN_WRITABLE), user,
      );
      if (refusal) {
        res.status(400).json({ success: false, error: refusal });
        return;
      }
      res.status(201).json({ success: true, campaign });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/campaigns");
    }
  });

  app.put("/api/messaging/campaigns/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const { campaign, refusal } = await saveCampaign(
        req.params.id, pick(req.body, CAMPAIGN_WRITABLE), user,
      );
      if (refusal) {
        res.status(400).json({ success: false, error: refusal });
        return;
      }
      res.json({ success: true, campaign });
    } catch (err) {
      sendError(res, err, "PUT /api/messaging/campaigns/:id");
    }
  });

  /**
   * Queues the campaign's messages.
   *
   * A separate call from saving, and pressed after the recipient count and a
   * rendered sample have been read — writing to a hundred customers is not
   * something a form submit should do as a side effect. It is safe to press
   * twice: the unique index on (campaignId, customerId) makes the second pass
   * skip everybody who already has a row, which is also what makes an
   * interrupted send finishable by pressing it again.
   */
  app.post("/api/messaging/campaigns/:id/send", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const result = await sendCampaign(req.params.id, user);
      if (result.refusal) {
        res.status(400).json({ success: false, error: result.refusal });
        return;
      }
      res.json({ success: true, result });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/campaigns/:id/send");
    }
  });

  app.post("/api/messaging/campaigns/:id/cancel", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      res.json({ success: true, ...await cancelCampaign(req.params.id) });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/campaigns/:id/cancel");
    }
  });

  app.delete("/api/messaging/campaigns/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const { ok, refusal } = await deleteCampaign(req.params.id);
      if (!ok) {
        res.status(409).json({ success: false, error: refusal });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/messaging/campaigns/:id");
    }
  });
}
