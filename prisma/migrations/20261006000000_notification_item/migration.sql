-- The inbox item a notice announces (a referral reply's message id), so the
-- module notice and the reply item are read as one. Nullable, no backfill:
-- a notice written before this links to nothing and is read on its own.
IF COL_LENGTH('dbo.module_notifications', 'itemId') IS NULL
  ALTER TABLE [dbo].[module_notifications] ADD [itemId] NVARCHAR(36) NULL;
