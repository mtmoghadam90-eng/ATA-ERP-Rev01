-- A supplier's offer is rarely one file.
--
-- A quotation arrives as a covering letter, a datasheet and a price list, and
-- `technicalOfferUrl` / `financialOfferUrl` could hold one of each — so the
-- rest went in as a second inquiry, or nowhere.
--
-- Stored the way a project activity's attachments are: the list is JSON in a
-- new column and the original single-URL columns keep the **first** entry, so
-- the grid's link, the download button and the Power BI export go on reading
-- what they always read. Nothing is migrated, because a row with one file is
-- already correct under the new reading.
--
-- Guarded, so it is safe on a database that already has the columns.

IF COL_LENGTH('dbo.supplier_inquiries', 'technicalOfferFiles') IS NULL
  ALTER TABLE [dbo].[supplier_inquiries] ADD [technicalOfferFiles] NVARCHAR(MAX) NULL;

IF COL_LENGTH('dbo.supplier_inquiries', 'financialOfferFiles') IS NULL
  ALTER TABLE [dbo].[supplier_inquiries] ADD [financialOfferFiles] NVARCHAR(MAX) NULL;
