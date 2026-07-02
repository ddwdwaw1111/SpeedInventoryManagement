package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestV2ContainerMutationRoutesRequireNumericContainerID(t *testing.T) {
	testCases := []struct {
		name   string
		path   string
		method string
	}{
		{
			name:   "tracking event",
			path:   "/v2/containers/CNT-1/tracking-events",
			method: http.MethodPost,
		},
		{
			name:   "pickup assignment",
			path:   "/v2/containers/CNT-1/pickup-assignments",
			method: http.MethodPost,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := &Server{}
			router := gin.New()
			router.POST("/v2/containers/:containerId/tracking-events", server.handleV2CreateContainerTrackingEvent)
			router.POST("/v2/containers/:containerId/pickup-assignments", server.handleV2CreateContainerPickupAssignment)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}"))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d", recorder.Code)
			}
			if !strings.Contains(recorder.Body.String(), "containerId must be a positive number") {
				t.Fatalf("expected numeric container id error, got %s", recorder.Body.String())
			}
		})
	}
}
