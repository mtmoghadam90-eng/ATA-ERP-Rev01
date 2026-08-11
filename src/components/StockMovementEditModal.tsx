import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import { toShamsiStr } from '../dateUtils';
import type { InventoryMovementEdit, InventoryMovementRow } from '../api/products';

/**
 * Correcting one row of the stock ledger.
 *
 * The ledger is otherwise append-only, and this window exists only for the
 * system administrator — nobody else is offered it, and the server refuses it
 * for anyone else regardless. A wrong entry does get made, and answering it
 * with a second adjustment leaves both the mistake and the correction standing
 * in the history with neither of them true.
 *
 * Three things it deliberately does not let you change:
 *
 *  - the product or SKU, because that is two corrections and belongs in a
 *    delete plus a fresh adjustment, where both halves are visible;
 *  - the source document, because that is the link the document reconciles
 *    against when it is next saved;
 *  - the quantity to zero, because "nothing happened" is a deletion.
 *
 * The two warnings below are the ones that cost real money if unread: a row
 * belonging to a document will be recomputed by that document, and a row that
 * never moved the sellable level will not move it now.
 */

interface Props {
  movement: InventoryMovementRow;
  onClose: () => void;
  onSave: (body: InventoryMovementEdit) => Promise<void>;
}

export default function StockMovementEditModal({ movement, onClose, onSave }: Props) {
  const [type, setType] = useState<'IN' | 'OUT'>(movement.type);
  const [quantity, setQuantity] = useState(String(movement.quantity ?? ''));
  const [date, setDate] = useState(movement.occurredAtJalali || toShamsiStr(movement.occurredAt) || '');
  const [notes, setNotes] = useState(movement.notes || '');
  const [saving, setSaving] = useState(false);

  /*
   * Seeded on the row's identity, never on the object.
   *
   * The ledger tab refreshes on its own poll, which hands this component a new
   * object with the same contents. Depending on the object would re-seed the
   * form mid-edit and silently discard what was typed — the same fault that
   * emptied the price calculator.
   */
  const id = movement.id;
  const latest = useRef(movement);
  latest.current = movement;

  useEffect(() => {
    const row = latest.current;
    setType(row.type);
    setQuantity(String(row.quantity ?? ''));
    setDate(row.occurredAtJalali || toShamsiStr(row.occurredAt) || '');
    setNotes(row.notes || '');
  }, [id]);

  const productName = movement.product ? movement.product.displayName : 'کالای حذف شده';
  const fromDocument = !!movement.referenceId && movement.referenceType !== 'MANUAL';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('تعداد باید عددی بزرگ‌تر از صفر باشد. برای صفر کردن، ردیف را حذف کنید.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ type, quantity: amount, occurredAtJalali: date || null, notes: notes || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-start justify-center z-50 overflow-y-auto p-4" dir="rtl">
      <div className="bg-white shadow-xl border border-slate-100 rounded-2xl w-full max-w-lg my-8 overflow-hidden animate-scale-in flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="font-bold text-slate-800">اصلاح ردیف تاریخچه انبار</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="font-bold text-slate-800">{productName}</div>
            {movement.variant && (
              <div className="text-[11px] text-slate-500 mt-0.5">SKU: {movement.variant.sku || '—'}</div>
            )}
            <div className="text-[11px] text-slate-500 mt-1">
              کالا و SKU این ردیف قابل تغییر نیست؛ برای جابه‌جایی بین کالاها ردیف را حذف و یک اصلاح موجودی جدید ثبت کنید.
            </div>
          </div>

          {fromDocument && (
            <div className="flex gap-2 text-[11px] leading-relaxed bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                این ردیف را یک سند ثبت کرده است ({movement.referenceType}). با ذخیره‌ی دوباره‌ی آن سند، مقدار
                از روی خود سند دوباره محاسبه و این اصلاح خنثی می‌شود. اگر اشکال از خود سند است، سند را اصلاح کنید.
              </span>
            </div>
          )}

          {!movement.affectsAvailable && (
            <div className="flex gap-2 text-[11px] leading-relaxed bg-sky-50 border border-sky-200 text-sky-800 rounded-lg p-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                این ردیف فقط در تاریخچه ثبت شده و «موجودی قابل فروش» را تغییر نداده است (کالای خریداری‌شده
                برای یک پروژه‌ی برنده‌شده). اصلاح آن هم موجودی قابل فروش را جابه‌جا نمی‌کند.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('IN')}
              className={`py-2 text-sm font-bold rounded-lg border ${type === 'IN' ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              ورود به انبار
            </button>
            <button
              type="button"
              onClick={() => setType('OUT')}
              className={`py-2 text-sm font-bold rounded-lg border ${type === 'OUT' ? 'bg-rose-500 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              خروج از انبار
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500">تعداد *</label>
            <input
              type="number"
              min="0"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 outline-none text-right font-medium"
            />
          </div>

          <ShamsiDatePicker label="تاریخ" value={date} onChange={setDate} />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500">توضیحات</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 outline-none text-right font-medium resize-none"
            />
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            موجودی به اندازه‌ی <span className="font-bold">تفاوت</span> اصلاح می‌شود، نه از نو؛ و این اصلاح با نام
            شما در گزارش تغییرات ثبت خواهد شد.
          </p>

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              ثبت اصلاح
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
