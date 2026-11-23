import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { tasksApi } from '../api/tasks';
import { CONTACT_RESULT_UNRECORDED, contactResultKey } from '../utils/contactResults';

export default function ContactResultEditor({ taskId, result, options, onSaved }: {
  taskId: string; result?: string | null; options: readonly string[]; onSaved?: () => void;
}) {
  const [current, setCurrent] = useState(result ?? '');
  const [draft, setDraft] = useState('');
  const [base, setBase] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCurrent(result ?? ''); }, [taskId, result]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const saved = await tasksApi.correctContactResult(taskId, draft || null, base || null);
      setCurrent(saved.contactResult ?? ''); setEditing(false); onSaved?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'اصلاح نتیجه تماس ممکن نشد.'); }
    finally { setBusy(false); }
  };
  const stale = !!draft && !options.some((option) => contactResultKey(option) === contactResultKey(draft));
  return <div className="space-y-1.5" data-contact-result-editor={taskId}>
    {!editing ? <div className="flex flex-wrap items-center gap-2">
      <span>{current || CONTACT_RESULT_UNRECORDED}</span>
      <button type="button" title="ویرایش نتیجه تماس" className="text-xs text-sky-700 inline-flex items-center gap-1" onClick={() => { setBase(current); setDraft(current); setError(''); setEditing(true); }}><Pencil size={12} />ویرایش نتیجه تماس</button>
    </div> : <fieldset disabled={busy} className="space-y-2 min-w-0">
      <select aria-label="اصلاح نتیجه تماس" value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
        <option value="">{CONTACT_RESULT_UNRECORDED}</option>
        {stale && <option value={draft} disabled>{draft} (در فهرست نیست)</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => void save()} className="rounded-lg bg-sky-600 text-white px-3 py-1.5">{busy ? 'در حال ذخیره…' : 'ذخیره نتیجه تماس'}</button>
        <button type="button" onClick={() => { setEditing(false); setError(''); }} className="text-slate-500">انصراف</button>
      </div>
    </fieldset>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
