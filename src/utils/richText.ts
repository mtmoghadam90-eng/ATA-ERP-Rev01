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

/**
 * The colours a word may be given, and the only ones.
 *
 * An **allowlist**, for the reason the reaction emoji are one: the value ends
 * up inside a `style` attribute on a page that is printed and emailed, so an
 * arbitrary string there is a CSS injection through a field a salesperson
 * types into. The names are Persian because the writer types them and the
 * toolbar writes them; the hex is this file's and never the writer's.
 *
 * Kept small on purpose. A specification is read for what it says, and a line
 * available in twelve colours is a line nobody reads in any of them — these
 * five are «this matters», «this is a note», «this is agreed», «this is a
 * warning» and «this is secondary», which is as many distinctions as a printed
 * quotation can carry.
 */
export const RICH_COLOURS: Record<string, string> = {
  "قرمز": "#dc2626",
  "آبی": "#2563eb",
  "سبز": "#16a34a",
  "نارنجی": "#ea580c",
  "خاکستری": "#64748b",
};

/**
 * `{{قرمز:متن}}` — a colour needs a parameter, which no symmetric token can
 * carry, so it is the one mark written as a form rather than as a pair.
 *
 * **Braces and not parentheses**, which is the whole reason this is not
 * `((…))`: an instrument specification is full of parentheses — «2.5Mpa
 * (ANSI300#)», «DN50 (2")» — and a non-greedy body closing on `))` would end
 * at the wrong one and print the leftover bracket. Braces appear in this field
 * essentially never, so the body may contain anything but a brace or a
 * newline. (`renderTemplate`'s `{key}` is a different module reading different
 * fields, and its pattern is `\w` only, so it cannot see inside one of these.)
 *
 * Non-greedy and **never across a newline**, exactly like every other mark: a
 * brace somebody opened and never closed formats nothing rather than
 * swallowing the rest of the document. A colour name this build does not know
 * is left **exactly as written** — the truthful answer when there is no
 * colour, and what stops the next unknown name silently printing as red.
 */
const COLOUR_RE = /\{\{([^{}:\n]{1,20}):([^{}\n]+?)\}\}/g;

/** The rendered form, with the colour resolved from the allowlist. */
function applyColours(html: string): string {
  return html.replace(COLOUR_RE, (whole, name: string, body: string) => {
    const hex = RICH_COLOURS[String(name).trim()];
    return hex ? `<span style="color: ${hex};">${body}</span>` : whole;
  });
}

/** The same runs with the brackets taken off, for a plain-text reader. */
function stripColours(text: string): string {
  return text.replace(COLOUR_RE, (whole, name: string, body: string) =>
    RICH_COLOURS[String(name).trim()] ? body : whole);
}

/* ---------------------------------- tables --------------------------------- */

/**
 * A table is a **block**, so it is lines rather than a mark inside one.
 *
 * That is not a style choice: the product configurator reads this field line by
 * line, so anything spanning lines has to be recognisable *as* whole lines or
 * it would cut one of its own rows in half. Pipe-separated rows are also what
 * every plain-text reader can still make sense of — `stripRichMarks` leaves
 * them alone, because «۱ | فلومتر | ۲ عدد» is a table to a person reading the
 * reporting export too.
 *
 * Both writings are accepted: «a | b» and the Markdown «| a | b |», since the
 * second is what anybody who has written a table before types.
 */
export function tableCells(line: string): string[] | null {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.includes("|")) return null;
  // One leading and one trailing pipe are the Markdown frame, not empty cells.
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = inner.split("|").map((c) => c.trim());
  // A single cell is a line that happens to contain a pipe — a tolerance, a
  // range, an «or» — and turning that into a one-column table would be the
  // formatting nobody asked for.
  return cells.length >= 2 ? cells : null;
}

/**
 * «---|---», which is what a pasted Markdown table puts under its header.
 *
 * Dropped rather than drawn: it is a *notation* for «the row above is the
 * header», and this renderer already treats the first row as one.
 */
function isRuleRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * A table here reads **left to right**, and that is about its content.
 *
 * The tables that reach this field are specification tables — a range, a
 * connection, a body material, a model code — pasted out of the datasheet the
 * customer or the manufacturer sent, and every one of them is in Latin. Drawn
 * `direction: rtl` the *columns* run the other way, so a header row typed
 * «Tag | Model | Range» prints Range first and the document contradicts the
 * sheet it was copied from.
 *
 * The consequence to know: a table somebody types in Persian will also read
 * left to right, which for its column order is wrong. That is the trade being
 * taken deliberately — the common case here is the pasted English table, and
 * the words inside each cell still lay themselves out by the Unicode bidi rule
 * whichever way the columns run, so a Persian cell is legible either way while
 * a Latin column order is not.
 */
const CELL_STYLE =
  "border: 1px solid #cbd5e1; padding: 3px 6px; text-align: left;"
  + " direction: ltr; unicode-bidi: plaintext;";
const HEAD_STYLE = `${CELL_STYLE} background-color: #f1f5f9; font-weight: bold;`;

/**
 * Turns every run of two or more table lines into a `<table>`.
 *
 * **Two, not one**: a table has a header and at least one row, and a lone line
 * with a pipe in it is far likelier to be a range or an «or» than a table
 * somebody meant. That is the same direction every other rule here takes —
 * when in doubt, leave the writer's text as they typed it.
 *
 * The styles are inline because the printed page is a standalone document with
 * no stylesheet of its own, exactly as the highlight mark is.
 */
function applyTables(html: string): string {
  const lines = html.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const run: string[][] = [];
    let j = i;
    while (j < lines.length) {
      const cells = tableCells(lines[j]);
      if (!cells) break;
      run.push(cells);
      j += 1;
    }
    if (run.length >= 2) {
      const rows = run.filter((cells) => !isRuleRow(cells));
      const [head, ...body] = rows;
      const th = (head ?? []).map((c) => `<th style="${HEAD_STYLE}">${c}</th>`).join("");
      const tb = body
        .map((cells) => `<tr>${cells.map((c) => `<td style="${CELL_STYLE}">${c}</td>`).join("")}</tr>`)
        .join("");
      out.push(
        '<table style="border-collapse: collapse; width: 100%; margin: 4px 0;'
        + ' font-size: inherit; direction: ltr; text-align: left;">'
        + `<thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`,
      );
      i = j;
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  /*
   * A `<table>` is a block and every container this renders into sets
   * `white-space: pre-line`, so the newline that used to separate these lines
   * would draw a blank line above and below the table. The element supplies its
   * own margin instead.
   */
  return out.join("\n").replace(/\n?(<table[\s\S]*?<\/table>)\n?/g, "$1");
}

/**
 * A table pasted out of Excel, Word or Google Sheets arrives **tab-separated**
 * on the clipboard, which is the half of «a table» that makes it usable.
 *
 * Typing pipes by hand is a table nobody builds; pasting one is the ordinary
 * way a specification table comes into existence here, since it was already
 * written in the datasheet the customer sent. Pure, so the rule is held without
 * a clipboard: the component hands it `text/plain` and writes back what it
 * answers.
 *
 * Answers **null** when the text is not a table — a single line, or no tabs at
 * all — and the paste is then left to the browser, which is what makes this
 * safe to call on every paste rather than only when somebody asks for it.
 */
export function tableFromPastedText(text: string | null | undefined): string | null {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return null;
  // Every line has to carry a tab, or this is ordinary prose that happens to
  // have one in it and the paste would come out mangled.
  if (!lines.every((line) => line.includes("\t"))) return null;
  return lines
    .map((line) => line.split("\t").map((cell) => cell.trim()).join(" | "))
    .join("\n");
}

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
  /*
   * Colours before tables, and both after the symmetric marks.
   *
   * The order is the rule: a cell may carry a bold run or a coloured one, so
   * the inline passes have to have happened before the lines are cut into
   * cells — and `applyTables` only ever splits on `|` and `\n`, neither of
   * which the inline passes can produce, so it cannot cut a tag in half.
   */
  html = applyColours(html);
  html = applyTables(html);
  return html;
}

/** The words without the markers, for anywhere that wants plain text. */
export function stripRichMarks(text: string | null | undefined): string {
  let out = String(text ?? "");
  for (const mark of RICH_MARKS) {
    const token = escapeRe(mark.token);
    out = out.replace(new RegExp(`${token}([^\\n]+?)${token}`, "g"), "$1");
  }
  /*
   * The colour brackets go and the table's pipes **stay**. A table written as
   * pipe-separated rows is still a table to somebody reading the reporting
   * export or a plain-text copy of the specification, and stripping the
   * separators would run every row of it into one line.
   */
  return stripColours(out);
}

/**
 * The table skeleton the toolbar drops in, so the first one is not typed from
 * nothing.
 *
 * Two columns and one row under the header, which is the smallest thing that is
 * recognisably a table — `applyTables` needs two lines, so a header alone would
 * render as ordinary text and read as a button that did nothing.
 */
export const TABLE_SKELETON = "عنوان ۱ | عنوان ۲\nمقدار ۱ | مقدار ۲";

/**
 * Inserting a block at the caret, on lines of its own.
 *
 * A table put in the middle of «جنس بدنه: استیل» would be neither: the run has
 * to start a line for `applyTables` to see it, so the newlines are supplied
 * here rather than left to whoever presses the button.
 */
export function insertBlock(
  text: string,
  start: number,
  end: number,
  block: string,
): { text: string; selectionStart: number; selectionEnd: number } {
  const value = String(text ?? "");
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const trail = after === "" || after.startsWith("\n") ? "" : "\n";
  const inserted = `${lead}${block}${trail}`;
  return {
    text: `${before}${inserted}${after}`,
    selectionStart: start + lead.length,
    selectionEnd: start + lead.length + block.length,
  };
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
