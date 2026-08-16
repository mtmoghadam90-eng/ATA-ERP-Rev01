-- Time-based workflow rules: which rule has already fired for which record.
--
-- The sweep runs daily and a record stays past its due day for ever, so
-- without this a follow-up task would be raised again every morning. The
-- unique index is what actually enforces "once", not the code that reads it.
IF OBJECT_ID(N'[workflow_firings]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[workflow_firings] (
        [id]         NVARCHAR(36)  NOT NULL,
        [ruleId]     NVARCHAR(64)  NOT NULL,
        [entityType] NVARCHAR(40)  NOT NULL,
        [entityId]   NVARCHAR(36)  NOT NULL,
        [dueDay]     NVARCHAR(10)  NULL,
        [firedAt]    DATETIME2     NOT NULL CONSTRAINT [workflow_firings_firedAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [workflow_firings_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE UNIQUE INDEX [workflow_firings_rule_entity_uq] ON [dbo].[workflow_firings]([ruleId], [entityId]);
    CREATE INDEX [workflow_firings_entityType_entityId_idx] ON [dbo].[workflow_firings]([entityType], [entityId]);
END
