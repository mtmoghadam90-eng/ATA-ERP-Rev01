import { ERPSettings, InquiryStep, SupplierInquiry, SupplierInquiryItem } from '../types';

/**
 * Automatic workflow-step engine for supplier price inquiries.
 *
 * Steps ("رویدادها") used to be manual only. These helpers derive the steps that
 * should be recorded automatically from what the user actually did, so the inquiry
 * always reflects its real stage without the user having to log it by hand.
 */

export const INQUIRY_STEP_KEYS = {
  SENT: 'SENT',
  INITIAL_OFFER: 'INITIAL_OFFER',
  REVISED: 'REVISED',
  FINAL_OFFER: 'FINAL_OFFER',
  WINNER: 'WINNER',
  CANCELLED: 'CANCELLED',
} as const;

export type InquiryStepKey = (typeof INQUIRY_STEP_KEYS)[keyof typeof INQUIRY_STEP_KEYS];

/**
 * Each logical step maps to a configurable Persian title. Because
 * `settings.dropdownItems.supplierInquirySteps` is user-editable, we resolve the
 * title by matching required keywords rather than by a hardcoded string, and fall
 * back to the canonical default when nothing matches.
 */
const STEP_DEFS: Record<InquiryStepKey, { fallback: string; match: string[] }> = {
  SENT: { fallback: 'ارسال استعلام قیمت', match: ['ارسال', 'استعلام'] },
  INITIAL_OFFER: { fallback: 'دریافت آفر فنی/مالی اولیه', match: ['آفر', 'اولیه'] },
  REVISED: { fallback: 'اصلاح و بازنگری پیشنهاد', match: ['بازنگری'] },
  FINAL_OFFER: { fallback: 'دریافت آفر نهایی', match: ['آفر', 'نهایی'] },
  WINNER: { fallback: 'اعلام به عنوان برنده نهایی استعلام', match: ['برنده'] },
  CANCELLED: { fallback: 'لغو استعلام', match: ['لغو'] },
};

const normalize = (s: string): string =>
  String(s ?? '').replace(/[\s‌]/g, '').toLowerCase();

/** Resolves the display title for a logical step, honoring user-configured titles. */
export function resolveStepTitle(settings: ERPSettings | undefined, key: InquiryStepKey): string {
  const def = STEP_DEFS[key];
  const configured = settings?.dropdownItems?.supplierInquirySteps || [];
  const tokens = def.match.map(normalize);
  const hit = configured.find((title) => {
    const n = normalize(title);
    return tokens.every((t) => n.includes(t));
  });
  return hit || def.fallback;
}

/** True when at least one item carries a real price (i.e. an offer arrived). */
export function hasOfferPrices(items: SupplierInquiryItem[] | undefined): boolean {
  return (items || []).some(
    (it) => Number(it.priceForeign) > 0 || Number(it.priceRiyal) > 0,
  );
}

/** Compares the priced content of two item lists to detect a revised offer. */
export function itemPricingChanged(
  oldItems: SupplierInquiryItem[] | undefined,
  newItems: SupplierInquiryItem[] | undefined,
): boolean {
  const shape = (items: SupplierInquiryItem[] | undefined) =>
    (items || []).map((it) => ({
      id: it.id,
      q: Number(it.quantity) || 0,
      pf: Number(it.priceForeign) || 0,
      pr: Number(it.priceRiyal) || 0,
      c: it.currency || '',
    }));
  return JSON.stringify(shape(oldItems)) !== JSON.stringify(shape(newItems));
}

function makeStep(
  key: InquiryStepKey,
  settings: ERPSettings | undefined,
  date: string,
  notes: string,
  uniqueSuffix = '',
): InquiryStep {
  return {
    id: `step-auto-${key}-${Date.now()}${uniqueSuffix}`,
    title: resolveStepTitle(settings, key),
    date,
    notes,
    method: 'سیستمی',
    auto: true,
    autoKey: key,
  };
}

const fmt = (n: number): string => Math.round(n).toLocaleString('fa-IR');

/**
 * The discount as a fraction, clamped.
 *
 * A percentage outside 0-100 would either inflate the offer or turn it
 * negative, so it is treated as no discount rather than trusted.
 */
export function discountFraction(discountPercent: number | undefined): number {
  const pct = Number(discountPercent) || 0;
  if (!(pct > 0)) return 0;
  return Math.min(pct, 100) / 100;
}

/** Sums the Rial value of an offer (unit Rial price x quantity), before discount. */
export function inquiryGrossRiyal(items: SupplierInquiryItem[] | undefined): number {
  return (items || []).reduce(
    (sum, it) => sum + (Number(it.priceRiyal) || 0) * (Number(it.quantity) || 0),
    0,
  );
}

/**
 * The single currency an offer is quoted in, when it has one.
 *
 * A supplier prices a whole inquiry in one currency, so this is normally
 * unambiguous. Null when the lines carry no foreign price at all — a Rial-only
 * offer — or, defensively, when they disagree, in which case the callers below
 * fall back to Rial rather than picking a winner.
 */
export function inquiryCurrency(items: SupplierInquiryItem[] | undefined): string | null {
  const seen = new Set<string>();
  for (const it of items || []) {
    const amount = (Number(it.priceForeign) || 0) * (Number(it.quantity) || 0);
    if (amount > 0 && it.currency) seen.add(it.currency);
  }
  return seen.size === 1 ? [...seen][0] : null;
}

/** Gross foreign value of an offer, in its own currency. */
export function inquiryGrossForeign(items: SupplierInquiryItem[] | undefined): number {
  return (items || []).reduce(
    (sum, it) => sum + (Number(it.priceForeign) || 0) * (Number(it.quantity) || 0),
    0,
  );
}

export interface InquiryTotals {
  /** The currency the offer is quoted in, or null for a Rial-only offer. */
  currency: string | null;
  grossForeign: number;
  grossRiyal: number;
  discountForeign: number;
  discountRiyal: number;
  netForeign: number;
  netRiyal: number;
}

/**
 * Everything an offer is worth, with both discounts applied.
 *
 * The two discounts compose in the order a supplier would quote them: the
 * percentage comes off first, then the fixed amount comes off what is left.
 *
 * The fixed amount is in the offer's own currency, which is well defined
 * because a supplier prices an inquiry in one currency. The Rial side is then
 * reduced by the *same proportion* rather than by its own subtraction, so the
 * two totals cannot drift apart — a Rial figure computed independently would
 * disagree with the foreign one as soon as the rate moved.
 *
 * For a Rial-only offer the amount is simply Rial. An offer cannot go below
 * zero: a discount larger than the offer makes it free, not negative.
 */
export function computeInquiryTotals(
  items: SupplierInquiryItem[] | undefined,
  discountPercent?: number,
  discountAmount?: number,
): InquiryTotals {
  const grossForeign = inquiryGrossForeign(items);
  const grossRiyal = inquiryGrossRiyal(items);
  const currency = inquiryCurrency(items);

  const keepPct = 1 - discountFraction(discountPercent);
  const amount = Math.max(Number(discountAmount) || 0, 0);

  // What the fixed amount is measured against: the offer's own currency when it
  // has one, Rial otherwise.
  const base = currency ? grossForeign : grossRiyal;
  const afterPct = base * keepPct;

  let keep = keepPct;
  if (afterPct > 0) {
    keep = keepPct * Math.max(1 - amount / afterPct, 0);
  } else if (amount > 0) {
    keep = 0;
  }

  const netForeign = grossForeign * keep;
  const netRiyal = grossRiyal * keep;

  return {
    currency,
    grossForeign,
    grossRiyal,
    discountForeign: grossForeign - netForeign,
    discountRiyal: grossRiyal - netRiyal,
    netForeign,
    netRiyal,
  };
}

/** What the discount takes off the Rial total. */
export function inquiryDiscountRiyal(
  items: SupplierInquiryItem[] | undefined,
  discountPercent?: number,
  discountAmount?: number,
): number {
  return computeInquiryTotals(items, discountPercent, discountAmount).discountRiyal;
}

/**
 * The Rial value of an offer, after any discount.
 *
 * Every caller wants the payable figure, so the discount is applied here rather
 * than left for each of them to remember.
 */
export function inquiryTotalRiyal(
  items: SupplierInquiryItem[] | undefined,
  discountPercent?: number,
  discountAmount?: number,
): number {
  return computeInquiryTotals(items, discountPercent, discountAmount).netRiyal;
}

/**
 * Sums the foreign-currency value per currency, so a mixed-currency offer is
 * described accurately instead of collapsing into a single wrong number.
 */
export function inquiryTotalsByCurrency(
  items: SupplierInquiryItem[] | undefined,
  discountPercent?: number,
  discountAmount?: number,
): Record<string, number> {
  const totals: Record<string, number> = {};
  // The same proportion the Rial total was reduced by, so the two agree.
  const gross = inquiryGrossForeign(items);
  const net = computeInquiryTotals(items, discountPercent, discountAmount).netForeign;
  const keep = gross > 0 ? net / gross : 1;
  (items || []).forEach((it) => {
    const amount = (Number(it.priceForeign) || 0) * (Number(it.quantity) || 0);
    if (amount <= 0) return;
    const cur = it.currency || 'نامشخص';
    totals[cur] = (totals[cur] || 0) + amount * keep;
  });
  return totals;
}

/** Human-readable amount summary, e.g. "۱۲٬۰۰۰ دلار ≈ ۷٬۲۰۰٬۰۰۰٬۰۰۰ ریال". */
export function describeInquiryAmount(
  items: SupplierInquiryItem[] | undefined,
  discountPercent?: number,
  discountAmount?: number,
): string {
  const byCurrency = inquiryTotalsByCurrency(items, discountPercent, discountAmount);
  const riyal = inquiryTotalRiyal(items, discountPercent, discountAmount);
  const parts = Object.entries(byCurrency)
    .filter(([cur]) => cur !== 'ریال')
    .map(([cur, amount]) => `${fmt(amount)} ${cur}`);

  if (parts.length === 0) {
    return riyal > 0 ? `${fmt(riyal)} ریال` : 'بدون قیمت';
  }
  const foreign = parts.join(' + ');
  return riyal > 0 ? `${foreign} (معادل ${fmt(riyal)} ریال)` : foreign;
}

/** Current stage label of an inquiry, derived from its state and latest step. */
export function describeInquiryStatus(inq: Partial<SupplierInquiry> | undefined): string {
  if (!inq) return 'نامشخص';
  if (inq.isWinner) return 'برنده نهایی استعلام';
  const steps = inq.steps || [];
  if (steps.length > 0) {
    const last = steps[steps.length - 1];
    if (last?.title) return last.title;
  }
  if (inq.offerConfirmed) return 'آفر نهایی تأییدشده';
  if (hasOfferPrices(inq.items)) return 'آفر اولیه دریافت شد';
  return 'در انتظار پاسخ تأمین‌کننده';
}

/**
 * Returns the steps that should be appended for this transition.
 *
 * @param oldInq the stored inquiry before the change (undefined when creating)
 * @param newInq the inquiry as it will be saved
 */
export function buildAutoSteps(
  oldInq: SupplierInquiry | undefined,
  newInq: SupplierInquiry,
  settings: ERPSettings | undefined,
  today: string,
): InquiryStep[] {
  const existing = newInq.steps || [];
  const additions: InquiryStep[] = [];
  const alreadyLogged = (key: InquiryStepKey) =>
    existing.some((s) => s.autoKey === key) || additions.some((s) => s.autoKey === key);

  const oldHadOffer = hasOfferPrices(oldInq?.items);
  const newHasOffer = hasOfferPrices(newInq.items);

  // 1) First priced offer arrives -> initial offer received.
  if (newHasOffer && !alreadyLogged(INQUIRY_STEP_KEYS.INITIAL_OFFER)) {
    additions.push(
      makeStep(
        INQUIRY_STEP_KEYS.INITIAL_OFFER,
        settings,
        today,
        `ثبت خودکار: آفر اولیه با مبلغ ${describeInquiryAmount(newInq.items)} برای ${(newInq.items || []).length} قلم کالا ثبت شد.`,
      ),
    );
  } else if (
    // 2) Prices edited after an offer already existed -> revision (repeatable).
    newHasOffer &&
    oldHadOffer &&
    itemPricingChanged(oldInq?.items, newInq.items)
  ) {
    additions.push(
      makeStep(
        INQUIRY_STEP_KEYS.REVISED,
        settings,
        today,
        `ثبت خودکار: آفر بازنگری شد. مبلغ جدید: ${describeInquiryAmount(newInq.items)}.`,
        `-${Math.random().toString(36).slice(2, 7)}`,
      ),
    );
  }

  // 3) Offer validity confirmed -> final offer.
  if (
    newInq.offerConfirmed &&
    !oldInq?.offerConfirmed &&
    !alreadyLogged(INQUIRY_STEP_KEYS.FINAL_OFFER)
  ) {
    additions.push(
      makeStep(
        INQUIRY_STEP_KEYS.FINAL_OFFER,
        settings,
        newInq.offerConfirmedDate || today,
        `ثبت خودکار: صحت آفر تأیید شد و به عنوان آفر نهایی با مبلغ ${describeInquiryAmount(newInq.items)} ثبت گردید.`,
      ),
    );
  }

  // 4) Declared winner.
  if (newInq.isWinner && !oldInq?.isWinner && !alreadyLogged(INQUIRY_STEP_KEYS.WINNER)) {
    additions.push(
      makeStep(
        INQUIRY_STEP_KEYS.WINNER,
        settings,
        newInq.winnerDate || today,
        `ثبت خودکار: این استعلام با مبلغ ${describeInquiryAmount(newInq.items)} به عنوان پیشنهاد برنده انتخاب شد.`,
      ),
    );
  }

  return additions;
}

/** Convenience wrapper: returns the inquiry with any newly derived steps appended. */
export function withAutoSteps(
  oldInq: SupplierInquiry | undefined,
  newInq: SupplierInquiry,
  settings: ERPSettings | undefined,
  today: string,
): SupplierInquiry {
  const additions = buildAutoSteps(oldInq, newInq, settings, today);
  if (additions.length === 0) return newInq;
  return { ...newInq, steps: [...(newInq.steps || []), ...additions] };
}
