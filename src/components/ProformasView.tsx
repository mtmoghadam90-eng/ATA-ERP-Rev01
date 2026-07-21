import React, { useState } from "react";
import {
  Plus,
  Search,
  Filter,
  FileText,
  Edit,
  Trash2,
  Printer,
  CheckCircle,
  Check,
  Clock,
  XCircle,
  Ban,
  AlertCircle,
  Eye,
  PlusCircle,
  MinusCircle,
  X,
  FileSpreadsheet,
  Settings,
  Building,
  DollarSign,
  Copy,
  Package,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  Proforma,
  Customer,
  Project,
  Product,
  ProductVariant,
  ProformaItem,
  ERPSettings,
  ExchangeRate,
  User,
} from "../types";
import { getTodayShamsi, addDaysToShamsi } from "../dateUtils";
import ShamsiDatePicker from "./ShamsiDatePicker";
import { getProformaOutcomeStatus } from "../useERPStore";
import ConfirmModal from "./ConfirmModal";
import { SearchableSelect } from "./SearchableSelect";
import QuickAddModal from "./QuickAddModal";
import { toPersianDigits } from "../numUtils";
import ModuleNotesSection from "./ModuleNotesSection";
import CustomerAgreementAlert from "./CustomerAgreementAlert";
import { isFieldRequired, renderFieldLabelWithAsterisk } from "../utils/requiredFields";

// Helper functions for dynamic delivery time notes generation
const generateDeliveryNotes = (
  itemsList: any[],
  isEqualDelivery: boolean = true,
) => {
  if (!itemsList || itemsList.length === 0) {
    return "زمان تحویل:\nفوری";
  }

  const first = itemsList[0];
  const firstRange = first.deliveryRange || "۳-۴";
  const firstUnit = first.deliveryUnit || "هفته";
  const firstType = first.deliveryType || "کاری";
  const firstPostfix =
    first.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت";

  const allEqual = itemsList.every((item) => {
    const range = item.deliveryRange || "۳-۴";
    const unit = item.deliveryUnit || "هفته";
    const type = item.deliveryType || "کاری";
    const postfix =
      item.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت";
    return (
      range === firstRange &&
      unit === firstUnit &&
      type === firstType &&
      postfix === firstPostfix
    );
  });

  if (isEqualDelivery && allEqual) {
    return toPersianDigits(
      `زمان تحویل:\n${firstRange} ${firstUnit} ${firstType} ${firstPostfix}`,
    );
  }

  const lines = itemsList.map((item, index) => {
    const range = item.deliveryRange || "۳-۴";
    const unit = item.deliveryUnit || "هفته";
    const type = item.deliveryType || "کاری";
    const postfix =
      item.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت";
    return `ردیف ${index + 1} : ${range} ${unit} ${type} ${postfix}`;
  });
  return toPersianDigits(`زمان تحویل:\n${lines.join("\n")}`);
};

const updateNotesWithDelivery = (
  currentNotes: string,
  itemsList: any[],
  isEqualDelivery: boolean = true,
) => {
  const deliverySection = generateDeliveryNotes(itemsList, isEqualDelivery);
  const notesStr = currentNotes || "";
  const lines = notesStr.split("\n");
  const startIndex = lines.findIndex((line) =>
    line.trim().startsWith("زمان تحویل:"),
  );

  if (startIndex !== -1) {
    // Find where the delivery section ends
    let endIndex = startIndex + 1;

    // Check if the next lines contain any line starting with "ردیف"
    let hasRowLines = false;
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      if (line.startsWith("ردیف")) {
        hasRowLines = true;
        break;
      }
      if (line.endsWith(":") && !line.startsWith("ردیف")) {
        break;
      }
    }

    if (hasRowLines) {
      while (endIndex < lines.length) {
        const line = lines[endIndex].trim();
        if (line !== "" && !line.startsWith("ردیف")) {
          break;
        }
        endIndex++;
      }
    } else {
      // Consume the single line after "زمان تحویل:" if it is not empty and not another heading
      if (
        endIndex < lines.length &&
        lines[endIndex].trim() !== "" &&
        !lines[endIndex].trim().endsWith(":")
      ) {
        endIndex++;
      }
    }
    const before = lines.slice(0, startIndex);
    const after = lines.slice(endIndex);
    return [...before, deliverySection, ...after].join("\n");
  } else {
    if (notesStr.trim() === "") {
      return deliverySection;
    }
    return `${notesStr.trim()}\n\n${deliverySection}`;
  }
};

const getDeliverySummary = (itemsList: any[]) => {
  if (!itemsList || itemsList.length === 0) return "فوری";
  const first = itemsList[0];
  const range = first.deliveryRange || "۳-۴";
  const unit = first.deliveryUnit || "هفته";
  const type = first.deliveryType || "کاری";

  const allEqual = itemsList.every((item) => {
    const itemRange = item.deliveryRange || "۳-۴";
    const itemUnit = item.deliveryUnit || "هفته";
    const itemType = item.deliveryType || "کاری";
    return itemRange === range && itemUnit === unit && itemType === type;
  });

  if (allEqual) {
    return `${range} ${unit} ${type}`;
  }
  return `${range} ${unit} ${type} (ردیف‌های دیگر متفاوت)`;
};

interface ProformasViewProps {
  initialPrintDocId?: string;
  onClearInitialPrintDocId?: () => void;
  proformas: Proforma[];
  customers: Customer[];
  projects: Project[];
  products: Product[];
  settings: ERPSettings;
  exchangeRates: ExchangeRate[];
  addProforma: (proforma: Omit<Proforma, "id" | "proformaNumber">) => void;
  updateProforma: (proforma: Proforma) => void;
  updateProformaStatus: (
    id: string,
    status: Proforma["status"],
    lossReason?: string,
    sentMethod?: string,
    sentRecipients?: string[],
  ) => void;
  batchUpdateProjectProformasStatus: (
    projectId: string,
    status: Proforma["status"],
    lossReason?: string,
  ) => void;
  deleteProforma: (id: string) => void;
  addCustomer?: (
    customer: Omit<Customer, "id" | "createdAt">,
  ) => Customer | any;
  updateCustomer?: (customer: Customer) => void;
  addProject?: (
    project: Omit<Project, "id" | "code" | "creationDate"> & {
      customValues?: Record<string, any>;
    },
  ) => Project | any;
  addProduct?: (
    product: Omit<Product, "id" | "stockLevel"> & { stockLevel?: number },
  ) => Product;
  users?: User[];
  currentUser?: User | null;
  transactions?: any;
  packagingDeliveries?: any;
}
export default function ProformasView({
  initialPrintDocId,
  onClearInitialPrintDocId,
  proformas,
  customers,
  projects,
  products,
  settings,
  exchangeRates,
  addProforma,
  updateProforma,
  updateProformaStatus,
  batchUpdateProjectProformasStatus,
  deleteProforma,
  addCustomer,
  updateCustomer,
  addProject,
  addProduct,
  users = [],
  currentUser = null,
}: ProformasViewProps) {
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [quickAddType, setQuickAddType] = useState<
    "customer" | "project" | "supplier" | "product" | null
  >(null);
  const [quickAddProductIndex, setQuickAddProductIndex] = useState<
    number | null
  >(null);
  const [isQuickAddingContact, setIsQuickAddingContact] = useState(false);
  const [isQuickAddingSentRecipient, setIsQuickAddingSentRecipient] = useState(false);
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalFullscreen, setIsCreateModalFullscreen] = useState(false);
  const [editingProforma, setEditingProforma] = useState<Proforma | null>(null);
  const [showPrintView, setShowPrintView] = useState(false);
  const [isPrintViewFullscreen, setIsPrintViewFullscreen] = useState(false);
  const [selectedProforma, setSelectedProforma] = useState<Proforma | null>(
    null,
  );
  const [overrideShowBrand, setOverrideShowBrand] = useState(false);
  // Status change helper state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusTargetId, setStatusTargetId] = useState<string>("");
  const [newStatusSelected, setNewStatusSelected] =
    useState<Proforma["status"]>("پیش‌نویس");
  const [lossReason, setLossReason] = useState("");
  // Individual items status states
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [isItemsModalFullscreen, setIsItemsModalFullscreen] = useState(false);
  const [selectedProformaForItems, setSelectedProformaForItems] =
    useState<Proforma | null>(null);
  const [editingItemsList, setEditingItemsList] = useState<ProformaItem[]>([]);
  // Bulk project proformas status change state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkProjectId, setBulkProjectId] = useState("");
  const [bulkProjectName, setBulkProjectName] = useState("");
  const [bulkStatusSelected, setBulkStatusSelected] =
    useState<Proforma["status"]>("پیش‌نویس");
  const [bulkLossReason, setBulkLossReason] = useState("");
  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [proformaToDeleteId, setProformaToDeleteId] = useState<string | null>(
    null,
  );
  const [proformaToDeleteNumber, setProformaToDeleteNumber] =
    useState<string>("");

  // Cancel all confirm state
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelProjectId, setCancelProjectId] = useState("");
  const [cancelProjectName, setCancelProjectName] = useState("");

  // Proforma sending detail fields (used in status change & create/edit)
  const [sentMethodType, setSentMethodType] = useState<string>(() => (settings?.dropdownItems?.proformaSentMethods || [])[0] || "ایمیل");
  const [customSentMethod, setCustomSentMethod] = useState<string>("");
  const [selectedSentRecipients, setSelectedSentRecipients] = useState<string[]>([]);
  const [recipientSearchTerm, setRecipientSearchTerm] = useState("");
  React.useEffect(() => {
    if (initialPrintDocId) {
      const pf = proformas.find((p) => p.id === initialPrintDocId);
      if (pf) {
        handleOpenPrint(pf);
      }
    }
  }, [initialPrintDocId, proformas]);

  // Expand Project sections state
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const toggleProjectExpand = (projId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projId]: prev[projId] === false ? true : false,
    }));
  };
  // Item status modal helpers
  const handleOpenItemsModal = (pf: Proforma) => {
    setSelectedProformaForItems(pf);
    setEditingItemsList(
      (pf.items || []).map((item) => ({
        ...item,
        status: item.status || "جاری",
        lossReason: item.lossReason || "",
      })),
    );
    setShowItemsModal(true);
  };
  const handleSaveItemsStatus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProformaForItems) return;
    updateProforma({
      ...selectedProformaForItems,
      items: editingItemsList,
      isCancelled: false,
      status:
        selectedProformaForItems.status === "لغو شده"
          ? "ارسال شده"
          : selectedProformaForItems.status,
    });
    setShowItemsModal(false);
  };
  const handleItemStatusChangeInList = (
    index: number,
    st: ProformaItem["status"],
  ) => {
    setEditingItemsList(
      editingItemsList.map((item, idx) =>
        idx === index
          ? {
              ...item,
              status: st,
              lossReason: st === "بازنده" ? item.lossReason : undefined,
            }
          : item,
      ),
    );
  };
  const handleItemLossReasonChangeInList = (index: number, reason: string) => {
    setEditingItemsList(
      editingItemsList.map((item, idx) =>
        idx === index ? { ...item, lossReason: reason } : item,
      ),
    );
  };
  // Bulk project update modal helpers
  const handleOpenBulkModal = (projId: string, projName: string) => {
    setBulkProjectId(projId);
    setBulkProjectName(projName);
    setBulkStatusSelected("باخته");
    setBulkLossReason("");
    setShowBulkModal(true);
  };
  const handleSaveBulkStatus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkProjectId) return;
    batchUpdateProjectProformasStatus(
      bulkProjectId,
      bulkStatusSelected,
      bulkStatusSelected === "باخته" ? bulkLossReason : undefined,
    );
    setShowBulkModal(false);
  };
  // Form states for creating/editing proforma
  const [proformaType, setProformaType] =
    useState<Proforma["proformaType"]>("FINANCIAL");
  const [customerId, setCustomerId] = useState("");
  const [contactCustomerId, setContactCustomerId] = useState("");
  const [contactPrefix, setContactPrefix] = useState("");
  const [projectId, setProjectId] = useState("");
  const [issueDate, setIssueDate] = useState(getTodayShamsi());
  const [expiryDate, setExpiryDate] = useState(() =>
    addDaysToShamsi(getTodayShamsi(), 30),
  );
  const [deliveryDate, setDeliveryDate] = useState(
    "۳ هفته کاری پس از پیش پرداخت",
  );
  const [status, setStatus] = useState<Proforma["status"]>("پیش‌نویس");
  const [currency, setCurrency] = useState<Proforma["currency"]>("ریال");
  const [historicalExchangeRate, setHistoricalExchangeRate] =
    useState<number>(0);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [taxPercent, setTaxPercent] = useState<number>(10); // Standard Iranian VAT is 10% since 1403
  const [notes, setNotes] = useState(
    settings?.proformaTemplates?.[0]?.termsAndConditions || "",
  );
  const [items, setItems] = useState<
    Omit<ProformaItem, "id" | "totalPriceRIYAL">[]
  >([]);
  const [showConfigModal, setShowConfigModal] = useState<number | null>(null);
  const [configSelections, setConfigSelections] = useState<
    Record<string, string[]>
  >({});
  const [isEqualDelivery, setIsEqualDelivery] = useState(true);
  // Quick Customer Creation States
  const [showQuickCustomerModal, setShowQuickCustomerModal] = useState(false);
  const [quickCustType, setQuickCustType] = useState<"حقوقی" | "حقیقی">(
    "حقوقی",
  );
  const [quickCustName, setQuickCustName] = useState("");
  const [quickCustFirstName, setQuickCustFirstName] = useState("");
  const [quickCustLastName, setQuickCustLastName] = useState("");
  const [quickCustPhone, setQuickCustPhone] = useState("");
  const [quickCustEmail, setQuickCustEmail] = useState("");
  const [quickCustIndustry, setQuickCustIndustry] = useState("نفت و گاز");
  const [quickCustKeyPerson, setQuickCustKeyPerson] = useState("");
  const [quickCustPosition, setQuickCustPosition] = useState("");
  // Quick Project Creation States
  const [showQuickProjectModal, setShowQuickProjectModal] = useState(false);
  const [quickProjName, setQuickProjName] = useState("");
  const [quickProjCustomerId, setQuickProjCustomerId] = useState("");
  const [quickProjStage, setQuickProjStage] = useState("استعلام اولیه");
  const [quickProjSalesExpert, setQuickProjSalesExpert] = useState("");
  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingProforma(null);
    setSentMethodType((settings?.dropdownItems?.proformaSentMethods || [])[0] || "ایمیل");
    setCustomSentMethod("");
    setSelectedSentRecipients([]);
    setRecipientSearchTerm("");
    const firstCust = customers[0];
    setCustomerId(firstCust?.id || "");
    setContactCustomerId("");
    // Initialize default prefix based on first customer gender if they are a real person
    if (firstCust && firstCust.customerType === "حقیقی") {
      if (firstCust.gender === "مرد") {
        setContactPrefix("جناب آقای مهندس");
      } else if (firstCust.gender === "زن") {
        setContactPrefix("سرکار خانم مهندس");
      } else {
        setContactPrefix("");
      }
    } else {
      setContactPrefix("");
    }
    setProjectId("");
    setProformaType("FINANCIAL");
    setIssueDate(getTodayShamsi());
    setExpiryDate(addDaysToShamsi(getTodayShamsi(), 30));

    const defaultItems = [
      {
        productId: products[0]?.id || "",
        productName: products[0]?.displayName || "",
        productCode: products[0]?.code || "",
        brand: products[0]?.brand || "",
        quantity: 1,
        unitPriceRIYAL: 0,
        techSpecs: "",
        selectedImage:
          products[0]?.images && products[0]?.images.length > 0
            ? products[0]?.images[0]
            : undefined,
        deliveryRange: "۳-۴",
        deliveryUnit: "هفته" as const,
        deliveryType: "کاری" as const,
        deliveryPostfix: "پس از تایید پیش فاکتور و دریافت پیش پرداخت",
      },
    ];
    setItems(defaultItems);
    setIsEqualDelivery(true);
    setStatus("پیش‌نویس");
    setCurrency("ریال");
    setHistoricalExchangeRate(0);
    setDiscountPercent(0);
    setTaxPercent(10);
    const initialNotes =
      settings?.proformaTemplates?.[0]?.termsAndConditions || "";
    setNotes(updateNotesWithDelivery(initialNotes, defaultItems, true));
    setDeliveryDate(getDeliverySummary(defaultItems));
    setShowCreateModal(true);
  };
  // Open Edit Modal
  const handleOpenEdit = (pf: Proforma) => {
    const isAdmin = currentUser?.role === 'admin' || currentUser?.isSystemAdmin;
    if (pf.status === "ارسال شده" && !isAdmin) {
      alert("این پیش‌فاکتور ارسال شده است و امکان ویرایش آن وجود ندارد.");
      return;
    }

    setEditingProforma(pf);
    setProformaType(pf.proformaType || "FINANCIAL");
    setCustomerId(pf.customerId);
    setContactCustomerId(pf.contactCustomerId || "");
    setContactPrefix(pf.contactPrefix || "");
    setProjectId(pf.projectId || "");
    setIssueDate(pf.issueDate);
    setExpiryDate(pf.expiryDate);
    setStatus(pf.status);
    setCurrency(pf.currency || "ریال");
    setHistoricalExchangeRate(pf.historicalExchangeRate || 0);
    setDiscountPercent(pf.discountPercent);
    setTaxPercent(pf.taxPercent);

    // Initialize sending details if they exist in pf
    if (pf.sentMethod) {
      const commonMethods = settings?.dropdownItems?.proformaSentMethods || ["ایمیل", "واتس‌اپ", "تلگرام", "پست", "حضوری", "سایر"];
      if (commonMethods.includes(pf.sentMethod)) {
        setSentMethodType(pf.sentMethod);
        setCustomSentMethod("");
      } else {
        setSentMethodType("سایر");
        setCustomSentMethod(pf.sentMethod);
      }
    } else {
      setSentMethodType((settings?.dropdownItems?.proformaSentMethods || [])[0] || "ایمیل");
      setCustomSentMethod("");
    }
    setSelectedSentRecipients(pf.sentRecipients || []);
    setRecipientSearchTerm("");

    const loadedItems = pf.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      productCode: item.productCode,
      brand: item.brand,
      quantity: item.quantity,
      unitPriceRIYAL: item.unitPriceRIYAL,
      techSpecs: item.techSpecs || "",
      selectedImage: item.selectedImage,
      deliveryRange: item.deliveryRange || "۳-۴",
      deliveryUnit: item.deliveryUnit || "هفته",
      deliveryType: item.deliveryType || "کاری",
      deliveryPostfix:
        item.deliveryPostfix || "پس از تایید پیش فاکتور و دریافت پیش پرداخت",
    }));
    setItems(loadedItems);
    const allEqual =
      loadedItems.length > 0
        ? loadedItems.every(
            (it) =>
              it.deliveryRange === loadedItems[0].deliveryRange &&
              it.deliveryUnit === loadedItems[0].deliveryUnit &&
              it.deliveryType === loadedItems[0].deliveryType &&
              it.deliveryPostfix === loadedItems[0].deliveryPostfix,
          )
        : true;
    setIsEqualDelivery(allEqual);
    setNotes(updateNotesWithDelivery(pf.notes || "", loadedItems, allEqual));
    setDeliveryDate(getDeliverySummary(loadedItems));
    setShowCreateModal(true);
  };
  // Handle Currency selection conversion
  const handleCurrencyChange = (newCurrency: Proforma["currency"]) => {
    const prevCurrency = currency;
    setCurrency(newCurrency);
    // Convert existing items' prices from prevCurrency to newCurrency
    const prevEng = mapPersianCurrencyToEnglish(prevCurrency || "ریال");
    const prevRateObj = prevEng
      ? exchangeRates.find((r) => r.currency === prevEng)
      : undefined;
    const prevRate = prevRateObj ? prevRateObj.rateToRIYAL : 1;
    const newEng = mapPersianCurrencyToEnglish(newCurrency || "ریال");
    const newRateObj = newEng
      ? exchangeRates.find((r) => r.currency === newEng)
      : undefined;
    const newRate = newRateObj ? newRateObj.rateToRIYAL : 1;

    // Automatically set historicalExchangeRate to the current exchange rate
    setHistoricalExchangeRate(newRate);

    const updatedItems = items.map((item) => {
      // First, convert unit price from prevCurrency back to IRR
      const priceInRial =
        item.unitPriceRIYAL * (prevCurrency === "ریال" ? 1 : prevRate);
      // Then, convert from IRR to the newCurrency
      const priceInNewCurrency =
        newCurrency === "ریال" ? priceInRial : priceInRial / newRate;
      return {
        ...item,
        unitPriceRIYAL: Math.round(priceInNewCurrency * 100) / 100,
      };
    });
    setItems(updatedItems);
  };
  // Add Item line
  const handleAddItemLine = () => {
    const firstProd = products[0];
    if (!firstProd) return;
    // Convert first product's IRR basePrice to the selected currency
    const engCurrency = mapPersianCurrencyToEnglish(currency || "ریال");
    const rateObj = engCurrency
      ? exchangeRates.find((r) => r.currency === engCurrency)
      : undefined;
    const rate = rateObj ? rateObj.rateToRIYAL : 1;
    const basePriceInSelectedCurrency =
      currency === "ریال"
        ? firstProd.basePriceRIYAL
        : firstProd.basePriceRIYAL / rate;

    let qty = 1;
    if (
      (firstProd.stockLevel === 0 ? "ORDER" : (firstProd.supplyType || "INVENTORY")) !== "ORDER" &&
      firstProd.stockLevel !== undefined
    ) {
      if (qty > firstProd.stockLevel) {
        const confirmQty = window.confirm(
          `موجودی کالای پیش‌فرض (${firstProd.displayName}) در انبار (${firstProd.stockLevel} ${firstProd.unit || "عدد"}) است.\nآیا می‌خواهید با وجود محدودیت موجودی، تعداد درخواستی ثبت شود؟`,
        );
        if (!confirmQty) {
          qty = firstProd.stockLevel;
        }
      }
    }

    const firstItem = items[0];
    const range =
      isEqualDelivery && firstItem ? firstItem.deliveryRange : "۳-۴";
    const unit =
      isEqualDelivery && firstItem ? firstItem.deliveryUnit : ("هفته" as const);
    const dtype =
      isEqualDelivery && firstItem ? firstItem.deliveryType : ("کاری" as const);
    const postfix =
      isEqualDelivery && firstItem
        ? firstItem.deliveryPostfix
        : "پس از تایید پیش فاکتور و دریافت پیش پرداخت";

    const newItems = [
      ...items,
      {
        productId: firstProd.id,
        productName: firstProd.displayName,
        productCode: firstProd.code,
        brand: firstProd.brand,
        quantity: qty,
        unitPriceRIYAL: 0,
        techSpecs: "",
        selectedImage:
          firstProd.images && firstProd.images.length > 0
            ? firstProd.images[0]
            : undefined,
        deliveryRange: range,
        deliveryUnit: unit,
        deliveryType: dtype,
        deliveryPostfix: postfix,
      },
    ];
    setItems(newItems);
    setNotes((prevNotes) =>
      updateNotesWithDelivery(prevNotes, newItems, isEqualDelivery),
    );
    setDeliveryDate(getDeliverySummary(newItems));
  };
  // Remove Item line
  const handleRemoveItemLine = (index: number) => {
    if (items.length === 1) return;
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
    setNotes((prevNotes) =>
      updateNotesWithDelivery(prevNotes, newItems, isEqualDelivery),
    );
    setDeliveryDate(getDeliverySummary(newItems));
  };
  // Handle Item delivery fields change
  const handleItemDeliveryFieldChange = (
    index: number,
    field: string,
    value: any,
  ) => {
    let newItems = [...items];
    if (isEqualDelivery) {
      newItems = newItems.map((item) => ({
        ...item,
        [field]: value,
      }));
    } else {
      newItems[index] = {
        ...newItems[index],
        [field]: value,
      };
    }
    setItems(newItems);
    setNotes((prevNotes) =>
      updateNotesWithDelivery(prevNotes, newItems, isEqualDelivery),
    );
    setDeliveryDate(getDeliverySummary(newItems));
  };

  // Toggle Equal Delivery Time Checkbox
  const handleToggleEqualDelivery = (checked: boolean) => {
    setIsEqualDelivery(checked);
    if (checked && items.length > 0) {
      const firstItem = items[0];
      const updatedItems = items.map((item) => ({
        ...item,
        deliveryRange: firstItem.deliveryRange || "۳-۴",
        deliveryUnit: firstItem.deliveryUnit || "هفته",
        deliveryType: firstItem.deliveryType || "کاری",
        deliveryPostfix:
          firstItem.deliveryPostfix ||
          "پس از تایید پیش فاکتور و دریافت پیش پرداخت",
      }));
      setItems(updatedItems);
      setNotes((prevNotes) =>
        updateNotesWithDelivery(prevNotes, updatedItems, checked),
      );
      setDeliveryDate(getDeliverySummary(updatedItems));
    } else if (!checked && items.length > 0) {
      setNotes((prevNotes) =>
        updateNotesWithDelivery(prevNotes, items, checked),
      );
    }
  };
  // Get product or variant price in proforma's active currency
  const getProductOrVariantPriceInProformaCurrency = (
    product: Product,
    variant?: ProductVariant
  ): number => {
    const proformaCurrencyEng = mapPersianCurrencyToEnglish(currency || "ریال");
    const proformaRateObj = proformaCurrencyEng
      ? exchangeRates?.find((r) => r.currency === proformaCurrencyEng)
      : undefined;
    const proformaRate = proformaRateObj ? proformaRateObj.rateToRIYAL : 1;

    // 1. If variant is specified, look at variant price
    if (variant) {
      if (variant.priceForeign) {
        const variantCurrencyEng = mapPersianCurrencyToEnglish(variant.currencyForeign || "یورو");
        const variantRateObj = variantCurrencyEng
          ? exchangeRates?.find((r) => r.currency === variantCurrencyEng)
          : undefined;
        const variantRate = variantRateObj ? variantRateObj.rateToRIYAL : 1;
        const priceInRial = variant.priceForeign * variantRate;

        if (currency === "ریال") {
          return Math.round(priceInRial);
        } else {
          return Math.round((priceInRial / proformaRate) * 100) / 100;
        }
      } else if (variant.priceRIYAL !== undefined) {
        if (currency === "ریال") {
          return variant.priceRIYAL;
        } else {
          return Math.round((variant.priceRIYAL / proformaRate) * 100) / 100;
        }
      }
    }

    // 2. If no variant or variant doesn't have a price, look at product price
    if (product.priceForeign) {
      const prodCurrencyEng = mapPersianCurrencyToEnglish(product.currencyForeign || "یورو");
      const prodRateObj = prodCurrencyEng
        ? exchangeRates?.find((r) => r.currency === prodCurrencyEng)
        : undefined;
      const prodRate = prodRateObj ? prodRateObj.rateToRIYAL : 1;
      const priceInRial = product.priceForeign * prodRate;

      if (currency === "ریال") {
        return Math.round(priceInRial);
      } else {
        return Math.round((priceInRial / proformaRate) * 100) / 100;
      }
    } else {
      const baseRial = product.basePriceRIYAL || 0;
      if (currency === "ریال") {
        return baseRial;
      } else {
        return Math.round((baseRial / proformaRate) * 100) / 100;
      }
    }
  };

  // Handle Item Select product
  const handleItemProductChange = (index: number, prodId: string) => {
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;

    const basePriceInSelectedCurrency = getProductOrVariantPriceInProformaCurrency(prod);

    const newItems = [...items];

    let currentQty = newItems[index].quantity;
    const effectiveSupplyType = prod.stockLevel === 0 ? "ORDER" : (prod.supplyType || "INVENTORY");
    if (effectiveSupplyType !== "ORDER" && prod.stockLevel !== undefined) {
      if (currentQty > prod.stockLevel) {
        const confirmQty = window.confirm(
          `موجودی کالا در انبار (${prod.stockLevel} ${prod.unit || "عدد"}) کمتر از تعداد درخواستی (${currentQty}) است.\nآیا می‌خواهید با وجود کسر موجودی، مقدار درخواستی ثبت شود؟`,
        );
        if (!confirmQty) {
          currentQty = prod.stockLevel;
        }
      }
    }

    newItems[index] = {
      productId: prodId,
      variantId: undefined, // Reset variant if product changes
      productName: prod.displayName,
      productCode: prod.code,
      brand: prod.brand,
      supplyMethod: prod.supplyType === "ORDER" ? "ORDER" : "INVENTORY",
      quantity: currentQty,
      unitPriceRIYAL: basePriceInSelectedCurrency,
      techSpecs: newItems[index].techSpecs || "",
      selectedImage:
        prod.images && prod.images.length > 0 ? prod.images[0] : undefined,
    };
    setItems(newItems);
  };

  const handleItemVariantChange = (index: number, variantId: string) => {
    const newItems = [...items];
    const item = newItems[index];
    const prod = products.find((p) => p.id === item.productId);
    if (!prod || !prod.hasVariants || !prod.variants) return;

    const variant = prod.variants.find((v) => v.id === variantId);
    if (!variant) return;

    let currentQty = item.quantity;
    const effectiveSupplyType = variant.stockLevel === 0 ? "ORDER" : (prod.supplyType || "INVENTORY");
    if (effectiveSupplyType !== "ORDER" && variant.stockLevel !== undefined) {
      if (currentQty > variant.stockLevel) {
        const confirmQty = window.confirm(
          `موجودی کالا در انبار (${variant.stockLevel} ${prod.unit || "عدد"}) کمتر از تعداد درخواستی (${currentQty}) است.\nآیا می‌خواهید با وجود کسر موجودی، مقدار درخواستی ثبت شود؟`
        );
        if (!confirmQty) {
          currentQty = variant.stockLevel;
        }
      }
    }

    let currentSpecs = item.techSpecs || "";
    const featureNames = prod.features?.map(f => f.name) || Object.keys(variant.attributes);
    const filteredLines = currentSpecs.split('\n').filter(line => {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('مشخصات:')) return false;
      return !featureNames.some(fn => trimmedLine.startsWith(`${fn}:`));
    });
    
    const newGeneratedLines = Object.entries(variant.attributes).map(([k, v]) => `${k}: ${v}`);
    const newTechSpecs = [...filteredLines, ...newGeneratedLines].filter(Boolean).join('\n');

    const variantPrice = getProductOrVariantPriceInProformaCurrency(prod, variant);

    newItems[index] = {
      ...item,
      variantId: variant.id,
      productCode: variant.sku,
      quantity: currentQty,
      supplyMethod: effectiveSupplyType === "ORDER" ? "ORDER" : "INVENTORY",
      unitPriceRIYAL: variantPrice || item.unitPriceRIYAL,
      techSpecs: newTechSpecs,
    };
    setItems(newItems);
  };

  // Handle Item fields modifications (generic to support strings or numbers)
  const handleItemFieldChange = (index: number, field: string, value: any) => {
    const newItems = [...items];
    let sanitizedVal = value;
    if (field === "quantity" || field === "unitPriceRIYAL") {
      sanitizedVal = Math.max(0, Number(value));

      if (field === "quantity" && newItems[index].productId) {
        const prod = products.find((p) => p.id === newItems[index].productId);
        if (
          prod &&
          newItems[index].supplyMethod !== "ORDER" &&
          prod.stockLevel !== undefined
        ) {
          if (sanitizedVal > prod.stockLevel) {
            const confirmQty = window.confirm(
              `موجودی کالا در انبار (${prod.stockLevel} ${prod.unit || "عدد"}) کمتر از تعداد درخواستی (${sanitizedVal}) است.\nآیا می‌خواهید با وجود کسر موجودی، مقدار درخواستی ثبت شود؟`,
            );
            if (!confirmQty) {
              sanitizedVal = prod.stockLevel;
            }
          }
        }
      }
    }
    newItems[index] = {
      ...newItems[index],
      [field]: sanitizedVal,
    };
    setItems(newItems);
  };
  // Calculate totals for Form (now calculated entirely in selected currency!)
  const subTotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceRIYAL,
    0,
  );
  const discountAmount = Math.round(subTotal * (discountPercent / 100));
  const afterDiscount = subTotal - discountAmount;
  const taxAmount = Math.round(afterDiscount * (taxPercent / 100));
  const finalAmount = afterDiscount + taxAmount;
  // Handle Save (Add / Update)
  const handleSaveProforma = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return;

    // Project-Proforma Customer Mismatch Check on Save
    if (projectId) {
      const selectedProj = projects.find((p) => p.id === projectId);
      if (selectedProj && selectedProj.customerId !== customerId) {
        const confirmProjCustomer = window.confirm(
          `هشدار مغایرت مشتری:\n` +
            `خریدار انتخاب شده در پیش‌فاکتور با مشتری ثبت شده در پروژه (${selectedProj.customerName}) مغایرت دارد.\n` +
            `آیا اطمینان دارید که می‌خواهید پیش‌فاکتور را برای خریدار متفاوتی ثبت کنید؟`,
        );
        if (!confirmProjCustomer) {
          return;
        }
      }
    }

    const selectedCustObj = customers.find((c) => c.id === customerId);
    const isLegal = selectedCustObj?.customerType === "حقوقی";
    const contactObj = isLegal
      ? customers.find((c) => c.id === contactCustomerId)
      : null;
    const finalContactName = contactObj
      ? `${contactObj.firstName || ""} ${contactObj.lastName || ""}`.trim()
      : undefined;
    const customerName = selectedCustObj?.companyName || "مشتری نامشخص";
    const projName = projects.find((p) => p.id === projectId)?.name || "";
    // Reconstruct items with subtotal price and correct item ID structure
    const formattedItems: ProformaItem[] = items.map((item, i) => ({
      id: `pfi-${Date.now()}-${i}`,
      ...item,
      totalPriceRIYAL: item.quantity * item.unitPriceRIYAL,
    }));

    const finalSentMethod = status === "ارسال شده" ? (sentMethodType === "سایر" ? customSentMethod : sentMethodType) : undefined;
    const finalSentRecipients = status === "ارسال شده" ? selectedSentRecipients : undefined;

    if (status === "ارسال شده") {
      if (!finalSentMethod || !finalSentMethod.trim()) {
        alert("لطفاً طریقه ارسال پیش‌فاکتور را مشخص کنید.");
        return;
      }
      if (!finalSentRecipients || finalSentRecipients.length === 0) {
        alert("لطفاً حداقل یک شخص دریافت‌کننده (مشتری حقیقی) را انتخاب کنید.");
        return;
      }
    }

    if (editingProforma) {
      updateProforma({
        ...editingProforma,
        proformaType,
        customerId,
        customerName,
        contactCustomerId: isLegal ? contactCustomerId : undefined,
        contactName: isLegal ? finalContactName : undefined,
        contactPrefix: contactPrefix || undefined,
        projectId: projectId || undefined,
        projectName: projectId ? projName : undefined,
        issueDate,
        expiryDate,
        deliveryDate,
        status,
        currency,
        historicalExchangeRate:
          currency === "ریال" ? 1 : Number(historicalExchangeRate || 0),
        items: formattedItems,
        totalAmount: subTotal,
        discountPercent,
        discountAmount,
        taxPercent,
        taxAmount,
        finalAmount,
        notes,
        sentMethod: finalSentMethod,
        sentRecipients: finalSentRecipients,
      });
      setEditingProforma(null);
    } else {
      addProforma({
        proformaType,
        customerId,
        customerName,
        contactCustomerId: isLegal ? contactCustomerId : undefined,
        contactName: isLegal ? finalContactName : undefined,
        contactPrefix: contactPrefix || undefined,
        projectId: projectId || undefined,
        projectName: projectId ? projName : undefined,
        issueDate,
        expiryDate,
        deliveryDate,
        status,
        currency,
        historicalExchangeRate:
          currency === "ریال" ? 1 : Number(historicalExchangeRate || 0),
        items: formattedItems,
        totalAmount: subTotal,
        discountPercent,
        discountAmount,
        taxPercent,
        taxAmount,
        finalAmount,
        notes,
        sentMethod: finalSentMethod,
        sentRecipients: finalSentRecipients,
      });
    }
    setShowCreateModal(false);
  };
  // Trigger Status adjustment modal
  const handleOpenStatusChange = (
    pfId: string,
    currentStatus: Proforma["status"],
  ) => {
    const targetPf = proformas.find((p) => p.id === pfId);
    setStatusTargetId(pfId);
    setNewStatusSelected(currentStatus);
    setLossReason("");

    // Initialize sending details if they exist in targetPf
    if (targetPf && targetPf.status === "ارسال شده") {
      if (targetPf.sentMethod) {
        const commonMethods = settings?.dropdownItems?.proformaSentMethods || ["ایمیل", "واتس‌اپ", "تلگرام", "پست", "حضوری", "سایر"];
        if (commonMethods.includes(targetPf.sentMethod)) {
          setSentMethodType(targetPf.sentMethod);
          setCustomSentMethod("");
        } else {
          setSentMethodType("سایر");
          setCustomSentMethod(targetPf.sentMethod);
        }
      } else {
        setSentMethodType((settings?.dropdownItems?.proformaSentMethods || [])[0] || "ایمیل");
        setCustomSentMethod("");
      }
      setSelectedSentRecipients(targetPf.sentRecipients || []);
    } else {
      setSentMethodType((settings?.dropdownItems?.proformaSentMethods || [])[0] || "ایمیل");
      setCustomSentMethod("");
      setSelectedSentRecipients([]);
    }
    setRecipientSearchTerm("");
    setShowStatusModal(true);
  };
  const handleSaveStatusChange = (e: React.FormEvent) => {
    e.preventDefault();

    const finalSentMethod = sentMethodType === "سایر" ? customSentMethod : sentMethodType;

    if (newStatusSelected === "ارسال شده") {
      if (!finalSentMethod || !finalSentMethod.trim()) {
        alert("لطفاً طریقه ارسال پیش‌فاکتور را مشخص کنید.");
        return;
      }
      if (selectedSentRecipients.length === 0) {
        alert("لطفاً حداقل یک شخص دریافت‌کننده (مشتری حقیقی) را انتخاب کنید.");
        return;
      }
    }

    updateProformaStatus(
      statusTargetId,
      newStatusSelected,
      newStatusSelected === "باخته" ? lossReason : undefined,
      newStatusSelected === "ارسال شده" ? finalSentMethod : undefined,
      newStatusSelected === "ارسال شده" ? selectedSentRecipients : undefined,
    );
    setShowStatusModal(false);
  };
  // Open Preview layout
  const handleOpenPrint = (pf: Proforma) => {
    setSelectedProforma(pf);
    setOverrideShowBrand(!!settings.showProductBrandInDocuments);
    setShowPrintView(true);
  };
  const handleCopyProforma = (pf: Proforma) => {
    const copiedItems: ProformaItem[] = pf.items.map((item, i) => ({
      ...item,
      id: `pfi-${Date.now()}-${i}`,
      status: "جاری",
      lossReason: undefined,
    }));
    addProforma({
      proformaType: pf.proformaType || "FINANCIAL",
      customerId: pf.customerId,
      customerName: pf.customerName,
      contactCustomerId: pf.contactCustomerId,
      contactName: pf.contactName,
      contactPrefix: pf.contactPrefix,
      projectId: pf.projectId,
      projectName: pf.projectName,
      issueDate: pf.issueDate,
      expiryDate: pf.expiryDate,
      deliveryDate: pf.deliveryDate,
      status: "پیش‌نویس",
      currency: pf.currency || "ریال",
      items: copiedItems,
      totalAmount: pf.totalAmount,
      discountPercent: pf.discountPercent,
      discountAmount: pf.discountAmount,
      taxPercent: pf.taxPercent,
      taxAmount: pf.taxAmount,
      finalAmount: pf.finalAmount,
      notes: pf.notes,
      customValues: pf.customValues ? { ...pf.customValues } : undefined,
    });
  };
  // Filter proformas
  const filteredProformas = proformas.filter((p) => {
    const matchesSearch =
      (p.proformaNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.projectName &&
        p.projectName.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus =
      selectedStatus === "all" || p.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });
  const getStatusColor = (st: Proforma["status"]) => {
    switch (st) {
      case "پیش‌نویس":
        return "bg-slate-100 text-slate-700 border-slate-200";
      case "ارسال شده":
        return "bg-sky-50 text-sky-700 border-sky-200";
      case "تأیید شده (برنده)":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "نیمه برنده":
        return "bg-teal-50 text-teal-700 border-teal-200";
      case "لغو شده":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "باخته":
        return "bg-red-50 text-red-700 border-red-200";
    }
  };
  const getProjectDetails = (projId: string) => {
    return projects.find((p) => p.id === projId);
  };
  const getProjectStatusColor = (st: Project["status"]) => {
    switch (st) {
      case "جدید":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "در حال مذاکره":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "ارائه پیش‌فاکتور":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "برنده (موفق)":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "باخته":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "لغو شده":
        return "bg-slate-100 text-slate-700 border-slate-200";
      case "نیمه برنده":
        return "bg-teal-50 text-teal-700 border-teal-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };
  // Format Persian currency
  const formatToman = (num: number) => {
    return (num / 10).toLocaleString("fa-IR") + " تومان";
  };
  const formatRawRIYAL = (num: number) => {
    return num.toLocaleString("fa-IR") + " ریال";
  };
  const mapPersianCurrencyToEnglish = (
    cur: string,
  ): "USD" | "EUR" | "AED" | "CNY" | undefined => {
    if (cur === "دلار") return "USD";
    if (cur === "یورو") return "EUR";
    if (cur === "درهم") return "AED";
    if (cur === "یوان") return "CNY";
    return undefined;
  };
  const formatCurrency = (num: number, cur?: Proforma["currency"]) => {
    const unit = cur || "ریال";
    return num.toLocaleString("fa-IR") + " " + unit;
  };
  const activeTemplate = settings?.proformaTemplates?.[0] || {
    name: "قالب پیش‌فرض رسمی",
    companyName: "ابزار تامین ارشیا (سهامی خاص)",
    registrationNumber: "۱۰۴۸۲۷",
    nationalCode: "۱۰۲۶۰۴۸۲۷۳۱",
    economicCode: "۴۱۱۴۸۳۹۲۷۴۸۲",
    phone: "02188899000",
    email: "sales@abzartamin.com",
    website: "www.abzartamin.com",
    address: "تهران، خیابان ولیعصر، برج سپهر، طبقه ۸، واحد ۸۰۴",
    titleColor: "#0ea5e9",
    documentTitle: "پیش‌فاکتور رسمی",
    headerText:
      "مفتخریم پیشنهاد قیمت تجهیزات ابزار دقیق مورد نیاز آن مجموعه محترم را به شرح زیر تقدیم داریم.",
    termsAndConditions:
      "۱. مدت اعتبار این پیشنهاد ۱۰ روز کاری از تاریخ صدور می‌باشد.\n۲. زمان تحویل کالاهای موجود در انبار، ۲ روز کاری و کالاهای سفارشی ۶ هفته پس از دریافت پیش‌پرداخت می‌باشد.\n۳. گارانتی کلیه تجهیزات به مدت ۱۲ ماه شمسی و خدمات پس از فروش به مدت ۵ سال ارائه می‌گردد.",
    footerText:
      "از حسن توجه و اعتماد شما به شرکت ابزار تامین ارشیا صمیمانه سپاسگزاریم.",
    signatureLabel1: "کارشناس فروش - محمد توکل مقدم",
    signatureLabel2: "مدیرعامل - علیرضا ارشیا",
    showLogo: true,
    showTerms: true,
    showSignatures: true,
    showTotals: true,
  };
  const downloadProformaHTML = (pf: Proforma) => {
    const template = activeTemplate;
    if (!template) return;
    const customerObj = customers.find((c) => c.id === pf.customerId);
    const creatorUser = pf.creatorId
      ? users.find((u) => u.id === pf.creatorId)
      : currentUser;
    const targetCurrency = pf.currency || "ریال";
    const engCurrency = mapPersianCurrencyToEnglish(targetCurrency);
    const currencyObj = engCurrency
      ? exchangeRates.find((r) => r.currency === engCurrency)
      : undefined;
    const currentRate = currencyObj ? currencyObj.rateToRIYAL : 1;
    const equivalentRiyal =
      pf.finalAmount * (targetCurrency === "ریال" ? 1 : currentRate);
    const equivalentToman = Math.round(equivalentRiyal / 10);
    const itemsRows = pf.items
      .map((item, index) => {
        const prod = products.find((p) => p.id === item.productId);
        const imgToRender =
          item.selectedImage && item.selectedImage !== "none"
            ? item.selectedImage
            : item.selectedImage !== "none" &&
                prod?.images &&
                prod.images.length > 0
              ? prod.images[0]
              : undefined;
        return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px; text-align: center; font-family: monospace;">${index + 1}</td>
        <td style="padding: 12px;">
          <div style="display: flex; align-items: center; gap: 12px; text-align: right;">
            ${
              imgToRender
                ? `
              <img src="${imgToRender}" alt="${item.productName}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1; flex-shrink: 0;" referrerPolicy="no-referrer" />
            `
                : ""
            }
            <div style="font-weight: bold; color: #1e293b;">${item.productName}${overrideShowBrand && item.brand ? ` (${item.brand})` : ""}</div>
          </div>
        </td>
        <td style="padding: 12px; font-size: 11px; color: #475569; white-space: pre-line; line-height: 1.4; text-align: left; direction: ltr;">
          ${item.techSpecs || "-"}
        </td>
        <td style="padding: 12px; text-align: center; font-family: monospace;">${item.quantity}</td>
        <td style="padding: 12px; text-align: center;">${prod?.unit || "عدد"}</td>
        ${
          pf.proformaType !== "TECHNICAL"
            ? `
        <td style="padding: 12px; text-align: left; font-family: monospace;">${item.unitPriceRIYAL.toLocaleString("fa-IR")}</td>
        <td style="padding: 12px; text-align: left; font-family: monospace;">${item.totalPriceRIYAL.toLocaleString("fa-IR")}</td>
        `
            : ""
        }
      </tr>
      `;
      })
      .join("");
    const formattedToman = formatToman(pf.finalAmount);
    const htmlContent = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>پیش‌فاکتور ${pf.proformaNumber}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap');
        body {
            font-family: 'Vazirmatn', Tahoma, sans-serif;
            background-color: #f8fafc;
            color: #1e293b;
            margin: 0;
            padding: 40px;
            direction: rtl;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            padding: 40px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid ${template.titleColor};
            padding-bottom: 20px;
            margin-bottom: 20px;
        }
        .logo-box {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .logo {
            width: 48px;
            height: 48px;
            background-color: #0ea5e9;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 20px;
            border-radius: 8px;
        }
        .company-name {
            font-weight: bold;
            font-size: 16px;
            color: #1e293b;
            margin: 0;
        }
        .subtitle {
            font-size: 11px;
            color: #94a3b8;
            margin: 0;
        }
        .title-box {
            text-align: center;
        }
        .title {
            font-size: 22px;
            font-weight: 800;
            color: ${template.titleColor};
            margin: 0;
        }
        .doc-specs {
            font-size: 13px;
            color: #475569;
            text-align: left;
        }
        .specs-item {
            margin-bottom: 4px;
        }
        .specs-label {
            font-weight: bold;
            color: #0f172a;
        }
        .section-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 14px;
            background-color: #f8fafc;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .section-title {
            font-weight: bold;
            font-size: 12px;
            color: #334155;
            padding-bottom: 6px;
            border-bottom: 1px dashed #cbd5e1;
            margin-top: 0;
            margin-bottom: 10px;
        }
        .details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 14px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .grid-compact {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px 10px;
            font-size: 11px;
            line-height: 1.5;
        }
        .full-width {
            grid-column: span 2;
        }
        .table-container {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
            margin-bottom: 14px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            text-align: right;
            font-size: 12px;
            page-break-inside: auto;
        }
        thead {
            display: table-header-group;
        }
        tr {
            page-break-inside: avoid;
            page-break-after: auto;
        }
        th {
            background-color: #f1f5f9;
            color: #475569;
            font-weight: bold;
            padding: 10px;
            border-bottom: 1px solid #e2e8f0;
        }
        .financial-grid {
            display: grid;
            grid-template-columns: 1.2fr 0.8fr;
            gap: 14px;
            margin-bottom: 20px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .notes-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            background-color: #f8fafc;
            font-size: 12px;
            color: #475569;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .totals-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            background-color: #f8fafc;
            font-size: 12px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .totals-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 0;
            border-bottom: 1px solid #e2e8f0;
        }
        .totals-row:last-child {
            border-bottom: none;
        }
        .final-amount {
            font-weight: bold;
            font-size: 14px;
            color: ${template.titleColor};
            border-top: 2px solid #e2e8f0;
            padding-top: 8px;
            margin-top: 4px;
        }
        .signatures {
            display: flex;
            justify-content: flex-end;
            margin-top: 25px;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .signature-box {
            padding-top: 20px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .signature-title {
            font-size: 11px;
            color: #64748b;
            font-weight: bold;
            margin-bottom: 30px;
        }
        .signature-name {
            font-weight: bold;
            font-size: 12px;
            color: #334155;
        }
        .buyer-horizontal-row {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 10px 15px;
            font-size: 11px;
            line-height: 1.5;
        }
        .buyer-horizontal-row > div {
            flex: 1;
            min-width: 140px;
        }
        .print-footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background-color: #ffffff;
            border-top: 1px solid #cbd5e1;
            padding: 10px 40px;
            font-size: 10px;
            color: #64748b;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
        }
        .print-footer-info {
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
        }
        .page-number:after {
            content: "صفحه " counter(page);
        }
        @page {
            counter-reset: page 1;
        }
        @media print {
            body {
                counter-reset: page 1;
                background-color: #ffffff;
                padding: 0;
                padding-bottom: 60px;
            }
            .container {
                box-shadow: none;
                padding: 0;
            }
            .print-footer {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                border-top: 1px solid #94a3b8;
                padding: 10px 0;
                display: flex !important;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="logo-box">
                ${
                  template.showLogo
                    ? `
                ${
                  template.logoUrl
                    ? `
                    <img src="${template.logoUrl}" alt="${template.companyName}" style="width: 48px; height: 48px; object-fit: contain; border-radius: 8px; border: 1px solid #cbd5e1; background-color: #ffffff;" referrerPolicy="no-referrer" />
                `
                    : `
                    <div class="logo">ATA</div>
                `
                }
                <div>
                    <h4 class="company-name">${template.companyName}</h4>
                    <p class="subtitle">تامین تجهیزات اتوماسیون و ابزاردقیق</p>
                </div>
                `
                    : ""
                }
            </div>
            <div class="title-box">
                <h1 class="title">${(template.documentTitle || "").replace("رسمی", "").trim()}</h1>
            </div>
            <div class="doc-specs">
                <div class="specs-item"><span class="specs-label">شماره پیش‌فاکتور:</span> ${pf.proformaNumber}</div>
                <div class="specs-item"><span class="specs-label">تاریخ صدور:</span> ${pf.issueDate}</div>
                <div class="specs-item"><span class="specs-label">تاریخ اعتبار:</span> ${pf.expiryDate}</div>
            </div>
        </div>
        <!-- Buyer details horizontally in a single row -->
        <div class="section-card" style="margin-bottom: 14px;">
            <h4 class="section-title">مشخصات خریدار</h4>
            <div class="buyer-horizontal-row">
                <div><span style="color: #64748b;">نام خریدار / شرکت:</span> <strong>${customerObj?.customerType === "حقیقی" && pf.contactPrefix ? pf.contactPrefix + " " : ""}${pf.customerName}</strong></div>
                <div><span style="color: #64748b;">مخاطب:</span> ${customerObj?.customerType === "حقوقی" && pf.contactPrefix ? pf.contactPrefix + " " : ""}${pf.contactName || (customerObj ? `${customerObj.contactName || ""} ${customerObj.contactLastName || ""}`.trim() : "") || "نماینده خریدار"}</div>
            </div>
        </div>
        <!-- Items Table -->
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th style="width: 50px; text-align: center;">ردیف</th>
                        <th>نوع کالا</th>
                        <th style="text-align: left;">توضیحات فنی</th>
                        <th style="text-align: center; width: 70px;">تعداد</th>
                        <th style="text-align: center; width: 70px;">واحد</th>
                        ${
                          pf.proformaType !== "TECHNICAL"
                            ? `
                        <th style="text-align: left;">بهای واحد (${targetCurrency})</th>
                        <th style="text-align: left;">بهای کل (${targetCurrency})</th>
                        `
                            : ""
                        }
                    </tr>
                </thead>
                <tbody>
                    ${itemsRows}
                </tbody>
            </table>
        </div>
        <!-- Financial Calculations -->
        <div class="${pf.proformaType === "TECHNICAL" ? "" : "financial-grid"}">
            <div class="notes-card" style="${pf.proformaType === "TECHNICAL" ? "width: 100%;" : ""}">
                <div style="font-weight: bold; color: #334155; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">توضیحات و شرایط فروش</div>
                <div style="white-space: pre-line; line-height: 1.6; font-size: 12px;">${pf.notes}</div>
            </div>
            ${
              pf.proformaType !== "TECHNICAL"
                ? `
            <div class="totals-card">
                <div class="totals-row">
                    <span style="color: #64748b;">جمع ناخالص ردیف‌ها:</span>
                    <strong style="font-family: monospace;">${pf.totalAmount.toLocaleString("fa-IR")} ${targetCurrency}</strong>
                </div>
                <div class="totals-row">
                    <span style="color: #64748b;">تخفیف کلی (${pf.discountPercent}%):</span>
                    <strong style="font-family: monospace; color: #dc2626;">-${pf.discountAmount.toLocaleString("fa-IR")} ${targetCurrency}</strong>
                </div>
                <div class="totals-row">
                    <span style="color: #64748b;">مالیات بر ارزش افزوده (${pf.taxPercent}%):</span>
                    <strong style="font-family: monospace;">+${pf.taxAmount.toLocaleString("fa-IR")} ${targetCurrency}</strong>
                </div>
                <div class="totals-row final-amount">
                    <span>مبلغ قابل پرداخت نهایی:</span>
                    <span style="font-family: monospace;">${pf.finalAmount.toLocaleString("fa-IR")} ${targetCurrency}</span>
                </div>
                <div style="text-align: left; font-size: 11px; color: #64748b; font-weight: bold; margin-top: 8px; line-height: 1.5;">
                    ${
                      targetCurrency !== "ریال"
                        ? `
                      نرخ تسعیر روز ${targetCurrency}: ${currentRate.toLocaleString("fa-IR")} ریال <br/>
                      معادل ریالی نهایی: ${equivalentRiyal.toLocaleString("fa-IR")} ریال (${equivalentToman.toLocaleString("fa-IR")} تومان)
                    `
                        : `
                      معادل ریالی نهایی: ${formattedToman}
                    `
                    }
                </div>
            </div>
            `
                : ""
            }
        </div>
        <!-- Signatures -->
        ${
          template.showSignatures
            ? `
        <div class="signatures">
            <div class="signature-box" style="width: 320px; border: 1px solid #f1f5f9; border-radius: 12px; padding: 12px; background-color: #fafafa;">
                <div class="signature-title" style="margin-bottom: 8px;">مهر و امضای صادرکننده پیش‌فاکتور</div>
                <div class="signature-name" style="margin-bottom: 12px;">${creatorUser ? creatorUser.fullName : template.signatureLabel1}</div>
                <div style="margin-top: 10px;">
                    ${
                      template.companySealUrl
                        ? `
                        <div style="display: flex; justify-content: space-evenly; align-items: center; gap: 10px; height: 100px; background-color: #ffffff; border-radius: 8px; border: 1px dashed #cbd5e1; padding: 4px;">
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1;">
                                <span style="font-size: 8px; color: #94a3b8; font-weight: bold; margin-bottom: 4px;">امضای صادرکننده</span>
                                ${
                                  creatorUser && creatorUser.signatureImage
                                    ? `
                                    <img src="${creatorUser.signatureImage}" alt="Signature" style="max-height: 70px; max-width: 120px; object-fit: contain;" referrerPolicy="no-referrer" />
                                `
                                    : `
                                    <span style="font-size: 10px; color: #cbd5e1; font-weight: bold;">فاقد امضا</span>
                                `
                                }
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; border-right: 1px solid #f1f5f9; padding-right: 8px;">
                                <span style="font-size: 8px; color: #94a3b8; font-weight: bold; margin-bottom: 4px;">مهر شرکت</span>
                                <img src="${template.companySealUrl}" alt="Company Seal" style="max-height: 70px; max-width: 110px; object-fit: contain; transform: rotate(-3deg);" referrerPolicy="no-referrer" />
                            </div>
                        </div>
                    `
                        : `
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100px; background-color: #ffffff; border-radius: 8px; border: 1px dashed #cbd5e1; padding: 4px;">
                            <span style="font-size: 8px; color: #94a3b8; font-weight: bold; margin-bottom: 4px;">امضای صادرکننده</span>
                            ${
                              creatorUser && creatorUser.signatureImage
                                ? `
                                <img src="${creatorUser.signatureImage}" alt="Signature" style="max-height: 75px; max-width: 180px; object-fit: contain;" referrerPolicy="no-referrer" />
                            `
                                : `
                                <span style="font-size: 10px; color: #cbd5e1; font-weight: bold;">فاقد امضا</span>
                            `
                            }
                        </div>
                    `
                    }
                </div>
            </div>
        </div>
        `
            : ""
        }
    </div>
    <!-- Running print footer repeating on all pages when printing -->
    <div class="print-footer">
        <div class="print-footer-info">
            <div><strong>آدرس شرکت:</strong> ${template.address || "-"}</div>
            <div><strong>تلفن تماس:</strong> ${template.phone || "-"}</div>
            <div><strong>پست الکترونیکی:</strong> ${template.email || "-"}</div>
        </div>
        <div class="page-number"></div>
    </div>
    <!-- Auto Print Script -->
    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 300);
        };
    </script>
</body>
</html>
    `;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `پیش_فاکتور_${pf.proformaNumber}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  // Grouping proformas by project
  const proformasByProject = filteredProformas.reduce(
    (acc, pf) => {
      const pId = pf.projectId || "no-project";
      if (!acc[pId]) {
        acc[pId] = [];
      }
      acc[pId].push(pf);
      return acc;
    },
    {} as Record<string, Proforma[]>,
  );
  // Sorting within each project group: latest version of proforma on top
  Object.keys(proformasByProject).forEach((pId) => {
    proformasByProject[pId].sort((a, b) => {
      const dateCompare = b.issueDate.localeCompare(a.issueDate);
      if (dateCompare !== 0) return dateCompare;
      return b.proformaNumber.localeCompare(a.proformaNumber);
    });
  });
  // Project IDs ordered: real projects first (by code/name), then 'no-project'
  const projectIdsOrdered = Object.keys(proformasByProject).sort((a, b) => {
    if (a === "no-project") return 1;
    if (b === "no-project") return -1;
    // Sort real projects based on code descending or name
    const projA = projects.find((p) => p.id === a);
    const projB = projects.find((p) => p.id === b);
    if (!projA) return 1;
    if (!projB) return -1;
    return projB.code.localeCompare(projA.code);
  });
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Print View Overlay */}
      {showPrintView && selectedProforma && activeTemplate && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs overflow-y-auto p-4 md:p-8 z-50 flex justify-center">
          <div className="bg-white text-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl p-6 md:p-10 flex flex-col justify-between h-fit min-h-screen text-right animate-scale-in">
            {/* Action Bar (Print / Close) */}
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 pb-6 mb-6 border-b border-slate-200 print:hidden">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => downloadProformaHTML(selectedProforma)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-emerald-600/10"
                  title="دانلود فایل بهینه برای چاپ و خروجی تمیز بدون محدودیت مرورگر"
                >
                  <FileSpreadsheet size={16} />
                  خروجی فایل چاپی مستقل (دانلود HTML)
                </button>

                {/* Instant Brand display toggle */}
                <label className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-150 cursor-pointer select-none hover:bg-slate-100 transition">
                  <input
                    type="checkbox"
                    checked={overrideShowBrand}
                    onChange={(e) => setOverrideShowBrand(e.target.checked)}
                    className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>نمایش برند کالا در این پیش‌فاکتور</span>
                </label>
              </div>
              <button
                onClick={() => {
                  setShowPrintView(false);
                  onClearInitialPrintDocId?.();
                }}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl text-sm font-semibold text-slate-600 transition"
              >
                بستن پیش‌نمایش
              </button>
            </div>
            {/* Printable Document Sheet */}
            <div className="print-sheet space-y-6">
              {/* Document Header */}
              <div
                className="flex flex-col md:flex-row justify-between items-center md:items-start text-center md:text-right gap-4 border-b-2 pb-4"
                style={{ borderColor: activeTemplate.titleColor }}
              >
                {/* Logo Placeholder */}
                {activeTemplate.showLogo && (
                  <div className="flex items-center gap-3">
                    {activeTemplate.logoUrl ? (
                      <img
                        src={activeTemplate.logoUrl}
                        alt={activeTemplate.companyName}
                        className="w-12 h-12 object-contain rounded-lg border border-slate-200 bg-white"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-sky-500 text-white flex items-center justify-center font-bold text-xl rounded-lg">
                        ATA
                      </div>
                    )}
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">
                        {activeTemplate.companyName}
                      </h4>
                      <p className="text-[9px] text-slate-400">
                        تامین تجهیزات اتوماسیون و ابزاردقیق
                      </p>
                    </div>
                  </div>
                )}
                {/* Title */}
                <div className="text-center">
                  <h1
                    className="text-xl font-extrabold"
                    style={{ color: activeTemplate.titleColor }}
                  >
                    {(activeTemplate.documentTitle || "")
                      .replace("رسمی", "")
                      .trim()}
                  </h1>
                  <p className="text-[10px] text-slate-400 mt-1">
                    سامانه صدور خودکار Arshia ERP
                  </p>
                </div>
                {/* Doc Specs */}
                <div className="text-xs space-y-1 text-slate-600 font-mono">
                  <div>
                    شماره پیش‌فاکتور:{" "}
                    <span className="font-bold text-slate-900">
                      {selectedProforma.proformaNumber}
                    </span>
                  </div>
                  <div>
                    تاریخ صدور: <span>{selectedProforma.issueDate}</span>
                  </div>
                  <div>
                    تاریخ اعتبار: <span>{selectedProforma.expiryDate}</span>
                  </div>
                </div>
              </div>
              {/* Buyer details - designed horizontally in a single row */}
              {(() => {
                const customerObj = customers.find(
                  (c) => c.id === selectedProforma.customerId,
                );
                return (
                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/20">
                    <h4 className="font-bold text-xs text-slate-700 pb-1.5 border-b border-dashed border-slate-200 mb-3">
                      مشخصات خریدار
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-400 font-medium block mb-1">
                          نام خریدار / شرکت:
                        </span>
                        <span className="font-bold text-slate-800">
                          {customerObj?.customerType === "حقیقی" &&
                          selectedProforma.contactPrefix
                            ? `${selectedProforma.contactPrefix} `
                            : ""}
                          {selectedProforma.customerName}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-medium block mb-1">
                          مخاطب:
                        </span>
                        <span className="font-medium text-slate-800">
                          {customerObj?.customerType === "حقوقی" &&
                          selectedProforma.contactPrefix
                            ? `${selectedProforma.contactPrefix} `
                            : ""}
                          {selectedProforma.contactName ||
                            (customerObj
                              ? `${customerObj.contactName || ""} ${customerObj.contactLastName || ""}`.trim()
                              : "") ||
                            "نماینده خریدار"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-right text-xs border-collapse min-w-[650px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="p-3 text-center w-12">ردیف</th>
                      <th className="p-3">نوع کالا</th>
                      <th className="p-3 text-left">توضیحات فنی</th>
                      <th className="p-3 text-center">تعداد</th>
                      <th className="p-3 text-center">واحد</th>
                      {selectedProforma.proformaType !== "TECHNICAL" && (
                        <>
                          <th className="p-3 text-left">
                            بهای واحد ({selectedProforma.currency || "ریال"})
                          </th>
                          <th className="p-3 text-left">
                            بهای کل ({selectedProforma.currency || "ریال"})
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedProforma.items.map((item, index) => {
                      const prod = products.find(
                        (p) => p.id === item.productId,
                      );
                      const imgToRender =
                        item.selectedImage && item.selectedImage !== "none"
                          ? item.selectedImage
                          : item.selectedImage !== "none" &&
                              prod?.images &&
                              prod.images.length > 0
                            ? prod.images[0]
                            : undefined;
                      return (
                        <tr key={index} className="hover:bg-slate-50/30">
                          <td className="p-3 text-center font-mono">
                            {index + 1}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {imgToRender && (
                                <img
                                  src={imgToRender}
                                  alt={item.productName}
                                  className="w-10 h-10 object-cover rounded-lg border border-slate-200 bg-slate-50 flex-shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              <div className="font-bold text-slate-800">
                                {item.productName}
                                {overrideShowBrand && item.brand && (
                                  <span className="text-xs text-indigo-600 font-semibold mr-1">
                                    ({item.brand})
                                  </span>
                                )}
                                {item.tagNumber && (
                                  <span className="text-[10px] text-rose-600 font-mono font-bold bg-rose-50 border border-rose-100 px-1 py-0.2 rounded mr-1.5">
                                    تگ: {item.tagNumber}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-slate-600 whitespace-pre-line leading-relaxed text-left [direction:ltr] text-[11px]">
                            {item.techSpecs || "-"}
                          </td>
                          <td className="p-3 text-center font-mono">
                            {item.quantity}
                          </td>
                          <td className="p-3 text-center">
                            {prod?.unit || "عدد"}
                          </td>
                          {selectedProforma.proformaType !== "TECHNICAL" && (
                            <>
                              <td className="p-3 text-left font-mono">
                                {item.unitPriceRIYAL.toLocaleString()}
                              </td>
                              <td className="p-3 text-left font-mono">
                                {item.totalPriceRIYAL.toLocaleString()}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Financial Calculation Totals */}
              <div
                className={
                  selectedProforma.proformaType === "TECHNICAL"
                    ? "grid grid-cols-1"
                    : "grid grid-cols-1 md:grid-cols-2 gap-4"
                }
              >
                <div className="text-xs p-4 bg-slate-50 rounded-xl border border-slate-150 text-slate-600 space-y-2">
                  <p className="font-bold text-slate-700 border-b border-slate-200 pb-1.5">
                    توضیحات و شرایط فروش
                  </p>
                  <p className="whitespace-pre-line leading-relaxed text-[11px]">
                    {selectedProforma.notes}
                  </p>
                </div>
                {selectedProforma.proformaType !== "TECHNICAL" && (
                  <div className="text-xs p-4 bg-slate-50 rounded-xl border border-slate-150 divide-y divide-slate-200 space-y-2">
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500">
                        جمع ناخالص ردیف‌ها:
                      </span>
                      <span className="font-mono font-bold">
                        {formatCurrency(
                          selectedProforma.totalAmount,
                          selectedProforma.currency,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500">
                        تخفیف کلی ({selectedProforma.discountPercent}%):
                      </span>
                      <span className="font-mono text-red-600 font-semibold">
                        -
                        {formatCurrency(
                          selectedProforma.discountAmount,
                          selectedProforma.currency,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500">
                        مالیات بر ارزش افزوده ({selectedProforma.taxPercent}%):
                      </span>
                      <span className="font-mono text-slate-700">
                        +
                        {formatCurrency(
                          selectedProforma.taxAmount,
                          selectedProforma.currency,
                        )}
                      </span>
                    </div>
                    <div
                      className="flex justify-between items-center py-2 text-sm font-bold border-t-2"
                      style={{ color: activeTemplate.titleColor }}
                    >
                      <span>مبلغ قابل پرداخت نهایی:</span>
                      <span className="font-mono">
                        {formatCurrency(
                          selectedProforma.finalAmount,
                          selectedProforma.currency,
                        )}
                      </span>
                    </div>
                    <div className="text-left pt-2 font-semibold text-slate-500 text-[10px]">
                      {(() => {
                        const cur = selectedProforma.currency || "ریال";
                        if (cur !== "ریال") {
                          const engCurrency = mapPersianCurrencyToEnglish(cur);
                          const rateObj = engCurrency
                            ? exchangeRates.find(
                                (r) => r.currency === engCurrency,
                              )
                            : undefined;
                          const rate = rateObj ? rateObj.rateToRIYAL : 1;
                          const riyalVal = selectedProforma.finalAmount * rate;
                          const tomanVal = Math.round(riyalVal / 10);
                          return `نرخ تسعیر روز ${cur}: ${rate.toLocaleString("fa-IR")} ریال | معادل: ${riyalVal.toLocaleString("fa-IR")} ریال (${tomanVal.toLocaleString("fa-IR")} تومان)`;
                        } else {
                          return `معادل ریالی نهایی: ${formatToman(selectedProforma.finalAmount)}`;
                        }
                      })()}
                    </div>
                  </div>
                )}
              </div>
              {/* Signatures */}
              {activeTemplate.showSignatures &&
                (() => {
                  const previewCreatorUser = selectedProforma.creatorId
                    ? users.find((u) => u.id === selectedProforma.creatorId)
                    : currentUser;
                  return (
                    <div className="flex justify-end pt-12">
                      <div className="text-center w-80 border border-slate-100 rounded-2xl p-4 bg-slate-50/30">
                        <p className="text-xs text-slate-400 font-bold mb-1">
                          مهر و امضای صادرکننده پیش‌فاکتور
                        </p>
                        <p className="text-xs font-bold text-slate-700 mb-3">
                          {previewCreatorUser
                            ? previewCreatorUser.fullName
                            : activeTemplate.signatureLabel1}
                        </p>
                        {activeTemplate.companySealUrl ? (
                          <div className="grid grid-cols-2 gap-2 h-24 bg-white/50 rounded-xl border border-slate-100 p-2">
                            <div className="flex flex-col items-center justify-center border-l border-slate-100">
                              <span className="text-[9px] text-slate-400 font-bold mb-1">
                                امضای صادرکننده
                              </span>
                              {previewCreatorUser &&
                              previewCreatorUser.signatureImage ? (
                                <img
                                  src={previewCreatorUser.signatureImage}
                                  alt="Signature"
                                  className="max-h-14 max-w-full object-contain"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="text-[10px] text-slate-300 font-bold">
                                  فاقد امضا
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col items-center justify-center">
                              <span className="text-[9px] text-slate-400 font-bold mb-1">
                                مهر شرکت
                              </span>
                              <img
                                src={activeTemplate.companySealUrl}
                                alt="Company Seal"
                                className="max-h-14 max-w-full object-contain -rotate-3"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-24 bg-white/50 rounded-xl border border-slate-100 p-2">
                            <span className="text-[9px] text-slate-400 font-bold mb-1">
                              امضای صادرکننده
                            </span>
                            {previewCreatorUser &&
                            previewCreatorUser.signatureImage ? (
                              <img
                                src={previewCreatorUser.signatureImage}
                                alt="Signature"
                                className="max-h-16 max-w-full object-contain"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span className="text-[10px] text-slate-300 font-bold">
                                فاقد امضا
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              {/* Beautiful Footer displaying email, phone number, and address of the company, and page number */}
              <div className="border-t border-slate-200 pt-6 mt-12 flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-500 gap-4">
                <div className="flex flex-wrap justify-center sm:justify-start gap-y-2 gap-x-6">
                  <div>
                    <strong>آدرس شرکت:</strong>{" "}
                    {activeTemplate.address || "تهران، شرکت ابزار کنترل عرشیا"}
                  </div>
                  <div>
                    <strong>تلفن تماس:</strong>{" "}
                    <span className="font-mono">{activeTemplate.phone}</span>
                  </div>
                  <div>
                    <strong>پست الکترونیکی:</strong>{" "}
                    <span className="font-mono">{activeTemplate.email}</span>
                  </div>
                </div>
                <div className="font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">
                  صفحه ۱ از ۱
                </div>
              </div>
            </div>

            {/* Proforma Global Module Notes & Agreements (Hidden on Print) */}
            <div className="print:hidden mt-8 text-right border-t border-slate-200 pt-8">
              <ModuleNotesSection
                notes={selectedProforma.moduleNotes || []}
                currentUser={currentUser}
                title="توافقات خاص و کامنت‌های این پیش‌فاکتور"
                placeholder="یادداشت یا کامنت جدید درباره شرایط پرداخت، تخفیفات، یا توافقات خاص مشتری بنویسید..."
                onAddNote={(text) => {
                  const newNote = {
                    id: `note-${Date.now()}`,
                    text,
                    createdAt: getTodayShamsi(),
                    author: currentUser?.fullName || currentUser?.username || "کاربر سیستم",
                  };
                  const updated = {
                    ...selectedProforma,
                    moduleNotes: [...(selectedProforma.moduleNotes || []), newNote],
                  };
                  updateProforma(updated);
                  setSelectedProforma(updated);
                }}
                onDeleteNote={(id) => {
                  const updatedNotes = (selectedProforma.moduleNotes || []).filter((n) => n.id !== id);
                  const updated = {
                    ...selectedProforma,
                    moduleNotes: updatedNotes,
                  };
                  updateProforma(updated);
                  setSelectedProforma(updated);
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Main View Page */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            پیش‌فاکتورها و مدارک تجاری
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            صدور و مدیریت اسناد پیشنهاد قیمت، تعیین درصد تخفیف، احتساب مالیات
            ارزش افزوده و رهگیری بازرگانی
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center gap-2"
        >
          <Plus size={16} />
          صدور پیش‌فاکتور جدید
        </button>
      </div>
      {/* Search and Filters row */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative w-full md:flex-1">
          <Search
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={18}
          />
          <input
            type="text"
            placeholder="جستجو در شماره پیش‌فاکتور، نام کارفرما یا پروژه..."
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
            <option value="all">همه وضعیت‌ها</option>
            <option value="پیش‌نویس">پیش‌نویس</option>
            <option value="ارسال شده">ارسال شده (مذاکره)</option>
            <option value="تأیید شده (برنده)">تأیید شده (برنده نهایی)</option>
            <option value="لغو شده">لغو شده</option>
            <option value="باخته">باخته (عدم موافقت)</option>
          </select>
        </div>
      </div>
      {/* Grouped by Project Accordions */}
      <div className="space-y-4">
        {projectIdsOrdered.map((pId) => {
          const pfs = proformasByProject[pId];
          if (!pfs || pfs.length === 0) return null;
          const isNoProject = pId === "no-project";
          const project = isNoProject ? null : getProjectDetails(pId);
          const isExpanded = expandedProjects[pId] !== false; // default to true
          return (
            <div
              key={pId}
              className="bg-white rounded-2xl border border-slate-150 shadow-sm overflow-hidden transition-all duration-200"
            >
              {/* Accordion Header */}
              <div
                onClick={() => toggleProjectExpand(pId)}
                className={`p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 cursor-pointer select-none transition ${
                  isExpanded
                    ? "bg-sky-50/40 border-b border-slate-100"
                    : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-3 text-right">
                  <div
                    className={`p-2 rounded-xl ${isNoProject ? "bg-slate-100 text-slate-600" : "bg-sky-100 text-sky-600"}`}
                  >
                    {isNoProject ? (
                      <Package size={18} />
                    ) : (
                      <Building size={18} />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">
                      {isNoProject
                        ? "پیش‌فاکتورهای عمومی و خرید مستقیم (بدون پروژه)"
                        : `پروژه: ${project?.name || "نامشخص"} (${project?.code || ""})`}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isNoProject
                        ? "اقلام تامین مستقیم یا مصارف عمومی انبار"
                        : `کارفرما: ${project?.customerName || "نامشخص"}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mr-auto sm:mr-0">
                  <span className="text-xs text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full font-bold">
                    {pfs.length} نسخه پیش‌فاکتور
                  </span>
                  {!isNoProject && project && (
                    <>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getProjectStatusColor(project.status)}`}
                      >
                        وضعیت پروژه: {project.status}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelProjectId(project.id);
                          setCancelProjectName(project.name);
                          setCancelConfirmOpen(true);
                        }}
                        className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 hover:border-amber-300 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                        title="لغو تمام نسخه‌های پیش‌فاکتور این پروژه"
                      >
                        <Ban size={10} />
                        لغو تمام نسخه‌ها
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBulkModal(project.id, project.name);
                        }}
                        className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                        title="ثبت باخت کلی تمام نسخه‌های پیش‌فاکتور این پروژه"
                      >
                        <XCircle size={10} />
                        ثبت باخت تمام نسخه‌ها
                      </button>
                    </>
                  )}
                  {/* Chevron Icon */}
                  <span
                    className="text-slate-400 transition-transform duration-200"
                    style={{
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                </div>
              </div>
              {/* Accordion Content */}
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 text-xs font-bold">
                        <th className="p-4 w-32">شماره نسخه/سند</th>
                        <th className="p-4 w-48">تاریخ صدور / انقضا</th>
                        <th className="p-4 min-w-[300px]">مشتری/اقلام</th>
                        <th className="p-4 text-left w-52">مبلغ کل نهایی</th>
                        <th className="p-4 text-center w-36">وضعیت ارسال</th>
                        <th className="p-4 text-center w-32">
                          وضعیت پیش‌فاکتور
                        </th>
                        <th className="p-4 text-center w-60">عملیات مدیریت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                      {pfs.map((pf) => (
                        <tr
                          key={pf.id}
                          className="hover:bg-slate-50/50 transition"
                        >
                          {/* Number */}
                          <td className="p-4">
                            <span className="font-mono font-extrabold text-slate-900 text-sm block">
                              {pf.proformaNumber}
                            </span>
                          </td>
                          {/* Dates */}
                          <td className="p-4 font-mono text-[11px] text-slate-600 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400 text-[10px]">
                                صدور:
                              </span>
                              <span className="font-bold">{pf.issueDate}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-rose-600">
                              <span className="text-rose-400 text-[10px]">
                                اعتبار:
                              </span>
                              <span className="font-extrabold">
                                {pf.expiryDate}
                              </span>
                            </div>
                          </td>
                          {/* Items description column */}
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="font-semibold text-slate-800 line-clamp-1">
                                {pf.customerName}
                              </div>
                              <div className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">
                                {pf.items && pf.items.length > 0
                                  ? pf.items
                                      .map(
                                        (item) =>
                                          `${item.productName} (${item.quantity} ${item.status === "برنده" ? "✅" : item.status === "بازنده" ? "❌" : ""})`,
                                      )
                                      .join("، ")
                                  : "فاقد کالا"}
                              </div>
                            </div>
                          </td>
                          {/* Amount */}
                          <td className="p-4 text-left font-mono font-bold text-slate-950 text-sm">
                            <div>
                              {formatCurrency(pf.finalAmount, pf.currency)}
                            </div>
                            {!pf.currency || pf.currency === "ریال" ? (
                              <span className="text-[9px] text-slate-400 font-normal block mt-0.5">
                                {formatToman(pf.finalAmount)}
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-400 font-normal block mt-0.5">
                                {(() => {
                                  const engCurrency =
                                    mapPersianCurrencyToEnglish(
                                      pf.currency || "ریال",
                                    );
                                  const rateObj = engCurrency
                                    ? exchangeRates.find(
                                        (r) => r.currency === engCurrency,
                                      )
                                    : undefined;
                                  const rate = rateObj
                                    ? rateObj.rateToRIYAL
                                    : 1;
                                  return `تسعیر: ${(pf.finalAmount * rate).toLocaleString("fa-IR")} ریال`;
                                })()}
                              </span>
                            )}
                          </td>
                          {/* Status Badge */}
                          <td className="p-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {pf.status === "پیش‌نویس" ? (
                                <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-slate-100 text-slate-700 border-slate-200">
                                  پیش‌نویس
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-sky-50 text-sky-700 border-sky-200 block">
                                    ارسال شده برای کارفرما
                                  </span>
                                  {pf.sentMethod && (
                                    <span className="text-[9px] text-slate-400 block font-medium">
                                      طریق: {pf.sentMethod}
                                    </span>
                                  )}
                                  {pf.sentRecipients && pf.sentRecipients.length > 0 && (
                                    <span className="text-[9px] text-slate-500 block font-medium max-w-[120px] truncate" title={pf.sentRecipients.join("، ")}>
                                      به: {pf.sentRecipients.join("، ")}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          {/* Computed Status Badge */}
                          <td className="p-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {(() => {
                                const outcome = getProformaOutcomeStatus(pf);
                                if (outcome === "لغو شده")
                                  return (
                                    <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-slate-200 text-slate-700 border-slate-300 shadow-sm">
                                      لغو شده
                                    </span>
                                  );
                                if (outcome === "تأیید شده (برنده)")
                                  return (
                                    <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm shadow-emerald-500/10">
                                      برنده
                                    </span>
                                  );
                                if (outcome === "باخته")
                                  return (
                                    <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-red-50 text-red-700 border-red-200 shadow-sm shadow-red-500/10">
                                      بازنده
                                    </span>
                                  );
                                if (outcome === "نیمه برنده")
                                  return (
                                    <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-teal-50 text-teal-700 border-teal-200 shadow-sm shadow-teal-500/10">
                                      نیمه برنده
                                    </span>
                                  );
                                if (outcome === "پیش‌نویس")
                                  return (
                                    <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-slate-100 text-slate-600 border-slate-200">
                                      پیش‌نویس
                                    </span>
                                  );
                                return (
                                  <span className="px-2.5 py-1 rounded-full font-bold text-[10px] border bg-sky-50 text-sky-700 border-sky-200">
                                    جاری
                                  </span>
                                );
                              })()}
                              {pf.lossReason && (
                                <span
                                  className="text-[9px] text-red-500 max-w-xs font-bold bg-red-50 px-1 py-0.5 rounded border border-red-100"
                                  title="علت باخت"
                                >
                                  علت: {pf.lossReason}
                                </span>
                              )}
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="p-4">
                            {(() => {
                              const isAdminUser = currentUser?.role === "admin" || currentUser?.isSystemAdmin;
                              const isLocked = pf.status === "ارسال شده" && !isAdminUser;
                              return (
                                <div className="flex items-center justify-center gap-2 flex-wrap">
                                  {/* Print View Trigger */}
                                  <button
                                    onClick={() => handleOpenPrint(pf)}
                                    className="p-1.5 bg-slate-50 hover:bg-sky-50 text-sky-600 rounded-lg border border-slate-200 hover:border-sky-200 transition"
                                    title="مشاهده پیش‌فاکتور رسمی و چاپ"
                                  >
                                    <Eye size={14} />
                                  </button>
                                  {/* Edit Proforma */}
                                  <button
                                    onClick={() => {
                                      if (isLocked) return;
                                      handleOpenEdit(pf);
                                    }}
                                    disabled={isLocked}
                                    className={`p-1.5 rounded-lg border transition ${
                                      isLocked
                                        ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                        : "bg-slate-50 hover:bg-amber-50 text-amber-600 border-slate-200 hover:border-amber-200"
                                    }`}
                                    title={isLocked ? "ویرایش قفل شده است (پیش‌فاکتور ارسال شده است)" : "ویرایش پیش‌فاکتور"}
                                  >
                                    <Edit size={14} />
                                  </button>
                                  {/* Copy Proforma */}
                                  <button
                                    onClick={() => handleCopyProforma(pf)}
                                    className="p-1.5 bg-slate-50 hover:bg-emerald-50 text-emerald-600 rounded-lg border border-slate-200 hover:border-emerald-200 transition"
                                    title="کپی پیش‌فاکتور"
                                  >
                                    <Copy size={14} />
                                  </button>
                                  {/* Prominent status update button - Exactly fixing user complaint */}
                                  <button
                                    onClick={() =>
                                      handleOpenStatusChange(pf.id, pf.status)
                                    }
                                    className="px-2.5 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-[10px] font-extrabold transition shadow-xs flex items-center gap-1"
                                    title="تغییر وضعیت کلی پیش‌فاکتور و علت باخت"
                                  >
                                    <Settings size={10} />
                                    تغییر وضعیت
                                  </button>
                                  {/* Manage Items Status */}
                                  <button
                                    onClick={() => handleOpenItemsModal(pf)}
                                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-extrabold transition"
                                    title="تغییر وضعیت تک‌تک ردیف‌های پیش‌فاکتور"
                                  >
                                    ردیف‌ها
                                  </button>
                                  {/* Delete */}
                                  <button
                                    onClick={() => {
                                      if (isLocked) return;
                                      setProformaToDeleteId(pf.id);
                                      setProformaToDeleteNumber(
                                        pf.proformaNumber || "",
                                      );
                                      setDeleteConfirmOpen(true);
                                    }}
                                    disabled={isLocked}
                                    className={`p-1.5 rounded-lg border transition ${
                                      isLocked
                                        ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                        : "text-slate-400 hover:text-red-600 hover:bg-red-50 border-slate-150 hover:border-red-150"
                                    }`}
                                    title={isLocked ? "حذف قفل شده است (پیش‌فاکتور ارسال شده است)" : "حذف پیش‌فاکتور"}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {filteredProformas.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
            <FileText className="mx-auto text-slate-300 mb-3" size={40} />
            هیچ فاکتور یا پیش‌فاککوری با معیارهای مدنظر شما یافت نشد.
          </div>
        )}
      </div>
      {/* Status Adjustment Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">
                تغییر وضعیت پیش‌فاکتور
              </h3>
              <button
                onClick={() => setShowStatusModal(false)}
                className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveStatusChange} className="p-6 space-y-4">
              <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 text-[11px] text-sky-700 space-y-1 leading-relaxed">
                <span className="font-bold block text-sky-800">
                  💡 راهنمای تعیین وضعیت:
                </span>
                <p>
                  تغییر وضعیت کلی در این بخش صرفاً جهت مشخص کردن وضعیت ارسال
                  پیش‌فاکتور (پیش‌نویس یا ارسال شده) می‌باشد.
                </p>
                <p>
                  برای تعیین وضعیت نهایی پیش‌فاکتور (جاری، برنده، یا بازنده)،
                  لطفاً از دکمه{" "}
                  <span className="font-semibold text-sky-900">«ردیف‌ها»</span>{" "}
                  در جدول اقلام استفاده نمایید. با تغییر وضعیت ردیف‌ها، وضعیت
                  پیش‌فاکتور و پروژه مادر به صورت کاملاً خودکار و یکپارچه به یکی
                  از حالت‌های برنده، نیمه‌برنده یا باخته محاسبه و به‌روزرسانی
                  خواهد شد.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500">
                  وضعیت پیش‌فاکتور
                </label>
                <select
                  value={newStatusSelected}
                  onChange={(e) =>
                    setNewStatusSelected(e.target.value as Proforma["status"])
                  }
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-semibold"
                >
                  {(!(proformas.find((p) => p.id === statusTargetId)?.status === "ارسال شده" && !((currentUser?.role as string) === "admin" || currentUser?.isSystemAdmin)) || ((currentUser?.role as string) === "admin" || currentUser?.isSystemAdmin)) && (
                    <option value="پیش‌نویس">پیش‌نویس (Draft)</option>
                  )}
                  <option value="ارسال شده">ارسال شده به کارفرما (Sent)</option>
                </select>
              </div>

              {newStatusSelected === "ارسال شده" && (() => {
                const targetPf = proformas.find((p) => p.id === statusTargetId);
                const pfCustomerObj = targetPf ? customers.find((c) => c.id === targetPf.customerId) : null;
                return (
                  <div className="space-y-4 border-t border-slate-100 pt-3 animate-fade-in">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">طریقه ارسال پیش‌فاکتور *</label>
                      <select
                        value={sentMethodType}
                        onChange={(e) => setSentMethodType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        {(settings?.dropdownItems?.proformaSentMethods || ["ایمیل", "واتس‌اپ", "تلگرام", "پست", "حضوری", "سایر"]).map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    {sentMethodType === "سایر" && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">توضیح طریقه ارسال *</label>
                        <input
                          type="text"
                          value={customSentMethod}
                          onChange={(e) => setCustomSentMethod(e.target.value)}
                          placeholder="مثلاً: بورد پروژه، اتوماسیون اداری و..."
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                          required
                        />
                      </div>
                    )}

                    <div className="space-y-1.5 relative">
                      <label className="text-xs font-semibold text-slate-600">ارسال شده برای چه شخص یا اشخاصی؟ (مشتریان حقیقی) *</label>
                      
                      <div className="flex flex-wrap gap-1 p-1.5 border border-slate-200 rounded-lg bg-slate-50 min-h-[36px]">
                        {selectedSentRecipients.length === 0 ? (
                          <span className="text-slate-400 text-[10px] self-center">هیچ شخصی انتخاب نشده است</span>
                        ) : (
                          selectedSentRecipients.map(name => (
                            <span key={name} className="inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-150 px-2 py-0.5 rounded-full text-[10px] font-medium">
                              {name}
                              <button
                                type="button"
                                onClick={() => setSelectedSentRecipients(prev => prev.filter(n => n !== name))}
                                className="hover:bg-sky-200 text-sky-500 hover:text-sky-800 rounded-full p-0.5 transition"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      
                      <div className="mt-1 flex gap-1.5 items-center w-full min-w-0">
                        <div className="relative flex-1 min-w-0">
                          <input
                            type="text"
                            value={recipientSearchTerm}
                            onChange={(e) => setRecipientSearchTerm(e.target.value)}
                            placeholder="جستجوی نام شخص (مشتری حقیقی)..."
                            className="w-full border border-slate-200 rounded-lg pr-8 pl-3 py-1.5 text-[11px] focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                          />
                          <div className="absolute right-2.5 top-2 text-slate-400">
                            <Search size={12} />
                          </div>
                          
                          <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                            {(() => {
                              const filtered = customers
                                .filter(c => c.customerType === "حقیقی")
                                .filter(c => {
                                  if (!pfCustomerObj) return false;
                                  if (pfCustomerObj.customerType === "حقوقی") {
                                    return pfCustomerObj.linkedCustomerIds?.includes(c.id) || c.companyName === pfCustomerObj.companyName;
                                  } else {
                                    return c.id === pfCustomerObj.id || pfCustomerObj.linkedCustomerIds?.includes(c.id);
                                  }
                                })
                                .filter(c => {
                                  const fullName = c.companyName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
                                  return fullName.toLowerCase().includes(recipientSearchTerm.toLowerCase());
                                });
                              
                              if (filtered.length === 0) {
                                return <div className="p-2 text-[10px] text-slate-400 text-center">مشتری حقیقی یافت نشد.</div>;
                              }
                              
                              return filtered.map(c => {
                                const fullName = c.companyName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
                                const isSelected = selectedSentRecipients.includes(fullName);
                                
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedSentRecipients(prev => prev.filter(n => n !== fullName));
                                      } else {
                                        setSelectedSentRecipients(prev => [...prev, fullName]);
                                      }
                                      setRecipientSearchTerm("");
                                    }}
                                    className={`w-full text-right px-3 py-1.5 text-[11px] transition flex items-center justify-between hover:bg-slate-50 ${
                                      isSelected ? "bg-sky-50/50 text-sky-700 font-semibold" : "text-slate-700"
                                    }`}
                                  >
                                    <span>{fullName}</span>
                                    {isSelected && <Check size={10} className="text-sky-600" />}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                        {addCustomer && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsQuickAddingSentRecipient(true);
                              setQuickAddType("customer");
                            }}
                            className="px-2 py-1.5 text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg border border-violet-200 hover:border-violet-300 transition shrink-0 flex items-center justify-center font-bold"
                            title="تعریف سریع مخاطب حقیقی جدید"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
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
                  ثبت وضعیت سند
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Manage Individual Items Status Modal */}
      {showItemsModal && selectedProformaForItems && (
        <div
          className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isItemsModalFullscreen ? "p-0" : "p-4"}`}
        >
          <div
            className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in transition-all duration-300 flex flex-col ${
              isItemsModalFullscreen
                ? "w-screen h-screen rounded-none my-0 max-w-full"
                : "rounded-2xl w-full max-w-4xl my-8"
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-800">
                  مدیریت و ثبت علت باخت ردیف‌های پیش‌فاکتور
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  شماره سند: {selectedProformaForItems.proformaNumber} | مشتری:{" "}
                  {selectedProformaForItems.customerName}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setIsItemsModalFullscreen(!isItemsModalFullscreen)
                  }
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={
                    isItemsModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"
                  }
                >
                  {isItemsModalFullscreen ? (
                    <Minimize2 size={18} />
                  ) : (
                    <Maximize2 size={18} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowItemsModal(false);
                    setIsItemsModalFullscreen(false);
                  }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <form
              onSubmit={handleSaveItemsStatus}
              className={`p-6 space-y-4 overflow-y-auto ${isItemsModalFullscreen ? "max-h-[calc(100vh-140px)] flex-1" : ""}`}
            >
              <p className="text-slate-500 text-xs">
                چنانچه بعضی از ردیف‌های پیش‌فاکتور برنده و بعضی دیگر بازنده
                شده‌اند، وضعیت هر ردیف را به صورت مستقل به همراه علت باخت ثبت
                کنید. این کار به صورت اتوماتیک وضعیت کل پروژه را نیز
                همگام‌سازی خواهد کرد.
              </p>

              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() =>
                    setEditingItemsList((prev) =>
                      prev.map((item) => ({ ...item, status: "برنده" })),
                    )
                  }
                  className="px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 rounded-lg text-xs font-bold transition flex items-center gap-1"
                >
                  <CheckCircle size={14} />
                  همه برنده
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditingItemsList((prev) =>
                      prev.map((item) => ({ ...item, status: "بازنده" })),
                    )
                  }
                  className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-bold transition flex items-center gap-1"
                >
                  <XCircle size={14} />
                  همه بازنده
                </button>
              </div>
              <div className="border border-slate-150 rounded-xl overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs min-w-[750px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 font-bold">
                      <th className="py-3 px-4">عنوان محصول</th>
                      <th className="py-3 px-4 text-center">تعداد</th>
                      <th className="py-3 px-4 text-left">
                        مبلغ کل ({selectedProformaForItems.currency || "ریال"})
                      </th>
                      <th className="py-3 px-4 text-center w-48">
                        وضعیت ردیف کالا
                      </th>
                      <th className="py-3 px-4 text-center w-56">
                        علت باخت (در صورت باخت)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editingItemsList.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50/40">
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{item.productName}</span>
                            {item.brand && (
                              <span className="text-xs text-indigo-600 font-semibold">
                                ({item.brand})
                              </span>
                            )}
                            {item.tagNumber && (
                              <span className="text-[10px] text-rose-600 font-mono font-bold bg-rose-50 border border-rose-100 px-1 py-0.2 rounded">
                                تگ: {item.tagNumber}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold">
                          {item.quantity}
                        </td>
                        <td className="py-3 px-4 text-left font-mono text-slate-600">
                          {(item.quantity * item.unitPriceRIYAL).toLocaleString(
                            "fa-IR",
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <select
                            value={item.status || "جاری"}
                            onChange={(e) =>
                              handleItemStatusChangeInList(
                                idx,
                                e.target.value as ProformaItem["status"],
                              )
                            }
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs bg-white text-right font-medium"
                          >
                            <option value="جاری">جاری / در حال مذاکره</option>
                            <option value="برنده">برنده شده (Won) ★</option>
                            <option value="بازنده">بازنده شده (Lost)</option>
                            <option value="لغو شده">لغو شده (Cancelled)</option>
                          </select>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {item.status === "بازنده" ? (
                            <select
                              value={item.lossReason || ""}
                              onChange={(e) =>
                                handleItemLossReasonChangeInList(
                                  idx,
                                  e.target.value,
                                )
                              }
                              required
                              className="w-full border border-rose-200 focus:border-rose-400 rounded px-2 py-1 text-xs bg-white text-right font-medium text-rose-700"
                            >
                              <option value="">-- انتخاب علت باخت --</option>
                              {settings.lossReasons?.map((reason, i) => (
                                <option key={i} value={reason}>
                                  {reason}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-400 text-[10px]">
                              -
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowItemsModal(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-sky-500/15"
                >
                  بروزرسانی وضعیت اقلام پیش‌فاکتور
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Create / Edit Proforma Modal */}
      {showCreateModal && (
        <div
          className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isCreateModalFullscreen ? "p-0" : "p-4"}`}
        >
          <div
            className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in transition-all duration-300 flex flex-col ${
              isCreateModalFullscreen
                ? "w-screen h-screen rounded-none my-0 max-w-full"
                : "rounded-2xl w-full max-w-4xl my-8"
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">
                {editingProforma
                  ? `ویرایش پیش‌فاکتور ${editingProforma.proformaNumber}`
                  : "صدور پیش‌فاکتور اتوماتیک جدید"}
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setIsCreateModalFullscreen(!isCreateModalFullscreen)
                  }
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={
                    isCreateModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"
                  }
                >
                  {isCreateModalFullscreen ? (
                    <Minimize2 size={18} />
                  ) : (
                    <Maximize2 size={18} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingProforma(null);
                    setIsCreateModalFullscreen(false);
                  }}
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <form
              onSubmit={handleSaveProforma}
              className={`p-6 space-y-6 overflow-y-auto ${isCreateModalFullscreen ? "max-h-[calc(100vh-140px)] flex-1" : "max-h-[80vh]"}`}
            >
              {/* Proforma Type Selection */}
              <div className="bg-slate-100 p-1.5 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setProformaType("FINANCIAL");
                  }}
                  className={`py-2.5 px-4 rounded-lg font-bold text-xs transition flex items-center justify-center gap-2 ${
                    proformaType === "FINANCIAL" || !proformaType
                      ? "bg-white text-sky-700 shadow-xs"
                      : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  <span className="text-sm">💰</span>
                  پیش‌فاکتور مالی
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProformaType("TECHNICAL");
                  }}
                  className={`py-2.5 px-4 rounded-lg font-bold text-xs transition flex items-center justify-center gap-2 ${
                    proformaType === "TECHNICAL"
                      ? "bg-white text-indigo-700 shadow-xs"
                      : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  <span className="text-sm">⚙️</span>
                  پیش‌فاکتور فنی
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProformaType("AFTER_SALES");
                  }}
                  className={`py-2.5 px-4 rounded-lg font-bold text-xs transition flex items-center justify-center gap-2 ${
                    proformaType === "AFTER_SALES"
                      ? "bg-white text-emerald-700 shadow-xs"
                      : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  <span className="text-sm">🔧</span>
                  خدمات پس از فروش
                </button>
              </div>

              {/* Header Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {/* Project Select */}
                <div className="space-y-1.5 w-full min-w-0">
                  <label className="text-xs font-semibold text-slate-500">
                    کد پروژه *
                  </label>
                  <div className="flex gap-1.5 items-center w-full min-w-0">
                    <SearchableSelect
                      wrapperClassName="flex-1 min-w-0"
                      value={projectId}
                      onChange={(val) => {
                        const projId = val;
                        setProjectId(projId);
                        if (projId) {
                          const proj = projects.find((p) => p.id === projId);
                          if (proj) {
                            if (proj.customerId) {
                              setCustomerId(proj.customerId);
                            }
                            if (
                              proj.itemsNeeded &&
                              proj.itemsNeeded.length > 0
                            ) {
                              let hasTruncated = false;
                              const newItems = proj.itemsNeeded.map((item) => {
                                const prod = products.find(
                                  (p) => p.id === item.productId,
                                );
                                let qty = item.quantity;
                                let stockToCheck = undefined;
                                let isOrderOnly = false;
                                if (prod && item.variantId) {
                                  const variant = prod.variants?.find(v => v.id === item.variantId);
                                  if (variant) {
                                    stockToCheck = variant.stockLevel;
                                    isOrderOnly = variant.stockLevel === 0;
                                  }
                                } else if (prod) {
                                  stockToCheck = prod.stockLevel;
                                  isOrderOnly = prod.stockLevel === 0;
                                }

                                if (
                                  prod &&
                                  (!isOrderOnly && (prod.supplyType || "INVENTORY") !== "ORDER") &&
                                  stockToCheck !== undefined
                                ) {
                                  if (qty > stockToCheck) {
                                    hasTruncated = true;
                                  }
                                }
                                return {
                                  productId:
                                    item.productId === "generic"
                                      ? ""
                                      : item.productId,
                                  variantId: item.variantId,
                                  productName: prod?.displayName || item.name,
                                  productCode: (prod && item.variantId ? prod.variants?.find(v => v.id === item.variantId)?.sku : prod?.code) || "",
                                  brand: prod?.brand || "",
                                  quantity: qty,
                                  unitPriceRIYAL: prod ? getProductOrVariantPriceInProformaCurrency(prod, prod.variants?.find(v => v.id === item.variantId)) : 0,
                                  deliveryRange: "۳-۴",
                                  deliveryUnit: "هفته" as const,
                                  deliveryType: "کاری" as const,
                                  deliveryPostfix:
                                    "پس از تایید پیش فاکتور و دریافت پیش پرداخت",
                                  tagNumber: item.tagNumber,
                                };
                              });

                              if (hasTruncated) {
                                const keepProjectQty = window.confirm(
                                  `هشدار انبار:\n` +
                                    `تعداد برخی از اقلام درخواستی پروژه از موجودی انبار بیشتر است.\n` +
                                    `آیا مایلید با وجود کسر موجودی، همان تعداد درخواستی پروژه ثبت شود؟\n` +
                                    `در غیر این‌صورت، مقادیر به موجودی فعلی انبار محدود خواهند شد.`,
                                );
                                if (!keepProjectQty) {
                                  newItems.forEach((newItem, idx) => {
                                    const origItem = proj.itemsNeeded![idx];
                                    const prod = products.find(
                                      (p) => p.id === origItem.productId,
                                    );
                                    let truncStock = undefined;
                                    let truncOrderOnly = false;
                                    if (prod && origItem.variantId) {
                                      const variant = prod.variants?.find(v => v.id === origItem.variantId);
                                      if (variant) {
                                        truncStock = variant.stockLevel;
                                        truncOrderOnly = variant.stockLevel === 0;
                                      }
                                    } else if (prod) {
                                      truncStock = prod.stockLevel;
                                      truncOrderOnly = prod.stockLevel === 0;
                                    }

                                    if (
                                      prod &&
                                      (!truncOrderOnly && (prod.supplyType || "INVENTORY") !== "ORDER") &&
                                      truncStock !== undefined
                                    ) {
                                      if (newItem.quantity > truncStock) {
                                        newItem.quantity = truncStock;
                                      }
                                    }
                                  });
                                }
                              }

                              setItems(newItems);
                              setNotes((prev) =>
                                updateNotesWithDelivery(
                                  prev,
                                  newItems,
                                  isEqualDelivery,
                                ),
                              );
                              setDeliveryDate(getDeliverySummary(newItems));
                            }
                          }
                        }
                      }}
                      options={[
                        { value: "", label: "بدون پروژه (خرید مستقیم)" },
                        ...projects.map((p) => ({
                          value: p.id,
                          label: `${p.name} (${p.code})`,
                        })),
                      ]}
                      placeholder="بدون پروژه (خرید مستقیم)"
                      className="font-bold text-sky-700 border-sky-300"
                    />
                    {addProject && (
                      <button
                        type="button"
                        onClick={() => setQuickAddType("project")}
                        className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                        title="تعریف سریع پروژه جدید"
                      >
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                </div>
                {/* Customer Select */}
                <div className="space-y-1.5 w-full min-w-0">
                  <label className="text-xs font-semibold text-slate-500">
                    {renderFieldLabelWithAsterisk(settings, 'proformas', 'customerId', 'انتخاب خریدار / کارفرما')}
                  </label>
                  <div className="flex gap-1.5 items-center w-full min-w-0">
                    <SearchableSelect
                      wrapperClassName="flex-1 min-w-0"
                      value={customerId}
                      onChange={(val) => {
                        const newCustId = val;
                        setCustomerId(newCustId);
                        // Reset contact choice on customer change
                        setContactCustomerId("");
                        // Auto set prefix for Real Customer
                        const selectedCust = customers.find(
                          (c) => c.id === newCustId,
                        );
                        if (
                          selectedCust &&
                          selectedCust.customerType === "حقیقی"
                        ) {
                          if (selectedCust.gender === "مرد") {
                            setContactPrefix("جناب آقای مهندس");
                          } else if (selectedCust.gender === "زن") {
                            setContactPrefix("سرکار خانم مهندس");
                          } else {
                            setContactPrefix("");
                          }
                        } else {
                          setContactPrefix("");
                        }
                      }}
                      required={isFieldRequired(settings, 'proformas', 'customerId')}
                      options={[
                        { value: "", label: "-- انتخاب مشتری --" },
                        ...customers.map((c) => ({
                          value: c.id,
                          label: c.companyName,
                        })),
                      ]}
                      placeholder="-- انتخاب مشتری --"
                    />
                    {addCustomer && (
                      <button
                        type="button"
                        onClick={() => setQuickAddType("customer")}
                        className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                        title="تعریف سریع مشتری جدید"
                      >
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                  <div className="mt-2">
                    <CustomerAgreementAlert 
                      customer={customers.find(c => c.id === customerId)} 
                      moduleName="proformas" 
                    />
                  </div>
                  {(() => {
                    const selectedProjObj = projects.find(
                      (p) => p.id === projectId,
                    );
                    const showCustomerMismatchWarning =
                      selectedProjObj &&
                      customerId &&
                      selectedProjObj.customerId !== customerId;
                    if (!showCustomerMismatchWarning) return null;
                    return (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-2.5 py-1.5 mt-1.5 flex items-center gap-1.5 font-bold animate-pulse">
                        <AlertCircle size={12} className="flex-shrink-0" />
                        مشتری انتخاب‌شده با مشتری پروژه (
                        {selectedProjObj?.customerName}) مغایرت دارد!
                      </p>
                    );
                  })()}
                </div>
                {/* Prefix for Individual (حقیقی) Customer (rendered after Customer Name) */}
                {(() => {
                  const selectedCustObj = customers.find(
                    (c) => c.id === customerId,
                  );
                  const isRealCustomer =
                    selectedCustObj?.customerType === "حقیقی";
                  if (!isRealCustomer) return null;
                  return (
                    <div className="space-y-1.5 animate-fade-in">
                      <label className="text-xs font-semibold text-slate-500">
                        {renderFieldLabelWithAsterisk(settings, 'proformas', 'contactPrefix', 'پیشوند نام مشتری')}
                      </label>
                      <input
                        type="text"
                        required={isFieldRequired(settings, 'proformas', 'contactPrefix')}
                        value={contactPrefix}
                        onChange={(e) => setContactPrefix(e.target.value)}
                        placeholder="مانند: جناب آقای مهندس"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      />
                    </div>
                  );
                })()}
                {/* Contact Select (مخاطب) when Customer is Legal (حقوقی) */}
                {(() => {
                  const selectedCustObj = customers.find(
                    (c) => c.id === customerId,
                  );
                  const isLegalCustomer =
                    selectedCustObj?.customerType === "حقوقی";
                  const filteredContacts = isLegalCustomer
                    ? customers.filter(
                        (c) =>
                          c.customerType === "حقیقی" &&
                          (selectedCustObj.linkedCustomerIds?.includes(c.id) ||
                            c.companyName === selectedCustObj.companyName),
                      )
                    : [];
                  if (!isLegalCustomer) return null;
                  return (
                    <>
                      <div className="space-y-1.5 animate-fade-in w-full min-w-0">
                        <label className="text-xs font-semibold text-slate-500">
                          {renderFieldLabelWithAsterisk(settings, 'proformas', 'contactCustomerId', 'مخاطب')}
                        </label>
                        <div className="flex gap-1.5 items-center w-full min-w-0">
                          <SearchableSelect
                            wrapperClassName="flex-1 min-w-0"
                            value={contactCustomerId}
                            onChange={(val) => {
                              const newContactId = val;
                              setContactCustomerId(newContactId);
                              // Auto set prefix for Contact Customer
                              const selectedContact = customers.find(
                                (c) => c.id === newContactId,
                              );
                              if (selectedContact) {
                                if (selectedContact.gender === "مرد") {
                                  setContactPrefix("جناب آقای مهندس");
                                } else if (selectedContact.gender === "زن") {
                                  setContactPrefix("سرکار خانم مهندس");
                                } else {
                                  setContactPrefix("");
                                }
                              } else {
                                setContactPrefix("");
                              }
                            }}
                            required={isFieldRequired(settings, 'proformas', 'contactCustomerId')}
                            options={[
                              { value: "", label: "-- انتخاب مخاطب --" },
                              ...filteredContacts.map((c) => ({
                                value: c.id,
                                label:
                                  `${c.firstName || ""} ${c.lastName || ""}`.trim() ||
                                  c.companyName,
                              })),
                            ]}
                            placeholder="-- انتخاب مخاطب --"
                          />
                          {addCustomer && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsQuickAddingContact(true);
                                setQuickAddType("customer");
                              }}
                              className="px-2.5 py-2 text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg border border-violet-200 hover:border-violet-300 transition shrink-0 flex items-center justify-center font-bold"
                              title="تعریف سریع مخاطب حقیقی جدید"
                            >
                              <Plus size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Prefix after Contact field */}
                      <div className="space-y-1.5 animate-fade-in">
                        <label className="text-xs font-semibold text-slate-500">
                          پیشوند مخاطب *
                        </label>
                        <input
                          type="text"
                          value={contactPrefix}
                          onChange={(e) => setContactPrefix(e.target.value)}
                          placeholder="مانند: جناب آقای مهندس"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                        />
                      </div>
                    </>
                  );
                })()}
                {/* Dates */}
                <div
                  className="space-y-1.5"
                  id="proforma-issue-date-picker-wrapper"
                >
                  <ShamsiDatePicker
                    label="تاریخ صدور پیشنهاد"
                    required
                    value={issueDate}
                    onChange={(val) => setIssueDate(val)}
                  />
                </div>
                <div
                  className="space-y-1.5"
                  id="proforma-expiry-date-picker-wrapper"
                >
                  <ShamsiDatePicker
                    label="تاریخ انقضای اعتبار پیشنهاد"
                    required
                    value={expiryDate}
                    onChange={(val) => setExpiryDate(val)}
                  />
                </div>
                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">
                    وضعیت سند
                  </label>
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as Proforma["status"])
                    }
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-bold"
                  >
                    {(!(editingProforma?.status === "ارسال شده" && !((currentUser?.role as string) === "admin" || currentUser?.isSystemAdmin)) || ((currentUser?.role as string) === "admin" || currentUser?.isSystemAdmin)) && (
                      <option value="پیش‌نویس">پیش‌نویس</option>
                    )}
                    <option value="ارسال شده">ارسال شده به کارفرما</option>
                  </select>
                </div>

                {status === "ارسال شده" && (
                  <div className="space-y-4 border border-slate-100 bg-slate-50/50 p-3.5 rounded-xl animate-fade-in md:col-span-2">
                    <h4 className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-1.5 mb-2">
                      <span>📬 جزئیات ارسال پیش‌فاکتور به کارفرما</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">طریقه ارسال پیش‌فاکتور *</label>
                        <select
                          value={sentMethodType}
                          onChange={(e) => setSentMethodType(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                        >
                          {(settings?.dropdownItems?.proformaSentMethods || ["ایمیل", "واتس‌اپ", "تلگرام", "پست", "حضوری", "سایر"]).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      {sentMethodType === "سایر" && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-600">توضیح طریقه ارسال *</label>
                          <input
                            type="text"
                            value={customSentMethod}
                            onChange={(e) => setCustomSentMethod(e.target.value)}
                            placeholder="مثلاً: بورد پروژه، اتوماسیون اداری و..."
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                            required
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5 relative">
                      <label className="text-xs font-semibold text-slate-600">ارسال شده برای چه شخص یا اشخاصی؟ (مشتریان حقیقی) *</label>
                      
                      <div className="flex flex-wrap gap-1 p-1.5 border border-slate-200 rounded-lg bg-slate-50 min-h-[36px]">
                        {selectedSentRecipients.length === 0 ? (
                          <span className="text-slate-400 text-[10px] self-center">هیچ شخصی انتخاب نشده است</span>
                        ) : (
                          selectedSentRecipients.map(name => (
                            <span key={name} className="inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-150 px-2 py-0.5 rounded-full text-[10px] font-medium">
                              {name}
                              <button
                                type="button"
                                onClick={() => setSelectedSentRecipients(prev => prev.filter(n => n !== name))}
                                className="hover:bg-sky-200 text-sky-500 hover:text-sky-800 rounded-full p-0.5 transition"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      
                      <div className="mt-1 flex gap-1.5 items-center w-full min-w-0">
                        <div className="relative flex-1 min-w-0">
                          <input
                            type="text"
                            value={recipientSearchTerm}
                            onChange={(e) => setRecipientSearchTerm(e.target.value)}
                            placeholder="جستجوی نام شخص (مشتری حقیقی)..."
                            className="w-full border border-slate-200 rounded-lg pr-8 pl-3 py-1.5 text-[11px] focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                          />
                          <div className="absolute right-2.5 top-2 text-slate-400">
                            <Search size={12} />
                          </div>
                          
                          <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                            {(() => {
                              const pfCustomerObj = customers.find((c) => c.id === customerId);
                              const filtered = customers
                                .filter(c => c.customerType === "حقیقی")
                                .filter(c => {
                                  if (!pfCustomerObj) return false;
                                  if (pfCustomerObj.customerType === "حقوقی") {
                                    return pfCustomerObj.linkedCustomerIds?.includes(c.id) || c.companyName === pfCustomerObj.companyName;
                                  } else {
                                    return c.id === pfCustomerObj.id || pfCustomerObj.linkedCustomerIds?.includes(c.id);
                                  }
                                })
                                .filter(c => {
                                  const fullName = c.companyName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
                                  return fullName.toLowerCase().includes(recipientSearchTerm.toLowerCase());
                                });
                              
                              if (filtered.length === 0) {
                                return <div className="p-2 text-[10px] text-slate-400 text-center">مشتری حقیقی یافت نشد.</div>;
                              }
                              
                              return filtered.map(c => {
                                const fullName = c.companyName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
                                const isSelected = selectedSentRecipients.includes(fullName);
                                
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedSentRecipients(prev => prev.filter(n => n !== fullName));
                                      } else {
                                        setSelectedSentRecipients(prev => [...prev, fullName]);
                                      }
                                      setRecipientSearchTerm("");
                                    }}
                                    className={`w-full text-right px-3 py-1.5 text-[11px] transition flex items-center justify-between hover:bg-slate-50 ${
                                      isSelected ? "bg-sky-50/50 text-sky-700 font-semibold" : "text-slate-700"
                                    }`}
                                  >
                                    <span>{fullName}</span>
                                    {isSelected && <Check size={10} className="text-sky-600" />}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                        {addCustomer && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsQuickAddingSentRecipient(true);
                              setQuickAddType("customer");
                            }}
                            className="px-2 py-1.5 text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg border border-violet-200 hover:border-violet-300 transition shrink-0 flex items-center justify-center font-bold"
                            title="تعریف سریع مخاطب حقیقی جدید"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {/* Currency Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">
                    نوع ارز پیش‌فاکتور *
                  </label>
                  <select
                    value={currency}
                    onChange={(e) =>
                      handleCurrencyChange(
                        e.target.value as Proforma["currency"],
                      )
                    }
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-bold text-emerald-700 border-emerald-300"
                    required
                  >
                    <option value="ریال">ریال (IRR)</option>
                    <option value="دلار">دلار آمریکا (USD)</option>
                    <option value="یورو">یورو (EUR)</option>
                    <option value="درهم">درهم امارات (AED)</option>
                    <option value="یوان">یوان چین (CNY)</option>
                  </select>
                </div>
                {/* Historical Exchange Rate input */}
                {currency !== "ریال" && (
                  <div className="space-y-1.5 bg-amber-50/30 p-2 rounded-lg border border-amber-200/50">
                    <label className="text-xs font-bold text-amber-800">
                      نرخ فروش تاریخی (به ریال) *
                    </label>

                    <input
                      type="number"
                      value={historicalExchangeRate || ""}
                      onChange={(e) =>
                        setHistoricalExchangeRate(Number(e.target.value))
                      }
                      disabled={(() => {
                        if (!editingProforma) return false;
                        return (
                          editingProforma.outcome === "تأیید شده (برنده)" &&
                          (editingProforma.historicalExchangeRate || 0) > 0
                        );
                      })()}

                      placeholder="مثال: ۶۵۰۰۰۰"
                      className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-mono text-left bg-white"
                      required
                    />
                    <span className="text-[10px] text-amber-700 block leading-relaxed">
                      نرخ تسعیر مبنای این پیش‌فاکتور ارزی را وارد کنید. این نرخ
                      در تمام گزارش‌ها و محاسبات سود و زیان تسعیر مبنا قرار
                      خواهد گرفت.
                    </span>
                  </div>
                )}
              </div>
              {/* Items multi-row block */}
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100 flex-wrap gap-3">
                  <h4 className="font-bold text-xs text-slate-700">
                    اقلام پیشنهاد تجهیزات ابزاردقیق
                  </h4>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1.5 rounded-lg border border-slate-200 transition">
                      <input
                        type="checkbox"
                        checked={isEqualDelivery}
                        onChange={(e) =>
                          handleToggleEqualDelivery(e.target.checked)
                        }
                        className="rounded border-slate-300 text-sky-500 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                      />
                      <span>زمان تحویل یکسان برای همه ردیف‌ها</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleAddItemLine}
                      className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                    >
                      <PlusCircle size={14} />
                      افزودن ردیف کالا
                    </button>
                  </div>
                </div>

                {isEqualDelivery && items.length > 0 && (
                  <div className="bg-sky-50/50 p-4 rounded-xl border border-sky-100/80 space-y-2 text-right">
                    <span className="text-[11px] font-extrabold text-sky-800 block">
                      ⏱️ تعیین زمان تحویل کلیه اقلام پیش‌فاکتور (یکسان برای همه
                      ردیف‌ها):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      {/* Field 1: Numerical Range */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 block">
                          بازه عددی
                        </label>
                        <input
                          type="text"
                          required
                          value={items[0]?.deliveryRange || "۳-۴"}
                          onChange={(e) =>
                            handleItemDeliveryFieldChange(
                              0,
                              "deliveryRange",
                              e.target.value,
                            )
                          }
                          placeholder="مثال: ۳-۴"
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-center font-bold bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                        />
                      </div>

                      {/* Field 2: Unit */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 block">
                          واحد زمانی
                        </label>
                        <select
                          value={items[0]?.deliveryUnit || "هفته"}
                          onChange={(e) =>
                            handleItemDeliveryFieldChange(
                              0,
                              "deliveryUnit",
                              e.target.value,
                            )
                          }
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-center font-bold bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                        >
                          <option value="روز">روز</option>
                          <option value="هفته">هفته</option>
                          <option value="ماه">ماه</option>
                        </select>
                      </div>

                      {/* Field 3: Type */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 block">
                          نوع روزها
                        </label>
                        <select
                          value={items[0]?.deliveryType || "کاری"}
                          onChange={(e) =>
                            handleItemDeliveryFieldChange(
                              0,
                              "deliveryType",
                              e.target.value,
                            )
                          }
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-center font-bold bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                        >
                          <option value="کاری">کاری</option>
                          <option value="تقویمی">تقویمی</option>
                        </select>
                      </div>

                      {/* Field 4: Text postfix */}
                      <div className="space-y-1 col-span-1">
                        <label className="text-[10px] font-bold text-slate-500 block">
                          توضیح تکمیلی پس‌وند
                        </label>
                        <input
                          type="text"
                          required
                          value={
                            items[0]?.deliveryPostfix ||
                            "پس از تایید پیش فاکتور و دریافت پیش پرداخت"
                          }
                          onChange={(e) =>
                            handleItemDeliveryFieldChange(
                              0,
                              "deliveryPostfix",
                              e.target.value,
                            )
                          }
                          placeholder="توضیح تکمیلی..."
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none text-right"
                        />
                      </div>
                    </div>
                  </div>
                )}
                {/* Grid headers */}
                <div className="hidden md:grid grid-cols-12 gap-3 px-3 py-1 text-slate-400 font-bold text-[10px]">
                  <div
                    className={
                      proformaType === "TECHNICAL" ? "col-span-9" : "col-span-5"
                    }
                  >
                    انتخاب کالا
                  </div>
                  <div className="col-span-2 text-center">تعداد</div>
                  {proformaType !== "TECHNICAL" && (
                    <>
                      <div className="col-span-2 text-left">
                        بهای واحد ({currency})
                      </div>
                      <div className="col-span-2 text-left">
                        بهای کل ردیف ({currency})
                      </div>
                    </>
                  )}
                  <div className="col-span-1 text-center">حذف</div>
                </div>
                {/* Items rows */}
                <div className="space-y-3 max-h-[400px] overflow-y-auto pl-1">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-50 p-3 rounded-xl border border-slate-150 space-y-3"
                    >
                      <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-start">
                        {/* Product Selector */}
                        <div
                          className={
                            proformaType === "TECHNICAL"
                              ? "col-span-2 md:col-span-9 w-full min-w-0"
                              : "col-span-2 md:col-span-5 w-full min-w-0"
                          }
                        >
                          <div className="flex flex-col gap-2 w-full min-w-0">
                            <div className="flex gap-1.5 items-center w-full min-w-0">
                              {!item.productId ? (
                                <div className="flex-1 flex flex-col gap-1.5 w-full min-w-0">
                                  <input
                                    type="text"
                                    required
                                    value={item.productName}
                                    onChange={(e) => {
                                      const newItems = [...items];
                                      newItems[idx].productName =
                                        e.target.value;
                                      setItems(newItems);
                                    }}
                                    placeholder="نام کالا یا عنوان خدمات دستی..."
                                    className="w-full border border-sky-200 focus:border-sky-500 rounded-lg px-2 py-1.5 text-xs bg-white text-right"
                                  />
                                  <div className="grid grid-cols-2 gap-2 w-full">
                                    <input
                                      type="text"
                                      value={item.productCode || ""}
                                      onChange={(e) => {
                                        const newItems = [...items];
                                        newItems[idx].productCode =
                                          e.target.value;
                                        setItems(newItems);
                                      }}
                                      placeholder="کد کالا/خدمات (اختیاری)"
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[10px] bg-white text-right font-mono"
                                    />
                                    <input
                                      type="text"
                                      value={item.brand || ""}
                                      onChange={(e) => {
                                        const newItems = [...items];
                                        newItems[idx].brand = e.target.value;
                                        setItems(newItems);
                                      }}
                                      placeholder="برند (اختیاری)"
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[10px] bg-white text-right"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="flex-1 flex flex-col gap-2 min-w-0">
                                  <SearchableSelect
                                    wrapperClassName="w-full min-w-0"
                                    value={item.productId}
                                    onChange={(val) => handleItemProductChange(idx, val)}
                                    options={[
                                      { value: "", label: "-- انتخاب کالا --" },
                                      ...products.map((p) => {
                                        let stockText = "";
                                        const hasVariants = p.hasVariants || (p.variants && p.variants.length > 0);
                                        if (hasVariants && p.variants && p.variants.length > 0) {
                                            const totalStock = p.variants.reduce((acc, v) => {
                                                const s = Number(v.stockLevel);
                                                return acc + (isNaN(s) ? 0 : s);
                                            }, 0);
                                            const hasOrderVariant = p.variants.some(v => {
                                                const s = Number(v.stockLevel);
                                                return isNaN(s) || s === 0;
                                            });
                                            const hasInventoryVariant = p.variants.some(v => {
                                                const s = Number(v.stockLevel);
                                                return !isNaN(s) && s > 0;
                                            });
                                            
                                            if (hasInventoryVariant && hasOrderVariant) {
                                                stockText = ` | موجودی: ${totalStock} + تامین سفارشی`;
                                            } else if (hasInventoryVariant) {
                                                stockText = ` | موجودی: ${totalStock}`;
                                            } else {
                                                stockText = ` | تامین سفارشی`;
                                            }
                                        } else {
                                            const sLevel = Number(p.stockLevel) || 0;
                                            const effectiveST = sLevel === 0 ? "ORDER" : (p.supplyType || "INVENTORY");
                                            stockText = effectiveST === "INVENTORY" ? ` | موجودی: ${sLevel}` : " | تامین سفارشی";
                                        }
                                        return {
                                          value: p.id,
                                          label: `${p.displayName}${stockText}`,
                                        };
                                      }),
                                    ]}
                                    placeholder="-- انتخاب کالا --"
                                    className="text-xs"
                                  />
                                  {item.productId && (products.find(p => p.id === item.productId)?.hasVariants || products.find(p => p.id === item.productId)?.features?.length) && (
                                    <div className="flex gap-2 items-center">
                                      {(() => {
                                        const prod = products.find((p) => p.id === item.productId);
                                        if (prod && prod.features && prod.features.length > 0) {
                                          return (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setShowConfigModal(idx);
                                                const currentVariant = item.variantId ? prod.variants?.find(v => v.id === item.variantId) : null;
                                                const initialSelections: Record<string, string[]> = {};
                                                
                                                if (currentVariant) {
                                                  for (const feature of prod.features) {
                                                    const val = currentVariant.attributes[feature.name];
                                                    if (val) initialSelections[feature.id] = [val];
                                                  }
                                                } else if (item.techSpecs) {
                                                    const lines = item.techSpecs.split('\n');
                                                    for (const feature of prod.features) {
                                                        const prefix = `${feature.name}: `;
                                                        const line = lines.find(l => l.trim().startsWith(prefix));
                                                        if (line) {
                                                            const valStr = line.trim().substring(prefix.length);
                                                            initialSelections[feature.id] = valStr.split('،').map(s => s.trim());
                                                        }
                                                    }
                                                }
                                                setConfigSelections(initialSelections);
                                              }}
                                              className="shrink-0 text-[10px] bg-sky-50 text-sky-600 hover:bg-sky-100 px-2 py-1.5 rounded font-bold flex items-center gap-1 transition"
                                            >
                                              <Settings size={12} />
                                              کانفیگ کالا
                                            </button>
                                          );
                                        }
                                        return null;
                                      })()}
                                      {products.find(p => p.id === item.productId)?.hasVariants && (
                                          <select
                                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-slate-50 focus:bg-white text-right outline-none focus:ring-1 focus:ring-sky-500"
                                            value={item.variantId || ""}
                                            onChange={(e) => handleItemVariantChange(idx, e.target.value)}
                                          >
                                            <option value="">-- انتخاب ترکیب مشخصات (SKU) --</option>
                                            {products.find(p => p.id === item.productId)?.variants?.map(v => (
                                              <option key={v.id} value={v.id}>
                                                {v.sku} - {Object.values(v.attributes).join(', ')} {(v.stockLevel || 0) > 0 ? `(موجودی: ${v.stockLevel})` : '(قابل سفارش)'}
                                              </option>
                                            ))}
                                          </select>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Toggle between select and manual write */}
                              <button
                                type="button"
                                onClick={() => {
                                  const newItems = [...items];
                                  if (item.productId) {
                                    // Switch to Manual
                                    newItems[idx].productId = "";
                                    newItems[idx].productName = "";
                                    newItems[idx].productCode = "";
                                    newItems[idx].brand = "";
                                  } else {
                                    // Switch to Select from List
                                    const firstP = products[0];
                                    if (firstP) {
                                      newItems[idx].productId = firstP.id;
                                      newItems[idx].productName =
                                        firstP.displayName;
                                      newItems[idx].productCode = firstP.code;
                                      newItems[idx].brand = firstP.brand;
                                      const engCurrency =
                                        mapPersianCurrencyToEnglish(
                                          currency || "ریال",
                                        );
                                      const rateObj = engCurrency
                                        ? exchangeRates.find(
                                            (r) => r.currency === engCurrency,
                                          )
                                        : undefined;
                                      const rate = rateObj
                                        ? rateObj.rateToRIYAL
                                        : 1;
                                      const basePrice =
                                        currency === "ریال"
                                          ? firstP.basePriceRIYAL
                                          : firstP.basePriceRIYAL / rate;
                                      newItems[idx].unitPriceRIYAL = getProductOrVariantPriceInProformaCurrency(firstP); //
                                        Math.round(basePrice * 100) / 100;
                                    }
                                  }
                                  setItems(newItems);
                                }}
                                className="px-2 py-1.5 text-[10px] text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-150 rounded-lg font-bold shrink-0 transition"
                                title={
                                  item.productId
                                    ? "ثبت دستی نام کالا/خدمات"
                                    : "انتخاب کالا از کاتالوگ انبار"
                                }
                              >
                                {item.productId
                                  ? "✍️ ثبت دستی"
                                  : "📋 لیست کالا"}
                              </button>

                              {item.productId && addProduct && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQuickAddProductIndex(idx);
                                    setQuickAddType("product");
                                  }}
                                  className="px-2 py-1.5 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                                  title="تعریف سریع کالای جدید"
                                >
                                  <Plus size={14} />
                                </button>
                              )}
                            </div>

                            {/* Additional row for item config */}
                            <div className="flex flex-wrap gap-3 mt-1 pt-1 border-t border-slate-100/50 w-full">
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-slate-500">
                                  منبع تامین:
                                </label>

                                {(() => {
                                  const selectedProd = products.find(
                                    (p) => p.id === item.productId,
                                  );
                                  const isOrderOnly =
                                    selectedProd?.supplyType === "ORDER";
                                  return (
                                    <select
                                      value={item.supplyMethod || "INVENTORY"}
                                      onChange={(e) => {
                                        const newItems = [...items];
                                        newItems[idx].supplyMethod = e.target
                                          .value as any;
                                        if (e.target.value !== "ORDER") {
                                          const prod = products.find(
                                            (p) => p.id === item.productId,
                                          );
                                          let stockToCheck = undefined;
                                          if (prod && item.variantId) {
                                            const variant = prod.variants?.find(v => v.id === item.variantId);
                                            if (variant) stockToCheck = variant.stockLevel;
                                          } else if (prod) {
                                            stockToCheck = prod.stockLevel;
                                          }

                                          if (
                                            prod &&
                                            stockToCheck !== undefined &&
                                            newItems[idx].quantity > stockToCheck
                                          ) {
                                            const confirmQty = window.confirm(
                                              `موجودی کالا در انبار (${stockToCheck} ${prod.unit || "عدد"}) کمتر از تعداد درخواستی (${newItems[idx].quantity}) است.\nآیا می‌خواهید با وجود کسر موجودی، مقدار درخواستی ثبت شود؟`,
                                            );
                                            if (!confirmQty) {
                                              newItems[idx].quantity = stockToCheck;
                                            }
                                          }
                                        }
                                        setItems(newItems);
                                      }}
                                      className="border border-slate-200 rounded-md px-1.5 py-1 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    >
                                      {!isOrderOnly && (
                                        <option value="INVENTORY">
                                          از انبار
                                        </option>
                                      )}
                                      <option value="ORDER">
                                        سفارش خارجی (قابل سفارش)
                                      </option>
                                      <option value="NONE">
                                        بدون نیاز به تامین (خدمات پس از فروش)
                                      </option>
                                    </select>
                                  );
                                })()}
                              </div>

                              <div className="flex items-center gap-2 border-r pr-3 border-slate-200">
                                <label className="text-[10px] text-slate-500">
                                  تگ نامبر:
                                </label>
                                <input
                                  type="text"
                                  value={item.tagNumber || ""}
                                  onChange={(e) => {
                                    const newItems = [...items];
                                    newItems[idx].tagNumber = e.target.value;
                                    setItems(newItems);
                                  }}
                                  placeholder="مثال: PIT-101"
                                  className="border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono text-center"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Quantity */}
                        <div className="col-span-1 md:col-span-2 flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-slate-400 md:hidden block">
                            تعداد *
                          </label>
                          <input
                            type="number"
                            min={1}
                            required
                            value={item.quantity}
                            onChange={(e) =>
                              handleItemFieldChange(
                                idx,
                                "quantity",
                                Number(e.target.value),
                              )
                            }
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center bg-white"
                          />
                        </div>
                        {proformaType !== "TECHNICAL" && (
                          <>
                            {/* Unit Price */}
                            <div className="col-span-1 md:col-span-2 flex flex-col gap-1">
                              <label className="text-[10px] font-bold text-slate-400 md:hidden block">
                                بهای واحد ({currency}) *
                              </label>
                              <input
                                type="number"
                                required
                                value={item.unitPriceRIYAL}
                                onChange={(e) =>
                                  handleItemFieldChange(
                                    idx,
                                    "unitPriceRIYAL",
                                    Number(e.target.value),
                                  )
                                }
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-left bg-white"
                              />
                            </div>
                            {/* Total price for line */}
                            <div className="col-span-1 md:col-span-2 flex flex-col justify-center text-left px-2">
                              <label className="text-[10px] font-bold text-slate-400 md:hidden block text-right">
                                بهای کل ردیف
                              </label>
                              <div className="font-mono font-bold text-xs text-slate-700 py-1.5 text-left md:text-left">
                                {(
                                  item.quantity * item.unitPriceRIYAL
                                ).toLocaleString()}{" "}
                                {currency}
                              </div>
                            </div>
                          </>
                        )}
                        {/* Remove item line button */}
                        <div className="col-span-1 md:col-span-1 flex flex-col justify-end md:justify-center items-center">
                          <label className="text-[10px] font-bold text-slate-400 md:hidden block select-none">
                            &nbsp;
                          </label>
                          <button
                            type="button"
                            onClick={() => handleRemoveItemLine(idx)}
                            className="w-full md:w-auto py-1.5 md:py-1 px-3 md:px-1 text-slate-400 hover:text-red-500 hover:bg-red-50 md:hover:bg-white rounded-lg md:rounded border border-slate-200 md:border-0 flex items-center justify-center gap-1 transition text-xs font-semibold"
                            disabled={items.length === 1}
                          >
                            <MinusCircle size={16} />
                            <span className="md:hidden">حذف</span>
                          </button>
                        </div>
                      </div>
                      {/* Technical specifications manual input */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-slate-400 block">
                            مشخصات فنی و توضیحات اختصاصی ردیف (مثال: سایز،
                            متریال، سیگنال خروجی و ...)
                          </label>

                        </div>
                        <textarea
                          rows={2}
                          value={item.techSpecs || ""}
                          onChange={(e) =>
                            handleItemFieldChange(
                              idx,
                              "techSpecs",
                              e.target.value,
                            )
                          }
                          placeholder="مثال: سایز: ۲ اینچ، کلاس فشاری: PN16، متریال بدنه: WCB، خروجی: 4-20mA..."
                          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none text-left [direction:ltr] bg-white leading-relaxed"
                        />
                      </div>
                      {/* Product Image Selection */}
                      {(() => {
                        const prod = products.find(
                          (p) => p.id === item.productId,
                        );
                        if (prod && prod.images && prod.images.length > 0) {
                          return (
                            <div className="space-y-1 bg-white p-2 rounded-lg border border-slate-200 mt-2">
                              <label className="text-[10px] font-bold text-slate-500 block">
                                تصویر انتخابی برای این ردیف در پیش‌فاکتور:
                              </label>
                              <div className="flex flex-wrap gap-2 items-center mt-1">
                                {prod.images.map((img, imgIdx) => {
                                  const isSelected =
                                    item.selectedImage === img ||
                                    (!item.selectedImage && imgIdx === 0);
                                  return (
                                    <button
                                      type="button"
                                      key={imgIdx}
                                      onClick={() =>
                                        handleItemFieldChange(
                                          idx,
                                          "selectedImage",
                                          img,
                                        )
                                      }
                                      className={`relative w-10 h-10 rounded-md border-2 overflow-hidden bg-slate-50 transition-all shrink-0 ${
                                        isSelected
                                          ? "border-sky-500 ring-2 ring-sky-500/20 scale-105 shadow-sm"
                                          : "border-slate-200 hover:border-slate-400"
                                      }`}
                                    >
                                      <img
                                        src={img}
                                        alt={`Product image ${imgIdx + 1}`}
                                        className="w-full h-full object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleItemFieldChange(
                                      idx,
                                      "selectedImage",
                                      "none",
                                    )
                                  }
                                  className={`px-2 py-1 text-[9px] rounded border font-medium transition shrink-0 ${
                                    item.selectedImage === "none"
                                      ? "border-red-500 bg-red-50 text-red-700 font-bold"
                                      : "border-slate-200 hover:border-slate-300 text-slate-500"
                                  }`}
                                >
                                  عدم نمایش تصویر
                                </button>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Delivery Time Fields (4 inputs side-by-side) */}
                      {!isEqualDelivery && (
                        <div className="bg-sky-50/40 p-3 rounded-lg border border-sky-100 space-y-2 mt-2 text-right">
                          <span className="text-[10px] font-extrabold text-sky-700 block">
                            ⏱️ تعیین زمان تحویل ردیف {idx + 1}:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            {/* Field 1: Numerical Range */}
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-500 block">
                                بازه عددی
                              </label>
                              <input
                                type="text"
                                required
                                value={item.deliveryRange || "۳-۴"}
                                onChange={(e) =>
                                  handleItemDeliveryFieldChange(
                                    idx,
                                    "deliveryRange",
                                    e.target.value,
                                  )
                                }
                                placeholder="مثال: ۳-۴"
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center font-bold bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                              />
                            </div>

                            {/* Field 2: Unit */}
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-500 block">
                                واحد زمانی
                              </label>
                              <select
                                value={item.deliveryUnit || "هفته"}
                                onChange={(e) =>
                                  handleItemDeliveryFieldChange(
                                    idx,
                                    "deliveryUnit",
                                    e.target.value,
                                  )
                                }
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center font-bold bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                              >
                                <option value="روز">روز</option>
                                <option value="هفته">هفته</option>
                                <option value="ماه">ماه</option>
                              </select>
                            </div>

                            {/* Field 3: Type */}
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-500 block">
                                نوع روزها
                              </label>
                              <select
                                value={item.deliveryType || "کاری"}
                                onChange={(e) =>
                                  handleItemDeliveryFieldChange(
                                    idx,
                                    "deliveryType",
                                    e.target.value,
                                  )
                                }
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center font-bold bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                              >
                                <option value="کاری">کاری</option>
                                <option value="تقویمی">تقویمی</option>
                              </select>
                            </div>

                            {/* Field 4: Text postfix */}
                            <div className="space-y-1 col-span-1">
                              <label className="text-[9px] font-bold text-slate-500 block">
                                توضیح تکمیلی پس‌وند
                              </label>
                              <input
                                type="text"
                                required
                                value={
                                  item.deliveryPostfix ||
                                  "پس از تایید پیش فاکتور و دریافت پیش پرداخت"
                                }
                                onChange={(e) =>
                                  handleItemDeliveryFieldChange(
                                    idx,
                                    "deliveryPostfix",
                                    e.target.value,
                                  )
                                }
                                placeholder="توضیح تکمیلی..."
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none text-right"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* Financial Bottom Block */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-slate-100 pt-5">
                {/* Notes and custom variables */}
                <div
                  className={`space-y-3 text-xs ${proformaType === "TECHNICAL" ? "md:col-span-2" : ""}`}
                >
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">
                      شرایط و توضیحات
                    </label>
                    <textarea
                      rows={4}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="اعتبار پیشنهاد، شرایط تحویل، گارانتی قطعات..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    />
                  </div>
                  {proformaType === "TECHNICAL" && (
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-700 font-medium">
                      ℹ️ این پیش‌فاکتور از نوع <strong>فنی</strong> است. کلیه
                      اطلاعات قیمتی، تخفیف، مالیات و مبالغ نهایی از پیش‌نمایش و
                      فایل چاپی حذف خواهند شد.
                    </div>
                  )}
                </div>
                {/* Numerical Totals Panel */}
                {proformaType !== "TECHNICAL" && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-2.5 text-xs">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="text-slate-500">جمع ناخالص اقلام:</span>
                      <span className="font-mono text-slate-700">
                        {subTotal.toLocaleString()} {currency}
                      </span>
                    </div>
                    {/* Discount percentage input */}
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="text-slate-500">
                        اعمال درصد تخفیف کلی:
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={discountPercent}
                          onChange={(e) =>
                            setDiscountPercent(
                              Math.min(
                                100,
                                Math.max(0, Number(e.target.value)),
                              ),
                            )
                          }
                          className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-mono"
                        />
                        <span className="text-slate-400">%</span>
                        <span className="font-mono text-red-600 font-semibold">
                          ({discountAmount.toLocaleString()} {currency})
                        </span>
                      </div>
                    </div>
                    {/* Tax percentage input */}
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="text-slate-500">
                        مالیات بر ارزش افزوده (VAT):
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={taxPercent}
                          onChange={(e) =>
                            setTaxPercent(
                              Math.min(
                                100,
                                Math.max(0, Number(e.target.value)),
                              ),
                            )
                          }
                          className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-mono"
                        />
                        <span className="text-slate-400">%</span>
                        <span className="font-mono text-slate-600 font-semibold">
                          ({taxAmount.toLocaleString()} {currency})
                        </span>
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex justify-between items-center flex-wrap gap-2 text-sm font-bold text-sky-700">
                      <span>مبلغ کل خالص فاکتور:</span>
                      <span className="font-mono text-base">
                        {finalAmount.toLocaleString()} {currency}
                      </span>
                    </div>
                    {currency === "ریال" ? (
                      <div className="text-left font-semibold text-slate-500 text-[10px]">
                        معادل تومان: {formatToman(finalAmount)}
                      </div>
                    ) : (
                      <div className="text-left font-semibold text-slate-500 text-[10px]">
                        {(() => {
                          const eng = mapPersianCurrencyToEnglish(currency);
                          const rateObj = eng
                            ? exchangeRates.find((r) => r.currency === eng)
                            : undefined;
                          const rate = rateObj ? rateObj.rateToRIYAL : 1;
                          const riyalAmount = finalAmount * rate;
                          return `تسعیر همزمان: ${Math.round(riyalAmount).toLocaleString()} ریال (${Math.round(riyalAmount / 10).toLocaleString()} تومان)`;
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Form Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingProforma(null);
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15"
                >
                  {editingProforma
                    ? "اعمال تغییرات پیش‌فاکتور"
                    : "ذخیره و ثبت پیش‌فاکتور خودکار"}
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
          setProformaToDeleteId(null);
          setProformaToDeleteNumber("");
        }}
        onConfirm={() => {
          if (proformaToDeleteId) {
            deleteProforma(proformaToDeleteId);
          }
        }}
        title="حذف پیش‌فاکتور"
        message={`آیا از حذف پیش‌فاکتور "${proformaToDeleteNumber}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      />

      {/* Confirm Cancel All Modal */}
      <ConfirmModal
        isOpen={cancelConfirmOpen}
        onClose={() => {
          setCancelConfirmOpen(false);
          setCancelProjectId("");
          setCancelProjectName("");
        }}
        onConfirm={() => {
          if (cancelProjectId) {
            batchUpdateProjectProformasStatus(cancelProjectId, "لغو شده");
            setCancelConfirmOpen(false);
          }
        }}
        title="لغو تمام نسخه‌ها"
        message={`آیا از لغو تمام نسخه‌های پیش‌فاکتور مربوط به پروژه "${cancelProjectName}" اطمینان دارید؟`}
        confirmText="بله، لغو شود"
      />
      {/* Product Configurator Modal */}
      {showConfigModal !== null &&
        (() => {
          const itemIdx = showConfigModal;
          const item = items[itemIdx];
          const prod = products.find((p) => p.id === item.productId);
          if (!prod || !prod.features || prod.features.length === 0)
            return null;

          const handleConfirmConfig = () => {
            const configParts = [];
            let matchedVariantId = undefined;
            
            for (const feature of prod.features!) {
              const selected = configSelections[feature.id] || [];
              if (selected.length > 0) {
                configParts.push(`${feature.name}: ${selected.join("، ")}`);
              }
            }
            
            if (prod.hasVariants && prod.variants) {
                const match = prod.variants.find(v => {
                    return Object.entries(v.attributes).every(([k, val]) => {
                        const feature = prod.features?.find(f => f.name === k);
                        if (!feature) return false;
                        const selected = configSelections[feature.id] || [];
                        return selected.length === 1 && selected[0] === val;
                    });
                });
                if (match) matchedVariantId = match.id;
            }

            let currentSpecs = item.techSpecs || "";
            const featureNames = prod.features?.map(f => f.name) || [];
            const filteredLines = currentSpecs.split('\n').filter(line => {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('مشخصات:')) return false;
                return !featureNames.some(fn => trimmedLine.startsWith(`${fn}:`));
            });

            const newTechSpecs = [...filteredLines, ...configParts].filter(Boolean).join('\n');

            const newItems = [...items];
            newItems[itemIdx] = {
                ...item,
                techSpecs: newTechSpecs,
            };
            if (matchedVariantId) {
                const variant = prod.variants!.find(v => v.id === matchedVariantId);
                newItems[itemIdx].variantId = matchedVariantId;
                if (variant) {
                    newItems[itemIdx].productCode = variant.sku;
                    newItems[itemIdx].unitPriceRIYAL = getProductOrVariantPriceInProformaCurrency(prod, variant);
                    const effectiveSupplyType = variant.stockLevel === 0 ? "ORDER" : (prod.supplyType || "INVENTORY");
                    newItems[itemIdx].supplyMethod = effectiveSupplyType === "ORDER" ? "ORDER" : "INVENTORY";
                }
            } else {
                newItems[itemIdx].variantId = undefined;
            }
            
            setItems(newItems);
            setShowConfigModal(null);
          };

          return (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Settings size={18} className="text-sky-600" />
                    پیکربندی ویژگی‌های کالا
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowConfigModal(null)}
                    className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="p-6 space-y-5">
                  <div className="bg-sky-50 text-sky-800 p-3 rounded-lg text-xs leading-relaxed border border-sky-100 mb-4">
                    در این بخش می‌توانید مقادیر ویژگی‌های تعریف شده برای محصول{" "}
                    <span className="font-bold">{prod.displayName}</span> را
                    انتخاب کنید. پس از تایید، مقادیر انتخاب شده به متن مشخصات
                    فنی ردیف اضافه خواهند شد.
                  </div>

                  {(() => {
                    // Helper function to prune cascading selections based on configRules
                    const getPrunedSelections = (selections: Record<string, string[]>) => {
                      if (!prod.configRules || prod.configRules.length === 0) return selections;
                      let current = { ...selections };
                      let loop = true;
                      let iterations = 0;
                      while (loop && iterations < 10) {
                        loop = false;
                        iterations++;
                        for (const rule of prod.configRules) {
                          if (!rule.active) continue;
                          
                          // Evaluate conditions
                          const allConditionsMet = rule.conditions.every(cond => {
                            const f = prod.features?.find(feat => feat.name === cond.featureName);
                            if (!f) return false;
                            const selectedVals = current[f.id] || [];
                            return selectedVals.some(v => cond.values.includes(v));
                          });
                          
                          if (allConditionsMet) {
                            for (const act of rule.actions) {
                              const f = prod.features?.find(feat => feat.name === act.featureName);
                              if (f) {
                                const selectedVals = current[f.id] || [];
                                const nextVals = selectedVals.filter(v => !act.values.includes(v));
                                if (nextVals.length !== selectedVals.length) {
                                  current[f.id] = nextVals;
                                  loop = true; // repeat because changes occurred
                                }
                              }
                            }
                          }
                        }
                      }
                      return current;
                    };

                    // Check if a specific feature option is currently excluded
                    const checkIsOptionExcluded = (featName: string, optionVal: string) => {
                      if (!prod.configRules || prod.configRules.length === 0) return false;
                      for (const rule of prod.configRules) {
                        if (!rule.active) continue;
                        
                        const allConditionsMet = rule.conditions.every(cond => {
                          const f = prod.features?.find(feat => feat.name === cond.featureName);
                          if (!f) return false;
                          const selectedVals = configSelections[f.id] || [];
                          return selectedVals.some(v => cond.values.includes(v));
                        });
                        
                        if (allConditionsMet) {
                          const hasExclusion = rule.actions.some(act => act.featureName === featName && act.values.includes(optionVal));
                          if (hasExclusion) return true;
                        }
                      }
                      return false;
                    };

                    return prod.features.map((feature) => (
                      <div
                        key={feature.id}
                        className="space-y-2 border border-slate-100 rounded-lg p-3"
                      >
                        <label className="text-sm font-bold text-slate-700">
                          {feature.name}
                        </label>
                        <div className="flex flex-col gap-2 mt-2">
                          {feature.options.map((opt) => {
                            const isSelected = (
                              configSelections[feature.id] || []
                            ).includes(opt.value);
                            const isExcluded = checkIsOptionExcluded(feature.name, opt.value);
                            
                            return (
                              <label
                                key={opt.id}
                                className={`flex items-center gap-2 select-none ${
                                  isExcluded 
                                    ? "opacity-40 cursor-not-allowed" 
                                    : "cursor-pointer group"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected && !isExcluded}
                                  disabled={isExcluded}
                                  onChange={(e) => {
                                    let nextSelections = { ...configSelections };
                                    const current = nextSelections[feature.id] || [];
                                    if (e.target.checked) {
                                      nextSelections[feature.id] = [...current, opt.value];
                                    } else {
                                      nextSelections[feature.id] = current.filter(
                                        (v) => v !== opt.value,
                                      );
                                    }
                                    
                                    // Cascading prune of any newly restricted options
                                    nextSelections = getPrunedSelections(nextSelections);
                                    setConfigSelections(nextSelections);
                                  }}
                                  className={`w-4 h-4 rounded border-slate-300 focus:ring-sky-500 ${
                                    isExcluded 
                                      ? "text-slate-300 cursor-not-allowed" 
                                      : "text-sky-600 cursor-pointer"
                                  }`}
                                />
                                <span className={`text-sm ${
                                  isExcluded 
                                    ? "text-slate-400 line-through" 
                                    : "text-slate-600 group-hover:text-slate-900 font-medium"
                                }`}>
                                  {opt.value}
                                </span>
                                {isExcluded && (
                                  <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded font-bold mr-auto">
                                    غیرمجاز طبق شروط
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowConfigModal(null)}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmConfig}
                    className="px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-bold shadow-sm transition"
                  >
                    تایید و افزودن به مشخصات فنی
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Quick Customer Add Modal */}
      {showQuickCustomerModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden border border-slate-100 flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-slate-150">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Plus size={18} className="text-sky-500" />
                تعریف سریع مشتری جدید
              </h3>
              <button
                type="button"
                onClick={() => setShowQuickCustomerModal(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-right">
              {/* Customer Type Choice */}
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setQuickCustType("حقوقی")}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${
                    quickCustType === "حقوقی"
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  حقوقی (شرکت/سازمان)
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCustType("حقیقی")}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${
                    quickCustType === "حقیقی"
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  حقیقی (شخصی)
                </button>
              </div>
              {quickCustType === "حقوقی" ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">
                      نام شرکت / سازمان *
                    </label>
                    <input
                      type="text"
                      value={quickCustName}
                      onChange={(e) => setQuickCustName(e.target.value)}
                      placeholder="مثال: فولاد خوزستان"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">
                      رابط / شخص کلیدی
                    </label>
                    <input
                      type="text"
                      value={quickCustKeyPerson}
                      onChange={(e) => setQuickCustKeyPerson(e.target.value)}
                      placeholder="مثال: مهندس احمدی"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">
                      صنعت
                    </label>
                    <select
                      value={quickCustIndustry}
                      onChange={(e) => setQuickCustIndustry(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      {(
                        settings.dropdownItems?.industries || [
                          "نفت و گاز",
                          "فولاد و معادن",
                          "پتروشیمی",
                          "نیروگاهی",
                          "سیمان",
                          "آب و فاضلاب",
                          "غذایی و دارویی",
                          "سایر",
                        ]
                      ).map((ind, idx) => (
                        <option key={idx} value={ind}>
                          {ind}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-500">
                        نام *
                      </label>
                      <input
                        type="text"
                        value={quickCustFirstName}
                        onChange={(e) => setQuickCustFirstName(e.target.value)}
                        placeholder="مثال: محمد"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-500">
                        نام خانوادگی *
                      </label>
                      <input
                        type="text"
                        value={quickCustLastName}
                        onChange={(e) => setQuickCustLastName(e.target.value)}
                        placeholder="مثال: اکبری"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">
                      سمت
                    </label>
                    <select
                      value={quickCustPosition}
                      onChange={(e) => setQuickCustPosition(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      <option value="">انتخاب کنید...</option>
                      {(
                        settings.dropdownItems?.positions || [
                          "مدیرعامل",
                          "مدیر بازرگانی",
                          "کارشناس خرید",
                          "مدیر فنی",
                          "کارشناس ابزار دقیق",
                          "سایر",
                        ]
                      ).map((pos, idx) => (
                        <option key={idx} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">
                    شماره تلفن
                  </label>
                  <input
                    type="text"
                    value={quickCustPhone}
                    onChange={(e) => setQuickCustPhone(e.target.value)}
                    placeholder="۰۲۱-۸۸XXXXXX"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">
                    پست الکترونیک
                  </label>
                  <input
                    type="text"
                    value={quickCustEmail}
                    onChange={(e) => setQuickCustEmail(e.target.value)}
                    placeholder="info@company.com"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>
            </div>
            <div className="bg-slate-50 p-4 border-t border-slate-150 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuickCustomerModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs hover:bg-slate-100 transition font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  if (quickCustType === "حقوقی" && !quickCustName.trim()) {
                    alert("لطفاً نام شرکت را وارد کنید.");
                    return;
                  }
                  if (
                    quickCustType === "حقیقی" &&
                    (!quickCustFirstName.trim() || !quickCustLastName.trim())
                  ) {
                    alert("لطفاً نام و نام خانوادگی را وارد کنید.");
                    return;
                  }
                  const custData: any = {
                    type: quickCustType,
                    status: "فعال",
                    phone: quickCustPhone,
                    mobile: "",
                    email: quickCustEmail,
                    province: "",
                    address: "",
                    notes: "تعریف شده به صورت سریع از پیش‌فاکتور",
                    tags: "",
                    linkedCustomerIds: [],
                  };
                  if (quickCustType === "حقوقی") {
                    custData.companyName = quickCustName;
                    custData.industry = quickCustIndustry;
                    custData.keyPerson = quickCustKeyPerson;
                    custData.contactName = quickCustKeyPerson;
                    custData.contactLastName = "";
                  } else {
                    custData.firstName = quickCustFirstName;
                    custData.lastName = quickCustLastName;
                    custData.gender = "نامشخص";
                    custData.position = quickCustPosition;
                    custData.companyName =
                      `${quickCustFirstName} ${quickCustLastName}`.trim();
                    custData.contactName = quickCustFirstName;
                    custData.contactLastName = quickCustLastName;
                  }
                  if (addCustomer) {
                    const created = addCustomer(custData);
                    if (created && created.id) {
                      setCustomerId(created.id);
                      setShowQuickCustomerModal(false);
                    }
                  }
                }}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition"
              >
                ثبت و انتخاب مشتری
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
                <label className="text-[11px] font-bold text-slate-500">
                  نام پروژه *
                </label>
                <input
                  type="text"
                  value={quickProjName}
                  onChange={(e) => setQuickProjName(e.target.value)}
                  placeholder="مثال: اتوماسیون پست برق پتروشیمی لورم"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">
                  نام مشتری / کارفرما *
                </label>
                <select
                  value={quickProjCustomerId}
                  onChange={(e) => setQuickProjCustomerId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">-- انتخاب مشتری --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">
                    مرحله فرصت
                  </label>
                  <select
                    value={quickProjStage}
                    onChange={(e) => setQuickProjStage(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    {(
                      settings.dropdownItems?.projectStatuses || [
                        "جدید",
                        "در حال مذاکره",
                        "ارائه پیش‌فاکتور",
                        "برنده (موفق)",
                        "نیمه برنده",
                        "باخته",
                        "لغو شده",
                      ]
                    ).map((stg, idx) => (
                      <option key={idx} value={stg}>
                        {stg}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">
                    مسئول فروش
                  </label>
                  <select
                    value={quickProjSalesExpert}
                    onChange={(e) => setQuickProjSalesExpert(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    {(
                      settings.dropdownItems?.salesExperts || [
                        "محمد توکل مقدم",
                        "آنتونی فیرو",
                        "مهندس حسینی",
                      ]
                    ).map((exp, idx) => (
                      <option key={idx} value={exp}>
                        {exp}
                      </option>
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
                    alert("لطفاً نام پروژه را وارد کنید.");
                    return;
                  }
                  if (!quickProjCustomerId) {
                    alert("لطفاً مشتری را انتخاب کنید.");
                    return;
                  }
                  const selectedCust = customers.find(
                    (c) => c.id === quickProjCustomerId,
                  );
                  const customerName = selectedCust
                    ? selectedCust.companyName
                    : "مشتری نامشخص";
                  const projData: any = {
                    name: quickProjName,
                    customerId: quickProjCustomerId,
                    customerName,
                    status: "جدید",
                    stage: quickProjStage,
                    projectManager: quickProjSalesExpert,
                    endUser: "",
                    salesExpert: quickProjSalesExpert,
                    marketingChannel: "",
                    totalValue: 0,
                    lossReason: "",
                    notes: "تعریف سریع از پیش‌فاکتور",
                    expectedCloseDate: "",
                    itemsNeeded: [],
                    customValues: {},
                  };
                  if (addProject) {
                    const created = addProject(projData);
                    if (created && created.id) {
                      setProjectId(created.id);
                      setCustomerId(quickProjCustomerId);
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
      {/* Bulk Status Update (Change all to Lost) Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden border border-slate-100 flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-slate-150">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <XCircle size={18} className="text-red-500" />
                ثبت باخت گروهی تمام نسخه‌های پیش‌فاکتور
              </h3>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={handleSaveBulkStatus}
              className="p-5 space-y-4 text-right"
            >
              <p className="text-xs text-slate-600 leading-relaxed">
                شما در حال تغییر وضعیت تمام پیش‌فاکتورهای پروژه{" "}
                <span className="font-extrabold text-slate-900">
                  «{bulkProjectName}»
                </span>{" "}
                به وضعیت{" "}
                <span className="font-extrabold text-red-600">«باخته»</span>{" "}
                هستید. لطفاً علت باخت را جهت تحلیل‌های مدیریتی مشخص نمایید:
              </p>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">
                  علت باخت پیش‌فاکتورها *
                </label>
                <select
                  value={bulkLossReason}
                  onChange={(e) => setBulkLossReason(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium"
                  required
                >
                  <option value="">-- انتخاب علت باخت --</option>
                  {(
                    settings.lossReasons || [
                      "قیمت بالا نسبت به رقبا",
                      "عدم تایید فنی برند/کالا از سوی کارفرما",
                      "زمان تحویل طولانی کالا",
                      "شرایط پرداخت نامناسب و سخت‌گیرانه",
                      "عدم پیگیری یا لغو کلی پروژه توسط کارفرما",
                      "تغییر مشخصات درخواستی و عدم پوشش ما",
                      "سایر موارد",
                    ]
                  ).map((reason, idx) => (
                    <option key={idx} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>
              <div className="bg-slate-50 p-4 -mx-5 -mb-5 border-t border-slate-150 flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs hover:bg-slate-100 transition font-bold"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-red-500/15"
                >
                  <XCircle size={14} />
                  ثبت قطعی باخت تمام نسخه‌ها
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {quickAddType && (
        <QuickAddModal
          isOpen={!!quickAddType}
          onClose={() => {
            setQuickAddType(null);
            setIsQuickAddingContact(false);
            setIsQuickAddingSentRecipient(false);
          }}
          type={quickAddType}
          settings={settings}
          customers={customers}
          addCustomer={addCustomer}
          addProject={addProject}
          addProduct={addProduct}
          products={products}
          initialCustType={(isQuickAddingContact || isQuickAddingSentRecipient) ? "حقیقی" : undefined}
          initialLinkedCustomerIds={
            (isQuickAddingContact || isQuickAddingSentRecipient)
              ? [customerId || proformas.find(p => p.id === statusTargetId)?.customerId || ""]
              : undefined
          }
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              if (quickAddType === "customer") {
                if (isQuickAddingSentRecipient) {
                  const fullName = newEntity.companyName || `${newEntity.firstName || ""} ${newEntity.lastName || ""}`.trim();
                  setSelectedSentRecipients(prev => {
                    if (prev.includes(fullName)) return prev;
                    return [...prev, fullName];
                  });
                  const currentProformaCustomerId = customerId || proformas.find(p => p.id === statusTargetId)?.customerId;
                  if (currentProformaCustomerId) {
                    const selectedCustObj = customers.find(c => c.id === currentProformaCustomerId);
                    if (updateCustomer && selectedCustObj) {
                      const updatedLinks = Array.from(
                        new Set([
                          ...(selectedCustObj.linkedCustomerIds || []),
                          newEntity.id,
                        ]),
                      );
                      updateCustomer({
                        ...selectedCustObj,
                        linkedCustomerIds: updatedLinks,
                      });
                    }
                  }
                } else if (isQuickAddingContact) {
                  setContactCustomerId(newEntity.id);
                  if (newEntity.gender === "مرد") {
                    setContactPrefix("جناب آقای مهندس");
                  } else if (newEntity.gender === "زن") {
                    setContactPrefix("سرکار خانم مهندس");
                  } else {
                    setContactPrefix("");
                  }
                  const selectedCustObj = customers.find(
                    (c) => c.id === customerId,
                  );
                  if (updateCustomer && selectedCustObj) {
                    const updatedLinks = Array.from(
                      new Set([
                        ...(selectedCustObj.linkedCustomerIds || []),
                        newEntity.id,
                      ]),
                    );
                    updateCustomer({
                      ...selectedCustObj,
                      linkedCustomerIds: updatedLinks,
                    });
                  }
                } else {
                  setCustomerId(newEntity.id);
                }
              } else if (quickAddType === "project") {
                setProjectId(newEntity.id);
                if (newEntity.customerId) {
                  setCustomerId(newEntity.customerId);
                }
              } else if (
                quickAddType === "product" &&
                quickAddProductIndex !== null
              ) {
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
