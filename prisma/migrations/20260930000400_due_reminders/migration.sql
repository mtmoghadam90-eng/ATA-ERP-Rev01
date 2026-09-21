-- «مهلت گذشت و هنوز انجام نشده»: a deadline on a referral, and the columns that
-- make a reminder fire once per deadline rather than every morning.
--
-- Nothing is backfilled, and that is the answer rather than a shortcut. NULL
-- means «this deadline has never been spoken about», which is every row already
-- on disk; `OVERDUE_WINDOW_DAYS` is what stops the first pass emptying years of
-- missed deadlines into somebody's inbox, and stamping every existing row as
-- already-notified would silence exactly the work that is late today.
--
-- `dueDateByAssignee` carries its own default, so no DML reads a column this
-- batch adds — which SQL Server refuses at compile time however it is guarded.

IF COL_LENGTH(N'[dbo].[project_referrals]', N'dueDate') IS NULL
BEGIN
  ALTER TABLE [dbo].[project_referrals] ADD [dueDate] DATE NULL;
END;

IF COL_LENGTH(N'[dbo].[project_referrals]', N'dueDateJalali') IS NULL
BEGIN
  ALTER TABLE [dbo].[project_referrals] ADD [dueDateJalali] NVARCHAR(10) NULL;
END;

IF COL_LENGTH(N'[dbo].[project_referrals]', N'dueDateByAssignee') IS NULL
BEGIN
  ALTER TABLE [dbo].[project_referrals] ADD [dueDateByAssignee] BIT NOT NULL
    CONSTRAINT [project_referrals_dueDateByAssignee_df] DEFAULT 0;
END;

IF COL_LENGTH(N'[dbo].[project_referrals]', N'dueSoonNoticeFor') IS NULL
BEGIN
  ALTER TABLE [dbo].[project_referrals] ADD [dueSoonNoticeFor] NVARCHAR(10) NULL;
END;

IF COL_LENGTH(N'[dbo].[project_referrals]', N'dueOverdueNoticeFor') IS NULL
BEGIN
  ALTER TABLE [dbo].[project_referrals] ADD [dueOverdueNoticeFor] NVARCHAR(10) NULL;
END;

IF COL_LENGTH(N'[dbo].[project_referrals]', N'dueAskedNoticeOn') IS NULL
BEGIN
  ALTER TABLE [dbo].[project_referrals] ADD [dueAskedNoticeOn] NVARCHAR(10) NULL;
END;

IF COL_LENGTH(N'[dbo].[tasks]', N'dueDateByAssignee') IS NULL
BEGIN
  ALTER TABLE [dbo].[tasks] ADD [dueDateByAssignee] BIT NOT NULL
    CONSTRAINT [tasks_dueDateByAssignee_df] DEFAULT 0;
END;

IF COL_LENGTH(N'[dbo].[tasks]', N'dueSoonNoticeFor') IS NULL
BEGIN
  ALTER TABLE [dbo].[tasks] ADD [dueSoonNoticeFor] NVARCHAR(10) NULL;
END;

IF COL_LENGTH(N'[dbo].[tasks]', N'dueOverdueNoticeFor') IS NULL
BEGIN
  ALTER TABLE [dbo].[tasks] ADD [dueOverdueNoticeFor] NVARCHAR(10) NULL;
END;

IF COL_LENGTH(N'[dbo].[tasks]', N'dueAskedNoticeOn') IS NULL
BEGIN
  ALTER TABLE [dbo].[tasks] ADD [dueAskedNoticeOn] NVARCHAR(10) NULL;
END;

-- The pass narrows on the deadline, so both tables are read by it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'project_referrals_dueDate_idx')
BEGIN
  CREATE INDEX [project_referrals_dueDate_idx] ON [dbo].[project_referrals]([dueDate]);
END;
