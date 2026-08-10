package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleCustomerPortalPickingOrders(c *gin.Context) {
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

func (s *Server) handleCustomerPortalCreatePickingOrder(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	var input service.CreateOutboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	input = prepareCustomerPortalPickingOrderInput(input, customerID)

	items, err := s.store.ListItems(c.Request.Context(), service.ItemFilters{CustomerID: customerID})
	if err != nil {
		writeServerError(c, err)
		return
	}
	if err := validateCustomerPortalPickingOrderInventory(input, customerID, items); err != nil {
		writeDomainError(c, err)
		return
	}

	document, err := s.store.CreateOutboundDocument(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "customer_portal_picking_order", document.ID, firstNonEmptyString(document.PackingListNo, fmt.Sprintf("outbound:%d", document.ID)), "Customer created picking order", map[string]any{
		"customerId":     customerID,
		"packingListNo":  document.PackingListNo,
		"orderRef":       document.OrderRef,
		"trackingStatus": document.TrackingStatus,
		"totalLines":     document.TotalLines,
		"totalQty":       document.TotalQty,
	})

	writeJSON(c, http.StatusCreated, document)
}

func (s *Server) handleUploadCustomerPortalPickingOrderAttachment(c *gin.Context) {
	if !s.ensureCustomerPortalPickingOrder(c) {
		return
	}
	s.handleUploadDocumentAttachment(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleGetCustomerPortalPickingOrderAttachmentDownloadURL(c *gin.Context) {
	if !s.ensureCustomerPortalPickingOrder(c) {
		return
	}
	s.handleGetDocumentAttachmentDownloadURL(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleDeleteCustomerPortalPickingOrderAttachment(c *gin.Context) {
	if !s.ensureCustomerPortalPickingOrder(c) {
		return
	}
	s.handleDeleteDocumentAttachment(c, service.DocumentAttachmentOutbound)
}
