/**
 * How much of what a proforma promised each packing row accounts for.
 *
 * A packing list is not a copy of the proforma: what was sold as one line of
 * two is often shipped as two cartons of one, and the list has to say so. So
 * the two figures the form works from are different questions —
 *
 *   - what the *project* still owes, which the server computes across every
 *     packing list except the one being edited (`RemainingLine.remaining`);
 *   - how the rows of *this* list divide that up, which only the form knows.
 *
 * Getting the second one wrong is not cosmetic. A row split off by hand used to
 * carry no product at all, so the stock ledger issued one unit where two had
 * left the building — the goods were gone and the history said otherwise.
 */

export interface AllocatableLine {
  key: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  /** Units this line was sold for. Zero means the proforma never mentioned it. */
  promised: number;
  /** Units still owed, across every other packing list. */
  remaining: number;
}

export interface AllocatableRow {
  id: string;
  productId?: string;
  variantId?: string;
  itemOrDocName: string;
  quantity: number;
}

/**
 * The outstanding list's key for a row.
 *
 * A product and a SKU, because a proforma promising one variant is not
 * satisfied by shipping another. A row with no product is keyed by its own
 * name and counts against nothing: documents, packaging and spares are
 * legitimately on a packing list and were never promised.
 */
export function packingRowKey(
  row: Pick<AllocatableRow, "productId" | "variantId" | "itemOrDocName">,
): string {
  return row.productId
    ? `${row.productId}|${row.variantId ?? ""}`
    : row.itemOrDocName.trim();
}

/**
 * What a promised line still has spare, after this form's other rows.
 *
 * `Infinity` for anything the proforma did not promise — those are uncapped by
 * design, not by omission.
 */
export function outstandingFor(
  lines: AllocatableLine[],
  rows: AllocatableRow[],
  key: string,
  excludeRowId?: string,
): number {
  const line = lines.find((l) => l.key === key);
  if (!line || line.promised === 0) return Infinity;

  const takenHere = rows
    .filter((row) => row.id !== excludeRowId && row.productId && packingRowKey(row) === key)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return Math.max(0, line.remaining - takenHere);
}

/**
 * The promised lines that still have something left to pack.
 *
 * Empties as the rows account for them, which is the whole behaviour: once
 * every unit a proforma promised sits in a box, the only thing left to add is
 * something the proforma never mentioned — and the form offers only manual
 * entry from then on.
 */
export function packableLines(
  lines: AllocatableLine[],
  rows: AllocatableRow[],
): { line: AllocatableLine; spare: number }[] {
  return lines
    .filter((line) => line.promised > 0)
    .map((line) => ({ line, spare: outstandingFor(lines, rows, line.key) }))
    .filter(({ spare }) => spare > 0 && spare !== Infinity);
}
