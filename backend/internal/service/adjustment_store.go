package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type InventoryAdjustment struct {
	ID             int64                     `json:"id"`
	AdjustmentNo   string                    `json:"adjustmentNo"`
	ReasonCode     string                    `json:"reasonCode"`
	Notes          string                    `json:"notes"`
	Status         string                    `json:"status"`
	TotalLines     int                       `json:"totalLines"`
	TotalAdjustQty int                       `json:"totalAdjustQty"`
	CreatedAt      time.Time                 `json:"createdAt"`
	UpdatedAt      time.Time                 `json:"updatedAt"`
	Lines          []InventoryAdjustmentLine `json:"lines"`
}

type InventoryAdjustmentLine struct {
	ID             int64     `json:"id"`
	AdjustmentID   int64     `json:"adjustmentId"`
	CustomerID     int64     `json:"customerId"`
	CustomerName   string    `json:"customerName"`
	LocationID     int64     `json:"locationId"`
	LocationName   string    `json:"locationName"`
	StorageSection string    `json:"storageSection"`
	SKU            string    `json:"sku"`
	Description    string    `json:"description"`
	BeforeQty      int       `json:"beforeQty"`
	AdjustQty      int       `json:"adjustQty"`
	AfterQty       int       `json:"afterQty"`
	LineNote       string    `json:"lineNote"`
	CreatedAt      time.Time `json:"createdAt"`
}

type CreateInventoryAdjustmentInput struct {
	AdjustmentNo string                               `json:"adjustmentNo"`
	ReasonCode   string                               `json:"reasonCode"`
	Notes        string                               `json:"notes"`
	Lines        []CreateInventoryAdjustmentLineInput `json:"lines"`
}

type CreateInventoryAdjustmentLineInput struct {
	CustomerID     int64  `json:"customerId"`
	LocationID     int64  `json:"locationId"`
	StorageSection string `json:"storageSection"`
	ContainerNo    string `json:"containerNo"`
	PalletID       int64  `json:"palletId"`
	SKUMasterID    int64  `json:"skuMasterId"`
	AdjustQty      int    `json:"adjustQty"`
	LineNote       string `json:"lineNote"`
}

type inventoryAdjustmentRow struct {
	ID           int64     `db:"id"`
	AdjustmentNo string    `db:"adjustment_no"`
	ReasonCode   string    `db:"reason_code"`
	Notes        string    `db:"notes"`
	Status       string    `db:"status"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}

type inventoryAdjustmentLineRow struct {
	ID                   int64     `db:"id"`
	AdjustmentID         int64     `db:"adjustment_id"`
	CustomerID           int64     `db:"customer_id"`
	CustomerNameSnapshot string    `db:"customer_name_snapshot"`
	LocationID           int64     `db:"location_id"`
	LocationNameSnapshot string    `db:"location_name_snapshot"`
	StorageSection       string    `db:"storage_section"`
	SKUSnapshot          string    `db:"sku_snapshot"`
	DescriptionSnapshot  string    `db:"description_snapshot"`
	BeforeQty            int       `db:"before_qty"`
	AdjustQty            int       `db:"adjust_qty"`
	AfterQty             int       `db:"after_qty"`
	LineNote             string    `db:"line_note"`
	CreatedAt            time.Time `db:"created_at"`
}

type lockedAdjustmentItem struct {
	ItemID         int64
	SKUMasterID    int64
	CustomerID     int64
	CustomerName   string
	LocationID     int64
	LocationName   string
	StorageSection string
	SKU            string
	Description    string
	Unit           string
	Quantity       int
}

func (s *Store) ListInventoryAdjustments(ctx context.Context, limit int) ([]InventoryAdjustment, error) {
	if limit <= 0 {
		limit = 50
	}

	adjustmentRows := make([]inventoryAdjustmentRow, 0)
	if err := s.db.SelectContext(ctx, &adjustmentRows, `
		SELECT
			id,
			adjustment_no,
			reason_code,
			COALESCE(notes, '') AS notes,
			status,
			created_at,
			updated_at
		FROM inventory_adjustments
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, limit); err != nil {
		return nil, fmt.Errorf("load inventory adjustments: %w", err)
	}
	if len(adjustmentRows) == 0 {
		return []InventoryAdjustment{}, nil
	}

	adjustmentIDs := make([]int64, 0, len(adjustmentRows))
	adjustments := make([]InventoryAdjustment, 0, len(adjustmentRows))
	adjustmentsByID := make(map[int64]*InventoryAdjustment, len(adjustmentRows))
	for _, row := range adjustmentRows {
		adjustment := InventoryAdjustment{
			ID:           row.ID,
			AdjustmentNo: row.AdjustmentNo,
			ReasonCode:   row.ReasonCode,
			Notes:        row.Notes,
			Status:       row.Status,
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
			Lines:        make([]InventoryAdjustmentLine, 0),
		}
		adjustments = append(adjustments, adjustment)
		adjustmentIDs = append(adjustmentIDs, row.ID)
		adjustmentsByID[row.ID] = &adjustments[len(adjustments)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			adjustment_id,
			customer_id,
			customer_name_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			before_qty,
			adjust_qty,
			after_qty,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inventory_adjustment_lines
		WHERE adjustment_id IN (?)
		ORDER BY adjustment_id DESC, sort_order ASC, id ASC
	`, adjustmentIDs)
	if err != nil {
		return nil, fmt.Errorf("build adjustment lines query: %w", err)
	}

	lineRows := make([]inventoryAdjustmentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), args...); err != nil {
		return nil, fmt.Errorf("load adjustment lines: %w", err)
	}

	for _, lineRow := range lineRows {
		adjustment := adjustmentsByID[lineRow.AdjustmentID]
		if adjustment == nil {
			continue
		}
		adjustment.Lines = append(adjustment.Lines, InventoryAdjustmentLine{
			ID:             lineRow.ID,
			AdjustmentID:   lineRow.AdjustmentID,
			CustomerID:     lineRow.CustomerID,
			CustomerName:   lineRow.CustomerNameSnapshot,
			LocationID:     lineRow.LocationID,
			LocationName:   lineRow.LocationNameSnapshot,
			StorageSection: fallbackSection(lineRow.StorageSection),
			SKU:            lineRow.SKUSnapshot,
			Description:    lineRow.DescriptionSnapshot,
			BeforeQty:      lineRow.BeforeQty,
			AdjustQty:      lineRow.AdjustQty,
			AfterQty:       lineRow.AfterQty,
			LineNote:       lineRow.LineNote,
			CreatedAt:      lineRow.CreatedAt,
		})
		adjustment.TotalLines++
		adjustment.TotalAdjustQty += lineRow.AdjustQty
	}

	return adjustments, nil
}

func (s *Store) CreateInventoryAdjustment(ctx context.Context, input CreateInventoryAdjustmentInput) (InventoryAdjustment, error) {
	input = sanitizeInventoryAdjustmentInput(input)
	if err := validateInventoryAdjustmentInput(input); err != nil {
		return InventoryAdjustment{}, err
	}
	if input.AdjustmentNo == "" {
		input.AdjustmentNo = generateAdjustmentNo()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryAdjustment{}, fmt.Errorf("begin adjustment transaction: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_adjustments (
			adjustment_no,
			reason_code,
			notes,
			status
		) VALUES (?, ?, ?, 'POSTED')
	`,
		input.AdjustmentNo,
		input.ReasonCode,
		nullableString(input.Notes),
	)
	if err != nil {
		return InventoryAdjustment{}, mapDBError(fmt.Errorf("create inventory adjustment: %w", err))
	}

	adjustmentID, err := result.LastInsertId()
	if err != nil {
		return InventoryAdjustment{}, fmt.Errorf("resolve adjustment id: %w", err)
	}

	for index, line := range input.Lines {
		lockedItem, err := s.loadLockedAdjustmentItem(ctx, tx, palletSourceBucket{
			SKUMasterID:    line.SKUMasterID,
			CustomerID:     line.CustomerID,
			LocationID:     line.LocationID,
			StorageSection: line.StorageSection,
			ContainerNo:    line.ContainerNo,
		})
		if err != nil {
			return InventoryAdjustment{}, err
		}

		afterQty := lockedItem.Quantity + line.AdjustQty
		if afterQty < 0 {
			return InventoryAdjustment{}, ErrInsufficientStock
		}

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO inventory_adjustment_lines (
				adjustment_id,
				customer_id,
				customer_name_snapshot,
				location_id,
				location_name_snapshot,
				storage_section,
				sku_snapshot,
				description_snapshot,
				before_qty,
				adjust_qty,
				after_qty,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			adjustmentID,
			lockedItem.CustomerID,
			lockedItem.CustomerName,
			lockedItem.LocationID,
			lockedItem.LocationName,
			fallbackSection(lockedItem.StorageSection),
			lockedItem.SKU,
			nullableString(lockedItem.Description),
			lockedItem.Quantity,
			line.AdjustQty,
			afterQty,
			nullableString(line.LineNote),
			index+1,
		)
		if err != nil {
			return InventoryAdjustment{}, mapDBError(fmt.Errorf("create adjustment line: %w", err))
		}

		lineID, err := lineResult.LastInsertId()
		if err != nil {
			return InventoryAdjustment{}, fmt.Errorf("resolve adjustment line id: %w", err)
		}

		reason := firstNonEmpty(line.LineNote, fmt.Sprintf("Adjustment posted: %s", input.ReasonCode))

		palletAdjustments, err := s.applyAdjustmentPalletDeltaTx(ctx, tx, lockedItem.ItemID, line)
		if err != nil {
			return InventoryAdjustment{}, err
		}
		deltaSign := 1
		if line.AdjustQty < 0 {
			deltaSign = -1
		}
		for _, palletAdjustment := range palletAdjustments {
			if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
				EventType:           StockLedgerEventAdjust,
				PalletID:            palletAdjustment.PalletID,
				PalletItemID:        palletAdjustment.PalletItemID,
				SKUMasterID:         palletAdjustment.SKUMasterID,
				CustomerID:          palletAdjustment.CustomerID,
				LocationID:          palletAdjustment.LocationID,
				StorageSection:      palletAdjustment.StorageSection,
				QuantityChange:      deltaSign * palletAdjustment.Quantity,
				SourceDocumentType:  StockLedgerSourceAdjustment,
				SourceDocumentID:    adjustmentID,
				SourceLineID:        lineID,
				ContainerNo:         palletAdjustment.ContainerNo,
				DescriptionSnapshot: lockedItem.Description,
				Reason:              reason,
			}); err != nil {
				return InventoryAdjustment{}, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return InventoryAdjustment{}, fmt.Errorf("commit adjustment: %w", err)
	}

	return s.getInventoryAdjustment(ctx, adjustmentID)
}

func (s *Store) getInventoryAdjustment(ctx context.Context, adjustmentID int64) (InventoryAdjustment, error) {
	adjustments, err := s.listInventoryAdjustmentsByIDs(ctx, []int64{adjustmentID})
	if err != nil {
		return InventoryAdjustment{}, err
	}
	if len(adjustments) == 0 {
		return InventoryAdjustment{}, ErrNotFound
	}
	return adjustments[0], nil
}

func (s *Store) listInventoryAdjustmentsByIDs(ctx context.Context, adjustmentIDs []int64) ([]InventoryAdjustment, error) {
	if len(adjustmentIDs) == 0 {
		return []InventoryAdjustment{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			id,
			adjustment_no,
			reason_code,
			COALESCE(notes, '') AS notes,
			status,
			created_at,
			updated_at
		FROM inventory_adjustments
		WHERE id IN (?)
		ORDER BY created_at DESC, id DESC
	`, adjustmentIDs)
	if err != nil {
		return nil, fmt.Errorf("build adjustment query: %w", err)
	}

	adjustmentRows := make([]inventoryAdjustmentRow, 0)
	if err := s.db.SelectContext(ctx, &adjustmentRows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load adjustments by id: %w", err)
	}
	if len(adjustmentRows) == 0 {
		return []InventoryAdjustment{}, nil
	}

	adjustments := make([]InventoryAdjustment, 0, len(adjustmentRows))
	adjustmentsByID := make(map[int64]*InventoryAdjustment, len(adjustmentRows))
	for _, row := range adjustmentRows {
		adjustment := InventoryAdjustment{
			ID:           row.ID,
			AdjustmentNo: row.AdjustmentNo,
			ReasonCode:   row.ReasonCode,
			Notes:        row.Notes,
			Status:       row.Status,
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
			Lines:        make([]InventoryAdjustmentLine, 0),
		}
		adjustments = append(adjustments, adjustment)
		adjustmentsByID[row.ID] = &adjustments[len(adjustments)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			adjustment_id,
			customer_id,
			customer_name_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			before_qty,
			adjust_qty,
			after_qty,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inventory_adjustment_lines
		WHERE adjustment_id IN (?)
		ORDER BY adjustment_id DESC, sort_order ASC, id ASC
	`, adjustmentIDs)
	if err != nil {
		return nil, fmt.Errorf("build adjustment line query by id: %w", err)
	}

	lineRows := make([]inventoryAdjustmentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load adjustment lines by id: %w", err)
	}

	for _, lineRow := range lineRows {
		adjustment := adjustmentsByID[lineRow.AdjustmentID]
		if adjustment == nil {
			continue
		}
		adjustment.Lines = append(adjustment.Lines, InventoryAdjustmentLine{
			ID:             lineRow.ID,
			AdjustmentID:   lineRow.AdjustmentID,
			CustomerID:     lineRow.CustomerID,
			CustomerName:   lineRow.CustomerNameSnapshot,
			LocationID:     lineRow.LocationID,
			LocationName:   lineRow.LocationNameSnapshot,
			StorageSection: fallbackSection(lineRow.StorageSection),
			SKU:            lineRow.SKUSnapshot,
			Description:    lineRow.DescriptionSnapshot,
			BeforeQty:      lineRow.BeforeQty,
			AdjustQty:      lineRow.AdjustQty,
			AfterQty:       lineRow.AfterQty,
			LineNote:       lineRow.LineNote,
			CreatedAt:      lineRow.CreatedAt,
		})
		adjustment.TotalLines++
		adjustment.TotalAdjustQty += lineRow.AdjustQty
	}

	return adjustments, nil
}

func (s *Store) loadLockedAdjustmentItem(ctx context.Context, tx *sql.Tx, bucket palletSourceBucket) (lockedAdjustmentItem, error) {
	projection, err := s.loadPalletBackedInventoryProjectionForBucketTx(ctx, tx, bucket)
	if err != nil {
		return lockedAdjustmentItem{}, err
	}

	return lockedAdjustmentItem{
		ItemID:         projection.ItemID,
		SKUMasterID:    projection.SKUMasterID,
		CustomerID:     projection.CustomerID,
		CustomerName:   projection.CustomerName,
		LocationID:     projection.LocationID,
		LocationName:   projection.LocationName,
		StorageSection: projection.StorageSection,
		SKU:            projection.SKU,
		Description:    projection.Description,
		Unit:           projection.Unit,
		Quantity:       projection.Quantity,
	}, nil
}

func sanitizeInventoryAdjustmentInput(input CreateInventoryAdjustmentInput) CreateInventoryAdjustmentInput {
	input.AdjustmentNo = strings.TrimSpace(strings.ToUpper(input.AdjustmentNo))
	input.ReasonCode = strings.TrimSpace(strings.ToUpper(input.ReasonCode))
	input.Notes = strings.TrimSpace(input.Notes)

	lines := make([]CreateInventoryAdjustmentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.StorageSection = normalizeStorageSection(line.StorageSection)
		line.ContainerNo = strings.TrimSpace(strings.ToUpper(line.ContainerNo))
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 || line.AdjustQty == 0 {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateInventoryAdjustmentInput(input CreateInventoryAdjustmentInput) error {
	if input.ReasonCode == "" {
		return fmt.Errorf("%w: reason code is required", ErrInvalidInput)
	}
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one adjustment line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: storage is required", ErrInvalidInput)
		case line.PalletID < 0:
			return fmt.Errorf("%w: pallet is invalid", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: sku is required", ErrInvalidInput)
		case line.AdjustQty == 0:
			return fmt.Errorf("%w: adjustment quantity cannot be zero", ErrInvalidInput)
		case line.PalletID > 0 && line.AdjustQty > 0:
			return fmt.Errorf("%w: pallet-based adjustments only support reducing existing pallet stock", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Store) applyAdjustmentPalletDeltaTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	line CreateInventoryAdjustmentLineInput,
) ([]palletContentConsumption, error) {
	if line.PalletID > 0 {
		return s.consumeSpecificPalletContentsForBucketTx(ctx, tx, palletSourceBucket{
			SKUMasterID:    line.SKUMasterID,
			CustomerID:     line.CustomerID,
			LocationID:     line.LocationID,
			StorageSection: line.StorageSection,
			ContainerNo:    line.ContainerNo,
		}, line.PalletID, line.SKUMasterID, -line.AdjustQty)
	}

	return s.applyPalletDeltaForItemTx(ctx, tx, itemID, line.SKUMasterID, line.AdjustQty)
}

func generateAdjustmentNo() string {
	now := time.Now().UTC()
	return fmt.Sprintf("ADJ-%s-%04d", now.Format("20060102-150405"), now.Nanosecond()%10000)
}
