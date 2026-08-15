import { useEffect, useState } from "react";
import { ERPSettings, Proforma, User } from "./types";
import { ApiError, setUnauthenticatedHandler } from "./api/client";
import { settingsApi } from "./api/settings";
import { DEFAULT_SETTINGS } from "./seedData";

/**
 * What is left of the client store.
 *
 * It used to hold every collection in the app, loaded from database.json and
 * written back through a delta-merge protocol. Every screen has since moved to
 * the API and reads its own data, so those collections had no readers left —
 * they were a second, silently diverging copy of the database that cost a large
 * download on every page load and quietly broke anything still trusting them.
 *
 * What genuinely belongs to the whole app is kept: who is signed in, and the
 * settings document every screen reads. Both come from SQL.
 */

export const SEED_USERS: User[] = [
  {
    id: "user-1",
    username: "mohammad",
    password: "123",
    fullName: "محمد توکل مقدم",
    role: "admin",
    isSystemAdmin: true,
    permissions: {
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: true,
      tasks: true,
      referrals: true,
      settings: true,
      users: true,
      packagingDelivery: true,
    },
  },
  {
    id: "user-2",
    username: "antony",
    password: "123",
    fullName: "آنتونی فیرو",
    role: "user",
    isSystemAdmin: false,
    permissions: {
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: true,
      tasks: true,
      referrals: true,
      settings: false,
      users: false,
      packagingDelivery: true,
    },
  },
  {
    id: "user-3",
    username: "hosseini",
    password: "123",
    fullName: "مهندس حسینی",
    role: "user",
    isSystemAdmin: false,
    permissions: {
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: true,
      tasks: true,
      referrals: true,
      settings: false,
      users: false,
      packagingDelivery: true,
    },
  },
];

/**
 * A proforma's outcome, derived from its line statuses rather than stored.
 *
 * The server has its own copy of this rule in src/server/proformaStatus.ts and
 * is the authority; this one exists because three screens colour a row by it
 * without asking.
 */
export const getProformaOutcomeStatus = (
  pf: Proforma,
):
  | "پیش‌نویس"
  | "ارسال شده"
  | "تأیید شده (برنده)"
  | "لغو شده"
  | "باخته"
  | "نیمه برنده"
  | "جاری" => {
  if (pf.isCancelled) return "لغو شده";

  const items = pf.items || [];
  if (items.length === 0) {
    if (pf.status === "پیش‌نویس") return "پیش‌نویس";
    return pf.status === "ارسال شده" ? "ارسال شده" : "جاری";
  }

  const wonCount = items.filter((i) => i.status === "برنده").length;
  const lostCount = items.filter((i) => i.status === "بازنده").length;
  const cancelledCount = items.filter((i) => i.status === "لغو شده").length;
  const totalCount = items.length;

  if (wonCount === totalCount) return "تأیید شده (برنده)";
  if (cancelledCount === totalCount) return "لغو شده";
  if (lostCount === totalCount) return "باخته";
  if (lostCount + cancelledCount === totalCount) {
    return cancelledCount > 0 ? "لغو شده" : "باخته";
  }

  if (wonCount > 0) return "نیمه برنده";

  if (pf.status === "پیش‌نویس") return "پیش‌نویس";
  if (pf.status === "ارسال شده") return "ارسال شده";
  return "جاری";
};

/**
 * Listeners for a lost or expired session. A failed write must never look like
 * a successful one, so the UI is told to stop and re-authenticate.
 */
const sessionListeners = new Set<() => void>();
export const onSessionExpired = (fn: () => void) => {
  sessionListeners.add(fn);
  return () => { sessionListeners.delete(fn); };
};

let sessionExpiredNotified = false;

/**
 * Clears the latch after a successful sign-in.
 *
 * Without this the flag stays set for the life of the page: one auth failure —
 * including a mistyped password on the login screen — leaves the
 * "session expired" modal up even once the user has signed in successfully,
 * with no way to dismiss it short of reloading.
 */
export const resetSessionExpiredNotice = () => {
  sessionExpiredNotified = false;
};

export const notifySessionExpired = () => {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  sessionListeners.forEach((fn) => {
    try { fn(); } catch (e) { console.error("session listener failed", e); }
  });
};

/**
 * Route the API client's 401s into the same notice.
 *
 * The client has always had a hook for this and nothing had ever registered
 * one, so a lost session surfaced as an unexplained error on whichever screen
 * happened to be open. The document store used to catch this for its own
 * requests only, which is why it went unnoticed while both paths existed.
 */
setUnauthenticatedHandler(notifySessionExpired);

/**
 * The stored settings, over the defaults.
 *
 * The stored document was used as-is, which assumed it always carries every key
 * the app reads. It need not: it is one JSON column written wholesale, so a
 * document saved by an older version — or a database seeded without one, where
 * the endpoint answers `null` — is missing whatever was added since. And these
 * are not read defensively anywhere: `App` reads
 * `settings.dropdownItems.categories` while rendering, so a missing branch is a
 * white screen, not a missing dropdown.
 *
 * One level deep, because that is how the document is shaped: the top level is
 * groups (`dropdownItems`, `documentFormats`, `requiredFields`), and it is a
 * key *inside* one of those that goes missing when a new one is introduced.
 * Arrays are taken whole — a user who empties a dropdown list means it, and
 * merging the defaults back in would resurrect entries they deleted.
 */
function mergeSettings(loaded: unknown): ERPSettings {
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return DEFAULT_SETTINGS;

  const stored = loaded as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined) continue;
    const fallback = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    const bothPlainObjects =
      value !== null && typeof value === "object" && !Array.isArray(value)
      && fallback !== null && typeof fallback === "object" && !Array.isArray(fallback);

    merged[key] = bothPlainObjects
      ? { ...(fallback as object), ...(value as object) }
      : value;
  }

  return merged as unknown as ERPSettings;
}

export function useERPStore() {
  const [settings, setSettings] = useState<ERPSettings>(DEFAULT_SETTINGS);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<"admin" | "user">(() => {
    const stored = localStorage.getItem("erp_simulated_role");
    return stored === "user" ? "user" : "admin";
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Defaults stay in place if this fails: the settings document carries the
      // dropdown lists, document templates and workflow rules, and an empty
      // object would empty every one of them on screen.
      try {
        const loaded = await settingsApi.load();
        if (!cancelled) setSettings(mergeSettings(loaded));
      } catch (err) {
        console.error("Failed to load settings", err);
      }

      // The server session is authoritative. The cached user in localStorage is
      // a convenience for first paint and must not be trusted on its own.
      try {
        const res = await fetch("/api/me", { credentials: "same-origin" });
        if (res.ok) {
          const me = await res.json();
          if (me?.user && !cancelled) {
            setCurrentUser(me.user);
            if (me.user.role) setUserRole(me.user.role);
            localStorage.setItem("erp_current_user", JSON.stringify(me.user));
          }
        } else if (!cancelled) {
          localStorage.removeItem("erp_current_user");
          setCurrentUser(null);
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem("erp_current_user");
          setCurrentUser(null);
        }
      }

      if (!cancelled) setIsInitialized(true);
    }

    void load();
    return () => { cancelled = true; };
    // Re-runs after a sign-in, because both reads above need the session.
  }, [reloadKey]);

  const adopt = (user: User) => {
    localStorage.setItem("erp_current_user", JSON.stringify(user));
    localStorage.setItem("erp_simulated_role", user.role);
    setCurrentUser(user);
    setUserRole(user.role as "admin" | "user");
    setReloadKey((k) => k + 1);
  };

  return {
    settings,
    currentUser,
    userRole,
    isInitialized,

    changeRole: (role: "admin" | "user") => {
      setUserRole(role);
      localStorage.setItem("erp_simulated_role", role);
    },

    login: async (
      username: string,
      password?: string,
    ): Promise<{ success: boolean; mustChangePassword?: boolean; message?: string }> => {
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();

        if (res.ok && data.success && data.user) {
          // A new session invalidates any earlier "session lost" notice.
          resetSessionExpiredNotice();
          if (data.mustChangePassword) return { success: true, mustChangePassword: true };
          adopt(data.user);
          return { success: true, mustChangePassword: false };
        }
        return {
          success: false,
          message: data.message || "نام کاربری یا رمز ورود اشتباه است.",
        };
      } catch (err) {
        console.error("Login error", err);
        return { success: false, message: "خطا در برقراری ارتباط با سرور." };
      }
    },

    loginWithUser: (user: User) => {
      resetSessionExpiredNotice();
      adopt(user);
    },

    logout: () => {
      // Clear the server session too; the cookie is what actually grants access.
      fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      localStorage.removeItem("erp_current_user");
      setCurrentUser(null);
    },

    /**
     * Settings live in SQL. The local copy is updated first so the screens stay
     * responsive, and put back if the write fails rather than leaving the app
     * showing a change that was never saved.
     */
    updateSettings: (newSettings: ERPSettings) => {
      const previous = settings;
      setSettings(newSettings);
      settingsApi.save(newSettings).catch((err: unknown) => {
        setSettings(previous);
        alert(err instanceof ApiError ? err.message : "ذخیره تنظیمات با خطا مواجه شد.");
      });
    },
  };
}
