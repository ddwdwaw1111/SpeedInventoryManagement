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
	MovementID     int64     `json:"movementId"`
	ItemID         int64     `json:"itemId"`
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
	AdjustmentNo string                             `json:"adjustmentNo"`
	ReasonCode   string                             `json:"reasonCode"`
	Notes        string                             `json:"notes"`
	Lines        []CreateInventoryAdjustmentLineInput `json:"lines"`
}

type CreateInventoryAdjustmentLineInput struct {
	ItemID    int64  `json:"itemId"`
	AdjustQty int    `json:"adjustQty"`
	LineNote  string `json:"lineNote"`
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
	MovementID           int64     `db:"movement_id"`
	ItemID               int64     `db:"item_id"`
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
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
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
			MovementID:     lineRow.MovementID,
			ItemID:         lineRow.ItemID,
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
		lockedItem, err := s.loadLockedAdjustmentItem(ctx, tx, line.ItemID)
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
				item_id,
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
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			adjustmentID,
			lockedItem.ItemID,
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
		movementResult, err := tx.ExecContext(ctx, `
			INSERT INTO stock_movements (
				item_id,
				adjustment_id,
				adjustment_line_id,
				customer_id,
				location_id,
				storage_section,
				movement_type,
				quantity_change,
				description_snapshot,
				unit_label,
				height_in,
				document_note,
				reason
			) VALUES (?, ?, ?, ?, ?, ?, 'ADJUST', ?, ?, ?, 0, ?, ?)
		`,
			lockedItem.ItemID,
			adjustmentID,
			lineID,
			lockedItem.CustomerID,
			lockedItem.LocationID,
			fallbackSection(lockedItem.StorageSection),
			line.AdjustQty,
			nullableString(lockedItem.Description),
			nullableString(strings.ToUpper(lockedItem.Unit)),
			nullableString(input.Notes),
			nullableString(reason),
		)
		if err != nil {
			return InventoryAdjustment{}, mapDBError(fmt.Errorf("create adjustment movement: %w", err))
		}

		movementID, err := movementResult.LastInsertId()
		if err != nil {
			return InventoryAdjustment{}, fmt.Errorf("resolve adjustment movement id: %w", err)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inventory_adjustment_lines
			SET movement_id = ?
			WHERE id = ?
		`, movementID, lineID); err != nil {
			return InventoryAdjustment{}, mapDBError(fmt.Errorf("link adjustment line to movement: %w", err))
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET quantity = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, afterQty, lockedItem.ItemID); err != nil {
			return InventoryAdjustment{}, mapDBError(fmt.Errorf("update inventory after adjustment: %w", err))
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
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
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
			MovementID:     lineRow.MovementID,
			ItemID:         lineRow.ItemID,
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

func (s *Store) loadLockedAdjustmentItem(ctx context.Context, tx *sql.Tx, itemID int64) (lockedAdjustmentItem, error) {
	var item lockedAdjustmentItem
	if err := tx.QueryRowContext(ctx, `
		SELECT
			i.id,
			i.customer_id,
			c.name,
			i.location_id,
			l.name,
			i.storage_section,
			i.sku,
			COALESCE(i.description, i.name, ''),
			COALESCE(i.unit, 'pcs'),
			i.quantity
		FROM inventory_items i
		JOIN customers c ON c.id = i.customer_id
		JOIN storage_locations l ON l.id = i.location_id
		WHERE i.id = ?
		FOR UPDATE
	`, itemID).Scan(
		&item.ItemID,
		&item.CustomerID,
		&item.CustomerName,
		&item.LocationID,
		&item.LocationName,
		&item.StorageSection,
		&item.SKU,
		&item.Description,
		&item.Unit,
		&item.Quantity,
	); err != nil {
		if err == sql.ErrNoRows {
			return lockedAdjustmentItem{}, ErrNotFound
		}
		return lockedAdjustmentItem{}, fmt.Errorf("load adjustment inventory item: %w", err)
	}
	return item, nil
}

func sanitizeInventoryAdjustmentInput(input CreateInventoryAdjustmentInput) CreateInventoryAdjustmentInput {
	input.AdjustmentNo = strings.TrimSpace(strings.ToUpper(input.AdjustmentNo))
	input.ReasonCode = strings.TrimSpace(strings.ToUpper(input.ReasonCode))
	input.Notes = strings.TrimSpace(input.Notes)

	lines := make([]CreateInventoryAdjustmentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.ItemID <= 0 || line.AdjustQty == 0 {
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
		case line.ItemID <= 0:
			return fmt.Errorf("%w: stock row is required", ErrInvalidInput)
		case line.AdjustQty == 0:
			return fmt.Errorf("%w: adjustment quantity cannot be zero", ErrInvalidInput)
		}
	}
	return nil
}

func generateAdjustmentNo() string {
	now := time.Now().UTC()
	return fmt.Sprintf("ADJ-%s-%04d", now.Format("20060102-150405"), now.Nanosecond()%10000)
}
