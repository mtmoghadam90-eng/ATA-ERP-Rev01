import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download,
  Loader2, Moon, Plus, RotateCcw, Trash2,
} from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import { ApiError } from '../api/client';
import { HolidayRow, holidaysApi, refreshHolidayCalendar } from '../api/holidays';
import { getShamsiDaysDifference, getTodayShamsi } from '../dateUtils';
import { FIXED_SOLAR_HOLIDAYS, MAX_HIJRI_SHIFT_DAYS } from '../utils/holidays';

/**
 * The official calendar: the days nobody works.
 *
 * Every promised delivery date is counted in working days, so this is not a
 * decoration — it decides what a customer is told. It used to be a hardcoded
 * set in the source: the ten fixed solar days, plus hand-typed lunar dates for
 * 1405 and 1406 and nothing after. Beyond 1406 every lunar holiday silently
 * vanished from the arithmetic, and the two years that were there were a lunar
 * month late.
 *
 * Two ways in, and the order matters. **Editing by hand is the primary one** —
 * Iran announces holidays for snow, pollution and elections at two days'
 * notice, and no yearly source has them in advance. Importing a year is the
 * convenience on top, and it never overwrites a day somebody typed.
 *
 * And a third control, which is not a convenience: **the lunar days can be
 * moved as a set**. Iran announces the start of each hijri month by sighting
 * the moon, and every calendar a server can reach computes it instead — they
 * agree with each other and can all be a day away from what was announced.
 * Solar holidays are fixed dates and are never touched. That is why the fix is
 * one offset for the year rather than a better source: there is no reachable
 * source that knows what was announced.
 */

const YEAR_OF_TODAY = parseInt(getTodayShamsi().slice(0, 4), 10) || 1404;

export default function HolidayCalendarTab() {
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [year, setYear] = useState(YEAR_OF_TODAY);
  const [importing, setImporting] = useState(false);

  const [shifting, setShifting] = useState(false);

  const [newDate, setNewDate] = useState(getTodayShamsi());
  const [newTitle, setNewTitle] = useState('');
  const [newIsHoliday, setNewIsHoliday] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setRows(await holidaysApi.list(signal));
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof ApiError ? err.message : 'دریافت تقویم با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const shown = useMemo(
    () => rows.filter((r) => r.yearJalali === year),
    [rows, year],
  );

  const lunarDays = useMemo(
    () => shown.filter((r) => r.calendarKind === 'HIJRI' && r.source !== 'MANUAL'),
    [shown],
  );

  /*
   * The offset in force, read back from the rows rather than from the settings
   * document.
   *
   * The stored days are what every calculation uses, so they are the honest
   * answer to «where are the lunar holidays right now» — a settings value that
   * had somehow not been applied would show a number the calendar disagrees
   * with, which is the fault this screen exists to make visible.
   */
  const lunarOffset = useMemo(() => {
    const sample = lunarDays.find((r) => r.sourceDateJalali);
    if (!sample?.sourceDateJalali) return 0;
    return getShamsiDaysDifference(sample.sourceDateJalali, sample.dateJalali);
  }, [lunarDays]);

  /** Every year that has anything stored, plus the next two to import into. */
  const years = useMemo(() => {
    const set = new Set(rows.map((r) => r.yearJalali));
    for (let y = YEAR_OF_TODAY - 1; y <= YEAR_OF_TODAY + 2; y++) set.add(y);
    return [...set].sort((a, b) => a - b);
  }, [rows]);

  const after = async (message: string) => {
    setNotice(message);
    // The date helpers hold a copy for the synchronous holiday check, so it has
    // to be told; otherwise a delivery term typed a moment later is counted
    // against the calendar as it was before the edit.
    await refreshHolidayCalendar();
    await load();
  };

  const save = async () => {
    if (!newDate) return;
    setSaving(true);
    setError(null);
    try {
      await holidaysApi.save(newDate, newTitle.trim() || 'تعطیل', newIsHoliday);
      setNewTitle('');
      await after(`${newDate} ثبت شد.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت روز با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: HolidayRow) => {
    setError(null);
    try {
      await holidaysApi.remove(row.dateJalali);
      await after(`${row.dateJalali} حذف شد.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف روز با خطا مواجه شد.');
    }
  };

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      // A refusal — the source was unreachable, or answered with something
      // that is not a year — arrives as an ApiError carrying the reason, so
      // there is one failure path here and not two.
      const result = await holidaysApi.importYear(year);
      await after(
        `سال ${year}: ${result.found} روز خوانده شد — `
        + `${result.added} روز جدید، ${result.updated} به‌روزرسانی`
        + (result.keptManual ? `، ${result.keptManual} روز دستی دست‌نخورده ماند` : ''),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'دریافت تقویم با خطا مواجه شد.');
    } finally {
      setImporting(false);
    }
  };

  /**
   * Moves the year's lunar holidays.
   *
   * The offset sent is absolute, never a delta, so pressing the button twice
   * cannot drift the calendar two days: the server re-derives every date from
   * what the source originally said.
   */
  const shiftLunar = async (offset: number) => {
    setShifting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await holidaysApi.shiftHijri(year, offset);
      await after(
        `تعطیلات قمری سال ${year} روی ${result.offset > 0 ? `${result.offset}+` : result.offset}`
        + ` روز تنظیم شد (${result.moved} روز جابه‌جا شد)`
        + (result.blocked.length
          ? ` — ${result.blocked.length} روز جابه‌جا نشد چون روز مقصد دستی ثبت شده است`
          : ''),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'جابه‌جایی تقویم قمری با خطا مواجه شد.');
    } finally {
      setShifting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6" dir="rtl">
      <div>
        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <CalendarDays size={18} className="text-sky-600" />
          تقویم تعطیلات رسمی
        </h3>
        <p className="text-slate-500 text-xs mt-1 leading-relaxed">
          محاسبه «روز کاری» در تاریخ تحویل پیش‌فاکتور، اقدام بعدی پیگیری‌ها و موعد وظایف از این
          تقویم خوانده می‌شود. جمعه‌ها و تعطیلات ثابت شمسی همیشه اعمال می‌شوند؛ تعطیلات قمری هر سال
          جابه‌جا می‌شوند و باید برای هر سال دریافت یا ثبت شوند.
        </p>
      </div>

      {/* Import a year */}
      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-600 block">سال شمسی</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              id="holiday-year"
              className="border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white font-mono"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={importing}
            id="holiday-import"
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {importing ? 'در حال دریافت…' : `دریافت تعطیلات سال ${year}`}
          </button>
        </div>
        {/*
          Said plainly, because it is the rule people will test first: a day
          they corrected must survive the next import, or nobody will trust the
          button.
        */}
        <p className="text-[10px] text-slate-500 leading-relaxed">
          روزهایی که دستی ثبت یا اصلاح کرده‌اید با دریافت مجدد بازنویسی نمی‌شوند. اگر منبع پاسخ
          ندهد یا پاسخش برای یک سال کامل کم باشد، هیچ چیزی ذخیره نمی‌شود.
        </p>
      </div>

      {/* Move the lunar holidays as a set */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
            <Moon size={14} className="text-indigo-500" />
            تنظیم تعطیلات قمری سال {year}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void shiftLunar(lunarOffset - 1)}
              disabled={shifting || !lunarDays.length || lunarOffset <= -MAX_HIJRI_SHIFT_DAYS}
              id="holiday-lunar-back"
              title="یک روز عقب"
              className="w-9 h-9 flex items-center justify-center bg-white border border-indigo-200 rounded-lg text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 transition"
            >
              <ChevronRight size={16} />
            </button>
            <span
              id="holiday-lunar-offset"
              className="min-w-[5.5rem] text-center text-xs font-bold text-indigo-900 bg-white border border-indigo-200 rounded-lg py-2 font-mono"
            >
              {lunarOffset === 0 ? 'بدون تغییر' : `${lunarOffset > 0 ? '+' : ''}${lunarOffset} روز`}
            </span>
            <button
              type="button"
              onClick={() => void shiftLunar(lunarOffset + 1)}
              disabled={shifting || !lunarDays.length || lunarOffset >= MAX_HIJRI_SHIFT_DAYS}
              id="holiday-lunar-forward"
              title="یک روز جلو"
              className="w-9 h-9 flex items-center justify-center bg-white border border-indigo-200 rounded-lg text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 transition"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => void shiftLunar(0)}
              disabled={shifting || !lunarDays.length || lunarOffset === 0}
              id="holiday-lunar-reset"
              title="بازگشت به تاریخ منبع"
              className="w-9 h-9 flex items-center justify-center bg-white border border-indigo-200 rounded-lg text-slate-500 hover:bg-indigo-100 disabled:opacity-40 transition"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        {/*
          Said in full, because otherwise this reads as an arbitrary knob. It is
          not: no calendar a server can reach knows what Iran announced, so the
          person looking at a real calendar is the only available authority.
        */}
        <p className="text-[10px] text-indigo-800/80 leading-relaxed">
          مناسبت‌های مذهبی بر پایه تقویم قمری‌اند و آغاز ماه قمری در ایران با <b>رؤیت هلال</b> اعلام
          می‌شود، نه با محاسبه. هیچ منبع آنلاینی که از سرور در دسترس باشد این اعلام را ندارد، پس
          محاسبه‌ی منبع ممکن است یک روز جلوتر باشد. اگر عاشورا یا سایر مناسبت‌های مذهبی یک روز
          اختلاف دارند، با این دکمه‌ها همه‌شان با هم جابه‌جا می‌شوند.{' '}
          <b>تعطیلات شمسی (نوروز، ۲۲ بهمن و…) دست نمی‌خورند</b>، و روزهایی که خودتان دستی ثبت
          کرده‌اید هم جابه‌جا نمی‌شوند.
        </p>
        <p className="text-[10px] text-indigo-800/60 leading-relaxed">
          {lunarDays.length
            ? `${lunarDays.length.toLocaleString('fa-IR')} روز قمری در سال ${year} ثبت شده است. این تنظیم برای همین سال ذخیره می‌شود و با دریافت مجدد از بین نمی‌رود.`
            : `برای سال ${year} هنوز روز قمری‌ای دریافت نشده است؛ اول تعطیلات سال را دریافت کنید.`}
        </p>
      </div>

      {/* Add or correct a day by hand */}
      <div className="border border-slate-150 rounded-2xl p-4 space-y-3">
        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Plus size={14} className="text-emerald-600" />
          ثبت یا اصلاح یک روز
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <ShamsiDatePicker label="تاریخ" value={newDate} onChange={setNewDate} compact required />
          <div className="sm:col-span-2 space-y-1">
            <label className="text-[11px] font-bold text-slate-600 block">عنوان</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="مثلاً: تعطیلی به دلیل آلودگی هوا"
              id="holiday-title"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-sky-400"
            />
          </div>
          <div className="space-y-1">
            {/*
              Both directions, from one control. A company works some announced
              holidays, and Iran occasionally turns a weekend into a working
              day; without the second answer «this Friday we are open» could not
              be said at all.
            */}
            <label className="text-[11px] font-bold text-slate-600 block">وضعیت روز</label>
            <select
              value={newIsHoliday ? 'off' : 'on'}
              onChange={(e) => setNewIsHoliday(e.target.value === 'off')}
              id="holiday-kind"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white"
            >
              <option value="off">تعطیل</option>
              <option value="on">کاری (استثنا)</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !newDate}
            id="holiday-save"
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition"
          >
            {saving ? 'در حال ثبت…' : 'ثبت در تقویم'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-[11px] font-bold rounded-xl px-3 py-2 flex items-center gap-1.5">
          <CheckCircle2 size={13} />
          {notice}
        </div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-[11px] font-bold rounded-xl px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* The year */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700">
            روزهای ثبت‌شده سال {year}
          </span>
          <span className="text-[10px] text-slate-400">
            {shown.length.toLocaleString('fa-IR')} روز
          </span>
        </div>

        {loading && rows.length === 0 && (
          <div className="py-10 text-center text-slate-400">
            <Loader2 size={18} className="animate-spin inline-block" />
          </div>
        )}

        {!loading && shown.length === 0 && (
          <p className="text-[11px] text-slate-400 text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200 leading-relaxed">
            برای سال {year} هنوز روزی ثبت نشده است. تا زمانی که دریافت نشود، فقط جمعه‌ها و
            تعطیلات ثابت شمسی در محاسبه روز کاری اعمال می‌شوند.
          </p>
        )}

        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
          {shown.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50">
              <span className="font-mono text-xs font-bold text-slate-700 shrink-0">
                {row.dateJalali}
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                row.isHoliday
                  ? 'bg-rose-50 text-rose-700 border-rose-100'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
              }`}>
                {row.isHoliday ? 'تعطیل' : 'کاری'}
              </span>
              <span className="text-[11px] text-slate-600 flex-1 truncate">{row.title}</span>
              {row.calendarKind === 'HIJRI' && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 border bg-indigo-50 text-indigo-700 border-indigo-100 flex items-center gap-1"
                  title={row.sourceDateJalali && row.sourceDateJalali !== row.dateJalali
                    ? `تاریخ منبع: ${row.sourceDateJalali}`
                    : 'مناسبت قمری'}
                >
                  <Moon size={9} />
                  قمری
                </span>
              )}
              <span className="text-[9px] text-slate-400 shrink-0">
                {row.source === 'MANUAL' ? 'دستی' : 'دریافت‌شده'}
              </span>
              <button
                type="button"
                onClick={() => void remove(row)}
                className="text-slate-400 hover:text-rose-600 transition shrink-0"
                title="حذف از تقویم"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
        تعطیلات ثابت شمسی که همیشه و بدون ثبت اعمال می‌شوند:{' '}
        <span className="font-mono">{FIXED_SOLAR_HOLIDAYS.join('، ')}</span>. جمعه‌ها هم همیشه
        تعطیل در نظر گرفته می‌شوند مگر آنکه برای یک تاریخ مشخص «کاری (استثنا)» ثبت کنید.
      </p>
    </div>
  );
}
