import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Truck, 
  Globe, 
  Mail, 
  Phone, 
  Edit, 
  Trash2, 
  FileText, 
  X,
  CreditCard,
  FileSpreadsheet,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { Supplier, ERPSettings } from '../types';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import { exportToCSV } from '../excelUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import ConfirmModal from './ConfirmModal';

interface SuppliersViewProps {
  suppliers: Supplier[];
  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt'> & { customValues?: Record<string, any> }) => void;
  updateSupplier: (supplier: Supplier) => void;
  deleteSupplier: (id: string) => void;
  settings: ERPSettings;
}

export default function SuppliersView({
  suppliers,
  addSupplier,
  updateSupplier,
  deleteSupplier,
  settings
}: SuppliersViewProps) {
  const [search, setSearch] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);
  const [isSupplierModalFullscreen, setIsSupplierModalFullscreen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  // Dynamic Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [supplierToDeleteId, setSupplierToDeleteId] = useState<string | null>(null);
  const [supplierToDeleteName, setSupplierToDeleteName] = useState<string>('');

  // Form states
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [status, setStatus] = useState<Supplier['status']>('فعال');
  const [providedCategories, setProvidedCategories] = useState<string[]>([]);
  const [description, setDescription] = useState('');

  // Open add
  const handleOpenAdd = () => {
    setEditingSupplier(null);
    setName('');
    setCountry('');
    setContactName('');
    setPhone('');
    setEmail('');
    setWebsite('');
    setPaymentTerms('');
    setStatus('فعال');
    setProvidedCategories([]);
    setDescription('');
    setCustomValues({});
    setShowModal(true);
  };

  // Open edit
  const handleOpenEdit = (supp: Supplier) => {
    setEditingSupplier(supp);
    setName(supp.name);
    setCountry(supp.country);
    setContactName(supp.contactName);
    setPhone(supp.phone || '');
    setEmail(supp.email || '');
    setWebsite(supp.website || '');
    setPaymentTerms(supp.paymentTerms || '');
    setStatus(supp.status);
    setProvidedCategories(supp.providedCategories || []);
    setDescription(supp.description || '');
    setCustomValues(supp.customValues || {});
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    // Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === 'suppliers');
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }

    const data = {
      name,
      country,
      contactName,
      phone,
      email,
      website,
      paymentTerms,
      status,
      providedCategories,
      description,
      customValues
    };

    if (editingSupplier) {
      updateSupplier({
        ...editingSupplier,
        ...data
      });
    } else {
      addSupplier(data);
    }
    setShowModal(false);
    setIsSupplierModalFullscreen(false);
  };

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = !search || 
      (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.country || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.contactName || '').toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    // Column-specific filters
    return Object.entries(colFilters).every(([colId, filterValue]) => {
      if (!filterValue) return true;
      const fVal = String(filterValue).toLowerCase();
      if (colId === 'name') {
        return (s.name || '').toLowerCase().includes(fVal);
      }
      if (colId === 'country') {
        return (s.country || '').toLowerCase().includes(fVal);
      }
      if (colId === 'contactName') {
        return (s.contactName || '').toLowerCase().includes(fVal);
      }
      if (colId === 'phone') {
        return (s.phone || '').toLowerCase().includes(fVal);
      }
      if (colId === 'email') {
        return (s.email || '').toLowerCase().includes(fVal);
      }
      if (colId === 'providedCategories') {
        return (s.providedCategories || []).some(cat => (cat || '').toLowerCase().includes(fVal));
      }
      if (colId === 'description') {
        return (s.description || '').toLowerCase().includes(fVal);
      }
      if (colId === 'status') {
        return (s.status || '').toLowerCase().includes(fVal);
      }
      return true;
    });
  });

  const handleExportExcel = () => {
    const headers = [
      'نام شرکت',
      'کشور مبدأ',
      'مخاطب فروش',
      'تلفن کمپانی',
      'پست الکترونیک',
      'دسته محصولات قابل ارائه',
      'توضیحات',
      'وضعیت'
    ];

    const rows = filteredSuppliers.map(s => [
      s.name,
      s.country,
      s.contactName,
      s.phone || '',
      s.email || '',
      s.providedCategories ? s.providedCategories.join('، ') : '',
      s.description || '',
      s.status
    ]);

    exportToCSV('گزارش_تامین_کنندگان', headers, rows);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* View Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">تأمین‌کنندگان خارجی و شرکا</h1>
          <p className="text-slate-500 text-sm mt-1">مدیریت لیست سازندگان معتبر جهانی تجهیزات ابزاردقیق، دسته‌بندی محصولات ارائه شده و کانال‌های مکاتباتی</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button 
            onClick={handleExportExcel}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-emerald-500/15 flex items-center gap-2"
          >
            <FileSpreadsheet size={16} />
            خروجی اکسل
          </button>
          <button 
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center gap-2"
          >
            <Plus size={16} />
            ثبت تأمین‌کننده جدید
          </button>
        </div>
      </div>

      {/* Search Filter */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="relative w-full">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="جستجو در نام شرکت سازنده، کشور مبدا یا نام نماینده خارجی..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
          />
        </div>
      </div>

      {/* Suppliers Table List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                <th className="p-3">نام شرکت / سازنده</th>
                <th className="p-3">کشور مبدأ</th>
                <th className="p-3">نماینده و مخاطب فروش</th>
                <th className="p-3">تلفن کمپانی</th>
                <th className="p-3">پست الکترونیک</th>
                <th className="p-3">دسته محصولات قابل ارائه</th>
                <th className="p-3">توضیحات</th>
                <th className="p-3">وضعیت</th>
                <th className="p-3">فیلدهای سفارشی</th>
                <th className="p-3 text-center w-24">عملیات</th>
              </tr>
              {/* Column Filters Row */}
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر نام..."
                    value={colFilters.name || ''}
                    onChange={(e) => setColFilters({...colFilters, name: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر کشور..."
                    value={colFilters.country || ''}
                    onChange={(e) => setColFilters({...colFilters, country: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر مخاطب..."
                    value={colFilters.contactName || ''}
                    onChange={(e) => setColFilters({...colFilters, contactName: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر تلفن..."
                    value={colFilters.phone || ''}
                    onChange={(e) => setColFilters({...colFilters, phone: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white text-left font-mono"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر ایمیل..."
                    value={colFilters.email || ''}
                    onChange={(e) => setColFilters({...colFilters, email: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white text-left font-mono"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر دسته‌بندی..."
                    value={colFilters.providedCategories || ''}
                    onChange={(e) => setColFilters({...colFilters, providedCategories: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر توضیحات..."
                    value={colFilters.description || ''}
                    onChange={(e) => setColFilters({...colFilters, description: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر وضعیت..."
                    value={colFilters.status || ''}
                    onChange={(e) => setColFilters({...colFilters, status: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white text-center"
                  />
                </th>
                <th className="p-2"></th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {filteredSuppliers.map((supp) => (
                <tr key={supp.id} className="hover:bg-slate-50/50 transition">
                  {/* Name & Web */}
                  <td className="p-3 font-bold text-slate-900">
                    <div>{supp.name}</div>
                  </td>

                  {/* Country */}
                  <td className="p-3">
                    <span className="flex items-center gap-1">
                      <Globe size={12} className="text-slate-400" />
                      <span>{supp.country}</span>
                    </span>
                  </td>

                  {/* Contact Name */}
                  <td className="p-3 font-medium text-slate-700">
                    {supp.contactName}
                  </td>

                  {/* Phone */}
                  <td className="p-3 font-mono text-slate-600 text-left">
                    {supp.phone || <span className="text-slate-300 font-sans">-</span>}
                  </td>

                  {/* Email */}
                  <td className="p-3 font-mono text-slate-500 text-left">
                    {supp.email || <span className="text-slate-300 font-sans">-</span>}
                  </td>

                  {/* Provided Product Categories */}
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {supp.providedCategories && supp.providedCategories.length > 0 ? (
                        supp.providedCategories.map((cat, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-100 text-[10px] font-bold">
                            {cat}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </div>
                  </td>

                  {/* Description */}
                  <td className="p-3 text-slate-500 max-w-[150px] truncate" title={supp.description}>
                    {supp.description || <span className="text-slate-300">-</span>}
                  </td>

                  {/* Status Badge */}
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                      supp.status === 'فعال' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {supp.status}
                    </span>
                  </td>

                  {/* Custom Fields */}
                  <td className="p-3">
                    <CustomFieldsDetailView
                      module="suppliers"
                      customFields={settings?.customFields || []}
                      customValues={supp.customValues}
                    />
                  </td>

                  {/* Actions */}
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleOpenEdit(supp)}
                        className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-sky-600 rounded transition"
                        title="ویرایش تأمین‌کننده"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setSupplierToDeleteId(supp.id);
                          setSupplierToDeleteName(supp.name);
                          setDeleteConfirmOpen(true);
                        }}
                        className="p-1.5 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded transition"
                        title="حذف پرونده"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredSuppliers.length === 0 && (
          <div className="text-center bg-white p-12 border-t border-slate-100 w-full">
            <Truck className="mx-auto text-slate-300 mb-3" size={48} />
            <p className="text-sm text-slate-500 font-medium">تأمین‌کننده‌ای یافت نشد.</p>
            {Object.values(colFilters).some(Boolean) && (
              <button
                onClick={() => setColFilters({})}
                className="mt-3 text-xs text-sky-600 hover:underline font-bold"
              >
                پاک کردن فیلترهای ستونی
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isSupplierModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isSupplierModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-xl my-4'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800">
                {editingSupplier ? `ویرایش پرونده تأمین‌کننده: ${editingSupplier.name}` : 'افزودن کمپانی تأمین‌کننده جدید'}
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsSupplierModalFullscreen(!isSupplierModalFullscreen)}
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isSupplierModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isSupplierModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowModal(false); setIsSupplierModalFullscreen(false); }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className={`p-6 space-y-4 overflow-y-auto flex-1 text-right ${isSupplierModalFullscreen ? '' : 'max-h-[75vh]'}`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Company Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'name', 'نام کمپانی تأمین‌کننده (انگلیسی/فارسی)')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'name')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: WIKA Instruments"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left"
                  />
                </div>

                {/* Country */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'country', 'کشور مبدا تولید / دفتر توزیع')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'country')}
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="مثال: آلمان، امارات، ژاپن"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* Contact Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'contactName', 'کارشناس فروش یا نماینده کمپانی')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'contactName')}
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="مثال: Mr. David Miller"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'status', 'وضعیت همکاری')}</label>
                  <select
                    value={status}
                    required={isFieldRequired(settings, 'suppliers', 'status')}
                    onChange={(e) => setStatus(e.target.value as Supplier['status'])}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    {(settings.dropdownItems?.customerStatuses || ['فعال', 'غیرفعال']).map((s, idx) => (
                      <option key={idx} value={s as any}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'phone', 'شماره تلفن بین‌المللی')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'suppliers', 'phone')}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="مثال: 00499372132"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'email', 'پست الکترونیکی رسمی (ایمیل)')}</label>
                  <input
                    type="email"
                    required={isFieldRequired(settings, 'suppliers', 'email')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="مثال: export@wika.de"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                  />
                </div>

                {/* Provided Product Categories */}
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'providedCategories', 'دسته محصولات قابل ارائه')}</label>
                  <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    {(settings.dropdownItems?.categories || ['کنترلر و PLC', 'سنسور و ترانسمیتر', 'فلومتر و ابزار جریان', 'شیرآلات صنعتی', 'اتصالات و متریال نصب', 'تجهیزات هیدرولیک', 'سایر']).map((cat, i) => {
                      const isSelected = providedCategories.includes(cat);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setProvidedCategories(providedCategories.filter(c => c !== cat));
                            } else {
                              setProvidedCategories([...providedCategories, cat]);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
                            isSelected 
                              ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-xs' 
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-sky-500' : 'bg-slate-300'}`} />
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Description */}
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'suppliers', 'description', 'توضیحات')}</label>
                  <textarea
                    value={description}
                    required={isFieldRequired(settings, 'suppliers', 'description')}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="توضیحات تکمیلی، نمایندگی‌ها و نکات مربوط به تامین‌کننده..."
                    rows={3}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* Dynamic Custom Fields Form Section */}
                <div className="col-span-1 md:col-span-2">
                  <CustomFieldsForm
                    module="suppliers"
                    customFields={settings?.customFields || []}
                    customValues={customValues}
                    onChange={setCustomValues}
                  />
                </div>

              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setIsSupplierModalFullscreen(false); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15"
                >
                  {editingSupplier ? 'ثبت تغییرات تأمین‌کننده' : 'ذخیره'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setSupplierToDeleteId(null);
          setSupplierToDeleteName('');
        }}
        onConfirm={() => {
          if (supplierToDeleteId) {
            deleteSupplier(supplierToDeleteId);
          }
        }}
        title="حذف پرونده تأمین‌کننده"
        message={`آیا از حذف پرونده تأمین‌کننده "${supplierToDeleteName}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      />

    </div>
  );
}
