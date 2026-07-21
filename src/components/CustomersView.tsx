import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Phone, 
  Mail, 
  MapPin, 
  Briefcase, 
  Edit, 
  Trash2, 
  UserPlus,
  Building,
  CheckCircle,
  XCircle,
  X,
  Users,
  User,
  Tag,
  Link2,
  FileText,
  FileSpreadsheet,
  ArrowLeft,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { Customer, ERPSettings } from '../types';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import { exportToCSV } from '../excelUtils';
import ConfirmModal from './ConfirmModal';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';

interface CustomersViewProps {
  customers: Customer[];
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt'>) => Customer;
  updateCustomer: (customer: Customer) => void;
  deleteCustomer: (id: string) => void;
  batchUpdateCustomers: (updatedList: Customer[]) => void;
  industries: string[];
  settings: ERPSettings;
  initialSearchQuery?: string | null;
  onClearInitialSearchQuery?: () => void;
}

export default function CustomersView({
  customers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  batchUpdateCustomers,
  industries,
  settings,
  initialSearchQuery,
  onClearInitialSearchQuery
}: CustomersViewProps) {
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    if (initialSearchQuery) {
      setSearch(initialSearchQuery);
      if (onClearInitialSearchQuery) {
        onClearInitialSearchQuery();
      }
    }
  }, [initialSearchQuery, onClearInitialSearchQuery]);
  const [selectedIndustry, setSelectedIndustry] = useState('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'حقوقی' | 'حقیقی'>('all');
  const [showModal, setShowModal] = useState(false);
  const [isCustomerModalFullscreen, setIsCustomerModalFullscreen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string>>({});

  // Dynamic Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [customerToDeleteId, setCustomerToDeleteId] = useState<string | null>(null);
  const [customerToDeleteName, setCustomerToDeleteName] = useState<string>('');

  // Link deletion confirm state
  const [linkDeleteConfirmOpen, setLinkDeleteConfirmOpen] = useState(false);
  const [linkToDeleteId, setLinkToDeleteId] = useState<string | null>(null);
  const [linkToDeleteName, setLinkToDeleteName] = useState<string>('');

  // Form states
  const [customerType, setCustomerType] = useState<Customer['customerType']>('حقوقی');
  const [status, setStatus] = useState<Customer['status']>('فعال');
  const [phone, setPhone] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [province, setProvince] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [moduleAgreements, setModuleAgreements] = useState<{id: string; moduleName: string; text: string; createdAt: string;}[]>([]);

  // Legal-specific (مشتری حقوقی)
  const [companyName, setCompanyName] = useState('');
  const [economicCode, setEconomicCode] = useState('');
  const [industry, setIndustry] = useState((settings.dropdownItems?.industries || industries)[0] || 'نفت و گاز');
  const [keyPerson, setKeyPerson] = useState('');

  // Individual-specific (مشتری حقیقی)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<'مرد' | 'زن' | ''>('');
  const [position, setPosition] = useState('');

  // Selection for relationships
  const [selectedLinks, setSelectedLinks] = useState<string[]>([]);
  const [relationSearch, setRelationSearch] = useState('');

  // Quick Add states inside Relationship block
  const [showQuickAddRelation, setShowQuickAddRelation] = useState(false);
  const [quickFirstName, setQuickFirstName] = useState('');
  const [quickLastName, setQuickLastName] = useState('');
  const [quickGender, setQuickGender] = useState<'مرد' | 'زن' | ''>('');
  const [quickPosition, setQuickPosition] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickMobile, setQuickMobile] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickProvince, setQuickProvince] = useState('');
  const [quickAddress, setQuickAddress] = useState('');
  const [quickNotes, setQuickNotes] = useState('');
  const [quickTags, setQuickTags] = useState('');

  // Legal-specific for Quick Add
  const [quickCompanyName, setQuickCompanyName] = useState('');
  const [quickEconomicCode, setQuickEconomicCode] = useState('');
  const [quickIndustry, setQuickIndustry] = useState((settings.dropdownItems?.industries || industries)[0] || 'نفت و گاز');
  const [quickKeyPerson, setQuickKeyPerson] = useState('');

  // Reset helper for quick add form
  const resetQuickForm = () => {
    setShowQuickAddRelation(false);
    setQuickFirstName('');
    setQuickLastName('');
    setQuickGender('');
    setQuickPosition('');
    setQuickPhone('');
    setQuickMobile('');
    setQuickEmail('');
    setQuickProvince('');
    setQuickAddress('');
    setQuickNotes('');
    setQuickTags('');
    setQuickCompanyName('');
    setQuickEconomicCode('');
    setQuickIndustry((settings.dropdownItems?.industries || industries)[0] || 'نفت و گاز');
    setQuickKeyPerson('');
  };

  // Quick customer creation handler
  const handleSaveQuickCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    
    const targetType: Customer['customerType'] = customerType === 'حقوقی' ? 'حقیقی' : 'حقوقی';
    
    const data: Partial<Customer> = {
      customerType: targetType,
      status: 'فعال',
      phone: quickPhone,
      mobile: quickMobile,
      email: quickEmail,
      province: quickProvince,
      address: quickAddress,
      notes: quickNotes,
      tags: quickTags,
      linkedCustomerIds: []
    };

    if (targetType === 'حقوقی') {
      if (!quickCompanyName.trim()) {
        alert('لطفاً نام شرکت را وارد کنید.');
        return;
      }
      data.companyName = quickCompanyName;
      data.economicCode = quickEconomicCode;
      data.industry = quickIndustry;
      data.keyPerson = quickKeyPerson;
      data.contactName = quickKeyPerson || '';
      data.contactLastName = '';
    } else {
      if (!quickFirstName.trim() || !quickLastName.trim()) {
        alert('لطفاً نام و نام خانوادگی را وارد کنید.');
        return;
      }
      data.firstName = quickFirstName;
      data.lastName = quickLastName;
      data.gender = quickGender;
      data.position = quickPosition;
      data.companyName = `${quickFirstName} ${quickLastName}`.trim();
      data.contactName = quickFirstName;
      data.contactLastName = quickLastName;
    }

    const created = addCustomer(data as Omit<Customer, 'id' | 'createdAt'>);
    if (created && created.id) {
      setSelectedLinks(prev => [...prev, created.id]);
      resetQuickForm();
    }
  };

  // Trigger modal for adding
  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setCustomerType('حقوقی');
    setStatus('فعال');
    setPhone('');
    setMobile('');
    setEmail('');
    setProvince('');
    setAddress('');
    setNotes('');
    setTags('');
    setModuleAgreements([]);

    setCompanyName('');
    setEconomicCode('');
    setIndustry((settings.dropdownItems?.industries || industries)[0] || 'نفت و گاز');
    setKeyPerson('');

    setFirstName('');
    setLastName('');
    setGender('');
    setPosition('');

    setSelectedLinks([]);
    setRelationSearch('');
    resetQuickForm();
    setCustomValues({});
    setShowModal(true);
  };

  // Trigger modal for editing
  const handleOpenEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setCustomerType(customer.customerType);
    setStatus(customer.status);
    setPhone(customer.phone || '');
    setMobile(customer.mobile || '');
    setEmail(customer.email || '');
    setProvince(customer.province || '');
    setAddress(customer.address || '');
    setNotes(customer.notes || '');
    setTags(customer.tags || '');
    setModuleAgreements(customer.moduleAgreements || []);

    setCompanyName(customer.companyName || '');
    setEconomicCode(customer.economicCode || '');
    setIndustry(customer.industry || (settings.dropdownItems?.industries || industries)[0] || 'نفت و گاز');
    setKeyPerson(customer.keyPerson || '');

    setFirstName(customer.firstName || '');
    setLastName(customer.lastName || '');
    setGender(customer.gender || '');
    setPosition(customer.position || '');

    setSelectedLinks(customer.linkedCustomerIds || []);
    setRelationSearch('');
    resetQuickForm();
    setCustomValues(customer.customValues || {});
    setShowModal(true);
  };

  // Bidirectional link helper
  const updateBidirectionalLinks = (customerId: string, newLinkedIds: string[]) => {
    // For every customer in the entire list
    customers.forEach(cust => {
      if (cust.id === customerId) return; // skip self

      const isCurrentlyLinked = cust.linkedCustomerIds?.includes(customerId);
      const shouldBeLinked = newLinkedIds.includes(cust.id);

      if (shouldBeLinked && !isCurrentlyLinked) {
        // Add link
        const updatedLinks = [...(cust.linkedCustomerIds || []), customerId];
        updateCustomer({ ...cust, linkedCustomerIds: updatedLinks });
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        // Remove link
        const updatedLinks = (cust.linkedCustomerIds || []).filter(id => id !== customerId);
        updateCustomer({ ...cust, linkedCustomerIds: updatedLinks });
      }
    });
  };

  // Handle Save
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Dynamic Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === 'customers');
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }

    let finalSelectedLinks = [...selectedLinks];
    let nextCustomers = [...customers];

    // 1. Auto-save inline quick-add form if there is input filled but not submitted yet
    if (showQuickAddRelation) {
      const targetType: Customer['customerType'] = customerType === 'حقوقی' ? 'حقیقی' : 'حقوقی';
      if (targetType === 'حقیقی') {
        if (quickFirstName.trim() || quickLastName.trim()) {
          const quickId = `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const quickData: Customer = {
            id: quickId,
            createdAt: new Date().toISOString(),
            customerType: 'حقیقی',
            status: 'فعال',
            phone: quickPhone,
            mobile: quickMobile,
            email: quickEmail,
            province: quickProvince,
            address: quickAddress,
            notes: quickNotes,
            tags: quickTags,
            linkedCustomerIds: [],
            firstName: quickFirstName,
            lastName: quickLastName,
            gender: quickGender,
            position: quickPosition,
            companyName: `${quickFirstName} ${quickLastName}`.trim(),
            contactName: quickFirstName,
            contactLastName: quickLastName
          };
          nextCustomers.unshift(quickData);
          finalSelectedLinks.push(quickId);
        }
      } else {
        if (quickCompanyName.trim()) {
          const quickId = `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const quickData: Customer = {
            id: quickId,
            createdAt: new Date().toISOString(),
            customerType: 'حقوقی',
            status: 'فعال',
            phone: quickPhone,
            mobile: quickMobile,
            email: quickEmail,
            province: quickProvince,
            address: quickAddress,
            notes: quickNotes,
            tags: quickTags,
            linkedCustomerIds: [],
            companyName: quickCompanyName,
            economicCode: quickEconomicCode,
            industry: quickIndustry,
            keyPerson: quickKeyPerson,
            contactName: quickKeyPerson || '',
            contactLastName: ''
          };
          nextCustomers.unshift(quickData);
          finalSelectedLinks.push(quickId);
        }
      }
    }

    // 2. Construct main customer data
    const mainId = editingCustomer ? editingCustomer.id : `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let mainCompanyName = '';
    let mainFirstName: string | undefined = undefined;
    let mainLastName: string | undefined = undefined;
    let mainGender: 'مرد' | 'زن' | '' | undefined = undefined;
    let mainPosition: string | undefined = undefined;
    let mainEconomicCode: string | undefined = undefined;
    let mainIndustry: string | undefined = undefined;
    let mainKeyPerson: string | undefined = undefined;
    let mainContactName = '';
    let mainContactLastName = '';

    if (customerType === 'حقوقی') {
      mainCompanyName = companyName;
      mainEconomicCode = economicCode;
      mainIndustry = industry;
      mainKeyPerson = keyPerson;
      mainContactName = keyPerson || '';
    } else {
      mainCompanyName = `${firstName} ${lastName}`.trim();
      mainFirstName = firstName;
      mainLastName = lastName;
      mainGender = gender;
      mainPosition = position;
      mainContactName = firstName;
      mainContactLastName = lastName;
    }

    const mainData: Customer = {
      id: mainId,
      createdAt: editingCustomer ? editingCustomer.createdAt : new Date().toISOString(),
      customerType,
      status,
      phone,
      mobile,
      email,
      province,
      address,
      notes,
      tags,
      moduleAgreements,
      linkedCustomerIds: finalSelectedLinks,
      customValues,
      companyName: mainCompanyName,
      firstName: mainFirstName,
      lastName: mainLastName,
      gender: mainGender,
      position: mainPosition,
      economicCode: mainEconomicCode,
      industry: mainIndustry,
      keyPerson: mainKeyPerson,
      contactName: mainContactName,
      contactLastName: mainContactLastName
    };

    // Insert or Update main customer in nextCustomers
    if (editingCustomer) {
      nextCustomers = nextCustomers.map(c => c.id === mainId ? mainData : c);
    } else {
      nextCustomers.unshift(mainData);
    }

    // 3. Update bidirectional links across all customers in nextCustomers
    nextCustomers = nextCustomers.map(cust => {
      if (cust.id === mainId) {
        return cust; // Already set correctly in mainData
      }

      const isCurrentlyLinked = cust.linkedCustomerIds?.includes(mainId);
      const shouldBeLinked = finalSelectedLinks.includes(cust.id);

      if (shouldBeLinked && !isCurrentlyLinked) {
        return {
          ...cust,
          linkedCustomerIds: [...(cust.linkedCustomerIds || []), mainId]
        };
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        return {
          ...cust,
          linkedCustomerIds: (cust.linkedCustomerIds || []).filter(id => id !== mainId)
        };
      }

      return cust;
    });

    // Save everything in one single atomic state/localstorage update!
    batchUpdateCustomers(nextCustomers);
    setShowModal(false);
    setIsCustomerModalFullscreen(false);
  };

  // Toggle link selection
  const handleToggleLink = (id: string) => {
    const isCurrentlyLinked = selectedLinks.includes(id);
    if (isCurrentlyLinked) {
      const targetCust = customers.find(c => c.id === id);
      const name = targetCust 
        ? (targetCust.customerType === 'حقوقی' ? targetCust.companyName : `${targetCust.firstName || ''} ${targetCust.lastName || ''}`.trim())
        : 'این مشتری';
      setLinkToDeleteId(id);
      setLinkToDeleteName(name);
      setLinkDeleteConfirmOpen(true);
    } else {
      setSelectedLinks(prev => [...prev, id]);
    }
  };

  // Filter and search logic
  const filteredCustomers = customers.filter(c => {
    const nameSearch = c.customerType === 'حقوقی' 
      ? (c.companyName || '').toLowerCase() 
      : `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    
    const matchesSearch = 
      nameSearch.includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.mobile || '').includes(search) ||
      (c.economicCode || '').includes(search) ||
      (c.keyPerson || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.position || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.tags || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.industry || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.province || '').toLowerCase().includes(search.toLowerCase());
    
    const matchesIndustry = selectedIndustry === 'all' || 
      (c.customerType === 'حقوقی' && c.industry === selectedIndustry);

    const matchesType = selectedTypeFilter === 'all' || c.customerType === selectedTypeFilter;

    if (!(matchesSearch && matchesIndustry && matchesType)) return false;

    // Custom Fields Filters
    const matchesCustom = (Object.entries(customFieldFilters) as [string, string][]).every(([fieldId, filterValue]) => {
      if (!filterValue) return true;
      const recordValue = c.customValues?.[fieldId] as any;
      if (recordValue === undefined || recordValue === null || recordValue === '') return false;

      const field = settings?.customFields?.find(f => f.id === fieldId);
      if (!field) return true;

      if (field.type === 'boolean') {
        return String(recordValue) === filterValue;
      }
      if (field.type === 'select') {
        return String(recordValue) === filterValue;
      }
      if (field.type === 'file') {
        if (filterValue === 'has_file') {
          return !!(recordValue && recordValue.name);
        } else if (filterValue === 'no_file') {
          return !(recordValue && recordValue.name);
        }
        return true;
      }
      return String(recordValue).toLowerCase().includes(filterValue.toLowerCase());
    });

    if (!matchesCustom) return false;

    // Column-specific filters
    return Object.entries(colFilters).every(([colId, filterValue]) => {
      if (!filterValue) return true;
      const fVal = String(filterValue).toLowerCase();
      if (colId === 'name') {
        const fullName = c.customerType === 'حقوقی' ? (c.companyName || '') : `${c.firstName || ''} ${c.lastName || ''}`;
        return fullName.toLowerCase().includes(fVal);
      }
      if (colId === 'type') {
        return c.customerType.toLowerCase().includes(fVal);
      }
      if (colId === 'industry') {
        const val = c.customerType === 'حقوقی' ? (c.industry || '') : (c.position || '');
        return val.toLowerCase().includes(fVal);
      }
      if (colId === 'keyPerson') {
        return (c.keyPerson || '').toLowerCase().includes(fVal);
      }
      if (colId === 'contact') {
        const contactStr = `${c.mobile || ''} ${c.phone || ''} ${c.email || ''}`;
        return contactStr.toLowerCase().includes(fVal);
      }
      if (colId === 'province') {
        return (c.province || '').toLowerCase().includes(fVal);
      }
      if (colId === 'tags') {
        return (c.tags || '').toLowerCase().includes(fVal);
      }
      return true;
    });
  });

  const handleExportExcel = () => {
    const headers = [
      'نوع مشتری',
      'نام شرکت / نام خانوادگی',
      'حوزه فعالیت / سمت',
      'شخص کلیدی',
      'تلفن همراه',
      'تلفن ثابت',
      'ایمیل',
      'استان',
      'کد اقتصادی / کد ملی',
      'برچسب‌ها'
    ];

    const rows = filteredCustomers.map(c => [
      c.customerType,
      c.customerType === 'حقوقی' ? c.companyName : `${c.firstName || ''} ${c.lastName || ''}`,
      c.customerType === 'حقوقی' ? c.industry : c.position,
      c.keyPerson || '',
      c.mobile || '',
      c.phone || '',
      c.email || '',
      c.province || '',
      c.economicCode || '',
      c.tags || ''
    ]);

    exportToCSV('گزارش_مشتریان', headers, rows);
  };

  // Get active candidates for relationship linking in modal
  const relationCandidates = customers.filter(c => {
    // If editing, can't link to self
    if (editingCustomer && c.id === editingCustomer.id) return false;
    
    // Only link opposite types (Individual can link to Company, Company can link to Individual)
    if (customerType === 'حقوقی') {
      if (c.customerType !== 'حقیقی') return false;
      const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
      return fullName.includes(relationSearch.toLowerCase()) || (c.position || '').toLowerCase().includes(relationSearch.toLowerCase());
    } else {
      if (c.customerType !== 'حقوقی') return false;
      return (c.companyName || '').toLowerCase().includes(relationSearch.toLowerCase());
    }
  });

  return (
    <div className="space-y-6 animate-fade-in" id="customers-view-container">
      {/* View Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">بانک اطلاعات مشتریان</h1>
          <p className="text-slate-500 text-sm mt-1">مدیریت مشتریان حقیقی و حقوقی و ارتباطات بین آن‌ها</p>
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
            id="btn-add-customer"
          >
            <UserPlus size={16} />
            ثبت مشتری جدید
          </button>
        </div>
      </div>

      {/* Filters & Search Row */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col lg:flex-row gap-4 items-center">
        {/* Search input */}
        <div className="relative w-full lg:flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="جستجو در نام شرکت، نام مخاطب، شخص کلیدی، کداقتصادی، استان یا برچسب‌ها..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
            id="search-customer-input"
          />
        </div>

        {/* Type Filter */}
        <div className="flex gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 w-full lg:w-auto">
          <button
            onClick={() => setSelectedTypeFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${selectedTypeFilter === 'all' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            همه ماهیت‌ها
          </button>
          <button
            onClick={() => setSelectedTypeFilter('حقوقی')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${selectedTypeFilter === 'حقوقی' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            مشتریان حقوقی
          </button>
          <button
            onClick={() => setSelectedTypeFilter('حقیقی')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${selectedTypeFilter === 'حقیقی' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            مشتریان حقیقی
          </button>
        </div>

        {/* Industry Filter dropdown */}
        <div className="relative w-full lg:w-64 flex items-center gap-2">
          <Filter size={16} className="text-slate-400 flex-shrink-0" />
          <select
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
            className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
            id="filter-industry-select"
          >
            <option value="all">همه حوزه‌های فعالیت</option>
            {(settings.dropdownItems?.industries || industries).map((ind, i) => (
              <option key={i} value={ind}>{ind}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Custom Fields Filter Panel */}
      {(() => {
        const customerCustomFields = (settings?.customFields || []).filter(f => f.module === 'customers');
        if (customerCustomFields.length === 0) return null;
        return (
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-3 animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Filter size={14} className="text-indigo-500" />
              <span>فیلتر فیلدهای سفارشی مشتری:</span>
              {Object.values(customFieldFilters).some(Boolean) && (
                <button
                  onClick={() => setCustomFieldFilters({})}
                  className="mr-auto text-[10px] text-rose-600 hover:underline animate-fade-in"
                >
                  پاک کردن تمامی فیلترها
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {customerCustomFields.map(field => {
                const currentVal = customFieldFilters[field.id] || '';
                return (
                  <div key={field.id} className="space-y-1 text-right">
                    <label className="block text-[11px] font-bold text-slate-600">{field.name}:</label>
                    {field.type === 'select' ? (
                      <select
                        value={currentVal}
                        onChange={(e) => setCustomFieldFilters({ ...customFieldFilters, [field.id]: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg py-1.5 px-2 bg-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">همه</option>
                        {(field.options || []).map((opt, oIdx) => (
                          <option key={oIdx} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'boolean' ? (
                      <select
                        value={currentVal}
                        onChange={(e) => setCustomFieldFilters({ ...customFieldFilters, [field.id]: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg py-1.5 px-2 bg-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">همه</option>
                        <option value="true">بله</option>
                        <option value="false">خیر</option>
                      </select>
                    ) : field.type === 'file' ? (
                      <select
                        value={currentVal}
                        onChange={(e) => setCustomFieldFilters({ ...customFieldFilters, [field.id]: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg py-1.5 px-2 bg-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">همه</option>
                        <option value="has_file">دارای پیوست</option>
                        <option value="no_file">بدون پیوست</option>
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        placeholder={`فیلتر ${field.name}...`}
                        value={currentVal}
                        onChange={(e) => setCustomFieldFilters({ ...customFieldFilters, [field.id]: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg py-1.5 px-2 bg-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Customer Table List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden" id="customers-grid">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                <th className="p-3 text-center w-24">نوع</th>
                <th className="p-3">نام مشتری / شرکت</th>
                <th className="p-3">حوزه فعالیت / سمت</th>
                <th className="p-3">شخص کلیدی</th>
                <th className="p-3">اطلاعات تماس</th>
                <th className="p-3">استان</th>
                <th className="p-3">برچسب‌ها</th>
                <th className="p-3">فیلدهای سفارشی</th>
                <th className="p-3 text-center w-24">عملیات</th>
              </tr>
              {/* Column Filters Input Row */}
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر..."
                    value={colFilters.type || ''}
                    onChange={(e) => setColFilters({...colFilters, type: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded text-center focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
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
                    placeholder="فیلتر حوزه/سمت..."
                    value={colFilters.industry || ''}
                    onChange={(e) => setColFilters({...colFilters, industry: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر شخص..."
                    value={colFilters.keyPerson || ''}
                    onChange={(e) => setColFilters({...colFilters, keyPerson: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر تماس..."
                    value={colFilters.contact || ''}
                    onChange={(e) => setColFilters({...colFilters, contact: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white text-left font-mono"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر استان..."
                    value={colFilters.province || ''}
                    onChange={(e) => setColFilters({...colFilters, province: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر برچسب..."
                    value={colFilters.tags || ''}
                    onChange={(e) => setColFilters({...colFilters, tags: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2"></th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {filteredCustomers.map((cust) => {
                const isLegal = cust.customerType === 'حقوقی';
                const linkedCustomers = (cust.linkedCustomerIds || [])
                  .map(id => customers.find(c => c.id === id))
                  .filter(Boolean) as Customer[];
                const tagsList = cust.tags ? cust.tags.split(/[,،]/).map(t => t.trim()).filter(Boolean) : [];

                return (
                  <tr key={cust.id} className="hover:bg-slate-50/50 transition" id={`customer-card-${cust.id}`}>
                    {/* Type Badge */}
                    <td className="p-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] ${isLegal ? 'bg-sky-50 text-sky-700 border border-sky-100' : 'bg-violet-50 text-violet-700 border border-violet-100'}`}>
                        {cust.customerType}
                      </span>
                    </td>
                    
                    {/* Name */}
                    <td className="p-3 font-bold text-slate-900">
                      <div>{isLegal ? cust.companyName : `${cust.firstName || ''} ${cust.lastName || ''}`}</div>
                      {cust.economicCode && isLegal && <div className="text-[10px] text-slate-400 font-normal mt-0.5">کد اقتصادی: {cust.economicCode}</div>}
                    </td>

                    {/* Industry / Position */}
                    <td className="p-3">
                      {isLegal ? (
                        <div className="flex items-center gap-1">
                          <Building size={12} className="text-slate-400" />
                          <span>{cust.industry || '-'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <User size={12} className="text-slate-400" />
                          <span>{cust.position || '-'}</span>
                        </div>
                      )}
                    </td>

                    {/* Key Person */}
                    <td className="p-3 text-slate-600 font-medium">
                      {cust.keyPerson || '-'}
                    </td>

                    {/* Contact Details */}
                    <td className="p-3 font-mono text-[11px] space-y-0.5 text-slate-600">
                      {cust.mobile && <div className="flex items-center gap-1 justify-end"><span className="text-slate-400 font-sans text-[9px]">همراه:</span> {cust.mobile}</div>}
                      {cust.phone && <div className="flex items-center gap-1 justify-end"><span className="text-slate-400 font-sans text-[9px]">تلفن:</span> {cust.phone}</div>}
                      {cust.email && <div className="text-slate-400 text-[10px]">{cust.email}</div>}
                    </td>

                    {/* Province */}
                    <td className="p-3 text-slate-600">
                      {cust.province || '-'}
                    </td>

                    {/* Tags */}
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {tagsList.map((tag, idx) => (
                          <span key={idx} className="bg-slate-100 text-slate-600 text-[9px] px-1.5 py-0.5 rounded font-medium">
                            {tag}
                          </span>
                        ))}
                        {tagsList.length === 0 && <span className="text-slate-300">-</span>}
                      </div>
                    </td>

                    {/* Custom Fields */}
                    <td className="p-3">
                      <CustomFieldsDetailView
                        module="customers"
                        customFields={settings?.customFields || []}
                        customValues={cust.customValues}
                      />
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(cust)}
                          className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-sky-600 rounded transition"
                          title="ویرایش پرونده"
                          id={`btn-edit-customer-${cust.id}`}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => {
                            const isLegal = cust.customerType === 'حقوقی';
                            const nameStr = isLegal ? cust.companyName : `${cust.firstName || ''} ${cust.lastName || ''}`;
                            setCustomerToDeleteId(cust.id);
                            setCustomerToDeleteName(nameStr);
                            setDeleteConfirmOpen(true);
                          }}
                          className="p-1.5 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded transition"
                          title="حذف مشتری"
                          id={`btn-delete-customer-${cust.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredCustomers.length === 0 && (
          <div className="text-center bg-white p-12 border-t border-slate-100 w-full">
            <Users className="mx-auto text-slate-300 mb-3" size={48} />
            <p className="text-sm text-slate-500 font-medium">مشتری با مشخصات وارد شده یافت نشد.</p>
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

      {/* Add / Edit Modal */}
      {showModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isCustomerModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isCustomerModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-2xl my-4'
          }`}>
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800" id="customer-modal-title">
                {editingCustomer 
                  ? `ویرایش پرونده مشتری: ${editingCustomer.customerType === 'حقوقی' ? editingCustomer.companyName : (editingCustomer.firstName + ' ' + editingCustomer.lastName)}` 
                  : 'ثبت مشتری جدید'
                }
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsCustomerModalFullscreen(!isCustomerModalFullscreen)}
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isCustomerModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isCustomerModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowModal(false); setIsCustomerModalFullscreen(false); }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
                  id="btn-close-modal"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body / Form */}
            <form 
              onSubmit={handleSave} 
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const target = e.target as HTMLElement;
                  if (target.tagName === 'INPUT') {
                    e.preventDefault();
                  }
                }
              }}
              className={`p-6 space-y-5 overflow-y-auto flex-1 text-right ${isCustomerModalFullscreen ? '' : 'max-h-[75vh]'}`} 
              id="customer-form"
            >
              
              {/* Customer Type Picker */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">ماهیت مشتری</label>
                {editingCustomer ? (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl w-fit text-xs font-bold text-slate-700">
                    {customerType === 'حقوقی' ? (
                      <>
                        <Building size={15} className="text-sky-500" />
                        <span>مشتری حقوقی (غیرقابل تغییر)</span>
                      </>
                    ) : (
                      <>
                        <User size={15} className="text-violet-500" />
                        <span>مشتری حقیقی (غیرقابل تغییر)</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-4 p-1.5 bg-slate-100 rounded-xl border border-slate-200 w-fit">
                    <button
                      type="button"
                      onClick={() => setCustomerType('حقوقی')}
                      className={`px-4 py-2 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                        customerType === 'حقوقی' 
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/15' 
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      <Building size={14} />
                      مشتری حقوقی (شرکت/سازمان)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerType('حقیقی')}
                      className={`px-4 py-2 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                        customerType === 'حقیقی' 
                          ? 'bg-violet-500 text-white shadow-md shadow-violet-500/15' 
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      <User size={14} />
                      مشتری حقیقی (انفرادی/پیمانکار)
                    </button>
                  </div>
                )}
              </div>

              {/* Fields Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* -------------------- LEGAL CUSTOMER FIELDS -------------------- */}
                {customerType === 'حقوقی' ? (
                  <>
                    {/* نام شرکت */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'companyName', 'نام شرکت')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'companyName')}
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="مثال: شرکت نفت و گاز کارون"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>

                    {/* کد اقتصادی */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'economicCode', 'کد اقتصادی')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'economicCode')}
                        value={economicCode}
                        onChange={(e) => setEconomicCode(e.target.value)}
                        placeholder="مثال: ۴۱۱۳۴۵۶۷۸۹۱۲"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* تلفن */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'phone', 'تلفن ثابت')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'phone')}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="مثال: 02188884422"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* تلفن همراه */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'mobile', 'تلفن همراه')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'mobile')}
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="مثال: 09121112233"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* ایمیل */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'email', 'ایمیل')}</label>
                      <input
                        type="email"
                        required={isFieldRequired(settings, 'customers', 'email')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="مثال: info@company.com"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* صنعت / حوزه فعالیت */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'industry', 'صنعت / حوزه فعالیت')}</label>
                      <select
                        value={industry}
                        required={isFieldRequired(settings, 'customers', 'industry')}
                        onChange={(e) => setIndustry(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        {(settings.dropdownItems?.industries || industries).map((ind, i) => (
                          <option key={i} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>

                    {/* استان */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'province', 'استان')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'province')}
                        value={province}
                        onChange={(e) => setProvince(e.target.value)}
                        placeholder="مثال: تهران"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                  </>
                ) : (
                  // -------------------- INDIVIDUAL CUSTOMER FIELDS --------------------
                  <>
                    {/* نام */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'firstName', 'نام')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'firstName')}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="مثال: مهرداد"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>

                    {/* نام خانوادگی */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'lastName', 'نام خانوادگی')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'lastName')}
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="مثال: رضوی"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>

                    {/* جنسیت */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'gender', 'جنسیت')}</label>
                      <select
                        value={gender}
                        required={isFieldRequired(settings, 'customers', 'gender')}
                        onChange={(e) => setGender(e.target.value as any)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">نامشخص</option>
                        <option value="مرد">مرد</option>
                        <option value="زن">زن</option>
                      </select>
                    </div>

                    {/* سمت */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'position', 'سمت')}</label>
                      <select
                        value={position}
                        required={isFieldRequired(settings, 'customers', 'position')}
                        onChange={(e) => setPosition(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">انتخاب کنید...</option>
                        {(() => {
                          const list = settings.dropdownItems?.positions || ['مدیرعامل', 'رئیس هیئت مدیره', 'مدیر بازرگانی', 'کارشناس خرید', 'مدیر فنی', 'کارشناس ارشد فنی', 'مدیر پروژه', 'مسئول تدارکات', 'کارشناس ابزار دقیق', 'سایر'];
                          const options = [...list];
                          if (position && !options.includes(position)) {
                            options.push(position);
                          }
                          return options.map((pos, idx) => (
                            <option key={idx} value={pos}>{pos}</option>
                          ));
                        })()}
                      </select>
                    </div>

                    {/* تلفن */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'phone', 'تلفن ثابت')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'phone')}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="مثال: 02122334455"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* تلفن همراه */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'mobile', 'تلفن همراه')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'mobile')}
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="مثال: 09121112233"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* ایمیل */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'email', 'ایمیل')}</label>
                      <input
                        type="email"
                        required={isFieldRequired(settings, 'customers', 'email')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="مثال: m.razavi@example.com"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      />
                    </div>

                    {/* استان */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'province', 'استان')}</label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'customers', 'province')}
                        value={province}
                        onChange={(e) => setProvince(e.target.value)}
                        placeholder="مثال: اصفهان"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                      />
                    </div>
                  </>
                )}

                {/* Common fields (address, notes, tags) */}
                {/* آدرس */}
                <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-bold text-slate-600">{renderFieldLabelWithAsterisk(settings, 'customers', 'address', 'آدرس دقیق')}</label>
                  <textarea
                    rows={2}
                    required={isFieldRequired(settings, 'customers', 'address')}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="نشانی پستی دقیق..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* یادداشتها */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">یادداشتها</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="توضیحات تکمیلی یا یادداشت‌های خاص..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* برچسبها */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">برچسبها</label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="برچسب‌ها را با کاما جدا کنید (مثال: کارفرما، خوش‌حساب، EPC)"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>

                {/* توافقات خاص و یادآور خودکار (تفکیک شده بر اساس ماژول) */}
                <div className="space-y-4 md:col-span-2 border border-indigo-100 bg-indigo-50/30 rounded-xl p-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-indigo-700 flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                      توافقات خاص و یادآورهای هوشمند (بر اساس ماژول)
                    </label>
                    <p className="text-[10px] text-slate-500">
                      این توافقات در ماژول انتخاب شده، به محض انتخاب این مشتری به صورت پاپ‌آپ یا هشدار زرد رنگ به کاربر نمایش داده می‌شوند.
                    </p>
                  </div>
                  
                  <div className="flex gap-2">
                    <select
                      id="newAgreementModule"
                      className="w-1/3 border border-indigo-200 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-right bg-white"
                    >
                      <option value="proformas">پیش‌فاکتورها</option>
                      <option value="purchase_orders">سفارشات خرید (PO)</option>
                      <option value="packaging">بسته‌بندی و ارسال</option>
                      <option value="projects">پروژه‌ها</option>
                      <option value="after_sales">خدمات پس از فروش</option>
                      <option value="general">عمومی (همه جا)</option>
                    </select>
                    <input
                      type="text"
                      id="newAgreementText"
                      placeholder="متن توافق یا یادآور را بنویسید..."
                      className="flex-1 border border-indigo-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-right bg-white"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const moduleInput = document.getElementById('newAgreementModule') as HTMLSelectElement;
                          const textInput = document.getElementById('newAgreementText') as HTMLInputElement;
                          if (textInput.value.trim()) {
                            setModuleAgreements([
                              ...moduleAgreements,
                              {
                                id: `agr-${Date.now()}`,
                                moduleName: moduleInput.value,
                                text: textInput.value.trim(),
                                createdAt: new Date().toISOString()
                              }
                            ]);
                            textInput.value = '';
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const moduleInput = document.getElementById('newAgreementModule') as HTMLSelectElement;
                        const textInput = document.getElementById('newAgreementText') as HTMLInputElement;
                        if (textInput.value.trim()) {
                          setModuleAgreements([
                            ...moduleAgreements,
                            {
                              id: `agr-${Date.now()}`,
                              moduleName: moduleInput.value,
                              text: textInput.value.trim(),
                              createdAt: new Date().toISOString()
                            }
                          ]);
                          textInput.value = '';
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors"
                    >
                      افزودن
                    </button>
                  </div>

                  {moduleAgreements.length > 0 && (
                    <div className="space-y-2 mt-3">
                      {moduleAgreements.map(agr => (
                        <div key={agr.id} className="flex items-center justify-between bg-white border border-indigo-100 rounded-lg p-2 px-3 shadow-sm">
                          <div className="flex items-center gap-2">
                            <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold">
                              {agr.moduleName === 'proformas' ? 'پیش‌فاکتور' :
                               agr.moduleName === 'purchase_orders' ? 'سفارش خرید' :
                               agr.moduleName === 'packaging' ? 'بسته‌بندی' :
                               agr.moduleName === 'projects' ? 'پروژه' :
                               agr.moduleName === 'after_sales' ? 'خدمات' : 'عمومی'}
                            </span>
                            <span className="text-xs text-slate-700">{agr.text}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setModuleAgreements(moduleAgreements.filter(a => a.id !== agr.id))}
                            className="text-rose-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status Field */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-600">وضعیت پرونده</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    {(settings.dropdownItems?.customerStatuses || ['فعال', 'غیرفعال']).map((s, idx) => (
                      <option key={idx} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* -------------------- RELATIONSHIP LINK SELECTOR -------------------- */}
              <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Link2 size={14} className="text-slate-500" />
                    {customerType === 'حقوقی' 
                      ? 'تعریف ارتباط دوطرفه با اشخاص حقیقی' 
                      : 'تعریف ارتباط دوطرفه با شرکت‌ها (حقوقی)'}
                  </h4>
                  <span className="text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-bold">
                    {selectedLinks.length} انتخاب شده
                  </span>
                </div>

                {/* Active connection chips */}
                {selectedLinks.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-slate-500 mb-1">ارتباط‌های فعال پرونده (جهت مشاهده و جابجایی روی هرکدام کلیک کنید):</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {selectedLinks.map(id => {
                        const linkedCust = customers.find(c => c.id === id);
                        if (!linkedCust) return null;
                        
                        const isCompany = linkedCust.customerType === 'حقوقی';
                        const name = isCompany 
                          ? linkedCust.companyName 
                          : `${linkedCust.firstName || ''} ${linkedCust.lastName || ''}`.trim();
                        
                        return (
                          <div 
                            key={id} 
                            className="flex flex-col justify-between p-3 bg-white border border-slate-200 hover:border-sky-300 rounded-xl transition duration-200 shadow-xs relative"
                          >
                            <div className="flex items-start gap-2.5">
                              {/* Left Indicator Icon */}
                              <div className={`p-1.5 rounded-lg shrink-0 ${isCompany ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-violet-600'}`}>
                                {isCompany ? <Building size={14} /> : <User size={14} />}
                              </div>
                              
                              <div className="flex-1 min-w-0 space-y-1">
                                {/* Name with Navigation Link */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(linkedCust)}
                                  className="text-xs font-bold text-slate-800 hover:text-sky-600 transition text-right flex items-center gap-1 group/btn hover:underline w-full"
                                  title="مشاهده پرونده و انتقال به این مشتری"
                                >
                                  <span className="truncate">{name}</span>
                                  <ArrowLeft size={12} className="text-slate-400 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                </button>
                                
                                {/* Info Rows */}
                                <div className="text-[10px] text-slate-500 space-y-0.5 font-medium">
                                  {/* Position / Industry */}
                                  {isCompany ? (
                                    linkedCust.industry && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">حوزه فعالیت:</span>
                                        <span className="text-slate-700 font-semibold">{linkedCust.industry}</span>
                                      </div>
                                    )
                                  ) : (
                                    linkedCust.position && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">سمت:</span>
                                        <span className="text-slate-700 font-semibold">{linkedCust.position}</span>
                                      </div>
                                    )
                                  )}

                                  {/* Mobile & Phone */}
                                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px]">
                                    {linkedCust.mobile && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">موبایل:</span>
                                        <span className="text-slate-600 font-mono font-semibold">{linkedCust.mobile}</span>
                                      </div>
                                    )}
                                    {linkedCust.phone && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400">تلفن:</span>
                                        <span className="text-slate-600 font-mono font-semibold">{linkedCust.phone}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Action to switch or remove */}
                            <div className="flex justify-between items-center mt-2 pt-1.5 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(linkedCust)}
                                className="text-[10px] font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition"
                              >
                                <span>انتقال به پرونده</span>
                                <ArrowLeft size={11} />
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => handleToggleLink(id)}
                                className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-md transition"
                                title="قطع ارتباط"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Relationship search with Quick Add trigger button */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder={customerType === 'حقوقی' ? 'جستجو در اشخاص حقیقی...' : 'جستجو در شرکت‌ها...'}
                      value={relationSearch}
                      onChange={(e) => setRelationSearch(e.target.value)}
                      className="w-full pr-8 pl-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQuickAddRelation(!showQuickAddRelation)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition flex items-center justify-center gap-1 ${
                      showQuickAddRelation 
                        ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100' 
                        : 'bg-sky-50 text-sky-600 border-sky-200 hover:bg-sky-100'
                    }`}
                  >
                    {showQuickAddRelation ? (
                      <>
                        <X size={12} />
                        <span>انصراف از تعریف جدید</span>
                      </>
                    ) : (
                      <>
                        <Plus size={12} />
                        <span>{customerType === 'حقوقی' ? 'تعریف مخاطب حقیقی جدید' : 'تعریف شرکت جدید'}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Inline Quick Add Form */}
                {showQuickAddRelation && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3.5 shadow-xs">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <h5 className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {customerType === 'حقوقی' ? 'ثبت سریع مخاطب حقیقی جدید' : 'ثبت سریع شرکت جدید'}
                      </h5>
                      <span className="text-[10px] text-slate-400">تمام فیلدهای علامت‌دار (*) الزامی هستند.</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {customerType === 'حقوقی' ? (
                        <>
                          {/* Individual target */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">نام *</label>
                            <input
                              type="text"
                              value={quickFirstName}
                              onChange={(e) => setQuickFirstName(e.target.value)}
                              placeholder="مثال: محمد"
                              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">نام خانوادگی *</label>
                            <input
                              type="text"
                              value={quickLastName}
                              onChange={(e) => setQuickLastName(e.target.value)}
                              placeholder="مثال: امینی"
                              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">جنسیت</label>
                            <select
                              value={quickGender}
                              onChange={(e) => setQuickGender(e.target.value as any)}
                              className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            >
                              <option value="">نامشخص</option>
                              <option value="مرد">مرد</option>
                              <option value="زن">زن</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">سمت</label>
                            <select
                              value={quickPosition}
                              onChange={(e) => setQuickPosition(e.target.value)}
                              className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            >
                              <option value="">انتخاب کنید...</option>
                              {(() => {
                                const list = settings.dropdownItems?.positions || ['مدیرعامل', 'رئیس هیئت مدیره', 'مدیر بازرگانی', 'کارشناس خرید', 'مدیر فنی', 'کارشناس ارشد فنی', 'مدیر پروژه', 'مسئول تدارکات', 'کارشناس ابزار دقیق', 'سایر'];
                                const options = [...list];
                                if (quickPosition && !options.includes(quickPosition)) {
                                  options.push(quickPosition);
                                }
                                return options.map((pos, idx) => (
                                  <option key={idx} value={pos}>{pos}</option>
                                ));
                              })()}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Company target */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">نام شرکت *</label>
                            <input
                              type="text"
                              value={quickCompanyName}
                              onChange={(e) => setQuickCompanyName(e.target.value)}
                              placeholder="مثال: شرکت گاز زاگرس"
                              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">کد اقتصادی</label>
                            <input
                              type="text"
                              value={quickEconomicCode}
                              onChange={(e) => setQuickEconomicCode(e.target.value)}
                              placeholder="مثال: ۴۱۱۳۴۵"
                              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">صنعت / حوزه فعالیت</label>
                            <select
                              value={quickIndustry}
                              onChange={(e) => setQuickIndustry(e.target.value)}
                              className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            >
                              {industries.map((ind, i) => (
                                <option key={i} value={ind}>{ind}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500">شخص کلیدی</label>
                            <input
                              type="text"
                              value={quickKeyPerson}
                              onChange={(e) => setQuickKeyPerson(e.target.value)}
                              placeholder="مثال: مهندس حسینی"
                              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                        </>
                      )}

                      {/* Common Quick Fields */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-500">تلفن ثابت (اختیاری)</label>
                        <input
                          type="text"
                          value={quickPhone}
                          onChange={(e) => setQuickPhone(e.target.value)}
                          placeholder="مثال: 021445566"
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-500">تلفن همراه (اختیاری)</label>
                        <input
                          type="text"
                          value={quickMobile}
                          onChange={(e) => setQuickMobile(e.target.value)}
                          placeholder="مثال: 0912"
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-500">ایمیل</label>
                        <input
                          type="email"
                          value={quickEmail}
                          onChange={(e) => setQuickEmail(e.target.value)}
                          placeholder="info@example.com"
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-500">استان</label>
                        <input
                          type="text"
                          value={quickProvince}
                          onChange={(e) => setQuickProvince(e.target.value)}
                          placeholder="مثال: خراسان رضوی"
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-[10px] font-semibold text-slate-500">آدرس</label>
                        <input
                          type="text"
                          value={quickAddress}
                          onChange={(e) => setQuickAddress(e.target.value)}
                          placeholder="نشانی..."
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-[10px] font-semibold text-slate-500">یادداشتها</label>
                        <input
                          type="text"
                          value={quickNotes}
                          onChange={(e) => setQuickNotes(e.target.value)}
                          placeholder="توضیحات تکمیلی..."
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-[10px] font-semibold text-slate-500">برچسبها</label>
                        <input
                          type="text"
                          value={quickTags}
                          onChange={(e) => setQuickTags(e.target.value)}
                          placeholder="با کاما جدا کنید ( EPC، کارفرما )"
                          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setShowQuickAddRelation(false)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveQuickCustomer}
                        className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition shadow-md shadow-emerald-500/10 flex items-center gap-1"
                      >
                        <Plus size={12} />
                        <span>ثبت سریع و افزودن به لیست ارتباط‌ها</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Candidate checklist container */}
                <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100 bg-white">
                  {relationCandidates.length > 0 ? (
                    relationCandidates.map(rc => {
                      const isChecked = selectedLinks.includes(rc.id);
                      return (
                        <label 
                          key={rc.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50/50 cursor-pointer text-xs select-none"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleLink(rc.id)}
                            className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-800 truncate">
                              {rc.customerType === 'حقوقی' ? rc.companyName : `${rc.firstName || ''} ${rc.lastName || ''}`}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate">
                              {rc.customerType === 'حقوقی' ? `صنعت: ${rc.industry || '—'}` : `سمت: ${rc.position || '—'}`}
                            </p>
                          </div>
                        </label>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center text-[11px] text-slate-400 italic">
                      موردی جهت ارتباط یافت نشد.
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Custom Fields Section */}
              <CustomFieldsForm
                module="customers"
                customFields={settings?.customFields || []}
                customValues={customValues}
                onChange={setCustomValues}
              />

              {/* Form Footer Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setIsCustomerModalFullscreen(false); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                  id="btn-cancel-modal"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15"
                  id="btn-submit-form"
                >
                  {editingCustomer ? 'ثبت تغییرات پرونده' : 'ذخیره و ثبت در بانک اطلاعات'}
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
          setCustomerToDeleteId(null);
          setCustomerToDeleteName('');
        }}
        onConfirm={() => {
          if (customerToDeleteId) {
            deleteCustomer(customerToDeleteId);
          }
        }}
        title="حذف پرونده مشتری"
        message={`آیا از حذف پرونده مشتری "${customerToDeleteName}" اطمینان دارید؟ تمامی اطلاعات مرتبط با این مشتری حذف خواهد شد.`}
      />

      {/* Confirm Link Removal Modal */}
      <ConfirmModal
        isOpen={linkDeleteConfirmOpen}
        onClose={() => {
          setLinkDeleteConfirmOpen(false);
          setLinkToDeleteId(null);
          setLinkToDeleteName('');
        }}
        onConfirm={() => {
          if (linkToDeleteId) {
            setSelectedLinks(prev => prev.filter(x => x !== linkToDeleteId));
          }
        }}
        title="قطع ارتباط با مشتری"
        message={`آیا از حذف و قطع ارتباط با مشتری "${linkToDeleteName}" اطمینان دارید؟`}
        confirmText="بله، قطع ارتباط شود"
        cancelText="انصراف"
      />

    </div>
  );
}
