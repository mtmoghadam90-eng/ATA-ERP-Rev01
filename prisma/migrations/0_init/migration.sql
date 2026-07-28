BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] NVARCHAR(36) NOT NULL,
    [username] NVARCHAR(100) NOT NULL,
    [passwordHash] NVARCHAR(200) NOT NULL,
    [fullName] NVARCHAR(200) NOT NULL,
    [role] NVARCHAR(30) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'user',
    [isSystemAdmin] BIT NOT NULL CONSTRAINT [users_isSystemAdmin_df] DEFAULT 0,
    [position] NVARCHAR(150),
    [signatureImage] NVARCHAR(500),
    [isActive] BIT NOT NULL CONSTRAINT [users_isActive_df] DEFAULT 1,
    [permissions] NVARCHAR(max),
    [sessionEpoch] INT NOT NULL CONSTRAINT [users_sessionEpoch_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_username_key] UNIQUE NONCLUSTERED ([username])
);

-- CreateTable
CREATE TABLE [dbo].[customers] (
    [id] NVARCHAR(36) NOT NULL,
    [customerType] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [customers_status_df] DEFAULT 'فعال',
    [companyName] NVARCHAR(300) NOT NULL,
    [firstName] NVARCHAR(150),
    [lastName] NVARCHAR(150),
    [gender] NVARCHAR(10),
    [position] NVARCHAR(150),
    [economicCode] NVARCHAR(50),
    [industry] NVARCHAR(150),
    [keyPerson] NVARCHAR(200),
    [phone] NVARCHAR(50),
    [mobile] NVARCHAR(50),
    [email] NVARCHAR(200),
    [province] NVARCHAR(100),
    [city] NVARCHAR(100),
    [address] NVARCHAR(max),
    [notes] NVARCHAR(max),
    [tags] NVARCHAR(500),
    [mobileNormalized] NVARCHAR(30),
    [customValues] NVARCHAR(max),
    [ownerUserId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [customers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [customers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[customer_links] (
    [fromId] NVARCHAR(36) NOT NULL,
    [toId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [customer_links_pkey] PRIMARY KEY CLUSTERED ([fromId],[toId])
);

-- CreateTable
CREATE TABLE [dbo].[customer_agreements] (
    [id] NVARCHAR(36) NOT NULL,
    [customerId] NVARCHAR(36) NOT NULL,
    [moduleName] NVARCHAR(100) NOT NULL,
    [text] NVARCHAR(max) NOT NULL,
    [createdBy] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [customer_agreements_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [customer_agreements_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[suppliers] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(300) NOT NULL,
    [country] NVARCHAR(100),
    [contactName] NVARCHAR(200),
    [phone] NVARCHAR(50),
    [email] NVARCHAR(200),
    [website] NVARCHAR(300),
    [paymentTerms] NVARCHAR(300),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [suppliers_status_df] DEFAULT 'فعال',
    [description] NVARCHAR(max),
    [providedCategories] NVARCHAR(max),
    [customValues] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [suppliers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [suppliers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[products] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(60) NOT NULL,
    [name] NVARCHAR(300) NOT NULL,
    [displayName] NVARCHAR(300) NOT NULL,
    [category] NVARCHAR(150),
    [brand] NVARCHAR(150),
    [modelNumber] NVARCHAR(150),
    [unit] NVARCHAR(50),
    [description] NVARCHAR(max),
    [supplyType] NVARCHAR(20) NOT NULL CONSTRAINT [products_supplyType_df] DEFAULT 'INVENTORY',
    [hasVariants] BIT NOT NULL CONSTRAINT [products_hasVariants_df] DEFAULT 0,
    [stockLevel] DECIMAL(18,3) NOT NULL CONSTRAINT [products_stockLevel_df] DEFAULT 0,
    [minStockLevel] DECIMAL(18,3) NOT NULL CONSTRAINT [products_minStockLevel_df] DEFAULT 0,
    [basePriceRial] DECIMAL(19,2),
    [priceForeign] DECIMAL(19,4),
    [currencyForeign] NVARCHAR(20),
    [features] NVARCHAR(max),
    [configRules] NVARCHAR(max),
    [images] NVARCHAR(max),
    [priceCalc] NVARCHAR(max),
    [customValues] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [products_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [products_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [products_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[product_variants] (
    [id] NVARCHAR(36) NOT NULL,
    [productId] NVARCHAR(36) NOT NULL,
    [sku] NVARCHAR(120) NOT NULL,
    [attributes] NVARCHAR(max),
    [stockLevel] DECIMAL(18,3) NOT NULL CONSTRAINT [product_variants_stockLevel_df] DEFAULT 0,
    [minStockLevel] DECIMAL(18,3) NOT NULL CONSTRAINT [product_variants_minStockLevel_df] DEFAULT 0,
    [priceRial] DECIMAL(19,2),
    [priceForeign] DECIMAL(19,4),
    [currencyForeign] NVARCHAR(20),
    [priceCalc] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [product_variants_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [product_variants_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_product_variants_sku] UNIQUE NONCLUSTERED ([sku])
);

-- CreateTable
CREATE TABLE [dbo].[inventory_transactions] (
    [id] NVARCHAR(36) NOT NULL,
    [productId] NVARCHAR(36) NOT NULL,
    [variantId] NVARCHAR(36),
    [occurredAt] DATE NOT NULL,
    [occurredAtJalali] NVARCHAR(10),
    [type] NVARCHAR(5) NOT NULL,
    [quantity] DECIMAL(18,3) NOT NULL,
    [signedQuantity] DECIMAL(18,3) NOT NULL,
    [referenceType] NVARCHAR(30),
    [referenceId] NVARCHAR(36),
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [inventory_transactions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [inventory_transactions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[projects] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(60) NOT NULL,
    [name] NVARCHAR(400) NOT NULL,
    [customerId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(50) NOT NULL,
    [lossReason] NVARCHAR(300),
    [description] NVARCHAR(max),
    [creationDate] DATE NOT NULL,
    [creationDateJalali] NVARCHAR(10),
    [opportunityDate] DATE,
    [opportunityDateJalali] NVARCHAR(10),
    [expectedCloseDate] DATE,
    [expectedCloseDateJalali] NVARCHAR(10),
    [winningDate] DATE,
    [winningDateJalali] NVARCHAR(10),
    [agreedDeliveryDate] DATE,
    [agreedDeliveryDateJalali] NVARCHAR(10),
    [closingDate] DATE,
    [closingDateJalali] NVARCHAR(10),
    [estimatedValueRial] DECIMAL(19,2),
    [probabilityPercent] INT,
    [marketingChannel] NVARCHAR(150),
    [leadQuality] NVARCHAR(100),
    [referrerName] NVARCHAR(200),
    [communicationMethod] NVARCHAR(100),
    [customerInquiryNumber] NVARCHAR(100),
    [ownerUserId] NVARCHAR(36),
    [endUserCustomerId] NVARCHAR(36),
    [financialContactId] NVARCHAR(36),
    [technicalContactId] NVARCHAR(36),
    [attachments] NVARCHAR(max),
    [manualDocuments] NVARCHAR(max),
    [milestoneRules] NVARCHAR(max),
    [customValues] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [projects_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [projects_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [projects_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[project_items] (
    [id] NVARCHAR(36) NOT NULL,
    [projectId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [productId] NVARCHAR(36),
    [name] NVARCHAR(400) NOT NULL,
    [quantity] DECIMAL(18,3) NOT NULL CONSTRAINT [project_items_quantity_df] DEFAULT 1,
    [supplyMethod] NVARCHAR(20),
    [category] NVARCHAR(30),
    [equipmentType] NVARCHAR(200),
    [size] NVARCHAR(100),
    [tagNumber] NVARCHAR(100),
    CONSTRAINT [project_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[project_milestones] (
    [id] NVARCHAR(36) NOT NULL,
    [projectId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [name] NVARCHAR(300) NOT NULL,
    [isCompleted] BIT NOT NULL CONSTRAINT [project_milestones_isCompleted_df] DEFAULT 0,
    [completedAt] DATE,
    [completedAtJalali] NVARCHAR(10),
    [dueDate] DATE,
    [dueDateJalali] NVARCHAR(10),
    [notes] NVARCHAR(max),
    [triggerType] NVARCHAR(30),
    [triggerCategoryName] NVARCHAR(200),
    CONSTRAINT [project_milestones_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[proformas] (
    [id] NVARCHAR(36) NOT NULL,
    [proformaNumber] NVARCHAR(60) NOT NULL,
    [proformaType] NVARCHAR(20) NOT NULL CONSTRAINT [proformas_proformaType_df] DEFAULT 'FINANCIAL',
    [customerId] NVARCHAR(36) NOT NULL,
    [contactCustomerId] NVARCHAR(36),
    [contactPrefix] NVARCHAR(100),
    [projectId] NVARCHAR(36),
    [status] NVARCHAR(50) NOT NULL,
    [isCancelled] BIT NOT NULL CONSTRAINT [proformas_isCancelled_df] DEFAULT 0,
    [lossReason] NVARCHAR(300),
    [currency] NVARCHAR(20) NOT NULL CONSTRAINT [proformas_currency_df] DEFAULT 'ریال',
    [issueDate] DATE NOT NULL,
    [issueDateJalali] NVARCHAR(10),
    [expiryDate] DATE,
    [expiryDateJalali] NVARCHAR(10),
    [deliveryDate] DATE,
    [deliveryDateJalali] NVARCHAR(10),
    [totalAmount] DECIMAL(19,2) NOT NULL CONSTRAINT [proformas_totalAmount_df] DEFAULT 0,
    [discountPercent] DECIMAL(9,4) NOT NULL CONSTRAINT [proformas_discountPercent_df] DEFAULT 0,
    [discountAmount] DECIMAL(19,2) NOT NULL CONSTRAINT [proformas_discountAmount_df] DEFAULT 0,
    [taxPercent] DECIMAL(9,4) NOT NULL CONSTRAINT [proformas_taxPercent_df] DEFAULT 0,
    [taxAmount] DECIMAL(19,2) NOT NULL CONSTRAINT [proformas_taxAmount_df] DEFAULT 0,
    [extraCosts] DECIMAL(19,2) NOT NULL CONSTRAINT [proformas_extraCosts_df] DEFAULT 0,
    [finalAmount] DECIMAL(19,2) NOT NULL CONSTRAINT [proformas_finalAmount_df] DEFAULT 0,
    [historicalExchangeRate] DECIMAL(19,4),
    [notes] NVARCHAR(max),
    [sentMethod] NVARCHAR(100),
    [sentRecipients] NVARCHAR(max),
    [customValues] NVARCHAR(max),
    [creatorUserId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [proformas_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [proformas_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [proformas_proformaNumber_key] UNIQUE NONCLUSTERED ([proformaNumber])
);

-- CreateTable
CREATE TABLE [dbo].[proforma_items] (
    [id] NVARCHAR(36) NOT NULL,
    [proformaId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [productId] NVARCHAR(36),
    [variantId] NVARCHAR(36),
    [productName] NVARCHAR(400) NOT NULL,
    [productCode] NVARCHAR(60),
    [brand] NVARCHAR(150),
    [tagNumber] NVARCHAR(100),
    [quantity] DECIMAL(18,3) NOT NULL CONSTRAINT [proforma_items_quantity_df] DEFAULT 1,
    [unitPriceRial] DECIMAL(19,2) NOT NULL CONSTRAINT [proforma_items_unitPriceRial_df] DEFAULT 0,
    [totalPriceRial] DECIMAL(19,2) NOT NULL CONSTRAINT [proforma_items_totalPriceRial_df] DEFAULT 0,
    [supplyMethod] NVARCHAR(20),
    [status] NVARCHAR(30),
    [lossReason] NVARCHAR(300),
    [techSpecs] NVARCHAR(max),
    [deliveryRange] NVARCHAR(50),
    [deliveryUnit] NVARCHAR(20),
    [deliveryType] NVARCHAR(20),
    [deliveryPostfix] NVARCHAR(100),
    [selectedFeatures] NVARCHAR(max),
    [selectedImage] NVARCHAR(500),
    CONSTRAINT [proforma_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[purchase_orders] (
    [id] NVARCHAR(36) NOT NULL,
    [poNumber] NVARCHAR(60) NOT NULL,
    [supplierId] NVARCHAR(36) NOT NULL,
    [projectId] NVARCHAR(36),
    [proformaId] NVARCHAR(36),
    [status] NVARCHAR(60) NOT NULL,
    [currency] NVARCHAR(20) NOT NULL CONSTRAINT [purchase_orders_currency_df] DEFAULT 'دلار',
    [exchangeRate] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_orders_exchangeRate_df] DEFAULT 1,
    [orderDate] DATE NOT NULL,
    [orderDateJalali] NVARCHAR(10),
    [expectedDeliveryDate] DATE,
    [expectedDeliveryDateJalali] NVARCHAR(10),
    [paymentDate] DATE,
    [paymentDateJalali] NVARCHAR(10),
    [goodsReadyDate] DATE,
    [goodsReadyDateJalali] NVARCHAR(10),
    [shipmentDate] DATE,
    [shipmentDateJalali] NVARCHAR(10),
    [clearanceDate] DATE,
    [clearanceDateJalali] NVARCHAR(10),
    [receivedDate] DATE,
    [receivedDateJalali] NVARCHAR(10),
    [totalForeignAmount] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_orders_totalForeignAmount_df] DEFAULT 0,
    [shippingCostRial] DECIMAL(19,2) NOT NULL CONSTRAINT [purchase_orders_shippingCostRial_df] DEFAULT 0,
    [customsDutyRial] DECIMAL(19,2) NOT NULL CONSTRAINT [purchase_orders_customsDutyRial_df] DEFAULT 0,
    [remittanceFeeRial] DECIMAL(19,2) NOT NULL CONSTRAINT [purchase_orders_remittanceFeeRial_df] DEFAULT 0,
    [shippingCostForeign] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_orders_shippingCostForeign_df] DEFAULT 0,
    [remittanceFeeForeign] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_orders_remittanceFeeForeign_df] DEFAULT 0,
    [landedCostRial] DECIMAL(19,2) NOT NULL CONSTRAINT [purchase_orders_landedCostRial_df] DEFAULT 0,
    [landedCostForeign] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_orders_landedCostForeign_df] DEFAULT 0,
    [notes] NVARCHAR(max),
    [customValues] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [purchase_orders_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [purchase_orders_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [purchase_orders_poNumber_key] UNIQUE NONCLUSTERED ([poNumber])
);

-- CreateTable
CREATE TABLE [dbo].[purchase_order_items] (
    [id] NVARCHAR(36) NOT NULL,
    [purchaseOrderId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [productId] NVARCHAR(36),
    [variantId] NVARCHAR(36),
    [productName] NVARCHAR(400) NOT NULL,
    [productCode] NVARCHAR(60),
    [brand] NVARCHAR(150),
    [tagNumber] NVARCHAR(100),
    [quantity] DECIMAL(18,3) NOT NULL CONSTRAINT [purchase_order_items_quantity_df] DEFAULT 1,
    [unitPriceForeign] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_order_items_unitPriceForeign_df] DEFAULT 0,
    [totalPriceForeign] DECIMAL(19,4) NOT NULL CONSTRAINT [purchase_order_items_totalPriceForeign_df] DEFAULT 0,
    [proformaItemId] NVARCHAR(36),
    [proformaItemName] NVARCHAR(400),
    [supplierNotes] NVARCHAR(max),
    CONSTRAINT [purchase_order_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[transactions] (
    [id] NVARCHAR(36) NOT NULL,
    [documentNumber] NVARCHAR(60) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [receiptType] NVARCHAR(100),
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [transactions_status_df] DEFAULT 'تأیید شده',
    [occurredAt] DATE NOT NULL,
    [occurredAtJalali] NVARCHAR(10),
    [customerId] NVARCHAR(36),
    [supplierId] NVARCHAR(36),
    [projectId] NVARCHAR(36),
    [proformaId] NVARCHAR(36),
    [purchaseOrderId] NVARCHAR(36),
    [partyName] NVARCHAR(300),
    [amountRial] DECIMAL(19,2) NOT NULL CONSTRAINT [transactions_amountRial_df] DEFAULT 0,
    [amountForeign] DECIMAL(19,4),
    [exchangeRate] DECIMAL(19,4),
    [isDirectForeign] BIT NOT NULL CONSTRAINT [transactions_isDirectForeign_df] DEFAULT 0,
    [paymentType] NVARCHAR(50) NOT NULL,
    [referenceNumber] NVARCHAR(100),
    [notes] NVARCHAR(max),
    [reversalOfTransactionId] NVARCHAR(36),
    [customValues] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [transactions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [transactions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [transactions_documentNumber_key] UNIQUE NONCLUSTERED ([documentNumber])
);

-- CreateTable
CREATE TABLE [dbo].[supplier_inquiries] (
    [id] NVARCHAR(36) NOT NULL,
    [projectId] NVARCHAR(36) NOT NULL,
    [supplierId] NVARCHAR(36) NOT NULL,
    [isWinner] BIT NOT NULL CONSTRAINT [supplier_inquiries_isWinner_df] DEFAULT 0,
    [winnerDate] DATE,
    [winnerDateJalali] NVARCHAR(10),
    [offerConfirmed] BIT NOT NULL CONSTRAINT [supplier_inquiries_offerConfirmed_df] DEFAULT 0,
    [offerConfirmedDate] DATE,
    [offerConfirmedDateJalali] NVARCHAR(10),
    [creationDate] DATE NOT NULL,
    [creationDateJalali] NVARCHAR(10),
    [technicalOfferUrl] NVARCHAR(500),
    [financialOfferUrl] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [supplier_inquiries_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [supplier_inquiries_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[supplier_inquiry_items] (
    [id] NVARCHAR(36) NOT NULL,
    [inquiryId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [name] NVARCHAR(400) NOT NULL,
    [brand] NVARCHAR(150),
    [partNumber] NVARCHAR(150),
    [tagNumber] NVARCHAR(100),
    [quantity] DECIMAL(18,3) NOT NULL CONSTRAINT [supplier_inquiry_items_quantity_df] DEFAULT 1,
    [currency] NVARCHAR(20) NOT NULL CONSTRAINT [supplier_inquiry_items_currency_df] DEFAULT 'دلار',
    [priceForeign] DECIMAL(19,4) NOT NULL CONSTRAINT [supplier_inquiry_items_priceForeign_df] DEFAULT 0,
    [priceRial] DECIMAL(19,2) NOT NULL CONSTRAINT [supplier_inquiry_items_priceRial_df] DEFAULT 0,
    [deliveryTime] NVARCHAR(100),
    [notes] NVARCHAR(max),
    CONSTRAINT [supplier_inquiry_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[supplier_inquiry_steps] (
    [id] NVARCHAR(36) NOT NULL,
    [inquiryId] NVARCHAR(36) NOT NULL,
    [stepNo] INT NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [occurredAtJalali] NVARCHAR(10),
    [method] NVARCHAR(50),
    [recipientName] NVARCHAR(200),
    [notes] NVARCHAR(max),
    [isAuto] BIT NOT NULL CONSTRAINT [supplier_inquiry_steps_isAuto_df] DEFAULT 0,
    [autoKey] NVARCHAR(40),
    CONSTRAINT [supplier_inquiry_steps_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[packaging_deliveries] (
    [id] NVARCHAR(36) NOT NULL,
    [packingListNumber] NVARCHAR(60) NOT NULL,
    [projectId] NVARCHAR(36) NOT NULL,
    [proformaId] NVARCHAR(36),
    [deliveryDate] DATE NOT NULL,
    [deliveryDateJalali] NVARCHAR(10),
    [actualDeliveryDate] DATE,
    [actualDeliveryDateJalali] NVARCHAR(10),
    [shippingMethod] NVARCHAR(100),
    [preDeliveryTestNotes] NVARCHAR(max),
    [checklist] NVARCHAR(max),
    [photos] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [packaging_deliveries_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [packaging_deliveries_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [packaging_deliveries_packingListNumber_key] UNIQUE NONCLUSTERED ([packingListNumber])
);

-- CreateTable
CREATE TABLE [dbo].[packing_items] (
    [id] NVARCHAR(36) NOT NULL,
    [deliveryId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [itemOrDocName] NVARCHAR(400) NOT NULL,
    [productId] NVARCHAR(36),
    [tagNumber] NVARCHAR(100),
    [quantity] DECIMAL(18,3) NOT NULL CONSTRAINT [packing_items_quantity_df] DEFAULT 1,
    [packageType] NVARCHAR(100),
    [dimensions] NVARCHAR(100),
    [weight] DECIMAL(18,3) NOT NULL CONSTRAINT [packing_items_weight_df] DEFAULT 0,
    [boxNumber] NVARCHAR(50),
    [actualDeliveryDate] DATE,
    [actualDeliveryDateJalali] NVARCHAR(10),
    CONSTRAINT [packing_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[after_sales_services] (
    [id] NVARCHAR(36) NOT NULL,
    [projectId] NVARCHAR(36) NOT NULL,
    [proformaNumber] NVARCHAR(60),
    [proformaItemName] NVARCHAR(400),
    [itemName] NVARCHAR(400) NOT NULL,
    [status] NVARCHAR(50) NOT NULL,
    [issueDescription] NVARCHAR(max),
    [actionsTaken] NVARCHAR(max),
    [startDate] DATE NOT NULL,
    [startDateJalali] NVARCHAR(10),
    [endDate] DATE,
    [endDateJalali] NVARCHAR(10),
    [returnDate] DATE,
    [returnDateJalali] NVARCHAR(10),
    [createdBy] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [after_sales_services_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [after_sales_services_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[after_sales_service_items] (
    [id] NVARCHAR(36) NOT NULL,
    [serviceId] NVARCHAR(36) NOT NULL,
    [lineNo] INT NOT NULL,
    [productId] NVARCHAR(36),
    [productName] NVARCHAR(400) NOT NULL,
    [status] NVARCHAR(50) NOT NULL,
    [issueDescription] NVARCHAR(max),
    [actionsTaken] NVARCHAR(max),
    [startDate] DATE,
    [startDateJalali] NVARCHAR(10),
    [endDate] DATE,
    [endDateJalali] NVARCHAR(10),
    [returnDate] DATE,
    [returnDateJalali] NVARCHAR(10),
    CONSTRAINT [after_sales_service_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[project_category_groups] (
    [id] NVARCHAR(36) NOT NULL,
    [projectId] NVARCHAR(36) NOT NULL,
    [categoryId] NVARCHAR(36) NOT NULL,
    [categoryName] NVARCHAR(200) NOT NULL,
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [project_category_groups_status_df] DEFAULT 'جاری',
    [startDate] DATE,
    [startDateJalali] NVARCHAR(10),
    [endDate] DATE,
    [endDateJalali] NVARCHAR(10),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [project_category_groups_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [project_category_groups_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[project_activities] (
    [id] NVARCHAR(36) NOT NULL,
    [groupId] NVARCHAR(36) NOT NULL,
    [text] NVARCHAR(max) NOT NULL,
    [authorUserId] NVARCHAR(36),
    [authorName] NVARCHAR(200),
    [attachmentName] NVARCHAR(300),
    [attachmentSize] NVARCHAR(50),
    [attachmentUrl] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [project_activities_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [project_activities_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[project_referrals] (
    [id] NVARCHAR(36) NOT NULL,
    [activityId] NVARCHAR(36) NOT NULL,
    [assignedToUserId] NVARCHAR(36),
    [assignedToName] NVARCHAR(200),
    [assignedByUserId] NVARCHAR(36),
    [assignedByName] NVARCHAR(200),
    [actionRequired] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [project_referrals_status_df] DEFAULT 'در انتظار اقدام',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [project_referrals_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [project_referrals_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [project_referrals_activityId_key] UNIQUE NONCLUSTERED ([activityId])
);

-- CreateTable
CREATE TABLE [dbo].[referral_messages] (
    [id] NVARCHAR(36) NOT NULL,
    [referralId] NVARCHAR(36) NOT NULL,
    [text] NVARCHAR(max) NOT NULL,
    [responderUserId] NVARCHAR(36),
    [responderName] NVARCHAR(200),
    [attachmentName] NVARCHAR(300),
    [attachmentSize] NVARCHAR(50),
    [attachmentUrl] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [referral_messages_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [referral_messages_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tasks] (
    [id] NVARCHAR(36) NOT NULL,
    [title] NVARCHAR(400) NOT NULL,
    [description] NVARCHAR(max),
    [relatedToType] NVARCHAR(50),
    [relatedToId] NVARCHAR(36),
    [relatedToName] NVARCHAR(400),
    [priority] NVARCHAR(20) NOT NULL CONSTRAINT [tasks_priority_df] DEFAULT 'متوسط',
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [tasks_status_df] DEFAULT 'در حال انجام',
    [dueDate] DATE,
    [dueDateJalali] NVARCHAR(10),
    [assignedToUserId] NVARCHAR(36),
    [assignedToName] NVARCHAR(200),
    [reminderEnabled] BIT NOT NULL CONSTRAINT [tasks_reminderEnabled_df] DEFAULT 0,
    [reminderDate] DATE,
    [reminderDateJalali] NVARCHAR(10),
    [reminderTime] NVARCHAR(5),
    [customValues] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [tasks_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [tasks_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[module_notes] (
    [id] NVARCHAR(36) NOT NULL,
    [entityType] NVARCHAR(40) NOT NULL,
    [entityId] NVARCHAR(36) NOT NULL,
    [text] NVARCHAR(max) NOT NULL,
    [authorName] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [module_notes_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [module_notes_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[audit_logs] (
    [id] NVARCHAR(36) NOT NULL,
    [action] NVARCHAR(20) NOT NULL,
    [module] NVARCHAR(100) NOT NULL,
    [entityId] NVARCHAR(36),
    [description] NVARCHAR(max) NOT NULL,
    [userId] NVARCHAR(36),
    [userFullName] NVARCHAR(200),
    [beforeState] NVARCHAR(max),
    [afterState] NVARCHAR(max),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [audit_logs_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [occurredAtJalali] NVARCHAR(20),
    CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[exchange_rates] (
    [id] NVARCHAR(36) NOT NULL,
    [currency] NVARCHAR(10) NOT NULL,
    [name] NVARCHAR(50) NOT NULL,
    [rateToRial] DECIMAL(19,4) NOT NULL,
    [lastUpdated] DATETIME2 NOT NULL CONSTRAINT [exchange_rates_lastUpdated_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [exchange_rates_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [exchange_rates_currency_key] UNIQUE NONCLUSTERED ([currency])
);

-- CreateTable
CREATE TABLE [dbo].[app_settings] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [app_settings_id_df] DEFAULT 'singleton',
    [data] NVARCHAR(max) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [app_settings_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_isActive_idx] ON [dbo].[users]([isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customers_economicCode_idx] ON [dbo].[customers]([economicCode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customers_companyName_idx] ON [dbo].[customers]([companyName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customers_mobileNormalized_idx] ON [dbo].[customers]([mobileNormalized]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customers_customerType_status_idx] ON [dbo].[customers]([customerType], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customers_ownerUserId_idx] ON [dbo].[customers]([ownerUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customer_links_toId_idx] ON [dbo].[customer_links]([toId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customer_agreements_customerId_moduleName_idx] ON [dbo].[customer_agreements]([customerId], [moduleName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [suppliers_name_idx] ON [dbo].[suppliers]([name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [suppliers_status_idx] ON [dbo].[suppliers]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [products_category_idx] ON [dbo].[products]([category]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [products_brand_idx] ON [dbo].[products]([brand]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [products_displayName_idx] ON [dbo].[products]([displayName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [product_variants_productId_idx] ON [dbo].[product_variants]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [inventory_transactions_productId_occurredAt_idx] ON [dbo].[inventory_transactions]([productId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [inventory_transactions_variantId_idx] ON [dbo].[inventory_transactions]([variantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [inventory_transactions_referenceType_referenceId_idx] ON [dbo].[inventory_transactions]([referenceType], [referenceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [projects_customerId_idx] ON [dbo].[projects]([customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [projects_status_idx] ON [dbo].[projects]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [projects_ownerUserId_idx] ON [dbo].[projects]([ownerUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [projects_creationDate_idx] ON [dbo].[projects]([creationDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_items_projectId_idx] ON [dbo].[project_items]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_items_productId_idx] ON [dbo].[project_items]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_items_tagNumber_idx] ON [dbo].[project_items]([tagNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_milestones_projectId_idx] ON [dbo].[project_milestones]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proformas_customerId_idx] ON [dbo].[proformas]([customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proformas_projectId_idx] ON [dbo].[proformas]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proformas_status_idx] ON [dbo].[proformas]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proformas_issueDate_idx] ON [dbo].[proformas]([issueDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proforma_items_proformaId_idx] ON [dbo].[proforma_items]([proformaId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proforma_items_productId_idx] ON [dbo].[proforma_items]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proforma_items_status_idx] ON [dbo].[proforma_items]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [proforma_items_tagNumber_idx] ON [dbo].[proforma_items]([tagNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_orders_supplierId_idx] ON [dbo].[purchase_orders]([supplierId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_orders_projectId_idx] ON [dbo].[purchase_orders]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_orders_status_idx] ON [dbo].[purchase_orders]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_orders_orderDate_idx] ON [dbo].[purchase_orders]([orderDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_order_items_purchaseOrderId_idx] ON [dbo].[purchase_order_items]([purchaseOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_order_items_productId_idx] ON [dbo].[purchase_order_items]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [transactions_customerId_idx] ON [dbo].[transactions]([customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [transactions_projectId_idx] ON [dbo].[transactions]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [transactions_occurredAt_idx] ON [dbo].[transactions]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [transactions_type_status_idx] ON [dbo].[transactions]([type], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_inquiries_projectId_idx] ON [dbo].[supplier_inquiries]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_inquiries_supplierId_idx] ON [dbo].[supplier_inquiries]([supplierId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_inquiries_isWinner_idx] ON [dbo].[supplier_inquiries]([isWinner]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_inquiry_items_inquiryId_idx] ON [dbo].[supplier_inquiry_items]([inquiryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_inquiry_steps_inquiryId_idx] ON [dbo].[supplier_inquiry_steps]([inquiryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [packaging_deliveries_projectId_idx] ON [dbo].[packaging_deliveries]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [packaging_deliveries_deliveryDate_idx] ON [dbo].[packaging_deliveries]([deliveryDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [packing_items_deliveryId_idx] ON [dbo].[packing_items]([deliveryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [after_sales_services_projectId_idx] ON [dbo].[after_sales_services]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [after_sales_services_status_idx] ON [dbo].[after_sales_services]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [after_sales_service_items_serviceId_idx] ON [dbo].[after_sales_service_items]([serviceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_category_groups_projectId_idx] ON [dbo].[project_category_groups]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_category_groups_categoryId_idx] ON [dbo].[project_category_groups]([categoryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_activities_groupId_idx] ON [dbo].[project_activities]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_activities_createdAt_idx] ON [dbo].[project_activities]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [project_referrals_assignedToUserId_status_idx] ON [dbo].[project_referrals]([assignedToUserId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [referral_messages_referralId_idx] ON [dbo].[referral_messages]([referralId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [tasks_assignedToUserId_status_idx] ON [dbo].[tasks]([assignedToUserId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [tasks_dueDate_idx] ON [dbo].[tasks]([dueDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [tasks_relatedToType_relatedToId_idx] ON [dbo].[tasks]([relatedToType], [relatedToId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [module_notes_entityType_entityId_idx] ON [dbo].[module_notes]([entityType], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_occurredAt_idx] ON [dbo].[audit_logs]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_module_action_idx] ON [dbo].[audit_logs]([module], [action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_entityId_idx] ON [dbo].[audit_logs]([entityId]);

-- AddForeignKey
ALTER TABLE [dbo].[customers] ADD CONSTRAINT [customers_ownerUserId_fkey] FOREIGN KEY ([ownerUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[customer_links] ADD CONSTRAINT [customer_links_fromId_fkey] FOREIGN KEY ([fromId]) REFERENCES [dbo].[customers]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[customer_links] ADD CONSTRAINT [customer_links_toId_fkey] FOREIGN KEY ([toId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[customer_agreements] ADD CONSTRAINT [customer_agreements_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[product_variants] ADD CONSTRAINT [product_variants_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[inventory_transactions] ADD CONSTRAINT [inventory_transactions_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[inventory_transactions] ADD CONSTRAINT [inventory_transactions_variantId_fkey] FOREIGN KEY ([variantId]) REFERENCES [dbo].[product_variants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[projects] ADD CONSTRAINT [projects_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[projects] ADD CONSTRAINT [projects_ownerUserId_fkey] FOREIGN KEY ([ownerUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[projects] ADD CONSTRAINT [projects_endUserCustomerId_fkey] FOREIGN KEY ([endUserCustomerId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[projects] ADD CONSTRAINT [projects_financialContactId_fkey] FOREIGN KEY ([financialContactId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[projects] ADD CONSTRAINT [projects_technicalContactId_fkey] FOREIGN KEY ([technicalContactId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[project_items] ADD CONSTRAINT [project_items_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[project_items] ADD CONSTRAINT [project_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[project_milestones] ADD CONSTRAINT [project_milestones_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [proformas_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [proformas_contactCustomerId_fkey] FOREIGN KEY ([contactCustomerId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [proformas_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [proformas_creatorUserId_fkey] FOREIGN KEY ([creatorUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [proforma_items_proformaId_fkey] FOREIGN KEY ([proformaId]) REFERENCES [dbo].[proformas]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [proforma_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[proforma_items] ADD CONSTRAINT [proforma_items_variantId_fkey] FOREIGN KEY ([variantId]) REFERENCES [dbo].[product_variants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_orders] ADD CONSTRAINT [purchase_orders_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[suppliers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_orders] ADD CONSTRAINT [purchase_orders_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_orders] ADD CONSTRAINT [purchase_orders_proformaId_fkey] FOREIGN KEY ([proformaId]) REFERENCES [dbo].[proformas]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_order_items] ADD CONSTRAINT [purchase_order_items_purchaseOrderId_fkey] FOREIGN KEY ([purchaseOrderId]) REFERENCES [dbo].[purchase_orders]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_order_items] ADD CONSTRAINT [purchase_order_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_order_items] ADD CONSTRAINT [purchase_order_items_variantId_fkey] FOREIGN KEY ([variantId]) REFERENCES [dbo].[product_variants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[transactions] ADD CONSTRAINT [transactions_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[transactions] ADD CONSTRAINT [transactions_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[suppliers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[transactions] ADD CONSTRAINT [transactions_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[transactions] ADD CONSTRAINT [transactions_proformaId_fkey] FOREIGN KEY ([proformaId]) REFERENCES [dbo].[proformas]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[transactions] ADD CONSTRAINT [transactions_purchaseOrderId_fkey] FOREIGN KEY ([purchaseOrderId]) REFERENCES [dbo].[purchase_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_inquiries] ADD CONSTRAINT [supplier_inquiries_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_inquiries] ADD CONSTRAINT [supplier_inquiries_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[suppliers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_inquiry_items] ADD CONSTRAINT [supplier_inquiry_items_inquiryId_fkey] FOREIGN KEY ([inquiryId]) REFERENCES [dbo].[supplier_inquiries]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_inquiry_steps] ADD CONSTRAINT [supplier_inquiry_steps_inquiryId_fkey] FOREIGN KEY ([inquiryId]) REFERENCES [dbo].[supplier_inquiries]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[packaging_deliveries] ADD CONSTRAINT [packaging_deliveries_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[packaging_deliveries] ADD CONSTRAINT [packaging_deliveries_proformaId_fkey] FOREIGN KEY ([proformaId]) REFERENCES [dbo].[proformas]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[packing_items] ADD CONSTRAINT [packing_items_deliveryId_fkey] FOREIGN KEY ([deliveryId]) REFERENCES [dbo].[packaging_deliveries]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[after_sales_services] ADD CONSTRAINT [after_sales_services_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[after_sales_service_items] ADD CONSTRAINT [after_sales_service_items_serviceId_fkey] FOREIGN KEY ([serviceId]) REFERENCES [dbo].[after_sales_services]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[project_category_groups] ADD CONSTRAINT [project_category_groups_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[project_activities] ADD CONSTRAINT [project_activities_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[project_category_groups]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[project_activities] ADD CONSTRAINT [project_activities_authorUserId_fkey] FOREIGN KEY ([authorUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[project_referrals] ADD CONSTRAINT [project_referrals_activityId_fkey] FOREIGN KEY ([activityId]) REFERENCES [dbo].[project_activities]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[project_referrals] ADD CONSTRAINT [project_referrals_assignedToUserId_fkey] FOREIGN KEY ([assignedToUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[project_referrals] ADD CONSTRAINT [project_referrals_assignedByUserId_fkey] FOREIGN KEY ([assignedByUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[referral_messages] ADD CONSTRAINT [referral_messages_referralId_fkey] FOREIGN KEY ([referralId]) REFERENCES [dbo].[project_referrals]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[referral_messages] ADD CONSTRAINT [referral_messages_responderUserId_fkey] FOREIGN KEY ([responderUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [audit_logs_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
