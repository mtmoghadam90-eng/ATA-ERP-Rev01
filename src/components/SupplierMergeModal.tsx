import { useEffect, useState } from 'react';
import { GitMerge, Loader2, X } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { useEntitySearch } from '../api/useEntitySearch';
import { SupplierReferences, SupplierRow, suppliersApi } from '../api/suppliers';
import { ApiError } from '../api/client';

/**
 * «ادغام تأمین‌کننده تکراری».
 *
 * The record pressed is the **duplicate**: everything that names it — orders,
 * inquiries, transactions, tasks — is moved to the record chosen here, that
 * record's blank fields are filled from it, and the duplicate is deleted. The
 * choice is the kept record because the person is standing on the one they
 * want gone, which is also the one that refused to be deleted.
 */
export default function SupplierMergeModal({
  source,
  onClose,
  onMerged,
}: {
  source: { id: string; name: string };
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [refs, setRefs] = useState<SupplierReferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useEntitySearch<SupplierRow>({
    path: '/api/suppliers',
    limit: 25,
    selectedId: targetId || null,
    getLabel: (row) => row.name,
  });

  useEffect(() => {
    let live = true;
    suppliersApi.references(source.id).then((r) => { if (live) setRefs(r); }).catch(() => {});
    return () => { live = false; };
  }, [source.id]);

  const target = picker.matches.find((r) => r.id === targetId);
  const targetName = target?.name || picker.selectedLabel || '';

  const merge = async () => {
    if (!targetId) { setError('تأمین‌کننده‌ای را که باید باقی بماند انتخاب کنید.'); return; }
    setBusy(true); setError(null);
    try {
      const moved = await suppliersApi.merge(source.id, targetId);
      onMerged(
        `«${source.name}» در «${targetName}» ادغام شد: `
        + `${moved.purchaseOrders} سفارش خرید، ${moved.inquiries} استعلام، ${moved.transactions} تراکنش و ${moved.tasks} وظیفه منتقل شد.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message || 'ادغام انجام نشد.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir="rtl" data-supplier-merge>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><GitMerge size={18} /> ادغام تأمین‌کننده تکراری</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="بستن"><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          همه سوابق «<b>{source.name}</b>»
          {refs && <> ({refs.purchaseOrders} سفارش خرید، {refs.inquiries} استعلام، {refs.transactions} تراکنش)</>}
          {' '}به تأمین‌کننده‌ای که در زیر انتخاب می‌کنید منتقل می‌شود. فیلدهای خالی آن از این رکورد پر می‌شود و سپس «{source.name}» حذف می‌شود. این کار برگشت‌پذیر نیست.
        </p>
        <div>
          <span className="text-sm text-slate-600">تأمین‌کننده‌ای که باقی می‌ماند</span>
          <SearchableSelect
            wrapperClassName="mt-1"
            value={targetId}
            onChange={setTargetId}
            onSearchChange={picker.setTerm}
            loading={picker.loading}
            options={picker.matches
              .filter((r) => r.id !== source.id)
              .map((r) => ({ value: r.id, label: [r.name, r.country, r.contactName].filter(Boolean).join(' — ') }))}
            placeholder="جستجوی تأمین‌کننده..."
          />
        </div>
        {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200">انصراف</button>
          <button
            type="button"
            onClick={() => { void merge(); }}
            disabled={busy || !targetId}
            className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white font-bold disabled:opacity-50 flex items-center gap-1.5"
            data-supplier-merge-confirm
          >
            {busy && <Loader2 size={14} className="animate-spin" />} ادغام و حذف تکراری
          </button>
        </div>
      </div>
    </div>
  );
}
