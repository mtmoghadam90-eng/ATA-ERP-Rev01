-- «تاریخ دریافت کالا» on the record is rolled up from its rows, and a row is
-- allowed to carry no date at all: the complaint is recorded when the customer
-- rings, the equipment arrives days later, and sometimes it is diagnosed on
-- site and never arrives. `deriveServiceHeader` therefore answers null for the
-- header, and the column could not hold it — so every save of such a case died
-- with «Argument `startDate` must not be null» and the record could not be
-- written from any screen in the application.
--
-- Nullable rather than stamped with today: an invented receipt date is exactly
-- the claim this column exists to make truthfully, and it is the same answer
-- `requestDate` was given one migration ago.
--
-- No index, no default and no computed column reads it, so the ALTER stands on
-- its own; the guard is `is_nullable`, so re-running the migration is safe.

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE [object_id] = OBJECT_ID(N'[dbo].[after_sales_services]')
    AND [name] = N'startDate'
    AND [is_nullable] = 0
)
BEGIN
  ALTER TABLE [dbo].[after_sales_services] ALTER COLUMN [startDate] DATE NULL;
END;
