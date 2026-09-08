/**
 * What a repeated reminder becomes once it has been ignored.
 *
 * A repeat on its own is a louder version of the same card, and a card somebody
 * has already left alone twice is not made more likely to be picked up by being
 * printed a third time. What changes an outcome is one of two things: it becomes
 * urgent, or it lands on somebody else — a buyer's unanswered supplier is the
 * purchasing manager's problem by the fourth week, and nothing in the system
 * ever said so.
 *
 * Both are opt-in and both are **explicit values, never a computed step**. «one
 * priority higher» is a rule with no answer at «فوری», so a rule configured that
 * way would silently stop escalating at exactly the point escalation matters —
 * the shape of silent failure this codebase keeps repairing. A named priority
 * says what happens and keeps saying it.
 */

import type { WorkflowRule } from "../types";

type TaskConfig = NonNullable<WorkflowRule["actions"][number]["taskConfig"]>;

/** What the escalation changes about a firing. Empty means «nothing». */
export interface EscalationOutcome {
  priority?: TaskConfig["priority"];
  assignedTo?: string;
}

/**
 * The escalation in force at occurrence `n`, 1-based.
 *
 * Three rules, and each is a decision.
 *
 * **`escalateAfterOccurrences` is the switch and nothing else is.** A priority
 * or an assignee set with no occurrence threshold changes nothing, because the
 * threshold is the only thing that says *when* — reading a bare escalated
 * priority as «from the second one» would be this file guessing at a number the
 * person never typed.
 *
 * **The threshold is «after», so it takes effect on the firing *past* it.** A
 * rule escalating «after 2» raises its first two cards normally and the third
 * escalated, which is how somebody reads the word; taking effect *on* the second
 * would make «after 1» mean «always escalated», an option that is really just a
 * different priority on the rule itself.
 *
 * **It is a plateau, not a climb.** Once past the threshold every later firing
 * carries the same escalation. A climb would need a second list of steps, and
 * the escalation people actually want here is «this now belongs to the manager»,
 * which is not a thing that happens repeatedly.
 */
export function escalationFor(
  config: Pick<TaskConfig, "escalateAfterOccurrences" | "escalatePriority" | "escalateAssignedTo"> | undefined | null,
  occurrence: number,
): EscalationOutcome {
  const after = Math.max(0, Math.trunc(Number(config?.escalateAfterOccurrences) || 0));
  if (after <= 0) return {};
  const n = Math.max(0, Math.trunc(Number(occurrence) || 0));
  if (n <= after) return {};

  const out: EscalationOutcome = {};
  if (config?.escalatePriority) out.priority = config.escalatePriority;
  // An empty string is «not set», the same as absent: the form's own «همان
  // مسئول قبلی» option sends one, and looking that up would resolve nobody and
  // fall back to admin — a reminder quietly reassigned away from the person who
  // was working it.
  if (config?.escalateAssignedTo) out.assignedTo = config.escalateAssignedTo;
  return out;
}

/**
 * Whether a task action escalates at all — one reading, so the editor's own
 * summary line and the engine cannot disagree about a threshold with nothing
 * behind it.
 */
export function escalationIsConfigured(
  config: Pick<TaskConfig, "escalateAfterOccurrences" | "escalatePriority" | "escalateAssignedTo"> | undefined | null,
): boolean {
  const after = Math.max(0, Math.trunc(Number(config?.escalateAfterOccurrences) || 0));
  return after > 0 && Boolean(config?.escalatePriority || config?.escalateAssignedTo);
}
