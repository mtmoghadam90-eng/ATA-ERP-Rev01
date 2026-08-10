-- Waybill, driver and tracking code on a packing list.
--
-- The save already warned when a courier or freight shipment had none of these
-- recorded, and then had nowhere to record them: the check scanned the free-text
-- delivery-report field for anything that looked like a number. So the warning
-- could be silenced by typing a digit, and the real waybill number lived in
-- prose or nowhere at all.
--
-- Guarded, so it is safe to re-run and safe on a database that already has them.

IF COL_LENGTH('dbo.packaging_deliveries', 'waybillNumber') IS NULL
    ALTER TABLE [dbo].[packaging_deliveries] ADD [waybillNumber] NVARCHAR(100) NULL;

IF COL_LENGTH('dbo.packaging_deliveries', 'driverName') IS NULL
    ALTER TABLE [dbo].[packaging_deliveries] ADD [driverName] NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.packaging_deliveries', 'driverPhone') IS NULL
    ALTER TABLE [dbo].[packaging_deliveries] ADD [driverPhone] NVARCHAR(30) NULL;

IF COL_LENGTH('dbo.packaging_deliveries', 'vehiclePlate') IS NULL
    ALTER TABLE [dbo].[packaging_deliveries] ADD [vehiclePlate] NVARCHAR(50) NULL;

IF COL_LENGTH('dbo.packaging_deliveries', 'trackingCode') IS NULL
    ALTER TABLE [dbo].[packaging_deliveries] ADD [trackingCode] NVARCHAR(100) NULL;
