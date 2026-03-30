package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestHandleHealth(t *testing.T) {
	server := &Server{}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/health", nil)

	server.handleHealth(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("could not decode response: %v", err)
	}
	if response["status"] != "ok" {
		t.Fatalf("expected status ok, got %#v", response["status"])
	}
	if _, ok := response["time"].(string); !ok {
		t.Fatalf("expected time field in response, got %#v", response["time"])
	}
}

func TestHandleMe(t *testing.T) {
	t.Run("requires auth context", func(t *testing.T) {
		server := &Server{}
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)

		server.handleMe(context)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected status 401, got %d", recorder.Code)
		}
	})

	t.Run("returns current session", func(t *testing.T) {
		server := &Server{}
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
		context.Set(string(userContextKey), service.AuthPayload{
			User: service.User{
				ID:       7,
				Email:    "admin@example.com",
				FullName: "Admin User",
				Role:     service.RoleAdmin,
			},
			ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		})

		server.handleMe(context)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", recorder.Code)
		}

		var response struct {
			User service.User `json:"user"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("could not decode response: %v", err)
		}
		if response.User.Email != "admin@example.com" {
			t.Fatalf("expected current user email, got %q", response.User.Email)
		}
	})
}

func TestRequireRoles(t *testing.T) {
	newRouter := func(payload service.AuthPayload) *gin.Engine {
		router := gin.New()
		router.Use(func(c *gin.Context) {
			if payload.User.ID > 0 {
				c.Set(string(userContextKey), payload)
			}
			c.Next()
		})
		server := &Server{}
		router.GET("/protected", server.requireRoles(service.RoleAdmin), func(c *gin.Context) {
			c.Status(http.StatusNoContent)
		})
		return router
	}

	testCases := []struct {
		name       string
		payload    service.AuthPayload
		wantStatus int
	}{
		{name: "missing auth", wantStatus: http.StatusUnauthorized},
		{name: "forbidden role", payload: service.AuthPayload{User: service.User{ID: 1, Role: service.RoleViewer}}, wantStatus: http.StatusForbidden},
		{name: "allowed role", payload: service.AuthPayload{User: service.User{ID: 2, Role: service.RoleAdmin}}, wantStatus: http.StatusNoContent},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			router := newRouter(tc.payload)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/protected", nil)

			router.ServeHTTP(recorder, request)

			if recorder.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d", tc.wantStatus, recorder.Code)
			}
		})
	}
}

func TestRequireRolesMatrix(t *testing.T) {
	newRouter := func(payload service.AuthPayload, allowedRoles ...string) *gin.Engine {
		router := gin.New()
		router.Use(func(c *gin.Context) {
			if payload.User.ID > 0 {
				c.Set(string(userContextKey), payload)
			}
			c.Next()
		})
		server := &Server{}
		router.GET("/protected", server.requireRoles(allowedRoles...), func(c *gin.Context) {
			c.Status(http.StatusNoContent)
		})
		return router
	}

	type testCase struct {
		name         string
		allowedRoles []string
		payload      service.AuthPayload
		wantStatus   int
	}

	testCases := []testCase{
		{
			name:         "operator route allows operator",
			allowedRoles: []string{service.RoleAdmin, service.RoleOperator},
			payload:      service.AuthPayload{User: service.User{ID: 1, Role: service.RoleOperator}},
			wantStatus:   http.StatusNoContent,
		},
		{
			name:         "operator route forbids viewer",
			allowedRoles: []string{service.RoleAdmin, service.RoleOperator},
			payload:      service.AuthPayload{User: service.User{ID: 2, Role: service.RoleViewer}},
			wantStatus:   http.StatusForbidden,
		},
		{
			name:         "admin route forbids operator",
			allowedRoles: []string{service.RoleAdmin},
			payload:      service.AuthPayload{User: service.User{ID: 3, Role: service.RoleOperator}},
			wantStatus:   http.StatusForbidden,
		},
		{
			name:         "admin route allows admin",
			allowedRoles: []string{service.RoleAdmin},
			payload:      service.AuthPayload{User: service.User{ID: 4, Role: service.RoleAdmin}},
			wantStatus:   http.StatusNoContent,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			router := newRouter(tc.payload, tc.allowedRoles...)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/protected", nil)
			router.ServeHTTP(recorder, request)

			if recorder.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d", tc.wantStatus, recorder.Code)
			}
		})
	}
}

func TestRequireAuthWithoutCookie(t *testing.T) {
	server := &Server{sessionCookieName: "sim_session"}
	router := gin.New()
	router.GET("/protected", server.requireAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", recorder.Code)
	}
}

func TestMovementWriteRoutesRemoved(t *testing.T) {
	handler := NewHandler(nil, "", "sim_session", false)

	testCases := []struct {
		name   string
		method string
		target string
		body   string
	}{
		{name: "create", method: http.MethodPost, target: "/api/movements", body: "{}"},
		{name: "update", method: http.MethodPut, target: "/api/movements/1", body: "{}"},
		{name: "delete", method: http.MethodDelete, target: "/api/movements/1"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.target, strings.NewReader(tc.body))
			if tc.body != "" {
				request.Header.Set("Content-Type", "application/json")
			}

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusNotFound {
				t.Fatalf("expected status 404, got %d", recorder.Code)
			}
		})
	}
}

func TestDocumentStatusRoutesRequireAuth(t *testing.T) {
	handler := NewHandler(nil, "", "sim_session", false)

	testCases := []struct {
		name   string
		target string
	}{
		{name: "confirm outbound", target: "/api/outbound-documents/1/confirm"},
		{name: "track outbound", target: "/api/outbound-documents/1/tracking-status"},
		{name: "cancel outbound", target: "/api/outbound-documents/1/cancel"},
		{name: "confirm inbound", target: "/api/inbound-documents/1/confirm"},
		{name: "track inbound", target: "/api/inbound-documents/1/tracking-status"},
		{name: "cancel inbound", target: "/api/inbound-documents/1/cancel"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, tc.target, strings.NewReader("{}"))
			request.Header.Set("Content-Type", "application/json")

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("expected status 401, got %d", recorder.Code)
			}
		})
	}
}
