-- A packing line's technical specification, printed under the item on the
-- packing list. Seeded from the won proforma line it ships and editable per
-- packing list. Nullable and not backfilled: NULL prints nothing, which is
-- what every packing list written before this printed.

IF COL_LENGTH(N'[dbo].[packing_items]', N'techSpecs') IS NULL
BEGIN
    ALTER TABLE [dbo].[packing_items] ADD [techSpecs] NVARCHAR(MAX) NULL;
END
