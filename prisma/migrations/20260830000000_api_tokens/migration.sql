-- Credentials for third-party integrations (n8n and the like).
--
-- A token authenticates as one of the existing users and carries that user's
-- permissions; there is no second permission model to keep in step with the
-- first. The `scope` column narrows it further to read-only, because most
-- integrations only ever read and a credential living in somebody else's
-- automation platform should be able to do only what that automation needs.
--
-- The token is stored as a SHA-256, not a bcrypt hash: bcrypt's cost exists to
-- slow dictionary attacks on secrets a person chose, and this is 256 random
-- bits. The unique index is what SHA-256 buys — authenticating is one index
-- seek rather than a bcrypt comparison per row, on every call.
IF OBJECT_ID('dbo.api_tokens', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_tokens] (
    [id]              NVARCHAR(36)  NOT NULL CONSTRAINT [PK_api_tokens] PRIMARY KEY,
    [name]            NVARCHAR(200) NOT NULL,
    [prefix]          NVARCHAR(20)  NOT NULL,
    [tokenHash]       NVARCHAR(64)  NOT NULL,
    [userId]          NVARCHAR(36)  NOT NULL,
    [scope]           NVARCHAR(10)  NOT NULL,
    [isActive]        BIT           NOT NULL CONSTRAINT [DF_api_tokens_isActive] DEFAULT 1,
    [expiresAt]       DATETIME2     NULL,
    [lastUsedAt]      DATETIME2     NULL,
    [createdAt]       DATETIME2     NOT NULL CONSTRAINT [DF_api_tokens_createdAt] DEFAULT CURRENT_TIMESTAMP,
    [createdByUserId] NVARCHAR(36)  NULL
  );

  CREATE UNIQUE INDEX [UX_api_tokens_tokenHash] ON [dbo].[api_tokens] ([tokenHash]);
  CREATE INDEX [IX_api_tokens_userId] ON [dbo].[api_tokens] ([userId]);
END
