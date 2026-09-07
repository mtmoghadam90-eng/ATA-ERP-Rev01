import React from "react";
import { Users, X } from "lucide-react";
import { SegmentPreview, campaignsApi } from "../api/campaigns";
import type { SegmentQuery } from "../utils/campaigns";

/**
 * Saves the filters already set on the customers grid as a segment.
 *
 * There is deliberately **no filter form here**. A segment is the customers
 * list's own query, and building a second set of controls for it in the
 * messaging screen would be a second filter dialect — two places to add every
 * new filter, and two answers to «who is in this segment» the day somebody
 * forgets one of them. So a segment is made where the filters are: the person
 * narrows the grid until it shows the people they mean, and this names what
 * they are looking at.
 *
 * The count is fetched from the server before saving, and it is the *server's*
 * count of every match rather than the page in hand — the grid shows fifty rows
 * and «۵۰ مشتری» beside a segment of six hundred would be a figure that reads
 * as the whole answer.
 */

interface Props {
  open: boolean;
  query: SegmentQuery;
  onClose: () => void;
  onSaved: (name: string) => void;
}

export function SegmentSaveModal({ open, query, onClose, onSaved }: Props) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [preview, setPreview] = React.useState<SegmentPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Seeded on opening only. Keying on `open` rather than on the query object is
  // what stops the grid behind re-rendering the typed name away.
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setError(null);
    setPreview(null);
  }, [open]);

  const queryRef = React.useRef(query);
  queryRef.current = query;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    campaignsApi.previewSegment({ query: queryRef.current })
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const conditions = Object.keys(queryRef.current).filter((k) => k !== "sort" && k !== "order");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await campaignsApi.createSegment({
        name, description: description || null, query: queryRef.current,
      });
      onSaved(name);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Users size={18} className="text-sky-600" />
            ذخیره فیلترهای فعلی به‌عنوان سگمنت
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-slate-700">
            {preview
              ? <>این سگمنت هم‌اکنون <b>{preview.total}</b> مشتری دارد. سگمنت یک <b>پرس‌وجوی ذخیره‌شده</b> است، نه فهرست ثابتی از افراد — هر بار که استفاده شود دوباره محاسبه می‌شود.</>
              : "در حال شمارش مشتریان..."}
          </div>

          {conditions.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              هیچ فیلتری روی فهرست مشتریان اعمال نشده است. ابتدا فهرست را محدود کنید؛
              سگمنت بدون شرط ثبت نمی‌شود.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">نام سگمنت *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً: مشتریان رتبه A استان تهران"
              className="w-full px-3 py-2 border border-edge rounded-xl text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">توضیح</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-edge rounded-xl text-sm"
            />
          </div>

          {preview && preview.sample.length > 0 && (
            <div className="text-xs text-slate-500">
              نمونه: {preview.sample.slice(0, 4).map((c) => c.name).join("، ")}
              {preview.total > 4 ? " …" : ""}
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-edge">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">انصراف</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || conditions.length === 0}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium"
          >
            {saving ? "در حال ذخیره..." : "ذخیره سگمنت"}
          </button>
        </div>
      </div>
    </div>
  );
}
