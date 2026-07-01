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
)

type createStockLedgerInput struct {
	EventType           string
	OccurredAt          *time.Time
	SKUMasterID         int64
	CustomerID          int64
	LocationID          int64
	StorageSection      string
	QuantityChange      int
	SourceDocumentType  string
	SourceDocumentID    int64
	SourceLineID        int64
	ContainerID         int64
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
	ContainerID    int64
	ContainerNo    string
}

type inventoryProjection struct {
	ItemID         int64
	SKUMasterID    int64
	CustomerID     int64
	CustomerName   string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerID    int64
	ContainerNo    string
	ItemNumber     string
	SKU            string
	Name           string
	Category       string
	Description    string
	Unit           string
	Quantity       int
	Pallets        int
	AvailableQty   int
	AllocatedQty   int
	DamagedQty     int
	HoldQty        int
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
			COALESCE(i.container_id, 0) AS container_id,
			COALESCE(i.container_no, '') AS container_no,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			sm.sku,
			sm.name,
			sm.category,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			i.quantity,
			i.pallets,
			GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) AS available_qty,
			i.allocated_qty,
			i.damaged_qty,
			i.hold_qty
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
		&projection.ContainerID,
		&projection.ContainerNo,
		&projection.ItemNumber,
		&projection.SKU,
		&projection.Name,
		&projection.Category,
		&projection.Description,
		&projection.Unit,
		&projection.Quantity,
		&projection.Pallets,
		&projection.AvailableQty,
		&projection.AllocatedQty,
		&projection.DamagedQty,
		&projection.HoldQty,
	); err != nil {
		if err == sql.ErrNoRows {
			return inventoryProjection{}, ErrNotFound
		}
		return inventoryProjection{}, fmt.Errorf("load inventory projection: %w", err)
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
		bucket.ContainerID,
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
	result, err := tx.ExecContext(ctx, `
		INSERT INTO stock_ledger (
			event_type,
			occurred_at,
			sku_master_id,
			customer_id,
			location_id,
			storage_section,
			quantity_change,
			source_document_type,
			source_document_id,
			source_line_id,
			container_id,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		firstNonEmpty(input.EventType, StockLedgerEventReceive),
		nullableTime(input.OccurredAt),
		nullableInt64(input.SKUMasterID),
		input.CustomerID,
		input.LocationID,
		fallbackSection(input.StorageSection),
		input.QuantityChange,
		nullableString(input.SourceDocumentType),
		nullableInt64(input.SourceDocumentID),
		nullableInt64(input.SourceLineID),
		input.ContainerID,
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
	return stockLedgerID, nil
}

func (s *Store) createStockLedgerTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) error {
	_, err := s.createStockLedgerEntryTx(ctx, tx, input)
	return err
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
