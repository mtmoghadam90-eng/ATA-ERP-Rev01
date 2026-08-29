/**
 * A little formatting in fields that end up in a printed document.
 *
 * The line specification on a proforma is read by a customer, and «متریال بدنه»
 * mattering more than the rest of the line is a real thing to want to say. So
 * the editor offers bold, italic, underline and highlight.
 *
 * **The text stays plain text.** The markers below are written into the same
 * column the field always used, rather than storing HTML, for three reasons
 * that are all load-bearing here:
 *
 *  - the product configurator writes and reads that field line by line
 *    («جنس بدنه: استیل 316»), and HTML tags in the middle of those lines would
 *    stop it recognising its own output;
 *  - the field is interpolated straight into the printed document, so storing
 *    HTML would mean a stray «<» from a size or a tolerance breaking the page —
 *    `renderRichText` escapes first and applies the marks afterwards, which
 *    closes that hole rather than opening it;
 *  - the reporting export and every plain-text reader keep working, with
 *    `stripRichMarks` for the ones that want the words alone.
 *
 * Pure, and covered by `test:rules`.
 */

export interface RichMark {
  /** What the toolbar button does, for its tooltip and its label. */
  key: "bold" | "italic" | "underline" | "highlight";
  label: string;
  /** Written on both sides of the selection. */
  token: string;
}

/**
 * Order matters: `__underline__` has to be recognised before `_italic_`, or the
 * first two underscores are read as an empty italic run.
 */
export const RICH_MARKS: RichMark[] = [
  { key: "bold", label: "درشت", token: "**" },
  { key: "underline", label: "زیرخط", token: "__" },
  { key: "italic", label: "مورب", token: "_" },
  { key: "highlight", label: "هایلایت", token: "==" },
];

/**
 * The one HTML escaper the printed documents share.
 *
 * Exported because `proformaDocument.ts` interpolates settings text into the
 * page too, and a second copy is a second thing to forget to call.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** `**` -> `\*\*`, so a token can be used inside a regular expression. */
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TAGS: Record<RichMark["key"], [string, string]> = {
  bold: ["<strong>", "</strong>"],
  underline: ['<span style="text-decoration: underline;">', "</span>"],
  italic: ["<em>", "</em>"],
  // An inline style rather than <mark>: the printed page is built as a
  // standalone document with no stylesheet of its own, and browsers disagree
  // about <mark>'s default colour when printing.
  highlight: ['<span style="background-color: #fef08a; padding: 0 2px;">', "</span>"],
};

/**
 * The text as HTML, safe to put in a document.
 *
 * Newlines are left alone: every place this is used already sets
 * `white-space: pre-line`, which is what keeps the specification lines apart.
 */
export function renderRichText(text: string | null | undefined): string {
  let html = escapeHtml(String(text ?? ""));
  for (const mark of RICH_MARKS) {
    const token = escapeRe(mark.token);
    const [open, close] = TAGS[mark.key];
    // Non-greedy, and no newline inside a run: a marker somebody opened and
    // never closed then formats nothing rather than swallowing the rest of the
    // document.
    html = html.replace(new RegExp(`${token}([^\\n]+?)${token}`, "g"), `${open}$1${close}`);
  }
  return html;
}

/** The words without the markers, for anywhere that wants plain text. */
export function stripRichMarks(text: string | null | undefined): string {
  let out = String(text ?? "");
  for (const mark of RICH_MARKS) {
    const token = escapeRe(mark.token);
    out = out.replace(new RegExp(`${token}([^\\n]+?)${token}`, "g"), "$1");
  }
  return out;
}

/**
 * Wrapping — or unwrapping — the selected part of a textarea.
 *
 * Returns the whole new text and where the selection should end up, so the
 * caller can put the cursor back: a toolbar that formats the words and then
 * drops the caret at the end is a toolbar people stop using.
 *
 * Pressing the same button on text that already carries the marker removes it,
 * which is what every editor does and what people try first.
 */
export function toggleMark(
  text: string,
  start: number,
  end: number,
  token: string,
): { text: string; selectionStart: number; selectionEnd: number } {
  const value = String(text ?? "");
  const selected = value.slice(start, end);

  // Nothing selected: drop an empty pair in and put the caret between them.
  if (!selected) {
    const next = `${value.slice(0, start)}${token}${token}${value.slice(start)}`;
    return { text: next, selectionStart: start + token.length, selectionEnd: start + token.length };
  }

  const wrappedInside = selected.startsWith(token) && selected.endsWith(token)
    && selected.length > token.length * 2;
  if (wrappedInside) {
    const bare = selected.slice(token.length, selected.length - token.length);
    return {
      text: `${value.slice(0, start)}${bare}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + bare.length,
    };
  }

  // The markers may sit just outside the selection, which is what happens when
  // somebody double-clicks the word they formatted a moment ago.
  const before = value.slice(Math.max(0, start - token.length), start);
  const after = value.slice(end, end + token.length);
  if (before === token && after === token) {
    const from = start - token.length;
    return {
      text: `${value.slice(0, from)}${selected}${value.slice(end + token.length)}`,
      selectionStart: from,
      selectionEnd: from + selected.length,
    };
  }

  return {
    text: `${value.slice(0, start)}${token}${selected}${token}${value.slice(end)}`,
    selectionStart: start + token.length,
    selectionEnd: end + token.length,
  };
}
