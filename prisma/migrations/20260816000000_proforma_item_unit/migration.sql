-- The unit a proforma line is counted in: عدد, دستگاه, متر, ست, …
--
-- The printed document always said «عدد» because there was nowhere else for it
-- to come from: the form offered no unit field and the line carried no column,
-- so the print fell back to the catalogue product's unit or that literal. The
-- list of units is user-editable (settings.dropdownItems.units), so what a line
-- was quoted in has to be stored on the line.
--
-- Guarded, so it is safe on a database created after this column was added to
-- the schema.
IF COL_LENGTH('proforma_items', 'unit') IS NULL
    ALTER TABLE [proforma_items] ADD [unit] NVARCHAR(30) NULL;
