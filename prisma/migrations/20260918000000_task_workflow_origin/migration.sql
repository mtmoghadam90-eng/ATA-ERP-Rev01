-- Which rule raised this task, and what about.
--
-- The engine could raise a task and never close it: nothing recorded where the
-- task came from, so when the record moved on there was no way to find the
-- reminder it had left behind. A board filling with dead reminders is a board
-- people stop reading, which is how a working automation ends up worse than
-- none.
--
-- `messages` has carried exactly this shape since it was written —
-- `workflowRuleId`, `workflowRuleName`, `entityType`, `entityId` — and these
-- four are the same four under names that cannot be mistaken for the task's own
-- `relatedToType`/`relatedToId`. Those are a different thing: they say what the
-- task is *about* for the person reading it, which for a purchase-order rule is
-- usually the **project**, not the order the rule fired on.
--
-- The type is stored beside the id rather than derived from the rule's schedule
-- at closing time, so a rule whose subject is later changed cannot make the
-- resolver read the wrong table for tasks already raised.
--
-- Nullable with no backfill: every task written before this — and every task a
-- person raises — has no rule behind it, which is exactly what NULL says. The
-- resolver only ever looks at rows that name a rule.
--
-- Guarded, DDL only, plain index (a filtered one would have to be deferred
-- through EXEC — see 20260916000000).

IF COL_LENGTH('dbo.tasks', 'workflowRuleId') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [workflowRuleId] NVARCHAR(64) NULL;

IF COL_LENGTH('dbo.tasks', 'workflowRuleName') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [workflowRuleName] NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.tasks', 'workflowEntityType') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [workflowEntityType] NVARCHAR(40) NULL;

IF COL_LENGTH('dbo.tasks', 'workflowEntityId') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [workflowEntityId] NVARCHAR(36) NULL;

-- The resolver's own query: the open tasks one rule has left behind.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'tasks_workflowRuleId_idx' AND object_id = OBJECT_ID('dbo.tasks'))
CREATE INDEX [tasks_workflowRuleId_idx] ON [dbo].[tasks]([workflowRuleId]);
