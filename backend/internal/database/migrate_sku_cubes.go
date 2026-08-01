package database

import (
	"database/sql"
	"fmt"
)

func applySKUCubesMigration(db *sql.DB) error {
	if _, err := db.Exec(`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS cubes DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER carton_gross_weight_kg`); err != nil {
		return fmt.Errorf("add UPC cubes field: %w", err)
	}
	return nil
}
