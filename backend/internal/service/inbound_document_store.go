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
	ContainerID         int64                 `json:"containerId"`
	ContainerNo         string                `json:"containerNo"`
	ContainerType       string                `json:"containerType"`
	HandlingMode        string                `json:"handlingMode"`
	StorageSection      string                `json:"storageSection"`
	UnitLabel           string                `json:"unitLabel"`
	DocumentNote        string                `json:"documentNote"`
	Status              string                `json:"status"`
	TrackingStatus      string                `json:"trackingStatus"`
	ConfirmedAt         *time.Time            `json:"confirmedAt"`
	DeletedAt           *time.Time            `json:"deletedAt"`
	ArchivedAt          *time.Time            `json:"archivedAt"`
	TotalLines          int                   `json:"totalLines"`
	TotalExpectedQty    int                   `json:"totalExpectedQty"`
	TotalReceivedQty    int                   `json:"totalReceivedQty"`
	CreatedAt           time.Time             `json:"createdAt"`
	UpdatedAt           time.Time             `json:"updatedAt"`
	Lines               []InboundDocumentLine `json:"lines"`
	Attachments         []DocumentAttachment  `json:"attachments"`
}

type InboundDocumentLine struct {
	ID                int64                    `json:"id"`
	DocumentID        int64                    `json:"documentId"`
	SKU               string                   `json:"sku"`
	Description       string                   `json:"description"`
	StorageSection    string                   `json:"storageSection"`
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
	ContainerID         int64                            `json:"containerId"`
	ContainerNo         string                           `json:"containerNo"`
	ContainerType       string                           `json:"containerType"`
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

type UpdateInboundDocumentContainerTypeInput struct {
	ContainerType string `json:"containerType"`
}

type CreateInboundDocumentLineInput struct {
	SKU               string                   `json:"sku"`
	Description       string                   `json:"description"`
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
	ContainerID         int64      `db:"container_id"`
	ContainerNo         string     `db:"container_no"`
	ContainerType       string     `db:"container_type"`
	HandlingMode        string     `db:"handling_mode"`
	StorageSection      string     `db:"storage_section"`
	UnitLabel           string     `db:"unit_label"`
	DocumentNote        string     `db:"document_note"`
	Status              string     `db:"status"`
	TrackingStatus      string     `db:"tracking_status"`
	ConfirmedAt         *time.Time `db:"confirmed_at"`
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

type InboundDocumentFilters struct {
	ArchiveScope   string
	Search         string
	ContainerID    int64
	CustomerID     int64
	LocationID     int64
	Status         string
	TrackingStatus string
	ExcludeDeleted bool
}

func (s *Store) ListInboundDocuments(ctx context.Context, limit int, archiveScope ...string) ([]InboundDocument, error) {
	filters := InboundDocumentFilters{ArchiveScope: DocumentArchiveScopeActive}
	if len(archiveScope) > 0 {
		filters.ArchiveScope = archiveScope[0]
	}
	return s.ListInboundDocumentsFiltered(ctx, limit, filters)
}

func (s *Store) ListInboundDocumentsFiltered(ctx context.Context, limit int, filters InboundDocumentFilters) ([]InboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}

	whereClauses := []string{buildDocumentArchiveFilterClause("d", filters.ArchiveScope)}
	args := make([]any, 0, 16)
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "d.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if filters.ContainerID > 0 {
		whereClauses = append(whereClauses, "COALESCE(d.container_id, 0) = ?")
		args = append(args, filters.ContainerID)
	}
	if filters.LocationID > 0 {
		whereClauses = append(whereClauses, "d.location_id = ?")
		args = append(args, filters.LocationID)
	}
	if statusFilterClause, statusArgs := buildDocumentStatusFilterClause("d", filters.Status); statusFilterClause != "" {
		whereClauses = append(whereClauses, statusFilterClause)
		args = append(args, statusArgs...)
	}
	if filters.ExcludeDeleted {
		whereClauses = append(whereClauses, "UPPER(TRIM(d.status)) NOT IN (?, ?)")
		args = append(args, DocumentStatusDeleted, "CANCELLED")
	}
	if trackingFilterClause, trackingArgs := buildInboundTrackingStatusFilterClause("d", filters.TrackingStatus); trackingFilterClause != "" {
		whereClauses = append(whereClauses, trackingFilterClause)
		args = append(args, trackingArgs...)
	}
	if search := strings.TrimSpace(strings.ToLower(filters.Search)); search != "" {
		searchPattern := "%" + search + "%"
		whereClauses = append(whereClauses, `(
			LOWER(COALESCE(d.container_no, '')) LIKE ?
			OR LOWER(COALESCE(d.document_note, '')) LIKE ?
			OR LOWER(COALESCE(d.unit_label, '')) LIKE ?
			OR LOWER(COALESCE(d.storage_section, '')) LIKE ?
			OR LOWER(COALESCE(d.tracking_status, '')) LIKE ?
			OR LOWER(COALESCE(c.name, '')) LIKE ?
			OR LOWER(COALESCE(l.name, '')) LIKE ?
			OR EXISTS (
				SELECT 1
				FROM inbound_document_lines il
				WHERE il.document_id = d.id
					AND (
						LOWER(COALESCE(il.sku_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(il.description_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(il.storage_section, '')) LIKE ?
						OR LOWER(COALESCE(il.unit_label, '')) LIKE ?
						OR LOWER(COALESCE(il.pallets_detail_ctns, '')) LIKE ?
						OR LOWER(COALESCE(il.pallet_breakdown_json, '')) LIKE ?
						OR LOWER(COALESCE(il.line_note, '')) LIKE ?
					)
			)
		)`)
		for range 14 {
			args = append(args, searchPattern)
		}
	}
	args = append(args, limit)

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
			COALESCE(d.container_id, 0) AS container_id,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.container_type, '') AS container_type,
			COALESCE(d.handling_mode, '') AS handling_mode,
			d.storage_section,
			COALESCE(d.unit_label, '') AS unit_label,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
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
	`, strings.Join(whereClauses, " AND ")), args...); err != nil {
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
			ContainerID:         row.ContainerID,
			ContainerNo:         row.ContainerNo,
			ContainerType:       coalesceContainerType(row.ContainerType),
			HandlingMode:        coalesceInboundHandlingMode(row.HandlingMode),
			StorageSection:      fallbackSection(row.StorageSection),
			UnitLabel:           row.UnitLabel,
			DocumentNote:        row.DocumentNote,
			Status:              normalizeDocumentStatus(row.Status),
			TrackingStatus:      normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:         row.ConfirmedAt,
			DeletedAt:           row.DeletedAt,
			ArchivedAt:          row.ArchivedAt,
			CreatedAt:           row.CreatedAt,
			UpdatedAt:           row.UpdatedAt,
			Lines:               make([]InboundDocumentLine, 0),
			Attachments:         make([]DocumentAttachment, 0),
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

	if err := s.attachDocumentAttachments(ctx, DocumentAttachmentInbound, documentIDs, func(documentID int64, attachments []DocumentAttachment) {
		if document := documentsByID[documentID]; document != nil {
			document.Attachments = attachments
		}
	}); err != nil {
		return nil, err
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

	containerID, err := s.ensureInboundDocumentContainerTx(
		ctx,
		tx,
		0,
		input.CustomerID,
		input.LocationID,
		input.ContainerID,
		input.ContainerNo,
		input.ContainerType,
		input.HandlingMode,
		persistedStatus,
		requestedTrackingStatus,
		firstNonEmptyTime(actualArrivalDate, expectedArrivalDate),
	)
	if err != nil {
		return InboundDocument{}, err
	}
	if err := s.ensureContainerHasNoOtherActiveInboundDocumentTx(ctx, tx, containerID, 0); err != nil {
		return InboundDocument{}, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id,
			location_id,
			expected_arrival_date,
			actual_arrival_date,
			container_id,
			container_no,
			container_type,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
	`,
		input.CustomerID,
		input.LocationID,
		nullableTime(expectedArrivalDate),
		nullableTime(actualArrivalDate),
		containerID,
		nullableString(input.ContainerNo),
		coalesceContainerType(input.ContainerType),
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
	if err := s.syncContainerDocumentLinkTx(ctx, tx, containerID, documentID, input.LocationID); err != nil {
		return InboundDocument{}, err
	}

	for index, line := range input.Lines {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO inbound_document_lines (
				document_id,
				sku_snapshot,
				description_snapshot,
				storage_section,
				expected_qty,
				received_qty,
				pallets,
				units_per_pallet,
				pallets_detail_ctns,
				pallet_breakdown_json,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			line.SKU,
			nullableString(line.Description),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
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
		if err := s.updateConfirmedInboundDocumentTx(ctx, tx, documentID, documentRow, input, expectedArrivalDate, actualArrivalDate); err != nil {
			return InboundDocument{}, err
		}
	} else if normalizedDocumentStatus == DocumentStatusDraft {
		if err := s.updateDraftInboundDocumentTx(ctx, tx, documentID, documentRow, input, expectedArrivalDate, actualArrivalDate, requestedStatus, requestedTrackingStatus); err != nil {
			return InboundDocument{}, err
		}
	} else {
		return InboundDocument{}, fmt.Errorf("%w: only draft or confirmed receipts can be edited", ErrInvalidInput)
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

func (s *Store) UpdateInboundDocumentContainerType(ctx context.Context, documentID int64, input UpdateInboundDocumentContainerTypeInput) (InboundDocument, error) {
	input.ContainerType = strings.TrimSpace(strings.ToUpper(input.ContainerType))
	if err := validateContainerType(input.ContainerType); err != nil {
		return InboundDocument{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound container type update transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID); err != nil {
		return InboundDocument{}, err
	}

	nextContainerType := coalesceContainerType(input.ContainerType)
	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			container_type = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nextContainerType,
		documentID,
	); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("update inbound document container type: %w", err))
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE container_visits
		SET
			container_type = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE inbound_document_id = ?
	`,
		nextContainerType,
		documentID,
	); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("sync inbound container visit container type: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound container type update: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) ensureInboundDocumentContainerTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	customerID int64,
	locationID int64,
	currentContainerID int64,
	containerNo string,
	containerType string,
	handlingMode string,
	status string,
	trackingStatus string,
	eventTime *time.Time,
) (int64, error) {
	normalizedContainerNo := normalizeContainerNo(containerNo)
	if currentContainerID > 0 {
		var containerCustomerID int64
		if err := tx.QueryRowContext(ctx, `
			SELECT customer_id
			FROM containers
			WHERE id = ?
			FOR UPDATE
		`, currentContainerID).Scan(&containerCustomerID); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return 0, mapDBError(fmt.Errorf("load inbound document container owner: %w", err))
			}
			currentContainerID = 0
		} else if containerCustomerID != customerID {
			currentContainerID = 0
		}
	}
	if currentContainerID <= 0 && customerID > 0 && normalizedContainerNo != "" {
		resolvedContainerID, err := s.resolveInboundDocumentContainerIDByNoTx(ctx, tx, customerID, normalizedContainerNo)
		if err != nil {
			return 0, err
		}
		currentContainerID = resolvedContainerID
	}
	if currentContainerID > 0 {
		if err := s.syncContainerNumberTx(ctx, tx, currentContainerID, customerID, locationID, normalizedContainerNo); err != nil {
			return 0, err
		}
		if err := s.syncContainerDocumentLinkTx(ctx, tx, currentContainerID, documentID, locationID); err != nil {
			return 0, err
		}
		return currentContainerID, nil
	}

	containerID, err := s.ensureContainerRecordTx(
		ctx,
		tx,
		customerID,
		documentID,
		locationID,
		normalizedContainerNo,
		containerType,
		handlingMode,
		status,
		trackingStatus,
		eventTime,
	)
	if err != nil {
		return 0, err
	}
	if err := s.syncContainerDocumentLinkTx(ctx, tx, containerID, documentID, locationID); err != nil {
		return 0, err
	}
	return containerID, nil
}

func (s *Store) resolveInboundDocumentContainerIDByNoTx(ctx context.Context, tx *sql.Tx, customerID int64, containerNo string) (int64, error) {
	normalizedContainerNo := normalizeContainerNo(containerNo)
	if customerID <= 0 || normalizedContainerNo == "" {
		return 0, nil
	}

	var containerID int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM containers
		WHERE customer_id = ?
			AND UPPER(TRIM(container_no)) = ?
		ORDER BY id DESC
		LIMIT 1
		FOR UPDATE
	`, customerID, normalizedContainerNo).Scan(&containerID)
	if err == nil {
		return containerID, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return 0, mapDBError(fmt.Errorf("resolve inbound document container by number: %w", err))
}

func (s *Store) ensureContainerHasNoOtherActiveInboundDocumentTx(ctx context.Context, tx *sql.Tx, containerID int64, allowedDocumentID int64) error {
	if containerID <= 0 {
		return nil
	}

	var existingDocumentID int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM inbound_documents
		WHERE COALESCE(container_id, 0) = ?
			AND id <> ?
			AND archived_at IS NULL
			AND COALESCE(UPPER(TRIM(status)), '') NOT IN (?, ?)
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, containerID, allowedDocumentID, DocumentStatusDeleted, "CANCELLED").Scan(&existingDocumentID)
	if err == nil {
		return fmt.Errorf("%w: container already has inbound receipt #%d; edit it or delete it before creating a new receipt", ErrInvalidInput, existingDocumentID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return mapDBError(fmt.Errorf("load active inbound document for container: %w", err))
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
		return fmt.Errorf("%w: confirmed receipts must use the confirmed receipt update flow", ErrInvalidInput)
	}
	if normalizedDocumentStatus != DocumentStatusDraft {
		return fmt.Errorf("%w: only draft receipts can be edited", ErrInvalidInput)
	}

	persistedStatus := requestedStatus
	if requestedStatus == DocumentStatusConfirmed {
		persistedStatus = DocumentStatusDraft
	}

	containerID := input.ContainerID
	if containerID <= 0 && documentRow.CustomerID == input.CustomerID {
		containerID = documentRow.ContainerID
	}
	containerID, err := s.ensureInboundDocumentContainerTx(
		ctx,
		tx,
		documentID,
		input.CustomerID,
		input.LocationID,
		containerID,
		input.ContainerNo,
		input.ContainerType,
		input.HandlingMode,
		persistedStatus,
		requestedTrackingStatus,
		firstNonEmptyTime(actualArrivalDate, expectedArrivalDate),
	)
	if err != nil {
		return err
	}
	if err := s.ensureContainerHasNoOtherActiveInboundDocumentTx(ctx, tx, containerID, documentID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			customer_id = ?,
			location_id = ?,
			expected_arrival_date = ?,
			actual_arrival_date = ?,
			container_id = ?,
			container_no = ?,
			container_type = ?,
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
		containerID,
		nullableString(input.ContainerNo),
		coalesceContainerType(input.ContainerType),
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
				expected_qty,
				received_qty,
				pallets,
				units_per_pallet,
				pallets_detail_ctns,
				pallet_breakdown_json,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			line.SKU,
			nullableString(line.Description),
			fallbackSection(firstNonEmpty(line.StorageSection, input.StorageSection)),
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
	expectedArrivalDate *time.Time,
	actualArrivalDate *time.Time,
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
	deliveryDate := firstNonEmptyTime(actualArrivalDate, expectedArrivalDate, documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate)

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
	containerID, err := s.ensureInboundDocumentContainerTx(
		ctx,
		tx,
		documentID,
		documentRow.CustomerID,
		documentRow.LocationID,
		firstNonZeroInt64(input.ContainerID, documentRow.ContainerID),
		firstNonEmpty(newContainerNo, oldContainerNo),
		input.ContainerType,
		InboundHandlingModePalletized,
		"IN_STOCK",
		InboundTrackingReceived,
		deliveryDate,
	)
	if err != nil {
		return err
	}
	if err := s.ensureContainerHasNoOtherActiveInboundDocumentTx(ctx, tx, containerID, documentID); err != nil {
		return err
	}

	for index, existingLine := range existingLines {
		nextLine := input.Lines[index]
		if nextLine.SKU != existingLine.SKUSnapshot {
			return fmt.Errorf("%w: confirmed receipt SKU lines cannot be reordered or replaced", ErrInvalidInput)
		}

		oldQty := existingLine.receivedOrExpectedQty()
		newQty := nextLine.receivedOrExpectedQty()
		oldSection := fallbackSection(existingLine.StorageSection)
		newSection := fallbackSection(firstNonEmpty(nextLine.StorageSection, input.StorageSection, existingLine.StorageSection))
		containerChanged := documentRow.ContainerID != containerID
		positionChanged := oldSection != newSection || oldContainerNo != newContainerNo || containerChanged
		lineDescription := firstNonEmpty(nextLine.Description, existingLine.DescriptionSnapshot)
		unitLabel := firstNonEmpty(input.UnitLabel, documentRow.UnitLabel, existingLine.UnitLabel, "CTN")

		if newQty < oldQty {
			if err := s.reduceConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, newSection, newContainerNo, oldQty-newQty, lineDescription, unitLabel); err != nil {
				return err
			}
		}

		if positionChanged {
			if err := s.moveConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, containerID, newSection, newContainerNo, lineDescription, unitLabel); err != nil {
				return err
			}
		}

		if newQty > oldQty {
			if err := s.increaseConfirmedInboundReceiptLotsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, containerID, newSection, newContainerNo, newQty-oldQty, lineDescription, unitLabel); err != nil {
				return err
			}
		}
		if !positionChanged && nextLine.Pallets != existingLine.Pallets {
			if err := s.adjustDirectConfirmedInboundReceiptPalletsTx(ctx, tx, documentID, documentRow, existingLine, nextLine, newSection, newContainerNo, lineDescription, unitLabel); err != nil {
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

		if err := s.syncConfirmedInboundInventoryItemTx(
			ctx,
			tx,
			existingLine.SKUSnapshot,
			documentRow.CustomerID,
			documentRow.LocationID,
			containerID,
			newSection,
			newContainerNo,
			deliveryDate,
			lineDescription,
			unitLabel,
		); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			expected_arrival_date = ?,
			actual_arrival_date = ?,
			container_id = ?,
			container_no = ?,
			container_type = ?,
			handling_mode = ?,
			storage_section = ?,
			unit_label = ?,
			document_note = ?,
			status = ?,
			tracking_status = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableTime(expectedArrivalDate),
		nullableTime(actualArrivalDate),
		containerID,
		nullableString(newContainerNo),
		coalesceContainerType(input.ContainerType),
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
			ExpectedArrivalDate: documentRow.ExpectedArrivalDate,
			ActualArrivalDate:   documentRow.ActualArrivalDate,
			ContainerNo:         firstNonEmpty(newContainerNo, oldContainerNo),
			ContainerType:       coalesceContainerType(input.ContainerType),
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
					container_type = ?,
					handling_mode = ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`,
				documentRow.CustomerID,
				documentRow.LocationID,
				nullableString(newContainerNo),
				nullableTime(deliveryDate),
				coalesceContainerType(input.ContainerType),
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
	Quantity       int
}

func (s *Store) loadLockedInboundEditableItemTx(ctx context.Context, tx *sql.Tx, itemID int64) (inboundEditableItem, error) {
	projection, err := s.loadInventoryProjectionTx(ctx, tx, itemID)
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

func (s *Store) syncConfirmedInboundInventoryItemTx(
	ctx context.Context,
	tx *sql.Tx,
	sku string,
	customerID int64,
	locationID int64,
	containerID int64,
	storageSection string,
	containerNo string,
	deliveryDate *time.Time,
	description string,
	unitLabel string,
) error {
	skuMasterID, err := s.getSKUMasterIDBySKUTx(ctx, tx, sku)
	if err != nil {
		return err
	}
	itemID, err := s.findInventoryItemIDByProjectionTx(ctx, tx, skuMasterID, customerID, locationID, storageSection, containerID, containerNo)
	if err != nil {
		return err
	}
	return s.updateInboundEditableItemStateTx(
		ctx,
		tx,
		itemID,
		storageSection,
		containerNo,
		deliveryDate,
		description,
		unitLabel,
	)
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
	return s.reduceDirectConfirmedInboundReceiptBalanceTx(ctx, tx, documentID, documentRow, existingLine, nextLine, reductionQty, lineDescription, unitLabel)
}

func (s *Store) moveConfirmedInboundReceiptLotsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	targetContainerID int64,
	targetSection string,
	targetContainerNo string,
	lineDescription string,
	unitLabel string,
) error {
	return s.moveDirectConfirmedInboundReceiptBalanceTx(ctx, tx, documentID, documentRow, existingLine, nextLine, deliveryDate, targetContainerID, targetSection, targetContainerNo, lineDescription, unitLabel)
}

func (s *Store) getSKUMasterIDBySKUTx(ctx context.Context, tx *sql.Tx, sku string) (int64, error) {
	var skuMasterID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM sku_master
		WHERE sku = ?
		FOR UPDATE
	`, strings.TrimSpace(strings.ToUpper(sku))).Scan(&skuMasterID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("load sku master by sku: %w", err)
	}
	return skuMasterID, nil
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func (s *Store) reduceDirectConfirmedInboundReceiptBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	reductionQty int,
	lineDescription string,
	unitLabel string,
) error {
	if reductionQty <= 0 {
		return nil
	}

	skuMasterID, err := s.getSKUMasterIDBySKUTx(ctx, tx, existingLine.SKUSnapshot)
	if err != nil {
		return err
	}
	oldSection := fallbackSection(existingLine.StorageSection)
	oldContainerNo := strings.TrimSpace(documentRow.ContainerNo)
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, inventorySourceBucket{
		SKUMasterID:    skuMasterID,
		CustomerID:     documentRow.CustomerID,
		LocationID:     documentRow.LocationID,
		StorageSection: oldSection,
		ContainerID:    documentRow.ContainerID,
		ContainerNo:    oldContainerNo,
	})
	if err != nil {
		return err
	}
	if reductionQty > state.availableQty() {
		return fmt.Errorf("%w: receipt line %s cannot reduce below quantity already consumed", ErrInvalidInput, existingLine.SKUSnapshot)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, reductionQty, state.ItemID); err != nil {
		return mapDBError(fmt.Errorf("reduce direct inbound inventory: %w", err))
	}

	return s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventAdjust,
		SKUMasterID:         skuMasterID,
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		StorageSection:      oldSection,
		QuantityChange:      -reductionQty,
		SourceDocumentType:  StockLedgerSourceInbound,
		SourceDocumentID:    documentID,
		SourceLineID:        existingLine.ID,
		ContainerID:         state.ContainerID,
		ContainerNo:         oldContainerNo,
		DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
		ItemNumber:          existingLine.SKUSnapshot,
		DescriptionSnapshot: lineDescription,
		ExpectedQty:         nextLine.ExpectedQty,
		ReceivedQty:         nextLine.ReceivedQty,
		PalletsDetailCtns:   nextLine.PalletsDetailCtns,
		UnitLabel:           firstNonEmpty(unitLabel, documentRow.UnitLabel, "PLT"),
		DocumentNote:        documentRow.DocumentNote,
		Reason:              fmt.Sprintf("Receipt correction: quantity updated from %d to %d", existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty()),
	})
}

func (s *Store) adjustDirectConfirmedInboundReceiptPalletsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	storageSection string,
	containerNo string,
	lineDescription string,
	unitLabel string,
) error {
	palletDelta := nextLine.Pallets - existingLine.Pallets
	if palletDelta == 0 {
		return nil
	}

	skuMasterID, err := s.getSKUMasterIDBySKUTx(ctx, tx, existingLine.SKUSnapshot)
	if err != nil {
		return err
	}
	bucket := inventorySourceBucket{
		SKUMasterID:    skuMasterID,
		CustomerID:     documentRow.CustomerID,
		LocationID:     documentRow.LocationID,
		StorageSection: fallbackSection(storageSection),
		ContainerID:    documentRow.ContainerID,
		ContainerNo:    strings.TrimSpace(containerNo),
	}
	state, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, bucket)
	if err != nil {
		return err
	}
	bucket.ContainerID = state.ContainerID
	if err := s.adjustInventoryPalletBalanceByIDTx(ctx, tx, state.ItemID, palletDelta); err != nil {
		return err
	}
	return s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventAdjust,
		SKUMasterID:         skuMasterID,
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		StorageSection:      bucket.StorageSection,
		QuantityChange:      0,
		SourceDocumentType:  StockLedgerSourceInbound,
		SourceDocumentID:    documentID,
		SourceLineID:        existingLine.ID,
		ContainerID:         bucket.ContainerID,
		ContainerNo:         bucket.ContainerNo,
		DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
		ItemNumber:          existingLine.SKUSnapshot,
		DescriptionSnapshot: lineDescription,
		ExpectedQty:         nextLine.ExpectedQty,
		ReceivedQty:         nextLine.ReceivedQty,
		Pallets:             palletDelta,
		PalletsDetailCtns:   nextLine.PalletsDetailCtns,
		UnitLabel:           firstNonEmpty(unitLabel, documentRow.UnitLabel, "PLT"),
		DocumentNote:        documentRow.DocumentNote,
		Reason:              fmt.Sprintf("Receipt correction: pallet count updated from %d to %d", existingLine.Pallets, nextLine.Pallets),
	})
}

func (s *Store) moveDirectConfirmedInboundReceiptBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	targetContainerID int64,
	targetSection string,
	targetContainerNo string,
	lineDescription string,
	unitLabel string,
) error {
	oldSection := fallbackSection(existingLine.StorageSection)
	oldContainerNo := strings.TrimSpace(documentRow.ContainerNo)
	targetSection = fallbackSection(targetSection)
	targetContainerNo = strings.TrimSpace(targetContainerNo)

	moveQty := minInt(existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty())
	if moveQty <= 0 {
		return nil
	}

	skuMasterID, err := s.getSKUMasterIDBySKUTx(ctx, tx, existingLine.SKUSnapshot)
	if err != nil {
		return err
	}
	oldState, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, inventorySourceBucket{
		SKUMasterID:    skuMasterID,
		CustomerID:     documentRow.CustomerID,
		LocationID:     documentRow.LocationID,
		StorageSection: oldSection,
		ContainerID:    documentRow.ContainerID,
		ContainerNo:    oldContainerNo,
	})
	if err != nil {
		return err
	}
	resolvedTargetContainerID := firstNonZeroInt64(targetContainerID, oldState.ContainerID)
	if oldSection == targetSection && oldContainerNo == targetContainerNo && oldState.ContainerID == resolvedTargetContainerID {
		return nil
	}
	if moveQty > oldState.availableQty() {
		return fmt.Errorf("%w: receipt line %s cannot move stock that is reserved, shipped, damaged, or held", ErrInvalidInput, existingLine.SKUSnapshot)
	}
	if existingLine.Pallets > oldState.Pallets {
		return fmt.Errorf("%w: receipt line %s cannot move more pallets than are available", ErrInvalidInput, existingLine.SKUSnapshot)
	}

	targetItemID, _, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		ExpectedArrivalDate: safeDateInput(deliveryDate),
		ContainerID:         resolvedTargetContainerID,
		ContainerNo:         targetContainerNo,
		StorageSection:      targetSection,
		UnitLabel:           unitLabel,
		DocumentNote:        documentRow.DocumentNote,
	}, CreateInboundDocumentLineInput{
		SKU:               existingLine.SKUSnapshot,
		Description:       lineDescription,
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
	if targetItemID == oldState.ItemID {
		return nil
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET quantity = quantity - ?, pallets = pallets - ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, moveQty, existingLine.Pallets, oldState.ItemID); err != nil {
		return mapDBError(fmt.Errorf("move direct inbound inventory out: %w", err))
	}
	if err := s.increaseInventoryBalanceTx(ctx, tx, targetItemID, moveQty, nextLine.Pallets); err != nil {
		return err
	}
	targetState, err := s.loadLockedInventoryBalanceByIDTx(ctx, tx, targetItemID)
	if err != nil {
		return err
	}

	transferReason := fmt.Sprintf(
		"Receipt correction: moved from %s/%s to %s/%s",
		oldSection,
		firstNonEmpty(oldContainerNo, "-"),
		targetSection,
		firstNonEmpty(targetContainerNo, "-"),
	)
	if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventTransferOut,
		SKUMasterID:         skuMasterID,
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		StorageSection:      oldSection,
		QuantityChange:      -moveQty,
		SourceDocumentType:  StockLedgerSourceInbound,
		SourceDocumentID:    documentID,
		SourceLineID:        existingLine.ID,
		ContainerID:         oldState.ContainerID,
		ContainerNo:         oldContainerNo,
		DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
		ItemNumber:          existingLine.SKUSnapshot,
		DescriptionSnapshot: lineDescription,
		ExpectedQty:         nextLine.ExpectedQty,
		ReceivedQty:         nextLine.ReceivedQty,
		Pallets:             existingLine.Pallets,
		PalletsDetailCtns:   nextLine.PalletsDetailCtns,
		UnitLabel:           firstNonEmpty(unitLabel, documentRow.UnitLabel, "PLT"),
		DocumentNote:        documentRow.DocumentNote,
		Reason:              transferReason,
	}); err != nil {
		return err
	}
	return s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventTransferIn,
		SKUMasterID:         skuMasterID,
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		StorageSection:      targetSection,
		QuantityChange:      moveQty,
		SourceDocumentType:  StockLedgerSourceInbound,
		SourceDocumentID:    documentID,
		SourceLineID:        existingLine.ID,
		ContainerID:         targetState.ContainerID,
		ContainerNo:         targetState.ContainerNo,
		DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
		ItemNumber:          existingLine.SKUSnapshot,
		DescriptionSnapshot: lineDescription,
		ExpectedQty:         nextLine.ExpectedQty,
		ReceivedQty:         nextLine.ReceivedQty,
		Pallets:             nextLine.Pallets,
		PalletsDetailCtns:   nextLine.PalletsDetailCtns,
		UnitLabel:           firstNonEmpty(unitLabel, documentRow.UnitLabel, "PLT"),
		DocumentNote:        documentRow.DocumentNote,
		Reason:              transferReason,
	})
}

func (s *Store) increaseConfirmedInboundReceiptLotsTx(
	ctx context.Context,
	tx *sql.Tx,
	documentID int64,
	documentRow inboundDocumentRow,
	existingLine inboundDocumentLineRow,
	nextLine CreateInboundDocumentLineInput,
	deliveryDate *time.Time,
	targetContainerID int64,
	targetSection string,
	targetContainerNo string,
	increaseQty int,
	lineDescription string,
	unitLabel string,
) error {
	if increaseQty <= 0 {
		return nil
	}

	skuMasterID, err := s.getSKUMasterIDBySKUTx(ctx, tx, existingLine.SKUSnapshot)
	if err != nil {
		return err
	}
	resolvedContainerID := targetContainerID
	oldState, err := s.loadLockedInventoryBalanceForBucketTx(ctx, tx, inventorySourceBucket{
		SKUMasterID:    skuMasterID,
		CustomerID:     documentRow.CustomerID,
		LocationID:     documentRow.LocationID,
		StorageSection: fallbackSection(existingLine.StorageSection),
		ContainerID:    documentRow.ContainerID,
		ContainerNo:    strings.TrimSpace(documentRow.ContainerNo),
	})
	if err == nil && resolvedContainerID <= 0 {
		resolvedContainerID = oldState.ContainerID
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}

	targetItemID, _, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		ExpectedArrivalDate: safeDateInput(deliveryDate),
		ContainerID:         resolvedContainerID,
		ContainerNo:         targetContainerNo,
		StorageSection:      targetSection,
		UnitLabel:           unitLabel,
		DocumentNote:        documentRow.DocumentNote,
	}, CreateInboundDocumentLineInput{
		SKU:               existingLine.SKUSnapshot,
		Description:       lineDescription,
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

	if err := s.increaseInventoryBalanceTx(ctx, tx, targetItemID, increaseQty); err != nil {
		return err
	}
	targetState, err := s.loadLockedInventoryBalanceByIDTx(ctx, tx, targetItemID)
	if err != nil {
		return err
	}
	return s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventAdjust,
		SKUMasterID:         skuMasterID,
		CustomerID:          documentRow.CustomerID,
		LocationID:          documentRow.LocationID,
		StorageSection:      fallbackSection(targetSection),
		QuantityChange:      increaseQty,
		SourceDocumentType:  StockLedgerSourceInbound,
		SourceDocumentID:    documentID,
		SourceLineID:        existingLine.ID,
		ContainerID:         targetState.ContainerID,
		ContainerNo:         targetContainerNo,
		DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
		ItemNumber:          existingLine.SKUSnapshot,
		DescriptionSnapshot: lineDescription,
		ExpectedQty:         nextLine.ExpectedQty,
		ReceivedQty:         nextLine.ReceivedQty,
		PalletsDetailCtns:   nextLine.PalletsDetailCtns,
		UnitLabel:           firstNonEmpty(unitLabel, documentRow.UnitLabel, "PLT"),
		DocumentNote:        documentRow.DocumentNote,
		Reason:              fmt.Sprintf("Receipt correction: quantity updated from %d to %d", existingLine.receivedOrExpectedQty(), nextLine.receivedOrExpectedQty()),
	})
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
	if _, err := ensureContainerVisitForInboundDocumentTx(ctx, tx, documentRow); err != nil {
		return err
	}
	containerEventTime := firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate, &confirmedAt)
	containerID, err := s.ensureInboundDocumentContainerTx(
		ctx,
		tx,
		documentRow.ID,
		documentRow.CustomerID,
		documentRow.LocationID,
		documentRow.ContainerID,
		documentRow.ContainerNo,
		documentRow.ContainerType,
		documentRow.HandlingMode,
		"IN_STOCK",
		InboundTrackingReceived,
		containerEventTime,
	)
	if err != nil {
		return err
	}
	if err := s.ensureContainerHasNoOtherActiveInboundDocumentTx(ctx, tx, containerID, documentRow.ID); err != nil {
		return err
	}

	for _, lineRow := range lineRows {
		itemID, itemDescription, err := s.findOrCreateInboundItem(ctx, tx, CreateInboundDocumentInput{
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			ExpectedArrivalDate: safeDateInput(documentRow.ExpectedArrivalDate),
			ContainerID:         containerID,
			ContainerNo:         documentRow.ContainerNo,
			StorageSection:      documentRow.StorageSection,
			UnitLabel:           documentRow.UnitLabel,
			DocumentNote:        documentRow.DocumentNote,
		}, CreateInboundDocumentLineInput{
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
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
		if err := s.increaseInventoryBalanceTx(ctx, tx, itemID, receivedQty, lineRow.Pallets); err != nil {
			return err
		}
		receiptEventTime := firstNonEmptyTime(documentRow.ActualArrivalDate, &confirmedAt)
		if receiptEventTime == nil {
			receiptEventTime = &confirmedAt
		}
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventReceive,
			OccurredAt:          receiptEventTime,
			SKUMasterID:         skuMasterID,
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			StorageSection:      lotSection,
			QuantityChange:      receivedQty,
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentID,
			SourceLineID:        lineRow.ID,
			ContainerID:         containerID,
			ContainerNo:         lotContainer,
			DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
			ItemNumber:          lineRow.SKUSnapshot,
			DescriptionSnapshot: itemDescription,
			ExpectedQty:         lineRow.ExpectedQty,
			ReceivedQty:         lineRow.ReceivedQty,
			Pallets:             lineRow.Pallets,
			PalletsDetailCtns:   lineRow.PalletsDetailCtns,
			UnitLabel:           firstNonEmpty(documentRow.UnitLabel, "PLT"),
			DocumentNote:        documentRow.DocumentNote,
			Reason:              firstNonEmpty(lineRow.LineNote, defaultMovementReason("IN")),
		}); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			container_id = ?,
			status = ?,
			tracking_status = ?,
			confirmed_at = COALESCE(confirmed_at, ?),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, containerID, DocumentStatusConfirmed, InboundTrackingReceived, confirmedAt, documentID); err != nil {
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

func (s *Store) CancelInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
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

	deletedAt := time.Now().UTC()

	if status == DocumentStatusConfirmed {
		if err := s.reduceInventoryBalancesForInboundLedgerTx(ctx, tx, documentID); err != nil {
			return InboundDocument{}, err
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM stock_ledger WHERE source_document_type = ? AND source_document_id = ?`,
			StockLedgerSourceInbound, documentID); err != nil {
			return InboundDocument{}, mapDBError(fmt.Errorf("delete stock ledger for inbound: %w", err))
		}
	}

	if err := markDocumentAttachmentsDeletedForDocument(ctx, tx, DocumentAttachmentInbound, documentID); err != nil {
		return InboundDocument{}, err
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
		ContainerID: documentRow.ContainerID,
		ContainerNo: documentRow.ContainerNo,
		Status:      DocumentStatusDeleted,
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
	if err := s.ensureContainerHasNoOtherActiveInboundDocumentTx(ctx, tx, documentRow.ContainerID, 0); err != nil {
		return InboundDocument{}, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id,
			location_id,
			expected_arrival_date,
			actual_arrival_date,
			container_id,
			container_no,
			container_type,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
	`,
		documentRow.CustomerID,
		documentRow.LocationID,
		nullableTime(documentRow.ExpectedArrivalDate),
		nullableTime(documentRow.ActualArrivalDate),
		documentRow.ContainerID,
		nullableString(documentRow.ContainerNo),
		coalesceContainerType(documentRow.ContainerType),
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
				expected_qty,
				received_qty,
				pallets,
				units_per_pallet,
				pallets_detail_ctns,
				pallet_breakdown_json,
				unit_label,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			newDocumentID,
			lineRow.SKUSnapshot,
			nullableString(lineRow.DescriptionSnapshot),
			fallbackSection(lineRow.StorageSection),
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
			COALESCE(d.container_id, 0) AS container_id,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.container_type, '') AS container_type,
			COALESCE(d.handling_mode, '') AS handling_mode,
			d.storage_section,
			COALESCE(d.unit_label, '') AS unit_label,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
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
		&documentRow.ContainerID,
		&documentRow.ContainerNo,
		&documentRow.ContainerType,
		&documentRow.HandlingMode,
		&documentRow.StorageSection,
		&documentRow.UnitLabel,
		&documentRow.DocumentNote,
		&documentRow.Status,
		&documentRow.TrackingStatus,
		&documentRow.ConfirmedAt,
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

func (s *Store) GetInboundDocumentForCustomer(ctx context.Context, documentID int64, customerID int64) (InboundDocument, error) {
	if documentID <= 0 || customerID <= 0 {
		return InboundDocument{}, ErrNotFound
	}
	document, err := s.getInboundDocument(ctx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if document.CustomerID != customerID {
		return InboundDocument{}, ErrNotFound
	}
	return document, nil
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
			COALESCE(d.container_id, 0) AS container_id,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.container_type, '') AS container_type,
			COALESCE(d.handling_mode, '') AS handling_mode,
			d.storage_section,
			COALESCE(d.unit_label, '') AS unit_label,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
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
			ContainerID:         row.ContainerID,
			ContainerNo:         row.ContainerNo,
			ContainerType:       coalesceContainerType(row.ContainerType),
			HandlingMode:        coalesceInboundHandlingMode(row.HandlingMode),
			StorageSection:      fallbackSection(row.StorageSection),
			UnitLabel:           row.UnitLabel,
			DocumentNote:        row.DocumentNote,
			Status:              normalizeDocumentStatus(row.Status),
			TrackingStatus:      normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:         row.ConfirmedAt,
			DeletedAt:           row.DeletedAt,
			ArchivedAt:          row.ArchivedAt,
			CreatedAt:           row.CreatedAt,
			UpdatedAt:           row.UpdatedAt,
			Lines:               make([]InboundDocumentLine, 0),
			Attachments:         make([]DocumentAttachment, 0),
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

	if err := s.attachDocumentAttachments(ctx, DocumentAttachmentInbound, documentIDs, func(documentID int64, attachments []DocumentAttachment) {
		if document := documentsByID[documentID]; document != nil {
			document.Attachments = attachments
		}
	}); err != nil {
		return nil, err
	}

	return documents, nil
}

func (s *Store) findOrCreateInboundItem(ctx context.Context, tx *sql.Tx, documentInput CreateInboundDocumentInput, line CreateInboundDocumentLineInput, deliveryDate *time.Time) (int64, string, error) {
	normalizedSection := fallbackSection(firstNonEmpty(line.StorageSection, documentInput.StorageSection))
	normalizedContainerNo := strings.TrimSpace(documentInput.ContainerNo)
	containerID := documentInput.ContainerID
	if strings.TrimSpace(line.Description) == "" {
		return 0, "", fmt.Errorf("%w: description is required for new inbound sku rows", ErrInvalidInput)
	}
	if containerID <= 0 {
		var err error
		containerID, err = s.ensureContainerRecordTx(
			ctx,
			tx,
			documentInput.CustomerID,
			0,
			documentInput.LocationID,
			normalizedContainerNo,
			documentInput.ContainerType,
			documentInput.HandlingMode,
			"IN_STOCK",
			"RECEIVED",
			deliveryDate,
		)
		if err != nil {
			return 0, "", err
		}
	}
	if err := s.syncContainerNumberTx(ctx, tx, containerID, documentInput.CustomerID, documentInput.LocationID, normalizedContainerNo); err != nil {
		return 0, "", err
	}

	itemInput := sanitizeItemInput(CreateItemInput{
		SKU:            line.SKU,
		Name:           firstNonEmpty(line.Description, line.SKU),
		Category:       "General",
		Description:    line.Description,
		Unit:           strings.ToLower(firstNonEmpty(documentInput.UnitLabel, "CTN")),
		Quantity:       0,
		CustomerID:     documentInput.CustomerID,
		LocationID:     documentInput.LocationID,
		StorageSection: firstNonEmpty(line.StorageSection, documentInput.StorageSection),
		DeliveryDate:   safeDateInput(deliveryDate),
		ContainerID:    containerID,
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
			AND COALESCE(container_id, 0) = ?
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
		containerID,
	}
	err = tx.QueryRowContext(ctx, matchByContainerQuery, matchByContainerArgs...).Scan(&itemID)
	if err == nil {
		if err := s.syncInboundItemSnapshotTx(ctx, tx, itemID, itemInput, normalizedSection, containerID, normalizedContainerNo, deliveryDate); err != nil {
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
				AND COALESCE(container_id, 0) = 0
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
			if err := s.syncInboundItemSnapshotTx(ctx, tx, itemID, itemInput, normalizedSection, containerID, normalizedContainerNo, deliveryDate); err != nil {
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
			container_id,
			container_no,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`,
		skuMasterID,
		itemInput.CustomerID,
		itemInput.LocationID,
		itemInput.StorageSection,
		nullableTime(deliveryDate),
		containerID,
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

func (s *Store) syncInboundItemSnapshotTx(ctx context.Context, tx *sql.Tx, itemID int64, itemInput CreateItemInput, storageSection string, containerID int64, containerNo string, deliveryDate *time.Time) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			storage_section = ?,
			container_id = ?,
			container_no = ?,
			delivery_date = COALESCE(?, delivery_date),
			last_restocked_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		fallbackSection(storageSection),
		containerID,
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
	input.ContainerType = strings.TrimSpace(strings.ToUpper(input.ContainerType))
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
	if err := validateContainerType(input.ContainerType); err != nil {
		return err
	}
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
		case line.ExpectedQty < 0 || line.ReceivedQty < 0 || line.Pallets < 0:
			return fmt.Errorf("%w: quantities cannot be negative", ErrInvalidInput)
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
