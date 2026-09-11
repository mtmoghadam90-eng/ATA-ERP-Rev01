-- «۳ روز بعد از ثبت باخت یک پروژه، برای مشتری پیام برود» — the clock that rule
-- counts from.
--
-- The engine could already say «N days after a date the record carries», and a
-- project carried every date but this one. `creationDateJalali` answers «how
-- long since the job was opened», which is worse the longer the job runs;
-- `stageChangedAtJalali` answers «since when has the *work* been here», and the
-- stage deliberately does not move when the sale is won or lost — that is the
-- whole reason «وضعیت» and «مرحله» are two columns. `winningDateJalali` stamps
-- won and only won. So «since the loss was recorded» was not expressible at
-- all, and the rule could not be written.
--
-- These two columns are the same answer 20260917000000_status_dwell gave the
-- purchase order and the after-sales job, and they are written by the same
-- single rule (`statusChangeColumns`): only on a real move, so the date means
-- «since when» rather than «last saved».
--
-- **No backfill, exactly as in 20260917000000.** NULL means «this application
-- has never seen this project's status move», and `dueDay` already reads a
-- missing base date as «unscheduled, not overdue». Stamping every existing row
-- with today would claim every project changed status this morning and go quiet
-- for exactly as long as each rule's threshold. A project starts counting from
-- its next real move, which is the only honest thing the data can say.
--
-- Guarded so a retry is safe, DDL only, and the index is plain — a filtered one
-- would have to be deferred through EXEC (see 20260916000000).

IF COL_LENGTH('dbo.projects', 'statusChangedAt') IS NULL
  ALTER TABLE [dbo].[projects] ADD [statusChangedAt] DATETIME2 NULL;

IF COL_LENGTH('dbo.projects', 'statusChangedAtJalali') IS NULL
  ALTER TABLE [dbo].[projects] ADD [statusChangedAtJalali] NVARCHAR(10) NULL;

-- The daily sweep filters on the Jalali column across a date band, once per
-- scheduled rule.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'projects_statusChangedAtJalali_idx' AND object_id = OBJECT_ID('dbo.projects'))
CREATE INDEX [projects_statusChangedAtJalali_idx] ON [dbo].[projects]([statusChangedAtJalali]);
