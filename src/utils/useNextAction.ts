import { useRef, useState } from 'react';
import { tasksApi } from '../api/tasks';
import { TASK_TODO } from './workBoard';
import { NextActionDraft, NextActionSource, nextActionTitle } from './nextAction';

/** How the record that was finished is actually closed. The host's half. */
export type NextActionCompletion = (source: NextActionSource) => Promise<unknown>;

/**
 * The host half of «انجام شد و اقدام بعدی», in one place.
 *
 * Three buttons offer it — the tasks list, a referral's thread on the board,
 * and the same thread in the inbox — and they finish two different kinds of
 * record, so the *completion* is theirs. What must not be theirs is the rest:
 * which order the two writes go in, what the new task inherits, and what
 * happens when one of them fails. Two copies of that is two answers to the same
 * question, which is the fault this codebase keeps repairing (`queueMessage`,
 * `resolveAssignee`, the five customer forms).
 *
 * **The completion is named at `start`, not at construction.** A screen that
 * draws both a task list and a referral thread finishes two kinds of record and
 * would otherwise need two of these — two modals, two pieces of state, and a
 * standing question about which one is open. The person presses one button, and
 * that press is the moment the host knows what it is closing.
 *
 * It creates an **ordinary task** through the tasks route. There is deliberately
 * no `POST /api/next-action`: a next action *is* a task, and a second creation
 * path would be a second copy of the assignee resolution, the capacity check and
 * the workflow trigger that route already runs.
 */
export function useNextAction() {
  const [source, setSource] = useState<NextActionSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completeRef = useRef<NextActionCompletion | null>(null);
  /*
   * The task already created, if the completion after it failed.
   *
   * A retry must not raise a second next action. This is the conditional-write
   * shape in the one place here that genuinely spans two requests.
   */
  const createdRef = useRef<string | null>(null);

  const start = (next: NextActionSource, complete: NextActionCompletion) => {
    createdRef.current = null;
    completeRef.current = complete;
    setError(null);
    setSource(next);
  };

  const close = () => {
    setSource(null);
    setError(null);
  };

  /**
   * Raises the next action, **then** completes what it follows.
   *
   * The order is the decision, and it is chosen for which failure announces
   * itself. Completing first and failing to create leaves the work recorded as
   * done and the next action silently lost — the card is off the board, so
   * nobody sees the gap. Creating first and failing to complete leaves the
   * original still sitting on the board: visible, wrong in a way somebody
   * notices, and fixed by pressing the button again.
   *
   * They are two requests rather than one transaction because they are two
   * facts: the completion is true on its own, and the next action is new work.
   * That is the opposite of `completeFollowUp`, where the replacement *is* part
   * of the decision and a half-done pair leaves a quotation marked as actively
   * chased with nothing chasing it.
   */
  const submit = async (draft: NextActionDraft) => {
    const complete = completeRef.current;
    if (!source || !complete) return;
    setSaving(true);
    setError(null);
    try {
      if (!createdRef.current) {
        const created = await tasksApi.create({
          title: nextActionTitle(draft.kind, source),
          description: draft.description || null,
          relatedToType: source.relatedToType ?? null,
          relatedToId: source.relatedToId ?? null,
          relatedToName: source.relatedToName ?? null,
          priority: draft.priority,
          dueDate: draft.dueDate,
          // A name with no id, so the server resolves it through
          // `resolveAssignee` and a spelling difference cannot leave the task
          // belonging to nobody.
          assignedToName: draft.assignedTo || null,
          status: TASK_TODO,
        });
        createdRef.current = created.id;
      }
      await complete(source);
      createdRef.current = null;
      setSource(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت اقدام بعدی انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  return { source, saving, error, start, close, submit };
}
