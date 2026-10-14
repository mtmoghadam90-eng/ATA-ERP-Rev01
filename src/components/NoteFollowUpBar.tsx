import { useEffect, useState } from 'react';
import { CheckCircle2, ListTodo, Milestone, X, Loader2 } from 'lucide-react';
import { PROJECT_STAGES } from '../utils/projectStage';
import { projectsApi } from '../api/projects';
import { ApiError } from '../api/client';

/**
 * «یادداشت ثبت شد — حالا چه؟», drawn under a quotation's notes the moment one
 * is saved.
 *
 * What is written there is usually an agreement reached on the phone, and an
 * agreement is rarely the end of anything: the customer said they will decide
 * after the technical review, so the job's stage moves; or they asked for the
 * revised drawings, so somebody now has work. Both used to mean closing the
 * document, finding the project, and doing it from two other screens — and the
 * note was the only trace left of either.
 *
 * Two doors, and neither is a new write path. **A task** opens the same «ثبت
 * اقدام بعدی» form every save button opens (`onTask`), which already offers an
 * assignee other than oneself and a referral to colleagues under the project's
 * own category. **The stage** is the project's manual override, written as the
 * two keys the project route already accepts — `manualStage` and its lock —
 * so the project's own rules decide what that means (`namesManualStage`):
 * locked pins it, unlocked is «show this now» until the records move.
 *
 * It asks nothing by itself and disappears when dismissed: a note is often
 * just a note, and a prompt that has to be closed every time is a prompt that
 * gets ignored.
 */
export interface NoteFollowUpBarProps {
  projectId?: string | null;
  /** May this person change the project at all (the `projects` permission). */
  canEditProject: boolean;
  onTask: () => void;
  onClose: () => void;
}

const AUTO = '';

export default function NoteFollowUpBar({ projectId, canEditProject, onTask, onClose }: NoteFollowUpBarProps) {
  const [stageOpen, setStageOpen] = useState(false);
  const [stage, setStage] = useState(AUTO);
  const [locked, setLocked] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The project's stage as it stands, read once the control is opened — the
  // starting value of the dropdown should be what is there, not «خودکار».
  useEffect(() => {
    if (!stageOpen || !projectId) return;
    let live = true;
    projectsApi.get(projectId)
      .then((p) => {
        if (!live) return;
        setCurrent(p.stage ?? null);
        setStage(p.manualStage ?? AUTO);
        setLocked(!!p.manualStageLocked);
      })
      .catch(() => { /* the dropdown still works from «خودکار» */ });
    return () => { live = false; };
  }, [stageOpen, projectId]);

  const saveStage = async () => {
    if (!projectId) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await projectsApi.update(projectId, {
        manualStage: stage || null,
        manualStageLocked: stage ? locked : false,
      });
      setCurrent(saved.stage ?? null);
      setMessage(`مرحلهٔ پروژه: ${saved.stage || '—'}`);
      setStageOpen(false);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'تغییر مرحلهٔ پروژه با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  const stageAllowed = !!projectId && canEditProject;

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2.5 text-right" data-note-follow-up>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
          <CheckCircle2 size={14} />
          یادداشت ثبت شد. قدم بعدی؟
        </span>
        <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded" title="بستن">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onTask}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-sky-200 text-sky-700 hover:bg-sky-50 text-xs font-bold transition"
          data-note-follow-up-task
        >
          <ListTodo size={13} />
          ثبت وظیفه برای خودم یا همکار
        </button>
        {stageAllowed && (
          <button
            type="button"
            onClick={() => setStageOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${stageOpen ? 'bg-violet-600 text-white border-violet-600' : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'}`}
            data-note-follow-up-stage
          >
            <Milestone size={13} />
            تغییر مرحلهٔ پروژه
          </button>
        )}
      </div>
      {!projectId && (
        <p className="text-[11px] text-slate-500">این پیش‌فاکتور به پروژه‌ای وصل نیست؛ تغییر مرحله ممکن نیست.</p>
      )}
      {stageOpen && stageAllowed && (
        <div className="rounded-lg border border-violet-200 bg-white p-2.5 space-y-2" data-note-follow-up-stage-form>
          {current && <p className="text-[11px] text-slate-500">مرحلهٔ فعلی: <b className="text-slate-700">{current}</b></p>}
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            data-note-follow-up-stage-select
          >
            <option value={AUTO}>خودکار (از اسناد پروژه)</option>
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {stage && (
            <label className="flex items-start gap-1.5 text-[11px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} className="mt-0.5" />
              <span>
                قفل شود — مرحله ثابت می‌ماند تا خودتان عوضش کنید. بدون قفل، با اولین تغییر در اسناد پروژه دوباره خودکار می‌شود.
              </span>
            </label>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => { void saveStage(); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-bold transition"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              ثبت مرحله
            </button>
          </div>
        </div>
      )}
      {message && <p className="text-[11px] font-bold text-violet-700" data-note-follow-up-message>{message}</p>}
    </div>
  );
}
