import { useState } from "react";
import { Plus, X } from "lucide-react";
import { addSpecLine, removeSpecLine, setSpecLine, specLines } from "../utils/packingSpecs";

/**
 * «مشخصات فنی» of a packing line, one editable line at a time.
 *
 * Each line is its own box with a remove button, so a line of the quotation's
 * specification the packing list should not carry is dropped with one press,
 * and a new line can be added under them — which is also how a hand-typed row
 * gets a specification at all. The value is plain text, newline-separated.
 */
export default function PackingSpecEditor({
  value,
  onChange,
  compact = false,
}: {
  value: string | undefined;
  onChange: (next: string) => void;
  compact?: boolean;
}) {
  const lines = specLines(value);
  const [draft, setDraft] = useState("");
  const text = compact ? "text-[10px]" : "text-xs";

  const add = () => {
    if (!draft.trim()) return;
    onChange(addSpecLine(value, draft));
    setDraft("");
  };

  return (
    <div className="space-y-1" data-packing-spec>
      {lines.map((line, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            dir="auto"
            value={line}
            onChange={(e) => onChange(setSpecLine(value, i, e.target.value))}
            className={`flex-1 min-w-0 border border-slate-200 rounded-md px-1.5 py-0.5 ${text} bg-white focus:outline-none focus:border-emerald-500`}
          />
          <button
            type="button"
            onClick={() => onChange(removeSpecLine(value, i))}
            className="p-0.5 text-slate-400 hover:text-rose-600 shrink-0"
            title="حذف این سطر از مشخصات"
            data-packing-spec-remove
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          type="text"
          dir="auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={lines.length ? "افزودن سطر مشخصات..." : "مشخصات فنی (هر سطر جدا)..."}
          className={`flex-1 min-w-0 border border-dashed border-slate-200 rounded-md px-1.5 py-0.5 ${text} bg-white focus:outline-none focus:border-emerald-500`}
          data-packing-spec-draft
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="p-0.5 text-emerald-600 hover:text-emerald-700 disabled:text-slate-300 shrink-0"
          title="افزودن سطر"
          data-packing-spec-add
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
