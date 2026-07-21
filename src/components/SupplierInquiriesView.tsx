import React, { useState, useMemo, useRef } from 'react';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Eye, 
  Check, 
  Upload, 
  Download, 
  Search, 
  FileText, 
  CheckCircle2, 
  X, 
  FileDown, 
  Activity, 
  Clock, 
  User, 
  DollarSign, 
  TrendingUp, 
  Send, 
  Calendar, 
  ArrowLeftRight, 
  Trophy,
  AlertTriangle,
  FileSpreadsheet,
  Globe,
  Coins,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Project, 
  Supplier, 
  SupplierInquiry, 
  SupplierInquiryItem, 
  InquiryStep, 
  ExchangeRate,
  ERPSettings
} from '../types';
import ConfirmModal from './ConfirmModal';
import ShamsiDatePicker from './ShamsiDatePicker';
import { getTodayShamsi } from '../dateUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk, getFieldAsterisk } from '../utils/requiredFields';
import { downloadFileFromServer } from '../imageUtils';

interface SupplierInquiriesViewProps {
  projects: Project[];
  suppliers: Supplier[];
  exchangeRates: ExchangeRate[];
  supplierInquiries: SupplierInquiry[];
  addSupplierInquiry: (inquiry: Omit<SupplierInquiry, 'id' | 'creationDate'>) => SupplierInquiry;
  updateSupplierInquiry: (updatedInquiry: SupplierInquiry) => void;
  deleteSupplierInquiry: (id: string, deleteLogs?: boolean) => void;
  settings: ERPSettings;
}

// Upload helper specifically for supplier inquiries subfolder
async function uploadToSupplierInquiries(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload?folder=supplier-inquiries", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "خطا در بارگذاری فایل در سرور");
  }

  const data = await response.json();
  if (data && data.success && data.url) {
    return data.url;
  }
  throw new Error("پاسخ نامعتبر از سرور");
}

export default function SupplierInquiriesView({
  projects,
  suppliers,
  exchangeRates,
  supplierInquiries,
  addSupplierInquiry,
  updateSupplierInquiry,
  deleteSupplierInquiry,
  settings
}: SupplierInquiriesViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'cards' | 'compare'>('cards');
  
  // Modals state
  const [isInquiryModalOpen, setIsInquiryModalOpen] = useState(false);
  const [isInquiryModalFullscreen, setIsInquiryModalFullscreen] = useState(false);
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [editingInquiry, setEditingInquiry] = useState<SupplierInquiry | null>(null);
  const [activeInquiryForStep, setActiveInquiryForStep] = useState<SupplierInquiry | null>(null);
  
  // Confirm Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'inquiry' | 'step'; inquiryId: string; stepId?: string } | null>(null);
  const [deleteActivitiesWithInquiry, setDeleteActivitiesWithInquiry] = useState(false);

  // Selected Project Details
  const selectedProject = useMemo(() => {
    return projects.find(p => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  // Filtered inquiries for selected project
  const filteredInquiries = useMemo(() => {
    if (!selectedProjectId) return [];
    if (selectedProjectId === 'all') return supplierInquiries;
    return supplierInquiries.filter(inq => inq.projectId === selectedProjectId);
  }, [supplierInquiries, selectedProjectId]);

  // Currency Converter Utility
  const getCurrencyRate = (currency: string) => {
    if (currency === 'ریال' || currency === 'IRR') return 1;
    const map: Record<string, string> = {
      'دلار': 'USD',
      'یورو': 'EUR',
      'درهم': 'AED',
      'یوان': 'CNY'
    };
    const code = map[currency] || currency;
    const rateObj = exchangeRates.find(r => r.currency === code);
    return rateObj ? rateObj.rateToRIYAL : 1;
  };

  // Declares a winner for the project, and automatically sets all others as losers
  const handleSetWinner = (inquiryId: string) => {
    const targetInq = supplierInquiries.find(inq => inq.id === inquiryId);
    if (!targetInq) return;

    // Toggle current winner status
    const isNowWinner = !targetInq.isWinner;

    supplierInquiries.forEach(inq => {
      if (inq.id === inquiryId) {
        updateSupplierInquiry({
          ...inq,
          isWinner: isNowWinner,
          winnerDate: isNowWinner ? getTodayShamsi() : undefined
        });
      } else if (isNowWinner && inq.projectId === targetInq.projectId) {
        // If we set a new winner, all other inquiries for this same project become losers
        updateSupplierInquiry({
          ...inq,
          isWinner: false,
          winnerDate: undefined
        });
      }
    });
  };

  const handleOpenAddInquiry = () => {
    setEditingInquiry(null);
    setIsInquiryModalFullscreen(false);
    setIsInquiryModalOpen(true);
  };

  const handleOpenEditInquiry = (inquiry: SupplierInquiry) => {
    setEditingInquiry(inquiry);
    setIsInquiryModalFullscreen(false);
    setIsInquiryModalOpen(true);
  };

  const handleOpenAddStep = (inquiry: SupplierInquiry) => {
    setActiveInquiryForStep(inquiry);
    setIsStepModalOpen(true);
  };

  const handleDeleteInquiryClick = (inquiryId: string) => {
    setDeleteTarget({ type: 'inquiry', inquiryId });
  };

  const handleDeleteStepClick = (inquiryId: string, stepId: string) => {
    setDeleteTarget({ type: 'step', inquiryId, stepId });
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'inquiry') {
      deleteSupplierInquiry(deleteTarget.inquiryId, deleteActivitiesWithInquiry);
    } else if (deleteTarget.type === 'step' && deleteTarget.stepId) {
      const inq = supplierInquiries.find(i => i.id === deleteTarget.inquiryId);
      if (inq) {
        updateSupplierInquiry({
          ...inq,
          steps: inq.steps.filter(s => s.id !== deleteTarget.stepId)
        });
      }
    }
    setDeleteTarget(null);
    setDeleteActivitiesWithInquiry(false);
  };

  return (
    <div className="space-y-6 text-right" dir="rtl" id="supplier-inquiries-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm" id="header-section">
        <div>
          <h1 className="text-xl font-bold text-slate-800">استعلام قیمت از تأمین‌کنندگان</h1>
          <p className="text-xs text-slate-500 mt-1">مدیریت قیمت‌های پیشنهادی، آپلود اسناد فنی/مالی و مقایسه همه‌جانبه برای تعیین برنده</p>
        </div>
        
        {/* Project Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto shrink-0" id="project-selector-wrapper">
          <label className="text-xs font-bold text-slate-600 whitespace-nowrap sm:text-right">پروژه مورد نظر:</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full sm:w-auto px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
            id="project-selector"
          >
            <option value="">-- انتخاب پروژه --</option>
            <option value="all">همه پروژه‌ها</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </div>
      </div>

      {selectedProjectId ? (
        <div className="space-y-6">
          {/* Main Controls & Info */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="project-info-grid">
            {/* Project items needed brief card */}
            {selectedProjectId !== 'all' && (
              <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4" id="project-brief-card">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <FileText className="text-sky-500" size={18} />
                    اقلام مورد نیاز در خواست شده پروژه
                  </span>
                  <span className="text-xs bg-sky-50 text-sky-600 font-bold px-2.5 py-1 rounded-lg">
                    تعداد اقلام: {selectedProject?.itemsNeeded?.length || 0}
                  </span>
                </div>
                
                {selectedProject?.itemsNeeded && selectedProject.itemsNeeded.length > 0 ? (
                  <div className="overflow-x-auto" id="items-needed-table-container">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                          <th className="p-2.5">نام کالا / تجهیز</th>
                          <th className="p-2.5">دسته</th>
                          <th className="p-2.5">سایز</th>
                          <th className="p-2.5">تعداد</th>
                          <th className="p-2.5">روش تامین</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {selectedProject.itemsNeeded.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-2.5 text-slate-700 font-medium">{item.name}</td>
                            <td className="p-2.5 text-slate-500">{item.category || '-'}</td>
                            <td className="p-2.5 font-mono text-slate-600">{item.size || '-'}</td>
                            <td className="p-2.5 font-bold text-slate-800">{item.quantity}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.supplyMethod === 'INVENTORY' ? 'bg-emerald-50 text-emerald-600' :
                                item.supplyMethod === 'ORDER' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {item.supplyMethod === 'INVENTORY' ? 'از انبار' :
                                 item.supplyMethod === 'ORDER' ? 'خرید خارجی' : 'تامین نشده'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-slate-400 text-xs">
                    هیچ قلم کالایی برای این پروژه ثبت نشده است. ابتدا می‌توانید در ویرایش پروژه اقلام درخواستی را اضافه نمایید.
                  </div>
                )}
              </div>
            )}

            {/* Inquiries quick actions */}
            <div className={`${selectedProjectId === 'all' ? 'lg:col-span-3' : 'lg:col-span-1'} bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between gap-4`} id="quick-actions-card">
              <div className="space-y-2">
                <span className="text-sm font-bold text-slate-800 block">مدیریت استعلام‌های قیمت</span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  یک تأمین‌کننده را اضافه کنید، مبالغ آفر را در ارزهای مختلف وارد کرده و سیستم معادل ریالی را بر اساس آخرین نرخ ثبت‌شده محاسبه می‌کند.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleOpenAddInquiry}
                  className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-500/20 flex items-center justify-center gap-1.5"
                  id="add-inquiry-btn"
                >
                  <Plus size={16} />
                  ثبت استعلام قیمت جدید
                </button>

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('cards')}
                    className={`py-2 text-center text-xs font-bold rounded-lg border transition ${
                      activeTab === 'cards' 
                        ? 'bg-slate-800 text-white border-slate-800' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    نمایش کارت‌ها
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('compare')}
                    className={`py-2 text-center text-xs font-bold rounded-lg border transition ${
                      activeTab === 'compare' 
                        ? 'bg-slate-800 text-white border-slate-800' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    مقایسه آفرها
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Tab Contents */}
          <AnimatePresence mode="wait">
            {activeTab === 'cards' ? (
              <motion.div
                key="cards-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {filteredInquiries.length > 0 ? (
                  <div className="space-y-2" id="inquiries-scroller-section">
                    <div className="text-xs font-bold text-slate-400 mb-2">استعلام‌ها ({filteredInquiries.length} مورد) - امکان پیمایش افقی</div>
                    
                    {/* Horizontal scroll container */}
                    <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                      {filteredInquiries.map((inq) => {
                        // Calculate total offer amount in Riyal for brief display
                        const totalRiyal = inq.items.reduce((sum, item) => sum + (item.priceRiyal * item.quantity), 0);
                        return (
                          <div 
                            key={inq.id}
                            className={`w-96 shrink-0 bg-white border rounded-2xl shadow-sm transition-all duration-300 relative flex flex-col justify-between overflow-hidden ${
                              inq.isWinner 
                                ? 'border-amber-400 ring-2 ring-amber-400/20 shadow-md shadow-amber-400/5' 
                                : 'border-slate-150 hover:border-slate-300'
                            }`}
                            id={`inquiry-card-${inq.id}`}
                          >
                            {/* Card Header */}
                            <div className={`p-4 border-b flex items-center justify-between ${
                              inq.isWinner ? 'bg-amber-50/50 border-amber-100' : 'bg-slate-50/50 border-slate-100'
                            }`}>
                              <div className="space-y-1">
                                <span className="text-xs font-bold text-slate-400">تأمین‌کننده</span>
                                <h3 className="text-sm font-extrabold text-slate-800">{inq.supplierName}</h3>
                                {selectedProjectId === 'all' && (
                                  <span className="text-[10px] bg-sky-50 text-sky-600 px-2 py-0.5 rounded font-bold block w-fit mt-1">
                                    پروژه: {projects.find(p => p.id === inq.projectId)?.name || 'نامشخص'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSetWinner(inq.id)}
                                  className={`p-1.5 rounded-lg transition ${
                                    inq.isWinner 
                                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                                      : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                                  }`}
                                  title={inq.isWinner ? "لغو وضعیت برنده" : "علامت‌گذاری به عنوان پیشنهاد برنده"}
                                >
                                  <Trophy size={16} className={inq.isWinner ? 'animate-pulse' : ''} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditInquiry(inq)}
                                  className="p-1.5 bg-slate-100 text-slate-500 hover:bg-sky-50 hover:text-sky-600 rounded-lg transition"
                                  title="ویرایش استعلام"
                                >
                                  <Edit size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteInquiryClick(inq.id)}
                                  className="p-1.5 bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition"
                                  title="حذف استعلام"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            {/* Card Body */}
                            <div className="p-4 space-y-4 flex-1">
                              {/* Total Price Brief */}
                              <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                                  <Coins size={14} className="text-slate-400" />
                                  مجموع کل آفر (ریال):
                                </span>
                                <span className="text-xs font-extrabold text-sky-600">
                                  {totalRiyal.toLocaleString('fa-IR')} <span className="text-[10px] font-normal text-slate-400">ریال</span>
                                </span>
                              </div>

                              {/* Document Attachments */}
                              <div className="grid grid-cols-2 gap-2">
                                {inq.technicalOfferUrl ? (
                                  <button 
                                    type="button"
                                    onClick={() => downloadFileFromServer(inq.technicalOfferUrl, `technical-offer-${inq.supplierName || 'supplier'}`)}
                                    className="flex items-center justify-center gap-1 py-1.5 px-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg border border-emerald-100 text-[10px] font-bold transition text-center cursor-pointer"
                                  >
                                    <FileDown size={12} />
                                    پیوست فنی
                                  </button>
                                ) : (
                                  <div className="flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-50 text-slate-400 rounded-lg border border-slate-100 text-[10px] font-bold">
                                    پیوست فنی ندارد
                                  </div>
                                )}

                                {inq.financialOfferUrl ? (
                                  <button 
                                    type="button"
                                    onClick={() => downloadFileFromServer(inq.financialOfferUrl, `financial-offer-${inq.supplierName || 'supplier'}`)}
                                    className="flex items-center justify-center gap-1 py-1.5 px-2 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg border border-sky-100 text-[10px] font-bold transition text-center cursor-pointer"
                                  >
                                    <FileDown size={12} />
                                    پیوست مالی
                                  </button>
                                ) : (
                                  <div className="flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-50 text-slate-400 rounded-lg border border-slate-100 text-[10px] font-bold">
                                    پیوست مالی ندارد
                                  </div>
                                )}
                              </div>

                              {/* Items List */}
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold text-slate-400 block border-b border-slate-100 pb-1">اقلام پیشنهاد شده</span>
                                <div className="max-h-36 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                                  {inq.items.map((item, index) => (
                                    <div key={item.id || index} className="p-2 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-xl space-y-1 text-[11px]">
                                      <div className="flex justify-between items-start">
                                        <div className="flex flex-col min-w-0">
                                          <span className="font-bold text-slate-700 truncate max-w-[180px]">{item.name}</span>
                                          {item.tagNumber && (
                                            <span className="font-sans text-rose-600 bg-rose-50 border border-rose-100 px-1 py-0.2 rounded font-bold text-[8px] mt-0.5 w-max">تگ: {item.tagNumber}</span>
                                          )}
                                        </div>
                                        <span className="text-slate-500 font-mono">({item.quantity} عدد)</span>
                                      </div>
                                      <div className="flex justify-between text-[10px] text-slate-500">
                                        <span>آفر ارزی: {item.priceForeign.toLocaleString('fa-IR')} {item.currency}</span>
                                        <span className="font-semibold text-slate-600">{(item.priceRiyal * item.quantity).toLocaleString('fa-IR')} ریال</span>
                                      </div>
                                      {item.deliveryTime && (
                                        <div className="text-[9px] text-amber-600 font-medium">زمان تحویل: {item.deliveryTime}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Timeline Events / Steps */}
                              <div className="space-y-2 pt-2 border-t border-slate-100">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                    <Clock size={12} />
                                    مراحل و رویدادهای زمانی
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAddStep(inq)}
                                    className="text-[9px] text-sky-500 hover:text-sky-600 font-bold flex items-center gap-0.5"
                                  >
                                    <Plus size={10} />
                                    ثبت رویداد جدید
                                  </button>
                                </div>

                                {inq.steps && inq.steps.length > 0 ? (
                                  <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                                    {inq.steps.map((step) => (
                                      <div key={step.id} className="relative pr-3 border-r-2 border-slate-200 space-y-0.5 text-[10px]">
                                        {/* Timeline indicator circle */}
                                        <div className="absolute right-[-4.5px] top-1.5 w-2 h-2 rounded-full bg-slate-300" />
                                        
                                        <div className="flex justify-between items-start">
                                          <span className="font-bold text-slate-700">{step.title}</span>
                                          <div className="flex items-center gap-1">
                                            <span className="text-[9px] text-slate-400 font-mono">{step.date}</span>
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteStepClick(inq.id, step.id)}
                                              className="text-slate-300 hover:text-rose-500 transition"
                                            >
                                              <X size={10} />
                                            </button>
                                          </div>
                                        </div>
                                        {step.method && (
                                          <div className="text-[9px] text-slate-500">
                                            روش: {step.method} {step.recipientName ? `| تحویل‌گیرنده: ${step.recipientName}` : ''}
                                          </div>
                                        )}
                                        {step.notes && <p className="text-[9px] text-slate-400 truncate">{step.notes}</p>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-3 text-center text-slate-300 text-[10px]">هیچ رویدادی ثبت نشده است</div>
                                )}
                              </div>
                            </div>

                            {/* Winner banner footer */}
                            {inq.isWinner && (
                              <div className="bg-amber-400/90 text-slate-900 py-1.5 text-center text-[10px] font-extrabold tracking-wider flex items-center justify-center gap-1 shadow-inner">
                                <CheckCircle2 size={12} />
                                پیشنهاد برنده نهایی - {inq.winnerDate || inq.creationDate}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400 space-y-4 shadow-sm" id="empty-state">
                    <Activity size={40} className="mx-auto text-slate-300" />
                    <div className="text-sm font-bold text-slate-700">هیچ استعلام قیمتی ثبت نشده است</div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      برای این پروژه هنوز استعلام قیمتی از تأمین‌کنندگان ثبت نگردیده است. با کلیک بر روی دکمه «ثبت استعلام قیمت جدید» می‌توانید اولین آفر را ثبت نمایید.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenAddInquiry}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5"
                    >
                      <Plus size={14} />
                      افزودن اولین استعلام
                    </button>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="compare-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {filteredInquiries.length > 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-4 overflow-x-auto" id="comparison-container">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-2">
                      <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                        <ArrowLeftRight className="text-sky-500" size={18} />
                        جدول مقایسه آفر شرکت‌های تأمین‌کننده
                      </span>
                    </div>

                    <table className="w-full text-right text-xs min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-150">
                          <th className="p-3">تأمین‌کننده</th>
                          <th className="p-3">قیمت کل (ریال)</th>
                          <th className="p-3">اقلام پیشنهادی</th>
                          <th className="p-3">اسناد و فایل‌ها</th>
                          <th className="p-3">زمان‌های تحویل</th>
                          <th className="p-3 text-center">وضعیت</th>
                          <th className="p-3 text-center">عملیات انتخاب برنده</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredInquiries.map((inq) => {
                          const totalRiyal = inq.items.reduce((sum, item) => sum + (item.priceRiyal * item.quantity), 0);
                          return (
                            <tr key={inq.id} className={`hover:bg-slate-50/50 transition ${inq.isWinner ? 'bg-amber-50/20' : ''}`}>
                              <td className="p-3 font-bold text-slate-800">
                                <div className="space-y-0.5">
                                  <span>{inq.supplierName}</span>
                                  {selectedProjectId === 'all' && (
                                    <span className="text-[10px] text-sky-600 block">
                                      پروژه: {projects.find(p => p.id === inq.projectId)?.name || 'نامشخص'}
                                    </span>
                                  )}
                                  {inq.isWinner && <span className="text-[9px] text-amber-600 block">★ انتخاب شده</span>}
                                </div>
                              </td>
                              <td className="p-3 font-bold text-sky-600 font-mono text-sm">
                                {totalRiyal.toLocaleString('fa-IR')} <span className="text-[10px] text-slate-400">ریال</span>
                              </td>
                              <td className="p-3">
                                <div className="space-y-1">
                                  {inq.items.map((item, idx) => (
                                    <div key={idx} className="text-[11px] text-slate-600 flex items-center gap-1">
                                      <span className="font-medium text-slate-800">{item.name}:</span>
                                      <span className="font-mono">{item.priceForeign.toLocaleString('fa-IR')} {item.currency}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-col gap-1 w-28">
                                  {inq.technicalOfferUrl ? (
                                    <a href={inq.technicalOfferUrl} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-600 hover:underline flex items-center gap-1 font-semibold">
                                      <FileText size={12} /> دانلود پیشنهاد فنی
                                    </a>
                                  ) : <span className="text-[10px] text-slate-400">بدون فایل فنی</span>}
                                  {inq.financialOfferUrl ? (
                                    <a href={inq.financialOfferUrl} target="_blank" rel="noreferrer" className="text-[10px] text-sky-600 hover:underline flex items-center gap-1 font-semibold">
                                      <FileText size={12} /> دانلود پیشنهاد مالی
                                    </a>
                                  ) : <span className="text-[10px] text-slate-400">بدون فایل مالی</span>}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="space-y-0.5 text-slate-600 max-w-xs">
                                  {inq.items.map((item, idx) => item.deliveryTime ? (
                                    <div key={idx} className="text-[10px]">
                                      {item.name}: <span className="text-amber-600 font-bold">{item.deliveryTime}</span>
                                    </div>
                                  ) : null)}
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                                  inq.isWinner ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {inq.isWinner ? 'برنده' : 'نامشخص / بازنده'}
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleSetWinner(inq.id)}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 mx-auto ${
                                    inq.isWinner 
                                      ? 'bg-amber-500 text-slate-900 hover:bg-amber-600 shadow-md shadow-amber-500/10' 
                                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                                  }`}
                                >
                                  {inq.isWinner ? (
                                    <>
                                      <Check size={12} />
                                      لغو برنده
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 size={12} />
                                      انتخاب برنده
                                    </>
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400 shadow-sm">
                    تأمین‌کننده‌ای ثبت نشده است تا بتوانید آنها را مقایسه کنید.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center text-slate-400 space-y-4 shadow-sm" id="intro-card">
          <Globe size={48} className="mx-auto text-slate-300 animate-pulse" />
          <h2 className="text-base font-bold text-slate-700">پروژه خود را برای آغاز استعلام انتخاب کنید</h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            برای ثبت، ویرایش، مقایسه و بارگذاری آفر شرکت‌های همکار، ابتدا لطفاً یکی از پروژه‌های فعال را از منوی بالای صفحه انتخاب فرمایید.
          </p>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Inquiry Form Modal (Add / Edit) */}
      {/* ---------------------------------------------------- */}
      <AnimatePresence>
        {isInquiryModalOpen && (
          <div className={`fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto ${isInquiryModalFullscreen ? 'p-0' : 'p-4'}`}>
            {/* Overlay */}
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsInquiryModalOpen(false)} />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`relative bg-white shadow-2xl border border-slate-100 z-10 text-right overflow-hidden flex flex-col justify-between ${
                isInquiryModalFullscreen 
                  ? 'w-screen h-screen rounded-none my-0 max-w-full' 
                  : 'rounded-2xl w-full max-w-4xl max-h-[90vh]'
              }`}
              id="inquiry-modal-content"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
                <h3 className="text-sm font-extrabold text-slate-800">
                  {editingInquiry ? `ویرایش استعلام قیمت تأمین‌کننده: ${editingInquiry.supplierName}` : 'ثبت استعلام قیمت تأمین‌کننده جدید'}
                </h3>
                <div className="flex items-center gap-1.5">
                  <button 
                    type="button"
                    onClick={() => setIsInquiryModalFullscreen(!isInquiryModalFullscreen)} 
                    className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                    title={isInquiryModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                  >
                    {isInquiryModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button type="button" onClick={() => setIsInquiryModalOpen(false)} className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Form implementation */}
              <div className={`p-6 overflow-y-auto ${isInquiryModalFullscreen ? 'max-h-[calc(100vh-80px)] flex-1' : 'max-h-[75vh]'}`}>
                <InquiryFormInner 
                  editingInquiry={editingInquiry}
                  selectedProjectId={selectedProjectId}
                  suppliers={suppliers}
                  exchangeRates={exchangeRates}
                  selectedProject={selectedProject}
                  projects={projects}
                  getCurrencyRate={getCurrencyRate}
                  settings={settings}
                  onClose={() => setIsInquiryModalOpen(false)}
                  onSubmit={(data) => {
                    if (editingInquiry) {
                      updateSupplierInquiry({
                        ...editingInquiry,
                        ...data
                      });
                    } else {
                      addSupplierInquiry(data);
                    }
                    setIsInquiryModalOpen(false);
                  }}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- */}
      {/* Timeline Event Modal */}
      {/* ---------------------------------------------------- */}
      <AnimatePresence>
        {isStepModalOpen && activeInquiryForStep && (
          <div className="fixed inset-0 z-[1010] flex items-center justify-center p-4">
            {/* Overlay */}
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsStepModalOpen(false)} />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 z-10 text-right"
              id="step-modal-content"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <h3 className="text-sm font-bold text-slate-800">ثبت رویداد زمانی جدید (استعلام {activeInquiryForStep.supplierName})</h3>
                <button type="button" onClick={() => setIsStepModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>

              <StepFormInner 
                settings={settings}
                onClose={() => setIsStepModalOpen(false)}
                onSubmit={(newStep) => {
                  const updatedSteps = [...(activeInquiryForStep.steps || []), newStep];
                  updateSupplierInquiry({
                    ...activeInquiryForStep,
                    steps: updatedSteps
                  });
                  setIsStepModalOpen(false);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- */}
      {/* Confirmation Delete dialog */}
      {/* ---------------------------------------------------- */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteActivitiesWithInquiry(false);
        }}
        onConfirm={handleConfirmDelete}
        title="تایید حذف اطلاعات"
        message={
          deleteTarget?.type === 'inquiry' 
            ? "آیا از حذف کامل این استعلام قیمت تأمین‌کننده اطمینان دارید؟ تمامی قیمت‌ها، اقلام و مراحل زمانی آن حذف خواهند شد."
            : "آیا از حذف این رویداد زمانی استعلام اطمینان دارید؟"
        }
        confirmText="بله، حذف شود"
        cancelText="انصراف"
      >
        {deleteTarget?.type === 'inquiry' && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-2">
            <input
              type="checkbox"
              id="deleteActivitiesInquiry"
              checked={deleteActivitiesWithInquiry}
              onChange={(e) => setDeleteActivitiesWithInquiry(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="deleteActivitiesInquiry" className="text-xs text-slate-600">
              حذف لاگ‌های فعالیت پروژه مرتبط با این استعلام (در دسته‌بندی استعلام قیمت تأمین‌کنندگان)
            </label>
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}

// ----------------------------------------------------------------------
// InquiryFormInner sub-component
// ----------------------------------------------------------------------
interface InquiryFormInnerProps {
  editingInquiry: SupplierInquiry | null;
  selectedProjectId: string;
  suppliers: Supplier[];
  exchangeRates: ExchangeRate[];
  selectedProject?: Project;
  projects: Project[];
  getCurrencyRate: (currency: string) => number;
  settings: ERPSettings;
  onClose: () => void;
  onSubmit: (data: Omit<SupplierInquiry, 'id' | 'creationDate'>) => void;
}

function InquiryFormInner({
  editingInquiry,
  selectedProjectId,
  suppliers,
  exchangeRates,
  selectedProject,
  projects,
  getCurrencyRate,
  settings,
  onClose,
  onSubmit
}: InquiryFormInnerProps) {
  const [projectId, setProjectId] = useState<string>(() => {
    if (editingInquiry) return editingInquiry.projectId;
    return selectedProjectId === 'all' ? '' : selectedProjectId;
  });
  const [supplierId, setSupplierId] = useState<string>(editingInquiry?.supplierId || '');
  const [technicalFile, setTechnicalFile] = useState<File | null>(null);
  const [financialFile, setFinancialFile] = useState<File | null>(null);
  const [technicalOfferUrl, setTechnicalOfferUrl] = useState<string>(editingInquiry?.technicalOfferUrl || '');
  const [financialOfferUrl, setFinancialOfferUrl] = useState<string>(editingInquiry?.financialOfferUrl || '');
  
  const [uploadingTechnical, setUploadingTechnical] = useState(false);
  const [uploadingFinancial, setUploadingFinancial] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Initial Step states (for creating a new inquiry)
  const defaultStepTitle = settings.dropdownItems.supplierInquirySteps?.[0] || 'ارسال استعلام قیمت';
  const [initialStepTitle, setInitialStepTitle] = useState(defaultStepTitle);
  const [initialStepCustomTitle, setInitialStepCustomTitle] = useState('');
  const [initialStepDate, setInitialStepDate] = useState(getTodayShamsi());
  const [initialStepMethod, setInitialStepMethod] = useState('ایمیل');
  const [initialStepRecipientName, setInitialStepRecipientName] = useState('');
  const [initialStepNotes, setInitialStepNotes] = useState('استعلام با موفقیت ثبت شد.');

  // Pre-load items: either what inquiry has, or map from project's itemsNeeded
  const [items, setItems] = useState<SupplierInquiryItem[]>(() => {
    if (editingInquiry && editingInquiry.items) {
      return [...editingInquiry.items];
    }
    if (selectedProject && selectedProject.itemsNeeded) {
      return selectedProject.itemsNeeded.map((item, idx) => ({
        id: `inq-item-${Date.now()}-${idx}`,
        name: item.name,
        quantity: item.quantity,
        priceForeign: 0,
        currency: 'دلار',
        priceRiyal: 0,
        notes: '',
        tagNumber: item.tagNumber
      }));
    }
    return [];
  });

  const handleAddItemRow = () => {
    setItems(prev => [
      ...prev,
      {
        id: `inq-item-${Date.now()}`,
        name: '',
        quantity: 1,
        priceForeign: 0,
        currency: 'دلار',
        priceRiyal: 0,
        notes: ''
      }
    ]);
  };

  const handleRemoveItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleItemFieldChange = (idx: number, field: keyof SupplierInquiryItem, value: any) => {
    setItems(prev => prev.map((item, i) => {
      if (i === idx) {
        const updatedItem = { ...item, [field]: value };
        
        // Auto calculate Rial equivalent if currency or priceForeign changes
        if (field === 'priceForeign' || field === 'currency') {
          const rate = getCurrencyRate(updatedItem.currency);
          updatedItem.priceRiyal = Number(updatedItem.priceForeign) * rate;
        }
        return updatedItem;
      }
      return item;
    }));
  };

  // Upload files handler
  const handleUploadFile = async (type: 'technical' | 'financial', file: File) => {
    setUploadError('');
    if (type === 'technical') {
      setUploadingTechnical(true);
      try {
        const url = await uploadToSupplierInquiries(file);
        setTechnicalOfferUrl(url);
      } catch (err: any) {
        setUploadError(err.message || 'خطا در بارگذاری پیشنهاد فنی');
      } finally {
        setUploadingTechnical(false);
      }
    } else {
      setUploadingFinancial(true);
      try {
        const url = await uploadToSupplierInquiries(file);
        setFinancialOfferUrl(url);
      } catch (err: any) {
        setUploadError(err.message || 'خطا در بارگذاری پیشنهاد مالی');
      } finally {
        setUploadingFinancial(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isFieldRequired(settings, 'supplierInquiries', 'projectId') && !projectId) {
      alert('فیلد "پروژه" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'supplierInquiries', 'supplierId') && !supplierId) {
      alert('فیلد "تأمین‌کننده" الزامی است.');
      return;
    }
    if (!projectId) {
      alert("لطفاً یک پروژه را انتخاب نمایید.");
      return;
    }
    if (!supplierId) {
      alert("لطفاً یک تأمین‌کننده را انتخاب نمایید.");
      return;
    }
    if (items.length === 0) {
      alert("لطفاً حداقل یک ردیف قلم کالا به آفر استعلام اضافه کنید.");
      return;
    }

    const selectedSupp = suppliers.find(s => s.id === supplierId);
    if (!selectedSupp) return;

    onSubmit({
      projectId: projectId,
      supplierId: supplierId,
      supplierName: selectedSupp.name,
      items: items.map(item => ({
        ...item,
        priceForeign: Number(item.priceForeign),
        priceRiyal: Number(item.priceRiyal),
        quantity: Number(item.quantity)
      })),
      technicalOfferUrl: technicalOfferUrl || undefined,
      financialOfferUrl: financialOfferUrl || undefined,
      steps: editingInquiry?.steps || [
        {
          id: `step-${Date.now()}`,
          title: initialStepTitle === 'سایر' ? (initialStepCustomTitle || 'رویداد ثبت شده') : (initialStepTitle || 'ارسال استعلام قیمت'),
          date: initialStepDate,
          notes: initialStepNotes || undefined,
          method: initialStepMethod || undefined,
          recipientName: initialStepRecipientName || undefined
        }
      ],
      isWinner: editingInquiry?.isWinner || false,
      winnerDate: editingInquiry?.winnerDate
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Project Selector */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'supplierInquiries', 'projectId', 'انتخاب پروژه')}</label>
          <select
            value={projectId}
            onChange={(e) => {
              const newProjId = e.target.value;
              setProjectId(newProjId);
              if (!editingInquiry) {
                const targetProj = projects.find(p => p.id === newProjId);
                if (targetProj && targetProj.itemsNeeded) {
                  setItems(targetProj.itemsNeeded.map((item, idx) => ({
                    id: `inq-item-${Date.now()}-${idx}`,
                    name: item.name,
                    quantity: item.quantity,
                    priceForeign: 0,
                    currency: 'دلار',
                    priceRiyal: 0,
                    notes: '',
                    tagNumber: item.tagNumber
                  })));
                } else {
                  setItems([]);
                }
              }
            }}
            required
            disabled={editingInquiry !== null} // Lock project on edit
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">-- انتخاب پروژه --</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </div>

        {/* Supplier Selector */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'supplierInquiries', 'supplierId', 'انتخاب تأمین‌کننده')}</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            required={isFieldRequired(settings, 'supplierInquiries', 'supplierId')}
            disabled={editingInquiry !== null} // Lock supplier on edit
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">-- انتخاب تأمین‌کننده --</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.country || 'بدون کشور'})</option>
            ))}
          </select>
        </div>

        {/* Currency brief display */}
        <div className="bg-slate-50/50 p-3 rounded-xl border border-dashed border-slate-200 flex items-center justify-between text-xs">
          <div className="space-y-1">
            <span className="font-bold text-slate-600 block">نرخ‌های ارز فعال جهت مرجع محاسبات:</span>
            <div className="flex flex-wrap gap-1 font-mono text-[10px] text-slate-500">
              {exchangeRates.map(rate => (
                <span key={rate.id} className="bg-white px-1.5 py-0.5 rounded border border-slate-100">{rate.currency}: {rate.rateToRIYAL.toLocaleString('fa-IR')}</span>
              ))}
            </div>
          </div>
          <Coins size={20} className="text-slate-400 shrink-0" />
        </div>
      </div>

      {!editingInquiry && (
        <div className="border border-slate-150 p-5 rounded-2xl bg-slate-50/50 space-y-4">
          <div className="border-b border-slate-200 pb-2.5 mb-2">
            <h4 className="text-xs font-bold text-slate-700">ثبت رویداد/مرحله اولیه استعلام</h4>
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">مرحله فعلی استعلام را انتخاب کنید و جزئیات اولین اقدام را ثبت نمایید (فراخوانی شده از لیست‌های بازشوی تنظیمات)</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step Title Dropdown */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">انتخاب مرحله/رویداد <span className="text-rose-500">*</span></label>
              <select
                value={initialStepTitle}
                onChange={(e) => setInitialStepTitle(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              >
                {(settings.dropdownItems.supplierInquirySteps || []).map((step, idx) => (
                  <option key={idx} value={step}>{step}</option>
                ))}
                <option value="سایر">سایر (تایپ دلخواه)</option>
              </select>
            </div>

            {/* Custom Step Title */}
            {initialStepTitle === 'سایر' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">عنوان مرحله دلخواه <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="مثال: پیگیری تلفنی آفر"
                  value={initialStepCustomTitle}
                  onChange={(e) => setInitialStepCustomTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                />
              </div>
            )}

            {/* Step Date */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">تاریخ اقدام <span className="text-rose-500">*</span></label>
              <ShamsiDatePicker
                value={initialStepDate}
                onChange={setInitialStepDate}
              />
            </div>

            {/* Step Method */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">روش ارتباطی</label>
              <select
                value={initialStepMethod}
                onChange={(e) => setInitialStepMethod(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              >
                <option value="ایمیل">ایمیل (Email)</option>
                <option value="واتساپ">واتساپ (WhatsApp)</option>
                <option value="تلفن">تلفن (Call)</option>
                <option value="حضوری">حضوری (In-Person)</option>
                <option value="سایر">سایر</option>
              </select>
            </div>

            {/* Step Recipient Name */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">نام مخاطب/گیرنده (تأمین‌کننده)</label>
              <input
                type="text"
                value={initialStepRecipientName}
                onChange={(e) => setInitialStepRecipientName(e.target.value)}
                placeholder="مثال: مهندس حسینی"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
            </div>
          </div>

          {/* Step Notes */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">توضیحات رویداد اولیه</label>
            <textarea
              value={initialStepNotes}
              onChange={(e) => setInitialStepNotes(e.target.value)}
              rows={2}
              placeholder="مثال: ارسال استعلام قیمت از طریق ایمیل برای فلانی انجام شد و منتظر پاسخ تا انتهای هفته هستیم."
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-right"
            />
          </div>
        </div>
      )}

      {/* Items Needed proposal lists */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500 block">اقلام پیشنهادی آفر تأمین‌کننده</span>
          <button
            type="button"
            onClick={handleAddItemRow}
            className="px-2.5 py-1.5 bg-sky-50 text-sky-600 border border-sky-100 hover:bg-sky-100 rounded-lg text-[10px] font-bold transition flex items-center gap-1"
          >
            <Plus size={12} />
            افزودن سطر دستی جدید
          </button>
        </div>

        <div className="border border-slate-150 rounded-xl overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-right text-xs min-w-[950px]">
            <thead className="bg-slate-50 text-slate-500 font-bold sticky top-0 border-b border-slate-150 z-10">
              <tr>
                <th className="p-2.5 w-1/4">نام کالا / شرح دقیق آفر</th>
                <th className="p-2.5 w-12 text-center">تعداد</th>
                <th className="p-2.5 w-24">مبلغ ارزی واحد</th>
                <th className="p-2.5 w-20">نوع ارز</th>
                <th className="p-2.5 w-28">معادل ریالی پیشنهادی</th>
                <th className="p-2.5 w-24">زمان تحویل</th>
                <th className="p-2.5">توضیحات آفر</th>
                <th className="p-2.5 w-12 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, index) => (
                <tr key={item.id} className="hover:bg-slate-50/50">
                  <td className="p-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleItemFieldChange(index, 'name', e.target.value)}
                      placeholder="مثال: ترانسمیتر فشار فلوبر"
                      required
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                    />
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] text-slate-500 whitespace-nowrap">تگ نامبر:</span>
                      <input
                        type="text"
                        value={item.tagNumber || ''}
                        onChange={(e) => handleItemFieldChange(index, 'tagNumber', e.target.value)}
                        placeholder="مثال: PIT-101"
                        className="w-full border border-slate-200 rounded-md px-2 py-0.5 text-[9px] bg-white font-mono text-right"
                      />
                    </div>
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => handleItemFieldChange(index, 'quantity', e.target.value)}
                      required
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-center font-mono focus:outline-none bg-white"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={item.priceForeign}
                      onChange={(e) => handleItemFieldChange(index, 'priceForeign', e.target.value)}
                      required
                      placeholder="0"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg font-mono focus:outline-none bg-white"
                    />
                  </td>
                  <td className="p-2">
                    <select
                      value={item.currency}
                      onChange={(e) => handleItemFieldChange(index, 'currency', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none bg-white"
                    >
                      <option value="دلار">دلار</option>
                      <option value="یورو">یورو</option>
                      <option value="درهم">درهم</option>
                      <option value="یوان">یوان</option>
                      <option value="ریال">ریال</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={item.priceRiyal}
                      onChange={(e) => handleItemFieldChange(index, 'priceRiyal', e.target.value)}
                      required
                      placeholder="0"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg font-bold text-sky-600 font-mono focus:outline-none bg-white"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={item.deliveryTime || ''}
                      onChange={(e) => handleItemFieldChange(index, 'deliveryTime', e.target.value)}
                      placeholder="مثال: ۲ هفته"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none bg-white"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={item.notes || ''}
                      onChange={(e) => handleItemFieldChange(index, 'notes', e.target.value)}
                      placeholder="بسته‌بندی اورجینال"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none bg-white"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveItemRow(index)}
                      title="حذف این ردیف کالا"
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center justify-center mx-auto"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Technical and Financial Upload fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Technical Offer Upload */}
        <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50 space-y-2 relative">
          <span className="text-xs font-bold text-slate-700 block">بارگذاری پروپوزال / پیشنهاد فنی (Technical Offer)</span>
          
          <div className="flex items-center gap-3">
            <label className="cursor-pointer bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-[11px] font-bold text-slate-700 transition flex items-center gap-1">
              <Upload size={14} className="text-slate-500" />
              انتخاب فایل فنی
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadFile('technical', file);
                }}
              />
            </label>

            {uploadingTechnical && <span className="text-[10px] text-sky-600 animate-pulse font-bold">در حال آپلود...</span>}
            {technicalOfferUrl && (
              <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                <Check size={12} /> فایل با موفقیت آپلود شد
              </span>
            )}
          </div>
          {technicalOfferUrl && (
            <div className="text-[10px] text-slate-400 break-all bg-white p-1.5 rounded border border-slate-100 font-mono">
              مسیر ذخیره: {technicalOfferUrl}
            </div>
          )}
        </div>

        {/* Financial Offer Upload */}
        <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50 space-y-2 relative">
          <span className="text-xs font-bold text-slate-700 block">بارگذاری پیشنهاد مالی (Financial Offer / Invoice)</span>
          
          <div className="flex items-center gap-3">
            <label className="cursor-pointer bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-[11px] font-bold text-slate-700 transition flex items-center gap-1">
              <Upload size={14} className="text-slate-500" />
              انتخاب فایل مالی
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadFile('financial', file);
                }}
              />
            </label>

            {uploadingFinancial && <span className="text-[10px] text-sky-600 animate-pulse font-bold">در حال آپلود...</span>}
            {financialOfferUrl && (
              <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                <Check size={12} /> فایل با موفقیت آپلود شد
              </span>
            )}
          </div>
          {financialOfferUrl && (
            <div className="text-[10px] text-slate-400 break-all bg-white p-1.5 rounded border border-slate-100 font-mono">
              مسیر ذخیره: {financialOfferUrl}
            </div>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="p-3 bg-rose-50 text-rose-600 text-xs rounded-xl flex items-center gap-1.5">
          <AlertTriangle size={14} />
          {uploadError}
        </div>
      )}

      {/* Buttons */}
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
        >
          انصراف
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-md shadow-sky-500/10"
        >
          {editingInquiry ? 'ثبت تغییرات استعلام' : 'ثبت نهایی استعلام قیمت'}
        </button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------
// StepFormInner sub-component
// ----------------------------------------------------------------------
interface StepFormInnerProps {
  onClose: () => void;
  onSubmit: (step: InquiryStep) => void;
  settings: ERPSettings;
}

function StepFormInner({ onClose, onSubmit, settings }: StepFormInnerProps) {
  const defaultStepTitle = settings.dropdownItems.supplierInquirySteps?.[0] || '';
  const [title, setTitle] = useState(defaultStepTitle);
  const [customTitle, setCustomTitle] = useState('');
  const [date, setDate] = useState(getTodayShamsi());
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState('ایمیل');
  const [recipientName, setRecipientName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = title === 'سایر' ? customTitle : title;
    if (!finalTitle) {
      alert("لطفاً عنوان رویداد را وارد نمایید.");
      return;
    }

    onSubmit({
      id: `step-${Date.now()}`,
      title: finalTitle,
      date,
      notes: notes || undefined,
      method,
      recipientName: recipientName || undefined
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-500">عنوان رویداد / مرحله <span className="text-rose-500">*</span></label>
        <select
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {(settings.dropdownItems.supplierInquirySteps || []).map((step, idx) => (
            <option key={idx} value={step}>{step}</option>
          ))}
          <option value="سایر">سایر (تایپ دلخواه)</option>
        </select>
      </div>

      {title === 'سایر' && (
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">عنوان رویداد دلخواه <span className="text-rose-500">*</span></label>
          <input
            type="text"
            required
            placeholder="مثال: پیگیری تلفنی آفر"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      )}

      {/* Date */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-500">تاریخ رویداد <span className="text-rose-500">*</span></label>
        <ShamsiDatePicker
          value={date}
          onChange={setDate}
        />
      </div>

      {/* Method */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-500">روش ارتباطی</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <option value="ایمیل">ایمیل (Email)</option>
          <option value="واتساپ">واتساپ (WhatsApp)</option>
          <option value="تلفن">تلفن (Call)</option>
          <option value="حضوری">حضوری (In-Person)</option>
          <option value="سایر">سایر</option>
        </select>
      </div>

      {/* Recipient Name */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-500">نام مخاطب در سمت تأمین‌کننده (گیرنده/فرستنده)</label>
        <input
          type="text"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder="مثال: مهندس حسینی"
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-500">توضیحات تکمیلی</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="توضیحات مربوط به نحوه پیگیری، آفر ارسالی و غیره..."
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 text-right"
        />
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
        >
          انصراف
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-md shadow-sky-500/10"
        >
          ثبت رویداد
        </button>
      </div>
    </form>
  );
}
