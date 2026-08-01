package database

import (
	"database/sql"
	"fmt"
)

func applySKUPhysicalProfilesMigration(db *sql.DB) error {
	statements := []string{
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS carton_gross_weight_kg DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER default_units_per_pallet`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS carton_length_cm DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER carton_gross_weight_kg`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS carton_width_cm DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER carton_length_cm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS carton_height_cm DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER carton_width_cm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS outbound_cartons_per_layer INT NOT NULL DEFAULT 0 AFTER carton_height_cm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS outbound_layer_count INT NOT NULL DEFAULT 0 AFTER outbound_cartons_per_layer`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("add UPC physical profile fields: %w", err)
		}
	}

	return nil
}
