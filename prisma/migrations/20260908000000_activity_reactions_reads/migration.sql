-- Reactions and read receipts on an activity message.
--
-- The feed is a messenger, and the cheapest possible answer — «دیدم»,
-- «موافقم», «ممنون» — should not cost a message of its own: a job's history is
-- read top to bottom and a column of one-word replies buries the work in it.
--
-- Both are one row per person rather than a JSON column on the message. Two
-- people reacting at the same moment would otherwise be a read-modify-write
-- race, and the unique indexes here are what make "press it again to undo" and
-- "mark it read again" things the database settles rather than the application.
--
-- `userId` is a plain column, not a foreign key — the same shape as
-- `tasks.createdByUserId`. A reaction must never be the thing that stops an
-- account being deleted, and `userName` beside it keeps the history readable
-- when one is.
--
-- Cascade from the message is safe: this is a single path
-- (projects -> category groups -> activities -> here), the same depth
-- `project_referrals` has used since it was written. The self-relation on
-- `project_activities` is NoAction precisely because it was a *second* path.
--
-- No `GO`: it is sqlcmd's batch separator and Prisma hands each statement to
-- the driver on its own. Statements are separated by a blank line. There is no
-- backfill here, so nothing needs `EXEC(N'...')` — every statement is DDL,
-- which SQL Server compiles when it runs rather than when the batch is parsed.

IF OBJECT_ID('dbo.activity_reactions', 'U') IS NULL
    CREATE TABLE [dbo].[activity_reactions] (
        [id]         NVARCHAR(36)  NOT NULL,
        [activityId] NVARCHAR(36)  NOT NULL,
        [userId]     NVARCHAR(36)  NOT NULL,
        [userName]   NVARCHAR(200) NULL,
        [emoji]      NVARCHAR(16)  NOT NULL,
        [createdAt]  DATETIME2     NOT NULL CONSTRAINT [activity_reactions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [activity_reactions_pkey] PRIMARY KEY CLUSTERED ([id])
    );

IF OBJECT_ID('dbo.activity_reads', 'U') IS NULL
    CREATE TABLE [dbo].[activity_reads] (
        [id]         NVARCHAR(36)  NOT NULL,
        [activityId] NVARCHAR(36)  NOT NULL,
        [userId]     NVARCHAR(36)  NOT NULL,
        [userName]   NVARCHAR(200) NULL,
        [readAt]     DATETIME2     NOT NULL CONSTRAINT [activity_reads_readAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [activity_reads_pkey] PRIMARY KEY CLUSTERED ([id])
    );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'activity_reactions_activityId_userId_emoji_key')
    CREATE UNIQUE NONCLUSTERED INDEX [activity_reactions_activityId_userId_emoji_key]
        ON [dbo].[activity_reactions]([activityId], [userId], [emoji]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'activity_reactions_activityId_idx')
    CREATE NONCLUSTERED INDEX [activity_reactions_activityId_idx]
        ON [dbo].[activity_reactions]([activityId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'activity_reads_activityId_userId_key')
    CREATE UNIQUE NONCLUSTERED INDEX [activity_reads_activityId_userId_key]
        ON [dbo].[activity_reads]([activityId], [userId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'activity_reads_activityId_idx')
    CREATE NONCLUSTERED INDEX [activity_reads_activityId_idx]
        ON [dbo].[activity_reads]([activityId]);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'activity_reactions_activityId_fkey')
    ALTER TABLE [dbo].[activity_reactions] ADD CONSTRAINT [activity_reactions_activityId_fkey]
        FOREIGN KEY ([activityId]) REFERENCES [dbo].[project_activities]([id])
        ON DELETE CASCADE ON UPDATE CASCADE;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'activity_reads_activityId_fkey')
    ALTER TABLE [dbo].[activity_reads] ADD CONSTRAINT [activity_reads_activityId_fkey]
        FOREIGN KEY ([activityId]) REFERENCES [dbo].[project_activities]([id])
        ON DELETE CASCADE ON UPDATE CASCADE;
