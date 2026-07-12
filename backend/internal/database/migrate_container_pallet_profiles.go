package database

import (
	"database/sql"
	"fmt"
)

func applyContainerPalletProfilesMigration(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS container_pallet_profiles (
			id BIGINT NOT NULL AUTO_INCREMENT,
			inventory_item_id BIGINT NOT NULL,
			ctn_per_pallet INT NOT NULL,
			pallet_count INT NOT NULL DEFAULT 0,
			allocated_pallets INT NOT NULL DEFAULT 0,
			damaged_pallets INT NOT NULL DEFAULT 0,
			hold_pallets INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_container_pallet_profiles_size (inventory_item_id, ctn_per_pallet),
			CONSTRAINT fk_container_pallet_profiles_item
				FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
				ON DELETE CASCADE,
			CONSTRAINT chk_container_pallet_profiles_size CHECK (ctn_per_pallet > 0),
			CONSTRAINT chk_container_pallet_profiles_counts CHECK (
				pallet_count >= 0 AND allocated_pallets >= 0 AND damaged_pallets >= 0 AND hold_pallets >= 0
				AND allocated_pallets <= pallet_count
				AND damaged_pallets <= pallet_count
				AND hold_pallets <= pallet_count
			)
		)`,
		`INSERT INTO container_pallet_profiles (
			inventory_item_id, ctn_per_pallet, pallet_count, allocated_pallets, damaged_pallets, hold_pallets
		)
		SELECT
			i.id,
			pi.quantity,
			COUNT(DISTINCT p.id),
			COUNT(DISTINCT CASE WHEN pi.allocated_qty > 0 THEN p.id END),
			COUNT(DISTINCT CASE WHEN pi.damaged_qty > 0 THEN p.id END),
			COUNT(DISTINCT CASE WHEN pi.hold_qty > 0 THEN p.id END)
		FROM inventory_items i
		JOIN pallets p
			ON p.customer_id = i.customer_id
			AND p.current_location_id = i.location_id
			AND COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP') = COALESCE(NULLIF(i.storage_section, ''), 'TEMP')
			AND COALESCE(p.current_container_no, '') = COALESCE(i.container_no, '')
		JOIN pallet_items pi ON pi.pallet_id = p.id AND pi.sku_master_id = i.sku_master_id
		WHERE p.status <> 'CANCELLED' AND pi.quantity > 0
		GROUP BY i.id, pi.quantity
		ON DUPLICATE KEY UPDATE
			pallet_count = VALUES(pallet_count),
			allocated_pallets = VALUES(allocated_pallets),
			damaged_pallets = VALUES(damaged_pallets),
			hold_pallets = VALUES(hold_pallets)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply container pallet profiles migration %q: %w", statement, err)
		}
	}
	return nil
}
