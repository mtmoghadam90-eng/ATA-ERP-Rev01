-- The city a supplier sits in.
--
-- `country` has been there from the start and is the right grain for an
-- overseas manufacturer, but most of the suppliers on this system are domestic
-- and «ایران» tells a buyer nothing. The city is what decides whether a part
-- can be collected this afternoon or has to be freighted, so it belongs beside
-- the country rather than buried in the free-text description where it was
-- being written.
--
-- Guarded, so it is safe to run against a database that already has it.

IF COL_LENGTH('dbo.suppliers', 'city') IS NULL
  ALTER TABLE [dbo].[suppliers] ADD [city] NVARCHAR(120) NULL;
