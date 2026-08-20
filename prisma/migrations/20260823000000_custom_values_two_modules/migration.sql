-- Custom fields for the last two modules that could not hold them.
--
-- The settings screen has always offered custom fields for all ten modules,
-- but only eight tables had a `customValues` column. A field defined for
-- «بسته‌بندی و تحویل کالا» or «خدمات پس از فروش» could therefore be created,
-- shown in the settings list, and never filled in anywhere — the forms had no
-- section for it and there was nowhere to store the answer.
--
-- Nullable, like the other eight: a record with no custom fields filled in
-- stores NULL rather than an empty JSON object.

IF COL_LENGTH('packaging_deliveries', 'customValues') IS NULL
    ALTER TABLE [dbo].[packaging_deliveries] ADD [customValues] NVARCHAR(MAX) NULL;

IF COL_LENGTH('after_sales_services', 'customValues') IS NULL
    ALTER TABLE [dbo].[after_sales_services] ADD [customValues] NVARCHAR(MAX) NULL;
