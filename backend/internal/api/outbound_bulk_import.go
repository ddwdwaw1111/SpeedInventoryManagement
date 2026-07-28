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

func (s *Server) handlePreviewOutboundBulkImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxOutboundBulkImportRequestSize))
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
	if fileHeader.Size <= 0 || fileHeader.Size > service.MaxOutboundBulkImportFileSize {
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
		writeServerError(c, fmt.Errorf("open outbound bulk import: %w", err))
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxOutboundBulkImportFileSize+1))
	if err != nil {
		writeServerError(c, fmt.Errorf("read outbound bulk import: %w", err))
		return
	}
	if len(data) > service.MaxOutboundBulkImportFileSize {
		writeError(c, http.StatusBadRequest, "Excel file exceeds the 10 MB limit")
		return
	}
	batch, err := s.retainBulkImportFile(c, service.BulkImportTypeOutbound, fileHeader.Filename, fileHeader.Header.Get("Content-Type"), data)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	preview, err := s.store.PreviewOutboundBulkImport(c.Request.Context(), fileHeader.Filename, data, customerID)
	if err != nil {
		_ = s.store.MarkBulkImportBatchPreview(c.Request.Context(), batch.ImportID, service.BulkImportTypeOutbound, customerID, service.BulkImportPreviewSummary{}, err)
		s.writeAuditLog(c, "UPLOAD", "bulk_import_batch", batch.ID, batch.SourceFileName, "Retained outbound bulk import file; preview failed", map[string]any{
			"importType": service.BulkImportTypeOutbound,
			"status":     service.BulkImportStatusPreviewFailed,
			"error":      err.Error(),
		})
		writeDomainError(c, err)
		return
	}
	preview.ImportID = batch.ImportID
	preview.ImportBatchID = batch.ID
	if err := s.store.MarkBulkImportBatchPreview(c.Request.Context(), batch.ImportID, service.BulkImportTypeOutbound, customerID, service.BulkImportPreviewSummary{
		TotalDocuments: preview.TotalDocuments, ValidDocuments: preview.ValidDocuments,
		InvalidDocuments: preview.InvalidDocuments, TotalLines: preview.TotalLines,
	}, nil); err != nil {
		writeDomainError(c, err)
		return
	}
	s.writeAuditLog(c, "UPLOAD", "bulk_import_batch", batch.ID, batch.SourceFileName, "Retained outbound bulk import file and preview record", map[string]any{
		"importType":       service.BulkImportTypeOutbound,
		"totalDocuments":   preview.TotalDocuments,
		"validDocuments":   preview.ValidDocuments,
		"invalidDocuments": preview.InvalidDocuments,
		"totalLines":       preview.TotalLines,
	})
	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleRevalidateOutboundBulkImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxOutboundBulkImportCommitBodySize))
	var input service.OutboundBulkImportRevalidateInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	preview, err := s.store.RevalidateOutboundBulkImport(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	if err := s.store.MarkBulkImportBatchPreview(c.Request.Context(), input.ImportID, service.BulkImportTypeOutbound, input.CustomerID, service.BulkImportPreviewSummary{
		TotalDocuments: preview.TotalDocuments, ValidDocuments: preview.ValidDocuments,
		InvalidDocuments: preview.InvalidDocuments, TotalLines: preview.TotalLines,
	}, nil); err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleCommitOutboundBulkImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxOutboundBulkImportCommitBodySize))
	var input service.OutboundBulkImportCommitInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	batch, err := s.store.MarkBulkImportBatchCommitting(c.Request.Context(), input.ImportID, service.BulkImportTypeOutbound, input.CustomerID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	input.SourceFileName = batch.SourceFileName
	input.ImportBatchID = batch.ID
	response, err := s.store.CreateOutboundDocumentsBulkDraft(c.Request.Context(), input)
	if err != nil {
		_ = s.markBulkImportBatchFailedAfterRequest(c.Request.Context(), input.ImportID, service.BulkImportTypeOutbound, input.CustomerID, err)
		writeDomainError(c, err)
		return
	}
	response.ImportBatchID = batch.ID
	for _, result := range response.Results {
		if !result.Success || result.Document == nil {
			continue
		}
		document := result.Document
		s.writeAuditLog(c, "BULK_IMPORT", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Imported outbound document draft from Excel", map[string]any{
			"sourceFileName": input.SourceFileName,
			"importBatchId":  batch.ID,
			"importId":       batch.ImportID,
			"documentKey":    result.DocumentKey,
			"pickingOrderNo": document.PackingListNo,
			"customer":       document.CustomerName,
			"status":         document.Status,
			"totalLines":     document.TotalLines,
		})
	}
	s.writeAuditLog(c, "COMMIT", "bulk_import_batch", batch.ID, batch.SourceFileName, "Committed retained outbound bulk import batch", map[string]any{
		"createdDocuments": response.CreatedDocuments,
		"failedDocuments":  response.FailedDocuments,
		"retentionWarning": response.RetentionWarning,
	})
	writeJSON(c, http.StatusOK, response)
}
