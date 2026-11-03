import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { addSpecLine, specLines } from "../utils/packingSpecs";

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
  // The boxes are held here rather than read off `value` on every render: a
  // box emptied while somebody retypes it must stay on the screen, and only
  // the non-blank lines are reported upwards. An outside change (a won line
  // picked, a row reset) re-seeds them.
  const [lines, setLines] = useState<string[]>(() => specLines(value));
  const [draft, setDraft] = useState("");
  const joined = (rows: string[]) => rows.filter((l) => l.trim() !== "").join("\n");
  useEffect(() => {
    if (specLines(value).join("\n") !== joined(lines)) setLines(specLines(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const update = (rows: string[]) => { setLines(rows); onChange(joined(rows)); };
  const text = compact ? "text-[10px]" : "text-xs";

  const add = () => {
    if (!draft.trim()) return;
    update(specLines(addSpecLine(joined(lines), draft)));
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
            onChange={(e) => update(lines.map((l, j) => (j === i ? e.target.value : l)))}
            className={`flex-1 min-w-0 border border-slate-200 rounded-md px-1.5 py-0.5 ${text} bg-white focus:outline-none focus:border-emerald-500`}
          />
          <button
            type="button"
            onClick={() => update(lines.filter((_, j) => j !== i))}
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
