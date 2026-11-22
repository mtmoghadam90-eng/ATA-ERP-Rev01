import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../api/client';
import { dataChanged } from '../api/liveData';

export default function IndustrySelect({ value, onChange, options, required = false }: {
  value: string; onChange: (value: string) => void; options: readonly string[]; required?: boolean;
}) {
  const [added, setAdded] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const all = [...new Set([...options, ...added, ...(value ? [value] : [])])];
  const add = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api.post<{ value: string; industries: string[] }>('/api/customers/industries', { value: draft });
      setAdded(result.industries); onChange(result.value); setOpen(false); setDraft('');
      dataChanged('settings');
    } catch (err) { setError(err instanceof Error ? err.message : 'افزودن صنعت ممکن نشد.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2" data-industry-select>
    <div className="flex gap-1.5">
      <select aria-label="صنعت / حوزه فعالیت" required={required} value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white">
        <option value="">انتخاب صنعت</option>
        {all.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <button type="button" title="افزودن صنعت جدید" onClick={() => setOpen(true)} className="p-2 text-sky-700 bg-sky-50 border border-sky-200 rounded-lg"><Plus size={15} /></button>
    </div>
    {open && <div className="flex flex-wrap gap-1.5">
      <input aria-label="نام صنعت جدید" maxLength={200} value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} className="flex-1 min-w-0 border rounded-lg px-2 py-1.5 text-xs" />
      <button type="button" onClick={() => void add()} disabled={busy || !draft.trim()} className="text-xs bg-sky-600 text-white px-3 rounded-lg disabled:opacity-50">{busy ? 'در حال ثبت…' : 'افزودن'}</button>
      <button type="button" title="انصراف از صنعت جدید" disabled={busy} onClick={() => { setOpen(false); setError(''); }}><X size={15} /></button>
    </div>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
