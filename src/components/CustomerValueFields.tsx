import { Info, Sparkles, Wallet, Timer } from 'lucide-react';
import {
  COST_TO_SERVE_LEVELS, DEFAULT_CUSTOMER_VALUE_SETTINGS, PAYMENT_BEHAVIOURS,
  POTENTIAL_KEYS, POTENTIAL_LABELS, POTENTIAL_SCALES, PotentialInputs, PotentialWeights,
  calculatePotentialScore, isPotentialAssessed,
} from '../utils/customerValue';
import { CustomerValueSettings } from '../types';

/**
 * The manual half of customer value, inside the customer form.
 *
 * Five judgements about potential, plus how well they pay and how expensive
 * they are to serve. None of it can be derived from sales data, which is why it
 * is asked for rather than computed.
 *
 * The potential score is shown live, before saving, so the effect of an answer
 * is visible while it is being chosen — and it is computed with the same
 * function the server uses, so the preview cannot disagree with the result.
 * The server recomputes it on save regardless; this is a preview, not a value
 * the form submits.
 */

export interface CustomerValueFieldsProps {
  values: PotentialInputs & {
    paymentBehaviour?: string | null;
    costToServe?: string | null;
    paymentReviewed?: boolean;
    costToServeReviewed?: boolean;
  };
  settings?: CustomerValueSettings;
  onChange: (patch: Record<string, unknown>) => void;
}

const COST_TO_SERVE_HELP =
  'هزینه خدمت‌رسانی شامل میزان زمانی است که تیم فروش، فنی، مهندسی، مالی و خدمات برای ' +
  'مشتری صرف می‌کنند؛ از جمله اصلاحات مکرر پیشنهاد، پیگیری زیاد، تغییر سفارش، ' +
  'درخواست‌های مهندسی، مرجوعی، مشکلات خدماتی و سایر فعالیت‌های غیرمعمول.';

export default function CustomerValueFields({
  values,
  settings,
  onChange,
}: CustomerValueFieldsProps) {
  const config = settings ?? DEFAULT_CUSTOMER_VALUE_SETTINGS;
  const score = calculatePotentialScore(values, config);
  const assessed = isPotentialAssessed(values);

  const weightOf = (key: keyof PotentialWeights) => config.potentialWeights[key];

  return (
    <div className="space-y-4">
      {/* ---------------- potential ---------------- */}
      <div className="border border-slate-150 rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-50/70 border-b border-sky-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-sky-600" />
            <div>
              <h4 className="text-xs font-bold text-slate-800">
                ارزش بالقوه مشتری
                <span className="text-[10px] text-slate-400 font-medium mr-1.5">Potential Value</span>
              </h4>
              <p className="text-[10px] text-slate-500 mt-0.5">
                قضاوت شما درباره ظرفیت آینده این مشتری. تا وقتی هر پنج مورد پاسخ داده نشود رتبه‌ای تعیین نمی‌شود.
              </p>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-xl border font-bold text-xs ${
            assessed
              ? 'bg-white border-sky-200 text-sky-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {assessed
              ? <span dir="ltr" className="font-mono">{score}/100</span>
              : 'در انتظار ارزیابی'}
          </div>
        </div>

        <div className="p-4 space-y-2.5">
          {POTENTIAL_KEYS.map((key) => (
            <div key={key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <label className="md:col-span-7 text-[11px] font-semibold text-slate-600">
                {POTENTIAL_LABELS[key]}
                <span className="text-[10px] text-slate-400 font-normal mr-1.5">
                  (وزن {weightOf(key)}٪)
                </span>
              </label>
              <select
                className="md:col-span-5 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:border-sky-500"
                value={values[key] ?? ''}
                onChange={(e) => onChange({
                  [`potential${key.charAt(0).toUpperCase()}${key.slice(1)}`]:
                    e.target.value === '' ? null : Number(e.target.value),
                })}
              >
                <option value="">— انتخاب کنید —</option>
                {POTENTIAL_SCALES[key].map((label, index) => (
                  <option key={label} value={index + 1}>
                    {index + 1} — {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- payment & cost to serve ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-slate-150 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Wallet size={14} className="text-emerald-600" />
            <label className="text-[11px] font-bold text-slate-700">
              وضعیت پرداخت / خوش‌حسابی
            </label>
          </div>
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:border-sky-500"
            value={values.paymentBehaviour ?? ''}
            onChange={(e) => onChange({ paymentBehaviour: e.target.value || null })}
          >
            <option value="">— انتخاب کنید —</option>
            {PAYMENT_BEHAVIOURS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} ({option.score})
              </option>
            ))}
          </select>
          {values.paymentBehaviour && values.paymentReviewed === false && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
              مقدار پیش‌فرض — هنوز به‌صورت دستی بررسی نشده است.
            </p>
          )}
          <p className="text-[10px] text-slate-400">وزن ۱۰٪ در ارزش ایجادشده</p>
        </div>

        <div className="border border-slate-150 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Timer size={14} className="text-violet-600" />
            <label className="text-[11px] font-bold text-slate-700">
              هزینه خدمت‌رسانی به مشتری
              <span className="text-[10px] text-slate-400 font-medium mr-1">Cost to Serve</span>
            </label>
            <span className="text-slate-400 cursor-help" title={COST_TO_SERVE_HELP}>
              <Info size={13} />
            </span>
          </div>
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:border-sky-500"
            value={values.costToServe ?? ''}
            onChange={(e) => onChange({ costToServe: e.target.value || null })}
          >
            <option value="">— انتخاب کنید —</option>
            {COST_TO_SERVE_LEVELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} ({option.score})
              </option>
            ))}
          </select>
          {values.costToServe && values.costToServeReviewed === false && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
              مقدار پیش‌فرض — هنوز به‌صورت دستی بررسی نشده است.
            </p>
          )}
          {/* Worth saying out loud: this is the one score where a lower figure
              in the world means a higher number here. */}
          <p className="text-[10px] text-slate-400">
            وزن ۵٪ — هزینه کمتر، امتیاز بالاتر
          </p>
        </div>
      </div>
    </div>
  );
}
