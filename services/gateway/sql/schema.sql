-- AI'riel usage store (Azure SQL). Apply once per environment.

IF OBJECT_ID('dbo.Usage', 'U') IS NULL
CREATE TABLE dbo.Usage (
  Id               BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId           NVARCHAR(128) NOT NULL,   -- Entra object id
  UserName         NVARCHAR(256) NOT NULL,
  ConversationId   NVARCHAR(64)  NOT NULL,
  Model            NVARCHAR(128) NOT NULL,   -- Foundry deployment name
  PromptTokens     INT NOT NULL DEFAULT 0,
  CompletionTokens INT NOT NULL DEFAULT 0,
  CachedTokens     INT NOT NULL DEFAULT 0,
  ToolCalls        INT NOT NULL DEFAULT 0,
  LatencyMs        INT NOT NULL DEFAULT 0,
  CreatedAt        DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Usage_User_CreatedAt')
CREATE INDEX IX_Usage_User_CreatedAt ON dbo.Usage (UserId, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Usage_CreatedAt')
CREATE INDEX IX_Usage_CreatedAt ON dbo.Usage (CreatedAt DESC);
GO

-- Prices are kept in data so cost reports never need a code change.
IF OBJECT_ID('dbo.ModelPricing', 'U') IS NULL
CREATE TABLE dbo.ModelPricing (
  Model               NVARCHAR(128) NOT NULL,
  EffectiveFrom       DATE NOT NULL,
  InputPerMillionUsd  DECIMAL(10,4) NOT NULL,
  CachedPerMillionUsd DECIMAL(10,4) NOT NULL,
  OutputPerMillionUsd DECIMAL(10,4) NOT NULL,
  CONSTRAINT PK_ModelPricing PRIMARY KEY (Model, EffectiveFrom)
);
GO

-- Cost view: joins each usage row to the price in force on its day.
CREATE OR ALTER VIEW dbo.vUsageCost AS
SELECT u.Id, u.UserId, u.UserName, u.Model, u.CreatedAt,
       u.PromptTokens, u.CompletionTokens, u.CachedTokens,
       ( (u.PromptTokens - u.CachedTokens) * p.InputPerMillionUsd
       + u.CachedTokens * p.CachedPerMillionUsd
       + u.CompletionTokens * p.OutputPerMillionUsd ) / 1000000.0 AS CostUsd
FROM dbo.Usage u
OUTER APPLY (
  SELECT TOP 1 * FROM dbo.ModelPricing mp
  WHERE mp.Model = u.Model AND mp.EffectiveFrom <= CAST(u.CreatedAt AS date)
  ORDER BY mp.EffectiveFrom DESC
) p;
GO
