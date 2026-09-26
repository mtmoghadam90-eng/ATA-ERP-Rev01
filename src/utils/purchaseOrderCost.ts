/**
 * A purchase order's landed cost, and the one thing about it that used to be
 * wrong: freight is not paid at the remittance rate.
 *
 * «نرخ تسعیر صرافی با نرخ تسعیر حمل متفاوته… حتی ممکنه واحد ارز حمل متفاوت
 * باشه. ترخیص همیشه ریالیه». The goods and the remittance fee are paid through
 * the exchange house at the order's own rate; the freight forwarder is paid
 * separately — often on another day, at another rate, and sometimes in another
 * currency altogether (a euro order shipped by a forwarder who bills in
 * dirhams). One rate for both priced the freight at a rate nobody paid, and the
 * error went straight into every line's landed cost and from there into the
 * margin the customer-value ranking reads.
 *
 * Customs is always rial and is added as it stands.
 *
 * Pure, and run by both the form and the server, so the figure a person sees
 * while typing is the figure that is stored (the `computeProformaTotals` rule).
 */

export const RIAL = "ریال";

export interface ShippingTerms {
  /** The currency the freight is billed in. */
  currency: string;
  /** Rial per unit of that currency; 1 for rial; 0 when unknown. */
  rate: number;
}

const positive = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * What the freight is billed in and converted at.
 *
 * **Absent means «as the order»** — the currency and the rate every order
 * written before these two fields existed was costed at — so nothing already on
 * disk changes value. A rate typed for freight wins even in the order's own
 * currency, because «same currency, different rate» is exactly the case asked
 * about. Rial is always 1, whatever was typed.
 */
export function resolveShippingTerms(
  orderCurrency: string,
  orderRate: unknown,
  shippingCurrency?: string | null,
  shippingRate?: unknown,
): ShippingTerms {
  const currency = String(shippingCurrency ?? "").trim() || orderCurrency;
  if (currency === RIAL) return { currency, rate: 1 };
  const typed = positive(shippingRate);
  if (typed > 0) return { currency, rate: typed };
  if (currency === orderCurrency) return { currency, rate: orderCurrency === RIAL ? 1 : positive(orderRate) };
  return { currency, rate: 0 };
}

/**
 * Why the freight cannot be costed, or null.
 *
 * A freight bill in a currency other than the order's has no rate to fall back
 * on, and costing it at zero would silently drop it out of the landed cost —
 * the order would look cheaper than it was, which is the direction nobody
 * notices. So the save is refused with the field named instead.
 */
export function shippingRateRefusal(shippingCost: unknown, terms: ShippingTerms): string | null {
  if (positive(shippingCost) === 0) return null;
  if (terms.rate > 0) return null;
  return `نرخ تسعیر حمل (${terms.currency}) را وارد کنید؛ بدون آن هزینهٔ حمل در بهای تمام‌شده حساب نمی‌شود.`;
}

export interface LandedCostInput {
  /** The goods, in the order's currency. */
  goodsForeign: number;
  /** The exchange house's fee, in the order's currency. */
  remittanceFeeForeign: number;
  /** Rial per unit of the order's currency (1 for a rial order). */
  orderRate: number;
  /** The freight, in `shipping.currency`. */
  shippingCost: number;
  shipping: ShippingTerms;
  /** Customs and any other rial costs, as they stand. */
  rialCosts: number;
}

/**
 * The landed cost in rial, and the same money in the order's currency.
 *
 * The foreign figure is the rial one divided by the order's rate — never a
 * second sum — so the two cannot disagree (the reason `computeTotals` gives).
 * With no order rate it carries only the goods and the fee, since the freight
 * and the rial costs cannot be expressed in the order's currency then.
 */
export function purchaseOrderLandedCost(input: LandedCostInput): { rial: number; foreign: number } {
  const goods = Number(input.goodsForeign) || 0;
  const fee = Number(input.remittanceFeeForeign) || 0;
  const orderRate = positive(input.orderRate);
  const freightRial = (Number(input.shippingCost) || 0) * (input.shipping.rate || 0);
  const rial = (goods + fee) * orderRate + freightRial + (Number(input.rialCosts) || 0);
  const foreign = orderRate > 0 ? Number((rial / orderRate).toFixed(2)) : Number((goods + fee).toFixed(2));
  return { rial, foreign };
}
