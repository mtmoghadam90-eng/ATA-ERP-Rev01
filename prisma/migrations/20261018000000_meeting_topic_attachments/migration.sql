-- Each topic of a meeting carries its own files, apart from the meeting's.
-- Nullable and not backfilled: NULL is "no files", which is what every topic
-- written before this had.

IF COL_LENGTH(N'[dbo].[meeting_topics]', N'attachments') IS NULL
BEGIN
    ALTER TABLE [dbo].[meeting_topics] ADD [attachments] NVARCHAR(MAX) NULL;
END
