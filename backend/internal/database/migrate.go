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
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
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
		`CREATE TABLE IF NOT EXISTS storage_locations (
			id BIGINT NOT NULL AUTO_INCREMENT,
			name VARCHAR(120) NOT NULL,
			address VARCHAR(255) DEFAULT NULL,
			description VARCHAR(255) DEFAULT NULL,
			capacity INT NOT NULL DEFAULT 0,
			section_count INT NOT NULL DEFAULT 1,
			section_names_json TEXT DEFAULT NULL,
			layout_json JSON DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_storage_locations_name (name)
		)`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT NULL AFTER name`,
		`ALTER TABLE storage_locations DROP COLUMN IF EXISTS zone`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS section_count INT NOT NULL DEFAULT 1 AFTER capacity`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS section_names_json TEXT DEFAULT NULL AFTER section_count`,
		`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS layout_json JSON DEFAULT NULL AFTER section_names_json`,
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
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER role`,
		`ALTER TABLE users MODIFY COLUMN password_salt VARCHAR(32) NOT NULL DEFAULT ''`,
		`ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NOT NULL`,
		`CREATE TABLE IF NOT EXISTS sku_master (
			id BIGINT NOT NULL AUTO_INCREMENT,
			item_number VARCHAR(120) DEFAULT NULL,
			sku VARCHAR(64) NOT NULL,
			name VARCHAR(160) NOT NULL,
			category VARCHAR(120) NOT NULL,
			description TEXT DEFAULT NULL,
			unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
			reorder_level INT NOT NULL DEFAULT 0,
			default_units_per_pallet INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_sku_master_sku (sku)
		)`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS item_number VARCHAR(120) DEFAULT NULL AFTER id`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS default_units_per_pallet INT NOT NULL DEFAULT 0 AFTER reorder_level`,
		`CREATE TABLE IF NOT EXISTS ui_preferences (
			id BIGINT NOT NULL AUTO_INCREMENT,
			scope_type VARCHAR(32) NOT NULL DEFAULT 'global',
			scope_id BIGINT NOT NULL DEFAULT 0,
			preference_key VARCHAR(120) NOT NULL,
			value_json JSON DEFAULT NULL,
			updated_by_user_id BIGINT DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_ui_preferences_scope_key (scope_type, scope_id, preference_key)
		)`,
		`ALTER TABLE ui_preferences ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT DEFAULT NULL AFTER value_json`,
		`CREATE TABLE IF NOT EXISTS inventory_items (
			id BIGINT NOT NULL AUTO_INCREMENT,
			sku_master_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			delivery_date DATE DEFAULT NULL,
			container_no VARCHAR(120) NOT NULL DEFAULT '',
			last_restocked_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_inventory_item_balance (sku_master_id, location_id, storage_section, customer_id, container_no),
			KEY idx_inventory_items_location_id (location_id),
			KEY idx_inventory_items_sku_master_id (sku_master_id),
			KEY idx_inventory_items_customer_id (customer_id),
			CONSTRAINT fk_inventory_items_sku_master
				FOREIGN KEY (sku_master_id) REFERENCES sku_master (id),
			CONSTRAINT fk_inventory_items_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_inventory_items_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sku_master_id BIGINT NULL AFTER id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS customer_id BIGINT NULL AFTER sku_master_id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS delivery_date DATE DEFAULT NULL AFTER location_id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP' AFTER location_id`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL DEFAULT '' AFTER delivery_date`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMP NULL DEFAULT NULL AFTER container_no`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS item_number`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS sku`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS name`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS category`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS description`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS unit`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS quantity`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS allocated_qty`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS damaged_qty`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS hold_qty`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS reorder_level`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS expected_qty`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS received_qty`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS height_in`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS out_date`,
		`CREATE TABLE IF NOT EXISTS outbound_documents (
			id BIGINT NOT NULL AUTO_INCREMENT,
			packing_list_no VARCHAR(120) DEFAULT NULL,
			order_ref VARCHAR(120) DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			out_date DATE DEFAULT NULL,
			ship_to_name VARCHAR(160) DEFAULT NULL,
			ship_to_address VARCHAR(255) DEFAULT NULL,
			ship_to_contact VARCHAR(160) DEFAULT NULL,
			carrier_name VARCHAR(160) DEFAULT NULL,
			document_note TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
			tracking_status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
			confirmed_at TIMESTAMP NULL DEFAULT NULL,
			posted_at TIMESTAMP NULL DEFAULT NULL,
			cancel_note TEXT DEFAULT NULL,
			cancelled_at TIMESTAMP NULL DEFAULT NULL,
			archived_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_outbound_documents_customer_id (customer_id),
			KEY idx_outbound_documents_out_date (out_date),
			KEY idx_outbound_documents_packing_list_no (packing_list_no),
			CONSTRAINT fk_outbound_documents_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id)
		)`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS ship_to_name VARCHAR(160) DEFAULT NULL AFTER out_date`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS ship_to_address VARCHAR(255) DEFAULT NULL AFTER ship_to_name`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS ship_to_contact VARCHAR(160) DEFAULT NULL AFTER ship_to_address`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS carrier_name VARCHAR(160) DEFAULT NULL AFTER ship_to_contact`,
		`ALTER TABLE outbound_documents MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED'`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED' AFTER status`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL DEFAULT NULL AFTER status`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP NULL DEFAULT NULL AFTER confirmed_at`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS cancel_note TEXT DEFAULT NULL AFTER posted_at`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER cancel_note`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL AFTER cancelled_at`,
		`UPDATE outbound_documents
			SET
				confirmed_at = COALESCE(confirmed_at, posted_at, created_at),
				posted_at = COALESCE(posted_at, created_at),
				status = 'CONFIRMED'
			WHERE UPPER(status) = 'POSTED'`,
		`UPDATE outbound_documents
			SET tracking_status = CASE
				WHEN UPPER(status) IN ('CONFIRMED', 'POSTED') THEN 'SHIPPED'
				ELSE 'SCHEDULED'
			END
			WHERE COALESCE(TRIM(tracking_status), '') = ''`,
		`CREATE TABLE IF NOT EXISTS inbound_documents (
			id BIGINT NOT NULL AUTO_INCREMENT,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			delivery_date DATE DEFAULT NULL,
			container_no VARCHAR(120) DEFAULT NULL,
			handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED',
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			unit_label VARCHAR(32) DEFAULT NULL,
			document_note TEXT DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
			tracking_status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
			confirmed_at TIMESTAMP NULL DEFAULT NULL,
			posted_at TIMESTAMP NULL DEFAULT NULL,
			cancel_note TEXT DEFAULT NULL,
			cancelled_at TIMESTAMP NULL DEFAULT NULL,
			archived_at TIMESTAMP NULL DEFAULT NULL,
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
		`ALTER TABLE inbound_documents MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED'`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED' AFTER container_no`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED' AFTER status`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL DEFAULT NULL AFTER status`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP NULL DEFAULT NULL AFTER confirmed_at`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS cancel_note TEXT DEFAULT NULL AFTER posted_at`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER cancel_note`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL AFTER cancelled_at`,
		`UPDATE inbound_documents
			SET
				confirmed_at = COALESCE(confirmed_at, posted_at, created_at),
				posted_at = COALESCE(posted_at, created_at),
				status = 'CONFIRMED'
			WHERE UPPER(status) = 'POSTED'`,
		`UPDATE inbound_documents
			SET tracking_status = CASE
				WHEN UPPER(status) IN ('CONFIRMED', 'POSTED') THEN 'RECEIVED'
				ELSE 'SCHEDULED'
			END
			WHERE COALESCE(TRIM(tracking_status), '') = ''`,
		`CREATE TABLE IF NOT EXISTS container_visits (
			id BIGINT NOT NULL AUTO_INCREMENT,
			inbound_document_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			container_no VARCHAR(120) NOT NULL,
			arrival_date DATE DEFAULT NULL,
			received_at TIMESTAMP NULL DEFAULT NULL,
			handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED',
			closed_at TIMESTAMP NULL DEFAULT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_container_visits_inbound_document_id (inbound_document_id),
			KEY idx_container_visits_container_no (container_no),
			KEY idx_container_visits_customer_id (customer_id),
			KEY idx_container_visits_location_id (location_id),
			KEY idx_container_visits_status (status),
			CONSTRAINT fk_container_visits_inbound_document
				FOREIGN KEY (inbound_document_id) REFERENCES inbound_documents (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_container_visits_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_container_visits_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS inbound_document_id BIGINT NOT NULL AFTER id`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS customer_id BIGINT NOT NULL AFTER inbound_document_id`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS location_id BIGINT NOT NULL AFTER customer_id`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL AFTER location_id`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS arrival_date DATE DEFAULT NULL AFTER container_no`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS received_at TIMESTAMP NULL DEFAULT NULL AFTER arrival_date`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED' AFTER received_at`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL DEFAULT NULL AFTER handling_mode`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'OPEN' AFTER closed_at`,
		`CREATE TABLE IF NOT EXISTS inbound_document_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			document_id BIGINT NOT NULL,
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			reorder_level INT NOT NULL DEFAULT 0,
			expected_qty INT NOT NULL DEFAULT 0,
			received_qty INT NOT NULL DEFAULT 0,
			pallets INT NOT NULL DEFAULT 0,
			units_per_pallet INT NOT NULL DEFAULT 0,
			pallets_detail_ctns VARCHAR(255) DEFAULT NULL,
			pallet_breakdown_json TEXT DEFAULT NULL,
			unit_label VARCHAR(32) DEFAULT NULL,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_inbound_document_lines_document_id (document_id),
			CONSTRAINT fk_inbound_document_lines_document
				FOREIGN KEY (document_id) REFERENCES inbound_documents (id)
				ON DELETE CASCADE
		)`,
		`ALTER TABLE inbound_document_lines ADD COLUMN IF NOT EXISTS reorder_level INT NOT NULL DEFAULT 0 AFTER storage_section`,
		`ALTER TABLE inbound_document_lines ADD COLUMN IF NOT EXISTS units_per_pallet INT NOT NULL DEFAULT 0 AFTER pallets`,
		`ALTER TABLE inbound_document_lines ADD COLUMN IF NOT EXISTS pallet_breakdown_json TEXT DEFAULT NULL AFTER pallets_detail_ctns`,
		`CREATE TABLE IF NOT EXISTS outbound_document_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			document_id BIGINT NOT NULL,
			sku_master_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			location_name_snapshot VARCHAR(160) NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			item_number_snapshot VARCHAR(120) DEFAULT NULL,
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			quantity INT NOT NULL DEFAULT 0,
			pallets INT NOT NULL DEFAULT 0,
			pallets_detail_ctns VARCHAR(255) DEFAULT NULL,
			unit_label VARCHAR(32) DEFAULT NULL,
			carton_size_mm VARCHAR(120) DEFAULT NULL,
			net_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0,
			gross_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_outbound_document_lines_document_id (document_id),
			KEY idx_outbound_document_lines_sku_master_id (sku_master_id),
			CONSTRAINT fk_outbound_document_lines_document
				FOREIGN KEY (document_id) REFERENCES outbound_documents (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_outbound_document_lines_sku_master
				FOREIGN KEY (sku_master_id) REFERENCES sku_master (id),
			CONSTRAINT fk_outbound_document_lines_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE outbound_document_lines ADD COLUMN IF NOT EXISTS sku_master_id BIGINT NULL AFTER document_id`,
		`ALTER TABLE outbound_document_lines ADD COLUMN IF NOT EXISTS item_number_snapshot VARCHAR(120) DEFAULT NULL AFTER storage_section`,
		`ALTER TABLE outbound_document_lines ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER quantity`,
		`ALTER TABLE outbound_document_lines ADD COLUMN IF NOT EXISTS pallets_detail_ctns VARCHAR(255) DEFAULT NULL AFTER pallets`,
		`CREATE TABLE IF NOT EXISTS pallets (
			id BIGINT NOT NULL AUTO_INCREMENT,
			parent_pallet_id BIGINT DEFAULT NULL,
			pallet_code VARCHAR(64) NOT NULL,
			container_visit_id BIGINT DEFAULT NULL,
			source_inbound_document_id BIGINT DEFAULT NULL,
			source_inbound_line_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			sku_master_id BIGINT NOT NULL,
			current_location_id BIGINT NOT NULL,
			current_storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			current_container_no VARCHAR(120) NOT NULL DEFAULT '',
			status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_pallets_pallet_code (pallet_code),
			KEY idx_pallets_parent_pallet_id (parent_pallet_id),
			KEY idx_pallets_container_visit_id (container_visit_id),
			KEY idx_pallets_source_inbound_line_id (source_inbound_line_id),
			KEY idx_pallets_current_location_id (current_location_id),
			KEY idx_pallets_status (status),
			CONSTRAINT fk_pallets_parent
				FOREIGN KEY (parent_pallet_id) REFERENCES pallets (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_pallets_container_visit
				FOREIGN KEY (container_visit_id) REFERENCES container_visits (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_pallets_source_document
				FOREIGN KEY (source_inbound_document_id) REFERENCES inbound_documents (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_pallets_source_line
				FOREIGN KEY (source_inbound_line_id) REFERENCES inbound_document_lines (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_pallets_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_pallets_sku_master
				FOREIGN KEY (sku_master_id) REFERENCES sku_master (id),
			CONSTRAINT fk_pallets_current_location
				FOREIGN KEY (current_location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE pallets MODIFY COLUMN source_inbound_document_id BIGINT DEFAULT NULL`,
		`ALTER TABLE pallets MODIFY COLUMN source_inbound_line_id BIGINT DEFAULT NULL`,
		`CREATE TABLE IF NOT EXISTS pallet_items (
			id BIGINT NOT NULL AUTO_INCREMENT,
			pallet_id BIGINT NOT NULL,
			sku_master_id BIGINT NOT NULL,
			quantity INT NOT NULL DEFAULT 0,
			allocated_qty INT NOT NULL DEFAULT 0,
			damaged_qty INT NOT NULL DEFAULT 0,
			hold_qty INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_pallet_items_pallet_sku (pallet_id, sku_master_id),
			KEY idx_pallet_items_sku_master_id (sku_master_id),
			CONSTRAINT fk_pallet_items_pallet
				FOREIGN KEY (pallet_id) REFERENCES pallets (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_pallet_items_sku
				FOREIGN KEY (sku_master_id) REFERENCES sku_master (id)
		)`,
		`CREATE TABLE IF NOT EXISTS stock_ledger (
			id BIGINT NOT NULL AUTO_INCREMENT,
			event_type VARCHAR(32) NOT NULL,
			pallet_id BIGINT NOT NULL,
			pallet_item_id BIGINT DEFAULT NULL,
			sku_master_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			quantity_change INT NOT NULL DEFAULT 0,
			source_document_type VARCHAR(32) DEFAULT NULL,
			source_document_id BIGINT DEFAULT NULL,
			source_line_id BIGINT DEFAULT NULL,
			container_no_snapshot VARCHAR(120) NOT NULL DEFAULT '',
			delivery_date DATE DEFAULT NULL,
			out_date DATE DEFAULT NULL,
			packing_list_no VARCHAR(120) DEFAULT NULL,
			order_ref VARCHAR(120) DEFAULT NULL,
			item_number_snapshot VARCHAR(120) DEFAULT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			expected_qty INT NOT NULL DEFAULT 0,
			received_qty INT NOT NULL DEFAULT 0,
			pallets INT NOT NULL DEFAULT 0,
			pallets_detail_ctns VARCHAR(255) DEFAULT NULL,
			carton_size_mm VARCHAR(120) DEFAULT NULL,
			carton_count INT NOT NULL DEFAULT 0,
			unit_label VARCHAR(32) DEFAULT NULL,
			net_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0,
			gross_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0,
			height_in INT NOT NULL DEFAULT 0,
			document_note VARCHAR(255) DEFAULT NULL,
			reason VARCHAR(255) DEFAULT NULL,
			reference_code VARCHAR(120) DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_stock_ledger_pallet_id (pallet_id),
			KEY idx_stock_ledger_pallet_item_id (pallet_item_id),
			KEY idx_stock_ledger_customer_id (customer_id),
			KEY idx_stock_ledger_event_type_created (event_type, created_at),
			KEY idx_stock_ledger_created_at (created_at),
			KEY idx_stock_ledger_source (source_document_type, source_document_id),
			CONSTRAINT fk_stock_ledger_pallet
				FOREIGN KEY (pallet_id) REFERENCES pallets (id),
			CONSTRAINT fk_stock_ledger_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_stock_ledger_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS outbound_picks (
			id BIGINT NOT NULL AUTO_INCREMENT,
			outbound_line_id BIGINT NOT NULL,
			pallet_id BIGINT NOT NULL,
			pallet_item_id BIGINT NOT NULL,
			picked_qty INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_outbound_picks_line_id (outbound_line_id),
			KEY idx_outbound_picks_pallet_id (pallet_id),
			KEY idx_outbound_picks_pallet_item_id (pallet_item_id),
			CONSTRAINT fk_outbound_picks_line
				FOREIGN KEY (outbound_line_id) REFERENCES outbound_document_lines (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_outbound_picks_pallet
				FOREIGN KEY (pallet_id) REFERENCES pallets (id),
			CONSTRAINT fk_outbound_picks_item
				FOREIGN KEY (pallet_item_id) REFERENCES pallet_items (id)
		)`,
		`CREATE TABLE IF NOT EXISTS pallet_location_events (
			id BIGINT NOT NULL AUTO_INCREMENT,
			pallet_id BIGINT NOT NULL,
			container_visit_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			container_no VARCHAR(120) NOT NULL DEFAULT '',
			event_type VARCHAR(32) NOT NULL,
			quantity_delta INT NOT NULL DEFAULT 0,
			pallet_delta DECIMAL(12,4) NOT NULL DEFAULT 0,
			event_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_pallet_location_events_pallet_id (pallet_id),
			KEY idx_pallet_location_events_container_visit_id (container_visit_id),
			KEY idx_pallet_location_events_location_id (location_id),
			KEY idx_pallet_location_events_event_time (event_time),
			CONSTRAINT fk_pallet_location_events_pallet
				FOREIGN KEY (pallet_id) REFERENCES pallets (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_pallet_location_events_container_visit
				FOREIGN KEY (container_visit_id) REFERENCES container_visits (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_pallet_location_events_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_pallet_location_events_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS pallet_id BIGINT NOT NULL AFTER id`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS container_visit_id BIGINT DEFAULT NULL AFTER pallet_id`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS customer_id BIGINT NOT NULL AFTER container_visit_id`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS location_id BIGINT NOT NULL AFTER customer_id`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP' AFTER location_id`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL DEFAULT '' AFTER storage_section`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(32) NOT NULL AFTER container_no`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS quantity_delta INT NOT NULL DEFAULT 0 AFTER event_type`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS pallet_delta DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER quantity_delta`,
		`ALTER TABLE pallet_location_events ADD COLUMN IF NOT EXISTS event_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER pallet_delta`,
		`ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS allocated_qty INT NOT NULL DEFAULT 0 AFTER quantity`,
		`ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS damaged_qty INT NOT NULL DEFAULT 0 AFTER allocated_qty`,
		`ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS hold_qty INT NOT NULL DEFAULT 0 AFTER damaged_qty`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS container_no_snapshot VARCHAR(120) NOT NULL DEFAULT '' AFTER source_line_id`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS delivery_date DATE DEFAULT NULL AFTER container_no_snapshot`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS out_date DATE DEFAULT NULL AFTER delivery_date`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS packing_list_no VARCHAR(120) DEFAULT NULL AFTER out_date`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS order_ref VARCHAR(120) DEFAULT NULL AFTER packing_list_no`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS item_number_snapshot VARCHAR(120) DEFAULT NULL AFTER order_ref`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS expected_qty INT NOT NULL DEFAULT 0 AFTER description_snapshot`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS received_qty INT NOT NULL DEFAULT 0 AFTER expected_qty`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER received_qty`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS pallets_detail_ctns VARCHAR(255) DEFAULT NULL AFTER pallets`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS carton_size_mm VARCHAR(120) DEFAULT NULL AFTER pallets_detail_ctns`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS carton_count INT NOT NULL DEFAULT 0 AFTER carton_size_mm`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS unit_label VARCHAR(32) DEFAULT NULL AFTER carton_count`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS net_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER unit_label`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS gross_weight_kgs DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER net_weight_kgs`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS height_in INT NOT NULL DEFAULT 0 AFTER gross_weight_kgs`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS document_note VARCHAR(255) DEFAULT NULL AFTER height_in`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS reference_code VARCHAR(120) DEFAULT NULL AFTER reason`,
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
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL,
			location_id BIGINT NOT NULL,
			location_name_snapshot VARCHAR(160) NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
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
			CONSTRAINT fk_inventory_adjustment_lines_adjustment
				FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments (id)
				ON DELETE CASCADE,
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
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL,
			from_location_id BIGINT NOT NULL,
			from_location_name_snapshot VARCHAR(160) NOT NULL,
			from_storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			to_location_id BIGINT NOT NULL,
			to_location_name_snapshot VARCHAR(160) NOT NULL,
			to_storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			quantity INT NOT NULL DEFAULT 0,
			line_note VARCHAR(255) DEFAULT NULL,
			sort_order INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_inventory_transfer_lines_transfer_id (transfer_id),
			CONSTRAINT fk_inventory_transfer_lines_transfer
				FOREIGN KEY (transfer_id) REFERENCES inventory_transfers (id)
				ON DELETE CASCADE,
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
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL,
			location_id BIGINT NOT NULL,
			location_name_snapshot VARCHAR(160) NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
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
			CONSTRAINT fk_cycle_count_lines_cycle_count
				FOREIGN KEY (cycle_count_id) REFERENCES cycle_counts (id)
				ON DELETE CASCADE,
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
		`DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply migration %q: %w", statement, err)
		}
	}

	if hasLegacyDefaultPallets, err := columnExists(db, "sku_master", "default_pallets"); err != nil {
		return fmt.Errorf("check legacy sku default pallets column: %w", err)
	} else if hasLegacyDefaultPallets {
		if _, err := db.Exec(`
			UPDATE sku_master
			SET default_units_per_pallet = default_pallets
			WHERE default_units_per_pallet = 0
				AND default_pallets > 0
		`); err != nil {
			return fmt.Errorf("backfill default units per pallet: %w", err)
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

	if hasColumn, err := columnExists(db, "outbound_document_lines", "item_id"); err != nil {
		return fmt.Errorf("check outbound line legacy item_id column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`
			UPDATE outbound_document_lines l
			JOIN inventory_items i ON i.id = l.item_id
			SET l.sku_master_id = i.sku_master_id
			WHERE (l.sku_master_id IS NULL OR l.sku_master_id = 0)
		`); err != nil {
			return fmt.Errorf("backfill outbound line sku master from legacy item: %w", err)
		}
	}

	if _, err := db.Exec(`
		UPDATE outbound_document_lines l
		JOIN sku_master sm ON sm.id = l.sku_master_id
		SET l.item_number_snapshot = COALESCE(NULLIF(l.item_number_snapshot, ''), sm.item_number)
		WHERE l.item_number_snapshot IS NULL OR l.item_number_snapshot = ''
	`); err != nil {
		return fmt.Errorf("backfill outbound line item number snapshot: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE inventory_items
		SET customer_id = (SELECT id FROM customers WHERE name = 'Unassigned')
		WHERE customer_id IS NULL OR customer_id = 0
	`); err != nil {
		return fmt.Errorf("backfill inventory item customer: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE users
		SET role = 'admin'
		WHERE role IS NULL OR role = ''
	`); err != nil {
		return fmt.Errorf("backfill user roles: %w", err)
	}

	if hasFK, err := foreignKeyExists(db, "pallets", "fk_pallets_current_item"); err != nil {
		return fmt.Errorf("check pallet current item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE pallets DROP FOREIGN KEY fk_pallets_current_item`); err != nil {
			return fmt.Errorf("drop pallet current item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "pallets", "idx_pallets_current_item_id"); err != nil {
		return fmt.Errorf("check pallet current item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE pallets DROP INDEX idx_pallets_current_item_id`); err != nil {
			return fmt.Errorf("drop pallet current item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "pallets", "current_item_id"); err != nil {
		return fmt.Errorf("check pallet current item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE pallets DROP COLUMN current_item_id`); err != nil {
			return fmt.Errorf("drop pallet current item column: %w", err)
		}
	}

	if hasTable, err := tableExists(db, "pallet_contents"); err != nil {
		return fmt.Errorf("check pallet contents table: %w", err)
	} else if hasTable {
		if _, err := db.Exec(`DROP TABLE pallet_contents`); err != nil {
			return fmt.Errorf("drop pallet contents table: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "pallet_location_events", "fk_pallet_location_events_receipt_lot"); err != nil {
		return fmt.Errorf("check pallet location receipt lot foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP FOREIGN KEY fk_pallet_location_events_receipt_lot`); err != nil {
			return fmt.Errorf("drop pallet location receipt lot foreign key: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "pallet_location_events", "fk_pallet_location_events_movement"); err != nil {
		return fmt.Errorf("check pallet location movement foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP FOREIGN KEY fk_pallet_location_events_movement`); err != nil {
			return fmt.Errorf("drop pallet location movement foreign key: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "pallet_location_events", "fk_pallet_location_events_item"); err != nil {
		return fmt.Errorf("check pallet location item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP FOREIGN KEY fk_pallet_location_events_item`); err != nil {
			return fmt.Errorf("drop pallet location item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "pallet_location_events", "idx_pallet_location_events_receipt_lot_id"); err != nil {
		return fmt.Errorf("check pallet location receipt lot index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP INDEX idx_pallet_location_events_receipt_lot_id`); err != nil {
			return fmt.Errorf("drop pallet location receipt lot index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "pallet_location_events", "idx_pallet_location_events_movement_id"); err != nil {
		return fmt.Errorf("check pallet location movement index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP INDEX idx_pallet_location_events_movement_id`); err != nil {
			return fmt.Errorf("drop pallet location movement index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "pallet_location_events", "idx_pallet_location_events_item_id"); err != nil {
		return fmt.Errorf("check pallet location item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP INDEX idx_pallet_location_events_item_id`); err != nil {
			return fmt.Errorf("drop pallet location item index: %w", err)
		}
	}

	if _, err := db.Exec(`DELETE FROM pallet_location_events WHERE pallet_id IS NULL`); err != nil {
		return fmt.Errorf("delete legacy pallet summary events: %w", err)
	}

	if hasColumn, err := columnExists(db, "pallet_location_events", "receipt_lot_id"); err != nil {
		return fmt.Errorf("check pallet location receipt lot column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP COLUMN receipt_lot_id`); err != nil {
			return fmt.Errorf("drop pallet location receipt lot column: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "pallet_location_events", "movement_id"); err != nil {
		return fmt.Errorf("check pallet location movement column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP COLUMN movement_id`); err != nil {
			return fmt.Errorf("drop pallet location movement column: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "pallet_location_events", "item_id"); err != nil {
		return fmt.Errorf("check pallet location item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE pallet_location_events DROP COLUMN item_id`); err != nil {
			return fmt.Errorf("drop pallet location item column: %w", err)
		}
	}

	if _, err := db.Exec(`ALTER TABLE pallet_location_events MODIFY COLUMN pallet_id BIGINT NOT NULL`); err != nil {
		return fmt.Errorf("normalize pallet location pallet id column: %w", err)
	}

	if hasTable, err := tableExists(db, "movement_lot_links"); err != nil {
		return fmt.Errorf("check legacy movement_lot_links table: %w", err)
	} else if hasTable {
		if _, err := db.Exec(`DROP TABLE movement_lot_links`); err != nil {
			return fmt.Errorf("drop legacy movement_lot_links table: %w", err)
		}
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

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_category"); err != nil {
		return fmt.Errorf("check inventory category index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items DROP INDEX idx_inventory_items_category`); err != nil {
			return fmt.Errorf("drop inventory category index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_sku"); err != nil {
		return fmt.Errorf("check inventory sku index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items DROP INDEX idx_inventory_items_sku`); err != nil {
			return fmt.Errorf("drop inventory sku lookup index: %w", err)
		}
	}

	if _, err := db.Exec(`UPDATE inventory_items SET container_no = '' WHERE container_no IS NULL`); err != nil {
		return fmt.Errorf("backfill inventory item containers: %w", err)
	}

	if _, err := db.Exec(`ALTER TABLE inventory_items MODIFY COLUMN container_no VARCHAR(120) NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("normalize inventory item container column: %w", err)
	}

	if _, err := db.Exec(`ALTER TABLE inventory_items ADD UNIQUE INDEX uq_inventory_item_balance (sku_master_id, location_id, storage_section, customer_id, container_no)`); err != nil {
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

	legacyMovementForeignKeys := []struct {
		table string
		name  string
	}{
		{table: "inbound_document_lines", name: "fk_inbound_document_lines_movement"},
		{table: "outbound_document_lines", name: "fk_outbound_document_lines_movement"},
		{table: "inventory_adjustment_lines", name: "fk_inventory_adjustment_lines_movement"},
		{table: "inventory_transfer_lines", name: "fk_inventory_transfer_lines_out_movement"},
		{table: "inventory_transfer_lines", name: "fk_inventory_transfer_lines_in_movement"},
		{table: "cycle_count_lines", name: "fk_cycle_count_lines_movement"},
	}
	for _, fk := range legacyMovementForeignKeys {
		hasFK, err := foreignKeyExists(db, fk.table, fk.name)
		if err != nil {
			return fmt.Errorf("check legacy movement foreign key %s on %s: %w", fk.name, fk.table, err)
		}
		if !hasFK {
			continue
		}
		if _, err := db.Exec(fmt.Sprintf("ALTER TABLE %s DROP FOREIGN KEY %s", fk.table, fk.name)); err != nil {
			return fmt.Errorf("drop legacy movement foreign key %s on %s: %w", fk.name, fk.table, err)
		}
	}

	legacyMovementIndexes := []struct {
		table string
		name  string
	}{
		{table: "inbound_document_lines", name: "idx_inbound_document_lines_movement_id"},
		{table: "outbound_document_lines", name: "idx_outbound_document_lines_movement_id"},
		{table: "inventory_adjustment_lines", name: "idx_inventory_adjustment_lines_movement_id"},
		{table: "inventory_transfer_lines", name: "idx_inventory_transfer_lines_out_movement_id"},
		{table: "inventory_transfer_lines", name: "idx_inventory_transfer_lines_in_movement_id"},
		{table: "cycle_count_lines", name: "idx_cycle_count_lines_movement_id"},
	}
	for _, idx := range legacyMovementIndexes {
		hasIndex, err := indexExists(db, idx.table, idx.name)
		if err != nil {
			return fmt.Errorf("check legacy movement index %s on %s: %w", idx.name, idx.table, err)
		}
		if !hasIndex {
			continue
		}
		if _, err := db.Exec(fmt.Sprintf("ALTER TABLE %s DROP INDEX %s", idx.table, idx.name)); err != nil {
			return fmt.Errorf("drop legacy movement index %s on %s: %w", idx.name, idx.table, err)
		}
	}

	legacyMovementColumns := []struct {
		table  string
		column string
	}{
		{table: "inbound_document_lines", column: "movement_id"},
		{table: "outbound_document_lines", column: "movement_id"},
		{table: "inventory_adjustment_lines", column: "movement_id"},
		{table: "inventory_transfer_lines", column: "transfer_out_movement_id"},
		{table: "inventory_transfer_lines", column: "transfer_in_movement_id"},
		{table: "cycle_count_lines", column: "movement_id"},
	}
	for _, col := range legacyMovementColumns {
		hasColumn, err := columnExists(db, col.table, col.column)
		if err != nil {
			return fmt.Errorf("check legacy movement column %s on %s: %w", col.column, col.table, err)
		}
		if !hasColumn {
			continue
		}
		if _, err := db.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", col.table, col.column)); err != nil {
			return fmt.Errorf("drop legacy movement column %s on %s: %w", col.column, col.table, err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "inbound_document_lines", "fk_inbound_document_lines_item"); err != nil {
		return fmt.Errorf("check inbound line item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE inbound_document_lines DROP FOREIGN KEY fk_inbound_document_lines_item`); err != nil {
			return fmt.Errorf("drop inbound line item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inbound_document_lines", "idx_inbound_document_lines_item_id"); err != nil {
		return fmt.Errorf("check inbound line item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inbound_document_lines DROP INDEX idx_inbound_document_lines_item_id`); err != nil {
			return fmt.Errorf("drop inbound line item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "inbound_document_lines", "item_id"); err != nil {
		return fmt.Errorf("check inbound line item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE inbound_document_lines DROP COLUMN item_id`); err != nil {
			return fmt.Errorf("drop inbound line item column: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "outbound_document_lines", "fk_outbound_document_lines_item"); err != nil {
		return fmt.Errorf("check outbound line item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE outbound_document_lines DROP FOREIGN KEY fk_outbound_document_lines_item`); err != nil {
			return fmt.Errorf("drop outbound line item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "outbound_document_lines", "idx_outbound_document_lines_item_id"); err != nil {
		return fmt.Errorf("check outbound line item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE outbound_document_lines DROP INDEX idx_outbound_document_lines_item_id`); err != nil {
			return fmt.Errorf("drop outbound line item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "outbound_document_lines", "item_id"); err != nil {
		return fmt.Errorf("check outbound line item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE outbound_document_lines DROP COLUMN item_id`); err != nil {
			return fmt.Errorf("drop outbound line item column: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "outbound_document_lines", "idx_outbound_document_lines_sku_master_id"); err != nil {
		return fmt.Errorf("check outbound line sku master index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE outbound_document_lines ADD INDEX idx_outbound_document_lines_sku_master_id (sku_master_id)`); err != nil {
			return fmt.Errorf("add outbound line sku master index: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "outbound_document_lines", "fk_outbound_document_lines_sku_master"); err != nil {
		return fmt.Errorf("check outbound line sku master foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`ALTER TABLE outbound_document_lines ADD CONSTRAINT fk_outbound_document_lines_sku_master FOREIGN KEY (sku_master_id) REFERENCES sku_master (id)`); err != nil {
			return fmt.Errorf("add outbound line sku master foreign key: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "inventory_transfer_lines", "fk_inventory_transfer_lines_destination_item"); err != nil {
		return fmt.Errorf("check inventory transfer destination item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE inventory_transfer_lines DROP FOREIGN KEY fk_inventory_transfer_lines_destination_item`); err != nil {
			return fmt.Errorf("drop inventory transfer destination item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_transfer_lines", "idx_inventory_transfer_lines_destination_item_id"); err != nil {
		return fmt.Errorf("check inventory transfer destination item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_transfer_lines DROP INDEX idx_inventory_transfer_lines_destination_item_id`); err != nil {
			return fmt.Errorf("drop inventory transfer destination item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "inventory_transfer_lines", "destination_item_id"); err != nil {
		return fmt.Errorf("check inventory transfer destination item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE inventory_transfer_lines DROP COLUMN destination_item_id`); err != nil {
			return fmt.Errorf("drop inventory transfer destination item column: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "inventory_transfer_lines", "fk_inventory_transfer_lines_source_item"); err != nil {
		return fmt.Errorf("check inventory transfer source item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE inventory_transfer_lines DROP FOREIGN KEY fk_inventory_transfer_lines_source_item`); err != nil {
			return fmt.Errorf("drop inventory transfer source item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_transfer_lines", "idx_inventory_transfer_lines_source_item_id"); err != nil {
		return fmt.Errorf("check inventory transfer source item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_transfer_lines DROP INDEX idx_inventory_transfer_lines_source_item_id`); err != nil {
			return fmt.Errorf("drop inventory transfer source item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "inventory_transfer_lines", "source_item_id"); err != nil {
		return fmt.Errorf("check inventory transfer source item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE inventory_transfer_lines DROP COLUMN source_item_id`); err != nil {
			return fmt.Errorf("drop inventory transfer source item column: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "inventory_adjustment_lines", "fk_inventory_adjustment_lines_item"); err != nil {
		return fmt.Errorf("check inventory adjustment item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE inventory_adjustment_lines DROP FOREIGN KEY fk_inventory_adjustment_lines_item`); err != nil {
			return fmt.Errorf("drop inventory adjustment item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "inventory_adjustment_lines", "idx_inventory_adjustment_lines_item_id"); err != nil {
		return fmt.Errorf("check inventory adjustment item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_adjustment_lines DROP INDEX idx_inventory_adjustment_lines_item_id`); err != nil {
			return fmt.Errorf("drop inventory adjustment item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "inventory_adjustment_lines", "item_id"); err != nil {
		return fmt.Errorf("check inventory adjustment item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE inventory_adjustment_lines DROP COLUMN item_id`); err != nil {
			return fmt.Errorf("drop inventory adjustment item column: %w", err)
		}
	}

	if hasFK, err := foreignKeyExists(db, "cycle_count_lines", "fk_cycle_count_lines_item"); err != nil {
		return fmt.Errorf("check cycle count item foreign key: %w", err)
	} else if hasFK {
		if _, err := db.Exec(`ALTER TABLE cycle_count_lines DROP FOREIGN KEY fk_cycle_count_lines_item`); err != nil {
			return fmt.Errorf("drop cycle count item foreign key: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "cycle_count_lines", "idx_cycle_count_lines_item_id"); err != nil {
		return fmt.Errorf("check cycle count item index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE cycle_count_lines DROP INDEX idx_cycle_count_lines_item_id`); err != nil {
			return fmt.Errorf("drop cycle count item index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "cycle_count_lines", "item_id"); err != nil {
		return fmt.Errorf("check cycle count item column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE cycle_count_lines DROP COLUMN item_id`); err != nil {
			return fmt.Errorf("drop cycle count item column: %w", err)
		}
	}

	if err := dropForeignKeysReferencingTable(db, "receipt_lots"); err != nil {
		return fmt.Errorf("drop foreign keys referencing legacy receipt_lots: %w", err)
	}

	if hasIndex, err := indexExists(db, "pallets", "idx_pallets_source_receipt_lot_id"); err != nil {
		return fmt.Errorf("check pallet source receipt lot index: %w", err)
	} else if hasIndex {
		if _, err := db.Exec(`ALTER TABLE pallets DROP INDEX idx_pallets_source_receipt_lot_id`); err != nil {
			return fmt.Errorf("drop pallet source receipt lot index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "pallets", "source_receipt_lot_id"); err != nil {
		return fmt.Errorf("check pallet source receipt lot column: %w", err)
	} else if hasColumn {
		if _, err := db.Exec(`ALTER TABLE pallets DROP COLUMN source_receipt_lot_id`); err != nil {
			return fmt.Errorf("drop pallet source receipt lot column: %w", err)
		}
	}

	if hasTable, err := tableExists(db, "receipt_lots"); err != nil {
		return fmt.Errorf("check legacy receipt_lots table: %w", err)
	} else if hasTable {
		if _, err := db.Exec(`DROP TABLE receipt_lots`); err != nil {
			return fmt.Errorf("drop legacy receipt_lots table: %w", err)
		}
	}

	if hasTable, err := tableExists(db, "outbound_pick_allocations"); err != nil {
		return fmt.Errorf("check legacy outbound_pick_allocations table: %w", err)
	} else if hasTable {
		if _, err := db.Exec(`DROP TABLE outbound_pick_allocations`); err != nil {
			return fmt.Errorf("drop legacy outbound_pick_allocations table: %w", err)
		}
	}

	if hasTable, err := tableExists(db, "stock_movements"); err != nil {
		return fmt.Errorf("check legacy stock_movements table: %w", err)
	} else if hasTable {
		if _, err := db.Exec(`DROP TABLE stock_movements`); err != nil {
			return fmt.Errorf("drop legacy stock_movements table: %w", err)
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

func columnExists(db *sql.DB, tableName string, columnName string) (bool, error) {
	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.columns
		WHERE table_schema = DATABASE()
			AND table_name = ?
			AND column_name = ?
	`, tableName, columnName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func tableExists(db *sql.DB, tableName string) (bool, error) {
	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.tables
		WHERE table_schema = DATABASE()
			AND table_name = ?
	`, tableName).Scan(&count); err != nil {
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

func dropForeignKeysReferencingTable(db *sql.DB, referencedTable string) error {
	rows, err := db.Query(`
		SELECT table_name, constraint_name
		FROM information_schema.key_column_usage
		WHERE table_schema = DATABASE()
			AND referenced_table_name = ?
		GROUP BY table_name, constraint_name
	`, referencedTable)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var tableName string
		var constraintName string
		if err := rows.Scan(&tableName, &constraintName); err != nil {
			return err
		}
		statement := fmt.Sprintf(
			"ALTER TABLE `%s` DROP FOREIGN KEY `%s`",
			strings.ReplaceAll(tableName, "`", "``"),
			strings.ReplaceAll(constraintName, "`", "``"),
		)
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}

	return rows.Err()
}

func isDuplicateIndexError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "Duplicate key name") || strings.Contains(err.Error(), "already exists"))
}
