-- When a proforma was sent to the customer.
--
-- Time-based workflow rules count days from a date the record carries, and
-- "three days after it was sent" had no such date: the issue date is when the
-- quotation was written, which is not when it went out. The status becoming
-- «ارسال شده» is the moment, so that moment is now stamped.
--
-- Existing sent proformas are back-filled from their issue date: it is the only
-- evidence there is, and leaving them NULL would exclude every document already
-- in the system from the follow-up rules people are setting up now.
--
-- The back-fill runs through EXEC because the column does not exist yet when
-- this batch is compiled — Prisma sends the file as one batch, with no GO.
IF COL_LENGTH('proformas', 'sentDate') IS NULL
BEGIN
    ALTER TABLE [proformas] ADD [sentDate] DATE NULL;
END

IF COL_LENGTH('proformas', 'sentDateJalali') IS NULL
BEGIN
    ALTER TABLE [proformas] ADD [sentDateJalali] NVARCHAR(10) NULL;
END

EXEC(N'
    UPDATE [proformas]
    SET [sentDate] = [issueDate], [sentDateJalali] = [issueDateJalali]
    WHERE [status] = N''ارسال شده'' AND [sentDate] IS NULL
');
