import React, { useState } from 'react';
import { 
  Package, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  Printer, 
  Upload, 
  ClipboardCheck, 
  Truck, 
  Calendar, 
  FileText, 
  Search, 
  Briefcase, 
  Info,
  AlertCircle,
  FileCheck,
  Edit,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { 
  Project, 
  Proforma, 
  Product,
  PackagingDelivery, 
  PackingItem, 
  DeliveryChecklistItem,
  ERPSettings,
  Customer
} from '../types';
import { getTodayShamsi } from '../dateUtils';
import { isFieldRequired, renderFieldLabelWithAsterisk, getFieldAsterisk } from '../utils/requiredFields';
import { getProformaOutcomeStatus, getWonItemsOfProforma } from '../useERPStore';
import ConfirmModal from './ConfirmModal';
import ShamsiDatePicker from './ShamsiDatePicker';
import { uploadFile } from '../imageUtils';
import ModuleNotesSection from './ModuleNotesSection';
import CustomerAgreementAlert from './CustomerAgreementAlert';

interface PackagingDeliveryViewProps {
  initialPrintDocId?: string;
  onClearInitialPrintDocId?: () => void;
  projects: Project[];
  customers: Customer[];
  proformas: Proforma[];
  products: Product[];
  packagingDeliveries: PackagingDelivery[];
  addPackagingDelivery: (delivery: Omit<PackagingDelivery, 'id' | 'createdAt' | 'packingListNumber'>) => any;
  updatePackagingDelivery: (delivery: PackagingDelivery) => void;
  deletePackagingDelivery: (id: string, deleteLogs?: boolean) => void;
  settings: ERPSettings;
  currentUser: any;
}

export default function PackagingDeliveryView({
  initialPrintDocId,
  onClearInitialPrintDocId,
  projects,
  customers,
  proformas,
  products,
  packagingDeliveries,
  addPackagingDelivery,
  updatePackagingDelivery,
  deletePackagingDelivery,
  settings,
  currentUser
}: PackagingDeliveryViewProps) {
  const activeTemplate = settings.proformaTemplates?.find(t => t.name === settings.activeTemplateId) || settings.proformaTemplates?.[0];
  const [activeTab, setActiveTab] = useState<'list' | 'new'>('list');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (initialPrintDocId) {
      const pd = packagingDeliveries.find(p => p.id === initialPrintDocId);
      if (pd) {
        setSelectedDelivery(pd);
      }
    }
  }, [initialPrintDocId, packagingDeliveries]);

  // Filter States
  const [filterProject, setFilterProject] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Form States (New Delivery)
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedProformaId, setSelectedProformaId] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>(getTodayShamsi());
  const [actualDeliveryDate, setActualDeliveryDate] = useState<string>('');
  const [useItemizedDeliveryDates, setUseItemizedDeliveryDates] = useState<boolean>(false);
  const [shippingMethod, setShippingMethod] = useState<string>(settings.dropdownItems.shippingMethods?.[0] || 'باربری');
  const [preDeliveryTestNotes, setPreDeliveryTestNotes] = useState<string>('');
  const [packingItems, setPackingItems] = useState<PackingItem[]>([]);
  const [checklist, setChecklist] = useState<DeliveryChecklistItem[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);

  // Temporary item inputs
  const [tempItemName, setTempItemName] = useState<string>('');
  const [tempItemQty, setTempItemQty] = useState<number>(1);
  const [tempItemPackType, setTempItemPackType] = useState<string>(settings.dropdownItems.packageTypes?.[0] || 'کارتن');
  const [tempItemWidth, setTempItemWidth] = useState<string>('');
  const [tempItemLength, setTempItemLength] = useState<string>('');
  const [tempItemHeight, setTempItemHeight] = useState<string>('');
  const [tempItemWeight, setTempItemWeight] = useState<number>(0);
  const [tempItemBoxNumber, setTempItemBoxNumber] = useState<string>('');

  // Selected Packing List Detail Modal
  const [selectedDelivery, setSelectedDelivery] = useState<PackagingDelivery | null>(null);
  const [isDetailModalFullscreen, setIsDetailModalFullscreen] = useState(false);
  const [overrideShowBrand, setOverrideShowBrand] = useState(false);

  React.useEffect(() => {
    if (selectedDelivery) {
      setOverrideShowBrand(!!settings.showProductBrandInDocuments);
    }
  }, [selectedDelivery, settings.showProductBrandInDocuments]);

  const getDeliveryActualDateLabel = (del: PackagingDelivery) => {
    if (del.actualDeliveryDate) return del.actualDeliveryDate;
    const dates = del.items?.map(item => item.actualDeliveryDate).filter(Boolean) || [];
    if (dates.length === 0) return 'در انتظار تحویل';
    const uniqueDates = Array.from(new Set(dates));
    if (uniqueDates.length === 1) return uniqueDates[0];
    return 'تفکیکی (تاریخ‌های متفاوت)';
  };

  const getRemainingPackingItems = (projId: string, profId: string, wonItems: any[]): PackingItem[] => {
    const previousDeliveries = packagingDeliveries.filter(
      d => d.projectId === projId && d.id !== editingDeliveryId
    );

    const shippedQtyMap: Record<string, number> = {};
    previousDeliveries.forEach(d => {
      d.items.forEach(item => {
        const key = item.productId || item.itemOrDocName.trim();
        shippedQtyMap[key] = (shippedQtyMap[key] || 0) + item.quantity;
      });
    });

    const items: PackingItem[] = [];
    
    wonItems.forEach((item, idx) => {
      const key = item.productId || item.productName.trim();
      const totalQty = item.quantity;
      let alreadyShipped = 0;

      if (shippedQtyMap[key] !== undefined) {
        const remainingShipped = shippedQtyMap[key];
        if (remainingShipped >= totalQty) {
          alreadyShipped = totalQty;
          shippedQtyMap[key] = remainingShipped - totalQty;
        } else {
          alreadyShipped = remainingShipped;
          shippedQtyMap[key] = 0;
        }
      }

      const remainingQty = totalQty - alreadyShipped;
      if (remainingQty > 0) {
        items.push({
          id: `pack-item-auto-${idx}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          itemOrDocName: item.productName,
          productId: item.productId,
          quantity: remainingQty,
          packageType: 'کارتن',
          dimensions: '50x40x30 سانتی‌متر',
          weight: 1,
          tagNumber: item.tagNumber
        });
      }
    });

    return items;
  };

  const getMaxAllowedQty = (item: PackingItem) => {
    if (!selectedProjectId) return Infinity;
    
    const key = item.productId || item.itemOrDocName.trim();
    
    let totalProformaQty = 0;
    
    const targetProformas = selectedProformaId 
      ? proformas.filter(p => p.id === selectedProformaId)
      : proformas.filter(p => {
          if (p.projectId !== selectedProjectId) return false;
          const status = getProformaOutcomeStatus(p);
          return status === 'تأیید شده (برنده)' || status === 'نیمه برنده';
        });

    targetProformas.forEach(p => {
      const wonItems = getWonItemsOfProforma(p, true);
      wonItems.forEach(wi => {
        const wiKey = wi.productId || wi.productName.trim();
        if (wiKey === key) {
          totalProformaQty += wi.quantity;
        }
      });
    });

    if (totalProformaQty === 0) return Infinity;

    const otherDeliveries = packagingDeliveries.filter(
      d => d.projectId === selectedProjectId && d.id !== editingDeliveryId
    );
    
    let alreadyShipped = 0;
    otherDeliveries.forEach(d => {
      d.items.forEach(di => {
        const diKey = di.productId || di.itemOrDocName.trim();
        if (diKey === key) {
          alreadyShipped += di.quantity;
        }
      });
    });

    return Math.max(0, totalProformaQty - alreadyShipped);
  };

  // Delete Modal State
  const [deleteDeliveryId, setDeleteDeliveryId] = useState<string | null>(null);
  const [deleteActivitiesWithDelivery, setDeleteActivitiesWithDelivery] = useState(false);

  // Filter won/approved proformas for the selected project
  const availableProformas = proformas.filter(p => {
    if (p.projectId !== selectedProjectId) return false;
    const outcome = getProformaOutcomeStatus(p);
    return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
  });

  // When project changes, auto-select first won proforma & auto-fill checklist & packing items
  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    
    // Initialize checklist with template from settings
    const template = settings.deliveryChecklistTemplate || [];
    setChecklist(
      template.map(text => ({
        name: text,
        completed: false
      }))
    );

    // Find first won/semi-won proforma of this project
    const projProformas = proformas.filter(p => {
      if (p.projectId !== projectId) return false;
      const outcome = getProformaOutcomeStatus(p);
      return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
    });

    const firstProf = projProformas[0];
    if (firstProf) {
      setSelectedProformaId(firstProf.id);
      const wonItems = getWonItemsOfProforma(firstProf, true);
      const defaultPackingItems = getRemainingPackingItems(projectId, firstProf.id, wonItems);
      setPackingItems(defaultPackingItems);
    } else {
      setSelectedProformaId('');
      setPackingItems([]);
    }
  };

  // When proforma changes, populate default packing items from its items
  const handleProformaChange = (proformaId: string) => {
    setSelectedProformaId(proformaId);
    if (!proformaId) {
      setPackingItems([]);
      return;
    }

    const prof = proformas.find(p => p.id === proformaId);
    if (prof) {
      const wonItems = getWonItemsOfProforma(prof, true);
      const defaultPackingItems = getRemainingPackingItems(selectedProjectId, proformaId, wonItems);
      setPackingItems(defaultPackingItems);
    }
  };

  // Upload Photo handler (Upload to Server)
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files) as File[];
      for (const file of filesArray) {
        try {
          const url = await uploadFile(file);
          setPhotos(prev => [...prev, url]);
        } catch (err: any) {
          console.error(err);
          alert(err.message || 'خطا در بارگذاری تصویر بسته‌بندی');
        }
      }
    }
    if (e.target) e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    if (isFieldRequired(settings, 'packagingDelivery', 'projectId') && !selectedProjectId) {
      alert('فیلد "پروژه" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'packagingDelivery', 'shippingMethod') && !shippingMethod) {
      alert('فیلد "نحوه ارسال کالا" الزامی است.');
      return;
    }
    if (isFieldRequired(settings, 'packagingDelivery', 'deliveryDate') && !deliveryDate) {
      alert('فیلد "تاریخ صدور پکینگ لیست" الزامی است.');
      return;
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const filesArray = Array.from(e.dataTransfer.files) as File[];
      for (const file of filesArray) {
        try {
          const url = await uploadFile(file);
          setPhotos(prev => [...prev, url]);
        } catch (err: any) {
          console.error(err);
          alert(err.message || 'خطا در بارگذاری تصویر بسته‌بندی');
        }
      }
    }
  };

  // Add custom item/document
  const handleAddCustomItem = () => {
    if (!tempItemName.trim()) {
      alert('لطفاً نام کالا یا مدرک را وارد کنید.');
      return;
    }

    const dimensions = tempItemLength && tempItemWidth && tempItemHeight 
      ? `${tempItemLength}x${tempItemWidth}x${tempItemHeight} سانتی‌متر` 
      : 'نامشخص';

    const newItem: PackingItem = {
      id: `pack-item-custom-${Date.now()}`,
      itemOrDocName: tempItemName.trim(),
      quantity: tempItemQty,
      packageType: tempItemPackType,
      dimensions,
      weight: tempItemWeight,
      boxNumber: tempItemBoxNumber
    };

    setPackingItems(prev => [...prev, newItem]);

    // Reset inputs
    setTempItemName('');
    setTempItemQty(1);
    setTempItemPackType(settings.dropdownItems.packageTypes?.[0] || 'کارتن');
    setTempItemLength('');
    setTempItemWidth('');
    setTempItemHeight('');
    setTempItemWeight(0);
    setTempItemBoxNumber('');
  };

  // Remove Packing Item
  const handleRemoveItem = (id: string) => {
    setPackingItems(prev => prev.filter(item => item.id !== id));
  };

  // Edit Packing Item inline field
  const handleUpdateItemField = (id: string, field: keyof PackingItem, value: any) => {
    setPackingItems(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const downloadPackagingDeliveryHTML = (delivery: PackagingDelivery) => {
    const template = activeTemplate;
    if (!template) return;
    
    // Group items by box
    const itemsByBox = delivery.items.reduce((acc, item) => {
      const box = item.boxNumber || 'اقلام بدون شماره جعبه';
      if (!acc[box]) acc[box] = [];
      acc[box].push(item);
      return acc;
    }, {} as Record<string, typeof delivery.items>);

    const itemsTables = Object.entries(itemsByBox).map(([box, items], boxIdx) => {
      const itemsRows = items.map((item, index) => {
        const prod = item.productId ? products.find(p => p.id === item.productId) : undefined;
        const brandStr = overrideShowBrand && prod?.brand ? ` (${prod.brand})` : '';
        const tagStr = item.tagNumber ? ` <span style="font-family: monospace; font-size: 10px; color: #dc2626; background-color: #fef2f2; border: 1px solid #fee2e2; padding: 2px 6px; border-radius: 4px; margin-right: 8px;">تگ: ${item.tagNumber}</span>` : '';
        const displayedName = `${item.itemOrDocName}${brandStr}${tagStr}`;
        return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 12px; text-align: center; font-family: monospace;">${index + 1}</td>
          <td style="padding: 12px; font-weight: bold; color: #1e293b;">${displayedName}</td>
          <td style="padding: 12px; text-align: center; font-family: monospace; font-weight: bold;">${item.quantity}</td>
          <td style="padding: 12px; text-align: center;">${item.packageType}</td>
          <td style="padding: 12px; text-align: left; font-family: monospace;" dir="ltr">${item.dimensions}</td>
          <td style="padding: 12px; text-align: center; font-family: monospace;">${item.weight} Kg</td>
          <td style="padding: 12px; text-align: center; font-family: monospace; font-weight: bold; color: #059669;">${item.actualDeliveryDate || delivery.actualDeliveryDate || 'در انتظار تحویل'}</td>
        </tr>
        `;
      }).join('');

      return `
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
          <div style="background-color: #f1f5f9; padding: 10px; font-weight: bold; font-size: 12px; border-bottom: 1px solid #cbd5e1;">
            بسته‌بندی / جعبه: ${box}
          </div>
          <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 11px;">
            <thead style="background-color: #f8fafc; color: #64748b;">
              <tr>
                <th style="padding: 12px; width: 40px;">ردیف</th>
                <th style="padding: 12px;">کالا / تجهیز / سند</th>
                <th style="padding: 12px; text-align: center; width: 60px;">تعداد</th>
                <th style="padding: 12px; width: 100px;">نوع بسته‌بندی</th>
                <th style="padding: 12px; width: 140px;">ابعاد بسته‌بندی</th>
                <th style="padding: 12px; text-align: center; width: 100px;">وزن (کیلوگرم)</th>
                <th style="padding: 12px; text-align: center; width: 120px;">تاریخ تحویل قطعی</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    

    const preDeliveryNotes = delivery.preDeliveryTestNotes ? `
      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 12px; font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 10px;">گزارش تست قبل از تحویل تجهیز</h4>
        <div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 11px; line-height: 1.6;">
          ${delivery.preDeliveryTestNotes}
        </div>
      </div>
    ` : '';

    const htmlContent = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>پکینگ لیست - ${delivery.packingListNumber}</title>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" type="text/css" />
    <style>
        body {
            font-family: 'Vazirmatn', sans-serif;
            color: #0f172a;
            line-height: 1.5;
            margin: 0;
            padding: 40px;
            background-color: #f8fafc;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid ${template.titleColor || '#0ea5e9'};
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
            margin-top: 4px;
        }
        .title-box {
            text-align: left;
        }
        .title {
            font-size: 20px;
            font-weight: 800;
            margin: 0;
            color: ${template.titleColor || '#0ea5e9'};
        }
        .doc-subtitle {
            font-size: 11px;
            color: #64748b;
            margin-top: 4px;
        }
        .meta-box {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            background-color: #f8fafc;
            padding: 16px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            margin-bottom: 24px;
            font-size: 11px;
        }
        .meta-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .meta-label {
            color: #64748b;
        }
        .meta-value {
            font-weight: bold;
            color: #0f172a;
        }
        .signatures {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-top: 40px;
            text-align: center;
        }
        .signature-box {
            border: 1px dashed #cbd5e1;
            border-radius: 8px;
            height: 100px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            background-color: #f8fafc;
        }
        .signature-title {
            font-weight: bold;
            font-size: 12px;
            margin-bottom: 12px;
            color: #334155;
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
                ${template.showLogo ? `
                ${template.logoUrl ? `
                    <img src="${template.logoUrl}" alt="${template.companyName}" style="width: 48px; height: 48px; object-fit: contain; border-radius: 8px; border: 1px solid #cbd5e1; background-color: #ffffff;" referrerPolicy="no-referrer" />
                ` : `
                    <div class="logo">ATA</div>
                `}
                <div>
                    <h4 class="company-name">${template.companyName}</h4>
                    <p class="subtitle">تامین تجهیزات اتوماسیون و ابزاردقیق</p>
                </div>
                ` : ''}
            </div>
            
            <div class="title-box">
                <h1 class="title">پکینگ لیست استاندارد کالا (Packing List)</h1>
                <p class="doc-subtitle">مجموعه اسناد رسمی ترخیص و لجستیک</p>
            </div>
        </div>

        <div class="meta-box">
            <div class="meta-item"><span class="meta-label">شماره پکینگ لیست:</span> <span class="meta-value">${delivery.packingListNumber}</span></div>
            <div class="meta-item"><span class="meta-label">تاریخ صدور پکینگ لیست:</span> <span class="meta-value font-mono">${delivery.deliveryDate}</span></div>
            ${delivery.actualDeliveryDate ? `<div class="meta-item"><span class="meta-label">تاریخ تحویل کالا:</span> <span class="meta-value font-mono">${delivery.actualDeliveryDate}</span></div>` : ''}
            <div class="meta-item"><span class="meta-label">روش ارسال و تحویل:</span> <span class="meta-value">${delivery.shippingMethod}</span></div>
            <div class="meta-item"><span class="meta-label">پروژه (کارفرما):</span> <span class="meta-value">${delivery.projectName}</span></div>
            ${delivery.proformaNumber ? `<div class="meta-item"><span class="meta-label">پیش‌فاکتور مرجع:</span> <span class="meta-value font-mono">${delivery.proformaNumber}</span></div>` : ''}
            <div class="meta-item"><span class="meta-label">مسئول ثبت و کنترل:</span> <span class="meta-value">${currentUser?.fullName || 'مسئول انبار و لجستیک'}</span></div>
        </div>

        
        

        <div style="margin-bottom: 20px;">
            <h4 style="font-size: 12px; font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 10px;">لیست کالاها و عدل‌بندی بسته‌بندی</h4>
            ${itemsTables}
        </div>

        <div class="signatures">
            <div>
                <div class="signature-title">امضا و تایید تحویل‌گیرنده (کارفرما):</div>
                <div class="signature-box"></div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 8px; font-family: monospace;">نام و نام خانوادگی / تاریخ تحویل</div>
            </div>
            <div>
                <div class="signature-title">مسئول انبار و تایید خروج کالا:</div>
                <div class="signature-box" style="display: flex; flex-direction: row; gap: 16px; align-items: center; justify-content: center;">
                    ${template.companySealUrl ? `<img src="${template.companySealUrl}" style="height: 80px; object-fit: contain;" />` : ''}
                    ${currentUser?.signatureImage ? `<img src="${currentUser.signatureImage}" style="max-height: 60px; max-width: 120px; object-fit: contain;" />` : ''}
                </div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 8px; font-family: monospace;">${currentUser?.fullName || ''}</div>
            </div>
        </div>
        
        ${template.footerText ? `
        <div style="text-align: center; font-size: 10px; color: #64748b; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
            ${template.footerText}
        </div>
        ` : ''}
    </div>

    <!-- Running print footer repeating on all pages when printing -->
    <div class="print-footer">
        <div class="print-footer-info">
            <div><strong>آدرس شرکت:</strong> ${template.address || '-'}</div>
            <div><strong>تلفن تماس:</strong> ${template.phone || '-'}</div>
            <div><strong>پست الکترونیکی:</strong> ${template.email || '-'}</div>
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

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `پکینگ_لیست_${delivery.packingListNumber}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  // Load delivery into form for editing
  const handleEditDelivery = (delivery: PackagingDelivery) => {
    setEditingDeliveryId(delivery.id);
    setSelectedProjectId(delivery.projectId);
    setSelectedProformaId(delivery.proformaId || '');
    setDeliveryDate(delivery.deliveryDate);
    setActualDeliveryDate(delivery.actualDeliveryDate || '');
    setShippingMethod(delivery.shippingMethod);
    setPreDeliveryTestNotes(delivery.preDeliveryTestNotes || '');
    setPackingItems(delivery.items);
    setChecklist(delivery.checklist);
    setPhotos(delivery.photos || []);

    const hasItemizedDates = delivery.items?.some(
      item => item.actualDeliveryDate && item.actualDeliveryDate !== delivery.actualDeliveryDate
    );
    setUseItemizedDeliveryDates(!!hasItemizedDates);

    setActiveTab('new');
  };

  // Submit delivery info
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      alert('لطفاً پروژه مرتبط را انتخاب کنید.');
      return;
    }
    if (packingItems.length === 0) {
      alert('حداقل یک کالا یا سند باید در پکینگ لیست وجود داشته باشد.');
      return;
    }

    // Validate quantities against maximum allowed remaining quantities from proformas
    for (const item of packingItems) {
      const maxAllowed = getMaxAllowedQty(item);
      if (item.quantity > maxAllowed && maxAllowed !== Infinity) {
        const confirmOverQty = window.confirm(
          `هشدار مغایرت پکینگ لیست:\n` +
          `تعداد وارد شده برای "${item.itemOrDocName}" (${item.quantity} عدد) بیشتر از مقدار مجاز باقی‌مانده پیش‌فاکتور (${maxAllowed} عدد) است.\n` +
          `آیا اطمینان دارید که می‌خواهید این تعداد مازاد را ثبت و ارسال کنید؟`
        );
        if (!confirmOverQty) {
          return;
        }
      }
    }

    const proj = projects.find(p => p.id === selectedProjectId);
    const prof = proformas.find(p => p.id === selectedProformaId);

    const cleanItems = packingItems.map(item => ({
      ...item,
      actualDeliveryDate: useItemizedDeliveryDates ? (item.actualDeliveryDate || '') : ''
    }));

    const finalActualDeliveryDate = useItemizedDeliveryDates ? '' : actualDeliveryDate;

    // Quality Control Checklist Validation on Delivery
    const isMarkedAsDelivered = useItemizedDeliveryDates 
      ? cleanItems.some(item => !!item.actualDeliveryDate) 
      : !!finalActualDeliveryDate;

    const hasIncompleteChecklist = checklist.some(c => !c.completed);

    if (isMarkedAsDelivered && hasIncompleteChecklist) {
      const incompleteItems = checklist.filter(c => !c.completed).map(c => `- ${c.taskName}`);
      const confirmDeliv = window.confirm(
        `هشدار کنترل کیفیت (QC):\n` +
        `مواردی از چک‌لیست بسته‌بندی و فنی هنوز تایید نهایی نشده‌اند:\n` +
        `${incompleteItems.join('\n')}\n\n` +
        `ثبت تاریخ تحویل واقعی به منزله خروج نهایی کالا از کارخانه یا انبار است.\n` +
        `آیا اطمینان دارید که می‌خواهید کالا را قبل از تایید نهایی کیفیت تحویل دهید؟`
      );
      if (!confirmDeliv) {
        return;
      }
    }

    // Shipping tracking and driver details validation
    const nonLocalShipping = ['باربری', 'تیپاکس', 'پست پیشتاز', 'هواپیمایی'];
    if (isMarkedAsDelivered && nonLocalShipping.includes(shippingMethod)) {
      const notesClean = (preDeliveryTestNotes || '').trim();
      const hasTrackingKeywords = /بارنامه|راننده|رهگیری|پست|تیپاکس|کد|شماره|پلاک/g.test(notesClean);
      const hasDigits = /\d+/g.test(notesClean);
      
      if (!notesClean || notesClean.length < 10 || (!hasTrackingKeywords && !hasDigits)) {
        const confirmTracking = window.confirm(
          `هشدار اطلاعات حمل و نقل:\n` +
          `روش ارسال کالا روی «${shippingMethod}» تنظیم شده است، اما اطلاعات بارنامه، نام راننده یا کد رهگیری معتبری در بخش گزارش تست و ارسال ثبت نشده است.\n\n` +
          `ثبت شماره بارنامه یا مشخصات راننده جهت پیگیری‌های بعدی و شفافیت مالی مشتری الزامی است.\n` +
          `آیا اطمینان دارید که می‌خواهید تحویل کالا را بدون این اطلاعات ثبت کنید؟`
        );
        if (!confirmTracking) {
          return;
        }
      }
    }

    if (editingDeliveryId) {
      const existingDelivery = packagingDeliveries.find(d => d.id === editingDeliveryId);
      if (existingDelivery) {
        updatePackagingDelivery({
          ...existingDelivery,
          projectId: selectedProjectId,
          projectName: proj?.name || '',
          proformaId: selectedProformaId || undefined,
          proformaNumber: prof?.proformaNumber || undefined,
          deliveryDate,
          actualDeliveryDate: finalActualDeliveryDate,
          shippingMethod,
          preDeliveryTestNotes,
          checklist,
          items: cleanItems,
          photos
        });
      }
    } else {
      const deliveryData = {
        projectId: selectedProjectId,
        projectName: proj?.name || '',
        proformaId: selectedProformaId || undefined,
        proformaNumber: prof?.proformaNumber || undefined,
        deliveryDate,
        actualDeliveryDate: finalActualDeliveryDate,
        shippingMethod,
        preDeliveryTestNotes,
        checklist,
        items: cleanItems,
        photos
      };
      addPackagingDelivery(deliveryData);
    }

    // Reset Form
    setEditingDeliveryId(null);
    setSelectedProjectId('');
    setSelectedProformaId('');
    setDeliveryDate(getTodayShamsi());
    setActualDeliveryDate('');
    setUseItemizedDeliveryDates(false);
    setShippingMethod(settings.dropdownItems.shippingMethods?.[0] || 'باربری');
    setPreDeliveryTestNotes('');
    setPackingItems([]);
    setChecklist([]);
    setPhotos([]);

    setActiveTab('list');
  };

  // Filter deliveries
  const filteredDeliveries = packagingDeliveries.filter(d => {
    const matchesProject = !filterProject || d.projectId === filterProject;
    const matchesSearch = !searchTerm || 
      d.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.packingListNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.shippingMethod.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesProject && matchesSearch;
  });

  // Calculate stats
  const totalLists = packagingDeliveries.length;
  const totalPackages = packagingDeliveries.reduce((acc, d) => acc + d.items.length, 0);

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Header & Stats Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-150 shadow-sm">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Package className="text-emerald-500" size={26} />
            بسته‌بندی و تحویل کالا (پکینگ لیست)
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            کنترل اقلام بسته‌بندی، تست کارکرد قبل از تحویل تجهیزات، ثبت چک‌لیست بازرسی و صادرکننده شناسنامه و پکینگ لیست استاندارد
          </p>
        </div>

        <div className="flex gap-4">
          <div className="bg-emerald-50/50 px-4 py-2.5 rounded-xl border border-emerald-100 flex items-center gap-3">
            <div className="text-emerald-600 font-extrabold text-2xl">{totalLists}</div>
            <div className="text-xs text-emerald-800">کل پکینگ لیست‌ها</div>
          </div>
          <div className="bg-sky-50/50 px-4 py-2.5 rounded-xl border border-sky-100 flex items-center gap-3">
            <div className="text-sky-600 font-extrabold text-2xl">{totalPackages}</div>
            <div className="text-xs text-sky-800">کل بسته‌های ثبت شده</div>
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-6 py-3 font-semibold text-sm transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'list' 
              ? 'border-emerald-500 text-emerald-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <FileText size={18} />
          لیست پکینگ لیست‌های صادر شده
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-6 py-3 font-semibold text-sm transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'new' 
              ? 'border-emerald-500 text-emerald-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Plus size={18} />
          ثبت بسته‌بندی و صدور پکینگ لیست جدید
        </button>
      </div>

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">فیلتر پروژه</label>
              <select
                value={filterProject}
                onChange={e => setFilterProject(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="">همه پروژه‌ها</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>

            <div className="relative md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">جستجو متنی</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="جستجو بر اساس شماره پکینگ لیست، پروژه، روش ارسال..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-xs font-medium focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <Search size={16} className="absolute right-3 top-2.5 text-slate-400" />
              </div>
            </div>
          </div>

          {/* List items */}
          {filteredDeliveries.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto">
                <Package size={32} />
              </div>
              <h3 className="font-bold text-slate-700">هیچ پکینگ لیستی یافت نشد</h3>
              <p className="text-xs text-slate-400">اطلاعات بسته‌بندی و تحویلی در سیستم وجود ندارد.</p>
              <button 
                onClick={() => setActiveTab('new')} 
                className="mt-2 bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-emerald-600 transition"
              >
                صدور اولین پکینگ لیست کالا
              </button>
            </div>
          ) : (() => {
            const groupedDeliveriesMap: Record<string, { projectId: string; projectName: string; deliveries: PackagingDelivery[] }> = {};
            
            filteredDeliveries.forEach(delivery => {
              const pId = delivery.projectId;
              if (!groupedDeliveriesMap[pId]) {
                groupedDeliveriesMap[pId] = {
                  projectId: pId,
                  projectName: delivery.projectName,
                  deliveries: []
                };
              }
              groupedDeliveriesMap[pId].deliveries.push(delivery);
            });
            
            const groupedDeliveriesList = Object.values(groupedDeliveriesMap);

            return (
              <div className="space-y-4 w-full">
                {groupedDeliveriesList.map(projectGroup => {
                  const totalItemsPacked = projectGroup.deliveries.reduce((sum, d) => sum + d.items.length, 0);
                  const isCollapsed = !!collapsedProjects[projectGroup.projectId];
                  
                  const toggleCollapse = () => {
                    setCollapsedProjects(prev => ({
                      ...prev,
                      [projectGroup.projectId]: !prev[projectGroup.projectId]
                    }));
                  };

                  return (
                    <div 
                      key={projectGroup.projectId}
                      className="bg-white p-5 rounded-2xl border border-slate-150 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col hover:border-emerald-200 w-full"
                    >
                      <div className="w-full">
                        {/* Project Name Header */}
                        <div 
                          onClick={toggleCollapse}
                          className={`flex items-center justify-between cursor-pointer select-none gap-3 group/header ${
                            isCollapsed ? '' : 'border-b border-slate-100 pb-3'
                          }`}
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <h3 className="font-bold text-slate-800 text-sm leading-snug flex items-center gap-1.5 truncate group-hover/header:text-emerald-600 transition-colors">
                              <Briefcase className="text-emerald-500 shrink-0" size={16} />
                              {projectGroup.projectName}
                            </h3>
                            <div className="text-[10px] text-slate-400 font-medium">
                              تعداد پکینگ لیست‌ها: {projectGroup.deliveries.length} عدد
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-150 font-bold">
                              {totalItemsPacked} ردیف کالا
                            </span>
                            {isCollapsed ? (
                              <ChevronDown size={16} className="text-slate-400 group-hover/header:text-slate-600 transition-colors" />
                            ) : (
                              <ChevronUp size={16} className="text-slate-400 group-hover/header:text-slate-600 transition-colors" />
                            )}
                          </div>
                        </div>

                        {/* Deliveries / Packings List within this Project */}
                        {!isCollapsed && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
                            {projectGroup.deliveries.map((delivery) => {
                              const checkedCount = delivery.checklist.filter(c => c.completed).length;
                              const totalChecklist = delivery.checklist.length;
                              return (
                                <div 
                                  key={delivery.id} 
                                  className="bg-slate-50/40 hover:bg-slate-50 rounded-xl p-3.5 border border-slate-150 hover:border-emerald-200 hover:shadow-2xs transition-all duration-150 flex flex-col justify-between space-y-3"
                                >
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[11px] font-extrabold bg-white text-slate-800 border border-slate-200 px-2.5 py-0.5 rounded-md font-mono shadow-3xs">
                                        {delivery.packingListNumber}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                                        <Calendar size={12} />
                                        {delivery.deliveryDate}
                                      </span>
                                    </div>

                                    {delivery.proformaNumber && (
                                      <div className="text-[10px] text-slate-500 font-medium">
                                        پیش‌فاکتور: <span className="font-mono text-slate-700">{delivery.proformaNumber}</span>
                                      </div>
                                    )}

                                    {/* Dates Timeline */}
                                    <div className="bg-white p-2 rounded-lg border border-slate-100 space-y-1 text-[10px]">
                                      <div className="flex justify-between text-slate-500">
                                        <span>📦 صدور پکینگ لیست:</span>
                                        <span className="font-mono font-bold text-slate-700">{delivery.deliveryDate}</span>
                                      </div>
                                      <div className="flex justify-between text-slate-500">
                                        <span>🤝 تحویل به مشتری:</span>
                                        <span className="font-mono font-bold text-emerald-600">
                                          {getDeliveryActualDateLabel(delivery)}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-600">
                                      <span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded border border-sky-100 flex items-center gap-1">
                                        <Truck size={10} />
                                        {delivery.shippingMethod}
                                      </span>
                                      <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 flex items-center gap-1">
                                        {delivery.items.length} قلم کالا
                                      </span>
                                    </div>

                                    {totalChecklist > 0 && (
                                      <div className="space-y-1 pt-1">
                                        <div className="flex justify-between items-center text-[9px] text-slate-500">
                                          <span>پیشرفت بازرسی تحویل:</span>
                                          <span className="font-bold">{checkedCount} از {totalChecklist}</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                                          <div 
                                            className="bg-emerald-500 h-1 transition-all"
                                            style={{ width: `${(checkedCount / totalChecklist) * 100}%` }}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Actions for this specific delivery */}
                                  <div className="flex justify-between items-center pt-2 border-t border-slate-100/60 mt-auto">
                                    <button
                                      onClick={() => setSelectedDelivery(delivery)}
                                      className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[10px] px-2.5 py-1 rounded-lg transition flex items-center gap-1"
                                    >
                                      <Info size={12} />
                                      مشاهده و چاپ
                                    </button>

                                    <div className="flex gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEditDelivery(delivery);
                                        }}
                                        className="text-sky-500 hover:text-sky-600 hover:bg-sky-50 p-1 rounded transition-all"
                                        title="ویرایش پکینگ لیست"
                                      >
                                        <Edit size={13} />
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeleteDeliveryId(delivery.id);
                                        }}
                                        className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 p-1 rounded transition-all"
                                        title="حذف پکینگ لیست"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* NEW REGISTRATION FORM */}
      {activeTab === 'new' && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border border-slate-150 shadow-sm space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-150">
            <Package size={22} className="text-emerald-500" />
            <h2 className="text-base font-bold text-slate-800">ثبت مشخصات بسته‌بندی و تحویل جدید</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Project dropdown */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">{renderFieldLabelWithAsterisk(settings, 'packagingDelivery', 'projectId', 'انتخاب پروژه')}</label>
              <select
                value={selectedProjectId}
                onChange={e => handleProjectChange(e.target.value)}
                required={isFieldRequired(settings, 'packagingDelivery', 'projectId')}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="">-- انتخاب پروژه --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
              {selectedProjectId && (
                <div className="mt-2">
                  <CustomerAgreementAlert 
                    customer={customers?.find(c => c.id === projects?.find(p => p.id === selectedProjectId)?.customerId)} 
                    moduleName="packaging" 
                  />
                </div>
              )}
            </div>

            {/* Approved Proformas dropdown */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">پیش‌فاکتور تایید شده مرتبط</label>
              <select
                value={selectedProformaId}
                onChange={e => handleProformaChange(e.target.value)}
                disabled={!selectedProjectId}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">-- بدون پیش‌فاکتور مرتبط (ثبت دستی اقلام) --</option>
                {availableProformas.map(p => (
                  <option key={p.id} value={p.id}>پیش‌فاکتور {p.proformaNumber}</option>
                ))}
              </select>
            </div>

            {/* Delivery Date */}
            <div className="space-y-1">
              <ShamsiDatePicker
                label={`تاریخ صدور پکینگ لیست${getFieldAsterisk(settings, 'packagingDelivery', 'deliveryDate')}`}
                required={isFieldRequired(settings, 'packagingDelivery', 'deliveryDate')}
                value={deliveryDate}
                onChange={setDeliveryDate}
              />
            </div>

            {/* Delivery Date Configuration Type & Picker */}
            <div className="space-y-2 md:col-span-2 bg-slate-50/50 p-3 rounded-xl border border-slate-200/60">
              <label className="block text-xs font-bold text-slate-700">نحوه ثبت تاریخ تحویل به مشتری</label>
              <div className="flex gap-4 mb-2 text-[11px] font-medium text-slate-600">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="delivery_date_type"
                    checked={!useItemizedDeliveryDates}
                    onChange={() => setUseItemizedDeliveryDates(false)}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>یکسان برای همه اقلام (کلی)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="delivery_date_type"
                    checked={useItemizedDeliveryDates}
                    onChange={() => setUseItemizedDeliveryDates(true)}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>مجزا برای هر ردیف (تفکیکی)</span>
                </label>
              </div>

              {!useItemizedDeliveryDates ? (
                <ShamsiDatePicker
                  label="تاریخ تحویل به مشتری"
                  value={actualDeliveryDate}
                  onChange={setActualDeliveryDate}
                  placeholder="انتخاب تاریخ"
                />
              ) : (
                <div className="p-2 bg-amber-50 text-amber-800 rounded-lg text-[10px] border border-amber-100 font-medium">
                  ⚠️ تاریخ تحویل قطعی برای هر کالا به طور مستقیم در جدول اقلام زیر ثبت می‌شود.
                </div>
              )}
            </div>

            {/* Shipping Method */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">{renderFieldLabelWithAsterisk(settings, 'packagingDelivery', 'shippingMethod', 'نحوه ارسال کالا')}</label>
              <select
                value={shippingMethod}
                onChange={e => setShippingMethod(e.target.value)}
                required={isFieldRequired(settings, 'packagingDelivery', 'shippingMethod')}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                {settings.dropdownItems.shippingMethods?.map((method, index) => (
                  <option key={index} value={method}>{method}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Checklist Area */}
          {checklist.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-3">
              <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2">
                <FileCheck className="text-emerald-500" size={16} />
                <span className="text-xs font-bold text-slate-700">چک‌لیست کنترل و بازرسی تحویل کالا (الگو)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {checklist.map((item, index) => (
                  <label 
                    key={index} 
                    className="flex items-center gap-2.5 p-3 bg-white border border-slate-150 rounded-xl hover:bg-emerald-50/20 cursor-pointer transition select-none"
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(e) => {
                        const updated = [...checklist];
                        updated[index].completed = e.target.checked;
                        updated[index].completedAt = e.target.checked ? getTodayShamsi() : undefined;
                        setChecklist(updated);
                      }}
                      className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs text-slate-700 font-medium">{item.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Test report textarea */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 flex items-center gap-1">
              <ClipboardCheck size={15} className="text-emerald-500" />
              ثبت گزارش تست‌های انجام شده قبل از تحویل
            </label>
            <textarea
              rows={3}
              value={preDeliveryTestNotes}
              onChange={e => setPreDeliveryTestNotes(e.target.value)}
              placeholder="مثال: تست عایق الکتریکی با دستگاه مگر انجام شد و تایید گردید. همچنین بردهای کالیبراسیون بررسی و گواهی کالیبراسیون در جعبه کالا قرار گرفت."
              className="w-full border border-slate-200 rounded-xl p-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none leading-relaxed"
            />
          </div>

          {/* Packing items manager */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Package size={15} className="text-emerald-500" />
                لیست اقلام پکینگ لیست (لیست عدل‌بندی)
              </h3>
              <span className="text-[11px] text-slate-500 font-medium">مجموع اقلام: {packingItems.length} ردیف</span>
            </div>

            <div className="p-4 space-y-4">
              {/* Dynamic Table or Inputs */}
              {packingItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl">
                  آیتمی در پکینگ لیست ثبت نشده است. از کادر زیر برای اضافه کردن استفاده کنید.
                </div>
              ) : (
                <div className={`overflow-x-auto ${useItemizedDeliveryDates ? 'min-h-[280px]' : ''}`}>
                  <table className="w-full text-xs text-right border-collapse">
                    <thead>
                      <tr className="border-b border-slate-150 text-slate-400 font-bold bg-slate-50/40">
                        <th className="p-2 w-8">ردیف</th>
                        <th className="p-2">کالا یا مدرک ارسالی</th>
                        <th className="p-2 w-20">تعداد</th>
                        <th className="p-2 w-28">نوع بسته‌بندی</th>
                        <th className="p-2 w-44">ابعاد (طولxعرضxارتفاع)</th>
                        <th className="p-2 w-24">وزن (کیلوگرم)</th>
                        <th className="p-2 w-24">شماره جعبه</th>
                        {useItemizedDeliveryDates && <th className="p-2 w-32">تاریخ تحویل قطعی</th>}
                        <th className="p-2 w-10 text-center">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {packingItems.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-slate-50/40">
                          <td className="p-2 text-slate-400 font-mono">{idx + 1}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.itemOrDocName}
                              onChange={e => handleUpdateItemField(item.id, 'itemOrDocName', e.target.value)}
                              className="w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white rounded px-1.5 py-1 text-xs font-medium"
                            />
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[9px] text-slate-500 whitespace-nowrap">تگ نامبر:</span>
                              <input
                                type="text"
                                value={item.tagNumber || ''}
                                onChange={e => handleUpdateItemField(item.id, 'tagNumber', e.target.value)}
                                placeholder="مثال: PIT-101"
                                className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[9px] bg-white font-mono text-right"
                              />
                            </div>
                          </td>
                          <td className="p-2">
                            {(() => {
                              const maxAllowed = getMaxAllowedQty(item);
                              const isOver = item.quantity > maxAllowed && maxAllowed !== Infinity;
                              return (
                                <>
                                  <input
                                    type="number"
                                    value={item.quantity}
                                    onChange={e => handleUpdateItemField(item.id, 'quantity', Number(e.target.value))}
                                    className={`w-full border rounded px-1.5 py-1 text-xs text-center transition-colors ${
                                      isOver 
                                        ? 'border-rose-400 bg-rose-50 text-rose-700 focus:border-rose-500 focus:ring-1 focus:ring-rose-500' 
                                        : 'border-slate-200 focus:border-emerald-500'
                                    }`}
                                  />
                                  {maxAllowed !== Infinity && (
                                    <div className={`text-[9px] mt-1 text-center font-bold ${isOver ? 'text-rose-600' : 'text-slate-400'}`}>
                                      حداکثر مجاز: {maxAllowed}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          <td className="p-2">
                            <select
                              value={item.packageType}
                              onChange={e => handleUpdateItemField(item.id, 'packageType', e.target.value)}
                              className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs"
                            >
                              {settings.dropdownItems.packageTypes?.map((pt, i) => (
                                <option key={i} value={pt}>{pt}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.dimensions}
                              placeholder="۵۰x۴۰x۳۰ سانتی‌متر"
                              onChange={e => handleUpdateItemField(item.id, 'dimensions', e.target.value)}
                              className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs font-mono text-left"
                              dir="ltr"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              value={item.weight}
                              onChange={e => handleUpdateItemField(item.id, 'weight', Number(e.target.value))}
                              className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs text-center"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.boxNumber || ''}
                              onChange={e => handleUpdateItemField(item.id, 'boxNumber', e.target.value)}
                              placeholder="جعبه ۱"
                              className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs text-center"
                            />
                          </td>
                          {useItemizedDeliveryDates && (
                            <td className="p-2">
                              <ShamsiDatePicker
                                value={item.actualDeliveryDate || ''}
                                onChange={val => handleUpdateItemField(item.id, 'actualDeliveryDate', val)}
                                placeholder="۱۴۰۵/۰۵/۱۲"
                                compact
                              />
                            </td>
                          )}
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              className="text-rose-500 hover:text-rose-600 p-1 rounded hover:bg-rose-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add Custom Item / Doc Block */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 space-y-3">
                <div className="text-xs font-bold text-slate-700">افزودن کالا، مدارک یا وسایل جانبی متفرقه</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">نام کالا یا مستندات (مثال: شناسنامه گارانتی)</label>
                    <input
                      type="text"
                      value={tempItemName}
                      onChange={e => setTempItemName(e.target.value)}
                      placeholder="کاتالوگ، قطعه یدکی، نقشه فونداسیون..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 block">تعداد</label>
                      <input
                        type="number"
                        value={tempItemQty}
                        onChange={e => setTempItemQty(Number(e.target.value))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 block">نوع بسته‌بندی</label>
                      <select
                        value={tempItemPackType}
                        onChange={e => setTempItemPackType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                      >
                        {settings.dropdownItems.packageTypes?.map((pt, idx) => (
                          <option key={idx} value={pt}>{pt}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 items-end">
                    <div className="col-span-3 space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 block">ابعاد (طولxعرضxارتفاع) به سانتی‌متر</label>
                      <div className="flex gap-1 items-center" dir="ltr">
                        <input
                          type="text"
                          placeholder="طول"
                          value={tempItemLength}
                          onChange={e => setTempItemLength(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg py-1.5 text-xs text-center focus:outline-none font-mono"
                        />
                        <span className="text-[10px] text-slate-400">x</span>
                        <input
                          type="text"
                          placeholder="عرض"
                          value={tempItemWidth}
                          onChange={e => setTempItemWidth(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg py-1.5 text-xs text-center focus:outline-none font-mono"
                        />
                        <span className="text-[10px] text-slate-400">x</span>
                        <input
                          type="text"
                          placeholder="ارتفاع"
                          value={tempItemHeight}
                          onChange={e => setTempItemHeight(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg py-1.5 text-xs text-center focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 block">وزن (Kg)</label>
                      <input
                        type="number"
                        placeholder="وزن"
                        value={tempItemWeight || ''}
                        onChange={e => setTempItemWeight(Number(e.target.value))}
                        className="w-full border border-slate-200 rounded-lg py-1.5 text-xs text-center focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 block">شماره جعبه/پالت</label>
                      <input
                        type="text"
                        placeholder="شماره جعبه"
                        value={tempItemBoxNumber || ''}
                        onChange={e => setTempItemBoxNumber(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg py-1.5 text-xs text-center focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={handleAddCustomItem}
                      className="w-full bg-slate-700 text-white rounded-lg py-2 text-xs font-bold transition hover:bg-slate-800 flex items-center justify-center gap-1 shrink-0"
                    >
                      <Plus size={14} />
                      افزودن به لیست عدل‌بندی
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Photo upload section */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">بارگذاری تصاویر بسته‌بندی، سلامت تجهیز و فرآیند بارگیری کالا</label>
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-slate-300 hover:border-emerald-400 bg-slate-50/50 rounded-2xl p-6 text-center transition cursor-pointer group"
              onClick={() => document.getElementById('photo-upload-input')?.click()}
            >
              <input
                type="file"
                id="photo-upload-input"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <Upload className="mx-auto text-slate-400 group-hover:text-emerald-500 transition-colors mb-2" size={32} />
              <div className="text-xs font-bold text-slate-600 group-hover:text-slate-800 transition-colors">
                انتخاب تصویر (تصاویر بسته‌بندی، پلاک دستگاه، فیش ترخیص و بارگیری)
              </div>
              <div className="text-[10px] text-slate-400 mt-1">می‌توانید فایل‌های تصویری خود را مستقیماً به اینجا بکشید و رها کنید.</div>
            </div>

            {/* Photos Preview Grid */}
            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-3">
                {photos.map((photo, idx) => (
                  <div key={idx} className="relative group rounded-xl overflow-hidden border border-slate-200 shadow-xs aspect-square">
                    <img referrerPolicy="no-referrer" src={photo} alt={`pack-${idx}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhotos(prev => prev.filter((_, i) => i !== idx));
                      }}
                      className="absolute top-1 right-1 bg-red-600 text-white p-1 rounded-full opacity-90 group-hover:opacity-100 transition shadow-sm hover:scale-110"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex gap-2 justify-end border-t border-slate-100 pt-4 bg-slate-50/20">
            <button
              type="submit"
              className="bg-emerald-600 text-white font-extrabold text-xs px-6 py-3 rounded-xl hover:bg-emerald-700 transition shadow-sm"
            >
              ثبت و صدور پکینگ لیست کالا
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('list');
              }}
              className="bg-slate-100 text-slate-600 font-bold text-xs px-6 py-3 rounded-xl hover:bg-slate-200 transition"
            >
              انصراف
            </button>
          </div>
        </form>
      )}

      {/* DETAIL MODAL WITH PRINT CAPABILITY */}
      {selectedDelivery && (
        <div className={`fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 overflow-y-auto ${isDetailModalFullscreen ? 'p-0' : 'p-4'}`} dir="rtl">
          <div className={`bg-white shadow-2xl flex flex-col justify-between overflow-hidden animate-fade-in relative transition-all duration-300 ${
            isDetailModalFullscreen 
              ? 'w-screen h-screen rounded-none max-w-full max-h-screen' 
              : 'rounded-2xl w-full max-w-4xl max-h-[90vh]'
          }`}>
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-150 flex justify-between items-center bg-slate-50/80 no-print">
              <div className="flex items-center gap-2">
                <Package className="text-emerald-500" size={20} />
                <h3 className="font-extrabold text-slate-800 text-sm md:text-base">
                  پکینگ لیست کالا - {selectedDelivery.packingListNumber}
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsDetailModalFullscreen(!isDetailModalFullscreen)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl transition hover:bg-slate-200/55 flex items-center justify-center"
                  title={isDetailModalFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
                >
                  {isDetailModalFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button
                  onClick={() => { setSelectedDelivery(null); setIsDetailModalFullscreen(false); onClearInitialPrintDocId?.(); }}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl transition hover:bg-slate-200/55 flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body / Printable Content */}
            <div className={`p-6 md:p-8 overflow-y-auto space-y-6 printable-container select-text ${isDetailModalFullscreen ? 'flex-1' : ''}`}>
              {/* PRINT SPECIAL PAGE HEADER (Displays on UI and Print) */}
              <div className="flex flex-col md:flex-row justify-between items-center md:items-start pb-4 border-b border-slate-300 gap-4">
                <div className="flex flex-col gap-2 text-center md:text-right">
                  <div className="text-lg font-extrabold text-slate-900">پکینگ لیست استاندارد کالا (Packing List)</div>
                  <div className="text-xs text-slate-500">مجموعه اسناد رسمی ترخیص و لجستیک</div>
                </div>
                
                {/* Logo Section */}
                {activeTemplate?.showLogo && (
                  <div className="flex items-center gap-3" dir="rtl">
                    <div className="text-left">
                      <h4 className="font-bold text-sm text-slate-800">{activeTemplate.companyName}</h4>
                      <p className="text-[9px] text-slate-400">تامین تجهیزات اتوماسیون و ابزاردقیق</p>
                    </div>
                    {activeTemplate.logoUrl ? (
                      <img
                        src={activeTemplate.logoUrl}
                        alt={activeTemplate.companyName}
                        className="w-12 h-12 object-contain rounded-lg border border-slate-200 bg-white"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-sky-500 text-white flex items-center justify-center font-bold text-xl rounded-lg shrink-0">
                        ATA
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Main official header layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-150">
                <div className="space-y-2">
                  <div className="text-xs text-slate-600 flex items-center gap-1.5">
                    <span className="text-slate-400">شماره پکینگ لیست:</span>
                    <strong className="text-slate-800 font-extrabold">{selectedDelivery.packingListNumber}</strong>
                  </div>
                  <div className="text-xs text-slate-600 flex items-center gap-1.5 border-b border-slate-50 pb-1">
                    <span className="text-slate-400">تاریخ صدور پکینگ لیست:</span>
                    <strong className="text-slate-800 font-mono font-bold">{selectedDelivery.deliveryDate}</strong>
                  </div>
                  {(() => {
                    const actualDateLabel = getDeliveryActualDateLabel(selectedDelivery);
                    if (actualDateLabel === 'در انتظار تحویل') return null;
                    return (
                      <div className="text-xs text-emerald-600 flex items-center gap-1.5 border-b border-emerald-50 pb-1">
                        <span className="text-emerald-500/80">تاریخ تحویل نهایی:</span>
                        <strong className="font-mono font-bold">{actualDateLabel}</strong>
                      </div>
                    );
                  })()}
                  <div className="text-xs text-slate-600 flex items-center gap-1.5">
                    <span className="text-slate-400">روش حمل و ارسال:</span>
                    <strong className="text-slate-800 font-extrabold">{selectedDelivery.shippingMethod}</strong>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-slate-600 flex items-center gap-1.5">
                    <span className="text-slate-400">پروژه (کارفرما):</span>
                    <strong className="text-slate-800 font-extrabold">{selectedDelivery.projectName}</strong>
                  </div>
                  {selectedDelivery.proformaNumber && (
                    <div className="text-xs text-slate-600 flex items-center gap-1.5">
                      <span className="text-slate-400">پیش‌فاکتور مرجع:</span>
                      <strong className="text-slate-800 font-mono">{selectedDelivery.proformaNumber}</strong>
                    </div>
                  )}
                  <div className="text-xs text-slate-600 flex items-center gap-1.5">
                    <span className="text-slate-400">مسئول ثبت و کنترل:</span>
                    <strong className="text-slate-800 font-bold">{currentUser?.fullName || 'مسئول انبار و لجستیک'}</strong>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-4">
                <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5 border-b border-slate-150 pb-1.5">
                  <Package size={15} className="text-emerald-500" />
                  لیست کالاها و عدل‌بندی بسته‌بندی
                </h4>
                
                {Object.entries(
                  selectedDelivery.items.reduce((acc, item) => {
                    const box = item.boxNumber || 'اقلام بدون شماره جعبه';
                    if (!acc[box]) acc[box] = [];
                    acc[box].push(item);
                    return acc;
                  }, {} as Record<string, typeof selectedDelivery.items>)
                ).map(([box, items], boxIdx) => (
                  <div key={boxIdx} className="border border-slate-200 rounded-xl overflow-hidden mb-4">
                    <div className="bg-slate-100 text-slate-700 font-bold text-xs p-2.5 border-b border-slate-200 flex items-center gap-2">
                      <Package size={14} className="text-slate-500" />
                      بسته‌بندی / جعبه: {box}
                    </div>
                    <table className="w-full text-xs text-right border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200">
                          <th className="p-3 w-10">ردیف</th>
                          <th className="p-3">کالا / تجهیز / سند</th>
                          <th className="p-3 text-center w-16">تعداد</th>
                          <th className="p-3 w-28">نوع بسته‌بندی</th>
                          <th className="p-3 w-40">ابعاد بسته‌بندی</th>
                          <th className="p-3 text-center w-24">وزن (کیلوگرم)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {(items as any[]).map((item, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50/50">
                            <td className="p-3 text-slate-400 font-mono font-semibold">{idx + 1}</td>
                            <td className="p-3 font-bold text-slate-800">
                              <div className="flex flex-col">
                                <span>{item.itemOrDocName}</span>
                                <div className="flex items-center gap-1.5 flex-wrap mt-1 font-normal">
                                  {overrideShowBrand && (() => {
                                    const prod = item.productId ? products.find(p => p.id === item.productId) : undefined;
                                    return prod?.brand ? (
                                      <span className="text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold">برند: {prod.brand}</span>
                                    ) : null;
                                  })()}
                                  {item.tagNumber && (
                                    <span className="font-sans text-rose-600 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded font-bold text-[10px]">تگ: {item.tagNumber}</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="p-3 font-extrabold text-slate-700 text-center font-mono">{item.quantity}</td>
                            <td className="p-3 font-medium text-slate-600">{item.packageType}</td>
                            <td className="p-3 font-mono text-left text-slate-600" dir="ltr">{item.dimensions}</td>
                            <td className="p-3 font-mono text-slate-700 text-center font-semibold">{item.weight} Kg</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              {/* Photo attachments gallery inside details (Hidden on Print) */}
              {selectedDelivery.photos && selectedDelivery.photos.length > 0 && (
                <div className="space-y-2.5 no-print">
                  <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5 border-b border-slate-150 pb-1.5">
                    <Upload size={15} className="text-emerald-500" />
                    تصاویر پیوست بسته‌بندی و ارسال
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {selectedDelivery.photos.map((photo, idx) => (
                      <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden aspect-square hover:shadow-md transition">
                        <img referrerPolicy="no-referrer" src={photo} alt={`delivery-${idx}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SIGNATURE SECTION (Perfect for official printouts) */}
              <div className="grid grid-cols-2 gap-6 pt-12 pb-8 text-center text-xs relative">
                <div className="space-y-4">
                  <span className="font-bold text-slate-700 block">امضا و تایید تحویل‌گیرنده (کارفرما):</span>
                  <div className="w-44 h-24 border border-dashed border-slate-200 rounded-lg mx-auto bg-slate-50/30" />
                  <span className="text-[10px] text-slate-400 font-mono">نام و نام خانوادگی / تاریخ تحویل</span>
                </div>

                <div className="space-y-4 relative">
                  <span className="font-bold text-slate-700 block">مسئول انبار و تایید خروج کالا:</span>
                  <div className="w-auto px-4 min-w-[11rem] h-24 border border-dashed border-slate-200 rounded-lg mx-auto flex flex-row items-center justify-center gap-4 bg-slate-50/30">
                    {/* Official Stamp */}
                    {activeTemplate?.companySealUrl && (
                      <img src={activeTemplate.companySealUrl} alt="Company Stamp" className="h-20 object-contain pointer-events-none" />
                    )}
                    {/* User Signature */}
                    {currentUser?.signatureImage && (
                      <img src={currentUser.signatureImage} alt="User Signature" className="max-h-16 max-w-[120px] object-contain pointer-events-none" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{currentUser?.fullName}</span>
                </div>
              </div>

              {/* Module Notes & Comments (Not printed) */}
              <div className="no-print pt-6 border-t border-slate-200 mt-6 text-right">
                <ModuleNotesSection
                  notes={selectedDelivery.moduleNotes || []}
                  currentUser={currentUser}
                  title="نکات، کامنت‌ها و توافقات مرحله بسته‌بندی/ارسال"
                  placeholder="مثال: کامنت مشتری در مرحله بسته‌بندی یا شرایط لجستیک خاص این ارسال..."
                  onAddNote={(text) => {
                    const newNote = {
                      id: `note-${Date.now()}`,
                      text,
                      createdAt: getTodayShamsi(),
                      author: currentUser?.fullName || currentUser?.username || 'کاربر سیستم'
                    };
                    const updated = {
                      ...selectedDelivery,
                      moduleNotes: [...(selectedDelivery.moduleNotes || []), newNote]
                    };
                    updatePackagingDelivery(updated);
                    setSelectedDelivery(updated);
                  }}
                  onDeleteNote={(id) => {
                    const updatedNotes = (selectedDelivery.moduleNotes || []).filter(n => n.id !== id);
                    const updated = {
                      ...selectedDelivery,
                      moduleNotes: updatedNotes
                    };
                    updatePackagingDelivery(updated);
                    setSelectedDelivery(updated);
                  }}
                />
              </div>

              {/* Template Footer */}
              <div className="text-[10px] text-slate-500 text-center pt-8 border-t border-slate-200 mt-8 space-y-2">
                {activeTemplate?.footerText && (
                  <div>{activeTemplate.footerText}</div>
                )}
                {activeTemplate && (
                  <div className="flex justify-center gap-6 items-center flex-wrap pt-2">
                    <div><strong>آدرس شرکت:</strong> {activeTemplate.address || '-'}</div>
                    <div><strong>تلفن تماس:</strong> {activeTemplate.phone || '-'}</div>
                    <div><strong>پست الکترونیکی:</strong> {activeTemplate.email || '-'}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer with print trigger */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between px-6 py-4 border-t border-slate-150 bg-slate-50/50 no-print">
              {/* Instant Brand display toggle */}
              <label className="flex items-center gap-2 text-xs text-slate-600 bg-white px-3 py-2 rounded-xl border border-slate-150 cursor-pointer select-none hover:bg-slate-50 transition w-fit">
                <input
                  type="checkbox"
                  checked={overrideShowBrand}
                  onChange={(e) => setOverrideShowBrand(e.target.checked)}
                  className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                />
                <span>نمایش برند کالا در این پکینگ لیست</span>
              </label>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    downloadPackagingDeliveryHTML(selectedDelivery);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl transition flex items-center gap-1.5 shadow-sm"
                >
                  <Printer size={15} />
                  خروجی فایل چاپی مستقل (دانلود HTML)
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedDelivery(null); onClearInitialPrintDocId?.(); }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-5 py-2.5 rounded-xl transition"
                >
                  بستن پنجره
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Embedded print styling specifically for professional standard document layout */}
      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteDeliveryId}
        onClose={() => {
          setDeleteDeliveryId(null);
          setDeleteActivitiesWithDelivery(false);
        }}
        onConfirm={() => {
          if (deleteDeliveryId) {
            deletePackagingDelivery(deleteDeliveryId, deleteActivitiesWithDelivery);
          }
        }}
        title="حذف پکینگ لیست"
        message="آیا از حذف این پکینگ لیست و تحویل کالا اطمینان دارید؟ این عملیات غیرقابل بازگشت است."
      >
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-2">
          <input
            type="checkbox"
            id="deleteActivities"
            checked={deleteActivitiesWithDelivery}
            onChange={(e) => setDeleteActivitiesWithDelivery(e.target.checked)}
            className="mt-1"
          />
          <label htmlFor="deleteActivities" className="text-xs text-slate-600">
            حذف لاگ‌های فعالیت پروژه مرتبط با این پکینگ لیست (در دسته‌بندی بسته‌بندی و تحویل کالا)
          </label>
        </div>
      </ConfirmModal>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-container, .printable-container * {
            visibility: visible;
          }
          .printable-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px;
            direction: rtl !important;
            text-align: right !important;
            font-family: 'Inter', system-ui, sans-serif !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
