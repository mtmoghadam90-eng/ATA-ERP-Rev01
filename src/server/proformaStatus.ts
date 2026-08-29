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
 * The proformas that decide what became of a project.
 *
 * A project here legitimately carries several quotations at once — the
 * temperature instruments, the pressure instruments, the flow meters — and
 * routinely carries several revisions of one. So "what happened to this
 * opportunity" is never the sum of its documents: every winning proforma
 * decides it together, and when none has won, the most recent one stands for
 * the rest.
 *
 * Extracted so the dashboard's conversion figures can count **one data point
 * per project** using the same selection the project's own status is derived
 * from. Two readings of "which quotation counts" is how a project comes to be
 * won on one screen and lost on another.
 */
export function decidingProformas<T extends StatusProforma>(proformas: T[]): T[] {
  const winners = proformas.filter((pf) => {
    const o = getProformaOutcome(pf);
    return o === "تأیید شده (برنده)" || o === "نیمه برنده";
  });
  if (winners.length > 0) return winners;

  const latest = [...proformas].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  return latest ? [latest] : [];
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
  const items: OutcomeItem[] = decidingProformas(proformas).flatMap((pf) => pf.items ?? []);

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

/* ------------------------- filtering by outcome -------------------------- */

/**
 * Filtering the grid by what a proforma *became*, not by the column.
 *
 * The status filter sent its value straight at the stored `status` column, and
 * only two of the six options are ever in that column: «پیش‌نویس» and «ارسال
 * شده». «تأیید شده (برنده)», «باخته» and «لغو شده» are **outcomes** — derived
 * from the line statuses and the cancellation flag by `getProformaOutcome`
 * above — so choosing one asked SQL for a value nothing holds and the grid came
 * back empty. «نیمه برنده» was not offered at all, though the grid prints it.
 *
 * The outcome cannot be a column comparison, but it can be a query: each branch
 * of the rule above has an exact equivalent in terms of "how many lines are
 * won / lost / cancelled". Those are what these clauses say.
 *
 * They are written without `not` on a nullable column and without `every`,
 * whose treatment of NULL is a thing to have to remember; "no line outside this
 * set" is spelled out instead, NULL included. `test:rules` evaluates every
 * clause against every combination of lines and fails if it and
 * `getProformaOutcome` ever disagree — which is what keeps this from becoming a
 * second, drifting copy of the rule.
 */

/** Outcomes that are derived rather than stored, so a column filter cannot find them. */
export const DERIVED_OUTCOMES: readonly ProformaOutcome[] = [
  "تأیید شده (برنده)", "نیمه برنده", "باخته", "لغو شده", "جاری",
];

type Where = Record<string, unknown>;

const NOT_CANCELLED: Where = { isCancelled: false };
const HAS_LINES: Where = { items: { some: {} } };
const NO_LINES: Where = { items: { none: {} } };

/** At least one line whose status is one of these. */
const someLineIn = (statuses: string[]): Where =>
  ({ items: { some: { status: { in: statuses } } } });

/** At least one line whose status is *not* one of these — a null counts. */
const someLineOutside = (statuses: string[]): Where =>
  ({ items: { some: { OR: [{ status: null }, { status: { notIn: statuses } }] } } });

/** No line whose status is outside the set — so every line is inside it. */
const noLineOutside = (statuses: string[]): Where =>
  ({ items: { none: { OR: [{ status: null }, { status: { notIn: statuses } }] } } });

/** The workflow status a document sits at while its lines are still open. */
function openAt(status: ProformaOutcome): Where {
  /*
   * No null branch for the document's own status.
   *
   * `proformas.status` is NOT NULL, and Prisma refuses `{ status: null }` on a
   * non-nullable column — the filter type does not accept it, and the whole
   * query fails at runtime with "Argument `status` is missing". The screen this
   * clause serves then shows a wall of Prisma's own error text instead of a
   * list. A line's status *is* nullable, which is why the item clauses below
   * still carry their null branches and must keep them.
   */
  const stored: Where = status === "جاری"
    ? { status: { notIn: ["پیش‌نویس", "ارسال شده"] } }
    : { status };

  return {
    AND: [
      NOT_CANCELLED,
      stored,
      {
        OR: [
          // Nothing to derive from, so the workflow status stands.
          NO_LINES,
          // Lines exist but none is won and at least one is still open, so no
          // terminal outcome has been reached.
          {
            AND: [
              { items: { none: { status: { in: [ITEM_WON] } } } },
              someLineOutside([ITEM_LOST, ITEM_CANCELLED]),
            ],
          },
        ],
      },
    ],
  };
}

/** The query for one outcome, or null when the value is a stored status. */
export function outcomeWhere(outcome: string): Where | null {
  switch (outcome) {
    case "تأیید شده (برنده)":
      // Every line won.
      return { AND: [NOT_CANCELLED, HAS_LINES, noLineOutside([ITEM_WON])] };

    case "باخته":
      // Every line lost. A mix of lost and cancelled is a cancellation below.
      return { AND: [NOT_CANCELLED, HAS_LINES, noLineOutside([ITEM_LOST])] };

    case "نیمه برنده":
      // Some won, not all.
      return { AND: [NOT_CANCELLED, someLineIn([ITEM_WON]), someLineOutside([ITEM_WON])] };

    case "لغو شده":
      return {
        OR: [
          { isCancelled: true },
          {
            AND: [
              NOT_CANCELLED,
              HAS_LINES,
              // Nothing open and nothing won, with at least one cancellation:
              // all-cancelled, or cancelled mixed with lost.
              noLineOutside([ITEM_LOST, ITEM_CANCELLED]),
              someLineIn([ITEM_CANCELLED]),
            ],
          },
        ],
      };

    case "پیش‌نویس":
    case "ارسال شده":
    case "جاری":
      return openAt(outcome);

    default:
      return null;
  }
}

/* ------------------------- the clauses, checked -------------------------- */

/**
 * Evaluates the subset of Prisma's query language the clauses above use.
 *
 * Written so `test:rules` can hold the clauses against `getProformaOutcome`
 * over every combination of lines, rather than against a second reading of the
 * rule — the point being that these two must never drift.
 */
export function matchesWhere(where: Where, pf: OutcomeProforma): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Where[]).every((w) => matchesWhere(w, pf));
    if (key === "OR") return (value as Where[]).some((w) => matchesWhere(w, pf));
    if (key === "isCancelled") return !!pf.isCancelled === value;
    if (key === "status") return matchesField(pf.status ?? null, value);
    if (key === "items") {
      const items = pf.items ?? [];
      const [op, itemWhere] = Object.entries(value as Where)[0] as [string, Where];
      const hit = (item: OutcomeItem) => matchesItem(itemWhere, item);
      if (op === "some") return items.some(hit);
      if (op === "none") return !items.some(hit);
      if (op === "every") return items.every(hit);
    }
    throw new Error(`unsupported clause: ${key}`);
  });
}

function matchesItem(where: Where, item: OutcomeItem): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Where[]).some((w) => matchesItem(w, item));
    if (key === "AND") return (value as Where[]).every((w) => matchesItem(w, item));
    if (key === "status") return matchesField(item.status ?? null, value);
    throw new Error(`unsupported item clause: ${key}`);
  });
}

function matchesField(actual: string | null, expected: unknown): boolean {
  if (expected === null) return actual === null;
  if (typeof expected === "string") return actual === expected;
  const op = expected as { in?: string[]; notIn?: string[] };
  if (op.in) return actual !== null && op.in.includes(actual);
  if (op.notIn) return actual !== null && !op.notIn.includes(actual);
  throw new Error(`unsupported operator: ${JSON.stringify(expected)}`);
}
