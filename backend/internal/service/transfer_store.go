package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type InventoryTransfer struct {
	ID         int64                   `json:"id"`
	TransferNo string                  `json:"transferNo"`
	Notes      string                  `json:"notes"`
	Status     string                  `json:"status"`
	TotalLines int                     `json:"totalLines"`
	TotalQty   int                     `json:"totalQty"`
	Routes     string                  `json:"routes"`
	CreatedAt  time.Time               `json:"createdAt"`
	UpdatedAt  time.Time               `json:"updatedAt"`
	Lines      []InventoryTransferLine `json:"lines"`
}

type InventoryTransferLine struct {
	ID                 int64     `json:"id"`
	TransferID         int64     `json:"transferId"`
	CustomerID         int64     `json:"customerId"`
	CustomerName       string    `json:"customerName"`
	FromLocationID     int64     `json:"fromLocationId"`
	FromLocationName   string    `json:"fromLocationName"`
	FromStorageSection string    `json:"fromStorageSection"`
	ToLocationID       int64     `json:"toLocationId"`
	ToLocationName     string    `json:"toLocationName"`
	ToStorageSection   string    `json:"toStorageSection"`
	SKU                string    `json:"sku"`
	Description        string    `json:"description"`
	Quantity           int       `json:"quantity"`
	LineNote           string    `json:"lineNote"`
	CreatedAt          time.Time `json:"createdAt"`
}

type CreateInventoryTransferInput struct {
	TransferNo string                             `json:"transferNo"`
	Notes      string                             `json:"notes"`
	Lines      []CreateInventoryTransferLineInput `json:"lines"`
}

type CreateInventoryTransferLineInput struct {
	CustomerID       int64  `json:"customerId"`
	LocationID       int64  `json:"locationId"`
	StorageSection   string `json:"storageSection"`
	ContainerNo      string `json:"containerNo"`
	PalletID         int64  `json:"palletId"`
	SKUMasterID      int64  `json:"skuMasterId"`
	Quantity         int    `json:"quantity"`
	ToLocationID     int64  `json:"toLocationId"`
	ToStorageSection string `json:"toStorageSection"`
	LineNote         string `json:"lineNote"`
}

type inventoryTransferRow struct {
	ID         int64     `db:"id"`
	TransferNo string    `db:"transfer_no"`
	Notes      string    `db:"notes"`
	Status     string    `db:"status"`
	CreatedAt  time.Time `db:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"`
}

type inventoryTransferLineRow struct {
	ID                       int64     `db:"id"`
	TransferID               int64     `db:"transfer_id"`
	CustomerID               int64     `db:"customer_id"`
	CustomerNameSnapshot     string    `db:"customer_name_snapshot"`
	FromLocationID           int64     `db:"from_location_id"`
	FromLocationNameSnapshot string    `db:"from_location_name_snapshot"`
	FromStorageSection       string    `db:"from_storage_section"`
	ToLocationID             int64     `db:"to_location_id"`
	ToLocationNameSnapshot   string    `db:"to_location_name_snapshot"`
	ToStorageSection         string    `db:"to_storage_section"`
	SKUSnapshot              string    `db:"sku_snapshot"`
	DescriptionSnapshot      string    `db:"description_snapshot"`
	Quantity                 int       `db:"quantity"`
	LineNote                 string    `db:"line_note"`
	CreatedAt                time.Time `db:"created_at"`
}

type lockedTransferItem struct {
	ItemID         int64
	SKUMasterID    int64
	CustomerID     int64
	CustomerName   string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	SKU            string
	Name           string
	Category       string
	Description    string
	Unit           string
	ReorderLevel   int
	Quantity       int
	AvailableQty   int
}

func (s *Store) ListInventoryTransfers(ctx context.Context, limit int) ([]InventoryTransfer, error) {
	if limit <= 0 {
		limit = 50
	}

	transferRows := make([]inventoryTransferRow, 0)
	if err := s.db.SelectContext(ctx, &transferRows, `
		SELECT
			id,
			transfer_no,
			COALESCE(notes, '') AS notes,
			status,
			created_at,
			updated_at
		FROM inventory_transfers
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, limit); err != nil {
		return nil, fmt.Errorf("load inventory transfers: %w", err)
	}
	if len(transferRows) == 0 {
		return []InventoryTransfer{}, nil
	}

	transferIDs := make([]int64, 0, len(transferRows))
	transfers := make([]InventoryTransfer, 0, len(transferRows))
	transfersByID := make(map[int64]*InventoryTransfer, len(transferRows))
	for _, row := range transferRows {
		transfer := InventoryTransfer{
			ID:         row.ID,
			TransferNo: row.TransferNo,
			Notes:      row.Notes,
			Status:     row.Status,
			CreatedAt:  row.CreatedAt,
			UpdatedAt:  row.UpdatedAt,
			Lines:      make([]InventoryTransferLine, 0),
		}
		transfers = append(transfers, transfer)
		transferIDs = append(transferIDs, row.ID)
		transfersByID[row.ID] = &transfers[len(transfers)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			transfer_id,
			customer_id,
			customer_name_snapshot,
			from_location_id,
			from_location_name_snapshot,
			from_storage_section,
			to_location_id,
			to_location_name_snapshot,
			to_storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inventory_transfer_lines
		WHERE transfer_id IN (?)
		ORDER BY transfer_id DESC, sort_order ASC, id ASC
	`, transferIDs)
	if err != nil {
		return nil, fmt.Errorf("build transfer lines query: %w", err)
	}

	lineRows := make([]inventoryTransferLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), args...); err != nil {
		return nil, fmt.Errorf("load transfer lines: %w", err)
	}

	for _, lineRow := range lineRows {
		transfer := transfersByID[lineRow.TransferID]
		if transfer == nil {
			continue
		}
		transfer.Lines = append(transfer.Lines, InventoryTransferLine{
			ID:                 lineRow.ID,
			TransferID:         lineRow.TransferID,
			CustomerID:         lineRow.CustomerID,
			CustomerName:       lineRow.CustomerNameSnapshot,
			FromLocationID:     lineRow.FromLocationID,
			FromLocationName:   lineRow.FromLocationNameSnapshot,
			FromStorageSection: fallbackSection(lineRow.FromStorageSection),
			ToLocationID:       lineRow.ToLocationID,
			ToLocationName:     lineRow.ToLocationNameSnapshot,
			ToStorageSection:   fallbackSection(lineRow.ToStorageSection),
			SKU:                lineRow.SKUSnapshot,
			Description:        lineRow.DescriptionSnapshot,
			Quantity:           lineRow.Quantity,
			LineNote:           lineRow.LineNote,
			CreatedAt:          lineRow.CreatedAt,
		})
		transfer.TotalLines++
		transfer.TotalQty += lineRow.Quantity
		transfer.Routes = appendUniqueJoined(
			transfer.Routes,
			fmt.Sprintf(
				"%s / %s -> %s / %s",
				lineRow.FromLocationNameSnapshot,
				fallbackSection(lineRow.FromStorageSection),
				lineRow.ToLocationNameSnapshot,
				fallbackSection(lineRow.ToStorageSection),
			),
		)
	}

	return transfers, nil
}

func (s *Store) CreateInventoryTransfer(ctx context.Context, input CreateInventoryTransferInput) (InventoryTransfer, error) {
	input = sanitizeInventoryTransferInput(input)
	if err := validateInventoryTransferInput(input); err != nil {
		return InventoryTransfer{}, err
	}
	if input.TransferNo == "" {
		input.TransferNo = generateTransferNo()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryTransfer{}, fmt.Errorf("begin transfer transaction: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_transfers (
			transfer_no,
			notes,
			status
		) VALUES (?, ?, 'POSTED')
	`,
		input.TransferNo,
		nullableString(input.Notes),
	)
	if err != nil {
		return InventoryTransfer{}, mapDBError(fmt.Errorf("create transfer: %w", err))
	}

	transferID, err := result.LastInsertId()
	if err != nil {
		return InventoryTransfer{}, fmt.Errorf("resolve transfer id: %w", err)
	}

	for index, line := range input.Lines {
		sourceItem, err := s.loadLockedTransferItem(ctx, tx, palletSourceBucket{
			SKUMasterID:    line.SKUMasterID,
			CustomerID:     line.CustomerID,
			LocationID:     line.LocationID,
			StorageSection: line.StorageSection,
			ContainerNo:    line.ContainerNo,
		})
		if err != nil {
			return InventoryTransfer{}, err
		}

		toSection := fallbackSection(line.ToStorageSection)
		if sourceItem.LocationID == line.ToLocationID && fallbackSection(sourceItem.StorageSection) == toSection {
			return InventoryTransfer{}, fmt.Errorf("%w: source and destination cannot be the same stock position", ErrInvalidInput)
		}
		if line.Quantity > sourceItem.AvailableQty {
			return InventoryTransfer{}, ErrInsufficientStock
		}

		toLocationName, err := s.getTransferLocationName(ctx, tx, line.ToLocationID)
		if err != nil {
			return InventoryTransfer{}, err
		}

		if err := s.ensureTransferDestinationProjectionItem(ctx, tx, sourceItem, line.ToLocationID, toSection); err != nil {
			return InventoryTransfer{}, err
		}

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO inventory_transfer_lines (
				transfer_id,
				customer_id,
				customer_name_snapshot,
				from_location_id,
				from_location_name_snapshot,
				from_storage_section,
				to_location_id,
				to_location_name_snapshot,
				to_storage_section,
				sku_snapshot,
				description_snapshot,
				quantity,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			transferID,
			sourceItem.CustomerID,
			sourceItem.CustomerName,
			sourceItem.LocationID,
			sourceItem.LocationName,
			fallbackSection(sourceItem.StorageSection),
			line.ToLocationID,
			toLocationName,
			toSection,
			sourceItem.SKU,
			nullableString(sourceItem.Description),
			line.Quantity,
			nullableString(line.LineNote),
			index+1,
		)
		if err != nil {
			return InventoryTransfer{}, mapDBError(fmt.Errorf("create transfer line: %w", err))
		}

		lineID, err := lineResult.LastInsertId()
		if err != nil {
			return InventoryTransfer{}, fmt.Errorf("resolve transfer line id: %w", err)
		}

		reason := firstNonEmpty(line.LineNote, fmt.Sprintf("Transfer posted: %s", input.TransferNo))
		palletConsumptions, err := s.consumeTransferPalletContentsTx(ctx, tx, sourceItem.ItemID, line)
		if err != nil {
			return InventoryTransfer{}, fmt.Errorf("allocate pallet contents for transfer: %w", err)
		}
		if len(palletConsumptions) == 0 {
			return InventoryTransfer{}, ErrInsufficientStock
		}

		palletSplitSequence := 0
		for _, palletConsumption := range palletConsumptions {
			if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
				PalletID:         palletConsumption.PalletID,
				ContainerVisitID: palletConsumption.ContainerVisitID,
				CustomerID:       palletConsumption.CustomerID,
				LocationID:       palletConsumption.LocationID,
				StorageSection:   palletConsumption.StorageSection,
				ContainerNo:      firstNonEmpty(palletConsumption.ContainerNo, sourceItem.ContainerNo),
				EventType:        PalletEventTransferOut,
				QuantityDelta:    -palletConsumption.Quantity,
			}); err != nil {
				return InventoryTransfer{}, err
			}
			if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
				EventType:           StockLedgerEventTransferOut,
				PalletID:            palletConsumption.PalletID,
				PalletItemID:        palletConsumption.PalletItemID,
				SKUMasterID:         palletConsumption.SKUMasterID,
				CustomerID:          palletConsumption.CustomerID,
				LocationID:          palletConsumption.LocationID,
				StorageSection:      palletConsumption.StorageSection,
				QuantityChange:      -palletConsumption.Quantity,
				SourceDocumentType:  StockLedgerSourceTransfer,
				SourceDocumentID:    transferID,
				SourceLineID:        lineID,
				ContainerNo:         firstNonEmpty(palletConsumption.ContainerNo, sourceItem.ContainerNo),
				ItemNumber:          sourceItem.SKU,
				DescriptionSnapshot: sourceItem.Description,
				Reason:              reason,
			}); err != nil {
				return InventoryTransfer{}, err
			}

			palletSplitSequence++
			childPallet, err := s.createPalletTx(ctx, tx, createPalletInput{
				ParentPalletID:          palletConsumption.PalletID,
				PalletCode:              palletCodeForTransferSplit(palletConsumption.PalletID, lineID, palletSplitSequence),
				ContainerVisitID:        palletConsumption.ContainerVisitID,
				SourceInboundDocumentID: palletConsumption.SourceInboundDocumentID,
				SourceInboundLineID:     palletConsumption.SourceInboundLineID,
				CustomerID:              sourceItem.CustomerID,
				SKUMasterID:             palletConsumption.SKUMasterID,
				CurrentLocationID:       line.ToLocationID,
				CurrentStorageSection:   toSection,
				CurrentContainerNo:      firstNonEmpty(palletConsumption.ContainerNo, sourceItem.ContainerNo),
				Status:                  PalletStatusOpen,
			})
			if err != nil {
				return InventoryTransfer{}, err
			}
			childPalletItemID, err := s.createPalletItemTx(ctx, tx, createPalletItemInput{
				PalletID:    childPallet.ID,
				SKUMasterID: palletConsumption.SKUMasterID,
				Quantity:    palletConsumption.Quantity,
			})
			if err != nil {
				return InventoryTransfer{}, err
			}
			if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
				EventType:           StockLedgerEventTransferIn,
				PalletID:            childPallet.ID,
				PalletItemID:        childPalletItemID,
				SKUMasterID:         palletConsumption.SKUMasterID,
				CustomerID:          sourceItem.CustomerID,
				LocationID:          line.ToLocationID,
				StorageSection:      toSection,
				QuantityChange:      palletConsumption.Quantity,
				SourceDocumentType:  StockLedgerSourceTransfer,
				SourceDocumentID:    transferID,
				SourceLineID:        lineID,
				ContainerNo:         childPallet.CurrentContainerNo,
				ItemNumber:          sourceItem.SKU,
				DescriptionSnapshot: sourceItem.Description,
				Reason:              reason,
			}); err != nil {
				return InventoryTransfer{}, err
			}
			if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
				PalletID:         childPallet.ID,
				ContainerVisitID: childPallet.ContainerVisitID,
				CustomerID:       sourceItem.CustomerID,
				LocationID:       line.ToLocationID,
				StorageSection:   toSection,
				ContainerNo:      childPallet.CurrentContainerNo,
				EventType:        PalletEventTransferIn,
				QuantityDelta:    palletConsumption.Quantity,
			}); err != nil {
				return InventoryTransfer{}, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return InventoryTransfer{}, fmt.Errorf("commit transfer: %w", err)
	}

	return s.getInventoryTransfer(ctx, transferID)
}

func (s *Store) getInventoryTransfer(ctx context.Context, transferID int64) (InventoryTransfer, error) {
	transfers, err := s.listInventoryTransfersByIDs(ctx, []int64{transferID})
	if err != nil {
		return InventoryTransfer{}, err
	}
	if len(transfers) == 0 {
		return InventoryTransfer{}, ErrNotFound
	}
	return transfers[0], nil
}

func (s *Store) listInventoryTransfersByIDs(ctx context.Context, transferIDs []int64) ([]InventoryTransfer, error) {
	if len(transferIDs) == 0 {
		return []InventoryTransfer{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			id,
			transfer_no,
			COALESCE(notes, '') AS notes,
			status,
			created_at,
			updated_at
		FROM inventory_transfers
		WHERE id IN (?)
		ORDER BY created_at DESC, id DESC
	`, transferIDs)
	if err != nil {
		return nil, fmt.Errorf("build transfer query: %w", err)
	}

	transferRows := make([]inventoryTransferRow, 0)
	if err := s.db.SelectContext(ctx, &transferRows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load transfers by id: %w", err)
	}
	if len(transferRows) == 0 {
		return []InventoryTransfer{}, nil
	}

	transfers := make([]InventoryTransfer, 0, len(transferRows))
	transfersByID := make(map[int64]*InventoryTransfer, len(transferRows))
	for _, row := range transferRows {
		transfer := InventoryTransfer{
			ID:         row.ID,
			TransferNo: row.TransferNo,
			Notes:      row.Notes,
			Status:     row.Status,
			CreatedAt:  row.CreatedAt,
			UpdatedAt:  row.UpdatedAt,
			Lines:      make([]InventoryTransferLine, 0),
		}
		transfers = append(transfers, transfer)
		transfersByID[row.ID] = &transfers[len(transfers)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			transfer_id,
			customer_id,
			customer_name_snapshot,
			from_location_id,
			from_location_name_snapshot,
			from_storage_section,
			to_location_id,
			to_location_name_snapshot,
			to_storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inventory_transfer_lines
		WHERE transfer_id IN (?)
		ORDER BY transfer_id DESC, sort_order ASC, id ASC
	`, transferIDs)
	if err != nil {
		return nil, fmt.Errorf("build transfer line query by id: %w", err)
	}

	lineRows := make([]inventoryTransferLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load transfer lines by id: %w", err)
	}

	for _, lineRow := range lineRows {
		transfer := transfersByID[lineRow.TransferID]
		if transfer == nil {
			continue
		}
		transfer.Lines = append(transfer.Lines, InventoryTransferLine{
			ID:                 lineRow.ID,
			TransferID:         lineRow.TransferID,
			CustomerID:         lineRow.CustomerID,
			CustomerName:       lineRow.CustomerNameSnapshot,
			FromLocationID:     lineRow.FromLocationID,
			FromLocationName:   lineRow.FromLocationNameSnapshot,
			FromStorageSection: fallbackSection(lineRow.FromStorageSection),
			ToLocationID:       lineRow.ToLocationID,
			ToLocationName:     lineRow.ToLocationNameSnapshot,
			ToStorageSection:   fallbackSection(lineRow.ToStorageSection),
			SKU:                lineRow.SKUSnapshot,
			Description:        lineRow.DescriptionSnapshot,
			Quantity:           lineRow.Quantity,
			LineNote:           lineRow.LineNote,
			CreatedAt:          lineRow.CreatedAt,
		})
		transfer.TotalLines++
		transfer.TotalQty += lineRow.Quantity
		transfer.Routes = appendUniqueJoined(
			transfer.Routes,
			fmt.Sprintf(
				"%s / %s -> %s / %s",
				lineRow.FromLocationNameSnapshot,
				fallbackSection(lineRow.FromStorageSection),
				lineRow.ToLocationNameSnapshot,
				fallbackSection(lineRow.ToStorageSection),
			),
		)
	}

	return transfers, nil
}

func (s *Store) loadLockedTransferItem(ctx context.Context, tx *sql.Tx, bucket palletSourceBucket) (lockedTransferItem, error) {
	projection, err := s.loadPalletBackedInventoryProjectionForBucketTx(ctx, tx, bucket)
	if err != nil {
		return lockedTransferItem{}, err
	}

	return lockedTransferItem{
		ItemID:         projection.ItemID,
		SKUMasterID:    projection.SKUMasterID,
		CustomerID:     projection.CustomerID,
		CustomerName:   projection.CustomerName,
		LocationID:     projection.LocationID,
		LocationName:   projection.LocationName,
		StorageSection: projection.StorageSection,
		ContainerNo:    projection.ContainerNo,
		SKU:            projection.SKU,
		Name:           projection.Name,
		Category:       projection.Category,
		Description:    projection.Description,
		Unit:           projection.Unit,
		ReorderLevel:   projection.ReorderLevel,
		Quantity:       projection.Quantity,
		AvailableQty:   projection.AvailableQty,
	}, nil
}

func (s *Store) getTransferLocationName(ctx context.Context, tx *sql.Tx, locationID int64) (string, error) {
	var locationName string
	if err := tx.QueryRowContext(ctx, `
		SELECT name
		FROM storage_locations
		WHERE id = ?
	`, locationID).Scan(&locationName); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("%w: destination location not found", ErrInvalidInput)
		}
		return "", fmt.Errorf("load transfer destination location: %w", err)
	}
	return locationName, nil
}

func (s *Store) ensureTransferDestinationProjectionItem(
	ctx context.Context,
	tx *sql.Tx,
	sourceItem lockedTransferItem,
	toLocationID int64,
	toSection string,
) error {
	normalizedToSection := normalizeStorageSection(toSection)

	var destinationItemID int64
	query := `
		SELECT id
		FROM inventory_items
		WHERE sku_master_id = ? AND customer_id = ? AND location_id = ? AND COALESCE(NULLIF(storage_section, ''), ?) = ? AND COALESCE(container_no, '') = ?
		FOR UPDATE
	`
	queryArgs := []any{
		sourceItem.SKUMasterID,
		sourceItem.CustomerID,
		toLocationID,
		DefaultStorageSection,
		normalizedToSection,
		strings.TrimSpace(sourceItem.ContainerNo),
	}
	err := tx.QueryRowContext(ctx, query, queryArgs...).Scan(&destinationItemID)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("load transfer destination item: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			location_id,
			storage_section,
			delivery_date,
			container_no,
			last_restocked_at
		) VALUES (?, ?, ?, ?, NULL, ?, NULL)
	`,
		sourceItem.SKUMasterID,
		sourceItem.CustomerID,
		toLocationID,
		normalizedToSection,
		nullableString(sourceItem.ContainerNo),
	)
	if err != nil {
		return mapDBError(fmt.Errorf("create transfer destination item: %w", err))
	}

	return nil
}

func sanitizeInventoryTransferInput(input CreateInventoryTransferInput) CreateInventoryTransferInput {
	input.TransferNo = strings.TrimSpace(strings.ToUpper(input.TransferNo))
	input.Notes = strings.TrimSpace(input.Notes)

	lines := make([]CreateInventoryTransferLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.StorageSection = normalizeStorageSection(line.StorageSection)
		line.ContainerNo = strings.TrimSpace(strings.ToUpper(line.ContainerNo))
		line.ToStorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(line.ToStorageSection)))
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 || line.Quantity <= 0 || line.ToLocationID <= 0 {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateInventoryTransferInput(input CreateInventoryTransferInput) error {
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one transfer line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: source storage is required", ErrInvalidInput)
		case line.PalletID < 0:
			return fmt.Errorf("%w: pallet is invalid", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: sku is required", ErrInvalidInput)
		case line.Quantity <= 0:
			return fmt.Errorf("%w: transfer quantity must be greater than zero", ErrInvalidInput)
		case line.ToLocationID <= 0:
			return fmt.Errorf("%w: destination storage is required", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Store) consumeTransferPalletContentsTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	line CreateInventoryTransferLineInput,
) ([]palletContentConsumption, error) {
	if line.PalletID > 0 {
		return s.consumeSpecificPalletContentsForBucketTx(ctx, tx, palletSourceBucket{
			SKUMasterID:    line.SKUMasterID,
			CustomerID:     line.CustomerID,
			LocationID:     line.LocationID,
			StorageSection: line.StorageSection,
			ContainerNo:    line.ContainerNo,
		}, line.PalletID, line.SKUMasterID, line.Quantity)
	}

	return s.consumePalletContentsForItemTx(ctx, tx, itemID, line.SKUMasterID, line.Quantity)
}

func generateTransferNo() string {
	now := time.Now().UTC()
	return fmt.Sprintf("TRN-%s-%04d", now.Format("20060102-150405"), now.Nanosecond()%10000)
}
