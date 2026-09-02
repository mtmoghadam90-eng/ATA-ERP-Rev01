-- Per-user work-in-progress limits.
--
-- Two nullable columns and nothing else: null means «no limit», which is what
-- every existing account gets, so nobody's board changes until somebody types
-- a number into the users screen. No backfill, and therefore no DML reading a
-- column this batch adds — the trap that stopped a deployment before.

IF COL_LENGTH('dbo.users', 'minActiveTasks') IS NULL
    ALTER TABLE [dbo].[users] ADD [minActiveTasks] INT NULL;

IF COL_LENGTH('dbo.users', 'maxActiveTasks') IS NULL
    ALTER TABLE [dbo].[users] ADD [maxActiveTasks] INT NULL;
