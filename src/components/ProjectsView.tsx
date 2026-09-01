
import React, { useState, useRef } from 'react';
import { ACTIVITY_CATEGORY } from '../utils/activityCategories';
import { formatMoney } from '../numUtils';
import {
  Plus, Search, Filter, Briefcase, Edit, Trash2, XCircle, AlertCircle, AlertTriangle, TrendingUp, X,
  CornerUpLeft, ListChecks, RefreshCcw, Inbox,
  FileSpreadsheet, Clock, Sliders, User, Paperclip, ChevronLeft, ChevronDown, ChevronUp,
 CheckCircle2, History, Check, Folder, FolderOpen, File, Download, Eye, Upload, Printer,
  ChevronRight, Loader2, Image as ImageIcon, Maximize2, Minimize2, ArrowLeftRight, Flag, Zap,
  ExternalLink, Award, Users
} from 'lucide-react';

import { getTodayShamsi, formatDateTimeToShamsi } from '../dateUtils';
import ShamsiDatePicker from './ShamsiDatePicker';
import CustomFieldsForm from './CustomFieldsForm';
import { uploadFile, downloadFileFromServer } from '../imageUtils';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import { exportToCSV } from '../excelUtils';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import { buildCustomerOptions, getCustomerName } from '../utils/customerLabel';
import { getCodeError, cleanCode } from '../utils/documentCodes';
import ConfirmModal from './ConfirmModal';
import QuickAddModal from './QuickAddModal';
import { SearchableSelect } from './SearchableSelect';
import { ALL_CHANNELS, CHANNEL_LABELS } from '../utils/messaging';
import CustomerAgreementAlert from './CustomerAgreementAlert';
import { Project, Customer, Product, ERPSettings, User as UserType } from '../types';
import { ApiError } from '../api/client';
import { projectsApi, type ProjectRow, type ProjectSummary } from '../api/projects';
import { useProjectActivities } from '../api/useProjectActivities';
import { inboxApi } from '../api/inbox';
import { tasksApi } from '../api/tasks';
import MessageReactions from './MessageReactions';
import ProjectFollowUpTab from './ProjectFollowUpTab';
import ActivityComposer from './ActivityComposer';
import CategoryMembersModal from './CategoryMembersModal';
import TaskFromMessageModal, { TaskDraft } from './TaskFromMessageModal';
import { renderWithMentions } from './MentionText';
import {
  BoardLane, REFERRAL_DOING, REFERRAL_DONE, REFERRAL_PENDING, referralStatusForLane,
} from '../utils/workBoard';
import { projectDataGaps, projectGapFields } from '../utils/projectDataGaps';
import { detailToProject, projectToWriteInput, rowToProject } from '../api/projectAdapter';
import { firstOption, withStoredOption } from '../utils/selectOptions';
import { useProjectList } from '../api/useProjectList';
import { useUserDirectory } from '../api/useUserDirectory';
import { useEntitySearch } from '../api/useEntitySearch';
import type { CustomerRow } from '../api/customers';
import {
  ActivityAttachment, MAX_ACTIVITY_ATTACHMENTS, normalizeAttachments,
} from '../utils/attachments';
import { productsApi } from '../api/products';
import { createCustomerWithLinks } from '../api/customerAdapter';
import { productToWriteInput, detailToProduct } from '../api/productAdapter';
import SatisfactionLettersModal from './SatisfactionLettersModal';
import { useProjectJump } from "../api/useProjectJump";
import { moduleForCategory } from "../utils/projectLinks";
import { APP_MODULES } from "../appModules";

/**
 * What the sidebar calls each module, so a link reads as the place it goes.
 *
 * Read from the one catalogue rather than spelled out here: a module renamed in
 * `appModules.ts` must not leave a link saying the old name.
 */
const MODULE_NAMES: Record<string, string> =
  Object.fromEntries(APP_MODULES.map((m) => [m.id, m.name]));

/**
 * Projects screen.
 *
 * Reads through the API rather than props holding whole collections. Per-row
 * figures that are not stored anywhere — pipeline value, prepayment date, the
 * agreed-versus-actual delivery schedule — arrive with each row as `summary`,
 * computed for the page in three queries. The activity/referral feed is loaded
 * per open project through `useProjectActivities`, not from a prop holding every
 * project's category groups.
 */
export interface ProjectsViewProps {
  /**
   * A project code this screen was opened with — see `openProjectIn` in
   * `App.tsx`. Applied to the search box once and then cleared, so returning
   * to the module later does not silently re-apply a filter nobody asked for.
   */
  projectJump?: string;
  onProjectJumpApplied?: () => void;
  /** Follows a project code printed on this screen back to «پروژه‌ها». */
  onOpenProject?: (code: string) => void;
  /**
   * Opens another module, filtered to this project.
   *
   * The other direction of the same rule: from a job to the documents raised
   * on it. The **code** travels, because that is what every one of those
   * screens searches by.
   */
  onOpenModuleForProject?: (view: string, code: string) => void;

  onOpenDocument?: any;
  settings: ERPSettings;
  currentUser: UserType | null;
  users?: UserType[];
  initialSelectedProjectId?: string | null;
  onClearInitialSelectedProject?: () => void;
}

export default function ProjectsView({
  projectJump, onProjectJumpApplied, onOpenProject, onOpenModuleForProject,
  onOpenDocument,
  settings,
  currentUser,
  initialSelectedProjectId, onClearInitialSelectedProject
}: ProjectsViewProps) {
  const list = useProjectList();
  // The project code this screen was opened with, applied to its search box.
  useProjectJump(projectJump, list.setSearch, onProjectJumpApplied);
  const search = list.search;
  const setSearch = list.setSearch;

  /** The page of projects, in the shape this screen's markup was written for. */
  const projects = React.useMemo(() => list.rows.map(rowToProject), [list.rows]);

  /** Derived figures, keyed by project id — pipeline value, delivery schedule. */
  const summaries = React.useMemo(() => {
    const map = new Map<string, NonNullable<ProjectRow["summary"]>>();
    for (const row of list.rows) if (row.summary) map.set(row.id, row.summary);
    return map;
  }, [list.rows]);

  /**
   * How many activity categories are in progress per project — the pulse on the
   * "project details" button. Counted server-side; the client no longer holds
   * every category group to derive it.
   */
  const activeCategoryCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of list.rows) map.set(row.id, row._count?.categoryGroups ?? 0);
    return map;
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
  const addCustomer = async (c: any) => {
    try {
      return await createCustomerWithLinks(c);
    } catch (err) {
      reportError(err, 'ثبت مشتری با خطا مواجه شد.');
      return null;
    }
  };

  const addProduct = async (p: any) => {
    try {
      const created = await productsApi.create(productToWriteInput(p));
      return detailToProduct(created);
    } catch (err) {
      reportError(err, 'ثبت کالا با خطا مواجه شد.');
      return null;
    }
  };

  const [colFilters, setColFilters] = useState<any>({});
  const customFieldFilters = list.filters.customFields;
  const setCustomFieldFilters = (next: Record<string, string>) => {
    for (const [fieldId, value] of Object.entries(next)) list.setCustomFieldFilter(fieldId, value);
  };
  const selectedStatus = list.filters.status;
  const setSelectedStatus = (value: string) => list.setFilter('status', value);
  const [groupToDelete, setGroupToDelete] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [isProjectModalFullscreen, setIsProjectModalFullscreen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editingActivityId, setEditingActivityId] = useState<any>(null);
  const [editingActivityText, setEditingActivityText] = useState("");
  /** The whole list while an entry is being edited — files added and removed. */
  const [editingActivityFiles, setEditingActivityFiles] = useState<ActivityAttachment[]>([]);
  /** Set while a chosen file is on its way to the server. */
  const [uploadingActivityFiles, setUploadingActivityFiles] = useState(false);

  /**
   * Uploads what the user picked and hands back the attachments.
   *
   * One shared by the add form and the edit form, because they now do the same
   * thing and a second copy is how the size limit comes to differ between them.
   */
  const uploadActivityFiles = async (
    fileList: FileList | null,
    existing: ActivityAttachment[],
  ): Promise<ActivityAttachment[] | null> => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return null;
    if (existing.length + files.length > MAX_ACTIVITY_ATTACHMENTS) {
      alert(`حداکثر ${MAX_ACTIVITY_ATTACHMENTS} فایل برای هر فعالیت قابل ثبت است.`);
      return null;
    }
    const oversized = files.find(
      (f) => f.size > 2 * 1024 * 1024 && !f.type.startsWith('image/'),
    );
    if (oversized) {
      alert(`حداکثر حجم مجاز برای فایل‌های غیرتصویری ۲ مگابایت می‌باشد: ${oversized.name}`);
      return null;
    }

    setUploadingActivityFiles(true);
    try {
      // Sequential rather than parallel: the uploads share one disk and one
      // sharp pipeline on the server, and ten at once on a phone connection is
      // how the whole batch times out instead of the last one.
      const added: ActivityAttachment[] = [];
      for (const file of files) {
        const url = await uploadFile(file);
        added.push({
          name: file.name,
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          url,
        });
      }
      return normalizeAttachments([...existing, ...added]);
    } catch {
      alert('بارگذاری فایل با خطا مواجه شد.');
      return null;
    } finally {
      setUploadingActivityFiles(false);
    }
  };
  const [quickAddType, setQuickAddType] = useState<any>(null);
  const [quickAddCustomerTarget, setQuickAddCustomerTarget] = useState<any>(null);
  const [quickAddProductIndex, setQuickAddProductIndex] = useState<any>(null);
  const [selectedProjectForActivities, setSelectedProjectForActivities] = useState<any>(null);

  /**
   * The open project's activity/referral feed, read and written through the API.
   * `groups` are already scoped to this project, so the markup no longer filters
   * a whole collection by `projectId`.
   */
  const activityFeed = useProjectActivities(selectedProjectForActivities?.id ?? null);
  const projectCategoryGroups = activityFeed.groups;

  // Which blanks the badge on a project card warns about. Configured in
  // Settings; absent falls back to the default list, and an empty array is a
  // real answer meaning «warn about nothing».
  const gapFields = projectGapFields(settings?.projectDataGapFields);

  /** Surfaces a failed feed mutation using the server's own Persian sentence. */
  const reportActivityError = (err: unknown, fallback: string) => {
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
   * Closes or reopens one of the requests a message raised.
   *
   * The feed draws a request as a label, not a panel with a compose field of
   * its own — the message and the mention already say who is being asked and
   * what for. But a status nobody can move from the screen they read it on is a
   * status nobody moves, so the label carries this one press for either party.
   * `referralStatusForLane` is the same mapping the board uses, so the two
   * screens cannot disagree about what a column means.
   */
  const setReferralLane = async (referralId: string, lane: BoardLane) => {
    try {
      await inboxApi.setReferralStatus(referralId, referralStatusForLane(lane));
      activityFeed.refresh();
    } catch (err) {
      reportActivityError(err, 'ثبت وضعیت ارجاع با خطا مواجه شد.');
    }
  };

  /**
   * Opens the details panel on the whole project.
   *
   * The panel edits documents, attachments and milestones and writes the record
   * straight back, so it cannot be handed a grid row — a row has no description
   * and no milestones, and saving one erased both.
   */
  const openProjectDetails = async (row: { id: string }) => {
    try {
      setSelectedProjectForActivities(detailToProject(await projectsApi.get(row.id)));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات پروژه با خطا مواجه شد.');
    }
  };

  const [isActivitiesModalFullscreen, setIsActivitiesModalFullscreen] = useState(false);
  const [modalTab, setModalTab] = useState("activities");
  const [isProjectDetailsExpanded, setIsProjectDetailsExpanded] = useState(false);
  const [selectedFolderName, setSelectedFolderName] = useState<any>(null);
  const [supplyFilter, setSupplyFilter] = useState("ALL");
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [activePreviewDoc, setActivePreviewDoc] = useState<any>(null);
  const [showSatisfactionLetters, setShowSatisfactionLetters] = useState(false);
  // The details panel deliberately does NOT re-sync itself from the grid.
  // It used to: on every list refresh it replaced the loaded project with the
  // matching row, which silently swapped a full record for a projection that
  // has no description, items or milestones — and the panel's own saves then
  // wrote that projection back. The panel is refreshed by whoever changes it,
  // through the detail record `persistProject` returns.
  React.useEffect(() => {
    if (!selectedProjectForActivities) {
      setModalTab("activities");
      setSelectedFolderName(null);
      setActivePreviewDoc(null);
    }
  }, [selectedProjectForActivities]);
  React.useEffect(() => {
    if (initialSelectedProjectId) {
      void openProjectDetails({ id: initialSelectedProjectId });
      if (onClearInitialSelectedProject) {
        onClearInitialSelectedProject();
      }
    }
  }, [initialSelectedProjectId, onClearInitialSelectedProject]);
  const [newActivityAttachment, setNewActivityAttachment] = useState<any>({});
  /*
   * The message being answered, per category group.
   *
   * Keyed on the group because each group has its own composer, and a reply
   * started in one must not follow the reader into another.
   */
  const [replyTo, setReplyTo] = useState<
    { groupId: string; id: string; text: string; authorName: string | null } | null
  >(null);
  /** The message a task is being raised from, or null. */
  const [taskFromMessage, setTaskFromMessage] = useState<{ id: string; text: string } | null>(null);
  const [selectedCategoryToCreate, setSelectedCategoryToCreate] = useState("");
  const [categoryStartDate, setCategoryStartDate] = useState(getTodayShamsi());
  const [editingGroupIdForStartDate, setEditingGroupIdForStartDate] = useState<string | null>(null);
  const [editingGroupIdForEndDate, setEditingGroupIdForEndDate] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<any>({});
  const [customValues, setCustomValues] = useState<any>({});

  /*
   * «دیده شد» means the conversation was open, not that the project was.
   *
   * Every category this project has arrives with the feed and each stays folded
   * until somebody opens it, so recording a receipt for everything fetched
   * would claim people had read conversations they never unfolded — and the eye
   * exists precisely to be believed. Only the expanded groups' messages are
   * reported, and the hook sends each one once per session.
   */
  const markActivitiesRead = activityFeed.markRead;
  React.useEffect(() => {
    const onScreen = projectCategoryGroups
      .filter((group) => !!expandedGroups[group.id])
      .flatMap((group) => group.activities.map((activity) => activity.id));
    markActivitiesRead(onScreen);
  }, [projectCategoryGroups, expandedGroups, markActivitiesRead]);

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
  const [activityToDeleteId, setActivityToDeleteId] = useState<any>(null);
  const [completeGroupConfirmOpen, setCompleteGroupConfirmOpen] = useState(false);
  // Which category's membership is being edited, by id — never the object, so
  // a refetch behind the modal cannot swap the subject out from under it.
  const [membersGroupId, setMembersGroupId] = useState<string | null>(null);
  const [groupToCompleteId, setGroupToCompleteId] = useState<any>(null);
  const [groupToCompleteName, setGroupToCompleteName] = useState("");
  const [name, setName] = useState("");
  // Editable project code. Blank means "generate it from settings.documentFormats".
  const [code, setCode] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("جدید");
  const [description, setDescription] = useState("");
  const [itemsNeeded, setItemsNeeded] = useState<any[]>([]);
  const [lossReason, setLossReason] = useState("");
  /*
   * Whether this project's loss reason is its own to type.
   *
   * Once a quotation exists the reason is derived from that quotation's lines
   * (`deriveProjectLossReason` on the server), because the loss is decided
   * there — line by line — and a second editable copy here is how a loss-reason
   * report came to find two different answers for one project. Zero quotations
   * is the case the box still answers: a job lost before anything was quoted.
   */
  const [proformaCount, setProformaCount] = useState(0);
  const [salesExpert, setSalesExpert] = useState("");
  /** Who to write to about this job, and how — see the messaging module. */
  const [messagingContactId, setMessagingContactId] = useState("");
  const [messagingChannel, setMessagingChannel] = useState("");
  const [suppressAutoMessages, setSuppressAutoMessages] = useState(false);
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

  // Writes are round trips now: the form refuses a second submit rather than
  // sending the same project twice.
  const [saving, setSaving] = useState(false);

  /**
   * Pickers backed by the server.
   *
   * The customer and product lists are unbounded, so neither can be held in the
   * form. Both search as the user types and are disabled while the modal is
   * closed, so a closed form does not query behind it.
   */
  const customerPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 25,
    getLabel: (row) => row.companyName,
    selectedId: customerId || null,
    enabled: showModal,
  });

  /**
   * The end-user field searches separately.
   *
   * It lists customers too, but one shared picker would mean the term typed
   * into the buyer field decides what this one can offer, and the reverse.
   */
  /**
   * The name behind a picked customer id.
   *
   * Stored beside the foreign key so the record still reads correctly if the
   * customer is later renamed or removed — the same reason a proforma line
   * keeps the product name it was quoted under.
   */
  const nameOfCustomer = (id: string, pool: Customer[]): string => {
    if (!id) return "";
    const found = pool.find((c) => c.id === id);
    if (!found) return "";
    return found.companyName
      || `${found.firstName || ""} ${found.lastName || ""}`.trim();
  };

  // Declared above the pickers, which pin the current selection by id.
  const [endUserId, setEndUserId] = useState("");
  const [financialContactId, setFinancialContactId] = useState("");
  const [technicalContactId, setTechnicalContactId] = useState("");

  const endUserPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 25,
    getLabel: (row) => row.companyName,
    // The picked id, not the stored name: this is what pins the current
    // selection into the options so the field shows it when the form opens.
    selectedId: endUserId || null,
    enabled: showModal,
  });

  // Separate picker for contacts linked to the selected customer
  const linkedContactsPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers',
    limit: 100,
    params: {
      customerType: 'حقیقی',
      linkedTo: customerId || undefined,
    },
    getLabel: (row) => `${row.firstName || ''} ${row.lastName || ''}`.trim(),
    enabled: showModal && !!customerId,
  });

  const productPicker = useEntitySearch<{ id: string; displayName: string; hasVariants: boolean }>({
    path: '/api/products',
    limit: 25,
    getLabel: (row) => row.displayName,
    enabled: showModal,
  });

  /** Products currently offered by the picker, for resolving a chosen id. */
  const products = productPicker.matches as unknown as Product[];
  const customers = customerPicker.matches as unknown as Customer[];
  const endUserCustomers = endUserPicker.matches as unknown as Customer[];
  const linkedContacts = linkedContactsPicker.matches as unknown as Customer[];

  /**
   * The three contact fields are foreign keys on the server. The form holds the
   * ids; the names come from the record the server joins for display.
   */
  /**
   * The grid's derived figures.
   *
   * These used to be computed here by scanning proformas, transactions and
   * packing lists once per visible row. They now arrive with each row, computed
   * for the whole page in three queries — see `summarizeProjects` on the server.
   * These readers just look them up.
   */
  const summaryOf = (projectId: string): ProjectSummary | undefined => summaries.get(projectId);

  const getPipelineValue = (projectId: string): number =>
    Number(summaryOf(projectId)?.pipelineValue ?? 0);

  const getPipelineCurrency = (projectId: string): string =>
    summaryOf(projectId)?.pipelineCurrency ?? "";

  const getProjectPrepaymentDate = (projectId: string): string | null =>
    summaryOf(projectId)?.prepaymentDate ?? null;

  const getActualDeliveryDate = (projectId: string): string | null =>
    summaryOf(projectId)?.actualDeliveryDate ?? null;

  const EMPTY_DELIVERY = {
    agreedItems: [] as ProjectSummary["agreedItems"],
    actualItems: [] as ProjectSummary["actualItems"],
    hasMultipleAgreed: false,
    hasMultipleActual: false,
    singleAgreedDate: "",
    singleActualDate: "",
  };

  const getProjectDeliveryDetails = (projectId: string) => {
    const summary = summaryOf(projectId);
    if (!summary) return EMPTY_DELIVERY;

    const agreedDates = new Set(summary.agreedItems.map((i) => i.calculatedDate).filter(Boolean));
    const actualDates = new Set(summary.actualItems.map((i) => i.actualDate).filter(Boolean));

    return {
      agreedItems: summary.agreedItems,
      actualItems: summary.actualItems,
      hasMultipleAgreed: agreedDates.size > 1,
      hasMultipleActual: actualDates.size > 1,
      singleAgreedDate: agreedDates.size === 1 ? [...agreedDates][0] ?? "" : "",
      singleActualDate: summary.singleActualDate ?? "",
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

  // --- Excel import for generic "مشخصات کلی" items ---
  const itemsExcelInputRef = useRef<HTMLInputElement>(null);

  const CATEGORY_LABELS: Record<string, string> = { FLOW: 'فلو', TEMPERATURE: 'دما', PRESSURE: 'فشار', LEVEL: 'سطح' };

  const normalizeItemCategory = (raw: any): 'FLOW' | 'TEMPERATURE' | 'PRESSURE' | 'LEVEL' => {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return 'FLOW';
    if (s.includes('دما') || s.includes('حرارت') || s.includes('temp')) return 'TEMPERATURE';
    if (s.includes('فشار') || s.includes('press')) return 'PRESSURE';
    if (s.includes('سطح') || s.includes('لول') || s.includes('level')) return 'LEVEL';
    if (s.includes('فلو') || s.includes('جریان') || s.includes('flow')) return 'FLOW';
    return 'FLOW';
  };

  const faToEnDigitsLocal = (str: any): string => {
    return String(str ?? '')
      .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  };

  const buildGenericItemName = (category: string, equipmentType: string, size: string): string => {
    const catLabel = CATEGORY_LABELS[category] || 'فلو';
    const sizeStr = size ? ` (سایز: ${size})` : '';
    return `${catLabel} - ${equipmentType || 'تجهیز درخواستی'}${sizeStr}`;
  };

  const handleDownloadItemsTemplate = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('اقلام درخواستی');
      worksheet.views = [{ rightToLeft: true }];
      worksheet.columns = [
        { header: 'دسته کالا', key: 'category', width: 18 },
        { header: 'نوع تجهیز', key: 'equipmentType', width: 30 },
        { header: 'سایز', key: 'size', width: 14 },
        { header: 'تگ نامبر', key: 'tagNumber', width: 16 },
        { header: 'تعداد', key: 'quantity', width: 10 },
      ];
      worksheet.getRow(1).font = { bold: true };
      worksheet.addRow({ category: 'فلو', equipmentType: 'فلومتر کوریولیس', size: '2 اینچ', tagNumber: 'FIT-101', quantity: 2 });
      worksheet.addRow({ category: 'فشار', equipmentType: 'ترانسمیتر فشار', size: 'G1/2', tagNumber: 'PIT-201', quantity: 5 });
      // Category dropdown validation
      for (let i = 2; i <= 300; i++) {
        worksheet.getCell(`A${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"فلو,دما,فشار,سطح"'],
        };
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, 'قالب_اقلام_درخواستی_پروژه.xlsx');
    } catch (err) {
      alert('خطا در ساخت قالب اکسل.');
    }
  };

  const handleImportItemsFromExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

        // Tolerant column matching (ignores spaces / ZWNJ / case)
        const getField = (row: any, targets: string[]) => {
          const clean = (s: string) => String(s).replace(/[\s‌]/g, '').toLowerCase();
          const cleanTargets = targets.map(clean);
          for (const key of Object.keys(row)) {
            if (cleanTargets.includes(clean(key))) return row[key];
          }
          return undefined;
        };

        const newItems = jsonData.map((row) => {
          const category = normalizeItemCategory(getField(row, ['دسته کالا', 'دسته‌بندی', 'دسته بندی', 'دسته', 'category']));
          const equipmentType = String(getField(row, ['نوع تجهیز', 'تجهیز', 'equipmentType']) ?? '').trim();
          const size = String(getField(row, ['سایز', 'size']) ?? '').trim();
          const tagNumber = String(getField(row, ['تگ نامبر', 'تگ‌نامبر', 'تگ', 'tag', 'tagNumber']) ?? '').trim();
          const quantity = Math.max(1, Math.floor(Number(faToEnDigitsLocal(getField(row, ['تعداد', 'quantity', 'qty']))) || 1));
          return {
            productId: 'generic',
            name: buildGenericItemName(category, equipmentType, size),
            quantity,
            supplyMethod: 'ORDER',
            category,
            equipmentType,
            size,
            tagNumber,
          };
        }).filter((it) => it.equipmentType || it.size || it.tagNumber);

        if (newItems.length === 0) {
          alert('هیچ ردیف معتبری در فایل اکسل یافت نشد. لطفاً از قالب استاندارد استفاده کنید (ستون‌های: دسته کالا، نوع تجهیز، سایز، تگ نامبر، تعداد).');
        } else {
          setItemsNeeded((prev) => [...prev, ...newItems]);
          alert(`${newItems.length} ردیف با موفقیت از فایل اکسل به جدول مشخصات کلی افزوده شد.`);
        }
      } catch (err) {
        alert('خطا در پردازش فایل اکسل. لطفاً از قالب استاندارد استفاده کنید.');
      } finally {
        if (itemsExcelInputRef.current) itemsExcelInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
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
    setCode("");
    setCustomerId(customers[0]?.id || "");
    setStatus("جدید");
    setDescription("");
    setCustomValues({});
    setItemsNeeded([]);
    setLossReason("");
    // A project being created has no quotation, so its loss reason is its own.
    setProformaCount(0);
    // Whoever is opening the form is nearly always the expert on the
    // opportunity; it stays editable for the times they are not.
    setSalesExpert(currentUser?.fullName || "");
    setMessagingContactId("");
    setMessagingChannel("");
    // The first configured choice, not a literal: a literal the list does not
    // offer makes the select show its first option while the form saves the
    // literal — the value shown and the value stored then disagree.
    setMarketingChannel(firstOption(settings.dropdownItems?.marketingChannels, "تماس مستقیم"));
    setLeadQuality(firstOption(settings.dropdownItems?.leadQualities, "متوسط"));
    setReferrerName("");
    // Both halves of each contact: the id that links it and the name that
    // records it. Clearing only the names left the previous project's links
    // attached to the next one.
    setFinancialContact("");
    setFinancialContactId("");
    setTechnicalContact("");
    setTechnicalContactId("");
    setCommunicationMethod(firstOption(settings.dropdownItems?.communicationMethods, "تلفن"));
    setOpportunityDate(getTodayShamsi());
    setCustomerInquiryNumber("");
    setWinningDate("");
    setAgreedDeliveryDate("");
    setEndUser("");
    setEndUserId("");
    setAttachments([]);
    setShowModal(true);
  };
  /**
   * Loads the whole project before filling the form.
   *
   * A grid row carries no description, no requested items, no milestones and
   * no custom values, so populating the form from one and saving wrote them
   * back empty.
   */
  const handleOpenEdit = async (row) => {
    let proj;
    try {
      proj = detailToProject(await projectsApi.get(row.id));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات پروژه با خطا مواجه شد.');
      return;
    }

    setEditingProject(proj);
    // The three contact pickers are ids. They were never restored here, so
    // every save of an existing project cleared all three links.
    setEndUserId(proj.endUserCustomerId || "");
    setFinancialContactId(proj.financialContactId || "");
    setTechnicalContactId(proj.technicalContactId || "");
    setName(proj.name);
    setCode(proj.code || "");
    setCustomerId(proj.customerId);
    setStatus(proj.status);
    setDescription(proj.description);
    setCustomValues(proj.customValues || {});
    setItemsNeeded(proj.itemsNeeded || []);
    setLossReason(proj.lossReason || "");
    setProformaCount(proj.proformaCount ?? 0);
    setSalesExpert(proj.salesExpert || "");
    setMessagingContactId(proj.messagingContactId || "");
    setSuppressAutoMessages(proj.suppressAutoMessages === true);
    setMessagingChannel(proj.messagingChannel || "");
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
    if (!customerId) {
      alert('لطفاً مشتری پروژه را انتخاب کنید.');
      return;
    }
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

    const codeError = getCodeError('project', code, projects, 'code', editingProject?.id);
    if (codeError) {
      alert(codeError);
      return;
    }

    const data = {
      name,
      code: cleanCode(code),
      customerId,
      customerName,
      status,
      description,
      customValues,
      itemsNeeded,
      /*
       * `void 0` is «not edited», and that is what a project with a quotation
       * always sends: its reason is derived from the proforma lines, so the
       * form must not offer the server a second opinion it would refuse.
       */
      lossReason: status === "باخته" && proformaCount === 0 ? lossReason : void 0,
      // New Fields
      salesExpert,
      messagingContactId: messagingContactId || undefined,
      suppressAutoMessages,
      messagingChannel: (messagingChannel || undefined) as Project["messagingChannel"],
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
    void (async () => {
      if (saving) return;
      setSaving(true);
      try {
        const payload = projectToWriteInput({
          ...(editingProject ?? {}),
          ...data,
          endUserCustomerId: endUserId || null,
          financialContactId: financialContactId || null,
          technicalContactId: technicalContactId || null,
        });

        if (editingProject) await projectsApi.update(editingProject.id, payload);
        else await projectsApi.create(payload);

        list.refresh();
        setShowModal(false);
      } catch (err) {
        reportError(err, 'ذخیره پروژه با خطا مواجه شد.');
      } finally {
        setSaving(false);
      }
    })();
  };

  /** Writes one already-loaded project back, then refreshes the page. */
  const persistProject = async (project: any, changes: Record<string, unknown>) => {
    try {
      const saved = await projectsApi.update(project.id, projectToWriteInput({ ...project, ...changes }));
      list.refresh();
      return detailToProject(saved);
    } catch (err) {
      reportError(err, 'ثبت تغییرات پروژه با خطا مواجه شد.');
      return null;
    }
  };

  // The server has already filtered, sorted and paged this. What remains are the
  // per-column filters, which narrow the page in hand.
  const filteredProjects = projects.filter((p) => {
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
      getPipelineValue(p.id) ? `${formatMoney(getPipelineValue(p.id))} ${getPipelineCurrency(p.id)}` : "0",
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
  /**
   * The documents tab's contents.
   *
   * A project's paperwork lives across seven tables. This used to be assembled
   * here by holding all seven collections and filtering each by project id; it
   * is now one call, made when the tab is opened rather than with the project.
   */
  const [projectDocuments, setProjectDocuments] = useState<Record<string, any[]>>({});

  React.useEffect(() => {
    const projectId = selectedProjectForActivities?.id;
    if (!projectId || modalTab !== "documents") return;

    let cancelled = false;
    projectsApi
      .documents(projectId)
      .then((docs) => { if (!cancelled) setProjectDocuments(docs); })
      .catch((err) => {
        if (cancelled) return;
        // An empty tab is better than a broken modal.
        setProjectDocuments({});
        reportError(err, "دریافت اسناد پروژه با خطا مواجه شد.");
      })

    return () => { cancelled = true; };
  }, [selectedProjectForActivities?.id, modalTab]);

  const getProjectFoldersAndFiles = (_p: any) => {
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

    // The server groups by the same folder names; anything it did not fill in
    // renders as an empty folder rather than a missing one.
    const folderFiles: Record<string, any[]> = {};
    folders.forEach((f) => { folderFiles[f.name] = projectDocuments[f.name] ?? []; });

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
        const saved = await persistProject(p, {
          manualDocuments: updatedProject.manualDocuments,
          attachments: updatedProject.attachments,
        });
        if (saved) {
          setSelectedProjectForActivities(saved);
          // The documents tab is served by the API, so it has to re-read.
          setProjectDocuments(await projectsApi.documents(p.id));
        }
      }
    } catch (err: any) {
      alert(err.message || 'خطا در بارگذاری فایل');
    } finally {
      if (e.target) e.target.value = '';
      setIsUploadingDoc(false);
    }
  };

  const handleFileDelete = async (docId: string, docName: string, docType: 'manual' | 'attachment') => {
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

    const saved = await persistProject(p, {
      manualDocuments: updatedProject.manualDocuments,
      attachments: updatedProject.attachments,
    });
    if (saved) {
      setSelectedProjectForActivities(saved);
      // The row leaves the list; saying so as well is noise.
      setProjectDocuments(await projectsApi.documents(p.id));
    }
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
          <td class="p-2 border border-slate-200 text-left font-mono">${formatMoney(item.unitPrice)}</td>
          <td class="p-2 border border-slate-200 text-left font-mono">${formatMoney(item.unitPrice * item.quantity)}</td>
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
                <span class="font-mono">${formatMoney(pf?.totalAmount)} ریال</span>
              </div>
              <div class="flex justify-between border-b border-slate-100 pb-1">
                <span class="text-slate-400 font-bold">تخفیف:</span>
                <span class="font-mono text-red-600">${formatMoney(pf?.discountAmount || 0)} ریال</span>
              </div>
              <div class="flex justify-between border-b border-slate-100 pb-1">
                <span class="text-slate-400 font-bold">مالیات بر ارزش افزوده (۱۰٪):</span>
                <span class="font-mono">${formatMoney(pf?.vatAmount || 0)} ریال</span>
              </div>
              <div class="flex justify-between font-bold text-slate-900 border-b-2 border-slate-300 pb-1.5 text-xs">
                <span>مبلغ قابل پرداخت:</span>
                <span class="font-mono">${formatMoney(pf?.finalAmount)} ریال</span>
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
          <td class="p-2 border border-slate-200 text-left font-mono">${formatMoney(item.foreignUnitPrice)} ${po?.currency}</td>
          <td class="p-2 border border-slate-200 text-left font-mono">${formatMoney(item.foreignUnitPrice * item.quantity)} ${po?.currency}</td>
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
              <strong class="text-slate-900 text-sm font-mono mr-1">${formatMoney(tx?.amountRIYAL)} ریال</strong>
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

  /**
   * Whether a row is a record the app renders rather than a file that exists.
   *
   * The server says so. This used to be worked out here from id prefixes —
   * `delivery-pl-`, `tx-` — and a `type` of `'system'`, none of which the
   * server has ever emitted. So the branch was dead: every generated document
   * fell through to the plain file handling below.
   */
  const isGeneratedDoc = (doc: any): boolean =>
    !!doc?.generated || (typeof doc?.url === 'string' && doc.url.startsWith('?printModule='));

  /** Opens a generated document in its own module's printable view. */
  const openGeneratedDoc = (doc: any) => {
    // The url the server built is already the right query; it only needs the
    // leading slash and the standalone flag that hides the shell.
    const query = String(doc.url).replace(/^\??/, '');
    window.open(`/?${query}&standalone=true`, '_blank');
  };

  const handlePreviewOrDownload = (doc: any) => {
    if (isGeneratedDoc(doc)) {
      openGeneratedDoc(doc);
      return;
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
    // Won lines and how each is supplied, resolved server-side. The client used
    // to derive this by scanning proformas and products and reconciling three
    // disagreeing sources per line.
    const allWonItems = (summaryOf(project.id)?.wonItems ?? []).map((item) => ({
      ...item,
      quantity: Number(item.quantity),
    }));

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
              <span>پیش‌فاکتورهای برنده شده: {new Set(allWonItems.map(i => i.proformaId)).size} عدد</span>
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
                                  date: '',
                                  type: 'system',
                                  // The link only needs to identify the proforma.
                                  originalEntity: { id: item.proformaId, proformaNumber: item.proformaNumber }
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

    /**
     * Saves, and adopts what came back.
     *
     * Not optional here. A new milestone is sent with a client-side `ms-…` id
     * and stored under a server uuid; a rule created next points at whichever
     * id the panel is holding. Discarding the response — which every one of
     * these handlers used to do — left the panel naming an id the server never
     * had, so the rule pointed at nothing from the moment it was written.
     *
     * It is also how the automation's own effects become visible: completing a
     * checkpoint can tick others and raise tasks, server-side.
     */
    const saveMilestones = async (changes: Record<string, unknown>) => {
      const saved = await persistProject(project, changes);
      if (saved) setSelectedProjectForActivities(saved);
    };

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

      void saveMilestones({ milestones: [...projectMilestones, newMs] });
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

      void saveMilestones({ milestones: updatedMilestones });
    };

    const handleDeleteMilestone = (milestoneId: string) => {
      const updatedMilestones = projectMilestones.filter(m => m.id !== milestoneId);
      // Also filter out any rules tied to this deleted milestone
      const updatedRules = projectRules.filter(r => r.triggerMilestoneId !== milestoneId);

      void saveMilestones({ milestones: updatedMilestones, milestoneRules: updatedRules });
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

      void saveMilestones({ milestoneRules: [...projectRules, newRule] });
      setNewRuleTitle("");
      setNewRuleDesc("");
      setNewRuleAssignedTo("");
      setNewRulePriority("متوسط");
      setNewRuleDueDays(0);
      setShowRuleForm(false);
    };

    const handleDeleteRule = (ruleId: string) => {
      void saveMilestones({ milestoneRules: projectRules.filter(r => r.id !== ruleId) });
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
                      {/*
                        The names the server actually files these groups under.
                        They were hardcoded here as four different strings —
                        «سفارشات خرید (PO)», «بسته‌بندی و ارسال» — none of which
                        matched a real category, so a trigger set to any of them
                        could never match anything. Read from the shared module
                        so a rename cannot separate them again.
                      */}
                      <optgroup label="ماژول‌های سیستمی">
                        {Object.values(ACTIVITY_CATEGORY).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
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
              <div className="space-y-3 pr-1">
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
              <div className="space-y-3 pr-1">
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
            <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-1 rounded-md border border-slate-200">کل اسناد: {Object.values(folderFiles).reduce<number>((acc, f) => acc + (f as any[]).length, 0)} فایل</span>
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
                            {/*
                              A generated document has no file behind it — it is
                              rendered from the record on demand. Pointing the
                              download at its route fetched the application's own
                              HTML shell and saved it under a .pdf name, which is
                              the unopenable file people were getting. It opens
                              the printable view instead, which is where a PDF
                              actually comes from.
                            */}
                            {isGeneratedDoc(doc) ? (
                              <button
                                type="button"
                                onClick={() => openGeneratedDoc(doc)}
                                className="p-1.5 hover:bg-slate-100 rounded text-slate-600 hover:text-slate-800 transition flex items-center cursor-pointer"
                                title="مشاهده و چاپ / ذخیره به صورت PDF"
                              >
                                <Printer size={14} />
                              </button>
                            ) : doc.url !== '#' && (
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
                          <td className="p-2 border border-slate-200 text-left font-mono">{formatMoney(item.unitPrice)}</td>
                          <td className="p-2 border border-slate-200 text-left font-mono">{formatMoney(item.unitPrice * item.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex justify-end">
                    <div className="w-64 space-y-1.5 text-[11px]">
                      <div className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400 font-bold">مجموع ناخالص:</span>
                        <span className="font-mono">{formatMoney(doc.originalEntity?.totalAmount)} ریال</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400 font-bold">تخفیف:</span>
                        <span className="font-mono text-red-600">{formatMoney(doc.originalEntity?.discountAmount || 0)} ریال</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="text-slate-400 font-bold">مالیات بر ارزش افزوده (۱۰٪):</span>
                        <span className="font-mono">{formatMoney(doc.originalEntity?.vatAmount || 0)} ریال</span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-900 border-b-2 border-slate-300 pb-1.5 text-xs">
                        <span>مبلغ قابل پرداخت:</span>
                        <span className="font-mono">{formatMoney(doc.originalEntity?.finalAmount)} ریال</span>
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
                          <td className="p-2 border border-slate-200 text-left font-mono">{formatMoney(item.foreignUnitPrice)} {doc.originalEntity?.currency}</td>
                          <td className="p-2 border border-slate-200 text-left font-mono">{formatMoney(item.foreignUnitPrice * item.quantity)} {doc.originalEntity?.currency}</td>
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
                      <strong className="text-slate-900 text-sm font-mono mr-1">{formatMoney(doc.originalEntity?.amountRIYAL)} ریال</strong>
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
            onClick={() => setShowSatisfactionLetters(true)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-amber-500/15 flex items-center gap-2"
          >
            <Award size={16} />
            ثبت رضایت‌نامه‌ها
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
                <th className="p-3 w-44">شماره پروژه</th>
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
                    placeholder="فیلتر شماره..."
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
                  {/* The number is what people quote on the phone, so it is not
                      allowed to wrap mid-code — the column is wide enough for
                      the format the settings produce. */}
                  <td className="p-3 font-mono font-bold text-slate-500 whitespace-nowrap">
                    {p.code}
                  </td>

                  {/* Name */}
                  <td className="p-3 text-slate-900">
                    <div className="flex items-start gap-1.5">
                      <div className="font-bold text-sm text-slate-900">{p.name}</div>
                      {/*
                        A small warning that the record itself is incomplete.

                        Which blanks count is a setting, not a rule in code —
                        every company means something different by "serious" —
                        and it is deliberately not `requiredFields.projects`,
                        which is enforced on save and would make every existing
                        project unsavable the moment one was switched on. The
                        badge names the fields it is complaining about rather
                        than making somebody open the form to find out.
                      */}
                      {(() => {
                        const gaps = projectDataGaps(p as unknown as Record<string, unknown>, gapFields);
                        if (gaps.length === 0) return null;
                        return (
                          <span
                            className="shrink-0 inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded px-1 py-0.5 text-[9px] font-bold"
                            title={`اطلاعات ناقص: ${gaps.map((g) => g.label).join('، ')}`}
                            id={`project-gap-badge-${p.id}`}
                          >
                            <AlertTriangle size={9} />
                            {gaps.length.toLocaleString('fa-IR')}
                          </span>
                        );
                      })()}
                    </div>
                    
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
                        <span className="font-mono font-bold">{formatMoney(getPipelineValue(p.id))}</span>
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
                        onClick={() => { void openProjectDetails(p); }}
                        className="p-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded transition flex items-center gap-1 text-[10px] font-bold border border-sky-100 shadow-sm"
                        title="جزئیات پروژه"
                      >
                        <Clock size={13} className="text-sky-500" />
                        <span>جزئیات پروژه</span>
                        {(activeCategoryCounts.get(p.id) ?? 0) > 0 && (
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        )}
                      </button>
                      <button
                        onClick={() => { void handleOpenEdit(p); }}
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

        {/* Before the first response there is nothing to report — showing
            "no projects found" while loading reads as an empty database. */}
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

        {filteredProjects.length === 0 && !list.initialLoading && !list.error && (
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

        {/* Pagination. The grid holds one page; these move between them. */}
        {list.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium">
              نمایش {list.rows.length.toLocaleString('fa-IR')} از {list.total.toLocaleString('fa-IR')} پروژه
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

                  {/* Project code (editable; blank = auto-generate) */}
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-slate-500 flex justify-between items-center">
                      <span>کد پروژه</span>
                      {!editingProject && (
                        <span className="text-[10px] text-slate-400 font-normal">
                          خالی بگذارید تا خودکار ساخته شود
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={editingProject ? "" : "مثال: ATA-1405-001 (اختیاری)"}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-left font-mono"
                      dir="ltr"
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
                      onSearchChange={customerPicker.setTerm}
                      loading={customerPicker.loading}
                      options={[
                        { value: '', label: '-- انتخاب مشتری --' },
                        ...buildCustomerOptions(customers)
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
                    {/*
                        The picker's value is a customer id, and it belongs on
                        the foreign key. It used to be written into `endUser` —
                        the *name* column — so the link was never made and every
                        screen that resolved it showed «مشخص نشده». The name is
                        stored alongside, as the document's own record of who
                        this was at the time.
                    */}
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={endUserId}
                      onChange={(val) => {
                        setEndUserId(val);
                        setEndUser(nameOfCustomer(val, endUserCustomers));
                      }}
                      required={isFieldRequired(settings, 'projects', 'endUser')}
                      onSearchChange={endUserPicker.setTerm}
                      loading={endUserPicker.loading}
                      options={[
                        { value: '', label: '-- انتخاب مصرف‌کننده (مشتری) --' },
                        ...buildCustomerOptions(endUserCustomers)
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

                  {/*
                    Who to write to about this job, and how.

                    Both optional: a project that says nothing falls back to the
                    customer's own details, which is what most jobs want. Naming
                    a contact matters when the buyer is a company and the person
                    following the shipment is one individual inside it.
                  */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">گیرنده پیام‌های این پروژه</label>
                    <select
                      value={messagingContactId}
                      onChange={(e) => setMessagingContactId(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      <option value="">-- خود مشتری --</option>
                      {/*
                        The people linked to the chosen customer, from the same
                        picker the financial and technical contact fields use —
                        it asks the server for `linkedTo=<customer>` and
                        `customerType=حقیقی`.

                        This field used to look the ids up in `customers`, which
                        holds the twenty-five rows matching whatever is typed in
                        the customer box. A company's own people are almost
                        never among them, so the list came up empty however many
                        contacts the company had.
                      */}
                      {linkedContacts.map(person => (
                        <option key={person.id} value={person.id}>
                          {`${person.firstName || ''} ${person.lastName || ''}`.trim() || person.companyName}
                          {person.position ? ` — ${person.position}` : ''}
                        </option>
                      ))}
                      {/*
                        Whoever is already stored stays in the list even if the
                        link has since been removed. A select that silently
                        drops its own value shows the first option instead and
                        saves that on the next save.
                      */}
                      {messagingContactId && !linkedContacts.some(c => c.id === messagingContactId) && (
                        <option value={messagingContactId}>مخاطب ثبت‌شده</option>
                      )}
                    </select>
                    {customerId && linkedContacts.length === 0 && (
                      <p className="text-[10px] text-slate-400">
                        شخص حقیقی‌ای به این مشتری لینک نشده است. افراد را در پرونده‌ی مشتری،
                        بخش «مخاطبین مرتبط» اضافه کنید.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">روش ارسال ترجیحی</label>
                    <select
                      value={messagingChannel}
                      onChange={(e) => setMessagingChannel(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                    >
                      <option value="">-- پیش‌فرض (پیامک) --</option>
                      {ALL_CHANNELS.map(c => (
                        <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
                      ))}
                    </select>
                  </div>

                  {/*
                    One job outside the company-wide rules.

                    The alternatives were disabling the rule for everybody or
                    setting the customer's own opt-out, which silences them on
                    every other project too. Deliberately does not stop a person
                    writing to them by hand: this exempts the project from the
                    automation, it does not mark the customer as unreachable.
                  */}
                  <div className="space-y-1.5 md:col-span-2">
                    <label className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer ${
                      suppressAutoMessages
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50/60'
                    }`}>
                      <input
                        type="checkbox"
                        checked={suppressAutoMessages}
                        onChange={(e) => setSuppressAutoMessages(e.target.checked)}
                        className="accent-amber-500 mt-0.5"
                      />
                      <span className="text-[11px] leading-6">
                        <span className="font-bold text-slate-800">
                          این پروژه نیاز به ارسال پیام خودکار ندارد
                        </span>
                        <span className="block text-slate-500">
                          قوانین اتوماسیون برای این پروژه اجرا نمی‌شوند. ارسال دستی پیام از
                          ماژول «ارسال پیام» همچنان ممکن است؛ برای قطع کامل ارتباط با یک مشتری،
                          گزینه «لغو دریافت پیام» در پرونده‌ی خود مشتری را بزنید.
                        </span>
                      </span>
                    </label>
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
                      {withStoredOption(settings.dropdownItems?.marketingChannels || ['تماس مستقیم', 'نمایشگاه تجاری', 'وب‌سایت / آنلاین', 'معرفی', 'مناقصه رسمی', 'سایر'], marketingChannel).map((ch, idx) => (
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
                      {withStoredOption(settings.dropdownItems?.leadQualities || ['عالی (گرم)', 'متوسط', 'ضعیف (سرد)'], leadQuality).map((q, idx) => (
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
                      {withStoredOption(settings.dropdownItems?.communicationMethods || ['تلفن', 'ایمیل', 'جلسه حضوری', 'مکاتبه رسمی', 'شبکه‌های اجتماعی'], communicationMethod).map((m, idx) => (
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
                        value={financialContactId}
                        onChange={(e) => {
                          setFinancialContactId(e.target.value);
                          setFinancialContact(nameOfCustomer(e.target.value, linkedContacts));
                        }}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب فرد مالی (مشتری) --</option>
                        {/* A contact whose link to this customer was removed is
                            still the person this project recorded, so the field
                            keeps showing them rather than falling back to the
                            placeholder as though nothing was chosen. */}
                        {financialContactId && !linkedContacts.some(c => c.id === financialContactId) && (
                          <option value={financialContactId}>{financialContact || 'فرد ثبت‌شده'}</option>
                        )}
                        {linkedContacts.map(c => {
                          const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
                          return (
                            <option key={c.id} value={c.id}>{name}</option>
                          );
                        })}
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
                        value={technicalContactId}
                        onChange={(e) => {
                          setTechnicalContactId(e.target.value);
                          setTechnicalContact(nameOfCustomer(e.target.value, linkedContacts));
                        }}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right bg-white"
                      >
                        <option value="">-- انتخاب فرد فنی (مشتری) --</option>
                        {technicalContactId && !linkedContacts.some(c => c.id === technicalContactId) && (
                          <option value={technicalContactId}>{technicalContact || 'فرد ثبت‌شده'}</option>
                        )}
                        {linkedContacts.map(c => {
                          const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
                          return (
                            <option key={c.id} value={c.id}>{name}</option>
                          );
                        })}
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

                  {/*
                    Loss reason — one per project, and whose it is depends on
                    whether anything has been quoted.

                    With a proforma out, the reason comes from that document's
                    lines and this shows it read-only, saying where to change it;
                    the server refuses a different value here rather than
                    accepting a second answer nobody can reconcile with the
                    first. With none, this box is the only place it could ever
                    be recorded, so it is a live field.
                  */}
                  {status === 'باخته' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-rose-500">
                        دلیل باخت پروژه {proformaCount === 0 && '*'}
                      </label>
                      {proformaCount > 0 ? (
                        <>
                          <div
                            id="project-loss-reason-derived"
                            className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-right text-slate-600"
                          >
                            {lossReason || '— هنوز در ردیف‌های پیش‌فاکتور ثبت نشده —'}
                          </div>
                          <p className="text-[10px] text-slate-500 leading-relaxed">
                            این پروژه پیش‌فاکتور دارد، بنابراین دلیل باخت از «ثبت نتیجه اقلام»
                            همان پیش‌فاکتور گرفته می‌شود تا برای هر پروژه فقط یک دلیل باخت وجود
                            داشته باشد.
                          </p>
                        </>
                      ) : (
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
                      )}
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
                        onClick={handleDownloadItemsTemplate}
                        className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded text-xs font-bold flex items-center gap-1.5 transition border border-slate-200"
                        title="دانلود قالب اکسل با ستون‌های دسته کالا، نوع تجهیز، سایز، تگ نامبر و تعداد"
                      >
                        <Download size={12} />
                        دانلود قالب اکسل
                      </button>
                      <button
                        type="button"
                        onClick={() => itemsExcelInputRef.current?.click()}
                        className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded text-xs font-bold flex items-center gap-1.5 transition"
                        title="بارگذاری اقلام از فایل اکسل (در جدول مشخصات کلی ذخیره می‌شود)"
                      >
                        <Upload size={12} />
                        بارگذاری از اکسل
                      </button>
                      <input
                        ref={itemsExcelInputRef}
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleImportItemsFromExcel}
                        className="hidden"
                      />
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
                                      onSearchChange={productPicker.setTerm}
                                      loading={productPicker.loading}
                                      options={[
                                      // A row's own product must stay selectable whatever is
                                      // being searched for: every row shares one options list,
                                      // so typing in one would otherwise blank the others.
                                      ...(item.productId && item.productId !== 'generic'
                                        && !products.some(p => p.id === item.productId)
                                        ? [{ value: item.productId, label: item.name || item.productId }]
                                        : []),
                                      ...products.map(p => {
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
                                      })]}
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
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'projects', 'description', 'مشخصات مهندسی مورد نیاز، بازه دما و فشارهای کاربری یا شرح عمومی')}</label>
                  <textarea
                    rows={3}
                    required={isFieldRequired(settings, 'projects', 'description')}
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
                /*
                 * The names the record itself carries.
                 *
                 * These three were looked up as ids in `customers` — the
                 * customer *picker's* search results, which on this screen hold
                 * whatever was last searched for and usually nothing at all. So
                 * a project that had an end user and both key people showed
                 * «مشخص نشده» for all three, while the form had saved them
                 * perfectly well. The server already joins each one and the
                 * adapter resolves the name, so the panel just reads it; the
                 * lookup survives only as a fallback for projects saved before
                 * the pickers wrote the foreign key, where the name column
                 * still holds an id.
                 */
                const displayName = (stored?: string | null): string | null => {
                  const value = (stored || '').trim();
                  if (!value) return null;
                  const legacy = customers.find((c: any) => c.id === value);
                  if (!legacy) return value;
                  return getCustomerName(legacy) || legacy.companyName || null;
                };

                const endUserName = displayName(selectedProjectForActivities.endUser);
                const financialContactName = displayName(selectedProjectForActivities.financialContact);
                const technicalContactName = displayName(selectedProjectForActivities.technicalContact);

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
                              {/* The project's own identity: its number and the
                                  day it was opened, which the panel named
                                  nowhere even though the header shows a name. */}
                              <div>
                                <span className="text-slate-400 font-semibold">شماره پروژه:</span>
                                <strong className="text-slate-700 block mt-0.5 font-mono">{selectedProjectForActivities.code || 'مشخص نشده'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">تاریخ ثبت پروژه:</span>
                                <strong className="text-slate-700 block mt-0.5 font-mono">{selectedProjectForActivities.creationDate || 'مشخص نشده'}</strong>
                              </div>
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
                                  {(() => {
                                    /*
                                     * The derived date, not the stored one.
                                     *
                                     * Delivery is quoted as a term — "۳-۴ هفته کاری پس از
                                     * پیش‌پرداخت" — so the date it lands on is counted from
                                     * the prepayment, or from the approval date when there
                                     * is none. The panel printed the field a person typed
                                     * once when the project was first marked won, which
                                     * then stayed put however the approval date moved.
                                     * `summarizeProject` already counts this for the grid.
                                     */
                                    const derived = getProjectDeliveryDetails(selectedProjectForActivities.id);
                                    if (derived.hasMultipleAgreed) {
                                      return (
                                        <div>
                                          <span className="text-sky-500 font-semibold">تاریخ توافقی تحویل اقلام:</span>
                                          <div className="mt-0.5 space-y-0.5">
                                            {derived.agreedItems.map((item, i) => (
                                              <div key={i} className="flex justify-between gap-2 text-sky-700">
                                                <span className="truncate max-w-[140px]" title={item.productName}>{item.productName}:</span>
                                                <strong className="font-mono">{item.calculatedDate}</strong>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    }
                                    const single = derived.singleAgreedDate || selectedProjectForActivities.agreedDeliveryDate;
                                    return single ? (
                                      <div>
                                        <span className="text-sky-500 font-semibold">تاریخ توافقی تحویل:</span>
                                        <strong className="text-sky-700 block mt-0.5 font-mono">{single}</strong>
                                      </div>
                                    ) : null;
                                  })()}
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
                                  <div className="space-y-1.5 pr-1">
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
                                  <div className="space-y-1.5 pr-1">
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
                {/*
                  What has happened on this job's quotations.

                  The follow-up queue answers «what should the sales desk do
                  next, across the company» and leaves out finished sales;
                  somebody who has opened a project is asking what happened
                  here, so this shows every quotation with the chases recorded
                  against it — settled ones included.
                */}
                <button
                  type="button"
                  onClick={() => setModalTab('followUp')}
                  id="project-tab-follow-up"
                  className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                    modalTab === 'followUp'
                      ? 'border-sky-500 text-sky-600 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <RefreshCcw size={15} />
                  <span>پیگیری‌های پروژه</span>
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
                        onClick={async () => {
                          if (!selectedCategoryToCreate) {
                            alert('لطفاً ابتدا یک دسته‌بندی انتخاب کنید.');
                            return;
                          }
                          const cat = (settings.activityCategories || []).find(c => c.id === selectedCategoryToCreate);
                          if (!cat) return;

                          try {
                            await activityFeed.addGroup(cat.id, cat.name, categoryStartDate);
                            setSelectedCategoryToCreate('');
                            setCategoryStartDate(getTodayShamsi());
                          } catch (err) {
                            reportActivityError(err, 'فعال‌سازی دسته‌بندی با خطا مواجه شد.');
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
                                  {/*
                                    Straight to where that kind of work is
                                    actually recorded, filtered to this job.

                                    The category names the work — «استعلام»,
                                    «خرید», «ارسال» — and `moduleForCategory`
                                    matches on the words rather than on an id,
                                    because the categories are the company's own
                                    editable list with no fixed id to key on. A
                                    category nothing matches simply gets no
                                    link: a wrong one is worse than none.
                                  */}
                                  {(() => {
                                    const target = moduleForCategory(group.categoryName);
                                    const code = selectedProjectForActivities?.code;
                                    if (!target || !code || !onOpenModuleForProject) return null;
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          // The header toggles the category open; going to
                                          // another module is a different intent.
                                          e.stopPropagation();
                                          onOpenModuleForProject(target, code);
                                        }}
                                        title={`رفتن به «${MODULE_NAMES[target] ?? target}» برای پروژه ${code}`}
                                        data-category-link={target}
                                        className="text-[10px] font-bold text-sky-700 hover:text-sky-900 hover:underline inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sky-200 bg-white transition"
                                      >
                                        <ExternalLink size={9} />
                                        {MODULE_NAMES[target] ?? target}
                                      </button>
                                    );
                                  })()}
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
                                            activityFeed.updateGroupDates(group, { startDate: val })
                                              .catch((err) => reportActivityError(err, 'ویرایش تاریخ با خطا مواجه شد.'));
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
                                              activityFeed.updateGroupDates(group, { endDate: val })
                                                .catch((err) => reportActivityError(err, 'ویرایش تاریخ با خطا مواجه شد.'));
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
                                  
                                  {/*
                                    Who is notified of every message here.
                                    The count is on the button because an empty
                                    group is the state worth noticing — nobody
                                    is being told anything.
                                  */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMembersGroupId(group.id);
                                    }}
                                    id={`category-members-open-${group.id}`}
                                    className={`px-2 py-1 rounded transition border flex items-center gap-1 shadow-sm text-[10px] font-bold ${
                                      group.memberUserIds.length
                                        ? 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-150'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-200'
                                    }`}
                                    title="اعضای گروه — دریافت‌کنندگان اعلانِ هر پیام این دسته‌بندی"
                                  >
                                    <Users size={11} />
                                    {group.memberUserIds.length
                                      ? group.memberUserIds.length.toLocaleString('fa-IR')
                                      : 'اعضا'}
                                  </button>

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
                                        activityFeed.resumeGroup(group)
                                          .catch((err) => reportActivityError(err, 'به جریان انداختن مجدد با خطا مواجه شد.'));
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
                                            {/* Every file on the entry, not just the first. */}
                                            {editingActivityId !== act.id && act.attachments.map((file) => (
                                              <a
                                                key={file.url}
                                                href={file.url}
                                                download={file.name}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 hover:bg-sky-200 border border-sky-200 text-sky-800 text-[9px] font-bold transition mr-1"
                                                title="دانلود فایل پیوست"
                                              >
                                                <Paperclip size={10} />
                                                {file.name}{file.size ? ` (${file.size})` : ''}
                                              </a>
                                            ))}

                                            {/* What can be done with a message. */}
                                            <div className="flex items-center gap-1 bg-slate-100/60 p-0.5 rounded border border-slate-200/40">
                                              <button
                                                type="button"
                                                onClick={() => setReplyTo({
                                                  groupId: group.id,
                                                  id: act.id,
                                                  text: act.text,
                                                  authorName: act.createdBy ?? null,
                                                })}
                                                className="text-slate-400 hover:text-sky-600 transition p-1 hover:bg-white rounded"
                                                title="پاسخ به این پیام"
                                                id={`activity-reply-${act.id}`}
                                              >
                                                <CornerUpLeft size={10} />
                                              </button>
                                              {/*
                                                Half the work on a job is handed
                                                out in conversation without
                                                anybody being formally referred —
                                                «این را من پیگیری می‌کنم» — and
                                                that left the person holding a
                                                commitment with nothing recording
                                                it. This puts it on their own
                                                list, with the message already in
                                                it and the job attached.
                                              */}
                                              <button
                                                type="button"
                                                onClick={() => setTaskFromMessage({ id: act.id, text: act.text })}
                                                className="text-slate-400 hover:text-emerald-600 transition p-1 hover:bg-white rounded"
                                                title="ثبت وظیفه برای خودم از روی این پیام"
                                                id={`activity-make-task-${act.id}`}
                                              >
                                                <ListChecks size={10} />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingActivityId(act.id);
                                                  setEditingActivityText(act.text);
                                                  setEditingActivityFiles(act.attachments);
                                                }}
                                                className="text-slate-400 hover:text-sky-600 transition p-1 hover:bg-white rounded"
                                                title="ویرایش"
                                              >
                                                <Edit size={10} />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
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

                                            {/*
                                              The files, editable here as well.
                                              The list is sent whole on save, so
                                              a removal is a removal — and the
                                              server treats an absent list as
                                              "not edited", never as "empty".
                                            */}
                                            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                              <label className="cursor-pointer bg-white border border-slate-200 px-2 py-1 rounded hover:bg-slate-50 transition font-bold text-slate-600 flex items-center gap-1">
                                                <Paperclip size={10} className="text-slate-400" />
                                                <span>{uploadingActivityFiles ? 'در حال بارگذاری…' : 'افزودن فایل'}</span>
                                                <input
                                                  type="file"
                                                  multiple
                                                  className="hidden"
                                                  onChange={async (e) => {
                                                    const picked = e.target.files;
                                                    const next = await uploadActivityFiles(picked, editingActivityFiles);
                                                    if (e.target) e.target.value = '';
                                                    if (next) setEditingActivityFiles(next);
                                                  }}
                                                />
                                              </label>
                                              {editingActivityFiles.map((file) => (
                                                <span
                                                  key={file.url}
                                                  className="text-sky-700 font-bold bg-sky-50 px-2 py-1 rounded flex items-center gap-1 border border-sky-100"
                                                >
                                                  {file.name}
                                                  <button
                                                    type="button"
                                                    onClick={() => setEditingActivityFiles(
                                                      (prev) => prev.filter((f) => f.url !== file.url),
                                                    )}
                                                    className="text-rose-500 hover:text-rose-700 font-bold text-xs"
                                                    title="حذف این فایل از فعالیت"
                                                  >
                                                    ×
                                                  </button>
                                                </span>
                                              ))}
                                              {editingActivityFiles.length === 0 && (
                                                <span className="text-slate-400">فایلی پیوست نشده است.</span>
                                              )}
                                            </div>

                                            <div className="flex gap-2 justify-end">
                                              <button
                                                type="button"
                                                disabled={uploadingActivityFiles}
                                                onClick={() => {
                                                  if (editingActivityText.trim() && selectedProjectForActivities) {
                                                    activityFeed.updateActivity(
                                                      act.id,
                                                      editingActivityText.trim(),
                                                      editingActivityFiles,
                                                    )
                                                      .catch((err) => reportActivityError(err, 'ویرایش فعالیت با خطا مواجه شد.'));
                                                    setEditingActivityId(null);
                                                    setEditingActivityText('');
                                                    setEditingActivityFiles([]);
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
                                                  setEditingActivityFiles([]);
                                                }}
                                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold text-[10px] flex items-center gap-1 transition"
                                              >
                                                <X size={10} />
                                                انصراف
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            {/* What is being answered, quoted. */}
                                            {act.replyTo && (
                                              <div className="bg-white border-r-2 border-sky-300 rounded px-2 py-1 mb-1.5">
                                                <div className="text-[9px] font-bold text-sky-600">
                                                  در پاسخ به {act.replyTo.authorName || 'یک همکار'}
                                                </div>
                                                <div className="text-[10px] text-slate-500 line-clamp-2">
                                                  {act.replyTo.text}
                                                </div>
                                              </div>
                                            )}
                                            {/* The names in the message are the
                                                requests it carries, so they are
                                                marked as such rather than left
                                                as punctuation in a sentence. */}
                                            <p className="text-slate-700 leading-relaxed font-semibold whitespace-pre-line">
                                              {renderWithMentions(act.text, users)}
                                            </p>
                                          </>
                                        )}

                                        {/*
                                          Everyone this message named, one thread each.

                                          The answer to a referral is usually read
                                          here, in the project's own feed — and
                                          this was the one place it could only be
                                          read. Somebody who found the reply was
                                          not what they asked for had to go to the
                                          referrals screen to say so. Same
                                          component, same three server calls.
                                        */}
                                        {/*
                                          React, and see who has read it.

                                          A one-press answer — «دیدم», «موافقم»,
                                          «ممنون» — should not cost a message of
                                          its own: a job's history is read top to
                                          bottom, and a column of one-word
                                          replies buries the work in it.
                                        */}
                                        <MessageReactions
                                          activityId={act.id}
                                          reactions={act.reactions}
                                          readCount={act.readCount}
                                          currentUserId={currentUser?.id}
                                          nameOf={(userId) => users.find((u) => u.id === userId)?.fullName}
                                          onToggle={(emoji) => activityFeed
                                            .toggleReaction(act.id, emoji)
                                            .catch((err) => reportActivityError(err, 'ثبت واکنش با خطا مواجه شد.'))}
                                          loadReaders={() => projectsApi.activityReaders(act.id)}
                                        />

                                        {/*
                                          A request, as a label rather than a box.

                                          It used to be drawn as a panel under
                                          the message repeating the message —
                                          «اقدام خواسته‌شده» quoted the very
                                          sentence two lines above it — with a
                                          second compose field of its own. The
                                          message and the mention already say
                                          who is being asked and what for, so
                                          all that is left to say is where the
                                          request has got to.

                                          Answering is the feed's own reply: the
                                          server mirrors a reply by the assignee
                                          into the referral's thread and marks
                                          it picked up, so the inbox and the
                                          board read the same conversation.
                                        */}
                                        {(act.referrals ?? []).length > 0 && (
                                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            {(act.referrals ?? []).map((ref) => {
                                              const status = ref.status || REFERRAL_PENDING;
                                              const done = status === REFERRAL_DONE;
                                              const mine = !!currentUser?.id
                                                && (ref.assignedToUserId === currentUser.id
                                                  || ref.assignedByUserId === currentUser.id);
                                              return (
                                                <span
                                                  key={ref.id}
                                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold ${
                                                    done
                                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                      : status === REFERRAL_DOING
                                                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                                                        : 'bg-sky-50 border-sky-200 text-sky-700'
                                                  }`}
                                                  title={`ارجاع به ${ref.assignedTo || 'همکار'} — ${status}`}
                                                >
                                                  <Inbox size={9} />
                                                  {ref.assignedTo || 'همکار'}: {status}
                                                  {/*
                                                    Closing it is one press, for
                                                    either party. The panel that
                                                    used to carry this button is
                                                    gone, and a status nobody can
                                                    move from the screen they
                                                    read it on is a status nobody
                                                    moves.
                                                  */}
                                                  {mine && (
                                                    <button
                                                      type="button"
                                                      onClick={() => setReferralLane(ref.id, done ? 'TODO' : 'DONE')}
                                                      className="p-0.5 -mr-0.5 rounded hover:opacity-70 transition"
                                                      title={done ? 'بازگشایی ارجاع' : 'اتمام کار این ارجاع'}
                                                      id={`activity-referral-toggle-${ref.id}`}
                                                    >
                                                      {done ? <RefreshCcw size={9} /> : <CheckCircle2 size={9} />}
                                                    </button>
                                                  )}
                                                </span>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>

                                {/*
                                  The composer.

                                  There is no «ارجاع» checkbox any more: it sat
                                  beside a colleague picker and a separate "what
                                  should they do" box, three controls saying what
                                  the sentence already said — and leaving two
                                  texts to keep in step. Naming somebody with @
                                  raises the referral, and the message itself is
                                  the request.
                                */}
                                {!isGroupClosed && (
                                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                    <span className="text-[11px] font-bold text-slate-600 block">
                                      پیام یا فعالیت جدید در این دسته‌بندی:
                                    </span>

                                    <ActivityComposer
                                      users={(users || []).map((u) => ({ id: u.id, fullName: u.fullName }))}
                                      replyTo={replyTo?.groupId === group.id ? replyTo : null}
                                      onCancelReply={() => setReplyTo(null)}
                                      attachments={newActivityAttachment[group.id] ?? []}
                                      onAttachmentsChange={(next) => setNewActivityAttachment(
                                        (prev: any) => ({ ...prev, [group.id]: next }),
                                      )}
                                      uploading={uploadingActivityFiles}
                                      onPickFiles={async (picked) => {
                                        const current = newActivityAttachment[group.id] ?? [];
                                        const next = await uploadActivityFiles(picked, current);
                                        if (next) {
                                          setNewActivityAttachment((prev: any) => ({ ...prev, [group.id]: next }));
                                        }
                                      }}
                                      onSend={async (text) => {
                                        const attachmentData: ActivityAttachment[] =
                                          newActivityAttachment[group.id] ?? [];
                                        try {
                                          await activityFeed.addActivity(group.id, {
                                            text,
                                            attachments: attachmentData,
                                            replyToId: replyTo?.groupId === group.id ? replyTo.id : null,
                                          });
                                          setNewActivityAttachment((prev: any) => ({ ...prev, [group.id]: [] }));
                                          setReplyTo(null);
                                          // No confirmation: the message is on
                                          // the feed in front of the person who
                                          // just wrote it.
                                        } catch (err) {
                                          reportActivityError(err, 'ثبت پیام با خطا مواجه شد.');
                                        }
                                      }}
                                    />
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
              ) : modalTab === 'followUp' ? (
                selectedProjectForActivities ? (
                  <ProjectFollowUpTab
                    projectId={selectedProjectForActivities.id}
                    settings={settings}
                  />
                ) : null
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
        onConfirm={async () => {
          if (!projectToDeleteId) return;
          try {
            await projectsApi.remove(projectToDeleteId);
            list.refresh();
          } catch (err) {
            // The server refuses while proformas, orders or transactions point
            // at the project, and says which.
            reportError(err, 'حذف پروژه با خطا مواجه شد.');
          }
        }}
        title="حذف پروژه"
        message={`آیا از حذف پروژه "${projectToDeleteName}" اطمینان دارید؟ این عمل غیرقابل بازگشت است.`}
      />

      {/*
        A task raised from something said in the feed.

        Assigned to the reader and nobody else: handing work to a colleague is
        what naming them in the message does, and that raises a referral with a
        thread rather than a task appearing silently on their list.
      */}
      {taskFromMessage && (
        <TaskFromMessageModal
          message={taskFromMessage}
          project={selectedProjectForActivities
            ? {
              id: selectedProjectForActivities.id,
              code: selectedProjectForActivities.code,
              name: selectedProjectForActivities.name,
            }
            : null}
          assigneeName={currentUser?.fullName ?? ''}
          onClose={() => setTaskFromMessage(null)}
          onSubmit={async (draft: TaskDraft) => {
            const project = selectedProjectForActivities;
            await tasksApi.create({
              title: draft.title,
              description: draft.description,
              priority: draft.priority,
              status: 'در حال انجام',
              dueDate: draft.dueDate,
              assignedToUserId: currentUser?.id ?? null,
              assignedToName: currentUser?.fullName ?? null,
              relatedToType: project ? 'پروژه' : 'عمومی',
              relatedToId: project?.id ?? null,
              relatedToName: project?.name ?? null,
            });
            setTaskFromMessage(null);
          }}
        />
      )}

      {/* Confirm Delete Activity Modal */}
      <ConfirmModal
        isOpen={activityDeleteConfirmOpen}
        onClose={() => {
          setActivityDeleteConfirmOpen(false);
          setActivityToDeleteId(null);
        }}
        onConfirm={() => {
          if (selectedProjectForActivities && activityToDeleteId) {
            activityFeed.deleteActivity(activityToDeleteId)
              .catch((err) => reportActivityError(err, 'حذف فعالیت با خطا مواجه شد.'));
          }
        }}
        title="حذف فعالیت پروژه"
        message="آیا از حذف این فعالیت اطمینان دارید؟ این عمل غیرقابل بازگشت است."
      />

      {/* Confirm Complete Category Group Modal */}
      {/*
        Rendered from the live `activityFeed.groups`, so the list the modal
        seeds from is the one the screen just fetched rather than a copy taken
        when the button was pressed.
      */}
      <CategoryMembersModal
        isOpen={!!membersGroupId}
        group={activityFeed.groups.find((g) => g.id === membersGroupId) ?? null}
        onClose={() => setMembersGroupId(null)}
        onSave={async (memberUserIds) => {
          const group = activityFeed.groups.find((g) => g.id === membersGroupId);
          if (!group) return;
          await activityFeed.setGroupMembers(group, memberUserIds);
        }}
      />

      <ConfirmModal
        isOpen={completeGroupConfirmOpen}
        onClose={() => {
          setCompleteGroupConfirmOpen(false);
          setGroupToCompleteId(null);
          setGroupToCompleteName('');
        }}
        onConfirm={() => {
          const group = projectCategoryGroups.find(g => g.id === groupToCompleteId);
          if (group) {
            activityFeed.completeGroup(group)
              .catch((err) => reportActivityError(err, 'اتمام کار دسته‌بندی با خطا مواجه شد.'));
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
          // The directory carries names and ids, which is all this modal's
          // picker renders — not the full account records.
          users={users as unknown as UserType[]}
          initialCustType={(quickAddCustomerTarget === 'financialContact' || quickAddCustomerTarget === 'technicalContact') ? 'حقیقی' : undefined}
          initialLinkedCustomerIds={((quickAddCustomerTarget === 'financialContact' || quickAddCustomerTarget === 'technicalContact') && customerId) ? [customerId] : undefined}
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              // The pickers were filled before this record existed, so pin it —
              // otherwise the field is set to an id the select has no option
              // for, and renders its placeholder as though nothing was created.
              if (quickAddType === 'customer') {
                customerPicker.include(newEntity);
                endUserPicker.include(newEntity);
                linkedContactsPicker.include(newEntity);
              } else if (quickAddType === 'product') {
                productPicker.include(newEntity);
              }
              if (quickAddType === 'customer') {
                if (quickAddCustomerTarget === 'customerId') {
                  setCustomerId(newEntity.id);
                } else if (quickAddCustomerTarget === 'endUser') {
                  // The id on the foreign key, the name beside it — the same
                  // pair the pickers write.
                  setEndUserId(newEntity.id);
                  setEndUser(newEntity.companyName
                    || `${newEntity.firstName || ''} ${newEntity.lastName || ''}`.trim());
                } else if (quickAddCustomerTarget === 'financialContact') {
                  setFinancialContactId(newEntity.id);
                  setFinancialContact(`${newEntity.firstName || ''} ${newEntity.lastName || ''}`.trim()
                    || newEntity.companyName || '');
                } else if (quickAddCustomerTarget === 'technicalContact') {
                  setTechnicalContactId(newEntity.id);
                  setTechnicalContact(`${newEntity.firstName || ''} ${newEntity.lastName || ''}`.trim()
                    || newEntity.companyName || '');
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
                  if (groupToDelete) {
                    activityFeed.deleteGroup(groupToDelete)
                      .catch((err) => reportActivityError(err, 'حذف دسته فعالیت با خطا مواجه شد.'));
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

      <SatisfactionLettersModal
        isOpen={showSatisfactionLetters}
        settings={settings}
        onClose={() => setShowSatisfactionLetters(false)}
      />
</div>
  );
}
