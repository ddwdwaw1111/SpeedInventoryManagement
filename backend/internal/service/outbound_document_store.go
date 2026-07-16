package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type OutboundDocument struct {
	ID                  int64                  `json:"id"`
	PackingListNo       string                 `json:"packingListNo"`
	OrderRef            string                 `json:"orderRef"`
	CustomerID          int64                  `json:"customerId"`
	CustomerName        string                 `json:"customerName"`
	ExpectedShipDate    *time.Time             `json:"expectedShipDate"`
	ActualShipDate      *time.Time             `json:"actualShipDate"`
	ShipToName          string                 `json:"shipToName"`
	ShipToAddress       string                 `json:"shipToAddress"`
	ShipToContact       string                 `json:"shipToContact"`
	CarrierName         string                 `json:"carrierName"`
	DocumentNote        string                 `json:"documentNote"`
	Status              string                 `json:"status"`
	TrackingStatus      string                 `json:"trackingStatus"`
	ConfirmedAt         *time.Time             `json:"confirmedAt"`
	DeletedAt           *time.Time             `json:"deletedAt"`
	ArchivedAt          *time.Time             `json:"archivedAt"`
	TotalLines          int                    `json:"totalLines"`
	TotalQty            int                    `json:"totalQty"`
	TotalNetWeightKgs   float64                `json:"totalNetWeightKgs"`
	TotalGrossWeightKgs float64                `json:"totalGrossWeightKgs"`
	Storages            string                 `json:"storages"`
	Lines               []OutboundDocumentLine `json:"lines"`
	Attachments         []DocumentAttachment   `json:"attachments"`
	CreatedAt           time.Time              `json:"createdAt"`
	UpdatedAt           time.Time              `json:"updatedAt"`
}

type OutboundPickAllocation struct {
	ID             int64     `json:"id"`
	LineID         int64     `json:"lineId"`
	ItemNumber     string    `json:"itemNumber"`
	LocationID     int64     `json:"locationId"`
	LocationName   string    `json:"locationName"`
	StorageSection string    `json:"storageSection"`
	ContainerNo    string    `json:"containerNo"`
	AllocatedQty   int       `json:"allocatedQty"`
	Pallets        int       `json:"pallets"` // Inventory pallets removed from this container balance.
	CreatedAt      time.Time `json:"createdAt"`
}

type OutboundDocumentLine struct {
	ID                int64                    `json:"id"`
	DocumentID        int64                    `json:"documentId"`
	SKUMasterID       int64                    `json:"skuMasterId"`
	ItemNumber        string                   `json:"itemNumber"`
	LocationID        int64                    `json:"locationId"`
	LocationName      string                   `json:"locationName"`
	StorageSection    string                   `json:"storageSection"`
	SKU               string                   `json:"sku"`
	Description       string                   `json:"description"`
	Quantity          int                      `json:"quantity"`
	Pallets           int                      `json:"pallets"` // Repalletized outbound/shipping pallet count.
	PalletsDetailCtns string                   `json:"palletsDetailCtns"`
	UnitLabel         string                   `json:"unitLabel"`
	CartonSizeMM      string                   `json:"cartonSizeMm"`
	NetWeightKgs      float64                  `json:"netWeightKgs"`
	GrossWeightKgs    float64                  `json:"grossWeightKgs"`
	LineNote          string                   `json:"lineNote"`
	PickAllocations   []OutboundPickAllocation `json:"pickAllocations"`
	CreatedAt         time.Time                `json:"createdAt"`
}

type CreateOutboundDocumentInput struct {
	PackingListNo    string                            `json:"packingListNo"`
	OrderRef         string                            `json:"orderRef"`
	ExpectedShipDate string                            `json:"expectedShipDate"`
	ActualShipDate   string                            `json:"actualShipDate"`
	ShipToName       string                            `json:"shipToName"`
	ShipToAddress    string                            `json:"shipToAddress"`
	ShipToContact    string                            `json:"shipToContact"`
	CarrierName      string                            `json:"carrierName"`
	Status           string                            `json:"status"`
	TrackingStatus   string                            `json:"trackingStatus"`
	DocumentNote     string                            `json:"documentNote"`
	Lines            []CreateOutboundDocumentLineInput `json:"lines"`
}

type UpdateOutboundDocumentNoteInput struct {
	DocumentNote string `json:"documentNote"`
}

type CreateOutboundDocumentLineInput struct {
	CustomerID        int64                    `json:"customerId"`
	LocationID        int64                    `json:"locationId"`
	SKUMasterID       int64                    `json:"skuMasterId"`
	Quantity          int                      `json:"quantity"`
	Pallets           int                      `json:"pallets"`
	PalletsDetailCtns string                   `json:"palletsDetailCtns"`
	UnitLabel         string                   `json:"unitLabel"`
	CartonSizeMM      string                   `json:"cartonSizeMm"`
	NetWeightKgs      float64                  `json:"netWeightKgs"`
	GrossWeightKgs    float64                  `json:"grossWeightKgs"`
	LineNote          string                   `json:"lineNote"`
	PickAllocations   []OutboundPickAllocation `json:"pickAllocations"`
}

type outboundDocumentRow struct {
	ID               int64      `db:"id"`
	PackingListNo    string     `db:"packing_list_no"`
	OrderRef         string     `db:"order_ref"`
	CustomerID       int64      `db:"customer_id"`
	CustomerName     string     `db:"customer_name"`
	ExpectedShipDate *time.Time `db:"expected_ship_date"`
	ActualShipDate   *time.Time `db:"actual_ship_date"`
	ShipToName       string     `db:"ship_to_name"`
	ShipToAddress    string     `db:"ship_to_address"`
	ShipToContact    string     `db:"ship_to_contact"`
	CarrierName      string     `db:"carrier_name"`
	DocumentNote     string     `db:"document_note"`
	Status           string     `db:"status"`
	TrackingStatus   string     `db:"tracking_status"`
	ConfirmedAt      *time.Time `db:"confirmed_at"`
	DeletedAt        *time.Time `db:"cancelled_at"`
	ArchivedAt       *time.Time `db:"archived_at"`
	CreatedAt        time.Time  `db:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at"`
}

type outboundDocumentLineRow struct {
	ID                  int64     `db:"id"`
	DocumentID          int64     `db:"document_id"`
	SKUMasterID         int64     `db:"sku_master_id"`
	ItemNumberSnapshot  string    `db:"item_number_snapshot"`
	LocationID          int64     `db:"location_id"`
	LocationName        string    `db:"location_name_snapshot"`
	StorageSection      string    `db:"storage_section"`
	SKUSnapshot         string    `db:"sku_snapshot"`
	DescriptionSnapshot string    `db:"description_snapshot"`
	Quantity            int       `db:"quantity"`
	Pallets             int       `db:"pallets"`
	PalletsDetailCtns   string    `db:"pallets_detail_ctns"`
	UnitLabel           string    `db:"unit_label"`
	CartonSizeMM        string    `db:"carton_size_mm"`
	NetWeightKgs        float64   `db:"net_weight_kgs"`
	GrossWeightKgs      float64   `db:"gross_weight_kgs"`
	LineNote            string    `db:"line_note"`
	PickAllocationsJSON string    `db:"pick_allocations_json"`
	CreatedAt           time.Time `db:"created_at"`
}

type outboundPickAllocationRow struct {
	ID             int64     `db:"id"`
	LineID         int64     `db:"line_id"`
	ItemNumber     string    `db:"item_number"`
	LocationID     int64     `db:"location_id"`
	LocationName   string    `db:"location_name_snapshot"`
	StorageSection string    `db:"storage_section"`
	ContainerNo    string    `db:"container_no_snapshot"`
	AllocatedQty   int       `db:"allocated_qty"`
	Pallets        int       `db:"pallets"`
	CreatedAt      time.Time `db:"created_at"`
}

type outboundContainerAllocationRow struct {
	ID               int64  `db:"id"`
	OutboundLineID   int64  `db:"outbound_line_id"`
	ContainerID      int64  `db:"container_id"`
	ContainerNo      string `db:"container_no"`
	CustomerID       int64  `db:"customer_id"`
	SKUMasterID      int64  `db:"sku_master_id"`
	LocationID       int64  `db:"location_id"`
	StorageSection   string `db:"storage_section"`
	AllocatedQty     int    `db:"allocated_qty"`
	AllocatedPallets int    `db:"allocated_pallets"`
	Status           string `db:"status"`
}

type lockedOutboundSource struct {
	SKUMasterID  int64
	CustomerID   int64
	ItemNumber   string
	LocationID   int64
	LocationName string
	SKU          string
	Description  string
	Unit         string
	Quantity     int
	AvailableQty int
	AllocatedQty int
	DamagedQty   int
	HoldQty      int
}

type outboundAllocationCandidate struct {
	BucketKey      string
	SKUMasterID    int64
	CustomerID     int64
	ItemNumber     string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	SKU            string
	Description    string
	Unit           string
	AvailableQty   int
	AllocatedQty   int
	Pallets        int
	SortAt         time.Time
}

type outboundAllocationReservationState struct {
	ByBucketKey map[string]int
}

type lockedOutboundSourceRow struct {
	BucketKey      string
	SKUMasterID    int64
	CustomerID     int64
	ItemNumber     string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	SKU            string
	Description    string
	Unit           string
	AvailableQty   int
	DeliveryDate   *time.Time
	CreatedAt      time.Time
}

type OutboundDocumentFilters struct {
	ArchiveScope   string
	Search         string
	CustomerID     int64
	LocationID     int64
	Status         string
	TrackingStatus string
}

func (s *Store) ListOutboundDocuments(ctx context.Context, limit int, archiveScope ...string) ([]OutboundDocument, error) {
	filters := OutboundDocumentFilters{ArchiveScope: DocumentArchiveScopeActive}
	if len(archiveScope) > 0 {
		filters.ArchiveScope = archiveScope[0]
	}
	return s.ListOutboundDocumentsFiltered(ctx, limit, filters)
}

func (s *Store) ListOutboundDocumentsFiltered(ctx context.Context, limit int, filters OutboundDocumentFilters) ([]OutboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}

	whereClauses := []string{buildDocumentArchiveFilterClause("d", filters.ArchiveScope)}
	args := make([]any, 0, 20)
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "d.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if filters.LocationID > 0 {
		whereClauses = append(whereClauses, "EXISTS (SELECT 1 FROM outbound_document_lines dl WHERE dl.document_id = d.id AND dl.location_id = ?)")
		args = append(args, filters.LocationID)
	}
	if statusFilterClause, statusArgs := buildDocumentStatusFilterClause("d", filters.Status); statusFilterClause != "" {
		whereClauses = append(whereClauses, statusFilterClause)
		args = append(args, statusArgs...)
	}
	if trackingFilterClause, trackingArgs := buildOutboundTrackingStatusFilterClause("d", filters.TrackingStatus); trackingFilterClause != "" {
		whereClauses = append(whereClauses, trackingFilterClause)
		args = append(args, trackingArgs...)
	}
	if search := strings.TrimSpace(strings.ToLower(filters.Search)); search != "" {
		searchPattern := "%" + search + "%"
		whereClauses = append(whereClauses, `(
			LOWER(COALESCE(d.packing_list_no, '')) LIKE ?
			OR LOWER(COALESCE(d.order_ref, '')) LIKE ?
			OR LOWER(COALESCE(d.ship_to_name, '')) LIKE ?
			OR LOWER(COALESCE(d.ship_to_address, '')) LIKE ?
			OR LOWER(COALESCE(d.ship_to_contact, '')) LIKE ?
			OR LOWER(COALESCE(d.carrier_name, '')) LIKE ?
			OR LOWER(COALESCE(d.document_note, '')) LIKE ?
			OR LOWER(COALESCE(d.tracking_status, '')) LIKE ?
			OR LOWER(COALESCE(c.name, '')) LIKE ?
			OR EXISTS (
				SELECT 1
				FROM outbound_document_lines ol
				WHERE ol.document_id = d.id
					AND (
						LOWER(COALESCE(ol.item_number_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(ol.location_name_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(ol.storage_section, '')) LIKE ?
						OR LOWER(COALESCE(ol.sku_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(ol.description_snapshot, '')) LIKE ?
						OR LOWER(COALESCE(ol.pallets_detail_ctns, '')) LIKE ?
						OR LOWER(COALESCE(ol.unit_label, '')) LIKE ?
						OR LOWER(COALESCE(ol.carton_size_mm, '')) LIKE ?
						OR LOWER(COALESCE(ol.line_note, '')) LIKE ?
						OR LOWER(COALESCE(ol.pick_allocations_json, '')) LIKE ?
					)
			)
		)`)
		for range 19 {
			args = append(args, searchPattern)
		}
	}
	args = append(args, limit)

	documentRows := make([]outboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, fmt.Sprintf(`
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.expected_ship_date,
			d.actual_ship_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE %s
		ORDER BY COALESCE(d.actual_ship_date, d.expected_ship_date, d.created_at) DESC, d.id DESC
		LIMIT ?
	`, strings.Join(whereClauses, " AND ")), args...); err != nil {
		return nil, fmt.Errorf("load outbound documents: %w", err)
	}

	if len(documentRows) == 0 {
		return []OutboundDocument{}, nil
	}

	documentIDs := make([]int64, 0, len(documentRows))
	documentsByID := make(map[int64]*OutboundDocument, len(documentRows))
	documents := make([]OutboundDocument, 0, len(documentRows))
	linesByID := make(map[int64]*OutboundDocumentLine)
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:               row.ID,
			PackingListNo:    row.PackingListNo,
			OrderRef:         row.OrderRef,
			CustomerID:       row.CustomerID,
			CustomerName:     row.CustomerName,
			ExpectedShipDate: row.ExpectedShipDate,
			ActualShipDate:   row.ActualShipDate,
			ShipToName:       row.ShipToName,
			ShipToAddress:    row.ShipToAddress,
			ShipToContact:    row.ShipToContact,
			CarrierName:      row.CarrierName,
			DocumentNote:     row.DocumentNote,
			Status:           normalizeDocumentStatus(row.Status),
			TrackingStatus:   normalizeOutboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:      row.ConfirmedAt,
			DeletedAt:        row.DeletedAt,
			ArchivedAt:       row.ArchivedAt,
			Lines:            make([]OutboundDocumentLine, 0),
			Attachments:      make([]DocumentAttachment, 0),
			CreatedAt:        row.CreatedAt,
			UpdatedAt:        row.UpdatedAt,
		}
		documents = append(documents, document)
		documentIDs = append(documentIDs, row.ID)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, args, err := sqlx.In(`
		SELECT
			id,
			document_id,
			sku_master_id,
			COALESCE(item_number_snapshot, '') AS item_number_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			COALESCE(pick_allocations_json, '') AS pick_allocations_json,
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
			ID:                lineRow.ID,
			DocumentID:        lineRow.DocumentID,
			SKUMasterID:       lineRow.SKUMasterID,
			ItemNumber:        lineRow.ItemNumberSnapshot,
			LocationID:        lineRow.LocationID,
			LocationName:      lineRow.LocationName,
			StorageSection:    lineRow.StorageSection,
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			Quantity:          lineRow.Quantity,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			CartonSizeMM:      lineRow.CartonSizeMM,
			NetWeightKgs:      lineRow.NetWeightKgs,
			GrossWeightKgs:    lineRow.GrossWeightKgs,
			LineNote:          lineRow.LineNote,
			PickAllocations:   decodeOutboundDraftPickAllocationsOrEmpty(document.Status, lineRow.ID, lineRow.PickAllocationsJSON),
			CreatedAt:         lineRow.CreatedAt,
		})
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}
	for documentIndex := range documents {
		for lineIndex := range documents[documentIndex].Lines {
			line := &documents[documentIndex].Lines[lineIndex]
			linesByID[line.ID] = line
		}
	}

	if err := s.attachOutboundPickAllocations(ctx, linesByID); err != nil {
		return nil, err
	}
	recalculateOutboundDocumentStorages(documents)

	if err := s.attachDocumentAttachments(ctx, DocumentAttachmentOutbound, documentIDs, func(documentID int64, attachments []DocumentAttachment) {
		if document := documentsByID[documentID]; document != nil {
			document.Attachments = attachments
		}
	}); err != nil {
		return nil, err
	}

	return documents, nil
}

func (s *Store) GetOutboundDocumentForCustomer(ctx context.Context, documentID int64, customerID int64) (OutboundDocument, error) {
	if documentID <= 0 || customerID <= 0 {
		return OutboundDocument{}, ErrNotFound
	}
	document, err := s.getOutboundDocument(ctx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if document.CustomerID != customerID {
		return OutboundDocument{}, ErrNotFound
	}
	return document, nil
}

func (s *Store) CreateOutboundDocument(ctx context.Context, input CreateOutboundDocumentInput) (OutboundDocument, error) {
	input = sanitizeOutboundDocumentInput(input)
	if err := validateOutboundDocumentInput(input); err != nil {
		return OutboundDocument{}, err
	}

	expectedShipDateInput := strings.TrimSpace(input.ExpectedShipDate)
	expectedShipDate, err := parseOptionalDate(expectedShipDateInput)
	if err != nil {
		return OutboundDocument{}, err
	}
	actualShipDate, err := parseOptionalDate(input.ActualShipDate)
	if err != nil {
		return OutboundDocument{}, err
	}
	if expectedShipDate == nil {
		now := time.Now().UTC()
		expectedShipDate = &now
	}
	requestedStatus := coalesceDocumentStatus(input.Status)
	requestedTrackingStatus := coalesceOutboundTrackingStatus(input.TrackingStatus, requestedStatus)
	if requestedStatus == DocumentStatusDraft {
		requestedTrackingStatus = OutboundTrackingScheduled
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound document transaction: %w", err)
	}
	defer tx.Rollback()

	documentID, err := s.createOutboundDocumentTx(ctx, tx, input, expectedShipDate, actualShipDate, requestedStatus, requestedTrackingStatus)
	if err != nil {
		return OutboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound document: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) createOutboundDocumentTx(
	ctx context.Context,
	tx *sql.Tx,
	input CreateOutboundDocumentInput,
	expectedShipDate *time.Time,
	actualShipDate *time.Time,
	requestedStatus string,
	requestedTrackingStatus string,
) (int64, error) {
	lockedSources := make(map[string]lockedOutboundSource)
	reservationState := newOutboundAllocationReservationState()
	var customerID int64
	var err error

	for lineIndex := range input.Lines {
		line := &input.Lines[lineIndex]
		sourceKey := buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if !exists {
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, line.CustomerID, line.LocationID, line.SKUMasterID)
			if err != nil {
				return 0, err
			}
			lockedSources[sourceKey] = lockedSource
		}

		if customerID == 0 {
			customerID = lockedSource.CustomerID
		} else if customerID != lockedSource.CustomerID {
			return 0, fmt.Errorf("%w: all outbound lines must belong to the same customer", ErrInvalidInput)
		}
		if _, err := s.prepareOutboundDraftLineAllocationsTx(ctx, tx, lockedSource, line, reservationState); err != nil {
			return 0, err
		}
	}

	persistedStatus := requestedStatus
	if requestedStatus == DocumentStatusConfirmed {
		persistedStatus = DocumentStatusDraft
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO outbound_documents (
			packing_list_no,
			order_ref,
			customer_id,
			expected_ship_date,
			actual_ship_date,
			ship_to_name,
			ship_to_address,
			ship_to_contact,
			carrier_name,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
	`,
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		customerID,
		nullableTime(expectedShipDate),
		nullableTime(actualShipDate),
		nullableString(input.ShipToName),
		nullableString(input.ShipToAddress),
		nullableString(input.ShipToContact),
		nullableString(input.CarrierName),
		nullableString(input.DocumentNote),
		persistedStatus,
		requestedTrackingStatus,
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("create outbound document: %w", err))
	}

	documentID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve outbound document id: %w", err)
	}

	if err := s.insertOutboundDocumentLinesTx(ctx, tx, documentID, input, lockedSources); err != nil {
		return 0, err
	}

	switch requestedStatus {
	case DocumentStatusConfirmed:
		if err := s.confirmOutboundDocumentTx(ctx, tx, documentID, requestedTrackingStatus); err != nil {
			return 0, err
		}
	case DocumentStatusDraft:
		// Draft documents keep stock unchanged until confirmed.
	}

	return documentID, nil
}

func (s *Store) UpdateOutboundDocument(ctx context.Context, documentID int64, input CreateOutboundDocumentInput) (OutboundDocument, error) {
	input = sanitizeOutboundDocumentInput(input)
	if err := validateOutboundDocumentInput(input); err != nil {
		return OutboundDocument{}, err
	}

	expectedShipDateInput := strings.TrimSpace(input.ExpectedShipDate)
	expectedShipDate, err := parseOptionalDate(expectedShipDateInput)
	if err != nil {
		return OutboundDocument{}, err
	}
	actualShipDate, err := parseOptionalDate(input.ActualShipDate)
	if err != nil {
		return OutboundDocument{}, err
	}
	if expectedShipDate == nil {
		now := time.Now().UTC()
		expectedShipDate = &now
	}
	requestedStatus := coalesceDocumentStatus(input.Status)
	requestedTrackingStatus := coalesceOutboundTrackingStatus(input.TrackingStatus, requestedStatus)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound update transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	normalizedDocumentStatus := normalizeDocumentStatus(documentRow.Status)
	if normalizedDocumentStatus == DocumentStatusConfirmed {
		return OutboundDocument{}, fmt.Errorf("%w: confirmed shipments are immutable; cancel the shipment or copy it into a new draft and re-enter it", ErrInvalidInput)
	}
	if normalizedDocumentStatus != DocumentStatusDraft {
		return OutboundDocument{}, fmt.Errorf("%w: only draft shipments can be edited", ErrInvalidInput)
	}

	existingTrackingStatus := normalizeOutboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)
	if requestedStatus == DocumentStatusDraft {
		requestedTrackingStatus = normalizeOutboundTrackingStatus(requestedTrackingStatus, requestedStatus)
		if err := validateOutboundTrackingTransition(existingTrackingStatus, requestedTrackingStatus); err != nil {
			return OutboundDocument{}, err
		}
	}

	existingLineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if outboundTrackingRequiresActiveReservation(existingTrackingStatus) {
		if err := s.releaseOutboundDocumentReservationsTx(ctx, tx, existingLineRows); err != nil {
			return OutboundDocument{}, err
		}
	}

	lockedSources := make(map[string]lockedOutboundSource)
	reservationState := newOutboundAllocationReservationState()
	var customerID int64

	for lineIndex := range input.Lines {
		line := &input.Lines[lineIndex]
		sourceKey := buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if !exists {
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, line.CustomerID, line.LocationID, line.SKUMasterID)
			if err != nil {
				return OutboundDocument{}, err
			}
			lockedSources[sourceKey] = lockedSource
		}

		if customerID == 0 {
			customerID = lockedSource.CustomerID
		} else if customerID != lockedSource.CustomerID {
			return OutboundDocument{}, fmt.Errorf("%w: all outbound lines must belong to the same customer", ErrInvalidInput)
		}
		if _, err := s.prepareOutboundDraftLineAllocationsTx(ctx, tx, lockedSource, line, reservationState); err != nil {
			return OutboundDocument{}, err
		}
	}

	persistedStatus := requestedStatus
	if requestedStatus == DocumentStatusConfirmed {
		persistedStatus = DocumentStatusDraft
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET
			packing_list_no = ?,
			order_ref = ?,
			customer_id = ?,
			expected_ship_date = ?,
			actual_ship_date = ?,
			ship_to_name = ?,
			ship_to_address = ?,
			ship_to_contact = ?,
			carrier_name = ?,
			document_note = ?,
			status = ?,
			tracking_status = ?,
			confirmed_at = NULL,
			posted_at = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		customerID,
		nullableTime(expectedShipDate),
		nullableTime(actualShipDate),
		nullableString(input.ShipToName),
		nullableString(input.ShipToAddress),
		nullableString(input.ShipToContact),
		nullableString(input.CarrierName),
		nullableString(input.DocumentNote),
		persistedStatus,
		requestedTrackingStatus,
		documentID,
	); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("update outbound document: %w", err))
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_document_lines WHERE document_id = ?`, documentID); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("delete outbound draft lines: %w", err))
	}

	if err := s.insertOutboundDocumentLinesTx(ctx, tx, documentID, input, lockedSources); err != nil {
		return OutboundDocument{}, err
	}

	if requestedStatus == DocumentStatusConfirmed {
		if err := s.confirmOutboundDocumentTx(ctx, tx, documentID, requestedTrackingStatus); err != nil {
			return OutboundDocument{}, err
		}
	} else if outboundTrackingRequiresActiveReservation(requestedTrackingStatus) {
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
		if err != nil {
			return OutboundDocument{}, err
		}
		if _, err := s.reserveOutboundDocumentLinesTx(ctx, tx, customerID, lineRows); err != nil {
			return OutboundDocument{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound update: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) UpdateOutboundDocumentNote(ctx context.Context, documentID int64, input UpdateOutboundDocumentNoteInput) (OutboundDocument, error) {
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound note update transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET
			document_note = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableString(input.DocumentNote),
		documentID,
	); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("update outbound document note: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound note update: %w", err)
	}

	document, err := s.getOutboundDocument(ctx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if document.PackingListNo == "" {
		document.PackingListNo = documentRow.PackingListNo
	}
	return document, nil
}

func (s *Store) insertOutboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64, input CreateOutboundDocumentInput, lockedSources map[string]lockedOutboundSource) error {
	reservationState := newOutboundAllocationReservationState()
	for index, line := range input.Lines {
		lockedSource := lockedSources[buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)]
		allocations := make([]outboundAllocationCandidate, 0)
		if len(line.PickAllocations) == 0 {
			var err error
			allocations, err = s.resolveOutboundLineAllocationsTx(ctx, tx, lockedSource, line.Quantity, reservationState)
			if err != nil {
				return err
			}
		}
		lineLocationID := lockedSource.LocationID
		lineLocationName := lockedSource.LocationName
		lineStorageSection := DefaultStorageSection
		lineItemNumber := strings.TrimSpace(lockedSource.ItemNumber)
		if len(line.PickAllocations) > 0 {
			lineLocationID = firstNonZeroInt64(line.PickAllocations[0].LocationID, lineLocationID)
			lineLocationName = firstNonEmpty(line.PickAllocations[0].LocationName, lineLocationName)
			lineStorageSection = fallbackSection(line.PickAllocations[0].StorageSection)
			lineItemNumber = firstNonEmpty(lineItemNumber, line.PickAllocations[0].ItemNumber)
		} else if len(allocations) > 0 {
			lineLocationID = allocations[0].LocationID
			lineLocationName = allocations[0].LocationName
			lineStorageSection = fallbackSection(allocations[0].StorageSection)
			lineItemNumber = firstNonEmpty(lineItemNumber, allocations[0].ItemNumber)
		}

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_document_lines (
				document_id,
				sku_master_id,
				location_id,
				location_name_snapshot,
				storage_section,
				item_number_snapshot,
				sku_snapshot,
				description_snapshot,
				quantity,
				pallets,
				pallets_detail_ctns,
				unit_label,
				carton_size_mm,
				net_weight_kgs,
				gross_weight_kgs,
				line_note,
				pick_allocations_json,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			documentID,
			lockedSource.SKUMasterID,
			lineLocationID,
			lineLocationName,
			lineStorageSection,
			nullableString(lineItemNumber),
			lockedSource.SKU,
			nullableString(lockedSource.Description),
			line.Quantity,
			line.Pallets,
			nullableString(line.PalletsDetailCtns),
			nullableString(firstNonEmpty(line.UnitLabel, strings.ToUpper(lockedSource.Unit), "PCS")),
			nullableString(line.CartonSizeMM),
			line.NetWeightKgs,
			line.GrossWeightKgs,
			nullableString(line.LineNote),
			nullableString(mustEncodeOutboundPickAllocations(line.PickAllocations)),
			index+1,
		)
		if err != nil {
			return mapDBError(fmt.Errorf("create outbound document line: %w", err))
		}

		if _, err := lineResult.LastInsertId(); err != nil {
			return fmt.Errorf("resolve outbound document line id: %w", err)
		}
	}

	return nil
}

func (s *Store) ConfirmOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound confirm transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: deleted outbound document cannot be confirmed", ErrInvalidInput)
	}
	if status == DocumentStatusConfirmed {
		return OutboundDocument{}, fmt.Errorf("%w: outbound document is already confirmed", ErrInvalidInput)
	}
	if err := s.confirmOutboundDocumentTx(ctx, tx, documentID); err != nil {
		return OutboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound confirm: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) UpdateOutboundDocumentTrackingStatus(ctx context.Context, documentID int64, trackingStatus string) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound tracking transition: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}

	documentStatus := normalizeDocumentStatus(documentRow.Status)
	if documentStatus == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: deleted shipment cannot change tracking status", ErrInvalidInput)
	}

	currentTrackingStatus := normalizeOutboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)
	targetTrackingStatus := normalizeOutboundTrackingStatus(trackingStatus, documentRow.Status)
	if err := validateOutboundTrackingTransition(currentTrackingStatus, targetTrackingStatus); err != nil {
		return OutboundDocument{}, err
	}

	if targetTrackingStatus == OutboundTrackingShipped || targetTrackingStatus == OutboundTrackingBOReceived {
		if documentStatus != DocumentStatusConfirmed {
			if err := s.confirmOutboundDocumentTx(ctx, tx, documentID, targetTrackingStatus); err != nil {
				return OutboundDocument{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_documents
			SET tracking_status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, targetTrackingStatus, documentID); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("update outbound tracking status: %w", err))
		}
	} else {
		if documentStatus == DocumentStatusConfirmed {
			return OutboundDocument{}, fmt.Errorf("%w: confirmed shipment tracking cannot move away from shipped", ErrInvalidInput)
		}
		if currentTrackingStatus == OutboundTrackingScheduled && outboundTrackingRequiresActiveReservation(targetTrackingStatus) {
			lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
			if err != nil {
				return OutboundDocument{}, err
			}
			if _, err := s.reserveOutboundDocumentLinesTx(ctx, tx, documentRow.CustomerID, lineRows); err != nil {
				return OutboundDocument{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_documents
			SET tracking_status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, targetTrackingStatus, documentID); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("update outbound tracking status: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound tracking transition: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) confirmOutboundDocumentTx(ctx context.Context, tx *sql.Tx, documentID int64, finalTrackingStatus ...string) error {
	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusDeleted {
		return fmt.Errorf("%w: deleted outbound document cannot be confirmed", ErrInvalidInput)
	}
	if status == DocumentStatusConfirmed {
		return fmt.Errorf("%w: outbound document is already confirmed", ErrInvalidInput)
	}
	currentTrackingStatus := normalizeOutboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)
	confirmedTrackingStatus := resolveConfirmedOutboundTrackingStatus(currentTrackingStatus, finalTrackingStatus...)

	lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return err
	}
	if len(lineRows) == 0 {
		return fmt.Errorf("%w: outbound document must contain at least one line", ErrInvalidInput)
	}
	if !outboundTrackingRequiresActiveReservation(currentTrackingStatus) {
		lineRows, err = s.reserveOutboundDocumentLinesTx(ctx, tx, documentRow.CustomerID, lineRows)
		if err != nil {
			return err
		}
	}

	outboundEventTime := firstNonEmptyTime(documentRow.ActualShipDate, documentRow.ConfirmedAt, documentRow.ExpectedShipDate)

	for _, lineRow := range lineRows {
		allocationRows, err := s.loadOutboundContainerAllocationsForUpdateTx(ctx, tx, lineRow.ID)
		if err != nil {
			return err
		}
		allocations := make([]OutboundPickAllocation, 0, len(allocationRows))
		for _, allocation := range allocationRows {
			allocations = append(allocations, OutboundPickAllocation{
				ID:             allocation.ID,
				LineID:         allocation.OutboundLineID,
				LocationID:     allocation.LocationID,
				StorageSection: allocation.StorageSection,
				ContainerNo:    allocation.ContainerNo,
				AllocatedQty:   allocation.AllocatedQty,
				Pallets:        allocation.AllocatedPallets,
			})
		}
		if len(allocations) == 0 || totalOutboundPickAllocationQuantity(allocations) != lineRow.Quantity {
			return fmt.Errorf("%w: shipment container allocations must equal outbound quantity", ErrInvalidInput)
		}
		allocationCandidates := toOutboundAllocationCandidatesFromDraftPickAllocations(lockedOutboundSource{}, allocations)
		netWeightSplits := splitProportionalFloat(lineRow.NetWeightKgs, lineRow.Quantity, allocationCandidates)
		grossWeightSplits := splitProportionalFloat(lineRow.GrossWeightKgs, lineRow.Quantity, allocationCandidates)

		for allocationIndex, allocation := range allocations {
			locationID := firstNonZeroInt64(allocation.LocationID, lineRow.LocationID)
			releaseResult, err := tx.ExecContext(ctx, `
				UPDATE inventory_items
				SET
					allocated_qty = allocated_qty - ?,
					allocated_pallets = allocated_pallets - ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE customer_id = ?
				  AND sku_master_id = ?
				  AND location_id = ?
				  AND storage_section = ?
				  AND container_no = ?
				  AND quantity >= ?
				  AND pallets >= ?
				  AND allocated_qty >= ?
				  AND allocated_pallets >= ?
			`, allocation.AllocatedQty, allocation.Pallets, documentRow.CustomerID, lineRow.SKUMasterID, locationID, fallbackSection(allocation.StorageSection), normalizeContainerNo(allocation.ContainerNo), allocation.AllocatedQty, allocation.Pallets, allocation.AllocatedQty, allocation.Pallets)
			if err != nil {
				return mapDBError(fmt.Errorf("consume outbound container reservation: %w", err))
			}
			rows, err := releaseResult.RowsAffected()
			if err != nil {
				return fmt.Errorf("resolve consumed outbound reservation: %w", err)
			}
			if rows != 1 {
				return ErrInsufficientStock
			}
			if _, err := s.createStockLedgerEntryTx(ctx, tx, createStockLedgerInput{
				EventType:           StockLedgerEventShip,
				SKUMasterID:         lineRow.SKUMasterID,
				CustomerID:          documentRow.CustomerID,
				LocationID:          locationID,
				StorageSection:      fallbackSection(allocation.StorageSection),
				QuantityChange:      -allocation.AllocatedQty,
				PalletChange:        -float64(allocation.Pallets),
				SourceDocumentType:  StockLedgerSourceOutbound,
				SourceDocumentID:    documentID,
				SourceLineID:        lineRow.ID,
				ContainerNo:         allocation.ContainerNo,
				OutDate:             resolveOutboundLedgerDate(documentRow.ExpectedShipDate, documentRow.ActualShipDate),
				PackingListNo:       documentRow.PackingListNo,
				OrderRef:            documentRow.OrderRef,
				ItemNumber:          lineRow.ItemNumberSnapshot,
				DescriptionSnapshot: lineRow.DescriptionSnapshot,
				Pallets:             allocation.Pallets,
				PalletsDetailCtns:   lineRow.PalletsDetailCtns,
				CartonSizeMM:        lineRow.CartonSizeMM,
				CartonCount:         allocation.AllocatedQty,
				UnitLabel:           firstNonEmpty(lineRow.UnitLabel, "PCS"),
				NetWeightKgs:        netWeightSplits[allocationIndex],
				GrossWeightKgs:      grossWeightSplits[allocationIndex],
				DocumentNote:        documentRow.DocumentNote,
				Reason:              firstNonEmpty(lineRow.LineNote, defaultMovementReason("OUT")),
			}); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_container_allocations
			SET
				shipped_qty = allocated_qty,
				shipped_pallets = allocated_pallets,
				status = 'SHIPPED',
				updated_at = CURRENT_TIMESTAMP
			WHERE outbound_line_id = ?
		`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("mark outbound container allocations shipped: %w", err))
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE containers c
		JOIN (
			SELECT DISTINCT oca.container_id
			FROM outbound_container_allocations oca
			JOIN outbound_document_lines odl ON odl.id = oca.outbound_line_id
			WHERE odl.document_id = ?
		) shipped ON shipped.container_id = c.id
		LEFT JOIN (
			SELECT container_id, SUM(quantity) AS remaining_qty
			FROM inventory_items
			WHERE container_id IS NOT NULL
			GROUP BY container_id
		) balance ON balance.container_id = c.id
		SET
			c.status = CASE WHEN COALESCE(balance.remaining_qty, 0) > 0 THEN 'PARTIALLY_OUTBOUND' ELSE 'DEPLETED' END,
			c.last_event_at = COALESCE(?, c.last_event_at),
			c.updated_at = CURRENT_TIMESTAMP
	`, documentID, nullableTime(outboundEventTime)); err != nil {
		return mapDBError(fmt.Errorf("update outbound container inventory status: %w", err))
	}

	confirmedAt := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET
			status = ?,
			tracking_status = ?,
			confirmed_at = COALESCE(confirmed_at, ?),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, DocumentStatusConfirmed, confirmedTrackingStatus, confirmedAt, documentID); err != nil {
		return mapDBError(fmt.Errorf("mark outbound document confirmed: %w", err))
	}

	return nil
}

func (s *Store) CancelOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound cancel transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: outbound document is already deleted", ErrInvalidInput)
	}

	deletedAt := time.Now().UTC()

	if status == DocumentStatusConfirmed {
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
		if err != nil {
			return OutboundDocument{}, err
		}

		for _, lineRow := range lineRows {
			allocationRows, err := s.loadOutboundContainerAllocationsForUpdateTx(ctx, tx, lineRow.ID)
			if err != nil {
				return OutboundDocument{}, err
			}
			for _, allocation := range allocationRows {
				if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
					EventType:           StockLedgerEventReversal,
					SKUMasterID:         lineRow.SKUMasterID,
					CustomerID:          documentRow.CustomerID,
					LocationID:          allocation.LocationID,
					StorageSection:      allocation.StorageSection,
					QuantityChange:      allocation.AllocatedQty,
					PalletChange:        float64(allocation.AllocatedPallets),
					SourceDocumentType:  StockLedgerSourceOutbound,
					SourceDocumentID:    documentID,
					SourceLineID:        lineRow.ID,
					ContainerNo:         allocation.ContainerNo,
					OutDate:             &deletedAt,
					PackingListNo:       documentRow.PackingListNo,
					OrderRef:            documentRow.OrderRef,
					ItemNumber:          lineRow.ItemNumberSnapshot,
					DescriptionSnapshot: lineRow.DescriptionSnapshot,
					Pallets:             allocation.AllocatedPallets,
					Reason:              "Outbound shipment cancelled",
				}); err != nil {
					return OutboundDocument{}, err
				}
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE outbound_container_allocations
				SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
				WHERE outbound_line_id = ?
			`, lineRow.ID); err != nil {
				return OutboundDocument{}, mapDBError(fmt.Errorf("cancel outbound container allocations: %w", err))
			}
		}
	} else if outboundTrackingRequiresActiveReservation(normalizeOutboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)) {
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
		if err != nil {
			return OutboundDocument{}, err
		}
		if err := s.releaseOutboundDocumentReservationsTx(ctx, tx, lineRows); err != nil {
			return OutboundDocument{}, err
		}
	}

	if err := markDocumentAttachmentsDeletedForDocument(ctx, tx, DocumentAttachmentOutbound, documentID); err != nil {
		return OutboundDocument{}, err
	}

	// Delete outbound document (cascades to outbound document lines and container allocations)
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_documents WHERE id = ?`, documentID); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("delete outbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound cancel: %w", err)
	}

	return OutboundDocument{
		ID:            documentRow.ID,
		PackingListNo: documentRow.PackingListNo,
		OrderRef:      documentRow.OrderRef,
		CustomerID:    documentRow.CustomerID,
		Status:        DocumentStatusDeleted,
		DeletedAt:     &deletedAt,
		CreatedAt:     documentRow.CreatedAt,
	}, nil
}

func outboundTrackingRequiresActiveReservation(status string) bool {
	switch normalizeOutboundTrackingStatus(status, DocumentStatusDraft) {
	case OutboundTrackingPicking, OutboundTrackingPacked:
		return true
	default:
		return false
	}
}

func resolveConfirmedOutboundTrackingStatus(existingTrackingStatus string, finalTrackingStatus ...string) string {
	trackingStatus := existingTrackingStatus
	if len(finalTrackingStatus) > 0 && strings.TrimSpace(finalTrackingStatus[0]) != "" {
		trackingStatus = finalTrackingStatus[0]
	}
	if normalizeOutboundTrackingStatus(trackingStatus, DocumentStatusConfirmed) == OutboundTrackingBOReceived {
		return OutboundTrackingBOReceived
	}
	return OutboundTrackingShipped
}

func outboundLineInputFromRow(customerID int64, lineRow outboundDocumentLineRow) CreateOutboundDocumentLineInput {
	return CreateOutboundDocumentLineInput{
		CustomerID:        customerID,
		LocationID:        lineRow.LocationID,
		SKUMasterID:       lineRow.SKUMasterID,
		Quantity:          lineRow.Quantity,
		Pallets:           lineRow.Pallets,
		PalletsDetailCtns: lineRow.PalletsDetailCtns,
		UnitLabel:         lineRow.UnitLabel,
		CartonSizeMM:      lineRow.CartonSizeMM,
		NetWeightKgs:      lineRow.NetWeightKgs,
		GrossWeightKgs:    lineRow.GrossWeightKgs,
		LineNote:          lineRow.LineNote,
		PickAllocations:   decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON),
	}
}

func (s *Store) persistOutboundDocumentLineReservationTx(
	ctx context.Context,
	tx *sql.Tx,
	lineID int64,
	line CreateOutboundDocumentLineInput,
) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_document_lines
		SET
			pallets = ?,
			pick_allocations_json = ?
		WHERE id = ?
	`,
		line.Pallets,
		nullableString(mustEncodeOutboundPickAllocations(line.PickAllocations)),
		lineID,
	); err != nil {
		return mapDBError(fmt.Errorf("persist outbound reservation snapshot: %w", err))
	}
	return nil
}

func (s *Store) reserveOutboundLineTx(
	ctx context.Context,
	tx *sql.Tx,
	source lockedOutboundSource,
	line *CreateOutboundDocumentLineInput,
) error {
	if line == nil {
		return fmt.Errorf("%w: outbound line is required", ErrInvalidInput)
	}

	plannedAllocations := normalizeOutboundPickAllocations(line.PickAllocations)
	if len(plannedAllocations) == 0 {
		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, source, line.Quantity, newOutboundAllocationReservationState())
		if err != nil {
			return err
		}
		plannedAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
		// Legacy/manual submissions without explicit picks use the declared
		// outbound pallet count as their inventory deduction fallback.
		plannedAllocations = assignOutboundPalletsToAllocations(plannedAllocations, line.Pallets)
	}
	if totalOutboundPickAllocationQuantity(plannedAllocations) != line.Quantity {
		return fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
	}
	line.PickAllocations = plannedAllocations
	return nil
}

func assignOutboundPalletsToAllocations(allocations []OutboundPickAllocation, palletCount int) []OutboundPickAllocation {
	normalized := normalizeOutboundPickAllocations(allocations)
	if len(normalized) == 0 || palletCount <= 0 {
		return normalized
	}
	remainingPallets := palletCount
	remainingQty := totalOutboundPickAllocationQuantity(normalized)
	for index := range normalized {
		if index == len(normalized)-1 {
			normalized[index].Pallets = remainingPallets
			break
		}
		share := 0
		if remainingQty > 0 {
			share = int(math.Round(float64(remainingPallets) * float64(normalized[index].AllocatedQty) / float64(remainingQty)))
		}
		share = maxInt(0, share)
		if share > remainingPallets {
			share = remainingPallets
		}
		normalized[index].Pallets = share
		remainingPallets -= share
		remainingQty -= normalized[index].AllocatedQty
	}
	return normalized
}

func (s *Store) reserveOutboundDocumentLinesTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	lineRows []outboundDocumentLineRow,
) ([]outboundDocumentLineRow, error) {
	lockedSources := make(map[string]lockedOutboundSource)
	for index := range lineRows {
		lineRow := &lineRows[index]
		sourceKey := buildOutboundSourceKey(customerID, lineRow.LocationID, lineRow.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if !exists {
			var err error
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, customerID, lineRow.LocationID, lineRow.SKUMasterID)
			if err != nil {
				return nil, err
			}
			lockedSources[sourceKey] = lockedSource
		}

		lineInput := outboundLineInputFromRow(customerID, *lineRow)
		if err := s.reserveOutboundLineTx(ctx, tx, lockedSource, &lineInput); err != nil {
			return nil, err
		}
		if err := s.persistOutboundDocumentLineReservationTx(ctx, tx, lineRow.ID, lineInput); err != nil {
			return nil, err
		}
		if err := s.replaceOutboundContainerAllocationsTx(ctx, tx, lineRow.ID, customerID, lineRow.SKUMasterID, lineInput.PickAllocations); err != nil {
			return nil, err
		}

		lineRow.Pallets = lineInput.Pallets
		lineRow.PickAllocationsJSON = mustEncodeOutboundPickAllocations(lineInput.PickAllocations)
	}

	return lineRows, nil
}

func (s *Store) releaseOutboundDocumentReservationsTx(ctx context.Context, tx *sql.Tx, lineRows []outboundDocumentLineRow) error {
	for _, lineRow := range lineRows {
		if err := s.releaseOutboundContainerAllocationBalancesTx(ctx, tx, lineRow.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_container_allocations WHERE outbound_line_id = ?`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("delete released container allocations: %w", err))
		}
	}
	return nil
}

func (s *Store) replaceOutboundContainerAllocationsTx(
	ctx context.Context,
	tx *sql.Tx,
	outboundLineID int64,
	customerID int64,
	skuMasterID int64,
	allocations []OutboundPickAllocation,
) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_container_allocations WHERE outbound_line_id = ?`, outboundLineID); err != nil {
		return mapDBError(fmt.Errorf("replace outbound container allocations: %w", err))
	}
	for _, allocation := range normalizeOutboundPickAllocations(allocations) {
		containerNo := normalizeContainerNo(allocation.ContainerNo)
		if containerNo == "" || allocation.AllocatedQty <= 0 {
			return fmt.Errorf("%w: every outbound allocation requires a source container and quantity", ErrInvalidInput)
		}
		sectionID, err := resolveStorageSectionIDTx(ctx, tx, allocation.LocationID, allocation.StorageSection)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO containers (
				customer_id, location_id, container_no, container_type,
				handling_mode, status, tracking_status, last_event_at
			) VALUES (?, ?, ?, 'NORMAL', 'PALLETIZED', 'IN_STOCK', 'RECEIVED', CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
				id = LAST_INSERT_ID(id),
				location_id = VALUES(location_id)
		`, customerID, allocation.LocationID, containerNo)
		if err != nil {
			return mapDBError(fmt.Errorf("ensure outbound allocation container: %w", err))
		}
		containerID, err := result.LastInsertId()
		if err != nil {
			return fmt.Errorf("resolve outbound allocation container: %w", err)
		}
		reserveResult, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET
				allocated_qty = allocated_qty + ?,
				allocated_pallets = allocated_pallets + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE customer_id = ?
			  AND sku_master_id = ?
			  AND location_id = ?
			  AND storage_section = ?
			  AND container_no = ?
			  AND quantity - allocated_qty - damaged_qty - hold_qty >= ?
			  AND pallets - allocated_pallets >= ?
		`,
			allocation.AllocatedQty,
			allocation.Pallets,
			customerID,
			skuMasterID,
			allocation.LocationID,
			fallbackSection(allocation.StorageSection),
			containerNo,
			allocation.AllocatedQty,
			allocation.Pallets,
		)
		if err != nil {
			return mapDBError(fmt.Errorf("reserve outbound container inventory: %w", err))
		}
		reservedRows, err := reserveResult.RowsAffected()
		if err != nil {
			return fmt.Errorf("resolve outbound container reservation: %w", err)
		}
		if reservedRows != 1 {
			return ErrInsufficientStock
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_container_allocations (
				outbound_line_id,
				container_id,
				customer_id,
				sku_master_id,
				location_id,
				section_id,
				storage_section,
				allocated_qty,
				allocated_pallets,
				status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED')
		`,
			outboundLineID,
			containerID,
			customerID,
			skuMasterID,
			allocation.LocationID,
			sectionID,
			fallbackSection(allocation.StorageSection),
			allocation.AllocatedQty,
			allocation.Pallets,
		); err != nil {
			return mapDBError(fmt.Errorf("insert outbound container allocation: %w", err))
		}
	}
	return nil
}

func (s *Store) releaseOutboundContainerAllocationBalancesTx(ctx context.Context, tx *sql.Tx, outboundLineID int64) error {
	allocations, err := s.loadOutboundContainerAllocationsForUpdateTx(ctx, tx, outboundLineID)
	if err != nil {
		return err
	}
	for _, allocation := range allocations {
		if allocation.Status != "RESERVED" {
			continue
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE inventory_items i
			JOIN containers c ON c.id = ?
			SET
				i.allocated_qty = GREATEST(i.allocated_qty - ?, 0),
				i.allocated_pallets = GREATEST(i.allocated_pallets - ?, 0),
				i.updated_at = CURRENT_TIMESTAMP
			WHERE i.customer_id = ?
			  AND i.sku_master_id = ?
			  AND i.location_id = ?
			  AND i.storage_section = ?
			  AND i.container_no = c.container_no
		`, allocation.ContainerID, allocation.AllocatedQty, allocation.AllocatedPallets, allocation.CustomerID, allocation.SKUMasterID, allocation.LocationID, allocation.StorageSection)
		if err != nil {
			return mapDBError(fmt.Errorf("release outbound container inventory: %w", err))
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("resolve released outbound container inventory: %w", err)
		}
		if rows != 1 {
			return fmt.Errorf("%w: reserved container inventory no longer exists", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Store) loadOutboundContainerAllocationsForUpdateTx(ctx context.Context, tx *sql.Tx, outboundLineID int64) ([]outboundContainerAllocationRow, error) {
	rows := make([]outboundContainerAllocationRow, 0)
	result, err := tx.QueryContext(ctx, `
		SELECT
			oca.id,
			oca.outbound_line_id,
			oca.container_id,
			c.container_no,
			oca.customer_id,
			oca.sku_master_id,
			oca.location_id,
			oca.storage_section,
			oca.allocated_qty,
			oca.allocated_pallets,
			oca.status
		FROM outbound_container_allocations oca
		JOIN containers c ON c.id = oca.container_id
		WHERE oca.outbound_line_id = ?
		ORDER BY oca.id
		FOR UPDATE
	`, outboundLineID)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("load outbound container allocations: %w", err))
	}
	defer result.Close()
	for result.Next() {
		var row outboundContainerAllocationRow
		if err := result.Scan(
			&row.ID,
			&row.OutboundLineID,
			&row.ContainerID,
			&row.ContainerNo,
			&row.CustomerID,
			&row.SKUMasterID,
			&row.LocationID,
			&row.StorageSection,
			&row.AllocatedQty,
			&row.AllocatedPallets,
			&row.Status,
		); err != nil {
			return nil, fmt.Errorf("scan outbound container allocation: %w", err)
		}
		rows = append(rows, row)
	}
	if err := result.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound container allocations: %w", err)
	}
	return rows, nil
}

func (s *Store) loadAvailableOutboundPalletBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	skuMasterID int64,
	locationID int64,
	storageSection string,
	containerNo string,
) (int, error) {
	var onHandPallets int
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(pallets), 0)
		FROM inventory_items
		WHERE customer_id = ?
		  AND sku_master_id = ?
		  AND location_id = ?
		  AND storage_section = ?
		  AND container_no = ?
	`, customerID, skuMasterID, locationID, fallbackSection(storageSection), normalizeContainerNo(containerNo)).Scan(&onHandPallets); err != nil {
		return 0, fmt.Errorf("load outbound container pallet balance: %w", err)
	}

	var reservedPallets int
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(allocated_pallets), 0)
		FROM outbound_container_allocations
		WHERE customer_id = ?
		  AND sku_master_id = ?
		  AND location_id = ?
		  AND storage_section = ?
		  AND container_id IN (
			SELECT id FROM containers WHERE customer_id = ? AND container_no = ?
		  )
		  AND status = 'RESERVED'
	`, customerID, skuMasterID, locationID, fallbackSection(storageSection), customerID, normalizeContainerNo(containerNo)).Scan(&reservedPallets); err != nil {
		return 0, fmt.Errorf("load reserved outbound pallet balance: %w", err)
	}

	return maxInt(onHandPallets-reservedPallets, 0), nil
}

func (s *Store) ArchiveOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound archive transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if documentRow.ArchivedAt != nil {
		return OutboundDocument{}, fmt.Errorf("%w: shipment is already archived", ErrInvalidInput)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, documentID); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("archive outbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound archive: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) CopyOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound copy transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}

	lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if len(lineRows) == 0 {
		return OutboundDocument{}, fmt.Errorf("%w: shipment must contain at least one line", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO outbound_documents (
			packing_list_no,
			order_ref,
			customer_id,
			expected_ship_date,
			actual_ship_date,
			ship_to_name,
			ship_to_address,
			ship_to_contact,
			carrier_name,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at,
			cancel_note,
			cancelled_at,
			archived_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
	`,
		nullableString(documentRow.PackingListNo),
		nullableString(documentRow.OrderRef),
		documentRow.CustomerID,
		nullableTime(documentRow.ExpectedShipDate),
		nullableTime(documentRow.ActualShipDate),
		nullableString(documentRow.ShipToName),
		nullableString(documentRow.ShipToAddress),
		nullableString(documentRow.ShipToContact),
		nullableString(documentRow.CarrierName),
		nullableString(documentRow.DocumentNote),
		DocumentStatusDraft,
		OutboundTrackingScheduled,
	)
	if err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("copy outbound document: %w", err))
	}

	newDocumentID, err := result.LastInsertId()
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("resolve copied outbound document id: %w", err)
	}

	for index, lineRow := range lineRows {
		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_document_lines (
				document_id,
				sku_master_id,
				location_id,
				location_name_snapshot,
				storage_section,
				item_number_snapshot,
				sku_snapshot,
				description_snapshot,
				quantity,
				pallets,
				pallets_detail_ctns,
				unit_label,
				carton_size_mm,
				net_weight_kgs,
				gross_weight_kgs,
				line_note,
				pick_allocations_json,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			newDocumentID,
			lineRow.SKUMasterID,
			lineRow.LocationID,
			lineRow.LocationName,
			fallbackSection(lineRow.StorageSection),
			nullableString(lineRow.ItemNumberSnapshot),
			lineRow.SKUSnapshot,
			nullableString(lineRow.DescriptionSnapshot),
			lineRow.Quantity,
			lineRow.Pallets,
			nullableString(lineRow.PalletsDetailCtns),
			nullableString(lineRow.UnitLabel),
			nullableString(lineRow.CartonSizeMM),
			lineRow.NetWeightKgs,
			lineRow.GrossWeightKgs,
			nullableString(lineRow.LineNote),
			nil,
			index+1,
		)
		if err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("copy outbound document line: %w", err))
		}

		if _, err := lineResult.LastInsertId(); err != nil {
			return OutboundDocument{}, fmt.Errorf("resolve copied outbound line id: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound copy: %w", err)
	}

	return s.getOutboundDocument(ctx, newDocumentID)
}

func (s *Store) loadOutboundDocumentForUpdateTx(ctx context.Context, tx *sql.Tx, documentID int64) (outboundDocumentRow, error) {
	var documentRow outboundDocumentRow
	if err := tx.QueryRowContext(ctx, `
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.expected_ship_date,
			d.actual_ship_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			d.cancelled_at,
			d.archived_at,
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
		&documentRow.ExpectedShipDate,
		&documentRow.ActualShipDate,
		&documentRow.ShipToName,
		&documentRow.ShipToAddress,
		&documentRow.ShipToContact,
		&documentRow.CarrierName,
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
			return outboundDocumentRow{}, ErrNotFound
		}
		return outboundDocumentRow{}, fmt.Errorf("load outbound document for update: %w", err)
	}

	return documentRow, nil
}

func (s *Store) loadOutboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64) ([]outboundDocumentLineRow, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			document_id,
			sku_master_id,
			COALESCE(item_number_snapshot, '') AS item_number_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			COALESCE(pick_allocations_json, '') AS pick_allocations_json,
			created_at
		FROM outbound_document_lines
		WHERE document_id = ?
		ORDER BY sort_order ASC, id ASC
	`, documentID)
	if err != nil {
		return nil, fmt.Errorf("load outbound document lines: %w", err)
	}
	defer rows.Close()

	lineRows := make([]outboundDocumentLineRow, 0)
	for rows.Next() {
		var lineRow outboundDocumentLineRow
		if err := rows.Scan(
			&lineRow.ID,
			&lineRow.DocumentID,
			&lineRow.SKUMasterID,
			&lineRow.ItemNumberSnapshot,
			&lineRow.LocationID,
			&lineRow.LocationName,
			&lineRow.StorageSection,
			&lineRow.SKUSnapshot,
			&lineRow.DescriptionSnapshot,
			&lineRow.Quantity,
			&lineRow.Pallets,
			&lineRow.PalletsDetailCtns,
			&lineRow.UnitLabel,
			&lineRow.CartonSizeMM,
			&lineRow.NetWeightKgs,
			&lineRow.GrossWeightKgs,
			&lineRow.LineNote,
			&lineRow.PickAllocationsJSON,
			&lineRow.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan outbound document line: %w", err)
		}
		lineRows = append(lineRows, lineRow)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound document lines: %w", err)
	}

	return lineRows, nil
}

func (s *Store) getOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	documents, err := s.listOutboundDocumentsByIDs(ctx, []int64{documentID}, true)
	if err != nil {
		return OutboundDocument{}, err
	}
	if len(documents) == 0 {
		return OutboundDocument{}, ErrNotFound
	}
	return documents[0], nil
}

func (s *Store) listOutboundDocumentsByIDs(ctx context.Context, documentIDs []int64, includeArchived bool) ([]OutboundDocument, error) {
	if len(documentIDs) == 0 {
		return []OutboundDocument{}, nil
	}

	archiveFilter := "AND d.archived_at IS NULL"
	if includeArchived {
		archiveFilter = ""
	}

	query, args, err := sqlx.In(fmt.Sprintf(`
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.expected_ship_date,
			d.actual_ship_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE d.id IN (?)
		%s
		ORDER BY COALESCE(d.actual_ship_date, d.expected_ship_date, d.created_at) DESC, d.id DESC
	`, archiveFilter), documentIDs)
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
	linesByID := make(map[int64]*OutboundDocumentLine)
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:               row.ID,
			PackingListNo:    row.PackingListNo,
			OrderRef:         row.OrderRef,
			CustomerID:       row.CustomerID,
			CustomerName:     row.CustomerName,
			ExpectedShipDate: row.ExpectedShipDate,
			ActualShipDate:   row.ActualShipDate,
			ShipToName:       row.ShipToName,
			ShipToAddress:    row.ShipToAddress,
			ShipToContact:    row.ShipToContact,
			CarrierName:      row.CarrierName,
			DocumentNote:     row.DocumentNote,
			Status:           normalizeDocumentStatus(row.Status),
			TrackingStatus:   normalizeOutboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:      row.ConfirmedAt,
			DeletedAt:        row.DeletedAt,
			ArchivedAt:       row.ArchivedAt,
			Lines:            make([]OutboundDocumentLine, 0),
			Attachments:      make([]DocumentAttachment, 0),
			CreatedAt:        row.CreatedAt,
			UpdatedAt:        row.UpdatedAt,
		}
		documents = append(documents, document)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			document_id,
			sku_master_id,
			COALESCE(item_number_snapshot, '') AS item_number_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			COALESCE(pick_allocations_json, '') AS pick_allocations_json,
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
			ID:                lineRow.ID,
			DocumentID:        lineRow.DocumentID,
			SKUMasterID:       lineRow.SKUMasterID,
			ItemNumber:        lineRow.ItemNumberSnapshot,
			LocationID:        lineRow.LocationID,
			LocationName:      lineRow.LocationName,
			StorageSection:    lineRow.StorageSection,
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			Quantity:          lineRow.Quantity,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			CartonSizeMM:      lineRow.CartonSizeMM,
			NetWeightKgs:      lineRow.NetWeightKgs,
			GrossWeightKgs:    lineRow.GrossWeightKgs,
			LineNote:          lineRow.LineNote,
			PickAllocations:   decodeOutboundDraftPickAllocationsOrEmpty(document.Status, lineRow.ID, lineRow.PickAllocationsJSON),
			CreatedAt:         lineRow.CreatedAt,
		})
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}
	for documentIndex := range documents {
		for lineIndex := range documents[documentIndex].Lines {
			line := &documents[documentIndex].Lines[lineIndex]
			linesByID[line.ID] = line
		}
	}

	if err := s.attachOutboundPickAllocations(ctx, linesByID); err != nil {
		return nil, err
	}
	recalculateOutboundDocumentStorages(documents)

	if err := s.attachDocumentAttachments(ctx, DocumentAttachmentOutbound, documentIDs, func(documentID int64, attachments []DocumentAttachment) {
		if document := documentsByID[documentID]; document != nil {
			document.Attachments = attachments
		}
	}); err != nil {
		return nil, err
	}

	return documents, nil
}

func newOutboundAllocationReservationState() *outboundAllocationReservationState {
	return &outboundAllocationReservationState{
		ByBucketKey: make(map[string]int),
	}
}

func buildOutboundSourceKey(customerID int64, locationID int64, skuMasterID int64) string {
	return fmt.Sprintf("%d|%d|%d", customerID, locationID, skuMasterID)
}

func outboundAllocationBucketKey(customerID int64, locationID int64, skuMasterID int64, storageSection string, containerNo string) string {
	return fmt.Sprintf(
		"%d|%d|%d|%s|%s",
		customerID,
		locationID,
		skuMasterID,
		fallbackSection(storageSection),
		strings.TrimSpace(containerNo),
	)
}

func (s *Store) loadLockedOutboundSourceTx(ctx context.Context, tx *sql.Tx, customerID int64, locationID int64, skuMasterID int64) (lockedOutboundSource, error) {
	var source lockedOutboundSource
	if err := tx.QueryRowContext(ctx, `
		SELECT
			i.sku_master_id,
			i.customer_id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			i.location_id,
			l.name,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			COALESCE(SUM(i.quantity), 0) AS quantity,
			GREATEST(
				SUM(i.quantity) - SUM(i.allocated_qty) - SUM(i.damaged_qty) - SUM(i.hold_qty),
				0
			) AS available_qty,
			COALESCE(SUM(i.allocated_qty), 0) AS allocated_qty,
			COALESCE(SUM(i.damaged_qty), 0) AS damaged_qty,
			COALESCE(SUM(i.hold_qty), 0) AS hold_qty
		FROM inventory_items i
		JOIN sku_master sm ON sm.id = i.sku_master_id
		JOIN storage_locations l ON l.id = i.location_id
		WHERE i.sku_master_id = ?
		  AND i.customer_id = ?
		  AND i.location_id = ?
		  AND i.quantity > 0
		GROUP BY
			i.sku_master_id,
			i.customer_id,
			sm.item_number,
			i.location_id,
			l.name,
			sm.sku,
			sm.description,
			sm.name,
			sm.unit
	`,
		skuMasterID,
		customerID,
		locationID,
	).Scan(
		&source.SKUMasterID,
		&source.CustomerID,
		&source.ItemNumber,
		&source.LocationID,
		&source.LocationName,
		&source.SKU,
		&source.Description,
		&source.Unit,
		&source.Quantity,
		&source.AvailableQty,
		&source.AllocatedQty,
		&source.DamagedQty,
		&source.HoldQty,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return lockedOutboundSource{}, ErrInsufficientStock
		}
		return lockedOutboundSource{}, fmt.Errorf("load locked outbound source: %w", err)
	}

	return source, nil
}

func (s *Store) loadLockedOutboundAllocationCandidatesTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource) ([]outboundAllocationCandidate, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			i.sku_master_id,
			i.customer_id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			i.location_id,
			l.name,
			COALESCE(NULLIF(i.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(i.container_no, '') AS container_no,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			GREATEST(
				i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty,
				0
			) AS available_qty,
			i.delivery_date,
			i.created_at AS sort_at
		FROM inventory_items i
		JOIN sku_master sm ON sm.id = i.sku_master_id
		JOIN storage_locations l ON l.id = i.location_id
		WHERE
			i.customer_id = ?
			AND i.location_id = ?
			AND i.sku_master_id = ?
			AND GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) > 0
		ORDER BY
			CASE WHEN i.delivery_date IS NULL THEN 1 ELSE 0 END,
			i.delivery_date ASC,
			i.created_at ASC,
			storage_section ASC,
			container_no ASC
		FOR UPDATE
	`,
		source.CustomerID,
		source.LocationID,
		source.SKUMasterID,
	)
	if err != nil {
		return nil, fmt.Errorf("load locked outbound source rows: %w", err)
	}
	defer rows.Close()

	lockedRows := make([]lockedOutboundSourceRow, 0)

	for rows.Next() {
		var (
			row          lockedOutboundSourceRow
			deliveryDate sql.NullTime
		)
		if err := rows.Scan(
			&row.SKUMasterID,
			&row.CustomerID,
			&row.ItemNumber,
			&row.LocationID,
			&row.LocationName,
			&row.StorageSection,
			&row.ContainerNo,
			&row.SKU,
			&row.Description,
			&row.Unit,
			&row.AvailableQty,
			&deliveryDate,
			&row.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan locked outbound source row: %w", err)
		}
		if deliveryDate.Valid {
			deliveryTime := deliveryDate.Time
			row.DeliveryDate = &deliveryTime
		}
		row.BucketKey = outboundAllocationBucketKey(
			row.CustomerID,
			row.LocationID,
			row.SKUMasterID,
			row.StorageSection,
			row.ContainerNo,
		)

		lockedRows = append(lockedRows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate locked outbound source rows: %w", err)
	}
	if len(lockedRows) == 0 {
		return nil, ErrInsufficientStock
	}

	candidates := make([]outboundAllocationCandidate, 0, len(lockedRows))
	for _, lockedRow := range lockedRows {
		sortTime := lockedRow.CreatedAt
		if lockedRow.DeliveryDate != nil {
			sortTime = *lockedRow.DeliveryDate
		}
		candidates = append(candidates, outboundAllocationCandidate{
			BucketKey:      lockedRow.BucketKey,
			SKUMasterID:    lockedRow.SKUMasterID,
			CustomerID:     lockedRow.CustomerID,
			ItemNumber:     lockedRow.ItemNumber,
			LocationID:     lockedRow.LocationID,
			LocationName:   lockedRow.LocationName,
			StorageSection: fallbackSection(lockedRow.StorageSection),
			ContainerNo:    lockedRow.ContainerNo,
			SKU:            lockedRow.SKU,
			Description:    lockedRow.Description,
			Unit:           lockedRow.Unit,
			AvailableQty:   lockedRow.AvailableQty,
			SortAt:         sortTime,
		})
	}

	sort.SliceStable(candidates, func(leftIndex, rightIndex int) bool {
		left := candidates[leftIndex]
		right := candidates[rightIndex]
		if !left.SortAt.Equal(right.SortAt) {
			return left.SortAt.Before(right.SortAt)
		}
		if left.LocationName != right.LocationName {
			return left.LocationName < right.LocationName
		}
		if fallbackSection(left.StorageSection) != fallbackSection(right.StorageSection) {
			return fallbackSection(left.StorageSection) < fallbackSection(right.StorageSection)
		}
		if left.ContainerNo != right.ContainerNo {
			return left.ContainerNo < right.ContainerNo
		}
		return left.BucketKey < right.BucketKey
	})

	return candidates, nil
}

func (s *Store) prepareOutboundDraftLineAllocationsTx(
	ctx context.Context,
	tx *sql.Tx,
	source lockedOutboundSource,
	line *CreateOutboundDocumentLineInput,
	reservationState *outboundAllocationReservationState,
) ([]outboundAllocationCandidate, error) {
	if line == nil {
		return nil, fmt.Errorf("%w: outbound line is required", ErrInvalidInput)
	}

	if len(line.PickAllocations) > 0 {
		allocations, err := s.resolveOutboundDraftBucketAllocationsTx(ctx, tx, source, line.Quantity, line.PickAllocations, reservationState)
		if err != nil {
			return nil, err
		}
		line.PickAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
		return allocations, nil
	}

	return s.resolveOutboundLineAllocationsTx(ctx, tx, source, line.Quantity, reservationState)
}

func (s *Store) resolveOutboundDraftBucketAllocationsTx(
	ctx context.Context,
	tx *sql.Tx,
	source lockedOutboundSource,
	requestedQty int,
	draftAllocations []OutboundPickAllocation,
	reservationState *outboundAllocationReservationState,
) ([]outboundAllocationCandidate, error) {
	if requestedQty <= 0 {
		return nil, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
	}

	normalizedDraftAllocations := normalizeOutboundPickAllocations(draftAllocations)
	if totalOutboundPickAllocationQuantity(normalizedDraftAllocations) != requestedQty {
		return nil, fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
	}

	candidates, err := s.loadLockedOutboundAllocationCandidatesTx(ctx, tx, source)
	if err != nil {
		return nil, err
	}

	candidateByBucketKey := make(map[string]outboundAllocationCandidate, len(candidates))
	for _, candidate := range candidates {
		candidateByBucketKey[candidate.BucketKey] = candidate
	}

	allocations := make([]outboundAllocationCandidate, 0, len(normalizedDraftAllocations))
	appliedReservations := make([]struct {
		BucketKey string
		Allocated int
	}, 0, len(normalizedDraftAllocations))

	for _, draftAllocation := range normalizedDraftAllocations {
		locationID := firstNonZeroInt64(draftAllocation.LocationID, source.LocationID)
		storageSection := fallbackSection(draftAllocation.StorageSection)
		containerNo := strings.TrimSpace(draftAllocation.ContainerNo)
		bucketKey := outboundAllocationBucketKey(source.CustomerID, locationID, source.SKUMasterID, storageSection, containerNo)
		candidate, exists := candidateByBucketKey[bucketKey]
		if !exists {
			for _, applied := range appliedReservations {
				reservationState.ByBucketKey[applied.BucketKey] -= applied.Allocated
			}
			return nil, ErrInsufficientStock
		}

		effectiveAvailable := candidate.AvailableQty - reservationState.ByBucketKey[bucketKey]
		if draftAllocation.AllocatedQty > effectiveAvailable {
			for _, applied := range appliedReservations {
				reservationState.ByBucketKey[applied.BucketKey] -= applied.Allocated
			}
			return nil, ErrInsufficientStock
		}

		candidate.AllocatedQty = draftAllocation.AllocatedQty
		candidate.LocationID = locationID
		candidate.LocationName = firstNonEmpty(strings.TrimSpace(draftAllocation.LocationName), candidate.LocationName, source.LocationName)
		candidate.StorageSection = storageSection
		candidate.ContainerNo = containerNo
		candidate.ItemNumber = firstNonEmpty(strings.TrimSpace(draftAllocation.ItemNumber), candidate.ItemNumber, source.ItemNumber)
		candidate.Pallets = draftAllocation.Pallets

		allocations = append(allocations, candidate)
		reservationState.ByBucketKey[bucketKey] += draftAllocation.AllocatedQty
		appliedReservations = append(appliedReservations, struct {
			BucketKey string
			Allocated int
		}{
			BucketKey: bucketKey,
			Allocated: draftAllocation.AllocatedQty,
		})
	}

	return allocations, nil
}

func (s *Store) allocateOutboundLineTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	if requestedQty <= 0 {
		return nil, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
	}
	if requestedQty > source.AvailableQty {
		return nil, classifyReservedStockConflict(requestedQty, source.Quantity, source.AllocatedQty, source.DamagedQty, source.HoldQty)
	}

	candidates, err := s.loadLockedOutboundAllocationCandidatesTx(ctx, tx, source)
	if err != nil {
		return nil, err
	}

	allocations := make([]outboundAllocationCandidate, 0)
	remainingQty := requestedQty
	appliedReservations := make([]struct {
		BucketKey string
		Allocated int
	}, 0)

	for _, candidate := range candidates {
		effectiveAvailable := candidate.AvailableQty - reservationState.ByBucketKey[candidate.BucketKey]
		if effectiveAvailable <= 0 {
			continue
		}

		allocatedQty := effectiveAvailable
		if allocatedQty > remainingQty {
			allocatedQty = remainingQty
		}
		if allocatedQty <= 0 {
			continue
		}

		candidate.AllocatedQty = allocatedQty
		allocations = append(allocations, candidate)
		reservationState.ByBucketKey[candidate.BucketKey] += allocatedQty
		appliedReservations = append(appliedReservations, struct {
			BucketKey string
			Allocated int
		}{
			BucketKey: candidate.BucketKey,
			Allocated: allocatedQty,
		})
		remainingQty -= allocatedQty

		if remainingQty == 0 {
			break
		}
	}
	if remainingQty > 0 {
		for _, applied := range appliedReservations {
			reservationState.ByBucketKey[applied.BucketKey] -= applied.Allocated
		}
		return nil, classifyReservedStockConflict(requestedQty, source.Quantity, source.AllocatedQty, source.DamagedQty, source.HoldQty)
	}

	return allocations, nil
}

func (s *Store) resolveOutboundLineAllocationsTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	return s.allocateOutboundLineTx(ctx, tx, source, requestedQty, reservationState)
}

func (s *Store) attachOutboundPickAllocations(ctx context.Context, linesByID map[int64]*OutboundDocumentLine) error {
	lineIDs := make([]int64, 0, len(linesByID))
	for lineID, line := range linesByID {
		if len(line.PickAllocations) == 0 {
			lineIDs = append(lineIDs, lineID)
		}
	}
	if len(lineIDs) == 0 {
		return nil
	}

	rows, err := s.listOutboundLedgerAllocationRowsByLineIDs(ctx, lineIDs)
	if err != nil {
		return err
	}
	for _, row := range rows {
		line := linesByID[row.LineID]
		if line == nil {
			continue
		}
		line.PickAllocations = append(line.PickAllocations, OutboundPickAllocation{
			ID: row.ID, LineID: row.LineID, ItemNumber: row.ItemNumber,
			LocationID: row.LocationID, LocationName: row.LocationName,
			StorageSection: fallbackSection(row.StorageSection), ContainerNo: row.ContainerNo,
			AllocatedQty: row.AllocatedQty, Pallets: row.Pallets, CreatedAt: row.CreatedAt,
		})
	}
	return nil
}
func (s *Store) listOutboundLedgerAllocationRowsByLineIDs(ctx context.Context, lineIDs []int64) ([]outboundPickAllocationRow, error) {
	if len(lineIDs) == 0 {
		return []outboundPickAllocationRow{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			MIN(sl.id) AS id,
			sl.source_line_id AS line_id,
			COALESCE(NULLIF(sl.item_number_snapshot, ''), NULLIF(l.item_number_snapshot, ''), '') AS item_number,
			sl.location_id AS location_id,
			COALESCE(loc.name, l.location_name_snapshot) AS location_name_snapshot,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(sl.container_no_snapshot, '') AS container_no_snapshot,
			SUM(ABS(sl.quantity_change)) AS allocated_qty,
			ROUND(SUM(ABS(sl.pallet_change))) AS pallets,
			MIN(COALESCE(sl.occurred_at, sl.created_at)) AS created_at
		FROM stock_ledger sl
		JOIN outbound_document_lines l ON l.id = sl.source_line_id
		LEFT JOIN storage_locations loc ON loc.id = sl.location_id
		WHERE sl.source_document_type = ?
		  AND sl.event_type = ?
		  AND sl.source_line_id IN (?)
		GROUP BY
			sl.source_line_id,
			COALESCE(NULLIF(sl.item_number_snapshot, ''), NULLIF(l.item_number_snapshot, ''), ''),
			sl.location_id,
			COALESCE(loc.name, l.location_name_snapshot),
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP'),
			COALESCE(sl.container_no_snapshot, '')
		ORDER BY line_id ASC, id ASC
	`, StockLedgerSourceOutbound, StockLedgerEventShip, lineIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound ledger allocation query: %w", err)
	}

	rows := make([]outboundPickAllocationRow, 0)
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load outbound ledger allocations by line id: %w", err)
	}
	for index := range rows {
		rows[index].StorageSection = fallbackSection(rows[index].StorageSection)
		rows[index].ContainerNo = strings.TrimSpace(rows[index].ContainerNo)
	}
	return rows, nil
}

func splitProportionalFloat(total float64, totalQty int, allocations []outboundAllocationCandidate) []float64 {
	values := make([]float64, len(allocations))
	if len(allocations) == 0 || totalQty <= 0 || total == 0 {
		return values
	}

	remainingTotal := total
	remainingQty := totalQty
	for index, allocation := range allocations {
		if index == len(allocations)-1 || remainingQty <= 0 {
			values[index] = roundToTwoDecimals(remainingTotal)
			continue
		}

		share := roundToTwoDecimals(total * float64(allocation.AllocatedQty) / float64(totalQty))
		if share > remainingTotal {
			share = remainingTotal
		}
		values[index] = share
		remainingTotal = roundToTwoDecimals(remainingTotal - share)
		remainingQty -= allocation.AllocatedQty
	}

	return values
}

func roundToTwoDecimals(value float64) float64 {
	return math.Round(value*100) / 100
}

func recalculateOutboundDocumentStorages(documents []OutboundDocument) {
	for documentIndex := range documents {
		document := &documents[documentIndex]
		document.Storages = ""
		for _, line := range document.Lines {
			if len(line.PickAllocations) > 0 {
				for _, allocation := range line.PickAllocations {
					document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", allocation.LocationName, fallbackSection(allocation.StorageSection)))
				}
				continue
			}
			document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", line.LocationName, fallbackSection(line.StorageSection)))
		}
	}
}

func sanitizeOutboundDocumentInput(input CreateOutboundDocumentInput) CreateOutboundDocumentInput {
	input.PackingListNo = strings.TrimSpace(strings.ToUpper(input.PackingListNo))
	input.OrderRef = strings.TrimSpace(strings.ToUpper(input.OrderRef))
	input.ExpectedShipDate = strings.TrimSpace(input.ExpectedShipDate)
	input.ActualShipDate = strings.TrimSpace(input.ActualShipDate)
	input.ShipToName = strings.TrimSpace(input.ShipToName)
	input.ShipToAddress = strings.TrimSpace(input.ShipToAddress)
	input.ShipToContact = strings.TrimSpace(input.ShipToContact)
	input.CarrierName = strings.TrimSpace(input.CarrierName)
	input.Status = strings.TrimSpace(strings.ToUpper(input.Status))
	input.TrackingStatus = strings.TrimSpace(strings.ToUpper(input.TrackingStatus))
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)
	lines := make([]CreateOutboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.UnitLabel = strings.TrimSpace(strings.ToUpper(line.UnitLabel))
		line.CartonSizeMM = strings.TrimSpace(line.CartonSizeMM)
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.LineNote = strings.TrimSpace(line.LineNote)
		line.PickAllocations = normalizeOutboundPickAllocations(line.PickAllocations)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 || line.Quantity <= 0 {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateOutboundDocumentInput(input CreateOutboundDocumentInput) error {
	coalescedStatus := coalesceDocumentStatus(input.Status)
	if err := validateCreatableDocumentStatus(coalescedStatus); err != nil {
		return err
	}
	if normalizedTracking := normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus); normalizedTracking == "" {
		return fmt.Errorf("%w: invalid outbound tracking status", ErrInvalidInput)
	}
	if coalescedStatus == DocumentStatusConfirmed {
		normalizedTracking := normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus)
		if normalizedTracking != OutboundTrackingShipped && normalizedTracking != OutboundTrackingBOReceived {
			return fmt.Errorf("%w: confirmed shipments must use the shipped or BO received tracking status", ErrInvalidInput)
		}
	}
	if err := validateOutboundTrackingTransition(OutboundTrackingScheduled, normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus)); err != nil {
		return err
	}
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one outbound line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: warehouse is required", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: SKU is required", ErrInvalidInput)
		case line.Quantity <= 0:
			return fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
		case line.Pallets < 0:
			return fmt.Errorf("%w: pallets cannot be negative", ErrInvalidInput)
		case line.NetWeightKgs < 0 || line.GrossWeightKgs < 0:
			return fmt.Errorf("%w: weights cannot be negative", ErrInvalidInput)
		case len(line.PickAllocations) > 0 && totalOutboundPickAllocationQuantity(line.PickAllocations) != line.Quantity:
			return fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
		}
	}

	return nil
}

func resolveOutboundLedgerDate(expectedShipDate *time.Time, actualShipDate *time.Time) *time.Time {
	if actualShipDate != nil {
		return actualShipDate
	}
	return expectedShipDate
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

func normalizeOutboundPickAllocations(entries []OutboundPickAllocation) []OutboundPickAllocation {
	if len(entries) == 0 {
		return []OutboundPickAllocation{}
	}

	type groupedAllocation struct {
		ID             int64
		LineID         int64
		ItemNumber     string
		LocationID     int64
		LocationName   string
		StorageSection string
		ContainerNo    string
		AllocatedQty   int
		Pallets        int
		CreatedAt      time.Time
	}

	order := make([]string, 0, len(entries))
	grouped := make(map[string]*groupedAllocation, len(entries))
	for _, entry := range entries {
		allocatedQty := entry.AllocatedQty
		if allocatedQty <= 0 {
			continue
		}

		locationID := entry.LocationID
		storageSection := fallbackSection(entry.StorageSection)
		containerNo := strings.TrimSpace(entry.ContainerNo)
		itemNumber := strings.TrimSpace(entry.ItemNumber)
		key := fmt.Sprintf("%d|%s|%s|%s", locationID, storageSection, containerNo, itemNumber)

		existing, exists := grouped[key]
		if !exists {
			order = append(order, key)
			grouped[key] = &groupedAllocation{
				ID:             entry.ID,
				LineID:         entry.LineID,
				ItemNumber:     itemNumber,
				LocationID:     locationID,
				LocationName:   strings.TrimSpace(entry.LocationName),
				StorageSection: storageSection,
				ContainerNo:    containerNo,
				AllocatedQty:   allocatedQty,
				Pallets:        maxInt(entry.Pallets, 0),
				CreatedAt:      entry.CreatedAt,
			}
			continue
		}

		existing.AllocatedQty += allocatedQty
		existing.Pallets += maxInt(entry.Pallets, 0)
		if existing.LocationName == "" {
			existing.LocationName = strings.TrimSpace(entry.LocationName)
		}
		if existing.CreatedAt.IsZero() && !entry.CreatedAt.IsZero() {
			existing.CreatedAt = entry.CreatedAt
		}
		if existing.ID == 0 {
			existing.ID = entry.ID
		}
		if existing.LineID == 0 {
			existing.LineID = entry.LineID
		}
	}

	normalized := make([]OutboundPickAllocation, 0, len(order))
	for _, key := range order {
		entry := grouped[key]
		if entry == nil || entry.AllocatedQty <= 0 {
			continue
		}
		normalized = append(normalized, OutboundPickAllocation{
			ID:             entry.ID,
			LineID:         entry.LineID,
			ItemNumber:     entry.ItemNumber,
			LocationID:     entry.LocationID,
			LocationName:   entry.LocationName,
			StorageSection: entry.StorageSection,
			ContainerNo:    entry.ContainerNo,
			AllocatedQty:   entry.AllocatedQty,
			Pallets:        maxInt(entry.Pallets, 0),
			CreatedAt:      entry.CreatedAt,
		})
	}
	return normalized
}

func decodeOutboundPickAllocationsOrEmpty(raw string) []OutboundPickAllocation {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []OutboundPickAllocation{}
	}

	var entries []OutboundPickAllocation
	if err := json.Unmarshal([]byte(trimmed), &entries); err != nil {
		return []OutboundPickAllocation{}
	}
	return normalizeOutboundPickAllocations(entries)
}

func decodeOutboundDraftPickAllocationsOrEmpty(documentStatus string, lineID int64, raw string) []OutboundPickAllocation {
	if normalizeDocumentStatus(documentStatus) != DocumentStatusDraft {
		return []OutboundPickAllocation{}
	}

	entries := decodeOutboundPickAllocationsOrEmpty(raw)
	for index := range entries {
		entries[index].LineID = lineID
	}
	return entries
}

func mustEncodeOutboundPickAllocations(entries []OutboundPickAllocation) string {
	normalized := normalizeOutboundPickAllocations(entries)
	if len(normalized) == 0 {
		return ""
	}
	payload, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	return string(payload)
}

func totalOutboundPickAllocationQuantity(entries []OutboundPickAllocation) int {
	total := 0
	for _, entry := range entries {
		if entry.AllocatedQty > 0 {
			total += entry.AllocatedQty
		}
	}
	return total
}

func totalOutboundPickAllocationPallets(entries []OutboundPickAllocation) int {
	total := 0
	for _, entry := range entries {
		if entry.Pallets > 0 {
			total += entry.Pallets
		}
	}
	return total
}

func toOutboundAllocationCandidatesFromDraftPickAllocations(source lockedOutboundSource, entries []OutboundPickAllocation) []outboundAllocationCandidate {
	allocations := make([]outboundAllocationCandidate, 0, len(entries))
	for _, entry := range normalizeOutboundPickAllocations(entries) {
		allocations = append(allocations, outboundAllocationCandidate{
			BucketKey:      outboundAllocationBucketKey(source.CustomerID, firstNonZeroInt64(entry.LocationID, source.LocationID), source.SKUMasterID, entry.StorageSection, entry.ContainerNo),
			SKUMasterID:    source.SKUMasterID,
			CustomerID:     source.CustomerID,
			ItemNumber:     firstNonEmpty(strings.TrimSpace(entry.ItemNumber), source.ItemNumber),
			LocationID:     firstNonZeroInt64(entry.LocationID, source.LocationID),
			LocationName:   firstNonEmpty(strings.TrimSpace(entry.LocationName), source.LocationName),
			StorageSection: fallbackSection(entry.StorageSection),
			ContainerNo:    strings.TrimSpace(entry.ContainerNo),
			SKU:            source.SKU,
			Description:    source.Description,
			Unit:           source.Unit,
			AllocatedQty:   entry.AllocatedQty,
			Pallets:        maxInt(entry.Pallets, 0),
		})
	}
	return allocations
}

func toOutboundPickAllocationsFromCandidates(line *CreateOutboundDocumentLineInput, allocations []outboundAllocationCandidate) []OutboundPickAllocation {
	createdAt := time.Now().UTC()
	pickAllocations := make([]OutboundPickAllocation, 0, len(allocations))
	for _, allocation := range allocations {
		if allocation.AllocatedQty <= 0 {
			continue
		}
		pickAllocations = append(pickAllocations, OutboundPickAllocation{
			ItemNumber:     firstNonEmpty(strings.TrimSpace(allocation.ItemNumber)),
			LocationID:     allocation.LocationID,
			LocationName:   allocation.LocationName,
			StorageSection: fallbackSection(allocation.StorageSection),
			ContainerNo:    strings.TrimSpace(allocation.ContainerNo),
			AllocatedQty:   allocation.AllocatedQty,
			Pallets:        maxInt(allocation.Pallets, 0),
			CreatedAt:      createdAt,
		})
	}
	if line == nil {
		return normalizeOutboundPickAllocations(pickAllocations)
	}
	return normalizeOutboundPickAllocations(pickAllocations)
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
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
	return normalizeStorageSection(value)
}

func safeOutboundDateInput(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.DateOnly)
}
