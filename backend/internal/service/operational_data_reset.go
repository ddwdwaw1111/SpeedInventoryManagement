package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const operationalDataResetConfirmation = "confirm"

type ClearOperationalDataInput struct {
	Confirmation string `json:"confirmation"`
}

type ClearOperationalDataResult struct {
	InboundDocuments    int64     `json:"inboundDocuments"`
	OutboundDocuments   int64     `json:"outboundDocuments"`
	Transfers           int64     `json:"transfers"`
	InventoryItems      int64     `json:"inventoryItems"`
	Containers          int64     `json:"containers"`
	LedgerEntries       int64     `json:"ledgerEntries"`
	Adjustments         int64     `json:"adjustments"`
	CycleCounts         int64     `json:"cycleCounts"`
	BillingInvoices     int64     `json:"billingInvoices"`
	BulkImportBatches   int64     `json:"bulkImportBatches"`
	DocumentAttachments int64     `json:"documentAttachments"`
	ClearedAt           time.Time `json:"clearedAt"`
}

// ClearOperationalData removes documents and every operational projection
// derived from them while preserving users, customers, warehouses, UPCs, and
// shared settings. The fixed confirmation phrase is also enforced server-side
// so the destructive operation cannot be triggered by bypassing the UI.
func (s *Store) ClearOperationalData(ctx context.Context, input ClearOperationalDataInput) (ClearOperationalDataResult, error) {
	if input.Confirmation != operationalDataResetConfirmation {
		return ClearOperationalDataResult{}, fmt.Errorf("%w: type confirm to clear operational data", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ClearOperationalDataResult{}, fmt.Errorf("clear operational data: database is unavailable")
	}

	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return ClearOperationalDataResult{}, fmt.Errorf("begin operational data reset: %w", err)
	}
	defer tx.Rollback()

	var result ClearOperationalDataResult
	if err := tx.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM inbound_documents),
			(SELECT COUNT(*) FROM outbound_documents),
			(SELECT COUNT(*) FROM inventory_transfers),
			(SELECT COUNT(*) FROM inventory_items),
			(SELECT COUNT(*) FROM containers),
			(SELECT COUNT(*) FROM stock_ledger),
			(SELECT COUNT(*) FROM inventory_adjustments),
			(SELECT COUNT(*) FROM cycle_counts),
			(SELECT COUNT(*) FROM billing_invoices),
			(SELECT COUNT(*) FROM bulk_import_batches),
			(SELECT COUNT(*) FROM document_attachments)
	`).Scan(
		&result.InboundDocuments,
		&result.OutboundDocuments,
		&result.Transfers,
		&result.InventoryItems,
		&result.Containers,
		&result.LedgerEntries,
		&result.Adjustments,
		&result.CycleCounts,
		&result.BillingInvoices,
		&result.BulkImportBatches,
		&result.DocumentAttachments,
	); err != nil {
		return ClearOperationalDataResult{}, fmt.Errorf("count operational data before reset: %w", err)
	}

	// Children precede parents so foreign-key enforcement stays enabled for the
	// entire transaction. Keeping FK checks on makes schema drift fail safely.
	tables := []string{
		"billing_invoice_lines",
		"billing_invoices",
		"bulk_import_batch_documents",
		"bulk_import_batches",
		"outbound_container_allocations",
		// Only the application record is removed. R2 objects are intentionally
		// retained and this reset must never call object-storage deletion.
		"document_attachments",
		"delivery_events",
		"container_pickup_assignments",
		"container_tracking_events",
		"stock_ledger",
		"cycle_count_lines",
		"cycle_counts",
		"inventory_transfer_lines",
		"inventory_transfers",
		"inventory_adjustment_lines",
		"inventory_adjustments",
		"outbound_document_lines",
		"outbound_documents",
		"inbound_document_lines",
		"inbound_documents",
		"inventory_items",
		"containers",
	}
	for _, table := range tables {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return ClearOperationalDataResult{}, mapDBError(fmt.Errorf("clear %s: %w", table, err))
		}
	}

	result.ClearedAt = time.Now().UTC()
	if err := tx.Commit(); err != nil {
		return ClearOperationalDataResult{}, fmt.Errorf("commit operational data reset: %w", err)
	}
	return result, nil
}
