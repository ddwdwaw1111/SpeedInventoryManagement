package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleCustomerPortalInventory(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	items, err := s.store.ListItems(c.Request.Context(), service.ItemFilters{
		Search:     strings.TrimSpace(c.Query("search")),
		CustomerID: customerID,
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, items)
}

func (s *Server) handleCustomerPortalProfile(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	customer, err := s.store.GetCustomer(c.Request.Context(), customerID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, customer)
}

func (s *Server) handleCustomerPortalPackingLists(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := parsePositiveInt(value, "limit must be a number")
		if err != nil {
			writeError(c, http.StatusBadRequest, err.Error())
			return
		}
		limit = parsed
	}

	documents, err := s.store.ListOutboundDocumentsFiltered(c.Request.Context(), limit, service.OutboundDocumentFilters{
		ArchiveScope:   service.DocumentArchiveScopeAll,
		Search:         strings.TrimSpace(c.Query("search")),
		CustomerID:     customerID,
		Status:         strings.TrimSpace(c.Query("status")),
		TrackingStatus: strings.TrimSpace(c.Query("trackingStatus")),
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, documents)
}

func (s *Server) handleCustomerPortalCreatePackingList(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	var input service.CreateOutboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	input = prepareCustomerPortalPackingListInput(input, customerID)

	items, err := s.store.ListItems(c.Request.Context(), service.ItemFilters{CustomerID: customerID})
	if err != nil {
		writeServerError(c, err)
		return
	}
	if err := validateCustomerPortalPackingListInventory(input, customerID, items); err != nil {
		writeDomainError(c, err)
		return
	}

	document, err := s.store.CreateOutboundDocument(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "customer_portal_packing_list", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Customer created packing list request", map[string]any{
		"customerId":     customerID,
		"packingListNo":  document.PackingListNo,
		"orderRef":       document.OrderRef,
		"trackingStatus": document.TrackingStatus,
		"totalLines":     document.TotalLines,
		"totalQty":       document.TotalQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleUploadCustomerPortalPackingListAttachment(c *gin.Context) {
	if !s.ensureCustomerPortalPackingList(c) {
		return
	}
	s.handleUploadDocumentAttachment(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleGetCustomerPortalPackingListAttachmentDownloadURL(c *gin.Context) {
	if !s.ensureCustomerPortalPackingList(c) {
		return
	}
	s.handleGetDocumentAttachmentDownloadURL(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleDeleteCustomerPortalPackingListAttachment(c *gin.Context) {
	if !s.ensureCustomerPortalPackingList(c) {
		return
	}
	s.handleDeleteDocumentAttachment(c, service.DocumentAttachmentOutbound)
}
