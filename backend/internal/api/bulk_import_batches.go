package api

import (
	"context"
	"fmt"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

const bulkImportFinalizationTimeout = 5 * time.Second

func newBulkImportFinalizationContext(requestContext context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(requestContext), bulkImportFinalizationTimeout)
}

func (s *Server) markBulkImportBatchFailedAfterRequest(
	requestContext context.Context,
	importID string,
	importType string,
	customerID int64,
	cause error,
) error {
	ctx, cancel := newBulkImportFinalizationContext(requestContext)
	defer cancel()
	return s.store.MarkBulkImportBatchFailed(ctx, importID, importType, customerID, cause)
}

func (s *Server) retainBulkImportFile(c *gin.Context, importType string, fileName string, contentType string, data []byte) (service.BulkImportBatch, error) {
	authPayload, ok := userFromContext(c)
	if !ok {
		return service.BulkImportBatch{}, fmt.Errorf("%w: importing user is required", service.ErrInvalidInput)
	}
	customerID, err := parseInboundBulkImportFormID(c, "customerId")
	if err != nil {
		return service.BulkImportBatch{}, fmt.Errorf("%w: %s", service.ErrInvalidInput, err.Error())
	}
	return s.store.CreateBulkImportBatch(c.Request.Context(), service.CreateBulkImportBatchInput{
		ImportType:      importType,
		CustomerID:      customerID,
		SourceFileName:  fileName,
		ContentType:     contentType,
		Data:            data,
		CreatedByUserID: authPayload.User.ID,
		CreatedByName:   authPayload.User.FullName,
		CreatedByEmail:  authPayload.User.Email,
	})
}

func (s *Server) handleListBulkImportBatches(c *gin.Context) {
	limit, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("limit", "100")))
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid bulk import history limit")
		return
	}
	customerID, err := parseOptionalInt64Query(c, "customerId", "invalid customer id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	beforeID, err := parseOptionalInt64Query(c, "beforeId", "invalid bulk import history cursor")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	batches, err := s.store.ListBulkImportBatches(c.Request.Context(), c.Query("importType"), customerID, beforeID, limit)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, batches)
}

func (s *Server) handleDownloadBulkImportBatchFile(c *gin.Context) {
	batchID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	file, err := s.store.GetBulkImportBatchFile(c.Request.Context(), batchID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": file.SourceFileName})
	if disposition == "" {
		disposition = `attachment; filename="bulk-import.xlsx"`
	}
	c.Header("Content-Disposition", disposition)
	c.Header("Cache-Control", "private, no-store")
	c.Data(http.StatusOK, file.ContentType, file.Data)
}
