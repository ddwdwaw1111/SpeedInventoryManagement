package service

import (
	"context"
	"errors"
	"testing"
)

func TestClearOperationalDataRequiresExactConfirmation(t *testing.T) {
	store := &Store{}
	for _, confirmation := range []string{"", "CONFIRM", "confirmed", " confirm ", "confirm "} {
		if _, err := store.ClearOperationalData(context.Background(), ClearOperationalDataInput{Confirmation: confirmation}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("confirmation %q error = %v, want ErrInvalidInput", confirmation, err)
		}
	}
}

func TestClearOperationalDataPreservesMasterDataIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Reset Customer "+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "Reset Source "+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "Reset Destination "+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, sourceLocation.ID, "RESET-UPC-"+suffix, 0, DefaultStorageSection)
	containerNo := "RESET-CONT-" + suffix

	inboundDocument, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-08-01",
		ActualArrivalDate:   "2026-08-01",
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
	})
	if err != nil {
		t.Fatalf("create reset test inbound: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `
		INSERT INTO document_attachments (
			document_type, document_id, display_name, original_file_name,
			storage_provider, storage_bucket, storage_key, content_type, size_bytes
		) VALUES ('INBOUND', ?, 'reset-test.pdf', 'reset-test.pdf', 'r2', 'reset-test-bucket', 'reset/test.pdf', 'application/pdf', 128)
	`, inboundDocument.ID); err != nil {
		t.Fatalf("create reset test attachment: %v", err)
	}

	if _, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PickingOrderNo:   "RESET-PO-" + suffix,
		ExpectedShipDate: "2026-08-02",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  customer.ID,
			LocationID:  sourceLocation.ID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    2,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	}); err != nil {
		t.Fatalf("create reset test outbound: %v", err)
	}

	if _, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo:          "RESET-TRN-" + suffix,
		ActualTransferredAt: "2026-08-03",
		EntireContainer: &CreateEntireContainerTransferInput{
			CustomerID:       customer.ID,
			LocationID:       sourceLocation.ID,
			ContainerNo:      containerNo,
			ToLocationID:     destinationLocation.ID,
			ToStorageSection: DefaultStorageSection,
		},
	}); err != nil {
		t.Fatalf("create reset test transfer: %v", err)
	}

	result, err := store.ClearOperationalData(ctx, ClearOperationalDataInput{Confirmation: "confirm"})
	if err != nil {
		t.Fatalf("clear operational data: %v", err)
	}
	if result.InboundDocuments != 1 || result.OutboundDocuments != 1 || result.Transfers != 1 {
		t.Fatalf("unexpected cleared document counts: %#v", result)
	}
	if result.DocumentAttachments != 1 {
		t.Fatalf("cleared attachment count = %d, want 1", result.DocumentAttachments)
	}
	if result.InventoryItems == 0 || result.Containers == 0 || result.LedgerEntries == 0 || result.ClearedAt.IsZero() {
		t.Fatalf("expected inventory projections and ledger rows to be reported: %#v", result)
	}

	for _, table := range []string{
		"billing_invoice_lines", "billing_invoices", "bulk_import_batch_documents", "bulk_import_batches",
		"outbound_container_allocations", "document_attachments", "delivery_events", "container_pickup_assignments",
		"container_tracking_events", "stock_ledger", "cycle_count_lines", "cycle_counts",
		"inventory_transfer_lines", "inventory_transfers", "inventory_adjustment_lines", "inventory_adjustments",
		"outbound_document_lines", "outbound_documents", "inbound_document_lines", "inbound_documents",
		"inventory_items", "containers",
	} {
		var count int
		if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
			t.Fatalf("count %s after reset: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s count after reset = %d, want 0", table, count)
		}
	}

	for _, query := range []string{
		"SELECT COUNT(*) FROM customers WHERE id = ?",
		"SELECT COUNT(*) FROM storage_locations WHERE id = ?",
		"SELECT COUNT(*) FROM sku_master WHERE id = ?",
	} {
		var count int
		var id int64
		switch query {
		case "SELECT COUNT(*) FROM customers WHERE id = ?":
			id = customer.ID
		case "SELECT COUNT(*) FROM storage_locations WHERE id = ?":
			id = sourceLocation.ID
		default:
			id = item.SKUMasterID
		}
		if err := store.db.QueryRowContext(ctx, query, id).Scan(&count); err != nil {
			t.Fatalf("count preserved master data: %v", err)
		}
		if count != 1 {
			t.Fatalf("master data query %q count = %d, want 1", query, count)
		}
	}
}
