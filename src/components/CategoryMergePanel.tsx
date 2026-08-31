import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, GitMerge, Loader2, RefreshCcw } from 'lucide-react';
import { ApiError } from '../api/client';
import { CategoryUsageRow, productsApi } from '../api/products';
import { categoryKey, mergeRefusalReason } from '../utils/productCategories';

/**
 * Repairing a product taxonomy that split in two.
 *
 * A product's category is a plain string copied onto the row — there is no
 * category table — so every report groups by exactly what is stored. The
 * product form is a `<select>` over this list and cannot invent a category; the
 * Excel import took the cell verbatim and could. A sheet saying «Flow» made a
 * second category beside the «فلو» somebody had picked, and the dashboard grew
 * two flow bars, one at 38% and one at 0%.
 *
 * No string rule can merge those — they are the same equipment in two languages
 * — so a person says which is which, and this writes it.
 */

interface Props {
  /** The dropdown list as Settings currently holds it. */
  known: string[];
  /**
   * Called after a merge with the entry the server removed from the list, or
   * null when it removed none — so the screen can bring its copy into step
   * without re-posting the settings document.
   */
  onMerged: (removedFromList: string | null) => void;
}

export default function CategoryMergePanel({ known, onMerged }: Props) {
  const [rows, setRows] = useState<CategoryUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await productsApi.categoryUsage());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن دسته‌بندی‌ها با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /*
   * The ones worth acting on: a category products carry that the list does not
   * have. That is exactly what an unguarded import creates, and it is the only
   * state this panel exists to clear.
   */
  const strays = useMemo(() => rows.filter((r) => !r.known && r.products > 0), [rows]);

  const refusal = from && to ? mergeRefusalReason(from, to, known) : null;

  const merge = async () => {
    if (!from || !to || refusal) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await productsApi.mergeCategory(from, to);
      setNotice(
        `${result.moved.toLocaleString('fa-IR')} محصول از «${result.from}» به «${result.to}» منتقل شد`
        + (result.listEntryRemoved ? ' و «' + result.from + '» از فهرست حذف شد.' : '.'),
      );
      setFrom('');
      setTo('');
      await load();
      onMerged(result.listEntryRemoved ? result.from : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ادغام با خطا مواجه شد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-150 shadow-sm p-6 space-y-4" dir="rtl">
      <div>
        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <GitMerge size={15} className="text-sky-600" />
          ادغام دسته‌بندی‌های تکراری
        </h4>
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
          دسته‌بندی روی خود محصول ذخیره می‌شود، پس دو املای یک چیز دو دسته‌بندی‌اند و
          نمودارها را دو تکه می‌کنند. تغییر نام در فهرست بالا محصولات موجود را جابه‌جا
          <b> نمی‌کند</b> — این کار می‌کند.
        </p>
      </div>

      {loading && (
        <div className="py-6 text-center text-slate-400">
          <Loader2 size={16} className="animate-spin inline-block" />
        </div>
      )}

      {/*
        Named rather than merely counted: the whole difficulty was that nobody
        could see «Flow» existed until a chart drew it twice.
      */}
      {!loading && strays.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
          <span className="font-bold flex items-center gap-1.5 mb-1">
            <AlertTriangle size={13} />
            {strays.length.toLocaleString('fa-IR')} دسته‌بندی روی محصولات هست که در فهرست نیست
          </span>
          {strays.map((s) => (
            <span key={s.category} className="inline-block ml-2 mt-1 bg-white border border-amber-200 rounded px-1.5 py-0.5 font-mono">
              {s.category} ({s.products.toLocaleString('fa-IR')})
            </span>
          ))}
        </div>
      )}

      {!loading && strays.length === 0 && rows.length > 0 && (
        <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
          هر دسته‌بندی‌ای که روی محصولات هست در فهرست هم تعریف شده است.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600 block">از دسته‌بندی</label>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            id="merge-category-from"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white"
          >
            <option value="">انتخاب کنید…</option>
            {rows.map((r) => (
              <option key={r.category} value={r.category}>
                {r.category} — {r.products.toLocaleString('fa-IR')} محصول{r.known ? '' : ' (خارج از فهرست)'}
              </option>
            ))}
          </select>
        </div>

        <ArrowLeft size={16} className="text-slate-400 mb-2.5 hidden sm:block" />

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600 block">به دسته‌بندی</label>
          {/*
            Only list entries. Merging into a typo would move every product onto
            a name the product form cannot offer — the fault this repairs, not a
            repair of it.
          */}
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            id="merge-category-to"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white"
          >
            <option value="">انتخاب کنید…</option>
            {known.filter((k) => categoryKey(k) !== categoryKey(from)).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void merge()}
            disabled={busy || !from || !to || !!refusal}
            id="merge-category-run"
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition whitespace-nowrap"
          >
            {busy ? 'در حال ادغام…' : 'ادغام'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            title="خواندن دوباره"
            className="p-2 text-slate-400 hover:text-slate-700 transition"
          >
            <RefreshCcw size={14} />
          </button>
        </div>
      </div>

      {refusal && (
        <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
          {refusal}
        </p>
      )}
      {error && (
        <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {notice}
        </p>
      )}
    </div>
  );
}
