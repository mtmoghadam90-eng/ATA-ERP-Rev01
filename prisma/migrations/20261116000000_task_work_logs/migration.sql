BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[task_work_logs] (
    [id] NVARCHAR(36) NOT NULL,
    [taskId] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL CONSTRAINT [task_work_logs_kind_df] DEFAULT 'PROGRESS',
    [text] NVARCHAR(max),
    [attachments] NVARCHAR(max),
    [authorUserId] NVARCHAR(36) NOT NULL,
    [authorName] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [task_work_logs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [task_work_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [task_work_logs_taskId_createdAt_idx] ON [dbo].[task_work_logs]([taskId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[task_work_logs] ADD CONSTRAINT [task_work_logs_taskId_fkey] FOREIGN KEY ([taskId]) REFERENCES [dbo].[tasks]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

