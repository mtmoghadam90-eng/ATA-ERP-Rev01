/**
 * What a board card shows at a glance, and what it keeps behind a press.
 *
 * A card on «تخته کار» drew its title and nothing else. For an ordinary task
 * that is nearly enough; for the other two kinds it is either too little or too
 * much, and both failures are the same one — the card is not a document.
 *
 * A **referral's title is the message itself** («@علی لطفاً دیتاشیت این فلومتر
 * را با پیشنهاد سازنده مقایسه کن و …»), so a paragraph was rendered in full
 * inside a column two hundred pixels wide and three of them filled the screen.
 * A **sales follow-up** had the opposite fault: «شرح اقدام بعدی» — what the
 * next chase is actually *for* — is on the task and was drawn only in the list
 * view, so the board said «پیگیری مشتری» and nothing about what to do, which
 * is the one thing the person picking the card up needs.
 *
 * So a card has two halves: a **summary**, always one line and safe to clamp,
 * and the **detail**, which is the full text plus whatever blocks that record
 * carries. The detail is disclosed **in place** rather than in a modal — the
 * card's title already opens the record's own form (a referral's thread, a
 * chase's completion modal, a task's edit box), and a second modal on the same
 * card would mean two different pop-ups from one card with nothing on either
 * button saying which is which. Expanding also keeps the neighbouring cards on
 * screen, which is the whole reason somebody is looking at a board.
 *
 * The rules are pure here so `test:rules` can hold them, and because the two
 * views must not name one field two ways — `DETAIL_LABELS` is the single home
 * of those headings and the list view reads them from here.
 */

/**
 * How much of the headline a card shows before the button is offered.
 *
 * Measured against a column at its narrowest (four columns on a desktop, one on
 * a phone): about two rendered lines of Persian at the card's own size.
 */
export const SUMMARY_LIMIT = 90;

/** The headings, written once. Both the board and the list print these. */
export const DETAIL_LABELS = {
  /** An ordinary task: what it is for. */
  description: 'شرح',
  /** The same column on a chase, where it means the *next* call, not the last. */
  followUpDescription: 'شرح اقدام بعدی',
  /** What the customer said. */
  followUpResult: 'نتیجه پیگیری',
  /** The note about the call that closed it. */
  completionNote: 'شرح اقدام انجام‌شده',
} as const;

export interface CardDetailBlock {
  label: string;
  body: string;
  /**
   * `done` is what already happened — the result and the closing note — and is
   * drawn set back from what is still being asked for.
   */
  tone: 'plain' | 'done';
}

export interface CardDetail {
  /** One line. What the collapsed card prints. */
  summary: string;
  /** The summary is not the whole headline: there is more behind the press. */
  truncated: boolean;
  /** Everything the headline does not say, in reading order. */
  blocks: CardDetailBlock[];
}

export interface CardTextInput {
  /** The card's own title — for a referral, the whole message. */
  headline: string;
  description?: string | null;
  followUpResult?: string | null;
  completionNote?: string | null;
  /** Decides which of the two names `description` is printed under. */
  isFollowUp?: boolean;
}

/** Whitespace collapsed to single spaces, so a paragraph can occupy one line. */
export function foldToOneLine(text: string | null | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The one-line form of a piece of text, and whether anything was lost making it.
 *
 * **Folding is itself a loss**, and that is the half easy to get wrong: a
 * message whose first line is «سلام» and which runs to ten lines below it folds
 * to something well inside the limit, so a check on length alone would report
 * nothing was cut and the card would offer no way to read the rest — exactly
 * where the button is most wanted. So the comparison is against the original.
 *
 * The cut is taken at a word boundary when there is a usable one, because a cut
 * inside a word reads as a typo rather than as an abbreviation; a single
 * unbroken token (a long code, a URL) has none and is cut where it stands
 * rather than being dropped to nothing.
 */
export function summarizeText(
  text: string | null | undefined,
  limit: number = SUMMARY_LIMIT,
): { summary: string; truncated: boolean } {
  const raw = String(text ?? '').trim();
  const folded = foldToOneLine(raw);
  if (folded.length <= limit) return { summary: folded, truncated: folded !== raw };

  const hardCut = folded.slice(0, limit);
  const lastSpace = hardCut.lastIndexOf(' ');
  const body = lastSpace >= Math.floor(limit / 2) ? hardCut.slice(0, lastSpace) : hardCut;
  return { summary: `${body.trimEnd()}…`, truncated: true };
}

/**
 * The blocks a card holds behind the button, in the order they are read.
 *
 * A blank field produces **no block**: a heading with nothing under it is worse
 * than no heading, and «شرح» is empty on most tasks somebody typed in a hurry.
 */
export function detailBlocks(input: CardTextInput): CardDetailBlock[] {
  const blocks: CardDetailBlock[] = [];
  const push = (label: string, value: string | null | undefined, tone: 'plain' | 'done') => {
    const body = String(value ?? '').trim();
    if (body) blocks.push({ label, body, tone });
  };

  push(
    input.isFollowUp ? DETAIL_LABELS.followUpDescription : DETAIL_LABELS.description,
    input.description,
    'plain',
  );
  push(DETAIL_LABELS.followUpResult, input.followUpResult, 'done');
  push(DETAIL_LABELS.completionNote, input.completionNote, 'done');
  return blocks;
}

export function cardDetail(input: CardTextInput): CardDetail {
  const { summary, truncated } = summarizeText(input.headline);
  return { summary, truncated, blocks: detailBlocks(input) };
}

/**
 * Whether the card has anything to disclose.
 *
 * A button that expands to what is already on the screen is worse than none —
 * it teaches the reader that the button says nothing, and then they stop
 * pressing it on the cards where it does.
 */
export function hasMoreToShow(detail: CardDetail): boolean {
  return detail.truncated || detail.blocks.length > 0;
}
