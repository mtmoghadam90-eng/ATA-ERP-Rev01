import { useExchangeRates } from '../api/exchangeRates';
import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Package,
  Edit,
  Copy,
  Trash2,
  X,
  Calculator,
  Image as ImageIcon,
  Download,
  Maximize2,
  Minimize2,
  ArrowUp,
  ArrowDown,
  ScanSearch,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { Product, ProductVariant, ERPSettings, ProductFeature, ProductConfigRule, User } from '../types';
import { canSeeCosts } from '../utils/permissions';
import { toShamsiStr, toGregorianStr } from '../dateUtils';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import ConfirmModal from './ConfirmModal';
import PriceCalculatorModal from './PriceCalculatorModal';
import { generateSku, isOptionExcludedByRules, decodeSku, DecodedSkuResult } from '../utils/skuUtils';
import { getCodeError } from '../utils/documentCodes';
import { uploadFile, downloadFileFromServer } from '../imageUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { ApiError } from '../api/client';
import { productsApi, type InventoryMovementEdit, type InventoryMovementRow } from '../api/products';
import StockMovementEditModal from './StockMovementEditModal';
import { calcSeedOf, detailToProduct, productToWriteInput, rowToProduct } from '../api/productAdapter';
import { useProductList } from '../api/useProductList';
import { useList } from '../api/useList';
import { formatMoney } from '../numUtils';

/**
 * Product catalogue and stock ledger.
 *
 * Reads through the API. The ledger is its own paginated query behind its own
 * tab — it is append-only and grows without bound, so it is never loaded
 * alongside the catalogue.
 */
interface ProductsViewProps {
  categories: string[];
  units: string[];
  settings: ERPSettings;
  /** Read for one thing: whether this user may see what the goods cost. */
  currentUser?: User | null;
}

export default function ProductsView({
  categories,
  settings,
  currentUser,
}: ProductsViewProps) {
  /*
   * The price calculator works backwards from what a product cost — foreign
   * price, freight, customs, margin — to a sale price. Warehouse staff need
   * this screen and must not see that, so the button is not drawn for them.
   *
   * Hiding it is a courtesy, not the control: the server already returns the
   * stored calculator as null for these users and ignores it on save. See
   * `src/server/costs.ts`.
   */
  const showCosts = canSeeCosts(currentUser);
  // Rates are read here rather than handed down: they are a short shared list
  // that changes during the day, and a stale one misprices a document.
  const { rates: exchangeRates } = useExchangeRates();

  const list = useProductList();
  const search = list.search;
  const setSearch = list.setSearch;

  /** The page of products, in the shape this screen's markup expects. */
  const products = React.useMemo(() => list.rows.map(rowToProduct), [list.rows]);

  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'TRANSACTIONS'>('PRODUCTS');

  /**
   * The stock ledger, its own paginated query.
   *
   * Only fetched while its tab is open: it is a long, append-only table and the
   * catalogue tab has no use for it.
   */
  const ledger = useList<InventoryMovementRow>({
    path: '/api/inventory-transactions',
    pageSize: 50,
    sort: 'occurredAt',
    order: 'desc',
    enabled: activeTab === 'TRANSACTIONS',
  });

  const inventoryTransactions = ledger.rows;

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

  /**
   * Writes, keeping the shapes the form already builds.
   *
   * Variants are reconciled by identity on the server, not rebuilt, so a SKU
   * keeps its stock and the documents that reference it across a save.
   */
  const addProduct = async (product: Partial<Product>) => {
    try {
      await productsApi.create(productToWriteInput(product));
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت کالا با خطا مواجه شد.');
    }
  };

  const updateProduct = async (product: Product) => {
    try {
      await productsApi.update(product.id, productToWriteInput(product));
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت تغییرات کالا با خطا مواجه شد.');
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      await productsApi.remove(id);
      list.refresh();
    } catch (err) {
      // The server refuses while a proforma, order or project line points at it.
      reportError(err, 'حذف کالا با خطا مواجه شد.');
    }
  };

  /**
   * Adjusts stock by a signed amount.
   *
   * A delta rather than a new level, so two people adjusting at once add up
   * instead of overwriting each other — and the movement is recorded with it.
   */
  const adjustProductStock = async (
    id: string,
    amount: number,
    variantId?: string,
    _referenceId?: string,
    _referenceType?: string,
    notes?: string,
    transactionDate?: string,
  ) => {
    try {
      await productsApi.adjustStock(id, {
        delta: amount,
        variantId: variantId ?? null,
        notes: notes ?? null,
        occurredAt: transactionDate,
      });
      list.refresh();
      if (activeTab === 'TRANSACTIONS') ledger.refresh();
    } catch (err) {
      reportError(err, 'ثبت تغییر موجودی با خطا مواجه شد.');
    }
  };

  /*
   * Correcting the ledger.
   *
   * Offered to a system administrator only. The button is simply not drawn for
   * anyone else — but that is a courtesy, not the control: the server refuses
   * both calls for every other account, including one with full write access to
   * stock. Rewriting what the warehouse did is exactly what a history is meant
   * to prevent, so it sits behind the same gate as purging the audit log.
   */
  const isSystemAdmin = !!currentUser?.isSystemAdmin;
  const [editingMovement, setEditingMovement] = useState<InventoryMovementRow | null>(null);
  const [deletingMovement, setDeletingMovement] = useState<InventoryMovementRow | null>(null);

  const saveMovement = async (body: InventoryMovementEdit) => {
    if (!editingMovement) return;
    try {
      await productsApi.updateMovement(editingMovement.id, body);
      setEditingMovement(null);
      ledger.refresh();
      // The level moved by the difference, so the catalogue is stale too.
      list.refresh();
    } catch (err) {
      reportError(err, 'اصلاح ردیف تاریخچه انبار با خطا مواجه شد.');
    }
  };

  const removeMovement = async () => {
    if (!deletingMovement) return;
    try {
      await productsApi.removeMovement(deletingMovement.id);
      setDeletingMovement(null);
      ledger.refresh();
      list.refresh();
    } catch (err) {
      reportError(err, 'حذف ردیف تاریخچه انبار با خطا مواجه شد.');
    }
  };

  const selectedCategory = list.filters.category;
  const setSelectedCategory = (value: string) => list.setFilter('category', value);
  const [showModal, setShowModal] = useState(false);
  const [isProductModalFullscreen, setIsProductModalFullscreen] = useState(false);
  const [isStockModalFullscreen, setIsStockModalFullscreen] = useState(false);
  const [isBatchModalFullscreen, setIsBatchModalFullscreen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isLoadingEdit, setIsLoadingEdit] = useState(false);

  // Dynamic Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [productToDeleteId, setProductToDeleteId] = useState<string | null>(null);
  const [productToDeleteName, setProductToDeleteName] = useState<string>('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Form states (Only Category, Equipment Type, and Technical Specs are managed in UI)
  const [displayName, setDisplayName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [supplyType, setSupplyType] = useState<'INVENTORY' | 'ORDER'>('INVENTORY');
  const [initialStock, setInitialStock] = useState<string>('0');
  const [features, setFeatures] = useState<ProductFeature[]>([]);
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [configRules, setConfigRules] = useState<ProductConfigRule[]>([]);
  const [showAddRuleForm, setShowAddRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [newRuleConditions, setNewRuleConditions] = useState<{ featureName: string; values: string[] }[]>([]);
  const [newRuleActionFeature, setNewRuleActionFeature] = useState<string>('');
  const [newRuleActionValues, setNewRuleActionValues] = useState<string[]>([]);
  const [newRuleName, setNewRuleName] = useState<string>('');

  // SKU Filters & Bulk Pricing States
  const [variantSearchQuery, setVariantSearchQuery] = useState('');
  const [variantAttributeFilters, setVariantAttributeFilters] = useState<Record<string, string>>({});
  const [variantCurrentPage, setVariantCurrentPage] = useState(1);
  const VARIANT_PAGE_SIZE = 50;
  const [bulkPriceForeign, setBulkPriceForeign] = useState<string>('');
  const [bulkPriceRIYAL, setBulkPriceRIYAL] = useState<string>('');
  const [bulkApplyToFilteredOnly, setBulkApplyToFilteredOnly] = useState<boolean>(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState<string>('');
  const [bulkErrorMsg, setBulkErrorMsg] = useState<string>('');

  const handleAddFeature = () => {
    const newId = Date.now().toString();
    setFeatures(prev => [...prev, { id: newId, name: '', options: [] }]);
    setTimeout(() => {
      const el = document.getElementById(`feature-name-${newId}`);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Simple Product Price States
  const [simplePriceForeign, setSimplePriceForeign] = useState<string>('');
  const [simpleCurrencyForeign, setSimpleCurrencyForeign] = useState<string>('یورو');
  const [simplePriceRIYAL, setSimplePriceRIYAL] = useState<string>('');
  const [simpleCalcDetails, setSimpleCalcDetails] = useState<Partial<ProductVariant>>({});

  // Batch upload modal state
  const [batchModalOpen, setBatchModalOpen] = useState(false);

  // SKU decoder ("رمزگشایی") state
  const [decodeModalOpen, setDecodeModalOpen] = useState(false);
  const [decodeInput, setDecodeInput] = useState('');
  const decodeResult: DecodedSkuResult | null = decodeInput.trim()
    ? decodeSku(decodeInput, products)
    : null;
  const [batchFile, setBatchFile] = useState<File | null>(null);

  // Selling Price Calculator State (only for simple products now)
  const [showCalculator, setShowCalculator] = useState(false);
  const [calcCurrency, setCalcCurrency] = useState<string>('یورو');

  const handleApplyCalculatedPrice = (enteredPriceForeign: number, finalPriceRial: number, details: Partial<ProductVariant>, appliedCurrency: string) => {
    setSimplePriceForeign(String(enteredPriceForeign));
    setSimplePriceRIYAL(String(Math.round(finalPriceRial)));
    setSimpleCurrencyForeign(appliedCurrency);
    setSimpleCalcDetails(details);
    setShowCalculator(false);
  };

  const convertForeignToRialSimple = (priceForeign: number, currency: string) => {
    const mappedEng = currency === 'دلار' ? 'USD' : currency === 'یورو' ? 'EUR' : currency === 'درهم' ? 'AED' : currency === 'یوان' ? 'CNY' : null;
    const storeRate = mappedEng ? exchangeRates.find(r => r.currency === mappedEng)?.rateToRIYAL : null;
    const rate = storeRate || 700000;
    return Math.round(priceForeign * rate);
  };

  const getCombinedVariantFOBPrice = (attributes: Record<string, string>, targetCurrency: string) => {
    let sum = 0;
    for (const [fName, fVal] of Object.entries(attributes)) {
      const feat = features.find(f => f.name === fName);
      if (feat) {
        const opt = feat.options.find(o => o.value === fVal);
        if (opt && opt.price) {
          sum += opt.price;
        }
      }
    }
    return Math.round(sum * 100) / 100;
  };

  // Manual SKU builder state (per-feature single option selection)
  const [newSkuSelections, setNewSkuSelections] = useState<Record<string, string>>({});
  const [newSkuError, setNewSkuError] = useState<string>('');

  // Stock adjust modal state
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockAdjustProd, setStockAdjustProd] = useState<Product | null>(null);
  const [stockAdjustAmount, setStockAdjustAmount] = useState('');
  const [stockAdjustType, setStockAdjustType] = useState<'IN' | 'OUT'>('IN');
  const [stockAdjustNotes, setStockAdjustNotes] = useState('');
  const [stockAdjustVariantId, setStockAdjustVariantId] = useState('');

  // Trigger modal for adding
  const handleOpenAdd = () => {
    setEditingProduct(null);
    setDisplayName('');
    setCategory(categories[0] || 'ابزار دقیق - فشار');
    setBrand('');
    setDescription('');
    setImages([]);
    setSupplyType('INVENTORY');
    setInitialStock('0');
    setProductCode('');
    setCustomValues({});
    setFeatures([]);
    setHasVariants(false);
    setVariants([]);
    setConfigRules([]);
    setSimplePriceForeign('');
    setSimpleCurrencyForeign('یورو');
    setSimplePriceRIYAL('');
    setSimpleCalcDetails({});
    setNewSkuSelections({});
    setNewSkuError('');
    setShowModal(true);
  };

  // Trigger modal for editing.
  // The list supplies rowToProduct objects that omit images, variants, features,
  // and configRules. We must fetch the full detail first — otherwise opening the
  // editor clears those fields, and saving overwrites the real data with [].
  const handleOpenEdit = async (prod: Product) => {
    setIsLoadingEdit(true);
    let full: Product;
    try {
      full = detailToProduct(await productsApi.get(prod.id));
    } catch {
      // Fall back to whatever the list row has so the modal still opens.
      full = prod;
    } finally {
      setIsLoadingEdit(false);
    }
    setEditingProduct(full);
    setProductCode(full.code || '');
    setDisplayName(full.displayName);
    setCategory(full.category);
    setBrand(full.brand || '');
    setDescription(full.description);
    setImages(full.images || []);
    setSupplyType(full.supplyType === 'ORDER' ? 'ORDER' : 'INVENTORY');
    setCustomValues(full.customValues || {});
    setFeatures(full.features || []);
    setHasVariants(full.hasVariants || false);
    // Clone variants so form edits never mutate the objects held by the server
    // response — sharing references made before/after comparisons identical,
    // which silently stopped SKU stock changes from being logged.
    setVariants((full.variants || []).map(v => ({ ...v, attributes: { ...v.attributes } })));
    setConfigRules(full.configRules || []);
    setSimplePriceForeign(full.priceForeign !== undefined ? String(full.priceForeign) : '');
    setSimpleCurrencyForeign(full.currencyForeign || 'یورو');
    setSimplePriceRIYAL(full.basePriceRIYAL !== undefined ? String(full.basePriceRIYAL) : '');
    setSimpleCalcDetails({
      calcPriceForeign: full.calcPriceForeign,
      calcExchangeRate: full.calcExchangeRate,
      calcRemittanceFee: full.calcRemittanceFee,
      calcRemittancePct: full.calcRemittancePct,
      calcShippingCost: full.calcShippingCost,
      calcCustomsDutyRIYAL: full.calcCustomsDutyRIYAL,
      calcOtherCostsForeign: full.calcOtherCostsForeign,
      calcOtherCostsRIYAL: full.calcOtherCostsRIYAL,
      calcProfitPct: full.calcProfitPct,
      calcProfitRIYAL: full.calcProfitRIYAL,
      calcMarginType: full.calcMarginType
    });
    setNewSkuSelections({});
    setNewSkuError('');
    setShowModal(true);
  };

  // Trigger modal for duplicating an existing product as a new one.
  // Keeps every spec/feature/pricing detail but clears identity + stock so the
  // save path goes through addProduct (fresh code, fresh SKUs, zero stock).
  const handleOpenCopy = (prod: Product) => {
    setEditingProduct(null);
    // Suggest a unique code derived from the source so the user isn't blocked by
    // the duplicate-code check (product codes must be unique).
    const baseCode = (prod.code || '').trim();
    let suggestedCode = '';
    if (baseCode) {
      let n = 1;
      do {
        suggestedCode = `${baseCode}-C${n}`;
        n++;
      } while (products.some(p => p.code === suggestedCode));
    }
    setProductCode(suggestedCode);
    setDisplayName(`${prod.displayName || prod.name || ''} (کپی)`);
    setCategory(prod.category);
    setBrand(prod.brand || '');
    setDescription(prod.description);
    setImages(prod.images || []);
    setSupplyType(prod.supplyType === 'ORDER' ? 'ORDER' : 'INVENTORY');
    setInitialStock('0');
    setCustomValues(prod.customValues ? { ...prod.customValues } : {});
    setFeatures(prod.features ? JSON.parse(JSON.stringify(prod.features)) : []);
    setHasVariants(prod.hasVariants || false);
    // Clone variants with new ids and blank SKUs so addProduct regenerates them,
    // and reset stock (a copy starts empty in the warehouse).
    setVariants(
      (prod.variants || []).map((v, i) => ({
        ...v,
        id: `var-${Date.now()}-${i}`,
        sku: '',
        stockLevel: 0,
      }))
    );
    setConfigRules(
      (prod.configRules || []).map((r, i) => ({
        ...r,
        id: `rule-${Date.now()}-${i}`,
        conditions: r.conditions.map(c => ({ ...c, values: [...c.values] })),
        actions: r.actions.map(a => ({ ...a, values: [...a.values] })),
      }))
    );
    setSimplePriceForeign(prod.priceForeign !== undefined ? String(prod.priceForeign) : '');
    setSimpleCurrencyForeign(prod.currencyForeign || 'یورو');
    setSimplePriceRIYAL(prod.basePriceRIYAL !== undefined ? String(prod.basePriceRIYAL) : '');
    setSimpleCalcDetails({
      calcPriceForeign: prod.calcPriceForeign,
      calcExchangeRate: prod.calcExchangeRate,
      calcRemittanceFee: prod.calcRemittanceFee,
      calcRemittancePct: prod.calcRemittancePct,
      calcShippingCost: prod.calcShippingCost,
      calcCustomsDutyRIYAL: prod.calcCustomsDutyRIYAL,
      calcOtherCostsForeign: prod.calcOtherCostsForeign,
      calcOtherCostsRIYAL: prod.calcOtherCostsRIYAL,
      calcProfitPct: prod.calcProfitPct,
      calcProfitRIYAL: prod.calcProfitRIYAL,
      calcMarginType: prod.calcMarginType
    });
    setNewSkuSelections({});
    setNewSkuError('');
    setShowModal(true);
  };

  // Handle Save (Add / Edit)

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Inventory_Template");

    // Add headers
    worksheet.columns = [
      { header: "کد کالا", key: "code", width: 15 },
      { header: "نام تجهیز", key: "name", width: 25 },
      { header: "دسته بندی", key: "category", width: 20 },
      { header: "برند", key: "brand", width: 15 },
      { header: "نوع تامین", key: "supplyType", width: 15 },
      { header: "تعداد تغییر / موجودی اولیه", key: "amount", width: 25 },
      { header: "نوع تغییر", key: "type", width: 15 },
      { header: "تاریخ", key: "date", width: 15 },
      { header: "توضیحات", key: "notes", width: 30 },
      { header: "ویژگی‌های قابل تنظیم", key: "features", width: 55 },
      { header: "قیمت ارزی", key: "priceForeign", width: 15 },
      { header: "نوع ارز", key: "currencyForeign", width: 15 },
      { header: "قیمت فروش (ریال)", key: "priceRIYAL", width: 20 },
    ];

    // Document the (non-obvious) features format directly in the sheet.
    worksheet.getCell('I1').note =
      'قالب: نام ویژگی(کد ویژگی):مقدار(کد گزینه)،مقدار(کد گزینه)\n' +
      'جداکننده ویژگی‌ها: |   جداکننده گزینه‌ها: ،\n' +
      'مثال: سایز(sz):۱ اینچ(1I)،۲ اینچ(2I)|متریال بدنه(mat):استیل(ST)،برنج(BR)\n' +
      'کد گزینه اختیاری است؛ اگر وارد نشود شماره ترتیب گزینه در SKU به کار می‌رود.';

    // Add some sample rows
    worksheet.addRow({
      code: "EQ-12345", name: "پرشر ترانسمیتر", category: categories.length > 0 ? categories[0] : "ابزار دقیق - فشار", brand: "WIKA",
      supplyType: "INVENTORY", amount: 10, type: "IN", date: "1403/05/12", 
      notes: "خرید جدید",
      features: "سایز(sz):۱ اینچ(1I)،۲ اینچ(2I)|متریال بدنه(mat):استیل(ST)،برنج(BR)",
      priceForeign: 120, currencyForeign: "یورو", priceRIYAL: 145000000
    });
    worksheet.addRow({
      code: "EQ-67890", name: "", category: "", brand: "",
      supplyType: "", amount: 5, type: "OUT", date: "", 
      notes: "مصرف پروژه",
      priceForeign: "", currencyForeign: "", priceRIYAL: ""
    });

    // Add data validations for 200 rows
    let catList = '"بدون دسته بندی"';
    if (categories && categories.length > 0) {
      // exceljs requires comma separated string in double quotes for lists
      catList = '"' + categories.join(',') + '"';
    }
    
    for (let i = 2; i <= 200; i++) {
      // Category Dropdown (Column C)
      worksheet.getCell(`C${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [catList]
      };
      
      // Supply Type Dropdown (Column E)
      worksheet.getCell(`E${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"INVENTORY,ORDER"']
      };

      // Change Type Dropdown (Column G)
      worksheet.getCell(`G${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"IN,OUT"']
      };

      // Currency Dropdown (Column L)
      worksheet.getCell(`L${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"یورو,دلار,درهم,یوان"']
      };
    }

    // Save
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, "Batch_Inventory_Template.xlsx");
  };

  const handleProcessBatch = async () => {
    if (!batchFile) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheet];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
        
        // Helper to convert shamsi date to ISO
        const parseDate = (dateStr: string) => {
          if (!dateStr) return undefined;
          try {
            const str = String(dateStr).trim();
            if (/^(13|14)\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
               const gStr = toGregorianStr(str);
               if (gStr) {
                 const d = new Date(gStr);
                 if (!isNaN(d.getTime())) return d.toISOString();
               }
            }
            const d = new Date(str);
            if (!isNaN(d.getTime())) return d.toISOString();
            return undefined;
          } catch {
            return undefined;
          }
        };

        const itemsToImport = jsonData.map(row => {
          const code = row["کد کالا"] || "";
          const amt = Number(row["تعداد تغییر / موجودی اولیه"]) || Number(row["تعداد تغییر"]);
          const type = row["نوع تغییر"];
          const notes = row["توضیحات"] || "ویرایش گروهی";
          const dateVal = row["تاریخ"] ? parseDate(String(row["تاریخ"])) : undefined;
          
          const name = row["نام تجهیز"];
          const category = row["دسته بندی"];
          const brand = row["برند"] || "";
          const supplyType = (row["نوع تامین"] === 'ORDER' ? 'ORDER' : 'INVENTORY') as 'INVENTORY' | 'ORDER';
          const featuresRaw = row["ویژگی‌های قابل تنظیم"] || "";
          const priceForeign = row["قیمت ارزی"] !== undefined && row["قیمت ارزی"] !== "" ? Number(row["قیمت ارزی"]) : undefined;
          const currencyForeign = row["نوع ارز"] || undefined;
          const priceRIYAL = row["قیمت فروش (ریال)"] !== undefined && row["قیمت فروش (ریال)"] !== "" ? Number(row["قیمت فروش (ریال)"]) : undefined;

          return {
            code,
            name,
            category,
            brand,
            supplyType,
            notes,
            amt,
            type,
            dateVal,
            featuresRaw,
            priceForeign,
            currencyForeign,
            priceRIYAL
          };
        });

        // Process batch import via API
        let successCount = 0;
        let createCount = 0;

        for (const item of itemsToImport) {
          try {
            // Find existing product by code or variant SKU
            let existingProduct = list.rows.find(r => r.code === item.code);
            let variantId: string | undefined;

            if (!existingProduct && item.code) {
              // Check if code matches a variant SKU
              for (const row of list.rows) {
                const prod = rowToProduct(row);
                const variant = prod.variants?.find(v => v.sku === item.code);
                if (variant) {
                  existingProduct = row;
                  variantId = variant.id;
                  break;
                }
              }
            }

            if (existingProduct) {
              // UPDATE: Adjust stock if amt is provided
              if (item.amt && item.amt !== 0) {
                const delta = item.type === 'خروج' ? -Math.abs(item.amt) : Math.abs(item.amt);
                await productsApi.adjustStock(existingProduct.id, {
                  variantId: variantId || null,
                  delta: delta,
                  notes: item.notes || '',
                  occurredAt: item.dateVal || new Date().toISOString(),
                });
              }
              successCount++;
            } else if (item.name && item.category) {
              // CREATE: New product
              const newProduct = await productsApi.create({
                code: item.code || `PROD-${Date.now()}`,
                name: item.name,
                displayName: item.name,
                category: item.category,
                brand: item.brand || null,
                modelNumber: null,
                unit: null,
                supplyType: item.supplyType || 'INVENTORY',
                description: null,
                features: null,
                configRules: null,
                images: null,
                priceCalc: null,
                basePriceRial: item.priceRIYAL ? String(item.priceRIYAL) : null,
                priceForeign: item.priceForeign ? String(item.priceForeign) : null,
                currencyForeign: item.currencyForeign || null,
                minStockLevel: '0',
                customValues: null,
                variants: [],
              });

              // Adjust stock if initial amt is provided
              if (item.amt && item.amt > 0 && item.supplyType === 'INVENTORY') {
                await productsApi.adjustStock(newProduct.id, {
                  variantId: null,
                  delta: item.amt,
                  notes: item.notes || 'موجودی اولیه',
                  occurredAt: item.dateVal || new Date().toISOString(),
                });
              }

              createCount++;
              successCount++;
            }
          } catch (err) {
            console.error('Error processing item:', item, err);
          }
        }

        await list.refresh();
        alert(`عملیات موفقیت آمیز بود. ${successCount} کالا بروزرسانی شد و ${createCount} کالای جدید تعریف شد.`);
        setBatchModalOpen(false);
        setIsBatchModalFullscreen(false);
        setBatchFile(null);
      } catch (err) {
        alert('خطا در پردازش فایل اکسل');
      }
    };
    reader.readAsArrayBuffer(batchFile);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    // Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === 'products');
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }

    if (!productCode.trim()) {
      alert('لطفاً کد کالا را وارد کنید.');
      return;
    }
    
    // Check for duplicate code (digit- and case-insensitive, so "EQ-۱۲۳" and
    // "eq-123" are recognized as the same code)
    const productCodeError = getCodeError('product', productCode, products, 'code', editingProduct?.id);
    if (productCodeError) {
      alert(productCodeError);
      return;
    }

    if (editingProduct) {
      updateProduct({
        ...editingProduct,
        displayName,
        name: displayName, // Synchronize name with displayName
        category,
        brand,
        description,
        images,
        supplyType,
        code: productCode.trim(),
        customValues,
        features,
        hasVariants,
        variants,
        configRules,
        basePriceRIYAL: Number(simplePriceRIYAL) || 0,
        priceForeign: simplePriceForeign ? Number(simplePriceForeign) : undefined,
        currencyForeign: simpleCurrencyForeign,
        // One list of calculator fields, shared with what actually gets saved —
        // spelling them out here is how a new one comes to be collected by the
        // modal and then dropped on the way to the record.
        ...calcSeedOf(simpleCalcDetails),
      });
    } else {
      addProduct({
        displayName,
        name: displayName,
        category,
        brand,
        description,
        images,
        supplyType,
        code: productCode.trim(),
        modelNumber: "N/A",
        unit: "عدد",
        basePriceRIYAL: Number(simplePriceRIYAL) || 0,
        minStockLevel: 0,
        stockLevel: supplyType === 'INVENTORY' ? (hasVariants ? variants.reduce((sum, v) => sum + (v.stockLevel || 0), 0) : Number(initialStock) || 0) : 0,
        customValues,
        features,
        hasVariants,
        variants,
        configRules,
        priceForeign: simplePriceForeign ? Number(simplePriceForeign) : undefined,
        currencyForeign: simpleCurrencyForeign,
        // One list of calculator fields, shared with what actually gets saved —
        // spelling them out here is how a new one comes to be collected by the
        // modal and then dropped on the way to the record.
        ...calcSeedOf(simpleCalcDetails),
      });
    }
    setShowModal(false);
  };

  // Filters
  const filteredProducts = products.filter(p => {
    const matchesSearch = 
      p.displayName.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      (p.code || '').toLowerCase().includes(search.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* View Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">کاتالوگ تجهیزات ابزاردقیق</h1>
          <p className="text-slate-500 text-sm mt-1">تعریف مشخصات فنی، نوع تجهیزات و گروه‌بندی تخصصی کالاها</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto mt-4 md:mt-0">
          <button
            onClick={() => { setDecodeInput(''); setDecodeModalOpen(true); }}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-sm font-medium transition flex items-center justify-center gap-2"
            title="وارد کردن کد SKU و نمایش کالا با تمام ویژگی‌ها و گزینه‌ها"
          >
            <ScanSearch size={16} />
            رمزگشایی SKU
          </button>
          <button
            onClick={() => { setBatchFile(null); setBatchModalOpen(true); }}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-indigo-500/15 flex items-center justify-center gap-2"
          >
            <Package size={16} />
            ورود/خروج گروهی
          </button>
          <button 
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            تعریف تجهیز جدید
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          className={`px-6 py-3 font-semibold text-sm transition-colors ${activeTab === 'PRODUCTS' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500 hover:text-slate-700'}`}
          onClick={() => setActiveTab('PRODUCTS')}
        >
          فهرست کالاها
        </button>
        <button
          className={`px-6 py-3 font-semibold text-sm transition-colors ${activeTab === 'TRANSACTIONS' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500 hover:text-slate-700'}`}
          onClick={() => setActiveTab('TRANSACTIONS')}
        >
          تاریخچه تراکنش‌های انبار
        </button>
      </div>

      {activeTab === 'PRODUCTS' ? (
        <>
      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="جستجو در نوع تجهیز، دسته‌بندی یا مشخصات فنی..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
          />
        </div>

        <div className="relative w-full md:w-64 flex items-center gap-2">
          <Filter size={16} className="text-slate-400 flex-shrink-0" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
          >
            <option value="all">همه دسته‌بندی‌ها</option>
            {categories.map((cat, i) => (
              <option key={i} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Products Table Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                <th className="p-4 w-1/3">نوع تجهیز و نام کالا</th>
                <th className="p-4 w-1/4">دسته‌بندی</th>
                <th className="p-4 w-1/4">مشخصات فنی و توضیحات</th>
                <th className="p-4 w-24">انبار و تامین</th>
                <th className="p-4 text-center w-28">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {filteredProducts.map((p) => {
                return (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition">
                    {/* Display Name */}
                    <td className="p-4">
                      <div className="flex items-start gap-3">
                        {p.images && p.images.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(p.images[0])}
                            className="w-12 h-12 rounded-lg border border-slate-200 bg-slate-50 flex-shrink-0 overflow-hidden cursor-pointer hover:opacity-85 transition relative group"
                            title="مشاهده و دانلود تصویر"
                          >
                            <img
                              src={p.images[0]}
                              alt={p.displayName}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </button>
                        ) : (
                          <div className="w-12 h-12 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300 flex-shrink-0">
                            <Package size={18} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800 text-sm leading-snug">{p.displayName}</div>
                          {p.code && (
                            <div className="text-[11px] font-mono font-bold text-sky-600 mt-1 flex items-center gap-1">
                              <span>کد کالا:</span>
                              <span className="bg-sky-50/70 dark:bg-sky-950/40 border border-sky-100/80 dark:border-sky-900/40 px-1.5 py-0.5 rounded select-all font-mono tracking-wider text-xs">{p.code}</span>
                            </div>
                          )}
                          
                          <div className="flex flex-wrap gap-1.5 mt-1 text-[10px]">
                            {p.brand && (
                              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md font-medium">
                                برند: {p.brand}
                              </span>
                            )}
                            {p.images && p.images.length > 0 && (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md font-medium">
                                🖼️ {p.images.length} تصویر
                              </span>
                            )}
                          </div>

                          <div className="mt-1">
                            <CustomFieldsDetailView
                              module="products"
                              customFields={settings?.customFields || []}
                              customValues={p.customValues}
                            />
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="p-4 text-slate-600 font-medium">
                      {p.category}
                    </td>

                    {/* Technical Specifications / Description */}
                    <td className="p-4 max-w-md">
                      <p className="text-slate-500 leading-relaxed whitespace-pre-wrap line-clamp-3">
                        {p.description || 'ثبت نشده'}
                      </p>
                    </td>

                    {/* Stock & Supply Type */}
                    <td className="p-4">
                      <div className="flex flex-col gap-1.5">
                        
                        {(() => {
                          const totalStock = p.hasVariants && p.variants ? p.variants.reduce((acc, v) => acc + (v.stockLevel || 0), 0) : (p.stockLevel || 0);
                          const effectiveSupplyType = totalStock === 0 ? 'ORDER' : (p.supplyType || 'INVENTORY');
                          return (
                            <span className={`text-xs font-semibold px-2 py-1 rounded-md inline-block w-max ${
                              effectiveSupplyType === 'INVENTORY' ? 'bg-indigo-50 text-indigo-700' :
                              effectiveSupplyType === 'ORDER' ? 'bg-amber-50 text-amber-700' :
                              'bg-emerald-50 text-emerald-700'
                            }`}>
                              {effectiveSupplyType === 'ORDER' ? 'قابل سفارش' : 'موجود در انبار'}
                            </span>
                          );
                        })()}
                        {(() => {
                          const totalStock = p.hasVariants && p.variants ? p.variants.reduce((acc, v) => acc + (v.stockLevel || 0), 0) : (p.stockLevel || 0);
                          const effectiveSupplyType = totalStock === 0 ? 'ORDER' : (p.supplyType || 'INVENTORY');
                          return (effectiveSupplyType === 'INVENTORY') && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-slate-500 text-xs">موجودی:</span>
                            <span className={`text-sm font-bold ${(p.hasVariants && p.variants ? p.variants.reduce((acc, v) => acc + (v.stockLevel || 0), 0) : p.stockLevel || 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {p.hasVariants && p.variants ? p.variants.reduce((acc, v) => acc + (v.stockLevel || 0), 0) : p.stockLevel || 0}
                            </span>
                          </div>
                        )})()}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        {/* Adjust Stock */}
                        {(p.supplyType === 'INVENTORY' || !p.supplyType) && (
                          <button
                            onClick={() => {
                              setStockAdjustProd(p);
                              setStockAdjustAmount('');
                              setStockAdjustNotes('');
                              setStockAdjustType('IN');
                              setStockAdjustVariantId('');
                              setStockModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            title="ورود/خروج انبار"
                          >
                            <Package size={14} />
                          </button>
                        )}
                        {/* Edit */}
                        <button
                          onClick={() => handleOpenEdit(p)}
                          disabled={isLoadingEdit}
                          className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-slate-50 rounded-lg transition disabled:opacity-50 disabled:cursor-wait"
                          title="ویرایش تجهیز"
                        >
                          {isLoadingEdit ? <Loader2 size={14} className="animate-spin" /> : <Edit size={14} />}
                        </button>

                        {/* Copy / Duplicate */}
                        <button
                          onClick={() => handleOpenCopy(p)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="کپی و تعریف کالای مشابه"
                        >
                          <Copy size={14} />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => {
                            setProductToDeleteId(p.id);
                            setProductToDeleteName(p.displayName || p.name);
                            setDeleteConfirmOpen(true);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="حذف تجهیز"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Nothing to report before the first response — "none found"
                  while loading reads as an empty catalogue. */}
              {list.initialLoading && (
                <tr>
                  <td colSpan={4} className="text-center p-12 text-slate-400 bg-white">
                    <Loader2 className="mx-auto text-slate-300 mb-3 animate-spin" size={36} />
                    در حال دریافت اطلاعات…
                  </td>
                </tr>
              )}
              {list.error && !list.initialLoading && (
                <tr>
                  <td colSpan={4} className="text-center p-12 bg-white">
                    <p className="text-sm text-rose-600 font-medium">{list.error}</p>
                    <button onClick={() => list.refresh()} className="mt-3 text-xs text-sky-600 hover:underline font-bold">
                      تلاش دوباره
                    </button>
                  </td>
                </tr>
              )}
              {filteredProducts.length === 0 && !list.initialLoading && !list.error && (
                <tr>
                  <td colSpan={4} className="text-center p-12 text-slate-400 bg-white">
                    <Package className="mx-auto text-slate-300 mb-3" size={40} />
                    هیچ کالایی متناسب با فیلتر شما در سیستم ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {list.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex-wrap">
              <span className="text-[11px] text-slate-500 font-medium">
                نمایش {list.rows.length.toLocaleString('fa-IR')} از {list.total.toLocaleString('fa-IR')} کالا
                {' — '}صفحه {list.page.toLocaleString('fa-IR')} از {list.totalPages.toLocaleString('fa-IR')}
              </span>
              <div className="flex items-center gap-1.5">
                {[
                  { label: 'اول', to: 1, disabled: list.page === 1 },
                  { label: 'قبلی', to: list.page - 1, disabled: list.page === 1 },
                  { label: 'بعدی', to: list.page + 1, disabled: list.page >= list.totalPages },
                  { label: 'آخر', to: list.totalPages, disabled: list.page >= list.totalPages },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => list.setPage(btn.to)}
                    disabled={btn.disabled || list.loading}
                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </>
      ) : (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                <th className="p-4 w-1/4">تاریخ</th>
                <th className="p-4 w-1/4">کالا</th>
                <th className="p-4 w-1/6 text-center">نوع</th>
                <th className="p-4 w-1/6 text-center">تعداد</th>
                <th className="p-4 w-1/3">توضیحات و رفرنس</th>
                {/* Drawn only for a system administrator; see saveMovement. */}
                {isSystemAdmin && <th className="p-4 w-24 text-center">اصلاح</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {ledger.initialLoading && (
                 <tr>
                    <td colSpan={isSystemAdmin ? 6 : 5} className="text-center p-12 text-slate-400">
                      <Loader2 className="mx-auto text-slate-300 mb-3 animate-spin" size={36} />
                      در حال دریافت تاریخچه…
                    </td>
                 </tr>
              )}
              {inventoryTransactions.length === 0 && !ledger.initialLoading && (
                 <tr>
                    <td colSpan={isSystemAdmin ? 6 : 5} className="text-center p-12 text-slate-400">هیچ تراکنشی یافت نشد.</td>
                 </tr>
              )}
              {/* Already ordered by the query, and the product and SKU come
                  joined with each movement rather than looked up. */}
              {inventoryTransactions.map(tr => {
                return (
                  <tr key={tr.id} className="hover:bg-slate-50/50 transition">
                    <td className="p-4 font-mono">{tr.occurredAtJalali || toShamsiStr(tr.occurredAt)}</td>
                    <td className="p-4 font-bold">
                      {tr.product ? tr.product.displayName : 'کالای حذف شده'}
                      {tr.variant && (
                        <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                          SKU: {tr.variant.sku || '—'}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-center">
                       <span className={`px-2 py-1 rounded text-xs font-bold ${tr.type === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                         {tr.type === 'IN' ? 'ورود' : 'خروج'}
                       </span>
                    </td>
                    <td className="p-4 text-center font-bold font-mono text-sm">{tr.quantity}</td>
                    <td className="p-4 text-slate-500 text-[11px] leading-tight">
                       {tr.referenceType && <div className="font-bold text-slate-700 mb-0.5">منبع: {tr.referenceType}</div>}
                       {tr.notes}
                    </td>
                    {isSystemAdmin && (
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            title="اصلاح این ردیف"
                            onClick={() => setEditingMovement(tr)}
                            className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            title="حذف این ردیف"
                            onClick={() => setDeletingMovement(tr)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* The ledger is append-only and unbounded, so it always pages. */}
          {ledger.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex-wrap">
              <span className="text-[11px] text-slate-500 font-medium">
                نمایش {ledger.rows.length.toLocaleString('fa-IR')} از {ledger.total.toLocaleString('fa-IR')} تراکنش
                {' — '}صفحه {ledger.page.toLocaleString('fa-IR')} از {ledger.totalPages.toLocaleString('fa-IR')}
              </span>
              <div className="flex items-center gap-1.5">
                {[
                  { label: 'اول', to: 1, disabled: ledger.page === 1 },
                  { label: 'قبلی', to: ledger.page - 1, disabled: ledger.page === 1 },
                  { label: 'بعدی', to: ledger.page + 1, disabled: ledger.page >= ledger.totalPages },
                  { label: 'آخر', to: ledger.totalPages, disabled: ledger.page >= ledger.totalPages },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => ledger.setPage(btn.to)}
                    disabled={btn.disabled || ledger.loading}
                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isProductModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isProductModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-xl my-4 max-h-[calc(100vh-2rem)]'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                {editingProduct ? `ویرایش اطلاعات فنی: ${editingProduct.displayName}` : 'تعریف تجهیز ابزاردقیق جدید'}
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsProductModalFullscreen(!isProductModalFullscreen)}
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isProductModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isProductModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowModal(false); setIsProductModalFullscreen(false); }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="space-y-4">
                
                {/* Category */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'category', 'دسته‌بندی تخصصی ابزاردقیق')}</label>
                  <select
                    value={category}
                    required={isFieldRequired(settings, 'products', 'category')}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                  >
                    {categories.map((cat, i) => (
                      <option key={i} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {/* Product Code */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'productCode', 'کد کالا')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'products', 'productCode')}
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    placeholder="مثال: PRD-001"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none transition-all"
                  />
                  <p className="text-[10px] text-slate-500">کد کالا باید یکتا باشد.</p>
                </div>

                {/* Equipment Type / Display Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'displayName', 'نوع تجهیز و نام کالا')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'products', 'displayName')}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: ترانسمیتر اختلاف فشار (DP Transmitter)"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-medium"
                  />
                </div>

                {/* Brand */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'brand', 'برند (سازنده)')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'products', 'brand')}
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="مثال: WIKA, Rosemount, Siemens"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Supply Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'supplyType', 'نوع تامین')}</label>
                    <select
                      value={supplyType}
                      required={isFieldRequired(settings, 'products', 'supplyType')}
                      onChange={(e) => setSupplyType(e.target.value as any)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      <option value="INVENTORY">موجود در انبار</option>
                      <option value="ORDER">قابل سفارش</option>
                    </select>
                  </div>

                  {/* Currency Selection */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'currencyForeign', 'ارز مرجع کالا')}</label>
                    <select
                      value={simpleCurrencyForeign}
                      required={isFieldRequired(settings, 'products', 'currencyForeign')}
                      onChange={(e) => {
                        const curr = e.target.value;
                        setSimpleCurrencyForeign(curr);
                        // Also update simple RIYAL price if a simple price is set
                        if (simplePriceForeign !== "") {
                          const calculatedRial = convertForeignToRialSimple(Number(simplePriceForeign), curr);
                          setSimplePriceRIYAL(String(calculatedRial));
                        }
                        // Update variants currency if they exist
                        if (variants.length > 0) {
                          const updated = variants.map(v => ({
                            ...v,
                            currencyForeign: curr,
                            priceRIYAL: v.priceForeign !== undefined ? convertForeignToRialSimple(v.priceForeign, curr) : undefined
                          }));
                          setVariants(updated);
                        }
                      }}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-medium text-slate-800"
                    >
                      <option value="یورو">یورو</option>
                      <option value="دلار">دلار</option>
                      <option value="درهم">درهم</option>
                      <option value="یوان">یوان</option>
                    </select>
                  </div>
                  {/* Initial Stock (Only for New Products & Inventory) */}
                  {!editingProduct && supplyType === 'INVENTORY' && !hasVariants && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-3 mt-3 col-span-2">
                      <label className="text-xs font-semibold text-emerald-600">{renderFieldLabelWithAsterisk(settings, 'products', 'initialStock', 'موجودی اولیه در انبار')}</label>
                      <input
                        type="number"
                        min="0"
                        required={isFieldRequired(settings, 'products', 'initialStock')}
                        value={initialStock}
                        onChange={(e) => setInitialStock(e.target.value)}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none text-right font-medium bg-emerald-50/30"
                      />
                      <p className="text-[10px] text-slate-500">برای تغییر موجودی پس از تعریف کالا، از دکمه‌های ورود/خروج انبار استفاده کنید.</p>
                    </div>
                  )}


                </div>

                {!hasVariants && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <h4 className="text-sm font-bold text-slate-800">قیمت‌گذاری محصول</h4>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl items-end">
                      {/* Foreign Price and Currency */}
                      <div className="md:col-span-5 space-y-1.5 w-full">
                        <label className="text-xs font-semibold text-slate-500">قیمت ارزی</label>
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={simplePriceForeign}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSimplePriceForeign(val);
                              if (val !== "") {
                                const calculatedRial = convertForeignToRialSimple(Number(val), simpleCurrencyForeign);
                                setSimplePriceRIYAL(String(calculatedRial));
                              } else {
                                setSimplePriceRIYAL("");
                              }
                            }}
                            placeholder="0"
                            className="w-full border border-slate-200 rounded-lg pl-16 pr-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-center font-mono bg-white"
                          />
                          <div className="absolute inset-y-0 left-0 flex items-center justify-center bg-slate-100 border-r border-slate-200 text-xs font-bold text-slate-600 px-3 rounded-l-lg select-none min-w-[55px]">
                            {simpleCurrencyForeign}
                          </div>
                        </div>
                      </div>

                      {/* Calculator Button — cost-derived, so not for everyone */}
                      <div className={`md:col-span-2 w-full ${showCosts ? '' : 'hidden'}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setCalcCurrency(simpleCurrencyForeign || 'یورو');
                            setShowCalculator(true);
                          }}
                          className="w-full h-[38px] bg-sky-50 border border-sky-200 text-sky-600 rounded-lg hover:bg-sky-100 transition-colors flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap"
                          title="محاسبه‌گر حرفه‌ای قیمت فروش"
                        >
                          <Calculator size={15} />
                          محاسبه‌گر
                        </button>
                      </div>

                      {/* Selling Price (Rials) */}
                      <div className="md:col-span-5 space-y-1.5 w-full">
                        <label className="text-xs font-semibold text-slate-500">قیمت فروش (ریال)</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={simplePriceRIYAL ? formatMoney(simplePriceRIYAL) : ''}
                            onChange={(e) => {
                              const rawVal = e.target.value
                                .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
                                .replace(/[^\d]/g, '');
                              setSimplePriceRIYAL(rawVal);
                            }}
                            placeholder="۰"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-center font-mono font-bold text-slate-800 bg-white"
                          />
                          {simplePriceRIYAL && (
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">ریال</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Product Images */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">تصاویر محصول</label>
                  
                  {/* Drag and Drop Zone */}
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
                              setImages(prev => [...prev, url]);
                            } catch (err: any) {
                              alert(err.message || 'خطا در بارگذاری تصویر محصول');
                            }
                          }
                        }
                        if (e.target) e.target.value = '';
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                    />
                    <div className="text-slate-500 space-y-1">
                      <div className="text-xs font-bold text-slate-700">انتخاب یا رها کردن تصاویر کالا</div>
                      <div className="text-[10px] text-slate-400">فرمت‌های تصویری (JPG, PNG) - ذخیره‌سازی محلی</div>
                    </div>
                  </div>

                  {/* Thumbnail Previews */}
                  {images.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 pt-2">
                      {images.map((img, idx) => (
                        <div key={idx} className="relative group aspect-square rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(img)}
                            className="w-full h-full text-right outline-none cursor-pointer"
                            title="بزرگنمایی و دانلود تصویر"
                          >
                            <img
                              src={img}
                              alt={`Product image ${idx + 1}`}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
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

                {/* Description / Technical Specifications */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'products', 'description', 'مشخصات فنی و توضیحات')}</label>
                  <textarea
                    rows={4}
                    required={isFieldRequired(settings, 'products', 'description')}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="جزئیات متریال بدنه، اتصالات، کلاس کاری، رنج فشار یا دما، سیگنال خروجی و گواهینامه‌ها..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right leading-relaxed"
                  />
                </div>

                {/* Product Features Configuration */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">ویژگی‌های قابل تنظیم (کانفیگوراتور)</h4>
                      <p className="text-xs text-slate-500 mt-1">ویژگی‌هایی که در زمان پیش‌فاکتور قابل انتخاب هستند.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddFeature}
                      className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 transition flex items-center gap-1"
                    >
                      <Plus size={14} />
                      افزودن ویژگی
                    </button>
                  </div>
                  
                  {features.map((feature, fIndex) => (
                    <div key={feature.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50 space-y-3">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 flex flex-col sm:flex-row gap-2 w-full">
                          <input
                            type="text"
                            id={`feature-name-${feature.id}`}
                            value={feature.name}
                            onChange={(e) => {
                              const newF = [...features];
                              newF[fIndex] = { ...newF[fIndex], name: e.target.value };
                              setFeatures(newF);
                            }}
                            placeholder="نام ویژگی (مثل: سایز)"
                            className="w-full sm:flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                          />
                          <input
                            type="text"
                            value={feature.code || ''}
                            onChange={(e) => {
                              const newF = [...features];
                              newF[fIndex] = { ...newF[fIndex], code: e.target.value };
                              setFeatures(newF);
                            }}
                            placeholder="کد (مثل: s)"
                            className="w-full sm:w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-sky-500 sm:text-center"
                          />
                        </div>
                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                          <button
                            type="button"
                            disabled={fIndex === 0}
                            onClick={() => {
                              if (fIndex === 0) return;
                              const newF = [...features];
                              const temp = newF[fIndex];
                              newF[fIndex] = newF[fIndex - 1];
                              newF[fIndex - 1] = temp;
                              setFeatures(newF);
                            }}
                            className={`p-1.5 rounded-lg transition ${
                              fIndex === 0 
                                ? 'text-slate-300 cursor-not-allowed' 
                                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                            }`}
                            title="انتقال به بالا"
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={fIndex === features.length - 1}
                            onClick={() => {
                              if (fIndex === features.length - 1) return;
                              const newF = [...features];
                              const temp = newF[fIndex];
                              newF[fIndex] = newF[fIndex + 1];
                              newF[fIndex + 1] = temp;
                              setFeatures(newF);
                            }}
                            className={`p-1.5 rounded-lg transition ${
                              fIndex === features.length - 1 
                                ? 'text-slate-300 cursor-not-allowed' 
                                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                            }`}
                            title="انتقال به پایین"
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newF = [...features];
                              newF.splice(fIndex, 1);
                              setFeatures(newF);
                            }}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                            title="حذف ویژگی"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {feature.options.length > 0 && (
                          <div className="bg-white rounded-lg border border-slate-150 overflow-hidden divide-y divide-slate-100">
                            <div className="bg-slate-50 px-3 py-1.5 grid grid-cols-12 gap-2 text-[10px] font-bold text-slate-500 text-right">
                              <div className="col-span-4">مقدار ویژگی</div>
                              <div className="col-span-2 text-center">کد گزینه</div>
                              <div className="col-span-3 text-center">قیمت ارزی مبدا ({simpleCurrencyForeign})</div>
                              <div className="col-span-2 text-center">ترتیب</div>
                              <div className="col-span-1 text-center">حذف</div>
                            </div>
                            {feature.options.map((opt, oIndex) => (
                              <div key={opt.id} className="px-3 py-1.5 grid grid-cols-12 gap-2 items-center text-xs">
                                <div className="col-span-4 font-medium text-slate-700">
                                  {opt.value}
                                </div>
                                <div className="col-span-2 flex justify-center">
                                  <input
                                    type="text"
                                    value={opt.code || ''}
                                    onChange={(e) => {
                                      const newF = [...features];
                                      const updatedOptions = [...newF[fIndex].options];
                                      updatedOptions[oIndex] = { ...updatedOptions[oIndex], code: e.target.value };
                                      newF[fIndex] = { ...newF[fIndex], options: updatedOptions };
                                      setFeatures(newF);
                                    }}
                                    placeholder={String(oIndex + 1)}
                                    title="کد این گزینه در ساخت SKU استفاده می‌شود. اگر خالی بماند، شماره ترتیب به کار می‌رود."
                                    className="w-full max-w-[70px] text-center font-mono border border-slate-200 rounded px-1.5 py-0.5 text-xs outline-none focus:border-sky-500 bg-white uppercase"
                                    dir="ltr"
                                  />
                                </div>
                                <div className="col-span-3 flex justify-center items-center gap-1.5">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={opt.price === undefined ? "" : opt.price}
                                    onChange={(e) => {
                                      const val = e.target.value === "" ? 0 : Number(e.target.value);
                                      const newF = [...features];
                                      const updatedOptions = [...newF[fIndex].options];
                                      updatedOptions[oIndex] = { ...updatedOptions[oIndex], price: val, currency: simpleCurrencyForeign };
                                      newF[fIndex] = { ...newF[fIndex], options: updatedOptions };
                                      setFeatures(newF);
                                    }}
                                    placeholder="0"
                                    className="w-full max-w-[100px] text-center font-mono border border-slate-200 rounded px-2 py-0.5 text-xs outline-none focus:border-sky-500 bg-white"
                                  />
                                  <span className="text-[10px] text-slate-500 font-bold">{simpleCurrencyForeign}</span>
                                </div>
                                <div className="col-span-2 flex justify-center items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={oIndex === 0}
                                    onClick={() => {
                                      if (oIndex === 0) return;
                                      const newF = [...features];
                                      const updatedOptions = [...newF[fIndex].options];
                                      const temp = updatedOptions[oIndex];
                                      updatedOptions[oIndex] = updatedOptions[oIndex - 1];
                                      updatedOptions[oIndex - 1] = temp;
                                      newF[fIndex] = { ...newF[fIndex], options: updatedOptions };
                                      setFeatures(newF);
                                    }}
                                    className={`p-1 rounded transition ${
                                      oIndex === 0 
                                        ? 'text-slate-300 cursor-not-allowed' 
                                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                                    }`}
                                    title="انتقال به بالا"
                                  >
                                    <ArrowUp size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={oIndex === feature.options.length - 1}
                                    onClick={() => {
                                      if (oIndex === feature.options.length - 1) return;
                                      const newF = [...features];
                                      const updatedOptions = [...newF[fIndex].options];
                                      const temp = updatedOptions[oIndex];
                                      updatedOptions[oIndex] = updatedOptions[oIndex + 1];
                                      updatedOptions[oIndex + 1] = temp;
                                      newF[fIndex] = { ...newF[fIndex], options: updatedOptions };
                                      setFeatures(newF);
                                    }}
                                    className={`p-1 rounded transition ${
                                      oIndex === feature.options.length - 1 
                                        ? 'text-slate-300 cursor-not-allowed' 
                                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                                    }`}
                                    title="انتقال به پایین"
                                  >
                                    <ArrowDown size={12} />
                                  </button>
                                </div>
                                <div className="col-span-1 flex justify-center">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newF = [...features];
                                      newF[fIndex] = {
                                        ...newF[fIndex],
                                        options: newF[fIndex].options.filter((_, idx) => idx !== oIndex)
                                      };
                                      setFeatures(newF);
                                    }}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full">
                            <input
                              type="text"
                              id={`feature-input-${feature.id}`}
                              placeholder="مقدار جدید (برای چند مقدار با ویرگول جدا کنید)..."
                              className="w-full sm:flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-sky-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const inputEl = e.currentTarget;
                                  const val = inputEl.value.trim();
                                  if (val) {
                                    const vals = val.split(/[,،]/).map(v => v.trim()).filter(Boolean);
                                    if (vals.length > 0) {
                                      const newOptions = vals.map((v, i) => ({
                                        id: Date.now().toString() + i.toString() + Math.random().toString(),
                                        value: v,
                                        price: 0,
                                        currency: simpleCurrencyForeign
                                      }));
                                      const newF = [...features];
                                      newF[fIndex] = {
                                        ...newF[fIndex],
                                        options: [...newF[fIndex].options, ...newOptions]
                                      };
                                      setFeatures(newF);
                                    }
                                    inputEl.value = '';
                                  }
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const inputEl = document.getElementById(`feature-input-${feature.id}`) as HTMLInputElement;
                                if (inputEl) {
                                  const val = inputEl.value.trim();
                                  if (val) {
                                    const vals = val.split(/[,،]/).map(v => v.trim()).filter(Boolean);
                                    if (vals.length > 0) {
                                      const newOptions = vals.map((v, i) => ({
                                        id: Date.now().toString() + i.toString() + Math.random().toString(),
                                        value: v,
                                        price: 0,
                                        currency: simpleCurrencyForeign
                                      }));
                                      const newF = [...features];
                                      newF[fIndex] = {
                                        ...newF[fIndex],
                                        options: [...newF[fIndex].options, ...newOptions]
                                      };
                                      setFeatures(newF);
                                    }
                                    inputEl.value = '';
                                  }
                                }
                              }}
                              className="w-full sm:w-auto px-3 py-1.5 bg-sky-50 text-sky-600 font-semibold text-xs rounded-lg hover:bg-sky-100 transition whitespace-nowrap"
                            >
                              افزودن
                            </button>
                          </div>
                          <span className="text-[10px] text-slate-400">برای ثبت Enter بزنید یا روی دکمه افزودن کلیک کنید. برای ثبت چند مقدار همزمان از ویرگول (,) استفاده کنید.</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {features.length > 0 && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={handleAddFeature}
                        className="px-4 py-2 bg-sky-50 text-sky-600 border border-sky-200 text-xs font-bold rounded-xl hover:bg-sky-100 transition flex items-center gap-1.5 shadow-sm"
                      >
                        <Plus size={15} />
                        افزودن ویژگی جدید
                      </button>
                    </div>
                  )}
                </div>

                {/* Configurator Rules Engine */}
                {features.length > 0 && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                        قوانین فیلترینگ و شرط‌های انتخاب ویژگی‌ها
                      </label>
                      {!showAddRuleForm && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRuleId(null);
                            setNewRuleName('');
                            setNewRuleConditions([{ featureName: features[0]?.name || '', values: [] }]);
                            setNewRuleActionFeature(features[1]?.name || features[0]?.name || '');
                            setNewRuleActionValues([]);
                            setShowAddRuleForm(true);
                          }}
                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1 border border-indigo-150"
                        >
                          <Plus size={14} />
                          قانون جدید (یا / و)
                        </button>
                      )}
                    </div>

                    {/* Rule Builder Form */}
                    {showAddRuleForm && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 text-right">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-150">
                          <span className="text-xs font-bold text-slate-700">{editingRuleId ? 'ویرایش قانون محدودیت' : 'تعریف قانون محدودیت جدید'}</span>
                          <button
                            type="button"
                            onClick={() => { setShowAddRuleForm(false); setEditingRuleId(null); }}
                            className="text-slate-400 hover:text-slate-600"
                          >
                            <X size={16} />
                          </button>
                        </div>

                        {/* Rule Name */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500">عنوان قانون (اختیاری)</label>
                          <input
                            type="text"
                            placeholder="مثال: فیلتر لاینر رابر برای سایزهای بزرگ"
                            value={newRuleName}
                            onChange={(e) => setNewRuleName(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-500 bg-white"
                          />
                        </div>

                        {/* Conditions List */}
                        <div className="space-y-3">
                          <label className="text-xs font-semibold text-slate-600 block">شرط‌ها (اگر ویژگی‌های زیر انتخاب شده باشند - رابطه "و" بین شرط‌ها):</label>
                          
                          {newRuleConditions.map((cond, cIdx) => {
                            const selectedFeatureObj = features.find(f => f.name === cond.featureName);
                            return (
                              <div key={cIdx} className="bg-white border border-slate-200 rounded-lg p-3 space-y-3 relative">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-bold font-mono">شرط {cIdx + 1}</span>
                                    <select
                                      value={cond.featureName}
                                      onChange={(e) => {
                                        const next = [...newRuleConditions];
                                        next[cIdx] = { featureName: e.target.value, values: [] };
                                        setNewRuleConditions(next);
                                      }}
                                      className="border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 font-bold text-slate-700 bg-white"
                                    >
                                      {features.map((f, i) => (
                                        <option key={i} value={f.name}>{f.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  
                                  {newRuleConditions.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNewRuleConditions(prev => prev.filter((_, idx) => idx !== cIdx));
                                      }}
                                      className="text-red-500 hover:text-red-600 hover:bg-red-50 p-1 rounded transition text-xs font-bold"
                                    >
                                      حذف شرط
                                    </button>
                                  )}
                                </div>

                                {/* Option Checklist for Condition (OR relation within a single condition) */}
                                {selectedFeatureObj && (
                                  <div className="space-y-1.5 pt-1">
                                    <span className="text-[10px] text-slate-400 font-medium block">
                                      برابر با یکی از مقادیر زیر باشد (رابطه "یا" بین گزینه‌ها):
                                    </span>
                                    <div className="flex flex-wrap gap-2.5">
                                      {selectedFeatureObj.options.map((opt) => {
                                        const isChecked = cond.values.includes(opt.value);
                                        return (
                                          <label
                                            key={opt.id}
                                            className="flex items-center gap-1.5 bg-slate-50 border border-slate-150 px-2.5 py-1 rounded-md text-[11px] text-slate-600 cursor-pointer hover:bg-indigo-50/50 hover:text-indigo-700 hover:border-indigo-200 transition select-none"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={(e) => {
                                                const next = [...newRuleConditions];
                                                if (e.target.checked) {
                                                  next[cIdx].values = [...cond.values, opt.value];
                                                } else {
                                                  next[cIdx].values = cond.values.filter(v => v !== opt.value);
                                                }
                                                setNewRuleConditions(next);
                                              }}
                                              className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                            />
                                            <span>{opt.value}</span>
                                          </label>
                                        );
                                      })}
                                      {selectedFeatureObj.options.length === 0 && (
                                        <span className="text-[10px] text-amber-500">هیچ مقداری برای این ویژگی تعریف نشده است.</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          <button
                            type="button"
                            onClick={() => {
                              // Find first feature not already added as condition
                              const remaining = features.find(f => !newRuleConditions.some(c => c.featureName === f.name));
                              const featName = remaining ? remaining.name : (features[0]?.name || '');
                              setNewRuleConditions(prev => [...prev, { featureName: featName, values: [] }]);
                            }}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
                          >
                            <Plus size={12} />
                            افزودن شرط جدید (AND / و)
                          </button>
                        </div>

                        {/* Action / Consequence */}
                        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                          <label className="text-xs font-bold text-slate-700 block">
                            آنگاه (Action) در ویژگی هدف:
                          </label>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">ویژگی هدف:</span>
                            <select
                              value={newRuleActionFeature}
                              onChange={(e) => {
                                setNewRuleActionFeature(e.target.value);
                                setNewRuleActionValues([]);
                              }}
                              className="border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 font-bold text-slate-700 bg-white"
                            >
                              {features.map((f, i) => (
                                <option key={i} value={f.name}>{f.name}</option>
                              ))}
                            </select>
                          </div>

                          {/* Target options checklist */}
                          {(() => {
                            const actFeat = features.find(f => f.name === newRuleActionFeature);
                            if (!actFeat) return null;
                            return (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[10px] text-red-500 font-bold block">
                                  مقادیر زیر غیرقابل انتخاب و غیرمجاز شوند:
                                </span>
                                <div className="flex flex-wrap gap-2.5">
                                  {actFeat.options.map((opt) => {
                                    const isChecked = newRuleActionValues.includes(opt.value);
                                    return (
                                      <label
                                        key={opt.id}
                                        className="flex items-center gap-1.5 bg-slate-50 border border-slate-150 px-2.5 py-1 rounded-md text-[11px] text-slate-600 cursor-pointer hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition select-none"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setNewRuleActionValues(prev => [...prev, opt.value]);
                                            } else {
                                              setNewRuleActionValues(prev => prev.filter(v => v !== opt.value));
                                            }
                                          }}
                                          className="w-3.5 h-3.5 text-red-600 rounded border-slate-300 focus:ring-red-500 cursor-pointer"
                                        />
                                        <span>{opt.value}</span>
                                      </label>
                                    );
                                  })}
                                  {actFeat.options.length === 0 && (
                                    <span className="text-[10px] text-amber-500">هیچ مقداری برای این ویژگی تعریف نشده است.</span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Submit rule buttons */}
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => { setShowAddRuleForm(false); setEditingRuleId(null); }}
                            className="px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold transition"
                          >
                            انصراف
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              // Validation
                              const validConditions = newRuleConditions.filter(c => c.featureName && c.values.length > 0);
                              if (validConditions.length === 0) {
                                alert('لطفاً حداقل یک شرط معتبر با مقادیر مشخص انتخاب کنید.');
                                return;
                              }
                              if (!newRuleActionFeature || newRuleActionValues.length === 0) {
                                alert('لطفاً ویژگی هدف و مقادیر غیرمجاز مربوطه را انتخاب کنید.');
                                return;
                              }

                              const actions = [{ featureName: newRuleActionFeature, values: newRuleActionValues }];

                              if (editingRuleId) {
                                // Update the existing rule in place, preserving its id and active state
                                setConfigRules(prev => prev.map(r => r.id === editingRuleId
                                  ? { ...r, name: newRuleName.trim() || undefined, conditions: validConditions, actions }
                                  : r));
                              } else {
                                const rule: ProductConfigRule = {
                                  id: `rule-${Date.now()}`,
                                  name: newRuleName.trim() || undefined,
                                  active: true,
                                  conditions: validConditions,
                                  actions
                                };
                                setConfigRules(prev => [...prev, rule]);
                              }
                              setEditingRuleId(null);
                              setShowAddRuleForm(false);
                            }}
                            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                          >
                            {editingRuleId ? 'ذخیره تغییرات' : 'ثبت قانون'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Rules List */}
                    <div className="space-y-2">
                      {configRules.length === 0 ? (
                        <div className="text-center py-4 bg-slate-50 border border-slate-150 rounded-xl text-slate-400 text-xs font-medium">
                          هیچ قانون و شرط فیلترینگی برای این کالا تعریف نشده است.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {configRules.map((rule, rIdx) => {
                            return (
                              <div key={rule.id} className="bg-slate-50/50 border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-right">
                                <div className="space-y-1 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                                    <span className="text-xs font-bold text-slate-800">
                                      {rule.name || `قانون فیلتر شماره ${rIdx + 1}`}
                                    </span>
                                    {!rule.active && (
                                      <span className="text-[9px] bg-slate-200 text-slate-600 font-bold px-1.5 py-0.5 rounded">غیرفعال</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-600 leading-relaxed font-medium">
                                    <span className="text-slate-400 font-bold">اگر: </span>
                                    {rule.conditions.map((cond, cI) => (
                                      <span key={cI}>
                                        {cI > 0 && <span className="text-indigo-500 font-bold"> و </span>}
                                        {`[${cond.featureName}] برابر با [${cond.values.join(' یا ')}] باشد`}
                                      </span>
                                    ))}
                                    <span className="text-slate-400 font-bold"> ؛ آنگاه: </span>
                                    {rule.actions.map((act, aI) => (
                                      <span key={aI}>
                                        {`در [${act.featureName}] مقادیر `}
                                        <span className="text-red-500 font-bold">[{act.values.join('، ')}]</span>
                                        {` غیرمجاز شود`}
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingRuleId(rule.id);
                                      setNewRuleName(rule.name || '');
                                      setNewRuleConditions(
                                        rule.conditions.length > 0
                                          ? rule.conditions.map(c => ({ featureName: c.featureName, values: [...c.values] }))
                                          : [{ featureName: features[0]?.name || '', values: [] }]
                                      );
                                      setNewRuleActionFeature(rule.actions[0]?.featureName || features[0]?.name || '');
                                      setNewRuleActionValues([...(rule.actions[0]?.values || [])]);
                                      setShowAddRuleForm(true);
                                    }}
                                    className="px-2.5 py-1 rounded text-[10px] font-bold transition-colors bg-indigo-50 text-indigo-600 border border-indigo-150 hover:bg-indigo-100"
                                  >
                                    ویرایش
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfigRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
                                    }}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                                      rule.active
                                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-150 hover:bg-emerald-100'
                                        : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                                    }`}
                                  >
                                    {rule.active ? 'فعال' : 'غیرفعال'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfigRules(prev => prev.filter(r => r.id !== rule.id));
                                    }}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                                    title="حذف قانون"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Variants Configuration */}
                {features.length > 0 && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasVariants}
                        onChange={(e) => setHasVariants(e.target.checked)}
                        className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500 cursor-pointer"
                      />
                      <span className="text-sm font-bold text-slate-800">مدیریت موجودی در سطح ویژگی‌ها (SKU)</span>
                    </label>

                    {hasVariants && (
                      <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                        <p className="text-xs text-slate-500">ترکیب‌های مورد نیاز خود را با انتخاب مقادیر ویژگی‌ها، دستی ایجاد کنید. قوانین ترکیب (configRules) اعمال می‌شود.</p>

                        {/* Manual SKU Builder */}
                        {features.length > 0 && (
                          <div className="p-3 bg-white border border-sky-100 rounded-xl space-y-3">
                            <div className="flex justify-between items-center">
                              <h5 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <Plus size={14} className="text-sky-600" />
                                ایجاد ترکیب جدید (SKU)
                              </h5>
                              {newSkuError && (
                                <span className="text-[10px] text-red-600 font-bold">{newSkuError}</span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {features.map((feature) => {
                                const currentVal = newSkuSelections[feature.name] || '';
                                return (
                                  <div key={feature.id} className="space-y-1">
                                    <label className="text-[10px] text-slate-500 font-medium block">{feature.name}</label>
                                    <select
                                      value={currentVal}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setNewSkuError('');
                                        setNewSkuSelections(prev => {
                                          const next = { ...prev, [feature.name]: val };
                                          // Prune values that are now excluded by rules
                                          let changed = true;
                                          let iter = 0;
                                          while (changed && iter < 10) {
                                            changed = false;
                                            iter++;
                                            for (const f of features) {
                                              const cur = next[f.name];
                                              if (cur && isOptionExcludedByRules(configRules, next, f.name, cur)) {
                                                delete next[f.name];
                                                changed = true;
                                              }
                                            }
                                          }
                                          return next;
                                        });
                                      }}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-sky-500 bg-white"
                                    >
                                      <option value="">-- انتخاب --</option>
                                      {feature.options.map((opt) => {
                                        const isExcluded = isOptionExcludedByRules(configRules, newSkuSelections, feature.name, opt.value);
                                        return (
                                          <option key={opt.id} value={opt.value} disabled={isExcluded}>
                                            {opt.value}{isExcluded ? ' (غیرمجاز)' : ''}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                              {(() => {
                                const targetCurrency = simpleCurrencyForeign || 'یورو';
                                const previewFob = getCombinedVariantFOBPrice(newSkuSelections, targetCurrency);
                                if (Object.keys(newSkuSelections).length > 0 && previewFob > 0) {
                                  return (
                                    <span className="text-[10px] text-slate-500 self-center ml-auto">
                                      قیمت ارزی اولیه: <span className="font-mono font-bold text-sky-600">{previewFob}</span> {targetCurrency}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                              <button
                                type="button"
                                onClick={() => {
                                  setNewSkuSelections({});
                                  setNewSkuError('');
                                }}
                                className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 text-xs font-semibold rounded-lg transition"
                              >
                                پاک کردن
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewSkuError('');
                                  // Validate: all features must have a value
                                  const missing = features.filter(f => !newSkuSelections[f.name]);
                                  if (missing.length > 0) {
                                    setNewSkuError(`مقدار ویژگی‌های ${missing.map(f => f.name).join('، ')} انتخاب نشده است.`);
                                    return;
                                  }
                                  // Check duplicate
                                  const duplicate = variants.find(v => {
                                    const keys = Object.keys(newSkuSelections);
                                    return keys.every(k => v.attributes[k] === newSkuSelections[k]) &&
                                      Object.keys(v.attributes).length === keys.length;
                                  });
                                  if (duplicate) {
                                    setNewSkuError('این ترکیب از قبل تعریف شده است.');
                                    return;
                                  }
                                  const pCode = productCode.trim() || 'SKU';
                                  const targetCurrency = simpleCurrencyForeign || 'یورو';
                                  const generatedSku = generateSku(pCode, features, newSkuSelections);
                                  const calculatedFob = getCombinedVariantFOBPrice(newSkuSelections, targetCurrency);
                                  const newVariant: ProductVariant = {
                                    id: `var-${Date.now()}`,
                                    sku: generatedSku,
                                    attributes: { ...newSkuSelections },
                                    stockLevel: 0,
                                    minStockLevel: 0,
                                    priceForeign: calculatedFob > 0 ? calculatedFob : undefined,
                                    currencyForeign: targetCurrency,
                                    priceRIYAL: calculatedFob > 0 ? convertForeignToRialSimple(calculatedFob, targetCurrency) : undefined
                                  };
                                  setVariants([...variants, newVariant]);
                                  setNewSkuSelections({});
                                }}
                                className="px-3 py-1.5 bg-sky-500 text-white text-xs font-bold rounded-lg hover:bg-sky-600 transition shadow-sm flex items-center gap-1"
                              >
                                <Plus size={12} />
                                افزودن ترکیب
                              </button>
                            </div>
                          </div>
                        )}

                        {variants.length > 0 ? (
                          <div className="space-y-4">
                            {/* SKU Filters and Search */}
                            <div className="space-y-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-right">
                              <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
                                <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                  ابزارهای جستجو و فیلتر SKUها ({variants.filter(v => {
                                    if (variantSearchQuery) {
                                      const q = variantSearchQuery.toLowerCase();
                                      const skuMatch = v.sku.toLowerCase().includes(q);
                                      const attrMatch = Object.entries(v.attributes).some(([key, val]) =>
                                        key.toLowerCase().includes(q) || String(val).toLowerCase().includes(q)
                                      );
                                      if (!skuMatch && !attrMatch) return false;
                                    }
                                    for (const [featName, featValue] of Object.entries(variantAttributeFilters)) {
                                      if (featValue && featValue !== 'all') {
                                        if (v.attributes[featName] !== featValue) return false;
                                      }
                                    }
                                    return true;
                                  }).length} از {variants.length})
                                </h4>
                                
                                {/* Clear Filters button */}
                                {(variantSearchQuery || Object.values(variantAttributeFilters).some(v => v !== 'all')) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVariantSearchQuery('');
                                      setVariantAttributeFilters({});
                                    }}
                                    className="text-xs text-red-500 hover:text-red-600 transition font-medium"
                                  >
                                    حذف فیلترها
                                  </button>
                                )}
                              </div>

                              {/* Filters Row */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                {/* Text Search */}
                                <div className="space-y-1 sm:col-span-2">
                                  <label className="text-[11px] text-slate-500 font-medium block">جستجو در SKU یا نام ویژگی</label>
                                  <input
                                    type="text"
                                    value={variantSearchQuery}
                                    onChange={(e) => setVariantSearchQuery(e.target.value)}
                                    placeholder="مثال: قرمز، XL، یا SKU..."
                                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-sky-500 bg-white"
                                  />
                                </div>

                                {/* Dynamic Dropdowns for Features */}
                                {features.map((feature) => {
                                  const selectedVal = variantAttributeFilters[feature.name] || 'all';
                                  return (
                                    <div key={feature.id} className="space-y-1">
                                      <label className="text-[11px] text-slate-500 font-medium block">فیلتر {feature.name}</label>
                                      <select
                                        value={selectedVal}
                                        onChange={(e) => {
                                          setVariantAttributeFilters(prev => ({
                                            ...prev,
                                            [feature.name]: e.target.value
                                          }));
                                        }}
                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-sky-500 bg-white"
                                      >
                                        <option value="all">همه {feature.name}ها</option>
                                        {feature.options.map(opt => (
                                          <option key={opt.id} value={opt.value}>{opt.value}</option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Bulk Pricing Section */}
                              <div className="border-t border-slate-200 pt-4 mt-2">
                                <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 mb-3">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  قیمت‌گذاری گروهی (همسان‌سازی قیمت‌ها)
                                </h4>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3 items-end">
                                  <div className="space-y-1">
                                    <label className="text-[11px] text-slate-500 font-medium block">قیمت ارزی یکسان</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={bulkPriceForeign}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setBulkPriceForeign(val);
                                        if (val !== "") {
                                          const converted = convertForeignToRialSimple(Number(val), simpleCurrencyForeign);
                                          setBulkPriceRIYAL(String(converted));
                                        } else {
                                          setBulkPriceRIYAL("");
                                        }
                                      }}
                                      placeholder="مثلا ۱۰۰"
                                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500 bg-white text-center font-mono"
                                    />
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-[11px] text-slate-500 font-medium block">واحد ارز</label>
                                    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-center font-bold text-slate-600 min-h-[32px] flex items-center justify-center select-none">
                                      {simpleCurrencyForeign}
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-[11px] text-slate-500 font-medium block">قیمت فروش یکسان (ریال)</label>
                                    <input
                                      type="text"
                                      value={bulkPriceRIYAL !== "" ? formatMoney(bulkPriceRIYAL) : ""}
                                      onChange={(e) => {
                                        const rawVal = e.target.value
                                          .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
                                          .replace(/[^\d]/g, '');
                                        setBulkPriceRIYAL(rawVal);
                                      }}
                                      placeholder="مثلا ۷۰,۰۰۰,۰۰۰"
                                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500 bg-white text-center font-mono font-bold"
                                    />
                                  </div>

                                  <div className="space-y-2 py-1">
                                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600 font-medium select-none">
                                      <input
                                        type="checkbox"
                                        checked={bulkApplyToFilteredOnly}
                                        onChange={(e) => setBulkApplyToFilteredOnly(e.target.checked)}
                                        className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                                      />
                                      <span>فقط روی ردیف‌های فیلتر شده اعمال شود</span>
                                    </label>
                                    
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBulkErrorMsg('');
                                        setBulkSuccessMsg('');
                                        if (bulkPriceForeign === "" && bulkPriceRIYAL === "") {
                                          setBulkErrorMsg("لطفاً قیمت ارزی یا ریالی را جهت اعمال گروهی وارد نمایید.");
                                          return;
                                        }
                                        const currentFiltered = variants.filter(v => {
                                          if (variantSearchQuery) {
                                            const q = variantSearchQuery.toLowerCase();
                                            const skuMatch = v.sku.toLowerCase().includes(q);
                                            const attrMatch = Object.entries(v.attributes).some(([key, val]) => 
                                              key.toLowerCase().includes(q) || String(val).toLowerCase().includes(q)
                                            );
                                            if (!skuMatch && !attrMatch) return false;
                                          }
                                          for (const [featName, featValue] of Object.entries(variantAttributeFilters)) {
                                            if (featValue && featValue !== 'all') {
                                              if (v.attributes[featName] !== featValue) return false;
                                            }
                                          }
                                          return true;
                                        });

                                        const targetList = bulkApplyToFilteredOnly ? currentFiltered : variants;
                                        if (targetList.length === 0) {
                                          setBulkErrorMsg("هیچ ردیفی برای اعمال قیمت پیدا نشد.");
                                          return;
                                        }

                                        const targetIds = new Set(targetList.map(v => v.id));
                                        const updatedVariants = variants.map(v => {
                                          if (targetIds.has(v.id)) {
                                            return {
                                              ...v,
                                              priceForeign: bulkPriceForeign !== "" ? Number(bulkPriceForeign) : undefined,
                                              currencyForeign: simpleCurrencyForeign,
                                              priceRIYAL: bulkPriceRIYAL !== "" ? Number(bulkPriceRIYAL) : undefined
                                            };
                                          }
                                          return v;
                                        });

                                        setVariants(updatedVariants);
                                        setBulkSuccessMsg(`قیمت‌گذاری با موفقیت روی ${targetList.length} ردیف اعمال شد.`);
                                        setTimeout(() => setBulkSuccessMsg(''), 5000);
                                      }}
                                      className="w-full px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition shadow-sm flex items-center justify-center gap-1"
                                    >
                                      اعمال گروهی قیمت
                                    </button>
                                  </div>
                                </div>

                                {bulkSuccessMsg && (
                                  <div className="mt-2 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg p-2 text-center">
                                    {bulkSuccessMsg}
                                  </div>
                                )}
                                {bulkErrorMsg && (
                                  <div className="mt-2 text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 text-center">
                                    {bulkErrorMsg}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* SKU Variants Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-right border-collapse">
                                <thead>
                                  <tr className="border-b border-slate-200">
                                    <th className="w-56 min-w-[220px] py-2 px-3 text-xs font-semibold text-slate-600">کد SKU</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-slate-600">ترکیب</th>
                                    {supplyType === 'INVENTORY' && <th className="py-2 px-3 text-xs font-semibold text-slate-600">موجودی اولیه</th>}
                                    <th className="py-2 px-3 text-xs font-semibold text-slate-600">قیمت ارزی</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-slate-600">قیمت فروش (ریال)</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-slate-600">عملیات</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const filteredVariants = variants.filter(v => {
                                      // Filter rows dynamically
                                      if (variantSearchQuery) {
                                        const q = variantSearchQuery.toLowerCase();
                                        const skuMatch = v.sku.toLowerCase().includes(q);
                                        const attrMatch = Object.entries(v.attributes).some(([key, val]) => 
                                          key.toLowerCase().includes(q) || String(val).toLowerCase().includes(q)
                                        );
                                        if (!skuMatch && !attrMatch) return false;
                                      }
                                      for (const [featName, featValue] of Object.entries(variantAttributeFilters)) {
                                        if (featValue && featValue !== 'all') {
                                          if (v.attributes[featName] !== featValue) return false;
                                        }
                                      }
                                      return true;
                                    });

                                    const totalVariantPages = Math.max(1, Math.ceil(filteredVariants.length / VARIANT_PAGE_SIZE));
                                    // Ensure page is within bounds when filters change
                                    const currentPage = Math.min(variantCurrentPage, totalVariantPages);
                                    
                                    const paginatedVariants = filteredVariants.slice(
                                      (currentPage - 1) * VARIANT_PAGE_SIZE,
                                      currentPage * VARIANT_PAGE_SIZE
                                    );

                                    return (
                                      <>
                                        {paginatedVariants.map((variant) => {
                                          const originalIdx = variants.findIndex(v => v.id === variant.id);
                                          if (originalIdx === -1) return null;

                                          return (
                                            <tr key={variant.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-100 transition">
                                              <td className="py-2 px-3">
                                                <input
                                                  type="text"
                                                  value={variant.sku}
                                                  onChange={(e) => {
                                                    const newV = [...variants];
                                                    newV[originalIdx] = { ...newV[originalIdx], sku: e.target.value };
                                                    setVariants(newV);
                                                  }}
                                                  placeholder="SKU"
                                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-sky-500 font-mono text-left tracking-wider"
                                                  dir="ltr"
                                                />
                                              </td>
                                              <td className="py-2 px-3 text-xs text-slate-700 whitespace-nowrap">
                                                {Object.entries(variant.attributes).map(([k, v]) => `${k}: ${v}`).join(' ، ')}
                                              </td>
                                              {supplyType === 'INVENTORY' && (
                                                <td className="py-2 px-3">
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    value={variant.stockLevel}
                                                    onChange={(e) => {
                                                      const newV = [...variants];
                                                      newV[originalIdx] = { ...newV[originalIdx], stockLevel: Number(e.target.value) || 0 };
                                                      setVariants(newV);
                                                    }}
                                                    className="w-20 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-sky-500"
                                                  />
                                                </td>
                                              )}
                                              <td className="py-2 px-3">
                                                <div className="flex flex-col gap-1">
                                                  <div className="flex items-center gap-1.5">
                                                    <div className="relative flex items-center">
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        step="any"
                                                        value={variant.priceForeign !== undefined ? variant.priceForeign : ""}
                                                        onChange={(e) => {
                                                          const newV = [...variants];
                                                          const val = e.target.value === "" ? undefined : Number(e.target.value);
                                                          newV[originalIdx] = val !== undefined
                                                            ? {
                                                                ...newV[originalIdx],
                                                                priceForeign: val,
                                                                priceRIYAL: convertForeignToRialSimple(val, simpleCurrencyForeign),
                                                                currencyForeign: simpleCurrencyForeign,
                                                              }
                                                            : { ...newV[originalIdx], priceForeign: undefined, priceRIYAL: undefined };
                                                          setVariants(newV);
                                                        }}
                                                        placeholder="0"
                                                        className="w-24 border border-slate-200 rounded-r pl-2 pr-2 py-1 text-xs outline-none focus:border-sky-500 font-mono text-center"
                                                      />
                                                      <div className="bg-slate-100 border-y border-l border-slate-200 text-[10px] font-bold text-slate-600 px-2.5 py-1 rounded-l select-none min-w-[50px] text-center">
                                                        {simpleCurrencyForeign}
                                                      </div>
                                                    </div>
                                                  </div>
                                                  {(() => {
                                                    const combinedPrice = getCombinedVariantFOBPrice(variant.attributes, simpleCurrencyForeign);
                                                    if (combinedPrice > 0) {
                                                      return (
                                                        <div className="flex items-center gap-1 text-[9px] text-slate-500 mr-1 mt-0.5 whitespace-nowrap">
                                                          <span>مجموع ویژگی‌ها:</span>
                                                          <span className="font-mono font-bold text-sky-600">{combinedPrice}</span>
                                                          <span>{simpleCurrencyForeign}</span>
                                                        </div>
                                                      );
                                                    }
                                                    return null;
                                                  })()}
                                                </div>
                                              </td>
                                              <td className="py-2 px-3">
                                                <input
                                                  type="text"
                                                  value={variant.priceRIYAL !== undefined ? formatMoney(variant.priceRIYAL) : ""}
                                                  onChange={(e) => {
                                                    const rawVal = e.target.value
                                                      .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
                                                      .replace(/[^\d]/g, '');
                                                    const newV = [...variants];
                                                    newV[originalIdx] = { ...newV[originalIdx], priceRIYAL: rawVal === "" ? undefined : Number(rawVal) };
                                                    setVariants(newV);
                                                  }}
                                                  placeholder="۰"
                                                  className="w-28 border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-sky-500 font-mono text-center font-bold text-slate-800"
                                                />
                                              </td>
                                              <td className="py-2 px-3">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const newV = [...variants];
                                                    newV.splice(originalIdx, 1);
                                                    setVariants(newV);
                                                  }}
                                                  className="text-red-500 hover:text-red-600 hover:bg-red-50 p-1 rounded transition"
                                                >
                                                  <Trash2 size={14} />
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                        {totalVariantPages > 1 && (
                                          <tr className="border-t border-slate-200 bg-slate-50/50">
                                            <td colSpan={6} className="py-3 px-4">
                                              <div className="flex items-center justify-between">
                                                <span className="text-xs text-slate-500">
                                                  نمایش {((currentPage - 1) * VARIANT_PAGE_SIZE) + 1} تا {Math.min(currentPage * VARIANT_PAGE_SIZE, filteredVariants.length)} از {filteredVariants.length} ترکیب
                                                </span>
                                                <div className="flex items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => setVariantCurrentPage(p => Math.max(1, p - 1))}
                                                    disabled={currentPage === 1}
                                                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                  >
                                                    قبلی
                                                  </button>
                                                  <span className="px-3 py-1 text-xs font-bold text-slate-700">
                                                    صفحه {currentPage} از {totalVariantPages}
                                                  </span>
                                                  <button
                                                    type="button"
                                                    onClick={() => setVariantCurrentPage(p => Math.min(totalVariantPages, p + 1))}
                                                    disabled={currentPage === totalVariantPages}
                                                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                  >
                                                    بعدی
                                                  </button>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </>
                                    );
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-slate-400 text-xs">
                            هیچ ترکیب SKU ایجاد نشده است.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Dynamic Custom Fields Form Section */}
                <CustomFieldsForm
                  module="products"
                  customFields={settings?.customFields || []}
                  customValues={customValues}
                  onChange={setCustomValues}
                />

              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setIsProductModalFullscreen(false); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15"
                >
                  {editingProduct ? 'ثبت تغییرات تجهیز' : 'ذخیره تجهیز'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Adjust Stock Modal */}
      {stockModalOpen && stockAdjustProd && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isStockModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isStockModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-sm my-4'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800">
                ثبت ورود/خروج انبار
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsStockModalFullscreen(!isStockModalFullscreen)}
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isStockModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isStockModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setStockModalOpen(false); setIsStockModalFullscreen(false); }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const amt = Number(stockAdjustAmount);
              if (amt > 0) {
                if (stockAdjustProd.hasVariants && !stockAdjustVariantId) {
                  alert('لطفاً نوع (SKU) مورد نظر را انتخاب کنید.');
                  return;
                }
                
                const finalAmt = stockAdjustType === 'IN' ? amt : -amt;
                let currentStock = stockAdjustProd.stockLevel || 0;
                
                if (stockAdjustProd.hasVariants && stockAdjustVariantId) {
                  const variant = stockAdjustProd.variants?.find(v => v.id === stockAdjustVariantId);
                  if (variant) currentStock = variant.stockLevel || 0;
                }
                
                if (stockAdjustType === 'OUT' && currentStock < amt) {
                   if (!window.confirm('موجودی ثبت شده در سیستم برای این خروج کافی نیست. آیا مایلید با وجود مغایرت، موجودی منفی را در دفاتر انبار ثبت کنید؟')) return;
                }
                
                // 4th arg is referenceId, 5th is referenceType — 'MANUAL' was
                // landing in referenceId and the note in referenceType.
                adjustProductStock(stockAdjustProd.id, finalAmt, stockAdjustVariantId || undefined, undefined, 'MANUAL', stockAdjustNotes);
                setStockModalOpen(false);
                setIsStockModalFullscreen(false);
              }
            }} className="p-6 space-y-4 overflow-y-auto flex-1">
              
              <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4">
                <div className="font-bold text-slate-800 mb-1">{stockAdjustProd.displayName}</div>
                {!stockAdjustProd.hasVariants && (
                  <div className="flex justify-between mt-2 text-xs">
                    <span>موجودی فعلی:</span>
                    <span className="font-bold">{stockAdjustProd.stockLevel || 0} عدد</span>
                  </div>
                )}
              </div>
              
              {stockAdjustProd.hasVariants && stockAdjustProd.variants && (
                <div className="space-y-1.5 mb-4">
                  <label className="text-xs font-semibold text-slate-500">انتخاب نوع (SKU) *</label>
                  <select
                    value={stockAdjustVariantId}
                    onChange={(e) => setStockAdjustVariantId(e.target.value)}
                    required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">-- انتخاب کنید --</option>
                    {stockAdjustProd.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku} - {Object.values(v.attributes).join(', ')} (موجودی: {v.stockLevel || 0})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setStockAdjustType('IN')}
                  className={`py-2 text-sm font-bold rounded-lg border ${stockAdjustType === 'IN' ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}
                >
                  ورود به انبار
                </button>
                <button
                  type="button"
                  onClick={() => setStockAdjustType('OUT')}
                  className={`py-2 text-sm font-bold rounded-lg border ${stockAdjustType === 'OUT' ? 'bg-rose-500 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200'}`}
                >
                  خروج از انبار
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">تعداد *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={stockAdjustAmount}
                  onChange={(e) => setStockAdjustAmount(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 outline-none text-right font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">توضیحات (اختیاری)</label>
                <textarea
                  value={stockAdjustNotes}
                  onChange={(e) => setStockAdjustNotes(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 outline-none text-right font-medium resize-none"
                  rows={2}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setStockModalOpen(false); setIsStockModalFullscreen(false); }}
                  className="flex-1 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className={`flex-1 px-5 py-2 text-white rounded-xl text-sm font-medium transition shadow-lg ${stockAdjustType === 'IN' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20' : 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'}`}
                >
                  ثبت
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Correcting one ledger row — system administrator only. */}
      {editingMovement && (
        <StockMovementEditModal
          movement={editingMovement}
          onClose={() => setEditingMovement(null)}
          onSave={saveMovement}
        />
      )}

      <ConfirmModal
        isOpen={!!deletingMovement}
        onClose={() => setDeletingMovement(null)}
        onConfirm={removeMovement}
        variant="danger"
        title="حذف ردیف تاریخچه انبار"
        message={
          deletingMovement
            ? `«${deletingMovement.product ? deletingMovement.product.displayName : 'کالای حذف شده'}» — ` +
              `${deletingMovement.type === 'IN' ? 'ورود' : 'خروج'} ${deletingMovement.quantity} ` +
              `در تاریخ ${deletingMovement.occurredAtJalali || toShamsiStr(deletingMovement.occurredAt)}`
            : ''
        }
      >
        <div className="text-[11px] text-slate-500 leading-relaxed space-y-2 text-right">
          <p>
            {deletingMovement?.affectsAvailable
              ? 'با حذف این ردیف، همان مقدار از موجودی قابل فروش پس گرفته می‌شود.'
              : 'این ردیف موجودی قابل فروش را تغییر نداده بود، پس حذف آن هم موجودی را جابه‌جا نمی‌کند.'}
          </p>
          {deletingMovement?.referenceId && deletingMovement.referenceType !== 'MANUAL' && (
            <p className="text-amber-700">
              این ردیف را یک سند ({deletingMovement.referenceType}) ثبت کرده است؛ با ذخیره‌ی دوباره‌ی آن سند
              دوباره نوشته می‌شود.
            </p>
          )}
          <p>این حذف با نام شما در گزارش تغییرات ثبت می‌شود.</p>
        </div>
      </ConfirmModal>

      {/* SKU Decoder Modal */}
      {decodeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-start justify-center z-50 overflow-y-auto p-4" dir="rtl">
          <div className="bg-white shadow-xl border border-slate-100 rounded-2xl w-full max-w-2xl my-8 overflow-hidden animate-scale-in flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <ScanSearch size={18} className="text-sky-600" />
                <h3 className="font-bold text-slate-800">رمزگشایی کد SKU</h3>
              </div>
              <button
                onClick={() => setDecodeModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-12rem)]">
              {/* Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">کد SKU را وارد یا اسکن کنید</label>
                <input
                  type="text"
                  autoFocus
                  value={decodeInput}
                  onChange={(e) => setDecodeInput(e.target.value)}
                  placeholder="مثال: PRD-001-sz2-mat1"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono text-left outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                />
                <p className="text-[10px] text-slate-400">
                  ساختار کد: کد کالا + کد هر ویژگی و شماره گزینه. ارقام فارسی و حروف بزرگ/کوچک به‌طور خودکار پشتیبانی می‌شوند.
                </p>
              </div>

              {/* Empty state */}
              {!decodeInput.trim() && (
                <div className="text-center py-8 text-slate-400 text-xs font-medium bg-slate-50 rounded-xl border border-slate-150">
                  برای مشاهده مشخصات کالا، کد SKU را وارد کنید.
                </div>
              )}

              {/* Not found */}
              {decodeInput.trim() && !decodeResult && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-150 rounded-xl p-4">
                  <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="text-right">
                    <p className="text-xs font-bold text-red-700">کالایی با این کد یافت نشد.</p>
                    <p className="text-[11px] text-red-600/80 mt-1 leading-relaxed">
                      کد کالای ابتدای SKU با هیچ‌یک از کالاهای تعریف‌شده مطابقت ندارد. صحت کد را بررسی کنید.
                    </p>
                  </div>
                </div>
              )}

              {/* Result */}
              {decodeResult && (() => {
                const prod = decodeResult.product;
                const totalStock = prod.hasVariants && prod.variants
                  ? prod.variants.reduce((acc, v) => acc + (Number(v.stockLevel) || 0), 0)
                  : (Number(prod.stockLevel) || 0);

                // Flag combinations that violate the product's own filtering rules.
                const selections: Record<string, string> = {};
                decodeResult.attributes.forEach(a => { selections[a.featureName] = a.optionValue; });
                const violations = decodeResult.attributes.filter(a =>
                  isOptionExcludedByRules(prod.configRules, selections, a.featureName, a.optionValue)
                );

                return (
                  <div className="space-y-4">
                    {/* Match banner */}
                    {decodeResult.exact ? (
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-150 rounded-xl px-4 py-2.5">
                        <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                        <p className="text-[11px] font-bold text-emerald-700">
                          این کد با یک SKU ثبت‌شده در انبار مطابقت دارد.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-150 rounded-xl px-4 py-2.5">
                        <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
                          این ترکیب به‌عنوان SKU مستقل در انبار ثبت نشده است؛ مشخصات از ساختار کد رمزگشایی شد.
                        </p>
                      </div>
                    )}

                    {/* Product identity */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {prod.images && prod.images[0] && (
                          <img
                            src={prod.images[0]}
                            alt={prod.displayName}
                            className="w-16 h-16 object-cover rounded-lg border border-slate-200 shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0 text-right">
                          <h4 className="font-bold text-slate-800 text-sm">{prod.displayName || prod.name}</h4>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">{prod.code}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-slate-200/70">
                        <div>
                          <span className="text-[10px] text-slate-400 block">دسته‌بندی</span>
                          <span className="text-[11px] font-bold text-slate-700">{prod.category || '—'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">برند</span>
                          <span className="text-[11px] font-bold text-slate-700">{prod.brand || '—'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">نوع تامین</span>
                          <span className="text-[11px] font-bold text-slate-700">
                            {prod.supplyType === 'ORDER' ? 'قابل سفارش' : 'موجود در انبار'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">
                            {decodeResult.variant ? 'موجودی این SKU' : 'موجودی کل کالا'}
                          </span>
                          <span className={`text-[11px] font-bold font-mono ${
                            (decodeResult.variant ? Number(decodeResult.variant.stockLevel) || 0 : totalStock) > 0
                              ? 'text-emerald-600' : 'text-red-500'
                          }`}>
                            {decodeResult.variant ? (Number(decodeResult.variant.stockLevel) || 0) : totalStock} {prod.unit || 'عدد'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Decoded features */}
                    <div className="space-y-2">
                      <h5 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                        ویژگی‌ها و گزینه‌های رمزگشایی‌شده
                      </h5>
                      {decodeResult.attributes.length === 0 ? (
                        <div className="text-center py-4 bg-slate-50 border border-slate-150 rounded-xl text-slate-400 text-[11px] font-medium">
                          این کد فقط شامل کد کالا است و گزینه‌ای در آن رمزگذاری نشده.
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <table className="w-full text-right">
                            <thead className="bg-slate-50 text-slate-500">
                              <tr>
                                <th className="py-2 px-3 text-[10px] font-bold">ویژگی</th>
                                <th className="py-2 px-3 text-[10px] font-bold">گزینه انتخاب‌شده</th>
                                <th className="py-2 px-3 text-[10px] font-bold">بخش کد</th>
                                <th className="py-2 px-3 text-[10px] font-bold">قیمت گزینه</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {decodeResult.attributes.map((attr, idx) => {
                                const isViolation = violations.includes(attr);
                                return (
                                  <tr key={idx} className={isViolation ? 'bg-red-50/50' : 'bg-white'}>
                                    <td className="py-2 px-3 text-[11px] font-semibold text-slate-600">
                                      {attr.featureName}
                                      {attr.featureCode && (
                                        <span className="text-[9px] text-slate-400 font-mono mr-1">({attr.featureCode})</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-[11px] font-bold text-slate-800">
                                      {attr.optionValue}
                                      {isViolation && (
                                        <span className="text-[9px] text-red-600 font-bold mr-1.5">(مغایر با قوانین)</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-[10px] font-mono text-slate-400">{attr.segment || '—'}</td>
                                    <td className="py-2 px-3 text-[10px] font-mono text-slate-600">
                                      {attr.price ? `${attr.price.toLocaleString()} ${attr.currency || ''}` : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Rule violation warning */}
                    {violations.length > 0 && (
                      <div className="flex items-start gap-2.5 bg-red-50 border border-red-150 rounded-xl p-3.5">
                        <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-red-700 leading-relaxed">
                          این ترکیب با قوانین فیلترینگ تعریف‌شده برای این کالا مغایرت دارد و از نظر فنی مجاز نیست.
                        </p>
                      </div>
                    )}

                    {/* Unmatched segments */}
                    {decodeResult.unmatchedSegments.length > 0 && (
                      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-150 rounded-xl p-3.5">
                        <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-right">
                          <p className="text-[11px] font-bold text-amber-700">بخش‌های ناشناس در کد</p>
                          <p className="text-[10px] text-amber-600/90 mt-1 font-mono">
                            {decodeResult.unmatchedSegments.join('  ،  ')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Jump to product */}
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => { setDecodeModalOpen(false); handleOpenEdit(prod); }}
                        className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                      >
                        <Edit size={13} />
                        مشاهده و ویرایش این کالا
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Batch Upload Modal */}
      {batchModalOpen && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isBatchModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isBatchModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-md my-4'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800">
                ورود و خروج گروهی با اکسل
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsBatchModalFullscreen(!isBatchModalFullscreen)}
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isBatchModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isBatchModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setBatchModalOpen(false); setIsBatchModalFullscreen(false); }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm leading-relaxed border border-blue-100">
                برای ویرایش موجودی یا <strong>تعریف گروهی تجهیزات جدید</strong>، ابتدا فایل نمونه را دانلود کنید. <br/>
                - <strong>نوع تامین</strong>: برای کالاهای موجود در انبار مقدار <code>INVENTORY</code> و برای کالاهای سفارشی مقدار <code>ORDER</code> را وارد کنید.<br/>
                - <strong>کد کالا</strong>: اگر خالی باشد، سیستم به صورت خودکار یک کد جدید برای کالا ایجاد می‌کند.<br/>
                - <strong>تاریخ</strong>: تاریخ را می‌توانید به صورت شمسی (مثل 1403/05/12) وارد کنید. اگر خالی باشد، تاریخ امروز ثبت می‌شود.<br/>
                - <strong>کد ویژگی‌ها</strong>: کد ویژگی را با پرانتز یا کروشه بعد از نام ویژگی وارد کنید تا به ابتدای بخش مربوطه در SKU اضافه شود؛ مثلاً: <code>سایز(sz): ۱ اینچ، ۲ اینچ</code>.<br/>
                - <strong>کد گزینه‌ها</strong>: برای هر گزینه هم می‌توانید کد بگذارید تا در SKU به کار رود؛ مثلاً: <code>سایز(sz): ۱ اینچ(1I)، ۲ اینچ(2I)</code> که SKU آن به شکل <code>EQ-12345-sz2I</code> ساخته می‌شود. اگر کد گزینه وارد نشود، <strong>شماره ترتیب</strong> همان گزینه استفاده می‌شود (مثلاً <code>EQ-12345-sz2</code>).<br/>
                - چند ویژگی را با <code>|</code> و گزینه‌ها را با <code>،</code> از هم جدا کنید.
              </div>
              
              <div className="flex justify-center">
                <button
                  onClick={handleDownloadTemplate}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg border border-slate-300 transition text-sm flex items-center gap-2"
                >
                  دانلود قالب اکسل
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">آپلود فایل تکمیل شده</label>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={(e) => setBatchFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-indigo-50 file:text-indigo-700
                    hover:file:bg-indigo-100 transition"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setBatchModalOpen(false); setIsBatchModalFullscreen(false); }}
                  className="flex-1 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={handleProcessBatch}
                  disabled={!batchFile}
                  className="flex-1 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition shadow-lg shadow-emerald-500/20"
                >
                  پردازش و اعمال تغییرات
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Selling Price Calculator Modal (simple products only) */}
      <PriceCalculatorModal
        open={showCalculator}
        onClose={() => setShowCalculator(false)}
        subtitle="محصول ساده (فاقد ویژگی)"
        initialPriceForeign={simplePriceForeign ? Number(simplePriceForeign) : 0}
        currency={calcCurrency || simpleCurrencyForeign || 'یورو'}
        initialValues={{
          priceForeign: simplePriceForeign ? Number(simplePriceForeign) : undefined,
          currencyForeign: simpleCurrencyForeign,
          priceRIYAL: simplePriceRIYAL ? Number(simplePriceRIYAL) : undefined,
          ...simpleCalcDetails,
        }}
        // One subject here — the simple product's own price — so opening the
        // modal is the only thing that should reseed it.
        seedKey="simple"
        exchangeRates={exchangeRates}
        onApply={(sellingForeign, sellingRial, details, appliedCurrency) => {
          handleApplyCalculatedPrice(sellingForeign, sellingRial, details, appliedCurrency);
        }}
      />

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setProductToDeleteId(null);
          setProductToDeleteName('');
        }}
        onConfirm={() => {
          if (productToDeleteId) {
            deleteProduct(productToDeleteId);
          }
        }}
        title="حذف کالا/تجهیز"
        message={`آیا از حذف کالا "${productToDeleteName}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      />

      {/* Product Image Lightbox Modal */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[150] flex flex-col items-center justify-center p-4" 
          dir="rtl"
          onClick={() => setLightboxUrl(null)}
        >
          <div 
            className="bg-white max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 flex justify-between items-center text-right">
              <div className="flex items-center gap-2">
                <ImageIcon size={18} className="text-sky-400" />
                <h3 className="font-bold text-xs sm:text-sm">مشاهده تصویر کالا</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadFileFromServer(lightboxUrl, 'product-image.png')}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <Download size={13} />
                  <span>دانلود مستقیم تصویر</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxUrl(null)}
                  className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                  title="بستن"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 overflow-auto bg-slate-50 flex items-center justify-center">
              <img
                src={lightboxUrl}
                alt="Product High Resolution"
                className="max-w-full max-h-[70vh] rounded-lg border border-slate-200 shadow-sm object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
