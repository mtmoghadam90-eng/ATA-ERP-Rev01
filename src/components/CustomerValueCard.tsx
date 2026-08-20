import { useEffect, useState } from 'react';
import {
  Award, ChevronDown, ChevronUp, Loader2, AlertCircle, TrendingUp, Info,
  Pencil, Lock, RotateCcw, X,
} from 'lucide-react';
import { customersApi, CustomerValueDetailRow } from '../api/customers';
import { RANK_META, POTENTIAL_LABELS, POTENTIAL_KEYS } from '../utils/customerValue';
import { formatMoney } from '../numUtils';

/**
 * One customer's value, with its working shown.
 *
 * The rule is that no rank may be a black box: every component score and the
 * raw figure behind it is on this card, so "why is this customer an A?" always
 * has an answer on the screen rather than in someone's head.
 */

export const RANK_STYLE: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-sky-50 text-sky-700 border-sky-200',
  C: 'bg-amber-50 text-amber-700 border-amber-200',
  D: 'bg-slate-100 text-slate-600 border-slate-300',
  PENDING: 'bg-white text-slate-400 border-slate-200 border-dashed',
};

/** A 0..100 score as a bar, so the components can be compared at a glance. */
function ScoreBar({ label, score, weight }: { label: string; score: number; weight: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline text-[10px]">
        <span className="text-slate-600 font-semibold">
          {label}
          <span className="text-slate-400 font-normal mr-1">({weight})</span>
        </span>
        <span className="font-mono text-slate-700 font-bold" dir="ltr">
          {Math.round(score)}/100
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-sky-500 rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}

export default function CustomerValueCard({
  customerId,
  showCosts = true,
}: {
  customerId: string;
  /**
   * False for a user who may not see what the goods cost.
   *
   * The server has already blanked the profit, the margin, the coverage and the
   * profit percentile in the response, so this only decides whether the card
   * draws empty rows or leaves them out. Everything else on it — frequency,
   * recency, payment, the rank — is unaffected and still worth showing.
   */
  showCosts?: boolean;
}) {
  const [value, setValue] = useState<CustomerValueDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /* The override editor: which rank was picked, and — the actual question —
     whether it should survive the next recalculation. */
  const [editing, setEditing] = useState(false);
  const [draftRank, setDraftRank] = useState<string>('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    customersApi.value(customerId)
      .then((v) => { if (!cancelled) setValue(v); })
      .catch((err) => { if (!cancelled) setError(err?.message || 'خواندن ارزش مشتری با خطا مواجه شد.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customerId, reload]);

  /**
   * Writes the override.
   *
   * `mode` is the answer to the question the editor asks, and it is asked
   * because the two answers mean genuinely different things — see the note on
   * `setManualRank` on the server.
   */
  const applyRank = async (rank: string | null, mode: 'locked' | 'resume') => {
    setSaving(true);
    setError(null);
    try {
      await customersApi.setRank(customerId, rank, mode, draftNote || null);
      setEditing(false);
      setDraftNote('');
      setReload((n) => n + 1);
    } catch (err: any) {
      setError(err?.message || 'ثبت رتبه دستی با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="border border-slate-150 rounded-2xl p-6 flex justify-center text-slate-400">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (error || !value) {
    return (
      <div className="border border-rose-100 bg-rose-50 rounded-2xl p-3 text-[11px] text-rose-800 flex items-start gap-2">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span>{error ?? 'اطلاعاتی موجود نیست.'}</span>
      </div>
    );
  }

  const meta = RANK_META[value.rank as keyof typeof RANK_META] ?? RANK_META.PENDING;
  const isPending = value.rank === 'PENDING';
  const raw = value.raw;

  return (
    <div className="border border-slate-150 rounded-2xl overflow-hidden">
      <div className="bg-slate-50/70 border-b border-slate-150 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-white border border-slate-200 rounded-xl text-amber-500">
            <Award size={18} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">
              ارزش مشتری
              <span className="text-[10px] text-slate-400 font-medium mr-1.5">Customer Value</span>
            </h4>
            <div className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-full border font-bold text-[11px] ${RANK_STYLE[value.rank] ?? RANK_STYLE.PENDING}`}>
              {!isPending && <span className="font-mono">{value.rank}</span>}
              <span>{meta.title}</span>
            </div>
          </div>
        </div>

        <div className="text-left">
          <div className="text-[10px] text-slate-400">شاخص ارزش مشتری — CVI</div>
          <div className="text-lg font-extrabold text-slate-800 font-mono" dir="ltr">
            {value.customerValueIndex === null ? '—' : `${value.customerValueIndex}/100`}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-150">
            <div className="text-[10px] text-slate-500">ارزش ایجادشده — Realized</div>
            <div className="text-base font-bold text-slate-800 font-mono" dir="ltr">
              {value.realizedValueScore}/100
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-150">
            <div className="text-[10px] text-slate-500">ارزش بالقوه — Potential</div>
            <div className="text-base font-bold text-slate-800 font-mono" dir="ltr">
              {value.potentialValueScore === null ? '—' : `${value.potentialValueScore}/100`}
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-3 border text-[11px] leading-relaxed ${
          isPending
            ? 'bg-amber-50 border-amber-100 text-amber-800'
            : 'bg-sky-50/60 border-sky-100 text-sky-900'
        }`}>
          <span className="font-bold">اقدام پیشنهادی: {meta.action}</span>
          <p className="mt-1">{meta.description}</p>
        </div>

        {/* ---- manual override ---- */}
        {value.rankIsManual && !editing && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-[11px] text-violet-900 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold">
              {value.manualRankLocked ? <Lock size={13} /> : <RotateCcw size={13} />}
              <span>
                {value.manualRankLocked
                  ? 'رتبه به‌صورت دستی تعیین و قفل شده است'
                  : 'رتبه به‌صورت دستی تعیین شده — ارزیابی خودکار ادامه دارد'}
              </span>
            </div>
            <p className="leading-relaxed">
              {value.manualRankLocked
                ? 'بازمحاسبه‌ها این رتبه را تغییر نمی‌دهند.'
                : `در بازمحاسبه بعدی، رتبه محاسبه‌شده (${value.computedRank === 'PENDING' ? 'در انتظار ارزیابی' : value.computedRank}) دوباره جایگزین می‌شود.`}
            </p>
            {value.manualRankNote && (
              <p className="text-violet-700">دلیل: {value.manualRankNote}</p>
            )}
            <p className="text-violet-600">
              رتبه محاسبه‌شده سیستم:{' '}
              <strong>{value.computedRank === 'PENDING' ? 'در انتظار ارزیابی' : value.computedRank}</strong>
            </p>
          </div>
        )}

        {editing && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3 text-[11px]">
            <div className="font-bold text-slate-700">تعیین دستی رتبه</div>

            <div className="flex flex-wrap gap-1.5">
              {(['A', 'B', 'C', 'D'] as const).map((rank) => (
                <button
                  key={rank}
                  type="button"
                  onClick={() => setDraftRank(rank)}
                  className={`px-3 py-1.5 rounded-lg border font-bold transition ${
                    draftRank === rank
                      ? RANK_STYLE[rank]
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {rank} — {RANK_META[rank].title}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="دلیل (اختیاری)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] bg-white focus:outline-none focus:border-sky-500"
            />

            {/* The question. Two buttons rather than a checkbox, because the
                choice is the decision — not a modifier on a save. */}
            <div className="space-y-1.5 pt-1 border-t border-slate-200">
              <p className="text-slate-600 font-semibold">
                پس از این تغییر، ارزیابی خودکار چه کند؟
              </p>
              <button
                type="button"
                disabled={!draftRank || saving}
                onClick={() => applyRank(draftRank, 'resume')}
                className="w-full text-right px-3 py-2 rounded-lg border border-sky-200 bg-white hover:bg-sky-50 disabled:opacity-50 transition"
              >
                <span className="font-bold text-sky-700 flex items-center gap-1.5">
                  <RotateCcw size={12} /> ارزیابی ادامه پیدا کند
                </span>
                <span className="block text-slate-500 mt-0.5">
                  این رتبه فعلاً نمایش داده می‌شود، ولی بازمحاسبه بعدی دوباره رتبه سیستم را می‌گذارد.
                </span>
              </button>
              <button
                type="button"
                disabled={!draftRank || saving}
                onClick={() => applyRank(draftRank, 'locked')}
                className="w-full text-right px-3 py-2 rounded-lg border border-violet-200 bg-white hover:bg-violet-50 disabled:opacity-50 transition"
              >
                <span className="font-bold text-violet-700 flex items-center gap-1.5">
                  <Lock size={12} /> همیشه همین رتبه حفظ شود
                </span>
                <span className="block text-slate-500 mt-0.5">
                  هیچ بازمحاسبه‌ای این رتبه را تغییر نمی‌دهد تا خودتان آن را بردارید.
                </span>
              </button>
            </div>

            <div className="flex justify-between pt-1">
              <button
                type="button"
                onClick={() => { setEditing(false); setDraftNote(''); }}
                className="text-slate-500 hover:text-slate-700 font-bold flex items-center gap-1"
              >
                <X size={12} /> انصراف
              </button>
              {value.rankIsManual && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => applyRank(null, 'resume')}
                  className="text-rose-600 hover:text-rose-700 font-bold disabled:opacity-50"
                >
                  حذف رتبه دستی و بازگشت به ارزیابی خودکار
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>
            آخرین محاسبه:{' '}
            {value.calculatedAt
              ? new Date(value.calculatedAt).toLocaleString('fa-IR')
              : 'هنوز محاسبه نشده'}
          </span>
          <div className="flex items-center gap-3">
            {!editing && (
              <button
                type="button"
                onClick={() => { setEditing(true); setDraftRank(value.rank === 'PENDING' ? '' : value.rank); }}
                className="flex items-center gap-1 text-violet-600 hover:text-violet-700 font-bold"
              >
                <Pencil size={12} />
                تعیین دستی رتبه
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 text-sky-600 hover:text-sky-700 font-bold"
            >
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {open ? 'بستن جزئیات' : 'مشاهده جزئیات'}
            </button>
          </div>
        </div>

        {open && (
          <div className="space-y-4 pt-3 border-t border-slate-100">
            <div className="space-y-2.5">
              <h5 className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <TrendingUp size={13} className="text-emerald-600" />
                اجزای ارزش ایجادشده
              </h5>
              {showCosts && (
                <ScoreBar
                  label="سود ناخالص — Gross Profit"
                  score={value.components.grossProfitScore}
                  weight="۵۰٪"
                />
              )}
              <ScoreBar label="تکرار خرید — Frequency" score={value.components.frequencyScore} weight="۲۰٪" />
              <ScoreBar label="تازگی خرید — Recency" score={value.components.recencyScore} weight="۱۵٪" />
              <ScoreBar label="خوش‌حسابی — Payment" score={value.components.paymentScore} weight="۱۰٪" />
              <ScoreBar label="هزینه خدمت‌رسانی — Cost to Serve" score={value.components.costToServeScore} weight="۵٪" />
            </div>

            <div className="space-y-1.5">
              <h5 className="text-[11px] font-bold text-slate-700">مقادیر خام</h5>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                <Figure label="فروش کل (ریال)" value={formatMoney(raw.salesRevenueRial)} />
                {showCosts && (
                  <>
                    <Figure label="سود ناخالص (ریال)" value={formatMoney(raw.grossProfitRial)} />
                    <Figure
                      label="حاشیه سود ناخالص"
                      value={raw.grossMarginPercent === null ? '—' : `${raw.grossMarginPercent}٪`}
                    />
                  </>
                )}
                <Figure label="تعداد خرید" value={String(raw.purchaseFrequency)} />
                <Figure label="آخرین خرید" value={raw.lastPurchaseDateJalali ?? 'بدون سابقه'} />
                <Figure
                  label="روز از آخرین خرید"
                  value={raw.daysSinceLastPurchase === null ? '—' : String(raw.daysSinceLastPurchase)}
                />
              </dl>
              {showCosts && raw.costCoveragePercent < 100 && (
                // Without this the margin looks like a fact rather than a
                // partial one, and an uncosted catalogue reads as a great year.
                <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 flex items-start gap-1.5 mt-1.5">
                  <Info size={12} className="shrink-0 mt-0.5" />
                  <span>
                    بهای تمام‌شده تنها برای <strong dir="ltr">{raw.costCoveragePercent}٪</strong> از فروش این
                    مشتری مشخص است؛ سود ناخالص فقط روی همین بخش محاسبه شده. برای دقیق‌تر شدن،
                    قیمت خرید کالاها یا سفارش خرید متناظر را کامل کنید.
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <h5 className="text-[11px] font-bold text-slate-700">ارزیابی ارزش بالقوه</h5>
              {value.potentialValueScore === null ? (
                <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                  هنوز تکمیل نشده — تا تکمیل هر پنج پارامتر، رتبه‌ای تعیین نمی‌شود.
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                  {POTENTIAL_KEYS.map((key) => (
                    <Figure
                      key={key}
                      label={POTENTIAL_LABELS[key]}
                      value={`${value.potentialInputs[key] ?? '—'}/5`}
                    />
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-dashed border-slate-100 pb-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono font-bold text-slate-700" dir="ltr">{value}</dd>
    </div>
  );
}
