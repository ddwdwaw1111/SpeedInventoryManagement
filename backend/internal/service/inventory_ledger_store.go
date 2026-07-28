package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	StockLedgerEventReceive     = "RECEIVE"
	StockLedgerEventShip        = "SHIP"
	StockLedgerEventReversal    = "REVERSAL"
	StockLedgerEventTransferOut = "TRANSFER_OUT"
	StockLedgerEventTransferIn  = "TRANSFER_IN"
	StockLedgerEventAdjust      = "ADJUST"
	StockLedgerEventCount       = "COUNT"

	StockLedgerSourceInbound    = "INBOUND"
	StockLedgerSourceOutbound   = "OUTBOUND"
	StockLedgerSourceTransfer   = "TRANSFER"
	StockLedgerSourceAdjustment = "ADJUSTMENT"
	StockLedgerSourceCycleCount = "CYCLE_COUNT"
	StockLedgerSourceOpening    = "OPENING_BALANCE"
)

type createStockLedgerInput struct {
	EventType           string
	OccurredAt          *time.Time
	ContainerID         int64
	SKUMasterID         int64
	CustomerID          int64
	LocationID          int64
	SectionID           int64
	StorageSection      string
	QuantityChange      int
	PalletChange        float64
	SourceDocumentType  string
	SourceDocumentID    int64
	SourceLineID        int64
	ContainerNo         string
	DeliveryDate        *time.Time
	OutDate             *time.Time
	PackingListNo       string
	OrderRef            string
	ItemNumber          string
	DescriptionSnapshot string
	ExpectedQty         int
	ReceivedQty         int
	Pallets             int
	PalletsDetailCtns   string
	CartonSizeMM        string
	CartonCount         int
	UnitLabel           string
	NetWeightKgs        float64
	GrossWeightKgs      float64
	HeightIn            int
	DocumentNote        string
	Reason              string
	ReferenceCode       string
}

type inventorySourceBucket struct {
	SKUMasterID    int64
	CustomerID     int64
	LocationID     int64
	StorageSection string
	ContainerNo    string
}

type inventoryProjection struct {
	ItemID           int64
	SKUMasterID      int64
	CustomerID       int64
	CustomerName     string
	LocationID       int64
	LocationName     string
	StorageSection   string
	ContainerNo      string
	ItemNumber       string
	SKU              string
	Name             string
	Category         string
	Description      string
	Unit             string
	ReorderLevel     int
	Quantity         int
	AvailableQty     int
	AllocatedQty     int
	DamagedQty       int
	HoldQty          int
	Pallets          int
	AllocatedPallets int
}

func (s *Store) loadInventoryProjectionTx(ctx context.Context, tx *sql.Tx, itemID int64) (inventoryProjection, error) {
	var projection inventoryProjection
	if err := tx.QueryRowContext(ctx, `
		SELECT
			i.id,
			i.sku_master_id,
			i.customer_id,
			c.name,
			i.location_id,
			l.name,
			COALESCE(NULLIF(i.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(i.container_no, '') AS container_no,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			sm.sku,
			sm.name,
			sm.category,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			sm.reorder_level,
			i.quantity,
			GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) AS available_qty,
			i.allocated_qty,
			i.damaged_qty,
			i.hold_qty,
			i.pallets,
			i.allocated_pallets
		FROM inventory_items i
		JOIN customers c ON c.id = i.customer_id
		JOIN storage_locations l ON l.id = i.location_id
		JOIN sku_master sm ON sm.id = i.sku_master_id
		WHERE i.id = ?
		FOR UPDATE
	`, itemID).Scan(
		&projection.ItemID,
		&projection.SKUMasterID,
		&projection.CustomerID,
		&projection.CustomerName,
		&projection.LocationID,
		&projection.LocationName,
		&projection.StorageSection,
		&projection.ContainerNo,
		&projection.ItemNumber,
		&projection.SKU,
		&projection.Name,
		&projection.Category,
		&projection.Description,
		&projection.Unit,
		&projection.ReorderLevel,
		&projection.Quantity,
		&projection.AvailableQty,
		&projection.AllocatedQty,
		&projection.DamagedQty,
		&projection.HoldQty,
		&projection.Pallets,
		&projection.AllocatedPallets,
	); err != nil {
		if err == sql.ErrNoRows {
			return inventoryProjection{}, ErrNotFound
		}
		return inventoryProjection{}, fmt.Errorf("load container inventory projection: %w", err)
	}

	projection.StorageSection = fallbackSection(projection.StorageSection)
	projection.ContainerNo = strings.TrimSpace(projection.ContainerNo)
	return projection, nil
}

func (s *Store) loadInventoryProjectionForBucketTx(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket) (inventoryProjection, error) {
	itemID, err := s.findInventoryItemIDByProjectionTx(
		ctx,
		tx,
		bucket.SKUMasterID,
		bucket.CustomerID,
		bucket.LocationID,
		bucket.StorageSection,
		bucket.ContainerNo,
	)
	if err != nil {
		return inventoryProjection{}, err
	}

	return s.loadInventoryProjectionTx(ctx, tx, itemID)
}

func (s *Store) createStockLedgerEntryTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) (int64, error) {
	if input.CustomerID <= 0 || input.LocationID <= 0 {
		return 0, fmt.Errorf("%w: invalid stock ledger input", ErrInvalidInput)
	}
	input.PalletChange = resolveStockLedgerPalletChange(input)
	effectiveAt := time.Now().UTC()
	if input.OccurredAt != nil {
		effectiveAt = *input.OccurredAt
	} else if input.DeliveryDate != nil {
		effectiveAt = *input.DeliveryDate
	} else if input.OutDate != nil {
		effectiveAt = *input.OutDate
	}
	// Quantity-only movements can change the billable pallet count when the
	// underfilled-pallet threshold is enabled, so they must respect the same
	// generated-invoice freeze as explicit pallet movements.
	if input.QuantityChange != 0 || input.PalletChange != 0 {
		if err := ensureBillingSourceMutationsAllowedTx(ctx, tx, billingSourceMutationScope{
			CustomerID:  input.CustomerID,
			OccurredAt:  effectiveAt,
			LocationIDs: []int64{input.LocationID},
			ContainerNo: input.ContainerNo,
		}); err != nil {
			return 0, err
		}
	}
	if input.SectionID <= 0 {
		sectionID, sectionErr := resolveStorageSectionIDTx(ctx, tx, input.LocationID, input.StorageSection)
		if sectionErr != nil {
			return 0, sectionErr
		}
		input.SectionID = sectionID
	}
	containerID, err := ensureContainerForStockLedgerTx(ctx, tx, input)
	if err != nil {
		return 0, err
	}
	input.ContainerID = firstNonZeroInt64(input.ContainerID, containerID)
	result, err := tx.ExecContext(ctx, `
		INSERT INTO stock_ledger (
			event_type,
			occurred_at,
			sku_master_id,
			customer_id,
			container_id,
			location_id,
			section_id,
			storage_section,
			quantity_change,
			pallet_change,
			source_document_type,
			source_document_id,
			source_line_id,
			container_no_snapshot,
			delivery_date,
			out_date,
			packing_list_no,
			order_ref,
			item_number_snapshot,
			description_snapshot,
			expected_qty,
			received_qty,
			pallets,
			pallets_detail_ctns,
			carton_size_mm,
			carton_count,
			unit_label,
			net_weight_kgs,
			gross_weight_kgs,
			height_in,
			document_note,
			reason,
			reference_code
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		firstNonEmpty(input.EventType, StockLedgerEventReceive),
		nullableTime(input.OccurredAt),
		nullableInt64(input.SKUMasterID),
		input.CustomerID,
		nullableInt64(input.ContainerID),
		input.LocationID,
		nullableInt64(input.SectionID),
		fallbackSection(input.StorageSection),
		input.QuantityChange,
		input.PalletChange,
		nullableString(input.SourceDocumentType),
		nullableInt64(input.SourceDocumentID),
		nullableInt64(input.SourceLineID),
		strings.TrimSpace(input.ContainerNo),
		nullableTime(input.DeliveryDate),
		nullableTime(input.OutDate),
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		nullableString(input.ItemNumber),
		nullableString(input.DescriptionSnapshot),
		input.ExpectedQty,
		input.ReceivedQty,
		input.Pallets,
		nullableString(input.PalletsDetailCtns),
		nullableString(input.CartonSizeMM),
		input.CartonCount,
		nullableString(input.UnitLabel),
		input.NetWeightKgs,
		input.GrossWeightKgs,
		input.HeightIn,
		nullableString(input.DocumentNote),
		nullableString(input.Reason),
		nullableString(input.ReferenceCode),
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("create stock ledger entry: %w", err))
	}
	stockLedgerID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve stock ledger id: %w", err)
	}
	if err := s.createContainerLifecycleEventTx(ctx, tx, stockLedgerID, input); err != nil {
		return 0, err
	}
	if err := s.applyContainerInventoryLedgerDeltaTx(ctx, tx, input); err != nil {
		return 0, err
	}
	if err := s.recomputeContainerProjectionTx(ctx, tx, input.ContainerID); err != nil {
		return 0, err
	}
	return stockLedgerID, nil
}

func ensureContainerForStockLedgerTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) (int64, error) {
	if input.ContainerID > 0 {
		return input.ContainerID, nil
	}
	containerNo := normalizeContainerNo(input.ContainerNo)
	if containerNo == "" {
		return 0, nil
	}
	isReceive := strings.EqualFold(input.EventType, StockLedgerEventReceive)
	inboundDocumentID := int64(0)
	if strings.EqualFold(input.SourceDocumentType, StockLedgerSourceInbound) && isReceive {
		inboundDocumentID = input.SourceDocumentID
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO containers (
			customer_id,
			inbound_document_id,
			location_id,
			container_no,
			container_type,
			handling_mode,
			status,
			tracking_status,
			last_event_at
		) VALUES (?, ?, ?, ?, 'NORMAL', 'PALLETIZED', 'IN_STOCK', 'RECEIVED', COALESCE(?, CURRENT_TIMESTAMP))
		ON DUPLICATE KEY UPDATE
			id = LAST_INSERT_ID(id),
			inbound_document_id = COALESCE(VALUES(inbound_document_id), inbound_document_id),
			last_event_at = GREATEST(COALESCE(last_event_at, VALUES(last_event_at)), VALUES(last_event_at))
	`, input.CustomerID, nullableInt64(inboundDocumentID), input.LocationID, containerNo, nullableTime(resolveContainerLifecycleEventTime(input)))
	if err != nil {
		return 0, mapDBError(fmt.Errorf("ensure stock ledger container: %w", err))
	}
	containerID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve stock ledger container id: %w", err)
	}
	return containerID, nil
}

type containerProjectionBalance struct {
	ActiveItemCount          int
	ActiveLocationCount      int
	ActiveLocationID         sql.NullInt64
	NetOutboundQuantityDelta int64
	NetOutboundPalletDelta   float64
}

func (s *Store) recomputeContainerProjectionTx(ctx context.Context, tx *sql.Tx, containerID int64) error {
	if containerID <= 0 {
		return nil
	}

	var customerID int64
	var containerNo string
	if err := tx.QueryRowContext(ctx, `
		SELECT customer_id, container_no
		FROM containers
		WHERE id = ?
		FOR UPDATE
	`, containerID).Scan(&customerID, &containerNo); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("%w: stock ledger container does not exist", ErrInvalidInput)
		}
		return mapDBError(fmt.Errorf("lock stock ledger container projection: %w", err))
	}
	containerNo = normalizeContainerNo(containerNo)

	var balance containerProjectionBalance
	if err := tx.QueryRowContext(ctx, `
		SELECT
			COUNT(*),
			COUNT(DISTINCT location_id),
			MIN(location_id)
		FROM inventory_items
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
		  AND (quantity > 0 OR pallets > 0)
	`, customerID, containerNo).Scan(
		&balance.ActiveItemCount,
		&balance.ActiveLocationCount,
		&balance.ActiveLocationID,
	); err != nil {
		return mapDBError(fmt.Errorf("load container inventory projection balance: %w", err))
	}

	if err := tx.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(quantity_change), 0),
			COALESCE(SUM(pallet_change), 0)
		FROM stock_ledger
		WHERE customer_id = ?
		  AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?
		  AND UPPER(TRIM(COALESCE(source_document_type, ''))) = ?
		  AND UPPER(TRIM(event_type)) IN (?, ?)
	`, customerID, containerNo, StockLedgerSourceOutbound, StockLedgerEventShip, StockLedgerEventReversal).Scan(
		&balance.NetOutboundQuantityDelta,
		&balance.NetOutboundPalletDelta,
	); err != nil {
		return mapDBError(fmt.Errorf("load container outbound projection balance: %w", err))
	}

	var locationID any
	if balance.ActiveLocationCount == 1 && balance.ActiveLocationID.Valid {
		locationID = balance.ActiveLocationID.Int64
	}
	status := resolveContainerInventoryStatus(
		balance.ActiveItemCount > 0,
		balance.NetOutboundQuantityDelta,
		balance.NetOutboundPalletDelta,
	)
	if _, err := tx.ExecContext(ctx, `
		UPDATE containers
		SET
			location_id = ?,
			status = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, locationID, status, containerID); err != nil {
		return mapDBError(fmt.Errorf("update container inventory projection: %w", err))
	}
	return nil
}

func resolveContainerInventoryStatus(hasActiveInventory bool, netOutboundQuantityDelta int64, netOutboundPalletDelta float64) string {
	hasUnreversedOutbound := netOutboundQuantityDelta < 0 || netOutboundPalletDelta < -0.000001
	if hasActiveInventory && hasUnreversedOutbound {
		return ContainerStatusPartiallyOutbound
	}
	if hasActiveInventory {
		return ContainerStatusInStock
	}
	if hasUnreversedOutbound {
		return ContainerStatusShipped
	}
	return ContainerStatusDepleted
}

func resolveStockLedgerPalletChange(input createStockLedgerInput) float64 {
	return input.PalletChange
}

func (s *Store) applyContainerInventoryLedgerDeltaTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) error {
	if input.SKUMasterID <= 0 {
		return nil
	}
	containerNo := normalizeContainerNo(input.ContainerNo)
	result, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			container_id = COALESCE(?, container_id),
			quantity = quantity + ?,
			pallets = GREATEST(pallets + ROUND(?), 0),
			last_restocked_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_restocked_at END,
			updated_at = CURRENT_TIMESTAMP
		WHERE sku_master_id = ?
			AND customer_id = ?
			AND location_id = ?
			AND storage_section = ?
			AND container_no = ?
	`,
		nullableInt64(input.ContainerID),
		input.QuantityChange,
		input.PalletChange,
		input.QuantityChange,
		input.SKUMasterID,
		input.CustomerID,
		input.LocationID,
		fallbackSection(input.StorageSection),
		containerNo,
	)
	if err != nil {
		return mapDBError(fmt.Errorf("update container inventory ledger balance: %w", err))
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve container inventory balance update: %w", err)
	}
	if rowsAffected > 0 || (input.QuantityChange == 0 && input.PalletChange == 0) {
		return nil
	}
	if input.QuantityChange < 0 || input.PalletChange < 0 {
		return fmt.Errorf("%w: container inventory balance does not exist for outbound delta", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			container_id,
			location_id,
			storage_section,
			container_no,
			quantity,
			pallets,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ROUND(?), CURRENT_TIMESTAMP)
	`,
		input.SKUMasterID,
		input.CustomerID,
		nullableInt64(input.ContainerID),
		input.LocationID,
		fallbackSection(input.StorageSection),
		containerNo,
		input.QuantityChange,
		input.PalletChange,
	); err != nil {
		return mapDBError(fmt.Errorf("apply container inventory ledger delta: %w", err))
	}
	return nil
}

func (s *Store) createStockLedgerTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) error {
	_, err := s.createStockLedgerEntryTx(ctx, tx, input)
	return err
}

func deleteStockLedgerForDocumentTx(ctx context.Context, tx *sql.Tx, sourceDocumentType string, sourceDocumentID int64) error {
	if strings.TrimSpace(sourceDocumentType) == "" || sourceDocumentID <= 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM stock_ledger
		WHERE UPPER(TRIM(COALESCE(source_document_type, ''))) = ?
			AND source_document_id = ?
	`, strings.ToUpper(strings.TrimSpace(sourceDocumentType)), sourceDocumentID); err != nil {
		return mapDBError(fmt.Errorf("delete stock ledger for %s document %d: %w", sourceDocumentType, sourceDocumentID, err))
	}
	return nil
}

func classifyReservedStockConflict(requestedQty int, onHandQty int, allocatedQty int, damagedQty int, holdQty int) error {
	physicalQty := onHandQty - damagedQty - holdQty
	if allocatedQty > 0 && requestedQty <= maxInt(physicalQty, 0) {
		return fmt.Errorf("%w: requested stock is reserved by another outbound shipment", ErrReservedStock)
	}
	return ErrInsufficientStock
}

func firstNonZeroInt64(values ...int64) int64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}
