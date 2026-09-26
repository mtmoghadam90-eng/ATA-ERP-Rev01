-- Freight is paid at its own rate, and sometimes in its own currency.
-- NULL in both means «as the order», which is how every order already on disk
-- was costed, so nothing is backfilled and no stored figure changes.

IF COL_LENGTH('purchase_orders', 'shippingCurrency') IS NULL
  ALTER TABLE [purchase_orders] ADD [shippingCurrency] NVARCHAR(20) NULL;

IF COL_LENGTH('purchase_orders', 'shippingExchangeRate') IS NULL
  ALTER TABLE [purchase_orders] ADD [shippingExchangeRate] DECIMAL(19, 4) NULL;
