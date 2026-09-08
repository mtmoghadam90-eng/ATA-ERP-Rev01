import { useState } from 'react';
import { AlarmClock, RotateCcw, Save } from 'lucide-react';
import { ERPSettings } from '../types';
import {
  DEFAULT_STUCK_THRESHOLDS, STUCK_SECTIONS, STUCK_SECTION_LABELS, STUCK_STATE_LISTS,
  StuckSection, StuckThresholdSettings, thresholdFor,
} from '../utils/stuckWork';
import { toPersianDigits } from '../numUtils';

/**
 * How long a record may sit in each state before «کارهای متوقف» reports it.
 *
 * Three vocabularies, each listed from **its own module's status list** rather
 * than typed out here — the drift the workflow trigger catalogue exists to end.
 * A state added to a module and never given a threshold falls to the built-in
 * default, and appears in this form the moment it exists.
 *
 * Zero is a real answer and the form says so: «never chase this state» is what
 * a finished status needs, and reading zero as «not configured» would make it
 * impossible to express.
 */
export default function StuckThresholdsPanel({
  settings,
  updateSettings,
}: {
  settings: ERPSettings;
  updateSettings: (next: ERPSettings) => void;
}) {
  const [draft, setDraft] = useState<StuckThresholdSettings>(
    () => JSON.parse(JSON.stringify(settings.stuckThresholds ?? {})) as StuckThresholdSettings,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const set = (section: StuckSection, state: string, days: number) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...(prev[section] ?? {}), [state]: Math.max(0, Math.trunc(days) || 0) },
    }));
    setNotice(null);
  };

  const clear = (section: StuckSection, state: string) => {
    setDraft((prev) => {
      const next = { ...(prev[section] ?? {}) };
      delete next[state];
      return { ...prev, [section]: next };
    });
    setNotice(null);
  };

  const save = () => {
    updateSettings({ ...settings, stuckThresholds: draft });
    setNotice('حدها ذخیره شد.');
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <AlarmClock size={18} className="text-rose-500" />
          حد ماندگاری در هر وضعیت
        </h3>
        <p className="text-slate-500 text-sm mt-1 leading-6">
          هر رکوردی که بیش از این تعداد روز در همان وضعیت بماند، در صفحه «کارهای متوقف» گزارش می‌شود.
          مقدارهای خالی یعنی «پیش‌فرض سیستم»، و <strong>صفر یعنی این وضعیت هرگز گزارش نشود</strong> —
          که پاسخ درست برای وضعیت‌های پایانی است.
        </p>
      </div>

      {STUCK_SECTIONS.map((section) => (
        <div key={section} className="border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 border-b border-slate-200">
            {STUCK_SECTION_LABELS[section]}
          </div>
          <div className="divide-y divide-slate-100">
            {STUCK_STATE_LISTS[section].map((state) => {
              const stored = draft[section]?.[state];
              const effective = thresholdFor(section, state, draft);
              const isDefault = typeof stored !== 'number';
              return (
                <div key={state} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-[10rem] text-xs text-slate-700">{state}</div>
                  <input
                    type="number"
                    min={0}
                    value={typeof stored === 'number' ? stored : ''}
                    placeholder={String(DEFAULT_STUCK_THRESHOLDS[section]?.[state] ?? '')}
                    onChange={(e) => set(section, state, Number(e.target.value))}
                    className="w-24 border border-slate-200 rounded-lg p-2 bg-white text-center font-mono text-xs"
                    dir="ltr"
                  />
                  <div className="text-[10px] text-slate-400 w-32">
                    {effective === 0
                      ? 'گزارش نمی‌شود'
                      : `${toPersianDigits(effective)} روز${isDefault ? ' (پیش‌فرض)' : ''}`}
                  </div>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => clear(section, state)}
                      title="بازگشت به پیش‌فرض"
                      className="text-slate-400 hover:text-sky-600"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-2 bg-sky-600 text-white text-xs font-bold rounded-xl px-4 py-2.5 hover:bg-sky-700"
        >
          <Save size={14} />
          ذخیره حدها
        </button>
        {notice && <span className="text-xs font-bold text-emerald-700">{notice}</span>}
      </div>
    </div>
  );
}
