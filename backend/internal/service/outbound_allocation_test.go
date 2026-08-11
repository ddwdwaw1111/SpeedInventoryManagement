package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestOutboundBillingMutationScopesUseFinalPickAllocationLocation(t *testing.T) {
	occurredAt := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	scopes := outboundBillingMutationScopes(41, occurredAt, []outboundDocumentLineRow{{
		LocationID: 12,
		PickAllocations: []OutboundPickAllocation{{
			LocationID:     308,
			StorageSection: DefaultStorageSection,
			ContainerNo:    "FINAL-308-CONT",
			AllocatedQty:   5,
		}},
	}})

	if len(scopes) != 1 {
		t.Fatalf("billing mutation scopes = %#v, want one scope", scopes)
	}
	if scopes[0].CustomerID != 41 || !scopes[0].OccurredAt.Equal(occurredAt) {
		t.Fatalf("billing mutation identity = %#v", scopes[0])
	}
	if len(scopes[0].LocationIDs) != 1 || scopes[0].LocationIDs[0] != 308 || scopes[0].ContainerNo != "FINAL-308-CONT" {
		t.Fatalf("billing mutation final allocation scope = %#v, want warehouse 308 and FINAL-308-CONT", scopes[0])
	}
}

func TestAutomaticInventoryPalletsForAllocation(t *testing.T) {
	tests := []struct {
		name             string
		availableQty     int
		availablePallets int
		allocatedQty     int
		want             int
	}{
		{name: "full bucket keeps actual pallet balance", availableQty: 20, availablePallets: 3, allocatedQty: 20, want: 3},
		{name: "partial bucket uses its inventory balance", availableQty: 9, availablePallets: 3, allocatedQty: 3, want: 1},
		{name: "partial carton pick keeps the last pallet with remaining cartons", availableQty: 5, availablePallets: 1, allocatedQty: 1, want: 0},
		{name: "zero pallet bucket stays zero", availableQty: 9, availablePallets: 0, allocatedQty: 9, want: 0},
		{name: "empty allocation stays zero", availableQty: 9, availablePallets: 3, allocatedQty: 0, want: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := automaticInventoryPalletsForAllocation(test.availableQty, test.availablePallets, test.allocatedQty)
			if got != test.want {
				t.Fatalf("automatic inventory pallets = %d, want %d", got, test.want)
			}
		})
	}
}

func TestValidateOutboundFinalPalletAllocationChecksInventoryPalletRange(t *testing.T) {
	starting := 1
	remaining := 1
	allocation := OutboundPickAllocation{
		ContainerNo:          "PARTIAL-CONT",
		AllocatedQty:         5,
		Pallets:              0,
		InventoryPalletsUsed: 1,
		StartingPallets:      &starting,
		RemainingPallets:     &remaining,
	}
	if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
		t.Fatalf("stale remaining snapshots are re-derived at confirmation: %v", err)
	}

	allocation.InventoryPalletsUsed = 0
	if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
		t.Fatalf("partial-pallet carton pick must allow zero inventory pallets used: %v", err)
	}

	starting = 5
	remaining = 2
	allocation.InventoryPalletsUsed = 2
	if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
		t.Fatalf("inventory pallet count inside the starting balance should validate: %v", err)
	}
	allocation.InventoryPalletsUsed = 6
	if err := validateOutboundFinalPalletAllocation(allocation); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("inventory pallet count above the starting balance should fail, got %v", err)
	}
}

func TestValidateOutboundFinalPalletBalanceRejectsUnreviewedAllocation(t *testing.T) {
	store := &Store{}
	err := store.validateOutboundFinalPalletBalanceTx(context.Background(), nil, 1, 1, OutboundPickAllocation{
		LocationID:   9,
		ContainerNo:  "UNREVIEWED-CONT",
		AllocatedQty: 2,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unreviewed allocation error = %v, want ErrInvalidInput", err)
	}
}

func TestValidateOutboundFinalPalletBalanceAcceptsInternallyStagedTransfer(t *testing.T) {
	store := &Store{}
	starting := 2
	remaining := 1
	err := store.validateOutboundFinalPalletBalanceTx(context.Background(), nil, 1, 1, OutboundPickAllocation{
		LocationID:             3,
		ContainerNo:            "STAGED-CONT",
		AllocatedQty:           5,
		SourceLocationID:       9,
		SourceStartingPallets:  &starting,
		SourceRemainingPallets: &remaining,
	})
	if err != nil {
		t.Fatalf("internally staged transfer should retain its reviewed source snapshot: %v", err)
	}
}

func TestAutomaticPickAllocationDoesNotUseShippingPalletCount(t *testing.T) {
	line := &CreateOutboundDocumentLineInput{Pallets: 7}
	allocations := toOutboundPickAllocationsFromCandidates(line, []outboundAllocationCandidate{{
		LocationID:     3,
		LocationName:   "308 Herrod Blvd",
		StorageSection: "TEMP",
		ContainerNo:    "CONT-1",
		AllocatedQty:   20,
		Pallets:        3,
	}})

	if len(allocations) != 1 {
		t.Fatalf("expected one allocation, got %#v", allocations)
	}
	if allocations[0].Pallets != 3 {
		t.Fatalf("inventory pallets = %d, want actual bucket pallets 3; shipping pallets must remain independent", allocations[0].Pallets)
	}
}

func TestOutboundAutomaticAllocationKeepsShippingPalletsIndependentIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Auto pallet customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Auto pallet warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "AUTO-PALLET-"+suffix, 0, DefaultStorageSection)
	containerNo := "AUTO-PALLET-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-07-17",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    20,
			ReceivedQty:    20,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create inbound receipt: %v", err)
	}

	source := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	draft, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PickingOrderNo:   "AUTO-PALLET-OUT-" + suffix,
		ExpectedShipDate: "2026-07-17",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  source.CustomerID,
			LocationID:  source.LocationID,
			SKUMasterID: source.SKUMasterID,
			Quantity:    20,
			Pallets:     7,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft: %v", err)
	}

	confirmed, err := store.ConfirmOutboundDocument(ctx, draft.ID)
	if err != nil {
		t.Fatalf("confirm automatically allocated outbound: %v", err)
	}
	if len(confirmed.Lines) != 1 || confirmed.Lines[0].Pallets != 7 {
		t.Fatalf("expected shipping pallet count 7 to remain on the outbound line, got %#v", confirmed.Lines)
	}
	if len(confirmed.Lines[0].PickAllocations) != 1 || confirmed.Lines[0].PickAllocations[0].Pallets != 0 {
		t.Fatalf("expected the allocation to consume the bucket's 3 inventory pallets, got %#v", confirmed.Lines[0].PickAllocations)
	}
	allocation := confirmed.Lines[0].PickAllocations[0]
	if allocation.InventoryPalletsUsed != 3 || allocation.StartingPallets == nil || *allocation.StartingPallets != 3 || allocation.RemainingPallets == nil || *allocation.RemainingPallets != 0 {
		t.Fatalf("expected automatic allocation to persist reviewed pallet semantics, got %#v", allocation)
	}
}

func TestConfirmedPartialOutboundKeepsPhysicalPalletBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Partial pallet customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Partial pallet warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "PARTIAL-PALLET-"+suffix, 0, DefaultStorageSection)
	containerNo := "PARTIAL-PALLET-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-07-20",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create partial-pallet inbound receipt: %v", err)
	}

	source := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	startingPallets := 1
	remainingPallets := 1
	draft, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PickingOrderNo:   "PARTIAL-PALLET-OUT-" + suffix,
		ExpectedShipDate: "2026-07-20",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  source.CustomerID,
			LocationID:  source.LocationID,
			SKUMasterID: source.SKUMasterID,
			Quantity:    5,
			Pallets:     1,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{{
				LocationID:           source.LocationID,
				StorageSection:       source.StorageSection,
				ContainerNo:          source.ContainerNo,
				AllocatedQty:         5,
				Pallets:              0,
				InventoryPalletsUsed: 0,
				StartingPallets:      &startingPallets,
				RemainingPallets:     &remainingPallets,
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create partial-pallet outbound draft: %v", err)
	}
	if _, err := store.ConfirmOutboundDocument(ctx, draft.ID); err != nil {
		t.Fatalf("confirm partial-pallet outbound: %v", err)
	}

	remaining := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if remaining.Quantity != 5 || remaining.Pallets != 1 {
		t.Fatalf("partial pick left inventory qty/pallets = %d/%d, want 5/1", remaining.Quantity, remaining.Pallets)
	}
}

func TestConfirmedOutboundKeepsPlanOnlyLineWithoutConsumingInventoryIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Plan only customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Plan only warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "PLAN-ONLY-"+suffix, 0, DefaultStorageSection)
	draft, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PickingOrderNo:   "PLAN-ONLY-OUT-" + suffix,
		ExpectedShipDate: "2026-07-19",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:      item.CustomerID,
			LocationID:      item.LocationID,
			SKUMasterID:     item.SKUMasterID,
			PlannedQuantity: 12,
			ActualQuantity:  0,
			Pallets:         0,
			UnitLabel:       "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create plan-only outbound draft: %v", err)
	}

	draft, err = store.UpdateOutboundDocument(ctx, draft.ID, CreateOutboundDocumentInput{
		PickingOrderNo:   draft.PickingOrderNo,
		ExpectedShipDate: "2026-07-19",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:      item.CustomerID,
			LocationID:      item.LocationID,
			SKUMasterID:     item.SKUMasterID,
			PlannedQuantity: 13,
			ActualQuantity:  0,
			Pallets:         0,
			UnitLabel:       "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("update plan-only outbound draft: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `
		UPDATE outbound_document_lines
		SET pallets = 4
		WHERE document_id = ?
	`, draft.ID); err != nil {
		t.Fatalf("simulate legacy plan-only pallet count: %v", err)
	}

	confirmed, err := store.ConfirmOutboundDocument(ctx, draft.ID)
	if err != nil {
		t.Fatalf("confirm plan-only outbound: %v", err)
	}
	if len(confirmed.Lines) != 1 || confirmed.Lines[0].PlannedQuantity != 13 || confirmed.Lines[0].ActualQuantity != 0 || confirmed.Lines[0].Pallets != 0 {
		t.Fatalf("expected confirmed plan-versus-actual record, got %#v", confirmed.Lines)
	}
	if len(confirmed.Lines[0].PickAllocations) != 0 {
		t.Fatalf("plan-only line must not have pick allocations: %#v", confirmed.Lines[0].PickAllocations)
	}

	remaining := mustFindItemByID(t, ctx, store, item.ID)
	if remaining.Quantity != 0 || remaining.Pallets != 0 || remaining.AllocatedQty != 0 || remaining.AllocatedPallets != 0 {
		t.Fatalf("plan-only confirmation changed inventory: %#v", remaining)
	}
}
