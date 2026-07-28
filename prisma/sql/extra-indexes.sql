-- Indexes and constraints that the Prisma schema cannot express.
-- Run once after `prisma migrate deploy`, and re-run after any migration that
-- rebuilds these tables. Every statement is idempotent.

-- Required for filtered indexes and computed-column indexes. sqlcmd connects
-- with QUOTED_IDENTIFIER OFF (legacy ODBC default), which makes every CREATE
-- INDEX below fail with "Msg 1934 ... SET options have incorrect settings".
-- These persist for the whole session, so they only need setting once.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ---------------------------------------------------------------------------
   1. Economic code: unique, but only among customers that have one.

   A plain UNIQUE constraint would not work here: SQL Server treats NULLs as
   equal for uniqueness and allows only one of them, so the second customer
   without an economic code would be rejected. A filtered index applies the rule
   only to rows where the value is actually present.
--------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_customers_economicCode_notnull')
    CREATE UNIQUE NONCLUSTERED INDEX [UQ_customers_economicCode_notnull]
        ON [dbo].[customers]([economicCode])
        WHERE [economicCode] IS NOT NULL;
GO

/* ---------------------------------------------------------------------------
   2. Mobile numbers: fast duplicate detection on the normalized form.
--------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_mobileNormalized_notnull')
    CREATE NONCLUSTERED INDEX [IX_customers_mobileNormalized_notnull]
        ON [dbo].[customers]([mobileNormalized])
        WHERE [mobileNormalized] IS NOT NULL;
GO

/* ---------------------------------------------------------------------------
   3. Example: indexing one custom field.

   Custom fields live in the `customValues` JSON column. When a specific field
   is searched often, expose it as a persisted computed column and index that —
   this keeps the flexible JSON model while giving one field real index speed.
   Replace the field key and column name, then uncomment.

IF COL_LENGTH('dbo.customers', 'cf_nationalCode') IS NULL
    ALTER TABLE [dbo].[customers]
        ADD [cf_nationalCode] AS JSON_VALUE([customValues], '$.f_nationalCode') PERSISTED;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_cf_nationalCode')
    CREATE NONCLUSTERED INDEX [IX_customers_cf_nationalCode]
        ON [dbo].[customers]([cf_nationalCode])
        WHERE [cf_nationalCode] IS NOT NULL;
GO
--------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   4. Covering index for the busiest list screen (proforma lines by project).
--------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_proforma_items_proforma_status')
    CREATE NONCLUSTERED INDEX [IX_proforma_items_proforma_status]
        ON [dbo].[proforma_items]([proformaId], [status])
        INCLUDE ([productName], [quantity], [totalPriceRial]);
GO
