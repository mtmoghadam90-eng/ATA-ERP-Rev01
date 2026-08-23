import React, { useState, useEffect } from 'react';
import { ACTIVITY_CATEGORY } from '../utils/activityCategories';
import {
  Plus,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Edit,
  Trash2,
  FileSpreadsheet,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Globe,
  Maximize2,
  Minimize2,
  Printer,
  Loader2
} from 'lucide-react';
import { Transaction, Customer, Supplier, Project, ERPSettings, Proforma } from '../types';
import { getTodayShamsi } from '../dateUtils';
import { formatERPNumber, formatMoney } from '../numUtils';
import ShamsiDatePicker from './ShamsiDatePicker';
import CustomFieldsForm from './CustomFieldsForm';
import CustomFieldsDetailView from './CustomFieldsDetailView';
import ConfirmModal from './ConfirmModal';
import DeleteActivitiesOption from './DeleteActivitiesOption';
import QuickAddModal from './QuickAddModal';
import { SearchableSelect } from './SearchableSelect';
import { isFieldRequired, renderFieldLabelWithAsterisk } from '../utils/requiredFields';
import { buildCustomerOptions } from '../utils/customerLabel';
import { getContactInfoError } from '../utils/customerValidation';
import { getCodeError } from '../utils/documentCodes';
import type { DuplicateMatch } from '../utils/customerDuplicates';
import DuplicateCustomerModal from './DuplicateCustomerModal';
import { ApiError } from '../api/client';
import { detailToTransaction, rowToTransaction, transactionsApi, transactionToWriteInput } from '../api/transactions';
import { useTransactionList } from '../api/useTransactionList';
import { useList } from '../api/useList';
import { useEntitySearch } from '../api/useEntitySearch';
import type { CustomerRow } from '../api/customers';
import type { SupplierRow } from '../api/suppliers';
import type { ProjectRow } from '../api/projects';
import type { ProformaRow } from '../api/proformas';
import { suppliersApi, detailToSupplier, supplierToWriteInput } from '../api/suppliers';
import { projectsApi } from '../api/projects';
import type { ProjectFinanceRow } from '../api/projects';
import type { useCategoryCompletion } from '../api/useCategoryCompletion';
import { proformasApi } from '../api/proformas';
import { createCustomerWithLinks, findServerDuplicates } from '../api/customerAdapter';
import { projectToWriteInput, detailToProject } from '../api/projectAdapter';
import { detailToProforma, proformaToWriteInput } from '../api/proformaAdapter';
import NumberField from './NumberField';

/**
 * Transactions ledger and the per-project financial position.
 *
 * Reads through the API. Totals come from the server under the same filters as
 * the rows — a balance summed over one page of a ledger is simply wrong — and
 * the per-project financial figures are their own paginated query.
 */
interface TransactionsViewProps {
  initialPrintDocId?: string;
  onClearInitialPrintDocId?: () => void;
  settings: ERPSettings;
  /**
   * Offers to close the project's financial category once the customer has
   * settled in full. Optional, like every other module's, so the screen still
   * works without it.
   */
  categoryCompletion?: ReturnType<typeof useCategoryCompletion>;
}

export default function TransactionsView({
  initialPrintDocId,
  onClearInitialPrintDocId,
  settings,
  categoryCompletion,
}: TransactionsViewProps) {
  // Declared before the pickers below, which are disabled while it is closed.
  const [showModal, setShowModal] = useState(false);

  const list = useTransactionList();
  const search = list.search;
  const setSearch = list.setSearch;

  /** The page of entries, in the shape this screen's markup expects. */
  const transactions = React.useMemo(() => list.rows.map(rowToTransaction), [list.rows]);

  /**
   * The financial position per project — sold, received, remaining, settled.
   *
   * Its own paginated query: the rules behind it are intricate and the client
   * used to run them over every proforma and transaction it had loaded, once per
   * project.
   */
  const finance = useList<ProjectFinanceRow>({
    path: '/api/projects/finance',
    pageSize: 50,
    sort: 'code',
    order: 'desc',
  });


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
  const addCustomer = async (customer: Omit<Customer, 'id' | 'createdAt'>) => {
    try {
      return await createCustomerWithLinks(customer as any);
    } catch (err) {
      reportError(err, 'ثبت مشتری با خطا مواجه شد.');
      return null;
    }
  };

  const addSupplier = async (supplier: Omit<Supplier, 'id' | 'createdAt'>) => {
    try {
      const created = await suppliersApi.create(supplierToWriteInput(supplier as any));
      return detailToSupplier(created);
    } catch (err) {
      reportError(err, 'ثبت تأمین‌کننده با خطا مواجه شد.');
      return null;
    }
  };

  const addProject = async (project: Omit<Project, 'id' | 'code' | 'creationDate'>) => {
    try {
      const created = await projectsApi.create(projectToWriteInput(project as any));
      return detailToProject(created);
    } catch (err) {
      reportError(err, 'ثبت پروژه با خطا مواجه شد.');
      return null;
    }
  };

  /**
   * Sets one proforma's historical exchange rate.
   *
   * The whole record has to be loaded first. This screen only ever holds
   * proforma list rows, and a row has no line prices — writing one back to set
   * a single rate rewrote every line at zero and erased the document's pricing.
   */
  const saveProformaRate = async (proformaId: string, rate: number) => {
    try {
      const full = detailToProforma(await proformasApi.get(proformaId));
      const { items: _lines, ...withoutLines } = proformaToWriteInput({
        ...full,
        historicalExchangeRate: rate,
      });
      // The lines are deliberately not sent. An update that omits them leaves
      // the stored ones exactly as they are, which is what this screen wants —
      // and sending them back would put this rate change behind the
      // cost-of-goods check, on a screen with nowhere to enter a cost.
      await proformasApi.update(proformaId, withoutLines);
    } catch (err) {
      reportError(err, 'ثبت تغییرات پیش‌فاکتور با خطا مواجه شد.');
    }
  };

  /**
   * Offers to close the project's financial category once it is fully settled.
   *
   * Asked only after a confirmed receipt, and only when that receipt leaves
   * nothing to collect — a project is normally paid in instalments, so
   * prompting on every document would be noise rather than help.
   *
   * The position is read back from the server for this one project rather than
   * taken from `finance.rows`: that grid is paged, so the project just paid may
   * not be on the page in hand, and the figures there are from before the write
   * in any case. `remainingAmount` is null when a foreign sale has no stored
   * rate — unknown, which is not the same as settled, so it does not ask.
   */
  const promptCloseFinanceCategory = async (tx: Partial<Transaction>) => {
    if (!categoryCompletion) return;
    if (!tx.projectId) return;
    if (tx.type !== 'دریافت' || tx.status !== 'تأیید شده') return;

    try {
      const position = await projectsApi.finance(tx.projectId);
      if (position.salesAmount === null || position.salesAmount <= 0) return;
      if (position.remainingAmount === null || position.remainingAmount > 0) return;

      categoryCompletion.promptCompletion({
        projectId: tx.projectId,
        categoryName: ACTIVITY_CATEGORY.TRANSACTIONS,
        // No figure, deliberately: answering yes writes this sentence onto the
        // project timeline, which is read by anyone with the project — so an
        // amount here would publish what the cost permission withholds
        // elsewhere. That the project is settled is the fact worth recording;
        // the number is on the ledger.
        message:
          `با ثبت این دریافت، پروژه «${position.name}» به طور کامل تسویه شد.`
          + ' آیا می‌خواهید وضعیت دسته فعالیت مالی این پروژه را به «اتمام کار» تغییر دهید؟',
      });
    } catch (err) {
      // The receipt itself saved. Failing to *offer* to close a category is not
      // worth an alert over a document the user has already been told was
      // stored — so this is logged and swallowed.
      console.error('could not read the project financial position', err);
    }
  };

  const addTransaction = async (tx: Partial<Transaction>) => {
    try {
      await transactionsApi.create(transactionToWriteInput(tx));
      list.refresh();
      finance.refresh();
      await promptCloseFinanceCategory(tx);
    } catch (err) {
      reportError(err, 'ثبت تراکنش با خطا مواجه شد.');
    }
  };

  const updateTransaction = async (tx: Transaction) => {
    try {
      await transactionsApi.update(tx.id, transactionToWriteInput(tx));
      list.refresh();
      finance.refresh();
      // An edit can be what settles a project too — a draft confirmed, or an
      // amount corrected upwards.
      await promptCloseFinanceCategory(tx);
    } catch (err) {
      // A reversed entry and its reversal are frozen; the server says so.
      reportError(err, 'ثبت تغییرات تراکنش با خطا مواجه شد.');
    }
  };

  const [alsoRemoveActivities, setAlsoRemoveActivities] = useState(false);

  const deleteTransaction = async (id: string, removeActivities = false) => {
    try {
      await transactionsApi.remove(id, removeActivities);
      list.refresh();
      finance.refresh();
    } catch (err) {
      // A confirmed entry is corrected by a reversal, never deleted.
      reportError(err, 'حذف تراکنش با خطا مواجه شد.');
    }
  };

  const selectedType = list.filters.type;
  const setSelectedType = (value: string) => list.setFilter('type', value);
  const [isTransactionModalFullscreen, setIsTransactionModalFullscreen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [quickAddType, setQuickAddType] = useState<'customer' | 'project' | 'supplier' | 'product' | null>(null);

  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printTargetTx, setPrintTargetTx] = useState<Transaction | null>(null);

  /*
   * A document opened straight into its own window by id — see the same note on
   * the proforma and purchase-order screens. The page in hand is page one of
   * the ledger, so anything not on it opened nothing at all.
   */
  useEffect(() => {
    if (!initialPrintDocId) return;
    let cancelled = false;
    void (async () => {
      try {
        const full = detailToTransaction(await transactionsApi.get(initialPrintDocId));
        if (cancelled) return;
        setPrintTargetTx(full);
        setShowPrintModal(true);
      } catch (err) {
        console.error('could not load the transaction to print', err);
      }
    })();
    return () => { cancelled = true; };
  }, [initialPrintDocId]);

  // Dynamic Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [transactionToDeleteId, setTransactionToDeleteId] = useState<string | null>(null);
  const [transactionToDeleteDoc, setTransactionToDeleteDoc] = useState<string>('');

  // Form states
  const [type, setType] = useState<Transaction['type']>('دریافت');
  const [documentNumber, setDocumentNumber] = useState('');
  const [partyType, setPartyType] = useState<'customer' | 'supplier' | 'other'>('customer');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [partyNameManual, setPartyNameManual] = useState('');
  const [projectId, setProjectId] = useState('');
  const [amountRIYAL, setAmountRIYAL] = useState<number>(0);
  const [receiptType, setReceiptType] = useState<string>('');
  
  // New Connected Financial Fields
  const [proformaId, setProformaId] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number>(0);
  /**
   * Whether the settlement rate on screen was typed rather than filled in.
   *
   * Picking a proforma offers its historical rate; a rate the user entered is
   * their own decision about this settlement and survives a change of proforma.
   */
  const [rateTouched, setRateTouched] = useState(false);
  const [amountForeign, setAmountForeign] = useState<number>(0);
  const [isDirectForeign, setIsDirectForeign] = useState<boolean>(false);
  const [status, setStatus] = useState<Transaction['status']>('تأیید شده');
  /**
   * Legacy only: the reversal documents a previous version of this screen could
   * produce. Nothing issues one any more — a mistake is edited or deleted — but
   * an existing pair must keep behaving as it did, so the flag is still read off
   * a stored document and still exempts it from the overpayment check.
   */
  const [reversalOfTransactionId, setReversalOfTransactionId] = useState('');

  /** Pickers, searched on the server and idle while the form is closed. */
  const customerPicker = useEntitySearch<CustomerRow>({
    path: '/api/customers', limit: 25, enabled: showModal,
    selectedId: customerId || null,
    getLabel: (row) => row.companyName,
  });
  const supplierPicker = useEntitySearch<SupplierRow>({
    path: '/api/suppliers', limit: 25, enabled: showModal,
    selectedId: supplierId || null,
    getLabel: (row) => row.name,
  });
  const projectPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects', limit: 25, enabled: showModal,
    params: { withSummary: 'false' },
    selectedId: projectId || null,
    getLabel: (row) => row.name,
  });
  // Scoped to the chosen project on the server. It used to fetch a page of
  // proformas and filter it here, so a project whose proformas were not on that
  // page offered none of them.
  const proformaPicker = useEntitySearch<ProformaRow>({
    path: '/api/proformas', limit: 25, enabled: showModal,
    params: { projectId: projectId || undefined },
    selectedId: proformaId || null,
    getLabel: (row) => row.proformaNumber,
  });

  const customers = customerPicker.matches as unknown as Customer[];
  const suppliers = supplierPicker.matches as unknown as Supplier[];
  const projects = projectPicker.matches as unknown as Project[];
  const proformas = proformaPicker.matches as unknown as Proforma[];

  // Inline editing states for incomplete financial data
  const [editingHistoricalRates, setEditingHistoricalRates] = useState<Record<string, number>>({});
  const [editingSettlementRates, setEditingSettlementRates] = useState<Record<string, number>>({});

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
      setCustomerId(created.id);
      setShowQuickCustomerModal(false);
    }
  };
  const [quickCustType, setQuickCustType] = useState<'حقوقی' | 'حقیقی'>('حقوقی');
  const [quickCustName, setQuickCustName] = useState('');
  const [quickCustFirstName, setQuickCustFirstName] = useState('');
  const [quickCustLastName, setQuickCustLastName] = useState('');
  const [quickCustPhone, setQuickCustPhone] = useState('');
  const [quickCustEmail, setQuickCustEmail] = useState('');
  const [quickCustIndustry, setQuickCustIndustry] = useState('نفت و گاز');
  const [quickCustKeyPerson, setQuickCustKeyPerson] = useState('');
  const [quickCustPosition, setQuickCustPosition] = useState('');

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
  const [date, setDate] = useState(getTodayShamsi());
  const [paymentType, setPaymentType] = useState<Transaction['paymentType']>('حواله بانکی');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  /*
   * The ledger's totals, from the server.
   *
   * They were summed from `transactions` — the page in hand — over every
   * status, so the three cards showed the total of fifty rows rather than of
   * the ledger, and counted drafts and cancelled documents as money. The
   * endpoint totals the same query in SQL and leaves out the statuses that are
   * not money; `useTransactionList` has been fetching it all along.
   */
  const totalReceived = Number(list.summary?.receivedRial ?? 0);
  const totalPaid = Number(list.summary?.paidRial ?? 0);
  const netBalance = Number(list.summary?.balanceRial ?? 0);

  const [activeViewTab, setActiveViewTab] = useState<'transactions' | 'projectsSummary' | 'incompleteData'>('transactions');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>('all');

  // Helper mapping and calculations for projects using centralized finance utils
  // The financial position per project, computed server-side over that
  // project's own proformas and receipts — see summarizeProjectFinance. The
  // client used to run those rules over every record it had loaded, per project.
  const computedProjectSummaries = finance.rows;

  // Searched and filtered by the same query that produced them.
  const filteredProjectSummaries = computedProjectSummaries;

  // Totals across the page in hand. A null anywhere makes the total unknowable
  // rather than merely smaller: a foreign sale with no stored rate cannot be
  // valued at all, and adding zero for it would understate the figure.
  let totalProjSales: number | null = 0;
  let totalProjReceived = 0;
  let totalProjRemaining: number | null = 0;

  for (const p of computedProjectSummaries) {
    if (p.salesAmount === null) {
      totalProjSales = null;
    } else if (totalProjSales !== null) {
      totalProjSales += p.salesAmount;
    }

    totalProjReceived += p.paidAmount;

    if (p.remainingAmount === null) {
      totalProjRemaining = null;
    } else if (totalProjRemaining !== null) {
      totalProjRemaining += p.remainingAmount;
    }
  }

  // Find all proformas and transactions with incomplete historical or settlement rates
  const incompleteProformas = proformas.filter(pf => {
    // The outcome, not the workflow status: a proforma is a sale once its lines
    // are won, whatever stage the document itself is recorded at.
    const outcome = pf.outcomeStatus ?? pf.status;
    const isSale = outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
    return isSale && pf.currency && pf.currency !== 'ریال' && (!pf.historicalExchangeRate || pf.historicalExchangeRate <= 0);
  });

  const incompleteTransactions = transactions.filter(t => {
    if (t.type !== 'دریافت' || t.status === 'لغو شده' || t.status === 'پیش‌نویس' || !t.proformaId) return false;
    const linkedPf = proformas.find(pf => pf.id === t.proformaId);
    if (!linkedPf || linkedPf.currency === 'ریال') return false;
    return !t.exchangeRate || t.exchangeRate <= 0;
  });

  const hasAnyIncompleteData = incompleteProformas.length > 0 || incompleteTransactions.length > 0;

  const generateAutoDocNo = (
    currentType: Transaction['type'],
    currentPartyType: 'customer' | 'supplier' | 'other' = partyType,
    currCustomerId = customerId,
    currSupplierId = supplierId,
    currManualName = partyNameManual,
    currProjId = projectId
  ) => {
    const seqNum = (settings?.documentFormats?.transactionStartSeq || 1) + transactions.length;
    let name = '';
    if (currentPartyType === 'customer') {
      name = customers.find(c => c.id === currCustomerId)?.companyName || '';
    } else if (currentPartyType === 'supplier') {
      name = suppliers.find(s => s.id === currSupplierId)?.name || '';
    } else {
      name = currManualName;
    }
    const projCode = projects.find(p => p.id === currProjId)?.code || '';

    return formatERPNumber(
      settings?.documentFormats?.transactionFormat || 'TR-{TYPE}-{YYYY}{MM}-{SEQ:3}',
      {
        seq: seqNum,
        transactionType: currentType,
        customerName: currentPartyType === 'customer' ? name : undefined,
        supplierName: currentPartyType === 'supplier' ? name : undefined,
        projectCode: projCode
      }
    );
  };

  const handleSaveHistoricalRate = (pfId: string, rate: number) => {
    void saveProformaRate(pfId, rate);
  };

  /**
   * Sets one transaction's settlement rate.
   *
   * Loads the record first: this screen holds list rows, and a row has no notes
   * and no custom values, so writing one back to change a rate erased both.
   */
  const handleSaveSettlementRate = (tId: string, rate: number) => {
    void (async () => {
      try {
        const full = detailToTransaction(await transactionsApi.get(tId));
        await transactionsApi.update(
          tId,
          transactionToWriteInput({ ...full, exchangeRate: rate }),
        );
        list.refresh();
        finance.refresh();
      } catch (err) {
        reportError(err, 'ثبت تغییرات تراکنش با خطا مواجه شد.');
      }
    })();
  };

  const handleOpenAdd = () => {
    const initialCustId = customers[0]?.id || '';
    const initialSuppId = suppliers[0]?.id || '';
    
    setEditingTransaction(null);
    setPartyType('customer');
    setCustomerId(initialCustId);
    setSupplierId(initialSuppId);
    setPartyNameManual('');
    setProjectId('');
    setAmountRIYAL(0);
    setDate(getTodayShamsi());
    setPaymentType('حواله بانکی');
    setReferenceNumber('');
    setNotes('');
    setCustomValues({});
    setProformaId('');
    setExchangeRate(0);
    setRateTouched(false);
    setAmountForeign(0);
    setIsDirectForeign(false);
    setStatus('تأیید شده');
    setReversalOfTransactionId('');
    
    const initialReceiptTypes = settings?.dropdownItems?.receiptTypes || ['پیش پرداخت', 'میاندوره', 'تسویه'];
    setReceiptType(initialReceiptTypes[0] || '');
    
    const initialDocNo = generateAutoDocNo('دریافت', 'customer', initialCustId, initialSuppId, '', '');
    setDocumentNumber(initialDocNo);
    setShowModal(true);
  };

  /**
   * Loads the whole transaction before filling the form.
   *
   * A grid row carries no notes and no custom values, so populating the form
   * from one and saving wrote both back empty. The detail record is the only
   * shape this form may be filled from.
   */
  const handleOpenEdit = async (row: Transaction) => {
    let tr: Transaction;
    try {
      tr = detailToTransaction(await transactionsApi.get(row.id));
    } catch (err) {
      reportError(err, 'بارگذاری اطلاعات تراکنش با خطا مواجه شد.');
      return;
    }

    setEditingTransaction(tr);
    setType(tr.type);
    setReceiptType(tr.receiptType || '');
    setDocumentNumber(tr.documentNumber);

    if (tr.customerId) {
      setPartyType('customer');
      setCustomerId(tr.customerId);
    } else if (tr.supplierId) {
      setPartyType('supplier');
      setSupplierId(tr.supplierId);
    } else {
      // A party with no customer or supplier behind it is stored as a plain
      // name, which is what the manual field edits.
      setPartyType('other');
      setPartyNameManual((tr as unknown as { partyName?: string }).partyName || '');
    }

    setProjectId(tr.projectId || '');
    setAmountRIYAL(tr.amountRIYAL);
    setDate(tr.date);
    setPaymentType(tr.paymentType);
    setReferenceNumber(tr.referenceNumber || '');
    setNotes(tr.notes || '');
    setCustomValues(tr.customValues || {});

    // Connected Financial fields loading
    setProformaId(tr.proformaId || '');
    setExchangeRate(tr.exchangeRate || 0);
    // An existing document's rate is a decision already made.
    setRateTouched(!!tr.exchangeRate);
    setAmountForeign(tr.amountForeign || 0);
    setIsDirectForeign(tr.isDirectForeign || false);
    setStatus(tr.status || 'تأیید شده');
    setReversalOfTransactionId(tr.reversalOfTransactionId || '');

    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    // 1. شناسه تراکنش
    if (!documentNumber || documentNumber.trim() === '') {
      alert('شناسه تراکنش (شماره سند) نباید خالی باشد.');
      return;
    }

    // A financial voucher number must be unique
    const docNumberError = getCodeError(
      'transaction', documentNumber, transactions, 'documentNumber', editingTransaction?.id,
    );
    if (docNumberError) {
      alert(docNumberError);
      return;
    }

    // 2. تاریخ
    if (!date) {
      alert('تاریخ نباید خالی باشد.');
      return;
    }

    // The type is a pair of buttons rather than a field, so nothing native
    // enforces it. It always carries a value in practice; this is what makes
    // the asterisk beside it true rather than decorative.
    if (isFieldRequired(settings, 'transactions', 'type') && !type) {
      alert('نوع تراکنش مالی را مشخص کنید.');
      return;
    }

    // 4 & 5. شماره پیگیری برای حواله و چک
    if (isFieldRequired(settings, 'transactions', 'referenceNumber') && (!referenceNumber || referenceNumber.trim() === '')) {
      alert('شماره پیگیری مرجع / فیش بانکی الزامی است.');
      return;
    }

    // 6. مبلغ
    if (amountRIYAL <= 0 && amountForeign <= 0) {
      alert('مبلغ باید بیشتر از 0 باشد.');
      return;
    }

    /*
     * Checked here rather than with a `required` attribute.
     *
     * The rial box is a `NumberField` — a text input, because `type="number"`
     * cannot hold a decimal being typed — so the browser enforces nothing for
     * it, and "0" is not empty in any case. A control that draws the asterisk
     * and is not an `<input required>` needs its own check in the submit
     * handler, or the switch in settings does nothing.
     */
    if (isFieldRequired(settings, 'transactions', 'amountRIYAL') && amountRIYAL <= 0) {
      alert('مبلغ ریالی (یا معادل ریالی) الزامی است.');
      return;
    }

    // 10. نرخ تبدیل برای ارزی
    if (amountForeign > 0 && (!exchangeRate || exchangeRate <= 0)) {
      alert('برای دریافت ارزی، وارد کردن نرخ تسویه (حتی 1 برای دریافت مستقیم) الزامی است.');
      return;
    }

    // 8. پیش‌پرداخت بدون پروژه
    if (receiptType === 'پیش‌پرداخت' && !proformaId && !projectId) {
      alert('برای ثبت پیش‌پرداخت بدون اتصال به پیش‌فاکتور، انتخاب پروژه الزامی است.');
      return;
    }

    /*
     * A confirmed document's amount is editable, and that is the whole point.
     *
     * This refused any edit whose amount differed and told the user to issue a
     * reversal instead — a document the screen has no way to issue. Worse, it
     * fired when nothing had changed: a stored transaction with no foreign
     * amount carries `undefined` while the form holds `0`, so the comparison
     * was true on every single edit of every confirmed document, and the
     * message blamed a figure the user had not touched. The correction for a
     * wrong figure is the right figure; the audit log keeps both.
     */
    if (editingTransaction) {
      if (editingTransaction.status === 'لغو شده' || editingTransaction.status === 'برگشت شده') {
        alert('تراکنش لغو شده یا برگشت شده قابل ویرایش نیست.');
        return;
      }
    }

    // 7 & 11. Overpayment check
    if (type === 'دریافت' && proformaId && status !== 'لغو شده' && status !== 'برگشت شده' && !reversalOfTransactionId) {
      const pf = proformas.find(p => p.id === proformaId);
      if (pf) {
        // Calculate remaining manually or use computed summaries
        // To keep it simple, we use the computed remaining from pf
        const summary = computedProjectSummaries.find(p => p.id === pf.projectId)?.summary.proformas.find(p => p.proformaId === proformaId);
        if (summary) {
           let newAmountForeign = 0;
           if (amountForeign > 0) {
              if (isDirectForeign) {
                 newAmountForeign = amountForeign;
              } else {
                 newAmountForeign = exchangeRate > 0 ? (amountRIYAL / exchangeRate) : 0;
              }
           } else {
              newAmountForeign = pf.currency === 'ریال' ? amountRIYAL : (exchangeRate > 0 ? amountRIYAL / exchangeRate : 0);
           }
           
           // If we are editing, we should add back the old amount before checking
           let oldAmountForeign = 0;
           if (editingTransaction && editingTransaction.status === 'تأیید شده') {
              if (editingTransaction.amountForeign > 0) {
                 oldAmountForeign = editingTransaction.isDirectForeign ? editingTransaction.amountForeign : (editingTransaction.exchangeRate > 0 ? editingTransaction.amountRIYAL / editingTransaction.exchangeRate : 0);
              } else {
                 oldAmountForeign = pf.currency === 'ریال' ? editingTransaction.amountRIYAL : (editingTransaction.exchangeRate > 0 ? editingTransaction.amountRIYAL / editingTransaction.exchangeRate : 0);
              }
           }
           
           const actualRemaining = summary.remainingAmountForeign + oldAmountForeign;
           
           if (newAmountForeign > actualRemaining + 0.001) {
              const confirmOver = window.confirm('مبلغ دریافتی بیش از مانده پیش‌فاکتور است. آیا مطمئن هستید؟ (مبلغ مازاد به عنوان مبلغ تخصیص‌نیافته در سطح پروژه ذخیره خواهد شد)');
              if (!confirmOver) return;
           }
        }
      }
    }


    // Custom Fields Validation
    const moduleFields = (settings?.customFields || []).filter(f => f.module === 'transactions');
    for (const field of moduleFields) {
      if (field.required) {
        const val = customValues[field.id];
        if (val === undefined || val === null || val === '') {
          alert(`لطفاً فیلد سفارشی اجباری "${field.name}" را تکمیل کنید.`);
          return;
        }
      }
    }
    
    let resolvedPartyName = '';
    let resolvedCustomerId: string | undefined = undefined;
    let resolvedSupplierId: string | undefined = undefined;

    if (partyType === 'customer') {
      resolvedCustomerId = customerId;
      resolvedPartyName = customers.find(c => c.id === customerId)?.companyName || 'مشتری ناشناس';
    } else if (partyType === 'supplier') {
      resolvedSupplierId = supplierId;
      resolvedPartyName = suppliers.find(s => s.id === supplierId)?.name || 'تأمین‌کننده ناشناس';
    } else {
      resolvedPartyName = partyNameManual || 'متفرقه';
    }


    // Financial Transaction Over-Payment Protection Validation
    if (type === 'دریافت' && projectId) {
      const projSummary = computedProjectSummaries.find(p => p.id === projectId);
      if (projSummary) {
        const currentSales = projSummary.salesAmount || 0;
        /*
         * What the project has already received, from the server's own figure.
         *
         * This summed the receipts on the page in hand, which is one page of
         * the ledger — so on a project whose earlier receipts had scrolled off,
         * the warning simply never appeared. `paidAmount` is computed over the
         * project's whole history; the document being edited is taken back out
         * of it, since its new amount is about to be added.
         */
        const alreadyReceived = projSummary.paidAmount || 0;
        const ownPreviousAmount = editingTransaction && editingTransaction.projectId === projectId
          && editingTransaction.type === 'دریافت'
          ? editingTransaction.amountRIYAL
          : 0;
        const newTotal = alreadyReceived - ownPreviousAmount + amountRIYAL;
        if (currentSales > 0 && newTotal > currentSales) {
          const overAmount = newTotal - currentSales;
          const confirmProceed = window.confirm(
            `هشدار مغایرت حسابداری:\n` +
            `مجموع دریافتی‌های این پروژه با ثبت این تراکنش (${formatMoney(newTotal)} ریال) از کل مبلغ فروش پروژه (${formatMoney(currentSales)} ریال) بیشتر می‌شود!\n` +
            `مبلغ اضافی (مغایرت): ${formatMoney(overAmount)} ریال.\n\n` +
            `آیا مایل به ثبت این سند با وجود مغایرت هستید؟`
          );
          if (!confirmProceed) {
            return;
          }
        }
      }
    }

    // Draft Receipt Warning
    if (type === 'دریافت' && status === 'پیش‌نویس') {
      const confirmDraft = window.confirm(
        `هشدار وضعیت پیش‌نویس:\n` +
        `این سند دریافت در وضعیت «پیش‌نویس» ثبت می‌شود و تا زمان تایید نهایی در صورتحساب‌ها، پیش‌پرداخت‌ها و مانده بدهی مشتری منظور نخواهد شد.\n` +
        `آیا مایلید تراکنش را به صورت پیش‌نویس ثبت کنید؟`
      );
      if (!confirmDraft) {
        return;
      }
    }

    // Unassigned Receipt Warning
    if (type === 'دریافت' && projectId && !proformaId) {
      const approvedPfs = proformas.filter(pf => {
        const outcome = pf.outcomeStatus ?? pf.status;
        return pf.projectId === projectId
          && (outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده');
      });
      if (approvedPfs.length > 0) {
        const confirmUnallocated = window.confirm(
          `هشدار عدم تخصیص به پیش‌فاکتور:\n` +
          `پروژهِ انتخاب‌شده دارای ${approvedPfs.length} پیش‌فاکتور تایید شده است، اما این دریافت به هیچ پیش‌فاکتوری متصل نشده است.\n` +
          `عدم تخصیص دریافتی‌ها به پیش‌فاکتور باعث می‌شود تا فاکتورهای مشتری تسویه‌نشده باقی مانده و مغایرت حسابداری ایجاد شود.\n\n` +
          `آیا مایل به ثبت دریافت به صورت آزاد در سطح کل پروژه هستید؟`
        );
        if (!confirmUnallocated) {
          return;
        }
      }
    }

    const transactionPayload = {
      type,
      receiptType,
      documentNumber,
      customerId: resolvedCustomerId,
      supplierId: resolvedSupplierId,
      // The stored name of the other side. `customerName`/`supplierName` used
      // to be sent instead, which the write mapper does not read — so a party
      // typed by hand ("متفرقه") was never saved at all, and the grid had
      // nothing to show for it.
      partyName: resolvedPartyName,
      projectId: projectId || undefined,
      amountRIYAL,
      date,
      paymentType,
      referenceNumber,
      notes,
      customValues,
      proformaId: proformaId || undefined,
      exchangeRate: Number(exchangeRate || 0),
      amountForeign: Number(amountForeign || 0),
      isDirectForeign,
      status,
      reversalOfTransactionId: reversalOfTransactionId || undefined
    };

    if (editingTransaction) {
      updateTransaction({
        id: editingTransaction.id,
        ...transactionPayload
      });
    } else {
      addTransaction(transactionPayload);
    }

    setShowModal(false);
  };

  // The server searched, filtered by type, sorted and paged this already.
  const filteredTransactions = transactions;

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">دفتر صندوق و دریافتی/پرداختی</h1>
          <p className="text-slate-500 text-sm mt-1">رهگیری وجوه نقد ریالی دریافتی از مشتریان بابت پیش‌فاکتورها و حوالجات صادر شده به صرافی‌ها</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-sky-500/15 flex items-center gap-2"
        >
          <Plus size={16} />
          ثبت سند دریافت/پرداخت جدید
        </button>
      </div>

      {/* Financial Box Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs text-slate-400 font-bold">مجموع دریافتی‌های نقدی ریالی</p>
            <h4 className="text-lg font-extrabold text-emerald-600 font-mono">+{formatMoney(totalReceived)} <span className="text-xs font-normal">ریال</span></h4>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-500 rounded-xl">
            <ArrowDownLeft size={24} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs text-slate-400 font-bold">مجموع پرداخت‌های ریالی صندوق</p>
            <h4 className="text-lg font-extrabold text-red-600 font-mono">-{formatMoney(totalPaid)} <span className="text-xs font-normal">ریال</span></h4>
          </div>
          <div className="p-3 bg-red-50 text-red-500 rounded-xl">
            <ArrowUpRight size={24} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs text-slate-400 font-bold">تراز خالص صندوق (گردش مالی)</p>
            <h4 className={`text-lg font-extrabold font-mono ${netBalance >= 0 ? 'text-sky-700' : 'text-red-700'}`}>
              {formatMoney(netBalance)} <span className="text-xs font-normal">ریال</span>
            </h4>
          </div>
          <div className="p-3 bg-sky-50 text-sky-600 rounded-xl">
            <Coins size={24} />
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex border-b border-slate-100 bg-white p-1 rounded-xl shadow-sm gap-1 self-start">
        <button
          onClick={() => setActiveViewTab('transactions')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            activeViewTab === 'transactions'
              ? 'bg-sky-50 text-sky-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          دفتر ریز تراکنش‌های صندوق (دریافت/پرداخت)
        </button>
        <button
          onClick={() => setActiveViewTab('projectsSummary')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            activeViewTab === 'projectsSummary'
              ? 'bg-sky-50 text-sky-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          وضعیت تسویه مالی پروژه‌ها
        </button>
        <button
          onClick={() => setActiveViewTab('incompleteData')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
            activeViewTab === 'incompleteData'
              ? 'bg-amber-50 text-amber-700 shadow-sm border border-amber-200/50'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {hasAnyIncompleteData && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${hasAnyIncompleteData ? 'bg-red-500' : 'bg-slate-400'}`}></span>
          </span>
          تکمیل اطلاعات مالی ناقص
          {hasAnyIncompleteData && (
            <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
              {(incompleteProformas.length + incompleteTransactions.length).toLocaleString('fa-IR')}
            </span>
          )}
        </button>
      </div>

      {activeViewTab === 'transactions' ? (
        <>
          {/* Filter Ledger */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
            <div className="relative w-full md:flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="جستجو در شماره سند حسابداری، نام مخاطب یا شماره مرجع تراکنش..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
              />
            </div>

            <div className="relative w-full md:w-64 flex items-center gap-2">
              <Filter size={16} className="text-slate-400 flex-shrink-0" />
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
              >
                <option value="all">همه اسناد حسابداری</option>
                <option value="دریافت">دریافت‌ها (ورود وجه)</option>
                <option value="پرداخت">پرداخت‌ها (خروج وجه)</option>
              </select>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                    <th className="p-4 w-12 text-center">نوع</th>
                    <th className="p-4">شماره سند</th>
                    <th className="p-4">نام طرف حساب</th>
                    <th className="p-4">تاریخ ثبت</th>
                    <th className="p-4">شیوه پرداخت و کد مرجع</th>
                    <th className="p-4 text-left">مبلغ سند ریال</th>
                    <th className="p-4 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                  {filteredTransactions.map((t) => {
                    const isReceipt = t.type === 'دریافت';
                    // The row already carries the resolved name: the server
                    // joins the customer or supplier, and a hand-typed party is
                    // stored outright. Reading customerName/supplierName here
                    // meant every single row showed "متفرقه".
                    const partyName = t.partyName || 'متفرقه';

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/50 transition">
                        
                        {/* Type icon */}
                        <td className="p-4 text-center">
                          <span className={`p-1.5 rounded-lg flex items-center justify-center w-8 h-8 ${
                            isReceipt ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                          }`}>
                            {isReceipt ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                          </span>
                        </td>

                        {/* Doc No */}
                        <td className="p-4 font-mono font-bold text-slate-900">{t.documentNumber}</td>

                        {/* Party */}
                        <td className="p-4 font-semibold text-slate-800">
                          <div>{partyName}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {t.projectName && <span className="text-[10px] text-slate-400 font-normal">پروژه: {t.projectName}</span>}
                            {t.proformaId && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">پ.ف: {proformas.find(p => p.id === t.proformaId)?.proformaNumber || 'ناشناس'}</span>}
                            {t.receiptType && (
                              <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 text-[10px] rounded font-bold border border-sky-100">
                                {t.receiptType}
                              </span>
                            )}
                          </div>
                          <div className="mt-1">
                            <CustomFieldsDetailView
                              module="transactions"
                              customFields={settings?.customFields || []}
                              customValues={t.customValues}
                            />
                          </div>
                        </td>

                        {/* Date */}
                        <td className="p-4 font-mono">{t.date}</td>

                        {/* Payment Specs */}
                        <td className="p-4">
                          <div className="font-semibold text-slate-700">{t.paymentType}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">کد رهگیری: {t.referenceNumber || 'ندارد'}</div>
                        </td>

                        {/* Amount */}
                        <td className="p-4 text-left font-mono font-bold text-sm">
                          <span className={isReceipt ? 'text-emerald-600' : 'text-red-600'}>
                            {isReceipt ? '+' : '-'}{formatMoney(t.amountRIYAL)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal mr-1">ریال</span>
                        </td>

                        {/* Actions */}
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => { void handleOpenEdit(t); }}
                              className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition"
                              title="ویرایش سند"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => {
                                      setTransactionToDeleteId(t.id);
                                      setTransactionToDeleteDoc(t.documentNumber || '');
                                      setDeleteConfirmOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="حذف سند"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>

                      </tr>
                    );
                  })}

                  {/* Nothing to report before the first response — "none found"
                      while loading reads as an empty ledger. */}
                  {list.initialLoading && (
                    <tr>
                      <td colSpan={7} className="text-center p-12 text-slate-400 bg-white">
                        <Loader2 className="mx-auto text-slate-300 mb-3 animate-spin" size={36} />
                        در حال دریافت اطلاعات…
                      </td>
                    </tr>
                  )}
                  {list.error && !list.initialLoading && (
                    <tr>
                      <td colSpan={7} className="text-center p-12 bg-white">
                        <p className="text-sm text-rose-600 font-medium">{list.error}</p>
                        <button onClick={() => list.refresh()} className="mt-3 text-xs text-sky-600 hover:underline font-bold">
                          تلاش دوباره
                        </button>
                      </td>
                    </tr>
                  )}
                  {filteredTransactions.length === 0 && !list.initialLoading && !list.error && (
                    <tr>
                      <td colSpan={7} className="text-center p-12 text-slate-400 bg-white">
                        <FileSpreadsheet className="mx-auto text-slate-300 mb-3" size={40} />
                        هیچ تراکنشی یافت نشد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination. The ledger holds one page; these move between them. */}
              {list.totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex-wrap">
                  <span className="text-[11px] text-slate-500 font-medium">
                    نمایش {list.rows.length.toLocaleString('fa-IR')} از {list.total.toLocaleString('fa-IR')} تراکنش
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
      ) : activeViewTab === 'projectsSummary' ? (
        <div className="space-y-6">
          {/* Project Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between animate-fade-in">
              <div className="space-y-1">
                <p className="text-xs text-slate-400 font-bold">مجموع مبلغ فروش پروژه‌ها</p>
                <h4 className="text-lg font-extrabold text-slate-800 font-mono">
                  {totalProjSales !== null ? formatMoney(totalProjSales) : <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>} <span className="text-xs font-normal text-slate-500">ریال</span>
                </h4>
                <p className="text-[10px] text-slate-400">بر اساس پیش‌فاکتورهای تایید شده</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-500 rounded-xl">
                <FileSpreadsheet size={24} />
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between animate-fade-in">
              <div className="space-y-1">
                <p className="text-xs text-slate-400 font-bold">مجموع مبالغ دریافتی از پروژه‌ها</p>
                <h4 className="text-lg font-extrabold text-emerald-600 font-mono">
                  +{formatMoney(totalProjReceived)} <span className="text-xs font-normal">ریال</span>
                </h4>
                <p className="text-[10px] text-slate-400">کل وجوه دریافتی ثبت شده بابت پروژه‌ها</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-500 rounded-xl">
                <ArrowDownLeft size={24} />
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between animate-fade-in">
              <div className="space-y-1">
                <p className="text-xs text-slate-400 font-bold">مجموع مطالبات معوق (مانده طلب)</p>
                <h4 className="text-lg font-extrabold text-amber-600 font-mono">
                  {totalProjRemaining !== null ? formatMoney(totalProjRemaining) : <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>} <span className="text-xs font-normal">ریال</span>
                </h4>
                <p className="text-[10px] text-slate-400">مانده کل قابل وصول از پروژه‌ها</p>
              </div>
              <div className="p-3 bg-amber-50 text-amber-500 rounded-xl">
                <Coins size={24} />
              </div>
            </div>
          </div>

          {/* Project Summary Controls */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
            <div className="relative w-full md:flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="جستجو در کد پروژه، عنوان پروژه یا نام مشتری..."
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition text-right"
              />
            </div>

            <div className="relative w-full md:w-64 flex items-center gap-2">
              <Filter size={16} className="text-slate-400 flex-shrink-0" />
              <select
                value={projectStatusFilter}
                onChange={(e) => setProjectStatusFilter(e.target.value)}
                className="w-full border border-slate-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition appearance-none text-right bg-white"
              >
                <option value="all">همه وضعیت‌های پروژه‌ها</option>
                <option value="برنده (موفق)">برنده (موفق)</option>
                <option value="نیمه برنده">نیمه برنده</option>
                <option value="در حال مذاکره">در حال مذاکره</option>
                <option value="ارائه پیش‌فاکتور">ارائه پیش‌فاکتور</option>
                <option value="جدید">جدید</option>
              </select>
            </div>
          </div>

          {/* Project Summary Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                    <th className="p-4">کد و عنوان پروژه</th>
                    <th className="p-4">مشتری / کارفرما</th>
                    <th className="p-4 text-center">وضعیت پروژه</th>
                    <th className="p-4 text-left">مبلغ فروش (ریال)</th>
                    <th className="p-4 text-left">مبلغ دریافتی (ریال)</th>
                    <th className="p-4 text-left">مبلغ باقیمانده (ریال)</th>
                    <th className="p-4 text-center">درصد تسویه مالی</th>
                    <th className="p-4 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                  {filteredProjectSummaries.map((p) => {
                    let statusColor = 'bg-slate-100 text-slate-600';
                    if (p.status === 'برنده (موفق)') statusColor = 'bg-emerald-50 text-emerald-600 border border-emerald-200/50';
                    else if (p.status === 'نیمه برنده') statusColor = 'bg-teal-50 text-teal-600 border border-teal-200/50';
                    else if (p.status === 'در حال مذاکره') statusColor = 'bg-amber-50 text-amber-600 border border-amber-200/50';
                    else if (p.status === 'ارائه پیش‌فاکتور') statusColor = 'bg-blue-50 text-blue-600 border border-blue-200/50';
                    else if (p.status === 'باخته') statusColor = 'bg-red-50 text-red-600 border border-red-200/50';

                    const isExpanded = expandedProjectId === p.id;

                    return (
                      <React.Fragment key={p.id}>
                        <tr className="hover:bg-slate-50/50 transition">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedProjectId(isExpanded ? null : p.id)}
                                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition"
                                title="نمایش جزئیات مالی و تسعیر ارز"
                              >
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                              <div>
                                <div className="font-bold text-slate-800">{p.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                                  <span>{p.code}</span>
                                  {p.summary.hasIncompleteData && (
                                    <span className="inline-flex items-center gap-0.5 bg-red-50 text-red-600 px-1 py-0.5 rounded text-[8px] font-bold">
                                      <AlertTriangle size={8} />
                                      نیازمند تعیین نرخ
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-slate-700">{p.customerName}</div>
                          </td>
                          <td className="p-4 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${statusColor}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="p-4 text-left font-mono font-semibold text-slate-800">
                            {p.salesAmount !== null ? formatMoney(p.salesAmount) : <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>}
                          </td>
                          <td className="p-4 text-left font-mono font-semibold text-emerald-600">
                            {p.paidAmount > 0 ? `+${formatMoney(p.paidAmount)}` : '0'}
                          </td>
                          <td className="p-4 text-left font-mono font-bold text-amber-600">
                            {p.remainingAmount !== null ? formatMoney(p.remainingAmount) : <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>}
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col items-center gap-1 min-w-[100px]">
                              <span className="font-mono font-bold text-slate-600">{p.settlementPercent}%</span>
                              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all ${
                                    p.settlementPercent === 100 
                                      ? 'bg-emerald-500' 
                                      : p.settlementPercent > 50 
                                      ? 'bg-sky-500' 
                                      : p.settlementPercent > 0 
                                      ? 'bg-amber-500' 
                                      : 'bg-slate-200'
                                  }`}
                                  style={{ width: `${p.settlementPercent}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex items-center gap-1.5 justify-center">
                              <button
                                onClick={() => {
                                  setSearch(p.name);
                                  setSelectedType('all');
                                  setActiveViewTab('transactions');
                                }}
                                className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded text-[10px] font-bold transition flex items-center gap-1"
                                title="مشاهده تمام تراکنش‌های ثبت شده برای این پروژه"
                              >
                                <RefreshCw size={10} />
                                تراکنش‌ها
                              </button>
                              <button
                                onClick={() => setExpandedProjectId(isExpanded ? null : p.id)}
                                className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                                  isExpanded ? 'bg-slate-200 text-slate-700' : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                }`}
                              >
                                {isExpanded ? 'بستن جزئیات' : 'جزئیات مالی'}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50/55">
                            <td colSpan={8} className="p-4 border-t border-slate-100">
                              <div className="bg-white rounded-xl border border-slate-200/60 p-5 shadow-sm space-y-4 animate-fade-in text-right">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-2 border-b border-slate-100 gap-2">
                                  <h4 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-2">
                                    <Globe size={16} className="text-sky-500 animate-pulse" />
                                    جزئیات حسابداری ارزی و تسعیر پروژه {p.name}
                                  </h4>
                                  <div className="text-[10px] sm:text-xs text-slate-500">
                                    جمع مانده ارزی پروژه:{' '}
                                    <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded">
                                      {Object.entries(p.summary.currencyBalances).length > 0 
                                        ? Object.entries(p.summary.currencyBalances)
                                            .map(([cur, amt]) => `${formatMoney(amt)} ${cur}`)
                                            .join(' ، ')
                                        : 'فاقد مانده ارزی'}
                                    </span>
                                  </div>
                                </div>

                                {/* Currency Financial stats */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100/80">
                                    <div className="text-[10px] text-slate-400 font-bold">سود یا زیان تسعیر تحقق‌یافته</div>
                                    <div className={`text-xs sm:text-sm font-extrabold font-mono mt-1 ${p.summary.totalRealizedGainLoss === null ? 'text-red-500' : p.summary.totalRealizedGainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {p.summary.totalRealizedGainLoss !== null ? (
                                        <>
                                          {p.summary.totalRealizedGainLoss >= 0 ? '+' : ''}
                                          {formatMoney(p.summary.totalRealizedGainLoss)} <span className="text-[10px] font-normal">ریال</span>
                                        </>
                                      ) : (
                                        <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>
                                      )}
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-0.5">سود/زیان مابه‌التفاوت نرخ وصولی و فروش</div>
                                  </div>

                                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100/80">
                                    <div className="text-[10px] text-slate-400 font-bold">سود یا زیان تسعیر تحقق‌نیافته</div>
                                    <div className={`text-xs sm:text-sm font-extrabold font-mono mt-1 ${p.summary.totalUnrealizedGainLoss === null ? 'text-red-500' : p.summary.totalUnrealizedGainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {p.summary.totalUnrealizedGainLoss !== null ? (
                                        <>
                                          {p.summary.totalUnrealizedGainLoss >= 0 ? '+' : ''}
                                          {formatMoney(p.summary.totalUnrealizedGainLoss)} <span className="text-[10px] font-normal">ریال</span>
                                        </>
                                      ) : (
                                        <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>
                                      )}
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-0.5">تغییر ارزش مطالبات وصول‌نشده به نرخ روز</div>
                                  </div>

                                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100/80">
                                    <div className="text-[10px] text-slate-400 font-bold">پیش‌پرداخت / مبالغ تخصیص‌نیافته</div>
                                    <div className="text-xs sm:text-sm font-extrabold text-blue-600 font-mono mt-1">
                                      {formatMoney(p.summary.totalUnallocatedRiyal)} <span className="text-[10px] font-normal">ریال</span>
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-0.5">دریافتی‌های مازاد ریالی متصل به پروژه</div>
                                  </div>

                                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100/80">
                                    <div className="text-[10px] text-slate-400 font-bold">وضعیت صحت اطلاعات ارزی</div>
                                    <div className={`text-[11px] font-bold mt-1.5 ${p.summary.hasIncompleteData ? 'text-red-500' : 'text-emerald-600'}`}>
                                      {p.summary.hasIncompleteData ? '⚠️ نیازمند اصلاح نرخ تاریخی' : '✓ اطلاعات مالی کامل'}
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-0.5">وجود یا فقدان نرخ برابری روز/تاریخی</div>
                                  </div>
                                </div>

                                {/* Proformas subtable */}
                                {p.summary.proformas.length > 0 && (
                                  <div className="space-y-1.5">
                                    <h5 className="font-bold text-[10px] text-slate-500">پیش‌فاکتورهای قطعی ارزی و ریالی پروژه</h5>
                                    <div className="border border-slate-100 rounded-lg overflow-hidden">
                                      <table className="w-full text-right border-collapse text-[10px] sm:text-[11px]">
                                        <thead>
                                          <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                            <th className="p-2">شماره پیش‌فاکتور</th>
                                            <th className="p-2 text-center">ارز مبنا</th>
                                            <th className="p-2 text-left">مبلغ اصلی ارزی</th>
                                            <th className="p-2 text-left">نرخ فروش تاریخی</th>
                                            <th className="p-2 text-left">فروش تاریخی (ریال)</th>
                                            <th className="p-2 text-left">تسویه شده ارزی</th>
                                            <th className="p-2 text-left">دریافتی واقعی (ریال)</th>
                                            <th className="p-2 text-left">مانده طلب ارزی</th>
                                            <th className="p-2 text-left">ارزش روز مانده (ریال)</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {p.summary.proformas.map((rep) => (
                                            <tr key={rep.proformaId} className="hover:bg-slate-50/50">
                                              <td className="p-2 font-bold text-slate-700">{rep.proformaNumber}</td>
                                              <td className="p-2 text-center text-emerald-700 font-bold">{rep.currency}</td>
                                              <td className="p-2 text-left font-mono">{formatMoney(rep.salesAmountForeign)}</td>
                                              <td className="p-2 text-left font-mono text-slate-500">
                                                {rep.missingHistoricalRate ? (
                                                  <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded">⚠️ نامشخص</span>
                                                ) : (
                                                  formatMoney(rep.historicalExchangeRate)
                                                )}
                                              </td>
                                              <td className="p-2 text-left font-mono">{rep.salesAmountHistoricalRiyal !== null ? formatMoney(rep.salesAmountHistoricalRiyal) : <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>}</td>
                                              <td className="p-2 text-left font-mono text-emerald-600">{formatMoney(rep.settledAmountForeign)}</td>
                                              <td className="p-2 text-left font-mono text-emerald-600">{formatMoney(rep.actualReceivedRiyal)}</td>
                                              <td className="p-2 text-left font-mono font-bold text-amber-600">{formatMoney(rep.remainingAmountForeign)}</td>
                                              <td className="p-2 text-left font-mono font-bold text-amber-600">{rep.remainingAmountCurrentRiyal !== null ? formatMoney(rep.remainingAmountCurrentRiyal) : <span className="text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded text-[10px]">⚠️ نامشخص</span>}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {filteredProjectSummaries.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-12 text-slate-400 bg-white">
                        <FileSpreadsheet className="mx-auto text-slate-300 mb-3" size={40} />
                        هیچ پروژه‌ای یافت نشد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header section explaining */}
          <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5 text-right space-y-2 animate-fade-in">
            <h3 className="font-bold text-amber-800 text-sm flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-600 animate-bounce" />
              مدیریت و تکمیل اطلاعات مالی ناقص (نرخ‌های تسعیر ارز)
            </h3>
            <p className="text-xs text-amber-700 leading-relaxed">
              بر اساس اصول حسابداری، کلیه اسناد ارزی (پیش‌فاکتورهای قطعی و دریافت‌های صندوق) باید دارای نرخ برابری ارز (ریال) مشخص در زمان ثبت سند باشند تا گزارشات سود و زیان تسعیر و مانده مطالبات معوق بدون خطای محاسباتی مدیریت شوند. در این بخش می‌توانید نرخ‌های نامشخص تاریخی را تکمیل نمایید.
            </p>
          </div>

          {/* Section 1: Incomplete Proformas (Historical Rates) */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h4 className="font-bold text-slate-800 text-xs sm:text-sm">پیش‌فاکتورهای ارزی نیازمند تعیین نرخ فروش تاریخی</h4>
              <span className="bg-red-100 text-red-600 text-[10px] px-2 py-1 rounded-full font-bold">
                {incompleteProformas.length.toLocaleString('fa-IR')} مورد
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/55 text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-3">شماره و تاریخ پیش‌فاکتور</th>
                    <th className="p-3">پروژه مربوطه</th>
                    <th className="p-3">مشتری</th>
                    <th className="p-3 text-center">ارز</th>
                    <th className="p-3 text-left">مبلغ ارزی</th>
                    <th className="p-3 text-center w-60">نرخ برابری تاریخی (ریال)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incompleteProformas.map(pf => {
                    const rateVal = editingHistoricalRates[pf.id] ?? '';
                    const linkedProj = projects.find(pr => pr.id === pf.projectId);
                    return (
                      <tr key={pf.id} className="hover:bg-slate-50/50">
                        <td className="p-3">
                          <div className="font-bold text-slate-800">{pf.proformaNumber}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{pf.issueDate}</div>
                        </td>
                        <td className="p-3 text-slate-600">{linkedProj?.name || 'فاقد پروژه'}</td>
                        <td className="p-3 text-slate-600">{pf.customerName}</td>
                        <td className="p-3 text-center font-bold text-emerald-700">{pf.currency}</td>
                        <td className="p-3 text-left font-mono text-slate-700">{formatMoney(pf.finalAmount)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2 justify-center">
                            <input
                              type="number"
                              value={rateVal}
                              placeholder="نرخ ریالی، مثلاً ۶۰۰,۰۰۰"
                              onChange={(e) => setEditingHistoricalRates({
                                ...editingHistoricalRates,
                                [pf.id]: Number(e.target.value)
                              })}
                              className="w-40 border border-slate-200 rounded px-2.5 py-1 text-center font-mono text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
                            />
                            <button
                              disabled={!rateVal}
                              onClick={() => {
                                handleSaveHistoricalRate(pf.id, Number(rateVal));
                                setEditingHistoricalRates(prev => {
                                  const updated = { ...prev };
                                  delete updated[pf.id];
                                  return updated;
                                });
                              }}
                              className="px-3 py-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded text-xs font-bold transition shadow-sm"
                            >
                              ذخیره
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {incompleteProformas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-emerald-600 bg-white font-bold">
                        ✓ عالی! کلیه پیش‌فاکتورها دارای نرخ فروش تاریخی معتبر می‌باشند.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Incomplete Transactions (Settlement Rates) */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h4 className="font-bold text-slate-800 text-xs sm:text-sm">دریافتی‌های ارزی صندوق نیازمند تعیین نرخ تسویه</h4>
              <span className="bg-red-100 text-red-600 text-[10px] px-2 py-1 rounded-full font-bold">
                {incompleteTransactions.length.toLocaleString('fa-IR')} مورد
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/55 text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-3">شماره سند و تاریخ دریافت</th>
                    <th className="p-3">پیش‌فاکتور متصل</th>
                    <th className="p-3">پروژه مربوطه</th>
                    <th className="p-3">مشتری</th>
                    <th className="p-3 text-left">مبلغ دریافتی ریالی</th>
                    <th className="p-3 text-center w-60">نرخ تسویه (برابری ریال در دریافت)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incompleteTransactions.map(t => {
                    const rateVal = editingSettlementRates[t.id] ?? '';
                    const linkedPf = proformas.find(pf => pf.id === t.proformaId);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/50">
                        <td className="p-3">
                          <div className="font-bold text-slate-800">{t.documentNumber}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{t.date}</div>
                        </td>
                        <td className="p-3 font-bold text-slate-700">{linkedPf?.proformaNumber || 'ناشناس'}</td>
                        <td className="p-3 text-slate-600">{t.projectName}</td>
                        <td className="p-3 text-slate-600">{t.customerName}</td>
                        <td className="p-3 text-left font-mono text-slate-700">{formatMoney(t.amountRIYAL)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2 justify-center">
                            <input
                              type="number"
                              value={rateVal}
                              placeholder="نرخ تسویه، مثلاً ۶۱۰,۰۰۰"
                              onChange={(e) => setEditingSettlementRates({
                                ...editingSettlementRates,
                                [t.id]: Number(e.target.value)
                              })}
                              className="w-40 border border-slate-200 rounded px-2.5 py-1 text-center font-mono text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
                            />
                            <button
                              disabled={!rateVal}
                              onClick={() => {
                                handleSaveSettlementRate(t.id, Number(rateVal));
                                setEditingSettlementRates(prev => {
                                  const updated = { ...prev };
                                  delete updated[t.id];
                                  return updated;
                                });
                              }}
                              className="px-3 py-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded text-xs font-bold transition shadow-sm"
                            >
                              ذخیره
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {incompleteTransactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-emerald-600 bg-white font-bold">
                        ✓ عالی! کلیه تراکنش‌های دریافتی ارزی دارای نرخ تسویه معتبر می‌باشند.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 overflow-y-auto ${isTransactionModalFullscreen ? 'p-0' : 'p-2 sm:p-4'}`}>
          <div className={`bg-white shadow-xl border border-slate-100 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
            isTransactionModalFullscreen 
              ? 'w-screen h-screen rounded-none my-0 max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-xl my-4 max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)]'
          }`}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                {editingTransaction ? 'ویرایش سند دریافت / پرداخت صندوق' : 'ثبت سند دریافت / پرداخت صندوق'}
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setIsTransactionModalFullscreen(!isTransactionModalFullscreen)} 
                  className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title={isTransactionModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isTransactionModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowModal(false); setEditingTransaction(null); setIsTransactionModalFullscreen(false); }} 
                  className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
                  title="بستن فرم"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-4 text-right overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                {/* Transaction Type */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'transactions', 'type', 'نوع تراکنش مالی')}</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => { 
                        setType('دریافت'); 
                        setPartyType('customer'); 
                        const code = generateAutoDocNo('دریافت', 'customer');
                        setDocumentNumber(code);
                      }}
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-xs transition ${
                        type === 'دریافت' 
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800' 
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <ArrowDownLeft size={16} />
                      <span>دریافت وجه (ورود نقدینگی)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { 
                        setType('پرداخت'); 
                        setPartyType('supplier'); 
                        const code = generateAutoDocNo('پرداخت', 'supplier');
                        setDocumentNumber(code);
                      }}
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-xs transition ${
                        type === 'پرداخت' 
                          ? 'border-red-500 bg-red-50 text-red-800' 
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <ArrowUpRight size={16} />
                      <span>پرداخت وجه (خروج نقدینگی)</span>
                    </button>
                  </div>
                </div>

                {/* Doc No */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 flex justify-between items-center">
                    <span>{renderFieldLabelWithAsterisk(settings, 'transactions', 'documentNumber', 'شماره سند مالی')}</span>
                    <button
                      type="button"
                      onClick={() => setDocumentNumber(generateAutoDocNo(type))}
                      className="text-[10px] text-sky-600 hover:text-sky-700 font-bold flex items-center gap-0.5 transition"
                    >
                      <RefreshCw size={10} />
                      فرموله ساز
                    </button>
                  </label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'transactions', 'documentNumber')}
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-left"
                  />
                </div>

                {/* Date */}
                <div className="space-y-1.5" id="transaction-date-picker-wrapper">
                  <ShamsiDatePicker
                    label={renderFieldLabelWithAsterisk(settings, 'transactions', 'date', 'تاریخ تراکنش')}
                    required={isFieldRequired(settings, 'transactions', 'date')}
                    value={date}
                    onChange={(val) => setDate(val)}
                  />
                </div>

                {/* Party selection type */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">ماهیت طرف حساب</label>
                  <div className="flex gap-4 p-2 bg-slate-50 rounded-lg border border-slate-100">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="partyType"
                        checked={partyType === 'customer'}
                        onChange={() => setPartyType('customer')}
                        className="text-sky-500 focus:ring-sky-500"
                      />
                      <span>مشتریان داخلی</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="partyType"
                        checked={partyType === 'supplier'}
                        onChange={() => setPartyType('supplier')}
                        className="text-sky-500 focus:ring-sky-500"
                      />
                      <span>تأمین‌کنندگان خارجی / داخلی</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="partyType"
                        checked={partyType === 'other'}
                        onChange={() => setPartyType('other')}
                        className="text-sky-500 focus:ring-sky-500"
                      />
                      <span>متفرقه (گمرک، گمرکچی، غیره)</span>
                    </label>
                  </div>
                </div>

                {/* Target customer select */}
                {partyType === 'customer' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-500">انتخاب مشتری *</label>
                    <div className="flex gap-1.5 items-center">
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={customerId}
                      onChange={(val) => setCustomerId(val)}
                      required
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
                          onClick={() => setQuickAddType('customer')}
                          className="px-2.5 py-2 text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 hover:border-sky-300 transition shrink-0 flex items-center justify-center font-bold"
                          title="تعریف سریع مشتری جدید"
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Target supplier select */}
                {partyType === 'supplier' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-500">انتخاب تأمین‌کننده *</label>
                    <div className="flex gap-1.5 items-center">
                      <SearchableSelect wrapperClassName="flex-1 min-w-0"
                        value={supplierId}
                        onChange={(val) => setSupplierId(val)}
                        required
                        onSearchChange={supplierPicker.setTerm}
                        loading={supplierPicker.loading}
                        options={[
                          { value: '', label: '-- انتخاب تأمین‌کننده --' },
                          ...suppliers.map(s => ({ value: s.id, label: `${s.name} (${s.country})` }))
                        ]}
                        placeholder="-- انتخاب تأمین‌کننده --"
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
                )}

                {/* Party name manually */}
                {partyType === 'other' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-500">نام طرف حساب متفرقه *</label>
                    <input
                      type="text"
                      required
                      value={partyNameManual}
                      onChange={(e) => setPartyNameManual(e.target.value)}
                      placeholder="مثال: ترخیص کار بندرعباس - محسنی"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                    />
                  </div>
                )}

                {/*
                  Bottom-aligned, because two of these labels wrap and one does
                  not: «مبلغ ریالی (یا معادل ریالی)» takes two lines while its
                  neighbour takes one, and the taller cell pushed its own box
                  down so the row stopped reading as a row.
                */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'transactions', 'amountRIYAL', 'مبلغ ریالی (یا معادل ریالی)')}</label>
                    {/* Money, so NumberField: see src/utils/numberInput.ts. */}
                    <NumberField
                      min={0}
                      value={amountRIYAL}
                      onChange={setAmountRIYAL}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-left"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">مبلغ ارزی (در صورت وجود)</label>
                    <NumberField
                      min={0}
                      value={amountForeign}
                      onChange={(val) => {
                        setAmountForeign(val);
                        if (exchangeRate > 0) {
                          setAmountRIYAL(val * exchangeRate);
                        }
                      }}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-left"
                    />
                  </div>
                  
                  {amountForeign > 0 && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">نرخ تبدیل / تسویه *</label>
                        <NumberField
                          min={0}
                          value={exchangeRate}
                          onChange={(val) => {
                            setExchangeRate(val);
                            setRateTouched(true);
                            if (amountForeign > 0) {
                              setAmountRIYAL(amountForeign * val);
                            }
                          }}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-left"
                        />
                      </div>
                      
                      <div className="space-y-1.5 flex items-end">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 w-full cursor-pointer h-[38px]">
                          <input
                            type="checkbox"
                            checked={isDirectForeign}
                            onChange={(e) => setIsDirectForeign(e.target.checked)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span>دریافت مستقیم ارزی است</span>
                        </label>
                      </div>
                    </>
                  )}
                </div>

                {/* Receipt Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'transactions', 'receiptType', 'بابت / نوع دریافت و پرداخت')}</label>
                  <select
                    value={receiptType}
                    onChange={(e) => setReceiptType(e.target.value)}
                    required={isFieldRequired(settings, 'transactions', 'receiptType')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white"
                  >
                    <option value="">-- انتخاب بابت تراکنش --</option>
                    {(settings?.dropdownItems?.receiptTypes || ['پیش پرداخت', 'میاندوره', 'تسویه']).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                {/* Linked Project */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">مرتبط با پروژه (اختیاری)</label>
                  <div className="flex gap-1.5 items-center">
                    <SearchableSelect wrapperClassName="flex-1 min-w-0"
                      value={projectId}
                      onChange={(val) => {
                        const projId = val;
                        setProjectId(projId);
                        setProformaId(''); // Reset proforma selection when project changes
                        if (projId) {
                          const proj = projects.find(p => p.id === projId);
                          if (proj && proj.customerId) {
                            setPartyType('customer');
                            setCustomerId(proj.customerId);
                          }
                        }
                      }}
                      onSearchChange={projectPicker.setTerm}
                      loading={projectPicker.loading}
                      options={[
                        { value: '', label: '-- فاقد پروژه (صندوق عمومی) --' },
                        ...projects.map(p => ({ value: p.id, label: `${p.name} (${p.code})` }))
                      ]}
                      placeholder="-- فاقد پروژه (صندوق عمومی) --"
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
                </div>

                {/* Linked Proforma */}
                {projectId && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500">پیش‌فاکتور مرتبط (اختیاری)</label>
                    <SearchableSelect
                      value={proformaId}
                      onChange={(val) => {
                        setProformaId(val);
                        /*
                         * The settlement rate starts at the rate the proforma
                         * was priced at.
                         *
                         * It always came out empty: the picker holds list rows
                         * and the row did not carry `historicalExchangeRate`,
                         * so this read `undefined` and wrote 0 every time. The
                         * column is on the row now. Picking a proforma is an
                         * explicit act, so it fills the box — unless the user
                         * has typed a rate for this document themselves, which
                         * is a settlement rate of their own and not ours to
                         * overwrite.
                         */
                        const pf = proformas.find(p => p.id === val);
                        if (rateTouched) return;
                        if (pf && pf.currency && pf.currency !== 'ریال') {
                          setExchangeRate(pf.historicalExchangeRate || 0);
                        }
                      }}
                      onSearchChange={proformaPicker.setTerm}
                      loading={proformaPicker.loading}
                      options={[
                        { value: '', label: '-- فاقد پیش‌فاکتور (آزاد در سطح پروژه) --' },
                        ...proformas
                          .map(pf => ({
                            value: pf.id,
                            label: `${pf.proformaNumber} (${pf.currency || 'ریال'}) - مبلغ: ${formatMoney(pf.finalAmount)}`
                          }))
                      ]}
                      placeholder="-- انتخاب پیش‌فاکتور --"
                    />
                  </div>
                )}

                {/* Payment Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'transactions', 'paymentType', 'شیوه پرداخت')}</label>
                  <select
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value as Transaction['paymentType'])}
                    required={isFieldRequired(settings, 'transactions', 'paymentType')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white"
                  >
                    <option value="حواله بانکی">حواله بانکی (پایا/ساتنا)</option>
                    <option value="چک">چک صیادی رسمی</option>
                    <option value="کارت به کارت">کارت به کارت شتابی</option>
                    <option value="نقدی">نقدی صندوق</option>
                  </select>
                </div>

                {/* Reference Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500">{renderFieldLabelWithAsterisk(settings, 'transactions', 'referenceNumber', 'کد پیگیری مرجع / فیش بانکی')}</label>
                  <input
                    type="text"
                    required={isFieldRequired(settings, 'transactions', 'referenceNumber')}
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="مثال: 876125419"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-left"
                  />
                </div>

                {/* Notes */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-500">توضیحات تکمیلی سند</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="بابت قسط اول پیش‌پرداخت، علی‌الحساب گمرک..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                  />
                </div>

                {/* Dynamic Custom Fields Form Section */}
                <div className="sm:col-span-2">
                  <CustomFieldsForm
                    module="transactions"
                    customFields={settings?.customFields || []}
                    customValues={customValues}
                    onChange={setCustomValues}
                  />
                </div>

              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setIsTransactionModalFullscreen(false); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition"
                >
                  {editingTransaction ? 'ثبت تغییرات سند' : 'ثبت قطعی در دفاتر حسابداری'}
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
          setTransactionToDeleteId(null);
          setTransactionToDeleteDoc('');
          setAlsoRemoveActivities(false);
        }}
        onConfirm={() => {
          if (transactionToDeleteId) {
            void deleteTransaction(transactionToDeleteId, alsoRemoveActivities);
          }
          setAlsoRemoveActivities(false);
        }}
        title="حذف سند مالی"
        message={
          `سند «${transactionToDeleteDoc}» حذف شود؟`
          + ' مبلغ آن از مانده صندوق و از مانده پروژه‌ی مرتبط برداشته می‌شود.'
          + ' این کار قابل بازگشت نیست، ولی سند حذف‌شده با تمام جزئیاتش در «سابقه اقدامات» باقی می‌ماند.'
        }
      >
        <DeleteActivitiesOption
          checked={alsoRemoveActivities}
          onChange={setAlsoRemoveActivities}
          what="این سند مالی"
        />
      </ConfirmModal>

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
                  onClick={() => setQuickCustType('حقوقی')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${
                    quickCustType === 'حقوقی'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  حقوقی (شرکت/سازمان)
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCustType('حقیقی')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${
                    quickCustType === 'حقیقی'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  حقیقی (شخصی)
                </button>
              </div>

              {quickCustType === 'حقوقی' ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">نام شرکت / سازمان *</label>
                    <input
                      type="text"
                      value={quickCustName}
                      onChange={(e) => setQuickCustName(e.target.value)}
                      placeholder="مثال: فولاد خوزستان"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">رابط / شخص کلیدی</label>
                    <input
                      type="text"
                      value={quickCustKeyPerson}
                      onChange={(e) => setQuickCustKeyPerson(e.target.value)}
                      placeholder="مثال: مهندس احمدی"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-500">صنعت</label>
                    <select
                      value={quickCustIndustry}
                      onChange={(e) => setQuickCustIndustry(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      {(settings.dropdownItems?.industries || ['نفت و گاز', 'فولاد و معادن', 'پتروشیمی', 'نیروگاهی', 'سیمان', 'آب و فاضلاب', 'غذایی و دارویی', 'سایر']).map((ind, idx) => (
                        <option key={idx} value={ind}>{ind}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-500">نام *</label>
                      <input
                        type="text"
                        value={quickCustFirstName}
                        onChange={(e) => setQuickCustFirstName(e.target.value)}
                        placeholder="مثال: محمد"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-500">نام خانوادگی *</label>
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
                    <label className="text-[11px] font-bold text-slate-500">سمت</label>
                    <select
                      value={quickCustPosition}
                      onChange={(e) => setQuickCustPosition(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      <option value="">انتخاب کنید...</option>
                      {(settings.dropdownItems?.positions || ['مدیرعامل', 'مدیر بازرگانی', 'کارشناس خرید', 'مدیر فنی', 'کارشناس ابزار دقیق', 'سایر']).map((pos, idx) => (
                        <option key={idx} value={pos}>{pos}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">شماره تلفن</label>
                  <input
                    type="text"
                    value={quickCustPhone}
                    onChange={(e) => setQuickCustPhone(e.target.value)}
                    placeholder="۰۲۱-۸۸XXXXXX"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-left font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500">پست الکترونیک</label>
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
                  if (quickCustType === 'حقوقی' && !quickCustName.trim()) {
                    alert('لطفاً نام شرکت را وارد کنید.');
                    return;
                  }
                  if (quickCustType === 'حقیقی' && (!quickCustFirstName.trim() || !quickCustLastName.trim())) {
                    alert('لطفاً نام و نام خانوادگی را وارد کنید.');
                    return;
                  }

                  const quickContactError = getContactInfoError({ phone: quickCustPhone, email: quickCustEmail });
                  if (quickContactError) {
                    alert(quickContactError);
                    return;
                  }

                  const custData: any = {
                    type: quickCustType,
                    status: 'فعال',
                    phone: quickCustPhone,
                    mobile: '',
                    email: quickCustEmail,
                    province: '',
                    address: '',
                    notes: 'تعریف شده به صورت سریع از بخش تراکنش‌ها',
                    tags: '',
                    linkedCustomerIds: []
                  };

                  if (quickCustType === 'حقوقی') {
                    custData.companyName = quickCustName;
                    custData.industry = quickCustIndustry;
                    custData.keyPerson = quickCustKeyPerson;
                    custData.contactName = quickCustKeyPerson;
                    custData.contactLastName = '';
                  } else {
                    custData.firstName = quickCustFirstName;
                    custData.lastName = quickCustLastName;
                    custData.gender = 'نامشخص';
                    custData.position = quickCustPosition;
                    custData.companyName = `${quickCustFirstName} ${quickCustLastName}`.trim();
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
                onClick={async () => {
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
                    notes: 'ثبت سریع از بخش تراکنش‌ها'
                  };

                  if (addSupplier) {
                    const created = await addSupplier(supData);
                    if (created && created.id) {
                      supplierPicker.include(created as any);
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
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.companyName}</option>
                  ))}
                </select>
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
                onClick={async () => {
                  if (!quickProjName.trim()) {
                    alert('لطفاً نام پروژه را وارد کنید.');
                    return;
                  }
                  if (!quickProjCustomerId) {
                    alert('لطفاً مشتری را انتخاب کنید.');
                    return;
                  }

                  const selectedCust = customers.find(c => c.id === quickProjCustomerId);
                  const customerName = selectedCust ? selectedCust.companyName : 'مشتری نامشخص';

                  const projData: any = {
                    name: quickProjName,
                    customerId: quickProjCustomerId,
                    customerName,
                    status: 'جدید',
                    stage: quickProjStage,
                    projectManager: quickProjSalesExpert,
                    endUser: '',
                    salesExpert: quickProjSalesExpert,
                    notes: 'تعریف سریع از تراکنش',
                    expectedCloseDate: '',
                    itemsNeeded: [],
                    customValues: {}
                  };

                  if (addProject) {
                    const created = await addProject(projData);
                    if (created && created.id) {
                      projectPicker.include(created as any);
                      setProjectId(created.id);
                      setPartyType('customer');
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

      {quickAddType && (
        <QuickAddModal
          isOpen={!!quickAddType}
          onClose={() => setQuickAddType(null)}
          type={quickAddType}
          settings={settings}
          customers={customers}
          addCustomer={addCustomer}
          addSupplier={addSupplier}
          addProject={addProject}
          onSuccess={(newEntity) => {
            if (newEntity && newEntity.id) {
              // The pickers were filled before this record existed, so pin it —
              // otherwise the field is set to an id the select has no option
              // for, and renders its placeholder as though nothing was created.
              if (quickAddType === 'customer') customerPicker.include(newEntity);
              else if (quickAddType === 'supplier') supplierPicker.include(newEntity);
              else if (quickAddType === 'project') projectPicker.include(newEntity);
              if (quickAddType === 'customer') {
                setCustomerId(newEntity.id);
              } else if (quickAddType === 'supplier') {
                setSupplierId(newEntity.id);
              } else if (quickAddType === 'project') {
                setProjectId(newEntity.id);
              }
            }
          }}
        />
      )}

      {showPrintModal && printTargetTx && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs overflow-y-auto p-4 md:p-8 z-50 flex justify-center">
          <div className="bg-white text-slate-900 w-full max-w-3xl rounded-2xl shadow-2xl p-6 md:p-10 flex flex-col justify-between h-fit min-h-screen text-right animate-scale-in">
            {/* Action Bar */}
            <div className="flex justify-between items-center pb-6 mb-6 border-b border-slate-200 print:hidden">
              <h3 className="font-bold text-sm text-slate-800">پیش‌نمایش سند تراکنش مالی</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-sky-600/10"
                >
                  <Printer size={14} />
                  <span>چاپ سند</span>
                </button>
                <button
                  onClick={() => {
                    setShowPrintModal(false);
                    onClearInitialPrintDocId?.();
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 transition"
                >
                  بستن پیش‌نمایش
                </button>
              </div>
            </div>

            {/* Printable Document Sheet */}
            <div className="print-sheet space-y-6 text-xs flex-1">
              <div className="flex justify-between items-center pb-4 border-b-2 border-slate-200">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {printTargetTx.type === 'دریافت' ? 'رسید دریافت وجه (سند بستانکار)' : 'سند پرداخت وجه (سند بدهکار)'}
                  </h2>
                  <p className="text-slate-400 text-[10px]">امور مالی و خزانه‌داری ابزار تامین عرشیا</p>
                </div>
                <div className="text-[10px] space-y-1 text-slate-500 font-mono text-left" dir="ltr">
                  <div>Voucher No: {printTargetTx.documentNumber}</div>
                  <div>Date: {printTargetTx.date}</div>
                  <div>Ref No: {printTargetTx.referenceNumber || '-'}</div>
                </div>
              </div>

              <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-100 text-slate-700 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-slate-400 font-bold">بابت پروژه:</span>
                    <span className="text-slate-800 font-bold mr-1">
                      {projects.find(p => p.id === printTargetTx.projectId)?.name || 'متفرقه / بدون پروژه'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold">طرف حساب:</span>
                    <span className="text-slate-800 font-bold mr-1">
                      {/* partyType and partyNameManual are form state and are
                          not stored, so this always fell through to the last
                          branch and printed "نامشخص". */}
                      {printTargetTx.partyName || 'نامشخص'}
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 flex justify-between items-center">
                  <div>
                    <span className="text-slate-400 font-bold">مبلغ تراکنش:</span>
                    <strong className="text-slate-950 text-sm font-mono mr-1">
                      {formatMoney(printTargetTx.amountRIYAL)} ریال
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold">نوع پرداخت/دریافت:</span>
                    <span className="text-slate-800 font-bold mr-1">{printTargetTx.paymentType}</span>
                  </div>
                </div>

                {printTargetTx.bankName && (
                  <div className="border-t border-slate-100 pt-3">
                    <span className="text-slate-400 font-bold">نام بانک مبدا/مقصد:</span>
                    <span className="text-slate-800 mr-1">{printTargetTx.bankName}</span>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-3">
                  <span className="text-slate-400 font-bold">شرح تراکنش و بابت:</span>
                  <p className="text-slate-800 mr-1 inline">{printTargetTx.notes || 'بدون بابت'}</p>
                </div>
              </div>

              <div className="pt-12 text-center text-[10px] text-slate-400 flex justify-between">
                <div>
                  <p className="font-bold text-slate-700">تحویل‌دهنده سند / پرداخت‌کننده</p>
                  <div className="h-16"></div>
                </div>
                <div>
                  <p className="font-bold text-slate-700">مدیر خزانه‌داری و امور مالی</p>
                  <div className="h-16"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate customer warning */}
      <DuplicateCustomerModal
        isOpen={dupMatches.length > 0}
        candidateName={dupPayload?.companyName || ''}
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
