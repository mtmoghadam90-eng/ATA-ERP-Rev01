import express from "express";
import { RouteDeps, sendError } from "./types";
import { hasPermission } from "../auth";
import { getTodayShamsi } from "../../dateUtils";
import {
  createToken, deleteToken, listTokens, revokeToken,
} from "../services/apiTokenService";

/**
 * Managing the credentials third-party integrations use.
 *
 * Gated on `settings`, like every other system-wide switch: issuing one hands
 * a named account's permissions to a program running somewhere else, and that
 * is an administrative decision rather than a personal one.
 *
 * These endpoints are also closed to token-authenticated callers — see
 * `pathClosedToTokens`. A credential that can mint credentials outlives every
 * decision anybody makes about it.
 */
export function registerApiTokenRoutes(app: express.Express, deps: RouteDeps): void {
  const requireSettings = async (req: express.Request, res: express.Response) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return null;
    if (!hasPermission(user, "settings")) {
      res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
      return null;
    }
    return user;
  };

  app.get("/api/api-tokens", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      res.json({ success: true, tokens: await listTokens() });
    } catch (err) {
      sendError(res, err, "GET /api/api-tokens");
    }
  });

  /**
   * The one response that carries a token.
   *
   * Only its hash is stored, so this is the only moment it can be copied. The
   * screen says so; a lost token is replaced, never recovered.
   */
  app.post("/api/api-tokens", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await createToken(
        {
          name: typeof body.name === "string" ? body.name : "",
          userId: typeof body.userId === "string" ? body.userId : null,
          scope: body.scope,
          expiresInDays: body.expiresInDays,
        },
        user,
        getTodayShamsi(),
      );
      if ("error" in result) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }
      res.status(201).json({ success: true, token: result.issued.token, created: result.summary });
    } catch (err) {
      sendError(res, err, "POST /api/api-tokens");
    }
  });

  /** Revoking keeps the row, so the audit trail still names what was used. */
  app.post("/api/api-tokens/:id/revoke", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const result = await revokeToken(req.params.id, user, getTodayShamsi());
      if ("error" in result) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, token: result });
    } catch (err) {
      sendError(res, err, "POST /api/api-tokens/:id/revoke");
    }
  });

  app.delete("/api/api-tokens/:id", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const result = await deleteToken(req.params.id, user, getTodayShamsi());
      if ("error" in result) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/api-tokens/:id");
    }
  });
}
