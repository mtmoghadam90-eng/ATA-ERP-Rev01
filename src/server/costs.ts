import type { AuthUser } from "./auth";
import { canSeeCosts } from "./auth";

/**
 * What the company pays, removed from responses for users who may not see it.
 *
 * The rule this exists to enforce: warehouse staff open the inventory screen
 * every day and must not learn the purchase price. Every other permission in
 * this application answers "may this user open this module"; the `costs` flag
 * answers "may this user see these fields inside modules they already have".
 *
 * ## Why this is server-side
 *
 * Hiding a column in a React component hides it from the person looking at the
 * screen and from nobody else — `/api/products` still answers with the number,
 * and the browser's network tab is one keystroke away. So redaction happens
 * where `passwordHash` is already handled: in the service, on the way out. The
 * screens hide the same fields too, but that is a courtesy so the user is not
 * shown empty boxes, not the control itself.
 *
 * ## What counts as a cost
 *
 * Three places, because between them they answer "what did this item cost us":
 *
 *  - **The product price calculator** (`priceCalc`, on the product and on each
 *    variant) — the foreign price, freight, customs and margin that a sale
 *    price was built from. The sale price itself (`basePriceRial`,
 *    `priceForeign`) stays: that is what the company charges, and the warehouse
 *    needs it.
 *  - **Purchase orders** — landed cost, its components, and the line prices.
 *    A purchase order is almost entirely a statement of cost.
 *  - **Supplier inquiries** — the offers. An offer is the purchase price before
 *    it becomes one, so leaving these while redacting purchase orders would
 *    hide the answer and publish the working.
 *
 * Redacting one and not the others just moves the leak, which is why they are
 * enforced together from this one file.
 *
 * ## Reads are redacted; writes are refused
 *
 * A user who cannot see these numbers cannot save the documents that carry
 * them. That is not extra strictness, it is the only safe option: their copy of
 * the record has zeros where the money was, and letting them save it would
 * write those zeros back. Products are the exception and stay editable, because
 * there the cost is a single column that can simply be left alone.
 */

/** Product and variant fields that describe cost rather than price. */
const PRODUCT_COST_FIELDS = ["priceCalc"] as const;

/** Purchase-order columns that state, or reveal, what was paid. */
const PURCHASE_ORDER_COST_FIELDS = [
  "totalForeignAmount",
  "shippingCostRial", "shippingCostForeign",
  "customsDutyRial",
  "remittanceFeeRial", "remittanceFeeForeign",
  "landedCostRial", "landedCostForeign",
  // The rate is what converts a foreign line price into rial. On its own it
  // reveals nothing, but it is only ever stored to value the cost.
  "exchangeRate",
] as const;

const PURCHASE_ORDER_ITEM_COST_FIELDS = ["unitPriceForeign", "totalPriceForeign"] as const;

/**
 * Supplier-inquiry columns carrying the offer.
 *
 * `financialOfferUrl` is the supplier's own priced quotation. Withholding the
 * link keeps it off the screen and out of the API response, which is as far as
 * this can go: uploads are served as static files, so anyone who already knows
 * a path can still fetch it. Guarding the files themselves would mean routing
 * `/uploads` through the session, which is a larger change than this one and
 * would affect every attachment in the application.
 */
const INQUIRY_COST_FIELDS = ["discountPercent", "discountAmount", "financialOfferUrl"] as const;

const INQUIRY_ITEM_COST_FIELDS = ["priceForeign", "priceRial"] as const;

/**
 * Replaces the named fields with null, in a copy.
 *
 * Null rather than absent, and a copy rather than a delete: the client types
 * declare these fields, so removing them turns a number into `undefined` and
 * every adapter that reads one produces NaN somewhere downstream. Null is a
 * value the formatters already handle — it renders as blank.
 */
function blank<T>(row: T, fields: readonly string[]): T {
  if (!row || typeof row !== "object") return row;
  const copy = { ...(row as Record<string, unknown>) };
  for (const field of fields) {
    if (field in copy) copy[field] = null;
  }
  return copy as T;
}

/** The message a refused write gets. Says which permission, not which table. */
export const COST_WRITE_DENIED =
  "شما اجازه مشاهده و ثبت بهای خرید را ندارید، بنابراین امکان ذخیره این سند برای شما وجود ندارد.";

/**
 * Refuses a write from a user who may not see costs. True when it refused.
 *
 * Their copy of the document was served with the money blanked, so saving it
 * would write those blanks back over the real figures. Purchase orders and
 * supplier inquiries are almost entirely statements of cost, so there is
 * nothing left in them worth letting such a user edit — unlike a product, where
 * the calculator is one column that can simply be left alone.
 */
export function refuseCostWrite(
  res: { status(code: number): { json(body: unknown): unknown } },
  user: AuthUser,
): boolean {
  if (canSeeCosts(user)) return false;
  res.status(403).json({ success: false, error: COST_WRITE_DENIED, code: "FORBIDDEN" });
  return true;
}

/** One product, or one variant, with its calculator inputs removed. */
export function redactProduct<T>(row: T, user: AuthUser): T {
  if (canSeeCosts(user)) return row;
  if (!row || typeof row !== "object") return row;

  const product = blank(row, PRODUCT_COST_FIELDS) as Record<string, unknown>;
  if (Array.isArray(product.variants)) {
    product.variants = product.variants.map((v) => blank(v, PRODUCT_COST_FIELDS));
  }
  return product as T;
}

/** One purchase order, with its cost columns and line prices removed. */
export function redactPurchaseOrder<T>(row: T, user: AuthUser): T {
  if (canSeeCosts(user)) return row;
  if (!row || typeof row !== "object") return row;

  const po = blank(row, PURCHASE_ORDER_COST_FIELDS) as Record<string, unknown>;
  if (Array.isArray(po.items)) {
    po.items = po.items.map((item) => blank(item, PURCHASE_ORDER_ITEM_COST_FIELDS));
  }
  return po as T;
}

export function redactPurchaseOrders<T>(rows: T[], user: AuthUser): T[] {
  if (canSeeCosts(user)) return rows;
  return rows.map((row) => redactPurchaseOrder(row, user));
}

/** One supplier inquiry, with the offer removed. */
export function redactInquiry<T>(row: T, user: AuthUser): T {
  if (canSeeCosts(user)) return row;
  if (!row || typeof row !== "object") return row;

  const inquiry = blank(row, INQUIRY_COST_FIELDS) as Record<string, unknown>;
  if (Array.isArray(inquiry.items)) {
    inquiry.items = inquiry.items.map((item) => blank(item, INQUIRY_ITEM_COST_FIELDS));
  }
  // The derived timeline entries quote the offer total in their notes — "آفر
  // اولیه با مبلغ … ثبت شد" — so blanking the price columns while leaving these
  // would print the number back in prose. Only the automatic ones: their title
  // still says what happened, and a note somebody typed is their own text.
  if (Array.isArray(inquiry.steps)) {
    inquiry.steps = inquiry.steps.map((step) => {
      const s = step as Record<string, unknown> | null;
      return s && typeof s === "object" && s.isAuto ? blank(s, ["notes"]) : step;
    });
  }
  return inquiry as T;
}

export function redactInquiries<T>(rows: T[], user: AuthUser): T[] {
  if (canSeeCosts(user)) return rows;
  return rows.map((row) => redactInquiry(row, user));
}

/**
 * Strips the calculator inputs from a product write by a user who cannot see
 * them.
 *
 * Not a refusal, because a product is mostly not about cost — the warehouse
 * edits stock levels and descriptions all day. Dropping the field means the
 * services' "absent = unchanged" rule keeps whatever is stored.
 *
 * The variant list needs more than dropping: variants are written wholesale, so
 * a variant arriving without `priceCalc` would have its stored value replaced
 * with null. `previous` carries what the database holds so each variant can be
 * matched back by id and its calculator restored.
 */
export function stripProductCostInput<T extends object>(
  input: T,
  user: AuthUser,
  previous: { id: string; priceCalc: unknown }[] = [],
): T {
  if (canSeeCosts(user)) return input;

  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const field of PRODUCT_COST_FIELDS) delete out[field];

  if (Array.isArray(out.variants)) {
    const stored = new Map(previous.map((v) => [v.id, v.priceCalc]));
    out.variants = out.variants.map((variant) => {
      if (!variant || typeof variant !== "object") return variant;
      const copy = { ...(variant as Record<string, unknown>) };
      const id = typeof copy.id === "string" ? copy.id : null;
      // A new variant has nothing stored, and this user cannot have priced it,
      // so it is created with no calculator rather than with the client's.
      copy.priceCalc = id && stored.has(id) ? stored.get(id) : null;
      return copy;
    });
  }

  return out as T;
}
