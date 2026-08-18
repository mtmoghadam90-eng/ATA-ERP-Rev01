/**
 * Flattens the application's document-shaped store into report-ready row sets.
 *
 * The app stores nested documents (a proforma owns its items, a project owns its
 * requested items and milestones, an inquiry owns its steps). Power BI wants flat
 * tables, so each nested array becomes its own table carrying its parent's key.
 *
 * Dates are passed through as the app's Shamsi strings by design — the report
 * author converts them in Power BI.
 */

export type Row = Record<string, string | number | boolean | null>;

export interface FlatDataset {
  table: string;
  rows: Row[];
}

/* ----------------------------- helpers ----------------------------- */

const s = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

const n = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
};

const b = (v: unknown): boolean => v === true;

/** Serializes a dynamic custom-field bag so nothing is silently dropped. */
const customJson = (v: unknown): string | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v as object);
  return keys.length > 0 ? JSON.stringify(v) : null;
};

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/* ----------------------------- customers ----------------------------- */

export const flattenCustomers = (customers: any[]): Row[] =>
  arr(customers).map((c) => ({
    id: s(c.id),
    customer_type: s(c.customerType),
    status: s(c.status),
    company_name: s(c.companyName),
    first_name: s(c.firstName),
    last_name: s(c.lastName),
    display_name:
      s(`${c.firstName || ""} ${c.lastName || ""}`.trim() || c.companyName) || null,
    gender: s(c.gender),
    position: s(c.position),
    economic_code: s(c.economicCode),
    industry: s(c.industry),
    key_person: s(c.keyPerson),
    phone: s(c.phone),
    mobile: s(c.mobile),
    email: s(c.email),
    province: s(c.province),
    city: s(c.city),
    address: s(c.address),
    tags: s(c.tags),
    linked_customer_count: arr(c.linkedCustomerIds).length,
    created_at: s(c.createdAt),
    custom_values: customJson(c.customValues),
  }));

/* ----------------------------- projects ----------------------------- */

export const flattenProjects = (projects: any[]): Row[] =>
  arr(projects).map((p) => ({
    id: s(p.id),
    code: s(p.code),
    name: s(p.name),
    customer_id: s(p.customerId),
    customer_name: s(p.customerName),
    status: s(p.status),
    creation_date: s(p.creationDate),
    opportunity_date: s(p.opportunityDate),
    expected_close_date: s(p.expectedCloseDate),
    winning_date: s(p.winningDate),
    agreed_delivery_date: s(p.agreedDeliveryDate),
    closing_date: s(p.closingDate),
    estimated_value_riyal: n(p.estimatedValueRIYAL),
    probability_percent: n(p.probabilityPercent),
    sales_expert: s(p.salesExpert),
    marketing_channel: s(p.marketingChannel),
    lead_quality: s(p.leadQuality),
    referrer_name: s(p.referrerName),
    communication_method: s(p.communicationMethod),
    customer_inquiry_number: s(p.customerInquiryNumber),
    financial_contact: s(p.financialContact),
    technical_contact: s(p.technicalContact),
    end_user: s(p.endUser),
    loss_reason: s(p.lossReason),
    description: s(p.description),
    items_needed_count: arr(p.itemsNeeded).length,
    milestone_count: arr(p.milestones).length,
    milestones_completed: arr(p.milestones).filter((m: any) => m?.isCompleted).length,
    custom_values: customJson(p.customValues),
  }));

/** Requested items of each project (project.itemsNeeded). */
export const flattenProjectItems = (projects: any[]): Row[] => {
  const rows: Row[] = [];
  arr(projects).forEach((p) => {
    arr(p.itemsNeeded).forEach((it: any, idx: number) => {
      rows.push({
        project_id: s(p.id),
        project_code: s(p.code),
        line_no: idx + 1,
        product_id: s(it.productId),
        variant_id: s(it.variantId),
        name: s(it.name),
        quantity: n(it.quantity),
        supply_method: s(it.supplyMethod),
        category: s(it.category),
        equipment_type: s(it.equipmentType),
        size: s(it.size),
        tag_number: s(it.tagNumber),
      });
    });
  });
  return rows;
};

export const flattenProjectMilestones = (projects: any[]): Row[] => {
  const rows: Row[] = [];
  arr(projects).forEach((p) => {
    arr(p.milestones).forEach((m: any, idx: number) => {
      rows.push({
        project_id: s(p.id),
        project_code: s(p.code),
        milestone_id: s(m.id),
        line_no: idx + 1,
        name: s(m.name),
        is_completed: b(m.isCompleted),
        completed_at: s(m.completedAt),
        due_date: s(m.dueDate),
        trigger_type: s(m.triggerType),
        trigger_category_name: s(m.triggerCategoryName),
        notes: s(m.notes),
      });
    });
  });
  return rows;
};

/* ----------------------------- proformas ----------------------------- */

export const flattenProformas = (proformas: any[]): Row[] =>
  arr(proformas).map((pf) => ({
    id: s(pf.id),
    proforma_number: s(pf.proformaNumber),
    proforma_type: s(pf.proformaType),
    customer_id: s(pf.customerId),
    customer_name: s(pf.customerName),
    contact_customer_id: s(pf.contactCustomerId),
    contact_name: s(pf.contactName),
    project_id: s(pf.projectId),
    project_name: s(pf.projectName),
    status: s(pf.status),
    is_cancelled: b(pf.isCancelled),
    loss_reason: s(pf.lossReason),
    currency: s(pf.currency),
    issue_date: s(pf.issueDate),
    expiry_date: s(pf.expiryDate),
    delivery_date: s(pf.deliveryDate),
    sent_date: s(pf.sentDate),
    total_amount: n(pf.totalAmount),
    discount_percent: n(pf.discountPercent),
    discount_amount: n(pf.discountAmount),
    tax_percent: n(pf.taxPercent),
    tax_amount: n(pf.taxAmount),
    extra_costs: n(pf.extraCosts),
    final_amount: n(pf.finalAmount),
    historical_exchange_rate: n(pf.historicalExchangeRate),
    creator_id: s(pf.creatorId),
    sent_method: s(pf.sentMethod),
    item_count: arr(pf.items).length,
    notes: s(pf.notes),
    custom_values: customJson(pf.customValues),
  }));

export const flattenProformaItems = (proformas: any[]): Row[] => {
  const rows: Row[] = [];
  arr(proformas).forEach((pf) => {
    arr(pf.items).forEach((it: any, idx: number) => {
      const qty = n(it.quantity) || 0;
      const unit = n(it.unitPriceRIYAL) || 0;
      rows.push({
        proforma_id: s(pf.id),
        proforma_number: s(pf.proformaNumber),
        project_id: s(pf.projectId),
        customer_id: s(pf.customerId),
        currency: s(pf.currency),
        issue_date: s(pf.issueDate),
        item_id: s(it.id),
        line_no: idx + 1,
        product_id: s(it.productId),
        variant_id: s(it.variantId),
        product_name: s(it.productName),
        product_code: s(it.productCode),
        brand: s(it.brand),
        tag_number: s(it.tagNumber),
        quantity: qty,
        unit_of_measure: s(it.unit),
        unit_price_riyal: unit,
        total_price_riyal: n(it.totalPriceRIYAL) ?? qty * unit,
        supply_method: s(it.supplyMethod),
        item_status: s(it.status),
        loss_reason: s(it.lossReason),
        delivery_range: s(it.deliveryRange),
        delivery_unit: s(it.deliveryUnit),
        delivery_type: s(it.deliveryType),
        tech_specs: s(it.techSpecs),
      });
    });
  });
  return rows;
};

/* ----------------------------- purchase orders ----------------------------- */

export const flattenPurchaseOrders = (orders: any[]): Row[] =>
  arr(orders).map((po) => ({
    id: s(po.id),
    po_number: s(po.poNumber),
    supplier_id: s(po.supplierId),
    supplier_name: s(po.supplierName),
    project_id: s(po.projectId),
    project_name: s(po.projectName),
    proforma_id: s(po.proformaId),
    proforma_number: s(po.proformaNumber),
    status: s(po.status),
    currency: s(po.currency),
    exchange_rate: n(po.exchangeRate),
    order_date: s(po.orderDate),
    expected_delivery_date: s(po.expectedDeliveryDate),
    payment_date: s(po.paymentDate),
    goods_ready_date: s(po.goodsReadyDate),
    shipment_date: s(po.shipmentDate),
    clearance_date: s(po.clearanceDate),
    received_date: s(po.receivedDate),
    total_foreign_amount: n(po.totalForeignAmount),
    shipping_cost_riyal: n(po.shippingCostRIYAL),
    customs_duty_riyal: n(po.customsDutyRIYAL),
    remittance_fee_riyal: n(po.remittanceFeeRIYAL),
    shipping_cost_foreign: n(po.shippingCostForeign),
    remittance_fee_foreign: n(po.remittanceFeeForeign),
    landed_cost_riyal: n(po.calculatedLandedCostRIYAL),
    landed_cost_foreign: n(po.calculatedLandedCostForeign),
    item_count: arr(po.items).length,
    created_at: s(po.createdAt),
    notes: s(po.notes),
    custom_values: customJson(po.customValues),
  }));

export const flattenPurchaseOrderItems = (orders: any[]): Row[] => {
  const rows: Row[] = [];
  arr(orders).forEach((po) => {
    arr(po.items).forEach((it: any, idx: number) => {
      rows.push({
        purchase_order_id: s(po.id),
        po_number: s(po.poNumber),
        supplier_id: s(po.supplierId),
        project_id: s(po.projectId),
        currency: s(po.currency),
        order_date: s(po.orderDate),
        item_id: s(it.id),
        line_no: idx + 1,
        product_id: s(it.productId),
        variant_id: s(it.variantId),
        product_name: s(it.productName),
        product_code: s(it.productCode),
        brand: s(it.brand),
        tag_number: s(it.tagNumber),
        quantity: n(it.quantity),
        unit_price_foreign: n(it.unitPriceForeignCurrency),
        total_price_foreign: n(it.totalPriceForeignCurrency),
        proforma_item_id: s(it.proformaItemId),
        proforma_item_name: s(it.proformaItemName),
      });
    });
  });
  return rows;
};

/* ----------------------------- transactions ----------------------------- */

export const flattenTransactions = (transactions: any[]): Row[] =>
  arr(transactions).map((t) => ({
    id: s(t.id),
    type: s(t.type),
    receipt_type: s(t.receiptType),
    document_number: s(t.documentNumber),
    status: s(t.status),
    date: s(t.date),
    customer_id: s(t.customerId),
    customer_name: s(t.customerName),
    supplier_id: s(t.supplierId),
    supplier_name: s(t.supplierName),
    project_id: s(t.projectId),
    project_name: s(t.projectName),
    proforma_id: s(t.proformaId),
    purchase_order_id: s(t.purchaseOrderId),
    amount_riyal: n(t.amountRIYAL),
    amount_foreign: n(t.amountForeign),
    exchange_rate: n(t.exchangeRate),
    is_direct_foreign: b(t.isDirectForeign),
    payment_type: s(t.paymentType),
    reference_number: s(t.referenceNumber),
    reversal_of_transaction_id: s(t.reversalOfTransactionId),
    notes: s(t.notes),
    custom_values: customJson(t.customValues),
  }));

/* ----------------------------- suppliers & inquiries ----------------------------- */

export const flattenSuppliers = (suppliers: any[]): Row[] =>
  arr(suppliers).map((sp) => ({
    id: s(sp.id),
    name: s(sp.name),
    country: s(sp.country),
    contact_name: s(sp.contactName),
    phone: s(sp.phone),
    email: s(sp.email),
    website: s(sp.website),
    payment_terms: s(sp.paymentTerms),
    status: s(sp.status),
    provided_categories: arr(sp.providedCategories).join(" | ") || null,
    description: s(sp.description),
    created_at: s(sp.createdAt),
    custom_values: customJson(sp.customValues),
  }));

export const flattenSupplierInquiries = (inquiries: any[]): Row[] =>
  arr(inquiries).map((q) => ({
    id: s(q.id),
    project_id: s(q.projectId),
    project_name: s(q.projectName),
    supplier_id: s(q.supplierId),
    supplier_name: s(q.supplierName),
    is_winner: b(q.isWinner),
    winner_date: s(q.winnerDate),
    offer_confirmed: b(q.offerConfirmed),
    offer_confirmed_date: s(q.offerConfirmedDate),
    creation_date: s(q.creationDate),
    has_technical_offer: !!q.technicalOfferUrl,
    has_financial_offer: !!q.financialOfferUrl,
    item_count: arr(q.items).length,
    step_count: arr(q.steps).length,
    latest_step: s(arr(q.steps).slice(-1)[0]?.title),
    // The offer's money, with the discount already applied, so a report does
    // not have to know the rule. The item rows stay gross: the discount is on
    // the offer as a whole, and splitting it across lines would invent a
    // per-line figure the app never stored.
    discount_percent: n(q.discountPercent) || 0,
    discount_amount: n(q.discountAmount) || 0,
    gross_riyal: inquiryGrossRiyal(q),
    discount_riyal: inquiryGrossRiyal(q) * (1 - inquiryKeep(q)),
    total_riyal: inquiryGrossRiyal(q) * inquiryKeep(q),
  }));

const inquiryGrossRiyal = (q: any): number =>
  arr(q.items).reduce(
    (sum: number, it: any) => sum + (n(it.priceRiyal) || 0) * (n(it.quantity) || 0),
    0,
  );

const inquiryGrossForeign = (q: any): number =>
  arr(q.items).reduce(
    (sum: number, it: any) => sum + (n(it.priceForeign) || 0) * (n(it.quantity) || 0),
    0,
  );

/**
 * The share of an offer that survives both discounts.
 *
 * Mirrors the application's rule: the percentage comes off first, then the
 * fixed amount comes off what is left. The amount is in the offer's own
 * currency, so it is measured against the foreign total when there is one and
 * against Rial otherwise, and the resulting proportion is what reduces every
 * figure — which is what keeps the Rial and foreign totals agreeing.
 */
const inquiryKeep = (q: any): number => {
  const pct = n(q.discountPercent) || 0;
  const keepPct = pct > 0 ? 1 - Math.min(pct, 100) / 100 : 1;

  const amount = Math.max(n(q.discountAmount) || 0, 0);
  const foreign = inquiryGrossForeign(q);
  const base = foreign > 0 ? foreign : inquiryGrossRiyal(q);
  const afterPct = base * keepPct;

  if (afterPct <= 0) return amount > 0 ? 0 : keepPct;
  return keepPct * Math.max(1 - amount / afterPct, 0);
};

export const flattenSupplierInquiryItems = (inquiries: any[]): Row[] => {
  const rows: Row[] = [];
  arr(inquiries).forEach((q) => {
    arr(q.items).forEach((it: any, idx: number) => {
      const qty = n(it.quantity) || 0;
      rows.push({
        inquiry_id: s(q.id),
        project_id: s(q.projectId),
        supplier_id: s(q.supplierId),
        supplier_name: s(q.supplierName),
        is_winner: b(q.isWinner),
        item_id: s(it.id),
        line_no: idx + 1,
        name: s(it.name),
        brand: s(it.brand),
        part_number: s(it.partNumber),
        tag_number: s(it.tagNumber),
        quantity: qty,
        currency: s(it.currency),
        price_foreign: n(it.priceForeign),
        price_riyal: n(it.priceRiyal),
        total_foreign: (n(it.priceForeign) || 0) * qty,
        total_riyal: (n(it.priceRiyal) || 0) * qty,
        delivery_time: s(it.deliveryTime),
        notes: s(it.notes),
      });
    });
  });
  return rows;
};

export const flattenSupplierInquirySteps = (inquiries: any[]): Row[] => {
  const rows: Row[] = [];
  arr(inquiries).forEach((q) => {
    arr(q.steps).forEach((st: any, idx: number) => {
      rows.push({
        inquiry_id: s(q.id),
        project_id: s(q.projectId),
        supplier_id: s(q.supplierId),
        step_id: s(st.id),
        step_no: idx + 1,
        title: s(st.title),
        date: s(st.date),
        method: s(st.method),
        recipient_name: s(st.recipientName),
        is_auto: b(st.auto),
        auto_key: s(st.autoKey),
        notes: s(st.notes),
      });
    });
  });
  return rows;
};

/* ----------------------------- products ----------------------------- */

export const flattenProducts = (products: any[]): Row[] =>
  arr(products).map((p) => {
    const variants = arr(p.variants);
    const totalStock = p.hasVariants
      ? variants.reduce((acc: number, v: any) => acc + (n(v.stockLevel) || 0), 0)
      : n(p.stockLevel) || 0;
    return {
      id: s(p.id),
      code: s(p.code),
      name: s(p.name),
      display_name: s(p.displayName),
      category: s(p.category),
      brand: s(p.brand),
      model_number: s(p.modelNumber),
      unit: s(p.unit),
      supply_type: s(p.supplyType),
      has_variants: b(p.hasVariants),
      variant_count: variants.length,
      stock_level: totalStock,
      min_stock_level: n(p.minStockLevel),
      is_below_minimum: totalStock <= (n(p.minStockLevel) || 0),
      base_price_riyal: n(p.basePriceRIYAL),
      price_foreign: n(p.priceForeign),
      currency_foreign: s(p.currencyForeign),
      description: s(p.description),
      image_count: arr(p.images).length,
      custom_values: customJson(p.customValues),
    };
  });

export const flattenProductVariants = (products: any[]): Row[] => {
  const rows: Row[] = [];
  arr(products).forEach((p) => {
    arr(p.variants).forEach((v: any, idx: number) => {
      rows.push({
        product_id: s(p.id),
        product_code: s(p.code),
        product_name: s(p.displayName),
        category: s(p.category),
        brand: s(p.brand),
        variant_id: s(v.id),
        line_no: idx + 1,
        sku: s(v.sku),
        attributes: v.attributes ? JSON.stringify(v.attributes) : null,
        stock_level: n(v.stockLevel),
        min_stock_level: n(v.minStockLevel),
        price_riyal: n(v.priceRIYAL),
        price_foreign: n(v.priceForeign),
        currency_foreign: s(v.currencyForeign),
      });
    });
  });
  return rows;
};

export const flattenInventoryTransactions = (txs: any[]): Row[] =>
  arr(txs).map((t) => ({
    id: s(t.id),
    product_id: s(t.productId),
    variant_id: s(t.variantId),
    date: s(t.date),
    type: s(t.type),
    quantity: n(t.quantity),
    signed_quantity: (n(t.quantity) || 0) * (t.type === "OUT" ? -1 : 1),
    reference_id: s(t.referenceId),
    reference_type: s(t.referenceType),
    notes: s(t.notes),
  }));

/* ----------------------------- tasks ----------------------------- */

export const flattenTasks = (tasks: any[]): Row[] =>
  arr(tasks).map((t) => ({
    id: s(t.id),
    title: s(t.title),
    description: s(t.description),
    related_to_type: s(t.relatedToType),
    related_to_id: s(t.relatedToId),
    related_to_name: s(t.relatedToName),
    priority: s(t.priority),
    status: s(t.status),
    due_date: s(t.dueDate),
    assigned_to: s(t.assignedTo),
    reminder_enabled: b(t.reminderEnabled),
    reminder_date: s(t.reminderDate),
    custom_values: customJson(t.customValues),
  }));

/* ----------------------------- delivery & service ----------------------------- */

export const flattenPackagingDeliveries = (list: any[]): Row[] =>
  arr(list).map((d) => ({
    id: s(d.id),
    packing_list_number: s(d.packingListNumber),
    project_id: s(d.projectId),
    project_name: s(d.projectName),
    proforma_id: s(d.proformaId),
    proforma_number: s(d.proformaNumber),
    delivery_date: s(d.deliveryDate),
    actual_delivery_date: s(d.actualDeliveryDate),
    shipping_method: s(d.shippingMethod),
    item_count: arr(d.items).length,
    total_weight: arr(d.items).reduce((a: number, i: any) => a + (n(i.weight) || 0), 0),
    checklist_total: arr(d.checklist).length,
    checklist_completed: arr(d.checklist).filter((c: any) => c?.completed).length,
    photo_count: arr(d.photos).length,
    created_at: s(d.createdAt),
  }));

export const flattenPackagingDeliveryItems = (list: any[]): Row[] => {
  const rows: Row[] = [];
  arr(list).forEach((d) => {
    arr(d.items).forEach((it: any, idx: number) => {
      rows.push({
        delivery_id: s(d.id),
        packing_list_number: s(d.packingListNumber),
        project_id: s(d.projectId),
        item_id: s(it.id),
        line_no: idx + 1,
        item_or_doc_name: s(it.itemOrDocName),
        product_id: s(it.productId),
        tag_number: s(it.tagNumber),
        quantity: n(it.quantity),
        unit_of_measure: s(it.unit),
        package_type: s(it.packageType),
        dimensions: s(it.dimensions),
        weight: n(it.weight),
        box_number: s(it.boxNumber),
        actual_delivery_date: s(it.actualDeliveryDate),
      });
    });
  });
  return rows;
};

export const flattenAfterSalesServices = (list: any[]): Row[] =>
  arr(list).map((a) => ({
    id: s(a.id),
    project_id: s(a.projectId),
    project_name: s(a.projectName),
    proforma_number: s(a.proformaNumber),
    item_name: s(a.itemName),
    status: s(a.status),
    start_date: s(a.startDate),
    end_date: s(a.endDate),
    return_date: s(a.returnDate),
    issue_description: s(a.issueDescription),
    actions_taken: s(a.actionsTaken),
    item_count: arr(a.items).length,
    created_at: s(a.createdAt),
    created_by: s(a.createdBy),
  }));

export const flattenAfterSalesServiceItems = (list: any[]): Row[] => {
  const rows: Row[] = [];
  arr(list).forEach((a) => {
    arr(a.items).forEach((it: any, idx: number) => {
      rows.push({
        service_id: s(a.id),
        project_id: s(a.projectId),
        item_id: s(it.id),
        line_no: idx + 1,
        product_id: s(it.productId),
        product_name: s(it.productName),
        status: s(it.status),
        start_date: s(it.startDate),
        end_date: s(it.endDate),
        return_date: s(it.returnDate),
        issue_description: s(it.issueDescription),
        actions_taken: s(it.actionsTaken),
      });
    });
  });
  return rows;
};

/* ----------------------------- project activities ----------------------------- */

export const flattenProjectActivities = (groups: any[]): Row[] => {
  const rows: Row[] = [];
  arr(groups).forEach((g) => {
    arr(g.activities).forEach((a: any, idx: number) => {
      rows.push({
        group_id: s(g.id),
        project_id: s(g.projectId),
        category_id: s(g.categoryId),
        category_name: s(g.categoryName),
        group_status: s(g.status),
        group_start_date: s(g.startDate),
        group_end_date: s(g.endDate),
        activity_id: s(a.id),
        line_no: idx + 1,
        text: s(a.text),
        created_at: s(a.createdAt),
        created_by: s(a.createdBy),
        has_attachment: !!a.attachment,
        has_referral: !!a.referral,
        referral_assigned_to: s(a.referral?.assignedTo),
        referral_assigned_by: s(a.referral?.assignedBy),
        referral_status: s(a.referral?.status),
        referral_action_required: s(a.referral?.actionRequired),
        referral_message_count: arr(a.referral?.messages).length,
      });
    });
  });
  return rows;
};

/* ----------------------------- users (no credentials) ----------------------------- */

/** Deliberately omits `password` — credentials must never reach the report store. */
export const flattenUsers = (users: any[]): Row[] =>
  arr(users).map((u) => ({
    id: s(u.id),
    username: s(u.username),
    full_name: s(u.fullName),
    role: s(u.role),
    is_system_admin: b(u.isSystemAdmin),
    position: s(u.position),
  }));

/* ----------------------------- orchestration ----------------------------- */

/** The parsed collections, as stored under each `erp_*` key. */
export interface StoreCollections {
  erp_customers?: any[];
  erp_projects?: any[];
  erp_proformas?: any[];
  erp_purchase_orders?: any[];
  erp_transactions?: any[];
  erp_suppliers?: any[];
  erp_supplier_inquiries?: any[];
  erp_products?: any[];
  erp_inventory_transactions?: any[];
  erp_tasks?: any[];
  erp_packaging_deliveries?: any[];
  erp_after_sales_services?: any[];
  erp_project_category_groups?: any[];
  erp_users?: any[];
}

/** Builds every reporting table from the store, in dependency-free order. */
export function buildReportingTables(store: StoreCollections): FlatDataset[] {
  return [
    { table: "customers", rows: flattenCustomers(store.erp_customers || []) },
    { table: "suppliers", rows: flattenSuppliers(store.erp_suppliers || []) },
    { table: "users", rows: flattenUsers(store.erp_users || []) },

    { table: "projects", rows: flattenProjects(store.erp_projects || []) },
    { table: "project_items", rows: flattenProjectItems(store.erp_projects || []) },
    { table: "project_milestones", rows: flattenProjectMilestones(store.erp_projects || []) },
    { table: "project_activities", rows: flattenProjectActivities(store.erp_project_category_groups || []) },

    { table: "proformas", rows: flattenProformas(store.erp_proformas || []) },
    { table: "proforma_items", rows: flattenProformaItems(store.erp_proformas || []) },

    { table: "purchase_orders", rows: flattenPurchaseOrders(store.erp_purchase_orders || []) },
    { table: "purchase_order_items", rows: flattenPurchaseOrderItems(store.erp_purchase_orders || []) },

    { table: "transactions", rows: flattenTransactions(store.erp_transactions || []) },

    { table: "supplier_inquiries", rows: flattenSupplierInquiries(store.erp_supplier_inquiries || []) },
    { table: "supplier_inquiry_items", rows: flattenSupplierInquiryItems(store.erp_supplier_inquiries || []) },
    { table: "supplier_inquiry_steps", rows: flattenSupplierInquirySteps(store.erp_supplier_inquiries || []) },

    { table: "products", rows: flattenProducts(store.erp_products || []) },
    { table: "product_variants", rows: flattenProductVariants(store.erp_products || []) },
    { table: "inventory_transactions", rows: flattenInventoryTransactions(store.erp_inventory_transactions || []) },

    { table: "tasks", rows: flattenTasks(store.erp_tasks || []) },

    { table: "packaging_deliveries", rows: flattenPackagingDeliveries(store.erp_packaging_deliveries || []) },
    { table: "packaging_delivery_items", rows: flattenPackagingDeliveryItems(store.erp_packaging_deliveries || []) },

    { table: "after_sales_services", rows: flattenAfterSalesServices(store.erp_after_sales_services || []) },
    { table: "after_sales_service_items", rows: flattenAfterSalesServiceItems(store.erp_after_sales_services || []) },
  ];
}
