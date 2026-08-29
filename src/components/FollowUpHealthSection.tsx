import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CalendarDays, PhoneOff, Target, TrendingUp } from 'lucide-react';

import { FollowUpSummary, salesFollowUpApi } from '../api/salesFollowUp';

/**
 * «سلامت پیگیری فروش» on the front page.
 *
 * Six counts, read from the follow-up service's own summary endpoint rather
 * than recomputed here — the same figures the follow-up screen shows, so the
 * dashboard and the screen can never disagree about how many quotations are
 * being neglected.
 *
 * Two of them carry a target of zero and are the reason the section exists.
 * «بدون اقدام بعدی» is a quotation being actively followed up with nothing
 * planned, which is invisible on every other screen: the register shows a
 * document's commercial outcome, and «جاری» looks perfectly healthy whether
 * somebody is chasing it or nobody is.
 *
 * Nothing here touches the revenue or win-rate figures above it; this is a
 * different question about the same documents.
 */

const TILES: {
  key: keyof FollowUpSummary; label: string; tone: string; target?: boolean; icon: typeof Target;
}[] = [
  { key: 'openTotal', label: 'پیش‌فاکتور در حال پیگیری', tone: 'text-slate-700', icon: TrendingUp },
  { key: 'dueToday', label: 'پیگیری امروز', tone: 'text-sky-600', icon: CalendarDays },
  { key: 'overdue', label: 'عقب‌افتاده', tone: 'text-rose-600', target: true, icon: AlertTriangle },
  { key: 'openWithoutNextAction', label: 'بدون اقدام بعدی', tone: 'text-amber-600', target: true, icon: Target },
  { key: 'deferred', label: 'موکول‌شده', tone: 'text-indigo-600', icon: CalendarClock },
  { key: 'noResponse', label: 'بدون پاسخ', tone: 'text-slate-500', icon: PhoneOff },
];

export default function FollowUpHealthSection({ onOpen }: { onOpen: () => void }) {
  const [summary, setSummary] = useState<FollowUpSummary | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    salesFollowUpApi
      .summary(controller.signal)
      .then(setSummary)
      // A user without the proformas module simply does not see the section;
      // a failed count is not worth an error banner on the front page.
      .catch(() => setDenied(true));
    return () => controller.abort();
  }, []);

  if (denied || !summary) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="follow-up-health">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <h2 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
          <span>🎯</span> سلامت پیگیری فروش
        </h2>
        <button
          type="button"
          onClick={onOpen}
          className="text-[11px] font-bold text-sky-600 hover:underline"
        >
          مشاهده فهرست پیگیری
        </button>
      </div>
      <div className="p-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {TILES.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={onOpen}
            className="text-right rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/60 p-3 transition"
          >
            <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <tile.icon size={12} />
              {tile.label}
            </span>
            <span className={`block mt-1.5 text-lg font-bold ${tile.tone}`}>
              {summary[tile.key].toLocaleString('fa-IR')}
            </span>
            {tile.target && (
              <span className="block text-[9px] text-slate-400 mt-0.5">هدف: ۰</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
