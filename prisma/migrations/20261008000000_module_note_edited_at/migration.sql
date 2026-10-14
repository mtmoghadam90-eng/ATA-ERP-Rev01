-- When a note was last corrected by its author. Nullable, no backfill: NULL
-- means "never edited", which is every note written before this column.
IF COL_LENGTH('dbo.module_notes', 'editedAt') IS NULL
  ALTER TABLE [dbo].[module_notes] ADD [editedAt] DATETIME2 NULL;
