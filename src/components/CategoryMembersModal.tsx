import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, X, Check, Search, Loader2 } from 'lucide-react';
import { useUserDirectory } from '../api/useUserDirectory';
import type { ProjectCategoryGroup } from '../types';

/**
 * Who follows one category's conversation on one project.
 *
 * The activity feed became a messenger, and this is the thing every messenger
 * has that it did not: membership. Until now the only way to reach a colleague
 * through the feed was to name them — which raises a **referral**, an explicit
 * request with an action and an inbox of its own. That is right for «please
 * check this datasheet» and wrong for «the shipment cleared customs», which the
 * people working the job want to know without being asked to do anything.
 *
 * Members are per project **and** per category, which is the whole point: the
 * people involved in «خرید» on one job are not the ones involved in it on the
 * next. It is a different question from the category's `responsibleUserId` in
 * Settings — who owns this kind of work in the company — which this does not
 * touch.
 */

interface Props {
  isOpen: boolean;
  group: ProjectCategoryGroup | null;
  onClose: () => void;
  onSave: (memberUserIds: string[]) => Promise<void>;
}

export default function CategoryMembersModal({ isOpen, group, onClose, onSave }: Props) {
  const { users, loading } = useUserDirectory();
  const [selected, setSelected] = useState<string[]>([]);
  const [term, setTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Seeded on opening this group, and not on every render of the screen behind.
   *
   * `group` is rebuilt by the parent on each fetch, so an effect keyed on the
   * object would re-seed while somebody was ticking boxes and silently throw
   * their changes away — the trap the price calculator was fixed for.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen || !group) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === group.id) return;
    seededFor.current = group.id;
    setSelected(group.memberUserIds ?? []);
    setTerm('');
    setError(null);
  }, [isOpen, group]);

  const shown = useMemo(() => {
    const active = users.filter((u) => u.isActive !== false);
    const needle = term.trim();
    if (!needle) return active;
    return active.filter((u) => (u.fullName ?? '').includes(needle));
  }, [users, term]);

  if (!isOpen || !group) return null;

  const toggle = (id: string) => setSelected((current) => (
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  ));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ذخیره اعضا با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Users size={16} className="text-sky-600" />
              اعضای گروه «{group.categoryName}»
            </h3>
            {/*
              Said plainly, because the difference from a mention is the whole
              design and nobody would guess it from a list of checkboxes.
            */}
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              هر پیامی که در این دسته‌بندی ثبت شود، برای این افراد اعلان می‌رود — بدون آنکه لازم
              باشد کسی نامشان را ببرد. منشن‌کردن مثل قبل «ارجاع» است و کار مشخصی می‌خواهد؛ این
              فقط باخبر شدن است.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="جستجوی نام همکار"
              id="category-members-search"
              className="w-full border border-slate-200 rounded-lg pr-8 pl-3 py-2 text-xs outline-none focus:border-sky-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="py-10 text-center text-slate-400">
              <Loader2 size={18} className="animate-spin inline-block" />
            </div>
          )}
          {!loading && shown.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-8">همکاری با این نام پیدا نشد.</p>
          )}
          <ul className="space-y-1">
            {shown.map((u) => {
              const on = selected.includes(u.id);
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => toggle(u.id)}
                    id={`category-member-${u.id}`}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-right transition border ${
                      on
                        ? 'bg-sky-50 border-sky-200'
                        : 'bg-white border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      on ? 'bg-sky-500 border-sky-500 text-white' : 'border-slate-300'
                    }`}>
                      {on && <Check size={11} />}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 flex-1">{u.fullName}</span>
                    {u.position && (
                      <span className="text-[10px] text-slate-400 shrink-0">{u.position}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {error && (
          <p className="mx-5 mb-2 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            {selected.length ? `${selected.length.toLocaleString('fa-IR')} نفر انتخاب شده` : 'هیچ‌کس انتخاب نشده'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              id="category-members-save"
              className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition"
            >
              {saving ? 'در حال ذخیره…' : 'ذخیره اعضا'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
