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
        // Ranked customers only. A prospect has a potential score but no
        // realized one — the y axis would place them at the floor and the
        // matrix would read "low value" about somebody who has simply not
        // bought yet. They are counted beneath the plot instead.
        setRows(page.rows.filter((r) =>
          r.valueMetrics
          && r.valueMetrics.potentialValueScore !== null
          && r.valueMetrics.customerValueRank !== 'PROSPECT'));
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
    /*
      Compact on purpose, and smaller again after being asked for.

      It is a *reference* chart on the front page — «where do my customers
      sit» — not the screen anybody works on, and it was taking a full-width
      card and most of a screen's height for four numbers and a scatter of at
      most a few dozen points. The plot and the rank tiles now sit side by side
      rather than stacked, which halves the height, and the plot itself is
      capped near 11rem. The customers screen is where this is actually read in
      detail, and every point here opens it.
    */
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <Grid2x2 size={15} className="text-sky-600" />
        <div>
          <h3 className="text-xs font-bold text-slate-800">ماتریس ارزش مشتری</h3>
          {/* The vertical axis is deliberately unlabelled — the quadrant
              letters and each point's own tooltip say what it is, and a label
              down the side of a small chart is more furniture than reading. */}
          <p className="text-[9px] text-slate-500">
            اندازه دایره: {showCosts ? 'سود ناخالص' : 'فروش کل'}
          </p>
        </div>
      </div>

      {/*
        Prospects are named, not plotted.

        They have a potential score but no realized one, so the y axis would
        put them on the floor and the matrix would read «کم‌ارزش» about
        somebody who has simply not bought yet. Saying how many there are keeps
        them visible without misplacing them.
      */}
      {(summary?.prospects ?? 0) > 0 && (
        <p className="text-[10px] leading-relaxed text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-2.5 py-1.5">
          <strong>{(summary?.prospects ?? 0).toLocaleString('fa-IR')}</strong> مشتری بالقوه
          هنوز خرید قطعی ندارند و در این ماتریس نمایش داده نمی‌شوند؛ ارزیابی آن‌ها فقط بر پایه
          ارزش بالقوه است.
        </p>
      )}

      {loading && (
        <div className="py-8 text-center text-slate-500">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div className="relative">
            <svg viewBox="-6 -6 112 112" className="w-full max-w-[11rem] mx-auto" role="img">
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

            <div
              dir="ltr"
              className="flex justify-between text-[9px] text-slate-500 max-w-[11rem] mx-auto px-1"
            >
              <span>پتانسیل کم</span>
              <span>پتانسیل زیاد</span>
            </div>
          </div>

          {/* The four ranks, beside the plot rather than above it. */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {(['A', 'B', 'C', 'D'] as const).map((rank) => (
                <div key={rank} className="border border-slate-150 rounded-lg px-2 py-1.5">
                  <div className="text-[9px] text-slate-600 truncate">
                    <span className="font-mono font-bold">{rank}</span> — {RANK_META[rank].title}
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 leading-tight">
                    {countOf(rank).toLocaleString('fa-IR')}
                  </div>
                  {showCosts && (
                    <div className="text-[9px] text-slate-500 font-mono" dir="ltr">
                      {formatMoney(profitOf(rank))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-[9px] leading-relaxed text-slate-500 border-t border-slate-100 pt-2 space-y-0.5">
              <div>
                میانگین ایجادشده:{' '}
                <strong className="font-mono" dir="ltr">{summary?.averageRealized ?? 0}</strong>
                {' · '}
                میانگین بالقوه:{' '}
                <strong className="font-mono" dir="ltr">{summary?.averagePotential ?? 0}</strong>
              </div>
              {countOf('PENDING') > 0 && (
                <div className="text-amber-700">
                  {countOf('PENDING').toLocaleString('fa-IR')} مشتری هنوز ارزیابی پتانسیل ندارند و در نمودار نیستند.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
