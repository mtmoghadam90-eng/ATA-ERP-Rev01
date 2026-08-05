import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import CustomersView from './components/CustomersView';
import ProductsView from './components/ProductsView';
import ProformasView from './components/ProformasView';
import PurchaseOrdersView from './components/PurchaseOrdersView';
import SuppliersView from './components/SuppliersView';
import ProjectsView from './components/ProjectsView';
import TransactionsView from './components/TransactionsView';
import TasksView from './components/TasksView';
import SettingsView from './components/SettingsView';
import ReferralsView from './components/ReferralsView';
import UsersView from './components/UsersView';
import AfterSalesServicesView from './components/AfterSalesServicesView';
import PackagingDeliveryView from './components/PackagingDeliveryView';
import SupplierInquiriesView from './components/SupplierInquiriesView';
import LoginView from './components/LoginView';
import { useERPStore, onEditConflict, onSessionExpired } from './useERPStore';
import { ShieldAlert, Bell, Inbox, Menu, Calendar, CheckCircle2, Clock, User, Sun, Moon, RefreshCw } from 'lucide-react';
import TaskCalendarModal from './components/TaskCalendarModal';
import { getTodayShamsi, toShamsiStr } from './dateUtils';
import ShamsiDatePicker from './components/ShamsiDatePicker';
import ConfirmModal from './components/ConfirmModal';
import ProjectConfirmationUploadModal from './components/ProjectConfirmationUploadModal';
import { Project } from './types';
import { useSidebarBadges } from './api/useSidebarBadges';
import { tasksApi, taskToWriteInput } from './api/tasks';
import { useCategoryCompletion } from './api/useCategoryCompletion';

export default function App() {
  const store = useERPStore();
  // Counts the sidebar and header show. Server-side, and the last reason this
  // component needed whole collections.
  const badges = useSidebarBadges(!!store.currentUser);
  // Category completion prompt for migrated modules
  const categoryCompletion = useCategoryCompletion();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('erp-theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('erp-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const [activeView, setActiveView] = useState<string>(() => {
    const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const printModule = urlParams.get('printModule');
    if (printModule) {
      return printModule;
    }
    return 'dashboard';
  });
  const [referralsTab, setReferralsTab] = useState<'toMe' | 'fromMe' | 'notifications'>('toMe');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [selectedProjectIdForActivities, setSelectedProjectIdForActivities] = useState<string | null>(null);
  const [selectedCustomerNameForSearch, setSelectedCustomerNameForSearch] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState<boolean>(false);
  const [triggeredReminders, setTriggeredReminders] = useState<string[]>([]);
  const [activeReminderTask, setActiveReminderTask] = useState<any>(null);
  const [printDocumentRequest, setPrintDocumentRequest] = useState<{ module: string, docId: string } | null>(() => {
    const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const printModule = urlParams.get('printModule');
    const printId = urlParams.get('printId');
    if (printModule && printId) {
      return { module: printModule, docId: printId };
    }
    return null;
  });
  const [previousView, setPreviousView] = useState<string | null>(null);

  const handleOpenDocument = (module: string, docId: string) => {
    setPreviousView(activeView);
    setPrintDocumentRequest({ module, docId });
    setActiveView(module);
  };

  const handleClearPrintDoc = () => {
    setPrintDocumentRequest(null);
    if (previousView) {
      setActiveView(previousView as any);
      setPreviousView(null);
    } else {
      const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      if (urlParams.get('printModule')) {
        window.close();
      }
    }
  };

  // Multi-user: notices about data refreshed from, or contended with, other users
  const [syncNotice, setSyncNotice] = useState<{ text: string; kind: 'info' | 'warn' } | null>(null);
  const lastRemoteCountRef = React.useRef(0);

  // Session lost or expired: a write may not have been saved, so say so plainly.
  const [sessionLost, setSessionLost] = useState(false);
  useEffect(() => {
    return onSessionExpired(() => setSessionLost(true));
  }, []);

  useEffect(() => {
    return onEditConflict((n) => {
      setSyncNotice({
        kind: 'warn',
        text: `«${n.label}»: ${n.ids.length} مورد که ویرایش کردید، هم‌زمان توسط کاربر دیگری نیز تغییر کرده بود. تغییر شما ثبت شد؛ لطفاً صحت اطلاعات را بازبینی کنید.`,
      });
    });
  }, []);

  useEffect(() => {
    if (store.remoteChangeCount > lastRemoteCountRef.current) {
      lastRemoteCountRef.current = store.remoteChangeCount;
      setSyncNotice({ kind: 'info', text: 'اطلاعات با تغییرات سایر کاربران به‌روزرسانی شد.' });
    }
  }, [store.remoteChangeCount]);

  useEffect(() => {
    if (!syncNotice) return;
    const t = setTimeout(() => setSyncNotice(null), syncNotice.kind === 'warn' ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [syncNotice]);

  // Project confirmation upload state
  const [projectToUploadDoc, setProjectToUploadDoc] = useState<Project | null>(null);
  const prevProjectStatusesRef = React.useRef<Record<string, string>>({});
  const isInitialLoadRef = React.useRef(true);

  // Monitor project status changes (to won/semi-won)
  useEffect(() => {
    // Wait until projects are actually loaded — an empty array on first render
    // would set isInitialLoadRef=false before prevStatuses is seeded, making
    // every won project appear as "new & won" on the next render and opening
    // the upload modal for all of them at login.
    if (!store.isInitialized || !store.projects || store.projects.length === 0) return;

    const prevStatuses = prevProjectStatusesRef.current;

    if (isInitialLoadRef.current) {
      // Seed known statuses so subsequent renders only fire on real transitions.
      store.projects.forEach(project => {
        prevStatuses[project.id] = project.status;
      });
      isInitialLoadRef.current = false;
      return;
    }

    store.projects.forEach(project => {
      const prevStatus = prevStatuses[project.id];
      const currentStatus = project.status;

      if (prevStatus === undefined) {
        // Project not seen before (e.g. added by another user via polling).
        // Seed it without triggering — the user didn't make this transition.
        prevStatuses[project.id] = currentStatus;
        return;
      }

      if (prevStatus !== currentStatus) {
        const wasWonBefore = prevStatus === 'برنده (موفق)' || prevStatus === 'نیمه برنده';
        const isWon = currentStatus === 'برنده (موفق)' || currentStatus === 'نیمه برنده';
        if (isWon && !wasWonBefore) {
          // Trigger modal with short delay to allow background updates to complete
          setTimeout(() => {
            setProjectToUploadDoc(project);
          }, 100);
        }
      }

      // Keep record updated
      prevStatuses[project.id] = currentStatus;
    });
  }, [store.isInitialized, store.projects]);

  const handleSaveConfirmationDoc = (updatedProject: Project, url: string, fileName: string, folderName: string) => {
    store.updateProject(updatedProject);
    alert(`مدرک "${fileName}" با موفقیت در پوشه "${folderName}" پروژه ذخیره گردید.`);
  };
  
  // Snooze options state
  const [showSnoozeOptions, setShowSnoozeOptions] = useState<boolean>(false);
  const [customSnoozeDate, setCustomSnoozeDate] = useState<string>('');
  const [customSnoozeTime, setCustomSnoozeTime] = useState<string>('');

  const handleApplySnooze = (minutes: number) => {
    if (!activeReminderTask) return;

    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);

    const shamsiDate = toShamsiStr(now);
    const shamsiTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    tasksApi.update(activeReminderTask.id, {
      ...taskToWriteInput(activeReminderTask),
      reminderEnabled: true,
      reminderDate: shamsiDate,
      reminderTime: shamsiTime,
    }).catch(err => {
      console.error('Failed to snooze task:', err);
    });

    setTriggeredReminders(prev => prev.filter(id => id !== activeReminderTask.id));
    setActiveReminderTask(null);
    setShowSnoozeOptions(false);
  };

  const handleSaveCustomSnooze = () => {
    if (!activeReminderTask || !customSnoozeDate || !customSnoozeTime) return;

    tasksApi.update(activeReminderTask.id, {
      ...taskToWriteInput(activeReminderTask),
      reminderEnabled: true,
      reminderDate: customSnoozeDate,
      reminderTime: customSnoozeTime,
    }).catch(err => {
      console.error('Failed to snooze task:', err);
    });

    setTriggeredReminders(prev => prev.filter(id => id !== activeReminderTask.id));
    setActiveReminderTask(null);
    setShowSnoozeOptions(false);
  };

  // Real-time reminders checker effect
  useEffect(() => {
    if (!store.isInitialized || !store.currentUser) return;

    const interval = setInterval(async () => {
      const today = getTodayShamsi();
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      try {
        // Fetch tasks with reminders matching current date and time from API
        const response = await fetch(
          `/api/tasks/reminders?date=${encodeURIComponent(today)}&time=${encodeURIComponent(currentTime)}`,
          { credentials: 'same-origin' }
        );

        if (!response.ok) return;

        const data = await response.json();
        if (!data.success || !data.tasks || data.tasks.length === 0) return;

        // Find first task not already triggered
        const matchingTask = data.tasks.find((t: any) => !triggeredReminders.includes(t.id));

        if (matchingTask) {
          setTriggeredReminders(prev => [...prev, matchingTask.id]);
          setActiveReminderTask(matchingTask);

          // Play clean notification sound using Web Audio API safely
          try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass && typeof AudioContextClass === 'function' && AudioContextClass.prototype) {
              const audioCtx = new (AudioContextClass as any)();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.type = 'sine';
              osc.frequency.setValueAtTime(880, audioCtx.currentTime);
              gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.35);
            }
          } catch (e) {
            console.log("Audio notify blocked or failed:", e);
          }
        }
      } catch (err) {
        // Silently fail — reminders are a convenience, not critical
        console.error('Failed to check reminders:', err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [store.isInitialized, store.currentUser, triggeredReminders]);

  if (!store.isInitialized) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col justify-center items-center gap-3 font-sans">
        <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-bold text-slate-300">در حال راه‌اندازی سامانه ERP ابزار تامین ارشیا...</p>
      </div>
    );
  }

  // If there is no user logged in, intercept and show the LoginView
  if (!store.currentUser) {
    // Reaching the login screen means any earlier "session lost" notice has
    // served its purpose; leaving it set would show the modal again after a
    // successful sign-in.
    return (
      <LoginView
        onLogin={async (username, password) => {
          const result = await store.login(username, password);
          if (result.success) setSessionLost(false);
          return result;
        }}
        onLoginSuccess={store.loginWithUser}
      />
    );
  }

  const renderActiveView = () => {
    // Granular Module Permission Check
    const hasPermission = store.currentUser && (!store.currentUser.permissions || store.currentUser.permissions[activeView as keyof typeof store.currentUser.permissions] !== false);
    if (!hasPermission) {
      return (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center max-w-lg mx-auto my-12 shadow-sm space-y-4 text-right" dir="rtl">
          <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto">
            <ShieldAlert size={32} />
          </div>
          <h2 className="text-lg font-bold text-slate-800">عدم دسترسی به ماژول</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            حساب کاربری شما اجازه دسترسی به ماژول «{
              activeView === 'users' ? 'مدیریت کاربران' : 
              activeView === 'settings' ? 'تنظیمات سیستم' : 
              activeView === 'transactions' ? 'دریافت و پرداخت ریالی' :
              
              activeView === 'packagingDelivery' ? 'بسته‌بندی و تحویل کالا' :
              activeView === 'afterSalesServices' ? 'خدمات پس از فروش' :

              activeView
            }» را ندارد.
            لطفاً در صورت نیاز به این بخش، با مدیریت ارشد سیستم (محمد توکل مقدم) هماهنگ فرمایید.
          </p>
        </div>
      );
    }

    switch (activeView) {
      case 'dashboard':
        return (
          // Every figure it shows is one server request now, so the eight
          // collections it used to be handed are gone.
          <DashboardView
            setActiveTab={setActiveView}
            currentUser={store.currentUser}
          />
        );
      case 'customers':
        return (
          // Reads its own data from the API: the eight collections this used to
          // be handed are now queries, not props.
          <CustomersView
            industries={store.settings.dropdownItems.industries}
            settings={store.settings}
            initialSearchQuery={selectedCustomerNameForSearch}
            onClearInitialSearchQuery={() => setSelectedCustomerNameForSearch(null)}
          />
        );
      case 'products':
        return (
          // Reads its own data from the API; the stock ledger is a separate
          // paginated query behind its own tab.
          <ProductsView
            categories={store.settings.dropdownItems.categories}
            units={store.settings.dropdownItems.units}
            settings={store.settings}          />
        );
      case 'proformas':
        return (
          <ProformasView
            initialPrintDocId={printDocumentRequest?.module === 'proformas' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            // Reads its own data from the API; the projects and customers it
            // shows come joined onto the page's rows. Products are now loaded
            // via useEntitySearch inside the component.
            settings={store.settings}
            currentUser={store.currentUser}
            categoryCompletion={categoryCompletion}
          />
        );
      case 'purchaseOrders':
        return (
          <PurchaseOrdersView
            initialPrintDocId={printDocumentRequest?.module === 'purchaseOrders' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            // Reads its own data from the API; landed cost and the stock
            // receipt are computed server-side.
            settings={store.settings}
            currentUser={store.currentUser}
            categoryCompletion={categoryCompletion}
          />
        );
      case 'suppliers':
        return (
          // Reads its own data from the API.
          <SuppliersView settings={store.settings} />
        );
      case 'projects':
        return (
          // Reads its own data from the API, including the activity/referral feed
          // — which it now loads per open project instead of being handed every
          // project's category groups to filter.
          <ProjectsView
            onOpenDocument={handleOpenDocument}
            settings={store.settings}
            currentUser={store.currentUser}
            initialSelectedProjectId={selectedProjectIdForActivities}
            onClearInitialSelectedProject={() => setSelectedProjectIdForActivities(null)}
          />
        );
      case 'referrals':
        return (
          <ReferralsView 
            initialTab={referralsTab}
            currentUser={store.currentUser}
            settings={store.settings}
            onViewProjectActivities={(projId) => {
              setSelectedProjectIdForActivities(projId);
              setActiveView('projects');
            }}
            onViewCustomerDetails={(custName) => {
              setSelectedCustomerNameForSearch(custName);
              setActiveView('customers');
            }}
          />
        );
      case 'transactions':
        return (
          <TransactionsView 
            initialPrintDocId={printDocumentRequest?.module === 'transactions' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            // Reads its own data from the API; the per-project financial
            // position is its own paginated query.            settings={store.settings}
          />
        );
            case 'tasks':
        return (
          // Reads its own data from the API, scoped by assignment.
          <TasksView
            settings={store.settings}
            currentUser={store.currentUser}
          />
        );
      case 'packagingDelivery':
        return (
          <PackagingDeliveryView
            initialPrintDocId={printDocumentRequest?.module === 'packagingDelivery' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            settings={store.settings}
            currentUser={store.currentUser}
            categoryCompletion={categoryCompletion}
          />
        );

      case 'afterSalesServices':
        return (
          <AfterSalesServicesView
            initialPrintDocId={printDocumentRequest?.module === 'afterSalesServices' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            settings={store.settings}
            currentUser={store.currentUser}
            categoryCompletion={categoryCompletion}
          />
        );
      case 'supplierInquiries':
        return (
          <SupplierInquiriesView            settings={store.settings}
          />
        );
      case 'settings':

        return (
          <SettingsView 
            settings={store.settings}
            updateSettings={store.updateSettings}
            userRole={store.userRole}
            changeRole={store.changeRole}
            currentUser={store.currentUser}
          />
        );
      case 'users':
        return (
          <UsersView
            settings={store.settings}
            currentUser={store.currentUser}
          />
        );
      default:
        return <div className="text-slate-500">محیط در حال ساخت...</div>;
    }
  };

  const currentUserName = store.currentUser?.fullName || 'محمد توکل مقدم';
  const isManagerOrAdmin = store.currentUser?.role === 'admin' || store.currentUser?.isSystemAdmin;

  const activeTemplate = store.settings?.proformaTemplates?.find(t => t.name === store.settings?.activeTemplateId) || store.settings?.proformaTemplates?.[0];
  const logoUrl = activeTemplate?.logoUrl;
  const isStandalone = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('standalone') === 'true';

  return (
    <div className={`flex h-screen bg-slate-50 font-sans text-right ${isStandalone ? 'p-0' : ''}`} dir="rtl">
      
      {/* Sidebar Navigation */}
      {!isStandalone && (
        <Sidebar 
          activeTab={activeView} 
          setActiveTab={setActiveView} 
          taskCount={badges.openTasks}
          lowStockCount={badges.lowStock}
          userRole={store.userRole}
          changeRole={store.changeRole}
          referralsCount={badges.pendingReferrals}
          currentUser={store.currentUser}
          onLogout={store.logout}
          sidebarModuleOrder={store.settings.sidebarModuleOrder}
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
          logoUrl={logoUrl}
        />
      )}

      {/* Main Panel Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {!isStandalone && (
          <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-10 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition"
                title={sidebarOpen ? "بستن منو" : "باز کردن منو"}
              >
                <Menu size={20} />
              </button>
              <div className="font-bold text-slate-800 text-sm md:text-base hidden sm:block">سیستم مدیریت منابع سازمانی</div>
            </div>
            <div className="flex items-center gap-5 mr-auto">
               <button 
                 onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                 className="text-slate-500 hover:text-amber-500 transition p-1"
                 title={theme === 'dark' ? "تغییر به پوسته روشن" : "تغییر به پوسته تیره"}
               >
                 {theme === 'dark' ? <Sun size={22} className="text-amber-400" /> : <Moon size={22} />}
               </button>
               <button 
                 className="relative text-slate-500 hover:text-amber-600 transition p-1"
                 onClick={() => { setReferralsTab('toMe'); setActiveView('referrals'); }}
                 title="ارجاعات کار (نیاز به اقدام)"
               >
                 <Inbox size={22} />
                 {badges.pendingReferrals > 0 && (
                   <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-amber-500 text-[10px] font-bold flex justify-center items-center rounded-full text-white shadow-sm border-2 border-white">
                     {badges.pendingReferrals}
                   </span>
                 )}
               </button>
               <button 
                 className="relative text-slate-500 hover:text-sky-600 transition p-1"
                 onClick={() => setCalendarOpen(true)}
                 title="تقویم پیگیری و وظایف روزانه"
               >
                 <Calendar size={22} />
                 {badges.openTasks > 0 && (
                   <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-sky-500 text-[10px] font-bold flex justify-center items-center rounded-full text-white shadow-sm border-2 border-white">
                     {badges.openTasks}
                   </span>
                 )}
               </button>
               <button 
                 className="relative text-slate-500 hover:text-rose-600 transition p-1"
                 onClick={() => { setReferralsTab('notifications'); setActiveView('referrals'); }} 
                 title="اعلان‌های سیستم"
               >
                 <Bell size={22} />
                 {badges.unreadNotifications > 0 && (
                   <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-[10px] font-bold flex justify-center items-center rounded-full text-white shadow-sm border-2 border-white">
                     {badges.unreadNotifications}
                   </span>
                 )}
               </button>
            </div>
          </header>
        )}

        <div className={`flex-1 overflow-y-auto ${isStandalone ? 'p-0 bg-white' : 'p-4 md:p-8 space-y-6'}`}>
          {renderActiveView()}
        </div>
      </main>

      {/* Session lost — blocking, because unsaved changes may have been rejected */}
      {sessionLost && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[1400] flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden">
            <div className="bg-rose-500 p-4 text-white flex items-center gap-3">
              <ShieldAlert size={22} />
              <h3 className="font-bold text-sm sm:text-base">نشست شما پایان یافته است</h3>
            </div>
            <div className="p-5 space-y-3 text-right">
              <p className="text-xs text-slate-600 leading-relaxed">
                دسترسی شما به سامانه منقضی شده یا سطح دسترسی‌تان تغییر کرده است.
                <strong className="text-rose-600"> آخرین تغییراتی که ثبت کرده‌اید ممکن است ذخیره نشده باشد.</strong>
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                لطفاً دوباره وارد شوید و صحت آخرین اطلاعاتی که ثبت کردید را بررسی کنید.
              </p>
              <button
                onClick={() => { store.logout(); window.location.reload(); }}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition"
              >
                ورود دوباره به سامانه
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-user sync notice */}
      {syncNotice && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1300] max-w-md w-[calc(100%-2rem)] animate-fade-in" dir="rtl">
          <div className={`flex items-start gap-2.5 rounded-xl shadow-lg border px-4 py-3 ${
            syncNotice.kind === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'
          }`}>
            {syncNotice.kind === 'warn'
              ? <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              : <RefreshCw size={16} className="shrink-0 mt-0.5" />}
            <p className="text-[11px] font-bold leading-relaxed flex-1">{syncNotice.text}</p>
            <button
              onClick={() => setSyncNotice(null)}
              className="shrink-0 opacity-60 hover:opacity-100 transition text-xs font-bold"
              title="بستن"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Task Calendar Modal */}
      <TaskCalendarModal
        isOpen={calendarOpen} 
        onClose={() => setCalendarOpen(false)} 
        tasks={store.tasks} 
        onUpdateTask={store.updateTask}
        currentUser={store.currentUser}
      />

      {/* Active Reminder Alert Modal */}
      {activeReminderTask && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden animate-scale-in flex flex-col">
            <div className="bg-amber-500 p-4 text-white flex items-center gap-3 shrink-0">
              <div className="bg-white/10 p-2 rounded-xl text-white animate-bounce">
                <Bell size={24} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">یادآوری زمان‌بندی شده وظیفه</h3>
                <p className="text-white/80 text-[10px] sm:text-xs">سیستم خودکار یادآوری ابزار تامین ارشیا</p>
              </div>
            </div>

            <div className="p-5 space-y-4 text-right overflow-y-auto max-h-[calc(100vh-10rem)]">
              {!showSnoozeOptions ? (
                <>
                  <div className="space-y-1">
                    <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100 inline-block">
                      سررسید و موعد مقرر اقدام
                    </span>
                    <h4 className="font-bold text-base text-slate-800 leading-snug">
                      {activeReminderTask.title}
                    </h4>
                  </div>

                  {activeReminderTask.description && (
                    <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-relaxed">
                      {activeReminderTask.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-slate-400 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-1.5">
                      <User size={12} />
                      <span>مسئول: {activeReminderTask.assignedTo || 'شخصی (خود شما)'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mr-auto font-mono">
                      <Clock size={12} />
                      <span>زمان یادآور: {activeReminderTask.reminderTime}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        tasksApi.update(activeReminderTask.id, {
                          ...taskToWriteInput(activeReminderTask),
                          status: 'انجام شده'
                        }).catch(err => {
                          console.error('Failed to update task:', err);
                        });
                        setActiveReminderTask(null);
                        setShowSnoozeOptions(false);
                      }}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 cursor-pointer"
                    >
                      <CheckCircle2 size={14} />
                      تغییر وضعیت به انجام شده
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date();
                        setCustomSnoozeDate(getTodayShamsi());
                        setCustomSnoozeTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
                        setShowSnoozeOptions(true);
                      }}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                    >
                      بستن و بعداً پیگیری می‌کنم
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4 animate-fade-in">
                  <div className="border-b border-slate-100 pb-3 text-right">
                    <h4 className="font-bold text-sm text-slate-800">تعیین زمان یادآوری بعدی</h4>
                    <p className="text-[10px] text-slate-400 mt-1">زمان مناسب برای یادآوری مجدد این وظیفه را مشخص کنید:</p>
                  </div>

                  {/* Quick Snooze Presets */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleApplySnooze(10)}
                      className="p-2.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-medium transition cursor-pointer text-center"
                    >
                      ۱۰ دقیقه دیگر
                    </button>
                    <button
                      onClick={() => handleApplySnooze(30)}
                      className="p-2.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-medium transition cursor-pointer text-center"
                    >
                      ۳۰ دقیقه دیگر
                    </button>
                    <button
                      onClick={() => handleApplySnooze(60)}
                      className="p-2.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-medium transition cursor-pointer text-center"
                    >
                      ۱ ساعت دیگر
                    </button>
                    <button
                      onClick={() => handleApplySnooze(1440)}
                      className="p-2.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-medium transition cursor-pointer text-center"
                    >
                      فردا همین ساعت
                    </button>
                  </div>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-200"></div>
                    <span className="flex-shrink mx-4 text-[10px] font-bold text-slate-400 bg-white px-2">یا تاریخ و ساعت دلخواه</span>
                    <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  {/* Custom Shamsi Date & Time Selector */}
                  <div className="space-y-3">
                    <div>
                      <ShamsiDatePicker
                        label="تاریخ یادآوری مجدد"
                        required
                        value={customSnoozeDate}
                        onChange={(val) => setCustomSnoozeDate(val)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-500 block">ساعت یادآوری مجدد</label>
                      <input
                        type="time"
                        required
                        value={customSnoozeTime}
                        onChange={(e) => setCustomSnoozeTime(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-right font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={handleSaveCustomSnooze}
                      className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 cursor-pointer text-center"
                    >
                      ثبت زمان یادآوری جدید
                    </button>
                    <button
                      onClick={() => setShowSnoozeOptions(false)}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                    >
                      بازگشت
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Category Completion Prompt Modal - supports both store and API-based modules */}
      <ConfirmModal
        isOpen={!!store.completionPrompt || !!categoryCompletion.prompt}
        onClose={() => {
          store.setCompletionPrompt(null);
          categoryCompletion.dismissPrompt();
        }}
        onConfirm={async () => {
          // Store-based modules (old)
          if (store.completionPrompt) {
            store.completeCategoryGroup(store.completionPrompt.projectId, store.completionPrompt.categoryName);
            store.setCompletionPrompt(null);
          }
          // API-based modules (new)
          if (categoryCompletion.prompt) {
            await categoryCompletion.confirmCompletion();
          }
        }}
        title="اتمام کار فعالیت"
        message={store.completionPrompt?.message || categoryCompletion.prompt?.message || ''}
        confirmText="بله، تغییر یابد"
        cancelText="انصراف"
      />

      {/* Project Confirmation Upload Modal */}
      <ProjectConfirmationUploadModal
        isOpen={!!projectToUploadDoc}
        project={projectToUploadDoc}
        onClose={() => setProjectToUploadDoc(null)}
        onSave={handleSaveConfirmationDoc}
      />
    </div>
  );
}

