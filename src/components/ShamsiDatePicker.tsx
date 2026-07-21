import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { getTodayShamsi, gregorianToJalali, jalaliToGregorian } from '../dateUtils';

interface ShamsiDatePickerProps {
  value: string; // "1405/04/14" or "YYYY/MM/DD"
  onChange: (val: string) => void;
  label?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

const MONTH_NAMES = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
];

const WEEKDAY_NAMES_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function isJalaliLeapYear(jy: number): boolean {
  const r = jy % 33;
  return [1, 5, 9, 13, 17, 22, 26, 30].includes(r);
}

export function getJalaliMonthDays(jy: number, jm: number): number {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  if (jm === 12) {
    return isJalaliLeapYear(jy) ? 30 : 29;
  }
  return 0;
}

// Map Gregorian getDay() (0=Sun, 1=Mon, ..., 6=Sat) to Saturday-first (0=Sat, 1=Sun, ..., 6=Fri)
export function getShamsiWeekDayOfFirst(jy: number, jm: number): number {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, 1);
  const d = new Date(gy, gm - 1, gd);
  const gDay = d.getDay();
  return (gDay + 1) % 7;
}

export default function ShamsiDatePicker({
  value,
  onChange,
  label,
  required = false,
  placeholder = "YYYY/MM/DD",
  className = "",
  compact = false
}: ShamsiDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calendar view states
  const [currentYear, setCurrentYear] = useState(1405);
  const [currentMonth, setCurrentMonth] = useState(4); // 1-indexed (1 to 12)

  // Initialize view states from the current input value (or today if invalid/empty)
  useEffect(() => {
    let initialYear = 1405;
    let initialMonth = 4;
    
    if (value && /^\d{4}\/\d{2}\/\d{2}$/.test(value)) {
      const parts = value.split('/');
      initialYear = parseInt(parts[0]);
      initialMonth = parseInt(parts[1]);
    } else {
      const today = getTodayShamsi();
      const parts = today.split('/');
      initialYear = parseInt(parts[0]);
      initialMonth = parseInt(parts[1]);
    }
    
    setCurrentYear(initialYear);
    setCurrentMonth(initialMonth);
  }, [value, isOpen]);

  // Handle outside click to close calendar
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDaySelect = (day: number) => {
    const formattedMonth = String(currentMonth).padStart(2, '0');
    const formattedDay = String(day).padStart(2, '0');
    const newVal = `${currentYear}/${formattedMonth}/${formattedDay}`;
    onChange(newVal);
    setIsOpen(false);
  };

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentYear(parseInt(e.target.value));
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentMonth(parseInt(e.target.value));
  };

  // Generate calendar grid
  const daysInMonth = getJalaliMonthDays(currentYear, currentMonth);
  const startOffset = getShamsiWeekDayOfFirst(currentYear, currentMonth);

  const daysGrid: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) {
    daysGrid.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    daysGrid.push(d);
  }

  // Generate years list for select
  const yearOptions: number[] = [];
  const baseYear = 1405; // around 2026
  for (let y = baseYear - 10; y <= baseYear + 10; y++) {
    yearOptions.push(y);
  }

  // Parse current today shamsi to match easily
  const todayStr = getTodayShamsi();

  // Helper to determine active day
  const isSelectedDay = (day: number) => {
    if (!value) return false;
    const parts = value.split('/');
    return (
      parseInt(parts[0]) === currentYear &&
      parseInt(parts[1]) === currentMonth &&
      parseInt(parts[2]) === day
    );
  };

  const isTodayDay = (day: number) => {
    const parts = todayStr.split('/');
    return (
      parseInt(parts[0]) === currentYear &&
      parseInt(parts[1]) === currentMonth &&
      parseInt(parts[2]) === day
    );
  };

  return (
    <div ref={containerRef} className={`relative select-none w-full ${className}`} id="shamsi-datepicker-container">
      {label && (
        <label className="block text-xs font-semibold text-slate-500 mb-1.5" id="shamsi-datepicker-label">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          required={required}
          value={value}
          placeholder={placeholder}
          pattern="\d{4}/\d{2}/\d{2}"
          title="فرمت مجاز: YYYY/MM/DD (مثال: ۱۴۰۵/۰۴/۱۴)"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          className={compact 
            ? "w-full border border-slate-200 rounded pl-7 pr-1.5 py-1 text-xs text-center font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none bg-emerald-50/10 focus:bg-white"
            : "w-full border border-slate-200 rounded-lg pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
          }
          id="shamsi-datepicker-input"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={compact
            ? "absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 outline-none"
            : "absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 outline-none"
          }
          id="shamsi-datepicker-toggle-btn"
        >
          <CalendarIcon className={compact ? "w-3.5 h-3.5" : "w-4.5 h-4.5"} />
        </button>
      </div>

      {isOpen && (
        <div 
          className="absolute left-0 mt-1.5 w-[280px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 animate-in fade-in-50 slide-in-from-top-1 duration-150"
          id="shamsi-datepicker-popover"
        >
          {/* Header selectors */}
          <div className="flex items-center justify-between mb-3 gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 hover:bg-slate-50 rounded-lg text-slate-500 transition-colors"
            >
              <ChevronRight className="w-4 h-4" /> {/* In RTL, ChevronRight moves to the previous month (earlier time) */}
            </button>

            <div className="flex items-center gap-1">
              {/* Month Dropdown */}
              <select
                value={currentMonth}
                onChange={handleMonthChange}
                className="text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {name}
                  </option>
                ))}
              </select>

              {/* Year Dropdown */}
              <select
                value={currentYear}
                onChange={handleYearChange}
                className="text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-slate-100 transition-colors font-mono"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 hover:bg-slate-50 rounded-lg text-slate-500 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> {/* In RTL, ChevronLeft moves to the next month (later time) */}
            </button>
          </div>

          {/* Weekday headers starting from Saturday */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {WEEKDAY_NAMES_SHORT.map((name, idx) => (
              <span
                key={idx}
                className={`text-[11px] font-bold py-1 ${idx === 6 ? 'text-red-500' : 'text-slate-400'}`}
              >
                {name}
              </span>
            ))}
          </div>

          {/* Calendar days grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {daysGrid.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="h-7 w-7" />;
              }

              const isSelected = isSelectedDay(day);
              const isToday = isTodayDay(day);
              const isFriday = idx % 7 === 6;

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  onClick={() => handleDaySelect(day)}
                  className={`
                    h-7 w-7 rounded-full text-xs font-medium flex items-center justify-center transition-all outline-none font-mono
                    ${isSelected 
                      ? 'bg-sky-500 text-white font-bold shadow-md shadow-sky-500/20' 
                      : isToday 
                        ? 'bg-slate-100 text-slate-900 border border-slate-300 font-bold' 
                        : isFriday
                          ? 'hover:bg-red-50 text-red-500 font-semibold'
                          : 'hover:bg-slate-50 text-slate-700'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today Button footer */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                onChange(todayStr);
                setIsOpen(false);
              }}
              className="text-[11px] font-bold text-sky-500 hover:text-sky-600 transition-colors px-2 py-1 rounded-md hover:bg-sky-50"
            >
              امروز
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
