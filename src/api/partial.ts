/**
 * Tells a half-loaded record apart from a whole one.
 *
 * A list row is deliberately not the whole record. The server sends the few
 * columns the grid prints and leaves prices, notes, custom values and child
 * grids out, so a page stays cheap. That is fine right up until an edit form is
 * populated from a row and then saved: every field the row never carried goes
 * back as empty or zero, and `syncChildren` reads an empty line-item array as
 * "the user deleted them all" rather than "not edited".
 *
 * Six screens did exactly that, and it quietly destroyed proforma line pricing,
 * purchase-order items and cost inputs, transaction notes, and customer
 * addresses. The edit paths now load the detail record first, and this marker
 * is the standing guard that stops the mistake from coming back: `rowTo…`
 * labels what it built as partial, `detailTo…` labels it complete, and the
 * write mappers refuse anything still marked partial.
 *
 * The marker is an ordinary enumerable property on purpose. The edit paths
 * write back through a spread (`{ ...editingProforma, ...changes }`), and a
 * non-enumerable flag would be dropped by precisely the spread it needs to
 * survive. It never reaches the server: every write mapper builds an explicit
 * object literal, and the Excel exports map named columns, so nothing copies
 * unknown keys through.
 */

export const PARTIAL_KEY = "__partial";

/** Labels a list-row projection. */
export function markPartial<T extends object>(record: T): T {
  return { ...record, [PARTIAL_KEY]: true };
}

/** Labels a full detail record, clearing the flag inherited from `rowTo…`. */
export function markComplete<T extends object>(record: T): T {
  return { ...record, [PARTIAL_KEY]: false };
}

export function isPartial(record: unknown): boolean {
  return (
    !!record &&
    typeof record === "object" &&
    (record as Record<string, unknown>)[PARTIAL_KEY] === true
  );
}

/**
 * Refuses to turn a list row into a write payload.
 *
 * Throws a plain `Error`, not an `ApiError`, so the views' `reportError` shows
 * its own Persian message to the user while the detail below reaches the
 * console for whoever has to fix it.
 */
export function assertComplete(record: unknown, entity: string): void {
  if (!isPartial(record)) return;

  const message =
    `${entity}: refusing to save a list row. Load the full record with ` +
    `api.get(id) and the matching detailTo… adapter before writing — a row ` +
    `omits prices, notes, custom values and child rows, and saving it would ` +
    `erase them.`;
  console.error(message, record);
  throw new Error(message);
}
