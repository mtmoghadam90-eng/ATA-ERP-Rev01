import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, Grid2x2 } from 'lucide-react';
import { customersApi, CustomerRow, CustomerValueSummary } from '../api/customers';
import { DEFAULT_CUSTOMER_VALUE_SETTINGS, RANK_META } from '../utils/customerValue';
import { CustomerValueSettings } from '../types';
import { formatMoney } from '../numUtils';

/**
 * The customer value matrix: realized against potential, one point per customer.
 *
 * A scatter rather than a table because the question it answers is positional —
 * "who is top-right?" — and because the interesting customers are the ones far
 * from the diagonal: high potential and nothing realized yet is the whole
 * reason for measuring two axes separately.
 *
 * Drawn as plain SVG. The chart library is already in the bundle, but a fixed
 * 0..100 square with four labelled quadrants is a handful of elements, and this
 * way the quadrant boundaries are exactly the configured thresholds rather than
 * whatever a library picks for its axes.
 */

/** Bubble radius from an amount, on a square-root scale. */
function radiusOf(amount: number, maxAmount: number): number {
  if (maxAmount <= 0 || amount <= 0) return 4;
  // Area, not radius, should track the amount, or the big customers swamp the
  // picture. Floor of 4 so a small customer is still clickable.
  return 4 + 12 * Math.sqrt(Math.max(0, amount) / maxAmount);
}

const RANK_FILL: Record<string, string> = {
  A: 'fill-emerald-500/70 stroke-emerald-700',
  B: 'fill-sky-500/70 stroke-sky-700',
  C: 'fill-amber-500/70 stroke-amber-700',
  D: 'fill-slate-400/60 stroke-slate-600',
};

export default function CustomerValueMatrix({
  settings,
  onOpenCustomer,
  showCosts = true,
}: {
  settings?: CustomerValueSettings;
  onOpenCustomer?: (customerId: string) => void;
  /**
   * False for a user who may not see what the goods cost.
   *
   * The server blanks the profit in both responses this reads, so without this
   * the bubbles would all collapse to the minimum radius and each rank card
   * would read «0» — a wrong figure rather than a withheld one. Sized by
   * revenue instead, which this user may see, and the profit line comes off.
   */
  showCosts?: boolean;
}) {
  const config = settings ?? DEFAULT_CUSTOMER_VALUE_SETTINGS;
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [summary, setSummary] = useState<CustomerValueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      // Ranked customers only: an unassessed one has no potential to plot, and
      // putting it at zero would invent a position nobody chose.
      customersApi.list({ pageSize: 200, sort: 'customerValueIndex', order: 'desc' }),
      customersApi.valueSummary(),
    ])
      .then(([page, s]) => {
        if (cancelled) return;
        setRows(page.rows.filter((r) => r.valueMetrics && r.valueMetrics.potentialValueScore !== null));
        setSummary(s);
      })
      .catch((err) => { if (!cancelled) setError(err?.message || 'خواندن ماتریس ارزش مشتری با خطا مواجه شد.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /**
   * What a bubble's area stands for: profit where it can be shown, revenue
   * otherwise.
   *
   * Not a smaller version of the same picture — a high-revenue, low-margin
   * customer looks bigger on the revenue plot — but it is an honest one, and
   * every bubble is measured the same way, which is what the picture is for.
   */
  const bubbleAmount = (row: CustomerRow) => Number(
    (showCosts ? row.valueMetrics?.grossProfitRial : row.valueMetrics?.salesRevenueRial) ?? 0,
  );

  const maxBubbleAmount = useMemo(
    () => rows.reduce((max, r) => Math.max(max, bubbleAmount(r)), 0),
    // `bubbleAmount` closes over `showCosts`, which cannot change without the
    // signed-in user changing — and that reloads the screen anyway.
    [rows, showCosts],
  );

  const countOf = (rank: string) =>
    summary?.byRank.find((g) => g.rank === rank)?.count ?? 0;
  const profitOf = (rank: string) =>
    summary?.byRank.find((g) => g.rank === rank)?.grossProfitRial ?? 0;

  // The plot is a 0..100 square in user units; the SVG viewBox does the scaling.
  const SIZE = 100;
  const xOf = (potential: number) => potential;
  const yOf = (realized: number) => SIZE - realized;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Grid2x2 size={18} className="text-sky-600" />
        <div>
          <h3 className="text-sm font-bold text-slate-800">ماتریس ارزش مشتری</h3>
          <p className="text-[10px] text-slate-400 mt-0.5">
            محور افقی: ارزش بالقوه · محور عمودی: ارزش ایجادشده · اندازه دایره: سود ناخالص
          </p>
        </div>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(['A', 'B', 'C', 'D'] as const).map((rank) => (
          <div key={rank} className="border border-slate-150 rounded-xl p-3">
            <div className="text-[10px] text-slate-500">
              <span className="font-mono font-bold">{rank}</span> — {RANK_META[rank].title}
            </div>
            <div className="text-lg font-extrabold text-slate-800">
              {countOf(rank).toLocaleString('fa-IR')}
            </div>
            {showCosts && (
              <div className="text-[9px] text-slate-400 font-mono" dir="ltr">
                {formatMoney(profitOf(rank))}
              </div>
            )}
          </div>
        ))}
      </div>

      {loading && (
        <div className="py-12 text-center text-slate-400">
          <Loader2 size={20} className="animate-spin inline-block" />
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="relative">
            <svg viewBox="-6 -6 112 112" className="w-full max-w-2xl mx-auto" role="img">
              {/* quadrant shading, split at the configured thresholds */}
              <rect x={config.highPotentialThreshold} y={0}
                width={SIZE - config.highPotentialThreshold} height={SIZE - config.highRealizedThreshold}
                className="fill-emerald-50" />
              <rect x={0} y={0}
                width={config.highPotentialThreshold} height={SIZE - config.highRealizedThreshold}
                className="fill-sky-50" />
              <rect x={config.highPotentialThreshold} y={SIZE - config.highRealizedThreshold}
                width={SIZE - config.highPotentialThreshold} height={config.highRealizedThreshold}
                className="fill-amber-50" />
              <rect x={0} y={SIZE - config.highRealizedThreshold}
                width={config.highPotentialThreshold} height={config.highRealizedThreshold}
                className="fill-slate-50" />

              {/* threshold lines */}
              <line x1={config.highPotentialThreshold} y1={0} x2={config.highPotentialThreshold} y2={SIZE}
                className="stroke-slate-300" strokeWidth={0.4} strokeDasharray="2 1.5" />
              <line x1={0} y1={SIZE - config.highRealizedThreshold} x2={SIZE} y2={SIZE - config.highRealizedThreshold}
                className="stroke-slate-300" strokeWidth={0.4} strokeDasharray="2 1.5" />

              {/* frame */}
              <rect x={0} y={0} width={SIZE} height={SIZE}
                className="fill-none stroke-slate-300" strokeWidth={0.5} />

              {/* quadrant labels, in the corners so points do not sit on them */}
              <text x={SIZE - 2} y={4.5} textAnchor="end" className="fill-emerald-700" style={{ fontSize: 4, fontWeight: 700 }}>A</text>
              <text x={2} y={4.5} textAnchor="start" className="fill-sky-700" style={{ fontSize: 4, fontWeight: 700 }}>B</text>
              <text x={SIZE - 2} y={SIZE - 2} textAnchor="end" className="fill-amber-700" style={{ fontSize: 4, fontWeight: 700 }}>C</text>
              <text x={2} y={SIZE - 2} textAnchor="start" className="fill-slate-600" style={{ fontSize: 4, fontWeight: 700 }}>D</text>

              {rows.map((row) => {
                const m = row.valueMetrics!;
                const r = radiusOf(bubbleAmount(row), maxBubbleAmount) / 4;
                return (
                  <circle
                    key={row.id}
                    cx={xOf(m.potentialValueScore ?? 0)}
                    cy={yOf(m.realizedValueScore)}
                    r={r}
                    strokeWidth={0.3}
                    className={`${RANK_FILL[m.customerValueRank] ?? RANK_FILL.D} ${onOpenCustomer ? 'cursor-pointer' : ''}`}
                    onClick={() => onOpenCustomer?.(row.id)}
                  >
                    <title>
                      {`${row.companyName}\n`}
                      {`رتبه: ${m.customerValueRank} — ${RANK_META[m.customerValueRank as 'A']?.title ?? ''}\n`}
                      {`ارزش ایجادشده: ${m.realizedValueScore}/100\n`}
                      {`ارزش بالقوه: ${m.potentialValueScore}/100\n`}
                      {`CVI: ${m.customerValueIndex ?? '—'}\n`}
                      {showCosts
                        ? `سود ناخالص: ${formatMoney(Number(m.grossProfitRial))} ریال`
                        : `فروش کل: ${formatMoney(Number(m.salesRevenueRial))} ریال`}
                    </title>
                  </circle>
                );
              })}
            </svg>

            <div className="flex justify-between text-[10px] text-slate-400 max-w-2xl mx-auto px-1">
              <span>ارزش بالقوه کم</span>
              <span>ارزش بالقوه زیاد ←</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 border-t border-slate-100 pt-3">
            <span>
              میانگین ارزش ایجادشده:{' '}
              <strong className="font-mono" dir="ltr">{summary?.averageRealized ?? 0}</strong>
              {' · '}
              میانگین ارزش بالقوه:{' '}
              <strong className="font-mono" dir="ltr">{summary?.averagePotential ?? 0}</strong>
            </span>
            <span>
              {countOf('PENDING') > 0 && (
                <span className="text-amber-700">
                  {countOf('PENDING').toLocaleString('fa-IR')} مشتری هنوز ارزیابی پتانسیل ندارند و در نمودار نیستند.
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
