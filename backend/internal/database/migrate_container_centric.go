package database

import (
	"database/sql"
	"fmt"
)

func applyContainerCentricInventoryMigration(db *sql.DB) error {
	statements := []string{
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_id BIGINT DEFAULT NULL AFTER customer_id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 0 AFTER container_no`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS allocated_qty INT NOT NULL DEFAULT 0 AFTER quantity`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS damaged_qty INT NOT NULL DEFAULT 0 AFTER allocated_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS hold_qty INT NOT NULL DEFAULT 0 AFTER damaged_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER hold_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS allocated_pallets INT NOT NULL DEFAULT 0 AFTER pallets`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS container_id BIGINT DEFAULT NULL AFTER customer_id`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS pallet_change DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER quantity_change`,
		`ALTER TABLE stock_ledger MODIFY COLUMN pallet_id BIGINT DEFAULT NULL`,
		`ALTER TABLE container_lifecycle_events ADD COLUMN IF NOT EXISTS pallet_delta DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER quantity_delta`,
		`CREATE TABLE IF NOT EXISTS outbound_container_allocations (
			id BIGINT NOT NULL AUTO_INCREMENT,
			outbound_line_id BIGINT NOT NULL,
			container_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			sku_master_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			allocated_qty INT NOT NULL DEFAULT 0,
			allocated_pallets INT NOT NULL DEFAULT 0,
			shipped_qty INT NOT NULL DEFAULT 0,
			shipped_pallets INT NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_outbound_container_allocation_bucket (outbound_line_id, container_id, sku_master_id, location_id, storage_section),
			KEY idx_outbound_container_allocations_container (container_id),
			KEY idx_outbound_container_allocations_customer (customer_id),
			KEY idx_outbound_container_allocations_sku (sku_master_id),
			KEY idx_outbound_container_allocations_location (location_id),
			CONSTRAINT fk_outbound_container_allocations_line
				FOREIGN KEY (outbound_line_id) REFERENCES outbound_document_lines (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_outbound_container_allocations_container
				FOREIGN KEY (container_id) REFERENCES containers (id),
			CONSTRAINT fk_outbound_container_allocations_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_outbound_container_allocations_sku
				FOREIGN KEY (sku_master_id) REFERENCES sku_master (id),
			CONSTRAINT fk_outbound_container_allocations_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`UPDATE inventory_items i
		JOIN containers c
			ON c.customer_id = i.customer_id
			AND UPPER(TRIM(c.container_no)) = UPPER(TRIM(i.container_no))
		SET i.container_id = c.id
		WHERE i.container_id IS NULL
			AND COALESCE(TRIM(i.container_no), '') <> ''`,
		`UPDATE stock_ledger sl
		JOIN containers c
			ON c.customer_id = sl.customer_id
			AND UPPER(TRIM(c.container_no)) = UPPER(TRIM(sl.container_no_snapshot))
		SET sl.container_id = c.id
		WHERE sl.container_id IS NULL
			AND COALESCE(TRIM(sl.container_no_snapshot), '') <> ''`,
		`UPDATE stock_ledger
		SET pallet_change = CASE
			WHEN event_type IN ('RECEIVE', 'REVERSAL', 'TRANSFER_IN') THEN 1
			WHEN event_type IN ('SHIP', 'TRANSFER_OUT', 'CANCELLED') THEN -1
			ELSE 0
		END
		WHERE pallet_change = 0`,
		`UPDATE container_lifecycle_events cle
		JOIN stock_ledger sl ON sl.id = cle.stock_ledger_id
		SET cle.pallet_delta = sl.pallet_change
		WHERE cle.pallet_delta = 0`,
		`UPDATE inventory_items i
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
				COUNT(DISTINCT CASE WHEN pi.quantity > 0 THEN p.id END) AS pallets,
				COUNT(DISTINCT CASE WHEN pi.allocated_qty > 0 THEN p.id END) AS allocated_pallets
			FROM pallet_items pi
			JOIN pallets p ON p.id = pi.pallet_id
			WHERE p.status <> 'CANCELLED'
			GROUP BY
				pi.sku_master_id,
				p.customer_id,
				p.current_location_id,
				COALESCE(NULLIF(p.current_storage_section, ''), 'TEMP'),
				COALESCE(p.current_container_no, '')
		) balances
			ON balances.sku_master_id = i.sku_master_id
			AND balances.customer_id = i.customer_id
			AND balances.location_id = i.location_id
			AND balances.storage_section = i.storage_section
			AND balances.container_no = i.container_no
		SET
			i.quantity = COALESCE(balances.quantity, 0),
			i.allocated_qty = COALESCE(balances.allocated_qty, 0),
			i.damaged_qty = COALESCE(balances.damaged_qty, 0),
			i.hold_qty = COALESCE(balances.hold_qty, 0),
			i.pallets = COALESCE(balances.pallets, 0),
			i.allocated_pallets = COALESCE(balances.allocated_pallets, 0)`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply container-centric inventory migration %q: %w", statement, err)
		}

	}

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_container_id"); err != nil {
		return fmt.Errorf("check inventory container index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD INDEX idx_inventory_items_container_id (container_id)`); err != nil {
			return fmt.Errorf("add inventory container index: %w", err)
		}
	}
	if hasFK, err := foreignKeyExists(db, "inventory_items", "fk_inventory_items_container"); err != nil {
		return fmt.Errorf("check inventory container foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_container FOREIGN KEY (container_id) REFERENCES containers (id) ON DELETE SET NULL`); err != nil {
			return fmt.Errorf("add inventory container foreign key: %w", err)
		}
	}
	if hasIndex, err := indexExists(db, "stock_ledger", "idx_stock_ledger_container_id"); err != nil {
		return fmt.Errorf("check stock ledger container index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE stock_ledger ADD INDEX idx_stock_ledger_container_id (container_id)`); err != nil {
			return fmt.Errorf("add stock ledger container index: %w", err)
		}
	}
	if hasFK, err := foreignKeyExists(db, "stock_ledger", "fk_stock_ledger_container"); err != nil {
		return fmt.Errorf("check stock ledger container foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`ALTER TABLE stock_ledger ADD CONSTRAINT fk_stock_ledger_container FOREIGN KEY (container_id) REFERENCES containers (id) ON DELETE SET NULL`); err != nil {
			return fmt.Errorf("add stock ledger container foreign key: %w", err)
		}
	}

	return nil
}
