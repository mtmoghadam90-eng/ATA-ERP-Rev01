import React from 'react';
import { AlertTriangle, ShieldAlert, UserCheck, X } from 'lucide-react';
import { Customer } from '../types';
import { DuplicateMatch, hasHardDuplicate } from '../utils/customerDuplicates';
import { getCustomerDisplayLabel } from '../utils/customerLabel';

interface DuplicateCustomerModalProps {
  isOpen: boolean;
  candidateName: string;
  matches: DuplicateMatch[];
  allCustomers: Customer[];
  /** Called when the user chooses to reuse an existing customer instead of creating a new one. */
  onUseExisting: (customer: Customer) => void;
  /** Called when the user insists on creating a new record anyway (soft duplicates only). */
  onCreateAnyway: () => void;
  onCancel: () => void;
}

/**
 * Shown when a customer about to be created looks like an existing one.
 * Hard duplicates (colliding economic code) cannot be overridden — the user must
 * pick the existing customer or cancel. Soft duplicates offer "create anyway".
 */
export default function DuplicateCustomerModal({
  isOpen,
  candidateName,
  matches,
  allCustomers,
  onUseExisting,
  onCreateAnyway,
  onCancel,
}: DuplicateCustomerModalProps) {
  if (!isOpen || matches.length === 0) return null;

  const hard = hasHardDuplicate(matches);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4" dir="rtl">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className={`p-4 flex items-center gap-3 shrink-0 ${hard ? 'bg-rose-500' : 'bg-amber-500'} text-white`}>
          <div className="bg-white/15 p-2 rounded-xl">
            {hard ? <ShieldAlert size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-sm sm:text-base">
              {hard ? 'مشتری تکراری (کد اقتصادی یکسان)' : 'احتمال مشتری تکراری'}
            </h3>
            <p className="text-white/80 text-[11px] mt-0.5">
              «{candidateName}» با {matches.length} مشتری موجود شباهت دارد.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-white/80 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500 leading-relaxed">
            {hard
              ? 'کد اقتصادی وارد شده متعلق به مشتری زیر است. کد اقتصادی باید یکتا باشد؛ لطفاً از همان مشتری استفاده کنید یا کد را اصلاح نمایید.'
              : 'برای جلوگیری از ثبت تکراری، بررسی کنید آیا منظورتان یکی از مشتریان زیر است. می‌توانید از همان مشتری استفاده کنید یا در صورت اطمینان، مشتری جدید ثبت نمایید.'}
          </p>

          <div className="space-y-2">
            {matches.map((m) => (
              <div
                key={m.customer.id}
                className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">
                    {getCustomerDisplayLabel(m.customer, allCustomers)}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        m.severity === 'hard'
                          ? 'bg-rose-50 text-rose-600 border border-rose-100'
                          : 'bg-amber-50 text-amber-700 border border-amber-100'
                      }`}
                    >
                      {m.reason}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUseExisting(m.customer)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-[11px] font-bold transition"
                >
                  <UserCheck size={13} />
                  استفاده از این مشتری
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            بازگشت و اصلاح
          </button>
          {!hard && (
            <button
              type="button"
              onClick={onCreateAnyway}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition"
            >
              با این حال، مشتری جدید ثبت شود
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
