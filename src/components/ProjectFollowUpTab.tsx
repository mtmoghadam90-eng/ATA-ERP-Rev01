import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, History, Loader2, PhoneOff, Plus, RefreshCcw,
} from 'lucide-react';
import FollowUpCompletionModal from './FollowUpCompletionModal';
import ShamsiDatePicker from './ShamsiDatePicker';
import { ApiError } from '../api/client';
import {
  ProjectFollowUpQuote, ProjectFollowUpReport, salesFollowUpApi,
} from '../api/salesFollowUp';
import { useUserDirectory } from '../api/useUserDirectory';
import { formatMoney } from '../numUtils';
import { addDaysToShamsi, getTodayShamsi } from '../dateUtils';
import { isTerminalOutcome } from '../utils/salesFollowUp';
import type { ERPSettings } from '../types';

/**
 * One project's sales follow-up, on the project itself.
 *
 * The queue screen answers «what should the sales desk do next, across the
 * company», and deliberately leaves out the quotations whose sale is over.
 * Somebody who has opened a project is asking a different question — what has
 * happened on *this* job — so this shows every quotation, settled ones
 * included, with the chases recorded against each and what came of them.
 *
 * Everything on a row is derived on the server from the open follow-up task and
 * the proforma, never stored: the same rule the queue reads, so the two screens
 * cannot disagree about what is overdue.
 */

interface Props {
  projectId: string;
  settings: ERPSettings;
}

const HEALTH_TONE: Record<string, string> = {
  OVERDUE: 'bg-rose-50 text-rose-700 border-rose-200',
  DUE_TODAY: 'bg-amber-50 text-amber-700 border-amber-200',
  NO_NEXT_ACTION: 'bg-orange-50 text-orange-700 border-orange-200',
  UPCOMING: 'bg-sky-50 text-sky-700 border-sky-200',
  DEFERRED: 'bg-slate-50 text-slate-500 border-slate-200',
  NO_RESPONSE: 'bg-slate-50 text-slate-500 border-slate-200',
};

const HEALTH_LABEL: Record<string, string> = {
  OVERDUE: 'عقب‌افتاده',
  DUE_TODAY: 'امروز',
  NO_NEXT_ACTION: 'بدون اقدام بعدی',
  UPCOMING: 'در پیش',
  DEFERRED: 'موکول‌شده',
  NO_RESPONSE: 'بدون پاسخ',
};

export default function ProjectFollowUpTab({ projectId, settings }: Props) {
  const [report, setReport] = useState<ProjectFollowUpReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { users } = useUserDirectory();
  const userNames = useMemo(() => users.map((u) => u.fullName).filter(Boolean), [users]);
  const resultOptions = settings.dropdownItems?.followUpResults ?? [];

  const [completing, setCompleting] = useState<ProjectFollowUpQuote | null>(null);
  const [scheduling, setScheduling] = useState<ProjectFollowUpQuote | null>(null);
  const [dueDate, setDueDate] = useState(addDaysToShamsi(getTodayShamsi(), 2));

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setReport(await salesFollowUpApi.project(projectId, signal));
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof ApiError ? err.message : 'دریافت پیگیری‌های پروژه با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const summary = report?.summary;

  const submitSchedule = async () => {
    if (!scheduling) return;
    try {
      // The same call the queue screen makes: raising the next action *is* the
      // task, and the follow-up state follows from it.
      await salesFollowUpApi.reactivate(scheduling.id, { dueDate });
      setScheduling(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت اقدام بعدی با خطا مواجه شد.');
    }
  };

  return (
    <div className="space-y-4" dir="rtl" id="project-follow-up-tab">
      {/* The state of the chase on this job, over every quotation on it. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {([
          { key: 'quotes', label: 'پیش‌فاکتورها', tone: 'text-slate-800', icon: History },
          { key: 'chaseable', label: 'در حال پیگیری', tone: 'text-sky-600', icon: RefreshCcw },
          { key: 'withoutNextAction', label: 'بدون اقدام بعدی', tone: 'text-orange-600', icon: AlertTriangle },
          { key: 'overdue', label: 'عقب‌افتاده', tone: 'text-rose-600', icon: CalendarClock },
          { key: 'settled', label: 'تعیین‌تکلیف‌شده', tone: 'text-emerald-600', icon: CheckCircle2 },
          { key: 'followUps', label: 'دفعات پیگیری', tone: 'text-slate-800', icon: PhoneOff },
        ] as const).map((tile) => (
          <div key={tile.key} className="bg-white rounded-2xl border border-slate-100 p-4">
            <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <tile.icon size={12} />
              {tile.label}
            </span>
            <span className={`block mt-1.5 text-lg font-bold ${tile.tone}`}>
              {(summary?.[tile.key] ?? 0).toLocaleString('fa-IR')}
            </span>
          </div>
        ))}
      </div>

      {summary?.lastFollowUpDateJalali && (
        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
          آخرین پیگیری ثبت‌شده: <strong className="font-mono">{summary.lastFollowUpDateJalali}</strong>
          {summary.lastFollowUpResult ? ` — نتیجه: ${summary.lastFollowUpResult}` : ''}
        </p>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-2xl p-4 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-[11px] font-bold transition"
          >
            تلاش دوباره
          </button>
        </div>
      )}

      {loading && !report && (
        <div className="py-12 text-center text-slate-400">
          <Loader2 size={20} className="animate-spin inline-block" />
        </div>
      )}

      {report && report.quotes.length === 0 && !loading && (
        <p className="text-slate-400 text-xs text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          برای این پروژه هنوز پیش‌فاکتوری صادر نشده است.
        </p>
      )}

      <div className="space-y-3">
        {(report?.quotes ?? []).map((quote) => (
          <div
            key={quote.id}
            className="bg-white rounded-2xl border border-slate-150 p-4 space-y-3"
            id={`project-follow-up-${quote.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-sm text-slate-800">{quote.proformaNumber}</span>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  {quote.outcome}
                </span>
                {/* Only a quotation still in play carries a health: asking for
                    a next action on a finished sale is the fault the queue
                    screen was corrected for. */}
                {!quote.settled && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                    HEALTH_TONE[quote.followUpHealth] ?? 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}>
                    {HEALTH_LABEL[quote.followUpHealth] ?? quote.followUpHealth}
                  </span>
                )}
                {quote.ageDays !== null && (
                  <span className="text-[10px] text-slate-400">
                    {quote.ageDays.toLocaleString('fa-IR')} روز از ارسال
                  </span>
                )}
              </div>
              <span className="text-xs font-bold text-slate-700 font-mono" dir="ltr">
                {formatMoney(Number(quote.finalAmount))} <span className="text-[10px] text-slate-400">{quote.currency}</span>
              </span>
            </div>

            {/* What is planned, and the one button that changes it. */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              <div className="text-[11px] text-slate-600 min-w-0">
                {quote.settled ? (
                  <span className="text-slate-400">این پیش‌فاکتور تعیین تکلیف شده و اقدام بعدی لازم ندارد.</span>
                ) : quote.nextActionTaskId ? (
                  <>
                    <span className="font-bold text-slate-700">اقدام بعدی: </span>
                    {quote.nextAction}
                    {quote.nextActionDueDateJalali && (
                      <span className="font-mono text-slate-500"> — {quote.nextActionDueDateJalali}</span>
                    )}
                    {quote.nextActionAssignee && (
                      <span className="text-slate-500"> — {quote.nextActionAssignee}</span>
                    )}
                  </>
                ) : (
                  <span className="text-orange-600 font-bold">هیچ اقدام بعدی برای این پیش‌فاکتور ثبت نشده است.</span>
                )}
              </div>

              {!quote.settled && (
                <div className="flex items-center gap-2 shrink-0">
                  {quote.nextActionTaskId ? (
                    <button
                      type="button"
                      onClick={() => setCompleting(quote)}
                      id={`project-follow-up-complete-${quote.id}`}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"
                    >
                      <CheckCircle2 size={13} />
                      ثبت نتیجه پیگیری
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setScheduling(quote); setDueDate(addDaysToShamsi(getTodayShamsi(), 2)); }}
                      id={`project-follow-up-schedule-${quote.id}`}
                      className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"
                    >
                      <Plus size={13} />
                      ثبت اقدام بعدی
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* What has already been done, and what came of it. */}
            {quote.history.length > 0 ? (
              <ol className="space-y-1.5 border-r-2 border-slate-100 pr-3">
                {quote.history.map((entry) => (
                  <li key={entry.taskId} className="text-[11px] text-slate-600">
                    <span className="font-mono text-slate-400">{entry.completedAtJalali ?? '—'}</span>
                    {entry.result && (
                      <span className="mr-1.5 font-bold text-slate-700">{entry.result}</span>
                    )}
                    {entry.assignee && <span className="text-slate-400"> — {entry.assignee}</span>}
                    {entry.note && (
                      <p className="text-slate-500 leading-relaxed mt-0.5 whitespace-pre-line">{entry.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-slate-400">هنوز پیگیری‌ای برای این پیش‌فاکتور ثبت نشده است.</p>
            )}
          </div>
        ))}
      </div>

      {/* The same modal the queue screen uses, so one flow records a result. */}
      {completing?.nextActionTaskId && (
        <FollowUpCompletionModal
          row={{
            id: completing.id,
            proformaNumber: completing.proformaNumber,
            nextActionTaskId: completing.nextActionTaskId,
            nextAction: completing.nextAction,
            salesExpert: completing.nextActionAssignee,
            customerName: null,
          } as never}
          resultOptions={resultOptions}
          userNames={userNames}
          outcomeIsTerminal={isTerminalOutcome(completing.outcome)}
          onClose={() => setCompleting(null)}
          onSubmit={async (body) => {
            await salesFollowUpApi.complete(completing.nextActionTaskId!, body);
            setCompleting(null);
            await load();
          }}
        />
      )}

      {scheduling && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-4" dir="rtl">
            <h3 className="text-sm font-bold text-slate-800">ثبت اقدام بعدی</h3>
            <p className="text-[11px] text-slate-500">
              برای پیش‌فاکتور <span className="font-mono font-bold">{scheduling.proformaNumber}</span> یک
              پیگیری جدید ساخته می‌شود و مسئول آن کارشناس فروش پروژه خواهد بود.
            </p>
            <ShamsiDatePicker
              label="تاریخ اقدام بعدی"
              value={dueDate}
              onChange={setDueDate}
              required
              compact
            />
            <div className="flex justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setScheduling(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => void submitSchedule()}
                id="project-follow-up-schedule-submit"
                className="px-5 py-2 text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition"
              >
                ثبت
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
