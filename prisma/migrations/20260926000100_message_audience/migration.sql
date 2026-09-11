-- Who an outbox row is addressed to, so a **retry** can decide the holds again.
--
-- The quiet hours and the quiet days are applied when a message is queued, and
-- `processQueue` rescheduled a failed attempt as a plain `now + retryDelayMs`.
-- So a send attempted at 20:55 on a working Thursday failed and went out at
-- 21:00 inside the quiet window, or after midnight on a Friday nobody is written
-- to: both switches held for a first attempt and not for a second. Reported by
-- code review on #175.
--
-- Re-applying them on the retry needs the audience, because a staff notification
-- is exempt from the days. It lives on the row for exactly the reason `dryRun`
-- does — the row says what will happen to it, and asking the settings again
-- would answer for whoever flipped a switch since.
--
-- DEFAULT 'CUSTOMER' is the safe direction for the rows already here: a staff
-- retry then waits for a working day, which is late, rather than a customer's
-- message going out on Ashura, which is the thing the switch exists to stop. No
-- DML, so nothing in this batch reads a column the batch adds.

IF COL_LENGTH('dbo.messages', 'audience') IS NULL
    ALTER TABLE [dbo].[messages]
        ADD [audience] NVARCHAR(20) NOT NULL CONSTRAINT [messages_audience_df] DEFAULT 'CUSTOMER';
