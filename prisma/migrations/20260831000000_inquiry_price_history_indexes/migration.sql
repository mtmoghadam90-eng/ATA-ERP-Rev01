-- Indexes for the supplier-inquiry price history.
--
-- The prices themselves were already on disk: `supplier_inquiry_items` has
-- carried `productId` and `variantId` since 20260815010000. What is new is the
-- question — "what did the last 6-inch turbine flow meter cost me" — which
-- reads the lines directly rather than through their inquiries, filtered by SKU
-- and ordered by the offer's date.
--
-- Two supporting indexes, no new columns:
--
--  * `variantId` on the lines. `productId` was indexed when the columns were
--    added and this one was not, but the SKU is the more specific question and
--    the one the screen's picker asks.
--  * `creationDate` on the inquiries, which is what every page of the history
--    is ordered by. Without it, ordering the lines by their parent's date is a
--    scan of the whole offer table for each page.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'supplier_inquiry_items_variantId_idx')
    CREATE INDEX [supplier_inquiry_items_variantId_idx]
        ON [dbo].[supplier_inquiry_items]([variantId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'supplier_inquiries_creationDate_idx')
    CREATE INDEX [supplier_inquiries_creationDate_idx]
        ON [dbo].[supplier_inquiries]([creationDate]);
