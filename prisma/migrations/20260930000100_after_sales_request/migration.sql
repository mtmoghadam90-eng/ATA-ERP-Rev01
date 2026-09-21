-- The customer's own words, and the day their request arrived.
--
-- `customerRequest` is not `issueDescription`: that column is rolled up from
-- the rows by `deriveServiceHeader` (the company's own «علت برگشت», chosen from
-- a list), so anything typed into it is overwritten on the next save. This is
-- the request as it came in, and nothing derives it.
--
-- `requestDate` is not `startDate`: that one is «تاریخ دریافت کالا» and is also
-- rolled up from the rows, while the goods often arrive days after the
-- complaint and sometimes never arrive at all.
--
-- Three nullable columns and **no backfill**: NULL means «this was recorded
-- before the question was asked», and filling `requestDate` from `startDate`
-- would claim an answer nobody gave. Nothing here reads a column this batch
-- adds, which SQL Server refuses at compile time however it is guarded.

IF COL_LENGTH(N'[dbo].[after_sales_services]', N'customerRequest') IS NULL
BEGIN
    ALTER TABLE [dbo].[after_sales_services] ADD [customerRequest] NVARCHAR(MAX) NULL;
END

IF COL_LENGTH(N'[dbo].[after_sales_services]', N'requestDate') IS NULL
BEGIN
    ALTER TABLE [dbo].[after_sales_services] ADD [requestDate] DATE NULL;
END

IF COL_LENGTH(N'[dbo].[after_sales_services]', N'requestDateJalali') IS NULL
BEGIN
    ALTER TABLE [dbo].[after_sales_services] ADD [requestDateJalali] NVARCHAR(10) NULL;
END
