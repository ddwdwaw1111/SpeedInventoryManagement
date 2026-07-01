package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type inventoryBalanceState struct {
	ItemID         int64
	SKUMasterID    int64
	CustomerID     int64
	LocationID     int64
	StorageSection string
	ContainerID    int64
	ContainerNo    string
	Quantity       int
	Pallets        int
	AllocatedQty   int
	DamagedQty     int
	HoldQty        int
}

func (state inventoryBalanceState) availableQty() int {
	return computeAvailableQuantity(state.Quantity, state.AllocatedQty, state.DamagedQty, state.HoldQty)
}

func firstInt(values ...int) int {
	if len(values) == 0 {
		return 0
	}
	return values[0]
}

func (s *Store) loadLockedInventoryBalanceByIDTx(ctx context.Context, tx *sql.Tx, itemID int64) (inventoryBalanceState, error) {
	var state inventoryBalanceState
	if err := tx.QueryRowContext(ctx, `
		SELECT
			id,
			sku_master_id,
			customer_id,
			location_id,
			COALESCE(NULLIF(storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(container_id, 0) AS container_id,
			COALESCE(container_no, '') AS container_no,
			quantity,
			pallets,
			allocated_qty,
			damaged_qty,
			hold_qty
		FROM inventory_items
		WHERE id = ?
		FOR UPDATE
	`, itemID).Scan(
		&state.ItemID,
		&state.SKUMasterID,
		&state.CustomerID,
		&state.LocationID,
		&state.StorageSection,
		&state.ContainerID,
		&state.ContainerNo,
		&state.Quantity,
		&state.Pallets,
		&state.AllocatedQty,
		&state.DamagedQty,
		&state.HoldQty,
	); err != nil {
		if err == sql.ErrNoRows {
			return inventoryBalanceState{}, ErrNotFound
		}
		return inventoryBalanceState{}, fmt.Errorf("load inventory balance: %w", err)
	}

	state.StorageSection = fallbackSection(state.StorageSection)
	state.ContainerNo = strings.TrimSpace(state.ContainerNo)
	return state, nil
}

func (s *Store) loadLockedInventoryBalanceForBucketTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket) (inventoryBalanceState, error) {
	itemID, err := s.findInventoryItemIDByProjectionTx(
		ctx,
		tx,
		bucket.SKUMasterID,
		bucket.CustomerID,
		bucket.LocationID,
		bucket.StorageSection,
		bucket.ContainerID,
		bucket.ContainerNo,
	)
	if err != nil {
		return inventoryBalanceState{}, err
	}
	return s.loadLockedInventoryBalanceByIDTx(ctx, tx, itemID)
}

func (s *Store) increaseInventoryBalanceTx(ctx context.Context, tx *sql.Tx, itemID int64, quantity int, palletDeltas ...int) error {
	palletDelta := firstInt(palletDeltas...)
	if itemID <= 0 || (quantity <= 0 && palletDelta <= 0) {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			quantity = quantity + ?,
			pallets = pallets + ?,
			last_restocked_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantity, palletDelta, itemID); err != nil {
		return mapDBError(fmt.Errorf("increase inventory balance: %w", err))
	}
	return nil
}

func (s *Store) adjustInventoryBalanceByIDTx(ctx context.Context, tx *sql.Tx, itemID int64, quantityDelta int, palletDelta int) error {
	if itemID <= 0 || (quantityDelta == 0 && palletDelta == 0) {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceByIDTx(ctx, tx, itemID)
	if err != nil {
		return err
	}
	if quantityDelta < 0 && -quantityDelta > state.availableQty() {
		return classifyReservedStockConflict(-quantityDelta, state.Quantity, state.AllocatedQty, state.DamagedQty, state.HoldQty)
	}
	if state.Quantity+quantityDelta < 0 {
		return ErrInsufficientStock
	}
	if state.Pallets+palletDelta < 0 {
		return fmt.Errorf("%w: pallet count cannot be reduced below zero", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			quantity = quantity + ?,
			pallets = pallets + ?,
			last_restocked_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_restocked_at END,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantityDelta, palletDelta, quantityDelta, itemID); err != nil {
		return mapDBError(fmt.Errorf("adjust inventory balance: %w", err))
	}
	return nil
}

func (s *Store) reserveInventoryBalanceTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket, quantity int) error {
	if quantity <= 0 {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, bucket)
	if err != nil {
		if err == ErrNotFound {
			return ErrInsufficientStock
		}
		return err
	}
	if quantity > state.availableQty() {
		return classifyReservedStockConflict(quantity, state.Quantity, state.AllocatedQty, state.DamagedQty, state.HoldQty)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET allocated_qty = allocated_qty + ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantity, state.ItemID); err != nil {
		return mapDBError(fmt.Errorf("reserve inventory balance: %w", err))
	}
	return nil
}

func (s *Store) releaseInventoryReservationTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket, quantity int) error {
	if quantity <= 0 {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, bucket)
	if err != nil {
		return err
	}
	if quantity > state.AllocatedQty {
		return fmt.Errorf("%w: inventory reservation snapshot no longer matches allocated stock", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET allocated_qty = allocated_qty - ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantity, state.ItemID); err != nil {
		return mapDBError(fmt.Errorf("release inventory reservation: %w", err))
	}
	return nil
}

func (s *Store) consumeReservedInventoryBalanceTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket, quantity int, palletDeltas ...int) error {
	palletDelta := firstInt(palletDeltas...)
	if quantity <= 0 && palletDelta <= 0 {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, bucket)
	if err != nil {
		return err
	}
	if quantity > state.AllocatedQty {
		return fmt.Errorf("%w: inventory reservation snapshot no longer matches allocated stock", ErrInvalidInput)
	}
	if quantity > state.Quantity {
		return fmt.Errorf("%w: reserved inventory quantity is no longer available to ship", ErrInvalidInput)
	}
	if palletDelta > state.Pallets {
		return fmt.Errorf("%w: outbound pallet count is no longer available to ship", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			quantity = quantity - ?,
			pallets = pallets - ?,
			allocated_qty = allocated_qty - ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantity, palletDelta, quantity, state.ItemID); err != nil {
		return mapDBError(fmt.Errorf("consume reserved inventory balance: %w", err))
	}
	return nil
}

func (s *Store) restoreInventoryBalanceTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket, quantity int, palletDeltas ...int) error {
	palletDelta := firstInt(palletDeltas...)
	if quantity <= 0 && palletDelta <= 0 {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, bucket)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET quantity = quantity + ?, pallets = pallets + ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantity, palletDelta, state.ItemID); err != nil {
		return mapDBError(fmt.Errorf("restore inventory balance: %w", err))
	}
	return nil
}

func (s *Store) adjustInventoryPalletBalanceByIDTx(ctx context.Context, tx *sql.Tx, itemID int64, palletDelta int) error {
	if itemID <= 0 || palletDelta == 0 {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceByIDTx(ctx, tx, itemID)
	if err != nil {
		return err
	}
	if palletDelta < 0 && -palletDelta > state.Pallets {
		return fmt.Errorf("%w: pallet count cannot be reduced below zero", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET pallets = pallets + ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, palletDelta, itemID); err != nil {
		return mapDBError(fmt.Errorf("adjust inventory pallet balance: %w", err))
	}
	return nil
}

func (s *Store) adjustInventoryPalletBalanceTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket, palletDelta int) error {
	if palletDelta == 0 {
		return nil
	}
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, bucket)
	if err != nil {
		return err
	}
	return s.adjustInventoryPalletBalanceByIDTx(ctx, tx, state.ItemID, palletDelta)
}

func resolveInventoryPalletCountDelta(beforeQty int, afterQty int) int {
	switch {
	case beforeQty <= 0 && afterQty > 0:
		return 1
	case beforeQty > 0 && afterQty <= 0:
		return -1
	default:
		return 0
	}
}

func stockLedgerPalletCountForQuantityChange(quantityChange int, palletDelta int) int {
	if quantityChange == 0 {
		return palletDelta
	}
	if palletDelta < 0 {
		return -palletDelta
	}
	return palletDelta
}

func (s *Store) restoreInventoryBalancesForOutboundLedgerTx(ctx context.Context, tx *sql.Tx, outboundDocumentID int64) error {
	if outboundDocumentID <= 0 {
		return nil
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT
			COALESCE(sku_master_id, 0) AS sku_master_id,
			customer_id,
			location_id,
			COALESCE(NULLIF(storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(container_id, 0) AS container_id,
			COALESCE(container_no_snapshot, '') AS container_no,
			-SUM(quantity_change) AS restore_qty,
			SUM(GREATEST(pallets, 0)) AS restore_pallets
		FROM stock_ledger
		WHERE source_document_type = ?
			AND source_document_id = ?
			AND quantity_change < 0
		GROUP BY
			COALESCE(sku_master_id, 0),
			customer_id,
			location_id,
			COALESCE(NULLIF(storage_section, ''), 'TEMP'),
			COALESCE(container_id, 0),
			COALESCE(container_no_snapshot, '')
	`, StockLedgerSourceOutbound, outboundDocumentID)
	if err != nil {
		return fmt.Errorf("load outbound ledger restore rows: %w", err)
	}
	defer rows.Close()

	type restoreRow struct {
		bucket         inventorySourceBucket
		restoreQty     int
		restorePallets int
	}
	restoreRows := make([]restoreRow, 0)
	for rows.Next() {
		var row restoreRow
		if err := rows.Scan(
			&row.bucket.SKUMasterID,
			&row.bucket.CustomerID,
			&row.bucket.LocationID,
			&row.bucket.StorageSection,
			&row.bucket.ContainerID,
			&row.bucket.ContainerNo,
			&row.restoreQty,
			&row.restorePallets,
		); err != nil {
			return fmt.Errorf("scan outbound ledger restore row: %w", err)
		}
		if row.bucket.SKUMasterID <= 0 || (row.restoreQty <= 0 && row.restorePallets <= 0) {
			continue
		}
		restoreRows = append(restoreRows, row)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate outbound ledger restore rows: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close outbound ledger restore rows: %w", err)
	}
	for _, row := range restoreRows {
		if err := s.restoreInventoryBalanceTx(ctx, tx, row.bucket, row.restoreQty, row.restorePallets); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) reduceInventoryBalancesForInboundLedgerTx(ctx context.Context, tx *sql.Tx, inboundDocumentID int64) error {
	if inboundDocumentID <= 0 {
		return nil
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT
			COALESCE(sku_master_id, 0) AS sku_master_id,
			customer_id,
			location_id,
			COALESCE(NULLIF(storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(container_id, 0) AS container_id,
			COALESCE(container_no_snapshot, '') AS container_no,
			SUM(quantity_change) AS reduce_qty,
			SUM(CASE
				WHEN quantity_change < 0 THEN -GREATEST(pallets, 0)
				WHEN quantity_change > 0 THEN GREATEST(pallets, 0)
				ELSE pallets
			END) AS reduce_pallets
		FROM stock_ledger
		WHERE source_document_type = ?
			AND source_document_id = ?
			AND (quantity_change <> 0 OR pallets <> 0)
		GROUP BY
			COALESCE(sku_master_id, 0),
			customer_id,
			location_id,
			COALESCE(NULLIF(storage_section, ''), 'TEMP'),
			COALESCE(container_id, 0),
			COALESCE(container_no_snapshot, '')
		HAVING SUM(quantity_change) > 0
			OR SUM(CASE
				WHEN quantity_change < 0 THEN -GREATEST(pallets, 0)
				WHEN quantity_change > 0 THEN GREATEST(pallets, 0)
				ELSE pallets
			END) > 0
	`, StockLedgerSourceInbound, inboundDocumentID)
	if err != nil {
		return fmt.Errorf("load inbound ledger reduction rows: %w", err)
	}
	defer rows.Close()

	type reductionRow struct {
		bucket        inventorySourceBucket
		reduceQty     int
		reducePallets int
	}
	reductionRows := make([]reductionRow, 0)
	for rows.Next() {
		var row reductionRow
		if err := rows.Scan(
			&row.bucket.SKUMasterID,
			&row.bucket.CustomerID,
			&row.bucket.LocationID,
			&row.bucket.StorageSection,
			&row.bucket.ContainerID,
			&row.bucket.ContainerNo,
			&row.reduceQty,
			&row.reducePallets,
		); err != nil {
			return fmt.Errorf("scan inbound ledger reduction row: %w", err)
		}
		if row.bucket.SKUMasterID <= 0 || (row.reduceQty <= 0 && row.reducePallets <= 0) {
			continue
		}
		reductionRows = append(reductionRows, row)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate inbound ledger reduction rows: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close inbound ledger reduction rows: %w", err)
	}
	for _, row := range reductionRows {
		state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, row.bucket)
		if err != nil {
			return err
		}
		if state.AllocatedQty > 0 || state.DamagedQty > 0 || state.HoldQty > 0 || state.Quantity < row.reduceQty || state.Pallets < row.reducePallets {
			return fmt.Errorf("%w: receipt stock has been reserved, shipped, damaged, or held and cannot be deleted", ErrInvalidInput)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET quantity = quantity - ?, pallets = pallets - ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, row.reduceQty, row.reducePallets, state.ItemID); err != nil {
			return mapDBError(fmt.Errorf("reduce inventory balance for inbound cancel: %w", err))
		}
	}
	return nil
}
