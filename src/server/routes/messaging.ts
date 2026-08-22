import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { hasPermission } from "../auth";
import { isChannel } from "../../utils/messaging";
import {
  MESSAGE_FILTERABLE, MESSAGE_SORTABLE, ManualSendInput, TemplateInput,
  cancelMessage, createTemplate, deleteTemplate, listMessages, listProviders,
  listTemplates, messageSummary, messageVariables, processQueue, retryMessage,
  providerChats, saveProvider, sendManual, testProvider, updateTemplate,
} from "../services/messaging/messageService";

/**
 * Messaging REST API.
 *
 * Two permission levels, and the split matters. Reading the outbox and sending
 * a message is ordinary work for whoever deals with customers, so it sits
 * behind the module's own key. Provider credentials are administration and sit
 * behind `settings` — the same flag that guards every other system-wide switch.
 *
 * **A provider's secrets never leave the server.** The list endpoint answers
 * with a masked hint, and a save that omits a secret keeps the stored one, so
 * there is no request and no response that could carry an API key to a browser.
 */

const KEY = "erp_messaging";

const TEMPLATE_WRITABLE: (keyof TemplateInput)[] = [
  "name", "channel", "subject", "body", "active",
];

const SEND_WRITABLE: (keyof ManualSendInput)[] = [
  "customerId", "projectId", "channel", "templateId",
  "subject", "body", "scheduledDate", "scheduledTime",
];

function pick<T>(body: unknown, allowed: (keyof T)[]): T {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if ((key as string) in src) out[key as string] = src[key as string];
  }
  return out as T;
}

export function registerMessagingRoutes(app: express.Express, deps: RouteDeps): void {
  /* ------------------------------ providers ----------------------------- */

  /** Administration, so `settings` rather than the module's own key. */
  const requireSettings = async (req: express.Request, res: express.Response) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return null;
    if (!hasPermission(user, "settings")) {
      res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
      return null;
    }
    return user;
  };

  app.get("/api/messaging/providers", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      res.json({ success: true, providers: await listProviders() });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/providers");
    }
  });

  app.put("/api/messaging/providers/:channel", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const channel = req.params.channel;
      if (!isChannel(channel)) {
        res.status(400).json({ success: false, error: "روش ارسال نامعتبر است." });
        return;
      }
      const body = (req.body ?? {}) as { active?: unknown; config?: unknown };
      await saveProvider(channel, {
        active: body.active === undefined ? undefined : !!body.active,
        config: body.config && typeof body.config === "object"
          ? body.config as Record<string, unknown>
          : undefined,
      });
      res.json({ success: true, providers: await listProviders() });
    } catch (err) {
      sendError(res, err, "PUT /api/messaging/providers/:channel");
    }
  });

  /**
   * Sends one message straight out to prove the credentials work.
   *
   * Not queued: the person is waiting to be told whether it works, and an
   * answer that arrives through the queue a minute later is no answer at all.
   */
  app.post("/api/messaging/providers/:channel/test", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const channel = req.params.channel;
      if (!isChannel(channel)) {
        res.status(400).json({ success: false, error: "روش ارسال نامعتبر است." });
        return;
      }
      const body = (req.body ?? {}) as { recipient?: unknown; body?: unknown };
      const recipient = String(body.recipient ?? "").trim();
      if (!recipient) {
        res.status(400).json({ success: false, error: "گیرنده پیام آزمایشی را وارد کنید." });
        return;
      }
      const result = await testProvider(
        channel,
        recipient,
        String(body.body ?? "").trim() || "پیام آزمایشی از سامانه ابزار تامین آرشیا.",
      );
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/providers/:channel/test");
    }
  });

  /**
   * The chats the bot has recently heard from, so their numeric ids can be
   * copied onto a customer.
   *
   * Bale addresses a person by a number they cannot read off their own screen
   * and that nothing here can derive, so without this the customer's Bale field
   * is unfillable in practice. Administration, hence `settings`: it reads
   * through the bot's credentials.
   */
  app.get("/api/messaging/providers/:channel/chats", async (req, res) => {
    const user = await requireSettings(req, res);
    if (!user) return;
    try {
      const channel = req.params.channel;
      if (!isChannel(channel)) {
        res.status(400).json({ success: false, error: "روش ارسال نامعتبر است." });
        return;
      }
      res.json({ success: true, ...(await providerChats(channel)) });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/providers/:channel/chats");
    }
  });

  /* ------------------------------ templates ----------------------------- */

  /**
   * Readable by whoever administers the system as well as by the messaging
   * module's own users.
   *
   * The workflow rule editor lives in the settings screen and now picks a
   * template rather than carrying its own text; somebody configuring
   * automation without the messaging permission would otherwise be shown an
   * empty list and no way to fill it. Reading a template's wording is not a
   * privilege worth separating from `settings`, which already edits the rules
   * that send it.
   */
  app.get("/api/messaging/templates", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    if (!hasPermission(user, "messaging") && !hasPermission(user, "settings")) {
      res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
      return;
    }
    try {
      res.json({ success: true, templates: await listTemplates() });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/templates");
    }
  });

  app.post("/api/messaging/templates", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const template = await createTemplate(pick<TemplateInput>(req.body, TEMPLATE_WRITABLE));
      res.status(201).json({ success: true, template });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/templates");
    }
  });

  app.put("/api/messaging/templates/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const template = await updateTemplate(
        req.params.id,
        pick<TemplateInput>(req.body, TEMPLATE_WRITABLE),
      );
      res.json({ success: true, template });
    } catch (err) {
      sendError(res, err, "PUT /api/messaging/templates/:id");
    }
  });

  app.delete("/api/messaging/templates/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      await deleteTemplate(req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/messaging/templates/:id");
    }
  });

  /* ------------------------------- variables ---------------------------- */

  /**
   * What a template can say about this customer and project.
   *
   * Resolved on the server because the values come from records the browser has
   * not loaded, and because the preview must use the same substitution the send
   * will — a preview built from a different source is a preview of nothing.
   */
  app.get("/api/messaging/variables", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const values = await messageVariables(
        typeof req.query.customerId === "string" ? req.query.customerId : null,
        typeof req.query.projectId === "string" ? req.query.projectId : null,
      );
      res.json({ success: true, variables: values });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/variables");
    }
  });

  /* -------------------------------- outbox ------------------------------ */

  /**
   * Registered ahead of `/api/messaging/messages/:id/...`, so "summary" is not
   * matched as an id.
   */
  app.get("/api/messaging/summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, summary: await messageSummary() });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/summary");
    }
  });

  app.get("/api/messaging/messages", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(
        req.query as Record<string, unknown>,
        MESSAGE_SORTABLE,
        MESSAGE_FILTERABLE,
      );
      const result = await listMessages(q, {
        status: req.query.status,
        channel: req.query.channel,
        customerId: req.query.customerId,
        projectId: req.query.projectId,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/messaging/messages");
    }
  });

  app.post("/api/messaging/send", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const result = await sendManual(pick<ManualSendInput>(req.body, SEND_WRITABLE), user);
      if (!result.queued) {
        // A refusal to send is an answer about the data, not a server fault:
        // "this customer opted out" needs to reach the user as their own words.
        res.status(400).json({ success: false, error: result.reason ?? "ارسال پیام ممکن نشد." });
        return;
      }
      res.status(201).json({ success: true, messageId: result.messageId });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/send");
    }
  });

  app.post("/api/messaging/messages/:id/cancel", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const cancelled = await cancelMessage(req.params.id);
      if (!cancelled) {
        res.status(409).json({ success: false, error: "این پیام دیگر در صف ارسال نیست." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/messages/:id/cancel");
    }
  });

  app.post("/api/messaging/messages/:id/retry", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const queued = await retryMessage(req.params.id);
      if (!queued) {
        res.status(409).json({ success: false, error: "فقط پیام‌های ناموفق قابل ارسال مجدد هستند." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/messages/:id/retry");
    }
  });

  /** The manual equivalent of the worker's tick, for when somebody is waiting. */
  app.post("/api/messaging/run-queue", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      res.json({ success: true, ...(await processQueue()) });
    } catch (err) {
      sendError(res, err, "POST /api/messaging/run-queue");
    }
  });
}
