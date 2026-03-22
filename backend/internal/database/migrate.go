package database

import (
	"database/sql"
	"fmt"
	"strings"
)

func Migrate(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id BIGINT NOT NULL AUTO_INCREMENT,
			email VARCHAR(190) NOT NULL,
			full_name VARCHAR(160) NOT NULL,
			role VARCHAR(32) NOT NULL DEFAULT 'admin',
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
		`CREATE TABLE IF NOT EXISTS customers (
			id BIGINT NOT NULL AUTO_INCREMENT,
			name VARCHAR(160) NOT NULL,
			contact_name VARCHAR(160) DEFAULT NULL,
			email VARCHAR(190) DEFAULT NULL,
			phone VARCHAR(64) DEFAULT NULL,
			notes TEXT DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_customers_name (name)
		)`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'admin' AFTER full_name`,
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
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS customer_id BIGINT NULL AFTER sku_master_id`,
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
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customer_id BIGINT NULL AFTER item_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS storage_section VARCHAR(16) NOT NULL DEFAULT 'A' AFTER location_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) DEFAULT NULL AFTER delivery_date`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS inbound_document_id BIGINT NULL AFTER item_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS inbound_document_line_id BIGINT NULL AFTER inbound_document_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS outbound_document_id BIGINT NULL AFTER inbound_document_line_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS outbound_document_line_id BIGINT NULL AFTER outbound_document_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS adjustment_id BIGINT NULL AFTER outbound_document_line_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS adjustment_line_id BIGINT NULL AFTER adjustment_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS transfer_id BIGINT NULL AFTER adjustment_line_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS transfer_line_id BIGINT NULL AFTER transfer_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cycle_count_id BIGINT NULL AFTER transfer_line_id`,
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cycle_count_line_id BIGINT NULL AFTER cycle_count_id`,
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
		`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS document_note VARCHAR(255) DEFAULT NULL AFTER out_date`,
		`ALTER TABLE stock_movements MODIFY COLUMN movement_type ENUM('IN', 'OUT', 'ADJUST', 'REVERSAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT') NOT NULL`,
		`CREATE TABLE IF NOT EXISTS outbound_documents (
			id BIGINT NOT NULL AUTO_INCREMENT,
			packing_list_no VARCHAR(120) DEFAULT NULL,
			order_ref VARCHAR(120) DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			out_date DATE DEFAULT NULL,
			document_note TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
			cancel_note TEXT DEFAULT NULL,
			cancelled_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_outbound_documents_customer_id (customer_id),
			KEY idx_outbound_documents_out_date (out_date),
			KEY idx_outbound_documents_packing_list_no (packing_list_no),
			CONSTRAINT fk_outbound_documents_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id)
		)`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS cancel_note TEXT DEFAULT NULL AFTER status`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER cancel_note`,
		`CREATE TABLE IF NOT EXISTS inbound_documents (
			id BIGINT NOT NULL AUTO_INCREMENT,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			delivery_date DATE DEFAULT NULL,
			container_no VARCHAR(120) DEFAULT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			unit_label VARCHAR(32) DEFAULT NULL,
			document_note TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_inbound_documents_customer_id (customer_id),
			KEY idx_inbound_documents_location_id (location_id),
			KEY idx_inbound_documents_delivery_date (delivery_date),
			KEY idx_inbound_documents_container_no (container_no),
			CONSTRAINT fk_inbound_documents_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_inbound_documents_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS inbound_document_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			document_id BIGINT NOT NULL,
			movement_id BIGINT DEFAULT NULL,
			item_id BIGINT NOT NULL,
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			expected_qty INT NOT NULL DEFAULT 0,
			received_qty INT NOT NULL DEFAULT 0,
			pallets INT NOT NULL DEFAULT 0,
			pallets_detail_ctns VARCHAR(255) DEFAULT NULL,
			unit_label VARCHAR(32) DEFAULT NULL,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_inbound_document_lines_document_id (document_id),
			KEY idx_inbound_document_lines_movement_id (movement_id),
			KEY idx_inbound_document_lines_item_id (item_id),
			CONSTRAINT fk_inbound_document_lines_document
				FOREIGN KEY (document_id) REFERENCES inbound_documents (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_inbound_document_lines_movement
				FOREIGN KEY (movement_id) REFERENCES stock_movements (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_inbound_document_lines_item
				FOREIGN KEY (item_id) REFERENCES inventory_items (id)
		)`,
		`CREATE TABLE IF NOT EXISTS outbound_document_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			document_id BIGINT NOT NULL,
			movement_id BIGINT DEFAULT NULL,
			item_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			location_name_snapshot VARCHAR(160) NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			quantity INT NOT NULL DEFAULT 0,
			unit_label VARCHAR(32) DEFAULT NULL,
			carton_size_mm VARCHAR(120) DEFAULT NULL,
			net_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0,
			gross_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_outbound_document_lines_document_id (document_id),
			KEY idx_outbound_document_lines_movement_id (movement_id),
			KEY idx_outbound_document_lines_item_id (item_id),
			CONSTRAINT fk_outbound_document_lines_document
				FOREIGN KEY (document_id) REFERENCES outbound_documents (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_outbound_document_lines_movement
				FOREIGN KEY (movement_id) REFERENCES stock_movements (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_outbound_document_lines_item
				FOREIGN KEY (item_id) REFERENCES inventory_items (id),
			CONSTRAINT fk_outbound_document_lines_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_adjustments (
			id BIGINT NOT NULL AUTO_INCREMENT,
			adjustment_no VARCHAR(120) NOT NULL,
			reason_code VARCHAR(64) NOT NULL,
			notes TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_inventory_adjustments_adjustment_no (adjustment_no),
			KEY idx_inventory_adjustments_reason_code (reason_code),
			KEY idx_inventory_adjustments_created_at (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			adjustment_id BIGINT NOT NULL,
			movement_id BIGINT DEFAULT NULL,
			item_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL,
			location_id BIGINT NOT NULL,
			location_name_snapshot VARCHAR(160) NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			before_qty INT NOT NULL DEFAULT 0,
			adjust_qty INT NOT NULL DEFAULT 0,
			after_qty INT NOT NULL DEFAULT 0,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_inventory_adjustment_lines_adjustment_id (adjustment_id),
			KEY idx_inventory_adjustment_lines_movement_id (movement_id),
			KEY idx_inventory_adjustment_lines_item_id (item_id),
			CONSTRAINT fk_inventory_adjustment_lines_adjustment
				FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_inventory_adjustment_lines_movement
				FOREIGN KEY (movement_id) REFERENCES stock_movements (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_inventory_adjustment_lines_item
				FOREIGN KEY (item_id) REFERENCES inventory_items (id),
			CONSTRAINT fk_inventory_adjustment_lines_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_inventory_adjustment_lines_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_transfers (
			id BIGINT NOT NULL AUTO_INCREMENT,
			transfer_no VARCHAR(120) NOT NULL,
			notes TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_inventory_transfers_transfer_no (transfer_no),
			KEY idx_inventory_transfers_created_at (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			transfer_id BIGINT NOT NULL,
			transfer_out_movement_id BIGINT DEFAULT NULL,
			transfer_in_movement_id BIGINT DEFAULT NULL,
			source_item_id BIGINT NOT NULL,
			destination_item_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL,
			from_location_id BIGINT NOT NULL,
			from_location_name_snapshot VARCHAR(160) NOT NULL,
			from_storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			to_location_id BIGINT NOT NULL,
			to_location_name_snapshot VARCHAR(160) NOT NULL,
			to_storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			quantity INT NOT NULL DEFAULT 0,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_inventory_transfer_lines_transfer_id (transfer_id),
			KEY idx_inventory_transfer_lines_source_item_id (source_item_id),
			KEY idx_inventory_transfer_lines_destination_item_id (destination_item_id),
			KEY idx_inventory_transfer_lines_out_movement_id (transfer_out_movement_id),
			KEY idx_inventory_transfer_lines_in_movement_id (transfer_in_movement_id),
			CONSTRAINT fk_inventory_transfer_lines_transfer
				FOREIGN KEY (transfer_id) REFERENCES inventory_transfers (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_inventory_transfer_lines_out_movement
				FOREIGN KEY (transfer_out_movement_id) REFERENCES stock_movements (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_inventory_transfer_lines_in_movement
				FOREIGN KEY (transfer_in_movement_id) REFERENCES stock_movements (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_inventory_transfer_lines_source_item
				FOREIGN KEY (source_item_id) REFERENCES inventory_items (id),
			CONSTRAINT fk_inventory_transfer_lines_destination_item
				FOREIGN KEY (destination_item_id) REFERENCES inventory_items (id),
			CONSTRAINT fk_inventory_transfer_lines_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_inventory_transfer_lines_from_location
				FOREIGN KEY (from_location_id) REFERENCES storage_locations (id),
			CONSTRAINT fk_inventory_transfer_lines_to_location
				FOREIGN KEY (to_location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS cycle_counts (
			id BIGINT NOT NULL AUTO_INCREMENT,
			count_no VARCHAR(120) NOT NULL,
			notes TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_cycle_counts_count_no (count_no),
			KEY idx_cycle_counts_created_at (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS cycle_count_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			cycle_count_id BIGINT NOT NULL,
			movement_id BIGINT DEFAULT NULL,
			item_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL,
			location_id BIGINT NOT NULL,
			location_name_snapshot VARCHAR(160) NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			system_qty INT NOT NULL DEFAULT 0,
			counted_qty INT NOT NULL DEFAULT 0,
			variance_qty INT NOT NULL DEFAULT 0,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_cycle_count_lines_cycle_count_id (cycle_count_id),
			KEY idx_cycle_count_lines_movement_id (movement_id),
			KEY idx_cycle_count_lines_item_id (item_id),
			CONSTRAINT fk_cycle_count_lines_cycle_count
				FOREIGN KEY (cycle_count_id) REFERENCES cycle_counts (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_cycle_count_lines_movement
				FOREIGN KEY (movement_id) REFERENCES stock_movements (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_cycle_count_lines_item
				FOREIGN KEY (item_id) REFERENCES inventory_items (id),
			CONSTRAINT fk_cycle_count_lines_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_cycle_count_lines_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id BIGINT NOT NULL AUTO_INCREMENT,
			actor_user_id BIGINT NOT NULL,
			actor_email VARCHAR(190) DEFAULT NULL,
			actor_name VARCHAR(160) DEFAULT NULL,
			actor_role VARCHAR(32) DEFAULT NULL,
			action VARCHAR(64) NOT NULL,
			entity_type VARCHAR(64) NOT NULL,
			entity_id BIGINT DEFAULT NULL,
			target_label VARCHAR(255) DEFAULT NULL,
			summary VARCHAR(255) DEFAULT NULL,
			details_json JSON DEFAULT NULL,
			request_method VARCHAR(16) DEFAULT NULL,
			request_path VARCHAR(255) DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_audit_logs_actor_user_id (actor_user_id),
			KEY idx_audit_logs_entity_type (entity_type),
			KEY idx_audit_logs_created_at (created_at),
			CONSTRAINT fk_audit_logs_actor_user
				FOREIGN KEY (actor_user_id) REFERENCES users (id)
		)`,
		`UPDATE stock_movements
			SET document_note = reason
			WHERE movement_type = 'OUT'
				AND (document_note IS NULL OR document_note = '')
				AND reason IS NOT NULL
				AND reason <> ''
				AND reason <> 'Outbound shipment recorded'`,
		`DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply migration %q: %w", statement, err)
		}
	}

	if _, err := db.Exec(`
		INSERT INTO customers (name, contact_name, email, phone, notes)
		VALUES ('Unassigned', NULL, NULL, NULL, 'Default customer for legacy inventory rows')
		ON DUPLICATE KEY UPDATE
			notes = VALUES(notes)
	`); err != nil {
		return fmt.Errorf("seed default customer: %w", err)
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

	if _, err := db.Exec(`
		UPDATE inventory_items
		SET customer_id = (SELECT id FROM customers WHERE name = 'Unassigned')
		WHERE customer_id IS NULL OR customer_id = 0
	`); err != nil {
		return fmt.Errorf("backfill inventory item customer: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE stock_movements m
		JOIN inventory_items i ON i.id = m.item_id
		SET m.customer_id = i.customer_id
		WHERE m.customer_id IS NULL OR m.customer_id = 0
	`); err != nil {
		return fmt.Errorf("backfill movement customer: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE users
		SET role = 'admin'
		WHERE role IS NULL OR role = ''
	`); err != nil {
		return fmt.Errorf("backfill user roles: %w", err)
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
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items DROP INDEX uq_inventory_item_balance`); err != nil {
			return fmt.Errorf("drop legacy inventory balance uniqueness: %w", err)
		}
	}

	if _, err := db.Exec(`ALTER TABLE inventory_items ADD UNIQUE INDEX uq_inventory_item_balance (sku_master_id, location_id, storage_section, customer_id)`); err != nil {
		if !isDuplicateIndexError(err) {
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

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_customer_id"); err != nil {
		return fmt.Errorf("check inventory customer index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD INDEX idx_inventory_items_customer_id (customer_id)`); err != nil {
			return fmt.Errorf("create inventory customer index: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "inventory_items", "fk_inventory_items_customer"); err != nil {
		return fmt.Errorf("check inventory customer foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_customer FOREIGN KEY (customer_id) REFERENCES customers (id)`); err != nil {
			return fmt.Errorf("create inventory customer foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "stock_movements", "idx_stock_movements_customer_id"); err != nil {
		return fmt.Errorf("check movement customer index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE stock_movements ADD INDEX idx_stock_movements_customer_id (customer_id)`); err != nil {
			return fmt.Errorf("create movement customer index: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "stock_movements", "fk_stock_movements_customer"); err != nil {
		return fmt.Errorf("check movement customer foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`ALTER TABLE stock_movements ADD CONSTRAINT fk_stock_movements_customer FOREIGN KEY (customer_id) REFERENCES customers (id)`); err != nil {
			return fmt.Errorf("create movement customer foreign key: %w", err)
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

func isDuplicateIndexError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "Duplicate key name") || strings.Contains(err.Error(), "already exists"))
}
