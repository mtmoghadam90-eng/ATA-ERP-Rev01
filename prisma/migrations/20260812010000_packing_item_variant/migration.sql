-- The SKU a packing line ships.
--
-- A packing list records what left the building, and for a product with
-- variants "which one" is the whole question — the stock ledger cannot issue
-- the right SKU without it.
--
-- Not a foreign key on purpose: a packing list is a historical document, and
-- retiring a SKU must not make one unreadable or block the deletion.

IF COL_LENGTH('dbo.packing_items', 'variantId') IS NULL
    ALTER TABLE [dbo].[packing_items] ADD [variantId] NVARCHAR(36) NULL;
