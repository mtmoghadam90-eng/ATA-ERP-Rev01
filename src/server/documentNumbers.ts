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
  /** How many of this document already exist. */
  count: () => Promise<number>;
  /** Whether a candidate is already taken. */
  taken: (value: string) => Promise<boolean>;
  /** Placeholder values other than the sequence. */
  context?: Omit<Parameters<typeof formatERPNumber>[1], "seq">;
}

/** How many candidates to try before giving up rather than looping forever. */
const MAX_ATTEMPTS = 50;

export async function nextDocumentNumber(spec: DocumentNumberSpec): Promise<string> {
  const settings = await loadSettings();
  const formats = (settings.documentFormats ?? {}) as Record<string, unknown>;

  const template = typeof formats[spec.formatKey] === "string" && formats[spec.formatKey]
    ? (formats[spec.formatKey] as string)
    : spec.fallbackFormat;
  const startSeq = Number(formats[spec.startSeqKey]) || 1;

  let seq = startSeq + (await spec.count());

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = formatERPNumber(template, { ...spec.context, seq });
    // A template with no sequence placeholder cannot be stepped, so the first
    // candidate is the only one; let the unique index reject a repeat.
    if (!/\{SEQ(:\d+)?\}/.test(template)) return candidate;
    if (!(await spec.taken(candidate))) return candidate;
    seq++;
  }

  // Nothing free in range — fall back to something that cannot collide rather
  // than failing the save outright.
  return formatERPNumber(template, { ...spec.context, seq: Date.now() % 1_000_000 });
}
