import express from "express";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import {
  AdCampaignInput, createAdCampaign, deleteAdCampaign, importAdCampaigns,
  listAdCampaigns, updateAdCampaign,
} from "../services/adCampaignService";

/**
 * «اثربخشی تبلیغات». Gated by `erp_ad_campaigns` → the strict
 * `adEffectiveness` flag, both here and inside the service.
 */
const WRITABLE: (keyof AdCampaignInput)[] = [
  "code", "runDate", "channel", "topic", "audience", "audienceSize", "directCost",
  "responses", "leads", "sales", "revenue", "quality", "notes",
];

const pick = (body: unknown): AdCampaignInput => {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) if (key in src) out[key] = src[key];
  return out as AdCampaignInput;
};

const DENIED = "این بخش فقط برای کاربرانی باز است که دسترسی «اثربخشی تبلیغات» دارند.";

export function registerAdCampaignRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/ad-campaigns", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_ad_campaigns", "read");
    if (!user) return;
    try {
      const result = await listAdCampaigns(
        { from: req.query.from, to: req.query.to, channel: req.query.channel, audience: req.query.audience },
        user,
      );
      if (result === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/ad-campaigns");
    }
  });

  // Registered before `/:id` so «import» is not read as an id.
  app.post("/api/ad-campaigns/import", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_ad_campaigns", "write");
    if (!user) return;
    try {
      const rows = Array.isArray((req.body as { rows?: unknown })?.rows)
        ? ((req.body as { rows: unknown[] }).rows).map(pick)
        : [];
      const result = await importAdCampaigns(rows, user, getTodayShamsi());
      if (result === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "POST /api/ad-campaigns/import");
    }
  });

  app.post("/api/ad-campaigns", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_ad_campaigns", "write");
    if (!user) return;
    try {
      const outcome = await createAdCampaign(pick(req.body), user, getTodayShamsi());
      if (outcome === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      if ("error" in outcome) { res.status(400).json({ success: false, error: outcome.error }); return; }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/ad-campaigns");
    }
  });

  app.put("/api/ad-campaigns/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_ad_campaigns", "write");
    if (!user) return;
    try {
      const outcome = await updateAdCampaign(req.params.id, pick(req.body), user, getTodayShamsi());
      if (outcome === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      if (outcome === null) { res.status(404).json({ success: false, error: "کمپین یافت نشد." }); return; }
      if ("error" in outcome) { res.status(400).json({ success: false, error: outcome.error }); return; }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "PUT /api/ad-campaigns/:id");
    }
  });

  app.delete("/api/ad-campaigns/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_ad_campaigns", "write");
    if (!user) return;
    try {
      const outcome = await deleteAdCampaign(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      if (!outcome) { res.status(404).json({ success: false, error: "کمپین یافت نشد." }); return; }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/ad-campaigns/:id");
    }
  });
}
