/**
 * Derived proforma and project status.
 *
 * A proforma's outcome is not stored — it is computed from its line items, and
 * a project's status is computed from its proformas. Keeping the rules in one
 * pure module (rather than scattered across call sites, as they were on the
 * client) means changing the semantics is a single edit, and the rules can be
 * tested without a database.
 *
 * These mirror `getProformaOutcomeStatus` / `getWonItemsOfProforma` /
 * `syncProjectStatus` in src/useERPStore.ts, which remain the client's copy
 * until it is migrated.
 */

export const ITEM_WON = "برنده";
export const ITEM_LOST = "بازنده";
export const ITEM_CANCELLED = "لغو شده";

export type ProformaOutcome =
  | "پیش‌نویس" | "ارسال شده" | "تأیید شده (برنده)"
  | "لغو شده" | "باخته" | "نیمه برنده" | "جاری";

export type ProjectStatus =
  | "جدید" | "در حال مذاکره" | "ارائه پیش‌فاکتور"
  | "برنده (موفق)" | "باخته" | "لغو شده" | "نیمه برنده";

export interface OutcomeItem {
  status?: string | null;
  supplyMethod?: string | null;
}

export interface OutcomeProforma {
  status?: string | null;
  isCancelled?: boolean | null;
  items?: OutcomeItem[] | null;
}

/**
 * A proforma's outcome, derived from its lines.
 *
 * An explicit cancellation wins over everything. With no lines there is nothing
 * to derive from, so the stored workflow status stands. Otherwise the lines
 * decide: unanimity gives a clean outcome, and any win among a mixed set makes
 * it partially won.
 */
export function getProformaOutcome(pf: OutcomeProforma): ProformaOutcome {
  if (pf.isCancelled) return "لغو شده";

  const items = pf.items ?? [];
  if (items.length === 0) {
    if (pf.status === "پیش‌نویس") return "پیش‌نویس";
    return pf.status === "ارسال شده" ? "ارسال شده" : "جاری";
  }

  const won = items.filter((i) => i.status === ITEM_WON).length;
  const lost = items.filter((i) => i.status === ITEM_LOST).length;
  const cancelled = items.filter((i) => i.status === ITEM_CANCELLED).length;
  const total = items.length;

  if (won === total) return "تأیید شده (برنده)";
  if (cancelled === total) return "لغو شده";
  if (lost === total) return "باخته";
  // Nothing won, everything else closed: cancellation is the more specific note.
  if (lost + cancelled === total) return cancelled > 0 ? "لغو شده" : "باخته";

  if (won > 0) return "نیمه برنده";

  if (pf.status === "پیش‌نویس") return "پیش‌نویس";
  if (pf.status === "ارسال شده") return "ارسال شده";
  return "جاری";
}

/**
 * The lines that count as won, for stock reservation and delivery.
 *
 * `includeOrder` keeps lines that will be purchased; by default only lines
 * supplied from stock are returned, since those are the ones that move
 * inventory.
 *
 * Only a won or partially-won proforma has won lines, and both of those outcomes
 * require at least one line explicitly marked برنده — so past the guard, marked
 * lines are the answer. The client also carries a fallback here for "nothing
 * marked won, so count everything not lost"; it is unreachable for the same
 * reason, which an exhaustive comparison over every 0-3 line combination
 * confirmed.
 */
export function getWonItems<T extends OutcomeItem>(
  pf: OutcomeProforma & { items?: T[] | null },
  includeOrder = false,
): T[] {
  const outcome = getProformaOutcome(pf);
  if (outcome !== "تأیید شده (برنده)" && outcome !== "نیمه برنده") return [];

  const items: T[] = pf.items ?? [];
  const won = items.filter((i) => i.status === ITEM_WON);

  return includeOrder ? won : won.filter((i) => i.supplyMethod === "INVENTORY");
}

export interface StatusProforma extends OutcomeProforma {
  id: string;
  createdAt: Date | string;
}

/**
 * The status a project should carry, given its proformas.
 *
 * Picks the proforma that decides the outcome: a won or partially-won one if
 * there is any, else the most recent. Returns null when the project has no
 * proformas, meaning "leave the status alone" — a project can legitimately sit
 * at جدید or در حال مذاکره before any proforma exists.
 *
 * Note: the client picks the fallback by digging digits out of the record id
 * (`parseInt(id.match(/\d+/))`), which was a timestamp-based id. Database ids
 * are UUIDs, where that expression grabs an arbitrary digit run and orders
 * essentially at random, so this uses createdAt instead.
 */
export function deriveProjectStatus(proformas: StatusProforma[]): ProjectStatus | null {
  if (!proformas || proformas.length === 0) return null;

  const outcomes = proformas.map((pf) => getProformaOutcome(pf));
  if (outcomes.every((o) => o === "لغو شده")) return "لغو شده";
  if (outcomes.every((o) => o === "باخته")) return "باخته";

  /*
   * Every winning proforma, not the first one found.
   *
   * A project can legitimately be won in pieces — one quote for the flow meters
   * and another for the valves — and this used to derive the project's status
   * from whichever winning proforma happened to come first in the array. A
   * project whose first quote was won outright and whose second was half lost
   * reported برنده (موفق), and the same pair in the other order reported
   * نیمه برنده. The lines of all of them decide together.
   */
  const winners = proformas.filter((pf) => {
    const o = getProformaOutcome(pf);
    return o === "تأیید شده (برنده)" || o === "نیمه برنده";
  });

  const items: OutcomeItem[] = winners.length > 0
    ? winners.flatMap((pf) => pf.items ?? [])
    : ([...proformas].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0]?.items ?? []);

  if (items.length === 0) return "ارائه پیش‌فاکتور";

  const won = items.filter((i) => i.status === ITEM_WON).length;
  const lost = items.filter((i) => i.status === ITEM_LOST).length;

  if (won === items.length) return "برنده (موفق)";
  if (lost === items.length) return "باخته";
  if (won > 0) return "نیمه برنده";
  return "ارائه پیش‌فاکتور";
}

/** True when a project status means the deal was won, wholly or partly. */
export function isWonStatus(status: string | null | undefined): boolean {
  return status === "برنده (موفق)" || status === "نیمه برنده";
}

/**
 * Statuses a project can only have reached by having a proforma.
 *
 * Used to walk a project back when its last proforma is deleted or moved away:
 * without this it keeps a status derived from a document it no longer has, and a
 * project with nothing lost goes on reporting باخته.
 */
const PROFORMA_DERIVED_STATUSES = new Set<string>([
  "ارائه پیش‌فاکتور", "برنده (موفق)", "باخته", "نیمه برنده", "لغو شده",
]);

/**
 * The status a project should fall back to once it has no proformas at all, or
 * null to leave it alone.
 *
 * The pre-proforma stages (جدید, در حال مذاکره) are untouched — they were set by
 * a person and were never derived. Anything else was derived from a proforma that
 * is now gone, so it returns to negotiation; the real history is unknowable, and
 * negotiation is the stage a project is actually in when it has no quote out.
 *
 * Note: the client returns early here and leaves the stale status in place.
 */
export function statusWithoutProformas(current: string | null | undefined): ProjectStatus | null {
  if (!current || !PROFORMA_DERIVED_STATUSES.has(current)) return null;
  return "در حال مذاکره";
}
