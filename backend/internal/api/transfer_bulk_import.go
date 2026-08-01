package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handlePreviewBulkTransferImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxInboundBulkImportRequestSize))
	fileHeader, err := c.FormFile("file")
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(c, http.StatusRequestEntityTooLarge, "Excel upload exceeds the 10 MB limit")
			return
		}
		writeError(c, http.StatusBadRequest, "Excel file is required")
		return
	}
	if fileHeader.Size <= 0 || fileHeader.Size > service.MaxInboundBulkImportFileSize {
		writeError(c, http.StatusBadRequest, "Excel file must be between 1 byte and 10 MB")
		return
	}
	if strings.ToLower(filepath.Ext(fileHeader.Filename)) != ".xlsx" {
		writeError(c, http.StatusBadRequest, "only .xlsx files are supported")
		return
	}
	customerID, err := parseInboundBulkImportFormID(c, "customerId")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		writeServerError(c, fmt.Errorf("open transfer bulk import: %w", err))
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxInboundBulkImportFileSize+1))
	if err != nil {
		writeServerError(c, fmt.Errorf("read transfer bulk import: %w", err))
		return
	}
	if len(data) > service.MaxInboundBulkImportFileSize {
		writeError(c, http.StatusBadRequest, "Excel file exceeds the 10 MB limit")
		return
	}
	batch, err := s.retainBulkImportFile(c, service.BulkImportTypeTransfer, fileHeader.Filename, fileHeader.Header.Get("Content-Type"), data)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	preview, err := s.store.PreviewBulkTransferImport(c.Request.Context(), fileHeader.Filename, data, customerID)
	if err != nil {
		_ = s.store.MarkBulkImportBatchPreview(c.Request.Context(), batch.ImportID, service.BulkImportTypeTransfer, customerID, service.BulkImportPreviewSummary{}, err)
		s.writeAuditLog(c, "UPLOAD", "bulk_import_batch", batch.ID, batch.SourceFileName, "Retained bulk transfer import file; preview failed", map[string]any{
			"importType": service.BulkImportTypeTransfer,
			"status":     service.BulkImportStatusPreviewFailed,
			"error":      err.Error(),
		})
		writeDomainError(c, err)
		return
	}
	preview.ImportID = batch.ImportID
	preview.ImportBatchID = batch.ID
	if err := s.store.MarkBulkImportBatchPreview(c.Request.Context(), batch.ImportID, service.BulkImportTypeTransfer, customerID, service.BulkImportPreviewSummary{
		TotalDocuments:   preview.TotalTransfers,
		ValidDocuments:   preview.ValidTransfers,
		InvalidDocuments: preview.InvalidTransfers,
		TotalLines:       len(preview.Rows),
	}, nil); err != nil {
		writeDomainError(c, err)
		return
	}
	s.writeAuditLog(c, "UPLOAD", "bulk_import_batch", batch.ID, batch.SourceFileName, "Retained bulk transfer import file and preview record", map[string]any{
		"importType":       service.BulkImportTypeTransfer,
		"totalTransfers":   preview.TotalTransfers,
		"validTransfers":   preview.ValidTransfers,
		"invalidTransfers": preview.InvalidTransfers,
	})
	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleRevalidateBulkTransferImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxInboundBulkImportCommitBodySize))
	var input service.BulkTransferImportRevalidateInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	preview, err := s.store.RevalidateBulkTransferImport(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	if err := s.store.MarkBulkImportBatchPreview(c.Request.Context(), input.ImportID, service.BulkImportTypeTransfer, input.CustomerID, service.BulkImportPreviewSummary{
		TotalDocuments:   preview.TotalTransfers,
		ValidDocuments:   preview.ValidTransfers,
		InvalidDocuments: preview.InvalidTransfers,
		TotalLines:       len(preview.Rows),
	}, nil); err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleCommitBulkTransferImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxInboundBulkImportCommitBodySize))
	var input service.BulkTransferImportCommitInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	batch, err := s.store.MarkBulkImportBatchCommitting(c.Request.Context(), input.ImportID, service.BulkImportTypeTransfer, input.CustomerID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	input.SourceFileName = batch.SourceFileName
	input.ImportBatchID = batch.ID
	response, err := s.store.CreateBulkTransfers(c.Request.Context(), input)
	if err != nil {
		_ = s.markBulkImportBatchFailedAfterRequest(c.Request.Context(), input.ImportID, service.BulkImportTypeTransfer, input.CustomerID, err)
		writeDomainError(c, err)
		return
	}
	response.ImportBatchID = batch.ID
	records := make([]service.BulkImportCommitRecord, 0, len(response.Results))
	for _, result := range response.Results {
		documentKeys := result.DocumentKeys
		if len(documentKeys) == 0 {
			documentKeys = []string{result.DocumentKey}
		}
		for _, documentKey := range documentKeys {
			record := service.BulkImportCommitRecord{
				DocumentKey:   documentKey,
				ReferenceCode: result.ContainerNo,
				Success:       result.Success,
				ErrorMessage:  result.Error,
			}
			if result.Transfer != nil {
				record.DocumentID = result.Transfer.ID
			}
			records = append(records, record)
		}
		if !result.Success || result.Transfer == nil {
			continue
		}
		transfer := result.Transfer
		s.writeAuditLog(c, "BULK_IMPORT", "inventory_transfer", transfer.ID, transfer.TransferNo, "Imported inventory transfer from Excel", map[string]any{
			"sourceFileName": input.SourceFileName,
			"importBatchId":  batch.ID,
			"importId":       batch.ImportID,
			"documentKey":    result.DocumentKey,
			"containerNo":    result.ContainerNo,
			"routes":         transfer.Routes,
		})
	}
	finalizationContext, cancelFinalization := newBulkImportFinalizationContext(c.Request.Context())
	err = s.store.CompleteBulkImportBatch(finalizationContext, service.CompleteBulkImportBatchInput{
		ImportID: input.ImportID, ImportType: service.BulkImportTypeTransfer, CustomerID: input.CustomerID,
		CreatedDocuments: response.CreatedTransfers, FailedDocuments: response.FailedTransfers, Results: records,
	})
	cancelFinalization()
	if err != nil {
		_ = s.markBulkImportBatchFailedAfterRequest(c.Request.Context(), input.ImportID, service.BulkImportTypeTransfer, input.CustomerID, err)
		response.RetentionWarning = "transfers were created, but the retained import result could not be finalized: " + err.Error()
	}
	s.writeAuditLog(c, "COMMIT", "bulk_import_batch", batch.ID, batch.SourceFileName, "Committed retained bulk transfer import batch", map[string]any{
		"createdTransfers": response.CreatedTransfers,
		"failedTransfers":  response.FailedTransfers,
		"retentionWarning": response.RetentionWarning,
	})
	writeJSON(c, http.StatusOK, response)
}
