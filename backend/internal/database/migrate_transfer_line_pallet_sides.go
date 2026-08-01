package database

import (
	"database/sql"
	"fmt"
)

// applyTransferLinePalletSidesMigration records the pallet balance change at
// each end of a transfer independently. New transfer records always provide
// both values; existing rows remain untouched.
func applyTransferLinePalletSidesMigration(db *sql.DB) error {
	statements := []string{
		`ALTER TABLE inventory_transfer_lines ADD COLUMN IF NOT EXISTS source_pallets INT NULL AFTER pallets`,
		`ALTER TABLE inventory_transfer_lines ADD COLUMN IF NOT EXISTS destination_pallets INT NULL AFTER source_pallets`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("prepare transfer pallet sides %q: %w", statement, err)
		}
	}
	return nil
}
