package service

import (
	"context"
	"errors"
	"testing"
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

func TestBulkConfirmOutboundDocumentsRollsBackEntireBatchIntegration(t *testing.T) {
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

	_, err := store.BulkConfirmOutboundDocuments(ctx, BulkConfirmOutboundDocumentsInput{DocumentIDs: documentIDs})
	if !errors.Is(err, ErrInsufficientStock) {
		t.Fatalf("expected insufficient stock to reject the batch, got %v", err)
	}

	for _, documentID := range documentIDs {
		document, err := store.getOutboundDocument(ctx, documentID)
		if err != nil {
			t.Fatalf("reload outbound draft %d: %v", documentID, err)
		}
		if document.Status != DocumentStatusDraft || document.ConfirmedAt != nil {
			t.Fatalf("expected shipment %d to remain draft after rollback, got %#v", documentID, document)
		}
		if ledgerRows := countOutboundLedgerRowsForDocument(t, ctx, store, documentID); ledgerRows != 0 {
			t.Fatalf("expected shipment %d to leave no ledger rows after rollback, got %d", documentID, ledgerRows)
		}
	}

	remaining := mustFindItemByID(t, ctx, store, item.ID)
	if remaining.Quantity != 10 || remaining.Pallets != 2 {
		t.Fatalf("expected inventory to remain 10 qty / 2 pallets, got %d / %d", remaining.Quantity, remaining.Pallets)
	}
}
