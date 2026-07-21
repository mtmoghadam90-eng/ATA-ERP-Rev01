import React, { useState } from 'react';
import { X, Plus, Users, Briefcase, Truck, Package, Building, User, Trash2 } from 'lucide-react';
import { Customer, Project, Supplier, Product, ERPSettings, User as ERPUser } from '../types';
import ShamsiDatePicker from './ShamsiDatePicker';
import CustomFieldsForm from './CustomFieldsForm';
import { uploadFile } from '../imageUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk, getFieldAsterisk } from '../utils/requiredFields';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'customer' | 'project' | 'supplier' | 'product';
  onSuccess: (newEntity: any) => void;
  customers?: Customer[];
  products?: Product[];
  settings: ERPSettings;
  addCustomer?: (customer: Omit<Customer, 'id' | 'createdAt'>) => Customer;
  addProject?: (project: Omit<Project, 'id' | 'code' | 'creationDate'>) => Project;
  addSupplier?: (supplier: Omit<Supplier, 'id' | 'createdAt'>) => Supplier;
  addProduct?: (product: Omit<Product, 'id' | 'stockLevel'> & { stockLevel?: number }) => Product;
  users?: ERPUser[];
  initialCustType?: 'حقوقی' | 'حقیقی';
  initialLinkedCustomerIds?: string[];
}

export default function QuickAddModal({
  isOpen,
  onClose,
  type,
  onSuccess,
  customers = [],
  products = [],
  settings,
  addCustomer,
  addProject,
  addSupplier,
  addProduct,
  users = [],
  initialCustType,
  initialLinkedCustomerIds
}: QuickAddModalProps) {
  if (!isOpen) return null;

  // Unified Custom Fields state
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Nested Quick-Add States
  const [nestedQuickAddType, setNestedQuickAddType] = useState<'customer' | 'product' | null>(null);
  const [nestedCustomerTarget, setNestedCustomerTarget] = useState<'projCustomerId' | 'projEndUser' | 'projFinancialContact' | 'projTechnicalContact' | null>(null);
  const [nestedProductIndex, setNestedProductIndex] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // 1. CUSTOMER FORM STATES
  // ---------------------------------------------------------------------------
  const [custType, setCustType] = useState<'حقوقی' | 'حقیقی'>(initialCustType || 'حقوقی');
  const [companyName, setCompanyName] = useState('');
  const [economicCode, setEconomicCode] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [industry, setIndustry] = useState(() => (settings.dropdownItems?.industries || ['نفت و گاز', 'پتروشیمی', 'نیروگاهی', 'فولاد و معادن', 'آب و فاضلاب', 'شیمیایی', 'سایر'])[0] || 'سایر');
  const [keyPerson, setKeyPerson] = useState('');
  const [custProvince, setCustProvince] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<'مرد' | 'زن' | ''>('');
  const [position, setPosition] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custNotes, setCustNotes] = useState('');
  const [custTags, setCustTags] = useState('');
  const [custStatus, setCustStatus] = useState<'فعال' | 'غیرفعال'>('فعال');
  const [selectedLinks, setSelectedLinks] = useState<string[]>(initialLinkedCustomerIds || []);

  // ---------------------------------------------------------------------------
  // 2. PROJECT FORM STATES
  // ---------------------------------------------------------------------------
  const [projName, setProjName] = useState('');
  const [projCustomerId, setProjCustomerId] = useState('');
  const [projEndUser, setProjEndUser] = useState('');
  const [projSalesExpert, setProjSalesExpert] = useState(() => (settings.dropdownItems?.salesExperts || [])[0] || '');
  const [projCustomerInquiryNumber, setProjCustomerInquiryNumber] = useState('');
  const [projMarketingChannel, setProjMarketingChannel] = useState(() => (settings.dropdownItems?.marketingChannels || ['تماس مستقیم', 'نمایشگاه تجاری', 'وب‌سایت / آنلاین', 'معرفی', 'مناقصه رسمی', 'سایر'])[0] || 'تماس مستقیم');
  const [projLeadQuality, setProjLeadQuality] = useState(() => (settings.dropdownItems?.leadQualities || ['عالی (گرم)', 'متوسط', 'ضعیف (سرد)'])[0] || 'متوسط');
  const [projReferrerName, setProjReferrerName] = useState('');
  const [projCommunicationMethod, setProjCommunicationMethod] = useState(() => (settings.dropdownItems?.communicationMethods || ['تلفن', 'ایمیل', 'جلسه حضوری', 'مکاتبه رسمی', 'شبکه‌های اجتماعی'])[0] || 'تلفن');
  const [projFinancialContact, setProjFinancialContact] = useState('');
  const [projTechnicalContact, setProjTechnicalContact] = useState('');
  const [projOpportunityDate, setProjOpportunityDate] = useState(() => new Date().toLocaleDateString('fa-IR'));
  const [projExpectedCloseDate, setProjExpectedCloseDate] = useState('');
  const [projStatus, setProjStatus] = useState<Project['status']>('جدید');
  const [projLossReason, setProjLossReason] = useState('');
  const [projWinningDate, setProjWinningDate] = useState('');
  const [projAgreedDeliveryDate, setProjAgreedDeliveryDate] = useState('');
  const [projClosingDate, setProjClosingDate] = useState('');
  const [projItemsNeeded, setProjItemsNeeded] = useState<{ productId: string; name: string; quantity: number }[]>([]);

  const handleProjStatusChange = (newStatus: Project['status']) => {
    setProjStatus(newStatus);
    const today = new Date().toLocaleDateString('fa-IR');
    if (newStatus === 'باخته') {
      if (!projLossReason && settings.lossReasons?.length) {
        setProjLossReason(settings.lossReasons[0]);
      }
    }
    if (newStatus === 'برنده (موفق)' || newStatus === 'نیمه برنده') {
      if (!projWinningDate) setProjWinningDate(today);
      if (!projAgreedDeliveryDate) setProjAgreedDeliveryDate(today);
    }
    if (newStatus === 'برنده (موفق)' || newStatus === 'نیمه برنده' || newStatus === 'باخته' || newStatus === 'لغو شده') {
      if (!projClosingDate) setProjClosingDate(today);
    }
  };

  const handleAddItemLine = () => {
    if (products.length === 0) {
      alert('هیچ کالایی برای انتخاب وجود ندارد.');
      return;
    }
    setProjItemsNeeded([...projItemsNeeded, { productId: products[0].id, name: products[0].displayName, quantity: 1 }]);
  };

  const handleRemoveItemLine = (idx: number) => {
    setProjItemsNeeded(projItemsNeeded.filter((_, i) => i !== idx));
  };

  const handleItemProductChange = (index: number, pId: string) => {
    const p = products.find(prod => prod.id === pId);
    if (!p) return;
    const current = [...projItemsNeeded];
    current[index].productId = pId;
    current[index].name = p.displayName;
    setProjItemsNeeded(current);
  };

  const handleItemQuantityChange = (index: number, qty: number) => {
    const current = [...projItemsNeeded];
    current[index].quantity = qty;
    setProjItemsNeeded(current);
  };

  // ---------------------------------------------------------------------------
  // 3. SUPPLIER FORM STATES
  // ---------------------------------------------------------------------------
  const [suppName, setSuppName] = useState('');
  const [suppCountry, setSuppCountry] = useState('');
  const [suppContact, setSuppContact] = useState('');
  const [suppStatus, setSuppStatus] = useState<'فعال' | 'غیرفعال'>('فعال');
  const [suppPhone, setSuppPhone] = useState('');
  const [suppEmail, setSuppEmail] = useState('');
  const [suppProvidedCategories, setSuppProvidedCategories] = useState<string[]>([]);
  const [suppDescription, setSuppDescription] = useState('');

  // ---------------------------------------------------------------------------
  // 4. PRODUCT FORM STATES
  // ---------------------------------------------------------------------------
  const [prodCategory, setProdCategory] = useState(() => (settings.dropdownItems?.categories || ['کنترلر و PLC', 'سنسور و ترانسمیتر', 'فلومتر و ابزار جریان', 'شیرآلات صنعتی', 'اتصالات و متریال نصب', 'تجهیزات هیدرولیک', 'سایر'])[0] || 'سایر');
  const [prodDisplayName, setProdDisplayName] = useState('');
  const [prodBrand, setProdBrand] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodSize, setProdSize] = useState('');
  const [prodMeasurementRange, setProdMeasurementRange] = useState('');
  const [prodSupplyType, setProdSupplyType] = useState<'INVENTORY' | 'ORDER'>('ORDER');
  const [prodInitialStock, setProdInitialStock] = useState('');
  const [prodImages, setProdImages] = useState<string[]>([]);


  // ---------------------------------------------------------------------------
  // TITLES & ICONS
  // ---------------------------------------------------------------------------
  const getTitleAndIcon = () => {
    switch (type) {
      case 'customer':
        return { title: 'تعریف سریع پرونده مشتری', icon: <Users className="text-sky-500" size={20} /> };
      case 'project':
        return { title: 'تعریف سریع پروژه / فرصت تجاری جدید', icon: <Briefcase className="text-emerald-500" size={20} /> };
      case 'supplier':
        return { title: 'ثبت سریع کمپانی تأمین‌کننده جدید', icon: <Truck className="text-amber-500" size={20} /> };
      case 'product':
        return { title: 'تعریف سریع کالا / تجهیز ابزاردقیق جدید', icon: <Package className="text-indigo-500" size={20} /> };
    }
  };

  const { title, icon } = getTitleAndIcon();

  const getModalWidth = () => {
    switch (type) {
      case 'customer':
      case 'project':
      case 'supplier':
        return 'max-w-2xl';
      case 'product':
        return 'max-w-xl';
    }
  };

  // ---------------------------------------------------------------------------
  // SUBMIT HANDLER
  // ---------------------------------------------------------------------------
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === `${type}s` as any || (type === 'project' && f.module === 'projects'));
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }

    if (type === 'customer') {
      if (!addCustomer) return;
      if (custType === 'حقوقی') {
        if (isFieldRequired(settings, 'customers', 'companyName') && !companyName.trim()) {
          alert('لطفاً نام شرکت را وارد کنید.');
          return;
        }
        if (isFieldRequired(settings, 'customers', 'economicCode') && !economicCode.trim()) {
          alert('لطفاً کد اقتصادی را وارد کنید.');
          return;
        }
        if (isFieldRequired(settings, 'customers', 'industry') && !industry) {
          alert('لطفاً صنعت فعالیت را انتخاب کنید.');
          return;
        }
        if (isFieldRequired(settings, 'customers', 'keyPerson') && !keyPerson.trim()) {
          alert('لطفاً شخص کلیدی را وارد کنید.');
          return;
        }
      } else {
        if (isFieldRequired(settings, 'customers', 'firstName') && !firstName.trim()) {
          alert('لطفاً نام را وارد کنید.');
          return;
        }
        if (isFieldRequired(settings, 'customers', 'lastName') && !lastName.trim()) {
          alert('لطفاً نام خانوادگی را وارد کنید.');
          return;
        }
        if (isFieldRequired(settings, 'customers', 'position') && !position.trim()) {
          alert('لطفاً سمت را وارد کنید.');
          return;
        }
      }

      if (isFieldRequired(settings, 'customers', 'phone') && !custPhone.trim()) {
        alert('لطفاً تلفن ثابت را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'customers', 'mobile') && !custMobile.trim()) {
        alert('لطفاً تلفن همراه را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'customers', 'email') && !custEmail.trim()) {
        alert('لطفاً ایمیل را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'customers', 'province') && !custProvince.trim()) {
        alert('لطفاً استان را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'customers', 'address') && !custAddress.trim()) {
        alert('لطفاً آدرس دقیق را وارد کنید.');
        return;
      }

      const newCust = addCustomer({
        customerType: custType,
        companyName: custType === 'حقوقی' ? companyName.trim() : `${firstName} ${lastName}`.trim(),
        firstName: custType === 'حقیقی' ? firstName.trim() : undefined,
        lastName: custType === 'حقیقی' ? lastName.trim() : undefined,
        phone: custPhone.trim(),
        mobile: custMobile.trim(),
        email: custEmail.trim(),
        province: custProvince.trim(),
        address: custAddress.trim(),
        notes: custNotes.trim(),
        tags: custTags.trim(),
        status: custStatus,
        gender: custType === 'حقیقی' ? gender || undefined : undefined,
        position: custType === 'حقیقی' ? position || undefined : undefined,
        industry: custType === 'حقوقی' ? industry || undefined : undefined,
        keyPerson: custType === 'حقوقی' ? keyPerson.trim() || undefined : undefined,
        linkedCustomerIds: selectedLinks,
        customValues
      });
      onSuccess(newCust);
      onClose();
    } else if (type === 'project') {
      if (!addProject) return;
      if (isFieldRequired(settings, 'projects', 'name') && !projName.trim()) {
        alert('لطفاً عنوان پروژه را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'customerId') && !projCustomerId) {
        alert('لطفاً مشتری پروژه را انتخاب کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'salesExpert') && !projSalesExpert) {
        alert('لطفاً کارشناس فروش را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'marketingChannel') && !projMarketingChannel) {
        alert('لطفاً کانال بازاریابی را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'leadQuality') && !projLeadQuality) {
        alert('لطفاً کیفیت لید را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'referrerName') && !projReferrerName.trim()) {
        alert('لطفاً نام معرف را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'financialContact') && !projFinancialContact.trim()) {
        alert('لطفاً فرد کلیدی مالی را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'technicalContact') && !projTechnicalContact.trim()) {
        alert('لطفاً فرد کلیدی فنی را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'customerInquiryNumber') && !projCustomerInquiryNumber.trim()) {
        alert('لطفاً شماره استعلام مشتری را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'expectedCloseDate') && !projExpectedCloseDate) {
        alert('لطفاً تاریخ پیش‌بینی بسته شدن را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'projects', 'endUser') && !projEndUser.trim()) {
        alert('لطفاً مصرف‌کننده نهایی را وارد کنید.');
        return;
      }

      const selectedCust = customers.find(c => c.id === projCustomerId);
      const newProj = addProject({
        name: projName.trim(),
        customerId: projCustomerId,
        customerName: selectedCust ? selectedCust.companyName : 'مشتری نامشخص',
        endUser: projEndUser.trim() || undefined,
        salesExpert: projSalesExpert || undefined,
        customerInquiryNumber: projCustomerInquiryNumber.trim() || undefined,
        marketingChannel: projMarketingChannel || undefined,
        leadQuality: projLeadQuality || undefined,
        referrerName: projReferrerName.trim() || undefined,
        communicationMethod: projCommunicationMethod || undefined,
        financialContact: projFinancialContact.trim() || undefined,
        technicalContact: projTechnicalContact.trim() || undefined,
        opportunityDate: projOpportunityDate,
        expectedCloseDate: projExpectedCloseDate || undefined,
        status: projStatus,
        lossReason: projStatus === 'باخته' ? projLossReason : undefined,
        winningDate: (projStatus === 'برنده (موفق)' || projStatus === 'نیمه برنده') ? projWinningDate : undefined,
        agreedDeliveryDate: (projStatus === 'برنده (موفق)' || projStatus === 'نیمه برنده') ? projAgreedDeliveryDate : undefined,
        closingDate: (projStatus === 'برنده (موفق)' || projStatus === 'نیمه برنده' || projStatus === 'باخته' || projStatus === 'لغو شده') ? projClosingDate : undefined,
        itemsNeeded: projItemsNeeded,
        description: 'ثبت سریع پروژه',
        customValues
      });
      onSuccess(newProj);
      onClose();
    } else if (type === 'supplier') {
      if (!addSupplier) return;
      if (isFieldRequired(settings, 'suppliers', 'name') && !suppName.trim()) {
        alert('لطفاً نام تأمین‌کننده را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'suppliers', 'country') && !suppCountry.trim()) {
        alert('لطفاً کشور مبدا را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'suppliers', 'contactName') && !suppContact.trim()) {
        alert('لطفاً کارشناس فروش را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'suppliers', 'phone') && !suppPhone.trim()) {
        alert('لطفاً تلفن تماس را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'suppliers', 'email') && !suppEmail.trim()) {
        alert('لطفاً ایمیل مکاتبه را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'suppliers', 'description') && !suppDescription.trim()) {
        alert('لطفاً توضیحات را وارد کنید.');
        return;
      }

      const newSupp = addSupplier({
        name: suppName.trim(),
        country: suppCountry.trim(),
        contactName: suppContact.trim(),
        phone: suppPhone.trim() || undefined,
        email: suppEmail.trim() || undefined,
        status: suppStatus,
        providedCategories: suppProvidedCategories,
        description: suppDescription.trim() || undefined,
        customValues
      });
      onSuccess(newSupp);
      onClose();
    } else if (type === 'product') {
      if (!addProduct) return;
      if (isFieldRequired(settings, 'products', 'displayName') && !prodDisplayName.trim()) {
        alert('لطفاً نام کالا را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'products', 'category') && !prodCategory) {
        alert('لطفاً دسته‌بندی کالا را انتخاب کنید.');
        return;
      }
      if (isFieldRequired(settings, 'products', 'brand') && !prodBrand.trim()) {
        alert('لطفاً برند کالا را وارد کنید.');
        return;
      }
      if (isFieldRequired(settings, 'products', 'description') && !prodDescription.trim()) {
        alert('لطفاً توضیحات کالا را وارد کنید.');
        return;
      }

      const newProd = addProduct({
        displayName: prodDisplayName.trim(),
        name: prodDisplayName.trim(),
        category: prodCategory,
        description: prodDescription.trim(),
        code: "EQ-" + Math.floor(10000 + Math.random() * 90000), // autogenerated technical code as in ProductsView
        brand: prodBrand.trim(),
        modelNumber: "N/A",
        unit: "عدد",
        basePriceRIYAL: 0,
        minStockLevel: 0,
        stockLevel: prodSupplyType === 'INVENTORY' ? (parseInt(prodInitialStock) || 0) : 0,
                        supplyType: prodSupplyType,
        images: prodImages,
        customValues
      });
      onSuccess(newProd);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir="rtl">
      <div className={`bg-white w-full ${getModalWidth()} rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] animate-scale-in`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="font-extrabold text-slate-800 text-sm md:text-base">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* -------------------- CUSTOMER FORM -------------------- */}
          {type === 'customer' && (
            <div className="space-y-5">
              {/* Customer Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">ماهیت مشتری</label>
                <div className="flex gap-4 p-1.5 bg-slate-100 rounded-xl border border-slate-200 w-fit">
                  <button
                    type="button"
                    onClick={() => setCustType('حقوقی')}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                      custType === 'حقوقی' 
                        ? 'bg-sky-500 text-white shadow-md shadow-sky-500/15' 
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    <Building size={14} />
                    مشتری حقوقی (شرکت/سازمان)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustType('حقیقی')}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                      custType === 'حقیقی' 
                        ? 'bg-violet-500 text-white shadow-md shadow-violet-500/15' 
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    <User size={14} />
                    مشتری حقیقی (انفرادی/پیمانکار)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {custType === 'حقوقی' ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'companyName', 'نام شرکت')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'companyName')}
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="مثال: شرکت نفت و گاز کارون"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'economicCode', 'کد اقتصادی')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'economicCode')}
                        value={economicCode}
                        onChange={(e) => setEconomicCode(e.target.value)}
                        placeholder="مثال: ۴۱۱۳۴۵۶۷۸۹۱۲"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'phone', 'تلفن ثابت')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'phone')}
                        value={custPhone}
                        onChange={(e) => setCustPhone(e.target.value)}
                        placeholder="مثال: 02188884422"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'mobile', 'تلفن همراه')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'mobile')}
                        value={custMobile}
                        onChange={(e) => setCustMobile(e.target.value)}
                        placeholder="مثال: 09121112233"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'email', 'ایمیل')}</label>
                      <input
                        type="email"
                        required={isFieldRequired(settings, 'customers', 'email')}
                        value={custEmail}
                        onChange={(e) => setCustEmail(e.target.value)}
                        placeholder="مثال: info@company.com"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'industry', 'صنعت / حوزه فعالیت')}</label>
                      <select
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        {(settings.dropdownItems?.industries || ['نفت و گاز', 'پتروشیمی', 'نیروگاهی', 'فولاد و معادن', 'آب و فاضلاب', 'شیمیایی', 'سایر']).map((ind, i) => (
                          <option key={i} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'province', 'استان')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'province')}
                        value={custProvince}
                        onChange={(e) => setCustProvince(e.target.value)}
                        placeholder="مثال: تهران"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'firstName', 'نام')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'firstName')}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="مثال: مهرداد"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'lastName', 'نام خانوادگی')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'lastName')}
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="مثال: رضوی"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">جنسیت</label>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value as any)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">نامشخص</option>
                        <option value="مرد">مرد</option>
                        <option value="زن">زن</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'position', 'سمت')}</label>
                      <select
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">انتخاب کنید...</option>
                        {(settings.dropdownItems?.positions || ['مدیرعامل', 'رئیس هیئت مدیره', 'مدیر بازرگانی', 'کارشناس خرید', 'مدیر فنی', 'کارشناس ارشد فنی', 'مدیر پروژه', 'مسئول تدارکات', 'کارشناس ابزار دقیق', 'سایر']).map((pos, idx) => (
                          <option key={idx} value={pos}>{pos}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'phone', 'تلفن ثابت')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'phone')}
                        value={custPhone}
                        onChange={(e) => setCustPhone(e.target.value)}
                        placeholder="مثال: 02122334455"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'mobile', 'تلفن همراه')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'mobile')}
                        value={custMobile}
                        onChange={(e) => setCustMobile(e.target.value)}
                        placeholder="مثال: 09121112233"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'email', 'ایمیل')}</label>
                      <input
                        type="email"
                        required={isFieldRequired(settings, 'customers', 'email')}
                        value={custEmail}
                        onChange={(e) => setCustEmail(e.target.value)}
                        placeholder="مثال: m.razavi@example.com"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'province', 'استان')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'province')}
                        value={custProvince}
                        onChange={(e) => setCustProvince(e.target.value)}
                        placeholder="مثال: اصفهان"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'address', 'آدرس دقیق')}</label>
                  <textarea
                    rows={2}
                    value={custAddress}
                    onChange={(e) => setCustAddress(e.target.value)}
                    placeholder="نشانی پستی دقیق..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">یادداشتها</label>
                  <textarea
                    rows={2}
                    value={custNotes}
                    onChange={(e) => setCustNotes(e.target.value)}
                    placeholder="توضیحات تکمیلی یا یادداشت‌های خاص..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">برچسبها</label>
                  <input
                    type="text"
                    value={custTags}
                    onChange={(e) => setCustTags(e.target.value)}
                    placeholder="برچسب‌ها را با کاما جدا کنید (مثال: کارفرما، خوش‌حساب، EPC)"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">وضعیت پرونده</label>
                  <select
                    value={custStatus}
                    onChange={(e) => setCustStatus(e.target.value as any)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    {(settings.dropdownItems?.customerStatuses || ['فعال', 'غیرفعال']).map((s, idx) => (
                      <option key={idx} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Relationship selector */}
                {customers.length > 0 && (
                  <div className="space-y-1.5 md:col-span-2 p-3 bg-slate-50 border border-slate-150 rounded-xl">
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      {custType === 'حقوقی' ? 'تعریف ارتباط با اشخاص حقیقی مرتبط' : 'تعریف ارتباط با شرکت‌های (حقوقی) مرتبط'}
                    </label>
                    <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-white space-y-1">
                      {customers
                        .filter(c => c.customerType === (custType === 'حقوقی' ? 'حقیقی' : 'حقوقی'))
                        .map(c => {
                          const name = c.customerType === 'حقوقی' ? c.companyName : `${c.firstName || ''} ${c.lastName || ''}`.trim();
                          const isChecked = selectedLinks.includes(c.id);
                          return (
                            <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 p-1.5 rounded transition">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedLinks(selectedLinks.filter(id => id !== c.id));
                                  } else {
                                    setSelectedLinks([...selectedLinks, c.id]);
                                  }
                                }}
                                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                              />
                              <span className="font-semibold">{name}</span>
                            </label>
                          );
                        })}
                      {customers.filter(c => c.customerType === (custType === 'حقوقی' ? 'حقیقی' : 'حقوقی')).length === 0 && (
                        <span className="text-xs text-slate-400 block text-center py-2">هیچ مخاطبی با ماهیت مخالف جهت اتصال یافت نشد.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Custom Fields */}
              <div className="pt-3 border-t border-slate-100">
                <CustomFieldsForm
                  module="customers"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>
            </div>
          )}

          {/* -------------------- PROJECT FORM -------------------- */}
          {type === 'project' && (
            <div className="space-y-6">
              {/* Section 1: General Info */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-sky-500 pr-2">اطلاعات عمومی پروژه</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'name', 'عنوان کامل پروژه / نام پروژه')}</label>
                    <input
                      type="text"
                      required={isFieldRequired(settings, 'projects', 'name')}
                      value={projName}
                      onChange={(e) => setProjName(e.target.value)}
                      placeholder="مثال: نوسازی تجهیزات کنترل نیروگاه ری"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    />
                  </div>

                   <div className="space-y-1.5">
                     <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'customerId', 'نام مشتری / کارفرما')}</label>
                     <div className="flex gap-1.5 items-center">
                       <select
                         value={projCustomerId}
                         onChange={(e) => setProjCustomerId(e.target.value)}
                         required={isFieldRequired(settings, 'projects', 'customerId')}
                         className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                       >
                         <option value="">-- انتخاب مشتری --</option>
                         {customers.map(c => (
                           <option key={c.id} value={c.id}>{c.companyName}</option>
                         ))}
                       </select>
                       {addCustomer && (
                         <button
                           type="button"
                           onClick={() => {
                             setNestedCustomerTarget('projCustomerId');
                             setNestedQuickAddType('customer');
                           }}
                           className="px-2 py-1.5 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                           title="تعریف سریع مشتری جدید"
                         >
                           <Plus size={14} />
                         </button>
                       )}
                     </div>
                   </div>

                   <div className="space-y-1.5">
                     <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'endUser', 'مصرف‌کننده نهایی')}</label>
                     <div className="flex gap-1.5 items-center">
                       <select
                         value={projEndUser}
                         onChange={(e) => setProjEndUser(e.target.value)}
                         className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                       >
                         <option value="">-- انتخاب مصرف‌کننده (مشتری) --</option>
                         {customers.map(c => (
                           <option key={c.id} value={c.id}>{c.companyName}</option>
                         ))}
                       </select>
                       {addCustomer && (
                         <button
                           type="button"
                           onClick={() => {
                             setNestedCustomerTarget('projEndUser');
                             setNestedQuickAddType('customer');
                           }}
                           className="px-2 py-1.5 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                           title="تعریف سریع مشتری جدید"
                         >
                           <Plus size={14} />
                         </button>
                       )}
                     </div>
                   </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'salesExpert', 'کارشناس فروش')}</label>
                    <select
                      value={projSalesExpert}
                      onChange={(e) => setProjSalesExpert(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      <option value="">-- انتخاب کارشناس فروش --</option>
                      {users && users.length > 0 ? (
                        users.map(u => (
                          <option key={u.id} value={u.fullName}>{u.fullName}</option>
                        ))
                      ) : (
                        (settings.dropdownItems?.salesExperts || []).map((exp, idx) => (
                          <option key={idx} value={exp}>{exp}</option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'customerInquiryNumber', 'شماره استعلام مشتری')}</label>
                    <input
                      type="text"
                      value={projCustomerInquiryNumber}
                      onChange={(e) => setProjCustomerInquiryNumber(e.target.value)}
                      placeholder="مثال: ۱۲۴-۹۹-الف"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Marketing & Lead Tracking */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-indigo-500 pr-2">کانال بازاریابی و کیفیت سرنخ (لید)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'marketingChannel', 'کانال بازاریابی')}</label>
                    <select
                      value={projMarketingChannel}
                      onChange={(e) => setProjMarketingChannel(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.marketingChannels || ['تماس مستقیم', 'نمایشگاه تجاری', 'وب‌سایت / آنلاین', 'معرفی', 'مناقصه رسمی', 'سایر']).map((ch, idx) => (
                        <option key={idx} value={ch}>{ch}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'leadQuality', 'کیفیت لید')}</label>
                    <select
                      value={projLeadQuality}
                      onChange={(e) => setProjLeadQuality(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.leadQualities || ['عالی (گرم)', 'متوسط', 'ضعیف (سرد)']).map((q, idx) => (
                        <option key={idx} value={q}>{q}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'referrerName', 'نام معرف (در صورت وجود)')}</label>
                    <input
                      type="text"
                      value={projReferrerName}
                      onChange={(e) => setProjReferrerName(e.target.value)}
                      placeholder="نام شخص یا سازمان معرفی‌کننده"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">روش ارتباط اصلی</label>
                    <select
                      value={projCommunicationMethod}
                      onChange={(e) => setProjCommunicationMethod(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.communicationMethods || ['تلفن', 'ایمیل', 'جلسه حضوری', 'مکاتبه رسمی', 'شبکه‌های اجتماعی']).map((m, idx) => (
                        <option key={idx} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 3: Key Persons */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-amber-500 pr-2">افراد کلیدی مشتری</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'financialContact', 'فرد کلیدی مالی')}</label>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={projFinancialContact}
                        onChange={(e) => setProjFinancialContact(e.target.value)}
                        required={isFieldRequired(settings, 'projects', 'financialContact')}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب فرد مالی (مشتری) --</option>
                        {(() => {
                          const selectedCustObj = customers.find(c => c.id === projCustomerId);
                          let filtered = customers.filter(c => c.customerType === 'حقیقی');
                          if (selectedCustObj) {
                            if (selectedCustObj.customerType === 'حقوقی') {
                              filtered = filtered.filter(c => selectedCustObj.linkedCustomerIds?.includes(c.id));
                            } else {
                              filtered = filtered.filter(c => c.id === selectedCustObj.id || selectedCustObj.linkedCustomerIds?.includes(c.id));
                            }
                          }
                          return filtered.map(c => {
                            const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
                            return (
                              <option key={c.id} value={c.id}>{name}</option>
                            );
                          });
                        })()}
                      </select>
                      {addCustomer && (
                        <button
                          type="button"
                          onClick={() => {
                            setNestedCustomerTarget('projFinancialContact');
                            setNestedQuickAddType('customer');
                          }}
                          className="px-2 py-1.5 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'technicalContact', 'فرد کلیدی فنی')}</label>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={projTechnicalContact}
                        onChange={(e) => setProjTechnicalContact(e.target.value)}
                        required={isFieldRequired(settings, 'projects', 'technicalContact')}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب فرد فنی (مشتری) --</option>
                        {(() => {
                          const selectedCustObj = customers.find(c => c.id === projCustomerId);
                          let filtered = customers.filter(c => c.customerType === 'حقیقی');
                          if (selectedCustObj) {
                            if (selectedCustObj.customerType === 'حقوقی') {
                              filtered = filtered.filter(c => selectedCustObj.linkedCustomerIds?.includes(c.id));
                            } else {
                              filtered = filtered.filter(c => c.id === selectedCustObj.id || selectedCustObj.linkedCustomerIds?.includes(c.id));
                            }
                          }
                          return filtered.map(c => {
                            const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
                            return (
                              <option key={c.id} value={c.id}>{name}</option>
                            );
                          });
                        })()}
                      </select>
                      {addCustomer && (
                        <button
                          type="button"
                          onClick={() => {
                            setNestedCustomerTarget('projTechnicalContact');
                            setNestedQuickAddType('customer');
                          }}
                          className="px-2 py-1.5 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 4: Project Dates & Timeline */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-teal-500 pr-2">زمان‌بندی عمومی پروژه</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <ShamsiDatePicker
                      label="تاریخ ایجاد فرصت (ثبت در CRM) *"
                      required
                      value={projOpportunityDate}
                      onChange={(val) => setProjOpportunityDate(val)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <ShamsiDatePicker
                      label={`موعد مقرر تحویل عمومی (تعهد تحویل کالا)${getFieldAsterisk(settings, 'projects', 'expectedCloseDate')}`}
                      required={isFieldRequired(settings, 'projects', 'expectedCloseDate')}
                      value={projExpectedCloseDate}
                      onChange={(val) => setProjExpectedCloseDate(val)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 5: Status & Outcomes */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-rose-500 pr-2">نتیجه پروژه و وضعیت ابلاغ قرارداد</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">نتیجه پروژه (مرحله پیشرفت فرصت)</label>
                    <select
                      value={projStatus}
                      onChange={(e) => handleProjStatusChange(e.target.value as Project['status'])}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.projectStatuses || ['جدید', 'در حال مذاکره', 'ارائه پیش‌فاکتور', 'برنده (موفق)', 'نیمه برنده', 'باخته', 'لغو شده']).map((st, idx) => (
                        <option key={idx} value={st}>{st}</option>
                      ))}
                    </select>
                  </div>

                  {projStatus === 'باخته' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-rose-500">دلیل باخت پروژه *</label>
                      <select
                        value={projLossReason}
                        onChange={(e) => setProjLossReason(e.target.value)}
                        required
                        className="w-full border border-rose-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب دلیل باخت --</option>
                        {settings.lossReasons?.map((reason, i) => (
                          <option key={i} value={reason}>{reason}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(projStatus === 'برنده (موفق)' || projStatus === 'نیمه برنده') && (
                    <div className="space-y-1.5">
                      <ShamsiDatePicker
                        label="تاریخ برنده شدن (ابلاغ قرارداد) *"
                        required
                        value={projWinningDate}
                        onChange={(val) => setProjWinningDate(val)}
                      />
                    </div>
                  )}

                  {(projStatus === 'برنده (موفق)' || projStatus === 'نیمه برنده') && (
                    <div className="space-y-1.5">
                      <ShamsiDatePicker
                        label="تاریخ توافق‌شده تحویل نهایی *"
                        required
                        value={projAgreedDeliveryDate}
                        onChange={(val) => setProjAgreedDeliveryDate(val)}
                      />
                    </div>
                  )}

                  {(projStatus === 'برنده (موفق)' || projStatus === 'نیمه برنده' || projStatus === 'باخته' || projStatus === 'لغو شده') && (
                    <div className="space-y-1.5">
                      <ShamsiDatePicker
                        label="تاریخ بسته شدن پرونده *"
                        required
                        value={projClosingDate}
                        onChange={(val) => setProjClosingDate(val)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Products Needed Block */}
              {products.length > 0 && (
                <div className="space-y-3 pt-3">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-700">محصولات یا اقلام درخواستی کارفرما / مشتری</label>
                    <div className="flex gap-2 items-center">
                      {addProduct && (
                        <button
                          type="button"
                          onClick={() => {
                            setNestedProductIndex(null);
                            setNestedQuickAddType('product');
                          }}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded text-[10px] font-bold flex items-center gap-1 transition"
                        >
                          <Plus size={12} />
                          تعریف سریع کالا
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddItemLine}
                        className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded text-[10px] font-bold flex items-center gap-1 transition"
                      >
                        <Plus size={12} />
                        افزودن ردیف محصول
                      </button>
                    </div>
                  </div>

                  {projItemsNeeded.length > 0 ? (
                    <div className="space-y-2">
                      {projItemsNeeded.map((item, index) => (
                        <div key={index} className="flex gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-150">
                          <div className="flex-1 flex gap-1.5 items-center">
                            <select
                              value={item.productId}
                              onChange={(e) => handleItemProductChange(index, e.target.value)}
                              className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs bg-white text-right min-w-0"
                            >
                              {products.map(p => (
                                <option key={p.id} value={p.id}>{p.displayName}{''}</option>
                              ))}
                            </select>

                          </div>
                          <div className="w-20">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => handleItemQuantityChange(index, Number(e.target.value))}
                              placeholder="تعداد"
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-center font-mono"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveItemLine(index)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-400 text-xs">
                      هیچ ردیف محصولی به پروژه اضافه نشده است.
                    </div>
                  )}
                </div>
              )}

              {/* Custom Fields */}
              <div className="pt-3 border-t border-slate-100">
                <CustomFieldsForm
                  module="projects"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>
            </div>
          )}

          {/* -------------------- SUPPLIER FORM -------------------- */}
          {type === 'supplier' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'name', 'نام کمپانی تأمین‌کننده (انگلیسی/فارسی)')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'name')}
                    value={suppName}
                    onChange={(e) => setSuppName(e.target.value)}
                    placeholder="مثال: WIKA Instruments"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'country', 'کشور مبدا تولید / دفتر توزیع')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'country')}
                    value={suppCountry}
                    onChange={(e) => setSuppCountry(e.target.value)}
                    placeholder="مثال: آلمان، امارات، ژاپن"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'contactName', 'کارشناس فروش یا نماینده کمپانی')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'contactName')}
                    value={suppContact}
                    onChange={(e) => setSuppContact(e.target.value)}
                    placeholder="مثال: Mr. David Miller"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">وضعیت همکاری</label>
                  <select
                    value={suppStatus}
                    onChange={(e) => setSuppStatus(e.target.value as Supplier['status'])}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    {(settings.dropdownItems?.customerStatuses || ['فعال', 'غیرفعال']).map((s, idx) => (
                      <option key={idx} value={s as any}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'phone', 'شماره تلفن بین‌المللی')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'phone')}
                    value={suppPhone}
                    onChange={(e) => setSuppPhone(e.target.value)}
                    placeholder="مثال: 00499372132"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'email', 'پست الکترونیکی رسمی (ایمیل)')}</label>
                  <input
                    type="email"
                    required={isFieldRequired(settings, 'suppliers', 'email')}
                    value={suppEmail}
                    onChange={(e) => setSuppEmail(e.target.value)}
                    placeholder="مثال: export@wika.de"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                  />
                </div>

                {/* Provided Product Categories */}
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">دسته محصولات قابل ارائه</label>
                  <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                    {(settings.dropdownItems?.categories || ['کنترلر و PLC', 'سنسور و ترانسمیتر', 'فلومتر و ابزار جریان', 'شیرآلات صنعتی', 'اتصالات و متریال نصب', 'تجهیزات هیدرولیک', 'سایر']).map((cat, i) => {
                      const isSelected = suppProvidedCategories.includes(cat);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSuppProvidedCategories(suppProvidedCategories.filter(c => c !== cat));
                            } else {
                              setSuppProvidedCategories([...suppProvidedCategories, cat]);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 border ${
                            isSelected 
                              ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-xs' 
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-1 h-1 rounded-full ${isSelected ? 'bg-sky-500' : 'bg-slate-300'}`} />
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Description */}
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">توضیحات</label>
                  <textarea
                    value={suppDescription}
                    onChange={(e) => setSuppDescription(e.target.value)}
                    placeholder="توضیحات تکمیلی، نمایندگی‌ها و نکات مربوط به تامین‌کننده..."
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>
              </div>

              {/* Custom Fields */}
              <div className="pt-3 border-t border-slate-100">
                <CustomFieldsForm
                  module="suppliers"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>
            </div>
          )}

          {/* -------------------- PRODUCT FORM -------------------- */}
          {type === 'product' && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'category', 'دسته‌بندی تخصصی ابزاردقیق')}</label>
                <select
                  value={prodCategory}
                  onChange={(e) => setProdCategory(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                >
                  {(settings.dropdownItems?.categories || ['کنترلر و PLC', 'سنسور و ترانسمیتر', 'فلومتر و ابزار جریان', 'شیرآلات صنعتی', 'اتصالات و متریال نصب', 'تجهیزات هیدرولیک', 'سایر']).map((cat, i) => (
                    <option key={i} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'displayName', 'نوع تجهیز و نام کالا')}</label>
                <input
                  type="text"
                  required={isFieldRequired(settings, 'products', 'displayName')}
                  value={prodDisplayName}
                  onChange={(e) => setProdDisplayName(e.target.value)}
                  placeholder="مثال: ترانسمیتر اختلاف فشار (DP Transmitter)"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'brand', 'برند (سازنده)')}</label>
                <input
                  type="text"
                  required={isFieldRequired(settings, 'products', 'brand')}
                  value={prodBrand}
                  onChange={(e) => setProdBrand(e.target.value)}
                  placeholder="مثال: WIKA, Rosemount"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">سایز (Size)</label>
                  <input
                    type="text"
                    value={prodSize}
                    onChange={(e) => setProdSize(e.target.value)}
                    placeholder="مثال: '2 یا DN50"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-medium"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">رنج اندازه‌گیری (Range)</label>
                  <input
                    type="text"
                    value={prodMeasurementRange}
                    onChange={(e) => setProdMeasurementRange(e.target.value)}
                    placeholder="مثال: 0 to 10 bar"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-medium"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'supplyType', 'نوع تامین')}</label>
                  <select
                    value={prodSupplyType}
                    onChange={(e) => setProdSupplyType(e.target.value as 'INVENTORY' | 'ORDER')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    <option value="INVENTORY">موجود در انبار</option>
                    <option value="ORDER">قابل سفارش</option>
                  </select>
                </div>
                {prodSupplyType === 'INVENTORY' && (
                  <div className="space-y-1.5 border-t border-slate-100 pt-3 mt-3">
                    <label className="text-xs font-semibold text-emerald-600">موجودی اولیه در انبار</label>
                    <input
                      type="number"
                      min="0"
                      value={prodInitialStock}
                      onChange={(e) => setProdInitialStock(e.target.value)}
                      placeholder="0"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none text-right font-medium bg-emerald-50/30"
                    />
                  </div>
                )}
              </div>



              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'description', 'مشخصات فنی و توضیحات')}</label>
                <textarea
                  rows={4}
                  required={isFieldRequired(settings, 'products', 'description')}
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                  placeholder="جزئیات متریال بدنه، اتصالات، کلاس کاری، رنج فشار یا دما، سیگنال خروجی و گواهینامه‌ها..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right leading-relaxed"
                />
              </div>

              {/* Product Images */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">تصاویر محصول</label>
                <div className="border-2 border-dashed border-slate-250 hover:border-sky-500 rounded-xl p-4 transition text-center cursor-pointer bg-slate-50/50 hover:bg-slate-50 relative">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files) {
                        for (const file of Array.from(files) as File[]) {
                          try {
                            const url = await uploadFile(file);
                            setProdImages(prev => [...prev, url]);
                          } catch (err: any) {
                            alert(err.message || 'خطا در بارگذاری تصویر محصول');
                          }
                        }
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                  />
                  <div className="text-slate-500 space-y-1">
                    <div className="text-xs font-bold text-slate-700">انتخاب یا رها کردن تصاویر کالا</div>
                    <div className="text-[10px] text-slate-400">فرمت‌های تصویری (JPG, PNG) - ذخیره‌سازی محلی</div>
                  </div>
                </div>

                {/* Thumbnail Previews */}
                {prodImages.length > 0 && (
                  <div className="grid grid-cols-4 gap-3 pt-2">
                    {prodImages.map((img, idx) => (
                      <div key={idx} className="relative group aspect-square rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                        <img
                          src={img}
                          alt={`Product image ${idx + 1}`}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <button
                          type="button"
                          onClick={() => setProdImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition shadow-sm hover:bg-red-700 z-20"
                          title="حذف تصویر"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Custom Fields */}
              <div className="pt-3 border-t border-slate-100">
                <CustomFieldsForm
                  module="products"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 bg-white sticky bottom-0 z-10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition"
            >
              انصراف
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-lg shadow-sm shadow-sky-600/10 flex items-center gap-1.5 transition"
            >
              <Plus size={14} />
              ثبت و اضافه شدن خودکار
            </button>
          </div>
        </form>
      </div>

      {nestedQuickAddType && (
        <QuickAddModal
          isOpen={!!nestedQuickAddType}
          onClose={() => {
            setNestedQuickAddType(null);
            setNestedCustomerTarget(null);
            setNestedProductIndex(null);
          }}
          type={nestedQuickAddType}
          settings={settings}
          customers={customers}
          addCustomer={addCustomer}
          products={products}
          addProduct={addProduct}
          users={users}
          initialCustType={(nestedCustomerTarget === 'projFinancialContact' || nestedCustomerTarget === 'projTechnicalContact') ? 'حقیقی' : undefined}
          initialLinkedCustomerIds={((nestedCustomerTarget === 'projFinancialContact' || nestedCustomerTarget === 'projTechnicalContact') && projCustomerId) ? [projCustomerId] : undefined}
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              if (nestedQuickAddType === 'customer') {
                if (nestedCustomerTarget === 'projCustomerId') {
                  setProjCustomerId(newEntity.id);
                } else if (nestedCustomerTarget === 'projEndUser') {
                  setProjEndUser(newEntity.id);
                } else if (nestedCustomerTarget === 'projFinancialContact') {
                  setProjFinancialContact(newEntity.id);
                } else if (nestedCustomerTarget === 'projTechnicalContact') {
                  setProjTechnicalContact(newEntity.id);
                }
              } else if (nestedQuickAddType === 'product' && nestedProductIndex !== null) {
                const current = [...projItemsNeeded];
                current[nestedProductIndex].productId = newEntity.id;
                current[nestedProductIndex].name = newEntity.displayName || newEntity.name || '';
                setProjItemsNeeded(current);
              }
            }
            setNestedQuickAddType(null);
            setNestedCustomerTarget(null);
            setNestedProductIndex(null);
          }}
        />
      )}
    </div>
  );
}
