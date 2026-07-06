SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AirfarePolicyRates (
        PolicyRateID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AirfarePolicyRates PRIMARY KEY,
        CompanyID INT NULL,
        EmployeeID INT NULL,
        Department NVARCHAR(100) NULL,
        EmpGroup NVARCHAR(100) NULL,
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        MaxPayoutAmount DECIMAL(12,2) NOT NULL,
        CycleDays DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_CycleDays_Phase1 DEFAULT (60),
        WorkingDaysPerMonth DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_WorkingDays_Phase1 DEFAULT (30),
        AirfareDaysPerMonth DECIMAL(10,2) NOT NULL CONSTRAINT DF_AirfarePolicyRates_AirfareDays_Phase1 DEFAULT (2.5),
        IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsActive_Phase1 DEFAULT (1),
        CreatedBy INT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_AirfarePolicyRates_CreatedAt_Phase1 DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF COL_LENGTH('dbo.AirfarePolicyRates', 'EmployeeID') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD EmployeeID INT NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'Department') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD Department NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'EmpGroup') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD EmpGroup NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsActive') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD IsActive BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsActive_Phase1Live DEFAULT (1);
IF COL_LENGTH('dbo.AirfarePolicyRates', 'IsDeleted') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD IsDeleted BIT NOT NULL CONSTRAINT DF_AirfarePolicyRates_IsDeleted_Phase1 DEFAULT (0);
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DeletedAt') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DeletedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DeletedBy') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DeletedBy INT NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DeleteReason') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DeleteReason NVARCHAR(400) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'ArchivedAt') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD ArchivedAt DATETIME2(0) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'DependencySnapshotJson') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD DependencySnapshotJson NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.AirfarePolicyRates', 'PolicyStatus') IS NULL ALTER TABLE dbo.AirfarePolicyRates ADD PolicyStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_AirfarePolicyRates_PolicyStatus_Phase1 DEFAULT (N'active');
GO

IF OBJECT_ID(N'dbo.AirfarePolicyRates', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.AirfarePolicyRates', N'PolicyRateID') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
          AND name = N'PK_AirfarePolicyRates'
   )
BEGIN
    DECLARE @atlasPolicyPkSql NVARCHAR(MAX);
    DECLARE @atlasPolicyHasPrimaryKey BIT = CASE WHEN EXISTS (
        SELECT 1
        FROM sys.key_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
          AND [type] = N'PK'
    ) THEN 1 ELSE 0 END;
    DECLARE @atlasPolicyCanBeUnique BIT = CASE WHEN NOT EXISTS (
        SELECT PolicyRateID
        FROM dbo.AirfarePolicyRates
        GROUP BY PolicyRateID
        HAVING PolicyRateID IS NULL OR COUNT_BIG(*) > 1
    ) THEN 1 ELSE 0 END;
    DECLARE @atlasPolicyHasClustered BIT = CASE WHEN EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
          AND [type] = 1
    ) THEN 1 ELSE 0 END;

    IF @atlasPolicyHasPrimaryKey = 0 AND @atlasPolicyCanBeUnique = 1
    BEGIN
        SET @atlasPolicyPkSql = N'ALTER TABLE dbo.AirfarePolicyRates ADD CONSTRAINT PK_AirfarePolicyRates PRIMARY KEY '
            + CASE WHEN @atlasPolicyHasClustered = 1 THEN N'NONCLUSTERED' ELSE N'CLUSTERED' END
            + N' (PolicyRateID);';
        EXEC sp_executesql @atlasPolicyPkSql;
    END
    ELSE IF @atlasPolicyCanBeUnique = 1
    BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX PK_AirfarePolicyRates ON dbo.AirfarePolicyRates(PolicyRateID);
    END
    ELSE
    BEGIN
        CREATE NONCLUSTERED INDEX PK_AirfarePolicyRates ON dbo.AirfarePolicyRates(PolicyRateID);
    END
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRates') AND name = N'IX_ATLAS_AirfarePolicyRates_EffectiveScope')
BEGIN
    CREATE INDEX IX_ATLAS_AirfarePolicyRates_EffectiveScope
        ON dbo.AirfarePolicyRates (IsActive, EmployeeID, CompanyID, Department, EmpGroup, EffectiveFrom DESC, PolicyRateID DESC);
END;
GO

UPDATE dbo.AirfarePolicyRates
   SET PolicyStatus = CASE
       WHEN ISNULL(IsDeleted, 0) = 1 THEN N'archived'
       WHEN IsActive = 1 AND EffectiveTo IS NULL THEN N'active'
       ELSE N'historical'
   END
WHERE PolicyStatus IS NULL
   OR PolicyStatus <> CASE
       WHEN ISNULL(IsDeleted, 0) = 1 THEN N'archived'
       WHEN IsActive = 1 AND EffectiveTo IS NULL THEN N'active'
       ELSE N'historical'
   END;
GO

IF OBJECT_ID(N'dbo.AirfarePolicyRateArchive', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AirfarePolicyRateArchive (
        ArchiveID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AirfarePolicyRateArchive PRIMARY KEY,
        PolicyRateID BIGINT NOT NULL,
        PolicySnapshotJson NVARCHAR(MAX) NOT NULL,
        DeleteAction NVARCHAR(40) NOT NULL,
        ArchivedAt DATETIME2(0) NOT NULL CONSTRAINT DF_AirfarePolicyRateArchive_ArchivedAt_Phase1 DEFAULT SYSUTCDATETIME(),
        ArchivedBy INT NULL,
        ArchiveReason NVARCHAR(400) NULL
    );
END;

IF COL_LENGTH(N'dbo.AirfarePolicyRateArchive', N'PolicySnapshotJson') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD PolicySnapshotJson NVARCHAR(MAX) NULL;

IF COL_LENGTH(N'dbo.AirfarePolicyRateArchive', N'DeleteAction') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD DeleteAction NVARCHAR(40) NULL;

IF COL_LENGTH(N'dbo.AirfarePolicyRateArchive', N'ArchivedAt') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD ArchivedAt DATETIME2(0) NULL;

IF COL_LENGTH(N'dbo.AirfarePolicyRateArchive', N'ArchivedBy') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD ArchivedBy INT NULL;

IF COL_LENGTH(N'dbo.AirfarePolicyRateArchive', N'ArchiveReason') IS NULL
    ALTER TABLE dbo.AirfarePolicyRateArchive ADD ArchiveReason NVARCHAR(400) NULL;
GO

UPDATE dbo.AirfarePolicyRateArchive
   SET PolicySnapshotJson = COALESCE(PolicySnapshotJson, N'{}'),
       DeleteAction = COALESCE(DeleteAction, N'legacy_archive'),
       ArchivedAt = COALESCE(ArchivedAt, SYSUTCDATETIME());
GO

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRateArchive')
      AND name = N'PolicySnapshotJson'
      AND is_nullable = 1
)
    ALTER TABLE dbo.AirfarePolicyRateArchive ALTER COLUMN PolicySnapshotJson NVARCHAR(MAX) NOT NULL;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRateArchive')
      AND name = N'DeleteAction'
      AND is_nullable = 1
)
    ALTER TABLE dbo.AirfarePolicyRateArchive ALTER COLUMN DeleteAction NVARCHAR(40) NOT NULL;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRateArchive')
      AND name = N'ArchivedAt'
      AND is_nullable = 1
)
    ALTER TABLE dbo.AirfarePolicyRateArchive ALTER COLUMN ArchivedAt DATETIME2(0) NOT NULL;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_PurgeAirfarePolicyRate
    @PolicyRateID BIGINT,
    @DeletedBy INT = NULL,
    @DeleteReason NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    IF @PolicyRateID IS NULL OR @PolicyRateID <= 0
        THROW 52031, 'Valid policy rate is required.', 1;

    DECLARE @deleteAction NVARCHAR(40) = N'hard_delete';
    DECLARE @deleteStatus NVARCHAR(40) = N'purged';
    DECLARE @allocationLinksCleared INT = 0;
    DECLARE @archiveRowsDeleted INT = 0;
    DECLARE @auditRowsDeleted INT = 0;
    DECLARE @dynamicRowsCleared INT = 0;
    DECLARE @dynamicRowsDeleted INT = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (
            SELECT 1
            FROM dbo.AirfarePolicyRates WITH (UPDLOCK, HOLDLOCK)
            WHERE PolicyRateID = @PolicyRateID
        )
        BEGIN
            COMMIT TRANSACTION;
            SELECT CAST(N'success' AS NVARCHAR(40)) AS ApiStatus,
                   CAST(N'hard_delete' AS NVARCHAR(40)) AS DeleteAction,
                   CAST(N'not_found_purged' AS NVARCHAR(40)) AS DeleteStatus,
                   CAST(0 AS BIT) AS AlreadyRemoved,
                   CAST(0 AS BIT) AS AlreadyHistorical,
                   CAST(0 AS BIT) AS Deactivated,
                   CAST(1 AS BIT) AS HardDeleted,
                   CAST(1 AS BIT) AS Purged,
                   @PolicyRateID AS PolicyRateID;
            RETURN;
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyRateArchive', N'U') IS NOT NULL
        BEGIN
            INSERT INTO dbo.AirfarePolicyRateArchive (PolicyRateID, PolicySnapshotJson, DeleteAction, ArchivedBy, ArchiveReason)
            SELECT r.PolicyRateID,
                   (SELECT r.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                   N'hard_delete',
                   @DeletedBy,
                   COALESCE(@DeleteReason, N'Airfare policy rate purged.')
            FROM dbo.AirfarePolicyRates r
            WHERE r.PolicyRateID = @PolicyRateID;
        END;

        IF OBJECT_ID(N'dbo.Allocations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.Allocations', N'PolicyRateID') IS NOT NULL
        BEGIN
            UPDATE dbo.Allocations
               SET PolicyRateID = NULL
             WHERE PolicyRateID = @PolicyRateID;
            SET @allocationLinksCleared = @@ROWCOUNT;
        END;

        IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AuditLog WHERE EntityType = N'AirfarePolicyRate' AND EntityID = @PolicyRateID;
            SET @auditRowsDeleted = @@ROWCOUNT;
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyAllocations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.AirfarePolicyAllocations', N'PolicyRateID') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AirfarePolicyAllocations WHERE PolicyRateID = @PolicyRateID;
            SET @dynamicRowsDeleted = @dynamicRowsDeleted + @@ROWCOUNT;
        END;

        IF OBJECT_ID(N'dbo.AirfarePolicyRateHistory', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.AirfarePolicyRateHistory', N'PolicyRateID') IS NOT NULL
        BEGIN
            DELETE FROM dbo.AirfarePolicyRateHistory WHERE PolicyRateID = @PolicyRateID;
            SET @dynamicRowsDeleted = @dynamicRowsDeleted + @@ROWCOUNT;
        END;

        DECLARE @schemaName SYSNAME;
        DECLARE @tableName SYSNAME;
        DECLARE @columnName SYSNAME;
        DECLARE @isNullable BIT;
        DECLARE @sql NVARCHAR(MAX);
        DECLARE @affected INT;

        DECLARE policy_fk_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT OBJECT_SCHEMA_NAME(fkc.parent_object_id),
                   OBJECT_NAME(fkc.parent_object_id),
                   pc.name,
                   pc.is_nullable
            FROM sys.foreign_key_columns fkc
            INNER JOIN sys.columns pc
                ON pc.object_id = fkc.parent_object_id
               AND pc.column_id = fkc.parent_column_id
            INNER JOIN sys.columns rc
                ON rc.object_id = fkc.referenced_object_id
               AND rc.column_id = fkc.referenced_column_id
            WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.AirfarePolicyRates')
              AND rc.name = N'PolicyRateID'
              AND fkc.parent_object_id <> OBJECT_ID(N'dbo.AirfarePolicyRates');

        OPEN policy_fk_cursor;
        FETCH NEXT FROM policy_fk_cursor INTO @schemaName, @tableName, @columnName, @isNullable;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @affected = 0;
            IF @isNullable = 1
            BEGIN
                SET @sql = N'UPDATE ' + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) +
                           N' SET ' + QUOTENAME(@columnName) + N' = NULL WHERE ' + QUOTENAME(@columnName) + N' = @id; SET @affected = @@ROWCOUNT;';
                EXEC sp_executesql @sql, N'@id BIGINT, @affected INT OUTPUT', @id = @PolicyRateID, @affected = @affected OUTPUT;
                SET @dynamicRowsCleared = @dynamicRowsCleared + ISNULL(@affected, 0);
            END
            ELSE
            BEGIN
                SET @sql = N'DELETE FROM ' + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) +
                           N' WHERE ' + QUOTENAME(@columnName) + N' = @id; SET @affected = @@ROWCOUNT;';
                EXEC sp_executesql @sql, N'@id BIGINT, @affected INT OUTPUT', @id = @PolicyRateID, @affected = @affected OUTPUT;
                SET @dynamicRowsDeleted = @dynamicRowsDeleted + ISNULL(@affected, 0);
            END;
            FETCH NEXT FROM policy_fk_cursor INTO @schemaName, @tableName, @columnName, @isNullable;
        END;
        CLOSE policy_fk_cursor;
        DEALLOCATE policy_fk_cursor;

        DELETE FROM dbo.AirfarePolicyRates WHERE PolicyRateID = @PolicyRateID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF CURSOR_STATUS('local', 'policy_fk_cursor') >= 0
        BEGIN
            CLOSE policy_fk_cursor;
        END;

        IF CURSOR_STATUS('local', 'policy_fk_cursor') >= -1
        BEGIN
            DEALLOCATE policy_fk_cursor;
        END;
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

        SET @deleteAction = N'soft_delete';
        SET @deleteStatus = N'archived';

        BEGIN TRY
            BEGIN TRANSACTION;

            IF EXISTS (
                SELECT 1
                FROM dbo.AirfarePolicyRates WITH (UPDLOCK, HOLDLOCK)
                WHERE PolicyRateID = @PolicyRateID
            )
            BEGIN
                IF OBJECT_ID(N'dbo.AirfarePolicyRateArchive', N'U') IS NOT NULL
                BEGIN
                    INSERT INTO dbo.AirfarePolicyRateArchive (PolicyRateID, PolicySnapshotJson, DeleteAction, ArchivedBy, ArchiveReason)
                    SELECT r.PolicyRateID,
                           (SELECT r.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                           N'soft_delete',
                           @DeletedBy,
                           COALESCE(@DeleteReason, ERROR_MESSAGE())
                    FROM dbo.AirfarePolicyRates r
                    WHERE r.PolicyRateID = @PolicyRateID;
                END;

                UPDATE dbo.AirfarePolicyRates
                   SET IsActive = 0,
                       IsDeleted = 1,
                       DeletedAt = COALESCE(DeletedAt, SYSUTCDATETIME()),
                       DeletedBy = COALESCE(@DeletedBy, DeletedBy),
                       DeleteReason = COALESCE(@DeleteReason, N'Archived after dependency-protected delete.'),
                       ArchivedAt = COALESCE(ArchivedAt, SYSUTCDATETIME()),
                       PolicyStatus = N'archived',
                       EffectiveTo = COALESCE(EffectiveTo, CONVERT(DATE, SYSUTCDATETIME()))
                 WHERE PolicyRateID = @PolicyRateID;
            END;

            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
            THROW;
        END CATCH;
    END CATCH;

    SELECT CAST(N'success' AS NVARCHAR(40)) AS ApiStatus,
           @deleteAction AS DeleteAction,
           @deleteStatus AS DeleteStatus,
           CAST(0 AS BIT) AS AlreadyRemoved,
           CAST(0 AS BIT) AS AlreadyHistorical,
           CAST(CASE WHEN @deleteAction = N'soft_delete' THEN 1 ELSE 0 END AS BIT) AS Deactivated,
           CAST(CASE WHEN @deleteAction = N'hard_delete' THEN 1 ELSE 0 END AS BIT) AS HardDeleted,
           CAST(CASE WHEN @deleteAction = N'hard_delete' THEN 1 ELSE 0 END AS BIT) AS Purged,
           @PolicyRateID AS PolicyRateID,
           @allocationLinksCleared AS AllocationLinksCleared,
           @archiveRowsDeleted AS ArchiveRowsDeleted,
           @auditRowsDeleted AS AuditRowsDeleted,
           @dynamicRowsCleared AS DynamicRowsCleared,
           @dynamicRowsDeleted AS DynamicRowsDeleted;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_DeactivateAirfarePolicyRate
    @PolicyRateID BIGINT,
    @DeletedBy INT = NULL,
    @DeleteReason NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.sp_ATLAS_PurgeAirfarePolicyRate
        @PolicyRateID = @PolicyRateID,
        @DeletedBy = @DeletedBy,
        @DeleteReason = @DeleteReason;
END;
GO

SELECT
    CAST(N'PHASE1_POLICY_RATE_REPAIR_OK' AS NVARCHAR(80)) AS RepairStatus,
    CASE WHEN EXISTS (
        SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AirfarePolicyRates') AND name = N'PK_AirfarePolicyRates'
    ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasPKAirfarePolicyRates,
    CASE WHEN OBJECT_ID(N'dbo.sp_ATLAS_PurgeAirfarePolicyRate', N'P') IS NOT NULL THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasPurgeProcedure,
    CASE WHEN OBJECT_ID(N'dbo.sp_ATLAS_DeactivateAirfarePolicyRate', N'P') IS NOT NULL THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasDeactivateProcedure;
GO
