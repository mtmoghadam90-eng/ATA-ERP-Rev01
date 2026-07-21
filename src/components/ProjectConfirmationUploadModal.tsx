import React, { useState, useRef } from 'react';
import { X, Upload, File, Loader2, AlertCircle, CheckCircle2, FolderOpen } from 'lucide-react';
import { Project } from '../types';
import { uploadFile } from '../imageUtils';
import { getTodayShamsi } from '../dateUtils';

interface ProjectConfirmationUploadModalProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (project: Project, uploadedFileUrl: string, fileName: string, folderName: string) => void;
}

export default function ProjectConfirmationUploadModal({
  isOpen,
  project,
  onClose,
  onSave
}: ProjectConfirmationUploadModalProps) {
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customFileName, setCustomFileName] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string>('پیش‌فاکتورها و مهندسی فروش');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !project) return null;

  const folders = [
    'پیش‌فاکتورها و مهندسی فروش',
    'درخواست مشتری و استعلام اولیه',
    'تراکنش‌های مالی و پرداخت‌ها',
    'بسته‌بندی و تحویل کالا',
    'خدمات پس از فروش',
    'سایر مدارک و فایل‌های دستی'
  ];

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      // set custom filename without extension as default
      const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      setCustomFileName(`تاییدیه_شروع_پروژه_${project.code}_${nameWithoutExt}`);
      setError(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      setCustomFileName(`تاییدیه_شروع_پروژه_${project.code}_${nameWithoutExt}`);
      setError(null);
    }
    if (e.target) e.target.value = '';
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('لطفاً ابتدا یک فایل را انتخاب یا بارگذاری کنید.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // 1. Upload the file using system uploadFile utility
      const url = await uploadFile(selectedFile);
      
      // Get extension from original file
      const originalName = selectedFile.name;
      const ext = originalName.substring(originalName.lastIndexOf('.')) || '';
      const finalFileName = customFileName ? `${customFileName}${ext}` : originalName;

      // 2. Create the document object
      const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newDoc = {
        id: docId,
        folderName: selectedFolder,
        name: finalFileName,
        url: url,
        createdAt: getTodayShamsi(),
        size: `${(selectedFile.size / 1024).toFixed(1)} KB`
      };

      // 3. Update project manualDocuments array
      const existingDocs = project.manualDocuments || [];
      const updatedProject: Project = {
        ...project,
        manualDocuments: [...existingDocs, newDoc]
      };

      // 4. Save and trigger callback
      onSave(updatedProject, url, finalFileName, selectedFolder);
      
      // Reset state and close
      setSelectedFile(null);
      setCustomFileName('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'خطا در بارگذاری مدارک. مجدداً تلاش نمایید.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-x-hidden overflow-y-auto" dir="rtl">
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
        onClick={() => !isUploading && onClose()}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 text-right animate-scale-up z-10 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 flex items-center justify-center">
              <FolderOpen size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">بارگذاری مدرک تاییدیه و شروع پروژه</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">ثبت اتوماتیک مدرک تاییدیه برنده شدن در پرونده پروژه</p>
            </div>
          </div>
          {!isUploading && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-lg transition"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content Area */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
          {/* Project Details Banner */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-150 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-700">پروژه: <span className="text-sky-600 font-extrabold">{project.name}</span></span>
              <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500 font-bold">{project.code}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1.5 border-t border-slate-200">
              <span>کارفرما: <strong className="text-slate-600">{project.customerName}</strong></span>
              <span>وضعیت جدید: <strong className="text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">{project.status}</strong></span>
            </div>
          </div>

          <div className="space-y-1 bg-amber-50/50 border border-amber-100 p-3 rounded-xl text-amber-800 leading-relaxed text-[11px]">
            <p className="font-bold flex items-center gap-1">
              <AlertCircle size={14} className="shrink-0" />
              <span>مدرک تاییدیه پروژه چیست؟</span>
            </p>
            <p className="text-amber-700/90 text-[10px] mt-0.5">این سند می‌تواند اسکن پیش‌فاکتور مهر و امضا شده، قرارداد منعقده، ابلاغیه رسمی برنده شدن در مناقصه، یا هر نوع نامه/مدرک مکتوب دیگر از طرف کارفرما دال بر تاییدیه کار باشد.</p>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Custom File Name */}
            <div className="space-y-1.5">
              <label className="block text-slate-600 font-bold">نام سند در سیستم:</label>
              <input
                type="text"
                value={customFileName}
                onChange={(e) => setCustomFileName(e.target.value)}
                placeholder="مثلاً: نامه_ابلاغ_قرارداد_کارفرما"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-none focus:border-sky-500 text-slate-700 font-mono text-left"
                dir="ltr"
              />
            </div>
            
            {/* Auto destination notice */}
            <div className="text-[10px] text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-150 flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
              <span>محل ذخیره مستند: این فایل به صورت خودکار در پوشه <strong className="text-slate-700">«پیش‌فاکتورها و مهندسی فروش»</strong> پروژه ذخیره می‌شود.</span>
            </div>
          </div>

          {/* Drag and drop upload section */}
          <div className="space-y-1.5">
            <label className="block text-slate-600 font-bold">فایل مدرک تاییدیه:</label>
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={onButtonClick}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2.5 relative min-h-[140px] ${
                dragActive ? "border-emerald-500 bg-emerald-50/20" : "border-slate-200 hover:border-sky-500 hover:bg-slate-50/40"
              }`}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                onChange={handleFileChange}
                className="hidden" 
              />
              
              {selectedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 flex items-center justify-center">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-xs truncate max-w-[280px] font-mono" dir="ltr">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-sky-600 hover:underline mt-1 bg-sky-50 px-2.5 py-1 rounded-lg">تغییر فایل انتخابی</span>
                </div>
              ) : (
                <>
                  <div className="p-3.5 bg-slate-50 rounded-full text-slate-400 border border-slate-100 group-hover:bg-sky-50 group-hover:text-sky-500 transition-colors">
                    <Upload size={24} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 text-xs">فایل مدرک را به این قسمت بکشید یا کلیک کنید</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">انواع تصاویر (PNG, JPG) و اسناد PDF قابل قبول هستند.</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[11px] leading-relaxed flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit & Actions footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              disabled={isUploading}
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-bold transition"
            >
              بعداً بارگذاری می‌کنم
            </button>
            <button
              type="submit"
              disabled={isUploading || !selectedFile}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:border-transparent text-white rounded-xl text-xs font-bold transition shadow-md shadow-emerald-600/10 flex items-center justify-center gap-1.5 min-w-[120px]"
            >
              {isUploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>درحال آپلود...</span>
                </>
              ) : (
                <>
                  <Upload size={14} />
                  <span>تایید و ذخیره مدرک</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
