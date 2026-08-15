-- The catalogue item a supplier-inquiry line is asking about.
--
-- Inquiry lines were free text only, so a price obtained for a specific SKU
-- became an order line with no product behind it: nothing tied the offer to the
-- thing that was quoted, and a configurable product's variant could not be
-- named at all.
--
-- Both columns are optional, and stay optional. An inquiry is often the first
-- time a part is mentioned — it gets priced before anyone decides to carry it —
-- so a line naming no product is normal and not an omission.
--
-- NoAction on both, matching purchase-order lines: a product that has been
-- quoted must not be deletable out from under the record of what was quoted,
-- and cascade paths through products are already at SQL Server's limit.

IF COL_LENGTH('dbo.supplier_inquiry_items', 'productId') IS NULL
    ALTER TABLE [dbo].[supplier_inquiry_items] ADD [productId] NVARCHAR(36) NULL;

IF COL_LENGTH('dbo.supplier_inquiry_items', 'variantId') IS NULL
    ALTER TABLE [dbo].[supplier_inquiry_items] ADD [variantId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'supplier_inquiry_items_productId_idx')
    CREATE INDEX [supplier_inquiry_items_productId_idx]
        ON [dbo].[supplier_inquiry_items]([productId]);

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'supplier_inquiry_items_productId_fkey'
)
    ALTER TABLE [dbo].[supplier_inquiry_items]
        ADD CONSTRAINT [supplier_inquiry_items_productId_fkey]
        FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id])
        ON DELETE NO ACTION ON UPDATE NO ACTION;

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'supplier_inquiry_items_variantId_fkey'
)
    ALTER TABLE [dbo].[supplier_inquiry_items]
        ADD CONSTRAINT [supplier_inquiry_items_variantId_fkey]
        FOREIGN KEY ([variantId]) REFERENCES [dbo].[product_variants]([id])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
