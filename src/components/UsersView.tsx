import React, { useState } from 'react';
import { User, ERPSettings } from '../types';
import ConfirmModal from './ConfirmModal';
import { compressAndResizeImage, uploadFile } from '../imageUtils';
import { ApiError } from '../api/client';
import { rowToUser, userToWriteInput, usersApi } from '../api/users';
import { useUserList } from '../api/useUserList';
import { invalidateUserDirectory } from '../api/useUserDirectory';
import { 
  UserPlus, 
  ShieldCheck, 
  ShieldAlert, 
  Key, 
  Edit2, 
  Trash2, 
  Search, 
  Check, 
  X, 
  Lock, 
  Eye, 
  EyeOff,
  UserCheck,
  Maximize2,
  Minimize2
} from 'lucide-react';

/**
 * User accounts.
 *
 * Reads through the API. Passwords never come back from the server, so the edit
 * form no longer pre-fills one: it is left blank and only sent when something
 * is typed, which is also the only way to change it.
 */
interface UsersViewProps {
  settings: ERPSettings;
  currentUser: User | null;
}

export default function UsersView({ settings, currentUser }: UsersViewProps) {
  const list = useUserList();
  const users = React.useMemo(() => list.rows.map(rowToUser), [list.rows]);
  const searchTerm = list.search;
  const setSearchTerm = list.setSearch;

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
  const [showAddModal, setShowAddModal] = useState(false);
  const [isAddModalFullscreen, setIsAddModalFullscreen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isEditModalFullscreen, setIsEditModalFullscreen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [position, setPosition] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signatureImage, setSignatureImage] = useState('');

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [userToDeleteId, setUserToDeleteId] = useState<string | null>(null);
  const [userToDeleteName, setUserToDeleteName] = useState<string>('');
  
  // Module permissions state
  const [permissions, setPermissions] = useState({
    dashboard: true,
    customers: true,
    projects: true,
    proformas: true,
    products: true,
    suppliers: true,
    purchaseOrders: true,
    transactions: true,
    tasks: true,
    referrals: true,
    settings: false,
    users: false,
    // Off unless granted. Unlike the module flags this one hides fields rather
    // than screens, so a new account should not learn what the company pays
    // just because nobody thought about it.
    costs: false,
  });

  // Module Persian names and descriptions
  const moduleList = [
    { id: 'dashboard', name: 'داشبورد', desc: 'نمودارها و خلاصه آمارهای کلیدی سیستم' },
    { id: 'customers', name: 'مشتریان', desc: 'مدیریت و ثبت اطلاعات کارفرمایان و صنایع' },
    { id: 'projects', name: 'پروژه‌ها (فرصت‌ها)', desc: 'خط لوله فروش و پرونده‌های فعال تجاری' },
    { id: 'proformas', name: 'پیش‌فاکتورها', desc: 'صدور و پیگیری پیش‌فاکتورهای ریالی کارفرمایان' },
    { id: 'products', name: 'کالاها و تجهیزات', desc: 'مدیریت مشخصات فنی کالاها، دسته‌بندی و تعریف تجهیزات ابزاردقیق' },
    { id: 'suppliers', name: 'تأمین‌کنندگان', desc: 'ثبت اطلاعات سازندگان و همکاران خارجی/داخلی' },
    { id: 'purchaseOrders', name: 'سفارشات خرید خارجی', desc: 'سفارشات خارجی، مراحل ساخت و اسناد حمل' },
    { id: 'transactions', name: 'دریافت و پرداخت ریالی', desc: 'تراکنش‌های بانکی، تنخواه‌ها و مطالبات مالی' },
    { id: 'tasks', name: 'وظایف و پیگیری', desc: 'پیگیری امور محوله و وظایف پرسنل ابزار دقیق' },
    { id: 'referrals', name: 'کارتابل ارجاعات کار', desc: 'کارتابل ارجاعات فنی و تسک‌های جاری ارشیا' },
    { id: 'settings', name: 'تنظیمات سیستم', desc: 'تغییر الگوهای پیش‌فاکتور، فیلدهای دلخواه و تنظیمات عمومی' },
    { id: 'users', name: 'مدیریت کاربران', desc: 'تعریف پرسنل، تغییر رمز عبور و تنظیم سطح دسترسی ماژول‌ها' },
    // Not a screen: it governs fields inside modules the user already has.
    { id: 'costs', name: 'مشاهده بهای خرید', desc: 'دیدن قیمت تمام شده: ماشین‌حساب قیمت کالا، هزینه‌های سفارش خرید و مبالغ آفر تأمین‌کنندگان. بدون این دسترسی، این اعداد نمایش داده نمی‌شوند و سفارش خرید و استعلام قابل ذخیره نیست.' },
  ];

  const handleRoleChange = (selectedRole: 'admin' | 'user') => {
    setRole(selectedRole);
    // If admin is selected, auto-enable all permissions
    if (selectedRole === 'admin') {
      setPermissions({
        dashboard: true,
        customers: true,
        projects: true,
        proformas: true,
        products: true,
        suppliers: true,
        purchaseOrders: true,
        transactions: true,
        tasks: true,
        referrals: true,
        settings: true,
        users: true,
        costs: true,
      });
    }
  };

  const handleTogglePermission = (modId: string) => {
    // If role is admin, keep everything true
    if (role === 'admin') return;
    setPermissions(prev => ({
      ...prev,
      [modId]: !prev[modId as keyof typeof prev]
    }));
  };

  const openAddModal = () => {
    setUsername('');
    setPassword('');
    setFullName('');
    setRole('user');
    setPosition('');
    setSignatureImage('');
    setPermissions({
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: false,
      tasks: true,
      referrals: true,
      settings: false,
      users: false,
      costs: false,
    });
    setShowPassword(false);
    setShowAddModal(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !fullName) {
      alert('لطفاً تمامی فیلدهای اجباری را تکمیل کنید.');
      return;
    }

    // A duplicate username is refused by the unique index rather than by
    // scanning the page this browser happens to be showing.
    try {
      await usersApi.create({
        ...userToWriteInput({
          username: username.trim(),
          fullName: fullName.trim(),
          role,
          position,
          signatureImage,
          permissions,
          isActive: true,
        }),
        password,
      });
      invalidateUserDirectory();
      list.refresh();
      setShowAddModal(false);
      setIsAddModalFullscreen(false);
    } catch (err) {
      reportError(err, 'ایجاد کاربر با خطا مواجه شد.');
    }
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setUsername(user.username);
    // Left blank on purpose: the server never returns a password, and an empty
    // field here means "keep the current one".
    setPassword('');
    setFullName(user.fullName);
    setRole(user.role);
    setPosition(user.position || '');
    setSignatureImage(user.signatureImage || '');
    setPermissions({
      ...user.permissions,
      // Absent means denied for this one (see canSeeCosts), so the box has to
      // show unticked rather than inheriting whatever spread produced.
      costs: user.permissions?.costs === true,
    });
    setShowPassword(false);
    setShowEditModal(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (!username || !fullName) {
      alert('نام کاربری و نام کامل نمی‌توانند خالی باشند.');
      return;
    }

    try {
      await usersApi.update(selectedUser.id, userToWriteInput({
        username: username.trim(),
        fullName: fullName.trim(),
        role,
        position,
        signatureImage,
        permissions,
        isActive: selectedUser.isActive,
      }));

      // The password is its own call, and only when one was typed. Setting it
      // signs that account out everywhere.
      if (password.trim()) {
        await usersApi.setPassword(selectedUser.id, password);
      }

      invalidateUserDirectory();
      list.refresh();
      setShowEditModal(false);
      setIsEditModalFullscreen(false);
    } catch (err) {
      reportError(err, 'ذخیره تغییرات کاربر با خطا مواجه شد.');
    }
  };

  const handleDeleteUser = (user: User) => {
    if (user.isSystemAdmin) {
      alert('کاربر اصلی سیستم (مدیرعامل مادری) قابل حذف نمی‌باشد.');
      return;
    }
    if (currentUser && user.id === currentUser.id) {
      alert('شما نمی‌توانید حساب کاربری جاری خودتان را حذف کنید.');
      return;
    }
    setUserToDeleteId(user.id);
    setUserToDeleteName(user.fullName);
    setDeleteConfirmOpen(true);
  };

  // Search is a query parameter now, so what arrives is already filtered.
  const filteredUsers = users;

  return (
    <div className="space-y-6">
      {/* Top Banner / Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-5" id="users-header">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <UserCheck className="text-sky-600" size={26} />
            مدیریت پرسنل و دسترسی کاربران
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            تعیین رمز عبور، سطوح امنیتی و دسترسی‌های اختصاصی برای تیم مهندسی و بازرگانی شرکت ابزار تامین ارشیا
          </p>
        </div>
        
        <button
          onClick={openAddModal}
          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-sky-600/15 transition-all active:scale-95"
        >
          <UserPlus size={18} />
          تعریف کاربر جدید
        </button>
      </div>

      {/* Warning Bar */}
      <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4 flex items-start gap-3 text-right">
        <ShieldAlert className="text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" size={20} />
        <div>
          <span className="text-xs font-bold text-amber-800 block">توجه امنیتی (حفظ سرمایه و اطلاعات محرمانه تجاری):</span>
          <span className="text-xs text-amber-700 mt-0.5 block leading-relaxed">
            مهندس توکل مقدم، طبق مانیفست مدیریت ریسک و حفظ سرمایه شرکت ارشیا، همواره دسترسی به ماژول‌های حساس نظیر «تنظیمات سیستم» و «دریافت و پرداخت مالی» را محدود به افراد تایید شده و واجد صلاحیت کنید. سطح دسترسی کارشناسان فنی را متناسب با ارجاعات کاری تنظیم نمایید.
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col md:flex-row gap-3 items-center">
        <div className="relative w-full md:w-80">
          <input
            type="text"
            placeholder="جستجوی کاربر (نام، نام کاربری)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
          />
          <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
        </div>
        <div className="text-xs text-slate-400 mr-auto font-mono">
          {/* The server's total, so it counts every match rather than the page. */}
          تعداد کاربران ثبت شده: {list.total.toLocaleString('fa-IR')} نفر
        </div>
      </div>

      {list.error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-xl p-4 flex items-center justify-between gap-3" id="users-error">
          <span>{list.error}</span>
          <button
            type="button"
            onClick={list.refresh}
            className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-[11px] font-bold transition"
          >
            تلاش دوباره
          </button>
        </div>
      )}

      {list.initialLoading && (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-xs text-slate-400 shadow-sm" id="users-loading">
          در حال دریافت کاربران…
        </div>
      )}

      {/* Users Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {filteredUsers.map((user) => (
          <div 
            key={user.id} 
            className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between"
          >
            <div>
              {/* User Card Top Row */}
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                    user.role === 'admin' 
                      ? 'bg-sky-50 text-sky-600 border border-sky-200' 
                      : 'bg-slate-50 text-slate-600 border border-slate-200'
                  }`}>
                    {user.fullName.substring(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-800 text-base">{user.fullName}</h3>
                      {user.role === 'admin' ? (
                        <span className="bg-sky-100 text-sky-800 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                          <ShieldCheck size={10} />
                          مدیر سیستم
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                          کارشناس فنی/بازرگانی
                        </span>
                      )}
                      {/* An account that owned records was disabled rather than
                          removed, and would otherwise look entirely normal. */}
                      {user.isActive === false && (
                        <span className="bg-rose-100 text-rose-700 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                          <ShieldAlert size={10} />
                          غیرفعال
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 font-mono">
                      {user.position && (
                        <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold font-sans ml-2 border border-emerald-100">{user.position}</span>
                      )}
                      <span>نام کاربری:</span>
                      <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">{user.username}</span>
                      {user.isSystemAdmin && (
                        <span className="text-rose-500 text-[10px] font-sans">★ کاربر مادری سیستم</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1">
                  <button
                    onClick={() => openEditModal(user)}
                    className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition"
                    title="ویرایش کاربر و سطح دسترسی"
                  >
                    <Edit2 size={16} />
                  </button>
                  {!user.isSystemAdmin && (
                    <button
                      onClick={() => handleDeleteUser(user)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                      title="حذف دسترسی پرسنل"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* Module access grid summary */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-500 block mb-2">خلاصه دسترسی به ماژول‌ها:</span>
                <div className="flex flex-wrap gap-1.5">
                  {moduleList.map((m) => {
                    const hasAccess = user.permissions && user.permissions[m.id as keyof typeof user.permissions];
                    return (
                      <span 
                        key={m.id}
                        className={`text-[10px] px-2 py-1 rounded-md font-medium transition-all ${
                          hasAccess 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/60' 
                            : 'bg-slate-50 text-slate-300 border border-slate-100/40 line-through'
                        }`}
                      >
                        {m.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick Summary Footer */}
            <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1">
                <Lock size={12} className="text-slate-300" />
                <span>حفاظت امنیتی فعال</span>
              </div>
              <span className="font-mono">ID: {user.id}</span>
            </div>
          </div>
        ))}
      </div>

      {/* --- ADD NEW USER MODAL --- */}
      {showAddModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center overflow-y-auto ${isAddModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white border border-slate-100 shadow-2xl flex flex-col transition-all duration-300 ${
            isAddModalFullscreen 
              ? 'w-screen h-screen rounded-none max-w-full max-h-screen my-0' 
              : 'rounded-2xl max-w-2xl w-full max-h-[90vh] my-4'
          }`}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsAddModalFullscreen(!isAddModalFullscreen)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition flex items-center justify-center"
                  title={isAddModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isAddModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowAddModal(false); setIsAddModalFullscreen(false); }} 
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition"
                >
                  <X size={20} />
                </button>
              </div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <UserPlus size={20} className="text-sky-600" />
                تعریف پرسنل جدید ابزار تامین ارشیا
              </h2>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Personal details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">نام و نام خانوادگی *</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: مهندس احمدی"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">سمت سازمانی / حقیقی</label>
                  <select
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    <option value="">-- انتخاب سمت --</option>
                    {/* A position the settings list no longer offers is still
                        this person's position; without it the field renders
                        blank while holding a value, which reads as "not set". */}
                    {position && !(settings.dropdownItems.positions || []).includes(position) && (
                      <option value={position}>{position}</option>
                    )}
                    {(settings.dropdownItems.positions || []).map((pos, idx) => (
                      <option key={idx} value={pos}>{pos}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">سطح دسترسی (نقش سیستمی) *</label>
                  <select
                    value={role}
                    onChange={(e) => handleRoleChange(e.target.value as 'admin' | 'user')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    <option value="user">کاربر عادی (تعیین دسترسی در پایین)</option>
                    <option value="admin">مدیر سیستم (دسترسی کامل)</option>
                  </select>
                </div>
              </div>

              {/* Authentication */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">نام کاربری ورود (انگلیسی) *</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="مثال: ahmadi"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">رمز عبور ورود *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="حداقل ۶ کاراکتر"
                      className="w-full border border-slate-200 rounded-lg pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 transition"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Signature Image Upload */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                <label className="text-xs font-bold text-slate-700 block">تصویر نمونه امضا جهت درج در پیش‌فاکتورها</label>
                <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
                  {signatureImage ? (
                    <div className="relative w-24 h-16 rounded-lg border border-slate-200 overflow-hidden bg-white shrink-0 shadow-sm flex items-center justify-center p-1">
                      <img src={signatureImage} alt="User Signature" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      <button
                        type="button"
                        onClick={() => setSignatureImage('')}
                        className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition"
                        title="حذف امضا"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-24 h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0 text-xs font-semibold">
                      بدون امضا
                    </div>
                  )}
                  
                  <div className="flex-1 w-full">
                    <div className="relative border border-dashed border-slate-300 hover:border-sky-500 rounded-lg py-2 px-3 text-center cursor-pointer bg-white transition">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const url = await uploadFile(file);
                              setSignatureImage(url);
                            } catch (err: any) {
                              console.error(err);
                              alert(err.message || 'خطا در بارگذاری تصویر امضا');
                            }
                          }
                          if (e.target) e.target.value = '';
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      />
                      <span className="text-xs text-sky-600 font-semibold">بارگذاری نمونه امضا (PNG شفاف یا پس‌زمینه سفید)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Granular Module permissions */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-700">تنظیم سطوح دسترسی ماژول‌های سیستم</h3>
                  {role === 'admin' && (
                    <span className="text-[10px] text-sky-600 bg-sky-50 px-2 py-1 rounded font-semibold">
                      کاربران با نقش مدیر سیستم دسترسی کامل به کلیه ماژول‌ها دارند
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1 border border-slate-100 rounded-lg bg-slate-50/50">
                  {moduleList.map((mod) => {
                    const isChecked = role === 'admin' ? true : permissions[mod.id as keyof typeof permissions];
                    return (
                      <div 
                        key={mod.id}
                        onClick={() => handleTogglePermission(mod.id)}
                        className={`p-2.5 rounded-lg border transition-all flex items-center gap-3 text-right cursor-pointer select-none ${
                          isChecked 
                            ? 'bg-emerald-50/70 border-emerald-200/85 text-emerald-900 shadow-sm' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        } ${role === 'admin' ? 'opacity-80 pointer-events-none' : ''}`}
                      >
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                          isChecked ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300'
                        }`}>
                          {isChecked && <Check size={12} strokeWidth={3} />}
                        </div>
                        <div className="flex-1">
                          <span className="text-xs font-bold block">{mod.name}</span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">{mod.desc}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowAddModal(false); setIsAddModalFullscreen(false); }}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-lg shadow-sky-600/10 transition"
                >
                  ایجاد و ذخیره دسترسی
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT USER MODAL --- */}
      {showEditModal && selectedUser && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center overflow-y-auto ${isEditModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white border border-slate-100 shadow-2xl flex flex-col transition-all duration-300 ${
            isEditModalFullscreen 
              ? 'w-screen h-screen rounded-none max-w-full max-h-screen my-0' 
              : 'rounded-2xl max-w-2xl w-full max-h-[90vh] my-4'
          }`}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsEditModalFullscreen(!isEditModalFullscreen)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition flex items-center justify-center"
                  title={isEditModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isEditModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowEditModal(false); setIsEditModalFullscreen(false); }} 
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition"
                >
                  <X size={20} />
                </button>
              </div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Lock size={20} className="text-sky-600" />
                ویرایش اطلاعات و سطح دسترسی "{selectedUser.fullName}"
              </h2>
            </div>

            <form onSubmit={handleUpdateUser} className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Personal details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">نام و نام خانوادگی *</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">سمت سازمانی / حقیقی</label>
                  <select
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    <option value="">-- انتخاب سمت --</option>
                    {/* A position the settings list no longer offers is still
                        this person's position; without it the field renders
                        blank while holding a value, which reads as "not set". */}
                    {position && !(settings.dropdownItems.positions || []).includes(position) && (
                      <option value={position}>{position}</option>
                    )}
                    {(settings.dropdownItems.positions || []).map((pos, idx) => (
                      <option key={idx} value={pos}>{pos}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">سطح دسترسی (نقش سیستمی) *</label>
                  <select
                    value={role}
                    disabled={selectedUser.isSystemAdmin}
                    onChange={(e) => handleRoleChange(e.target.value as 'admin' | 'user')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="user">کاربر عادی (تعیین دسترسی در پایین)</option>
                    <option value="admin">مدیر سیستم (دسترسی کامل)</option>
                  </select>
                </div>
              </div>

              {/* Authentication */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">نام کاربری ورود (انگلیسی) *</label>
                  <input
                    type="text"
                    required
                    disabled={selectedUser.isSystemAdmin}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono disabled:bg-slate-100 disabled:text-slate-400"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1.5">
                  {/* Not required, and not pre-filled: the server never returns
                      a password, so blank means "leave it as it is". */}
                  <label className="text-xs font-semibold text-slate-500">
                    رمز عبور جدید <span className="font-normal text-slate-400">(خالی = بدون تغییر)</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="برای تغییر رمز، رمز جدید را وارد کنید"
                      className="w-full border border-slate-200 rounded-lg pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 transition"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Signature Image Upload */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                <label className="text-xs font-bold text-slate-700 block">تصویر نمونه امضا جهت درج در پیش‌فاکتورها</label>
                <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
                  {signatureImage ? (
                    <div className="relative w-24 h-16 rounded-lg border border-slate-200 overflow-hidden bg-white shrink-0 shadow-sm flex items-center justify-center p-1">
                      <img src={signatureImage} alt="User Signature" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      <button
                        type="button"
                        onClick={() => setSignatureImage('')}
                        className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition"
                        title="حذف امضا"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-24 h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0 text-xs font-semibold">
                      بدون امضا
                    </div>
                  )}
                  
                  <div className="flex-1 w-full">
                    <div className="relative border border-dashed border-slate-300 hover:border-sky-500 rounded-lg py-2 px-3 text-center cursor-pointer bg-white transition">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const url = await uploadFile(file);
                              setSignatureImage(url);
                            } catch (err: any) {
                              console.error(err);
                              alert(err.message || 'خطا در بارگذاری تصویر امضا');
                            }
                          }
                          if (e.target) e.target.value = '';
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      />
                      <span className="text-xs text-sky-600 font-semibold">بارگذاری نمونه امضا (PNG شفاف یا پس‌زمینه سفید)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Granular Module permissions */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-700">تنظیم سطوح دسترسی ماژول‌های سیستم</h3>
                  {(role === 'admin' || selectedUser.isSystemAdmin) && (
                    <span className="text-[10px] text-sky-600 bg-sky-50 px-2 py-1 rounded font-semibold">
                      کاربران با نقش مدیر سیستم دسترسی کامل به کلیه ماژول‌ها دارند
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1 border border-slate-100 rounded-lg bg-slate-50/50">
                  {moduleList.map((mod) => {
                    const isChecked = (role === 'admin' || selectedUser.isSystemAdmin) ? true : permissions[mod.id as keyof typeof permissions];
                    return (
                      <div 
                        key={mod.id}
                        onClick={() => handleTogglePermission(mod.id)}
                        className={`p-2.5 rounded-lg border transition-all flex items-center gap-3 text-right cursor-pointer select-none ${
                          isChecked 
                            ? 'bg-emerald-50/70 border-emerald-200/85 text-emerald-900 shadow-sm' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        } ${(role === 'admin' || selectedUser.isSystemAdmin) ? 'opacity-80 pointer-events-none' : ''}`}
                      >
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                          isChecked ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300'
                        }`}>
                          {isChecked && <Check size={12} strokeWidth={3} />}
                        </div>
                        <div className="flex-1">
                          <span className="text-xs font-bold block">{mod.name}</span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">{mod.desc}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowEditModal(false); setIsEditModalFullscreen(false); }}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-lg shadow-sky-600/10 transition"
                >
                  ذخیره تغییرات دسترسی
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setUserToDeleteId(null);
          setUserToDeleteName('');
        }}
        onConfirm={async () => {
          if (!userToDeleteId) return;
          const id = userToDeleteId;
          setDeleteConfirmOpen(false);
          setUserToDeleteId(null);
          setUserToDeleteName('');
          try {
            // An account that owns records is deactivated rather than deleted,
            // and the server says which happened.
            const result = await usersApi.remove(id);
            invalidateUserDirectory();
            list.refresh();
            if (result.deactivated) alert(result.message);
          } catch (err) {
            reportError(err, 'حذف کاربر با خطا مواجه شد.');
          }
        }}
        title="حذف دسترسی پرسنل"
        message={`آیا از حذف دسترسی پرسنل "${userToDeleteName}" اطمینان دارید؟ تمامی دسترسی‌های این همکار متوقف خواهد شد. اگر این کاربر سابقه ثبت‌شده داشته باشد، به‌جای حذف غیرفعال می‌شود تا تاریخچه دست‌نخورده بماند.`}
      />

    </div>
  );
}
