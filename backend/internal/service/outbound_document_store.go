package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type OutboundDocument struct {
	ID                 int64                  `json:"id"`
	PackingListNo      string                 `json:"packingListNo"`
	OrderRef           string                 `json:"orderRef"`
	CustomerID         int64                  `json:"customerId"`
	CustomerName       string                 `json:"customerName"`
	OutDate            *time.Time             `json:"outDate"`
	DocumentNote       string                 `json:"documentNote"`
	Status             string                 `json:"status"`
	CancelNote         string                 `json:"cancelNote"`
	CancelledAt        *time.Time             `json:"cancelledAt"`
	TotalLines         int                    `json:"totalLines"`
	TotalQty           int                    `json:"totalQty"`
	TotalNetWeightKgs  float64                `json:"totalNetWeightKgs"`
	TotalGrossWeightKgs float64               `json:"totalGrossWeightKgs"`
	Storages           string                 `json:"storages"`
	Lines              []OutboundDocumentLine `json:"lines"`
	CreatedAt          time.Time              `json:"createdAt"`
	UpdatedAt          time.Time              `json:"updatedAt"`
}

type OutboundDocumentLine struct {
	ID             int64     `json:"id"`
	DocumentID     int64     `json:"documentId"`
	MovementID     int64     `json:"movementId"`
	ItemID         int64     `json:"itemId"`
	LocationID     int64     `json:"locationId"`
	LocationName   string    `json:"locationName"`
	StorageSection string    `json:"storageSection"`
	SKU            string    `json:"sku"`
	Description    string    `json:"description"`
	Quantity       int       `json:"quantity"`
	UnitLabel      string    `json:"unitLabel"`
	CartonSizeMM   string    `json:"cartonSizeMm"`
	NetWeightKgs   float64   `json:"netWeightKgs"`
	GrossWeightKgs float64   `json:"grossWeightKgs"`
	LineNote       string    `json:"lineNote"`
	CreatedAt      time.Time `json:"createdAt"`
}

type CreateOutboundDocumentInput struct {
	PackingListNo string                      `json:"packingListNo"`
	OrderRef      string                      `json:"orderRef"`
	OutDate       string                      `json:"outDate"`
	DocumentNote  string                      `json:"documentNote"`
	Lines         []CreateOutboundDocumentLineInput `json:"lines"`
}

type CreateOutboundDocumentLineInput struct {
	ItemID         int64   `json:"itemId"`
	Quantity       int     `json:"quantity"`
	UnitLabel      string  `json:"unitLabel"`
	CartonSizeMM   string  `json:"cartonSizeMm"`
	NetWeightKgs   float64 `json:"netWeightKgs"`
	GrossWeightKgs float64 `json:"grossWeightKgs"`
	LineNote       string  `json:"lineNote"`
}

type outboundDocumentRow struct {
	ID           int64     `db:"id"`
	PackingListNo string   `db:"packing_list_no"`
	OrderRef     string    `db:"order_ref"`
	CustomerID   int64     `db:"customer_id"`
	CustomerName string    `db:"customer_name"`
	OutDate      *time.Time `db:"out_date"`
	DocumentNote string    `db:"document_note"`
	Status       string    `db:"status"`
	CancelNote   string    `db:"cancel_note"`
	CancelledAt  *time.Time `db:"cancelled_at"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}

type CancelOutboundDocumentInput struct {
	Reason string `json:"reason"`
}

type outboundDocumentLineRow struct {
	ID                 int64     `db:"id"`
	DocumentID         int64     `db:"document_id"`
	MovementID         int64     `db:"movement_id"`
	ItemID             int64     `db:"item_id"`
	LocationID         int64     `db:"location_id"`
	LocationName       string    `db:"location_name_snapshot"`
	StorageSection     string    `db:"storage_section"`
	SKUSnapshot        string    `db:"sku_snapshot"`
	DescriptionSnapshot string   `db:"description_snapshot"`
	Quantity           int       `db:"quantity"`
	UnitLabel          string    `db:"unit_label"`
	CartonSizeMM       string    `db:"carton_size_mm"`
	NetWeightKgs       float64   `db:"net_weight_kgs"`
	GrossWeightKgs     float64   `db:"gross_weight_kgs"`
	LineNote           string    `db:"line_note"`
	CreatedAt          time.Time `db:"created_at"`
}

type lockedOutboundItem struct {
	ItemID         int64
	CustomerID     int64
	LocationID     int64
	LocationName   string
	StorageSection string
	SKU            string
	Description    string
	Unit           string
	Quantity       int
	HeightIn       int
}

func (s *Store) ListOutboundDocuments(ctx context.Context, limit int) ([]OutboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}

	documentRows := make([]outboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, `
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.out_date,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		ORDER BY COALESCE(d.out_date, d.created_at) DESC, d.id DESC
		LIMIT ?
	`, limit); err != nil {
		return nil, fmt.Errorf("load outbound documents: %w", err)
	}

	if len(documentRows) == 0 {
		return []OutboundDocument{}, nil
	}

	documentIDs := make([]int64, 0, len(documentRows))
	documentsByID := make(map[int64]*OutboundDocument, len(documentRows))
	documents := make([]OutboundDocument, 0, len(documentRows))
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:           row.ID,
			PackingListNo: row.PackingListNo,
			OrderRef:     row.OrderRef,
			CustomerID:   row.CustomerID,
			CustomerName: row.CustomerName,
			OutDate:      row.OutDate,
			DocumentNote: row.DocumentNote,
			Status:       row.Status,
			CancelNote:   row.CancelNote,
			CancelledAt:  row.CancelledAt,
			Lines:        make([]OutboundDocumentLine, 0),
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
		}
		documents = append(documents, document)
		documentIDs = append(documentIDs, row.ID)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			document_id,
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM outbound_document_lines
		WHERE document_id IN (?)
		ORDER BY document_id DESC, sort_order ASC, id ASC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound document line query: %w", err)
	}

	lineRows := make([]outboundDocumentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), args...); err != nil {
		return nil, fmt.Errorf("load outbound document lines: %w", err)
	}

	for _, lineRow := range lineRows {
		document := documentsByID[lineRow.DocumentID]
		if document == nil {
			continue
		}

		document.Lines = append(document.Lines, OutboundDocumentLine{
			ID:             lineRow.ID,
			DocumentID:     lineRow.DocumentID,
			MovementID:     lineRow.MovementID,
			ItemID:         lineRow.ItemID,
			LocationID:     lineRow.LocationID,
			LocationName:   lineRow.LocationName,
			StorageSection: lineRow.StorageSection,
			SKU:            lineRow.SKUSnapshot,
			Description:    lineRow.DescriptionSnapshot,
			Quantity:       lineRow.Quantity,
			UnitLabel:      lineRow.UnitLabel,
			CartonSizeMM:   lineRow.CartonSizeMM,
			NetWeightKgs:   lineRow.NetWeightKgs,
			GrossWeightKgs: lineRow.GrossWeightKgs,
			LineNote:       lineRow.LineNote,
			CreatedAt:      lineRow.CreatedAt,
		})
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}

	return documents, nil
}

func (s *Store) CreateOutboundDocument(ctx context.Context, input CreateOutboundDocumentInput) (OutboundDocument, error) {
	input = sanitizeOutboundDocumentInput(input)
	if err := validateOutboundDocumentInput(input); err != nil {
		return OutboundDocument{}, err
	}

	outDate, err := parseOptionalDate(input.OutDate)
	if err != nil {
		return OutboundDocument{}, err
	}
	if outDate == nil {
		now := time.Now().UTC()
		outDate = &now
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound document transaction: %w", err)
	}
	defer tx.Rollback()

	lockedItems := make(map[int64]lockedOutboundItem)
	requestedByItemID := make(map[int64]int)
	var customerID int64

	for _, line := range input.Lines {
		lockedItem, exists := lockedItems[line.ItemID]
		if !exists {
			lockedItem, err = s.loadLockedOutboundItem(ctx, tx, line.ItemID)
			if err != nil {
				return OutboundDocument{}, err
			}
			lockedItems[line.ItemID] = lockedItem
		}

		if customerID == 0 {
			customerID = lockedItem.CustomerID
		} else if customerID != lockedItem.CustomerID {
			return OutboundDocument{}, fmt.Errorf("%w: all outbound lines must belong to the same customer", ErrInvalidInput)
		}

		requestedByItemID[line.ItemID] += line.Quantity
		if requestedByItemID[line.ItemID] > lockedItem.Quantity {
			return OutboundDocument{}, ErrInsufficientStock
		}
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO outbound_documents (
			packing_list_no,
			order_ref,
			customer_id,
			out_date,
			document_note,
			status
		) VALUES (?, ?, ?, ?, ?, 'POSTED')
	`,
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		customerID,
		nullableTime(outDate),
		nullableString(input.DocumentNote),
	)
	if err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound document: %w", err))
	}

	documentID, err := result.LastInsertId()
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("resolve outbound document id: %w", err)
	}

	runningQuantities := make(map[int64]int, len(lockedItems))
	for itemID, lockedItem := range lockedItems {
		runningQuantities[itemID] = lockedItem.Quantity
	}

	for index, line := range input.Lines {
		lockedItem := lockedItems[line.ItemID]

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_document_lines (
				document_id,
				item_id,
				location_id,
				location_name_snapshot,
				storage_section,
				sku_snapshot,
				description_snapshot,
				quantity,
				unit_label,
				carton_size_mm,
				net_weight_kgs,
				gross_weight_kgs,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			lockedItem.ItemID,
			lockedItem.LocationID,
			lockedItem.LocationName,
			fallbackSection(lockedItem.StorageSection),
			lockedItem.SKU,
			nullableString(lockedItem.Description),
			line.Quantity,
			nullableString(firstNonEmpty(line.UnitLabel, strings.ToUpper(lockedItem.Unit), "PCS")),
			nullableString(line.CartonSizeMM),
			line.NetWeightKgs,
			line.GrossWeightKgs,
			nullableString(line.LineNote),
			index+1,
		)
		if err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound document line: %w", err))
		}

		lineID, err := lineResult.LastInsertId()
		if err != nil {
			return OutboundDocument{}, fmt.Errorf("resolve outbound document line id: %w", err)
		}

		updatedQuantity := runningQuantities[line.ItemID] - line.Quantity
		runningQuantities[line.ItemID] = updatedQuantity

		movementResult, err := tx.ExecContext(ctx, `
			INSERT INTO stock_movements (
				item_id,
				outbound_document_id,
				outbound_document_line_id,
				customer_id,
				location_id,
				storage_section,
				movement_type,
				quantity_change,
				packing_list_no,
				order_ref,
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
				out_date,
				document_note,
				reason
			) VALUES (?, ?, ?, ?, ?, ?, 'OUT', ?, ?, ?, ?, 0, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			lockedItem.ItemID,
			documentID,
			lineID,
			lockedItem.CustomerID,
			lockedItem.LocationID,
			fallbackSection(lockedItem.StorageSection),
			-line.Quantity,
			nullableString(input.PackingListNo),
			nullableString(input.OrderRef),
			nullableString(lockedItem.Description),
			nullableString(line.CartonSizeMM),
			line.Quantity,
			nullableString(firstNonEmpty(line.UnitLabel, strings.ToUpper(lockedItem.Unit), "PCS")),
			line.NetWeightKgs,
			line.GrossWeightKgs,
			lockedItem.HeightIn,
			nullableTime(outDate),
			nullableString(input.DocumentNote),
			firstNonEmpty(line.LineNote, defaultMovementReason("OUT")),
		)
		if err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound stock movement: %w", err))
		}

		movementID, err := movementResult.LastInsertId()
		if err != nil {
			return OutboundDocument{}, fmt.Errorf("resolve outbound movement id: %w", err)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_document_lines
			SET movement_id = ?
			WHERE id = ?
		`, movementID, lineID); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("link outbound line to movement: %w", err))
		}

		movementInput := CreateMovementInput{
			ItemID:          lockedItem.ItemID,
			MovementType:    "OUT",
			Quantity:        line.Quantity,
			StorageSection:  fallbackSection(lockedItem.StorageSection),
			PackingListNo:   input.PackingListNo,
			OrderRef:        input.OrderRef,
			CartonSizeMM:    line.CartonSizeMM,
			CartonCount:     line.Quantity,
			UnitLabel:       firstNonEmpty(line.UnitLabel, strings.ToUpper(lockedItem.Unit), "PCS"),
			NetWeightKgs:    line.NetWeightKgs,
			GrossWeightKgs:  line.GrossWeightKgs,
			HeightIn:        lockedItem.HeightIn,
			OutDate:         safeOutboundDateInput(outDate),
			DocumentNote:    input.DocumentNote,
			Reason:          firstNonEmpty(line.LineNote, defaultMovementReason("OUT")),
		}

		if err := s.applyMovementToInventoryItem(ctx, tx, lockedItem.ItemID, updatedQuantity, -line.Quantity, movementInput, nil, outDate); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("update inventory after outbound document line: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound document: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) CancelOutboundDocument(ctx context.Context, documentID int64, input CancelOutboundDocumentInput) (OutboundDocument, error) {
	input.Reason = strings.TrimSpace(input.Reason)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound cancel transaction: %w", err)
	}
	defer tx.Rollback()

	var documentRow outboundDocumentRow
	if err := tx.QueryRowContext(ctx, `
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.out_date,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE d.id = ?
		FOR UPDATE
	`, documentID).Scan(
		&documentRow.ID,
		&documentRow.PackingListNo,
		&documentRow.OrderRef,
		&documentRow.CustomerID,
		&documentRow.CustomerName,
		&documentRow.OutDate,
		&documentRow.DocumentNote,
		&documentRow.Status,
		&documentRow.CancelNote,
		&documentRow.CancelledAt,
		&documentRow.CreatedAt,
		&documentRow.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OutboundDocument{}, ErrNotFound
		}
		return OutboundDocument{}, fmt.Errorf("load outbound document for cancel: %w", err)
	}

	if strings.EqualFold(documentRow.Status, "CANCELLED") {
		return OutboundDocument{}, fmt.Errorf("%w: outbound document is already cancelled", ErrInvalidInput)
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			document_id,
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM outbound_document_lines
		WHERE document_id = ?
		ORDER BY sort_order ASC, id ASC
	`, documentID)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("load outbound document lines for cancel: %w", err)
	}
	defer rows.Close()

	lineRows := make([]outboundDocumentLineRow, 0)
	for rows.Next() {
		var lineRow outboundDocumentLineRow
		if err := rows.Scan(
			&lineRow.ID,
			&lineRow.DocumentID,
			&lineRow.MovementID,
			&lineRow.ItemID,
			&lineRow.LocationID,
			&lineRow.LocationName,
			&lineRow.StorageSection,
			&lineRow.SKUSnapshot,
			&lineRow.DescriptionSnapshot,
			&lineRow.Quantity,
			&lineRow.UnitLabel,
			&lineRow.CartonSizeMM,
			&lineRow.NetWeightKgs,
			&lineRow.GrossWeightKgs,
			&lineRow.LineNote,
			&lineRow.CreatedAt,
		); err != nil {
			return OutboundDocument{}, fmt.Errorf("scan outbound document line for cancel: %w", err)
		}
		lineRows = append(lineRows, lineRow)
	}
	if err := rows.Err(); err != nil {
		return OutboundDocument{}, fmt.Errorf("iterate outbound document lines for cancel: %w", err)
	}

	cancellationReason := firstNonEmpty(input.Reason, fmt.Sprintf("Reversal of outbound %s", firstNonEmpty(documentRow.PackingListNo, fmt.Sprintf("OUT-%d", documentID))))
	cancelledAt := time.Now().UTC()

	for _, lineRow := range lineRows {
		currentQuantity, customerID, locationID, storageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, lineRow.ItemID)
		if err != nil {
			return OutboundDocument{}, err
		}

		delta := lineRow.Quantity
		updatedQuantity := currentQuantity + delta

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO stock_movements (
				item_id,
				outbound_document_id,
				outbound_document_line_id,
				customer_id,
				location_id,
				storage_section,
				movement_type,
				quantity_change,
				packing_list_no,
				order_ref,
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
				reason
			) VALUES (?, ?, ?, ?, ?, ?, 'REVERSAL', ?, ?, ?, ?, 0, 0, 0, NULL, ?, ?, ?, ?, ?, 0, ?, ?)
		`,
			lineRow.ItemID,
			documentID,
			lineRow.ID,
			customerID,
			locationID,
			fallbackSection(storageSection),
			delta,
			nullableString(documentRow.PackingListNo),
			nullableString(documentRow.OrderRef),
			nullableString(firstNonEmpty(descriptionSnapshot, lineRow.DescriptionSnapshot)),
			nullableString(lineRow.CartonSizeMM),
			lineRow.Quantity,
			nullableString(firstNonEmpty(lineRow.UnitLabel, "PCS")),
			lineRow.NetWeightKgs,
			lineRow.GrossWeightKgs,
			nullableString(documentRow.DocumentNote),
			nullableString(cancellationReason),
		); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound reversal movement: %w", err))
		}

		movementInput := CreateMovementInput{
			ItemID:         lineRow.ItemID,
			MovementType:   "REVERSAL",
			Quantity:       lineRow.Quantity,
			StorageSection: fallbackSection(storageSection),
			CartonSizeMM:   lineRow.CartonSizeMM,
			CartonCount:    lineRow.Quantity,
			UnitLabel:      firstNonEmpty(lineRow.UnitLabel, "PCS"),
			NetWeightKgs:   lineRow.NetWeightKgs,
			GrossWeightKgs: lineRow.GrossWeightKgs,
			DocumentNote:   documentRow.DocumentNote,
			Reason:         cancellationReason,
		}
		if err := s.applyMovementToInventoryItem(ctx, tx, lineRow.ItemID, updatedQuantity, delta, movementInput, nil, nil); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("restore inventory after outbound cancellation: %w", err))
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET
			status = 'CANCELLED',
			cancel_note = ?,
			cancelled_at = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nullableString(input.Reason), cancelledAt, documentID); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("cancel outbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound cancel: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) getOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	documents, err := s.listOutboundDocumentsByIDs(ctx, []int64{documentID})
	if err != nil {
		return OutboundDocument{}, err
	}
	if len(documents) == 0 {
		return OutboundDocument{}, ErrNotFound
	}
	return documents[0], nil
}

func (s *Store) listOutboundDocumentsByIDs(ctx context.Context, documentIDs []int64) ([]OutboundDocument, error) {
	if len(documentIDs) == 0 {
		return []OutboundDocument{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.out_date,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE d.id IN (?)
		ORDER BY COALESCE(d.out_date, d.created_at) DESC, d.id DESC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound document query: %w", err)
	}

	documentRows := make([]outboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load outbound documents by id: %w", err)
	}
	if len(documentRows) == 0 {
		return []OutboundDocument{}, nil
	}

	documents := make([]OutboundDocument, 0, len(documentRows))
	documentsByID := make(map[int64]*OutboundDocument, len(documentRows))
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:            row.ID,
			PackingListNo: row.PackingListNo,
			OrderRef:      row.OrderRef,
			CustomerID:    row.CustomerID,
			CustomerName:  row.CustomerName,
			OutDate:       row.OutDate,
			DocumentNote:  row.DocumentNote,
			Status:        row.Status,
			CancelNote:    row.CancelNote,
			CancelledAt:   row.CancelledAt,
			Lines:         make([]OutboundDocumentLine, 0),
			CreatedAt:     row.CreatedAt,
			UpdatedAt:     row.UpdatedAt,
		}
		documents = append(documents, document)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			document_id,
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM outbound_document_lines
		WHERE document_id IN (?)
		ORDER BY document_id DESC, sort_order ASC, id ASC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound document line query by id: %w", err)
	}

	lineRows := make([]outboundDocumentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load outbound document lines by id: %w", err)
	}

	for _, lineRow := range lineRows {
		document := documentsByID[lineRow.DocumentID]
		if document == nil {
			continue
		}
		document.Lines = append(document.Lines, OutboundDocumentLine{
			ID:             lineRow.ID,
			DocumentID:     lineRow.DocumentID,
			MovementID:     lineRow.MovementID,
			ItemID:         lineRow.ItemID,
			LocationID:     lineRow.LocationID,
			LocationName:   lineRow.LocationName,
			StorageSection: lineRow.StorageSection,
			SKU:            lineRow.SKUSnapshot,
			Description:    lineRow.DescriptionSnapshot,
			Quantity:       lineRow.Quantity,
			UnitLabel:      lineRow.UnitLabel,
			CartonSizeMM:   lineRow.CartonSizeMM,
			NetWeightKgs:   lineRow.NetWeightKgs,
			GrossWeightKgs: lineRow.GrossWeightKgs,
			LineNote:       lineRow.LineNote,
			CreatedAt:      lineRow.CreatedAt,
		})
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}

	return documents, nil
}

func (s *Store) loadLockedOutboundItem(ctx context.Context, tx *sql.Tx, itemID int64) (lockedOutboundItem, error) {
	var item lockedOutboundItem
	if err := tx.QueryRowContext(ctx, `
		SELECT
			i.id,
			i.customer_id,
			i.location_id,
			l.name,
			i.storage_section,
			i.sku,
			COALESCE(i.description, i.name, ''),
			COALESCE(i.unit, 'pcs'),
			i.quantity,
			i.height_in
		FROM inventory_items i
		JOIN storage_locations l ON l.id = i.location_id
		WHERE i.id = ?
		FOR UPDATE
	`, itemID).Scan(
		&item.ItemID,
		&item.CustomerID,
		&item.LocationID,
		&item.LocationName,
		&item.StorageSection,
		&item.SKU,
		&item.Description,
		&item.Unit,
		&item.Quantity,
		&item.HeightIn,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return lockedOutboundItem{}, ErrNotFound
		}
		return lockedOutboundItem{}, fmt.Errorf("load outbound inventory item: %w", err)
	}

	return item, nil
}

func sanitizeOutboundDocumentInput(input CreateOutboundDocumentInput) CreateOutboundDocumentInput {
	input.PackingListNo = strings.TrimSpace(strings.ToUpper(input.PackingListNo))
	input.OrderRef = strings.TrimSpace(strings.ToUpper(input.OrderRef))
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)
	lines := make([]CreateOutboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.UnitLabel = strings.TrimSpace(strings.ToUpper(line.UnitLabel))
		line.CartonSizeMM = strings.TrimSpace(line.CartonSizeMM)
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.ItemID <= 0 || line.Quantity <= 0 {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateOutboundDocumentInput(input CreateOutboundDocumentInput) error {
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one outbound line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.ItemID <= 0:
			return fmt.Errorf("%w: stock row is required", ErrInvalidInput)
		case line.Quantity <= 0:
			return fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
		case line.NetWeightKgs < 0 || line.GrossWeightKgs < 0:
			return fmt.Errorf("%w: weights cannot be negative", ErrInvalidInput)
		}
	}

	return nil
}

func appendUniqueJoined(existing string, nextValue string) string {
	values := make([]string, 0)
	seen := make(map[string]struct{})
	for _, value := range strings.Split(existing, ",") {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		values = append(values, trimmed)
	}

	trimmedNext := strings.TrimSpace(nextValue)
	if trimmedNext != "" {
		if _, exists := seen[trimmedNext]; !exists {
			values = append(values, trimmedNext)
		}
	}

	return strings.Join(values, ", ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func fallbackSection(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "A"
	}
	return trimmed
}

func safeOutboundDateInput(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.DateOnly)
}
