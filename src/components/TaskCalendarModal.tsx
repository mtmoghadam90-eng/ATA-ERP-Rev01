import React, { useCallback, useEffect, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Bell, Calendar, User, CheckCircle2, Clock } from 'lucide-react';
import { Task } from '../types';
import { rowToTask, taskToWriteInput, tasksApi } from '../api/tasks';
import { getTodayShamsi } from '../dateUtils';
import { getJalaliMonthDays, getShamsiWeekDayOfFirst } from './ShamsiDatePicker';

/**
 * The month's tasks are loaded here rather than handed in.
 *
 * They used to arrive as `store.tasks`, read from database.json — a store the
 * tasks board stopped writing to when it moved to the API. The calendar was
 * therefore showing whatever the tasks happened to be before the migration, and
 * changing a status from here wrote back to the same dead file.
 *
 * Loading them here also keeps the request bounded: the calendar knows which
 * month it is showing, so it asks for that month rather than for every task.
 */
interface TaskCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: { fullName: string; role?: string } | null;
}

const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد',
  'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر',
  'دی', 'بهمن', 'اسفند'
];

/** Days in a Shamsi month — the date picker's rule, not a second copy of it. */
const getDaysInMonth = (monthIndex: number, year: number) =>
  getJalaliMonthDays(year, monthIndex + 1);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Today, as year / month index / day. */
function todayParts(): { year: number; monthIndex: number; day: number } {
  const [y, m, d] = getTodayShamsi().split('/').map((part) => parseInt(part, 10));
  return { year: y, monthIndex: m - 1, day: d };
}

export default function TaskCalendarModal({ isOpen, onClose, currentUser }: TaskCalendarModalProps) {
  // Opens on today. It used to open on Tir 1405, day 20 — a date hardcoded when
  // the screen was written, which every month since has been wrong.
  const today = todayParts();
  const [currentYear, setCurrentYear] = useState(today.year);
  const [currentMonthIndex, setCurrentMonthIndex] = useState(today.monthIndex);
  const [selectedDay, setSelectedDay] = useState<number | null>(today.day);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Reopening after months of navigating should still land on today.
  useEffect(() => {
    if (!isOpen) return;
    const now = todayParts();
    setCurrentYear(now.year);
    setCurrentMonthIndex(now.monthIndex);
    setSelectedDay(now.day);
  }, [isOpen]);

  // Exactly the month on screen, so the page is bounded by the calendar itself.
  const load = useCallback(async () => {
    const days = getDaysInMonth(currentMonthIndex, currentYear);
    const month = pad2(currentMonthIndex + 1);
    try {
      const result = await tasksApi.list({
        dateFrom: `${currentYear}/${month}/01`,
        dateTo: `${currentYear}/${month}/${pad2(days)}`,
        pageSize: 200,
      });
      setTasks(result.rows.map(rowToTask));
    } catch (err) {
      console.error('Failed to load the calendar month:', err);
    }
  }, [currentYear, currentMonthIndex]);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  /*
   * Setting something for yourself on a day, from the day itself.
   *
   * The calendar could only ever show what had been raised on the tasks board.
   * Picking a date there and typing it again is the long way round when the
   * date is already the thing being pointed at.
   *
   * The assignee is left out on purpose: the server gives an unassigned task to
   * whoever raised it, which is exactly what "for myself" means, and it is one
   * fewer place that has to know the current user's id.
   */
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Task['priority']>('متوسط');
  const [newReminderTime, setNewReminderTime] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedDateStr = selectedDay
    ? `${currentYear}/${pad2(currentMonthIndex + 1)}/${pad2(selectedDay)}`
    : '';

  const createTaskForDay = async () => {
    const title = newTitle.trim();
    if (!title || !selectedDateStr) return;

    setSaving(true);
    try {
      await tasksApi.create({
        title,
        priority: newPriority,
        status: 'در حال انجام',
        dueDate: selectedDateStr,
        assignedToName: currentUser?.fullName ?? null,
        // A time turns it into a reminder on the same day; without one it is
        // simply due that day.
        reminderEnabled: !!newReminderTime,
        reminderDate: newReminderTime ? selectedDateStr : null,
        reminderTime: newReminderTime || null,
      });
      setNewTitle('');
      setNewReminderTime('');
      setNewPriority('متوسط');
      await load();
    } catch (err) {
      alert('ثبت وظیفه با خطا مواجه شد.');
      console.error('Failed to create a task from the calendar:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateTaskStatus = async (task: Task, status: Task['status']) => {
    try {
      await tasksApi.update(task.id, taskToWriteInput({ ...task, status }));
      await load();
    } catch (err) {
      alert('ثبت تغییر وضعیت وظیفه با خطا مواجه شد.');
      console.error('Failed to update the task from the calendar:', err);
    }
  };

  if (!isOpen) return null;

  // Filter tasks to show only the ones assigned to the current user or unassigned (personal)
  const myTasks = tasks.filter(t => !t.assignedTo || t.assignedTo === currentUser?.fullName);

  const totalDays = getDaysInMonth(currentMonthIndex, currentYear);
  const monthName = MONTH_NAMES[currentMonthIndex];

  /*
   * Which column the 1st falls in.
   *
   * The grid used to start at the first cell whatever day the month began on,
   * so every date sat under the wrong weekday unless the month happened to
   * start on a Saturday — 12 Mordad 1405 is a Monday and was shown under
   * چهارشنبه. The blanks put the month back under its own weekdays.
   */
  const startOffset = getShamsiWeekDayOfFirst(currentYear, currentMonthIndex + 1);
  const isCurrentMonth =
    currentYear === today.year && currentMonthIndex === today.monthIndex;

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
            {/* Written out properly: these were spelled with an Arabic heh and
                a tatweel, which renders as a different letter in Persian. */}
            {['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'].map((name, idx) => (
              <div key={name} className={idx === 6 ? 'text-rose-500' : undefined}>{name}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2 min-h-[240px] sm:min-h-[280px]">
            {Array.from({ length: startOffset }).map((_, index) => (
              <div key={`lead-${index}`} className="min-h-[50px] sm:min-h-[64px]" />
            ))}
            {Array.from({ length: totalDays }).map((_, index) => {
              const dayNum = index + 1;
              const dayTasks = getTasksForDay(dayNum);
              const isSelected = selectedDay === dayNum;
              const isToday = isCurrentMonth && dayNum === today.day;
              const hasTasks = dayTasks.length > 0;

              return (
                <button
                  key={dayNum}
                  onClick={() => setSelectedDay(dayNum)}
                  className={`relative p-2.5 rounded-xl border flex flex-col justify-between items-center transition min-h-[50px] sm:min-h-[64px] hover:border-sky-300 group ${
                    isSelected 
                      ? 'border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-500/10' 
                      : isToday
                        ? 'border-sky-400 bg-sky-50/60 text-slate-800'
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
                        onChange={(e) => { void updateTaskStatus(t, e.target.value as Task['status']); }}
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

          {/* Add a task or reminder on the day that is selected. */}
          {selectedDay && (
            <div className="mt-4 pt-4 border-t border-slate-200/60 space-y-2">
              <span className="text-[11px] font-bold text-slate-600 block">
                ثبت کار یا یادآوری برای {selectedDay} {monthName}
              </span>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createTaskForDay(); }}
                placeholder="مثلاً: تماس با کارفرما بابت تأییدیه نقشه"
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white outline-none focus:border-sky-500 text-right"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as Task['priority'])}
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white outline-none focus:border-sky-500"
                >
                  <option value="پایین">پایین</option>
                  <option value="متوسط">متوسط</option>
                  <option value="بالا">بالا</option>
                  <option value="فوری">فوری</option>
                </select>
                <input
                  type="time"
                  value={newReminderTime}
                  onChange={(e) => setNewReminderTime(e.target.value)}
                  title="ساعت یادآوری (اختیاری)"
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white outline-none focus:border-sky-500 font-mono"
                  dir="ltr"
                />
              </div>
              <button
                type="button"
                onClick={() => { void createTaskForDay(); }}
                disabled={!newTitle.trim() || saving}
                className="w-full py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition"
              >
                {saving ? 'در حال ثبت…' : 'ثبت برای این روز'}
              </button>
            </div>
          )}

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
