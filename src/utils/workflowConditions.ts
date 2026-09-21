/**
 * Does this record still match this rule?
 *
 * Extracted from the middle of `executeRule`, where it had always been, because
 * a second reader arrived: a rule that closes its own task when the record no
 * longer matches has to ask the *same* question the firing asked. Two readings
 * of «does this match» is how a task comes to be raised by one rule and never
 * closed by it — the record moving on in a way one half recognises and the
 * other does not.
 *
 * Pure and database-free, so `test:rules` can hold it directly.
 *
 * **The behaviour is preserved exactly, including two things that are not
 * obviously right**, because these conditions are stored in live rules and
 * changing what they mean would silently alter automations nobody asked to
 * change:
 *
 * - Every condition is evaluated even after one has already failed. Harmless,
 *   and the loop reads as it always did.
 * - An operator this build does not know **matches**. That is not a decision
 *   worth defending on its own, but the alternative — a condition nobody
 *   recognises silently blocking every firing — is worse, and a rule editor
 *   that only ever writes the operators in `WORKFLOW_OPERATORS` is what
 *   actually keeps it honest.
 */

export interface RuleCondition {
  field: string;
  operator: "equals" | "not_equals" | "greater_than" | "less_than" | "in" | string;
  value: string;
}

/**
 * The values an `in` condition names, read out of the one string it is stored
 * as.
 *
 * Both commas are separators — the Latin one and «،» — because the list is
 * typed by somebody writing Persian and a rule that silently matched nothing
 * over a punctuation mark is the failure this catalogue exists to end. The same
 * fold both ways, for the reason `digitsOf` is one copy: a splitter that knew
 * one comma and an editor that wrote the other would disagree in the direction
 * nothing reports.
 */
export function conditionValueList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, i, all) => all.indexOf(part) === i);
}

export function matchesConditions(
  conditions: readonly RuleCondition[] | undefined | null,
  payload: Record<string, unknown>,
): boolean {
  let match = true;
  for (const cond of conditions ?? []) {
    const actualValue = payload[cond.field];
    if (cond.operator === "equals" && String(actualValue) !== String(cond.value)) match = false;
    if (cond.operator === "not_equals" && String(actualValue) === String(cond.value)) match = false;
    if (cond.operator === "greater_than" && Number(actualValue) <= Number(cond.value)) match = false;
    if (cond.operator === "less_than" && Number(actualValue) >= Number(cond.value)) match = false;
    /*
     * «یکی از این‌ها باشد» — the one thing four operators and an AND could not
     * say.
     *
     * Conditions are ANDed, so «وضعیت جدید **یا** در حال مذاکره» was not a
     * condition at all: it was two rules, which is two cards to keep in step
     * saying one thing — the second copy this codebase keeps repairing. Written
     * as `not_equals` against everything else it is five conditions that have
     * to be revisited every time the module gains a status.
     *
     * An **empty** list matches nothing rather than everything. Neither is a
     * good answer, which is why the save refuses one outright
     * (`emptyInCondition`); of the two, «fires on every record» would raise a
     * task on every project in the company, while this leaves the rule visibly
     * doing nothing — and the refusal is what stops anybody reaching either.
     */
    if (cond.operator === "in"
      && !conditionValueList(cond.value).includes(String(actualValue))) match = false;
  }
  return match;
}
