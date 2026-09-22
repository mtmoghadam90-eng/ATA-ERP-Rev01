import React, { useEffect, useRef, useState } from "react";
import { CalendarPlus, CheckCircle2, X } from "lucide-react";

/**
 * «چه کاری انجام شد؟» — asked once, as the task is ticked off.
 *
 * Reported as «تنها کنترلی که روی وظیفه هست تیک انجام شد است؛ می‌خواهم بنویسم
 * چه کردم». The column was already there — `tasks.completionNote`, written by
 * the sales-chase flow and by nothing else — so what was missing was a box to
 * type into and a place on the card to read it back.
 *
 * **It is asked on the tick and nowhere else.** A save is not an event: people
 * save a task to fix a typo or move a date, and a dialog that arrives on every
 * save is answered «no» nine times in ten and becomes a reflex within a week,
 * taking the tenth with it — the `SaveWithNextActionButton` rule. Ticking a task
 * off *is* the event, and it happens once.
 *
 * Three things it deliberately does not do. **The note is optional**, so
 * pressing «ثبت» on an empty box is exactly what the bare tick always did and
 * costs one press; making it required would turn every routine tick into a
 * sentence somebody has to invent. **Reopening a finished task asks nothing** —
 * moving it back says the work is not done, which is not a thing to describe —
 * and the note is left alone rather than cleared, because it is still a record
 * of what was done and re-completing seeds the box with it so it can be added
 * to. And **the board's bulk move is untouched**: that is one press over several
 * ticked cards, and asking per card there would make it a form rather than a
 * gesture.
 *
 * **And the tick is where «حالا بعدش چه؟» belongs**, which is the one thing it
 * did not ask. «ذخیره و ثبت اقدام بعدی» sits beside «ذخیره» on ten forms, so
 * the question could only be reached by *opening* the task, setting its status
 * by hand and saving — while the gesture people actually finish a task with is
 * this one. That is the same Odoo shape the save button already takes: the
 * choice is in the **button**, so it costs one press when the answer is yes and
 * nothing at all when it is no — as against a dialog on every completion, which
 * is answered «no» often enough to become a reflex and takes the tenth with it.
 *
 * **The intent travels as an argument rather than through `arm`/`takeArmed`.**
 * That pair exists to bridge a `type="submit"` button and a form handler that
 * runs in a later tick; here the button *is* the action, so a ref would be a
 * flag that can be left set — exactly what `takeArmed` was written to clear —
 * to say what one parameter already says.
 */
export interface TaskCompletionModalProps {
  /**
   * The task being ticked. The modal is drawn only while this is set.
   *
   * **Structural rather than `Task`**, for the reason `nextActionFromTask`'s
   * parameter is: the doors hand it different shapes — the board hands a
   * `Task`, a project's follow-up tab hands a row its own endpoint derived —
   * and naming either type would make this modal usable from that one only,
   * which is how a second «ثبت انجام کار» dialog comes to be written. These
   * three fields are the whole of what it reads.
   */
  task: { id: string; title: string; completionNote?: string | null } | null;
  onCancel: () => void;
  /**
   * Ticks the task off.
   *
   * `note` is as typed; blank means «nothing to add», never «unchanged».
   * `withNextAction` says which of the two buttons was pressed — the host
   * writes the completion either way and asks the follow-on question only on
   * the second, **after** the write has landed.
   */
  onConfirm: (note: string, withNextAction: boolean) => void;
  saving?: boolean;
}

export default function TaskCompletionModal({
  task, onCancel, onConfirm, saving,
}: TaskCompletionModalProps): React.ReactElement | null {
  const [note, setNote] = useState("");
  const box = useRef<HTMLTextAreaElement | null>(null);

  /*
   * Seeded on the task, never on the object.
   *
   * The parent builds the prop inline, so keying the effect on the prop itself
   * would re-seed on every render of the screen behind the modal and wipe what
   * was half typed — the rule the price calculator was corrected for.
   */
  useEffect(() => {
    if (!task) return;
    setNote(task.completionNote ?? "");
  }, [task?.id]);

  if (!task) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
          <h3 className="font-bold text-sm text-slate-800">ثبت انجام کار</h3>
          <button
            type="button"
            onClick={onCancel}
            id="task-completion-cancel"
            className="text-slate-400 hover:text-slate-700 transition"
            title="انصراف"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-secondary break-words">{task.title}</p>
          <div>
            <label htmlFor="task-completion-note" className="block text-xs font-medium text-slate-700 mb-1">
              شرح اقدام <span className="text-faint">(اختیاری)</span>
            </label>
            <textarea
              id="task-completion-note"
              ref={box}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="چه کاری انجام شد؟"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right resize-y focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hairline">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note, false)}
            disabled={saving}
            id="task-completion-confirm"
            className="px-3 py-1.5 rounded-lg text-xs bg-emerald-500 text-white hover:bg-emerald-600 transition inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <CheckCircle2 size={14} />
            ثبت انجام کار
          </button>
          {/*
            The second answer, and the reason it is a button rather than a
            question: finishing a piece of work is exactly when the next one is
            known, and it costs nothing on the completions that have no next
            step — which is most of them.
          */}
          <button
            type="button"
            onClick={() => onConfirm(note, true)}
            disabled={saving}
            id="task-completion-confirm-next"
            className="px-3 py-1.5 rounded-lg text-xs bg-sky-600 text-white hover:bg-sky-700 transition inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <CalendarPlus size={14} />
            ثبت و اقدام بعدی
          </button>
        </div>
      </div>
    </div>
  );
}
