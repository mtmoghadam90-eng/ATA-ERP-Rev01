import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, RefreshCw, ShieldOff } from 'lucide-react';
import { stuckWorkApi, StuckRow, StuckWorkReport } from '../api/stuckWork';
import { STUCK_SECTION_LABELS, StuckSection } from '../utils/stuckWork';
import { toPersianDigits } from '../numUtils';
import ProjectCodeLink from './ProjectCodeLink';

/**
 * «کارهای متوقف» — what is sitting still, across the chain.
 *
 * The workflow engine can *act* on a stuck record, but only once somebody has
 * written a rule for that exact state. This is the screen that tells them which
 * states are worth writing one for — and it needs no rule, no setup and no
 * configuration to say something on the day it is first opened.
 *
 * It writes nothing. Every row's title opens the job it belongs to, because the
 * next thing anybody does with «این سفارش ۳۰ روز در ترخیص گمرک مانده» is go and
 * look at the job.
 */

interface Props {
  onOpenProject?: (code: string) => void;
}

const SECTION_ORDER: StuckSection[] = ['purchaseOrder', 'afterSales', 'projectStage'];

/*
 * The severity's own colours. Two bands rather than one flag, because a bare
 * boolean makes the screen a cliff — nothing, nothing, nothing, crisis — and the
 * use of it is seeing what is *about to* go wrong while a call still helps.
 */
const SEVERITY_STYLE: Record<string, { chip: string; bar: string; label: string }> = {
  OVERDUE: {
    chip: 'bg-rose-100 text-rose-800 border-rose-200',
    bar: 'bg-rose-500',
    label: 'از حد گذشته',
  },
  WARN: {
    chip: 'bg-amber-100 text-amber-800 border-amber-200',
    bar: 'bg-amber-500',
    label: 'نزدیک به حد',
  },
};

export default function StuckWorkView({ onOpenProject }: Props) {
  const [report, setReport] = useState<StuckWorkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [section, setSection] = useState<StuckSection | 'all'>('all');

  /*
   * Stable, and with no props among its dependencies. A helper rebuilt on every
   * parent render gives the effect below a new function each time, and `App`
   * re-renders on the badge poll and on every write anywhere — which is how the
   * messaging screen came to refetch in a loop and jump back to the top.
   */
  const load = useCallback(async (onlyOverdue: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await stuckWorkApi.report(!onlyOverdue);
      setReport(res as unknown as StuckWorkReport);
    } catch (err) {
      setError((err as Error)?.message || 'گزارش خوانده نشد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(overdueOnly); }, [load, overdueOnly]);

  const rows: StuckRow[] = (report?.rows ?? []).filter(
    (r) => section === 'all' || r.section === section,
  );

  const totals = SECTION_ORDER.map(
    (id) => report?.sections.find((s) => s.section === id)
      ?? { section: id, visible: false, overdue: 0, warning: 0, unmeasured: 0, truncated: false },
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <AlarmClock size={20} className="text-rose-500" />
            کارهای متوقف
          </h1>
          <p className="text-xs text-slate-500 mt-1 leading-6">
            هر رکوردی که بیش از حد مجازِ وضعیت خودش در همان وضعیت مانده. حدها در «تنظیمات ← کارهای متوقف»
            قابل تغییرند و پیش‌فرض‌ها صرفاً نقطه شروع‌اند.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="w-4 h-4 accent-rose-500"
            />
            فقط مواردی که از حد گذشته‌اند
          </label>
          <button
            type="button"
            onClick={() => void load(overdueOnly)}
            className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-sky-400"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            به‌روزرسانی
          </button>
        </div>
      </div>

      {/* One card per section. A section the user may not see says so. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {totals.map((s) => (
          <button
            key={s.section}
            type="button"
            onClick={() => setSection(section === s.section ? 'all' : s.section)}
            className={`text-right bg-white border rounded-2xl p-4 transition ${
              section === s.section ? 'border-sky-400 ring-1 ring-sky-200' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="text-xs font-bold text-slate-700">{STUCK_SECTION_LABELS[s.section]}</div>
            {!s.visible ? (
              /*
                Withheld is not «nothing is wrong». An empty list would read as
                the second, which is the opposite of the truth.
              */
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2">
                <ShieldOff size={13} />
                دسترسی به این ماژول را ندارید
              </div>
            ) : (
              <div className="flex items-baseline gap-3 mt-2">
                <span className="text-2xl font-bold text-rose-600">{toPersianDigits(s.overdue)}</span>
                <span className="text-[11px] text-slate-500">از حد گذشته</span>
                <span className="text-sm font-bold text-amber-600">{toPersianDigits(s.warning)}</span>
                <span className="text-[11px] text-slate-500">نزدیک</span>
              </div>
            )}
            {s.visible && s.unmeasured > 0 && (
              /*
                Not overdue — unmeasured. The dwell migration backfilled nothing
                on purpose, so «this application has never seen this record move»
                is a real state, and calling it «stuck since for ever» would put
                every record written before the column at the top of the list.
              */
              <div className="text-[10px] text-slate-400 mt-1.5 leading-5">
                {toPersianDigits(s.unmeasured)} رکورد هنوز اندازه‌گیری نشده — از زمانی که این قابلیت
                اضافه شد وضعیتشان تغییر نکرده است.
              </div>
            )}
            {s.truncated && (
              <div className="text-[10px] font-bold text-amber-700 mt-1.5">
                شمارش کامل نیست؛ فقط بخشی از رکوردها بررسی شد.
              </div>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-2xl p-4">
          {error}
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <div className="text-sm font-bold text-slate-700">چیزی روی زمین نمانده</div>
          <p className="text-xs text-slate-500 mt-2 leading-6">
            هیچ رکوردی بیش از حد مجاز وضعیت خودش نمانده است.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const style = SEVERITY_STYLE[row.severity] ?? SEVERITY_STYLE.WARN;
          // Capped at 100% so a record five times over does not draw a bar five
          // times the width of the card; the number beside it says how far.
          const fill = Math.min(100, Math.round(row.ratio * 100));
          return (
            <div
              key={`${row.section}:${row.id}`}
              className="bg-white border border-slate-200 rounded-2xl p-4"
            >
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="font-bold text-sm text-slate-800">{row.label}</div>
                <div className={`text-[11px] font-bold border rounded-lg px-2 py-1 ${style.chip}`}>
                  {style.label}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 mt-2">
                <span className="font-bold text-slate-500">{STUCK_SECTION_LABELS[row.section]}</span>
                <span>وضعیت: <span className="font-bold">{row.state || 'نامشخص'}</span></span>
                <span>
                  {toPersianDigits(row.dwellDays ?? 0)} روز در این وضعیت
                  <span className="text-slate-400"> (حد مجاز {toPersianDigits(row.thresholdDays)} روز)</span>
                </span>
                {row.sinceJalali && <span className="text-slate-400">از {row.sinceJalali}</span>}
                {row.projectCode && (
                  <ProjectCodeLink
                    code={row.projectCode}
                    onOpen={onOpenProject}
                    className="font-bold text-sky-700"
                  />
                )}
                {row.projectName && <span className="text-slate-500">{row.projectName}</span>}
              </div>

              <div className="h-1.5 bg-slate-100 rounded-full mt-3 overflow-hidden">
                <div className={`h-full ${style.bar}`} style={{ width: `${fill}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {report?.truncated && rows.length > 0 && (
        <div className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          تعداد رکوردهای بررسی‌شده محدود بود؛ ممکن است موارد دیگری هم وجود داشته باشد.
        </div>
      )}
    </div>
  );
}
