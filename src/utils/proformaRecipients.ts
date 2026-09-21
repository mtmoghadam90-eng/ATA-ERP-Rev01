/**
 * Who a quotation was recorded as sent to.
 *
 * Marking a document «ارسال شده» asks two questions — how it went, and to whom
 * — and the second one had no answer at all for half the customers on the
 * system. The field is scoped by `linkedTo`, and a customer link **joins the
 * opposite type**: a company's links are the people who work there, and a
 * *person's* links are the companies they belong to. So for a buyer who is a
 * natural person the query answers with nothing, the box read «هیچ مشتری حقیقی
 * به این کارفرما متصل نشده است», and the save refused for a list that could not
 * be filled in from any control on the screen. The document could not be marked
 * sent at all, which is how it was reported.
 *
 * The answer was never missing, only underived: **the recipient of a quotation
 * addressed to somebody is that somebody.** There is no second person to look
 * up and nothing for anybody to choose.
 *
 * These are pure so the form and both save paths read one rule; `test:rules`
 * covers them.
 */

import { CUSTOMER_TYPE_INDIVIDUAL } from "./moduleStatuses";

/**
 * The stored spelling of a natural person, read from the module's own list
 * rather than typed here: two spellings of one stored value is how two screens
 * come to disagree about who a document was addressed to.
 */
export const INDIVIDUAL_CUSTOMER_TYPE = CUSTOMER_TYPE_INDIVIDUAL;

/** As much of a customer as any of these rules reads. */
export interface RecipientCustomer {
  customerType?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * The name to record for a person, and the one the field matches on.
 *
 * A natural person's record keeps their name in `firstName`/`lastName`;
 * `companyName` is filled for them too, so it is preferred and the parts are
 * the fallback. A list row carries only `companyName`, which is why the
 * preference is that way round rather than the other.
 */
export function recipientDisplayName(c: RecipientCustomer | null | undefined): string {
  if (!c) return "";
  const company = (c.companyName || "").trim();
  if (company) return company;
  return `${c.firstName || ""} ${c.lastName || ""}`.trim();
}

/**
 * The buyer's own name, when the buyer is the recipient.
 *
 * Answers null for a company — a quotation to a company is read by a person
 * there, and which one is a real question the field exists to ask — and null
 * for a **type this build does not know**, which is the safe direction: a
 * record written by an integration falls through to the ordinary «choose
 * somebody», while the other reading would quietly file a company's name as a
 * person. Null too for a person with no name on the record, because an empty
 * string stored as a recipient is worse than an unanswered field.
 */
export function selfRecipientName(buyer: RecipientCustomer | null | undefined): string | null {
  if (!buyer || buyer.customerType !== INDIVIDUAL_CUSTOMER_TYPE) return null;
  const name = recipientDisplayName(buyer);
  return name || null;
}

/**
 * What is actually stored on the document.
 *
 * Whatever was chosen wins — a person buying for themselves may still have
 * asked for it to go to their accountant as well, and this must not overrule
 * that. It only fills the blank, which is why the form's own seeding is a
 * courtesy rather than the rule: the save computes the same answer whether
 * anybody saw the chip or not, so a document saved from a form that had not
 * finished loading its buyer is stored correctly all the same.
 */
export function resolveSentRecipients(
  buyer: RecipientCustomer | null | undefined,
  chosen: readonly string[] | null | undefined,
): string[] {
  const picked = (chosen || []).map((n) => n.trim()).filter(Boolean);
  if (picked.length > 0) return picked;
  const self = selfRecipientName(buyer);
  return self ? [self] : [];
}

/**
 * The refusal, or null.
 *
 * It is asked of the **resolved** list rather than of what is ticked, so the
 * one case that could not be answered no longer refuses, and a company with
 * nobody named still does — which is the question that was worth asking.
 */
export function sentRecipientsRefusal(
  buyer: RecipientCustomer | null | undefined,
  chosen: readonly string[] | null | undefined,
): string | null {
  return resolveSentRecipients(buyer, chosen).length === 0
    ? "لطفاً حداقل یک شخص دریافت‌کننده (مشتری حقیقی) را انتخاب کنید."
    : null;
}
