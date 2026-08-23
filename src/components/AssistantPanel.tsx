import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { AssistantAnswer, AssistantStep, assistantApi } from '../api/assistant';

/**
 * The assistant on the dashboard.
 *
 * A thin screen over a server-side loop: the browser sends the conversation and
 * gets back an answer. It deliberately holds no data of its own and calls no
 * other endpoint — everything the assistant knows it read on the server,
 * through the same services the rest of the API uses, so what it can see is
 * exactly what this user can see.
 *
 * The steps under each answer are not decoration. An assistant that quotes a
 * profit figure is worth nothing unless the person reading it can tell which
 * records the figure came from.
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  steps?: AssistantStep[];
  failed?: boolean;
}

const SUGGESTIONS = [
  'روی پروژه‌های برنده امسال چقدر سود کرده‌ایم؟',
  'کدام پروژه‌ها بیشتر از ۱۰ روز است که هیچ فعالیتی رویشان ثبت نشده؟',
  'میانگین زمان انجام هر دسته‌بندی فعالیت چقدر است؟',
  'کدام کالاها موجودی‌شان به حداقل رسیده؟',
];

export default function AssistantPanel() {
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean } | null>(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  /*
   * Asked once, on mount, with no dependencies.
   *
   * The dashboard re-renders whenever anything on it refreshes; an effect that
   * depended on a value rebuilt per render would ask the server on every one of
   * them. Same shape of bug as the messaging screen's refetch loop.
   */
  useEffect(() => {
    let cancelled = false;
    assistantApi.status()
      .then((result) => {
        if (cancelled) return;
        setVisible(result.allowed);
        setStatus({ enabled: result.enabled, configured: result.configured });
      })
      .catch(() => { if (!cancelled) setVisible(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    const history: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(history);
    setDraft('');
    setBusy(true);

    try {
      const answer: AssistantAnswer = await assistantApi.ask(
        history.map((t) => ({ role: t.role, content: t.content })),
      );
      setTurns((prev) => [...prev, answer.ok
        ? { role: 'assistant', content: answer.reply ?? '', steps: answer.steps }
        : { role: 'assistant', content: answer.error ?? 'پاسخی دریافت نشد.', steps: answer.steps, failed: true }]);
    } catch (err) {
      setTurns((prev) => [...prev, {
        role: 'assistant',
        content: err instanceof ApiError ? err.message : 'ارتباط با دستیار برقرار نشد.',
        failed: true,
      }]);
    } finally {
      setBusy(false);
    }
  }, [busy, turns]);

  if (!visible) return null;

  const notReady = !status?.enabled || !status?.configured;

  return (
    <div className="bg-white rounded-2xl border border-slate-150 shadow-sm overflow-hidden" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 bg-gradient-to-l from-indigo-50/60 to-white border-b border-slate-100 text-right"
      >
        <span className="flex items-center gap-2">
          <span className="p-1.5 rounded-xl bg-indigo-100 text-indigo-600">
            <Bot size={16} />
          </span>
          <span>
            <span className="block font-bold text-sm text-slate-800">دستیار هوشمند</span>
            <span className="block text-[10px] text-slate-500">
              هر سوالی درباره پروژه‌ها، مالی، انبار و فعالیت‌ها بپرسید
            </span>
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {notReady ? (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 leading-6">
              {!status?.enabled
                ? 'دستیار هنوز فعال نشده است. در «تنظیمات ← دستیار هوشمند» آن را روشن کنید.'
                : 'کلید API سرویس هوش مصنوعی ثبت نشده است. در «تنظیمات ← دستیار هوشمند» آن را وارد کنید.'}
            </p>
          ) : (
            <>
              {turns.length === 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-indigo-400" />
                    مثلاً بپرسید:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="text-[11px] border border-slate-200 rounded-full px-3 py-1.5 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.length > 0 && (
                <div className="max-h-[26rem] overflow-y-auto space-y-2.5 pl-1">
                  {turns.map((turn, index) => (
                    <div
                      key={index}
                      className={turn.role === 'user' ? 'flex justify-start' : 'flex justify-end'}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-6 whitespace-pre-wrap ${
                          turn.role === 'user'
                            ? 'bg-slate-100 text-slate-800'
                            : turn.failed
                              ? 'bg-rose-50 text-rose-700 border border-rose-100'
                              : 'bg-indigo-50/70 text-slate-800 border border-indigo-100'
                        }`}
                      >
                        {turn.content}

                        {/* Which records the answer came from. */}
                        {!!turn.steps?.length && (
                          <div className="mt-1.5 pt-1.5 border-t border-indigo-100/70">
                            <button
                              type="button"
                              onClick={() => setShowSteps(showSteps === index ? null : index)}
                              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                            >
                              {showSteps === index ? 'پنهان کردن منابع' : `منابع پاسخ (${turn.steps.length} مرحله)`}
                            </button>
                            {showSteps === index && (
                              <ul className="mt-1 space-y-0.5">
                                {turn.steps.map((step, i) => (
                                  <li key={i} className="text-[10px] font-mono text-slate-500" dir="ltr">
                                    {step.ok ? '✓' : '✕'} {step.tool}({step.arguments.slice(0, 90)})
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className="flex justify-end">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-150 rounded-2xl px-3 py-2">
                        <Loader2 size={12} className="animate-spin" />
                        در حال بررسی اطلاعات…
                      </span>
                    </div>
                  )}
                  <div ref={endRef} />
                </div>
              )}

              <div className="flex items-end gap-2">
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter breaks the line — the shape
                    // everybody already has in their fingers.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  placeholder="سوالتان را بنویسید…"
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                />
                <button
                  type="button"
                  disabled={busy || !draft.trim()}
                  onClick={() => void send(draft)}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Send size={13} />
                  بپرس
                </button>
                {turns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setTurns([]); setShowSteps(null); }}
                    title="پاک کردن گفتگو"
                    className="px-2 py-2 border border-slate-200 rounded-xl text-slate-400 hover:text-rose-600 hover:border-rose-200"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
