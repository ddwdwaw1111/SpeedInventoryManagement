package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleGetBillingInvoiceSettings(c *gin.Context) {
	settings, err := s.store.GetBillingInvoiceSettings(c.Request.Context())
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, settings)
}

func (s *Server) handleUpdateBillingInvoiceSettings(c *gin.Context) {
	var input service.UpdateBillingInvoiceSettingsInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	authPayload, ok := userFromContext(c)
	if !ok {
		writeError(c, http.StatusUnauthorized, "authentication required")
		return
	}

	settings, err := s.store.UpdateBillingInvoiceSettings(c.Request.Context(), input, authPayload.User.ID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "billing_invoice_settings", settings.ID, "billing_invoice_settings", "Updated billing invoice settings", map[string]any{
		"header": settings.Header,
	})

	writeJSON(c, http.StatusOK, settings)
}
