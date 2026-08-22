import React, { useState } from "react";
import { useExchangeRates } from '../api/exchangeRates';
import { ACTIVITY_CATEGORY } from '../utils/activityCategories';
import { inlineDocumentAssets } from '../utils/inlineAssets';
import { namePrefixFor } from '../utils/honorific';
import {
  Plus,
  Search,
  Filter,
  FileText,
  Edit,
  Trash2,
  CheckCircle,
  Check,
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
  Copy,
  Package,
  Maximize2,
  Minimize2,
  Calculator,
  Warehouse,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  Proforma,
  Customer,
  Project,
  Product,
  ProductVariant,
  ProformaItem,
  ERPSettings,
  User,
} from "../types";
import { getTodayShamsi, addDaysToShamsi } from "../dateUtils";
import ShamsiDatePicker from "./ShamsiDatePicker";
import { getProformaOutcomeStatus } from "../useERPStore";
import { uploadFile } from "../imageUtils";
import ConfirmModal from "./ConfirmModal";
import DeleteActivitiesOption from './DeleteActivitiesOption';
import { SearchableSelect } from "./SearchableSelect";
import { ApiError } from "../api/client";
import { proformasApi } from "../api/proformas";
import { customersApi, type CustomerRow } from "../api/customers";
import { useEntitySearch } from "../api/useEntitySearch";
import { productsApi, type ProductRow } from "../api/products";
import { projectsApi, type ProjectRow } from "../api/projects";
import { createCustomerWithLinks, findServerDuplicates } from "../api/customerAdapter";
import { productToWriteInput, detailToProduct, rowToProduct } from "../api/productAdapter";
import { projectToWriteInput, detailToProject } from "../api/projectAdapter";
import { detailToProforma, proformaToWriteInput, rowToProforma } from "../api/proformaAdapter";
import { calcSeedOf } from "../api/productAdapter";
import { canSeeCosts } from "../utils/permissions";
import {
  COST_SOURCES, COST_SOURCE_LABELS, landedUnitCostOf, lineNeedsCost, linesMissingCost,
} from "../utils/costOfGoods";
import { isPartial } from "../api/partial";
import { useProformaList } from "../api/useProformaList";
import { useUserDirectory } from "../api/useUserDirectory";
import { useModuleNotes } from "../api/moduleNotes";
import QuickAddModal from "./QuickAddModal";
import { toPersianDigits, formatMoney } from "../numUtils";
import { printHtmlDocument } from "../utils/printDocument";
import { DocumentPreview } from "./DocumentPreview";
import ModuleNotesSection from "./ModuleNotesSection";
import CustomerAgreementAlert from "./CustomerAgreementAlert";
import { isFieldRequired, renderFieldLabelWithAsterisk } from "../utils/requiredFields";
import { buildCustomerOptions, buildCustomerOptionsFromSubset, familyNameOnly } from "../utils/customerLabel";
import { getContactInfoError } from "../utils/customerValidation";
import { getCodeError, cleanCode } from "../utils/documentCodes";
import type { DuplicateMatch } from "../utils/customerDuplicates";
import DuplicateCustomerModal from "./DuplicateCustomerModal";
import PriceCalculatorModal from "./PriceCalculatorModal";
import { getCombinedFeaturePrice } from "../utils/skuUtils";
import ProductConfiguratorModal from "./ProductConfiguratorModal";
import RichTextField from "./RichTextField";
import { renderRichText } from "../utils/richText";
import { attributesFromSelections, mergeSpecText, specLinesFrom } from "../utils/productConfig";
import { ensureVariantForAttributes, updateProductById as applyProductChange } from "../api/productVariants";
import { priceInWarehouseCurrency } from "../utils/finance";
import type { useCategoryCompletion } from "../api/useCategoryCompletion";

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

/**
 * Proformas screen.
 *
 * Reads through the API. The projects and customers it needs are the ones the
 * server joined onto the page's rows — the screen groups by project and labels
 * rows by customer, neither of which requires the whole table.
 */
interface ProformasViewProps {
  initialPrintDocId?: string;
  onClearInitialPrintDocId?: () => void;
  settings: ERPSettings;
  // The five proforma mutations are no longer props: the view calls the API
  // directly, so the totals and the derived outcome come back from the server
  // that computed them. Quick-add helpers (addCustomer, addProduct, updateCustomer)
  // are now defined locally and call the API directly.
  users?: User[];
  currentUser?: User | null;
  transactions?: any;
  packagingDeliveries?: any;
  categoryCompletion?: ReturnType<typeof useCategoryCompletion>;
}
export default function ProformasView({
  initialPrintDocId,
  onClearInitialPrintDocId,
  settings,
  currentUser = null,
  categoryCompletion,
}: ProformasViewProps) {
  // Rates are read here rather than handed down: they are a short shared list
  // that changes during the day, and a stale one misprices a document.
  const { rates: exchangeRates } = useExchangeRates();

  const list = useProformaList();
  const search = list.search;
  const setSearch = list.setSearch;

  /** The page of proformas, in the shape this screen's markup expects. */
  const proformas = React.useMemo(() => list.rows.map(rowToProforma), [list.rows]);

  /**
   * The projects and customers referenced by the page, assembled from what the
   * server joined onto each row. The screen groups by project and labels rows by
   * customer; neither needs the whole table for that.
   */
  const rowProjects = React.useMemo(() => {
    const seen = new Map<string, Project>();
    for (const row of list.rows) {
      if (row.project && !seen.has(row.project.id)) {
        seen.set(row.project.id, {
          id: row.project.id,
          code: row.project.code,
          name: row.project.name,
          status: row.project.status,
          customerId: row.project.customer?.id ?? row.customerId,
          // The group header prints this; it had no source at all and so read
          // «کارفرما: نامشخص» on every group.
          customerName: row.project.customer?.companyName ?? "",
        } as Project);
      }
    }
    return [...seen.values()];
  }, [list.rows]);


  /*
   * Every customer this screen might have to name or ask a question about.
   *
   * The buyers of the proformas on the page, *and* whatever the modal's picker
   * currently holds — which includes the buyer that is selected, pinned there
   * by the picker whether or not the search happens to return it.
   *
   * The page alone was not enough, and the consequences were not cosmetic. The
   * save path decided «is this buyer a company?» by looking the id up here, and
   * for a customer the page did not contain the answer was "no": the contact
   * and their honorific were dropped, and the stored buyer name became
   * "مشتری نامشخص". The picker's rows also carry the gender the form derives
   * the honorific from, which the page rows never did.
   *
   * Declared after the picker it reads, so the picker is defined above.
   */
  const pageCustomers = React.useMemo(() => {
    const seen = new Map<string, Customer>();
    for (const row of list.rows) {
      if (row.customer && !seen.has(row.customer.id)) {
        seen.set(row.customer.id, {
          id: row.customer.id,
          companyName: row.customer.companyName,
          customerType: row.customer.customerType,
        } as Customer);
      }
    }
    return [...seen.values()];
  }, [list.rows]);

  const { users } = useUserDirectory();

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
   * Quick-add helpers for inline forms — call the API directly rather than
   * relying on store methods passed as props.
   */
  const addCustomer = async (customer: Omit<Customer, "id" | "createdAt">) => {
    try {
      return await createCustomerWithLinks(customer as any);
    } catch (err) {
      reportError(err, 'ثبت مشتری با خطا مواجه شد.');
      return null;
    }
  };

  /**
   * Links a just-quick-added contact to the proforma's customer.
   *
   * A link is a relationship the server keeps on both sides, so it has its own
   * endpoint. This used to save the entire customer record instead, which never
   * persisted the link at all — `customerToWriteInput` deliberately omits it —
   * and, being fed from a picker row, blanked the customer's address and notes
   * on the way past.
   */
  const linkCustomerTo = async (customer: Customer | undefined, newId: string) => {
    if (!customer) return;
    const linked = Array.from(new Set([...(customer.linkedCustomerIds || []), newId]));
    try {
      await customersApi.setLinks(customer.id, linked);
    } catch (err) {
      reportError(err, 'ثبت ارتباط مشتری با خطا مواجه شد.');
    }
  };

  const addProduct = async (product: Omit<Product, "id" | "stockLevel"> & { stockLevel?: number }) => {
    try {
      const created = await productsApi.create(productToWriteInput(product as any));
      return detailToProduct(created);
    } catch (err) {
      reportError(err, 'ثبت کالا با خطا مواجه شد.');
      return null;
    }
  };

  /**
   * Writes a change back to a catalogue product, on top of the whole record.
   *
   * Pricing a line here updates the product or variant it came from — that is
   * the pre-migration behaviour, and it was safe while the store held complete
   * products. It is not safe now: `products` on this screen is the picker's
   * search projection, which hardcodes empty `variants`, `features`,
   * `configRules` and `images` and carries no price-calculator inputs. Writing
   * one of those back erased all of it, and replaced the product's variants
   * with whichever single one was being edited.
   *
   * So the caller says what to change and this loads the real record to change
   * it on.
   */
  const updateProductById = async (
    productId: string,
    mutate: (full: Product) => Product,
  ): Promise<Product | null> => {
    try {
      // One implementation, shared with the supplier-inquiry form; this wrapper
      // only adds the error reporting this screen wants.
      return await applyProductChange(productId, mutate);
    } catch (err) {
      reportError(err, 'ثبت تغییرات کالا با خطا مواجه شد.');
      return null;
    }
  };

  const addProject = async (project: Omit<Project, "id" | "code" | "creationDate"> & { customValues?: Record<string, any> }) => {
    try {
      const created = await projectsApi.create(projectToWriteInput(project as any));
      return detailToProject(created);
    } catch (err) {
      reportError(err, 'ثبت پروژه با خطا مواجه شد.');
      return null;
    }
  };

  /**
   * Writes, keeping the shapes the form already builds.
   *
   * Totals are not sent: the server recomputes every one from the lines it
   * stores, so the form's arithmetic is a preview rather than the record.
   */
  const addProforma = async (data: Partial<Proforma>) => {
    try {
      await proformasApi.create(proformaToWriteInput(data));
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت پیش‌فاکتور با خطا مواجه شد.');
    }
  };

  const updateProforma = async (pf: Proforma) => {
    try {
      await proformasApi.update(pf.id, proformaToWriteInput(pf));
      list.refresh();
    } catch (err) {
      reportError(err, 'ثبت تغییرات پیش‌فاکتور با خطا مواجه شد.');
    }
  };

  const updateProformaStatus = async (
    id: string,
    status: Proforma['status'],
    lossReason?: string,
    sentMethod?: string,
    sentRecipients?: string[],
  ) => {
    try {
      /*
       * The proforma as it stands, for its project and its outcome.
       *
       * Read from the server rather than from `list.rows`: a proforma the
       * current page does not contain gave no project id at all, and the prompt
       * below is skipped without one.
       */
      const oldProforma = list.rows.find(r => r.id === id)
        ?? await proformasApi.get(id).catch(() => null);
      const oldOutcome = oldProforma?.outcomeStatus;

      await proformasApi.update(id, {
        status,
        lossReason: lossReason ?? null,
        sentMethod: sentMethod ?? null,
        sentRecipients,
        // "Cancelled" is a flag rather than a status on the server, because the
        // outcome is otherwise derived from the lines.
        isCancelled: status === 'لغو شده',
      });
      list.refresh();

      // Check if we should prompt for category completion
      if (categoryCompletion && oldProforma?.projectId) {
        // Fetch the updated proforma to get the new outcome
        const updated = await proformasApi.get(id);
        const newOutcome = updated.outcomeStatus;

        // If outcome changed to winner or semi-winner, prompt
        if (oldOutcome !== newOutcome &&
            (newOutcome === 'تأیید شده (برنده)' || newOutcome === 'نیمه برنده')) {
          categoryCompletion.promptCompletion({
            projectId: oldProforma.projectId,
            categoryName: ACTIVITY_CATEGORY.PROFORMAS,
            message: `پیش‌فاکتور ${oldProforma.proformaNumber} تایید شد (${newOutcome === 'تأیید شده (برنده)' ? 'برنده' : 'نیمه برنده'}). آیا می‌خواهید وضعیت فعالیت‌های پیش‌فاکتور این پروژه را به «اتمام کار» تغییر دهید؟`
          });
        }
      }
    } catch (err) {
      reportError(err, 'تغییر وضعیت پیش‌فاکتور با خطا مواجه شد.');
    }
  };

  /**
   * Moves every proforma of a project to one status.
   *
   * Fetched rather than filtered from the page in hand: a project can easily
   * have proformas the current page does not show, and missing one would leave
   * the project's derived status wrong.
   */
  const batchUpdateProjectProformasStatus = async (
    projectId: string,
    status: Proforma['status'],
    lossReason?: string,
  ) => {
    try {
      const all = await proformasApi.listAll({ projectId });
      for (const row of all) {
        await proformasApi.update(row.id, {
          status,
          lossReason: lossReason ?? null,
          isCancelled: status === 'لغو شده',
        });
      }
      list.refresh();

      // Prompt for category completion when all proformas are lost or cancelled
      if (categoryCompletion && all.length > 0 && (status === 'باخته' || status === 'لغو شده')) {
        const actionMessage = status === 'لغو شده' ? 'لغو شدند' : 'باخت شدند';
        categoryCompletion.promptCompletion({
          projectId,
          categoryName: ACTIVITY_CATEGORY.PROFORMAS,
          message: `تمامی نسخه‌های پیش‌فاکتور پروژه با موفقیت ${actionMessage}. آیا می‌خواهید وضعیت فعالیت‌های پیش‌فاکتور این پروژه را به «اتمام کار» تغییر دهید؟`
        });
      }
    } catch (err) {
      reportError(err, 'تغییر وضعیت پیش‌فاکتورهای پروژه با خطا مواجه شد.');
    }
  };

  const [alsoRemoveActivities, setAlsoRemoveActivities] = useState(false);

  const deleteProforma = async (id: string, removeActivities = false) => {
    try {
      await proformasApi.remove(id, removeActivities);
      list.refresh();
    } catch (err) {
      // The server refuses while orders, transactions or deliveries point at it.
      reportError(err, 'حذف پیش‌فاکتور با خطا مواجه شد.');
    }
  };

  const selectedStatus = list.filters.status;
  const setSelectedStatus = (value: string) => list.setFilter('status', value);
  const [quickAddType, setQuickAddType] = useState<
    "customer" | "project" | "supplier" | "product" | null
  >(null);
  const [quickAddProductIndex, setQuickAddProductIndex] = useState<
    number | null
  >(null);
  const [isQuickAddingContact, setIsQuickAddingContact] = useState(false);
  const [isQuickAddingSentRecipient, setIsQuickAddingSentRecipient] = useState(false);
  // Row-level price calculator state
  const [calcModalItemIdx, setCalcModalItemIdx] = useState<number | null>(null);
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalFullscreen, setIsCreateModalFullscreen] = useState(false);
  const [editingProforma, setEditingProforma] = useState<Proforma | null>(null);
  const [showPrintView, setShowPrintView] = useState(false);
  /** The preview's document, built exactly as the printed one is. */
  const [previewHtml, setPreviewHtml] = useState("");
  const [selectedProforma, setSelectedProforma] = useState<Proforma | null>(
    null,
  );
  // Notes are their own records keyed by document, not a field on the proforma,
  // so they are never part of its write body — folding one into the record and
  // saving it discarded the note.
  const proformaNotes = useModuleNotes("proforma", selectedProforma?.id, (m) => alert(m));

  /** Which line is uploading, so its button can say so. */
  const [uploadingImageIndex, setUploadingImageIndex] = useState<number | null>(null);

  /**
   * Attaches a picture to one proforma line.
   *
   * Offered on every line, not only on catalogue products with images: a line
   * entered by hand is still a thing the customer is being quoted, and the
   * printed document gives it the same picture column.
   */
  const renderItemImageUpload = (idx: number, item: { selectedImage?: string }) => (
    <label
      className={`px-2 py-1 text-[9px] rounded border font-medium transition shrink-0 cursor-pointer ${
        uploadingImageIndex === idx
          ? "border-slate-200 text-slate-400"
          : "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300"
      }`}
    >
      {uploadingImageIndex === idx
        ? "در حال بارگذاری..."
        : item.selectedImage && item.selectedImage !== "none"
          ? "تغییر تصویر"
          : "بارگذاری تصویر"}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploadingImageIndex !== null}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (e.target) e.target.value = "";
          if (!file) return;
          setUploadingImageIndex(idx);
          try {
            const url = await uploadFile(file);
            handleItemFieldChange(idx, "selectedImage", url);
          } catch (err) {
            reportError(err, "بارگذاری تصویر کالا با خطا مواجه شد.");
          } finally {
            setUploadingImageIndex(null);
          }
        }}
      />
    </label>
  );

  /**
   * Product images for the document being printed.
   *
   * A line stores the image chosen for it, but lines written before that choice
   * existed carry none, and the fallback looked the product up in `products` —
   * the picker's current page. On a printed document that page is whatever was
   * last searched for, so the image was usually simply absent. The products this
   * document actually refers to are a short, known list, so they are fetched.
   */
  const [printImages, setPrintImages] = useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!selectedProforma) return;
    const ids = [...new Set(
      (selectedProforma.items ?? [])
        .filter((item) => item.productId && (!item.selectedImage || item.selectedImage === ""))
        .map((item) => item.productId as string),
    )];
    if (ids.length === 0) return;

    let cancelled = false;
    void (async () => {
      const found: Record<string, string> = {};
      await Promise.all(ids.map(async (id) => {
        try {
          const product = detailToProduct(await productsApi.get(id));
          const first = (product.images ?? [])[0];
          if (first) found[id] = first;
        } catch {
          // A missing product just means no picture; the row prints without one.
        }
      }));
      if (!cancelled && Object.keys(found).length > 0) {
        setPrintImages((prev) => ({ ...prev, ...found }));
      }
    })();

    return () => { cancelled = true; };
  }, [selectedProforma]);
  const [overrideShowBrand, setOverrideShowBrand] = useState(false);

  /*
   * The preview's document, rebuilt whenever what it shows changes.
   *
   * `printImages` is in the list on purpose: the photographs arrive from the
   * server after the panel opens, and without it the preview would keep the
   * version that had none while the PDF had them.
   */
  React.useEffect(() => {
    if (!showPrintView || !selectedProforma) { setPreviewHtml(""); return; }
    let cancelled = false;
    void (async () => {
      const html = await buildProformaDocument(selectedProforma);
      if (!cancelled && html) setPreviewHtml(html);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `settings` rather than the template derived from it: the template is
    // computed further down, and a hook may not reach below itself.
  }, [showPrintView, selectedProforma, overrideShowBrand, settings, printImages]);

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
  /*
   * A document opened straight into a print window by its id.
   *
   * Looked up in `proformas` — the page in hand. In a window opened for
   * printing that is page one of the list, so unless the document happened to
   * be on it nothing opened at all and the window stayed white. Asked for by
   * id instead, which is also the only way to get the prices: a list row does
   * not carry them.
   */
  React.useEffect(() => {
    if (!initialPrintDocId) return;
    let cancelled = false;
    void (async () => {
      try {
        const full = detailToProforma(await proformasApi.get(initialPrintDocId));
        if (!cancelled) handleOpenPrint(full);
      } catch (err) {
        console.error('could not load the proforma to print', err);
      }
    })();
    return () => { cancelled = true; };
  }, [initialPrintDocId]);

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
  /**
   * Opens the per-line status modal on the whole proforma.
   *
   * The modal writes the lines back, so it cannot start from a grid row: a row
   * carries each line's name, quantity and status but no price, so saving a
   * status change would have rewritten every line at zero.
   */
  const handleOpenItemsModal = async (row: Proforma) => {
    let pf: Proforma;
    try {
      pf = detailToProforma(await proformasApi.get(row.id));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات پیش‌فاکتور با خطا مواجه شد.');
      return;
    }

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
  /**
   * Saves the per-line outcomes.
   *
   * Deciding the lines is what wins a proforma, so this is where the prompt to
   * close the project's proforma category belongs — it used to live only on the
   * document-level status change, which is a different action entirely. Marking
   * the last line won therefore asked nothing at all, and the award-document
   * prompt turned up whenever the background watcher next polled, which looked
   * like it had been triggered by whatever the user clicked afterwards.
   */
  const handleSaveItemsStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = selectedProformaForItems;
    if (!target) return;

    /*
     * Refuse before the modal closes, not after.
     *
     * Closing first and letting the server reject the save would drop the
     * outcomes the user just set — they are only in this modal's state — and
     * leave nothing on screen to correct.
     */
    if (target.proformaType !== "TECHNICAL" && showCosts) {
      const uncosted = linesMissingCost(editingItemsList);
      if (uncosted.length > 0) {
        alert(
          "بهای تمام‌شده برای این ردیف‌ها مشخص نشده است:\n"
          + uncosted.map((l) => `• ${l.name}`).join("\n")
          + "\n\nبرای هر ردیف بهای تمام‌شده را وارد کنید،"
          + " یا اگر این ردیف بهای تمام‌شده‌ای ندارد گزینه «بدون بها» را بزنید.",
        );
        return;
      }
    }

    const before = target.outcomeStatus;
    setShowItemsModal(false);

    await updateProforma({
      ...target,
      items: editingItemsList,
      isCancelled: false,
      status: target.status === "لغو شده" ? "ارسال شده" : target.status,
    });

    if (!categoryCompletion || !target.projectId) return;
    try {
      const after = (await proformasApi.get(target.id)).outcomeStatus;
      if (after === before) return;
      if (after !== "تأیید شده (برنده)" && after !== "نیمه برنده") return;

      categoryCompletion.promptCompletion({
        projectId: target.projectId,
        categoryName: ACTIVITY_CATEGORY.PROFORMAS,
        message:
          `پیش‌فاکتور ${target.proformaNumber} `
          + `${after === "تأیید شده (برنده)" ? "برنده شد" : "به صورت نیمه برنده بسته شد"}.`
          + " آیا می‌خواهید وضعیت فعالیت‌های پیش‌فاکتور این پروژه را به «اتمام کار» تغییر دهید؟",
      });
    } catch (err) {
      // The outcomes were saved; failing to *offer* to close a category is not
      // worth an alert over.
      console.error("could not read the proforma outcome back", err);
    }
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
  /**
   * The cost of one line on the outcome screen.
   *
   * Same pairing as the edit form: the figure and its source move together, and
   * the currency is the document's. The proforma being edited here is the one
   * behind the modal, so its currency is read from that rather than from the
   * form state, which belongs to a different document.
   */
  const setEditingItemCost = (
    index: number,
    patch: Pick<ProformaItem, "unitCost" | "costSource">,
  ) => {
    setEditingItemsList(
      editingItemsList.map((item, idx) =>
        idx === index
          ? {
              ...item,
              ...patch,
              costCurrency: selectedProformaForItems?.currency || "ریال",
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
  // Editable proforma number. Blank on create means "generate it".
  const [proformaNumber, setProformaNumber] = useState("");
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

  // Duplicate-customer warning state for the inline quick-customer form
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([]);
  const [dupPayload, setDupPayload] = useState<any>(null);

  const commitQuickCustomer = async (custData: any) => {
    if (!addCustomer) return;
    const created = await addCustomer(custData);
    setDupMatches([]);
    setDupPayload(null);
    if (created && created.id) {
      // Pinned so the field it was created from can show it: the picker's
      // suggestions were fetched before this record existed.
      customerPicker.include(created as any);
      contactPicker.include(created as any);
      setCustomerId(created.id);
      setShowQuickCustomerModal(false);
    }
  };
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

  /**
   * Customer picker for the create/edit modal.
   *
   * `customers` (above) only contains customers that appear on the current
   * page's rows — on a fresh form the dropdown was empty. This picker queries
   * the API directly so every customer is searchable regardless of paging.
   */
  const modalOpen = showCreateModal || editingProforma !== null;
  const customerPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 50,
    enabled: modalOpen,
    selectedId: customerId || null,
    getLabel: (row) => row.companyName,
  });
  const modalCustomers = customerPicker.matches as unknown as Customer[];

  /** The page's buyers, plus whatever the picker holds. See `pageCustomers`. */
  const customers = React.useMemo(() => {
    const merged = new Map<string, Customer>();
    // Picker rows first: they are the fuller record — they carry the gender and
    // the person's name parts, which a page row does not.
    for (const c of modalCustomers) merged.set(c.id, c);
    for (const c of pageCustomers) if (!merged.has(c.id)) merged.set(c.id, c);
    return [...merged.values()];
  }, [modalCustomers, pageCustomers]);

  /**
   * The contact field searches separately.
   *
   * Both fields list customers, but sharing one picker would mean the term
   * typed into the buyer field decides what the contact field can offer — and
   * the other way round.
   */
  const contactPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 50,
    enabled: modalOpen && !!customerId,
    // Scoped on the server to people linked to the buyer, which is what the
    // field means. It used to be a client-side filter over the buyer picker's
    // page, so a contact that page did not happen to contain was unofferable.
    params: { customerType: 'حقیقی', linkedTo: customerId || undefined },
    selectedId: contactCustomerId || null,
    getLabel: (row) => row.companyName,
  });
  const contactCustomers = contactPicker.matches as unknown as Customer[];

  /**
   * The people a proforma can be recorded as sent to.
   *
   * Natural persons linked to the buyer — which is what the field means, and
   * which no page of customers reliably contains. Both places that ask the
   * question used to filter a list they already had in the browser: the create
   * form filtered the buyer picker's page, and the mark-as-sent modal filtered
   * the customers appearing on the current page of proformas. A linked person
   * outside either was simply unofferable, and the box read «مشتری حقیقی یافت
   * نشد» however many of them existed.
   *
   * Scoped on the server instead, by the same `linkedTo` filter the contact
   * field already uses. Links are stored in both directions, so this finds the
   * person whether the pair was linked from the company or from the person.
   */
  const recipientOwnerId = modalOpen
    ? customerId
    : (proformas.find((p) => p.id === statusTargetId)?.customerId ?? '');

  const recipientPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 50,
    enabled: !!recipientOwnerId,
    params: { customerType: 'حقیقی', linkedTo: recipientOwnerId || undefined },
    getLabel: (row) => row.companyName,
  });

  /**
   * The name to record for a person, and the one the field matches on.
   *
   * A natural person's record keeps their name in `firstName`/`lastName`;
   * `companyName` is filled for them too, so it is preferred and the parts are
   * the fallback.
   */
  const recipientName = (c: { companyName?: string; firstName?: string; lastName?: string }) =>
    c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();

  /**
   * The projects the form can choose from.
   *
   * The list below is assembled from the proformas on the page, which is right
   * for grouping the grid but wrong for the form: a project with no proforma
   * yet — exactly the one you are here to write the first proforma for — was
   * never in it. This asks the server instead.
   */
  const projectPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects',
    limit: 50,
    enabled: modalOpen,
    params: { withSummary: 'false' },
    selectedId: projectId || null,
    getLabel: (row) => row.name,
  });
  /**
   * What the rest of the screen calls `projects`: the ones the form can pick,
   * plus the ones the page's rows refer to. The form's lookups and the grid's
   * grouping both read this, so it has to satisfy both.
   */
  const projects = React.useMemo(() => {
    const merged = new Map<string, Project>();
    for (const row of projectPicker.matches) {
      merged.set(row.id, {
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        customerId: row.customerId,
        customerName: row.customer?.companyName ?? "",
      } as Project);
    }
    for (const p of rowProjects) if (!merged.has(p.id)) merged.set(p.id, p);
    return [...merged.values()];
  }, [projectPicker.matches, rowProjects]);

  /**
   * Product picker for the create/edit modal.
   *
   * Products were passed as a prop from store.products (database.json), which
   * could be stale or incomplete after migration. This picker queries the API
   * so every product is available and up-to-date.
   */
  const productPicker = useEntitySearch<ProductRow>({
    path: '/api/products',
    limit: 100,
    enabled: modalOpen,
    selectedId: null,
    getLabel: (row) => row.displayName,
  });
  // The list row already carries features, images and variants — `rowToProduct`
  // is what parses them. Blanking all three here is what hid the "کانفیگ کالا"
  // button (it renders only when the product has features), made SKU generation
  // build codes from no features, and made variant matching find nothing and
  // create a duplicate SKU every time. Config rules and the price-calculator
  // inputs are genuinely detail-only, which is why writes go through
  // `updateProductById` rather than sending one of these rows back.
  const products = productPicker.matches.map(rowToProduct);

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingProforma(null);
    setSentMethodType((settings?.dropdownItems?.proformaSentMethods || [])[0] || "ایمیل");
    setCustomSentMethod("");
    setSelectedSentRecipients([]);
    recipientPicker.setTerm("");
    setCustomerId("");
    setContactCustomerId("");
    setContactPrefix("");
    setProjectId("");
    setProformaType("FINANCIAL");
    setProformaNumber("");
    setIssueDate(getTodayShamsi());
    setExpiryDate(addDaysToShamsi(getTodayShamsi(), 30));

    const defaultItems = [
      {
        productId: products[0]?.id || "",
        productName: products[0]?.displayName || "",
        productCode: products[0]?.code || "",
        brand: products[0]?.brand || "",
        quantity: 1,
        unit: defaultUnitFor(products[0]?.unit),
        unitPriceRIYAL: 0,
        ...costPatchFor(products[0]),
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
  /**
   * Loads the whole proforma before filling the form.
   *
   * A grid row carries each line's name, quantity and status and nothing else —
   * no unit price, no product id, no discount, tax or notes. Populating the form
   * from one and saving rewrote every line at zero and wiped the document's
   * pricing, because the lines are replaced wholesale on write.
   *
   * The lock is checked first: the row already knows the status, so a locked
   * proforma never costs a request.
   */
  const handleOpenEdit = async (row: Proforma) => {
    const isAdmin = currentUser?.role === 'admin' || currentUser?.isSystemAdmin;
    if (row.status === "ارسال شده" && !isAdmin) {
      alert("این پیش‌فاکتور ارسال شده است و امکان ویرایش آن وجود ندارد.");
      return;
    }

    let pf: Proforma;
    try {
      pf = detailToProforma(await proformasApi.get(row.id));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات پیش‌فاکتور با خطا مواجه شد.');
      return;
    }

    setEditingProforma(pf);
    setProformaType(pf.proformaType || "FINANCIAL");
    setCustomerId(pf.customerId);
    setContactCustomerId(pf.contactCustomerId || "");
    setContactPrefix(pf.contactPrefix || "");
    setProjectId(pf.projectId || "");
    setProformaNumber(pf.proformaNumber || "");
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
    recipientPicker.setTerm("");

    const loadedItems = pf.items.map((item) => ({
      // The stored id travels with the line. It is what lets the server match
      // this line back on save — the only way a user who cannot see costs can
      // edit a document without erasing them.
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      productCode: item.productCode,
      brand: item.brand,
      tagNumber: item.tagNumber,
      quantity: item.quantity,
      unitPriceRIYAL: item.unitPriceRIYAL,
      // Carried through, not recomputed. This form writes the lines back, so a
      // cost dropped here is a cost erased from the record — and the figure is
      // a fact about the sale, not about what the product costs today.
      unitCost: item.unitCost ?? null,
      costCurrency: item.costCurrency ?? null,
      costSource: item.costSource ?? null,
      /*
       * The line's own outcome, and how it is to be supplied.
       *
       * Both were dropped here, and the edit form is what writes the lines
       * back — so opening a won proforma, changing nothing and saving rewrote
       * every line with no status at all, and the outcome derived from those
       * lines fell back to «جاری». A won proforma was demoted by being looked
       * at. `supplyMethod` going the same way silently moved every line back
       * to the default supply route.
       */
      status: item.status,
      supplyMethod: item.supplyMethod,
      lossReason: item.lossReason,
      selectedFeatures: item.selectedFeatures,
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

    // The cost is in the document's currency too, so it converts with the price
    // — the whole point of holding it that way is that the two stay comparable,
    // and converting one without the other would turn a 30% margin into
    // whatever the rate happens to be.
    const convert = (amount: number) => {
      const inRial = amount * (prevCurrency === "ریال" ? 1 : prevRate);
      const inNew = newCurrency === "ریال" ? inRial : inRial / newRate;
      return Math.round(inNew * 100) / 100;
    };

    const updatedItems = items.map((item) => ({
      ...item,
      unitPriceRIYAL: convert(item.unitPriceRIYAL),
      unitCost: item.unitCost === null || item.unitCost === undefined
        ? item.unitCost
        : convert(item.unitCost),
      costCurrency: item.costSource ? newCurrency : item.costCurrency,
    }));
    setItems(updatedItems);
  };
  // Add Item line
  /**
   * Selecting a project fills the buyer and the lines it asked for.
   *
   * This is what a proforma is *for*: the project records what the customer
   * wants, and the proforma prices it. It read `proj.itemsNeeded` off the
   * project list, which never carried the lines — they are children, and no
   * list projection includes them — so nothing was ever loaded and every
   * proforma had to be typed out again.
   *
   * The project's own record is fetched, and so is each product it names: their
   * prices, stock and technical description are not on a picker row either, and
   * the picker only holds whatever was last searched for.
   */
  const applyProjectSelection = async (projId: string) => {
    setProjectId(projId);
    if (!projId) return;

    let detail: Project;
    try {
      detail = detailToProject(await projectsApi.get(projId));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات پروژه با خطا مواجه شد.');
      return;
    }

    if (detail.customerId) setCustomerId(detail.customerId);

    const needed = detail.itemsNeeded ?? [];
    if (needed.length === 0) return;

    // One read per distinct catalogue product, not one per line.
    const ids = [...new Set(needed.map((i) => i.productId).filter(
      (id): id is string => !!id && id !== 'generic',
    ))];
    const catalogue = new Map<string, Product>();
    await Promise.all(ids.map(async (id) => {
      try {
        catalogue.set(id, detailToProduct(await productsApi.get(id)));
      } catch {
        // A line whose product has since been deleted still carries its name.
      }
    }));

    let overStock = false;
    const stockOf = (prod: Product | undefined, variantId?: string) => {
      if (!prod) return undefined;
      if (variantId) return prod.variants?.find((v) => v.id === variantId)?.stockLevel;
      return prod.stockLevel;
    };

    const newItems = needed.map((line) => {
      const prod = line.productId ? catalogue.get(line.productId) : undefined;
      const variant = prod?.variants?.find((v) => v.id === line.variantId);
      const stock = stockOf(prod, line.variantId);
      // A product supplied to order is never short: it is bought for the job.
      const toOrder = !prod || (prod.supplyType || 'INVENTORY') === 'ORDER' || stock === 0;
      if (!toOrder && stock !== undefined && line.quantity > stock) overStock = true;

      return {
        productId: line.productId === 'generic' ? '' : line.productId,
        variantId: line.variantId,
        productName: prod?.displayName || line.name,
        productCode: (variant?.sku ?? prod?.code) || '',
        brand: prod?.brand || '',
        quantity: line.quantity,
        unit: defaultUnitFor(prod?.unit),
        unitPriceRIYAL: prod ? getProductOrVariantPriceInProformaCurrency(prod, variant) : 0,
        ...costPatchFor(prod, variant),
        techSpecs: describeProduct(prod, variant),
        deliveryRange: '۳-۴',
        deliveryUnit: 'هفته' as const,
        deliveryType: 'کاری' as const,
        deliveryPostfix: 'پس از تایید پیش فاکتور و دریافت پیش پرداخت',
        tagNumber: line.tagNumber,
      };
    });

    if (overStock) {
      const keep = window.confirm(
        'هشدار انبار:\n'
        + 'تعداد برخی از اقلام درخواستی پروژه از موجودی انبار بیشتر است.\n'
        + 'آیا مایلید با وجود کسر موجودی، همان تعداد درخواستی پروژه ثبت شود؟\n'
        + 'در غیر این‌صورت، مقادیر به موجودی فعلی انبار محدود خواهند شد.',
      );
      if (!keep) {
        newItems.forEach((item, idx) => {
          const line = needed[idx];
          const prod = line.productId ? catalogue.get(line.productId) : undefined;
          const stock = stockOf(prod, line.variantId);
          const toOrder = !prod || (prod.supplyType || 'INVENTORY') === 'ORDER' || stock === 0;
          if (!toOrder && stock !== undefined && item.quantity > stock) item.quantity = stock;
        });
      }
    }

    setItems(newItems);
    setNotes((prev) => updateNotesWithDelivery(prev, newItems, isEqualDelivery));
    setDeliveryDate(getDeliverySummary(newItems));
  };

  const handleAddItemLine = () => {
    const firstProd = products[0];
    if (!firstProd) return;
    // Convert first product's IRR basePrice to the selected currency
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
        unit: defaultUnitFor(firstProd.unit),
        unitPriceRIYAL: 0,
        ...costPatchFor(firstProd),
        techSpecs: describeProduct(firstProd),
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
  /**
   * The technical description a proforma line carries.
   *
   * Two sources, in this order: what the configurator decided for this SKU, and
   * then what was typed into the product when it was defined in the inventory
   * module. Only the first was ever printed, so everything a colleague had
   * written about the equipment — the part the customer actually reads — never
   * reached the document.
   *
   * `previous` keeps whatever the user has typed on the line themselves: the
   * feature lines and the stored description are replaced, their own text is
   * not.
   */
  const describeProduct = (
    prod?: Product,
    variant?: ProductVariant,
    previous?: string,
  ): string => {
    const attributes = variant?.attributes ?? {};
    const configLines = Object.entries(attributes).map(([k, v]) => `${k}: ${v}`);
    const stored = (prod?.description || "").trim();

    // What the user wrote, minus the two things this function owns.
    const featureNames = prod?.features?.map((f) => f.name) ?? Object.keys(attributes);
    const storedLines = new Set(stored.split("\n").map((l) => l.trim()).filter(Boolean));
    const kept = (previous || "")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith("مشخصات:")) return false;
        if (storedLines.has(trimmed)) return false;
        return !featureNames.some((name) => trimmed.startsWith(`${name}:`));
      });

    return [...kept, ...configLines, ...(stored ? [stored] : [])]
      .filter(Boolean)
      .join("\n");
  };

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
        // A SKU follows its product's currency; its own column is a copy. So a
        // SKU that has none is read in the product's, not in a hardcoded euro —
        // which priced every unstamped SKU of a dollar product as if it were in
        // euros, quietly and only in the foreign column.
        const variantCurrencyEng = mapPersianCurrencyToEnglish(
          variant.currencyForeign || product.currencyForeign || "یورو",
        );
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

  /**
   * A line's cost, prefilled from the catalogue when the catalogue knows it.
   *
   * The same landed cost the price calculator would show, converted into the
   * proforma's currency by the same rate the price beside it uses. This is a
   * suggestion, not a fact about the sale: the user can overwrite it, and
   * whatever ends up on the line is what gets stored — which is the point of
   * storing it rather than looking it up again later.
   *
   * Everything null when the product has no calculator filled in. A blank is an
   * honest "nobody has said", and the save then asks; a zero would be a claim
   * that the goods were free.
   */
  const costPatchFor = (
    product?: Product,
    variant?: ProductVariant,
  ): Pick<ProformaItem, "unitCost" | "costCurrency" | "costSource"> => {
    const blank = { unitCost: null, costCurrency: null, costSource: null };
    if (!product) return blank;

    // One reader, shared with the server — see `landedUnitCostOf`. The SKU's own
    // calculator wins and one with none inherits the product's, which this side
    // used not to do: the same item then offered a figure in a report and an
    // empty box here.
    const landedRial = landedUnitCostOf(
      variant ? calcSeedOf(variant) : null,
      calcSeedOf(product),
    );
    if (landedRial === null) return blank;

    const proformaCurrencyEng = mapPersianCurrencyToEnglish(currency || "ریال");
    const proformaRate = (proformaCurrencyEng
      ? exchangeRates?.find((r) => r.currency === proformaCurrencyEng)?.rateToRIYAL
      : 1) || 1;

    return {
      unitCost: currency === "ریال"
        ? Math.round(landedRial)
        : Math.round((landedRial / proformaRate) * 100) / 100,
      costCurrency: currency || "ریال",
      costSource: COST_SOURCES.PRICE_CALCULATOR,
    };
  };

  /** The line whose price was just published, so the button can say so. */
  const [publishedPriceIdx, setPublishedPriceIdx] = useState<number | null>(null);

  /**
   * Puts a line's price into the warehouse, when the user asks for it.
   *
   * Deliberately a button and not a side effect of typing. A price on a
   * proforma is usually specific to that deal — a discount for this customer,
   * an urgency premium, a bundled figure — so pushing every number typed into a
   * line back to the catalogue would let one negotiation rewrite the list price
   * for everybody. The calculator writes back because opening a pricing tool
   * and pressing «اعمال» is an act of pricing the item; typing in a grid is not.
   *
   * What was missing was not the rule but any sign of it: from the user's seat
   * both are "I set the price of this SKU", and nothing said one propagated and
   * the other did not.
   */
  const publishPriceToWarehouse = async (index: number) => {
    const item = items[index];
    const prod = products.find((p) => p.id === item?.productId);
    if (!item || !prod) return;

    const price = Number(item.unitPriceRIYAL) || 0;
    if (price <= 0) {
      alert('ابتدا بهای واحد این ردیف را وارد کنید.');
      return;
    }

    const variant = item.variantId ? prod.variants?.find((v) => v.id === item.variantId) : undefined;

    /*
     * To rial at the document's own rate.
     *
     * `historicalExchangeRate` first: it is the rate this proforma is priced at,
     * so it is what its figures actually mean. Today's rate is the fallback for
     * a document that never recorded one.
     */
    const documentCurrency = currency || 'ریال';
    const rateFor = (persian: string): number => {
      if (!persian || persian === 'ریال') return 1;
      const eng = mapPersianCurrencyToEnglish(persian);
      return (eng ? exchangeRates?.find((r) => r.currency === eng)?.rateToRIYAL : 0) || 0;
    };
    const documentRate = documentCurrency === 'ریال'
      ? 1
      : Number(historicalExchangeRate) || rateFor(documentCurrency);
    if (!(documentRate > 0)) {
      alert('نرخ تسعیر این پیش‌فاکتور مشخص نیست، بنابراین معادل ریالی قیمت قابل محاسبه نیست.');
      return;
    }

    const priceRial = Math.round(price * documentRate);

    // The catalogue's own currency leads — every SKU under a product follows it.
    const warehouseCurrency = prod.currencyForeign || variant?.currencyForeign || documentCurrency;
    const priceForWarehouse = priceInWarehouseCurrency(
      price, priceRial, documentCurrency, warehouseCurrency, rateFor,
    );

    const target = variant ? `SKU ${variant.sku}` : prod.displayName;
    const current = variant
      ? (variant.priceRIYAL ?? 0)
      : (prod.basePriceRIYAL ?? 0);
    const confirmed = window.confirm(
      `قیمت فروش «${target}» در انبار به‌روزرسانی شود؟\n\n`
      + `قیمت فعلی انبار: ${formatMoney(Math.round(current))} ریال\n`
      + `قیمت جدید: ${formatMoney(priceRial)} ریال`
      + (priceForWarehouse === null
        ? '\n\nنرخ ارز انبار معلوم نیست، پس فقط مبلغ ریالی ثبت می‌شود.'
        : ` (${formatMoney(priceForWarehouse)} ${warehouseCurrency})`),
    );
    if (!confirmed) return;

    // Same shape as the calculator's write: the amount restated in the item's
    // own currency, and the currency itself restated rather than replaced.
    const warehousePrice = priceForWarehouse === null
      ? { currencyForeign: warehouseCurrency }
      : { priceForeign: priceForWarehouse, currencyForeign: warehouseCurrency };

    const saved = await updateProductById(prod.id, (full) => (variant
      ? {
          ...full,
          currencyForeign: warehouseCurrency,
          variants: (full.variants || []).map((v) =>
            v.id === variant.id ? { ...v, priceRIYAL: priceRial, ...warehousePrice } : v,
          ),
        }
      : { ...full, basePriceRIYAL: priceRial, ...warehousePrice }));

    if (!saved) return;
    setPublishedPriceIdx(index);
    window.setTimeout(() => setPublishedPriceIdx((n) => (n === index ? null : n)), 2500);
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
      // The product's own unit, so picking «متر» cable does not stay «عدد».
      unit: defaultUnitFor(prod.unit),
      unitPriceRIYAL: basePriceInSelectedCurrency,
      ...costPatchFor(prod),
      // No variant yet: the stored description alone, plus anything typed.
      techSpecs: describeProduct(prod, undefined, newItems[index].techSpecs),
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

    const newTechSpecs = describeProduct(prod, variant, item.techSpecs);

    const variantPrice = getProductOrVariantPriceInProformaCurrency(prod, variant);

    newItems[index] = {
      ...item,
      variantId: variant.id,
      productCode: variant.sku,
      quantity: currentQty,
      supplyMethod: effectiveSupplyType === "ORDER" ? "ORDER" : "INVENTORY",
      unitPriceRIYAL: variantPrice || item.unitPriceRIYAL,
      ...costPatchFor(prod, variant),
      techSpecs: newTechSpecs,
    };
    setItems(newItems);
  };

  // Handle Item fields modifications (generic to support strings or numbers)
  /*
   * The unit a line is counted in.
   *
   * The list is user-editable (تنظیمات ← لیست‌های بازشو ← واحدهای سنجش), so it
   * is read from there rather than hardcoded; «عدد» is only the fallback for a
   * settings record that has none, which is also why every printed document
   * used to say «عدد» whatever the goods were.
   */
  const unitOptions = settings?.dropdownItems?.units?.length
    ? settings.dropdownItems.units
    : ["عدد"];
  /** A catalogue product brings its own unit; anything else starts at the first. */
  const defaultUnitFor = (unit?: string) => unit || unitOptions[0];

  /**
   * Whether this user may see what the goods cost.
   *
   * The server already blanks the figures for anybody else, so this is the
   * courtesy half: without it they would be shown an empty cost box they cannot
   * fill and a save that refuses over it. The rule itself lives on the server —
   * hiding a column hides it from the person looking at the screen and from
   * nobody else.
   */
  const showCosts = canSeeCosts(currentUser);

  /**
   * Setting a line's cost, which is never one field on its own.
   *
   * `unitCost` and `costSource` have to move together: a figure with no source
   * cannot be told apart from the migration's guess, and a source with no figure
   * is not an answer. `costCurrency` is stamped from the document because that
   * is what the number is in — the server overwrites it with the same value, and
   * keeping the form honest about it means the margin shown here is the margin
   * that gets stored.
   */
  const setItemCost = (
    index: number,
    patch: Pick<ProformaItem, "unitCost" | "costSource">,
  ) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      ...patch,
      costCurrency: currency || "ریال",
    };
    setItems(newItems);
  };

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
    if (!customerId) {
      alert('لطفاً خریدار پیش‌فاکتور را انتخاب کنید.');
      return;
    }

    // Project-Proforma Customer Mismatch Check on Save
    // A SearchableSelect, so the browser enforces nothing; the asterisk beside
    // this field was decoration until now.
    if (isFieldRequired(settings, "proformas", "projectId") && !projectId) {
      alert("انتخاب پروژه برای این پیش‌فاکتور الزامی است.");
      return;
    }

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

    const proformaCodeError = getCodeError(
      'proforma', proformaNumber, proformas, 'proformaNumber', editingProforma?.id,
    );
    if (proformaCodeError) {
      alert(proformaCodeError);
      return;
    }

    /*
     * No line leaves here without a cost.
     *
     * The server refuses the save too — this is not the guard, it is the one
     * that can say which lines and let the user fix them without losing the
     * form. A technical proforma quotes no prices at all, so it has nothing to
     * cost.
     */
    if (proformaType !== "TECHNICAL" && showCosts) {
      const uncosted = linesMissingCost(formattedItems);
      if (uncosted.length > 0) {
        alert(
          "بهای تمام‌شده برای این ردیف‌ها مشخص نشده است:\n"
          + uncosted.map((l) => `• ${l.name}`).join("\n")
          + "\n\nبرای هر ردیف بهای تمام‌شده را وارد کنید،"
          + " یا اگر این ردیف بهای تمام‌شده‌ای ندارد گزینه «بدون بهای تمام‌شده» را بزنید.",
        );
        return;
      }
    }

    if (editingProforma) {
      updateProforma({
        ...editingProforma,
        proformaNumber: cleanCode(proformaNumber) || editingProforma.proformaNumber,
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
        proformaNumber: cleanCode(proformaNumber),
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
    recipientPicker.setTerm("");
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
  /**
   * Opens the print preview on the whole record.
   *
   * The grid hands this a row, and a row carries each line's name, quantity and
   * status but no price, no discount, no notes and no contact — so the preview
   * and the downloaded file were a document with zeros in every money column.
   * The full record is fetched first; the preview opens when it arrives.
   */
  const handleOpenPrint = async (pf: Proforma) => {
    let full = pf;
    if (isPartial(pf)) {
      try {
        full = detailToProforma(await proformasApi.get(pf.id));
      } catch (err) {
        reportError(err, 'بارگذاری پیش‌فاکتور برای چاپ با خطا مواجه شد.');
        return;
      }
    }
    setSelectedProforma(full);
    setOverrideShowBrand(!!settings.showProductBrandInDocuments);
    setShowPrintView(true);
  };
  /**
   * Copies a proforma into a new draft.
   *
   * The grid hands this a row, and a row carries each line's name, quantity and
   * status and nothing else — no price, no cost, no product id, no technical
   * specification. So the copy came out with empty lines, and the first thing
   * to notice was the cost check refusing the save: «بهای تمام‌شده برای این
   * ردیف‌ها مشخص نشده است», about lines whose cost had been filled in perfectly
   * well on the document being copied.
   *
   * `assertComplete` could not catch this one. It fires on a record spread into
   * a write payload, and this builds a fresh object literal, so the `__partial`
   * marker never reached it. The full record is fetched first, exactly as
   * `handleOpenPrint` above does.
   */
  const handleCopyProforma = async (pf: Proforma) => {
    let full = pf;
    if (isPartial(pf)) {
      try {
        full = detailToProforma(await proformasApi.get(pf.id));
      } catch (err) {
        reportError(err, 'بارگذاری پیش‌فاکتور برای کپی با خطا مواجه شد.');
        return;
      }
    }

    const copiedItems: ProformaItem[] = full.items.map((item, i) => ({
      ...item,
      id: `pfi-${Date.now()}-${i}`,
      status: "جاری",
      lossReason: undefined,
    }));
    addProforma({
      proformaType: full.proformaType || "FINANCIAL",
      customerId: full.customerId,
      customerName: full.customerName,
      contactCustomerId: full.contactCustomerId,
      contactName: full.contactName,
      contactPrefix: full.contactPrefix,
      projectId: full.projectId,
      projectName: full.projectName,
      issueDate: full.issueDate,
      expiryDate: full.expiryDate,
      deliveryDate: full.deliveryDate,
      status: "پیش‌نویس",
      currency: full.currency || "ریال",
      items: copiedItems,
      totalAmount: full.totalAmount,
      discountPercent: full.discountPercent,
      discountAmount: full.discountAmount,
      taxPercent: full.taxPercent,
      taxAmount: full.taxAmount,
      finalAmount: full.finalAmount,
      // Both come only with the detail record, and both belong to the
      // prices being copied: a document re-priced at today's rate against
      // yesterday's figures is not a copy of anything.
      extraCosts: full.extraCosts,
      historicalExchangeRate: full.historicalExchangeRate,
      notes: full.notes,
      customValues: full.customValues ? { ...full.customValues } : undefined,
    });
  };
  // Filter proformas
  const filteredProformas = proformas.filter((p) => {
    const matchesSearch =
      (p.proformaNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.projectName &&
        p.projectName.toLowerCase().includes(search.toLowerCase()));
    // The filter offers both kinds of value — پیش‌نویس and ارسال شده are where
    // the document is, the rest is what became of it — so it matches either.
    const matchesStatus =
      selectedStatus === "all" ||
      p.status === selectedStatus ||
      getProformaOutcomeStatus(p) === selectedStatus;
    return matchesSearch && matchesStatus;
  });
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
  /*
   * Money, in Latin digits, everywhere.
   *
   * These read `toLocaleString("fa-IR")` while the form beside them used a
   * plain `toLocaleString()`, so one proforma showed «۱۲٬۵۰۰٬۰۰۰» on the
   * summary and 12,500,000 on the line above it. Amounts get copied into bank
   * portals and spreadsheets; Persian digits survive neither.
   */
  const formatToman = (num: number) => `${formatMoney(num / 10)} تومان`;
  const mapPersianCurrencyToEnglish = (
    cur: string,
  ): "USD" | "EUR" | "AED" | "CNY" | undefined => {
    if (cur === "دلار") return "USD";
    if (cur === "یورو") return "EUR";
    if (cur === "درهم") return "AED";
    if (cur === "یوان") return "CNY";
    return undefined;
  };
  const formatCurrency = (num: number, cur?: Proforma["currency"]) =>
    `${formatMoney(num)} ${cur || "ریال"}`;
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
  /**
   * The proforma as a standalone HTML document, with its assets inlined.
   *
   * Split out from the export so the on-screen preview can show *this* rather
   * than a second, hand-written rendering of the same document — see
   * DocumentPreview. Everything below builds the file that gets printed.
   */
  const buildProformaDocument = async (pf: Proforma): Promise<string | null> => {
    const template = activeTemplate;
    if (!template) return null;
    const customerObj = customers.find((c) => c.id === pf.customerId);
    // The document addresses the contact by family name only — see familyNameOnly.
    const contactRecord = pf.contactCustomerId
      ? customers.find((c) => c.id === pf.contactCustomerId)
      : undefined;
    const contactFamilyName =
      familyNameOnly(pf.contactName, contactRecord?.lastName)
      || familyNameOnly(customerObj?.contactName, customerObj?.contactLastName);
    const creatorUser = pf.creatorId
      ? users.find((u) => u.id === pf.creatorId)
      : currentUser;
    const targetCurrency = pf.currency || "ریال";
    // The document no longer prints an exchange rate or a rial equivalent, so
    // nothing here needs today's rate — see the totals panel below.
    /*
     * The price columns are as wide as the longest amount on the document.
     *
     * Sized by eye, they were fine for a figure in a foreign currency — 1,620 —
     * and wrong for the same document priced in rials, where 1,250,000,000 is
     * thirteen characters and broke over two lines inside a fixed column. An
     * amount split across two lines stops being a number you can read at a
     * glance, so the column is measured from the longest figure instead.
     *
     * Monospace, so this is arithmetic rather than measurement: a character is
     * 0.6 of the font size. Past ten characters the figure is set a size
     * smaller rather than the column growing further — widening it enough for
     * twelve digits would take the width straight back off the specification,
     * which is the column that needs it.
     */
    const amountChars = Math.max(
      6,
      ...pf.items.flatMap((i) => [
        formatMoney(i.unitPriceRIYAL).length,
        formatMoney(i.totalPriceRIYAL).length,
      ]),
    );
    const priceFontPx = amountChars <= 10 ? 12 : amountChars <= 13 ? 11 : 10;
    // The floor is what gives the money columns their presence: a short figure
    // in a hairline column next to a very wide specification looked lopsided,
    // so they keep a decent width even when the amount does not need it.
    const priceColWidth = Math.min(
      128,
      Math.max(96, Math.round(amountChars * priceFontPx * 0.6) + 18),
    );

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
        <td style="padding: 10px; text-align: center; font-family: monospace; vertical-align: middle;">${index + 1}</td>
        <!-- The picture has a column of its own, and the name heads the
             specification it belongs to — the same shape as the preview on
             screen. Side by side, the name crowded a 48px thumbnail and the
             specs read as though they belonged to nothing. -->
        <td style="padding: 10px; text-align: center; vertical-align: middle;">
          ${
            imgToRender
              ? `<img src="${imgToRender}" alt="${item.productName}" style="width: 92px; height: 92px; object-fit: contain; border-radius: 8px; border: 1px solid #e2e8f0; background-color: #ffffff;" referrerPolicy="no-referrer" />`
              : `<div style="width: 92px; height: 92px; border: 1px dashed #e2e8f0; border-radius: 8px; background-color: #f8fafc; color: #94a3b8; font-size: 10px; display: flex; align-items: center; justify-content: center; margin: 0 auto;">بدون تصویر</div>`
          }
        </td>
        <!-- The specification is the one column that stays top-aligned: it is a
             block of text, and centring it against a short neighbour would
             leave the product name floating in the middle of the row. -->
        <td style="padding: 10px; vertical-align: top;">
          <!-- Left-aligned, like the specification beneath it: the names are
               Latin product names, and hanging them off the right-hand edge of
               an RTL cell put them at the opposite side of the text they
               belong to. -->
          <div style="font-weight: bold; color: #1e293b; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid #f1f5f9; text-align: left; direction: ltr;">
            ${item.productName}${overrideShowBrand && item.brand ? ` <span style="color: #4f46e5; font-size: 11px;">(${item.brand})</span>` : ""}${item.tagNumber ? ` <span style="font-family: monospace; font-size: 10px; color: #dc2626; background-color: #fef2f2; border: 1px solid #fee2e2; padding: 1px 5px; border-radius: 4px;">تگ: ${item.tagNumber}</span>` : ""}
          </div>
          <div style="font-size: 11px; color: #475569; white-space: pre-line; line-height: 1.5; text-align: left; direction: ltr;">
            ${item.techSpecs ? renderRichText(item.techSpecs) : "-"}
          </div>
        </td>
        <td style="padding: 10px; text-align: center; font-family: monospace; vertical-align: middle;">${item.quantity}</td>
        <td style="padding: 10px; text-align: center; vertical-align: middle;">${item.unit || prod?.unit || "عدد"}</td>
        ${
          pf.proformaType !== "TECHNICAL"
            ? `
        <!-- Bold: the figures are what the reader is looking for, and beside a
             block of specifications they were the lightest thing on the row. -->
        <td style="padding: 10px 6px; text-align: left; font-family: monospace; font-size: ${priceFontPx}px; font-weight: bold; color: #0f172a; vertical-align: middle; white-space: nowrap;">${formatMoney(item.unitPriceRIYAL)}</td>
        <td style="padding: 10px 6px; text-align: left; font-family: monospace; font-size: ${priceFontPx}px; font-weight: bold; color: #0f172a; vertical-align: middle; white-space: nowrap;">${formatMoney(item.totalPriceRIYAL)}</td>
        `
            : ""
        }
      </tr>
      `;
      })
      .join("");
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
            padding: 10px 12px;
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
        /* A column width means the whole column.
           With the default content-box sizing every one of these cells came out
           20px wider than asked for — its padding — and six columns quietly
           took 120px off the specification column. */
        th, td {
            box-sizing: border-box;
        }
        th {
            background-color: #f1f5f9;
            color: #475569;
            font-weight: bold;
            padding: 10px 6px;
            border-bottom: 1px solid #e2e8f0;
            /* Headings are centred over their column — the values below keep
               their own alignment (figures left, text right). */
            text-align: center;
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
        /* An amount stays on one line here too; the label beside it gives way
           instead, which costs nothing. */
        .totals-row strong,
        .totals-row .final-amount-value {
            white-space: nowrap;
        }
        .totals-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 3px 0;
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
        /*
         * The seal and signature, kept small on purpose.
         *
         * A proforma with a single item was printing on two pages, with nothing
         * on the second but this block — the stamp panel alone stood 100px tall
         * with 45px of margin above it. Everything here is sized so that one
         * item, its photograph and its specifications, the totals and the seal
         * all land on the same sheet.
         */
        .signatures {
            display: flex;
            justify-content: flex-end;
            margin-top: 6px;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .signature-box {
            padding-top: 4px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .signature-title {
            font-size: 10px;
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
        /*
         * «صفحه ۲ از ۳», printed in the page margin.
         *
         * Every sheet used to print "صفحه 1" — twice wrong. A page counter
         * reset sat in both the @page rule and the print body rule, and @page
         * applies to *each* page, so it was set back to one before every sheet
         * was numbered; and a counter read from a position-fixed element is 0
         * in Chromium regardless, because the element is painted once and
         * repeated rather than laid out per page. The number belongs in the
         * page's own margin box, which is the one place the browser resolves
         * counter(page) and counter(pages) per sheet.
         */
        /*
         * A real A4 page, with the margins the document wants.
         *
         * There was no size and no margin here, so every print used whatever
         * the browser felt like — which is where "the PDF quality is bad" came
         * from: default margins, the browser's own URL-and-date header across
         * the top, and page breaks landing in the middle of table rows.
         */
        @page {
            size: A4;
            margin: 12mm 10mm 16mm 10mm;
            @bottom-center {
                content: "صفحه " counter(page) " از " counter(pages);
                font-family: 'Vazirmatn', Tahoma, sans-serif;
                font-size: 9pt;
                color: #64748b;
            }
        }
        @media print {
            body {
                background-color: #ffffff;
                padding: 0;
                padding-bottom: 60px;
                /* Without this the browser drops every background colour and
                   the document prints as grey text on white. */
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .container {
                box-shadow: none;
                padding: 0;
            }
            /* A row, a signature block or a totals panel split across two pages
               reads as a mistake. */
            tr, .signature-box, .totals-box, .terms-box {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            thead {
                display: table-header-group;
            }
            tfoot {
                display: table-footer-group;
            }
            img {
                max-width: 100% !important;
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
                <div><span style="color: #64748b;">مخاطب:</span> ${customerObj?.customerType === "حقوقی" && pf.contactPrefix ? pf.contactPrefix + " " : ""}${contactFamilyName || "نماینده خریدار"}</div>
            </div>
        </div>
        <!-- Items Table -->
        <div class="table-container">
            <!--
                The specification column is the widest one, deliberately.
                It holds the product name and a dozen lines of technical
                detail, while every other column holds a short known value —
                but the row number, the photograph and the two price columns
                were sized generously and the text got whatever was left, so
                a specification line wrapped two or three times beside half
                empty neighbours. A fixed table layout makes these widths the
                real ones rather than suggestions.
            -->
            <table style="table-layout: fixed;">
                <thead>
                    <tr>
                        <th style="width: 34px;">ردیف</th>
                        <th style="width: 118px;">تصویر کالا</th>
                        <th>نوع کالا و مشخصات فنی</th>
                        <th style="width: 52px;">تعداد</th>
                        <th style="width: 56px;">واحد</th>
                        ${
                          pf.proformaType !== "TECHNICAL"
                            ? `
                        <th style="width: ${priceColWidth}px;">بهای واحد (${targetCurrency})</th>
                        <th style="width: ${priceColWidth}px;">بهای کل (${targetCurrency})</th>
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
                    <strong style="font-family: monospace;">${formatMoney(pf.totalAmount)} ${targetCurrency}</strong>
                </div>
                <div class="totals-row">
                    <span style="color: #64748b;">تخفیف کلی (${pf.discountPercent}%):</span>
                    <strong style="font-family: monospace; color: #dc2626;">-${formatMoney(pf.discountAmount)} ${targetCurrency}</strong>
                </div>
                <div class="totals-row">
                    <span style="color: #64748b;">مالیات بر ارزش افزوده (${pf.taxPercent}%):</span>
                    <strong style="font-family: monospace;">+${formatMoney(pf.taxAmount)} ${targetCurrency}</strong>
                </div>
                <div class="totals-row final-amount">
                    <span>مبلغ قابل پرداخت نهایی:</span>
                    <span class="final-amount-value" style="font-family: monospace; font-weight: bold;">${formatMoney(pf.finalAmount)} ${targetCurrency}</span>
                </div>
                <!--
                    No exchange rate and no rial equivalent.

                    They were printed under the total, and on a document quoted
                    in a foreign currency that reads as a second price: the rate
                    is the one of the day the document was produced, the invoice
                    will settle at the rate of the day the money moves, and a
                    customer comparing the two numbers is being confused by us.
                    The payment terms already say which rate governs.
                -->
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
            <div class="signature-box" style="width: 178px; border: 1px solid #f1f5f9; border-radius: 8px; padding: 4px 6px; background-color: #fafafa;">
                <div class="signature-title" style="margin-bottom: 2px; font-size: 8px;">مهر و امضای صادرکننده</div>
                <div class="signature-name" style="margin-bottom: 2px; font-size: 9px;">${creatorUser ? creatorUser.fullName : template.signatureLabel1}</div>
                <div style="margin-top: 2px;">
                    ${
                      template.companySealUrl
                        ? `
                        <div style="display: flex; justify-content: space-evenly; align-items: center; gap: 4px; height: 38px; background-color: #ffffff; border-radius: 6px; border: 1px dashed #cbd5e1; padding: 2px;">
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1;">
                                <span style="font-size: 6px; color: #94a3b8; font-weight: bold; margin-bottom: 0;">امضای صادرکننده</span>
                                ${
                                  creatorUser && creatorUser.signatureImage
                                    ? `
                                    <img src="${creatorUser.signatureImage}" alt="Signature" style="max-height: 30px; max-width: 62px; object-fit: contain;" referrerPolicy="no-referrer" />
                                `
                                    : `
                                    <span style="font-size: 10px; color: #cbd5e1; font-weight: bold;">فاقد امضا</span>
                                `
                                }
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; border-right: 1px solid #f1f5f9; padding-right: 6px;">
                                <span style="font-size: 6px; color: #94a3b8; font-weight: bold; margin-bottom: 0;">مهر شرکت</span>
                                <img src="${template.companySealUrl}" alt="Company Seal" style="max-height: 30px; max-width: 56px; object-fit: contain; transform: rotate(-3deg);" referrerPolicy="no-referrer" />
                            </div>
                        </div>
                    `
                        : `
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 38px; background-color: #ffffff; border-radius: 6px; border: 1px dashed #cbd5e1; padding: 2px;">
                            <span style="font-size: 6px; color: #94a3b8; font-weight: bold; margin-bottom: 0;">امضای صادرکننده</span>
                            ${
                              creatorUser && creatorUser.signatureImage
                                ? `
                                <img src="${creatorUser.signatureImage}" alt="Signature" style="max-height: 32px; max-width: 130px; object-fit: contain;" referrerPolicy="no-referrer" />
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
    // Same as the packing list: the logo, seal, signature and product photos
    // are `/uploads/…` paths that resolve to nothing outside the application.
    return inlineDocumentAssets(htmlContent);
  };

  /*
   * Straight to the print dialog, where "Save as PDF" lives.
   *
   * This used to download the page as an `.html` file, which the user then had
   * to find, open and print — four steps for one PDF, and a file left in
   * Downloads that nobody wanted. The same document is printed directly
   * instead, by the browser's own engine, so the text in the resulting PDF is
   * real text rather than a picture of text.
   */
  const exportProformaPdf = async (pf: Proforma) => {
    const standalone = await buildProformaDocument(pf);
    if (!standalone) return;
    // The saved file is named after the document, not after the application —
    // «ATA-05-26-C1.pdf», which is what it is filed under everywhere else.
    await printHtmlDocument(standalone, pf.proformaNumber);
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
                  onClick={() => { void exportProformaPdf(selectedProforma); }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-emerald-600/10"
                  title="سند در پنجره چاپ باز می‌شود؛ مقصد را روی «ذخیره به صورت PDF» بگذارید"
                >
                  <FileSpreadsheet size={16} />
                  خروجی PDF
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
            {/* The document itself — the same HTML the PDF is made of. */}
            <DocumentPreview html={previewHtml} />


            {/* Proforma Global Module Notes & Agreements (Hidden on Print) */}
            <div className="print:hidden mt-8 text-right border-t border-slate-200 pt-8">
              <ModuleNotesSection
                notes={proformaNotes.notes}
                currentUser={currentUser}
                title="توافقات خاص و کامنت‌های این پیش‌فاکتور"
                placeholder="یادداشت یا کامنت جدید درباره شرایط پرداخت، تخفیفات، یا توافقات خاص مشتری بنویسید..."
                onAddNote={proformaNotes.addNote}
                onDeleteNote={proformaNotes.deleteNote}
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
                        {/* The document number is the column people scan the
                            grid by and it was the narrowest one, so a number
                            like ATA-05-26-C1 wrapped or was cut; the goods
                            column had 300px it did not need. */}
                        <th className="p-4 w-44">شماره نسخه/سند</th>
                        <th className="p-4 w-44">تاریخ صدور / انقضا</th>
                        <th className="p-4 min-w-[200px]">مشتری/اقلام</th>
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
                            <span className="font-mono font-extrabold text-slate-900 text-sm block whitespace-nowrap">
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
                                  return `تسعیر: ${formatMoney(pf.finalAmount * rate)} ریال`;
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
                                <div className="flex flex-col items-center gap-1.5">
                                  {/* Row 1: Icon buttons */}
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => handleOpenPrint(pf)}
                                      className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-md transition"
                                      title="مشاهده و چاپ"
                                    >
                                      <Eye size={15} />
                                    </button>
                                    <button
                                      onClick={() => { if (!isLocked) void handleOpenEdit(pf); }}
                                      disabled={isLocked}
                                      className={`p-1.5 rounded-md transition ${
                                        isLocked
                                          ? "text-slate-300 cursor-not-allowed"
                                          : "text-amber-600 hover:bg-amber-50"
                                      }`}
                                      title={isLocked ? "قفل شده" : "ویرایش"}
                                    >
                                      <Edit size={15} />
                                    </button>
                                    <button
                                      onClick={() => void handleCopyProforma(pf)}
                                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition"
                                      title="کپی"
                                    >
                                      <Copy size={15} />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (isLocked) return;
                                        setProformaToDeleteId(pf.id);
                                        setProformaToDeleteNumber(pf.proformaNumber || "");
                                        setDeleteConfirmOpen(true);
                                      }}
                                      disabled={isLocked}
                                      className={`p-1.5 rounded-md transition ${
                                        isLocked
                                          ? "text-slate-300 cursor-not-allowed"
                                          : "text-slate-400 hover:text-red-600 hover:bg-red-50"
                                      }`}
                                      title={isLocked ? "قفل شده" : "حذف"}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                  {/* Row 2: Text action buttons */}
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => handleOpenStatusChange(pf.id, pf.status)}
                                      className="px-2 py-1 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-[10px] font-bold transition flex items-center gap-1"
                                      title="تغییر وضعیت کلی"
                                    >
                                      <Settings size={10} />
                                      وضعیت
                                    </button>
                                    <button
                                      onClick={() => { void handleOpenItemsModal(pf); }}
                                      className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-md text-[10px] font-bold transition"
                                      title="مدیریت ردیف‌ها"
                                    >
                                      ردیف‌ها
                                    </button>
                                  </div>
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
        {/* Nothing to report before the first response — showing "none found"
            while still loading reads as an empty database. */}
        {list.initialLoading && (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
            <Loader2 className="mx-auto text-slate-300 mb-3 animate-spin" size={40} />
            در حال دریافت اطلاعات…
          </div>
        )}

        {list.error && !list.initialLoading && (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
            <p className="text-sm text-rose-600 font-medium">{list.error}</p>
            <button
              onClick={() => list.refresh()}
              className="mt-3 text-xs text-sky-600 hover:underline font-bold"
            >
              تلاش دوباره
            </button>
          </div>
        )}

        {filteredProformas.length === 0 && !list.initialLoading && !list.error && (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
            <FileText className="mx-auto text-slate-300 mb-3" size={40} />
            هیچ فاکتور یا پیش‌فاکتوری با معیارهای مدنظر شما یافت نشد.
          </div>
        )}

        {/* Pagination. The screen groups one page by project; these move between pages. */}
        {list.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-slate-100 bg-white flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium">
              نمایش {list.rows.length.toLocaleString('fa-IR')} از {list.total.toLocaleString('fa-IR')} پیش‌فاکتور
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
                            value={recipientPicker.term}
                            onChange={(e) => recipientPicker.setTerm(e.target.value)}
                            placeholder="جستجوی نام شخص (مشتری حقیقی)..."
                            className="w-full border border-slate-200 rounded-lg pr-8 pl-3 py-1.5 text-[11px] focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                          />
                          <div className="absolute right-2.5 top-2 text-slate-400">
                            <Search size={12} />
                          </div>
                          
                          <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                            {(() => {
                              // Scoped and searched by the server; see recipientPicker.
                              const filtered = recipientPicker.matches as unknown as Customer[];

                              // Three different situations, and one message used
                              // to cover all of them.
                              if (!recipientOwnerId) {
                                return <div className="p-2 text-[10px] text-slate-400 text-center">ابتدا کارفرما را انتخاب کنید.</div>;
                              }
                              if (recipientPicker.loading) {
                                return <div className="p-2 text-[10px] text-slate-400 text-center">در حال جستجو…</div>;
                              }
                              if (filtered.length === 0) {
                                return (
                                  <div className="p-2 text-[10px] text-slate-400 text-center">
                                    {recipientPicker.term
                                      ? 'مشتری حقیقی با این نام یافت نشد.'
                                      : 'هیچ مشتری حقیقی به این کارفرما متصل نشده است.'}
                                  </div>
                                );
                              }
                              
                              return filtered.map(c => {
                                const fullName = recipientName(c);
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
                                      recipientPicker.setTerm("");
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
                      {/*
                        The cost belongs here, not only on the edit form: this is
                        the screen where a line becomes a sale, and a line marked
                        won with no cost is the one that corrupts the customer
                        ranking. Documents written before the cost existed get
                        answered here rather than dead-ending on save.
                      */}
                      {showCosts && (
                        <th className="py-3 px-4 text-center w-44">
                          بهای تمام‌شده واحد
                        </th>
                      )}
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
                          {item.unit ? <span className="text-slate-400 text-[10px] font-normal mr-1">{item.unit}</span> : null}
                        </td>
                        <td className="py-3 px-4 text-left font-mono text-slate-600">
                          {formatMoney(item.quantity * item.unitPriceRIYAL)}
                        </td>
                        {showCosts && (
                        <td className="py-3 px-4 text-center">
                          {(() => {
                            const noCost = item.costSource === COST_SOURCES.NONE;
                            return (
                              <div className="space-y-1">
                                <input
                                  type="number"
                                  value={noCost ? "" : (item.unitCost ?? "")}
                                  disabled={noCost}
                                  placeholder="وارد کنید"
                                  onChange={(e) =>
                                    setEditingItemCost(idx, {
                                      unitCost: e.target.value === ""
                                        ? null
                                        : Math.max(0, Number(e.target.value)),
                                      costSource: e.target.value === ""
                                        ? null
                                        : COST_SOURCES.MANUAL,
                                    })
                                  }
                                  className={`w-full rounded px-2 py-1 text-xs font-mono text-left bg-white border disabled:bg-slate-100 ${
                                    lineNeedsCost(item)
                                      ? "border-amber-300 bg-amber-50/60"
                                      : "border-slate-200"
                                  }`}
                                />
                                <label className="flex items-center justify-center gap-1 text-[10px] text-slate-500 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={noCost}
                                    onChange={(e) =>
                                      setEditingItemCost(idx, e.target.checked
                                        ? { unitCost: 0, costSource: COST_SOURCES.NONE }
                                        : { unitCost: null, costSource: null })
                                    }
                                    className="accent-slate-500"
                                  />
                                  بدون بها
                                </label>
                              </div>
                            );
                          })()}
                        </td>
                        )}
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
                    {renderFieldLabelWithAsterisk(settings, 'proformas', 'projectId', 'کد پروژه')}
                  </label>
                  <div className="flex gap-1.5 items-center w-full min-w-0">
                    <SearchableSelect
                      wrapperClassName="flex-1 min-w-0"
                      value={projectId}
                      onChange={(val) => { void applyProjectSelection(val); }}
                      onSearchChange={projectPicker.setTerm}
                      loading={projectPicker.loading}
                      options={[
                        { value: "", label: "بدون پروژه (خرید مستقیم)" },
                        // The picker's own matches, not the merged list the grid
                        // reads: that one also carries the projects the page's
                        // rows refer to, which the search never asked for.
                        ...projectPicker.matches.map((p) => ({
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
                        const selectedCust = modalCustomers.find(
                          (c) => c.id === newCustId,
                        );
                        if (
                          selectedCust &&
                          selectedCust.customerType === "حقیقی"
                        ) {
                          setContactPrefix(namePrefixFor(selectedCust.gender));
                        } else {
                          setContactPrefix("");
                        }
                      }}
                      required={isFieldRequired(settings, 'proformas', 'customerId')}
                      onSearchChange={customerPicker.setTerm}
                      loading={customerPicker.loading}
                      options={[
                        { value: "", label: "-- انتخاب مشتری --" },
                        ...buildCustomerOptions(modalCustomers),
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
                      customer={modalCustomers.find(c => c.id === customerId)}
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
                  const selectedCustObj = modalCustomers.find(
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
                  const selectedCustObj = modalCustomers.find(
                    (c) => c.id === customerId,
                  );
                  const isLegalCustomer =
                    selectedCustObj?.customerType === "حقوقی";
                  // The linked contacts the server found, plus the namesake
                  // fallback this field has always had.
                  const filteredContacts = isLegalCustomer
                    ? [
                        ...contactCustomers,
                        ...modalCustomers.filter(
                          (c) =>
                            c.customerType === "حقیقی" &&
                            c.companyName === selectedCustObj.companyName &&
                            !contactCustomers.some((k) => k.id === c.id),
                        ),
                      ]
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
                              const selectedContact = modalCustomers.find(
                                (c) => c.id === newContactId,
                              );
                              if (selectedContact) {
                                setContactPrefix(namePrefixFor(selectedContact.gender));
                              } else {
                                setContactPrefix("");
                              }
                            }}
                            required={isFieldRequired(settings, 'proformas', 'contactCustomerId')}
                            onSearchChange={contactPicker.setTerm}
                            loading={contactPicker.loading}
                            options={[
                              { value: "", label: "-- انتخاب مخاطب --" },
                              ...buildCustomerOptionsFromSubset(filteredContacts, [...contactCustomers, ...modalCustomers]),
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

                {/* Proforma number (editable; blank on create = auto-generate) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 flex justify-between items-center">
                    <span>شماره پیش‌فاکتور</span>
                    {!editingProforma && (
                      <span className="text-[10px] text-slate-400 font-normal">
                        خالی = ساخت خودکار
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={proformaNumber}
                    onChange={(e) => setProformaNumber(e.target.value)}
                    placeholder={editingProforma ? "" : "اختیاری"}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono bg-white"
                    dir="ltr"
                  />
                </div>

                {/* Dates */}
                <div
                  className="space-y-1.5"
                  id="proforma-issue-date-picker-wrapper"
                >
                  <ShamsiDatePicker
                    label={renderFieldLabelWithAsterisk(settings, 'proformas', 'issueDate', 'تاریخ صدور پیشنهاد')}
                    required={isFieldRequired(settings, 'proformas', 'issueDate')}
                    value={issueDate}
                    onChange={(val) => setIssueDate(val)}
                  />
                </div>
                <div
                  className="space-y-1.5"
                  id="proforma-expiry-date-picker-wrapper"
                >
                  <ShamsiDatePicker
                    label={renderFieldLabelWithAsterisk(settings, 'proformas', 'expiryDate', 'تاریخ انقضای اعتبار پیشنهاد')}
                    required={isFieldRequired(settings, 'proformas', 'expiryDate')}
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
                            value={recipientPicker.term}
                            onChange={(e) => recipientPicker.setTerm(e.target.value)}
                            placeholder="جستجوی نام شخص (مشتری حقیقی)..."
                            className="w-full border border-slate-200 rounded-lg pr-8 pl-3 py-1.5 text-[11px] focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                          />
                          <div className="absolute right-2.5 top-2 text-slate-400">
                            <Search size={12} />
                          </div>
                          
                          <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                            {(() => {
                              // Scoped and searched by the server; see recipientPicker.
                              const filtered = recipientPicker.matches as unknown as Customer[];

                              // Three different situations, and one message used
                              // to cover all of them.
                              if (!recipientOwnerId) {
                                return <div className="p-2 text-[10px] text-slate-400 text-center">ابتدا کارفرما را انتخاب کنید.</div>;
                              }
                              if (recipientPicker.loading) {
                                return <div className="p-2 text-[10px] text-slate-400 text-center">در حال جستجو…</div>;
                              }
                              if (filtered.length === 0) {
                                return (
                                  <div className="p-2 text-[10px] text-slate-400 text-center">
                                    {recipientPicker.term
                                      ? 'مشتری حقیقی با این نام یافت نشد.'
                                      : 'هیچ مشتری حقیقی به این کارفرما متصل نشده است.'}
                                  </div>
                                );
                              }
                              
                              return filtered.map(c => {
                                const fullName = recipientName(c);
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
                                      recipientPicker.setTerm("");
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
                    {renderFieldLabelWithAsterisk(settings, 'proformas', 'currency', 'نوع ارز پیش‌فاکتور')}
                  </label>
                  <select
                    value={currency}
                    onChange={(e) =>
                      handleCurrencyChange(
                        e.target.value as Proforma["currency"],
                      )
                    }
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white font-bold text-emerald-700 border-emerald-300"
                    required={isFieldRequired(settings, 'proformas', 'currency')}
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
                          getProformaOutcomeStatus(editingProforma) === "تأیید شده (برنده)" &&
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
                      proformaType === "TECHNICAL" ? "col-span-8" : "col-span-4"
                    }
                  >
                    انتخاب کالا
                  </div>
                  <div className="col-span-3 text-center">تعداد و واحد</div>
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
                              ? "col-span-2 md:col-span-8 w-full min-w-0"
                              : "col-span-2 md:col-span-4 w-full min-w-0"
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
                                    onSearchChange={productPicker.setTerm}
                                    loading={productPicker.loading}
                                    options={[
                                      { value: "", label: "-- انتخاب کالا --" },
                                      // A row's own product must stay selectable whatever is
                                      // being searched for: every row shares one options list,
                                      // so typing in one would otherwise blank the others.
                                      ...(item.productId && !products.some(p => p.id === item.productId)
                                        ? [{ value: item.productId, label: item.productName || item.productId }]
                                        : []),
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
                                    // A cost read off the catalogue described
                                    // the product that just left the line, so it
                                    // goes with it. An answer somebody typed
                                    // stays — it was about this line.
                                    if (
                                      item.costSource === COST_SOURCES.PRICE_CALCULATOR
                                      || item.costSource === COST_SOURCES.PURCHASE_ORDER
                                      || item.costSource === COST_SOURCES.BACKFILL
                                    ) {
                                      newItems[idx].unitCost = null;
                                      newItems[idx].costSource = null;
                                    }
                                  } else {
                                    // Switch to Select from List
                                    const firstP = products[0];
                                    if (firstP) {
                                      newItems[idx].productId = firstP.id;
                                      newItems[idx].productName =
                                        firstP.displayName;
                                      newItems[idx].productCode = firstP.code;
                                      newItems[idx].brand = firstP.brand;
                                      newItems[idx].unitPriceRIYAL =
                                        getProductOrVariantPriceInProformaCurrency(firstP);
                                      Object.assign(newItems[idx], costPatchFor(firstP));
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
                        {/* Quantity and its unit */}
                        <div className="col-span-1 md:col-span-3 flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-slate-400 md:hidden block">
                            تعداد و واحد *
                          </label>
                          <div className="flex items-center gap-1.5">
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
                              className="w-full min-w-0 flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center bg-white"
                            />
                            {/* The unit the line is quoted in — «عدد», «متر»,
                                «ست» … — from the settings list. It is stored on
                                the line, so the document keeps what it was
                                quoted in even if the catalogue changes later. */}
                            <select
                              value={item.unit || defaultUnitFor()}
                              onChange={(e) =>
                                handleItemFieldChange(idx, "unit", e.target.value)
                              }
                              title="واحد شمارش"
                              className="w-20 shrink-0 border border-slate-200 rounded-lg px-1 py-1.5 text-xs bg-white text-center"
                            >
                              {/* A line saved under a unit later removed from
                                  the settings list still shows its own. */}
                              {(unitOptions.includes(item.unit || "")
                                ? unitOptions
                                : [...(item.unit ? [item.unit] : []), ...unitOptions]
                              ).map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {proformaType !== "TECHNICAL" && (
                          <>
                            {/* Unit Price */}
                            <div className="col-span-1 md:col-span-2 flex flex-col gap-1">
                              <label className="text-[10px] font-bold text-slate-400 md:hidden block">
                                بهای واحد ({currency}) *
                              </label>
                              <div className="flex items-center gap-1">
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
                                {/*
                                  The calculator is a breakdown of what the item
                                  cost, and the product it seeds from arrives
                                  blanked for this user anyway — so it would open
                                  on a row of zeros.
                                */}
                                {item.productId && showCosts && (
                                  <button
                                    type="button"
                                    onClick={() => setCalcModalItemIdx(idx)}
                                    className="p-1.5 text-sky-600 hover:bg-sky-50 hover:text-sky-700 rounded-lg transition-colors flex items-center justify-center flex-shrink-0 border border-sky-100 bg-white"
                                    title="محاسبه‌گر قیمت فروش"
                                  >
                                    <Calculator size={13} />
                                  </button>
                                )}
                                {/*
                                  Publishing a typed price is deliberate, and now
                                  visible. Without it nothing said that the
                                  calculator writes back to the catalogue and
                                  typing here does not — see
                                  `publishPriceToWarehouse`. Not gated on
                                  `showCosts`: a sale price is what the company
                                  charges, and the warehouse needs it.
                                */}
                                {item.productId && (
                                  <button
                                    type="button"
                                    onClick={() => publishPriceToWarehouse(idx)}
                                    className={`p-1.5 rounded-lg transition-colors flex items-center justify-center flex-shrink-0 border bg-white ${
                                      publishedPriceIdx === idx
                                        ? 'text-emerald-600 border-emerald-200'
                                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-slate-200'
                                    }`}
                                    title="ثبت این قیمت به‌عنوان قیمت فروش کالا در انبار"
                                  >
                                    {publishedPriceIdx === idx
                                      ? <CheckCircle2 size={13} />
                                      : <Warehouse size={13} />}
                                  </button>
                                )}
                              </div>
                            </div>
                            {/* Total price for line */}
                            <div className="col-span-1 md:col-span-2 flex flex-col justify-center text-left px-2">
                              <label className="text-[10px] font-bold text-slate-400 md:hidden block text-right">
                                بهای کل ردیف
                              </label>
                              <div className="font-mono font-bold text-xs text-slate-700 py-1.5 text-left md:text-left">
                                {formatMoney(item.quantity * item.unitPriceRIYAL)}{" "}
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
                      {/*
                        Every line's cost, on its own row.

                        The grid above is full, and this needs three controls
                        rather than one: the figure, an explicit "there isn't
                        one", and what the margin comes out at. A line saved
                        without any of them is refused — an uncosted sale reads
                        as pure profit in the customer ranking, which is the
                        expensive kind of wrong.
                      */}
                      {proformaType !== "TECHNICAL" && showCosts && (() => {
                        const noCost = item.costSource === COST_SOURCES.NONE;
                        const missing = lineNeedsCost(item);
                        const cost = Number(item.unitCost ?? 0);
                        const revenue = item.quantity * item.unitPriceRIYAL;
                        const margin = revenue > 0
                          ? Math.round(((revenue - cost * item.quantity) / revenue) * 1000) / 10
                          : null;

                        return (
                          <div
                            className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${
                              missing
                                ? "border-amber-300 bg-amber-50/70"
                                : "border-slate-200 bg-slate-50/70"
                            }`}
                          >
                            <label className="text-[10px] font-bold text-slate-500 shrink-0">
                              بهای تمام‌شده واحد ({currency})
                              <span className="text-rose-500"> *</span>
                            </label>
                            <input
                              type="number"
                              value={noCost ? "" : (item.unitCost ?? "")}
                              disabled={noCost}
                              placeholder={noCost ? "—" : "وارد کنید"}
                              onChange={(e) =>
                                setItemCost(idx, {
                                  unitCost: e.target.value === ""
                                    ? null
                                    : Math.max(0, Number(e.target.value)),
                                  costSource: e.target.value === ""
                                    ? null
                                    : COST_SOURCES.MANUAL,
                                })
                              }
                              className="w-32 border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono text-left bg-white disabled:bg-slate-100 disabled:text-slate-400"
                            />

                            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={noCost}
                                onChange={(e) =>
                                  setItemCost(idx, e.target.checked
                                    ? { unitCost: 0, costSource: COST_SOURCES.NONE }
                                    : { unitCost: null, costSource: null })
                                }
                                className="accent-slate-500"
                              />
                              بدون بهای تمام‌شده
                            </label>

                            {item.costSource && (
                              <span className="text-[10px] text-slate-400">
                                ({COST_SOURCE_LABELS[item.costSource]})
                              </span>
                            )}

                            {!missing && !noCost && margin !== null && (
                              <span
                                className={`text-[10px] font-bold font-mono mr-auto ${
                                  margin < 0 ? "text-rose-600" : "text-emerald-600"
                                }`}
                              >
                                حاشیه سود: {margin}%
                              </span>
                            )}

                            {missing && (
                              <span className="text-[10px] font-bold text-amber-700 mr-auto">
                                برای ذخیره، بهای تمام‌شده این ردیف را مشخص کنید.
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      {/* Technical specifications manual input */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-slate-400 block">
                            مشخصات فنی و توضیحات اختصاصی ردیف (مثال: سایز،
                            متریال، سیگنال خروجی و ...)
                          </label>

                        </div>
                        {/*
                          Plain text with markers, not stored HTML: the
                          configurator reads this field line by line, and it is
                          interpolated into the printed document — where
                          `renderRichText` escapes it first, which also closes
                          the hole a stray «<» in a tolerance used to open.
                        */}
                        <RichTextField
                          rows={2}
                          value={item.techSpecs || ""}
                          onChange={(next) =>
                            handleItemFieldChange(idx, "techSpecs", next)
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
                                {renderItemImageUpload(idx, item)}
                              </div>
                            </div>
                          );
                        }

                        /*
                         * A line typed by hand, or one whose product has no
                         * picture. It used to get nothing at all here — the
                         * whole control appeared only for a catalogue product
                         * with images — so a manual line could never be
                         * illustrated, even though the printed document has a
                         * column for it.
                         */
                        return (
                          <div className="space-y-1 bg-white p-2 rounded-lg border border-slate-200 mt-2">
                            <label className="text-[10px] font-bold text-slate-500 block">
                              تصویر این ردیف در پیش‌فاکتور:
                            </label>
                            <div className="flex flex-wrap gap-2 items-center mt-1">
                              {item.selectedImage && item.selectedImage !== "none" && (
                                <img
                                  src={item.selectedImage}
                                  alt=""
                                  className="w-10 h-10 rounded-md border-2 border-sky-500 object-cover shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              {renderItemImageUpload(idx, item)}
                              {item.selectedImage && item.selectedImage !== "none" && (
                                <button
                                  type="button"
                                  onClick={() => handleItemFieldChange(idx, "selectedImage", "none")}
                                  className="px-2 py-1 text-[9px] rounded border border-slate-200 hover:border-slate-300 text-slate-500 font-medium transition shrink-0"
                                >
                                  حذف تصویر
                                </button>
                              )}
                            </div>
                          </div>
                        );
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
                      {renderFieldLabelWithAsterisk(settings, 'proformas', 'notes', 'شرایط و توضیحات')}
                    </label>
                    <textarea
                      rows={4}
                      required={isFieldRequired(settings, 'proformas', 'notes')}
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
                        {formatMoney(subTotal)} {currency}
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
                          ({formatMoney(discountAmount)} {currency})
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
                          ({formatMoney(taxAmount)} {currency})
                        </span>
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex justify-between items-center flex-wrap gap-2 text-sm font-bold text-sky-700">
                      <span>مبلغ کل خالص فاکتور:</span>
                      <span className="font-mono text-base">
                        {formatMoney(finalAmount)} {currency}
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
                          return `تسعیر همزمان: ${formatMoney(Math.round(riyalAmount))} ریال (${formatMoney(Math.round(riyalAmount / 10))} تومان)`;
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
          setAlsoRemoveActivities(false);
        }}
        onConfirm={() => {
          if (proformaToDeleteId) {
            void deleteProforma(proformaToDeleteId, alsoRemoveActivities);
          }
          setAlsoRemoveActivities(false);
        }}
        title="حذف پیش‌فاکتور"
        message={`آیا از حذف پیش‌فاکتور "${proformaToDeleteNumber}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      >
        <DeleteActivitiesOption
          checked={alsoRemoveActivities}
          onChange={setAlsoRemoveActivities}
          what="این پیش‌فاکتور"
        />
      </ConfirmModal>

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

      {/* Row-Level Price Calculator Modal */}
      {calcModalItemIdx !== null && (() => {
        const item = items[calcModalItemIdx];
        if (!item) return null;
        const prod = products.find(p => p.id === item.productId);
        if (!prod) return null;
        const variant = item.variantId ? prod.variants?.find(v => v.id === item.variantId) : undefined;

        // Determine the initial foreign price
        // The product's currency leads — every SKU under it follows, so the
        // calculator opens in the currency the figures will be stored in.
        const modalCurrency: string = prod.currencyForeign || variant?.currencyForeign
          || (currency && currency !== "ریال" ? currency : "یورو");
        let initialForeign = 0;
        if (variant?.priceForeign !== undefined) {
          initialForeign = variant.priceForeign;
        } else if (variant?.attributes && prod.features) {
          initialForeign = getCombinedFeaturePrice(prod.features, variant.attributes);
        } else if (prod.priceForeign !== undefined) {
          initialForeign = prod.priceForeign;
        }

        // Both branches of this used to spell out the same eleven calculator
        // fields, and a field added to one and not the other simply never
        // reached the modal. One list now, the same one that decides what gets
        // saved.
        const initialValues: Partial<ProductVariant> = calcSeedOf(variant ?? prod);

        const subtitle = variant
          ? `SKU: ${variant.sku} — ${Object.entries(variant.attributes).map(([k, v]) => `${k}: ${v}`).join(" ، ")}`
          : prod.displayName;

        return (
          <PriceCalculatorModal
            open={calcModalItemIdx !== null}
            onClose={() => setCalcModalItemIdx(null)}
            subtitle={subtitle}
            initialPriceForeign={initialForeign}
            currency={modalCurrency}
            initialValues={initialValues}
            // The line being priced. Moving to another line reseeds; a
            // re-render of the screen behind the modal does not.
            seedKey={calcModalItemIdx}
            exchangeRates={exchangeRates}
            onApply={(sellingForeign, sellingRial, details, appliedCurrency, landed) => {
              // Compute unit price in the proforma's currency
              const engCurrency = mapPersianCurrencyToEnglish(currency || "ریال");
              const proformaRateObj = engCurrency
                ? exchangeRates?.find(r => r.currency === engCurrency)
                : undefined;
              const proformaRate = proformaRateObj ? proformaRateObj.rateToRIYAL : 1;

              const toProformaCurrency = (rial: number) => currency === "ریال"
                ? Math.round(rial)
                : Math.round((rial / proformaRate) * 100) / 100;

              const unitPriceInProformaCurrency = toProformaCurrency(sellingRial);

              // The cost the calculator just worked out, converted by the very
              // same rate as the price beside it — so the margin on this line is
              // arithmetic between two figures in one currency, whatever the
              // rate turns out to have been.
              const unitCostInProformaCurrency = toProformaCurrency(landed.landedRial);

              // Update the proforma item
              const newItems = [...items];
              newItems[calcModalItemIdx] = {
                ...newItems[calcModalItemIdx],
                unitPriceRIYAL: unitPriceInProformaCurrency,
                unitCost: unitCostInProformaCurrency,
                costCurrency: currency || "ریال",
                costSource: details.calcMode === "MANUAL"
                  ? COST_SOURCES.MANUAL
                  : COST_SOURCES.PRICE_CALCULATOR,
              };
              setItems(newItems);

              /*
               * Back to the warehouse — in the warehouse's own currency.
               *
               * A catalogue item has **one** reference currency and every SKU
               * under it follows: changing it on the product form rewrites all
               * of them. The calculator, though, can be run in any currency —
               * often the proforma's — and this used to write its figure and
               * its currency straight onto one SKU. That left that SKU out of
               * step with its product and its siblings, and since the product
               * form reads the *product's* currency, the number then displayed
               * as if it were in a currency it was never in. The rial stayed
               * right, which is exactly why it went unnoticed.
               *
               * So the amount is converted into the item's own currency first,
               * and the currency itself is restated rather than replaced —
               * which also repairs a SKU that had already drifted.
               */
              const rateFor = (persian: string): number => {
                if (!persian || persian === "ریال") return 1;
                const eng = mapPersianCurrencyToEnglish(persian);
                return (eng ? exchangeRates?.find(r => r.currency === eng)?.rateToRIYAL : 0) || 0;
              };

              // The product's currency leads: it is what every SKU follows.
              const warehouseCurrency =
                prod.currencyForeign || variant?.currencyForeign || appliedCurrency;

              /*
               * Only the rial when the conversion cannot be made honestly.
               *
               * An unknown rate means the foreign figure cannot be stated in
               * this item's currency at all, and writing the calculator's
               * number under the wrong label is the bug being fixed. The rial
               * price is still exact, so it is written and the stored foreign
               * figure is left for somebody to correct.
               */
              const priceForWarehouse = priceInWarehouseCurrency(
                sellingForeign, sellingRial, appliedCurrency, warehouseCurrency, rateFor,
              );

              const warehousePrice = priceForWarehouse === null
                ? { currencyForeign: warehouseCurrency }
                : { priceForeign: priceForWarehouse, currencyForeign: warehouseCurrency };

              // Persist to the variant (or product if no variant). The
              // mutation runs against the loaded record, not the picker
              // projection this screen holds.
              if (variant) {
                void updateProductById(prod.id, (full) => ({
                  ...full,
                  // A SKU cannot carry a currency of its own, so the product's
                  // is restated here too — that is what the SKU now follows.
                  currencyForeign: warehouseCurrency,
                  variants: (full.variants || []).map((v) =>
                    v.id === variant.id
                      ? {
                          ...v,
                          priceRIYAL: Math.round(sellingRial),
                          ...warehousePrice,
                          ...details,
                        }
                      : v,
                  ),
                }));
              } else {
                void updateProductById(prod.id, (full) => ({
                  ...full,
                  basePriceRIYAL: Math.round(sellingRial),
                  ...warehousePrice,
                  ...details,
                }));
              }

              setCalcModalItemIdx(null);
            }}
          />
        );
      })()}

      {/* Product Configurator Modal */}
      {showConfigModal !== null &&
        (() => {
          const itemIdx = showConfigModal;
          const item = items[itemIdx];
          const prod = products.find((p) => p.id === item.productId);
          if (!prod || !prod.features || prod.features.length === 0)
            return null;

          const handleConfirmConfig = async () => {
            const attributes = attributesFromSelections(prod.features, configSelections);

            let productForItem = prod;
            let matchedVariantId: string | null = null;
            try {
              const ensured = await ensureVariantForAttributes(prod, attributes);
              productForItem = ensured.product;
              matchedVariantId = ensured.variantId;
            } catch (err) {
              // The SKU could not be stored: the line keeps its specifications
              // and its manual price, and simply carries no SKU link. Refusing
              // the user's configuration over a catalogue write would be worse.
              reportError(err, 'ثبت SKU جدید در انبار با خطا مواجه شد.');
            }

            const newTechSpecs = mergeSpecText(
              item.techSpecs,
              prod.features,
              specLinesFrom(prod.features, configSelections),
            );

            // Applied to the rows as they are *now*: storing the SKU is a round
            // trip to the server, and the user may have typed on another line
            // while it ran — writing back the copy captured before the call
            // would undo that.
            setItems((prev) => {
                const newItems = [...prev];
                newItems[itemIdx] = {
                    ...(newItems[itemIdx] ?? item),
                    techSpecs: newTechSpecs,
                };
                if (matchedVariantId) {
                    const variant = productForItem.variants!.find(v => v.id === matchedVariantId);
                    newItems[itemIdx].variantId = matchedVariantId;
                    if (variant) {
                        newItems[itemIdx].productCode = variant.sku;
                        newItems[itemIdx].unitPriceRIYAL = getProductOrVariantPriceInProformaCurrency(productForItem, variant);
                        Object.assign(newItems[itemIdx], costPatchFor(productForItem, variant));
                        const effectiveSupplyType = variant.stockLevel === 0 ? "ORDER" : (productForItem.supplyType || "INVENTORY");
                        newItems[itemIdx].supplyMethod = effectiveSupplyType === "ORDER" ? "ORDER" : "INVENTORY";
                    }
                } else {
                    newItems[itemIdx].variantId = undefined;
                }
                return newItems;
            });
            setShowConfigModal(null);
          };

          return (
            <ProductConfiguratorModal
              product={prod}
              selections={configSelections}
              onSelectionsChange={setConfigSelections}
              onCancel={() => setShowConfigModal(null)}
              onConfirm={() => void handleConfirmConfig()}
              confirmLabel="تایید و افزودن به مشخصات فنی"
              intro={(
                <>
                  در این بخش می‌توانید مقادیر ویژگی‌های تعریف شده برای محصول{" "}
                  <span className="font-bold">{prod.displayName}</span> را
                  انتخاب کنید. پس از تایید، مقادیر انتخاب شده به متن مشخصات
                  فنی ردیف اضافه شده و SKU متناظر انتخاب — و در صورت نبود، ساخته — می‌شود.
                </>
              )}
            />
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
                  const quickContactError = getContactInfoError({ phone: quickCustPhone, email: quickCustEmail });
                  if (quickContactError) {
                    alert(quickContactError);
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
                  // Warn before creating a record that looks like an existing
                  // customer. Asked of the server: the picker holds a page, not
                  // the customer base.
                  void (async () => {
                    let dupes;
                    try {
                      dupes = await findServerDuplicates({ ...custData, customerType: quickCustType });
                    } catch {
                      alert('بررسی مشتری تکراری انجام نشد. لطفاً دوباره تلاش کنید.');
                      return;
                    }
                    if (dupes.length > 0) {
                      setDupPayload(custData);
                      setDupMatches(dupes);
                      return;
                    }
                    commitQuickCustomer(custData);
                  })();
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
                onClick={async () => {
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
                    const created = await addProject(projData);
                    if (created && created.id) {
                      projectPicker.include(created as any);
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
              // The pickers were filled before this record existed, so pin it —
              // otherwise the field is set to an id the select has no option
              // for, and renders its placeholder as though nothing was created.
              if (quickAddType === "customer") {
                customerPicker.include(newEntity);
                contactPicker.include(newEntity);
              }
              else if (quickAddType === "project") projectPicker.include(newEntity);
              else if (quickAddType === "product") productPicker.include(newEntity);
              if (quickAddType === "customer") {
                if (isQuickAddingSentRecipient) {
                  const fullName = newEntity.companyName || `${newEntity.firstName || ""} ${newEntity.lastName || ""}`.trim();
                  setSelectedSentRecipients(prev => {
                    if (prev.includes(fullName)) return prev;
                    return [...prev, fullName];
                  });
                  const currentProformaCustomerId = customerId || proformas.find(p => p.id === statusTargetId)?.customerId;
                  if (currentProformaCustomerId) {
                    void linkCustomerTo(
                      modalCustomers.find(c => c.id === currentProformaCustomerId),
                      newEntity.id,
                    );
                  }
                } else if (isQuickAddingContact) {
                  setContactCustomerId(newEntity.id);
                  setContactPrefix(namePrefixFor(newEntity.gender));
                  void linkCustomerTo(
                    customers.find((c) => c.id === customerId),
                    newEntity.id,
                  );
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

      {/* Duplicate customer warning */}
      <DuplicateCustomerModal
        isOpen={dupMatches.length > 0}
        candidateName={dupPayload?.companyName || ""}
        matches={dupMatches}
        allCustomers={customers}
        onUseExisting={(existing) => {
          setDupMatches([]);
          setDupPayload(null);
          setCustomerId(existing.id);
          setShowQuickCustomerModal(false);
        }}
        onCreateAnyway={() => {
          if (dupPayload) commitQuickCustomer(dupPayload);
        }}
        onCancel={() => {
          setDupMatches([]);
          setDupPayload(null);
        }}
      />
    </div>
  );
}
