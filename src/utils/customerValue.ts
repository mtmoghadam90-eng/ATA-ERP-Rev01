/**
 * Customer value ranking: two independent axes, then a matrix.
 *
 *   Realized Value  — what the customer has already been worth (0..100)
 *   Potential Value — what they could be worth (0..100)
 *
 * The rank is decided by the **matrix**, never by the combined index. That is
 * the whole point of two axes: a brand-new customer with no sales and huge
 * potential must come out C (develop them), not D (ignore them), and the two
 * numbers that say so must not be averaged away before the decision is made.
 * `CVI` exists only to order customers *within* a rank.
 *
 * Everything here is pure and deterministic — no database, no clock, no AI.
 * `test:rules` covers it, including the ten acceptance scenarios from the
 * specification. Nothing about a rank may be a black box: every component score
 * and the raw figure behind it is returned, so "why is this customer an A?" is
 * always answerable.
 */

/* ============================== the four ranks ============================= */

export const RANKS = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  /** Not a rank: the potential assessment has not been filled in yet. */
  PENDING: "PENDING",
  /**
   * Not a rank either: this customer has never actually bought anything.
   *
   * A/B/C/D is a judgement about a *relationship*, and half of it — realized
   * value — is a judgement about money that has changed hands. Somebody who has
   * only ever been quoted has no realized value to measure, so ranking them
   * puts a verdict on a relationship that has not started: they come out D,
   * "low value, low priority", which is precisely backwards for a lead the
   * sales team is working on.
   *
   * They still get a potential score, and that is what they are sorted by.
   */
  PROSPECT: "PROSPECT",
} as const;

export type CustomerRank = typeof RANKS[keyof typeof RANKS];

export interface RankMeta {
  rank: CustomerRank;
  title: string;
  action: string;
  description: string;
}

export const RANK_META: Record<CustomerRank, RankMeta> = {
  A: {
    rank: "A",
    title: "مشتری استراتژیک",
    action: "حفظ و توسعه",
    description: "هم ارزش اقتصادی خوبی ایجاد کرده و هم ظرفیت رشد بالایی دارد. حفظ رابطه، فروش مکمل، توسعه قرارداد و اولویت بالای پاسخ‌گویی.",
  },
  B: {
    rank: "B",
    title: "مشتری سودآور",
    action: "حفظ کارآمد",
    description: "تاکنون سودآور بوده ولی پتانسیل رشدش محدودتر است. حفظ مشتری و سودآوری، بدون تخصیص بیش از حد منابع توسعه فروش.",
  },
  C: {
    rank: "C",
    title: "مشتری قابل توسعه",
    action: "توسعه",
    description: "هنوز ارزش مالی زیادی ایجاد نکرده ولی پتانسیل بالایی دارد. اولویت تیم فروش برای توسعه حساب و افزایش سهم از سبد خرید.",
  },
  D: {
    rank: "D",
    title: "مشتری کم‌ارزش",
    action: "اولویت پایین / پایش",
    description: "هم ارزش محقق‌شده و هم پتانسیل پایین دارد. رسیدگی استاندارد و جلوگیری از مصرف نامتناسب منابع فروش.",
  },
  PENDING: {
    rank: "PENDING",
    title: "در انتظار ارزیابی",
    action: "تکمیل ارزیابی پتانسیل",
    description: "ارزیابی ارزش بالقوه این مشتری هنوز تکمیل نشده است. تا زمانی که هر پنج پارامتر پتانسیل ثبت نشوند رتبه‌ای تعیین نمی‌شود، چون پتانسیل نامعلوم با پتانسیل صفر یکی نیست.",
  },
  PROSPECT: {
    rank: "PROSPECT",
    title: "مشتری بالقوه",
    action: "جذب اولین خرید",
    description: "هنوز هیچ خرید قطعی از این مشتری ثبت نشده است، بنابراین ارزش محقق‌شده‌ای برای سنجش وجود ندارد و رتبه A/B/C/D برایش تعیین نمی‌شود. ارزیابی او فقط بر پایه ارزش بالقوه است؛ با ثبت اولین فروش قطعی، به‌صورت خودکار وارد ماتریس رتبه‌بندی می‌شود.",
  },
};

/* ============================== configuration ============================= */

/** The five things that make up potential, and their weights (percent). */
export interface PotentialWeights {
  consumption: number;
  companySize: number;
  projects: number;
  portfolioFit: number;
  repeatPurchase: number;
}

/** The five things that make up realized value, and their weights (percent). */
export interface RealizedWeights {
  grossProfit: number;
  frequency: number;
  recency: number;
  payment: number;
  costToServe: number;
}

/** One recency band: up to `months` since the last purchase scores `score`. */
export interface RecencyRule {
  months: number;
  score: number;
}

export interface CustomerValueSettings {
  /** Months of sales history the gross profit and frequency are measured over. */
  evaluationPeriodMonths: number;
  highRealizedThreshold: number;
  highPotentialThreshold: number;
  realizedWeights: RealizedWeights;
  potentialWeights: PotentialWeights;
  /** Ordered shortest-first. Anything beyond the last band scores 0. */
  recencyRules: RecencyRule[];
}

export const DEFAULT_CUSTOMER_VALUE_SETTINGS: CustomerValueSettings = {
  evaluationPeriodMonths: 12,
  highRealizedThreshold: 60,
  highPotentialThreshold: 60,
  realizedWeights: {
    grossProfit: 50,
    frequency: 20,
    recency: 15,
    payment: 10,
    costToServe: 5,
  },
  potentialWeights: {
    consumption: 30,
    companySize: 20,
    projects: 20,
    portfolioFit: 20,
    repeatPurchase: 10,
  },
  recencyRules: [
    { months: 3, score: 100 },
    { months: 6, score: 80 },
    { months: 12, score: 60 },
    { months: 18, score: 40 },
    { months: 24, score: 20 },
  ],
};

/** How much CVI leans on what has already happened versus what might. */
export const CVI_REALIZED_WEIGHT = 0.6;
export const CVI_POTENTIAL_WEIGHT = 0.4;

/* ========================== manual dropdown scores ======================== */

/** Payment behaviour, worst-to-best kept in one place with its scores. */
export const PAYMENT_BEHAVIOURS = [
  { value: "بسیار خوش‌حساب", score: 100 },
  { value: "خوش‌حساب", score: 80 },
  { value: "معمولی", score: 60 },
  { value: "بدحساب", score: 30 },
  { value: "بسیار بدحساب", score: 0 },
] as const;

/**
 * Cost to serve. Note the direction: **cheaper to serve scores higher**, because
 * every score in this system means "better for us", and a customer who eats
 * engineering time is worth less than the same revenue from one who does not.
 */
export const COST_TO_SERVE_LEVELS = [
  { value: "بسیار کم", score: 100 },
  { value: "کم", score: 80 },
  { value: "متوسط", score: 60 },
  { value: "زیاد", score: 30 },
  { value: "بسیار زیاد", score: 0 },
] as const;

export const DEFAULT_PAYMENT_BEHAVIOUR = "معمولی";
export const DEFAULT_COST_TO_SERVE = "متوسط";

export const paymentScoreOf = (value: string | null | undefined): number =>
  PAYMENT_BEHAVIOURS.find((b) => b.value === value)?.score ?? 60;

export const costToServeScoreOf = (value: string | null | undefined): number =>
  COST_TO_SERVE_LEVELS.find((b) => b.value === value)?.score ?? 60;

/** The 1..5 labels the potential form offers, per parameter. */
export const POTENTIAL_SCALES: Record<keyof PotentialWeights, string[]> = {
  consumption: ["بسیار کم", "کم", "متوسط", "زیاد", "بسیار زیاد"],
  companySize: ["بسیار کوچک", "کوچک", "متوسط", "بزرگ", "بسیار بزرگ"],
  projects: ["بسیار محدود", "محدود", "متوسط", "زیاد", "بسیار زیاد"],
  portfolioFit: ["بسیار کم", "کم", "متوسط", "زیاد", "بسیار زیاد"],
  repeatPurchase: ["بسیار کم", "کم", "متوسط", "زیاد", "بسیار زیاد"],
};

export const POTENTIAL_LABELS: Record<keyof PotentialWeights, string> = {
  consumption: "ظرفیت مصرف تجهیزات ابزار دقیق",
  companySize: "اندازه و وسعت فعالیت مشتری",
  projects: "تعداد پروژه‌ها، سایت‌ها یا خطوط عملیاتی",
  portfolioFit: "میزان تطابق نیاز مشتری با سبد محصولات شرکت",
  repeatPurchase: "احتمال خرید مستقیم و مستمر",
};

/* =============================== validation ============================== */

const finite = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Rounds to one decimal — enough to order customers, short enough to read. */
const round1 = (n: number) => Math.round(n * 10) / 10;

export const sumRealizedWeights = (w: RealizedWeights): number =>
  finite(w?.grossProfit, 0) + finite(w?.frequency, 0) + finite(w?.recency, 0) +
  finite(w?.payment, 0) + finite(w?.costToServe, 0);

export const sumPotentialWeights = (w: PotentialWeights): number =>
  finite(w?.consumption, 0) + finite(w?.companySize, 0) + finite(w?.projects, 0) +
  finite(w?.portfolioFit, 0) + finite(w?.repeatPurchase, 0);

/**
 * Why a set of settings cannot be saved, or null when it can.
 *
 * The weights must total 100 exactly. Not a formality: the scores are weighted
 * *averages* and the divisor is assumed to be 100, so weights totalling 90 would
 * silently deflate every customer's score by a tenth and nothing would look
 * wrong — every customer would just drift down a rank together.
 */
export function validateCustomerValueSettings(
  settings: Partial<CustomerValueSettings> | null | undefined,
): string | null {
  const realized = settings?.realizedWeights;
  const potential = settings?.potentialWeights;

  if (!realized || !potential) return "تنظیمات ارزش مشتری ناقص است.";

  const realizedTotal = Math.round(sumRealizedWeights(realized) * 100) / 100;
  if (realizedTotal !== 100) {
    return `مجموع وزن‌های «ارزش ایجادشده» باید دقیقاً ۱۰۰ باشد (اکنون ${realizedTotal}).`;
  }

  const potentialTotal = Math.round(sumPotentialWeights(potential) * 100) / 100;
  if (potentialTotal !== 100) {
    return `مجموع وزن‌های «ارزش بالقوه» باید دقیقاً ۱۰۰ باشد (اکنون ${potentialTotal}).`;
  }

  const months = finite(settings?.evaluationPeriodMonths, 0);
  if (months <= 0) return "بازه ارزیابی باید بزرگ‌تر از صفر باشد.";

  for (const key of ["highRealizedThreshold", "highPotentialThreshold"] as const) {
    const value = finite(settings?.[key], -1);
    if (value < 0 || value > 100) return "آستانه‌ها باید بین ۰ تا ۱۰۰ باشند.";
  }

  return null;
}

/** Fills in whatever the stored settings are missing, without ever throwing. */
export function normalizeCustomerValueSettings(
  raw: Partial<CustomerValueSettings> | null | undefined,
): CustomerValueSettings {
  const d = DEFAULT_CUSTOMER_VALUE_SETTINGS;

  const realizedWeights: RealizedWeights = {
    grossProfit: finite(raw?.realizedWeights?.grossProfit, d.realizedWeights.grossProfit),
    frequency: finite(raw?.realizedWeights?.frequency, d.realizedWeights.frequency),
    recency: finite(raw?.realizedWeights?.recency, d.realizedWeights.recency),
    payment: finite(raw?.realizedWeights?.payment, d.realizedWeights.payment),
    costToServe: finite(raw?.realizedWeights?.costToServe, d.realizedWeights.costToServe),
  };
  const potentialWeights: PotentialWeights = {
    consumption: finite(raw?.potentialWeights?.consumption, d.potentialWeights.consumption),
    companySize: finite(raw?.potentialWeights?.companySize, d.potentialWeights.companySize),
    projects: finite(raw?.potentialWeights?.projects, d.potentialWeights.projects),
    portfolioFit: finite(raw?.potentialWeights?.portfolioFit, d.potentialWeights.portfolioFit),
    repeatPurchase: finite(raw?.potentialWeights?.repeatPurchase, d.potentialWeights.repeatPurchase),
  };

  // Stored settings that do not total 100 would deflate every score. Rather than
  // scoring everyone wrongly, fall back to the defaults for that half.
  const safeRealized = Math.round(sumRealizedWeights(realizedWeights)) === 100
    ? realizedWeights : d.realizedWeights;
  const safePotential = Math.round(sumPotentialWeights(potentialWeights)) === 100
    ? potentialWeights : d.potentialWeights;

  const rules = Array.isArray(raw?.recencyRules) && raw!.recencyRules!.length > 0
    ? raw!.recencyRules!
      .map((r) => ({ months: finite(r?.months, 0), score: clamp(finite(r?.score, 0), 0, 100) }))
      .filter((r) => r.months > 0)
      .sort((a, b) => a.months - b.months)
    : d.recencyRules;

  return {
    evaluationPeriodMonths: Math.max(1, Math.round(finite(raw?.evaluationPeriodMonths, d.evaluationPeriodMonths))),
    highRealizedThreshold: clamp(finite(raw?.highRealizedThreshold, d.highRealizedThreshold), 0, 100),
    highPotentialThreshold: clamp(finite(raw?.highPotentialThreshold, d.highPotentialThreshold), 0, 100),
    realizedWeights: safeRealized,
    potentialWeights: safePotential,
    recencyRules: rules.length > 0 ? rules : d.recencyRules,
  };
}

/* ============================ potential value ============================= */

export interface PotentialInputs {
  consumption?: number | null;
  companySize?: number | null;
  projects?: number | null;
  portfolioFit?: number | null;
  repeatPurchase?: number | null;
}

export const POTENTIAL_KEYS: (keyof PotentialWeights)[] = [
  "consumption", "companySize", "projects", "portfolioFit", "repeatPurchase",
];

/**
 * True only when all five parameters have been answered.
 *
 * A half-filled assessment is not a low potential, and treating a blank as a 1
 * would rank a promising customer D on the strength of a form nobody opened.
 */
export function isPotentialAssessed(inputs: PotentialInputs | null | undefined): boolean {
  if (!inputs) return false;
  return POTENTIAL_KEYS.every((key) => {
    const value = Number(inputs[key]);
    return Number.isFinite(value) && value >= 1 && value <= 5;
  });
}

/**
 * Potential, 0..100.
 *
 * `sum(answer × weight) / 5` — with weights totalling 100 and answers capped at
 * 5, a customer who scores 5 everywhere lands exactly on 100.
 */
export function calculatePotentialScore(
  inputs: PotentialInputs | null | undefined,
  settings?: Partial<CustomerValueSettings> | null,
): number | null {
  if (!isPotentialAssessed(inputs)) return null;

  const weights = normalizeCustomerValueSettings(settings).potentialWeights;
  const weighted = POTENTIAL_KEYS.reduce(
    (sum, key) => sum + clamp(finite(inputs![key], 1), 1, 5) * finite(weights[key], 0),
    0,
  );
  return round1(clamp(weighted / 5, 0, 100));
}

/* ============================== percentiles =============================== */

/**
 * Where `value` sits in `population`, as 0..100.
 *
 * Used for gross profit and frequency, which are meaningless in absolute terms —
 * "sold 400 million rial" says nothing until you know what everyone else did.
 *
 * The midrank convention (everything below, plus half of everything equal) keeps
 * ties fair: three customers who all billed the same amount all get the same
 * score rather than being ordered arbitrarily by row id.
 *
 * `population` should be only the customers with activity: a company whose
 * customer list is mostly dormant would otherwise hand a top-decile score to
 * anyone who bought anything at all.
 */
export function percentileRank(value: number, population: number[]): number {
  const n = population.length;
  if (n === 0) return 0;
  if (n === 1) return population[0] === value ? 100 : 0;

  let below = 0;
  let equal = 0;
  for (const other of population) {
    if (other < value) below++;
    else if (other === value) equal++;
  }
  return round1(clamp(((below + equal / 2) / n) * 100, 0, 100));
}

/* =============================== recency ================================= */

/**
 * Recency, 0..100, from months since the last real purchase.
 *
 * Null months means "never bought", which scores 0 — the customer has no
 * recency, and the absence is exactly what the score should reflect here (unlike
 * potential, where absence means unknown).
 */
export function recencyScore(
  monthsSinceLastPurchase: number | null | undefined,
  settings?: Partial<CustomerValueSettings> | null,
): number {
  if (monthsSinceLastPurchase === null || monthsSinceLastPurchase === undefined) return 0;
  const months = finite(monthsSinceLastPurchase, Infinity);
  if (!Number.isFinite(months)) return 0;

  const rules = normalizeCustomerValueSettings(settings).recencyRules;
  for (const rule of rules) {
    if (months <= rule.months) return clamp(rule.score, 0, 100);
  }
  return 0;
}

/* ============================ realized value ============================== */

export interface RealizedComponents {
  grossProfitScore: number;
  frequencyScore: number;
  recencyScore: number;
  paymentScore: number;
  costToServeScore: number;
}

export function calculateRealizedScore(
  components: RealizedComponents,
  settings?: Partial<CustomerValueSettings> | null,
): number {
  const w = normalizeCustomerValueSettings(settings).realizedWeights;
  const weighted =
    clamp(finite(components.grossProfitScore, 0), 0, 100) * w.grossProfit +
    clamp(finite(components.frequencyScore, 0), 0, 100) * w.frequency +
    clamp(finite(components.recencyScore, 0), 0, 100) * w.recency +
    clamp(finite(components.paymentScore, 0), 0, 100) * w.payment +
    clamp(finite(components.costToServeScore, 0), 0, 100) * w.costToServe;

  // The weights are percentages and total 100, so this is a weighted average.
  return round1(clamp(weighted / 100, 0, 100));
}

/* ================================== CVI ================================== */

/**
 * The combined index — for **ordering within a rank only**.
 *
 * Null potential yields null: a customer whose potential is unknown has no
 * meaningful combined index, and inventing one by treating unknown as zero
 * would sort them below customers who are genuinely worth less.
 */
export function calculateCVI(
  realizedScore: number,
  potentialScore: number | null | undefined,
): number | null {
  if (potentialScore === null || potentialScore === undefined) return null;
  const realized = clamp(finite(realizedScore, 0), 0, 100);
  const potential = clamp(finite(potentialScore, 0), 0, 100);
  return round1(realized * CVI_REALIZED_WEIGHT + potential * CVI_POTENTIAL_WEIGHT);
}

/* ================================= rank ================================== */

/**
 * The rank, from the matrix alone.
 *
 * Deliberately **not** derived from CVI: averaging the two axes first would
 * collapse "nothing yet but huge promise" and "solid but capped" into the same
 * middling number, and those two customers need opposite treatment.
 */
export function determineRank(
  realizedScore: number,
  potentialScore: number | null | undefined,
  /**
   * Whether this customer has ever bought anything — a confirmed sale, not a
   * quotation, an opportunity or a cancelled order.
   *
   * Deliberately a required argument rather than one defaulting to true: the
   * type-checker then names every call site, and a rule this easy to forget
   * must not be bypassable by leaving an argument off.
   *
   * "Ever", not "in the evaluation period". A customer who last bought three
   * years ago is *lapsed*, not a prospect — they have a history, their recency
   * score already says how stale it is, and calling them a prospect would erase
   * everything they were worth.
   */
  hasConfirmedPurchase: boolean,
  settings?: Partial<CustomerValueSettings> | null,
): CustomerRank {
  // Checked first, and before the potential assessment: an unassessed prospect
  // is still a prospect, and "we have never sold to them" is the more useful
  // thing to say about them than "somebody has not filled in a form".
  if (!hasConfirmedPurchase) return RANKS.PROSPECT;
  if (potentialScore === null || potentialScore === undefined) return RANKS.PENDING;

  const config = normalizeCustomerValueSettings(settings);
  const highRealized = clamp(finite(realizedScore, 0), 0, 100) >= config.highRealizedThreshold;
  const highPotential = clamp(finite(potentialScore, 0), 0, 100) >= config.highPotentialThreshold;

  if (highRealized && highPotential) return RANKS.A;
  if (highRealized) return RANKS.B;
  if (highPotential) return RANKS.C;
  return RANKS.D;
}

/* ============================ manual override ============================= */

export interface ManualRankState {
  /** The rank a person set, or null when nobody has. */
  manualRank?: string | null;
  /** True when that rank must survive recalculation. */
  manualRankLocked?: boolean;
}

export interface ResolvedRank {
  /** The rank in effect — what the grid filters and sorts on. */
  rank: CustomerRank;
  /** What the formula said, kept so an override never hides what it overrode. */
  computedRank: CustomerRank;
  rankIsManual: boolean;
  /**
   * True when the override has served its purpose and should be dropped.
   *
   * An unlocked override means "show this now, and let the evaluation take
   * back over next time" — so the recalculation that takes back over is
   * exactly when it stops applying. Leaving it would show a rank the metrics
   * beside it no longer agree with.
   */
  clearsOverride: boolean;
}

/**
 * Which rank a customer ends up with, given what the formula computed and what
 * a person may have set by hand.
 *
 * Locked beats the formula; unlocked does not. A `manualRankLocked` with no
 * rank is not an override — the flag alone must never blank a customer's rank.
 */
export function resolveRank(
  computedRank: CustomerRank,
  manual: ManualRankState | null | undefined,
): ResolvedRank {
  const hasManual = !!manual?.manualRank;
  const locked = !!manual?.manualRankLocked && hasManual;

  return {
    rank: (locked ? manual!.manualRank : computedRank) as CustomerRank,
    computedRank,
    rankIsManual: locked,
    clearsOverride: hasManual && !manual?.manualRankLocked,
  };
}

/* ============================== the whole thing =========================== */

export interface CustomerValueResult {
  realizedScore: number;
  potentialScore: number | null;
  cvi: number | null;
  rank: CustomerRank;
  components: RealizedComponents;
}

/** One customer's scores, given their component scores and assessment. */
export function evaluateCustomerValue(
  components: RealizedComponents,
  potentialInputs: PotentialInputs | null | undefined,
  hasConfirmedPurchase: boolean,
  settings?: Partial<CustomerValueSettings> | null,
): CustomerValueResult {
  const potentialScore = calculatePotentialScore(potentialInputs, settings);

  /*
   * A prospect has realized nothing, and says so.
   *
   * Not the computed figure: payment behaviour and cost to serve are manual
   * judgements worth 15 points between them, so a customer who has never paid
   * an invoice could otherwise carry a realized score built entirely out of
   * opinions about how they pay. Zero is the honest reading, and it keeps the
   * population average from being lifted by people who have bought nothing.
   *
   * CVI goes with it. It exists only to order customers *within* a rank, and a
   * prospect is not in one — they are ordered by potential instead.
   */
  const rank = determineRank(
    calculateRealizedScore(components, settings), potentialScore, hasConfirmedPurchase, settings,
  );
  const isProspect = rank === RANKS.PROSPECT;
  const realizedScore = isProspect ? 0 : calculateRealizedScore(components, settings);

  return {
    realizedScore,
    potentialScore,
    cvi: isProspect ? null : calculateCVI(realizedScore, potentialScore),
    rank,
    components,
  };
}
