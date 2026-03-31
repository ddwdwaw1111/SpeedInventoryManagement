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
	ID               int64                 `json:"id"`
	CustomerID       int64                 `json:"customerId"`
	CustomerName     string                `json:"customerName"`
	LocationID       int64                 `json:"locationId"`
	LocationName     string                `json:"locationName"`
	DeliveryDate     *time.Time            `json:"deliveryDate"`
	ContainerNo      string                `json:"containerNo"`
	StorageSection   string                `json:"storageSection"`
	UnitLabel        string                `json:"unitLabel"`
	DocumentNote     string                `json:"documentNote"`
	Status           string                `json:"status"`
	TrackingStatus   string                `json:"trackingStatus"`
	ConfirmedAt      *time.Time            `json:"confirmedAt"`
	CancelNote       string                `json:"cancelNote"`
	CancelledAt      *time.Time            `json:"cancelledAt"`
	ArchivedAt       *time.Time            `json:"archivedAt"`
	TotalLines       int                   `json:"totalLines"`
	TotalExpectedQty int                   `json:"totalExpectedQty"`
	TotalReceivedQty int                   `json:"totalReceivedQty"`
	CreatedAt        time.Time             `json:"createdAt"`
	UpdatedAt        time.Time             `json:"updatedAt"`
	Lines            []InboundDocumentLine `json:"lines"`
}

type InboundDocumentLine struct {
	ID                int64     `json:"id"`
	DocumentID        int64     `json:"documentId"`
	MovementID        int64     `json:"movementId"`
	ItemID            int64     `json:"itemId"`
	SKU               string    `json:"sku"`
	Description       string    `json:"description"`
	StorageSection    string    `json:"storageSection"`
	ReorderLevel      int       `json:"reorderLevel"`
	ExpectedQty       int       `json:"expectedQty"`
	ReceivedQty       int       `json:"receivedQty"`
	Pallets           int       `json:"pallets"`
	PalletsDetailCtns string    `json:"palletsDetailCtns"`
	UnitLabel         string    `json:"unitLabel"`
	LineNote          string    `json:"lineNote"`
	CreatedAt         time.Time `json:"createdAt"`
}

type CreateInboundDocumentInput struct {
	CustomerID     int64                            `json:"customerId"`
	LocationID     int64                            `json:"locationId"`
	DeliveryDate   string                           `json:"deliveryDate"`
	ContainerNo    string                           `json:"containerNo"`
	StorageSection string                           `json:"storageSection"`
	UnitLabel      string                           `json:"unitLabel"`
	Status         string                           `json:"status"`
	TrackingStatus string                           `json:"trackingStatus"`
	DocumentNote   string                           `json:"documentNote"`
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
	TrackingStatus string     `db:"tracking_status"`
	ConfirmedAt    *time.Time `db:"confirmed_at"`
	CancelNote     string     `db:"cancel_note"`
	CancelledAt    *time.Time `db:"cancelled_at"`
	ArchivedAt     *time.Time `db:"archived_at"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
}

type inboundDocumentLineRow struct {
	ID                  int64     `db:"id"`
	DocumentID          int64     `db:"document_id"`
	MovementID          int64     `db:"movement_id"`
	ItemID              int64     `db:"item_id"`
	SKUSnapshot         string    `db:"sku_snapshot"`
	DescriptionSnapshot string    `db:"description_snapshot"`
	StorageSection      string    `db:"storage_section"`
	ReorderLevel        int       `db:"reorder_level"`
	ExpectedQty         int       `db:"expected_qty"`
	ReceivedQty         int       `db:"received_qty"`
	Pallets             int       `db:"pallets"`
	PalletsDetailCtns   string    `db:"pallets_detail_ctns"`
	UnitLabel           string    `db:"unit_label"`
	LineNote            string    `db:"line_note"`
	CreatedAt           time.Time `db:"created_at"`
}

type CancelInboundDocumentInput struct {
	Reason string `json:"reason"`
}

func (s *Store) ListInboundDocuments(ctx context.Context, limit int, archiveScope ...string) ([]InboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}

	normalizedArchiveScope := DocumentArchiveScopeActive
	if len(archiveScope) > 0 {
		normalizedArchiveScope = normalizeDocumentArchiveScope(archiveScope[0])
	}
	archiveFilterClause := buildDocumentArchiveFilterClause("d", normalizedArchiveScope)

	documentRows := make([]inboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, fmt.Sprintf(`
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
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM inbound_documents d
		JOIN customers c ON c.id = d.customer_id
		JOIN storage_locations l ON l.id = d.location_id
		WHERE %s
		ORDER BY COALESCE(d.delivery_date, d.created_at) DESC, d.id DESC
		LIMIT ?
	`, archiveFilterClause), limit); err != nil {
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
			Status:         normalizeDocumentStatus(row.Status),
			TrackingStatus: normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:    row.ConfirmedAt,
			CancelNote:     row.CancelNote,
			CancelledAt:    row.CancelledAt,
			ArchivedAt:     row.ArchivedAt,
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
			COALESCE(item_id, 0) AS item_id,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			reorder_level,
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
			ReorderLevel:      lineRow.ReorderLevel,
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
	requestedStatus := coalesceDocumentStatus(input.Status)
	requestedTrackingStatus := coalesceInboundTrackingStatus(input.TrackingStatus, requestedStatus)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound document transaction: %w", err)
	}
	defer tx.Rollback()

	persistedStatus := requestedStatus
	if requestedStatus == DocumentStatusConfirmed {
		persistedStatus = DocumentStatusDraft
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id,
			location_id,
			delivery_date,
			container_no,
			storage_section,
			unit_label,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at,
			cancel_note,
			cancelled_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
	`,
		input.CustomerID,
		input.LocationID,
		nullableTime(deliveryDate),
		nullableString(input.ContainerNo),
		fallbackSection(input.StorageSection),
		nullableString(input.UnitLabel),
		nullableString(input.DocumentNote),
		persistedStatus,
		requestedTrackingStatus,
	)
	if err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("create inbound document: %w", err))
	}

	documentID, err := result.LastInsertId()
	if err != nil {
		return InboundDocument{}, fmt.Errorf("resolve inbound document id: %w", err)
	}

	for index, line := range input.Lines {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO inbound_document_lines (
				document_id,
				item_id,
				sku_snapshot,
				description_snapshot,
				storage_section,
				reorder_level,
				expected_qty,
				received_qty,
				pallets,
				pallets_detail_ctns,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			nil,
			line.SKU,
			nullableString(line.Description),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			line.ReorderLevel,
			line.ExpectedQty,
			line.ReceivedQty,
			line.Pallets,
			nullableString(line.PalletsDetailCtns),
			nullableString(firstNonEmpty(input.UnitLabel, "CTN")),
			nullableString(line.LineNote),
			index+1,
		); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("create inbound document line: %w", err))
		}
	}

	switch requestedStatus {
	case DocumentStatusConfirmed:
		if err := s.confirmInboundDocumentTx(ctx, tx, documentID); err != nil {
			return InboundDocument{}, err
		}
	case DocumentStatusDraft:
		// Draft documents remain pending until confirmed.
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound document: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) UpdateInboundDocument(ctx context.Context, documentID int64, input CreateInboundDocumentInput) (InboundDocument, error) {
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
	requestedStatus := coalesceDocumentStatus(input.Status)
	requestedTrackingStatus := coalesceInboundTrackingStatus(input.TrackingStatus, requestedStatus)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound update transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	switch normalizeDocumentStatus(documentRow.Status) {
	case DocumentStatusDraft:
		if err := s.updateDraftInboundDocumentTx(ctx, tx, documentID, documentRow, input, deliveryDate, requestedStatus, requestedTrackingStatus); err != nil {
			return InboundDocument{}, err
		}
	case DocumentStatusConfirmed:
		if err := s.updateConfirmedInboundDocumentTx(ctx, tx, documentID, documentRow, input, deliveryDate); err != nil {
			return InboundDocument{}, err
		}
	default:
		return InboundDocument{}, fmt.Errorf("%w: only draft or confirmed receipts can be edited", ErrInvalidInput)
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound update: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) updateDraftInboundDocumentTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	_ inboundDocumentRow,
	input CreateInboundDocumentInput,
	deliveryDate *time.Time,
	requestedStatus string,
	requestedTrackingStatus string,
) error {
	existingLines, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return err
	}
	for _, line := range existingLines {
		if line.MovementID > 0 {
			return fmt.Errorf("%w: confirmed receipt lines cannot be edited", ErrInvalidInput)
		}
	}

	persistedStatus := requestedStatus
	if requestedStatus == DocumentStatusConfirmed {
		persistedStatus = DocumentStatusDraft
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			customer_id = ?,
			location_id = ?,
			delivery_date = ?,
			container_no = ?,
			storage_section = ?,
			unit_label = ?,
			document_note = ?,
			status = ?,
			tracking_status = ?,
			confirmed_at = NULL,
			posted_at = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		input.CustomerID,
		input.LocationID,
		nullableTime(deliveryDate),
		nullableString(input.ContainerNo),
		fallbackSection(input.StorageSection),
		nullableString(input.UnitLabel),
		nullableString(input.DocumentNote),
		persistedStatus,
		requestedTrackingStatus,
		documentID,
	); err != nil {
		return mapDBError(fmt.Errorf("update inbound document: %w", err))
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM inbound_document_lines WHERE document_id = ?`, documentID); err != nil {
		return mapDBError(fmt.Errorf("delete inbound draft lines: %w", err))
	}

	for index, line := range input.Lines {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO inbound_document_lines (
				document_id,
				item_id,
				sku_snapshot,
				description_snapshot,
				storage_section,
				reorder_level,
				expected_qty,
				received_qty,
				pallets,
				pallets_detail_ctns,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			nil,
			line.SKU,
			nullableString(line.Description),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			line.ReorderLevel,
			line.ExpectedQty,
			line.ReceivedQty,
			line.Pallets,
			nullableString(line.PalletsDetailCtns),
			nullableString(firstNonEmpty(input.UnitLabel, "CTN")),
			nullableString(line.LineNote),
			index+1,
		); err != nil {
			return mapDBError(fmt.Errorf("recreate inbound document line: %w", err))
		}
	}

	if requestedStatus == DocumentStatusConfirmed {
		if err := s.confirmInboundDocumentTx(ctx, tx, documentID); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) updateConfirmedInboundDocumentTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	input CreateInboundDocumentInput,
	deliveryDate *time.Time,
) error {
	if documentRow.ArchivedAt != nil {
		return fmt.Errorf("%w: archived receipts cannot be edited", ErrInvalidInput)
	}
	if input.CustomerID != documentRow.CustomerID {
		return fmt.Errorf("%w: confirmed receipt customer cannot be changed", ErrInvalidInput)
	}
	if input.LocationID != documentRow.LocationID {
		return fmt.Errorf("%w: confirmed receipt warehouse cannot be changed", ErrInvalidInput)
	}
	if coalesceDocumentStatus(input.Status) != DocumentStatusConfirmed {
		return fmt.Errorf("%w: confirmed receipts must remain confirmed", ErrInvalidInput)
	}

	existingLines, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return err
	}
	if len(existingLines) != len(input.Lines) {
		return fmt.Errorf("%w: confirmed receipt lines cannot be added or removed", ErrInvalidInput)
	}

	oldContainerNo := strings.TrimSpace(documentRow.ContainerNo)
	newContainerNo := strings.TrimSpace(input.ContainerNo)
	newDocumentSection := fallbackSection(firstNonEmpty(input.StorageSection, existingLines[0].StorageSection, documentRow.StorageSection))

	for index, existingLine := range existingLines {
		nextLine := input.Lines[index]
		if nextLine.SKU != existingLine.SKUSnapshot {
			return fmt.Errorf("%w: confirmed receipt SKU lines cannot be reordered or replaced", ErrInvalidInput)
		}
		if existingLine.MovementID <= 0 || existingLine.ItemID <= 0 {
			return fmt.Errorf("%w: confirmed receipt line is missing inventory history", ErrInvalidInput)
		}

		oldQty := existingLine.receivedOrExpectedQty()
		newQty := nextLine.receivedOrExpectedQty()
		oldSection := fallbackSection(existingLine.StorageSection)
		newSection := fallbackSection(firstNonEmpty(nextLine.StorageSection, input.StorageSection, existingLine.StorageSection))
		positionChanged := oldSection != newSection || oldContainerNo != newContainerNo
		lineDescription := firstNonEmpty(nextLine.Description, existingLine.DescriptionSnapshot)
		unitLabel := firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, existingLine.UnitLabel, "CTN")
		currentItemID := existingLine.ItemID

		if newQty < oldQty {
			if err := s.reduceConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, oldQty-newQty, lineDescription, unitLabel, input.DocumentNote); err != nil {
				return err
			}
		}

		if positionChanged {
			movedItemID, err := s.moveConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, newSection, newContainerNo, lineDescription, unitLabel, input.DocumentNote)
			if err != nil {
				return err
			}
			if movedItemID > 0 {
				currentItemID = movedItemID
			}
		}

		if newQty > oldQty {
			increasedItemID, err := s.increaseConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, newSection, newContainerNo, newQty-oldQty, lineDescription, unitLabel, input.DocumentNote)
			if err != nil {
				return err
			}
			if increasedItemID > 0 {
				currentItemID = increasedItemID
			}
		}

		if representativeItemID, err := s.findRepresentativeReceiptLotItemTx(ctx, tx, existingLine.ID); err != nil {
			return err
		} else if representativeItemID > 0 {
			currentItemID = representativeItemID
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_document_lines
			SET
				item_id = ?,
				description_snapshot = ?,
				storage_section = ?,
				reorder_level = ?,
				expected_qty = ?,
				received_qty = ?,
				pallets = ?,
				pallets_detail_ctns = ?,
				unit_label = ?,
				line_note = ?
			WHERE id = ?
		`,
			currentItemID,
			nullableString(firstNonEmpty(nextLine.Description, existingLine.DescriptionSnapshot)),
			newSection,
			nextLine.ReorderLevel,
			nextLine.ExpectedQty,
			nextLine.ReceivedQty,
			nextLine.Pallets,
			nullableString(nextLine.PalletsDetailCtns),
			nullableString(firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, existingLine.UnitLabel, "CTN")),
			nullableString(nextLine.LineNote),
			existingLine.ID,
		); err != nil {
			return mapDBError(fmt.Errorf("update confirmed inbound line: %w", err))
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE stock_movements
			SET
				delivery_date = ?,
				description_snapshot = ?,
				expected_qty = ?,
				received_qty = ?,
				pallets = ?,
				pallets_detail_ctns = ?,
				unit_label = ?,
				document_note = ?,
				reason = ?
			WHERE id = ?
		`,
			nullableTime(deliveryDate),
			nullableString(lineDescription),
			nextLine.ExpectedQty,
			nextLine.ReceivedQty,
			nextLine.Pallets,
			nullableString(nextLine.PalletsDetailCtns),
			nullableString(unitLabel),
			nullableString(input.DocumentNote),
			nullableString(firstNonEmpty(nextLine.LineNote, defaultMovementReason("IN"))),
			existingLine.MovementID,
		); err != nil {
			return mapDBError(fmt.Errorf("update original inbound movement metadata: %w", err))
		}

		if err := s.syncConfirmedInboundOpenLotItemsTx(ctx, tx, existingLine.ID, deliveryDate, nextLine.ExpectedQty, nextLine.ReceivedQty, nextLine.ReorderLevel, lineDescription, unitLabel); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			delivery_date = ?,
			container_no = ?,
			storage_section = ?,
			unit_label = ?,
			document_note = ?,
			status = ?,
			tracking_status = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableTime(deliveryDate),
		nullableString(newContainerNo),
		newDocumentSection,
		nullableString(firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, "CTN")),
		nullableString(input.DocumentNote),
		DocumentStatusConfirmed,
		InboundTrackingReceived,
		documentID,
	); err != nil {
		return mapDBError(fmt.Errorf("update confirmed inbound document: %w", err))
	}

	return nil
}

type inboundEditableItem struct {
	ID             int64
	SKUMasterID    int64
	CustomerID     int64
	LocationID     int64
	StorageSection string
	ContainerNo    string
	SKU            string
	Name           string
	Category       string
	Description    string
	Unit           string
	ReorderLevel   int
	Quantity       int
}

type inboundCorrectionMovementInput struct {
	ItemID                int64
	InboundDocumentID     int64
	InboundDocumentLineID int64
	CustomerID            int64
	LocationID            int64
	StorageSection        string
	MovementType          string
	QuantityChange        int
	DeliveryDate          *time.Time
	ContainerNo           string
	Description           string
	ExpectedQty           int
	ReceivedQty           int
	Pallets               int
	PalletsDetailCtns     string
	UnitLabel             string
	DocumentNote          string
	Reason                string
}

func (s *Store) loadLockedInboundEditableItemTx(ctx context.Context, tx *sql.Tx, itemID int64) (inboundEditableItem, error) {
	var item inboundEditableItem
	if err := tx.QueryRowContext(ctx, `
		SELECT
			id,
			sku_master_id,
			customer_id,
			location_id,
			storage_section,
			COALESCE(container_no, '') AS container_no,
			sku,
			name,
			category,
			COALESCE(description, name, '') AS description,
			COALESCE(unit, 'pcs') AS unit,
			reorder_level,
			quantity
		FROM inventory_items
		WHERE id = ?
		FOR UPDATE
	`, itemID).Scan(
		&item.ID,
		&item.SKUMasterID,
		&item.CustomerID,
		&item.LocationID,
		&item.StorageSection,
		&item.ContainerNo,
		&item.SKU,
		&item.Name,
		&item.Category,
		&item.Description,
		&item.Unit,
		&item.ReorderLevel,
		&item.Quantity,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return inboundEditableItem{}, ErrNotFound
		}
		return inboundEditableItem{}, fmt.Errorf("load inbound inventory item: %w", err)
	}
	item.StorageSection = fallbackSection(item.StorageSection)
	return item, nil
}

func (s *Store) hasInboundReceiptExternalInventoryActivityTx(ctx context.Context, tx *sql.Tx, itemID int64, inboundDocumentID int64) (bool, error) {
	var conflictID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM stock_movements
		WHERE item_id = ?
		  AND movement_type IN ('OUT', 'ADJUST', 'REVERSAL', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT')
		  AND COALESCE(inbound_document_id, 0) <> ?
		ORDER BY id DESC
		LIMIT 1
	`, itemID, inboundDocumentID).Scan(&conflictID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check inbound receipt downstream activity: %w", err)
	}
	return conflictID > 0, nil
}

func (s *Store) updateInboundEditableItemQuantityTx(ctx context.Context, tx *sql.Tx, itemID int64, nextQuantity int) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET quantity = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nextQuantity, itemID); err != nil {
		return mapDBError(fmt.Errorf("update inbound inventory quantity: %w", err))
	}
	return nil
}

func (s *Store) updateInboundEditableItemStateTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	nextQuantity int,
	storageSection string,
	containerNo string,
	deliveryDate *time.Time,
	expectedQty int,
	receivedQty int,
	reorderLevel int,
	description string,
	unitLabel string,
) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			quantity = ?,
			storage_section = ?,
			container_no = ?,
			delivery_date = ?,
			last_restocked_at = COALESCE(?, last_restocked_at),
			expected_qty = ?,
			received_qty = ?,
			reorder_level = ?,
			description = CASE
				WHEN ? <> '' THEN ?
				ELSE description
			END,
			unit = CASE
				WHEN ? <> '' THEN LOWER(?)
				ELSE unit
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nextQuantity,
		fallbackSection(storageSection),
		nullableString(containerNo),
		nullableTime(deliveryDate),
		nullableTime(deliveryDate),
		expectedQty,
		receivedQty,
		reorderLevel,
		strings.TrimSpace(description),
		nullableString(strings.TrimSpace(description)),
		strings.TrimSpace(unitLabel),
		nullableString(strings.TrimSpace(unitLabel)),
		itemID,
	); err != nil {
		return mapDBError(fmt.Errorf("update inbound inventory state: %w", err))
	}
	return nil
}

func (s *Store) syncConfirmedInboundOpenLotItemsTx(
	ctx context.Context,
	tx *sql.Tx,
	inboundLineID int64,
	deliveryDate *time.Time,
	expectedQty int,
	receivedQty int,
	reorderLevel int,
	description string,
	unitLabel string,
) error {
	openLots, err := s.listOpenReceiptLotsForInboundLineTx(ctx, tx, inboundLineID, false)
	if err != nil {
		return err
	}

	seenItemIDs := make(map[int64]struct{}, len(openLots))
	for _, lot := range openLots {
		if lot.ItemID <= 0 {
			continue
		}
		if _, exists := seenItemIDs[lot.ItemID]; exists {
			continue
		}

		currentItem, err := s.loadLockedInboundEditableItemTx(ctx, tx, lot.ItemID)
		if err != nil {
			return err
		}
		if err := s.updateInboundEditableItemStateTx(
			ctx,
			tx,
			lot.ItemID,
			currentItem.Quantity,
			lot.StorageSection,
			lot.ContainerNo,
			deliveryDate,
			expectedQty,
			receivedQty,
			reorderLevel,
			description,
			unitLabel,
		); err != nil {
			return err
		}

		seenItemIDs[lot.ItemID] = struct{}{}
	}

	return nil
}

func (s *Store) insertInboundCorrectionMovementTx(ctx context.Context, tx *sql.Tx, input inboundCorrectionMovementInput) (int64, error) {
	result, err := tx.ExecContext(ctx, `
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
	`,
		input.ItemID,
		input.InboundDocumentID,
		input.InboundDocumentLineID,
		input.CustomerID,
		input.LocationID,
		fallbackSection(input.StorageSection),
		input.MovementType,
		input.QuantityChange,
		nullableTime(input.DeliveryDate),
		nullableString(input.ContainerNo),
		nullableString(input.Description),
		input.ExpectedQty,
		input.ReceivedQty,
		input.Pallets,
		nullableString(input.PalletsDetailCtns),
		nullableString(input.UnitLabel),
		nullableString(input.DocumentNote),
		nullableString(input.Reason),
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("create inbound correction movement: %w", err))
	}
	movementID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve inbound correction movement id: %w", err)
	}
	return movementID, nil
}

func (s *Store) reduceConfirmedInboundReceiptLotsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	reductionQty int,
	lineDescription string,
	unitLabel string,
	documentNote string,
) error {
	if reductionQty <= 0 {
		return nil
	}

	openLots, err := s.listOpenReceiptLotsForInboundLineTx(ctx, tx, existingLine.ID, true)
	if err != nil {
		return err
	}

	remainingOpenQty := 0
	for _, lot := range openLots {
		remainingOpenQty += lot.RemainingQty
	}
	if reductionQty > remainingOpenQty {
		return fmt.Errorf("%w: receipt line %s cannot reduce below quantity already consumed", ErrInvalidInput, existingLine.SKUSnapshot)
	}

	remainingToReduce := reductionQty
	for _, lot := range openLots {
		if remainingToReduce == 0 {
			break
		}
		takeQty := lot.RemainingQty
		if takeQty > remainingToReduce {
			takeQty = remainingToReduce
		}
		if takeQty <= 0 {
			continue
		}

		currentItem, err := s.loadLockedInboundEditableItemTx(ctx, tx, lot.ItemID)
		if err != nil {
			return err
		}
		nextQuantity := currentItem.Quantity - takeQty
		if nextQuantity < 0 {
			return ErrInsufficientStock
		}

		movementID, err := s.insertInboundCorrectionMovementTx(ctx, tx, inboundCorrectionMovementInput{
			ItemID:                lot.ItemID,
			InboundDocumentID:     documentID,
			InboundDocumentLineID: existingLine.ID,
			CustomerID:            documentRow.CustomerID,
			LocationID:            documentRow.LocationID,
			StorageSection:        lot.StorageSection,
			MovementType:          "ADJUST",
			QuantityChange:        -takeQty,
			DeliveryDate:          deliveryDate,
			ContainerNo:           lot.ContainerNo,
			Description:           lineDescription,
			ExpectedQty:           nextLine.ExpectedQty,
			ReceivedQty:           nextLine.ReceivedQty,
			Pallets:               nextLine.Pallets,
			PalletsDetailCtns:     nextLine.PalletsDetailCtns,
			UnitLabel:             unitLabel,
			DocumentNote:          documentNote,
			Reason:                fmt.Sprintf("Receipt correction: quantity updated from %d to %d", existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty()),
		})
		if err != nil {
			return err
		}
		if err := s.createMovementLotLinkTx(ctx, tx, movementID, lot.ID, takeQty, "adjust"); err != nil {
			return err
		}
		if err := s.updateReceiptLotRemainingTx(ctx, tx, lot.ID, lot.RemainingQty-takeQty); err != nil {
			return err
		}
		if err := s.updateInboundEditableItemStateTx(ctx, tx, lot.ItemID, nextQuantity, lot.StorageSection, lot.ContainerNo, deliveryDate, nextLine.ExpectedQty, nextLine.ReceivedQty, nextLine.ReorderLevel, lineDescription, unitLabel); err != nil {
			return err
		}

		remainingToReduce -= takeQty
	}

	return nil
}

func (s *Store) moveConfirmedInboundReceiptLotsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	targetSection string,
	targetContainerNo string,
	lineDescription string,
	unitLabel string,
	documentNote string,
) (int64, error) {
	openLots, err := s.listOpenReceiptLotsForInboundLineTx(ctx, tx, existingLine.ID, false)
	if err != nil {
		return 0, err
	}
	if len(openLots) == 0 {
		return 0, nil
	}

	targetItemID, _, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
		CustomerID:     documentRow.CustomerID,
		LocationID:     documentRow.LocationID,
		DeliveryDate:   safeDateInput(deliveryDate),
		ContainerNo:    targetContainerNo,
		StorageSection: targetSection,
		UnitLabel:      unitLabel,
		DocumentNote:   documentRow.DocumentNote,
	}, CreateInboundDocumentLineInput{
		SKU:               existingLine.SKUSnapshot,
		Description:       lineDescription,
		ReorderLevel:      nextLine.ReorderLevel,
		ExpectedQty:       nextLine.ExpectedQty,
		ReceivedQty:       nextLine.ReceivedQty,
		Pallets:           nextLine.Pallets,
		PalletsDetailCtns: nextLine.PalletsDetailCtns,
		StorageSection:    targetSection,
		LineNote:          nextLine.LineNote,
	}, deliveryDate)
	if err != nil {
		return 0, err
	}

	targetItem, err := s.loadLockedInboundEditableItemTx(ctx, tx, targetItemID)
	if err != nil {
		return 0, err
	}
	targetQuantity := targetItem.Quantity

	for _, lot := range openLots {
		if lot.RemainingQty <= 0 {
			continue
		}
		if fallbackSection(lot.StorageSection) == fallbackSection(targetSection) && strings.TrimSpace(lot.ContainerNo) == strings.TrimSpace(targetContainerNo) {
			continue
		}

		sourceItem, err := s.loadLockedInboundEditableItemTx(ctx, tx, lot.ItemID)
		if err != nil {
			return 0, err
		}
		nextSourceQuantity := sourceItem.Quantity - lot.RemainingQty
		if nextSourceQuantity < 0 {
			return 0, ErrInsufficientStock
		}

		transferReason := fmt.Sprintf(
			"Receipt correction: moved from %s/%s to %s/%s",
			fallbackSection(lot.StorageSection),
			firstNonEmpty(lot.ContainerNo, "-"),
			fallbackSection(targetSection),
			firstNonEmpty(targetContainerNo, "-"),
		)
		outMovementID, err := s.insertInboundCorrectionMovementTx(ctx, tx, inboundCorrectionMovementInput{
			ItemID:                lot.ItemID,
			InboundDocumentID:     documentID,
			InboundDocumentLineID: existingLine.ID,
			CustomerID:            documentRow.CustomerID,
			LocationID:            documentRow.LocationID,
			StorageSection:        lot.StorageSection,
			MovementType:          "TRANSFER_OUT",
			QuantityChange:        -lot.RemainingQty,
			DeliveryDate:          deliveryDate,
			ContainerNo:           lot.ContainerNo,
			Description:           lineDescription,
			ExpectedQty:           nextLine.ExpectedQty,
			ReceivedQty:           nextLine.ReceivedQty,
			Pallets:               nextLine.Pallets,
			PalletsDetailCtns:     nextLine.PalletsDetailCtns,
			UnitLabel:             unitLabel,
			DocumentNote:          documentNote,
			Reason:                transferReason,
		})
		if err != nil {
			return 0, err
		}
		if err := s.createMovementLotLinkTx(ctx, tx, outMovementID, lot.ID, lot.RemainingQty, "move_out"); err != nil {
			return 0, err
		}
		if err := s.updateReceiptLotRemainingTx(ctx, tx, lot.ID, 0); err != nil {
			return 0, err
		}
		if err := s.updateInboundEditableItemStateTx(ctx, tx, sourceItem.ID, nextSourceQuantity, lot.StorageSection, lot.ContainerNo, deliveryDate, nextLine.ExpectedQty, nextLine.ReceivedQty, nextLine.ReorderLevel, lineDescription, unitLabel); err != nil {
			return 0, err
		}

		targetQuantity += lot.RemainingQty
		inMovementID, err := s.insertInboundCorrectionMovementTx(ctx, tx, inboundCorrectionMovementInput{
			ItemID:                targetItem.ID,
			InboundDocumentID:     documentID,
			InboundDocumentLineID: existingLine.ID,
			CustomerID:            documentRow.CustomerID,
			LocationID:            documentRow.LocationID,
			StorageSection:        targetSection,
			MovementType:          "TRANSFER_IN",
			QuantityChange:        lot.RemainingQty,
			DeliveryDate:          deliveryDate,
			ContainerNo:           targetContainerNo,
			Description:           lineDescription,
			ExpectedQty:           nextLine.ExpectedQty,
			ReceivedQty:           nextLine.ReceivedQty,
			Pallets:               nextLine.Pallets,
			PalletsDetailCtns:     nextLine.PalletsDetailCtns,
			UnitLabel:             unitLabel,
			DocumentNote:          documentNote,
			Reason:                transferReason,
		})
		if err != nil {
			return 0, err
		}
		newLot, err := s.createReceiptLotTx(ctx, tx, createReceiptLotInput{
			ParentReceiptLotID:      lot.ID,
			SourceInboundDocumentID: lot.SourceInboundDocumentID,
			SourceInboundLineID:     lot.SourceInboundLineID,
			ItemID:                  targetItem.ID,
			CustomerID:              lot.CustomerID,
			LocationID:              lot.LocationID,
			StorageSection:          targetSection,
			ContainerNo:             targetContainerNo,
			OriginalQty:             lot.RemainingQty,
			RemainingQty:            lot.RemainingQty,
		})
		if err != nil {
			return 0, err
		}
		if err := s.createMovementLotLinkTx(ctx, tx, inMovementID, newLot.ID, lot.RemainingQty, "move_in"); err != nil {
			return 0, err
		}
		if err := s.updateInboundEditableItemStateTx(ctx, tx, targetItem.ID, targetQuantity, targetSection, targetContainerNo, deliveryDate, nextLine.ExpectedQty, nextLine.ReceivedQty, nextLine.ReorderLevel, lineDescription, unitLabel); err != nil {
			return 0, err
		}
	}

	return targetItem.ID, nil
}

func (s *Store) increaseConfirmedInboundReceiptLotsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	targetSection string,
	targetContainerNo string,
	increaseQty int,
	lineDescription string,
	unitLabel string,
	documentNote string,
) (int64, error) {
	if increaseQty <= 0 {
		return 0, nil
	}

	targetItemID, _, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
		CustomerID:     documentRow.CustomerID,
		LocationID:     documentRow.LocationID,
		DeliveryDate:   safeDateInput(deliveryDate),
		ContainerNo:    targetContainerNo,
		StorageSection: targetSection,
		UnitLabel:      unitLabel,
		DocumentNote:   documentRow.DocumentNote,
	}, CreateInboundDocumentLineInput{
		SKU:               existingLine.SKUSnapshot,
		Description:       lineDescription,
		ReorderLevel:      nextLine.ReorderLevel,
		ExpectedQty:       nextLine.ExpectedQty,
		ReceivedQty:       nextLine.ReceivedQty,
		Pallets:           nextLine.Pallets,
		PalletsDetailCtns: nextLine.PalletsDetailCtns,
		StorageSection:    targetSection,
		LineNote:          nextLine.LineNote,
	}, deliveryDate)
	if err != nil {
		return 0, err
	}

	targetItem, err := s.loadLockedInboundEditableItemTx(ctx, tx, targetItemID)
	if err != nil {
		return 0, err
	}

	movementID, err := s.insertInboundCorrectionMovementTx(ctx, tx, inboundCorrectionMovementInput{
		ItemID:                targetItem.ID,
		InboundDocumentID:     documentID,
		InboundDocumentLineID: existingLine.ID,
		CustomerID:            documentRow.CustomerID,
		LocationID:            documentRow.LocationID,
		StorageSection:        targetSection,
		MovementType:          "ADJUST",
		QuantityChange:        increaseQty,
		DeliveryDate:          deliveryDate,
		ContainerNo:           targetContainerNo,
		Description:           lineDescription,
		ExpectedQty:           nextLine.ExpectedQty,
		ReceivedQty:           nextLine.ReceivedQty,
		Pallets:               nextLine.Pallets,
		PalletsDetailCtns:     nextLine.PalletsDetailCtns,
		UnitLabel:             unitLabel,
		DocumentNote:          documentNote,
		Reason:                fmt.Sprintf("Receipt correction: quantity updated from %d to %d", existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty()),
	})
	if err != nil {
		return 0, err
	}

	newLot, err := s.createReceiptLotTx(ctx, tx, createReceiptLotInput{
		SourceInboundDocumentID: documentID,
		SourceInboundLineID:     existingLine.ID,
		ItemID:                  targetItem.ID,
		CustomerID:              documentRow.CustomerID,
		LocationID:              documentRow.LocationID,
		StorageSection:          targetSection,
		ContainerNo:             targetContainerNo,
		OriginalQty:             increaseQty,
		RemainingQty:            increaseQty,
	})
	if err != nil {
		return 0, err
	}
	if err := s.createMovementLotLinkTx(ctx, tx, movementID, newLot.ID, increaseQty, "adjust"); err != nil {
		return 0, err
	}
	if err := s.updateInboundEditableItemStateTx(ctx, tx, targetItem.ID, targetItem.Quantity+increaseQty, targetSection, targetContainerNo, deliveryDate, nextLine.ExpectedQty, nextLine.ReceivedQty, nextLine.ReorderLevel, lineDescription, unitLabel); err != nil {
		return 0, err
	}

	return targetItem.ID, nil
}

func (s *Store) ConfirmInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound confirm transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusCancelled {
		return InboundDocument{}, fmt.Errorf("%w: cancelled receipt cannot be confirmed", ErrInvalidInput)
	}
	if status == DocumentStatusConfirmed {
		return InboundDocument{}, fmt.Errorf("%w: receipt is already confirmed", ErrInvalidInput)
	}
	if err := s.confirmInboundDocumentTx(ctx, tx, documentID); err != nil {
		return InboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound confirm: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) PostInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	return s.ConfirmInboundDocument(ctx, documentID)
}

func (s *Store) UpdateInboundDocumentTrackingStatus(ctx context.Context, documentID int64, trackingStatus string) (InboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound tracking transition: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}

	documentStatus := normalizeDocumentStatus(documentRow.Status)
	if documentStatus == DocumentStatusCancelled {
		return InboundDocument{}, fmt.Errorf("%w: cancelled receipt cannot change tracking status", ErrInvalidInput)
	}

	currentTrackingStatus := normalizeInboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)
	targetTrackingStatus := normalizeInboundTrackingStatus(trackingStatus, documentRow.Status)
	if err := validateInboundTrackingTransition(currentTrackingStatus, targetTrackingStatus); err != nil {
		return InboundDocument{}, err
	}

	if targetTrackingStatus == InboundTrackingReceived {
		if documentStatus != DocumentStatusConfirmed {
			if err := s.confirmInboundDocumentTx(ctx, tx, documentID); err != nil {
				return InboundDocument{}, err
			}
		} else if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_documents
			SET tracking_status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, InboundTrackingReceived, documentID); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("update inbound tracking status: %w", err))
		}
	} else {
		if documentStatus == DocumentStatusConfirmed {
			return InboundDocument{}, fmt.Errorf("%w: confirmed receipt tracking cannot move away from received", ErrInvalidInput)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_documents
			SET tracking_status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, targetTrackingStatus, documentID); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("update inbound tracking status: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound tracking transition: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) confirmInboundDocumentTx(ctx context.Context, tx *sql.Tx, documentID int64) error {
	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusCancelled {
		return fmt.Errorf("%w: cancelled receipt cannot be confirmed", ErrInvalidInput)
	}
	if status == DocumentStatusConfirmed {
		return fmt.Errorf("%w: receipt is already confirmed", ErrInvalidInput)
	}

	lineRows, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return err
	}

	for _, lineRow := range lineRows {
		if lineRow.MovementID > 0 {
			continue
		}

		itemID, itemDescription, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
			CustomerID:     documentRow.CustomerID,
			LocationID:     documentRow.LocationID,
			DeliveryDate:   safeDateInput(documentRow.DeliveryDate),
			ContainerNo:    documentRow.ContainerNo,
			StorageSection: documentRow.StorageSection,
			UnitLabel:      documentRow.UnitLabel,
			DocumentNote:   documentRow.DocumentNote,
		}, CreateInboundDocumentLineInput{
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			ReorderLevel:      lineRow.ReorderLevel,
			ExpectedQty:       lineRow.ExpectedQty,
			ReceivedQty:       lineRow.ReceivedQty,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			StorageSection:    lineRow.StorageSection,
			LineNote:          lineRow.LineNote,
		}, documentRow.DeliveryDate)
		if err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_document_lines
			SET item_id = ?, description_snapshot = COALESCE(description_snapshot, ?)
			WHERE id = ?
		`, itemID, nullableString(itemDescription), lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("link inbound line to inventory item: %w", err))
		}

		receivedQty := lineRow.receivedOrExpectedQty()
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
			lineRow.ID,
			documentRow.CustomerID,
			documentRow.LocationID,
			fallbackSection(firstNonEmpty(lineRow.StorageSection, documentRow.StorageSection)),
			receivedQty,
			nullableTime(documentRow.DeliveryDate),
			nullableString(documentRow.ContainerNo),
			nullableString(itemDescription),
			lineRow.ExpectedQty,
			lineRow.ReceivedQty,
			lineRow.Pallets,
			nullableString(lineRow.PalletsDetailCtns),
			nullableString(firstNonEmpty(documentRow.UnitLabel, "CTN")),
			0,
			nullableString(documentRow.DocumentNote),
			nullableString(firstNonEmpty(lineRow.LineNote, defaultMovementReason("IN"))),
		)
		if err != nil {
			return mapDBError(fmt.Errorf("create inbound stock movement: %w", err))
		}

		movementID, err := movementResult.LastInsertId()
		if err != nil {
			return fmt.Errorf("resolve inbound movement id: %w", err)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_document_lines
			SET movement_id = ?
			WHERE id = ?
		`, movementID, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("link inbound line to movement: %w", err))
		}

		currentQuantity, _, _, _, _, err := s.loadLockedItemForMovement(ctx, tx, itemID)
		if err != nil {
			return err
		}
		updatedQuantity := currentQuantity + receivedQty
		movementInput := CreateMovementInput{
			ItemID:            itemID,
			MovementType:      "IN",
			Quantity:          receivedQty,
			StorageSection:    fallbackSection(firstNonEmpty(lineRow.StorageSection, documentRow.StorageSection)),
			DeliveryDate:      safeDateInput(documentRow.DeliveryDate),
			ContainerNo:       documentRow.ContainerNo,
			ExpectedQty:       lineRow.ExpectedQty,
			ReceivedQty:       lineRow.ReceivedQty,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         firstNonEmpty(documentRow.UnitLabel, "CTN"),
			HeightIn:          0,
			DocumentNote:      documentRow.DocumentNote,
			Reason:            firstNonEmpty(lineRow.LineNote, defaultMovementReason("IN")),
		}
		if err := s.applyMovementToInventoryItem(ctx, tx, itemID, updatedQuantity, receivedQty, movementInput, documentRow.DeliveryDate, nil); err != nil {
			return mapDBError(fmt.Errorf("update inventory after inbound document line: %w", err))
		}

		if _, err := s.createReceiptLotTx(ctx, tx, createReceiptLotInput{
			SourceInboundDocumentID: documentID,
			SourceInboundLineID:     lineRow.ID,
			ItemID:                  itemID,
			CustomerID:              documentRow.CustomerID,
			LocationID:              documentRow.LocationID,
			StorageSection:          fallbackSection(firstNonEmpty(lineRow.StorageSection, documentRow.StorageSection)),
			ContainerNo:             documentRow.ContainerNo,
			OriginalQty:             receivedQty,
			RemainingQty:            receivedQty,
		}); err != nil {
			return err
		}
	}

	confirmedAt := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			status = ?,
			tracking_status = ?,
			confirmed_at = COALESCE(confirmed_at, ?),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, DocumentStatusConfirmed, InboundTrackingReceived, confirmedAt, documentID); err != nil {
		return mapDBError(fmt.Errorf("mark inbound document confirmed: %w", err))
	}

	return nil
}

func (s *Store) CancelInboundDocument(ctx context.Context, documentID int64, input CancelInboundDocumentInput) (InboundDocument, error) {
	input.Reason = strings.TrimSpace(input.Reason)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound cancel transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusCancelled {
		return InboundDocument{}, fmt.Errorf("%w: inbound document is already cancelled", ErrInvalidInput)
	}

	cancellationReason := firstNonEmpty(input.Reason, fmt.Sprintf("Reversal of inbound %s", firstNonEmpty(documentRow.ContainerNo, fmt.Sprintf("IN-%d", documentID))))
	cancelledAt := time.Now().UTC()

	if status == DocumentStatusConfirmed {
		lineRows, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
		if err != nil {
			return InboundDocument{}, err
		}

		for _, lineRow := range lineRows {
			if lineRow.ItemID <= 0 {
				continue
			}

			currentQuantity, customerID, locationID, storageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, lineRow.ItemID)
			if err != nil {
				return InboundDocument{}, err
			}

			delta := -lineRow.receivedOrExpectedQty()
			updatedQuantity := currentQuantity + delta
			if updatedQuantity < 0 {
				return InboundDocument{}, ErrInsufficientStock
			}

			if _, err := tx.ExecContext(ctx, `
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
				) VALUES (?, ?, ?, ?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
				lineRow.ItemID,
				documentID,
				lineRow.ID,
				customerID,
				locationID,
				fallbackSection(storageSection),
				delta,
				nullableTime(documentRow.DeliveryDate),
				nullableString(documentRow.ContainerNo),
				nullableString(firstNonEmpty(descriptionSnapshot, lineRow.DescriptionSnapshot)),
				lineRow.ExpectedQty,
				lineRow.ReceivedQty,
				lineRow.Pallets,
				nullableString(lineRow.PalletsDetailCtns),
				nullableString(firstNonEmpty(lineRow.UnitLabel, documentRow.UnitLabel, "CTN")),
				0,
				nullableString(documentRow.DocumentNote),
				nullableString(cancellationReason),
			); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("create inbound reversal movement: %w", err))
			}

			movementInput := CreateMovementInput{
				ItemID:            lineRow.ItemID,
				MovementType:      "REVERSAL",
				Quantity:          lineRow.receivedOrExpectedQty(),
				StorageSection:    fallbackSection(storageSection),
				DeliveryDate:      safeDateInput(documentRow.DeliveryDate),
				ContainerNo:       documentRow.ContainerNo,
				ExpectedQty:       lineRow.ExpectedQty,
				ReceivedQty:       lineRow.ReceivedQty,
				Pallets:           lineRow.Pallets,
				PalletsDetailCtns: lineRow.PalletsDetailCtns,
				UnitLabel:         firstNonEmpty(lineRow.UnitLabel, documentRow.UnitLabel, "CTN"),
				HeightIn:          0,
				DocumentNote:      documentRow.DocumentNote,
				Reason:            cancellationReason,
			}
			if err := s.applyMovementToInventoryItem(ctx, tx, lineRow.ItemID, updatedQuantity, delta, movementInput, documentRow.DeliveryDate, nil); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("restore inventory after inbound cancellation: %w", err))
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE receipt_lots
				SET remaining_qty = 0, updated_at = CURRENT_TIMESTAMP
				WHERE source_inbound_line_id = ?
			`, lineRow.ID); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("close receipt lots after inbound cancellation: %w", err))
			}
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			status = ?,
			cancel_note = ?,
			cancelled_at = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, DocumentStatusCancelled, nullableString(cancellationReason), cancelledAt, documentID); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("cancel inbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound cancel: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) ArchiveInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound archive transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if documentRow.ArchivedAt != nil {
		return InboundDocument{}, fmt.Errorf("%w: receipt is already archived", ErrInvalidInput)
	}
	if normalizeDocumentStatus(documentRow.Status) == DocumentStatusConfirmed {
		return InboundDocument{}, fmt.Errorf("%w: confirmed receipts cannot be archived", ErrInvalidInput)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, documentID); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("archive inbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound archive: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) CopyInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound copy transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}

	lineRows, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if len(lineRows) == 0 {
		return InboundDocument{}, fmt.Errorf("%w: receipt must contain at least one line", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id,
			location_id,
			delivery_date,
			container_no,
			storage_section,
			unit_label,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at,
			cancel_note,
			cancelled_at,
			archived_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
	`,
		documentRow.CustomerID,
		documentRow.LocationID,
		nullableTime(documentRow.DeliveryDate),
		nullableString(documentRow.ContainerNo),
		fallbackSection(documentRow.StorageSection),
		nullableString(documentRow.UnitLabel),
		nullableString(documentRow.DocumentNote),
		DocumentStatusDraft,
		InboundTrackingScheduled,
	)
	if err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("copy inbound document: %w", err))
	}

	newDocumentID, err := result.LastInsertId()
	if err != nil {
		return InboundDocument{}, fmt.Errorf("resolve copied inbound document id: %w", err)
	}

	for index, lineRow := range lineRows {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO inbound_document_lines (
				document_id,
				item_id,
				sku_snapshot,
				description_snapshot,
				storage_section,
				reorder_level,
				expected_qty,
				received_qty,
				pallets,
				pallets_detail_ctns,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			newDocumentID,
			lineRow.SKUSnapshot,
			nullableString(lineRow.DescriptionSnapshot),
			fallbackSection(lineRow.StorageSection),
			lineRow.ReorderLevel,
			lineRow.ExpectedQty,
			lineRow.ReceivedQty,
			lineRow.Pallets,
			nullableString(lineRow.PalletsDetailCtns),
			nullableString(lineRow.UnitLabel),
			nullableString(lineRow.LineNote),
			index+1,
		); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("copy inbound document line: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound copy: %w", err)
	}

	return s.getInboundDocument(ctx, newDocumentID)
}

func (s *Store) loadInboundDocumentForUpdateTx(ctx context.Context, tx *sql.Tx, documentID int64) (inboundDocumentRow, error) {
	var documentRow inboundDocumentRow
	if err := tx.QueryRowContext(ctx, `
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
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM inbound_documents d
		JOIN customers c ON c.id = d.customer_id
		JOIN storage_locations l ON l.id = d.location_id
		WHERE d.id = ?
		FOR UPDATE
	`, documentID).Scan(
		&documentRow.ID,
		&documentRow.CustomerID,
		&documentRow.CustomerName,
		&documentRow.LocationID,
		&documentRow.LocationName,
		&documentRow.DeliveryDate,
		&documentRow.ContainerNo,
		&documentRow.StorageSection,
		&documentRow.UnitLabel,
		&documentRow.DocumentNote,
		&documentRow.Status,
		&documentRow.TrackingStatus,
		&documentRow.ConfirmedAt,
		&documentRow.CancelNote,
		&documentRow.CancelledAt,
		&documentRow.ArchivedAt,
		&documentRow.CreatedAt,
		&documentRow.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return inboundDocumentRow{}, ErrNotFound
		}
		return inboundDocumentRow{}, fmt.Errorf("load inbound document for update: %w", err)
	}

	return documentRow, nil
}

func (s *Store) loadInboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64) ([]inboundDocumentLineRow, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			document_id,
			COALESCE(movement_id, 0) AS movement_id,
			COALESCE(item_id, 0) AS item_id,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			reorder_level,
			expected_qty,
			received_qty,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM inbound_document_lines
		WHERE document_id = ?
		ORDER BY sort_order ASC, id ASC
	`, documentID)
	if err != nil {
		return nil, fmt.Errorf("load inbound document lines: %w", err)
	}
	defer rows.Close()

	lineRows := make([]inboundDocumentLineRow, 0)
	for rows.Next() {
		var lineRow inboundDocumentLineRow
		if err := rows.Scan(
			&lineRow.ID,
			&lineRow.DocumentID,
			&lineRow.MovementID,
			&lineRow.ItemID,
			&lineRow.SKUSnapshot,
			&lineRow.DescriptionSnapshot,
			&lineRow.StorageSection,
			&lineRow.ReorderLevel,
			&lineRow.ExpectedQty,
			&lineRow.ReceivedQty,
			&lineRow.Pallets,
			&lineRow.PalletsDetailCtns,
			&lineRow.UnitLabel,
			&lineRow.LineNote,
			&lineRow.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan inbound document line: %w", err)
		}
		lineRows = append(lineRows, lineRow)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate inbound document lines: %w", err)
	}

	return lineRows, nil
}

func (s *Store) getInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	documents, err := s.listInboundDocumentsByIDs(ctx, []int64{documentID}, true)
	if err != nil {
		return InboundDocument{}, err
	}
	if len(documents) == 0 {
		return InboundDocument{}, ErrNotFound
	}
	return documents[0], nil
}

func (s *Store) listInboundDocumentsByIDs(ctx context.Context, documentIDs []int64, includeArchived bool) ([]InboundDocument, error) {
	if len(documentIDs) == 0 {
		return []InboundDocument{}, nil
	}

	archiveFilter := "AND d.archived_at IS NULL"
	if includeArchived {
		archiveFilter = ""
	}

	query, args, err := sqlx.In(fmt.Sprintf(`
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
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM inbound_documents d
		JOIN customers c ON c.id = d.customer_id
		JOIN storage_locations l ON l.id = d.location_id
		WHERE d.id IN (?)
		%s
		ORDER BY COALESCE(d.delivery_date, d.created_at) DESC, d.id DESC
	`, archiveFilter), documentIDs)
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
			Status:         normalizeDocumentStatus(row.Status),
			TrackingStatus: normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:    row.ConfirmedAt,
			CancelNote:     row.CancelNote,
			CancelledAt:    row.CancelledAt,
			ArchivedAt:     row.ArchivedAt,
			CreatedAt:      row.CreatedAt,
			UpdatedAt:      row.UpdatedAt,
			Lines:          make([]InboundDocumentLine, 0),
		}
		documents = append(documents, document)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			document_id,
			COALESCE(movement_id, 0) AS movement_id,
			COALESCE(item_id, 0) AS item_id,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			reorder_level,
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
			ReorderLevel:      lineRow.ReorderLevel,
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
	normalizedSection := fallbackSection(firstNonEmpty(line.StorageSection, documentInput.StorageSection))
	normalizedContainerNo := strings.TrimSpace(documentInput.ContainerNo)
	var itemID int64
	var description string
	matchByContainerQuery := `
		SELECT id, COALESCE(description, name, '')
		FROM inventory_items
		WHERE
			sku = ?
			AND customer_id = ?
			AND location_id = ?
			AND COALESCE(NULLIF(storage_section, ''), ?) = ?
			AND COALESCE(container_no, '') = ?
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
		FOR UPDATE
	`
	matchByContainerArgs := []any{
		line.SKU,
		documentInput.CustomerID,
		documentInput.LocationID,
		DefaultStorageSection,
		normalizedSection,
		normalizedContainerNo,
	}
	err := tx.QueryRowContext(ctx, matchByContainerQuery, matchByContainerArgs...).Scan(&itemID, &description)
	if err == nil {
		if strings.TrimSpace(description) == "" {
			description = line.Description
		}
		return itemID, description, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		matchPlaceholderQuery := `
			SELECT id, COALESCE(description, name, '')
			FROM inventory_items
			WHERE
				sku = ?
				AND customer_id = ?
				AND location_id = ?
				AND COALESCE(NULLIF(storage_section, ''), ?) = ?
				AND quantity = 0
				AND COALESCE(container_no, '') = ''
			ORDER BY updated_at DESC, id DESC
			LIMIT 1
			FOR UPDATE
		`
		matchPlaceholderArgs := []any{
			line.SKU,
			documentInput.CustomerID,
			documentInput.LocationID,
			DefaultStorageSection,
			normalizedSection,
		}
		err = tx.QueryRowContext(ctx, matchPlaceholderQuery, matchPlaceholderArgs...).Scan(&itemID, &description)
		if err == nil {
			if _, updateErr := tx.ExecContext(ctx, `
				UPDATE inventory_items
				SET
					storage_section = ?,
					container_no = ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, normalizedSection, normalizedContainerNo, itemID); updateErr != nil {
				return 0, "", mapDBError(fmt.Errorf("prepare inbound placeholder inventory row: %w", updateErr))
			}
			if strings.TrimSpace(description) == "" {
				description = line.Description
			}
			return itemID, description, nil
		}
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
			height_in,
			out_date,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
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
		itemInput.ContainerNo,
		itemInput.ExpectedQty,
		itemInput.ReceivedQty,
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
	input.Status = strings.TrimSpace(strings.ToUpper(input.Status))
	input.TrackingStatus = strings.TrimSpace(strings.ToUpper(input.TrackingStatus))
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
	coalescedStatus := coalesceDocumentStatus(input.Status)
	if err := validateCreatableDocumentStatus(coalescedStatus); err != nil {
		return err
	}
	if normalizedTracking := normalizeInboundTrackingStatus(input.TrackingStatus, coalescedStatus); normalizedTracking == "" {
		return fmt.Errorf("%w: invalid inbound tracking status", ErrInvalidInput)
	}
	if coalescedStatus == DocumentStatusConfirmed && normalizeInboundTrackingStatus(input.TrackingStatus, coalescedStatus) != InboundTrackingReceived {
		return fmt.Errorf("%w: confirmed receipts must use the received tracking status", ErrInvalidInput)
	}
	if err := validateInboundTrackingTransition(InboundTrackingScheduled, normalizeInboundTrackingStatus(input.TrackingStatus, coalescedStatus)); err != nil {
		return err
	}

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

func (line inboundDocumentLineRow) receivedOrExpectedQty() int {
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
