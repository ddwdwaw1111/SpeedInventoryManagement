package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type receiptLot struct {
	ID                      int64
	ParentReceiptLotID      int64
	SourceInboundDocumentID int64
	SourceInboundLineID     int64
	ItemID                  int64
	CustomerID              int64
	LocationID              int64
	StorageSection          string
	ContainerNo             string
	OriginalQty             int
	RemainingQty            int
	CreatedAt               time.Time
}

type createReceiptLotInput struct {
	ParentReceiptLotID      int64
	SourceInboundDocumentID int64
	SourceInboundLineID     int64
	ItemID                  int64
	CustomerID              int64
	LocationID              int64
	StorageSection          string
	ContainerNo             string
	OriginalQty             int
	RemainingQty            int
}

type receiptLotConsumption struct {
	Lot      receiptLot
	Quantity int
}

type ReceiptLotMovementLink struct {
	ID             int64     `json:"id"`
	MovementID     int64     `json:"movementId"`
	ReceiptLotID   int64     `json:"receiptLotId"`
	MovementType   string    `json:"movementType"`
	QuantityChange int       `json:"quantityChange"`
	LinkedQty      int       `json:"linkedQty"`
	LinkType       string    `json:"linkType"`
	StorageSection string    `json:"storageSection"`
	ContainerNo    string    `json:"containerNo"`
	CreatedAt      time.Time `json:"createdAt"`
}

type ReceiptLotTrace struct {
	ID                      int64                    `json:"id"`
	ParentReceiptLotID      int64                    `json:"parentReceiptLotId"`
	SourceInboundDocumentID int64                    `json:"sourceInboundDocumentId"`
	SourceInboundLineID     int64                    `json:"sourceInboundLineId"`
	ItemID                  int64                    `json:"itemId"`
	ItemNumber              string                   `json:"itemNumber"`
	SKU                     string                   `json:"sku"`
	Description             string                   `json:"description"`
	CustomerID              int64                    `json:"customerId"`
	CustomerName            string                   `json:"customerName"`
	LocationID              int64                    `json:"locationId"`
	LocationName            string                   `json:"locationName"`
	StorageSection          string                   `json:"storageSection"`
	ContainerNo             string                   `json:"containerNo"`
	OriginalQty             int                      `json:"originalQty"`
	RemainingQty            int                      `json:"remainingQty"`
	CreatedAt               time.Time                `json:"createdAt"`
	UpdatedAt               time.Time                `json:"updatedAt"`
	Links                   []ReceiptLotMovementLink `json:"links"`
}

type receiptLotTraceRow struct {
	ID                      int64     `db:"id"`
	ParentReceiptLotID      int64     `db:"parent_receipt_lot_id"`
	SourceInboundDocumentID int64     `db:"source_inbound_document_id"`
	SourceInboundLineID     int64     `db:"source_inbound_line_id"`
	ItemID                  int64     `db:"item_id"`
	ItemNumber              string    `db:"item_number"`
	SKU                     string    `db:"sku"`
	Description             string    `db:"description"`
	CustomerID              int64     `db:"customer_id"`
	CustomerName            string    `db:"customer_name"`
	LocationID              int64     `db:"location_id"`
	LocationName            string    `db:"location_name"`
	StorageSection          string    `db:"storage_section"`
	ContainerNo             string    `db:"container_no"`
	OriginalQty             int       `db:"original_qty"`
	RemainingQty            int       `db:"remaining_qty"`
	CreatedAt               time.Time `db:"created_at"`
	UpdatedAt               time.Time `db:"updated_at"`
}

type receiptLotMovementLinkRow struct {
	ID             int64     `db:"id"`
	MovementID     int64     `db:"movement_id"`
	ReceiptLotID   int64     `db:"receipt_lot_id"`
	MovementType   string    `db:"movement_type"`
	QuantityChange int       `db:"quantity_change"`
	LinkedQty      int       `db:"linked_qty"`
	LinkType       string    `db:"link_type"`
	StorageSection string    `db:"storage_section"`
	ContainerNo    string    `db:"container_no"`
	CreatedAt      time.Time `db:"created_at"`
}

func (s *Store) ListReceiptLots(ctx context.Context, limit int, search string) ([]ReceiptLotTrace, error) {
	if limit <= 0 {
		limit = 500
	}

	normalizedSearch := strings.TrimSpace(strings.ToLower(search))
	searchPattern := "%" + normalizedSearch + "%"
	searchClause := ""
	searchArgs := make([]any, 0)
	if normalizedSearch != "" {
		searchClause = `
			AND (
				LOWER(COALESCE(i.item_number, '')) LIKE ?
				OR LOWER(COALESCE(i.sku, '')) LIKE ?
				OR LOWER(COALESCE(i.description, i.name, '')) LIKE ?
				OR LOWER(COALESCE(c.name, '')) LIKE ?
				OR LOWER(COALESCE(l.name, '')) LIKE ?
				OR LOWER(COALESCE(rl.container_no, '')) LIKE ?
				OR CAST(rl.source_inbound_document_id AS CHAR) LIKE ?
				OR CAST(rl.source_inbound_line_id AS CHAR) LIKE ?
			)
		`
		for range 8 {
			searchArgs = append(searchArgs, searchPattern)
		}
	}

	query := fmt.Sprintf(`
		SELECT
			rl.id,
			COALESCE(rl.parent_receipt_lot_id, 0) AS parent_receipt_lot_id,
			rl.source_inbound_document_id,
			rl.source_inbound_line_id,
			rl.item_id,
			COALESCE(i.item_number, '') AS item_number,
			COALESCE(i.sku, '') AS sku,
			COALESCE(i.description, i.name, '') AS description,
			rl.customer_id,
			COALESCE(c.name, '') AS customer_name,
			rl.location_id,
			COALESCE(l.name, '') AS location_name,
			rl.storage_section,
			COALESCE(rl.container_no, '') AS container_no,
			rl.original_qty,
			rl.remaining_qty,
			rl.created_at,
			rl.updated_at
		FROM receipt_lots rl
		LEFT JOIN inventory_items i ON i.id = rl.item_id
		LEFT JOIN customers c ON c.id = rl.customer_id
		LEFT JOIN storage_locations l ON l.id = rl.location_id
		WHERE 1 = 1
		%s
		ORDER BY rl.updated_at DESC, rl.id DESC
		LIMIT ?
	`, searchClause)

	args := append(searchArgs, limit)
	rows := make([]receiptLotTraceRow, 0)
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("load receipt lots: %w", err)
	}
	if len(rows) == 0 {
		return []ReceiptLotTrace{}, nil
	}

	traces := make([]ReceiptLotTrace, 0, len(rows))
	traceIndexByID := make(map[int64]int, len(rows))
	lotIDs := make([]int64, 0, len(rows))
	for index, row := range rows {
		traceIndexByID[row.ID] = index
		lotIDs = append(lotIDs, row.ID)
		traces = append(traces, ReceiptLotTrace{
			ID:                      row.ID,
			ParentReceiptLotID:      row.ParentReceiptLotID,
			SourceInboundDocumentID: row.SourceInboundDocumentID,
			SourceInboundLineID:     row.SourceInboundLineID,
			ItemID:                  row.ItemID,
			ItemNumber:              row.ItemNumber,
			SKU:                     row.SKU,
			Description:             row.Description,
			CustomerID:              row.CustomerID,
			CustomerName:            row.CustomerName,
			LocationID:              row.LocationID,
			LocationName:            row.LocationName,
			StorageSection:          fallbackSection(row.StorageSection),
			ContainerNo:             row.ContainerNo,
			OriginalQty:             row.OriginalQty,
			RemainingQty:            row.RemainingQty,
			CreatedAt:               row.CreatedAt,
			UpdatedAt:               row.UpdatedAt,
			Links:                   make([]ReceiptLotMovementLink, 0),
		})
	}

	linkQuery, linkArgs, err := sqlx.In(`
		SELECT
			mll.id,
			mll.movement_id,
			mll.receipt_lot_id,
			COALESCE(sm.movement_type, '') AS movement_type,
			COALESCE(sm.quantity_change, 0) AS quantity_change,
			mll.quantity AS linked_qty,
			COALESCE(mll.link_type, '') AS link_type,
			COALESCE(sm.storage_section, 'TEMP') AS storage_section,
			COALESCE(sm.container_no, '') AS container_no,
			mll.created_at
		FROM movement_lot_links mll
		JOIN stock_movements sm ON sm.id = mll.movement_id
		WHERE mll.receipt_lot_id IN (?)
		ORDER BY mll.receipt_lot_id ASC, mll.id ASC
	`, lotIDs)
	if err != nil {
		return nil, fmt.Errorf("build receipt lot link query: %w", err)
	}

	linkRows := make([]receiptLotMovementLinkRow, 0)
	if err := s.db.SelectContext(ctx, &linkRows, s.db.Rebind(linkQuery), linkArgs...); err != nil {
		return nil, fmt.Errorf("load receipt lot links: %w", err)
	}

	for _, row := range linkRows {
		traceIndex, ok := traceIndexByID[row.ReceiptLotID]
		if !ok {
			continue
		}
		traces[traceIndex].Links = append(traces[traceIndex].Links, ReceiptLotMovementLink{
			ID:             row.ID,
			MovementID:     row.MovementID,
			ReceiptLotID:   row.ReceiptLotID,
			MovementType:   row.MovementType,
			QuantityChange: row.QuantityChange,
			LinkedQty:      row.LinkedQty,
			LinkType:       row.LinkType,
			StorageSection: fallbackSection(row.StorageSection),
			ContainerNo:    row.ContainerNo,
			CreatedAt:      row.CreatedAt,
		})
	}

	return traces, nil
}

func (s *Store) createReceiptLotTx(ctx context.Context, tx *sql.Tx, input createReceiptLotInput) (receiptLot, error) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO receipt_lots (
			parent_receipt_lot_id,
			source_inbound_document_id,
			source_inbound_line_id,
			item_id,
			customer_id,
			location_id,
			storage_section,
			container_no,
			original_qty,
			remaining_qty
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		nullableInt64(input.ParentReceiptLotID),
		input.SourceInboundDocumentID,
		input.SourceInboundLineID,
		input.ItemID,
		input.CustomerID,
		input.LocationID,
		fallbackSection(input.StorageSection),
		nullableString(input.ContainerNo),
		input.OriginalQty,
		input.RemainingQty,
	)
	if err != nil {
		return receiptLot{}, mapDBError(fmt.Errorf("create receipt lot: %w", err))
	}

	lotID, err := result.LastInsertId()
	if err != nil {
		return receiptLot{}, fmt.Errorf("resolve receipt lot id: %w", err)
	}

	return receiptLot{
		ID:                      lotID,
		ParentReceiptLotID:      input.ParentReceiptLotID,
		SourceInboundDocumentID: input.SourceInboundDocumentID,
		SourceInboundLineID:     input.SourceInboundLineID,
		ItemID:                  input.ItemID,
		CustomerID:              input.CustomerID,
		LocationID:              input.LocationID,
		StorageSection:          fallbackSection(input.StorageSection),
		ContainerNo:             input.ContainerNo,
		OriginalQty:             input.OriginalQty,
		RemainingQty:            input.RemainingQty,
		CreatedAt:               time.Now().UTC(),
	}, nil
}

func (s *Store) createMovementLotLinkTx(ctx context.Context, tx *sql.Tx, movementID int64, receiptLotID int64, quantity int, linkType string) error {
	if movementID <= 0 || receiptLotID <= 0 || quantity <= 0 {
		return fmt.Errorf("%w: invalid movement lot link input", ErrInvalidInput)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO movement_lot_links (
			movement_id,
			receipt_lot_id,
			quantity,
			link_type
		) VALUES (?, ?, ?, ?)
	`, movementID, receiptLotID, quantity, linkType); err != nil {
		return mapDBError(fmt.Errorf("create movement lot link: %w", err))
	}
	return nil
}

func (s *Store) updateReceiptLotRemainingTx(ctx context.Context, tx *sql.Tx, receiptLotID int64, nextRemainingQty int) error {
	if nextRemainingQty < 0 {
		return ErrInsufficientStock
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE receipt_lots
		SET remaining_qty = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nextRemainingQty, receiptLotID); err != nil {
		return mapDBError(fmt.Errorf("update receipt lot remaining quantity: %w", err))
	}
	return nil
}

func (s *Store) listOpenReceiptLotsForItemTx(ctx context.Context, tx *sql.Tx, itemID int64) ([]receiptLot, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			COALESCE(parent_receipt_lot_id, 0) AS parent_receipt_lot_id,
			source_inbound_document_id,
			source_inbound_line_id,
			item_id,
			customer_id,
			location_id,
			storage_section,
			COALESCE(container_no, '') AS container_no,
			original_qty,
			remaining_qty,
			created_at
		FROM receipt_lots
		WHERE item_id = ? AND remaining_qty > 0
		ORDER BY created_at ASC, id ASC
		FOR UPDATE
	`, itemID)
	if err != nil {
		return nil, fmt.Errorf("load receipt lots by item: %w", err)
	}
	defer rows.Close()

	return scanReceiptLots(rows)
}

func (s *Store) listOpenReceiptLotsForInboundLineTx(ctx context.Context, tx *sql.Tx, inboundLineID int64, newestFirst bool) ([]receiptLot, error) {
	orderDirection := "ASC"
	if newestFirst {
		orderDirection = "DESC"
	}
	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`
		SELECT
			id,
			COALESCE(parent_receipt_lot_id, 0) AS parent_receipt_lot_id,
			source_inbound_document_id,
			source_inbound_line_id,
			item_id,
			customer_id,
			location_id,
			storage_section,
			COALESCE(container_no, '') AS container_no,
			original_qty,
			remaining_qty,
			created_at
		FROM receipt_lots
		WHERE source_inbound_line_id = ? AND remaining_qty > 0
		ORDER BY created_at %s, id %s
		FOR UPDATE
	`, orderDirection, orderDirection), inboundLineID)
	if err != nil {
		return nil, fmt.Errorf("load receipt lots by inbound line: %w", err)
	}
	defer rows.Close()

	return scanReceiptLots(rows)
}

func (s *Store) findRepresentativeReceiptLotItemTx(ctx context.Context, tx *sql.Tx, inboundLineID int64) (int64, error) {
	var itemID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT item_id
		FROM receipt_lots
		WHERE source_inbound_line_id = ? AND remaining_qty > 0
		ORDER BY created_at DESC, id DESC
		LIMIT 1
		FOR UPDATE
	`, inboundLineID).Scan(&itemID); err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, fmt.Errorf("load representative receipt lot item: %w", err)
	}
	return itemID, nil
}

func (s *Store) consumeReceiptLotsForItemTx(ctx context.Context, tx *sql.Tx, itemID int64, quantity int, movementID int64, linkType string) ([]receiptLotConsumption, error) {
	if quantity <= 0 {
		return []receiptLotConsumption{}, nil
	}

	lots, err := s.listOpenReceiptLotsForItemTx(ctx, tx, itemID)
	if err != nil {
		return nil, err
	}
	if len(lots) == 0 {
		// Legacy inventory can exist without receipt-lot lineage. Keep the
		// movement valid, but skip lot-link generation for the uncovered portion.
		return []receiptLotConsumption{}, nil
	}

	remaining := quantity
	consumptions := make([]receiptLotConsumption, 0)
	for _, lot := range lots {
		if remaining == 0 {
			break
		}
		takeQty := lot.RemainingQty
		if takeQty > remaining {
			takeQty = remaining
		}
		if takeQty <= 0 {
			continue
		}
		if err := s.updateReceiptLotRemainingTx(ctx, tx, lot.ID, lot.RemainingQty-takeQty); err != nil {
			return nil, err
		}
		if err := s.createMovementLotLinkTx(ctx, tx, movementID, lot.ID, takeQty, linkType); err != nil {
			return nil, err
		}
		consumptions = append(consumptions, receiptLotConsumption{Lot: lot, Quantity: takeQty})
		remaining -= takeQty
	}
	return consumptions, nil
}

func (s *Store) restoreReceiptLotsForMovementTx(ctx context.Context, tx *sql.Tx, movementID int64) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT receipt_lot_id, quantity
		FROM movement_lot_links
		WHERE movement_id = ?
		ORDER BY id ASC
		FOR UPDATE
	`, movementID)
	if err != nil {
		return fmt.Errorf("load movement lot links: %w", err)
	}
	defer rows.Close()

	type restoreRow struct {
		ReceiptLotID int64
		Quantity     int
	}
	restoreRows := make([]restoreRow, 0)
	for rows.Next() {
		var row restoreRow
		if err := rows.Scan(&row.ReceiptLotID, &row.Quantity); err != nil {
			return fmt.Errorf("scan movement lot link: %w", err)
		}
		restoreRows = append(restoreRows, row)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate movement lot links: %w", err)
	}

	for _, row := range restoreRows {
		var currentRemaining int
		if err := tx.QueryRowContext(ctx, `
			SELECT remaining_qty
			FROM receipt_lots
			WHERE id = ?
			FOR UPDATE
		`, row.ReceiptLotID).Scan(&currentRemaining); err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			return fmt.Errorf("load receipt lot for restore: %w", err)
		}
		if err := s.updateReceiptLotRemainingTx(ctx, tx, row.ReceiptLotID, currentRemaining+row.Quantity); err != nil {
			return err
		}
	}

	return nil
}

func scanReceiptLots(rows *sql.Rows) ([]receiptLot, error) {
	lots := make([]receiptLot, 0)
	for rows.Next() {
		var lot receiptLot
		if err := rows.Scan(
			&lot.ID,
			&lot.ParentReceiptLotID,
			&lot.SourceInboundDocumentID,
			&lot.SourceInboundLineID,
			&lot.ItemID,
			&lot.CustomerID,
			&lot.LocationID,
			&lot.StorageSection,
			&lot.ContainerNo,
			&lot.OriginalQty,
			&lot.RemainingQty,
			&lot.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan receipt lot: %w", err)
		}
		lot.StorageSection = fallbackSection(lot.StorageSection)
		lots = append(lots, lot)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate receipt lots: %w", err)
	}
	return lots, nil
}
