/**
 * A packing line's technical specification, edited line by line.
 *
 * It is seeded from the won proforma line it ships (the line's `techSpecs`) and
 * can also be typed by hand on a row nobody quoted. The packing list is the
 * document a warehouse and a customer's receiving desk check the goods
 * against, so a person routinely trims it — a price-related or commercial line
 * of the quotation's specification means nothing on a box — which is why the
 * form edits it one line at a time and can drop any of them.
 *
 * Pure; the text keeps the proforma's rich marks (`**…**` and the rest), so the
 * printout renders it exactly as the quotation did.
 */

/**
 * The non-blank lines of a specification, in order, **untrimmed**: the editor
 * reads its boxes back through this on every keystroke, so trimming here
 * swallowed a space typed at the end of a line and two words could never be
 * written (`deviationEntries`' lesson). The printout trims what it prints.
 */
export function specLines(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
}

/** The specification with one line rewritten (an emptied line is removed). */
export function setSpecLine(text: string | null | undefined, index: number, value: string): string {
  const lines = specLines(text);
  if (index < 0 || index >= lines.length) return lines.join("\n");
  lines[index] = value;
  return lines.filter((line) => line.trim() !== "").join("\n");
}

/** The specification without one line. */
export function removeSpecLine(text: string | null | undefined, index: number): string {
  return specLines(text).filter((_, i) => i !== index).join("\n");
}

/** The specification with a line appended. */
export function addSpecLine(text: string | null | undefined, value: string): string {
  const line = value.trim();
  if (!line) return specLines(text).join("\n");
  return [...specLines(text), line].join("\n");
}
