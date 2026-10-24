/**
 * How a customer came to be on the system, and when — the two questions the
 * customers grid filters on beside everything else.
 *
 * `entrySource` is stamped by the **server** at creation and is never a field
 * of the form: a client that could set it could file a hand-typed customer as
 * an import. Three writers exist and each passes its own answer — the customer
 * forms (MANUAL), «ورود از اکسل» (EXCEL) and the website's price-request import
 * (WEBSITE).
 *
 * **Null reads as MANUAL.** The column was added after the fact and backfills
 * nothing; every customer written before it was typed into a form except those
 * imported from the website or from Excel in the short window before this, and
 * no record says which those were. Reading null as «unknown» would make the
 * commonest filter («ثبت دستی») leave out almost every customer on the system.
 *
 * Pure, so the screen and the server read one list and `test:rules` can hold
 * the clauses without a database.
 */

export const CUSTOMER_ENTRY_SOURCES = [
  { id: "MANUAL", label: "ثبت دستی" },
  { id: "EXCEL", label: "ورود از اکسل" },
  { id: "WEBSITE", label: "استعلام سایت" },
] as const;

export type CustomerEntrySource = (typeof CUSTOMER_ENTRY_SOURCES)[number]["id"];

export function isCustomerEntrySource(value: unknown): value is CustomerEntrySource {
  return CUSTOMER_ENTRY_SOURCES.some((s) => s.id === value);
}

/** The label a stored value draws as; a blank or unknown value is the manual one. */
export function entrySourceLabel(value: string | null | undefined): string {
  return CUSTOMER_ENTRY_SOURCES.find((s) => s.id === value)?.label ?? CUSTOMER_ENTRY_SOURCES[0].label;
}

/**
 * The `where` fragment for one source, or nothing for «all» and for a value
 * this build does not know (an unknown filter widens nothing and hides nothing).
 * MANUAL takes the null rows with it — see the note above.
 */
export function entrySourceWhere(value: unknown): Record<string, unknown> | undefined {
  if (!isCustomerEntrySource(value)) return undefined;
  if (value === "MANUAL") return { OR: [{ entrySource: null }, { entrySource: "MANUAL" }] };
  return { entrySource: value };
}

/**
 * Iran's offset from UTC, in minutes. There has been no daylight saving since
 * 1401, so a fixed offset is the honest answer — and the one that decides which
 * Shamsi day an evening registration belongs to.
 */
export const TEHRAN_OFFSET_MINUTES = 210;

/**
 * `createdAt` between two Shamsi days, both included, read on Tehran's clock.
 *
 * `createdAt` is an instant, while the boxes name days: a customer written at
 * 01:00 on 5 Mehr is 21:30 UTC on 4 Mehr, so comparing against UTC midnight
 * would file it under the day before. The bounds are therefore the day's start
 * in Tehran (`toDate` answers the UTC midnight of a Shamsi day, as `jalaliToDate`
 * does) and the start of the day after `to`, exclusive. A box left empty is no
 * bound; a date that cannot be read is no bound either, rather than a filter
 * that silently matches nothing. A range given backwards is read the right way
 * round, since nobody means «from the 10th until the 3rd» as «nothing».
 */
export function createdRangeWhere(
  from: unknown,
  to: unknown,
  toDate: (value: unknown) => Date | null,
): Record<string, unknown> | undefined {
  const shift = TEHRAN_OFFSET_MINUTES * 60_000;
  let start = typeof from === "string" && from.trim() ? toDate(from.trim()) : null;
  let end = typeof to === "string" && to.trim() ? toDate(to.trim()) : null;
  if (start && end && start.getTime() > end.getTime()) [start, end] = [end, start];
  const range: Record<string, Date> = {};
  if (start) range.gte = new Date(start.getTime() - shift);
  if (end) range.lt = new Date(end.getTime() + 86_400_000 - shift);
  return Object.keys(range).length > 0 ? { createdAt: range } : undefined;
}
