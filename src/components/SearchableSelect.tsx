import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  required?: boolean;
  disabled?: boolean;
  /**
   * Notified as the user types, for a picker whose options come from the server.
   *
   * When set, `options` is treated as already matching the term and the local
   * filter is skipped — otherwise a server result would be filtered a second
   * time against the same text and matches on fields the label does not show
   * (a phone number, an economic code) would disappear.
   */
  onSearchChange?: (term: string) => void;
  /** Shown in place of "no result" while the server is answering. */
  loading?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '-- انتخاب کنید --',
  className = '',
  wrapperClassName = '',
  required = false,
  disabled = false,
  onSearchChange,
  loading = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  // Normalize Persian characters for more accurate search
  const normalizePersian = (str: any) => {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/‌/g, ' ') // zero-width space to normal space
      .toLowerCase();
  };

  // A server-backed picker has already matched; filtering again here would drop
  // rows matched on something the label does not show.
  const filteredOptions = onSearchChange
    ? options.filter(Boolean)
    : options.filter((opt) =>
        opt && normalizePersian(opt.label).includes(normalizePersian(searchTerm))
      );

  const updateSearch = (term: string) => {
    setSearchTerm(term);
    onSearchChange?.(term);
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    // Clears the parent's term too, so reopening starts from the full list
    // rather than the last thing that was typed.
    updateSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    updateSearch('');
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${disabled ? 'opacity-60 pointer-events-none' : ''} ${wrapperClassName}`}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm bg-white text-right cursor-pointer select-none transition focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none ${
          isOpen ? 'border-sky-500 ring-2 ring-sky-500/20' : 'border-slate-200'
        } ${className}`}
      >
        <span className="truncate flex-1 pl-2">
          {selectedOption ? selectedOption.label : <span className="text-slate-400 font-normal">{placeholder}</span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
          {value && !required && (
            <X
              size={14}
              className="hover:text-red-500 transition cursor-pointer"
              onClick={handleClear}
            />
          )}
          <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-sky-600' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-[100] mt-1 min-w-full w-max max-w-[90vw] sm:max-w-2xl rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden animate-fade-in text-right">
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => updateSearch(e.target.value)}
              placeholder="جستجو..."
              className="w-full text-xs bg-transparent border-0 outline-none text-right py-1 placeholder-slate-400 focus:ring-0"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => updateSearch('')}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {loading && filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">در حال جستجو…</div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">آیتمی یافت نشد</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-right px-3 py-2 text-xs transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-sky-50 text-sky-800 font-bold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex-1 whitespace-normal break-words leading-relaxed text-right">{opt.label}</span>
                    {isSelected && <Check size={14} className="text-sky-600 shrink-0 mr-2" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
