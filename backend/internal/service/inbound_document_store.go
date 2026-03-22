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

type InboundDocument struct {
	ID            int64                 `json:"id"`
	CustomerID    int64                 `json:"customerId"`
	CustomerName  string                `json:"customerName"`
	LocationID    int64                 `json:"locationId"`
	LocationName  string                `json:"locationName"`
	DeliveryDate  *time.Time            `json:"deliveryDate"`
	ContainerNo   string                `json:"containerNo"`
	StorageSection string               `json:"storageSection"`
	UnitLabel     string                `json:"unitLabel"`
	DocumentNote  string                `json:"documentNote"`
	Status        string                `json:"status"`
	TotalLines    int                   `json:"totalLines"`
	TotalExpectedQty int                `json:"totalExpectedQty"`
	TotalReceivedQty int                `json:"totalReceivedQty"`
	CreatedAt     time.Time             `json:"createdAt"`
	UpdatedAt     time.Time             `json:"updatedAt"`
	Lines         []InboundDocumentLine `json:"lines"`
}

type InboundDocumentLine struct {
	ID               int64     `json:"id"`
	DocumentID       int64     `json:"documentId"`
	MovementID       int64     `json:"movementId"`
	ItemID           int64     `json:"itemId"`
	SKU              string    `json:"sku"`
	Description      string    `json:"description"`
	StorageSection   string    `json:"storageSection"`
	ExpectedQty      int       `json:"expectedQty"`
	ReceivedQty      int       `json:"receivedQty"`
	Pallets          int       `json:"pallets"`
	PalletsDetailCtns string   `json:"palletsDetailCtns"`
	UnitLabel        string    `json:"unitLabel"`
	LineNote         string    `json:"lineNote"`
	CreatedAt        time.Time `json:"createdAt"`
}

type CreateInboundDocumentInput struct {
	CustomerID     int64                        `json:"customerId"`
	LocationID     int64                        `json:"locationId"`
	DeliveryDate   string                       `json:"deliveryDate"`
	ContainerNo    string                       `json:"containerNo"`
	StorageSection string                       `json:"storageSection"`
	UnitLabel      string                       `json:"unitLabel"`
	DocumentNote   string                       `json:"documentNote"`
	Lines          []CreateInboundDocumentLineInput `json:"lines"`
}

type CreateInboundDocumentLineInput struct {
	SKU               string `json:"sku"`
	Description       string `json:"description"`
	ReorderLevel      int    `json:"reorderLevel"`
	ExpectedQty       int    `json:"expectedQty"`
	ReceivedQty       int    `json:"receivedQty"`
	Pallets           int    `json:"pallets"`
	PalletsDetailCtns string `json:"palletsDetailCtns"`
	StorageSection    string `json:"storageSection"`
	LineNote          string `json:"lineNote"`
}

type inboundDocumentRow struct {
	ID             int64      `db:"id"`
	CustomerID     int64      `db:"customer_id"`
	CustomerName   string     `db:"customer_name"`
	LocationID     int64      `db:"location_id"`
	LocationName   string     `db:"location_name"`
	DeliveryDate   *time.Time `db:"delivery_date"`
	ContainerNo    string     `db:"container_no"`
	StorageSection string     `db:"storage_section"`
	UnitLabel      string     `db:"unit_label"`
	DocumentNote   string     `db:"document_note"`
	Status         string     `db:"status"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
}

type inboundDocumentLineRow struct {
	ID                 int64     `db:"id"`
	DocumentID         int64     `db:"document_id"`
	MovementID         int64     `db:"movement_id"`
	ItemID             int64     `db:"item_id"`
	SKUSnapshot        string    `db:"sku_snapshot"`
	DescriptionSnapshot string   `db:"description_snapshot"`
	StorageSection     string    `db:"storage_section"`
	ExpectedQty        int       `db:"expected_qty"`
	ReceivedQty        int       `db:"received_qty"`
	Pallets            int       `db:"pallets"`
	PalletsDetailCtns  string    `db:"pallets_detail_ctns"`
	UnitLabel          string    `db:"unit_label"`
	LineNote           string    `db:"line_note"`
	CreatedAt          time.Time `db:"created_at"`
}

func (s *Store) ListInboundDocuments(ctx context.Context, limit int) ([]InboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}

	documentRows := make([]inboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, `
		SELECT
			d.id,
			d.customer_id,
			c.name AS customer_name,
			d.location_id,
			l.name AS location_name,
			d.delivery_date,
			COALESCE(d.container_no, '') AS container_no,
			d.storage_section,
			COALESCE(d.unit_label, '') AS unit_label,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			d.created_at,
			d.updated_at
		FROM inbound_documents d
		JOIN customers c ON c.id = d.customer_id
		JOIN storage_locations l ON l.id = d.location_id
		ORDER BY COALESCE(d.delivery_date, d.created_at) DESC, d.id DESC
		LIMIT ?
	`, limit); err != nil {
		return nil, fmt.Errorf("load inbound documents: %w", err)
	}
	if len(documentRows) == 0 {
		return []InboundDocument{}, nil
	}

	documentIDs := make([]int64, 0, len(documentRows))
	documents := make([]InboundDocument, 0, len(documentRows))
	documentsByID := make(map[int64]*InboundDocument, len(documentRows))
	for _, row := range documentRows {
		document := InboundDocument{
			ID:             row.ID,
			CustomerID:     row.CustomerID,
			CustomerName:   row.CustomerName,
			LocationID:     row.LocationID,
			LocationName:   row.LocationName,
			DeliveryDate:   row.DeliveryDate,
			ContainerNo:    row.ContainerNo,
			StorageSection: fallbackSection(row.StorageSection),
			UnitLabel:      row.UnitLabel,
			DocumentNote:   row.DocumentNote,
			Status:         row.Status,
			CreatedAt:      row.CreatedAt,
			UpdatedAt:      row.UpdatedAt,
			Lines:          make([]InboundDocumentLine, 0),
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
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			expected_qty,
			received_qty,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inbound_document_lines
		WHERE document_id IN (?)
		ORDER BY document_id DESC, sort_order ASC, id ASC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build inbound document line query: %w", err)
	}

	lineRows := make([]inboundDocumentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), args...); err != nil {
		return nil, fmt.Errorf("load inbound document lines: %w", err)
	}

	for _, lineRow := range lineRows {
		document := documentsByID[lineRow.DocumentID]
		if document == nil {
			continue
		}
		document.Lines = append(document.Lines, InboundDocumentLine{
			ID:                lineRow.ID,
			DocumentID:        lineRow.DocumentID,
			MovementID:        lineRow.MovementID,
			ItemID:            lineRow.ItemID,
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			StorageSection:    fallbackSection(lineRow.StorageSection),
			ExpectedQty:       lineRow.ExpectedQty,
			ReceivedQty:       lineRow.ReceivedQty,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			LineNote:          lineRow.LineNote,
			CreatedAt:         lineRow.CreatedAt,
		})
		document.TotalLines++
		document.TotalExpectedQty += lineRow.ExpectedQty
		document.TotalReceivedQty += lineRow.ReceivedQty
	}

	return documents, nil
}

func (s *Store) CreateInboundDocument(ctx context.Context, input CreateInboundDocumentInput) (InboundDocument, error) {
	input = sanitizeInboundDocumentInput(input)
	if err := validateInboundDocumentInput(input); err != nil {
		return InboundDocument{}, err
	}

	deliveryDate, err := parseOptionalDate(input.DeliveryDate)
	if err != nil {
		return InboundDocument{}, err
	}
	if deliveryDate == nil {
		now := time.Now().UTC()
		deliveryDate = &now
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound document transaction: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id,
			location_id,
			delivery_date,
			container_no,
			storage_section,
			unit_label,
			document_note,
			status
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED')
	`,
		input.CustomerID,
		input.LocationID,
		nullableTime(deliveryDate),
		nullableString(input.ContainerNo),
		fallbackSection(input.StorageSection),
		nullableString(input.UnitLabel),
		nullableString(input.DocumentNote),
	)
	if err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("create inbound document: %w", err))
	}

	documentID, err := result.LastInsertId()
	if err != nil {
		return InboundDocument{}, fmt.Errorf("resolve inbound document id: %w", err)
	}

	for index, line := range input.Lines {
		itemID, itemDescription, err := s.findOrCreateInboundItem(ctx, tx, input, line, deliveryDate)
		if err != nil {
			return InboundDocument{}, err
		}

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO inbound_document_lines (
				document_id,
				item_id,
				sku_snapshot,
				description_snapshot,
				storage_section,
				expected_qty,
				received_qty,
				pallets,
				pallets_detail_ctns,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			itemID,
			line.SKU,
			nullableString(itemDescription),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			line.ExpectedQty,
			line.ReceivedQty,
			line.Pallets,
			nullableString(line.PalletsDetailCtns),
			nullableString(firstNonEmpty(input.UnitLabel, "CTN")),
			nullableString(line.LineNote),
			index+1,
		)
		if err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("create inbound document line: %w", err))
		}

		lineID, err := lineResult.LastInsertId()
		if err != nil {
			return InboundDocument{}, fmt.Errorf("resolve inbound document line id: %w", err)
		}

		receivedQty := line.receivedOrExpectedQty()
		movementResult, err := tx.ExecContext(ctx, `
			INSERT INTO stock_movements (
				item_id,
				inbound_document_id,
				inbound_document_line_id,
				customer_id,
				location_id,
				storage_section,
				movement_type,
				quantity_change,
				delivery_date,
				container_no,
				description_snapshot,
				expected_qty,
				received_qty,
				pallets,
				pallets_detail_ctns,
				unit_label,
				height_in,
				document_note,
				reason
			) VALUES (?, ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			itemID,
			documentID,
			lineID,
			input.CustomerID,
			input.LocationID,
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			receivedQty,
			nullableTime(deliveryDate),
			nullableString(input.ContainerNo),
			nullableString(itemDescription),
			line.ExpectedQty,
			line.ReceivedQty,
			line.Pallets,
			nullableString(line.PalletsDetailCtns),
			nullableString(firstNonEmpty(input.UnitLabel, "CTN")),
			0,
			nullableString(input.DocumentNote),
			nullableString(firstNonEmpty(line.LineNote, defaultMovementReason("IN"))),
		)
		if err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("create inbound stock movement: %w", err))
		}

		movementID, err := movementResult.LastInsertId()
		if err != nil {
			return InboundDocument{}, fmt.Errorf("resolve inbound movement id: %w", err)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_document_lines
			SET movement_id = ?
			WHERE id = ?
		`, movementID, lineID); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("link inbound line to movement: %w", err))
		}

		currentQuantity, _, _, _, _, err := s.loadLockedItemForMovement(ctx, tx, itemID)
		if err != nil {
			return InboundDocument{}, err
		}
		updatedQuantity := currentQuantity + receivedQty
		movementInput := CreateMovementInput{
			ItemID:            itemID,
			MovementType:      "IN",
			Quantity:          receivedQty,
			StorageSection:    fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			DeliveryDate:      deliveryDate.Format(time.DateOnly),
			ContainerNo:       input.ContainerNo,
			ExpectedQty:       line.ExpectedQty,
			ReceivedQty:       line.ReceivedQty,
			Pallets:           line.Pallets,
			PalletsDetailCtns: line.PalletsDetailCtns,
			UnitLabel:         firstNonEmpty(input.UnitLabel, "CTN"),
			HeightIn:          0,
			DocumentNote:      input.DocumentNote,
			Reason:            firstNonEmpty(line.LineNote, defaultMovementReason("IN")),
		}
		if err := s.applyMovementToInventoryItem(ctx, tx, itemID, updatedQuantity, receivedQty, movementInput, deliveryDate, nil); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("update inventory after inbound document line: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound document: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) getInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	documents, err := s.listInboundDocumentsByIDs(ctx, []int64{documentID})
	if err != nil {
		return InboundDocument{}, err
	}
	if len(documents) == 0 {
		return InboundDocument{}, ErrNotFound
	}
	return documents[0], nil
}

func (s *Store) listInboundDocumentsByIDs(ctx context.Context, documentIDs []int64) ([]InboundDocument, error) {
	if len(documentIDs) == 0 {
		return []InboundDocument{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			d.id,
			d.customer_id,
			c.name AS customer_name,
			d.location_id,
			l.name AS location_name,
			d.delivery_date,
			COALESCE(d.container_no, '') AS container_no,
			d.storage_section,
			COALESCE(d.unit_label, '') AS unit_label,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			d.created_at,
			d.updated_at
		FROM inbound_documents d
		JOIN customers c ON c.id = d.customer_id
		JOIN storage_locations l ON l.id = d.location_id
		WHERE d.id IN (?)
		ORDER BY COALESCE(d.delivery_date, d.created_at) DESC, d.id DESC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build inbound document query: %w", err)
	}

	documentRows := make([]inboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load inbound documents by id: %w", err)
	}
	if len(documentRows) == 0 {
		return []InboundDocument{}, nil
	}

	documents := make([]InboundDocument, 0, len(documentRows))
	documentsByID := make(map[int64]*InboundDocument, len(documentRows))
	for _, row := range documentRows {
		document := InboundDocument{
			ID:              row.ID,
			CustomerID:      row.CustomerID,
			CustomerName:    row.CustomerName,
			LocationID:      row.LocationID,
			LocationName:    row.LocationName,
			DeliveryDate:    row.DeliveryDate,
			ContainerNo:     row.ContainerNo,
			StorageSection:  fallbackSection(row.StorageSection),
			UnitLabel:       row.UnitLabel,
			DocumentNote:    row.DocumentNote,
			Status:          row.Status,
			CreatedAt:       row.CreatedAt,
			UpdatedAt:       row.UpdatedAt,
			Lines:           make([]InboundDocumentLine, 0),
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
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			expected_qty,
			received_qty,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inbound_document_lines
		WHERE document_id IN (?)
		ORDER BY document_id DESC, sort_order ASC, id ASC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build inbound document line query by id: %w", err)
	}

	lineRows := make([]inboundDocumentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load inbound document lines by id: %w", err)
	}

	for _, lineRow := range lineRows {
		document := documentsByID[lineRow.DocumentID]
		if document == nil {
			continue
		}

		document.Lines = append(document.Lines, InboundDocumentLine{
			ID:                lineRow.ID,
			DocumentID:        lineRow.DocumentID,
			MovementID:        lineRow.MovementID,
			ItemID:            lineRow.ItemID,
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			StorageSection:    fallbackSection(lineRow.StorageSection),
			ExpectedQty:       lineRow.ExpectedQty,
			ReceivedQty:       lineRow.ReceivedQty,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			LineNote:          lineRow.LineNote,
			CreatedAt:         lineRow.CreatedAt,
		})
		document.TotalLines++
		document.TotalExpectedQty += lineRow.ExpectedQty
		document.TotalReceivedQty += lineRow.ReceivedQty
	}

	return documents, nil
}

func (s *Store) findOrCreateInboundItem(ctx context.Context, tx *sql.Tx, documentInput CreateInboundDocumentInput, line CreateInboundDocumentLineInput, deliveryDate *time.Time) (int64, string, error) {
	var itemID int64
	var description string
	err := tx.QueryRowContext(ctx, `
		SELECT id, COALESCE(description, name, '')
		FROM inventory_items
		WHERE sku = ? AND customer_id = ? AND location_id = ?
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
		FOR UPDATE
	`, line.SKU, documentInput.CustomerID, documentInput.LocationID).Scan(&itemID, &description)
	if err == nil {
		if strings.TrimSpace(description) == "" {
			description = line.Description
		}
		return itemID, description, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, "", fmt.Errorf("load inbound inventory item by sku: %w", err)
	}
	if strings.TrimSpace(line.Description) == "" {
		return 0, "", fmt.Errorf("%w: description is required for new inbound sku rows", ErrInvalidInput)
	}

	itemInput := sanitizeItemInput(CreateItemInput{
		SKU:               line.SKU,
		Name:              firstNonEmpty(line.Description, line.SKU),
		Category:          "General",
		Description:       line.Description,
		Unit:              strings.ToLower(firstNonEmpty(documentInput.UnitLabel, "CTN")),
		Quantity:          0,
		ReorderLevel:      line.ReorderLevel,
		CustomerID:        documentInput.CustomerID,
		LocationID:        documentInput.LocationID,
		StorageSection:    firstNonEmpty(line.StorageSection, documentInput.StorageSection),
		DeliveryDate:      safeDateInput(deliveryDate),
		ContainerNo:       documentInput.ContainerNo,
		ExpectedQty:       line.ExpectedQty,
		ReceivedQty:       line.ReceivedQty,
		Pallets:           line.Pallets,
		PalletsDetailCtns: line.PalletsDetailCtns,
		HeightIn:          0,
	})
	if err := validateItemInput(itemInput); err != nil {
		return 0, "", err
	}

	skuMasterID, err := s.ensureSKUMaster(ctx, tx, itemInput)
	if err != nil {
		return 0, "", err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			sku,
			name,
			category,
			description,
			unit,
			quantity,
			reorder_level,
			location_id,
			storage_section,
			delivery_date,
			container_no,
			expected_qty,
			received_qty,
			pallets,
			pallets_detail_ctns,
			height_in,
			out_date,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
	`,
		skuMasterID,
		itemInput.CustomerID,
		itemInput.SKU,
		itemInput.Name,
		itemInput.Category,
		itemInput.Description,
		itemInput.Unit,
		itemInput.ReorderLevel,
		itemInput.LocationID,
		itemInput.StorageSection,
		nullableTime(deliveryDate),
		nullableString(itemInput.ContainerNo),
		itemInput.ExpectedQty,
		itemInput.ReceivedQty,
		itemInput.Pallets,
		nullableString(itemInput.PalletsDetailCtns),
	)
	if err != nil {
		return 0, "", mapDBError(fmt.Errorf("create inbound inventory item: %w", err))
	}

	itemID, err = result.LastInsertId()
	if err != nil {
		return 0, "", fmt.Errorf("resolve inbound item id: %w", err)
	}

	return itemID, itemInput.Description, nil
}

func sanitizeInboundDocumentInput(input CreateInboundDocumentInput) CreateInboundDocumentInput {
	input.ContainerNo = strings.TrimSpace(strings.ToUpper(input.ContainerNo))
	input.StorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(input.StorageSection)))
	input.UnitLabel = strings.TrimSpace(strings.ToUpper(input.UnitLabel))
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)

	lines := make([]CreateInboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.SKU = strings.TrimSpace(strings.ToUpper(line.SKU))
		line.Description = strings.TrimSpace(line.Description)
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.StorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(line.StorageSection)))
		line.LineNote = strings.TrimSpace(line.LineNote)
		if line.SKU == "" {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateInboundDocumentInput(input CreateInboundDocumentInput) error {
	switch {
	case input.CustomerID <= 0:
		return fmt.Errorf("%w: customer is required", ErrInvalidInput)
	case input.LocationID <= 0:
		return fmt.Errorf("%w: location is required", ErrInvalidInput)
	case len(input.Lines) == 0:
		return fmt.Errorf("%w: at least one inbound line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.SKU == "":
			return fmt.Errorf("%w: sku is required", ErrInvalidInput)
		case line.ExpectedQty < 0 || line.ReceivedQty < 0 || line.Pallets < 0 || line.ReorderLevel < 0:
			return fmt.Errorf("%w: quantities and reorder level cannot be negative", ErrInvalidInput)
		case line.ExpectedQty == 0 && line.ReceivedQty == 0:
			return fmt.Errorf("%w: expected or received quantity is required", ErrInvalidInput)
		}
	}

	return nil
}

func (line CreateInboundDocumentLineInput) receivedOrExpectedQty() int {
	if line.ReceivedQty > 0 {
		return line.ReceivedQty
	}
	return line.ExpectedQty
}

func safeDateInput(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.DateOnly)
}
