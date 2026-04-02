package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleListCustomerRateCards(c *gin.Context) {
	rateCards, err := s.store.ListCustomerRateCards(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, rateCards)
}

func (s *Server) handleUpsertCustomerRateCard(c *gin.Context) {
	customerID, err := parseIDParam(c, "customerId")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.UpsertCustomerRateCardInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	rateCard, err := s.store.UpsertCustomerRateCard(c.Request.Context(), customerID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "customer_rate_card", customerID, rateCard.CustomerName, "Updated customer billing rate card", map[string]any{
		"inboundContainerFee":     rateCard.InboundContainerFee,
		"wrappingFeePerPallet":    rateCard.WrappingFeePerPallet,
		"storageFeePerPalletWeek": rateCard.StorageFeePerPalletWeek,
		"outboundFeePerPallet":    rateCard.OutboundFeePerPallet,
	})

	writeJSON(c, http.StatusOK, rateCard)
}

func (s *Server) handleListBillingInvoices(c *gin.Context) {
	billingMonth := strings.TrimSpace(c.Query("billingMonth"))
	invoices, err := s.store.ListBillingInvoices(c.Request.Context(), billingMonth)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, invoices)
}

func (s *Server) handleGenerateBillingInvoices(c *gin.Context) {
	var input service.GenerateBillingInvoicesInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	invoices, err := s.store.GenerateBillingInvoices(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	totalAmount := 0.0
	for _, invoice := range invoices {
		totalAmount += invoice.TotalAmount
	}

	s.writeAuditLog(c, "GENERATE", "billing_invoice", 0, input.BillingMonth, "Generated monthly billing invoices", map[string]any{
		"billingMonth":   input.BillingMonth,
		"customerId":     input.CustomerID,
		"invoiceCount":   len(invoices),
		"totalGenerated": totalAmount,
	})

	writeJSON(c, http.StatusOK, invoices)
}
