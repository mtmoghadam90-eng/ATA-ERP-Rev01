/**
 * «اثربخشی تبلیغات» — the rules every figure on that screen is computed by.
 *
 * The spreadsheet this replaces kept eleven typed columns and seven calculated
 * ones side by side, and two things went wrong with it the way they go wrong
 * with every such sheet:
 *
 * - **A blank is not a zero.** A campaign sent yesterday has no leads yet;
 *   reading that as «0 leads» puts it into the channel's CPL denominator and
 *   makes the channel look worse the more recently it was used. A measure is
 *   therefore `null` until somebody records it, and every ratio is taken only
 *   over the campaigns where **both** its halves are recorded.
 * - **An average of ratios is not a ratio.** A channel's CPL is its total cost
 *   over its total leads — what HubSpot, Salesforce and Looker Studio all
 *   report — never the mean of each campaign's CPL, which lets a campaign with
 *   one lead weigh the same as one with forty.
 *
 * Pure, so `test:rules` can hold it and the server and the screen read one
 * copy.
 */

export interface AdCampaignFigures {
  audienceSize: number;
  directCost: number;
  /** «تعداد بازخورد اولیه» — null until recorded. */
  responses: number | null;
  /** «تعداد سرنخ واقعی». */
  leads: number | null;
  /** «تعداد فروش نهایی». */
  sales: number | null;
  /** «درآمد حاصله» in rial. */
  revenue: number | null;
}

export interface AdMetrics {
  /** Initial responses ÷ audience. */
  responseRate: number | null;
  /** Leads ÷ audience. */
  leadRate: number | null;
  /** Sales ÷ audience. */
  saleRate: number | null;
  /** Sales ÷ leads — how well the sales desk turned the leads into orders. */
  leadToSaleRate: number | null;
  /** Cost ÷ initial responses. */
  costPerResponse: number | null;
  /** Cost ÷ leads (CPL). */
  costPerLead: number | null;
  /** Cost ÷ sales (CPA). */
  costPerSale: number | null;
  /** (Revenue − cost) ÷ cost. */
  roi: number | null;
  /** Revenue ÷ cost (ROAS). */
  roas: number | null;
}

const recorded = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** One campaign's figures. A ratio whose half is unrecorded is null, never 0. */
export function adMetricsOf(c: AdCampaignFigures): AdMetrics {
  const cost = Number(c.directCost) || 0;
  const audience = Number(c.audienceSize) || 0;
  return {
    responseRate: recorded(c.responses) ? ratio(c.responses, audience) : null,
    leadRate: recorded(c.leads) ? ratio(c.leads, audience) : null,
    saleRate: recorded(c.sales) ? ratio(c.sales, audience) : null,
    leadToSaleRate: recorded(c.sales) && recorded(c.leads) ? ratio(c.sales, c.leads) : null,
    costPerResponse: recorded(c.responses) ? ratio(cost, c.responses) : null,
    costPerLead: recorded(c.leads) ? ratio(cost, c.leads) : null,
    costPerSale: recorded(c.sales) ? ratio(cost, c.sales) : null,
    roi: recorded(c.revenue) ? ratio(c.revenue - cost, cost) : null,
    roas: recorded(c.revenue) ? ratio(c.revenue, cost) : null,
  };
}

export interface AdAggregate {
  campaigns: number;
  audienceSize: number;
  directCost: number;
  responses: number;
  leads: number;
  sales: number;
  revenue: number;
  metrics: AdMetrics;
}

/**
 * A set of campaigns summed, with every ratio **weighted** and each taken only
 * over the campaigns where both of its halves are recorded — so a campaign
 * still waiting for its leads neither inflates nor deflates the channel's CPL.
 */
export function aggregateAdCampaigns(list: readonly AdCampaignFigures[]): AdAggregate {
  const sum = (pick: (c: AdCampaignFigures) => number) => list.reduce((s, c) => s + pick(c), 0);
  const over = (
    has: (c: AdCampaignFigures) => boolean,
    num: (c: AdCampaignFigures) => number,
    den: (c: AdCampaignFigures) => number,
  ) => {
    const measured = list.filter(has);
    if (measured.length === 0) return null;
    return ratio(measured.reduce((s, c) => s + num(c), 0), measured.reduce((s, c) => s + den(c), 0));
  };
  const cost = (c: AdCampaignFigures) => Number(c.directCost) || 0;
  const audience = (c: AdCampaignFigures) => Number(c.audienceSize) || 0;
  const r = (c: AdCampaignFigures) => c.responses ?? 0;
  const l = (c: AdCampaignFigures) => c.leads ?? 0;
  const s = (c: AdCampaignFigures) => c.sales ?? 0;
  const rev = (c: AdCampaignFigures) => c.revenue ?? 0;
  const hasR = (c: AdCampaignFigures) => recorded(c.responses);
  const hasL = (c: AdCampaignFigures) => recorded(c.leads);
  const hasS = (c: AdCampaignFigures) => recorded(c.sales);
  const hasRev = (c: AdCampaignFigures) => recorded(c.revenue);

  const revenueRatio = (profit: boolean) => {
    const measured = list.filter(hasRev);
    const spent = measured.reduce((a, c) => a + cost(c), 0);
    const earned = measured.reduce((a, c) => a + rev(c), 0);
    if (measured.length === 0) return null;
    return ratio(profit ? earned - spent : earned, spent);
  };

  return {
    campaigns: list.length,
    audienceSize: sum(audience),
    directCost: sum(cost),
    responses: sum(r),
    leads: sum(l),
    sales: sum(s),
    revenue: sum(rev),
    metrics: {
      responseRate: over(hasR, r, audience),
      leadRate: over(hasL, l, audience),
      saleRate: over(hasS, s, audience),
      leadToSaleRate: over((c) => hasS(c) && hasL(c), s, l),
      costPerResponse: over(hasR, cost, r),
      costPerLead: over(hasL, cost, l),
      costPerSale: over(hasS, cost, s),
      roi: revenueRatio(true),
      roas: revenueRatio(false),
    },
  };
}

export interface AdGroupRow extends AdAggregate {
  key: string;
}

/** Grouped and summed; the largest spend first, which is what gets read first. */
export function groupAdCampaigns<T extends AdCampaignFigures>(
  list: readonly T[],
  keyOf: (c: T) => string,
): AdGroupRow[] {
  const groups = new Map<string, T[]>();
  for (const c of list) {
    const key = keyOf(c).trim() || "نامشخص";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({ key, ...aggregateAdCampaigns(rows) }))
    .sort((a, b) => b.directCost - a.directCost || a.key.localeCompare(b.key));
}

/** «۱۴۰۵/۰۶» from a Shamsi date, the month a campaign is reported under. */
export function adMonthOf(runDateJalali: string | null | undefined): string {
  const m = /^(\d{4})\/(\d{2})/.exec(String(runDateJalali ?? ""));
  return m ? `${m[1]}/${m[2]}` : "بدون تاریخ";
}

/**
 * The next campaign code: «cp» and one more than the highest number used, the
 * spreadsheet's own convention, so imported rows and new ones share a series.
 */
export function nextAdCampaignCode(existing: readonly string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = /^cp(\d+)$/i.exec(String(code).trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `cp${max + 1}`;
}

/** Channel quality is a 1–5 judgement; anything else is «not rated». */
export function adQuality(raw: unknown): number | null {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** The company's own lists on the day the module shipped, from its spreadsheet. */
export const DEFAULT_AD_CHANNELS = [
  "پیامک", "ایمیل", "تماس سرد", "محتوای لینکدین", "پیام واتس اپ", "سایت",
  "نمایشگاه", "سمینار", "سایت ویزیت", "پیام بله",
];
export const DEFAULT_AD_AUDIENCES = [
  "دیتابیس مشتریان ابزار کنترل", "خبرنامه", "مدیران فنی صنایع غذایی",
  "متخصصین ابزاردقیق - دیتا ملی پیامک", "کلیه شماره های موجود",
];

/* ------------------------------ the sheet ------------------------------- */

/**
 * The columns of the spreadsheet this module replaces, by their own headers.
 *
 * Only the **typed** columns are read. The seven calculated ones («نرخ تبدیل…»,
 * «هزینه جذب…», «نرخ بازگشت سرمایه») are ignored on import on purpose: they are
 * derived here, and reading them back would be a second, stale copy of a figure
 * that must follow its inputs.
 */
export const AD_SHEET_COLUMNS = {
  code: "کد کمپین",
  runDate: "تاریخ اجرا",
  channel: "نوع کانال",
  topic: "موضوع",
  audience: "مخاطب",
  audienceSize: "تعداد مخاطب",
  directCost: "هزینه مستقیم",
  responses: "تعداد بازخورد اولیه",
  leads: "تعداد سرنخ واقعی",
  sales: "تعداد فروش نهایی",
  revenue: "درآمد حاصله",
  quality: "کیفیت کانال",
  notes: "توضیحات کیفی/درس آموخته",
} as const;

export interface AdSheetRow {
  code: string | null;
  runDate: string | null;
  channel: string;
  topic: string;
  audience: string | null;
  audienceSize: number;
  directCost: number;
  responses: number | null;
  leads: number | null;
  sales: number | null;
  revenue: number | null;
  quality: number | null;
  notes: string | null;
}

const toLatin = (v: unknown) => String(v ?? "")
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[٬,\s]/g, "")
  .replace(/٫/g, ".");

/** A blank cell is «not recorded», never zero. */
export function sheetNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = toLatin(raw);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * An Excel date cell as a Shamsi string. The sheet stores a serial day number
 * (46055 is 2026-02-02); a cell typed as «۱۴۰۴/۱۱/۱۲» is taken as written.
 * `toShamsi` is injected so this stays free of the calendar module.
 */
export function sheetDate(raw: unknown, toShamsi: (d: Date) => string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // UTC midnight of that day, the form `toShamsiStr` is written for.
    return toShamsi(new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86_400_000));
  }
  if (raw instanceof Date) return toShamsi(raw);
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(toLatin(raw));
  if (!m) return null;
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

/** One sheet row read by its headers; null when it names no channel and no topic. */
export function parseAdSheetRow(
  row: Record<string, unknown>,
  toShamsi: (d: Date) => string,
): AdSheetRow | null {
  const cell = (k: keyof typeof AD_SHEET_COLUMNS) => row[AD_SHEET_COLUMNS[k]];
  const text = (k: keyof typeof AD_SHEET_COLUMNS) => String(cell(k) ?? "").trim();
  const channel = text("channel");
  const topic = text("topic");
  if (!channel && !topic) return null;
  const count = (k: keyof typeof AD_SHEET_COLUMNS) => {
    const n = sheetNumber(cell(k));
    return n === null ? null : Math.max(0, Math.round(n));
  };
  return {
    code: text("code") || null,
    runDate: sheetDate(cell("runDate"), toShamsi),
    channel,
    topic,
    audience: text("audience") || null,
    audienceSize: count("audienceSize") ?? 0,
    directCost: Math.max(0, sheetNumber(cell("directCost")) ?? 0),
    responses: count("responses"),
    leads: count("leads"),
    sales: count("sales"),
    revenue: (() => { const n = sheetNumber(cell("revenue")); return n === null ? null : Math.max(0, n); })(),
    quality: adQuality(cell("quality")),
    notes: text("notes") || null,
  };
}
