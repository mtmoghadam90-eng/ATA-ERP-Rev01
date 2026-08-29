import { Fragment, ReactNode } from 'react';
import { MentionableUser, mentionSpans } from '../utils/mentions';

/**
 * A message with the names in it marked.
 *
 * A mention is not decoration here: naming somebody is what raises the referral
 * on the thread below, so it has to read as a thing rather than as punctuation
 * in the middle of a sentence.
 *
 * Positions come from `mentionSpans`, which reports indices into the original
 * text — the normalisation it matches through is length-preserving for exactly
 * this reason.
 */
export function renderWithMentions(
  text: string,
  users: MentionableUser[],
): ReactNode {
  const spans = mentionSpans(text ?? '', users);
  if (spans.length === 0) return text;

  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach((span, i) => {
    if (span.start > at) out.push(<Fragment key={`t${i}`}>{text.slice(at, span.start)}</Fragment>);
    out.push(
      <span
        key={`m${i}`}
        className="text-sky-700 bg-sky-50 border border-sky-100 rounded px-1 font-bold"
      >
        {text.slice(span.start, span.end)}
      </span>,
    );
    at = span.end;
  });
  if (at < text.length) out.push(<Fragment key="tail">{text.slice(at)}</Fragment>);
  return out;
}
