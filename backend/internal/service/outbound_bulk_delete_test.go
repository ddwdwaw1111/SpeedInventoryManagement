package service

import (
	"context"
	"errors"
	"testing"
)

func TestBulkDeleteOutboundDocumentsRejectsDuplicateIDs(t *testing.T) {
	store := &Store{}
	_, err := store.BulkDeleteOutboundDocuments(context.Background(), BulkDeleteOutboundDocumentsInput{
		DocumentIDs: []int64{7, 7},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate shipment IDs to fail with ErrInvalidInput, got %v", err)
	}
}

func TestBulkDeleteOutboundDocumentsReversesConfirmedAndReleasesDraftReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Bulk Delete Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Bulk Delete Warehouse "+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "BULK-DELETE-"+suffix, 0, DefaultStorageSection)
	containerNo := "BULK-DELETE-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-07-21",
		ContainerNo:       containerNo,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 10, ReceivedQty: 10,
			Pallets: 2, StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("seed bulk-delete inventory: %v", err)
	}

	confirmed, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "BULK-DELETE-CONFIRMED-" + suffix,
		Status:        DocumentStatusConfirmed,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID: customer.ID, LocationID: location.ID, SKUMasterID: item.SKUMasterID,
			Quantity: 4, Pallets: 1, UnitLabel: "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound for bulk deletion: %v", err)
	}
	draft, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "BULK-DELETE-DRAFT-" + suffix,
		Status:        DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID: customer.ID, LocationID: location.ID, SKUMasterID: item.SKUMasterID,
			Quantity: 2, Pallets: 1, UnitLabel: "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create draft outbound for bulk deletion: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, draft.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("reserve draft outbound before bulk deletion: %v", err)
	}

	response, err := store.BulkDeleteOutboundDocuments(ctx, BulkDeleteOutboundDocumentsInput{
		DocumentIDs: []int64{confirmed.ID, draft.ID},
	})
	if err != nil {
		t.Fatalf("bulk delete outbound documents: %v", err)
	}
	if response.DeletedDocuments != 2 || response.FailedDocuments != 0 || response.Interrupted {
		t.Fatalf("unexpected bulk delete response: %#v", response)
	}
	if len(response.Results) != 2 || !response.Results[0].Success || !response.Results[1].Success {
		t.Fatalf("expected both shipments to be deleted: %#v", response.Results)
	}
	if _, err := store.getOutboundDocument(ctx, confirmed.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected confirmed outbound to be deleted, got %v", err)
	}
	if _, err := store.getOutboundDocument(ctx, draft.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected draft outbound to be deleted, got %v", err)
	}

	restored := mustFindItemByID(t, ctx, store, item.ID)
	if restored.Quantity != 10 || restored.Pallets != 2 || restored.AllocatedQty != 0 || restored.AllocatedPallets != 0 {
		t.Fatalf("expected restored inventory 10 qty / 2 pallets with no reservations, got %+v", restored)
	}
}
