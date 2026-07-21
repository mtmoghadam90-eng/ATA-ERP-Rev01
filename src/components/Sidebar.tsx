import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Briefcase, 
  FileText, 
  Package, 
  Truck, 
  ShoppingCart, 
  ArrowDownLeft, 
  ArrowUpRight, 
  TrendingUp, 
  CheckSquare, 
  BarChart3, 
  Settings as SettingsIcon,
  Menu,
  X,
  Clock,
  Inbox,
  ShieldCheck,
  HelpCircle,
  Boxes,
  Wrench,
  ArrowLeftRight
} from 'lucide-react';
import { User } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  taskCount: number;
  lowStockCount: number;
  userRole?: 'admin' | 'user';
  changeRole?: (role: 'admin' | 'user') => void;
  referralsCount?: number;
  currentUser?: User | null;
  onLogout?: () => void;
  sidebarModuleOrder?: string[];
  isOpen?: boolean;
  setIsOpen?: (open: boolean) => void;
  logoUrl?: string;
}

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  taskCount, 
  lowStockCount, 
  userRole, 
  changeRole, 
  referralsCount = 0, 
  currentUser, 
  onLogout, 
  sidebarModuleOrder,
  isOpen: propIsOpen,
  setIsOpen: propSetIsOpen,
  logoUrl
}: SidebarProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(true);
  const isOpen = propIsOpen !== undefined ? propIsOpen : internalIsOpen;
  const setIsOpen = propSetIsOpen !== undefined ? propSetIsOpen : setInternalIsOpen;

  const menuItems = [
    { id: 'dashboard', name: 'داشبورد', icon: LayoutDashboard },
    { id: 'customers', name: 'مشتریان', icon: Users },
    { id: 'projects', name: 'پروژه‌ها (فرصت‌ها)', icon: Briefcase },
    { id: 'proformas', name: 'پیش‌فاکتورها', icon: FileText },
    { id: 'products', name: 'کالا و انبار', icon: Package },
    { id: 'suppliers', name: 'تأمین‌کنندگان', icon: Truck },
    { id: 'supplierInquiries', name: 'استعلام قیمت تأمین‌کنندگان', icon: ArrowLeftRight },
    { id: 'purchaseOrders', name: 'سفارشات خرید خارجی', icon: ShoppingCart },
    { id: 'packagingDelivery', name: 'بسته‌بندی و تحویل کالا', icon: Boxes },
    { id: 'afterSalesServices', name: 'خدمات پس از فروش', icon: Wrench },
    { id: 'transactions', name: 'دریافت و پرداخت ریالی', icon: ArrowDownLeft },
    { id: 'tasks', name: 'وظایف و پیگیری', icon: CheckSquare, badge: taskCount > 0 ? String(taskCount) : null, badgeColor: 'bg-sky-500 text-white' },
    { id: 'referrals', name: 'کارتابل ارجاعات کار', icon: Inbox, badge: referralsCount > 0 ? String(referralsCount) : null, badgeColor: 'bg-amber-500 text-slate-900 font-extrabold animate-pulse' },
    { id: 'users', name: 'مدیریت کاربران', icon: ShieldCheck },
        { id: 'settings', name: 'تنظیمات سیستم', icon: SettingsIcon },
  ];

  // Sort menu items based on custom order if configured
  const orderedMenuItems = [...menuItems];
  if (sidebarModuleOrder && sidebarModuleOrder.length > 0) {
    orderedMenuItems.sort((a, b) => {
      const idxA = sidebarModuleOrder.indexOf(a.id);
      const idxB = sidebarModuleOrder.indexOf(b.id);
      const posA = idxA === -1 ? 999 : idxA;
      const posB = idxB === -1 ? 999 : idxB;
      return posA - posB;
    });
  }

  // Filter menu items dynamically according to the logged-in user's active permissions
  const allowedMenuItems = orderedMenuItems.filter(item => {
    if (!currentUser) return true;
    if (currentUser.permissions && currentUser.permissions[item.id as keyof typeof currentUser.permissions] === false) {
      return false;
    }
    return true;
  });

  return (
    <>
      {/* Sidebar container */}
      <div className={`
        relative inset-y-0 right-0 z-40 bg-slate-900 text-slate-100 flex flex-col h-screen border-l border-slate-800
        transition-all duration-300 ease-in-out shadow-2xl flex-shrink-0
        ${isOpen ? 'w-64' : 'w-0 lg:w-20'}
        overflow-hidden
      `}>
        {/* Brand Header */}
        <div className={`p-4 border-b border-slate-800 flex ${isOpen ? 'justify-start' : 'justify-center'} items-center bg-slate-950 transition-all duration-300`}>
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sky-400 flex items-center justify-center shadow-lg shadow-slate-950/50 flex-shrink-0 w-10 h-10 overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="لوگو" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              ) : (
                <svg className="text-sky-400" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {/* Gauge representation for precision instrumentation & tools */}
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeWidth="1.5" className="stroke-sky-500/40" />
                  <circle cx="12" cy="11" r="3.5" />
                  <path d="M12 11l2-2" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="12" cy="11" r="1" fill="currentColor" />
                </svg>
              )}
            </div>
            {isOpen && (
              <div className="flex flex-col overflow-hidden">
                <span className="font-bold text-sm text-slate-100 leading-tight whitespace-nowrap">ابزار تامین ارشیا</span>
                <span className="text-[9px] text-sky-400 mt-0.5 tracking-wider font-mono">ERP SYSTEM v2.5</span>
              </div>
            )}
          </div>
        </div>

        {/* User profile brief */}
        {currentUser && (
          <div className="px-4 py-4 border-b border-slate-800 bg-slate-900/50 flex flex-col gap-2">
            <div className={`flex items-center ${isOpen ? 'gap-3' : 'justify-center'}`}>
              <div className="w-10 h-10 rounded-full bg-slate-700 border-2 border-sky-500/50 flex items-center justify-center font-bold text-sky-400 flex-shrink-0 shadow-inner">
                {currentUser.fullName.substring(0, 2)}
              </div>
              {isOpen && (
                <div className="flex flex-col overflow-hidden">
                  <span className="text-xs font-semibold text-slate-200 truncate">{currentUser.fullName}</span>
                  <span className="text-[10px] text-slate-400 truncate">
                    سمت: {currentUser.position || (currentUser.role === 'admin' ? 'مدیر سیستم / فنی' : 'کارشناس')}
                  </span>
                </div>
              )}
            </div>
            {/* Logout Button */}
            {onLogout && isOpen && (
              <button
                onClick={onLogout}
                className="mt-1 text-center text-[10px] font-bold text-rose-400 hover:text-rose-300 py-1 border border-rose-500/20 hover:border-rose-500/40 rounded transition bg-rose-500/5 whitespace-nowrap overflow-hidden"
              >
                خروج از حساب کاربری
              </button>
            )}
          </div>
        )}

        {/* Navigation items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {allowedMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (window.innerWidth < 1024) setIsOpen(false); // Auto close on mobile click
                }}
                className={`
                  w-full flex items-center ${isOpen ? 'gap-3 px-3 justify-start' : 'justify-center'} py-3 rounded-lg text-sm font-medium transition-all duration-200
                  ${isActive 
                    ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/10' 
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }
                  group relative
                `}
              >
                <Icon size={18} className={`flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />
                
                {/* Text showing depending on sidebar state */}
                {(isOpen) ? (
                  <span className="truncate flex-1 text-right">{item.name}</span>
                ) : (
                  <span className="absolute right-16 bg-slate-950 text-slate-200 px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none whitespace-nowrap z-50">
                    {item.name}
                  </span>
                )}

                {/* Badges/Alerts */}
                {item.badge && isOpen && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold leading-none ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        {isOpen && (
          <div className="p-4 border-t border-slate-800 bg-slate-950 text-[10px] text-slate-500 text-center flex flex-col gap-1">
            <span>طراحی شده برای صنعت ابزاردقیق</span>
            <span>شرکت ابزار تامین ارشیا © 2026</span>
          </div>
        )}
      </div>
    </>
  );
}
