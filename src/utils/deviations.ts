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
 * What is printed follows from that and nothing else:
 *  - some line deviates → an English «Technical Deviation List» page is printed
 *    with the proforma, one row per deviating line;
 *  - nothing deviates → no page. `NO_DEVIATION_STATEMENT` is then a line the
 *    form writes into the terms box (`setNoDeviationStatement`), where it can
 *    be deleted; the printout prints whatever the box says and adds nothing.
 *
 * Pure so the form, the server and the printed document read one rule.
 */

export interface DeviationFields {
  deviation?: boolean | null;
  deviationReference?: string | null;
  deviationRequested?: string | null;
  deviationOffered?: string | null;
  deviationRemark?: string | null;
}

export interface NormalizedDeviation {
  deviation: boolean;
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
 * A complying line stores no deviation text. Unticking the box is «this line
 * complies», and keeping the words would print them again the moment somebody
 * ticked it by accident.
 */
export function normalizeDeviation(row: DeviationFields | null | undefined): NormalizedDeviation {
  const deviation = row?.deviation === true;
  if (!deviation) {
    return {
      deviation: false,
      deviationReference: null,
      deviationRequested: null,
      deviationOffered: null,
      deviationRemark: null,
    };
  }
  return {
    deviation: true,
    deviationReference: text(row?.deviationReference, 200),
    deviationRequested: text(row?.deviationRequested, 1000),
    deviationOffered: text(row?.deviationOffered, 1000),
    deviationRemark: text(row?.deviationRemark, 1000),
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
  const rows = (items ?? [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (row?.productName ?? "").trim())
    .filter(({ row }) => row?.deviation === true
      && (!text(row.deviationRequested, 1000) || !text(row.deviationOffered, 1000)))
    .map(({ index }) => `ردیف ${index + 1}`);
  if (rows.length === 0) return null;
  return `برای ${rows.join("، ")} مغایرت ثبت شده ولی «مشخصهٔ درخواستی» یا «مشخصهٔ پیشنهادی» خالی است. `
    + "هر دو را بنویسید یا تیک مغایرت را بردارید.";
}

/** Opens the printed terms when no line deviates. */
export const NO_DEVIATION_STATEMENT =
  "کلیهٔ اقلام پیشنهادی مطابق درخواست و مشخصات فنی ارسالی کارفرما است و هیچ‌گونه مغایرتی وجود ندارد (No Deviation).";
