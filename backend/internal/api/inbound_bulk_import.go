package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handlePreviewInboundBulkImport(c *gin.Context) {
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
	if fileHeader.Size <= 0 {
		writeError(c, http.StatusBadRequest, "Excel file is empty")
		return
	}
	if fileHeader.Size > service.MaxInboundBulkImportFileSize {
		writeError(c, http.StatusBadRequest, "Excel file exceeds the 10 MB limit")
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
		writeServerError(c, fmt.Errorf("open inbound bulk import: %w", err))
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxInboundBulkImportFileSize+1))
	if err != nil {
		writeServerError(c, fmt.Errorf("read inbound bulk import: %w", err))
		return
	}
	if len(data) > service.MaxInboundBulkImportFileSize {
		writeError(c, http.StatusBadRequest, "Excel file exceeds the 10 MB limit")
		return
	}
	batch, err := s.retainBulkImportFile(c, service.BulkImportTypeInbound, fileHeader.Filename, fileHeader.Header.Get("Content-Type"), data)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	preview, err := s.store.PreviewInboundBulkImport(c.Request.Context(), fileHeader.Filename, data, customerID)
	if err != nil {
		_ = s.store.MarkBulkImportBatchPreview(c.Request.Context(), batch.ImportID, service.BulkImportTypeInbound, customerID, service.BulkImportPreviewSummary{}, err)
		s.writeAuditLog(c, "UPLOAD", "bulk_import_batch", batch.ID, batch.SourceFileName, "Retained inbound bulk import file; preview failed", map[string]any{
			"importType": service.BulkImportTypeInbound,
			"status":     service.BulkImportStatusPreviewFailed,
			"error":      err.Error(),
		})
		writeDomainError(c, err)
		return
	}
	preview.ImportID = batch.ImportID
	preview.ImportBatchID = batch.ID
	if err := s.store.MarkBulkImportBatchPreview(c.Request.Context(), batch.ImportID, service.BulkImportTypeInbound, customerID, service.BulkImportPreviewSummary{
		TotalDocuments: preview.TotalDocuments, ValidDocuments: preview.ValidDocuments,
		InvalidDocuments: preview.InvalidDocuments, TotalLines: preview.TotalLines,
	}, nil); err != nil {
		writeDomainError(c, err)
		return
	}
	s.writeAuditLog(c, "UPLOAD", "bulk_import_batch", batch.ID, batch.SourceFileName, "Retained inbound bulk import file and preview record", map[string]any{
		"importType":       service.BulkImportTypeInbound,
		"totalDocuments":   preview.TotalDocuments,
		"validDocuments":   preview.ValidDocuments,
		"invalidDocuments": preview.InvalidDocuments,
		"totalLines":       preview.TotalLines,
	})
	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleCommitInboundBulkImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxInboundBulkImportCommitBodySize))
	var input service.InboundBulkImportCommitInput
	if err := bindJSON(c, &input); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(c, http.StatusRequestEntityTooLarge, "bulk import request exceeds the 20 MB limit")
			return
		}
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	batch, err := s.store.MarkBulkImportBatchCommitting(c.Request.Context(), input.ImportID, service.BulkImportTypeInbound, input.CustomerID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	input.SourceFileName = batch.SourceFileName
	input.ImportBatchID = batch.ID
	response, err := s.store.CreateInboundDocumentsBulkDraft(c.Request.Context(), input)
	if err != nil {
		_ = s.markBulkImportBatchFailedAfterRequest(c.Request.Context(), input.ImportID, service.BulkImportTypeInbound, input.CustomerID, err)
		writeDomainError(c, err)
		return
	}
	response.ImportBatchID = batch.ID
	records := make([]service.BulkImportCommitRecord, 0, len(response.Results))
	for _, result := range response.Results {
		record := service.BulkImportCommitRecord{
			DocumentKey: result.DocumentKey, ReferenceCode: result.ContainerNo,
			Success: result.Success, ErrorMessage: result.Error,
		}
		if result.Document != nil {
			record.DocumentID = result.Document.ID
		}
		records = append(records, record)
		if !result.Success || result.Document == nil {
			continue
		}
		document := result.Document
		s.writeAuditLog(c, "BULK_IMPORT", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Imported inbound document draft from Excel", map[string]any{
			"sourceFileName": input.SourceFileName,
			"importBatchId":  batch.ID,
			"importId":       batch.ImportID,
			"documentKey":    result.DocumentKey,
			"containerNo":    document.ContainerNo,
			"customer":       document.CustomerName,
			"location":       document.LocationName,
			"status":         document.Status,
			"totalLines":     document.TotalLines,
		})
	}
	finalizationContext, cancelFinalization := newBulkImportFinalizationContext(c.Request.Context())
	err = s.store.CompleteBulkImportBatch(finalizationContext, service.CompleteBulkImportBatchInput{
		ImportID: input.ImportID, ImportType: service.BulkImportTypeInbound, CustomerID: input.CustomerID,
		CreatedDocuments: response.CreatedDocuments, FailedDocuments: response.FailedDocuments, Results: records,
	})
	cancelFinalization()
	if err != nil {
		_ = s.markBulkImportBatchFailedAfterRequest(c.Request.Context(), input.ImportID, service.BulkImportTypeInbound, input.CustomerID, err)
		response.RetentionWarning = "documents were created, but the retained import result could not be finalized: " + err.Error()
	}
	s.writeAuditLog(c, "COMMIT", "bulk_import_batch", batch.ID, batch.SourceFileName, "Committed retained inbound bulk import batch", map[string]any{
		"createdDocuments": response.CreatedDocuments,
		"failedDocuments":  response.FailedDocuments,
		"retentionWarning": response.RetentionWarning,
	})

	writeJSON(c, http.StatusOK, response)
}

func (s *Server) handleRevalidateInboundBulkImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(service.MaxInboundBulkImportCommitBodySize))
	var input service.InboundBulkImportRevalidateInput
	if err := bindJSON(c, &input); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(c, http.StatusRequestEntityTooLarge, "bulk import request exceeds the 20 MB limit")
			return
		}
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	preview, err := s.store.RevalidateInboundBulkImport(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	if err := s.store.MarkBulkImportBatchPreview(c.Request.Context(), input.ImportID, service.BulkImportTypeInbound, input.CustomerID, service.BulkImportPreviewSummary{
		TotalDocuments: preview.TotalDocuments, ValidDocuments: preview.ValidDocuments,
		InvalidDocuments: preview.InvalidDocuments, TotalLines: preview.TotalLines,
	}, nil); err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, preview)
}

func parseInboundBulkImportFormID(c *gin.Context, field string) (int64, error) {
	raw := strings.TrimSpace(c.PostForm(field))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("%s is required", field)
	}
	return id, nil
}
