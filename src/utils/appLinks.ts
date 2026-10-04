/**
 * Addresses for the application's own screens, so a link can be opened in a
 * new tab.
 *
 * There is no router here: the screen is `activeView` state in `App.tsx`, so
 * every menu item and every project link was a `<button>` — and a button has
 * no address, which is why a right-click offered no «باز کردن در زبانه جدید»
 * and a ctrl-click did nothing different. A link needs an address the
 * application understands when a tab *opens* on it, and that is all this file
 * is: the one spelling of those addresses, written by the links and read by
 * `App.tsx` on load.
 *
 * Three rules.
 *
 * - **The address carries the same hand-off a press does, and nothing more.**
 *   A menu item is `?view=<module>`; a project code is the project jump
 *   (`q=<code>`), the one every code link already performs; a work card's
 *   project line is the activity jump (`projectId`, and the category and
 *   message for a referral). A second, URL-only way to open a record would be a
 *   second path into the screens that could come to disagree with the first.
 * - **An ordinary left click stays in the tab** (`isPlainLeftClick`). Only a
 *   click the browser itself would treat as «somewhere else» — ctrl, ⌘, shift,
 *   or the middle button, which arrives as `auxclick` and never reaches
 *   `onClick` at all — is left to the browser.
 * - **A view this build does not know is not a view.** The parameter comes
 *   from an address bar, so it is checked against the module catalogue and
 *   anything else opens the dashboard rather than a screen that does not exist.
 *   Whether the account may *open* it is still the route guard's question, as
 *   it is for a press of the menu.
 */
import { APP_MODULES } from "../appModules";
import type { ActivityJump } from "./notificationJump";

export const DEFAULT_VIEW = "dashboard";

/** The query keys a link may carry. */
export const LINK_PARAMS = ["view", "q", "projectId", "groupId", "activityId"] as const;

const KNOWN_VIEWS = new Set<string>(APP_MODULES.map((m) => m.id));

export function isKnownView(view: string | null | undefined): view is string {
  return !!view && KNOWN_VIEWS.has(view);
}

function hrefOf(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const text = String(value ?? "").trim();
    if (text) search.set(key, text);
  }
  const query = search.toString();
  return query ? `?${query}` : "?";
}

/** A module, as the menu opens it. */
export function viewHref(view: string): string {
  return hrefOf({ view: view === DEFAULT_VIEW ? null : view });
}

/** A project code: the module filtered to that job, as `ProjectCodeLink` opens it. */
export function projectCodeHref(code: string, view = "projects"): string {
  return hrefOf({ view, q: code });
}

/** A project record (and for a referral, the message it came from). */
export function activityHref(jump: ActivityJump): string {
  return hrefOf({
    view: "projects",
    projectId: jump.projectId,
    groupId: jump.groupId,
    activityId: jump.activityId,
  });
}

export interface UrlRequest {
  view: string;
  projectJump: { view: string; term: string } | null;
  activityJump: ActivityJump | null;
}

/** What an address asks for, read once when a tab opens on it. */
export function readUrlRequest(search: string): UrlRequest {
  const params = new URLSearchParams(search);
  const asked = params.get("view");
  const view = isKnownView(asked) ? asked : DEFAULT_VIEW;
  const term = (params.get("q") ?? "").trim();
  const projectId = (params.get("projectId") ?? "").trim();
  const groupId = (params.get("groupId") ?? "").trim();
  const activityId = (params.get("activityId") ?? "").trim();
  return {
    view,
    projectJump: term && view !== DEFAULT_VIEW ? { view, term } : null,
    // A record opens on the projects screen only, which is the one screen the
    // activity jump is wired to.
    activityJump: projectId && view === "projects"
      ? { projectId, ...(groupId ? { groupId } : {}), ...(activityId ? { activityId } : {}) }
      : null,
  };
}

/**
 * The address to show while a view is open: the view, with the one-shot
 * hand-off keys dropped (they were applied when the tab opened, and leaving
 * them would re-apply a filter on refresh that nobody asked for again) and
 * every other key — `standalone`, a print request — left exactly as it was.
 */
export function addressForView(search: string, view: string): string {
  const params = new URLSearchParams(search);
  for (const key of LINK_PARAMS) params.delete(key);
  if (view !== DEFAULT_VIEW) params.set("view", view);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Whether a click on a link should stay in this tab.
 *
 * Anything with a modifier, or any button but the main one, is the browser's:
 * that is precisely the gesture somebody makes to get a new tab or window.
 */
export function isPlainLeftClick(e: {
  button?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean;
}): boolean {
  return (e.button ?? 0) === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}
