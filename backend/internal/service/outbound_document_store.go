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
	PlannedQuantity     int       `db:"planned_quantity"`
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
	ArchiveScope   string
	ExportCursor   bool
	BeforeID       int64
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
	whereClauses := []string{
		buildDocumentArchiveFilterClause("d", filters.ArchiveScope),
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
			CASE WHEN planned_quantity > 0 THEN planned_quantity ELSE quantity END AS planned_quantity,
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
		storedPickAllocations := decodeOutboundStoredPickAllocationsOrEmpty(lineRow.ID, lineRow.PickAllocationsJSON)

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

func outboundLineRowsHavePendingMainWarehouseTransfer(lineRows []outboundDocumentLineRow) bool {
	for _, lineRow := range lineRows {
		for _, allocation := range decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON) {
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
	if document.PackingListNo == "" {
		document.PackingListNo = documentRow.PackingListNo
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
				pick_allocations_json,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	receipt := outboundConfirmationReceipt{DocumentID: documentRow.ID, PickingOrderNo: documentRow.PackingListNo}

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
	if documentRow.ArchivedAt != nil {
		return fmt.Errorf("%w: %s is archived and cannot be confirmed", ErrInvalidInput, outboundConfirmationReference(documentRow))
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
	if pickingOrderNo := strings.TrimSpace(document.PackingListNo); pickingOrderNo != "" {
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
			SET pallets = 0, pick_allocations_json = NULL
			WHERE id = ?
		`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("clear planned-only outbound allocation snapshot: %w", err))
		}
		lineRow.Pallets = 0
		lineRow.PickAllocationsJSON = ""
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
		storedAllocations := decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON)
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
				Pallets:        allocation.AllocatedPallets,
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
				shipped_pallets = allocated_pallets,
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
		allocations := decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON)
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
		PackingListNo: document.PackingListNo,
		Lines:         make([]CreateOutboundDocumentLineInput, 0, len(lineRows)),
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
				storage_section = ?,
				pick_allocations_json = ?
			WHERE id = ?
		`,
			lineInput.LocationID,
			locationName,
			storageSection,
			nullableString(mustEncodeOutboundPickAllocations(lineInput.PickAllocations)),
			lineRow.ID,
		); err != nil {
			return nil, false, mapDBError(fmt.Errorf("stage outbound line at main warehouse: %w", err))
		}
		lineRow.LocationID = lineInput.LocationID
		lineRow.LocationName = locationName
		lineRow.StorageSection = storageSection
		lineRow.PickAllocationsJSON = mustEncodeOutboundPickAllocations(lineInput.PickAllocations)
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
	for index, documentID := range documentIDs {
		document, err := s.CancelOutboundDocument(ctx, documentID)
		if err != nil {
			response.FailedDocuments++
			response.Results = append(response.Results, BulkDeleteOutboundDocumentResult{
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

		response.DeletedDocuments++
		response.Documents = append(response.Documents, document)
		deletedDocument := document
		response.Results = append(response.Results, BulkDeleteOutboundDocumentResult{
			DocumentID: document.ID,
			Success:    true,
			Document:   &deletedDocument,
		})
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
		ID:            documentRow.ID,
		PackingListNo: documentRow.PackingListNo,
		OrderRef:      documentRow.OrderRef,
		CustomerID:    documentRow.CustomerID,
		Status:        DocumentStatusDeleted,
		DeletedAt:     &deletedAt,
		CreatedAt:     documentRow.CreatedAt,
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
		if err := s.ensureOutboundAutoTransferCanBeRolledBackTx(ctx, tx, documentRow, lineRows); err != nil {
			return time.Time{}, err
		}
		autoTransferRollback := buildOutboundAutoTransferRollbackInput(documentRow, lineRows)
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
					PalletChange:        float64(allocation.AllocatedPallets),
					SourceDocumentType:  StockLedgerSourceOutbound,
					SourceDocumentID:    documentRow.ID,
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
			if _, err := s.createInventoryTransferTx(ctx, tx, autoTransferRollback, &deletedAt); err != nil {
				return time.Time{}, fmt.Errorf("rollback automatic warehouse transfer: %w", err)
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
) CreateInventoryTransferInput {
	reference := outboundConfirmationReference(document)
	input := CreateInventoryTransferInput{
		TransferNo: fmt.Sprintf("TRN-UNDO-OUT-%d", document.ID),
		Notes:      fmt.Sprintf("Automatic transfer rollback for deleted %s", reference),
		Lines:      make([]CreateInventoryTransferLineInput, 0),
	}
	for _, lineRow := range lineRows {
		for _, allocation := range decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON) {
			if allocation.SourceLocationID <= 0 || allocation.LocationID <= 0 || allocation.SourceLocationID == allocation.LocationID || allocation.AllocatedQty <= 0 {
				continue
			}
			input.Lines = append(input.Lines, CreateInventoryTransferLineInput{
				CustomerID:       document.CustomerID,
				LocationID:       allocation.LocationID,
				StorageSection:   fallbackSection(allocation.StorageSection),
				ContainerNo:      allocation.ContainerNo,
				SKUMasterID:      lineRow.SKUMasterID,
				Quantity:         allocation.AllocatedQty,
				Pallets:          maxInt(allocation.Pallets, 0),
				ToLocationID:     allocation.SourceLocationID,
				ToStorageSection: fallbackSection(allocation.SourceStorageSection),
				LineNote:         fmt.Sprintf("Restore automatic transfer for deleted %s", reference),
			})
		}
	}
	return input
}

func (s *Store) ensureOutboundAutoTransferCanBeRolledBackTx(
	ctx context.Context,
	tx *sql.Tx,
	document outboundDocumentRow,
	lineRows []outboundDocumentLineRow,
) error {
	reference := outboundConfirmationReference(document)
	for _, lineRow := range lineRows {
		for _, allocation := range decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON) {
			if allocation.SourceLocationID <= 0 || allocation.LocationID <= 0 || allocation.SourceLocationID == allocation.LocationID || allocation.AllocatedQty <= 0 {
				continue
			}

			containerNo := normalizeContainerNo(allocation.ContainerNo)
			sourceLocation := firstNonEmpty(strings.TrimSpace(allocation.SourceLocationName), fmt.Sprintf("warehouse %d", allocation.SourceLocationID))
			sourceSection := fallbackSection(allocation.SourceStorageSection)
			sku := firstNonEmpty(strings.TrimSpace(lineRow.SKUSnapshot), fmt.Sprintf("SKU ID %d", lineRow.SKUMasterID))
			if allocation.SourceTransferID <= 0 {
				return fmt.Errorf(
					"%w: cannot delete %s because the automatic transfer provenance for container %s / SKU %s from %s, section %s is incomplete; correct this shipment manually",
					ErrInvalidInput,
					reference,
					containerNo,
					sku,
					sourceLocation,
					sourceSection,
				)
			}

			var sourceInventoryItemID int64
			if err := tx.QueryRowContext(ctx, `
				SELECT id
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
			).Scan(&sourceInventoryItemID); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return fmt.Errorf(
						"%w: cannot delete %s because the original balance for container %s / SKU %s at %s, section %s is missing; correct this shipment manually",
						ErrInvalidInput,
						reference,
						containerNo,
						sku,
						sourceLocation,
						sourceSection,
					)
				}
				return mapDBError(fmt.Errorf("lock automatic transfer source balance: %w", err))
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
				return mapDBError(fmt.Errorf("load automatic transfer provenance: %w", err))
			}
			if !originalTransferOutLedgerID.Valid || originalTransferOutLedgerID.Int64 <= 0 {
				return fmt.Errorf(
					"%w: cannot delete %s because its automatic transfer record for container %s / SKU %s from %s, section %s is missing; correct this shipment manually",
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
				return mapDBError(fmt.Errorf("check activity after automatic transfer: %w", err))
			}
			if hasLaterActivity != 0 {
				return fmt.Errorf(
					"%w: cannot delete %s because container %s / SKU %s at %s, section %s has later inventory activity after its automatic transfer; reverse or correct the later activity first",
					ErrInvalidInput,
					reference,
					containerNo,
					sku,
					sourceLocation,
					sourceSection,
				)
			}
		}
	}
	return nil
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
		PlannedQuantity:   lineRow.PlannedQuantity,
		ActualQuantity:    lineRow.Quantity,
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
	reservationQuantity := outboundLineReservationQuantity(*line)
	if reservationQuantity == 0 {
		line.PickAllocations = nil
		return nil
	}

	plannedAllocations := normalizeOutboundPickAllocations(line.PickAllocations)
	if len(plannedAllocations) == 0 {
		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, source, reservationQuantity, newOutboundAllocationReservationState())
		if err != nil {
			return err
		}
		plannedAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
	}
	if totalOutboundPickAllocationQuantity(plannedAllocations) != reservationQuantity {
		return fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
	}
	line.PickAllocations = plannedAllocations
	return nil
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
		lineInput := outboundLineInputFromRow(customerID, *lineRow)
		if outboundLineReservationQuantity(lineInput) == 0 {
			lineInput.PickAllocations = nil
			if err := s.persistOutboundDocumentLineReservationTx(ctx, tx, lineRow.ID, lineInput); err != nil {
				return nil, err
			}
			if err := s.replaceOutboundContainerAllocationsTx(ctx, tx, lineRow.ID, customerID, lineRow.SKUMasterID, nil); err != nil {
				return nil, err
			}
			lineRow.PickAllocationsJSON = mustEncodeOutboundPickAllocations(lineInput.PickAllocations)
			continue
		}
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

func (s *Store) cancelOutboundDocumentReservationsTx(ctx context.Context, tx *sql.Tx, lineRows []outboundDocumentLineRow) error {
	for _, lineRow := range lineRows {
		if err := s.releaseOutboundContainerAllocationBalancesTx(ctx, tx, lineRow.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_container_allocations
			SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
			WHERE outbound_line_id = ?
		`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("cancel released container allocations: %w", err))
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
				id = LAST_INSERT_ID(id)
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
	if normalizeDocumentStatus(documentRow.Status) == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: deleted shipment cannot be archived", ErrInvalidInput)
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
	if normalizeDocumentStatus(documentRow.Status) == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: deleted shipment cannot be copied", ErrInvalidInput)
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
				planned_quantity,
				pallets,
				pallets_detail_ctns,
				unit_label,
				carton_size_mm,
				net_weight_kgs,
				gross_weight_kgs,
				line_note,
				pick_allocations_json,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			lineRow.PlannedQuantity,
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

func loadOutboundDocumentCustomerIDTx(ctx context.Context, tx *sql.Tx, documentID int64) (int64, error) {
	var customerID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT customer_id
		FROM outbound_documents
		WHERE id = ?
	`, documentID).Scan(&customerID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("load outbound document customer: %w", err)
	}
	return customerID, nil
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
			CASE WHEN planned_quantity > 0 THEN planned_quantity ELSE quantity END AS planned_quantity,
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
			&lineRow.PlannedQuantity,
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
			CASE WHEN planned_quantity > 0 THEN planned_quantity ELSE quantity END AS planned_quantity,
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
		storedPickAllocations := decodeOutboundStoredPickAllocationsOrEmpty(lineRow.ID, lineRow.PickAllocationsJSON)
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

func newOutboundAllocationReservationState() *outboundAllocationReservationState {
	return &outboundAllocationReservationState{
		ByBucketKey:        make(map[string]int),
		PalletsByBucketKey: make(map[string]int),
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

func (s *Store) loadOutboundSourceReferenceTx(ctx context.Context, tx *sql.Tx, customerID int64, locationID int64, skuMasterID int64) (lockedOutboundSource, error) {
	var source lockedOutboundSource
	if err := tx.QueryRowContext(ctx, `
		SELECT
			sm.id,
			c.id,
			COALESCE(NULLIF(cic.item_number, ''), NULLIF(sm.item_number, ''), '') AS item_number,
			l.id,
			l.name,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit
		FROM sku_master sm
		JOIN customers c ON c.id = ?
		JOIN storage_locations l ON l.id = ?
		JOIN customer_item_catalog cic
			ON cic.customer_id = c.id
			AND cic.sku_master_id = sm.id
		WHERE sm.id = ?
	`, customerID, locationID, skuMasterID).Scan(
		&source.SKUMasterID,
		&source.CustomerID,
		&source.ItemNumber,
		&source.LocationID,
		&source.LocationName,
		&source.SKU,
		&source.Description,
		&source.Unit,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return lockedOutboundSource{}, ErrNotFound
		}
		return lockedOutboundSource{}, fmt.Errorf("load outbound source reference: %w", err)
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
			GREATEST(i.pallets - i.allocated_pallets, 0) AS available_pallets,
			i.quantity AS on_hand_qty,
			i.pallets AS on_hand_pallets,
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
			&row.AvailablePallets,
			&row.OnHandQty,
			&row.OnHandPallets,
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
			BucketKey:        lockedRow.BucketKey,
			SKUMasterID:      lockedRow.SKUMasterID,
			CustomerID:       lockedRow.CustomerID,
			ItemNumber:       lockedRow.ItemNumber,
			LocationID:       lockedRow.LocationID,
			LocationName:     lockedRow.LocationName,
			StorageSection:   fallbackSection(lockedRow.StorageSection),
			ContainerNo:      lockedRow.ContainerNo,
			SKU:              lockedRow.SKU,
			Description:      lockedRow.Description,
			Unit:             lockedRow.Unit,
			AvailableQty:     lockedRow.AvailableQty,
			AvailablePallets: lockedRow.AvailablePallets,
			OnHandQty:        lockedRow.OnHandQty,
			OnHandPallets:    lockedRow.OnHandPallets,
			SortAt:           sortTime,
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
	requestedQty := outboundLineReservationQuantity(*line)
	if requestedQty == 0 {
		line.PickAllocations = nil
		return nil, nil
	}

	if len(line.PickAllocations) > 0 {
		allocations, err := s.resolveOutboundDraftBucketAllocationsTx(ctx, tx, source, requestedQty, line.PickAllocations, reservationState)
		if err != nil {
			return nil, err
		}
		line.PickAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
		return allocations, nil
	}

	return s.resolveOutboundLineAllocationsTx(ctx, tx, source, requestedQty, reservationState)
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
	if reservationState.ByBucketKey == nil {
		reservationState.ByBucketKey = make(map[string]int)
	}
	if reservationState.PalletsByBucketKey == nil {
		reservationState.PalletsByBucketKey = make(map[string]int)
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
		BucketKey        string
		AllocatedQty     int
		AllocatedPallets int
	}, 0, len(normalizedDraftAllocations))

	for _, draftAllocation := range normalizedDraftAllocations {
		locationID := firstNonZeroInt64(draftAllocation.LocationID, source.LocationID)
		storageSection := fallbackSection(draftAllocation.StorageSection)
		containerNo := strings.TrimSpace(draftAllocation.ContainerNo)
		bucketKey := outboundAllocationBucketKey(source.CustomerID, locationID, source.SKUMasterID, storageSection, containerNo)
		candidate, exists := candidateByBucketKey[bucketKey]
		if !exists {
			for _, applied := range appliedReservations {
				reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
				reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.AllocatedPallets
			}
			return nil, ErrInsufficientStock
		}

		effectiveAvailable := candidate.AvailableQty - reservationState.ByBucketKey[bucketKey]
		effectiveAvailablePallets := candidate.AvailablePallets - reservationState.PalletsByBucketKey[bucketKey]
		isStagedWarehouseTransfer := draftAllocation.SourceLocationID > 0 &&
			draftAllocation.SourceLocationID != locationID &&
			draftAllocation.StartingPallets == nil &&
			draftAllocation.RemainingPallets == nil
		startingPallets := maxInt(candidate.OnHandPallets-reservationState.PalletsByBucketKey[bucketKey], 0)
		remainingPallets := remainingOutboundInventoryPallets(
			maxInt(candidate.OnHandQty-reservationState.ByBucketKey[bucketKey], 0),
			startingPallets,
			draftAllocation.AllocatedQty,
		)
		physicalPalletRelease := draftAllocation.Pallets
		if !isStagedWarehouseTransfer {
			physicalPalletRelease = maxInt(startingPallets-remainingPallets, 0)
		}
		if draftAllocation.AllocatedQty > effectiveAvailable || physicalPalletRelease > effectiveAvailablePallets {
			for _, applied := range appliedReservations {
				reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
				reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.AllocatedPallets
			}
			return nil, ErrInsufficientStock
		}

		candidate.AllocatedQty = draftAllocation.AllocatedQty
		candidate.LocationID = locationID
		candidate.LocationName = firstNonEmpty(strings.TrimSpace(draftAllocation.LocationName), candidate.LocationName, source.LocationName)
		candidate.StorageSection = storageSection
		candidate.ContainerNo = containerNo
		candidate.ItemNumber = firstNonEmpty(strings.TrimSpace(draftAllocation.ItemNumber), candidate.ItemNumber, source.ItemNumber)
		candidate.Pallets = physicalPalletRelease
		candidate.InventoryPalletsUsed = draftAllocation.InventoryPalletsUsed
		if isStagedWarehouseTransfer {
			candidate.StartingPallets = nil
			candidate.RemainingPallets = nil
		} else {
			candidate.StartingPallets = cloneIntPointer(&startingPallets)
			candidate.RemainingPallets = cloneIntPointer(&remainingPallets)
			if err := validateOutboundFinalPalletAllocation(OutboundPickAllocation{
				ContainerNo:          candidate.ContainerNo,
				AllocatedQty:         candidate.AllocatedQty,
				Pallets:              candidate.Pallets,
				InventoryPalletsUsed: candidate.InventoryPalletsUsed,
				StartingPallets:      candidate.StartingPallets,
				RemainingPallets:     candidate.RemainingPallets,
			}); err != nil {
				for _, applied := range appliedReservations {
					reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
					reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.AllocatedPallets
				}
				return nil, err
			}
		}
		candidate.SourceLocationID = draftAllocation.SourceLocationID
		candidate.SourceTransferID = draftAllocation.SourceTransferID
		candidate.SourceLocationName = draftAllocation.SourceLocationName
		candidate.SourceStorageSection = draftAllocation.SourceStorageSection
		candidate.SourceStartingPallets = cloneIntPointer(draftAllocation.SourceStartingPallets)
		candidate.SourceRemainingPallets = cloneIntPointer(draftAllocation.SourceRemainingPallets)
		candidate.AutoTransferToMain = draftAllocation.AutoTransferToMain

		allocations = append(allocations, candidate)
		reservationState.ByBucketKey[bucketKey] += draftAllocation.AllocatedQty
		reservationState.PalletsByBucketKey[bucketKey] += candidate.Pallets
		appliedReservations = append(appliedReservations, struct {
			BucketKey        string
			AllocatedQty     int
			AllocatedPallets int
		}{
			BucketKey:        bucketKey,
			AllocatedQty:     draftAllocation.AllocatedQty,
			AllocatedPallets: candidate.Pallets,
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
	if reservationState.ByBucketKey == nil {
		reservationState.ByBucketKey = make(map[string]int)
	}
	if reservationState.PalletsByBucketKey == nil {
		reservationState.PalletsByBucketKey = make(map[string]int)
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
		BucketKey        string
		AllocatedQty     int
		AllocatedPallets int
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

		startingQty := maxInt(candidate.OnHandQty-reservationState.ByBucketKey[candidate.BucketKey], 0)
		startingPallets := maxInt(candidate.OnHandPallets-reservationState.PalletsByBucketKey[candidate.BucketKey], 0)
		remainingPallets := remainingOutboundInventoryPallets(startingQty, startingPallets, allocatedQty)
		candidate.AllocatedQty = allocatedQty
		candidate.Pallets = maxInt(startingPallets-remainingPallets, 0)
		candidate.InventoryPalletsUsed = automaticInventoryPalletsForAllocation(effectiveAvailable, startingPallets, allocatedQty)
		candidate.StartingPallets = cloneIntPointer(&startingPallets)
		candidate.RemainingPallets = cloneIntPointer(&remainingPallets)
		allocations = append(allocations, candidate)
		reservationState.ByBucketKey[candidate.BucketKey] += allocatedQty
		reservationState.PalletsByBucketKey[candidate.BucketKey] += candidate.Pallets
		appliedReservations = append(appliedReservations, struct {
			BucketKey        string
			AllocatedQty     int
			AllocatedPallets int
		}{
			BucketKey:        candidate.BucketKey,
			AllocatedQty:     allocatedQty,
			AllocatedPallets: candidate.Pallets,
		})
		remainingQty -= allocatedQty

		if remainingQty == 0 {
			break
		}
	}
	if remainingQty > 0 {
		for _, applied := range appliedReservations {
			reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
			reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.AllocatedPallets
		}
		return nil, classifyReservedStockConflict(requestedQty, source.Quantity, source.AllocatedQty, source.DamagedQty, source.HoldQty)
	}

	return allocations, nil
}

func automaticInventoryPalletsForAllocation(availableQty int, availablePallets int, allocatedQty int) int {
	if availableQty <= 0 || availablePallets <= 0 || allocatedQty <= 0 {
		return 0
	}
	if allocatedQty >= availableQty {
		return availablePallets
	}

	allocatedPallets := int(math.Ceil(float64(availablePallets) * float64(allocatedQty) / float64(availableQty)))
	if allocatedPallets < 0 {
		return 0
	}
	if allocatedPallets > availablePallets {
		return availablePallets
	}
	return allocatedPallets
}

func remainingOutboundInventoryPallets(startingQty int, startingPallets int, allocatedQty int) int {
	startingQty = maxInt(startingQty, 0)
	startingPallets = maxInt(startingPallets, 0)
	allocatedQty = maxInt(allocatedQty, 0)
	if allocatedQty >= startingQty {
		return 0
	}
	return startingPallets
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
		line = normalizeOutboundLineQuantities(line)
		line.UnitLabel = strings.TrimSpace(strings.ToUpper(line.UnitLabel))
		line.CartonSizeMM = strings.TrimSpace(line.CartonSizeMM)
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.LineNote = strings.TrimSpace(line.LineNote)
		line.PickAllocations = normalizeOutboundPickAllocations(line.PickAllocations)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 || (line.PlannedQuantity <= 0 && line.ActualQuantity <= 0) {
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
		line = normalizeOutboundLineQuantities(line)
		reservationQuantity := outboundLineReservationQuantity(line)
		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: warehouse is required", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: SKU is required", ErrInvalidInput)
		case line.PlannedQuantity < 0 || line.ActualQuantity < 0:
			return fmt.Errorf("%w: planned and actual outbound quantities cannot be negative", ErrInvalidInput)
		case line.PlannedQuantity == 0 && line.ActualQuantity == 0:
			return fmt.Errorf("%w: planned or actual outbound quantity must be greater than zero", ErrInvalidInput)
		case line.ActualQuantity == 0 && line.Pallets != 0:
			return fmt.Errorf("%w: pallets must be zero when actual outbound quantity is zero", ErrInvalidInput)
		case line.Pallets < 0:
			return fmt.Errorf("%w: pallets cannot be negative", ErrInvalidInput)
		case line.NetWeightKgs < 0 || line.GrossWeightKgs < 0:
			return fmt.Errorf("%w: weights cannot be negative", ErrInvalidInput)
		case len(line.PickAllocations) > 0 && totalOutboundPickAllocationQuantity(line.PickAllocations) != reservationQuantity:
			return fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
		}
		for _, allocation := range line.PickAllocations {
			if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
				return err
			}
		}
	}

	return nil
}

func validateOutboundFinalPalletAllocation(allocation OutboundPickAllocation) error {
	if allocation.StartingPallets == nil && allocation.RemainingPallets == nil {
		return nil
	}
	containerNo := firstNonEmpty(strings.TrimSpace(allocation.ContainerNo), "selected container")
	if allocation.StartingPallets == nil || allocation.RemainingPallets == nil {
		return fmt.Errorf("%w: source container %s requires both starting and remaining inventory pallets", ErrInvalidInput, containerNo)
	}
	startingPallets := *allocation.StartingPallets
	remainingPallets := *allocation.RemainingPallets
	if startingPallets < 0 || remainingPallets < 0 || remainingPallets > startingPallets {
		return fmt.Errorf("%w: source container %s remaining inventory pallets must be between 0 and the starting balance of %d", ErrInvalidInput, containerNo, maxInt(startingPallets, 0))
	}
	if allocation.Pallets != startingPallets-remainingPallets {
		return fmt.Errorf("%w: source container %s inventory pallet release must equal starting pallets minus remaining pallets", ErrInvalidInput, containerNo)
	}
	if allocation.InventoryPalletsUsed < 0 || allocation.InventoryPalletsUsed > startingPallets {
		return fmt.Errorf("%w: source container %s inventory pallets used must be between 0 and the starting balance of %d", ErrInvalidInput, containerNo, startingPallets)
	}
	return nil
}

type outboundFinalPalletSnapshot struct {
	Quantity int
	Pallets  int
}

func (s *Store) refreshOutboundFinalPalletSnapshotsTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	lineRows []outboundDocumentLineRow,
) ([]outboundDocumentLineRow, error) {
	snapshots := make(map[string]outboundFinalPalletSnapshot)
	for lineIndex := range lineRows {
		lineRow := &lineRows[lineIndex]
		allocations := decodeOutboundPickAllocationsOrEmpty(lineRow.PickAllocationsJSON)
		if len(allocations) == 0 {
			continue
		}

		for allocationIndex := range allocations {
			allocation := &allocations[allocationIndex]
			locationID := firstNonZeroInt64(allocation.LocationID, lineRow.LocationID)
			storageSection := fallbackSection(allocation.StorageSection)
			containerNo := normalizeContainerNo(allocation.ContainerNo)
			bucketKey := outboundAllocationBucketKey(customerID, locationID, lineRow.SKUMasterID, storageSection, containerNo)
			snapshot, exists := snapshots[bucketKey]
			if !exists {
				rows, err := tx.QueryContext(ctx, `
					SELECT quantity, pallets
					FROM inventory_items
					WHERE customer_id = ?
					  AND sku_master_id = ?
					  AND location_id = ?
					  AND storage_section = ?
					  AND container_no = ?
					FOR UPDATE
				`, customerID, lineRow.SKUMasterID, locationID, storageSection, containerNo)
				if err != nil {
					return nil, mapDBError(fmt.Errorf("lock outbound pallet snapshot: %w", err))
				}
				matchedRows := 0
				for rows.Next() {
					var quantity int
					var pallets int
					if err := rows.Scan(&quantity, &pallets); err != nil {
						rows.Close()
						return nil, fmt.Errorf("scan outbound pallet snapshot: %w", err)
					}
					snapshot.Quantity += quantity
					snapshot.Pallets += pallets
					matchedRows++
				}
				if err := rows.Err(); err != nil {
					rows.Close()
					return nil, fmt.Errorf("iterate outbound pallet snapshot: %w", err)
				}
				if err := rows.Close(); err != nil {
					return nil, fmt.Errorf("close outbound pallet snapshot: %w", err)
				}
				if matchedRows == 0 {
					return nil, ErrInsufficientStock
				}
			}

			if allocation.AllocatedQty > snapshot.Quantity {
				return nil, ErrInsufficientStock
			}
			startingPallets := maxInt(snapshot.Pallets, 0)
			remainingQuantity := snapshot.Quantity - allocation.AllocatedQty
			remainingPallets := remainingOutboundInventoryPallets(snapshot.Quantity, startingPallets, allocation.AllocatedQty)
			allocation.LocationID = locationID
			allocation.StorageSection = storageSection
			allocation.ContainerNo = containerNo
			allocation.StartingPallets = cloneIntPointer(&startingPallets)
			allocation.RemainingPallets = cloneIntPointer(&remainingPallets)
			allocation.Pallets = maxInt(startingPallets-remainingPallets, 0)
			snapshots[bucketKey] = outboundFinalPalletSnapshot{
				Quantity: remainingQuantity,
				Pallets:  remainingPallets,
			}
		}

		encodedAllocations := mustEncodeOutboundPickAllocations(allocations)
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_document_lines
			SET pick_allocations_json = ?
			WHERE id = ?
		`, nullableString(encodedAllocations), lineRow.ID); err != nil {
			return nil, mapDBError(fmt.Errorf("refresh outbound pallet snapshot: %w", err))
		}
		lineRow.PickAllocationsJSON = encodedAllocations
	}
	return lineRows, nil
}

func (s *Store) validateOutboundFinalPalletBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	skuMasterID int64,
	allocation OutboundPickAllocation,
) error {
	if allocation.StartingPallets == nil && allocation.RemainingPallets == nil {
		if allocation.SourceLocationID > 0 && allocation.SourceLocationID != allocation.LocationID && allocation.SourceStartingPallets != nil && allocation.SourceRemainingPallets != nil {
			return nil
		}
		return fmt.Errorf(
			"%w: source container %s has no derived pallet-balance snapshot; reopen or revalidate the shipment before confirmation",
			ErrInvalidInput,
			firstNonEmpty(normalizeContainerNo(allocation.ContainerNo), "selected container"),
		)
	}
	if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
		return err
	}
	locationID := allocation.LocationID
	containerNo := normalizeContainerNo(allocation.ContainerNo)
	rows, err := tx.QueryContext(ctx, `
		SELECT quantity, pallets
		FROM inventory_items
		WHERE customer_id = ?
		  AND sku_master_id = ?
		  AND location_id = ?
		  AND storage_section = ?
		  AND container_no = ?
		FOR UPDATE
	`, customerID, skuMasterID, locationID, fallbackSection(allocation.StorageSection), containerNo)
	if err != nil {
		return mapDBError(fmt.Errorf("lock outbound final pallet balance: %w", err))
	}
	defer rows.Close()
	currentQuantity := 0
	currentPallets := 0
	matchedRows := 0
	for rows.Next() {
		var quantity int
		var pallets int
		if err := rows.Scan(&quantity, &pallets); err != nil {
			return fmt.Errorf("scan outbound final pallet balance: %w", err)
		}
		currentQuantity += quantity
		currentPallets += pallets
		matchedRows++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate outbound final pallet balance: %w", err)
	}
	if matchedRows == 0 {
		return ErrInsufficientStock
	}
	startingPallets := *allocation.StartingPallets
	remainingPallets := *allocation.RemainingPallets
	if currentPallets != startingPallets {
		return fmt.Errorf("%w: source container %s pallet balance changed from %d to %d; reopen or revalidate the shipment before confirming", ErrInvalidInput, containerNo, startingPallets, currentPallets)
	}
	remainingQuantity := currentQuantity - allocation.AllocatedQty
	if remainingQuantity < 0 {
		return ErrInsufficientStock
	}
	if remainingQuantity == 0 && remainingPallets != 0 {
		return fmt.Errorf("%w: source container %s will have no quantity left, so remaining inventory pallets must be 0", ErrInvalidInput, containerNo)
	}
	if remainingQuantity > 0 && remainingPallets == 0 {
		return fmt.Errorf("%w: source container %s will still have %d CTN, so remaining inventory pallets must be at least 1", ErrInvalidInput, containerNo, remainingQuantity)
	}
	return nil
}

func outboundPickAllocationSnapshotKey(locationID int64, storageSection string, containerNo string) string {
	return fmt.Sprintf("%d|%s|%s", locationID, fallbackSection(storageSection), normalizeContainerNo(containerNo))
}

func outboundAllocationInventoryPalletsUsed(allocation OutboundPickAllocation) int {
	if allocation.StartingPallets != nil && allocation.RemainingPallets != nil {
		return maxInt(allocation.InventoryPalletsUsed, 0)
	}
	if allocation.InventoryPalletsUsed > 0 {
		return allocation.InventoryPalletsUsed
	}
	return maxInt(allocation.Pallets, 0)
}

func normalizeOutboundLineQuantities(line CreateOutboundDocumentLineInput) CreateOutboundDocumentLineInput {
	if line.ActualQuantity == 0 && line.Quantity > 0 {
		line.ActualQuantity = line.Quantity
	}
	if line.Quantity == 0 && line.ActualQuantity > 0 {
		line.Quantity = line.ActualQuantity
	}
	if line.PlannedQuantity == 0 && line.ActualQuantity > 0 {
		line.PlannedQuantity = line.ActualQuantity
	}
	return line
}

func outboundLineReservationQuantity(line CreateOutboundDocumentLineInput) int {
	if line.ActualQuantity > 0 {
		return line.ActualQuantity
	}
	if line.Quantity > 0 {
		return line.Quantity
	}
	return 0
}

func resolveOutboundLedgerDate(expectedShipDate *time.Time, actualShipDate *time.Time) *time.Time {
	if actualShipDate != nil {
		return actualShipDate
	}
	return expectedShipDate
}

// earliestOutboundBillingMutationDateTx resolves the oldest billing source
// date that cancellation would invalidate for one outbound allocation. The
// header date drives the outbound fee, while the persisted SHIP date drives
// the container storage timeline. Historical rows can predate today's header
// values, so the locking read must be scoped to the exact line/allocation.
func earliestOutboundBillingMutationDateTx(
	ctx context.Context,
	tx *sql.Tx,
	documentRow outboundDocumentRow,
	lineID int64,
	locationID int64,
	containerNo string,
) (time.Time, error) {
	earliest := documentRow.CreatedAt
	if documentRow.ConfirmedAt != nil {
		earliest = *documentRow.ConfirmedAt
	}
	if documentRow.ActualShipDate != nil {
		earliest = *documentRow.ActualShipDate
	}
	if shipDate := resolveOutboundLedgerDate(documentRow.ExpectedShipDate, documentRow.ActualShipDate); shipDate != nil && shipDate.Before(earliest) {
		earliest = *shipDate
	}

	query := `
		SELECT COALESCE(out_date, occurred_at, created_at)
		FROM stock_ledger
		WHERE source_document_type = ?
		  AND source_document_id = ?
		  AND source_line_id = ?
		  AND event_type = ?`
	args := []any{StockLedgerSourceOutbound, documentRow.ID, lineID, StockLedgerEventShip}
	if locationID > 0 {
		query += " AND location_id = ?"
		args = append(args, locationID)
	}
	containerNo = normalizeContainerNo(containerNo)
	if containerNo != "" {
		query += " AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?"
		args = append(args, containerNo)
	}
	query += " ORDER BY COALESCE(out_date, occurred_at, created_at), id LIMIT 1 FOR UPDATE"

	var persistedShipAt time.Time
	err := tx.QueryRowContext(ctx, query, args...).Scan(&persistedShipAt)
	if err == nil {
		if persistedShipAt.Before(earliest) {
			earliest = persistedShipAt
		}
		return earliest, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, fmt.Errorf("load outbound SHIP billing date: %w", err)
	}
	return earliest, nil
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
		ID                     int64
		LineID                 int64
		ItemNumber             string
		LocationID             int64
		LocationName           string
		StorageSection         string
		ContainerNo            string
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
		CreatedAt              time.Time
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
		sourceStorageSection := strings.TrimSpace(entry.SourceStorageSection)
		key := fmt.Sprintf(
			"%d|%s|%s|%s|%t|%d|%d|%s",
			locationID,
			storageSection,
			containerNo,
			itemNumber,
			entry.AutoTransferToMain,
			entry.SourceLocationID,
			entry.SourceTransferID,
			sourceStorageSection,
		)
		pallets := maxInt(entry.Pallets, 0)
		if entry.StartingPallets != nil && entry.RemainingPallets != nil {
			pallets = maxInt(*entry.StartingPallets-*entry.RemainingPallets, 0)
		}
		inventoryPalletsUsed := maxInt(entry.InventoryPalletsUsed, 0)
		if entry.StartingPallets == nil && entry.RemainingPallets == nil && inventoryPalletsUsed == 0 {
			inventoryPalletsUsed = pallets
		}

		existing, exists := grouped[key]
		if !exists {
			order = append(order, key)
			grouped[key] = &groupedAllocation{
				ID:                     entry.ID,
				LineID:                 entry.LineID,
				ItemNumber:             itemNumber,
				LocationID:             locationID,
				LocationName:           strings.TrimSpace(entry.LocationName),
				StorageSection:         storageSection,
				ContainerNo:            containerNo,
				AllocatedQty:           allocatedQty,
				Pallets:                pallets,
				InventoryPalletsUsed:   inventoryPalletsUsed,
				StartingPallets:        cloneIntPointer(entry.StartingPallets),
				RemainingPallets:       cloneIntPointer(entry.RemainingPallets),
				SourceLocationID:       entry.SourceLocationID,
				SourceTransferID:       entry.SourceTransferID,
				SourceLocationName:     strings.TrimSpace(entry.SourceLocationName),
				SourceStorageSection:   sourceStorageSection,
				SourceStartingPallets:  cloneIntPointer(entry.SourceStartingPallets),
				SourceRemainingPallets: cloneIntPointer(entry.SourceRemainingPallets),
				AutoTransferToMain:     entry.AutoTransferToMain,
				CreatedAt:              entry.CreatedAt,
			}
			continue
		}

		existing.AllocatedQty += allocatedQty
		existing.Pallets += pallets
		existing.InventoryPalletsUsed += inventoryPalletsUsed
		if existing.StartingPallets == nil {
			existing.StartingPallets = cloneIntPointer(entry.StartingPallets)
		}
		if existing.RemainingPallets == nil {
			existing.RemainingPallets = cloneIntPointer(entry.RemainingPallets)
		}
		if existing.SourceLocationID == 0 {
			existing.SourceLocationID = entry.SourceLocationID
		}
		if existing.SourceTransferID == 0 {
			existing.SourceTransferID = entry.SourceTransferID
		}
		if existing.SourceLocationName == "" {
			existing.SourceLocationName = strings.TrimSpace(entry.SourceLocationName)
		}
		if existing.SourceStorageSection == "" {
			existing.SourceStorageSection = strings.TrimSpace(entry.SourceStorageSection)
		}
		if existing.SourceStartingPallets == nil {
			existing.SourceStartingPallets = cloneIntPointer(entry.SourceStartingPallets)
		}
		if existing.SourceRemainingPallets == nil {
			existing.SourceRemainingPallets = cloneIntPointer(entry.SourceRemainingPallets)
		}
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
			ID:                     entry.ID,
			LineID:                 entry.LineID,
			ItemNumber:             entry.ItemNumber,
			LocationID:             entry.LocationID,
			LocationName:           entry.LocationName,
			StorageSection:         entry.StorageSection,
			ContainerNo:            entry.ContainerNo,
			AllocatedQty:           entry.AllocatedQty,
			Pallets:                maxInt(entry.Pallets, 0),
			InventoryPalletsUsed:   maxInt(entry.InventoryPalletsUsed, 0),
			StartingPallets:        cloneIntPointer(entry.StartingPallets),
			RemainingPallets:       cloneIntPointer(entry.RemainingPallets),
			SourceLocationID:       entry.SourceLocationID,
			SourceTransferID:       entry.SourceTransferID,
			SourceLocationName:     entry.SourceLocationName,
			SourceStorageSection:   entry.SourceStorageSection,
			SourceStartingPallets:  cloneIntPointer(entry.SourceStartingPallets),
			SourceRemainingPallets: cloneIntPointer(entry.SourceRemainingPallets),
			AutoTransferToMain:     entry.AutoTransferToMain,
			CreatedAt:              entry.CreatedAt,
		})
	}
	return normalized
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
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

func decodeOutboundStoredPickAllocationsOrEmpty(lineID int64, raw string) []OutboundPickAllocation {
	entries := decodeOutboundPickAllocationsOrEmpty(raw)
	for index := range entries {
		entries[index].LineID = lineID
		if entries[index].ID <= 0 {
			entries[index].ID = -int64(index + 1)
		}
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
			BucketKey:              outboundAllocationBucketKey(source.CustomerID, firstNonZeroInt64(entry.LocationID, source.LocationID), source.SKUMasterID, entry.StorageSection, entry.ContainerNo),
			SKUMasterID:            source.SKUMasterID,
			CustomerID:             source.CustomerID,
			ItemNumber:             firstNonEmpty(strings.TrimSpace(entry.ItemNumber), source.ItemNumber),
			LocationID:             firstNonZeroInt64(entry.LocationID, source.LocationID),
			LocationName:           firstNonEmpty(strings.TrimSpace(entry.LocationName), source.LocationName),
			StorageSection:         fallbackSection(entry.StorageSection),
			ContainerNo:            strings.TrimSpace(entry.ContainerNo),
			SKU:                    source.SKU,
			Description:            source.Description,
			Unit:                   source.Unit,
			AllocatedQty:           entry.AllocatedQty,
			Pallets:                maxInt(entry.Pallets, 0),
			InventoryPalletsUsed:   maxInt(entry.InventoryPalletsUsed, 0),
			StartingPallets:        cloneIntPointer(entry.StartingPallets),
			RemainingPallets:       cloneIntPointer(entry.RemainingPallets),
			SourceLocationID:       entry.SourceLocationID,
			SourceTransferID:       entry.SourceTransferID,
			SourceLocationName:     entry.SourceLocationName,
			SourceStorageSection:   entry.SourceStorageSection,
			SourceStartingPallets:  cloneIntPointer(entry.SourceStartingPallets),
			SourceRemainingPallets: cloneIntPointer(entry.SourceRemainingPallets),
			AutoTransferToMain:     entry.AutoTransferToMain,
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
			ItemNumber:             firstNonEmpty(strings.TrimSpace(allocation.ItemNumber)),
			LocationID:             allocation.LocationID,
			LocationName:           allocation.LocationName,
			StorageSection:         fallbackSection(allocation.StorageSection),
			ContainerNo:            strings.TrimSpace(allocation.ContainerNo),
			AllocatedQty:           allocation.AllocatedQty,
			Pallets:                maxInt(allocation.Pallets, 0),
			InventoryPalletsUsed:   maxInt(allocation.InventoryPalletsUsed, 0),
			StartingPallets:        cloneIntPointer(allocation.StartingPallets),
			RemainingPallets:       cloneIntPointer(allocation.RemainingPallets),
			SourceLocationID:       allocation.SourceLocationID,
			SourceTransferID:       allocation.SourceTransferID,
			SourceLocationName:     allocation.SourceLocationName,
			SourceStorageSection:   allocation.SourceStorageSection,
			SourceStartingPallets:  cloneIntPointer(allocation.SourceStartingPallets),
			SourceRemainingPallets: cloneIntPointer(allocation.SourceRemainingPallets),
			AutoTransferToMain:     allocation.AutoTransferToMain,
			CreatedAt:              createdAt,
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
