import express from "express";
import { RouteDeps, sendError } from "./types";
import { AuthUser, hasPermission } from "../auth";
import {
  askAssistant, clearApiKey, loadApiKey, loadAssistantConfig, maskKey,
  saveApiKey, testAssistant,
} from "../services/assistant/assistantService";
import { assistantTools } from "../services/assistant/tools";
import {
  actionCatalogue, cancelProposal, confirmProposal,
} from "../services/assistant/actions";
import { getTodayShamsi } from "../../dateUtils";

/**
 * The dashboard assistant.
 *
 * Two permission levels. Asking it something needs `assistant`, which is its
 * own flag precisely so it can be withheld from somebody who has the dashboard
 * — it can read every figure in the company that its user is allowed to see,
 * and that is not the same decision as "may open the front page". Configuring
 * it needs `settings`, like every other system-wide switch.
 *
 * **The API key never leaves this process.** The config endpoint answers with a
 * masked hint, and a save that omits the key keeps the stored one.
 */

/**
 * Read strictly: an absent flag denies.
 *
 * `hasPermission` treats a missing key as granted, which is right for the
 * modules that predate the permission list — but a feature that can read the
 * whole company's finances must not switch itself on for every account written
 * before it existed. A system administrator always has it.
 */
export function canUseAssistant(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isSystemAdmin) return true;
  return (user.permissions as Record<string, unknown> | undefined)?.assistant === true;
}

export function registerAssistantRoutes(app: express.Express, deps: RouteDeps): void {
  const requireAssistant = async (req: express.Request, res: express.Response) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return null;
    if (!canUseAssistant(user)) {
      res.status(403).json({ success: false, error: "دسترسی به دستیار هوش مصنوعی برای شما فعال نیست." });
      return null;
    }
    return user;
  };

  const requireSettings = async (req: express.Request, res: express.Response) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return null;
    if (!hasPermission(user, "settings")) {
      res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
      return null;
    }
    return user;
  };

  /** Whether the panel should be drawn at all, and why not when it should not. */
  app.get("/api/assistant/status", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const config = await loadAssistantConfig();
      res.json({
        success: true,
        allowed: canUseAssistant(user),
        enabled: config.enabled,
        configured: !!(await loadApiKey()),
        actionsAllowed: config.allowActions,
      });
    } catch (err) {
      sendError(res, err, "GET /api/assistant/status");
    }
  });

  app.post("/api/assistant/chat", async (req, res) => {
    const user = await requireAssistant(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as { messages?: unknown };
      const raw = Array.isArray(body.messages) ? body.messages : [];
      const history = raw
        .map((entry) => entry as { role?: unknown; content?: unknown })
        .filter((entry) => entry.role === "user" || entry.role === "assistant")
        .map((entry) => ({
          role: entry.role as "user" | "assistant",
          content: String(entry.content ?? "").slice(0, 8000),
        }))
        .filter((entry) => entry.content.trim() !== "");

      if (history.length === 0) {
        res.status(400).json({ success: false, error: "پیامی برای دستیار فرستاده نشد." });
        return;
      }

      res.json({ success: true, ...(await askAssistant(history, user)) });
    } catch (err) {
      sendError(res, err, "POST /api/assistant/chat");
    }
  });

  /* -------------------------------- actions ------------------------------- */

  /**
   * Confirming is where a write finally happens.
   *
   * Everything that decides whether it may happen is asked again here, against
   * the stored proposal: the assistant permission, the settings switch, the
   * module's own write permission, whose proposal it is, and whether it has
   * gone stale. The browser sends an id and nothing else — the payload it would
   * otherwise be able to edit never left the server.
   */
  app.post("/api/assistant/actions/:id/confirm", async (req, res) => {
    const user = await requireAssistant(req, res);
    if (!user) return;
    try {
      const config = await loadAssistantConfig();
      const result = await confirmProposal(
        req.params.id, { user, todayJalali: getTodayShamsi() }, config.allowActions,
      );
      if ("error" in result) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, proposal: result });
    } catch (err) {
      sendError(res, err, "POST /api/assistant/actions/:id/confirm");
    }
  });

  app.post("/api/assistant/actions/:id/cancel", async (req, res) => {
    const user = await requireAssistant(req, res);
    if (!user) return;
    try {
      const result = await cancelProposal(req.params.id, user);
      if ("error" in result) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, proposal: result });
    } catch (err) {
      sendError(res, err, "POST /api/assistant/actions/:id/cancel");
    }
  });

  /* ------------------------------- settings ------------------------------ */

  app.get("/api/assistant/config", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const config = await loadAssistantConfig();
      res.json({
        success: true,
        config,
        apiKeyHint: maskKey(await loadApiKey()),
        // Listed so whoever writes the house instructions can see what the
        // assistant is actually able to look at.
        tools: assistantTools().map((tool) => ({
          name: tool.definition.name,
          description: tool.definition.description,
        })),
        // What switching «ثبت با تایید» on actually permits, so the decision is
        // made against a list rather than against a checkbox label.
        actions: actionCatalogue(),
      });
    } catch (err) {
      sendError(res, err, "GET /api/assistant/config");
    }
  });

  /**
   * The key only. Everything else lives in the settings document and is saved
   * with the rest of the settings — one screen, one save button.
   */
  app.put("/api/assistant/key", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as { apiKey?: unknown; clear?: unknown };
      if (body.clear === true) {
        await clearApiKey();
      } else {
        await saveApiKey(typeof body.apiKey === "string" ? body.apiKey : null);
      }
      res.json({ success: true, apiKeyHint: maskKey(await loadApiKey()) });
    } catch (err) {
      sendError(res, err, "PUT /api/assistant/key");
    }
  });

  app.post("/api/assistant/test", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      res.json({ success: true, ...(await testAssistant()) });
    } catch (err) {
      sendError(res, err, "POST /api/assistant/test");
    }
  });
}
