
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Search, Filter, Briefcase, Edit, Trash2, XCircle, AlertCircle, TrendingUp, X,
  FileSpreadsheet, Clock, Sliders, User, Paperclip, ChevronLeft, ChevronDown, ChevronUp,
  Send, CheckCircle2, History, Check, Folder, FolderOpen, File, Download, Eye, Upload,
  ChevronRight, Loader2, Image as ImageIcon, Maximize2, Minimize2, ArrowLeftRight, Flag, Zap, MessageSquare,
  ExternalLink
} from 'lucide-react';

import { getTodayShamsi, addDaysToShamsi, addWorkingDaysToShamsi, formatDateTimeToShamsi } from '../dateUtils';
import { getProformaOutcomeStatus } from '../useERPStore';
import ShamsiDatePicker from './ShamsiDatePicker';
import CustomFieldsForm from './CustomFieldsForm';
import { uploadFile, compressImage, downloadFileFromServer } from '../imageUtils';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import { exportToCSV } from '../excelUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import ConfirmModal from './ConfirmModal';
import QuickAddModal from './QuickAddModal';
import { SearchableSelect } from './SearchableSelect';
import CustomerAgreementAlert from './CustomerAgreementAlert';
import { Project, Customer, Product, Proforma, ERPSettings, ProjectCategoryGroup, User as UserType, Transaction, PackagingDelivery, PurchaseOrder, AfterSalesService, SupplierInquiry } from '../types';

export interface ProjectsViewProps {
  onOpenDocument?: any;
  projects: Project[];
  customers: Customer[];
  products: Product[];
  proformas: Proforma[];
  packagingDeliveries?: PackagingDelivery[];
  transactions?: Transaction[];
  purchaseOrders?: PurchaseOrder[];
  afterSalesServices?: AfterSalesService[];
  supplierInquiries?: SupplierInquiry[];
  addProject: (p: any) => any;
  updateProject: (p: any) => void;
  deleteProject: (id: string, deleteLogs: boolean) => void;
  settings: ERPSettings;
  addCustomer: (c: any) => any;
  addProduct: (p: any) => any;
  projectCategoryGroups?: ProjectCategoryGroup[];
  addProjectCategoryGroup: any;
  updateProjectCategoryGroup?: any;
  addProjectActivity: any;
  completeProjectCategoryGroup: any;
  resumeProjectCategoryGroup: any;
  deleteProjectCategoryGroup: any;
  updateProjectActivity: any;
  deleteProjectActivity: any;
  currentUser: UserType | null;
  users?: UserType[];
  initialSelectedProjectId?: string | null;
  onClearInitialSelectedProject?: () => void;
}

export default function ProjectsView({
  onOpenDocument, projects, customers, products, proformas,
  packagingDeliveries = [], transactions = [], purchaseOrders = [], afterSalesServices = [], supplierInquiries = [],
  addProject, updateProject, deleteProject, settings, addCustomer, addProduct,
  projectCategoryGroups = [], addProjectCategoryGroup, updateProjectCategoryGroup, addProjectActivity,
  completeProjectCategoryGroup, resumeProjectCategoryGroup, deleteProjectCategoryGroup,
  updateProjectActivity, deleteProjectActivity, currentUser, users = [],
  initialSelectedProjectId, onClearInitialSelectedProject
}: ProjectsViewProps) {
  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState<any>({});
  const [customFieldFilters, setCustomFieldFilters] = useState<any>({});
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [groupToDelete, setGroupToDelete] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [isProjectModalFullscreen, setIsProjectModalFullscreen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editingActivityId, setEditingActivityId] = useState<any>(null);
  const [editingActivityText, setEditingActivityText] = useState("");
  const [quickAddType, setQuickAddType] = useState<any>(null);
  const [quickAddCustomerTarget, setQuickAddCustomerTarget] = useState<any>(null);
  const [quickAddProductIndex, setQuickAddProductIndex] = useState<any>(null);
  const [selectedProjectForActivities, setSelectedProjectForActivities] = useState<any>(null);
  const [isActivitiesModalFullscreen, setIsActivitiesModalFullscreen] = useState(false);
  const [modalTab, setModalTab] = useState("activities");
  const [isProjectDetailsExpanded, setIsProjectDetailsExpanded] = useState(false);
  const [selectedFolderName, setSelectedFolderName] = useState<any>(null);
  const [supplyFilter, setSupplyFilter] = useState("ALL");
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [activePreviewDoc, setActivePreviewDoc] = useState<any>(null);
  React.useEffect(() => {
    if (selectedProjectForActivities) {
      const updatedProject = projects.find((p) => p.id === selectedProjectForActivities.id);
      if (updatedProject && updatedProject !== selectedProjectForActivities) {
        setSelectedProjectForActivities(updatedProject);
      }
    }
  }, [projects, selectedProjectForActivities]);
  React.useEffect(() => {
    if (!selectedProjectForActivities) {
      setModalTab("activities");
      setSelectedFolderName(null);
      setActivePreviewDoc(null);
    }
  }, [selectedProjectForActivities]);
  React.useEffect(() => {
    if (initialSelectedProjectId) {
      const proj = projects.find((p) => p.id === initialSelectedProjectId);
      if (proj) {
        setSelectedProjectForActivities(proj);
      }
      if (onClearInitialSelectedProject) {
        onClearInitialSelectedProject();
      }
    }
  }, [initialSelectedProjectId, projects, onClearInitialSelectedProject]);
  const [newActivityText, setNewActivityText] = useState<any>({});
  const [newActivityAttachment, setNewActivityAttachment] = useState<any>({});
  const [referralEnabled, setReferralEnabled] = useState<any>({});
  const [referralAssignedTo, setReferralAssignedTo] = useState<any>({});
  const [referralAction, setReferralAction] = useState<any>({});
  const [selectedCategoryToCreate, setSelectedCategoryToCreate] = useState("");
  const [categoryStartDate, setCategoryStartDate] = useState(getTodayShamsi());
  const [editingGroupIdForStartDate, setEditingGroupIdForStartDate] = useState<string | null>(null);
  const [editingGroupIdForEndDate, setEditingGroupIdForEndDate] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<any>({});
  const [customValues, setCustomValues] = useState<any>({});

  // Milestone & Automations UI States
  const [newMilestoneName, setNewMilestoneName] = useState("");
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState("");
  const [newMilestoneNotes, setNewMilestoneNotes] = useState("");
  const [newMilestoneTriggerType, setNewMilestoneTriggerType] = useState<'manual' | 'category_start' | 'category_complete'>("manual");
  const [newMilestoneTriggerCategoryName, setNewMilestoneTriggerCategoryName] = useState("");
  
  const [newRuleMilestoneId, setNewRuleMilestoneId] = useState("");
  const [newRuleActionType, setNewRuleActionType] = useState<'create_task' | 'send_notification'>("create_task");
  const [newRuleTitle, setNewRuleTitle] = useState("");
  const [newRuleDesc, setNewRuleDesc] = useState("");
  const [newRuleAssignedTo, setNewRuleAssignedTo] = useState("");
  const [newRulePriority, setNewRulePriority] = useState<'پایین' | 'متوسط' | 'بالا' | 'فوری'>("متوسط");
  const [newRuleDueDays, setNewRuleDueDays] = useState(0);
  
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [projectToDeleteId, setProjectToDeleteId] = useState<any>(null);
  const [projectToDeleteName, setProjectToDeleteName] = useState("");
  const [activityDeleteConfirmOpen, setActivityDeleteConfirmOpen] = useState(false);
  const [activityToDeleteGroupId, setActivityToDeleteGroupId] = useState<any>(null);
  const [activityToDeleteId, setActivityToDeleteId] = useState<any>(null);
  const [completeGroupConfirmOpen, setCompleteGroupConfirmOpen] = useState(false);
  const [groupToCompleteId, setGroupToCompleteId] = useState<any>(null);
  const [groupToCompleteName, setGroupToCompleteName] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("جدید");
  const [description, setDescription] = useState("");
  const [itemsNeeded, setItemsNeeded] = useState<any[]>([]);
  const [lossReason, setLossReason] = useState("");
  const [showQuickCustomerModal, setShowQuickCustomerModal] = useState(false);
  const [quickCustType, setQuickCustType] = useState("حقوقی");
  const [quickCustName, setQuickCustName] = useState("");
  const [quickCustFirstName, setQuickCustFirstName] = useState("");
  const [quickCustLastName, setQuickCustLastName] = useState("");
  const [quickCustPhone, setQuickCustPhone] = useState("");
  const [quickCustEmail, setQuickCustEmail] = useState("");
  const [quickCustIndustry, setQuickCustIndustry] = useState("نفت و گاز");
  const [quickCustKeyPerson, setQuickCustKeyPerson] = useState("");
  const [quickCustPosition, setQuickCustPosition] = useState("");
  const [salesExpert, setSalesExpert] = useState("");
  const [marketingChannel, setMarketingChannel] = useState("");
  const [leadQuality, setLeadQuality] = useState("متوسط");
  const [referrerName, setReferrerName] = useState("");
  const [financialContact, setFinancialContact] = useState("");
  const [technicalContact, setTechnicalContact] = useState("");
  const [communicationMethod, setCommunicationMethod] = useState("تلفن");
  const [opportunityDate, setOpportunityDate] = useState("");
  const [customerInquiryNumber, setCustomerInquiryNumber] = useState("");
  const [winningDate, setWinningDate] = useState("");
  const [agreedDeliveryDate, setAgreedDeliveryDate] = useState("");
  const [endUser, setEndUser] = useState("");
  const [attachments, setAttachments] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const getLatestProformaOfProject = (projectId) => {
    const projectProformas = proformas.filter((pf) => pf.projectId === projectId);
    if (projectProformas.length === 0) return void 0;
    return [...projectProformas].sort((a, b) => {
      const dateCompare = b.issueDate.localeCompare(a.issueDate);
      if (dateCompare !== 0) return dateCompare;
      return b.id.localeCompare(a.id);
    })[0];
  };
  const getPipelineValue = (projectId) => {
    const latest = getLatestProformaOfProject(projectId);
    return latest ? latest.finalAmount : 0;
  };
  const getPipelineCurrency = (projectId) => {
    const latest = getLatestProformaOfProject(projectId);
    return latest ? (latest.currency || 'ریال') : '';
  };
  const getCustomerDisplayName = (idOrName) => {
    const cust = customers.find((c) => c.id === idOrName);
    if (!cust) return idOrName;
    return cust.customerType === "حقوقی" ? cust.companyName : `${cust.firstName || ""} ${cust.lastName || ""}`.trim();
  };
  const getProjectPrepaymentDate = (projectId) => {
    const projectTx = transactions.filter((tx) => tx.projectId === projectId && tx.type === "دریافت").sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return projectTx.length > 0 ? projectTx[0].date : null;
  };
  const getActualDeliveryDate = (projectId) => {
    const delivery = packagingDeliveries.find((d) => d.projectId === projectId);
    return delivery?.actualDeliveryDate;
  };
  const getApprovedProformaDeliveryDate = (projectId) => {
    const approved = proformas.find((pf) => {
      if (pf.projectId !== projectId) return false;
      const outcome = getProformaOutcomeStatus(pf);
      return outcome === "تأیید شده (برنده)" || outcome === "نیمه برنده";
    });
    return approved?.deliveryDate;
  };
  const faToEnDigits = (str) => {
    const faDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
    const arDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
    let result = str;
    for (let i = 0; i < 10; i++) {
      result = result.replace(new RegExp(faDigits[i], "g"), i.toString());
      result = result.replace(new RegExp(arDigits[i], "g"), i.toString());
    }
    return result;
  };
  const parseItemDeliveryToDays = (range, unit) => {
    if (!range) return 0;
    const normalizedRange = faToEnDigits(range.trim());
    const matches = normalizedRange.match(/\d+/g);
    if (!matches || matches.length === 0) return 0;
    const lastNum = parseInt(matches[matches.length - 1], 10);
    if (unit === "هفته") return lastNum * 7;
    if (unit === "ماه") return lastNum * 30;
    return lastNum;
  };
  const getProjectDeliveryDetails = (projectId) => {
    const projectProformas = proformas.filter((pf) => pf.projectId === projectId);
    const wonProformas = projectProformas.filter((pf) => {
      const outcome = getProformaOutcomeStatus(pf);
      return outcome === "تأیید شده (برنده)" || outcome === "نیمه برنده";
    });
    const prepaymentDate = getProjectPrepaymentDate(projectId);
    const proj = projects.find((p) => p.id === projectId);
    const baseDate = prepaymentDate || proj?.winningDate || proj?.opportunityDate || proj?.creationDate || getTodayShamsi();
    const agreedItems = [];
    wonProformas.forEach((pf) => {
      let wonItems = [];
      const hasExplicitWon = pf.items?.some((item) => item.status === "برنده");
      if (hasExplicitWon) {
        wonItems = pf.items.filter((item) => item.status === "برنده");
      } else {
        wonItems = pf.items?.filter((item) => item.status !== "بازنده") || [];
      }
      wonItems.forEach((item) => {
        if (item.deliveryRange && item.deliveryUnit) {
          const range = item.deliveryRange;
          const unit = item.deliveryUnit;
          const type = item.deliveryType || "کاری";
          const postfix = item.deliveryPostfix || "";
          const offsetDays = parseItemDeliveryToDays(range, unit);
          const isWorkingDays = type === "کاری";
          const calculatedDate = isWorkingDays ? addWorkingDaysToShamsi(baseDate, offsetDays) : addDaysToShamsi(baseDate, offsetDays);
          agreedItems.push({
            id: item.id,
            productName: item.productName,
            deliveryText: `${range} ${unit} ${type}${postfix ? ` ${postfix}` : ""}`,
            calculatedDate
          });
        } else {
          const pfDeliveryDate = pf.deliveryDate || proj?.agreedDeliveryDate || "";
          agreedItems.push({
            id: item.id,
            productName: item.productName,
            deliveryText: pfDeliveryDate || "فوری",
            calculatedDate: proj?.agreedDeliveryDate || baseDate
          });
        }
      });
    });
    const projectDeliveries = packagingDeliveries.filter((d) => d.projectId === projectId);
    const actualItems = [];
    projectDeliveries.forEach((del) => {
      const mainActualDate = del.actualDeliveryDate || "";
      del.items.forEach((item) => {
        const itemActualDate = item.actualDeliveryDate || mainActualDate || "";
        if (itemActualDate) {
          actualItems.push({
            id: item.id,
            productName: item.itemOrDocName,
            actualDate: itemActualDate,
            boxNumber: item.boxNumber
          });
        }
      });
    });
    const uniqueAgreedDates = new Set(agreedItems.map((x) => x.calculatedDate).filter(Boolean));
    const uniqueActualDates = new Set(actualItems.map((x) => x.actualDate).filter(Boolean));
    const singleAgreedDate = uniqueAgreedDates.size === 1 ? Array.from(uniqueAgreedDates)[0] : "";
    const singleActualDate = uniqueActualDates.size === 1 ? Array.from(uniqueActualDates)[0] : "";
    return {
      agreedItems,
      actualItems,
      hasMultipleAgreed: uniqueAgreedDates.size > 1,
      hasMultipleActual: uniqueActualDates.size > 1,
      singleAgreedDate,
      singleActualDate
    };
  };
  const handleAddItemLine = () => {
    setItemsNeeded([
      ...itemsNeeded,
      {
        productId: "generic",
        name: "فلو - تجهیز درخواستی",
        quantity: 1,
        supplyMethod: "ORDER",
        category: "FLOW",
        equipmentType: "",
        size: ""
      }
    ]);
  };
  const handleRemoveItemLine = (index) => {
    setItemsNeeded(itemsNeeded.filter((_, i) => i !== index));
  };
  const handleItemProductChange = (index, prodId) => {
    if (prodId === "generic") {
      setItemsNeeded(
        itemsNeeded.map(
          (item, i) => i === index ? {
            ...item,
            productId: "generic",
            name: "فلو - تجهیز درخواستی",
            supplyMethod: "ORDER",
            category: "FLOW",
            equipmentType: "",
            size: ""
          } : item
        )
      );
      return;
    }
    const selectedProd = products.find((p) => p.id === prodId);
    if (!selectedProd) return;
    setItemsNeeded(
      itemsNeeded.map(
        (item, i) => i === index ? {
          ...item,
          productId: prodId,
          variantId: undefined,
          name: selectedProd.displayName,
          supplyMethod: (selectedProd.stockLevel === 0 ? "ORDER" : selectedProd.supplyType) === "ORDER" ? "ORDER" : "INVENTORY",
          category: void 0,
          equipmentType: void 0,
          size: void 0
        } : item
      )
    );
  };
  const handleItemVariantChange = (index: number, variantId: string) => {
    const newItems = [...itemsNeeded];
    const item = newItems[index];
    const prod = products.find(p => p.id === item.productId);
    if (!prod || !prod.hasVariants || !prod.variants) return;

    const variant = prod.variants.find(v => v.id === variantId);
    if (!variant) return;

    const effectiveST = variant.stockLevel === 0 ? "ORDER" : (prod.supplyType || "INVENTORY");
    
    newItems[index] = {
      ...item,
      variantId: variant.id,
      supplyMethod: effectiveST === "ORDER" ? "ORDER" : "INVENTORY",
    };
    setItemsNeeded(newItems);
  };
  const handleItemCategoryChange = (index, cat) => {
    setItemsNeeded(
      itemsNeeded.map((item, i) => {
        if (i !== index) return item;
        const eqType = item.equipmentType || "";
        const sizeStr = item.size ? ` (سایز: ${item.size})` : "";
        const catLabel = cat === "FLOW" ? "فلو" : cat === "TEMPERATURE" ? "دما" : cat === "PRESSURE" ? "فشار" : "سطح";
        const updatedName = `${catLabel} - ${eqType || "تجهیز درخواستی"}${sizeStr}`;
        return {
          ...item,
          category: cat,
          name: updatedName
        };
      })
    );
  };
  const handleItemEquipmentTypeChange = (index, eqType) => {
    setItemsNeeded(
      itemsNeeded.map((item, i) => {
        if (i !== index) return item;
        const cat = item.category || "FLOW";
        const sizeStr = item.size ? ` (سایز: ${item.size})` : "";
        const catLabel = cat === "FLOW" ? "فلو" : cat === "TEMPERATURE" ? "دما" : cat === "PRESSURE" ? "فشار" : "سطح";
        const updatedName = `${catLabel} - ${eqType || "تجهیز درخواستی"}${sizeStr}`;
        return {
          ...item,
          equipmentType: eqType,
          name: updatedName
        };
      })
    );
  };
  const handleItemSizeChange = (index, sz) => {
    setItemsNeeded(
      itemsNeeded.map((item, i) => {
        if (i !== index) return item;
        const cat = item.category || "FLOW";
        const eqType = item.equipmentType || "";
        const sizeStr = sz ? ` (سایز: ${sz})` : "";
        const catLabel = cat === "FLOW" ? "فلو" : cat === "TEMPERATURE" ? "دما" : cat === "PRESSURE" ? "فشار" : "سطح";
        const updatedName = `${catLabel} - ${eqType || "تجهیز درخواستی"}${sizeStr}`;
        return {
          ...item,
          size: sz,
          name: updatedName
        };
      })
    );
  };
  const handleItemQuantityChange = (index, qty) => {
    setItemsNeeded(
      itemsNeeded.map(
        (item, i) => i === index ? { ...item, quantity: qty } : item
      )
    );
  };
  const handleItemTagNumberChange = (index, tagNum) => {
    setItemsNeeded(
      itemsNeeded.map(
        (item, i) => i === index ? { ...item, tagNumber: tagNum } : item
      )
    );
  };
  const handleStatusChange = (newStatus) => {
    setStatus(newStatus);
    const today = getTodayShamsi();
    if (newStatus === "برنده (موفق)" || newStatus === "نیمه برنده") {
      if (!winningDate) setWinningDate(today);
      if (!agreedDeliveryDate) setAgreedDeliveryDate(today);
    } else if (newStatus === "باخته" || newStatus === "لغو شده") {
    }
  };
  const handleOpenAdd = () => {
    setEditingProject(null);
    setName("");
    setCustomerId(customers[0]?.id || "");
    setStatus("جدید");
    setDescription("");
    setCustomValues({});
    setItemsNeeded([]);
    setLossReason("");
    setSalesExpert("");
    setMarketingChannel("تماس مستقیم");
    setLeadQuality("متوسط");
    setReferrerName("");
    setFinancialContact("");
    setTechnicalContact("");
    setCommunicationMethod("تلفن");
    setOpportunityDate(getTodayShamsi());
    setCustomerInquiryNumber("");
    setWinningDate("");
    setAgreedDeliveryDate("");
    setEndUser("");
    setAttachments([]);
    setShowModal(true);
  };
  const handleOpenEdit = (proj) => {
    setEditingProject(proj);
    setName(proj.name);
    setCustomerId(proj.customerId);
    setStatus(proj.status);
    setDescription(proj.description);
    setCustomValues(proj.customValues || {});
    setItemsNeeded(proj.itemsNeeded || []);
    setLossReason(proj.lossReason || "");
    setSalesExpert(proj.salesExpert || "");
    setMarketingChannel(proj.marketingChannel || "تماس مستقیم");
    setLeadQuality(proj.leadQuality || "متوسط");
    setReferrerName(proj.referrerName || "");
    setFinancialContact(proj.financialContact || "");
    setTechnicalContact(proj.technicalContact || "");
    setCommunicationMethod(proj.communicationMethod || "تلفن");
    setOpportunityDate(proj.opportunityDate || proj.creationDate || getTodayShamsi());
    setCustomerInquiryNumber(proj.customerInquiryNumber || "");
    setWinningDate(proj.winningDate || "");
    setAgreedDeliveryDate(proj.agreedDeliveryDate || "");
    setEndUser(proj.endUser || "");
    setAttachments(proj.attachments || []);
    setShowModal(true);
  };
  const handleSave = (e) => {
    e.preventDefault();
    if (!customerId) return;
    const moduleFields = (settings?.customFields || []).filter((f) => f.module === "projects");
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === void 0 || val === null || val === "") {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }
    const customerName = customers.find((c) => c.id === customerId)?.companyName || "مشتری نامشخص";

    // Won/Partial Won Project without Required Items Warning
    if ((status === 'برنده (موفق)' || status === 'نیمه برنده') && (!itemsNeeded || itemsNeeded.length === 0)) {
      const confirmNoItems = window.confirm(
        `هشدار عدم ثبت نیازمندی‌های کالا:\n` +
        `وضعیت پروژه روی «${status}» قرار دارد، اما هیچ کالای مورد نیازی برای پروژه تعریف نشده است!\n` +
        `این مسئله باعث می‌شود تا زنجیره تأمین، سفارش خرید و مدارک حمل با خطا و عدم ردیابی مواجه شوند.\n\n` +
        `آیا اطمینان دارید که می‌خواهید این پروژه را بدون اقلام مورد نیاز ثبت کنید؟`
      );
      if (!confirmNoItems) {
        return;
      }
    }

    const data = {
      name,
      customerId,
      customerName,
      status,
      description,
      customValues,
      itemsNeeded,
      lossReason: status === "باخته" ? lossReason : void 0,
      // New Fields
      salesExpert,
      marketingChannel,
      leadQuality,
      referrerName,
      financialContact,
      technicalContact,
      communicationMethod,
      opportunityDate,
      customerInquiryNumber,
      winningDate,
      agreedDeliveryDate,
      endUser,
      attachments
    };
    if (editingProject) {
      updateProject({
        ...editingProject,
        ...data
      });
    } else {
      addProject(data);
    }
    setShowModal(false);
  };
  const filteredProjects = projects.filter((p) => {
    const matchesSearch = !search || 
      (p.name || '').toLowerCase().includes(search.toLowerCase()) || 
      (p.code || '').toLowerCase().includes(search.toLowerCase()) || 
      (p.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
      p.itemsNeeded?.some(item => item.tagNumber?.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = selectedStatus === "all" || p.status === selectedStatus;
    if (!(matchesSearch && matchesStatus)) return false;
    const matchesCustom = Object.entries(customFieldFilters).every(([fieldId, filterValue]) => {
      if (!filterValue) return true;
      const recordValue = p.customValues?.[fieldId];
      if (recordValue === void 0 || recordValue === null || recordValue === "") return false;
      const field = settings?.customFields?.find((f) => f.id === fieldId);
      if (!field) return true;
      if (field.type === "boolean") {
        return String(recordValue) === filterValue;
      }
      if (field.type === "select") {
        return String(recordValue) === filterValue;
      }
      if (field.type === "file") {
        if (filterValue === "has_file") {
          return !!(recordValue && recordValue.name);
        } else if (filterValue === "no_file") {
          return !(recordValue && recordValue.name);
        }
        return true;
      }
      return String(recordValue).toLowerCase().includes(String(filterValue).toLowerCase());
    });
    if (!matchesCustom) return false;
    return Object.entries(colFilters).every(([colId, filterValue]) => {
      if (!filterValue) return true;
      const fVal = String(filterValue).toLowerCase();
      if (colId === "code") {
        return (p.code || "").toLowerCase().includes(fVal);
      }
      if (colId === "name") {
        return (p.name || "").toLowerCase().includes(fVal);
      }
      if (colId === "customerName") {
        return (p.customerName || "").toLowerCase().includes(fVal);
      }
      if (colId === "estimatedValueRIYAL") {
        const val = getPipelineValue(p.id);
        const curr = getPipelineCurrency(p.id);
        const combined = `${val} ${curr}`.toLowerCase();
        return combined.includes(fVal) || String(val).includes(fVal);
      }
      if (colId === "status") {
        return (p.status || "").toLowerCase().includes(fVal);
      }
      if (colId === "expectedCloseDate") {
        return (p.expectedCloseDate || "").toLowerCase().includes(fVal);
      }
      return true;
    });
  });
  const handleExportExcel = () => {
    const headers = [
      "کد پروژه",
      "نام پروژه",
      "کارشناس فروش",
      "مشتری پروژه",
      "مصرف‌کننده نهایی",
      "ارزش پایپ‌لاین",
      "وضعیت",
      "علت باخت (در صورت باخت)",
      "کانال بازاریابی",
      "کیفیت لید",
      "نام معرف",
      "روش ارتباط",
      "فرد کلیدی مالی",
      "فرد کلیدی فنی",
      "شماره استعلام مشتری",
      "تاریخ ایجاد فرصت",
      "تاریخ تایید",
      "تاریخ توافق‌شده تحویل",
      "تاریخ دریافت پیش پرداخت",
      "تاریخ تحویل قطعی",
      "اقلام درخواستی مشتری",
      "توضیحات"
    ];
    const rows = filteredProjects.map((p) => [
      p.code,
      p.name,
      p.salesExpert || "",
      p.customerName,
      p.endUser || "",
      getPipelineValue(p.id) ? `${getPipelineValue(p.id).toLocaleString('fa-IR')} ${getPipelineCurrency(p.id)}` : "۰",
      p.status,
      p.lossReason || "",
      p.marketingChannel || "",
      p.leadQuality || "",
      p.referrerName || "",
      p.communicationMethod || "",
      p.financialContact || "",
      p.technicalContact || "",
      p.customerInquiryNumber || "",
      p.opportunityDate || p.creationDate || "",
      p.winningDate || "",
      p.agreedDeliveryDate || "",
      getProjectPrepaymentDate(p.id) || "",
      getActualDeliveryDate(p.id) || "",
      p.itemsNeeded?.map((item) => `${item.name} (${item.quantity} عدد - ${item.supplyMethod === "ORDER" ? "سفارش" : item.supplyMethod === "NONE" ? "بدون نیاز به تامین" : "انبار"})`).join(" - ") || "",
      p.description
    ]);
    exportToCSV("گزارش_پروژه‌ها", headers, rows);
  };
  const getProjectFoldersAndFiles = (p) => {
    const folders = [
      { id: "customer_inquiry", name: "درخواست مشتری و استعلام اولیه", desc: "اسناد درخواست اولیه، استعلام‌های فنی و مکاتبات مشتری", iconBg: "bg-indigo-50 text-indigo-600 border-indigo-100", icon: Paperclip },
      { id: "sales_proforma", name: "پیش‌فاکتورها و مهندسی فروش", desc: "پیش‌فاکتورهای صادر شده فنی و مالی و پروپوزال‌ها", iconBg: "bg-sky-50 text-sky-600 border-sky-100", icon: FileSpreadsheet },
      { id: "supplier_inquiry", name: "استعلام قیمت تأمین‌کنندگان", desc: "اسناد و آفرهای فنی و مالی دریافت شده از تأمین‌کنندگان", iconBg: "bg-blue-50 text-blue-600 border-blue-100", icon: ArrowLeftRight },
      { id: "supplier_po", name: "سفارشات خرید تامین‌کنندگان", desc: "سفارش‌های خرید ارسالی به سازندگان و تامین‌کنندگان کالا", iconBg: "bg-amber-50 text-amber-600 border-amber-100", icon: Briefcase },
      { id: "packaging_delivery", name: "بسته‌بندی و تحویل کالا", desc: "پکینگ لیست‌های صادر شده، عکس‌های بسته‌بندی و اسناد بارنامه", iconBg: "bg-emerald-50 text-emerald-600 border-emerald-100", icon: CheckCircle2 },
      { id: "financial_transactions", name: "تراکنش‌های مالی و پرداخت‌ها", desc: "فیش‌های پیش‌پرداخت، فاکتورهای رسمی و اسناد مالی پروژه", iconBg: "bg-purple-50 text-purple-600 border-purple-100", icon: TrendingUp },
      { id: "after_sales", name: "خدمات پس از فروش", desc: "اسناد خدمات گارانتی، برگه ترخیص کالا برای تعمیر و گزارشات خرابی", iconBg: "bg-teal-50 text-teal-600 border-teal-100", icon: Sliders },
      { id: "manual_other", name: "سایر مدارک و فایل‌های دستی", desc: "مدارک متفرقه و فایل‌هایی که به طور مستقیم در بالا طبقه‌بندی نشده‌اند", iconBg: "bg-slate-50 text-slate-600 border-slate-150", icon: Folder }
    ];
    const folderFiles = {};
    folders.forEach((f) => {
      folderFiles[f.name] = [];
    });
    if (p.attachments && p.attachments.length > 0) {
      p.attachments.forEach((att, idx) => {
        folderFiles["درخواست مشتری و استعلام اولیه"].push({
          id: `attachment-${idx}`,
          name: att.name || `فایل درخواست ${idx + 1}`,
          url: att.url,
          size: "پیوست پروژه",
          date: p.creationDate || "مشخص نشده",
          type: "attachment"
        });
      });
    }
    const projectProformas = proformas.filter((pf) => pf.projectId === p.id);
    projectProformas.forEach((pf) => {
      folderFiles["پیش‌فاکتورها و مهندسی فروش"].push({
        id: `proforma-${pf.id}`,
        name: `پیش‌فاکتور ${pf.proformaNumber} - مشتری: ${pf.customerName}.pdf`,
        url: "#",
        size: `${pf.items?.length || 0} ردیف کالا`,
        date: pf.issueDate,
        type: "system",
        originalEntity: pf
      });
    });

    const projectInquiries = (supplierInquiries || []).filter((inq) => inq.projectId === p.id);
    projectInquiries.forEach((inq) => {
      if (inq.technicalOfferUrl) {
        folderFiles["استعلام قیمت تأمین‌کنندگان"].push({
          id: `inquiry-tech-${inq.id}`,
          name: `آفر فنی - تأمین‌کننده: ${inq.supplierName}`,
          url: inq.technicalOfferUrl,
          size: "پیشنهاد فنی",
          date: inq.creationDate || p.creationDate || "مشخص نشده",
          type: "system",
          originalEntity: inq
        });
      }
      if (inq.financialOfferUrl) {
        folderFiles["استعلام قیمت تأمین‌کنندگان"].push({
          id: `inquiry-fin-${inq.id}`,
          name: `آفر مالی - تأمین‌کننده: ${inq.supplierName}`,
          url: inq.financialOfferUrl,
          size: "پیشنهاد مالی",
          date: inq.creationDate || p.creationDate || "مشخص نشده",
          type: "system",
          originalEntity: inq
        });
      }
    });
    const projectPOs = (purchaseOrders || []).filter((po) => po.projectId === p.id);
    projectPOs.forEach((po) => {
      folderFiles["سفارشات خرید تامین‌کنندگان"].push({
        id: `po-${po.id}`,
        name: `سفارش خرید ${po.poNumber} - تامین‌کننده: ${po.supplierName}.pdf`,
        url: "#",
        size: `${po.items?.length || 0} ردیف کالا`,
        date: po.orderDate,
        type: "system",
        originalEntity: po
      });
    });
// 4. Packaging Deliveries
    const projectDeliveries = (packagingDeliveries || []).filter(del => del.projectId === p.id);
    projectDeliveries.forEach(del => {
      folderFiles['بسته‌بندی و تحویل کالا'].push({
        id: `delivery-pl-${del.id}`,
        name: `پکینگ لیست ${del.packingListNumber} - روش ارسال: ${del.shippingMethod}.pdf`,
        url: '#',
        size: `${del.items?.length || 0} ردیف کالا`,
        date: del.deliveryDate,
        type: 'system',
        originalEntity: del
      });
      if (del.photos && del.photos.length > 0) {
        del.photos.forEach((photo, idx) => {
          folderFiles['بسته‌بندی و تحویل کالا'].push({
            id: `delivery-img-${del.id}-${idx}`,
            name: `عکس بسته‌بندی ${idx + 1} - پکینگ لیست ${del.packingListNumber}.png`,
            url: photo,
            size: 'تصویر بسته‌بندی',
            date: del.deliveryDate,
            type: 'system',
            originalEntity: del
          });
        });
      }
    });

    // 5. Transactions
    const projectTXs = (transactions || []).filter(tx => tx.projectId === p.id);
    projectTXs.forEach(tx => {
      folderFiles['تراکنش‌های مالی و پرداخت‌ها'].push({
        id: `tx-${tx.id}`,
        name: `رسید تراکنش مالی ${tx.documentNumber} (${tx.type}).pdf`,
        url: '#',
        size: `مبلغ: ${tx.amountRIYAL?.toLocaleString('fa-IR')} ریال`,
        date: tx.date,
        type: 'system',
        originalEntity: tx
      });
    });

    // 6. After Sales Services
    const projectServices = (afterSalesServices || []).filter(as => as.projectId === p.id);
    projectServices.forEach(as => {
      folderFiles['خدمات پس از فروش'].push({
        id: `service-${as.id}`,
        name: `خدمات پس از فروش - تجهیز: ${as.itemName}.pdf`,
        url: '#',
        size: `وضعیت: ${as.status}`,
        date: as.startDate,
        type: 'system',
        originalEntity: as
      });
    });

    // 7. Manual Documents
    if (p.manualDocuments && p.manualDocuments.length > 0) {
      p.manualDocuments.forEach(doc => {
        const targetFolderName = folders.some(f => f.name === doc.folderName) ? doc.folderName : 'سایر مدارک و فایل‌های دستی';
        
        // Prevent duplicate manual entries if the document with same URL is already added to that folder
        const exists = folderFiles[targetFolderName]?.some((f: any) => f.url === doc.url);
        if (exists) return;

        folderFiles[targetFolderName].push({
          id: doc.id,
          name: doc.name,
          url: doc.url,
          size: doc.size || 'بارگذاری دستی',
          date: doc.createdAt,
          type: 'manual'
        });
      });
    }

    return { folders, folderFiles };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, folderName: string) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedProjectForActivities) return;
    setIsUploadingDoc(true);
    try {
      const p = selectedProjectForActivities;
      const newDocs = [...(p.manualDocuments || [])];
      const newAttachments = [...(p.attachments || [])];
      let updated = false;
      let attachmentsUpdated = false;

      for (const file of Array.from(files) as File[]) {
        const url = await uploadFile(file);
        const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        
        newDocs.push({
          id: docId,
          folderName,
          name: file.name,
          url,
          createdAt: getTodayShamsi(),
          size: `${(file.size / 1024).toFixed(1)} KB`
        });
        updated = true;

        if (folderName === 'درخواست مشتری و استعلام اولیه') {
          newAttachments.push({
            name: file.name,
            url
          });
          attachmentsUpdated = true;
        }
      }

      if (updated) {
        const updatedProject = {
          ...p,
          manualDocuments: newDocs,
          attachments: attachmentsUpdated ? newAttachments : p.attachments
        };
        updateProject(updatedProject);
        setSelectedProjectForActivities(updatedProject);
        alert('فایل‌ها با موفقیت در پوشه مربوطه بارگذاری شدند.');
      }
    } catch (err: any) {
      alert(err.message || 'خطا در بارگذاری فایل');
    } finally {
      if (e.target) e.target.value = '';
      setIsUploadingDoc(false);
    }
  };

  const handleFileDelete = (docId: string, docName: string, docType: 'manual' | 'attachment') => {
    if (!confirm(`آیا از حذف فایل "${docName}" اطمینان دارید؟`)) return;
    if (!selectedProjectForActivities) return;

    const p = selectedProjectForActivities;
    let updatedProject = { ...p };
    if (docType === 'manual') {
      const deletedDoc = (p.manualDocuments || []).find(doc => doc.id === docId);
      updatedProject.manualDocuments = (p.manualDocuments || []).filter(doc => doc.id !== docId);
      if (deletedDoc) {
        // Also remove from attachments if it was a duplicate
        updatedProject.attachments = (p.attachments || []).filter(att => att.url !== deletedDoc.url);
      }
    } else if (docType === 'attachment') {
      const deletedIdx = parseInt(docId.replace('attachment-', ''), 10);
      const deletedAtt = p.attachments ? p.attachments[deletedIdx] : null;
      updatedProject.attachments = (p.attachments || []).filter((_, idx) => `attachment-${idx}` !== docId);
      if (deletedAtt) {
        // and remove from manualDocuments if duplicate URL or matching ID
        updatedProject.manualDocuments = (p.manualDocuments || []).filter(doc => doc.url !== deletedAtt.url && doc.id !== docId);
      }
    }

    updateProject(updatedProject);
    setSelectedProjectForActivities(updatedProject);
    alert('فایل با موفقیت حذف شد.');
  };

  const generateDocumentHtml = (doc: any, project: any) => {
    const isImage = doc.url && (doc.url.startsWith('data:image/') || doc.url.startsWith('http') || doc.name.endsWith('.png') || doc.name.endsWith('.jpg') || doc.name.endsWith('.jpeg'));
    let innerContent = '';

    if (isImage) {
      innerContent = `
        <div class="flex flex-col items-center justify-center space-y-4">
          <img src="${doc.url}" alt="${doc.name}" class="max-w-full max-h-[85vh] rounded-lg border border-slate-200 shadow-sm object-contain" />
          <p class="text-[10px] text-slate-400 font-mono">اندازه: ${doc.size || 'نامشخص'} - تاریخ ثبت: ${doc.date || 'نامشخص'}</p>
        </div>
      `;
    } else if (doc.id?.startsWith('proforma-')) {
      const pf = doc.originalEntity;
      const itemsRows = (pf?.items || []).map((item: any, idx: number) => `
        <tr class="border-b border-slate-150">
          <td class="p-2 border border-slate-200 text-center font-mono">${idx + 1}</td>
          <td class="p-2 border border-slate-200">
            <span class="font-bold text-slate-800">${item.name}</span>
            <span class="text-[10px] text-slate-500 block">برند: ${item.brand || 'متفرقه'} - پارت‌نامبر: ${item.partNumber || '-'}</span>
          </td>
          <td class="p-2 border border-slate-200 text-center font-mono">${item.quantity}</td>
          <td class="p-2 border border-slate-200 text-left font-mono">${item.unitPrice?.toLocaleString('fa-IR')}</td>
          <td class="p-2 border border-slate-200 text-left font-mono">${(item.unitPrice * item.quantity)?.toLocaleString('fa-IR')}</td>
        </tr>
      `).join('');

      innerContent = `
        <div class="space-y-6 text-xs">
          <div class="flex justify-between items-center pb-4 border-b-2 border-slate-200">
            <div class="space-y-1">
              <h2 class="text-base font-bold text-slate-900">پیش‌فاکتور رسمی فروش کالا</h2>
              <p class="text-slate-400 text-[10px]">شرکت ابزار تامین عرشیا (واحد مالی و مهندسی فروش)</p>
            </div>
            <div class="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
              <div>No: ${pf?.proformaNumber}</div>
              <div>Date: ${pf?.issueDate}</div>
              <div>Status: ${pf?.status}</div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div>
              <span class="text-slate-400 font-bold">خریدار / کارفرما:</span>
              <span class="text-slate-800 font-bold mr-1">${pf?.customerName}</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold">کارشناس مسئول:</span>
              <span class="text-slate-800 font-bold mr-1">${project?.salesExpert || 'مشخص نشده'}</span>
            </div>
          </div>

          <table class="w-full text-right border-collapse border border-slate-200">
            <thead>
              <tr class="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                <th class="p-2 border border-slate-200 text-center w-10">ردیف</th>
                <th class="p-2 border border-slate-200">شرح کالا / خدمات</th>
                <th class="p-2 border border-slate-200 text-center w-16">تعداد</th>
                <th class="p-2 border border-slate-200 text-left">قیمت واحد (ریال)</th>
                <th class="p-2 border border-slate-200 text-left">قیمت کل (ریال)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>

          <div class="flex justify-end">
            <div class="w-64 space-y-1.5 text-[11px]">
              <div class="flex justify-between border-b border-slate-100 pb-1">
                <span class="text-slate-400 font-bold">مجموع ناخالص:</span>
                <span class="font-mono">${pf?.totalAmount?.toLocaleString('fa-IR')} ریال</span>
              </div>
              <div class="flex justify-between border-b border-slate-100 pb-1">
                <span class="text-slate-400 font-bold">تخفیف:</span>
                <span class="font-mono text-red-600">${(pf?.discountAmount || 0)?.toLocaleString('fa-IR')} ریال</span>
              </div>
              <div class="flex justify-between border-b border-slate-100 pb-1">
                <span class="text-slate-400 font-bold">مالیات بر ارزش افزوده (۱۰٪):</span>
                <span class="font-mono">${(pf?.vatAmount || 0)?.toLocaleString('fa-IR')} ریال</span>
              </div>
              <div class="flex justify-between font-bold text-slate-900 border-b-2 border-slate-300 pb-1.5 text-xs">
                <span>مبلغ قابل پرداخت:</span>
                <span class="font-mono">${pf?.finalAmount?.toLocaleString('fa-IR')} ریال</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-10 text-center text-[10px] text-slate-400">
            <div>
              <p class="font-bold text-slate-700">مهر و امضای بخش مالی شرکت</p>
              <div class="h-20 w-32 mx-auto border-2 border-dashed border-slate-200 rounded-lg mt-2 flex items-center justify-center">
                <span class="text-[8px] rotate-12">امضا و مهر معتبر</span>
              </div>
            </div>
            <div>
              <p class="font-bold text-slate-700">مهر و تایید خریدار</p>
              <div class="h-20 w-32 mx-auto border-2 border-dashed border-slate-200 rounded-lg mt-2 flex items-center justify-center">
                <span class="text-[8px]">محل امضای خریدار</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (doc.id?.startsWith('po-')) {
      const po = doc.originalEntity;
      const itemsRows = (po?.items || []).map((item: any, idx: number) => `
        <tr class="border-b border-slate-150">
          <td class="p-2 border border-slate-200 text-center font-mono">${idx + 1}</td>
          <td class="p-2 border border-slate-200">
            <span class="font-bold text-slate-800">${item.name}</span>
            <span class="text-[10px] text-slate-500 block">برند: ${item.brand || '-'} - پارت‌نامبر: ${item.partNumber || '-'}</span>
          </td>
          <td class="p-2 border border-slate-200 text-center font-mono">${item.quantity}</td>
          <td class="p-2 border border-slate-200 text-left font-mono">${item.foreignUnitPrice?.toLocaleString('fa-IR')} ${po?.currency}</td>
          <td class="p-2 border border-slate-200 text-left font-mono">${(item.foreignUnitPrice * item.quantity)?.toLocaleString('fa-IR')} ${po?.currency}</td>
        </tr>
      `).join('');

      innerContent = `
        <div class="space-y-6 text-xs">
          <div class="flex justify-between items-center pb-4 border-b-2 border-slate-200">
            <div>
              <h2 class="text-base font-bold text-slate-900">سفارش رسمی خرید کالا (PO)</h2>
              <p class="text-slate-400 text-[10px]">واحد تامین و بازرگانی خارجی/داخلی</p>
            </div>
            <div class="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
              <div>PO No: ${po?.poNumber}</div>
              <div>Date: ${po?.orderDate}</div>
              <div>Status: ${po?.status}</div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div>
              <span class="text-slate-400 font-bold">تامین‌کننده / سازنده:</span>
              <span class="text-slate-800 font-bold mr-1">${po?.supplierName}</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold">ارز مبادلاتی:</span>
              <span class="text-slate-800 font-bold mr-1">${po?.currency}</span>
            </div>
          </div>

          <table class="w-full text-right border-collapse border border-slate-200">
            <thead>
              <tr class="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                <th class="p-2 border border-slate-200 text-center w-10">ردیف</th>
                <th class="p-2 border border-slate-200">نام کالا / پارت‌نامبر</th>
                <th class="p-2 border border-slate-200 text-center w-16">تعداد</th>
                <th class="p-2 border border-slate-200 text-left">قیمت ارزی واحد</th>
                <th class="p-2 border border-slate-200 text-left">قیمت ارزی کل</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>

          <div class="flex justify-between items-center pt-8 text-[10px] text-slate-500">
            <div>
              <p><span class="font-bold">شرایط پرداخت:</span> ${po?.paymentTerms || 'طبق توافق'}</p>
              <p><span class="font-bold">مدت تحویل:</span> ${po?.deliveryLeadTime || 'مشخص نشده'}</p>
            </div>
            <div class="text-center font-bold text-slate-700 w-48">
              <p>امضا کارشناس بازرگانی</p>
              <div class="h-14"></div>
            </div>
          </div>
        </div>
      `;
    } else if (doc.id?.startsWith('delivery-')) {
      const del = doc.originalEntity;
      const itemsRows = (del?.items || []).map((item: any, idx: number) => `
        <tr class="border-b border-slate-150">
          <td class="p-2 border border-slate-200 text-center font-mono">${idx + 1}</td>
          <td class="p-2 border border-slate-200 font-bold text-slate-800">${item.name}</td>
          <td class="p-2 border border-slate-200 text-center font-mono">${item.orderedQty}</td>
          <td class="p-2 border border-slate-200 text-center font-mono">${item.packedQty}</td>
          <td class="p-2 border border-slate-200 text-center text-emerald-600 font-bold">${item.isPacked ? '✓ بله' : '✗ خیر'}</td>
        </tr>
      `).join('');

      innerContent = `
        <div class="space-y-6 text-xs">
          <div class="flex justify-between items-center pb-4 border-b-2 border-slate-200">
            <div>
              <h2 class="text-base font-bold text-slate-900">سند رسمی پکینگ لیست (Packing List)</h2>
              <p class="text-slate-400 text-[10px]">واحد انبار و لجستیک کالا</p>
            </div>
            <div class="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
              <div>Packing No: ${del?.packingListNumber}</div>
              <div>Delivery Date: ${del?.deliveryDate}</div>
              <div>Shipping Method: ${del?.shippingMethod}</div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100 text-[11px]">
            <div>
              <span class="text-slate-400 font-bold">تعداد کل کارتن/بسته:</span>
              <span class="text-slate-800 font-bold mr-1">${del?.boxCount} عدد</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold">وزن ناخالص کل (کیلوگرم):</span>
              <span class="text-slate-800 font-bold mr-1">${del?.grossWeightKg} کیلوگرم</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold">ابعاد حدودی بسته‌ها:</span>
              <span class="text-slate-800 font-bold mr-1">${del?.dimensionsCm || 'استاندارد'}</span>
            </div>
          </div>

          <table class="w-full text-right border-collapse border border-slate-200">
            <thead>
              <tr class="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                <th class="p-2 border border-slate-200 text-center w-10">ردیف</th>
                <th class="p-2 border border-slate-200">نام تجهیز / کالا</th>
                <th class="p-2 border border-slate-200 text-center">تعداد سفارش</th>
                <th class="p-2 border border-slate-200 text-center">تعداد آماده‌سازی</th>
                <th class="p-2 border border-slate-200 text-center">بسته‌بندی کامل؟</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>

          <div class="grid grid-cols-2 gap-4 pt-8 text-center text-[10px] text-slate-500">
            <div>
              <p class="font-bold text-slate-700">تاییدکننده صحت بسته‌بندی (مسئول انبار)</p>
              <div class="h-14"></div>
            </div>
            <div>
              <p class="font-bold text-slate-700">گیرنده نهایی کالا / کارفرما</p>
              <div class="h-14"></div>
            </div>
          </div>
        </div>
      `;
    } else if (doc.id?.startsWith('tx-')) {
      const tx = doc.originalEntity;
      innerContent = `
        <div class="space-y-6 text-xs">
          <div class="flex justify-between items-center pb-4 border-b-2 border-slate-200">
            <div>
              <h2 class="text-base font-bold text-slate-900">${tx?.type === 'دریافت' ? 'رسید دریافت وجه (سند بستانکار)' : 'سند پرداخت وجه (سند بدهکار)'}</h2>
              <p class="text-slate-400 text-[10px]">امور مالی و خزانه‌داری عرشیا</p>
            </div>
            <div class="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
              <div>Voucher No: ${tx?.documentNumber}</div>
              <div>Date: ${tx?.date}</div>
              <div>Ref No: ${tx?.referenceNumber || '-'}</div>
            </div>
          </div>

          <div class="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-700 text-[11px]">
            <div>
              <span class="text-slate-400 font-bold">مبلغ تراکنش:</span>
              <strong class="text-slate-900 text-sm font-mono mr-1">${tx?.amountRIYAL?.toLocaleString('fa-IR')} ریال</strong>
            </div>
            <div>
              <span class="text-slate-400 font-bold">نوع پرداخت/دریافت:</span>
              <span class="text-slate-800 font-bold mr-1">${tx?.paymentType}</span>
            </div>
            ${tx?.bankName ? `
              <div>
                <span class="text-slate-400 font-bold">نام بانک مبدا/مقصد:</span>
                <span class="text-slate-800 mr-1">${tx?.bankName}</span>
              </div>
            ` : ''}
            <div>
              <span class="text-slate-400 font-bold">شرح تراکنش و بابت:</span>
              <p class="text-slate-800 mr-1 inline">${tx?.notes || 'بدون بابت'}</p>
            </div>
          </div>

          <div class="pt-12 text-center text-[10px] text-slate-400 flex justify-between">
            <div>
              <p class="font-bold text-slate-700">تحویل‌دهنده سند / پرداخت‌کننده</p>
              <div class="h-14"></div>
            </div>
            <div>
              <p class="font-bold text-slate-700">مدیر خزانه‌داری و امور مالی</p>
              <div class="h-14"></div>
            </div>
          </div>
        </div>
      `;
    } else if (doc.id?.startsWith('service-')) {
      const service = doc.originalEntity;
      innerContent = `
        <div class="space-y-6 text-xs">
          <div class="flex justify-between items-center pb-4 border-b-2 border-slate-200">
            <div>
              <h2 class="text-base font-bold text-slate-900">برگه گزارش خدمات پس از فروش و گارانتی</h2>
              <p class="text-slate-400 text-[10px]">دپارتمان مهندسی خدمات و پشتیبانی فنی</p>
            </div>
            <div class="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
              <div>Service ID: ${service?.id}</div>
              <div>Start Date: ${service?.startDate}</div>
              <div>Status: ${service?.status}</div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100 text-[11px]">
            <div>
              <span class="text-slate-400 font-bold">تجهیز ارجاعی:</span>
              <span class="text-slate-800 font-bold mr-1">${service?.itemName}</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold">برند / مدل:</span>
              <span class="text-slate-800 font-bold mr-1">${service?.itemBrand || 'مشخص نشده'}</span>
            </div>
          </div>

          <div class="space-y-4">
            <div class="bg-white p-3 rounded-lg border border-slate-150">
              <span class="font-bold text-slate-800 block border-b border-slate-100 pb-1.5 mb-1.5">شرح ایراد گزارش شده توسط کارفرما:</span>
              <p class="text-slate-600 leading-relaxed text-[11px]">${service?.issueDescription}</p>
            </div>

            <div class="bg-white p-3 rounded-lg border border-slate-150">
              <span class="font-bold text-emerald-800 block border-b border-slate-100 pb-1.5 mb-1.5">اقدامات انجام‌شده توسط دپارتمان فنی:</span>
              <p class="text-slate-600 leading-relaxed text-[11px]">${service?.actionsTaken || 'در حال عیب‌یابی کالا'}</p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-8 text-center text-[10px] text-slate-500">
            <div>
              <p class="font-bold text-slate-700">تاییدکننده فنی و کارشناس پشتیبانی</p>
              <div class="h-14"></div>
            </div>
            <div>
              <p class="font-bold text-slate-700">امضای نماینده خریدار (تحویل‌گیرنده)</p>
              <div class="h-14"></div>
            </div>
          </div>
        </div>
      `;
    } else {
      innerContent = `
        <div class="text-center py-10 space-y-4">
          <div class="p-4 bg-slate-100 rounded-full text-slate-400 w-16 h-16 flex items-center justify-center mx-auto">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          </div>
          <h4 class="font-bold text-slate-800">${doc.name}</h4>
          <p class="text-xs text-slate-500">این فایل با موفقیت به صورت دستی بارگذاری شده است.</p>
          <p class="text-[10px] text-slate-400 font-mono">اندازه: ${doc.size || 'نامشخص'} - تاریخ ثبت: ${doc.date || 'نامشخص'}</p>
          ${doc.url && doc.url !== '#' ? `
            <div class="pt-4">
              <a href="${doc.url}" target="_blank" class="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-md shadow-sky-500/10 no-print">دانلود و بازکردن مستقیم فایل</a>
            </div>
          ` : ''}
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>${doc.name}</title>
          <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;700&display=swap');
            body {
              font-family: 'Vazirmatn', 'Tahoma', sans-serif;
              background-color: #f8fafc;
              color: #1e293b;
            }
            @media print {
              .no-print { display: none !important; }
              body { background-color: #ffffff; }
              .print-container { border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
            }
          </style>
        </head>
        <body class="p-4 sm:p-8 bg-slate-50 text-slate-800">
          <div class="max-w-4xl mx-auto space-y-4">
            <!-- Control bar for new tab -->
            <div class="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl shadow-lg no-print">
              <div class="flex items-center gap-2">
                <span class="p-1.5 bg-slate-800 rounded-lg text-sky-400">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </span>
                <h1 class="font-bold text-xs sm:text-sm truncate max-w-xs sm:max-w-md">${doc.name}</h1>
              </div>
              <div class="flex items-center gap-2">
                <button onclick="window.print()" class="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-sky-500/10">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                  <span>چاپ سند</span>
                </button>
                <button onclick="window.close()" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition">
                  بستن صفحه
                </button>
              </div>
            </div>

            <!-- Document Container -->
            <div class="bg-white p-6 sm:p-10 rounded-2xl border border-slate-200 shadow-sm print-container">
              ${innerContent}
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const handlePreviewOrDownload = (doc: any) => {
    if (doc.type === 'system' && doc.id) {
      let printModule = '';
      let printId = '';
      if (doc.id.startsWith('proforma-')) {
        printModule = 'proformas';
        printId = doc.id.replace('proforma-', '');
      } else if (doc.id.startsWith('po-')) {
        printModule = 'purchaseOrders';
        printId = doc.id.replace('po-', '');
      } else if (doc.id.startsWith('delivery-pl-')) {
        printModule = 'packagingDelivery';
        printId = doc.id.replace('delivery-pl-', '');
      } else if (doc.id.startsWith('tx-')) {
        printModule = 'transactions';
        printId = doc.id.replace('tx-', '');
      } else if (doc.id.startsWith('service-')) {
        printModule = 'afterSalesServices';
        printId = doc.id.replace('service-', '');
      }
      if (printModule && printId) {
        const url = `/?printModule=${printModule}&printId=${printId}&standalone=true`;
        window.open(url, '_blank');
        return;
      }
    }

    const isImage = doc.url && (doc.url.startsWith('data:image/') || doc.url.startsWith('http') || doc.name.endsWith('.png') || doc.name.endsWith('.jpg') || doc.name.endsWith('.jpeg'));

    if (doc.url !== '#' && !isImage && !doc.url.startsWith('data:')) {
      window.open(doc.url, '_blank');
      return;
    }

    const win = window.open('', '_blank');
    if (win) {
      const html = generateDocumentHtml(doc, selectedProjectForActivities);
      win.document.write(html);
      win.document.close();
    } else {
      alert('لطفاً اجازه باز شدن پنجره‌های پاپ‌آپ (Pop-ups) را در مرورگر خود بدهید تا سند باز شود.');
    }
  };

  const renderProjectSupplyStatus = (project: Project) => {
    // 1. Get proformas of this project
    const projectProformas = proformas.filter(pf => pf.projectId === project.id);
    
    // 2. Filter won or semi-won proformas
    const wonProformas = projectProformas.filter(pf => {
      const outcome = getProformaOutcomeStatus(pf);
      return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
    });

    // 3. Extract items
    const allWonItems: {
      id: string;
      productName: string;
      productCode: string;
      brand: string;
      quantity: number;
      supplyMethod: 'INVENTORY' | 'ORDER' | 'NONE';
      proformaNumber: string;
      proformaId: string;
      proformaStatus: string;
      originalProforma: Proforma;
    }[] = [];

    wonProformas.forEach(pf => {
      let wonItems = [];
      const hasExplicitWon = pf.items?.some(item => item.status === 'برنده');
      if (hasExplicitWon) {
        wonItems = pf.items.filter(item => item.status === 'برنده');
      } else {
        wonItems = pf.items?.filter(item => item.status !== 'بازنده') || [];
      }

      wonItems.forEach(item => {
        // Correctly resolve the supplyMethod: Check matching product from products list
        const matchedProd = products?.find(p => p.id === item.productId || p.code === item.productCode);
        
        // Also check if the project has specified a supply method for this product
        const projectItemNeeded = project.itemsNeeded?.find(i => i.productId === item.productId);
        
        let resolvedSupplyMethod: 'INVENTORY' | 'ORDER' | 'NONE' = 'INVENTORY';
        
        if (item.supplyMethod && item.supplyMethod !== 'INVENTORY') {
          resolvedSupplyMethod = item.supplyMethod;
        } else if (projectItemNeeded && projectItemNeeded.supplyMethod && projectItemNeeded.supplyMethod !== 'INVENTORY') {
          resolvedSupplyMethod = projectItemNeeded.supplyMethod;
        } else if (matchedProd && (matchedProd.stockLevel === 0 ? 'ORDER' : matchedProd.supplyType) === 'ORDER') {
          resolvedSupplyMethod = 'ORDER';
        } else if (item.supplyMethod) {
          resolvedSupplyMethod = item.supplyMethod;
        } else if (projectItemNeeded && projectItemNeeded.supplyMethod) {
          resolvedSupplyMethod = projectItemNeeded.supplyMethod;
        } else if (matchedProd && matchedProd.supplyType) {
          resolvedSupplyMethod = matchedProd.stockLevel === 0 ? 'ORDER' : matchedProd.supplyType;
        }

        allWonItems.push({
          id: item.id,
          productName: item.productName,
          productCode: item.productCode,
          brand: item.brand,
          quantity: item.quantity,
          supplyMethod: resolvedSupplyMethod,
          proformaNumber: pf.proformaNumber,
          proformaId: pf.id,
          proformaStatus: getProformaOutcomeStatus(pf),
          originalProforma: pf
        });
      });
    });

    // Calculations for metrics
    const totalCount = allWonItems.reduce((acc, item) => acc + item.quantity, 0);
    const inventoryCount = allWonItems.filter(item => item.supplyMethod === 'INVENTORY').reduce((acc, item) => acc + item.quantity, 0);
    const orderCount = allWonItems.filter(item => item.supplyMethod === 'ORDER').reduce((acc, item) => acc + item.quantity, 0);
    const noneCount = allWonItems.filter(item => item.supplyMethod === 'NONE').reduce((acc, item) => acc + item.quantity, 0);

    const filteredItems = allWonItems.filter(item => {
      if (supplyFilter === 'ALL') return true;
      return item.supplyMethod === supplyFilter;
    });

    return (
      <div className="space-y-6 text-right" dir="rtl">
        {/* Helper Banner */}
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
              <span>گزارش هوشمند وضعیت تامین کالاهای تایید شده پروژه</span>
            </h3>
            <p className="text-slate-400 text-[10px] mt-1 leading-relaxed">
              این گزارش تمامی اقلام تعهد شده در پیش‌فاکتورهای تایید شده (برنده یا نیمه‌برنده) مرتبط با این پروژه را تحلیل کرده و وضعیت تامین آن‌ها را (از موجودی انبار یا ثبت سفارش خارجی) نمایش می‌دهد.
            </p>
          </div>
          <div className="flex gap-2">
            <span className="text-[10px] font-bold text-slate-600 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>پیش‌فاکتورهای برنده شده: {wonProformas.length} عدد</span>
            </span>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {/* Total */}
          <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] font-bold">کل اقلام تعهد شده</span>
              <div className="text-lg font-bold font-mono text-slate-800">
                {totalCount.toLocaleString('fa-IR')} <span className="text-[11px] font-sans font-medium text-slate-400">عدد</span>
              </div>
            </div>
            <div className="p-2.5 bg-slate-50 text-slate-600 rounded-lg border border-slate-100">
              <Briefcase size={16} />
            </div>
          </div>

          {/* Inventory */}
          <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-emerald-600 text-[10px] font-bold">تامین از انبار (موجودی)</span>
              <div className="text-lg font-bold font-mono text-emerald-600">
                {inventoryCount.toLocaleString('fa-IR')}{" "}
                <span className="text-[11px] font-sans font-medium text-slate-400">
                  عدد ({totalCount > 0 ? Math.round((inventoryCount / totalCount) * 100) : 0}٪)
                </span>
              </div>
            </div>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
              <CheckCircle2 size={16} />
            </div>
          </div>

          {/* Foreign Order */}
          <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-amber-600 text-[10px] font-bold">سفارش خارجی (سفارشی)</span>
              <div className="text-lg font-bold font-mono text-amber-600">
                {orderCount.toLocaleString('fa-IR')}{" "}
                <span className="text-[11px] font-sans font-medium text-slate-400">
                  عدد ({totalCount > 0 ? Math.round((orderCount / totalCount) * 100) : 0}٪)
                </span>
              </div>
            </div>
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-100">
              <TrendingUp size={16} />
            </div>
          </div>

          {/* No Supply Needed */}
          <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
            <div className="space-y-1">
              <span className="text-slate-500 text-[10px] font-bold">بدون نیاز به تامین</span>
              <div className="text-lg font-bold font-mono text-slate-500">
                {noneCount.toLocaleString('fa-IR')} <span className="text-[11px] font-sans font-medium text-slate-400">عدد</span>
              </div>
            </div>
            <div className="p-2.5 bg-slate-50 text-slate-500 rounded-lg border border-slate-100">
              <XCircle size={16} />
            </div>
          </div>
        </div>

        {/* Filter and Content Table */}
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 bg-slate-100/70 p-1 rounded-xl w-fit border border-slate-200">
            <button
              type="button"
              onClick={() => setSupplyFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                supplyFilter === 'ALL' ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              همه اقلام ({allWonItems.length})
            </button>
            <button
              type="button"
              onClick={() => setSupplyFilter('INVENTORY')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                supplyFilter === 'INVENTORY' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              تامین از انبار ({allWonItems.filter(i => i.supplyMethod === 'INVENTORY').length})
            </button>
            <button
              type="button"
              onClick={() => setSupplyFilter('ORDER')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                supplyFilter === 'ORDER' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              سفارش خارجی ({allWonItems.filter(i => i.supplyMethod === 'ORDER').length})
            </button>
            <button
              type="button"
              onClick={() => setSupplyFilter('NONE')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                supplyFilter === 'NONE' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              بدون نیاز به تامین ({allWonItems.filter(i => i.supplyMethod === 'NONE').length})
            </button>
          </div>

          {/* Table */}
          {filteredItems.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center space-y-3">
              <div className="p-4 bg-slate-50 rounded-full text-slate-400">
                <Briefcase size={32} />
              </div>
              <p className="text-slate-700 text-xs font-bold">هیچ کالایی با شرایط فیلتر یافت نشد</p>
              <p className="text-[10px] text-slate-400 max-w-xs leading-relaxed">
                در این پروژه اقلامی با این روش تامین هنوز مشخص یا تعهد نشده‌اند.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                      <th className="p-3 w-12 text-center">ردیف</th>
                      <th className="p-3">نام کالا / پارت‌نامبر / برند</th>
                      <th className="p-3 w-44">پیش‌فاکتور مرجع</th>
                      <th className="p-3 w-28 text-center">تعداد جهت تامین</th>
                      <th className="p-3 w-40">روش تامین کالا</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item, idx) => {
                      return (
                        <tr key={item.id || idx} className="hover:bg-slate-50/40 transition">
                          <td className="p-3 text-center text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                          <td className="p-3">
                            <div>
                              <span className="font-bold text-slate-800 text-xs">{item.productName}</span>
                              <span className="text-[10px] text-slate-400 font-medium block mt-1">
                                کد کالا: <strong className="font-mono">{item.productCode}</strong> - برند: <strong className="text-slate-500">{item.brand}</strong>
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => {
                                handlePreviewOrDownload({
                                  id: `proforma-${item.proformaId}`,
                                  name: `پیش‌فاکتور ${item.proformaNumber}.pdf`,
                                  url: '#',
                                  size: 'سند سیستم',
                                  date: item.originalProforma.issueDate,
                                  type: 'system',
                                  originalEntity: item.originalProforma
                                });
                              }}
                              className="text-sky-600 hover:text-sky-700 font-bold hover:underline flex items-center gap-1 w-fit"
                              title="مشاهده پیش‌فاکتور رسمی مرجع"
                            >
                              <File size={13} className="shrink-0" />
                              <span className="font-mono text-[11px]">{item.proformaNumber}</span>
                              <span className="text-[9px] font-normal px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 leading-none">
                                {item.proformaStatus}
                              </span>
                            </button>
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-slate-700 text-xs">
                            {item.quantity.toLocaleString('fa-IR')}
                          </td>
                          <td className="p-3">
                            {item.supplyMethod === 'INVENTORY' ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold border bg-emerald-50 text-emerald-700 border-emerald-100 flex items-center gap-1.5 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                <span>تامین از انبار (موجودی)</span>
                              </span>
                            ) : item.supplyMethod === 'ORDER' ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold border bg-amber-50 text-amber-700 border-amber-100 flex items-center gap-1.5 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                <span>سفارش خارجی</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold border bg-slate-50 text-slate-500 border-slate-200 flex items-center gap-1.5 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                <span>بدون نیاز به تامین</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderProjectMilestones = (project: Project) => {
    const projectMilestones = project.milestones || [];
    const projectRules = project.milestoneRules || [];

    const handleAddMilestone = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newMilestoneName.trim()) return;

      const newMs = {
        id: `ms-${Date.now()}`,
        name: newMilestoneName.trim(),
        isCompleted: false,
        dueDate: newMilestoneDueDate || undefined,
        notes: newMilestoneNotes.trim() || undefined,
        triggerType: newMilestoneTriggerType,
        triggerCategoryName: newMilestoneTriggerType !== 'manual' ? newMilestoneTriggerCategoryName : undefined
      };

      const updated = {
        ...project,
        milestones: [...projectMilestones, newMs]
      };

      updateProject(updated);
      setNewMilestoneName("");
      setNewMilestoneDueDate("");
      setNewMilestoneNotes("");
      setNewMilestoneTriggerType("manual");
      setNewMilestoneTriggerCategoryName("");
    };

    const handleToggleMilestone = (milestoneId: string) => {
      const updatedMilestones = projectMilestones.map(m => {
        if (m.id === milestoneId) {
          const nextCompleted = !m.isCompleted;
          return {
            ...m,
            isCompleted: nextCompleted,
            completedAt: nextCompleted ? getTodayShamsi() : undefined
          };
        }
        return m;
      });

      const updated = {
        ...project,
        milestones: updatedMilestones
      };

      updateProject(updated);
    };

    const handleDeleteMilestone = (milestoneId: string) => {
      const updatedMilestones = projectMilestones.filter(m => m.id !== milestoneId);
      // Also filter out any rules tied to this deleted milestone
      const updatedRules = projectRules.filter(r => r.triggerMilestoneId !== milestoneId);

      const updated = {
        ...project,
        milestones: updatedMilestones,
        milestoneRules: updatedRules
      };

      updateProject(updated);
    };

    const handleAddRule = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRuleMilestoneId || !newRuleTitle.trim()) return;

      const newRule = {
        id: `rule-${Date.now()}`,
        triggerMilestoneId: newRuleMilestoneId,
        actionType: newRuleActionType,
        taskTitle: newRuleTitle.trim(),
        taskDesc: newRuleDesc.trim(),
        assignedTo: newRuleAssignedTo || 'admin',
        priority: newRulePriority,
        dueDaysOffset: newRuleDueDays
      };

      const updated = {
        ...project,
        milestoneRules: [...projectRules, newRule]
      };

      updateProject(updated);
      setNewRuleTitle("");
      setNewRuleDesc("");
      setNewRuleAssignedTo("");
      setNewRulePriority("متوسط");
      setNewRuleDueDays(0);
      setShowRuleForm(false);
    };

    const handleDeleteRule = (ruleId: string) => {
      const updatedRules = projectRules.filter(r => r.id !== ruleId);
      const updated = {
        ...project,
        milestoneRules: updatedRules
      };
      updateProject(updated);
    };

    return (
      <div className="space-y-6 animate-fade-in text-right" dir="rtl">
        {/* Explanation Card */}
        <div className="bg-gradient-to-r from-sky-50 to-indigo-50 p-5 rounded-2xl border border-sky-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Zap size={18} className="text-sky-600 animate-pulse" />
              مدیریت نقاط حیاتی (Milestones) و اتوماسیون وظایف پروژه
            </h3>
            <p className="text-slate-600 text-xs leading-relaxed max-w-3xl">
              در این بخش می‌توانید نقاط عطف و نقاط حیاتی مخصوص به این پروژه را (مثلاً مراحل تسویه قرارداد، تحویل مدارک، اتمام مهندسی) تعریف کنید. همچنین می‌توانید قوانین اتوماسیونی تنظیم کنید تا با علامت‌گذاری هر نقطه حیاتی به عنوان «انجام شده»، وظایف (تسک‌ها) مرتبط یا اعلان‌های سیستم به صورت خودکار برای پرسنل صادر گردد.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Right Column: Milestones Management */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="font-bold text-xs md:text-sm text-slate-800 flex items-center gap-2">
                <Flag size={16} className="text-sky-500" />
                لیست نقاط حیاتی پروژه ({projectMilestones.length})
              </h4>
            </div>

            {/* Add Milestone Form */}
            <form onSubmit={handleAddMilestone} className="bg-slate-50/50 p-4 rounded-xl border border-slate-200 space-y-3">
              <span className="block text-[11px] font-bold text-slate-700">تعریف نقطه حیاتی جدید برای پروژه:</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 block">عنوان نقطه حیاتی *</label>
                  <input
                    type="text"
                    value={newMilestoneName}
                    onChange={(e) => setNewMilestoneName(e.target.value)}
                    placeholder="مثال: اتمام خرید خارجی تجهیزات"
                    className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 block">تاریخ هدف (شمسی)</label>
                  <ShamsiDatePicker
                    value={newMilestoneDueDate}
                    onChange={setNewMilestoneDueDate}
                    placeholder="۱۴۰۲/۰۶/۳۰"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 block">توضیحات و نکات اختیاری</label>
                <input
                  type="text"
                  value={newMilestoneNotes}
                  onChange={(e) => setNewMilestoneNotes(e.target.value)}
                  placeholder="نکات مرتبط با پرداخت یا ارسال مدارک این مرحله..."
                  className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                />
              </div>

              {/* Trigger Type Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-100 pt-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 block">نوع تریگر (فعال‌سازی)</label>
                  <select
                    value={newMilestoneTriggerType}
                    onChange={(e) => {
                      const val = e.target.value as 'manual' | 'category_start' | 'category_complete';
                      setNewMilestoneTriggerType(val);
                      if (val === 'manual') {
                        setNewMilestoneTriggerCategoryName("");
                      } else if (!newMilestoneTriggerCategoryName) {
                        setNewMilestoneTriggerCategoryName("");
                      }
                    }}
                    className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white font-sans"
                  >
                    <option value="manual">دستی (توسط کاربر)</option>
                    <option value="category_start">خودکار با شروع دسته‌بندی فعالیت پروژه</option>
                    <option value="category_complete">خودکار با اتمام دسته‌بندی فعالیت پروژه</option>
                  </select>
                </div>

                {newMilestoneTriggerType !== 'manual' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">انتخاب دسته‌بندی فعالیت مربوطه</label>
                    <select
                      value={newMilestoneTriggerCategoryName}
                      onChange={(e) => setNewMilestoneTriggerCategoryName(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white font-sans"
                    >
                      <option value="" disabled>-- انتخاب کنید --</option>
                      <optgroup label="ماژول‌های سیستمی">
                        <option value="پیش‌فاکتورها">پیش‌فاکتورها</option>
                        <option value="سفارشات خرید (PO)">سفارشات خرید (PO)</option>
                        <option value="بسته‌بندی و ارسال">بسته‌بندی و ارسال</option>
                        <option value="خدمات پس از فروش">خدمات پس از فروش</option>
                      </optgroup>
                      <optgroup label="دسته‌بندی‌های سفارشی (فعالیت‌ها)">
                        {(settings.activityCategories || []).map(cat => (
                          <option key={cat.id} value={cat.name}>{cat.name}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={!newMilestoneName.trim() || (newMilestoneTriggerType !== 'manual' && !newMilestoneTriggerCategoryName)}
                  className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold py-1.5 px-4 rounded-lg text-xs flex items-center gap-1.5 transition-all shadow-sm shadow-sky-600/10"
                >
                  <Plus size={14} />
                  ثبت نقطه حیاتی
                </button>
              </div>
            </form>

            {/* Milestones List */}
            {projectMilestones.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                هیچ نقطه حیاتی برای این پروژه ثبت نشده است. ابتدا یک مورد در فرم بالا ثبت کنید.
              </div>
            ) : (
              <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                {projectMilestones.map((m) => {
                  return (
                    <div
                      key={m.id}
                      className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                        m.isCompleted 
                          ? 'bg-emerald-50/40 border-emerald-100' 
                          : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleMilestone(m.id)}
                          className={`mt-0.5 p-1 rounded-full border flex items-center justify-center transition-all ${
                            m.isCompleted
                              ? 'bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600'
                              : 'bg-white border-slate-300 text-transparent hover:border-emerald-500'
                          }`}
                          title={m.isCompleted ? "تغییر وضعیت به در انتظار" : "تغییر وضعیت به انجام شده (کلیک برای فعالسازی اتوماسیون)"}
                        >
                          <Check size={12} className={m.isCompleted ? "text-white" : "text-emerald-500"} />
                        </button>
                        <div className="space-y-1">
                          <span className={`text-xs font-bold block ${m.isCompleted ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                            {m.name}
                          </span>
                          {m.notes && (
                            <p className="text-[10px] text-slate-500 leading-relaxed max-w-sm">
                              {m.notes}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 text-[10px]">
                            {m.dueDate && (
                              <span className="text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                تاریخ هدف: {m.dueDate}
                              </span>
                            )}
                            {m.isCompleted && m.completedAt && (
                              <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-bold">
                                تاریخ انجام: {m.completedAt}
                              </span>
                            )}
                            {m.triggerType && m.triggerType !== 'manual' && (
                              <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                                <Zap size={10} className="text-indigo-500 animate-pulse" />
                                تریگر هوشمند: {m.triggerType === 'category_start' ? 'شروع' : 'اتمام'} «{m.triggerCategoryName}»
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteMilestone(m.id)}
                        className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1 rounded-lg transition-all"
                        title="حذف نقطه حیاتی"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Left Column: Automations/Workflows */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="font-bold text-xs md:text-sm text-slate-800 flex items-center gap-2">
                <Sliders size={16} className="text-indigo-500" />
                قوانین اتوماسیون وظایف پروژه ({projectRules.length})
              </h4>
              {!showRuleForm && projectMilestones.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setNewRuleMilestoneId(projectMilestones[0]?.id || "");
                    setShowRuleForm(true);
                  }}
                  className="text-indigo-600 hover:text-indigo-700 font-bold text-xs flex items-center gap-1"
                >
                  <Plus size={14} />
                  قانون اتوماسیون جدید
                </button>
              )}
            </div>

            {/* Add Rule Form */}
            {showRuleForm && (
              <form onSubmit={handleAddRule} className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100 space-y-3">
                <span className="block text-[11px] font-bold text-indigo-900">تعریف گردش‌کار خودکار جدید:</span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">هنگام اتمام نقطه حیاتی *</label>
                    <select
                      value={newRuleMilestoneId}
                      onChange={(e) => setNewRuleMilestoneId(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                      required
                    >
                      {projectMilestones.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">نوع اقدام خودکار *</label>
                    <select
                      value={newRuleActionType}
                      onChange={(e) => setNewRuleActionType(e.target.value as any)}
                      className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                      required
                    >
                      <option value="create_task">ایجاد خودکار وظیفه (تسک)</option>
                      <option value="send_notification">ارسال اعلان سیستمی</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 block">عنوان وظیفه / اعلان *</label>
                  <input
                    type="text"
                    value={newRuleTitle}
                    onChange={(e) => setNewRuleTitle(e.target.value)}
                    placeholder="مثال: پیگیری دریافت ۲۰ درصد قرارداد بابت خرید کالا"
                    className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 block">توضیحات و راهنمایی برای پرسنل</label>
                  <textarea
                    value={newRuleDesc}
                    onChange={(e) => setNewRuleDesc(e.target.value)}
                    placeholder="مثال: با توجه به اتمام خرید خارجی کالا در این پروژه، مسئول مالی موظف است صورت وضعیت ۲۰ درصد را ارسال و پیگیری کند."
                    className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">مسئول انجام / مخاطب *</label>
                    <select
                      value={newRuleAssignedTo}
                      onChange={(e) => setNewRuleAssignedTo(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                      required
                    >
                      <option value="">-- انتخاب کاربر --</option>
                      {users.map(u => (
                        <option key={u.id} value={u.fullName}>{u.fullName}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">اولویت</label>
                    <select
                      value={newRulePriority}
                      onChange={(e) => setNewRulePriority(e.target.value as any)}
                      className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                    >
                      <option value="پایین">پایین</option>
                      <option value="متوسط">متوسط</option>
                      <option value="بالا">بالا</option>
                      <option value="فوری">فوری</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">مهلت انجام (روز پس از رویداد)</label>
                    <input
                      type="number"
                      min={0}
                      value={newRuleDueDays}
                      onChange={(e) => setNewRuleDueDays(parseInt(e.target.value) || 0)}
                      className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white text-left font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowRuleForm(false)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-1.5 px-3 rounded-lg transition-all"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    disabled={!newRuleTitle.trim() || !newRuleAssignedTo}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-1.5 px-4 rounded-lg transition-all shadow-sm"
                  >
                    ثبت قانون اتوماسیون
                  </button>
                </div>
              </form>
            )}

            {projectMilestones.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs bg-slate-50 rounded-xl border border-slate-150">
                جهت تعریف قانون اتوماسیون، ابتدا باید حداقل یک نقطه حیاتی در پنل سمت راست تعریف کنید.
              </div>
            ) : projectRules.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                هیچ قانون اتوماسیونی برای این پروژه تعریف نشده است.
              </div>
            ) : (
              <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                {projectRules.map((rule) => {
                  const triggerMilestone = projectMilestones.find(m => m.id === rule.triggerMilestoneId);
                  return (
                    <div key={rule.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-start justify-between gap-2 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="bg-indigo-100 text-indigo-800 text-[9px] font-bold px-1.5 py-0.5 rounded">
                              رویداد: اتمام «{triggerMilestone?.name || 'حذف‌شده'}»
                            </span>
                            <span className="text-slate-400">⚡️</span>
                            <span className="bg-sky-100 text-sky-800 text-[9px] font-bold px-1.5 py-0.5 rounded">
                              {rule.actionType === 'create_task' ? 'ایجاد خودکار تسک' : 'ارسال اعلان'}
                            </span>
                          </div>
                          <span className="font-bold text-slate-800 block text-xs">
                            {rule.taskTitle}
                          </span>
                          {rule.taskDesc && (
                            <p className="text-[10px] text-slate-500 leading-relaxed">
                              {rule.taskDesc}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500 pt-1">
                            <span>ارجاع به: <strong className="text-slate-700">{rule.assignedTo}</strong></span>
                            <span>اولویت: <strong className="text-slate-700">{rule.priority}</strong></span>
                            <span>مهلت: <strong className="text-slate-700">{rule.dueDaysOffset || 0} روز</strong></span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-lg transition-all"
                          title="حذف قانون اتوماسیون"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    );
  };

  const renderProjectDocuments = (project: Project) => {
    const { folders, folderFiles } = getProjectFoldersAndFiles(project);

    if (selectedFolderName === null) {
      return (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-150">
            <div>
              <h3 className="font-bold text-slate-800 text-xs">پوشه‌بندی هوشمند مدارک و اسناد پروژه</h3>
              <p className="text-slate-400 text-[10px] mt-0.5">لیست زیر شامل پوشه‌های ثابت هماهنگ با ماژول‌های سیستم است. مستندات تولیدشده هر ماژول به صورت خودکار در پوشه خود بایگانی می‌شود.</p>
            </div>
            <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-1 rounded-md border border-slate-200">کل اسناد: {Object.values(folderFiles).reduce((acc: number, f) => acc + (f as any[]).length, 0)} فایل</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {folders.map((folder) => {
              const filesInFolder = folderFiles[folder.name] || [];
              const FolderIcon = folder.icon;
              return (
                <div
                  key={folder.id}
                  onClick={() => setSelectedFolderName(folder.name)}
                  className="bg-white p-5 rounded-2xl border border-slate-100 hover:border-sky-500 hover:shadow-lg hover:shadow-sky-500/5 transition duration-200 cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div className={`p-2.5 rounded-xl border ${folder.iconBg} transition-colors group-hover:bg-sky-500 group-hover:text-white group-hover:border-transparent flex items-center justify-center`}>
                        <FolderIcon size={18} />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md group-hover:bg-sky-50 group-hover:text-sky-600 transition-colors">
                        {filesInFolder.length} فایل
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800 text-xs group-hover:text-sky-600 transition-colors">{folder.name}</h4>
                      <p className="text-slate-400 text-[10px] mt-1 leading-relaxed line-clamp-2 h-7">{folder.desc}</p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-[10px] font-bold text-slate-400 group-hover:text-sky-600 transition-colors">
                    <span>ورود به پوشه</span>
                    <ChevronLeft size={12} className="transform group-hover:-translate-x-1 transition-transform" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    const currentFolderFiles = folderFiles[selectedFolderName] || [];
    const folderDesc = folders.find(f => f.name === selectedFolderName)?.desc || '';

    return (
      <div className="space-y-4">
        {/* Breadcrumbs / Back button */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedFolderName(null)}
              className="text-[11px] font-bold text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-lg transition flex items-center gap-1"
            >
              <ChevronRight size={13} className="rtl:rotate-180" />
              <span>پوشه‌های پروژه</span>
            </button>
            <span className="text-slate-300 text-xs">/</span>
            <span className="text-xs font-bold text-slate-800">{selectedFolderName}</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* File Upload Input */}
            <div className="relative overflow-hidden flex-1 sm:flex-initial">
              <input
                type="file"
                multiple
                disabled={isUploadingDoc}
                onChange={(e) => handleFileUpload(e, selectedFolderName)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              />
              <button
                type="button"
                className={`w-full sm:w-auto px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-sky-500/10 ${isUploadingDoc ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {isUploadingDoc ? (
                  <span className="flex items-center gap-1 animate-pulse">
                    <Loader2 size={14} className="animate-spin" />
                    درحال بارگذاری...
                  </span>
                ) : (
                  <>
                    <Upload size={14} />
                    بارگذاری فایل جدید
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <p className="text-slate-500 text-[10px] px-1 font-medium">{folderDesc}</p>

        {/* Drag and Drop Zone / Empty State */}
        {currentFolderFiles.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border-2 border-dashed border-slate-200 hover:border-sky-500 transition-colors relative flex flex-col items-center justify-center space-y-3">
            <input
              type="file"
              multiple
              disabled={isUploadingDoc}
              onChange={(e) => handleFileUpload(e, selectedFolderName)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
            />
            <div className="p-4 bg-slate-50 rounded-full text-slate-400">
              <Folder size={32} />
            </div>
            <p className="text-slate-700 text-xs font-bold">این پوشه در حال حاضر خالی است</p>
            <p className="text-[10px] text-slate-400 max-w-xs leading-relaxed">فایل‌های خود را برای بارگذاری در این پوشه بکشید و رها کنید یا بر روی دکمه بارگذاری کلیک کنید.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-3 w-12 text-center">ردیف</th>
                    <th className="p-3">نام مدرک / سند</th>
                    <th className="p-3 w-32">تاریخ ایجاد/ثبت</th>
                    <th className="p-3 w-32">اندازه / منبع</th>
                    <th className="p-3 w-36">نوع بایگانی</th>
                    <th className="p-3 w-28 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {currentFolderFiles.map((doc, idx) => {
                    const isSystem = doc.type === 'system';
                    return (
                      <tr key={doc.id || idx} className="hover:bg-slate-50/50 transition">
                        <td className="p-3 text-center text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${isSystem ? 'bg-sky-50 text-sky-600' : 'bg-indigo-50 text-indigo-600'} flex items-center justify-center`}>
                              {doc.name.endsWith('.png') || doc.name.endsWith('.jpg') || doc.name.endsWith('.jpeg') ? (
                                <ImageIcon size={14} />
                              ) : (
                                <File size={14} />
                              )}
                            </div>
                            <span className="font-semibold text-slate-700 hover:text-sky-600 transition-colors cursor-pointer text-xs" onClick={() => handlePreviewOrDownload(doc)}>
                              {doc.name}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-[10px]">{doc.date}</td>
                        <td className="p-3 text-slate-500 text-[10px]">{doc.size}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${isSystem ? 'bg-sky-50 text-sky-700 border-sky-100' : doc.type === 'attachment' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                            {isSystem ? 'سیستمی (خودکار)' : doc.type === 'attachment' ? 'پیوست درخواست' : 'آپلود دستی'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex gap-1.5 justify-center">
                            <button
                              onClick={() => handlePreviewOrDownload(doc)}
                              className="p-1.5 hover:bg-sky-50 rounded text-sky-600 hover:text-sky-700 transition"
                              title={isSystem ? "مشاهده سند در ماژول اصلی (تب جدید)" : "پیش‌نمایش مدرک"}
                            >
                              {isSystem ? <ExternalLink size={14} /> : <Eye size={14} />}
                            </button>
                            {!isSystem && (
                              <button
                                onClick={() => handleFileDelete(doc.id || '', doc.name, doc.type as any)}
                                className="p-1.5 hover:bg-red-50 rounded text-red-600 hover:text-red-700 transition"
                                title="حذف"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                            {doc.url !== '#' && (
                              <button
                                type="button"
                                onClick={() => downloadFileFromServer(doc.url, doc.name)}
                                className="p-1.5 hover:bg-slate-100 rounded text-slate-600 hover:text-slate-800 transition flex items-center cursor-pointer"
                                title="دانلود مستقیم"
                              >
                                <Download size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderDocumentPreviewModal = () => {
    if (!activePreviewDoc) return null;

    const doc = activePreviewDoc;
    const isImage = doc.url && doc.url.startsWith('data:image/');

    return (
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-8 max-h-[90vh]">
          {/* Header */}
          <div className="bg-slate-900 text-white p-4 flex justify-between items-center text-right">
            <div className="flex items-center gap-2">
              <File size={18} className="text-sky-400" />
              <h3 className="font-bold text-sm">{doc.name}</h3>
            </div>
            <div className="flex items-center gap-2">
              {doc.url !== '#' && (
                <button
                  type="button"
                  onClick={() => downloadFileFromServer(doc.url, doc.name)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <Download size={13} />
                  <span>دانلود فایل</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const printContents = document.getElementById('printable-document-content')?.innerHTML;
                  if (printContents) {
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>${doc.name}</title>
                            <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
                            <style>
                              body { font-family: 'Tahoma', sans-serif; direction: rtl; text-align: right; }
                              @media print {
                                .no-print { display: none; }
                              }
                            </style>
                          </head>
                          <body class="p-8 bg-white text-slate-800">
                            ${printContents}
                            <script>
                              window.onload = function() {
                                window.print();
                                window.close();
                              }
                            </script>
                          </body>
                        </html>
                      `);
                      printWindow.document.close();
                    }
                  }
                }}
                className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
              >
                <span>چاپ سند</span>
              </button>
              <button
                onClick={() => setActivePreviewDoc(null)}
                className="p-1.5 hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content Scrollable area */}
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50 text-right">
            <div id="printable-document-content" className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm mx-auto max-w-3xl min-h-[500px] text-slate-800">
              {isImage ? (
                <div className="flex flex-col items-center justify-center space-y-4">
                  <img src={doc.url} alt={doc.name} className="max-w-full max-h-[60vh] rounded-lg border border-slate-200 shadow-sm object-contain" referrerPolicy="no-referrer" />
                  <p className="text-[10px] text-slate-400 font-mono">اندازه: {doc.size} - تاریخ ثبت: {doc.date}</p>
                </div>
              ) : doc.id?.startsWith('proforma-') ? (
                // 1. Proforma Preview
                <div className="space-y-6 text-xs">
                  <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                    <div className="space-y-1">
                      <h2 className="text-base font-bold text-slate-900">پیش‌فاکتور رسمی فروش کالا</h2>
                      <p className="text-slate-400 text-[10px]">شرکت ابزار تامین عرشیا (واحد مالی و مهندسی فروش)</p>
                    </div>
                    <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                      <div>No: {doc.originalEntity?.proformaNumber}</div>
                      <div>Date: {doc.originalEntity?.issueDate}</div>
                      <div>Status: {doc.originalEntity?.status}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div>
                      <span className="text-slate-400 font-bold">خریدار / کارفرما:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.customerName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">کارشناس مسئول:</span>
                      <span className="text-slate-800 font-bold mr-1">{selectedProjectForActivities?.salesExpert || 'مشخص نشده'}</span>
                    </div>
                  </div>

                  <table className="w-full text-right border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                        <th className="p-2 border border-slate-200 text-center w-10">ردیف</th>
                        <th className="p-2 border border-slate-200">شرح کالا / خدمات</th>
                        <th className="p-2 border border-slate-200 text-center w-16">تعداد</th>
                        <th className="p-2 border border-slate-200 text-left">قیمت واحد (ریال)</th>
                        <th className="p-2 border border-slate-200 text-left">قیمت کل (ریال)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.originalEntity?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-slate-150">
                          <td className="p-2 border border-slate-200 text-center font-mono">{idx + 1}</td>
                          <td className="p-2 border border-slate-200">
                            <span className="font-bold text-slate-800">{item.name}</span>
                            <span className="text-[10px] text-slate-500 block">برند: {item.brand || 'متفرقه'} - پارت‌نامبر: {item.partNumber || '-'}</span>
                          </td>
                          <td className="p-2 border border-slate-200 text-center font-mono">{item.quantity}</td>
                          <td className="p-2 border border-slate-200 text-left font-mono">{item.unitPrice?.toLocaleString('fa-IR')}</td>
                          <td className="p-2 border border-slate-200 text-left font-mono">{(item.unitPrice * item.quantity)?.toLocaleString('fa-IR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex justify-end">
                    <div className="w-64 space-y-1.5 text-[11px]">
                      <div className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400 font-bold">مجموع ناخالص:</span>
                        <span className="font-mono">{doc.originalEntity?.totalAmount?.toLocaleString('fa-IR')} ریال</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400 font-bold">تخفیف:</span>
                        <span className="font-mono text-red-600">{(doc.originalEntity?.discountAmount || 0)?.toLocaleString('fa-IR')} ریال</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400 font-bold">مالیات بر ارزش افزوده (۱۰٪):</span>
                        <span className="font-mono">{(doc.originalEntity?.vatAmount || 0)?.toLocaleString('fa-IR')} ریال</span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-900 border-b-2 border-slate-300 pb-1.5 text-xs">
                        <span>مبلغ قابل پرداخت:</span>
                        <span className="font-mono">{doc.originalEntity?.finalAmount?.toLocaleString('fa-IR')} ریال</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-10 text-center text-[10px] text-slate-400">
                    <div>
                      <p className="font-bold text-slate-700">مهر و امضای بخش مالی شرکت</p>
                      <div className="h-20 w-32 mx-auto border-2 border-dashed border-slate-200 rounded-lg mt-2 flex items-center justify-center">
                        <span className="text-[8px] rotate-12">امضا و مهر معتبر</span>
                      </div>
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">مهر و تایید خریدار</p>
                      <div className="h-20 w-32 mx-auto border-2 border-dashed border-slate-200 rounded-lg mt-2 flex items-center justify-center">
                        <span className="text-[8px]">محل امضای خریدار</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : doc.id?.startsWith('po-') ? (
                // 2. PO Preview
                <div className="space-y-6 text-xs">
                  <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">سفارش رسمی خرید کالا (PO)</h2>
                      <p className="text-slate-400 text-[10px]">واحد تامین و بازرگانی خارجی/داخلی</p>
                    </div>
                    <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                      <div>PO No: {doc.originalEntity?.poNumber}</div>
                      <div>Date: {doc.originalEntity?.orderDate}</div>
                      <div>Status: {doc.originalEntity?.status}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div>
                      <span className="text-slate-400 font-bold">تامین‌کننده / سازنده:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.supplierName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">ارز مبادلاتی:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.currency}</span>
                    </div>
                  </div>

                  <table className="w-full text-right border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                        <th className="p-2 border border-slate-200 text-center w-10">ردیف</th>
                        <th className="p-2 border border-slate-200">نام کالا / پارت‌نامبر</th>
                        <th className="p-2 border border-slate-200 text-center w-16">تعداد</th>
                        <th className="p-2 border border-slate-200 text-left">قیمت ارزی واحد</th>
                        <th className="p-2 border border-slate-200 text-left">قیمت ارزی کل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.originalEntity?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-slate-150">
                          <td className="p-2 border border-slate-200 text-center font-mono">{idx + 1}</td>
                          <td className="p-2 border border-slate-200">
                            <span className="font-bold text-slate-800">{item.name}</span>
                            <span className="text-[10px] text-slate-500 block">برند: {item.brand || '-'} - پارت‌نامبر: {item.partNumber || '-'}</span>
                          </td>
                          <td className="p-2 border border-slate-200 text-center font-mono">{item.quantity}</td>
                          <td className="p-2 border border-slate-200 text-left font-mono">{item.foreignUnitPrice?.toLocaleString('fa-IR')} {doc.originalEntity?.currency}</td>
                          <td className="p-2 border border-slate-200 text-left font-mono">{(item.foreignUnitPrice * item.quantity)?.toLocaleString('fa-IR')} {doc.originalEntity?.currency}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex justify-between items-center pt-8 text-[10px] text-slate-500">
                    <div>
                      <p><span className="font-bold">شرایط پرداخت:</span> {doc.originalEntity?.paymentTerms || 'طبق توافق'}</p>
                      <p><span className="font-bold">مدت تحویل:</span> {doc.originalEntity?.deliveryLeadTime || 'مشخص نشده'}</p>
                    </div>
                    <div className="text-center font-bold text-slate-700 w-48">
                      <p>امضا کارشناس بازرگانی</p>
                      <div className="h-14"></div>
                    </div>
                  </div>
                </div>
              ) : doc.id?.startsWith('delivery-') ? (
                // 3. Packaging & Packing List Preview
                <div className="space-y-6 text-xs">
                  <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">سند رسمی پکینگ لیست (Packing List)</h2>
                      <p className="text-slate-400 text-[10px]">واحد انبار و لجستیک کالا</p>
                    </div>
                    <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                      <div>Packing No: {doc.originalEntity?.packingListNumber}</div>
                      <div>Delivery Date: {doc.originalEntity?.deliveryDate}</div>
                      <div>Shipping Method: {doc.originalEntity?.shippingMethod}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100 text-[11px]">
                    <div>
                      <span className="text-slate-400 font-bold">تعداد کل کارتن/بسته:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.boxCount} عدد</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">وزن ناخالص کل (کیلوگرم):</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.grossWeightKg} کیلوگرم</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">ابعاد حدودی بسته‌ها:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.dimensionsCm || 'استاندارد'}</span>
                    </div>
                  </div>

                  <table className="w-full text-right border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                        <th className="p-2 border border-slate-200 text-center w-10">ردیف</th>
                        <th className="p-2 border border-slate-200">نام تجهیز / کالا</th>
                        <th className="p-2 border border-slate-200 text-center">تعداد سفارش</th>
                        <th className="p-2 border border-slate-200 text-center">تعداد آماده‌سازی</th>
                        <th className="p-2 border border-slate-200 text-center">بسته‌بندی کامل؟</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.originalEntity?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-slate-150">
                          <td className="p-2 border border-slate-200 text-center font-mono">{idx + 1}</td>
                          <td className="p-2 border border-slate-200 font-bold text-slate-800">{item.name}</td>
                          <td className="p-2 border border-slate-200 text-center font-mono">{item.orderedQty}</td>
                          <td className="p-2 border border-slate-200 text-center font-mono">{item.packedQty}</td>
                          <td className="p-2 border border-slate-200 text-center text-emerald-600 font-bold">{item.isPacked ? '✓ بله' : '✗ خیر'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="grid grid-cols-2 gap-4 pt-8 text-center text-[10px] text-slate-500">
                    <div>
                      <p className="font-bold text-slate-700">تاییدکننده صحت بسته‌بندی (مسئول انبار)</p>
                      <div className="h-14"></div>
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">گیرنده نهایی کالا / کارفرما</p>
                      <div className="h-14"></div>
                    </div>
                  </div>
                </div>
              ) : doc.id?.startsWith('tx-') ? (
                // 4. Financial Transaction Receipt Preview
                <div className="space-y-6 text-xs">
                  <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">{doc.originalEntity?.type === 'دریافت' ? 'رسید دریافت وجه (سند بستانکار)' : 'سند پرداخت وجه (سند بدهکار)'}</h2>
                      <p className="text-slate-400 text-[10px]">امور مالی و خزانه‌داری عرشیا</p>
                    </div>
                    <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                      <div>Voucher No: {doc.originalEntity?.documentNumber}</div>
                      <div>Date: {doc.originalEntity?.date}</div>
                      <div>Ref No: {doc.originalEntity?.referenceNumber || '-'}</div>
                    </div>
                  </div>

                  <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-700 text-[11px]">
                    <div>
                      <span className="text-slate-400 font-bold">مبلغ تراکنش:</span>
                      <strong className="text-slate-900 text-sm font-mono mr-1">{doc.originalEntity?.amountRIYAL?.toLocaleString('fa-IR')} ریال</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">نوع پرداخت/دریافت:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.paymentType}</span>
                    </div>
                    {doc.originalEntity?.bankName && (
                      <div>
                        <span className="text-slate-400 font-bold">نام بانک مبدا/مقصد:</span>
                        <span className="text-slate-800 mr-1">{doc.originalEntity?.bankName}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 font-bold">شرح تراکنش و بابت:</span>
                      <p className="text-slate-800 mr-1 inline">{doc.originalEntity?.notes || 'بدون بابت'}</p>
                    </div>
                  </div>

                  <div className="pt-12 text-center text-[10px] text-slate-400 flex justify-between">
                    <div>
                      <p className="font-bold text-slate-700">تحویل‌دهنده سند / پرداخت‌کننده</p>
                      <div className="h-14"></div>
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">مدیر خزانه‌داری و امور مالی</p>
                      <div className="h-14"></div>
                    </div>
                  </div>
                </div>
              ) : doc.id?.startsWith('service-') ? (
                // 5. After-Sales Service Preview
                <div className="space-y-6 text-xs">
                  <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">برگه گزارش خدمات پس از فروش و گارانتی</h2>
                      <p className="text-slate-400 text-[10px]">دپارتمان مهندسی خدمات و پشتیبانی فنی</p>
                    </div>
                    <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                      <div>Service ID: {doc.originalEntity?.id}</div>
                      <div>Start Date: {doc.originalEntity?.startDate}</div>
                      <div>Status: {doc.originalEntity?.status}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100 text-[11px]">
                    <div>
                      <span className="text-slate-400 font-bold">تجهیز ارجاعی:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.itemName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">برند / مدل:</span>
                      <span className="text-slate-800 font-bold mr-1">{doc.originalEntity?.itemBrand || 'مشخص نشده'}</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white p-3 rounded-lg border border-slate-150">
                      <span className="font-bold text-slate-800 block border-b border-slate-100 pb-1.5 mb-1.5">شرح ایراد گزارش شده توسط کارفرما:</span>
                      <p className="text-slate-600 leading-relaxed text-[11px]">{doc.originalEntity?.issueDescription}</p>
                    </div>

                    <div className="bg-white p-3 rounded-lg border border-slate-150">
                      <span className="font-bold text-emerald-800 block border-b border-slate-100 pb-1.5 mb-1.5">اقدامات انجام‌شده توسط دپارتمان فنی:</span>
                      <p className="text-slate-600 leading-relaxed text-[11px]">{doc.originalEntity?.actionsTaken || 'در حال عیب‌یابی کالا'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-8 text-center text-[10px] text-slate-500">
                    <div>
                      <p className="font-bold text-slate-700">تاییدکننده فنی و کارشناس پشتیبانی</p>
                      <div className="h-14"></div>
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">امضای نماینده خریدار (تحویل‌گیرنده)</p>
                      <div className="h-14"></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 space-y-4">
                  <div className="p-4 bg-slate-100 rounded-full text-slate-400 w-16 h-16 flex items-center justify-center mx-auto">
                    <File size={32} />
                  </div>
                  <h4 className="font-bold text-slate-800">{doc.name}</h4>
                  <p className="text-xs text-slate-500">این فایل با موفقیت به صورت دستی بارگذاری شده است.</p>
                  <p className="text-[10px] text-slate-400 font-mono">اندازه: {doc.size} - تاریخ ثبت: {doc.date}</p>
                  {doc.url && doc.url !== '#' && (
                    <div className="pt-4">
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-md shadow-sky-500/10"
                      >
                        دانلود و بازکردن مستقیم فایل
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getStatusColor = (st: Project['status']) => {
    switch (st) {
      case 'جدید': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'در حال مذاکره': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'ارائه پیش‌فاکتور': return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'برنده (موفق)': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'باخته': return 'bg-red-50 text-red-700 border-red-200';
      case 'لغو شده': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'نیمه برنده': return 'bg-purple-50 text-purple-700 border-purple-200';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">پروژه‌ها و مناقصات تجاری</h1>
          <p className="text-slate-500 text-sm mt-1">رهگیری مناقصات، خط لوله فرصت‌های فروش، برآورد ارزش مالی قراردادها و شانس موفقیت آنها</p>
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
            ثبت فرصت پروژه جدید
          </button>
        </div>
      </div>

      {/* Search filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="جستجو در نام پروژه، کد رهگیری، یا نام کارفرما..."
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
            <option value="all">همه مراحل خط فروش</option>
            {(settings.dropdownItems?.projectStatuses || ['جدید', 'در حال مذاکره', 'ارائه پیش‌فاکتور', 'برنده (موفق)', 'نیمه برنده', 'باخته', 'لغو شده']).map((st, idx) => (
              <option key={idx} value={st}>{st}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Custom Fields Filter Panel */}
      {(() => {
        const projectCustomFields = (settings?.customFields || []).filter(f => f.module === 'projects');
        if (projectCustomFields.length === 0) return null;
        return (
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-3 animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Filter size={14} className="text-indigo-500" />
              <span>فیلتر فیلدهای سفارشی پروژه:</span>
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
              {projectCustomFields.map(field => {
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

      {/* Projects Table List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                <th className="p-3 w-28">کد پروژه</th>
                <th className="p-3">نام و مشخصات پروژه</th>
                <th className="p-3">کارفرما / مشتری</th>
                <th className="p-3">ارزش پایپ‌لاین</th>
                <th className="p-3 w-64">تاریخ‌های کلیدی</th>
                <th className="p-3">وضعیت پروژه</th>
                <th className="p-3">فیلدهای سفارشی</th>
                <th className="p-3 text-center w-24">عملیات</th>
              </tr>
              {/* Column Filters Row */}
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر کد..."
                    value={colFilters.code || ''}
                    onChange={(e) => setColFilters({...colFilters, code: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white font-mono"
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
                    placeholder="فیلتر مشتری..."
                    value={colFilters.customerName || ''}
                    onChange={(e) => setColFilters({...colFilters, customerName: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر پایپ‌لاین..."
                    value={colFilters.estimatedValueRIYAL || ''}
                    onChange={(e) => setColFilters({...colFilters, estimatedValueRIYAL: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white text-left font-mono"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    placeholder="فیلتر موعد..."
                    value={colFilters.expectedCloseDate || ''}
                    onChange={(e) => setColFilters({...colFilters, expectedCloseDate: e.target.value})}
                    className="w-full px-2 py-1 text-[11px] font-normal border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white font-mono text-center"
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
              {filteredProjects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition">
                  {/* Code */}
                  <td className="p-3 font-mono font-bold text-slate-500">
                    {p.code}
                  </td>

                  {/* Name */}
                  <td className="p-3 text-slate-900">
                    <div className="font-bold text-sm text-slate-900">{p.name}</div>
                    
                    {/* Compact Meta Row */}
                    {(p.salesExpert || p.customerInquiryNumber || (p.itemsNeeded && p.itemsNeeded.length > 0) || (p.attachments && p.attachments.length > 0)) && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-1.5 text-[10px] text-slate-500 border-t border-slate-100 pt-1.5">
                        {p.salesExpert && (
                          <span>
                            کارشناس: <strong className="text-slate-800">{p.salesExpert}</strong>
                          </span>
                        )}
                        {p.customerInquiryNumber && (
                          <span>
                            {p.salesExpert && ' | '}استعلام: <strong className="text-slate-800 font-mono">{p.customerInquiryNumber}</strong>
                          </span>
                        )}
                        {p.itemsNeeded && p.itemsNeeded.length > 0 && (
                          <span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded text-[9px] font-bold border border-sky-100/80">
                            {p.itemsNeeded.length} قلم کالا
                          </span>
                        )}
                        {p.attachments && p.attachments.length > 0 && (
                          <span className="bg-slate-50 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold border border-slate-150 flex items-center gap-0.5">
                            <Paperclip size={10} /> {p.attachments.length} پیوست
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Customer */}
                  <td className="p-3 font-medium text-slate-700">
                    {p.customerName}
                  </td>

                  {/* Pipeline Value */}
                  <td className="p-3 text-slate-800 text-left">
                    {getPipelineValue(p.id) > 0 ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="font-mono font-bold">{getPipelineValue(p.id).toLocaleString('fa-IR')}</span>
                        <span className="text-[10px] text-slate-500 font-medium">{getPipelineCurrency(p.id)}</span>
                      </div>
                    ) : (
                      <span className="font-mono text-slate-400">-</span>
                    )}
                  </td>

                  {/* Key Dates */}
                  <td className="p-3 text-[11px] text-slate-600 space-y-1">
                    <div className="flex justify-between gap-2 border-b border-dashed border-slate-100 pb-0.5">
                      <span className="text-slate-400">ثبت فرصت:</span>
                      <span className="font-mono">{p.opportunityDate || p.creationDate}</span>
                    </div>
                    {p.winningDate && (
                      <div className="flex justify-between gap-2 text-emerald-600 font-bold border-b border-dashed border-emerald-100 pb-0.5">
                        <span>تاریخ تایید:</span>
                        <span className="font-mono">{p.winningDate}</span>
                      </div>
                    )}
                    {getProjectPrepaymentDate(p.id) && (
                      <div className="flex justify-between gap-2 text-indigo-600 font-bold border-b border-dashed border-indigo-100 pb-0.5">
                        <span>دریافت پیش‌پرداخت:</span>
                        <span className="font-mono">{getProjectPrepaymentDate(p.id)}</span>
                      </div>
                    )}
                    {(() => {
                      const details = getProjectDeliveryDetails(p.id);
                      return (
                        <>
                          {/* Agreed Delivery Date display */}
                          {details.hasMultipleAgreed ? (
                            <div className="border-b border-dashed border-sky-100 pb-1 space-y-0.5 bg-sky-50/20 p-1.5 rounded">
                              <div className="text-sky-600 font-bold text-[9px] mb-0.5">زمان تحویل توافقی اقلام:</div>
                              {details.agreedItems.map((item, i) => (
                                <div key={i} className="flex justify-between gap-1 text-[9px] text-sky-700 bg-sky-50/50 px-1 py-0.5 rounded">
                                  <span className="truncate max-w-[100px] font-medium" title={item.productName}>{item.productName}:</span>
                                  <span className="font-mono font-semibold">{item.calculatedDate}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            (details.singleAgreedDate || p.agreedDeliveryDate) && (
                              <div className="flex justify-between gap-2 text-sky-600 font-bold border-b border-dashed border-sky-100 pb-0.5">
                                <span>توافق‌شده تحویل:</span>
                                <span className="font-mono">{details.singleAgreedDate || p.agreedDeliveryDate}</span>
                              </div>
                            )
                          )}

                          {/* Actual Delivery Date display */}
                          {details.hasMultipleActual ? (
                            <div className="space-y-0.5 bg-amber-50/20 p-1.5 rounded mt-1">
                              <div className="text-amber-600 font-bold text-[9px] mb-0.5">تحویل قطعی اقلام:</div>
                              {details.actualItems.map((item, i) => (
                                <div key={i} className="flex justify-between gap-1 text-[9px] text-amber-700 bg-amber-50/50 px-1 py-0.5 rounded">
                                  <span className="truncate max-w-[100px] font-medium" title={item.productName}>{item.productName}:</span>
                                  <span className="font-mono font-semibold">{item.actualDate}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            (details.singleActualDate || getActualDeliveryDate(p.id)) && (
                              <div className="flex justify-between gap-2 text-amber-600 font-bold">
                                <span>تحویل قطعی:</span>
                                <span className="font-mono">{details.singleActualDate || getActualDeliveryDate(p.id)}</span>
                              </div>
                            )
                          )}
                        </>
                      );
                    })()}
                  </td>

                  {/* Status Badge */}
                  <td className="p-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] border ${getStatusColor(p.status)}`}>
                      {p.status}
                    </span>
                    {p.status === 'باخته' && p.lossReason && (
                      <div className="text-[10px] text-rose-500 font-bold mt-1 max-w-[120px] mx-auto truncate" title={p.lossReason}>
                        علت: {p.lossReason}
                      </div>
                    )}
                  </td>

                  {/* Custom Fields */}
                  <td className="p-3">
                    <CustomFieldsDetailView
                      module="projects"
                      customFields={settings?.customFields || []}
                      customValues={p.customValues}
                    />
                  </td>

                  {/* Actions */}
                  <td className="p-3 text-center">
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <button
                        onClick={() => setSelectedProjectForActivities(p)}
                        className="p-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded transition flex items-center gap-1 text-[10px] font-bold border border-sky-100 shadow-sm"
                        title="جزئیات پروژه"
                      >
                        <Clock size={13} className="text-sky-500" />
                        <span>جزئیات پروژه</span>
                        {(projectCategoryGroups || []).filter(g => g.projectId === p.id && g.status === 'جاری').length > 0 && (
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        )}
                      </button>
                      <button
                        onClick={() => handleOpenEdit(p)}
                        className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-sky-600 rounded transition"
                        title="ویرایش پروژه"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setProjectToDeleteId(p.id);
                          setProjectToDeleteName(p.name);
                          setDeleteConfirmOpen(true);
                        }}
                        className="p-1.5 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded transition"
                        title="حذف پروژه"
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

        {filteredProjects.length === 0 && (
          <div className="text-center bg-white p-12 border-t border-slate-100 w-full">
            <Briefcase className="mx-auto text-slate-300 mb-3" size={48} />
            <p className="text-sm text-slate-500 font-medium">پروژه‌ای با این مشخصات یافت نشد.</p>
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

      {/* Add / Edit Project Modal */}
      {showModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isProjectModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in transition-all duration-300 flex flex-col ${
            isProjectModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full' 
              : 'rounded-2xl w-full max-w-4xl my-8'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">
                {editingProject ? `ویرایش اطلاعات پروژه: ${editingProject.name}` : 'ثبت پروژه صنعتی / فرصت تجاری جدید'}
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsProjectModalFullscreen(!isProjectModalFullscreen)} 
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isProjectModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isProjectModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowModal(false); setEditingProject(null); setIsProjectModalFullscreen(false); }} 
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className={`p-6 space-y-6 overflow-y-auto text-right ${isProjectModalFullscreen ? 'max-h-[calc(100vh-140px)] flex-1' : 'max-h-[80vh]'}`}>
              
              {/* Section 1: General Info */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-sky-500 pr-2">اطلاعات عمومی پروژه</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Project Name */}
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'name', 'عنوان کامل پروژه / نام پروژه')}</label>
                    <input
                      type="text"
                      required={isFieldRequired(settings, 'projects', 'name')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="مثال: نوسازی تجهیزات کنترل نیروگاه ری"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    />
                  </div>

                  {/* Customer select */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'customerId', 'نام مشتری / کارفرما')}</label>
                    <div className="flex gap-1.5 items-center">
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={customerId}
                      onChange={(val) => setCustomerId(val)}
                      required={isFieldRequired(settings, 'projects', 'customerId')}
                      options={[
                        { value: '', label: '-- انتخاب مشتری --' },
                        ...customers.map(c => ({ value: c.id, label: c.companyName }))
                      ]}
                      placeholder="-- انتخاب مشتری --"
                    />
                      {addCustomer && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuickAddCustomerTarget('customerId');
                            setQuickAddType('customer');
                          }}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                    <div className="mt-2">
                      <CustomerAgreementAlert 
                        customer={customers.find(c => c.id === customerId)} 
                        moduleName="projects" 
                      />
                    </div>
                  </div>

                  {/* End User */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'endUser', 'مصرف‌کننده نهایی')}</label>
                    <div className="flex gap-1.5 items-center">
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={endUser}
                      onChange={(val) => setEndUser(val)}
                      required={isFieldRequired(settings, 'projects', 'endUser')}
                      options={[
                        { value: '', label: '-- انتخاب مصرف‌کننده (مشتری) --' },
                        ...customers.map(c => ({ value: c.id, label: c.companyName }))
                      ]}
                      placeholder="-- انتخاب مصرف‌کننده (مشتری) --"
                    />
                      {addCustomer && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuickAddCustomerTarget('endUser');
                            setQuickAddType('customer');
                          }}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sales Expert */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'salesExpert', 'کارشناس فروش')}</label>
                    <select
                      value={salesExpert}
                      required={isFieldRequired(settings, 'projects', 'salesExpert')}
                      onChange={(e) => setSalesExpert(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      <option value="">-- انتخاب کارشناس فروش --</option>
                      {users.map(u => (
                        <option key={u.id} value={u.fullName}>{u.fullName}</option>
                      ))}
                    </select>
                  </div>

                  {/* Customer Inquiry Number */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'customerInquiryNumber', 'شماره استعلام مشتری')}</label>
                    <input
                      type="text"
                      required={isFieldRequired(settings, 'projects', 'customerInquiryNumber')}
                      value={customerInquiryNumber}
                      onChange={(e) => setCustomerInquiryNumber(e.target.value)}
                      placeholder="مثال: ۱۲۴-۹۹-الف"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Marketing & Lead Tracking */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-indigo-500 pr-2">کانال بازاریابی و کیفیت سرنخ (لید)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Marketing Channel */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'marketingChannel', 'کانال بازاریابی')}</label>
                    <select
                      value={marketingChannel}
                      required={isFieldRequired(settings, 'projects', 'marketingChannel')}
                      onChange={(e) => setMarketingChannel(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.marketingChannels || ['تماس مستقیم', 'نمایشگاه تجاری', 'وب‌سایت / آنلاین', 'معرفی', 'مناقصه رسمی', 'سایر']).map((ch, idx) => (
                        <option key={idx} value={ch}>{ch}</option>
                      ))}
                    </select>
                  </div>

                  {/* Lead Quality */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'leadQuality', 'کیفیت لید')}</label>
                    <select
                      value={leadQuality}
                      required={isFieldRequired(settings, 'projects', 'leadQuality')}
                      onChange={(e) => setLeadQuality(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.leadQualities || ['عالی (گرم)', 'متوسط', 'ضعیف (سرد)']).map((q, idx) => (
                        <option key={idx} value={q}>{q}</option>
                      ))}
                    </select>
                  </div>

                  {/* Referrer Name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'referrerName', 'نام معرف (در صورت وجود)')}</label>
                    <input
                      type="text"
                      required={isFieldRequired(settings, 'projects', 'referrerName')}
                      value={referrerName}
                      onChange={(e) => setReferrerName(e.target.value)}
                      placeholder="نام شخص یا سازمان معرفی‌کننده"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                    />
                  </div>

                  {/* Communication Method */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'communicationMethod', 'روش ارتباط اصلی')}</label>
                    <select
                      value={communicationMethod}
                      required={isFieldRequired(settings, 'projects', 'communicationMethod')}
                      onChange={(e) => setCommunicationMethod(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
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
                  {/* Financial Key Person */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">فرد کلیدی مالی</label>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={financialContact}
                        onChange={(e) => setFinancialContact(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب فرد مالی (مشتری) --</option>
                        {(() => {
                          const selectedCustObj = customers.find(c => c.id === customerId);
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
                            setQuickAddCustomerTarget('financialContact');
                            setQuickAddType('customer');
                          }}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Technical Key Person */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">فرد کلیدی فنی</label>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={technicalContact}
                        onChange={(e) => setTechnicalContact(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب فرد فنی (مشتری) --</option>
                        {(() => {
                          const selectedCustObj = customers.find(c => c.id === customerId);
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
                            setQuickAddCustomerTarget('technicalContact');
                            setQuickAddType('customer');
                          }}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={18} />
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
                  {/* Opportunity Creation Date */}
                  <div className="space-y-1.5">
                    <ShamsiDatePicker
                      label={renderFieldLabelWithAsterisk(settings, 'projects', 'opportunityDate', 'تاریخ ایجاد فرصت (ثبت در CRM)') as string}
                      required={isFieldRequired(settings, 'projects', 'opportunityDate')}
                      value={opportunityDate}
                      onChange={(val) => setOpportunityDate(val)}
                    />
                  </div>

                  {/* Target Delivery date */}
                  
                </div>
              </div>

              {/* Section 5: Status & Outcomes */}
              <div className="border-b border-slate-100 pb-4">
                <h4 className="text-xs font-extrabold text-slate-700 mb-3 border-r-4 border-rose-500 pr-2">نتیجه پروژه و وضعیت ابلاغ قرارداد (خودکار / دستی)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Status / Outcome */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'status', 'نتیجه پروژه (مرحله پیشرفت فرصت)')}</label>
                    <select
                      value={status}
                      required={isFieldRequired(settings, 'projects', 'status')}
                      onChange={(e) => handleStatusChange(e.target.value as Project['status'])}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      {(settings.dropdownItems?.projectStatuses || ['جدید', 'در حال مذاکره', 'ارائه پیش‌فاکتور', 'برنده (موفق)', 'نیمه برنده', 'باخته', 'لغو شده']).map((st, idx) => (
                        <option key={idx} value={st}>{st}</option>
                      ))}
                    </select>
                  </div>

                  {/* Loss Reason (Conditional) */}
                  {status === 'باخته' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-rose-500">دلیل باخت پروژه *</label>
                      <select
                        value={lossReason}
                        onChange={(e) => setLossReason(e.target.value)}
                        required
                        className="w-full border border-rose-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب دلیل باخت --</option>
                        {settings.lossReasons?.map((reason, i) => (
                          <option key={i} value={reason}>{reason}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Win Date */}
                  {(status === 'برنده (موفق)' || status === 'نیمه برنده') && (
                    <div className="space-y-1.5">
                      <ShamsiDatePicker
                        label={renderFieldLabelWithAsterisk(settings, 'projects', 'winningDate', 'تاریخ تایید (ابلاغ قرارداد)') as string}
                        required={isFieldRequired(settings, 'projects', 'winningDate')}
                        value={winningDate}
                        onChange={(val) => setWinningDate(val)}
                      />
                    </div>
                  )}

                  {/* Agreed Delivery Date */}
                  {(status === 'برنده (موفق)' || status === 'نیمه برنده') && (
                    <div className="space-y-1.5">
                      <ShamsiDatePicker
                        label={renderFieldLabelWithAsterisk(settings, 'projects', 'agreedDeliveryDate', 'تاریخ توافق‌شده تحویل نهایی') as string}
                        required={isFieldRequired(settings, 'projects', 'agreedDeliveryDate')}
                        value={agreedDeliveryDate}
                        onChange={(val) => setAgreedDeliveryDate(val)}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                {/* Requested Products Multi-Row Block */}
                <div className="md:col-span-2 space-y-3 pt-3 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-700">محصولات یا اقلام درخواستی کارفرما / مشتری</label>
                    <div className="flex gap-2 items-center">
                      {addProduct && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuickAddProductIndex(null);
                            setQuickAddType('product');
                          }}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded text-xs font-bold flex items-center gap-1.5 transition"
                        >
                          <Plus size={12} />
                          تعریف سریع کالا
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddItemLine}
                        className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded text-xs font-bold flex items-center gap-1.5 transition"
                      >
                        <Plus size={12} />
                        افزودن ردیف محصول
                      </button>
                    </div>
                  </div>

                  {itemsNeeded.length > 0 ? (
                    <div className="space-y-3">
                      {itemsNeeded.map((item, index) => {
                        const isGeneric = item.productId === 'generic';
                        return (
                          <div key={index} className="flex flex-col gap-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-200/80 relative">
                            {/* Header Toggle Row */}
                            <div className="flex justify-between items-center pb-2 border-b border-slate-200/50">
                              <span className="text-[10px] font-extrabold text-slate-500">ردیف {index + 1}</span>
                              
                              <div className="flex bg-slate-150 p-0.5 rounded-lg border border-slate-200">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleItemProductChange(index, 'generic');
                                  }}
                                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition ${isGeneric ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                                >
                                  مشخصات کلی (بدون مدل)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const firstProd = products[0];
                                    if (firstProd) {
                                      handleItemProductChange(index, firstProd.id);
                                    }
                                  }}
                                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition ${!isGeneric ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                                >
                                  کالای مشخص انبار
                                </button>
                              </div>
                            </div>

                            {/* Row body */}
                            <div className="grid grid-cols-12 gap-2 items-end">
                              {isGeneric ? (
                                <>
                                  {/* Category selection */}
                                  <div className="col-span-3 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 block">دسته کالا *</label>
                                    <select
                                      value={item.category || 'FLOW'}
                                      onChange={(e) => handleItemCategoryChange(index, e.target.value as any)}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white text-right outline-none focus:ring-1 focus:ring-sky-500 font-bold text-slate-700"
                                    >
                                      <option value="FLOW">فلو (جریان)</option>
                                      <option value="TEMPERATURE">دما</option>
                                      <option value="PRESSURE">فشار</option>
                                      <option value="LEVEL">سطح (لول)</option>
                                    </select>
                                  </div>

                                  {/* Equipment Type select */}
                                  <div className="col-span-3 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 block">نوع تجهیز *</label>
                                    <select
                                      value={item.equipmentType || ''}
                                      onChange={(e) => handleItemEquipmentTypeChange(index, e.target.value)}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white text-right outline-none focus:ring-1 focus:ring-sky-500 font-bold text-slate-700"
                                      required
                                    >
                                      <option value="">-- انتخاب تجهیز --</option>
                                      {(settings?.dropdownItems?.equipmentTypes || [
                                        'فلومتر کوریولیس',
                                        'فلومتر التراسونیک',
                                        'فلومتر الکترومغناطیسی',
                                        'فلومتر توربینی',
                                        'ترانسمیتر فشار',
                                        'ترانسمیتر اختلاف فشار',
                                        'ترانسمیتر دما',
                                        'ترانسمیتر سطح (راداری)',
                                        'ترانسمیتر سطح (التراسونیک)',
                                        'سوئیچ سطح',
                                        'گیج فشار',
                                        'گیج دما',
                                        'شیر کنترل (کنترل ولو)',
                                        'شیر اطمینان (سیفتی ولو)'
                                      ]).map((eq, eqIdx) => (
                                        <option key={eqIdx} value={eq}>{eq}</option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Size input */}
                                  <div className="col-span-2 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 block">سایز</label>
                                    <input
                                      type="text"
                                      value={item.size || ''}
                                      onChange={(e) => handleItemSizeChange(index, e.target.value)}
                                      placeholder="مثال: 2 اینچ"
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-sky-500 font-mono text-slate-700"
                                    />
                                  </div>

                                  {/* Tag Number input */}
                                  <div className="col-span-2 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 block">تگ نامبر</label>
                                    <input
                                      type="text"
                                      value={item.tagNumber || ''}
                                      onChange={(e) => handleItemTagNumberChange(index, e.target.value)}
                                      placeholder="مثال: PIT-101"
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-sky-500 font-mono text-slate-700"
                                    />
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="col-span-7 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 block">انتخاب کالا از انبار *</label>
                                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                                      value={item.productId}
                                      onChange={(val) => handleItemProductChange(index, val)}
                                      options={products.map(p => {
                                        const details = '';
                                        const detailsText = details ? ` (${details})` : '';
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
                                                stockText = ` [موجودی: ${totalStock} ${p.unit || 'عدد'} + تامین سفارشی]`;
                                            } else if (hasInventoryVariant) {
                                                stockText = ` [موجودی: ${totalStock} ${p.unit || 'عدد'}]`;
                                            } else {
                                                stockText = ` [تامین سفارشی]`;
                                            }
                                        } else {
                                            const sLevel = Number(p.stockLevel) || 0;
                                            const effectiveST = sLevel === 0 ? "ORDER" : (p.supplyType || "INVENTORY");
                                            stockText = effectiveST === "INVENTORY" ? ` [موجودی: ${sLevel} ${p.unit || 'عدد'}]` : ' [تامین سفارشی]';
                                        }
                                        return {
                                          value: p.id,
                                          label: `${p.code} - ${p.displayName}${detailsText}${stockText}`
                                        };
                                      })}
                                      placeholder="-- انتخاب کالا --"
                                      className="text-xs"
                                    />
                                  </div>

                                  {/* Tag Number input */}
                                  <div className="col-span-3 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 block">تگ نامبر</label>
                                    <input
                                      type="text"
                                      value={item.tagNumber || ''}
                                      onChange={(e) => handleItemTagNumberChange(index, e.target.value)}
                                      placeholder="مثال: PIT-101"
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-sky-500 font-mono text-slate-700"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Quantity */}
                              <div className="col-span-1 space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 block text-center">تعداد</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={item.quantity}
                                  onChange={(e) => handleItemQuantityChange(index, Number(e.target.value))}
                                  placeholder="تعداد"
                                  className="w-full border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-center font-mono outline-none focus:ring-1 focus:ring-sky-500 text-slate-700"
                                />
                              </div>

                              {/* Delete button */}
                              <div className="col-span-1 flex justify-end pb-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItemLine(index)}
                                  className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition"
                                  title="حذف ردیف"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-[11px] text-center bg-slate-50 py-3 rounded-lg border border-dashed border-slate-200">
                      هیچ ردیف محصولی ثبت نشده است. برای ثبت نیازهای کالا، روی «افزودن ردیف محصول» کلیک کنید.
                    </p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">مشخصات مهندسی مورد نیاز، بازه دما و فشارهای کاربری یا شرح عمومی</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="شرح اهداف کارفرما، نوع متریال درخواستی..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right"
                  />
                </div>


                {/* Attachments */}
                <div className="space-y-1.5 md:col-span-2 pt-3 border-t border-slate-100 mt-2">
                  <label className="text-xs font-semibold text-slate-500">فایل‌های پیوست (نقشه‌ها، استعلام‌ها و ...)</label>
                  <div className="border-2 border-dashed border-slate-200 hover:border-sky-500 rounded-xl p-4 transition text-center cursor-pointer bg-slate-50 relative">
                    <input
                      type="file"
                      multiple
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (files) {
                          setIsUploading(true);
                          try {
                            for (const file of Array.from(files) as File[]) {
                              const url = await uploadFile(file);
                              setAttachments(prev => [...prev, { name: file.name, url, size: file.size }]);
                            }
                          } catch (err: any) {
                            alert(err.message || 'خطا در بارگذاری فایل');
                          } finally {
                            setIsUploading(false);
                          }
                        }
                        if (e.target) e.target.value = '';
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      disabled={isUploading}
                    />
                    <div className="text-slate-500 space-y-1">
                      <div className="text-xs font-bold text-slate-700">
                        {isUploading ? 'در حال بارگذاری...' : 'انتخاب یا رها کردن فایل‌ها'}
                      </div>
                      <div className="text-[10px] text-slate-400">PDF, Excel, Word, Images - ذخیره‌سازی ابری</div>
                    </div>
                  </div>

                  {attachments.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                      {attachments.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                          <div className="flex flex-col overflow-hidden max-w-[85%]">
                            <span className="truncate font-semibold text-slate-700" title={file.name}>{file.name}</span>
                            <span className="text-[10px] text-slate-400">
                              {file.size && !isNaN(Number(file.size)) 
                                ? `${(Number(file.size) / 1024).toFixed(1)} KB` 
                                : 'پیوست'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <a href={file.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-800" title="مشاهده">
                              مشاهده
                            </a>
                            <button
                              type="button"
                              onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 transition"
                              title="حذف فایل"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dynamic Custom Fields Form Section */}
                <div className="col-span-1 md:col-span-2">
                  <CustomFieldsForm
                    module="projects"
                    customFields={settings?.customFields || []}
                    customValues={customValues}
                    onChange={setCustomValues}
                  />
                </div>

              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setIsProjectModalFullscreen(false); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className={`px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center gap-1.5 ${isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>درحال بارگذاری فایل...</span>
                    </>
                  ) : (
                    editingProject ? 'ثبت تغییرات پروژه' : 'ایجاد پروژه'
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Project Activities Drawer/Modal */}
      {selectedProjectForActivities && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center overflow-y-auto ${isActivitiesModalFullscreen ? 'p-0' : 'p-4'}`} dir="rtl">
          <div className={`bg-slate-50 w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-300 ${
            isActivitiesModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-5xl my-8 max-h-[90vh]'
          }`}>
            
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-6 flex justify-between items-center text-right">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-500 rounded-lg text-white flex items-center justify-center shadow-lg shadow-sky-500/20">
                  <Briefcase size={20} />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-mono">پروژه: {selectedProjectForActivities.code}</div>
                  <h2 className="text-lg font-bold">{selectedProjectForActivities.name}</h2>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsActivitiesModalFullscreen(!isActivitiesModalFullscreen)} 
                  className="p-1.5 hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-white flex items-center justify-center"
                  title={isActivitiesModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isActivitiesModalFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setSelectedProjectForActivities(null); setIsActivitiesModalFullscreen(false); }}
                  className="p-1.5 hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-white flex items-center justify-center"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-right">
              
              {/* Project Profile Section (Collapsible) */}
              {(() => {
                const endUserObj = customers.find((c: any) => c.id === selectedProjectForActivities.endUser);
                const endUserName = endUserObj ? endUserObj.companyName : null;

                const financialContactObj = customers.find((c: any) => c.id === selectedProjectForActivities.financialContact);
                const financialContactName = financialContactObj ? `${financialContactObj.firstName || ''} ${financialContactObj.lastName || ''}`.trim() : null;

                const technicalContactObj = customers.find((c: any) => c.id === selectedProjectForActivities.technicalContact);
                const technicalContactName = technicalContactObj ? `${technicalContactObj.firstName || ''} ${technicalContactObj.lastName || ''}`.trim() : null;

                return (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden text-right">
                    <button
                      type="button"
                      onClick={() => setIsProjectDetailsExpanded(!isProjectDetailsExpanded)}
                      className="w-full bg-slate-50 hover:bg-slate-100 p-4 flex justify-between items-center transition font-bold text-slate-800 text-xs border-b border-slate-200"
                    >
                      <div className="flex items-center gap-2">
                        <Briefcase size={16} className="text-sky-500" />
                        <span>📋 شناسنامه و مشخصات کامل پروژه ({selectedProjectForActivities.name})</span>
                        <span className="text-[10px] text-slate-400 font-normal mr-2">
                          ({isProjectDetailsExpanded ? 'کلیک برای جمع کردن' : 'کلیک برای مشاهده جزئیات ثبتی'})
                        </span>
                      </div>
                      {isProjectDetailsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {isProjectDetailsExpanded && (
                      <div className="p-4 space-y-4 text-xs">
                        
                        {/* Grid of details */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          {/* Column 1: General Info */}
                          <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100 space-y-2">
                            <h4 className="font-bold text-sky-800 border-b border-sky-100 pb-1 flex items-center gap-1.5">
                              <span className="w-1.5 h-3 bg-sky-500 rounded-sm"></span>
                              <span>مشخصات عمومی</span>
                            </h4>
                            <div className="space-y-1.5">
                              <div>
                                <span className="text-slate-400 font-semibold">مشتری/کارفرما:</span>
                                <strong className="text-slate-700 block mt-0.5">{selectedProjectForActivities.customerName}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">مصرف‌کننده نهایی:</span>
                                <strong className="text-slate-700 block mt-0.5">{endUserName || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">کارشناس فروش مسئول:</span>
                                <strong className="text-slate-700 block mt-0.5">{selectedProjectForActivities.salesExpert || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">شماره استعلام مشتری:</span>
                                <strong className="text-slate-700 block mt-0.5 font-mono">{selectedProjectForActivities.customerInquiryNumber || 'مشخص نشده'}</strong>
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Lead Tracking */}
                          <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100 space-y-2">
                            <h4 className="font-bold text-indigo-800 border-b border-indigo-100 pb-1 flex items-center gap-1.5">
                              <span className="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
                              <span>بازاریابی و لید</span>
                            </h4>
                            <div className="space-y-1.5">
                              <div>
                                <span className="text-slate-400 font-semibold">کانال بازاریابی:</span>
                                <strong className="text-slate-700 block mt-0.5">{selectedProjectForActivities.marketingChannel || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">کیفیت لید (سرنخ):</span>
                                <strong className="text-slate-700 block mt-0.5">{selectedProjectForActivities.leadQuality || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">روش ارتباط اصلی:</span>
                                <strong className="text-slate-700 block mt-0.5">{selectedProjectForActivities.communicationMethod || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">نام معرف:</span>
                                <strong className="text-slate-700 block mt-0.5">{selectedProjectForActivities.referrerName || 'مشخص نشده'}</strong>
                              </div>
                            </div>
                          </div>

                          {/* Column 3: Key People */}
                          <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100 space-y-2">
                            <h4 className="font-bold text-amber-800 border-b border-amber-100 pb-1 flex items-center gap-1.5">
                              <span className="w-1.5 h-3 bg-amber-500 rounded-sm"></span>
                              <span>افراد کلیدی کارفرما</span>
                            </h4>
                            <div className="space-y-1.5">
                              <div>
                                <span className="text-slate-400 font-semibold">فرد کلیدی مالی:</span>
                                <strong className="text-slate-700 block mt-0.5">{financialContactName || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">فرد کلیدی فنی:</span>
                                <strong className="text-slate-700 block mt-0.5">{technicalContactName || 'مشخص نشده'}</strong>
                              </div>
                            </div>
                          </div>

                          {/* Column 4: Timeline & Outcomes */}
                          <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100 space-y-2">
                            <h4 className="font-bold text-teal-800 border-b border-teal-100 pb-1 flex items-center gap-1.5">
                              <span className="w-1.5 h-3 bg-teal-500 rounded-sm"></span>
                              <span>زمان‌بندی و دستاورد</span>
                            </h4>
                            <div className="space-y-1.5">
                              <div>
                                <span className="text-slate-400 font-semibold">تاریخ ایجاد فرصت:</span>
                                <strong className="text-slate-700 block mt-0.5 font-mono">{selectedProjectForActivities.opportunityDate || selectedProjectForActivities.creationDate || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">وضعیت فرصت:</span>
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border mt-1 ${getStatusColor(selectedProjectForActivities.status)}`}>
                                  {selectedProjectForActivities.status}
                                </span>
                              </div>
                              {selectedProjectForActivities.status === 'باخته' && selectedProjectForActivities.lossReason && (
                                <div>
                                  <span className="text-rose-400 font-semibold">دلیل باخت پروژه:</span>
                                  <strong className="text-rose-700 block mt-0.5">{selectedProjectForActivities.lossReason}</strong>
                                </div>
                              )}
                              {(selectedProjectForActivities.status === 'برنده (موفق)' || selectedProjectForActivities.status === 'نیمه برنده') && (
                                <>
                                  {selectedProjectForActivities.winningDate && (
                                    <div>
                                      <span className="text-emerald-500 font-semibold">تاریخ تایید (ابلاغ):</span>
                                      <strong className="text-emerald-700 block mt-0.5 font-mono">{selectedProjectForActivities.winningDate}</strong>
                                    </div>
                                  )}
                                  {selectedProjectForActivities.agreedDeliveryDate && (
                                    <div>
                                      <span className="text-sky-500 font-semibold">تاریخ توافقی تحویل:</span>
                                      <strong className="text-sky-700 block mt-0.5 font-mono">{selectedProjectForActivities.agreedDeliveryDate}</strong>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Engineering Description Row */}
                        {selectedProjectForActivities.description && (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/60">
                            <span className="text-slate-500 font-bold block mb-1">📋 مشخصات مهندسی مورد نیاز، بازه دما و فشار یا شرح عمومی پروژه:</span>
                            <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{selectedProjectForActivities.description}</p>
                          </div>
                        )}

                        {/* Custom Fields Block */}
                        {(() => {
                          const projectCustomFields = (settings?.customFields || []).filter((f: any) => f.module === 'projects');
                          const activeCustomFields = projectCustomFields.filter((f: any) => selectedProjectForActivities.customValues?.[f.id] !== undefined && selectedProjectForActivities.customValues?.[f.id] !== '');
                          if (activeCustomFields.length === 0) return null;
                          return (
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/60 space-y-1.5">
                              <span className="text-slate-500 font-bold block">فیلدهای سفارشی پروژه:</span>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 bg-white p-2.5 rounded-lg border border-slate-150">
                                {activeCustomFields.map((field: any) => (
                                  <div key={field.id} className="text-[11px]">
                                    <span className="text-slate-400 font-semibold">{field.name}: </span>
                                    <strong className="text-slate-700">{selectedProjectForActivities.customValues?.[field.id]}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Items Needed Row */}
                        {selectedProjectForActivities.itemsNeeded && selectedProjectForActivities.itemsNeeded.length > 0 && (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/60 space-y-2">
                            <span className="text-slate-500 font-bold block">🛍️ لیست اقلام و محصولات درخواستی پروژه:</span>
                            <div className="overflow-x-auto">
                              <table className="w-full text-right border-collapse text-[11px] bg-white rounded-lg overflow-hidden border border-slate-150">
                                <thead>
                                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                                    <th className="p-2 w-12 text-center">ردیف</th>
                                    <th className="p-2">نام کالا / گروه کالا</th>
                                    <th className="p-2 text-center w-20">تعداد</th>
                                    <th className="p-2 text-center w-28">روش تامین</th>
                                    <th className="p-2 text-center w-40">مشخصات فنی</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                  {selectedProjectForActivities.itemsNeeded.map((item: any, idx: number) => {
                                    const supplyMethodText = item.supplyMethod === 'INVENTORY' ? 'برداشت از موجودی' : item.supplyMethod === 'ORDER' ? 'تامین سفارشی' : 'بدون نیاز به تامین';
                                    const supplyColor = item.supplyMethod === 'INVENTORY' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : item.supplyMethod === 'ORDER' ? 'text-sky-700 bg-sky-50 border-sky-100' : 'text-slate-500 bg-slate-50 border-slate-100';
                                    
                                    return (
                                      <tr key={idx} className="hover:bg-slate-50/50">
                                        <td className="p-2 text-center font-mono font-bold text-slate-400">{idx + 1}</td>
                                        <td className="p-2 font-semibold text-slate-800">{item.name}</td>
                                        <td className="p-2 text-center font-mono font-bold">{item.quantity}</td>
                                        <td className="p-2 text-center">
                                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${supplyColor}`}>
                                            {supplyMethodText}
                                          </span>
                                        </td>
                                        <td className="p-2 text-center space-y-1">
                                          {item.category && (
                                            <span className="inline-block px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[9px] ml-1 font-semibold">
                                              دسته: {item.category}
                                            </span>
                                          )}
                                          {item.equipmentType && (
                                            <span className="inline-block px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 text-[9px] ml-1 font-semibold">
                                              {item.equipmentType}
                                            </span>
                                          )}
                                          {item.size && (
                                            <span className="inline-block px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 text-[9px] font-mono ml-1">
                                              سایز: {item.size}
                                            </span>
                                          )}
                                          {item.tagNumber && (
                                            <span className="inline-block px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 text-[9px] font-mono font-bold">
                                              تگ: {item.tagNumber}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Delivery commitments */}
                        {(() => {
                          const details = getProjectDeliveryDetails(selectedProjectForActivities.id);
                          const hasAgreed = details.agreedItems.length > 0;
                          const hasActual = details.actualItems.length > 0 || getActualDeliveryDate(selectedProjectForActivities.id);
                          if (!hasAgreed && !hasActual) return null;
                          return (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50 p-3 rounded-lg border border-slate-150">
                              {/* Agreed */}
                              <div className="space-y-2">
                                <span className="text-sky-800 font-bold block border-b border-sky-100 pb-1 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                  تعهدات زمان تحویل توافقی
                                </span>
                                {details.agreedItems.length > 0 ? (
                                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                                    {details.agreedItems.map((item: any, i: number) => (
                                      <div key={i} className="flex justify-between items-center gap-2 bg-white p-1.5 rounded border border-slate-100 shadow-sm text-[11px]">
                                        <span className="text-slate-600 font-medium truncate max-w-[200px]" title={item.productName}>{item.productName}</span>
                                        <div className="flex items-center gap-2 font-mono">
                                          <span className="text-[10px] text-slate-400">({item.deliveryText})</span>
                                          <span className="text-sky-600 font-bold">{item.calculatedDate}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-slate-400 italic text-[10px] pr-2">تاریخ توافق‌شده ثبت نشده است.</div>
                                )}
                              </div>

                              {/* Actual */}
                              <div className="space-y-2">
                                <span className="text-amber-800 font-bold block border-b border-amber-100 pb-1 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                  تاریخ تحویل قطعی (لجستیک)
                                </span>
                                {details.actualItems.length > 0 ? (
                                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                                    {details.actualItems.map((item: any, i: number) => (
                                      <div key={i} className="flex justify-between items-center gap-2 bg-white p-1.5 rounded border border-slate-100 shadow-sm text-[11px]">
                                        <span className="text-slate-600 font-medium truncate max-w-[200px]" title={item.productName}>{item.productName}</span>
                                        <div className="flex items-center gap-2 font-mono">
                                          {item.boxNumber && <span className="text-[10px] text-slate-400 bg-slate-100 px-1 rounded">{item.boxNumber}</span>}
                                          <span className="text-amber-600 font-bold">{item.actualDate}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : getActualDeliveryDate(selectedProjectForActivities.id) ? (
                                  <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm font-mono text-amber-600 font-bold text-[11px]">
                                    <span>تحویل کلی پروژه:</span>
                                    <span>{getActualDeliveryDate(selectedProjectForActivities.id)}</span>
                                  </div>
                                ) : (
                                  <div className="text-slate-400 italic text-[10px] pr-2">تحویل کالاها هنوز نهایی یا ثبت نشده است.</div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Attachments Row */}
                        {selectedProjectForActivities.attachments && selectedProjectForActivities.attachments.length > 0 && (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/60 space-y-2">
                            <span className="text-slate-500 font-bold block flex items-center gap-1"><Paperclip size={14} /> فایل‌های پیوست پروژه:</span>
                            <div className="flex flex-wrap gap-2">
                              {selectedProjectForActivities.attachments.map((file: any, idx: number) => (
                                <a
                                  key={idx}
                                  href={file.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-3 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-semibold text-sky-600 transition"
                                >
                                  <span>{file.name}</span>
                                  <span className="text-[9px] text-slate-400 font-mono">
                                    ({file.size && !isNaN(Number(file.size)) ? `${(Number(file.size) / 1024).toFixed(1)} KB` : 'پیوست'})
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Tab Selector */}
              <div className="flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalTab('activities')}
                  className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                    modalTab === 'activities'
                      ? 'border-sky-500 text-sky-600 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <History size={15} />
                  <span>فعالیت‌ها و شرح اقدامات</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('documents')}
                  className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                    modalTab === 'documents'
                      ? 'border-sky-500 text-sky-600 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FolderOpen size={15} />
                  <span>پوشه‌بندی و مدیریت مدارک</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('supply')}
                  className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                    modalTab === 'supply'
                      ? 'border-sky-500 text-sky-600 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Briefcase size={15} />
                  <span>وضعیت تامین کالاها (انبار / سفارش)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('milestones')}
                  className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                    modalTab === 'milestones'
                      ? 'border-sky-500 text-sky-600 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Flag size={15} />
                  <span>نقاط حیاتی و اتوماسیون (Milestones)</span>
                </button>
              </div>

              {modalTab === 'activities' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Right Side: Activate/Open Category Group form */}
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 pb-3 border-b border-slate-100 text-slate-800">
                      <Sliders size={16} className="text-sky-500" />
                      <h3 className="font-bold text-xs">فعال‌سازی دسته‌بندی فعالیت جدید</h3>
                    </div>
                    
                    <p className="text-slate-400 text-[10px] leading-relaxed">
                      برای ثبت فعالیت، ابتدا باید یکی از دسته‌بندی‌های مشخص‌شده در تنظیمات را برای این پروژه فعال کنید. طبق تعهد، تکرار دسته‌بندی مجاز نیست.
                    </p>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-slate-500 block">انتخاب دسته‌بندی فعالیت *</label>
                        <select
                          value={selectedCategoryToCreate}
                          onChange={(e) => setSelectedCategoryToCreate(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg py-2 px-3 text-xs outline-none bg-white focus:ring-2 focus:ring-sky-500/20 text-right"
                        >
                          <option value="">-- انتخاب دسته‌بندی --</option>
                          {(settings.activityCategories || []).map(cat => {
                            const alreadyExists = (projectCategoryGroups || []).some(
                              g => g.projectId === selectedProjectForActivities.id && g.categoryId === cat.id
                            );
                            return (
                              <option 
                                key={cat.id} 
                                value={cat.id}
                                disabled={alreadyExists}
                              >
                                {cat.name} {alreadyExists ? '(قبلاً ایجاد شده)' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-slate-500 block">تاریخ شروع فعالیت *</label>
                        <ShamsiDatePicker
                          value={categoryStartDate}
                          onChange={(val) => setCategoryStartDate(val)}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedCategoryToCreate) {
                            alert('لطفاً ابتدا یک دسته‌بندی انتخاب کنید.');
                            return;
                          }
                          const cat = (settings.activityCategories || []).find(c => c.id === selectedCategoryToCreate);
                          if (!cat) return;
                          
                          if (addProjectCategoryGroup) {
                            const res = addProjectCategoryGroup(selectedProjectForActivities.id, cat.id, cat.name, categoryStartDate);
                            if (!res.success) {
                              alert(res.error);
                            } else {
                              alert(`دسته‌بندی «${cat.name}» با موفقیت برای این پروژه فعال شد.`);
                              setSelectedCategoryToCreate('');
                              setCategoryStartDate(getTodayShamsi());
                            }
                          }
                        }}
                        className="w-full py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-sky-500/10"
                      >
                        <Plus size={14} />
                        راه‌اندازی دسته‌بندی در پروژه
                      </button>
                    </div>
                  </div>

                  {/* Quick Info Box */}
                  <div className="bg-sky-50 border border-sky-100 p-4 rounded-xl text-[10px] text-sky-800 leading-relaxed space-y-1 text-right">
                    <div className="font-bold flex items-center gap-1">
                      <AlertCircle size={13} />
                      <span>قوانین ثبت فعالیت‌ها:</span>
                    </div>
                    <div>• ثبت فعالیت حتماً باید ذیل یک دسته‌بندی مشخص باشد.</div>
                    <div>• در صورت اتمام کار در یک دسته‌بندی، دکمه اتمام کار را بزنید.</div>
                    <div>• پس از بسته‌شدن دسته‌بندی، در صورت لزوم می‌توانید مجدداً آن را به جریان بیندازید.</div>
                    <div>• هر فعالیت می‌تواند به عنوان ارجاع کار برای یکی از همکاران صادر شود.</div>
                  </div>
                </div>

                {/* Left Side: Category Groups List & Inside Activities */}
                <div className="lg:col-span-2 space-y-6">
                  
                  {/* Filter and Category Groups Block */}
                  {(!projectCategoryGroups || projectCategoryGroups.filter(g => g.projectId === selectedProjectForActivities.id).length === 0) ? (
                    <div className="bg-white p-12 text-center rounded-xl border border-slate-100 shadow-sm space-y-3">
                      <History className="mx-auto text-slate-300" size={36} />
                      <p className="text-slate-500 text-xs font-semibold">هیچ دسته‌بندی فعالیتی هنوز برای این پروژه راه‌اندازی نشده است.</p>
                      <p className="text-[10px] text-slate-400">لطفاً از پنل سمت راست، اولین دسته‌بندی فعالیت را فعال کنید.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Collapsible Utility Controls */}
                      <div className="flex justify-between items-center bg-slate-50/50 p-2.5 rounded-lg border border-slate-150">
                        <span className="text-[11px] font-bold text-slate-500">مدیریت نمایش دسته‌بندی‌ها:</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const projectGroups = projectCategoryGroups.filter(g => g.projectId === selectedProjectForActivities.id);
                              const newExpanded: Record<string, boolean> = {};
                              projectGroups.forEach(g => {
                                newExpanded[g.id] = true;
                              });
                              setExpandedGroups(newExpanded);
                            }}
                            className="px-2.5 py-1 text-[10px] bg-white border border-slate-200 hover:bg-slate-50 text-sky-600 rounded font-bold transition shadow-sm"
                          >
                            باز کردن همه
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedGroups({})}
                            className="px-2.5 py-1 text-[10px] bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded font-bold transition shadow-sm"
                          >
                            جمع کردن همه
                          </button>
                        </div>
                      </div>

                      {(projectCategoryGroups || [])
                        .filter(g => g.projectId === selectedProjectForActivities.id)
                        .map((group) => {
                          const isGroupClosed = group.status === 'اتمام کار';
                          const isExpanded = !!expandedGroups[group.id];
                          const cat = settings.activityCategories?.find(c => c.id === group.categoryId);
                          const canManageCompletion = !cat?.responsibleUserId || cat.responsibleUserId === currentUser?.fullName || currentUser?.role === 'admin' || currentUser?.isSystemAdmin;
                          
                          return (
                            <div 
                              key={group.id} 
                              className={`bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-300 ${
                                isGroupClosed ? 'opacity-85 border-slate-200 bg-slate-50/20' : 'ring-2 ring-sky-500/10'
                              }`}
                            >
                              {/* Group Header */}
                              <div 
                                onClick={() => {
                                  setExpandedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }));
                                }}
                                className="bg-slate-50/80 px-4 py-3 border-b border-slate-100 flex justify-between items-center gap-2 flex-wrap cursor-pointer hover:bg-slate-100/70 transition"
                              >
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronUp size={16} className="text-slate-500 transition-transform duration-200" />
                                  ) : (
                                    <ChevronDown size={16} className="text-slate-500 transition-transform duration-200" />
                                  )}
                                  <span className="bg-sky-100 text-sky-950 text-xs font-bold px-2.5 py-1 rounded-md border border-sky-200">
                                    {group.categoryName}
                                  </span>
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                    isGroupClosed ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-800 animate-pulse'
                                  }`}>
                                    {group.status}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    ({(group.activities || []).length} فعالیت)
                                  </span>
                                </div>

                                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="text-[10px] text-slate-500 font-mono flex flex-col text-left">
                                    {editingGroupIdForStartDate === group.id ? (
                                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded p-1" onClick={(e) => e.stopPropagation()}>
                                        <span className="text-[9px] font-bold text-slate-500">شروع:</span>
                                        <ShamsiDatePicker
                                          value={group.startDate || getTodayShamsi()}
                                          onChange={(val) => {
                                            if (updateProjectCategoryGroup) {
                                              updateProjectCategoryGroup({ ...group, startDate: val });
                                            }
                                            setEditingGroupIdForStartDate(null);
                                          }}
                                        />
                                      </div>
                                    ) : (
                                      <div 
                                        className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 p-1 rounded transition text-slate-600 font-semibold"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingGroupIdForStartDate(group.id);
                                        }}
                                        title="کلیک برای ویرایش تاریخ شروع"
                                      >
                                        <span>شروع: {group.startDate || 'ثبت نشده'}</span>
                                        <span className="text-[9px] text-sky-600 font-normal hover:underline opacity-80">(ویرایش)</span>
                                      </div>
                                    )}
                                    
                                    {group.endDate && (
                                      editingGroupIdForEndDate === group.id ? (
                                        <div className="flex items-center gap-1 mt-1 bg-slate-50 border border-slate-200 rounded p-1" onClick={(e) => e.stopPropagation()}>
                                          <span className="text-[9px] font-bold text-slate-500">پایان:</span>
                                          <ShamsiDatePicker
                                            value={group.endDate}
                                            onChange={(val) => {
                                              if (updateProjectCategoryGroup) {
                                                updateProjectCategoryGroup({ ...group, endDate: val });
                                              }
                                              setEditingGroupIdForEndDate(null);
                                            }}
                                          />
                                        </div>
                                      ) : (
                                        <div 
                                          className="flex items-center gap-1 mt-0.5 cursor-pointer hover:bg-slate-100 p-1 rounded transition text-rose-600 font-bold"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingGroupIdForEndDate(group.id);
                                          }}
                                          title="کلیک برای ویرایش تاریخ پایان"
                                        >
                                          <span>پایان: {group.endDate}</span>
                                          <span className="text-[9px] text-rose-500 font-normal hover:underline opacity-80">(ویرایش)</span>
                                        </div>
                                      )
                                    )}
                                  </div>
                                  
                                  {/* Delete Category Group Button (only for non-system) */}
                                  {!group.categoryId.startsWith('cat-fact-') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setGroupToDelete(group.id);
                                      }}
                                      className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded transition border border-rose-100 flex items-center gap-1 shadow-sm ml-1"
                                      title="حذف دسته"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                  
                                  {/* Toggle Button */}
                                  {canManageCompletion && (isGroupClosed ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (resumeProjectCategoryGroup) resumeProjectCategoryGroup(group.id, currentUser?.fullName || 'کاربر سیستم');
                                      }}
                                      className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-[10px] font-bold transition border border-sky-150 flex items-center gap-1"
                                    >
                                      <History size={11} />
                                      به جریان انداختن مجدد
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setGroupToCompleteId(group.id);
                                        setGroupToCompleteName(group.categoryName);
                                        setCompleteGroupConfirmOpen(true);
                                      }}
                                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-bold transition shadow-sm flex items-center gap-1"
                                    >
                                      <Check size={11} />
                                      اتمام کار این دسته
                                    </button>
                                  ))}
                                </div>
                              </div>

                            {/* Group Activities List & Form */}
                            {isExpanded && (
                              <div className="p-4 space-y-4 bg-white border-t border-slate-100 animate-fade-in">
                                <div className="space-y-3">
                                  {(!group.activities || group.activities.length === 0) ? (
                                    <p className="text-slate-400 text-[10px] text-center py-4 bg-slate-50 rounded-lg border border-dashed border-slate-100">
                                      هنوز هیچ فعالیتی در این دسته ثبت نشده است.
                                    </p>
                                  ) : (
                                    (group.activities || []).map((act) => (
                                      <div key={act.id} className="bg-slate-50/50 p-3.5 rounded-lg border border-slate-100 space-y-2.5 text-xs text-right">
                                        <div className="flex justify-between items-center text-[10px] text-slate-400">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono">{formatDateTimeToShamsi(act.createdAt)}</span>
                                            {act.createdBy && (
                                              <span className="text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                                                <User size={10} />
                                                {act.createdBy}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {act.attachment && (
                                              act.attachment.content ? (
                                                <a
                                                  href={act.attachment.content}
                                                  download={act.attachment.name}
                                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 hover:bg-sky-200 border border-sky-200 text-sky-800 text-[9px] font-bold transition mr-1"
                                                  title="دانلود فایل پیوست"
                                                >
                                                  <Paperclip size={10} />
                                                  {act.attachment.name} ({act.attachment.size})
                                                </a>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-100 text-sky-700 text-[9px] font-bold mr-1">
                                                  <Paperclip size={10} />
                                                  {act.attachment.name} ({act.attachment.size})
                                                </span>
                                              )
                                            )}

                                            {/* Edit & Delete Action Buttons */}
                                            <div className="flex items-center gap-1 bg-slate-100/60 p-0.5 rounded border border-slate-200/40">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingActivityId(act.id);
                                                  setEditingActivityText(act.text);
                                                }}
                                                className="text-slate-400 hover:text-sky-600 transition p-1 hover:bg-white rounded"
                                                title="ویرایش"
                                              >
                                                <Edit size={10} />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setActivityToDeleteGroupId(group.id);
                                                  setActivityToDeleteId(act.id);
                                                  setActivityDeleteConfirmOpen(true);
                                                }}
                                                className="text-slate-400 hover:text-rose-600 transition p-1 hover:bg-white rounded"
                                                title="حذف"
                                              >
                                                <Trash2 size={10} />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                        {editingActivityId === act.id ? (
                                          <div className="space-y-2 mt-1">
                                            <textarea
                                              value={editingActivityText}
                                              onChange={(e) => setEditingActivityText(e.target.value)}
                                              className="w-full text-xs p-2 border border-sky-300 rounded focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white font-semibold text-slate-800 text-right"
                                              rows={2}
                                              dir="rtl"
                                            />
                                            <div className="flex gap-2 justify-end">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  if (editingActivityText.trim() && selectedProjectForActivities) {
                                                    updateProjectActivity?.(selectedProjectForActivities.id, group.id, act.id, editingActivityText.trim());
                                                    setEditingActivityId(null);
                                                    setEditingActivityText('');
                                                  }
                                                }}
                                                className="px-2 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold text-[10px] flex items-center gap-1 transition"
                                              >
                                                <Check size={10} />
                                                ذخیره
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingActivityId(null);
                                                  setEditingActivityText('');
                                                }}
                                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold text-[10px] flex items-center gap-1 transition"
                                              >
                                                <X size={10} />
                                                انصراف
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <p className="text-slate-700 leading-relaxed font-semibold">{act.text}</p>
                                        )}
                                        
                                        {/* Referral details inside activity card */}
                                        {act.referral && (
                                          <div className="mt-2 bg-white rounded-lg p-3 border border-slate-150 space-y-2 text-right">
                                            <div className="flex justify-between items-center text-[9px] border-b border-slate-100 pb-1.5">
                                              <span className="text-sky-700 font-bold">ارجاع کار برای اقدام:</span>
                                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                                (act.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام' ? 'bg-sky-50 text-sky-700 border border-sky-100 animate-pulse' : 'bg-emerald-50 text-emerald-800'
                                              }`}>
                                                {act.referral.status || 'در انتظار اقدام'}
                                              </span>
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                              ارجاع‌دهنده: <strong className="text-slate-700">{act.referral.assignedBy}</strong>
                                              {' '} | ارجاع‌شونده: <strong className="text-slate-700">{act.referral.assignedTo}</strong>
                                            </div>
                                            <div className="bg-sky-50/40 p-2.5 rounded text-[11px] text-slate-600 font-extrabold border-r-2 border-sky-500 leading-relaxed">
                                              {act.referral.actionRequired}
                                            </div>

                                            {/* Messages visually nested under referral */}
                                            {(act.referral.messages?.length ? act.referral.messages : (act.referral.response ? [act.referral.response] : [])).map((msg, msgIdx) => (
                                              <div key={msgIdx} className="mt-2 pt-2 border-t border-slate-100 bg-emerald-50/20 p-2 rounded-md border border-emerald-100 space-y-1 text-right">
                                                <div className="flex justify-between items-center text-[8px] text-emerald-800 font-bold">
                                                  <span>پاسخ اقدام:</span>
                                                  <span className="font-mono">{formatDateTimeToShamsi(msg.createdAt)}</span>
                                                </div>
                                                <p className="text-[11px] text-slate-800 font-semibold leading-relaxed bg-white/70 p-2 rounded border border-emerald-100">
                                                  {msg.text}
                                                </p>

                                                {/* Response attachment if any */}
                                                {msg.attachment && (
                                                  <div className="pt-1">
                                                    {msg.attachment.content ? (
                                                      <a
                                                        href={msg.attachment.content}
                                                        download={msg.attachment.name}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100/60 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 hover:text-emerald-900 text-[10px] font-bold mt-1 transition"
                                                        title="دانلود فایل پیوست اقدام"
                                                      >
                                                        <Paperclip size={11} className="text-emerald-600" />
                                                        <span>فایل پیوست پاسخ: {msg.attachment.name}</span>
                                                        <span className="text-emerald-500">({msg.attachment.size})</span>
                                                      </a>
                                                    ) : (
                                                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold mt-1">
                                                        <Paperclip size={11} />
                                                        <span>فایل پیوست پاسخ: {msg.attachment.name}</span>
                                                        <span className="text-emerald-500">({msg.attachment.size})</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                )}

                                                <div className="text-[8px] text-slate-400">
                                                  ارسال‌کننده: {msg.responder}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>

                                {/* Form to Add Activity to this group (only if group is Active) */}
                                {!isGroupClosed && (
                                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                    <span className="text-[11px] font-bold text-slate-600 block">ثبت فعالیت جدید در این دسته‌بندی:</span>
                                    
                                    <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                      <textarea
                                        rows={2}
                                        value={newActivityText[group.id] || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setNewActivityText(prev => ({ ...prev, [group.id]: val }));
                                        }}
                                        placeholder="شرح جزئیات فعالیت انجام شده، مکالمات فنی یا مذاکرات با مشتری..."
                                        className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-sky-500/20 outline-none text-right placeholder-slate-400 bg-white"
                                      />

                                      {/* Attachment simulator */}
                                      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between text-[11px]">
                                        <div className="flex items-center gap-2">
                                          <label className="cursor-pointer bg-white border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 transition font-bold text-slate-600 flex items-center gap-1">
                                            <Paperclip size={12} className="text-slate-400" />
                                            <span>پیوست فایل (تصویر یا سند)</span>
                                            <input
                                              type="file"
                                              className="hidden"
                                              onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                  if (file.size > 2 * 1024 * 1024 && !file.type.startsWith('image/')) {
                                                    alert('حداکثر حجم مجاز برای فایل‌های غیرتصویری ۲ مگابایت می‌باشد.');
                                                    if (e.target) e.target.value = '';
                                                    return;
                                                  }
                                                  
                                                  compressImage(file, (dataUrl, sizeStr) => {
                                                    setNewActivityAttachment(prev => ({
                                                      ...prev,
                                                      [group.id]: {
                                                        name: file.name,
                                                        size: sizeStr,
                                                        content: dataUrl
                                                      }
                                                    }));
                                                  });
                                                }
                                                if (e.target) e.target.value = '';
                                              }}
                                            />
                                          </label>
                                          {newActivityAttachment[group.id] && (
                                            <span className="text-sky-700 font-bold bg-sky-50 px-2 py-1 rounded flex items-center gap-1 border border-sky-100">
                                              {newActivityAttachment[group.id]?.name}
                                              <button 
                                                type="button" 
                                                onClick={() => setNewActivityAttachment(prev => ({ ...prev, [group.id]: null }))}
                                                className="text-rose-500 hover:text-rose-700 font-bold text-xs"
                                              >
                                                ×
                                              </button>
                                            </span>
                                          )}
                                        </div>

                                        {/* Referral toggle */}
                                        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-600">
                                          <input
                                            type="checkbox"
                                            checked={referralEnabled[group.id] || false}
                                            onChange={(e) => {
                                              const checked = e.target.checked;
                                              setReferralEnabled(prev => ({ ...prev, [group.id]: checked }));
                                            }}
                                            className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                                          />
                                          <span>نیاز به اقدام و ارجاع به همکار؟</span>
                                        </label>
                                      </div>

                                      {/* Referral Sub-form */}
                                      {referralEnabled[group.id] && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-3 text-xs animate-fade-in text-right">
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                              <label className="text-[10px] font-bold text-slate-500 block">ارجاع به همکار *</label>
                                              <select
                                                value={referralAssignedTo[group.id] || ''}
                                                onChange={(e) => {
                                                  const val = e.target.value;
                                                  setReferralAssignedTo(prev => ({ ...prev, [group.id]: val }));
                                                }}
                                                className="w-full border border-slate-200 rounded p-1.5 text-xs bg-white text-right"
                                              >
                                                <option value="">-- انتخاب همکار --</option>
                                                {(users || []).map((u) => (
                                                  <option key={u.id} value={u.fullName}>
                                                    {u.fullName}
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-slate-500 block">اقدام خواسته‌شده مشخص *</label>
                                            <textarea
                                              rows={2}
                                              value={referralAction[group.id] || ''}
                                              onChange={(e) => {
                                                const val = e.target.value;
                                                setReferralAction(prev => ({ ...prev, [group.id]: val }));
                                              }}
                                              placeholder="مثلاً: بررسی کاتالوگ ابعادی رنج کالا و تایید نهایی به تدارکات"
                                              className="w-full border border-slate-200 rounded p-2 text-xs focus:ring-1 focus:ring-sky-500 outline-none text-right bg-white leading-relaxed"
                                            />
                                          </div>
                                        </div>
                                      )}

                                      {/* Submit Activity Button */}
                                      <div className="flex justify-end pt-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const text = newActivityText[group.id] || '';
                                            const attachmentData = newActivityAttachment[group.id] || null;

                                            if (!text.trim() && !attachmentData) {
                                              alert('لطفاً ابتدا شرح فعالیت یا پیوست را وارد کنید.');
                                              return;
                                            }

                                            let referralData = null;
                                            if (referralEnabled[group.id]) {
                                              const assignedTo = referralAssignedTo[group.id];
                                              const action = referralAction[group.id];
                                              if (!assignedTo) {
                                                alert('لطفاً همکار ارجاع‌شونده را انتخاب کنید.');
                                                return;
                                              }
                                              if (!action || !action.trim()) {
                                                alert('لطفاً شرح اقدام ارجاع را وارد کنید.');
                                                return;
                                              }
                                              referralData = {
                                                id: 'ref-' + Date.now(),
                                                assignedTo,
                                                actionRequired: action.trim(),
                                                assignedBy: currentUser?.fullName || 'محمد توکل مقدم',
                                                createdAt: new Date().toISOString(),
                                                status: 'در انتظار اقدام',
                                                response: null,
                                                messages: []
                                              };
                                            }

                                            if (addProjectActivity) {
                                              addProjectActivity(
                                                selectedProjectForActivities.id,
                                                group.id,
                                                text.trim(),
                                                attachmentData,
                                                referralData,
                                                currentUser?.fullName || 'کاربر سیستم'
                                              );
                                              
                                              // Reset forms
                                              setNewActivityText(prev => ({ ...prev, [group.id]: '' }));
                                              setNewActivityAttachment(prev => ({ ...prev, [group.id]: null }));
                                              setReferralEnabled(prev => ({ ...prev, [group.id]: false }));
                                              setReferralAssignedTo(prev => ({ ...prev, [group.id]: '' }));
                                              setReferralAction(prev => ({ ...prev, [group.id]: '' }));
                                              alert('فعالیت جدید با موفقیت ثبت گردید.');
                                            }
                                          }}
                                          className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-xs font-bold transition flex items-center gap-1 shadow-md shadow-emerald-500/15"
                                        >
                                          <Send size={11} />
                                          ثبت این فعالیت
                                        </button>
                                      </div>

                                    </div>
                                  </div>
                                )}

                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>

              </div>
              ) : modalTab === 'documents' ? (
                renderProjectDocuments(selectedProjectForActivities)
              ) : modalTab === 'milestones' ? (
                renderProjectMilestones(selectedProjectForActivities)
              ) : (
                renderProjectSupplyStatus(selectedProjectForActivities)
              )}

              {/* Render the Document Preview Modal when active */}
              {renderDocumentPreviewModal()}

            </div>

            {/* Modal Footer */}
            <div className="bg-slate-100 p-4 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedProjectForActivities(null)}
                className="px-5 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition"
              >
                بستن پنجره تاریخچه
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setProjectToDeleteId(null);
          setProjectToDeleteName('');
        }}
        onConfirm={() => {
          if (projectToDeleteId) {
            deleteProject(projectToDeleteId, false);
          }
        }}
        title="حذف پروژه"
        message={`آیا از حذف پروژه "${projectToDeleteName}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      />

      {/* Confirm Delete Activity Modal */}
      <ConfirmModal
        isOpen={activityDeleteConfirmOpen}
        onClose={() => {
          setActivityDeleteConfirmOpen(false);
          setActivityToDeleteGroupId(null);
          setActivityToDeleteId(null);
        }}
        onConfirm={() => {
          if (selectedProjectForActivities && activityToDeleteGroupId && activityToDeleteId) {
            deleteProjectActivity?.(selectedProjectForActivities.id, activityToDeleteGroupId, activityToDeleteId);
          }
        }}
        title="حذف فعالیت پروژه"
        message="آیا از حذف این فعالیت اطمینان دارید؟ این عمل غیرقابل بازگشت است."
      />

      {/* Confirm Complete Category Group Modal */}
      <ConfirmModal
        isOpen={completeGroupConfirmOpen}
        onClose={() => {
          setCompleteGroupConfirmOpen(false);
          setGroupToCompleteId(null);
          setGroupToCompleteName('');
        }}
        onConfirm={() => {
          if (completeProjectCategoryGroup && groupToCompleteId) {
            completeProjectCategoryGroup(groupToCompleteId, currentUser?.fullName || 'کاربر سیستم');
          }
        }}
        title="اتمام کار دسته‌بندی"
        message={`آیا از تغییر وضعیت دسته‌بندی "${groupToCompleteName}" به «اتمام کار» اطمینان دارید؟`}
        variant="warning"
        confirmText="بله، اتمام کار ثبت شود"
      />

      {/* Quick Customer Add Modal */}
      {quickAddType && (
        <QuickAddModal
          isOpen={!!quickAddType}
          onClose={() => {
            setQuickAddType(null);
            setQuickAddCustomerTarget(null);
            setQuickAddProductIndex(null);
          }}
          type={quickAddType}
          settings={settings}
          customers={customers}
          addCustomer={addCustomer}
          products={products}
          addProduct={addProduct}
          users={users}
          initialCustType={(quickAddCustomerTarget === 'financialContact' || quickAddCustomerTarget === 'technicalContact') ? 'حقیقی' : undefined}
          initialLinkedCustomerIds={((quickAddCustomerTarget === 'financialContact' || quickAddCustomerTarget === 'technicalContact') && customerId) ? [customerId] : undefined}
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              if (quickAddType === 'customer') {
                if (quickAddCustomerTarget === 'customerId') {
                  setCustomerId(newEntity.id);
                } else if (quickAddCustomerTarget === 'endUser') {
                  setEndUser(newEntity.id);
                } else if (quickAddCustomerTarget === 'financialContact') {
                  setFinancialContact(newEntity.id);
                } else if (quickAddCustomerTarget === 'technicalContact') {
                  setTechnicalContact(newEntity.id);
                } else {
                  setCustomerId(newEntity.id);
                }
              } else if (quickAddType === 'product') {
                if (quickAddProductIndex !== null) {
                  handleItemProductChange(quickAddProductIndex, newEntity.id);
                } else {
                  setItemsNeeded([...itemsNeeded, { productId: newEntity.id, name: newEntity.displayName || newEntity.name, quantity: 1 }]);
                }
              }
            }
            setQuickAddType(null);
            setQuickAddCustomerTarget(null);
            setQuickAddProductIndex(null);
          }}
        />
      )}

    
      {/* Delete Confirmation Modal */}
      {groupToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir="rtl">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-rose-50/50">
              <div className="flex items-center gap-2 text-rose-600">
                <Trash2 size={20} />
                <h3 className="font-extrabold text-sm">حذف دسته فعالیت</h3>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-700 text-sm font-medium leading-relaxed">
                آیا از حذف این دسته فعالیت و تمام سوابق آن اطمینان دارید؟ این عمل غیرقابل بازگشت است.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => setGroupToDelete(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteProjectCategoryGroup && groupToDelete) {
                    deleteProjectCategoryGroup(groupToDelete);
                  }
                  setGroupToDelete(null);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition"
              >
                بله، حذف شود
              </button>
            </div>
          </div>
        </div>
      )}
</div>
  );
}
