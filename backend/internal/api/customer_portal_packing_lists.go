package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

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

	documents, err := s.store.ListInboundDocumentsFiltered(c.Request.Context(), limit, service.InboundDocumentFilters{
		ArchiveScope:    service.DocumentArchiveScopeAll,
		Search:          strings.TrimSpace(c.Query("search")),
		CustomerID:      customerID,
		Status:          strings.TrimSpace(c.Query("status")),
		TrackingStatus:  strings.TrimSpace(c.Query("trackingStatus")),
		OperationalOnly: true,
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, documents)
}

func (s *Server) handleGetCustomerPortalPackingListAttachmentDownloadURL(c *gin.Context) {
	if !s.ensureCustomerPortalPackingList(c) {
		return
	}
	s.handleGetDocumentAttachmentDownloadURL(c, service.DocumentAttachmentInbound)
}
