-- The price calculator's inputs as applied to one proforma line, in the
-- calculator's own currency. Nullable, no backfill: a line priced before this
-- reopens the calculator from its product's stored figures, as it always did.
IF COL_LENGTH('dbo.proforma_items', 'priceCalc') IS NULL
  ALTER TABLE [dbo].[proforma_items] ADD [priceCalc] NVARCHAR(MAX) NULL;
