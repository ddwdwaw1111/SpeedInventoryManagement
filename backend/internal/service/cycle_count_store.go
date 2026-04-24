package service

import (
	"context"
	"database/sql"
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
	CustomerID     int64  `json:"customerId"`
	LocationID     int64  `json:"locationId"`
	StorageSection string `json:"storageSection"`
	ContainerNo    string `json:"containerNo"`
	PalletID       int64  `json:"palletId"`
	CreatePallet   bool   `json:"createPallet"`
	PalletCode     string `json:"palletCode"`
	SKUMasterID    int64  `json:"skuMasterId"`
	CountedQty     int    `json:"countedQty"`
	LineNote       string `json:"lineNote"`
}

type lockedCycleCountTarget struct {
	ItemID         int64
	PalletID       int64
	PalletItemID   int64
	SKUMasterID    int64
	CustomerID     int64
	CustomerName   string
	LocationID     int64
	LocationName   string
	StorageSection string
	SKU            string
	Description    string
	Quantity       int
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
	countOccurredAt := time.Now().UTC()

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

	newPalletSequence := 0
	for index, line := range input.Lines {
		if line.CreatePallet {
			newPalletSequence++
			line.PalletCode = palletCodeForCycleCount(countID, newPalletSequence)
		}

		lockedTarget, err := s.loadLockedCycleCountTarget(ctx, tx, line)
		if err != nil {
			return CycleCount{}, err
		}

		varianceQty := line.CountedQty - lockedTarget.Quantity

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO cycle_count_lines (
				cycle_count_id,
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
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			countID,
			lockedTarget.CustomerID,
			lockedTarget.CustomerName,
			lockedTarget.LocationID,
			lockedTarget.LocationName,
			fallbackSection(lockedTarget.StorageSection),
			lockedTarget.SKU,
			nullableString(lockedTarget.Description),
			lockedTarget.Quantity,
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

			palletVariances, err := s.applyCycleCountPalletDeltaTx(ctx, tx, lockedTarget.ItemID, line, varianceQty)
			if err != nil {
				return CycleCount{}, err
			}
			varianceSign := 1
			if varianceQty < 0 {
				varianceSign = -1
			}
			for _, palletVariance := range palletVariances {
				signedQuantityChange := varianceSign * palletVariance.Quantity
				afterPalletQty, err := s.loadPalletQuantityTx(ctx, tx, palletVariance.PalletID)
				if err != nil {
					return CycleCount{}, err
				}
				beforePalletQty := afterPalletQty - signedQuantityChange
				if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
					PalletID:         palletVariance.PalletID,
					ContainerVisitID: palletVariance.ContainerVisitID,
					CustomerID:       palletVariance.CustomerID,
					LocationID:       palletVariance.LocationID,
					StorageSection:   palletVariance.StorageSection,
					ContainerNo:      palletVariance.ContainerNo,
					EventType:        PalletEventCount,
					QuantityDelta:    signedQuantityChange,
					PalletDelta:      resolvePalletCountTransition(beforePalletQty, afterPalletQty),
					EventTime:        &countOccurredAt,
				}); err != nil {
					return CycleCount{}, err
				}
				if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
					EventType:           StockLedgerEventCount,
					OccurredAt:          &countOccurredAt,
					PalletID:            palletVariance.PalletID,
					PalletItemID:        palletVariance.PalletItemID,
					SKUMasterID:         palletVariance.SKUMasterID,
					CustomerID:          palletVariance.CustomerID,
					LocationID:          palletVariance.LocationID,
					StorageSection:      palletVariance.StorageSection,
					QuantityChange:      signedQuantityChange,
					SourceDocumentType:  StockLedgerSourceCycleCount,
					SourceDocumentID:    countID,
					SourceLineID:        lineID,
					ContainerNo:         palletVariance.ContainerNo,
					DescriptionSnapshot: lockedTarget.Description,
					Reason:              reason,
				}); err != nil {
					return CycleCount{}, err
				}
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return CycleCount{}, fmt.Errorf("commit cycle count: %w", err)
	}

	return s.getCycleCount(ctx, countID)
}

func (s *Store) loadPalletQuantityTx(ctx context.Context, tx *sql.Tx, palletID int64) (int, error) {
	if palletID <= 0 {
		return 0, nil
	}

	var quantity int
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM pallet_items
		WHERE pallet_id = ?
	`, palletID).Scan(&quantity); err != nil {
		return 0, fmt.Errorf("load pallet quantity: %w", err)
	}

	return quantity, nil
}

func resolvePalletCountTransition(beforeQty int, afterQty int) float64 {
	switch {
	case beforeQty <= 0 && afterQty > 0:
		return 1
	case beforeQty > 0 && afterQty <= 0:
		return -1
	default:
		return 0
	}
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
	seenLines := make(map[string]struct{}, len(input.Lines))
	for _, line := range input.Lines {
		line.StorageSection = normalizeStorageSection(line.StorageSection)
		line.ContainerNo = strings.TrimSpace(strings.ToUpper(line.ContainerNo))
		line.PalletCode = strings.TrimSpace(strings.ToUpper(line.PalletCode))
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 {
			continue
		}
		if line.CreatePallet && line.CountedQty <= 0 {
			continue
		}
		lineKey := buildCycleCountLineKey(line)
		if lineKey != "" {
			if _, exists := seenLines[lineKey]; exists {
				continue
			}
			seenLines[lineKey] = struct{}{}
		}
		if lineKey == "" {
			lines = append(lines, line)
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateCycleCountInput(input CreateCycleCountInput) error {
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one cycle count line is required", ErrInvalidInput)
	}

	bucketScopes := make(map[string]string, len(input.Lines))
	for _, line := range input.Lines {
		bucketKey := buildCycleCountBucketKey(line)
		scopeMode := "pallet"
		if existingScope, exists := bucketScopes[bucketKey]; exists && existingScope != scopeMode {
			return fmt.Errorf("%w: cannot mix bucket-level and pallet-level count lines for the same stock position", ErrInvalidInput)
		}
		bucketScopes[bucketKey] = scopeMode

		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: storage is required", ErrInvalidInput)
		case line.CreatePallet && line.PalletID > 0:
			return fmt.Errorf("%w: new pallet count lines cannot target an existing pallet id", ErrInvalidInput)
		case !line.CreatePallet && line.PalletCode != "":
			return fmt.Errorf("%w: pallet code can only be set when creating a new pallet", ErrInvalidInput)
		case !line.CreatePallet && line.PalletID <= 0:
			return fmt.Errorf("%w: pallet is required unless creating a new pallet", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: sku is required", ErrInvalidInput)
		case line.CountedQty < 0:
			return fmt.Errorf("%w: counted quantity cannot be negative", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Store) loadLockedCycleCountTarget(ctx context.Context, tx *sql.Tx, line CreateCycleCountLineInput) (lockedCycleCountTarget, error) {
	lockedItem, err := s.loadLockedAdjustmentItem(ctx, tx, palletSourceBucket{
		SKUMasterID:    line.SKUMasterID,
		CustomerID:     line.CustomerID,
		LocationID:     line.LocationID,
		StorageSection: line.StorageSection,
		ContainerNo:    line.ContainerNo,
	})
	if err != nil {
		return lockedCycleCountTarget{}, err
	}

	target := lockedCycleCountTarget{
		ItemID:         lockedItem.ItemID,
		SKUMasterID:    lockedItem.SKUMasterID,
		CustomerID:     lockedItem.CustomerID,
		CustomerName:   lockedItem.CustomerName,
		LocationID:     lockedItem.LocationID,
		LocationName:   lockedItem.LocationName,
		StorageSection: lockedItem.StorageSection,
		SKU:            lockedItem.SKU,
		Description:    lockedItem.Description,
		Quantity:       lockedItem.Quantity,
	}
	if line.CreatePallet {
		target.Quantity = 0
		return target, nil
	}
	if line.PalletID <= 0 {
		return target, nil
	}

	if err := tx.QueryRowContext(ctx, `
		SELECT
			pi.id,
			pi.quantity
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.id = ?
		  AND pi.sku_master_id = ?
		  AND p.customer_id = ?
		  AND p.current_location_id = ?
		  AND COALESCE(p.current_storage_section, 'TEMP') = ?
		  AND COALESCE(p.current_container_no, '') = ?
		FOR UPDATE
	`, line.PalletID, line.SKUMasterID, line.CustomerID, line.LocationID, fallbackSection(line.StorageSection), strings.TrimSpace(line.ContainerNo)).Scan(
		&target.PalletItemID,
		&target.Quantity,
	); err != nil {
		if err == sql.ErrNoRows {
			return lockedCycleCountTarget{}, fmt.Errorf("%w: selected pallet is not available in this stock position", ErrInvalidInput)
		}
		return lockedCycleCountTarget{}, fmt.Errorf("load selected pallet for cycle count: %w", err)
	}
	target.PalletID = line.PalletID
	return target, nil
}

func (s *Store) applyCycleCountPalletDeltaTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	line CreateCycleCountLineInput,
	varianceQty int,
) ([]palletContentConsumption, error) {
	if varianceQty == 0 {
		return []palletContentConsumption{}, nil
	}
	if line.CreatePallet {
		return s.createCycleCountPalletTx(ctx, tx, itemID, line, varianceQty)
	}
	if line.PalletID <= 0 {
		return nil, fmt.Errorf("%w: pallet is required unless creating a new pallet", ErrInvalidInput)
	}

	bucket := palletSourceBucket{
		SKUMasterID:    line.SKUMasterID,
		CustomerID:     line.CustomerID,
		LocationID:     line.LocationID,
		StorageSection: line.StorageSection,
		ContainerNo:    line.ContainerNo,
	}
	if varianceQty < 0 {
		return s.consumeSpecificPalletContentsForBucketTx(ctx, tx, bucket, line.PalletID, line.SKUMasterID, -varianceQty)
	}

	return s.addSpecificPalletContentsForBucketTx(ctx, tx, bucket, line.PalletID, line.SKUMasterID, varianceQty)
}

func (s *Store) createCycleCountPalletTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	line CreateCycleCountLineInput,
	quantity int,
) ([]palletContentConsumption, error) {
	if quantity <= 0 {
		return []palletContentConsumption{}, nil
	}

	itemBucket, err := s.loadInventoryItemBucketTx(ctx, tx, itemID)
	if err != nil {
		return nil, err
	}

	pallet, err := s.createPalletTx(ctx, tx, createPalletInput{
		PalletCode:            firstNonEmpty(strings.TrimSpace(line.PalletCode), palletCodeForOperationalSeed(itemID)),
		ActualArrivalDate:     itemBucket.DeliveryDate,
		CustomerID:            itemBucket.CustomerID,
		SKUMasterID:           line.SKUMasterID,
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
		SKUMasterID: line.SKUMasterID,
		Quantity:    quantity,
	})
	if err != nil {
		return nil, err
	}

	return []palletContentConsumption{{
		PalletID:       pallet.ID,
		PalletItemID:   palletItemID,
		SKUMasterID:    line.SKUMasterID,
		Quantity:       quantity,
		CustomerID:     itemBucket.CustomerID,
		LocationID:     itemBucket.LocationID,
		StorageSection: fallbackSection(itemBucket.StorageSection),
		ContainerNo:    strings.TrimSpace(itemBucket.ContainerNo),
	}}, nil
}

func buildCycleCountBucketKey(line CreateCycleCountLineInput) string {
	return fmt.Sprintf("%d:%d:%s:%s:%d", line.CustomerID, line.LocationID, line.StorageSection, line.ContainerNo, line.SKUMasterID)
}

func buildCycleCountLineKey(line CreateCycleCountLineInput) string {
	if line.CreatePallet {
		return ""
	}
	return fmt.Sprintf("%s:%d", buildCycleCountBucketKey(line), line.PalletID)
}

func palletCodeForCycleCount(cycleCountID int64, sequence int) string {
	return fmt.Sprintf("PLT-COUNT-%d-%d", max(cycleCountID, 0), max(sequence, 1))
}

func generateCycleCountNo() string {
	now := time.Now().UTC()
	return fmt.Sprintf("CNT-%s-%04d", now.Format("20060102-150405"), now.Nanosecond()%10000)
}
