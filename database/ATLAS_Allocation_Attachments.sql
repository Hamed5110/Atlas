USE Atlasairfare010;
GO

IF OBJECT_ID('dbo.AllocationAttachments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AllocationAttachments
    (
        AttachmentID BIGINT IDENTITY(1,1) PRIMARY KEY,
        AllocationID BIGINT NOT NULL,
        FileName NVARCHAR(255) NOT NULL,
        MimeType NVARCHAR(100) NOT NULL,
        FileSize INT NOT NULL,
        AttachmentData VARBINARY(MAX) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
        CreatedBy INT NULL,
        CONSTRAINT FK_AllocationAttachments_Allocation FOREIGN KEY (AllocationID) REFERENCES dbo.Allocations(AllocationID) ON DELETE CASCADE,
        CONSTRAINT CK_AllocationAttachments_Mime CHECK (MimeType IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'))
    );

    CREATE INDEX IX_AllocationAttachments_Allocation ON dbo.AllocationAttachments(AllocationID);
END;
GO

CREATE OR ALTER VIEW dbo.vw_ATLAS_AllocationAttachments
AS
SELECT
    aa.AttachmentID,
    aa.AllocationID,
    aa.FileName,
    aa.MimeType,
    aa.FileSize,
    aa.CreatedAt,
    aa.CreatedBy
FROM dbo.AllocationAttachments aa;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_AddAllocationAttachment
    @AllocationID BIGINT,
    @FileName NVARCHAR(255),
    @MimeType NVARCHAR(100),
    @FileSize INT,
    @AttachmentData VARBINARY(MAX),
    @CreatedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Allocations WHERE AllocationID = @AllocationID)
        THROW 52000, 'Allocation not found.', 1;

    IF @MimeType NOT IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
        THROW 52001, 'Only PDF, PNG, JPEG, or WEBP attachments are allowed.', 1;

    IF @FileSize <= 0 OR @FileSize > 5242880
        THROW 52002, 'Attachment must be between 1 byte and 5 MB.', 1;

    INSERT INTO dbo.AllocationAttachments (AllocationID, FileName, MimeType, FileSize, AttachmentData, CreatedBy)
    OUTPUT INSERTED.AttachmentID, INSERTED.AllocationID, INSERTED.FileName, INSERTED.MimeType, INSERTED.FileSize, INSERTED.CreatedAt
    VALUES (@AllocationID, @FileName, @MimeType, @FileSize, @AttachmentData, @CreatedBy);
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ATLAS_GetAllocationAttachments
    @AllocationID BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.vw_ATLAS_AllocationAttachments WHERE AllocationID = @AllocationID ORDER BY CreatedAt DESC;
END;
GO
