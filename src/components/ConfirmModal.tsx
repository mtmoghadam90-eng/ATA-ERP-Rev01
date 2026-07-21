import React from 'react';
import { AlertTriangle, Trash2, X, Info, CheckCircle2, Check } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  children?: React.ReactNode;
  variant?: 'danger' | 'warning' | 'info' | 'success';
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText = 'انصراف',
  children,
  variant = 'danger'
}: ConfirmModalProps) {
  if (!isOpen) return null;

  // Set default confirm text based on variant if not provided
  const defaultConfirmText = confirmText || (variant === 'danger' ? 'بله، حذف شود' : 'تایید اتمام کار');

  // Styles based on variant
  const getVariantStyles = () => {
    switch (variant) {
      case 'warning':
        return {
          iconBg: 'bg-amber-50 text-amber-600',
          icon: <AlertTriangle size={24} />,
          btnClass: 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/10',
          btnIcon: <Check size={14} />
        };
      case 'info':
        return {
          iconBg: 'bg-sky-50 text-sky-600',
          icon: <Info size={24} />,
          btnClass: 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/10',
          btnIcon: <Check size={14} />
        };
      case 'success':
        return {
          iconBg: 'bg-emerald-50 text-emerald-600',
          icon: <CheckCircle2 size={24} />,
          btnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10',
          btnIcon: <Check size={14} />
        };
      case 'danger':
      default:
        return {
          iconBg: 'bg-red-50 text-red-600',
          icon: <AlertTriangle size={24} />,
          btnClass: 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/10',
          btnIcon: <Trash2 size={14} />
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-x-hidden overflow-y-auto">
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 text-right animate-scale-up z-10">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 p-1.5 hover:bg-slate-150 text-slate-400 hover:text-slate-600 rounded-lg transition"
        >
          <X size={16} />
        </button>

        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl shrink-0 ${styles.iconBg}`}>
            {styles.icon}
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
          </div>
        </div>

        {children}

        <div className="flex justify-end gap-3 mt-6 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-md flex items-center gap-1.5 ${styles.btnClass}`}
          >
            {styles.btnIcon}
            {defaultConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
