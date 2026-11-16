import { DETAIL_LABELS } from '../utils/cardSummary';
import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, ListPlus, Paperclip, X } from "lucide-react";
import { contactResultKey, takesContactResult } from "../utils/contactResults";
import { MAX_ACTIVITY_ATTACHMENTS, formatFileSize, type ActivityAttachment } from "../utils/attachments";
import {
  HANDOFF_MODES, HANDOFF_MODE_LABELS, handoffNeedsRecipient, handoffRefusal, type HandoffMode,
} from "../utils/taskHandoff";
import type { HandoffBody } from "../api/tasks";
import ShamsiDatePicker from "./ShamsiDatePicker";
import TaskWorkHistory from "./TaskWorkHistory";
import { tasksApi } from "../api/tasks";
import { TASK_DONE, TASK_CANCELLED } from "../utils/workBoard";
import TaskFileLinks from "./TaskFileLinks";

/**
 * The task's work conversation and explicit completion action. A work report
 * appends an entry and keeps the task open. Completion still goes through the
 * host's existing flow, including its optional handoff. Closed tasks only show
 * their history. Hosts can retain the standalone completion form by omitting
 * workLogEnabled.
 */

export interface TaskCompletionModalProps {
  /**
   * The task being ticked. The modal is drawn only while this is set.
   *
   * **Structural rather than `Task`**: the doors hand it different shapes — the
   * board hands a `Task`, a project's follow-up tab hands a row its own endpoint
   * derived — and naming either type would make this modal usable from that one
   * only, which is how a second «ثبت انجام کار» dialog comes to be written.
   */
  task: {
    id: string; title: string; completionNote?: string | null;
    description?: string | null; status?: string | null; completedAt?: string | null;
    attachments?: ActivityAttachment[];
    relatedToType?: string | null; taskKind?: string | null; contactResult?: string | null;
    completionAttachments?: ActivityAttachment[];
    relatedProject?: { code?: string | null } | null;
  } | null;
  /** Enables the task's append-only conversation without changing its status. */
  workLogEnabled?: boolean;
  /** Hosts may supply their uploader; otherwise use the standard upload API. */
  onUploadFile?: (file: File) => Promise<string>;
  /** The colleagues work can go to. Absent or empty offers «برای خودم» alone. */
  users?: readonly { id: string; fullName: string; isActive?: boolean }[];
  /** Never offered as a colleague: work for oneself is «برای خودم». */
  currentUserId?: string | null;
  /**
   * Whether the task belongs to a project — what allows a referral and the
   * category. Derived from `task.relatedProject` when the host does not say.
   */
  hasProject?: boolean;
  /** `settings.activityCategories`, for the optional category choice. */
  categories?: readonly { id: string; name: string }[];
  priorityOptions?: readonly string[];
  /** `settings.dropdownItems.nextActionKinds`, for «برای خودم». */
  kinds?: readonly string[];
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
   * `note` is as typed; blank means «nothing to add», never «unchanged». The
   * host writes the completion first and posts `extras.handoff` only once that
   * has landed.
   */
  onConfirm: (note: string, contactResult?: string | null, extras?: TaskCompletionExtras) => void;
  saving?: boolean;
}

/**
 * What the tick carries besides the words: the files of «شرح اقدام», and «کار
 * بعدی» when it is on.
 */
export interface TaskCompletionExtras {
  attachments: ActivityAttachment[];
  handoff: HandoffBody | null;
}

export default function TaskCompletionModal({
  task, contactResults, onCancel, onConfirm, saving,
  users, currentUserId, hasProject, categories, priorityOptions, kinds,
  workLogEnabled = false,
  onUploadFile,
}: TaskCompletionModalProps): React.ReactElement | null {
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [files, setFiles] = useState<ActivityAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [nextOn, setNextOn] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [mode, setMode] = useState<HandoffMode>("SELF");
  const [kind, setKind] = useState("");
  const [nextText, setNextText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
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
    setNote(workLogEnabled ? "" : task.completionNote ?? "");
    setResult(task.contactResult ?? "");
    setFiles(workLogEnabled ? [] : task.completionAttachments ?? []);
    setNextOn(false); setRecipient(""); setMode("SELF"); setKind(""); setNextText("");
    setDueDate(""); setPriority(""); setCategoryId(""); setProblem(null);
  }, [task?.id]);

  if (!task) return null;
  const closed = workLogEnabled && (task.status === TASK_DONE || task.status === TASK_CANCELLED);
  const busy = !!saving || uploading || posting;

  const saveProgress = async () => {
    if (busy || closed) return;
    if (!note.trim() && files.length === 0) { setProblem("شرح کار یا فایل پیوست را وارد کنید."); return; }
    setPosting(true); setProblem(null);
    try {
      await tasksApi.addWorkLog(task.id, note, files);
      setNote(""); setFiles([]); setHistoryVersion((n) => n + 1);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "ثبت شرح کار ممکن نشد.");
    } finally { setPosting(false); }
  };

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
  const modes = HANDOFF_MODES.filter((m) =>
    (m !== "REFERRAL" || onProject) && (!handoffNeedsRecipient(m) || colleagues.length > 0));
  const chosenMode: HandoffMode = modes.includes(mode) ? mode : "SELF";
  const forSelf = chosenMode === "SELF";

  const handoff: HandoffBody | null = nextOn ? {
    mode: chosenMode,
    recipientUserId: forSelf ? "" : recipient,
    // Yourself: the next step, in its own words. A colleague: «شرح اقدام» is the
    // message — «آقای بهمانی لیست قیمت به پیوست خدمت شما» — with its files.
    text: forSelf ? nextText : note,
    attachments: forSelf ? [] : files,
    dueDate: chosenMode !== "NOTICE" && dueDate ? dueDate : null,
    priority: (forSelf || chosenMode === "TASK") && priority ? priority : null,
    categoryId: !forSelf && onProject && categoryId ? categoryId : null,
    kind: forSelf && kind ? kind : null,
  } : null;

  const send = () => {
    if (busy || closed) return;
    // Asked here as well as on the server, so nothing is ticked off before the
    // person learns that the second half could not be sent.
    if (handoff) {
      const refusal = handoffRefusal(handoff, { hasProject: onProject, selfUserId: currentUserId });
      if (refusal) { setProblem(refusal); return; }
    }
    setProblem(null);
    onConfirm(note, asksResult ? (result.trim() || null) : undefined, { attachments: files, handoff });
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
      const uploader = onUploadFile ?? (async (file: File) => {
        const { uploadFile } = await import("../imageUtils");
        return uploadFile(file, "task-files");
      });
      const added: ActivityAttachment[] = [];
      for (const f of picked) {
        const url = await uploader(f);
        added.push({ name: f.name, size: formatFileSize(f.size), url });
      }
      setFiles((prev) => [...prev, ...added]);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "بارگذاری فایل ممکن نشد.");
    } finally {
      setUploading(false);
    }
  };

  const field = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white";

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl border border-slate-200 max-h-[90vh] flex flex-col" role="dialog" aria-modal="true" aria-label={workLogEnabled ? "شرح کار و انجام وظیفه" : "ثبت انجام کار"} dir="rtl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
          <h3 className="font-bold text-sm text-slate-800">{workLogEnabled ? "شرح کار و انجام وظیفه" : "ثبت انجام کار"}</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            id="task-completion-cancel"
            className="text-slate-400 hover:text-slate-700 transition"
            title="انصراف"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-secondary break-words">{task.title}</p>
          {workLogEnabled && task.description && <p className="text-xs whitespace-pre-wrap break-words text-slate-600">{task.description}</p>}
          {workLogEnabled && <TaskFileLinks attachments={task.attachments} />}
          {workLogEnabled && <TaskWorkHistory taskId={task.id} version={historyVersion} />}
          {closed && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-2" data-task-closed>
              <p className="font-bold">{task.status} {task.completedAt ?? ""}</p>
              {task.completionNote && <p className="whitespace-pre-wrap break-words">{task.completionNote}</p>}
              {task.completionAttachments?.map((file) => <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="block text-sky-700 hover:underline">{file.name}</a>)}
            </div>
          )}
          {!closed && <fieldset disabled={busy} className="space-y-3 min-w-0">
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

          <div className="border-t border-hairline pt-3 space-y-2" data-completion-handoff>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                id="task-completion-handoff"
                checked={nextOn}
                onChange={(e) => setNextOn(e.target.checked)}
              />
              <ListPlus size={13} />
              کار بعدی {workLogEnabled ? "(پس از اتمام)" : ""}
            </label>
            {nextOn && (
              <div className="space-y-2">
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

                {forSelf ? (
                  <>
                    <p className="text-[11px] text-muted">
                      یک وظیفه برای خودتان در ادامهٔ همین کار ساخته می‌شود و تا تاریخش در «در انتظار» می‌ماند.
                    </p>
                    {(kinds?.length ?? 0) > 0 && (
                      <select
                        id="task-completion-next-kind"
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                        className={field}
                      >
                        <option value="">نوع اقدام (اختیاری)</option>
                        {kinds!.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    )}
                    <textarea
                      id="task-completion-next-text"
                      value={nextText}
                      onChange={(e) => setNextText(e.target.value)}
                      rows={2}
                      placeholder="کار بعدی چیست؟"
                      className={`${field} resize-y`}
                    />
                    <ShamsiDatePicker label="تاریخ کار بعدی" required value={dueDate} onChange={setDueDate} compact />
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-muted">
                      شرح اقدام و فایل‌های بالا برای همکار فرستاده می‌شود.
                      {onProject ? " در فعالیت‌های پروژه هم ثبت می‌شود و دسته‌بندی در صورت نیاز باز می‌شود." : " در ادامهٔ همین وظیفه ثبت می‌شود."}
                    </p>
                    <select
                      id="task-completion-recipient"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      className={field}
                    >
                      <option value="">— انتخاب همکار —</option>
                      {colleagues.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                    {chosenMode !== "NOTICE" && (
                      <ShamsiDatePicker label="مهلت انجام (اختیاری)" value={dueDate} onChange={setDueDate} compact />
                    )}
                  </>
                )}

                {(forSelf || chosenMode === "TASK") && (priorityOptions?.length ?? 0) > 0 && (
                  <select
                    id="task-completion-handoff-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className={field}
                  >
                    <option value="">اولویت: همان اولویت این وظیفه</option>
                    {priorityOptions!.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                {!forSelf && onProject && (categories?.length ?? 0) > 0 && (
                  <select
                    id="task-completion-handoff-category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className={field}
                  >
                    <option value="">دسته‌بندی فعالیت: خودکار</option>
                    {categories!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

          </fieldset>}

          {problem && (
            <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-completion-problem>{problem}</div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-hairline shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            {closed ? "بستن" : "انصراف"}
          </button>
          {workLogEnabled && !closed && <button type="button" id="task-progress-confirm" onClick={() => void saveProgress()} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60">{posting ? "در حال ثبت…" : "ثبت شرح کار (بدون اتمام)"}</button>}
          {!closed && <>
          <button
            type="button"
            onClick={send}
            disabled={busy}
            id="task-completion-confirm"
            className="px-3 py-1.5 rounded-lg text-xs bg-emerald-500 text-white hover:bg-emerald-600 transition inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <CheckCircle2 size={14} />
            ثبت انجام کار
          </button>
          </>}
        </div>
      </div>
    </div>
  );
}
