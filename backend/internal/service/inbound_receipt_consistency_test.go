package service

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestConfirmInboundDraftAllowsZeroReceivedQuantityAndPalletsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Inbound Draft Validation Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Inbound Draft Validation Warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "INBOUND-DRAFT-VALIDATION-"+suffix, 0, DefaultStorageSection)
	document, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-07-17",
		ContainerNo:       "INBOUND-DRAFT-VALIDATION-" + suffix,
		HandlingMode:      InboundHandlingModePalletized,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    0,
			Pallets:        0,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create zero-quantity draft receipt: %v", err)
	}

	if _, err := store.ConfirmInboundDocument(ctx, document.ID); err != nil {
		t.Fatalf("confirm zero-quantity draft receipt: %v", err)
	}
	reloaded, err := store.getInboundDocument(ctx, document.ID)
	if err != nil {
		t.Fatalf("reload confirmed zero-quantity receipt: %v", err)
	}
	if reloaded.Status != DocumentStatusConfirmed {
		t.Fatalf("zero-quantity receipt status = %q, want CONFIRMED", reloaded.Status)
	}
	if len(reloaded.Lines) != 1 || reloaded.Lines[0].InboundCtnsPerPallet != 0 {
		t.Fatalf("zero-quantity receipt CTN per pallet = %#v, want 0", reloaded.Lines)
	}
	var receiveLedgerRows int
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		  AND event_type = 'RECEIVE'
	`, document.ID).Scan(&receiveLedgerRows); err != nil {
		t.Fatalf("count zero-quantity receipt ledger rows: %v", err)
	}
	if receiveLedgerRows != 1 {
		t.Fatalf("zero-quantity receipt created %d RECEIVE ledger rows, want 1", receiveLedgerRows)
	}

	if _, err := store.CancelInboundDocument(ctx, document.ID); err != nil {
		t.Fatalf("delete confirmed zero-quantity receipt: %v", err)
	}
	if _, err := store.getInboundDocument(ctx, document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("zero-quantity receipt still exists after deletion: %v", err)
	}
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
	`, document.ID).Scan(&receiveLedgerRows); err != nil {
		t.Fatalf("count zero-quantity receipt ledger rows after deletion: %v", err)
	}
	if receiveLedgerRows != 0 {
		t.Fatalf("zero-quantity receipt left %d ledger rows after deletion", receiveLedgerRows)
	}
}

func TestConfirmedInboundUsesActualReceivedValuesIndependentlyIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Inbound Actual Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Inbound Actual Warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "INBOUND-ACTUAL-"+suffix, 0, DefaultStorageSection)
	containerNo := "INBOUND-ACTUAL-" + suffix

	document, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2025-12-15",
		ContainerNo:       containerNo,
		HandlingMode:      InboundHandlingModePalletized,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:                  item.SKU,
			Description:          item.Description,
			ExpectedQty:          99,
			ReceivedQty:          4,
			Pallets:              7,
			InboundCtnsPerPallet: 30,
			StorageSection:       DefaultStorageSection,
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 3},
				{Quantity: 1},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed receipt: %v", err)
	}
	if document.ExpectedArrivalDate != nil {
		t.Fatalf("expected arrival date was invented: %v", document.ExpectedArrivalDate)
	}

	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if receivedItem.Quantity != 4 || receivedItem.Pallets != 7 {
		t.Fatalf("inventory balance = qty %d, pallets %d; want independent values 4 and 7", receivedItem.Quantity, receivedItem.Pallets)
	}

	var quantityChange int
	var palletChange float64
	var occurredAt sql.NullTime
	var deliveryDate sql.NullTime
	if err := store.db.QueryRowxContext(ctx, `
		SELECT quantity_change, pallet_change, occurred_at, delivery_date
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		  AND event_type = 'RECEIVE'
	`, document.ID).Scan(&quantityChange, &palletChange, &occurredAt, &deliveryDate); err != nil {
		t.Fatalf("load receipt ledger entry: %v", err)
	}
	if quantityChange != 4 || palletChange != 7 {
		t.Fatalf("ledger delta = qty %d, pallets %.2f; want independent values 4 and 7", quantityChange, palletChange)
	}
	if !occurredAt.Valid || occurredAt.Time.Format("2006-01-02") != "2025-12-15" {
		t.Fatalf("ledger occurred_at = %v, want actual arrival date", occurredAt)
	}
	if !deliveryDate.Valid || deliveryDate.Time.Format("2006-01-02") != "2025-12-15" {
		t.Fatalf("ledger delivery_date = %v, want actual arrival date", deliveryDate)
	}
}
