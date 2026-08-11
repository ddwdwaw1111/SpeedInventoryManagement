package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type OutboundDocument struct {
	ID                  int64                  `json:"id"`
	PickingOrderNo      string                 `json:"pickingOrderNo"`
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
	TotalLines          int                    `json:"totalLines"`
	TotalQty            int                    `json:"totalQty"`
	TotalPlannedQty     int                    `json:"totalPlannedQty"`
	TotalActualQty      int                    `json:"totalActualQty"`
	TotalNetWeightKgs   float64                `json:"totalNetWeightKgs"`
	TotalGrossWeightKgs float64                `json:"totalGrossWeightKgs"`
	Storages            string                 `json:"storages"`
	Lines               []OutboundDocumentLine `json:"lines"`
	Attachments         []DocumentAttachment   `json:"attachments"`
	CreatedAt           time.Time              `json:"createdAt"`
	UpdatedAt           time.Time              `json:"updatedAt"`
}

type OutboundPickAllocation struct {
	ID                     int64     `json:"id"`
	LineID                 int64     `json:"lineId"`
	ItemNumber             string    `json:"itemNumber"`
	LocationID             int64     `json:"locationId"`
	LocationName           string    `json:"locationName"`
	StorageSection         string    `json:"storageSection"`
	ContainerNo            string    `json:"containerNo"`
	AllocatedQty           int       `json:"allocatedQty"`
	Pallets                int       `json:"pallets"`              // Physical inventory pallets released; derived from the final balance when provided.
	InventoryPalletsUsed   int       `json:"inventoryPalletsUsed"` // Inventory pallet units assigned to the pick; may be zero for partial-pallet carton picks.
	StartingPallets        *int      `json:"startingPallets,omitempty"`
	RemainingPallets       *int      `json:"remainingPallets,omitempty"`
	SourceLocationID       int64     `json:"sourceLocationId,omitempty"`
	SourceTransferID       int64     `json:"sourceTransferId,omitempty"`
	SourceLocationName     string    `json:"sourceLocationName,omitempty"`
	SourceStorageSection   string    `json:"sourceStorageSection,omitempty"`
	SourceStartingPallets  *int      `json:"sourceStartingPallets,omitempty"`
	SourceRemainingPallets *int      `json:"sourceRemainingPallets,omitempty"`
	AutoTransferToMain     bool      `json:"autoTransferToMain,omitempty"`
	CreatedAt              time.Time `json:"createdAt"`
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
	Quantity          int                      `json:"quantity"` // Deprecated alias for actualQuantity.
	PlannedQuantity   int                      `json:"plannedQuantity"`
	ActualQuantity    int                      `json:"actualQuantity"`
	Pallets           int                      `json:"pallets"` // Repalletized outbound/shipping pallet count.
	PalletsDetailCtns string                   `json:"palletsDetailCtns"`
	UnitLabel         string                   `json:"unitLabel"`
	CartonSizeMM      string                   `json:"cartonSizeMm"`
	NetWeightKgs      float64                  `json:"netWeightKgs"`
	GrossWeightKgs    float64                  `json:"grossWeightKgs"`
	LineNote          string                   `json:"lineNote"`
	HasPickSnapshot   bool                     `json:"hasStoredPickAllocations"`
	PickAllocations   []OutboundPickAllocation `json:"pickAllocations"`
	CreatedAt         time.Time                `json:"createdAt"`
}

type CreateOutboundDocumentInput struct {
	PickingOrderNo   string                            `json:"pickingOrderNo"`
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
	Quantity          int                      `json:"quantity"` // Backward-compatible alias for actualQuantity.
	PlannedQuantity   int                      `json:"plannedQuantity"`
	ActualQuantity    int                      `json:"actualQuantity"`
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
	PickingOrderNo   string     `db:"picking_order_no"`
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
	CreatedAt        time.Time  `db:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at"`
}

type outboundDocumentLineRow struct {
	ID                  int64   `db:"id"`
	DocumentID          int64   `db:"document_id"`
	SKUMasterID         int64   `db:"sku_master_id"`
	ItemNumberSnapshot  string  `db:"item_number_snapshot"`
	LocationID          int64   `db:"location_id"`
	LocationName        string  `db:"location_name_snapshot"`
	StorageSection      string  `db:"storage_section"`
	SKUSnapshot         string  `db:"sku_snapshot"`
	DescriptionSnapshot string  `db:"description_snapshot"`
	Quantity            int     `db:"quantity"`
	PlannedQuantity     int     `db:"planned_quantity"`
	Pallets             int     `db:"pallets"`
	PalletsDetailCtns   string  `db:"pallets_detail_ctns"`
	UnitLabel           string  `db:"unit_label"`
	CartonSizeMM        string  `db:"carton_size_mm"`
	NetWeightKgs        float64 `db:"net_weight_kgs"`
	GrossWeightKgs      float64 `db:"gross_weight_kgs"`
	LineNote            string  `db:"line_note"`
	PickAllocations     []OutboundPickAllocation
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
	ID                   int64  `db:"id"`
	OutboundLineID       int64  `db:"outbound_line_id"`
	ContainerID          int64  `db:"container_id"`
	ContainerNo          string `db:"container_no"`
	CustomerID           int64  `db:"customer_id"`
	SKUMasterID          int64  `db:"sku_master_id"`
	LocationID           int64  `db:"location_id"`
	StorageSection       string `db:"storage_section"`
	AllocatedQty         int    `db:"allocated_qty"`
	InventoryPalletsUsed int    `db:"inventory_pallets_used"`
	Status               string `db:"status"`
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
	BucketKey              string
	SKUMasterID            int64
	CustomerID             int64
	ItemNumber             string
	LocationID             int64
	LocationName           string
	StorageSection         string
	ContainerNo            string
	SKU                    string
	Description            string
	Unit                   string
	AvailableQty           int
	AvailablePallets       int
	OnHandQty              int
	OnHandPallets          int
	AllocatedQty           int
	Pallets                int
	InventoryPalletsUsed   int
	StartingPallets        *int
	RemainingPallets       *int
	SourceLocationID       int64
	SourceTransferID       int64
	SourceLocationName     string
	SourceStorageSection   string
	SourceStartingPallets  *int
	SourceRemainingPallets *int
	AutoTransferToMain     bool
	SortAt                 time.Time
}

type outboundAllocationReservationState struct {
	ByBucketKey        map[string]int
	PalletsByBucketKey map[string]int
}

type lockedOutboundSourceRow struct {
	BucketKey        string
	SKUMasterID      int64
	CustomerID       int64
	ItemNumber       string
	LocationID       int64
	LocationName     string
	StorageSection   string
	ContainerNo      string
	SKU              string
	Description      string
	Unit             string
	AvailableQty     int
	AvailablePallets int
	OnHandQty        int
	OnHandPallets    int
	DeliveryDate     *time.Time
	CreatedAt        time.Time
}

type OutboundDocumentFilters struct {
	ExportCursor   bool
	BeforeID       int64
	Search         string
	CustomerID     int64
	LocationID     int64
	Status         string
	TrackingStatus string
}

func (s *Store) ListOutboundDocuments(ctx context.Context, limit int) ([]OutboundDocument, error) {
	return s.ListOutboundDocumentsFiltered(ctx, limit, OutboundDocumentFilters{})
}

func (s *Store) ListOutboundDocumentsFiltered(ctx context.Context, limit int, filters OutboundDocumentFilters) ([]OutboundDocument, error) {
	if limit <= 0 {
		limit = 50
	}
	whereClauses := []string{
		"UPPER(TRIM(d.status)) NOT IN ('DELETED', 'CANCELLED')",
	}
	args := make([]any, 0, 20)
	orderBy := "COALESCE(d.actual_ship_date, d.expected_ship_date, d.created_at) DESC, d.id DESC"
	if filters.ExportCursor {
		orderBy = "d.id DESC"
		if filters.BeforeID > 0 {
			whereClauses = append(whereClauses, "d.id < ?")
			args = append(args, filters.BeforeID)
		}
	}
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
			LOWER(COALESCE(d.picking_order_no, '')) LIKE ?
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
						OR EXISTS (
							SELECT 1 FROM outbound_container_allocations oca
							JOIN containers allocation_container ON allocation_container.id = oca.container_id
							WHERE oca.outbound_line_id = ol.id
							  AND LOWER(allocation_container.container_no) LIKE ?
						)
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
			COALESCE(d.picking_order_no, '') AS picking_order_no,
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
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE %s
		ORDER BY %s
		LIMIT ?
	`, strings.Join(whereClauses, " AND "), orderBy), args...); err != nil {
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
			PickingOrderNo:   row.PickingOrderNo,
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
			CASE WHEN planned_quantity > 0 THEN planned_quantity ELSE quantity END AS planned_quantity,
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
		storedPickAllocations := outboundStoredPickAllocations(lineRow.ID, lineRow.PickAllocations)

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
			PlannedQuantity:   lineRow.PlannedQuantity,
			ActualQuantity:    lineRow.Quantity,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			CartonSizeMM:      lineRow.CartonSizeMM,
			NetWeightKgs:      lineRow.NetWeightKgs,
			GrossWeightKgs:    lineRow.GrossWeightKgs,
			LineNote:          lineRow.LineNote,
			HasPickSnapshot:   len(storedPickAllocations) > 0,
			PickAllocations:   storedPickAllocations,
			CreatedAt:         lineRow.CreatedAt,
		})
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalPlannedQty += lineRow.PlannedQuantity
		document.TotalActualQty += lineRow.Quantity
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
	if document.CustomerID != customerID || normalizeDocumentStatus(document.Status) == DocumentStatusDeleted {
		return OutboundDocument{}, ErrNotFound
	}
	return document, nil
}

func (s *Store) CreateOutboundDocument(ctx context.Context, input CreateOutboundDocumentInput) (OutboundDocument, error) {
	input, expectedShipDate, actualShipDate, requestedStatus, requestedTrackingStatus, err := prepareOutboundDocumentCreation(input)
	if err != nil {
		return OutboundDocument{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound document transaction: %w", err)
	}
	defer tx.Rollback()
	customerIDs := make([]int64, 0, len(input.Lines))
	for _, line := range input.Lines {
		customerIDs = append(customerIDs, line.CustomerID)
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, customerIDs); err != nil {
		return OutboundDocument{}, err
	}

	documentID, err := s.createOutboundDocumentTx(ctx, tx, input, expectedShipDate, actualShipDate, requestedStatus, requestedTrackingStatus)
	if err != nil {
		return OutboundDocument{}, err
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound document: %w", err)
	}

	return s.getOutboundDocument(ctx, documentID)
}

func prepareOutboundDocumentCreation(input CreateOutboundDocumentInput) (CreateOutboundDocumentInput, *time.Time, *time.Time, string, string, error) {
	input = sanitizeOutboundDocumentInput(input)
	if err := validateOutboundDocumentInput(input); err != nil {
		return CreateOutboundDocumentInput{}, nil, nil, "", "", err
	}

	expectedShipDate, err := parseOptionalDate(strings.TrimSpace(input.ExpectedShipDate))
	if err != nil {
		return CreateOutboundDocumentInput{}, nil, nil, "", "", err
	}
	actualShipDate, err := parseOptionalDate(input.ActualShipDate)
	if err != nil {
		return CreateOutboundDocumentInput{}, nil, nil, "", "", err
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
	return input, expectedShipDate, actualShipDate, requestedStatus, requestedTrackingStatus, nil
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
	inventoryBackedSources := make(map[string]bool)
	reservationState := newOutboundAllocationReservationState()
	var customerID int64
	var err error

	for lineIndex := range input.Lines {
		line := &input.Lines[lineIndex]
		sourceKey := buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if outboundLineReservationQuantity(*line) > 0 && (!exists || !inventoryBackedSources[sourceKey]) {
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, line.CustomerID, line.LocationID, line.SKUMasterID)
			if err != nil {
				return 0, err
			}
			lockedSources[sourceKey] = lockedSource
			inventoryBackedSources[sourceKey] = true
		} else if !exists {
			lockedSource, err = s.loadOutboundSourceReferenceTx(ctx, tx, line.CustomerID, line.LocationID, line.SKUMasterID)
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
			picking_order_no,
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
		nullableString(input.PickingOrderNo),
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
	existingCustomerID, err := loadOutboundDocumentCustomerIDTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	customerIDs := make([]int64, 0, len(input.Lines)+1)
	customerIDs = append(customerIDs, existingCustomerID)
	for _, line := range input.Lines {
		customerIDs = append(customerIDs, line.CustomerID)
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, customerIDs); err != nil {
		return OutboundDocument{}, err
	}

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
	preserveMainWarehouseTransfer := outboundLineRowsHavePendingMainWarehouseTransfer(existingLineRows)
	var mainOutboundLocationID int64
	if preserveMainWarehouseTransfer {
		mainLocation, err := resolveMainOutboundLocationTx(ctx, tx)
		if err != nil {
			return OutboundDocument{}, err
		}
		mainOutboundLocationID = mainLocation.ID
	}
	if outboundTrackingRequiresActiveReservation(existingTrackingStatus) {
		if err := s.releaseOutboundDocumentReservationsTx(ctx, tx, existingLineRows); err != nil {
			return OutboundDocument{}, err
		}
	}

	lockedSources := make(map[string]lockedOutboundSource)
	inventoryBackedSources := make(map[string]bool)
	reservationState := newOutboundAllocationReservationState()
	var customerID int64

	for lineIndex := range input.Lines {
		line := &input.Lines[lineIndex]
		sourceKey := buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if outboundLineReservationQuantity(*line) > 0 && (!exists || !inventoryBackedSources[sourceKey]) {
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, line.CustomerID, line.LocationID, line.SKUMasterID)
			if err != nil {
				return OutboundDocument{}, err
			}
			lockedSources[sourceKey] = lockedSource
			inventoryBackedSources[sourceKey] = true
		} else if !exists {
			lockedSource, err = s.loadOutboundSourceReferenceTx(ctx, tx, line.CustomerID, line.LocationID, line.SKUMasterID)
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
		allocations, err := s.prepareOutboundDraftLineAllocationsTx(ctx, tx, lockedSource, line, reservationState)
		if err != nil {
			return OutboundDocument{}, err
		}
		if preserveMainWarehouseTransfer {
			if len(line.PickAllocations) == 0 {
				line.PickAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
			}
			for allocationIndex := range line.PickAllocations {
				allocation := &line.PickAllocations[allocationIndex]
				allocation.AutoTransferToMain = firstNonZeroInt64(allocation.LocationID, line.LocationID) != mainOutboundLocationID
			}
		}
	}

	persistedStatus := requestedStatus
	if requestedStatus == DocumentStatusConfirmed {
		persistedStatus = DocumentStatusDraft
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET
			picking_order_no = ?,
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
		nullableString(input.PickingOrderNo),
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

func outboundLineRowsHavePendingMainWarehouseTransfer(lineRows []outboundDocumentLineRow) bool {
	for _, lineRow := range lineRows {
		for _, allocation := range lineRow.PickAllocations {
			if allocation.AutoTransferToMain {
				return true
			}
		}
	}
	return false
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
	if normalizeDocumentStatus(documentRow.Status) == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: deleted shipment cannot update its note", ErrInvalidInput)
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
	if document.PickingOrderNo == "" {
		document.PickingOrderNo = documentRow.PickingOrderNo
	}
	return document, nil
}

func (s *Store) insertOutboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64, input CreateOutboundDocumentInput, lockedSources map[string]lockedOutboundSource) error {
	reservationState := newOutboundAllocationReservationState()
	for index, line := range input.Lines {
		line = normalizeOutboundLineQuantities(line)
		lockedSource := lockedSources[buildOutboundSourceKey(line.CustomerID, line.LocationID, line.SKUMasterID)]
		allocations := make([]outboundAllocationCandidate, 0)
		if len(line.PickAllocations) == 0 && outboundLineReservationQuantity(line) > 0 {
			var err error
			allocations, err = s.resolveOutboundLineAllocationsTx(ctx, tx, lockedSource, outboundLineReservationQuantity(line), reservationState)
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
				planned_quantity,
				pallets,
				pallets_detail_ctns,
				unit_label,
				carton_size_mm,
				net_weight_kgs,
				gross_weight_kgs,
				line_note,
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
			line.ActualQuantity,
			line.PlannedQuantity,
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

		lineID, err := lineResult.LastInsertId()
		if err != nil {
			return fmt.Errorf("resolve outbound document line id: %w", err)
		}
		if err := s.persistOutboundPlannedAllocationsTx(ctx, tx, lineID, lockedSource.CustomerID, lockedSource.SKUMasterID, line.PickAllocations); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) ConfirmOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	if _, err := s.confirmOutboundDocumentTransaction(ctx, documentID); err != nil {
		return OutboundDocument{}, err
	}
	return s.getOutboundDocument(ctx, documentID)
}

type outboundConfirmationReceipt struct {
	DocumentID     int64
	PickingOrderNo string
}

func (s *Store) confirmOutboundDocumentTransaction(ctx context.Context, documentID int64) (outboundConfirmationReceipt, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return outboundConfirmationReceipt{}, fmt.Errorf("begin outbound confirm transaction: %w", err)
	}
	defer tx.Rollback()
	customerID, err := loadOutboundDocumentCustomerIDTx(ctx, tx, documentID)
	if err != nil {
		return outboundConfirmationReceipt{}, err
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, []int64{customerID}); err != nil {
		return outboundConfirmationReceipt{}, err
	}

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return outboundConfirmationReceipt{}, err
	}
	receipt := outboundConfirmationReceipt{DocumentID: documentRow.ID, PickingOrderNo: documentRow.PickingOrderNo}

	if err := validateOutboundDocumentCanBeConfirmed(documentRow); err != nil {
		return outboundConfirmationReceipt{}, err
	}
	if err := s.confirmOutboundDocumentTx(ctx, tx, documentID); err != nil {
		return outboundConfirmationReceipt{}, fmt.Errorf("confirm %s: %w", outboundConfirmationReference(documentRow), err)
	}

	if err := tx.Commit(); err != nil {
		return outboundConfirmationReceipt{}, fmt.Errorf("commit outbound confirm: %w", err)
	}
	return receipt, nil
}

func validateOutboundDocumentCanBeConfirmed(documentRow outboundDocumentRow) error {
	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusDeleted {
		return fmt.Errorf("%w: %s is deleted and cannot be confirmed", ErrInvalidInput, outboundConfirmationReference(documentRow))
	}
	if status == DocumentStatusConfirmed {
		return fmt.Errorf("%w: %s is already confirmed", ErrInvalidInput, outboundConfirmationReference(documentRow))
	}
	if status != DocumentStatusDraft {
		return fmt.Errorf("%w: %s is not a draft and cannot be confirmed", ErrInvalidInput, outboundConfirmationReference(documentRow))
	}
	return nil
}

const MaxBulkConfirmOutboundDocuments = 100

type BulkConfirmOutboundDocumentsInput struct {
	DocumentIDs []int64 `json:"documentIds"`
}

type BulkConfirmOutboundDocumentsResponse struct {
	UpdatedDocuments     int                                 `json:"updatedDocuments"`
	FailedDocuments      int                                 `json:"failedDocuments"`
	UnprocessedDocuments int                                 `json:"unprocessedDocuments"`
	Interrupted          bool                                `json:"interrupted"`
	InterruptionError    string                              `json:"interruptionError,omitempty"`
	Documents            []OutboundDocument                  `json:"documents"`
	Results              []BulkConfirmOutboundDocumentResult `json:"results"`
}

type BulkConfirmOutboundDocumentResult struct {
	DocumentID     int64             `json:"documentId"`
	PickingOrderNo string            `json:"pickingOrderNo,omitempty"`
	Success        bool              `json:"success"`
	Document       *OutboundDocument `json:"document,omitempty"`
	Error          string            `json:"error,omitempty"`
	Warning        string            `json:"warning,omitempty"`
}

func (s *Store) BulkConfirmOutboundDocuments(ctx context.Context, input BulkConfirmOutboundDocumentsInput) (BulkConfirmOutboundDocumentsResponse, error) {
	if len(input.DocumentIDs) == 0 || len(input.DocumentIDs) > MaxBulkConfirmOutboundDocuments {
		return BulkConfirmOutboundDocumentsResponse{}, fmt.Errorf("%w: between 1 and %d shipment IDs are required", ErrInvalidInput, MaxBulkConfirmOutboundDocuments)
	}

	documentIDs := append([]int64(nil), input.DocumentIDs...)
	sort.Slice(documentIDs, func(left, right int) bool { return documentIDs[left] < documentIDs[right] })
	for index, documentID := range documentIDs {
		if documentID <= 0 {
			return BulkConfirmOutboundDocumentsResponse{}, fmt.Errorf("%w: shipment IDs must be positive", ErrInvalidInput)
		}
		if index > 0 && documentID == documentIDs[index-1] {
			return BulkConfirmOutboundDocumentsResponse{}, fmt.Errorf("%w: duplicate shipment ID %d", ErrInvalidInput, documentID)
		}
	}

	response := BulkConfirmOutboundDocumentsResponse{
		Documents: make([]OutboundDocument, 0, len(documentIDs)),
		Results:   make([]BulkConfirmOutboundDocumentResult, 0, len(documentIDs)),
	}
	for index, documentID := range documentIDs {
		receipt, err := s.confirmOutboundDocumentTransaction(ctx, documentID)
		if err != nil {
			response.FailedDocuments++
			response.Results = append(response.Results, BulkConfirmOutboundDocumentResult{
				DocumentID: documentID,
				Success:    false,
				Error:      err.Error(),
			})
			if !isExpectedBulkOutboundDocumentFailure(err) {
				response.Interrupted = true
				response.InterruptionError = err.Error()
				response.UnprocessedDocuments = len(documentIDs) - index - 1
				break
			}
			continue
		}
		response.UpdatedDocuments++
		result := BulkConfirmOutboundDocumentResult{
			DocumentID:     receipt.DocumentID,
			PickingOrderNo: receipt.PickingOrderNo,
			Success:        true,
		}
		if document, err := s.getOutboundDocument(ctx, documentID); err == nil {
			response.Documents = append(response.Documents, document)
			confirmedDocument := document
			result.Document = &confirmedDocument
		} else {
			result.Warning = fmt.Sprintf("shipment was confirmed, but the updated document could not be reloaded: %v", err)
		}
		response.Results = append(response.Results, result)
	}
	return response, nil
}

func isExpectedBulkOutboundDocumentFailure(err error) bool {
	return errors.Is(err, ErrNotFound) ||
		errors.Is(err, ErrInvalidInput) ||
		errors.Is(err, ErrInsufficientStock) ||
		errors.Is(err, ErrReservedStock)
}

func outboundConfirmationReference(document outboundDocumentRow) string {
	if pickingOrderNo := strings.TrimSpace(document.PickingOrderNo); pickingOrderNo != "" {
		return "PO " + pickingOrderNo
	}
	return fmt.Sprintf("shipment %d", document.ID)
}

func (s *Store) UpdateOutboundDocumentTrackingStatus(ctx context.Context, documentID int64, trackingStatus string) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound tracking transition: %w", err)
	}
	defer tx.Rollback()
	customerID, err := loadOutboundDocumentCustomerIDTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, []int64{customerID}); err != nil {
		return OutboundDocument{}, err
	}

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
	for index := range lineRows {
		lineRow := &lineRows[index]
		if lineRow.Quantity != 0 {
			continue
		}
		// Older drafts may have reserved the planned quantity for a zero-actual line.
		// Allocation rows and inventory balance increments are persisted together, so
		// release any stale row before confirmation and keep only the plan record.
		if err := s.releaseOutboundContainerAllocationBalancesTx(ctx, tx, lineRow.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_container_allocations WHERE outbound_line_id = ?`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("delete planned-only outbound allocations: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_document_lines
			SET pallets = 0
			WHERE id = ?
		`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("clear planned-only outbound allocation snapshot: %w", err))
		}
		lineRow.Pallets = 0
		lineRow.PickAllocations = nil
	}
	lineRows, err = s.refreshOutboundFinalPalletSnapshotsTx(ctx, tx, documentRow.CustomerID, lineRows)
	if err != nil {
		return err
	}
	confirmedAt := time.Now().UTC()
	billingOccurredAt := confirmedAt
	if documentRow.ActualShipDate != nil {
		billingOccurredAt = *documentRow.ActualShipDate
	}
	billingScopes := outboundBillingMutationScopes(documentRow.CustomerID, billingOccurredAt, lineRows)
	if err := ensureBillingSourceMutationsAllowedTx(ctx, tx, billingScopes...); err != nil {
		return err
	}
	hadActiveReservation := outboundTrackingRequiresActiveReservation(currentTrackingStatus)
	lineRows, autoTransferred, err := s.stageOutboundDraftAtMainWarehouseTx(
		ctx,
		tx,
		documentRow,
		lineRows,
		hadActiveReservation,
	)
	if err != nil {
		return err
	}
	if autoTransferred {
		finalBillingScopes := outboundBillingMutationScopes(documentRow.CustomerID, billingOccurredAt, lineRows)
		if err := ensureBillingSourceMutationsAllowedTx(ctx, tx, finalBillingScopes...); err != nil {
			return err
		}
	}
	if hadActiveReservation && !autoTransferred {
		if err := s.releaseOutboundDocumentReservationsTx(ctx, tx, lineRows); err != nil {
			return err
		}
	}
	lineRows, err = s.reserveOutboundDocumentLinesTx(ctx, tx, documentRow.CustomerID, lineRows)
	if err != nil {
		return err
	}

	for _, lineRow := range lineRows {
		if lineRow.Quantity < 0 {
			return fmt.Errorf("%w: confirmed outbound line %s cannot have a negative actual shipped quantity", ErrInvalidInput, firstNonEmpty(lineRow.SKUSnapshot, fmt.Sprintf("#%d", lineRow.ID)))
		}
		if lineRow.Quantity == 0 {
			// A planned-only line is retained on the confirmed shipment so plan-versus-actual
			// reporting remains complete. It has no stock allocation or ledger movement.
			continue
		}
		allocationRows, err := s.loadOutboundContainerAllocationsForUpdateTx(ctx, tx, lineRow.ID)
		if err != nil {
			return err
		}
		storedAllocations := normalizeOutboundPickAllocations(lineRow.PickAllocations)
		storedByBucket := make(map[string]OutboundPickAllocation, len(storedAllocations))
		for _, storedAllocation := range storedAllocations {
			storedByBucket[outboundPickAllocationSnapshotKey(storedAllocation.LocationID, storedAllocation.StorageSection, storedAllocation.ContainerNo)] = storedAllocation
		}
		allocations := make([]OutboundPickAllocation, 0, len(allocationRows))
		for _, allocation := range allocationRows {
			resolved := OutboundPickAllocation{
				ID:             allocation.ID,
				LineID:         allocation.OutboundLineID,
				LocationID:     allocation.LocationID,
				StorageSection: allocation.StorageSection,
				ContainerNo:    allocation.ContainerNo,
				AllocatedQty:   allocation.AllocatedQty,
				Pallets:        0,
			}
			if stored, exists := storedByBucket[outboundPickAllocationSnapshotKey(allocation.LocationID, allocation.StorageSection, allocation.ContainerNo)]; exists {
				resolved.ItemNumber = stored.ItemNumber
				resolved.LocationName = stored.LocationName
				resolved.InventoryPalletsUsed = stored.InventoryPalletsUsed
				resolved.StartingPallets = cloneIntPointer(stored.StartingPallets)
				resolved.RemainingPallets = cloneIntPointer(stored.RemainingPallets)
				resolved.SourceLocationID = stored.SourceLocationID
				resolved.SourceTransferID = stored.SourceTransferID
				resolved.SourceLocationName = stored.SourceLocationName
				resolved.SourceStorageSection = stored.SourceStorageSection
				resolved.SourceStartingPallets = cloneIntPointer(stored.SourceStartingPallets)
				resolved.SourceRemainingPallets = cloneIntPointer(stored.SourceRemainingPallets)
				resolved.AutoTransferToMain = stored.AutoTransferToMain
			}
			if err := s.validateOutboundFinalPalletBalanceTx(ctx, tx, documentRow.CustomerID, lineRow.SKUMasterID, resolved); err != nil {
				return err
			}
			allocations = append(allocations, resolved)
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
					updated_at = CURRENT_TIMESTAMP
				WHERE customer_id = ?
				  AND sku_master_id = ?
				  AND location_id = ?
				  AND storage_section = ?
				  AND container_no = ?
				  AND quantity >= ?
				  AND allocated_qty >= ?
			`, allocation.AllocatedQty, documentRow.CustomerID, lineRow.SKUMasterID, locationID, fallbackSection(allocation.StorageSection), normalizeContainerNo(allocation.ContainerNo), allocation.AllocatedQty, allocation.AllocatedQty)
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
				PalletChange:        -float64(outboundAllocationInventoryPalletsUsed(allocation)),
				SourceDocumentType:  StockLedgerSourceOutbound,
				SourceDocumentID:    documentID,
				SourceLineID:        lineRow.ID,
				ContainerNo:         allocation.ContainerNo,
				OutDate:             resolveOutboundLedgerDate(documentRow.ExpectedShipDate, documentRow.ActualShipDate),
				PickingOrderNo:      documentRow.PickingOrderNo,
				OrderRef:            documentRow.OrderRef,
				ItemNumber:          lineRow.ItemNumberSnapshot,
				DescriptionSnapshot: lineRow.DescriptionSnapshot,
				Pallets:             outboundAllocationInventoryPalletsUsed(allocation),
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
				shipped_pallets = 0,
				status = 'SHIPPED',
				updated_at = CURRENT_TIMESTAMP
			WHERE outbound_line_id = ?
		`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("mark outbound container allocations shipped: %w", err))
		}
	}
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

func outboundBillingMutationScopes(customerID int64, occurredAt time.Time, lineRows []outboundDocumentLineRow) []billingSourceMutationScope {
	scopes := make([]billingSourceMutationScope, 0, len(lineRows))
	for _, lineRow := range lineRows {
		allocations := normalizeOutboundPickAllocations(lineRow.PickAllocations)
		if len(allocations) == 0 {
			scopes = append(scopes, billingSourceMutationScope{
				CustomerID:  customerID,
				OccurredAt:  occurredAt,
				LocationIDs: []int64{lineRow.LocationID},
			})
			continue
		}
		for _, allocation := range allocations {
			scopes = append(scopes, billingSourceMutationScope{
				CustomerID:  customerID,
				OccurredAt:  occurredAt,
				LocationIDs: []int64{firstNonZeroInt64(allocation.LocationID, lineRow.LocationID)},
				ContainerNo: allocation.ContainerNo,
			})
		}
	}
	return scopes
}

func (s *Store) stageOutboundDraftAtMainWarehouseTx(
	ctx context.Context,
	tx *sql.Tx,
	document outboundDocumentRow,
	lineRows []outboundDocumentLineRow,
	hasActiveReservation bool,
) ([]outboundDocumentLineRow, bool, error) {
	input := CreateOutboundDocumentInput{
		PickingOrderNo: document.PickingOrderNo,
		Lines:          make([]CreateOutboundDocumentLineInput, 0, len(lineRows)),
	}
	if document.ExpectedShipDate != nil {
		input.ExpectedShipDate = document.ExpectedShipDate.UTC().Format(time.RFC3339)
	}
	if document.ActualShipDate != nil {
		input.ActualShipDate = document.ActualShipDate.UTC().Format(time.RFC3339)
	}
	for _, lineRow := range lineRows {
		input.Lines = append(input.Lines, outboundLineInputFromRow(document.CustomerID, lineRow))
	}
	if !hasPendingOutboundMainWarehouseTransfer(input) {
		return lineRows, false, nil
	}

	mainLocation, err := resolveMainOutboundLocationTx(ctx, tx)
	if err != nil {
		return nil, false, err
	}
	if countOutboundAllocationsOutsideLocation(input, mainLocation.ID) == 0 {
		return lineRows, false, nil
	}
	for _, line := range input.Lines {
		for _, allocation := range line.PickAllocations {
			if !allocation.AutoTransferToMain || firstNonZeroInt64(allocation.LocationID, line.LocationID) == mainLocation.ID {
				continue
			}
			if err := s.validateOutboundFinalPalletBalanceTx(ctx, tx, document.CustomerID, line.SKUMasterID, allocation); err != nil {
				return nil, false, err
			}
		}
	}

	plannedInput, transferInput, err := buildOutboundBulkMainWarehousePlan(input, mainLocation)
	if err != nil {
		return nil, false, err
	}
	if len(transferInput.Lines) == 0 {
		return lineRows, false, nil
	}
	if hasActiveReservation {
		if err := s.releaseOutboundDocumentReservationsTx(ctx, tx, lineRows); err != nil {
			return nil, false, err
		}
	}

	transferInput = sanitizeInventoryTransferInput(transferInput)
	if err := validateInventoryTransferInput(transferInput); err != nil {
		return nil, false, err
	}
	transferTime, err := parseOptionalDateTime(transferInput.ActualTransferredAt)
	if err != nil {
		return nil, false, err
	}
	transfer, err := s.createInventoryTransferTx(ctx, tx, transferInput, transferTime)
	if err != nil {
		return nil, false, err
	}
	attachOutboundAutoTransferID(&plannedInput, transfer.ID)

	for index := range lineRows {
		lineInput := plannedInput.Lines[index]
		lineRow := &lineRows[index]
		locationName := lineRow.LocationName
		storageSection := fallbackSection(lineRow.StorageSection)
		if lineInput.LocationID == mainLocation.ID {
			locationName = mainLocation.Name
		}
		if len(lineInput.PickAllocations) > 0 {
			storageSection = fallbackSection(lineInput.PickAllocations[0].StorageSection)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_document_lines
			SET
				location_id = ?,
				location_name_snapshot = ?,
				storage_section = ?
			WHERE id = ?
		`,
			lineInput.LocationID,
			locationName,
			storageSection,
			lineRow.ID,
		); err != nil {
			return nil, false, mapDBError(fmt.Errorf("stage outbound line at main warehouse: %w", err))
		}
		lineRow.LocationID = lineInput.LocationID
		lineRow.LocationName = locationName
		lineRow.StorageSection = storageSection
		lineRow.PickAllocations = normalizeOutboundPickAllocations(lineInput.PickAllocations)
		if err := s.persistOutboundPlannedAllocationsTx(ctx, tx, lineRow.ID, document.CustomerID, lineRow.SKUMasterID, lineInput.PickAllocations); err != nil {
			return nil, false, err
		}
	}
	return lineRows, true, nil
}

func attachOutboundAutoTransferID(input *CreateOutboundDocumentInput, transferID int64) {
	if input == nil || transferID <= 0 {
		return
	}
	for lineIndex := range input.Lines {
		for allocationIndex := range input.Lines[lineIndex].PickAllocations {
			allocation := &input.Lines[lineIndex].PickAllocations[allocationIndex]
			if allocation.SourceLocationID > 0 && allocation.LocationID > 0 && allocation.SourceLocationID != allocation.LocationID {
				allocation.SourceTransferID = transferID
			}
		}
	}
}

func resolveMainOutboundLocationTx(ctx context.Context, tx *sql.Tx) (Location, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, name FROM storage_locations ORDER BY name ASC`)
	if err != nil {
		return Location{}, fmt.Errorf("load main outbound warehouse: %w", err)
	}
	defer rows.Close()
	locations := make([]Location, 0)
	for rows.Next() {
		var location Location
		if err := rows.Scan(&location.ID, &location.Name); err != nil {
			return Location{}, fmt.Errorf("scan main outbound warehouse: %w", err)
		}
		locations = append(locations, location)
	}
	if err := rows.Err(); err != nil {
		return Location{}, fmt.Errorf("iterate main outbound warehouses: %w", err)
	}
	return resolveMainOutboundLocation(locations)
}

const MaxBulkDeleteOutboundDocuments = 100

type BulkDeleteOutboundDocumentsInput struct {
	DocumentIDs []int64 `json:"documentIds"`
}

type BulkDeleteOutboundDocumentsResponse struct {
	DeletedDocuments     int                                `json:"deletedDocuments"`
	FailedDocuments      int                                `json:"failedDocuments"`
	UnprocessedDocuments int                                `json:"unprocessedDocuments"`
	Interrupted          bool                               `json:"interrupted"`
	InterruptionError    string                             `json:"interruptionError,omitempty"`
	Documents            []OutboundDocument                 `json:"documents"`
	Results              []BulkDeleteOutboundDocumentResult `json:"results"`
}

type BulkDeleteOutboundDocumentResult struct {
	DocumentID int64             `json:"documentId"`
	Success    bool              `json:"success"`
	Document   *OutboundDocument `json:"document,omitempty"`
	Error      string            `json:"error,omitempty"`
}

type outboundAutoTransferLaterActivityError struct {
	message string
}

func (err *outboundAutoTransferLaterActivityError) Error() string {
	return err.message
}

func (err *outboundAutoTransferLaterActivityError) Unwrap() error {
	return ErrInvalidInput
}

func isOutboundAutoTransferLaterActivityError(err error) bool {
	var laterActivityErr *outboundAutoTransferLaterActivityError
	return errors.As(err, &laterActivityErr)
}

func (s *Store) BulkDeleteOutboundDocuments(ctx context.Context, input BulkDeleteOutboundDocumentsInput) (BulkDeleteOutboundDocumentsResponse, error) {
	if len(input.DocumentIDs) == 0 || len(input.DocumentIDs) > MaxBulkDeleteOutboundDocuments {
		return BulkDeleteOutboundDocumentsResponse{}, fmt.Errorf("%w: between 1 and %d shipment IDs are required", ErrInvalidInput, MaxBulkDeleteOutboundDocuments)
	}

	documentIDs := append([]int64(nil), input.DocumentIDs...)
	sort.Slice(documentIDs, func(left, right int) bool { return documentIDs[left] < documentIDs[right] })
	for index, documentID := range documentIDs {
		if documentID <= 0 {
			return BulkDeleteOutboundDocumentsResponse{}, fmt.Errorf("%w: shipment IDs must be positive", ErrInvalidInput)
		}
		if index > 0 && documentID == documentIDs[index-1] {
			return BulkDeleteOutboundDocumentsResponse{}, fmt.Errorf("%w: duplicate shipment ID %d", ErrInvalidInput, documentID)
		}
	}

	response := BulkDeleteOutboundDocumentsResponse{
		Documents: make([]OutboundDocument, 0, len(documentIDs)),
		Results:   make([]BulkDeleteOutboundDocumentResult, 0, len(documentIDs)),
	}
	resultsByDocumentID := make(map[int64]BulkDeleteOutboundDocumentResult, len(documentIDs))
	deletedDocumentsByID := make(map[int64]OutboundDocument, len(documentIDs))
	lastDeferredErrors := make(map[int64]error)
	pendingDocumentIDs := append([]int64(nil), documentIDs...)

	for len(pendingDocumentIDs) > 0 && !response.Interrupted {
		deferredDocumentIDs := make([]int64, 0)
		deletedThisPass := 0

		for index, documentID := range pendingDocumentIDs {
			document, err := s.CancelOutboundDocument(ctx, documentID)
			if err != nil {
				if isOutboundAutoTransferLaterActivityError(err) {
					lastDeferredErrors[documentID] = err
					deferredDocumentIDs = append(deferredDocumentIDs, documentID)
					continue
				}

				resultsByDocumentID[documentID] = BulkDeleteOutboundDocumentResult{
					DocumentID: documentID,
					Success:    false,
					Error:      err.Error(),
				}
				response.FailedDocuments++
				if !isExpectedBulkOutboundDocumentFailure(err) {
					response.Interrupted = true
					response.InterruptionError = err.Error()
					response.UnprocessedDocuments = len(pendingDocumentIDs) - index - 1 + len(deferredDocumentIDs)
					break
				}
				continue
			}

			deletedThisPass++
			response.DeletedDocuments++
			deletedDocumentsByID[document.ID] = document
			deletedDocument := document
			resultsByDocumentID[document.ID] = BulkDeleteOutboundDocumentResult{
				DocumentID: document.ID,
				Success:    true,
				Document:   &deletedDocument,
			}
			delete(lastDeferredErrors, document.ID)
		}

		if response.Interrupted || len(deferredDocumentIDs) == 0 {
			break
		}
		if deletedThisPass == 0 {
			for _, documentID := range deferredDocumentIDs {
				err := lastDeferredErrors[documentID]
				resultsByDocumentID[documentID] = BulkDeleteOutboundDocumentResult{
					DocumentID: documentID,
					Success:    false,
					Error:      err.Error(),
				}
				response.FailedDocuments++
			}
			break
		}
		pendingDocumentIDs = deferredDocumentIDs
	}

	for _, documentID := range documentIDs {
		if document, exists := deletedDocumentsByID[documentID]; exists {
			response.Documents = append(response.Documents, document)
		}
		if result, exists := resultsByDocumentID[documentID]; exists {
			response.Results = append(response.Results, result)
		}
	}
	return response, nil
}

func (s *Store) CancelOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound cancel transaction: %w", err)
	}
	defer tx.Rollback()
	customerID, err := loadOutboundDocumentCustomerIDTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, []int64{customerID}); err != nil {
		return OutboundDocument{}, err
	}

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	deletedAt, err := s.cancelLoadedOutboundDocumentTx(ctx, tx, documentRow)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("delete %s: %w", outboundConfirmationReference(documentRow), err)
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit delete %s: %w", outboundConfirmationReference(documentRow), err)
	}

	return OutboundDocument{
		ID:             documentRow.ID,
		PickingOrderNo: documentRow.PickingOrderNo,
		OrderRef:       documentRow.OrderRef,
		CustomerID:     documentRow.CustomerID,
		Status:         DocumentStatusDeleted,
		DeletedAt:      &deletedAt,
		CreatedAt:      documentRow.CreatedAt,
	}, nil
}

func (s *Store) cancelLoadedOutboundDocumentTx(ctx context.Context, tx *sql.Tx, documentRow outboundDocumentRow) (time.Time, error) {
	status := normalizeDocumentStatus(documentRow.Status)
	if status == DocumentStatusDeleted {
		return time.Time{}, fmt.Errorf("%w: outbound document is already deleted", ErrInvalidInput)
	}

	deletedAt := time.Now().UTC()

	if status == DocumentStatusConfirmed {
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentRow.ID)
		if err != nil {
			return time.Time{}, err
		}
		skipAutoTransferRollback, err := s.ensureOutboundAutoTransferCanBeRolledBackTx(ctx, tx, documentRow, lineRows)
		if err != nil {
			return time.Time{}, err
		}
		autoTransferRollback := buildOutboundAutoTransferRollbackInput(documentRow, lineRows, skipAutoTransferRollback)
		allocationsByLine := make(map[int64][]outboundContainerAllocationRow, len(lineRows))
		billingScopes := make([]billingSourceMutationScope, 0, len(lineRows))
		for _, lineRow := range lineRows {
			allocationRows, err := s.loadOutboundContainerAllocationsForUpdateTx(ctx, tx, lineRow.ID)
			if err != nil {
				return time.Time{}, err
			}
			allocationsByLine[lineRow.ID] = allocationRows
			if len(allocationRows) == 0 {
				billingOccurredAt, err := earliestOutboundBillingMutationDateTx(
					ctx, tx, documentRow, lineRow.ID, lineRow.LocationID, "",
				)
				if err != nil {
					return time.Time{}, err
				}
				billingScopes = append(billingScopes, billingSourceMutationScope{
					CustomerID:  documentRow.CustomerID,
					OccurredAt:  billingOccurredAt,
					LocationIDs: []int64{lineRow.LocationID},
				})
				continue
			}
			for _, allocation := range allocationRows {
				billingOccurredAt, err := earliestOutboundBillingMutationDateTx(
					ctx, tx, documentRow, lineRow.ID, allocation.LocationID, allocation.ContainerNo,
				)
				if err != nil {
					return time.Time{}, err
				}
				billingScopes = append(billingScopes, billingSourceMutationScope{
					CustomerID:  documentRow.CustomerID,
					OccurredAt:  billingOccurredAt,
					LocationIDs: []int64{allocation.LocationID},
					ContainerNo: allocation.ContainerNo,
				})
			}
		}
		for _, rollbackLine := range autoTransferRollback.Lines {
			billingScopes = append(billingScopes, billingSourceMutationScope{
				CustomerID:  rollbackLine.CustomerID,
				OccurredAt:  deletedAt,
				LocationIDs: []int64{rollbackLine.LocationID, rollbackLine.ToLocationID},
				ContainerNo: rollbackLine.ContainerNo,
			})
		}
		if err := ensureBillingSourceMutationsAllowedTx(ctx, tx, billingScopes...); err != nil {
			return time.Time{}, err
		}

		for _, lineRow := range lineRows {
			allocationRows := allocationsByLine[lineRow.ID]
			for _, allocation := range allocationRows {
				if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
					EventType:           StockLedgerEventReversal,
					SKUMasterID:         lineRow.SKUMasterID,
					CustomerID:          documentRow.CustomerID,
					LocationID:          allocation.LocationID,
					StorageSection:      allocation.StorageSection,
					QuantityChange:      allocation.AllocatedQty,
					PalletChange:        float64(allocation.InventoryPalletsUsed),
					SourceDocumentType:  StockLedgerSourceOutbound,
					SourceDocumentID:    documentRow.ID,
					SourceLineID:        lineRow.ID,
					ContainerNo:         allocation.ContainerNo,
					OutDate:             &deletedAt,
					PickingOrderNo:      documentRow.PickingOrderNo,
					OrderRef:            documentRow.OrderRef,
					ItemNumber:          lineRow.ItemNumberSnapshot,
					DescriptionSnapshot: lineRow.DescriptionSnapshot,
					Pallets:             allocation.InventoryPalletsUsed,
					Reason:              "Outbound shipment cancelled",
				}); err != nil {
					return time.Time{}, err
				}
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE outbound_container_allocations
				SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
				WHERE outbound_line_id = ?
			`, lineRow.ID); err != nil {
				return time.Time{}, mapDBError(fmt.Errorf("cancel outbound container allocations: %w", err))
			}
		}
		if len(autoTransferRollback.Lines) > 0 {
			autoTransferRollback = sanitizeInventoryTransferInput(autoTransferRollback)
			if err := validateInventoryTransferInput(autoTransferRollback); err != nil {
				return time.Time{}, fmt.Errorf("prepare automatic transfer rollback: %w", err)
			}
			rollbackTransfer, err := s.createInventoryTransferTx(ctx, tx, autoTransferRollback, &deletedAt)
			if err != nil {
				return time.Time{}, fmt.Errorf("rollback automatic warehouse transfer: %w", err)
			}
			if err := purgeRolledBackOutboundAutoTransfersTx(ctx, tx, documentRow, lineRows, skipAutoTransferRollback, rollbackTransfer.ID); err != nil {
				return time.Time{}, err
			}
		}
	} else if outboundTrackingRequiresActiveReservation(normalizeOutboundTrackingStatus(documentRow.TrackingStatus, documentRow.Status)) {
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentRow.ID)
		if err != nil {
			return time.Time{}, err
		}
		if err := s.cancelOutboundDocumentReservationsTx(ctx, tx, lineRows); err != nil {
			return time.Time{}, err
		}
	}

	if err := markDocumentAttachmentsDeletedForDocument(ctx, tx, DocumentAttachmentOutbound, documentRow.ID); err != nil {
		return time.Time{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM delivery_events WHERE outbound_document_id = ?`, documentRow.ID); err != nil {
		return time.Time{}, mapDBError(fmt.Errorf("delete outbound delivery events: %w", err))
	}
	if err := deleteStockLedgerForDocumentTx(ctx, tx, StockLedgerSourceOutbound, documentRow.ID); err != nil {
		return time.Time{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE allocation
		FROM outbound_container_allocations allocation
		JOIN outbound_document_lines line ON line.id = allocation.outbound_line_id
		WHERE line.document_id = ?
	`, documentRow.ID); err != nil {
		return time.Time{}, mapDBError(fmt.Errorf("delete outbound container allocations: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_document_lines WHERE document_id = ?`, documentRow.ID); err != nil {
		return time.Time{}, mapDBError(fmt.Errorf("delete outbound document lines: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_documents WHERE id = ?`, documentRow.ID); err != nil {
		return time.Time{}, mapDBError(fmt.Errorf("delete outbound document: %w", err))
	}
	return deletedAt, nil
}

func buildOutboundAutoTransferRollbackInput(
	document outboundDocumentRow,
	lineRows []outboundDocumentLineRow,
	skipRollback map[string]struct{},
) CreateInventoryTransferInput {
	reference := outboundConfirmationReference(document)
	input := CreateInventoryTransferInput{
		TransferNo: fmt.Sprintf("TRN-UNDO-OUT-%d", document.ID),
		Notes:      fmt.Sprintf("Automatic transfer rollback for deleted %s", reference),
		Lines:      make([]CreateInventoryTransferLineInput, 0),
	}
	for _, lineRow := range lineRows {
		for _, allocation := range lineRow.PickAllocations {
			if allocation.SourceLocationID <= 0 || allocation.LocationID <= 0 || allocation.SourceLocationID == allocation.LocationID || allocation.AllocatedQty <= 0 {
				continue
			}
			if _, skip := skipRollback[outboundAutoTransferAllocationKey(lineRow.ID, allocation)]; skip {
				continue
			}
			input.Lines = append(input.Lines, CreateInventoryTransferLineInput{
				CustomerID:         document.CustomerID,
				LocationID:         allocation.LocationID,
				StorageSection:     fallbackSection(allocation.StorageSection),
				ContainerNo:        allocation.ContainerNo,
				SKUMasterID:        lineRow.SKUMasterID,
				Quantity:           allocation.AllocatedQty,
				SourcePallets:      maxInt(allocation.InventoryPalletsUsed, 0),
				DestinationPallets: maxInt(allocation.InventoryPalletsUsed, 0),
				ToLocationID:       allocation.SourceLocationID,
				ToStorageSection:   fallbackSection(allocation.SourceStorageSection),
				LineNote:           fmt.Sprintf("Restore automatic transfer for deleted %s", reference),
			})
		}
	}
	return input
}

func outboundAutoTransferAllocationKey(lineID int64, allocation OutboundPickAllocation) string {
	return fmt.Sprintf(
		"%d:%d:%d:%d:%s:%s",
		lineID,
		allocation.SourceTransferID,
		allocation.SourceLocationID,
		allocation.LocationID,
		fallbackSection(allocation.SourceStorageSection),
		normalizeContainerNo(allocation.ContainerNo),
	)
}

func purgeRolledBackOutboundAutoTransfersTx(
	ctx context.Context,
	tx *sql.Tx,
	document outboundDocumentRow,
	lineRows []outboundDocumentLineRow,
	skipRollback map[string]struct{},
	rollbackTransferID int64,
) error {
	originalTransferIDs := make(map[int64]struct{})
	for _, lineRow := range lineRows {
		for _, allocation := range lineRow.PickAllocations {
			if allocation.SourceTransferID <= 0 || allocation.SourceLocationID <= 0 || allocation.LocationID <= 0 {
				continue
			}
			if _, skip := skipRollback[outboundAutoTransferAllocationKey(lineRow.ID, allocation)]; skip {
				continue
			}
			containerNo := normalizeContainerNo(allocation.ContainerNo)
			sourceSection := fallbackSection(allocation.SourceStorageSection)
			destinationSection := fallbackSection(allocation.StorageSection)
			if _, err := tx.ExecContext(ctx, `
				DELETE FROM stock_ledger
				WHERE source_document_type = ?
				  AND source_document_id = ?
				  AND customer_id = ?
				  AND sku_master_id = ?
				  AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?
				  AND (
					(location_id = ? AND storage_section = ?)
					OR (location_id = ? AND storage_section = ?)
				  )
			`,
				StockLedgerSourceTransfer,
				allocation.SourceTransferID,
				document.CustomerID,
				lineRow.SKUMasterID,
				containerNo,
				allocation.SourceLocationID,
				sourceSection,
				allocation.LocationID,
				destinationSection,
			); err != nil {
				return mapDBError(fmt.Errorf("delete rolled-back automatic transfer ledger entries %d: %w", allocation.SourceTransferID, err))
			}
			if _, err := tx.ExecContext(ctx, `
				DELETE FROM inventory_transfer_lines
				WHERE transfer_id = ?
				  AND customer_id = ?
				  AND from_location_id = ?
				  AND from_storage_section = ?
				  AND to_location_id = ?
				  AND to_storage_section = ?
				  AND UPPER(TRIM(container_no)) = ?
				  AND UPPER(TRIM(sku_snapshot)) = ?
			`,
				allocation.SourceTransferID,
				document.CustomerID,
				allocation.SourceLocationID,
				sourceSection,
				allocation.LocationID,
				destinationSection,
				containerNo,
				strings.ToUpper(strings.TrimSpace(lineRow.SKUSnapshot)),
			); err != nil {
				return mapDBError(fmt.Errorf("delete rolled-back automatic transfer line %d: %w", allocation.SourceTransferID, err))
			}
			originalTransferIDs[allocation.SourceTransferID] = struct{}{}
		}
	}

	for transferID := range originalTransferIDs {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM inventory_transfers
			WHERE id = ?
			  AND NOT EXISTS (
				SELECT 1 FROM inventory_transfer_lines WHERE transfer_id = ?
			  )
		`, transferID, transferID); err != nil {
			return mapDBError(fmt.Errorf("delete empty automatic transfer %d: %w", transferID, err))
		}
	}

	if err := deleteStockLedgerForDocumentTx(ctx, tx, StockLedgerSourceTransfer, rollbackTransferID); err != nil {
		return fmt.Errorf("delete automatic transfer rollback ledger %d: %w", rollbackTransferID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM inventory_transfer_lines WHERE transfer_id = ?`, rollbackTransferID); err != nil {
		return mapDBError(fmt.Errorf("delete automatic transfer rollback lines %d: %w", rollbackTransferID, err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM inventory_transfers WHERE id = ?`, rollbackTransferID); err != nil {
		return mapDBError(fmt.Errorf("delete automatic transfer rollback %d: %w", rollbackTransferID, err))
	}
	return nil
}

func (s *Store) ensureOutboundAutoTransferCanBeRolledBackTx(
	ctx context.Context,
	tx *sql.Tx,
	document outboundDocumentRow,
	lineRows []outboundDocumentLineRow,
) (map[string]struct{}, error) {
	reference := outboundConfirmationReference(document)
	skipRollback := make(map[string]struct{})
	for _, lineRow := range lineRows {
		for _, allocation := range lineRow.PickAllocations {
			if allocation.SourceLocationID <= 0 || allocation.LocationID <= 0 || allocation.SourceLocationID == allocation.LocationID || allocation.AllocatedQty <= 0 {
				continue
			}

			containerNo := normalizeContainerNo(allocation.ContainerNo)
			sourceLocation := firstNonEmpty(strings.TrimSpace(allocation.SourceLocationName), fmt.Sprintf("warehouse %d", allocation.SourceLocationID))
			sourceSection := fallbackSection(allocation.SourceStorageSection)
			sku := firstNonEmpty(strings.TrimSpace(lineRow.SKUSnapshot), fmt.Sprintf("UPC ID %d", lineRow.SKUMasterID))
			if allocation.SourceTransferID <= 0 {
				return nil, fmt.Errorf(
					"%w: cannot delete %s because the automatic transfer provenance for container %s / UPC %s from %s, section %s is incomplete; correct this shipment manually",
					ErrInvalidInput,
					reference,
					containerNo,
					sku,
					sourceLocation,
					sourceSection,
				)
			}

			var sourceInventoryItemID int64
			var sourceQuantity int
			var sourcePallets int
			if err := tx.QueryRowContext(ctx, `
				SELECT id, quantity, pallets
				FROM inventory_items
				WHERE customer_id = ?
				  AND sku_master_id = ?
				  AND location_id = ?
				  AND storage_section = ?
				  AND container_no = ?
				ORDER BY id ASC
				LIMIT 1
				FOR UPDATE
			`,
				document.CustomerID,
				lineRow.SKUMasterID,
				allocation.SourceLocationID,
				sourceSection,
				containerNo,
			).Scan(&sourceInventoryItemID, &sourceQuantity, &sourcePallets); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return nil, fmt.Errorf(
						"%w: cannot delete %s because the original balance for container %s / UPC %s at %s, section %s is missing; correct this shipment manually",
						ErrInvalidInput,
						reference,
						containerNo,
						sku,
						sourceLocation,
						sourceSection,
					)
				}
				return nil, mapDBError(fmt.Errorf("lock automatic transfer source balance: %w", err))
			}

			var originalTransferOutLedgerID sql.NullInt64
			if err := tx.QueryRowContext(ctx, `
				SELECT MAX(id)
				FROM stock_ledger
				WHERE source_document_type = ?
				  AND source_document_id = ?
				  AND event_type = ?
				  AND customer_id = ?
				  AND sku_master_id = ?
				  AND location_id = ?
				  AND storage_section = ?
				  AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?
			`,
				StockLedgerSourceTransfer,
				allocation.SourceTransferID,
				StockLedgerEventTransferOut,
				document.CustomerID,
				lineRow.SKUMasterID,
				allocation.SourceLocationID,
				sourceSection,
				containerNo,
			).Scan(&originalTransferOutLedgerID); err != nil {
				return nil, mapDBError(fmt.Errorf("load automatic transfer provenance: %w", err))
			}
			if !originalTransferOutLedgerID.Valid || originalTransferOutLedgerID.Int64 <= 0 {
				return nil, fmt.Errorf(
					"%w: cannot delete %s because its automatic transfer record for container %s / UPC %s from %s, section %s is missing; correct this shipment manually",
					ErrInvalidInput,
					reference,
					containerNo,
					sku,
					sourceLocation,
					sourceSection,
				)
			}

			var hasLaterActivity int
			if err := tx.QueryRowContext(ctx, `
				SELECT EXISTS (
					SELECT 1
					FROM stock_ledger
					WHERE customer_id = ?
					  AND sku_master_id = ?
					  AND location_id = ?
					  AND storage_section = ?
					  AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?
					  AND id > ?
				)
			`,
				document.CustomerID,
				lineRow.SKUMasterID,
				allocation.SourceLocationID,
				sourceSection,
				containerNo,
				originalTransferOutLedgerID.Int64,
			).Scan(&hasLaterActivity); err != nil {
				return nil, mapDBError(fmt.Errorf("check activity after automatic transfer: %w", err))
			}
			if hasLaterActivity != 0 {
				var currentContainerLocationID sql.NullInt64
				currentLocationErr := tx.QueryRowContext(ctx, `
					SELECT location_id
					FROM containers
					WHERE customer_id = ?
					  AND UPPER(TRIM(container_no)) = ?
					LIMIT 1
				`, document.CustomerID, containerNo).Scan(&currentContainerLocationID)
				if currentLocationErr != nil && !errors.Is(currentLocationErr, sql.ErrNoRows) {
					return nil, mapDBError(fmt.Errorf("load current container location: %w", currentLocationErr))
				}
				var latestActivityMovesToOutboundLocation int
				if err := tx.QueryRowContext(ctx, `
					SELECT EXISTS (
						SELECT 1
						FROM stock_ledger later
						JOIN inventory_transfer_lines transfer_line
						  ON transfer_line.transfer_id = later.source_document_id
						 AND transfer_line.id = later.source_line_id
						WHERE later.id = (
							SELECT MAX(candidate.id)
							FROM stock_ledger candidate
							WHERE candidate.customer_id = ?
							  AND candidate.sku_master_id = ?
							  AND candidate.location_id = ?
							  AND candidate.storage_section = ?
							  AND UPPER(TRIM(COALESCE(candidate.container_no_snapshot, ''))) = ?
							  AND candidate.id > ?
						)
						  AND later.source_document_type = ?
						  AND later.event_type = ?
						  AND transfer_line.to_location_id = ?
					)
				`,
					document.CustomerID,
					lineRow.SKUMasterID,
					allocation.SourceLocationID,
					sourceSection,
					containerNo,
					originalTransferOutLedgerID.Int64,
					StockLedgerSourceTransfer,
					StockLedgerEventTransferOut,
					allocation.LocationID,
				).Scan(&latestActivityMovesToOutboundLocation); err != nil {
					return nil, mapDBError(fmt.Errorf("resolve latest container relocation: %w", err))
				}
				if sourceQuantity == 0 && sourcePallets == 0 &&
					currentContainerLocationID.Valid && currentContainerLocationID.Int64 == allocation.LocationID &&
					latestActivityMovesToOutboundLocation != 0 {
					skipRollback[outboundAutoTransferAllocationKey(lineRow.ID, allocation)] = struct{}{}
					continue
				}
				return nil, &outboundAutoTransferLaterActivityError{message: fmt.Sprintf(
					"%s: cannot delete %s because container %s / UPC %s at %s, section %s has later inventory activity after its automatic transfer; reverse or correct the later activity first",
					ErrInvalidInput.Error(),
					reference,
					containerNo,
					sku,
					sourceLocation,
					sourceSection,
				)}
			}
		}
	}
	return skipRollback, nil
}
