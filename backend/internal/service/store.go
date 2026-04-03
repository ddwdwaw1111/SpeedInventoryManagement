package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

var (
	ErrNotFound          = errors.New("record not found")
	ErrInvalidInput      = errors.New("invalid input")
	ErrInsufficientStock = errors.New("not enough stock available for this movement")
)

var acceptedDateLayouts = []string{
	time.DateOnly,
	"2006/1/2",
	"2006/01/02",
	"1/2/2006",
	"01/02/2006",
	time.RFC3339,
}

const DefaultStorageSection = "TEMP"

func normalizeStorageSection(value string) string {
	trimmed := strings.TrimSpace(strings.ToUpper(value))
	if trimmed == "" {
		return DefaultStorageSection
	}
	return trimmed
}

func ensureStorageSections(sectionNames []string) []string {
	normalized := make([]string, 0, len(sectionNames)+1)
	seen := make(map[string]struct{}, len(sectionNames)+1)

	addSection := func(value string) {
		section := normalizeStorageSection(value)
		if section == "" {
			return
		}
		if _, exists := seen[section]; exists {
			return
		}
		seen[section] = struct{}{}
		normalized = append(normalized, section)
	}

	addSection(DefaultStorageSection)
	for _, sectionName := range sectionNames {
		addSection(sectionName)
	}

	if len(normalized) == 0 {
		return []string{DefaultStorageSection}
	}

	return normalized
}

type Store struct {
	db *sqlx.DB
}

type DashboardData struct {
	TotalItems      int        `json:"totalItems"`
	TotalUnits      int        `json:"totalUnits"`
	LowStockItems   int        `json:"lowStockItems"`
	LocationsInUse  int        `json:"locationsInUse"`
	RecentMovements []Movement `json:"recentMovements"`
}

type Location struct {
	ID           int64                `db:"id" json:"id"`
	Name         string               `db:"name" json:"name"`
	Address      string               `db:"address" json:"address"`
	Description  string               `db:"description" json:"description"`
	Capacity     int                  `db:"capacity" json:"capacity"`
	SectionNames []string             `json:"sectionNames"`
	LayoutBlocks []StorageLayoutBlock `json:"layoutBlocks"`
	CreatedAt    time.Time            `db:"created_at" json:"createdAt"`
}

type StorageLayoutBlock struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type locationRow struct {
	ID               int64     `db:"id"`
	Name             string    `db:"name"`
	Address          string    `db:"address"`
	Description      string    `db:"description"`
	Capacity         int       `db:"capacity"`
	SectionCount     int       `db:"section_count"`
	SectionNamesJSON string    `db:"section_names_json"`
	LayoutJSON       string    `db:"layout_json"`
	CreatedAt        time.Time `db:"created_at"`
}

func (row locationRow) toLocation() Location {
	layoutBlocks := parseLayoutBlocks(row.LayoutJSON, parseSectionNames(row.SectionNamesJSON, row.SectionCount))
	return Location{
		ID:           row.ID,
		Name:         row.Name,
		Address:      row.Address,
		Description:  row.Description,
		Capacity:     row.Capacity,
		SectionNames: parseSectionNames(row.SectionNamesJSON, row.SectionCount),
		LayoutBlocks: layoutBlocks,
		CreatedAt:    row.CreatedAt,
	}
}

type Customer struct {
	ID          int64     `db:"id" json:"id"`
	Name        string    `db:"name" json:"name"`
	ContactName string    `db:"contact_name" json:"contactName"`
	Email       string    `db:"email" json:"email"`
	Phone       string    `db:"phone" json:"phone"`
	Notes       string    `db:"notes" json:"notes"`
	CreatedAt   time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt   time.Time `db:"updated_at" json:"updatedAt"`
}

type CreateLocationInput struct {
	Name         string               `json:"name"`
	Address      string               `json:"address"`
	Description  string               `json:"description"`
	Capacity     int                  `json:"capacity"`
	SectionNames []string             `json:"sectionNames"`
	LayoutBlocks []StorageLayoutBlock `json:"layoutBlocks"`
}

type CreateCustomerInput struct {
	Name        string `json:"name"`
	ContactName string `json:"contactName"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Notes       string `json:"notes"`
}

type SKUMaster struct {
	ID                    int64     `db:"id" json:"id"`
	ItemNumber            string    `db:"item_number" json:"itemNumber"`
	SKU                   string    `db:"sku" json:"sku"`
	Name                  string    `db:"name" json:"name"`
	Category              string    `db:"category" json:"category"`
	Description           string    `db:"description" json:"description"`
	Unit                  string    `db:"unit" json:"unit"`
	ReorderLevel          int       `db:"reorder_level" json:"reorderLevel"`
	DefaultUnitsPerPallet int       `db:"default_units_per_pallet" json:"defaultUnitsPerPallet"`
	CreatedAt             time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt             time.Time `db:"updated_at" json:"updatedAt"`
}

type CreateSKUMasterInput struct {
	ItemNumber            string `json:"itemNumber"`
	SKU                   string `json:"sku"`
	Name                  string `json:"name"`
	Category              string `json:"category"`
	Description           string `json:"description"`
	Unit                  string `json:"unit"`
	ReorderLevel          int    `json:"reorderLevel"`
	DefaultUnitsPerPallet int    `json:"defaultUnitsPerPallet"`
}

type Item struct {
	ID              int64      `json:"id"`
	SKUMasterID     int64      `json:"skuMasterId"`
	ItemNumber      string     `json:"itemNumber"`
	SKU             string     `json:"sku"`
	Name            string     `json:"name"`
	Category        string     `json:"category"`
	Description     string     `json:"description"`
	Unit            string     `json:"unit"`
	Quantity        int        `json:"quantity"`
	AvailableQty    int        `json:"availableQty"`
	AllocatedQty    int        `json:"allocatedQty"`
	DamagedQty      int        `json:"damagedQty"`
	HoldQty         int        `json:"holdQty"`
	ReorderLevel    int        `json:"reorderLevel"`
	CustomerID      int64      `json:"customerId"`
	CustomerName    string     `json:"customerName"`
	LocationID      int64      `json:"locationId"`
	LocationName    string     `json:"locationName"`
	StorageSection  string     `json:"storageSection"`
	DeliveryDate    *time.Time `json:"deliveryDate"`
	ContainerNo     string     `json:"containerNo"`
	LastRestockedAt *time.Time `json:"lastRestockedAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type Movement struct {
	ID                     int64      `json:"id"`
	ItemID                 int64      `json:"itemId"`
	InboundDocumentID      int64      `json:"inboundDocumentId"`
	InboundDocumentLineID  int64      `json:"inboundDocumentLineId"`
	OutboundDocumentID     int64      `json:"outboundDocumentId"`
	OutboundDocumentLineID int64      `json:"outboundDocumentLineId"`
	ItemName               string     `json:"itemName"`
	SKU                    string     `json:"sku"`
	Description            string     `json:"description"`
	CustomerID             int64      `json:"customerId"`
	CustomerName           string     `json:"customerName"`
	LocationName           string     `json:"locationName"`
	StorageSection         string     `json:"storageSection"`
	MovementType           string     `json:"movementType"`
	QuantityChange         int        `json:"quantityChange"`
	DeliveryDate           *time.Time `json:"deliveryDate"`
	ContainerNo            string     `json:"containerNo"`
	PackingListNo          string     `json:"packingListNo"`
	OrderRef               string     `json:"orderRef"`
	ItemNumber             string     `json:"itemNumber"`
	ExpectedQty            int        `json:"expectedQty"`
	ReceivedQty            int        `json:"receivedQty"`
	Pallets                int        `json:"pallets"`
	PalletsDetailCtns      string     `json:"palletsDetailCtns"`
	CartonSizeMM           string     `json:"cartonSizeMm"`
	CartonCount            int        `json:"cartonCount"`
	UnitLabel              string     `json:"unitLabel"`
	NetWeightKgs           float64    `json:"netWeightKgs"`
	GrossWeightKgs         float64    `json:"grossWeightKgs"`
	HeightIn               int        `json:"heightIn"`
	OutDate                *time.Time `json:"outDate"`
	DocumentNote           string     `json:"documentNote"`
	Reason                 string     `json:"reason"`
	ReferenceCode          string     `json:"referenceCode"`
	CreatedAt              time.Time  `json:"createdAt"`
}

type ItemFilters struct {
	Search       string
	LocationID   int64
	CustomerID   int64
	LowStockOnly bool
}

type CreateItemInput struct {
	ItemNumber     string `json:"itemNumber"`
	SKU            string `json:"sku"`
	Name           string `json:"name"`
	Category       string `json:"category"`
	Description    string `json:"description"`
	Unit           string `json:"unit"`
	Quantity       int    `json:"quantity"`
	AllocatedQty   int    `json:"allocatedQty"`
	DamagedQty     int    `json:"damagedQty"`
	HoldQty        int    `json:"holdQty"`
	ReorderLevel   int    `json:"reorderLevel"`
	CustomerID     int64  `json:"customerId"`
	LocationID     int64  `json:"locationId"`
	StorageSection string `json:"storageSection"`
	DeliveryDate   string `json:"deliveryDate"`
	ContainerNo    string `json:"containerNo"`
}

type CreateMovementInput struct {
	ItemID            int64   `json:"itemId"`
	MovementType      string  `json:"movementType"`
	Quantity          int     `json:"quantity"`
	StorageSection    string  `json:"storageSection"`
	DeliveryDate      string  `json:"deliveryDate"`
	ContainerNo       string  `json:"containerNo"`
	PackingListNo     string  `json:"packingListNo"`
	OrderRef          string  `json:"orderRef"`
	ItemNumber        string  `json:"itemNumber"`
	ExpectedQty       int     `json:"expectedQty"`
	ReceivedQty       int     `json:"receivedQty"`
	Pallets           int     `json:"pallets"`
	PalletsDetailCtns string  `json:"palletsDetailCtns"`
	CartonSizeMM      string  `json:"cartonSizeMm"`
	CartonCount       int     `json:"cartonCount"`
	UnitLabel         string  `json:"unitLabel"`
	NetWeightKgs      float64 `json:"netWeightKgs"`
	GrossWeightKgs    float64 `json:"grossWeightKgs"`
	HeightIn          int     `json:"heightIn"`
	OutDate           string  `json:"outDate"`
	DocumentNote      string  `json:"documentNote"`
	Reason            string  `json:"reason"`
	ReferenceCode     string  `json:"referenceCode"`
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

func (s *Store) GetDashboard(ctx context.Context) (DashboardData, error) {
	var dashboard DashboardData

	query := `
		SELECT
			COUNT(*) AS total_items,
			COALESCE(SUM(position_qty), 0) AS total_units,
			COALESCE(SUM(CASE WHEN available_qty <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock_items,
			COUNT(DISTINCT location_id) AS locations_in_use
		FROM (
			SELECT
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id AS location_id,
				p.current_storage_section AS storage_section,
				sm.reorder_level,
				SUM(pi.quantity) AS position_qty,
				GREATEST(
					SUM(pi.quantity) - SUM(pi.allocated_qty) - SUM(pi.damaged_qty) - SUM(pi.hold_qty),
					0
				) AS available_qty
			FROM pallet_items pi
			JOIN pallets p ON p.id = pi.pallet_id
			JOIN sku_master sm ON sm.id = pi.sku_master_id
			WHERE pi.quantity > 0
			  AND p.status <> 'CANCELLED'
			GROUP BY
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id,
				p.current_storage_section,
				sm.reorder_level
		) AS inventory_positions
	`

	if err := s.db.QueryRowContext(ctx, query).Scan(
		&dashboard.TotalItems,
		&dashboard.TotalUnits,
		&dashboard.LowStockItems,
		&dashboard.LocationsInUse,
	); err != nil {
		return DashboardData{}, fmt.Errorf("load dashboard summary: %w", err)
	}

	movements, err := s.ListMovements(ctx, 5)
	if err != nil {
		return DashboardData{}, err
	}

	dashboard.RecentMovements = movements
	return dashboard, nil
}

func (s *Store) ListItems(ctx context.Context, filters ItemFilters) ([]Item, error) {
	query := `
		SELECT
			i.id,
			i.sku_master_id,
			COALESCE(sm.item_number, ''),
			sm.sku,
			sm.name,
			sm.category,
			COALESCE(sm.description, ''),
			sm.unit,
			SUM(pi.quantity) AS quantity,
			GREATEST(
				SUM(pi.quantity) - SUM(pi.allocated_qty) - SUM(pi.damaged_qty) - SUM(pi.hold_qty),
				0
			) AS available_qty,
			SUM(pi.allocated_qty) AS allocated_qty,
			SUM(pi.damaged_qty) AS damaged_qty,
			SUM(pi.hold_qty) AS hold_qty,
			sm.reorder_level,
			p.customer_id,
			c.name,
			p.current_location_id,
			l.name,
			p.current_storage_section,
			i.delivery_date,
			COALESCE(p.current_container_no, i.container_no, '') AS container_no,
			i.last_restocked_at,
			i.created_at,
			GREATEST(i.updated_at, MAX(p.updated_at)) AS updated_at
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		JOIN inventory_items i
			ON i.sku_master_id = pi.sku_master_id
			AND i.customer_id = p.customer_id
			AND i.location_id = p.current_location_id
			AND i.storage_section = p.current_storage_section
			AND COALESCE(i.container_no, '') = COALESCE(p.current_container_no, '')
		JOIN sku_master sm ON sm.id = pi.sku_master_id
		JOIN customers c ON c.id = p.customer_id
		JOIN storage_locations l ON l.id = p.current_location_id
		WHERE pi.quantity > 0
		  AND p.status <> 'CANCELLED'
	`

	args := make([]any, 0)
	if search := strings.TrimSpace(filters.Search); search != "" {
		likeValue := "%" + search + "%"
		query += " AND (sm.item_number LIKE ? OR sm.sku LIKE ? OR sm.name LIKE ? OR sm.description LIKE ? OR sm.category LIKE ? OR c.name LIKE ? OR COALESCE(p.current_container_no, i.container_no, '') LIKE ?)"
		args = append(args, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue)
		args = append(args, likeValue)
	}

	if filters.LocationID > 0 {
		query += " AND p.current_location_id = ?"
		args = append(args, filters.LocationID)
	}

	if filters.CustomerID > 0 {
		query += " AND p.customer_id = ?"
		args = append(args, filters.CustomerID)
	}

	query += `
		GROUP BY
			i.id,
			sm.item_number,
			sm.sku,
			sm.name,
			sm.category,
			sm.description,
			sm.unit,
			sm.reorder_level,
			p.customer_id,
			c.name,
			p.current_location_id,
			l.name,
			p.current_storage_section,
			i.delivery_date,
			p.current_container_no,
			i.last_restocked_at,
			i.created_at,
			i.updated_at
	`
	if filters.LowStockOnly {
		query += " HAVING available_qty <= sm.reorder_level"
	}

	query += " ORDER BY MAX(p.updated_at) DESC, sm.sku ASC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load items: %w", err)
	}
	defer rows.Close()

	items := make([]Item, 0)
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate items: %w", err)
	}

	return items, nil
}

func (s *Store) CreateItem(ctx context.Context, input CreateItemInput) (Item, error) {
	input = sanitizeItemInput(input)
	if err := validateItemInput(input); err != nil {
		return Item{}, err
	}

	deliveryDate, err := parseOptionalDate(input.DeliveryDate)
	if err != nil {
		return Item{}, err
	}

	var lastRestockedAt any
	if input.Quantity > 0 {
		lastRestockedAt = time.Now().UTC()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, fmt.Errorf("begin item create transaction: %w", err)
	}
	defer tx.Rollback()

	skuMasterID, err := s.ensureSKUMaster(ctx, tx, input)
	if err != nil {
		return Item{}, err
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
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		skuMasterID,
		input.CustomerID,
		input.LocationID,
		input.StorageSection,
		nullableTime(deliveryDate),
		input.ContainerNo,
		lastRestockedAt,
	)
	if err != nil {
		return Item{}, mapDBError(fmt.Errorf("create item: %w", err))
	}

	itemID, err := result.LastInsertId()
	if err != nil {
		return Item{}, fmt.Errorf("resolve item id: %w", err)
	}

	if input.Quantity > 0 {
		if err := s.createSeedPalletForInventoryItemTx(ctx, tx, itemID, skuMasterID, input, deliveryDate, input.Quantity, fmt.Sprintf("ITEM-%06d-SEED", itemID), StockLedgerSourceAdjustment, itemID, 0, "Manual inventory seed"); err != nil {
			return Item{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Item{}, fmt.Errorf("commit item create: %w", err)
	}

	return s.getItem(ctx, itemID)
}

func (s *Store) UpdateItem(ctx context.Context, itemID int64, input CreateItemInput) (Item, error) {
	input = sanitizeItemInput(input)
	if err := validateItemInput(input); err != nil {
		return Item{}, err
	}

	deliveryDate, err := parseOptionalDate(input.DeliveryDate)
	if err != nil {
		return Item{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, fmt.Errorf("begin item update transaction: %w", err)
	}
	defer tx.Rollback()

	currentProjection, err := s.loadPalletBackedInventoryProjectionTx(ctx, tx, itemID)
	if err != nil {
		return Item{}, err
	}
	if input.Quantity != currentProjection.Quantity || input.AllocatedQty != currentProjection.AllocatedQty || input.DamagedQty != currentProjection.DamagedQty || input.HoldQty != currentProjection.HoldQty {
		return Item{}, fmt.Errorf("%w: inventory state changes must be made through pallet operations", ErrInvalidInput)
	}

	previousSKUMasterID, err := s.getItemSKUMasterID(ctx, tx, itemID)
	if err != nil {
		return Item{}, err
	}

	skuMasterID, err := s.ensureSKUMaster(ctx, tx, input)
	if err != nil {
		return Item{}, err
	}
	if currentProjection.Quantity > 0 && (previousSKUMasterID != skuMasterID ||
		currentProjection.CustomerID != input.CustomerID ||
		currentProjection.LocationID != input.LocationID ||
		fallbackSection(currentProjection.StorageSection) != fallbackSection(input.StorageSection) ||
		strings.TrimSpace(currentProjection.ContainerNo) != strings.TrimSpace(input.ContainerNo)) {
		return Item{}, fmt.Errorf("%w: move stock through pallet operations instead of editing the bucket registry", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			sku_master_id = ?,
			customer_id = ?,
			location_id = ?,
			storage_section = ?,
			delivery_date = ?,
			container_no = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
		`,
		skuMasterID,
		input.CustomerID,
		input.LocationID,
		input.StorageSection,
		nullableTime(deliveryDate),
		input.ContainerNo,
		itemID,
	)
	if err != nil {
		return Item{}, mapDBError(fmt.Errorf("update item: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return Item{}, fmt.Errorf("resolve updated rows: %w", err)
	}
	if rowsAffected == 0 {
		return Item{}, ErrNotFound
	}

	if previousSKUMasterID != skuMasterID {
		if err := s.deleteUnusedSKUMaster(ctx, tx, previousSKUMasterID); err != nil {
			return Item{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Item{}, fmt.Errorf("commit item update: %w", err)
	}

	return s.getItem(ctx, itemID)
}

func (s *Store) DeleteItem(ctx context.Context, itemID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin item delete transaction: %w", err)
	}
	defer tx.Rollback()

	skuMasterID, err := s.getItemSKUMasterID(ctx, tx, itemID)
	if err != nil {
		return err
	}
	currentProjection, err := s.loadPalletBackedInventoryProjectionTx(ctx, tx, itemID)
	if err != nil {
		return err
	}
	if currentProjection.Quantity > 0 || currentProjection.AllocatedQty > 0 || currentProjection.DamagedQty > 0 || currentProjection.HoldQty > 0 {
		return fmt.Errorf("%w: clear pallet-backed stock before deleting the bucket registry", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `DELETE FROM inventory_items WHERE id = ?`, itemID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete item: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted rows: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	if err := s.deleteUnusedSKUMaster(ctx, tx, skuMasterID); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit item delete: %w", err)
	}

	return nil
}

func (s *Store) ListMovements(ctx context.Context, limit int) ([]Movement, error) {
	if limit <= 0 {
		limit = 10
	}

	return s.listStockLedgerMovements(ctx, limit)
}

func (s *Store) listStockLedgerMovements(ctx context.Context, limit int) ([]Movement, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			MAX(sl.id) AS id,
			COALESCE(MAX(ii.id), 0) AS item_id,
			MAX(CASE WHEN sl.source_document_type = 'INBOUND' THEN sl.source_document_id ELSE 0 END) AS inbound_document_id,
			MAX(CASE WHEN sl.source_document_type = 'INBOUND' THEN sl.source_line_id ELSE 0 END) AS inbound_document_line_id,
			MAX(CASE WHEN sl.source_document_type = 'OUTBOUND' THEN sl.source_document_id ELSE 0 END) AS outbound_document_id,
			MAX(CASE WHEN sl.source_document_type = 'OUTBOUND' THEN sl.source_line_id ELSE 0 END) AS outbound_document_line_id,
			COALESCE(MAX(sm.name), COALESCE(MAX(sl.description_snapshot), '')) AS item_name,
			COALESCE(MAX(sm.sku), '') AS sku,
			COALESCE(
				MAX(NULLIF(sl.description_snapshot, '')),
				MAX(NULLIF(iline.description_snapshot, '')),
				MAX(NULLIF(oline.description_snapshot, '')),
				MAX(NULLIF(adjl.description_snapshot, '')),
				MAX(NULLIF(trl.description_snapshot, '')),
				MAX(NULLIF(ccl.description_snapshot, '')),
				MAX(NULLIF(sm.description, '')),
				MAX(NULLIF(sm.name, '')),
				''
			) AS description,
			sl.customer_id,
			c.name AS customer_name,
			l.name AS location_name,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP') AS storage_section,
			CASE sl.event_type
				WHEN 'RECEIVE' THEN 'IN'
				WHEN 'SHIP' THEN 'OUT'
				ELSE sl.event_type
			END AS movement_type,
			SUM(sl.quantity_change) AS quantity_change,
			MAX(CASE
				WHEN sl.event_type = 'RECEIVE' THEN COALESCE(sl.delivery_date, idoc.delivery_date)
				ELSE NULL
			END) AS delivery_date,
			COALESCE(MAX(NULLIF(sl.container_no_snapshot, '')), MAX(NULLIF(idoc.container_no, '')), '') AS container_no,
			COALESCE(
				MAX(NULLIF(sl.packing_list_no, '')),
				MAX(NULLIF(odoc.packing_list_no, '')),
				''
			) AS packing_list_no,
			COALESCE(
				MAX(NULLIF(sl.order_ref, '')),
				MAX(NULLIF(odoc.order_ref, '')),
				''
			) AS order_ref,
			COALESCE(
				MAX(NULLIF(sl.item_number_snapshot, '')),
				MAX(NULLIF(sm.item_number, '')),
				''
			) AS item_number,
			COALESCE(MAX(sl.expected_qty), MAX(iline.expected_qty), 0) AS expected_qty,
			COALESCE(MAX(sl.received_qty), MAX(iline.received_qty), 0) AS received_qty,
			COALESCE(MAX(sl.pallets), MAX(iline.pallets), MAX(oline.pallets), 0) AS pallets,
			COALESCE(
				MAX(NULLIF(sl.pallets_detail_ctns, '')),
				MAX(NULLIF(iline.pallets_detail_ctns, '')),
				MAX(NULLIF(oline.pallets_detail_ctns, '')),
				''
			) AS pallets_detail_ctns,
			COALESCE(MAX(NULLIF(sl.carton_size_mm, '')), MAX(NULLIF(oline.carton_size_mm, '')), '') AS carton_size_mm,
			COALESCE(MAX(sl.carton_count), 0) AS carton_count,
			COALESCE(
				MAX(NULLIF(sl.unit_label, '')),
				MAX(NULLIF(iline.unit_label, '')),
				MAX(NULLIF(oline.unit_label, '')),
				MAX(NULLIF(sm.unit, '')),
				''
			) AS unit_label,
			COALESCE(MAX(sl.net_weight_kgs), MAX(oline.net_weight_kgs), 0) AS net_weight_kgs,
			COALESCE(MAX(sl.gross_weight_kgs), MAX(oline.gross_weight_kgs), 0) AS gross_weight_kgs,
			COALESCE(MAX(sl.height_in), 0) AS height_in,
			MAX(CASE
				WHEN sl.event_type = 'SHIP' THEN COALESCE(sl.out_date, odoc.out_date)
				WHEN sl.event_type = 'REVERSAL' THEN COALESCE(sl.out_date, odoc.out_date)
				ELSE NULL
			END) AS out_date,
			COALESCE(
				MAX(NULLIF(sl.document_note, '')),
				MAX(NULLIF(idoc.document_note, '')),
				MAX(NULLIF(odoc.document_note, '')),
				MAX(NULLIF(adj.notes, '')),
				MAX(NULLIF(tr.notes, '')),
				MAX(NULLIF(cc.notes, '')),
				''
			) AS document_note,
			COALESCE(
				MAX(NULLIF(sl.reason, '')),
				MAX(NULLIF(adj.reason_code, '')),
				''
			) AS reason,
			COALESCE(MAX(NULLIF(sl.reference_code, '')), '') AS reference_code,
			MAX(sl.created_at) AS created_at
		FROM stock_ledger sl
		JOIN pallets p ON p.id = sl.pallet_id
		LEFT JOIN pallet_items pi ON pi.id = sl.pallet_item_id
		LEFT JOIN sku_master sm ON sm.id = COALESCE(sl.sku_master_id, pi.sku_master_id, p.sku_master_id)
		JOIN customers c ON c.id = sl.customer_id
		JOIN storage_locations l ON l.id = sl.location_id
		LEFT JOIN inbound_documents idoc
			ON sl.source_document_type = 'INBOUND' AND sl.source_document_id = idoc.id
		LEFT JOIN inbound_document_lines iline
			ON sl.source_document_type = 'INBOUND' AND sl.source_line_id = iline.id
		LEFT JOIN outbound_documents odoc
			ON sl.source_document_type = 'OUTBOUND' AND sl.source_document_id = odoc.id
		LEFT JOIN outbound_document_lines oline
			ON sl.source_document_type = 'OUTBOUND' AND sl.source_line_id = oline.id
		LEFT JOIN inventory_adjustments adj
			ON sl.source_document_type = 'ADJUSTMENT' AND sl.source_document_id = adj.id
		LEFT JOIN inventory_adjustment_lines adjl
			ON sl.source_document_type = 'ADJUSTMENT' AND sl.source_line_id = adjl.id
		LEFT JOIN inventory_transfers tr
			ON sl.source_document_type = 'TRANSFER' AND sl.source_document_id = tr.id
		LEFT JOIN inventory_transfer_lines trl
			ON sl.source_document_type = 'TRANSFER' AND sl.source_line_id = trl.id
		LEFT JOIN cycle_counts cc
			ON sl.source_document_type = 'CYCLE_COUNT' AND sl.source_document_id = cc.id
		LEFT JOIN cycle_count_lines ccl
			ON sl.source_document_type = 'CYCLE_COUNT' AND sl.source_line_id = ccl.id
		LEFT JOIN inventory_items ii
			ON ii.sku_master_id = COALESCE(sl.sku_master_id, pi.sku_master_id, p.sku_master_id)
			AND ii.customer_id = sl.customer_id
			AND ii.location_id = sl.location_id
			AND ii.storage_section = COALESCE(NULLIF(sl.storage_section, ''), 'TEMP')
			AND COALESCE(ii.container_no, '') = COALESCE(NULLIF(sl.container_no_snapshot, ''), COALESCE(idoc.container_no, ''), '')
		GROUP BY
			sl.source_document_type,
			COALESCE(sl.source_document_id, 0),
			COALESCE(sl.source_line_id, 0),
			sl.customer_id,
			c.name,
			l.name,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP'),
			CASE sl.event_type
				WHEN 'RECEIVE' THEN 'IN'
				WHEN 'SHIP' THEN 'OUT'
				ELSE sl.event_type
			END,
			COALESCE(NULLIF(sl.container_no_snapshot, ''), COALESCE(idoc.container_no, '')),
			COALESCE(sm.sku, ''),
			COALESCE(NULLIF(sl.item_number_snapshot, ''), COALESCE(sm.item_number, ''))
		ORDER BY COALESCE(MAX(CASE
			WHEN sl.event_type = 'RECEIVE' THEN COALESCE(sl.delivery_date, idoc.delivery_date)
			WHEN sl.event_type = 'SHIP' THEN COALESCE(sl.out_date, odoc.out_date)
			WHEN sl.event_type = 'REVERSAL' THEN COALESCE(sl.out_date, odoc.out_date)
			ELSE NULL
		END), MAX(sl.created_at)) DESC, MAX(sl.id) DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("load stock ledger movements: %w", err)
	}
	defer rows.Close()

	movements := make([]Movement, 0)
	for rows.Next() {
		movement, err := scanMovement(rows)
		if err != nil {
			return nil, err
		}
		movements = append(movements, movement)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stock ledger movements: %w", err)
	}

	return movements, nil
}

func (s *Store) getItem(ctx context.Context, itemID int64) (Item, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			i.id,
			i.sku_master_id,
			COALESCE(sm.item_number, ''),
			sm.sku,
			sm.name,
			sm.category,
			COALESCE(sm.description, ''),
			sm.unit,
			COALESCE(pb.quantity, 0) AS quantity,
			GREATEST(
				COALESCE(pb.quantity, 0) - COALESCE(pb.allocated_qty, 0) - COALESCE(pb.damaged_qty, 0) - COALESCE(pb.hold_qty, 0),
				0
			) AS available_qty,
			COALESCE(pb.allocated_qty, 0) AS allocated_qty,
			COALESCE(pb.damaged_qty, 0) AS damaged_qty,
			COALESCE(pb.hold_qty, 0) AS hold_qty,
			sm.reorder_level,
			i.customer_id,
			c.name,
			i.location_id,
			l.name,
			COALESCE(NULLIF(i.storage_section, ''), 'TEMP'),
			i.delivery_date,
			COALESCE(i.container_no, ''),
			i.last_restocked_at,
			i.created_at,
			GREATEST(i.updated_at, COALESCE(pb.updated_at, i.updated_at)) AS updated_at
		FROM inventory_items i
		JOIN customers c ON c.id = i.customer_id
		JOIN storage_locations l ON l.id = i.location_id
		JOIN sku_master sm ON sm.id = i.sku_master_id
		LEFT JOIN (
			SELECT
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id AS location_id,
				COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP') AS storage_section,
				COALESCE(p.current_container_no, '') AS container_no,
				SUM(pi.quantity) AS quantity,
				SUM(pi.allocated_qty) AS allocated_qty,
				SUM(pi.damaged_qty) AS damaged_qty,
				SUM(pi.hold_qty) AS hold_qty,
				MAX(pi.updated_at) AS updated_at
			FROM pallet_items pi
			JOIN pallets p ON p.id = pi.pallet_id
			WHERE pi.quantity > 0
			  AND p.status <> 'CANCELLED'
			GROUP BY
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id,
				COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP'),
				COALESCE(p.current_container_no, '')
		) pb
			ON pb.sku_master_id = i.sku_master_id
			AND pb.customer_id = i.customer_id
			AND pb.location_id = i.location_id
			AND pb.storage_section = COALESCE(NULLIF(i.storage_section, ''), 'TEMP')
			AND pb.container_no = COALESCE(i.container_no, '')
		WHERE i.id = ?
	`, itemID)

	item, err := scanItem(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Item{}, ErrNotFound
		}
		return Item{}, err
	}

	return item, nil
}

type itemScanner interface {
	Scan(dest ...any) error
}

func scanLocation(scanner itemScanner) (Location, error) {
	var location Location
	var sectionCount int
	var sectionNamesJSON string
	if err := scanner.Scan(
		&location.ID,
		&location.Name,
		&location.Address,
		&location.Description,
		&location.Capacity,
		&sectionCount,
		&sectionNamesJSON,
		&location.CreatedAt,
	); err != nil {
		return Location{}, err
	}

	location.SectionNames = parseSectionNames(sectionNamesJSON, sectionCount)
	return location, nil
}

func scanCustomer(scanner itemScanner) (Customer, error) {
	var customer Customer
	if err := scanner.Scan(
		&customer.ID,
		&customer.Name,
		&customer.ContactName,
		&customer.Email,
		&customer.Phone,
		&customer.Notes,
		&customer.CreatedAt,
		&customer.UpdatedAt,
	); err != nil {
		return Customer{}, err
	}

	return customer, nil
}

func scanSKUMaster(scanner itemScanner) (SKUMaster, error) {
	var skuMaster SKUMaster
	if err := scanner.Scan(
		&skuMaster.ID,
		&skuMaster.ItemNumber,
		&skuMaster.SKU,
		&skuMaster.Name,
		&skuMaster.Category,
		&skuMaster.Description,
		&skuMaster.Unit,
		&skuMaster.ReorderLevel,
		&skuMaster.CreatedAt,
		&skuMaster.UpdatedAt,
	); err != nil {
		return SKUMaster{}, fmt.Errorf("scan sku master: %w", err)
	}

	return skuMaster, nil
}

func scanItem(scanner itemScanner) (Item, error) {
	var item Item
	var deliveryDate sql.NullTime
	var lastRestockedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.SKUMasterID,
		&item.ItemNumber,
		&item.SKU,
		&item.Name,
		&item.Category,
		&item.Description,
		&item.Unit,
		&item.Quantity,
		&item.AvailableQty,
		&item.AllocatedQty,
		&item.DamagedQty,
		&item.HoldQty,
		&item.ReorderLevel,
		&item.CustomerID,
		&item.CustomerName,
		&item.LocationID,
		&item.LocationName,
		&item.StorageSection,
		&deliveryDate,
		&item.ContainerNo,
		&lastRestockedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return Item{}, fmt.Errorf("scan item: %w", err)
	}

	if deliveryDate.Valid {
		item.DeliveryDate = &deliveryDate.Time
	}
	if lastRestockedAt.Valid {
		item.LastRestockedAt = &lastRestockedAt.Time
	}
	item.StorageSection = normalizeStorageSection(item.StorageSection)

	return item, nil
}

func scanMovement(scanner itemScanner) (Movement, error) {
	var movement Movement
	var deliveryDate sql.NullTime
	var outDate sql.NullTime
	if err := scanner.Scan(
		&movement.ID,
		&movement.ItemID,
		&movement.InboundDocumentID,
		&movement.InboundDocumentLineID,
		&movement.OutboundDocumentID,
		&movement.OutboundDocumentLineID,
		&movement.ItemName,
		&movement.SKU,
		&movement.Description,
		&movement.CustomerID,
		&movement.CustomerName,
		&movement.LocationName,
		&movement.StorageSection,
		&movement.MovementType,
		&movement.QuantityChange,
		&deliveryDate,
		&movement.ContainerNo,
		&movement.PackingListNo,
		&movement.OrderRef,
		&movement.ItemNumber,
		&movement.ExpectedQty,
		&movement.ReceivedQty,
		&movement.Pallets,
		&movement.PalletsDetailCtns,
		&movement.CartonSizeMM,
		&movement.CartonCount,
		&movement.UnitLabel,
		&movement.NetWeightKgs,
		&movement.GrossWeightKgs,
		&movement.HeightIn,
		&outDate,
		&movement.DocumentNote,
		&movement.Reason,
		&movement.ReferenceCode,
		&movement.CreatedAt,
	); err != nil {
		return Movement{}, fmt.Errorf("scan movement: %w", err)
	}

	if deliveryDate.Valid {
		movement.DeliveryDate = &deliveryDate.Time
	}
	if outDate.Valid {
		movement.OutDate = &outDate.Time
	}
	movement.StorageSection = normalizeStorageSection(movement.StorageSection)

	return movement, nil
}

func sanitizeItemInput(input CreateItemInput) CreateItemInput {
	input.ItemNumber = strings.TrimSpace(strings.ToUpper(input.ItemNumber))
	input.SKU = strings.TrimSpace(strings.ToUpper(input.SKU))
	input.Name = strings.TrimSpace(input.Name)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	input.Unit = strings.TrimSpace(strings.ToLower(input.Unit))
	input.ContainerNo = strings.TrimSpace(strings.ToUpper(input.ContainerNo))
	input.StorageSection = normalizeStorageSection(input.StorageSection)

	if input.Name == "" {
		input.Name = input.Description
	}
	if input.Category == "" {
		input.Category = "General"
	}
	if input.Unit == "" {
		input.Unit = "pcs"
	}
	return input
}

func validateItemInput(input CreateItemInput) error {
	switch {
	case input.SKU == "":
		return fmt.Errorf("%w: sku is required", ErrInvalidInput)
	case input.Description == "":
		return fmt.Errorf("%w: description is required", ErrInvalidInput)
	case input.Quantity < 0:
		return fmt.Errorf("%w: quantity cannot be negative", ErrInvalidInput)
	case input.AllocatedQty < 0 || input.DamagedQty < 0 || input.HoldQty < 0:
		return fmt.Errorf("%w: inventory status quantities cannot be negative", ErrInvalidInput)
	case input.AllocatedQty+input.DamagedQty+input.HoldQty > input.Quantity:
		return fmt.Errorf("%w: available stock cannot be negative", ErrInvalidInput)
	case input.ReorderLevel < 0:
		return fmt.Errorf("%w: reorder level cannot be negative", ErrInvalidInput)
	case input.CustomerID <= 0:
		return fmt.Errorf("%w: customer is required", ErrInvalidInput)
	case input.LocationID <= 0:
		return fmt.Errorf("%w: location is required", ErrInvalidInput)
	default:
		return nil
	}
}

func sanitizeMovementInput(input CreateMovementInput) CreateMovementInput {
	input.MovementType = strings.TrimSpace(strings.ToUpper(input.MovementType))
	input.ContainerNo = strings.TrimSpace(strings.ToUpper(input.ContainerNo))
	input.PackingListNo = strings.TrimSpace(strings.ToUpper(input.PackingListNo))
	input.OrderRef = strings.TrimSpace(strings.ToUpper(input.OrderRef))
	input.ItemNumber = strings.TrimSpace(strings.ToUpper(input.ItemNumber))
	input.StorageSection = normalizeStorageSection(input.StorageSection)
	input.PalletsDetailCtns = strings.TrimSpace(input.PalletsDetailCtns)
	input.CartonSizeMM = strings.TrimSpace(input.CartonSizeMM)
	input.UnitLabel = strings.TrimSpace(input.UnitLabel)
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)
	input.Reason = strings.TrimSpace(input.Reason)
	input.ReferenceCode = strings.TrimSpace(strings.ToUpper(input.ReferenceCode))
	return input
}

func resolveMovementDelta(movementType string, quantity int) (int, error) {
	switch movementType {
	case "IN":
		if quantity <= 0 {
			return 0, fmt.Errorf("%w: inbound quantity must be greater than zero", ErrInvalidInput)
		}
		return quantity, nil
	case "OUT":
		if quantity <= 0 {
			return 0, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
		}
		return -quantity, nil
	case "ADJUST":
		if quantity == 0 {
			return 0, fmt.Errorf("%w: adjustment quantity cannot be zero", ErrInvalidInput)
		}
		return quantity, nil
	case "REVERSAL":
		if quantity <= 0 {
			return 0, fmt.Errorf("%w: reversal quantity must be greater than zero", ErrInvalidInput)
		}
		return quantity, nil
	case "TRANSFER_IN":
		if quantity <= 0 {
			return 0, fmt.Errorf("%w: transfer-in quantity must be greater than zero", ErrInvalidInput)
		}
		return quantity, nil
	case "TRANSFER_OUT":
		if quantity <= 0 {
			return 0, fmt.Errorf("%w: transfer-out quantity must be greater than zero", ErrInvalidInput)
		}
		return -quantity, nil
	case "COUNT":
		if quantity == 0 {
			return 0, fmt.Errorf("%w: cycle count variance cannot be zero", ErrInvalidInput)
		}
		return quantity, nil
	default:
		return 0, fmt.Errorf("%w: movement type must be IN, OUT, ADJUST, REVERSAL, TRANSFER_IN, TRANSFER_OUT, or COUNT", ErrInvalidInput)
	}
}

func parseOptionalDate(value string) (*time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}

	for _, layout := range acceptedDateLayouts {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			normalized := parsed.UTC()
			return &normalized, nil
		}
	}

	return nil, fmt.Errorf("%w: use YYYY-MM-DD for dates", ErrInvalidInput)
}

func defaultMovementReason(movementType string) string {
	switch movementType {
	case "IN":
		return "Inbound shipment recorded"
	case "OUT":
		return "Outbound shipment recorded"
	case "REVERSAL":
		return "Outbound shipment reversed"
	case "TRANSFER_IN":
		return "Inventory transfer received"
	case "TRANSFER_OUT":
		return "Inventory transfer shipped"
	case "COUNT":
		return "Cycle count variance recorded"
	default:
		return "Inventory adjustment recorded"
	}
}

func computeAvailableQuantity(quantity, allocatedQty, damagedQty, holdQty int) int {
	availableQty := quantity - allocatedQty - damagedQty - holdQty
	if availableQty < 0 {
		return 0
	}
	return availableQty
}

func (s *Store) ensureSKUMaster(ctx context.Context, tx *sql.Tx, input CreateItemInput) (int64, error) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO sku_master (item_number, sku, name, category, description, unit, reorder_level)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			item_number = COALESCE(NULLIF(VALUES(item_number), ''), item_number),
			name = VALUES(name),
			category = VALUES(category),
			description = VALUES(description),
			unit = VALUES(unit),
			reorder_level = VALUES(reorder_level),
			id = LAST_INSERT_ID(id)
	`,
		nullableString(input.ItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.ReorderLevel,
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("upsert sku master: %w", err))
	}

	skuMasterID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve sku master id: %w", err)
	}
	if skuMasterID <= 0 {
		return 0, fmt.Errorf("%w: sku master id is invalid", ErrInvalidInput)
	}

	return skuMasterID, nil
}

func (s *Store) findInventoryItemIDByProjectionTx(ctx context.Context, tx *sql.Tx, skuMasterID int64, customerID int64, locationID int64, storageSection string, containerNo string) (int64, error) {
	var itemID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM inventory_items
		WHERE sku_master_id = ?
		  AND customer_id = ?
		  AND location_id = ?
		  AND COALESCE(NULLIF(storage_section, ''), ?) = ?
		  AND COALESCE(container_no, '') = ?
		FOR UPDATE
	`,
		skuMasterID,
		customerID,
		locationID,
		DefaultStorageSection,
		normalizeStorageSection(storageSection),
		strings.TrimSpace(containerNo),
	).Scan(&itemID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("load inventory item by projection: %w", err)
	}
	return itemID, nil
}

func (s *Store) getItemSKUMasterID(ctx context.Context, tx *sql.Tx, itemID int64) (int64, error) {
	var skuMasterID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT sku_master_id
		FROM inventory_items
		WHERE id = ?
		FOR UPDATE
	`, itemID).Scan(&skuMasterID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("load inventory item sku master id: %w", err)
	}
	return skuMasterID, nil
}

func (s *Store) deleteUnusedSKUMaster(ctx context.Context, tx *sql.Tx, skuMasterID int64) error {
	if skuMasterID <= 0 {
		return nil
	}

	var remainingCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM inventory_items WHERE sku_master_id = ?)
			+
			(SELECT COUNT(*) FROM pallet_items WHERE sku_master_id = ?)
	`, skuMasterID, skuMasterID).Scan(&remainingCount); err != nil {
		return fmt.Errorf("count bucket rows for sku master cleanup: %w", err)
	}
	if remainingCount > 0 {
		return nil
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM sku_master WHERE id = ?`, skuMasterID); err != nil {
		return mapDBError(fmt.Errorf("delete unused sku master: %w", err))
	}

	return nil
}

func (s *Store) createSeedPalletForInventoryItemTx(
	ctx context.Context,
	tx *sql.Tx,
	itemID int64,
	skuMasterID int64,
	input CreateItemInput,
	deliveryDate *time.Time,
	quantity int,
	palletCode string,
	sourceDocumentType string,
	sourceDocumentID int64,
	sourceLineID int64,
	reason string,
) error {
	if itemID <= 0 || skuMasterID <= 0 || quantity <= 0 {
		return nil
	}

	pallet, err := s.createPalletTx(ctx, tx, createPalletInput{
		PalletCode:            strings.TrimSpace(palletCode),
		CustomerID:            input.CustomerID,
		SKUMasterID:           skuMasterID,
		CurrentLocationID:     input.LocationID,
		CurrentStorageSection: input.StorageSection,
		CurrentContainerNo:    input.ContainerNo,
		Status:                PalletStatusOpen,
	})
	if err != nil {
		return err
	}

	palletItemID, err := s.createPalletItemTx(ctx, tx, createPalletItemInput{
		PalletID:     pallet.ID,
		SKUMasterID:  skuMasterID,
		Quantity:     quantity,
		AllocatedQty: input.AllocatedQty,
		DamagedQty:   input.DamagedQty,
		HoldQty:      input.HoldQty,
	})
	if err != nil {
		return err
	}

	if err := s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventReceive,
		PalletID:            pallet.ID,
		PalletItemID:        palletItemID,
		SKUMasterID:         skuMasterID,
		CustomerID:          input.CustomerID,
		LocationID:          input.LocationID,
		StorageSection:      input.StorageSection,
		QuantityChange:      quantity,
		SourceDocumentType:  sourceDocumentType,
		SourceDocumentID:    sourceDocumentID,
		SourceLineID:        sourceLineID,
		ContainerNo:         input.ContainerNo,
		DeliveryDate:        deliveryDate,
		ItemNumber:          input.ItemNumber,
		DescriptionSnapshot: input.Description,
		ExpectedQty:         quantity,
		ReceivedQty:         quantity,
		Pallets:             1,
		UnitLabel:           strings.ToUpper(firstNonEmpty(input.Unit, "PCS")),
		Reason:              reason,
	}); err != nil {
		return err
	}

	return nil
}

func mapMovementTypeToStockLedgerEvent(movementType string) string {
	switch movementType {
	case "IN":
		return StockLedgerEventReceive
	case "OUT":
		return StockLedgerEventShip
	case "REVERSAL":
		return StockLedgerEventReversal
	case "TRANSFER_OUT":
		return StockLedgerEventTransferOut
	case "TRANSFER_IN":
		return StockLedgerEventTransferIn
	case "COUNT":
		return StockLedgerEventCount
	default:
		return StockLedgerEventAdjust
	}
}

func signedQuantityForDelta(delta int, quantity int) int {
	if quantity < 0 {
		return quantity
	}
	if delta < 0 {
		return -quantity
	}
	return quantity
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return *value
}

func mapDBError(err error) error {
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		switch mysqlErr.Number {
		case 1062:
			return fmt.Errorf("%w: duplicate value violates a unique field", ErrInvalidInput)
		case 1451, 1452:
			return fmt.Errorf("%w: record is linked to another table", ErrInvalidInput)
		}
	}

	return err
}
