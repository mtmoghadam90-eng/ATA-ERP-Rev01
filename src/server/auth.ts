import crypto from "crypto";

/**
 * Server-side authentication and authorization.
 *
 * Before this existed the data API was completely open: anyone who could reach
 * the port could read every collection (including password hashes) and overwrite
 * it, and `user.permissions` was only ever checked in the browser. Everything
 * here runs on the server, which is the only place a permission check counts.
 *
 * Sessions are a signed cookie rather than server-held state, so a deploy restart
 * does not log everyone out. The user record is re-read on every request, so
 * permission changes and deletions take effect immediately, and bumping a user's
 * `sessionEpoch` invalidates their existing cookies.
 */

export const SESSION_COOKIE = "erp_session";
/** 12 hours — a work day, after which re-login is required. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionPayload {
  uid: string;
  /** Issued-at, epoch ms. */
  iat: number;
  /** Invalidation counter copied from the user record at sign time. */
  epoch: number;
}

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Signs a session payload as `<payload>.<hmac>`. */
export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

/**
 * Verifies a session cookie. Returns the payload, or null when the token is
 * malformed, tampered with, or expired.
 */
export function verifySession(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(mac);
  } catch {
    return null;
  }
  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== "string" || typeof payload.iat !== "number") {
    return null;
  }
  if (now - payload.iat > SESSION_TTL_MS) return null;
  return payload;
}

/**
 * Minimal directory of colleagues, for the "assign to…" pickers.
 *
 * Every user needs to name a task owner or referral recipient, but nobody needs
 * to see another account's permission map. This exposes only what those pickers
 * use, so restricted users keep working without the full records leaking.
 */
export function toUserDirectory<T extends Record<string, any>>(users: T[]): Record<string, any>[] {
  return (users || [])
    .filter((u) => u && typeof u === "object")
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      position: u.position ?? undefined,
    }));
}

/* --------------------------- authorization --------------------------- */

/** Which `user.permissions` flag guards each stored collection. */
export const KEY_PERMISSION: Record<string, string | null> = {
  erp_customers: "customers",
  erp_projects: "projects",
  erp_proformas: "proformas",
  erp_products: "products",
  erp_inventory_transactions: "products",
  erp_suppliers: "suppliers",
  erp_supplier_inquiries: "suppliers",
  erp_purchase_orders: "purchaseOrders",
  erp_transactions: "transactions",
  erp_tasks: "tasks",
  erp_packaging_deliveries: "packagingDelivery",
  erp_after_sales_services: "packagingDelivery",
  erp_project_category_groups: "projects",
  erp_messaging: "messaging",
  // Readable by everyone (as a name directory — see toUserDirectory); writing is
  // gated separately by USERS_WRITE_PERMISSION.
  erp_users: null,
  erp_audit_logs: "settings",
  // Reference data every authenticated user must be able to read.
  erp_settings: null,
  erp_exchange_rates: null,
};

/** Keys any authenticated user may read but only privileged users may write. */
const SETTINGS_WRITE_PERMISSION: Record<string, string> = {
  erp_settings: "settings",
  erp_exchange_rates: "settings",
  erp_users: "users",
};

/** True when the caller may see full user records rather than just the directory. */
export function canSeeFullUsers(user: AuthUser | null | undefined): boolean {
  return hasPermission(user, "users");
}

/**
 * True when the caller may see what the company pays — as opposed to what it
 * charges.
 *
 * The first permission here that is not a screen. Every other flag answers "may
 * this user open this module"; this one answers "may this user see these fields
 * inside modules they already have". Warehouse staff need the inventory screen
 * and the sale price, and must not learn the purchase price.
 *
 * What it covers, and why those three and not others, is in
 * `src/server/costs.ts`.
 */
export function canSeeCosts(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isSystemAdmin) return true;
  // Deliberately *not* `hasPermission`, which reads an absent key as granted —
  // the right default for module flags that predate every stored account, and
  // the wrong one for a new flag guarding money. Absent means denied here, so
  // nobody is quietly given access by a permissions object written before this
  // existed. The cost is that it must be granted explicitly after deployment.
  return user.permissions?.costs === true;
}

/**
 * May this user see the whole company's tasks, rather than their own?
 *
 * Read **strictly**, like `canSeeCosts` and unlike every module flag: an absent
 * value denies. That is the whole point — the board used to show everybody
 * everything because `hasPermission` reads an absent key as granted, and every
 * account has the `tasks` module because everybody needs to see their own work.
 * A flag that inherits the same default would reproduce the fault on the day it
 * shipped.
 *
 * So it must be granted deliberately, per account, in Settings → کاربران. A
 * sales manager can have it without being made a system administrator.
 */
export function canSeeAllTasks(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isSystemAdmin) return true;
  return user.permissions?.tasksAll === true;
}

export interface AuthUser {
  id: string;
  username?: string;
  /** Shown by the UI, which greets the user and prints their initials. */
  fullName?: string;
  position?: string;
  role?: string;
  isSystemAdmin?: boolean;
  permissions?: Record<string, boolean>;
  sessionEpoch?: number;
}

/** True when the user holds a module permission. Admins pass everything. */
export function hasPermission(user: AuthUser | null | undefined, permission: string | null): boolean {
  if (!user) return false;
  if (!permission) return true; // reference data
  if (user.isSystemAdmin) return true;
  const perms = user.permissions;
  // Absent permissions object = legacy user with full access (matches the client's
  // historical behaviour); an explicit `false` denies.
  if (!perms) return true;
  return perms[permission] !== false;
}

export type AccessMode = "read" | "write";

/**
 * Decides whether `user` may read or write a collection.
 * Returns null when allowed, or a Persian reason when denied.
 */
export function checkKeyAccess(
  user: AuthUser | null | undefined,
  key: string,
  mode: AccessMode,
): string | null {
  if (!user) return "برای دسترسی به اطلاعات باید وارد سامانه شوید.";

  if (mode === "write" && SETTINGS_WRITE_PERMISSION[key]) {
    return hasPermission(user, SETTINGS_WRITE_PERMISSION[key])
      ? null
      : "شما اجازه تغییر تنظیمات سامانه را ندارید.";
  }

  if (!(key in KEY_PERMISSION)) {
    // Unknown key — the caller's whitelist should already have rejected it.
    return "دسترسی به این بخش مجاز نیست.";
  }

  const permission = KEY_PERMISSION[key];
  if (hasPermission(user, permission)) return null;
  return "شما اجازه دسترسی به این بخش را ندارید.";
}

/** Builds the Set-Cookie value for a session. */
export function buildSessionCookie(token: string, ttlMs: number = SESSION_TTL_MS): string {
  const maxAge = Math.floor(ttlMs / 1000);
  // No `Secure`: the app is served over plain HTTP on the LAN, and a Secure
  // cookie would simply never be sent. SameSite=Lax blocks cross-site sends.
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Minimal cookie-header parser (avoids adding a dependency). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Returns a stable session secret. Uses ERP_SESSION_SECRET when set; otherwise
 * generates one and persists it via the provided callbacks so that restarts do
 * not invalidate every session.
 */
export function resolveSessionSecret(
  read: () => string | undefined,
  write: (secret: string) => void,
): string {
  const fromEnv = process.env.ERP_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const existing = read();
  if (existing && existing.length >= 16) return existing;

  const generated = crypto.randomBytes(48).toString("hex");
  write(generated);
  return generated;
}
