package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

type Server struct {
	store               *service.Store
	app                 *service.AppServices
	sessionCookieName   string
	sessionCookieSecure bool
	attachmentStorage   AttachmentStorage
	maxAttachmentBytes  int64
}

type documentTrackingStatusInput struct {
	TrackingStatus string `json:"trackingStatus"`
}

func NewHandler(store *service.Store, frontendOrigin string, sessionCookieName string, sessionCookieSecure bool) http.Handler {
	return NewHandlerWithAttachmentStorage(store, frontendOrigin, sessionCookieName, sessionCookieSecure, nil, 25*1024*1024)
}

func NewHandlerWithAttachmentStorage(
	store *service.Store,
	frontendOrigin string,
	sessionCookieName string,
	sessionCookieSecure bool,
	attachmentStorage AttachmentStorage,
	maxAttachmentBytes int64,
) http.Handler {
	if maxAttachmentBytes <= 0 {
		maxAttachmentBytes = 25 * 1024 * 1024
	}
	server := &Server{
		store:               store,
		app:                 service.NewAppServices(store),
		sessionCookieName:   sessionCookieName,
		sessionCookieSecure: sessionCookieSecure,
		attachmentStorage:   attachmentStorage,
		maxAttachmentBytes:  maxAttachmentBytes,
	}

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), corsMiddleware(frontendOrigin))

	api := router.Group("/api")
	api.GET("/health", server.handleHealth)
	api.POST("/auth/signup", server.handleSignUp)
	api.POST("/auth/login", server.handleLogin)
	api.POST("/auth/logout", server.handleLogout)

	protected := api.Group("")
	protected.Use(server.requireAuth())
	protected.GET("/auth/me", server.handleMe)
	protected.GET("/ui-preferences/:key", server.handleGetUIPreference)

	server.registerStaffRoutes(protected)

	server.registerCustomerPortalRoutes(protected)
	server.registerV2Routes(protected)

	return router
}

func (s *Server) handleHealth(c *gin.Context) {
	writeJSON(c, http.StatusOK, gin.H{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleDashboard(c *gin.Context) {
	dashboard, err := s.store.GetDashboard(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, dashboard)
}

func (s *Server) handleListCustomers(c *gin.Context) {
	customers, err := s.store.ListCustomers(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, customers)
}

func (s *Server) handleCreateCustomer(c *gin.Context) {
	var input service.CreateCustomerInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customer, err := s.store.CreateCustomer(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "customer", customer.ID, customer.Name, "Created customer", map[string]any{
		"name":        customer.Name,
		"contactName": customer.ContactName,
		"email":       customer.Email,
		"phone":       customer.Phone,
	})

	writeJSON(c, http.StatusCreated, customer)
}

func (s *Server) handleUpdateCustomer(c *gin.Context) {
	customerID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateCustomerInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customer, err := s.store.UpdateCustomer(c.Request.Context(), customerID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "customer", customer.ID, customer.Name, "Updated customer", map[string]any{
		"name":        customer.Name,
		"contactName": customer.ContactName,
		"email":       customer.Email,
		"phone":       customer.Phone,
	})

	writeJSON(c, http.StatusOK, customer)
}

func (s *Server) handleDeleteCustomer(c *gin.Context) {
	customerID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteCustomer(c.Request.Context(), customerID); err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "DELETE", "customer", customerID, fmt.Sprintf("customer:%d", customerID), "Deleted customer", nil)

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListLocations(c *gin.Context) {
	locations, err := s.store.ListLocations(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, locations)
}

func (s *Server) handleCreateLocation(c *gin.Context) {
	var input service.CreateLocationInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	location, err := s.store.CreateLocation(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "location", location.ID, location.Name, "Created storage location", map[string]any{
		"name":     location.Name,
		"capacity": location.Capacity,
	})

	writeJSON(c, http.StatusCreated, location)
}

func (s *Server) handleUpdateLocation(c *gin.Context) {
	locationID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateLocationInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	location, err := s.store.UpdateLocation(c.Request.Context(), locationID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "location", location.ID, location.Name, "Updated storage location", map[string]any{
		"name":     location.Name,
		"capacity": location.Capacity,
	})

	writeJSON(c, http.StatusOK, location)
}

func (s *Server) handleDeleteLocation(c *gin.Context) {
	locationID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteLocation(c.Request.Context(), locationID); err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "DELETE", "location", locationID, fmt.Sprintf("location:%d", locationID), "Deleted storage location", nil)

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListSKUMasters(c *gin.Context) {
	skuMasters, err := s.store.ListSKUMasters(c.Request.Context(), c.Query("search"))
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, skuMasters)
}

func (s *Server) handleCreateSKUMaster(c *gin.Context) {
	var input service.CreateSKUMasterInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	skuMaster, err := s.store.CreateSKUMaster(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "sku_master", skuMaster.ID, skuMaster.SKU, "Created SKU master", map[string]any{
		"itemNumber":            skuMaster.ItemNumber,
		"sku":                   skuMaster.SKU,
		"name":                  skuMaster.Name,
		"category":              skuMaster.Category,
		"reorderLevel":          skuMaster.ReorderLevel,
		"defaultUnitsPerPallet": skuMaster.DefaultUnitsPerPallet,
		"unit":                  skuMaster.Unit,
	})

	writeJSON(c, http.StatusCreated, skuMaster)
}

func (s *Server) handleUpdateSKUMaster(c *gin.Context) {
	skuMasterID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateSKUMasterInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	skuMaster, err := s.store.UpdateSKUMaster(c.Request.Context(), skuMasterID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "sku_master", skuMaster.ID, skuMaster.SKU, "Updated SKU master", map[string]any{
		"itemNumber":            skuMaster.ItemNumber,
		"sku":                   skuMaster.SKU,
		"name":                  skuMaster.Name,
		"category":              skuMaster.Category,
		"reorderLevel":          skuMaster.ReorderLevel,
		"defaultUnitsPerPallet": skuMaster.DefaultUnitsPerPallet,
		"unit":                  skuMaster.Unit,
	})

	writeJSON(c, http.StatusOK, skuMaster)
}

func (s *Server) handleDeleteSKUMaster(c *gin.Context) {
	skuMasterID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteSKUMaster(c.Request.Context(), skuMasterID); err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "DELETE", "sku_master", skuMasterID, fmt.Sprintf("sku_master:%d", skuMasterID), "Deleted SKU master", nil)

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListItems(c *gin.Context) {
	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	items, err := s.store.ListItems(c.Request.Context(), service.ItemFilters{
		Search:       c.Query("search"),
		LocationID:   locationID,
		CustomerID:   customerID,
		ContainerNo:  c.Query("containerNo"),
		LowStockOnly: strings.EqualFold(c.Query("lowStock"), "true"),
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, items)
}

func (s *Server) handleListMovements(c *gin.Context) {
	limit := 12
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	movements, err := s.store.ListMovements(c.Request.Context(), limit, service.MovementFilters{
		Search:       c.Query("search"),
		CustomerID:   customerID,
		LocationID:   locationID,
		MovementType: c.Query("movementType"),
		StartDate:    c.Query("startDate"),
		EndDate:      c.Query("endDate"),
		StartAt:      c.Query("startAt"),
		EndBefore:    c.Query("endBefore"),
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, movements)
}

func (s *Server) handleOperationsReport(c *gin.Context) {
	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	report, err := s.store.GetOperationsReport(c.Request.Context(), service.OperationsReportFilters{
		StartDate:   c.Query("startDate"),
		EndDate:     c.Query("endDate"),
		CustomerID:  customerID,
		LocationID:  locationID,
		Search:      c.Query("search"),
		Granularity: c.Query("granularity"),
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, report)
}

func (s *Server) handleSKUFlowReport(c *gin.Context) {
	skuMasterID, err := parseOptionalInt64Query(c, "skuMasterId", "skuMasterId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	report, err := s.store.GetSKUFlowReport(c.Request.Context(), service.SKUFlowReportFilters{
		StartDate:   c.Query("startDate"),
		EndDate:     c.Query("endDate"),
		SKUMasterID: skuMasterID,
		CustomerID:  customerID,
		LocationID:  locationID,
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, report)
}

func (s *Server) handleListContainerLifecycleEvents(c *gin.Context) {
	limit := 2000
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	events, err := s.store.ListContainerLifecycleEvents(c.Request.Context(), limit, service.ContainerLifecycleEventFilters{
		CustomerID:  customerID,
		ContainerNo: c.Query("containerNo"),
	})
	if err != nil {
		writeServerError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, events)
}

func (s *Server) handleListOutboundDocuments(c *gin.Context) {
	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	documents, err := s.store.ListOutboundDocumentsFiltered(c.Request.Context(), limit, service.OutboundDocumentFilters{
		ArchiveScope:   strings.TrimSpace(c.Query("archiveScope")),
		Search:         strings.TrimSpace(c.Query("search")),
		CustomerID:     customerID,
		LocationID:     locationID,
		Status:         strings.TrimSpace(c.Query("status")),
		TrackingStatus: strings.TrimSpace(c.Query("trackingStatus")),
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, documents)
}

func (s *Server) handleCreateOutboundDocument(c *gin.Context) {
	var input service.CreateOutboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.appServices().LegacyDocuments.CreateOutboundDocument(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Created outbound document", map[string]any{
		"packingListNo": document.PackingListNo,
		"customer":      document.CustomerName,
		"status":        document.Status,
		"shipToName":    document.ShipToName,
		"carrierName":   document.CarrierName,
		"totalLines":    document.TotalLines,
		"totalQty":      document.TotalQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleUpdateOutboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateOutboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateOutboundDocument(c.Request.Context(), documentID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Updated outbound draft", map[string]any{
		"packingListNo": document.PackingListNo,
		"customer":      document.CustomerName,
		"status":        document.Status,
		"shipToName":    document.ShipToName,
		"carrierName":   document.CarrierName,
		"totalLines":    document.TotalLines,
		"totalQty":      document.TotalQty,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleUpdateOutboundDocumentNote(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.UpdateOutboundDocumentNoteInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateOutboundDocumentNote(c.Request.Context(), documentID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "ANNOTATE", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Updated outbound document note", map[string]any{
		"packingListNo": document.PackingListNo,
		"status":        document.Status,
		"documentNote":  document.DocumentNote,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleConfirmOutboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.ConfirmOutboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CONFIRM", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Confirmed outbound document", map[string]any{
		"packingListNo": document.PackingListNo,
		"status":        document.Status,
		"confirmedAt":   document.ConfirmedAt,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleUpdateOutboundDocumentTrackingStatus(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input documentTrackingStatusInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateOutboundDocumentTrackingStatus(c.Request.Context(), documentID, input.TrackingStatus)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "TRACK", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Updated outbound tracking status", map[string]any{
		"packingListNo":  document.PackingListNo,
		"status":         document.Status,
		"trackingStatus": document.TrackingStatus,
		"confirmedAt":    document.ConfirmedAt,
		"cancelledAt":    document.DeletedAt,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleCancelOutboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	attachments, err := s.store.ListDocumentAttachments(c.Request.Context(), service.DocumentAttachmentOutbound, documentID)
	if err != nil {
		writeServerError(c, err)
		return
	}

	document, err := s.store.CancelOutboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	s.deleteDocumentAttachmentObjectsAfterCancel(service.DocumentAttachmentOutbound, documentID, attachments)

	s.writeAuditLog(c, "DELETE", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Deleted outbound document and all related records", map[string]any{
		"packingListNo": document.PackingListNo,
	})

	c.Status(http.StatusNoContent)
}

func (s *Server) handleArchiveOutboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.ArchiveOutboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "ARCHIVE", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Archived outbound document", map[string]any{
		"packingListNo": document.PackingListNo,
		"status":        document.Status,
		"archivedAt":    document.ArchivedAt,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleCopyOutboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.CopyOutboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "COPY", "outbound_document", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Copied outbound document into draft", map[string]any{
		"sourceDocumentId": documentID,
		"packingListNo":    document.PackingListNo,
		"status":           document.Status,
		"trackingStatus":   document.TrackingStatus,
		"totalLines":       document.TotalLines,
		"totalQty":         document.TotalQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleListInboundDocuments(c *gin.Context) {
	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	documents, err := s.store.ListInboundDocumentsFiltered(c.Request.Context(), limit, service.InboundDocumentFilters{
		ArchiveScope:   strings.TrimSpace(c.Query("archiveScope")),
		Search:         strings.TrimSpace(c.Query("search")),
		CustomerID:     customerID,
		LocationID:     locationID,
		Status:         strings.TrimSpace(c.Query("status")),
		TrackingStatus: strings.TrimSpace(c.Query("trackingStatus")),
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, documents)
}

func (s *Server) handleCreateInboundDocument(c *gin.Context) {
	var input service.CreateInboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.appServices().LegacyDocuments.CreateInboundDocument(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Created inbound document", map[string]any{
		"containerNo":   document.ContainerNo,
		"customer":      document.CustomerName,
		"location":      document.LocationName,
		"status":        document.Status,
		"totalLines":    document.TotalLines,
		"totalReceived": document.TotalReceivedQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleImportInboundDocumentPreview(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		writeError(c, http.StatusBadRequest, "file is required")
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		writeServerError(c, fmt.Errorf("open import file: %w", err))
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeServerError(c, fmt.Errorf("read import file: %w", err))
		return
	}

	preview, err := s.store.ImportInboundPackingListPreview(c.Request.Context(), fileHeader.Filename, data)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleUpdateInboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateInboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateInboundDocument(c.Request.Context(), documentID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	auditAction := "UPDATE"
	auditMessage := "Updated inbound document"
	if document.CorrectsDocumentID != nil && strings.EqualFold(document.Status, service.DocumentStatusConfirmed) {
		auditAction = "CONFIRM_CORRECTION"
		auditMessage = "Confirmed inbound correction and reversed source receipt"
	}
	s.writeAuditLog(c, auditAction, "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), auditMessage, map[string]any{
		"containerNo":        document.ContainerNo,
		"customer":           document.CustomerName,
		"location":           document.LocationName,
		"status":             document.Status,
		"totalLines":         document.TotalLines,
		"totalReceived":      document.TotalReceivedQty,
		"correctsDocumentId": document.CorrectsDocumentID,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleUpdateInboundDocumentNote(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.UpdateInboundDocumentNoteInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateInboundDocumentNote(c.Request.Context(), documentID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "ANNOTATE", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Updated inbound document note", map[string]any{
		"containerNo":    document.ContainerNo,
		"status":         document.Status,
		"documentNote":   document.DocumentNote,
		"trackingStatus": document.TrackingStatus,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleUpdateInboundDocumentContainerType(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.UpdateInboundDocumentContainerTypeInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateInboundDocumentContainerType(c.Request.Context(), documentID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CLASSIFY", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Updated inbound container type", map[string]any{
		"containerNo":   document.ContainerNo,
		"containerType": document.ContainerType,
		"status":        document.Status,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleConfirmInboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.ConfirmInboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	auditAction := "CONFIRM"
	auditMessage := "Confirmed inbound document"
	if document.CorrectsDocumentID != nil {
		auditAction = "CONFIRM_CORRECTION"
		auditMessage = "Confirmed inbound correction and reversed source receipt"
	}
	s.writeAuditLog(c, auditAction, "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), auditMessage, map[string]any{
		"containerNo":        document.ContainerNo,
		"status":             document.Status,
		"confirmedAt":        document.ConfirmedAt,
		"totalLines":         document.TotalLines,
		"totalExpected":      document.TotalExpectedQty,
		"correctsDocumentId": document.CorrectsDocumentID,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleBulkUpdateInboundDocumentStatus(c *gin.Context) {
	var input service.BulkUpdateInboundDocumentStatusInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	attachmentsByDocumentID := make(map[int64][]service.DocumentAttachment)
	requestedStatus := strings.TrimSpace(strings.ToUpper(input.Status))
	if (requestedStatus == service.DocumentStatusDeleted || requestedStatus == "CANCELLED") && len(input.DocumentIDs) <= service.MaxBulkUpdateInboundDocuments {
		for _, documentID := range input.DocumentIDs {
			attachments, err := s.store.ListDocumentAttachments(c.Request.Context(), service.DocumentAttachmentInbound, documentID)
			if err != nil {
				writeServerError(c, err)
				return
			}
			attachmentsByDocumentID[documentID] = attachments
		}
	}

	response, err := s.store.BulkUpdateInboundDocumentStatus(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	for _, document := range response.Documents {
		s.writeAuditLog(c, "STATUS_CHANGE", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Bulk updated inbound document status", map[string]any{
			"containerNo": document.ContainerNo,
			"status":      document.Status,
			"confirmedAt": document.ConfirmedAt,
			"batchSize":   response.UpdatedDocuments,
		})
		if response.Status == service.DocumentStatusDeleted {
			s.deleteDocumentAttachmentObjectsAfterCancel(service.DocumentAttachmentInbound, document.ID, attachmentsByDocumentID[document.ID])
		}
	}

	writeJSON(c, http.StatusOK, response)
}

func (s *Server) handleCancelInboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	attachments, err := s.store.ListDocumentAttachments(c.Request.Context(), service.DocumentAttachmentInbound, documentID)
	if err != nil {
		writeServerError(c, err)
		return
	}

	document, err := s.store.CancelInboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	s.deleteDocumentAttachmentObjectsAfterCancel(service.DocumentAttachmentInbound, documentID, attachments)

	s.writeAuditLog(c, "DELETE", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Deleted inbound document and all related records", map[string]any{
		"containerNo": document.ContainerNo,
	})

	c.Status(http.StatusNoContent)
}

func (s *Server) handleArchiveInboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.ArchiveInboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "ARCHIVE", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Archived inbound document", map[string]any{
		"containerNo": document.ContainerNo,
		"status":      document.Status,
		"archivedAt":  document.ArchivedAt,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleCopyInboundDocument(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.CopyInboundDocument(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "COPY", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Copied inbound document into draft", map[string]any{
		"sourceDocumentId": documentID,
		"containerNo":      document.ContainerNo,
		"status":           document.Status,
		"trackingStatus":   document.TrackingStatus,
		"totalLines":       document.TotalLines,
		"totalExpected":    document.TotalExpectedQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleCreateInboundCorrectionDraft(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.CreateInboundCorrectionDraft(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CORRECT", "inbound_document", documentID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", documentID)), "Created inbound correction draft", map[string]any{
		"sourceDocumentId":     documentID,
		"correctionDocumentId": document.ID,
		"containerNo":          document.ContainerNo,
		"status":               document.Status,
		"totalLines":           document.TotalLines,
		"totalReceived":        document.TotalReceivedQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleUpdateInboundDocumentTrackingStatus(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input documentTrackingStatusInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	document, err := s.store.UpdateInboundDocumentTrackingStatus(c.Request.Context(), documentID, input.TrackingStatus)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "TRACK", "inbound_document", document.ID, firstNonEmptyString(document.ContainerNo, fmt.Sprintf("inbound:%d", document.ID)), "Updated inbound tracking status", map[string]any{
		"containerNo":    document.ContainerNo,
		"status":         document.Status,
		"trackingStatus": document.TrackingStatus,
		"confirmedAt":    document.ConfirmedAt,
		"cancelledAt":    document.DeletedAt,
	})

	writeJSON(c, http.StatusOK, document)
}

func (s *Server) handleListInventoryAdjustments(c *gin.Context) {
	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	adjustments, err := s.store.ListInventoryAdjustments(c.Request.Context(), limit)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, adjustments)
}

func (s *Server) handleCreateInventoryAdjustment(c *gin.Context) {
	var input service.CreateInventoryAdjustmentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	adjustment, err := s.appServices().LegacyInventory.CreateAdjustment(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "inventory_adjustment", adjustment.ID, adjustment.AdjustmentNo, "Created inventory adjustment", map[string]any{
		"reasonCode":     adjustment.ReasonCode,
		"totalLines":     adjustment.TotalLines,
		"totalAdjustQty": adjustment.TotalAdjustQty,
	})

	writeJSON(c, http.StatusCreated, adjustment)
}

func (s *Server) handleListInventoryTransfers(c *gin.Context) {
	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	transfers, err := s.store.ListInventoryTransfers(c.Request.Context(), limit)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, transfers)
}

func (s *Server) handleCreateInventoryTransfer(c *gin.Context) {
	var input service.CreateInventoryTransferInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	transfer, err := s.appServices().LegacyInventory.CreateTransfer(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "inventory_transfer", transfer.ID, transfer.TransferNo, "Created inventory transfer", map[string]any{
		"totalLines": transfer.TotalLines,
		"totalQty":   transfer.TotalQty,
		"routes":     transfer.Routes,
	})

	writeJSON(c, http.StatusCreated, transfer)
}

func (s *Server) handleListCycleCounts(c *gin.Context) {
	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	cycleCounts, err := s.store.ListCycleCounts(c.Request.Context(), limit)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, cycleCounts)
}

func (s *Server) handleCreateCycleCount(c *gin.Context) {
	var input service.CreateCycleCountInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	cycleCount, err := s.store.CreateCycleCount(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "cycle_count", cycleCount.ID, cycleCount.CountNo, "Created cycle count", map[string]any{
		"totalLines":    cycleCount.TotalLines,
		"totalVariance": cycleCount.TotalVariance,
	})

	writeJSON(c, http.StatusCreated, cycleCount)
}

func (s *Server) handleListAuditLogs(c *gin.Context) {
	limit := 200
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	logs, err := s.store.ListAuditLogs(c.Request.Context(), limit)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, logs)
}

func (s *Server) writeAuditLog(c *gin.Context, action string, entityType string, entityID int64, targetLabel string, summary string, details any) {
	authPayload, ok := userFromContext(c)
	if !ok {
		return
	}

	_ = s.store.CreateAuditLog(c.Request.Context(), service.CreateAuditLogInput{
		ActorUserID:   authPayload.User.ID,
		ActorEmail:    authPayload.User.Email,
		ActorName:     authPayload.User.FullName,
		ActorRole:     authPayload.User.Role,
		Action:        action,
		EntityType:    entityType,
		EntityID:      entityID,
		TargetLabel:   targetLabel,
		Summary:       summary,
		RequestMethod: c.Request.Method,
		RequestPath:   c.FullPath(),
		Details:       details,
	})
}

// --- Billing Invoice Handlers ---

func (s *Server) handleListBillingInvoices(c *gin.Context) {
	customerID, err := parseOptionalInt64Query(c, "customerId", "invalid customer id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	status := strings.TrimSpace(c.Query("status"))
	invoiceType := strings.TrimSpace(c.Query("invoiceType"))

	invoices, err := s.store.ListBillingInvoices(c.Request.Context(), customerID, status, invoiceType)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoices)
}

func (s *Server) handleGetBillingInvoice(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	invoice, err := s.store.GetBillingInvoice(c.Request.Context(), id)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleCreateBillingInvoice(c *gin.Context) {
	var input service.CreateBillingInvoiceInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	authPayload, _ := userFromContext(c)

	invoice, err := s.store.CreateBillingInvoice(c.Request.Context(), input, authPayload.User.ID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "billing_invoice", invoice.ID,
		invoice.InvoiceNo,
		fmt.Sprintf("Created billing invoice %s for %s", invoice.InvoiceNo, invoice.CustomerNameSnapshot),
		nil)

	writeJSON(c, http.StatusCreated, invoice)
}

func (s *Server) handleUpdateBillingInvoice(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.UpdateBillingInvoiceInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	invoice, err := s.store.UpdateBillingInvoice(c.Request.Context(), id, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleAddBillingInvoiceLine(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.AddBillingInvoiceLineInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	invoice, err := s.store.AddBillingInvoiceLine(c.Request.Context(), id, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleUpdateBillingInvoiceLine(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	lineID, err := parseIDParam(c, "lineId")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.UpdateBillingInvoiceLineInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	invoice, err := s.store.UpdateBillingInvoiceLine(c.Request.Context(), id, lineID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleDeleteBillingInvoiceLine(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	lineID, err := parseIDParam(c, "lineId")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	invoice, err := s.store.DeleteBillingInvoiceLine(c.Request.Context(), id, lineID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleFinalizeBillingInvoice(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, _ := userFromContext(c)

	invoice, err := s.store.FinalizeBillingInvoice(c.Request.Context(), id, authPayload.User.ID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "FINALIZE", "billing_invoice", invoice.ID,
		invoice.InvoiceNo,
		fmt.Sprintf("Finalized billing invoice %s (grand total: %.2f)", invoice.InvoiceNo, invoice.GrandTotal),
		nil)

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleMarkBillingInvoicePaid(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	invoice, err := s.store.MarkBillingInvoicePaid(c.Request.Context(), id)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "MARK_PAID", "billing_invoice", invoice.ID,
		invoice.InvoiceNo,
		fmt.Sprintf("Marked billing invoice %s as paid", invoice.InvoiceNo),
		nil)

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleVoidBillingInvoice(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	invoice, err := s.store.VoidBillingInvoice(c.Request.Context(), id)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "VOID", "billing_invoice", invoice.ID,
		invoice.InvoiceNo,
		fmt.Sprintf("Voided billing invoice %s", invoice.InvoiceNo),
		nil)

	writeJSON(c, http.StatusOK, invoice)
}

func (s *Server) handleDeleteBillingInvoice(c *gin.Context) {
	id, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	// Fetch for audit log before deleting
	invoice, err := s.store.GetBillingInvoice(c.Request.Context(), id)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	if err := s.store.DeleteBillingInvoice(c.Request.Context(), id); err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "DELETE", "billing_invoice", invoice.ID,
		invoice.InvoiceNo,
		fmt.Sprintf("Deleted draft billing invoice %s", invoice.InvoiceNo),
		nil)

	writeJSON(c, http.StatusOK, gin.H{"ok": true})
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func bindJSON(c *gin.Context, destination any) error {
	defer c.Request.Body.Close()

	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(destination); err != nil {
		return err
	}

	return nil
}

func parseIDParam(c *gin.Context, key string) (int64, error) {
	value := strings.TrimSpace(c.Param(key))
	if value == "" {
		return 0, errors.New("invalid resource id")
	}

	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid resource id")
	}

	return id, nil
}

func parseOptionalInt64Query(c *gin.Context, key string, message string) (int64, error) {
	value := strings.TrimSpace(c.Query(key))
	if value == "" {
		return 0, nil
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, errors.New(message)
	}

	return parsed, nil
}

func corsMiddleware(frontendOrigin string) gin.HandlerFunc {
	allowedOrigin := strings.TrimSpace(frontendOrigin)

	return func(c *gin.Context) {
		origin := allowedOrigin
		if origin == "" {
			origin = c.GetHeader("Origin")
			if origin == "" {
				origin = "*"
			}
		}

		headers := c.Writer.Header()
		headers.Set("Access-Control-Allow-Origin", origin)
		headers.Set("Access-Control-Allow-Headers", "Content-Type")
		headers.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		headers.Set("Access-Control-Allow-Credentials", "true")
		if origin != "*" {
			headers.Add("Vary", "Origin")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func writeJSON(c *gin.Context, statusCode int, payload any) {
	c.JSON(statusCode, payload)
}

func writeError(c *gin.Context, statusCode int, message string) {
	writeJSON(c, statusCode, gin.H{"error": message})
}

func writeDomainError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeError(c, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrInvalidInput):
		writeError(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrReservedStock):
		writeError(c, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrInsufficientStock):
		writeError(c, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrNotImplemented):
		writeError(c, http.StatusNotImplemented, err.Error())
	default:
		writeServerError(c, err)
	}
}

func writeServerError(c *gin.Context, err error) {
	writeError(c, http.StatusInternalServerError, err.Error())
}
