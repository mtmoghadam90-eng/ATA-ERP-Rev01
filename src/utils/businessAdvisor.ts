/**
 * «مشاور کسب‌وکار» — the pure half.
 *
 * The dashboard assistant was asked to act like a business adviser: name the
 * bottlenecks, the work that looks forgotten, what could be done for one
 * customer right now, and how a process could be improved — all from the real
 * data. A model handed raw tables and asked «چه توصیه‌ای داری» writes advice
 * that *sounds* considered and rests on nothing, which is the one thing an
 * adviser must not do. So the reading of the evidence is here, in rules a test
 * can hold, and the model's job is the part a model is good at: ordering what
 * these rules found and saying it in a sentence somebody can act on.
 *
 * Every signal carries the record it rests on (`ref`) and the figure that
 * raised it (`days`), so a recommendation can always name both — and a signal
 * is a **candidate**, never a verdict: «۲۸ روز بدون فعالیت» is a fact, «این
 * پروژه رها شده» is a reading of it that a person confirms.
 */

/* ------------------------------- thresholds ------------------------------- */

/**
 * How long before something reads as forgotten.
 *
 * These are **defaults, not policy**: `settings.assistant.advisorThresholds`
 * overrides any of them from the assistant's own settings tab, because «پروژه‌ی
 * بدون فعالیت» means three weeks for one company and three days for another.
 * Named rather than buried in a query, since the measured sentence beside every
 * answer has to say them — «فعالیتی ثبت نشده» means nothing without «در ۲۱ روز
 * گذشته».
 */
export interface AdvisorThresholds {
  /** An open sales-stage project with no write and no feed message for this long. */
  quietProjectDays: number;
  /** An open referral raised this long ago. */
  staleReferralDays: number;
  /** A live quotation whose validity ends within this many days. */
  expiringQuoteDays: number;
  /** …or ended this recently and is still open (an offer that lapsed unnoticed). */
  lapsedQuoteDays: number;
  /** A valuable customer (A/B) with no purchase for this long. */
  dormantCustomerDays: number;
  /** A lost quotation recent enough to be worth a second offer. */
  recentLossDays: number;
  /** How far back «why we lose» reads lost projects. */
  lossWindowDays: number;
}

export type AdvisorThresholdKey = keyof AdvisorThresholds;

export const DEFAULT_ADVISOR_THRESHOLDS: AdvisorThresholds = {
  quietProjectDays: 21,
  staleReferralDays: 7,
  expiringQuoteDays: 7,
  lapsedQuoteDays: 30,
  dormantCustomerDays: 180,
  recentLossDays: 365,
  lossWindowDays: 180,
};

/** Kept as the name the rest of the code reads the defaults by. */
export const ADVISOR_THRESHOLDS = DEFAULT_ADVISOR_THRESHOLDS;

/**
 * The settings screen's rows, in the order they are drawn. One list, so the
 * form and the resolver cannot disagree about which keys exist or their bounds.
 * Every bound is at least 1: a zero would make «۰ روز بدون فعالیت» flag every
 * project in the company, which is noise rather than a setting.
 */
export const ADVISOR_THRESHOLD_FIELDS: {
  key: AdvisorThresholdKey; label: string; hint: string; min: number; max: number;
}[] = [
  { key: "quietProjectDays", label: "پروژه‌ی فروش بدون فعالیت", hint: "روز بدون ویرایش و بدون پیام در فعالیت‌ها", min: 1, max: 365 },
  { key: "staleReferralDays", label: "ارجاع باز قدیمی", hint: "روز از ثبت ارجاعی که هنوز انجام نشده", min: 1, max: 180 },
  { key: "expiringQuoteDays", label: "پیش‌فاکتور در آستانه‌ی انقضا", hint: "روز مانده تا پایان اعتبار", min: 1, max: 90 },
  { key: "lapsedQuoteDays", label: "پیش‌فاکتور منقضی‌شده‌ی هنوز باز", hint: "تا چند روز پس از انقضا یادآوری شود", min: 1, max: 365 },
  { key: "dormantCustomerDays", label: "مشتری ارزشمند بدون خرید", hint: "روز از آخرین خرید مشتری رتبه‌ی A/B", min: 1, max: 1825 },
  { key: "recentLossDays", label: "باخت اخیر قابل پیشنهاد دوباره", hint: "باخت‌های چند روز گذشته بررسی شود", min: 1, max: 1825 },
  { key: "lossWindowDays", label: "بازه‌ی تحلیل دلایل باخت", hint: "روزهای گذشته در گزارش گلوگاه‌ها", min: 7, max: 1825 },
];

/**
 * The stored overrides filled in with the defaults and bounded.
 *
 * A key the document does not carry, or carries as something that is not a
 * whole number, takes its default — a half-typed box must not blank a rule.
 */
export function resolveAdvisorThresholds(stored: unknown): AdvisorThresholds {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_ADVISOR_THRESHOLDS };
  for (const f of ADVISOR_THRESHOLD_FIELDS) {
    const v = raw[f.key];
    if (v === null || v === undefined || v === "") continue;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) continue;
    out[f.key] = Math.min(f.max, Math.max(f.min, n));
  }
  return out;
}

/* --------------------------------- signals -------------------------------- */

export const SIGNAL_KINDS = [
  "STUCK",
  "OVERDUE_TASK",
  "STALE_REFERRAL",
  "EXPIRING_QUOTE",
  "LAPSED_QUOTE",
  "QUOTE_WITHOUT_NEXT_ACTION",
  "QUIET_PROJECT",
  "DORMANT_CUSTOMER",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  STUCK: "کار متوقف در یک مرحله",
  OVERDUE_TASK: "وظیفه‌ی عقب‌افتاده",
  STALE_REFERRAL: "ارجاع باز قدیمی",
  EXPIRING_QUOTE: "پیش‌فاکتور در آستانه‌ی انقضا",
  LAPSED_QUOTE: "پیش‌فاکتور منقضی‌شده‌ی هنوز باز",
  QUOTE_WITHOUT_NEXT_ACTION: "پیش‌فاکتور باز بدون اقدام بعدی",
  QUIET_PROJECT: "پروژه‌ی فروش بدون فعالیت",
  DORMANT_CUSTOMER: "مشتری ارزشمند بدون خرید اخیر",
};

export type Severity = "HIGH" | "MEDIUM" | "LOW";
const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export interface SignalRef {
  /** What kind of record — the screen to open. */
  type: "project" | "proforma" | "task" | "referral" | "customer" | "purchaseOrder" | "afterSales";
  id: string;
  /** What it is called on screen: a code, a number, a title. */
  label: string;
  projectCode?: string | null;
  customerName?: string | null;
}

export interface Signal {
  kind: SignalKind;
  severity: Severity;
  /** The fact, in Persian, with its figure in it. */
  fact: string;
  /** Days overdue, idle or since — the number the fact is about. */
  days: number | null;
  /** Who it is waiting on, where the record names somebody. */
  owner?: string | null;
  ref: SignalRef;
}

/**
 * Most pressing first: severity, then the larger figure, then the label so the
 * order is stable from one question to the next.
 */
export function rankSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (b.days ?? -1) - (a.days ?? -1)
    || a.ref.label.localeCompare(b.ref.label, "fa"));
}

/**
 * How bad an overdue task is, by how far past its date it is.
 *
 * A week late is high whatever the task: by then whoever is waiting on it has
 * usually stopped waiting and started working around it.
 */
export function overdueSeverity(daysLate: number): Severity {
  if (daysLate >= 7) return "HIGH";
  if (daysLate >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * A quotation's validity, read against today.
 *
 * `daysToExpiry` is negative once it has lapsed. Null means no question: the
 * document has no expiry (blank means «does not lapse»), or it is far enough
 * either side that it is not news.
 */
export function quoteExpirySignal(
  daysToExpiry: number | null,
  t: AdvisorThresholds = DEFAULT_ADVISOR_THRESHOLDS,
): {
  kind: "EXPIRING_QUOTE" | "LAPSED_QUOTE"; severity: Severity;
} | null {
  if (daysToExpiry === null) return null;
  if (daysToExpiry >= 0 && daysToExpiry <= t.expiringQuoteDays) {
    return { kind: "EXPIRING_QUOTE", severity: daysToExpiry <= 2 ? "HIGH" : "MEDIUM" };
  }
  if (daysToExpiry < 0 && -daysToExpiry <= t.lapsedQuoteDays) {
    return { kind: "LAPSED_QUOTE", severity: "MEDIUM" };
  }
  return null;
}

/** Counts per kind — the part of the answer that says how big each problem is. */
export function countSignals(signals: Signal[]): Record<SignalKind, number> {
  const out = Object.fromEntries(SIGNAL_KINDS.map((k) => [k, 0])) as Record<SignalKind, number>;
  for (const s of signals) out[s.kind]++;
  return out;
}

/* ------------------------------- bottlenecks ------------------------------ */

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface StateDwell {
  section: string;
  state: string;
  dwellDays: number | null;
  overdue: boolean;
}

export interface Bottleneck {
  section: string;
  state: string;
  /** Records sitting in this state right now. */
  count: number;
  /** Of those, how many are past their allowed time. */
  overdue: number;
  /** Median days in the state, over the records whose clock is known. */
  medianDays: number | null;
}

/**
 * Where work piles up: one row per state, the states holding the most overdue
 * work first.
 *
 * The **median**, never the mean — one order forgotten in customs for a year
 * would otherwise make a leg that normally takes three days read as the
 * company's worst. Overdue leads the order rather than the count, because a
 * state holding thirty records that are all on time is a busy leg, not a
 * bottleneck.
 */
export function bottlenecksByState(rows: StateDwell[]): Bottleneck[] {
  const groups = new Map<string, StateDwell[]>();
  for (const r of rows) {
    const key = `${r.section}\u0000${r.state}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.values()]
    .map((list) => ({
      section: list[0].section,
      state: list[0].state,
      count: list.length,
      overdue: list.filter((r) => r.overdue).length,
      medianDays: median(list.map((r) => r.dwellDays).filter((d): d is number => d !== null)),
    }))
    .sort((a, b) => b.overdue - a.overdue || b.count - a.count || (b.medianDays ?? 0) - (a.medianDays ?? 0));
}

/** Overdue work per person — where the load is, not who is to blame. */
export function tallyByOwner(owners: (string | null | undefined)[]): { owner: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const raw of owners) {
    const owner = String(raw ?? "").trim() || "بدون مسئول";
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner, "fa"));
}

/** Losses by reason. A blank reason is counted as one, because it is itself a finding. */
export const UNSTATED_REASON = "دلیل ثبت نشده";

export function tallyReasons(reasons: (string | null | undefined)[]): { reason: string; count: number; share: number }[] {
  const total = reasons.length;
  return tallyByOwner(reasons.map((r) => String(r ?? "").trim() || UNSTATED_REASON))
    .map(({ owner, count }) => ({
      reason: owner,
      count,
      share: total ? Math.round((count / total) * 100) : 0,
    }));
}

/* ------------------------- one customer's opportunities ------------------------ */

export interface CustomerQuote {
  id: string;
  number: string;
  /** The derived outcome — «جاری», «باخته», … */
  outcome: string;
  settled: boolean;
  ageDays: number | null;
  daysToExpiry: number | null;
  hasNextAction: boolean;
  followUpState: string;
  lossReason: string | null;
  competitor: string | null;
  projectCode: string | null;
}

export interface CustomerOpportunityInput {
  customerName: string;
  rank: string | null;
  daysSinceLastPurchase: number | null;
  everPurchased: boolean;
  quotes: CustomerQuote[];
  /** Goods this customer asked for that were never won on any document. */
  askedNeverBought: { name: string; requests: number }[];
  openAfterSales: { label: string; status: string; projectCode: string | null }[];
  openProjects: { id: string; code: string; name: string; stage: string | null; quietDays: number | null }[];
}

export type HintKind =
  | "RESOLVE_COMPLAINT"
  | "CHASE_OPEN_QUOTE"
  | "RENEW_EXPIRING_QUOTE"
  | "REOFFER_LOST"
  | "CROSS_SELL_ASKED"
  | "REACTIVATE"
  | "REVIVE_QUIET_PROJECT"
  | "FIRST_SALE";

export interface OpportunityHint {
  kind: HintKind;
  severity: Severity;
  /** What the data says. */
  basis: string;
  /** What that suggests doing — a starting point, worded as a suggestion. */
  suggestion: string;
  refs: string[];
}

const PRICE_WORDS = ["قیمت", "گران", "price"];
const isPriceLoss = (reason: string | null) =>
  !!reason && PRICE_WORDS.some((w) => reason.toLowerCase().includes(w));

/**
 * What could be done for this customer now, each with the evidence for it.
 *
 * Two orderings are decisions rather than tidiness. **An open complaint comes
 * first and is said to come first**: an offer sent into an unresolved warranty
 * case reads as not knowing, so the hint is to settle it before selling. And
 * **a chase on a live quotation outranks a new idea**: an offer already on the
 * customer's desk is nearer to a sale than anything not yet written.
 */
export function customerOpportunityHints(
  input: CustomerOpportunityInput,
  t: AdvisorThresholds = DEFAULT_ADVISOR_THRESHOLDS,
): OpportunityHint[] {
  const hints: OpportunityHint[] = [];

  if (input.openAfterSales.length > 0) {
    hints.push({
      kind: "RESOLVE_COMPLAINT",
      severity: "HIGH",
      basis: `${input.openAfterSales.length} پرونده‌ی خدمات پس از فروش باز (${input.openAfterSales
        .map((s) => `${s.label}: ${s.status}`).join("، ")}).`,
      suggestion: "پیش از هر پیشنهاد فروش تازه، وضعیت این پرونده‌ها را با مشتری روشن کنید.",
      refs: input.openAfterSales.map((s) => s.projectCode ?? s.label),
    });
  }

  for (const q of input.quotes.filter((x) => !x.settled)) {
    const expiry = quoteExpirySignal(q.daysToExpiry, t);
    if (expiry) {
      hints.push({
        kind: "RENEW_EXPIRING_QUOTE",
        severity: expiry.severity,
        basis: expiry.kind === "EXPIRING_QUOTE"
          ? `اعتبار پیش‌فاکتور ${q.number} ${q.daysToExpiry} روز دیگر تمام می‌شود و هنوز تعیین‌تکلیف نشده.`
          : `اعتبار پیش‌فاکتور ${q.number} ${-(q.daysToExpiry ?? 0)} روز پیش تمام شده و هنوز باز است.`,
        suggestion: "تماس بگیرید و تصمیم مشتری را بپرسید؛ در صورت نیاز اعتبار را تمدید یا نسخه‌ی جدید صادر کنید.",
        refs: [q.number],
      });
    } else if (!q.hasNextAction && q.followUpState === "OPEN") {
      hints.push({
        kind: "CHASE_OPEN_QUOTE",
        severity: (q.ageDays ?? 0) >= 14 ? "HIGH" : "MEDIUM",
        basis: `پیش‌فاکتور ${q.number} ${q.ageDays ?? "?"} روز است صادر شده و هیچ اقدام بعدی برایش ثبت نشده.`,
        suggestion: "یک پیگیری با تاریخ مشخص ثبت کنید تا این پیشنهاد رها نشود.",
        refs: [q.number],
      });
    }
  }

  const recentLosses = input.quotes.filter((q) =>
    q.outcome === "باخته" && (q.ageDays ?? Infinity) <= t.recentLossDays);
  const priceLosses = recentLosses.filter((q) => isPriceLoss(q.lossReason));
  if (priceLosses.length > 0) {
    const rivals = [...new Set(priceLosses.map((q) => q.competitor).filter(Boolean))];
    hints.push({
      kind: "REOFFER_LOST",
      severity: "MEDIUM",
      basis: `${priceLosses.length} پیش‌فاکتور در ${t.recentLossDays} روز گذشته به دلیل قیمت باخته شده`
        + (rivals.length ? ` (رقیب: ${rivals.join("، ")}).` : "."),
      suggestion: "برای خرید بعدی گزینه‌ی اقتصادی‌تر یا برند جایگزین پیشنهاد دهید و زودتر از رقیب قیمت بدهید.",
      refs: priceLosses.map((q) => q.number),
    });
  }

  if (input.askedNeverBought.length > 0) {
    const top = input.askedNeverBought.slice(0, 5);
    hints.push({
      kind: "CROSS_SELL_ASKED",
      severity: "MEDIUM",
      basis: `این کالاها را استعلام کرده ولی هیچ‌وقت از ما نخریده: ${top
        .map((a) => `${a.name} (${a.requests} بار)`).join("، ")}.`,
      suggestion: "بپرسید این نیاز را از کجا تأمین کرده‌اند و آیا دوباره تکرار می‌شود؛ پیشنهاد تازه بدهید.",
      refs: top.map((a) => a.name),
    });
  }

  const valuable = input.rank === "A" || input.rank === "B";
  if (valuable && (input.daysSinceLastPurchase ?? 0) >= t.dormantCustomerDays) {
    hints.push({
      kind: "REACTIVATE",
      severity: "HIGH",
      basis: `مشتری رتبه‌ی ${input.rank} است و ${input.daysSinceLastPurchase} روز است خریدی نداشته.`,
      suggestion: "یک تماس یا بازدید برای شنیدن نیاز پروژه‌های پیش رو برنامه‌ریزی کنید.",
      refs: [input.customerName],
    });
  }

  for (const p of input.openProjects) {
    if ((p.quietDays ?? 0) >= t.quietProjectDays) {
      hints.push({
        kind: "REVIVE_QUIET_PROJECT",
        severity: "MEDIUM",
        basis: `پروژه‌ی ${p.code} (${p.stage ?? "بدون مرحله"}) ${p.quietDays} روز است هیچ فعالیتی ندارد.`,
        suggestion: "وضعیت پروژه را از مشتری بپرسید و نتیجه را در فعالیت‌های پروژه ثبت کنید.",
        refs: [p.code],
      });
    }
  }

  if (!input.everPurchased && input.quotes.length === 0 && input.openProjects.length === 0) {
    hints.push({
      kind: "FIRST_SALE",
      severity: "LOW",
      basis: "این مشتری هنوز هیچ خرید، پیش‌فاکتور یا پروژه‌ی بازی ندارد.",
      suggestion: "برای شناخت نیازش یک تماس اولیه و معرفی محصولات مرتبط با صنعتش برنامه‌ریزی کنید.",
      refs: [input.customerName],
    });
  }

  return hints.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * The goods a customer asked for and never bought from us.
 *
 * Read off the lines of documents that are **settled**, since an open
 * quotation's lines are still in play and calling them «never bought» would be
 * premature. A product won on *any* document is excluded by name: buying it
 * once means it is not an unmet need. Grouped by the line's own words folded
 * for spacing, so «فلومتر » and «فلومتر» count as one.
 */
export function askedNeverBought(
  lines: { name: string; status: string | null; settledDocument: boolean }[],
  wonWord: string,
): { name: string; requests: number }[] {
  const key = (s: string) => s.replace(/\s+/g, " ").trim();
  const won = new Set(lines.filter((l) => l.status === wonWord).map((l) => key(l.name)));
  const counts = new Map<string, { name: string; requests: number }>();
  for (const l of lines) {
    if (!l.settledDocument || l.status === wonWord) continue;
    const k = key(l.name);
    if (!k || won.has(k)) continue;
    const row = counts.get(k) ?? { name: k, requests: 0 };
    row.requests++;
    counts.set(k, row);
  }
  return [...counts.values()].sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name, "fa"));
}
