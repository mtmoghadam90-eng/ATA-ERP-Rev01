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
 *   that only ever writes the four operators is what actually keeps it honest.
 */

export interface RuleCondition {
  field: string;
  operator: "equals" | "not_equals" | "greater_than" | "less_than" | string;
  value: string;
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
  }
  return match;
}
