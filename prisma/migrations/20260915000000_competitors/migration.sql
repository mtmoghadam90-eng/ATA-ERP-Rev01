-- Who we lose to, and at what price.
--
-- The loss *reason* has been recorded per line since the sales follow-up
-- shipped, and it answers «چرا می‌بازیم». It cannot answer «به چه کسی» — and
-- for a trading company competing on price and lead time, that is the half a
-- salesperson can act on.
--
-- A table rather than a free-text column on the proforma, for the reason the
-- product categories are a list: one competitor entered twice is two rows, and
-- every figure about either is half the truth. `categoryKey`'s folding is reused
-- to refuse the duplicates it can see — case, ی/ي, ک/ك and the zero-width
-- joiner. It cannot join «فرا سو» to «فراسو», which is why the list is short and
-- edited by hand rather than typed onto each document.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'competitors')
  CREATE TABLE [dbo].[competitors] (
    [id]        NVARCHAR(36)   NOT NULL CONSTRAINT [PK_competitors] PRIMARY KEY,
    [name]      NVARCHAR(200)  NOT NULL,
    [website]   NVARCHAR(300)  NULL,
    [country]   NVARCHAR(100)  NULL,
    [notes]     NVARCHAR(MAX)  NULL,
    [isActive]  BIT            NOT NULL CONSTRAINT [DF_competitors_isActive] DEFAULT 1,
    [createdAt] DATETIME2      NOT NULL CONSTRAINT [DF_competitors_createdAt] DEFAULT SYSDATETIME(),
    [updatedAt] DATETIME2      NOT NULL CONSTRAINT [DF_competitors_updatedAt] DEFAULT SYSDATETIME()
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_competitors_name')
  CREATE INDEX [IX_competitors_name] ON [dbo].[competitors] ([name]);

-- Which competitor contested this quotation, and what they quoted.
--
-- On the document rather than on the line: the loss is decided line by line,
-- but who took the business is a fact about the deal. Recorded on a **won**
-- document too — «در برابر چه کسی بردیم» is the same question and the same
-- field, and a competitor named only on losses makes every win rate against
-- them read as zero.
IF COL_LENGTH('dbo.proformas', 'competitorId') IS NULL
  ALTER TABLE [dbo].[proformas] ADD [competitorId] NVARCHAR(36) NULL;

-- Their price, in **this document's own currency**, beside `finalAmount`.
--
-- The same rule as `ProformaItem.unitCost`: keeping it in the document's
-- currency is what makes the gap a *percentage* that does not move with the
-- exchange rate. A rial figure here would need a rate to compare against and
-- would drift every time the dollar did.
IF COL_LENGTH('dbo.proformas', 'competitorAmount') IS NULL
  ALTER TABLE [dbo].[proformas] ADD [competitorAmount] DECIMAL(19, 2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_proformas_competitorId')
  CREATE INDEX [IX_proformas_competitorId] ON [dbo].[proformas] ([competitorId]);

-- The project's own copy, derived from its deciding quotations in the same
-- transaction as its status and its loss reason — never typed a second time.
IF COL_LENGTH('dbo.projects', 'competitorId') IS NULL
  ALTER TABLE [dbo].[projects] ADD [competitorId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_projects_competitorId')
  CREATE INDEX [IX_projects_competitorId] ON [dbo].[projects] ([competitorId]);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_proformas_competitor')
  ALTER TABLE [dbo].[proformas] ADD CONSTRAINT [FK_proformas_competitor]
    FOREIGN KEY ([competitorId]) REFERENCES [dbo].[competitors] ([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_projects_competitor')
  ALTER TABLE [dbo].[projects] ADD CONSTRAINT [FK_projects_competitor]
    FOREIGN KEY ([competitorId]) REFERENCES [dbo].[competitors] ([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
