package service

import (
	"context"
	"database/sql"
	"testing"
)

func TestResolveContainerInventoryStatus(t *testing.T) {
	tests := []struct {
		name                     string
		hasActiveInventory       bool
		netOutboundQuantityDelta int64
		netOutboundPalletDelta   float64
		want                     string
	}{
		{name: "available inventory", hasActiveInventory: true, want: ContainerStatusInStock},
		{name: "partially shipped quantity", hasActiveInventory: true, netOutboundQuantityDelta: -1, want: ContainerStatusPartiallyOutbound},
		{name: "partially shipped pallets", hasActiveInventory: true, netOutboundPalletDelta: -1, want: ContainerStatusPartiallyOutbound},
		{name: "fully shipped quantity", netOutboundQuantityDelta: -1, want: ContainerStatusShipped},
		{name: "fully shipped pallets", netOutboundPalletDelta: -1, want: ContainerStatusShipped},
		{name: "depleted without outbound", want: ContainerStatusDepleted},
		{name: "fully reversed outbound", hasActiveInventory: true, want: ContainerStatusInStock},
		{name: "over reversed outbound", hasActiveInventory: true, netOutboundQuantityDelta: 1, netOutboundPalletDelta: 1, want: ContainerStatusInStock},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := resolveContainerInventoryStatus(
				test.hasActiveInventory,
				test.netOutboundQuantityDelta,
				test.netOutboundPalletDelta,
			)
			if got != test.want {
				t.Fatalf("resolve container inventory status = %q, want %q", got, test.want)
			}
		})
	}
}

func TestContainerSummaryStatusUsesPalletOnlyInventory(t *testing.T) {
	if got := containerStatus(ContainerSummary{PalletCount: 1}); got != "IN_STOCK" {
		t.Fatalf("pallet-only active inventory status = %q, want IN_STOCK", got)
	}
	if got := containerStatus(ContainerSummary{PalletCount: 1, ShippedQty: 1}); got != "PARTIAL" {
		t.Fatalf("partially shipped pallet-only inventory status = %q, want PARTIAL", got)
	}
}

func TestBuildContainerSummariesUsesAuthoritativeContainerProjection(t *testing.T) {
	summaries := buildContainerSummaries([]Container{{
		CustomerID:  7,
		ContainerNo: "CONT-PROJECTION",
		Status:      ContainerStatusPartiallyOutbound,
	}}, nil, []Item{{
		CustomerID:  7,
		ContainerNo: "CONT-PROJECTION",
		Pallets:     1,
	}}, nil)

	summary := summaries[containerSummaryKey(7, "CONT-PROJECTION")]
	if summary.Status != "PARTIAL" {
		t.Fatalf("summary status = %q, want normalized authoritative projection PARTIAL", summary.Status)
	}
}

func TestContainerProjectionFollowsIndependentBalancesAndLocationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Projection Customer-"+suffix)
	primaryLocation := mustCreateLocation(t, ctx, store, "Projection Primary-"+suffix)
	secondaryLocation := mustCreateLocation(t, ctx, store, "Projection Secondary-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, primaryLocation.ID, "PROJECTION-"+suffix, 0, DefaultStorageSection)
	containerNo := "PROJECTION-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          primaryLocation.ID,
		ExpectedArrivalDate: "2026-07-17",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			Pallets:        2,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create projection receipt: %v", err)
	}

	initial := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if initial.Status != ContainerStatusInStock || !initial.LocationID.Valid || initial.LocationID.Int64 != primaryLocation.ID {
		t.Fatalf("unexpected initial container projection: %+v", initial)
	}
	initialTrackingStatus := initial.TrackingStatus

	if _, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "PROJECTION-OUT-" + suffix,
		Lines: []CreateInventoryTransferLineInput{{
			CustomerID:         customer.ID,
			LocationID:         primaryLocation.ID,
			StorageSection:     DefaultStorageSection,
			ContainerNo:        containerNo,
			SKUMasterID:        item.SKUMasterID,
			SourcePallets:      1,
			DestinationPallets: 1,
			ToLocationID:       secondaryLocation.ID,
			ToStorageSection:   DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("split container pallets across warehouses: %v", err)
	}

	split := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if split.LocationID.Valid || split.Status != ContainerStatusInStock {
		t.Fatalf("multi-warehouse container should have no single projected location and remain in stock: %+v", split)
	}

	if _, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "PROJECTION-IN-" + suffix,
		Lines: []CreateInventoryTransferLineInput{{
			CustomerID:         customer.ID,
			LocationID:         secondaryLocation.ID,
			StorageSection:     DefaultStorageSection,
			ContainerNo:        containerNo,
			SKUMasterID:        item.SKUMasterID,
			SourcePallets:      1,
			DestinationPallets: 1,
			ToLocationID:       primaryLocation.ID,
			ToStorageSection:   DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("consolidate container pallets into primary warehouse: %v", err)
	}

	consolidated := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if !consolidated.LocationID.Valid || consolidated.LocationID.Int64 != primaryLocation.ID || consolidated.Status != ContainerStatusInStock {
		t.Fatalf("single-warehouse container should project its active warehouse: %+v", consolidated)
	}

	applyContainerProjectionLedgerDelta(t, ctx, store, createStockLedgerInput{
		EventType:          StockLedgerEventShip,
		SKUMasterID:        item.SKUMasterID,
		CustomerID:         customer.ID,
		LocationID:         primaryLocation.ID,
		StorageSection:     DefaultStorageSection,
		QuantityChange:     -10,
		PalletChange:       -1,
		SourceDocumentType: StockLedgerSourceOutbound,
		ContainerNo:        containerNo,
	})
	partiallyShipped := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if partiallyShipped.Status != ContainerStatusPartiallyOutbound || !partiallyShipped.LocationID.Valid || partiallyShipped.LocationID.Int64 != primaryLocation.ID {
		t.Fatalf("remaining pallet should keep the container active after all quantity ships: %+v", partiallyShipped)
	}

	applyContainerProjectionLedgerDelta(t, ctx, store, createStockLedgerInput{
		EventType:          StockLedgerEventReversal,
		SKUMasterID:        item.SKUMasterID,
		CustomerID:         customer.ID,
		LocationID:         primaryLocation.ID,
		StorageSection:     DefaultStorageSection,
		QuantityChange:     10,
		PalletChange:       1,
		SourceDocumentType: StockLedgerSourceAdjustment,
		ContainerNo:        containerNo,
	})
	foreignReversal := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if foreignReversal.Status != ContainerStatusPartiallyOutbound {
		t.Fatalf("a non-outbound reversal must not cancel the container's outbound activity: %+v", foreignReversal)
	}
	applyContainerProjectionLedgerDelta(t, ctx, store, createStockLedgerInput{
		EventType:          StockLedgerEventAdjust,
		SKUMasterID:        item.SKUMasterID,
		CustomerID:         customer.ID,
		LocationID:         primaryLocation.ID,
		StorageSection:     DefaultStorageSection,
		QuantityChange:     -10,
		PalletChange:       -1,
		SourceDocumentType: StockLedgerSourceAdjustment,
		ContainerNo:        containerNo,
	})

	applyContainerProjectionLedgerDelta(t, ctx, store, createStockLedgerInput{
		EventType:          StockLedgerEventShip,
		SKUMasterID:        item.SKUMasterID,
		CustomerID:         customer.ID,
		LocationID:         primaryLocation.ID,
		StorageSection:     DefaultStorageSection,
		PalletChange:       -1,
		SourceDocumentType: StockLedgerSourceOutbound,
		ContainerNo:        containerNo,
	})
	shipped := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if shipped.Status != ContainerStatusShipped || shipped.LocationID.Valid {
		t.Fatalf("container with no quantity or pallets and unreversed outbound activity should be shipped: %+v", shipped)
	}

	applyContainerProjectionLedgerDelta(t, ctx, store, createStockLedgerInput{
		EventType:          StockLedgerEventReversal,
		SKUMasterID:        item.SKUMasterID,
		CustomerID:         customer.ID,
		LocationID:         primaryLocation.ID,
		StorageSection:     DefaultStorageSection,
		QuantityChange:     10,
		PalletChange:       2,
		SourceDocumentType: StockLedgerSourceOutbound,
		ContainerNo:        containerNo,
	})
	reversed := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if reversed.Status != ContainerStatusInStock || !reversed.LocationID.Valid || reversed.LocationID.Int64 != primaryLocation.ID {
		t.Fatalf("fully reversed outbound should restore the in-stock projection: %+v", reversed)
	}

	applyContainerProjectionLedgerDelta(t, ctx, store, createStockLedgerInput{
		EventType:          StockLedgerEventAdjust,
		SKUMasterID:        item.SKUMasterID,
		CustomerID:         customer.ID,
		LocationID:         primaryLocation.ID,
		StorageSection:     DefaultStorageSection,
		QuantityChange:     -10,
		PalletChange:       -2,
		SourceDocumentType: StockLedgerSourceAdjustment,
		ContainerNo:        containerNo,
	})
	depleted := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if depleted.Status != ContainerStatusDepleted || depleted.LocationID.Valid {
		t.Fatalf("container depleted without unmatched outbound should have no active location: %+v", depleted)
	}
	if depleted.TrackingStatus != initialTrackingStatus {
		t.Fatalf("inventory projection must not change tracking status: got %q, want %q", depleted.TrackingStatus, initialTrackingStatus)
	}
}

type containerProjectionTestState struct {
	LocationID     sql.NullInt64
	Status         string
	TrackingStatus string
}

func loadContainerProjectionState(t *testing.T, ctx context.Context, store *Store, customerID int64, containerNo string) containerProjectionTestState {
	t.Helper()
	var state containerProjectionTestState
	if err := store.db.QueryRowxContext(ctx, `
		SELECT location_id, status, tracking_status
		FROM containers
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
	`, customerID, normalizeContainerNo(containerNo)).Scan(&state.LocationID, &state.Status, &state.TrackingStatus); err != nil {
		t.Fatalf("load container projection: %v", err)
	}
	return state
}

func applyContainerProjectionLedgerDelta(t *testing.T, ctx context.Context, store *Store, input createStockLedgerInput) {
	t.Helper()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin container projection ledger transaction: %v", err)
	}
	defer tx.Rollback()
	if err := store.createStockLedgerTx(ctx, tx, input); err != nil {
		t.Fatalf("apply container projection ledger delta: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit container projection ledger delta: %v", err)
	}
}
