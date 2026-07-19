package service

import (
	"context"
	"errors"
	"testing"
)

func TestCancelConfirmedOutboundHardDeletesRelatedRecordsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Outbound Audit Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Outbound Audit Warehouse-"+suffix)
	item := mustCreateItemWithPalletQuantities(
		t,
		ctx,
		store,
		customer.ID,
		location.ID,
		"OUTBOUND-AUDIT-SKU-"+suffix,
		DefaultStorageSection,
		5,
		5,
	)
	pickingOrderNo := "OUTBOUND-AUDIT-" + suffix

	document, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  pickingOrderNo,
		ActualShipDate: "2026-07-16",
		Status:         DocumentStatusConfirmed,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  customer.ID,
			LocationID:  location.ID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    5,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound document: %v", err)
	}
	if len(document.Lines) != 1 {
		t.Fatalf("expected one outbound line, got %d", len(document.Lines))
	}
	lineID := document.Lines[0].ID

	cancelled, err := store.CancelOutboundDocument(ctx, document.ID)
	if err != nil {
		t.Fatalf("cancel confirmed outbound document: %v", err)
	}
	if cancelled.Status != DocumentStatusDeleted || cancelled.DeletedAt == nil {
		t.Fatalf("expected deleted outbound response, got %#v", cancelled)
	}

	var documentCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbound_documents WHERE id = ?`, document.ID).Scan(&documentCount); err != nil {
		t.Fatalf("count deleted outbound document: %v", err)
	}
	if documentCount != 0 {
		t.Fatalf("expected outbound document to be physically deleted, got %d rows", documentCount)
	}

	var lineCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbound_document_lines WHERE document_id = ?`, document.ID).Scan(&lineCount); err != nil {
		t.Fatalf("count deleted outbound lines: %v", err)
	}
	if lineCount != 0 {
		t.Fatalf("expected outbound lines to be physically deleted, got %d", lineCount)
	}

	var allocationCount int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM outbound_container_allocations
		WHERE outbound_line_id = ?
	`, lineID).Scan(&allocationCount); err != nil {
		t.Fatalf("count deleted outbound allocations: %v", err)
	}
	if allocationCount != 0 {
		t.Fatalf("expected outbound allocations to be physically deleted, got %d", allocationCount)
	}

	if ledgerCount := countOutboundLedgerRowsForDocument(t, ctx, store, document.ID); ledgerCount != 0 {
		t.Fatalf("expected outbound stock ledger rows to be physically deleted, got %d", ledgerCount)
	}
	if _, err := store.CancelOutboundDocument(ctx, document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected repeat cancellation to fail with ErrNotFound, got %v", err)
	}

	restored := mustFindItemByID(t, ctx, store, item.ID)
	if restored.Quantity != 10 || restored.Pallets != 2 {
		t.Fatalf("expected cancellation to restore 10 qty / 2 pallets, got %d / %d", restored.Quantity, restored.Pallets)
	}

	visible, err := store.ListOutboundDocumentsFiltered(ctx, 10, OutboundDocumentFilters{
		ArchiveScope: DocumentArchiveScopeAll,
		Search:       pickingOrderNo,
	})
	if err != nil {
		t.Fatalf("list outbound documents after cancellation: %v", err)
	}
	if len(visible) != 0 {
		t.Fatalf("expected soft-deleted outbound to stay hidden from operational lists, got %#v", visible)
	}
	if _, err := store.GetOutboundDocumentForCustomer(ctx, document.ID, customer.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected customer lookup to hide deleted outbound, got %v", err)
	}
	if _, err := store.UpdateOutboundDocumentNote(ctx, document.ID, UpdateOutboundDocumentNoteInput{DocumentNote: "must not change"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted outbound note update to fail, got %v", err)
	}
	if _, err := store.ArchiveOutboundDocument(ctx, document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted outbound archive to fail, got %v", err)
	}
	if _, err := store.CopyOutboundDocument(ctx, document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted outbound copy to fail, got %v", err)
	}
	if err := store.EnsureDocumentAttachmentMutable(ctx, DocumentAttachmentOutbound, document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted outbound attachment preflight to fail, got %v", err)
	}
	if _, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentOutbound,
		DocumentID:       document.ID,
		DisplayName:      "deleted-document.pdf",
		OriginalFileName: "deleted-document.pdf",
		StorageProvider:  "test",
		StorageBucket:    "test",
		StorageKey:       "deleted-document.pdf",
		ContentType:      "application/pdf",
		SizeBytes:        1,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected direct attachment creation on deleted outbound to fail, got %v", err)
	}

	if _, err := store.getOutboundDocument(ctx, document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected internal lookup to miss hard-deleted outbound, got %v", err)
	}
}

func TestCancelPickingOutboundHardDeletesAllocationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Picking Audit Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Picking Audit Warehouse-"+suffix)
	item := mustCreateItemWithPalletQuantities(
		t,
		ctx,
		store,
		customer.ID,
		location.ID,
		"PICKING-AUDIT-SKU-"+suffix,
		DefaultStorageSection,
		4,
		6,
	)

	document, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PICKING-AUDIT-" + suffix,
		Status:        DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  customer.ID,
			LocationID:  location.ID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create draft outbound document: %v", err)
	}
	document, err = store.UpdateOutboundDocumentTrackingStatus(ctx, document.ID, OutboundTrackingPicking)
	if err != nil {
		t.Fatalf("reserve picking outbound: %v", err)
	}
	if len(document.Lines) != 1 {
		t.Fatalf("expected one picking line, got %d", len(document.Lines))
	}
	lineID := document.Lines[0].ID

	if _, err := store.CancelOutboundDocument(ctx, document.ID); err != nil {
		t.Fatalf("cancel picking outbound: %v", err)
	}

	var allocationCount int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM outbound_container_allocations
		WHERE outbound_line_id = ?
	`, lineID).Scan(&allocationCount); err != nil {
		t.Fatalf("count deleted picking allocations: %v", err)
	}
	if allocationCount != 0 {
		t.Fatalf("expected picking allocations to be physically deleted, got %d", allocationCount)
	}

	itemAfterCancel := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterCancel.Quantity != 10 || itemAfterCancel.AllocatedQty != 0 || itemAfterCancel.AvailableQty != 10 {
		t.Fatalf(
			"expected picking cancellation to release reservation and keep stock 10/0/10, got %d/%d/%d",
			itemAfterCancel.Quantity,
			itemAfterCancel.AllocatedQty,
			itemAfterCancel.AvailableQty,
		)
	}
	if ledgerRows := countOutboundLedgerRowsForDocument(t, ctx, store, document.ID); ledgerRows != 0 {
		t.Fatalf("expected draft cancellation to leave no inventory ledger rows, got %d", ledgerRows)
	}
}

func countOutboundLedgerRowsForDocument(t *testing.T, ctx context.Context, store *Store, documentID int64) int {
	t.Helper()
	var count int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = ?
		  AND source_document_id = ?
	`, StockLedgerSourceOutbound, documentID).Scan(&count); err != nil {
		t.Fatalf("count outbound ledger entries: %v", err)
	}
	return count
}
