import type express from "express";
import type { AuthUser, AccessMode } from "../auth";

/**
 * What a route module needs from the host server.
 *
 * The auth helpers are closures over the session secret and the user store in
 * `server.ts`, so they are passed in rather than re-implemented here — one
 * definition of "who is this and may they" for the whole API.
 */
export interface RouteDeps {
  requireAuth(req: express.Request, res: express.Response): Promise<AuthUser | null>;
  requireKeyAccess(
    req: express.Request,
    res: express.Response,
    key: string,
    mode: AccessMode,
  ): Promise<AuthUser | null>;
  /**
   * Issues a fresh session cookie for a user whose `sessionEpoch` has just
   * moved.
   *
   * Bumping the epoch is how a password change or a permission change ends the
   * sessions already issued — which is right for every device except the one
   * making the change. Without this, changing your own password signed you out
   * of the browser you did it in, and the next request came back "your session
   * has expired" over an operation that had in fact succeeded.
   *
   * Only ever called for the authenticated caller, on their own account.
   */
  reissueSession(res: express.Response, userId: string, epoch: number): void;
}

/**
 * Turns a thrown error into a response.
 *
 * Prisma's messages name tables, columns and constraints; they help us but they
 * are not for users, so the detail goes to the log and the client gets a plain
 * Persian sentence — except for the constraint violations we can explain.
 */
export function sendError(res: express.Response, err: unknown, context: string): void {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message || String(err);

  // The code first, on the same line: it is one word, it is often the whole
  // answer (P2003 is a foreign key, 207 is an unknown column), and a Prisma
  // message begins with a newline — so anything after it lands further down.
  console.error(`[api] ${context}:`, code ? `[${code}]` : "", message);

  if (code === "P2002") {
    res.status(409).json({
      success: false,
      error: "این مقدار قبلاً ثبت شده است و تکراری است.",
      code: "DUPLICATE",
    });
    return;
  }
  if (code === "P2003" || code === "P2014") {
    res.status(409).json({
      success: false,
      error: "این رکورد به رکوردهای دیگری وابسته است و قابل حذف نیست.",
      code: "IN_USE",
    });
    return;
  }
  if (code === "P2025") {
    res.status(404).json({ success: false, error: "رکورد یافت نشد.", code: "NOT_FOUND" });
    return;
  }
  if (code === "P1001" || code === "P1002" || code === "P1000") {
    res.status(503).json({
      success: false,
      error: "اتصال به بانک اطلاعاتی برقرار نشد.",
      code: "DB_UNAVAILABLE",
    });
    return;
  }

  // Errors we raised deliberately carry a Persian message already.
  const isOurs = /[؀-ۿ]/.test(message);
  res.status(isOurs ? 400 : 500).json({
    success: false,
    error: isOurs ? message : "خطای غیرمنتظره در پردازش درخواست.",
  });
}
