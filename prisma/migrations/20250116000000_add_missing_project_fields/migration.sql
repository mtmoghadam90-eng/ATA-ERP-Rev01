-- Add missing string fields to projects table
-- These fields were lost during SQL Server migration

ALTER TABLE projects ADD salesExpert NVARCHAR(200) NULL;
ALTER TABLE projects ADD financialContact NVARCHAR(200) NULL;
ALTER TABLE projects ADD technicalContact NVARCHAR(200) NULL;
ALTER TABLE projects ADD endUser NVARCHAR(200) NULL;
