import { useCallback, useEffect, useState } from 'react';
import { Bot, KeyRound, Loader2, Plug } from 'lucide-react';
import type { ERPSettings } from '../types';
import { ApiError } from '../api/client';
import { assistantApi } from '../api/assistant';
import { PROPOSAL_TTL_MINUTES } from '../utils/assistantActions';
import NumberField from './NumberField';

/**
 * The assistant's settings.
 *
 * Split in two on purpose. Everything except the key lives in the settings
 * document and is saved with the rest of the settings; the key goes to its own
 * endpoint and comes back only as a masked hint, because the settings document
 * is loaded whole by every signed-in browser and a key in it would be handed to
 * all of them.
 */

interface Props {
  settings: ERPSettings;
  updateSettings: (next: ERPSettings) => void;
}

type Assistant = NonNullable<ERPSettings['assistant']>;

export default function AssistantSettingsPanel({ settings, updateSettings }: Props) {
  const assistant: Assistant = settings.assistant ?? {};

  const [keyDraft, setKeyDraft] = useState('');
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
  const [actions, setActions] = useState<{ name: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Loaded once: this screen re-renders on every settings change. */
  const load = useCallback(async () => {
    try {
      const result = await assistantApi.config();
      setKeyHint(result.apiKeyHint);
      setTools(result.tools);
      setActions(result.actions ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن تنظیمات دستیار ممکن نشد.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (change: Partial<Assistant>) => {
    updateSettings({ ...settings, assistant: { ...assistant, ...change } });
  };

  const saveKey = async () => {
    const value = keyDraft.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assistantApi.saveKey(value);
      setKeyHint(result.apiKeyHint);
      setKeyDraft('');
      setNotice('کلید ذخیره شد.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره کلید ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await assistantApi.test();
      if (result.ok) setNotice(`اتصال برقرار است. پاسخ مدل: ${result.reply || '—'}`);
      else setError(result.error ?? 'اتصال برقرار نشد.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'آزمایش اتصال ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none';
  const label = 'text-xs font-semibold text-slate-600 block mb-1.5';

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-white rounded-2xl border border-slate-150 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-150">
          <Bot size={18} className="text-indigo-500" />
          <div>
            <h3 className="font-bold text-sm text-slate-800">دستیار هوشمند داشبورد</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              پاسخ به سوال‌های تحلیلی درباره پروژه‌ها، مالی، انبار و فعالیت‌ها، بر پایه‌ی داده‌های همین سامانه
            </p>
          </div>
        </div>

        {error && (
          <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
        )}
        {notice && (
          <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{notice}</p>
        )}

        <label className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer ${
          assistant.enabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/60'
        }`}>
          <input
            type="checkbox"
            checked={assistant.enabled === true}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="accent-emerald-500 mt-0.5"
          />
          <span className="text-[11px] leading-6">
            <span className="font-bold text-slate-800">دستیار فعال باشد</span>
            <span className="block text-slate-500">
              تا وقتی این تیک نخورده، پنل دستیار در داشبورد هیچ‌کس دیده نمی‌شود.
              دسترسی هر کاربر جداگانه در «مدیریت کاربران ← دستیار هوشمند» تعیین می‌شود.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label className={label}>آدرس پایه سرویس (Base URL)</label>
            <input
              type="text"
              value={assistant.baseUrl ?? ''}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              dir="ltr"
              className={`${field} text-left font-mono text-xs`}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              تا انتهای <span className="font-mono">/v1</span>. هر سرویس سازگار با OpenAI کار می‌کند:
              OpenAI، OpenRouter، درگاه‌های داخلی، یا مدلی روی شبکه‌ی خودتان.
            </p>
          </div>

          <div>
            <label className={label}>نام مدل</label>
            <input
              type="text"
              value={assistant.model ?? ''}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="gpt-4o-mini"
              dir="ltr"
              className={`${field} text-left font-mono text-xs`}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              مدل باید از «فراخوانی ابزار» (tool calling) پشتیبانی کند، وگرنه دستیار نمی‌تواند داده بخواند.
            </p>
          </div>
        </div>

        {/* The key: written here, never read back. */}
        <div>
          <label className={label}>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={12} className="text-slate-400" />
              کلید API
            </span>
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={keyHint ? `ثبت شده: ${keyHint}` : 'هنوز ثبت نشده'}
              dir="ltr"
              className={`${field} flex-1 text-left font-mono text-xs`}
            />
            <button
              type="button"
              disabled={busy || !keyDraft.trim()}
              onClick={() => void saveKey()}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-bold disabled:opacity-50 shrink-0"
            >
              ذخیره کلید
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void test()}
              className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 shrink-0 flex items-center justify-center gap-1.5"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
              آزمایش اتصال
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            کلید فقط روی سرور ذخیره می‌شود و هیچ‌وقت به مرورگر برنمی‌گردد؛ خالی گذاشتن یعنی «همان کلید قبلی».
          </p>
        </div>

        <div>
          <label className={label}>دستورالعمل اختصاصی</label>
          <textarea
            rows={4}
            value={assistant.systemPrompt ?? ''}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            placeholder="مثال: در پاسخ‌ها همیشه مبالغ را به میلیون تومان هم بنویس. اگر سوال درباره پروژه‌های لغو شده بود، اول این را یادآوری کن."
            className={`${field} leading-relaxed`}
          />
          <p className="text-[10px] text-slate-400 mt-1">
            به دستورالعمل پایه <span className="font-bold">اضافه</span> می‌شود، جایگزینش نمی‌شود.
            دستورالعمل پایه به دستیار می‌گوید تقویم شمسی است، مبالغ ریالی‌اند، و حق ندارد عدد حدس بزند.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className={label}>خلاقیت (Temperature)</label>
            {/*
              «پیش‌فرض مدل» is a real option, not a placeholder for zero. The
              reasoning models accept only their own default and answer 400 to
              any explicit value, so a control that could only ever produce a
              number made those models unusable.
            */}
            {assistant.temperature === null || assistant.temperature === undefined ? (
              <button
                type="button"
                onClick={() => patch({ temperature: 0 })}
                className={`${field} text-center text-slate-500 hover:border-sky-400`}
              >
                پیش‌فرض مدل
              </button>
            ) : (
              <NumberField
                min={0} max={2}
                value={assistant.temperature}
                onChange={(temperature) => patch({ temperature })}
                className={`${field} text-center font-mono`}
              />
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              برای سوال‌های عددی صفر بگذارید.{' '}
              {assistant.temperature === null || assistant.temperature === undefined ? (
                'روی کادر بزنید تا عدد بگذارید.'
              ) : (
                <button
                  type="button"
                  onClick={() => patch({ temperature: null })}
                  className="text-sky-600 hover:underline font-bold"
                >
                  سپردن به مدل
                </button>
              )}
            </p>
          </div>
          <div>
            <label className={label}>حداکثر طول پاسخ</label>
            <NumberField
              integer min={256} max={32000}
              value={assistant.maxTokens ?? 2000}
              onChange={(maxTokens) => patch({ maxTokens })}
              className={`${field} text-center font-mono`}
            />
          </div>
          <div>
            <label className={label}>سقف مراحل جستجو</label>
            <NumberField
              integer min={1} max={30}
              value={assistant.maxToolCalls ?? 12}
              onChange={(maxToolCalls) => patch({ maxToolCalls })}
              className={`${field} text-center font-mono`}
            />
            <p className="text-[10px] text-slate-400 mt-1">هر مرحله یک بار خواندن داده است.</p>
          </div>
          <div>
            <label className={label}>مهلت پاسخ (ثانیه)</label>
            <NumberField
              integer min={5} max={300}
              value={assistant.timeoutSeconds ?? 60}
              onChange={(timeoutSeconds) => patch({ timeoutSeconds })}
              className={`${field} text-center font-mono`}
            />
          </div>
        </div>

        <label className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer ${
          assistant.allowActions ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50/60'
        }`}>
          <input
            type="checkbox"
            checked={assistant.allowActions === true}
            onChange={(e) => patch({ allowActions: e.target.checked })}
            className="accent-amber-500 mt-0.5"
          />
          <span className="text-[11px] leading-6">
            <span className="font-bold text-slate-800">اجازه‌ی پیشنهاد ثبت رکورد</span>
            <span className="block text-slate-500">
              با این گزینه دستیار می‌تواند برای کارهایی مثل صدور پیش‌فاکتور «پیشنهاد» آماده کند.
              هیچ‌چیز بدون فشردن دکمه‌ی تایید شما در سیستم ثبت نمی‌شود.
            </span>
            {/*
              What the switch actually permits, spelled out. A checkbox whose
              label says «کارهایی مثل…» is a decision made in the dark.
            */}
            {actions.length > 0 && (
              <span className="block text-slate-500 mt-1">
                کارهای قابل پیشنهاد: {actions.map((a) => a.label).join('، ')}.
                هر کدام فقط برای کاربری فعال است که دسترسی نوشتن در همان ماژول را دارد،
                و مهلت تایید هر پیشنهاد {PROPOSAL_TTL_MINUTES.toLocaleString('fa-IR')} دقیقه است.
              </span>
            )}
          </span>
        </label>
      </div>

      {/* What it can look at — so whoever writes the instructions knows. */}
      {tools.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-150 shadow-sm p-6 space-y-2">
          <h4 className="font-bold text-xs text-slate-700">
            دستیار به این اطلاعات دسترسی دارد ({tools.length.toLocaleString('fa-IR')} ابزار)
          </h4>
          <p className="text-[10px] text-slate-400 leading-5">
            هر ابزار از همان سرویسی می‌خواند که خود برنامه استفاده می‌کند، پس محدودیت‌های دسترسی
            هر کاربر — از جمله «مشاهده بهای خرید» — عیناً رعایت می‌شود.
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 pt-1">
            {tools.map((tool) => (
              <li key={tool.name} className="text-[10px] text-slate-500 border border-slate-100 rounded-lg px-2 py-1.5">
                <span className="font-mono text-slate-700" dir="ltr">{tool.name}</span>
                <span className="block mt-0.5 leading-5">{tool.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
