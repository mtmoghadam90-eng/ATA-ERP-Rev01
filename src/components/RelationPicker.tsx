import React from 'react';
import { Search } from 'lucide-react';
import { useEntitySearch } from '../api/useEntitySearch';
import type { CustomerRow } from '../api/customers';
import { toPersianDigits } from '../numUtils';

/**
 * «تعریف ارتباط» — choosing the customers on the other side of a link.
 *
 * One component for the two forms that ask it. They had drifted exactly the way
 * this codebase's five customer creation forms always do: `CustomersView`'s copy
 * searched the server and capped what it drew, while `QuickAddModal`'s copy had
 * **no search box at all** and drew every candidate its `customers` prop
 * happened to hold — so it was both a wall of checkboxes and, worse, unable to
 * offer anybody outside the page already loaded. Reported as «قابلیت سرچ وجود
 * داشته باشد», which is the first half; the wall is the second.
 *
 * **A link always joins the opposite type** — a company's links are the people
 * who work there and a person's are the companies they belong to — so the query
 * is filtered to it and never to the type being edited.
 *
 * **The results scroll, and that is the one exception to this application's own
 * «a form has one scrollbar» rule.** The reason it is not a breach is what the
 * rule already exempts: a *picker's* result list, like `SearchableSelect`'s
 * dropdown or the mention list, is not the form's own content — it is what the
 * search box above it just answered, and its shape is the search's rather than
 * the record's. The fault that rule was written for is a window onto content
 * somebody authored; this is a window onto a query, with the control that
 * narrows it directly above and a line beneath saying what is behind the fold.
 * It is capped at roughly three rows on purpose, which is short enough that the
 * page around it never has two scrollbars competing for the same gesture.
 */

/** How tall the result list is, in whole rows. */
export const RELATION_VISIBLE_ROWS = 3;
/** One row: a name over a meta line, at this file's own padding. */
export const RELATION_ROW_PX = 46;
/** How many the server is asked for. Always more than fit, or searching is the only way to see anything and «موارد بیشتری هم هست» would be untrue. */
export const RELATION_FETCH_LIMIT = 25;

export interface RelationPickerProps {
  /** The type of the record being edited; the query asks for the other one. */
  customerType: 'حقوقی' | 'حقیقی';
  /** Ids currently linked. */
  selected: string[];
  onToggle: (id: string) => void;
  /** The record being edited, so it cannot be linked to itself. */
  excludeId?: string | null;
  /** False while the form is closed, or it queries behind a shut modal. */
  enabled?: boolean;
  /** Drawn beside the search box — `CustomersView`'s «تعریف سریع» button. */
  trailing?: React.ReactNode;
}

/** A candidate's name, whichever kind of record it is. */
function candidateName(row: CustomerRow): string {
  const company = (row.companyName || '').trim();
  if (company) return company;
  return `${row.firstName || ''} ${row.lastName || ''}`.trim();
}

/** The line under the name: what distinguishes two people with similar names. */
function candidateMeta(row: CustomerRow): string {
  return row.customerType === 'حقوقی'
    ? `صنعت: ${row.industry || '—'}`
    : `سمت: ${row.position || '—'}`;
}

export function RelationPicker({
  customerType,
  selected,
  onToggle,
  excludeId,
  enabled = true,
  trailing,
}: RelationPickerProps) {
  const search = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: RELATION_FETCH_LIMIT,
    params: { customerType: customerType === 'حقوقی' ? 'حقیقی' : 'حقوقی' },
    getLabel: candidateName,
    enabled,
  });

  const candidates = React.useMemo(
    () => search.matches.filter((row) => !excludeId || row.id !== excludeId),
    [search.matches, excludeId],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={customerType === 'حقوقی' ? 'جستجو در اشخاص حقیقی...' : 'جستجو در شرکت‌ها...'}
            value={search.term}
            onChange={(e) => search.setTerm(e.target.value)}
            className="w-full pr-8 pl-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        {trailing}
      </div>

      <div className="border border-slate-100 rounded-lg bg-white overflow-hidden">
        {/*
          The cap is a Tailwind class and never an inline `maxHeight`, which is
          not a style choice: `test:rules`'s «one scrollbar per form» loop reads
          these files for a line carrying both `overflow-y-auto` and a `max-h-`,
          and an inline style would have slipped past it — an exemption that
          works by being invisible to the check is no exemption at all. The
          figure is `RELATION_VISIBLE_ROWS × RELATION_ROW_PX` and `test:rules`
          holds the class against that product, so the two cannot drift and a
          fourth row can never be left cut in half.
        */}
        <div data-relation-results className="divide-y divide-slate-100 overflow-y-auto max-h-[138px]">
          {candidates.length > 0 ? (
            candidates.map((row) => {
              const isChecked = selected.includes(row.id);
              return (
                <label
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50/50 cursor-pointer text-xs select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggle(row.id)}
                    className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{candidateName(row)}</p>
                    <p className="text-[10px] text-slate-400 truncate">{candidateMeta(row)}</p>
                  </div>
                </label>
              );
            })
          ) : (
            <div className="p-4 text-center text-[11px] text-slate-400 italic">
              {search.loading
                ? 'در حال جستجو…'
                : search.term.trim()
                  ? 'موردی با این جستجو پیدا نشد.'
                  : 'موردی جهت ارتباط یافت نشد.'}
            </div>
          )}
        </div>

        {/*
          What is behind the fold, said rather than left to be discovered. Two
          sentences because two different things are true: the server sent more
          than the box holds, or the server itself stopped at its own limit and
          there may be more behind that — «۱۹ مورد دیگر» would be a figure this
          screen does not have in the second case.
        */}
        {candidates.length > RELATION_VISIBLE_ROWS && (
          <div className="px-3 py-1.5 text-[10px] text-slate-500 bg-slate-50/70 text-center border-t border-slate-100">
            {search.matches.length >= RELATION_FETCH_LIMIT
              ? 'موارد بیشتری هم هست؛ برای رسیدن به مورد دلخواه، نام آن را در کادر بالا جستجو کنید.'
              : `${toPersianDigits(String(candidates.length))} مورد؛ برای دیدن بقیه در فهرست بالا اسکرول کنید یا نام را جستجو کنید.`}
          </div>
        )}
      </div>
    </div>
  );
}

export default RelationPicker;
