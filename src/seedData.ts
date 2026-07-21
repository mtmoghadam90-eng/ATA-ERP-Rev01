import { 
  Customer, 
  Product, 
  Supplier, 
  Proforma, 
  PurchaseOrder, 
  Project, 
  Transaction, 
  Task, 
  ExchangeRate, 
  ERPSettings 
} from './types';

// Seed Products (Instrumentation equipment)
export const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Rosemount 3051S Coplanar Pressure Transmitter',
    displayName: 'ترانسمیتر فشار روزمونت مدل 3051S',
    code: 'RM-3051S-TG',
    category: 'ابزار دقیق - فشار',
    brand: 'Rosemount (Emerson)',
    modelNumber: '3051S2TG3A2111A1A',
    unit: 'عدد',
    basePriceRIYAL: 285000000,
    description: 'ترانسمیتر هوشمند فشار به همراه صفحه نمایش دیجیتال و خروجی HART، بازه کاری -1 تا 10 بار، بدنه استنلس استیل 316',
    stockLevel: 12,
    minStockLevel: 5,
    supplyType: 'ORDER'
  },
  {
    id: 'prod-2',
    name: 'WIKA 232.50 Bourdon Tube Pressure Gauge',
    displayName: 'گیج فشار عقربه‌ای ویکا مدل 232.50',
    code: 'WK-232.50-100',
    category: 'ابزار دقیق - فشار',
    brand: 'WIKA',
    modelNumber: '232.50.100 10 bar G1/2B',
    unit: 'عدد',
    basePriceRIYAL: 18500000,
    description: 'گیج فشار تمام استیل قطر 10 سانتی‌متر، رنج 0 تا 10 بار، اتصال از پشت (G1/2)، مناسب برای صنایع شیمیایی و نفت',
    stockLevel: 150,
    minStockLevel: 30
  },
  {
    id: 'prod-3',
    name: 'Endress+Hauser Promass F 300 Coriolis Flowmeter',
    displayName: 'فلومتر کوریولیس اندرس هاوزر Promass F 300',
    code: 'EH-PROM-F300',
    category: 'ابزار دقیق - جریان (فلو)',
    brand: 'Endress+Hauser',
    modelNumber: '8F3B25-XX88/0',
    unit: 'دستگاه',
    basePriceRIYAL: 1450000000,
    description: 'فلومتر جرمی کوریولیس با دقت بسیار بالا سایز 1 اینچ، کلاس کاری PN40، مناسب برای اندازه‌گیری جرم، چگالی و دما به صورت همزمان',
    stockLevel: 2,
    minStockLevel: 1
  },
  {
    id: 'prod-4',
    name: 'Yokogawa EJX110A Differential Pressure Transmitter',
    displayName: 'ترانسمیتر فشار تفاضلی یوکوگاوا مدل EJX110A',
    code: 'YG-EJX110A-MS',
    category: 'ابزار دقیق - فشار',
    brand: 'Yokogawa',
    modelNumber: 'EJX110A-MHS4B-92NN',
    unit: 'عدد',
    basePriceRIYAL: 340000000,
    description: 'ترانسمیتر اختلاف فشار دیجیتالی با دقت بالا و پایداری طولانی‌مدت، خروجی پروتکل BRAIN/HART، سلول متریال Hastelloy C-276',
    stockLevel: 8,
    minStockLevel: 3
  },
  {
    id: 'prod-5',
    name: 'Siemens SITRANS LR250 Radar Level Transmitter',
    displayName: 'لول ترانسمیتر راداری زیمنس SITRANS LR250',
    code: 'SM-LR250-25G',
    category: 'ابزار دقیق - سطح (لول)',
    brand: 'Siemens',
    modelNumber: '7ML5431-0AA20-0AA0',
    unit: 'عدد',
    basePriceRIYAL: 480000000,
    description: 'ترانسمیتر سطح راداری فرکانس بالا (25 گیگاهرتز) مناسب برای اندازه‌گیری مایعات و اسیدهای مخازن تحت فشار تا ارتفاع 20 متر',
    stockLevel: 5,
    minStockLevel: 2
  },
  {
    id: 'prod-6',
    name: 'WIKA TR10-C Resistance Thermometer with Thermowell',
    displayName: 'سنسور دمای RTD ترموول‌دار ویکا مدل TR10-C',
    code: 'WK-TR10-C-Pt100',
    category: 'ابزار دقیق - دما',
    brand: 'WIKA',
    modelNumber: 'TR10-C-Pt100-3-A-0300',
    unit: 'عدد',
    basePriceRIYAL: 35000000,
    description: 'سنسور دمای سه سیمه Pt100 کلاس A به همراه ترموول سالید ساخت ویکا آلمان، طول غلاف 30 سانتی‌متر متریال SS316',
    stockLevel: 45,
    minStockLevel: 10
  },
  {
    id: 'prod-7',
    name: 'Fisher ET Globe Control Valve with 667 Actuator',
    displayName: 'کنترل ولو فلوشر گلوب شیر با اکچویتور نیوماتیکی 667',
    code: 'FS-ET-300-667',
    category: 'ابزار دقیق - شیرهای کنترل',
    brand: 'Fisher (Emerson)',
    modelNumber: 'Fisher ET 2inch CL300 RTJ',
    unit: 'دستگاه',
    basePriceRIYAL: 1980000000,
    description: 'شیر کنترل مسیر گلوب سوپاپ سایز 2 اینچ کلاس 300 به همراه اکچویتور پنوماتیکی دیافراگمی فیشر و پوزیشنر هوشمند DVC6200',
    stockLevel: 1,
    minStockLevel: 0,
    supplyType: 'ORDER'
  }
];

// Seed Customers (Iranian Industrial and EPC Companies)
export const SEED_CUSTOMERS: Customer[] = [
  {
    id: 'cust-1',
    companyName: 'شرکت ملی مناطق نفت‌خیز جنوب',
    contactName: 'مهندس حمید',
    contactLastName: 'رضایی',
    customerType: 'حقوقی',
    industry: 'نفت و گاز',
    phone: '06134120000',
    mobile: '09161112233',
    email: 'h.rezaei@nisoc.ir',
    province: 'خوزستان',
    city: 'اهواز',
    address: 'اهواز، کوی فداییان اسلام، خیابان نفت، ساختمان مرکزی NISOC',
    status: 'فعال',
    createdAt: '2026-01-15T08:30:00Z'
  },
  {
    id: 'cust-2',
    companyName: 'پتروشیمی شهید تندگویان',
    contactName: 'خانم مهندس سارا',
    contactLastName: 'کریمی',
    customerType: 'حقوقی',
    industry: 'پتروشیمی',
    phone: '06152170000',
    mobile: '09123456789',
    email: 's.karimi@stpc.ir',
    province: 'خوزستان',
    city: 'ماهشهر',
    address: 'منطقه ویژه اقتصادی پتروشیمی بندر امام خمینی، سایت 4 پتروشیمی تندگویان',
    status: 'فعال',
    createdAt: '2026-02-10T11:45:00Z'
  },
  {
    id: 'cust-3',
    companyName: 'مهندسی و ساخت توربین مپنا (توگا)',
    contactName: 'مهندس علیرضا',
    contactLastName: 'محمودی',
    customerType: 'حقوقی',
    industry: 'نیروگاه و انرژی',
    phone: '02636630001',
    mobile: '09127778899',
    email: 'a.mahmoudi@mapnatoga.com',
    province: 'البرز',
    city: 'کرج',
    address: 'کرج، کیلومتر 7 جاده ملارد، جنب پل کلاک، مجموعه کارخانجات مپنا',
    status: 'فعال',
    createdAt: '2026-03-01T09:15:00Z'
  },
  {
    id: 'cust-4',
    companyName: 'شرکت فولاد مبارکه اصفهان',
    contactName: 'مهندس سعید',
    contactLastName: 'نادری',
    customerType: 'حقوقی',
    industry: 'فولاد و معادن',
    phone: '03152730000',
    mobile: '09132225566',
    email: 's.naderi@msc.ir',
    province: 'اصفهان',
    city: 'مبارکه',
    address: 'اصفهان، کیلومتر 75 جنوب غربی اصفهان، شرکت فولاد مبارکه، واحد خرید ابزار دقیق',
    status: 'فعال',
    createdAt: '2026-04-20T14:20:00Z'
  }
];

// Seed Suppliers (Overseas partners / distributors)
export const SEED_SUPPLIERS: Supplier[] = [
  {
    id: 'supp-1',
    name: 'WIKA Instruments SE & Co. KG',
    country: 'آلمان',
    contactName: 'Herr Schmidt',
    phone: '+49 9372 132-0',
    email: 'sales@wika.de',
    website: 'https://www.wika.com',
    paymentTerms: '30 روزه حواله بانکی CAD',
    status: 'فعال',
    createdAt: '2026-01-10T10:00:00Z'
  },
  {
    id: 'supp-2',
    name: 'Emerson Automation Solutions Middle East',
    country: 'امارات متحده عربی',
    contactName: 'Mr. Johnathan Smith',
    phone: '+971 4 811 8100',
    email: 'dubai.sales@emerson.com',
    website: 'https://www.emerson.com',
    paymentTerms: 'پیش‌پرداخت نقد (L/C)',
    status: 'فعال',
    createdAt: '2026-02-01T09:00:00Z'
  },
  {
    id: 'supp-3',
    name: 'Endress+Hauser Instruments International AG',
    country: 'سوئیس',
    contactName: 'Frau Muller',
    phone: '+41 61 715 8100',
    email: 'info@endress.com',
    website: 'https://www.endress.com',
    paymentTerms: 'نقدی ارزی صرافی',
    status: 'فعال',
    createdAt: '2026-03-12T13:30:00Z'
  }
];

// Seed Exchange Rates (To IRR)
export const SEED_EXCHANGE_RATES: ExchangeRate[] = [
  { id: 'rate-1', currency: 'USD', name: 'دلار آمریکا', rateToRIYAL: 625000, lastUpdated: '2026-07-05T09:00:00Z' },
  { id: 'rate-2', currency: 'EUR', name: 'یورو', rateToRIYAL: 678000, lastUpdated: '2026-07-05T09:00:00Z' },
  { id: 'rate-3', currency: 'AED', name: 'درهم امارات', rateToRIYAL: 171000, lastUpdated: '2026-07-05T09:00:00Z' },
  { id: 'rate-4', currency: 'CNY', name: 'یوان چین', rateToRIYAL: 86000, lastUpdated: '2026-07-05T09:00:00Z' }
];

// Seed Projects
export const SEED_PROJECTS: Project[] = [
  {
    id: 'proj-1',
    code: 'ATA-1405-001',
    name: 'نوسازی ترانسمیترهای مخازن ثانویه اهواز ۳',
    customerId: 'cust-1',
    customerName: 'شرکت ملی مناطق نفت‌خیز جنوب',
    creationDate: '2026-05-10',
    expectedCloseDate: '2026-08-15',
    status: 'ارائه پیش‌فاکتور',
    description: 'تامین و نوسازی ۲۴ دستگاه ترانسمیتر فشار تفاضلی و مخزنی برای پروژه اهواز ۳ با استاندارد ضد انفجار (ATEX Ex d)',
    
    // New Fields:
    salesExpert: 'مهندس حسینی',
    marketingChannel: 'تماس مستقیم',
    leadQuality: 'عالی (گرم)',
    referrerName: 'دفتر مهندسی تهران',
    financialContact: 'آقای رضایی (تدارکات)',
    technicalContact: 'مهندس زارعی (رئیس ابزاردقیق)',
    communicationMethod: 'مکاتبه رسمی',
    opportunityDate: '2026-05-10',
    customerInquiryNumber: 'ن/۳۴۲-۹۹/ع',
    endUser: 'پالایشگاه کارون'
  },
  {
    id: 'proj-2',
    code: 'ATA-1405-002',
    name: 'پروژه نوسازی شیرهای کنترل بویلر فاز ۲ تندگویان',
    customerId: 'cust-2',
    customerName: 'پتروشیمی شهید تندگویان',
    creationDate: '2026-06-02',
    expectedCloseDate: '2026-09-30',
    status: 'برنده (موفق)',
    description: 'تامین ۲ دستگاه کنترل ولو گلوب شیر ۲ اینچ فیشر با پوزیشنر هارت به همراه قطعات جانبی هانیول',
    
    // New Fields:
    salesExpert: 'مهندس اکبری',
    marketingChannel: 'مناقصه رسمی',
    leadQuality: 'عالی (گرم)',
    financialContact: 'خانم مقدم (امور مالی)',
    technicalContact: 'مهندس کریمی (فنی و بازرسی)',
    communicationMethod: 'جلسه حضوری',
    opportunityDate: '2026-06-02',
    customerInquiryNumber: 'پ-۴۰۵-۱۲',
    winningDate: '2026-06-25',
    agreedDeliveryDate: '2026-10-01',
    closingDate: '2026-06-25',
    endUser: 'بویلر فاز ۲ تندگویان'
  }  ,
  {
    id: 'proj-3',
    code: 'ATA-1405-TEST',
    name: 'پروژه تست تامین کالای انبار و سفارش (تست کامل نرم‌افزار)',
    customerId: 'cust-1',
    customerName: 'شرکت ملی مناطق نفت‌خیز جنوب',
    creationDate: '2026-07-01',
    status: 'برنده (موفق)',
    description: 'یک پروژه تست برای بررسی عملکرد تب وضعیت تامین کالاها',
    salesExpert: 'تست سیستم',
    itemsNeeded: [
      { productId: 'prod-1', name: 'ترانسمیتر فشار روزمونت مدل 3051S', quantity: 2, supplyMethod: 'ORDER' },
      { productId: 'prod-2', name: 'ترانسمیتر فشار اندرس هاوزر مدل Cerabar M', quantity: 5, supplyMethod: 'INVENTORY' },
      { productId: 'prod-3', name: 'سنسور دما ویکا', quantity: 10, supplyMethod: 'NONE' }
    ]
  }
];

// Seed Proformas (Quotations)
export const SEED_PROFORMAS: Proforma[] = [
  {
    id: 'pf-1',
    proformaNumber: 'QT-ATA-1405-001-01',
    customerId: 'cust-1',
    customerName: 'شرکت ملی مناطق نفت‌خیز جنوب',
    projectId: 'proj-1',
    projectName: 'نوسازی ترانسمیترهای مخازن ثانویه اهواز ۳',
    issueDate: '2026-06-15',
    expiryDate: '2026-07-15',
    deliveryDate: '2026-08-15',
    status: 'ارسال شده',
    items: [
      {
        id: 'pfi-1',
        productId: 'prod-1',
        productName: 'ترانسمیتر فشار روزمونت مدل 3051S',
        productCode: 'RM-3051S-TG',
        brand: 'Rosemount (Emerson)',
        quantity: 4,
        unitPriceRIYAL: 285000000,
        totalPriceRIYAL: 1140000000
      },
      {
        id: 'pfi-2',
        productId: 'prod-6',
        productName: 'سنسور دمای RTD ترموول‌دار ویکا مدل TR10-C',
        productCode: 'WK-TR10-C-Pt100',
        brand: 'WIKA',
        quantity: 10,
        unitPriceRIYAL: 35000000,
        totalPriceRIYAL: 350000000
      }
    ],
    totalAmount: 1490000000,
    discountPercent: 5,
    discountAmount: 74500000,
    taxPercent: 10,
    taxAmount: 141550000,
    finalAmount: 1557050000,
    notes: 'تحویل کالا ۶ هفته پس از دریافت پیش‌پرداخت. گارانتی ۱۲ ماهه شرکت ابزار تامین ارشیا.'
  },
  {
    id: 'pf-2',
    proformaNumber: 'QT-ATA-1405-002-01',
    customerId: 'cust-2',
    customerName: 'پتروشیمی شهید تندگویان',
    projectId: 'proj-2',
    projectName: 'پروژه نوسازی شیرهای کنترل بویلر فاز ۲ تندگویان',
    issueDate: '2026-06-10',
    expiryDate: '2026-07-10',
    deliveryDate: '2026-10-01',
    status: 'تأیید شده (برنده)',
    items: [
      {
        id: 'pfi-3',
        productId: 'prod-7',
        productName: 'کنترل ولو فلوشر گلوب شیر با اکچویتور نیوماتیکی 667',
        productCode: 'FS-ET-300-667',
        brand: 'Fisher (Emerson)',
        quantity: 2,
        unitPriceRIYAL: 1980000000,
        totalPriceRIYAL: 3960000000
      }
    ],
    totalAmount: 3960000000,
    discountPercent: 2,
    discountAmount: 79200000,
    taxPercent: 10,
    taxAmount: 388080000,
    finalAmount: 4268880000,
    notes: 'پیش‌پرداخت ۵۰ درصد جهت ورود کالا از انبار دبی، مابقی تسویه قبل از تحویل درب کارخانه بندر امام.'
  }  ,
  {
    id: 'pf-3',
    proformaNumber: 'QT-ATA-1405-TEST-01',
    customerId: 'cust-1',
    customerName: 'شرکت ملی مناطق نفت‌خیز جنوب',
    projectId: 'proj-3',
    projectName: 'پروژه تست تامین کالای انبار و سفارش (تست کامل نرم‌افزار)',
    issueDate: '2026-07-05',
    expiryDate: '2026-08-05',
    deliveryDate: '2026-09-01',
    status: 'تأیید شده (برنده)',
    items: [
      {
        id: 'pfi-4',
        productId: 'prod-1',
        productName: 'ترانسمیتر فشار روزمونت مدل 3051S',
        productCode: 'RM-3051S-TG',
        brand: 'Rosemount (Emerson)',
        quantity: 2,
        unitPriceRIYAL: 300000000,
        totalPriceRIYAL: 600000000,
        supplyMethod: 'ORDER',
        status: 'برنده'
      },
      {
        id: 'pfi-5',
        productId: 'prod-2',
        productName: 'ترانسمیتر فشار اندرس هاوزر مدل Cerabar M',
        productCode: 'EH-PMC51',
        brand: 'Endress+Hauser',
        quantity: 5,
        unitPriceRIYAL: 200000000,
        totalPriceRIYAL: 1000000000,
        supplyMethod: 'INVENTORY',
        status: 'برنده'
      },
      {
        id: 'pfi-6',
        productId: 'prod-3',
        productName: 'ترانسمیتر سطح راداری موج هدایت شونده یوکوگاوا',
        productCode: 'YK-GWR',
        brand: 'Yokogawa',
        quantity: 10,
        unitPriceRIYAL: 15000000,
        totalPriceRIYAL: 150000000,
        supplyMethod: 'NONE',
        status: 'برنده'
      }
    ],
    totalAmount: 1750000000,
    discountPercent: 0,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    finalAmount: 1750000000,
    notes: 'پیش‌فاکتور تست سیستم'
  }
];

// Seed Purchase Orders
export const SEED_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'po-1',
    poNumber: 'PO-ATA-1405-001',
    supplierId: 'supp-2',
    supplierName: 'Emerson Automation Solutions Middle East',
    projectId: 'proj-2',
    projectName: 'پروژه نوسازی شیرهای کنترل بویلر فاز ۲ تندگویان',
    proformaId: 'pf-2',
    proformaNumber: 'QT-ATA-1405-002-01',
    orderDate: '1405/03/28',
    expectedDeliveryDate: '1405/05/19',
    currency: 'دلار',
    exchangeRate: 625000,
    items: [
      {
        id: 'poi-1',
        productId: 'prod-7',
        productName: 'کنترل ولو فلوشر گلوب شیر با اکچویتور نیوماتیکی 667',
        productCode: 'FS-ET-300-667',
        brand: 'Fisher (Emerson)',
        quantity: 2,
        unitPriceForeignCurrency: 2400, // in USD
        totalPriceForeignCurrency: 4800,
        proformaItemId: 'pfi-3',
        proformaItemName: 'کنترل ولو فلوشر گلوب شیر با اکچویتور نیوماتیکی 667 (تعداد ۲)'
      }
    ],
    totalForeignAmount: 4800,
    shippingCostRIYAL: 140000000, // Freight from Dubai
    customsDutyRIYAL: 280000000, // Customs clearance
    remittanceFeeRIYAL: 25000000, // Cost of money transfer/remittance
    calculatedLandedCostRIYAL: (4800 * 625000) + 25000000 + 140000000 + 280000000, // 3,445,000,000 IRR
    paymentDate: '1405/04/01', // تاریخ پرداخت به تامین‌کننده و جاری شدن سفارش
    goodsReadyDate: '1405/04/15', // تاریخ آماده شدن کالا
    shipmentDate: '1405/04/22', // تاریخ حمل کالا
    // clearanceDate & receivedDate are not set yet as it is in-transit (ترخیص گمرک)
    status: 'ترخیص گمرک',
    createdAt: '1405/03/28'
  },
  {
    id: 'po-2',
    poNumber: 'PO-ATA-1405-002',
    supplierId: 'supp-1',
    supplierName: 'WIKA Instruments SE & Co. KG',
    orderDate: '1405/02/15',
    expectedDeliveryDate: '1405/04/11',
    currency: 'یورو',
    exchangeRate: 678000,
    items: [
      {
        id: 'poi-2',
        productId: 'prod-2',
        productName: 'گیج فشار عقربه‌ای ویکا مدل 232.50',
        productCode: 'WK-232.50-100',
        brand: 'WIKA',
        quantity: 100,
        unitPriceForeignCurrency: 18, // in EUR
        totalPriceForeignCurrency: 1800
      },
      {
        id: 'poi-3',
        productId: 'prod-6',
        productName: 'سنسور دمای RTD ترموول‌دار ویکا مدل TR10-C',
        productCode: 'WK-TR10-C-Pt100',
        brand: 'WIKA',
        quantity: 20,
        unitPriceForeignCurrency: 35, // in EUR
        totalPriceForeignCurrency: 700
      }
    ],
    totalForeignAmount: 2500,
    shippingCostRIYAL: 85000000,
    customsDutyRIYAL: 160000000,
    remittanceFeeRIYAL: 15000000,
    calculatedLandedCostRIYAL: (2500 * 678000) + 15000000 + 85000000 + 160000000, // 1,955,000,000 IRR
    paymentDate: '1405/02/18',
    goodsReadyDate: '1405/03/05',
    shipmentDate: '1405/03/12',
    clearanceDate: '1405/03/25',
    receivedDate: '1405/04/05',
    status: 'تحویل شده (رسید انبار)',
    createdAt: '1405/02/15'
  }
];

// Seed Transactions (Payments and Receipts)
export const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: 'tr-1',
    type: 'دریافت',
    documentNumber: 'RC-1405-001',
    customerId: 'cust-2',
    customerName: 'پتروشیمی شهید تندگویان',
    projectId: 'proj-2',
    projectName: 'پروژه نوسازی شیرهای کنترل بویلر فاز ۲ تندگویان',
    amountRIYAL: 2134440000, // 50% prepayment
    date: '2026-06-12',
    paymentType: 'حواله بانکی',
    referenceNumber: 'TRX-876251410',
    notes: 'پرداخت قسط اول پیش‌پرداخت فاکتور QT-ATA-1405-002-01'
  },
  {
    id: 'tr-2',
    type: 'پرداخت',
    documentNumber: 'PV-1405-001',
    supplierId: 'supp-2',
    supplierName: 'Emerson Automation Solutions Middle East',
    amountRIYAL: 3000000000, // Prepayment for PO-1 in riyal equivalent paid to exchanger
    date: '2026-06-19',
    paymentType: 'حواله بانکی',
    referenceNumber: 'TRX-100259831',
    notes: 'واریز علی‌الحساب صرافی جهت سفارش خرید کنترل ولو فیشر'
  }
];

// Seed Tasks
export const SEED_TASKS: Task[] = [
  {
    id: 'task-1',
    title: 'ارسال مدارک فنی ترانسمیترهای روزمونت به مهندسی خرید نفت‌خیز',
    description: 'دانلود و تجمیع دیتاشیت‌ها و تاییدیه ضد انفجار (ATEX Certs) برای ترانسمیتر فشار ۳۰۵۱ اس',
    relatedToType: 'پروژه',
    relatedToId: 'proj-1',
    relatedToName: 'نوسازی ترانسمیترهای مخازن ثانویه اهواز ۳',
    priority: 'بالا',
    dueDate: '2026-07-08',
    assignedTo: 'محمد توکل مقدم',
    status: 'در حال انجام'
  },
  {
    id: 'task-2',
    title: 'پیگیری ترخیص بار گمرک امام خمینی (ویکا آلمان)',
    description: 'بار گیج‌ها و سنسورهای دما رسیده و ترخیص‌کار نیاز به فبض انبار نهایی دارد',
    relatedToType: 'سفارش خرید',
    relatedToId: 'po-2',
    relatedToName: 'PO-ATA-1405-002',
    priority: 'فوری',
    dueDate: '2026-07-06',
    assignedTo: 'محمد توکل مقدم',
    status: 'در حال انجام'
  },
  {
    id: 'task-3',
    title: 'ثبت اطلاعات مشتری فولاد مبارکه در سامانه مودیان',
    description: 'کد اقتصادی جدید فولاد مبارکه در فاکتورهای رسمی بررسی شود',
    relatedToType: 'مشتری',
    relatedToId: 'cust-4',
    relatedToName: 'شرکت فولاد مبارکه اصفهان',
    priority: 'پایین',
    dueDate: '2026-07-12',
    assignedTo: 'آنتونی فیرو',
    status: 'انجام شده'
  }
];

// Default System Settings
export const DEFAULT_SETTINGS: ERPSettings = {
  showProductBrandInDocuments: false,
  customFields: [
    { id: 'cf-1', module: 'customers', name: 'رتبه پیمانکاری', type: 'text' },
    { id: 'cf-2', module: 'products', name: 'دمای کاری حداکثر (C)', type: 'number' }
  ],
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
  lossReasons: ['قیمت بالا و عدم رقابت', 'زمان تحویل طولانی', 'عدم انطباق مدارک فنی', 'تغییر نیاز مشتری', 'انصراف مشتری از کل پروژه', 'برنده شدن رقیب با برند ارزان‌تر'],
  activityCategories: [
    { id: 'act-1', name: 'پیگیری تماس تلفنی', module: 'پیگیری' },
    { id: 'act-2', name: 'جلسه حضوری فنی', module: 'پروژه' },
    { id: 'act-3', name: 'بررسی اوراق مناقصه', module: 'پروژه' },
    { id: 'act-4', name: 'درخواست پشتیبانی فنی سازنده', module: 'پروژه' }
  ],
  sidebarModuleOrder: [
    'dashboard',
    'customers',
    'projects',
    'proformas',
    'products',
    'suppliers',
    'supplierInquiries',
    'purchaseOrders',
    'packagingDelivery',
    'transactions',
    'tasks',
    'referrals',
    'users',
    'settings'
  ],
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
    }
  ]
};
