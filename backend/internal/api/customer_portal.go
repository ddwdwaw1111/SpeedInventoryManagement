package api

import (
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
