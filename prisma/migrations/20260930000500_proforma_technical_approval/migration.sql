-- The day the customer approved a quotation's technical proposal.
--
-- Recorded through the follow-up result «تأیید پیشنهاد فنی», and it is a fact
-- about the *document* rather than a status on the project: the project's
-- status and stage are derived from its proformas on every write, so a value
-- typed onto the project would be overwritten by the next quotation saved.
-- Stored here, `deriveProjectStatus` answers «تأیید پیشنهاد فنی» and
-- `deriveProjectStage` answers «تهیه پیش‌فاکتور» from it.
--
-- It is not a win: no line status moves, so no outcome, no stock, no sale and
-- no `proforma_outcome_change` rule is touched by it.
--
-- Two nullable columns and **no backfill**: NULL means nobody recorded an
-- approval, which is true of every document written before the question
-- existed. Nothing here reads a column this batch adds.

IF COL_LENGTH(N'[dbo].[proformas]', N'technicalApprovedDate') IS NULL
BEGIN
    ALTER TABLE [dbo].[proformas] ADD [technicalApprovedDate] DATE NULL;
END

IF COL_LENGTH(N'[dbo].[proformas]', N'technicalApprovedDateJalali') IS NULL
BEGIN
    ALTER TABLE [dbo].[proformas] ADD [technicalApprovedDateJalali] NVARCHAR(10) NULL;
END
