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
	ID           int64              `db:"id" json:"id"`
	Name         string             `db:"name" json:"name"`
	Address      string             `db:"address" json:"address"`
	Description  string             `db:"description" json:"description"`
	Capacity     int                `db:"capacity" json:"capacity"`
	SectionNames []string           `json:"sectionNames"`
	LayoutBlocks []StorageLayoutBlock `json:"layoutBlocks"`
	CreatedAt    time.Time          `db:"created_at" json:"createdAt"`
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
	Name         string   `json:"name"`
	Address      string   `json:"address"`
	Description  string   `json:"description"`
	Capacity     int      `json:"capacity"`
	SectionNames []string `json:"sectionNames"`
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
	ID                int64      `json:"id"`
	ItemNumber        string     `json:"itemNumber"`
	SKU               string     `json:"sku"`
	Name              string     `json:"name"`
	Category          string     `json:"category"`
	Description       string     `json:"description"`
	Unit              string     `json:"unit"`
	Quantity          int        `json:"quantity"`
	AvailableQty      int        `json:"availableQty"`
	AllocatedQty      int        `json:"allocatedQty"`
	DamagedQty        int        `json:"damagedQty"`
	HoldQty           int        `json:"holdQty"`
	ReorderLevel      int        `json:"reorderLevel"`
	CustomerID        int64      `json:"customerId"`
	CustomerName      string     `json:"customerName"`
	LocationID        int64      `json:"locationId"`
	LocationName      string     `json:"locationName"`
	StorageSection    string     `json:"storageSection"`
	DeliveryDate      *time.Time `json:"deliveryDate"`
	ContainerNo       string     `json:"containerNo"`
	ExpectedQty       int        `json:"expectedQty"`
	ReceivedQty       int        `json:"receivedQty"`
	HeightIn          int        `json:"heightIn"`
	OutDate           *time.Time `json:"outDate"`
	LastRestockedAt   *time.Time `json:"lastRestockedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type Movement struct {
	ID                int64      `json:"id"`
	ItemID            int64      `json:"itemId"`
	InboundDocumentID int64      `json:"inboundDocumentId"`
	InboundDocumentLineID int64  `json:"inboundDocumentLineId"`
	OutboundDocumentID int64     `json:"outboundDocumentId"`
	OutboundDocumentLineID int64 `json:"outboundDocumentLineId"`
	ItemName          string     `json:"itemName"`
	SKU               string     `json:"sku"`
	Description       string     `json:"description"`
	CustomerID        int64      `json:"customerId"`
	CustomerName      string     `json:"customerName"`
	LocationName      string     `json:"locationName"`
	StorageSection    string     `json:"storageSection"`
	MovementType      string     `json:"movementType"`
	QuantityChange    int        `json:"quantityChange"`
	DeliveryDate      *time.Time `json:"deliveryDate"`
	ContainerNo       string     `json:"containerNo"`
	PackingListNo     string     `json:"packingListNo"`
	OrderRef          string     `json:"orderRef"`
	ItemNumber        string     `json:"itemNumber"`
	ExpectedQty       int        `json:"expectedQty"`
	ReceivedQty       int        `json:"receivedQty"`
	Pallets           int        `json:"pallets"`
	PalletsDetailCtns string     `json:"palletsDetailCtns"`
	CartonSizeMM      string     `json:"cartonSizeMm"`
	CartonCount       int        `json:"cartonCount"`
	UnitLabel         string     `json:"unitLabel"`
	NetWeightKgs      float64    `json:"netWeightKgs"`
	GrossWeightKgs    float64    `json:"grossWeightKgs"`
	HeightIn          int        `json:"heightIn"`
	OutDate           *time.Time `json:"outDate"`
	DocumentNote      string     `json:"documentNote"`
	Reason            string     `json:"reason"`
	ReferenceCode     string     `json:"referenceCode"`
	CreatedAt         time.Time  `json:"createdAt"`
}

type ItemFilters struct {
	Search       string
	LocationID   int64
	CustomerID   int64
	LowStockOnly bool
}

type CreateItemInput struct {
	ItemNumber        string `json:"itemNumber"`
	SKU               string `json:"sku"`
	Name              string `json:"name"`
	Category          string `json:"category"`
	Description       string `json:"description"`
	Unit              string `json:"unit"`
	Quantity          int    `json:"quantity"`
	AllocatedQty      int    `json:"allocatedQty"`
	DamagedQty        int    `json:"damagedQty"`
	HoldQty           int    `json:"holdQty"`
	ReorderLevel      int    `json:"reorderLevel"`
	CustomerID        int64  `json:"customerId"`
	LocationID        int64  `json:"locationId"`
	StorageSection    string `json:"storageSection"`
	DeliveryDate      string `json:"deliveryDate"`
	ContainerNo       string `json:"containerNo"`
	ExpectedQty       int    `json:"expectedQty"`
	ReceivedQty       int    `json:"receivedQty"`
	HeightIn          int    `json:"heightIn"`
	OutDate           string `json:"outDate"`
}

type CreateMovementInput struct {
	ItemID            int64  `json:"itemId"`
	MovementType      string `json:"movementType"`
	Quantity          int    `json:"quantity"`
	StorageSection    string `json:"storageSection"`
	DeliveryDate      string `json:"deliveryDate"`
	ContainerNo       string `json:"containerNo"`
	PackingListNo     string `json:"packingListNo"`
	OrderRef          string `json:"orderRef"`
	ItemNumber        string `json:"itemNumber"`
	ExpectedQty       int    `json:"expectedQty"`
	ReceivedQty       int    `json:"receivedQty"`
	Pallets           int    `json:"pallets"`
	PalletsDetailCtns string `json:"palletsDetailCtns"`
	CartonSizeMM      string `json:"cartonSizeMm"`
	CartonCount       int    `json:"cartonCount"`
	UnitLabel         string `json:"unitLabel"`
	NetWeightKgs      float64 `json:"netWeightKgs"`
	GrossWeightKgs    float64 `json:"grossWeightKgs"`
	HeightIn          int    `json:"heightIn"`
	OutDate           string `json:"outDate"`
	DocumentNote      string `json:"documentNote"`
	Reason            string `json:"reason"`
	ReferenceCode     string `json:"referenceCode"`
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

func (s *Store) GetDashboard(ctx context.Context) (DashboardData, error) {
	var dashboard DashboardData

	query := `
		SELECT
			COUNT(*) AS total_items,
			COALESCE(SUM(quantity), 0) AS total_units,
			COALESCE(SUM(CASE WHEN GREATEST(quantity - allocated_qty - damaged_qty - hold_qty, 0) <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock_items,
			COUNT(DISTINCT location_id) AS locations_in_use
		FROM inventory_items
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
			COALESCE(i.item_number, ''),
			i.sku,
			i.name,
			i.category,
			COALESCE(i.description, ''),
			i.unit,
			i.quantity,
			GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) AS available_qty,
			i.allocated_qty,
			i.damaged_qty,
			i.hold_qty,
			i.reorder_level,
			i.customer_id,
			c.name,
			i.location_id,
			l.name,
			i.storage_section,
			i.delivery_date,
			COALESCE(i.container_no, ''),
			i.expected_qty,
			i.received_qty,
			i.height_in,
			i.out_date,
			i.last_restocked_at,
			i.created_at,
			i.updated_at
		FROM inventory_items i
		JOIN customers c ON c.id = i.customer_id
		JOIN storage_locations l ON l.id = i.location_id
		WHERE 1 = 1
	`

	args := make([]any, 0)
	if search := strings.TrimSpace(filters.Search); search != "" {
		likeValue := "%" + search + "%"
		query += " AND (i.item_number LIKE ? OR i.sku LIKE ? OR i.name LIKE ? OR i.description LIKE ? OR i.category LIKE ? OR c.name LIKE ?)"
		args = append(args, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue)
	}

	if filters.LocationID > 0 {
		query += " AND i.location_id = ?"
		args = append(args, filters.LocationID)
	}

	if filters.CustomerID > 0 {
		query += " AND i.customer_id = ?"
		args = append(args, filters.CustomerID)
	}

	if filters.LowStockOnly {
		query += " AND GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) <= i.reorder_level"
	}

	query += " ORDER BY i.updated_at DESC, i.sku ASC"

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

	outDate, err := parseOptionalDate(input.OutDate)
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
			item_number,
			sku,
			name,
			category,
			description,
			unit,
			quantity,
			allocated_qty,
			damaged_qty,
			hold_qty,
			reorder_level,
			location_id,
			storage_section,
			delivery_date,
			container_no,
			expected_qty,
			received_qty,
			height_in,
			out_date,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		skuMasterID,
		input.CustomerID,
		nullableString(input.ItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.Quantity,
		input.AllocatedQty,
		input.DamagedQty,
		input.HoldQty,
		input.ReorderLevel,
		input.LocationID,
		input.StorageSection,
		nullableTime(deliveryDate),
		input.ContainerNo,
		input.ExpectedQty,
		input.ReceivedQty,
		input.HeightIn,
		nullableTime(outDate),
		lastRestockedAt,
	)
	if err != nil {
		return Item{}, mapDBError(fmt.Errorf("create item: %w", err))
	}

	itemID, err := result.LastInsertId()
	if err != nil {
		return Item{}, fmt.Errorf("resolve item id: %w", err)
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

	outDate, err := parseOptionalDate(input.OutDate)
	if err != nil {
		return Item{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, fmt.Errorf("begin item update transaction: %w", err)
	}
	defer tx.Rollback()

	previousSKUMasterID, err := s.getItemSKUMasterID(ctx, tx, itemID)
	if err != nil {
		return Item{}, err
	}

	skuMasterID, err := s.ensureSKUMaster(ctx, tx, input)
	if err != nil {
		return Item{}, err
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			sku_master_id = ?,
			customer_id = ?,
			item_number = ?,
			sku = ?,
			name = ?,
			category = ?,
			description = ?,
			unit = ?,
			quantity = ?,
			allocated_qty = ?,
			damaged_qty = ?,
			hold_qty = ?,
			reorder_level = ?,
			location_id = ?,
			storage_section = ?,
			delivery_date = ?,
			container_no = ?,
			expected_qty = ?,
			received_qty = ?,
			height_in = ?,
			out_date = ?,
			last_restocked_at = CASE
				WHEN ? > quantity THEN CURRENT_TIMESTAMP
				ELSE last_restocked_at
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
		`,
		skuMasterID,
		input.CustomerID,
		nullableString(input.ItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.Quantity,
		input.AllocatedQty,
		input.DamagedQty,
		input.HoldQty,
		input.ReorderLevel,
		input.LocationID,
		input.StorageSection,
		nullableTime(deliveryDate),
		input.ContainerNo,
		input.ExpectedQty,
		input.ReceivedQty,
		input.HeightIn,
		nullableTime(outDate),
		input.Quantity,
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

	if _, err := tx.ExecContext(ctx, `DELETE FROM stock_movements WHERE item_id = ?`, itemID); err != nil {
		return mapDBError(fmt.Errorf("delete linked movements for item: %w", err))
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

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			m.id,
			m.item_id,
			COALESCE(m.inbound_document_id, 0),
			COALESCE(m.inbound_document_line_id, 0),
			COALESCE(m.outbound_document_id, 0),
			COALESCE(m.outbound_document_line_id, 0),
			i.name,
			i.sku,
			COALESCE(m.description_snapshot, i.description, i.name, ''),
			m.customer_id,
			c.name,
			l.name,
			m.storage_section,
			m.movement_type,
			m.quantity_change,
			m.delivery_date,
			COALESCE(m.container_no, ''),
			COALESCE(m.packing_list_no, ''),
			COALESCE(m.order_ref, ''),
			COALESCE(m.item_number, ''),
			m.expected_qty,
			m.received_qty,
			m.pallets,
			COALESCE(m.pallets_detail_ctns, ''),
			COALESCE(m.carton_size_mm, ''),
			m.carton_count,
			COALESCE(m.unit_label, ''),
			m.net_weight_kgs,
			m.gross_weight_kgs,
			m.height_in,
			m.out_date,
			COALESCE(m.document_note, ''),
			COALESCE(m.reason, ''),
			COALESCE(m.reference_code, ''),
			m.created_at
		FROM stock_movements m
		JOIN inventory_items i ON i.id = m.item_id
		JOIN customers c ON c.id = m.customer_id
		JOIN storage_locations l ON l.id = m.location_id
		ORDER BY COALESCE(m.delivery_date, m.out_date, m.created_at) DESC, m.id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("load movements: %w", err)
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
		return nil, fmt.Errorf("iterate movements: %w", err)
	}

	return movements, nil
}

func (s *Store) CreateMovement(ctx context.Context, input CreateMovementInput) (Movement, error) {
	input = sanitizeMovementInput(input)

	delta, err := resolveMovementDelta(input.MovementType, input.Quantity)
	if err != nil {
		return Movement{}, err
	}

	if input.ItemID <= 0 {
		return Movement{}, fmt.Errorf("%w: item is required", ErrInvalidInput)
	}
	if input.ExpectedQty < 0 || input.ReceivedQty < 0 || input.Pallets < 0 || input.HeightIn < 0 || input.CartonCount < 0 || input.NetWeightKgs < 0 || input.GrossWeightKgs < 0 {
		return Movement{}, fmt.Errorf("%w: quantities, weights, and height cannot be negative", ErrInvalidInput)
	}

	deliveryDate, err := parseOptionalDate(input.DeliveryDate)
	if err != nil {
		return Movement{}, err
	}

	outDate, err := parseOptionalDate(input.OutDate)
	if err != nil {
		return Movement{}, err
	}

	if input.MovementType == "IN" && deliveryDate == nil {
		now := time.Now().UTC()
		deliveryDate = &now
	}
	if input.MovementType == "OUT" && outDate == nil {
		now := time.Now().UTC()
		outDate = &now
	}
	if input.MovementType == "IN" && input.ReceivedQty == 0 {
		input.ReceivedQty = input.Quantity
	}
	if input.MovementType == "IN" && input.ExpectedQty == 0 {
		input.ExpectedQty = input.ReceivedQty
	}
	if input.Reason == "" {
		input.Reason = defaultMovementReason(input.MovementType)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Movement{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var currentQuantity int
	var customerID int64
	var locationID int64
	var storageSection string
	var descriptionSnapshot string
	if currentQuantity, customerID, locationID, storageSection, descriptionSnapshot, err = s.loadLockedItemForMovement(ctx, tx, input.ItemID); err != nil {
		return Movement{}, err
	}
	if input.StorageSection == "" {
		input.StorageSection = storageSection
	}

	updatedQuantity := currentQuantity + delta
	if updatedQuantity < 0 {
		return Movement{}, ErrInsufficientStock
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO stock_movements (
			item_id,
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
			reason,
			reference_code
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		input.ItemID,
		customerID,
		locationID,
		input.StorageSection,
		input.MovementType,
		delta,
		nullableTime(deliveryDate),
		nullableString(input.ContainerNo),
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		nullableString(input.ItemNumber),
		nullableString(descriptionSnapshot),
		input.ExpectedQty,
		input.ReceivedQty,
		input.Pallets,
		nullableString(input.PalletsDetailCtns),
		nullableString(input.CartonSizeMM),
		input.CartonCount,
		nullableString(input.UnitLabel),
		input.NetWeightKgs,
		input.GrossWeightKgs,
		input.HeightIn,
		nullableTime(outDate),
		nullableString(input.DocumentNote),
		nullableString(input.Reason),
		nullableString(input.ReferenceCode),
	)
	if err != nil {
		return Movement{}, mapDBError(fmt.Errorf("create movement: %w", err))
	}

	movementID, err := result.LastInsertId()
	if err != nil {
		return Movement{}, fmt.Errorf("resolve movement id: %w", err)
	}

	if err := s.applyMovementToInventoryItem(ctx, tx, input.ItemID, updatedQuantity, delta, input, deliveryDate, outDate); err != nil {
		return Movement{}, mapDBError(fmt.Errorf("update inventory after movement: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return Movement{}, fmt.Errorf("commit movement: %w", err)
	}

	return s.getMovement(ctx, movementID)
}

func (s *Store) UpdateMovement(ctx context.Context, movementID int64, input CreateMovementInput) (Movement, error) {
	input = sanitizeMovementInput(input)

	delta, err := resolveMovementDelta(input.MovementType, input.Quantity)
	if err != nil {
		return Movement{}, err
	}
	if input.ItemID <= 0 {
		return Movement{}, fmt.Errorf("%w: item is required", ErrInvalidInput)
	}
	if input.ExpectedQty < 0 || input.ReceivedQty < 0 || input.Pallets < 0 || input.HeightIn < 0 || input.CartonCount < 0 || input.NetWeightKgs < 0 || input.GrossWeightKgs < 0 {
		return Movement{}, fmt.Errorf("%w: quantities, weights, and height cannot be negative", ErrInvalidInput)
	}

	deliveryDate, err := parseOptionalDate(input.DeliveryDate)
	if err != nil {
		return Movement{}, err
	}
	outDate, err := parseOptionalDate(input.OutDate)
	if err != nil {
		return Movement{}, err
	}
	if input.MovementType == "IN" && deliveryDate == nil {
		now := time.Now().UTC()
		deliveryDate = &now
	}
	if input.MovementType == "OUT" && outDate == nil {
		now := time.Now().UTC()
		outDate = &now
	}
	if input.MovementType == "IN" && input.ReceivedQty == 0 {
		input.ReceivedQty = input.Quantity
	}
	if input.MovementType == "IN" && input.ExpectedQty == 0 {
		input.ExpectedQty = input.ReceivedQty
	}
	if input.Reason == "" {
		input.Reason = defaultMovementReason(input.MovementType)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Movement{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var previousItemID int64
	var previousDelta int
	var previousStorageSection string
	var inboundDocumentID int64
	var outboundDocumentID int64
	var adjustmentID int64
	var transferID int64
	var cycleCountID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT
			item_id,
			quantity_change,
			storage_section,
			COALESCE(inbound_document_id, 0),
			COALESCE(outbound_document_id, 0),
			COALESCE(adjustment_id, 0),
			COALESCE(transfer_id, 0),
			COALESCE(cycle_count_id, 0)
		FROM stock_movements
		WHERE id = ?
		FOR UPDATE
	`, movementID).Scan(
		&previousItemID,
		&previousDelta,
		&previousStorageSection,
		&inboundDocumentID,
		&outboundDocumentID,
		&adjustmentID,
		&transferID,
		&cycleCountID,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Movement{}, ErrNotFound
		}
		return Movement{}, fmt.Errorf("load movement for update: %w", err)
	}
	if inboundDocumentID > 0 || outboundDocumentID > 0 || adjustmentID > 0 || transferID > 0 || cycleCountID > 0 {
		return Movement{}, fmt.Errorf("%w: posted document lines must be edited from their document", ErrInvalidInput)
	}
	if input.StorageSection == "" {
		input.StorageSection = previousStorageSection
	}

	previousQuantity, _, _, _, _, err := s.loadLockedItemForMovement(ctx, tx, previousItemID)
	if err != nil {
		return Movement{}, err
	}
	restoredPreviousQuantity := previousQuantity - previousDelta
	if restoredPreviousQuantity < 0 {
		return Movement{}, ErrInsufficientStock
	}

	if previousItemID == input.ItemID {
		_, customerID, locationID, itemStorageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, input.ItemID)
		if err != nil {
			return Movement{}, err
		}
		if input.StorageSection == "" {
			input.StorageSection = itemStorageSection
		}
		updatedQuantity := restoredPreviousQuantity + delta
		if updatedQuantity < 0 {
			return Movement{}, ErrInsufficientStock
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE stock_movements
			SET
				customer_id = ?,
				location_id = ?,
				storage_section = ?,
				movement_type = ?,
				quantity_change = ?,
				delivery_date = ?,
				container_no = ?,
				packing_list_no = ?,
				order_ref = ?,
				item_number = ?,
				description_snapshot = ?,
				expected_qty = ?,
				received_qty = ?,
				pallets = ?,
				pallets_detail_ctns = ?,
				carton_size_mm = ?,
				carton_count = ?,
				unit_label = ?,
				net_weight_kgs = ?,
				gross_weight_kgs = ?,
				height_in = ?,
				out_date = ?,
				document_note = ?,
				reason = ?,
				reference_code = ?
			WHERE id = ?
		`,
			customerID,
			locationID,
			input.StorageSection,
			input.MovementType,
			delta,
			nullableTime(deliveryDate),
			nullableString(input.ContainerNo),
			nullableString(input.PackingListNo),
			nullableString(input.OrderRef),
			nullableString(input.ItemNumber),
			nullableString(descriptionSnapshot),
			input.ExpectedQty,
			input.ReceivedQty,
			input.Pallets,
			nullableString(input.PalletsDetailCtns),
			nullableString(input.CartonSizeMM),
			input.CartonCount,
			nullableString(input.UnitLabel),
			input.NetWeightKgs,
			input.GrossWeightKgs,
			input.HeightIn,
			nullableTime(outDate),
			nullableString(input.DocumentNote),
			nullableString(input.Reason),
			nullableString(input.ReferenceCode),
			movementID,
		); err != nil {
			return Movement{}, mapDBError(fmt.Errorf("update movement: %w", err))
		}

		if err := s.applyMovementToInventoryItem(ctx, tx, input.ItemID, updatedQuantity, delta, input, deliveryDate, outDate); err != nil {
			return Movement{}, mapDBError(fmt.Errorf("update inventory after movement edit: %w", err))
		}
	} else {
		newQuantity, newCustomerID, newLocationID, newStorageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, input.ItemID)
		if err != nil {
			return Movement{}, err
		}
		if input.StorageSection == "" {
			input.StorageSection = newStorageSection
		}
		updatedNewQuantity := newQuantity + delta
		if updatedNewQuantity < 0 {
			return Movement{}, ErrInsufficientStock
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET quantity = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, restoredPreviousQuantity, previousItemID); err != nil {
			return Movement{}, mapDBError(fmt.Errorf("restore previous inventory after movement edit: %w", err))
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE stock_movements
			SET
				item_id = ?,
				customer_id = ?,
				location_id = ?,
				storage_section = ?,
				movement_type = ?,
				quantity_change = ?,
				delivery_date = ?,
				container_no = ?,
				packing_list_no = ?,
				order_ref = ?,
				item_number = ?,
				description_snapshot = ?,
				expected_qty = ?,
				received_qty = ?,
				pallets = ?,
				pallets_detail_ctns = ?,
				carton_size_mm = ?,
				carton_count = ?,
				unit_label = ?,
				net_weight_kgs = ?,
				gross_weight_kgs = ?,
				height_in = ?,
				out_date = ?,
				document_note = ?,
				reason = ?,
				reference_code = ?
			WHERE id = ?
		`,
			input.ItemID,
			newCustomerID,
			newLocationID,
			input.StorageSection,
			input.MovementType,
			delta,
			nullableTime(deliveryDate),
			nullableString(input.ContainerNo),
			nullableString(input.PackingListNo),
			nullableString(input.OrderRef),
			nullableString(input.ItemNumber),
			nullableString(descriptionSnapshot),
			input.ExpectedQty,
			input.ReceivedQty,
			input.Pallets,
			nullableString(input.PalletsDetailCtns),
			nullableString(input.CartonSizeMM),
			input.CartonCount,
			nullableString(input.UnitLabel),
			input.NetWeightKgs,
			input.GrossWeightKgs,
			input.HeightIn,
			nullableTime(outDate),
			nullableString(input.DocumentNote),
			nullableString(input.Reason),
			nullableString(input.ReferenceCode),
			movementID,
		); err != nil {
			return Movement{}, mapDBError(fmt.Errorf("update movement item: %w", err))
		}

		if err := s.applyMovementToInventoryItem(ctx, tx, input.ItemID, updatedNewQuantity, delta, input, deliveryDate, outDate); err != nil {
			return Movement{}, mapDBError(fmt.Errorf("apply movement to new inventory item: %w", err))
		}
	}

	if err := tx.Commit(); err != nil {
		return Movement{}, fmt.Errorf("commit movement update: %w", err)
	}

	return s.getMovement(ctx, movementID)
}

func (s *Store) DeleteMovement(ctx context.Context, movementID int64, restoreStock bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var itemID int64
	var quantityChange int
	var movementType string
	var inboundDocumentID int64
	var outboundDocumentID int64
	var adjustmentID int64
	var transferID int64
	var cycleCountID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT
			item_id,
			quantity_change,
			movement_type,
			COALESCE(inbound_document_id, 0),
			COALESCE(outbound_document_id, 0),
			COALESCE(adjustment_id, 0),
			COALESCE(transfer_id, 0),
			COALESCE(cycle_count_id, 0)
		FROM stock_movements
		WHERE id = ?
		FOR UPDATE
	`, movementID).Scan(&itemID, &quantityChange, &movementType, &inboundDocumentID, &outboundDocumentID, &adjustmentID, &transferID, &cycleCountID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("load movement for delete: %w", err)
	}
	if inboundDocumentID > 0 || outboundDocumentID > 0 || adjustmentID > 0 || transferID > 0 || cycleCountID > 0 {
		return fmt.Errorf("%w: posted document lines must be cancelled from their document", ErrInvalidInput)
	}

	if !restoreStock && strings.EqualFold(movementType, "OUT") {
		if _, err := tx.ExecContext(ctx, `DELETE FROM stock_movements WHERE id = ?`, movementID); err != nil {
			return mapDBError(fmt.Errorf("delete outbound movement without stock restore: %w", err))
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit movement delete without stock restore: %w", err)
		}

		return nil
	}

	currentQuantity, _, _, _, _, err := s.loadLockedItemForMovement(ctx, tx, itemID)
	if err != nil {
		return err
	}
	restoredQuantity := currentQuantity - quantityChange
	if restoredQuantity < 0 {
		return ErrInsufficientStock
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM stock_movements WHERE id = ?`, movementID); err != nil {
		return mapDBError(fmt.Errorf("delete movement: %w", err))
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET quantity = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, restoredQuantity, itemID); err != nil {
		return mapDBError(fmt.Errorf("restore inventory after movement delete: %w", err))
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit movement delete: %w", err)
	}

	return nil
}

func (s *Store) getItem(ctx context.Context, itemID int64) (Item, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			i.id,
			COALESCE(i.item_number, ''),
			i.sku,
			i.name,
			i.category,
			COALESCE(i.description, ''),
			i.unit,
			i.quantity,
			GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) AS available_qty,
			i.allocated_qty,
			i.damaged_qty,
			i.hold_qty,
			i.reorder_level,
			i.customer_id,
			c.name,
			i.location_id,
			l.name,
			i.storage_section,
			i.delivery_date,
			COALESCE(i.container_no, ''),
			i.expected_qty,
			i.received_qty,
			i.height_in,
			i.out_date,
			i.last_restocked_at,
			i.created_at,
			i.updated_at
		FROM inventory_items i
		JOIN customers c ON c.id = i.customer_id
		JOIN storage_locations l ON l.id = i.location_id
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

func (s *Store) getMovement(ctx context.Context, movementID int64) (Movement, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			m.id,
			m.item_id,
			COALESCE(m.inbound_document_id, 0),
			COALESCE(m.inbound_document_line_id, 0),
			COALESCE(m.outbound_document_id, 0),
			COALESCE(m.outbound_document_line_id, 0),
			i.name,
			i.sku,
			COALESCE(m.description_snapshot, i.description, i.name, ''),
			m.customer_id,
			c.name,
			l.name,
			m.storage_section,
			m.movement_type,
			m.quantity_change,
			m.delivery_date,
			COALESCE(m.container_no, ''),
			COALESCE(m.packing_list_no, ''),
			COALESCE(m.order_ref, ''),
			COALESCE(m.item_number, ''),
			m.expected_qty,
			m.received_qty,
			m.pallets,
			COALESCE(m.pallets_detail_ctns, ''),
			COALESCE(m.carton_size_mm, ''),
			m.carton_count,
			COALESCE(m.unit_label, ''),
			m.net_weight_kgs,
			m.gross_weight_kgs,
			m.height_in,
			m.out_date,
			COALESCE(m.document_note, ''),
			COALESCE(m.reason, ''),
			COALESCE(m.reference_code, ''),
			m.created_at
		FROM stock_movements m
		JOIN inventory_items i ON i.id = m.item_id
		JOIN customers c ON c.id = m.customer_id
		JOIN storage_locations l ON l.id = m.location_id
		WHERE m.id = ?
	`, movementID)

	movement, err := scanMovement(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Movement{}, ErrNotFound
		}
		return Movement{}, err
	}

	return movement, nil
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
	var outDate sql.NullTime
	var lastRestockedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
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
		&item.ExpectedQty,
		&item.ReceivedQty,
		&item.HeightIn,
		&outDate,
		&lastRestockedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return Item{}, fmt.Errorf("scan item: %w", err)
	}

	if deliveryDate.Valid {
		item.DeliveryDate = &deliveryDate.Time
	}
	if outDate.Valid {
		item.OutDate = &outDate.Time
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
	case input.ExpectedQty < 0 || input.ReceivedQty < 0 || input.HeightIn < 0:
		return fmt.Errorf("%w: spreadsheet quantities and height cannot be negative", ErrInvalidInput)
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

func (s *Store) loadLockedItemForMovement(ctx context.Context, tx *sql.Tx, itemID int64) (int, int64, int64, string, string, error) {
	var quantity int
	var customerID int64
	var locationID int64
	var storageSection string
	var descriptionSnapshot string
	if err := tx.QueryRowContext(ctx, `
		SELECT quantity, customer_id, location_id, storage_section, COALESCE(description, name, '')
		FROM inventory_items
		WHERE id = ?
		FOR UPDATE
	`, itemID).Scan(&quantity, &customerID, &locationID, &storageSection, &descriptionSnapshot); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, 0, 0, "", "", ErrNotFound
		}
		return 0, 0, 0, "", "", fmt.Errorf("load item for movement: %w", err)
	}
	storageSection = normalizeStorageSection(storageSection)

	return quantity, customerID, locationID, storageSection, descriptionSnapshot, nil
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
		SELECT COUNT(*)
		FROM inventory_items
		WHERE sku_master_id = ?
	`, skuMasterID).Scan(&remainingCount); err != nil {
		return fmt.Errorf("count inventory rows for sku master cleanup: %w", err)
	}
	if remainingCount > 0 {
		return nil
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM sku_master WHERE id = ?`, skuMasterID); err != nil {
		return mapDBError(fmt.Errorf("delete unused sku master: %w", err))
	}

	return nil
}

func (s *Store) applyMovementToInventoryItem(ctx context.Context, tx *sql.Tx, itemID int64, updatedQuantity int, delta int, input CreateMovementInput, deliveryDate *time.Time, outDate *time.Time) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			quantity = ?,
			storage_section = CASE
				WHEN ? <> '' THEN ?
				ELSE storage_section
			END,
			delivery_date = COALESCE(?, delivery_date),
			container_no = CASE
				WHEN ? <> '' THEN ?
				ELSE container_no
			END,
			expected_qty = CASE
				WHEN ? <> 0 THEN ?
				ELSE expected_qty
			END,
			received_qty = CASE
				WHEN ? <> 0 THEN ?
				ELSE received_qty
			END,
			height_in = CASE
				WHEN ? <> 0 THEN ?
				ELSE height_in
			END,
			out_date = COALESCE(?, out_date),
			last_restocked_at = CASE
				WHEN ? > 0 THEN CURRENT_TIMESTAMP
				ELSE last_restocked_at
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		updatedQuantity,
		normalizeStorageSection(input.StorageSection),
		normalizeStorageSection(input.StorageSection),
		nullableTime(deliveryDate),
		input.ContainerNo,
		input.ContainerNo,
		input.ExpectedQty,
		input.ExpectedQty,
		input.ReceivedQty,
		input.ReceivedQty,
		input.HeightIn,
		input.HeightIn,
		nullableTime(outDate),
		delta,
		itemID,
	)
	return err
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

