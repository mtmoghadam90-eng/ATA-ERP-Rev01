import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Bell, Calendar, User, CheckCircle2, Clock } from 'lucide-react';
import { Task } from '../types';

interface TaskCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  currentUser?: { fullName: string; role?: string } | null;
}

const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد',
  'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر',
  'دی', 'بهمن', 'اسفند'
];

export default function TaskCalendarModal({ isOpen, onClose, tasks, onUpdateTask, currentUser }: TaskCalendarModalProps) {
  // We can default to Tir 1405 (since current local time is 2026-07 which corresponds to mid-1405)
  // Let's dynamically detect current shamsi month if possible, otherwise default to Tir 1405 (Month index 3, which is month 4 'تیر')
  const [currentYear, setCurrentYear] = useState(1405);
  const [currentMonthIndex, setCurrentMonthIndex] = useState(3); // index 3 is 'تیر' (Month 4)
  const [selectedDay, setSelectedDay] = useState<number | null>(20); // default to 20

  if (!isOpen) return null;

  // Filter tasks to show only the ones assigned to the current user or unassigned (personal)
  const myTasks = tasks.filter(t => !t.assignedTo || t.assignedTo === currentUser?.fullName);

  // Determine number of days in selected month
  const getDaysInMonth = (monthIndex: number, year: number) => {
    const monthNum = monthIndex + 1;
    if (monthNum <= 6) return 31;
    if (monthNum <= 11) return 30;
    // Esfand is 29, but let's check leap year (simple 4-year cycle approximation for shamsi)
    const isLeap = (year - 1309) % 4 === 0; // standard simple shamsi leap rule
    return isLeap ? 30 : 29;
  };

  const totalDays = getDaysInMonth(currentMonthIndex, currentYear);
  const monthName = MONTH_NAMES[currentMonthIndex];

  // Navigate months
  const handlePrevMonth = () => {
    if (currentMonthIndex === 0) {
      setCurrentMonthIndex(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonthIndex(prev => prev - 1);
    }
    setSelectedDay(1); // Reset selected day to first of month
  };

  const handleNextMonth = () => {
    if (currentMonthIndex === 11) {
      setCurrentMonthIndex(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonthIndex(prev => prev + 1);
    }
    setSelectedDay(1); // Reset selected day to first of month
  };

  // Get tasks for a specific year, month, and day
  const getTasksForDay = (d: number) => {
    const targetDateStr = `${currentYear}/${String(currentMonthIndex + 1).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    return myTasks.filter(t => t.dueDate === targetDateStr);
  };

  // Select priority dot color
  const getDotColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'فوری': return 'bg-rose-500';
      case 'بالا': return 'bg-amber-500';
      case 'متوسط': return 'bg-sky-500';
      default: return 'bg-slate-400';
    }
  };

  const selectedDayTasks = selectedDay ? getTasksForDay(selectedDay) : [];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-4xl overflow-hidden animate-scale-in flex flex-col md:flex-row max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)]">
        
        {/* Main Calendar Panel */}
        <div className="flex-1 p-5 sm:p-6 flex flex-col border-b md:border-b-0 md:border-l border-slate-100 overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="bg-sky-50 p-2 rounded-xl text-sky-600">
                <Calendar size={20} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-base">تقویم پیگیری و وظایف</h3>
                <p className="text-xs text-slate-500">کارهای ثبت شده روزانه را پیگیری کنید</p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 p-1 rounded-xl">
              <button 
                onClick={handlePrevMonth}
                className="p-1 hover:bg-white hover:shadow-xs rounded-lg text-slate-600 transition"
                title="ماه قبل"
              >
                <ChevronRight size={18} />
              </button>
              <span className="text-xs font-bold text-slate-800 px-3 min-w-[100px] text-center font-sans">
                {monthName} {currentYear}
              </span>
              <button 
                onClick={handleNextMonth}
                className="p-1 hover:bg-white hover:shadow-xs rounded-lg text-slate-600 transition"
                title="ماه بعد"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
          </div>

          {/* Legend (Above the grid) */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500 pb-3 mb-3 border-b border-slate-100 shrink-0 justify-center sm:justify-start">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
              <span>فوری (Urgent)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              <span>اولویت بالا</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
              <span>اولویت متوسط</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
              <span>اولویت پایین</span>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-500 mb-2">
            <div>شـنبہ</div>
            <div>۱شـنبہ</div>
            <div>۲شـنبہ</div>
            <div>۳شـنبہ</div>
            <div>۴شـنبہ</div>
            <div>۵شـنبہ</div>
            <div>جمـعہ</div>
          </div>

          <div className="grid grid-cols-7 gap-2 min-h-[240px] sm:min-h-[280px]">
            {Array.from({ length: totalDays }).map((_, index) => {
              const dayNum = index + 1;
              const dayTasks = getTasksForDay(dayNum);
              const isSelected = selectedDay === dayNum;
              const hasTasks = dayTasks.length > 0;

              return (
                <button
                  key={dayNum}
                  onClick={() => setSelectedDay(dayNum)}
                  className={`relative p-2.5 rounded-xl border flex flex-col justify-between items-center transition min-h-[50px] sm:min-h-[64px] hover:border-sky-300 group ${
                    isSelected 
                      ? 'border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-500/10' 
                      : hasTasks 
                        ? 'border-slate-200 bg-slate-50/50 text-slate-800 hover:bg-slate-50' 
                        : 'border-slate-100 bg-white text-slate-700 hover:bg-slate-50/50'
                  }`}
                >
                  <span className={`text-xs font-bold font-mono ${isSelected ? 'text-white' : 'text-slate-700 group-hover:text-sky-600'}`}>
                    {dayNum}
                  </span>

                  {/* Tasks count indicator / Priority dots */}
                  {hasTasks && (
                    <div className="flex flex-wrap gap-1 mt-1.5 justify-center max-w-full">
                      {/* Show priority dots up to 3 */}
                      {dayTasks.slice(0, 3).map((t, idx) => (
                        <span 
                          key={t.id || idx} 
                          className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : getDotColor(t.priority)}`}
                          title={t.title}
                        />
                      ))}
                      {dayTasks.length > 3 && (
                        <span className={`text-[8px] leading-none font-bold ${isSelected ? 'text-white' : 'text-sky-600'}`}>
                          +{dayTasks.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Day Details Panel */}
        <div className="w-full md:w-80 bg-slate-50 p-5 sm:p-6 flex flex-col justify-between overflow-y-auto max-h-[300px] md:max-h-none">
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 mb-4">
              <div className="text-right">
                <span className="text-xs text-slate-400 font-semibold block">کارهای زمان‌بندی شده</span>
                <span className="text-sm font-bold text-slate-700 font-sans">
                  {selectedDay ? `${selectedDay} ${monthName} ${currentYear}` : 'انتخاب روز'}
                </span>
              </div>
              <button 
                onClick={onClose} 
                className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition shrink-0 md:hidden"
                title="بستن"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tasks list */}
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {selectedDayTasks.length > 0 ? (
                selectedDayTasks.map(t => (
                  <div key={t.id} className="bg-white rounded-xl border border-slate-200/60 p-3.5 space-y-2 hover:shadow-xs transition text-right">
                    <div className="flex items-start gap-2 justify-between">
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border leading-none ${
                        t.priority === 'فوری' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                        t.priority === 'بالا' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                        t.priority === 'متوسط' ? 'bg-sky-50 text-sky-700 border-sky-100' :
                        'bg-slate-50 text-slate-600 border-slate-100'
                      }`}>
                        {t.priority}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none ${
                        t.status === 'انجام شده' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                        t.status === 'در حال انجام' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                        'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {t.status}
                      </span>
                    </div>

                    <h4 className="font-bold text-xs text-slate-800 leading-snug">
                      {t.title}
                    </h4>

                    {t.description && (
                      <p className="text-[10px] text-slate-500 line-clamp-2">
                        {t.description}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 text-[9px] text-slate-400 border-t border-slate-50 pt-2 mt-1">
                      <div className="flex items-center gap-1">
                        <User size={10} />
                        <span>{t.assignedTo || 'شخصی (بدون ارجاع)'}</span>
                      </div>
                      {t.reminderEnabled && (
                        <div className="flex items-center gap-1 text-amber-600">
                          <Bell size={10} className="animate-pulse" />
                          <span>یادآور: {t.reminderTime}</span>
                        </div>
                      )}
                    </div>

                    {/* Inline Status Changer */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 mt-1 bg-slate-50/50 p-1.5 rounded-lg border border-slate-200/40">
                      <label className="text-[9px] font-bold text-slate-500">تغییر وضعیت:</label>
                      <select
                        value={t.status}
                        onChange={(e) => onUpdateTask({ ...t, status: e.target.value as Task['status'] })}
                        className="text-[10px] bg-white hover:bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-medium text-slate-700 outline-none cursor-pointer"
                      >
                        <option value="در حال انجام">در حال انجام</option>
                        <option value="انجام شده">انجام شده</option>
                        <option value="کنسل شده">کنسل شده</option>
                      </select>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 text-slate-400 text-xs">
                  <Clock className="mx-auto text-slate-300 mb-2" size={32} />
                  هیچ کاری برای این تاریخ ثبت نشده است.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200/60 hidden md:block">
            <button
              onClick={onClose}
              className="w-full py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition"
            >
              بستن تقویم پیگیری
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
