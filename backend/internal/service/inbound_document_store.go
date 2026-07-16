package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type InboundDocument struct {
	ID                    int64                 `json:"id"`
	CustomerID            int64                 `json:"customerId"`
	CustomerName          string                `json:"customerName"`
	LocationID            int64                 `json:"locationId"`
	LocationName          string                `json:"locationName"`
	ExpectedArrivalDate   *time.Time            `json:"expectedArrivalDate"`
	ActualArrivalDate     *time.Time            `json:"actualArrivalDate"`
	ContainerNo           string                `json:"containerNo"`
	ContainerType         string                `json:"containerType"`
	HandlingMode          string                `json:"handlingMode"`
	StorageSection        string                `json:"storageSection"`
	UnitLabel             string                `json:"unitLabel"`
	DocumentNote          string                `json:"documentNote"`
	Status                string                `json:"status"`
	TrackingStatus        string                `json:"trackingStatus"`
	ConfirmedAt           *time.Time            `json:"confirmedAt"`
	DeletedAt             *time.Time            `json:"deletedAt"`
	ArchivedAt            *time.Time            `json:"archivedAt"`
	CorrectsDocumentID    *int64                `json:"correctsDocumentId"`
	CorrectedByDocumentID *int64                `json:"correctedByDocumentId"`
	CorrectedAt           *time.Time            `json:"correctedAt"`
	TotalLines            int                   `json:"totalLines"`
	TotalExpectedQty      int                   `json:"totalExpectedQty"`
	TotalReceivedQty      int                   `json:"totalReceivedQty"`
	CreatedAt             time.Time             `json:"createdAt"`
	UpdatedAt             time.Time             `json:"updatedAt"`
	Lines                 []InboundDocumentLine `json:"lines"`
	Attachments           []DocumentAttachment  `json:"attachments"`
}

type InboundDocumentLine struct {
	ID                int64                    `json:"id"`
	DocumentID        int64                    `json:"documentId"`
	ItemNumber        string                   `json:"itemNumber"`
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
	ContainerType       string                           `json:"containerType"`
	HandlingMode        string                           `json:"handlingMode"`
	StorageSection      string                           `json:"storageSection"`
	UnitLabel           string                           `json:"unitLabel"`
	Status              string                           `json:"status"`
	TrackingStatus      string                           `json:"trackingStatus"`
	DocumentNote        string                           `json:"documentNote"`
	Lines               []CreateInboundDocumentLineInput `json:"lines"`
	ImportKey           string                           `json:"-"`
	ImportPayloadHash   string                           `json:"-"`
}

type UpdateInboundDocumentNoteInput struct {
	DocumentNote string `json:"documentNote"`
}

type UpdateInboundDocumentContainerTypeInput struct {
	ContainerType string `json:"containerType"`
}

type CreateInboundDocumentLineInput struct {
	ItemNumber        string                   `json:"itemNumber"`
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
	ID                    int64      `db:"id"`
	CustomerID            int64      `db:"customer_id"`
	CustomerName          string     `db:"customer_name"`
	LocationID            int64      `db:"location_id"`
	LocationName          string     `db:"location_name"`
	ExpectedArrivalDate   *time.Time `db:"expected_arrival_date"`
	ActualArrivalDate     *time.Time `db:"actual_arrival_date"`
	ContainerNo           string     `db:"container_no"`
	ContainerType         string     `db:"container_type"`
	HandlingMode          string     `db:"handling_mode"`
	StorageSection        string     `db:"storage_section"`
	UnitLabel             string     `db:"unit_label"`
	DocumentNote          string     `db:"document_note"`
	Status                string     `db:"status"`
	TrackingStatus        string     `db:"tracking_status"`
	ConfirmedAt           *time.Time `db:"confirmed_at"`
	DeletedAt             *time.Time `db:"cancelled_at"`
	ArchivedAt            *time.Time `db:"archived_at"`
	CorrectsDocumentID    *int64     `db:"corrects_document_id"`
	CorrectedByDocumentID *int64     `db:"corrected_by_document_id"`
	CorrectedAt           *time.Time `db:"corrected_at"`
	CreatedAt             time.Time  `db:"created_at"`
	UpdatedAt             time.Time  `db:"updated_at"`
}

type inboundDocumentLineRow struct {
	ID                  int64     `db:"id"`
	DocumentID          int64     `db:"document_id"`
	ItemNumber          string    `db:"item_number"`
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

type InboundDocumentFilters struct {
	ArchiveScope    string
	Search          string
	CustomerID      int64
	LocationID      int64
	Status          string
	TrackingStatus  string
	OperationalOnly bool
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

	whereClauses := []string{
		buildDocumentArchiveFilterClause("d", filters.ArchiveScope),
		"UPPER(TRIM(d.status)) NOT IN ('DELETED', 'CANCELLED')",
	}
	args := make([]any, 0, 16)
	if filters.OperationalOnly {
		whereClauses = append(whereClauses,
			"d.corrected_at IS NULL",
			"NOT (d.corrects_document_id IS NOT NULL AND UPPER(TRIM(d.status)) = 'DRAFT')",
		)
	}
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "d.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if filters.LocationID > 0 {
		whereClauses = append(whereClauses, "d.location_id = ?")
		args = append(args, filters.LocationID)
	}
	if statusFilterClause, statusArgs := buildDocumentStatusFilterClause("d", filters.Status); statusFilterClause != "" {
		whereClauses = append(whereClauses, statusFilterClause)
		args = append(args, statusArgs...)
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
						OR EXISTS (
							SELECT 1
							FROM sku_master sm
							WHERE sm.sku = il.sku_snapshot
								AND LOWER(COALESCE(sm.item_number, '')) LIKE ?
						)
						OR LOWER(COALESCE(il.description_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(il.storage_section, '')) LIKE ?
						OR LOWER(COALESCE(il.pallets_detail_ctns, '')) LIKE ?
						OR LOWER(COALESCE(il.pallet_breakdown_json, '')) LIKE ?
						OR LOWER(COALESCE(il.line_note, '')) LIKE ?
					)
			)
		)`)
		for range 13 {
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
			d.corrects_document_id,
			d.corrected_by_document_id,
			d.corrected_at,
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
			ID:                    row.ID,
			CustomerID:            row.CustomerID,
			CustomerName:          row.CustomerName,
			LocationID:            row.LocationID,
			LocationName:          row.LocationName,
			ExpectedArrivalDate:   row.ExpectedArrivalDate,
			ActualArrivalDate:     row.ActualArrivalDate,
			ContainerNo:           row.ContainerNo,
			ContainerType:         coalesceContainerType(row.ContainerType),
			HandlingMode:          coalesceInboundHandlingMode(row.HandlingMode),
			StorageSection:        fallbackSection(row.StorageSection),
			UnitLabel:             row.UnitLabel,
			DocumentNote:          row.DocumentNote,
			Status:                normalizeDocumentStatus(row.Status),
			TrackingStatus:        normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:           row.ConfirmedAt,
			DeletedAt:             row.DeletedAt,
			ArchivedAt:            row.ArchivedAt,
			CorrectsDocumentID:    row.CorrectsDocumentID,
			CorrectedByDocumentID: row.CorrectedByDocumentID,
			CorrectedAt:           row.CorrectedAt,
			CreatedAt:             row.CreatedAt,
			UpdatedAt:             row.UpdatedAt,
			Lines:                 make([]InboundDocumentLine, 0),
			Attachments:           make([]DocumentAttachment, 0),
		}
		documents = append(documents, document)
		documentIDs = append(documentIDs, row.ID)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			document_id,
			COALESCE((
				SELECT COALESCE(cic.item_number, sm.item_number)
				FROM sku_master sm
				JOIN inbound_documents parent_d ON parent_d.id = il.document_id
				LEFT JOIN customer_item_catalog cic ON cic.customer_id = parent_d.customer_id AND cic.sku_master_id = sm.id
				WHERE sm.sku = il.sku_snapshot
				LIMIT 1
			), '') AS item_number,
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
		FROM inbound_document_lines il
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
			ItemNumber:        lineRow.ItemNumber,
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

	if err := s.attachInboundDocumentAttachments(ctx, documentsByID); err != nil {
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
	if err := s.upsertInboundLineItemCodesTx(ctx, tx, input); err != nil {
		return InboundDocument{}, err
	}

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
			container_type,
			handling_mode,
			storage_section,
			unit_label,
			document_note,
			import_key,
			import_payload_hash,
			status,
			tracking_status,
			confirmed_at,
			posted_at,
			cancel_note,
			cancelled_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
	`,
		input.CustomerID,
		input.LocationID,
		nullableTime(expectedArrivalDate),
		nullableTime(actualArrivalDate),
		nullableString(input.ContainerNo),
		coalesceContainerType(input.ContainerType),
		coalesceInboundHandlingMode(input.HandlingMode),
		fallbackSection(input.StorageSection),
		nullableString(input.UnitLabel),
		nullableString(input.DocumentNote),
		nullableString(input.ImportKey),
		nullableString(input.ImportPayloadHash),
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
	if err := s.upsertInboundLineItemCodesTx(ctx, tx, input); err != nil {
		return InboundDocument{}, err
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

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if err := validateInboundDocumentCorrectionSourceMutable(documentRow); err != nil {
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

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if err := validateInboundDocumentCorrectionSourceMutable(documentRow); err != nil {
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

func validateInboundDocumentCorrectionSourceMutable(documentRow inboundDocumentRow) error {
	return validateInboundCorrectionSourceMutable(documentRow.CorrectedByDocumentID != nil, documentRow.CorrectedAt != nil)
}

func validateInboundCorrectionSourceMutable(hasCorrectionDraft bool, hasBeenCorrected bool) error {
	if hasBeenCorrected {
		return fmt.Errorf("%w: corrected receipt is read-only; edit the active correction receipt instead", ErrInvalidInput)
	}
	if hasCorrectionDraft {
		return fmt.Errorf("%w: receipt has an open correction draft; edit the correction draft instead", ErrInvalidInput)
	}
	return nil
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

const MaxBulkUpdateInboundDocuments = 100

type BulkUpdateInboundDocumentStatusInput struct {
	DocumentIDs []int64 `json:"documentIds"`
	Status      string  `json:"status"`
}

type BulkUpdateInboundDocumentStatusResponse struct {
	UpdatedDocuments int               `json:"updatedDocuments"`
	Status           string            `json:"status"`
	Documents        []InboundDocument `json:"documents"`
}

func (s *Store) BulkUpdateInboundDocumentStatus(ctx context.Context, input BulkUpdateInboundDocumentStatusInput) (BulkUpdateInboundDocumentStatusResponse, error) {
	targetStatus := strings.TrimSpace(strings.ToUpper(input.Status))
	if targetStatus != DocumentStatusConfirmed && targetStatus != DocumentStatusDeleted {
		return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("%w: bulk receipt status must be confirmed or deleted", ErrInvalidInput)
	}
	if len(input.DocumentIDs) == 0 || len(input.DocumentIDs) > MaxBulkUpdateInboundDocuments {
		return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("%w: between 1 and %d receipt IDs are required", ErrInvalidInput, MaxBulkUpdateInboundDocuments)
	}

	documentIDs := append([]int64(nil), input.DocumentIDs...)
	sort.Slice(documentIDs, func(left, right int) bool { return documentIDs[left] < documentIDs[right] })
	for index, documentID := range documentIDs {
		if documentID <= 0 {
			return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("%w: receipt IDs must be positive", ErrInvalidInput)
		}
		if index > 0 && documentID == documentIDs[index-1] {
			return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("%w: duplicate receipt ID %d", ErrInvalidInput, documentID)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("begin inbound bulk status transaction: %w", err)
	}
	defer tx.Rollback()

	for _, documentID := range documentIDs {
		if targetStatus == DocumentStatusConfirmed {
			if err := s.confirmInboundDocumentTx(ctx, tx, documentID); err != nil {
				return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("confirm receipt %d: %w", documentID, err)
			}
		} else if _, err := s.deleteInboundDocumentTx(ctx, tx, documentID); err != nil {
			return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("delete receipt %d: %w", documentID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return BulkUpdateInboundDocumentStatusResponse{}, fmt.Errorf("commit inbound bulk status: %w", err)
	}

	response := BulkUpdateInboundDocumentStatusResponse{
		UpdatedDocuments: len(documentIDs),
		Status:           targetStatus,
		Documents:        make([]InboundDocument, 0, len(documentIDs)),
	}
	for _, documentID := range documentIDs {
		document, err := s.getInboundDocument(ctx, documentID)
		if err != nil {
			return BulkUpdateInboundDocumentStatusResponse{}, err
		}
		response.Documents = append(response.Documents, document)
	}
	return response, nil
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
	correctedSourceDocumentID := int64(0)
	if documentRow.CorrectsDocumentID != nil {
		correctedSource, err := s.loadInboundDocumentForUpdateTx(ctx, tx, *documentRow.CorrectsDocumentID)
		if err != nil {
			return err
		}
		if normalizeDocumentStatus(correctedSource.Status) != DocumentStatusConfirmed || correctedSource.CorrectedAt != nil {
			return fmt.Errorf("%w: source receipt is no longer available for correction", ErrInvalidInput)
		}
		if correctedSource.CorrectedByDocumentID == nil || *correctedSource.CorrectedByDocumentID != documentID {
			return fmt.Errorf("%w: correction draft is not linked to the source receipt", ErrInvalidInput)
		}
		if err := s.ensureInboundCorrectionHasNoLaterContainerActivityTx(ctx, tx, correctedSource, true); err != nil {
			return err
		}
		correctionReversalAt := firstNonEmptyTime(
			correctedSource.ActualArrivalDate,
			correctedSource.ConfirmedAt,
			correctedSource.ExpectedArrivalDate,
			&confirmedAt,
		)
		if err := s.reverseConfirmedInboundInventoryTx(
			ctx,
			tx,
			correctedSource,
			*correctionReversalAt,
			fmt.Sprintf("Inbound receipt corrected by receipt #%d", documentID),
		); err != nil {
			return err
		}
		if err := retireCorrectedSourceContainerTx(ctx, tx, correctedSource, documentRow, confirmedAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM container_visits WHERE inbound_document_id = ?`, correctedSource.ID); err != nil {
			return mapDBError(fmt.Errorf("replace corrected inbound container visit: %w", err))
		}
		correctedSourceDocumentID = correctedSource.ID
	}
	documentRow.ConfirmedAt = &confirmedAt
	if _, err := ensureContainerVisitForInboundDocumentTx(ctx, tx, documentRow); err != nil {
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
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventReceive,
			OccurredAt:          firstNonEmptyTime(documentRow.ActualArrivalDate, &confirmedAt),
			SKUMasterID:         skuMasterID,
			CustomerID:          documentRow.CustomerID,
			LocationID:          documentRow.LocationID,
			StorageSection:      lotSection,
			QuantityChange:      receivedQty,
			PalletChange:        float64(lineRow.Pallets),
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentID,
			SourceLineID:        lineRow.ID,
			ContainerNo:         lotContainer,
			DeliveryDate:        firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate),
			ItemNumber:          firstNonEmpty(lineRow.ItemNumber, lineRow.SKUSnapshot),
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
	if correctedSourceDocumentID > 0 {
		result, err := tx.ExecContext(ctx, `
			UPDATE inbound_documents
			SET corrected_at = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ? AND corrected_by_document_id = ? AND corrected_at IS NULL
		`, confirmedAt, correctedSourceDocumentID, documentID)
		if err != nil {
			return mapDBError(fmt.Errorf("complete inbound correction link: %w", err))
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("resolve completed inbound correction link: %w", err)
		}
		if rowsAffected != 1 {
			return fmt.Errorf("%w: source receipt correction state changed", ErrInvalidInput)
		}
	}

	return nil
}

type inboundReceiptBalanceRow struct {
	SKUMasterID    int64
	LocationID     int64
	StorageSection string
	ContainerNo    string
	Quantity       int
	Pallets        int
	ItemNumber     string
	Description    string
}

func (s *Store) reverseConfirmedInboundInventoryTx(ctx context.Context, tx *sql.Tx, documentRow inboundDocumentRow, reversedAt time.Time, reason string) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			COALESCE(sl.sku_master_id, 0),
			sl.location_id,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP'),
			COALESCE(sl.container_no_snapshot, ''),
			SUM(sl.quantity_change),
			ROUND(SUM(sl.pallet_change)),
			COALESCE(MAX(sl.item_number_snapshot), ''),
			COALESCE(MAX(sl.description_snapshot), '')
		FROM stock_ledger sl
		WHERE sl.source_document_type = ?
		  AND sl.source_document_id = ?
		  AND sl.event_type = ?
		GROUP BY
			sl.sku_master_id,
			sl.location_id,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP'),
			COALESCE(sl.container_no_snapshot, '')
		FOR UPDATE
	`, StockLedgerSourceInbound, documentRow.ID, StockLedgerEventReceive)
	if err != nil {
		return mapDBError(fmt.Errorf("load confirmed receipt balances: %w", err))
	}
	defer rows.Close()

	balances := make([]inboundReceiptBalanceRow, 0)
	for rows.Next() {
		var balance inboundReceiptBalanceRow
		if err := rows.Scan(
			&balance.SKUMasterID,
			&balance.LocationID,
			&balance.StorageSection,
			&balance.ContainerNo,
			&balance.Quantity,
			&balance.Pallets,
			&balance.ItemNumber,
			&balance.Description,
		); err != nil {
			return fmt.Errorf("scan confirmed receipt balance: %w", err)
		}
		if balance.SKUMasterID <= 0 || balance.Quantity < 0 || balance.Pallets < 0 {
			return fmt.Errorf("%w: receipt inventory history is incomplete", ErrInvalidInput)
		}
		balances = append(balances, balance)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate confirmed receipt balances: %w", err)
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "Inbound receipt reversed"
	}

	for _, balance := range balances {
		var available struct {
			Quantity int
			Pallets  int
		}
		if err := tx.QueryRowContext(ctx, `
			SELECT
				GREATEST(quantity - allocated_qty - damaged_qty - hold_qty, 0),
				GREATEST(pallets - allocated_pallets, 0)
			FROM inventory_items
			WHERE sku_master_id = ?
			  AND customer_id = ?
			  AND location_id = ?
			  AND storage_section = ?
			  AND container_no = ?
			FOR UPDATE
		`, balance.SKUMasterID, documentRow.CustomerID, balance.LocationID, fallbackSection(balance.StorageSection), normalizeContainerNo(balance.ContainerNo)).Scan(&available.Quantity, &available.Pallets); err != nil {
			if err == sql.ErrNoRows {
				return fmt.Errorf("%w: receipt inventory has already moved or shipped", ErrInvalidInput)
			}
			return mapDBError(fmt.Errorf("load cancellable receipt inventory: %w", err))
		}
		if available.Quantity < balance.Quantity || available.Pallets < balance.Pallets {
			return fmt.Errorf("%w: receipt inventory has already moved, shipped, reserved, damaged, or held", ErrInvalidInput)
		}
		if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
			EventType:           StockLedgerEventAdjust,
			OccurredAt:          &reversedAt,
			SKUMasterID:         balance.SKUMasterID,
			CustomerID:          documentRow.CustomerID,
			LocationID:          balance.LocationID,
			StorageSection:      balance.StorageSection,
			QuantityChange:      -balance.Quantity,
			PalletChange:        -float64(balance.Pallets),
			SourceDocumentType:  StockLedgerSourceInbound,
			SourceDocumentID:    documentRow.ID,
			ContainerNo:         balance.ContainerNo,
			ItemNumber:          balance.ItemNumber,
			DescriptionSnapshot: balance.Description,
			Reason:              reason,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ensureInboundCorrectionHasNoLaterContainerActivityTx(
	ctx context.Context,
	tx *sql.Tx,
	documentRow inboundDocumentRow,
	lockInventory bool,
) error {
	containerNo := normalizeContainerNo(documentRow.ContainerNo)
	if containerNo == "" {
		return fmt.Errorf("%w: container number is required for receipt correction; use manual inventory adjustments instead", ErrInvalidInput)
	}

	if lockInventory {
		rows, err := tx.QueryContext(ctx, `
			SELECT id
			FROM inventory_items
			WHERE customer_id = ?
			  AND UPPER(TRIM(COALESCE(container_no, ''))) = ?
			ORDER BY id ASC
			FOR UPDATE
		`, documentRow.CustomerID, containerNo)
		if err != nil {
			return mapDBError(fmt.Errorf("lock corrected container inventory: %w", err))
		}
		for rows.Next() {
			var itemID int64
			if err := rows.Scan(&itemID); err != nil {
				rows.Close()
				return fmt.Errorf("scan corrected container inventory lock: %w", err)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate corrected container inventory locks: %w", err)
		}
		if err := rows.Close(); err != nil {
			return fmt.Errorf("close corrected container inventory locks: %w", err)
		}
	}

	var lastReceiptLedgerID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
		SELECT MAX(id)
		FROM stock_ledger
		WHERE source_document_type = ?
		  AND source_document_id = ?
		  AND event_type = ?
	`, StockLedgerSourceInbound, documentRow.ID, StockLedgerEventReceive).Scan(&lastReceiptLedgerID); err != nil {
		return mapDBError(fmt.Errorf("load corrected receipt activity boundary: %w", err))
	}
	if !lastReceiptLedgerID.Valid || lastReceiptLedgerID.Int64 <= 0 {
		return fmt.Errorf("%w: receipt inventory history is incomplete", ErrInvalidInput)
	}

	var hasLaterActivity bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM stock_ledger later
			WHERE later.id > ?
			  AND later.customer_id = ?
			  AND UPPER(TRIM(COALESCE(later.container_no_snapshot, ''))) = ?
		)
	`, lastReceiptLedgerID.Int64, documentRow.CustomerID, containerNo).Scan(&hasLaterActivity); err != nil {
		return mapDBError(fmt.Errorf("check corrected container activity: %w", err))
	}
	if hasLaterActivity {
		return fmt.Errorf("%w: container has later inventory activity; manually correct this receipt and every later activity instead of using automatic receipt correction", ErrInvalidInput)
	}
	return nil
}

func retireCorrectedSourceContainerTx(ctx context.Context, tx *sql.Tx, source inboundDocumentRow, replacement inboundDocumentRow, correctedAt time.Time) error {
	sourceContainerNo := normalizeContainerNo(source.ContainerNo)
	replacementContainerNo := normalizeContainerNo(replacement.ContainerNo)
	if sourceContainerNo == "" || (source.CustomerID == replacement.CustomerID && sourceContainerNo == replacementContainerNo) {
		return nil
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE containers
		SET
			status = ?,
			tracking_status = ?,
			last_event_at = GREATEST(COALESCE(last_event_at, ?), ?),
			updated_at = CURRENT_TIMESTAMP
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
		  AND inbound_document_id = ?
		  AND NOT EXISTS (
			SELECT 1
			FROM inventory_items remaining
			WHERE remaining.customer_id = containers.customer_id
			  AND UPPER(TRIM(remaining.container_no)) = UPPER(TRIM(containers.container_no))
			  AND (remaining.quantity > 0 OR remaining.pallets > 0)
		  )
	`,
		ContainerStatusCorrected,
		ContainerStatusCorrected,
		correctedAt,
		correctedAt,
		source.CustomerID,
		sourceContainerNo,
		source.ID,
	); err != nil {
		return mapDBError(fmt.Errorf("retire corrected source container: %w", err))
	}
	return nil
}

func (s *Store) CancelInboundDocument(ctx context.Context, documentID int64) (InboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound cancel transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := s.deleteInboundDocumentTx(ctx, tx, documentID); err != nil {
		return InboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound cancel: %w", err)
	}

	return s.getInboundDocument(ctx, documentID)
}

func (s *Store) deleteInboundDocumentTx(ctx context.Context, tx *sql.Tx, documentID int64) (time.Time, error) {
	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return time.Time{}, err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusDeleted {
		return time.Time{}, fmt.Errorf("%w: inbound document is already deleted", ErrInvalidInput)
	}
	if documentRow.CorrectedAt != nil {
		return time.Time{}, fmt.Errorf("%w: corrected receipt must remain available for audit", ErrInvalidInput)
	}
	if documentRow.CorrectedByDocumentID != nil {
		return time.Time{}, fmt.Errorf("%w: receipt has an open correction draft", ErrInvalidInput)
	}
	if documentRow.CorrectsDocumentID != nil && status == DocumentStatusConfirmed {
		return time.Time{}, fmt.Errorf("%w: confirmed correction receipts must be corrected with a new draft", ErrInvalidInput)
	}

	deletedAt := time.Now().UTC()
	if status == DocumentStatusConfirmed {
		if err := s.ensureInboundCorrectionHasNoLaterContainerActivityTx(ctx, tx, documentRow, true); err != nil {
			return time.Time{}, err
		}
		if err := s.reverseConfirmedInboundInventoryTx(ctx, tx, documentRow, deletedAt, "Inbound receipt deleted"); err != nil {
			return time.Time{}, err
		}
	}
	if documentRow.CorrectsDocumentID != nil {
		if _, err := tx.ExecContext(ctx, `
			UPDATE inbound_documents
			SET corrected_by_document_id = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE id = ? AND corrected_by_document_id = ? AND corrected_at IS NULL
		`, *documentRow.CorrectsDocumentID, documentID); err != nil {
			return time.Time{}, mapDBError(fmt.Errorf("release inbound correction draft: %w", err))
		}
	}
	if err := markDocumentAttachmentsDeletedForDocument(ctx, tx, DocumentAttachmentInbound, documentID); err != nil {
		return time.Time{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM container_visits WHERE inbound_document_id = ?`, documentID); err != nil {
		return time.Time{}, mapDBError(fmt.Errorf("delete inbound container visit: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET
			status = ?,
			cancelled_at = ?,
			archived_at = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, DocumentStatusDeleted, deletedAt, documentID); err != nil {
		return time.Time{}, mapDBError(fmt.Errorf("mark inbound document deleted: %w", err))
	}
	return deletedAt, nil
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
	if documentRow.CorrectsDocumentID != nil || documentRow.CorrectedByDocumentID != nil || documentRow.CorrectedAt != nil {
		return InboundDocument{}, fmt.Errorf("%w: receipts in a correction workflow cannot be archived", ErrInvalidInput)
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
	newDocumentID, err := s.cloneInboundDocumentTx(ctx, tx, documentRow, lineRows, nil)
	if err != nil {
		return InboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound copy: %w", err)
	}

	return s.getInboundDocument(ctx, newDocumentID)
}

func (s *Store) CreateInboundCorrectionDraft(ctx context.Context, documentID int64) (InboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDocument{}, fmt.Errorf("begin inbound correction transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if normalizeDocumentStatus(documentRow.Status) != DocumentStatusConfirmed {
		return InboundDocument{}, fmt.Errorf("%w: only confirmed receipts can be corrected", ErrInvalidInput)
	}
	if documentRow.CorrectedAt != nil {
		return InboundDocument{}, fmt.Errorf("%w: receipt has already been corrected", ErrInvalidInput)
	}
	if documentRow.CorrectedByDocumentID != nil {
		return InboundDocument{}, fmt.Errorf("%w: receipt already has an open correction draft", ErrInvalidInput)
	}
	if err := s.ensureInboundCorrectionHasNoLaterContainerActivityTx(ctx, tx, documentRow, false); err != nil {
		return InboundDocument{}, err
	}

	lineRows, err := s.loadInboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	newDocumentID, err := s.cloneInboundDocumentTx(ctx, tx, documentRow, lineRows, &documentID)
	if err != nil {
		return InboundDocument{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inbound_documents
		SET corrected_by_document_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, newDocumentID, documentID); err != nil {
		return InboundDocument{}, mapDBError(fmt.Errorf("link inbound correction draft: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return InboundDocument{}, fmt.Errorf("commit inbound correction draft: %w", err)
	}

	return s.getInboundDocument(ctx, newDocumentID)
}

func (s *Store) cloneInboundDocumentTx(
	ctx context.Context,
	tx *sql.Tx,
	documentRow inboundDocumentRow,
	lineRows []inboundDocumentLineRow,
	correctsDocumentID *int64,
) (int64, error) {
	if len(lineRows) == 0 {
		return 0, fmt.Errorf("%w: receipt must contain at least one line", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id,
			location_id,
			expected_arrival_date,
			actual_arrival_date,
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
			archived_at,
			corrects_document_id,
			corrected_by_document_id,
			corrected_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL)
	`,
		documentRow.CustomerID,
		documentRow.LocationID,
		nullableTime(documentRow.ExpectedArrivalDate),
		nullableTime(documentRow.ActualArrivalDate),
		nullableString(documentRow.ContainerNo),
		coalesceContainerType(documentRow.ContainerType),
		coalesceInboundHandlingMode(documentRow.HandlingMode),
		fallbackSection(documentRow.StorageSection),
		nullableString(documentRow.UnitLabel),
		nullableString(documentRow.DocumentNote),
		DocumentStatusDraft,
		InboundTrackingScheduled,
		nullableInt64Ptr(correctsDocumentID),
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("clone inbound document: %w", err))
	}

	newDocumentID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve cloned inbound document id: %w", err)
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
			return 0, mapDBError(fmt.Errorf("clone inbound document line: %w", err))
		}
	}
	return newDocumentID, nil
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
			d.corrects_document_id,
			d.corrected_by_document_id,
			d.corrected_at,
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
		&documentRow.CorrectsDocumentID,
		&documentRow.CorrectedByDocumentID,
		&documentRow.CorrectedAt,
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
			COALESCE((
				SELECT COALESCE(cic.item_number, sm.item_number)
				FROM sku_master sm
				JOIN inbound_documents parent_d ON parent_d.id = il.document_id
				LEFT JOIN customer_item_catalog cic ON cic.customer_id = parent_d.customer_id AND cic.sku_master_id = sm.id
				WHERE sm.sku = il.sku_snapshot
				LIMIT 1
			), '') AS item_number,
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
		FROM inbound_document_lines il
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
			&lineRow.ItemNumber,
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

func (s *Store) GetInboundDocumentForCustomer(ctx context.Context, documentID int64, customerID int64) (InboundDocument, error) {
	if documentID <= 0 || customerID <= 0 {
		return InboundDocument{}, ErrNotFound
	}

	activeDocumentID := documentID
	visited := make(map[int64]bool)
	for activeDocumentID > 0 && !visited[activeDocumentID] {
		visited[activeDocumentID] = true

		var row struct {
			CustomerID            int64
			Status                string
			CorrectsDocumentID    sql.NullInt64
			CorrectedByDocumentID sql.NullInt64
			CorrectedAt           sql.NullTime
		}
		if err := s.db.QueryRowContext(ctx, `
			SELECT
				customer_id,
				status,
				corrects_document_id,
				corrected_by_document_id,
				corrected_at
			FROM inbound_documents
			WHERE id = ?
		`, activeDocumentID).Scan(
			&row.CustomerID,
			&row.Status,
			&row.CorrectsDocumentID,
			&row.CorrectedByDocumentID,
			&row.CorrectedAt,
		); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return InboundDocument{}, ErrNotFound
			}
			return InboundDocument{}, fmt.Errorf("resolve active customer inbound document: %w", err)
		}

		status := normalizeDocumentStatus(row.Status)
		if status == DocumentStatusDeleted || status == "CANCELLED" {
			return InboundDocument{}, ErrNotFound
		}
		if row.CustomerID != customerID {
			return InboundDocument{}, ErrNotFound
		}
		if row.CorrectedAt.Valid {
			if !row.CorrectedByDocumentID.Valid || row.CorrectedByDocumentID.Int64 <= 0 {
				return InboundDocument{}, ErrNotFound
			}
			activeDocumentID = row.CorrectedByDocumentID.Int64
			continue
		}
		if row.CorrectsDocumentID.Valid && status == DocumentStatusDraft {
			return InboundDocument{}, ErrNotFound
		}
		return s.getInboundDocument(ctx, activeDocumentID)
	}

	return InboundDocument{}, ErrNotFound
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
			d.corrects_document_id,
			d.corrected_by_document_id,
			d.corrected_at,
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
			ID:                    row.ID,
			CustomerID:            row.CustomerID,
			CustomerName:          row.CustomerName,
			LocationID:            row.LocationID,
			LocationName:          row.LocationName,
			ExpectedArrivalDate:   row.ExpectedArrivalDate,
			ActualArrivalDate:     row.ActualArrivalDate,
			ContainerNo:           row.ContainerNo,
			ContainerType:         coalesceContainerType(row.ContainerType),
			HandlingMode:          coalesceInboundHandlingMode(row.HandlingMode),
			StorageSection:        fallbackSection(row.StorageSection),
			UnitLabel:             row.UnitLabel,
			DocumentNote:          row.DocumentNote,
			Status:                normalizeDocumentStatus(row.Status),
			TrackingStatus:        normalizeInboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:           row.ConfirmedAt,
			DeletedAt:             row.DeletedAt,
			ArchivedAt:            row.ArchivedAt,
			CorrectsDocumentID:    row.CorrectsDocumentID,
			CorrectedByDocumentID: row.CorrectedByDocumentID,
			CorrectedAt:           row.CorrectedAt,
			CreatedAt:             row.CreatedAt,
			UpdatedAt:             row.UpdatedAt,
			Lines:                 make([]InboundDocumentLine, 0),
			Attachments:           make([]DocumentAttachment, 0),
		}
		documents = append(documents, document)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			document_id,
			COALESCE((
				SELECT COALESCE(cic.item_number, sm.item_number)
				FROM sku_master sm
				JOIN inbound_documents parent_d ON parent_d.id = il.document_id
				LEFT JOIN customer_item_catalog cic ON cic.customer_id = parent_d.customer_id AND cic.sku_master_id = sm.id
				WHERE sm.sku = il.sku_snapshot
				LIMIT 1
			), '') AS item_number,
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
		FROM inbound_document_lines il
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
			ItemNumber:        lineRow.ItemNumber,
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

	if err := s.attachInboundDocumentAttachments(ctx, documentsByID); err != nil {
		return nil, err
	}

	return documents, nil
}

type inboundCorrectionParentRow struct {
	ID                 int64  `db:"id"`
	CustomerID         int64  `db:"customer_id"`
	CorrectsDocumentID *int64 `db:"corrects_document_id"`
}

func (s *Store) attachInboundDocumentAttachments(ctx context.Context, documentsByID map[int64]*InboundDocument) error {
	if len(documentsByID) == 0 {
		return nil
	}

	parentByID := make(map[int64]int64)
	customerByID := make(map[int64]int64, len(documentsByID))
	knownRelationships := make(map[int64]bool, len(documentsByID))
	allDocumentIDs := make(map[int64]bool, len(documentsByID))
	frontier := make([]int64, 0)
	for documentID, document := range documentsByID {
		customerByID[documentID] = document.CustomerID
		knownRelationships[documentID] = true
		allDocumentIDs[documentID] = true
		if document.CorrectsDocumentID != nil {
			parentByID[documentID] = *document.CorrectsDocumentID
			frontier = append(frontier, *document.CorrectsDocumentID)
		}
	}

	for len(frontier) > 0 {
		queryIDs := make([]int64, 0, len(frontier))
		for _, documentID := range frontier {
			allDocumentIDs[documentID] = true
			if knownRelationships[documentID] {
				continue
			}
			knownRelationships[documentID] = true
			queryIDs = append(queryIDs, documentID)
		}
		if len(queryIDs) == 0 {
			break
		}

		query, args, err := sqlx.In(`
			SELECT id, customer_id, corrects_document_id
			FROM inbound_documents
			WHERE id IN (?)
		`, queryIDs)
		if err != nil {
			return fmt.Errorf("build inbound correction attachment query: %w", err)
		}
		rows := make([]inboundCorrectionParentRow, 0, len(queryIDs))
		if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
			return fmt.Errorf("load inbound correction attachment chain: %w", err)
		}

		frontier = frontier[:0]
		for _, row := range rows {
			customerByID[row.ID] = row.CustomerID
			if row.CorrectsDocumentID == nil {
				continue
			}
			parentByID[row.ID] = *row.CorrectsDocumentID
			frontier = append(frontier, *row.CorrectsDocumentID)
		}
	}

	attachmentDocumentIDs := make([]int64, 0, len(allDocumentIDs))
	for documentID := range allDocumentIDs {
		attachmentDocumentIDs = append(attachmentDocumentIDs, documentID)
	}
	attachmentsByDocumentID, err := s.ListDocumentAttachmentsForDocuments(ctx, DocumentAttachmentInbound, attachmentDocumentIDs)
	if err != nil {
		return err
	}

	for documentID, document := range documentsByID {
		attachments := make([]DocumentAttachment, 0)
		visited := make(map[int64]bool)
		for currentID := documentID; currentID > 0 && !visited[currentID]; {
			visited[currentID] = true
			attachments = append(attachments, attachmentsByDocumentID[currentID]...)
			parentID, ok := parentByID[currentID]
			if !ok {
				break
			}
			if customerByID[parentID] != document.CustomerID {
				break
			}
			currentID = parentID
		}
		document.Attachments = attachments
	}
	return nil
}

func (s *Store) upsertInboundLineItemCodesTx(ctx context.Context, tx *sql.Tx, input CreateInboundDocumentInput) error {
	for _, line := range input.Lines {
		if line.ItemNumber == "" {
			continue
		}
		_, err := s.ensureSKUMaster(ctx, tx, sanitizeItemInput(CreateItemInput{
			ItemNumber:  line.ItemNumber,
			SKU:         line.SKU,
			Name:        firstNonEmpty(line.Description, line.SKU),
			Category:    "General",
			Description: firstNonEmpty(line.Description, line.SKU),
			Unit:        strings.ToLower(firstNonEmpty(input.UnitLabel, "CTN")),
			CustomerID:  input.CustomerID,
		}))
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) findOrCreateInboundItem(ctx context.Context, tx *sql.Tx, documentInput CreateInboundDocumentInput, line CreateInboundDocumentLineInput, deliveryDate *time.Time) (int64, string, error) {
	normalizedSection := fallbackSection(firstNonEmpty(line.StorageSection, documentInput.StorageSection))
	normalizedContainerNo := strings.TrimSpace(documentInput.ContainerNo)
	if strings.TrimSpace(line.Description) == "" {
		return 0, "", fmt.Errorf("%w: description is required for new inbound sku rows", ErrInvalidInput)
	}

	itemInput := sanitizeItemInput(CreateItemInput{
		ItemNumber:     line.ItemNumber,
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
	sectionID, err := resolveStorageSectionIDTx(ctx, tx, itemInput.LocationID, itemInput.StorageSection)
	if err != nil {
		return 0, "", err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			location_id,
			section_id,
			storage_section,
			delivery_date,
			container_no,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`,
		skuMasterID,
		itemInput.CustomerID,
		itemInput.LocationID,
		sectionID,
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
	sectionID, err := resolveStorageSectionIDTx(ctx, tx, itemInput.LocationID, storageSection)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			section_id = ?,
			storage_section = ?,
			container_no = ?,
			delivery_date = COALESCE(?, delivery_date),
			last_restocked_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		sectionID,
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
	input.ContainerType = strings.TrimSpace(strings.ToUpper(input.ContainerType))
	input.HandlingMode = strings.TrimSpace(strings.ToUpper(input.HandlingMode))
	input.StorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(input.StorageSection)))
	// Receiving uses cartons as its fixed internal unit. Keep the legacy API and
	// database fields populated for compatibility, but ignore client overrides.
	input.UnitLabel = "CTN"
	input.Status = strings.TrimSpace(strings.ToUpper(input.Status))
	input.TrackingStatus = strings.TrimSpace(strings.ToUpper(input.TrackingStatus))
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)

	lines := make([]CreateInboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.ItemNumber = strings.TrimSpace(strings.ToUpper(line.ItemNumber))
		line.SKU = strings.TrimSpace(strings.ToUpper(line.SKU))
		line.Description = strings.TrimSpace(line.Description)
		// Reorder thresholds are no longer part of the receiving workflow. Keep the
		// persisted column/API field only for backward compatibility.
		line.ReorderLevel = 0
		if line.UnitsPerPallet < 0 {
			line.UnitsPerPallet = 0
		}
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.StorageSection = fallbackSection(strings.TrimSpace(strings.ToUpper(line.StorageSection)))
		line.LineNote = strings.TrimSpace(line.LineNote)
		line.PalletBreakdown = normalizeInboundPalletBreakdown(line.PalletBreakdown)
		if len(line.PalletBreakdown) > 0 {
			if line.Pallets <= 0 {
				line.Pallets = len(line.PalletBreakdown)
			}
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
			if line.Pallets != len(line.PalletBreakdown) {
				return fmt.Errorf("%w: pallet breakdown count must match declared pallets", ErrInvalidInput)
			}
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
		case coalescedStatus == DocumentStatusConfirmed && handlingMode == InboundHandlingModePalletized && line.receivedOrExpectedQty() > 0 && line.Pallets <= 0:
			return fmt.Errorf("%w: confirmed palletized receipts require a pallet count", ErrInvalidInput)
		case coalescedStatus == DocumentStatusConfirmed && line.Pallets > line.receivedOrExpectedQty():
			return fmt.Errorf("%w: pallets cannot exceed received quantity", ErrInvalidInput)
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
