import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Trash2, X } from 'lucide-react';
import { Customer } from '../types';
import { CustomerReferenceCounts, summarizeReferences } from '../utils/customerMigration';
import { buildCustomerOptions, getCustomerDisplayLabel } from '../utils/customerLabel';
import { SearchableSelect } from './SearchableSelect';

interface CustomerDeleteMigrationModalProps {
  isOpen: boolean;
  customer: Customer | null;
  counts: CustomerReferenceCounts;
  allCustomers: Customer[];
  /** Confirms: migrate everything to `replacementId`, then delete the customer. */
  onConfirm: (replacementId: string) => void;
  onCancel: () => void;
}

/**
 * Shown when deleting a customer that still has history. The user must pick a
 * replacement customer; all references are moved there before deletion so no
 * project, proforma, transaction or task is left orphaned.
 */
export default function CustomerDeleteMigrationModal({
  isOpen,
  customer,
  counts,
  allCustomers,
  onConfirm,
  onCancel,
}: CustomerDeleteMigrationModalProps) {
  const [replacementId, setReplacementId] = useState('');

  // Candidates exclude the customer being deleted.
  const options = useMemo(
    () => (customer ? buildCustomerOptions(allCustomers, (c) => c.id !== customer.id) : []),
    [allCustomers, customer],
  );

  const summary = useMemo(() => summarizeReferences(counts), [counts]);

  React.useEffect(() => {
    if (isOpen) setReplacementId('');
  }, [isOpen, customer?.id]);

  if (!isOpen || !customer) return null;

  const replacement = allCustomers.find((c) => c.id === replacementId);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4" dir="rtl">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="bg-amber-500 p-4 text-white flex items-center gap-3 shrink-0">
          <div className="bg-white/15 p-2 rounded-xl">
            <AlertTriangle size={22} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-sm sm:text-base">این مشتری سابقه فعال دارد</h3>
            <p className="text-white/80 text-[11px] mt-0.5">
              «{getCustomerDisplayLabel(customer, allCustomers)}» — {counts.total} سابقه مرتبط
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-white/80 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-slate-500 leading-relaxed">
            حذف این مشتری، سوابق زیر را بدون مالک رها می‌کند. برای حذف، یک مشتری جانشین انتخاب کنید
            تا تمام این اطلاعات به او منتقل شود و سپس مشتری حذف گردد.
          </p>

          {/* What will be moved */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
              سوابقی که منتقل می‌شود
            </div>
            <div className="divide-y divide-slate-100">
              {summary.map((row) => (
                <div key={row.label} className="flex items-center justify-between px-3 py-2">
                  <span className="text-[11px] text-slate-600 font-medium">{row.label}</span>
                  <span className="text-[11px] font-bold font-mono text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded">
                    {row.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Replacement picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600">
              مشتری جانشین <span className="text-rose-500">*</span>
            </label>
            <SearchableSelect
              value={replacementId}
              onChange={(val) => setReplacementId(val)}
              placeholder="جستجو و انتخاب مشتری جانشین..."
              className="text-xs"
              options={options}
            />
            <p className="text-[10px] text-slate-400">
              تمام پروژه‌ها، پیش‌فاکتورها، تراکنش‌ها و وظایف به این مشتری منتقل خواهند شد.
              استعلام‌ها، سفارشات خرید، خدمات پس از فروش و اقدامات، همراه پروژه‌ها منتقل می‌شوند.
            </p>
          </div>

          {replacement && (
            <div className="flex items-center gap-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2.5 text-[11px] font-bold text-sky-800">
              <ArrowLeftRight size={14} className="shrink-0" />
              <span className="truncate">
                {getCustomerDisplayLabel(customer, allCustomers)} → {getCustomerDisplayLabel(replacement, allCustomers)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            انصراف
          </button>
          <button
            type="button"
            disabled={!replacementId}
            onClick={() => replacementId && onConfirm(replacementId)}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <Trash2 size={13} />
            انتقال سوابق و حذف مشتری
          </button>
        </div>
      </div>
    </div>
  );
}
