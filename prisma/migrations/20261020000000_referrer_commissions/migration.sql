-- The person who brought a project, from the customers list, and what they are
-- paid for it. All nullable and not backfilled: a project with no referrer
-- contact, and a contact with no agreed terms, is what every row is today.

IF COL_LENGTH(N'[dbo].[projects]', N'referrerCustomerId') IS NULL
    ALTER TABLE [dbo].[projects] ADD [referrerCustomerId] NVARCHAR(36) NULL;

IF COL_LENGTH(N'[dbo].[projects]', N'commissionBasis') IS NULL
    ALTER TABLE [dbo].[projects] ADD [commissionBasis] NVARCHAR(20) NULL;

IF COL_LENGTH(N'[dbo].[projects]', N'commissionRate') IS NULL
    ALTER TABLE [dbo].[projects] ADD [commissionRate] FLOAT NULL;

IF COL_LENGTH(N'[dbo].[customers]', N'commissionBasis') IS NULL
    ALTER TABLE [dbo].[customers] ADD [commissionBasis] NVARCHAR(20) NULL;

IF COL_LENGTH(N'[dbo].[customers]', N'commissionRate') IS NULL
    ALTER TABLE [dbo].[customers] ADD [commissionRate] FLOAT NULL;

-- Deferred: the column is added in this same batch.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'projects_referrerCustomerId_idx')
    EXEC(N'CREATE NONCLUSTERED INDEX [projects_referrerCustomerId_idx] ON [dbo].[projects]([referrerCustomerId]);');
