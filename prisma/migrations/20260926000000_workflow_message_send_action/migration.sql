-- Which message action the «فقط یک بار» claim belongs to.
--
-- A workflow rule may carry several `send_message` actions and each exposes its
-- own «فقط یک بار» switch — an SMS and an email about the same event, say. The
-- key was (ruleId, scope, scopeId), so when two of them chose the same scope the
-- first action's claim made the second receive P2002 and one configured message
-- was **silently never sent**, from the one control written to prevent
-- duplicates. Reported by code review on #175.
--
-- DEFAULT '' is what makes this safe on a live database, exactly as DEFAULT 1
-- was for `workflow_firings.occurrence`: every row already here was written by
-- the only claim its rule made, which is what the empty action means. No DML, so
-- nothing in this batch reads a column the batch adds.
--
-- Guarded at each step, because a migration that fails half way leaves what ran
-- before it applied and the retry has to be safe.

IF COL_LENGTH('dbo.workflow_message_sends', 'actionId') IS NULL
    ALTER TABLE [dbo].[workflow_message_sends]
        ADD [actionId] NVARCHAR(60) NOT NULL CONSTRAINT [workflow_message_sends_actionId_df] DEFAULT '';

-- The narrower key has to go before the wider one can exist: both standing, the
-- old one would go on refusing exactly the second action this migration allows.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_workflow_message_sends_rule_scope' AND object_id = OBJECT_ID('dbo.workflow_message_sends'))
    DROP INDEX [UQ_workflow_message_sends_rule_scope] ON [dbo].[workflow_message_sends];

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_workflow_message_sends_rule_action_scope' AND object_id = OBJECT_ID('dbo.workflow_message_sends'))
    CREATE UNIQUE INDEX [UQ_workflow_message_sends_rule_action_scope] ON [dbo].[workflow_message_sends]([ruleId], [actionId], [scope], [scopeId]);
