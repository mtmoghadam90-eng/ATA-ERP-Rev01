-- The feed message a notice is about, so clicking the notice can open that
-- message rather than the project's feed with everything folded. Nullable, no
-- backfill: NULL means "a notice written before this", which still leads to
-- its project (and a reply notice is resolved through itemId instead).
IF COL_LENGTH('dbo.module_notifications', 'activityId') IS NULL
  ALTER TABLE [dbo].[module_notifications] ADD [activityId] NVARCHAR(36) NULL;
