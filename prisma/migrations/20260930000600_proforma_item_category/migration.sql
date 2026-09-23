-- The warehouse category a free-text proforma line belongs to.
--
-- A catalogue line counts under its product's category; a line typed by hand
-- has no product, so every one of them fell into «سایر تجهیزات» on the
-- dashboard's category figures. This is chosen on the form for a manual line
-- and left NULL for a catalogue one, whose category stays the product's.
--
-- Nullable and **no backfill**: NULL is «nobody has said», which reports as
-- «سایر تجهیزات» exactly as every such line did before. Nothing here reads a
-- column this batch adds.

IF COL_LENGTH(N'[dbo].[proforma_items]', N'category') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [category] NVARCHAR(150) NULL;
END
