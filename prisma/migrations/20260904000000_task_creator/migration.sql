-- Who raised a task.
--
-- The board used to show every task to every user who could open the module:
-- `visibilityClause` returned "no restriction" for anybody holding the `tasks`
-- permission, and an absent permission key reads as granted — so in practice
-- everyone saw everyone's work.
--
-- Scoping it to the assignee alone would have been worse than the fault: a task
-- you raised for a colleague has no column naming you, so it would vanish from
-- your own board with nothing to find it by. This is that column. A task is
-- visible to the person it was given to and to the person who gave it.
--
-- Null on every existing row, and on the ones the automation raises with nobody
-- acting — which is why the clause that reads it is an OR and not a join.
--
-- No `GO`: it is sqlcmd's batch separator and Prisma hands each statement to
-- the driver on its own. Statements are separated by a blank line.

IF COL_LENGTH('dbo.tasks', 'createdByUserId') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [createdByUserId] NVARCHAR(36) NULL;

IF COL_LENGTH('dbo.tasks', 'createdByName') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [createdByName] NVARCHAR(200) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'tasks_createdByUserId_status_idx')
    CREATE NONCLUSTERED INDEX [tasks_createdByUserId_status_idx]
        ON [dbo].[tasks]([createdByUserId], [status]);
