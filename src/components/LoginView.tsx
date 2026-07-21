import React, { useState } from 'react';
import { Clock, ShieldAlert, UserCheck, Eye, EyeOff, Lock, KeyRound, AlertTriangle } from 'lucide-react';

interface LoginViewProps {
  onLogin: (username: string, password?: string) => Promise<{ success: boolean; mustChangePassword?: boolean; message?: string }>;
  onLoginSuccess: (user: any) => void;
}

export default function LoginView({ onLogin, onLoginSuccess }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Password change states
  const [needPasswordChange, setNeedPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSubmittingChange, setIsSubmittingChange] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('لطفاً نام کاربری و رمز ورود را وارد نمایید.');
      return;
    }

    const res = await onLogin(username.trim(), password);
    if (res.success) {
      if (res.mustChangePassword) {
        setNeedPasswordChange(true);
      }
    } else {
      setError(res.message || 'نام کاربری یا رمز ورود اشتباه است. لطفاً مجدداً تلاش کنید.');
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newPassword || !confirmPassword) {
      setError('لطفاً رمز عبور جدید و تکرار آن را وارد کنید.');
      return;
    }

    if (newPassword.length < 4) {
      setError('رمز عبور جدید باید حداقل ۴ کاراکتر باشد.');
      return;
    }

    if (newPassword === '123') {
      setError('نمی‌توانید مجدداً از رمز عبور ساده و پیش‌فرض استفاده نمایید.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('رمز عبور جدید با تکرار آن مطابقت ندارد.');
      return;
    }

    setIsSubmittingChange(true);
    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          oldPassword: password,
          newPassword
        })
      });
      const data = await response.json();
      if (response.ok && data.success && data.user) {
        onLoginSuccess(data.user);
      } else {
        setError(data.message || 'خطایی در تغییر رمز عبور رخ داد. لطفاً مجدداً تلاش کنید.');
      }
    } catch (err) {
      console.error('Password change error', err);
      setError('خطا در برقراری ارتباط با سرور.');
    } finally {
      setIsSubmittingChange(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-right" dir="rtl">
      <div className="max-w-md w-full bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col relative">
        
        {/* Decorative ambient light */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-sky-500 to-transparent"></div>

        {/* Brand Header */}
        <div className="p-8 text-center bg-slate-900/60 border-b border-slate-800/50">
          <div className="mx-auto w-12 h-12 bg-sky-500 rounded-xl text-white flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4">
            <Clock className="animate-spin-slow text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-100">سامانه جامع ERP ابزار تامین ارشیا</h1>
          <p className="text-xs text-sky-400 mt-1.5 tracking-wider font-mono">ARSHIA ERP PORTAL v2.5</p>
        </div>

        {!needPasswordChange ? (
          <>
            {/* System Access Alert */}
            <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-850 flex items-start gap-3">
              <ShieldAlert className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
              <div className="flex flex-col text-right">
                <span className="text-[10px] font-bold text-amber-500">حفاظت دسترسی و امنیت اطلاعات:</span>
                <span className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  ورود به این سامانه منحصر به پرسنل و کاربران مجاز شرکت ابزار تامین ارشیا می‌باشد. دسترسی‌ها توسط مدیریت ارشد سیستم کنترل و تخصیص داده می‌شود.
                </span>
              </div>
            </div>

            {/* Form Body */}
            <div className="p-8 space-y-6">
              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-rose-400 text-xs text-center font-semibold">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400">نام کاربری ورود (به انگلیسی)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="مثال: mohammad"
                      className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg pl-3 pr-10 py-2.5 text-sm text-slate-100 focus:ring-2 focus:ring-sky-500/10 outline-none text-left font-mono"
                      dir="ltr"
                    />
                    <UserCheck className="absolute right-3 top-3 text-slate-500" size={16} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400">رمز ورود</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="رمز عبور خود را وارد کنید"
                      className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-100 focus:ring-2 focus:ring-sky-500/10 outline-none text-left font-mono"
                      dir="ltr"
                    />
                    <Lock className="absolute right-3 top-3 text-slate-500" size={16} />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-3 text-slate-500 hover:text-slate-300 transition"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-sky-600 hover:bg-sky-500 active:scale-[0.98] text-white font-bold text-sm py-2.5 rounded-lg shadow-lg shadow-sky-600/15 transition-all mt-2"
                >
                  ورود به سامانه
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Change Password Form (First Login Requirement) */
          <div className="p-8 space-y-6">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5 animate-pulse" size={20} />
              <div className="flex flex-col text-right">
                <span className="text-xs font-bold text-amber-500">تغییر رمز عبور پیش‌فرض (الزامی):</span>
                <span className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  حساب کاربری شما از رمز عبور ساده و پیش‌فرض بهره می‌برد. جهت صیانت از اطلاعات شرکت و ارتقای امنیت سیستم، لطفاً یک رمز عبور جدید و اختصاصی انتخاب فرمایید.
                </span>
              </div>
            </div>

            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-rose-400 text-xs text-center font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">رمز عبور جدید (حداقل ۴ کاراکتر)</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="رمز عبور اختصاصی خود را وارد کنید"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-100 focus:ring-2 focus:ring-sky-500/10 outline-none text-left font-mono"
                    dir="ltr"
                    autoFocus
                  />
                  <KeyRound className="absolute right-3 top-3 text-slate-500" size={16} />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute left-3 top-3 text-slate-500 hover:text-slate-300 transition"
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">تکرار رمز عبور جدید</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="مجدداً رمز عبور جدید را وارد کنید"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-100 focus:ring-2 focus:ring-sky-500/10 outline-none text-left font-mono"
                    dir="ltr"
                  />
                  <Lock className="absolute right-3 top-3 text-slate-500" size={16} />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingChange}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50 text-white font-bold text-sm py-2.5 rounded-lg shadow-lg shadow-emerald-600/15 transition-all"
                >
                  {isSubmittingChange ? 'در حال ثبت...' : 'تغییر رمز عبور و ورود'}
                </button>
                <button
                  type="button"
                  disabled={isSubmittingChange}
                  onClick={() => {
                    setNeedPasswordChange(false);
                    setError(null);
                  }}
                  className="px-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-50 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 bg-slate-900/30 border-t border-slate-850/60 text-center text-[10px] text-slate-600">
          <span>شرکت ابزار تامین ارشیا © 2026</span>
        </div>
      </div>
    </div>
  );
}
