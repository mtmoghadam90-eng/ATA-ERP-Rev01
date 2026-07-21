import React from 'react';
import { Paperclip, Upload, X, HelpCircle } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import { CustomField } from '../types';

interface CustomFieldsFormProps {
  module: 'customers' | 'projects' | 'products' | 'proformas' | 'suppliers' | 'purchaseOrders' | 'transactions' | 'tasks';
  customFields: CustomField[];
  customValues: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
}

// Helper to format thousands separator
function formatSeparator(val: any): string {
  if (val === undefined || val === null || val === '') return '';
  const num = String(val).replace(/[^0-9.-]/g, '');
  if (!num || isNaN(Number(num))) return '';
  return Number(num).toLocaleString('fa-IR');
}

export default function CustomFieldsForm({
  module,
  customFields,
  customValues,
  onChange
}: CustomFieldsFormProps) {
  
  const filteredFields = (customFields || []).filter(f => f.module === module);

  if (filteredFields.length === 0) return null;

  const handleValueChange = (fieldId: string, val: any) => {
    const updated = {
      ...customValues,
      [fieldId]: val
    };
    onChange(updated);
  };

  const handleFileUpload = async (fieldId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { uploadFile } = await import('../imageUtils');
      const url = await uploadFile(file);
      handleValueChange(fieldId, {
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: url // Actually it's a regular URL now, but we'll keep the key dataUrl for backward compatibility
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'خطا در بارگذاری فایل');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-150 space-y-4 text-right" id={`custom-fields-container-${module}`}>
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
        <span className="w-1.5 h-4 bg-sky-500 rounded-full"></span>
        <h4 className="text-xs font-bold text-slate-700">فیلدهای سفارشی و اطلاعات تکمیلی</h4>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredFields.map((field) => {
          const value = customValues?.[field.id] !== undefined ? customValues[field.id] : '';

          return (
            <div key={field.id} className="space-y-1.5" id={`field-wrapper-${field.id}`}>
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                {field.name}
                {field.required && <span className="text-rose-500 font-bold">*</span>}
              </label>

              {/* Text Input */}
              {field.type === 'text' && (
                <input
                  type="text"
                  required={field.required}
                  value={value}
                  onChange={(e) => handleValueChange(field.id, e.target.value)}
                  className="w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500 outline-none text-right"
                />
              )}

              {/* Long Text Input */}
              {field.type === 'textarea' && (
                <textarea
                  rows={2}
                  required={field.required}
                  value={value}
                  onChange={(e) => handleValueChange(field.id, e.target.value)}
                  className="w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500 outline-none text-right"
                />
              )}

              {/* Number Input */}
              {field.type === 'number' && (
                <div className="space-y-1">
                  <div className="relative">
                    <input
                      type="number"
                      required={field.required}
                      value={value}
                      onChange={(e) => handleValueChange(field.id, e.target.value)}
                      className="w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500 outline-none text-left font-mono font-semibold"
                    />
                  </div>
                  {field.useSeparator && value !== '' && (
                    <div className="text-[10px] text-sky-600 font-bold bg-sky-50 px-2 py-0.5 rounded inline-block">
                      مبلغ فرمت شده: {formatSeparator(value)}
                    </div>
                  )}
                </div>
              )}

              {/* Shamsi Date */}
              {field.type === 'date' && (
                <ShamsiDatePicker
                  value={value}
                  required={field.required}
                  onChange={(val) => handleValueChange(field.id, val)}
                />
              )}

              {/* Select Dropdown */}
              {field.type === 'select' && (
                <select
                  required={field.required}
                  value={value}
                  onChange={(e) => handleValueChange(field.id, e.target.value)}
                  className="w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500 outline-none text-right"
                >
                  <option value="">-- انتخاب گزینه --</option>
                  {(field.options || []).map((opt, idx) => (
                    <option key={idx} value={opt}>{opt}</option>
                  ))}
                </select>
              )}

              {/* Checkbox / Boolean */}
              {field.type === 'boolean' && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id={`bool-${field.id}`}
                    checked={!!value}
                    onChange={(e) => handleValueChange(field.id, e.target.checked)}
                    className="w-4 h-4 text-sky-600 border-slate-300 rounded focus:ring-sky-500 cursor-pointer"
                  />
                  <label htmlFor={`bool-${field.id}`} className="text-xs text-slate-700 font-medium cursor-pointer select-none">
                    {value ? 'بله' : 'خیر'}
                  </label>
                </div>
              )}

              {/* File Attachment */}
              {field.type === 'file' && (
                <div className="space-y-1">
                  {value && typeof value === 'object' && value.name ? (
                    <div className="flex items-center justify-between p-2 border border-sky-100 bg-sky-50/50 rounded-lg text-xs">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Paperclip size={14} className="text-sky-500 shrink-0" />
                        <span className="text-sky-700 font-bold truncate" title={value.name}>{value.name}</span>
                        <span className="text-slate-400 text-[10px] shrink-0">
                          ({value.size && !isNaN(Number(value.size)) 
                            ? `${(Number(value.size) / 1024).toFixed(1)} KB` 
                            : 'سند'})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleValueChange(field.id, '')}
                        className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-100 rounded-full transition shrink-0"
                        title="حذف فایل پیوست"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-sky-400 bg-white rounded-lg py-3 cursor-pointer transition text-slate-400 hover:text-sky-500">
                      <Upload size={18} className="mb-1" />
                      <span className="text-[10px] font-bold">برای بارگذاری سند کلیک کنید</span>
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(field.id, e)}
                      />
                    </label>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>
    </div>
  );
}
