import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bot, Loader2, Package, Paperclip, PlusCircle, Send, Sparkles, X,
} from 'lucide-react';
import { ApiError } from '../api/client';
import { AdvisorAnswer, SuggestedItem, assistantApi } from '../api/assistant';
import { uploadFile } from '../imageUtils';
import { formatMoney } from '../numUtils';

/**
 * The product adviser, over the proforma form.
 *
 * A customer's enquiry goes in — as text, and as the PDFs, photographs and
 * spreadsheets they sent — and suggested items come back.
 *
 * **Each card is a preview of the printed line**, deliberately: the same
 * two-column shape, the same «Label: Value» specification, the same image. So
 * «افزودن به ردیف» is not a leap of faith — what is on the card is what lands
 * on the document. The user is left with the price and the quantity, which are
 * the two things a machine has no business deciding.
 *
 * Nothing here writes to the catalogue. A suggestion becomes a line in the
 * form's own state, unsaved, and a wrong one is removed by deleting the row.
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  items?: SuggestedItem[];
  attachments?: { name: string; read: boolean; problem?: string }[];
  failed?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Adds one suggestion to the proforma as a new line. */
  onAdd: (item: SuggestedItem) => void;
  /** What the document is priced in, so the card can say so. */
  currency: string;
}

const MATCH_LABEL: Record<SuggestedItem['match'], { text: string; className: string }> = {
  exact: { text: 'موجود در انبار', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  close: { text: 'کالا هست، این پیکربندی نه', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  new: { text: 'در انبار تعریف نشده', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default function ProductAdvisorModal({ open, onClose, onAdd, currency }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  const attach = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const uploaded: { name: string; url: string }[] = [];
      for (const file of Array.from(list).slice(0, 10)) {
        uploaded.push({ name: file.name, url: await uploadFile(file, 'inquiries') });
      }
      setFiles((current) => [...current, ...uploaded].slice(0, 10));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'بارگذاری فایل انجام نشد.');
    } finally {
      setUploading(false);
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if ((!question && files.length === 0) || busy) return;

    const asked = question || 'درخواست مشتری در فایل‌های پیوست است.';
    const history: Turn[] = [...turns, { role: 'user', content: asked }];
    setTurns(history);
    setDraft('');
    const sending = files.map((f) => f.url);
    setFiles([]);
    setBusy(true);

    try {
      const answer: AdvisorAnswer = await assistantApi.advise(
        history.map((t) => ({ role: t.role, content: t.content })),
        sending,
      );
      setTurns((prev) => [...prev, answer.ok
        ? {
            role: 'assistant',
            content: answer.reply ?? '',
            items: answer.items,
            attachments: answer.attachments,
          }
        : {
            role: 'assistant',
            content: answer.error ?? 'پاسخی دریافت نشد.',
            attachments: answer.attachments,
            failed: true,
          }]);
    } catch (err) {
      setTurns((prev) => [...prev, {
        role: 'assistant',
        content: err instanceof ApiError ? err.message : 'ارتباط با دستیار برقرار نشد.',
        failed: true,
      }]);
    } finally {
      setBusy(false);
    }
  }, [busy, files, turns]);

  if (!open) return null;

  const keyOf = (turnIndex: number, itemIndex: number) => `${turnIndex}:${itemIndex}`;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-4xl h-[88vh] shadow-xl border border-slate-100 flex flex-col overflow-hidden">

        <div className="flex justify-between items-center p-4 border-b border-slate-150 bg-gradient-to-l from-indigo-50/60 to-white">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-indigo-100 text-indigo-600"><Bot size={16} /></span>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">راهنمای هوش مصنوعی انتخاب کالا</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">
                درخواست مشتری و فایل‌هایش را بفرستید تا اقلام مناسب پیشنهاد شود
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {turns.length === 0 && (
            <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-150 rounded-xl p-4 leading-6">
              <p className="flex items-center gap-1.5 font-bold text-slate-700 mb-1.5">
                <Sparkles size={13} className="text-indigo-400" />
                چطور کار می‌کند
              </p>
              <p>
                درخواست مشتری را بنویسید — یا فایلش را پیوست کنید (PDF، تصویر، اکسل) — و
                بگویید چه می‌خواهد. کالاهای انبار بر اساس <span className="font-bold">مقادیر ویژگی‌ها</span>{' '}
                جستجو می‌شوند، نه فقط نام، پس SKU درست پیدا می‌شود.
              </p>
              <p className="mt-1.5">
                کنار هر پیشنهاد دکمه‌ی «افزودن به ردیف» هست. مشخصات فنی، SKU و تصویر در ردیف
                می‌نشیند و شما فقط قیمت و تعداد را می‌زنید.
              </p>
            </div>
          )}

          {turns.map((turn, turnIndex) => (
            <div key={turnIndex} className="space-y-2">
              <div className={turn.role === 'user' ? 'flex justify-start' : 'flex justify-end'}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-6 whitespace-pre-wrap ${
                  turn.role === 'user'
                    ? 'bg-slate-100 text-slate-800'
                    : turn.failed
                      ? 'bg-rose-50 text-rose-700 border border-rose-100'
                      : 'bg-indigo-50/70 text-slate-800 border border-indigo-100'
                }`}>
                  {turn.content}
                </div>
              </div>

              {/* What was actually read out of each file — a file silently
                  ignored is worse than one that was never attached. */}
              {turn.attachments?.filter((a) => !a.read).map((a) => (
                <p key={a.name} className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-5">
                  <AlertTriangle size={11} className="inline ml-1" />
                  <span className="font-bold">{a.name}</span>: {a.problem}
                </p>
              ))}

              {turn.items?.map((item, itemIndex) => {
                const cardKey = keyOf(turnIndex, itemIndex);
                const badge = MATCH_LABEL[item.match];
                const isAdded = added.has(cardKey);

                return (
                  <div key={cardKey} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    {/* The printed line's own two columns, in the same order. */}
                    <div className="grid grid-cols-3 bg-slate-50 border-b border-slate-150 text-[11px] font-bold text-slate-600">
                      <div className="p-2 text-center border-l border-slate-150">تصویر کالا</div>
                      <div className="col-span-2 p-2 text-center">نوع کالا و مشخصات فنی</div>
                    </div>

                    <div className="grid grid-cols-3">
                      <div className="p-3 border-l border-slate-100 flex items-start justify-center">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.productName}
                            className="max-h-28 object-contain rounded-lg border border-slate-100"
                          />
                        ) : (
                          <span className="text-[10px] text-slate-300 flex flex-col items-center gap-1 pt-4">
                            <Package size={22} />
                            بدون تصویر
                          </span>
                        )}
                      </div>

                      <div className="col-span-2 p-3">
                        <p className="font-bold text-slate-800 text-sm">{item.productName}</p>
                        <div className="border-t border-slate-150 my-2" />
                        <div className="space-y-0.5" dir="ltr">
                          {item.specs.map((spec, i) => (
                            <p key={i} className="text-[11px] text-slate-700 leading-5 text-left">
                              {spec.label}: {spec.value}
                            </p>
                          ))}
                          {item.notes.map((note, i) => (
                            <p key={`n${i}`} className="text-[11px] text-slate-500 leading-5 text-left">
                              {note.startsWith('*') ? note : `* ${note}`}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="px-3 py-2 border-t border-slate-150 bg-slate-50/60 flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.className}`}>
                        {badge.text}
                      </span>
                      {item.sku && (
                        <span className="text-[10px] font-mono text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5" dir="ltr">
                          {item.sku}
                        </span>
                      )}
                      {item.match === 'exact' && item.stockLevel !== undefined && (
                        <span className="text-[10px] text-slate-500">
                          موجودی: {formatMoney(item.stockLevel)}
                        </span>
                      )}
                      {!!item.priceRial && (
                        <span className="text-[10px] text-slate-500">
                          قیمت پایه: {formatMoney(item.priceRial)} ریال
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => { onAdd(item); setAdded((s) => new Set(s).add(cardKey)); }}
                        className={`mr-auto px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 ${
                          isAdded
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-sky-500 hover:bg-sky-600 text-white'
                        }`}
                      >
                        <PlusCircle size={13} />
                        {isAdded ? 'افزوده شد — دوباره؟' : 'افزودن به ردیف پیش‌فاکتور'}
                      </button>
                    </div>

                    {item.reason && (
                      <p className="px-3 pb-2 text-[10px] text-slate-500 leading-5">{item.reason}</p>
                    )}
                    {item.match !== 'exact' && (
                      <p className="px-3 pb-2 text-[10px] text-amber-700 leading-5">
                        این قلم به‌صورت متن آزاد به پیش‌فاکتور اضافه می‌شود؛ برای داشتن SKU،
                        کالا را در انبار تعریف کنید.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {busy && (
            <div className="flex justify-end">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-150 rounded-2xl px-3 py-2">
                <Loader2 size={12} className="animate-spin" />
                در حال بررسی درخواست و جستجوی انبار…
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-150 p-3 space-y-2">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((file) => (
                <span key={file.url} className="text-[10px] bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 flex items-center gap-1">
                  <Paperclip size={10} className="text-slate-400" />
                  {file.name}
                  <button
                    type="button"
                    onClick={() => setFiles((c) => c.filter((f) => f.url !== file.url))}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <label className="px-2.5 py-2 border border-slate-200 rounded-xl text-slate-500 hover:text-sky-600 hover:border-sky-300 cursor-pointer shrink-0">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { void attach(e.target.files); e.target.value = ''; }}
              />
            </label>

            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder={`درخواست مشتری… (واحد پول سند: ${currency})`}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            />

            <button
              type="button"
              disabled={busy || uploading || (!draft.trim() && files.length === 0)}
              onClick={() => void send(draft)}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 flex items-center gap-1.5 shrink-0"
            >
              <Send size={13} />
              بررسی کن
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
