import { motion } from 'framer-motion';
import { Search, X, Trophy, BadgeCheck, Tag, AlertTriangle, TrendingDown, TrendingUp, Sigma } from 'lucide-react';

import { PriceHistoryRow } from '../api/supplierInquiries';
import { ProductRow } from '../api/products';
import { useEntitySearch } from '../api/useEntitySearch';
import { useInquiryPriceHistory } from '../api/useInquiryPriceHistory';
import { SearchableSelect } from './SearchableSelect';
import { formatMoney } from '../numUtils';

/**
 * «سوابق قیمت» — every price this company has been quoted, by item.
 *
 * The question this answers is the buyer's, not the record-keeper's: not "show
 * me inquiry 4718" but "what did the last 6-inch turbine flow meter cost me, and
 * from whom". So the rows are inquiry *lines* rather than inquiries, coming from
 * their own endpoint — picking the matching lines out of a page of inquiries
 * would page the wrong set and quietly change the answer with the page size.
 *
 * Its own component rather than a third branch inside `SupplierInquiriesView`,
 * which is already 2,200 lines: nothing here shares state with the cards or the
 * comparison table.
 */

interface Props {
  /** False while another tab is showing — a list hook fetches on mount. */
  active: boolean;
}

/** The unit, when the catalogue names one. */
const unitOf = (row: PriceHistoryRow): string => row.product?.unit || 'واحد';

export default function InquiryPriceHistoryTab({ active }: Props) {
  // Named `…List` like the other paging hooks: the pager prints `historyList.total`,
  // which is a count of records and stays in Persian digits.
  const historyList = useInquiryPriceHistory(active);
  const { filters, setFilter, summary } = historyList;

  /* The catalogue, for narrowing to one item exactly rather than by wording.
     Held off until the tab is open, like the list itself. */
  const productPicker = useEntitySearch<ProductRow>({
    path: '/api/products',
    limit: 25,
    enabled: active,
    selectedId: filters.productId === 'all' ? null : filters.productId,
    getLabel: (row) => row.displayName,
  });

  /* The SKUs of the chosen product. A list row carries them, which is all this
     needs — id and SKU — so there is no second fetch. */
  const variants = productPicker.selected?.variants ?? [];

  const rows = historyList.rows;

  return (
    <motion.div
      key="price-history-view"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
      id="inquiry-price-history"
    >
      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Tag size={15} className="text-sky-500" />
              سوابق قیمت دریافتی
            </h3>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              جست‌وجو بر اساس نام کالا، کد SKU، برند، پارت‌نامبر یا نام تأمین‌کننده. قیمت‌ها پس از اعمال تخفیف کل آفر و به ازای هر واحد نمایش داده می‌شوند.
            </p>
          </div>
          {historyList.hasActiveFilters && (
            <button
              type="button"
              onClick={() => { historyList.reset(); historyList.setSearch(''); productPicker.setTerm(''); }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[11px] font-bold transition flex items-center gap-1"
            >
              <X size={12} />
              پاک کردن فیلترها
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={historyList.search}
              onChange={(e) => historyList.setSearch(e.target.value)}
              placeholder="مثلاً: فلومتر توربینی ۶ اینچ"
              className="w-full pr-9 pl-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-sky-100 focus:border-sky-300 outline-none"
              id="price-history-search"
            />
          </div>

          <SearchableSelect
            value={filters.productId === 'all' ? '' : filters.productId}
            onChange={(value) => setFilter('productId', value || 'all')}
            onSearchChange={productPicker.setTerm}
            loading={productPicker.loading}
            options={[
              // The chosen item stays selectable once the suggestions have moved
              // on to another search term — otherwise the field reads as empty
              // while the list beside it is still filtered by it.
              ...(productPicker.selected
                && !productPicker.matches.some((p) => p.id === productPicker.selected?.id)
                ? [{ value: productPicker.selected.id, label: productPicker.selected.displayName }]
                : []),
              ...productPicker.matches.map((p) => ({ value: p.id, label: p.displayName })),
            ]}
            placeholder="کالا از انبار (اختیاری)"
            wrapperClassName="w-full"
          />

          <select
            value={filters.variantId}
            onChange={(e) => setFilter('variantId', e.target.value)}
            disabled={variants.length === 0}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white disabled:bg-slate-50 disabled:text-slate-400 outline-none focus:ring-2 focus:ring-sky-100"
            id="price-history-variant"
          >
            <option value="all">همه SKUهای این کالا</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>{v.sku}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400">وضعیت آفر:</span>
          {[
            { value: 'all', label: 'همه استعلام‌ها' },
            { value: 'confirmed', label: 'آفر تأییدشده' },
            { value: 'winner', label: 'برنده استعلام' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter('outcome', option.value)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                filters.outcome === option.value
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {historyList.error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-2xl p-4 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          {historyList.error}
        </div>
      )}

      {/*
        The range, measured over every match rather than the page.

        A "cheapest ever" that changes when you turn the page is worse than
        none, so this comes from the server with the rows it was computed for
        and says when it hit its scan bound.
      */}
      {!historyList.error && summary && summary.pricedCount > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: TrendingDown, label: 'کمترین قیمت واحد', value: summary.minUnitRial, tone: 'text-emerald-600' },
            { icon: Sigma, label: 'میانگین قیمت واحد', value: summary.avgUnitRial, tone: 'text-slate-700' },
            { icon: TrendingUp, label: 'بیشترین قیمت واحد', value: summary.maxUnitRial, tone: 'text-rose-600' },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <card.icon size={13} />
                {card.label}
              </span>
              <div className={`mt-1.5 text-sm font-bold ${card.tone}`}>
                {card.value === null ? '—' : `${formatMoney(Math.round(card.value))} ریال`}
              </div>
            </div>
          ))}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <span className="text-[11px] font-bold text-slate-400">دامنه محاسبه</span>
            <div className="mt-1.5 text-sm font-bold text-slate-700">
              {summary.pricedCount.toLocaleString('fa-IR')} قیمت از {summary.supplierCount.toLocaleString('fa-IR')} تأمین‌کننده
            </div>
            {summary.truncated && (
              <div className="text-[10px] text-amber-600 font-bold mt-1">
                محاسبه روی جدیدترین رکوردها انجام شده؛ برای دقت بیشتر جست‌وجو را محدودتر کنید.
              </div>
            )}
          </div>
        </div>
      )}

      {/* The history itself */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {historyList.initialLoading ? (
          <div className="p-12 text-center text-slate-400 text-xs">در حال دریافت سوابق قیمت…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            {historyList.hasActiveFilters
              ? 'برای این جست‌وجو قیمتی ثبت نشده است.'
              : 'هنوز هیچ آفر قیمت‌داری ثبت نشده است. قیمت‌ها با ثبت مبلغ روی اقلام استعلام در همین صفحه ثبت می‌شوند.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                  <th className="p-3">تاریخ استعلام</th>
                  <th className="p-3">کالا / SKU</th>
                  <th className="p-3">تأمین‌کننده</th>
                  <th className="p-3">تعداد</th>
                  <th className="p-3">قیمت واحد</th>
                  <th className="p-3">معادل ریالی واحد</th>
                  <th className="p-3">تحویل</th>
                  <th className="p-3">پروژه</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 align-top">
                    <td className="p-3 font-mono text-slate-600 whitespace-nowrap">
                      {row.dateJalali || '—'}
                      <div className="flex items-center gap-1 mt-1">
                        {row.isWinner && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-bold">
                            <Trophy size={10} /> برنده
                          </span>
                        )}
                        {row.offerConfirmed && !row.isWinner && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] font-bold">
                            <BadgeCheck size={10} /> تأییدشده
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-slate-700 font-medium max-w-[22rem]">
                      {row.name}
                      {row.variant && (
                        <div className="font-mono text-[10px] text-sky-600 mt-0.5">{row.variant.sku}</div>
                      )}
                      {row.product && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{row.product.displayName}</div>
                      )}
                      {(row.brand || row.partNumber) && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {[row.brand, row.partNumber].filter(Boolean).join(' — ')}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">{row.supplier?.name || '—'}</td>
                    <td className="p-3 text-slate-600 whitespace-nowrap">
                      {formatMoney(row.quantity)} {unitOf(row)}
                    </td>
                    <td className="p-3 whitespace-nowrap font-bold text-slate-800">
                      {row.unitForeign > 0 ? `${formatMoney(row.unitForeign)} ${row.currency}` : '—'}
                      {/* What the offer's discount took off this line. */}
                      {row.discounted && row.grossUnitForeign > 0 && (
                        <div className="text-[10px] font-normal text-slate-400 line-through">
                          {formatMoney(row.grossUnitForeign)} {row.currency}
                        </div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap text-slate-700">
                      {row.unitRial > 0 ? `${formatMoney(Math.round(row.unitRial))} ریال` : '—'}
                      {row.discounted && row.grossUnitRial > 0 && (
                        <div className="text-[10px] text-slate-400 line-through">
                          {formatMoney(Math.round(row.grossUnitRial))} ریال
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-slate-500">{row.deliveryTime || '—'}</td>
                    <td className="p-3 text-slate-500">{row.project?.name || 'خرید عمومی'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyList.totalPages > 1 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold text-slate-500">
            {historyList.total.toLocaleString('fa-IR')} قیمت — صفحه {historyList.page.toLocaleString('fa-IR')} از {historyList.totalPages.toLocaleString('fa-IR')}
            {historyList.loading && <span className="text-sky-500 mr-2">در حال بارگذاری…</span>}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={historyList.page <= 1 || historyList.loading}
              onClick={() => historyList.setPage(historyList.page - 1)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-[11px] font-bold transition"
            >
              قبلی
            </button>
            <button
              type="button"
              disabled={historyList.page >= historyList.totalPages || historyList.loading}
              onClick={() => historyList.setPage(historyList.page + 1)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-[11px] font-bold transition"
            >
              بعدی
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
