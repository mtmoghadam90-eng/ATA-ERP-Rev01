import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  User, 
  Calendar,
  X,
  CheckCircle2,
  ListTodo,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff
} from 'lucide-react';
import { Task, Customer, Project, ERPSettings } from '../types';
import type { User as AppUser } from '../types';
import { getTodayShamsi } from '../dateUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk, getFieldAsterisk } from '../utils/requiredFields';
import ShamsiDatePicker from './ShamsiDatePicker';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import QuickAddModal from './QuickAddModal';
import { Bell, Loader2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { rowToTask, tasksApi, taskToWriteInput } from '../api/tasks';
import { useTaskList } from '../api/useTaskList';
import { useUserDirectory } from '../api/useUserDirectory';
import { useEntitySearch } from '../api/useEntitySearch';
import type { CustomerRow } from '../api/customers';
import type { ProjectRow } from '../api/projects';
import { projectsApi } from '../api/projects';
import { createCustomerWithLinks } from '../api/customerAdapter';
import { detailToProject, projectToWriteInput } from '../api/projectAdapter';

/**
 * Tasks board.
 *
 * Reads through the API, scoped by assignment: a user without the tasks
 * permission sees the tasks assigned to them. "Overdue" is resolved in the
 * query against today's Shamsi date, so the count describes the result rather
 * than the page.
 */
interface TasksViewProps {
  settings: ERPSettings;
  /*
   * The whole user, not just a name.
   *
   * The board's «همه وظایف» tab is offered only to somebody who actually holds
   * `tasksAll`, and that is read strictly — a tab that returns your own tasks
   * under the heading «همه» is worse than no tab at all.
   */
  currentUser?: AppUser | null;
}

export default function TasksView({
  settings,
  currentUser,
}: TasksViewProps) {
  // Declared before the pickers below, which are disabled while it is closed.
  const [showModal, setShowModal] = useState(false);
  const list = useTaskList();
  const search = list.search;
  const setSearch = list.setSearch;

  /** The page of tasks, in the shape this screen's markup expects. */
  const tasks = React.useMemo(() => list.rows.map(rowToTask), [list.rows]);

  const { users } = useUserDirectory();

  /**
   * Customers and projects for the "related to" picker, searched on the server.
   * Only while the form is open, so a closed modal does not query behind it.
   */
  const customerPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers', limit: 25, enabled: showModal,
    getLabel: (row) => row.companyName,
  });
  const projectPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects', limit: 25, enabled: showModal,
    params: { withSummary: 'false' },
    getLabel: (row) => row.name,
  });

  const customers = customerPicker.matches as unknown as Customer[];
  const projects = projectPicker.matches as unknown as Project[];

  /** Reports a failed call using the server's own Persian sentence. */
  const reportError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      alert(err.message);
      return;
    }
    // Not a refusal from the server: a bug on this side, and until now it read
    // exactly like one — the same generic sentence, with the real cause only in
    // a console nobody has open. The detail goes on the alert too.
    console.error(fallback, err);
    alert(`${fallback}\n\n${(err as Error)?.message ?? String(err)}`);
  };

  /**
   * Quick-add helpers for the "related to" picker.
   *
   * These used to be store methods handed down from `App`. App stopped passing
   * them when the store was emptied, so both were `undefined` — and since the
   * buttons render only when the prop is there, the quick-add buttons on this
   * screen simply were not on the page. They call the API directly now, as the
   * other screens do.
   */
  const addCustomer = async (customer: Partial<Customer>) => {
    try {
      return await createCustomerWithLinks(customer);
    } catch (err) {
      reportError(err, 'ثبت مشتری با خطا مواجه شد.');
      return null;
    }
  };

  const addProject = async (project: Partial<Project>) => {
    try {
      return detailToProject(await projectsApi.create(projectToWriteInput(project as any)));
    } catch (err) {
      reportError(err, 'ثبت پروژه با خطا مواجه شد.');
      return null;
    }
  };

  const addTask = async (task: Partial<Task>) => {
    try {
      await tasksApi.create(taskToWriteInput(task));
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت وظیفه با خطا مواجه شد.');
    }
  };

  const updateTask = async (task: Task) => {
    try {
      await tasksApi.update(task.id, taskToWriteInput(task));
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت تغییرات وظیفه با خطا مواجه شد.');
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await tasksApi.remove(id);
      list.refresh();
    } catch (err) {
      reportError(err, 'حذف وظیفه با خطا مواجه شد.');
    }
  };

  const selectedPriority = list.filters.priority;
  const setSelectedPriority = (value: string) => list.setFilter('priority', value);
  /*
   * Filtered on the server, like the priority beside it.
   *
   * The list is paged, so narrowing what the browser happens to be holding
   * would filter one page and call it the answer — «انجام نشده» would show
   * whatever open tasks were on page one and nothing else.
   */
  const selectedStatus = list.filters.status;
  const setSelectedStatus = (value: string) => list.setFilter('status', value);

  // The declutter toggle. The server drops the completed rows from the query,
  // so this is only what the button draws.
  const hideCompleted = list.filters.hideCompleted;

  /*
   * Which half of the board — the same two questions the referrals inbox asks.
   *
   * The screen used to show every task in the company to anybody who could open
   * it, because the module permission was doing double duty: «may see this
   * screen» and «may see everyone's work» were the same flag, and an absent
   * flag reads as granted. The scope is enforced on the server; this only picks
   * between the halves the caller is already allowed.
   *
   * «همه» is offered only to somebody who actually holds `tasksAll` — a tab
   * that returns your own tasks under the heading «همه» is worse than no tab.
   */
  const selectedScope = list.filters.scope;
  const canSeeEveryTask = !!currentUser?.isSystemAdmin
    || currentUser?.permissions?.tasksAll === true;
  const [isTaskModalFullscreen, setIsTaskModalFullscreen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [quickAddType, setQuickAddType] = useState<'customer' | 'project' | 'supplier' | 'product' | null>(null);

  // Dynamic Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [relatedToType, setRelatedToType] = useState<Task['relatedToType']>('عمومی');
  const [relatedToId, setRelatedToId] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('متوسط');
  const [dueDate, setDueDate] = useState(getTodayShamsi());
  const [assignedTo, setAssignedTo] = useState('');
  const [status, setStatus] = useState<Task['status']>('در حال انجام');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDate, setReminderDate] = useState(getTodayShamsi());
  const [reminderTime, setReminderTime] = useState('09:00');

  const handleOpenAdd = () => {
    setEditingTask(null);
    setTitle('');
    setDescription('');
    setRelatedToType('عمومی');
    setRelatedToId('');
    setPriority('متوسط');
    setDueDate(getTodayShamsi());
    setAssignedTo('');
    setStatus('در حال انجام');
    setReminderEnabled(false);
    setReminderDate(getTodayShamsi());
    setReminderTime('09:00');
    setCustomValues({});
    setShowModal(true);
  };

  const handleOpenEdit = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description);
    setRelatedToType(task.relatedToType);
    setRelatedToId(task.relatedToId || '');
    setPriority(task.priority);
    setDueDate(task.dueDate);
    setAssignedTo(task.assignedTo || '');
    setStatus(task.status);
    setReminderEnabled(task.reminderEnabled || false);
    setReminderDate(task.reminderDate || getTodayShamsi());
    setReminderTime(task.reminderTime || '09:00');
    setCustomValues(task.customValues || {});
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    if (isFieldRequired(settings, 'tasks', 'title') && !title) {
      alert('فیلد "عنوان وظیفه" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'tasks', 'description') && !description) {
      alert('فیلد "شرح جزئیات" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'tasks', 'priority') && !priority) {
      alert('فیلد "درجه اولویت" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'tasks', 'dueDate') && !dueDate) {
      alert('فیلد "مهلت انجام" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'tasks', 'assignedTo') && !assignedTo) {
      alert('فیلد "ارجاع کار به همکار" الزامی است.');
      return;
    }

    // Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === 'tasks');
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }
    
    let resolvedRelatedName = '';
    if (relatedToType === 'مشتری') {
      resolvedRelatedName = customers.find(c => c.id === relatedToId)?.companyName || '';
    } else if (relatedToType === 'پروژه') {
      resolvedRelatedName = projects.find(p => p.id === relatedToId)?.name || '';
    }

    const taskPayload = {
      title,
      description,
      relatedToType,
      relatedToId: relatedToId || undefined,
      relatedToName: relatedToId ? resolvedRelatedName : undefined,
      priority,
      dueDate,
      assignedTo,
      status,
      customValues,
      reminderEnabled,
      reminderDate: reminderEnabled ? reminderDate : undefined,
      reminderTime: reminderEnabled ? reminderTime : undefined,
    };

    if (editingTask) {
      updateTask({
        id: editingTask.id,
        ...taskPayload
      });
    } else {
      addTask(taskPayload);
    }

    setShowModal(false);
    setIsTaskModalFullscreen(false);
  };

  const handleToggleComplete = (task: Task) => {
    updateTask({
      ...task,
      status: task.status === 'انجام شده' ? 'در حال انجام' : 'انجام شده'
    });
  };

  const getPriorityClass = (pr: Task['priority']) => {
    switch (pr) {
      case 'فوری': return 'bg-red-50 text-red-700 border border-red-200';
      case 'بالا': return 'bg-amber-50 text-amber-700 border border-amber-200';
      case 'متوسط': return 'bg-sky-50 text-sky-700 border border-sky-200';
      default: return 'bg-slate-50 text-slate-600 border border-slate-200';
    }
  };

  const getStatusBadge = (st: Task['status']) => {
    switch (st) {
      case 'انجام شده': return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'در حال انجام': return 'bg-blue-50 text-blue-700 border border-blue-200';
      case 'کنسل شده': return 'bg-slate-100 text-slate-500 border border-slate-200';
      default: return 'bg-amber-50 text-amber-700 border border-amber-200';
    }
  };

  // The server searched, filtered by priority, sorted and paged this already.
  const filteredTasks = tasks;

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">وظایف کاری و پیگیری‌ها</h1>
          <p className="text-slate-500 text-sm mt-1">برنامه‌ریزی، تخصیص کارها و یادآوری اقدامات تجاری و بازرگانی برای اعضای تیم</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center gap-2"
        >
          <Plus size={16} />
          ثبت پیگیری / یادداشت جدید
        </button>
      </div>

      {/* Whose tasks. Enforced on the server; this picks between the halves. */}
      <div className="flex flex-wrap items-center gap-2" id="task-scope-tabs">
        {([
          { key: 'toMe' as const, label: 'به من ارجاع شده' },
          { key: 'fromMe' as const, label: 'من ارجاع دادم' },
          ...(canSeeEveryTask ? [{ key: 'all' as const, label: 'همه وظایف' }] : []),
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => list.setFilter('scope', tab.key)}
            id={`task-scope-${tab.key}`}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-xl border transition ${
              selectedScope === tab.key
                ? 'bg-sky-500 border-sky-500 text-white shadow-sm'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="جستجو در عنوان پیگیری، مخاطب یا شرح وظیفه..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
          />
        </div>

        <div className="relative w-full md:w-52 flex items-center gap-2">
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
          >
            <option value="all">همه اولویت‌ها</option>
            <option value="فوری">فوری</option>
            <option value="بالا">اولویت بالا</option>
            <option value="متوسط">اولویت متوسط</option>
            <option value="پایین">اولویت پایین</option>
          </select>
        </div>

        <div className="relative w-full md:w-52 flex items-center gap-2">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            id="task-status-filter"
            className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="در حال انجام">انجام نشده (در حال انجام)</option>
            <option value="انجام شده">انجام شده</option>
            <option value="کنسل شده">کنسل شده</option>
          </select>
        </div>

        {/*
          «انجام‌شده‌ها را پنهان کن» — declutter, not a filter of its own.

          It is disabled while the dropdown beside it names a status, because
          that is the rule the server applies: an explicit choice wins, and a
          toggle that silently did nothing would read as broken. Pressing it
          re-queries — the board is paged, so hiding rows in the browser would
          empty a page of completed tasks and print the full total under it.
        */}
        <button
          type="button"
          onClick={() => list.setFilter('hideCompleted', !hideCompleted)}
          disabled={selectedStatus !== 'all'}
          title={selectedStatus !== 'all'
            ? 'وضعیت به‌صورت مشخص انتخاب شده است'
            : hideCompleted ? 'نمایش وظایف انجام‌شده' : 'پنهان کردن وظایف انجام‌شده'}
          className={`w-full md:w-auto flex items-center justify-center gap-2 border rounded-lg text-sm py-2 px-3 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
            hideCompleted && selectedStatus === 'all'
              ? 'bg-sky-50 border-sky-500 text-sky-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-sky-500'
          }`}
        >
          {hideCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
          {hideCompleted ? 'نمایش انجام‌شده‌ها' : 'پنهان کردن انجام‌شده‌ها'}
        </button>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredTasks.map((task) => (
          <div 
            key={task.id} 
            className={`bg-white rounded-2xl border p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-sm transition ${
              task.status === 'انجام شده' ? 'border-emerald-100 bg-emerald-50/10' : 'border-slate-100'
            }`}
          >
            <div className="flex items-start gap-3.5 flex-1 w-full">
              {/* Checkbox */}
              <button
                onClick={() => handleToggleComplete(task)}
                className={`mt-1 rounded-md flex items-center justify-center border transition flex-shrink-0 ${
                  task.status === 'انجام شده' 
                    ? 'bg-emerald-500 border-emerald-500 text-white' 
                    : 'border-slate-300 hover:border-sky-500 w-5 h-5'
                }`}
              >
                {task.status === 'انجام شده' && <CheckCircle2 size={14} />}
              </button>
              
              <div className="space-y-1 flex-1 min-w-0">
                <h4 className={`font-bold text-sm leading-snug break-words ${task.status === 'انجام شده' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                  {task.title}
                </h4>
                <p className="text-xs text-slate-500 break-words">{task.description}</p>
                
                {/*
                  The job, not just its label.

                  `relatedToName` is a single string the browser resolved out of
                  a picker's matches when the task was saved. `relatedProject`
                  is the project as it is *now* — code, name and the customer
                  behind it — joined by the server, and it is filled in for a
                  task on a proforma too, since a sales follow-up names a
                  quotation and the reader wants to know whose job it is.
                */}
                {task.relatedProject ? (
                  <span className="text-[10px] text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded font-medium inline-flex flex-wrap items-center gap-1 mt-1 max-w-full">
                    {/*
                      A task attached to a customer has no project behind it, so
                      the code and the name are empty and only the customer is
                      printed — an empty «کد | نام |» would read as a project
                      that does not exist.
                    */}
                    {task.relatedProject.code && (
                      <>
                        <span className="font-mono font-bold">{task.relatedProject.code}</span>
                        <span className="text-sky-300">|</span>
                      </>
                    )}
                    {task.relatedProject.name && (
                      <span className="truncate">{task.relatedProject.name}</span>
                    )}
                    {task.relatedProject.customerName && (
                      <>
                        {task.relatedProject.name && <span className="text-sky-300">|</span>}
                        <span className="truncate text-slate-600">{task.relatedProject.customerName}</span>
                      </>
                    )}
                  </span>
                ) : task.relatedToName && (
                  <span className="text-[10px] text-sky-600 bg-sky-50 px-2 py-0.5 rounded font-medium inline-block mt-1 max-w-full truncate">
                    مربوط به {task.relatedToType}: {task.relatedToName}
                  </span>
                )}

                {/* Dynamic Custom Fields Read-Only View */}
                <CustomFieldsDetailView
                  module="tasks"
                  customFields={settings?.customFields || []}
                  customValues={task.customValues}
                />
              </div>
            </div>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-start md:justify-end text-xs pt-3 md:pt-0 border-t border-slate-100 md:border-t-0">
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${getPriorityClass(task.priority)}`}>
                اولویت: {task.priority}
              </span>

              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${getStatusBadge(task.status)}`}>
                وضعیت: {task.status}
              </span>

              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono bg-slate-50 px-2 py-1 rounded border">
                <Calendar size={12} />
                <span>سررسید: {task.dueDate}</span>
              </div>

              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-sans bg-slate-50 px-2 py-1 rounded border">
                <User size={12} />
                <span>مسئول: {task.assignedTo || 'شخصی (بدون ارجاع)'}</span>
              </div>

              {task.reminderEnabled && (
                <div className="text-[11px] text-amber-700 flex items-center gap-1.5 font-mono bg-amber-50 px-2 py-1 rounded border border-amber-200" title={`یادآور فعال برای ${task.reminderDate} ساعت ${task.reminderTime}`}>
                  <Bell size={12} className="text-amber-500 animate-pulse" />
                  <span>یادآور: {task.reminderDate} {task.reminderTime}</span>
                </div>
              )}

              {/* Edit */}
              <button
                onClick={() => handleOpenEdit(task)}
                className="p-1.5 hover:bg-sky-50 text-slate-400 hover:text-sky-600 rounded-lg transition"
                title="ویرایش وظیفه"
              >
                <Edit size={14} />
              </button>

              {/* Delete */}
              <button
                onClick={() => deleteTask(task.id)}
                className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition"
                title="حذف وظیفه"
              >
                <Trash2 size={14} />
              </button>
            </div>

          </div>
        ))}

        {/* Nothing to report before the first response — "none found" while
            loading reads as an empty board. */}
        {list.initialLoading && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200">
            <Loader2 className="mx-auto text-slate-300 mb-2 animate-spin" size={36} />
            در حال دریافت اطلاعات…
          </div>
        )}

        {list.error && !list.initialLoading && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-rose-200">
            <p className="text-sm text-rose-600 font-medium">{list.error}</p>
            <button onClick={() => list.refresh()} className="mt-3 text-xs text-sky-600 hover:underline font-bold">
              تلاش دوباره
            </button>
          </div>
        )}

        {filteredTasks.length === 0 && !list.initialLoading && !list.error && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200">
            <ListTodo className="mx-auto text-slate-300 mb-2" size={40} />
            وظیفه فعالی یافت نشد.
          </div>
        )}

        {/* Pagination. The board holds one page; these move between them. */}
        {list.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-slate-100 bg-white flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium">
              نمایش {list.rows.length.toLocaleString('fa-IR')} از {list.total.toLocaleString('fa-IR')} وظیفه
              {' — '}صفحه {list.page.toLocaleString('fa-IR')} از {list.totalPages.toLocaleString('fa-IR')}
            </span>
            <div className="flex items-center gap-1.5">
              {[
                { label: 'اول', to: 1, disabled: list.page === 1 },
                { label: 'قبلی', to: list.page - 1, disabled: list.page === 1 },
                { label: 'بعدی', to: list.page + 1, disabled: list.page >= list.totalPages },
                { label: 'آخر', to: list.totalPages, disabled: list.page >= list.totalPages },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => list.setPage(btn.to)}
                  disabled={btn.disabled || list.loading}
                  className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isTaskModalFullscreen ? 'p-0' : 'p-2 sm:p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isTaskModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-xl my-4 max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)]'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">تعریف وظیفه و یادداشت پیگیری</h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsTaskModalFullscreen(!isTaskModalFullscreen)}
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isTaskModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isTaskModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowModal(false); setIsTaskModalFullscreen(false); }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
                  title="بستن فرم"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-4 text-right overflow-y-auto flex-1">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                {/* Title */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'tasks', 'title', 'عنوان وظیفه / پیگیری بازرگانی')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'tasks', 'title')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="مثال: ارسال اصلاحیه پروفرما به مهندسی مپنا"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'tasks', 'description', 'شرح جزئیات اقدام درخواستی')}</label>
                  <textarea
                    rows={2}
                    required={isFieldRequired(settings, 'tasks', 'description')}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="جزئیات استعلام قیمت ارزی، شرایط پرداخت توافق شده..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* Relation Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">مرتبط با ماژول</label>
                  <select
                    value={relatedToType}
                    onChange={(e) => setRelatedToType(e.target.value as Task['relatedToType'])}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    <option value="عمومی">عمومی (فاقد مرجع)</option>
                    <option value="مشتری">مشتریان</option>
                    <option value="پروژه">پروژه‌ها و مناقصات</option>
                  </select>
                </div>

                {/* Linked Target select */}
                {relatedToType === 'مشتری' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">مشتری هدف *</label>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={relatedToId}
                        onChange={(e) => setRelatedToId(e.target.value)}
                        required
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب مشتری --</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>{c.companyName}</option>
                        ))}
                      </select>
                      {addCustomer && (
                        <button
                          type="button"
                          onClick={() => setQuickAddType('customer')}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {relatedToType === 'پروژه' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">پروژه هدف *</label>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={relatedToId}
                        onChange={(e) => setRelatedToId(e.target.value)}
                        required
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب پروژه --</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                        ))}
                      </select>
                      {addProject && (
                        <button
                          type="button"
                          onClick={() => setQuickAddType('project')}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                          title="تعریف سریع پروژه جدید"
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {relatedToType === 'عمومی' && <div className="hidden" />}

                {/* Priority */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'tasks', 'priority', 'درجه اولویت')}</label>
                  <select
                    value={priority}
                    required={isFieldRequired(settings, 'tasks', 'priority')}
                    onChange={(e) => setPriority(e.target.value as Task['priority'])}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    <option value="پایین">پایین (Low)</option>
                    <option value="متوسط">متوسط (Medium)</option>
                    <option value="بالا">بالا (High)</option>
                    <option value="فوری">فوری (Urgent) 🚨</option>
                  </select>
                </div>

                {/* Due Date */}
                <div className="space-y-1.5" id="task-due-date-picker-wrapper">
                  <ShamsiDatePicker
                    label={`مهلت انجام (سررسید)${getFieldAsterisk(settings, 'tasks', 'dueDate')}`}
                    required={isFieldRequired(settings, 'tasks', 'dueDate')}
                    value={dueDate}
                    onChange={(val) => setDueDate(val)}
                  />
                </div>

                {/* Assignee */}
                <div className="space-y-1.5" id="task-assignee-select-wrapper">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'tasks', 'assignedTo', 'ارجاع کار به همکار')}</label>
                  <select
                    value={assignedTo}
                    required={isFieldRequired(settings, 'tasks', 'assignedTo')}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-medium"
                  >
                    <option value="">-- بدون ارجاع (شخصی / خود من) --</option>
                    {/* The directory carries names and positions, not roles —
                        a picker has no business knowing anyone's access level. */}
                    {users.map((u) => (
                      <option key={u.id} value={u.fullName}>
                        {u.fullName}{u.position ? ` (${u.position})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status select (only in Edit mode) */}
                {editingTask && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">وضعیت انجام کار</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as Task['status'])}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-medium"
                    >
                      <option value="در حال انجام">در حال انجام</option>
                      <option value="انجام شده">انجام شده</option>
                      <option value="کنسل شده">کنسل شده</option>
                    </select>
                  </div>
                )}

                {/* Reminder Option */}
                <div className="sm:col-span-2 border-t border-slate-100 pt-3 mt-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${reminderEnabled ? 'bg-amber-50 text-amber-500' : 'bg-slate-50 text-slate-400'}`}>
                        <Bell size={16} />
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-slate-700 block">تنظیم یادآور برای این وظیفه</span>
                        <span className="text-[10px] text-slate-400 block">اطلاع‌رسانی خودکار سیستم در تاریخ و ساعت مشخص شده</span>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminderEnabled}
                        onChange={(e) => setReminderEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                  </div>

                  {reminderEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 p-3 bg-amber-50/40 border border-amber-100 rounded-xl">
                      <div>
                        <ShamsiDatePicker
                          label="تاریخ یادآوری"
                          required
                          value={reminderDate}
                          onChange={(val) => setReminderDate(val)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">ساعت یادآوری</label>
                        <input
                          type="time"
                          required
                          value={reminderTime}
                          onChange={(e) => setReminderTime(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-right font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Dynamic Custom Fields Form Section */}
              <div className="border-t border-slate-100 pt-5">
                <CustomFieldsForm
                  module="tasks"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setIsTaskModalFullscreen(false); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15"
                >
                  {editingTask ? 'ثبت تغییرات پیگیری' : 'افزودن به تقویم پیگیری'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {quickAddType && (
        <QuickAddModal
          isOpen={!!quickAddType}
          onClose={() => setQuickAddType(null)}
          type={quickAddType}
          settings={settings}
          customers={customers}
          addCustomer={addCustomer}
          addProject={addProject}
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              // The pickers were filled before this record existed, so pin it —
              // otherwise the field is set to an id the select has no option
              // for, and renders its placeholder as though nothing was created.
              if (quickAddType === 'customer') customerPicker.include(newEntity);
              else if (quickAddType === 'project') projectPicker.include(newEntity);
              setRelatedToId(newEntity.id);
            }
          }}
        />
      )}

    </div>
  );
}
