import express from "express";
import { RouteDeps, sendError } from "./types";
import {
  getWebRfqConfig, listWebRfqImports, retryWebRfqImport,
  saveWebRfqConfig, syncWebRfqs, webRfqReport,
} from "../services/webRfqService";
import { WebRfqSourceId, isWebRfqSource } from "../../utils/webRfq";

/**
 * The website's price-request feeds, from the settings screen.
 *
 * Everything here is gated on `settings` in both directions — the token is a
 * credential and the log names customers — and the token itself never leaves
 * the server: `getWebRfqConfig` answers a masked hint, and a blank token on
 * save means «unchanged», which is the rule every stored secret here follows.
 *
 * The report travels with the configuration rather than being asked for
 * separately, because **the failure mode of a poller is silence**: a feed that
 * stopped answering looks exactly like a quiet week, and the panel has to be
 * able to tell somebody which it is.
 *
 * **The source is a path segment, and an unknown one is refused.** There is one
 * configuration row per plugin and the row's id *is* the source, so a request
 * naming a source this build does not know would otherwise create a
 * configuration under it — a card nothing draws, polling nothing, which is the
 * silent kind of nothing.
 */
export function registerWebRfqRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_web_rfq";

  /** The source named in the path, or 400 and nothing written. */
  const sourceOf = (req: express.Request, res: express.Response): WebRfqSourceId | null => {
    const raw = String(req.params.source ?? "");
    if (!isWebRfqSource(raw)) {
      res.status(400).json({ success: false, error: "منبع استعلام نامعتبر است." });
      return null;
    }
    return raw;
  };

  /*
   * Registered **before** the `:source` routes below, or `/api/web-rfq/imports`
   * would be read as a source named «imports» — the trap `/api/products/:id`
   * and `/api/competitors/:id` were each corrected for. The retry names no
   * source on purpose: the import row carries its own, and a retry addressed
   * to the wrong feed would report success having polled the wrong plugin.
   */
  app.post("/api/web-rfq/imports/:id/retry", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const source = await retryWebRfqImport(String(req.params.id));
      if (!source) {
        res.status(400).json({ success: false, error: "این درخواست ناموفق نیست یا وجود ندارد." });
        return;
      }
      // Armed, then run: the retry reads the stored payload, so it needs
      // nothing from the site and works for a request that has long since
      // fallen outside the window a poll asks for.
      const imported = await syncWebRfqs(source);
      res.json({ success: true, source, imported, report: webRfqReport(source) });
    } catch (err) {
      sendError(res, err, "POST /api/web-rfq/imports/:id/retry");
    }
  });

  app.get("/api/web-rfq/:source/config", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    const source = sourceOf(req, res);
    if (!source) return;
    try {
      res.json({ success: true, config: await getWebRfqConfig(source), report: webRfqReport(source) });
    } catch (err) {
      sendError(res, err, "GET /api/web-rfq/:source/config");
    }
  });

  app.put("/api/web-rfq/:source/config", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    const source = sourceOf(req, res);
    if (!source) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const refusal = await saveWebRfqConfig(source, {
        feedUrl: body.feedUrl === undefined ? undefined : String(body.feedUrl ?? ""),
        token: body.token === undefined ? undefined : String(body.token ?? ""),
        active: body.active === undefined ? undefined : body.active === true,
        ownerUserId: body.ownerUserId === undefined
          ? undefined
          : (body.ownerUserId ? String(body.ownerUserId) : null),
        /*
         * Null is «draw the line again on the next poll» and zero is «import
         * everything» — two different answers, so a falsy check here would
         * silently turn the first into the second and pull in the whole of the
         * site's history, which is the one thing the line exists to prevent.
         */
        startAfterId: body.startAfterId === undefined
          ? undefined
          : (body.startAfterId === null ? null : Number(body.startAfterId)),
      });
      if (refusal) {
        res.status(400).json({ success: false, error: refusal });
        return;
      }
      res.json({ success: true, config: await getWebRfqConfig(source), report: webRfqReport(source) });
    } catch (err) {
      sendError(res, err, "PUT /api/web-rfq/:source/config");
    }
  });

  /*
   * «همگام‌سازی حالا». The timer is the mechanism and this is the button beside
   * it, the shape the exchange rates already take: somebody who has just filled
   * the panel in should not have to wait five minutes to learn whether the
   * address and the token are right.
   */
  app.post("/api/web-rfq/:source/sync", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    const source = sourceOf(req, res);
    if (!source) return;
    try {
      const imported = await syncWebRfqs(source);
      res.json({ success: true, imported, report: webRfqReport(source) });
    } catch (err) {
      sendError(res, err, "POST /api/web-rfq/:source/sync");
    }
  });

  app.get("/api/web-rfq/:source/imports", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    const source = sourceOf(req, res);
    if (!source) return;
    try {
      res.json({ success: true, imports: await listWebRfqImports(source, 50) });
    } catch (err) {
      sendError(res, err, "GET /api/web-rfq/:source/imports");
    }
  });
}
