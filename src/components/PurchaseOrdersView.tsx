import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  ShoppingCart, 
  Edit, 
  Trash2, 
  Truck, 
  Anchor, 
  ShieldAlert,
  CheckCircle2, 
  DollarSign, 
  Calculator,
  Calendar,
  Clock,
  Package,
  X,
  PlusCircle,
  MinusCircle,
  RefreshCw,
  TrendingUp,
  Award,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { PurchaseOrder, Supplier, Project, Product, PurchaseOrderItem, ExchangeRate, ERPSettings, Proforma, Customer, SupplierInquiry } from '../types';
import { getTodayShamsi, addDaysToShamsi } from '../dateUtils';
import { getProformaOutcomeStatus } from '../useERPStore';
import ShamsiDatePicker from './ShamsiDatePicker';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import ConfirmModal from './ConfirmModal';
import QuickAddModal from './QuickAddModal';
import { SearchableSelect } from './SearchableSelect';
import ModuleNotesSection from './ModuleNotesSection';
import CustomerAgreementAlert from './CustomerAgreementAlert';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';

interface PurchaseOrdersViewProps {
  initialPrintDocId?: string;
  onClearInitialPrintDocId?: () => void;
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  projects: Project[];
  products: Product[];
  supplierInquiries?: SupplierInquiry[];
  exchangeRates: ExchangeRate[];
  proformas: Proforma[];
  addPurchaseOrder: (po: Omit<PurchaseOrder, 'id' | 'poNumber' | 'createdAt'> & { customValues?: Record<string, any> }) => void;
  updatePurchaseOrder: (po: PurchaseOrder) => void;
  updatePurchaseOrderStatus: (id: string, status: PurchaseOrder['status']) => void;
  deletePurchaseOrder: (id: string) => void;
  settings: ERPSettings;
  addSupplier?: (supplier: Omit<Supplier, 'id' | 'createdAt'>) => Supplier | any;
  addProject?: (project: Omit<Project, 'id' | 'code' | 'creationDate'> & { customValues?: Record<string, any> }) => Project | any;
  addProduct?: (product: any) => any;
  customers?: Customer[];
  addCustomer?: (customer: any) => any;
  currentUser?: any;
}

export default function PurchaseOrdersView({
  initialPrintDocId,
  onClearInitialPrintDocId,
  purchaseOrders,
  suppliers,
  projects,
  products,
  exchangeRates,
  proformas,
  supplierInquiries = [],
  addPurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
  deletePurchaseOrder,
  settings,
  addSupplier,
  addProject,
  addProduct,
  customers = [],
  addCustomer,
  currentUser
}: PurchaseOrdersViewProps) {
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [quickAddType, setQuickAddType] = useState<'customer' | 'project' | 'supplier' | 'product' | null>(null);
  const [quickAddProductIndex, setQuickAddProductIndex] = useState<number | null>(null);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalFullscreen, setIsCreateModalFullscreen] = useState(false);
  const [showLandedModal, setShowLandedModal] = useState(false);
  const [isLandedModalFullscreen, setIsLandedModalFullscreen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [isPOModalFullscreen, setIsPOModalFullscreen] = useState(false);

  // Editing state
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);

  // Dynamic Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [poToDeleteId, setPoToDeleteId] = useState<string | null>(null);
  const [poToDeleteNumber, setPoToDeleteNumber] = useState<string>('');

  React.useEffect(() => {
    if (initialPrintDocId) {
      const po = purchaseOrders.find(p => p.id === initialPrintDocId);
      if (po) {
        setSelectedPO(po);
        setShowLandedModal(true);
      }
    }
  }, [initialPrintDocId, purchaseOrders]);

  // Status Change State
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusTargetId, setStatusTargetId] = useState<string>('');
  const [newStatusSelected, setNewStatusSelected] = useState<PurchaseOrder['status']>('پیش‌نویس');
  const [statusDateInput, setStatusDateInput] = useState<string>('');

  // Form states
  const [status, setStatus] = useState<PurchaseOrder['status']>('پیش‌نویس');
  const [supplierId, setSupplierId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [proformaId, setProformaId] = useState('');
  const [orderDate, setOrderDate] = useState(getTodayShamsi());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => addDaysToShamsi(getTodayShamsi(), 45));
  const [currency, setCurrency] = useState<PurchaseOrder['currency']>('دلار');
  const [exchangeRateInput, setExchangeRateInput] = useState<number>(625000);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [shippingCostRIYAL, setShippingCostRIYAL] = useState<number>(0);
  const [customsDutyRIYAL, setCustomsDutyRIYAL] = useState<number>(0);
  const [remittanceFeeRIYAL, setRemittanceFeeRIYAL] = useState<number>(0);
  const [shippingCostForeign, setShippingCostForeign] = useState<number>(0);
  const [remittanceFeeForeign, setRemittanceFeeForeign] = useState<number>(0);
  
  // Timings
  const [paymentDate, setPaymentDate] = useState('');
  const [goodsReadyDate, setGoodsReadyDate] = useState('');
  const [shipmentDate, setShipmentDate] = useState('');
  const [clearanceDate, setClearanceDate] = useState('');
  const [receivedDate, setReceivedDate] = useState('');

  const [notes, setNotes] = useState('');
  const [selectedInquiryId, setSelectedInquiryId] = useState('');

  const determineStatusFromDates = (
    ord: string,
    pay: string,
    ready: string,
    ship: string,
    clear: string,
    rec: string
  ): PurchaseOrder['status'] => {
    if (rec) return 'تحویل شده (رسید انبار)';
    if (clear) return 'در حال حمل به انبار';
    if (ship) return 'ترخیص گمرک';
    if (ready) return 'حمل و ترانزیت';
    if (pay) return 'در حال آماده‌سازی سازنده';
    if (ord) return 'پرداخت و سفارش به سازنده';
    return 'پیش‌نویس';
  };

  // Quick Supplier Creation States
  const [showQuickSupplierModal, setShowQuickSupplierModal] = useState(false);
  const [quickSupName, setQuickSupName] = useState('');
  const [quickSupCountry, setQuickSupCountry] = useState('چین');
  const [quickSupContactPerson, setQuickSupContactPerson] = useState('');
  const [quickSupPhone, setQuickSupPhone] = useState('');
  const [quickSupEmail, setQuickSupEmail] = useState('');

  // Quick Project Creation States
  const [showQuickProjectModal, setShowQuickProjectModal] = useState(false);
  const [quickProjName, setQuickProjName] = useState('');
  const [quickProjCustomerId, setQuickProjCustomerId] = useState('');
  const [quickProjStage, setQuickProjStage] = useState('استعلام اولیه');
  const [quickProjSalesExpert, setQuickProjSalesExpert] = useState('');

  // Handle auto rate change based on selection
  const handleCurrencyChange = (curr: PurchaseOrder['currency']) => {
    setCurrency(curr);
    let mappedSymbol = 'USD';
    if (curr === 'دلار') mappedSymbol = 'USD';
    else if (curr === 'یورو') mappedSymbol = 'EUR';
    else if (curr === 'درهم') mappedSymbol = 'AED';
    
    if (curr === 'ریال') {
      setExchangeRateInput(1);
    } else {
      const match = exchangeRates.find(r => r.currency === mappedSymbol);
      if (match) setExchangeRateInput(match.rateToRIYAL);
    }
  };

  // Open create
  const handleOpenCreate = () => {
    setEditingPO(null);
    setSupplierId(suppliers[0]?.id || '');
    setProjectId('');
    setProformaId('');
    setSelectedInquiryId('');
    setOrderDate(getTodayShamsi());
    setStatus('پرداخت و سفارش به سازنده');
    setExpectedDeliveryDate(addDaysToShamsi(getTodayShamsi(), 45));
    handleCurrencyChange('دلار');
    setItems([{ id: `poi-${Date.now()}-0`, productId: products[0]?.id || '', productName: products[0]?.displayName || '', productCode: products[0]?.code || '', brand: products[0]?.brand || '', quantity: 1, unitPriceForeignCurrency: 100, totalPriceForeignCurrency: 100 }]);
    setShippingCostRIYAL(0);
    setCustomsDutyRIYAL(0);
    setRemittanceFeeRIYAL(0);
    setShippingCostForeign(0);
    setRemittanceFeeForeign(0);
    setPaymentDate('');
    setGoodsReadyDate('');
    setShipmentDate('');
    setClearanceDate('');
    setReceivedDate('');
    setNotes('');
    setCustomValues({});
    setShowCreateModal(true);
  };

  // Open edit
  const handleOpenEdit = (po: PurchaseOrder) => {
    setEditingPO(po);
    setStatus(po.status);
    setSupplierId(po.supplierId);
    setProjectId(po.projectId || '');
    setProformaId(po.proformaId || '');
    setSelectedInquiryId('');
    setOrderDate(po.orderDate);
    setExpectedDeliveryDate(po.expectedDeliveryDate);
    setCurrency(po.currency);
    setExchangeRateInput(po.exchangeRate);
    setItems(po.items);
    setShippingCostRIYAL(po.shippingCostRIYAL || 0);
    setCustomsDutyRIYAL(po.customsDutyRIYAL || 0);
    setRemittanceFeeRIYAL(po.remittanceFeeRIYAL || 0);
    setShippingCostForeign(po.shippingCostForeign !== undefined ? po.shippingCostForeign : (po.shippingCostRIYAL && po.exchangeRate ? Number((po.shippingCostRIYAL / po.exchangeRate).toFixed(2)) : 0));
    setRemittanceFeeForeign(po.remittanceFeeForeign !== undefined ? po.remittanceFeeForeign : (po.remittanceFeeRIYAL && po.exchangeRate ? Number((po.remittanceFeeRIYAL / po.exchangeRate).toFixed(2)) : 0));
    setPaymentDate(po.paymentDate || '');
    setGoodsReadyDate(po.goodsReadyDate || '');
    setShipmentDate(po.shipmentDate || '');
    setClearanceDate(po.clearanceDate || '');
    setReceivedDate(po.receivedDate || '');
    setNotes(po.notes || '');
    setCustomValues(po.customValues || {});
    setShowCreateModal(true);
  };

  // Items manipulation
  const handleAddItemLine = () => {
    const firstProd = products[0];
    if (!firstProd) return;
    setItems([...items, {
      id: `poi-${Date.now()}-${items.length}`,
      productId: firstProd.id,
      productName: firstProd.displayName,
      productCode: firstProd.code,
      brand: firstProd.brand,
      quantity: 1,
      unitPriceForeignCurrency: 100,
      totalPriceForeignCurrency: 100
    }]);
  };

  const handleRemoveItemLine = (idx: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemProductChange = (idx: number, pId: string) => {
    const prod = products.find(p => p.id === pId);
    if (!prod) return;
    const newItems = [...items];
    newItems[idx] = {
      ...newItems[idx],
      productId: pId,
      productName: prod.displayName,
      productCode: prod.code,
      brand: prod.brand,
      totalPriceForeignCurrency: newItems[idx].quantity * newItems[idx].unitPriceForeignCurrency
    };
    setItems(newItems);
  };

  const handleItemVariantChange = (index: number, variantId: string) => {
    const newItems = [...items];
    const item = newItems[index];
    const prod = products.find(p => p.id === item.productId);
    if (!prod || !prod.hasVariants || !prod.variants) return;

    const variant = prod.variants.find(v => v.id === variantId);
    if (!variant) return;

    newItems[index] = {
      ...item,
      variantId: variant.id,
      productCode: variant.sku,
    };
    setItems(newItems);
  };
  const handleItemFieldChange = (idx: number, field: 'quantity' | 'unitPriceForeignCurrency', val: number) => {
    const newItems = [...items];
    const updatedQty = field === 'quantity' ? Math.max(0, val) : newItems[idx].quantity;
    const updatedPrice = field === 'unitPriceForeignCurrency' ? Math.max(0, val) : newItems[idx].unitPriceForeignCurrency;
    
    newItems[idx] = {
      ...newItems[idx],
      [field]: Math.max(0, val),
      totalPriceForeignCurrency: updatedQty * updatedPrice
    };
    setItems(newItems);
  };

  const subTotalForeign = items.reduce((sum, item) => sum + (item.quantity * item.unitPriceForeignCurrency), 0);
  const calculatedLandedCost = Math.round((subTotalForeign + remittanceFeeForeign + shippingCostForeign) * exchangeRateInput + customsDutyRIYAL);
  const calculatedLandedCostForeign = Number((subTotalForeign + remittanceFeeForeign + shippingCostForeign + (exchangeRateInput > 0 ? (customsDutyRIYAL / exchangeRateInput) : 0)).toFixed(2));

  // Handle Save
  const handleSavePO = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) return;

    // Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === 'purchaseOrders');
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }

    const supplierName = suppliers.find(s => s.id === supplierId)?.name || 'تامین‌کننده نامشخص';
    const projName = projects.find(p => p.id === projectId)?.name || '';
    const pfObj = proformas.find(pf => pf.id === proformaId);
    const pfNum = pfObj?.proformaNumber || '';

    const formattedItems: PurchaseOrderItem[] = items.map((item, i) => ({
      id: item.id || `poi-${Date.now()}-${i}`,
      ...item,
      totalPriceForeignCurrency: item.quantity * item.unitPriceForeignCurrency
    }));

    // Empty Tag Numbers validation on Purchase Orders
    const itemsWithoutTag = formattedItems.filter(item => !item.tagNumber || !item.tagNumber.trim());
    if (itemsWithoutTag.length > 0 && status !== 'پیش‌نویس') {
      const confirmTags = window.confirm(
        `هشدار تگ نامبر:\n` +
        `اقلام زیر در سفارش خرید فاقد تگ نامبر (Tag Number) هستند:\n` +
        `${itemsWithoutTag.map(it => `- ${it.productName || 'کالا'}`).join('\n')}\n\n` +
        `در فاکتورها و سفارشات خرید تجهیزات ابزاردقیق، عدم درج تگ نامبر می‌تواند باعث مغایرت شدید در زمان ساخت و گمرک شود.\n` +
        `آیا اطمینان دارید که می‌خواهید سفارش خرید را ثبت کنید؟`
      );
      if (!confirmTags) {
        return;
      }
    }

    if (editingPO) {
      updatePurchaseOrder({
        ...editingPO,
        supplierId,
        supplierName,
        projectId: projectId || undefined,
        projectName: projectId ? projName : undefined,
        proformaId: proformaId || undefined,
        proformaNumber: proformaId ? pfNum : undefined,
        orderDate,
        expectedDeliveryDate,
        currency,
        exchangeRate: exchangeRateInput,
        items: formattedItems,
        totalForeignAmount: subTotalForeign,
        shippingCostRIYAL: Math.round(shippingCostForeign * exchangeRateInput),
        customsDutyRIYAL,
        remittanceFeeRIYAL: Math.round(remittanceFeeForeign * exchangeRateInput),
        shippingCostForeign,
        remittanceFeeForeign,
        calculatedLandedCostRIYAL: calculatedLandedCost,
        calculatedLandedCostForeign,
        status,
        paymentDate: paymentDate || undefined,
        goodsReadyDate: goodsReadyDate || undefined,
        shipmentDate: shipmentDate || undefined,
        clearanceDate: clearanceDate || undefined,
        receivedDate: receivedDate || undefined,
        customValues,
        notes
      });
    } else {
      addPurchaseOrder({
        supplierId,
        supplierName,
        projectId: projectId || undefined,
        projectName: projectId ? projName : undefined,
        proformaId: proformaId || undefined,
        proformaNumber: proformaId ? pfNum : undefined,
        orderDate,
        expectedDeliveryDate,
        currency,
        exchangeRate: exchangeRateInput,
        items: formattedItems,
        totalForeignAmount: subTotalForeign,
        shippingCostRIYAL: Math.round(shippingCostForeign * exchangeRateInput),
        customsDutyRIYAL,
        remittanceFeeRIYAL: Math.round(remittanceFeeForeign * exchangeRateInput),
        shippingCostForeign,
        remittanceFeeForeign,
        calculatedLandedCostRIYAL: calculatedLandedCost,
        calculatedLandedCostForeign,
        status,
        paymentDate: paymentDate || undefined,
        goodsReadyDate: goodsReadyDate || undefined,
        shipmentDate: shipmentDate || undefined,
        clearanceDate: clearanceDate || undefined,
        receivedDate: receivedDate || undefined,
        customValues,
        notes
      });
    }

    setShowCreateModal(false);
  };

  // Open Status Adjust modal
  const handleOpenStatusChange = (poId: string, currentStatus: PurchaseOrder['status']) => {
    setStatusTargetId(poId);
    setNewStatusSelected(currentStatus);
    setStatusDateInput(getTodayShamsi());
    setShowStatusModal(true);
  };

  const handleSaveStatusChange = (e: React.FormEvent) => {
    e.preventDefault();
    const po = purchaseOrders.find(p => p.id === statusTargetId);
    if (!po) return;

    const updatedPO = { ...po, status: newStatusSelected };
    const eventDate = statusDateInput || getTodayShamsi();

    if (newStatusSelected === 'پیش‌نویس') {
      updatedPO.paymentDate = undefined;
      updatedPO.goodsReadyDate = undefined;
      updatedPO.shipmentDate = undefined;
      updatedPO.clearanceDate = undefined;
      updatedPO.receivedDate = undefined;
    } else if (newStatusSelected === 'پرداخت و سفارش به سازنده') {
      updatedPO.orderDate = eventDate;
      updatedPO.paymentDate = undefined;
      updatedPO.goodsReadyDate = undefined;
      updatedPO.shipmentDate = undefined;
      updatedPO.clearanceDate = undefined;
      updatedPO.receivedDate = undefined;
    } else if (newStatusSelected === 'در حال آماده‌سازی سازنده') {
      if (!updatedPO.orderDate) updatedPO.orderDate = eventDate;
      updatedPO.paymentDate = eventDate;
      updatedPO.goodsReadyDate = undefined;
      updatedPO.shipmentDate = undefined;
      updatedPO.clearanceDate = undefined;
      updatedPO.receivedDate = undefined;
    } else if (newStatusSelected === 'حمل و ترانزیت') {
      if (!updatedPO.orderDate) updatedPO.orderDate = eventDate;
      if (!updatedPO.paymentDate) updatedPO.paymentDate = eventDate;
      updatedPO.goodsReadyDate = eventDate;
      updatedPO.shipmentDate = undefined;
      updatedPO.clearanceDate = undefined;
      updatedPO.receivedDate = undefined;
    } else if (newStatusSelected === 'ترخیص گمرک') {
      if (!updatedPO.orderDate) updatedPO.orderDate = eventDate;
      if (!updatedPO.paymentDate) updatedPO.paymentDate = eventDate;
      if (!updatedPO.goodsReadyDate) updatedPO.goodsReadyDate = eventDate;
      updatedPO.shipmentDate = eventDate;
      updatedPO.clearanceDate = undefined;
      updatedPO.receivedDate = undefined;
    } else if (newStatusSelected === 'در حال حمل به انبار') {
      if (!updatedPO.orderDate) updatedPO.orderDate = eventDate;
      if (!updatedPO.paymentDate) updatedPO.paymentDate = eventDate;
      if (!updatedPO.goodsReadyDate) updatedPO.goodsReadyDate = eventDate;
      if (!updatedPO.shipmentDate) updatedPO.shipmentDate = eventDate;
      updatedPO.clearanceDate = eventDate;
      updatedPO.receivedDate = undefined;
    } else if (newStatusSelected === 'تحویل شده (رسید انبار)') {
      if (!updatedPO.orderDate) updatedPO.orderDate = eventDate;
      if (!updatedPO.paymentDate) updatedPO.paymentDate = eventDate;
      if (!updatedPO.goodsReadyDate) updatedPO.goodsReadyDate = eventDate;
      if (!updatedPO.shipmentDate) updatedPO.shipmentDate = eventDate;
      if (!updatedPO.clearanceDate) updatedPO.clearanceDate = eventDate;
      updatedPO.receivedDate = eventDate;
    }

    updatePurchaseOrder(updatedPO);
    setShowStatusModal(false);
  };

  // Landed Cost Modal
  const handleOpenLanded = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setShowLandedModal(true);
  };

  // Filter
  const filteredPOs = purchaseOrders.filter(po => {
    const matchesSearch = 
      (po.poNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (po.supplierName || '').toLowerCase().includes(search.toLowerCase()) ||
      (po.projectName && po.projectName.toLowerCase().includes(search.toLowerCase()));
    
    const matchesStatus = selectedStatus === 'all' || po.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (st: PurchaseOrder['status']) => {
    switch (st) {
      case 'پیش‌نویس': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'پرداخت و سفارش به سازنده': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'در حال آماده‌سازی سازنده': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'حمل و ترانزیت': return 'bg-sky-50 text-sky-700 border-sky-200 animate-pulse';
      case 'ترخیص گمرک': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'در حال حمل به انبار': return 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse';
      case 'تحویل شده (رسید انبار)': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
  };

  const getStatusIcon = (st: PurchaseOrder['status']) => {
    switch (st) {
      case 'پیش‌نویس': return <Calendar size={12} />;
      case 'پرداخت و سفارش به سازنده': return <ShoppingCart size={12} />;
      case 'در حال آماده‌سازی سازنده': return <Clock size={12} />;
      case 'حمل و ترانزیت': return <Truck size={12} />;
      case 'ترخیص گمرک': return <Anchor size={12} />;
      case 'در حال حمل به انبار': return <Package size={12} />;
      case 'تحویل شده (رسید انبار)': return <CheckCircle2 size={12} />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* View Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">سفارشات خرید خارجی و واردات</h1>
          <p className="text-slate-500 text-sm mt-1">ردیابی کالا در مسیر حمل دریایی/هوایی، ترخیص گمرکی، احتساب هزینه‌های بندری و محاسبه بهای تمام شده نهایی</p>
        </div>
        <button 
          onClick={handleOpenCreate}
          className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center gap-2"
        >
          <Plus size={16} />
          ثبت پروفرما / سفارش خرید جدید
        </button>
      </div>

      {/* Search & Filter */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="جستجو در شماره سفارش، نام تأمین‌کننده یا پروژه مرتبط..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
          />
        </div>

        <div className="relative w-full md:w-64 flex items-center gap-2">
          <Filter size={16} className="text-slate-400 flex-shrink-0" />
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
          >
            <option value="all">همه وضعیت‌های سفارش</option>
            <option value="پیش‌نویس">پیش‌نویس</option>
            <option value="پرداخت و سفارش به سازنده">پرداخت و سفارش به سازنده</option>
            <option value="در حال آماده‌سازی سازنده">در حال آماده‌سازی سازنده</option>
            <option value="حمل و ترانزیت">حمل و ترانزیت</option>
            <option value="ترخیص گمرک">ترخیص گمرک</option>
            <option value="در حال حمل به انبار">در حال حمل به انبار</option>
            <option value="تحویل شده (رسید انبار)">تحویل شده نهایی (رسید انبار)</option>
          </select>
        </div>
      </div>

      {/* Grid of PO cards */}
      <div className="grid grid-cols-1 gap-5">
        {filteredPOs.map((po) => {
          const totalQty = po.items.reduce((sum, it) => sum + it.quantity, 0);
          const landedCostAllocatedPerUnit = po.items.length > 0 
            ? Math.round(po.calculatedLandedCostRIYAL / totalQty)
            : 0;

          const poLandedCostForeign = po.calculatedLandedCostForeign || 
            (po.totalForeignAmount + 
             (po.remittanceFeeForeign || (po.remittanceFeeRIYAL && po.exchangeRate ? Number((po.remittanceFeeRIYAL / po.exchangeRate).toFixed(2)) : 0)) + 
             (po.shippingCostForeign || (po.shippingCostRIYAL && po.exchangeRate ? Number((po.shippingCostRIYAL / po.exchangeRate).toFixed(2)) : 0)) + 
             (po.exchangeRate > 0 ? (po.customsDutyRIYAL / po.exchangeRate) : 0));

          const landedCostAllocatedPerUnitForeign = po.items.length > 0
            ? Number((poLandedCostForeign / totalQty).toFixed(2))
            : 0;

          return (
            <div 
              key={po.id} 
              className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 hover:shadow-md transition flex flex-col gap-4"
            >
              <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center">
                
                {/* Col 1: PO specifications */}
                <div className="space-y-2 lg:flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-extrabold text-slate-900 font-mono">{po.poNumber}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${getStatusColor(po.status)}`}>
                      {getStatusIcon(po.status)}
                      <span>{po.status}</span>
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-600">
                    <div>تأمین‌کننده: <span className="font-bold text-slate-800">{po.supplierName}</span></div>
                    <div>پروژه مرتبط: <span className="text-slate-700 font-bold">{po.projectName || 'خرید عمومی بدون پروژه'}</span></div>
                    {po.proformaNumber && (
                      <div>پیش‌فاکتور مرتبط: <span className="text-sky-700 font-bold">{po.proformaNumber}</span></div>
                    )}
                    <div>تاریخ ثبت سفارش: <span className="font-mono">{po.orderDate}</span></div>
                    <div>تاریخ تحویل احتمالی: <span className="font-mono text-amber-600 font-semibold">{po.expectedDeliveryDate}</span></div>
                    <div>تاریخ تحویل نهایی در انبار: <span className="font-mono text-emerald-650 font-bold">{po.receivedDate || 'ثبت نشده'}</span></div>
                  </div>

                  {/* Dynamic Custom Fields Read-Only View */}
                  <CustomFieldsDetailView
                    module="purchaseOrders"
                    customFields={settings?.customFields || []}
                    customValues={po.customValues}
                  />
                </div>

                {/* Col 2: Value and calculations overview */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-2 text-xs font-mono w-full lg:w-80">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>ارزش فاکتور (ارزی):</span>
                    <span className="font-bold text-slate-800">{po.totalForeignAmount.toLocaleString()} {po.currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400 text-[11px]">
                    <span>نرخ تسعیر ارز:</span>
                    <span>{po.exchangeRate.toLocaleString()} ریال</span>
                  </div>
                  
                  <div className="border-t border-dashed border-slate-200 pt-2 space-y-1.5">
                    <div className="flex justify-between items-center text-slate-900">
                      <span className="font-semibold">بهای تمام‌شده ارزی (Landed):</span>
                      <span className="font-bold text-sky-700">{poLandedCostForeign.toLocaleString()} {po.currency}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-900">
                      <span className="font-semibold">بهای تمام‌شده ریالی (تسعیر):</span>
                      <span className="font-extrabold text-emerald-700">{po.calculatedLandedCostRIYAL.toLocaleString()} ریال</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-2 space-y-1 text-[10px] text-slate-500">
                    <div className="flex justify-between">
                      <span>متوسط واحد (ارزی):</span>
                      <span>{landedCostAllocatedPerUnitForeign.toLocaleString()} {po.currency}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>متوسط واحد (ریالی):</span>
                      <span>{landedCostAllocatedPerUnit.toLocaleString()} ریال</span>
                    </div>
                  </div>
                </div>

                {/* Col 3: Quick Action buttons */}
                <div className="flex lg:flex-col justify-end gap-2 w-full lg:w-fit border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100">
                  
                  {/* Status Trigger */}
                  <button
                    onClick={() => handleOpenStatusChange(po.id, po.status)}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 justify-center flex-1 lg:flex-none"
                  >
                    <RefreshCw size={13} />
                    <span>تغییر وضعیت حمل</span>
                  </button>

                  {/* Edit PO Button */}
                  <button
                    onClick={() => handleOpenEdit(po)}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 justify-center flex-1 lg:flex-none"
                  >
                    <Edit size={13} />
                    <span>ویرایش جزئیات</span>
                  </button>

                  {/* Landed Cost Details */}
                  <button
                    onClick={() => handleOpenLanded(po)}
                    className="px-3 py-2 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 justify-center flex-1 lg:flex-none border border-sky-100"
                  >
                    <Calculator size={13} />
                    <span>جزئیات تمام شده (Landed)</span>
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => {
                      setPoToDeleteId(po.id);
                      setPoToDeleteNumber(po.poNumber || '');
                      setDeleteConfirmOpen(true);
                    }}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition flex items-center justify-center self-end"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

              </div>

              {/* Items mapping section */}
              <div className="border-t border-slate-100 pt-3">
                <span className="text-[11px] font-bold text-slate-400 block mb-1.5">اقلام و ردیف‌های پیش‌فاکتور مرتبط این سفارش:</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {po.items.map((it, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between text-xs bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 gap-2">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800">{it.productName}</span>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[10px] text-slate-500 font-mono">کد کالا: {it.productCode} ({it.quantity} عدد)</span>
                          {it.tagNumber && (
                            <span className="font-sans text-rose-600 bg-rose-50 border border-rose-100 px-1 py-0.2 rounded font-bold text-[9px]">تگ: {it.tagNumber}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        {it.proformaItemName ? (
                          <span className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded-full mb-1">
                            ردیف مرتبط: {it.proformaItemName}
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full mb-1">
                            بدون ردیف پیش‌فاکتور (خرید متفرقه)
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-slate-600 font-bold">
                          {(it.quantity * it.unitPriceForeignCurrency).toLocaleString()} {po.currency}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline / Cycle Tracker */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-600">چرخه زمانی فرآیند تامین و واردات:</span>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-150 font-bold">زمان واقعی فرآیند</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
                  {[
                    { label: '۱. ثبت سفارش اولیه', date: po.orderDate, color: 'text-slate-700 border-slate-200 bg-slate-50' },
                    { label: '۲. پرداخت صرافی و جاری شدن', date: po.paymentDate, color: 'text-blue-700 border-blue-200 bg-blue-50' },
                    { label: '۳. آماده‌سازی سازنده', date: po.goodsReadyDate, color: 'text-amber-700 border-amber-200 bg-amber-50' },
                    { label: '۴. حمل و ترانزیت بین‌الملل', date: po.shipmentDate, color: 'text-sky-700 border-sky-200 bg-sky-50' },
                    { label: '۵. ترخیص گمرکی نهایی', date: po.clearanceDate, color: 'text-purple-700 border-purple-200 bg-purple-50' },
                    { label: '۶. تحویل نهایی (رسید انبار)', date: po.receivedDate, color: 'text-emerald-700 border-emerald-200 bg-emerald-50' },
                  ].map((step, idx) => (
                    <div 
                      key={idx} 
                      className={`p-2 rounded-xl border ${step.date ? `${step.color} shadow-xs` : 'border-slate-100 bg-slate-50/50 opacity-40'} flex flex-col justify-center items-center`}
                    >
                      <span className="text-[10px] font-bold text-slate-500 mb-0.5">{step.label}</span>
                      <span className="text-xs font-extrabold font-mono">{step.date || 'در انتظار...'}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          );
        })}

        {filteredPOs.length === 0 && (
          <div className="text-center bg-white p-12 rounded-2xl border border-dashed border-slate-200">
            <ShoppingCart className="mx-auto text-slate-300 mb-3" size={48} />
            <p className="text-sm text-slate-500">هیچ سفارش خریدی یافت نشد.</p>
          </div>
        )}
      </div>

      {/* Landed Cost Analysis Details Modal */}
      {showLandedModal && selectedPO && (() => {
        const selRemittanceFeeForeign = selectedPO.remittanceFeeForeign !== undefined 
          ? selectedPO.remittanceFeeForeign 
          : (selectedPO.remittanceFeeRIYAL && selectedPO.exchangeRate ? Number((selectedPO.remittanceFeeRIYAL / selectedPO.exchangeRate).toFixed(2)) : 0);
        const selShippingCostForeign = selectedPO.shippingCostForeign !== undefined 
          ? selectedPO.shippingCostForeign 
          : (selectedPO.shippingCostRIYAL && selectedPO.exchangeRate ? Number((selectedPO.shippingCostRIYAL / selectedPO.exchangeRate).toFixed(2)) : 0);
        const selLandedCostForeign = selectedPO.calculatedLandedCostForeign || 
          (selectedPO.totalForeignAmount + selRemittanceFeeForeign + selShippingCostForeign + (selectedPO.exchangeRate > 0 ? (selectedPO.customsDutyRIYAL / selectedPO.exchangeRate) : 0));
        
        return (
          <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 ${isLandedModalFullscreen ? 'p-0' : 'p-4'}`}>
            <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in transition-all duration-300 flex flex-col ${
              isLandedModalFullscreen 
                ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
                : 'rounded-2xl w-full max-w-lg'
            }`}>
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-bold text-slate-800">برگه تسهیم هزینه و بهای تمام شده نهایی</h3>
                <div className="flex items-center gap-1.5">
                  <button 
                    type="button"
                    onClick={() => setIsLandedModalFullscreen(!isLandedModalFullscreen)} 
                    className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                    title={isLandedModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                  >
                    {isLandedModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button 
                    type="button"
                    onClick={() => { setShowLandedModal(false); setIsLandedModalFullscreen(false); onClearInitialPrintDocId?.(); }} 
                    className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className={`p-6 space-y-4 text-xs font-sans overflow-y-auto ${isLandedModalFullscreen ? 'flex-1 max-h-[calc(100vh-80px)]' : ''}`}>
                <div className="bg-slate-900 text-white p-4 rounded-xl font-mono text-center space-y-1">
                  <p className="text-[10px] text-sky-400 uppercase">سند خرید مادری</p>
                  <h4 className="text-base font-bold">{selectedPO.poNumber}</h4>
                  <p className="text-xs text-slate-400">تأمین‌کننده: {selectedPO.supplierName}</p>
                </div>

                {/* Items specification */}
                <div className="space-y-1.5 border border-slate-200 rounded-lg p-3">
                  <p className="font-bold text-slate-700 pb-1 border-b border-dashed">کالاهای سفارش داده شده</p>
                  {selectedPO.items.map((it, i) => (
                    <div key={i} className="flex justify-between py-1 text-slate-600 font-mono flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-sans font-medium text-slate-700">{it.productName} ({it.quantity} عدد)</span>
                        {it.tagNumber && (
                          <span className="font-sans text-rose-600 bg-rose-50 border border-rose-100 px-1 py-0.2 rounded font-bold text-[9px]">تگ: {it.tagNumber}</span>
                        )}
                      </div>
                      <span>{it.totalPriceForeignCurrency.toLocaleString()} {selectedPO.currency}</span>
                    </div>
                  ))}
                </div>

                {/* Landed math breakdown */}
                <div className="bg-slate-50 p-4 rounded-xl space-y-3 font-mono border">
                  <div className="flex justify-between items-center text-slate-700">
                    <span>۱. ارزش کل پروفرما (ارزی):</span>
                    <span className="font-bold">{selectedPO.totalForeignAmount.toLocaleString()} {selectedPO.currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>۲. کارمزد حواله پول صرافی (ارزی):</span>
                    <span className="text-blue-600">+{selRemittanceFeeForeign.toLocaleString()} {selectedPO.currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>۳. هزینه ترابری / حمل بین‌الملل (ارزی):</span>
                    <span className="text-sky-600">+{selShippingCostForeign.toLocaleString()} {selectedPO.currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>۴. تعرفه ترخیص گمرکی و عوارض (ریالی):</span>
                    <span className="text-purple-600">+{selectedPO.customsDutyRIYAL.toLocaleString()} ریال</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400 text-[11px] border-t border-dashed border-slate-200 pt-2">
                    <span>نرخ تسعیر ارز:</span>
                    <span>{selectedPO.exchangeRate.toLocaleString()} ریال</span>
                  </div>
                  <div className="pt-2 flex justify-between items-center text-sm font-bold text-sky-800 border-t border-slate-200">
                    <span>بهای تمام‌شده ارزی (Landed):</span>
                    <span>{Number(selLandedCostForeign.toFixed(2)).toLocaleString()} {selectedPO.currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-base font-extrabold text-emerald-700">
                    <span>بهای تمام‌شده ریالی (تسعیر):</span>
                    <span>{selectedPO.calculatedLandedCostRIYAL.toLocaleString()} ریال</span>
                  </div>
                </div>

                <div className="p-3 bg-blue-50 text-blue-800 border border-blue-100 rounded-lg text-[10px] leading-relaxed flex items-center gap-2">
                  <Award size={16} className="text-blue-600 flex-shrink-0" />
                  <span>مکانیزم لندد کاست به بازرگان اجازه می‌دهد قیمت دقیق پایه هر یک از محصولات وارداتی را با احتساب هزینه‌های ارزی حواله و حمل، به انضمام هزینه‌های ترخیص ریالی محاسبه کند.</span>
                </div>

                {/* Purchase Order Special Notes & Agreements */}
                <div className="pt-4 border-t border-slate-100">
                  <ModuleNotesSection
                    notes={selectedPO.moduleNotes || []}
                    currentUser={currentUser}
                    title="توافقات و یادداشت‌های سفارش خارجی"
                    placeholder="توافق ارزی خاص، جزییات حمل یا کامنت جدید درباره تامین کالا..."
                    onAddNote={(text) => {
                      const newNote = {
                        id: `note-${Date.now()}`,
                        text,
                        createdAt: getTodayShamsi(),
                        author: currentUser?.fullName || currentUser?.username || 'کاربر سیستم'
                      };
                      const updated = {
                        ...selectedPO,
                        moduleNotes: [...(selectedPO.moduleNotes || []), newNote]
                      };
                      updatePurchaseOrder(updated);
                      setSelectedPO(updated);
                    }}
                    onDeleteNote={(id) => {
                      const updatedNotes = (selectedPO.moduleNotes || []).filter(n => n.id !== id);
                      const updated = {
                        ...selectedPO,
                        moduleNotes: updatedNotes
                      };
                      updatePurchaseOrder(updated);
                      setSelectedPO(updated);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Status Adjustment Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">بروزرسانی وضعیت سفارش و حمل کالا</h3>
              <button onClick={() => setShowStatusModal(false)} className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveStatusChange} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">مرحله فعلی سفارش خرید</label>
                <select
                  value={newStatusSelected}
                  onChange={(e) => setNewStatusSelected(e.target.value as PurchaseOrder['status'])}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                >
                  <option value="پیش‌نویس">پیش‌نویس (Draft)</option>
                  <option value="پرداخت و سفارش به سازنده">پرداخت و سفارش به سازنده (Payment & Order)</option>
                  <option value="در حال آماده‌سازی سازنده">در حال آماده‌سازی سازنده (Manufacturing)</option>
                  <option value="حمل و ترانزیت">حمل و ترانزیت (Shipping & Transit)</option>
                  <option value="ترخیص گمرک">ترخیص گمرک (Customs Clearance)</option>
                  <option value="در حال حمل به انبار">در حال حمل به انبار (In Transit to Warehouse)</option>
                  <option value="تحویل شده (رسید انبار)">تحویل شده نهایی (رسید انبار) ★</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <ShamsiDatePicker
                  label="تاریخ وقوع رویداد / مرحله جاری"
                  value={statusDateInput}
                  onChange={(val) => setStatusDateInput(val)}
                  required
                />
              </div>



              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition"
                >
                  تغییر مرحله سند
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit PO Modal */}
      {showCreateModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isCreateModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in transition-all duration-300 flex flex-col ${
            isCreateModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full' 
              : 'rounded-2xl w-full max-w-4xl my-8'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">
                {editingPO ? `ویرایش پروفرما / سفارش خرید خارجی` : 'ثبت پروفرما / سفارش خرید خارجی جدید'}
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsCreateModalFullscreen(!isCreateModalFullscreen)} 
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isCreateModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isCreateModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowCreateModal(false); setEditingPO(null); setIsCreateModalFullscreen(false); }} 
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSavePO} className={`p-6 space-y-6 overflow-y-auto ${isCreateModalFullscreen ? 'max-h-[calc(100vh-140px)] flex-1' : 'max-h-[80vh]'}`}>
              
              {/* Top Row Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Project Linked */}
                <div className="space-y-1.5 w-full min-w-0">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'purchaseOrders', 'projectId', 'کد پروژه')}</label>
                  <div className="flex gap-1.5 items-center w-full min-w-0">
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={projectId}
                      onChange={(val) => {
                        const projId = val;
                        setProjectId(projId);
                        if (projId) {
                          const relatedProformas = proformas.filter(pf => pf.projectId === projId);
                          const approvedPf = relatedProformas.find(pf => {
                            const outcome = getProformaOutcomeStatus(pf);
                            return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
                          });
                          const targetPf = approvedPf || relatedProformas[0];
                          if (targetPf) {
                            setProformaId(targetPf.id);
                            if (targetPf.items && targetPf.items.length > 0) {
                              const poItems = targetPf.items.map((pfItem, idx) => {
                                const prod = products.find(p => p.id === pfItem.productId);
                                const basePriceForeign = prod ? Math.round(prod.basePriceRIYAL / exchangeRateInput) || 100 : 100;
                                return {
                                  id: `poi-${Date.now()}-${idx}`,
                                  productId: pfItem.productId,
                                  productName: pfItem.productName,
                                  productCode: pfItem.productCode,
                                  brand: pfItem.brand,
                                  quantity: pfItem.quantity,
                                  unitPriceForeignCurrency: basePriceForeign,
                                  totalPriceForeignCurrency: pfItem.quantity * basePriceForeign,
                                  proformaItemId: pfItem.id,
                                  proformaItemName: `${pfItem.productName} (تعداد: ${pfItem.quantity})`,
                                  tagNumber: pfItem.tagNumber
                                };
                              });
                              setItems(poItems);
                            }
                          } else {
                            // No proforma, check if the project itself has needed items
                            const proj = projects.find(p => p.id === projId);
                            if (proj && proj.itemsNeeded && proj.itemsNeeded.length > 0) {
                              const poItems = proj.itemsNeeded.map((neededItem, idx) => {
                                const prod = products.find(p => p.id === neededItem.productId);
                                const basePriceForeign = prod ? Math.round(prod.basePriceRIYAL / exchangeRateInput) || 100 : 100;
                                return {
                                  id: `poi-${Date.now()}-${idx}`,
                                  productId: neededItem.productId === 'generic' ? '' : neededItem.productId,
                                  productName: prod?.displayName || neededItem.name,
                                  productCode: prod?.code || '',
                                  brand: prod?.brand || '',
                                  quantity: neededItem.quantity,
                                  unitPriceForeignCurrency: basePriceForeign,
                                  totalPriceForeignCurrency: neededItem.quantity * basePriceForeign,
                                  tagNumber: neededItem.tagNumber
                                };
                              });
                              setItems(poItems);
                            }
                          }
                        }
                      }}
                      required={isFieldRequired(settings, 'purchaseOrders', 'projectId')}
                      options={[
                        { value: '', label: 'خرید عمومی (بدون پروژه)' },
                        ...projects.map(p => ({ value: p.id, label: `${p.name} (${p.code})` }))
                      ]}
                      placeholder="خرید عمومی (بدون پروژه)"
                      className="font-bold text-sky-700 border-sky-300"
                    />
                    {addProject && (
                      <button
                        type="button"
                        onClick={() => setQuickAddType('project')}
                        className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                        title="تعریف سریع پروژه جدید"
                      >
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                  {projectId && (
                    <div className="mt-2">
                      <CustomerAgreementAlert 
                        customer={customers?.find(c => c.id === projects?.find(p => p.id === projectId)?.customerId)} 
                        moduleName="purchase_orders" 
                      />
                    </div>
                  )}
                </div>

                
                {/* Winner Supplier Inquiry Selection */}
                <div className="space-y-1.5 sm:col-span-2 mb-4 bg-amber-50 p-3 rounded-lg border border-amber-100">
                  <label className="text-xs font-semibold text-amber-800">تکمیل خودکار از طریق استعلام‌های برنده (اختیاری)</label>
                  <select value={selectedInquiryId}
                    className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm text-right bg-white focus:border-amber-400 outline-none mt-1.5"
                    onChange={(e) => {
                      const inqId = e.target.value;
                      setSelectedInquiryId(inqId);
                      if (!inqId) return;
                      const inq = supplierInquiries.find(i => i.id === inqId);
                      if (inq) {
                        setSupplierId(inq.supplierId);
                        if (inq.projectId) setProjectId(inq.projectId);
                        
                        setCurrency(inq.items[0]?.currency || 'دلار');
                        
                        const poItems = inq.items.map((inqItem, idx) => ({
                          id: `poi-${Date.now()}-${idx}`,
                          productId: 'generic',
                          productName: inqItem.name,
                          productCode: '',
                          quantity: inqItem.quantity,
                          unitPriceForeignCurrency: inqItem.priceForeign,
                          customsDutyRate: 0,
                          shippingCostForeignRate: 0,
                          supplierNotes: inqItem.notes || (inqItem.deliveryTime ? `زمان تحویل: ${inqItem.deliveryTime}` : '')
                        }));
                        setItems(poItems);
                      }
                    }}
                  >
                    <option value="">-- انتخاب از استعلام‌های برنده --</option>
                    {supplierInquiries.filter(i => i.isWinner).map(inq => (
                      <option key={inq.id} value={inq.id}>
                        {inq.supplierName} - اقلام: {inq.items.length} عدد (پروژه: {projects.find(p => p.id === inq.projectId)?.name || 'بدون پروژه'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Supplier select */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'purchaseOrders', 'supplierId', 'انتخاب تأمین‌کننده خارجی')}</label>
                  <div className="flex gap-1.5 items-center">
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={supplierId}
                      onChange={(val) => setSupplierId(val)}
                      required={isFieldRequired(settings, 'purchaseOrders', 'supplierId')}
                      options={[
                        { value: '', label: '-- انتخاب سازنده --' },
                        ...suppliers.map(s => ({ value: s.id, label: `${s.name} (${s.country})` }))
                      ]}
                      placeholder="-- انتخاب سازنده --"
                    />
                    {addSupplier && (
                      <button
                        type="button"
                        onClick={() => setQuickAddType('supplier')}
                        className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                        title="تعریف سریع تأمین‌کننده جدید"
                      >
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Proforma Linked */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'purchaseOrders', 'proformaId', 'مرتبط با پیش‌فاکتور مشتری (پروفرما)')}</label>
                  <SearchableSelect wrapperClassName="flex-1 min-w-0"
                    value={proformaId}
                    onChange={(val) => {
                      const pfId = val;
                      setProformaId(pfId);
                      const pfObj = proformas.find(pf => pf.id === pfId);
                      if (pfObj) {
                        if (pfObj.projectId) {
                          setProjectId(pfObj.projectId);
                        }
                        if (pfObj.items && pfObj.items.length > 0) {
                          const poItems = pfObj.items.map((pfItem, idx) => {
                            const prod = products.find(p => p.id === pfItem.productId);
                            const basePriceForeign = prod ? Math.round(prod.basePriceRIYAL / exchangeRateInput) || 100 : 100;
                            return {
                              id: `poi-${Date.now()}-${idx}`,
                              productId: pfItem.productId,
                              productName: pfItem.productName,
                              productCode: pfItem.productCode,
                              brand: pfItem.brand,
                              quantity: pfItem.quantity,
                              unitPriceForeignCurrency: basePriceForeign,
                              totalPriceForeignCurrency: pfItem.quantity * basePriceForeign,
                              proformaItemId: pfItem.id,
                              proformaItemName: `${pfItem.productName} (تعداد: ${pfItem.quantity})`,
                              tagNumber: pfItem.tagNumber
                            };
                          });
                          setItems(poItems);
                        }
                      }
                    }}
                    required={isFieldRequired(settings, 'purchaseOrders', 'proformaId')}
                    options={[
                      { value: '', label: 'خرید متفرقه (بدون ارتباط با پیش‌فاکتور)' },
                      ...proformas.map(pf => ({ value: pf.id, label: `${pf.proformaNumber} - ${pf.customerName}` }))
                    ]}
                    placeholder="خرید متفرقه (بدون ارتباط با پیش‌فاکتور)"
                  />
                </div>

                {/* Currency select */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'purchaseOrders', 'currency', 'واحد پول سفارش ارزی')}</label>
                  <select
                    value={currency}
                    required={isFieldRequired(settings, 'purchaseOrders', 'currency')}
                    onChange={(e) => handleCurrencyChange(e.target.value as PurchaseOrder['currency'])}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    {(settings.dropdownItems?.currencies || ['دلار', 'یورو', 'درهم', 'ریال']).map((cur, idx) => (
                      <option key={idx} value={cur}>{cur}</option>
                    ))}
                  </select>
                </div>

                {/* Exchange rate lock */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'purchaseOrders', 'exchangeRateInput', 'نرخ حواله صرافی (ریال به ارز)')}</label>
                  <input
                    type="number"
                    required={isFieldRequired(settings, 'purchaseOrders', 'exchangeRateInput')}
                    value={exchangeRateInput}
                    onChange={(e) => setExchangeRateInput(Number(e.target.value))}
                    disabled={currency === 'ریال'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                  />
                </div>

                {/* Order Date */}
                <div className="space-y-1.5" id="po-order-date-picker-wrapper">
                  <ShamsiDatePicker
                    label="تاریخ ثبت سفارش"
                    required
                    value={orderDate}
                    onChange={(val) => {
                      setOrderDate(val);
                      setStatus(determineStatusFromDates(val, paymentDate, goodsReadyDate, shipmentDate, clearanceDate, receivedDate));
                    }}
                  />
                </div>

                {/* Delivery Date */}
                <div className="space-y-1.5" id="po-expected-delivery-date-picker-wrapper">
                  <ShamsiDatePicker
                    label="تاریخ دریافت احتمالی کالا"
                    required
                    value={expectedDeliveryDate}
                    onChange={(val) => setExpectedDeliveryDate(val)}
                  />
                </div>

                {/* Status Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 font-bold text-sky-700">وضعیت سفارش خرید</label>
                  <select
                    value={status}
                    onChange={(e) => {
                      const newSt = e.target.value as PurchaseOrder['status'];
                      setStatus(newSt);
                      const today = getTodayShamsi();
                      if (newSt === 'پیش‌نویس') {
                        setPaymentDate('');
                        setGoodsReadyDate('');
                        setShipmentDate('');
                        setClearanceDate('');
                        setReceivedDate('');
                      } else if (newSt === 'پرداخت و سفارش به سازنده') {
                        if (!orderDate) setOrderDate(today);
                        setPaymentDate('');
                        setGoodsReadyDate('');
                        setShipmentDate('');
                        setClearanceDate('');
                        setReceivedDate('');
                      } else if (newSt === 'در حال آماده‌سازی سازنده') {
                        if (!orderDate) setOrderDate(today);
                        if (!paymentDate) setPaymentDate(today);
                        setGoodsReadyDate('');
                        setShipmentDate('');
                        setClearanceDate('');
                        setReceivedDate('');
                      } else if (newSt === 'حمل و ترانزیت') {
                        if (!orderDate) setOrderDate(today);
                        if (!paymentDate) setPaymentDate(today);
                        if (!goodsReadyDate) setGoodsReadyDate(today);
                        setShipmentDate('');
                        setClearanceDate('');
                        setReceivedDate('');
                      } else if (newSt === 'ترخیص گمرک') {
                        if (!orderDate) setOrderDate(today);
                        if (!paymentDate) setPaymentDate(today);
                        if (!goodsReadyDate) setGoodsReadyDate(today);
                        if (!shipmentDate) setShipmentDate(today);
                        setClearanceDate('');
                        setReceivedDate('');
                      } else if (newSt === 'در حال حمل به انبار') {
                        if (!orderDate) setOrderDate(today);
                        if (!paymentDate) setPaymentDate(today);
                        if (!goodsReadyDate) setGoodsReadyDate(today);
                        if (!shipmentDate) setShipmentDate(today);
                        if (!clearanceDate) setClearanceDate(today);
                        setReceivedDate('');
                      } else if (newSt === 'تحویل شده (رسید انبار)') {
                        if (!orderDate) setOrderDate(today);
                        if (!paymentDate) setPaymentDate(today);
                        if (!goodsReadyDate) setGoodsReadyDate(today);
                        if (!shipmentDate) setShipmentDate(today);
                        if (!clearanceDate) setClearanceDate(today);
                        if (!receivedDate) setReceivedDate(today);
                      }
                    }}
                    className="w-full border border-sky-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-semibold text-sky-800"
                  >
                    <option value="پیش‌نویس">پیش‌نویس (Draft)</option>
                    <option value="پرداخت و سفارش به سازنده">پرداخت و سفارش به سازنده (Payment & Order)</option>
                    <option value="در حال آماده‌سازی سازنده">در حال آماده‌سازی سازنده (Manufacturing)</option>
                    <option value="حمل و ترانزیت">حمل و ترانزیت (Shipping & Transit)</option>
                    <option value="ترخیص گمرک">ترخیص گمرک (Customs Clearance)</option>
                    <option value="در حال حمل به انبار">در حال حمل به انبار (In Transit to Warehouse)</option>
                    <option value="تحویل شده (رسید انبار)">تحویل شده نهایی (رسید انبار) ★</option>
                  </select>
                </div>

              </div>

              {/* Multi-Row items */}
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <div className="flex flex-col">
                    <h4 className="font-bold text-xs text-slate-700 font-sans">کالاهای تحت سفارش (محصولات کاتالوگ)</h4>
                    {proformaId && (
                      <span className="text-[10px] text-sky-600 font-medium">پروفرما انتخاب شده است. لطفاً ردیف تناظر هر کالا با پیش‌فاکتور را مشخص نمایید.</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleAddItemLine}
                    className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <PlusCircle size={14} />
                    افزودن ردیف کالا
                  </button>
                </div>

                {/* Row layout */}
                <div className="space-y-2.5 max-h-56 overflow-y-auto pl-1">
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-150 items-start">
                      
                      {/* Product select & Proforma Item select */}
                      <div className="col-span-6 space-y-1.5">
                        <div className="flex gap-1 items-center">
                          <div className="flex-1 flex flex-col gap-2 min-w-0">
                            <SearchableSelect wrapperClassName="w-full min-w-0"
                              value={item.productId}
                              onChange={(val) => handleItemProductChange(idx, val)}
                              options={[
                                { value: '', label: '-- انتخاب کالا --' },
                                ...products.map(p => {
                                  let stockText = "";
                                  const hasVariants = p.hasVariants || (p.variants && p.variants.length > 0);
                                  if (hasVariants && p.variants && p.variants.length > 0) {
                                      const totalStock = p.variants.reduce((acc, v) => acc + (Number(v.stockLevel) || 0), 0);
                                      const hasOrderVariant = p.variants.some(v => !v.stockLevel || Number(v.stockLevel) === 0);
                                      const hasInventoryVariant = p.variants.some(v => v.stockLevel && Number(v.stockLevel) > 0);
                                      
                                      if (hasInventoryVariant && hasOrderVariant) {
                                          stockText = ` [موجودی: ${totalStock} + تامین سفارشی]`;
                                      } else if (hasInventoryVariant) {
                                          stockText = ` [موجودی: ${totalStock}]`;
                                      } else {
                                          stockText = ` [تامین سفارشی]`;
                                      }
                                  } else {
                                      const effectiveST = (Number(p.stockLevel) || 0) === 0 ? "ORDER" : (p.supplyType || "INVENTORY");
                                      stockText = effectiveST === "INVENTORY" ? ` [موجودی: ${Number(p.stockLevel) || 0}]` : ' [تامین سفارشی]';
                                  }
                                  return {
                                    value: p.id,
                                    label: `${p.code} - ${p.displayName}${stockText}`
                                  };
                                })
                              ]}
                              placeholder="-- انتخاب کالا --"
                              className="text-xs"
                            />
                            {item.productId && products.find(p => p.id === item.productId)?.hasVariants && (
                              <select
                                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[11px] bg-slate-50 focus:bg-white text-right outline-none"
                                value={item.variantId || ""}
                                onChange={(e) => handleItemVariantChange(idx, e.target.value)}
                              >
                                <option value="">-- انتخاب ترکیب مشخصات (SKU) --</option>
                                {products.find(p => p.id === item.productId)?.variants?.map(v => (
                                  <option key={v.id} value={v.id}>
                                    {v.sku} - {Object.values(v.attributes).join(', ')}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          {addProduct && (
                            <button
                              type="button"
                              onClick={() => {
                                setQuickAddProductIndex(idx);
                                setQuickAddType('product');
                              }}
                              className="px-2 py-1.5 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                              title="تعریف سریع کالای جدید"
                            >
                              <Plus size={14} />
                            </button>
                          )}
                        </div>

                        {proformaId && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-slate-500 whitespace-nowrap">ردیف پیش‌فاکتور:</span>
                            <select
                              value={item.proformaItemId || ''}
                              onChange={(e) => {
                                const pfItemId = e.target.value;
                                const pfObj = proformas.find(pf => pf.id === proformaId);
                                const matchedItem = pfObj?.items.find(it => it.id === pfItemId);
                                
                                const newItems = [...items];
                                newItems[idx] = {
                                  ...newItems[idx],
                                  proformaItemId: pfItemId || undefined,
                                  proformaItemName: matchedItem ? `${matchedItem.productName} (تعداد: ${matchedItem.quantity})` : undefined
                                };
                                setItems(newItems);
                              }}
                              className="w-full border border-slate-200 rounded-md px-2 py-1 text-[9px] bg-sky-50 text-sky-800 text-right"
                            >
                              <option value="">-- انتخاب ردیف پیش‌فاکتور --</option>
                              {proformas.find(pf => pf.id === proformaId)?.items.map(it => (
                                <option key={it.id} value={it.id}>
                                  {it.productName} (کد: {it.productCode} - تعداد: {it.quantity})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[9px] text-slate-500 whitespace-nowrap">تگ نامبر:</span>
                          <input
                            type="text"
                            value={item.tagNumber || ''}
                            onChange={(e) => {
                              const newItems = [...items];
                              newItems[idx] = { ...newItems[idx], tagNumber: e.target.value };
                              setItems(newItems);
                            }}
                            placeholder="مثال: PIT-101"
                            className="w-full border border-slate-200 rounded-md px-2 py-0.5 text-[9px] bg-white text-right font-mono"
                          />
                        </div>
                      </div>

                      {/* Quantity */}
                      <div className="col-span-2">
                        <input
                          type="number"
                          min={1}
                          required
                          value={item.quantity}
                          onChange={(e) => handleItemFieldChange(idx, 'quantity', Number(e.target.value))}
                          placeholder="تعداد"
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center bg-white"
                        />
                      </div>

                      {/* Foreign Price */}
                      <div className="col-span-3">
                        <input
                          type="number"
                          required
                          value={item.unitPriceForeignCurrency}
                          onChange={(e) => handleItemFieldChange(idx, 'unitPriceForeignCurrency', Number(e.target.value))}
                          placeholder={`بهای ارزی (${currency})`}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-left bg-white"
                        />
                      </div>

                      {/* Remove */}
                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItemLine(idx)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded transition"
                          disabled={items.length === 1}
                        >
                          <MinusCircle size={16} />
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              </div>

              {/* Landed costs additional inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-slate-100 pt-5">
                
                {/* Landed costs allocations */}
                <div className="space-y-3">
                  <h4 className="font-bold text-xs text-slate-700">تسهیم هزینه‌های سفارش (محاسبه بهای تمام‌شده)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    
                    {/* Remittance cost */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500">کارمزد حواله صرافی ({currency})</label>
                      <input
                        type="number"
                        value={remittanceFeeForeign || ''}
                        onChange={(e) => setRemittanceFeeForeign(Number(e.target.value))}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-left bg-white"
                      />
                    </div>

                    {/* Shipping */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500">هزینه ترابری/حمل ({currency})</label>
                      <input
                        type="number"
                        value={shippingCostForeign || ''}
                        onChange={(e) => setShippingCostForeign(Number(e.target.value))}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-left bg-white"
                      />
                    </div>

                    {/* Customs */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500">هزینه ترخیص گمرک (ریال)</label>
                      <input
                        type="number"
                        value={customsDutyRIYAL || ''}
                        onChange={(e) => setCustomsDutyRIYAL(Number(e.target.value))}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-left bg-white"
                      />
                    </div>

                  </div>
                </div>

                {/* Overall sum */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>ارزش فاکتور (ارزی):</span>
                    <span className="font-mono font-bold text-slate-800">{subTotalForeign.toLocaleString()} {currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>کارمزد حواله صرافی:</span>
                    <span className="font-mono text-blue-600">+{remittanceFeeForeign.toLocaleString()} {currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>هزینه ترابری و حمل:</span>
                    <span className="font-mono text-sky-600">+{shippingCostForeign.toLocaleString()} {currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                    <span>هزینه ترخیص گمرک:</span>
                    <span className="font-mono text-purple-600">+{customsDutyRIYAL.toLocaleString()} ریال</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400 text-[10px]">
                    <span>نرخ تسعیر ارز:</span>
                    <span className="font-mono">{exchangeRateInput.toLocaleString()} ریال</span>
                  </div>
                  <div className="border-t border-dashed border-slate-300 pt-2 flex justify-between items-center text-sm font-bold text-sky-800">
                    <span>بهای تمام‌شده ارزی (Landed):</span>
                    <span className="font-mono">{calculatedLandedCostForeign.toLocaleString()} {currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-extrabold text-emerald-800">
                    <span>بهای تمام‌شده ریالی (تسعیر):</span>
                    <span className="font-mono">{calculatedLandedCost.toLocaleString()} ریال</span>
                  </div>
                </div>

              </div>

              {/* Import Process Dates / Timings */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <h4 className="font-bold text-xs text-slate-700">روند چرخه زمانی فرآیند واردات (تاریخ خورشیدی رویدادها)</h4>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  
                  <ShamsiDatePicker
                    label="تاریخ پرداخت و جاری شدن"
                    value={paymentDate}
                    onChange={(val) => {
                      setPaymentDate(val);
                      setStatus(determineStatusFromDates(orderDate, val, goodsReadyDate, shipmentDate, clearanceDate, receivedDate));
                    }}
                  />

                  <ShamsiDatePicker
                    label="تاریخ آماده‌سازی کالا"
                    value={goodsReadyDate}
                    onChange={(val) => {
                      setGoodsReadyDate(val);
                      setStatus(determineStatusFromDates(orderDate, paymentDate, val, shipmentDate, clearanceDate, receivedDate));
                    }}
                  />

                  <ShamsiDatePicker
                    label="تاریخ حمل بین‌المللی"
                    value={shipmentDate}
                    onChange={(val) => {
                      setShipmentDate(val);
                      setStatus(determineStatusFromDates(orderDate, paymentDate, goodsReadyDate, val, clearanceDate, receivedDate));
                    }}
                  />

                  <ShamsiDatePicker
                    label="تاریخ ترخیص گمرکی"
                    value={clearanceDate}
                    onChange={(val) => {
                      setClearanceDate(val);
                      setStatus(determineStatusFromDates(orderDate, paymentDate, goodsReadyDate, shipmentDate, val, receivedDate));
                    }}
                  />

                  <ShamsiDatePicker
                    label="تاریخ تحویل نهایی / دریافت کالا"
                    value={receivedDate}
                    onChange={(val) => {
                      setReceivedDate(val);
                      setStatus(determineStatusFromDates(orderDate, paymentDate, goodsReadyDate, shipmentDate, clearanceDate, val));
                    }}
                  />

                </div>
              </div>

              {/* Notes */}
              <div className="border-t border-slate-100 pt-5 space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">یادداشت‌ها و توضیحات سند واردات</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="توضیحات مربوط به باربری، شماره کوتاژ گمرکی، شرکت ترخیص‌کار و غیره..."
                  rows={3}
                  className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                />
              </div>

              {/* Dynamic Custom Fields Form Section */}
              <div className="border-t border-slate-100 pt-5">
                <CustomFieldsForm
                  module="purchaseOrders"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />
              </div>

              {/* Form Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15"
                >
                  ذخیره و ایجاد سند واردات
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
          setPoToDeleteId(null);
          setPoToDeleteNumber('');
        }}
        onConfirm={() => {
          if (poToDeleteId) {
            deletePurchaseOrder(poToDeleteId);
          }
        }}
        title="حذف سفارش خرید خارجی"
        message={`آیا از حذف سفارش خرید شماره "${poToDeleteNumber}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      />

      {/* Quick Supplier Add Modal */}
      {showQuickSupplierModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden border border-slate-100 flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-slate-150">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Plus size={18} className="text-sky-500" />
                تعریف سریع تأمین‌کننده جدید
              </h3>
              <button 
                type="button" 
                onClick={() => setShowQuickSupplierModal(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-right">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">نام شرکت / برند تامین‌کننده *</label>
                <input
                  type="text"
                  value={quickSupName}
                  onChange={(e) => setQuickSupName(e.target.value)}
                  placeholder="مثال: Siemens AG"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">کشور مبدا *</label>
                  <input
                    type="text"
                    value={quickSupCountry}
                    onChange={(e) => setQuickSupCountry(e.target.value)}
                    placeholder="مثال: آلمان"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">شخص رابط / تماس</label>
                  <input
                    type="text"
                    value={quickSupContactPerson}
                    onChange={(e) => setQuickSupContactPerson(e.target.value)}
                    placeholder="مثال: Mr. Mueller"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">شماره تلفن</label>
                  <input
                    type="text"
                    value={quickSupPhone}
                    onChange={(e) => setQuickSupPhone(e.target.value)}
                    placeholder="+49-89-XXXX"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">آدرس ایمیل</label>
                  <input
                    type="text"
                    value={quickSupEmail}
                    onChange={(e) => setQuickSupEmail(e.target.value)}
                    placeholder="mueller@siemens.com"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 border-t border-slate-150 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuickSupplierModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs hover:bg-slate-100 transition font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!quickSupName.trim()) {
                    alert('لطفاً نام تامین‌کننده را وارد کنید.');
                    return;
                  }
                  if (!quickSupCountry.trim()) {
                    alert('لطفاً کشور را وارد کنید.');
                    return;
                  }

                  const supData: any = {
                    name: quickSupName,
                    country: quickSupCountry,
                    category: 'تجهیزات ابزار دقیق',
                    contactPerson: quickSupContactPerson,
                    phone: quickSupPhone,
                    email: quickSupEmail,
                    website: '',
                    status: 'فعال',
                    score: 100,
                    notes: 'ثبت سریع از سفارش خرید خارجی'
                  };

                  if (addSupplier) {
                    const created = addSupplier(supData);
                    if (created && created.id) {
                      setSupplierId(created.id);
                      setShowQuickSupplierModal(false);
                    }
                  }
                }}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition"
              >
                ثبت و انتخاب سازنده
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Project Add Modal */}
      {showQuickProjectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden border border-slate-100 flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-slate-150">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Plus size={18} className="text-sky-500" />
                تعریف سریع پروژه جدید
              </h3>
              <button 
                type="button" 
                onClick={() => setShowQuickProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-right">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">نام پروژه *</label>
                <input
                  type="text"
                  value={quickProjName}
                  onChange={(e) => setQuickProjName(e.target.value)}
                  placeholder="مثال: اتوماسیون پست برق پتروشیمی لورم"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">نام مشتری / کارفرما *</label>
                <select
                  value={quickProjCustomerId}
                  onChange={(e) => setQuickProjCustomerId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">-- انتخاب مشتری --</option>
                  {settings.dropdownItems?.industries ? (
                    // This is just to have something, let's use standard customers list if we want
                    // Wait, do we have customers list in this file?
                    // Let's check PurchaseOrdersViewProps: No customers list is passed!
                    // Let's check: Can we define it without choosing customer?
                    // If we don't have customers array in PurchaseOrdersView, we can pass a fallback
                    // or just write a placeholder customer or create a generic one. Let's see:
                    // What if we let them enter the Customer Name as text, and we can find or make a dummy?
                    // Yes! We can let them enter "نام مشتری" as text, and when addProject runs, it creates
                    // a project with customerName = entered text, customerId = 'temp'.
                    // Or let's pass a text field: "نام کارفرما (مثال: پتروشیمی کارون)" which is extremely easy!
                    null
                  ) : null}
                </select>
                {/* Instead of select dropdown, let's just make it a text input for simpler quick-creation inside PO! */}
                <input
                  type="text"
                  placeholder="نام کارفرما / کاربری نهایی (مثال: پتروشیمی شیراز)"
                  value={quickProjCustomerId}
                  onChange={(e) => setQuickProjCustomerId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">مرحله فرصت</label>
                  <select
                    value={quickProjStage}
                    onChange={(e) => setQuickProjStage(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    {(settings.dropdownItems?.projectStatuses || ['جدید', 'در حال مذاکره', 'ارائه پیش‌فاکتور', 'برنده (موفق)', 'نیمه برنده', 'باخته', 'لغو شده']).map((stg, idx) => (
                      <option key={idx} value={stg}>{stg}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">مسئول فروش</label>
                  <select
                    value={quickProjSalesExpert}
                    onChange={(e) => setQuickProjSalesExpert(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    {(settings.dropdownItems?.salesExperts || ['محمد توکل مقدم', 'آنتونی فیرو', 'مهندس حسینی']).map((exp, idx) => (
                      <option key={idx} value={exp}>{exp}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 border-t border-slate-150 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuickProjectModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs hover:bg-slate-100 transition font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!quickProjName.trim()) {
                    alert('لطفاً نام پروژه را وارد کنید.');
                    return;
                  }

                  const customerName = quickProjCustomerId.trim() || 'خرید عمومی';

                  const projData: any = {
                    name: quickProjName,
                    customerId: 'temp', // temporary/fallback
                    customerName,
                    status: 'جدید',
                    stage: quickProjStage,
                    projectManager: quickProjSalesExpert,
                    endUser: '',
                    salesExpert: quickProjSalesExpert,
                    marketingChannel: '',
                    totalValue: 0,
                    lossReason: '',
                    notes: 'تعریف سریع از سفارش خرید خارجی',
                    expectedCloseDate: '',
                    itemsNeeded: [],
                    customValues: {}
                  };

                  if (addProject) {
                    const created = addProject(projData);
                    if (created && created.id) {
                      setProjectId(created.id);
                      setShowQuickProjectModal(false);
                    }
                  }
                }}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition"
              >
                ثبت و انتخاب پروژه
              </button>
            </div>
          </div>
        </div>
      )}

      {quickAddType && (
        <QuickAddModal
          isOpen={!!quickAddType}
          onClose={() => setQuickAddType(null)}
          type={quickAddType}
          settings={settings}
          addSupplier={addSupplier}
          addProject={addProject}
          addProduct={addProduct}
          customers={customers}
          addCustomer={addCustomer}
          products={products}
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              if (quickAddType === 'supplier') {
                setSupplierId(newEntity.id);
              } else if (quickAddType === 'project') {
                setProjectId(newEntity.id);
              } else if (quickAddType === 'product' && quickAddProductIndex !== null) {
                handleItemProductChange(quickAddProductIndex, newEntity.id);
                setQuickAddProductIndex(null);
              }
            }
          }}
        />
      )}

    </div>
  );
}
