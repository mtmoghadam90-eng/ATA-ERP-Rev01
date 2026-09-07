import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Swords, Trash2 } from 'lucide-react';
import { CompetitorRow, CompetitorStandingRow, competitorsApi } from '../api/competitors';
import { ApiError } from '../api/client';
import NumberField from './NumberField';

/**
 * «به چه کسی می‌بازیم، و با چه اختلاف قیمتی».
 *
 * The loss *reason* has been recorded per line since the follow-up shipped and
 * answers «چرا». This answers «به کی» — and the two together are the only pair
 * a salesperson can act on: «به فراسو باختیم چون ۱۲٪ گران‌تر بودیم» is a
 * decision, «قیمت» is not.
 *
 * Two figures need reading carefully and the screen says so rather than leaving
 * it to be guessed. The gap is a **median**, because one quotation where
 * somebody typed a rial price into a dollar document moves a mean by hundreds
 * of percent — and the count beside it says how many encounters could be priced
 * at all, so a confident-looking figure over three of forty reads as what it is.
 */

interface Props {
  active: boolean;
  /** Only somebody who may edit settings may change the list itself. */
  canEditCatalogue: boolean;
}

const EMPTY_FORM = { name: '', website: '', country: '', notes: '' };

export default function CompetitorsTab({ active, canEditCatalogue }: Props) {
  const [rows, setRows] = useState<CompetitorStandingRow[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  /*
   * Stable, with an empty dependency list.
   *
   * The screen above this one re-renders on every live-data event, and a
   * callback rebuilt on each of those makes the effect below fire again — the
   * fault `MessagingView` was corrected for.
   */
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [report, list] = await Promise.all([
        competitorsApi.report(),
        competitorsApi.list(true),
      ]);
      setRows(report.rows);
      setTruncated(report.truncated);
      setCompetitors(list.competitors);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن اطلاعات رقبا ممکن نشد.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Nothing is fetched until the tab is opened: a list hook would fetch on
  // mount and this sits behind two other tabs.
  useEffect(() => { if (active) void load(); }, [active, load]);

  const addCompetitor = async () => {
    if (!form.name.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await competitorsApi.create({
        name: form.name.trim(),
        website: form.website.trim() || null,
        country: form.country.trim() || null,
        notes: form.notes.trim() || null,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت رقیب ممکن نشد.');
    } finally {
      setAdding(false);
    }
  };

  const retire = async (row: CompetitorRow) => {
    if (!confirm(`«${row.name}» از فهرست انتخاب کنار گذاشته شود؟ پیش‌فاکتورهایی که نامش را دارند دست‌نخورده می‌مانند.`)) return;
    try {
      await competitorsApi.retire(row.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'کنارگذاشتن رقیب ممکن نشد.');
    }
  };

  const percent = (value: number | null) =>
    value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}٪`;

  if (!active) return null;

  return (
    <div className="space-y-4" dir="rtl">
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {/* ------------------------------ standings ----------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Swords size={15} className="text-slate-500" />
            <span className="text-xs font-extrabold text-slate-800">وضعیت رقابتی</span>
          </div>
          <button
            type="button"
            onClick={() => { void load(); }}
            disabled={busy}
            id="competitors-refresh"
            className="text-[11px] font-bold text-slate-600 hover:text-sky-600 inline-flex items-center gap-1 disabled:opacity-40"
          >
            <RefreshCw size={12} />
            {busy ? 'در حال خواندن…' : 'به‌روزرسانی'}
          </button>
        </div>

        {truncated && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 px-4 py-2 leading-relaxed">
            تعداد پیش‌فاکتورهای بررسی‌شده به سقف رسید؛ ارقام زیر روی جدیدترین اسناد محاسبه شده‌اند.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 text-right font-bold">رقیب</th>
                <th className="py-2.5 px-3 text-center font-bold">رویارویی</th>
                <th className="py-2.5 px-3 text-center font-bold">برد</th>
                <th className="py-2.5 px-3 text-center font-bold">باخت</th>
                <th className="py-2.5 px-3 text-center font-bold">در جریان</th>
                <th className="py-2.5 px-3 text-center font-bold">نرخ برد</th>
                <th className="py-2.5 px-3 text-center font-bold">اختلاف قیمت (میانه)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    هنوز روی هیچ پیش‌فاکتوری رقیبی ثبت نشده است. هنگام ثبت نتیجهٔ اقلام، رقیب و قیمت او را وارد کنید.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.competitorId} className="bg-white">
                  <td className="py-2.5 px-3 font-bold text-slate-800">{row.name}</td>
                  <td className="py-2.5 px-3 text-center font-mono">{row.encounters}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-emerald-700">{row.won}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-rose-700">{row.lost}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-500">{row.open}</td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    {row.winRatePercent === null ? '—' : `${row.winRatePercent.toFixed(0)}٪`}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {/*
                      Positive means we quoted above them. The coverage is
                      printed beside it deliberately: a median over three of
                      forty encounters is a figure about three encounters.
                    */}
                    <span className={`font-mono font-bold ${
                      row.medianGapPercent === null ? 'text-slate-400'
                        : row.medianGapPercent > 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}>
                      {percent(row.medianGapPercent)}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      از {row.pricedEncounters} مورد قیمت‌دار
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------ the list ------------------------------ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <span className="text-xs font-extrabold text-slate-800">فهرست رقبا</span>

        {canEditCatalogue && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="نام رقیب *"
              id="competitor-new-name"
              className="text-xs border border-slate-200 rounded-xl p-2.5 bg-white focus:outline-none focus:border-sky-500"
            />
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder="کشور / شهر"
              className="text-xs border border-slate-200 rounded-xl p-2.5 bg-white focus:outline-none focus:border-sky-500"
            />
            <input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="وب‌سایت"
              className="text-xs border border-slate-200 rounded-xl p-2.5 bg-white focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => { void addCompetitor(); }}
              disabled={adding || !form.name.trim()}
              id="competitor-add"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs px-4 py-2.5 transition disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Plus size={14} />
              افزودن
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {competitors.length === 0 && (
            <span className="text-[11px] text-slate-500">هنوز رقیبی ثبت نشده است.</span>
          )}
          {competitors.map((c) => (
            <span
              key={c.id}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 ${
                c.isActive
                  ? 'bg-slate-50 border-slate-200 text-slate-700'
                  : 'bg-white border-slate-200 text-slate-400 line-through'
              }`}
              title={c.isActive ? undefined : 'کنار گذاشته شده — روی اسناد قدیمی باقی است'}
            >
              {c.name}
              {canEditCatalogue && c.isActive && (
                <button
                  type="button"
                  onClick={() => { void retire(c); }}
                  className="text-slate-400 hover:text-rose-600 transition"
                  title="کنار گذاشتن از فهرست انتخاب"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </span>
          ))}
        </div>

        {!canEditCatalogue && (
          <p className="text-[10px] text-slate-500 leading-relaxed">
            افزودن یا ویرایش فهرست رقبا نیاز به دسترسی «تنظیمات» دارد. انتخاب رقیب روی یک پیش‌فاکتور نیاز ندارد.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The pair of fields that record a competitor on one quotation.
 *
 * Drawn on the outcome modal, which is the moment somebody learns it. Exported
 * separately so the modal keeps its own state and this stays a control rather
 * than a screen.
 */
export function CompetitorFields({
  competitors, competitorId, competitorAmount, currency, onChange,
}: {
  competitors: CompetitorRow[];
  competitorId: string;
  competitorAmount: number | null;
  currency: string;
  onChange: (patch: { competitorId?: string; competitorAmount?: number | null }) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-[11px] font-bold text-slate-600 mb-1">
          رقیب این معامله
        </label>
        <select
          value={competitorId}
          onChange={(e) => onChange({ competitorId: e.target.value })}
          id="outcome-competitor"
          className="w-full text-xs border border-slate-200 rounded-xl p-2.5 bg-white focus:outline-none focus:border-sky-500"
        >
          <option value="">— ثبت نشده —</option>
          {competitors.filter((c) => c.isActive || c.id === competitorId).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-bold text-slate-600 mb-1">
          قیمت رقیب ({currency})
        </label>
        {/*
          In the document's own currency, beside its own total — which is what
          makes the gap a percentage that does not move with the exchange rate.
          Blank is «not recorded»; there is no zero here that means «free».
        */}
        <NumberField
          value={competitorAmount ?? undefined}
          onChange={(v) => onChange({ competitorAmount: v ?? null })}
          id="outcome-competitor-amount"
          className="w-full text-xs border border-slate-200 rounded-xl p-2.5 bg-white focus:outline-none focus:border-sky-500"
          placeholder="خالی = ثبت نشده"
        />
      </div>
    </div>
  );
}
