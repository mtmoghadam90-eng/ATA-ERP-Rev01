import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import {
  USER_FILTERABLE, USER_SORTABLE, UserInput,
  countUserReferences, createUser, getUser, listUsers, removeUser, setPassword, updateUser,
} from "../services/userService";

/**
 * User accounts REST API.
 *
 * Reading is open to any authenticated caller but returns only a name directory
 * unless they hold the `users` permission — the assignment pickers throughout the
 * app need names, and nobody else needs anyone's permission map. Passwords are
 * write-only and never appear in a response.
 */

const WRITABLE: (keyof UserInput)[] = [
  "username", "fullName", "role", "isSystemAdmin", "position",
  "signatureImage", "isActive", "permissions",
];

function pickInput(body: unknown): UserInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as UserInput;
}

const denied = (res: express.Response) =>
  res.status(403).json({ success: false, error: "شما اجازه مدیریت کاربران را ندارید." });

/** A password floor, so an account cannot be created with something trivial. */
const MIN_PASSWORD_LENGTH = 6;

export function registerUserRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_users";

  app.get("/api/users", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, USER_SORTABLE, USER_FILTERABLE);
      res.json({ success: true, ...(await listUsers(q, user)) });
    } catch (err) {
      sendError(res, err, "GET /api/users");
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const found = await getUser(req.params.id, user);
      if (!found) {
        res.status(404).json({ success: false, error: "کاربر یافت نشد." });
        return;
      }
      res.json({ success: true, user: found });
    } catch (err) {
      sendError(res, err, "GET /api/users/:id");
    }
  });

  app.get("/api/users/:id/references", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      res.json({ success: true, references: await countUserReferences(req.params.id) });
    } catch (err) {
      sendError(res, err, "GET /api/users/:id/references");
    }
  });

  app.post("/api/users", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = pickInput(body);
      const password = typeof body.password === "string" ? body.password : "";

      if (!input.username || !String(input.username).trim()) {
        res.status(400).json({ success: false, error: "نام کاربری الزامی است." });
        return;
      }
      if (!input.fullName || !String(input.fullName).trim()) {
        res.status(400).json({ success: false, error: "نام و نام خانوادگی الزامی است." });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({
          success: false,
          error: `رمز عبور باید حداقل ${MIN_PASSWORD_LENGTH} کاراکتر باشد.`,
        });
        return;
      }

      const outcome = await createUser(input, password, user);
      if (outcome === "forbidden") return denied(res);
      res.status(201).json({ success: true, user: outcome.user });
    } catch (err) {
      sendError(res, err, "POST /api/users");
    }
  });

  app.put("/api/users/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await updateUser(req.params.id, pickInput(req.body), user);
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "کاربر یافت نشد." });
        return;
      }
      if (outcome === "last-admin") {
        res.status(409).json({
          success: false,
          code: "LAST_ADMIN",
          error: "این تنها مدیر سیستم فعال است؛ ابتدا مدیر دیگری تعریف کنید.",
        });
        return;
      }
      res.json({ success: true, user: outcome.user });
    } catch (err) {
      sendError(res, err, "PUT /api/users/:id");
    }
  });

  /**
   * Sets a password. An administrator may reset anyone's; a user changes their
   * own by proving the current one. Either way every existing session for that
   * account is invalidated.
   */
  app.post("/api/users/:id/password", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : undefined;

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({
          success: false,
          error: `رمز عبور باید حداقل ${MIN_PASSWORD_LENGTH} کاراکتر باشد.`,
        });
        return;
      }

      const outcome = await setPassword(req.params.id, newPassword, user, currentPassword);
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "کاربر یافت نشد." });
        return;
      }
      if (outcome === "wrong-password") {
        res.status(400).json({ success: false, error: "رمز عبور فعلی نادرست است." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "POST /api/users/:id/password");
    }
  });

  /** Deactivates an account that owns records; deletes one that does not. */
  app.delete("/api/users/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await removeUser(req.params.id, user);
      if (outcome === "forbidden") return denied(res);
      if (outcome === "self") {
        res.status(409).json({ success: false, code: "SELF", error: "حساب خودتان را نمی‌توانید حذف کنید." });
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "کاربر یافت نشد." });
        return;
      }
      if (outcome === "last-admin") {
        res.status(409).json({
          success: false,
          code: "LAST_ADMIN",
          error: "این تنها مدیر سیستم فعال است؛ ابتدا مدیر دیگری تعریف کنید.",
        });
        return;
      }
      res.json({
        success: true,
        deactivated: outcome === "deactivated",
        message: outcome === "deactivated"
          ? "این کاربر سابقه ثبت‌شده دارد، بنابراین به‌جای حذف غیرفعال شد و دسترسی‌اش قطع گردید."
          : "کاربر حذف شد.",
      });
    } catch (err) {
      sendError(res, err, "DELETE /api/users/:id");
    }
  });
}
