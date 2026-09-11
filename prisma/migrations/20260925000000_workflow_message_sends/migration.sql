-- One automated message per rule per thing, when a rule asks for it.
--
-- Its own table rather than a row in `workflow_firings`, for two reasons that
-- are both about that table meaning something else. A scheduled rule already
-- writes `(ruleId, "project", projectId, occurrence)` there *before* its actions
-- run, so a message guard sharing the key would collide with the very firing
-- that is trying to send it. And `resolveFinishedTasks` deletes firings with
-- `where: { ruleId, entityId }` — no entityType — so closing a task would wipe
-- a message guard that happened to share an id.
--
-- The scope is stored beside the id because «once per project» and «once per
-- customer» are different questions about the same rule, and a rule may be
-- changed from one to the other: the old rows then simply stop matching rather
-- than silently answering the new question.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'workflow_message_sends')
BEGIN
  CREATE TABLE [dbo].[workflow_message_sends] (
    [id]      NVARCHAR(36)  NOT NULL,
    [ruleId]  NVARCHAR(60)  NOT NULL,
    [scope]   NVARCHAR(20)  NOT NULL,
    [scopeId] NVARCHAR(60)  NOT NULL,
    [sentAt]  DATETIME2     NOT NULL CONSTRAINT [DF_workflow_message_sends_sentAt] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_workflow_message_sends] PRIMARY KEY CLUSTERED ([id])
  );
END

-- The unique key is the whole mechanism: the insert is what decides, so two
-- overlapping sweeps or two events in the same second cannot both get past it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_workflow_message_sends_rule_scope')
BEGIN
  CREATE UNIQUE INDEX [UQ_workflow_message_sends_rule_scope]
    ON [dbo].[workflow_message_sends]([ruleId], [scope], [scopeId]);
END
