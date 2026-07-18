package service

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

func TestCancelConfirmedOutboundPreservesAuditRecordsIntegration(t *testing.T) {
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

	var (
		storedStatus string
		cancelNote   string
		cancelledAt  sql.NullTime
	)
	if err := store.db.QueryRowContext(ctx, `
		SELECT status, COALESCE(cancel_note, ''), cancelled_at
		FROM outbound_documents
		WHERE id = ?
	`, document.ID).Scan(&storedStatus, &cancelNote, &cancelledAt); err != nil {
		t.Fatalf("load soft-deleted outbound document: %v", err)
	}
	if normalizeDocumentStatus(storedStatus) != DocumentStatusDeleted || !cancelledAt.Valid {
		t.Fatalf("expected persisted deleted status and cancellation time, got status=%q cancelledAt=%#v", storedStatus, cancelledAt)
	}
	if strings.TrimSpace(cancelNote) == "" {
		t.Fatal("expected cancellation note to be preserved for audit")
	}

	var lineCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbound_document_lines WHERE document_id = ?`, document.ID).Scan(&lineCount); err != nil {
		t.Fatalf("count preserved outbound lines: %v", err)
	}
	if lineCount != 1 {
		t.Fatalf("expected one preserved outbound line, got %d", lineCount)
	}

	var (
		allocationCount      int
		cancelledAllocations int
	)
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0)
		FROM outbound_container_allocations
		WHERE outbound_line_id = ?
	`, lineID).Scan(&allocationCount, &cancelledAllocations); err != nil {
		t.Fatalf("load preserved outbound allocations: %v", err)
	}
	if allocationCount == 0 || cancelledAllocations != allocationCount {
		t.Fatalf("expected all preserved allocations to be cancelled, got total=%d cancelled=%d", allocationCount, cancelledAllocations)
	}

	reversalCount := countOutboundReversalsForDocument(t, ctx, store, document.ID)
	if reversalCount == 0 {
		t.Fatal("expected confirmed cancellation to write reversal ledger entries")
	}
	if _, err := store.CancelOutboundDocument(ctx, document.ID); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected repeat cancellation to fail with ErrInvalidInput, got %v", err)
	}
	if afterRepeat := countOutboundReversalsForDocument(t, ctx, store, document.ID); afterRepeat != reversalCount {
		t.Fatalf("repeat cancellation wrote another reversal: before=%d after=%d", reversalCount, afterRepeat)
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
	if _, err := store.UpdateOutboundDocumentNote(ctx, document.ID, UpdateOutboundDocumentNoteInput{DocumentNote: "must not change"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleted outbound note update to fail, got %v", err)
	}
	if _, err := store.ArchiveOutboundDocument(ctx, document.ID); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleted outbound archive to fail, got %v", err)
	}
	if _, err := store.CopyOutboundDocument(ctx, document.ID); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleted outbound copy to fail, got %v", err)
	}
	if err := store.EnsureDocumentAttachmentMutable(ctx, DocumentAttachmentOutbound, document.ID); !errors.Is(err, ErrInvalidInput) {
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
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected direct attachment creation on deleted outbound to fail, got %v", err)
	}

	auditDocument, err := store.getOutboundDocument(ctx, document.ID)
	if err != nil {
		t.Fatalf("load soft-deleted outbound through internal audit lookup: %v", err)
	}
	if auditDocument.Status != DocumentStatusDeleted || len(auditDocument.Lines) != 1 {
		t.Fatalf("expected internal audit lookup to retain deleted document and line, got %#v", auditDocument)
	}
}

func TestCancelPickingOutboundPreservesCancelledAllocationsIntegration(t *testing.T) {
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

	var (
		allocationCount      int
		cancelledAllocations int
	)
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0)
		FROM outbound_container_allocations
		WHERE outbound_line_id = ?
	`, lineID).Scan(&allocationCount, &cancelledAllocations); err != nil {
		t.Fatalf("load cancelled picking allocations: %v", err)
	}
	if allocationCount == 0 || cancelledAllocations != allocationCount {
		t.Fatalf("expected cancelled picking allocations to remain for audit, got total=%d cancelled=%d", allocationCount, cancelledAllocations)
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
	if reversals := countOutboundReversalsForDocument(t, ctx, store, document.ID); reversals != 0 {
		t.Fatalf("expected draft cancellation to avoid inventory reversals, got %d", reversals)
	}
}

func countOutboundReversalsForDocument(t *testing.T, ctx context.Context, store *Store, documentID int64) int {
	t.Helper()
	var count int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = ?
		  AND source_document_id = ?
		  AND event_type = ?
	`, StockLedgerSourceOutbound, documentID, StockLedgerEventReversal).Scan(&count); err != nil {
		t.Fatalf("count outbound reversal entries: %v", err)
	}
	return count
}
