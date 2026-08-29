-- The activity feed becomes a conversation.
--
-- Two changes, both in service of the same thing: staff record what happened on
-- a job in the same place they talk about it.
--
--  * `replyToId` — a message can answer another one. NoAction on purpose:
--    deleting a message must not silently take every answer to it with it, and
--    the cascade paths into this table are already at SQL Server's limit
--    through the category group.
--
--  * `project_referrals.activityId` loses its UNIQUE constraint. A referral
--    used to be a checkbox on the activity form addressed to exactly one
--    colleague; naming people in the message *is* the referral now, and
--    «@علی @رضا لطفاً بررسی کنید» is a request to two people — which the unique
--    index forbade outright. A plain index takes its place, because the read is
--    still "the referrals of this activity".
--
-- Existing rows are untouched: one referral per activity is still perfectly
-- valid under the looser constraint.
--
-- No `GO` anywhere. It is a **sqlcmd batch separator, not T-SQL**, and Prisma
-- hands each statement to the driver on its own — so a `GO` between them is
-- read as an identifier and the whole migration dies with «Incorrect syntax
-- near 'GO'», which is what happened on the first attempt at this file. Every
-- other migration here separates statements with a blank line, and
-- `20260901000000_sales_follow_up` proves the exact shape below works: a column
-- added, then indexed, then given a self-referencing foreign key.
--
-- Guarded throughout, so it is safe to run against a database where part of it
-- already landed.

IF COL_LENGTH('dbo.project_activities', 'replyToId') IS NULL
    ALTER TABLE [dbo].[project_activities] ADD [replyToId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'project_activities_replyToId_idx')
    CREATE NONCLUSTERED INDEX [project_activities_replyToId_idx]
        ON [dbo].[project_activities]([replyToId]);

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'project_activities_replyToId_fkey'
)
    ALTER TABLE [dbo].[project_activities]
        ADD CONSTRAINT [project_activities_replyToId_fkey]
        FOREIGN KEY ([replyToId]) REFERENCES [dbo].[project_activities]([id])
        ON DELETE NO ACTION ON UPDATE NO ACTION;

IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'project_referrals_activityId_key'
      AND parent_object_id = OBJECT_ID('dbo.project_referrals')
)
    ALTER TABLE [dbo].[project_referrals]
        DROP CONSTRAINT [project_referrals_activityId_key];

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'project_referrals_activityId_idx')
    CREATE NONCLUSTERED INDEX [project_referrals_activityId_idx]
        ON [dbo].[project_referrals]([activityId]);
