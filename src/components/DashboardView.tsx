import React, { useState } from 'react';
import { 
  FileText, 
  ArrowUpRight, 
  FileSpreadsheet, 
  Clock,
  Briefcase,
  ChevronLeft,
  Activity,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  Legend, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid 
} from 'recharts';
import { Task, User, ERPSettings } from '../types';
import { canSeeCosts } from '../utils/permissions';
import CustomerValueMatrix from './CustomerValueMatrix';
import { getTodayShamsi, toShamsiStr } from '../dateUtils';
import { ApiError } from '../api/client';
import { useDashboard } from '../api/dashboard';
import { useExchangeRates } from '../api/exchangeRates';
import { inboxApi, ReferralRow } from '../api/inbox';
import { useRevalidate } from '../api/liveData';
import { rowToTask, tasksApi } from '../api/tasks';
import type { TaskRow } from '../api/tasks';
import { formatMoney } from '../numUtils';
import AssistantPanel from './AssistantPanel';

/**
 * The front page.
 *
 * Every figure here is counted by the server in one request. This screen used
 * to receive eight whole collections as props — every customer, product,
 * project, proforma, order, transaction, task and category group — purely so it
 * could reduce them to about a dozen numbers.
 */
interface DashboardViewProps {
  setActiveTab: (tab: string) => void;
  currentUser: User | null;
  /** Only for the value matrix's quadrant lines, which are the thresholds. */
  settings?: ERPSettings;
}

const COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

export default function DashboardView({
  setActiveTab,
  currentUser,
  settings,
}: DashboardViewProps) {

  // State to filter tasks list between "My Tasks" and "All Tasks"
  const [taskFilter, setTaskFilter] = useState<'my' | 'all'>('my');

  const { summary, loading, error, reload } = useDashboard();
  const { rates: exchangeRates } = useExchangeRates();

  /** Timestamps arrive as datetimes, not the Shamsi strings the store kept. */
  const shamsi = (iso: string | undefined | null) => (iso ? toShamsiStr(new Date(iso)) : '');

  /* The two lists the page shows, each a small query rather than a whole
     collection filtered in the browser: the tasks still open, and the referrals
     waiting on this user. */
  const [tasks, setTasks] = useState<Task[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);

  const loadLists = React.useCallback(async (signal?: AbortSignal) => {
    const [taskPage, referralPage] = await Promise.all([
      tasksApi.list({
        status: 'در حال انجام', pageSize: 50,
        sort: 'dueDate', order: 'asc',
      }, signal),
      inboxApi.referrals({ scope: 'toMe', pageSize: 20, sort: 'createdAt', order: 'desc' }, signal),
    ]);
    setTasks(taskPage.rows.map((row: TaskRow) => rowToTask(row)));
    setReferrals(referralPage.rows);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    loadLists(controller.signal).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // The headline figures still render; the lists simply stay empty.
      console.warn('dashboard lists failed to load', err);
    });
    return () => controller.abort();
  }, [loadLists]);

  // The two lists below the figures are other people's work — tasks assigned
  // and referrals sent. `useDashboard` keeps the figures current; this keeps
  // the lists beside them in step rather than a refresh behind.
  useRevalidate(["tasks", "referrals", "activities"], () => {
    void loadLists().catch(() => { /* the lists keep what they had */ });
  });

  /* The headline figures, all computed by the server. Currency conversion and
     the won-proportion rule went with them — they were duplicated here from the
     proforma module, and a copy of a rule drifts. */
  const totalRevenue = Number(summary.revenue.wonRial);
  const activeProformasValue = Number(summary.revenue.activeRial);
  const activeProformas = { length: summary.revenue.activeCount };

  // Referrals still waiting on this user, already scoped by the server.
  const myReferrals = referrals
    .filter(r => r.status !== 'انجام شده')
    .map(r => ({
      activityId: r.activity?.id ?? r.activityId,
      text: r.activity?.text ?? '',
      createdAt: r.createdAt,
      referral: {
        actionRequired: r.actionRequired ?? '',
        status: r.status,
        assignedBy: r.assignedByName ?? '',
        assignedTo: r.assignedToName ?? '',
      },
      groupName: r.activity?.group?.categoryName ?? 'بدون دسته‌بندی',
      projectId: r.activity?.group?.project?.id ?? '',
      projectName: r.activity?.group?.project?.name ?? 'پروژه نامشخص',
    }));

  const myActiveTasks = tasks.filter(t =>
    (!t.assignedTo || t.assignedTo === currentUser?.fullName) &&
    t.status === 'در حال انجام'
  );

  const projectChartData = summary.projectsByStatus.map(s => ({
    name: s.status,
    value: s.count
  }));

  const categoryChartData = summary.revenueByCategory.map(c => {
    // Get clean name without the code prefix if present
    const cleanName = c.category.includes(' - ') ? c.category.split(' - ')[1] : c.category;
    return {
      name: cleanName,
      فروش: Math.round(Number(c.rial) / 10000000) // in Millions of Tomans
    };
  });

  // Format IRR Currency helper
  // Latin, like every other amount; only the unit stays Persian prose.
  const formatToman = (num: number) =>
    `${formatMoney(Math.round(num / 10_000_000))} میلیون تومان`;

  const getPriorityBadgeClass = (priority: Task['priority']) => {
    switch (priority) {
      case 'فوری': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'بالا': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'متوسط': return 'bg-blue-50 text-blue-700 border-blue-200';
      default: return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const handleToggleTaskStatus = async (task: Task) => {
    const nextStatus = task.status === 'انجام شده' ? 'در حال انجام' : 'انجام شده';
    try {
      await tasksApi.update(task.id, { status: nextStatus });
      await loadLists();
      await reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'تغییر وضعیت وظیفه با خطا مواجه شد.');
    }
  };

  // Filter tasks for the actions checklist
  const displayedTasks = tasks
    .filter(t => t.status === 'در حال انجام')
    .filter(t => taskFilter === 'all' || !t.assignedTo || t.assignedTo === currentUser?.fullName)
    .sort((a, b) => {
      // Prioritize urgent tasks
      const priorityWeight = { 'فوری': 4, 'بالا': 3, 'متوسط': 2, 'پایین': 1 };
      return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
    })
    .slice(0, 4);

  return (
    <div className="space-y-6 animate-fade-in bg-slate-50/50 p-2 md:p-4 rounded-3xl" dir="rtl">

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-2xl p-4 flex items-center justify-between gap-3" id="dashboard-error">
          <span className="flex items-center gap-1.5">
            <AlertCircle size={14} />
            {error}
          </span>
          <button
            type="button"
            onClick={reload}
            className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-[11px] font-bold transition"
          >
            تلاش دوباره
          </button>
        </div>
      )}

      {loading && summary.revenue.totalCount === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4 text-center text-xs text-slate-400 shadow-sm" id="dashboard-loading">
          در حال دریافت اطلاعات پیشخوان…
        </div>
      )}

      {/* 1. Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-950 p-6 md:p-8 rounded-3xl text-white shadow-xl border border-slate-800">
        <div className="absolute right-0 top-0 -mt-12 -mr-12 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute left-12 bottom-0 -mb-16 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-xs font-semibold border border-indigo-500/20">
              <Activity size={12} className="animate-pulse" />
              سامانه جامع ارشیا ERP
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              {currentUser ? `سلام، جناب آقای ${currentUser.fullName} عزیز` : 'پیشخوان مدیریت منابع (ERP)'}
            </h1>
            <p className="text-slate-300 text-sm max-w-xl font-normal leading-relaxed">
              خوش آمدید. آخرین وضعیت پرونده‌های بازرگانی، زنجیره تأمین تجهیزات، و ارجاعات کارگاهی شما در یک نگاه آماده است.
            </p>
          </div>
          
          <div className="flex items-center gap-4 bg-white/5 backdrop-blur-md p-4 rounded-2xl border border-white/10 shrink-0">
            <div className="text-right">
              <p className="text-xs text-slate-400 font-semibold">تاریخ امروز سیستم</p>
              <p className="text-base font-extrabold text-white font-mono mt-0.5">{getTodayShamsi()}</p>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <button 
              onClick={() => setActiveTab('proformas')}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-blue-500/20 flex items-center gap-1.5"
            >
              <FileText size={14} />
              صدور پیش‌فاکتور جدید
            </button>
          </div>
        </div>
      </div>

      {/*
        The assistant, directly under the banner.

        It draws nothing at all for an account without the permission — the
        panel asks the server whether it is allowed before it renders, so this
        is not a hidden-but-present control.
      */}
      <AssistantPanel />

      {/* 2. Top Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Metric 1: Total Won Value */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between hover:shadow-md transition">
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400 font-bold block">مجموع قراردادهای برنده</span>
            <span className="text-lg font-black text-slate-800 block">
              {totalRevenue > 0 ? formatToman(totalRevenue) : "0 ریال"}
            </span>
            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
              <ArrowUpRight size={12} /> {summary.revenue.activeCount === 0 && totalRevenue === 0 ? "بدون پیش‌فاکتور برنده" : "ارزش قراردادهای برنده"}
            </span>
          </div>
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-lg font-black shadow-sm">
            ✓
          </div>
        </div>

        {/* Metric 2: Active Quotations */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between hover:shadow-md transition">
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400 font-bold block">پیشنهادهای جاری فعال</span>
            <span className="text-lg font-black text-slate-800 block">
              {formatToman(activeProformasValue)}
            </span>
            <span className="text-[10px] text-blue-600 font-bold flex items-center gap-1">
              <Clock size={12} /> {activeProformas.length} پیش‌فاکتور معلق
            </span>
          </div>
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-lg font-black shadow-sm">
            ⌛
          </div>
        </div>

        {/* Metric 3: Active Referrals */}
        <div 
          onClick={() => setActiveTab('referrals')}
          className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between hover:shadow-md transition cursor-pointer group"
        >
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400 font-bold block group-hover:text-indigo-600 transition">ارجاعات فعال من</span>
            <span className="text-lg font-black text-slate-800 block font-mono">
              {myReferrals.length} ارجاع باز
            </span>
            <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
              📥 نیازمند بررسی و پاسخ سریع
            </span>
          </div>
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-lg font-black shadow-sm group-hover:bg-indigo-100 transition">
            📥
          </div>
        </div>

        {/* Metric 4: User Active Tasks */}
        <div 
          onClick={() => setActiveTab('tasks')}
          className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between hover:shadow-md transition cursor-pointer group"
        >
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400 font-bold block group-hover:text-amber-600 transition">اقدامات در دست اقدام من</span>
            <span className="text-lg font-black text-slate-800 block font-mono">
              {myActiveTasks.length} تسک فعال
            </span>
            <span className="text-[10px] text-amber-600 font-bold flex items-center gap-1">
              📝 کارهای محول‌شده به شما
            </span>
          </div>
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center text-lg font-black shadow-sm group-hover:bg-amber-100 transition">
            📝
          </div>
        </div>

      </div>

      {/* 3. Main Row: Sales & Exchange Rates */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Sales by Category (Col-span 8) */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="space-y-0.5">
              <h2 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
                <span>📊</span> سهم فروش قطعی بر اساس دسته‌بندی تجهیزات
              </h2>
              <p className="text-[11px] text-slate-400">حجم ریالی فاکتورهای برنده ابزاردقیق به تفکیک ردیف‌های کالا (میلیون تومان)</p>
            </div>
            <button 
              onClick={() => setActiveTab('products')}
              className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1"
            >
              مشاهده انبار
              <ChevronLeft size={14} />
            </button>
          </div>
          
          <div className="p-6 flex-1 flex flex-col justify-center min-h-[280px]">
            {categoryChartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 10, fill: '#64748b' }} 
                      axisLine={false} 
                      tickLine={false} 
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: '#64748b' }} 
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip 
                      formatter={(value) => [`${formatMoney(Number(value))} میلیون تومان`, 'حجم سفارش']}
                      contentStyle={{  borderRadius: '12px', border: '1px solid #e2e8f0', fontFamily: 'inherit' }}
                    />
                    <Bar dataKey="فروش" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                <AlertCircle size={32} className="text-slate-300 mb-2" />
                <p className="text-xs">هیچ پیش‌فاکتور برنده شده‌ای جهت تفکیک وجود ندارد.</p>
              </div>
            )}
          </div>
        </div>

        {/* Currency Rates Reference (Col-span 4) */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="border-b border-slate-100 pb-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <span>🪙</span> نرخ ارز استعلامی و مبادلات
              </h3>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">ریال ایران</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">مبنای صدور پیش‌فاکتورهای ارزی و ارزیابی پروفرمای خارجی</p>
          </div>
          
          <div className="my-4 divide-y divide-slate-100 flex-1 overflow-auto max-h-64">
            {exchangeRates.map((rate) => (
              <div key={rate.id} className="py-3 flex justify-between items-center hover:bg-slate-50/50 px-1 rounded-xl transition">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shadow-sm font-mono border border-slate-200">
                    {rate.currency}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">{rate.name}</span>
                    <span className="text-[10px] text-slate-400 block font-mono">
                      {rate.lastUpdated ? `بروزرسانی: ${new Date(rate.lastUpdated).toLocaleTimeString('fa-IR', {hour: '2-digit', minute:'2-digit'})}` : 'بدون تاریخ'}
                    </span>
                  </div>
                </div>
                <div className="text-left font-mono">
                  <span className="text-xs font-black text-slate-800">
                    {formatMoney(rate.rateToRIYAL)}
                  </span>
                  <span className="text-[10px] text-slate-400 mr-1">ریال</span>
                </div>
              </div>
            ))}
          </div>

          <button 
            onClick={() => setActiveTab('settings')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 hover:text-blue-600 text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition text-center"
          >
            مشاهده و ویرایش نرخ ارزها ←
          </button>
        </div>

      </div>

      {/* 4. Second Row: Referrals Inbox, Tasks & Project Statuses */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
        
        {/* Referrals Inbox (Col-span 4) */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[360px]">
          <div className="border-b border-slate-100 pb-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>📥</span> کارتابل ارجاعات فعال من
              </h3>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                {myReferrals.length} ارجاع جدید
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">ارجاعات کارگاه‌ها و فعالیت‌ها که نیازمند پاسخ شماست</p>
          </div>

          <div className="my-4 space-y-3 flex-1 overflow-auto max-h-72">
            {myReferrals.slice(0, 3).map((ref) => (
              <div 
                key={ref.activityId} 
                onClick={() => setActiveTab('referrals')}
                className="p-3 bg-indigo-50/30 hover:bg-indigo-50/60 rounded-xl border border-indigo-100/50 flex flex-col gap-2 transition cursor-pointer"
              >
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold text-indigo-800 bg-indigo-100/50 px-2 py-0.5 rounded">
                    {ref.groupName}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono">
                    از طرف: {ref.referral.assignedBy}
                  </span>
                </div>
                <p className="text-xs text-slate-700 font-medium line-clamp-2">{ref.referral.actionRequired}</p>
                <div className="flex justify-between items-center border-t border-indigo-100/20 pt-1.5 mt-1 text-[9px] text-slate-400">
                  <span className="truncate max-w-[150px]">پروژه: {ref.projectName}</span>
                  <span className="font-mono">{shamsi(ref.createdAt)}</span>
                </div>
              </div>
            ))}
            
            {myReferrals.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 py-12">
                <CheckCircle2 size={32} className="text-slate-300 mb-2" />
                <p className="text-xs">هیچ ارجاع معلقی برای شما یافت نشد.</p>
              </div>
            )}
          </div>

          <button 
            onClick={() => setActiveTab('referrals')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition text-center mt-2 shrink-0"
          >
            ورود به کارتابل ارجاعات و کارپوشه ←
          </button>
        </div>

        {/* Tasks List (Col-span 4) */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[360px]">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>⚡</span> وظایف و اقدامات بازرگانی فوری
              </h3>
              <p className="text-xs text-slate-400">تسک‌های کاری فعال در جریان و سررسید پیگیری‌ها</p>
            </div>
            
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button 
                onClick={() => setTaskFilter('my')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition ${taskFilter === 'my' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                من
              </button>
              <button 
                onClick={() => setTaskFilter('all')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition ${taskFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                همه
              </button>
            </div>
          </div>

          <div className="my-4 space-y-3 flex-1 overflow-auto max-h-72">
            {displayedTasks.map((task) => (
              <div 
                key={task.id} 
                className="p-3 bg-slate-50 hover:bg-slate-100/70 rounded-xl border border-slate-100 flex flex-col gap-1.5 transition relative group"
              >
                <div className="flex items-start gap-2 justify-between">
                  <div className="flex items-start gap-2.5">
                    <input 
                      type="checkbox" 
                      checked={task.status === 'انجام شده'}
                      onChange={() => handleToggleTaskStatus(task)}
                      className="mt-1 h-3.5 w-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                      title="تغییر وضعیت تسک"
                    />
                    <div className="space-y-0.5">
                      <span className="text-xs font-extrabold text-slate-800 leading-tight block">{task.title}</span>
                      {task.relatedToName && (
                        <span className="text-[10px] text-slate-400 block">
                          مربوط به: {task.relatedToName} ({task.relatedToType})
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${getPriorityBadgeClass(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>
                
                <div className="flex justify-between items-center text-[9px] text-slate-400 border-t border-dashed border-slate-200/80 pt-1.5 mt-1">
                  <span>مسئول: {task.assignedTo || 'ناشناس'}</span>
                  <span className="font-mono">سررسید: {task.dueDate}</span>
                </div>
              </div>
            ))}
            
            {displayedTasks.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 py-12">
                <CheckCircle2 size={32} className="text-slate-300 mb-2" />
                <p className="text-xs">هیچ تسکی در این بخش وجود ندارد.</p>
              </div>
            )}
          </div>

          <button 
            onClick={() => setActiveTab('tasks')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition text-center shrink-0"
          >
            ورود به بخش برد وظایف ←
          </button>
        </div>

        {/* Project Pipeline Chart (Col-span 4) */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[360px]">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <span>📈</span> پیپ‌لاین پروژه‌ها و فروش
            </h3>
            <p className="text-xs text-slate-400 mt-1">تعداد فرصت‌های ثبت شده به تفکیک مرحله تجاری</p>
          </div>
          
          <div className="h-48 my-4 flex items-center justify-center">
            {projectChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={projectChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={65}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {projectChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value) => [`${value} پروژه`, 'تعداد']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    height={32} 
                    iconSize={8} 
                    iconType="circle" 
                    wrapperStyle={{ fontSize: 9, direction: 'rtl' }} 
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400">اطلاعاتی یافت نشد</p>
            )}
          </div>

          <button 
            onClick={() => setActiveTab('projects')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition text-center shrink-0"
          >
            مدیریت فرصت‌های پروژه‌ای ←
          </button>
        </div>

      </div>

      {/* 5. Dark Row: Periodic Analysis */}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overall Conversion Rate Card */}
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Activity size={20} />
                </div>
                <h3 className="text-base font-bold text-slate-800">نرخ تبدیل کلی پیش‌فاکتورها</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-6">
                درصد پیش‌فاکتورهایی که به قرارداد نهایی (برنده) تبدیل شده‌اند نسبت به کل پیش‌فاکتورهای صادر شده.
              </p>
            </div>
            
            <div className="flex items-end gap-6 pb-2">
              <div className="flex-1 relative h-4 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="absolute top-0 right-0 h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${summary.revenue.winRatePercent}%` }}
                ></div>
              </div>
              <div className="text-4xl font-black text-slate-800 font-mono tracking-tighter">
                {summary.revenue.winRatePercent}<span className="text-xl text-slate-400 font-sans">٪</span>
              </div>
            </div>
            
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100 text-xs font-bold">
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 size={14} />
                <span>برنده: {summary.revenue.wonCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-rose-500">
                <AlertCircle size={14} />
                <span>باخته: {Math.max(0, summary.revenue.totalCount - summary.revenue.wonCount - summary.revenue.activeCount)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <FileText size={14} />
                <span>کل صادر شده: {summary.revenue.totalCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Rate by Category Card */}
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -ml-10 -mt-10 pointer-events-none"></div>
          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Briefcase size={20} />
              </div>
              <h3 className="text-base font-bold text-slate-800">نرخ تبدیل به تفکیک دسته محصول</h3>
            </div>
            
            <div className="flex-1 overflow-auto max-h-[220px] pr-2 space-y-4">
              {(() => {
                // Grouped in SQL: the category lives on the product, not on the
                // line, so this used to need every proforma and every product
                // in the browser to work out.
                const categoryConversionData = summary.conversionByCategory
                  .map(c => ({ name: c.category, conversion: c.percent, total: c.total, won: c.won }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5);

                if (categoryConversionData.length === 0) {
                  return (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-8">
                      <FileSpreadsheet size={32} className="text-slate-300 mb-2 opacity-50" />
                      <p className="text-xs">داده کافی برای نمایش وجود ندارد.</p>
                    </div>
                  );
                }

                return categoryConversionData.map((cat, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-slate-700">{cat.name}</span>
                      <span className="text-slate-500 font-mono">{cat.conversion}٪</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                      <div 
                        className="bg-blue-500 h-2 rounded-full transition-all duration-1000" 
                        style={{ width: `${cat.conversion}%` }}
                      ></div>
                    </div>
                  </div>
                ));
              })()}
            </div>
            
          </div>
        </div>
      </div>

      {/* Customer value: realized against potential, one point per customer. */}
      <CustomerValueMatrix
        settings={settings?.customerValue}
        onOpenCustomer={() => setActiveTab('customers')}
        showCosts={canSeeCosts(currentUser)}
      />

    </div>
  );
}
