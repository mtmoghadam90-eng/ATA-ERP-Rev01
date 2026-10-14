-- A supplier's files, each with a line saying what it is:
-- [{name,size,url,description}]. Nullable, no backfill: NULL is "no files".
IF COL_LENGTH('dbo.suppliers', 'documents') IS NULL
  ALTER TABLE [dbo].[suppliers] ADD [documents] NVARCHAR(MAX) NULL;
