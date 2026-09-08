-- «چقدر است که در این وضعیت مانده؟»
--
-- The workflow engine can already say «N days after a date the record carries».
-- What it could not say is how long a record has been *stuck* — and that is the
-- question people actually have about a purchase order sitting in transit or an
-- after-sales job nobody has closed.
--
-- The dates it had to count from were the wrong ones: `orderDateJalali` answers
-- «how long since the order was placed», which gets worse the longer the job
-- runs. An order placed six months ago that reached customs yesterday is not
-- late, and a rule counting from its order date says it is.
--
-- `Project.stageChangedAt` has been the shape of the answer since the stage
-- column existed. These two columns give the same thing to the two other models
-- that carry a real status of their own. A packing list and a supplier inquiry
-- deliberately get nothing here: neither has a stored status — both derive one —
-- and both are already reachable, the packing list through its own delivery date
-- and the inquiry through the project stage it now moves (20260916, PR #124).
--
-- **No backfill, and that is the correct answer rather than a shortcut.** NULL
-- means «this application has never seen this record move», and `dueDay` already
-- reads a missing base date as «unscheduled, not overdue». Stamping every
-- existing row with today would be worse than nothing: it would claim every open
-- order changed status this morning, and every dwell rule would go quiet for
-- exactly as long as its threshold. The rows start counting from their next real
-- move, which is the only honest thing the data can say.
--
-- Guarded so a retry is safe, DDL only, and the indexes are plain — a filtered
-- one would have to be deferred through EXEC (see 20260916000000).

IF COL_LENGTH('dbo.purchase_orders', 'statusChangedAt') IS NULL
  ALTER TABLE [dbo].[purchase_orders] ADD [statusChangedAt] DATETIME2 NULL;

IF COL_LENGTH('dbo.purchase_orders', 'statusChangedAtJalali') IS NULL
  ALTER TABLE [dbo].[purchase_orders] ADD [statusChangedAtJalali] NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.after_sales_services', 'statusChangedAt') IS NULL
  ALTER TABLE [dbo].[after_sales_services] ADD [statusChangedAt] DATETIME2 NULL;

IF COL_LENGTH('dbo.after_sales_services', 'statusChangedAtJalali') IS NULL
  ALTER TABLE [dbo].[after_sales_services] ADD [statusChangedAtJalali] NVARCHAR(10) NULL;

-- The daily sweep filters on the Jalali column across a date band, once per
-- scheduled rule.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'purchase_orders_statusChangedAtJalali_idx' AND object_id = OBJECT_ID('dbo.purchase_orders'))
CREATE INDEX [purchase_orders_statusChangedAtJalali_idx] ON [dbo].[purchase_orders]([statusChangedAtJalali]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'after_sales_services_statusChangedAtJalali_idx' AND object_id = OBJECT_ID('dbo.after_sales_services'))
CREATE INDEX [after_sales_services_statusChangedAtJalali_idx] ON [dbo].[after_sales_services]([statusChangedAtJalali]);
