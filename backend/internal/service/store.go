package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
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

type Store struct {
	db *sql.DB
}

type DashboardData struct {
	TotalItems      int        `json:"totalItems"`
	TotalUnits      int        `json:"totalUnits"`
	LowStockItems   int        `json:"lowStockItems"`
	LocationsInUse  int        `json:"locationsInUse"`
	RecentMovements []Movement `json:"recentMovements"`
}

type Location struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Address      string    `json:"address"`
	Zone         string    `json:"zone"`
	Description  string    `json:"description"`
	Capacity     int       `json:"capacity"`
	SectionNames []string  `json:"sectionNames"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CreateLocationInput struct {
	Name         string   `json:"name"`
	Address      string   `json:"address"`
	Zone         string   `json:"zone"`
	Description  string   `json:"description"`
	Capacity     int      `json:"capacity"`
	SectionNames []string `json:"sectionNames"`
}

type SKUMaster struct {
	ID           int64     `json:"id"`
	SKU          string    `json:"sku"`
	Name         string    `json:"name"`
	Category     string    `json:"category"`
	Description  string    `json:"description"`
	Unit         string    `json:"unit"`
	ReorderLevel int       `json:"reorderLevel"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type CreateSKUMasterInput struct {
	SKU          string `json:"sku"`
	Name         string `json:"name"`
	Category     string `json:"category"`
	Description  string `json:"description"`
	Unit         string `json:"unit"`
	ReorderLevel int    `json:"reorderLevel"`
}

type Item struct {
	ID                int64      `json:"id"`
	SKU               string     `json:"sku"`
	Name              string     `json:"name"`
	Category          string     `json:"category"`
	Description       string     `json:"description"`
	Unit              string     `json:"unit"`
	Quantity          int        `json:"quantity"`
	ReorderLevel      int        `json:"reorderLevel"`
	LocationID        int64      `json:"locationId"`
	LocationName      string     `json:"locationName"`
	StorageSection    string     `json:"storageSection"`
	DeliveryDate      *time.Time `json:"deliveryDate"`
	ContainerNo       string     `json:"containerNo"`
	ExpectedQty       int        `json:"expectedQty"`
	ReceivedQty       int        `json:"receivedQty"`
	Pallets           int        `json:"pallets"`
	PalletsDetailCtns string     `json:"palletsDetailCtns"`
	HeightIn          int        `json:"heightIn"`
	OutDate           *time.Time `json:"outDate"`
	LastRestockedAt   *time.Time `json:"lastRestockedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type Movement struct {
	ID                int64      `json:"id"`
	ItemID            int64      `json:"itemId"`
	ItemName          string     `json:"itemName"`
	SKU               string     `json:"sku"`
	Description       string     `json:"description"`
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
	Reason            string     `json:"reason"`
	ReferenceCode     string     `json:"referenceCode"`
	CreatedAt         time.Time  `json:"createdAt"`
}

type ItemFilters struct {
	Search       string
	LocationID   int64
	LowStockOnly bool
}

type CreateItemInput struct {
	SKU               string `json:"sku"`
	Name              string `json:"name"`
	Category          string `json:"category"`
	Description       string `json:"description"`
	Unit              string `json:"unit"`
	Quantity          int    `json:"quantity"`
	ReorderLevel      int    `json:"reorderLevel"`
	LocationID        int64  `json:"locationId"`
	StorageSection    string `json:"storageSection"`
	DeliveryDate      string `json:"deliveryDate"`
	ContainerNo       string `json:"containerNo"`
	ExpectedQty       int    `json:"expectedQty"`
	ReceivedQty       int    `json:"receivedQty"`
	Pallets           int    `json:"pallets"`
	PalletsDetailCtns string `json:"palletsDetailCtns"`
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
	Reason            string `json:"reason"`
	ReferenceCode     string `json:"referenceCode"`
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) GetDashboard(ctx context.Context) (DashboardData, error) {
	var dashboard DashboardData

	query := `
		SELECT
			COUNT(*) AS total_items,
			COALESCE(SUM(quantity), 0) AS total_units,
			COALESCE(SUM(CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock_items,
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

func (s *Store) ListLocations(ctx context.Context) ([]Location, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(address, ''), zone, COALESCE(description, ''), capacity, section_count, COALESCE(section_names_json, ''), created_at
		FROM storage_locations
		ORDER BY zone ASC, name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("load locations: %w", err)
	}
	defer rows.Close()

	locations := make([]Location, 0)
	for rows.Next() {
		location, err := scanLocation(rows)
		if err != nil {
			return nil, fmt.Errorf("scan location: %w", err)
		}
		locations = append(locations, location)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate locations: %w", err)
	}

	return locations, nil
}

func (s *Store) CreateLocation(ctx context.Context, input CreateLocationInput) (Location, error) {
	input = sanitizeLocationInput(input)
	if err := validateLocationInput(input); err != nil {
		return Location{}, err
	}
	sectionNamesJSON, err := marshalSectionNames(input.SectionNames)
	if err != nil {
		return Location{}, fmt.Errorf("marshal location section names: %w", err)
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO storage_locations (name, address, zone, description, capacity, section_count, section_names_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		input.Name,
		nullableString(input.Address),
		input.Zone,
		nullableString(input.Description),
		input.Capacity,
		len(input.SectionNames),
		sectionNamesJSON,
	)
	if err != nil {
		return Location{}, mapDBError(fmt.Errorf("create location: %w", err))
	}

	locationID, err := result.LastInsertId()
	if err != nil {
		return Location{}, fmt.Errorf("resolve location id: %w", err)
	}

	return s.getLocation(ctx, locationID)
}

func (s *Store) UpdateLocation(ctx context.Context, locationID int64, input CreateLocationInput) (Location, error) {
	input = sanitizeLocationInput(input)
	if err := validateLocationInput(input); err != nil {
		return Location{}, err
	}
	sectionNamesJSON, err := marshalSectionNames(input.SectionNames)
	if err != nil {
		return Location{}, fmt.Errorf("marshal location section names: %w", err)
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE storage_locations
		SET
			name = ?,
			address = ?,
			zone = ?,
			description = ?,
			capacity = ?,
			section_count = ?,
			section_names_json = ?
		WHERE id = ?
	`,
		input.Name,
		nullableString(input.Address),
		input.Zone,
		nullableString(input.Description),
		input.Capacity,
		len(input.SectionNames),
		sectionNamesJSON,
		locationID,
	)
	if err != nil {
		return Location{}, mapDBError(fmt.Errorf("update location: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return Location{}, fmt.Errorf("resolve updated location rows: %w", err)
	}
	if rowsAffected == 0 {
		return Location{}, ErrNotFound
	}

	return s.getLocation(ctx, locationID)
}

func (s *Store) DeleteLocation(ctx context.Context, locationID int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM storage_locations WHERE id = ?`, locationID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete location: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted location rows: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	return nil
}

func (s *Store) ListSKUMasters(ctx context.Context, search string) ([]SKUMaster, error) {
	query := `
		SELECT id, sku, name, category, COALESCE(description, ''), unit, reorder_level, created_at, updated_at
		FROM sku_master
		WHERE 1 = 1
	`

	args := make([]any, 0)
	if trimmedSearch := strings.TrimSpace(search); trimmedSearch != "" {
		likeValue := "%" + trimmedSearch + "%"
		query += " AND (sku LIKE ? OR name LIKE ? OR description LIKE ? OR category LIKE ?)"
		args = append(args, likeValue, likeValue, likeValue, likeValue)
	}

	query += " ORDER BY updated_at DESC, sku ASC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load sku masters: %w", err)
	}
	defer rows.Close()

	masters := make([]SKUMaster, 0)
	for rows.Next() {
		master, err := scanSKUMaster(rows)
		if err != nil {
			return nil, err
		}
		masters = append(masters, master)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sku masters: %w", err)
	}

	return masters, nil
}

func (s *Store) CreateSKUMaster(ctx context.Context, input CreateSKUMasterInput) (SKUMaster, error) {
	input = sanitizeSKUMasterInput(input)
	if err := validateSKUMasterInput(input); err != nil {
		return SKUMaster{}, err
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO sku_master (sku, name, category, description, unit, reorder_level)
		VALUES (?, ?, ?, ?, ?, ?)
	`,
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.ReorderLevel,
	)
	if err != nil {
		return SKUMaster{}, mapDBError(fmt.Errorf("create sku master: %w", err))
	}

	skuMasterID, err := result.LastInsertId()
	if err != nil {
		return SKUMaster{}, fmt.Errorf("resolve sku master id: %w", err)
	}

	return s.getSKUMaster(ctx, skuMasterID)
}

func (s *Store) UpdateSKUMaster(ctx context.Context, skuMasterID int64, input CreateSKUMasterInput) (SKUMaster, error) {
	input = sanitizeSKUMasterInput(input)
	if err := validateSKUMasterInput(input); err != nil {
		return SKUMaster{}, err
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE sku_master
		SET
			sku = ?,
			name = ?,
			category = ?,
			description = ?,
			unit = ?,
			reorder_level = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.ReorderLevel,
		skuMasterID,
	)
	if err != nil {
		return SKUMaster{}, mapDBError(fmt.Errorf("update sku master: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return SKUMaster{}, fmt.Errorf("resolve updated sku master rows: %w", err)
	}
	if rowsAffected == 0 {
		return SKUMaster{}, ErrNotFound
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE inventory_items
		SET
			sku = ?,
			name = ?,
			category = ?,
			description = ?,
			unit = ?,
			reorder_level = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE sku_master_id = ?
	`,
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.ReorderLevel,
		skuMasterID,
	); err != nil {
		return SKUMaster{}, mapDBError(fmt.Errorf("sync sku master to inventory items: %w", err))
	}

	return s.getSKUMaster(ctx, skuMasterID)
}

func (s *Store) DeleteSKUMaster(ctx context.Context, skuMasterID int64) error {
	var linkedInventoryCount int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM inventory_items
		WHERE sku_master_id = ?
	`, skuMasterID).Scan(&linkedInventoryCount); err != nil {
		return fmt.Errorf("count linked inventory rows for sku master delete: %w", err)
	}
	if linkedInventoryCount > 0 {
		return fmt.Errorf("%w: sku master is linked to stock by location rows", ErrInvalidInput)
	}

	result, err := s.db.ExecContext(ctx, `DELETE FROM sku_master WHERE id = ?`, skuMasterID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete sku master: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted sku master rows: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	return nil
}

func (s *Store) ListItems(ctx context.Context, filters ItemFilters) ([]Item, error) {
	query := `
		SELECT
			i.id,
			i.sku,
			i.name,
			i.category,
			COALESCE(i.description, ''),
			i.unit,
			i.quantity,
			i.reorder_level,
			i.location_id,
			l.name,
			i.storage_section,
			i.delivery_date,
			COALESCE(i.container_no, ''),
			i.expected_qty,
			i.received_qty,
			i.pallets,
			COALESCE(i.pallets_detail_ctns, ''),
			i.height_in,
			i.out_date,
			i.last_restocked_at,
			i.created_at,
			i.updated_at
		FROM inventory_items i
		JOIN storage_locations l ON l.id = i.location_id
		WHERE 1 = 1
	`

	args := make([]any, 0)
	if search := strings.TrimSpace(filters.Search); search != "" {
		likeValue := "%" + search + "%"
		query += " AND (i.sku LIKE ? OR i.name LIKE ? OR i.description LIKE ? OR i.category LIKE ?)"
		args = append(args, likeValue, likeValue, likeValue, likeValue)
	}

	if filters.LocationID > 0 {
		query += " AND i.location_id = ?"
		args = append(args, filters.LocationID)
	}

	if filters.LowStockOnly {
		query += " AND i.quantity <= i.reorder_level"
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
			sku,
			name,
			category,
			description,
			unit,
			quantity,
			reorder_level,
			location_id,
			storage_section,
			delivery_date,
			container_no,
			expected_qty,
			received_qty,
			pallets,
			pallets_detail_ctns,
			height_in,
			out_date,
			last_restocked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		skuMasterID,
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.Quantity,
		input.ReorderLevel,
		input.LocationID,
		input.StorageSection,
		nullableTime(deliveryDate),
		nullableString(input.ContainerNo),
		input.ExpectedQty,
		input.ReceivedQty,
		input.Pallets,
		nullableString(input.PalletsDetailCtns),
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
			sku = ?,
			name = ?,
			category = ?,
			description = ?,
			unit = ?,
			quantity = ?,
			reorder_level = ?,
			location_id = ?,
			storage_section = ?,
			delivery_date = ?,
			container_no = ?,
			expected_qty = ?,
			received_qty = ?,
			pallets = ?,
			pallets_detail_ctns = ?,
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
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.Quantity,
		input.ReorderLevel,
		input.LocationID,
		input.StorageSection,
		nullableTime(deliveryDate),
		nullableString(input.ContainerNo),
		input.ExpectedQty,
		input.ReceivedQty,
		input.Pallets,
		nullableString(input.PalletsDetailCtns),
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
			i.name,
			i.sku,
			COALESCE(m.description_snapshot, i.description, i.name, ''),
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
			COALESCE(m.reason, ''),
			COALESCE(m.reference_code, ''),
			m.created_at
		FROM stock_movements m
		JOIN inventory_items i ON i.id = m.item_id
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
	var locationID int64
	var storageSection string
	var descriptionSnapshot string
	if currentQuantity, locationID, storageSection, descriptionSnapshot, err = s.loadLockedItemForMovement(ctx, tx, input.ItemID); err != nil {
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
			reason,
			reference_code
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		input.ItemID,
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
	if err := tx.QueryRowContext(ctx, `
		SELECT item_id, quantity_change, storage_section
		FROM stock_movements
		WHERE id = ?
		FOR UPDATE
	`, movementID).Scan(&previousItemID, &previousDelta, &previousStorageSection); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Movement{}, ErrNotFound
		}
		return Movement{}, fmt.Errorf("load movement for update: %w", err)
	}
	if input.StorageSection == "" {
		input.StorageSection = previousStorageSection
	}

	previousQuantity, _, _, _, err := s.loadLockedItemForMovement(ctx, tx, previousItemID)
	if err != nil {
		return Movement{}, err
	}
	restoredPreviousQuantity := previousQuantity - previousDelta
	if restoredPreviousQuantity < 0 {
		return Movement{}, ErrInsufficientStock
	}

	if previousItemID == input.ItemID {
		_, locationID, itemStorageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, input.ItemID)
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
				reason = ?,
				reference_code = ?
			WHERE id = ?
		`,
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
		newQuantity, newLocationID, newStorageSection, descriptionSnapshot, err := s.loadLockedItemForMovement(ctx, tx, input.ItemID)
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
				reason = ?,
				reference_code = ?
			WHERE id = ?
		`,
			input.ItemID,
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

func (s *Store) DeleteMovement(ctx context.Context, movementID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var itemID int64
	var quantityChange int
	if err := tx.QueryRowContext(ctx, `
		SELECT item_id, quantity_change
		FROM stock_movements
		WHERE id = ?
		FOR UPDATE
	`, movementID).Scan(&itemID, &quantityChange); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("load movement for delete: %w", err)
	}

	currentQuantity, _, _, _, err := s.loadLockedItemForMovement(ctx, tx, itemID)
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
			i.sku,
			i.name,
			i.category,
			COALESCE(i.description, ''),
			i.unit,
			i.quantity,
			i.reorder_level,
			i.location_id,
			l.name,
			i.storage_section,
			i.delivery_date,
			COALESCE(i.container_no, ''),
			i.expected_qty,
			i.received_qty,
			i.pallets,
			COALESCE(i.pallets_detail_ctns, ''),
			i.height_in,
			i.out_date,
			i.last_restocked_at,
			i.created_at,
			i.updated_at
		FROM inventory_items i
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

func (s *Store) getLocation(ctx context.Context, locationID int64) (Location, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, COALESCE(address, ''), zone, COALESCE(description, ''), capacity, section_count, COALESCE(section_names_json, ''), created_at
		FROM storage_locations
		WHERE id = ?
	`, locationID)

	location, err := scanLocation(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Location{}, ErrNotFound
		}
		return Location{}, fmt.Errorf("scan location: %w", err)
	}

	return location, nil
}

func (s *Store) getSKUMaster(ctx context.Context, skuMasterID int64) (SKUMaster, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, sku, name, category, COALESCE(description, ''), unit, reorder_level, created_at, updated_at
		FROM sku_master
		WHERE id = ?
	`, skuMasterID)

	skuMaster, err := scanSKUMaster(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SKUMaster{}, ErrNotFound
		}
		return SKUMaster{}, err
	}

	return skuMaster, nil
}

func (s *Store) getMovement(ctx context.Context, movementID int64) (Movement, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			m.id,
			m.item_id,
			i.name,
			i.sku,
			COALESCE(m.description_snapshot, i.description, i.name, ''),
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
			COALESCE(m.reason, ''),
			COALESCE(m.reference_code, ''),
			m.created_at
		FROM stock_movements m
		JOIN inventory_items i ON i.id = m.item_id
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
		&location.Zone,
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

func scanSKUMaster(scanner itemScanner) (SKUMaster, error) {
	var skuMaster SKUMaster
	if err := scanner.Scan(
		&skuMaster.ID,
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
		&item.SKU,
		&item.Name,
		&item.Category,
		&item.Description,
		&item.Unit,
		&item.Quantity,
		&item.ReorderLevel,
		&item.LocationID,
		&item.LocationName,
		&item.StorageSection,
		&deliveryDate,
		&item.ContainerNo,
		&item.ExpectedQty,
		&item.ReceivedQty,
		&item.Pallets,
		&item.PalletsDetailCtns,
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

	return item, nil
}

func scanMovement(scanner itemScanner) (Movement, error) {
	var movement Movement
	var deliveryDate sql.NullTime
	var outDate sql.NullTime
	if err := scanner.Scan(
		&movement.ID,
		&movement.ItemID,
		&movement.ItemName,
		&movement.SKU,
		&movement.Description,
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

	return movement, nil
}

func sanitizeItemInput(input CreateItemInput) CreateItemInput {
	input.SKU = strings.TrimSpace(strings.ToUpper(input.SKU))
	input.Name = strings.TrimSpace(input.Name)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	input.Unit = strings.TrimSpace(strings.ToLower(input.Unit))
	input.ContainerNo = strings.TrimSpace(strings.ToUpper(input.ContainerNo))
	input.StorageSection = strings.TrimSpace(strings.ToUpper(input.StorageSection))
	input.PalletsDetailCtns = strings.TrimSpace(input.PalletsDetailCtns)

	if input.Name == "" {
		input.Name = input.Description
	}
	if input.Category == "" {
		input.Category = "General"
	}
	if input.Unit == "" {
		input.Unit = "pcs"
	}
	if input.StorageSection == "" {
		input.StorageSection = "A"
	}

	return input
}

func sanitizeSKUMasterInput(input CreateSKUMasterInput) CreateSKUMasterInput {
	input.SKU = strings.TrimSpace(strings.ToUpper(input.SKU))
	input.Name = strings.TrimSpace(input.Name)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	input.Unit = strings.TrimSpace(strings.ToLower(input.Unit))

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

func sanitizeLocationInput(input CreateLocationInput) CreateLocationInput {
	input.Name = strings.TrimSpace(input.Name)
	input.Address = strings.TrimSpace(input.Address)
	input.Zone = strings.TrimSpace(input.Zone)
	input.Description = strings.TrimSpace(input.Description)
	sectionNames := make([]string, 0, len(input.SectionNames))
	for _, sectionName := range input.SectionNames {
		trimmed := strings.TrimSpace(sectionName)
		if trimmed == "" {
			continue
		}
		sectionNames = append(sectionNames, trimmed)
	}
	if len(sectionNames) == 0 {
		sectionNames = []string{"A"}
	}
	input.SectionNames = sectionNames
	return input
}

func validateSKUMasterInput(input CreateSKUMasterInput) error {
	switch {
	case input.SKU == "":
		return fmt.Errorf("%w: sku is required", ErrInvalidInput)
	case input.Description == "":
		return fmt.Errorf("%w: description is required", ErrInvalidInput)
	case input.ReorderLevel < 0:
		return fmt.Errorf("%w: reorder level cannot be negative", ErrInvalidInput)
	default:
		return nil
	}
}

func validateItemInput(input CreateItemInput) error {
	switch {
	case input.SKU == "":
		return fmt.Errorf("%w: sku is required", ErrInvalidInput)
	case input.Description == "":
		return fmt.Errorf("%w: description is required", ErrInvalidInput)
	case input.Quantity < 0:
		return fmt.Errorf("%w: quantity cannot be negative", ErrInvalidInput)
	case input.ReorderLevel < 0:
		return fmt.Errorf("%w: reorder level cannot be negative", ErrInvalidInput)
	case input.LocationID <= 0:
		return fmt.Errorf("%w: location is required", ErrInvalidInput)
	case input.ExpectedQty < 0 || input.ReceivedQty < 0 || input.Pallets < 0 || input.HeightIn < 0:
		return fmt.Errorf("%w: spreadsheet quantities and height cannot be negative", ErrInvalidInput)
	default:
		return nil
	}
}

func validateLocationInput(input CreateLocationInput) error {
	switch {
	case input.Name == "":
		return fmt.Errorf("%w: storage name is required", ErrInvalidInput)
	case input.Address == "":
		return fmt.Errorf("%w: storage address is required", ErrInvalidInput)
	case input.Zone == "":
		return fmt.Errorf("%w: storage zone is required", ErrInvalidInput)
	case input.Capacity < 0:
		return fmt.Errorf("%w: capacity cannot be negative", ErrInvalidInput)
	case len(input.SectionNames) == 0:
		return fmt.Errorf("%w: at least one storage section is required", ErrInvalidInput)
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
	input.StorageSection = strings.TrimSpace(strings.ToUpper(input.StorageSection))
	input.PalletsDetailCtns = strings.TrimSpace(input.PalletsDetailCtns)
	input.CartonSizeMM = strings.TrimSpace(input.CartonSizeMM)
	input.UnitLabel = strings.TrimSpace(input.UnitLabel)
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
	default:
		return 0, fmt.Errorf("%w: movement type must be IN, OUT, or ADJUST", ErrInvalidInput)
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
	default:
		return "Inventory adjustment recorded"
	}
}

func (s *Store) loadLockedItemForMovement(ctx context.Context, tx *sql.Tx, itemID int64) (int, int64, string, string, error) {
	var quantity int
	var locationID int64
	var storageSection string
	var descriptionSnapshot string
	if err := tx.QueryRowContext(ctx, `
		SELECT quantity, location_id, storage_section, COALESCE(description, name, '')
		FROM inventory_items
		WHERE id = ?
		FOR UPDATE
	`, itemID).Scan(&quantity, &locationID, &storageSection, &descriptionSnapshot); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, 0, "", "", ErrNotFound
		}
		return 0, 0, "", "", fmt.Errorf("load item for movement: %w", err)
	}
	if storageSection == "" {
		storageSection = "A"
	}

	return quantity, locationID, storageSection, descriptionSnapshot, nil
}

func (s *Store) ensureSKUMaster(ctx context.Context, tx *sql.Tx, input CreateItemInput) (int64, error) {
	result, err := tx.ExecContext(ctx, `
		INSERT INTO sku_master (sku, name, category, description, unit, reorder_level)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			category = VALUES(category),
			description = VALUES(description),
			unit = VALUES(unit),
			reorder_level = VALUES(reorder_level),
			id = LAST_INSERT_ID(id)
	`,
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
			pallets = CASE
				WHEN ? <> 0 THEN ?
				ELSE pallets
			END,
			pallets_detail_ctns = CASE
				WHEN ? <> '' THEN ?
				ELSE pallets_detail_ctns
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
		input.StorageSection,
		input.StorageSection,
		nullableTime(deliveryDate),
		input.ContainerNo,
		input.ContainerNo,
		input.ExpectedQty,
		input.ExpectedQty,
		input.ReceivedQty,
		input.ReceivedQty,
		input.Pallets,
		input.Pallets,
		input.PalletsDetailCtns,
		input.PalletsDetailCtns,
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

func marshalSectionNames(sectionNames []string) (string, error) {
	payload, err := json.Marshal(sectionNames)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func parseSectionNames(sectionNamesJSON string, sectionCount int) []string {
	if strings.TrimSpace(sectionNamesJSON) != "" {
		var names []string
		if err := json.Unmarshal([]byte(sectionNamesJSON), &names); err == nil {
			sanitized := make([]string, 0, len(names))
			for _, name := range names {
				trimmed := strings.TrimSpace(name)
				if trimmed == "" {
					continue
				}
				sanitized = append(sanitized, trimmed)
			}
			if len(sanitized) > 0 {
				return sanitized
			}
		}
	}

	if sectionCount <= 0 {
		return []string{"A"}
	}

	names := make([]string, 0, sectionCount)
	for index := 0; index < sectionCount; index++ {
		names = append(names, legacySectionLabel(index))
	}
	return names
}

func legacySectionLabel(index int) string {
	value := index
	label := ""
	for {
		label = string(rune('A'+(value%26))) + label
		value = value/26 - 1
		if value < 0 {
			break
		}
	}
	return label
}
