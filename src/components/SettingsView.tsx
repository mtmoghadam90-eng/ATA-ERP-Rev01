import React, { useState } from 'react';

import { 
  Settings, 
  Building, 
  FileText, 
  Percent, 
  Save, 
  RefreshCw,
  Sliders,
  CheckCircle2,
  FileCheck,
  ShieldCheck,
  Lock,
  Plus,
  Trash2,
  Edit2,
  HelpCircle,
  AlertCircle,
  Calendar,
  Paperclip,
  Check,
  ToggleLeft,
  XCircle,
  LayoutDashboard,
  Users,
  Briefcase,
  Package,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  ArrowDownLeft,
  TrendingUp,
  CheckSquare,
  Inbox,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Menu,
  UserCog,
  Bell,
  Boxes,
  Wrench,
  History,
  GripVertical,
  Copy
} from 'lucide-react';
import { ERPSettings, CustomField, ProjectCategoryGroup, User, Project, AuditLog, WorkflowRule, ExchangeRate } from '../types';
import { formatERPNumber } from '../numUtils';
import RatesView from './RatesView';
import { decompressLZW } from '../utils/compress';
import ConfirmModal from './ConfirmModal';
import { compressAndResizeImage, uploadFile } from '../imageUtils';
import { REQUIRED_FIELDS_METADATA, DEFAULT_REQUIRED_FIELDS } from '../utils/requiredFields';

interface SettingsViewProps {
  settings: ERPSettings;
  updateSettings: (newSettings: ERPSettings) => void;
  userRole?: 'admin' | 'user';
  changeRole?: (role: 'admin' | 'user') => void;
  projectCategoryGroups?: ProjectCategoryGroup[];
  users?: User[];
  currentUser?: User | null;
  projects?: Project[];
  auditLogs?: AuditLog[];
  exchangeRates?: ExchangeRate[];
  updateExchangeRate?: (id: string, newRate: number) => void;
  fetchRatesFromAPI?: (silent?: boolean) => Promise<boolean>;
}

export default function SettingsView({
  settings,
  updateSettings,
  userRole = 'admin',
  changeRole,
  projectCategoryGroups = [],
  users = [],
  currentUser = null,
  projects = [],
  auditLogs = [],
  exchangeRates = [],
  updateExchangeRate,
  fetchRatesFromAPI
}: SettingsViewProps) {
  const template = settings?.proformaTemplates?.[0] || {
    name: 'قالب پیش‌فرض رسمی',
    companyName: 'ابزار تامین ارشیا (سهامی خاص)',
    registrationNumber: '۱۰۴۸۲۷',
    nationalCode: '۱۰۲۶۰۴۸۲۷۳۱',
    economicCode: '۴۱۱۴۸۳۹۲۷۴۸۲',
    phone: '02188899000',
    email: 'sales@abzartamin.com',
    website: 'www.abzartamin.com',
    address: 'تهران، خیابان ولیعصر، برج سپهر، طبقه ۸، واحد ۸۰۴',
    titleColor: '#0ea5e9',
    documentTitle: 'پیش‌فاکتور رسمی',
    headerText: 'مفتخریم پیشنهاد قیمت تجهیزات ابزار دقیق مورد نیاز آن مجموعه محترم را به شرح زیر تقدیم داریم.',
    termsAndConditions: '۱. مدت اعتبار این پیشنهاد ۱۰ روز کاری از تاریخ صدور می‌باشد.\n۲. زمان تحویل کالاهای موجود در انبار، ۲ روز کاری و کالاهای سفارشی ۶ هفته پس از دریافت پیش‌پرداخت می‌باشد.\n۳. گارانتی کلیه تجهیزات به مدت ۱۲ ماه شمسی و خدمات پس از فروش به مدت ۵ سال ارائه می‌گردد.',
    footerText: 'از حسن توجه و اعتماد شما به شرکت ابزار تامین ارشیا صمیمانه سپاسگزاریم.',
    signatureLabel1: 'کارشناس فروش - محمد توکل مقدم',
    signatureLabel2: 'مدیرعامل - علیرضا ارشیا',
    showLogo: true,
    showTerms: true,
    showSignatures: true,
    showTotals: true
  };
  
  // Tab control
  const [activeTab, setActiveTab] = useState<'general' | 'customFields' | 'activityCategories' | 'dropdowns' | 'sidebarOrder' | 'adminNotifications' | 'deliveryChecklist' | 'auditLog' | 'workflows' | 'rates' | 'requiredFields'>('general');

  // Mandatory / optional fields state
  const [localRequiredFields, setLocalRequiredFields] = useState<Record<string, Record<string, boolean>>>(() => {
    return settings.requiredFields || DEFAULT_REQUIRED_FIELDS;
  });

  React.useEffect(() => {
    if (settings.requiredFields) {
      setLocalRequiredFields(settings.requiredFields);
    }
  }, [settings.requiredFields]);

  // Workflow builder states
  const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);
  const [isRuleFormOpen, setIsRuleFormOpen] = useState(false);

  // Audit log filters
  const [logSearch, setLogSearch] = useState('');
  const [logModuleFilter, setLogModuleFilter] = useState('all');
  const [logActionFilter, setLogActionFilter] = useState('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Loss reasons state
  const [newLossReason, setNewLossReason] = useState('');
  
  // Activity categories state
  const [newCategoryName, setNewCategoryName] = useState('');

  // Drag and drop state for sidebar ordering
  const [draggedModuleId, setDraggedModuleId] = useState<string | null>(null);

  // Dropdown items state
  const [selectedDropdownKey, setSelectedDropdownKey] = useState<keyof ERPSettings['dropdownItems'] | 'lossReasons'>('industries');
  const [newDropdownItem, setNewDropdownItem] = useState('');
  const [editingDropdownIndex, setEditingDropdownIndex] = useState<number | null>(null);
  const [editingDropdownValue, setEditingDropdownValue] = useState<string>('');

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<'dropdownItem' | 'activityCategory' | 'lossReason' | 'customField' | 'clearData' | 'workflow' | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string>('');
  const [deleteTargetName, setDeleteTargetName] = useState<string>('');
  const [deleteTargetExtra, setDeleteTargetExtra] = useState<any>(null);

  const allowedDropdownKeys: (keyof ERPSettings['dropdownItems'] | 'lossReasons')[] = [
    'industries',
    'categories',
    'units',
    'paymentTerms',
    'marketingChannels',
    'leadQualities',
    'communicationMethods',
    'taskPriorities',
    'positions',
    'receiptTypes',
    'shippingMethods',
    'packageTypes',
    'returnReasons',
    'equipmentTypes',
    'supplierInquirySteps',
    'proformaSentMethods',
    'lossReasons'
  ];

  const dropdownLabels: Partial<Record<keyof ERPSettings['dropdownItems'] | 'lossReasons', string>> = {
    industries: 'صنایع فعالیت مشتریان (مشتریان)',
    categories: 'دسته‌بندی‌های کالا و ابزار دقیق (کالا)',
    units: 'واحدهای سنجش و شمارش کالا (کالا)',
    paymentTerms: 'شرایط پرداخت و تسویه ارزی (پیش‌فاکتور/خرید)',
    salesExperts: 'کارشناسان فروش مسئول (مشتریان/پروژه‌ها)',
    marketingChannels: 'کانال‌های بازاریابی و جذب لید (مشتریان)',
    leadQualities: 'سطوح کیفیت سرنخ‌ها (مشتریان/پروژه‌ها)',
    communicationMethods: 'روش‌های اصلی ارتباط با مشتری (وظایف)',
    taskPriorities: 'اولویت‌های وظایف و پیگیری‌ها (وظایف)',
    positions: 'سمت‌های افراد حقیقی (کاربران)',
    receiptTypes: 'انواع دریافت و پرداخت (تراکنش‌ها)',
    shippingMethods: 'نحوه ارسال کالا (پکینگ لیست/خرید)',
    packageTypes: 'نوع بسته‌بندی (پکینگ لیست)',
    returnReasons: 'دلایل برگشت کالا (خدمات پس از فروش)',
    equipmentTypes: 'انواع پیش‌فرض تجهیزات ابزار دقیق (پروژه‌ها)',
    supplierInquirySteps: 'مراحل و رویدادهای استعلام (استعلام‌ها)',
    proformaSentMethods: 'طرق ارسال پیش‌فاکتور (پیش‌فاکتور)',
    lossReasons: 'دلایل باخت پروژه/اقلام (پروژه‌ها/پیش‌فاکتور)'
  };

  const dropdownDescriptions: Partial<Record<keyof ERPSettings['dropdownItems'] | 'lossReasons', string>> = {
    industries: 'لیست صنایع اصلی که مشتریان شما در آن‌ها فعالیت می‌کنند (مثال: نفت و گاز، پتروشیمی، نیروگاهی).',
    categories: 'گروه‌های کالایی و ابزار دقیق برای دسته‌بندی کالاها و پیش‌فاکتورها.',
    units: 'واحدهای شمارش فیزیکی اقلام و تجهیزات.',
    paymentTerms: 'شرایط پیش‌فرض برای تسویه حساب با تأمین‌کنندگان خارجی.',
    salesExperts: 'لیست اسامی کارشناسان فروش شرکت جهت انتساب به پروژه‌ها.',
    marketingChannels: 'راه‌های مختلف ورود سرنخ و فرصت‌های فروش به سیستم برای تحلیل بازاریابی.',
    leadQualities: 'درجه‌بندی اهمیت و گرمای سرنخ‌های ورودی.',
    communicationMethods: 'روش‌های اصلی تعامل و ارتباط با کارفرما.',
    taskPriorities: 'درجات اهمیت پیگیری‌ها و اقدامات همکاران.',
    positions: 'لیست سمت‌های پیش‌فرض و انتخابی برای مخاطبین و افراد حقیقی در بخش مشتریان.',
    receiptTypes: 'دسته‌بندی‌ها و بابت‌های دریافت و پرداخت در دفتر صندوق.',
    shippingMethods: 'لیست روش‌ها و شرکت‌های حمل و نقل جهت انتخاب در زمان صدور پکینگ لیست و تحویل کالا.',
    packageTypes: 'لیست انواع پیش‌فرض بسته‌بندی کالاها در پکینگ لیست.',
    returnReasons: 'لیست دلایل و مشکلات خرابی یا برگشت کالا در بخش خدمات پس از فروش.',
    equipmentTypes: 'لیست انواع تجهیزات ابزار دقیق (مانند فلومتر کوریولیس، ترانسمیتر فشار، لول ترانسمیتر راداری و غیره) برای ثبت سریع درخواست‌های پروژه‌ها.',
    supplierInquirySteps: 'مراحل و رویدادهای پیش‌فرض برای ثبت گردش کار استعلام‌های قیمت از تأمین‌کنندگان خارجی.',
    proformaSentMethods: 'روش‌های ارسال پیش‌فاکتور به کارفرما جهت ثبت در زمان اعلام وضعیت ارسال‌شده.',
    lossReasons: 'دلایل باخت تعریف شده که کاربر می‌تواند هنگام مشخص کردن وضعیت بازنده یا لغو پروژه/پیش‌فاکتور انتخاب کند.'
  };

  const handleAddDropdownItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDropdownItem.trim()) return;
    
    if (selectedDropdownKey === 'lossReasons') {
      const currentList = settings.lossReasons || [];
      if (currentList.map(item => item.toLowerCase()).includes(newDropdownItem.trim().toLowerCase())) {
        alert('این آیتم قبلاً در لیست وجود دارد.');
        return;
      }
      const updatedList = [...currentList, newDropdownItem.trim()];
      updateSettings({
        ...settings,
        lossReasons: updatedList
      });
      setNewDropdownItem('');
      return;
    }

    const currentList = settings.dropdownItems[selectedDropdownKey] || [];
    if (currentList.map(item => item.toLowerCase()).includes(newDropdownItem.trim().toLowerCase())) {
      alert('این آیتم قبلاً در لیست وجود دارد.');
      return;
    }
    
    const updatedList = [...currentList, newDropdownItem.trim()];
    
    updateSettings({
      ...settings,
      dropdownItems: {
        ...settings.dropdownItems,
        [selectedDropdownKey]: updatedList
      }
    });
    setNewDropdownItem('');
  };

  const handleDeleteDropdownItem = (itemToDelete: string) => {
    if (selectedDropdownKey === 'lossReasons') {
      setDeleteType('lossReason');
      setDeleteTargetId(itemToDelete);
      setDeleteTargetName(itemToDelete);
      setDeleteConfirmOpen(true);
      return;
    }

    const currentList = settings.dropdownItems[selectedDropdownKey] || [];
    if (currentList.length <= 1) {
      alert('لیست بازشو نمی‌تواند کاملاً خالی باشد. حداقل یک آیتم باید باقی بماند.');
      return;
    }
    setDeleteType('dropdownItem');
    setDeleteTargetId(itemToDelete);
    setDeleteTargetName(itemToDelete);
    setDeleteConfirmOpen(true);
  };

  const handleSaveDropdownEdit = (idx: number) => {
    if (!editingDropdownValue.trim()) return;
    
    if (selectedDropdownKey === 'lossReasons') {
      const currentList = settings.lossReasons || [];
      // check if it's a duplicate of another item
      if (currentList.some((item, i) => i !== idx && item.toLowerCase() === editingDropdownValue.trim().toLowerCase())) {
        alert('این آیتم قبلاً در لیست وجود دارد.');
        return;
      }
      const updatedList = [...currentList];
      updatedList[idx] = editingDropdownValue.trim();
      updateSettings({
        ...settings,
        lossReasons: updatedList
      });
    } else {
      const currentList = settings.dropdownItems[selectedDropdownKey] || [];
      // check if it's a duplicate of another item
      if (currentList.some((item, i) => i !== idx && item.toLowerCase() === editingDropdownValue.trim().toLowerCase())) {
        alert('این آیتم قبلاً در لیست وجود دارد.');
        return;
      }
      const updatedList = [...currentList];
      updatedList[idx] = editingDropdownValue.trim();
      updateSettings({
        ...settings,
        dropdownItems: {
          ...settings.dropdownItems,
          [selectedDropdownKey]: updatedList
        }
      });
    }
    setEditingDropdownIndex(null);
    setEditingDropdownValue('');
  };

  const handleMoveDropdownItem = (idx: number, direction: 'up' | 'down') => {
    if (selectedDropdownKey === 'lossReasons') {
      const currentList = [...(settings.lossReasons || [])];
      const targetIndex = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIndex < 0 || targetIndex >= currentList.length) return;
      
      const temp = currentList[idx];
      currentList[idx] = currentList[targetIndex];
      currentList[targetIndex] = temp;
      
      updateSettings({
        ...settings,
        lossReasons: currentList
      });
    } else {
      const currentList = [...(settings.dropdownItems[selectedDropdownKey] || [])];
      const targetIndex = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIndex < 0 || targetIndex >= currentList.length) return;
      
      const temp = currentList[idx];
      currentList[idx] = currentList[targetIndex];
      currentList[targetIndex] = temp;
      
      updateSettings({
        ...settings,
        dropdownItems: {
          ...settings.dropdownItems,
          [selectedDropdownKey]: currentList
        }
      });
    }
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    const exists = (settings.activityCategories || []).some(
      (cat) => cat.name.toLowerCase() === newCategoryName.trim().toLowerCase()
    );
    if (exists) {
      alert('این دسته‌بندی فعالیتی قبلاً تعریف شده است.');
      return;
    }
    const newCat = {
      id: `act-${Date.now()}`,
      name: newCategoryName.trim(),
      module: 'projects'
    };
    updateSettings({
      ...settings,
      activityCategories: [...(settings.activityCategories || []), newCat]
    });
    setNewCategoryName('');
  };

  const handleDeleteCategory = (catId: string, catName: string) => {
    if (projectCategoryGroups.some((g) => g.categoryId === catId)) {
      alert(`دسته‌بندی "${catName}" در پروژه‌ها فعال بوده و قابل حذف نیست.`);
      return;
    }
    setDeleteType('activityCategory');
    setDeleteTargetId(catId);
    setDeleteTargetName(catName);
    setDeleteConfirmOpen(true);
  };

  const handleAddLossReason = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLossReason.trim()) return;
    if (settings.lossReasons?.includes(newLossReason.trim())) {
      alert('این علت باخت قبلاً تعریف شده است.');
      return;
    }
    const updatedReasons = [...(settings.lossReasons || []), newLossReason.trim()];
    updateSettings({
      ...settings,
      lossReasons: updatedReasons
    });
    setNewLossReason('');
  };

  const handleDeleteLossReason = (reasonToDelete: string) => {
    setDeleteType('lossReason');
    setDeleteTargetId(reasonToDelete);
    setDeleteTargetName(reasonToDelete);
    setDeleteConfirmOpen(true);
  };

  const handleToggleWorkflowActive = (ruleId: string) => {
    const rules = settings.workflows || [];
    const updated = rules.map(r => r.id === ruleId ? { ...r, active: !r.active } : r);
    updateSettings({
      ...settings,
      workflows: updated
    });
  };

  const handleDeleteWorkflowRule = (ruleId: string) => {
    const rules = settings.workflows || [];
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    setDeleteType('workflow');
    setDeleteTargetId(ruleId);
    setDeleteTargetName(rule.name);
    setDeleteConfirmOpen(true);
  };

  const handleCopyWorkflowRule = (ruleId: string) => {
    const rules = settings.workflows || [];
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    const newRule: WorkflowRule = {
      ...rule,
      id: `wf-${Date.now()}`,
      name: `${rule.name} - کپی`,
      active: false
    };
    updateSettings({
      ...settings,
      workflows: [...rules, newRule]
    });
  };

  const handleSaveWorkflowRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;
    if (!editingRule.name.trim()) {
      alert('لطفاً نام قانون را وارد کنید.');
      return;
    }
    
    const rules = settings.workflows || [];
    let updatedRules: WorkflowRule[];
    
    if (editingRule.id.startsWith('new-')) {
      const newRule: WorkflowRule = {
        ...editingRule,
        id: `wf-${Date.now()}`
      };
      updatedRules = [...rules, newRule];
    } else {
      updatedRules = rules.map(r => r.id === editingRule.id ? editingRule : r);
    }
    
    updateSettings({
      ...settings,
      workflows: updatedRules
    });
    
    setEditingRule(null);
    setIsRuleFormOpen(false);
  };

  // General settings states
  const [companyName, setCompanyName] = useState(template?.companyName || 'ابزار تامین ارشیا');
  const [address, setAddress] = useState(template?.address || '');
  const [phone, setPhone] = useState(template?.phone || '');
  const [email, setEmail] = useState(template?.email || '');
  const [registrationNumber, setRegistrationNumber] = useState(template?.registrationNumber || '');
  const [nationalId, setNationalId] = useState(template?.nationalCode || '');
  const [logoUrl, setLogoUrl] = useState(template?.logoUrl || '');
  const [companySealUrl, setCompanySealUrl] = useState(template?.companySealUrl || '');
  const [termsAndConditions, setTermsAndConditions] = useState(template?.termsAndConditions || '');
  const [proformaPrefix, setProformaPrefix] = useState(settings.documentFormats.proformaPrefix);
  const [purchaseOrderPrefix, setPurchaseOrderPrefix] = useState(settings.documentFormats.poPrefix);
  const [projectFormat, setProjectFormat] = useState(settings.documentFormats.projectFormat || 'ATA-{YYYY}-{SEQ:3}');
  const [projectStartSeq, setProjectStartSeq] = useState(settings.documentFormats.projectStartSeq || 1);
  const [proformaFormat, setProformaFormat] = useState(settings.documentFormats.proformaFormat || 'QT-{PROJECT}-{SEQ:2}');
  const [proformaStartSeq, setProformaStartSeq] = useState(settings.documentFormats.proformaStartSeq || 1);
  const [proformaTechnicalFormat, setProformaTechnicalFormat] = useState(settings.documentFormats.proformaTechnicalFormat || 'QT-TECH-{PROJECT}-{SEQ:2}');
  const [proformaAfterSalesFormat, setProformaAfterSalesFormat] = useState(settings.documentFormats.proformaAfterSalesFormat || 'QT-SERV-{PROJECT}-{SEQ:2}');
  const [poFormat, setPoFormat] = useState(settings.documentFormats.poFormat || 'PO-{PROJECT}-{SEQ:3}');
  const [poStartSeq, setPoStartSeq] = useState(settings.documentFormats.poStartSeq || 1);
  const [transactionFormat, setTransactionFormat] = useState(settings.documentFormats.transactionFormat || 'TR-{TYPE}-{YYYY}{MM}-{SEQ:3}');
  const [transactionStartSeq, setTransactionStartSeq] = useState(settings.documentFormats.transactionStartSeq || 1);
  const [productFormat, setProductFormat] = useState(settings.documentFormats.productFormat || 'EQ-{RAND:5}');
  const [productStartSeq, setProductStartSeq] = useState(settings.documentFormats.productStartSeq || 1);
  const [packingListFormat, setPackingListFormat] = useState(settings.documentFormats.packingListFormat || 'PL-{PROJECT}-{SEQ:3}');
  const [packingListStartSeq, setPackingListStartSeq] = useState(settings.documentFormats.packingListStartSeq || 1);
  const [vatPercent, setVatPercent] = useState(10);
  const [showProductBrandInDocuments, setShowProductBrandInDocuments] = useState(!!settings.showProductBrandInDocuments);

  const [isSaved, setIsSaved] = useState(false);
  const [isRequiredFieldsSaved, setIsRequiredFieldsSaved] = useState(false);

  // Custom Fields manager states
  const [selectedModule, setSelectedModule] = useState<'customers' | 'projects' | 'products' | 'proformas' | 'suppliers' | 'purchaseOrders' | 'transactions' | 'tasks'>('customers');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomField['type']>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldUseSeparator, setNewFieldUseSeparator] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState('');

  const modulesList = [
    { id: 'customers', name: 'مشتریان' },
    { id: 'projects', name: 'پروژه‌ها (فرصت‌ها)' },
    { id: 'products', name: 'کالاها و تجهیزات' },
    { id: 'proformas', name: 'پیش‌فاکتورها' },
    { id: 'suppliers', name: 'تأمین‌کنندگان' },
    { id: 'purchaseOrders', name: 'سفارشات خرید خارجی' },
    { id: 'packagingDelivery', name: 'بسته‌بندی و تحویل کالا' },
    { id: 'afterSalesServices', name: 'خدمات پس از فروش' },
    { id: 'transactions', name: 'دریافت و پرداخت ریالی' },
    { id: 'tasks', name: 'وظایف و پیگیری' },
  ] as const;

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    
    const currentTemplates = settings?.proformaTemplates || [];
    const updatedTemplates = (currentTemplates.length > 0 ? currentTemplates : [template]).map((t, idx) => {
      if (idx === 0) {
        return {
          ...t,
          companyName,
          address,
          phone,
          email,
          registrationNumber,
          nationalCode: nationalId,
          logoUrl,
          companySealUrl,
          termsAndConditions
        };
      }
      return t;
    });

    updateSettings({
      ...settings,
      showProductBrandInDocuments,
      proformaTemplates: updatedTemplates,
      documentFormats: {
        ...settings.documentFormats,
        proformaPrefix,
        poPrefix: purchaseOrderPrefix,
        projectFormat,
        projectStartSeq,
        proformaFormat,
        proformaStartSeq,
        proformaTechnicalFormat,
        proformaAfterSalesFormat,
        poFormat,
        poStartSeq,
        transactionFormat,
        transactionStartSeq,
        productFormat,
        productStartSeq,
        packingListFormat,
        packingListStartSeq
      }
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleAddCustomField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName.trim()) {
      alert('لطفاً نام فیلد سفارشی را وارد کنید.');
      return;
    }

    let optionsArray: string[] | undefined = undefined;
    if (newFieldType === 'select') {
      const opts = newFieldOptions.split('\n').map(o => o.trim()).filter(o => o.length > 0);
      if (opts.length === 0) {
        alert('لطفاً حداقل یک گزینه برای لیست بازشو تعریف کنید (هر گزینه در یک خط).');
        return;
      }
      optionsArray = opts;
    }

    const newField: CustomField = {
      id: `cf-${Date.now()}`,
      module: selectedModule,
      name: newFieldName.trim(),
      type: newFieldType,
      required: newFieldRequired,
      useSeparator: newFieldType === 'number' ? newFieldUseSeparator : undefined,
      options: optionsArray
    };

    const currentFields = settings.customFields || [];
    updateSettings({
      ...settings,
      customFields: [...currentFields, newField]
    });

    // Reset Form
    setNewFieldName('');
    setNewFieldRequired(false);
    setNewFieldUseSeparator(false);
    setNewFieldOptions('');
    alert(`فیلد سفارشی "${newField.name}" با موفقیت ایجاد شد.`);
  };

  const handleDeleteCustomField = (fieldId: string) => {
    const field = (settings.customFields || []).find(f => f.id === fieldId);
    const fieldName = field ? field.name : '';
    setDeleteType('customField');
    setDeleteTargetId(fieldId);
    setDeleteTargetName(fieldName);
    setDeleteConfirmOpen(true);
  };

  const currentFields = settings.customFields || [];
  const filteredFields = currentFields.filter(f => f.module === selectedModule);

  const handleConfirmDelete = () => {
    if (deleteType === 'dropdownItem') {
      const currentList = settings.dropdownItems[selectedDropdownKey] || [];
      const updatedList = currentList.filter(item => item !== deleteTargetId);
      updateSettings({
        ...settings,
        dropdownItems: {
          ...settings.dropdownItems,
          [selectedDropdownKey]: updatedList
        }
      });
    } else if (deleteType === 'activityCategory') {
      const updated = (settings.activityCategories || []).filter((cat) => cat.id !== deleteTargetId);
      updateSettings({
        ...settings,
        activityCategories: updated
      });
    } else if (deleteType === 'lossReason') {
      const updatedReasons = (settings.lossReasons || []).filter(r => r !== deleteTargetId);
      updateSettings({
        ...settings,
        lossReasons: updatedReasons
      });
    } else if (deleteType === 'customField') {
      const currentFields = settings.customFields || [];
      updateSettings({
        ...settings,
        customFields: currentFields.filter(f => f.id !== deleteTargetId)
      });
    } else if (deleteType === 'workflow') {
      const rules = settings.workflows || [];
      const updated = rules.filter(r => r.id !== deleteTargetId);
      updateSettings({
        ...settings,
        workflows: updated
      });
    } else if (deleteType === "clearData") {
      const keysToClear = [
        "erp_customers", "erp_products", "erp_suppliers", "erp_projects", 
        "erp_proformas", "erp_purchase_orders", "erp_transactions", "erp_tasks", 
        "erp_project_category_groups", "erp_supplier_inquiries", "erp_packaging_deliveries",
        "erp_after_sales_services", "erp_module_notifications"
      ];
      
      Promise.all(keysToClear.map(key => 
        fetch(`/api/data/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([])
        })
      )).then(() => {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('read_notifications_')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        
        alert("تمامی داده‌ها با موفقیت پاک شدند. لطفاً صفحه را بارگذاری مجدد (Refresh) کنید.");
        window.location.reload();
      }).catch(err => {
        console.error("Failed to clear data on server:", err);
        alert("خطا در پاک کردن داده‌ها!");
      });
    }
    setDeleteConfirmOpen(false);
    setDeleteType(null);
    setDeleteTargetId('');
    setDeleteTargetName('');
  };

  const dummyProjectCode = formatERPNumber(projectFormat || 'ATA-{YYYY}-{SEQ:3}', { seq: projectStartSeq, customerName: 'مشتری نمونه' });

  const renderFormatField = (
    label: string, 
    formatValue: string, 
    setFormatValue: (v: string) => void, 
    startSeqValue: number, 
    setStartSeqValue: (v: number) => void, 
    defaultFormat: string, 
    dummyContext: any
  ) => {
    return (
      <div className="space-y-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-colors">
        <label className="text-xs font-semibold text-slate-700 block">{label}</label>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 space-y-1">
            <span className="text-[10px] text-slate-500 block">فرمت الگو</span>
            <input
              type="text"
              required
              value={formatValue}
              onChange={(e) => setFormatValue(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-left bg-slate-50 focus:bg-white transition focus:ring-2 focus:ring-sky-100 outline-none"
              placeholder={defaultFormat}
              dir="ltr"
            />
          </div>
          <div className="w-full md:w-32 space-y-1">
            <span className="text-[10px] text-slate-500 block">شروع سریال از</span>
            <input
              type="number"
              required
              min="1"
              value={startSeqValue}
              onChange={(e) => setStartSeqValue(parseInt(e.target.value, 10) || 1)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-center bg-slate-50 focus:bg-white transition focus:ring-2 focus:ring-sky-100 outline-none"
              dir="ltr"
            />
          </div>
        </div>
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 mt-2 flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-[10px]">
            <span className="text-slate-400">پیش‌فرض سیستم:</span>
            <code className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{defaultFormat}</code>
          </div>
          <div className="flex justify-between items-center text-[10px] border-t border-slate-100 pt-1.5 mt-0.5">
            <span className="text-slate-500 font-medium">پیش‌نمایش خروجی:</span>
            <code className="font-mono text-emerald-600 font-bold bg-emerald-50/50 px-2 py-1 rounded-md text-xs border border-emerald-100 shadow-sm">
              {formatERPNumber(formatValue || defaultFormat, { seq: startSeqValue, ...dummyContext })}
            </code>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in text-right" dir="rtl">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">تنظیمات سیستم و شخصی‌سازی</h1>
          <p className="text-slate-500 text-sm mt-1">مدیریت هویت حقوقی شرکت و تعریف فیلدهای پویا سفارشی برای ماژول‌های مختلف ERP</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 md:gap-3 border-b border-slate-200 pb-4">
        <button
          onClick={() => setActiveTab('general')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'general'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <Building size={16} />
          تنظیمات عمومی شرکت
        </button>
        <button
          onClick={() => setActiveTab('customFields')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'customFields'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <Sliders size={16} />
          فیلدهای سفارشی
          <span className="bg-sky-100 text-sky-700 text-[9px] md:text-[10px] px-1.5 py-0.5 rounded-full font-bold">مدیر</span>
        </button>
        <button
          onClick={() => setActiveTab('requiredFields')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'requiredFields'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <CheckSquare size={16} className="text-red-500" />
          تعیین فیلدهای اجباری
        </button>
        <button
          onClick={() => setActiveTab('activityCategories')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'activityCategories'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <Sliders size={16} className="text-sky-500" />
          دسته‌بندی فعالیت‌ها
        </button>
        <button
          onClick={() => setActiveTab('dropdowns')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'dropdowns'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <Settings size={16} className="text-amber-500" />
          لیست‌های بازشو
        </button>
        <button
          onClick={() => setActiveTab('sidebarOrder')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'sidebarOrder'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <Menu size={16} className="text-teal-500" />
          ترتیب منوی سایدبار
        </button>
        {userRole === 'admin' && (
          <button
            onClick={() => setActiveTab('adminNotifications')}
            className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
              activeTab === 'adminNotifications'
                ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
                : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
            }`}
          >
            <Bell size={16} className="text-rose-500" />
            تنظیمات اعلان‌های مدیر
          </button>
        )}
        <button
          onClick={() => setActiveTab('deliveryChecklist')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'deliveryChecklist'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <FileCheck size={16} className="text-emerald-500" />
          چک‌لیست تحویل کالا
        </button>
        <button
          onClick={() => setActiveTab('workflows')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'workflows'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <RefreshCw size={16} className="text-emerald-600" />
          اتوماسیون و ورک‌فلوها
          <span className="bg-emerald-100 text-emerald-700 text-[9px] md:text-[10px] px-1.5 py-0.5 rounded-full font-bold">جدید</span>
        </button>
        <button
          onClick={() => setActiveTab('auditLog')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'auditLog'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <History size={16} className="text-violet-500" />
          سابقه اقدامات (Audit Log)
        </button>

        <button
          onClick={() => setActiveTab('rates')}
          className={`py-2 px-4 md:py-2.5 md:px-5 text-xs md:text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 rounded-xl border flex-shrink-0 ${
            activeTab === 'rates'
              ? 'bg-sky-50 text-sky-600 border-sky-300 shadow-sm shadow-sky-100'
              : 'bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-slate-200'
          }`}
        >
          <TrendingUp size={16} className="text-emerald-500" />
          نرخ ارز روزانه
        </button>
      </div>

      {activeTab === 'requiredFields' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900">تنظیمات اجباری/اختیاری بودن فیلدهای اصلی</h3>
            <p className="text-slate-500 text-xs mt-1">
              در این بخش می‌توانید مشخص کنید کدام‌یک از فیلدهای اصلی هر ماژول در زمان ثبت یا ویرایش الزامی (اجباری) باشند. فیلدهایی که اجباری می‌شوند با علامت ستاره قرمز <span className="text-red-500 font-bold">*</span> در فرم‌ها نمایش داده خواهند شد و سیستم اجازه ثبت بدون آن‌ها را نخواهد داد.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {REQUIRED_FIELDS_METADATA.map((mod) => {
              const modFields = localRequiredFields[mod.key] || {};
              return (
                <div key={mod.key} className="bg-slate-50 border border-slate-200/60 rounded-2xl p-5 hover:shadow-md transition-all duration-300 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 border-b border-slate-200/80 pb-3 mb-4">
                      <div className="w-2 h-5 bg-sky-500 rounded-full"></div>
                      <h4 className="font-bold text-slate-800 text-sm">{mod.name}</h4>
                    </div>

                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                      {mod.fields.map((field) => {
                        const isRequired = !!modFields[field.key];
                        return (
                          <div key={field.key} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm">
                            <span className="text-xs font-semibold text-slate-600">{field.label}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setLocalRequiredFields((prev) => {
                                  const updatedModule = {
                                    ...(prev[mod.key] || {}),
                                    [field.key]: !isRequired,
                                  };
                                  return {
                                    ...prev,
                                    [mod.key]: updatedModule,
                                  };
                                });
                              }}
                              className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-all duration-300 outline-none ${
                                isRequired ? 'bg-red-500 justify-end' : 'bg-slate-200 justify-start'
                              }`}
                            >
                              <span className="bg-white w-4 h-4 rounded-full shadow-md transition-all duration-300"></span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 text-left">
                    تعداد کل: {mod.fields.length} فیلد اصلی
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center border-t border-slate-100 pt-6">
            <div>
              {isRequiredFieldsSaved && (
                <span className="text-emerald-600 text-xs font-bold flex items-center gap-1.5 animate-bounce-short">
                  <CheckCircle2 size={16} />
                  تنظیمات فیلدهای اجباری با موفقیت ذخیره شد.
                </span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setLocalRequiredFields(settings.requiredFields || DEFAULT_REQUIRED_FIELDS);
                  setIsRequiredFieldsSaved(false);
                }}
                className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
              >
                لغو تغییرات
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSettings({
                    ...settings,
                    requiredFields: localRequiredFields,
                  });
                  setIsRequiredFieldsSaved(true);
                  setTimeout(() => setIsRequiredFieldsSaved(false), 4000);
                }}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
              >
                <Save size={14} />
                ذخیره تنظیمات فیلدها
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === 'rates' ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-800">نرخ ارز روزانه</h3>
            <p className="text-slate-500 text-sm mt-1">مدیریت نرخ‌های تسعیر ارز در سیستم</p>
          </div>
          {exchangeRates && updateExchangeRate && fetchRatesFromAPI && (
            <RatesView 
              exchangeRates={exchangeRates} 
              updateExchangeRate={updateExchangeRate} 
              fetchRatesFromAPI={fetchRatesFromAPI} 
            />
          )}
        </div>
      ) : activeTab === 'general' ? (
        <form onSubmit={handleSaveGeneral} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Col 1: Company Profile settings */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 lg:col-span-2">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-150 text-slate-800">
                <Building size={18} className="text-sky-500" />
                <h3 className="font-bold text-sm">مشخصات هویتی و ثبتی شرکت</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Logo Upload & Preview */}
                <div className="space-y-1.5 bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                  <label className="text-xs font-bold text-slate-700 block">تصویر لوگو جهت نمایش در سربرگ پیش‌فاکتورها</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
                    {logoUrl ? (
                      <div className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-white shrink-0 shadow-sm flex items-center justify-center p-1">
                        <img src={logoUrl} alt="Company Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                        <button
                          type="button"
                          onClick={() => setLogoUrl('')}
                          className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition"
                          title="حذف لوگو"
                        >
                          <XCircle size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0 text-[10px] font-bold">
                        بدون لوگو
                      </div>
                    )}
                    
                    <div className="flex-1 w-full space-y-2">
                      <div className="relative border border-dashed border-slate-350 hover:border-sky-500 rounded-lg py-2 px-3 text-center cursor-pointer bg-white transition">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const url = await uploadFile(file);
                                setLogoUrl(url);
                              } catch (err: any) {
                                console.error(err);
                                alert(err.message || 'خطا در بارگذاری تصویر لوگو');
                              }
                            }
                            if (e.target) e.target.value = '';
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                        />
                        <span className="text-xs text-sky-600 font-semibold">بارگذاری فایل لوگو</span>
                      </div>
                      <input
                        type="text"
                        placeholder="یا آدرس اینترنتی (URL) لوگو را وارد کنید..."
                        value={logoUrl.startsWith('data:') ? '' : logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Company Seal Upload & Preview */}
                <div className="space-y-1.5 bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                  <label className="text-xs font-bold text-slate-700 block">تصویر مهر شرکت جهت مهر زدن زیر امضاها</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
                    {companySealUrl ? (
                      <div className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-white shrink-0 shadow-sm flex items-center justify-center p-1">
                        <img src={companySealUrl} alt="Company Seal" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                        <button
                          type="button"
                          onClick={() => setCompanySealUrl('')}
                          className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition"
                          title="حذف مهر شرکت"
                        >
                          <XCircle size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0 text-[10px] font-bold">
                        بدون مهر
                      </div>
                    )}
                    
                    <div className="flex-1 w-full space-y-2">
                      <div className="relative border border-dashed border-slate-350 hover:border-sky-500 rounded-lg py-2 px-3 text-center cursor-pointer bg-white transition">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const url = await uploadFile(file);
                                setCompanySealUrl(url);
                              } catch (err: any) {
                                console.error(err);
                                alert(err.message || 'خطا در بارگذاری تصویر مهر');
                              }
                            }
                            if (e.target) e.target.value = '';
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                        />
                        <span className="text-xs text-sky-600 font-semibold">بارگذاری فایل مهر شرکت</span>
                      </div>
                      <input
                        type="text"
                        placeholder="یا آدرس اینترنتی (URL) مهر را وارد کنید..."
                        value={companySealUrl.startsWith('data:') ? '' : companySealUrl}
                        onChange={(e) => setCompanySealUrl(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">نام رسمی شخصیت حقوقی *</label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none"
                  />
                </div>

                {/* Registration */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">شماره ثبت شرکت</label>
                  <input
                    type="text"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none font-mono text-left"
                  />
                </div>

                {/* National ID */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">شناسه ملی حقوقی</label>
                  <input
                    type="text"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none font-mono text-left"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">شماره تلفن دفتر مرکزی *</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none font-mono text-left"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">پست الکترونیکی عمومی *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none font-mono text-left"
                  />
                </div>

                {/* Address */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">آدرس دقیق پستی دفتر مرکزی *</label>
                  <textarea
                    rows={2}
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none"
                  />
                </div>

                {/* Default Terms & Conditions (شرایط و توضیحات) */}
                <div className="space-y-1.5 md:col-span-2 border-t border-slate-100 pt-4">
                  <label className="text-xs font-bold text-slate-700 block">شرایط و توضیحات (پیش‌فرض پیش‌فاکتورها)</label>
                  <span className="text-[10px] text-slate-400 block mb-1">
                    این متن به صورت خودکار به عنوان شرایط و مفاد عمومی در زمان ساخت پیش‌فاکتور جدید قرار می‌گیرد.
                  </span>
                  <textarea
                    rows={4}
                    value={termsAndConditions}
                    onChange={(e) => setTermsAndConditions(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    placeholder="مفاد عمومی، مدت اعتبار پیشنهاد، شرایط گارانتی و غیره..."
                  />
                </div>

              </div>
            </div>

            {/* Col 2: Variables and advanced document numbering formats settings */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-150 text-slate-800">
                <Sliders size={18} className="text-sky-500" />
                <h3 className="font-bold text-sm">تنظیمات کالا و فرمت‌ها</h3>
              </div>

              <div className="space-y-4">

                {/* Brand display toggle */}
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/80 flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="showProductBrandInDocuments"
                    checked={showProductBrandInDocuments}
                    onChange={(e) => setShowProductBrandInDocuments(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 mt-0.5 cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <label htmlFor="showProductBrandInDocuments" className="text-xs font-bold text-slate-800 cursor-pointer">
                      نمایش برند کالا در اسناد و فرم‌ها
                    </label>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      در صورت فعال‌سازی، برند کالاها در پیش‌فاکتور، پکینگ لیست، رسیدهای خدمات پس از فروش و سایر فرم‌های برنامه نمایش داده می‌شود.
                    </p>
                  </div>
                </div>

                {/* Advanced Numbering Formats Header */}
                <div className="pt-2 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-700 block mb-1.5">فرمت پیشرفته شماره‌گذاری خودکار اسناد (ERP Standard)</span>
                  <p className="text-[10px] text-slate-400 leading-relaxed mb-4 text-justify">
                    با ترکیب متغیرها و کلمات ثابت، سیستم کدگذاری منحصربه‌فرد خود را بسازید. متغیرهای مجاز:
                    <br />
                    <span className="font-mono text-sky-600 bg-sky-50 px-1 py-0.5 rounded inline-block text-left my-1" style={{ direction: 'ltr' }}>
                      {"{YYYY}"} (سال شمسی)، {"{YY}"} (سال دورقمی)، {"{MM}"} (ماه)، {"{DD}"} (روز)، {"{SEQ:3}"} (سریال ۳ رقمی)، {"{PROJECT}"} (پروژه)، {"{TYPE}"} (نوع دریافت/پرداخت)، {"{RAND:5}"} (تصادفی)
                    </span>
                  </p>
                </div>
                {renderFormatField('ساختار کدگذاری پروژه‌ها', projectFormat, setProjectFormat, projectStartSeq, setProjectStartSeq, 'ATA-{YYYY}-{SEQ:3}', { projectCode: 'ATA' })}
                {renderFormatField('ساختار کدگذاری پیش‌فاکتورهای مالی', proformaFormat, setProformaFormat, proformaStartSeq, setProformaStartSeq, 'QT-{PROJECT}-{SEQ:2}', { projectCode: dummyProjectCode })}
                {renderFormatField('ساختار کدگذاری پیش‌فاکتورهای فنی', proformaTechnicalFormat, setProformaTechnicalFormat, proformaStartSeq, setProformaStartSeq, 'QT-TECH-{PROJECT}-{SEQ:2}', { projectCode: dummyProjectCode })}
                {renderFormatField('ساختار کدگذاری پیش‌فاکتورهای خدمات پس از فروش', proformaAfterSalesFormat, setProformaAfterSalesFormat, proformaStartSeq, setProformaStartSeq, 'QT-SERV-{PROJECT}-{SEQ:2}', { projectCode: dummyProjectCode })}
                {renderFormatField('ساختار کدگذاری سفارشات خرید ارزی', poFormat, setPoFormat, poStartSeq, setPoStartSeq, 'PO-{PROJECT}-{SEQ:3}', { projectCode: dummyProjectCode })}
                {renderFormatField('ساختار شماره اسناد دریافت/پرداخت صندوق', transactionFormat, setTransactionFormat, transactionStartSeq, setTransactionStartSeq, 'TR-{TYPE}-{YYYY}{MM}-{SEQ:3}', { transactionType: 'دریافت' })}
                {renderFormatField('ساختار پیش‌فرض کدهای کالا و تجهیزات', productFormat, setProductFormat, productStartSeq, setProductStartSeq, 'EQ-{RAND:5}', { category: 'CAT' })}
                {renderFormatField('ساختار شماره‌گذاری پکینگ لیست‌ها', packingListFormat, setPackingListFormat, packingListStartSeq, setPackingListStartSeq, 'PL-{PROJECT}-{SEQ:3}', { projectCode: dummyProjectCode })}


              </div>
            </div>

          </div>

          {/* Form save footer */}
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteType('clearData');
                  setDeleteConfirmOpen(true);
                }}
                className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-sm font-bold transition flex items-center gap-2 border border-red-200"
              >
                <Trash2 size={16} />
                پاکسازی کامل داده‌ها
              </button>
              {isSaved && (
                <span className="text-emerald-600 text-xs font-bold flex items-center gap-1.5 animate-bounce-short">
                  <CheckCircle2 size={16} />
                  تنظیمات با موفقیت در فضای ابری محلی (LocalStorage) ذخیره شد.
                </span>
              )}
            </div>
            <button
              type="submit"
              className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-bold transition shadow-lg shadow-sky-500/15 flex items-center gap-2"
            >
              <Save size={16} />
              ذخیره کل پیکربندی
            </button>
          </div>
        </form>
      ) : (
        /* Dynamic Custom Fields Tab contents */
        userRole !== 'admin' ? (
          /* Locked State for non-admin */
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center space-y-4 animate-fade-in">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-amber-600">
              <Lock size={28} />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-slate-900">عدم دسترسی به تنظیمات فیلدهای سفارشی</h3>
              <p className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
                تعریف، تغییر یا حذف ساختار فیلدهای سفارشی ماژول‌ها فقط برای کاربران با نقش <span className="font-bold text-slate-800">مدیر سیستم</span> مجاز است. شما با نقش کاربر عادی وارد شده‌اید.
              </p>
            </div>
            {changeRole && (
              <button
                type="button"
                onClick={() => changeRole('admin')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition shadow-md shadow-amber-500/10"
              >
                شبیه‌سازی و ورود با نقش مدیر سیستم
              </button>
            )}
          </div>
        ) : activeTab === 'customFields' ? (
          /* Authorized Custom Fields Designer */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            
            {/* Sidebar module selector */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-800 text-sm border-b border-slate-100 pb-2.5">انتخاب ماژول هدف</h3>
              <p className="text-slate-400 text-[11px]">ماژولی که مایل به مدیریت فیلدهای سفارشی آن هستید را انتخاب کنید:</p>
              
              <div className="space-y-1 pt-1">
                {modulesList.map((m) => {
                  const count = currentFields.filter(f => f.module === m.id).length;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedModule(m.id)}
                      className={`w-full flex justify-between items-center px-3.5 py-2.5 rounded-lg text-xs font-bold transition ${
                        selectedModule === m.id
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/10'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{m.name}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${selectedModule === m.id ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                        {count} فیلد
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Field designer workspace */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Add Custom Field Form */}
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 pb-3.5 border-b border-slate-100 mb-4 text-slate-800">
                  <Plus size={18} className="text-emerald-500" />
                  <h3 className="font-bold text-sm">
                    تعریف فیلد جدید برای ماژول «{modulesList.find(m => m.id === selectedModule)?.name}»
                  </h3>
                </div>

                <form onSubmit={handleAddCustomField} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Field Label / Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-500">عنوان فیلد (نام نمایشی) *</label>
                      <input
                        type="text"
                        required
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                        placeholder="مثال: برند موتور، تاریخ ترخیص، کد فنی قطعه"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>

                    {/* Field Type */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-500">نوع فیلد ورودی *</label>
                      <select
                        value={newFieldType}
                        onChange={(e) => {
                          setNewFieldType(e.target.value as any);
                          setNewFieldUseSeparator(false);
                          setNewFieldOptions('');
                        }}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      >
                        <option value="text">متن کوتاه (یک خطی)</option>
                        <option value="textarea">متن بلند (چند خطی)</option>
                        <option value="number">عددی (با قابلیت فیلترینگ)</option>
                        <option value="select">لیست بازشو (گزینه‌ای)</option>
                        <option value="date">تاریخ شمسی (Shamsi Calendar)</option>
                        <option value="file">پیوست فایل (تصویر یا سند فنی)</option>
                        <option value="boolean">بله / خیر (چک‌باکس)</option>
                      </select>
                    </div>

                    {/* Conditional Select options config */}
                    {newFieldType === 'select' && (
                      <div className="space-y-1.5 md:col-span-2 bg-slate-50 p-4 rounded-xl border border-slate-150">
                        <label className="text-xs font-bold text-slate-700 block mb-1">
                          تعریف آیتم‌های لیست بازشو *
                        </label>
                        <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
                          آیتم‌هایی که کاربر نهایی در فرم قادر به انتخاب آنهاست را تعریف کنید. <strong>هر گزینه را در یک خط جداگانه بنویسید.</strong>
                        </p>
                        <textarea
                          rows={4}
                          required
                          value={newFieldOptions}
                          onChange={(e) => setNewFieldOptions(e.target.value)}
                          placeholder="مثال:&#10;آلمان&#10;ژاپن&#10;ایتالیا&#10;سوئیس"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-mono"
                        />
                      </div>
                    )}

                    {/* Numeric special options */}
                    {newFieldType === 'number' && (
                      <div className="space-y-1.5 md:col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-150 flex items-center gap-2">
                        <input
                          id="newFieldUseSeparator"
                          type="checkbox"
                          checked={newFieldUseSeparator}
                          onChange={(e) => setNewFieldUseSeparator(e.target.checked)}
                          className="w-4 h-4 text-sky-600 border-slate-300 rounded focus:ring-sky-500 cursor-pointer"
                        />
                        <label htmlFor="newFieldUseSeparator" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                          فعال‌سازی جداکننده سه رقمی برای مبالغ و مقادیر عددی
                        </label>
                      </div>
                    )}

                    {/* Field Required */}
                    <div className="space-y-1.5 md:col-span-2 flex items-center gap-2 pt-2">
                      <input
                        id="newFieldRequired"
                        type="checkbox"
                        checked={newFieldRequired}
                        onChange={(e) => setNewFieldRequired(e.target.checked)}
                        className="w-4 h-4 text-sky-600 border-slate-300 rounded focus:ring-sky-500 cursor-pointer"
                      />
                      <label htmlFor="newFieldRequired" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                        این فیلد اجباری است و تکمیل آن برای ثبت الزامی است (*)
                      </label>
                    </div>

                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
                    >
                      <Plus size={14} />
                      ثبت و اضافه کردن فیلد سفارشی
                    </button>
                  </div>
                </form>
              </div>

              {/* Fields List Table */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-4">
                <h4 className="font-bold text-slate-800 text-xs border-b border-slate-100 pb-2">فیلدهای تعریف شده فعلی ({filteredFields.length} فیلد)</h4>
                
                {filteredFields.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    هیچ فیلد سفارشی برای این ماژول تعریف نشده است.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs divide-y divide-slate-150">
                      <thead>
                        <tr className="text-slate-400 font-semibold bg-slate-50">
                          <th className="py-2.5 px-3">نام فیلد (برچسب)</th>
                          <th className="py-2.5 px-3">نوع فیلد</th>
                          <th className="py-2.5 px-3">وضعیت اعتبار سنجی</th>
                          <th className="py-2.5 px-3 text-left">عملیات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredFields.map((field) => (
                          <tr key={field.id} className="hover:bg-slate-50/50">
                            <td className="py-3 px-3 font-bold text-slate-800">{field.name}</td>
                            <td className="py-3 px-3">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[10px] font-semibold">
                                {field.type === 'text' && 'متن کوتاه'}
                                {field.type === 'textarea' && 'متن بلند'}
                                {field.type === 'number' && `عددی ${field.useSeparator ? '(با جداکننده هزارگان)' : ''}`}
                                {field.type === 'select' && `لیست بازشو (${field.options?.length || 0} گزینه)`}
                                {field.type === 'date' && 'تاریخ شمسی'}
                                {field.type === 'file' && 'پیوست فایل'}
                                {field.type === 'boolean' && 'بله/خیر (چک‌باکس)'}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              {field.required ? (
                                <span className="inline-flex px-2 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold">
                                  اجباری (*)
                                </span>
                              ) : (
                                <span className="inline-flex px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">
                                  اختیاری
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-left">
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomField(field.id)}
                                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition"
                                title="حذف فیلد سفارشی"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              </div>

            </div>

          </div>
        ) : activeTab === 'dropdowns' ? (
          /* Dropdowns Tab */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in text-right" dir="rtl">
            
            {/* Sidebar dropdown selector */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-800 text-sm border-b border-slate-100 pb-2.5">انتخاب لیست بازشو</h3>
              <p className="text-slate-400 text-[11px]">لیستی که مایل به مدیریت آیتم‌های آن هستید را انتخاب کنید:</p>
              
              <div className="space-y-1 pt-1 max-h-[60vh] overflow-y-auto">
                {allowedDropdownKeys.map((key) => {
                  const count = key === 'lossReasons' 
                    ? (settings.lossReasons || []).length 
                    : (settings.dropdownItems[key as keyof ERPSettings['dropdownItems']] || []).length;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDropdownKey(key)}
                      className={`w-full flex justify-between items-center px-3.5 py-2.5 rounded-lg text-xs font-bold transition ${
                        selectedDropdownKey === key
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/10'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{dropdownLabels[key]}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${selectedDropdownKey === key ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                        {count} مورد
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* List manager workspace */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Add Dropdown Item Form */}
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 pb-3.5 border-b border-slate-100 mb-4 text-slate-800">
                  <Plus size={18} className="text-amber-500" />
                  <h3 className="font-bold text-sm">
                    مدیریت «{dropdownLabels[selectedDropdownKey]}»
                  </h3>
                </div>

                <p className="text-slate-500 text-xs leading-relaxed mb-4">
                  {dropdownDescriptions[selectedDropdownKey]}
                </p>

                <form onSubmit={handleAddDropdownItem} className="flex gap-3 max-w-lg">
                  <input
                    type="text"
                    required
                    placeholder="عنوان آیتم جدید را وارد کنید..."
                    value={newDropdownItem}
                    onChange={(e) => setNewDropdownItem(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-right"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
                  >
                    <Plus size={14} />
                    افزودن به لیست
                  </button>
                </form>
              </div>

              {/* Items List Table */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-4">
                <h4 className="font-bold text-slate-800 text-xs border-b border-slate-100 pb-2">
                  آیتم‌های تعریف شده فعلی ({selectedDropdownKey === 'lossReasons' ? (settings.lossReasons || []).length : (settings.dropdownItems[selectedDropdownKey as keyof ERPSettings['dropdownItems']] || []).length} مورد)
                </h4>
                
                <div className="border border-slate-150 rounded-xl overflow-hidden max-w-2xl bg-slate-50/50">
                  <table className="w-full text-right border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 font-bold">
                        <th className="py-3 px-4 w-16">ردیف</th>
                        <th className="py-3 px-4">عنوان آیتم</th>
                        <th className="py-3 px-4 text-left w-32">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(selectedDropdownKey === 'lossReasons' ? (settings.lossReasons || []) : (settings.dropdownItems[selectedDropdownKey as keyof ERPSettings['dropdownItems']] || [])).map((item, idx) => {
                        const isEditing = editingDropdownIndex === idx;
                        const itemsCount = (selectedDropdownKey === 'lossReasons' ? (settings.lossReasons || []) : (settings.dropdownItems[selectedDropdownKey as keyof ERPSettings['dropdownItems']] || [])).length;
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 transition">
                            <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                            <td className="py-3 px-4 font-semibold text-slate-800">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editingDropdownValue}
                                  onChange={(e) => setEditingDropdownValue(e.target.value)}
                                  className="w-full max-w-md border border-slate-300 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none text-right font-semibold bg-white"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleSaveDropdownEdit(idx);
                                    } else if (e.key === 'Escape') {
                                      setEditingDropdownIndex(null);
                                    }
                                  }}
                                />
                              ) : (
                                item
                              )}
                            </td>
                            <td className="py-3 px-4 text-left">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveDropdownItem(idx, 'up')}
                                  className={`p-1 rounded transition ${idx === 0 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                                  title="انتقال به بالا"
                                >
                                  <ArrowUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === itemsCount - 1}
                                  onClick={() => handleMoveDropdownItem(idx, 'down')}
                                  className={`p-1 rounded transition ${idx === itemsCount - 1 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                                  title="انتقال به پایین"
                                >
                                  <ArrowDown size={14} />
                                </button>

                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveDropdownEdit(idx)}
                                      className="p-1 rounded text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition"
                                      title="ذخیره"
                                    >
                                      <Check size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingDropdownIndex(null)}
                                      className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition"
                                      title="انصراف"
                                    >
                                      <XCircle size={14} />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingDropdownIndex(idx);
                                        setEditingDropdownValue(item);
                                      }}
                                      className="p-1 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition"
                                      title="ویرایش"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDropdownItem(item)}
                                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                      title="حذف"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {(selectedDropdownKey === 'lossReasons' ? (settings.lossReasons || []) : (settings.dropdownItems[selectedDropdownKey as keyof ERPSettings['dropdownItems']] || [])).length === 0 && (
                        <tr>
                          <td colSpan={3} className="text-center py-6 text-slate-400 bg-white">
                            هیچ آیتمی در این لیست تعریف نشده است.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>

          </div>
        ) : activeTab === 'activityCategories' ? (
          /* Activity Categories & System Categories Tab */
          <div className="space-y-6">
            {/* Custom Activity Categories Card */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-150 text-slate-800">
                <Sliders size={18} className="text-sky-500" />
                <h3 className="font-bold text-sm">۱. دسته‌بندی‌های اختصاصی فعالیت پروژه</h3>
              </div>
              
              <p className="text-slate-500 text-xs leading-relaxed">
                دسته‌بندی‌های مشخص‌شده در این بخش، ساختار ثبت فعالیت‌های روزانه، گزارش کار، تماس‌ها و ارجاعات همکاران در هر پروژه را تشکیل می‌دهند. کاربران برای هر پروژه فقط قادر به ثبت فعالیت در این دسته‌های مشخص خواهند بود و از ایجاد دسته‌بندی تکراری و متفرقه ممانعت به عمل می‌آید.
              </p>

              <form onSubmit={handleAddCategory} className="flex gap-3 max-w-lg">
                <input
                  type="text"
                  placeholder="مثال: پیگیری استعلام قیمت، تست فنی کارگاهی، ارسال مدارک نهایی"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  required
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-right"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Plus size={14} />
                  افزودن دسته‌بندی جدید
                </button>
              </form>

              {/* Desktop View */}
              <div className="hidden md:block border border-slate-150 rounded-xl overflow-hidden max-w-2xl bg-slate-50/50">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 font-bold">
                      <th className="py-3 px-4">ردیف</th>
                      <th className="py-3 px-4">نام دسته‌بندی فعالیت</th>
                      <th className="py-3 px-4">مسئول (تایید کننده اقدامات)</th>
                      <th className="py-3 px-4">وضعیت استفاده در پروژه‌ها</th>
                      <th className="py-3 px-4 text-left">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(settings.activityCategories || []).map((cat, idx) => {
                      const isUsed = (projectCategoryGroups || []).some(g => g.categoryId === cat.id);
                      return (
                        <tr key={cat.id} className="hover:bg-white transition bg-white/40">
                          <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-3 px-4 font-semibold text-slate-800">{cat.name}</td>
                          <td className="py-3 px-4">
                            <select
                              className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1 outline-none focus:border-sky-500 bg-white"
                              value={cat.responsibleUserId || ''}
                              onChange={(e) => {
                                const updatedCats = (settings.activityCategories || []).map(c => 
                                  c.id === cat.id ? { ...c, responsibleUserId: e.target.value } : c
                                );
                                updateSettings({ ...settings, activityCategories: updatedCats });
                              }}
                            >
                              <option value="">بدون مسئول خاص</option>
                              {users?.map(u => (
                                <option key={u.id} value={u.fullName}>{u.fullName}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 px-4">
                            {isUsed ? (
                              <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-bold text-[10px]">
                                استفاده شده (غیرقابل حذف)
                              </span>
                            ) : (
                              <span className="text-slate-400 font-medium">بدون استفاده</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-left">
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat.id, cat.name)}
                              disabled={isUsed}
                              className={`p-1 rounded transition ${
                                isUsed 
                                  ? 'text-slate-300 cursor-not-allowed bg-slate-50' 
                                  : 'text-rose-500 hover:text-rose-700 hover:bg-rose-50'
                              }`}
                              title={isUsed ? 'این دسته‌بندی در پروژه‌ها استفاده شده و قابل حذف نیست.' : 'حذف دسته‌بندی'}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {(settings.activityCategories || []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-6 text-slate-400 bg-white">
                          هیچ دسته‌بندی فعالیتی تعریف نشده است. لطفاً حداقل یک مورد را بیفزایید.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="md:hidden space-y-4">
                {(settings.activityCategories || []).map((cat, idx) => {
                  const isUsed = (projectCategoryGroups || []).some(g => g.categoryId === cat.id);
                  return (
                    <div key={`mob-${cat.id}`} className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-sm relative">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <span className="text-slate-400 font-mono text-[10px]">ردیف {idx + 1}</span>
                          <h4 className="font-bold text-slate-800 text-sm">{cat.name}</h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat.id, cat.name)}
                          disabled={isUsed}
                          className={`p-1.5 rounded-lg transition ${
                            isUsed 
                              ? 'text-slate-300 cursor-not-allowed bg-slate-50' 
                              : 'text-rose-500 hover:text-rose-700 hover:bg-rose-50'
                          }`}
                          title={isUsed ? 'این دسته‌بندی در پروژه‌ها استفاده شده و قابل حذف نیست.' : 'حذف دسته‌بندی'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <span className="text-xs text-slate-500 block mb-1 font-semibold">مسئول (تایید کننده اقدامات)</span>
                          <select
                            className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-2 outline-none focus:border-sky-500 bg-white"
                            value={cat.responsibleUserId || ''}
                            onChange={(e) => {
                              const updatedCats = (settings.activityCategories || []).map(c => 
                                c.id === cat.id ? { ...c, responsibleUserId: e.target.value } : c
                              );
                              updateSettings({ ...settings, activityCategories: updatedCats });
                            }}
                          >
                            <option value="">بدون مسئول خاص</option>
                            {users?.map(u => (
                              <option key={u.id} value={u.fullName}>{u.fullName}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                          <span className="text-xs text-slate-500 font-semibold">وضعیت</span>
                          {isUsed ? (
                            <span className="text-amber-600 bg-amber-100 px-2.5 py-1 rounded-md font-bold text-[10px]">
                              استفاده شده
                            </span>
                          ) : (
                            <span className="text-slate-400 font-medium text-[10px]">بدون استفاده</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(settings.activityCategories || []).length === 0 && (
                  <div className="text-center py-6 text-slate-400 bg-white border border-slate-200 rounded-xl text-xs font-medium">
                    هیچ دسته‌بندی فعالیتی تعریف نشده است. لطفاً حداقل یک مورد را بیفزایید.
                  </div>
                )}
              </div>
            </div>

            {/* System Categories Card */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-150 text-slate-800">
                <UserCog size={18} className="text-indigo-500" />
                <h3 className="font-bold text-sm">۲. دسته‌بندی‌های سیستمی نرم‌افزار (مسئولین ماژول‌ها)</h3>
              </div>
              
              <p className="text-slate-500 text-xs leading-relaxed">
                این دسته‌بندی‌ها به صورت پیش‌فرض در هسته سیستم تعریف شده‌اند و فرآیندهای اصلی نرم‌افزار را پوشش می‌دهند. با تعیین مسئول برای هر کدام، اعلان‌ها و وظایف خودکار آن ماژول به شخص مشخص شده ارجاع داده خواهد شد.
              </p>

              {/* Desktop View */}
              <div className="hidden md:block border border-slate-150 rounded-xl overflow-hidden max-w-2xl bg-slate-50/50">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 font-bold">
                      <th className="py-3 px-4">ردیف</th>
                      <th className="py-3 px-4">نام دسته‌بندی سیستمی</th>
                      <th className="py-3 px-4">توضیحات فرآیند</th>
                      <th className="py-3 px-4">نوع</th>
                      <th className="py-3 px-4">مسئول (دریافت‌کننده ارجاعات و اعلان‌ها)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      { id: 'customers', name: 'مشتریان', desc: 'مدیریت خریداران و مخاطبین' },
                      { id: 'projects', name: 'پروژه‌ها (فرصت‌ها)', desc: 'پیش‌برد پروژه‌ها و پیگیری فرصت‌ها' },
                      { id: 'products', name: 'کالاها و تجهیزات', desc: 'کاتالوگ کالاها و تجهیزات فنی' },
                      { id: 'proformas', name: 'پیش‌فاکتورها', desc: 'صدور و پیگیری پیش‌فاکتورها' },
                      { id: 'suppliers', name: 'تأمین‌کنندگان', desc: 'مدیریت و ارزیابی تأمین‌کنندگان کالا' },
                      { id: 'supplierInquiries', name: 'استعلام قیمت تأمین‌کنندگان', desc: 'ثبت و پیگیری استعلام‌های قیمتی' },
                      { id: 'purchaseOrders', name: 'سفارشات خرید خارجی', desc: 'سفارشات خرید قطعی از خارج کشور' },
                      { id: 'packagingDelivery', name: 'بسته‌بندی و تحویل کالا', desc: 'فرآیند آماده‌سازی و ارسال کالا' },
                      { id: 'afterSalesServices', name: 'خدمات پس از فروش', desc: 'پیگیری گارانتی و تعمیرات کالا' },
                      { id: 'transactions', name: 'تراکنش‌های مالی', desc: 'ثبت اسناد دریافتی، پرداختی و مالی' }
                    ].map((mod, idx) => {
                      return (
                        <tr key={mod.id} className="hover:bg-white transition bg-white/40">
                          <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-3 px-4 font-semibold text-slate-800">{mod.name}</td>
                          <td className="py-3 px-4 text-slate-500">{mod.desc}</td>
                          <td className="py-3 px-4">
                            <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold text-[10px]">
                              سیستمی
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <select
                              value={settings.moduleResponsibles?.[mod.id] || ''}
                              onChange={(e) => {
                                updateSettings({
                                  ...settings,
                                  moduleResponsibles: {
                                    ...(settings.moduleResponsibles || {}),
                                    [mod.id]: e.target.value
                                  }
                                });
                              }}
                              className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1 outline-none focus:border-indigo-500 bg-white"
                            >
                              <option value="">بدون مسئول مشخص</option>
                              {users.map(u => (
                                <option key={u.id} value={u.fullName}>
                                  {u.fullName} ({u.role === 'admin' ? 'مدیر' : 'کاربر'})
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="md:hidden space-y-4">
                {[
                  { id: 'customers', name: 'مشتریان', desc: 'مدیریت خریداران و مخاطبین' },
                  { id: 'projects', name: 'پروژه‌ها (فرصت‌ها)', desc: 'پیش‌برد پروژه‌ها و پیگیری فرصت‌ها' },
                  { id: 'products', name: 'کالاها و تجهیزات', desc: 'کاتالوگ کالاها و تجهیزات فنی' },
                  { id: 'proformas', name: 'پیش‌فاکتورها', desc: 'صدور و پیگیری پیش‌فاکتورها' },
                  { id: 'suppliers', name: 'تأمین‌کنندگان', desc: 'مدیریت و ارزیابی تأمین‌کنندگان کالا' },
                  { id: 'supplierInquiries', name: 'استعلام قیمت تأمین‌کنندگان', desc: 'ثبت و پیگیری استعلام‌های قیمتی' },
                  { id: 'purchaseOrders', name: 'سفارشات خرید خارجی', desc: 'سفارشات خرید قطعی از خارج کشور' },
                  { id: 'packagingDelivery', name: 'بسته‌بندی و تحویل کالا', desc: 'فرآیند آماده‌سازی و ارسال کالا' },
                  { id: 'afterSalesServices', name: 'خدمات پس از فروش', desc: 'پیگیری گارانتی و تعمیرات کالا' },
                  { id: 'transactions', name: 'تراکنش‌های مالی', desc: 'ثبت اسناد دریافتی، پرداختی و مالی' }
                ].map((mod, idx) => {
                  return (
                    <div key={`sys-mob-${mod.id}`} className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-sm relative">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <span className="text-slate-400 font-mono text-[10px]">ردیف {idx + 1}</span>
                          <h4 className="font-bold text-slate-800 text-sm">{mod.name}</h4>
                          <p className="text-[11px] text-slate-500">{mod.desc}</p>
                        </div>
                        <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold text-[9px]">
                          سیستمی
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <span className="text-xs text-slate-500 block mb-1 font-semibold">مسئول (دریافت‌کننده ارجاعات و اعلان‌ها)</span>
                          <select
                            value={settings.moduleResponsibles?.[mod.id] || ''}
                            onChange={(e) => {
                              updateSettings({
                                ...settings,
                                moduleResponsibles: {
                                  ...(settings.moduleResponsibles || {}),
                                  [mod.id]: e.target.value
                                }
                              });
                            }}
                            className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-2 outline-none focus:border-indigo-500 bg-white"
                          >
                            <option value="">بدون مسئول مشخص</option>
                            {users.map(u => (
                              <option key={u.id} value={u.fullName}>
                                {u.fullName} ({u.role === 'admin' ? 'مدیر' : 'کاربر'})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : activeTab === 'sidebarOrder' ? (
          /* Sidebar Module Order Tab */
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-150 pb-4">
              <div className="flex items-center gap-2 text-slate-800">
                <Menu size={18} className="text-sky-500" />
                <div>
                  <h3 className="font-bold text-sm">ترتیب چیدمان منوی سایدبار</h3>
                  <p className="text-slate-400 text-[11px] mt-0.5">ترتیب نمایش ماژول‌ها در سایدبار سمت راست را به سلیقه خود تنظیم کنید.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm('آیا مایلید ترتیب منو به حالت پیش‌فرض سیستم بازگردد؟')) {
                    updateSettings({
                      ...settings,
                      sidebarModuleOrder: [
                        'dashboard',
                        'customers',
                        'projects',
                        'proformas',
                        'products',
                        'suppliers',
                        'supplierInquiries',
                        'purchaseOrders',
                        'packagingDelivery',
                        'afterSalesServices',
                        'transactions',
                        
                        'tasks',
                        'referrals',
                        'users',
                        'settings'
                      ]
                    });
                  }
                }}
                className="px-3 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 hover:border-rose-300 rounded-lg transition font-semibold"
              >
                بازنشانی به چیدمان پیش‌فرض
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(() => {
                const ALL_MODULES = [
                  { id: 'dashboard', name: 'داشبورد', desc: 'خلاصه وضعیت، آمارهای کلیدی و نمودارهای سریع سیستم', icon: LayoutDashboard },
                  { id: 'customers', name: 'مشتریان', desc: 'مدیریت پرونده‌های خریداران حقیقی و حقوقی و ارتباطات آن‌ها', icon: Users },
                  { id: 'projects', name: 'پروژه‌ها (فرصت‌ها)', desc: 'کنترل فازها، فعالیت‌ها و ارجاعات مربوط به هر فرصت تجاری', icon: Briefcase },
                  { id: 'proformas', name: 'پیش‌فاکتورها', desc: 'صدور و پیگیری پیشنهادهای مالی فنی برای مشتریان', icon: FileText },
                  { id: 'products', name: 'کالاها و تجهیزات', desc: 'انبارداری، موجودی کالاها و ابزار دقیق شرکت', icon: Package },
                  { id: 'suppliers', name: 'تأمین‌کنندگان', desc: 'مدیریت وندورها و سازندگان داخلی و خارجی کالا', icon: Truck },
                  { id: 'supplierInquiries', name: 'استعلام قیمت تأمین‌کنندگان', desc: 'ثبت و پیگیری استعلام قیمت از همکاران و وندورهای خارجی', icon: ArrowLeftRight },
                  { id: 'purchaseOrders', name: 'سفارشات خرید خارجی', desc: 'پیگیری مراحل پروفرمای خرید، حمل و ترخیص گمرکی', icon: ShoppingCart },
                  { id: 'packagingDelivery', name: 'بسته‌بندی و تحویل کالا', desc: 'مدیریت پکینگ‌لیست‌ها و تحویل محموله‌ها به مشتری', icon: Boxes },
                  { id: 'afterSalesServices', name: 'خدمات پس از فروش', desc: 'رسیدگی به درخواست‌ها و پشتیبانی پس از فروش و گارانتی', icon: Wrench },
                  { id: 'transactions', name: 'دریافت و پرداخت ریالی', desc: 'ثبت و کنترل تراکنش‌های مالی ریالی و صندوق شرکت', icon: ArrowDownLeft },
                
                  { id: 'tasks', name: 'وظایف و پیگیری', desc: 'مدیریت کارها، ددلاین‌ها و پیگیری‌های پرسنل فروش و فنی', icon: CheckSquare },
                  { id: 'referrals', name: 'کارتابل ارجاعات کار', desc: 'صندوق ورودی ارجاع امور فنی و بازرگانی پروژه‌ها بین همکاران', icon: Inbox },
                  { id: 'users', name: 'مدیریت کاربران', desc: 'تعریف پرسنل، نقش‌ها و تنظیمات دسترسی به هر ماژول', icon: ShieldCheck },
                  { id: 'settings', name: 'تنظیمات سیستم', desc: 'شخصی‌سازی فیلدها، دسته‌بندی‌ها و قالب‌های اسناد رسمی', icon: Settings },
                ];

                const currentOrder = [...(settings.sidebarModuleOrder || [])];
                ALL_MODULES.forEach(m => {
                  if (!currentOrder.includes(m.id)) {
                    currentOrder.push(m.id);
                  }
                });

                return currentOrder.map((id, index) => {
                  const mod = ALL_MODULES.find(m => m.id === id);
                  if (!mod) return null;
                  const IconComponent = mod.icon;
                  const isFirst = index === 0;
                  const isLast = index === currentOrder.length - 1;

                  const handleMoveModule = (direction: 'up' | 'down') => {
                    const newOrder = [...currentOrder];
                    const targetIndex = direction === 'up' ? index - 1 : index + 1;
                    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
                    
                    // Swap elements
                    const temp = newOrder[index];
                    newOrder[index] = newOrder[targetIndex];
                    newOrder[targetIndex] = temp;

                    updateSettings({
                      ...settings,
                      sidebarModuleOrder: newOrder
                    });
                  };

                  const handleDragStart = (e: React.DragEvent) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index.toString());
                    setDraggedModuleId(id);
                  };

                  const handleDragOver = (e: React.DragEvent) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  };

                  const handleDrop = (e: React.DragEvent) => {
                    e.preventDefault();
                    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    if (sourceIndex === index || isNaN(sourceIndex)) return;

                    const newOrder = [...currentOrder];
                    const [removed] = newOrder.splice(sourceIndex, 1);
                    newOrder.splice(index, 0, removed);

                    updateSettings({
                      ...settings,
                      sidebarModuleOrder: newOrder
                    });
                    setDraggedModuleId(null);
                  };

                  const handleDragEnd = () => {
                    setDraggedModuleId(null);
                  };

                  const isDragging = draggedModuleId === id;

                  return (
                    <div 
                      key={id} 
                      draggable
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center justify-between p-4 bg-slate-50 border rounded-xl transition duration-150 group cursor-move ${
                        isDragging ? 'opacity-40 border-sky-400 bg-sky-50' : 'border-slate-200/80 hover:border-sky-200 hover:bg-sky-50/10'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Drag Handle */}
                        <div className="flex items-center justify-center mt-1 text-slate-300 group-hover:text-sky-500 transition">
                          <GripVertical size={16} />
                        </div>
                        
                        {/* Order Badge */}
                        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-slate-200/60 group-hover:bg-sky-100 text-[11px] font-extrabold text-slate-500 group-hover:text-sky-700 transition">
                          {index + 1}
                        </div>

                        {/* Module Icon & Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="p-1 rounded-md bg-white border border-slate-200 text-slate-600">
                              <IconComponent size={14} />
                            </div>
                            <span className="text-xs font-bold text-slate-800">{mod.name}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed truncate" title={mod.desc}>
                            {mod.desc}
                          </p>
                        </div>
                      </div>

                      {/* Control Buttons (Fallback for accessibility) */}
                      <div className="flex flex-col gap-1 shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={() => handleMoveModule('up')}
                          className={`p-1 rounded-md border transition ${
                            isFirst 
                              ? 'text-slate-300 border-slate-100 bg-slate-50/50 cursor-not-allowed' 
                              : 'text-slate-600 border-slate-200 bg-white hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200'
                          }`}
                          title="انتقال به بالا"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={() => handleMoveModule('down')}
                          className={`p-1 rounded-md border transition ${
                            isLast 
                              ? 'text-slate-300 border-slate-100 bg-slate-50/50 cursor-not-allowed' 
                              : 'text-slate-600 border-slate-200 bg-white hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200'
                          }`}
                          title="انتقال به پایین"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        ) : activeTab === 'adminNotifications' && userRole === 'admin' && currentUser ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-150 pb-4">
              <div className="flex items-center gap-2 text-slate-800">
                <Bell size={18} className="text-rose-500" />
                <div>
                  <h3 className="font-bold text-sm">تنظیمات اعلان‌های سیستم (مخصوص مدیر)</h3>
                  <p className="text-slate-400 text-[11px] mt-0.5">مدیریت دریافت اعلان‌های تمام ماژول‌ها و پروژه‌ها</p>
                </div>
              </div>
            </div>

            <div className="space-y-6 max-w-xl">
              <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="space-y-1">
                  <span className="text-sm font-bold text-slate-700 block">دریافت همه اعلان‌ها</span>
                  <span className="text-xs text-slate-500 block">آیا می‌خواهید اعلان تمامی بخش‌ها و پروژه‌ها را دریافت کنید؟</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const currentPrefs = settings.adminNotificationPreferences || {};
                    const userPrefs = currentPrefs[currentUser.id] || { receiveAll: true, importantProjectIds: [] };
                    
                    updateSettings({
                      ...settings,
                      adminNotificationPreferences: {
                        ...currentPrefs,
                        [currentUser.id]: {
                          ...userPrefs,
                          receiveAll: !userPrefs.receiveAll
                        }
                      }
                    });
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative ${
                    (settings.adminNotificationPreferences?.[currentUser.id]?.receiveAll ?? true) 
                      ? 'bg-emerald-500' 
                      : 'bg-slate-300'
                  }`}
                >
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                    (settings.adminNotificationPreferences?.[currentUser.id]?.receiveAll ?? true) 
                      ? 'left-1' 
                      : 'left-7'
                  }`} />
                </button>
              </div>

              {!(settings.adminNotificationPreferences?.[currentUser.id]?.receiveAll ?? true) && (
                <div className="bg-white p-4 rounded-xl border border-slate-100 space-y-4">
                  <div className="space-y-1">
                    <span className="text-sm font-bold text-slate-700 block">پروژه‌های مهم</span>
                    <span className="text-xs text-slate-500 block">در صورتی که دریافت همه اعلان‌ها غیرفعال باشد، فقط اعلان‌های مربوط به پروژه‌های انتخاب شده زیر را دریافت خواهید کرد.</span>
                  </div>
                  
                  <div className="space-y-2 mt-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {projects.map(proj => {
                      const userPrefs = settings.adminNotificationPreferences?.[currentUser.id] || { receiveAll: false, importantProjectIds: [] };
                      const isSelected = userPrefs.importantProjectIds.includes(proj.id);
                      
                      return (
                        <label key={proj.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const newImportant = e.target.checked
                                ? [...userPrefs.importantProjectIds, proj.id]
                                : userPrefs.importantProjectIds.filter(id => id !== proj.id);
                                
                              updateSettings({
                                ...settings,
                                adminNotificationPreferences: {
                                  ...(settings.adminNotificationPreferences || {}),
                                  [currentUser.id]: {
                                    ...userPrefs,
                                    importantProjectIds: newImportant
                                  }
                                }
                              });
                            }}
                            className="rounded text-sky-500 focus:ring-sky-500 w-4 h-4"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-bold text-slate-700 block">{proj.name} ({proj.code})</span>
                            <span className="text-[10px] text-slate-500">{proj.code} - {proj.customerName}</span>
                          </div>
                        </label>
                      );
                    })}
                    {projects.length === 0 && (
                      <div className="text-center p-4 text-xs text-slate-500 bg-slate-50 rounded-lg">
                        هیچ پروژه‌ای در سیستم ثبت نشده است.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'deliveryChecklist' ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-150 text-slate-800">
              <FileCheck size={18} className="text-emerald-500" />
              <h3 className="font-bold text-sm">چک‌لیست تحویل کالا (الگو)</h3>
            </div>
            
            <p className="text-slate-500 text-xs leading-relaxed">
              در این بخش می‌توانید آیتم‌های پیش‌فرضی که همکاران باید هنگام بسته‌بندی و تحویل کالا بررسی و تیک بزنند را تعریف کنید.
            </p>
            
            <div className="space-y-4 max-w-xl">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const formData = new FormData(form);
                  const text = formData.get('itemText') as string;
                  if (!text.trim()) return;
                  
                  const currentTemplate = settings.deliveryChecklistTemplate || [];
                  const newItem = text.trim();
                  
                  updateSettings({
                    ...settings,
                    deliveryChecklistTemplate: [...currentTemplate, newItem]
                  });
                  form.reset();
                }}
                className="flex gap-2"
              >
                <input 
                  type="text" 
                  name="itemText"
                  required
                  placeholder="آیتم جدید چک‌لیست (مثال: بررسی صحت پلاک مشخصات کالا)"
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
                <button 
                  type="submit"
                  className="bg-sky-500 hover:bg-sky-600 text-white rounded-xl px-4 py-2 text-xs font-bold transition flex items-center gap-1 shrink-0"
                >
                  <Plus size={14} />
                  افزودن به الگو
                </button>
              </form>

              <div className="border border-slate-150 rounded-xl overflow-hidden bg-slate-50/30">
                {settings.deliveryChecklistTemplate && settings.deliveryChecklistTemplate.length > 0 ? (
                  <div className="divide-y divide-slate-150">
                    {settings.deliveryChecklistTemplate.map((item, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-white text-slate-700 hover:bg-slate-50 transition">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-slate-400">{index + 1}.</span>
                          <span className="text-xs font-medium text-slate-700">{item}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = settings.deliveryChecklistTemplate.filter((_, idx) => idx !== index);
                            updateSettings({
                              ...settings,
                              deliveryChecklistTemplate: updated
                            });
                          }}
                          className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition"
                          title="حذف آیتم"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    آیتمی در چک‌لیست تعریف نشده است. لطفاً آیتم‌های مورد نیاز خود را به الگو اضافه کنید.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'auditLog' ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-150">
              <div className="flex items-center gap-2 text-slate-800">
                <History size={18} className="text-violet-500" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900">دفتر ثبت سوابق و لاگ تغییرات سیستم (System Audit Log)</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">ثبت و بایگانی تمام اقدامات کاربران به همراه تغییرات فیلدها با فشرده‌سازی فشرده LZW</p>
                </div>
              </div>
              <div className="text-[10px] bg-slate-100 border border-slate-200/80 px-2.5 py-1 rounded font-bold text-slate-600">
                مجموع لاگ‌های ثبت شده: {auditLogs.length.toLocaleString('fa-IR')} مورد
              </div>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">جستجو در توضیحات</label>
                <input
                  type="text"
                  placeholder="جستجوی کلمه کلیدی..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">فیلتر بخش/ماژول</label>
                <select
                  value={logModuleFilter}
                  onChange={(e) => setLogModuleFilter(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none bg-white font-medium"
                >
                  <option value="all">همه بخش‌ها</option>
                  <option value="مشتریان">مشتریان</option>
                  <option value="پروژه‌ها">پروژه‌ها</option>
                  <option value="کالاها و تجهیزات">کالاها و تجهیزات</option>
                  <option value="تأمین‌کنندگان">تأمین‌کنندگان</option>
                  <option value="پیش‌فاکتورها">پیش‌فاکتورها</option>
                  <option value="فعالیت پروژه‌ها">فعالیت پروژه‌ها</option>
                  <option value="وظایف/پیگیری‌ها">وظایف/پیگیری‌ها</option>
                  <option value="بسته‌بندی و ارسال">بسته‌بندی و ارسال</option>
                  <option value="خدمات پس از فروش">خدمات پس از فروش</option>
                  <option value="ارز و نرخ برابری">ارز و نرخ برابری</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">فیلتر نوع تغییر</label>
                <select
                  value={logActionFilter}
                  onChange={(e) => setLogActionFilter(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none bg-white font-medium"
                >
                  <option value="all">همه تغییرات</option>
                  <option value="CREATE">ایجاد جدید (CREATE)</option>
                  <option value="UPDATE">ویرایش و تغییرات (UPDATE)</option>
                  <option value="DELETE">حذف اطلاعات (DELETE)</option>
                </select>
              </div>
            </div>

            {/* List of Logs */}
            <div className="space-y-3">
              {(() => {
                const filtered = auditLogs.filter(log => {
                  const matchSearch = !logSearch || 
                    (log.description || '').toLowerCase().includes(logSearch.toLowerCase()) || 
                    (log.userFullName || '').toLowerCase().includes(logSearch.toLowerCase()) || 
                    (log.entityId || '').toLowerCase().includes(logSearch.toLowerCase());
                  const matchModule = logModuleFilter === 'all' || log.module === logModuleFilter;
                  const matchAction = logActionFilter === 'all' || log.action === logActionFilter;
                  return matchSearch && matchModule && matchAction;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                      هیچ لاگ یا سابقه‌ای یافت نشد.
                    </div>
                  );
                }

                // Internal human-readable field comparison helper
                const renderObjectDiff = (compressedBefore?: string, compressedAfter?: string, action?: string) => {
                  let beforeObj: any = null;
                  let afterObj: any = null;

                  if (compressedBefore) {
                    try {
                      const raw = decompressLZW(compressedBefore);
                      beforeObj = raw ? JSON.parse(raw) : null;
                    } catch (e) {
                      console.error("Failed to parse decompressed beforeState:", e);
                    }
                  }

                  if (compressedAfter) {
                    try {
                      const raw = decompressLZW(compressedAfter);
                      afterObj = raw ? JSON.parse(raw) : null;
                    } catch (e) {
                      console.error("Failed to parse decompressed afterState:", e);
                    }
                  }

                  if (!beforeObj && !afterObj) {
                    return (
                      <span className="text-slate-400 text-[10px]">اطلاعات جزئی بیشتری برای این عملیات موجود نیست.</span>
                    );
                  }

                  if (action === 'DELETE' && beforeObj) {
                    return (
                      <div className="bg-rose-50/40 border border-rose-100 rounded-lg p-3 text-xs space-y-2 text-right">
                        <span className="font-bold text-rose-800 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                          مشخصات رکورد حذف شده:
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-white p-2.5 rounded border border-rose-100/50 text-slate-600 font-medium leading-relaxed max-h-48 overflow-y-auto">
                          {Object.entries(beforeObj)
                            .filter(([_, v]) => v !== null && v !== undefined && typeof v !== 'object')
                            .map(([k, v]) => {
                              const labelMap: Record<string, string> = {
                                name: 'نام', title: 'عنوان', code: 'کد سند', description: 'توضیحات',
                                customerName: 'مشتری', totalAmount: 'مبلغ کل', phone: 'تلفن'
                              };
                              return (
                                <div key={k} className="flex justify-between border-b border-slate-100 pb-1">
                                  <span className="text-slate-400">{labelMap[k] || k}:</span>
                                  <span className="text-slate-700 font-mono" style={{ unicodeBidi: 'plaintext' }}>{String(v)}</span>
                                </div>
                              );
                            })
                          }
                        </div>
                      </div>
                    );
                  }

                  if (action === 'CREATE' && afterObj) {
                    return (
                      <div className="bg-emerald-50/40 border border-emerald-100 rounded-lg p-3 text-xs space-y-2 text-right">
                        <span className="font-bold text-emerald-800 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                          مشخصات رکورد ثبت شده:
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-white p-2.5 rounded border border-emerald-100/50 text-slate-600 font-medium leading-relaxed max-h-48 overflow-y-auto">
                          {Object.entries(afterObj)
                            .filter(([_, v]) => v !== null && v !== undefined && typeof v !== 'object')
                            .map(([k, v]) => {
                              const labelMap: Record<string, string> = {
                                name: 'نام', title: 'عنوان', code: 'کد سند', description: 'توضیحات',
                                customerName: 'مشتری', totalAmount: 'مبلغ کل', phone: 'تلفن'
                              };
                              return (
                                <div key={k} className="flex justify-between border-b border-slate-100 pb-1">
                                  <span className="text-slate-400">{labelMap[k] || k}:</span>
                                  <span className="text-slate-700 font-mono" style={{ unicodeBidi: 'plaintext' }}>{String(v)}</span>
                                </div>
                              );
                            })
                          }
                        </div>
                      </div>
                    );
                  }

                  if (action === 'UPDATE' && (beforeObj || afterObj)) {
                    const diffs: { field: string; from: string; to: string }[] = [];
                    const fieldMap: Record<string, string> = {
                      name: 'نام',
                      title: 'عنوان',
                      text: 'متن',
                      status: 'وضعیت',
                      description: 'توضیحات',
                      phone: 'تلفن',
                      email: 'ایمیل',
                      address: 'آدرس',
                      industry: 'صنعت',
                      financialContact: 'رابط مالی',
                      technicalContact: 'رابط فنی',
                      salesExpert: 'کارشناس فروش',
                      price: 'قیمت',
                      quantity: 'تعداد',
                      stockLevel: 'موجودی انبار',
                      buyingPrice: 'قیمت خرید',
                      sellingPrice: 'قیمت فروش',
                      currency: 'واحد پولی',
                      totalAmount: 'مبلغ کل',
                      assignedTo: 'ارجاع به / کارشناس مسئول',
                      actionRequired: 'اقدام مورد نیاز',
                      assignedBy: 'ارجاع‌دهنده',
                      companyName: 'نام شرکت',
                      economicCode: 'کد اقتصادی',
                      nationalCode: 'شناسه ملی',
                      registrationNumber: 'شماره ثبت'
                    };

                    const bKeys = beforeObj ? Object.keys(beforeObj) : [];
                    const aKeys = afterObj ? Object.keys(afterObj) : [];
                    const allKeys = Array.from(new Set([...bKeys, ...aKeys]));

                    for (const key of allKeys) {
                      if (['id', 'createdAt', 'updatedAt', 'creationDate', 'lastActive', 'password'].includes(key)) continue;
                      const valBefore = beforeObj?.[key];
                      const valAfter = afterObj?.[key];
                      
                      if (typeof valBefore === 'object' || typeof valAfter === 'object') continue;

                      if (valBefore !== valAfter) {
                        diffs.push({
                          field: fieldMap[key] || key,
                          from: valBefore !== undefined && valBefore !== null && valBefore !== '' ? String(valBefore) : '—',
                          to: valAfter !== undefined && valAfter !== null && valAfter !== '' ? String(valAfter) : '—'
                        });
                      }
                    }

                    if (diffs.length === 0) {
                      return (
                        <span className="text-slate-400 text-[10px]">تغییراتی در فیلدهای اصلی شناسایی نشد یا تغییرات مربوط به جداول فرعی است.</span>
                      );
                    }

                    return (
                      <div className="bg-amber-50/30 border border-amber-100 rounded-lg p-3 text-xs space-y-2 text-right">
                        <span className="font-bold text-amber-800 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
                          فیلدهای تغییر یافته:
                        </span>
                        <div className="space-y-2">
                          {diffs.map((d, index) => (
                            <div key={index} className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-100 font-medium">
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">{d.field}</span>
                              <span className="text-slate-400">از</span>
                              <span className="text-rose-600 line-through bg-rose-50/50 px-1 rounded font-mono">{d.from}</span>
                              <span className="text-slate-400">← به</span>
                              <span className="text-emerald-700 bg-emerald-50 px-1 rounded font-bold font-mono">{d.to}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return null;
                };

                return (
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-150">
                    {filtered.map((log) => {
                      const isExpanded = expandedLogId === log.id;
                      return (
                        <div key={log.id} className="bg-white hover:bg-slate-50/50 transition duration-150">
                          {/* Log Main Bar */}
                          <div
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3">
                              {/* Action Badge */}
                              <span className={`px-2 py-1 rounded text-[9px] font-bold tracking-wider font-mono shrink-0 ${
                                log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                log.action === 'UPDATE' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                'bg-rose-100 text-rose-800 border border-rose-200'
                              }`}>
                                {log.action}
                              </span>

                              {/* Module Badge */}
                              <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">
                                {log.module}
                              </span>

                              {/* Action Description */}
                              <span className="text-slate-700 font-semibold text-xs leading-relaxed">
                                {log.description}
                              </span>
                            </div>

                            {/* Metadata */}
                            <div className="flex items-center gap-3 text-[10px] text-slate-400 mr-auto shrink-0 font-medium">
                              {/* User Info */}
                              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                                <UserCog size={10} className="text-slate-500" />
                                {log.userFullName}
                              </span>

                              {/* Date Time */}
                              <span className="font-mono bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                                {log.timestamp}
                              </span>
                            </div>
                          </div>

                          {/* Expanded Details Diff */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 bg-slate-50/30 border-t border-slate-150 animate-fade-in space-y-3">
                              {renderObjectDiff(log.beforeState, log.afterState, log.action)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : activeTab === 'workflows' ? (
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-lg text-slate-800">قوانین گردش‌کار هوشمند (ورک‌فلو)</h3>
                <p className="text-slate-500 text-xs mt-1">
                  اتوماسیون اقدامات سیستمی مانند ایجاد وظایف یا ارسال اعلان‌های خودکار بر اساس رویدادهای سیستم
                </p>
              </div>
              {!isRuleFormOpen && (
                <button
                  onClick={() => {
                    setEditingRule({
                      id: `new-${Date.now()}`,
                      name: '',
                      active: true,
                      triggerType: 'proforma_outcome_change',
                      conditions: [
                        { field: 'newOutcome', operator: 'equals', value: 'تأیید شده (برنده)' }
                      ],
                      actions: [
                        {
                          type: 'create_task',
                          taskConfig: {
                            titleTemplate: 'پیگیری سفارش خرید پروژه {projectName}',
                            descTemplate: 'پیش‌فاکتور شماره {proformaNumber} برنده شده است. لطفا هماهنگی‌های لازم جهت ثبت سفارش خرید خارجی را انجام دهید.',
                            assignedTo: 'MODULE_RESPONSIBLE_purchaseOrders',
                            priority: 'بالا',
                            dueDaysOffset: 3
                          }
                        }
                      ]
                    });
                    setIsRuleFormOpen(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl text-xs md:text-sm flex items-center gap-2 transition-all shadow-sm"
                >
                  <Plus size={16} />
                  ایجاد قانون جدید
                </button>
              )}
            </div>

            {isRuleFormOpen && editingRule ? (
              <form onSubmit={handleSaveWorkflowRule} className="space-y-6 bg-slate-50/50 p-6 rounded-2xl border border-slate-200 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-700 text-xs font-bold mb-2">نام قانون ورک‌فلو <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={editingRule.name}
                      onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                      placeholder="مثال: ایجاد خودکار تسک سفارش خرید پس از برنده شدن پیش‌فاکتور"
                      className="w-full text-xs md:text-sm border border-slate-200 rounded-xl p-3 focus:outline-none focus:border-sky-500 bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 text-xs font-bold mb-2">نوع رویداد تحریک‌کننده (Trigger)</label>
                    <select
                      value={editingRule.triggerType}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        let defaultField = 'status';
                        let defaultValue = '';
                        if (val.endsWith('_status_change')) {
                          defaultField = 'newStatus';
                        } else if (val.endsWith('_outcome_change')) {
                          defaultField = 'newOutcome';
                        } else if (val === 'product_low_stock' || val === 'product_created') {
                          defaultField = 'stockLevel';
                        } else if (val === 'customer_created') {
                          defaultField = 'type';
                        } else if (val === 'transaction_created') {
                          defaultField = 'type';
                        }
                        setEditingRule({
                          ...editingRule,
                          triggerType: val,
                          conditions: [
                            { field: defaultField, operator: 'equals', value: defaultValue }
                          ]
                        });
                      }}
                      className="w-full text-xs md:text-sm border border-slate-200 rounded-xl p-3 focus:outline-none focus:border-sky-500 bg-white"
                    >
                      <optgroup label="پیش‌فاکتورها و پروژه‌ها">
                        <option value="proforma_created">ایجاد پیش‌فاکتور جدید</option>
                        <option value="proforma_outcome_change">تغییر وضعیت نهایی پیش‌فاکتور</option>
                        <option value="project_created">ایجاد پروژه جدید</option>
                        <option value="project_status_change">تغییر وضعیت پروژه</option>
                      </optgroup>
                      <optgroup label="خرید و تأمین‌کنندگان">
                        <option value="customer_created">ثبت مشتری جدید</option>
                        <option value="customer_updated">ویرایش اطلاعات مشتری</option>
                        <option value="supplier_created">ثبت تامین‌کننده جدید</option>
                        <option value="supplier_inquiry_created">ثبت استعلام قیمت جدید</option>
                        <option value="supplier_inquiry_status_change">تغییر وضعیت استعلام تامین‌کننده</option>
                        <option value="purchase_order_created">ثبت سفارش خرید جدید</option>
                        <option value="purchase_order_status_change">تغییر وضعیت سفارش خرید</option>
                      </optgroup>
                      <optgroup label="کالاها و انبار">
                        <option value="product_created">ثبت کالای جدید</option>
                        <option value="product_low_stock">کاهش موجودی کالا به کمتر از حد مجاز</option>
                        <option value="packaging_delivery_created">ثبت بسته‌بندی و تحویل</option>
                        <option value="packaging_delivery_status_change">تغییر وضعیت بسته‌بندی و تحویل</option>
                      </optgroup>
                      <optgroup label="خدمات پس از فروش">
                        <option value="after_sales_service_created">ثبت درخواست خدمات پس از فروش جدید</option>
                        <option value="after_sales_service_status_change">تغییر وضعیت خدمات پس از فروش</option>
                      </optgroup>
                      <optgroup label="مالی و پرداخت‌ها">
                        <option value="transaction_created">ثبت تراکنش مالی جدید</option>
                      </optgroup>
                      <optgroup label="وظایف و ارجاعات">
                        <option value="task_created">ایجاد وظیفه جدید</option>
                        <option value="task_status_change">تغییر وضعیت وظیفه</option>
                        <option value="referral_created">ارجاع کار جدید به پرسنل</option>
                        <option value="referral_status_change">تغییر وضعیت ارجاع کار</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                {/* Status Switch */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="workflow_active_checkbox"
                    checked={editingRule.active}
                    onChange={(e) => setEditingRule({ ...editingRule, active: e.target.checked })}
                    className="rounded text-sky-500 focus:ring-sky-500 h-4 w-4"
                  />
                  <label htmlFor="workflow_active_checkbox" className="text-slate-700 text-xs font-bold cursor-pointer select-none">
                    این قانون فعال باشد
                  </label>
                </div>

                {/* Conditions Block */}
                <div className="border border-slate-200 rounded-2xl bg-white p-4 space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                      <Sliders size={14} className="text-sky-500" />
                      شرط‌های اجرا (Conditions) - اجرای قانون در صورت برقراری همه شرایط
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        const fieldMap: Record<string, string> = {
                          proforma_created: 'status',
                          proforma_outcome_change: 'newOutcome',
                          project_created: 'status',
                          project_status_change: 'newStatus',
                          customer_created: 'type',
                          customer_updated: 'newStatus',
                          supplier_created: 'city',
                          supplier_inquiry_created: 'status',
                          supplier_inquiry_status_change: 'newStatus',
                          purchase_order_created: 'status',
                          purchase_order_status_change: 'newStatus',
                          product_created: 'stockLevel',
                          product_low_stock: 'stockLevel',
                          packaging_delivery_created: 'action',
                          packaging_delivery_status_change: 'status',
                          after_sales_service_created: 'status',
                          after_sales_service_status_change: 'newStatus',
                          transaction_created: 'type',
                          task_created: 'status',
                          task_status_change: 'newStatus',
                          referral_created: 'status',
                          referral_status_change: 'newStatus',
                        };
                        const conds = editingRule.conditions || [];
                        setEditingRule({
                          ...editingRule,
                          conditions: [
                            ...conds,
                            { field: fieldMap[editingRule.triggerType] || 'status', operator: 'equals', value: '' }
                          ]
                        });
                      }}
                      className="text-sky-600 hover:text-sky-700 text-xs font-bold flex items-center gap-1"
                    >
                      <Plus size={14} />
                      افزودن شرط جدید
                    </button>
                  </div>

                  {editingRule.conditions.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-xs">
                      هیچ شرطی تعریف نشده است. این قانون در صورت وقوع رویداد همواره اجرا خواهد شد.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {editingRule.conditions.map((cond, condIdx) => {
                        // Options for select
                        let fieldOptions: { value: string; label: string }[] = [];
                        let valueOptions: string[] = [];

                        if (editingRule.triggerType === 'packaging_delivery_created') {
                          fieldOptions = [
                            { value: 'action', label: 'عملیات' }
                          ];
                          valueOptions = ['ایجاد'];
                        } else if (editingRule.triggerType === 'packaging_delivery_status_change') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت جدید' },
                            { value: 'oldStatus', label: 'وضعیت قبلی' }
                          ];
                          valueOptions = ['پیش‌نویس', 'آماده بسته‌بندی', 'بسته‌بندی شده', 'آماده ارسال', 'ارسال شده', 'تحویل شده', 'لغو شده'];
                        } else if (editingRule.triggerType === 'supplier_inquiry_status_change') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'وضعیت جدید' },
                            { value: 'oldStatus', label: 'وضعیت قبلی' }
                          ];
                          valueOptions = ['پیش‌نویس', 'ارسال شده', 'در انتظار پاسخ', 'پاسخ داده شده', 'لغو شده', 'برنده', 'بازنده'];
                        } else if (editingRule.triggerType === 'supplier_inquiry_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت' },
                            { value: 'price', label: 'قیمت استعلام' }
                          ];
                          valueOptions = ['پیش‌نویس', 'ارسال شده', 'در انتظار پاسخ', 'پاسخ داده شده', 'لغو شده', 'برنده', 'بازنده'];
                        } else if (editingRule.triggerType === 'after_sales_service_status_change') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'وضعیت جدید' },
                            { value: 'oldStatus', label: 'وضعیت قبلی' }
                          ];
                          valueOptions = ['در حال بررسی', 'در حال تعمیر/خدمات', 'تکمیل شده', 'تحویل داده شده'];
                        } else if (editingRule.triggerType === 'after_sales_service_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت خدمات' }
                          ];
                          valueOptions = ['در حال بررسی', 'در حال تعمیر/خدمات', 'تکمیل شده', 'تحویل داده شده'];
                        } else if (editingRule.triggerType === 'proforma_outcome_change') {
                          fieldOptions = [
                            { value: 'newOutcome', label: 'وضعیت نهایی جدید پیش‌فاکتور' },
                            { value: 'oldOutcome', label: 'وضعیت نهایی قبلی پیش‌فاکتور' },
                            { value: 'proformaAmount', label: 'مبلغ پیش‌فاکتور' }
                          ];
                          valueOptions = ['تأیید شده (برنده)', 'نیمه برنده', 'باخته', 'لغو شده', 'در حال بررسی', 'پیش‌نویس'];
                        } else if (editingRule.triggerType === 'proforma_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت پیش‌فاکتور' },
                            { value: 'totalAmount', label: 'مبلغ کل' }
                          ];
                          valueOptions = ['تأیید شده (برنده)', 'نیمه برنده', 'باخته', 'لغو شده', 'در حال بررسی', 'پیش‌نویس'];
                        } else if (editingRule.triggerType === 'project_status_change') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'وضعیت جدید پروژه' },
                            { value: 'oldStatus', label: 'وضعیت قبلی پروژه' }
                          ];
                          valueOptions = ['پیشنهاد فنی مالی', 'در دست بررسی', 'برنده شده', 'باخته شده'];
                        } else if (editingRule.triggerType === 'project_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت پروژه' }
                          ];
                          valueOptions = ['پیشنهاد فنی مالی', 'در دست بررسی', 'برنده شده', 'باخته شده'];
                        } else if (editingRule.triggerType === 'purchase_order_status_change') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'وضعیت جدید سفارش خرید' },
                            { value: 'oldStatus', label: 'وضعیت قبلی سفارش خرید' }
                          ];
                          valueOptions = ['پیش‌نویس', 'در انتظار تأیید', 'تأیید شده', 'ارسال شده', 'تحویل شده (رسید انبار)', 'لغو شده'];
                        } else if (editingRule.triggerType === 'purchase_order_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت سفارش خرید' },
                            { value: 'totalAmount', label: 'مبلغ کل' }
                          ];
                          valueOptions = ['پیش‌نویس', 'در انتظار تأیید', 'تأیید شده', 'ارسال شده', 'تحویل شده (رسید انبار)', 'لغو شده'];
                        } else if (editingRule.triggerType === 'customer_created') {
                          fieldOptions = [
                            { value: 'type', label: 'نوع مشتری' },
                            { value: 'city', label: 'شهر' },
                            { value: 'country', label: 'کشور' }
                          ];
                          valueOptions = ['حقوقی', 'حقیقی'];
                        } else if (editingRule.triggerType === 'customer_updated') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'نوع جدید مشتری' },
                            { value: 'oldType', label: 'نوع قبلی مشتری' },
                            { value: 'city', label: 'شهر' }
                          ];
                          valueOptions = ['حقوقی', 'حقیقی'];
                        } else if (editingRule.triggerType === 'supplier_created') {
                          fieldOptions = [
                            { value: 'city', label: 'شهر' },
                            { value: 'country', label: 'کشور' }
                          ];
                          valueOptions = [];
                        } else if (editingRule.triggerType === 'product_created' || editingRule.triggerType === 'product_low_stock') {
                          fieldOptions = [
                            { value: 'stockLevel', label: 'موجودی' },
                            { value: 'minStockLevel', label: 'حداقل موجودی' }
                          ];
                          valueOptions = [];
                        } else if (editingRule.triggerType === 'transaction_created') {
                          fieldOptions = [
                            { value: 'type', label: 'نوع تراکنش' },
                            { value: 'paymentType', label: 'روش پرداخت' },
                            { value: 'amountRIYAL', label: 'مبلغ ریالی' }
                          ];
                          valueOptions = ['دریافت', 'پرداخت', 'چک', 'حواله', 'نقدی', 'کارت به کارت', 'سایر'];
                        } else if (editingRule.triggerType === 'task_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت' },
                            { value: 'priority', label: 'اولویت' }
                          ];
                          valueOptions = ['در انتظار', 'در حال انجام', 'تکمیل شده', 'کم', 'متوسط', 'زیاد', 'بحرانی'];
                        } else if (editingRule.triggerType === 'task_status_change') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'وضعیت جدید' },
                            { value: 'oldStatus', label: 'وضعیت قبلی' }
                          ];
                          valueOptions = ['در انتظار', 'در حال انجام', 'تکمیل شده'];
                        } else if (editingRule.triggerType === 'referral_created') {
                          fieldOptions = [
                            { value: 'status', label: 'وضعیت ارجاع' }
                          ];
                          valueOptions = ['در انتظار اقدام', 'در حال انجام', 'انجام شده', 'لغو شده'];
                        } else if (editingRule.triggerType === 'referral_status_change') {
                          fieldOptions = [
                            { value: 'newStatus', label: 'وضعیت جدید' },
                            { value: 'oldStatus', label: 'وضعیت قبلی' }
                          ];
                          valueOptions = ['در انتظار اقدام', 'در حال انجام', 'انجام شده', 'لغو شده'];
                        }

                        return (
                          <div key={condIdx} className="flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-150 animate-fade-in text-xs">
                            <span className="text-slate-500 font-medium">اگر</span>
                            <select
                              value={cond.field}
                              onChange={(e) => {
                                const updatedConds = [...editingRule.conditions];
                                updatedConds[condIdx].field = e.target.value;
                                setEditingRule({ ...editingRule, conditions: updatedConds });
                              }}
                              className="border border-slate-200 rounded-lg p-2 bg-white focus:outline-none focus:border-sky-500"
                            >
                              {fieldOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>

                            <select
                              value={cond.operator}
                              onChange={(e) => {
                                const updatedConds = [...editingRule.conditions];
                                updatedConds[condIdx].operator = e.target.value as any;
                                setEditingRule({ ...editingRule, conditions: updatedConds });
                              }}
                              className="border border-slate-200 rounded-lg p-2 bg-white focus:outline-none focus:border-sky-500"
                            >
                              <option value="equals">برابر باشد با</option>
                              <option value="not_equals">مخالف باشد با</option>
                              <option value="greater_than">بزرگتر از</option>
                              <option value="less_than">کوچکتر از</option>
                            </select>

                            
                            {cond.field === 'proformaAmount' || cond.field === 'totalAmount' || cond.field === 'price' || cond.field === 'amountRIYAL' || cond.field === 'stockLevel' || cond.field === 'minStockLevel' || valueOptions.length === 0 ? (
                              <input
                                type={['stockLevel', 'minStockLevel', 'proformaAmount', 'totalAmount', 'price', 'amountRIYAL'].includes(cond.field) ? "number" : "text"}
                                value={cond.value}
                                onChange={(e) => {
                                  const updatedConds = [...editingRule.conditions];
                                  updatedConds[condIdx].value = e.target.value;
                                  setEditingRule({ ...editingRule, conditions: updatedConds });
                                }}
                                placeholder={['stockLevel', 'minStockLevel'].includes(cond.field) ? "تعداد" : "مقدار مورد نظر"}
                                className="border border-slate-200 rounded-lg p-2 bg-white focus:outline-none focus:border-sky-500 font-mono text-left"
                              />
                            ) : (
                              <select
                                value={cond.value}
                                onChange={(e) => {
                                  const updatedConds = [...editingRule.conditions];
                                  updatedConds[condIdx].value = e.target.value;
                                  setEditingRule({ ...editingRule, conditions: updatedConds });
                                }}
                                className="border border-slate-200 rounded-lg p-2 bg-white focus:outline-none focus:border-sky-500"
                              >
                                <option value="">-- انتخاب مقدار --</option>
                                {valueOptions.map(val => (
                                  <option key={val} value={val}>{val}</option>
                                ))}
                              </select>
                            )}


                            <button
                              type="button"
                              onClick={() => {
                                const updatedConds = editingRule.conditions.filter((_, idx) => idx !== condIdx);
                                setEditingRule({ ...editingRule, conditions: updatedConds });
                              }}
                              className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 mr-auto flex items-center justify-center"
                              title="حذف شرط"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Actions Block */}
                <div className="border border-slate-200 rounded-2xl bg-white p-4 space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                      <RefreshCw size={14} className="text-emerald-500" />
                      اقدامات خودکار (Actions)
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        const acts = editingRule.actions || [];
                        setEditingRule({
                          ...editingRule,
                          actions: [
                            ...acts,
                            {
                              type: 'create_task',
                              taskConfig: {
                                titleTemplate: 'وظیفه جدید پروژه {projectName}',
                                descTemplate: 'توضیحات وظیفه مربوط به پروژه {projectName}',
                                assignedTo: 'MODULE_RESPONSIBLE_purchaseOrders',
                                priority: 'متوسط',
                                dueDaysOffset: 3
                              }
                            }
                          ]
                        });
                      }}
                      className="text-emerald-600 hover:text-emerald-700 text-xs font-bold flex items-center gap-1"
                    >
                      <Plus size={14} />
                      افزودن اقدام جدید
                    </button>
                  </div>

                  {editingRule.actions.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                      حداقل یک اقدام برای این ورک‌فلو باید تعریف کنید.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {editingRule.actions.map((act, actIdx) => {
                        return (
                          <div key={actIdx} className="bg-slate-50 p-4 rounded-xl border border-slate-200 animate-fade-in space-y-3 relative text-xs">
                            <div className="flex justify-between items-center border-b border-slate-150 pb-2">
                              <div className="flex items-center gap-2 font-bold text-slate-700">
                                <span>اقدام #{actIdx + 1}:</span>
                                <select
                                  value={act.type}
                                  onChange={(e) => {
                                    const val = e.target.value as any;
                                    const updatedActs = [...editingRule.actions];
                                    if (val === 'create_task') {
                                      updatedActs[actIdx] = {
                                        type: 'create_task',
                                        taskConfig: {
                                          titleTemplate: 'پیگیری برای پروژه {projectName}',
                                          descTemplate: 'توضیحات برای پروژه {projectName}',
                                          assignedTo: 'MODULE_RESPONSIBLE_purchaseOrders',
                                          priority: 'متوسط',
                                          dueDaysOffset: 3
                                        }
                                      };
                                    } else {
                                      updatedActs[actIdx] = {
                                        type: 'send_notification',
                                        notificationConfig: {
                                          module: 'purchaseOrders',
                                          titleTemplate: 'اطلاع‌رسانی پروژه {projectName}',
                                          descTemplate: 'وضعیت جدید پروژه {projectName} به {newStatus} تغییر یافت.'
                                        }
                                      };
                                    }
                                    setEditingRule({ ...editingRule, actions: updatedActs });
                                  }}
                                  className="border border-slate-200 rounded-lg p-1.5 bg-white text-xs"
                                >
                                  <option value="create_task">ایجاد وظیفه جدید (تسک)</option>
                                  <option value="send_notification">ارسال اعلان درون‌برنامه‌ای</option>
                                </select>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const updatedActs = editingRule.actions.filter((_, idx) => idx !== actIdx);
                                  setEditingRule({ ...editingRule, actions: updatedActs });
                                }}
                                className="text-rose-500 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-50"
                                title="حذف اقدام"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            {/* Show Token Helpers */}
                            <div className="bg-sky-50 text-sky-800 p-2.5 rounded-lg border border-sky-100 flex flex-wrap items-center gap-2 text-[10px]">
                              <span className="font-bold">متغیرهای پویا قابل استفاده در قالب‌ها:</span>
                              <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 cursor-pointer">{'{projectName}'}</code>
                              <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 cursor-pointer">{'{projectCode}'}</code>
                              <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 cursor-pointer">{'{proformaNumber}'}</code>
                              <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 cursor-pointer">{'{poNumber}'}</code>
                              <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 cursor-pointer">{'{newStatus}'}</code>
                              <code className="bg-white px-1.5 py-0.5 rounded border border-sky-200 cursor-pointer">{'{newOutcome}'}</code>
                            </div>

                            {act.type === 'create_task' && act.taskConfig && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">قالب عنوان وظیفه <span className="text-red-500">*</span></label>
                                  <input
                                    type="text"
                                    value={act.taskConfig.titleTemplate}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].taskConfig!.titleTemplate = e.target.value;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white"
                                    required
                                  />
                                </div>

                                <div>
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">مسئول انجام وظیفه</label>
                                  <select
                                    value={act.taskConfig.assignedTo}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].taskConfig!.assignedTo = e.target.value;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white"
                                  >
                                    <optgroup label="سمت‌های پویا">
                                      <option value="SALES_EXPERT">کارشناس فروش پروژه</option>
                                      <option value="MODULE_RESPONSIBLE_customers">مسئول ماژول مشتریان</option>
                                      <option value="MODULE_RESPONSIBLE_projects">مسئول ماژول پروژه‌ها (فرصت‌ها)</option>
                                      <option value="MODULE_RESPONSIBLE_products">مسئول ماژول کالاها و تجهیزات</option>
                                      <option value="MODULE_RESPONSIBLE_proformas">مسئول ماژول پیش‌فاکتورها</option>
                                      <option value="MODULE_RESPONSIBLE_suppliers">مسئول ماژول تأمین‌کنندگان</option>
                                      <option value="MODULE_RESPONSIBLE_supplierInquiries">مسئول ماژول استعلام قیمت تأمین‌کنندگان</option>
                                      <option value="MODULE_RESPONSIBLE_purchaseOrders">مسئول سفارشات خرید خارجی</option>
                                      <option value="MODULE_RESPONSIBLE_packagingDelivery">مسئول ماژول بسته‌بندی و تحویل کالا</option>
                                      <option value="MODULE_RESPONSIBLE_afterSalesServices">مسئول خدمات پس از فروش</option>
                                      <option value="MODULE_RESPONSIBLE_transactions">مسئول ماژول تراکنش‌های مالی</option>
                                      <option value="MODULE_RESPONSIBLE_tasks">مسئول ماژول وظایف و پیگیری</option>
                                    </optgroup>
                                    <optgroup label="کاربران سیستم">
                                      {users.map(u => (
                                        <option key={u.id} value={u.fullName}>{u.fullName}</option>
                                      ))}
                                    </optgroup>
                                  </select>
                                </div>

                                <div className="md:col-span-2">
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">قالب توضیحات وظیفه</label>
                                  <textarea
                                    value={act.taskConfig.descTemplate}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].taskConfig!.descTemplate = e.target.value;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    rows={2}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white"
                                  />
                                </div>

                                <div>
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">اولویت وظیفه</label>
                                  <select
                                    value={act.taskConfig.priority}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].taskConfig!.priority = e.target.value as any;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white"
                                  >
                                    <option value="پایین">پایین</option>
                                    <option value="متوسط">متوسط</option>
                                    <option value="بالا">بالا</option>
                                    <option value="فوری">فوری</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">مهلت انجام (تعداد روز بعد از رویداد)</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={act.taskConfig.dueDaysOffset || 0}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].taskConfig!.dueDaysOffset = parseInt(e.target.value) || 0;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white text-left font-mono"
                                    dir="ltr"
                                  />
                                </div>
                              </div>
                            )}

                            {act.type === 'send_notification' && act.notificationConfig && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">قالب عنوان اعلان <span className="text-red-500">*</span></label>
                                  <input
                                    type="text"
                                    value={act.notificationConfig.titleTemplate}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].notificationConfig!.titleTemplate = e.target.value;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white"
                                    required
                                  />
                                </div>

                                <div>
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">ارسال به مسئول ماژول</label>
                                  <select
                                    value={act.notificationConfig.module}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].notificationConfig!.module = e.target.value;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white font-mono"
                                  >
                                    <option value="proformas">پیش‌فاکتورها (Proformas)</option>
                                    <option value="projects">پروژه‌ها (Projects)</option>
                                    <option value="purchaseOrders">سفارشات خرید (Purchase Orders)</option>
                                    <option value="inventory">انبار و کالا (Inventory)</option>
                                    <option value="customers">مشتریان (Customers)</option>
                                    <option value="suppliers">تأمین‌کنندگان (Suppliers)</option>
                                    <option value="afterSales">خدمات پس از فروش (After Sales)</option>
                                  </select>
                                </div>

                                <div className="md:col-span-2">
                                  <label className="block text-slate-600 text-[11px] font-bold mb-1">قالب متن پیام اعلان</label>
                                  <textarea
                                    value={act.notificationConfig.descTemplate}
                                    onChange={(e) => {
                                      const updatedActs = [...editingRule.actions];
                                      updatedActs[actIdx].notificationConfig!.descTemplate = e.target.value;
                                      setEditingRule({ ...editingRule, actions: updatedActs });
                                    }}
                                    rows={2}
                                    className="w-full border border-slate-200 rounded-lg p-2.5 bg-white"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Form Buttons */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRule(null);
                      setIsRuleFormOpen(false);
                    }}
                    className="bg-white hover:bg-slate-100 text-slate-700 font-bold py-2 px-5 rounded-xl text-xs md:text-sm border border-slate-200 transition-all"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-5 rounded-xl text-xs md:text-sm transition-all shadow-sm"
                  >
                    ذخیره قانون ورک‌فلو
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {(settings.workflows || []).length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                    <RefreshCw size={40} className="text-slate-300 mx-auto animate-spin-slow mb-3" />
                    <p className="text-slate-600 font-bold text-sm">هیچ قانون ورک‌فلویی تعریف نشده است</p>
                    <p className="text-slate-400 text-xs mt-1">با ایجاد قوانین داینامیک، فرآیندهای کاری سازمان خود را خودکار کنید.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {(settings.workflows || []).map((rule) => {
                      const triggerLabelMap: Record<string, string> = {
                        proforma_outcome_change: 'تغییر وضعیت نهایی پیش‌فاکتور',
                        project_status_change: 'تغییر وضعیت پروژه',
                        purchase_order_status_change: 'تغییر وضعیت سفارش خرید',
                        packaging_delivery_created: 'ثبت بسته‌بندی و تحویل',
                        supplier_inquiry_status_change: 'تغییر وضعیت استعلام تامین‌کننده',
                        after_sales_service_status_change: 'تغییر وضعیت خدمات پس از فروش'
                      };

                      return (
                        <div key={rule.id} className="bg-white p-5 rounded-xl border border-slate-200 hover:border-slate-300 transition-all shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="space-y-2 text-right">
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${rule.active ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                              <h4 className="font-bold text-slate-800 text-sm md:text-base">{rule.name}</h4>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                rule.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                              }`}>
                                {rule.active ? 'فعال' : 'غیرفعال'}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-slate-600">
                              <div>
                                <span className="font-bold text-slate-500">رویداد:</span> {triggerLabelMap[rule.triggerType] || rule.triggerType}
                              </div>
                              <div>
                                <span className="font-bold text-slate-500">تعداد شرط‌ها:</span> {rule.conditions?.length || 0} مورد
                              </div>
                              <div>
                                <span className="font-bold text-slate-500">تعداد اقدامات:</span> {rule.actions?.length || 0} اقدام
                              </div>
                            </div>

                            {/* Brief execution description */}
                            <div className="bg-slate-50 p-2.5 rounded-lg text-slate-500 text-[11px] border border-slate-100 max-w-2xl leading-relaxed">
                              <span className="font-bold text-sky-600">فرآیند: </span>
                              در زمان وقوع <span className="text-slate-800 font-bold">{triggerLabelMap[rule.triggerType] || rule.triggerType}</span>،
                              {rule.conditions && rule.conditions.length > 0 ? (
                                <>
                                  {' '}اگر{' '}
                                  {rule.conditions.map((c, i) => (
                                    <span key={i} className="text-slate-800 font-bold bg-white px-1.5 py-0.5 rounded border border-slate-200 mx-0.5 font-mono">
                                      {c.field === 'newOutcome' ? 'وضعیت جدید' : c.field === 'newStatus' ? 'وضعیت جدید' : c.field} {c.operator === 'equals' ? 'برابر باشد با' : 'مخالف باشد با'} «{c.value}»
                                    </span>
                                  ))}
                                  {' '}باشد، آنگاه:{' '}
                                </>
                              ) : (
                                ' بدون هیچ شرطی، آنگاه '
                              )}
                              {rule.actions.map((act, i) => (
                                <span key={i} className="text-emerald-700 font-bold bg-white px-1.5 py-0.5 rounded border border-slate-200 mx-0.5">
                                  {act.type === 'create_task' ? `ایجاد تسک «${act.taskConfig?.titleTemplate}»` : `ارسال اعلان به مسئول ماژول`}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end md:self-center mr-auto">
                            <button
                              type="button"
                              onClick={() => handleToggleWorkflowActive(rule.id)}
                              className={`p-2 rounded-lg border text-xs font-bold transition-all ${
                                rule.active 
                                  ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' 
                                  : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                              }`}
                              title={rule.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                            >
                              {rule.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRule({ ...rule });
                                setIsRuleFormOpen(true);
                              }}
                              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 hover:text-slate-900"
                              title="ویرایش"
                            >
                              <Sliders size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyWorkflowRule(rule.id)}
                              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 hover:text-slate-900"
                              title="کپی کردن قانون"
                            >
                              <Copy size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteWorkflowRule(rule.id)}
                              className="p-2 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-500 hover:text-rose-700"
                              title="حذف"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null)}

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setDeleteType(null);
          setDeleteTargetId('');
          setDeleteTargetName('');
        }}
        onConfirm={handleConfirmDelete}
        title={
          deleteType === 'dropdownItem' ? 'حذف گزینه لیست بازشو' :
          deleteType === 'activityCategory' ? 'حذف دسته‌بندی فعالیت' :
          deleteType === 'lossReason' ? 'حذف علت باخت' :
          deleteType === 'customField' ? 'حذف فیلد سفارشی' : 
          deleteType === 'clearData' ? 'هشدار: پاکسازی کامل داده‌ها' : 
           deleteType === 'workflow' ? 'حذف گردش کار' : 'تایید حذف'
        }
        message={
          deleteType === 'dropdownItem' ? `آیا از حذف گزینه "${deleteTargetName}" از لیست کشویی "${dropdownLabels[selectedDropdownKey] || ''}" اطمینان دارید؟` :
          deleteType === 'activityCategory' ? `آیا از حذف دسته‌بندی فعالیت "${deleteTargetName}" اطمینان دارید؟` :
          deleteType === 'lossReason' ? `آیا از حذف علت باخت "${deleteTargetName}" اطمینان دارید؟` :
          deleteType === 'customField' ? `آیا از حذف فیلد سفارشی "${deleteTargetName}" اطمینان دارید؟ تمامی مقادیر ذخیره شده برای این فیلد در رکوردهای موجود حذف خواهند شد.` : 
          deleteType === 'clearData' ? 'آیا مطمئن هستید که می‌خواهید تمامی داده‌های نرم‌افزار (شامل مشتریان، کالاها، پروژه‌ها و ...) را به طور کامل پاک کنید؟ این عملیات غیرقابل بازگشت است.' :
           deleteType === 'workflow' ? `آیا از حذف گردش کار "${deleteTargetName}" اطمینان دارید؟` : ''
        }
      />

    </div>
  );
}
