package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

const (
	PalletStatusOpen      = "OPEN"
	PalletStatusPartial   = "PARTIAL"
	PalletStatusShipped   = "SHIPPED"
	PalletStatusCancelled = "CANCELLED"
)

type palletRecord struct {
	ID                      int64      `db:"id"`
	ParentPalletID          int64      `db:"parent_pallet_id"`
	PalletCode              string     `db:"pallet_code"`
	ContainerVisitID        int64      `db:"container_visit_id"`
	SourceInboundDocumentID int64      `db:"source_inbound_document_id"`
	SourceInboundLineID     int64      `db:"source_inbound_line_id"`
	ActualArrivalDate       *time.Time `db:"actual_arrival_date"`
	CustomerID              int64      `db:"customer_id"`
	SKUMasterID             int64      `db:"sku_master_id"`
	CurrentLocationID       int64      `db:"current_location_id"`
	CurrentStorageSection   string     `db:"current_storage_section"`
	CurrentContainerNo      string     `db:"current_container_no"`
	Status                  string     `db:"status"`
	CreatedAt               time.Time  `db:"created_at"`
	UpdatedAt               time.Time  `db:"updated_at"`
}

type createPalletInput struct {
	ParentPalletID          int64
	PalletCode              string
	ContainerVisitID        int64
	SourceInboundDocumentID int64
	SourceInboundLineID     int64
	ActualArrivalDate       *time.Time
	CustomerID              int64
	SKUMasterID             int64
	CurrentLocationID       int64
	CurrentStorageSection   string
	CurrentContainerNo      string
	Status                  string
}

type createPalletItemInput struct {
	PalletID     int64
	SKUMasterID  int64
	Quantity     int
	AllocatedQty int
	DamagedQty   int
	HoldQty      int
}

type PalletContentView struct {
	ID           int64     `json:"id"`
	PalletID     int64     `json:"palletId"`
	SKUMasterID  int64     `json:"skuMasterId"`
	ItemNumber   string    `json:"itemNumber"`
	SKU          string    `json:"sku"`
	Description  string    `json:"description"`
	Quantity     int       `json:"quantity"`
	AllocatedQty int       `json:"allocatedQty"`
	DamagedQty   int       `json:"damagedQty"`
	HoldQty      int       `json:"holdQty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type PalletTrace struct {
	ID                      int64               `json:"id"`
	ParentPalletID          int64               `json:"parentPalletId"`
	PalletCode              string              `json:"palletCode"`
	ContainerVisitID        int64               `json:"containerVisitId"`
	SourceInboundDocumentID int64               `json:"sourceInboundDocumentId"`
	SourceInboundLineID     int64               `json:"sourceInboundLineId"`
	ActualArrivalDate       *time.Time          `json:"actualArrivalDate"`
	ContainerType           string              `json:"containerType"`
	CustomerID              int64               `json:"customerId"`
	CustomerName            string              `json:"customerName"`
	SKUMasterID             int64               `json:"skuMasterId"`
	SKU                     string              `json:"sku"`
	Description             string              `json:"description"`
	CurrentLocationID       int64               `json:"currentLocationId"`
	CurrentLocationName     string              `json:"currentLocationName"`
	CurrentStorageSection   string              `json:"currentStorageSection"`
	CurrentContainerNo      string              `json:"currentContainerNo"`
	Status                  string              `json:"status"`
	CreatedAt               time.Time           `json:"createdAt"`
	UpdatedAt               time.Time           `json:"updatedAt"`
	Contents                []PalletContentView `json:"contents"`
}

type palletTraceRow struct {
	ID                      int64      `db:"id"`
	ParentPalletID          int64      `db:"parent_pallet_id"`
	PalletCode              string     `db:"pallet_code"`
	ContainerVisitID        int64      `db:"container_visit_id"`
	SourceInboundDocumentID int64      `db:"source_inbound_document_id"`
	SourceInboundLineID     int64      `db:"source_inbound_line_id"`
	ActualArrivalDate       *time.Time `db:"actual_arrival_date"`
	ContainerType           string     `db:"container_type"`
	CustomerID              int64      `db:"customer_id"`
	CustomerName            string     `db:"customer_name"`
	SKUMasterID             int64      `db:"sku_master_id"`
	SKU                     string     `db:"sku"`
	Description             string     `db:"description"`
	CurrentLocationID       int64      `db:"current_location_id"`
	CurrentLocationName     string     `db:"current_location_name"`
	CurrentStorageSection   string     `db:"current_storage_section"`
	CurrentContainerNo      string     `db:"current_container_no"`
	Status                  string     `db:"status"`
	CreatedAt               time.Time  `db:"created_at"`
	UpdatedAt               time.Time  `db:"updated_at"`
}

type palletContentRow struct {
	ID           int64     `db:"id"`
	PalletID     int64     `db:"pallet_id"`
	SKUMasterID  int64     `db:"sku_master_id"`
	ItemNumber   string    `db:"item_number"`
	SKU          string    `db:"sku"`
	Description  string    `db:"description"`
	Quantity     int       `db:"quantity"`
	AllocatedQty int       `db:"allocated_qty"`
	DamagedQty   int       `db:"damaged_qty"`
	HoldQty      int       `db:"hold_qty"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}

type ListPalletFilters struct {
	Search                  string
	SourceInboundDocumentID int64
}

func splitQuantityEvenly(total int, bucketCount int) []int {
	result := make([]int, bucketCount)
	if bucketCount <= 0 || total <= 0 {
		return result
	}

	base := total / bucketCount
	remainder := total % bucketCount
	for index := 0; index < bucketCount; index++ {
		result[index] = base
		if index < remainder {
			result[index]++
		}
	}
	return result
}

func inboundPalletBreakdownQuantities(totalQty int, palletBreakdown []InboundPalletBreakdown, palletCount int, unitsPerPallet int) []int {
	if len(palletBreakdown) > 0 {
		quantities := make([]int, 0, len(palletBreakdown))
		total := 0
		for _, breakdown := range palletBreakdown {
			if breakdown.Quantity <= 0 {
				continue
			}
			quantities = append(quantities, breakdown.Quantity)
			total += breakdown.Quantity
		}
		if len(quantities) > 0 && total == totalQty {
			return quantities
		}
	}
	if unitsPerPallet > 0 {
		quantities := make([]int, 0)
		remaining := totalQty
		for remaining > 0 {
			if remaining > unitsPerPallet {
				quantities = append(quantities, unitsPerPallet)
				remaining -= unitsPerPallet
				continue
			}
			quantities = append(quantities, remaining)
			remaining = 0
		}
		if len(quantities) > 0 {
			return quantities
		}
	}
	if palletCount <= 0 {
		palletCount = 1
	}
	return splitQuantityEvenly(totalQty, palletCount)
}

func palletCodeForInboundLine(inboundLineID int64, sequence int) string {
	return fmt.Sprintf("PLT-IN-%06d-%03d", inboundLineID, sequence)
}

func palletCodeForTransferSplit(parentPalletID int64, transferLineID int64, sequence int) string {
	return fmt.Sprintf("PLT-%06d-T%06d-%03d", parentPalletID, transferLineID, sequence)
}

func (s *Store) createPalletTx(ctx context.Context, tx *sql.Tx, input createPalletInput) (palletRecord, error) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO pallets (
			parent_pallet_id,
			pallet_code,
			container_visit_id,
			source_inbound_document_id,
			source_inbound_line_id,
			actual_arrival_date,
			customer_id,
			sku_master_id,
			current_location_id,
			current_storage_section,
			current_container_no,
			status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		nullableInt64(input.ParentPalletID),
		strings.TrimSpace(input.PalletCode),
		nullableInt64(input.ContainerVisitID),
		nullableInt64(input.SourceInboundDocumentID),
		nullableInt64(input.SourceInboundLineID),
		nullableTime(input.ActualArrivalDate),
		input.CustomerID,
		input.SKUMasterID,
		input.CurrentLocationID,
		fallbackSection(input.CurrentStorageSection),
		strings.TrimSpace(input.CurrentContainerNo),
		firstNonEmpty(strings.TrimSpace(input.Status), PalletStatusOpen),
	)
	if err != nil {
		return palletRecord{}, mapDBError(fmt.Errorf("create pallet: %w", err))
	}

	palletID, err := result.LastInsertId()
	if err != nil {
		return palletRecord{}, fmt.Errorf("resolve pallet id: %w", err)
	}

	return palletRecord{
		ID:                      palletID,
		ParentPalletID:          input.ParentPalletID,
		PalletCode:              strings.TrimSpace(input.PalletCode),
		ContainerVisitID:        input.ContainerVisitID,
		SourceInboundDocumentID: input.SourceInboundDocumentID,
		SourceInboundLineID:     input.SourceInboundLineID,
		ActualArrivalDate:       input.ActualArrivalDate,
		CustomerID:              input.CustomerID,
		SKUMasterID:             input.SKUMasterID,
		CurrentLocationID:       input.CurrentLocationID,
		CurrentStorageSection:   fallbackSection(input.CurrentStorageSection),
		CurrentContainerNo:      strings.TrimSpace(input.CurrentContainerNo),
		Status:                  firstNonEmpty(strings.TrimSpace(input.Status), PalletStatusOpen),
	}, nil
}

func (s *Store) createPalletItemTx(ctx context.Context, tx *sql.Tx, input createPalletItemInput) (int64, error) {
	palletItemID, err := s.syncPalletItemStateTx(ctx, tx, input)
	if err != nil {
		return 0, err
	}
	return palletItemID, nil
}

func (s *Store) createPalletsForInboundLineTx(
	ctx context.Context,
	tx *sql.Tx,
	sourceInboundDocumentID int64,
	sourceInboundLineID int64,
	containerVisitID int64,
	skuMasterID int64,
	originalQty int,
	customerID int64,
	locationID int64,
	storageSection string,
	containerNo string,
	actualArrivalDate *time.Time,
	palletBreakdown []InboundPalletBreakdown,
	unitsPerPallet int,
	palletCount int,
) ([]createdPalletEntity, error) {
	if sourceInboundLineID <= 0 || skuMasterID <= 0 || originalQty <= 0 {
		return []createdPalletEntity{}, nil
	}

	existingSequenceCount := 0
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM pallets
		WHERE source_inbound_line_id = ?
	`, sourceInboundLineID).Scan(&existingSequenceCount); err != nil {
		return nil, fmt.Errorf("count inbound-line pallets: %w", err)
	}

	quantities := inboundPalletBreakdownQuantities(originalQty, palletBreakdown, palletCount, unitsPerPallet)
	pallets := make([]createdPalletEntity, 0, len(quantities))
	for index := 0; index < len(quantities); index++ {
		pallet, err := s.createPalletTx(ctx, tx, createPalletInput{
			PalletCode:              palletCodeForInboundLine(sourceInboundLineID, existingSequenceCount+index+1),
			ContainerVisitID:        containerVisitID,
			SourceInboundDocumentID: sourceInboundDocumentID,
			SourceInboundLineID:     sourceInboundLineID,
			ActualArrivalDate:       actualArrivalDate,
			CustomerID:              customerID,
			SKUMasterID:             skuMasterID,
			CurrentLocationID:       locationID,
			CurrentStorageSection:   storageSection,
			CurrentContainerNo:      containerNo,
			Status:                  PalletStatusOpen,
		})
		if err != nil {
			return nil, err
		}
		palletItemID, err := s.createPalletItemTx(ctx, tx, createPalletItemInput{
			PalletID:    pallet.ID,
			SKUMasterID: skuMasterID,
			Quantity:    quantities[index],
		})
		if err != nil {
			return nil, err
		}
		pallets = append(pallets, createdPalletEntity{
			Pallet:       pallet,
			PalletItemID: palletItemID,
			Quantity:     quantities[index],
		})
	}
	return pallets, nil
}

func (s *Store) ListPallets(ctx context.Context, limit int, filters ListPalletFilters) ([]PalletTrace, error) {
	if limit <= 0 {
		limit = 500
	}

	normalizedSearch := strings.TrimSpace(strings.ToLower(filters.Search))
	searchPattern := "%" + normalizedSearch + "%"
	searchClause := ""
	searchArgs := make([]any, 0)
	if normalizedSearch != "" {
		searchClause = `
			AND (
				LOWER(COALESCE(p.pallet_code, '')) LIKE ?
				OR LOWER(COALESCE(p.current_container_no, '')) LIKE ?
				OR LOWER(COALESCE(c.name, '')) LIKE ?
				OR LOWER(COALESCE(sm.sku, '')) LIKE ?
				OR CAST(p.source_inbound_document_id AS CHAR) LIKE ?
				OR CAST(p.source_inbound_line_id AS CHAR) LIKE ?
			)
		`
		for range 6 {
			searchArgs = append(searchArgs, searchPattern)
		}
	}
	sourceClause := ""
	if filters.SourceInboundDocumentID > 0 {
		sourceClause = `
			AND p.source_inbound_document_id = ?
		`
		searchArgs = append(searchArgs, filters.SourceInboundDocumentID)
	}

	query := fmt.Sprintf(`
		SELECT
			p.id,
			COALESCE(p.parent_pallet_id, 0) AS parent_pallet_id,
			COALESCE(p.pallet_code, '') AS pallet_code,
			COALESCE(p.container_visit_id, 0) AS container_visit_id,
			p.source_inbound_document_id,
			p.source_inbound_line_id,
			p.actual_arrival_date,
			COALESCE(d.container_type, cv.container_type, 'NORMAL') AS container_type,
			p.customer_id,
			COALESCE(c.name, '') AS customer_name,
			p.sku_master_id,
			COALESCE(sm.sku, '') AS sku,
			COALESCE(sm.description, sm.name, '') AS description,
			p.current_location_id,
			COALESCE(l.name, '') AS current_location_name,
			COALESCE(p.current_storage_section, 'TEMP') AS current_storage_section,
			COALESCE(p.current_container_no, '') AS current_container_no,
			COALESCE(p.status, '') AS status,
			p.created_at,
			p.updated_at
		FROM pallets p
		LEFT JOIN container_visits cv ON cv.id = p.container_visit_id
		LEFT JOIN inbound_documents d ON d.id = COALESCE(p.source_inbound_document_id, cv.inbound_document_id)
		LEFT JOIN customers c ON c.id = p.customer_id
		LEFT JOIN sku_master sm ON sm.id = p.sku_master_id
		LEFT JOIN storage_locations l ON l.id = p.current_location_id
		WHERE 1 = 1
		%s
		%s
		ORDER BY p.updated_at DESC, p.id DESC
		LIMIT ?
	`, searchClause, sourceClause)

	args := append(searchArgs, limit)
	rows := make([]palletTraceRow, 0)
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("load pallets: %w", err)
	}
	if len(rows) == 0 {
		return []PalletTrace{}, nil
	}

	pallets := make([]PalletTrace, 0, len(rows))
	palletIndexByID := make(map[int64]int, len(rows))
	palletIDs := make([]int64, 0, len(rows))
	for index, row := range rows {
		palletIndexByID[row.ID] = index
		palletIDs = append(palletIDs, row.ID)
		pallets = append(pallets, PalletTrace{
			ID:                      row.ID,
			ParentPalletID:          row.ParentPalletID,
			PalletCode:              row.PalletCode,
			ContainerVisitID:        row.ContainerVisitID,
			SourceInboundDocumentID: row.SourceInboundDocumentID,
			SourceInboundLineID:     row.SourceInboundLineID,
			ActualArrivalDate:       row.ActualArrivalDate,
			ContainerType:           coalesceContainerType(row.ContainerType),
			CustomerID:              row.CustomerID,
			CustomerName:            row.CustomerName,
			SKUMasterID:             row.SKUMasterID,
			SKU:                     row.SKU,
			Description:             row.Description,
			CurrentLocationID:       row.CurrentLocationID,
			CurrentLocationName:     row.CurrentLocationName,
			CurrentStorageSection:   fallbackSection(row.CurrentStorageSection),
			CurrentContainerNo:      row.CurrentContainerNo,
			Status:                  firstNonEmpty(strings.TrimSpace(row.Status), PalletStatusOpen),
			CreatedAt:               row.CreatedAt,
			UpdatedAt:               row.UpdatedAt,
			Contents:                make([]PalletContentView, 0),
		})
	}

	contentQuery, contentArgs, err := sqlx.In(`
		SELECT
			pi.id,
			pi.pallet_id,
			pi.sku_master_id,
			COALESCE(sm.item_number, '') AS item_number,
			COALESCE(sm.sku, '') AS sku,
			COALESCE(sm.description, sm.name, '') AS description,
			pi.quantity,
			pi.allocated_qty,
			pi.damaged_qty,
			pi.hold_qty,
			pi.created_at,
			pi.updated_at
		FROM pallet_items pi
		LEFT JOIN sku_master sm ON sm.id = pi.sku_master_id
		WHERE pi.pallet_id IN (?)
		ORDER BY pi.pallet_id ASC, pi.id ASC
	`, palletIDs)
	if err != nil {
		return nil, fmt.Errorf("build pallet content query: %w", err)
	}

	contentRows := make([]palletContentRow, 0)
	if err := s.db.SelectContext(ctx, &contentRows, s.db.Rebind(contentQuery), contentArgs...); err != nil {
		return nil, fmt.Errorf("load pallet contents: %w", err)
	}

	for _, row := range contentRows {
		palletIndex, ok := palletIndexByID[row.PalletID]
		if !ok {
			continue
		}
		pallets[palletIndex].Contents = append(pallets[palletIndex].Contents, PalletContentView{
			ID:           row.ID,
			PalletID:     row.PalletID,
			SKUMasterID:  row.SKUMasterID,
			ItemNumber:   row.ItemNumber,
			SKU:          row.SKU,
			Description:  row.Description,
			Quantity:     row.Quantity,
			AllocatedQty: row.AllocatedQty,
			DamagedQty:   row.DamagedQty,
			HoldQty:      row.HoldQty,
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
		})
	}

	return pallets, nil
}
