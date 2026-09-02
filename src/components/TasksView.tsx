import React, { useEffect, useState } from 'react';
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
  EyeOff,
  UserPlus,
  Phone,
  LayoutGrid,
  Inbox
} from 'lucide-react';
import { Task, Customer, Project, ERPSettings } from '../types';
import type { User as AppUser } from '../types';
import { getTodayShamsi } from '../dateUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk, getFieldAsterisk } from '../utils/requiredFields';
import ShamsiDatePicker from './ShamsiDatePicker';
import WorkBoard, { BoardCard } from './WorkBoard';
import ConfirmModal from './ConfirmModal';
import ReferralsView from './ReferralsView';
import ReferralThread from './ReferralThread';
import FollowUpCompletionModal from './FollowUpCompletionModal';
import {
  BOARD_SORTS, BoardSort, LANE_FILTERS, LANE_FILTER_LABELS, MovableLane, SORT_LABELS,
  referralPassesTaskFilters, serverOrderFor, sortBoardCards, taskLane,
} from '../utils/workBoard';
import { ReferralRow, inboxApi, submitReferralReply } from '../api/inbox';
import { salesFollowUpApi, type FollowUpRow } from '../api/salesFollowUp';
import { isTerminalOutcome, settlementCategoryPrompt } from '../utils/salesFollowUp';
import { ACTIVITY_CATEGORY } from '../utils/activityCategories';
import type { useCategoryCompletion } from '../api/useCategoryCompletion';
import { compressImage } from '../imageUtils';
import { useRevalidate } from '../api/liveData';
import { readViewPreferences, writeViewPreferences } from '../utils/viewPreferences';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import QuickAddModal from './QuickAddModal';
import { Bell, Loader2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { rowToTask, tasksApi, taskToWriteInput, type WorkLoad } from '../api/tasks';
import { useTaskList } from '../api/useTaskList';
import { useUserDirectory } from '../api/useUserDirectory';
import { useEntitySearch } from '../api/useEntitySearch';
import type { CustomerRow } from '../api/customers';
import type { ProjectRow } from '../api/projects';
import type { ProformaRow } from '../api/proformas';
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
  /**
   * Which view to open on.
   *
   * The header's inbox and bell icons used to switch to the referrals module,
   * which is a tab here now — so they say which tab rather than which screen.
   */
  initialTab?: 'board' | 'inbox' | 'notifications';
  /** Asks about closing the project's proforma activity category on a settlement. */
  categoryCompletion?: ReturnType<typeof useCategoryCompletion>;
}

export default function TasksView({
  settings,
  currentUser,
  initialTab,
  categoryCompletion,
}: TasksViewProps) {
  // Declared before the pickers below, which are disabled while it is closed.
  const [showModal, setShowModal] = useState(false);
  const list = useTaskList("", currentUser?.id);
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
      // Finishing something is exactly when the floor can have been crossed.
      void topUpBoard();
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
  const selectedLane = list.filters.lane;
  const setSelectedLane = (value: string) => list.setFilter('lane', value);

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

  /*
   * Which of the three views. «کارتابل ارجاعات» used to be its own module in
   * the sidebar and is a tab here: the two screens asked the same question —
   * what has been given to me to do — so a person had to look in two places and
   * remember which kind of thing they were looking for.
   *
   * The referrals screen is rendered **whole**, not reimplemented, so every
   * capability it had (its own filters, the project and customer links, the
   * notification panel) came with it unchanged. The board is the day-to-day
   * view over both kinds of work; the list is what this screen always was.
   */
  /*
   * The view and the order, remembered for whoever is signed in.
   *
   * The filters live in `useTaskList`; these two are the screen's own, and they
   * are the same kind of thing — how one person likes to look at it. An
   * `initialTab` from the header icons still wins, because that is somebody
   * saying where to go right now.
   */
  const [viewPrefs, setViewPrefs] = useState(() => readViewPreferences(
    'tasks.view', currentUser?.id, { mainTab: 'board', boardSort: 'date' }));
  useEffect(() => {
    writeViewPreferences('tasks.view', currentUser?.id, viewPrefs);
  }, [viewPrefs, currentUser?.id]);

  const [mainTab, setMainTabState] = useState<'board' | 'list' | 'inbox'>(
    initialTab === 'inbox' || initialTab === 'notifications' ? 'inbox'
      : (viewPrefs.mainTab as 'board' | 'list' | 'inbox'));
  const setMainTab = (tab: 'board' | 'list' | 'inbox') => {
    setMainTabState(tab);
    setViewPrefs((prev) => ({ ...prev, mainTab: tab }));
  };
  const [boardSort, setBoardSortState] = useState<BoardSort>(
    (BOARD_SORTS as readonly string[]).includes(viewPrefs.boardSort)
      ? viewPrefs.boardSort as BoardSort
      : 'date');
  /*
   * Changing the order also changes which page to ask for.
   *
   * The sort runs over the rows in hand, so the server has to have handed back
   * the right ones first — otherwise the top of a column is a slice of the
   * middle, which is the fault the follow-up queue was corrected for.
   * `serverOrderFor` says what SQL can do; priority it cannot, because the
   * ladder is not alphabetical.
   */
  /*
   * The remembered order has to reach the server too, once, on the way in.
   *
   * `serverOrderFor` runs when the control is pressed — but nobody presses it
   * after a refresh, so a board remembered as «تاریخ ارجاع» would ask for the
   * default `dueDate asc` page and then sort those rows by arrival: the top of
   * a column would be a slice of the middle, exactly the thing the order was
   * pushed to the server to avoid.
   */
  const appliedRememberedOrder = React.useRef(false);
  useEffect(() => {
    if (appliedRememberedOrder.current) return;
    appliedRememberedOrder.current = true;
    const { sort, order } = serverOrderFor(boardSort);
    list.setSortOrder(sort, order);
  }, [boardSort, list]);

  const setBoardSort = (by: BoardSort) => {
    setBoardSortState(by);
    setViewPrefs((prev) => ({ ...prev, boardSort: by }));
    const { sort, order } = serverOrderFor(by);
    list.setSortOrder(sort, order);
  };
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [movingCards, setMovingCards] = useState(false);

  /*
   * Today, held once for the whole screen.
   *
   * Every card's column is measured against it — a chase is parked until its
   * next-contact date arrives — so reading the clock per card would let two
   * halves of one render disagree across midnight.
   */
  const [today] = useState(() => getTodayShamsi());

  /** This person's load and the limits it is held to. See `topUpBoard` below. */
  const [load, setLoad] = useState<WorkLoad | null>(null);


  /*
   * The referrals that share the board with the tasks.
   *
   * A referral is **not** copied into the tasks table — it stays its own record
   * with its own conversation thread, and `workBoard.ts` maps each kind's own
   * status onto a column. Two status columns to keep in step is the fault this
   * codebase keeps repairing.
   *
   * Scoped by the same tab the tasks are: «به من ارجاع شده» is `toMe` on both
   * sides, so one board answers one question.
   */
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [referralReload, setReferralReload] = useState(0);
  const refreshReferrals = React.useCallback(() => setReferralReload((n) => n + 1), []);

  /*
   * Re-reading both halves of the board, through a ref.
   *
   * `list` is rebuilt on every render, so a one-shot effect that closed over
   * it would be holding the first render's copy for the life of the screen —
   * the same family of fault as a callback prop handed to a child that
   * fetches. The ref is always the current one.
   */
  const refreshBoard = React.useRef(() => {});
  refreshBoard.current = () => { list.refresh(); refreshReferrals(); };

  /**
   * Fills «در حال انجام» back up to this person's minimum, and reports the load.
   *
   * Asked for **on mount and after anything is finished**, which are the two
   * moments the floor can have been crossed. It is a POST because it writes —
   * the server pulls the most pressing cards up out of «برای انجام» and «در
   * انتظار مشتری» — and a write must never be a side effect of reading a
   * screen.
   */
  const topUpBoard = React.useCallback(async () => {
    try {
      const result = await tasksApi.topUp();
      setLoad(result);
      // Only re-read when something actually moved. A quiet tick is the normal
      // case, and refreshing on it would jump the screen back to the top every
      // time somebody opened the board.
      if (result.promoted > 0) refreshBoard.current();
    } catch {
      /*
       * A limit that could not be applied is not worth an error on a board
       * that is otherwise correct: the columns are right either way, and the
       * only thing lost is the «۳ از ۵» beside the heading.
       */
    }
  }, []);

  useEffect(() => { void topUpBoard(); }, [topUpBoard]);

  useRevalidate(['referrals', 'activities'], refreshReferrals);

  React.useEffect(() => {
    // Both views draw referrals; only the notices tab does not.
    if (mainTab === 'inbox') return;
    const controller = new AbortController();
    inboxApi
      .referrals({
        scope: selectedScope === 'all' ? undefined : selectedScope,
        all: selectedScope === 'all' ? 'true' : undefined,
        // The same box that searches the tasks. It reaches the request, the two
        // colleagues, the project and its customer — see `listReferrals`.
        search: search || undefined,
        pageSize: 200,
      } as Record<string, string | number | undefined>, controller.signal)
      .then((data) => setReferrals(data.rows))
      .catch(() => { /* the board still draws its tasks */ });
    return () => controller.abort();
  }, [mainTab, selectedScope, search, referralReload]);

  /** The referral whose thread is open, and the follow-up whose form is. */
  const [openReferral, setOpenReferral] = useState<ReferralRow | null>(null);
  /*
   * The follow-up being recorded, and **which task** it is being recorded on.
   *
   * The row is the quotation's — its next action, its health — while the
   * completion is written against one task. Submitting against the row's
   * `nextActionTaskId` instead would be right only while that happens to be the
   * card somebody pressed, and null the moment it is not.
   */
  const [followUpRow, setFollowUpRow] = useState<{
    taskId: string;
    row: FollowUpRow;
    /*
      Set when a *closed* chase is being corrected rather than an open one
      completed. A follow-up and an ordinary task are different things, so
      «ویرایش» on one opens the form it was filled in on — but everything the
      completion did has already happened, so only the result and the note are
      editable and a different endpoint writes them.
    */
    editing?: {
      taskId: string; closed: boolean;
      followUpResult: string; completionNote: string;
      title: string; description: string; dueDate: string;
      assignee: string; priority: string;
      next?: {
        taskId: string; title: string; description: string; dueDate: string;
        assignee: string; priority: string;
      } | null;
    };
  } | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [isTaskModalFullscreen, setIsTaskModalFullscreen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  /*
   * Deleting asked nothing at all — one press on a small icon beside the edit
   * pencil and the record was gone. Reported for a follow-up, where the loss is
   * worst (the chase, what the customer said, and the quotation left with
   * nobody on it), and the same button deletes an ordinary task, so both ask.
   */
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
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

  /*
   * Which kind of work is being raised, chosen before anything is typed.
   *
   * A follow-up is not a task with a label on it: it belongs to a quotation,
   * it moves that quotation's follow-up state, it must not be the second open
   * chase on the same document, it cannot exist on a settled sale, and it is
   * closed by recording what the customer said rather than by a tick. So the
   * two forms ask different questions, and the answers go to different
   * endpoints — `POST /api/tasks` for a task, the follow-up flow's own
   * «فعال‌سازی مجدد» for a chase, which is where every one of those rules
   * already lives.
   *
   * Offered on **creation only**: changing the kind of a task that exists
   * would move it between two flows with different rules about how it closes.
   */
  const [newTaskKind, setNewTaskKind] = useState<'GENERAL' | 'SALES_FOLLOW_UP'>('GENERAL');
  const [followUpProformaId, setFollowUpProformaId] = useState('');

  /*
   * The quotation a new chase is about.
   *
   * `enabled` is what keeps it from querying while the modal is shut — a
   * picker inside a closed modal is still mounted, and without it this asks
   * the server for proformas on every render of the board behind it.
   */
  const proformaLabel = (row: ProformaRow) => [
    row.proformaNumber,
    row.project ? `${row.project.code} — ${row.project.name}` : row.customer?.companyName,
  ].filter(Boolean).join(' · ');

  const proformaPicker = useEntitySearch<ProformaRow>({
    path: '/api/proformas',
    selectedId: followUpProformaId || null,
    enabled: showModal && newTaskKind === 'SALES_FOLLOW_UP',
    getLabel: proformaLabel,
  });

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
    setNewTaskKind('GENERAL');
    setFollowUpProformaId('');
    setShowModal(true);
  };

  const handleOpenEdit = (task: Task) => {
    /*
     * A follow-up is edited on the form it was filled in on.
     *
     * The pencil opened the task box — a title, a due date and a status, none
     * of which is what a chase records — and there was no way at all to correct
     * a result somebody had picked in a hurry. An open one opens the completion
     * form (the same thing the tick does); a closed one opens it in correcting
     * mode, where only the result and the note can move.
     */
    if (task.taskKind === 'SALES_FOLLOW_UP') {
      /*
       * Always with the chase's own state, never empty.
       *
       * Passing nothing for an open one opened the completion form with every
       * box blank — which is right for *recording a call* and is not what
       * «ویرایش» means. Closed, the form shows the recorded answer; open, it
       * shows the chase itself: what it is for, when it is due, whose it is.
       */
      void openFollowUp(task.id, {
        closed: taskLane(task.status) === 'DONE',
        followUpResult: task.followUpResult ?? '',
        completionNote: task.completionNote ?? '',
        title: task.title,
        description: task.description ?? '',
        dueDate: task.dueDate,
        assignee: task.assignedTo ?? '',
        priority: task.priority,
      });
      return;
    }
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

  /** A chase being raised from scratch — the form that asks a quotation for. */
  const isNewFollowUp = !editingTask && newTaskKind === 'SALES_FOLLOW_UP';

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    /*
     * A chase goes to the follow-up flow, not to `POST /api/tasks`.
     *
     * That endpoint is where the quotation's follow-up state is moved, where a
     * second open chase on one document is refused, and where a settled sale is
     * refused outright — and it is the same one «فعال‌سازی مجدد» on the sales
     * queue posts to. A `taskKind` written straight onto a task row would look
     * identical and obey none of it.
     */
    if (isNewFollowUp) {
      if (!title.trim()) { alert('عنوان اقدام الزامی است.'); return; }
      if (!followUpProformaId) { alert('پیش‌فاکتوری که پیگیری می‌شود را انتخاب کنید.'); return; }
      if (!dueDate) { alert('تاریخ اقدام بعدی الزامی است.'); return; }
      void (async () => {
        try {
          await salesFollowUpApi.reactivate(followUpProformaId, {
            title, description, dueDate, assignedToName: assignedTo, priority,
          });
          setShowModal(false);
          setIsTaskModalFullscreen(false);
          list.refresh();
          void topUpBoard();
        } catch (err) {
          reportError(err, 'ثبت پیگیری با خطا مواجه شد.');
        }
      })();
      return;
    }

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

  /*
   * Ticking a task, except when ticking is not what finishes it.
   *
   * A sales follow-up is closed by recording what the customer said — the
   * server refuses the bare tick, and used to point at «پیگیری فروش» in the
   * proformas module, which meant leaving this screen to press a second button.
   * The form opens here instead. Everything else ticks as it always did.
   */
  const handleToggleComplete = (task: Task) => {
    if (task.taskKind === 'SALES_FOLLOW_UP' && task.status !== 'انجام شده') {
      void openFollowUp(task.id);
      return;
    }
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

  /*
   * The two record types, as one list of cards.
   *
   * Built here rather than on the server because they come from two endpoints
   * with two scopes and two paginations — joining them in SQL would mean one
   * query that can page neither correctly.
   */
  const boardCards: BoardCard[] = React.useMemo(() => {
    const taskCards: BoardCard[] = tasks.map((task) => ({
      kind: 'task',
      id: task.id,
      title: task.title,
      createdAt: task.createdAt ?? '',
      priority: task.priority,
      status: task.status,
      taskKind: task.taskKind,
      dueDate: task.dueDate,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      assignedTo: task.assignedTo,
      createdBy: task.createdByName,
      context: task.relatedProject ?? null,
    }));

    /*
     * The referrals the filter bar leaves standing.
     *
     * One bar has to mean something for both kinds of record, and the rule is
     * the same throughout: a record is filtered on the value it effectively
     * has. `referralPassesTaskFilters` is where that is written down — a
     * referral answers the status filter through its column, counts as
     * «متوسط», is always about a project, and drops out of a question about a
     * due date, which it does not have.
     */
    const referralCards: BoardCard[] = referrals.filter((ref) =>
      referralPassesTaskFilters(
        { status: ref.status, assignedToUserId: ref.assignedToUserId },
        {
          lane: list.filters.lane,
          priority: list.filters.priority,
          assignedToUserId: list.filters.assignedToUserId,
          relatedToType: list.filters.relatedToType,
          overdue: list.filters.overdue,
          dateFrom: list.filters.dateFrom,
          dateTo: list.filters.dateTo,
          hideCompleted: list.filters.hideCompleted,
        },
      )).map((ref) => ({
      kind: 'referral',
      id: ref.id,
      // The message itself is the request — there is no separate «what should
      // they do» box any more — so it is what the card is titled with.
      title: ref.activity?.text || ref.actionRequired || 'ارجاع کار',
      createdAt: ref.createdAt,
      status: ref.status,
      assignedTo: ref.assignedToName,
      createdBy: ref.assignedByName,
      context: ref.activity?.group?.project
        ? {
          code: ref.activity.group.project.code,
          name: ref.activity.group.project.name,
          customerName: ref.activity.group.project.customer?.companyName ?? null,
        }
        : null,
      replies: ref.messages?.length ?? 0,
    }));

    return [...taskCards, ...referralCards];
  }, [tasks, referrals, list.filters]);

  /** The page's tasks by id, so one ordered list of cards can find its row. */
  const taskById = React.useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  const toggleCard = (key: string) => setSelectedCards((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /** Moves everything ticked into one column, in a single request. */
  const moveSelection = async (lane: MovableLane) => {
    const taskIds: string[] = [];
    const referralIds: string[] = [];
    for (const key of selectedCards) {
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      (kind === 'referral' ? referralIds : taskIds).push(id);
    }
    setMovingCards(true);
    try {
      const result = await tasksApi.moveToLane(lane, { taskIds, referralIds });
      setSelectedCards(new Set());
      setLoad(result.topUp);
      list.refresh();
      refreshReferrals();
      /*
       * A card that would not move is named, not swallowed — and named by the
       * rule that refused it.
       *
       * There are three of them now: a sales follow-up dragged into «انجام
       * شده» (it is closed by recording what the customer said), a chase
       * pushed into «برای انجام» (its column is its next-contact date), and an
       * assignee already at their limit. One hardcoded sentence could only
       * ever describe the first, so the server sends the sentences.
       */
      if (result.refused > 0) {
        alert([`${result.refused} مورد منتقل نشد.`, ...result.reasons].join('\n'));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'انتقال با خطا مواجه شد.');
    } finally {
      setMovingCards(false);
    }
  };

  /**
   * Opens «ثبت نتیجه پیگیری» for one follow-up task.
   *
   * Shared by the board and the list, because both are this screen: a follow-up
   * used to be refused here and the user sent to «پیگیری فروش» in the
   * proformas module to press a second button — which is the round trip this
   * merge exists to remove.
   */
  const openFollowUp = async (
    taskId: string,
    /** The chase as it stands, when one is being edited rather than completed. */
    editing?: {
      closed: boolean;
      followUpResult: string; completionNote: string;
      title: string; description: string; dueDate: string;
      assignee: string; priority: string;
    },
  ) => {
    setFollowUpLoading(true);
    try {
      // The row is derived — the next action, its date, the health — so it is
      // built on the server rather than assembled out of what a card carries,
      // which is how two screens come to disagree about a quotation.
      const row = await salesFollowUpApi.rowForTask(taskId);
      setFollowUpRow({
        taskId,
        row,
        editing: editing
          ? {
              taskId,
              ...editing,
              /*
                The replacement, from the row the server derived — never from
                the board's own page, which may not hold it. Only when it is a
                *different* task: on an open chase the row's open task is this
                one, and offering it as «اقدام بعدی» would show the same fields
                twice under two headings.
              */
              next: row.nextActionTaskId && row.nextActionTaskId !== taskId
                ? {
                    taskId: row.nextActionTaskId,
                    title: row.nextAction ?? '',
                    description: row.nextActionDescription ?? '',
                    dueDate: row.nextActionDueDateJalali ?? '',
                    assignee: row.nextActionAssignee ?? '',
                    priority: row.nextActionPriority ?? 'متوسط',
                  }
                : null,
            }
          : undefined,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'دریافت اطلاعات پیگیری با خطا مواجه شد.');
    } finally {
      setFollowUpLoading(false);
    }
  };

  /**
   * Opening a card.
   *
   * The whole reason for the merge: a referral is answered in its own thread
   * and a sales follow-up through its own completion form, both without
   * leaving this screen. An ordinary task opens the edit box it always had.
   */
  const openCard = async (card: BoardCard) => {
    if (card.kind === 'referral') {
      setOpenReferral(referrals.find((r) => r.id === card.id) ?? null);
      return;
    }
    /*
     * A follow-up that is still open opens its completion form. A closed one
     * goes through `handleOpenEdit`, which opens the same form in correcting
     * mode — `completeFollowUp` would refuse a second completion, but the
     * result and the note are still somebody's to fix.
     */
    if (card.taskKind === 'SALES_FOLLOW_UP' && taskLane(card.status) !== 'DONE') {
      await openFollowUp(card.id);
      return;
    }
    const task = tasks.find((t) => t.id === card.id);
    if (task) handleOpenEdit(task);
  };

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

      {/*
        The three views.

        «کارتابل ارجاعات» was its own sidebar module and is a tab here: it and
        this screen asked the same question — what has been given to me to do —
        so a person had to look in two places. It is rendered whole rather than
        reimplemented, so nothing it could do was lost in the move, its own
        notifications tab included.
      */}
      {/*
        Drawn as tabs, not as chips.

        Rounded pills read as filters — something you switch on beside other
        things you switch on — and these are not: they are three different
        screens, one at a time. An underlined row sitting on a rule is what
        every other tabbed surface here uses (the referrals inbox below it
        included), so the two do not argue about which is which.
      */}
      <div className="border-b border-edge flex items-center gap-1 overflow-x-auto" id="task-main-tabs">
        {([
          { key: 'board' as const, label: 'تخته کار', icon: LayoutGrid },
          { key: 'list' as const, label: 'فهرست وظایف', icon: ListTodo },
          { key: 'inbox' as const, label: 'اعلان‌ها', icon: Bell },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMainTab(tab.key)}
            id={`task-main-tab-${tab.key}`}
            className={`py-2.5 px-4 text-sm font-bold border-b-2 -mb-px transition whitespace-nowrap flex items-center gap-2 ${
              mainTab === tab.key
                ? 'border-sky-500 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/*
        The notices, alone.

        There is no «کارتابل» tab any more: a referral **is** a task on the two
        views beside this one, with the same filters, the same columns and the
        same search — so a second list of the same records under another name
        would be two places to look again, which is what the merge removed.
      */}
      {mainTab === 'inbox' ? (
        <ReferralsView
          embedded
          notificationsOnly
          currentUser={currentUser}
          settings={settings}
        />
      ) : (<>

      {/*
        Whose tasks. Enforced on the server; this picks between the halves.

        A segmented control rather than a second row of tabs: this narrows what
        the view above shows, which is a different kind of choice from picking
        the view itself, and two identical rows stacked would leave nothing
        saying which is which.
      */}
      <div
        className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5"
        id="task-scope-tabs"
      >
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
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
              selectedScope === tab.key
                ? 'bg-white text-sky-700 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
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
            placeholder="جستجو در عنوان، شرح، مسئول، کد یا نام پروژه، مشتری و شماره پیش‌فاکتور..."
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
            value={selectedLane}
            onChange={(e) => setSelectedLane(e.target.value)}
            id="task-status-filter"
            className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
          >
            {/*
              The columns, not the status words.

              It used to list three literal statuses — and every automation
              raises its task as «در انتظار», which was on none of them, so
              choosing «در حال انجام» asked for a string those tasks did not
              carry and showed nothing at all. Each choice is a column now, and
              the middle one is «everything that is not one of the other three»,
              so a status nobody anticipated is still findable.
            */}
            <option value="all">همه وضعیت‌ها</option>
            {LANE_FILTERS.map((lane) => (
              <option key={lane} value={lane}>{LANE_FILTER_LABELS[lane]}</option>
            ))}
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
          disabled={selectedLane !== 'all'}
          title={selectedLane !== 'all'
            ? 'وضعیت به‌صورت مشخص انتخاب شده است'
            : hideCompleted ? 'نمایش وظایف انجام‌شده' : 'پنهان کردن وظایف انجام‌شده'}
          className={`w-full md:w-auto flex items-center justify-center gap-2 border rounded-lg text-sm py-2 px-3 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
            hideCompleted && selectedLane === 'all'
              ? 'bg-sky-50 border-sky-500 text-sky-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-sky-500'
          }`}
        >
          {hideCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
          {hideCompleted ? 'نمایش انجام‌شده‌ها' : 'پنهان کردن انجام‌شده‌ها'}
        </button>
      </div>

      {/*
        The board's own control: what orders a column.

        Only two answers, because they are the two the work actually has — when
        it arrived, and how urgent it is. A referral carries no priority and
        sorts as «متوسط»; see `PRIORITY_ORDER`.
      */}
      {/* Shown for both views: the list orders its referrals by it too. */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">ترتیب:</span>
            {BOARD_SORTS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setBoardSort(option)}
                id={`work-board-sort-${option}`}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${
                  boardSort === option
                    ? 'bg-sky-50 border-sky-400 text-sky-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-sky-300'
                }`}
              >
                {SORT_LABELS[option]}
              </button>
            ))}
          </div>
          {mainTab === 'board' && (
            <span className="text-[11px] text-slate-500">
              {selectedCards.size > 0
                ? `${selectedCards.size} مورد انتخاب شده — ستون مقصد را بزنید.`
                : 'موارد را تیک بزنید و سپس «انتقال به اینجا» را در ستون مقصد بزنید.'}
            </span>
          )}
      </div>

      {mainTab === 'board' && (
        <WorkBoard
          cards={boardCards}
          sort={boardSort}
          today={today}
          load={load}
          selected={selectedCards}
          onToggleSelect={toggleCard}
          onMove={(lane) => { void moveSelection(lane); }}
          onOpen={(card) => { void openCard(card); }}
          moving={movingCards || followUpLoading}
        />
      )}

      {/* List */}
      <div className={`grid grid-cols-1 gap-4 ${mainTab === 'board' ? 'hidden' : ''}`}>
        {/*
          One order over both kinds of row.

          The tasks used to be drawn in whatever order the server returned and
          the referrals sorted after them, so «ترتیب» moved half the screen and
          left the other half where it was — and the two halves were two blocks,
          which is the shape the merge exists to remove. They are one list.

          It orders the **page in hand**, which is two hundred rows; the
          pagination below moves between pages. That is the same bound the board
          works under, and the reason both are honest about it.
        */}
        {sortBoardCards(boardCards, boardSort).map((card) => {
          if (card.kind === 'referral') {
            return (

            <div
              key={card.id}
              id={`referral-row-${card.id}`}
              className="bg-white rounded-2xl border border-indigo-100 p-4 sm:p-5 flex flex-col gap-3 hover:shadow-sm transition"
            >
              <div className="flex items-start gap-3.5 w-full">
                <button
                  onClick={() => setOpenReferral(referrals.find((r) => r.id === card.id) ?? null)}
                  title="باز کردن گفتگوی ارجاع"
                  className="mt-1 w-5 h-5 rounded-md flex items-center justify-center border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition flex-shrink-0"
                >
                  <Inbox size={11} />
                </button>
                <div className="space-y-1 flex-1 min-w-0">
                  {/*
                    The title opens the record, exactly as on the board.

                    A referral's thread, a follow-up's completion form, a
                    task's edit box — pressing the card is how the board opens
                    each of them, and the list made people find the small icon
                    at the side instead. Same gesture, both views.
                  */}
                  <button
                    type="button"
                    onClick={() => { void openCard(card); }}
                    id={`card-open-${card.id}`}
                    className="font-bold text-sm leading-snug break-words text-slate-800 text-right hover:text-sky-700 transition w-full"
                  >
                    {card.title}
                  </button>
                  {card.context && (
                    <div className="text-[10px] text-sky-700 flex flex-wrap items-center gap-1">
                      {card.context.code && <span className="font-mono font-bold">{card.context.code}</span>}
                      {card.context.name && <span className="truncate">{card.context.name}</span>}
                      {card.context.customerName && (
                        <span className="text-slate-500">— {card.context.customerName}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full text-xs pt-3 border-t border-slate-100">
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border bg-indigo-50 border-indigo-200 text-indigo-700">
                  ارجاع کار
                </span>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600">
                  وضعیت: {card.status}
                </span>
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-sans bg-slate-50 px-2 py-1 rounded border">
                  <User size={12} />
                  <span>مسئول: {card.assignedTo || '—'}</span>
                </div>
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-sans bg-slate-50 px-2 py-1 rounded border">
                  <UserPlus size={12} />
                  <span>ارجاع‌دهنده: {card.createdBy || '—'}</span>
                </div>
              </div>
            </div>
            );
          }

          const task = taskById.get(card.id);
          if (!task) return null;
          return (
          /*
            A stack, not two columns.

            The card used to put the title on the left and every badge on the
            right, which gave the description whatever width the badges left it
            — a paragraph rendered as a tall thin ribbon, and a follow-up's own
            words are the longest thing on it. So the text runs the full width
            of the card and the badges sit in one wrapped row beneath.
          */
          <div 
            key={task.id} 
            className={`bg-white rounded-2xl border p-4 sm:p-5 flex flex-col gap-3 hover:shadow-sm transition ${
              task.status === 'انجام شده' ? 'border-emerald-100 bg-emerald-50/10' : 'border-slate-100'
            }`}
          >
            <div className="flex items-start gap-3.5 w-full">
              {/*
                The tick — except on a sales follow-up, where it opens the form
                that records what the customer said. A plain tick is refused for
                those by the server, and used to send the reader off to
                «پیگیری فروش» in the proformas module to press a second button.
                The title says which one this is before it is pressed.
              */}
              <button
                onClick={() => handleToggleComplete(task)}
                title={task.taskKind === 'SALES_FOLLOW_UP' && task.status !== 'انجام شده'
                  ? 'ثبت نتیجه پیگیری'
                  : task.status === 'انجام شده' ? 'بازگرداندن به در حال انجام' : 'انجام شد'}
                id={`task-complete-${task.id}`}
                className={`mt-1 rounded-md flex items-center justify-center border transition flex-shrink-0 ${
                  task.status === 'انجام شده' 
                    ? 'bg-emerald-500 border-emerald-500 text-white' 
                    : task.taskKind === 'SALES_FOLLOW_UP'
                      ? 'border-sky-400 text-sky-600 hover:bg-sky-50 w-5 h-5'
                      : 'border-slate-300 hover:border-sky-500 w-5 h-5'
                }`}
              >
                {task.status === 'انجام شده' && <CheckCircle2 size={14} />}
                {task.status !== 'انجام شده' && task.taskKind === 'SALES_FOLLOW_UP' && (
                  <Phone size={11} />
                )}
              </button>
              
              <div className="space-y-1 flex-1 min-w-0">
                {/* Same gesture as the board: the title opens the record. */}
                <button
                  type="button"
                  onClick={() => { void openCard(card); }}
                  id={`card-open-${task.id}`}
                  className={`font-bold text-sm leading-snug break-words text-right w-full hover:text-sky-700 transition ${task.status === 'انجام شده' ? 'line-through text-slate-400' : 'text-slate-800'}`}
                >
                  {task.title}
                </button>
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

            {/*
              The two halves of a follow-up, which live on two different rows.

              `description` is what this task is *for* — on a sales follow-up it
              is «شرح اقدام بعدی», typed by whoever closed the previous chase —
              and `completionNote` is what came of this one once it was closed.
              Neither was drawn at all, so a completed follow-up said «انجام
              شده» and nothing about what the customer had actually said.

              `whitespace-pre-line` because both are typed into a textarea and
              the line breaks are the writer's own.
            */}
            {(task.description || task.completionNote) && (
              <div className="w-full space-y-2 pr-8 sm:pr-9">
                {task.description && (
                  <div className="w-full">
                    <span className="block text-[10px] font-bold text-slate-400 mb-0.5">
                      {task.taskKind === 'SALES_FOLLOW_UP' ? 'شرح اقدام بعدی' : 'شرح'}
                    </span>
                    <p className="text-xs text-slate-600 break-words whitespace-pre-line leading-relaxed">
                      {task.description}
                    </p>
                  </div>
                )}

                {task.completionNote && (
                  <div className="w-full bg-emerald-50/40 border border-emerald-100 rounded-xl px-3 py-2">
                    <span className="block text-[10px] font-bold text-emerald-700 mb-0.5">
                      شرح اقدام انجام‌شده
                    </span>
                    <p className="text-xs text-slate-600 break-words whitespace-pre-line leading-relaxed">
                      {task.completionNote}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-2 w-full text-xs pt-3 border-t border-slate-100">
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${getPriorityClass(task.priority)}`}>
                اولویت: {task.priority}
              </span>

              {/* What the customer said, when this was a chase that closed. */}
              {task.followUpResult && (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border bg-sky-50 border-sky-200 text-sky-700">
                  نتیجه: {task.followUpResult}
                </span>
              )}

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

              {/*
                Who raised it — the other half of who a task belongs to.

                `createdByUserId` is what «من ارجاع دادم» filters on and the
                second arm of `visibilityClause`, and nothing on the card drew
                it: a row that appeared under «همه وظایف» and in neither tab had
                no visible explanation, which is exactly how it was reported.
                An empty creator is not a gap in the record — it is what an
                automation-raised task carries, and what every task written
                before the column existed carries — so it is named rather than
                left blank.
              */}
              <div
                className="text-[11px] text-slate-400 flex items-center gap-1.5 font-sans bg-slate-50 px-2 py-1 rounded border"
                title={task.createdByName
                  ? `این وظیفه را ${task.createdByName} ثبت کرده است.`
                  : 'کاربری این وظیفه را ثبت نکرده: یا خودکار ساخته شده، یا پیش از افزوده‌شدن ستون ثبت‌کننده ایجاد شده است.'}
              >
                <UserPlus size={12} />
                <span>ارجاع‌دهنده: {task.createdByName || 'سیستم / نامشخص'}</span>
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
                onClick={() => setTaskToDelete(task)}
                className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition"
                title="حذف وظیفه"
              >
                <Trash2 size={14} />
              </button>
            </div>

          </div>
          );
        })}

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

        {boardCards.length === 0 && !list.initialLoading && !list.error && (
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

      </>)}

      {/*
        Answering a referral without leaving this screen.

        `ReferralThread` is the same component the referrals screen and the
        project feed both use, so replying, closing, reopening and forwarding
        all behave exactly as they did — this is where they are drawn now, not
        a second implementation of them.
      */}
      {openReferral && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-3" dir="rtl">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">ارجاع کار</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  از {openReferral.assignedByName || 'یک همکار'}
                  {openReferral.activity?.group?.project
                    ? ` — ${openReferral.activity.group.project.code} ${openReferral.activity.group.project.name}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenReferral(null)}
                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              <ReferralThread
                referral={{
                  id: openReferral.id,
                  assignedTo: openReferral.assignedToName ?? '',
                  assignedBy: openReferral.assignedByName ?? '',
                  assignedToUserId: openReferral.assignedToUserId,
                  assignedByUserId: openReferral.assignedByUserId,
                  actionRequired: openReferral.actionRequired ?? openReferral.activity?.text ?? '',
                  status: openReferral.status,
                  messages: (openReferral.messages ?? []).map((m) => ({
                    id: m.id,
                    text: m.text,
                    responder: m.responderName ?? '',
                    responderUserId: m.responderUserId,
                    createdAt: m.createdAt,
                    attachment: m.attachmentName
                      ? { name: m.attachmentName, size: m.attachmentSize ?? '', content: m.attachmentUrl ?? undefined }
                      : null,
                  })),
                }}
                currentUserId={currentUser?.id}
                formatDate={(iso) => new Date(iso).toLocaleString('fa-IR')}
                // The size rule lives in `uploadFile`, which is the only path
                // to the server — a check here was one of three that disagreed
                // with it and with each other.
                onPickAttachment={(file, done) => {
                  compressImage(file, (dataUrl, sizeStr) => {
                    done({ name: file.name, size: sizeStr, content: dataUrl });
                  });
                }}
                onSubmit={async (body) => {
                  const outcome = await submitReferralReply(openReferral.id, body);
                  if (outcome === 'nothing') { alert('لطفاً پیام خود را بنویسید.'); return; }
                  setOpenReferral(null);
                  refreshReferrals();
                  /*
                   * A closed category that the answer reopened. Not a fault and not
                   * silent: «اتمام کار» said the work under that heading was finished and
                   * this answer says it is not, which is a change to the project the
                   * writer should be told about rather than discover.
                   */
                  if (outcome === 'sent-reopened') {
                    alert('پاسخ ثبت شد. چون دسته‌بندی این پیام بسته بود، دوباره به وضعیت «جاری» بازگشت.');
                  }

                }}
                onEditAction={async (text) => {
                  await inboxApi.updateReferralAction(openReferral.id, text);
                  refreshReferrals();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/*
        And recording a follow-up result without leaving it either.

        Exactly the modal «پیگیری فروش» opens, over a row the server derived —
        so the three questions it asks, the refusals it enforces and the outcome
        it can settle are one implementation, not two.
      */}
      {followUpRow && (
        <FollowUpCompletionModal
          row={followUpRow.row}
          resultOptions={settings.dropdownItems?.followUpResults ?? []}
          priorityOptions={settings.dropdownItems?.taskPriorities ?? []}
          userNames={users.map((u) => u.fullName)}
          // The same rule the follow-up screen passes, not a second list of
          // the four outcomes written out here.
          outcomeIsTerminal={isTerminalOutcome(followUpRow.row.outcome)}
          lossReasons={settings.lossReasons ?? []}
          onClose={() => setFollowUpRow(null)}
          editing={followUpRow.editing ?? null}
          /*
            Editing writes fields; it never re-runs the completion.

            Up to three rows move, and which ones depends on the mode — the
            chase itself always, the recorded answer only once it is closed,
            and the replacement only when there is one still open. That
            decision belongs here, where the rows are, rather than in the form.

            Each write is a *partial* one, naming only the keys being changed:
            the route copies an allowlist, so a key that is not sent is not
            touched, and the status in particular is never among them —
            `completeFollowUp` is the only thing that may close a follow-up.
            The assignee travels as a name with no id, so the server resolves
            it and a rename cannot leave the task belonging to nobody.
          */
          onSaveEdits={async (body) => {
            const fields = (a: typeof body.action) => ({
              title: a.title,
              description: a.description,
              dueDate: a.dueDate,
              assignedToName: a.assignedToName,
              priority: a.priority,
            });

            await tasksApi.update(followUpRow.taskId, fields(body.action));
            if (followUpRow.editing?.closed) {
              await salesFollowUpApi.updateResult(followUpRow.taskId, {
                followUpResult: body.followUpResult,
                completionNote: body.completionNote || undefined,
              });
            }
            if (body.next) await tasksApi.update(body.next.taskId, fields(body.next));

            setFollowUpRow(null);
            list.refresh();
          }}
          onSubmit={async (body) => {
            // Against the task that was pressed, never the row's own
            // `nextActionTaskId`: they are the same only while the card
            // happens to be the open one.
            const outcome = await salesFollowUpApi.complete(followUpRow.taskId, body);
            setFollowUpRow(null);
            list.refresh();
            // A chase closed is a seat freed, and the replacement is parked
            // until its own date — so this is exactly when the floor is crossed.
            void topUpBoard();
            /*
              Settling a sale here is the same event as settling it in the
              proforma's own outcome modal, which has always gone on to ask
              whether the project's «پیش‌فاکتور» activity category is finished
              with. Reaching that state through this door asked nothing, so a
              job could be won and its category left open for ever.
            */
            const prompt = settlementCategoryPrompt(outcome, ACTIVITY_CATEGORY.PROFORMAS);
            if (prompt) categoryCompletion?.promptCompletion(prompt);
          }}
        />
      )}

      {/*
        Deleting asks first.

        A follow-up says what is actually lost, because it is not one record:
        the chase, the result somebody recorded on it, and the quotation that
        is left with nothing chasing it. An ordinary task gets the plain
        question — the same button deletes both, and a button that asks about
        one and not the other is a button nobody can predict.
      */}
      <ConfirmModal
        isOpen={!!taskToDelete}
        onClose={() => setTaskToDelete(null)}
        onConfirm={() => {
          const target = taskToDelete;
          setTaskToDelete(null);
          if (target) void deleteTask(target.id);
        }}
        title={taskToDelete?.taskKind === 'SALES_FOLLOW_UP' ? 'حذف پیگیری فروش' : 'حذف وظیفه'}
        message={taskToDelete?.taskKind === 'SALES_FOLLOW_UP'
          ? `«${taskToDelete?.title ?? ''}» حذف شود؟ نتیجه ثبت‌شده این پیگیری هم با آن پاک می‌شود و`
            + ' پیش‌فاکتور مربوطه بدون اقدام بعدی می‌ماند. برای بستن یک پیگیری، «ثبت نتیجه پیگیری»'
            + ' را بزنید تا سابقه آن بماند.'
          : `«${taskToDelete?.title ?? ''}» حذف شود؟ این کار قابل بازگشت نیست.`}
        variant="danger"
      />

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
                {/*
                  Which kind of work this is, asked first because it changes
                  the rest of the form — and offered on creation only, since
                  changing the kind of a task that exists would move it between
                  two flows with different rules about how it closes.
                */}
                {!editingTask && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-500">نوع کار</label>
                    <div className="grid grid-cols-2 gap-2" id="task-kind-choice">
                      {([
                        ['GENERAL', 'وظیفه عادی', 'کاری که خودتان یا همکارتان باید انجام دهد.'],
                        ['SALES_FOLLOW_UP', 'پیگیری فروش', 'پیگیری یک پیش‌فاکتور تا تعیین تکلیف آن.'],
                      ] as const).map(([value, label, hint]) => (
                        <button
                          key={value}
                          type="button"
                          id={`task-kind-${value}`}
                          onClick={() => setNewTaskKind(value)}
                          className={`text-right px-3 py-2 rounded-lg border transition ${
                            newTaskKind === value
                              ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/20'
                              : 'border-slate-200 bg-white hover:border-sky-300'
                          }`}
                        >
                          <span className="block text-[13px] font-bold text-slate-800">{label}</span>
                          <span className="block text-[10px] text-slate-600 leading-relaxed">{hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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

                {/*
                  A chase is about a **quotation**, and that is not one of the
                  three things the «مرتبط با ماژول» picker offers — so the two
                  forms ask different questions here rather than one of them
                  offering a field that cannot answer.
                */}
                {isNewFollowUp ? (
                  <div className="space-y-1.5 sm:col-span-2" id="follow-up-proforma-picker">
                    <label className="text-xs font-semibold text-slate-500">پیش‌فاکتوری که پیگیری می‌شود *</label>
                    <input
                      type="text"
                      value={proformaPicker.term}
                      onChange={(e) => proformaPicker.setTerm(e.target.value)}
                      placeholder="جستجوی شماره پیش‌فاکتور، کد یا نام پروژه…"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    />
                    <select
                      value={followUpProformaId}
                      required
                      onChange={(e) => setFollowUpProformaId(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      <option value="">-- انتخاب پیش‌فاکتور --</option>
                      {proformaPicker.matches.map((row) => (
                        <option key={row.id} value={row.id}>
                          {proformaLabel(row)}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      اگر این پیش‌فاکتور پیگیری بازی داشته باشد یا نتیجه‌اش قطعی شده باشد، ثبت انجام نمی‌شود.
                    </p>
                  </div>
                ) : (
                  <>
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
                  </>
                )}

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
                    /*
                      A chase's date is not a deadline: it is the day the
                      customer is to be called, and it is what decides whether
                      the card sits in «در انتظار مشتری» or «در حال انجام». So
                      it is always required here and says what it is.
                    */
                    label={isNewFollowUp
                      ? 'تاریخ اقدام بعدی (تماس با مشتری) *'
                      : `مهلت انجام (سررسید)${getFieldAsterisk(settings, 'tasks', 'dueDate')}`}
                    required={isNewFollowUp || isFieldRequired(settings, 'tasks', 'dueDate')}
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

                {/*
                  No reminder on a chase.
                  
                  It has one already, and a better one: the due date puts it in
                  «در حال انجام» on the morning it is to be made, on the board
                  the person is looking at anyway. A second notification for the
                  same call is one to start ignoring.
                */}
                {!isNewFollowUp && (
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
                )}

              </div>

              {/*
                The custom fields belong to the tasks module and are written by
                `POST /api/tasks`; a chase is created through the follow-up
                flow, which has no column for them — so offering boxes whose
                answers would be dropped is worse than not offering them.
              */}
              {!isNewFollowUp && (
              <div className="border-t border-slate-100 pt-5">
                <CustomFieldsForm
                  module="tasks"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>
              )}

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
