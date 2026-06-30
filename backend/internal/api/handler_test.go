package api

import (
	"encoding/json"
	"errors"
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
		{
			name:         "customer portal route allows customer",
			allowedRoles: []string{service.RoleCustomer},
			payload:      service.AuthPayload{User: service.User{ID: 5, Role: service.RoleCustomer, CustomerID: 12}},
			wantStatus:   http.StatusNoContent,
		},
		{
			name:         "customer portal route forbids staff viewer",
			allowedRoles: []string{service.RoleCustomer},
			payload:      service.AuthPayload{User: service.User{ID: 6, Role: service.RoleViewer}},
			wantStatus:   http.StatusForbidden,
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

func TestCustomerIDFromContext(t *testing.T) {
	testCases := []struct {
		name       string
		payload    *service.AuthPayload
		wantID     int64
		wantOK     bool
		wantStatus int
	}{
		{name: "missing auth", wantStatus: http.StatusUnauthorized},
		{
			name:       "staff user forbidden",
			payload:    &service.AuthPayload{User: service.User{ID: 1, Role: service.RoleOperator}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "customer without binding forbidden",
			payload:    &service.AuthPayload{User: service.User{ID: 2, Role: service.RoleCustomer}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "bound customer accepted",
			payload:    &service.AuthPayload{User: service.User{ID: 3, Role: service.RoleCustomer, CustomerID: 42}},
			wantID:     42,
			wantOK:     true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "admin scoped customer accepted",
			payload:    &service.AuthPayload{User: service.User{ID: 4, Role: service.RoleAdmin}},
			wantID:     77,
			wantOK:     true,
			wantStatus: http.StatusOK,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/customer-portal/inventory", nil)
			if tc.payload != nil {
				context.Set(string(userContextKey), *tc.payload)
			}
			if tc.name == "admin scoped customer accepted" {
				context.Params = gin.Params{{Key: "customerId", Value: "77"}}
			}

			gotID, gotOK := customerIDFromContext(context)

			if gotID != tc.wantID || gotOK != tc.wantOK {
				t.Fatalf("expected id=%d ok=%t, got id=%d ok=%t", tc.wantID, tc.wantOK, gotID, gotOK)
			}
			if recorder.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d", tc.wantStatus, recorder.Code)
			}
		})
	}
}

func TestPrepareCustomerPortalPickingOrderInputForcesCustomerBoundary(t *testing.T) {
	input := service.CreateOutboundDocumentInput{
		Status:         service.DocumentStatusConfirmed,
		TrackingStatus: service.OutboundTrackingBOReceived,
		ActualShipDate: "2026-03-24",
		Lines: []service.CreateOutboundDocumentLineInput{
			{
				CustomerID:  7,
				LocationID:  2,
				SKUMasterID: 3,
				Quantity:    4,
				PickAllocations: []service.OutboundPickAllocation{
					{LocationID: 2, StorageSection: "A", ContainerNo: "CONT-A", AllocatedQty: 4},
				},
			},
		},
	}

	got := prepareCustomerPortalPickingOrderInput(input, 42)

	if got.Status != service.DocumentStatusDraft {
		t.Fatalf("expected customer portal status to be forced to draft, got %q", got.Status)
	}
	if got.TrackingStatus != service.OutboundTrackingScheduled {
		t.Fatalf("expected customer portal tracking to be scheduled, got %q", got.TrackingStatus)
	}
	if got.ActualShipDate != "" {
		t.Fatalf("expected customer portal actual ship date to be cleared, got %q", got.ActualShipDate)
	}
	if len(got.Lines) != 1 {
		t.Fatalf("expected one line, got %d", len(got.Lines))
	}
	if got.Lines[0].CustomerID != 42 {
		t.Fatalf("expected line customer id to be forced to 42, got %d", got.Lines[0].CustomerID)
	}
	if len(got.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected customer portal pick allocations to be ignored, got %#v", got.Lines[0].PickAllocations)
	}
}

func TestValidateCustomerPortalPickingOrderInventory(t *testing.T) {
	items := []service.Item{
		{CustomerID: 42, SKUMasterID: 3, LocationID: 2, AvailableQty: 4},
		{CustomerID: 42, SKUMasterID: 3, LocationID: 2, AvailableQty: 6},
		{CustomerID: 42, SKUMasterID: 4, LocationID: 2, AvailableQty: 1},
		{CustomerID: 7, SKUMasterID: 3, LocationID: 2, AvailableQty: 99},
	}

	input := service.CreateOutboundDocumentInput{
		Lines: []service.CreateOutboundDocumentLineInput{
			{CustomerID: 42, SKUMasterID: 3, LocationID: 2, Quantity: 4},
			{CustomerID: 42, SKUMasterID: 3, LocationID: 2, Quantity: 5},
			{CustomerID: 42, SKUMasterID: 4, LocationID: 2, Quantity: 1},
		},
	}
	if err := validateCustomerPortalPickingOrderInventory(input, 42, items); err != nil {
		t.Fatalf("expected customer request within available inventory to pass, got %v", err)
	}

	overAvailable := service.CreateOutboundDocumentInput{
		Lines: []service.CreateOutboundDocumentLineInput{
			{CustomerID: 42, SKUMasterID: 3, LocationID: 2, Quantity: 11},
		},
	}
	if err := validateCustomerPortalPickingOrderInventory(overAvailable, 42, items); err == nil || !errors.Is(err, service.ErrInsufficientStock) {
		t.Fatalf("expected ErrInsufficientStock for over-requested inventory, got %v", err)
	}

	otherCustomerStock := service.CreateOutboundDocumentInput{
		Lines: []service.CreateOutboundDocumentLineInput{
			{CustomerID: 42, SKUMasterID: 5, LocationID: 2, Quantity: 1},
		},
	}
	if err := validateCustomerPortalPickingOrderInventory(otherCustomerStock, 42, items); err == nil || !errors.Is(err, service.ErrInsufficientStock) {
		t.Fatalf("expected ErrInsufficientStock for inventory outside the customer boundary, got %v", err)
	}

	wrongCustomerLine := service.CreateOutboundDocumentInput{
		Lines: []service.CreateOutboundDocumentLineInput{
			{CustomerID: 7, SKUMasterID: 3, LocationID: 2, Quantity: 1},
		},
	}
	if err := validateCustomerPortalPickingOrderInventory(wrongCustomerLine, 42, items); err == nil || !errors.Is(err, service.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for a mismatched customer line, got %v", err)
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
