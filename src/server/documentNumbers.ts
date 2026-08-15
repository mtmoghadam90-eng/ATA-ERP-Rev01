import { formatERPNumber } from "../numUtils";
import { loadSettings } from "./settings";

/**
 * Document numbers, generated where the existing ones can actually be seen.
 *
 * Every document form offers to make the number up when the field is left
 * blank, and the client used to do it as `startSeq + collection.length`. That
 * was already only as correct as the browser's copy of the collection, and once
 * lists are paged the length is one page — so the same number would be handed
 * out over and over. The count comes from SQL here, and the unique index is
 * still the thing that decides: a taken number is stepped past rather than
 * assumed free, because two people can be on this form at once.
 *
 * **The sequence counts the numbers already issued under the same prefix, not
 * the rows in the table.** Moving the count to SQL kept the old arithmetic —
 * `startSeq + <how many of this document exist>` — and every template here is
 * scoped by something: a project code, a year and month, a transaction type. So
 * a proforma issued on one project advanced the next number of every other
 * project, and a number could be skipped without ever having been used: a save
 * that failed and was retried came back as `…-C2` while `…-C1` had never
 * existed, which is what "the number was burnt" looks like from the outside.
 *
 * So the template is rendered around its sequence placeholder, the resulting
 * prefix ("ATA-05-19-C", "TR-دریافت-140505-") is what the numbers are counted
 * under, and the next one is the highest of those plus one. A number a user
 * typed by hand counts too — it is on a document, so it is taken.
 *
 * The template language is shared with the client's `formatERPNumber`, so what
 * the settings screen previews is what gets written.
 */

export interface DocumentNumberSpec {
  /** e.g. "packingListFormat". */
  formatKey: string;
  /** e.g. "packingListStartSeq". */
  startSeqKey: string;
  /** Used when settings carry no template. */
  fallbackFormat: string;
  /** The numbers already issued under this prefix — see `nextSequence`. */
  existing: (prefix: string) => Promise<string[]>;
  /** Whether a candidate is already taken. */
  taken: (value: string) => Promise<boolean>;
  /** Placeholder values other than the sequence. */
  context?: Omit<Parameters<typeof formatERPNumber>[1], "seq">;
}

/** How many candidates to try before giving up rather than looping forever. */
const MAX_ATTEMPTS = 50;

/** Marks where the sequence sits while the rest of the template is rendered. */
const SEQ_PLACEHOLDER = /\{SEQ(?::\d+)?\}/;
const SENTINEL = "\u0001";

/**
 * The literal text on either side of the sequence, with every other placeholder
 * resolved. `QT-{PROJECT}-{SEQ:2}` on project ATA-05-19 gives `["QT-ATA-05-19-", ""]`.
 */
export function renderAround(
  template: string,
  context: Omit<Parameters<typeof formatERPNumber>[1], "seq">,
): { head: string; tail: string } | null {
  if (!SEQ_PLACEHOLDER.test(template)) return null;
  const rendered = formatERPNumber(template.replace(SEQ_PLACEHOLDER, SENTINEL), {
    ...context,
    seq: 0,
  });
  const at = rendered.indexOf(SENTINEL);
  if (at < 0) return null;
  return { head: rendered.slice(0, at), tail: rendered.slice(at + SENTINEL.length) };
}

/**
 * The next sequence for a prefix: one past the highest already issued under it,
 * or `startSeq` when it has never been used.
 *
 * Anything that does not fit the shape is ignored rather than guessed at — a
 * number a user replaced with their customer's own reference is not part of
 * this series and must not push it forward.
 */
export function nextSequence(
  head: string,
  tail: string,
  numbers: string[],
  startSeq: number,
): number {
  let highest = 0;
  for (const raw of numbers) {
    const value = String(raw ?? "");
    if (!value.startsWith(head)) continue;
    let middle = value.slice(head.length);
    if (tail) {
      if (!middle.endsWith(tail)) continue;
      middle = middle.slice(0, middle.length - tail.length);
    }
    if (!/^\d+$/.test(middle)) continue;
    const seq = parseInt(middle, 10);
    if (seq > highest) highest = seq;
  }
  // `startSeq` is a floor, not just the value for an empty series: an admin who
  // raises it means "numbers from here on", and the highest already issued may
  // still be below it.
  return Math.max(highest + 1, startSeq);
}

export async function nextDocumentNumber(spec: DocumentNumberSpec): Promise<string> {
  const settings = await loadSettings();
  const formats = (settings.documentFormats ?? {}) as Record<string, unknown>;

  const template = typeof formats[spec.formatKey] === "string" && formats[spec.formatKey]
    ? (formats[spec.formatKey] as string)
    : spec.fallbackFormat;
  const startSeq = Number(formats[spec.startSeqKey]) || 1;
  const context = spec.context ?? {};

  // A template with no sequence placeholder cannot be stepped, so the first
  // candidate is the only one; let the unique index reject a repeat.
  const around = renderAround(template, context);
  if (!around) return formatERPNumber(template, { ...context, seq: startSeq });

  let seq = nextSequence(
    around.head,
    around.tail,
    await spec.existing(around.head),
    startSeq,
  );

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = formatERPNumber(template, { ...context, seq });
    if (!(await spec.taken(candidate))) return candidate;
    seq++;
  }

  // Nothing free in range — fall back to something that cannot collide rather
  // than failing the save outright.
  return formatERPNumber(template, { ...context, seq: Date.now() % 1_000_000 });
}
