-- Whether a project activity was written by the application rather than typed.
--
-- The author of a system entry is whoever pressed the button that caused it
-- (issuing a proforma, receiving an order), so `authorUserId` cannot tell a
-- note somebody wrote from a sentence the system wrote on their behalf — and
-- the two are edited by different people: a note by its author only, a system
-- entry by a system administrator only.
IF COL_LENGTH('project_activities', 'isSystem') IS NULL
  ALTER TABLE [project_activities] ADD [isSystem] BIT NOT NULL
    CONSTRAINT [DF_project_activities_isSystem] DEFAULT 0;

-- Every entry the system writes about a record carries that record's link;
-- nothing a person types does. The deletion sentences carry no link and
-- cannot be told apart from a note after the fact, so they are left as
-- ordinary entries. Deferred through EXEC because SQL Server binds column
-- names when it compiles the batch, before the ALTER above has run.
EXEC(N'UPDATE [project_activities] SET [isSystem] = 1 WHERE [sourceType] IS NOT NULL AND [isSystem] = 0');
