package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestBulkConfirmOutboundDocumentsRejectsDuplicateIDs(t *testing.T) {
	store := &Store{}
	_, err := store.BulkConfirmOutboundDocuments(context.Background(), BulkConfirmOutboundDocumentsInput{
		DocumentIDs: []int64{7, 7},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate shipment IDs to fail with ErrInvalidInput, got %v", err)
	}
}

func TestOutboundConfirmationReferencePrefersPickingOrderNumber(t *testing.T) {
	if got := outboundConfirmationReference(outboundDocumentRow{ID: 5, PackingListNo: " PICK-100 "}); got != "PO PICK-100" {
		t.Fatalf("confirmation reference = %q, want PO PICK-100", got)
	}
	if got := outboundConfirmationReference(outboundDocumentRow{ID: 5}); got != "shipment 5" {
		t.Fatalf("fallback confirmation reference = %q, want shipment 5", got)
	}
}

func TestValidateOutboundDocumentCanBeConfirmedRequiresActiveDraft(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name string
		row  outboundDocumentRow
	}{
		{name: "archived draft", row: outboundDocumentRow{ID: 1, PackingListNo: "ARCHIVED-DRAFT", Status: DocumentStatusDraft, ArchivedAt: &now}},
		{name: "legacy archived status", row: outboundDocumentRow{ID: 2, PackingListNo: "ARCHIVED-STATUS", Status: DocumentStatusArchived}},
		{name: "unexpected status", row: outboundDocumentRow{ID: 3, PackingListNo: "UNKNOWN-STATUS", Status: "UNKNOWN"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateOutboundDocumentCanBeConfirmed(test.row); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected invalid input for %s, got %v", test.name, err)
			}
		})
	}
	if err := validateOutboundDocumentCanBeConfirmed(outboundDocumentRow{ID: 4, PackingListNo: "DRAFT", Status: DocumentStatusDraft}); err != nil {
		t.Fatalf("expected active draft to be confirmable, got %v", err)
	}
}

func TestExpectedBulkOutboundConfirmationFailureClassification(t *testing.T) {
	for _, expected := range []error{ErrNotFound, ErrInvalidInput, ErrInsufficientStock, ErrReservedStock} {
		if !isExpectedBulkOutboundConfirmationFailure(fmt.Errorf("confirm shipment: %w", expected)) {
			t.Fatalf("expected %v to remain an independent document failure", expected)
		}
	}
	if isExpectedBulkOutboundConfirmationFailure(errors.New("database connection lost")) {
		t.Fatal("expected an operational database failure to interrupt the batch")
	}
}

func TestBulkConfirmOutboundDocumentsInterruptsOnCancelledContextIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	response, err := store.BulkConfirmOutboundDocuments(ctx, BulkConfirmOutboundDocumentsInput{DocumentIDs: []int64{1, 2}})
	if err != nil {
		t.Fatalf("bulk confirmation should report an explicit interruption response, got %v", err)
	}
	if !response.Interrupted || response.FailedDocuments != 1 || response.UnprocessedDocuments != 1 || len(response.Results) != 1 {
		t.Fatalf("unexpected interrupted response: %#v", response)
	}
}

func TestBulkConfirmOutboundDocumentsKeepsSuccessfulDocumentsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Bulk Outbound Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Bulk Outbound Warehouse "+suffix)
	item := mustCreateItemWithPalletQuantities(
		t,
		ctx,
		store,
		customer.ID,
		location.ID,
		"BULK-OUTBOUND-"+suffix,
		DefaultStorageSection,
		5,
		5,
	)

	documentIDs := make([]int64, 0, 2)
	for _, pickingOrderNo := range []string{"BULK-OUT-A-" + suffix, "BULK-OUT-B-" + suffix} {
		document, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
			PackingListNo: pickingOrderNo,
			Status:        DocumentStatusDraft,
			Lines: []CreateOutboundDocumentLineInput{{
				CustomerID:  customer.ID,
				LocationID:  location.ID,
				SKUMasterID: item.SKUMasterID,
				Quantity:    6,
				Pallets:     1,
				UnitLabel:   "CTN",
			}},
		})
		if err != nil {
			t.Fatalf("create outbound draft %s: %v", pickingOrderNo, err)
		}
		documentIDs = append(documentIDs, document.ID)
	}

	response, err := store.BulkConfirmOutboundDocuments(ctx, BulkConfirmOutboundDocumentsInput{DocumentIDs: documentIDs})
	if err != nil {
		t.Fatalf("bulk confirm outbound documents: %v", err)
	}
	if response.UpdatedDocuments != 1 || response.FailedDocuments != 1 {
		t.Fatalf("bulk confirmation counts = %d confirmed / %d failed, want 1 / 1", response.UpdatedDocuments, response.FailedDocuments)
	}
	if len(response.Results) != 2 || !response.Results[0].Success || response.Results[1].Success {
		t.Fatalf("unexpected per-document results: %#v", response.Results)
	}
	if response.Results[1].Error == "" {
		t.Fatalf("expected failed shipment to include an error, got %#v", response.Results[1])
	}

	confirmed, err := store.getOutboundDocument(ctx, documentIDs[0])
	if err != nil {
		t.Fatalf("reload confirmed outbound document: %v", err)
	}
	if confirmed.Status != DocumentStatusConfirmed || confirmed.ConfirmedAt == nil {
		t.Fatalf("expected first shipment to remain confirmed, got %#v", confirmed)
	}
	failed, err := store.getOutboundDocument(ctx, documentIDs[1])
	if err != nil {
		t.Fatalf("reload failed outbound document: %v", err)
	}
	if failed.Status != DocumentStatusDraft || failed.ConfirmedAt != nil {
		t.Fatalf("expected second shipment to remain draft, got %#v", failed)
	}

	remaining := mustFindItemByID(t, ctx, store, item.ID)
	if remaining.Quantity != 4 || remaining.Pallets != 2 {
		t.Fatalf("expected first shipment to leave 4 qty / 2 pallets, got %d / %d", remaining.Quantity, remaining.Pallets)
	}
}

func TestBulkConfirmOutboundDocumentsRefreshesActivePalletReservationBetweenDocumentsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Bulk Pallet Refresh Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Bulk Pallet Refresh Warehouse "+suffix)
	item := mustCreateItemWithPalletQuantities(
		t,
		ctx,
		store,
		customer.ID,
		location.ID,
		"BULK-PALLET-REFRESH-"+suffix,
		DefaultStorageSection,
		72, 72, 72, 71, 71, 71, 71,
	)

	quantities := []int{275, 225}
	inventoryPalletsUsed := []int{4, 3}
	documentIDs := make([]int64, 0, len(quantities))
	for index, quantity := range quantities {
		startingPallets := 7
		remainingPallets := 7
		document, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
			PackingListNo: "BULK-PALLET-REFRESH-" + suffix + fmt.Sprintf("-%d", index+1),
			Status:        DocumentStatusDraft,
			Lines: []CreateOutboundDocumentLineInput{{
				CustomerID:  customer.ID,
				LocationID:  location.ID,
				SKUMasterID: item.SKUMasterID,
				Quantity:    quantity,
				Pallets:     inventoryPalletsUsed[index],
				UnitLabel:   "CTN",
				PickAllocations: []OutboundPickAllocation{{
					LocationID:           location.ID,
					LocationName:         location.Name,
					StorageSection:       item.StorageSection,
					ContainerNo:          item.ContainerNo,
					AllocatedQty:         quantity,
					InventoryPalletsUsed: inventoryPalletsUsed[index],
					StartingPallets:      &startingPallets,
					RemainingPallets:     &remainingPallets,
				}},
			}},
		})
		if err != nil {
			t.Fatalf("create outbound draft %d: %v", index+1, err)
		}
		documentIDs = append(documentIDs, document.ID)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, documentIDs[1], OutboundTrackingPicking); err != nil {
		t.Fatalf("reserve the second outbound draft before bulk confirmation: %v", err)
	}
	reserved := mustFindItemByID(t, ctx, store, item.ID)
	if reserved.AllocatedQty != quantities[1] || reserved.AllocatedPallets != 0 {
		t.Fatalf("expected second draft to reserve %d CTN / 0 released pallets, got %d / %d", quantities[1], reserved.AllocatedQty, reserved.AllocatedPallets)
	}

	response, err := store.BulkConfirmOutboundDocuments(ctx, BulkConfirmOutboundDocumentsInput{DocumentIDs: documentIDs})
	if err != nil {
		t.Fatalf("bulk confirm outbound documents: %v", err)
	}
	if response.UpdatedDocuments != 2 || response.FailedDocuments != 0 {
		t.Fatalf("bulk confirmation counts = %d confirmed / %d failed, want 2 / 0; results: %#v", response.UpdatedDocuments, response.FailedDocuments, response.Results)
	}
	remaining := mustFindItemByID(t, ctx, store, item.ID)
	if remaining.Quantity != 0 || remaining.Pallets != 0 {
		t.Fatalf("expected both shipments to clear inventory, got %d qty / %d pallets", remaining.Quantity, remaining.Pallets)
	}
}
