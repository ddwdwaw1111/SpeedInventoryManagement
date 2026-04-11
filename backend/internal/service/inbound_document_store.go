package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type InboundDocument struct {
	ID                  int64                 `json:"id"`
	CustomerID          int64                 `json:"customerId"`
	CustomerName        string                `json:"customerName"`
	LocationID          int64                 `json:"locationId"`
	LocationName        string                `json:"locationName"`
	ExpectedArrivalDate *time.Time            `json:"expectedArrivalDate"`
	ActualArrivalDate   *time.Time            `json:"actualArrivalDate"`
	ContainerNo         string                `json:"containerNo"`
	HandlingMode        string                `json:"handlingMode"`
	StorageSection      string                `json:"storageSection"`
	UnitLabel           string                `json:"unitLabel"`
	DocumentNote        string                `json:"documentNote"`
	Status              string                `json:"status"`
	TrackingStatus      string                `json:"trackingStatus"`
	ConfirmedAt         *time.Time            `json:"confirmedAt"`
	DeleteNote          string                `json:"deleteNote"`
	DeletedAt           *time.Time            `json:"deletedAt"`
	ArchivedAt          *time.Time            `json:"archivedAt"`
	TotalLines          int                   `json:"totalLines"`
	TotalExpectedQty    int                   `json:"totalExpectedQty"`
	TotalReceivedQty    int                   `json:"totalReceivedQty"`
	CreatedAt           time.Time             `json:"createdAt"`
	UpdatedAt           time.Time             `json:"updatedAt"`
	Lines               []InboundDocumentLine `json:"lines"`
}

type InboundDocumentLine struct {
	ID                int64                    `json:"id"`
	DocumentID        int64                    `json:"documentId"`
	SKU               string                   `json:"sku"`
	Description       string                   `json:"description"`
	StorageSection    string                   `json:"storageSection"`
	ReorderLevel      int                      `json:"reorderLevel"`
	ExpectedQty       int                      `json:"expectedQty"`
	ReceivedQty       int                      `json:"receivedQty"`
	Pallets           int                      `json:"pallets"`
	UnitsPerPallet    int                      `json:"unitsPerPallet"`
	PalletsDetailCtns string                   `json:"palletsDetailCtns"`
	PalletBreakdown   []InboundPalletBreakdown `json:"palletBreakdown"`
	UnitLabel         string                   `json:"unitLabel"`
	LineNote          string                   `json:"lineNote"`
	CreatedAt         time.Time                `json:"createdAt"`
}

type InboundPalletBreakdown struct {
	Quantity int `json:"quantity"`
}

type CreateInboundDocumentInput struct {
	CustomerID          int64                            `json:"customerId"`
	LocationID          int64                            `json:"locationId"`
	ExpectedArrivalDate string                           `json:"expectedArrivalDate"`
	ActualArrivalDate   string                           `json:"actualArrivalDate"`
	ContainerNo         string                           `json:"containerNo"`
	HandlingMode        string                           `json:"handlingMode"`
	StorageSection      string                           `json:"storageSection"`
	UnitLabel           string                           `json:"unitLabel"`
	Status              string                           `json:"status"`
	TrackingStatus      string                           `json:"trackingStatus"`
	DocumentNote        string                           `json:"documentNote"`
	Lines               []CreateInboundDocumentLineInput `json:"lines"`
}

type UpdateInboundDocumentNoteInput struct {
	DocumentNote string `json:"documentNote"`
}

type CreateInboundDocumentLineInput struct {
	SKU               string                   `json:"sku"`
	Description       string                   `json:"description"`
	ReorderLevel      int                      `json:"reorderLevel"`
	ExpectedQty       int                      `json:"expectedQty"`
	ReceivedQty       int                      `json:"receivedQty"`
	Pallets           int                      `json:"pallets"`
	UnitsPerPallet    int                      `json:"unitsPerPallet"`
	PalletsDetailCtns string                   `json:"palletsDetailCtns"`
	PalletBreakdown   []InboundPalletBreakdown `json:"palletBreakdown"`
	StorageSection    string                   `json:"storageSection"`
	LineNote          string                   `json:"lineNote"`
}

type inboundDocumentRow struct {
	ID                  int64      `db:"id"`
	CustomerID          int64      `db:"customer_id"`
	CustomerName        string     `db:"customer_name"`
	LocationID          int64      `db:"location_id"`
	LocationName        string     `db:"location_name"`
	ExpectedArrivalDate *time.Time `db:"expected_arrival_date"`
	ActualArrivalDate   *time.Time `db:"actual_arrival_date"`
	ContainerNo         string     `db:"container_no"`
	HandlingMode        string     `db:"handling_mode"`
	StorageSection      string     `db:"storage_section"`
	UnitLabel           string     `db:"unit_label"`
	DocumentNote        string     `db:"document_note"`
	Status              string     `db:"status"`
	TrackingStatus      string     `db:"tracking_status"`
	ConfirmedAt         *time.Time `db:"confirmed_at"`
	DeleteNote          string     `db:"cancel_note"`
	DeletedAt           *time.Time `db:"cancelled_at"`
	ArchivedAt          *time.Time `db:"archived_at"`
	CreatedAt           time.Time  `db:"created_at"`
	UpdatedAt           time.Time  `db:"updated_at"`
}

type inboundDocumentLineRow struct {
	ID                  int64     `db:"id"`
	DocumentID          int64     `db:"document_id"`
	SKUSnapshot         string    `db:"sku_snapshot"`
	DescriptionSnapshot string    `db:"description_snapshot"`
	StorageSection      string    `db:"storage_section"`
	ReorderLevel        int       `db:"reorder_level"`
	ExpectedQty         int       `db:"expected_qty"`
	ReceivedQty         int       `db:"received_qty"`
	Pallets             int       `db:"pallets"`
	UnitsPerPallet      int       `db:"units_per_pallet"`
	PalletsDetailCtns   string    `db:"pallets_detail_ctns"`
	PalletBreakdownJSON string    `db:"pallet_breakdown_json"`
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
			d.expected_arrival_date,
			d.actual_arrival_date,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.handling_mode, '') AS handling_mode,
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
		ORDER BY COALESCE(d.expected_arrival_date, d.created_at) DESC, d.id DESC
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
			ID:                  row.ID,
			CustomerID:          row.CustomerID,
			CustomerName:        row.CustomerName,
			LocationID:          row.LocationID,
			LocationName:        row.LocationName,
			ExpectedArrivalDate: row.ExpectedArrivalDate,
			ActualArrivalDate:   row.ActualArrivalDate,
			ContainerNo:         row.ContainerNo,
			HandlingMode:        coalesceInboundHandlingMode(row.HandlingMode),
			StorageSection:      fallbackSection(row.StorageSection),
			UnitLabel:           row.UnitLabel,
			DocumentNote:        row.DocumentNote,
			Status:              normalizeDocumentStatus(row.Status),
			TrackingStatus:      normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:         row.ConfirmedAt,
			DeleteNote:          row.DeleteNote,
			DeletedAt:           row.DeletedAt,
			ArchivedAt:          row.ArchivedAt,
			CreatedAt:           row.CreatedAt,
			UpdatedAt:           row.UpdatedAt,
			Lines:               make([]InboundDocumentLine, 0),
		}
		documents = append(documents, document)
		documentIDs = append(documentIDs, row.ID)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			document_id,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			reorder_level,
			expected_qty,
			received_qty,
			pallets,
			units_per_pallet,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(pallet_breakdown_json, '') AS pallet_breakdown_json,
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
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			StorageSection:    fallbackSection(lineRow.StorageSection),
			ReorderLevel:      lineRow.ReorderLevel,
			ExpectedQty:       lineRow.ExpectedQty,
			ReceivedQty:       lineRow.ReceivedQty,
			Pallets:           lineRow.Pallets,
			UnitsPerPallet:    lineRow.UnitsPerPallet,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			PalletBreakdown:   decodeInboundPalletBreakdownOrEmpty(lineRow.PalletBreakdownJSON),
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

	expectedArrivalDate, err := parseOptionalDate(input.ExpectedArrivalDate)
	if err != nil {
		return InboundDocument{}, err
	}
	actualArrivalDate, err := parseOptionalDate(input.ActualArrivalDate)
	if err != nil {
		return InboundDocument{}, err
	}
	if expectedArrivalDate == nil {
		now := time.Now().UTC()
		expectedArrivalDate = &now
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
			expected_arrival_date,
			actual_arrival_date,
			container_no,
			handling_mode,
			storage_section,
			unit_label,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at,
			cancel_note,
			cancelled_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
	`,
		input.CustomerID,
		input.LocationID,
		nullableTime(expectedArrivalDate),
		nullableTime(actualArrivalDate),
		nullableString(input.ContainerNo),
		coalesceInboundHandlingMode(input.HandlingMode),
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
				sku_snapshot,
				description_snapshot,
				storage_section,
				reorder_level,
				expected_qty,
				received_qty,
				pallets,
				units_per_pallet,
				pallets_detail_ctns,
				pallet_breakdown_json,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			line.SKU,
			nullableString(line.Description),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			line.ReorderLevel,
			line.ExpectedQty,
			line.ReceivedQty,
			line.Pallets,
			line.UnitsPerPallet,
			nullableString(line.PalletsDetailCtns),
			nullableString(mustEncodeInboundPalletBreakdown(line.PalletBreakdown)),
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

	expectedArrivalDate, err := parseOptionalDate(input.ExpectedArrivalDate)
	if err != nil {
		return InboundDocument{}, err
	}
	actualArrivalDate, err := parseOptionalDate(input.ActualArrivalDate)
	if err != nil {
		return InboundDocument{}, err
	}
	if expectedArrivalDate == nil {
		now := time.Now().UTC()
		expectedArrivalDate = &now
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
	normalizedDocumentStatus := normalizeDocumentStatus(documentRow.Status)
	if normalizedDocumentStatus == DocumentStatusConfirmed {
		return InboundDocument{}, fmt.Errorf("%w: confirmed receipts are immutable; cancel the receipt or copy it into a new draft and record any net change through correction documents", ErrInvalidInput)
	}
	if normalizedDocumentStatus != DocumentStatusDraft {
		return InboundDocument{}, fmt.Errorf("%w: only draft receipts can be edited", ErrInvalidInput)
	}
	if err := s.updateDraftInboundDocumentTx(ctx, tx, documentID, documentRow, input, expectedArrivalDate, actualArrivalDate, requestedStatus, requestedTrackingStatus); err != nil {
		return InboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound update: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) UpdateInboundDocumentNote(ctx context.Context, documentID int64, input UpdateInboundDocumentNoteInput) (InboundDocument, error) {
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound note update transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID); err != nil {
		return InboundDocument{}, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			document_note = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableString(input.DocumentNote),
		documentID,
	); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("update inbound document note: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound note update: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) updateDraftInboundDocumentTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	input CreateInboundDocumentInput,
	expectedArrivalDate *time.Time,
	actualArrivalDate *time.Time,
	requestedStatus string,
	requestedTrackingStatus string,
) error {
	normalizedDocumentStatus := normalizeDocumentStatus(documentRow.Status)
	if normalizedDocumentStatus == DocumentStatusConfirmed {
		return fmt.Errorf("%w: confirmed receipts are immutable; cancel the receipt or copy it into a new draft and record any net change through correction documents", ErrInvalidInput)
	}
	if normalizedDocumentStatus != DocumentStatusDraft {
		return fmt.Errorf("%w: only draft receipts can be edited", ErrInvalidInput)
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
			expected_arrival_date = ?,
			actual_arrival_date = ?,
			container_no = ?,
			handling_mode = ?,
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
		nullableTime(expectedArrivalDate),
		nullableTime(actualArrivalDate),
		nullableString(input.ContainerNo),
		coalesceInboundHandlingMode(input.HandlingMode),
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
				sku_snapshot,
				description_snapshot,
				storage_section,
				reorder_level,
				expected_qty,
				received_qty,
				pallets,
				units_per_pallet,
				pallets_detail_ctns,
				pallet_breakdown_json,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			line.SKU,
			nullableString(line.Description),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
			line.ReorderLevel,
			line.ExpectedQty,
			line.ReceivedQty,
			line.Pallets,
			line.UnitsPerPallet,
			nullableString(line.PalletsDetailCtns),
			nullableString(mustEncodeInboundPalletBreakdown(line.PalletBreakdown)),
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
	if coalesceInboundHandlingMode(input.HandlingMode) != InboundHandlingModePalletized {
		return fmt.Errorf("%w: confirmed receipt handling mode must remain palletized", ErrInvalidInput)
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

		oldQty := existingLine.receivedOrExpectedQty()
		newQty := nextLine.receivedOrExpectedQty()
		oldSection := fallbackSection(existingLine.StorageSection)
		newSection := fallbackSection(firstNonEmpty(nextLine.StorageSection, input.StorageSection, existingLine.StorageSection))
		positionChanged := oldSection != newSection || oldContainerNo != newContainerNo
		lineDescription := firstNonEmpty(nextLine.Description, existingLine.DescriptionSnapshot)
		unitLabel := firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, existingLine.UnitLabel, "CTN")

		if newQty < oldQty {
			if err := s.reduceConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, newSection, newContainerNo, oldQty-newQty, lineDescription, unitLabel); err != nil {
				return err
			}
		}

		if positionChanged {
			if err := s.moveConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, newSection, newContainerNo, lineDescription, unitLabel); err != nil {
				return err
			}
		}

		if newQty > oldQty {
			if err := s.increaseConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, newSection, newContainerNo, newQty-oldQty, lineDescription, unitLabel); err != nil {
				return err
			}
		}

		nextPalletBreakdownJSON := existingLine.PalletBreakdownJSON
		if len(nextLine.PalletBreakdown) > 0 {
			nextPalletBreakdownJSON = mustEncodeInboundPalletBreakdown(nextLine.PalletBreakdown)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_document_lines
			SET
				description_snapshot = ?,
				storage_section = ?,
				reorder_level = ?,
				expected_qty = ?,
				received_qty = ?,
				pallets = ?,
				units_per_pallet = ?,
				pallets_detail_ctns = ?,
				pallet_breakdown_json = ?,
				unit_label = ?,
				line_note = ?
			WHERE id = ?
		`,
			nullableString(firstNonEmpty(nextLine.Description, existingLine.DescriptionSnapshot)),
			newSection,
			nextLine.ReorderLevel,
			nextLine.ExpectedQty,
			nextLine.ReceivedQty,
			nextLine.Pallets,
			nextLine.UnitsPerPallet,
			nullableString(nextLine.PalletsDetailCtns),
			nullableString(nextPalletBreakdownJSON),
			nullableString(firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, existingLine.UnitLabel, "CTN")),
			nullableString(nextLine.LineNote),
			existingLine.ID,
		); err != nil {
			return mapDBError(fmt.Errorf("update confirmed inbound line: %w", err))
		}

		if err := s.syncConfirmedInboundOpenPalletItemsTx(ctx, tx, existingLine.ID, deliveryDate, nextLine.ReorderLevel, lineDescription, unitLabel); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			expected_arrival_date = ?,
			container_no = ?,
			handling_mode = ?,
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
		InboundHandlingModePalletized,
		newDocumentSection,
		nullableString(firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, "CTN")),
		nullableString(input.DocumentNote),
		DocumentStatusConfirmed,
		InboundTrackingReceived,
		documentID,
	); err != nil {
		return mapDBError(fmt.Errorf("update confirmed inbound document: %w", err))
	}
	if strings.TrimSpace(oldContainerNo) != "" || strings.TrimSpace(newContainerNo) != "" {
		visitID, err := ensureContainerVisitForInboundDocumentTx(ctx, tx, inboundDocumentRow{
			ID:                  documentID,
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			ExpectedArrivalDate: deliveryDate,
			ContainerNo:         firstNonEmpty(newContainerNo, oldContainerNo),
			HandlingMode:        InboundHandlingModePalletized,
			ConfirmedAt:         documentRow.ConfirmedAt,
		})
		if err != nil {
			return err
		}
		if visitID > 0 {
			if _, err := tx.ExecContext(ctx, `
				UPDATE container_visits
				SET
					customer_id = ?,
					location_id = ?,
					container_no = ?,
					arrival_date = ?,
					handling_mode = ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`,
				documentRow.CustomerID,
				documentRow.LocationID,
				nullableString(newContainerNo),
				nullableTime(deliveryDate),
				InboundHandlingModePalletized,
				visitID,
			); err != nil {
				return mapDBError(fmt.Errorf("sync container visit after confirmed inbound update: %w", err))
			}
		}
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

type inboundLinePalletState struct {
	PalletID                int64
	PalletItemID            int64
	SKUMasterID             int64
	Quantity                int
	AllocatedQty            int
	DamagedQty              int
	HoldQty                 int
	CustomerID              int64
	LocationID              int64
	StorageSection          string
	ContainerNo             string
	ContainerVisitID        int64
	SourceInboundDocumentID int64
	SourceInboundLineID     int64
	ActualArrivalDate       *time.Time
}

func (s *Store) loadLockedInboundEditableItemTx(ctx context.Context, tx *sql.Tx, itemID int64) (inboundEditableItem, error) {
	projection, err := s.loadPalletBackedInventoryProjectionTx(ctx, tx, itemID)
	if err != nil {
		return inboundEditableItem{}, err
	}
	return inboundEditableItem{
		ID:             projection.ItemID,
		SKUMasterID:    projection.SKUMasterID,
		CustomerID:     projection.CustomerID,
		LocationID:     projection.LocationID,
		StorageSection: projection.StorageSection,
		ContainerNo:    projection.ContainerNo,
		SKU:            projection.SKU,
		Name:           projection.Name,
		Category:       projection.Category,
		Description:    projection.Description,
		Unit:           projection.Unit,
		ReorderLevel:   projection.ReorderLevel,
		Quantity:       projection.Quantity,
	}, nil
}

func (s *Store) updateInboundEditableItemStateTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	storageSection string,
	containerNo string,
	deliveryDate *time.Time,
	reorderLevel int,
	description string,
	unitLabel string,
) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			storage_section = ?,
			container_no = ?,
			delivery_date = ?,
			last_restocked_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		fallbackSection(storageSection),
		nullableString(containerNo),
		nullableTime(deliveryDate),
		itemID,
	); err != nil {
		return mapDBError(fmt.Errorf("update inbound inventory state: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE sku_master sm
		JOIN inventory_items i ON i.sku_master_id = sm.id
		SET
			sm.reorder_level = ?,
			sm.description = CASE
				WHEN ? <> '' THEN ?
				ELSE sm.description
			END,
			sm.unit = CASE
				WHEN ? <> '' THEN LOWER(?)
				ELSE sm.unit
			END,
			sm.updated_at = CURRENT_TIMESTAMP
		WHERE i.id = ?
	`,
		reorderLevel,
		strings.TrimSpace(description),
		nullableString(strings.TrimSpace(description)),
		strings.TrimSpace(unitLabel),
		nullableString(strings.TrimSpace(unitLabel)),
		itemID,
	); err != nil {
		return mapDBError(fmt.Errorf("sync inbound sku metadata: %w", err))
	}
	return nil
}

func (s *Store) listActiveInboundLinePalletStatesTx(ctx context.Context, tx *sql.Tx, inboundLineID int64, newestFirst bool) ([]inboundLinePalletState, error) {
	orderDirection := "ASC"
	if newestFirst {
		orderDirection = "DESC"
	}
	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`
		SELECT
			p.id,
			pi.id,
			pi.sku_master_id,
			pi.quantity,
			pi.allocated_qty,
			pi.damaged_qty,
			pi.hold_qty,
			p.customer_id,
			p.current_location_id,
			COALESCE(p.current_storage_section, 'TEMP') AS current_storage_section,
			COALESCE(p.current_container_no, '') AS current_container_no,
			COALESCE(p.container_visit_id, 0) AS container_visit_id,
			COALESCE(p.source_inbound_document_id, 0) AS source_inbound_document_id,
			COALESCE(p.source_inbound_line_id, 0) AS source_inbound_line_id,
			p.actual_arrival_date
		FROM pallets p
		JOIN pallet_items pi
			ON pi.pallet_id = p.id
			AND pi.sku_master_id = p.sku_master_id
		WHERE p.source_inbound_line_id = ?
		  AND pi.quantity > 0
		  AND p.status <> ?
		ORDER BY COALESCE(p.actual_arrival_date, DATE(p.created_at)) %s, p.created_at %s, p.id %s
		FOR UPDATE
	`, orderDirection, orderDirection, orderDirection), inboundLineID, PalletStatusCancelled)
	if err != nil {
		return nil, fmt.Errorf("load active inbound-line pallets: %w", err)
	}
	defer rows.Close()

	states := make([]inboundLinePalletState, 0)
	for rows.Next() {
		var state inboundLinePalletState
		if err := rows.Scan(
			&state.PalletID,
			&state.PalletItemID,
			&state.SKUMasterID,
			&state.Quantity,
			&state.AllocatedQty,
			&state.DamagedQty,
			&state.HoldQty,
			&state.CustomerID,
			&state.LocationID,
			&state.StorageSection,
			&state.ContainerNo,
			&state.ContainerVisitID,
			&state.SourceInboundDocumentID,
			&state.SourceInboundLineID,
			&state.ActualArrivalDate,
		); err != nil {
			return nil, fmt.Errorf("scan active inbound-line pallet: %w", err)
		}
		state.StorageSection = fallbackSection(state.StorageSection)
		state.ContainerNo = strings.TrimSpace(state.ContainerNo)
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active inbound-line pallets: %w", err)
	}
	return states, nil
}

func (s *Store) syncConfirmedInboundOpenPalletItemsTx(
	ctx context.Context,
	tx *sql.Tx,
	inboundLineID int64,
	deliveryDate *time.Time,
	reorderLevel int,
	description string,
	unitLabel string,
) error {
	activePallets, err := s.listActiveInboundLinePalletStatesTx(ctx, tx, inboundLineID, false)
	if err != nil {
		return err
	}

	seenItemIDs := make(map[int64]struct{}, len(activePallets))
	for _, palletState := range activePallets {
		if palletState.SKUMasterID <= 0 {
			continue
		}
		itemID, err := s.findInventoryItemIDByProjectionTx(
			ctx,
			tx,
			palletState.SKUMasterID,
			palletState.CustomerID,
			palletState.LocationID,
			palletState.StorageSection,
			palletState.ContainerNo,
		)
		if err != nil {
			return err
		}
		if _, exists := seenItemIDs[itemID]; exists {
			continue
		}
		if err := s.updateInboundEditableItemStateTx(
			ctx,
			tx,
			itemID,
			palletState.StorageSection,
			palletState.ContainerNo,
			deliveryDate,
			reorderLevel,
			description,
			unitLabel,
		); err != nil {
			return err
		}

		seenItemIDs[itemID] = struct{}{}
	}

	return nil
}

func (s *Store) reduceConfirmedInboundReceiptLotsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	targetSection string,
	targetContainerNo string,
	reductionQty int,
	lineDescription string,
	unitLabel string,
) error {
	if reductionQty <= 0 {
		return nil
	}

	activePallets, err := s.listActiveInboundLinePalletStatesTx(ctx, tx, existingLine.ID, true)
	if err != nil {
		return err
	}

	remainingOpenQty := 0
	for _, palletState := range activePallets {
		remainingOpenQty += palletState.Quantity
	}
	if reductionQty > remainingOpenQty {
		return fmt.Errorf("%w: receipt line %s cannot reduce below quantity already consumed", ErrInvalidInput, existingLine.SKUSnapshot)
	}
	if len(activePallets) == 0 {
		return nil
	}

	reductionPallets := 0.0
	if nextLine.Pallets < existingLine.Pallets {
		reductionPallets = float64(existingLine.Pallets - nextLine.Pallets)
	}

	palletConsumptions, err := s.consumePalletContentsForInboundLineTx(ctx, tx, existingLine.ID, activePallets[0].SKUMasterID, reductionQty, true)
	if err != nil {
		return err
	}
	if len(palletConsumptions) == 0 {
		return ErrInsufficientStock
	}

	consumptionQuantities := make([]int, len(palletConsumptions))
	for index, palletConsumption := range palletConsumptions {
		consumptionQuantities[index] = palletConsumption.Quantity
	}
	palletSplits := splitPalletsByQuantities(reductionPallets, consumptionQuantities)

	for index, palletConsumption := range palletConsumptions {
		if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
			PalletID:         palletConsumption.PalletID,
			ContainerVisitID: palletConsumption.ContainerVisitID,
			CustomerID:       palletConsumption.CustomerID,
			LocationID:       palletConsumption.LocationID,
			StorageSection:   targetSection,
			ContainerNo:      targetContainerNo,
			EventType:        PalletEventAdjust,
			QuantityDelta:    -palletConsumption.Quantity,
			PalletDelta:      -palletSplits[index],
		}); err != nil {
			return err
		}
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventAdjust,
			PalletID:            palletConsumption.PalletID,
			PalletItemID:        palletConsumption.PalletItemID,
			SKUMasterID:         palletConsumption.SKUMasterID,
			CustomerID:          palletConsumption.CustomerID,
			LocationID:          palletConsumption.LocationID,
			StorageSection:      targetSection,
			QuantityChange:      -palletConsumption.Quantity,
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentID,
			SourceLineID:        existingLine.ID,
			ContainerNo:         targetContainerNo,
			DescriptionSnapshot: lineDescription,
			Reason:              fmt.Sprintf("Receipt correction: quantity updated from %d to %d", existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty()),
		}); err != nil {
			return err
		}
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
) error {
	activePallets, err := s.listActiveInboundLinePalletStatesTx(ctx, tx, existingLine.ID, false)
	if err != nil {
		return err
	}
	if len(activePallets) == 0 {
		return nil
	}

	_, _, err = s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		ExpectedArrivalDate: safeDateInput(deliveryDate),
		ContainerNo:         targetContainerNo,
		StorageSection:      targetSection,
		UnitLabel:           unitLabel,
		DocumentNote:        documentRow.DocumentNote,
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
		return err
	}

	palletSplitSequence := 0

	for _, palletState := range activePallets {
		if palletState.Quantity <= 0 {
			continue
		}
		if fallbackSection(palletState.StorageSection) == fallbackSection(targetSection) && strings.TrimSpace(palletState.ContainerNo) == strings.TrimSpace(targetContainerNo) {
			continue
		}

		transferReason := fmt.Sprintf(
			"Receipt correction: moved from %s/%s to %s/%s",
			fallbackSection(palletState.StorageSection),
			firstNonEmpty(palletState.ContainerNo, "-"),
			fallbackSection(targetSection),
			firstNonEmpty(targetContainerNo, "-"),
		)
		if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
			PalletID:         palletState.PalletID,
			ContainerVisitID: palletState.ContainerVisitID,
			CustomerID:       palletState.CustomerID,
			LocationID:       palletState.LocationID,
			StorageSection:   targetSection,
			ContainerNo:      targetContainerNo,
			EventType:        PalletEventTransferOut,
			QuantityDelta:    -palletState.Quantity,
			PalletDelta:      -1,
		}); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE pallet_items
			SET quantity = 0, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, palletState.PalletItemID); err != nil {
			return mapDBError(fmt.Errorf("move inbound pallet quantity: %w", err))
		}
		if err := s.updatePalletStatusFromContentsTx(ctx, tx, palletState.PalletID); err != nil {
			return err
		}

		stockLedgerID, err := s.createStockLedgerEntryTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventTransferOut,
			PalletID:            palletState.PalletID,
			PalletItemID:        palletState.PalletItemID,
			SKUMasterID:         palletState.SKUMasterID,
			CustomerID:          palletState.CustomerID,
			LocationID:          palletState.LocationID,
			StorageSection:      targetSection,
			QuantityChange:      -palletState.Quantity,
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentID,
			SourceLineID:        existingLine.ID,
			ContainerNo:         targetContainerNo,
			DescriptionSnapshot: lineDescription,
			Reason:              transferReason,
		})
		if err != nil {
			return err
		}

		palletSplitSequence++
		childPallet, err := s.createPalletTx(ctx, tx, createPalletInput{
			ParentPalletID:          palletState.PalletID,
			PalletCode:              palletCodeForTransferSplit(palletState.PalletID, stockLedgerID, palletSplitSequence),
			ContainerVisitID:        palletState.ContainerVisitID,
			SourceInboundDocumentID: palletState.SourceInboundDocumentID,
			SourceInboundLineID:     palletState.SourceInboundLineID,
			ActualArrivalDate:       palletState.ActualArrivalDate,
			CustomerID:              documentRow.CustomerID,
			SKUMasterID:             palletState.SKUMasterID,
			CurrentLocationID:       documentRow.LocationID,
			CurrentStorageSection:   targetSection,
			CurrentContainerNo:      targetContainerNo,
			Status:                  PalletStatusOpen,
		})
		if err != nil {
			return err
		}
		childPalletItemID, err := s.createPalletItemTx(ctx, tx, createPalletItemInput{
			PalletID:    childPallet.ID,
			SKUMasterID: palletState.SKUMasterID,
			Quantity:    palletState.Quantity,
		})
		if err != nil {
			return err
		}
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventTransferIn,
			PalletID:            childPallet.ID,
			PalletItemID:        childPalletItemID,
			SKUMasterID:         palletState.SKUMasterID,
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			StorageSection:      targetSection,
			QuantityChange:      palletState.Quantity,
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentID,
			SourceLineID:        existingLine.ID,
			ContainerNo:         targetContainerNo,
			DescriptionSnapshot: lineDescription,
			Reason:              transferReason,
		}); err != nil {
			return err
		}
		if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
			PalletID:         childPallet.ID,
			ContainerVisitID: childPallet.ContainerVisitID,
			CustomerID:       documentRow.CustomerID,
			LocationID:       documentRow.LocationID,
			StorageSection:   targetSection,
			ContainerNo:      targetContainerNo,
			EventType:        PalletEventTransferIn,
			QuantityDelta:    palletState.Quantity,
			PalletDelta:      1,
		}); err != nil {
			return err
		}
	}

	return nil
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
) error {
	if increaseQty <= 0 {
		return nil
	}

	targetItemID, _, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		ExpectedArrivalDate: safeDateInput(deliveryDate),
		ContainerNo:         targetContainerNo,
		StorageSection:      targetSection,
		UnitLabel:           unitLabel,
		DocumentNote:        documentRow.DocumentNote,
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
		return err
	}

	targetItem, err := s.loadLockedInboundEditableItemTx(ctx, tx, targetItemID)
	if err != nil {
		return err
	}

	containerVisitID := int64(0)
	activePallets, err := s.listActiveInboundLinePalletStatesTx(ctx, tx, existingLine.ID, false)
	if err != nil {
		return err
	}
	for _, palletState := range activePallets {
		if palletState.ContainerVisitID > 0 {
			containerVisitID = palletState.ContainerVisitID
			break
		}
	}
	if containerVisitID == 0 {
		containerVisitID, err = ensureContainerVisitForInboundDocumentTx(ctx, tx, documentRow)
		if err != nil {
			return err
		}
	}

	increasePallets := 0.0
	if nextLine.Pallets > existingLine.Pallets {
		increasePallets = float64(nextLine.Pallets - existingLine.Pallets)
	}
	palletCount := roundedPalletInt(increasePallets)
	if palletCount <= 0 {
		palletCount = 1
	}
	createdPallets, err := s.createPalletsForInboundLineTx(ctx, tx, documentID, existingLine.ID, containerVisitID, targetItem.SKUMasterID, increaseQty, documentRow.CustomerID, documentRow.LocationID, targetSection, targetContainerNo, documentRow.ActualArrivalDate, nil, nextLine.UnitsPerPallet, palletCount)
	if err != nil {
		return err
	}
	createdQuantities := make([]int, len(createdPallets))
	for index, createdPallet := range createdPallets {
		createdQuantities[index] = createdPallet.Quantity
	}
	palletDeltaSplits := splitPalletsByQuantities(increasePallets, createdQuantities)
	for _, createdPallet := range createdPallets {
		stockLedgerID, err := s.createStockLedgerEntryTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventAdjust,
			PalletID:            createdPallet.Pallet.ID,
			PalletItemID:        createdPallet.PalletItemID,
			SKUMasterID:         createdPallet.Pallet.SKUMasterID,
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			StorageSection:      targetSection,
			QuantityChange:      createdPallet.Quantity,
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentID,
			SourceLineID:        existingLine.ID,
			DescriptionSnapshot: lineDescription,
			Reason:              fmt.Sprintf("Receipt correction: quantity updated from %d to %d", existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty()),
		})
		if err != nil {
			return err
		}
		_ = stockLedgerID
	}
	for index, createdPallet := range createdPallets {
		if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
			PalletID:         createdPallet.Pallet.ID,
			ContainerVisitID: createdPallet.Pallet.ContainerVisitID,
			CustomerID:       documentRow.CustomerID,
			LocationID:       documentRow.LocationID,
			StorageSection:   targetSection,
			ContainerNo:      targetContainerNo,
			EventType:        PalletEventAdjust,
			QuantityDelta:    createdPallet.Quantity,
			PalletDelta:      palletDeltaSplits[index],
		}); err != nil {
			return err
		}
	}

	return nil
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
	if status == DocumentStatusDeleted {
		return InboundDocument{}, fmt.Errorf("%w: deleted receipt cannot be confirmed", ErrInvalidInput)
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
	if documentStatus == DocumentStatusDeleted {
		return InboundDocument{}, fmt.Errorf("%w: deleted receipt cannot change tracking status", ErrInvalidInput)
	}

	currentTrackingStatus := normalizeInboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)
	targetTrackingStatus := normalizeInboundTrackingStatus(trackingStatus, documentRow.Status)
	if err := validateInboundTrackingTransition(currentTrackingStatus, targetTrackingStatus); err != nil {
		return InboundDocument{}, err
	}
	if coalesceInboundHandlingMode(documentRow.HandlingMode) == InboundHandlingModeSealedTransit && targetTrackingStatus == InboundTrackingReceived {
		return InboundDocument{}, fmt.Errorf("%w: sealed transit receipts must be converted to palletized before they can be received", ErrInvalidInput)
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
	if status == DocumentStatusDeleted {
		return fmt.Errorf("%w: deleted receipt cannot be confirmed", ErrInvalidInput)
	}
	if status == DocumentStatusConfirmed {
		return fmt.Errorf("%w: receipt is already confirmed", ErrInvalidInput)
	}
	if coalesceInboundHandlingMode(documentRow.HandlingMode) == InboundHandlingModeSealedTransit {
		return fmt.Errorf("%w: sealed transit receipts must be converted to palletized before confirmation", ErrInvalidInput)
	}

	lineRows, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return err
	}
	confirmedAt := time.Now().UTC()
	documentRow.ConfirmedAt = &confirmedAt
	containerVisitID, err := ensureContainerVisitForInboundDocumentTx(ctx, tx, documentRow)
	if err != nil {
		return err
	}

	for _, lineRow := range lineRows {
		itemID, itemDescription, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			ExpectedArrivalDate: safeDateInput(documentRow.ExpectedArrivalDate),
			ContainerNo:         documentRow.ContainerNo,
			StorageSection:      documentRow.StorageSection,
			UnitLabel:           documentRow.UnitLabel,
			DocumentNote:        documentRow.DocumentNote,
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
		}, documentRow.ExpectedArrivalDate)
		if err != nil {
			return err
		}
		skuMasterID, err := s.getItemSKUMasterID(ctx, tx, itemID)
		if err != nil {
			return err
		}

		receivedQty := lineRow.receivedOrExpectedQty()
		lotSection := fallbackSection(firstNonEmpty(lineRow.StorageSection, documentRow.StorageSection))
		lotContainer := documentRow.ContainerNo
		createdPallets, err := s.createPalletsForInboundLineTx(ctx, tx, documentID, lineRow.ID, containerVisitID, skuMasterID, receivedQty, documentRow.CustomerID, documentRow.LocationID, lotSection, lotContainer, documentRow.ActualArrivalDate, lineRow.palletBreakdown(), lineRow.UnitsPerPallet, lineRow.Pallets)
		if err != nil {
			return err
		}
		receiptEventTime := firstNonEmptyTime(documentRow.ActualArrivalDate, &confirmedAt)
		if receiptEventTime == nil {
			receiptEventTime = &confirmedAt
		}
		for _, createdPallet := range createdPallets {
			if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
				PalletID:         createdPallet.Pallet.ID,
				ContainerVisitID: containerVisitID,
				CustomerID:       documentRow.CustomerID,
				LocationID:       documentRow.LocationID,
				StorageSection:   lotSection,
				ContainerNo:      lotContainer,
				EventType:        PalletEventReceived,
				QuantityDelta:    createdPallet.Quantity,
				PalletDelta:      1,
				EventTime:        receiptEventTime,
			}); err != nil {
				return err
			}
			if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
				EventType:           StockLedgerEventReceive,
				PalletID:            createdPallet.Pallet.ID,
				PalletItemID:        createdPallet.PalletItemID,
				SKUMasterID:         createdPallet.Pallet.SKUMasterID,
				CustomerID:          documentRow.CustomerID,
				LocationID:          documentRow.LocationID,
				StorageSection:      lotSection,
				QuantityChange:      createdPallet.Quantity,
				SourceDocumentType:  StockLedgerSourceInbound,
				SourceDocumentID:    documentID,
				SourceLineID:        lineRow.ID,
				ContainerNo:         lotContainer,
				DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
				ItemNumber:          lineRow.SKUSnapshot,
				DescriptionSnapshot: itemDescription,
				ExpectedQty:         lineRow.ExpectedQty,
				ReceivedQty:         lineRow.ReceivedQty,
				Pallets:             lineRow.Pallets,
				PalletsDetailCtns:   lineRow.PalletsDetailCtns,
				UnitLabel:           firstNonEmpty(documentRow.UnitLabel, "CTN"),
				DocumentNote:        documentRow.DocumentNote,
				Reason:              firstNonEmpty(lineRow.LineNote, defaultMovementReason("IN")),
			}); err != nil {
				return err
			}
		}
	}

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

	if strings.TrimSpace(documentRow.ContainerNo) != "" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE container_visits
			SET
				customer_id = ?,
				location_id = ?,
				container_no = ?,
				arrival_date = ?,
				received_at = ?,
				handling_mode = ?,
				status = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE inbound_document_id = ?
		`,
			documentRow.CustomerID,
			documentRow.LocationID,
			nullableString(documentRow.ContainerNo),
			nullableTime(firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate)),
			nullableTime(&confirmedAt),
			InboundHandlingModePalletized,
			ContainerVisitStatusOpen,
			documentID,
		); err != nil {
			return mapDBError(fmt.Errorf("sync container visit after inbound confirmation: %w", err))
		}
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
	if status == DocumentStatusDeleted {
		return InboundDocument{}, fmt.Errorf("%w: inbound document is already deleted", ErrInvalidInput)
	}

	cancellationReason := firstNonEmpty(input.Reason, fmt.Sprintf("Reversal of inbound %s", firstNonEmpty(documentRow.ContainerNo, fmt.Sprintf("IN-%d", documentID))))
	deletedAt := time.Now().UTC()

	if status == DocumentStatusConfirmed {
		// Collect pallet IDs created by this inbound
		palletIDs, err := s.collectPalletIDsByInboundDocumentTx(ctx, tx, documentID)
		if err != nil {
			return InboundDocument{}, err
		}
		if len(palletIDs) > 0 {
			inClause, args := buildInClause(palletIDs)

			// Block delete if any pallet has been partially consumed by outbound picks
			var outboundPickCount int
			if err := tx.QueryRowContext(ctx, fmt.Sprintf(
				`SELECT COUNT(*) FROM outbound_picks WHERE pallet_id IN (%s)`, inClause), args...).Scan(&outboundPickCount); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("check outbound picks for inbound pallets: %w", err))
			}
			if outboundPickCount > 0 {
				return InboundDocument{}, fmt.Errorf("%w: receipt has pallets referenced by outbound shipments and cannot be deleted", ErrInvalidInput)
			}

			// Block delete if any pallet has child pallets (from transfers)
			var childPalletCount int
			if err := tx.QueryRowContext(ctx, fmt.Sprintf(
				`SELECT COUNT(*) FROM pallets WHERE parent_pallet_id IN (%s)`, inClause), args...).Scan(&childPalletCount); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("check child pallets for inbound pallets: %w", err))
			}
			if childPalletCount > 0 {
				return InboundDocument{}, fmt.Errorf("%w: receipt has pallets that were split by transfers and cannot be deleted", ErrInvalidInput)
			}

			// Block delete if any pallet item has allocated, damaged, or hold quantities
			var allocatedCount int
			if err := tx.QueryRowContext(ctx, fmt.Sprintf(
				`SELECT COUNT(*) FROM pallet_items WHERE pallet_id IN (%s) AND (allocated_qty > 0 OR damaged_qty > 0 OR hold_qty > 0)`, inClause), args...).Scan(&allocatedCount); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("check pallet item flags for inbound pallets: %w", err))
			}
			if allocatedCount > 0 {
				return InboundDocument{}, fmt.Errorf("%w: receipt has pallets with allocated, damaged, or held stock and cannot be deleted", ErrInvalidInput)
			}

			// Safe to delete — remove stock_ledger entries (no FK cascade to pallets)
			if _, err := tx.ExecContext(ctx, fmt.Sprintf(
				`DELETE FROM stock_ledger WHERE pallet_id IN (%s)`, inClause), args...); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("delete stock ledger for inbound pallets: %w", err))
			}
			// Delete pallets (cascades to pallet_items, pallet_location_events)
			if _, err := tx.ExecContext(ctx, fmt.Sprintf(
				`DELETE FROM pallets WHERE id IN (%s)`, inClause), args...); err != nil {
				return InboundDocument{}, mapDBError(fmt.Errorf("delete inbound pallets: %w", err))
			}
		}
	}

	// Delete inbound document (cascades to inbound_document_lines, container_visits)
	if _, err := tx.ExecContext(ctx, `DELETE FROM inbound_documents WHERE id = ?`, documentID); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("delete inbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound cancel: %w", err)
	}

	return InboundDocument{
		ID:          documentRow.ID,
		CustomerID:  documentRow.CustomerID,
		LocationID:  documentRow.LocationID,
		ContainerNo: documentRow.ContainerNo,
		Status:      DocumentStatusDeleted,
		DeleteNote:  cancellationReason,
		DeletedAt:   &deletedAt,
		CreatedAt:   documentRow.CreatedAt,
	}, nil
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
			expected_arrival_date,
			actual_arrival_date,
			container_no,
			handling_mode,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
	`,
		documentRow.CustomerID,
		documentRow.LocationID,
		nullableTime(documentRow.ExpectedArrivalDate),
		nullableTime(documentRow.ActualArrivalDate),
		nullableString(documentRow.ContainerNo),
		coalesceInboundHandlingMode(documentRow.HandlingMode),
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
				sku_snapshot,
				description_snapshot,
				storage_section,
				reorder_level,
				expected_qty,
				received_qty,
				pallets,
				units_per_pallet,
				pallets_detail_ctns,
				pallet_breakdown_json,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			newDocumentID,
			lineRow.SKUSnapshot,
			nullableString(lineRow.DescriptionSnapshot),
			fallbackSection(lineRow.StorageSection),
			lineRow.ReorderLevel,
			lineRow.ExpectedQty,
			lineRow.ReceivedQty,
			lineRow.Pallets,
			lineRow.UnitsPerPallet,
			nullableString(lineRow.PalletsDetailCtns),
			nullableString(lineRow.PalletBreakdownJSON),
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
			d.expected_arrival_date,
			d.actual_arrival_date,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.handling_mode, '') AS handling_mode,
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
		&documentRow.ExpectedArrivalDate,
		&documentRow.ActualArrivalDate,
		&documentRow.ContainerNo,
		&documentRow.HandlingMode,
		&documentRow.StorageSection,
		&documentRow.UnitLabel,
		&documentRow.DocumentNote,
		&documentRow.Status,
		&documentRow.TrackingStatus,
		&documentRow.ConfirmedAt,
		&documentRow.DeleteNote,
		&documentRow.DeletedAt,
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
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			reorder_level,
			expected_qty,
			received_qty,
			pallets,
			units_per_pallet,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(pallet_breakdown_json, '') AS pallet_breakdown_json,
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
			&lineRow.SKUSnapshot,
			&lineRow.DescriptionSnapshot,
			&lineRow.StorageSection,
			&lineRow.ReorderLevel,
			&lineRow.ExpectedQty,
			&lineRow.ReceivedQty,
			&lineRow.Pallets,
			&lineRow.UnitsPerPallet,
			&lineRow.PalletsDetailCtns,
			&lineRow.PalletBreakdownJSON,
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
			d.expected_arrival_date,
			d.actual_arrival_date,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.handling_mode, '') AS handling_mode,
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
		ORDER BY COALESCE(d.expected_arrival_date, d.created_at) DESC, d.id DESC
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
			ID:                  row.ID,
			CustomerID:          row.CustomerID,
			CustomerName:        row.CustomerName,
			LocationID:          row.LocationID,
			LocationName:        row.LocationName,
			ExpectedArrivalDate: row.ExpectedArrivalDate,
			ActualArrivalDate:   row.ActualArrivalDate,
			ContainerNo:         row.ContainerNo,
			HandlingMode:        coalesceInboundHandlingMode(row.HandlingMode),
			StorageSection:      fallbackSection(row.StorageSection),
			UnitLabel:           row.UnitLabel,
			DocumentNote:        row.DocumentNote,
			Status:              normalizeDocumentStatus(row.Status),
			TrackingStatus:      normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:         row.ConfirmedAt,
			DeleteNote:          row.DeleteNote,
			DeletedAt:           row.DeletedAt,
			ArchivedAt:          row.ArchivedAt,
			CreatedAt:           row.CreatedAt,
			UpdatedAt:           row.UpdatedAt,
			Lines:               make([]InboundDocumentLine, 0),
		}
		documents = append(documents, document)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			document_id,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			storage_section,
			reorder_level,
			expected_qty,
			received_qty,
			pallets,
			units_per_pallet,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(pallet_breakdown_json, '') AS pallet_breakdown_json,
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
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			StorageSection:    fallbackSection(lineRow.StorageSection),
			ReorderLevel:      lineRow.ReorderLevel,
			ExpectedQty:       lineRow.ExpectedQty,
			ReceivedQty:       lineRow.ReceivedQty,
			Pallets:           lineRow.Pallets,
			UnitsPerPallet:    lineRow.UnitsPerPallet,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			PalletBreakdown:   decodeInboundPalletBreakdownOrEmpty(lineRow.PalletBreakdownJSON),
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
	if strings.TrimSpace(line.Description) == "" {
		return 0, "", fmt.Errorf("%w: description is required for new inbound sku rows", ErrInvalidInput)
	}

	itemInput := sanitizeItemInput(CreateItemInput{
		SKU:            line.SKU,
		Name:           firstNonEmpty(line.Description, line.SKU),
		Category:       "General",
		Description:    line.Description,
		Unit:           strings.ToLower(firstNonEmpty(documentInput.UnitLabel, "CTN")),
		Quantity:       0,
		ReorderLevel:   line.ReorderLevel,
		CustomerID:     documentInput.CustomerID,
		LocationID:     documentInput.LocationID,
		StorageSection: firstNonEmpty(line.StorageSection, documentInput.StorageSection),
		DeliveryDate:   safeDateInput(deliveryDate),
		ContainerNo:    documentInput.ContainerNo,
	})
	if err := validateItemInput(itemInput); err != nil {
		return 0, "", err
	}

	skuMasterID, err := s.ensureSKUMaster(ctx, tx, itemInput)
	if err != nil {
		return 0, "", err
	}

	var itemID int64
	matchByContainerQuery := `
		SELECT id
		FROM inventory_items
		WHERE
			sku_master_id = ?
			AND customer_id = ?
			AND location_id = ?
			AND COALESCE(NULLIF(storage_section, ''), ?) = ?
			AND COALESCE(container_no, '') = ?
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
		FOR UPDATE
	`
	matchByContainerArgs := []any{
		skuMasterID,
		documentInput.CustomerID,
		documentInput.LocationID,
		DefaultStorageSection,
		normalizedSection,
		normalizedContainerNo,
	}
	err = tx.QueryRowContext(ctx, matchByContainerQuery, matchByContainerArgs...).Scan(&itemID)
	if err == nil {
		if err := s.syncInboundItemSnapshotTx(ctx, tx, itemID, itemInput, normalizedSection, normalizedContainerNo, deliveryDate); err != nil {
			return 0, "", err
		}
		return itemID, itemInput.Description, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		matchPlaceholderQuery := `
			SELECT id
			FROM inventory_items
			WHERE
				sku_master_id = ?
				AND customer_id = ?
				AND location_id = ?
				AND COALESCE(NULLIF(storage_section, ''), ?) = ?
				AND COALESCE(container_no, '') = ''
			ORDER BY updated_at DESC, id DESC
			LIMIT 1
			FOR UPDATE
		`
		matchPlaceholderArgs := []any{
			skuMasterID,
			documentInput.CustomerID,
			documentInput.LocationID,
			DefaultStorageSection,
			normalizedSection,
		}
		err = tx.QueryRowContext(ctx, matchPlaceholderQuery, matchPlaceholderArgs...).Scan(&itemID)
		if err == nil {
			if err := s.syncInboundItemSnapshotTx(ctx, tx, itemID, itemInput, normalizedSection, normalizedContainerNo, deliveryDate); err != nil {
				return 0, "", err
			}
			return itemID, itemInput.Description, nil
		}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, "", fmt.Errorf("load inbound inventory item by sku master: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			location_id,
			storage_section,
			delivery_date,
			container_no,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`,
		skuMasterID,
		itemInput.CustomerID,
		itemInput.LocationID,
		itemInput.StorageSection,
		nullableTime(deliveryDate),
		itemInput.ContainerNo,
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

func (s *Store) syncInboundItemSnapshotTx(ctx context.Context, tx *sql.Tx, itemID int64, itemInput CreateItemInput, storageSection string, containerNo string, deliveryDate *time.Time) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			storage_section = ?,
			container_no = ?,
			delivery_date = COALESCE(?, delivery_date),
			last_restocked_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		fallbackSection(storageSection),
		nullableString(containerNo),
		nullableTime(deliveryDate),
		itemID,
	); err != nil {
		return mapDBError(fmt.Errorf("sync inbound inventory snapshot: %w", err))
	}
	return nil
}

func sanitizeInboundDocumentInput(input CreateInboundDocumentInput) CreateInboundDocumentInput {
	input.ExpectedArrivalDate = strings.TrimSpace(input.ExpectedArrivalDate)
	input.ActualArrivalDate = strings.TrimSpace(input.ActualArrivalDate)
	input.ContainerNo = strings.TrimSpace(strings.ToUpper(input.ContainerNo))
	input.HandlingMode = strings.TrimSpace(strings.ToUpper(input.HandlingMode))
	input.StorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(input.StorageSection)))
	input.UnitLabel = strings.TrimSpace(strings.ToUpper(input.UnitLabel))
	input.Status = strings.TrimSpace(strings.ToUpper(input.Status))
	input.TrackingStatus = strings.TrimSpace(strings.ToUpper(input.TrackingStatus))
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)

	lines := make([]CreateInboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.SKU = strings.TrimSpace(strings.ToUpper(line.SKU))
		line.Description = strings.TrimSpace(line.Description)
		if line.UnitsPerPallet < 0 {
			line.UnitsPerPallet = 0
		}
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.StorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(line.StorageSection)))
		line.LineNote = strings.TrimSpace(line.LineNote)
		line.PalletBreakdown = normalizeInboundPalletBreakdown(line.PalletBreakdown)
		if len(line.PalletBreakdown) > 0 {
			line.Pallets = len(line.PalletBreakdown)
			line.PalletsDetailCtns = formatInboundPalletBreakdownDetail(line.PalletBreakdown)
		}
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
	handlingMode := coalesceInboundHandlingMode(input.HandlingMode)
	if err := validateCreatableDocumentStatus(coalescedStatus); err != nil {
		return err
	}
	switch handlingMode {
	case InboundHandlingModePalletized, InboundHandlingModeSealedTransit:
	default:
		return fmt.Errorf("%w: invalid inbound handling mode", ErrInvalidInput)
	}
	if normalizedTracking := normalizeInboundTrackingStatus(input.TrackingStatus, coalescedStatus); normalizedTracking == "" {
		return fmt.Errorf("%w: invalid inbound tracking status", ErrInvalidInput)
	}
	if coalescedStatus == DocumentStatusConfirmed && normalizeInboundTrackingStatus(input.TrackingStatus, coalescedStatus) != InboundTrackingReceived {
		return fmt.Errorf("%w: confirmed receipts must use the received tracking status", ErrInvalidInput)
	}
	if handlingMode == InboundHandlingModeSealedTransit && coalescedStatus == DocumentStatusConfirmed {
		return fmt.Errorf("%w: sealed transit receipts must stay draft until they are converted to palletized", ErrInvalidInput)
	}
	if handlingMode == InboundHandlingModeSealedTransit && normalizeInboundTrackingStatus(input.TrackingStatus, coalescedStatus) == InboundTrackingReceived {
		return fmt.Errorf("%w: sealed transit receipts cannot use the received tracking status", ErrInvalidInput)
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
		if handlingMode == InboundHandlingModeSealedTransit && len(line.PalletBreakdown) > 0 {
			return fmt.Errorf("%w: sealed transit receipts cannot include pallet breakdown", ErrInvalidInput)
		}
		if len(line.PalletBreakdown) > 0 {
			totalBreakdownQty := 0
			for _, breakdown := range line.PalletBreakdown {
				if breakdown.Quantity <= 0 {
					return fmt.Errorf("%w: pallet quantities must be greater than zero", ErrInvalidInput)
				}
				totalBreakdownQty += breakdown.Quantity
			}
			if totalBreakdownQty != line.receivedOrExpectedQty() {
				return fmt.Errorf("%w: pallet breakdown total must match the inbound line quantity", ErrInvalidInput)
			}
		}
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

func (line inboundDocumentLineRow) palletBreakdown() []InboundPalletBreakdown {
	return decodeInboundPalletBreakdownOrEmpty(line.PalletBreakdownJSON)
}

func normalizeInboundPalletBreakdown(entries []InboundPalletBreakdown) []InboundPalletBreakdown {
	if len(entries) == 0 {
		return nil
	}

	normalized := make([]InboundPalletBreakdown, 0, len(entries))
	for _, entry := range entries {
		if entry.Quantity < 0 {
			entry.Quantity = 0
		}
		normalized = append(normalized, InboundPalletBreakdown{Quantity: entry.Quantity})
	}
	return normalized
}

func decodeInboundPalletBreakdownOrEmpty(raw string) []InboundPalletBreakdown {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []InboundPalletBreakdown{}
	}

	var entries []InboundPalletBreakdown
	if err := json.Unmarshal([]byte(trimmed), &entries); err != nil {
		return []InboundPalletBreakdown{}
	}
	return normalizeInboundPalletBreakdown(entries)
}

func mustEncodeInboundPalletBreakdown(entries []InboundPalletBreakdown) string {
	normalized := normalizeInboundPalletBreakdown(entries)
	if len(normalized) == 0 {
		return ""
	}

	payload, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	return string(payload)
}

func formatInboundPalletBreakdownDetail(entries []InboundPalletBreakdown) string {
	normalized := normalizeInboundPalletBreakdown(entries)
	if len(normalized) == 0 {
		return ""
	}

	parts := make([]string, 0, len(normalized))
	runQuantity := normalized[0].Quantity
	runCount := 0

	flush := func() {
		if runCount <= 0 {
			return
		}
		if runCount == 1 {
			parts = append(parts, fmt.Sprintf("%d", runQuantity))
			return
		}
		parts = append(parts, fmt.Sprintf("%d*%d", runCount, runQuantity))
	}

	for _, entry := range normalized {
		if entry.Quantity == runQuantity {
			runCount++
			continue
		}
		flush()
		runQuantity = entry.Quantity
		runCount = 1
	}
	flush()

	return strings.Join(parts, "+")
}

func safeDateInput(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.DateOnly)
}
