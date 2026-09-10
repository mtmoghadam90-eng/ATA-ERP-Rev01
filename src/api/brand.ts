import { api } from "./client";

/*
 * The company logo, for the one screen that has no session.
 *
 * Everything else reads it out of `store.settings`, which arrives with the
 * sign-in. The login screen is drawn before that, so it asks the server for
 * the single field it needs.
 *
 * Deliberately not cached. The obvious optimisation is a module-scope copy, and
 * it earns nothing here — this screen is mounted once or twice in a session —
 * while it does buy a staleness: a logo changed in Settings would go on being
 * the old one for everybody who signs out and back in without reloading. One
 * small request is the cheaper of the two.
 *
 * It never throws: a brand that cannot be read must not stop anybody signing in.
 */
export async function fetchBrandLogo(): Promise<string | null> {
  try {
    const res = await api.get<{ logoUrl?: string | null }>("/api/brand");
    return res?.logoUrl ?? null;
  } catch {
    return null;
  }
}
