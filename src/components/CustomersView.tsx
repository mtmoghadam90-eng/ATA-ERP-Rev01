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
  Minimize2,
  Loader2,
  AlertCircle
} from 'lucide-react';
import {
  Customer, ERPSettings, Project, Proforma, Transaction, Task,
  SupplierInquiry, PurchaseOrder, PackagingDelivery, AfterSalesService,
} from '../types';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import { exportToCSV } from '../excelUtils';
import ConfirmModal from './ConfirmModal';
import { ApiError } from '../api/client';
import { customersApi } from '../api/customers';
import { customerToWriteInput, detailToCustomer, rowToCustomer } from '../api/customerAdapter';
import { useCustomerList } from '../api/useCustomerList';
import { useEntitySearch } from '../api/useEntitySearch';
import type { CustomerRow } from '../api/customers';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import { IRAN_PROVINCES, canonicalizeProvince } from '../utils/iranProvinces';
import { getContactInfoError } from '../utils/customerValidation';
import { DuplicateMatch } from '../utils/customerDuplicates';
import DuplicateCustomerModal from './DuplicateCustomerModal';
import { CustomerReferenceCounts } from '../utils/customerMigration';
import CustomerDeleteMigrationModal from './CustomerDeleteMigrationModal';
import { SearchableSelect } from './SearchableSelect';

interface CustomersViewProps {
  industries: string[];
  settings: ERPSettings;
  initialSearchQuery?: string | null;
  onClearInitialSearchQuery?: () => void;
}

/**
 * Customers screen.
 *
 * Reads through the API rather than a prop holding every customer: search,
 * filters, sorting and paging are query parameters, so what arrives is one page
 * however large the table has grown. The reference counts that decide whether a
 * customer can be deleted, and the duplicate check when saving one, are queries
 * too — both used to need the entire table in the browser to answer.
 */
export default function CustomersView({
  industries,
  settings,
  initialSearchQuery,
  onClearInitialSearchQuery,
}: CustomersViewProps) {
  const list = useCustomerList(initialSearchQuery ?? '');
  const search = list.search;
  const setSearch = list.setSearch;

  // The page of customers, in the shape this screen's markup was written for.
  const customers = React.useMemo(() => list.rows.map(rowToCustomer), [list.rows]);

  React.useEffect(() => {
    if (initialSearchQuery && onClearInitialSearchQuery) {
      onClearInitialSearchQuery();
    }
  }, [initialSearchQuery, onClearInitialSearchQuery]);

  /** Reports a failed call using the server's own Persian sentence. */
  const reportError = (err: unknown, fallback: string) => {
    alert(err instanceof ApiError ? err.message : fallback);
  };

  const selectedIndustry = list.filters.industry;
  const setSelectedIndustry = (value: string) => list.setFilter('industry', value);
  const selectedTypeFilter = list.filters.customerType as 'all' | 'حقوقی' | 'حقیقی';
  const setSelectedTypeFilter = (value: 'all' | 'حقوقی' | 'حقیقی') =>
    list.setFilter('customerType', value);
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

  // Duplicate-customer warning state (main form)
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([]);
  const [dupCandidateName, setDupCandidateName] = useState('');
  // ...and for the inline linked-customer ("relation") form
  const [quickDupMatches, setQuickDupMatches] = useState<DuplicateMatch[]>([]);
  const [quickDupPayload, setQuickDupPayload] = useState<Partial<Customer> | null>(null);

  // Delete-with-migration state (customer that still has history)
  const [migrationTarget, setMigrationTarget] = useState<Customer | null>(null);
  const [migrationCounts, setMigrationCounts] = useState<CustomerReferenceCounts | null>(null);

  // Writes are round trips now, so the form has to say it is busy and refuse a
  // second submit rather than sending the same record twice.
  const [saving, setSaving] = useState(false);

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
  const handleSaveQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const targetType: Customer['customerType'] = customerType === 'حقوقی' ? 'حقیقی' : 'حقوقی';

    const quickContactError = getContactInfoError({ mobile: quickMobile, phone: quickPhone, email: quickEmail, province: quickProvince });
    if (quickContactError) {
      alert(quickContactError);
      return;
    }

    const data: Partial<Customer> = {
      customerType: targetType,
      status: 'فعال',
      phone: quickPhone,
      mobile: quickMobile,
      email: quickEmail,
      province: canonicalizeProvince(quickProvince) || quickProvince,
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

    // Warn before creating a linked record that looks like an existing customer.
    try {
      const { matches } = await customersApi.checkDuplicates({
        customerType: targetType,
        companyName: data.companyName,
        firstName: data.firstName,
        lastName: data.lastName,
        mobile: data.mobile,
        phone: data.phone,
        email: data.email,
        province: data.province,
        economicCode: data.economicCode,
      });
      if (matches.length > 0) {
        setQuickDupPayload(data);
        setQuickDupMatches(matches.map((m) => ({
          customer: m.customer as unknown as Customer,
          severity: m.severity,
          primaryField: m.primaryField as DuplicateMatch['primaryField'],
          reason: m.reason,
        })));
        return;
      }
    } catch (err) {
      reportError(err, 'بررسی مشتری تکراری انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }

    await commitQuickRelationCustomer(data);
  };

  /** Creates the inline linked ("relation") customer and links it. */
  const commitQuickRelationCustomer = async (data: Partial<Customer>) => {
    try {
      const created = await customersApi.create(customerToWriteInput(data));
      setQuickDupMatches([]);
      setQuickDupPayload(null);
      // Selected immediately, so the relation the user just created is linked
      // when the parent record is saved.
      setSelectedLinks(prev => [...prev, created.id]);
      resetQuickForm();
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت مشتری مرتبط با خطا مواجه شد.');
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
  /**
   * Loads the whole customer before filling the form.
   *
   * A grid row carries no address, notes, position, gender, key person or
   * module agreements — populating the form from one and saving wrote every
   * one of them back empty.
   */
  const handleOpenEdit = async (row: Customer) => {
    let customer: Customer;
    try {
      customer = detailToCustomer(await customersApi.get(row.id));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات مشتری با خطا مواجه شد.');
      return;
    }

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
  // Links used to be kept symmetric by rewriting every other customer here.
  // The server writes both directions in one transaction now, so the whole
  // helper is gone; see customersApi.setLinks.

  // Handle Save
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // At least one identifying contact field is required beyond the name.
    const contactError = getContactInfoError({ mobile, phone, email, province });
    if (contactError) {
      alert(contactError);
      return;
    }

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

    // Warn before creating a record that looks like an existing customer.
    // The check is a query: scanning the loaded page would only ever see the
    // handful of customers currently on screen.
    const candidateName = customerType === 'حقوقی' ? companyName.trim() : `${firstName} ${lastName}`.trim();
    try {
      const { matches } = await customersApi.checkDuplicates({
        id: editingCustomer?.id,
        customerType,
        companyName: candidateName,
        firstName: customerType === 'حقیقی' ? firstName : undefined,
        lastName: customerType === 'حقیقی' ? lastName : undefined,
        mobile, phone, email, province,
        economicCode: customerType === 'حقوقی' ? economicCode : undefined,
      });

      if (matches.length > 0) {
        setDupMatches(matches.map((m) => ({
          customer: m.customer as unknown as Customer,
          severity: m.severity,
          primaryField: m.primaryField as DuplicateMatch['primaryField'],
          reason: m.reason,
        })));
        setDupCandidateName(candidateName);
        return;
      }
    } catch (err) {
      // A failed check must not silently allow a duplicate through; say so and
      // let the user decide whether to retry.
      reportError(err, 'بررسی مشتری تکراری انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }

    await performSave();
  };

  /**
   * Writes the customer, its inline quick-added relation, and its links.
   *
   * Each is its own call, because each is a different thing on the server: the
   * record is a row, the links are a relationship maintained on both sides, and
   * the agreements are a child collection. The old version rebuilt the entire
   * customer array to express all three at once.
   */
  const performSave = async () => {
    if (saving) return;
    setSaving(true);
    setDupMatches([]);

    try {
      const finalSelectedLinks = [...selectedLinks];

      // 1. An inline quick-add that was filled in but never submitted still
      //    counts as intent to create that relation.
      if (showQuickAddRelation) {
        const targetType: Customer['customerType'] = customerType === 'حقوقی' ? 'حقیقی' : 'حقوقی';
        const quickFilled = targetType === 'حقیقی'
          ? (quickFirstName.trim() || quickLastName.trim())
          : quickCompanyName.trim();

        if (quickFilled) {
          const quick = await customersApi.create(customerToWriteInput({
            customerType: targetType,
            status: 'فعال',
            phone: quickPhone,
            mobile: quickMobile,
            email: quickEmail,
            province: canonicalizeProvince(quickProvince) || quickProvince,
            address: quickAddress,
            notes: quickNotes,
            tags: quickTags,
            ...(targetType === 'حقیقی'
              ? {
                  firstName: quickFirstName,
                  lastName: quickLastName,
                  gender: quickGender,
                  position: quickPosition,
                  companyName: `${quickFirstName} ${quickLastName}`.trim(),
                }
              : {
                  companyName: quickCompanyName,
                  economicCode: quickEconomicCode,
                  industry: quickIndustry,
                  keyPerson: quickKeyPerson,
                }),
          }));
          finalSelectedLinks.push(quick.id);
        }
      }

      // 2. The customer itself.
      const payload = customerToWriteInput({
        customerType,
        status,
        phone,
        mobile,
        email,
        province: canonicalizeProvince(province) || province,
        address,
        notes,
        tags,
        customValues,
        ...(customerType === 'حقوقی'
          ? { companyName, economicCode, industry, keyPerson }
          : {
              companyName: `${firstName} ${lastName}`.trim(),
              firstName,
              lastName,
              gender,
              position,
            }),
      });

      const saved = editingCustomer
        ? await customersApi.update(editingCustomer.id, payload)
        : await customersApi.create(payload);

      // 3. Links and agreements, each maintained by the server.
      await customersApi.setLinks(saved.id, finalSelectedLinks);
      await customersApi.setAgreements(
        saved.id,
        (moduleAgreements || []).map((a) => ({ moduleName: a.moduleName, text: a.text })),
      );

      list.refresh();
      setShowModal(false);
      setIsCustomerModalFullscreen(false);
    } catch (err) {
      reportError(err, 'ذخیره مشتری با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
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
  // The server did the filtering; this page is already the answer.
  const filteredCustomers = customers;

  const [exporting, setExporting] = useState(false);

  /**
   * Exports every customer matching the current filters — not the page on
   * screen. Pagination would otherwise turn this into "export what you can see"
   * without saying so.
   */
  const handleExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await customersApi.listAll(list.exportParams);
      exportRows(all.map(rowToCustomer));
    } catch (err) {
      reportError(err, 'تهیه خروجی با خطا مواجه شد.');
    } finally {
      setExporting(false);
    }
  };

  const exportRows = (data: Customer[]) => {
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

    const rows = data.map(c => [
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
  // Candidates for the relationship picker, searched on the server. A link
  // always joins the opposite type, so the query is filtered to it.
  const relationSearchState = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 25,
    params: { customerType: customerType === 'حقوقی' ? 'حقیقی' : 'حقوقی' },
    getLabel: (row) => row.companyName,
    // Only while the form is open; otherwise it queries behind a closed modal.
    enabled: showModal,
  });

  React.useEffect(() => {
    relationSearchState.setTerm(relationSearch);
  }, [relationSearch, relationSearchState.setTerm]);

  const relationCandidates = React.useMemo(
    () => relationSearchState.matches
      .filter((row) => !editingCustomer || row.id !== editingCustomer.id)
      .map(rowToCustomer),
    [relationSearchState.matches, editingCustomer],
  );

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
                          onClick={() => { void handleOpenEdit(cust); }}
                          className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-sky-600 rounded transition"
                          title="ویرایش پرونده"
                          id={`btn-edit-customer-${cust.id}`}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={async () => {
                            const isLegal = cust.customerType === 'حقوقی';
                            const nameStr = isLegal ? cust.companyName : `${cust.firstName || ''} ${cust.lastName || ''}`;
                            setCustomerToDeleteId(cust.id);
                            setCustomerToDeleteName(nameStr);
                            // If this customer still has history, require a
                            // replacement first. One query, where the client
                            // used to need every collection loaded to count.
                            try {
                              const refs = await customersApi.references(cust.id);
                              if (refs.total > 0) {
                                setMigrationTarget(cust);
                                setMigrationCounts(refs as unknown as CustomerReferenceCounts);
                              } else {
                                setDeleteConfirmOpen(true);
                              }
                            } catch (err) {
                              reportError(err, 'بررسی سوابق مشتری با خطا مواجه شد.');
                            }
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

        {/* Before the first response there is nothing to say yet — showing
            "no customers found" while still loading reads as an empty database. */}
        {list.initialLoading && (
          <div className="text-center bg-white p-12 border-t border-slate-100 w-full">
            <Loader2 className="mx-auto text-slate-300 mb-3 animate-spin" size={40} />
            <p className="text-sm text-slate-500 font-medium">در حال دریافت اطلاعات…</p>
          </div>
        )}

        {list.error && !list.initialLoading && (
          <div className="text-center bg-white p-12 border-t border-slate-100 w-full">
            <AlertCircle className="mx-auto text-rose-300 mb-3" size={40} />
            <p className="text-sm text-rose-600 font-medium">{list.error}</p>
            <button
              onClick={() => list.refresh()}
              className="mt-3 text-xs text-sky-600 hover:underline font-bold"
            >
              تلاش دوباره
            </button>
          </div>
        )}

        {filteredCustomers.length === 0 && !list.initialLoading && !list.error && (
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

        {/* Pagination. The grid holds one page; these move between them. */}
        {list.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium">
              نمایش {list.rows.length.toLocaleString('fa-IR')} از {list.total.toLocaleString('fa-IR')} مشتری
              {' — '}صفحه {list.page.toLocaleString('fa-IR')} از {list.totalPages.toLocaleString('fa-IR')}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => list.setPage(1)}
                disabled={list.page === 1 || list.loading}
                className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                اول
              </button>
              <button
                type="button"
                onClick={() => list.setPage(list.page - 1)}
                disabled={list.page === 1 || list.loading}
                className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                قبلی
              </button>
              <button
                type="button"
                onClick={() => list.setPage(list.page + 1)}
                disabled={list.page >= list.totalPages || list.loading}
                className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                بعدی
              </button>
              <button
                type="button"
                onClick={() => list.setPage(list.totalPages)}
                disabled={list.page >= list.totalPages || list.loading}
                className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                آخر
              </button>
            </div>
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
                      <SearchableSelect
                        value={canonicalizeProvince(province)}
                        onChange={(val) => setProvince(val)}
                        required={isFieldRequired(settings, 'customers', 'province')}
                        placeholder="انتخاب استان..."
                        options={IRAN_PROVINCES.map(p => ({ value: p, label: p }))}
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
                      <SearchableSelect
                        value={canonicalizeProvince(province)}
                        onChange={(val) => setProvince(val)}
                        required={isFieldRequired(settings, 'customers', 'province')}
                        placeholder="انتخاب استان..."
                        options={IRAN_PROVINCES.map(p => ({ value: p, label: p }))}
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
                                  onClick={() => { void handleOpenEdit(linkedCust); }}
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
                                onClick={() => { void handleOpenEdit(linkedCust); }}
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
                        <SearchableSelect
                          value={canonicalizeProvince(quickProvince)}
                          onChange={(val) => setQuickProvince(val)}
                          placeholder="انتخاب استان..."
                          className="text-xs !py-1.5"
                          options={IRAN_PROVINCES.map(p => ({ value: p, label: p }))}
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
        onConfirm={async () => {
          if (!customerToDeleteId) return;
          try {
            await customersApi.remove(customerToDeleteId);
            list.refresh();
          } catch (err) {
            // History can appear between opening this dialog and confirming it;
            // fall through to the migration prompt rather than just failing.
            if (err instanceof ApiError && err.code === 'HAS_HISTORY') {
              const refs = await customersApi.references(customerToDeleteId);
              const target = customers.find((c) => c.id === customerToDeleteId) ?? null;
              setMigrationTarget(target);
              setMigrationCounts(refs as unknown as CustomerReferenceCounts);
              setDeleteConfirmOpen(false);
              return;
            }
            reportError(err, 'حذف مشتری با خطا مواجه شد.');
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

      {/* Duplicate customer warning */}
      <DuplicateCustomerModal
        isOpen={dupMatches.length > 0}
        candidateName={dupCandidateName}
        matches={dupMatches}
        allCustomers={customers}
        onUseExisting={(existing) => {
          setDupMatches([]);
          setShowModal(false);
          setSearch(existing.companyName || '');
        }}
        onCreateAnyway={() => performSave()}
        onCancel={() => setDupMatches([])}
      />

      {/* Duplicate warning for the inline linked-customer form */}
      <DuplicateCustomerModal
        isOpen={quickDupMatches.length > 0}
        candidateName={quickDupPayload?.companyName || ''}
        matches={quickDupMatches}
        allCustomers={customers}
        onUseExisting={(existing) => {
          setQuickDupMatches([]);
          setQuickDupPayload(null);
          setSelectedLinks(prev => prev.includes(existing.id) ? prev : [...prev, existing.id]);
          resetQuickForm();
        }}
        onCreateAnyway={() => {
          if (quickDupPayload) commitQuickRelationCustomer(quickDupPayload);
        }}
        onCancel={() => {
          setQuickDupMatches([]);
          setQuickDupPayload(null);
        }}
      />

      {/* Deleting a customer that still has history: migrate first */}
      <CustomerDeleteMigrationModal
        isOpen={!!migrationTarget && !!migrationCounts}
        customer={migrationTarget}
        counts={migrationCounts || ({} as CustomerReferenceCounts)}
        onConfirm={async (replacementId) => {
          if (migrationTarget) {
            try {
              await customersApi.removeWithMigration(migrationTarget.id, replacementId);
              list.refresh();
            } catch (err) {
              reportError(err, 'انتقال سوابق و حذف مشتری با خطا مواجه شد.');
            }
          }
          setMigrationTarget(null);
          setMigrationCounts(null);
          setCustomerToDeleteId(null);
          setCustomerToDeleteName('');
        }}
        onCancel={() => {
          setMigrationTarget(null);
          setMigrationCounts(null);
          setCustomerToDeleteId(null);
          setCustomerToDeleteName('');
        }}
      />

    </div>
  );
}
