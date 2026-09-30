-- Where a proforma line departs from the customer's request.
--
-- `deviation` defaults to 0 («complies»), which is what every line already on
-- disk is; the four text columns are nullable. Nothing here reads a column this
-- batch adds, so no statement needs deferring.

IF COL_LENGTH(N'[dbo].[proforma_items]', N'deviation') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [deviation] BIT NOT NULL
        CONSTRAINT [DF_proforma_items_deviation] DEFAULT 0;
END

IF COL_LENGTH(N'[dbo].[proforma_items]', N'deviationReference') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [deviationReference] NVARCHAR(200) NULL;
END

IF COL_LENGTH(N'[dbo].[proforma_items]', N'deviationRequested') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [deviationRequested] NVARCHAR(1000) NULL;
END

IF COL_LENGTH(N'[dbo].[proforma_items]', N'deviationOffered') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [deviationOffered] NVARCHAR(1000) NULL;
END

IF COL_LENGTH(N'[dbo].[proforma_items]', N'deviationRemark') IS NULL
BEGIN
    ALTER TABLE [dbo].[proforma_items] ADD [deviationRemark] NVARCHAR(1000) NULL;
END
