/**
 * Naming the record a workflow notice is about.
 *
 * Reported as «وقتی اعلان میاد که پیام خودکار ارسال نشد، معلوم نیست برای کدوم
 * پروژه و مشتری بوده. من نمیفهمم چیو باید چک کنم» — and that is the whole of
 * the fault: the notice carried the rule's name and the reason («این مشتری
 * شماره موبایل ندارد») and **not one word about which customer**, so the only
 * way to act on it was to guess which of the day's events had fired the rule.
 *
 * Nothing had to be looked up to fix it. `enrichPayload` has always resolved
 * `projectCode`, `projectName`, `customerName`, `proformaNumber` and `poNumber`
 * from the ids before the actions run — the notice simply threw them away. A
 * notice that cannot be acted on is worse than none: it teaches people that the
 * bell means nothing, which is the same failure the auto-close pass exists to
 * prevent on the task board.
 *
 * Pure so `test:rules` can hold it, and because what it reads is a payload
 * assembled from a dozen triggers — every key is optional and none may be
 * asserted.
 */

/** How long a name may run before it is cut. A notice is read at a glance. */
const NAME_LIMIT = 80;

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > NAME_LIMIT ? `${trimmed.slice(0, NAME_LIMIT)}…` : trimmed;
};

/**
 * The parts of «which record», in the order somebody would look for them.
 *
 * The **project code leads** because it is what every other screen is searched
 * by — `ProjectCodeLink` exists precisely because a code is how a person gets
 * from one module to the job — while the name is what they recognise. The
 * customer comes next, since half these refusals are facts about the customer's
 * own record («no mobile number», «opted out») and that is the screen to open.
 * The document is last and is the finest-grained: it says which of a project's
 * several live quotations this was.
 *
 * Each part is written only when it has something in it, the rule every block
 * in `projectDescriptionFor` follows: a heading with nothing under it reads as
 * something that failed to load.
 */
export function noticeSubjectParts(payload: unknown): string[] {
  const p = (payload && typeof payload === "object") ? payload as Record<string, unknown> : {};
  const parts: string[] = [];

  const code = text(p.projectCode);
  const name = text(p.projectName);
  if (code || name) {
    parts.push(`پروژه ${[code, name].filter(Boolean).join(" — ")}`);
  }

  const customer = text(p.customerName);
  if (customer) parts.push(`مشتری ${customer}`);

  const proforma = text(p.proformaNumber);
  if (proforma) parts.push(`پیش‌فاکتور ${proforma}`);
  else {
    const po = text(p.poNumber);
    if (po) parts.push(`سفارش خرید ${po}`);
  }

  return parts;
}

/**
 * One line naming the record, or an empty string.
 *
 * Empty is a real answer and is what a rule on a record carrying none of these
 * gives — a product's low-stock rule, say. It is **not** filled with «نامشخص»:
 * a label promising an identity and delivering none is worse than the absence,
 * because it reads as data that failed to load rather than as a kind of event
 * that has no project.
 */
export function noticeSubject(payload: unknown): string {
  return noticeSubjectParts(payload).join(" | ");
}

/**
 * The title of a «پیام خودکار ارسال نشد» notice.
 *
 * The rule's name stays first — it is what says *which automation* to go and
 * look at — and the record follows it, because the two questions somebody has
 * are «which rule» and «about what», in that order.
 */
export function failedMessageTitle(ruleName: unknown, payload: unknown): string {
  const rule = text(ruleName) || "بدون نام";
  const subject = noticeSubject(payload);
  return subject
    ? `پیام خودکار ارسال نشد: ${rule} — ${subject}`
    : `پیام خودکار ارسال نشد: ${rule}`;
}

/**
 * The body: why it did not go, and what it was about.
 *
 * The reason leads because it is the actionable half — «این مشتری شماره موبایل
 * ندارد» says what to fix — and the record follows on its own line so the
 * sentence is not run into a list of names.
 */
export function failedMessageBody(reason: unknown, payload: unknown): string {
  const why = String(reason ?? "").trim();
  const subject = noticeSubject(payload);
  if (!subject) return why;
  if (!why) return subject;
  return `${why}\n${subject}`;
}
