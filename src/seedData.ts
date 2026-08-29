import { DEFAULT_FOLLOW_UP_RESULTS } from './utils/salesFollowUp';
import { DEFAULT_MODULE_ORDER } from './appModules';
import { ExchangeRate, ERPSettings } from './types';
import { DEFAULT_CUSTOMER_VALUE_SETTINGS } from './utils/customerValue';
import { DEFAULT_PROJECT_GAP_FIELDS } from './utils/projectDataGaps';

/**
 * What a fresh installation starts with.
 *
 * Only two things: the currencies, and the default configuration. This file
 * used to carry several hundred lines of invented business data as well —
 * products, customers, suppliers, projects, proformas, purchase orders,
 * transactions and tasks — from when the application seeded itself with a demo
 * company on first run. Nothing has read any of it since seeding moved to
 * `npm run seed:db`, which deliberately creates users, settings and rates and
 * no business records at all.
 */

// Seed Exchange Rates (To IRR)
export const SEED_EXCHANGE_RATES: ExchangeRate[] = [
  { id: 'rate-1', currency: 'USD', name: 'دلار آمریکا', rateToRIYAL: 625000, lastUpdated: '2026-07-05T09:00:00Z' },
  { id: 'rate-2', currency: 'EUR', name: 'یورو', rateToRIYAL: 678000, lastUpdated: '2026-07-05T09:00:00Z' },
  { id: 'rate-3', currency: 'AED', name: 'درهم امارات', rateToRIYAL: 171000, lastUpdated: '2026-07-05T09:00:00Z' },
  { id: 'rate-4', currency: 'CNY', name: 'یوان چین', rateToRIYAL: 86000, lastUpdated: '2026-07-05T09:00:00Z' }
];


// Default System Settings
export const DEFAULT_SETTINGS: ERPSettings = {
  showProductBrandInDocuments: false,
  customFields: [
    { id: 'cf-1', module: 'customers', name: 'رتبه پیمانکاری', type: 'text' },
    { id: 'cf-2', module: 'products', name: 'دمای کاری حداکثر (C)', type: 'number' }
  ],
  // Blanks worth a warning on a project card; see projectDataGaps.ts.
  projectDataGapFields: [...DEFAULT_PROJECT_GAP_FIELDS],
  requiredFields: {
    customers: {
      companyName: true,
      firstName: true,
      lastName: true,
      phone: false,
      mobile: false,
      email: false,
      province: false,
      city: false,
      address: false,
      industry: false,
      keyPerson: false,
      position: false,
    },
    projects: {
      name: true,
      customerId: true,
      salesExpert: false,
      marketingChannel: false,
      leadQuality: false,
      referrerName: false,
      financialContact: false,
      technicalContact: false,
      customerInquiryNumber: false,
      expectedCloseDate: false,
      endUser: false,
      description: false,
    },
    products: {
      displayName: true,
      category: false,
      brand: false,
      modelNumber: false,
      unit: false,
      basePriceRIYAL: false,
      supplyType: false,
      description: false,
    },
    suppliers: {
      name: true,
      country: true,
      contactName: true,
      phone: false,
      email: false,
      website: false,
      paymentTerms: false,
      description: false,
    },
    proformas: {
      customerId: true,
      projectId: false,
      issueDate: true,
      expiryDate: false,
      currency: false,
      notes: false,
    },
    tasks: {
      title: true,
      description: false,
      assignedTo: false,
      dueDate: true,
      priority: false,
    },
    supplierInquiries: {
      projectId: true,
      supplierId: true,
      creationDate: false,
    },
    purchaseOrders: {
      supplierId: true,
      projectId: false,
      proformaId: false,
      orderDate: false,
      expectedDeliveryDate: false,
      currency: false,
    },
    packagingDelivery: {
      projectId: true,
      packingListNumber: false,
      deliveryDate: false,
      shippingMethod: false,
    },
    afterSalesServices: {
      projectId: true,
      itemName: false,
      issueDescription: false,
      actionsTaken: false,
      startDate: false,
    },
    transactions: {
      type: false,
      receiptType: false,
      documentNumber: false,
      amountRIYAL: true,
      date: false,
      paymentType: false,
      referenceNumber: false,
    }
  },
  proformaTemplates: [
    {
      name: 'قالب پیش‌فرض رسمی',
      companyName: 'ابزار تامین ارشیا (سهامی خاص)',
      registrationNumber: '۱۰۴۸۲۷',
      nationalCode: '۱۰۲۶۰۴۸۲۷۳۱',
      economicCode: '۴۱۱۴۸۳۹۲۷۴۸۲',
      phone: '02188899000',
      email: 'sales@abzartamin.com',
      website: 'www.abzartamin.com',
      address: 'تهران، خیابان ولیعصر، برج سپهر، طبقه ۸، واحد ۸۰۴',
      titleColor: '#0ea5e9',
      documentTitle: 'پیش‌فاکتور رسمی',
      headerText: 'مفتخریم پیشنهاد قیمت تجهیزات ابزار دقیق مورد نیاز آن مجموعه محترم را به شرح زیر تقدیم داریم.',
      termsAndConditions: '۱. مدت اعتبار این پیشنهاد ۱۰ روز کاری از تاریخ صدور می‌باشد.\n۲. زمان تحویل کالاهای موجود در انبار، ۲ روز کاری و کالاهای سفارشی ۶ هفته پس از دریافت پیش‌پرداخت می‌باشد.\n۳. گارانتی کلیه تجهیزات به مدت ۱۲ ماه شمسی و خدمات پس از فروش به مدت ۵ سال ارائه می‌گردد.',
      footerText: 'از حسن توجه و اعتماد شما به شرکت ابزار تامین ارشیا صمیمانه سپاسگزاریم.',
      signatureLabel1: 'کارشناس فروش - محمد توکل مقدم',
      signatureLabel2: 'مدیرعامل - علیرضا ارشیا',
      showLogo: true,
      showTerms: true,
      showSignatures: true,
      showTotals: true
    }
  ],
  activeTemplateId: 'قالب پیش‌فرض رسمی',
  documentFormats: {
    projectPrefix: 'ATA-',
    projectFormat: 'ATA-{YYYY}-{SEQ:3}',
    proformaPrefix: 'QT-',
    proformaFormat: 'QT-{PROJECT}-{SEQ:2}',
    proformaTechnicalFormat: 'QT-TECH-{PROJECT}-{SEQ:2}',
    proformaAfterSalesFormat: 'QT-SERV-{PROJECT}-{SEQ:2}',
    poPrefix: 'PO-',
    poFormat: 'PO-{PROJECT}-{SEQ:3}',
    transactionFormat: 'TR-{TYPE}-{YYYY}{MM}-{SEQ:3}',
    productFormat: 'EQ-{RAND:5}',
    packingListFormat: 'PL-{PROJECT}-{SEQ:3}'
  },
  dropdownItems: {
    industries: ['نفت و گاز', 'پتروشیمی', 'نیروگاه و انرژی', 'فولاد و معادن', 'آب و فاضلاب', 'غذایی و دارویی', 'سیمان', 'EPC پیمانکاری'],
    customerTypes: ['حقیقی', 'حقوقی'],
    customerStatuses: ['فعال', 'غیرفعال'],
    categories: ['ابزار دقیق - فشار', 'ابزار دقیق - دما', 'ابزار دقیق - جریان (فلو)', 'ابزار دقیق - سطح (لول)', 'ابزار دقیق - آنالایزرها', 'ابزار دقیق - شیرهای کنترل', 'قطعات یدکی و اتصالات'],
    units: ['عدد', 'دستگاه', 'متر', 'ست', 'شاخه'],
    currencies: ['ریال', 'دلار', 'یورو', 'درهم', 'یوان'],
    paymentTerms: ['نقدی', '۳۰ روزه', '۶۰ روزه', '۹۰ روزه', '۵۰٪ پیش‌پرداخت / ۵۰٪ تحویل', 'صندوق ضمانت'],
    paymentTypes: ['حواله بانکی', 'چک', 'نقدی', 'کارت به کارت'],
    projectStatuses: ['جدید', 'در حال مذاکره', 'ارائه پیش‌فاکتور', 'برنده (موفق)', 'باخته', 'لغو شده', 'نیمه برنده'],
    salesExperts: ['مهندس حسینی', 'مهندس اکبری', 'محمد توکل مقدم'],
    marketingChannels: ['تماس مستقیم', 'نمایشگاه تجاری', 'وب‌سایت / آنلاین', 'معرفی', 'مناقصه رسمی', 'سایر'],
    leadQualities: ['عالی (گرم)', 'متوسط', 'ضعیف (سرد)'],
    communicationMethods: ['تلفن', 'ایمیل', 'جلسه حضوری', 'مکاتبه رسمی', 'شبکه‌های اجتماعی'],
    taskPriorities: ['پایین', 'متوسط', 'بالا', 'فوری'],
    taskStatuses: ['در حال انجام', 'انجام شده', 'کنسل شده'],
    proformaStatuses: ['پیش‌نویس', 'ارسال شده', 'تأیید شده (برنده)', 'لغو شده', 'باخته'],
    purchaseOrderStatuses: ['پیش‌نویس', 'پرداخت و سفارش به سازنده', 'در حال آماده‌سازی سازنده', 'حمل و ترانزیت', 'ترخیص گمرک', 'در حال حمل به انبار', 'تحویل شده (رسید انبار)'],
    positions: ['مدیرعامل', 'رئیس هیئت مدیره', 'مدیر بازرگانی', 'کارشناس خرید', 'مدیر فنی', 'کارشناس ارشد فنی', 'مدیر پروژه', 'مسئول تدارکات', 'کارشناس ابزار دقیق', 'سایر'],
    receiptTypes: ['پیش پرداخت', 'میاندوره', 'تسویه'],
    shippingMethods: ['باربری', 'پیک شهری', 'تیپاکس', 'پست پیشتاز', 'تحویل حضوری', 'هواپیمایی', 'راننده شرکت'],
    packageTypes: ['کارتن', 'جعبه چوبی', 'پالت', 'کیسه', 'صندوق فلزی', 'فله'],
    returnReasons: ['خرابی قطعه', 'مغایرت با درخواست', 'اشکال در نصب', 'تعمیر و نگهداری دوره‌ای', 'ارتقا سیستم', 'سایر'],
    proformaSentMethods: ['ایمیل', 'واتس‌اپ', 'تلگرام', 'پست', 'حضوری', 'سایر'],
    followUpResults: [...DEFAULT_FOLLOW_UP_RESULTS],
    equipmentTypes: [
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
    ],
    supplierInquirySteps: [
      'ارسال استعلام قیمت',
      'ارسال ایمیل پیگیری',
      'دریافت آفر فنی/مالی اولیه',
      'جلسه هماهنگی فنی با تأمین‌کننده',
      'اصلاح و بازنگری پیشنهاد',
      'دریافت آفر نهایی',
      'تأیید فنی اولیه',
      'اعلام به عنوان برنده نهایی استعلام',
      'لغو استعلام'
    ]
  },
  customerValue: DEFAULT_CUSTOMER_VALUE_SETTINGS,
  lossReasons: ['قیمت بالا و عدم رقابت', 'زمان تحویل طولانی', 'عدم انطباق مدارک فنی', 'تغییر نیاز مشتری', 'انصراف مشتری از کل پروژه', 'برنده شدن رقیب با برند ارزان‌تر'],
  activityCategories: [
    { id: 'act-1', name: 'پیگیری تماس تلفنی', module: 'پیگیری' },
    { id: 'act-2', name: 'جلسه حضوری فنی', module: 'پروژه' },
    { id: 'act-3', name: 'بررسی اوراق مناقصه', module: 'پروژه' },
    { id: 'act-4', name: 'درخواست پشتیبانی فنی سازنده', module: 'پروژه' }
  ],
  sidebarModuleOrder: [...DEFAULT_MODULE_ORDER],
  /*
   * No quiet window and live sending, which is what an installation that has
   * just configured a provider wants. Dry run is the switch somebody turns on
   * deliberately while trying a rule out.
   */
  /*
   * Off until somebody configures it: it needs a provider, a key and a model,
   * and an assistant that answers «کلید ثبت نشده» on the front page of a fresh
   * installation is worse than one that is simply not there yet.
   */
  assistant: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    systemPrompt: '',
    temperature: 0,
    maxTokens: 2000,
    maxToolCalls: 12,
    timeoutSeconds: 60,
    allowActions: false,
  },
  messaging: {
    quietHours: { from: null, to: null },
    dryRun: false,
    maxAttempts: 4,
  },
  deliveryChecklistTemplate: [
    'بررسی ظاهری کالا و اصالت برند کالاها',
    'کنترل تطابق شماره سریال با گواهی کالیبراسیون و مدارک فنی',
    'تست صحت عملکرد فیزیکی و اتصال ابزار دقیق',
    'بررسی تمیزی و عدم وجود رطوبت/آلودگی در پورت‌ها',
    'تکمیل و امضای برگه تست تجهیزات قبل از تحویل',
    'قرار دادن کاتالوگ، دفترچه راهنما و مدارک فنی مرتبط',
    'بسته‌بندی ایمن با پلاستیک حباب‌دار و ضربه‌گیر استاندارد'
  ],
  workflows: [
    {
      id: 'wf-default-1',
      name: 'ایجاد تسک سفارش خرید پس از برنده شدن پیش‌فاکتور',
      active: true,
      triggerType: 'proforma_outcome_change',
      conditions: [
        { field: 'newOutcome', operator: 'equals', value: 'تأیید شده (برنده)' }
      ],
      actions: [
        {
          id: 'wfa-1',
          type: 'create_task',
          taskConfig: {
            titleTemplate: 'پیگیری سفارش خرید خارجی - {projectName}',
            descTemplate: 'پیش‌فاکتور شماره {proformaNumber} برای پروژه {projectName} برنده شد. لطفاً خرید خارجی را از تامین‌کننده پیگیری نمایید.',
            assignedTo: 'MODULE_RESPONSIBLE_purchaseOrders',
            priority: 'بالا',
            dueDaysOffset: 3
          }
        }
      ]
    },
    /*
     * The standard sales follow-up, as a rule rather than as code.
     *
     * Seeded so a new installation chases its quotations from day one, and
     * seeded as an ordinary automation so every part of it — when it fires, who
     * it lands on, how long the person has, what the task is called — is edited
     * or switched off in Settings → Automations like any other. Hardcoding it
     * would put all four beyond reach.
     *
     * `SALES_EXPERT` resolves through the proforma's project, not through
     * whoever prepared the document: a support engineer routinely writes the
     * quotation for a job somebody else is selling, and the chase belongs to
     * the person selling it.
     *
     * `skipIfOpenSameKind` is what stops a re-sent quotation collecting a
     * second follow-up while the first is still open.
     */
    {
      id: 'wf-default-follow-up',
      name: 'پیگیری پیش‌فاکتور پس از ارسال به مشتری',
      active: true,
      triggerType: 'proforma_status_change',
      conditions: [
        { field: 'newStatus', operator: 'equals', value: 'ارسال شده' }
      ],
      actions: [
        {
          id: 'wfa-follow-up',
          type: 'create_task',
          taskConfig: {
            titleTemplate: 'پیگیری پیش‌فاکتور {proformaNumber}',
            descTemplate: 'پیش‌فاکتور {proformaNumber} برای {customerName} ارسال شد. نتیجه بررسی مشتری را پیگیری کنید.',
            assignedTo: 'SALES_EXPERT',
            priority: 'متوسط',
            dueDaysOffset: 2,
            taskKind: 'SALES_FOLLOW_UP',
            skipIfOpenSameKind: true
          }
        }
      ]
    }
  ]
};
