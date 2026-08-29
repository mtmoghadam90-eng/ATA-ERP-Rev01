-- Sales follow-up on quotations, and explicit proforma revisions.
--
-- Two separate ideas that arrive together because the second is what stops the
-- first from guessing:
--
--  * A quotation that has gone out needs somebody chasing it, and the state of
--    that chase is not the state of the sale. `followUpState` says whether
--    anyone is still on it (OPEN), whether the customer asked to be left until
--    a date (DEFERRED), or whether the chase was given up (NO_RESPONSE). Won,
--    lost and cancelled stay where they already are — derived from the line
--    statuses and `isCancelled` — because two columns spelling the same fact is
--    how they come to disagree.
--
--  * A project may legitimately carry several open quotations at once (the
--    temperature instruments, the pressure instruments, the flow meters), so a
--    revision can never be inferred from two documents sharing a project.
--    `previousVersionId` is a relation a person creates or it does not exist.
--
-- The task side gains `taskKind`, which is what lets the follow-up machinery act
-- on follow-ups and leave every ordinary task alone.
--
-- Backward compatible by construction: every column is nullable or has a
-- default, and no historical status, loss reason or outcome is touched. No
-- follow-up tasks are created here — task creation belongs to the workflow
-- engine, which is the whole point of doing it that way.

IF COL_LENGTH('dbo.proformas', 'followUpState') IS NULL
    ALTER TABLE [dbo].[proformas] ADD [followUpState] NVARCHAR(20) NOT NULL CONSTRAINT [proformas_followUpState_df] DEFAULT 'OPEN';

IF COL_LENGTH('dbo.proformas', 'deferredUntil') IS NULL
    ALTER TABLE [dbo].[proformas] ADD [deferredUntil] DATE NULL;

IF COL_LENGTH('dbo.proformas', 'deferredUntilJalali') IS NULL
    ALTER TABLE [dbo].[proformas] ADD [deferredUntilJalali] NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.proformas', 'previousVersionId') IS NULL
    ALTER TABLE [dbo].[proformas] ADD [previousVersionId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'proformas_followUpState_idx')
    CREATE INDEX [proformas_followUpState_idx] ON [dbo].[proformas]([followUpState]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'proformas_previousVersionId_idx')
    CREATE INDEX [proformas_previousVersionId_idx] ON [dbo].[proformas]([previousVersionId]);

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'proformas_previousVersionId_fkey'
)
    ALTER TABLE [dbo].[proformas]
        ADD CONSTRAINT [proformas_previousVersionId_fkey]
        FOREIGN KEY ([previousVersionId]) REFERENCES [dbo].[proformas]([id])
        ON DELETE NO ACTION ON UPDATE NO ACTION;

IF COL_LENGTH('dbo.tasks', 'taskKind') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [taskKind] NVARCHAR(30) NOT NULL CONSTRAINT [tasks_taskKind_df] DEFAULT 'GENERAL';

IF COL_LENGTH('dbo.tasks', 'followUpResult') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [followUpResult] NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.tasks', 'completionNote') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [completionNote] NVARCHAR(MAX) NULL;

IF COL_LENGTH('dbo.tasks', 'completedAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [completedAt] DATE NULL;

IF COL_LENGTH('dbo.tasks', 'completedAtJalali') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [completedAtJalali] NVARCHAR(10) NULL;

-- The duplicate check on every automatic follow-up creation, and the queue's
-- own join: "is there an unfinished SALES_FOLLOW_UP task on this proforma".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'tasks_taskKind_relatedToType_relatedToId_status_idx')
    CREATE INDEX [tasks_taskKind_relatedToType_relatedToId_status_idx]
        ON [dbo].[tasks]([taskKind], [relatedToType], [relatedToId], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'tasks_taskKind_status_dueDate_idx')
    CREATE INDEX [tasks_taskKind_status_dueDate_idx]
        ON [dbo].[tasks]([taskKind], [status], [dueDate]);
