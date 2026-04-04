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
)

type createdPalletEntity struct {
	Pallet       palletRecord
	PalletItemID int64
	Quantity     int
}

type palletItemRecord struct {
	ID           int64 `db:"id"`
	PalletID     int64 `db:"pallet_id"`
	SKUMasterID  int64 `db:"sku_master_id"`
	Quantity     int   `db:"quantity"`
	AllocatedQty int   `db:"allocated_qty"`
	DamagedQty   int   `db:"damaged_qty"`
	HoldQty      int   `db:"hold_qty"`
}

type createStockLedgerInput struct {
	EventType           string
	PalletID            int64
	PalletItemID        int64
	SKUMasterID         int64
	CustomerID          int64
	LocationID          int64
	StorageSection      string
	QuantityChange      int
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

type createOutboundPickInput struct {
	OutboundLineID int64
	PalletID       int64
	PalletItemID   int64
	PickedQty      int
}

type palletContentConsumption struct {
	PalletID                int64
	PalletItemID            int64
	SKUMasterID             int64
	Quantity                int
	CustomerID              int64
	LocationID              int64
	StorageSection          string
	ContainerVisitID        int64
	SourceInboundDocumentID int64
	SourceInboundLineID     int64
	ContainerNo             string
}

type outboundPickRestore struct {
	ID             int64  `db:"id"`
	OutboundLineID int64  `db:"outbound_line_id"`
	PalletID       int64  `db:"pallet_id"`
	PalletItemID   int64  `db:"pallet_item_id"`
	PickedQty      int    `db:"picked_qty"`
	SKUMasterID    int64  `db:"sku_master_id"`
	CustomerID     int64  `db:"customer_id"`
	LocationID     int64  `db:"location_id"`
	StorageSection string `db:"storage_section"`
	ContainerNo    string `db:"container_no"`
}

type inventoryItemBucket struct {
	ID             int64  `db:"id"`
	SKUMasterID    int64  `db:"sku_master_id"`
	CustomerID     int64  `db:"customer_id"`
	LocationID     int64  `db:"location_id"`
	StorageSection string `db:"storage_section"`
	ContainerNo    string `db:"container_no"`
}

type palletSourceBucket struct {
	SKUMasterID    int64
	CustomerID     int64
	LocationID     int64
	StorageSection string
	ContainerNo    string
}

type palletBackedInventoryProjection struct {
	ItemID         int64
	SKUMasterID    int64
	CustomerID     int64
	CustomerName   string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	ItemNumber     string
	SKU            string
	Name           string
	Category       string
	Description    string
	Unit           string
	ReorderLevel   int
	Quantity       int
	AvailableQty   int
	AllocatedQty   int
	DamagedQty     int
	HoldQty        int
}

func palletCodeForOperationalSeed(itemID int64) string {
	return fmt.Sprintf("PLT-%06d-X%010d", itemID, time.Now().UTC().UnixNano()%10000000000)
}

func (s *Store) loadPalletBackedInventoryProjectionTx(ctx context.Context, tx *sql.Tx, itemID int64) (palletBackedInventoryProjection, error) {
	var projection palletBackedInventoryProjection
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
			COALESCE(pb.quantity, 0) AS quantity,
			GREATEST(COALESCE(pb.quantity, 0) - COALESCE(pb.allocated_qty, 0) - COALESCE(pb.damaged_qty, 0) - COALESCE(pb.hold_qty, 0), 0) AS available_qty,
			COALESCE(pb.allocated_qty, 0) AS allocated_qty,
			COALESCE(pb.damaged_qty, 0) AS damaged_qty,
			COALESCE(pb.hold_qty, 0) AS hold_qty
		FROM inventory_items i
		JOIN customers c ON c.id = i.customer_id
		JOIN storage_locations l ON l.id = i.location_id
		JOIN sku_master sm ON sm.id = i.sku_master_id
		LEFT JOIN (
			SELECT
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id AS location_id,
				COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP') AS storage_section,
				COALESCE(p.current_container_no, '') AS container_no,
				SUM(pi.quantity) AS quantity,
				SUM(pi.allocated_qty) AS allocated_qty,
				SUM(pi.damaged_qty) AS damaged_qty,
				SUM(pi.hold_qty) AS hold_qty
			FROM pallet_items pi
			JOIN pallets p ON p.id = pi.pallet_id
			WHERE pi.quantity > 0
			  AND p.status <> ?
			GROUP BY
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id,
				COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP'),
				COALESCE(p.current_container_no, '')
		) pb
			ON pb.sku_master_id = i.sku_master_id
			AND pb.customer_id = i.customer_id
			AND pb.location_id = i.location_id
			AND pb.storage_section = COALESCE(NULLIF(i.storage_section, ''), 'TEMP')
			AND pb.container_no = COALESCE(i.container_no, '')
		WHERE i.id = ?
		FOR UPDATE
	`, PalletStatusCancelled, itemID).Scan(
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
	); err != nil {
		if err == sql.ErrNoRows {
			return palletBackedInventoryProjection{}, ErrNotFound
		}
		return palletBackedInventoryProjection{}, fmt.Errorf("load pallet-backed inventory projection: %w", err)
	}

	projection.StorageSection = fallbackSection(projection.StorageSection)
	projection.ContainerNo = strings.TrimSpace(projection.ContainerNo)
	return projection, nil
}

func (s *Store) loadPalletBackedInventoryProjectionForBucketTx(ctx context.Context, tx *sql.Tx, bucket palletSourceBucket) (palletBackedInventoryProjection, error) {
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
		return palletBackedInventoryProjection{}, err
	}

	return s.loadPalletBackedInventoryProjectionTx(ctx, tx, itemID)
}

func (s *Store) syncPalletItemStateTx(ctx context.Context, tx *sql.Tx, input createPalletItemInput) (int64, error) {
	if input.PalletID <= 0 || input.SKUMasterID <= 0 {
		return 0, fmt.Errorf("%w: invalid pallet item input", ErrInvalidInput)
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO pallet_items (
			pallet_id,
			sku_master_id,
			quantity,
			allocated_qty,
			damaged_qty,
			hold_qty
		) VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			id = LAST_INSERT_ID(id),
			quantity = VALUES(quantity),
			allocated_qty = VALUES(allocated_qty),
			damaged_qty = VALUES(damaged_qty),
			hold_qty = VALUES(hold_qty),
			updated_at = CURRENT_TIMESTAMP
	`, input.PalletID, input.SKUMasterID, input.Quantity, input.AllocatedQty, input.DamagedQty, input.HoldQty)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("upsert pallet item: %w", err))
	}
	palletItemID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve pallet item id: %w", err)
	}
	return palletItemID, nil
}

func (s *Store) createStockLedgerEntryTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) (int64, error) {
	if input.PalletID <= 0 || input.CustomerID <= 0 || input.LocationID <= 0 {
		return 0, fmt.Errorf("%w: invalid stock ledger input", ErrInvalidInput)
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO stock_ledger (
			event_type,
			pallet_id,
			pallet_item_id,
			sku_master_id,
			customer_id,
			location_id,
			storage_section,
			quantity_change,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		firstNonEmpty(input.EventType, StockLedgerEventReceive),
		input.PalletID,
		nullableInt64(input.PalletItemID),
		nullableInt64(input.SKUMasterID),
		input.CustomerID,
		input.LocationID,
		fallbackSection(input.StorageSection),
		input.QuantityChange,
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
	return stockLedgerID, nil
}

func (s *Store) createStockLedgerTx(ctx context.Context, tx *sql.Tx, input createStockLedgerInput) error {
	_, err := s.createStockLedgerEntryTx(ctx, tx, input)
	return err
}

func (s *Store) createOutboundPickTx(ctx context.Context, tx *sql.Tx, input createOutboundPickInput) error {
	if input.OutboundLineID <= 0 || input.PalletID <= 0 || input.PalletItemID <= 0 || input.PickedQty <= 0 {
		return fmt.Errorf("%w: invalid outbound pick input", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO outbound_picks (
			outbound_line_id,
			pallet_id,
			pallet_item_id,
			picked_qty
		) VALUES (?, ?, ?, ?)
	`, input.OutboundLineID, input.PalletID, input.PalletItemID, input.PickedQty); err != nil {
		return mapDBError(fmt.Errorf("create outbound pick: %w", err))
	}
	return nil
}

func (s *Store) updatePalletStatusFromContentsTx(ctx context.Context, tx *sql.Tx, palletID int64) error {
	if palletID <= 0 {
		return nil
	}
	var remainingQty int
	if err := tx.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(quantity), 0) AS remaining_qty
		FROM pallet_items
		WHERE pallet_id = ?
	`, palletID).Scan(&remainingQty); err != nil {
		return fmt.Errorf("load pallet item totals: %w", err)
	}

	status := PalletStatusOpen
	if remainingQty <= 0 {
		status = PalletStatusShipped
	} else {
		var hasNegativeLedger bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM stock_ledger
				WHERE pallet_id = ?
				  AND quantity_change < 0
			)
		`, palletID).Scan(&hasNegativeLedger); err != nil {
			return fmt.Errorf("load pallet negative ledger state: %w", err)
		}
		if hasNegativeLedger {
			status = PalletStatusPartial
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE pallets
		SET status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, palletID); err != nil {
		return mapDBError(fmt.Errorf("update pallet status: %w", err))
	}
	return nil
}

func (s *Store) loadInventoryItemBucketTx(ctx context.Context, tx *sql.Tx, itemID int64) (inventoryItemBucket, error) {
	var bucket inventoryItemBucket
	if err := tx.QueryRowContext(ctx, `
		SELECT
			id,
			sku_master_id,
			customer_id,
			location_id,
			COALESCE(NULLIF(storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(container_no, '') AS container_no
		FROM inventory_items
		WHERE id = ?
		FOR UPDATE
	`, itemID).Scan(
		&bucket.ID,
		&bucket.SKUMasterID,
		&bucket.CustomerID,
		&bucket.LocationID,
		&bucket.StorageSection,
		&bucket.ContainerNo,
	); err != nil {
		if err == sql.ErrNoRows {
			return inventoryItemBucket{}, ErrNotFound
		}
		return inventoryItemBucket{}, fmt.Errorf("load inventory item bucket: %w", err)
	}
	bucket.StorageSection = fallbackSection(bucket.StorageSection)
	return bucket, nil
}

func (s *Store) setPalletCancelledTx(ctx context.Context, tx *sql.Tx, palletID int64) error {
	if palletID <= 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE pallets
		SET status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, PalletStatusCancelled, palletID); err != nil {
		return mapDBError(fmt.Errorf("cancel pallet: %w", err))
	}
	return nil
}

func (s *Store) restorePalletContentsForLineTx(ctx context.Context, tx *sql.Tx, outboundLineID int64) ([]outboundPickRestore, error) {
	query := `
		SELECT
			op.id,
			op.outbound_line_id,
			op.pallet_id,
			op.pallet_item_id,
			op.picked_qty,
			pi.sku_master_id,
			p.customer_id,
			p.current_location_id,
			COALESCE(p.current_storage_section, 'TEMP') AS storage_section,
			COALESCE(p.current_container_no, '') AS container_no
		FROM outbound_picks op
		JOIN pallet_items pi ON pi.id = op.pallet_item_id
		JOIN pallets p ON p.id = op.pallet_id
		WHERE op.outbound_line_id = ?
		ORDER BY op.id ASC
		FOR UPDATE
	`
	rows, err := tx.QueryContext(ctx, query, outboundLineID)
	if err != nil {
		return nil, fmt.Errorf("load outbound picks for reversal: %w", err)
	}
	defer rows.Close()

	restores := make([]outboundPickRestore, 0)
	for rows.Next() {
		var restore outboundPickRestore
		if err := rows.Scan(
			&restore.ID,
			&restore.OutboundLineID,
			&restore.PalletID,
			&restore.PalletItemID,
			&restore.PickedQty,
			&restore.SKUMasterID,
			&restore.CustomerID,
			&restore.LocationID,
			&restore.StorageSection,
			&restore.ContainerNo,
		); err != nil {
			return nil, fmt.Errorf("scan outbound pick for reversal: %w", err)
		}
		restores = append(restores, restore)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound picks for reversal: %w", err)
	}

	for _, restore := range restores {
		if _, err := tx.ExecContext(ctx, `
			UPDATE pallet_items
			SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, restore.PickedQty, restore.PalletItemID); err != nil {
			return nil, mapDBError(fmt.Errorf("restore pallet item quantity: %w", err))
		}
		if err := s.updatePalletStatusFromContentsTx(ctx, tx, restore.PalletID); err != nil {
			return nil, err
		}
	}

	return restores, nil
}

func firstNonZeroInt64(values ...int64) int64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func (s *Store) applyPalletDeltaForItemTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	skuMasterID int64,
	quantityDelta int,
) ([]palletContentConsumption, error) {
	if itemID <= 0 || skuMasterID <= 0 || quantityDelta == 0 {
		return []palletContentConsumption{}, nil
	}

	if quantityDelta < 0 {
		return s.consumePalletContentsForItemTx(ctx, tx, itemID, skuMasterID, -quantityDelta)
	}

	itemBucket, err := s.loadInventoryItemBucketTx(ctx, tx, itemID)
	if err != nil {
		return nil, err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT
			pi.id,
			pi.pallet_id,
			pi.sku_master_id,
			p.customer_id,
			p.current_location_id,
			COALESCE(p.current_storage_section, 'TEMP') AS current_storage_section
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE pi.sku_master_id = ?
		  AND p.customer_id = ?
		  AND p.current_location_id = ?
		  AND COALESCE(p.current_storage_section, 'TEMP') = ?
		  AND COALESCE(p.current_container_no, '') = ?
		ORDER BY pi.quantity DESC, pi.id ASC
		LIMIT 1
		FOR UPDATE
	`, skuMasterID, itemBucket.CustomerID, itemBucket.LocationID, itemBucket.StorageSection, strings.TrimSpace(itemBucket.ContainerNo))
	if err != nil {
		return nil, fmt.Errorf("load pallet content for positive delta: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		pallet, err := s.createPalletTx(ctx, tx, createPalletInput{
			PalletCode:            palletCodeForOperationalSeed(itemID),
			CustomerID:            itemBucket.CustomerID,
			SKUMasterID:           skuMasterID,
			CurrentLocationID:     itemBucket.LocationID,
			CurrentStorageSection: itemBucket.StorageSection,
			CurrentContainerNo:    itemBucket.ContainerNo,
			Status:                PalletStatusOpen,
		})
		if err != nil {
			return nil, err
		}
		palletItemID, err := s.createPalletItemTx(ctx, tx, createPalletItemInput{
			PalletID:    pallet.ID,
			SKUMasterID: skuMasterID,
			Quantity:    quantityDelta,
		})
		if err != nil {
			return nil, err
		}
		return []palletContentConsumption{
			{
				PalletID:       pallet.ID,
				PalletItemID:   palletItemID,
				SKUMasterID:    skuMasterID,
				Quantity:       quantityDelta,
				CustomerID:     itemBucket.CustomerID,
				LocationID:     itemBucket.LocationID,
				StorageSection: fallbackSection(itemBucket.StorageSection),
				ContainerNo:    strings.TrimSpace(itemBucket.ContainerNo),
			},
		}, nil
	}

	var (
		palletItemID       int64
		palletID           int64
		contentSKUMasterID int64
		customerID         int64
		locationID         int64
		storageSection     string
	)
	if err := rows.Scan(
		&palletItemID,
		&palletID,
		&contentSKUMasterID,
		&customerID,
		&locationID,
		&storageSection,
	); err != nil {
		return nil, fmt.Errorf("scan pallet content for positive delta: %w", err)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pallet content for positive delta: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE pallet_items
		SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, quantityDelta, palletItemID); err != nil {
		return nil, mapDBError(fmt.Errorf("increase pallet item quantity: %w", err))
	}
	if err := s.updatePalletStatusFromContentsTx(ctx, tx, palletID); err != nil {
		return nil, err
	}

	return []palletContentConsumption{
		{
			PalletID:       palletID,
			PalletItemID:   palletItemID,
			SKUMasterID:    contentSKUMasterID,
			Quantity:       quantityDelta,
			CustomerID:     customerID,
			LocationID:     locationID,
			StorageSection: fallbackSection(storageSection),
			ContainerNo:    strings.TrimSpace(itemBucket.ContainerNo),
		},
	}, nil
}

func (s *Store) consumePalletContentsForItemTx(ctx context.Context, tx *sql.Tx, itemID int64, skuMasterID int64, quantity int) ([]palletContentConsumption, error) {
	if itemID <= 0 || skuMasterID <= 0 || quantity <= 0 {
		return nil, fmt.Errorf("%w: invalid pallet item consumption input", ErrInvalidInput)
	}

	itemBucket, err := s.loadInventoryItemBucketTx(ctx, tx, itemID)
	if err != nil {
		return nil, err
	}

	return s.consumePalletContentsForBucketTx(ctx, tx, palletSourceBucket{
		SKUMasterID:    skuMasterID,
		CustomerID:     itemBucket.CustomerID,
		LocationID:     itemBucket.LocationID,
		StorageSection: itemBucket.StorageSection,
		ContainerNo:    strings.TrimSpace(itemBucket.ContainerNo),
	}, quantity)
}

func (s *Store) consumeSpecificPalletContentsForBucketTx(
	ctx context.Context,
	tx *sql.Tx,
	bucket palletSourceBucket,
	palletID int64,
	skuMasterID int64,
	quantity int,
) ([]palletContentConsumption, error) {
	if bucket.SKUMasterID <= 0 || bucket.CustomerID <= 0 || bucket.LocationID <= 0 || palletID <= 0 || skuMasterID <= 0 || quantity <= 0 {
		return nil, fmt.Errorf("%w: invalid selected pallet consumption input", ErrInvalidInput)
	}

	storageSection := fallbackSection(bucket.StorageSection)
	containerNo := strings.TrimSpace(bucket.ContainerNo)

	var content struct {
		PalletItemID            int64
		PalletID                int64
		SKUMasterID             int64
		RemainingQty            int
		AllocatedQty            int
		DamagedQty              int
		HoldQty                 int
		CustomerID              int64
		LocationID              int64
		StorageSection          string
		ContainerVisitID        int64
		SourceInboundDocumentID int64
		SourceInboundLineID     int64
		ContainerNo             string
	}

	if err := tx.QueryRowContext(ctx, `
		SELECT
			pi.id,
			pi.pallet_id,
			pi.sku_master_id,
			pi.quantity,
			pi.allocated_qty,
			pi.damaged_qty,
			pi.hold_qty,
			p.customer_id,
			p.current_location_id,
			COALESCE(p.current_storage_section, 'TEMP') AS current_storage_section,
			COALESCE(p.container_visit_id, 0) AS container_visit_id,
			COALESCE(p.source_inbound_document_id, 0) AS source_inbound_document_id,
			COALESCE(p.source_inbound_line_id, 0) AS source_inbound_line_id,
			COALESCE(p.current_container_no, '') AS current_container_no
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.id = ?
		  AND pi.sku_master_id = ?
		  AND p.customer_id = ?
		  AND p.current_location_id = ?
		  AND COALESCE(p.current_storage_section, 'TEMP') = ?
		  AND COALESCE(p.current_container_no, '') = ?
		FOR UPDATE
	`, palletID, skuMasterID, bucket.CustomerID, bucket.LocationID, storageSection, containerNo).Scan(
		&content.PalletItemID,
		&content.PalletID,
		&content.SKUMasterID,
		&content.RemainingQty,
		&content.AllocatedQty,
		&content.DamagedQty,
		&content.HoldQty,
		&content.CustomerID,
		&content.LocationID,
		&content.StorageSection,
		&content.ContainerVisitID,
		&content.SourceInboundDocumentID,
		&content.SourceInboundLineID,
		&content.ContainerNo,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("%w: selected pallet is not available in this stock position", ErrInvalidInput)
		}
		return nil, fmt.Errorf("load selected pallet contents: %w", err)
	}

	availableQty := content.RemainingQty - content.AllocatedQty - content.DamagedQty - content.HoldQty
	if quantity > availableQty {
		return nil, ErrInsufficientStock
	}

	nextRemainingQty := content.RemainingQty - quantity
	if _, err := tx.ExecContext(ctx, `
		UPDATE pallet_items
		SET quantity = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nextRemainingQty, content.PalletItemID); err != nil {
		return nil, mapDBError(fmt.Errorf("consume selected pallet item quantity: %w", err))
	}
	if err := s.updatePalletStatusFromContentsTx(ctx, tx, content.PalletID); err != nil {
		return nil, err
	}

	return []palletContentConsumption{{
		PalletID:                content.PalletID,
		PalletItemID:            content.PalletItemID,
		SKUMasterID:             content.SKUMasterID,
		Quantity:                quantity,
		CustomerID:              content.CustomerID,
		LocationID:              content.LocationID,
		StorageSection:          fallbackSection(content.StorageSection),
		ContainerVisitID:        content.ContainerVisitID,
		SourceInboundDocumentID: content.SourceInboundDocumentID,
		SourceInboundLineID:     content.SourceInboundLineID,
		ContainerNo:             strings.TrimSpace(content.ContainerNo),
	}}, nil
}

func (s *Store) consumePalletContentsForBucketTx(ctx context.Context, tx *sql.Tx, bucket palletSourceBucket, quantity int) ([]palletContentConsumption, error) {
	if bucket.SKUMasterID <= 0 || bucket.CustomerID <= 0 || bucket.LocationID <= 0 || quantity <= 0 {
		return nil, fmt.Errorf("%w: invalid pallet bucket consumption input", ErrInvalidInput)
	}

	storageSection := fallbackSection(bucket.StorageSection)
	containerNo := strings.TrimSpace(bucket.ContainerNo)

	rows, err := tx.QueryContext(ctx, `
		SELECT
			pi.id,
			pi.pallet_id,
			pi.sku_master_id,
			pi.quantity,
			pi.allocated_qty,
			pi.damaged_qty,
			pi.hold_qty,
			p.customer_id,
			p.current_location_id,
			COALESCE(p.current_storage_section, 'TEMP') AS current_storage_section,
			COALESCE(p.container_visit_id, 0) AS container_visit_id,
			COALESCE(p.source_inbound_document_id, 0) AS source_inbound_document_id,
			COALESCE(p.source_inbound_line_id, 0) AS source_inbound_line_id,
			COALESCE(p.current_container_no, '') AS current_container_no
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE pi.sku_master_id = ?
		  AND p.customer_id = ?
		  AND p.current_location_id = ?
		  AND COALESCE(p.current_storage_section, 'TEMP') = ?
		  AND COALESCE(p.current_container_no, '') = ?
		  AND pi.quantity > 0
		ORDER BY pi.pallet_id ASC, pi.id ASC
		FOR UPDATE
	`, bucket.SKUMasterID, bucket.CustomerID, bucket.LocationID, storageSection, containerNo)
	if err != nil {
		return nil, fmt.Errorf("load pallet contents for bucket consumption: %w", err)
	}
	defer rows.Close()

	type row struct {
		PalletItemID            int64
		PalletID                int64
		SKUMasterID             int64
		RemainingQty            int
		AllocatedQty            int
		DamagedQty              int
		HoldQty                 int
		CustomerID              int64
		LocationID              int64
		StorageSection          string
		ContainerVisitID        int64
		SourceInboundDocumentID int64
		SourceInboundLineID     int64
		ContainerNo             string
	}

	contentRows := make([]row, 0)
	for rows.Next() {
		var content row
		if err := rows.Scan(
			&content.PalletItemID,
			&content.PalletID,
			&content.SKUMasterID,
			&content.RemainingQty,
			&content.AllocatedQty,
			&content.DamagedQty,
			&content.HoldQty,
			&content.CustomerID,
			&content.LocationID,
			&content.StorageSection,
			&content.ContainerVisitID,
			&content.SourceInboundDocumentID,
			&content.SourceInboundLineID,
			&content.ContainerNo,
		); err != nil {
			return nil, fmt.Errorf("scan pallet contents for bucket consumption: %w", err)
		}
		contentRows = append(contentRows, content)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pallet contents for bucket consumption: %w", err)
	}
	if len(contentRows) == 0 {
		return []palletContentConsumption{}, nil
	}

	remainingQuantity := quantity
	consumptions := make([]palletContentConsumption, 0)
	for _, content := range contentRows {
		if remainingQuantity <= 0 {
			break
		}
		availableQty := content.RemainingQty - content.AllocatedQty - content.DamagedQty - content.HoldQty
		consumeQty := availableQty
		if consumeQty > remainingQuantity {
			consumeQty = remainingQuantity
		}
		if consumeQty <= 0 {
			continue
		}

		nextRemainingQty := content.RemainingQty - consumeQty
		if _, err := tx.ExecContext(ctx, `
			UPDATE pallet_items
			SET quantity = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nextRemainingQty, content.PalletItemID); err != nil {
			return nil, mapDBError(fmt.Errorf("consume pallet item quantity by bucket: %w", err))
		}
		if err := s.updatePalletStatusFromContentsTx(ctx, tx, content.PalletID); err != nil {
			return nil, err
		}

		consumptions = append(consumptions, palletContentConsumption{
			PalletID:                content.PalletID,
			PalletItemID:            content.PalletItemID,
			SKUMasterID:             content.SKUMasterID,
			Quantity:                consumeQty,
			CustomerID:              content.CustomerID,
			LocationID:              content.LocationID,
			StorageSection:          fallbackSection(content.StorageSection),
			ContainerVisitID:        content.ContainerVisitID,
			SourceInboundDocumentID: content.SourceInboundDocumentID,
			SourceInboundLineID:     content.SourceInboundLineID,
			ContainerNo:             strings.TrimSpace(content.ContainerNo),
		})
		remainingQuantity -= consumeQty
	}

	if remainingQuantity > 0 {
		return nil, ErrInsufficientStock
	}

	return consumptions, nil
}

func (s *Store) consumePalletContentsForInboundLineTx(ctx context.Context, tx *sql.Tx, sourceInboundLineID int64, skuMasterID int64, quantity int, newestFirst bool) ([]palletContentConsumption, error) {
	if sourceInboundLineID <= 0 || skuMasterID <= 0 || quantity <= 0 {
		return nil, fmt.Errorf("%w: invalid inbound-line pallet consumption input", ErrInvalidInput)
	}

	orderDirection := "ASC"
	if newestFirst {
		orderDirection = "DESC"
	}
	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`
		SELECT
			pi.id,
			pi.pallet_id,
			pi.sku_master_id,
			pi.quantity,
			pi.allocated_qty,
			pi.damaged_qty,
			pi.hold_qty,
			p.customer_id,
			p.current_location_id,
			COALESCE(p.current_storage_section, 'TEMP') AS current_storage_section,
			COALESCE(p.container_visit_id, 0) AS container_visit_id,
			COALESCE(p.source_inbound_document_id, 0) AS source_inbound_document_id,
			COALESCE(p.source_inbound_line_id, 0) AS source_inbound_line_id,
			COALESCE(p.current_container_no, '') AS current_container_no
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.source_inbound_line_id = ?
		  AND pi.sku_master_id = ?
		  AND pi.quantity > 0
		  AND p.status <> ?
		ORDER BY p.created_at %s, p.id %s, pi.id %s
		FOR UPDATE
	`, orderDirection, orderDirection, orderDirection), sourceInboundLineID, skuMasterID, PalletStatusCancelled)
	if err != nil {
		return nil, fmt.Errorf("load pallet contents for inbound line consumption: %w", err)
	}
	defer rows.Close()

	type row struct {
		PalletItemID            int64
		PalletID                int64
		SKUMasterID             int64
		RemainingQty            int
		AllocatedQty            int
		DamagedQty              int
		HoldQty                 int
		CustomerID              int64
		LocationID              int64
		StorageSection          string
		ContainerVisitID        int64
		SourceInboundDocumentID int64
		SourceInboundLineID     int64
		ContainerNo             string
	}

	contentRows := make([]row, 0)
	for rows.Next() {
		var content row
		if err := rows.Scan(
			&content.PalletItemID,
			&content.PalletID,
			&content.SKUMasterID,
			&content.RemainingQty,
			&content.AllocatedQty,
			&content.DamagedQty,
			&content.HoldQty,
			&content.CustomerID,
			&content.LocationID,
			&content.StorageSection,
			&content.ContainerVisitID,
			&content.SourceInboundDocumentID,
			&content.SourceInboundLineID,
			&content.ContainerNo,
		); err != nil {
			return nil, fmt.Errorf("scan pallet contents for inbound line consumption: %w", err)
		}
		contentRows = append(contentRows, content)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pallet contents for inbound line consumption: %w", err)
	}
	if len(contentRows) == 0 {
		return []palletContentConsumption{}, nil
	}

	remainingQuantity := quantity
	consumptions := make([]palletContentConsumption, 0)
	for _, content := range contentRows {
		if remainingQuantity <= 0 {
			break
		}
		availableQty := content.RemainingQty - content.AllocatedQty - content.DamagedQty - content.HoldQty
		consumeQty := availableQty
		if consumeQty > remainingQuantity {
			consumeQty = remainingQuantity
		}
		if consumeQty <= 0 {
			continue
		}

		nextRemainingQty := content.RemainingQty - consumeQty
		if _, err := tx.ExecContext(ctx, `
			UPDATE pallet_items
			SET quantity = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nextRemainingQty, content.PalletItemID); err != nil {
			return nil, mapDBError(fmt.Errorf("consume inbound-line pallet item quantity: %w", err))
		}
		if err := s.updatePalletStatusFromContentsTx(ctx, tx, content.PalletID); err != nil {
			return nil, err
		}

		consumptions = append(consumptions, palletContentConsumption{
			PalletID:                content.PalletID,
			PalletItemID:            content.PalletItemID,
			SKUMasterID:             content.SKUMasterID,
			Quantity:                consumeQty,
			CustomerID:              content.CustomerID,
			LocationID:              content.LocationID,
			StorageSection:          fallbackSection(content.StorageSection),
			ContainerVisitID:        content.ContainerVisitID,
			SourceInboundDocumentID: content.SourceInboundDocumentID,
			SourceInboundLineID:     content.SourceInboundLineID,
			ContainerNo:             strings.TrimSpace(content.ContainerNo),
		})
		remainingQuantity -= consumeQty
	}

	if remainingQuantity > 0 {
		return nil, ErrInsufficientStock
	}

	return consumptions, nil
}
