import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Loader2, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import { ApiError } from '../api/client';
import { ApiTokenSummary, apiTokensApi } from '../api/apiTokens';
import { useUserDirectory } from '../api/useUserDirectory';
import { SCOPE_LABELS, TOKEN_SCOPES, TokenScope, maskToken } from '../utils/apiTokens';
import { toShamsiStr } from '../dateUtils';

/**
 * Credentials for connecting another program to this system.
 *
 * The screen is deliberately blunt about the two things people get wrong with
 * API tokens: the token is shown once and never again, and it carries a named
 * account's permissions rather than permissions of its own — so the account it
 * is issued for is the real decision, not the name typed above it.
 */

interface Props {
  /** Where the integration should point. Shown so nobody has to guess it. */
  baseUrl?: string;
}

export default function ApiTokensPanel({ baseUrl }: Props) {
  const { users } = useUserDirectory();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [scope, setScope] = useState<TokenScope>('read');
  const [expiresInDays, setExpiresInDays] = useState('');

  /** The token, for as long as this screen is open. It is never fetched again. */
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /* Loaded once: the settings screen re-renders on every keystroke elsewhere. */
  const load = useCallback(async () => {
    try {
      const result = await apiTokensApi.list();
      setTokens(result.tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن فهرست توکن‌ها ممکن نشد.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  const activeUsers = useMemo(
    () => users.filter((u) => u.isActive !== false),
    [users],
  );

  const create = async () => {
    if (!name.trim()) {
      setError('برای توکن یک نام بگذارید.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const days = Number(expiresInDays);
      const result = await apiTokensApi.create({
        name: name.trim(),
        userId: userId || undefined,
        scope,
        expiresInDays: Number.isFinite(days) && days > 0 ? days : null,
      });
      setIssued({ token: result.token, name: result.created.name });
      setCopied(false);
      setName('');
      setExpiresInDays('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صدور توکن ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiTokenSummary) => {
    if (!window.confirm(`توکن «${token.name}» باطل شود؟ هر سرویسی که با آن کار می‌کند متوقف می‌شود.`)) return;
    setBusy(true);
    try {
      await apiTokensApi.revoke(token.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ابطال توکن ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (token: ApiTokenSummary) => {
    if (!window.confirm(`توکن «${token.name}» برای همیشه حذف شود؟`)) return;
    setBusy(true);
    try {
      await apiTokensApi.remove(token.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف توکن ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      // A browser that refuses the clipboard is not an error worth a banner —
      // the token is on screen and can be selected by hand.
    }
  };

  const field = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none';
  const label = 'text-xs font-semibold text-slate-600 block mb-1.5';
  const shamsi = (iso: string | null) => (iso ? toShamsiStr(new Date(iso)) : '—');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-white rounded-2xl border border-slate-150 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-150">
          <Plug size={18} className="text-emerald-500" />
          <div>
            <h3 className="font-bold text-sm text-slate-800">دسترسی API برای سرویس‌های دیگر</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              اتصال n8n، Power Automate، اسکریپت‌های داخلی یا هر برنامه‌ی دیگری به همین سامانه
            </p>
          </div>
        </div>

        {error && (
          <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-150 rounded-xl p-3 leading-6 space-y-1">
          <p>
            آدرس پایه: <span className="font-mono text-slate-800" dir="ltr">{origin}/api</span>
          </p>
          <p>
            روی هر درخواست این هدر را بگذارید:{' '}
            <span className="font-mono text-slate-800" dir="ltr">Authorization: Bearer &lt;token&gt;</span>
          </p>
          <p className="text-slate-500">
            توکن با دسترسی همان کاربری کار می‌کند که برایش صادر شده است — نه بیشتر.
            پس مهم‌ترین انتخاب این فرم، «کاربر» است، نه نام توکن.
          </p>
        </div>

        {/* The one time the token exists outside a hash. */}
        {issued && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
            <p className="text-[11px] font-bold text-emerald-800 flex items-center gap-1.5">
              <KeyRound size={12} />
              توکن «{issued.name}» صادر شد — همین حالا کپی کنید
            </p>
            <p className="text-[10px] text-emerald-700 leading-5">
              این تنها باری است که توکن نمایش داده می‌شود. از آن فقط یک اثر انگشت ذخیره می‌شود،
              پس اگر گمش کنید باید توکن تازه‌ای صادر کنید (بازیابی ممکن نیست).
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <code
                className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-[11px] break-all font-mono"
                dir="ltr"
              >
                {issued.token}
              </code>
              <button
                type="button"
                onClick={() => void copy()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shrink-0 flex items-center justify-center gap-1.5"
              >
                <Copy size={13} />
                {copied ? 'کپی شد' : 'کپی'}
              </button>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="px-4 py-2 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700 hover:bg-white shrink-0"
              >
                بستن
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
          <div>
            <label className={label}>نام توکن</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً: n8n — گزارش روزانه"
              className={field}
            />
          </div>

          <div>
            <label className={label}>با دسترسی کدام کاربر</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={field}>
              <option value="">خودم</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>سطح دسترسی</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as TokenScope)}
              className={field}
            >
              {TOKEN_SCOPES.map((s) => (
                <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>اعتبار (روز)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="بدون انقضا"
                className={`${field} text-center font-mono`}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void create()}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-bold disabled:opacity-50 shrink-0 flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                صدور
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-150 shadow-sm p-6">
        <h4 className="font-bold text-xs text-slate-700 mb-3">
          توکن‌های صادرشده ({tokens.length.toLocaleString('fa-IR')})
        </h4>

        {tokens.length === 0 ? (
          <p className="text-[11px] text-slate-400">هنوز توکنی صادر نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-150">
                  <th className="text-right font-semibold py-2 px-2">نام</th>
                  <th className="text-right font-semibold py-2 px-2">شناسه</th>
                  <th className="text-right font-semibold py-2 px-2">کاربر</th>
                  <th className="text-right font-semibold py-2 px-2">دسترسی</th>
                  <th className="text-right font-semibold py-2 px-2">آخرین استفاده</th>
                  <th className="text-right font-semibold py-2 px-2">انقضا</th>
                  <th className="text-right font-semibold py-2 px-2">وضعیت</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 px-2 font-medium text-slate-800">{token.name}</td>
                    <td className="py-2 px-2 font-mono text-slate-500" dir="ltr">{maskToken(token.prefix)}</td>
                    <td className="py-2 px-2 text-slate-600">{token.userName ?? '—'}</td>
                    <td className="py-2 px-2 text-slate-600">{SCOPE_LABELS[token.scope]}</td>
                    <td className="py-2 px-2 text-slate-500">{shamsi(token.lastUsedAt)}</td>
                    <td className="py-2 px-2 text-slate-500">{shamsi(token.expiresAt)}</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        token.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {token.isActive ? 'فعال' : 'باطل'}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1 justify-end">
                        {token.isActive && (
                          <button
                            type="button"
                            title="ابطال"
                            disabled={busy}
                            onClick={() => void revoke(token)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 disabled:opacity-40"
                          >
                            <XCircle size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="حذف"
                          disabled={busy}
                          onClick={() => void remove(token)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
