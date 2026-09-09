import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, X } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import { getTodayShamsi } from '../dateUtils';
import {
  NextActionDraft, NextActionSource, nextActionDraft, nextActionRefusal,
} from '../utils/nextAction';

/**
 * «اقدام بعدی» — one form, opened from wherever something has just been
 * finished.
 *
 * There is deliberately **one** of these rather than a block on each screen: a
 * next action is one shape of thing, and two copies of the form would be two
 * answers to what it inherits from the record it follows. The rules are pure in
 * `src/utils/nextAction.ts` and this draws them.
 *
 * It writes nothing itself. The host performs the two writes in the order that
 * matters (see `onSubmit`) — the same division as `ProductConfiguratorModal`,
 * which builds a mutation and lets its host save it, because the two hosts here
 * finish two different kinds of record and only they know how.
 */
export default function NextActionModal({
  open,
  source,
  kinds,
  people,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** What was just finished — the draft is derived from it. */
  source: NextActionSource | null;
  /** `settings.dropdownItems.nextActionKinds`, the company's own list. */
  kinds: readonly string[];
  /** The assignment picker's names; the person who just finished leads. */
  people: readonly string[];
  saving?: boolean;
  /** Reported by the host, because the host is what writes. */
  error?: string | null;
  onSubmit: (draft: NextActionDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NextActionDraft>(
    () => nextActionDraft(source ?? { title: '' }, getTodayShamsi()));
  const [refusal, setRefusal] = useState<string | null>(null);

  /*
   * Seeded on what means «start again» — opening, and the record it follows —
   * and never on the object prop itself.
   *
   * `source` is built inline by the screen behind this, and those screens
   * re-render on their own (the badge poll, any live-data event), so an effect
   * watching the object would re-seed a half-typed form every time. The id is
   * read through a ref for the same reason: it decides *when* to seed without
   * making the values a dependency.
   */
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const key = `${open ? '1' : '0'}:${source?.relatedToId ?? ''}:${source?.title ?? ''}`;
  useEffect(() => {
    if (!open) return;
    setDraft(nextActionDraft(sourceRef.current ?? { title: '' }, getTodayShamsi()));
    setRefusal(null);
  }, [key, open]);

  if (!open || !source) return null;

  const submit = () => {
    const why = nextActionRefusal(draft);
    setRefusal(why);
    if (!why) onSubmit(draft);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[1200]" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={16} />
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-slate-800 block">ثبت اقدام بعدی</span>
              {/*
                What it follows, named rather than assumed. The person pressed a
                button on one card among many and the modal covers the board.
              */}
              <span className="text-[10px] text-slate-500 block">
                پس از «{source.title}»
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition"
            title="بستن"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/*
            The job it belongs to is carried, not re-picked: the next action is
            almost always about the same record, and asking again is the
            commonest reason a form like this is abandoned half way. It is shown
            rather than offered, because changing it would make this a second
            task form.
          */}
          {source.relatedToName && (
            <div className="flex items-center gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <ArrowLeft size={12} className="text-slate-400 shrink-0" />
              <span className="text-slate-500">مرتبط با:</span>
              <span className="font-bold text-slate-700 break-words">{source.relatedToName}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">
              نوع اقدام <span className="text-rose-500">*</span>
            </label>
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              data-next-action-kind
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="">انتخاب کنید…</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {/*
              An empty list is «not configured», not «no kinds exist», and saying
              so beats a dropdown that opens onto nothing.
            */}
            {kinds.length === 0 && (
              <p className="text-[10px] text-amber-700">
                فهرست «انواع اقدام بعدی» خالی است — در تنظیمات ← لیست‌های کشویی تعریفش کنید.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">شرح اقدام بعدی</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              data-next-action-description
              placeholder="مثلاً: قیمت رقیب را بگیر و ۵٪ تخفیف پیشنهاد کن"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ShamsiDatePicker
              label="تاریخ اقدام بعدی"
              required
              value={draft.dueDate}
              onChange={(v) => setDraft({ ...draft, dueDate: v })}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">اولویت</label>
              <select
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                data-next-action-priority
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                {['پایین', 'متوسط', 'بالا', 'فوری'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">مسئول</label>
            <select
              value={draft.assignedTo}
              onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
              data-next-action-assignee
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              {/*
                «Nobody» is a real answer — the task form's «شخصی (بدون ارجاع)» —
                and `assigneeColumns` reads an empty name as deliberate rather
                than looking it up.
              */}
              <option value="">شخصی (بدون ارجاع)</option>
              {people.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {(refusal || error) && (
            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {refusal || error}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-3.5 border-t border-slate-100">
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            data-next-action-save
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition"
          >
            {saving ? 'در حال ثبت…' : 'ثبت اقدام بعدی و اتمام کار'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
