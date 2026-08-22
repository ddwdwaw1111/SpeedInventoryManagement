package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func TestAggregateCustomerPortalInventoryGroupsBySKUAndWarehouse(t *testing.T) {
	items := []service.Item{
		{
			ID: 1, SKUMasterID: 11, SKU: "SKU-A", Description: "Cartons",
			CustomerID: 7, LocationID: 21, LocationName: "NJ",
			Quantity: 4, AvailableQty: 3, AllocatedQty: 1, Pallets: 1,
			ContainerNo: "CONT-1", StorageSection: "A",
		},
		{
			ID: 2, SKUMasterID: 11, SKU: "SKU-A", Description: "Cartons",
			CustomerID: 7, LocationID: 21, LocationName: "NJ",
			Quantity: 6, AvailableQty: 4, AllocatedQty: 2, Pallets: 2,
			ContainerNo: "CONT-2", StorageSection: "B",
		},
		{
			ID: 3, SKUMasterID: 11, SKU: "SKU-A", Description: "Cartons",
			CustomerID: 7, LocationID: 22, LocationName: "PA",
			Quantity: 5, AvailableQty: 5, Pallets: 1,
			ContainerNo: "CONT-3", StorageSection: "C",
		},
	}

	got := aggregateCustomerPortalInventory(items)

	if len(got) != 2 {
		t.Fatalf("expected one row per SKU and warehouse, got %d rows", len(got))
	}
	if got[0].SKU != "SKU-A" || got[0].LocationName != "NJ" {
		t.Fatalf("expected first row to be SKU-A in NJ, got %#v", got[0])
	}
	if got[0].Quantity != 10 || got[0].AvailableQty != 7 {
		t.Fatalf("expected NJ quantities to be aggregated, got %#v", got[0])
	}
	if got[1].LocationName != "PA" || got[1].Quantity != 5 {
		t.Fatalf("expected PA inventory to remain a separate row, got %#v", got[1])
	}

	response, err := json.Marshal(got[0])
	if err != nil {
		t.Fatalf("marshal customer portal inventory: %v", err)
	}
	for _, internalField := range []string{"containerNo", "storageSection", "allocatedQty", "damagedQty", "holdQty"} {
		if strings.Contains(string(response), internalField) {
			t.Fatalf("customer portal inventory leaked internal field %q: %s", internalField, response)
		}
	}
}

func TestCustomerPortalRoutesAreReadOnlyInventoryRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	server := &Server{}
	api := router.Group("/api")

	server.registerCustomerPortalRoutes(api)
	server.registerV2Routes(api)

	want := map[string]bool{
		"/api/customer-portal/profile":                         false,
		"/api/customer-portal/inventory":                       false,
		"/api/admin/customer-portal/customers/:customerId/profile":   false,
		"/api/admin/customer-portal/customers/:customerId/inventory": false,
	}

	for _, route := range router.Routes() {
		if !strings.Contains(route.Path, "/customer-portal") {
			continue
		}
		if route.Method != http.MethodGet {
			t.Fatalf("customer portal must be read-only, found %s %s", route.Method, route.Path)
		}
		if _, expected := want[route.Path]; !expected {
			t.Fatalf("unexpected customer portal route %s %s", route.Method, route.Path)
		}
		want[route.Path] = true
	}

	for path, found := range want {
		if !found {
			t.Fatalf("expected read-only customer portal route %s", path)
		}
	}
}
