/**
 * The two managed sections at the top of a proforma's notes.
 *
 * «شرایط و توضیحات» is one free-text box a person writes in, and two things
 * inside it are not free text at all: the delivery time and the payment terms
 * are answered by fields on the form and written here as sentences. This module
 * owns those two sections and nothing else in the box.
 *
 * **They sit first, above whatever the writer has typed.** They used to be
 * appended below it, so a document with three paragraphs of conditions printed
 * the two things a customer looks for first at the bottom of the block. Both
 * are now lifted to the top of the notes on every change — delivery, then
 * payment, then the writer's own text — and «lifted» is the word: a section
 * found further down is *moved*, not duplicated, which is the whole reason
 * these are recognised by their heading rather than by position.
 *
 * Pure, so `test:rules` can hold the ordering and the rule that a second
 * section is never appended below the first.
 */

import { toPersianDigits } from "../numUtils";
import { stripRichMarks } from "./richText";

/** Anything with the delivery and payment fields on it — a proforma line. */
export interface DeliveryBearing {
  deliveryRange?: string;
  deliveryUnit?: string;
  deliveryType?: string;
  deliveryPostfix?: string;
  /**
   * What the customer pays and when, chosen from
   * `settings.dropdownItems.paymentTerms`.
   *
   * Per line, exactly like the delivery fields and for the same reason: a
   * document that mixes goods off the shelf with goods on a four-month order
   * genuinely has two payment arrangements, and one field on the header could
   * only ever describe one of them. Empty means «nobody has said», which is
   * different from any of the values in the list.
   */
  paymentTerm?: string;
}

/**
 * «آماده تحویل» — goods that are on the shelf.
 *
 * Stored in `deliveryUnit`, which is where the answer to «چه واحدی» lives, and
 * that is deliberate: it is not a *quantity* of time at all, so the range and
 * the type of days beside it have nothing to say and are not read. A column of
 * its own would be a second thing to keep in step with the four that exist, on
 * every line of every quotation, to express what one value in one of them
 * already says.
 */
export const DELIVERY_READY_UNIT = "آماده تحویل";

/** What «آماده تحویل» prints as, rather than the bare words off the dropdown. */
export const DELIVERY_READY_TEXT = "موجود در انبار و آماده تحویل";

export const DELIVERY_HEADING = "زمان تحویل:";
export const PAYMENT_HEADING = "نحوه پرداخت:";

const DEFAULTS = {
  range: "۳-۴",
  unit: "هفته",
  type: "کاری",
  postfix: "پس از تایید پیش فاکتور و دریافت پیش پرداخت",
};

/**
 * One line's delivery, as a sentence.
 *
 * Written once because the four defaults were read out three times in this
 * file — in the all-equal test, in the all-equal sentence and in the per-line
 * one — and a fifth reading is how «۳-۴ هفته» comes to mean one thing in the
 * printed document and another in the summary beside it.
 */
export function deliveryPhrase(item: DeliveryBearing): string {
  const unit = item.deliveryUnit || DEFAULTS.unit;

  /*
   * Goods on the shelf are the whole sentence.
   *
   * No range and no working days — printing «۳-۴ آماده تحویل کاری» is what
   * reading the four fields blindly would produce — and **no trailing clause
   * either**: «موجود در انبار و آماده تحویل پس از دریافت پیش پرداخت»
   * contradicts itself, because goods that are ready are not waiting on a
   * payment. The payment condition for these is written in its own section
   * below; see `paymentPhrase`.
   */
  if (unit === DELIVERY_READY_UNIT) return DELIVERY_READY_TEXT;

  const range = item.deliveryRange || DEFAULTS.range;
  const type = item.deliveryType || DEFAULTS.type;
  const postfix = item.deliveryPostfix || DEFAULTS.postfix;
  return `${range} ${unit} ${type} ${postfix}`.trim();
}

/* ------------------------------- the payment ------------------------------ */

/** Goods on the shelf are paid for on the shelf, unless somebody says otherwise. */
export const READY_PAYMENT_TEXT = "۱۰۰٪ کل مبلغ در زمان تحویل کالا";

/**
 * One line's payment terms, or «» when nothing is to be said about it.
 *
 * A chosen term wins over everything. With nothing chosen, ready stock still
 * implies its own condition — that rule shipped before this field existed and
 * a document already relying on it must not lose the sentence — and ordinary
 * goods imply nothing at all, because a payment arrangement is negotiated and
 * guessing one into a quotation that goes to a customer is worse than leaving
 * the question to the writer.
 */
export function paymentPhrase(item: DeliveryBearing): string {
  const chosen = String(item.paymentTerm ?? "").trim();
  if (chosen) return chosen;
  return item.deliveryUnit === DELIVERY_READY_UNIT ? READY_PAYMENT_TEXT : "";
}

/**
 * True when every line is goods on the shelf.
 *
 * Kept as its own predicate because it is the question the *screen* asks —
 * whether to say so on the summary — while the payment section is now derived
 * per line by `paymentPhrase` and no longer needs an all-or-nothing test.
 */
export function allReadyForDelivery(itemsList: DeliveryBearing[]): boolean {
  if (!itemsList || itemsList.length === 0) return false;
  return itemsList.every((item) => item.deliveryUnit === DELIVERY_READY_UNIT);
}

/* ------------------------------ the sections ------------------------------ */

/**
 * A heading and its lines, built the same way for both sections.
 *
 * One phrase covering every line is written once; anything else is listed per
 * row. A line with nothing to say is **left out of the list** rather than given
 * an empty row — that only happens for payment, where «nobody has said» is a
 * real answer, and «ردیف ۲ : » would read as a mistake.
 */
function buildSection(
  heading: string,
  phrases: string[],
  isEqual: boolean,
): string | null {
  const named = phrases.filter((phrase) => phrase !== "");
  if (named.length === 0) return null;

  const first = phrases[0];
  const allEqual = first !== "" && phrases.every((phrase) => phrase === first);
  if (isEqual && allEqual) return `${heading}\n${first}`;

  /*
   * The row number is written in Persian digits; the phrase is not touched.
   * A delivery range is typed into a box under that convention, but a payment
   * term is a value picked out of `settings.dropdownItems.paymentTerms` — and
   * rewriting the digits inside somebody's own list entry is a silent edit to
   * a setting they wrote.
   */
  const lines = phrases
    .map((phrase, index) =>
      phrase === "" ? null : `${toPersianDigits(`ردیف ${index + 1}`)} : ${phrase}`)
    .filter((line): line is string => line !== null);

  return `${heading}\n${lines.join("\n")}`;
}

export const generateDeliveryNotes = (
  itemsList: DeliveryBearing[],
  isEqualDelivery: boolean = true,
) => {
  if (!itemsList || itemsList.length === 0) return `${DELIVERY_HEADING}\nفوری`;
  return toPersianDigits(
    buildSection(DELIVERY_HEADING, itemsList.map(deliveryPhrase), isEqualDelivery)
      ?? `${DELIVERY_HEADING}\nفوری`,
  );
};

export function generatePaymentNotes(
  itemsList: DeliveryBearing[],
  isEqual: boolean = true,
): string | null {
  if (!itemsList || itemsList.length === 0) return null;
  return buildSection(PAYMENT_HEADING, itemsList.map(paymentPhrase), isEqual);
}

/* ------------------------------ reading them ----------------------------- */

/**
 * Where a section starts and ends in the notes.
 *
 * The end is the fiddly half and the reason this is shared rather than written
 * twice: a section is either one sentence or a «ردیف N :» block of unknown
 * length, and the payment section can now be either, exactly like delivery.
 * Reading stops at the next heading — a line ending in «:» — so the writer's
 * own «شرایط ضمانت:» below is never swallowed.
 */
function findSection(
  plain: string[],
  heading: string,
): { start: number; end: number; body: string } | null {
  const start = plain.findIndex((line) => line.startsWith(heading));
  if (start === -1) return null;

  let end = start + 1;
  let hasRows = false;
  for (let i = start + 1; i < plain.length; i++) {
    const line = plain[i];
    if (line === "") continue;
    if (line.startsWith("ردیف")) { hasRows = true; break; }
    if (line.endsWith(":")) break;
    break;
  }

  if (hasRows) {
    while (end < plain.length && (plain[end] === "" || plain[end].startsWith("ردیف"))) end++;
    // A run of blank lines after the last row belongs to what follows, not here.
    while (end > start + 1 && plain[end - 1] === "") end--;
  } else if (end < plain.length && plain[end] !== "" && !plain[end].endsWith(":")) {
    end++;
  }

  return { start, end, body: plain.slice(start + 1, end).join("\n").trim() };
}

/** True when this body is text this module wrote, so removing it takes back its own. */
function isGeneratedPaymentBody(body: string): boolean {
  const text = body.trim();
  if (text === "") return true;
  if (text === READY_PAYMENT_TEXT) return true;
  return text.split("\n").every((line) => line.trim().startsWith("ردیف"));
}

/**
 * Both sections, rebuilt and lifted to the top.
 *
 * Every screen that changes a line's delivery has to update the delivery *and*
 * the payment section, and nine call sites each remembering to do two things is
 * how one of them comes to do one. There is one function to call.
 *
 * **A payment condition somebody typed themselves is carried, not deleted.**
 * The section shipped before there was a field to fill it from, so a live
 * document may hold a staged payment or a letter of credit under that heading —
 * text no dropdown would produce. It is kept as the section's body until a term
 * is actually chosen on the form, at which point the field wins, which is what
 * a field is for.
 */
export function updateNotesForItems(
  currentNotes: string,
  itemsList: DeliveryBearing[],
  isEqualDelivery: boolean = true,
): string {
  const lines = (currentNotes || "").split("\n");
  /*
   * Read past the formatting markers. The notes are rich text, and these
   * sections are recognised by the words at the start of a line — somebody
   * bolding «**زمان تحویل:**» would otherwise hide the section, and the next
   * change would write a second one above the first.
   *
   * The stripped copy is only for the comparisons; the indices address `lines`,
   * so whatever formatting the writer applied to the rest survives untouched.
   */
  const plain = lines.map((line) => stripRichMarks(line).trim());

  const delivery = findSection(plain, DELIVERY_HEADING);
  const payment = findSection(plain, PAYMENT_HEADING);

  // Cut back to front so the first cut does not move the second one's indices.
  const cuts = [delivery, payment]
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.start - a.start);
  let rest = lines;
  for (const cut of cuts) rest = [...rest.slice(0, cut.start), ...rest.slice(cut.end)];

  const carried = payment && !isGeneratedPaymentBody(payment.body) ? payment.body : null;
  const paymentSection = generatePaymentNotes(itemsList, isEqualDelivery)
    ?? (carried ? `${PAYMENT_HEADING}\n${carried}` : null);

  const managed = [generateDeliveryNotes(itemsList, isEqualDelivery), paymentSection]
    .filter((section): section is string => section !== null)
    .join("\n\n");

  const remainder = rest.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return remainder ? `${managed}\n\n${remainder}` : managed;
}

/* ------------------------------- the summary ------------------------------ */

export const getDeliverySummary = (itemsList: DeliveryBearing[]) => {
  if (!itemsList || itemsList.length === 0) return "فوری";

  /*
   * The same phrase the document prints, minus the trailing condition — this
   * is a badge on a form, not a sentence in a quotation. It reads the same
   * function so «آماده تحویل» cannot summarise as «۳-۴ هفته کاری» here while
   * printing correctly two screens away.
   */
  const short = (item: DeliveryBearing) => {
    const unit = item.deliveryUnit || "هفته";
    if (unit === DELIVERY_READY_UNIT) return DELIVERY_READY_UNIT;
    return `${item.deliveryRange || "۳-۴"} ${unit} ${item.deliveryType || "کاری"}`;
  };

  const first = short(itemsList[0]);
  const allEqual = itemsList.every((item) => short(item) === first);

  return allEqual ? first : `${first} (ردیف‌های دیگر متفاوت)`;
};
