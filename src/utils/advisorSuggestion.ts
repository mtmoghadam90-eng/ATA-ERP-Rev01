/**
 * What the adviser proposed, as data — with nothing that talks to a model or a
 * database.
 *
 * Two rules live here. The first is the shape: a model returns whatever it
 * returns, and this is where it becomes a suggestion with a name, a
 * specification and an honest `match` — including when half the fields are
 * missing or the wrong type.
 *
 * The second is the text. The specification a suggestion carries has to be
 * written the way the configurator writes it and the way the document prints
 * it — «Label: Value», one per line, with free notes marked by «*» — because
 * all three are the same text. If they drift, the card stops being a preview of
 * the line, and the button that adds it stops being trustworthy.
 */

export interface SuggestedSpec {
  label: string;
  value: string;
}

/** How much of the enquiry the catalogue can actually answer. */
export type SuggestionMatch = "exact" | "close" | "new";

export interface NormalizedSuggestion {
  productName: string;
  specs: SuggestedSpec[];
  notes: string[];
  reason?: string;
  /** Only ever what the model was given; verified against the catalogue later. */
  productId?: string;
  variantId?: string;
  sku?: string;
  match: SuggestionMatch;
}

const str = (value: unknown): string => String(value ?? "").trim();

/**
 * One raw suggestion, in a shape the rest of the code can rely on.
 *
 * A missing name, a spec that is a bare string, a `match` nobody recognises —
 * all of it is normalised rather than trusted, because the source is a language
 * model and the destination is a document sent to a customer.
 */
export function normalizeSuggestion(raw: unknown): NormalizedSuggestion {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const specs: SuggestedSpec[] = Array.isArray(row.specs)
    ? (row.specs as unknown[])
        .map((entry) => {
          const spec = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
          return { label: str(spec.label), value: str(spec.value) };
        })
        .filter((spec) => spec.label !== "" && spec.value !== "")
    : [];

  const notes: string[] = Array.isArray(row.notes)
    ? (row.notes as unknown[]).map(str).filter(Boolean)
    : [];

  /*
   * An unrecognised match is «new», the least confident of the three.
   *
   * The other direction would put an unverified claim of «this exists» in front
   * of somebody about to quote it.
   */
  const match: SuggestionMatch =
    row.match === "exact" || row.match === "close" ? row.match : "new";

  const out: NormalizedSuggestion = {
    productName: str(row.productName) || "قلم پیشنهادی",
    specs,
    notes,
    match,
  };

  const reason = str(row.reason);
  if (reason) out.reason = reason;
  const productId = str(row.productId);
  if (productId) out.productId = productId;
  const variantId = str(row.variantId);
  if (variantId) out.variantId = variantId;
  const sku = str(row.sku);
  if (sku) out.sku = sku;

  return out;
}

/**
 * The specification text for a proforma line.
 *
 * Exactly the format `specLinesFrom` produces for the configurator and the
 * printed document reads back — so a line added from a card and a line
 * configured by hand are indistinguishable once they are on the page.
 */
export function suggestionSpecText(
  suggestion: Pick<NormalizedSuggestion, "specs" | "notes">,
): string {
  return [
    ...suggestion.specs.map((spec) => `${spec.label}: ${spec.value}`),
    ...suggestion.notes.map((note) => (note.startsWith("*") ? note : `* ${note}`)),
  ].join("\n");
}
