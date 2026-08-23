-- The assistant's provider credentials.
--
-- Its own table rather than a field on `settings`, for the same reason the
-- messaging providers have one: the settings document is loaded whole by every
-- browser, and an API key in it would be handed to every signed-in user. Only
-- the server ever reads this row; the settings screen sends a new key and gets
-- back a masked hint.
--
-- One row, keyed by a fixed id, because there is one assistant.
IF OBJECT_ID('dbo.assistant_credentials', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[assistant_credentials] (
    [id]        NVARCHAR(36)  NOT NULL CONSTRAINT [PK_assistant_credentials] PRIMARY KEY,
    [apiKey]    NVARCHAR(500) NULL,
    [updatedAt] DATETIME2     NOT NULL CONSTRAINT [DF_assistant_credentials_updatedAt] DEFAULT CURRENT_TIMESTAMP
  );
END
