import React, { useState, useMemo, useEffect } from 'react';
import { useExchangeRates } from '../api/exchangeRates';
import { ACTIVITY_CATEGORY } from '../utils/activityCategories';
import { computeInquiryTotals } from '../utils/inquirySteps';
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
  BadgeCheck,
  Zap,
  AlertTriangle,
  FileSpreadsheet,
  Globe,
  Coins,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  Project, 
  Supplier, 
  SupplierInquiry, 
  SupplierInquiryItem,
  ExchangeRate,
  ERPSettings,
  // Aliased: `User` here is the lucide icon.
  User as AppUser
} from '../types';
import ConfirmModal from './ConfirmModal';
import DeleteActivitiesOption from './DeleteActivitiesOption';
import ShamsiDatePicker from './ShamsiDatePicker';
import { getTodayShamsi } from '../dateUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import { SearchableSelect } from './SearchableSelect';
import { downloadFileFromServer } from '../imageUtils';
import { ApiError } from '../api/client';
import {
  InquiryStepInput, InquiryWriteInput,
  inquiryToWriteInput, rowToInquiry, supplierInquiriesApi,
} from '../api/supplierInquiries';
import { useSupplierInquiryList } from '../api/useSupplierInquiryList';
import { useEntitySearch } from '../api/useEntitySearch';
import { detailToProject } from '../api/projectAdapter';
import { projectsApi } from '../api/projects';
import type { ProjectRow } from '../api/projects';
import type { SupplierRow } from '../api/suppliers';
import type { ProductRow } from '../api/products';
import type { useCategoryCompletion } from '../api/useCategoryCompletion';
import CostAccessNotice from './CostAccessNotice';
import { canSeeCosts } from '../utils/permissions';

/**
 * Supplier inquiries screen.
 *
 * Reads through the API. A rule that used to live here now belongs to the
 * server, because it does not survive a paged list: the event timeline is
 * derived from what the user does.
 */
interface SupplierInquiriesViewProps {
  // Inquiries, projects and suppliers are no longer props, and neither are the
  // three mutations: the view calls the API, so the derived steps come back
  // from the server that applied them.
  settings: ERPSettings;
  /** Read for one thing: whether this user may see the offers. */
  currentUser?: AppUser | null;
  /**
   * Offers to close the project's inquiry category when this module reaches its
   * end — the final offer confirmed, or a winner declared. Optional, like every
   * other module's, so the screen still works without it.
   */
  categoryCompletion?: ReturnType<typeof useCategoryCompletion>;
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
  settings,
  currentUser,
  categoryCompletion,
}: SupplierInquiriesViewProps) {
  /*
   * An offer is the purchase price before it becomes one, so this screen is not
   * hidden field by field for a user without the cost permission — the server
   * sends it to them with the amounts blanked and refuses their saves. All this
   * decides is whether they are told why.
   */
  const showCosts = canSeeCosts(currentUser);

  // Rates are read here rather than handed down: they are a short shared list
  // that changes during the day, and a stale one misprices a document.
  const { rates: exchangeRates } = useExchangeRates();

  const list = useSupplierInquiryList();
  const selectedProjectId = list.filters.projectId;
  const [activeTab, setActiveTab] = useState<'cards' | 'compare'>('cards');

  // Modals state
  const [isInquiryModalOpen, setIsInquiryModalOpen] = useState(false);
  const [isInquiryModalFullscreen, setIsInquiryModalFullscreen] = useState(false);
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [editingInquiry, setEditingInquiry] = useState<SupplierInquiry | null>(null);
  const [activeInquiryForStep, setActiveInquiryForStep] = useState<SupplierInquiry | null>(null);

  // Confirm Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'inquiry' | 'step'; inquiryId: string; stepId?: string } | null>(null);
  const [alsoRemoveActivities, setAlsoRemoveActivities] = useState(false);

  /* The project selector doubles as the list's filter, so its options come from
     the server rather than from every project the browser happens to hold. */
  const projectPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects', limit: 25,
    params: { withSummary: 'false' },
    getLabel: (row) => row.name,
  });
  const supplierPicker = useEntitySearch<SupplierRow>({
    path: '/api/suppliers', limit: 25, enabled: isInquiryModalOpen,
    getLabel: (row) => row.name,
  });

  /*
   * The catalogue an inquiry line can point at.
   *
   * Left as list rows: a row carries the SKUs (id, sku, attributes) and that is
   * everything the picker needs. Casting it to `Product` would make the whole
   * detail record look available and the compiler would agree — which is how
   * three separate `undefined`s reached the browser on the purchase-order
   * screen.
   */
  const productPicker = useEntitySearch<ProductRow>({
    path: '/api/products', limit: 100, enabled: isInquiryModalOpen,
    getLabel: (row) => row.displayName,
  });

  const projects = projectPicker.matches as unknown as Project[];
  const suppliers = supplierPicker.matches as unknown as Supplier[];
  const catalogue = productPicker.matches;

  const filteredInquiries = useMemo(() => list.rows.map(rowToInquiry), [list.rows]);

  /* The chosen project's own record, for the "items needed" brief and to seed a
     new inquiry's lines. A list row carries neither, so this is a real fetch. */
  const [selectedProject, setSelectedProject] = useState<Project | undefined>();
  useEffect(() => {
    if (selectedProjectId === 'all') {
      setSelectedProject(undefined);
      return;
    }
    let cancelled = false;
    projectsApi.get(selectedProjectId)
      .then((detail) => { if (!cancelled) setSelectedProject(detailToProject(detail)); })
      .catch(() => { if (!cancelled) setSelectedProject(undefined); });
    return () => { cancelled = true; };
  }, [selectedProjectId]);

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

  /**
   * Offers to close the project's inquiry category.
   *
   * A project may be supplied piecewise, so several inquiries can win and
   * several final offers can arrive — which is why this asks rather than
   * closing, and why the message says how many winning offers the project has
   * so far. Answering "no" on the first of three costs nothing; the prompt
   * comes back with the next one.
   *
   * The category name is the canonical spelling the server writes when it
   * records an inquiry on the timeline. A variant would find no group, and the
   * prompt would have nothing to close.
   */
  const promptCloseInquiryCategory = (
    inquiry: { projectId: string; id: string },
    what: string,
  ) => {
    if (!categoryCompletion || !inquiry.projectId) return;

    // Counted from what this screen holds for the project, including the change
    // just made — the refresh above has not landed yet.
    const winners = filteredInquiries.filter(
      (i) => i.projectId === inquiry.projectId && (i.isWinner || i.id === inquiry.id),
    ).length;

    categoryCompletion.promptCompletion({
      projectId: inquiry.projectId,
      categoryName: ACTIVITY_CATEGORY.INQUIRIES,
      message:
        `${what}`
        + (winners > 1 ? ` این پروژه اکنون ${winners} آفر برنده دارد.` : '')
        + ' آیا می‌خواهید وضعیت دسته فعالیت استعلام قیمت این پروژه را به «اتمام کار» تغییر دهید؟',
    });
  };

  /**
   * Declares — or withdraws — a winning offer.
   *
   * A project may have several: one supplier for the flow meters, another for
   * the valves. Marking this one no longer withdraws any other.
   */
  const handleSetWinner = async (inquiryId: string) => {
    const target = filteredInquiries.find(inq => inq.id === inquiryId);
    if (!target) return;
    const isNowWinner = !target.isWinner;

    try {
      await supplierInquiriesApi.update(inquiryId, {
        isWinner: isNowWinner,
        winnerDate: isNowWinner ? getTodayShamsi() : null,
      });
      list.refresh();

      // Declaring a winner is where this module ends for that part of the
      // scope. Withdrawing one is not, so only the forward move asks.
      if (isNowWinner) {
        promptCloseInquiryCategory(
          target,
          `آفر تأمین‌کننده «${target.supplierName}» به عنوان پیشنهاد برنده انتخاب شد.`,
        );
      }
    } catch (err) {
      reportError(err, 'ثبت وضعیت برنده با خطا مواجه شد.');
    }
  };

  // Confirms the offer's validity -> the inquiry moves to the "final offer" stage.
  const handleToggleOfferConfirmed = async (inquiryId: string) => {
    const inq = filteredInquiries.find(i => i.id === inquiryId);
    if (!inq) return;
    const isNowConfirmed = !inq.offerConfirmed;

    try {
      await supplierInquiriesApi.update(inquiryId, {
        offerConfirmed: isNowConfirmed,
        offerConfirmedDate: isNowConfirmed ? getTodayShamsi() : null,
      });
      list.refresh();

      if (isNowConfirmed) {
        promptCloseInquiryCategory(
          inq,
          `آفر نهایی تأمین‌کننده «${inq.supplierName}» دریافت و تأیید شد.`,
        );
      }
    } catch (err) {
      reportError(err, 'ثبت تأیید آفر با خطا مواجه شد.');
    }
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

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setAlsoRemoveActivities(false);

    try {
      if (target.type === 'inquiry') {
        await supplierInquiriesApi.remove(target.inquiryId, alsoRemoveActivities);
      } else if (target.stepId) {
        // Refused for a derived step, with the server's own explanation.
        await supplierInquiriesApi.removeStep(target.inquiryId, target.stepId);
      }
      list.refresh();
    } catch (err) {
      reportError(err, 'حذف با خطا مواجه شد.');
    }
  };

  const handleSubmitInquiry = async (
    data: Partial<SupplierInquiry>,
    initialStep?: InquiryWriteInput['initialStep'],
  ) => {
    try {
      if (editingInquiry) {
        await supplierInquiriesApi.update(editingInquiry.id, inquiryToWriteInput({ ...editingInquiry, ...data }));
      } else {
        await supplierInquiriesApi.create({ ...inquiryToWriteInput(data), initialStep });
      }
      setIsInquiryModalOpen(false);
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت استعلام با خطا مواجه شد.');
    }
  };

  /**
   * Corrects the date a step is recorded against.
   *
   * A derived step is dated when the system noticed the change, which is not
   * always when it happened — an offer received on Sunday and entered on
   * Tuesday reads as Tuesday. Only the date; its wording comes from the offer.
   */
  const handleStepDateChange = async (inquiryId: string, stepId: string, date: string) => {
    if (!date) return;
    try {
      await supplierInquiriesApi.updateStep(inquiryId, stepId, { occurredAt: date });
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت تاریخ اقدام با خطا مواجه شد.');
    }
  };

  const handleAddStep = async (step: InquiryStepInput) => {
    if (!activeInquiryForStep) return;
    try {
      await supplierInquiriesApi.addStep(activeInquiryForStep.id, step);
      setIsStepModalOpen(false);
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت رویداد با خطا مواجه شد.');
    }
  };

  return (
    <div className="space-y-6 text-right" dir="rtl" id="supplier-inquiries-container">
      <CostAccessNotice visible={!showCosts} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm" id="header-section">
        <div>
          <h1 className="text-xl font-bold text-slate-800">استعلام قیمت از تأمین‌کنندگان</h1>
          <p className="text-xs text-slate-500 mt-1">مدیریت قیمت‌های پیشنهادی، آپلود اسناد فنی/مالی و مقایسه همه‌جانبه برای تعیین برنده</p>
        </div>
        
        {/* Project Selector + search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto shrink-0" id="project-selector-wrapper">
          <div className="relative w-full sm:w-56" id="inquiry-search">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={list.search}
              onChange={(e) => list.setSearch(e.target.value)}
              placeholder="جستجوی تأمین‌کننده یا کالا..."
              className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <label className="text-xs font-bold text-slate-600 whitespace-nowrap sm:text-right">پروژه مورد نظر:</label>
          <div id="project-selector" className="w-full sm:w-72">
            <SearchableSelect
              value={selectedProjectId}
              onChange={(val) => list.setFilter('projectId', val || 'all')}
              onSearchChange={projectPicker.setTerm}
              loading={projectPicker.loading}
              placeholder="جستجو و انتخاب پروژه..."
              required
              className="text-xs"
              options={[
                { value: 'all', label: 'همه پروژه‌ها' },
                // The chosen project stays selectable even once the suggestions
                // have moved on to a different search term.
                ...(selectedProject && !projects.some(p => p.id === selectedProject.id)
                  ? [{ value: selectedProject.id, label: `${selectedProject.name} (${selectedProject.code})` }]
                  : []),
                ...projects.map(p => ({ value: p.id, label: `${p.name} (${p.code})` })),
              ]}
            />
          </div>
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

          {list.error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-2xl p-4 flex items-center justify-between gap-3" id="inquiries-error">
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={14} />
                {list.error}
              </span>
              <button
                type="button"
                onClick={list.refresh}
                className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-[11px] font-bold transition"
              >
                تلاش دوباره
              </button>
            </div>
          )}

          {list.initialLoading ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400 text-xs shadow-sm" id="inquiries-loading">
              در حال دریافت استعلام‌ها…
            </div>
          ) : (
          /* Tab Contents.

             Rendered directly rather than through `AnimatePresence`. The exit
             animation on these two panels never reported completion, and with
             `mode="wait"` — which is how this was written — the incoming panel
             is held until it does: the comparison button highlighted and the
             table never appeared. Removing the wrapper keeps the entrance
             animation, which is the part that was doing any work. */
          <>
            {activeTab === 'cards' ? (
              <motion.div
                key="cards-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {filteredInquiries.length > 0 ? (
                  <div className="space-y-2" id="inquiries-scroller-section">
                    <div className="text-xs font-bold text-slate-400 mb-2">
                      استعلام‌ها ({list.total.toLocaleString('fa-IR')} مورد
                      {list.totalPages > 1 && ` - نمایش ${filteredInquiries.length.toLocaleString('fa-IR')} مورد در صفحه ${list.page.toLocaleString('fa-IR')} از ${list.totalPages.toLocaleString('fa-IR')}`}
                      ) - امکان پیمایش افقی
                    </div>

                    {/* Horizontal scroll container */}
                    {/* Rows, not a side-scrolling strip. Comparing offers means
                        reading them against each other, and a horizontal scroll
                        put all but two of them off the screen. */}
                    <div className="flex flex-col gap-5 pb-6">
                      {filteredInquiries.map((inq) => {
                        // Calculate total offer amount in Riyal for brief display
                        const totals = computeInquiryTotals(inq.items, inq.discountPercent, inq.discountAmount);
                        const totalRiyal = totals.netRiyal;
                        return (
                          <div 
                            key={inq.id}
                            className={`w-full bg-white border rounded-2xl shadow-sm transition-all duration-300 relative flex flex-col justify-between overflow-hidden ${
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
                                {inq.offerConfirmed && (
                                  <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded font-bold flex items-center gap-1 w-fit mt-1">
                                    <BadgeCheck size={11} />
                                    آفر نهایی تأییدشده {inq.offerConfirmedDate ? `- ${inq.offerConfirmedDate}` : ''}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleToggleOfferConfirmed(inq.id)}
                                  className={`p-1.5 rounded-lg transition ${
                                    inq.offerConfirmed
                                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                      : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                                  }`}
                                  title={inq.offerConfirmed ? "لغو تأیید صحت آفر" : "تأیید صحت آفر (ثبت به عنوان آفر نهایی)"}
                                >
                                  <BadgeCheck size={16} />
                                </button>
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

                            {/* Card Body — three columns across the row: what it
                                costs, what was offered, and how it got here. */}
                            <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 items-start">
                              <div className="space-y-4">
                              {/* Total Price Brief */}
                              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                                    <Coins size={14} className="text-slate-400" />
                                    مجموع کل آفر:
                                  </span>
                                  <span className="text-xs font-extrabold text-sky-600">
                                    {Math.round(totalRiyal).toLocaleString('fa-IR')} <span className="text-[10px] font-normal text-slate-400">ریال</span>
                                  </span>
                                </div>
                                {/* The offer's own currency, when it is quoted in one. */}
                                {totals.currency && totals.netForeign > 0 && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-400">معادل ارزی:</span>
                                    <span className="text-[11px] font-extrabold text-slate-600">
                                      {Math.round(totals.netForeign).toLocaleString('fa-IR')} <span className="text-[10px] font-normal text-slate-400">{totals.currency}</span>
                                    </span>
                                  </div>
                                )}
                                {totals.discountRiyal > 0 && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-400">تخفیف:</span>
                                    <span className="text-[10px] font-bold text-amber-600">
                                      {Math.round(totals.discountRiyal).toLocaleString('fa-IR')} ریال
                                    </span>
                                  </div>
                                )}
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

                              </div>

                              {/* Items List */}
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold text-slate-400 block border-b border-slate-100 pb-1">اقلام پیشنهاد شده</span>
                                <div className="max-h-56 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
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
                              <div className="space-y-2 lg:pt-0 lg:border-t-0 lg:border-r lg:pr-4 pt-2 border-t border-slate-100">
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
                                        {/* Timeline indicator circle — sky for system-recorded steps */}
                                        <div className={`absolute right-[-4.5px] top-1.5 w-2 h-2 rounded-full ${step.auto ? 'bg-sky-400' : 'bg-slate-300'}`} />

                                        <div className="flex justify-between items-start">
                                          <span className="font-bold text-slate-700 flex items-center gap-1">
                                            {step.title}
                                            {step.auto && (
                                              <span
                                                className="inline-flex items-center gap-0.5 text-[8px] font-bold text-sky-600 bg-sky-50 border border-sky-100 px-1 py-px rounded"
                                                title="این رویداد به صورت خودکار توسط سیستم ثبت شده است"
                                              >
                                                <Zap size={7} />
                                                خودکار
                                              </span>
                                            )}
                                          </span>
                                          <div className="flex items-center gap-1">
                                            {/* Editable, including on a derived step: the system
                                                dates one when it notices, not when it happened. */}
                                            <ShamsiDatePicker
                                              value={step.date}
                                              onChange={(date) => { void handleStepDateChange(inq.id, step.id, date); }}
                                              compact
                                              className="w-[92px]"
                                            />
                                            {!step.auto && (
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteStepClick(inq.id, step.id)}
                                                className="text-slate-300 hover:text-rose-500 transition"
                                                title="حذف این اقدام"
                                              >
                                                <X size={10} />
                                              </button>
                                            )}
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
                          const totals = computeInquiryTotals(inq.items, inq.discountPercent, inq.discountAmount);
                          const totalRiyal = totals.netRiyal;
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
                                <div>
                                  {Math.round(totalRiyal).toLocaleString('fa-IR')} <span className="text-[10px] text-slate-400">ریال</span>
                                </div>
                                {totals.currency && totals.netForeign > 0 && (
                                  <div className="text-[11px] font-bold text-slate-500">
                                    {Math.round(totals.netForeign).toLocaleString('fa-IR')} <span className="text-[10px] font-normal text-slate-400">{totals.currency}</span>
                                  </div>
                                )}
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
          </>
          )}

          {list.totalPages > 1 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-3 flex items-center justify-between gap-3" id="inquiries-pager">
              <span className="text-[11px] font-bold text-slate-500">
                صفحه {list.page.toLocaleString('fa-IR')} از {list.totalPages.toLocaleString('fa-IR')}
                {list.loading && <span className="text-sky-500 mr-2">در حال بارگذاری…</span>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={list.page <= 1 || list.loading}
                  onClick={() => list.setPage(list.page - 1)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-[11px] font-bold transition"
                >
                  قبلی
                </button>
                <button
                  type="button"
                  disabled={list.page >= list.totalPages || list.loading}
                  onClick={() => list.setPage(list.page + 1)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-[11px] font-bold transition"
                >
                  بعدی
                </button>
              </div>
            </div>
          )}
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
      {/* No `AnimatePresence` wrapper: its direct child here is a plain div, and
          it can only track `motion` children — so on close it kept the whole
          subtree mounted waiting for an exit that never arrived, leaving a
          transparent full-screen layer that swallowed every click on the page
          behind it. Rendering conditionally closes it for real; `initial` and
          `animate` still play the way in. */}
      {isInquiryModalOpen && (
          <div className={`fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto ${isInquiryModalFullscreen ? 'p-0' : 'p-4'}`}>
            {/* Overlay */}
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsInquiryModalOpen(false)} />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
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
                  supplierPicker={supplierPicker}
                  catalogue={catalogue}
                  productPicker={productPicker}
                  exchangeRates={exchangeRates}
                  selectedProject={selectedProject}
                  projects={projects}
                  projectPicker={projectPicker}
                  getCurrencyRate={getCurrencyRate}
                  settings={settings}
                  onClose={() => setIsInquiryModalOpen(false)}
                  onSubmit={handleSubmitInquiry}
                />
              </div>
            </motion.div>
          </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Timeline Event Modal */}
      {/* ---------------------------------------------------- */}
      {isStepModalOpen && activeInquiryForStep && (
          <div className="fixed inset-0 z-[1010] flex items-center justify-center p-4">
            {/* Overlay */}
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsStepModalOpen(false)} />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
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
                onSubmit={handleAddStep}
              />
            </motion.div>
          </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Confirmation Delete dialog */}
      {/* ---------------------------------------------------- */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setAlsoRemoveActivities(false); }}
        onConfirm={handleConfirmDelete}
        title="تایید حذف اطلاعات"
        message={
          deleteTarget?.type === 'inquiry'
            ? "آیا از حذف کامل این استعلام قیمت تأمین‌کننده اطمینان دارید؟ تمامی قیمت‌ها، اقلام و مراحل زمانی آن حذف خواهند شد."
            : "آیا از حذف این رویداد زمانی استعلام اطمینان دارید؟ رویدادهای خودکار قابل حذف نیستند."
        }
        confirmText="بله، حذف شود"
        cancelText="انصراف"
      >
        {/* Only the inquiry itself writes to the timeline; a single step does not. */}
        {deleteTarget?.type === 'inquiry' && (
          <DeleteActivitiesOption
            checked={alsoRemoveActivities}
            onChange={setAlsoRemoveActivities}
            what="این استعلام"
          />
        )}
      </ConfirmModal>
    </div>
  );
}

// ----------------------------------------------------------------------
// InquiryFormInner sub-component
// ----------------------------------------------------------------------
interface PickerHandle {
  setTerm: (value: string) => void;
  loading: boolean;
}

/**
 * How the inquiry was sent.
 *
 * Not an `InquiryStepInput`: the sending is not a step the user chooses to
 * record, so it carries no title — the server names that event itself.
 */
type InitialStepDetails = NonNullable<InquiryWriteInput['initialStep']>;

/** Keeps the first label for an id, so a pinned current value wins over a match. */
function dedupeOptions(options: { value: string; label: string }[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  return options.filter((opt) => {
    if (!opt.value || seen.has(opt.value)) return false;
    seen.add(opt.value);
    return true;
  });
}

interface InquiryFormInnerProps {
  editingInquiry: SupplierInquiry | null;
  selectedProjectId: string;
  suppliers: Supplier[];
  supplierPicker: PickerHandle;
  /** The catalogue an inquiry line may point at, plus its search box. */
  catalogue: ProductRow[];
  productPicker: PickerHandle;
  exchangeRates: ExchangeRate[];
  selectedProject?: Project;
  projects: Project[];
  projectPicker: PickerHandle;
  getCurrencyRate: (currency: string) => number;
  settings: ERPSettings;
  onClose: () => void;
  /** The second argument describes how the inquiry was sent; create only. */
  onSubmit: (data: Partial<SupplierInquiry>, initialStep?: InitialStepDetails) => void;
}

function InquiryFormInner({
  editingInquiry,
  selectedProjectId,
  suppliers,
  supplierPicker,
  catalogue,
  productPicker,
  exchangeRates,
  selectedProject,
  projects,
  projectPicker,
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
  const [discountPercent, setDiscountPercent] = useState<number>(editingInquiry?.discountPercent || 0);
  const [discountAmount, setDiscountAmount] = useState<number>(editingInquiry?.discountAmount || 0);
  const [financialOfferUrl, setFinancialOfferUrl] = useState<string>(editingInquiry?.financialOfferUrl || '');
  
  const [uploadingTechnical, setUploadingTechnical] = useState(false);
  const [uploadingFinancial, setUploadingFinancial] = useState(false);
  const [uploadError, setUploadError] = useState('');

  /* How the inquiry was sent. The server records the sending itself — it is what
     creating an inquiry means — so these only fill in that step's detail; there
     is no title to choose. */
  const [initialStepDate, setInitialStepDate] = useState(getTodayShamsi());
  const [initialStepMethod, setInitialStepMethod] = useState('ایمیل');
  const [initialStepRecipientName, setInitialStepRecipientName] = useState('');
  const [initialStepNotes, setInitialStepNotes] = useState('');

  /*
   * The currency the supplier quoted in — one per offer, not one per line.
   *
   * A supplier prices a whole inquiry in a single currency; the grid used to
   * ask again on every row, which is a question nobody has a different answer
   * to and an invitation to get one row wrong. It stays a column on each line,
   * because that is what the totals are computed from and what a historical
   * offer was actually stored with; this simply sets them all together.
   */
  const [offerCurrency, setOfferCurrency] = useState<SupplierInquiryItem['currency']>(
    () => editingInquiry?.items?.[0]?.currency || 'دلار',
  );

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
        currency: offerCurrency,
        priceRiyal: 0,
        notes: '',
        tagNumber: item.tagNumber
      }));
    }
    return [];
  });

  /**
   * Pre-fills the offer's lines from what the project asked for.
   *
   * The project's needed items are a child table, so they only come with the
   * project's own record — a list row does not carry them. Picking a project
   * here therefore fetches it; the alternative is holding every project in the
   * browser, which is what this migration is undoing.
   */
  const seedItemsFromProject = (id: string) => {
    if (!id) {
      setItems([]);
      return;
    }
    projectsApi.get(id)
      .then((detail) => {
        const needed = detailToProject(detail).itemsNeeded ?? [];
        setItems(needed.map((item, idx) => ({
          id: `inq-item-${Date.now()}-${idx}`,
          name: item.name,
          quantity: item.quantity,
          priceForeign: 0,
          currency: offerCurrency,
          priceRiyal: 0,
          notes: '',
          tagNumber: item.tagNumber
        })));
      })
      // A project whose items cannot be read still allows a hand-typed offer.
      .catch(() => setItems([]));
  };

  const handleAddItemRow = () => {
    setItems(prev => [
      ...prev,
      {
        id: `inq-item-${Date.now()}`,
        name: '',
        quantity: 1,
        priceForeign: 0,
        currency: offerCurrency,
        priceRiyal: 0,
        notes: ''
      }
    ]);
  };

  /** Applies the offer's currency to every line, and revalues them. */
  const handleOfferCurrencyChange = (currency: SupplierInquiryItem['currency']) => {
    setOfferCurrency(currency);
    const rate = getCurrencyRate(currency);
    setItems(prev => prev.map(item => ({
      ...item,
      currency,
      priceRiyal: Number(item.priceForeign || 0) * rate,
    })));
  };

  const handleRemoveItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  /**
   * Points an inquiry line at a catalogue item.
   *
   * The name, brand and part number are filled in from the product — they are
   * what the supplier is being asked to price — but they stay editable: what a
   * supplier is quoted often differs in wording from what the catalogue calls
   * it, and an inquiry is not the place to insist on the house name.
   *
   * Choosing the blank option unlinks the line and leaves what was typed. That
   * matters: an inquiry is frequently the *first* mention of a part, priced
   * before anyone decides to carry it, so a line with no product behind it is
   * the normal case and not an incomplete one.
   */
  const handleItemProductChange = (idx: number, productId: string) => {
    const product = productId ? catalogue.find(p => p.id === productId) : undefined;
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (!product) return { ...item, productId: undefined, variantId: undefined };
      return {
        ...item,
        productId: product.id,
        // The previous product's SKU cannot belong to this one.
        variantId: undefined,
        name: product.displayName || item.name,
        brand: product.brand ?? item.brand,
        partNumber: product.code || item.partNumber,
      };
    }));
  };

  /** Narrows the line to one SKU, and records that SKU's code as the part number. */
  const handleItemVariantChange = (idx: number, variantId: string) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const product = catalogue.find(p => p.id === item.productId);
      const variant = product?.variants?.find(v => v.id === variantId);
      return {
        ...item,
        variantId: variantId || undefined,
        partNumber: variant?.sku || item.partNumber,
      };
    }));
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

    onSubmit(
      {
        projectId: projectId,
        supplierId: supplierId,
        items: items.map(item => ({
          ...item,
          priceForeign: Number(item.priceForeign),
          priceRiyal: Number(item.priceRiyal),
          quantity: Number(item.quantity)
        })),
        technicalOfferUrl: technicalOfferUrl || undefined,
        financialOfferUrl: financialOfferUrl || undefined,
        discountPercent: Number(discountPercent) || 0,
        discountAmount: Number(discountAmount) || 0,
        creationDate: editingInquiry?.creationDate || initialStepDate,
      },
      editingInquiry ? undefined : {
        occurredAt: initialStepDate,
        method: initialStepMethod || null,
        recipientName: initialStepRecipientName || null,
        notes: initialStepNotes || null,
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Project Selector */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'supplierInquiries', 'projectId', 'انتخاب پروژه')}</label>
          <SearchableSelect
            value={projectId}
            onChange={(val) => {
              setProjectId(val);
              if (!editingInquiry) seedItemsFromProject(val);
            }}
            onSearchChange={projectPicker.setTerm}
            loading={projectPicker.loading}
            placeholder="-- انتخاب پروژه --"
            required
            disabled={editingInquiry !== null} // Lock project on edit
            className="text-xs"
            // The current value has to be an option or the locked field renders
            // blank — the picker's matches hold whatever was last searched for,
            // not necessarily this record's project.
            options={dedupeOptions([
              ...(editingInquiry
                ? [{ value: editingInquiry.projectId, label: editingInquiry.projectName || 'پروژه انتخاب‌شده' }]
                : []),
              ...(selectedProject
                ? [{ value: selectedProject.id, label: `${selectedProject.name} (${selectedProject.code})` }]
                : []),
              ...projects.map(p => ({ value: p.id, label: `${p.name} (${p.code})` })),
            ])}
          />
        </div>

        {/* Supplier Selector */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'supplierInquiries', 'supplierId', 'انتخاب تأمین‌کننده')}</label>
          <SearchableSelect
            value={supplierId}
            onChange={setSupplierId}
            onSearchChange={supplierPicker.setTerm}
            loading={supplierPicker.loading}
            placeholder="-- انتخاب تأمین‌کننده --"
            required={isFieldRequired(settings, 'supplierInquiries', 'supplierId')}
            disabled={editingInquiry !== null} // Lock supplier on edit
            className="text-xs"
            options={dedupeOptions([
              ...(editingInquiry
                ? [{ value: editingInquiry.supplierId, label: editingInquiry.supplierName }]
                : []),
              ...suppliers.map(s => ({
                value: s.id,
                label: `${s.name} (${s.country || 'بدون کشور'})`,
              })),
            ])}
          />
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
            <h4 className="text-xs font-bold text-slate-700">جزئیات ارسال استعلام</h4>
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
              ارسال استعلام به عنوان اولین رویداد به صورت خودکار ثبت می‌شود؛ در اینجا فقط مشخص کنید از چه راهی و برای چه کسی ارسال شده است.
              رویدادهای بعدی (دریافت آفر، بازنگری، تأیید و برنده شدن) نیز خودکار ثبت می‌شوند.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <label className="text-xs font-bold text-slate-500">توضیحات ارسال</label>
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-bold text-slate-500 block">اقلام پیشنهادی آفر تأمین‌کننده</span>

          {/* One currency for the whole offer — a supplier quotes in one. */}
          <div className="flex items-center gap-2 mr-auto">
            <label className="text-[11px] font-bold text-slate-500 whitespace-nowrap">ارز آفر</label>
            <select
              value={offerCurrency}
              onChange={(e) => handleOfferCurrencyChange(e.target.value as SupplierInquiryItem['currency'])}
              className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            >
              <option value="دلار">دلار</option>
              <option value="یورو">یورو</option>
              <option value="درهم">درهم</option>
              <option value="یوان">یوان</option>
              <option value="ریال">ریال</option>
            </select>
          </div>

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
                <th className="p-2.5 w-[28%]">کالا و شرح دقیق آفر</th>
                <th className="p-2.5 w-20 text-center">تعداد</th>
                <th className="p-2.5 w-24">مبلغ ارزی واحد</th>
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
                    {/*
                      Optional on purpose. An inquiry is often the first time a
                      part is mentioned — priced before anyone decides to carry
                      it — so a line naming no catalogue item is the normal case.
                      Naming one is what lets a winning offer become an order
                      line with a real product, and a SKU, behind it.
                    */}
                    <SearchableSelect
                      value={item.productId || ''}
                      onChange={(val) => handleItemProductChange(index, val)}
                      onSearchChange={productPicker.setTerm}
                      loading={productPicker.loading}
                      options={[
                        { value: '', label: 'خارج از انبار (شرح دستی)' },
                        ...catalogue.map(p => ({
                          value: p.id,
                          label: `${p.displayName}${p.code ? ` (${p.code})` : ''}`,
                        })),
                      ]}
                      placeholder="خارج از انبار (شرح دستی)"
                    />

                    {(() => {
                      const linked = item.productId
                        ? catalogue.find(p => p.id === item.productId)
                        : undefined;
                      const skus = linked?.variants ?? [];
                      if (skus.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[9px] text-slate-500 whitespace-nowrap">SKU:</span>
                          <select
                            value={item.variantId || ''}
                            onChange={(e) => handleItemVariantChange(index, e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[9px] bg-sky-50 text-sky-800 text-right"
                          >
                            <option value="">-- کل کالا (بدون تفکیک SKU) --</option>
                            {skus.map(v => (
                              <option key={v.id} value={v.id}>{v.sku}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })()}

                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleItemFieldChange(index, 'name', e.target.value)}
                      placeholder="مثال: ترانسمیتر فشار فلوبر"
                      required
                      className="w-full px-2 py-1.5 mt-1 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
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
                      className="w-full px-1.5 py-1.5 border border-slate-200 rounded-lg text-center font-mono focus:outline-none bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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

      {/* Offer total, and the discounts on it */}
      {(() => {
        const t = computeInquiryTotals(items, discountPercent, discountAmount);
        // A supplier prices an inquiry in one currency, so the fixed amount is
        // in that currency; a Rial-only offer takes the amount in Rial.
        const unit = t.currency || 'ریال';
        const fa = (v: number) => Math.round(v).toLocaleString('fa-IR');
        return (
          <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">تخفیف درصدی (٪)</label>
                <input
                  type="number" min={0} max={100} step="0.01" value={discountPercent}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDiscountPercent(Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) : 0);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-500 bg-white text-sm font-bold"
                  placeholder="۰"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  تخفیف مبلغی ({unit})
                </label>
                <input
                  type="number" min={0} step="0.01" value={discountAmount}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDiscountAmount(Number.isFinite(v) && v > 0 ? v : 0);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-500 bg-white text-sm font-bold"
                  placeholder="۰"
                />
              </div>
              <div className="bg-white border border-slate-150 rounded-lg px-3 py-2 self-end">
                <span className="block text-[10px] text-slate-400 font-bold mb-0.5">جمع آفر (پیش از تخفیف)</span>
                <span className="font-bold text-slate-700 text-sm">
                  {fa(t.grossRiyal)}<span className="text-[10px] font-normal text-slate-400"> ریال</span>
                </span>
              </div>
              <div className="bg-white border border-sky-200 rounded-lg px-3 py-2 self-end">
                <span className="block text-[10px] text-slate-400 font-bold mb-0.5">مبلغ نهایی</span>
                <span className="font-bold text-sky-700 text-sm">
                  {fa(t.netRiyal)}<span className="text-[10px] font-normal text-slate-400"> ریال</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded font-bold">
                کل تخفیف: {fa(t.discountRiyal)} ریال
              </span>
              {t.currency && (
                <>
                  <span className="bg-white px-2 py-1 rounded border border-slate-150 font-bold text-slate-600">
                    جمع ارزی پیش از تخفیف: {fa(t.grossForeign)} {t.currency}
                  </span>
                  <span className="bg-white px-2 py-1 rounded border border-sky-200 font-bold text-sky-700">
                    مبلغ نهایی ارزی: {fa(t.netForeign)} {t.currency}
                  </span>
                </>
              )}
              <span className="text-slate-400">
                ابتدا تخفیف درصدی، سپس تخفیف مبلغی از باقی‌مانده کسر می‌شود.
              </span>
            </div>
          </div>
        );
      })()}

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
  onSubmit: (step: InquiryStepInput) => void;
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
      title: finalTitle,
      occurredAt: date,
      notes: notes || null,
      method,
      recipientName: recipientName || null,
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
