-- One proforma line may depart from the customer's request in several ways.
--
-- `deviations` is the list as JSON ([{reference,requested,offered,remark}]).
-- The four columns added by 20260930001400 keep holding the first entry, and a
-- row with no JSON reads as one entry from them, so nothing is backfilled.

IF COL_LENGTH(N'[dbo].[proforma_items]', N'deviations') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [deviations] NVARCHAR(MAX) NULL;
END
