import React from 'react';
import { Paperclip, Calendar, CheckSquare, Square, Download } from 'lucide-react';
import { CustomField } from '../types';
import { downloadFileFromServer } from '../imageUtils';

interface CustomFieldsDetailViewProps {
  module: 'customers' | 'projects' | 'products' | 'proformas' | 'suppliers' | 'purchaseOrders' | 'transactions' | 'tasks';
  customFields: CustomField[];
  customValues?: Record<string, any>;
}

// Helper to format thousands separator
function formatSeparator(val: any): string {
  if (val === undefined || val === null || val === '') return '';
  const num = String(val).replace(/[^0-9.-]/g, '');
  if (!num || isNaN(Number(num))) return '';
  return Number(num).toLocaleString('fa-IR');
}

export default function CustomFieldsDetailView({
  module,
  customFields,
  customValues
}: CustomFieldsDetailViewProps) {
  if (!customValues) return null;

  const filteredFields = (customFields || []).filter(f => f.module === module);
  
  // Only display fields that have actually been filled out
  const filledFields = filteredFields.filter(field => {
    const value = customValues[field.id];
    return value !== undefined && value !== null && value !== '';
  });

  if (filledFields.length === 0) return null;

  return (
    <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-3 text-right" id={`custom-fields-detail-${module}`}>
      <div className="flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
        <span className="w-1 h-3 bg-indigo-500 rounded-full"></span>
        <h5 className="text-xs font-bold text-slate-700">فیلدهای سفارشی</h5>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
        {filledFields.map((field) => {
          const value = customValues[field.id];

          return (
            <div key={field.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
              <span className="text-slate-500 font-medium">{field.name}:</span>

              <div className="font-semibold text-slate-800">
                {/* Text & Long Text */}
                {(field.type === 'text' || field.type === 'textarea') && (
                  <span>{value}</span>
                )}

                {/* Number */}
                {field.type === 'number' && (
                  <span>
                    {field.useSeparator ? formatSeparator(value) : value}
                  </span>
                )}

                {/* Date */}
                {field.type === 'date' && (
                  <span className="inline-flex items-center gap-1 font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                    <Calendar size={12} className="text-slate-500" />
                    {value}
                  </span>
                )}

                {/* Select */}
                {field.type === 'select' && (
                  <span className="bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-bold text-[10px]">
                    {value}
                  </span>
                )}

                {/* Boolean Checkbox */}
                {field.type === 'boolean' && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[10px] ${value ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {value ? 'بله' : 'خیر'}
                  </span>
                )}

                {/* File Attachment */}
                {field.type === 'file' && typeof value === 'object' && value.name && (
                  <div className="flex items-center gap-1.5">
                    {value.dataUrl ? (
                      <button
                        type="button"
                        onClick={() => downloadFileFromServer(value.dataUrl, value.name)}
                        className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1 rounded font-bold text-[10px] transition cursor-pointer"
                        title="دانلود فایل پیوست"
                      >
                        <Paperclip size={11} />
                        <span className="max-w-[100px] truncate">{value.name}</span>
                        <Download size={11} className="ml-0.5 opacity-70" />
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-[10px]">
                        <Paperclip size={11} />
                        {value.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
