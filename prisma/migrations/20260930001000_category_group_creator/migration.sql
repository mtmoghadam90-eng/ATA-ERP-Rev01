-- Who opened a project's activity category, so only they (or a system
-- administrator) may delete it. Nullable and backfilled with nothing: nobody
-- recorded who opened the groups already on disk, and guessing from the first
-- message would hand the delete to whoever happened to write first. NULL is
-- read as «nobody's», which leaves the delete to a system administrator.
IF COL_LENGTH('project_category_groups', 'createdByUserId') IS NULL
  ALTER TABLE [project_category_groups] ADD [createdByUserId] NVARCHAR(36) NULL;
