/**
 * The header a service record shows, derived from its rows.
 *
 * An after-sales record is a folder of items, each with its own progress. The
 * name, dates and status on the record itself are a roll-up of those rows, and
 * the grid filters and sorts on them — so they cannot be whatever the form last
 * calculated. A client that computes them differently, or an older one that
 * does not compute them at all, would otherwise file rows under a status they
 * are not in.
 *
 * Same reasoning as `proformaStatus.ts`: one pure module, testable without a
 * database, mirrored on the client until that side is retired.
 */

export const UNDER_REVIEW = "در حال بررسی";
export const IN_REPAIR = "در حال تعمیر/خدمات";
export const COMPLETED = "تکمیل شده";
export const DELIVERED = "تحویل داده شده";

export interface ServiceRow {
  productName: string;
  status?: string | null;
  issueDescription?: string | null;
  actionsTaken?: string | null;
  startDateJalali?: string | null;
  endDateJalali?: string | null;
  returnDateJalali?: string | null;
}

export interface ServiceHeader {
  itemName: string;
  issueDescription: string | null;
  actionsTaken: string | null;
  startDate: string | null;
  endDate: string | null;
  returnDate: string | null;
  status: string;
}

/**
 * Shamsi dates are written YYYY/MM/DD with fixed-width parts, so ordering them
 * as text is the same as ordering them as dates — no parsing needed.
 */
function earliest(values: (string | null | undefined)[]): string | null {
  const present = values.filter((v): v is string => !!v).sort();
  return present[0] ?? null;
}

function latest(values: (string | null | undefined)[]): string | null {
  const present = values.filter((v): v is string => !!v).sort();
  return present[present.length - 1] ?? null;
}

export function deriveServiceHeader(rows: ServiceRow[]): ServiceHeader | null {
  if (!rows || rows.length === 0) return null;

  const first = rows[0];
  const itemName = rows.length > 1
    ? `${first.productName} و ${rows.length - 1} کالای دیگر`
    : first.productName;

  const actions = rows.map((r) => r.actionsTaken).filter((a): a is string => !!a);

  // An end or return date is only the record's own once every row has one:
  // half a folder finished is not a finished folder.
  const allEnded = rows.every((r) => !!r.endDateJalali);
  const allReturned = rows.every((r) => !!r.returnDateJalali);

  const statuses = rows.map((r) => r.status ?? UNDER_REVIEW);
  let status = UNDER_REVIEW;
  if (statuses.every((s) => s === DELIVERED)) status = DELIVERED;
  else if (statuses.every((s) => s === COMPLETED || s === DELIVERED)) status = COMPLETED;
  else if (statuses.some((s) => s === IN_REPAIR)) status = IN_REPAIR;

  return {
    itemName,
    issueDescription: first.issueDescription ?? null,
    actionsTaken: actions.length > 0 ? actions.join(" | ") : null,
    startDate: earliest(rows.map((r) => r.startDateJalali)),
    endDate: allEnded ? latest(rows.map((r) => r.endDateJalali)) : null,
    returnDate: allReturned ? latest(rows.map((r) => r.returnDateJalali)) : null,
    status,
  };
}
