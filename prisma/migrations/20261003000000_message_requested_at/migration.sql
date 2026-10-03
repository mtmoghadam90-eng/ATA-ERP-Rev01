-- What an outbox row asked for, before the quiet-time holds moved it.
--
-- `scheduledAt` is the answer the holds gave at insert, and it was final: a
-- staff notice queued under a quiet window set back to front kept the wrong
-- time after the window was corrected. Re-deriving the time when the rules
-- change needs the time that was asked for, which nothing stored.
--
-- Nullable and not backfilled: NULL means «queued before this column», and
-- `requestedTimeOf` decides what such a row may be re-derived from. No DML, so
-- nothing in this batch reads a column the batch adds.

IF COL_LENGTH('dbo.messages', 'requestedAt') IS NULL
  ALTER TABLE [dbo].[messages] ADD [requestedAt] DATETIME2 NULL;
