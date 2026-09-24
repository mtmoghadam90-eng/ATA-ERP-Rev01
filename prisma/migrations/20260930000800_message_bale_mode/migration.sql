-- The Bale mode a queued message's address was resolved under.
--
-- Safir addresses a mobile and the bot a numeric chat id, and the mode is a
-- setting that can change between queueing and delivery. A row resolved under
-- one and delivered under the other either fails or — a mobile written without
-- its leading zero is a perfectly good-looking chat id — reaches somebody else.
-- Nullable and backfilled with nothing: NULL means «queued before this», which
-- is delivered under the current mode exactly as before.
IF COL_LENGTH('messages', 'baleMode') IS NULL
  ALTER TABLE [messages] ADD [baleMode] NVARCHAR(10) NULL;
