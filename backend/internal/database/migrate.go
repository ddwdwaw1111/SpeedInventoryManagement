package database

import (
	"database/sql"
	"fmt"
)

func Migrate(db *sql.DB) error {
	statements := []string{
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT NULL AFTER name`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS delivery_date DATE DEFAULT NULL AFTER location_id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS storage_section VARCHAR(16) NOT NULL DEFAULT 'A' AFTER location_id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) DEFAULT NULL AFTER delivery_date`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS expected_qty INT NOT NULL DEFAULT 0 AFTER container_no`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS received_qty INT NOT NULL DEFAULT 0 AFTER expected_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER received_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pallets_detail_ctns VARCHAR(255) DEFAULT NULL AFTER pallets`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS height_in INT NOT NULL DEFAULT 0 AFTER pallets_detail_ctns`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS out_date DATE DEFAULT NULL AFTER height_in`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS delivery_date DATE DEFAULT NULL AFTER quantity_change`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS storage_section VARCHAR(16) NOT NULL DEFAULT 'A' AFTER location_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) DEFAULT NULL AFTER delivery_date`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS description_snapshot VARCHAR(255) DEFAULT NULL AFTER container_no`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS expected_qty INT NOT NULL DEFAULT 0 AFTER description_snapshot`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS received_qty INT NOT NULL DEFAULT 0 AFTER expected_qty`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER received_qty`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS pallets_detail_ctns VARCHAR(255) DEFAULT NULL AFTER pallets`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS height_in INT NOT NULL DEFAULT 0 AFTER pallets_detail_ctns`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS out_date DATE DEFAULT NULL AFTER height_in`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reference_code VARCHAR(120) DEFAULT NULL AFTER reason`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS packing_list_no VARCHAR(120) DEFAULT NULL AFTER container_no`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS order_ref VARCHAR(120) DEFAULT NULL AFTER packing_list_no`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS item_number VARCHAR(120) DEFAULT NULL AFTER order_ref`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS carton_size_mm VARCHAR(120) DEFAULT NULL AFTER pallets_detail_ctns`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS carton_count INT NOT NULL DEFAULT 0 AFTER carton_size_mm`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_label VARCHAR(32) DEFAULT NULL AFTER carton_count`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS net_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER unit_label`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS gross_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER net_weight_kgs`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply migration %q: %w", statement, err)
		}
	}

	return nil
}
