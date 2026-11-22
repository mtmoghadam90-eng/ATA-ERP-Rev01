import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import type { Customer, ERPSettings } from '../types';
import { customersApi, type CustomerDetail } from '../api/customers';
import { detailToCustomer } from '../api/customerAdapter';

const CustomerForm = lazy(() => import('./QuickAddModal'));

/** A picker row is partial: always fetch the full customer before editing. */
export default function CustomerEditButton({ customerId, settings, onSaved, name }: {
  customerId?: string | null; settings: ERPSettings;
  onSaved?: (row: CustomerDetail) => void; name?: string;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (!customerId || loading) return;
    setLoading(true); setError('');
    try { setCustomer(detailToCustomer(await customersApi.get(customerId))); }
    catch (err) { setError(err instanceof Error ? err.message : 'اطلاعات مشتری خوانده نشد.'); }
    finally { setLoading(false); }
  };
  if (!customerId) return null;
  return <>
    <button type="button" data-edit-customer={customerId} disabled={loading} onClick={() => void open()} title={`ویرایش مشتری${name ? `: ${name}` : ''}`} className="shrink-0 p-2 rounded-lg border border-slate-200 text-slate-600 bg-white hover:text-sky-700 hover:border-sky-300 disabled:opacity-50"><Pencil size={15} /></button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    {customer && createPortal(<div className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()} onSubmit={(e) => e.stopPropagation()}>
      <Suspense fallback={<div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center"><div className="bg-white p-5 rounded-xl">در حال دریافت فرم… <button type="button" onClick={() => setCustomer(null)}><X size={16} /></button></div></div>}>
        <CustomerForm isOpen type="customer" settings={settings} initialCustomer={customer} onClose={() => setCustomer(null)} onSuccess={() => setCustomer(null)} onCustomerSaved={onSaved} />
      </Suspense>
    </div>, document.body)}
  </>;
}
