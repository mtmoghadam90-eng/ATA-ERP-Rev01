-- The unit a packing-list line is counted in, alongside the proforma's.
-- Guarded, so it is safe on a database created after the schema carried it.
IF COL_LENGTH('packing_items', 'unit') IS NULL
    ALTER TABLE [packing_items] ADD [unit] NVARCHAR(30) NULL;
