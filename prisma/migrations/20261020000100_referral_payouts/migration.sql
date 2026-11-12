-- Commissions paid and gifts given to the person who brought a project.
-- Its own file: the table carries a referrerCustomerId of its own, and keeping it
-- apart from the migration that adds projects.referrerCustomerId keeps the two
-- unambiguous. A new table, so nothing on disk changes.

IF OBJECT_ID(N'[dbo].[referral_payouts]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[referral_payouts] (
        [id] NVARCHAR(36) NOT NULL,
        [projectId] NVARCHAR(36) NOT NULL,
        [referrerCustomerId] NVARCHAR(36) NULL,
        [kind] NVARCHAR(10) NOT NULL,
        [amountRial] FLOAT NOT NULL,
        [payoutDate] DATE NULL,
        [payoutDateJalali] NVARCHAR(10) NULL,
        [description] NVARCHAR(MAX) NULL,
        [createdByUserId] NVARCHAR(36) NULL,
        [createdByName] NVARCHAR(200) NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [referral_payouts_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [referral_payouts_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [referral_payouts_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE CASCADE ON UPDATE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'referral_payouts_projectId_idx')
    CREATE NONCLUSTERED INDEX [referral_payouts_projectId_idx] ON [dbo].[referral_payouts]([projectId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'referral_payouts_referrerCustomerId_idx')
    CREATE NONCLUSTERED INDEX [referral_payouts_referrerCustomerId_idx] ON [dbo].[referral_payouts]([referrerCustomerId]);
