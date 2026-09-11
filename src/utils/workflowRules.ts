import type { WorkflowRule } from "../types";

/**
 * A rule the editor may safely take apart.
 *
 * Reported as «وقتی یک قانون را کپی می‌کنم، با تغییر فیلدهای یکی آن یکی هم عوض
 * می‌شود» — and both halves of that are true, because both the copy button and
 * the edit button handed the form `{ ...rule }`.
 *
 * A spread is **one level deep**. `conditions` and `actions` are arrays, and
 * each action's `taskConfig`/`messageConfig`/`notificationConfig` is an object,
 * so the copy and the original pointed at the *same* ones — and the rule editor
 * writes into them in place (`updatedActs[i].taskConfig!.titleTemplate = …`, in
 * twenty-nine places). So typing into the copy typed into the original, which
 * is exactly the `next[i].field = x` trap this codebase already documents,
 * arriving through a button rather than through a loop.
 *
 * The **edit** button had the quieter half of the same fault: the draft was the
 * stored object, so every keystroke rewrote `settings.workflows` before anybody
 * pressed save — and «انصراف» could not put it back, because there was nothing
 * left to put back.
 *
 * Cloning at the boundary is the fix rather than rewriting twenty-nine call
 * sites: once the draft is nobody else's object, mutating it is local and
 * correct. `structuredClone` rather than a JSON round trip because a rule is
 * configuration where an explicitly-`undefined` optional key and an absent one
 * should stay as they were.
 */
export function cloneWorkflowRule(rule: WorkflowRule): WorkflowRule {
  return structuredClone(rule);
}
