package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type CycleCount struct {
	ID            int64            `json:"id"`
	CountNo       string           `json:"countNo"`
	Notes         string           `json:"notes"`
	Status        string           `json:"status"`
	TotalLines    int              `json:"totalLines"`
	TotalVariance int              `json:"totalVariance"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
	Lines         []CycleCountLine `json:"lines"`
}

type CycleCountLine struct {
	ID             int64     `json:"id"`
	CycleCountID   int64     `json:"cycleCountId"`
	MovementID     int64     `json:"movementId"`
	ItemID         int64     `json:"itemId"`
	CustomerID     int64     `json:"customerId"`
	CustomerName   string    `json:"customerName"`
	LocationID     int64     `json:"locationId"`
	LocationName   string    `json:"locationName"`
	StorageSection string    `json:"storageSection"`
	SKU            string    `json:"sku"`
	Description    string    `json:"description"`
	SystemQty      int       `json:"systemQty"`
	CountedQty     int       `json:"countedQty"`
	VarianceQty    int       `json:"varianceQty"`
	LineNote       string    `json:"lineNote"`
	CreatedAt      time.Time `json:"createdAt"`
}

type CreateCycleCountInput struct {
	CountNo string                      `json:"countNo"`
	Notes   string                      `json:"notes"`
	Lines   []CreateCycleCountLineInput `json:"lines"`
}

type CreateCycleCountLineInput struct {
	ItemID     int64  `json:"itemId"`
	CountedQty int    `json:"countedQty"`
	LineNote   string `json:"lineNote"`
}

type cycleCountRow struct {
	ID        int64     `db:"id"`
	CountNo   string    `db:"count_no"`
	Notes     string    `db:"notes"`
	Status    string    `db:"status"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

type cycleCountLineRow struct {
	ID                   int64     `db:"id"`
	CycleCountID         int64     `db:"cycle_count_id"`
	MovementID           int64     `db:"movement_id"`
	ItemID               int64     `db:"item_id"`
	CustomerID           int64     `db:"customer_id"`
	CustomerNameSnapshot string    `db:"customer_name_snapshot"`
	LocationID           int64     `db:"location_id"`
	LocationNameSnapshot string    `db:"location_name_snapshot"`
	StorageSection       string    `db:"storage_section"`
	SKUSnapshot          string    `db:"sku_snapshot"`
	DescriptionSnapshot  string    `db:"description_snapshot"`
	SystemQty            int       `db:"system_qty"`
	CountedQty           int       `db:"counted_qty"`
	VarianceQty          int       `db:"variance_qty"`
	LineNote             string    `db:"line_note"`
	CreatedAt            time.Time `db:"created_at"`
}

func (s *Store) ListCycleCounts(ctx context.Context, limit int) ([]CycleCount, error) {
	if limit <= 0 {
		limit = 50
	}

	countRows := make([]cycleCountRow, 0)
	if err := s.db.SelectContext(ctx, &countRows, `
		SELECT
			id,
			count_no,
			COALESCE(notes, '') AS notes,
			status,
			created_at,
			updated_at
		FROM cycle_counts
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, limit); err != nil {
		return nil, fmt.Errorf("load cycle counts: %w", err)
	}
	if len(countRows) == 0 {
		return []CycleCount{}, nil
	}

	countIDs := make([]int64, 0, len(countRows))
	counts := make([]CycleCount, 0, len(countRows))
	countsByID := make(map[int64]*CycleCount, len(countRows))
	for _, row := range countRows {
		count := CycleCount{
			ID:        row.ID,
			CountNo:   row.CountNo,
			Notes:     row.Notes,
			Status:    row.Status,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
			Lines:     make([]CycleCountLine, 0),
		}
		counts = append(counts, count)
		countIDs = append(countIDs, row.ID)
		countsByID[row.ID] = &counts[len(counts)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			cycle_count_id,
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
			customer_id,
			customer_name_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			system_qty,
			counted_qty,
			variance_qty,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM cycle_count_lines
		WHERE cycle_count_id IN (?)
		ORDER BY cycle_count_id DESC, sort_order ASC, id ASC
	`, countIDs)
	if err != nil {
		return nil, fmt.Errorf("build cycle count lines query: %w", err)
	}

	lineRows := make([]cycleCountLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), args...); err != nil {
		return nil, fmt.Errorf("load cycle count lines: %w", err)
	}

	for _, lineRow := range lineRows {
		count := countsByID[lineRow.CycleCountID]
		if count == nil {
			continue
		}

		count.Lines = append(count.Lines, CycleCountLine{
			ID:             lineRow.ID,
			CycleCountID:   lineRow.CycleCountID,
			MovementID:     lineRow.MovementID,
			ItemID:         lineRow.ItemID,
			CustomerID:     lineRow.CustomerID,
			CustomerName:   lineRow.CustomerNameSnapshot,
			LocationID:     lineRow.LocationID,
			LocationName:   lineRow.LocationNameSnapshot,
			StorageSection: fallbackSection(lineRow.StorageSection),
			SKU:            lineRow.SKUSnapshot,
			Description:    lineRow.DescriptionSnapshot,
			SystemQty:      lineRow.SystemQty,
			CountedQty:     lineRow.CountedQty,
			VarianceQty:    lineRow.VarianceQty,
			LineNote:       lineRow.LineNote,
			CreatedAt:      lineRow.CreatedAt,
		})
		count.TotalLines++
		count.TotalVariance += lineRow.VarianceQty
	}

	return counts, nil
}

func (s *Store) CreateCycleCount(ctx context.Context, input CreateCycleCountInput) (CycleCount, error) {
	input = sanitizeCycleCountInput(input)
	if err := validateCycleCountInput(input); err != nil {
		return CycleCount{}, err
	}
	if input.CountNo == "" {
		input.CountNo = generateCycleCountNo()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CycleCount{}, fmt.Errorf("begin cycle count transaction: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO cycle_counts (
			count_no,
			notes,
			status
		) VALUES (?, ?, 'POSTED')
	`,
		input.CountNo,
		nullableString(input.Notes),
	)
	if err != nil {
		return CycleCount{}, mapDBError(fmt.Errorf("create cycle count: %w", err))
	}

	countID, err := result.LastInsertId()
	if err != nil {
		return CycleCount{}, fmt.Errorf("resolve cycle count id: %w", err)
	}

	for index, line := range input.Lines {
		lockedItem, err := s.loadLockedAdjustmentItem(ctx, tx, line.ItemID)
		if err != nil {
			return CycleCount{}, err
		}

		varianceQty := line.CountedQty - lockedItem.Quantity

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO cycle_count_lines (
				cycle_count_id,
				item_id,
				customer_id,
				customer_name_snapshot,
				location_id,
				location_name_snapshot,
				storage_section,
				sku_snapshot,
				description_snapshot,
				system_qty,
				counted_qty,
				variance_qty,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			countID,
			lockedItem.ItemID,
			lockedItem.CustomerID,
			lockedItem.CustomerName,
			lockedItem.LocationID,
			lockedItem.LocationName,
			fallbackSection(lockedItem.StorageSection),
			lockedItem.SKU,
			nullableString(lockedItem.Description),
			lockedItem.Quantity,
			line.CountedQty,
			varianceQty,
			nullableString(line.LineNote),
			index+1,
		)
		if err != nil {
			return CycleCount{}, mapDBError(fmt.Errorf("create cycle count line: %w", err))
		}

		lineID, err := lineResult.LastInsertId()
		if err != nil {
			return CycleCount{}, fmt.Errorf("resolve cycle count line id: %w", err)
		}

		if varianceQty != 0 {
			reason := firstNonEmpty(line.LineNote, fmt.Sprintf("Cycle count posted: %s", input.CountNo))

			movementResult, err := tx.ExecContext(ctx, `
				INSERT INTO stock_movements (
					item_id,
					cycle_count_id,
					cycle_count_line_id,
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
				) VALUES (?, ?, ?, ?, ?, ?, 'COUNT', ?, ?, ?, 0, ?, ?)
			`,
				lockedItem.ItemID,
				countID,
				lineID,
				lockedItem.CustomerID,
				lockedItem.LocationID,
				fallbackSection(lockedItem.StorageSection),
				varianceQty,
				nullableString(lockedItem.Description),
				nullableString(strings.ToUpper(lockedItem.Unit)),
				nullableString(input.Notes),
				nullableString(reason),
			)
			if err != nil {
				return CycleCount{}, mapDBError(fmt.Errorf("create cycle count movement: %w", err))
			}

			movementID, err := movementResult.LastInsertId()
			if err != nil {
				return CycleCount{}, fmt.Errorf("resolve cycle count movement id: %w", err)
			}

			if _, err := tx.ExecContext(ctx, `
				UPDATE cycle_count_lines
				SET movement_id = ?
				WHERE id = ?
			`, movementID, lineID); err != nil {
				return CycleCount{}, mapDBError(fmt.Errorf("link cycle count line to movement: %w", err))
			}
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET quantity = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, line.CountedQty, lockedItem.ItemID); err != nil {
			return CycleCount{}, mapDBError(fmt.Errorf("update inventory after cycle count: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return CycleCount{}, fmt.Errorf("commit cycle count: %w", err)
	}

	return s.getCycleCount(ctx, countID)
}

func (s *Store) getCycleCount(ctx context.Context, countID int64) (CycleCount, error) {
	counts, err := s.listCycleCountsByIDs(ctx, []int64{countID})
	if err != nil {
		return CycleCount{}, err
	}
	if len(counts) == 0 {
		return CycleCount{}, ErrNotFound
	}
	return counts[0], nil
}

func (s *Store) listCycleCountsByIDs(ctx context.Context, countIDs []int64) ([]CycleCount, error) {
	if len(countIDs) == 0 {
		return []CycleCount{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			id,
			count_no,
			COALESCE(notes, '') AS notes,
			status,
			created_at,
			updated_at
		FROM cycle_counts
		WHERE id IN (?)
		ORDER BY created_at DESC, id DESC
	`, countIDs)
	if err != nil {
		return nil, fmt.Errorf("build cycle count query: %w", err)
	}

	countRows := make([]cycleCountRow, 0)
	if err := s.db.SelectContext(ctx, &countRows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load cycle counts by id: %w", err)
	}
	if len(countRows) == 0 {
		return []CycleCount{}, nil
	}

	counts := make([]CycleCount, 0, len(countRows))
	countsByID := make(map[int64]*CycleCount, len(countRows))
	for _, row := range countRows {
		count := CycleCount{
			ID:        row.ID,
			CountNo:   row.CountNo,
			Notes:     row.Notes,
			Status:    row.Status,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
			Lines:     make([]CycleCountLine, 0),
		}
		counts = append(counts, count)
		countsByID[row.ID] = &counts[len(counts)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			cycle_count_id,
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
			customer_id,
			customer_name_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			system_qty,
			counted_qty,
			variance_qty,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM cycle_count_lines
		WHERE cycle_count_id IN (?)
		ORDER BY cycle_count_id DESC, sort_order ASC, id ASC
	`, countIDs)
	if err != nil {
		return nil, fmt.Errorf("build cycle count line query by id: %w", err)
	}

	lineRows := make([]cycleCountLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load cycle count lines by id: %w", err)
	}

	for _, lineRow := range lineRows {
		count := countsByID[lineRow.CycleCountID]
		if count == nil {
			continue
		}
		count.Lines = append(count.Lines, CycleCountLine{
			ID:             lineRow.ID,
			CycleCountID:   lineRow.CycleCountID,
			MovementID:     lineRow.MovementID,
			ItemID:         lineRow.ItemID,
			CustomerID:     lineRow.CustomerID,
			CustomerName:   lineRow.CustomerNameSnapshot,
			LocationID:     lineRow.LocationID,
			LocationName:   lineRow.LocationNameSnapshot,
			StorageSection: fallbackSection(lineRow.StorageSection),
			SKU:            lineRow.SKUSnapshot,
			Description:    lineRow.DescriptionSnapshot,
			SystemQty:      lineRow.SystemQty,
			CountedQty:     lineRow.CountedQty,
			VarianceQty:    lineRow.VarianceQty,
			LineNote:       lineRow.LineNote,
			CreatedAt:      lineRow.CreatedAt,
		})
		count.TotalLines++
		count.TotalVariance += lineRow.VarianceQty
	}

	return counts, nil
}

func sanitizeCycleCountInput(input CreateCycleCountInput) CreateCycleCountInput {
	input.CountNo = strings.TrimSpace(strings.ToUpper(input.CountNo))
	input.Notes = strings.TrimSpace(input.Notes)

	lines := make([]CreateCycleCountLineInput, 0, len(input.Lines))
	seenItems := make(map[int64]struct{}, len(input.Lines))
	for _, line := range input.Lines {
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.ItemID <= 0 {
			continue
		}
		if _, exists := seenItems[line.ItemID]; exists {
			continue
		}
		seenItems[line.ItemID] = struct{}{}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateCycleCountInput(input CreateCycleCountInput) error {
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one cycle count line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.ItemID <= 0:
			return fmt.Errorf("%w: stock row is required", ErrInvalidInput)
		case line.CountedQty < 0:
			return fmt.Errorf("%w: counted quantity cannot be negative", ErrInvalidInput)
		}
	}
	return nil
}

func generateCycleCountNo() string {
	now := time.Now().UTC()
	return fmt.Sprintf("CNT-%s-%04d", now.Format("20060102-150405"), now.Nanosecond()%10000)
}
