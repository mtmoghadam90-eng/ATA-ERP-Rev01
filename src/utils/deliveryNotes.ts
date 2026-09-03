/**
 * The delivery section that lives inside a proforma's notes.
 *
 * Extracted from `ProformasView` when the notes became formattable text: the
 * three functions here recognise their own section by the words at the start of
 * a line, and `stripRichMarks` is what keeps that working after somebody has
 * bolded a heading. Pure, so `test:rules` can hold the rule that a second
 * delivery section is never appended below the first.
 */

import { toPersianDigits } from "../numUtils";
import { stripRichMarks } from "./richText";

/** Anything with the four delivery fields on it — a proforma line, in practice. */
export interface DeliveryBearing {
  deliveryRange?: string;
  deliveryUnit?: string;
  deliveryType?: string;
  deliveryPostfix?: string;
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
   * payment. The payment condition for these is written in its own section of
   * the notes instead; see `readyPaymentNote`.
   */
  if (unit === DELIVERY_READY_UNIT) return DELIVERY_READY_TEXT;

  const range = item.deliveryRange || DEFAULTS.range;
  const type = item.deliveryType || DEFAULTS.type;
  const postfix = item.deliveryPostfix || DEFAULTS.postfix;
  return `${range} ${unit} ${type} ${postfix}`.trim();
}

export const generateDeliveryNotes = (
  itemsList: DeliveryBearing[],
  isEqualDelivery: boolean = true,
) => {
  if (!itemsList || itemsList.length === 0) {
    return "زمان تحویل:\nفوری";
  }

  const first = deliveryPhrase(itemsList[0]);
  const allEqual = itemsList.every((item) => deliveryPhrase(item) === first);

  if (isEqualDelivery && allEqual) {
    return toPersianDigits(`زمان تحویل:\n${first}`);
  }

  const lines = itemsList.map(
    (item, index) => `ردیف ${index + 1} : ${deliveryPhrase(item)}`,
  );
  return toPersianDigits(`زمان تحویل:\n${lines.join("\n")}`);
};

export const updateNotesWithDelivery = (
  currentNotes: string,
  itemsList: DeliveryBearing[],
  isEqualDelivery: boolean = true,
) => {
  const deliverySection = generateDeliveryNotes(itemsList, isEqualDelivery);
  const notesStr = currentNotes || "";
  const lines = notesStr.split("\n");

  /*
   * Read past the formatting markers.
   *
   * The notes are editable rich text now, and this function recognises its own
   * delivery section by the words at the start of a line. Somebody bolding
   * «**زمان تحویل:**» would otherwise hide the section from it, and the next
   * change to a delivery date would append a second one below the first.
   *
   * The stripped copy is only for the comparisons — the indices below still
   * address `lines`, so whatever formatting the user applied to the rest of
   * their notes survives untouched.
   */
  const plain = lines.map((line) => stripRichMarks(line).trim());
  const startIndex = plain.findIndex((line) => line.startsWith("زمان تحویل:"));

  if (startIndex !== -1) {
    // Find where the delivery section ends
    let endIndex = startIndex + 1;

    // Check if the next lines contain any line starting with "ردیف"
    let hasRowLines = false;
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = plain[i];
      if (line === "") continue;
      if (line.startsWith("ردیف")) {
        hasRowLines = true;
        break;
      }
      if (line.endsWith(":") && !line.startsWith("ردیف")) {
        break;
      }
    }

    if (hasRowLines) {
      while (endIndex < lines.length) {
        const line = plain[endIndex];
        if (line !== "" && !line.startsWith("ردیف")) {
          break;
        }
        endIndex++;
      }
    } else {
      // Consume the single line after "زمان تحویل:" if it is not empty and not another heading
      if (
        endIndex < lines.length &&
        plain[endIndex] !== "" &&
        !plain[endIndex].endsWith(":")
      ) {
        endIndex++;
      }
    }
    const before = lines.slice(0, startIndex);
    const after = lines.slice(endIndex);
    return [...before, deliverySection, ...after].join("\n");
  } else {
    if (notesStr.trim() === "") {
      return deliverySection;
    }
    return `${notesStr.trim()}\n\n${deliverySection}`;
  }
};

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

/* ------------------------- the payment condition ------------------------- */

/**
 * Goods on the shelf are paid for on the shelf.
 *
 * The delivery sentence for «آماده تحویل» deliberately carries no trailing
 * condition — «موجود در انبار و آماده تحویل پس از دریافت پیش پرداخت»
 * contradicts itself — so the payment condition belongs in its own section,
 * under its own heading, where it can be recognised again and rewritten.
 *
 * **Only when every line is ready stock.** A quotation with one item on the
 * shelf and one on six weeks' order has no single payment rule, and writing
 * «۱۰۰٪ در زمان تحویل» over a document that needs a deposit for half of it is
 * worse than writing nothing.
 */
export const PAYMENT_HEADING = "نحوه پرداخت:";
export const READY_PAYMENT_TEXT = "۱۰۰٪ کل مبلغ در زمان تحویل کالا";

export function allReadyForDelivery(itemsList: DeliveryBearing[]): boolean {
  if (!itemsList || itemsList.length === 0) return false;
  return itemsList.every((item) => item.deliveryUnit === DELIVERY_READY_UNIT);
}

/**
 * Writes, replaces or removes the payment section.
 *
 * Removal is **exact**: the section goes only when it still says what this
 * wrote. Somebody who typed their own terms under that heading — a staged
 * payment, a letter of credit — keeps them when the goods change, because a
 * rule that manages a section is entitled to remove what it put there and
 * nothing else.
 *
 * The section is one line, which is what lets this be so much simpler than
 * `updateNotesWithDelivery`: that one has to consume a «ردیف N» block of
 * unknown length.
 */
export function updateNotesWithPayment(
  currentNotes: string,
  itemsList: DeliveryBearing[],
): string {
  const wanted = allReadyForDelivery(itemsList) ? READY_PAYMENT_TEXT : null;
  const lines = (currentNotes || "").split("\n");
  /*
   * Compared past the formatting markers, the same way the delivery section
   * is: bolding «**نحوه پرداخت:**» would otherwise hide the section and the
   * next change would append a second one below the first.
   */
  const plain = lines.map((line) => stripRichMarks(line).trim());
  const at = plain.findIndex((line) => line.startsWith(PAYMENT_HEADING));

  if (at === -1) {
    if (!wanted) return currentNotes || "";
    const section = `${PAYMENT_HEADING}\n${wanted}`;
    const trimmed = (currentNotes || "").trim();
    return trimmed === "" ? section : `${trimmed}\n\n${section}`;
  }

  // The single line under the heading, if there is one that is not another.
  const bodyAt = at + 1;
  const hasBody = bodyAt < lines.length
    && plain[bodyAt] !== ""
    && !plain[bodyAt].endsWith(":");
  const end = hasBody ? bodyAt + 1 : bodyAt;

  if (wanted) {
    return [...lines.slice(0, at), `${PAYMENT_HEADING}\n${wanted}`, ...lines.slice(end)]
      .join("\n");
  }

  // Not ready stock any more. Only what this wrote is taken back.
  if (hasBody && plain[bodyAt] !== READY_PAYMENT_TEXT) return lines.join("\n");
  return [...lines.slice(0, at), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Both sections, in one call.
 *
 * Every screen that changes a line's delivery has to update the delivery
 * *and* the payment section, and eight call sites each remembering to do two
 * things is how one of them comes to do one. There is one function to call.
 */
export function updateNotesForItems(
  currentNotes: string,
  itemsList: DeliveryBearing[],
  isEqualDelivery: boolean = true,
): string {
  return updateNotesWithPayment(
    updateNotesWithDelivery(currentNotes, itemsList, isEqualDelivery),
    itemsList,
  );
}
