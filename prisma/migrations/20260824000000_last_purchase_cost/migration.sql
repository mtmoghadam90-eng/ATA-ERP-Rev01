-- What an item last actually cost to land, recorded beside the standard cost.
--
-- `priceCalc` holds the *standard* cost — what the company quotes from, and a
-- judgement about a typical purchase. A purchase order's per-line landed cost
-- is a different thing: it carries the freight and customs of one shipment, so
-- five units flown in urgently cost several times what two hundred by sea do.
-- Writing one into the other would price every future quotation off whichever
-- delivery happened to arrive last.
--
-- These columns keep the fact next to the judgement. The screen shows both,
-- warns when they have drifted apart, and adopting the real figure into the
-- standard is a deliberate act.
--
-- Nullable throughout: an item nobody has bought yet has no last purchase, and
-- that is not the same as one that cost nothing.

IF COL_LENGTH('products', 'lastPurchaseCostRial') IS NULL
    ALTER TABLE [dbo].[products] ADD [lastPurchaseCostRial] DECIMAL(19,2) NULL;
IF COL_LENGTH('products', 'lastPurchaseQuantity') IS NULL
    ALTER TABLE [dbo].[products] ADD [lastPurchaseQuantity] DECIMAL(18,3) NULL;
IF COL_LENGTH('products', 'lastPurchaseDate') IS NULL
    ALTER TABLE [dbo].[products] ADD [lastPurchaseDate] DATE NULL;
IF COL_LENGTH('products', 'lastPurchaseDateJalali') IS NULL
    ALTER TABLE [dbo].[products] ADD [lastPurchaseDateJalali] NVARCHAR(10) NULL;
IF COL_LENGTH('products', 'lastPurchaseOrderId') IS NULL
    ALTER TABLE [dbo].[products] ADD [lastPurchaseOrderId] NVARCHAR(36) NULL;
IF COL_LENGTH('products', 'lastPurchaseOrderNumber') IS NULL
    ALTER TABLE [dbo].[products] ADD [lastPurchaseOrderNumber] NVARCHAR(60) NULL;

IF COL_LENGTH('product_variants', 'lastPurchaseCostRial') IS NULL
    ALTER TABLE [dbo].[product_variants] ADD [lastPurchaseCostRial] DECIMAL(19,2) NULL;
IF COL_LENGTH('product_variants', 'lastPurchaseQuantity') IS NULL
    ALTER TABLE [dbo].[product_variants] ADD [lastPurchaseQuantity] DECIMAL(18,3) NULL;
IF COL_LENGTH('product_variants', 'lastPurchaseDate') IS NULL
    ALTER TABLE [dbo].[product_variants] ADD [lastPurchaseDate] DATE NULL;
IF COL_LENGTH('product_variants', 'lastPurchaseDateJalali') IS NULL
    ALTER TABLE [dbo].[product_variants] ADD [lastPurchaseDateJalali] NVARCHAR(10) NULL;
IF COL_LENGTH('product_variants', 'lastPurchaseOrderId') IS NULL
    ALTER TABLE [dbo].[product_variants] ADD [lastPurchaseOrderId] NVARCHAR(36) NULL;
IF COL_LENGTH('product_variants', 'lastPurchaseOrderNumber') IS NULL
    ALTER TABLE [dbo].[product_variants] ADD [lastPurchaseOrderNumber] NVARCHAR(60) NULL;
