package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) ensureCustomerPortalPickingOrder(c *gin.Context) bool {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return false
	}

	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return false
	}
	if _, err := s.store.GetOutboundDocumentForCustomer(c.Request.Context(), documentID, customerID); err != nil {
		writeDomainError(c, err)
		return false
	}
	return true
}

func (s *Server) ensureCustomerPortalPackingList(c *gin.Context) bool {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return false
	}

	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return false
	}
	if _, err := s.store.GetInboundDocumentForCustomer(c.Request.Context(), documentID, customerID); err != nil {
		writeDomainError(c, err)
		return false
	}
	return true
}

func customerIDFromContext(c *gin.Context) (int64, bool) {
	authPayload, ok := userFromContext(c)
	if !ok {
		writeError(c, http.StatusUnauthorized, "authentication required")
		return 0, false
	}

	switch authPayload.User.Role {
	case service.RoleCustomer:
		if authPayload.User.CustomerID <= 0 {
			writeError(c, http.StatusForbidden, "customer portal access requires a customer account")
			return 0, false
		}
		return authPayload.User.CustomerID, true
	case service.RoleAdmin:
		customerID, err := parseIDParam(c, "customerId")
		if err != nil {
			writeError(c, http.StatusBadRequest, err.Error())
			return 0, false
		}
		return customerID, true
	default:
		writeError(c, http.StatusForbidden, "customer portal access requires a customer account or admin customer scope")
		return 0, false
	}
}

func prepareCustomerPortalPickingOrderInput(input service.CreateOutboundDocumentInput, customerID int64) service.CreateOutboundDocumentInput {
	input.Status = service.DocumentStatusDraft
	input.TrackingStatus = service.OutboundTrackingScheduled
	input.ActualShipDate = ""
	for index := range input.Lines {
		input.Lines[index].CustomerID = customerID
		input.Lines[index].PickAllocations = nil
	}
	return input
}

type customerPortalInventoryKey struct {
	skuMasterID int64
	locationID  int64
}

func validateCustomerPortalPickingOrderInventory(input service.CreateOutboundDocumentInput, customerID int64, items []service.Item) error {
	availableByKey := make(map[customerPortalInventoryKey]int, len(items))
	for _, item := range items {
		if item.CustomerID != customerID {
			continue
		}
		key := customerPortalInventoryKey{skuMasterID: item.SKUMasterID, locationID: item.LocationID}
		availableByKey[key] += item.AvailableQty
	}

	requestedByKey := make(map[customerPortalInventoryKey]int, len(input.Lines))
	for _, line := range input.Lines {
		if line.CustomerID != customerID {
			return fmt.Errorf("%w: customer portal lines must belong to the authenticated customer", service.ErrInvalidInput)
		}
		if line.SKUMasterID <= 0 || line.LocationID <= 0 || line.Quantity <= 0 {
			return fmt.Errorf("%w: customer portal lines require UPC, warehouse, and quantity", service.ErrInvalidInput)
		}
		key := customerPortalInventoryKey{skuMasterID: line.SKUMasterID, locationID: line.LocationID}
		requestedByKey[key] += line.Quantity
	}

	for key, requestedQty := range requestedByKey {
		availableQty := availableByKey[key]
		if availableQty <= 0 {
			return fmt.Errorf("%w: requested inventory is not available for UPC record %d at warehouse %d", service.ErrInsufficientStock, key.skuMasterID, key.locationID)
		}
		if requestedQty > availableQty {
			return fmt.Errorf("%w: requested quantity %d exceeds available inventory %d for UPC record %d at warehouse %d", service.ErrInsufficientStock, requestedQty, availableQty, key.skuMasterID, key.locationID)
		}
	}

	return nil
}

func parsePositiveInt(value string, message string) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, errors.New(message)
	}
	return parsed, nil
}
