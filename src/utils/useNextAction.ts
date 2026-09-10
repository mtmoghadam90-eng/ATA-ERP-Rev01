import { useRef, useState } from 'react';
import { tasksApi } from '../api/tasks';
import { TASK_TODO } from './workBoard';
import {
  NEXT_ACTION_KIND, NextActionDraft, NextActionSource, nextActionTitle,
} from './nextAction';

/**
 * The host half of «ذخیره و ثبت اقدام بعدی», in one place.
 *
 * Ten forms offer the button and each saves a different kind of record, so the
 * *save* is theirs. What must not be theirs is the rest: when the question is
 * asked, what the new task inherits, and what happens when one of the two
 * writes fails. Ten copies of that is ten answers to one question, which is the
 * fault this codebase keeps repairing (`queueMessage`, `resolveAssignee`, the
 * five customer forms).
 *
 * **The save happens first, and that is forced rather than chosen.** A record
 * created by this save has no id until the server has written it, so a next
 * action raised beforehand could only point at nothing — and a card nobody can
 * trace back to its job is the thing this feature exists to avoid. The two are
 * therefore two requests and not one transaction, which is honest: the save is
 * true on its own, and if the task cannot be created afterwards the record is
 * still correctly saved and the modal says so with the draft still in it.
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
  /*
   * Which button was pressed.
   *
   * A ref and not state: the form submits in the same tick the button is
   * pressed, so a `setState` would not have landed by the time the handler
   * reads it back, and every save would read as the plain one.
   */
  const armed = useRef(false);

  /** «ذخیره و ثبت اقدام بعدی» was pressed; the form then submits as usual. */
  const arm = () => { armed.current = true; };

  /**
   * Reads which button was pressed **and clears it**, at the top of the submit.
   *
   * Read-and-clear rather than a plain read, because a submit handler has many
   * ways not to reach its save: a required field is blank, a duplicate is
   * found, the contact rule refuses. Leaving the flag set through one of those
   * would arm the *next* save instead — somebody presses «ذخیره و اقدام بعدی»,
   * is told to fill in a field, presses plain «ذخیره», and is asked for a next
   * action they did not request. Consumed once, at the top, it cannot happen.
   *
   * A form that defers its save behind a confirmation carries the answer down
   * to it rather than reading the flag again later.
   */
  const takeArmed = () => {
    const wanted = armed.current;
    armed.current = false;
    return wanted;
  };

  const close = () => { setSource(null); setError(null); };

  /**
   * Asks the question once the save has actually landed — and only then.
   *
   * `saved` is whatever the form's own save resolved to, so **an undefined
   * answer is a failed save**: every module's helper reports its own error and
   * returns nothing, which is exactly the signal needed here. Raising a next
   * action for a record that was refused would leave a card pointing at a job
   * that does not exist.
   */
  const ask = async <T,>(
    wanted: boolean,
    saved: Promise<T | undefined> | T | undefined,
    describe: (record: NonNullable<T>) => NextActionSource,
  ) => {
    if (!wanted) return;
    const record = await saved;
    if (record === undefined || record === null) return;
    setError(null);
    setSource(describe(record as NonNullable<T>));
  };

  /** Raises the task the person has just described. */
  const submit = async (draft: NextActionDraft) => {
    if (!source) return;
    setSaving(true);
    setError(null);
    try {
      await tasksApi.create({
        title: nextActionTitle(draft.kind, source),
        description: draft.description || null,
        relatedToType: source.relatedToType,
        relatedToId: source.relatedToId,
        relatedToName: source.relatedToName,
        priority: draft.priority,
        dueDate: draft.dueDate,
        // A name with no id, so the server resolves it through
        // `resolveAssignee` and a spelling difference cannot leave the task
        // belonging to nobody.
        assignedToName: draft.assignedTo || null,
        status: TASK_TODO,
        /*
         * Its own kind, which is what parks it in «در انتظار» until its day.
         *
         * The status is «برای انجام» all along — that is the column it lands in
         * the morning its date arrives — and the kind is what says «not yet».
         * Nothing else about it differs from an ordinary task: it is ticked,
         * edited, moved and texted exactly as one.
         */
        taskKind: NEXT_ACTION_KIND,
      });
      setSource(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت اقدام بعدی انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  return { source, saving, error, arm, takeArmed, close, ask, submit };
}
