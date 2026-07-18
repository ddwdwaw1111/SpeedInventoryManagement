package api

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handlePreviewBilling(c *gin.Context) {
	var input service.BillingPreviewInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	preview, err := s.appServices().Billing.Preview(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, preview)
}

func (s *Server) handleGenerateBillingInvoice(c *gin.Context) {
	var input service.GenerateBillingInvoiceInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}
	authPayload, ok := userFromContext(c)
	if !ok {
		writeError(c, http.StatusUnauthorized, "authentication required")
		return
	}

	result, err := s.appServices().Billing.GenerateInvoice(c.Request.Context(), input, authPayload.User.ID)
	if err != nil {
		if errors.Is(err, service.ErrStaleBillingPreview) {
			writeError(c, http.StatusConflict, err.Error())
			return
		}
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "billing_invoice", result.Invoice.ID,
		result.Invoice.InvoiceNo,
		fmt.Sprintf("Generated authoritative billing invoice %s for %s", result.Invoice.InvoiceNo, result.Invoice.CustomerNameSnapshot),
		map[string]any{
			"calculationVersion": result.CalculationVersion,
			"sourceFingerprint":  result.SourceFingerprint,
			"invoiceType":        result.Invoice.InvoiceType,
			"lineCount":          result.Invoice.LineCount,
		})

	writeJSON(c, http.StatusCreated, result.Invoice)
}
