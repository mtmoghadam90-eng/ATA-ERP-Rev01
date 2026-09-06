-- The payment terms of one proforma line.
--
-- Per line rather than on the document, exactly like the four delivery columns
-- beside it: a quotation that mixes goods off the shelf with goods on a
-- four-month order genuinely has two payment arrangements.
--
-- Nullable with no backfill, deliberately. NULL means «nobody has said», which
-- `paymentPhrase` reads differently from every value the dropdown offers: a
-- ready-stock line with no term still prints «۱۰۰٪ کل مبلغ در زمان تحویل کالا»
-- as it did before this column existed, so no document already on disk changes
-- what it says. Writing a default in would take that distinction away and put a
-- payment condition on every quotation ever issued.
--
-- Guarded so a retry after a half-applied migration is safe (see CLAUDE.md), and
-- DDL only — there is no DML here, so nothing needs deferring through EXEC.
IF COL_LENGTH('dbo.proforma_items', 'paymentTerm') IS NULL
  ALTER TABLE [dbo].[proforma_items] ADD [paymentTerm] NVARCHAR(200) NULL;
