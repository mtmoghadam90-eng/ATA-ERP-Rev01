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

export const generateDeliveryNotes = (
  itemsList: DeliveryBearing[],
  isEqualDelivery: boolean = true,
) => {
  if (!itemsList || itemsList.length === 0) {
    return "زمان تحویل:\nفوری";
  }

  const first = itemsList[0];
  const firstRange = first.deliveryRange || "۳-۴";
  const firstUnit = first.deliveryUnit || "هفته";
  const firstType = first.deliveryType || "کاری";
  const firstPostfix =
    first.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت";

  const allEqual = itemsList.every((item) => {
    const range = item.deliveryRange || "۳-۴";
    const unit = item.deliveryUnit || "هفته";
    const type = item.deliveryType || "کاری";
    const postfix =
      item.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت";
    return (
      range === firstRange &&
      unit === firstUnit &&
      type === firstType &&
      postfix === firstPostfix
    );
  });

  if (isEqualDelivery && allEqual) {
    return toPersianDigits(
      `زمان تحویل:\n${firstRange} ${firstUnit} ${firstType} ${firstPostfix}`,
    );
  }

  const lines = itemsList.map((item, index) => {
    const range = item.deliveryRange || "۳-۴";
    const unit = item.deliveryUnit || "هفته";
    const type = item.deliveryType || "کاری";
    const postfix =
      item.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت";
    return `ردیف ${index + 1} : ${range} ${unit} ${type} ${postfix}`;
  });
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
  const first = itemsList[0];
  const range = first.deliveryRange || "۳-۴";
  const unit = first.deliveryUnit || "هفته";
  const type = first.deliveryType || "کاری";

  const allEqual = itemsList.every((item) => {
    const itemRange = item.deliveryRange || "۳-۴";
    const itemUnit = item.deliveryUnit || "هفته";
    const itemType = item.deliveryType || "کاری";
    return itemRange === range && itemUnit === unit && itemType === type;
  });

  if (allEqual) {
    return `${range} ${unit} ${type}`;
  }
  return `${range} ${unit} ${type} (ردیف‌های دیگر متفاوت)`;
};
