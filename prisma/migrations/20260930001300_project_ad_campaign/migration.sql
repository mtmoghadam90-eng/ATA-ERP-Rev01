-- Which advertising campaign an opportunity came from. Optional; NULL is
-- «not attributed», which is every project written before this.
IF COL_LENGTH('dbo.projects', 'adCampaignId') IS NULL
  ALTER TABLE [dbo].[projects] ADD [adCampaignId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_projects_adCampaignId')
  CREATE INDEX [IX_projects_adCampaignId] ON [dbo].[projects] ([adCampaignId]);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_projects_adCampaign')
  ALTER TABLE [dbo].[projects] ADD CONSTRAINT [FK_projects_adCampaign]
    FOREIGN KEY ([adCampaignId]) REFERENCES [dbo].[ad_campaigns] ([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
