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
import { useERPStore } from './useERPStore';
import { ShieldAlert, Bell, Inbox, Menu, Calendar, CheckCircle2, Clock, User, Sun, Moon } from 'lucide-react';
import TaskCalendarModal from './components/TaskCalendarModal';
import { getTodayShamsi, toShamsiStr } from './dateUtils';
import ShamsiDatePicker from './components/ShamsiDatePicker';
import ConfirmModal from './components/ConfirmModal';
import ProjectConfirmationUploadModal from './components/ProjectConfirmationUploadModal';
import { Project } from './types';

export default function App() {
  const store = useERPStore();
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

  // Project confirmation upload state
  const [projectToUploadDoc, setProjectToUploadDoc] = useState<Project | null>(null);
  const prevProjectStatusesRef = React.useRef<Record<string, string>>({});
  const isInitialLoadRef = React.useRef(true);

  // Monitor project status changes (to won/semi-won)
  useEffect(() => {
    if (!store.isInitialized || !store.projects) return;

    const prevStatuses = prevProjectStatusesRef.current;
    
    if (isInitialLoadRef.current) {
      store.projects.forEach(project => {
        prevStatuses[project.id] = project.status;
      });
      isInitialLoadRef.current = false;
      return;
    }

    store.projects.forEach(project => {
      const prevStatus = prevStatuses[project.id];
      const currentStatus = project.status;

      const isNewProject = prevStatus === undefined;
      const isWon = currentStatus === 'برنده (موفق)' || currentStatus === 'نیمه برنده';
      
      let triggered = false;
      if (isNewProject) {
        if (isWon) {
          triggered = true;
        }
      } else if (prevStatus !== currentStatus) {
        const wasWonBefore = prevStatus === 'برنده (موفق)' || prevStatus === 'نیمه برنده';
        if (isWon && !wasWonBefore) {
          triggered = true;
        }
      }

      if (triggered) {
        // Trigger modal with short delay to allow background updates to complete
        setTimeout(() => {
          setProjectToUploadDoc(project);
        }, 100);
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

    store.updateTask({
      ...activeReminderTask,
      reminderEnabled: true,
      reminderDate: shamsiDate,
      reminderTime: shamsiTime,
    });

    setTriggeredReminders(prev => prev.filter(id => id !== activeReminderTask.id));
    setActiveReminderTask(null);
    setShowSnoozeOptions(false);
  };

  const handleSaveCustomSnooze = () => {
    if (!activeReminderTask || !customSnoozeDate || !customSnoozeTime) return;

    store.updateTask({
      ...activeReminderTask,
      reminderEnabled: true,
      reminderDate: customSnoozeDate,
      reminderTime: customSnoozeTime,
    });

    setTriggeredReminders(prev => prev.filter(id => id !== activeReminderTask.id));
    setActiveReminderTask(null);
    setShowSnoozeOptions(false);
  };

  // Real-time reminders checker effect
  useEffect(() => {
    if (!store.isInitialized || !store.tasks) return;

    const interval = setInterval(() => {
      const today = getTodayShamsi();
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Find any task with matching reminder date and time
      const matchingTask = store.tasks.find(t => 
        t.reminderEnabled && 
        t.reminderDate === today && 
        t.reminderTime === currentTime && 
        t.status !== 'انجام شده' &&
        !triggeredReminders.includes(t.id)
      );

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
    }, 10000);

    return () => clearInterval(interval);
  }, [store.isInitialized, store.tasks, triggeredReminders]);

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
    return <LoginView onLogin={store.login} onLoginSuccess={store.loginWithUser} />;
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
          <DashboardView 
            products={store.products}
            customers={store.customers}
            projects={store.projects}
            proformas={store.proformas}
            packagingDeliveries={store.packagingDeliveries}
            transactions={store.transactions}
            purchaseOrders={store.purchaseOrders}
            exchangeRates={store.exchangeRates}
            tasks={store.tasks}
            setActiveTab={setActiveView}
            lowStockProducts={store.products.filter(p => p.stockLevel <= p.minStockLevel)}
            currentUser={store.currentUser}
            projectCategoryGroups={store.projectCategoryGroups}
            onUpdateTask={store.updateTask}
          />
        );
      case 'customers':
        return (
          <CustomersView 
            customers={store.customers}
            addCustomer={store.addCustomer}
            updateCustomer={store.updateCustomer}
            deleteCustomer={store.deleteCustomer}
            batchUpdateCustomers={store.batchUpdateCustomers}
            industries={store.settings.dropdownItems.industries}
            settings={store.settings}
            initialSearchQuery={selectedCustomerNameForSearch}
            onClearInitialSearchQuery={() => setSelectedCustomerNameForSearch(null)}
          />
        );
      case 'products':
        return (
          <ProductsView 
            products={store.products}
            inventoryTransactions={store.inventoryTransactions}
            addProduct={store.addProduct}
            updateProduct={store.updateProduct}
            deleteProduct={store.deleteProduct}
            adjustProductStock={store.adjustProductStock}
            batchImportProducts={store.batchImportProducts}
            categories={store.settings.dropdownItems.categories}
            units={store.settings.dropdownItems.units}
            settings={store.settings}
            exchangeRates={store.exchangeRates}
          />
        );
      case 'proformas':
        return (
          <ProformasView 
            initialPrintDocId={printDocumentRequest?.module === 'proformas' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            proformas={store.proformas}
            customers={store.customers}
            projects={store.projects}
            products={store.products}
            settings={store.settings}
            exchangeRates={store.exchangeRates}
            addProforma={store.addProforma}
            updateProforma={store.updateProforma}
            updateProformaStatus={store.updateProformaStatus}
            batchUpdateProjectProformasStatus={store.batchUpdateProjectProformasStatus}
            deleteProforma={store.deleteProforma}
            addCustomer={store.addCustomer}
            updateCustomer={store.updateCustomer}
            addProject={store.addProject}
            addProduct={store.addProduct}
            users={store.users}
            transactions={store.transactions}
            packagingDeliveries={store.packagingDeliveries}
            currentUser={store.currentUser}
          />
        );
      case 'purchaseOrders':
        return (
          <PurchaseOrdersView 
            initialPrintDocId={printDocumentRequest?.module === 'purchaseOrders' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            purchaseOrders={store.purchaseOrders}
            suppliers={store.suppliers}
            projects={store.projects}
            products={store.products}
            exchangeRates={store.exchangeRates}
            proformas={store.proformas}
            supplierInquiries={store.supplierInquiries || []}
            addPurchaseOrder={store.addPurchaseOrder}
            updatePurchaseOrder={store.updatePurchaseOrder}
            updatePurchaseOrderStatus={store.updatePurchaseOrderStatus}
            deletePurchaseOrder={store.deletePurchaseOrder}
            settings={store.settings}
            addSupplier={store.addSupplier}
            addProject={store.addProject}
            addProduct={store.addProduct}
            customers={store.customers}
            addCustomer={store.addCustomer}
            currentUser={store.currentUser}
          />
        );
      case 'suppliers':
        return (
          <SuppliersView 
            suppliers={store.suppliers}
            addSupplier={store.addSupplier}
            updateSupplier={store.updateSupplier}
            deleteSupplier={store.deleteSupplier}
            settings={store.settings}
          />
        );
      case 'projects':
        return (
          <ProjectsView 
            onOpenDocument={handleOpenDocument}
            projects={store.projects}
            customers={store.customers}
            products={store.products}
            proformas={store.proformas}
            addProject={store.addProject}
            updateProject={store.updateProject}
            deleteProject={store.deleteProject}
            settings={store.settings}
            projectCategoryGroups={store.projectCategoryGroups}
            addProjectCategoryGroup={store.addProjectCategoryGroup}
            updateProjectCategoryGroup={store.updateProjectCategoryGroup}
            addProjectActivity={store.addProjectActivity}
            completeProjectCategoryGroup={store.completeProjectCategoryGroup}
            resumeProjectCategoryGroup={store.resumeProjectCategoryGroup}
            deleteProjectCategoryGroup={store.deleteProjectCategoryGroup}
            updateProjectActivity={store.updateProjectActivity}
            deleteProjectActivity={store.deleteProjectActivity}
            currentUser={store.currentUser}
            addCustomer={store.addCustomer}
            addProduct={store.addProduct}
            users={store.users}
            transactions={store.transactions}
            packagingDeliveries={store.packagingDeliveries}
            purchaseOrders={store.purchaseOrders}
            afterSalesServices={store.afterSalesServices}
            supplierInquiries={store.supplierInquiries || []}
            initialSelectedProjectId={selectedProjectIdForActivities}
            onClearInitialSelectedProject={() => setSelectedProjectIdForActivities(null)}
          />
        );
      case 'referrals':
        return (
          <ReferralsView 
            initialTab={referralsTab}
            readItems={store.readItems}
            markItemsAsRead={store.markItemsAsRead}
            users={store.users}
            projectCategoryGroups={store.projectCategoryGroups}
            projects={store.projects}
            respondToReferral={store.respondToReferral}
            toggleReferralStatus={store.toggleReferralStatus}
            currentUser={store.currentUser}
            settings={store.settings}
            moduleNotifications={store.moduleNotifications}
            markModuleNotificationAsRead={store.markModuleNotificationAsRead}
            markAllModuleNotificationsAsRead={store.markAllModuleNotificationsAsRead}
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
            transactions={store.transactions}
            customers={store.customers}
            suppliers={store.suppliers}
            projects={store.projects}
            proformas={store.proformas}
            exchangeRates={store.exchangeRates}
            addTransaction={store.addTransaction}
            updateTransaction={store.updateTransaction}
            deleteTransaction={store.deleteTransaction}
            settings={store.settings}
            addCustomer={store.addCustomer}
            addSupplier={store.addSupplier}
            addProject={store.addProject}
            updateProforma={store.updateProforma}
          />
        );
            case 'tasks':
        return (
          <TasksView 
            tasks={store.tasks}
            customers={store.customers}
            projects={store.projects}
            users={store.users}
            addTask={store.addTask}
            updateTask={store.updateTask}
            deleteTask={store.deleteTask}
            settings={store.settings}
            currentUser={store.currentUser}
            addCustomer={store.addCustomer}
            addProject={store.addProject}
          />
        );
      case 'packagingDelivery':
        return (
          <PackagingDeliveryView 
            initialPrintDocId={printDocumentRequest?.module === 'packagingDelivery' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            projects={store.projects}
            customers={store.customers}
            proformas={store.proformas}
            products={store.products}
            packagingDeliveries={store.packagingDeliveries}
            addPackagingDelivery={store.addPackagingDelivery}
            updatePackagingDelivery={store.updatePackagingDelivery}
            deletePackagingDelivery={store.deletePackagingDelivery}
            settings={store.settings}
            currentUser={store.currentUser}
          />
        );
      
      case 'afterSalesServices':
        return (
          <AfterSalesServicesView 
            initialPrintDocId={printDocumentRequest?.module === 'afterSalesServices' ? printDocumentRequest.docId : undefined}
            onClearInitialPrintDocId={handleClearPrintDoc}
            afterSalesServices={store.afterSalesServices}
            projects={store.projects}
            customers={store.customers}
            proformas={store.proformas}
            addAfterSalesService={store.addAfterSalesService}
            updateAfterSalesService={store.updateAfterSalesService}
            deleteAfterSalesService={store.deleteAfterSalesService}
            settings={store.settings}
            currentUser={store.currentUser}
          />
        );
      case 'supplierInquiries':
        return (
          <SupplierInquiriesView
            projects={store.projects}
            suppliers={store.suppliers}
            exchangeRates={store.exchangeRates}
            supplierInquiries={store.supplierInquiries || []}
            addSupplierInquiry={store.addSupplierInquiry}
            updateSupplierInquiry={store.updateSupplierInquiry}
            deleteSupplierInquiry={store.deleteSupplierInquiry}
            settings={store.settings}
          />
        );
      case 'settings':

        return (
          <SettingsView 
            settings={store.settings}
            updateSettings={store.updateSettings}
            userRole={store.userRole}
            changeRole={store.changeRole}
            projectCategoryGroups={store.projectCategoryGroups}
            users={store.users}
            currentUser={store.currentUser}
            projects={store.projects}
            auditLogs={store.auditLogs}
            exchangeRates={store.exchangeRates}
            updateExchangeRate={store.updateExchangeRate}
            fetchRatesFromAPI={store.fetchRatesFromAPI}
          />
        );
      case 'users':
        return (
          <UsersView 
            users={store.users}
            settings={store.settings}
            currentUser={store.currentUser}
            addUser={store.addUser}
            updateUser={store.updateUser}
            deleteUser={store.deleteUser}
          />
        );
      default:
        return <div className="text-slate-500">محیط در حال ساخت...</div>;
    }
  };

  const currentUserName = store.currentUser?.fullName || 'محمد توکل مقدم';
  const isManagerOrAdmin = store.currentUser?.role === 'admin' || store.currentUser?.isSystemAdmin;

  const readItems = new Set(store.readItems || []);

  let groupedNotifsUnread = 0;
  (store.projectCategoryGroups || []).forEach(group => {
    const cat = store.settings?.activityCategories?.find(c => c.id === group.categoryId);
    const isResponsible = isManagerOrAdmin || cat?.responsibleUserId === currentUserName;
    
    (group.activities || []).forEach((act) => {
      if (isResponsible && act.createdBy !== currentUserName) {
        if (!readItems.has(act.id)) groupedNotifsUnread++;
      }
      if (act.referral) {
        let messages = act.referral.messages ? [...act.referral.messages] : [];
        if (messages.length === 0 && act.referral.response) {
          messages = [act.referral.response];
        }
        messages.forEach((msg: any, idx: number) => {
           if ((isResponsible || act.referral?.assignedBy === currentUserName) && msg.responder !== currentUserName) {
             const id = msg.id || `${act.id}-msg-${msg.timestamp || parseInt((act.id || '').split('-').pop() || '0', 10) + idx + 1}`;
             if (!readItems.has(id)) groupedNotifsUnread++;
           }
        });
      }
    });
  });

  const unreadNotifsCount = (store.moduleNotifications || []).filter(n => !n.read && n.responsibleName === currentUserName).length;
  const totalUnreadCount = unreadNotifsCount + groupedNotifsUnread;

  const pendingReferrals = (store.projectCategoryGroups || []).flatMap(g => g.activities || [])
    .filter(a => a.referral && (a.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام' && a.referral.assignedTo === currentUserName);

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
          taskCount={store.tasks.filter(t => t.status !== 'انجام شده' && t.status !== 'کنسل شده').length}
          lowStockCount={store.products.filter(p => p.stockLevel <= p.minStockLevel).length}
          userRole={store.userRole}
          changeRole={store.changeRole}
          referralsCount={pendingReferrals.length}
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
                 {pendingReferrals.length > 0 && (
                   <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-amber-500 text-[10px] font-bold flex justify-center items-center rounded-full text-white shadow-sm border-2 border-white">
                     {pendingReferrals.length}
                   </span>
                 )}
               </button>
               <button 
                 className="relative text-slate-500 hover:text-sky-600 transition p-1"
                 onClick={() => setCalendarOpen(true)}
                 title="تقویم پیگیری و وظایف روزانه"
               >
                 <Calendar size={22} />
                 {store.tasks.filter(t => (!t.assignedTo || t.assignedTo === store.currentUser?.fullName) && t.status !== 'انجام شده' && t.status !== 'کنسل شده').length > 0 && (
                   <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-sky-500 text-[10px] font-bold flex justify-center items-center rounded-full text-white shadow-sm border-2 border-white">
                     {store.tasks.filter(t => (!t.assignedTo || t.assignedTo === store.currentUser?.fullName) && t.status !== 'انجام شده' && t.status !== 'کنسل شده').length}
                   </span>
                 )}
               </button>
               <button 
                 className="relative text-slate-500 hover:text-rose-600 transition p-1"
                 onClick={() => { setReferralsTab('notifications'); setActiveView('referrals'); }} 
                 title="اعلان‌های سیستم"
               >
                 <Bell size={22} />
                 {totalUnreadCount > 0 && (
                   <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-[10px] font-bold flex justify-center items-center rounded-full text-white shadow-sm border-2 border-white">
                     {totalUnreadCount}
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
                        store.updateTask({
                          ...activeReminderTask,
                          status: 'انجام شده'
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


      {/* Category Completion Prompt Modal */}
      <ConfirmModal
        isOpen={!!store.completionPrompt}
        onClose={() => store.setCompletionPrompt(null)}
        onConfirm={() => {
          if (store.completionPrompt) {
            store.completeCategoryGroup(store.completionPrompt.projectId, store.completionPrompt.categoryName);
            store.setCompletionPrompt(null);
          }
        }}
        title="اتمام کار فعالیت"
        message={store.completionPrompt?.message || ''}
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

