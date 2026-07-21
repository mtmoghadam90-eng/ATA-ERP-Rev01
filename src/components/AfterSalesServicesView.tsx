import React, { useState, useMemo, useEffect } from 'react';
import { AfterSalesService, AfterSalesServiceItem, Project, Proforma, User, ERPSettings, Customer } from '../types';
import { 
  Wrench, 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  X,
  FileText,
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Check,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Printer,
  Eye
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { SearchableSelect } from './SearchableSelect';
import { getTodayShamsi } from '../dateUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk, getFieldAsterisk } from '../utils/requiredFields';
import ShamsiDatePicker from './ShamsiDatePicker';
import { getProformaOutcomeStatus, getWonItemsOfProforma } from '../useERPStore';
import ModuleNotesSection from './ModuleNotesSection';
import CustomerAgreementAlert from './CustomerAgreementAlert';

interface AfterSalesServicesViewProps {
  initialPrintDocId?: string;
  onClearInitialPrintDocId?: () => void;
  afterSalesServices: AfterSalesService[];
  projects: Project[];
  customers: Customer[];
  proformas: Proforma[];
  addAfterSalesService: (service: Omit<AfterSalesService, 'id' | 'createdAt'>) => void;
  updateAfterSalesService: (service: AfterSalesService) => void;
  deleteAfterSalesService: (id: string, deleteLogs?: boolean) => void;
  settings: ERPSettings;
  currentUser: User | null;
}

export default function AfterSalesServicesView({
  initialPrintDocId,
  onClearInitialPrintDocId,
  afterSalesServices,
  projects,
  customers,
  proformas,
  addAfterSalesService,
  updateAfterSalesService,
  deleteAfterSalesService,
  settings,
  currentUser
}: AfterSalesServicesViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalFullscreen, setIsModalFullscreen] = useState(false);
  const [editingService, setEditingService] = useState<AfterSalesService | null>(null);

  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printTargetService, setPrintTargetService] = useState<AfterSalesService | null>(null);

  useEffect(() => {
    if (initialPrintDocId) {
      const service = afterSalesServices.find(s => s.id === initialPrintDocId);
      if (service) {
        setPrintTargetService(service);
        setShowPrintModal(true);
      }
    }
  }, [initialPrintDocId, afterSalesServices]);
  
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProformaNumber, setSelectedProformaNumber] = useState('');
  
  // List of multiple items in table
  const [serviceItems, setServiceItems] = useState<AfterSalesServiceItem[]>([]);

  // Individual item form states (for adding/updating a row)
  const [itemProductDropdownVal, setItemProductDropdownVal] = useState(''); // holds productId or 'custom' or ''
  const [itemCustomName, setItemCustomName] = useState('');
  const [itemIssue, setItemIssue] = useState('');
  const [itemAction, setItemAction] = useState('');
  const [itemStartDate, setItemStartDate] = useState(getTodayShamsi());
  const [itemStatus, setItemStatus] = useState<AfterSalesServiceItem['status']>('در حال بررسی');
  const [itemEndDate, setItemEndDate] = useState('');
  const [itemReturnDate, setItemReturnDate] = useState('');
  
  // Track currently edited row ID in the table
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);
  const [deleteActivitiesWithService, setDeleteActivitiesWithService] = useState(true);

  // Filter proformas of the selected project to won/approved ones
  const selectedProjectProformas = useMemo(() => {
    if (!selectedProjectId) return [];
    return proformas.filter(p => {
      if (p.projectId !== selectedProjectId) return false;
      const outcome = getProformaOutcomeStatus(p);
      return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
    });
  }, [selectedProjectId, proformas]);

  // Selected proforma object
  const selectedProfObj = useMemo(() => {
    if (!selectedProformaNumber || !selectedProjectId) return null;
    return proformas.find(p => p.proformaNumber === selectedProformaNumber && p.projectId === selectedProjectId);
  }, [selectedProformaNumber, selectedProjectId, proformas]);

  // Won items of the selected proforma
  const proformaItems = useMemo(() => {
    if (!selectedProfObj) return [];
    return getWonItemsOfProforma(selectedProfObj, true);
  }, [selectedProfObj]);

  const resetItemForm = () => {
    setItemProductDropdownVal('');
    setItemCustomName('');
    setItemIssue('');
    setItemAction('');
    setItemStartDate(getTodayShamsi());
    setItemStatus('در حال بررسی');
    setItemEndDate('');
    setItemReturnDate('');
    setEditingRowId(null);
  };

  const resetForm = () => {
    setEditingService(null);
    setSelectedProjectId('');
    setSelectedProformaNumber('');
    setServiceItems([]);
    resetItemForm();
  };

  const handleOpenModal = (service?: AfterSalesService) => {
    if (service) {
      setEditingService(service);
      setSelectedProjectId(service.projectId);
      setSelectedProformaNumber(service.proformaNumber || '');
      
      // Load items or fall back to legacy top-level fields
      if (service.items && service.items.length > 0) {
        setServiceItems(service.items);
      } else {
        setServiceItems([
          {
            id: `item-legacy-${Date.now()}`,
            productName: service.itemName,
            issueDescription: service.issueDescription,
            actionsTaken: service.actionsTaken,
            startDate: service.startDate,
            endDate: service.endDate,
            returnDate: service.returnDate,
            status: service.status
          }
        ]);
      }
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  // Add or update a row in the table
  const handleAddOrUpdateItem = () => {
    let finalProductName = '';
    let finalProductId: string | undefined = undefined;

    if (itemProductDropdownVal === 'custom') {
      if (!itemCustomName.trim()) {
        alert('لطفاً نام کالا را به صورت دستی وارد کنید.');
        return;
      }
      finalProductName = itemCustomName.trim();
    } else if (itemProductDropdownVal) {
      const selectedItem = proformaItems.find(item => item.productId === itemProductDropdownVal);
      if (selectedItem) {
        finalProductName = selectedItem.brand ? `${selectedItem.productName} (${selectedItem.brand})` : selectedItem.productName;
        finalProductId = selectedItem.productId;
      } else {
        // Fallback
        finalProductName = itemProductDropdownVal;
      }
    } else {
      // If no dropdown chosen (e.g. no proforma selected), they must type
      if (!itemCustomName.trim()) {
        alert('لطفاً نام کالا را وارد کنید.');
        return;
      }
      finalProductName = itemCustomName.trim();
    }


    if (isFieldRequired(settings, 'afterSalesServices', 'itemName') && !finalProductName) {
      alert('فیلد "نام کالا" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'afterSalesServices', 'issueDescription') && !itemIssue) {
      alert('فیلد "علت برگشت / نوع مشکل" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'afterSalesServices', 'actionsTaken') && !itemAction) {
      alert('فیلد "اقدامات انجام شده" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'afterSalesServices', 'startDate') && !itemStartDate) {
      alert('فیلد "تاریخ دریافت کالا" الزامی است.');
      return;
    }
    if (!itemIssue) {
      alert('لطفاً مشکل / دلیل برگشت را انتخاب یا مشخص کنید.');
      return;
    }

    const itemData: AfterSalesServiceItem = {
      id: editingRowId || `item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      productId: finalProductId,
      productName: finalProductName,
      issueDescription: itemIssue,
      actionsTaken: itemAction || undefined,
      startDate: itemStartDate,
      status: itemStatus,
      endDate: (itemStatus === 'تکمیل شده' || itemStatus === 'تحویل داده شده') ? (itemEndDate || getTodayShamsi()) : undefined,
      returnDate: itemStatus === 'تحویل داده شده' ? (itemReturnDate || getTodayShamsi()) : undefined,
    };

    if (editingRowId) {
      setServiceItems(prev => prev.map(item => item.id === editingRowId ? itemData : item));
    } else {
      setServiceItems(prev => [...prev, itemData]);
    }

    resetItemForm();
  };

  const handleEditRow = (row: AfterSalesServiceItem) => {
    setEditingRowId(row.id);
    
    // Attempt to match with proforma won items
    if (proformaItems.length > 0) {
      const matched = proformaItems.find(pi => pi.productId === row.productId);
      if (matched) {
        setItemProductDropdownVal(row.productId || '');
      } else {
        setItemProductDropdownVal('custom');
        setItemCustomName(row.productName);
      }
    } else {
      setItemCustomName(row.productName);
    }

    setItemIssue(row.issueDescription);
    setItemAction(row.actionsTaken || '');
    setItemStartDate(row.startDate);
    setItemStatus(row.status);
    setItemEndDate(row.endDate || '');
    setItemReturnDate(row.returnDate || '');
  };

  const handleDeleteRow = (rowId: string) => {
    setServiceItems(prev => prev.filter(item => item.id !== rowId));
    if (editingRowId === rowId) {
      resetItemForm();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isFieldRequired(settings, 'afterSalesServices', 'projectId') && !selectedProjectId) {
      alert('فیلد "پروژه (مشتری)" الزامی است.');
      return;
    }

    
    if (!selectedProjectId) {
      alert('لطفاً پروژه را مشخص کنید.');
      return;
    }

    if (serviceItems.length === 0) {
      alert('لطفاً حداقل یک کالا در جدول اقلام خدمات پس از فروش ثبت کنید.');
      return;
    }

    const project = projects.find(p => p.id === selectedProjectId);
    if (!project) return;

    // Calculate overall statistics from the items list
    // Name summary: First product + other items count
    const firstItem = serviceItems[0];
    const itemNameSummary = serviceItems.length > 1 
      ? `${firstItem.productName} و ${serviceItems.length - 1} کالای دیگر`
      : firstItem.productName;

    // Issue summary: First item issue
    const issueSummary = firstItem.issueDescription;

    // Combined actions summary
    const actionsSummary = serviceItems
      .map(item => item.actionsTaken)
      .filter(Boolean)
      .join(' | ') || '';

    // Earliest start date
    const startDates = serviceItems.map(item => item.startDate).sort();
    const startDateSummary = startDates[0] || getTodayShamsi();

    // Latest end dates and return dates
    const completedItems = serviceItems.filter(item => item.endDate);
    const endDates = completedItems.map(item => item.endDate as string).sort();
    const endDateSummary = completedItems.length === serviceItems.length && endDates.length > 0 
      ? endDates[endDates.length - 1] 
      : undefined;

    const deliveredItems = serviceItems.filter(item => item.returnDate);
    const returnDates = deliveredItems.map(item => item.returnDate as string).sort();
    const returnDateSummary = deliveredItems.length === serviceItems.length && returnDates.length > 0 
      ? returnDates[returnDates.length - 1] 
      : undefined;

    // Calculate status:
    // If all delivered -> تحویل داده شده
    // Else if all completed or delivered -> تکمیل شده
    // Else if any in progress/repair -> در حال تعمیر/خدمات
    // Else -> در حال بررسی
    let overallStatus: AfterSalesService['status'] = 'در حال بررسی';
    const statuses = serviceItems.map(item => item.status);
    if (statuses.every(s => s === 'تحویل داده شده')) {
      overallStatus = 'تحویل داده شده';
    } else if (statuses.every(s => s === 'تکمیل شده' || s === 'تحویل داده شده')) {
      overallStatus = 'تکمیل شده';
    } else if (statuses.some(s => s === 'در حال تعمیر/خدمات')) {
      overallStatus = 'در حال تعمیر/خدمات';
    } else {
      overallStatus = 'در حال بررسی';
    }

    const serviceData = {
      projectId: selectedProjectId,
      projectName: project.name,
      proformaNumber: selectedProformaNumber || undefined,
      itemName: itemNameSummary,
      issueDescription: issueSummary,
      actionsTaken: actionsSummary,
      startDate: startDateSummary,
      endDate: endDateSummary,
      returnDate: returnDateSummary,
      status: overallStatus,
      items: serviceItems,
      createdBy: currentUser?.fullName || 'سیستم'
    };

    if (editingService) {
      updateAfterSalesService({
        ...editingService,
        ...serviceData
      });
    } else {
      addAfterSalesService(serviceData);
    }

    setIsModalOpen(false);
    setIsModalFullscreen(false);
    resetForm();
  };

  const filteredServices = useMemo(() => {
    return afterSalesServices.filter(s => {
      const matchesSearch = 
        s.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.issueDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.proformaNumber && s.proformaNumber.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [afterSalesServices, searchTerm, statusFilter]);

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'در حال بررسی': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'در حال تعمیر/خدمات': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'تکمیل شده': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'تحویل داده شده': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl">
              <Wrench className="text-indigo-600" size={24} />
            </div>
            خدمات پس از فروش
          </h2>
          <p className="text-sm text-slate-500 mt-2 font-medium">
            مدیریت کالاها و تجهیزات برگشتی، تعمیرات و خدمات پس از فروش پروژه‌ها
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-bold shadow-lg shadow-indigo-200"
        >
          <Plus size={20} />
          <span>ثبت خدمات جدید</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="جستجو در خدمات (نام پروژه، نام کالا، شماره پیش‌فاکتور)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm font-medium"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-bold text-slate-700 min-w-[200px]"
        >
          <option value="all">همه وضعیت‌ها</option>
          <option value="در حال بررسی">در حال بررسی</option>
          <option value="در حال تعمیر/خدمات">در حال تعمیر/خدمات</option>
          <option value="تکمیل شده">تکمیل شده</option>
          <option value="تحویل داده شده">تحویل داده شده</option>
        </select>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredServices.map(service => (
          <div key={service.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">
            <div className="p-5 flex-1 font-sans">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-bold border ${getStatusColor(service.status)} mb-2`}>
                    {service.status}
                  </span>
                  <h3 className="font-bold text-slate-800 text-lg leading-tight">{service.itemName}</h3>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleOpenModal(service)}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="ویرایش"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => {
                      setServiceToDelete(service.id);
                      setDeleteActivitiesWithService(true);
                      setIsDeleteModalOpen(true);
                    }}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="حذف"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-3 mt-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <div className="w-6 flex justify-center text-slate-400"><Briefcase size={16} /></div>
                  <span className="font-bold">{service.projectName}</span>
                </div>
                {service.proformaNumber && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <div className="w-6 flex justify-center text-slate-400"><FileText size={16} /></div>
                    <span className="font-mono">{service.proformaNumber}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <div className="w-6 flex justify-center text-slate-400"><Calendar size={16} /></div>
                  <span>تاریخ شروع: <span className="font-mono">{service.startDate}</span></span>
                </div>
                {(service.endDate || service.returnDate) && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <div className="w-6 flex justify-center text-slate-400"><CheckCircle2 size={16} /></div>
                    <span>
                      {service.returnDate ? `تحویل: ${service.returnDate}` : `پایان: ${service.endDate}`}
                    </span>
                  </div>
                )}
              </div>

              {service.items && service.items.length > 0 ? (
                <div className="mt-5 border-t border-slate-100 pt-4 space-y-3">
                  <span className="text-xs font-extrabold text-slate-400 block mb-2">لیست اقلام و وضعیت‌ها:</span>
                  <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                    {service.items.map((item, idx) => (
                      <div key={item.id || idx} className="p-3 bg-slate-50 rounded-xl border border-slate-150 space-y-2 hover:bg-slate-100/50 transition-colors">
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-slate-800 text-xs leading-tight">{item.productName}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${getStatusColor(item.status)}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <p><span className="text-slate-400 font-bold">مشکل:</span> {item.issueDescription}</p>
                          {item.actionsTaken && <p><span className="text-slate-400 font-bold">اقدامات:</span> {item.actionsTaken}</p>}
                          <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1.5 border-t border-slate-200/50 mt-1">
                            <span>شروع: <span className="font-mono">{item.startDate}</span></span>
                            {item.endDate && <span>پایان: <span className="font-mono">{item.endDate}</span></span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5 p-4 bg-slate-50 rounded-xl space-y-3 text-sm">
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">دلیل برگشت/مشکل:</span>
                    <p className="text-slate-700 leading-relaxed font-medium">{service.issueDescription}</p>
                  </div>
                  {service.actionsTaken && (
                    <div>
                      <span className="text-slate-500 font-bold block mb-1">اقدامات انجام شده:</span>
                      <p className="text-slate-700 leading-relaxed font-medium">{service.actionsTaken}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
              <span>ثبت کننده: {service.createdBy}</span>
              <span className="font-mono">{(service.createdAt || '').split(' ')[0] || service.createdAt || ''}</span>
            </div>
          </div>
        ))}
        {filteredServices.length === 0 && (
          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200 border-dashed">
            <Wrench className="mx-auto text-slate-300 mb-4" size={48} />
            <h3 className="text-lg font-bold text-slate-600 mb-2">هیچ رکورد خدمات پس از فروش یافت نشد</h3>
            <p className="text-slate-500 text-sm">برای ثبت خدمات جدید روی دکمه «ثبت خدمات جدید» کلیک کنید.</p>
          </div>
        )}
      </div>

      {/* Modal Form */}
      {isModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm transition-all ${isModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl overflow-hidden flex flex-col transition-all duration-300 ${
            isModalFullscreen 
              ? 'w-screen h-screen rounded-none max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-5xl max-h-[92vh]'
          }`}>
            <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50 shrink-0">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Wrench className="text-indigo-500" size={20} />
                {editingService ? 'ویرایش خدمات پس از فروش' : 'ثبت خدمات پس از فروش جدید'}
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsModalFullscreen(!isModalFullscreen)}
                  className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-2 rounded-xl transition flex items-center justify-center"
                  title={isModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setIsModalOpen(false); setIsModalFullscreen(false); }} 
                  className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-2 rounded-xl transition"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 text-right">
              {/* بخش ۱: اطلاعات پروژه و پیش‌فاکتور */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{renderFieldLabelWithAsterisk(settings, 'afterSalesServices', 'projectId', 'پروژه (مشتری)')}</label>
                  <SearchableSelect wrapperClassName="flex-1 min-w-0"
                    value={selectedProjectId}
                    onChange={(val) => {
                      setSelectedProjectId(val);
                      setSelectedProformaNumber('');
                      resetItemForm();
                      setServiceItems([]);
                    }}
                    required={isFieldRequired(settings, 'afterSalesServices', 'projectId')}
                    options={[
                      { value: '', label: 'انتخاب پروژه...' },
                      ...projects.map(p => ({
                        value: p.id,
                        label: p.code ? `${p.code} - ${p.name}` : p.name
                      }))
                    ]}
                    placeholder="انتخاب پروژه..."
                  />
                  {selectedProjectId && (
                    <div className="mt-2">
                      <CustomerAgreementAlert 
                        customer={customers?.find(c => c.id === projects?.find(p => p.id === selectedProjectId)?.customerId)} 
                        moduleName="after_sales" 
                      />
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">پیش‌فاکتور مرجع (فقط پیش‌فاکتورهای تایید شده)</label>
                  <SearchableSelect wrapperClassName="flex-1 min-w-0"
                    value={selectedProformaNumber}
                    onChange={(val) => {
                      setSelectedProformaNumber(val);
                      resetItemForm();
                    }}
                    options={[
                      { value: '', label: 'انتخاب پیش‌فاکتور...' },
                      ...selectedProjectProformas.map(p => ({ value: p.proformaNumber, label: p.proformaNumber }))
                    ]}
                    placeholder="انتخاب پیش‌فاکتور..."
                    disabled={!selectedProjectId}
                  />
                </div>
              </div>

              {/* بخش ۲: فرم ثبت یا ویرایش ردیف کالا در جدول */}
              <div className="border border-indigo-100 rounded-2xl p-4 bg-indigo-50/25 space-y-4">
                <h4 className="text-sm font-black text-indigo-950 flex items-center gap-2 pb-2 border-b border-indigo-100">
                  <Wrench size={16} className="text-indigo-600" />
                  {editingRowId ? 'ویرایش ردیف کالا در جدول اقلام' : 'ثبت ردیف جدید در جدول کالاها'}
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* نام کالا */}
                  <div className="space-y-1.5 md:col-span-2 lg:col-span-1">
                    <label className="text-xs font-bold text-slate-700">{renderFieldLabelWithAsterisk(settings, 'afterSalesServices', 'itemName', 'نام کالا / تجهیز برگشتی')}</label>
                    {selectedProformaNumber && proformaItems.length > 0 ? (
                      <div className="space-y-2">
                        <SearchableSelect wrapperClassName="flex-1 min-w-0"
                          value={itemProductDropdownVal}
                          required={isFieldRequired(settings, 'afterSalesServices', 'itemName')}
                          onChange={(val) => {
                            setItemProductDropdownVal(val);
                            if (val !== 'custom' && val !== '') {
                              const selected = proformaItems.find(pi => pi.productId === val);
                              if (selected) {
                                setItemCustomName(selected.brand ? `${selected.productName} (${selected.brand})` : selected.productName);
                              }
                            } else {
                              setItemCustomName('');
                            }
                          }}
                          options={[
                            { value: '', label: 'انتخاب کالا از پیش‌فاکتور...' },
                            ...proformaItems.map(pi => ({
                              value: pi.productId,
                              label: `${pi.productName}${pi.brand ? ` (${pi.brand})` : ''} - ${pi.quantity} ${pi.unit}`
                            })),
                            { value: 'custom', label: 'ورود دستی نام کالا...' }
                          ]}
                          placeholder="انتخاب کالا از پیش‌فاکتور..."
                          className="text-xs"
                        />
                        {(itemProductDropdownVal === 'custom' || !itemProductDropdownVal) && (
                          <input
                            type="text"
                            required={isFieldRequired(settings, 'afterSalesServices', 'itemName')}
                            value={itemCustomName}
                            onChange={(e) => setItemCustomName(e.target.value)}
                            placeholder="نام کالا را دستی وارد کنید"
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-medium"
                          />
                        )}
                      </div>
                    ) : (
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'afterSalesServices', 'itemName')}
                        value={itemCustomName}
                        onChange={(e) => setItemCustomName(e.target.value)}
                        placeholder="نام کالا را وارد کنید"
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-medium"
                        disabled={!selectedProjectId}
                      />
                    )}
                  </div>

                  {/* علت برگشت */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">{renderFieldLabelWithAsterisk(settings, 'afterSalesServices', 'issueDescription', 'علت برگشت / نوع مشکل')}</label>
                    <select
                      value={itemIssue}
                      onChange={(e) => setItemIssue(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-medium text-slate-750"
                      required={isFieldRequired(settings, 'afterSalesServices', 'issueDescription')}
                      disabled={!selectedProjectId}
                    >
                      <option value="">انتخاب کنید...</option>
                      {settings.dropdownItems?.returnReasons?.map((reason, idx) => (
                        <option key={idx} value={reason}>{reason}</option>
                      ))}
                    </select>
                  </div>

                  {/* وضعیت کالا */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">وضعیت کالا <span className="text-red-500">*</span></label>
                    <select
                      value={itemStatus}
                      onChange={(e) => setItemStatus(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-bold text-slate-700"
                      disabled={!selectedProjectId}
                    >
                      <option value="در حال بررسی">در حال بررسی</option>
                      <option value="در حال تعمیر/خدمات">در حال تعمیر/خدمات</option>
                      <option value="تکمیل شده">تکمیل شده</option>
                      <option value="تحویل داده شده">تحویل داده شده</option>
                    </select>
                  </div>

                  {/* اقدامات انجام شده */}
                  <div className="space-y-1.5 lg:col-span-3">
                    <label className="text-xs font-bold text-slate-700">{renderFieldLabelWithAsterisk(settings, 'afterSalesServices', 'actionsTaken', 'اقدامات انجام شده')}</label>
                    <input
                      type="text"
                      required={isFieldRequired(settings, 'afterSalesServices', 'actionsTaken')}
                      value={itemAction}
                      onChange={(e) => setItemAction(e.target.value)}
                      placeholder="شرح کارها و تعمیراتی که روی این کالا انجام شده است..."
                      className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-medium"
                      disabled={!selectedProjectId}
                    />
                  </div>

                  {/* تاریخ دریافت */}
                  <div className="space-y-1.5">
                    <ShamsiDatePicker
                      label={`تاریخ دریافت کالا${getFieldAsterisk(settings, 'afterSalesServices', 'startDate')}`}
                      required={isFieldRequired(settings, 'afterSalesServices', 'startDate')}
                      value={itemStartDate}
                      onChange={(val) => setItemStartDate(val)}
                    />
                  </div>

                  {/* تاریخ پایان */}
                  <div className={`space-y-1.5 ${(itemStatus === 'در حال بررسی' || itemStatus === 'در حال تعمیر/خدمات') ? 'pointer-events-none opacity-50' : ''}`}>
                    <ShamsiDatePicker
                      label="تاریخ پایان خدمات"
                      value={itemEndDate}
                      onChange={(val) => setItemEndDate(val)}
                    />
                  </div>

                  {/* تاریخ تحویل */}
                  <div className={`space-y-1.5 ${itemStatus !== 'تحویل داده شده' ? 'pointer-events-none opacity-50' : ''}`}>
                    <ShamsiDatePicker
                      label="تاریخ تحویل به مشتری"
                      value={itemReturnDate}
                      onChange={(val) => setItemReturnDate(val)}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-indigo-100/50">
                  {editingRowId && (
                    <button
                      type="button"
                      onClick={resetItemForm}
                      className="px-4 py-1.5 text-xs text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold"
                    >
                      انصراف از ویرایش
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddOrUpdateItem}
                    className="flex items-center gap-1.5 px-5 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold shadow-sm"
                    disabled={!selectedProjectId}
                  >
                    {editingRowId ? <Check size={14} /> : <Plus size={14} />}
                    <span>{editingRowId ? 'بروزرسانی کالا در جدول' : 'افزودن کالا به جدول'}</span>
                  </button>
                </div>
              </div>

              {/* بخش ۳: جدول اقلام ثبت شده در خدمات */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-black text-slate-800">لیست اقلام ثبت شده برای این خدمات ({serviceItems.length} کالا)</label>
                  <span className="text-xs text-slate-400 font-medium">حداقل ثبت یک کالا الزامی است</span>
                </div>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                          <th className="p-3 w-12 text-center">ردیف</th>
                          <th className="p-3">نام کالا / تجهیز</th>
                          <th className="p-3">علت برگشت و اقدامات</th>
                          <th className="p-3 text-center">وضعیت</th>
                          <th className="p-3">تاریخ‌ها</th>
                          <th className="p-3 w-20 text-center">عملیات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceItems.map((item, index) => (
                          <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                            <td className="p-3 text-center font-mono text-slate-400">{index + 1}</td>
                            <td className="p-3 font-bold text-slate-800">{item.productName}</td>
                            <td className="p-3 space-y-1">
                              <p><span className="text-slate-400 font-bold">علت برگشت:</span> <span className="text-slate-700 font-semibold">{item.issueDescription}</span></p>
                              {item.actionsTaken && <p><span className="text-slate-400 font-bold">اقدام:</span> <span className="text-slate-600 font-medium">{item.actionsTaken}</span></p>}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-block px-2.5 py-0.5 rounded-lg text-[10px] font-bold border ${getStatusColor(item.status)}`}>
                                {item.status}
                              </span>
                            </td>
                            <td className="p-3 space-y-0.5 text-[11px] font-medium text-slate-600">
                              <p>دریافت: <span className="font-mono">{item.startDate}</span></p>
                              {item.endDate && <p>پایان: <span className="font-mono">{item.endDate}</span></p>}
                              {item.returnDate && <p>تحویل: <span className="font-mono">{item.returnDate}</span></p>}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditRow(item)}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                  title="ویرایش ردیف"
                                >
                                  <Edit size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRow(item.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="حذف ردیف"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {serviceItems.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">
                              <div className="flex flex-col items-center justify-center space-y-2 py-4">
                                <AlertTriangle className="text-amber-500" size={32} />
                                <p className="text-sm font-bold text-slate-600">جدول اقلام خالی است</p>
                                <p className="text-xs text-slate-400">لطفاً ابتدا از فرم بالا کالا را ثبت و روی دکمه «افزودن کالا به جدول» کلیک کنید.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* بخش ۳: یادداشت‌ها و توافقات پس از فروش (فقط در حالت ویرایش پرونده فعال) */}
              {editingService && (
                <div className="pt-4 text-right">
                  <ModuleNotesSection
                    notes={editingService.moduleNotes || []}
                    currentUser={currentUser}
                    title="توافقات و یادداشت‌های پرونده خدمات پس از فروش"
                    placeholder="مثال: توافق با مشتری درباره نحوه عودت، هزینه تعمیرات، یا کامنت تیکت پشتیبانی..."
                    onAddNote={(text) => {
                      const newNote = {
                        id: `note-${Date.now()}`,
                        text,
                        createdAt: getTodayShamsi(),
                        author: currentUser?.fullName || currentUser?.username || 'کاربر سیستم'
                      };
                      const updated = {
                        ...editingService,
                        moduleNotes: [...(editingService.moduleNotes || []), newNote]
                      };
                      updateAfterSalesService(updated);
                      setEditingService(updated);
                    }}
                    onDeleteNote={(id) => {
                      const updatedNotes = (editingService.moduleNotes || []).filter(n => n.id !== id);
                      const updated = {
                        ...editingService,
                        moduleNotes: updatedNotes
                      };
                      updateAfterSalesService(updated);
                      setEditingService(updated);
                    }}
                  />
                </div>
              )}

              {/* دکمه‌های فرم */}
              <div className="pt-6 border-t border-slate-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setIsModalFullscreen(false); }}
                  className="px-5 py-2.5 text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors font-bold text-sm"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all font-bold text-sm"
                >
                  {editingService ? 'ذخیره کل تغییرات' : 'ثبت نهایی خدمات پس از فروش'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={() => {
          if (serviceToDelete) {
            deleteAfterSalesService(serviceToDelete, deleteActivitiesWithService);
            setIsDeleteModalOpen(false);
          }
        }}
        title="حذف رکورد خدمات پس از فروش"
        message="آیا از حذف این رکورد خدمات پس از فروش اطمینان دارید؟ این عملیات غیرقابل بازگشت است."
      >
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-2">
          <input
            type="checkbox"
            id="deleteActivitiesWithService"
            checked={deleteActivitiesWithService}
            onChange={(e) => setDeleteActivitiesWithService(e.target.checked)}
            className="mt-1"
          />
          <label htmlFor="deleteActivitiesWithService" className="text-xs text-slate-600 font-medium leading-relaxed cursor-pointer select-none">
            حذف لاگ‌های فعالیت پروژه مرتبط با این رکورد خدمات پس از فروش (در دسته‌بندی خدمات پس از فروش)
          </label>
        </div>
      </ConfirmModal>

      {showPrintModal && printTargetService && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs overflow-y-auto p-4 md:p-8 z-50 flex justify-center">
          <div className="bg-white text-slate-900 w-full max-w-3xl rounded-2xl shadow-2xl p-6 md:p-10 flex flex-col justify-between h-fit min-h-screen text-right animate-scale-in">
            {/* Action Bar */}
            <div className="flex justify-between items-center pb-6 mb-6 border-b border-slate-200 print:hidden">
              <h3 className="font-bold text-sm text-slate-800">پیش‌نمایش برگه گارانتی و خدمات پس از فروش</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-sky-600/10"
                >
                  <Printer size={14} />
                  <span>چاپ برگه</span>
                </button>
                <button
                  onClick={() => {
                    setShowPrintModal(false);
                    onClearInitialPrintDocId?.();
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 transition"
                >
                  بستن پیش‌نمایش
                </button>
              </div>
            </div>

            {/* Printable Document Sheet */}
            <div className="print-sheet space-y-6 text-xs flex-1">
              <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                <div>
                  <h2 className="text-base font-bold text-slate-900">برگه رسمی خدمات پس از فروش و گارانتی</h2>
                  <p className="text-slate-400 text-[10px]">دپارتمان مهندسی خدمات و پشتیبانی فنی ابزار تامین عرشیا</p>
                </div>
                <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                  <div>Service ID: {printTargetService.id}</div>
                  <div>Start Date: {printTargetService.startDate}</div>
                  <div>Status: {printTargetService.status}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-700">
                <div>
                  <span className="text-slate-400 font-bold">پروژه مرتبط:</span>
                  <span className="text-slate-900 font-bold mr-1">
                    {projects.find(p => p.id === printTargetService.projectId)?.name || 'بدون پروژه'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold">تجهیز / کالای تحت پوشش:</span>
                  <span className="text-slate-900 font-bold mr-1">{printTargetService.itemName}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold">شماره پیش‌فاکتور مرجع:</span>
                  <span className="text-slate-900 font-mono mr-1">{printTargetService.proformaNumber || 'ثبت نشده'}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold">کاربر ثبت‌کننده:</span>
                  <span className="text-slate-900 mr-1">{printTargetService.createdBy || 'سیستم'}</span>
                </div>
              </div>

              {printTargetService.items && printTargetService.items.length > 0 ? (
                <div className="space-y-2 pt-2">
                  <h4 className="font-bold text-slate-800 text-xs">لیست موارد خدمات فنی و اقدامات صورت گرفته:</h4>
                  <table className="w-full border-collapse border border-slate-200 text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-200 p-2 w-10 text-center">ردیف</th>
                        <th className="border border-slate-200 p-2 text-right">عنوان قطعه / بخش</th>
                        <th className="border border-slate-200 p-2 text-right">شرح ایراد گزارش شده</th>
                        <th className="border border-slate-200 p-2 text-right">اقدام فنی انجام شده</th>
                        <th className="border border-slate-200 p-2 text-center w-20">وضعیت گارانتی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printTargetService.items.map((it, idx) => (
                        <tr key={it.id || idx} className="hover:bg-slate-50">
                          <td className="border border-slate-200 p-2 text-center font-mono">{idx + 1}</td>
                          <td className="border border-slate-200 p-2">{it.productName || 'عمومی / کل تجهیز'}</td>
                          <td className="border border-slate-200 p-2 text-slate-600">{it.issueDescription}</td>
                          <td className="border border-slate-200 p-2 text-slate-800">{it.actionTaken || 'در حال بررسی فنی'}</td>
                          <td className="border border-slate-200 p-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              it.status === 'انجام شده' ? 'bg-emerald-50 text-emerald-700' :
                              it.status === 'کنسل شده' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                            }`}>
                              {it.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-xl">اقدام جزئی مجزایی ثبت نشده است.</p>
              )}

              {printTargetService.notes && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700 mt-3">
                  <span className="text-slate-400 font-bold block mb-1">توضیحات و ملاحظات فنی:</span>
                  <p className="text-slate-800 leading-relaxed">{printTargetService.notes}</p>
                </div>
              )}

              <div className="pt-16 text-center text-[10px] text-slate-400 flex justify-between">
                <div>
                  <p className="font-bold text-slate-700">مسئول فنی و مهندس ناظر</p>
                  <div className="h-16"></div>
                </div>
                <div>
                  <p className="font-bold text-slate-700">مهر و امضای دپارتمان پشتیبانی</p>
                  <div className="h-16"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
