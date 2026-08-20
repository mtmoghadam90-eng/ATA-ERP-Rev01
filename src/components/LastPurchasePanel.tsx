import { AlertTriangle, PackageCheck, Wand2 } from 'lucide-react';
import { formatMoney } from '../numUtils';
import {
  COST_DRIFT_THRESHOLD_PERCENT, costDrift, landedUnitCostOf, sellingPriceFor,
} from '../utils/costOfGoods';

/**
 * What an item last really cost, beside what the company quotes it at.
 *
 * These are two different numbers on purpose. The price calculator holds the
 * **standard** cost — a judgement about a typical purchase — while a purchase
 * order's per-line landed cost carries the freight and customs of one shipment.
 * Five units flown in urgently genuinely cost several times what two hundred by
 * sea do, which is why the quantity is printed beside the figure and why
 * adopting it into the standard is a button somebody presses rather than
 * something that happens on receipt.
 *
 * The gap is worth *noticing* even so: a standard nobody has revisited since the
 * supplier put its prices up is quietly costing every quotation, and that is
 * what the warning is for.
 *
 * Renders nothing when there is no purchase to report — an item bought from
 * nobody yet has no fact to state, and an empty panel would only take up room.
 */
export interface LastPurchase {
  lastPurchaseCostRial?: number | null;
  lastPurchaseQuantity?: number | null;
  lastPurchaseDate?: string | null;
  lastPurchaseOrderNumber?: string | null;
}

interface Props {
  item: LastPurchase | null | undefined;
  /** The calculator's stored inputs, for the standard cost to compare against. */
  calc?: Record<string, unknown> | null;
  /** Offered only where the form can act on it; omitted makes the panel read-only. */
  onAdopt?: (costRial: number, sellingRial: number | null) => void;
}

export default function LastPurchasePanel({ item, calc, onAdopt }: Props) {
  const actual = item?.lastPurchaseCostRial;
  if (actual === null || actual === undefined || !(actual > 0)) return null;

  const standard = landedUnitCostOf(calc ?? null);
  const drift = costDrift(standard, actual);

  const marginType = (calc?.calcMarginType ?? calc?.marginType) as 'PERCENT' | 'FIXED' | undefined;
  const suggested = sellingPriceFor(
    actual,
    marginType,
    Number(calc?.calcProfitPct ?? calc?.profitPct ?? 0),
    Number(calc?.calcProfitRIYAL ?? calc?.profitRIYAL ?? 0),
  );

  const quantity = item?.lastPurchaseQuantity;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2 text-right">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
        <PackageCheck size={14} className="text-emerald-600" />
        آخرین خرید واقعی
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span className="font-mono font-bold text-slate-800" dir="ltr">
          {formatMoney(Math.round(actual))}
        </span>
        <span>ریال به ازای هر واحد</span>
        {/* The number that says whether this figure is representative at all. */}
        {quantity != null && quantity > 0 && (
          <span className="text-slate-400">
            (خرید {formatMoney(quantity)} واحد)
          </span>
        )}
        {item?.lastPurchaseDate && (
          <span className="font-mono text-slate-400" dir="ltr">{item.lastPurchaseDate}</span>
        )}
        {item?.lastPurchaseOrderNumber && (
          <span className="text-slate-400">سفارش {item.lastPurchaseOrderNumber}</span>
        )}
      </div>

      {standard !== null && (
        <div className="text-[11px] text-slate-500">
          بهای تمام‌شده‌ی محاسبه‌گر:{' '}
          <span className="font-mono text-slate-700" dir="ltr">
            {formatMoney(Math.round(standard))}
          </span>{' '}
          ریال
        </div>
      )}

      {drift?.significant && (
        <p className={`text-[11px] font-bold rounded-lg px-2 py-1.5 flex items-start gap-1.5 ${
          drift.underpriced
            ? 'bg-rose-50 border border-rose-100 text-rose-700'
            : 'bg-amber-50 border border-amber-100 text-amber-800'
        }`}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            {drift.underpriced
              ? `آخرین خرید ${Math.abs(drift.percent)}٪ گران‌تر از بهای تمام‌شده‌ی ثبت‌شده است؛ ممکن است این کالا را ارزان‌تر از هزینه‌ی واقعی قیمت بدهید.`
              : `آخرین خرید ${Math.abs(drift.percent)}٪ ارزان‌تر از بهای تمام‌شده‌ی ثبت‌شده است.`}
            {' '}
            اختلاف بیش از {COST_DRIFT_THRESHOLD_PERCENT}٪ می‌تواند ناشی از اندازه یا نحوه‌ی حمل همان
            محموله باشد — قبل از اعمال، تعداد خرید را ببینید.
          </span>
        </p>
      )}

      {onAdopt && (
        <div className="space-y-1.5 pt-1 border-t border-slate-200">
          <button
            type="button"
            onClick={() => onAdopt(actual, suggested)}
            className="w-full px-3 py-1.5 bg-white border border-sky-200 text-sky-700 hover:bg-sky-50 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5"
          >
            <Wand2 size={13} />
            ثبت این مبلغ به‌عنوان بهای تمام‌شده
          </button>
          {suggested !== null && (
            <p className="text-[10px] text-slate-400 leading-relaxed">
              با حاشیه سود فعلی، قیمت فروش پیشنهادی{' '}
              <span className="font-mono text-slate-600" dir="ltr">{formatMoney(suggested)}</span>{' '}
              ریال می‌شود. قیمت فروش تصمیم شماست و خودکار تغییر نمی‌کند.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
