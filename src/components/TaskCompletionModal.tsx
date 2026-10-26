import { DETAIL_LABELS } from '../utils/cardSummary';
import React, { useEffect, useRef, useState } from "react";
import { CalendarPlus, CheckCircle2, Paperclip, Send, X } from "lucide-react";
import { contactResultKey, takesContactResult } from "../utils/contactResults";
import { MAX_ACTIVITY_ATTACHMENTS, formatFileSize, type ActivityAttachment } from "../utils/attachments";
import { HANDOFF_MODES, HANDOFF_MODE_LABELS, handoffRefusal, type HandoffMode } from "../utils/taskHandoff";
import type { HandoffBody } from "../api/tasks";
import ShamsiDatePicker from "./ShamsiDatePicker";

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
  task: {
    id: string; title: string; completionNote?: string | null;
    relatedToType?: string | null; taskKind?: string | null; contactResult?: string | null;
    completionAttachments?: ActivityAttachment[];
    relatedProject?: { code?: string | null } | null;
  } | null;
  /**
   * «ارسال به همکار» — the colleagues the work can be handed on to. Absent or
   * empty draws no section, which is how a host that cannot hand work on says so.
   */
  users?: readonly { id: string; fullName: string; isActive?: boolean }[];
  /** Never offered as a colleague: a task for oneself is «ثبت و اقدام بعدی». */
  currentUserId?: string | null;
  /**
   * Whether the task belongs to a project — what allows a referral and the
   * category. Derived from `task.relatedProject` when the host does not say.
   */
  hasProject?: boolean;
  /** `settings.activityCategories`, for the optional category choice. */
  categories?: readonly { id: string; name: string }[];
  priorityOptions?: readonly string[];
  /**
   * `settings.dropdownItems.contactResults`. Offered only for a task related to
   * a customer (`takesContactResult`); absent or empty on a host that has no
   * such task, which draws no box.
   */
  contactResults?: readonly string[];
  onCancel: () => void;
  /**
   * Ticks the task off.
   *
   * `note` is as typed; blank means «nothing to add», never «unchanged».
   * `withNextAction` says which of the two buttons was pressed — the host
   * writes the completion either way and asks the follow-on question only on
   * the second, **after** the write has landed.
   */
  onConfirm: (
    note: string, withNextAction: boolean, contactResult?: string | null,
    extras?: TaskCompletionExtras,
  ) => void;
  saving?: boolean;
}

/**
 * What the tick carries besides the words: the files of «شرح اقدام», and the
 * handoff when «ارسال به همکار» is on. The host writes the completion with the
 * files first and posts the handoff only once that has landed.
 */
export interface TaskCompletionExtras {
  attachments: ActivityAttachment[];
  handoff: HandoffBody | null;
}

export default function TaskCompletionModal({
  task, contactResults, onCancel, onConfirm, saving,
  users, currentUserId, hasProject, categories, priorityOptions,
}: TaskCompletionModalProps): React.ReactElement | null {
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [files, setFiles] = useState<ActivityAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sendOn, setSendOn] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [mode, setMode] = useState<HandoffMode>("TASK");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
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
    setResult(task.contactResult ?? "");
    setFiles(task.completionAttachments ?? []);
    setSendOn(false); setRecipient(""); setMode("TASK");
    setDueDate(""); setPriority(""); setCategoryId(""); setProblem(null);
  }, [task?.id]);

  if (!task) return null;

  /*
   * The result is asked only where it means something — a task related to a
   * customer — and only when it is sent: a host that draws no box sends
   * `undefined`, which the write leaves out, so ticking an ordinary task never
   * clears a result recorded on it some other way.
   */
  const asksResult = takesContactResult(task) && ((contactResults?.length ?? 0) > 0 || !!task.contactResult);
  const list = contactResults ?? [];
  // A stored value the list no longer holds is drawn, disabled, rather than
  // rendering the placeholder over it — a `<select>` whose value matches no
  // option shows the first one, and a re-save would quietly clear it.
  const stale = !!result && !list.some((r) => contactResultKey(r) === contactResultKey(result));
  const onProject = hasProject ?? !!task.relatedProject?.code;
  const colleagues = (users ?? []).filter((u) => u.id !== currentUserId && u.isActive !== false);
  const canHandOff = colleagues.length > 0;
  const modes = HANDOFF_MODES.filter((m) => m !== "REFERRAL" || onProject);
  const chosenMode: HandoffMode = modes.includes(mode) ? mode : "TASK";

  const handoff: HandoffBody | null = sendOn ? {
    mode: chosenMode,
    recipientUserId: recipient,
    text: note,
    attachments: files,
    dueDate: chosenMode !== "NOTICE" && dueDate ? dueDate : null,
    priority: chosenMode === "TASK" && priority ? priority : null,
    categoryId: onProject && categoryId ? categoryId : null,
  } : null;

  const send = (withNext: boolean) => {
    // Asked here as well as on the server, so nothing is ticked off before the
    // person learns that the second half could not be sent.
    if (handoff) {
      const refusal = handoffRefusal(handoff, { hasProject: onProject, selfUserId: currentUserId });
      if (refusal) { setProblem(refusal); return; }
    }
    setProblem(null);
    onConfirm(note, withNext, asksResult ? (result.trim() || null) : undefined, { attachments: files, handoff });
  };

  const pickFiles = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    if (files.length + picked.length > MAX_ACTIVITY_ATTACHMENTS) {
      setProblem(`حداکثر ${MAX_ACTIVITY_ATTACHMENTS} فایل می‌توان پیوست کرد.`);
      return;
    }
    setUploading(true); setProblem(null);
    try {
      // At call time: `imageUtils` pulls `file-saver`, which makes this modal
      // unmountable outside a bundler.
      const { uploadFile } = await import("../imageUtils");
      const added: ActivityAttachment[] = [];
      for (const f of picked) {
        const url = await uploadFile(f, "task-files");
        added.push({ name: f.name, size: formatFileSize(f.size), url });
      }
      setFiles((prev) => [...prev, ...added]);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "بارگذاری فایل ممکن نشد.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
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

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-secondary break-words">{task.title}</p>
          {asksResult && (
            <div>
              <label htmlFor="task-completion-result" className="block text-xs font-medium text-slate-700 mb-1">
                نتیجهٔ تماس با مشتری <span className="text-faint">(اختیاری)</span>
              </label>
              <select
                id="task-completion-result"
                value={result}
                onChange={(e) => setResult(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
              >
                <option value="">— انتخاب نشده —</option>
                {stale && <option value={result} disabled>{result} (در فهرست نیست)</option>}
                {list.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="task-completion-note" className="block text-xs font-medium text-slate-700 mb-1">
              {DETAIL_LABELS.completionNote} <span className="text-faint">(اختیاری)</span>
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
            <div className="mt-1.5 space-y-1" data-completion-files>
              {files.map((f, i) => (
                <div key={f.url} className="flex items-center gap-2 text-[11px]">
                  <a href={f.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline break-all flex-1 min-w-0">{f.name}</a>
                  <span className="text-faint shrink-0">{f.size}</span>
                  <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600 shrink-0" title="حذف فایل">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <label className="inline-flex items-center gap-1 text-[11px] text-sky-700 cursor-pointer hover:underline">
                <Paperclip size={12} />
                {uploading ? "در حال بارگذاری…" : "پیوست فایل"}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  id="task-completion-files"
                  onChange={(e) => { void pickFiles(e.target.files); e.target.value = ""; }}
                />
              </label>
            </div>
          </div>

          {canHandOff && (
            <div className="border-t border-hairline pt-3 space-y-2" data-completion-handoff>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  id="task-completion-handoff"
                  checked={sendOn}
                  onChange={(e) => setSendOn(e.target.checked)}
                />
                <Send size={13} />
                ارسال به همکار
              </label>
              {sendOn && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted">
                    شرح اقدام و فایل‌های بالا برای همکار فرستاده می‌شود.
                    {onProject ? " در فعالیت‌های پروژه هم ثبت می‌شود و دسته‌بندی در صورت نیاز باز می‌شود." : " در ادامهٔ همین وظیفه ثبت می‌شود."}
                  </p>
                  <select
                    id="task-completion-recipient"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white"
                  >
                    <option value="">— انتخاب همکار —</option>
                    {colleagues.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup">
                    {modes.map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-handoff-mode={m}
                        aria-pressed={chosenMode === m}
                        onClick={() => setMode(m)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition ${chosenMode === m ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                      >
                        {HANDOFF_MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  {chosenMode !== "NOTICE" && (
                    <ShamsiDatePicker label="مهلت انجام (اختیاری)" value={dueDate} onChange={setDueDate} compact />
                  )}
                  {chosenMode === "TASK" && (priorityOptions?.length ?? 0) > 0 && (
                    <select
                      id="task-completion-handoff-priority"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white"
                    >
                      <option value="">اولویت: همان اولویت این وظیفه</option>
                      {priorityOptions!.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                  {onProject && (categories?.length ?? 0) > 0 && (
                    <select
                      id="task-completion-handoff-category"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white"
                    >
                      <option value="">دسته‌بندی فعالیت: خودکار</option>
                      {categories!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {problem && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-completion-problem>{problem}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hairline shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={() => send(false)}
            disabled={saving || uploading}
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
            onClick={() => send(true)}
            disabled={saving || uploading}
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
