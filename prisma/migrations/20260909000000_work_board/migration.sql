-- The merged work board: «کارتابل ارجاعات» folded into «وظایف و پیگیری».
--
-- The two screens asked the same question — what has been given to me to do —
-- so a person had to look in two places and remember which kind of thing they
-- were looking for. They are one board with three columns now.
--
-- A referral is NOT copied into `tasks`. It stays a `project_referrals` row
-- with its own conversation thread, and a pure rule
-- (`src/utils/workBoard.ts`) maps each record's own status onto a column.
-- Materialising a referral as a task row would mean two status columns to keep
-- in step, which is the fault this schema keeps having to repair.
--
-- What this adds:
--
--  * `tasks.startedAt` — when the work was picked up. `completedAt` already
--    existed but only the sales follow-up flow wrote it; the generic path
--    stamps both now.
--  * `project_referrals.startedAt` / `completedAt` — the same two facts, which
--    a referral had no way to record at all.
--
-- What it deliberately does NOT do: rewrite any existing status. Every task on
-- disk carries «در حال انجام», which is what it has always meant, and lands in
-- the middle column; «برای انجام» is a new value the service writes for tasks
-- created from here on. Rewriting them would also change how any workflow rule
-- keyed on that status fires.
--
-- No `GO`: it is sqlcmd's batch separator and Prisma hands each statement to
-- the driver on its own. Statements are separated by a blank line. Every
-- statement here is DDL, which SQL Server compiles when it executes rather than
-- when the batch is parsed — so no `EXEC(N'...')` wrapper is needed.

IF COL_LENGTH('dbo.tasks', 'startedAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [startedAt] DATE NULL;

IF COL_LENGTH('dbo.tasks', 'startedAtJalali') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [startedAtJalali] NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.project_referrals', 'startedAt') IS NULL
    ALTER TABLE [dbo].[project_referrals] ADD [startedAt] DATETIME2 NULL;

IF COL_LENGTH('dbo.project_referrals', 'completedAt') IS NULL
    ALTER TABLE [dbo].[project_referrals] ADD [completedAt] DATETIME2 NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'tasks_status_dueDate_idx')
    CREATE NONCLUSTERED INDEX [tasks_status_dueDate_idx]
        ON [dbo].[tasks]([status], [dueDate]);
