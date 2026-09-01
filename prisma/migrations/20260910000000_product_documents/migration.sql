-- The catalogue, the datasheet and the certificates of a product.
--
-- One nullable JSON column, guarded so the retry after a half-applied
-- migration is safe. No backfill: an existing product simply has no documents
-- yet, and `parseProductDocuments` reads NULL as an empty list.
IF COL_LENGTH('dbo.products', 'documents') IS NULL
  ALTER TABLE [dbo].[products] ADD [documents] NVARCHAR(MAX) NULL;
