package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

const inventoryTransferTransactionAttempts = 3

type InventoryTransfer struct {
	ID                      int64                   `json:"id"`
	TransferNo              string                  `json:"transferNo"`
	ActualTransferredAt     *time.Time              `json:"actualTransferredAt"`
	Notes                   string                  `json:"notes"`
	Status                  string                  `json:"status"`
	TotalLines              int                     `json:"totalLines"`
	TotalQty                int                     `json:"totalQty"`
	TotalSourcePallets      int                     `json:"totalSourcePallets"`
	TotalDestinationPallets int                     `json:"totalDestinationPallets"`
	Routes                  string                  `json:"routes"`
	CreatedAt               time.Time               `json:"createdAt"`
	UpdatedAt               time.Time               `json:"updatedAt"`
	Lines                   []InventoryTransferLine `json:"lines"`
}

type InventoryTransferLine struct {
	ID                 int64     `json:"id"`
	TransferID         int64     `json:"transferId"`
	CustomerID         int64     `json:"customerId"`
	CustomerName       string    `json:"customerName"`
	FromLocationID     int64     `json:"fromLocationId"`
	FromLocationName   string    `json:"fromLocationName"`
	FromStorageSection string    `json:"fromStorageSection"`
	ContainerNo        string    `json:"containerNo"`
	ToLocationID       int64     `json:"toLocationId"`
	ToLocationName     string    `json:"toLocationName"`
	ToStorageSection   string    `json:"toStorageSection"`
	SKU                string    `json:"sku"`
	Description        string    `json:"description"`
	Quantity           int       `json:"quantity"`
	SourcePallets      int       `json:"sourcePallets"`
	DestinationPallets int       `json:"destinationPallets"`
	LineNote           string    `json:"lineNote"`
	CreatedAt          time.Time `json:"createdAt"`
}

type CreateInventoryTransferInput struct {
	TransferNo          string                              `json:"transferNo"`
	ActualTransferredAt string                              `json:"actualTransferredAt"`
	Notes               string                              `json:"notes"`
	Lines               []CreateInventoryTransferLineInput  `json:"lines"`
	EntireContainer     *CreateEntireContainerTransferInput `json:"entireContainer"`
	EntireLocation      *CreateEntireLocationTransferInput  `json:"entireLocation"`
}

type CreateEntireContainerTransferInput struct {
	CustomerID       int64  `json:"customerId"`
	LocationID       int64  `json:"locationId"`
	ContainerNo      string `json:"containerNo"`
	ToLocationID     int64  `json:"toLocationId"`
	ToStorageSection string `json:"toStorageSection"`
}

type CreateEntireLocationTransferInput struct {
	LocationID       int64  `json:"locationId"`
	ToLocationID     int64  `json:"toLocationId"`
	ToStorageSection string `json:"toStorageSection"`
}

type CreateInventoryTransferLineInput struct {
	CustomerID         int64  `json:"customerId"`
	LocationID         int64  `json:"locationId"`
	StorageSection     string `json:"storageSection"`
	ContainerNo        string `json:"containerNo"`
	SKUMasterID        int64  `json:"skuMasterId"`
	Quantity           int    `json:"quantity"`
	SourcePallets      int    `json:"sourcePallets"`
	DestinationPallets int    `json:"destinationPallets"`
	ToLocationID       int64  `json:"toLocationId"`
	ToStorageSection   string `json:"toStorageSection"`
	LineNote           string `json:"lineNote"`
}

type inventoryTransferRow struct {
	ID                  int64        `db:"id"`
	TransferNo          string       `db:"transfer_no"`
	ActualTransferredAt sql.NullTime `db:"actual_transferred_at"`
	Notes               string       `db:"notes"`
	Status              string       `db:"status"`
	CreatedAt           time.Time    `db:"created_at"`
	UpdatedAt           time.Time    `db:"updated_at"`
}

type inventoryTransferLineRow struct {
	ID                       int64     `db:"id"`
	TransferID               int64     `db:"transfer_id"`
	CustomerID               int64     `db:"customer_id"`
	CustomerNameSnapshot     string    `db:"customer_name_snapshot"`
	FromLocationID           int64     `db:"from_location_id"`
	FromLocationNameSnapshot string    `db:"from_location_name_snapshot"`
	FromStorageSection       string    `db:"from_storage_section"`
	ContainerNo              string    `db:"container_no"`
	ToLocationID             int64     `db:"to_location_id"`
	ToLocationNameSnapshot   string    `db:"to_location_name_snapshot"`
	ToStorageSection         string    `db:"to_storage_section"`
	SKUSnapshot              string    `db:"sku_snapshot"`
	DescriptionSnapshot      string    `db:"description_snapshot"`
	Quantity                 int       `db:"quantity"`
	SourcePallets            int       `db:"source_pallets"`
	DestinationPallets       int       `db:"destination_pallets"`
	LineNote                 string    `db:"line_note"`
	CreatedAt                time.Time `db:"created_at"`
}

type lockedTransferItem struct {
	ItemID           int64
	SKUMasterID      int64
	CustomerID       int64
	CustomerName     string
	LocationID       int64
	LocationName     string
	StorageSection   string
	ContainerNo      string
	SKU              string
	Name             string
	Category         string
	Description      string
	Unit             string
	ReorderLevel     int
	Quantity         int
	AvailableQty     int
	Pallets          int
	AvailablePallets int
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
			actual_transferred_at,
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
			ID:                  row.ID,
			TransferNo:          row.TransferNo,
			ActualTransferredAt: timePointer(row.ActualTransferredAt),
			Notes:               row.Notes,
			Status:              row.Status,
			CreatedAt:           row.CreatedAt,
			UpdatedAt:           row.UpdatedAt,
			Lines:               make([]InventoryTransferLine, 0),
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
			COALESCE(container_no, '') AS container_no,
			to_location_id,
			to_location_name_snapshot,
			to_storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(source_pallets, 0) AS source_pallets,
			COALESCE(destination_pallets, 0) AS destination_pallets,
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
			ContainerNo:        lineRow.ContainerNo,
			ToLocationID:       lineRow.ToLocationID,
			ToLocationName:     lineRow.ToLocationNameSnapshot,
			ToStorageSection:   fallbackSection(lineRow.ToStorageSection),
			SKU:                lineRow.SKUSnapshot,
			Description:        lineRow.DescriptionSnapshot,
			Quantity:           lineRow.Quantity,
			SourcePallets:      lineRow.SourcePallets,
			DestinationPallets: lineRow.DestinationPallets,
			LineNote:           lineRow.LineNote,
			CreatedAt:          lineRow.CreatedAt,
		})
		transfer.TotalLines++
		transfer.TotalQty += lineRow.Quantity
		transfer.TotalSourcePallets += lineRow.SourcePallets
		transfer.TotalDestinationPallets += lineRow.DestinationPallets
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
	actualTransferredAt, err := parseOptionalDateTime(input.ActualTransferredAt)
	if err != nil {
		return InventoryTransfer{}, err
	}

	committedTransfer, err := retryInventoryTransferTransaction(ctx, func() (InventoryTransfer, error) {
		return s.createInventoryTransferTransaction(ctx, input, actualTransferredAt)
	})
	if err != nil {
		return InventoryTransfer{}, err
	}
	return s.getInventoryTransfer(ctx, committedTransfer.ID)
}

func retryInventoryTransferTransaction(
	ctx context.Context,
	operation func() (InventoryTransfer, error),
) (InventoryTransfer, error) {
	var transfer InventoryTransfer
	err := retryDeadlockedDatabaseTransaction(ctx, func() error {
		var operationErr error
		transfer, operationErr = operation()
		return operationErr
	})
	return transfer, err
}

func retryDeadlockedDatabaseTransaction(ctx context.Context, operation func() error) error {
	var lastErr error
	for attempt := 1; attempt <= inventoryTransferTransactionAttempts; attempt++ {
		err := operation()
		if err == nil {
			return nil
		}
		lastErr = err
		if !isInventoryTransferDeadlock(err) || attempt == inventoryTransferTransactionAttempts {
			return err
		}

		retryDelay := time.Duration(attempt) * 10 * time.Millisecond
		timer := time.NewTimer(retryDelay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return fmt.Errorf("retry database transaction: %w", ctx.Err())
		case <-timer.C:
		}
	}
	return lastErr
}

func isInventoryTransferDeadlock(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1213
}

func (s *Store) createInventoryTransferTransaction(
	ctx context.Context,
	input CreateInventoryTransferInput,
	actualTransferredAt *time.Time,
) (InventoryTransfer, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InventoryTransfer{}, fmt.Errorf("begin transfer transaction: %w", err)
	}
	defer tx.Rollback()
	customerIDs := make([]int64, 0, len(input.Lines)+1)
	for _, line := range input.Lines {
		customerIDs = append(customerIDs, line.CustomerID)
	}
	if input.EntireContainer != nil {
		customerIDs = append(customerIDs, input.EntireContainer.CustomerID)
	}
	if input.EntireLocation != nil {
		locationCustomerIDs, err := s.listEntireLocationCustomerIDsTx(ctx, tx, input.EntireLocation.LocationID)
		if err != nil {
			return InventoryTransfer{}, err
		}
		customerIDs = append(customerIDs, locationCustomerIDs...)
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, customerIDs); err != nil {
		return InventoryTransfer{}, err
	}
	if input.EntireContainer != nil {
		input.Lines, err = s.buildEntireContainerTransferLinesTx(ctx, tx, *input.EntireContainer)
		if err != nil {
			return InventoryTransfer{}, err
		}
	}
	if input.EntireLocation != nil {
		input.Lines, err = s.buildEntireLocationTransferLinesTx(ctx, tx, *input.EntireLocation)
		if err != nil {
			return InventoryTransfer{}, err
		}
		lineCustomerIDs := make([]int64, 0, len(input.Lines))
		for _, line := range input.Lines {
			lineCustomerIDs = append(lineCustomerIDs, line.CustomerID)
		}
		if err := lockBillingSourceCustomersTx(ctx, tx, lineCustomerIDs); err != nil {
			return InventoryTransfer{}, err
		}
	}
	transfer, err := s.createInventoryTransferTx(ctx, tx, input, actualTransferredAt)
	if err != nil {
		return InventoryTransfer{}, err
	}

	if err := tx.Commit(); err != nil {
		return InventoryTransfer{}, fmt.Errorf("commit transfer: %w", err)
	}

	return transfer, nil
}

func (s *Store) createInventoryTransferTx(
	ctx context.Context,
	tx *sql.Tx,
	input CreateInventoryTransferInput,
	actualTransferredAt *time.Time,
) (InventoryTransfer, error) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_transfers (
			transfer_no,
			actual_transferred_at,
			notes,
			status
		) VALUES (?, ?, ?, 'POSTED')
	`,
		input.TransferNo,
		nullableTime(actualTransferredAt),
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
		sourceItem, err := s.loadLockedTransferItem(ctx, tx, inventorySourceBucket{
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
		if line.SourcePallets > sourceItem.AvailablePallets {
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
				container_no,
				to_location_id,
				to_location_name_snapshot,
				to_storage_section,
				sku_snapshot,
				description_snapshot,
				quantity,
				source_pallets,
				destination_pallets,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			transferID,
			sourceItem.CustomerID,
			sourceItem.CustomerName,
			sourceItem.LocationID,
			sourceItem.LocationName,
			fallbackSection(sourceItem.StorageSection),
			sourceItem.ContainerNo,
			line.ToLocationID,
			toLocationName,
			toSection,
			sourceItem.SKU,
			nullableString(sourceItem.Description),
			line.Quantity,
			line.SourcePallets,
			line.DestinationPallets,
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
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventTransferOut,
			OccurredAt:          actualTransferredAt,
			SKUMasterID:         sourceItem.SKUMasterID,
			CustomerID:          sourceItem.CustomerID,
			LocationID:          sourceItem.LocationID,
			StorageSection:      sourceItem.StorageSection,
			QuantityChange:      -line.Quantity,
			PalletChange:        -float64(line.SourcePallets),
			SourceDocumentType:  StockLedgerSourceTransfer,
			SourceDocumentID:    transferID,
			SourceLineID:        lineID,
			ContainerNo:         sourceItem.ContainerNo,
			ItemNumber:          sourceItem.SKU,
			DescriptionSnapshot: sourceItem.Description,
			Reason:              reason,
			ReferenceCode:       input.TransferNo,
		}); err != nil {
			return InventoryTransfer{}, err
		}
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventTransferIn,
			OccurredAt:          actualTransferredAt,
			SKUMasterID:         sourceItem.SKUMasterID,
			CustomerID:          sourceItem.CustomerID,
			LocationID:          line.ToLocationID,
			StorageSection:      toSection,
			QuantityChange:      line.Quantity,
			PalletChange:        float64(line.DestinationPallets),
			SourceDocumentType:  StockLedgerSourceTransfer,
			SourceDocumentID:    transferID,
			SourceLineID:        lineID,
			ContainerNo:         sourceItem.ContainerNo,
			ItemNumber:          sourceItem.SKU,
			DescriptionSnapshot: sourceItem.Description,
			Reason:              reason,
			ReferenceCode:       input.TransferNo,
		}); err != nil {
			return InventoryTransfer{}, err
		}
	}

	return InventoryTransfer{ID: transferID}, nil
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
			actual_transferred_at,
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
			ID:                  row.ID,
			TransferNo:          row.TransferNo,
			ActualTransferredAt: timePointer(row.ActualTransferredAt),
			Notes:               row.Notes,
			Status:              row.Status,
			CreatedAt:           row.CreatedAt,
			UpdatedAt:           row.UpdatedAt,
			Lines:               make([]InventoryTransferLine, 0),
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
			COALESCE(container_no, '') AS container_no,
			to_location_id,
			to_location_name_snapshot,
			to_storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(source_pallets, 0) AS source_pallets,
			COALESCE(destination_pallets, 0) AS destination_pallets,
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
			ContainerNo:        lineRow.ContainerNo,
			ToLocationID:       lineRow.ToLocationID,
			ToLocationName:     lineRow.ToLocationNameSnapshot,
			ToStorageSection:   fallbackSection(lineRow.ToStorageSection),
			SKU:                lineRow.SKUSnapshot,
			Description:        lineRow.DescriptionSnapshot,
			Quantity:           lineRow.Quantity,
			SourcePallets:      lineRow.SourcePallets,
			DestinationPallets: lineRow.DestinationPallets,
			LineNote:           lineRow.LineNote,
			CreatedAt:          lineRow.CreatedAt,
		})
		transfer.TotalLines++
		transfer.TotalQty += lineRow.Quantity
		transfer.TotalSourcePallets += lineRow.SourcePallets
		transfer.TotalDestinationPallets += lineRow.DestinationPallets
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

func (s *Store) loadLockedTransferItem(ctx context.Context, tx *sql.Tx, bucket inventorySourceBucket) (lockedTransferItem, error) {
	projection, err := s.loadInventoryProjectionForBucketTx(ctx, tx, bucket)
	if err != nil {
		return lockedTransferItem{}, err
	}

	return lockedTransferItemFromProjection(projection), nil
}

func lockedTransferItemFromProjection(projection inventoryProjection) lockedTransferItem {
	return lockedTransferItem{
		ItemID:           projection.ItemID,
		SKUMasterID:      projection.SKUMasterID,
		CustomerID:       projection.CustomerID,
		CustomerName:     projection.CustomerName,
		LocationID:       projection.LocationID,
		LocationName:     projection.LocationName,
		StorageSection:   projection.StorageSection,
		ContainerNo:      projection.ContainerNo,
		SKU:              projection.SKU,
		Name:             projection.Name,
		Category:         projection.Category,
		Description:      projection.Description,
		Unit:             projection.Unit,
		ReorderLevel:     projection.ReorderLevel,
		Quantity:         projection.Quantity,
		AvailableQty:     projection.AvailableQty,
		Pallets:          projection.Pallets,
		AvailablePallets: maxInt(projection.Pallets-projection.AllocatedPallets, 0),
	}
}

func (s *Store) buildEntireContainerTransferLinesTx(
	ctx context.Context,
	tx *sql.Tx,
	input CreateEntireContainerTransferInput,
) ([]CreateInventoryTransferLineInput, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM inventory_items
		WHERE customer_id = ?
			AND location_id = ?
			AND UPPER(TRIM(COALESCE(container_no, ''))) = ?
			AND (quantity > 0 OR pallets > 0)
		ORDER BY id ASC
		FOR UPDATE
	`, input.CustomerID, input.LocationID, input.ContainerNo)
	if err != nil {
		return nil, fmt.Errorf("lock entire container inventory: %w", err)
	}
	itemIDs := make([]int64, 0)
	for rows.Next() {
		var itemID int64
		if err := rows.Scan(&itemID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan entire container inventory: %w", err)
		}
		itemIDs = append(itemIDs, itemID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate entire container inventory: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close entire container inventory rows: %w", err)
	}
	if len(itemIDs) == 0 {
		return nil, fmt.Errorf("%w: container has no inventory at the selected storage", ErrInvalidInput)
	}

	lines := make([]CreateInventoryTransferLineInput, 0, len(itemIDs))
	for _, itemID := range itemIDs {
		projection, err := s.loadInventoryProjectionTx(ctx, tx, itemID)
		if err != nil {
			return nil, err
		}
		item := lockedTransferItemFromProjection(projection)
		if item.AvailableQty != item.Quantity || item.AvailablePallets != item.Pallets {
			return nil, fmt.Errorf("%w: entire container transfer requires all inventory to be available", ErrReservedStock)
		}
		toSection := fallbackSection(input.ToStorageSection)
		if item.LocationID == input.ToLocationID && fallbackSection(item.StorageSection) == toSection {
			return nil, fmt.Errorf("%w: source and destination cannot be the same stock position", ErrInvalidInput)
		}
		if err := s.ensureTransferDestinationProjectionItem(ctx, tx, item, input.ToLocationID, toSection); err != nil {
			return nil, err
		}
		lines = append(lines, CreateInventoryTransferLineInput{
			CustomerID:         item.CustomerID,
			LocationID:         item.LocationID,
			StorageSection:     item.StorageSection,
			ContainerNo:        item.ContainerNo,
			SKUMasterID:        item.SKUMasterID,
			Quantity:           item.Quantity,
			SourcePallets:      item.Pallets,
			DestinationPallets: item.Pallets,
			ToLocationID:       input.ToLocationID,
			ToStorageSection:   input.ToStorageSection,
		})
	}

	// Keep the same lock order as adjustments, outbound posting, and partial
	// transfers: lock every affected inventory projection before the container.
	// The main transfer loop reuses these locks when it posts the ledger entries.
	var containerID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM containers
		WHERE customer_id = ? AND UPPER(TRIM(container_no)) = ?
		FOR UPDATE
	`, input.CustomerID, input.ContainerNo).Scan(&containerID); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("%w: container not found", ErrInvalidInput)
		}
		return nil, fmt.Errorf("lock transfer container: %w", err)
	}
	return lines, nil
}

func (s *Store) listEntireLocationCustomerIDsTx(
	ctx context.Context,
	tx *sql.Tx,
	locationID int64,
) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT DISTINCT customer_id
		FROM inventory_items
		WHERE location_id = ?
			AND (quantity > 0 OR pallets > 0)
		ORDER BY customer_id ASC
	`, locationID)
	if err != nil {
		return nil, fmt.Errorf("load whole-warehouse customers: %w", err)
	}
	defer rows.Close()

	customerIDs := make([]int64, 0)
	for rows.Next() {
		var customerID int64
		if err := rows.Scan(&customerID); err != nil {
			return nil, fmt.Errorf("scan whole-warehouse customer: %w", err)
		}
		customerIDs = append(customerIDs, customerID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate whole-warehouse customers: %w", err)
	}
	return customerIDs, nil
}

func (s *Store) buildEntireLocationTransferLinesTx(
	ctx context.Context,
	tx *sql.Tx,
	input CreateEntireLocationTransferInput,
) ([]CreateInventoryTransferLineInput, error) {
	if _, err := s.getTransferLocationName(ctx, tx, input.LocationID); err != nil {
		return nil, fmt.Errorf("load source warehouse: %w", err)
	}
	if _, err := s.getTransferLocationName(ctx, tx, input.ToLocationID); err != nil {
		return nil, err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM inventory_items
		WHERE location_id = ?
			AND (quantity > 0 OR pallets > 0)
		ORDER BY id ASC
		FOR UPDATE
	`, input.LocationID)
	if err != nil {
		return nil, fmt.Errorf("lock whole-warehouse inventory: %w", err)
	}
	itemIDs := make([]int64, 0)
	for rows.Next() {
		var itemID int64
		if err := rows.Scan(&itemID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan whole-warehouse inventory: %w", err)
		}
		itemIDs = append(itemIDs, itemID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate whole-warehouse inventory: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close whole-warehouse inventory rows: %w", err)
	}
	if len(itemIDs) == 0 {
		return nil, fmt.Errorf("%w: source warehouse has no inventory to transfer", ErrInvalidInput)
	}

	toSection := fallbackSection(input.ToStorageSection)
	lines := make([]CreateInventoryTransferLineInput, 0, len(itemIDs))
	for _, itemID := range itemIDs {
		projection, err := s.loadInventoryProjectionTx(ctx, tx, itemID)
		if err != nil {
			return nil, err
		}
		item := lockedTransferItemFromProjection(projection)
		if item.AvailableQty != item.Quantity || item.AvailablePallets != item.Pallets {
			return nil, fmt.Errorf(
				"%w: cannot move the entire warehouse because container %s / UPC %s has allocated, damaged, or held inventory",
				ErrReservedStock,
				firstNonEmpty(item.ContainerNo, "UNASSIGNED"),
				item.SKU,
			)
		}
		if err := s.ensureTransferDestinationProjectionItem(ctx, tx, item, input.ToLocationID, toSection); err != nil {
			return nil, err
		}
		lines = append(lines, CreateInventoryTransferLineInput{
			CustomerID:         item.CustomerID,
			LocationID:         item.LocationID,
			StorageSection:     item.StorageSection,
			ContainerNo:        item.ContainerNo,
			SKUMasterID:        item.SKUMasterID,
			Quantity:           item.Quantity,
			SourcePallets:      item.Pallets,
			DestinationPallets: item.Pallets,
			ToLocationID:       input.ToLocationID,
			ToStorageSection:   toSection,
		})
	}
	return lines, nil
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
	sectionID, err := resolveStorageSectionIDTx(ctx, tx, toLocationID, normalizedToSection)
	if err != nil {
		return err
	}

	var containerID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
		SELECT container_id
		FROM inventory_items
		WHERE id = ?
	`, sourceItem.ItemID).Scan(&containerID); err != nil {
		return mapDBError(fmt.Errorf("load transfer source container: %w", err))
	}
	if !containerID.Valid {
		containerNo := normalizeContainerNo(sourceItem.ContainerNo)
		if containerNo != "" {
			err := tx.QueryRowContext(ctx, `
				SELECT id
				FROM containers
				WHERE customer_id = ? AND UPPER(TRIM(container_no)) = ?
				FOR UPDATE
			`, sourceItem.CustomerID, containerNo).Scan(&containerID)
			if err != nil && err != sql.ErrNoRows {
				return mapDBError(fmt.Errorf("load transfer container: %w", err))
			}
		}
	}
	var persistedContainerID any
	if containerID.Valid {
		persistedContainerID = containerID.Int64
	}

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
	err = tx.QueryRowContext(ctx, query, queryArgs...).Scan(&destinationItemID)
	if err == nil {
		if _, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET
				section_id = ?,
				container_id = COALESCE(?, container_id),
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, sectionID, persistedContainerID, destinationItemID); err != nil {
			return mapDBError(fmt.Errorf("sync transfer destination item identifiers: %w", err))
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("load transfer destination item: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			container_id,
			location_id,
			section_id,
			storage_section,
			delivery_date,
			container_no,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)
	`,
		sourceItem.SKUMasterID,
		sourceItem.CustomerID,
		persistedContainerID,
		toLocationID,
		sectionID,
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
	input.ActualTransferredAt = strings.TrimSpace(input.ActualTransferredAt)
	input.Notes = strings.TrimSpace(input.Notes)
	if input.EntireContainer != nil {
		input.EntireContainer.ContainerNo = normalizeContainerNo(input.EntireContainer.ContainerNo)
		input.EntireContainer.ToStorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(input.EntireContainer.ToStorageSection)))
	}
	if input.EntireLocation != nil {
		input.EntireLocation.ToStorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(input.EntireLocation.ToStorageSection)))
	}

	lines := make([]CreateInventoryTransferLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.StorageSection = normalizeStorageSection(line.StorageSection)
		line.ContainerNo = strings.TrimSpace(strings.ToUpper(line.ContainerNo))
		line.ToStorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(line.ToStorageSection)))
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 || line.Quantity < 0 || line.SourcePallets < 0 || line.DestinationPallets < 0 || (line.Quantity == 0 && line.SourcePallets == 0 && line.DestinationPallets == 0) || line.ToLocationID <= 0 {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateInventoryTransferInput(input CreateInventoryTransferInput) error {
	modeCount := 0
	if input.EntireContainer != nil {
		modeCount++
	}
	if input.EntireLocation != nil {
		modeCount++
	}
	if len(input.Lines) > 0 {
		modeCount++
	}
	if modeCount > 1 {
		return fmt.Errorf("%w: choose only one transfer mode", ErrInvalidInput)
	}
	if input.EntireLocation != nil {
		switch {
		case input.EntireLocation.LocationID <= 0:
			return fmt.Errorf("%w: source warehouse is required", ErrInvalidInput)
		case input.EntireLocation.ToLocationID <= 0:
			return fmt.Errorf("%w: destination warehouse is required", ErrInvalidInput)
		case input.EntireLocation.LocationID == input.EntireLocation.ToLocationID:
			return fmt.Errorf("%w: source and destination warehouses must be different", ErrInvalidInput)
		}
		return nil
	}
	if input.EntireContainer != nil {
		switch {
		case input.EntireContainer.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case input.EntireContainer.LocationID <= 0:
			return fmt.Errorf("%w: source storage is required", ErrInvalidInput)
		case input.EntireContainer.ContainerNo == "":
			return fmt.Errorf("%w: container is required", ErrInvalidInput)
		case input.EntireContainer.ToLocationID <= 0:
			return fmt.Errorf("%w: destination storage is required", ErrInvalidInput)
		}
		return nil
	}
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one transfer line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: source storage is required", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: UPC is required", ErrInvalidInput)
		case line.Quantity < 0:
			return fmt.Errorf("%w: transfer quantity cannot be negative", ErrInvalidInput)
		case line.SourcePallets < 0 || line.DestinationPallets < 0:
			return fmt.Errorf("%w: transfer pallets cannot be negative", ErrInvalidInput)
		case line.Quantity == 0 && line.SourcePallets == 0 && line.DestinationPallets == 0:
			return fmt.Errorf("%w: transfer quantity or pallets must be greater than zero", ErrInvalidInput)
		case line.ToLocationID <= 0:
			return fmt.Errorf("%w: destination storage is required", ErrInvalidInput)
		}
	}
	return nil
}

func generateTransferNo() string {
	now := time.Now().UTC()
	return fmt.Sprintf("TRN-%s-%04d", now.Format("20060102-150405"), now.Nanosecond()%10000)
}
