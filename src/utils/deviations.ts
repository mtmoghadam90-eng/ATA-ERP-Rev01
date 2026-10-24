/**
 * «Technical Deviation List» — where a quotation departs from the customer's
 * request.
 *
 * Every line **complies unless somebody says otherwise**: `deviation` is false by
 * default, so the ordinary quotation costs the writer nothing. A line marked as
 * deviating carries what the customer asked for, what we offer instead, an
 * optional reference into the customer's own document (a datasheet clause, an
 * item number) and an optional remark.
 *
 * One line may depart in several ways — the body material *and* the range *and*
 * the connection — so a deviating line carries a **list** of entries
 * (`deviations`, JSON), each with those four fields. The four original columns
 * still hold the **first** entry, so the reporting export and anything else
 * reading them is unaffected; `deviationEntries` is the only reader and never
 * reads both (the first entry would print twice). A row written before the list
 * existed has no JSON and reads as one entry from its columns.
 *
 * What is printed follows from that and nothing else:
 *  - some line deviates → an English «Technical Deviation List» page is printed
 *    with the proforma, one row per entry, numbered by the quotation's row;
 *  - nothing deviates → no page. `NO_DEVIATION_STATEMENT` is then a line the
 *    form writes into the terms box (`setNoDeviationStatement`), where it can
 *    be deleted; the printout prints whatever the box says and adds nothing.
 *
 * Pure so the form, the server and the printed document read one rule.
 */

/** One way a line departs from the request. */
export interface DeviationEntry {
  reference: string | null;
  requested: string | null;
  offered: string | null;
  remark: string | null;
}

/** How many entries one line may carry — a cap, not a design limit. */
export const MAX_DEVIATIONS_PER_LINE = 20;

/**
 * How long one entry's text may be. The list is an NVARCHAR(MAX) column, so a
 * long multi-line remark is kept whole there; only the copy mirrored into the
 * original NVARCHAR(1000) columns is cut, and nothing prints from that copy.
 */
export const ENTRY_TEXT_MAX = 4000;

export interface DeviationFields {
  deviation?: boolean | null;
  /**
   * The entries: an array from the form, the stored JSON string from the
   * database. Absent means «read the four columns», never «none».
   */
  deviations?: DeviationEntry[] | string | null;
  deviationReference?: string | null;
  deviationRequested?: string | null;
  deviationOffered?: string | null;
  deviationRemark?: string | null;
}

export interface NormalizedDeviation {
  deviation: boolean;
  /** The entries as stored JSON, or null for a complying line. */
  deviations: string | null;
  deviationReference: string | null;
  deviationRequested: string | null;
  deviationOffered: string | null;
  deviationRemark: string | null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Untrimmed: this is what the form reads back on every keystroke, and trimming
 * here swallowed a space or a line break typed at the end of a box the moment
 * it was typed — so nobody could write two words or a second line. The words
 * are trimmed once, on the way to being stored or printed (`filledDeviationEntries`).
 */
const asIs = (value: unknown, max: number): string | null =>
  typeof value === "string" ? value.slice(0, max) : null;

const entryOf = (raw: unknown): DeviationEntry => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    reference: asIs(r.reference, 200),
    requested: asIs(r.requested, ENTRY_TEXT_MAX),
    offered: asIs(r.offered, ENTRY_TEXT_MAX),
    remark: asIs(r.remark, ENTRY_TEXT_MAX),
  };
};

const trimmed = (e: DeviationEntry): DeviationEntry => ({
  reference: text(e.reference, 200),
  requested: text(e.requested, ENTRY_TEXT_MAX),
  offered: text(e.offered, ENTRY_TEXT_MAX),
  remark: text(e.remark, ENTRY_TEXT_MAX),
});

const isBlank = (e: DeviationEntry): boolean => !e.reference && !e.requested && !e.offered && !e.remark;

/**
 * Every entry a line carries, as written — untrimmed and blank ones included,
 * so a form can hold a box somebody has just added and the space just typed. The list wins when present (an array, or
 * stored JSON that parses to one); otherwise the four columns are one entry, or
 * none when they are all empty. Unreadable JSON falls back to the columns,
 * which hold the first entry.
 */
export function deviationEntries(row: DeviationFields | null | undefined): DeviationEntry[] {
  const raw = row?.deviations;
  let list: unknown = undefined;
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try { list = JSON.parse(raw); } catch { list = undefined; }
  }
  if (Array.isArray(list)) return list.slice(0, MAX_DEVIATIONS_PER_LINE).map(entryOf);
  const legacy = trimmed(entryOf({
    reference: row?.deviationReference,
    requested: row?.deviationRequested,
    offered: row?.deviationOffered,
    remark: row?.deviationRemark,
  }));
  return isBlank(legacy) ? [] : [legacy];
}

/** The entries worth printing and storing: the blank ones dropped. */
export function filledDeviationEntries(row: DeviationFields | null | undefined): DeviationEntry[] {
  return deviationEntries(row).map(trimmed).filter((e) => !isBlank(e));
}

/**
 * A complying line stores no deviation text. Unticking the box is «this line
 * complies», and keeping the words would print them again the moment somebody
 * ticked it by accident.
 */
export function normalizeDeviation(row: DeviationFields | null | undefined): NormalizedDeviation {
  const deviation = row?.deviation === true;
  if (!deviation) {
    return {
      deviation: false,
      deviations: null,
      deviationReference: null,
      deviationRequested: null,
      deviationOffered: null,
      deviationRemark: null,
    };
  }
  const entries = filledDeviationEntries(row);
  const first = entries[0];
  return {
    deviation: true,
    deviations: entries.length > 0 ? JSON.stringify(entries) : null,
    // The first entry, mirrored for every reader of the original columns.
    deviationReference: first?.reference ?? null,
    deviationRequested: first?.requested?.slice(0, 1000) ?? null,
    deviationOffered: first?.offered?.slice(0, 1000) ?? null,
    deviationRemark: first?.remark?.slice(0, 1000) ?? null,
  };
}

export function hasDeviations(items: (DeviationFields | null | undefined)[] | null | undefined): boolean {
  return (items ?? []).some((row) => row?.deviation === true);
}

/**
 * A deviation that does not say what is offered is not a deviation anybody can
 * evaluate, and it goes to a customer. Refused with the row numbers named —
 * the form and the server both ask this, since n8n drives the same endpoint.
 * Lines with no product name are dropped on save and are not asked about.
 */
export function deviationRefusal(
  items: ({ productName?: string | null } & DeviationFields)[] | null | undefined,
): string | null {
  const rows: string[] = [];
  (items ?? []).forEach((row, index) => {
    if (!(row?.productName ?? "").trim() || row?.deviation !== true) return;
    const entries = filledDeviationEntries(row);
    const label = `ردیف ${index + 1}`;
    if (entries.length === 0) { rows.push(label); return; }
    const incomplete = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !e.requested || !e.offered)
      .map(({ i }) => i + 1);
    if (incomplete.length === 0) return;
    // A line with one entry is named as before; with several, the entry too.
    rows.push(entries.length === 1 ? label : `${label} (مغایرت ${incomplete.join("، ")})`);
  });
  if (rows.length === 0) return null;
  return `برای ${rows.join("، ")} مغایرت ثبت شده ولی «مشخصهٔ درخواستی» یا «مشخصهٔ پیشنهادی» خالی است. `
    + "هر دو را بنویسید یا تیک مغایرت را بردارید.";
}

/** Opens the printed terms when no line deviates. */
export const NO_DEVIATION_STATEMENT =
  "کلیهٔ اقلام پیشنهادی مطابق درخواست و مشخصات فنی ارسالی کارفرما است و هیچ‌گونه مغایرتی وجود ندارد (No Deviation).";
