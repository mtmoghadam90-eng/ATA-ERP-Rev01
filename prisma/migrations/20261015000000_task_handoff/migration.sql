-- «ارسال به همکار» from the completion of a task (src/utils/taskHandoff.ts).
-- tasks.attachments: the files a task was handed over with.
-- tasks.completionAttachments: the files attached to «شرح اقدام» on the tick.
-- tasks.handoffs: what this task's completion handed on (a task, a referral or
--   a notice), so a meeting's action row can show its whole trail.
-- tasks.previousTaskId: the task this one continues («در ادامهٔ وظیفهٔ …»).
--   No foreign key: a self-relation on tasks would be a second cascade path.
-- tasks.sourceActivityId: the feed message a task was raised from, so its
--   handoff lands in that message's own category.
-- module_notifications.attachments: the files a «فقط اطلاع» carries.
-- All nullable, nothing backfilled.

IF COL_LENGTH(N'[dbo].[tasks]', N'attachments') IS NULL
BEGIN
    ALTER TABLE [dbo].[tasks] ADD [attachments] NVARCHAR(MAX) NULL;
END

IF COL_LENGTH(N'[dbo].[tasks]', N'completionAttachments') IS NULL
BEGIN
    ALTER TABLE [dbo].[tasks] ADD [completionAttachments] NVARCHAR(MAX) NULL;
END

IF COL_LENGTH(N'[dbo].[tasks]', N'handoffs') IS NULL
BEGIN
    ALTER TABLE [dbo].[tasks] ADD [handoffs] NVARCHAR(MAX) NULL;
END

IF COL_LENGTH(N'[dbo].[tasks]', N'previousTaskId') IS NULL
BEGIN
    ALTER TABLE [dbo].[tasks] ADD [previousTaskId] NVARCHAR(36) NULL;
END

IF COL_LENGTH(N'[dbo].[tasks]', N'sourceActivityId') IS NULL
BEGIN
    ALTER TABLE [dbo].[tasks] ADD [sourceActivityId] NVARCHAR(36) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'tasks_previousTaskId_idx' AND object_id = OBJECT_ID(N'[dbo].[tasks]'))
BEGIN
    CREATE NONCLUSTERED INDEX [tasks_previousTaskId_idx] ON [dbo].[tasks]([previousTaskId]);
END

IF COL_LENGTH(N'[dbo].[module_notifications]', N'attachments') IS NULL
BEGIN
    ALTER TABLE [dbo].[module_notifications] ADD [attachments] NVARCHAR(MAX) NULL;
END
