package api

import (
	"net/http"
	"sort"
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

	writeJSON(c, http.StatusOK, aggregateCustomerPortalInventory(items))
}

type customerPortalInventoryGroupKey struct {
	skuMasterID int64
	locationID  int64
}

type customerPortalInventoryItem struct {
	ID           int64  `json:"id"`
	SKUMasterID  int64  `json:"skuMasterId"`
	ItemNumber   string `json:"itemNumber"`
	SKU          string `json:"sku"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Unit         string `json:"unit"`
	Quantity     int    `json:"quantity"`
	AvailableQty int    `json:"availableQty"`
	LocationID   int64  `json:"locationId"`
	LocationName string `json:"locationName"`
}

func aggregateCustomerPortalInventory(items []service.Item) []customerPortalInventoryItem {
	grouped := make(map[customerPortalInventoryGroupKey]customerPortalInventoryItem, len(items))
	for _, item := range items {
		key := customerPortalInventoryGroupKey{skuMasterID: item.SKUMasterID, locationID: item.LocationID}
		if current, exists := grouped[key]; exists {
			current.Quantity += item.Quantity
			current.AvailableQty += item.AvailableQty
			grouped[key] = current
			continue
		}

		grouped[key] = customerPortalInventoryItem{
			ID:           item.ID,
			SKUMasterID:  item.SKUMasterID,
			ItemNumber:   item.ItemNumber,
			SKU:          item.SKU,
			Name:         item.Name,
			Description:  item.Description,
			Unit:         item.Unit,
			Quantity:     item.Quantity,
			AvailableQty: item.AvailableQty,
			LocationID:   item.LocationID,
			LocationName: item.LocationName,
		}
	}

	result := make([]customerPortalInventoryItem, 0, len(grouped))
	for _, item := range grouped {
		result = append(result, item)
	}
	sort.Slice(result, func(left, right int) bool {
		if result[left].SKU == result[right].SKU {
			return result[left].LocationName < result[right].LocationName
		}
		return result[left].SKU < result[right].SKU
	})
	return result
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
