-- Writes the assistant has prepared and nobody has approved yet.
--
-- The payload lives on the server between the proposal and the confirmation.
-- Handing it to the browser and taking it back would mean the record written is
-- whatever the client last held, not what the person read and approved.
--
-- Rows are short-lived by design (see PROPOSAL_TTL_MINUTES) but are kept after
-- they resolve: what the assistant was asked to do, and what came of it, is
-- part of the record.
IF OBJECT_ID('dbo.assistant_actions', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[assistant_actions] (
    [id]          NVARCHAR(36)  NOT NULL CONSTRAINT [PK_assistant_actions] PRIMARY KEY,
    [action]      NVARCHAR(60)  NOT NULL,
    [userId]      NVARCHAR(36)  NOT NULL,
    [status]      NVARCHAR(20)  NOT NULL,
    [title]       NVARCHAR(400) NOT NULL,
    [summary]     NVARCHAR(MAX) NULL,
    [payload]     NVARCHAR(MAX) NULL,
    [arguments]   NVARCHAR(MAX) NULL,
    [resultId]    NVARCHAR(36)  NULL,
    [resultLabel] NVARCHAR(400) NULL,
    [error]       NVARCHAR(MAX) NULL,
    [createdAt]   DATETIME2     NOT NULL CONSTRAINT [DF_assistant_actions_createdAt] DEFAULT CURRENT_TIMESTAMP,
    [resolvedAt]  DATETIME2     NULL
  );

  CREATE INDEX [IX_assistant_actions_user_status] ON [dbo].[assistant_actions] ([userId], [status]);
  CREATE INDEX [IX_assistant_actions_createdAt]   ON [dbo].[assistant_actions] ([createdAt]);
END
