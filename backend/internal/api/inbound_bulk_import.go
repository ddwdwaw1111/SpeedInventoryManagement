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

	preview, err := s.store.PreviewInboundBulkImport(c.Request.Context(), fileHeader.Filename, data, customerID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
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

	response, err := s.store.CreateInboundDocumentsBulkDraft(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	for _, result := range response.Results {
		if !result.Success || result.Document == nil {
			continue
		}
		document := result.Document
		s.writeAuditLog(c, "BULK_IMPORT", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Imported inbound document draft from Excel", map[string]any{
			"sourceFileName": input.SourceFileName,
			"documentKey":    result.DocumentKey,
			"containerNo":    document.ContainerNo,
			"customer":       document.CustomerName,
			"location":       document.LocationName,
			"status":         document.Status,
			"totalLines":     document.TotalLines,
		})
	}

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
