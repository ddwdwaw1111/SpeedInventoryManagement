package service

import (
	"context"
	"database/sql"
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
	OutDate             *time.Time             `json:"outDate"`
	ShipToName          string                 `json:"shipToName"`
	ShipToAddress       string                 `json:"shipToAddress"`
	ShipToContact       string                 `json:"shipToContact"`
	CarrierName         string                 `json:"carrierName"`
	DocumentNote        string                 `json:"documentNote"`
	Status              string                 `json:"status"`
	TrackingStatus      string                 `json:"trackingStatus"`
	ConfirmedAt         *time.Time             `json:"confirmedAt"`
	CancelNote          string                 `json:"cancelNote"`
	CancelledAt         *time.Time             `json:"cancelledAt"`
	ArchivedAt          *time.Time             `json:"archivedAt"`
	TotalLines          int                    `json:"totalLines"`
	TotalQty            int                    `json:"totalQty"`
	TotalNetWeightKgs   float64                `json:"totalNetWeightKgs"`
	TotalGrossWeightKgs float64                `json:"totalGrossWeightKgs"`
	Storages            string                 `json:"storages"`
	Lines               []OutboundDocumentLine `json:"lines"`
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
	Pallets           int                      `json:"pallets"`
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
	PackingListNo  string                            `json:"packingListNo"`
	OrderRef       string                            `json:"orderRef"`
	OutDate        string                            `json:"outDate"`
	ShipToName     string                            `json:"shipToName"`
	ShipToAddress  string                            `json:"shipToAddress"`
	ShipToContact  string                            `json:"shipToContact"`
	CarrierName    string                            `json:"carrierName"`
	Status         string                            `json:"status"`
	TrackingStatus string                            `json:"trackingStatus"`
	DocumentNote   string                            `json:"documentNote"`
	Lines          []CreateOutboundDocumentLineInput `json:"lines"`
}

type CreateOutboundDocumentLineInput struct {
	CustomerID        int64   `json:"customerId"`
	LocationID        int64   `json:"locationId"`
	SKUMasterID       int64   `json:"skuMasterId"`
	Quantity          int     `json:"quantity"`
	Pallets           int     `json:"pallets"`
	PalletsDetailCtns string  `json:"palletsDetailCtns"`
	UnitLabel         string  `json:"unitLabel"`
	CartonSizeMM      string  `json:"cartonSizeMm"`
	NetWeightKgs      float64 `json:"netWeightKgs"`
	GrossWeightKgs    float64 `json:"grossWeightKgs"`
	LineNote          string  `json:"lineNote"`
}

type outboundDocumentRow struct {
	ID             int64      `db:"id"`
	PackingListNo  string     `db:"packing_list_no"`
	OrderRef       string     `db:"order_ref"`
	CustomerID     int64      `db:"customer_id"`
	CustomerName   string     `db:"customer_name"`
	OutDate        *time.Time `db:"out_date"`
	ShipToName     string     `db:"ship_to_name"`
	ShipToAddress  string     `db:"ship_to_address"`
	ShipToContact  string     `db:"ship_to_contact"`
	CarrierName    string     `db:"carrier_name"`
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

type CancelOutboundDocumentInput struct {
	Reason string `json:"reason"`
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
	CreatedAt      time.Time `db:"created_at"`
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
	AvailableQty int
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

func (s *Store) ListOutboundDocuments(ctx context.Context, limit int, archiveScope ...string) ([]OutboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}

	normalizedArchiveScope := DocumentArchiveScopeActive
	if len(archiveScope) > 0 {
		normalizedArchiveScope = normalizeDocumentArchiveScope(archiveScope[0])
	}
	archiveFilterClause := buildDocumentArchiveFilterClause("d", normalizedArchiveScope)

	documentRows := make([]outboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, fmt.Sprintf(`
		SELECT
			d.id,
			COALESCE(d.packing_list_no, '') AS packing_list_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.out_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE %s
		ORDER BY COALESCE(d.out_date, d.created_at) DESC, d.id DESC
		LIMIT ?
	`, archiveFilterClause), limit); err != nil {
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
			ID:             row.ID,
			PackingListNo:  row.PackingListNo,
			OrderRef:       row.OrderRef,
			CustomerID:     row.CustomerID,
			CustomerName:   row.CustomerName,
			OutDate:        row.OutDate,
			ShipToName:     row.ShipToName,
			ShipToAddress:  row.ShipToAddress,
			ShipToContact:  row.ShipToContact,
			CarrierName:    row.CarrierName,
			DocumentNote:   row.DocumentNote,
			Status:         normalizeDocumentStatus(row.Status),
			TrackingStatus: normalizeOutboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:    row.ConfirmedAt,
			CancelNote:     row.CancelNote,
			CancelledAt:    row.CancelledAt,
			ArchivedAt:     row.ArchivedAt,
			Lines:          make([]OutboundDocumentLine, 0),
			CreatedAt:      row.CreatedAt,
			UpdatedAt:      row.UpdatedAt,
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
			PickAllocations:   make([]OutboundPickAllocation, 0),
			CreatedAt:         lineRow.CreatedAt,
		})
		linesByID[lineRow.ID] = &document.Lines[len(document.Lines)-1]
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}

	if err := s.attachOutboundPickAllocations(ctx, linesByID); err != nil {
		return nil, err
	}
	recalculateOutboundDocumentStorages(documents)

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
	requestedStatus := coalesceDocumentStatus(input.Status)
	requestedTrackingStatus := coalesceOutboundTrackingStatus(input.TrackingStatus, requestedStatus)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound document transaction: %w", err)
	}
	defer tx.Rollback()

	lockedSources := make(map[string]lockedOutboundSource)
	reservationState := newOutboundAllocationReservationState()
	var customerID int64

	for _, line := range input.Lines {
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
		if _, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedSource, line.Quantity, reservationState); err != nil {
			return OutboundDocument{}, err
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
			out_date,
			ship_to_name,
			ship_to_address,
			ship_to_contact,
			carrier_name,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
	`,
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		customerID,
		nullableTime(outDate),
		nullableString(input.ShipToName),
		nullableString(input.ShipToAddress),
		nullableString(input.ShipToContact),
		nullableString(input.CarrierName),
		nullableString(input.DocumentNote),
		persistedStatus,
		requestedTrackingStatus,
	)
	if err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound document: %w", err))
	}

	documentID, err := result.LastInsertId()
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("resolve outbound document id: %w", err)
	}

	if err := s.insertOutboundDocumentLinesTx(ctx, tx, documentID, input, lockedSources); err != nil {
		return OutboundDocument{}, err
	}

	switch requestedStatus {
	case DocumentStatusConfirmed:
		if err := s.confirmOutboundDocumentTx(ctx, tx, documentID); err != nil {
			return OutboundDocument{}, err
		}
	case DocumentStatusDraft:
		// Draft documents keep stock unchanged until confirmed.
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound document: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) UpdateOutboundDocument(ctx context.Context, documentID int64, input CreateOutboundDocumentInput) (OutboundDocument, error) {
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
	if normalizeDocumentStatus(documentRow.Status) != DocumentStatusDraft {
		return OutboundDocument{}, fmt.Errorf("%w: only draft shipments can be edited", ErrInvalidInput)
	}

	lockedSources := make(map[string]lockedOutboundSource)
	reservationState := newOutboundAllocationReservationState()
	var customerID int64

	for _, line := range input.Lines {
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
		if _, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedSource, line.Quantity, reservationState); err != nil {
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
			out_date = ?,
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
		nullableTime(outDate),
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
		if err := s.confirmOutboundDocumentTx(ctx, tx, documentID); err != nil {
			return OutboundDocument{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound update: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func (s *Store) insertOutboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64, input CreateOutboundDocumentInput, lockedSources map[string]lockedOutboundSource) error {
	reservationState := newOutboundAllocationReservationState()
	for index, line := range input.Lines {
		lockedSource := lockedSources[buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)]
		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedSource, line.Quantity, reservationState)
		if err != nil {
			return err
		}
		lineLocationID := lockedSource.LocationID
		lineLocationName := lockedSource.LocationName
		lineStorageSection := DefaultStorageSection
		lineItemNumber := strings.TrimSpace(lockedSource.ItemNumber)
		if len(allocations) > 0 {
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
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	if status == DocumentStatusCancelled {
		return OutboundDocument{}, fmt.Errorf("%w: cancelled outbound document cannot be confirmed", ErrInvalidInput)
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
	if documentStatus == DocumentStatusCancelled {
		return OutboundDocument{}, fmt.Errorf("%w: cancelled shipment cannot change tracking status", ErrInvalidInput)
	}

	currentTrackingStatus := normalizeOutboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)
	targetTrackingStatus := normalizeOutboundTrackingStatus(trackingStatus, documentRow.Status)
	if err := validateOutboundTrackingTransition(currentTrackingStatus, targetTrackingStatus); err != nil {
		return OutboundDocument{}, err
	}

	if targetTrackingStatus == OutboundTrackingShipped {
		if documentStatus != DocumentStatusConfirmed {
			if err := s.confirmOutboundDocumentTx(ctx, tx, documentID); err != nil {
				return OutboundDocument{}, err
			}
		} else if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_documents
			SET tracking_status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, OutboundTrackingShipped, documentID); err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("update outbound tracking status: %w", err))
		}
	} else {
		if documentStatus == DocumentStatusConfirmed {
			return OutboundDocument{}, fmt.Errorf("%w: confirmed shipment tracking cannot move away from shipped", ErrInvalidInput)
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

func (s *Store) confirmOutboundDocumentTx(ctx context.Context, tx *sql.Tx, documentID int64) error {
	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return err
	}

	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusCancelled {
		return fmt.Errorf("%w: cancelled outbound document cannot be confirmed", ErrInvalidInput)
	}
	if status == DocumentStatusConfirmed {
		return fmt.Errorf("%w: outbound document is already confirmed", ErrInvalidInput)
	}

	lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return err
	}
	if len(lineRows) == 0 {
		return fmt.Errorf("%w: outbound document must contain at least one line", ErrInvalidInput)
	}

	lockedSources := make(map[string]lockedOutboundSource)
	reservationState := newOutboundAllocationReservationState()
	lineAllocations := make(map[int64][]outboundAllocationCandidate, len(lineRows))

	for _, lineRow := range lineRows {
		sourceKey := buildOutboundSourceKey(documentRow.CustomerID, lineRow.LocationID, lineRow.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if !exists {
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, documentRow.CustomerID, lineRow.LocationID, lineRow.SKUMasterID)
			if err != nil {
				return err
			}
			lockedSources[sourceKey] = lockedSource
		}

		lineInput := CreateOutboundDocumentLineInput{
			CustomerID:        documentRow.CustomerID,
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
		}

		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedSource, lineInput.Quantity, reservationState)
		if err != nil {
			return err
		}

		lineAllocations[lineRow.ID] = allocations
	}

	for _, lineRow := range lineRows {
		allocations := lineAllocations[lineRow.ID]
		if len(allocations) == 0 {
			return ErrInsufficientStock
		}

		netWeightSplits := splitProportionalFloat(lineRow.NetWeightKgs, lineRow.Quantity, allocations)
		grossWeightSplits := splitProportionalFloat(lineRow.GrossWeightKgs, lineRow.Quantity, allocations)
		allocationQuantities := make([]int, len(allocations))
		for index, allocation := range allocations {
			allocationQuantities[index] = allocation.AllocatedQty
		}
		allocationPalletSplits := splitPalletsByQuantities(float64(lineRow.Pallets), allocationQuantities)
		for allocationIndex, allocation := range allocations {
			palletConsumptions, err := s.consumePalletContentsForBucketTx(ctx, tx, palletSourceBucket{
				SKUMasterID:    lineRow.SKUMasterID,
				CustomerID:     documentRow.CustomerID,
				LocationID:     allocation.LocationID,
				StorageSection: allocation.StorageSection,
				ContainerNo:    allocation.ContainerNo,
			}, allocation.AllocatedQty)
			if err != nil {
				return fmt.Errorf("allocate pallet contents for outbound movement: %w", err)
			}
			if len(palletConsumptions) == 0 {
				return ErrInsufficientStock
			}

			for _, palletConsumption := range palletConsumptions {
				if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
					PalletID:         palletConsumption.PalletID,
					ContainerVisitID: palletConsumption.ContainerVisitID,
					CustomerID:       palletConsumption.CustomerID,
					LocationID:       palletConsumption.LocationID,
					StorageSection:   palletConsumption.StorageSection,
					ContainerNo:      firstNonEmpty(palletConsumption.ContainerNo, allocation.ContainerNo),
					EventType:        PalletEventOutbound,
					QuantityDelta:    -palletConsumption.Quantity,
				}); err != nil {
					return err
				}
				if err := s.createOutboundPickTx(ctx, tx, createOutboundPickInput{
					OutboundLineID: lineRow.ID,
					PalletID:       palletConsumption.PalletID,
					PalletItemID:   palletConsumption.PalletItemID,
					PickedQty:      palletConsumption.Quantity,
				}); err != nil {
					return err
				}
				_, err := s.createStockLedgerEntryTx(ctx, tx, createStockLedgerInput{
					EventType:           StockLedgerEventShip,
					PalletID:            palletConsumption.PalletID,
					PalletItemID:        palletConsumption.PalletItemID,
					SKUMasterID:         palletConsumption.SKUMasterID,
					CustomerID:          palletConsumption.CustomerID,
					LocationID:          palletConsumption.LocationID,
					StorageSection:      palletConsumption.StorageSection,
					QuantityChange:      -palletConsumption.Quantity,
					SourceDocumentType:  StockLedgerSourceOutbound,
					SourceDocumentID:    documentID,
					SourceLineID:        lineRow.ID,
					ContainerNo:         firstNonEmpty(palletConsumption.ContainerNo, allocation.ContainerNo),
					OutDate:             documentRow.OutDate,
					PackingListNo:       documentRow.PackingListNo,
					OrderRef:            documentRow.OrderRef,
					ItemNumber:          firstNonEmpty(allocation.ItemNumber, lineRow.ItemNumberSnapshot),
					DescriptionSnapshot: firstNonEmpty(allocation.Description, lineRow.DescriptionSnapshot),
					Pallets:             roundedPalletInt(allocationPalletSplits[allocationIndex]),
					PalletsDetailCtns:   lineRow.PalletsDetailCtns,
					CartonSizeMM:        lineRow.CartonSizeMM,
					CartonCount:         allocation.AllocatedQty,
					UnitLabel:           firstNonEmpty(lineRow.UnitLabel, strings.ToUpper(allocation.Unit), "PCS"),
					NetWeightKgs:        netWeightSplits[allocationIndex],
					GrossWeightKgs:      grossWeightSplits[allocationIndex],
					HeightIn:            0,
					DocumentNote:        documentRow.DocumentNote,
					Reason:              firstNonEmpty(lineRow.LineNote, defaultMovementReason("OUT")),
				})
				if err != nil {
					return err
				}
			}
		}

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
	`, DocumentStatusConfirmed, OutboundTrackingShipped, confirmedAt, documentID); err != nil {
		return mapDBError(fmt.Errorf("mark outbound document confirmed: %w", err))
	}

	return nil
}

func (s *Store) CancelOutboundDocument(ctx context.Context, documentID int64, input CancelOutboundDocumentInput) (OutboundDocument, error) {
	input.Reason = strings.TrimSpace(input.Reason)

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
	if status == DocumentStatusCancelled {
		return OutboundDocument{}, fmt.Errorf("%w: outbound document is already cancelled", ErrInvalidInput)
	}

	cancellationReason := firstNonEmpty(input.Reason, fmt.Sprintf("Reversal of outbound %s", firstNonEmpty(documentRow.PackingListNo, fmt.Sprintf("OUT-%d", documentID))))
	cancelledAt := time.Now().UTC()

	if status == DocumentStatusConfirmed {
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
		if err != nil {
			return OutboundDocument{}, err
		}

		lineIDs := make([]int64, 0, len(lineRows))
		for _, lineRow := range lineRows {
			lineIDs = append(lineIDs, lineRow.ID)
		}

		for _, lineRow := range lineRows {
			restoredPalletPicks, err := s.restorePalletContentsForLineTx(ctx, tx, lineRow.ID)
			if err != nil {
				return OutboundDocument{}, err
			}
			restoreQuantities := make([]int, len(restoredPalletPicks))
			for index, restoredPalletPick := range restoredPalletPicks {
				restoreQuantities[index] = restoredPalletPick.PickedQty
			}
			restorePalletSplits := splitPalletsByQuantities(float64(lineRow.Pallets), restoreQuantities)
			for index, restoredPalletPick := range restoredPalletPicks {
				if err := s.createPalletLocationEventTx(ctx, tx, createPalletLocationEventInput{
					PalletID:       restoredPalletPick.PalletID,
					CustomerID:     restoredPalletPick.CustomerID,
					LocationID:     restoredPalletPick.LocationID,
					StorageSection: restoredPalletPick.StorageSection,
					ContainerNo:    restoredPalletPick.ContainerNo,
					EventType:      PalletEventReversal,
					QuantityDelta:  restoredPalletPick.PickedQty,
					PalletDelta:    restorePalletSplits[index],
				}); err != nil {
					return OutboundDocument{}, err
				}
				if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
					EventType:           StockLedgerEventReversal,
					PalletID:            restoredPalletPick.PalletID,
					PalletItemID:        restoredPalletPick.PalletItemID,
					SKUMasterID:         restoredPalletPick.SKUMasterID,
					CustomerID:          restoredPalletPick.CustomerID,
					LocationID:          restoredPalletPick.LocationID,
					StorageSection:      restoredPalletPick.StorageSection,
					QuantityChange:      restoredPalletPick.PickedQty,
					SourceDocumentType:  StockLedgerSourceOutbound,
					SourceDocumentID:    documentID,
					SourceLineID:        lineRow.ID,
					ContainerNo:         restoredPalletPick.ContainerNo,
					OutDate:             documentRow.OutDate,
					PackingListNo:       documentRow.PackingListNo,
					OrderRef:            documentRow.OrderRef,
					ItemNumber:          lineRow.ItemNumberSnapshot,
					DescriptionSnapshot: lineRow.DescriptionSnapshot,
					Pallets:             lineRow.Pallets,
					PalletsDetailCtns:   lineRow.PalletsDetailCtns,
					CartonSizeMM:        lineRow.CartonSizeMM,
					CartonCount:         lineRow.Quantity,
					UnitLabel:           firstNonEmpty(lineRow.UnitLabel, "PCS"),
					NetWeightKgs:        lineRow.NetWeightKgs,
					GrossWeightKgs:      lineRow.GrossWeightKgs,
					Reason:              cancellationReason,
				}); err != nil {
					return OutboundDocument{}, err
				}
			}

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
	`, nullableString(cancellationReason), cancelledAt, documentID); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("cancel outbound document: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound cancel: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
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
			out_date,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
	`,
		nullableString(documentRow.PackingListNo),
		nullableString(documentRow.OrderRef),
		documentRow.CustomerID,
		nullableTime(documentRow.OutDate),
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
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			d.out_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			COALESCE(d.cancel_note, '') AS cancel_note,
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
		&documentRow.OutDate,
		&documentRow.ShipToName,
		&documentRow.ShipToAddress,
		&documentRow.ShipToContact,
		&documentRow.CarrierName,
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
			d.out_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			COALESCE(d.cancel_note, '') AS cancel_note,
			d.cancelled_at,
			d.archived_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE d.id IN (?)
		%s
		ORDER BY COALESCE(d.out_date, d.created_at) DESC, d.id DESC
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
			ID:             row.ID,
			PackingListNo:  row.PackingListNo,
			OrderRef:       row.OrderRef,
			CustomerID:     row.CustomerID,
			CustomerName:   row.CustomerName,
			OutDate:        row.OutDate,
			ShipToName:     row.ShipToName,
			ShipToAddress:  row.ShipToAddress,
			ShipToContact:  row.ShipToContact,
			CarrierName:    row.CarrierName,
			DocumentNote:   row.DocumentNote,
			Status:         normalizeDocumentStatus(row.Status),
			TrackingStatus: normalizeOutboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:    row.ConfirmedAt,
			CancelNote:     row.CancelNote,
			CancelledAt:    row.CancelledAt,
			ArchivedAt:     row.ArchivedAt,
			Lines:          make([]OutboundDocumentLine, 0),
			CreatedAt:      row.CreatedAt,
			UpdatedAt:      row.UpdatedAt,
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
			PickAllocations:   make([]OutboundPickAllocation, 0),
			CreatedAt:         lineRow.CreatedAt,
		})
		linesByID[lineRow.ID] = &document.Lines[len(document.Lines)-1]
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}

	if err := s.attachOutboundPickAllocations(ctx, linesByID); err != nil {
		return nil, err
	}
	recalculateOutboundDocumentStorages(documents)

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

func outboundAllocationBucketKey(storageSection string, containerNo string) string {
	return fmt.Sprintf("%s|%s", fallbackSection(storageSection), strings.TrimSpace(containerNo))
}

func (s *Store) loadLockedOutboundSourceTx(ctx context.Context, tx *sql.Tx, customerID int64, locationID int64, skuMasterID int64) (lockedOutboundSource, error) {
	var source lockedOutboundSource
	if err := tx.QueryRowContext(ctx, `
		SELECT
			pi.sku_master_id,
			p.customer_id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			p.current_location_id,
			l.name,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			GREATEST(
				SUM(pi.quantity) - SUM(pi.allocated_qty) - SUM(pi.damaged_qty) - SUM(pi.hold_qty),
				0
			) AS available_qty
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		JOIN sku_master sm ON sm.id = pi.sku_master_id
		JOIN storage_locations l ON l.id = p.current_location_id
		WHERE pi.sku_master_id = ?
		  AND p.customer_id = ?
		  AND p.current_location_id = ?
		  AND pi.quantity > 0
		  AND p.status <> ?
		GROUP BY
			pi.sku_master_id,
			p.customer_id,
			sm.item_number,
			p.current_location_id,
			l.name,
			sm.sku,
			sm.description,
			sm.name,
			sm.unit
	`,
		skuMasterID,
		customerID,
		locationID,
		PalletStatusCancelled,
	).Scan(
		&source.SKUMasterID,
		&source.CustomerID,
		&source.ItemNumber,
		&source.LocationID,
		&source.LocationName,
		&source.SKU,
		&source.Description,
		&source.Unit,
		&source.AvailableQty,
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
			pi.sku_master_id,
			p.customer_id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			p.current_location_id,
			l.name,
			COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(p.current_container_no, '') AS container_no,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			GREATEST(
				SUM(pi.quantity) - SUM(pi.allocated_qty) - SUM(pi.damaged_qty) - SUM(pi.hold_qty),
				0
			) AS available_qty,
			COALESCE(d.delivery_date, cv.arrival_date, DATE(MIN(p.created_at))) AS delivery_date,
			MIN(p.created_at) AS sort_at
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		JOIN sku_master sm ON sm.id = pi.sku_master_id
		JOIN storage_locations l ON l.id = p.current_location_id
		LEFT JOIN container_visits cv ON cv.id = p.container_visit_id
		LEFT JOIN inbound_documents d ON d.id = COALESCE(p.source_inbound_document_id, cv.inbound_document_id)
		WHERE
			p.customer_id = ?
			AND p.current_location_id = ?
			AND pi.sku_master_id = ?
			AND pi.quantity > 0
			AND p.status <> ?
		GROUP BY
			pi.sku_master_id,
			p.customer_id,
			sm.item_number,
			p.current_location_id,
			l.name,
			COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP'),
			COALESCE(p.current_container_no, ''),
			sm.sku,
			sm.description,
			sm.name,
			sm.unit,
			d.delivery_date,
			cv.arrival_date
		HAVING GREATEST(
			SUM(pi.quantity) - SUM(pi.allocated_qty) - SUM(pi.damaged_qty) - SUM(pi.hold_qty),
			0
		) > 0
		ORDER BY
			CASE WHEN delivery_date IS NULL THEN 1 ELSE 0 END,
			delivery_date ASC,
			sort_at ASC,
			storage_section ASC,
			container_no ASC
		FOR UPDATE
	`,
		source.CustomerID,
		source.LocationID,
		source.SKUMasterID,
		PalletStatusCancelled,
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
		row.BucketKey = outboundAllocationBucketKey(row.StorageSection, row.ContainerNo)

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

func (s *Store) allocateOutboundLineTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	if requestedQty <= 0 {
		return nil, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
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
		return nil, ErrInsufficientStock
	}

	return allocations, nil
}

func (s *Store) resolveOutboundLineAllocationsTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	return s.allocateOutboundLineTx(ctx, tx, source, requestedQty, reservationState)
}

func (s *Store) attachOutboundPickAllocations(ctx context.Context, linesByID map[int64]*OutboundDocumentLine) error {
	if len(linesByID) == 0 {
		return nil
	}

	lineIDs := make([]int64, 0, len(linesByID))
	for lineID := range linesByID {
		lineIDs = append(lineIDs, lineID)
	}

	attachedLineIDs := make(map[int64]struct{}, len(lineIDs))
	pickAllocationRows, err := s.listOutboundPickRowsByLineIDs(ctx, lineIDs)
	if err != nil {
		return err
	}
	for _, allocationRow := range pickAllocationRows {
		line := linesByID[allocationRow.LineID]
		if line == nil {
			continue
		}
		line.PickAllocations = append(line.PickAllocations, OutboundPickAllocation{
			ID:             allocationRow.ID,
			LineID:         allocationRow.LineID,
			ItemNumber:     allocationRow.ItemNumber,
			LocationID:     allocationRow.LocationID,
			LocationName:   allocationRow.LocationName,
			StorageSection: fallbackSection(allocationRow.StorageSection),
			ContainerNo:    allocationRow.ContainerNo,
			AllocatedQty:   allocationRow.AllocatedQty,
			CreatedAt:      allocationRow.CreatedAt,
		})
		attachedLineIDs[allocationRow.LineID] = struct{}{}
	}

	fallbackLineIDs := make([]int64, 0, len(lineIDs))
	for _, lineID := range lineIDs {
		if _, attached := attachedLineIDs[lineID]; attached {
			continue
		}
		fallbackLineIDs = append(fallbackLineIDs, lineID)
	}
	if len(fallbackLineIDs) == 0 {
		return nil
	}

	ledgerAllocationRows, err := s.listOutboundLedgerAllocationRowsByLineIDs(ctx, fallbackLineIDs)
	if err != nil {
		return err
	}
	for _, allocationRow := range ledgerAllocationRows {
		line := linesByID[allocationRow.LineID]
		if line == nil {
			continue
		}
		line.PickAllocations = append(line.PickAllocations, OutboundPickAllocation{
			ID:             allocationRow.ID,
			LineID:         allocationRow.LineID,
			ItemNumber:     allocationRow.ItemNumber,
			LocationID:     allocationRow.LocationID,
			LocationName:   allocationRow.LocationName,
			StorageSection: fallbackSection(allocationRow.StorageSection),
			ContainerNo:    allocationRow.ContainerNo,
			AllocatedQty:   allocationRow.AllocatedQty,
			CreatedAt:      allocationRow.CreatedAt,
		})
		attachedLineIDs[allocationRow.LineID] = struct{}{}
	}

	return nil
}

func (s *Store) listOutboundPickRowsByLineIDs(ctx context.Context, lineIDs []int64) ([]outboundPickAllocationRow, error) {
	if len(lineIDs) == 0 {
		return []outboundPickAllocationRow{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			MIN(op.id) AS id,
			op.outbound_line_id AS line_id,
			COALESCE(NULLIF(l.item_number_snapshot, ''), sm.item_number, '') AS item_number,
			p.current_location_id AS location_id,
			COALESCE(sl.name, l.location_name_snapshot) AS location_name_snapshot,
			COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(p.current_container_no, '') AS container_no_snapshot,
			SUM(op.picked_qty) AS allocated_qty,
			MIN(op.created_at) AS created_at
		FROM outbound_picks op
		JOIN pallets p ON p.id = op.pallet_id
		JOIN outbound_document_lines l ON l.id = op.outbound_line_id
		LEFT JOIN sku_master sm ON sm.id = p.sku_master_id
		LEFT JOIN storage_locations sl ON sl.id = p.current_location_id
		WHERE op.outbound_line_id IN (?)
		GROUP BY
			op.outbound_line_id,
			COALESCE(NULLIF(l.item_number_snapshot, ''), sm.item_number, ''),
			p.current_location_id,
			COALESCE(sl.name, l.location_name_snapshot),
			COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP'),
			COALESCE(p.current_container_no, '')
		ORDER BY line_id ASC, id ASC
	`, lineIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound picks query: %w", err)
	}

	rows := make([]outboundPickAllocationRow, 0)
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load outbound picks by line id: %w", err)
	}
	for index := range rows {
		rows[index].StorageSection = fallbackSection(rows[index].StorageSection)
		rows[index].ContainerNo = strings.TrimSpace(rows[index].ContainerNo)
	}
	return rows, nil
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
			MIN(sl.created_at) AS created_at
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
	if coalescedStatus == DocumentStatusConfirmed && normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus) != OutboundTrackingShipped {
		return fmt.Errorf("%w: confirmed shipments must use the shipped tracking status", ErrInvalidInput)
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
	return normalizeStorageSection(value)
}

func safeOutboundDateInput(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.DateOnly)
}
