import { getDb } from "../server/db";
import { getProformaOutcome } from "../server/proformaStatus";
import type { StoreCollections } from "./flatten";

/**
 * Reads everything the Power BI export needs, out of SQL Server.
 *
 * The export was built when the app kept its data as nested documents, and
 * `flatten.ts` turns those documents into the 23 flat tables Power BI reads.
 * When the screens moved to SQL the document store stopped receiving writes,
 * and this export — still reading it — quietly went on copying frozen
 * pre-migration data into the reporting database.
 *
 * The fix is deliberately narrow. `flatten.ts` and `sqlSync.ts` are untouched,
 * so the 23 tables keep exactly the columns and names they had; only the source
 * changes. That means the report author's existing relationships, measures and
 * dashboards keep working, which they would not if the tables were rebuilt from
 * scratch. What this module does is re-assemble the document shapes those
 * functions expect, from the relational tables that replaced them.
 *
 * Two conventions are load-bearing:
 *
 * - **Dates come from the Jalali columns.** Reporting passes the app's Shamsi
 *   strings straight through by explicit decision, and the report author
 *   converts them in Power BI. Reading the DATE halves instead would silently
 *   change every date column's type and meaning.
 * - **A proforma's status is the derived outcome**, not the stored workflow
 *   status — that is what the document held and what the screens show, so a
 *   report keyed on it would otherwise disagree with the application.
 *
 * This is a batch export over a small dataset, so it reads whole tables. It is
 * the one place in the codebase allowed to.
 */

/** Prisma returns Decimal objects; the flatteners want plain numbers. */
const num = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

/** A JSON text column, back to the value it holds. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function readSqlCollections(): Promise<StoreCollections> {
  const db = getDb();

  const [
    customers, suppliers, users, products, stockLedger, projects,
    proformas, purchaseOrders, transactions, inquiries, tasks,
    deliveries, services, categoryGroups,
  ] = await Promise.all([
    db.customer.findMany({ include: { linksFrom: { select: { toId: true } } } }),
    db.supplier.findMany(),
    // Never the password hash: credentials must not reach the reporting database.
    db.user.findMany({
      select: {
        id: true, username: true, fullName: true, role: true,
        isSystemAdmin: true, position: true,
      },
    }),
    db.product.findMany({ include: { variants: { orderBy: { sku: "asc" } } } }),
    db.inventoryTransaction.findMany(),
    db.project.findMany({
      include: {
        customer: { select: { companyName: true } },
        items: { orderBy: { lineNo: "asc" } },
        milestones: { orderBy: { lineNo: "asc" } },
      },
    }),
    db.proforma.findMany({
      include: {
        customer: { select: { companyName: true } },
        contact: { select: { companyName: true } },
        project: { select: { name: true } },
        items: { orderBy: { lineNo: "asc" } },
      },
    }),
    db.purchaseOrder.findMany({
      include: {
        supplier: { select: { name: true } },
        project: { select: { name: true } },
        proforma: { select: { proformaNumber: true } },
        items: { orderBy: { lineNo: "asc" } },
      },
    }),
    db.transaction.findMany({
      include: {
        customer: { select: { companyName: true } },
        supplier: { select: { name: true } },
        project: { select: { name: true } },
      },
    }),
    db.supplierInquiry.findMany({
      include: {
        supplier: { select: { name: true } },
        project: { select: { name: true } },
        items: { orderBy: { lineNo: "asc" } },
        steps: { orderBy: { stepNo: "asc" } },
      },
    }),
    db.task.findMany(),
    db.packagingDelivery.findMany({
      include: {
        project: { select: { name: true } },
        proforma: { select: { proformaNumber: true } },
        items: { orderBy: { lineNo: "asc" } },
      },
    }),
    db.afterSalesService.findMany({
      include: {
        project: { select: { name: true } },
        items: { orderBy: { lineNo: "asc" } },
      },
    }),
    db.projectCategoryGroup.findMany({
      include: {
        activities: {
          orderBy: { createdAt: "asc" },
          include: { referral: true },
        },
      },
    }),
  ]);

  return {
    erp_customers: customers.map((c) => ({
      id: c.id,
      customerType: c.customerType,
      status: c.status,
      companyName: c.companyName,
      firstName: c.firstName,
      lastName: c.lastName,
      gender: c.gender,
      position: c.position,
      economicCode: c.economicCode,
      industry: c.industry,
      keyPerson: c.keyPerson,
      phone: c.phone,
      mobile: c.mobile,
      email: c.email,
      province: c.province,
      city: c.city,
      address: c.address,
      tags: c.tags,
      customValues: parseJson(c.customValues, undefined),
      linkedCustomerIds: c.linksFrom.map((l) => l.toId),
      createdAt: c.createdAt,
    })),

    erp_suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      country: s.country,
      contactName: s.contactName,
      phone: s.phone,
      email: s.email,
      website: s.website,
      paymentTerms: s.paymentTerms,
      status: s.status,
      description: s.description,
      providedCategories: parseJson<string[]>(s.providedCategories, []),
      customValues: parseJson(s.customValues, undefined),
      createdAt: s.createdAt,
    })),

    erp_users: users,

    erp_products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      displayName: p.displayName,
      category: p.category,
      brand: p.brand,
      modelNumber: p.modelNumber,
      unit: p.unit,
      description: p.description,
      supplyType: p.supplyType,
      hasVariants: p.hasVariants,
      stockLevel: num(p.stockLevel),
      minStockLevel: num(p.minStockLevel),
      basePriceRIYAL: num(p.basePriceRial),
      priceForeign: num(p.priceForeign),
      currencyForeign: p.currencyForeign,
      images: parseJson<string[]>(p.images, []),
      customValues: parseJson(p.customValues, undefined),
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        attributes: parseJson<Record<string, string>>(v.attributes, {}),
        stockLevel: num(v.stockLevel),
        minStockLevel: num(v.minStockLevel),
        priceRIYAL: num(v.priceRial),
        priceForeign: num(v.priceForeign),
        currencyForeign: v.currencyForeign,
      })),
    })),

    erp_inventory_transactions: stockLedger.map((t) => ({
      id: t.id,
      productId: t.productId,
      variantId: t.variantId,
      date: t.occurredAtJalali,
      type: t.type,
      quantity: num(t.quantity),
      referenceId: t.referenceId,
      referenceType: t.referenceType,
      notes: t.notes,
    })),

    erp_projects: projects.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      customerId: p.customerId,
      customerName: p.customer?.companyName,
      status: p.status,
      lossReason: p.lossReason,
      description: p.description,
      creationDate: p.creationDateJalali,
      opportunityDate: p.opportunityDateJalali,
      expectedCloseDate: p.expectedCloseDateJalali,
      winningDate: p.winningDateJalali,
      agreedDeliveryDate: p.agreedDeliveryDateJalali,
      closingDate: p.closingDateJalali,
      estimatedValueRIYAL: num(p.estimatedValueRial),
      probabilityPercent: p.probabilityPercent,
      marketingChannel: p.marketingChannel,
      leadQuality: p.leadQuality,
      referrerName: p.referrerName,
      communicationMethod: p.communicationMethod,
      customerInquiryNumber: p.customerInquiryNumber,
      salesExpert: p.salesExpert,
      financialContact: p.financialContact,
      technicalContact: p.technicalContact,
      endUser: p.endUser,
      customValues: parseJson(p.customValues, undefined),
      itemsNeeded: p.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        name: i.name,
        quantity: num(i.quantity),
        supplyMethod: i.supplyMethod,
        category: i.category,
        equipmentType: i.equipmentType,
        size: i.size,
        tagNumber: i.tagNumber,
      })),
      milestones: p.milestones.map((m) => ({
        id: m.id,
        name: m.name,
        isCompleted: m.isCompleted,
        completedAt: m.completedAtJalali,
        dueDate: m.dueDateJalali,
        notes: m.notes,
        triggerType: m.triggerType,
        triggerCategoryName: m.triggerCategoryName,
      })),
    })),

    erp_proformas: proformas.map((pf) => {
      const items = pf.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        productCode: i.productCode,
        brand: i.brand,
        tagNumber: i.tagNumber,
        quantity: num(i.quantity),
        unitPriceRIYAL: num(i.unitPriceRial),
        totalPriceRIYAL: num(i.totalPriceRial),
        supplyMethod: i.supplyMethod,
        status: i.status,
        lossReason: i.lossReason,
        techSpecs: i.techSpecs,
        deliveryRange: i.deliveryRange,
        deliveryUnit: i.deliveryUnit,
        deliveryType: i.deliveryType,
      }));

      return {
        id: pf.id,
        proformaNumber: pf.proformaNumber,
        proformaType: pf.proformaType,
        customerId: pf.customerId,
        customerName: pf.customer?.companyName,
        contactCustomerId: pf.contactCustomerId,
        contactName: pf.contact?.companyName,
        projectId: pf.projectId,
        projectName: pf.project?.name,
        // The derived outcome, which is what the document carried and what the
        // screens show; the stored column is only one of its inputs.
        status: getProformaOutcome({
          status: pf.status,
          isCancelled: pf.isCancelled,
          items: pf.items.map((i) => ({ status: i.status, supplyMethod: i.supplyMethod })),
        }),
        isCancelled: pf.isCancelled,
        currency: pf.currency,
        issueDate: pf.issueDateJalali,
        expiryDate: pf.expiryDateJalali,
        deliveryDate: pf.deliveryDateJalali,
        totalAmount: num(pf.totalAmount),
        discountPercent: num(pf.discountPercent),
        discountAmount: num(pf.discountAmount),
        taxPercent: num(pf.taxPercent),
        taxAmount: num(pf.taxAmount),
        extraCosts: num(pf.extraCosts),
        finalAmount: num(pf.finalAmount),
        historicalExchangeRate: num(pf.historicalExchangeRate),
        notes: pf.notes,
        sentMethod: pf.sentMethod,
        lossReason: pf.lossReason,
        creatorId: pf.creatorUserId,
        customValues: parseJson(pf.customValues, undefined),
        items,
      };
    }),

    erp_purchase_orders: purchaseOrders.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name,
      projectId: po.projectId,
      projectName: po.project?.name,
      proformaId: po.proformaId,
      proformaNumber: po.proforma?.proformaNumber,
      status: po.status,
      currency: po.currency,
      exchangeRate: num(po.exchangeRate),
      orderDate: po.orderDateJalali,
      expectedDeliveryDate: po.expectedDeliveryDateJalali,
      paymentDate: po.paymentDateJalali,
      goodsReadyDate: po.goodsReadyDateJalali,
      shipmentDate: po.shipmentDateJalali,
      clearanceDate: po.clearanceDateJalali,
      receivedDate: po.receivedDateJalali,
      totalForeignAmount: num(po.totalForeignAmount),
      shippingCostRIYAL: num(po.shippingCostRial),
      customsDutyRIYAL: num(po.customsDutyRial),
      remittanceFeeRIYAL: num(po.remittanceFeeRial),
      shippingCostForeign: num(po.shippingCostForeign),
      remittanceFeeForeign: num(po.remittanceFeeForeign),
      calculatedLandedCostRIYAL: num(po.landedCostRial),
      calculatedLandedCostForeign: num(po.landedCostForeign),
      notes: po.notes,
      customValues: parseJson(po.customValues, undefined),
      createdAt: po.createdAt,
      items: po.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        productCode: i.productCode,
        brand: i.brand,
        tagNumber: i.tagNumber,
        quantity: num(i.quantity),
        unitPriceForeignCurrency: num(i.unitPriceForeign),
        totalPriceForeignCurrency: num(i.totalPriceForeign),
        proformaItemId: i.proformaItemId,
        proformaItemName: i.proformaItemName,
      })),
    })),

    erp_transactions: transactions.map((t) => ({
      id: t.id,
      documentNumber: t.documentNumber,
      type: t.type,
      receiptType: t.receiptType,
      status: t.status,
      date: t.occurredAtJalali,
      customerId: t.customerId,
      customerName: t.customer?.companyName ?? t.partyName,
      supplierId: t.supplierId,
      supplierName: t.supplier?.name ?? null,
      projectId: t.projectId,
      projectName: t.project?.name,
      proformaId: t.proformaId,
      purchaseOrderId: t.purchaseOrderId,
      amountRIYAL: num(t.amountRial),
      amountForeign: num(t.amountForeign),
      exchangeRate: num(t.exchangeRate),
      isDirectForeign: t.isDirectForeign,
      paymentType: t.paymentType,
      referenceNumber: t.referenceNumber,
      notes: t.notes,
      reversalOfTransactionId: t.reversalOfTransactionId,
      customValues: parseJson(t.customValues, undefined),
    })),

    erp_supplier_inquiries: inquiries.map((q) => ({
      id: q.id,
      projectId: q.projectId,
      projectName: q.project?.name,
      supplierId: q.supplierId,
      supplierName: q.supplier?.name,
      isWinner: q.isWinner,
      winnerDate: q.winnerDateJalali,
      offerConfirmed: q.offerConfirmed,
      offerConfirmedDate: q.offerConfirmedDateJalali,
      creationDate: q.creationDateJalali,
      technicalOfferUrl: q.technicalOfferUrl,
      financialOfferUrl: q.financialOfferUrl,
      items: q.items.map((i) => ({
        id: i.id,
        name: i.name,
        brand: i.brand,
        partNumber: i.partNumber,
        tagNumber: i.tagNumber,
        quantity: num(i.quantity),
        currency: i.currency,
        priceForeign: num(i.priceForeign),
        priceRiyal: num(i.priceRial),
        deliveryTime: i.deliveryTime,
        notes: i.notes,
      })),
      steps: q.steps.map((st) => ({
        id: st.id,
        title: st.title,
        date: st.occurredAtJalali,
        method: st.method,
        recipientName: st.recipientName,
        notes: st.notes,
        auto: st.isAuto,
        autoKey: st.autoKey,
      })),
    })),

    erp_tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      relatedToType: t.relatedToType,
      relatedToId: t.relatedToId,
      relatedToName: t.relatedToName,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDateJalali,
      assignedTo: t.assignedToName,
      reminderEnabled: t.reminderEnabled,
      reminderDate: t.reminderDateJalali,
      customValues: parseJson(t.customValues, undefined),
    })),

    erp_packaging_deliveries: deliveries.map((d) => ({
      id: d.id,
      packingListNumber: d.packingListNumber,
      projectId: d.projectId,
      projectName: d.project?.name,
      proformaId: d.proformaId,
      proformaNumber: d.proforma?.proformaNumber,
      deliveryDate: d.deliveryDateJalali,
      actualDeliveryDate: d.actualDeliveryDateJalali,
      shippingMethod: d.shippingMethod,
      checklist: parseJson<unknown[]>(d.checklist, []),
      photos: parseJson<unknown[]>(d.photos, []),
      createdAt: d.createdAt,
      items: d.items.map((i) => ({
        id: i.id,
        itemOrDocName: i.itemOrDocName,
        productId: i.productId,
        tagNumber: i.tagNumber,
        quantity: num(i.quantity),
        packageType: i.packageType,
        dimensions: i.dimensions,
        weight: num(i.weight),
        boxNumber: i.boxNumber,
        actualDeliveryDate: i.actualDeliveryDateJalali,
      })),
    })),

    erp_after_sales_services: services.map((sv) => ({
      id: sv.id,
      projectId: sv.projectId,
      projectName: sv.project?.name,
      proformaNumber: sv.proformaNumber,
      itemName: sv.itemName,
      status: sv.status,
      issueDescription: sv.issueDescription,
      actionsTaken: sv.actionsTaken,
      startDate: sv.startDateJalali,
      endDate: sv.endDateJalali,
      returnDate: sv.returnDateJalali,
      createdBy: sv.createdBy,
      createdAt: sv.createdAt,
      items: sv.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        status: i.status,
        issueDescription: i.issueDescription,
        actionsTaken: i.actionsTaken,
        startDate: i.startDateJalali,
        endDate: i.endDateJalali,
        returnDate: i.returnDateJalali,
      })),
    })),

    erp_project_category_groups: categoryGroups.map((g) => ({
      id: g.id,
      projectId: g.projectId,
      categoryId: g.categoryId,
      categoryName: g.categoryName,
      status: g.status,
      startDate: g.startDateJalali,
      endDate: g.endDateJalali,
      activities: g.activities.map((a) => ({
        id: a.id,
        text: a.text,
        createdAt: a.createdAt,
        createdBy: a.authorName,
        // The flattener only records whether there was one, and whether the
        // note carried a referral.
        attachment: a.attachmentUrl ? { name: a.attachmentName, url: a.attachmentUrl } : null,
        referral: a.referral ?? null,
      })),
    })),
  } as StoreCollections;
}
