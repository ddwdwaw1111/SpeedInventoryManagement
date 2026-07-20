package service

import (
	"context"
	"testing"
	"time"
)

func TestOutboundBillingMutationScopesUseFinalPickAllocationLocation(t *testing.T) {
	occurredAt := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	scopes := outboundBillingMutationScopes(41, occurredAt, []outboundDocumentLineRow{{
		LocationID: 12,
		PickAllocationsJSON: mustEncodeOutboundPickAllocations([]OutboundPickAllocation{{
			LocationID:     308,
			StorageSection: DefaultStorageSection,
			ContainerNo:    "FINAL-308-CONT",
			AllocatedQty:   5,
		}}),
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
		PackingListNo:    "AUTO-PALLET-OUT-" + suffix,
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
	if len(confirmed.Lines[0].PickAllocations) != 1 || confirmed.Lines[0].PickAllocations[0].Pallets != 3 {
		t.Fatalf("expected the allocation to consume the bucket's 3 inventory pallets, got %#v", confirmed.Lines[0].PickAllocations)
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
		PackingListNo:    "PLAN-ONLY-OUT-" + suffix,
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
		PackingListNo:    draft.PackingListNo,
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
