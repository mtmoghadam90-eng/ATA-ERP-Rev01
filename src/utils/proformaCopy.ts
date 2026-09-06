import { addDaysToShamsi, getShamsiDaysDifference } from "../dateUtils";

/**
 * The dates a copied proforma is issued with.
 *
 * Copying carried `issueDate` and `expiryDate` across verbatim, so a quotation
 * duplicated to re-quote a job a month later went out dated a month ago — and
 * every figure measured from that date was measured from the wrong one: the
 * follow-up queue's age, the health badge, `saleDateOf`'s fallback when the
 * project never stamped a winning date, and the printed document the customer
 * reads. A copy is a **new document issued now**; that it began as a duplicate
 * of an older one is not a fact about when it was written.
 *
 * The date stays editable afterwards, which is the whole reason this can be a
 * default rather than a question: somebody re-issuing a document under its
 * original date opens the copy and puts it back.
 *
 * Pure and clock-free — `todayJalali` is an argument — so `test:rules` can hold
 * it. It runs in the browser only, because the copy is composed there and
 * posted as an ordinary create; there is no copy endpoint for it to bypass.
 */

export interface ProformaCopyDates {
  issueDate: string;
  /** Empty when the source had none — see below. */
  expiryDate: string;
}

/**
 * Today's date, and the **validity window** carried forward.
 *
 * The expiry is not copied and it is not recomputed from a fixed 30 days
 * either. It is moved by exactly the distance the issue date moved, so a
 * quotation deliberately given ten days of validity is still valid for ten and
 * one given sixty keeps sixty — a hardcoded default would silently rewrite a
 * decision somebody made about a customer. Copying it unchanged is the other
 * failure and the sharper one: the copy would be issued today and already
 * expired, with the printed document contradicting itself.
 *
 * Two things are deliberately left alone. **A source with no expiry gets
 * none** — a blank means «this offer does not lapse», and inventing a date is a
 * claim made to a customer that nobody wrote. And a source with no issue date
 * keeps its stored expiry: there is no window to measure, and moving the date
 * by a distance that cannot be computed would put a wrong figure where an old
 * one at least says what the original said.
 *
 * `sentDate` is not here because it is not copied at all: the server stamps it
 * the first time a document is marked «ارسال شده», and a copy has not been sent.
 */
export function copiedProformaDates(
  source: { issueDate?: string | null; expiryDate?: string | null },
  todayJalali: string,
): ProformaCopyDates {
  const issueDate = todayJalali;
  const sourceIssue = String(source.issueDate ?? "").trim();
  const sourceExpiry = String(source.expiryDate ?? "").trim();

  if (!sourceExpiry) return { issueDate, expiryDate: "" };
  if (!sourceIssue) return { issueDate, expiryDate: sourceExpiry };

  /*
   * Signed on purpose. A stored expiry that precedes its own issue date is
   * broken data, and preserving the relationship keeps the copy as visibly
   * broken as the original rather than quietly repairing one document and
   * leaving the rest of them wrong.
   */
  const validityDays = getShamsiDaysDifference(sourceIssue, sourceExpiry);
  return { issueDate, expiryDate: addDaysToShamsi(todayJalali, validityDays) };
}
