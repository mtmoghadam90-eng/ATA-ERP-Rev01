import { nameKey } from "./assigneeName";

/**
 * Which goods are actually being asked for, and how often.
 *
 * The assistant could not answer «بیشترین درخواست برای چه کالایی بوده» — the
 * most ordinary question a sales desk asks about its own catalogue — because
 * nothing in this application aggregated demand at all. What it *did* have was
 * `dashboard_summary`, whose `revenueByCategory` is **won revenue per
 * category**, so the model answered with the category holding the largest
 * settled contracts and presented it as the most-requested item. Three things
 * wrong at once, and each on its own would have produced a confident wrong
 * answer: revenue is not a count (one large pressure contract outweighs fifty
 * flow meters), *won* is not *requested* (the whole point of the question is
 * usually the ones being asked for and not sold), and a **category is not a
 * product** — which is exactly what the person asking said they wanted.
 *
 * So the fix is not a better prompt. It is the missing measurement, and the
 * evidence for it has been on disk since the first quotation: every
 * `proforma_items` row is a customer asking for a price, with a product, a
 * quantity, a date and an outcome on it.
 *
 * Everything here is pure so `test:rules` can hold it; the queries are
 * `src/server/services/demandService.ts`.
 */

/* -------------------------------- sources -------------------------------- */

/**
 * Where a «درخواست» is recorded, and what one row of it means.
 *
 * Three tables carry a `productId` and a quantity, and they are **not** three
 * spellings of one thing — answering from the wrong one is the same class of
 * error as answering from `revenueByCategory`. So the source is a parameter,
 * every answer names the one it used, and the description travels with the
 * result rather than living only here.
 */
export const DEMAND_SOURCES = {
  /** A quotation line: a customer asked us what this costs. */
  PROFORMA: "PROFORMA",
  /** A project's «اقلام مورد نیاز»: the scope of a job, often before any quote. */
  PROJECT: "PROJECT",
  /** A supplier inquiry line: we asked a supplier to price it. */
  INQUIRY: "INQUIRY",
} as const;

export type DemandSource = typeof DEMAND_SOURCES[keyof typeof DEMAND_SOURCES];

export interface DemandSourceSpec {
  id: DemandSource;
  label: string;
  /** What one row means, in the sentence the answer will repeat. */
  meaning: string;
  /** Whether a line here carries a won/lost outcome. Only a quotation does. */
  hasOutcome: boolean;
}

export const DEMAND_SOURCE_SPECS: Record<DemandSource, DemandSourceSpec> = {
  PROFORMA: {
    id: "PROFORMA",
    label: "پیش‌فاکتورها",
    meaning: "هر ردیف یعنی یک بار که مشتری برای این کالا درخواست قیمت داده است",
    hasOutcome: true,
  },
  PROJECT: {
    id: "PROJECT",
    label: "اقلام مورد نیاز پروژه‌ها",
    meaning: "هر ردیف یعنی یک بار که این کالا در شرح نیاز یک پروژه آمده است",
    hasOutcome: false,
  },
  INQUIRY: {
    id: "INQUIRY",
    label: "استعلام‌های خرید",
    meaning: "هر ردیف یعنی یک بار که ما این کالا را از یک تأمین‌کننده استعلام کرده‌ایم",
    hasOutcome: false,
  },
};

export const ALL_DEMAND_SOURCES: DemandSource[] = [
  DEMAND_SOURCES.PROFORMA, DEMAND_SOURCES.PROJECT, DEMAND_SOURCES.INQUIRY,
];

export const isDemandSource = (value: unknown): value is DemandSource =>
  typeof value === "string" && (ALL_DEMAND_SOURCES as string[]).includes(value);

/** Absent is the quotation, which is what «درخواست مشتری» means without qualification. */
export function demandSourceOf(value: unknown): DemandSource {
  return isDemandSource(value) ? value : DEMAND_SOURCES.PROFORMA;
}

/* ------------------------------- groupings ------------------------------- */

export const DEMAND_GROUPINGS = {
  /** The catalogue item. The default, because it is what people mean by «کالا». */
  PRODUCT: "PRODUCT",
  /** The exact SKU — «۶ اینچ، فلنجی» rather than «فلومتر توربینی». */
  VARIANT: "VARIANT",
  /** The category. Offered so a broad question is answered broadly *on purpose*. */
  CATEGORY: "CATEGORY",
} as const;

export type DemandGrouping = typeof DEMAND_GROUPINGS[keyof typeof DEMAND_GROUPINGS];

export const DEMAND_GROUPING_LABELS: Record<DemandGrouping, string> = {
  PRODUCT: "کالا",
  VARIANT: "کد فنی (SKU)",
  CATEGORY: "دسته‌بندی",
};

export const ALL_DEMAND_GROUPINGS: DemandGrouping[] = [
  DEMAND_GROUPINGS.PRODUCT, DEMAND_GROUPINGS.VARIANT, DEMAND_GROUPINGS.CATEGORY,
];

export const isDemandGrouping = (value: unknown): value is DemandGrouping =>
  typeof value === "string" && (ALL_DEMAND_GROUPINGS as string[]).includes(value);

/**
 * Absent is the product.
 *
 * Deliberately **not** the category: answering a product question at category
 * level is the exact failure this module exists to correct, so the broad answer
 * has to be asked for by name.
 */
export function demandGroupingOf(value: unknown): DemandGrouping {
  return isDemandGrouping(value) ? value : DEMAND_GROUPINGS.PRODUCT;
}

/* -------------------------------- outcome -------------------------------- */

/** Which lines to count, when the source has outcomes at all. */
export const DEMAND_OUTCOMES = {
  ALL: "ALL",
  WON: "WON",
  LOST: "LOST",
  /** Still in play: not won, not lost, not cancelled. */
  OPEN: "OPEN",
} as const;

export type DemandOutcome = typeof DEMAND_OUTCOMES[keyof typeof DEMAND_OUTCOMES];

export const DEMAND_OUTCOME_LABELS: Record<DemandOutcome, string> = {
  ALL: "همه درخواست‌ها",
  WON: "فقط ردیف‌های برنده",
  LOST: "فقط ردیف‌های بازنده",
  OPEN: "فقط ردیف‌های در جریان",
};

export const ALL_DEMAND_OUTCOMES: DemandOutcome[] = [
  DEMAND_OUTCOMES.ALL, DEMAND_OUTCOMES.WON, DEMAND_OUTCOMES.LOST, DEMAND_OUTCOMES.OPEN,
];

export const isDemandOutcome = (value: unknown): value is DemandOutcome =>
  typeof value === "string" && (ALL_DEMAND_OUTCOMES as string[]).includes(value);

export function demandOutcomeOf(value: unknown): DemandOutcome {
  return isDemandOutcome(value) ? value : DEMAND_OUTCOMES.ALL;
}

/**
 * Whether a line's stored status belongs to the outcome being asked for.
 *
 * **OPEN is an exclusion**, the rule this codebase keeps arriving back at: a
 * line carries `null` while nobody has decided, and a status nobody anticipated
 * has to stay countable rather than silently vanishing from every answer.
 */
export function lineMatchesOutcome(
  status: string | null | undefined,
  outcome: DemandOutcome,
  words: { won: string; lost: string; cancelled: string },
): boolean {
  const value = String(status ?? "").trim();
  if (outcome === "ALL") return true;
  if (outcome === "WON") return value === words.won;
  if (outcome === "LOST") return value === words.lost;
  return value !== words.won && value !== words.lost && value !== words.cancelled;
}

/* ------------------------------- the rows -------------------------------- */

/**
 * One line, reduced to what the count needs.
 *
 * `productId` is nullable in all three tables and that is not an edge case: a
 * quotation line is free text until somebody picks a catalogue item, and an
 * inquiry is routinely the first time a part is mentioned at all. Dropping
 * those rows would understate exactly the goods the company does not yet
 * stock — which is the half of «چه چیزی از ما می‌خواهند» worth knowing.
 */
export interface DemandLine {
  /** The document the line sits on, so one appearance is one request. */
  documentId: string;
  /** Who asked, when the source knows. Counted distinctly. */
  partyId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  /** The line's own words, which is all a free-text row has. */
  name: string;
  /** The catalogue name, when the line names a product. */
  productName?: string | null;
  productCode?: string | null;
  variantSku?: string | null;
  category?: string | null;
  quantity: number;
  /** In rial, and only where the source has a price at all. */
  valueRial?: number | null;
  status?: string | null;
}

/**
 * The bucket a line falls in.
 *
 * A line naming a catalogue item is grouped by its **id**, never by its words:
 * `productName` is copied onto the line at save time and a product renamed
 * since would split its own history in two. A free-text line has no id, so it
 * is grouped by its words folded — the same folding a colleague's name gets
 * (`nameKey`), plus case, because Persian has none for this to affect while a
 * Latin part number typed two ways is one part. The `free:` prefix is what
 * stops a free-text line whose words happen to equal a product id — or another
 * grouping's key — from being merged into it.
 */
export function demandKey(line: DemandLine, grouping: DemandGrouping): string {
  if (grouping === "CATEGORY") {
    const category = String(line.category ?? "").trim();
    return category ? `cat:${nameKey(category).toLowerCase()}` : "cat:";
  }
  if (grouping === "VARIANT" && line.variantId) return `var:${line.variantId}`;
  if (line.productId) return `prod:${line.productId}`;
  const folded = nameKey(line.name).toLowerCase();
  return folded ? `free:${folded}` : "free:";
}

/** What to call the bucket on screen. */
export function demandLabel(line: DemandLine, grouping: DemandGrouping): string {
  if (grouping === "CATEGORY") return String(line.category ?? "").trim() || "بدون دسته‌بندی";
  if (grouping === "VARIANT" && line.variantSku) return line.variantSku;
  return String(line.productName ?? "").trim()
    || String(line.name ?? "").trim()
    || "بدون نام";
}

export interface DemandRow {
  key: string;
  label: string;
  productId: string | null;
  productCode: string | null;
  variantSku: string | null;
  category: string | null;
  /** True when nothing here names a catalogue item — the goods we do not carry. */
  offCatalogue: boolean;
  /** Distinct documents. **This is «چند بار درخواست شده».** */
  requests: number;
  /** Lines, which a document may hold more than one of for the same goods. */
  lines: number;
  /** Distinct customers or suppliers, where the source names one. */
  parties: number;
  quantity: number;
  valueRial: number;
  wonLines: number;
  lostLines: number;
  openLines: number;
}

/**
 * The lines folded into ranked rows.
 *
 * **Every measure is on every row**, deliberately. The reported failure was a
 * model handed one number and reporting it as another, so a result that carries
 * the count, the quantity and the value together cannot be misread the same
 * way: whichever the reader wanted is present and labelled, and the answer can
 * say «۱۲ بار، ۳۴ دستگاه» without a second call.
 */
export function foldDemand(
  lines: DemandLine[],
  grouping: DemandGrouping,
  words: { won: string; lost: string; cancelled: string },
): DemandRow[] {
  const buckets = new Map<string, DemandRow & {
    documents: Set<string>; partySet: Set<string>;
  }>();

  for (const line of lines) {
    const key = demandKey(line, grouping);
    let row = buckets.get(key);
    if (!row) {
      row = {
        key,
        label: demandLabel(line, grouping),
        productId: line.productId ?? null,
        productCode: line.productCode ?? null,
        variantSku: grouping === "VARIANT" ? (line.variantSku ?? null) : null,
        category: line.category ?? null,
        offCatalogue: !line.productId,
        requests: 0, lines: 0, parties: 0, quantity: 0, valueRial: 0,
        wonLines: 0, lostLines: 0, openLines: 0,
        documents: new Set<string>(), partySet: new Set<string>(),
      };
      buckets.set(key, row);
    }

    /*
     * A bucket reached first by a free-text line and later by a catalogue one
     * takes the catalogue's identity. Under CATEGORY grouping that is how the
     * category's own rows fill in a product code they should not have, so the
     * fields are only ever filled in and never overwritten, and the identity
     * fields are left alone once set.
     */
    if (!row.productId && line.productId) {
      row.productId = line.productId;
      row.offCatalogue = false;
    }
    if (!row.productCode && line.productCode) row.productCode = line.productCode;
    if (!row.category && line.category) row.category = line.category;

    row.lines += 1;
    row.documents.add(line.documentId);
    if (line.partyId) row.partySet.add(String(line.partyId));
    row.quantity += Number.isFinite(line.quantity) ? line.quantity : 0;
    row.valueRial += Number.isFinite(Number(line.valueRial)) ? Number(line.valueRial) : 0;

    const status = String(line.status ?? "").trim();
    if (status === words.won) row.wonLines += 1;
    else if (status === words.lost) row.lostLines += 1;
    else if (status !== words.cancelled) row.openLines += 1;
  }

  const rows = [...buckets.values()].map((row) => {
    const { documents, partySet, ...rest } = row;
    return { ...rest, requests: documents.size, parties: partySet.size };
  });

  return rankDemand(rows);
}

/**
 * Most-asked-for first.
 *
 * Requests lead, because that is the question. Quantity breaks the tie —
 * between two products each quoted four times, the one people wanted forty of
 * is the bigger demand — and value breaks that, so the order is total rather
 * than «whatever `Map` iteration produced», which would make the same question
 * answer differently on two runs.
 */
export function rankDemand<T extends {
  requests: number; quantity: number; valueRial: number; label: string;
}>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    b.requests - a.requests
    || b.quantity - a.quantity
    || b.valueRial - a.valueRial
    || a.label.localeCompare(b.label, "fa"));
}

/* ------------------------------ the sentence ------------------------------ */

export interface DemandDescription {
  source: DemandSource;
  grouping: DemandGrouping;
  outcome: DemandOutcome;
  fromJalali?: string | null;
  toJalali?: string | null;
  category?: string | null;
  truncated: boolean;
}

/**
 * What was measured, said in the answer's own language.
 *
 * The result travels with this rather than relying on the field names, because
 * the failure being corrected is precisely a model reading a number whose
 * meaning it had to infer. A count of quotations and a sum of won revenue are
 * both «a number about products by category» to anything that only sees the
 * figure — so the figure carries its own sentence, and the prompt tells the
 * model to repeat it.
 */
export function describeDemand(input: DemandDescription): string {
  const spec = DEMAND_SOURCE_SPECS[input.source];
  const parts = [
    `منبع: ${spec.label} — ${spec.meaning}.`,
    `سطح گزارش: ${DEMAND_GROUPING_LABELS[input.grouping]}.`,
  ];

  if (spec.hasOutcome && input.outcome !== "ALL") {
    parts.push(`${DEMAND_OUTCOME_LABELS[input.outcome]}.`);
  }

  const from = String(input.fromJalali ?? "").trim();
  const to = String(input.toJalali ?? "").trim();
  if (from || to) {
    parts.push(`بازه: ${from || "ابتدا"} تا ${to || "امروز"}.`);
  } else {
    parts.push("بازه: کل سوابق.");
  }

  const category = String(input.category ?? "").trim();
  if (category) parts.push(`فقط دسته «${category}».`);

  if (input.truncated) {
    parts.push(
      "هشدار: تعداد ردیف‌ها از سقف پویش بیشتر بود و قدیمی‌ترین‌ها خوانده نشده‌اند؛"
      + " این عدد کف واقعیت است. برای پاسخ دقیق بازه زمانی را محدود کنید و این"
      + " نکته را به کاربر بگویید.",
    );
  }

  return parts.join(" ");
}

/**
 * Why this cannot be answered as asked, or null.
 *
 * A reversed range is the one that matters: it answers with nothing at all, and
 * «هیچ کالایی درخواست نشده» is a sentence somebody would believe.
 */
export function demandRefusal(fromJalali: string, toJalali: string): string | null {
  const from = String(fromJalali ?? "").trim();
  const to = String(toJalali ?? "").trim();
  if (from && to && from > to) {
    return `بازه زمانی وارونه است: «${from}» بعد از «${to}» است.`;
  }
  return null;
}
