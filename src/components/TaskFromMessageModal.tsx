import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, X } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import { addDaysToShamsi, getTodayShamsi } from '../dateUtils';
import { taskTitleFromMessage } from '../utils/mentions';

/**
 * Turning something said in the feed into a task on your own list.
 *
 * In practice half the work on a job is handed out in conversation without
 * anybody being formally referred: «این را من پیگیری می‌کنم». That left the
 * person holding a commitment with nothing recording it, so the button beside
 * each message opens this with the message already in it — the first line as
 * the title, the whole message as the description, and the job it was said on
 * already attached.
 *
 * Everything is editable before it is saved, because a sentence written to a
 * colleague is rarely the sentence you want on your own board.
 *
 * Assigned to the reader, and only to them. Handing work to somebody else is
 * what naming them in the message does, and that raises a referral with a
 * thread rather than a task appearing silently on their list.
 */

export interface TaskDraft {
  title: string;
  description: string;
  dueDate: string;
  priority: 'فوری' | 'بالا' | 'متوسط' | 'پایین';
}

interface Props {
  /** The message this task is being made from. */
  message: { id: string; text: string };
  /** The job it was said on, printed so the attachment is not a leap of faith. */
  project: { id: string; code: string; name: string } | null;
  /** Who it will be assigned to — always the reader. */
  assigneeName: string;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => Promise<void>;
}

export default function TaskFromMessageModal({
  message, project, assigneeName, onClose, onSubmit,
}: Props) {
  const [title, setTitle] = useState(() => taskTitleFromMessage(message.text));
  const [description, setDescription] = useState(message.text);
  const [dueDate, setDueDate] = useState(() => addDaysToShamsi(getTodayShamsi(), 3));
  const [priority, setPriority] = useState<TaskDraft['priority']>('متوسط');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Seeded once per message, not on every render.
   *
   * The feed behind this re-renders on its own — a badge poll returns, the
   * activity list revalidates — and an effect keyed on the text would wipe a
   * half-edited title each time. Same family as the price calculator.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === message.id) return;
    seededFor.current = message.id;
    setTitle(taskTitleFromMessage(message.text));
    setDescription(message.text);
    setError(null);
  }, [message.id, message.text]);

  const submit = async () => {
    if (!title.trim()) { setError('عنوان وظیفه الزامی است.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), description, dueDate, priority });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت وظیفه با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      dir="rtl"
      id="task-from-message-modal"
    >
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <ListChecks size={15} className="text-sky-600" />
              ثبت وظیفه برای خودم
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              از روی این پیام، در فهرست وظایف <strong>{assigneeName}</strong> ثبت می‌شود.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {project && (
            <div className="text-[11px] bg-sky-50 border border-sky-100 text-sky-800 rounded-xl px-3 py-2 flex flex-wrap items-center gap-1.5">
              <span className="font-bold">پروژه:</span>
              <span className="font-mono font-bold">{project.code}</span>
              <span className="text-sky-300">|</span>
              <span>{project.name}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              عنوان وظیفه <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-2.5 text-xs focus:outline-none focus:border-sky-400"
              id="task-from-message-title"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">شرح</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:border-sky-400 leading-relaxed"
              id="task-from-message-description"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ShamsiDatePicker
              label="موعد انجام"
              value={dueDate}
              onChange={setDueDate}
              compact
            />
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">اولویت</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskDraft['priority'])}
                className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white focus:outline-none focus:border-sky-400"
              >
                <option value="فوری">فوری</option>
                <option value="بالا">بالا</option>
                <option value="متوسط">متوسط</option>
                <option value="پایین">پایین</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-bold rounded-xl p-3 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !title.trim()}
            id="task-from-message-submit"
            className="px-5 py-2 text-xs font-bold bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white rounded-lg transition"
          >
            {saving ? 'در حال ثبت…' : 'ثبت وظیفه'}
          </button>
        </div>
      </div>
    </div>
  );
}
