import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, CalendarClock, CalendarDays, PhoneOff, RotateCcw, Search, Target,
} from 'lucide-react';

import { useList } from '../api/useList';
import { FollowUpRow, FollowUpSummary, salesFollowUpApi } from '../api/salesFollowUp';
import { useUserDirectory } from '../api/useUserDirectory';
import FollowUpCompletionModal from './FollowUpCompletionModal';
import ShamsiDatePicker from './ShamsiDatePicker';
import { formatMoney } from '../numUtils';
import { getTodayShamsi, addDaysToShamsi } from '../dateUtils';
import {
  FOLLOW_UP_HEALTH_LABELS, FOLLOW_UP_STATE_LABELS, FollowUpHealth,
  isTerminalOutcome,
} from '../utils/salesFollowUp';
import type { ERPSettings } from '../types';

/**
 * «پیگیری فروش» — the quotations somebody should be chasing, in the order they
 * should be chased.
 *
 * A tab inside the proformas module rather than a CRM of its own: it is the
 * same documents, read for a different question. Everything on a row is derived
 * on the server from the proforma and its open follow-up task — the age of the
 * quote, the next action, its date and owner, the last result — so nothing here
 * is a second copy of anything, and nothing is assembled by fetching two lists
 * and joining them in the browser.
 *
 * The default order is operational, not chronological: overdue, then due today,
 * then the ones with no next step at all, then what is coming, then what has
 * been parked. That third band is the one the whole screen exists for — a
 * quotation nobody has planned a next move on is the one that gets forgotten,
 * and it is invisible on every other screen in the application.
 */

interface Props {
  active: boolean;
  settings: ERPSettings;
}

const KPI_TILES: {
  key: keyof FollowUpSummary; label: string; health: FollowUpHealth | 'all';
  tone: string; icon: typeof Target;
}[] = [
  { key: 'dueToday', label: 'پیگیری امروز', health: 'DUE_TODAY', tone: 'text-sky-600', icon: CalendarDays },
  { key: 'overdue', label: 'عقب‌افتاده', health: 'OVERDUE', tone: 'text-rose-600', icon: AlertTriangle },
  { key: 'openWithoutNextAction', label: 'بدون اقدام بعدی', health: 'NO_NEXT_ACTION', tone: 'text-amber-600', icon: Target },
  { key: 'deferred', label: 'موکول‌شده', health: 'DEFERRED', tone: 'text-indigo-600', icon: CalendarClock },
  { key: 'noResponse', label: 'بدون پاسخ', health: 'NO_RESPONSE', tone: 'text-slate-500', icon: PhoneOff },
  { key: 'olderThan14Days', label: 'قدیمی‌تر از ۱۴ روز', health: 'all', tone: 'text-orange-600', icon: CalendarClock },
];

const HEALTH_BADGE: Record<FollowUpHealth, string> = {
  OVERDUE: 'bg-rose-50 text-rose-600 border-rose-100',
  DUE_TODAY: 'bg-sky-50 text-sky-600 border-sky-100',
  NO_NEXT_ACTION: 'bg-amber-50 text-amber-700 border-amber-100',
  UPCOMING: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  DEFERRED: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  NO_RESPONSE: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function SalesFollowUpTab({ active, settings }: Props) {
  const [health, setHealth] = useState<FollowUpHealth | 'all'>('all');
  const params = useMemo(() => ({ health: health === 'all' ? undefined : health }), [health]);

  // Named `…List` like every other paging hook: `queueList.total` is a record
  // count and stays in Persian digits.
  const queueList = useList<FollowUpRow>({
    path: '/api/sales-follow-up',
    pageSize: 25,
    params,
    enabled: active,
  });

  const summary = (queueList.meta.summary ?? null) as FollowUpSummary | null;
  const { users } = useUserDirectory();
  const userNames = useMemo(() => users.map((u) => u.fullName).filter(Boolean), [users]);
  const resultOptions = settings.dropdownItems?.followUpResults ?? [];

  const [completing, setCompleting] = useState<FollowUpRow | null>(null);
  const [reactivating, setReactivating] = useState<FollowUpRow | null>(null);
  const [reactivateDate, setReactivateDate] = useState(addDaysToShamsi(getTodayShamsi(), 2));
  const [error, setError] = useState<string | null>(null);

  const rows = queueList.rows;

  const submitCompletion = async (body: Parameters<typeof salesFollowUpApi.complete>[1]) => {
    if (!completing?.nextActionTaskId) return;
    await salesFollowUpApi.complete(completing.nextActionTaskId, body);
    setCompleting(null);
    queueList.refresh();
  };

  const submitReactivation = async () => {
    if (!reactivating) return;
    try {
      await salesFollowUpApi.reactivate(reactivating.id, { dueDate: reactivateDate });
      setReactivating(null);
      queueList.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فعال‌سازی مجدد پیگیری با خطا مواجه شد.');
    }
  };

  return (
    <motion.div
      key="sales-follow-up"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
      id="sales-follow-up-tab"
      dir="rtl"
    >
      {/* The health of the pipeline, over every match rather than the page. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {KPI_TILES.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => setHealth(tile.health)}
            id={`follow-up-kpi-${tile.key}`}
            className={`bg-white rounded-2xl border p-4 text-right transition ${
              health === tile.health && tile.health !== 'all'
                ? 'border-sky-300 shadow-sm'
                : 'border-slate-100 hover:border-slate-200'
            }`}
          >
            <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <tile.icon size={12} />
              {tile.label}
            </span>
            <span className={`block mt-1.5 text-lg font-bold ${tile.tone}`}>
              {(summary?.[tile.key] ?? 0).toLocaleString('fa-IR')}
            </span>
            {(tile.key === 'overdue' || tile.key === 'openWithoutNextAction') && (
              <span className="block text-[9px] text-slate-400 mt-0.5">هدف: ۰</span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={queueList.search}
            onChange={(e) => queueList.setSearch(e.target.value)}
            placeholder="شماره پیش‌فاکتور، مشتری یا پروژه…"
            className="w-full pr-9 pl-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-sky-400"
            id="follow-up-search"
          />
        </div>
        {health !== 'all' && (
          <button
            type="button"
            onClick={() => setHealth('all')}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold transition whitespace-nowrap"
          >
            نمایش همه ({FOLLOW_UP_HEALTH_LABELS[health as FollowUpHealth]} فعال است)
          </button>
        )}
      </div>

      {/* The ranking is computed over a bounded slice; say so rather than
          quietly showing part of the list as if it were all of it. */}
      {queueList.meta.truncated === true && (
        <div className="bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-bold rounded-2xl p-3 flex items-center gap-1.5">
          <AlertTriangle size={13} />
          تعداد پیش‌فاکتورهای باز از حد نمایش بیشتر است؛ برای دیدن همه، جست‌وجو را محدودتر کنید.
        </div>
      )}

      {(queueList.error || error) && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-2xl p-4 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          {queueList.error ?? error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {queueList.initialLoading ? (
          <div className="p-12 text-center text-slate-400 text-xs">در حال دریافت فهرست پیگیری…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            پیش‌فاکتور بازی برای پیگیری وجود ندارد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                  <th className="p-3">پیش‌فاکتور</th>
                  <th className="p-3">مشتری / پروژه</th>
                  <th className="p-3">مبلغ</th>
                  <th className="p-3">ارسال / عمر</th>
                  <th className="p-3">وضعیت پیگیری</th>
                  <th className="p-3">آخرین پیگیری</th>
                  <th className="p-3">اقدام بعدی</th>
                  <th className="p-3">کارشناس فروش</th>
                  <th className="p-3"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 align-top">
                    <td className="p-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                      {row.proformaNumber}
                      <span className="block text-[10px] font-normal text-slate-400 mt-0.5">{row.outcome}</span>
                    </td>
                    <td className="p-3 text-slate-700 max-w-[16rem]">
                      {row.customerName ?? '—'}
                      {row.projectName && (
                        <span className="block text-[10px] text-slate-400 mt-0.5">
                          {row.projectCode ? `${row.projectCode} — ` : ''}{row.projectName}
                        </span>
                      )}
                      {/* The project's own expected decision date; the quotation
                          carries no second field for it. */}
                      {row.expectedCloseDateJalali && (
                        <span className="block text-[10px] text-indigo-500 mt-0.5 font-mono">
                          تصمیم خرید: {row.expectedCloseDateJalali}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                      {formatMoney(row.finalAmount)} {row.currency}
                    </td>
                    <td className="p-3 font-mono text-slate-600 whitespace-nowrap">
                      {row.sentDateJalali ?? row.issueDateJalali ?? '—'}
                      {row.ageDays !== null && (
                        <span className="block text-[10px] text-slate-400 mt-0.5">
                          {row.ageDays.toLocaleString('fa-IR')} روز
                        </span>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${HEALTH_BADGE[row.followUpHealth]}`}>
                        {FOLLOW_UP_HEALTH_LABELS[row.followUpHealth]}
                      </span>
                      <span className="block text-[10px] text-slate-400 mt-1">
                        {FOLLOW_UP_STATE_LABELS[row.followUpState]}
                        {row.followUpState === 'DEFERRED' && row.deferredUntilJalali
                          ? ` تا ${row.deferredUntilJalali}` : ''}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {row.lastFollowUpResult ?? '—'}
                      {row.lastFollowUpDateJalali && (
                        <span className="block text-[10px] font-mono text-slate-400 mt-0.5">
                          {row.lastFollowUpDateJalali}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-700">
                      {row.nextAction ?? (
                        <span className="text-amber-600 font-bold">اقدام بعدی ثبت نشده</span>
                      )}
                      {row.nextActionDueDateJalali && (
                        <span className="block text-[10px] font-mono text-slate-400 mt-0.5">
                          {row.nextActionDueDateJalali}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">{row.salesExpert ?? '—'}</td>
                    <td className="p-3 whitespace-nowrap">
                      {row.nextActionTaskId ? (
                        <button
                          type="button"
                          onClick={() => setCompleting(row)}
                          className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-[11px] font-bold transition"
                        >
                          ثبت نتیجه
                        </button>
                      ) : row.followUpState === 'NO_RESPONSE' ? (
                        <button
                          type="button"
                          onClick={() => setReactivating(row)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition flex items-center gap-1"
                        >
                          <RotateCcw size={12} />
                          فعال‌سازی مجدد پیگیری
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReactivating(row)}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[11px] font-bold transition"
                        >
                          ثبت اقدام بعدی
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {queueList.totalPages > 1 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold text-slate-500">
            {queueList.total.toLocaleString('fa-IR')} مورد — صفحه {queueList.page.toLocaleString('fa-IR')} از {queueList.totalPages.toLocaleString('fa-IR')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={queueList.page <= 1 || queueList.loading}
              onClick={() => queueList.setPage(queueList.page - 1)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 rounded-lg text-[11px] font-bold transition"
            >
              قبلی
            </button>
            <button
              type="button"
              disabled={queueList.page >= queueList.totalPages || queueList.loading}
              onClick={() => queueList.setPage(queueList.page + 1)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 rounded-lg text-[11px] font-bold transition"
            >
              بعدی
            </button>
          </div>
        </div>
      )}

      {completing && (
        <FollowUpCompletionModal
          row={completing}
          resultOptions={resultOptions}
          userNames={userNames}
          outcomeIsTerminal={isTerminalOutcome(completing.outcome)}
          onClose={() => setCompleting(null)}
          onSubmit={submitCompletion}
        />
      )}

      {/*
        Reactivating, and raising a first next action, are the same operation.

        Both mean "there is nothing on this quotation and there should be", and
        both are answered by creating the follow-up task — putting the state
        back to OPEN without one would recreate «بدون اقدام بعدی» immediately.
      */}
      {reactivating && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" dir="rtl">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">
                {reactivating.followUpState === 'NO_RESPONSE' ? 'فعال‌سازی مجدد پیگیری' : 'ثبت اقدام بعدی'}
              </h3>
              <p className="text-[11px] text-slate-500 mt-1 font-mono">{reactivating.proformaNumber}</p>
            </div>
            <div className="p-5">
              <ShamsiDatePicker
                label="تاریخ اقدام بعدی"
                value={reactivateDate}
                onChange={setReactivateDate}
                required
                compact
              />
              <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                یک پیگیری فروش برای کارشناس فروش پروژه ساخته می‌شود و پیش‌فاکتور به حالت «در حال پیگیری» برمی‌گردد.
              </p>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => setReactivating(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => void submitReactivation()}
                className="px-5 py-2 text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition"
              >
                ثبت پیگیری
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
