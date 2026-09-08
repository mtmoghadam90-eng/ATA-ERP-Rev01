import { useState } from 'react';
import { AlarmClock, RotateCcw, Save } from 'lucide-react';
import { ERPSettings } from '../types';
import {
  DEFAULT_STUCK_THRESHOLDS, STUCK_SECTIONS, STUCK_SECTION_LABELS, STUCK_STATE_LISTS,
  StuckSection, StuckThresholdSettings, pruneStuckThresholds, stuckStateOwner, thresholdFor,
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
 *
 * **Seven of these rows are the same leg named twice**, and the form used to
 * offer a box on both sides of each — a project in «حمل و ترانزیت» and its
 * purchase order in «حمل و ترانزیت» are one container, so filling both in
 * reported one stall as two, at two different day counts, on one screen. That
 * is what was reported. `stuckStateOwner` says which record owns each leg, and
 * the side that does not own it is drawn **disabled with the reason** rather
 * than hidden: a row that merely reads «گزارش نمی‌شود» says «switched off» when
 * the truth is «counted next door», and somebody looking for «ترخیص گمرک»
 * under «پروژه‌ها» has to find the answer where they are looking for it. The
 * enforcement is not here — `thresholdFor` answers 0 for a leg a section does
 * not own whatever is stored — because a disabled input stops the person at
 * this screen and nobody else.
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
    /*
      Written pruned, so a document that already carries a value on a leg its
      section does not own stops carrying it. It is read as 0 either way; a
      stored key nothing consults is the same fault as a switch that does
      nothing, and this only ever removes what is already ignored.
    */
    const cleaned = pruneStuckThresholds(draft);
    setDraft(cleaned);
    updateSettings({ ...settings, stuckThresholds: cleaned });
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
        <p className="text-slate-500 text-sm mt-2 leading-6">
          <strong>هر مرحله فقط یک بار شمرده می‌شود.</strong> میانهٔ زنجیره — از حواله تا رسیدن
          کالا — روی <strong>سفارش خرید</strong> شمرده می‌شود و نه روی پروژه، چون یک محموله در
          ترانزیت یک واقعیت است و سفارش خرید همان رکوردی است که می‌شود رویش کاری کرد. دو سر
          زنجیره روی <strong>پروژه</strong> می‌مانند: پیش از آنکه سفارشی ثبت شود، و پس از آنکه
          کالا رسیده است. ردیف‌هایی که مالکشان بخش دیگری است اینجا غیرفعال‌اند و می‌گویند کجا
          شمرده می‌شوند.
        </p>
      </div>

      {STUCK_SECTIONS.map((section) => (
        <div key={section} className="border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 border-b border-slate-200">
            {STUCK_SECTION_LABELS[section]}
          </div>
          <div className="divide-y divide-slate-100">
            {STUCK_STATE_LISTS[section].map((state) => {
              /*
                The seven legs both vocabularies name. The section that does not
                own one gets no box — filling both in is what reported one
                container in transit as two stalls.
              */
              const owner = stuckStateOwner(section, state);
              const owned = owner === section;
              const stored = draft[section]?.[state];
              const effective = thresholdFor(section, state, draft);
              const isDefault = typeof stored !== 'number';
              return (
                <div
                  key={state}
                  className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${
                    owned ? '' : 'bg-slate-50/60'}`}
                >
                  <div className={`flex-1 min-w-[10rem] text-xs ${
                    owned ? 'text-slate-700' : 'text-slate-400'}`}
                  >
                    {state}
                  </div>
                  <input
                    type="number"
                    min={0}
                    disabled={!owned}
                    // A value stored on a leg this section does not own is read
                    // as 0, so showing it would be showing a figure nothing
                    // uses. The save prunes it away.
                    value={owned && typeof stored === 'number' ? stored : ''}
                    placeholder={owned
                      ? String(DEFAULT_STUCK_THRESHOLDS[section]?.[state] ?? '')
                      : '—'}
                    onChange={(e) => set(section, state, Number(e.target.value))}
                    // Addressed by data attributes rather than an id: these
                    // names carry spaces, which an HTML id may not, and a
                    // selector over one would silently match nothing.
                    data-stuck-section={section}
                    data-stuck-state={state}
                    className="w-24 border border-slate-200 rounded-lg p-2 bg-white text-center font-mono text-xs disabled:bg-slate-100 disabled:text-slate-400"
                    dir="ltr"
                  />
                  <div className="text-[10px] text-slate-400 w-32 leading-4">
                    {!owned
                      ? `روی «${STUCK_SECTION_LABELS[owner]}» شمرده می‌شود`
                      : effective === 0
                        ? 'گزارش نمی‌شود'
                        : `${toPersianDigits(effective)} روز${isDefault ? ' (پیش‌فرض)' : ''}`}
                  </div>
                  {owned && !isDefault && (
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
