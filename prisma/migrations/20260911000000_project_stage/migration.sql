-- «مرحله‌ی جاری پروژه»: where the work has got to, beside the sales outcome.
--
-- Five nullable columns and no backfill. The existing rows are filled in by
-- `npm run fix:project-stages`, which walks them through the same pure function
-- the services use — deliberately not DML in this file, because SQL Server
-- compiles a whole batch before running any of it and a statement reading a
-- column this migration adds dies with «Invalid column name» however it is
-- guarded.
IF COL_LENGTH('dbo.projects', 'stage') IS NULL
  ALTER TABLE [dbo].[projects] ADD [stage] NVARCHAR(60) NULL;

IF COL_LENGTH('dbo.projects', 'stageChangedAt') IS NULL
  ALTER TABLE [dbo].[projects] ADD [stageChangedAt] DATETIME2 NULL;

IF COL_LENGTH('dbo.projects', 'stageChangedAtJalali') IS NULL
  ALTER TABLE [dbo].[projects] ADD [stageChangedAtJalali] NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.projects', 'manualStage') IS NULL
  ALTER TABLE [dbo].[projects] ADD [manualStage] NVARCHAR(60) NULL;

IF COL_LENGTH('dbo.projects', 'manualStageLocked') IS NULL
  ALTER TABLE [dbo].[projects] ADD [manualStageLocked] BIT NOT NULL CONSTRAINT [DF_projects_manualStageLocked] DEFAULT 0;

-- The grid filters and sorts on it, and a project list is read constantly.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_projects_stage' AND object_id = OBJECT_ID('dbo.projects'))
  CREATE INDEX [IX_projects_stage] ON [dbo].[projects] ([stage]);
