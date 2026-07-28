package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func TestBulkImportFinalizationContextSurvivesRequestCancellation(t *testing.T) {
	requestContext, cancelRequest := context.WithCancel(context.Background())
	cancelRequest()

	finalizationContext, cancelFinalization := newBulkImportFinalizationContext(requestContext)
	defer cancelFinalization()
	if err := finalizationContext.Err(); err != nil {
		t.Fatalf("finalization context inherited request cancellation: %v", err)
	}
	if _, ok := finalizationContext.Deadline(); !ok {
		t.Fatal("finalization context must have a bounded deadline")
	}
}

func TestPreviewInboundBulkImportRejectsOversizedRequestBeforeParsing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{}
	router := gin.New()
	router.POST("/preview", server.handlePreviewInboundBulkImport)

	boundary := "bulk-import-boundary"
	prefix := "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"large.xlsx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
	payload := prefix + strings.Repeat("x", service.MaxInboundBulkImportRequestSize+1) + "\r\n--" + boundary + "--\r\n"
	request := httptest.NewRequest(http.MethodPost, "/preview", strings.NewReader(payload))
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status %d, got %d: %s", http.StatusRequestEntityTooLarge, recorder.Code, recorder.Body.String())
	}
}
