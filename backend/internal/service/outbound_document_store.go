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
	ConfirmedAt         *time.Time             `json:"confirmedAt"`
	CancelNote          string                 `json:"cancelNote"`
	CancelledAt         *time.Time             `json:"cancelledAt"`
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
	MovementID     int64     `json:"movementId"`
	ItemID         int64     `json:"itemId"`
	ItemNumber     string    `json:"itemNumber"`
	LocationID     int64     `json:"locationId"`
	LocationName   string    `json:"locationName"`
	StorageSection string    `json:"storageSection"`
	ContainerNo    string    `json:"containerNo"`
	AllocatedQty   int       `json:"allocatedQty"`
	CreatedAt      time.Time `json:"createdAt"`
}

type OutboundDocumentLine struct {
	ID              int64                    `json:"id"`
	DocumentID      int64                    `json:"documentId"`
	MovementID      int64                    `json:"movementId"`
	ItemID          int64                    `json:"itemId"`
	ItemNumber      string                   `json:"itemNumber"`
	LocationID      int64                    `json:"locationId"`
	LocationName    string                   `json:"locationName"`
	StorageSection  string                   `json:"storageSection"`
	SKU             string                   `json:"sku"`
	Description     string                   `json:"description"`
	Quantity        int                      `json:"quantity"`
	Pallets         int                      `json:"pallets"`
	PalletsDetailCtns string                 `json:"palletsDetailCtns"`
	UnitLabel       string                   `json:"unitLabel"`
	CartonSizeMM    string                   `json:"cartonSizeMm"`
	NetWeightKgs    float64                  `json:"netWeightKgs"`
	GrossWeightKgs  float64                  `json:"grossWeightKgs"`
	LineNote        string                   `json:"lineNote"`
	PickAllocations []OutboundPickAllocation `json:"pickAllocations"`
	CreatedAt       time.Time                `json:"createdAt"`
}

type CreateOutboundDocumentInput struct {
	PackingListNo string                            `json:"packingListNo"`
	OrderRef      string                            `json:"orderRef"`
	OutDate       string                            `json:"outDate"`
	ShipToName    string                            `json:"shipToName"`
	ShipToAddress string                            `json:"shipToAddress"`
	ShipToContact string                            `json:"shipToContact"`
	CarrierName   string                            `json:"carrierName"`
	Status        string                            `json:"status"`
	DocumentNote  string                            `json:"documentNote"`
	Lines         []CreateOutboundDocumentLineInput `json:"lines"`
}

type CreateOutboundLineAllocationInput struct {
	StorageSection string `json:"storageSection"`
	ContainerNo    string `json:"containerNo"`
	AllocatedQty   int    `json:"allocatedQty"`
}

type CreateOutboundDocumentLineInput struct {
	ItemID          int64                            `json:"itemId"`
	Quantity        int                              `json:"quantity"`
	Pallets         int                              `json:"pallets"`
	PalletsDetailCtns string                         `json:"palletsDetailCtns"`
	UnitLabel       string                           `json:"unitLabel"`
	CartonSizeMM    string                           `json:"cartonSizeMm"`
	NetWeightKgs    float64                          `json:"netWeightKgs"`
	GrossWeightKgs  float64                          `json:"grossWeightKgs"`
	LineNote        string                           `json:"lineNote"`
	PickAllocations []CreateOutboundLineAllocationInput `json:"pickAllocations"`
}

type outboundDocumentRow struct {
	ID            int64      `db:"id"`
	PackingListNo string     `db:"packing_list_no"`
	OrderRef      string     `db:"order_ref"`
	CustomerID    int64      `db:"customer_id"`
	CustomerName  string     `db:"customer_name"`
	OutDate       *time.Time `db:"out_date"`
	ShipToName    string     `db:"ship_to_name"`
	ShipToAddress string     `db:"ship_to_address"`
	ShipToContact string     `db:"ship_to_contact"`
	CarrierName   string     `db:"carrier_name"`
	DocumentNote  string     `db:"document_note"`
	Status        string     `db:"status"`
	ConfirmedAt   *time.Time `db:"confirmed_at"`
	CancelNote    string     `db:"cancel_note"`
	CancelledAt   *time.Time `db:"cancelled_at"`
	CreatedAt     time.Time  `db:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at"`
}

type CancelOutboundDocumentInput struct {
	Reason string `json:"reason"`
}

type documentStatusChangeInput struct {
	Status string `json:"status"`
}

type outboundDocumentLineRow struct {
	ID                  int64     `db:"id"`
	DocumentID          int64     `db:"document_id"`
	MovementID          int64     `db:"movement_id"`
	ItemID              int64     `db:"item_id"`
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
	MovementID     int64     `db:"movement_id"`
	ItemID         int64     `db:"item_id"`
	ItemNumber     string    `db:"item_number"`
	LocationID     int64     `db:"location_id"`
	LocationName   string    `db:"location_name_snapshot"`
	StorageSection string    `db:"storage_section"`
	ContainerNo    string    `db:"container_no_snapshot"`
	AllocatedQty   int       `db:"allocated_qty"`
	CreatedAt      time.Time `db:"created_at"`
}

type lockedOutboundItem struct {
	ItemID         int64
	CustomerID     int64
	ItemNumber     string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	SKU            string
	Description    string
	Unit           string
	Quantity       int
	AvailableQty   int
	HeightIn       int
}

type outboundAllocationCandidate struct {
	ItemID         int64
	CustomerID     int64
	ItemNumber     string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	SKU            string
	Description    string
	Unit           string
	Quantity       int
	AvailableQty   int
	AllocatedQty   int
	HeightIn       int
	SortAt         time.Time
}

type outboundAllocationReservationState struct {
	ByItemID    map[int64]int
	BySourceKey map[string]int
}

type lockedOutboundSourceRow struct {
	ItemID         int64
	CustomerID     int64
	ItemNumber     string
	LocationID     int64
	LocationName   string
	StorageSection string
	ContainerNo    string
	SKU            string
	Description    string
	Unit           string
	Quantity       int
	AvailableQty   int
	HeightIn       int
	DeliveryDate   *time.Time
	CreatedAt      time.Time
}

type outboundMovementBalanceRow struct {
	StorageSection string     `db:"storage_section"`
	ContainerNo    string     `db:"container_no"`
	AvailableQty   int        `db:"available_qty"`
	SortAt         *time.Time `db:"sort_at"`
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
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			d.confirmed_at,
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
	linesByID := make(map[int64]*OutboundDocumentLine)
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:            row.ID,
			PackingListNo: row.PackingListNo,
			OrderRef:      row.OrderRef,
			CustomerID:    row.CustomerID,
			CustomerName:  row.CustomerName,
			OutDate:       row.OutDate,
			ShipToName:    row.ShipToName,
			ShipToAddress: row.ShipToAddress,
			ShipToContact: row.ShipToContact,
			CarrierName:   row.CarrierName,
			DocumentNote:  row.DocumentNote,
			Status:        normalizeDocumentStatus(row.Status),
			ConfirmedAt:   row.ConfirmedAt,
			CancelNote:    row.CancelNote,
			CancelledAt:   row.CancelledAt,
			Lines:         make([]OutboundDocumentLine, 0),
			CreatedAt:     row.CreatedAt,
			UpdatedAt:     row.UpdatedAt,
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
			ID:              lineRow.ID,
			DocumentID:      lineRow.DocumentID,
			MovementID:      lineRow.MovementID,
			ItemID:          lineRow.ItemID,
			ItemNumber:      lineRow.ItemNumberSnapshot,
			LocationID:      lineRow.LocationID,
			LocationName:    lineRow.LocationName,
			StorageSection:  lineRow.StorageSection,
			SKU:             lineRow.SKUSnapshot,
			Description:     lineRow.DescriptionSnapshot,
			Quantity:        lineRow.Quantity,
			Pallets:         lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:       lineRow.UnitLabel,
			CartonSizeMM:    lineRow.CartonSizeMM,
			NetWeightKgs:    lineRow.NetWeightKgs,
			GrossWeightKgs:  lineRow.GrossWeightKgs,
			LineNote:        lineRow.LineNote,
			PickAllocations: make([]OutboundPickAllocation, 0),
			CreatedAt:       lineRow.CreatedAt,
		})
		linesByID[lineRow.ID] = &document.Lines[len(document.Lines)-1]
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}

	if err := s.attachOutboundPickAllocations(ctx, documentIDs, linesByID); err != nil {
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound document transaction: %w", err)
	}
	defer tx.Rollback()

	lockedItems := make(map[int64]lockedOutboundItem)
	reservationState := newOutboundAllocationReservationState()
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
		if _, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedItem, line, reservationState); err != nil {
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
			confirmed_at,
			posted_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
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
	)
	if err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound document: %w", err))
	}

	documentID, err := result.LastInsertId()
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("resolve outbound document id: %w", err)
	}

	if err := s.insertOutboundDocumentLinesTx(ctx, tx, documentID, input, lockedItems); err != nil {
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

	existingLines, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}

	lineIDs := make([]int64, 0, len(existingLines))
	for _, line := range existingLines {
		if line.MovementID > 0 {
			return OutboundDocument{}, fmt.Errorf("%w: confirmed shipment lines cannot be edited", ErrInvalidInput)
		}
		lineIDs = append(lineIDs, line.ID)
	}

	lockedItems := make(map[int64]lockedOutboundItem)
	reservationState := newOutboundAllocationReservationState()
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
		if _, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedItem, line, reservationState); err != nil {
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
		documentID,
	); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("update outbound document: %w", err))
	}

	if err := s.deleteOutboundPickAllocationsTx(ctx, tx, lineIDs); err != nil {
		return OutboundDocument{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_document_lines WHERE document_id = ?`, documentID); err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("delete outbound draft lines: %w", err))
	}

	if err := s.insertOutboundDocumentLinesTx(ctx, tx, documentID, input, lockedItems); err != nil {
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

func (s *Store) insertOutboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64, input CreateOutboundDocumentInput, lockedItems map[int64]lockedOutboundItem) error {
	reservationState := newOutboundAllocationReservationState()
	for index, line := range input.Lines {
		lockedItem := lockedItems[line.ItemID]
		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedItem, line, reservationState)
		if err != nil {
			return err
		}
		lineLocationID := lockedItem.LocationID
		lineLocationName := lockedItem.LocationName
		lineStorageSection := fallbackSection(lockedItem.StorageSection)
		lineItemNumber := strings.TrimSpace(lockedItem.ItemNumber)
		if len(allocations) > 0 {
			lineLocationID = allocations[0].LocationID
			lineLocationName = allocations[0].LocationName
			lineStorageSection = fallbackSection(allocations[0].StorageSection)
			lineItemNumber = firstNonEmpty(lineItemNumber, allocations[0].ItemNumber)
		}

		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_document_lines (
				document_id,
				item_id,
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
			lockedItem.ItemID,
			lineLocationID,
			lineLocationName,
			lineStorageSection,
			nullableString(lineItemNumber),
			lockedItem.SKU,
			nullableString(lockedItem.Description),
			line.Quantity,
			line.Pallets,
			nullableString(line.PalletsDetailCtns),
			nullableString(firstNonEmpty(line.UnitLabel, strings.ToUpper(lockedItem.Unit), "PCS")),
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

		for allocationIndex, allocation := range allocations {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO outbound_pick_allocations (
					line_id,
					item_id,
					location_id,
					location_name_snapshot,
					storage_section,
					container_no_snapshot,
					allocated_qty,
					sort_order
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`,
				lineID,
				allocation.ItemID,
				allocation.LocationID,
				allocation.LocationName,
				fallbackSection(allocation.StorageSection),
				nullableString(allocation.ContainerNo),
				allocation.AllocatedQty,
				allocationIndex+1,
			); err != nil {
				return mapDBError(fmt.Errorf("create outbound pick allocation: %w", err))
			}
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

func (s *Store) PostOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	return s.ConfirmOutboundDocument(ctx, documentID)
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

	lockedItems := make(map[int64]lockedOutboundItem)
	reservationState := newOutboundAllocationReservationState()
	lineIDs := make([]int64, 0, len(lineRows))
	for _, lineRow := range lineRows {
		lineIDs = append(lineIDs, lineRow.ID)
	}

	storedAllocationsByLineID, err := s.loadOutboundPickAllocationsTx(ctx, tx, lineIDs)
	if err != nil {
		return err
	}

	lineAllocations := make(map[int64][]outboundAllocationCandidate, len(lineRows))

	for _, lineRow := range lineRows {
		lockedItem, exists := lockedItems[lineRow.ItemID]
		if !exists {
			lockedItem, err = s.loadLockedOutboundItem(ctx, tx, lineRow.ItemID)
			if err != nil {
				return err
			}
			lockedItems[lineRow.ItemID] = lockedItem
		}

		lineInput := CreateOutboundDocumentLineInput{
			ItemID:            lineRow.ItemID,
			Quantity:          lineRow.Quantity,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			CartonSizeMM:      lineRow.CartonSizeMM,
			NetWeightKgs: lineRow.NetWeightKgs,
			GrossWeightKgs: lineRow.GrossWeightKgs,
			LineNote:          lineRow.LineNote,
			PickAllocations: toCreateOutboundLineAllocationInputs(storedAllocationsByLineID[lineRow.ID]),
		}

		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, lockedItem, lineInput, reservationState)
		if err != nil {
			return err
		}

		lineAllocations[lineRow.ID] = allocations
	}

	if err := s.deleteOutboundPickAllocationsTx(ctx, tx, lineIDs); err != nil {
		return err
	}

	runningQuantities := make(map[int64]int)

	for _, lineRow := range lineRows {
		allocations := lineAllocations[lineRow.ID]
		if len(allocations) == 0 {
			return ErrInsufficientStock
		}

		netWeightSplits := splitProportionalFloat(lineRow.NetWeightKgs, lineRow.Quantity, allocations)
		grossWeightSplits := splitProportionalFloat(lineRow.GrossWeightKgs, lineRow.Quantity, allocations)
		var firstMovementID int64

		for allocationIndex, allocation := range allocations {
			if _, exists := runningQuantities[allocation.ItemID]; !exists {
				runningQuantities[allocation.ItemID] = allocation.Quantity
			}

			updatedQuantity := runningQuantities[allocation.ItemID] - allocation.AllocatedQty
			runningQuantities[allocation.ItemID] = updatedQuantity

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
					delivery_date,
					container_no,
					packing_list_no,
					order_ref,
					item_number,
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
				) VALUES (?, ?, ?, ?, ?, ?, 'OUT', ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
				allocation.ItemID,
				documentID,
				lineRow.ID,
				allocation.CustomerID,
				allocation.LocationID,
				fallbackSection(allocation.StorageSection),
				-allocation.AllocatedQty,
				nullableString(allocation.ContainerNo),
				nullableString(documentRow.PackingListNo),
				nullableString(documentRow.OrderRef),
				nullableString(firstNonEmpty(allocation.ItemNumber, lineRow.ItemNumberSnapshot)),
				nullableString(firstNonEmpty(allocation.Description, lineRow.DescriptionSnapshot)),
				lineRow.Pallets,
				nullableString(lineRow.PalletsDetailCtns),
				nullableString(lineRow.CartonSizeMM),
				allocation.AllocatedQty,
				nullableString(firstNonEmpty(lineRow.UnitLabel, strings.ToUpper(allocation.Unit), "PCS")),
				netWeightSplits[allocationIndex],
				grossWeightSplits[allocationIndex],
				allocation.HeightIn,
				nullableTime(documentRow.OutDate),
				nullableString(documentRow.DocumentNote),
				firstNonEmpty(lineRow.LineNote, defaultMovementReason("OUT")),
			)
			if err != nil {
				return mapDBError(fmt.Errorf("create outbound stock movement: %w", err))
			}

			movementID, err := movementResult.LastInsertId()
			if err != nil {
				return fmt.Errorf("resolve outbound movement id: %w", err)
			}
			if firstMovementID == 0 {
				firstMovementID = movementID
			}

			if _, err := tx.ExecContext(ctx, `
				INSERT INTO outbound_pick_allocations (
					line_id,
					movement_id,
					item_id,
					location_id,
					location_name_snapshot,
					storage_section,
					container_no_snapshot,
					allocated_qty,
					sort_order
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
				lineRow.ID,
				movementID,
				allocation.ItemID,
				allocation.LocationID,
				allocation.LocationName,
				fallbackSection(allocation.StorageSection),
				nullableString(allocation.ContainerNo),
				allocation.AllocatedQty,
				allocationIndex+1,
			); err != nil {
				return mapDBError(fmt.Errorf("rebuild outbound pick allocation: %w", err))
			}

			movementInput := CreateMovementInput{
				ItemID:         allocation.ItemID,
				MovementType:   "OUT",
				Quantity:       allocation.AllocatedQty,
				StorageSection: fallbackSection(allocation.StorageSection),
				ContainerNo:    allocation.ContainerNo,
				PackingListNo:  documentRow.PackingListNo,
				OrderRef:       documentRow.OrderRef,
				ItemNumber:     firstNonEmpty(allocation.ItemNumber, lineRow.ItemNumberSnapshot),
				CartonSizeMM:   lineRow.CartonSizeMM,
				CartonCount:    allocation.AllocatedQty,
				UnitLabel:      firstNonEmpty(lineRow.UnitLabel, strings.ToUpper(allocation.Unit), "PCS"),
				NetWeightKgs:   netWeightSplits[allocationIndex],
				GrossWeightKgs: grossWeightSplits[allocationIndex],
				HeightIn:       allocation.HeightIn,
				OutDate:        safeOutboundDateInput(documentRow.OutDate),
				DocumentNote:   documentRow.DocumentNote,
				Reason:         firstNonEmpty(lineRow.LineNote, defaultMovementReason("OUT")),
			}
			if err := s.applyMovementToInventoryItem(ctx, tx, allocation.ItemID, updatedQuantity, -allocation.AllocatedQty, movementInput, nil, documentRow.OutDate); err != nil {
				return mapDBError(fmt.Errorf("update inventory after outbound allocation: %w", err))
			}
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_document_lines
			SET movement_id = ?
			WHERE id = ?
		`, nullableInt64(firstMovementID), lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("link outbound line to primary movement: %w", err))
		}
	}

	confirmedAt := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_documents
		SET
			status = ?,
			confirmed_at = COALESCE(confirmed_at, ?),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, DocumentStatusConfirmed, confirmedAt, documentID); err != nil {
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

		allocationRows, err := s.loadOutboundPickAllocationsTx(ctx, tx, lineIDs)
		if err != nil {
			return OutboundDocument{}, err
		}

		for _, lineRow := range lineRows {
			allocations := allocationRows[lineRow.ID]
			if len(allocations) == 0 {
				allocations = []outboundPickAllocationRow{{
					LineID:         lineRow.ID,
					ItemID:         lineRow.ItemID,
					LocationID:     lineRow.LocationID,
					LocationName:   lineRow.LocationName,
					StorageSection: lineRow.StorageSection,
					AllocatedQty:   lineRow.Quantity,
				}}
			}

			netWeightSplits := splitProportionalFloat(lineRow.NetWeightKgs, lineRow.Quantity, toAllocationCandidates(allocations))
			grossWeightSplits := splitProportionalFloat(lineRow.GrossWeightKgs, lineRow.Quantity, toAllocationCandidates(allocations))

			for allocationIndex, allocation := range allocations {
				currentQuantity, customerID, locationID, storageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, allocation.ItemID)
				if err != nil {
					return OutboundDocument{}, err
				}

				delta := allocation.AllocatedQty
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
						delivery_date,
						container_no,
						packing_list_no,
						order_ref,
						item_number,
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
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`,
					allocation.ItemID,
					documentID,
					lineRow.ID,
					customerID,
					locationID,
					fallbackSection(storageSection),
					"REVERSAL",
					delta,
					nil,
					nullableString(allocation.ContainerNo),
					nullableString(documentRow.PackingListNo),
					nullableString(documentRow.OrderRef),
					nullableString(firstNonEmpty(allocation.ItemNumber, lineRow.ItemNumberSnapshot)),
					nullableString(firstNonEmpty(descriptionSnapshot, lineRow.DescriptionSnapshot)),
					0,
					0,
					lineRow.Pallets,
					nullableString(lineRow.PalletsDetailCtns),
					nullableString(lineRow.CartonSizeMM),
					delta,
					nullableString(firstNonEmpty(lineRow.UnitLabel, "PCS")),
					netWeightSplits[allocationIndex],
					grossWeightSplits[allocationIndex],
					0,
					nullableTime(documentRow.OutDate),
					nullableString(documentRow.DocumentNote),
					nullableString(cancellationReason),
				); err != nil {
					return OutboundDocument{}, mapDBError(fmt.Errorf("create outbound reversal movement: %w", err))
				}

				movementInput := CreateMovementInput{
					ItemID:         allocation.ItemID,
					MovementType:   "REVERSAL",
					Quantity:       delta,
					StorageSection: fallbackSection(storageSection),
					ContainerNo:    allocation.ContainerNo,
					ItemNumber:     firstNonEmpty(allocation.ItemNumber, lineRow.ItemNumberSnapshot),
					CartonSizeMM:   lineRow.CartonSizeMM,
					CartonCount:    delta,
					UnitLabel:      firstNonEmpty(lineRow.UnitLabel, "PCS"),
					NetWeightKgs:   netWeightSplits[allocationIndex],
					GrossWeightKgs: grossWeightSplits[allocationIndex],
					DocumentNote:   documentRow.DocumentNote,
					Reason:         cancellationReason,
				}
				if err := s.applyMovementToInventoryItem(ctx, tx, allocation.ItemID, updatedQuantity, delta, movementInput, nil, nil); err != nil {
					return OutboundDocument{}, mapDBError(fmt.Errorf("restore inventory after outbound cancellation: %w", err))
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
			d.confirmed_at,
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
		&documentRow.ShipToName,
		&documentRow.ShipToAddress,
		&documentRow.ShipToContact,
		&documentRow.CarrierName,
		&documentRow.DocumentNote,
		&documentRow.Status,
		&documentRow.ConfirmedAt,
		&documentRow.CancelNote,
		&documentRow.CancelledAt,
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
			COALESCE(movement_id, 0) AS movement_id,
			item_id,
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
			&lineRow.MovementID,
			&lineRow.ItemID,
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
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			d.confirmed_at,
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
	linesByID := make(map[int64]*OutboundDocumentLine)
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:            row.ID,
			PackingListNo: row.PackingListNo,
			OrderRef:      row.OrderRef,
			CustomerID:    row.CustomerID,
			CustomerName:  row.CustomerName,
			OutDate:       row.OutDate,
			ShipToName:    row.ShipToName,
			ShipToAddress: row.ShipToAddress,
			ShipToContact: row.ShipToContact,
			CarrierName:   row.CarrierName,
			DocumentNote:  row.DocumentNote,
			Status:        normalizeDocumentStatus(row.Status),
			ConfirmedAt:   row.ConfirmedAt,
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
			ID:              lineRow.ID,
			DocumentID:      lineRow.DocumentID,
			MovementID:      lineRow.MovementID,
			ItemID:          lineRow.ItemID,
			ItemNumber:      lineRow.ItemNumberSnapshot,
			LocationID:      lineRow.LocationID,
			LocationName:    lineRow.LocationName,
			StorageSection:  lineRow.StorageSection,
			SKU:             lineRow.SKUSnapshot,
			Description:     lineRow.DescriptionSnapshot,
			Quantity:        lineRow.Quantity,
			Pallets:         lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:       lineRow.UnitLabel,
			CartonSizeMM:    lineRow.CartonSizeMM,
			NetWeightKgs:    lineRow.NetWeightKgs,
			GrossWeightKgs:  lineRow.GrossWeightKgs,
			LineNote:        lineRow.LineNote,
			PickAllocations: make([]OutboundPickAllocation, 0),
			CreatedAt:       lineRow.CreatedAt,
		})
		linesByID[lineRow.ID] = &document.Lines[len(document.Lines)-1]
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}

	if err := s.attachOutboundPickAllocations(ctx, documentIDs, linesByID); err != nil {
		return nil, err
	}
	recalculateOutboundDocumentStorages(documents)

	return documents, nil
}

func (s *Store) loadLockedOutboundItem(ctx context.Context, tx *sql.Tx, itemID int64) (lockedOutboundItem, error) {
	var item lockedOutboundItem
	if err := tx.QueryRowContext(ctx, `
		SELECT
			i.id,
			i.customer_id,
			COALESCE(i.item_number, ''),
			i.location_id,
			l.name,
			i.storage_section,
			COALESCE(i.container_no, ''),
			i.sku,
			COALESCE(i.description, i.name, ''),
			COALESCE(i.unit, 'pcs'),
			i.quantity,
			GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) AS available_qty,
			i.height_in
		FROM inventory_items i
		JOIN storage_locations l ON l.id = i.location_id
		WHERE i.id = ?
		FOR UPDATE
	`, itemID).Scan(
		&item.ItemID,
		&item.CustomerID,
		&item.ItemNumber,
		&item.LocationID,
		&item.LocationName,
		&item.StorageSection,
		&item.ContainerNo,
		&item.SKU,
		&item.Description,
		&item.Unit,
		&item.Quantity,
		&item.AvailableQty,
		&item.HeightIn,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return lockedOutboundItem{}, ErrNotFound
		}
		return lockedOutboundItem{}, fmt.Errorf("load outbound inventory item: %w", err)
	}

	return item, nil
}

func newOutboundAllocationReservationState() *outboundAllocationReservationState {
	return &outboundAllocationReservationState{
		ByItemID:    make(map[int64]int),
		BySourceKey: make(map[string]int),
	}
}

func outboundAllocationSourceKey(itemID int64, storageSection string, containerNo string) string {
	return fmt.Sprintf("%d|%s|%s", itemID, fallbackSection(storageSection), strings.TrimSpace(containerNo))
}

func outboundAllocationLedgerSourceKey(storageSection string, containerNo string) string {
	return fmt.Sprintf("%s|%s", fallbackSection(storageSection), strings.TrimSpace(containerNo))
}

func (s *Store) loadLockedOutboundAllocationCandidatesTx(ctx context.Context, tx *sql.Tx, lockedItem lockedOutboundItem) ([]outboundAllocationCandidate, map[int64]int, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			i.id,
			i.customer_id,
			COALESCE(i.item_number, ''),
			i.location_id,
			l.name,
			COALESCE(NULLIF(i.storage_section, ''), 'A'),
			COALESCE(i.container_no, ''),
			i.sku,
			COALESCE(i.description, i.name, ''),
			COALESCE(i.unit, 'pcs'),
			i.quantity,
			GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) AS available_qty,
			i.height_in,
			i.delivery_date,
			i.created_at
		FROM inventory_items i
		JOIN storage_locations l ON l.id = i.location_id
		WHERE
			i.customer_id = ?
			AND i.location_id = ?
			AND i.sku = ?
			AND GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) > 0
		ORDER BY
			CASE WHEN i.delivery_date IS NULL THEN 1 ELSE 0 END,
			i.delivery_date ASC,
			i.created_at ASC,
			i.id ASC
		FOR UPDATE
	`,
		lockedItem.CustomerID,
		lockedItem.LocationID,
		lockedItem.SKU,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("load locked outbound source rows: %w", err)
	}
	defer rows.Close()

	lockedRows := make([]lockedOutboundSourceRow, 0)
	itemAvailableByItemID := make(map[int64]int)

	for rows.Next() {
		var (
			row          lockedOutboundSourceRow
			deliveryDate sql.NullTime
		)
		if err := rows.Scan(
			&row.ItemID,
			&row.CustomerID,
			&row.ItemNumber,
			&row.LocationID,
			&row.LocationName,
			&row.StorageSection,
			&row.ContainerNo,
			&row.SKU,
			&row.Description,
			&row.Unit,
			&row.Quantity,
			&row.AvailableQty,
			&row.HeightIn,
			&deliveryDate,
			&row.CreatedAt,
		); err != nil {
			return nil, nil, fmt.Errorf("scan locked outbound source row: %w", err)
		}
		if deliveryDate.Valid {
			deliveryTime := deliveryDate.Time
			row.DeliveryDate = &deliveryTime
		}

		lockedRows = append(lockedRows, row)
		itemAvailableByItemID[row.ItemID] = row.AvailableQty
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate locked outbound source rows: %w", err)
	}
	if len(lockedRows) == 0 {
		return nil, nil, ErrInsufficientStock
	}

	currentCandidatesBySourceKey := make(map[string]outboundAllocationCandidate)
	totalAvailableQty := 0
	for _, lockedRow := range lockedRows {
		totalAvailableQty += lockedRow.AvailableQty
		sourceKey := outboundAllocationLedgerSourceKey(lockedRow.StorageSection, lockedRow.ContainerNo)
		existingCandidate, exists := currentCandidatesBySourceKey[sourceKey]
		if !exists {
			sortTime := lockedRow.CreatedAt
			if lockedRow.DeliveryDate != nil {
				sortTime = *lockedRow.DeliveryDate
			}

			currentCandidatesBySourceKey[sourceKey] = outboundAllocationCandidate{
				ItemID:         lockedRow.ItemID,
				CustomerID:     lockedRow.CustomerID,
				ItemNumber:     lockedRow.ItemNumber,
				LocationID:     lockedRow.LocationID,
				LocationName:   lockedRow.LocationName,
				StorageSection: fallbackSection(lockedRow.StorageSection),
				ContainerNo:    lockedRow.ContainerNo,
				SKU:            lockedRow.SKU,
				Description:    lockedRow.Description,
				Unit:           lockedRow.Unit,
				Quantity:       lockedRow.Quantity,
				AvailableQty:   lockedRow.AvailableQty,
				HeightIn:       lockedRow.HeightIn,
				SortAt:         sortTime,
			}
			continue
		}

		existingCandidate.Quantity += lockedRow.Quantity
		existingCandidate.AvailableQty += lockedRow.AvailableQty
		existingCandidate.ItemNumber = firstNonEmpty(existingCandidate.ItemNumber, lockedRow.ItemNumber)
		if lockedRow.DeliveryDate != nil {
			if existingCandidate.SortAt.IsZero() || lockedRow.DeliveryDate.Before(existingCandidate.SortAt) {
				existingCandidate.SortAt = *lockedRow.DeliveryDate
			}
		} else if !lockedRow.CreatedAt.IsZero() && (existingCandidate.SortAt.IsZero() || lockedRow.CreatedAt.Before(existingCandidate.SortAt)) {
			existingCandidate.SortAt = lockedRow.CreatedAt
		}
		currentCandidatesBySourceKey[sourceKey] = existingCandidate
	}

	movementQuery := `
		SELECT
			COALESCE(NULLIF(m.storage_section, ''), 'A') AS storage_section,
			COALESCE(m.container_no, '') AS container_no,
			SUM(m.quantity_change) AS available_qty,
			MIN(COALESCE(m.delivery_date, m.created_at)) AS sort_at
		FROM stock_movements m
		JOIN inventory_items source_item ON source_item.id = m.item_id
		WHERE
			source_item.customer_id = ?
			AND source_item.location_id = ?
			AND source_item.sku = ?
		GROUP BY
			COALESCE(NULLIF(m.storage_section, ''), 'A'),
			COALESCE(m.container_no, '')
	`

	movementRows, err := tx.QueryContext(ctx, movementQuery, lockedItem.CustomerID, lockedItem.LocationID, lockedItem.SKU)
	if err != nil {
		return nil, nil, fmt.Errorf("load outbound movement balances: %w", err)
	}
	defer movementRows.Close()

	movementCandidatesBySourceKey := make(map[string]outboundAllocationCandidate)
	var fallbackLockedRow lockedOutboundSourceRow
	if len(lockedRows) > 0 {
		fallbackLockedRow = lockedRows[0]
	}

	for movementRows.Next() {
		var (
			balanceRow outboundMovementBalanceRow
			sortAt     sql.NullTime
		)
		if err := movementRows.Scan(
			&balanceRow.StorageSection,
			&balanceRow.ContainerNo,
			&balanceRow.AvailableQty,
			&sortAt,
		); err != nil {
			return nil, nil, fmt.Errorf("scan outbound movement balance: %w", err)
		}
		if balanceRow.AvailableQty <= 0 {
			continue
		}

		sourceKey := outboundAllocationLedgerSourceKey(balanceRow.StorageSection, balanceRow.ContainerNo)
		candidate, exists := currentCandidatesBySourceKey[sourceKey]
		if !exists {
			candidate = outboundAllocationCandidate{
				ItemID:         fallbackLockedRow.ItemID,
				CustomerID:     fallbackLockedRow.CustomerID,
				ItemNumber:     fallbackLockedRow.ItemNumber,
				LocationID:     fallbackLockedRow.LocationID,
				LocationName:   fallbackLockedRow.LocationName,
				StorageSection: fallbackSection(balanceRow.StorageSection),
				ContainerNo:    balanceRow.ContainerNo,
				SKU:            fallbackLockedRow.SKU,
				Description:    fallbackLockedRow.Description,
				Unit:           fallbackLockedRow.Unit,
				Quantity:       fallbackLockedRow.Quantity,
				AvailableQty:   balanceRow.AvailableQty,
				HeightIn:       fallbackLockedRow.HeightIn,
			}
		} else {
			candidate.StorageSection = fallbackSection(balanceRow.StorageSection)
			candidate.ContainerNo = balanceRow.ContainerNo
			candidate.AvailableQty = balanceRow.AvailableQty
		}

		if sortAt.Valid {
			candidate.SortAt = sortAt.Time
			if currentCandidate, currentExists := currentCandidatesBySourceKey[sourceKey]; currentExists {
				currentCandidate.SortAt = sortAt.Time
				currentCandidatesBySourceKey[sourceKey] = currentCandidate
			}
		} else if candidate.SortAt.IsZero() && fallbackLockedRow.DeliveryDate != nil {
			candidate.SortAt = *fallbackLockedRow.DeliveryDate
		}
		movementCandidatesBySourceKey[sourceKey] = candidate
	}
	if err := movementRows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate outbound movement balances: %w", err)
	}

	currentCandidates := make([]outboundAllocationCandidate, 0, len(currentCandidatesBySourceKey))
	currentNamedContainerCount := 0
	for _, candidate := range currentCandidatesBySourceKey {
		if candidate.AvailableQty <= 0 {
			continue
		}
		if strings.TrimSpace(candidate.ContainerNo) != "" {
			currentNamedContainerCount++
		}
		currentCandidates = append(currentCandidates, candidate)
	}

	movementCandidates := make([]outboundAllocationCandidate, 0, len(movementCandidatesBySourceKey))
	for _, candidate := range movementCandidatesBySourceKey {
		if candidate.AvailableQty <= 0 {
			continue
		}
		movementCandidates = append(movementCandidates, candidate)
	}

	sort.SliceStable(movementCandidates, func(leftIndex, rightIndex int) bool {
		left := movementCandidates[leftIndex]
		right := movementCandidates[rightIndex]
		if !left.SortAt.Equal(right.SortAt) {
			return left.SortAt.Before(right.SortAt)
		}
		if left.LocationName != right.LocationName {
			return left.LocationName < right.LocationName
		}
		if fallbackSection(left.StorageSection) != fallbackSection(right.StorageSection) {
			return fallbackSection(left.StorageSection) < fallbackSection(right.StorageSection)
		}
		return left.ContainerNo < right.ContainerNo
	})

	distributedMovementCandidates := make([]outboundAllocationCandidate, 0, len(movementCandidates))
	remainingAvailableQty := totalAvailableQty
	for _, candidate := range movementCandidates {
		if remainingAvailableQty <= 0 {
			break
		}
		distributedQty := candidate.AvailableQty
		if distributedQty > remainingAvailableQty {
			distributedQty = remainingAvailableQty
		}
		if distributedQty <= 0 {
			continue
		}

		candidate.AvailableQty = distributedQty
		distributedMovementCandidates = append(distributedMovementCandidates, candidate)
		remainingAvailableQty -= distributedQty
	}

	useCurrentCandidates := len(distributedMovementCandidates) <= 1 || currentNamedContainerCount > 1
	candidates := currentCandidates
	if !useCurrentCandidates {
		candidates = distributedMovementCandidates
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
		return left.ItemID < right.ItemID
	})

	return candidates, itemAvailableByItemID, nil
}

func (s *Store) allocateOutboundLineTx(ctx context.Context, tx *sql.Tx, lockedItem lockedOutboundItem, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	if requestedQty <= 0 {
		return nil, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
	}

	candidates, itemAvailableByItemID, err := s.loadLockedOutboundAllocationCandidatesTx(ctx, tx, lockedItem)
	if err != nil {
		return nil, err
	}

	allocations := make([]outboundAllocationCandidate, 0)
	remainingQty := requestedQty
	appliedReservations := make([]struct {
		ItemID     int64
		SourceKey  string
		Allocated  int
	}, 0)

	for _, candidate := range candidates {
		sourceKey := outboundAllocationSourceKey(candidate.ItemID, candidate.StorageSection, candidate.ContainerNo)
		effectiveAvailable := candidate.AvailableQty - reservationState.BySourceKey[sourceKey]
		itemRemaining := itemAvailableByItemID[candidate.ItemID] - reservationState.ByItemID[candidate.ItemID]
		if itemRemaining < effectiveAvailable {
			effectiveAvailable = itemRemaining
		}
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
		reservationState.BySourceKey[sourceKey] += allocatedQty
		reservationState.ByItemID[candidate.ItemID] += allocatedQty
		appliedReservations = append(appliedReservations, struct {
			ItemID     int64
			SourceKey  string
			Allocated  int
		}{
			ItemID:    candidate.ItemID,
			SourceKey: sourceKey,
			Allocated: allocatedQty,
		})
		remainingQty -= allocatedQty

		if remainingQty == 0 {
			break
		}
	}
	if remainingQty > 0 {
		for _, applied := range appliedReservations {
			reservationState.BySourceKey[applied.SourceKey] -= applied.Allocated
			reservationState.ByItemID[applied.ItemID] -= applied.Allocated
		}
		return nil, ErrInsufficientStock
	}

	return allocations, nil
}

func (s *Store) resolveOutboundLineAllocationsTx(ctx context.Context, tx *sql.Tx, lockedItem lockedOutboundItem, line CreateOutboundDocumentLineInput, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	if len(line.PickAllocations) == 0 {
		return s.allocateOutboundLineTx(ctx, tx, lockedItem, line.Quantity, reservationState)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
	}

	candidates, itemAvailableByItemID, err := s.loadLockedOutboundAllocationCandidatesTx(ctx, tx, lockedItem)
	if err != nil {
		return nil, err
	}

	candidatesBySourceKey := make(map[string]outboundAllocationCandidate, len(candidates))
	for _, candidate := range candidates {
		candidatesBySourceKey[outboundAllocationLedgerSourceKey(candidate.StorageSection, candidate.ContainerNo)] = candidate
	}

	allocations := make([]outboundAllocationCandidate, 0, len(line.PickAllocations))
	appliedReservations := make([]struct {
		ItemID    int64
		SourceKey string
		Allocated int
	}, 0, len(line.PickAllocations))
	totalAllocatedQty := 0

	for _, requestedAllocation := range line.PickAllocations {
		sourceKey := outboundAllocationLedgerSourceKey(requestedAllocation.StorageSection, requestedAllocation.ContainerNo)
		candidate, exists := candidatesBySourceKey[sourceKey]
		if !exists {
			return nil, fmt.Errorf("%w: selected container allocation is no longer available", ErrInsufficientStock)
		}

		candidateReservationKey := outboundAllocationSourceKey(candidate.ItemID, candidate.StorageSection, candidate.ContainerNo)
		effectiveAvailable := candidate.AvailableQty - reservationState.BySourceKey[candidateReservationKey]
		itemRemaining := itemAvailableByItemID[candidate.ItemID] - reservationState.ByItemID[candidate.ItemID]
		if itemRemaining < effectiveAvailable {
			effectiveAvailable = itemRemaining
		}
		if requestedAllocation.AllocatedQty > effectiveAvailable {
			for _, applied := range appliedReservations {
				reservationState.BySourceKey[applied.SourceKey] -= applied.Allocated
				reservationState.ByItemID[applied.ItemID] -= applied.Allocated
			}
			return nil, ErrInsufficientStock
		}

		candidate.AllocatedQty = requestedAllocation.AllocatedQty
		allocations = append(allocations, candidate)
		reservationState.BySourceKey[candidateReservationKey] += requestedAllocation.AllocatedQty
		reservationState.ByItemID[candidate.ItemID] += requestedAllocation.AllocatedQty
		appliedReservations = append(appliedReservations, struct {
			ItemID    int64
			SourceKey string
			Allocated int
		}{
			ItemID:    candidate.ItemID,
			SourceKey: candidateReservationKey,
			Allocated: requestedAllocation.AllocatedQty,
		})
		totalAllocatedQty += requestedAllocation.AllocatedQty
	}

	if totalAllocatedQty != line.Quantity {
		for _, applied := range appliedReservations {
			reservationState.BySourceKey[applied.SourceKey] -= applied.Allocated
			reservationState.ByItemID[applied.ItemID] -= applied.Allocated
		}
		return nil, fmt.Errorf("%w: manual pick allocations must match the shipment quantity", ErrInvalidInput)
	}

	return allocations, nil
}

func (s *Store) attachOutboundPickAllocations(ctx context.Context, documentIDs []int64, linesByID map[int64]*OutboundDocumentLine) error {
	if len(documentIDs) == 0 || len(linesByID) == 0 {
		return nil
	}

	lineIDs := make([]int64, 0, len(linesByID))
	for lineID := range linesByID {
		lineIDs = append(lineIDs, lineID)
	}

	query, args, err := sqlx.In(`
		SELECT
			a.id,
			a.line_id,
			COALESCE(a.movement_id, 0) AS movement_id,
			a.item_id,
			COALESCE(NULLIF(l.item_number_snapshot, ''), NULLIF(m.item_number, ''), '') AS item_number,
			a.location_id,
			a.location_name_snapshot,
			COALESCE(NULLIF(a.storage_section, ''), NULLIF(m.storage_section, ''), 'A') AS storage_section,
			COALESCE(NULLIF(a.container_no_snapshot, ''), NULLIF(m.container_no, ''), '') AS container_no_snapshot,
			a.allocated_qty,
			a.created_at
		FROM outbound_pick_allocations a
		JOIN outbound_document_lines l ON l.id = a.line_id
		LEFT JOIN stock_movements m ON m.id = a.movement_id
		WHERE line_id IN (?)
		ORDER BY a.line_id ASC, a.sort_order ASC, a.id ASC
	`, lineIDs)
	if err != nil {
		return fmt.Errorf("build outbound pick allocation query: %w", err)
	}

	allocationRows := make([]outboundPickAllocationRow, 0)
	if err := s.db.SelectContext(ctx, &allocationRows, s.db.Rebind(query), args...); err != nil {
		return fmt.Errorf("load outbound pick allocations: %w", err)
	}

	for _, allocationRow := range allocationRows {
		line := linesByID[allocationRow.LineID]
		if line == nil {
			continue
		}

		line.PickAllocations = append(line.PickAllocations, OutboundPickAllocation{
			ID:             allocationRow.ID,
			LineID:         allocationRow.LineID,
			MovementID:     allocationRow.MovementID,
			ItemID:         allocationRow.ItemID,
			ItemNumber:     allocationRow.ItemNumber,
			LocationID:     allocationRow.LocationID,
			LocationName:   allocationRow.LocationName,
			StorageSection: allocationRow.StorageSection,
			ContainerNo:    allocationRow.ContainerNo,
			AllocatedQty:   allocationRow.AllocatedQty,
			CreatedAt:      allocationRow.CreatedAt,
		})
	}

	return nil
}

func (s *Store) deleteOutboundPickAllocationsTx(ctx context.Context, tx *sql.Tx, lineIDs []int64) error {
	if len(lineIDs) == 0 {
		return nil
	}

	query, args, err := sqlx.In(`DELETE FROM outbound_pick_allocations WHERE line_id IN (?)`, lineIDs)
	if err != nil {
		return fmt.Errorf("build outbound pick allocation delete query: %w", err)
	}
	if _, err := tx.ExecContext(ctx, s.db.Rebind(query), args...); err != nil {
		return mapDBError(fmt.Errorf("delete outbound pick allocations: %w", err))
	}
	return nil
}

func (s *Store) loadOutboundPickAllocationsTx(ctx context.Context, tx *sql.Tx, lineIDs []int64) (map[int64][]outboundPickAllocationRow, error) {
	allocationsByLineID := make(map[int64][]outboundPickAllocationRow)
	if len(lineIDs) == 0 {
		return allocationsByLineID, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			a.id,
			a.line_id,
			COALESCE(a.movement_id, 0) AS movement_id,
			a.item_id,
			COALESCE(NULLIF(l.item_number_snapshot, ''), NULLIF(m.item_number, ''), '') AS item_number,
			a.location_id,
			a.location_name_snapshot,
			COALESCE(NULLIF(a.storage_section, ''), NULLIF(m.storage_section, ''), 'A') AS storage_section,
			COALESCE(NULLIF(a.container_no_snapshot, ''), NULLIF(m.container_no, ''), '') AS container_no_snapshot,
			a.allocated_qty,
			a.created_at
		FROM outbound_pick_allocations a
		JOIN outbound_document_lines l ON l.id = a.line_id
		LEFT JOIN stock_movements m ON m.id = a.movement_id
		WHERE line_id IN (?)
		ORDER BY a.line_id ASC, a.sort_order ASC, a.id ASC
	`, lineIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound pick allocation query for tx: %w", err)
	}

	rows, err := tx.QueryContext(ctx, s.db.Rebind(query), args...)
	if err != nil {
		return nil, fmt.Errorf("load outbound pick allocations for tx: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var row outboundPickAllocationRow
		if err := rows.Scan(
			&row.ID,
			&row.LineID,
			&row.MovementID,
			&row.ItemID,
			&row.ItemNumber,
			&row.LocationID,
			&row.LocationName,
			&row.StorageSection,
			&row.ContainerNo,
			&row.AllocatedQty,
			&row.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan outbound pick allocation for tx: %w", err)
		}
		allocationsByLineID[row.LineID] = append(allocationsByLineID[row.LineID], row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound pick allocations for tx: %w", err)
	}

	return allocationsByLineID, nil
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

func toAllocationCandidates(rows []outboundPickAllocationRow) []outboundAllocationCandidate {
	allocations := make([]outboundAllocationCandidate, 0, len(rows))
	for _, row := range rows {
		allocations = append(allocations, outboundAllocationCandidate{
			ItemID:         row.ItemID,
			ItemNumber:     row.ItemNumber,
			LocationID:     row.LocationID,
			LocationName:   row.LocationName,
			StorageSection: row.StorageSection,
			ContainerNo:    row.ContainerNo,
			AllocatedQty:   row.AllocatedQty,
		})
	}
	return allocations
}

func toCreateOutboundLineAllocationInputs(rows []outboundPickAllocationRow) []CreateOutboundLineAllocationInput {
	inputs := make([]CreateOutboundLineAllocationInput, 0, len(rows))
	for _, row := range rows {
		if row.AllocatedQty <= 0 {
			continue
		}
		inputs = append(inputs, CreateOutboundLineAllocationInput{
			StorageSection: fallbackSection(row.StorageSection),
			ContainerNo:    strings.TrimSpace(row.ContainerNo),
			AllocatedQty:   row.AllocatedQty,
		})
	}
	return inputs
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
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)
	lines := make([]CreateOutboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.UnitLabel = strings.TrimSpace(strings.ToUpper(line.UnitLabel))
		line.CartonSizeMM = strings.TrimSpace(line.CartonSizeMM)
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.LineNote = strings.TrimSpace(line.LineNote)
		allocationInputs := make([]CreateOutboundLineAllocationInput, 0, len(line.PickAllocations))
		allocationIndexByKey := make(map[string]int)
		for _, allocation := range line.PickAllocations {
			normalizedSection := strings.ToUpper(fallbackSection(strings.TrimSpace(allocation.StorageSection)))
			normalizedContainer := strings.ToUpper(strings.TrimSpace(allocation.ContainerNo))
			if allocation.AllocatedQty <= 0 {
				continue
			}
			allocationKey := outboundAllocationLedgerSourceKey(normalizedSection, normalizedContainer)
			if existingIndex, exists := allocationIndexByKey[allocationKey]; exists {
				allocationInputs[existingIndex].AllocatedQty += allocation.AllocatedQty
				continue
			}
			allocationIndexByKey[allocationKey] = len(allocationInputs)
			allocationInputs = append(allocationInputs, CreateOutboundLineAllocationInput{
				StorageSection: normalizedSection,
				ContainerNo:    normalizedContainer,
				AllocatedQty:   allocation.AllocatedQty,
			})
		}
		line.PickAllocations = allocationInputs
		if line.ItemID <= 0 || line.Quantity <= 0 {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateOutboundDocumentInput(input CreateOutboundDocumentInput) error {
	if err := validateCreatableDocumentStatus(coalesceDocumentStatus(input.Status)); err != nil {
		return err
	}
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one outbound line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		switch {
		case line.ItemID <= 0:
			return fmt.Errorf("%w: stock row is required", ErrInvalidInput)
		case line.Quantity <= 0:
			return fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
		case line.Pallets < 0:
			return fmt.Errorf("%w: pallets cannot be negative", ErrInvalidInput)
		case line.NetWeightKgs < 0 || line.GrossWeightKgs < 0:
			return fmt.Errorf("%w: weights cannot be negative", ErrInvalidInput)
		}

		if len(line.PickAllocations) > 0 {
			totalAllocatedQty := 0
			for _, allocation := range line.PickAllocations {
				if allocation.AllocatedQty <= 0 {
					return fmt.Errorf("%w: manual pick quantities must be greater than zero", ErrInvalidInput)
				}
				totalAllocatedQty += allocation.AllocatedQty
			}
			if totalAllocatedQty != line.Quantity {
				return fmt.Errorf("%w: manual pick allocations must match the shipment quantity", ErrInvalidInput)
			}
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
