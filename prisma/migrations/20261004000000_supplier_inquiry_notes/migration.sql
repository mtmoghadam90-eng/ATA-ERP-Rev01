-- A supplier inquiry's own general description.
--
-- The form's only free-text box was «توضیحات ارسال», which is the notes of the
-- inquiry's first («ارسال استعلام») step — how it was sent — and is asked on
-- creation only. What the inquiry is *about* had nowhere to go.
--
-- Nullable and not backfilled: NULL means «no description», which is every
-- inquiry written before this. No DML, so nothing here reads the new column.

IF COL_LENGTH('dbo.supplier_inquiries', 'notes') IS NULL
  ALTER TABLE [dbo].[supplier_inquiries] ADD [notes] NVARCHAR(MAX) NULL;
