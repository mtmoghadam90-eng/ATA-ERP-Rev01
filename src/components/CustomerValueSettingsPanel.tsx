import { useState } from 'react';
import { Save, RefreshCw, Loader2, AlertCircle, CheckCircle2, Award } from 'lucide-react';
import { ERPSettings } from '../types';
import { ApiError } from '../api/client';
import { customersApi } from '../api/customers';
import {
  DEFAULT_CUSTOMER_VALUE_SETTINGS, POTENTIAL_LABELS, RANK_META, RealizedWeights,
  PotentialWeights, normalizeCustomerValueSettings, sumPotentialWeights, sumRealizedWeights,
  validateCustomerValueSettings,
} from '../utils/customerValue';

/**
 * The knobs behind the customer value ranking.
 *
 * Two things this panel refuses to let happen. Weights that do not total 100
 * cannot be saved — the scores are weighted *averages* over an assumed divisor
 * of 100, so weights totalling 90 would quietly deflate every customer's score
 * by a tenth and the whole table would drift down a rank together with nothing
 * looking wrong. And saving does not re-rank anybody: the scores are stored so
 * the grid can sort and page on them, so the recalculation is a separate,
 * explicit act, offered right here so it is not easy to forget.
 */

const REALIZED_LABELS: Record<keyof RealizedWeights, string> = {
  grossProfit: 'سود ناخالص — Gross Profit',
  frequency: 'تکرار خرید — Frequency',
  recency: 'تازگی خرید — Recency',
  payment: 'خوش‌حسابی — Payment',
  costToServe: 'هزینه خدمت‌رسانی — Cost to Serve',
};

const PERIOD_OPTIONS = [6, 12, 18, 24];

export default function CustomerValueSettingsPanel({
  settings,
  updateSettings,
}: {
  settings: ERPSettings;
  updateSettings: (next: ERPSettings) => void;
}) {
  const [draft, setDraft] = useState(() => normalizeCustomerValueSettings(settings.customerValue));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const realizedTotal = Math.round(sumRealizedWeights(draft.realizedWeights) * 100) / 100;
  const potentialTotal = Math.round(sumPotentialWeights(draft.potentialWeights) * 100) / 100;
  const problem = validateCustomerValueSettings(draft);

  const handleSave = () => {
    const why = validateCustomerValueSettings(draft);
    if (why) {
      setError(why);
      setNotice(null);
      return;
    }
    updateSettings({ ...settings, customerValue: draft });
    setError(null);
    setNotice('تنظیمات ذخیره شد. برای اعمال روی رتبه مشتریان، «بازمحاسبه ارزش همه مشتریان» را بزنید.');
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    setNotice(null);
    setError(null);
    try {
      const r = await customersApi.recalculateValue();
      setNotice(
        `${r.customers.toLocaleString('fa-IR')} مشتری بازمحاسبه شد — ` +
        `${r.ranked.toLocaleString('fa-IR')} رتبه‌بندی شده و ` +
        `${r.pending.toLocaleString('fa-IR')} در انتظار ارزیابی پتانسیل.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'بازمحاسبه با خطا مواجه شد.');
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-900">رتبه‌بندی ارزش مشتری</h3>
        <p className="text-slate-500 text-sm mt-1">
          مشتریان روی دو محور مستقل امتیاز می‌گیرند — ارزش ایجادشده و ارزش بالقوه — و رتبه از
          ماتریس این دو تعیین می‌شود، نه از میانگین آن‌ها.
        </p>
      </div>

      {/* what each rank means */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {(['A', 'B', 'C', 'D'] as const).map((rank) => (
          <div key={rank} className="border border-slate-150 rounded-xl p-3 text-[11px]">
            <div className="font-bold text-slate-800">
              <span className="font-mono">{rank}</span> — {RANK_META[rank].title}
              <span className="text-slate-400 font-normal mr-1.5">({RANK_META[rank].action})</span>
            </div>
            <p className="text-slate-500 mt-1 leading-relaxed">{RANK_META[rank].description}</p>
          </div>
        ))}
      </div>

      {/* period + thresholds */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="block text-[11px] font-bold text-slate-600">
            بازه ارزیابی — Evaluation Period
          </label>
          <select
            value={PERIOD_OPTIONS.includes(draft.evaluationPeriodMonths) ? draft.evaluationPeriodMonths : 'custom'}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              setDraft({ ...draft, evaluationPeriodMonths: Number(e.target.value) });
            }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:border-sky-500"
          >
            {PERIOD_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} ماه</option>
            ))}
            <option value="custom">دلخواه…</option>
          </select>
          <input
            type="number" min={1}
            value={draft.evaluationPeriodMonths}
            onChange={(e) => setDraft({ ...draft, evaluationPeriodMonths: Number(e.target.value) || 1 })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
            dir="ltr"
          />
          <p className="text-[10px] text-slate-400">
            سود ناخالص و تکرار خرید در این بازه سنجیده می‌شوند. تازگی خرید مستقل از آن است.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-bold text-slate-600">
            آستانه ارزش ایجادشده بالا
          </label>
          <input
            type="number" min={0} max={100}
            value={draft.highRealizedThreshold}
            onChange={(e) => setDraft({ ...draft, highRealizedThreshold: Number(e.target.value) })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
            dir="ltr"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-bold text-slate-600">
            آستانه ارزش بالقوه بالا
          </label>
          <input
            type="number" min={0} max={100}
            value={draft.highPotentialThreshold}
            onChange={(e) => setDraft({ ...draft, highPotentialThreshold: Number(e.target.value) })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
            dir="ltr"
          />
        </div>
      </div>

      {/* realized weights */}
      <WeightBlock
        title="وزن اجزای ارزش ایجادشده"
        total={realizedTotal}
        rows={(Object.keys(REALIZED_LABELS) as (keyof RealizedWeights)[]).map((key) => ({
          key,
          label: REALIZED_LABELS[key],
          value: draft.realizedWeights[key],
          onChange: (v: number) => setDraft({
            ...draft, realizedWeights: { ...draft.realizedWeights, [key]: v },
          }),
        }))}
      />

      {/* potential weights */}
      <WeightBlock
        title="وزن اجزای ارزش بالقوه"
        total={potentialTotal}
        rows={(Object.keys(POTENTIAL_LABELS) as (keyof PotentialWeights)[]).map((key) => ({
          key,
          label: POTENTIAL_LABELS[key],
          value: draft.potentialWeights[key],
          onChange: (v: number) => setDraft({
            ...draft, potentialWeights: { ...draft.potentialWeights, [key]: v },
          }),
        }))}
      />

      {/* recency bands */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-slate-700">
          امتیاز تازگی خرید — Recency
        </h4>
        <p className="text-[10px] text-slate-400">
          هر ردیف یعنی «تا این تعداد ماه از آخرین خرید، این امتیاز». فراتر از آخرین ردیف امتیاز صفر است.
        </p>
        {draft.recencyRules.map((rule, index) => (
          <div key={index} className="flex items-center gap-2 text-[11px]">
            <span className="text-slate-500 w-8">تا</span>
            <input
              type="number" min={1} value={rule.months}
              onChange={(e) => {
                const rules = [...draft.recencyRules];
                rules[index] = { ...rules[index], months: Number(e.target.value) || 1 };
                setDraft({ ...draft, recencyRules: rules });
              }}
              className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-left focus:outline-none focus:border-sky-500"
              dir="ltr"
            />
            <span className="text-slate-500">ماه ←</span>
            <input
              type="number" min={0} max={100} value={rule.score}
              onChange={(e) => {
                const rules = [...draft.recencyRules];
                rules[index] = { ...rules[index], score: Number(e.target.value) || 0 };
                setDraft({ ...draft, recencyRules: rules });
              }}
              className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-left focus:outline-none focus:border-sky-500"
              dir="ltr"
            />
            <span className="text-slate-400">امتیاز</span>
          </div>
        ))}
      </div>

      {problem && (
        <div className="p-3 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{problem}</span>
        </div>
      )}
      {notice && (
        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-xl text-[11px] flex items-start gap-2">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}
      {error && !problem && (
        <div className="p-3 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[11px]">{error}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_CUSTOMER_VALUE_SETTINGS)}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
        >
          بازگرداندن به پیش‌فرض
        </button>
        <button
          type="button"
          onClick={handleRecalculate}
          disabled={recalculating}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
        >
          {recalculating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          بازمحاسبه ارزش همه مشتریان
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!!problem}
          className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
        >
          <Save size={14} />
          ذخیره تنظیمات
        </button>
      </div>
    </div>
  );
}

/** A weight group, with the running total called out because it must be 100. */
function WeightBlock({
  title, total, rows,
}: {
  title: string;
  total: number;
  rows: { key: string; label: string; value: number; onChange: (v: number) => void }[];
}) {
  const valid = total === 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
          <Award size={13} className="text-amber-500" />
          {title}
        </h4>
        <span className={`text-[11px] font-mono font-bold px-2 py-1 rounded-lg border ${
          valid
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'
        }`} dir="ltr">
          {total} / 100
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-[11px]">
            <label className="flex-1 text-slate-600 font-semibold">{row.label}</label>
            <input
              type="number" min={0} max={100} value={row.value}
              onChange={(e) => row.onChange(Number(e.target.value) || 0)}
              className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-left focus:outline-none focus:border-sky-500"
              dir="ltr"
            />
            <span className="text-slate-400">٪</span>
          </div>
        ))}
      </div>
    </div>
  );
}
