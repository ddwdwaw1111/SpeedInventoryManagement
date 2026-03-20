package database

import (
	"database/sql"
	"fmt"
)

func Migrate(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id BIGINT NOT NULL AUTO_INCREMENT,
			email VARCHAR(190) NOT NULL,
			full_name VARCHAR(160) NOT NULL,
			password_salt CHAR(32) NOT NULL,
			password_hash CHAR(64) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_users_email (email)
		)`,
		`CREATE TABLE IF NOT EXISTS user_sessions (
			id BIGINT NOT NULL AUTO_INCREMENT,
			user_id BIGINT NOT NULL,
			token_hash CHAR(64) NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_user_sessions_token_hash (token_hash),
			KEY idx_user_sessions_user_id (user_id),
			KEY idx_user_sessions_expires_at (expires_at),
			CONSTRAINT fk_user_sessions_user
				FOREIGN KEY (user_id) REFERENCES users (id)
				ON DELETE CASCADE
		)`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT NULL AFTER name`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS section_count INT NOT NULL DEFAULT 1 AFTER capacity`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS section_names_json TEXT DEFAULT NULL AFTER section_count`,
		`CREATE TABLE IF NOT EXISTS sku_master (
			id BIGINT NOT NULL AUTO_INCREMENT,
			sku VARCHAR(64) NOT NULL,
			name VARCHAR(160) NOT NULL,
			category VARCHAR(120) NOT NULL,
			description TEXT DEFAULT NULL,
			unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
			reorder_level INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_sku_master_sku (sku)
		)`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sku_master_id BIGINT NULL AFTER id`,
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
		`DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply migration %q: %w", statement, err)
		}
	}

	if _, err := db.Exec(`
		INSERT INTO sku_master (sku, name, category, description, unit, reorder_level)
		SELECT DISTINCT sku, name, category, description, unit, reorder_level
		FROM inventory_items
		WHERE sku IS NOT NULL AND sku <> ''
		ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			category = VALUES(category),
			description = VALUES(description),
			unit = VALUES(unit),
			reorder_level = VALUES(reorder_level)
	`); err != nil {
		return fmt.Errorf("backfill sku master: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE inventory_items i
		JOIN sku_master s ON s.sku = i.sku
		SET i.sku_master_id = s.id
		WHERE i.sku_master_id IS NULL OR i.sku_master_id = 0
	`); err != nil {
		return fmt.Errorf("link inventory items to sku master: %w", err)
	}

	if hasIndex, err := indexExists(db, "inventory_items", "uq_inventory_items_sku"); err != nil {
		return fmt.Errorf("check inventory sku index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items DROP INDEX uq_inventory_items_sku`); err != nil {
			return fmt.Errorf("drop legacy inventory sku uniqueness: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_items", "uq_inventory_item_balance"); err != nil {
		return fmt.Errorf("check inventory balance index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD UNIQUE INDEX uq_inventory_item_balance (sku_master_id, location_id, storage_section)`); err != nil {
			return fmt.Errorf("create inventory balance uniqueness: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_sku_master_id"); err != nil {
		return fmt.Errorf("check inventory sku master index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD INDEX idx_inventory_items_sku_master_id (sku_master_id)`); err != nil {
			return fmt.Errorf("create inventory sku master index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_sku"); err != nil {
		return fmt.Errorf("check inventory sku index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD INDEX idx_inventory_items_sku (sku)`); err != nil {
			return fmt.Errorf("create inventory sku lookup index: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "inventory_items", "fk_inventory_items_sku_master"); err != nil {
		return fmt.Errorf("check inventory sku master foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_sku_master FOREIGN KEY (sku_master_id) REFERENCES sku_master (id)`); err != nil {
			return fmt.Errorf("create inventory sku master foreign key: %w", err)
		}
	}

	return nil
}

func indexExists(db *sql.DB, tableName string, indexName string) (bool, error) {
	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.statistics
		WHERE table_schema = DATABASE()
			AND table_name = ?
			AND index_name = ?
	`, tableName, indexName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func foreignKeyExists(db *sql.DB, tableName string, constraintName string) (bool, error) {
	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.table_constraints
		WHERE constraint_schema = DATABASE()
			AND table_name = ?
			AND constraint_name = ?
			AND constraint_type = 'FOREIGN KEY'
	`, tableName, constraintName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
