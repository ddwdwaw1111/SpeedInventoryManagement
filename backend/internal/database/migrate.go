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
			customer_id BIGINT DEFAULT NULL,
			password_salt CHAR(32) NOT NULL,
			password_hash CHAR(64) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_users_email (email),
			KEY idx_users_customer_id (customer_id)
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
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id BIGINT DEFAULT NULL AFTER is_active`,
		`CREATE INDEX IF NOT EXISTS idx_users_customer_id ON users (customer_id)`,
		`ALTER TABLE users MODIFY COLUMN password_salt VARCHAR(32) NOT NULL DEFAULT ''`,
		`ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NOT NULL`,
		`CREATE TABLE IF NOT EXISTS sku_master (
			id BIGINT NOT NULL AUTO_INCREMENT,
			item_number VARCHAR(120) DEFAULT NULL,
			ama_item_number VARCHAR(120) DEFAULT NULL,
			sku VARCHAR(64) NOT NULL,
			name VARCHAR(160) NOT NULL,
			category VARCHAR(120) NOT NULL,
			description TEXT DEFAULT NULL,
			upc VARCHAR(64) DEFAULT NULL,
			unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
			default_units_per_pallet INT NOT NULL DEFAULT 0,
			case_size_mm VARCHAR(120) DEFAULT NULL,
			cases_per_pallet INT NOT NULL DEFAULT 0,
			cartons_per_layer INT NOT NULL DEFAULT 0,
			layers_per_pallet INT NOT NULL DEFAULT 0,
			pallet_length_mm INT NOT NULL DEFAULT 0,
			pallet_width_mm INT NOT NULL DEFAULT 0,
			pallet_height_mm INT NOT NULL DEFAULT 0,
			picture_url VARCHAR(512) DEFAULT NULL,
			full_face_photo_url VARCHAR(512) DEFAULT NULL,
			side_photo_url VARCHAR(512) DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_sku_master_sku (sku)
		)`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS item_number VARCHAR(120) DEFAULT NULL AFTER id`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS ama_item_number VARCHAR(120) DEFAULT NULL AFTER item_number`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS upc VARCHAR(64) DEFAULT NULL AFTER description`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS default_units_per_pallet INT NOT NULL DEFAULT 0 AFTER unit`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS case_size_mm VARCHAR(120) DEFAULT NULL AFTER default_units_per_pallet`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS cases_per_pallet INT NOT NULL DEFAULT 0 AFTER case_size_mm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS cartons_per_layer INT NOT NULL DEFAULT 0 AFTER cases_per_pallet`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS layers_per_pallet INT NOT NULL DEFAULT 0 AFTER cartons_per_layer`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS pallet_length_mm INT NOT NULL DEFAULT 0 AFTER layers_per_pallet`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS pallet_width_mm INT NOT NULL DEFAULT 0 AFTER pallet_length_mm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS pallet_height_mm INT NOT NULL DEFAULT 0 AFTER pallet_width_mm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS picture_url VARCHAR(512) DEFAULT NULL AFTER pallet_height_mm`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS full_face_photo_url VARCHAR(512) DEFAULT NULL AFTER picture_url`,
		`ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS side_photo_url VARCHAR(512) DEFAULT NULL AFTER full_face_photo_url`,
		`ALTER TABLE sku_master DROP COLUMN IF EXISTS reorder_level`,
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
		`CREATE TABLE IF NOT EXISTS billing_invoice_settings (
			id TINYINT NOT NULL DEFAULT 1,
			seller_name VARCHAR(160) NOT NULL DEFAULT '',
			subtitle VARCHAR(160) NOT NULL DEFAULT '',
			remit_to TEXT NOT NULL,
			terms VARCHAR(64) NOT NULL DEFAULT '',
			payment_due_days INT NOT NULL DEFAULT 0,
			payment_instructions TEXT NOT NULL,
			updated_by_user_id BIGINT DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_items (
			id BIGINT NOT NULL AUTO_INCREMENT,
			sku_master_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			quantity INT NOT NULL DEFAULT 0,
			pallets INT NOT NULL DEFAULT 0,
			allocated_qty INT NOT NULL DEFAULT 0,
			damaged_qty INT NOT NULL DEFAULT 0,
			hold_qty INT NOT NULL DEFAULT 0,
			delivery_date DATE DEFAULT NULL,
			container_id BIGINT NOT NULL DEFAULT 0,
			container_no VARCHAR(120) NOT NULL DEFAULT '',
			last_restocked_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_inventory_item_balance (sku_master_id, location_id, storage_section, customer_id, container_id),
			KEY idx_inventory_items_location_id (location_id),
			KEY idx_inventory_items_sku_master_id (sku_master_id),
			KEY idx_inventory_items_customer_id (customer_id),
			KEY idx_inventory_items_container_id (container_id),
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
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 0 AFTER storage_section`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER quantity`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS allocated_qty INT NOT NULL DEFAULT 0 AFTER pallets`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS damaged_qty INT NOT NULL DEFAULT 0 AFTER allocated_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS hold_qty INT NOT NULL DEFAULT 0 AFTER damaged_qty`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_id BIGINT NOT NULL DEFAULT 0 AFTER delivery_date`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL DEFAULT '' AFTER delivery_date`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMP NULL DEFAULT NULL AFTER container_no`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS item_number`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS sku`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS name`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS category`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS description`,
		`ALTER TABLE inventory_items DROP COLUMN IF EXISTS unit`,
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
			expected_ship_date DATE DEFAULT NULL,
			actual_ship_date DATE DEFAULT NULL,
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
			KEY idx_outbound_documents_expected_ship_date (expected_ship_date),
			KEY idx_outbound_documents_packing_list_no (packing_list_no),
			CONSTRAINT fk_outbound_documents_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id)
		)`,
		`ALTER TABLE outbound_documents CHANGE COLUMN IF EXISTS out_date expected_ship_date DATE DEFAULT NULL`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS expected_ship_date DATE DEFAULT NULL AFTER customer_id`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS actual_ship_date DATE DEFAULT NULL AFTER expected_ship_date`,
		`ALTER TABLE outbound_documents DROP INDEX IF EXISTS idx_outbound_documents_out_date`,
		`CREATE INDEX IF NOT EXISTS idx_outbound_documents_expected_ship_date ON outbound_documents (expected_ship_date)`,
		`ALTER TABLE outbound_documents ADD COLUMN IF NOT EXISTS ship_to_name VARCHAR(160) DEFAULT NULL AFTER actual_ship_date`,
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
			expected_arrival_date DATE DEFAULT NULL,
			actual_arrival_date DATE DEFAULT NULL,
			container_id BIGINT NOT NULL DEFAULT 0,
			container_no VARCHAR(120) DEFAULT NULL,
			container_type VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
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
			KEY idx_inbound_documents_expected_arrival_date (expected_arrival_date),
			KEY idx_inbound_documents_container_id (container_id),
			KEY idx_inbound_documents_container_no (container_no),
			CONSTRAINT fk_inbound_documents_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_inbound_documents_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE inbound_documents MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED'`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED' AFTER container_no`,
		`ALTER TABLE inbound_documents CHANGE COLUMN IF EXISTS delivery_date expected_arrival_date DATE DEFAULT NULL`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS expected_arrival_date DATE DEFAULT NULL AFTER location_id`,
		`ALTER TABLE inbound_documents DROP INDEX IF EXISTS idx_inbound_documents_delivery_date`,
		`CREATE INDEX IF NOT EXISTS idx_inbound_documents_expected_arrival_date ON inbound_documents (expected_arrival_date)`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS actual_arrival_date DATE DEFAULT NULL AFTER expected_arrival_date`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS container_id BIGINT NOT NULL DEFAULT 0 AFTER actual_arrival_date`,
		`CREATE INDEX IF NOT EXISTS idx_inbound_documents_container_id ON inbound_documents (container_id)`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS container_type VARCHAR(32) NOT NULL DEFAULT 'NORMAL' AFTER container_no`,
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
		`CREATE TABLE IF NOT EXISTS containers (
			id BIGINT NOT NULL AUTO_INCREMENT,
			customer_id BIGINT NOT NULL,
			inbound_document_id BIGINT DEFAULT NULL,
			location_id BIGINT DEFAULT NULL,
			packing_list_no VARCHAR(120) NOT NULL DEFAULT '',
			container_no VARCHAR(120) NOT NULL,
			container_type VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
			handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED',
			status VARCHAR(32) NOT NULL DEFAULT 'TRACKING_RECEIVED',
			tracking_status VARCHAR(32) NOT NULL DEFAULT 'TRACKING_RECEIVED',
			last_event_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_containers_customer_container_no (customer_id, container_no),
			KEY idx_containers_customer_packing_list_no (customer_id, packing_list_no),
			KEY idx_containers_customer_id (customer_id),
			KEY idx_containers_inbound_document_id (inbound_document_id),
			KEY idx_containers_location_id (location_id),
			KEY idx_containers_status (status),
			CONSTRAINT fk_containers_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_containers_inbound_document
				FOREIGN KEY (inbound_document_id) REFERENCES inbound_documents (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_containers_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
				ON DELETE SET NULL
		)`,
		`ALTER TABLE containers ADD COLUMN IF NOT EXISTS packing_list_no VARCHAR(120) NOT NULL DEFAULT '' AFTER location_id`,
		`ALTER TABLE containers DROP INDEX IF EXISTS uq_containers_customer_container_no`,
		`CREATE INDEX IF NOT EXISTS idx_containers_customer_container_no ON containers (customer_id, container_no)`,
		`CREATE INDEX IF NOT EXISTS idx_containers_customer_packing_list_no ON containers (customer_id, packing_list_no)`,
		`INSERT INTO containers (
			customer_id,
			inbound_document_id,
			location_id,
			packing_list_no,
			container_no,
			container_type,
			handling_mode,
			status,
			tracking_status,
			last_event_at
		)
		SELECT
			d.customer_id,
			d.id,
			d.location_id,
			'',
			UPPER(TRIM(d.container_no)),
			COALESCE(NULLIF(d.container_type, ''), 'NORMAL'),
			COALESCE(NULLIF(d.handling_mode, ''), 'PALLETIZED'),
			'IN_STOCK',
			COALESCE(NULLIF(d.tracking_status, ''), 'RECEIVED'),
			COALESCE(d.posted_at, d.confirmed_at, d.actual_arrival_date, d.expected_arrival_date, d.created_at)
		FROM inbound_documents d
		LEFT JOIN containers existing_doc
			ON existing_doc.inbound_document_id = d.id
		WHERE COALESCE(d.container_id, 0) = 0
			AND existing_doc.id IS NULL
			AND COALESCE(TRIM(d.container_no), '') <> ''`,
		`UPDATE inbound_documents d
			JOIN containers cn
				ON cn.inbound_document_id = d.id
				AND cn.customer_id = d.customer_id
			SET d.container_id = cn.id
			WHERE COALESCE(d.container_id, 0) = 0`,
		`CREATE TABLE IF NOT EXISTS container_lifecycle_nodes (
			id BIGINT NOT NULL AUTO_INCREMENT,
			container_id BIGINT NOT NULL,
			parent_node_id BIGINT DEFAULT NULL,
			node_key VARCHAR(120) NOT NULL,
			node_kind VARCHAR(32) NOT NULL,
			title VARCHAR(190) DEFAULT NULL,
			source_type VARCHAR(32) DEFAULT NULL,
			source_id BIGINT NOT NULL DEFAULT 0,
			visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH',
			sort_order INT NOT NULL DEFAULT 0,
			position_x DOUBLE DEFAULT NULL,
			position_y DOUBLE DEFAULT NULL,
			metadata_json JSON DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_container_lifecycle_node_key (container_id, node_key),
			KEY idx_container_lifecycle_nodes_container_order (container_id, sort_order, id),
			KEY idx_container_lifecycle_nodes_parent (parent_node_id),
			KEY idx_container_lifecycle_nodes_source (source_type, source_id),
			CONSTRAINT fk_container_lifecycle_nodes_container
				FOREIGN KEY (container_id) REFERENCES containers (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_container_lifecycle_nodes_parent
				FOREIGN KEY (parent_node_id) REFERENCES container_lifecycle_nodes (id)
				ON DELETE SET NULL
		)`,
		`CREATE TABLE IF NOT EXISTS container_tracking_events (
			id BIGINT NOT NULL AUTO_INCREMENT,
			container_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			container_no VARCHAR(120) NOT NULL,
			event_type VARCHAR(64) NOT NULL,
			event_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			location VARCHAR(160) DEFAULT NULL,
			notes TEXT DEFAULT NULL,
			visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH',
			public_status VARCHAR(64) DEFAULT NULL,
			public_label VARCHAR(190) DEFAULT NULL,
			internal_status VARCHAR(64) DEFAULT NULL,
			internal_label VARCHAR(255) DEFAULT NULL,
			created_by_user_id BIGINT DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_container_tracking_container_id (container_id),
			KEY idx_container_tracking_customer_container_time (customer_id, container_no, event_time, id),
			KEY idx_container_tracking_event_type (event_type),
			CONSTRAINT fk_container_tracking_container
				FOREIGN KEY (container_id) REFERENCES containers (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_container_tracking_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_container_tracking_created_by
				FOREIGN KEY (created_by_user_id) REFERENCES users (id)
				ON DELETE SET NULL
		)`,
		`ALTER TABLE container_tracking_events ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH' AFTER notes`,
		`ALTER TABLE container_tracking_events ADD COLUMN IF NOT EXISTS public_status VARCHAR(64) DEFAULT NULL AFTER visibility`,
		`ALTER TABLE container_tracking_events ADD COLUMN IF NOT EXISTS public_label VARCHAR(190) DEFAULT NULL AFTER public_status`,
		`ALTER TABLE container_tracking_events ADD COLUMN IF NOT EXISTS internal_status VARCHAR(64) DEFAULT NULL AFTER public_label`,
		`ALTER TABLE container_tracking_events ADD COLUMN IF NOT EXISTS internal_label VARCHAR(255) DEFAULT NULL AFTER internal_status`,
		`CREATE TABLE IF NOT EXISTS container_pickup_assignments (
			id BIGINT NOT NULL AUTO_INCREMENT,
			container_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			container_no VARCHAR(120) NOT NULL,
			assignment_type VARCHAR(32) NOT NULL DEFAULT 'INTERNAL',
			driver_name VARCHAR(160) DEFAULT NULL,
			vendor_name VARCHAR(160) DEFAULT NULL,
			phone VARCHAR(64) DEFAULT NULL,
			scheduled_pickup_at TIMESTAMP NULL DEFAULT NULL,
			actual_pickup_at TIMESTAMP NULL DEFAULT NULL,
			cost DECIMAL(12,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
			notes TEXT DEFAULT NULL,
			visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH',
			public_status VARCHAR(64) DEFAULT NULL,
			public_label VARCHAR(190) DEFAULT NULL,
			internal_status VARCHAR(64) DEFAULT NULL,
			internal_label VARCHAR(255) DEFAULT NULL,
			created_by_user_id BIGINT DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_container_pickup_container_id (container_id),
			KEY idx_container_pickup_customer_container (customer_id, container_no),
			KEY idx_container_pickup_status (status),
			CONSTRAINT fk_container_pickup_container
				FOREIGN KEY (container_id) REFERENCES containers (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_container_pickup_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_container_pickup_created_by
				FOREIGN KEY (created_by_user_id) REFERENCES users (id)
				ON DELETE SET NULL
		)`,
		`ALTER TABLE container_pickup_assignments ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH' AFTER notes`,
		`ALTER TABLE container_pickup_assignments ADD COLUMN IF NOT EXISTS public_status VARCHAR(64) DEFAULT NULL AFTER visibility`,
		`ALTER TABLE container_pickup_assignments ADD COLUMN IF NOT EXISTS public_label VARCHAR(190) DEFAULT NULL AFTER public_status`,
		`ALTER TABLE container_pickup_assignments ADD COLUMN IF NOT EXISTS internal_status VARCHAR(64) DEFAULT NULL AFTER public_label`,
		`ALTER TABLE container_pickup_assignments ADD COLUMN IF NOT EXISTS internal_label VARCHAR(255) DEFAULT NULL AFTER internal_status`,
		`CREATE TABLE IF NOT EXISTS container_visits (
			id BIGINT NOT NULL AUTO_INCREMENT,
			inbound_document_id BIGINT NOT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			container_no VARCHAR(120) NOT NULL,
			arrival_date DATE DEFAULT NULL,
			received_at TIMESTAMP NULL DEFAULT NULL,
			container_type VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
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
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS container_type VARCHAR(32) NOT NULL DEFAULT 'NORMAL' AFTER received_at`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS handling_mode VARCHAR(32) NOT NULL DEFAULT 'PALLETIZED' AFTER received_at`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL DEFAULT NULL AFTER handling_mode`,
		`ALTER TABLE container_visits ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'OPEN' AFTER closed_at`,
		`CREATE TABLE IF NOT EXISTS inbound_document_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			document_id BIGINT NOT NULL,
			sku_snapshot VARCHAR(64) NOT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
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
		`ALTER TABLE inbound_document_lines DROP COLUMN IF EXISTS reorder_level`,
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
			pick_allocations_json TEXT DEFAULT NULL,
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
		`ALTER TABLE outbound_document_lines ADD COLUMN IF NOT EXISTS pick_allocations_json TEXT DEFAULT NULL AFTER pallets_detail_ctns`,
		`ALTER TABLE outbound_document_lines DROP COLUMN IF EXISTS pick_pallets_json`,
		`CREATE TABLE IF NOT EXISTS document_attachments (
			id BIGINT NOT NULL AUTO_INCREMENT,
			document_type VARCHAR(16) NOT NULL,
			document_id BIGINT NOT NULL,
			display_name VARCHAR(190) NOT NULL,
			original_file_name VARCHAR(255) DEFAULT NULL,
			storage_provider VARCHAR(32) NOT NULL DEFAULT 'r2',
			storage_bucket VARCHAR(255) NOT NULL,
			storage_key VARCHAR(512) NOT NULL,
			content_type VARCHAR(120) NOT NULL,
			size_bytes BIGINT NOT NULL DEFAULT 0,
			uploaded_by_user_id BIGINT DEFAULT NULL,
			deleted_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_document_attachments_storage_key (storage_provider, storage_bucket, storage_key),
			KEY idx_document_attachments_document (document_type, document_id),
			KEY idx_document_attachments_uploaded_by (uploaded_by_user_id),
			CONSTRAINT fk_document_attachments_user
				FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id)
				ON DELETE SET NULL
		)`,
		`ALTER TABLE document_attachments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL DEFAULT NULL AFTER uploaded_by_user_id`,
		`CREATE INDEX IF NOT EXISTS idx_document_attachments_document ON document_attachments (document_type, document_id)`,
		`CREATE TABLE IF NOT EXISTS stock_ledger (
			id BIGINT NOT NULL AUTO_INCREMENT,
			event_type VARCHAR(32) NOT NULL,
			occurred_at TIMESTAMP NULL DEFAULT NULL,
			sku_master_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			quantity_change INT NOT NULL DEFAULT 0,
			source_document_type VARCHAR(32) DEFAULT NULL,
			source_document_id BIGINT DEFAULT NULL,
			source_line_id BIGINT DEFAULT NULL,
			container_id BIGINT NOT NULL DEFAULT 0,
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
			KEY idx_stock_ledger_customer_id (customer_id),
			KEY idx_stock_ledger_container_id (container_id),
			KEY idx_stock_ledger_event_type_created (event_type, created_at),
			KEY idx_stock_ledger_created_at (created_at),
			KEY idx_stock_ledger_source (source_document_type, source_document_id),
			CONSTRAINT fk_stock_ledger_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_stock_ledger_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`CREATE TABLE IF NOT EXISTS container_lifecycle_events (
			id BIGINT NOT NULL AUTO_INCREMENT,
			stock_ledger_id BIGINT DEFAULT NULL,
			customer_id BIGINT NOT NULL,
			location_id BIGINT NOT NULL,
			storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP',
			container_no VARCHAR(120) NOT NULL,
			event_type VARCHAR(32) NOT NULL,
			event_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			quantity_delta INT NOT NULL DEFAULT 0,
			sku_master_id BIGINT DEFAULT NULL,
			source_document_type VARCHAR(32) DEFAULT NULL,
			source_document_id BIGINT DEFAULT NULL,
			source_line_id BIGINT DEFAULT NULL,
			packing_list_no VARCHAR(120) DEFAULT NULL,
			order_ref VARCHAR(120) DEFAULT NULL,
			item_number_snapshot VARCHAR(120) DEFAULT NULL,
			description_snapshot VARCHAR(255) DEFAULT NULL,
			expected_qty INT NOT NULL DEFAULT 0,
			received_qty INT NOT NULL DEFAULT 0,
			pallets INT NOT NULL DEFAULT 0,
			document_note VARCHAR(255) DEFAULT NULL,
			reason VARCHAR(255) DEFAULT NULL,
			reference_code VARCHAR(120) DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_container_lifecycle_stock_ledger (stock_ledger_id),
			KEY idx_container_lifecycle_customer_container_time (customer_id, container_no, event_time, id),
			KEY idx_container_lifecycle_source (source_document_type, source_document_id),
			KEY idx_container_lifecycle_event_type (event_type),
			CONSTRAINT fk_container_lifecycle_stock_ledger
				FOREIGN KEY (stock_ledger_id) REFERENCES stock_ledger (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_container_lifecycle_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_container_lifecycle_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
		)`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS container_id BIGINT NOT NULL DEFAULT 0 AFTER source_line_id`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS container_no_snapshot VARCHAR(120) NOT NULL DEFAULT '' AFTER source_line_id`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP NULL DEFAULT NULL AFTER event_type`,
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
		`INSERT INTO container_lifecycle_events (
			stock_ledger_id,
			customer_id,
			location_id,
			storage_section,
			container_no,
			event_type,
			event_time,
			quantity_delta,
			sku_master_id,
			source_document_type,
			source_document_id,
			source_line_id,
			packing_list_no,
			order_ref,
			item_number_snapshot,
			description_snapshot,
			expected_qty,
			received_qty,
			pallets,
			document_note,
			reason,
			reference_code,
			created_at
		)
		SELECT
			sl.id,
			sl.customer_id,
			sl.location_id,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP'),
			COALESCE(NULLIF(sl.container_no_snapshot, ''), idoc.container_no, ''),
			sl.event_type,
			COALESCE(
				sl.occurred_at,
				CASE
					WHEN sl.event_type = 'RECEIVE' THEN COALESCE(sl.delivery_date, idoc.actual_arrival_date, idoc.expected_arrival_date)
					WHEN sl.event_type IN ('SHIP', 'REVERSAL') THEN COALESCE(sl.out_date, odoc.actual_ship_date, odoc.expected_ship_date)
					ELSE NULL
				END,
				sl.created_at
			),
			sl.quantity_change,
			sl.sku_master_id,
			sl.source_document_type,
			sl.source_document_id,
			sl.source_line_id,
			COALESCE(NULLIF(sl.packing_list_no, ''), odoc.packing_list_no),
			COALESCE(NULLIF(sl.order_ref, ''), odoc.order_ref),
			sl.item_number_snapshot,
			sl.description_snapshot,
			sl.expected_qty,
			sl.received_qty,
			sl.pallets,
			COALESCE(NULLIF(sl.document_note, ''), idoc.document_note, odoc.document_note),
			sl.reason,
			sl.reference_code,
			sl.created_at
		FROM stock_ledger sl
		LEFT JOIN inbound_documents idoc
			ON sl.source_document_type = 'INBOUND' AND sl.source_document_id = idoc.id
		LEFT JOIN outbound_documents odoc
			ON sl.source_document_type = 'OUTBOUND' AND sl.source_document_id = odoc.id
		WHERE COALESCE(NULLIF(sl.container_no_snapshot, ''), idoc.container_no, '') <> ''
			AND NOT EXISTS (
				SELECT 1
				FROM container_lifecycle_events cle
				WHERE cle.stock_ledger_id = sl.id
			)`,
		`CREATE TABLE IF NOT EXISTS delivery_events (
			id BIGINT NOT NULL AUTO_INCREMENT,
			outbound_document_id BIGINT DEFAULT NULL,
			customer_id BIGINT DEFAULT NULL,
			container_id BIGINT NOT NULL DEFAULT 0,
			container_no VARCHAR(120) NOT NULL DEFAULT '',
			event_type VARCHAR(64) NOT NULL,
			event_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			driver_name VARCHAR(160) DEFAULT NULL,
			vendor_name VARCHAR(160) DEFAULT NULL,
			vehicle_no VARCHAR(64) DEFAULT NULL,
			bol_number VARCHAR(120) DEFAULT NULL,
			bol_received_at TIMESTAMP NULL DEFAULT NULL,
			notes TEXT DEFAULT NULL,
			visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH',
			public_status VARCHAR(64) DEFAULT NULL,
			public_label VARCHAR(190) DEFAULT NULL,
			internal_status VARCHAR(64) DEFAULT NULL,
			internal_label VARCHAR(255) DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_delivery_events_outbound_document_id (outbound_document_id),
			KEY idx_delivery_events_container_id (container_id),
			KEY idx_delivery_events_customer_container_time (customer_id, container_no, event_time, id),
			KEY idx_delivery_events_event_type (event_type),
			KEY idx_delivery_events_bol_number (bol_number),
			CONSTRAINT fk_delivery_events_outbound_document
				FOREIGN KEY (outbound_document_id) REFERENCES outbound_documents (id)
				ON DELETE SET NULL,
			CONSTRAINT fk_delivery_events_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id)
				ON DELETE SET NULL
		)`,
		`ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS container_id BIGINT NOT NULL DEFAULT 0 AFTER customer_id`,
		`CREATE INDEX IF NOT EXISTS idx_delivery_events_container_id ON delivery_events (container_id)`,
		`ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'BOTH' AFTER notes`,
		`ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS public_status VARCHAR(64) DEFAULT NULL AFTER visibility`,
		`ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS public_label VARCHAR(190) DEFAULT NULL AFTER public_status`,
		`ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS internal_status VARCHAR(64) DEFAULT NULL AFTER public_label`,
		`ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS internal_label VARCHAR(255) DEFAULT NULL AFTER internal_status`,
		`CREATE TABLE IF NOT EXISTS inventory_adjustments (
			id BIGINT NOT NULL AUTO_INCREMENT,
			adjustment_no VARCHAR(120) NOT NULL,
			reason_code VARCHAR(64) NOT NULL,
			actual_adjusted_at TIMESTAMP NULL DEFAULT NULL,
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
			pallet_before_qty INT NOT NULL DEFAULT 0,
			pallet_after_qty INT NOT NULL DEFAULT 0,
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
		`ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS actual_adjusted_at TIMESTAMP NULL DEFAULT NULL AFTER reason_code`,
		`ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS pallet_before_qty INT NOT NULL DEFAULT 0 AFTER after_qty`,
		`ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS pallet_after_qty INT NOT NULL DEFAULT 0 AFTER pallet_before_qty`,
		`CREATE TABLE IF NOT EXISTS inventory_transfers (
			id BIGINT NOT NULL AUTO_INCREMENT,
			transfer_no VARCHAR(120) NOT NULL,
			actual_transferred_at TIMESTAMP NULL DEFAULT NULL,
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
			pallets INT NOT NULL DEFAULT 0,
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
		`ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS actual_transferred_at TIMESTAMP NULL DEFAULT NULL AFTER transfer_no`,
		`ALTER TABLE inventory_transfer_lines ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER quantity`,
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
		`CREATE TABLE IF NOT EXISTS billing_invoices (
			id BIGINT NOT NULL AUTO_INCREMENT,
			invoice_no VARCHAR(64) NOT NULL,
			invoice_type VARCHAR(32) NOT NULL DEFAULT 'MIXED',
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL DEFAULT '',
			warehouse_location_id BIGINT DEFAULT NULL,
			warehouse_name_snapshot VARCHAR(160) DEFAULT NULL,
			container_type VARCHAR(32) DEFAULT NULL,
			period_start DATE NOT NULL,
			period_end DATE NOT NULL,
			currency_code VARCHAR(8) NOT NULL DEFAULT 'USD',
			rates_json JSON NOT NULL,
			header_json JSON DEFAULT NULL,
			subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
			discount_total DECIMAL(12,2) NOT NULL DEFAULT 0,
			grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
			notes TEXT DEFAULT NULL,
			finalized_at TIMESTAMP NULL DEFAULT NULL,
			finalized_by_user_id BIGINT DEFAULT NULL,
			paid_at TIMESTAMP NULL DEFAULT NULL,
			voided_at TIMESTAMP NULL DEFAULT NULL,
			created_by_user_id BIGINT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_billing_invoices_invoice_no (invoice_no),
			KEY idx_billing_invoices_customer_id (customer_id),
			KEY idx_billing_invoices_status (status),
			KEY idx_billing_invoices_period (period_start, period_end),
			KEY idx_billing_invoices_warehouse_location_id (warehouse_location_id),
			KEY idx_billing_invoices_container_type (container_type),
			KEY idx_billing_invoices_customer_period_type_status (customer_id, period_start, period_end, invoice_type, status),
			CONSTRAINT fk_billing_invoices_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id),
			CONSTRAINT fk_billing_invoices_created_by
				FOREIGN KEY (created_by_user_id) REFERENCES users (id)
		)`,
		`CREATE TABLE IF NOT EXISTS billing_invoice_lines (
			id BIGINT NOT NULL AUTO_INCREMENT,
			invoice_id BIGINT NOT NULL,
			charge_type VARCHAR(32) NOT NULL,
			description VARCHAR(255) NOT NULL DEFAULT '',
			reference VARCHAR(255) DEFAULT NULL,
			container_no VARCHAR(120) DEFAULT NULL,
			warehouse VARCHAR(160) DEFAULT NULL,
			occurred_on DATE DEFAULT NULL,
			quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
			unit_rate DECIMAL(12,4) NOT NULL DEFAULT 0,
			amount DECIMAL(12,2) NOT NULL DEFAULT 0,
			notes VARCHAR(255) DEFAULT NULL,
			details_json JSON DEFAULT NULL,
			source_type VARCHAR(16) NOT NULL DEFAULT 'AUTO',
			sort_order INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_billing_invoice_lines_invoice_id (invoice_id),
			CONSTRAINT fk_billing_invoice_lines_invoice
				FOREIGN KEY (invoice_id) REFERENCES billing_invoices (id)
				ON DELETE CASCADE
		)`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply migration %q: %w", statement, err)
		}
	}

	if _, err := db.Exec(`DROP TABLE IF EXISTS cycle_count_lines`); err != nil {
		return fmt.Errorf("drop legacy cycle count lines table: %w", err)
	}
	if _, err := db.Exec(`DROP TABLE IF EXISTS cycle_counts`); err != nil {
		return fmt.Errorf("drop legacy cycle counts table: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE users u
		LEFT JOIN customers c ON c.id = u.customer_id
		SET u.customer_id = NULL
		WHERE u.customer_id IS NOT NULL
			AND c.id IS NULL
	`); err != nil {
		return fmt.Errorf("clear orphaned user customer assignments: %w", err)
	}

	if hasFK, err := foreignKeyExists(db, "users", "fk_users_customer"); err != nil {
		return fmt.Errorf("check users customer foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`
			ALTER TABLE users
			ADD CONSTRAINT fk_users_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id)
		`); err != nil {
			return fmt.Errorf("add users customer foreign key: %w", err)
		}
	}

	if _, err := db.Exec(`
		UPDATE inbound_documents
		SET container_type = 'NORMAL'
		WHERE container_type IS NULL OR TRIM(container_type) = ''
	`); err != nil {
		return fmt.Errorf("backfill inbound document container types: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE container_visits cv
		LEFT JOIN inbound_documents d ON d.id = cv.inbound_document_id
		SET cv.container_type = COALESCE(NULLIF(d.container_type, ''), 'NORMAL')
		WHERE cv.container_type IS NULL OR TRIM(cv.container_type) = ''
	`); err != nil {
		return fmt.Errorf("backfill container visit container types: %w", err)
	}

	if hasColumn, err := columnExists(db, "billing_invoices", "invoice_type"); err != nil {
		return fmt.Errorf("check billing invoice type column: %w", err)
	} else if !hasColumn {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD COLUMN invoice_type VARCHAR(32) NOT NULL DEFAULT 'MIXED' AFTER invoice_no`); err != nil {
			return fmt.Errorf("add billing invoice type column: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "billing_invoices", "warehouse_location_id"); err != nil {
		return fmt.Errorf("check billing invoice warehouse location column: %w", err)
	} else if !hasColumn {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD COLUMN warehouse_location_id BIGINT DEFAULT NULL AFTER customer_name_snapshot`); err != nil {
			return fmt.Errorf("add billing invoice warehouse location column: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "billing_invoices", "warehouse_name_snapshot"); err != nil {
		return fmt.Errorf("check billing invoice warehouse name snapshot column: %w", err)
	} else if !hasColumn {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD COLUMN warehouse_name_snapshot VARCHAR(160) DEFAULT NULL AFTER warehouse_location_id`); err != nil {
			return fmt.Errorf("add billing invoice warehouse name snapshot column: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "billing_invoices", "container_type"); err != nil {
		return fmt.Errorf("check billing invoice container type column: %w", err)
	} else if !hasColumn {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD COLUMN container_type VARCHAR(32) DEFAULT NULL AFTER warehouse_name_snapshot`); err != nil {
			return fmt.Errorf("add billing invoice container type column: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "billing_invoices", "header_json"); err != nil {
		return fmt.Errorf("check billing invoice header column: %w", err)
	} else if !hasColumn {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD COLUMN header_json JSON DEFAULT NULL AFTER rates_json`); err != nil {
			return fmt.Errorf("add billing invoice header column: %w", err)
		}
	}

	if _, err := db.Exec(`
		UPDATE billing_invoices
		SET invoice_type = 'MIXED'
		WHERE invoice_type IS NULL OR invoice_type = ''
	`); err != nil {
		return fmt.Errorf("backfill billing invoice types: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE billing_invoices
		SET container_type = 'NORMAL'
		WHERE invoice_type = 'STORAGE_SETTLEMENT'
			AND (container_type IS NULL OR TRIM(container_type) = '')
	`); err != nil {
		return fmt.Errorf("backfill storage settlement invoice container types: %w", err)
	}

	if hasIndex, err := indexExists(db, "billing_invoices", "idx_billing_invoices_customer_period_type_status"); err != nil {
		return fmt.Errorf("check billing invoice duplicate lookup index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD INDEX idx_billing_invoices_customer_period_type_status (customer_id, period_start, period_end, invoice_type, status)`); err != nil {
			return fmt.Errorf("add billing invoice duplicate lookup index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "billing_invoices", "idx_billing_invoices_warehouse_location_id"); err != nil {
		return fmt.Errorf("check billing invoice warehouse scope index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD INDEX idx_billing_invoices_warehouse_location_id (warehouse_location_id)`); err != nil {
			return fmt.Errorf("add billing invoice warehouse scope index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "billing_invoices", "idx_billing_invoices_container_type"); err != nil {
		return fmt.Errorf("check billing invoice container type index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE billing_invoices ADD INDEX idx_billing_invoices_container_type (container_type)`); err != nil {
			return fmt.Errorf("add billing invoice container type index: %w", err)
		}
	}

	if hasColumn, err := columnExists(db, "billing_invoice_lines", "details_json"); err != nil {
		return fmt.Errorf("check billing invoice line details column: %w", err)
	} else if !hasColumn {
		if _, err := db.Exec(`ALTER TABLE billing_invoice_lines ADD COLUMN details_json JSON DEFAULT NULL AFTER notes`); err != nil {
			return fmt.Errorf("add billing invoice line details column: %w", err)
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

	if _, err := db.Exec(`
		UPDATE stock_ledger sl
		JOIN inbound_documents d
			ON sl.source_document_type = 'INBOUND'
			AND sl.source_document_id = d.id
		SET sl.container_id = d.container_id
		WHERE COALESCE(d.container_id, 0) > 0
			AND COALESCE(sl.container_id, 0) <> d.container_id
	`); err != nil {
		return fmt.Errorf("backfill stock ledger container ids from inbound documents: %w", err)
	}

	if err := backfillStockLedgerPalletCountsFromLegacyPalletIDs(db); err != nil {
		return fmt.Errorf("backfill stock ledger pallet counts from legacy pallet ids: %w", err)
	}

	if err := backfillInventoryItemsFromLegacyPalletEntities(db); err != nil {
		return fmt.Errorf("backfill inventory items from legacy pallet entities: %w", err)
	}

	if err := dropLegacyPalletEntitySchema(db); err != nil {
		return fmt.Errorf("drop legacy pallet entity schema: %w", err)
	}

	if _, err := db.Exec(`ALTER TABLE inventory_items MODIFY COLUMN container_no VARCHAR(120) NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("normalize inventory item container column: %w", err)
	}

	if _, err := db.Exec(`ALTER TABLE inventory_items ADD UNIQUE INDEX uq_inventory_item_balance (sku_master_id, location_id, storage_section, customer_id, container_id)`); err != nil {
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

	if hasIndex, err := indexExists(db, "inventory_items", "idx_inventory_items_container_id"); err != nil {
		return fmt.Errorf("check inventory container index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE inventory_items ADD INDEX idx_inventory_items_container_id (container_id)`); err != nil {
			return fmt.Errorf("create inventory container index: %w", err)
		}
	}

	if hasIndex, err := indexExists(db, "stock_ledger", "idx_stock_ledger_container_id"); err != nil {
		return fmt.Errorf("check stock ledger container index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`ALTER TABLE stock_ledger ADD INDEX idx_stock_ledger_container_id (container_id)`); err != nil {
			return fmt.Errorf("create stock ledger container index: %w", err)
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

func backfillStockLedgerPalletCountsFromLegacyPalletIDs(db *sql.DB) error {
	hasPalletID, err := columnExists(db, "stock_ledger", "pallet_id")
	if err != nil {
		return fmt.Errorf("check stock ledger legacy pallet_id column: %w", err)
	}
	if !hasPalletID {
		return nil
	}

	if _, err := db.Exec(`
		UPDATE stock_ledger
		SET pallets = 1
		WHERE COALESCE(pallets, 0) = 0
			AND COALESCE(pallet_id, 0) > 0
			AND quantity_change <> 0
	`); err != nil {
		return fmt.Errorf("backfill stock ledger pallet counts: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE container_lifecycle_events cle
		JOIN stock_ledger sl ON sl.id = cle.stock_ledger_id
		SET cle.pallets = sl.pallets
		WHERE COALESCE(cle.pallets, 0) = 0
			AND COALESCE(sl.pallets, 0) > 0
	`); err != nil {
		return fmt.Errorf("backfill container lifecycle pallet counts: %w", err)
	}

	return nil
}

func backfillInventoryItemsFromLegacyPalletEntities(db *sql.DB) error {
	hasPallets, err := tableExists(db, "pallets")
	if err != nil {
		return fmt.Errorf("check legacy pallets table: %w", err)
	}
	hasPalletItems, err := tableExists(db, "pallet_items")
	if err != nil {
		return fmt.Errorf("check legacy pallet_items table: %w", err)
	}
	if !hasPallets || !hasPalletItems {
		return nil
	}

	compatStatements := []string{
		`ALTER TABLE pallets ADD COLUMN IF NOT EXISTS actual_arrival_date DATE DEFAULT NULL`,
		`ALTER TABLE pallets ADD COLUMN IF NOT EXISTS current_storage_section VARCHAR(16) NOT NULL DEFAULT 'TEMP'`,
		`ALTER TABLE pallets ADD COLUMN IF NOT EXISTS current_container_no VARCHAR(120) NOT NULL DEFAULT ''`,
		`ALTER TABLE pallets ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'OPEN'`,
		`ALTER TABLE pallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
		`ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS allocated_qty INT NOT NULL DEFAULT 0 AFTER quantity`,
		`ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS damaged_qty INT NOT NULL DEFAULT 0 AFTER allocated_qty`,
		`ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS hold_qty INT NOT NULL DEFAULT 0 AFTER damaged_qty`,
	}
	for _, statement := range compatStatements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("prepare legacy pallet item columns: %w", err)
		}
	}

	legacyInventorySelect := `
		SELECT
			pi.sku_master_id,
			p.customer_id,
			p.current_location_id AS location_id,
			COALESCE(NULLIF(TRIM(p.current_storage_section), ''), 'TEMP') AS storage_section,
			0 AS container_id,
			TRIM(COALESCE(p.current_container_no, '')) AS container_no,
			MIN(p.actual_arrival_date) AS delivery_date,
			SUM(pi.quantity) AS quantity,
			COUNT(DISTINCT p.id) AS pallets,
			SUM(pi.allocated_qty) AS allocated_qty,
			SUM(pi.damaged_qty) AS damaged_qty,
			SUM(pi.hold_qty) AS hold_qty,
			MAX(COALESCE(p.updated_at, p.created_at)) AS last_restocked_at
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE COALESCE(p.status, 'OPEN') <> 'CANCELLED'
			AND pi.sku_master_id > 0
			AND p.customer_id > 0
			AND p.current_location_id > 0
		GROUP BY
			pi.sku_master_id,
			p.customer_id,
			p.current_location_id,
			COALESCE(NULLIF(TRIM(p.current_storage_section), ''), 'TEMP'),
			TRIM(COALESCE(p.current_container_no, ''))
	`

	if _, err := db.Exec(fmt.Sprintf(`
		UPDATE inventory_items i
		JOIN (%s) pb
			ON pb.sku_master_id = i.sku_master_id
			AND pb.customer_id = i.customer_id
			AND pb.location_id = i.location_id
			AND pb.storage_section = COALESCE(NULLIF(TRIM(i.storage_section), ''), 'TEMP')
			AND pb.container_id = COALESCE(i.container_id, 0)
		SET
			i.quantity = pb.quantity,
			i.allocated_qty = pb.allocated_qty,
			i.damaged_qty = pb.damaged_qty,
			i.hold_qty = pb.hold_qty,
			i.delivery_date = COALESCE(i.delivery_date, pb.delivery_date),
			i.last_restocked_at = COALESCE(i.last_restocked_at, pb.last_restocked_at),
			i.updated_at = CURRENT_TIMESTAMP
		WHERE i.quantity = 0
			AND i.allocated_qty = 0
			AND i.damaged_qty = 0
			AND i.hold_qty = 0
	`, legacyInventorySelect)); err != nil {
		return fmt.Errorf("backfill legacy pallet quantities into inventory items: %w", err)
	}

	if _, err := db.Exec(fmt.Sprintf(`
		UPDATE inventory_items i
		JOIN (%s) pb
			ON pb.sku_master_id = i.sku_master_id
			AND pb.customer_id = i.customer_id
			AND pb.location_id = i.location_id
			AND pb.storage_section = COALESCE(NULLIF(TRIM(i.storage_section), ''), 'TEMP')
			AND pb.container_id = COALESCE(i.container_id, 0)
		SET
			i.pallets = pb.pallets,
			i.updated_at = CURRENT_TIMESTAMP
		WHERE i.pallets = 0
	`, legacyInventorySelect)); err != nil {
		return fmt.Errorf("backfill legacy pallet counts into inventory items: %w", err)
	}

	if _, err := db.Exec(fmt.Sprintf(`
		INSERT INTO inventory_items (
			sku_master_id,
			customer_id,
			location_id,
			storage_section,
			quantity,
			pallets,
			allocated_qty,
			damaged_qty,
			hold_qty,
			delivery_date,
			container_id,
			container_no,
			last_restocked_at
		)
		SELECT
			pb.sku_master_id,
			pb.customer_id,
			pb.location_id,
			pb.storage_section,
			pb.quantity,
			pb.pallets,
			pb.allocated_qty,
			pb.damaged_qty,
			pb.hold_qty,
			pb.delivery_date,
			pb.container_id,
			pb.container_no,
			pb.last_restocked_at
		FROM (%s) pb
		LEFT JOIN inventory_items i
			ON pb.sku_master_id = i.sku_master_id
			AND pb.customer_id = i.customer_id
			AND pb.location_id = i.location_id
			AND pb.storage_section = COALESCE(NULLIF(TRIM(i.storage_section), ''), 'TEMP')
			AND pb.container_id = COALESCE(i.container_id, 0)
		WHERE i.id IS NULL
	`, legacyInventorySelect)); err != nil {
		return fmt.Errorf("insert legacy pallet inventory items: %w", err)
	}

	return nil
}

func dropLegacyPalletEntitySchema(db *sql.DB) error {
	referencedTables := []string{
		"pallet_rework_events",
		"pallet_items",
		"pallet_location_events",
		"receipt_lots",
		"pallets",
	}
	for _, table := range referencedTables {
		if err := dropForeignKeysReferencingTable(db, table); err != nil {
			return fmt.Errorf("drop foreign keys referencing %s: %w", table, err)
		}
	}

	legacyIndexes := []struct {
		table string
		name  string
	}{
		{table: "stock_ledger", name: "idx_stock_ledger_pallet_id"},
		{table: "stock_ledger", name: "idx_stock_ledger_pallet_item_id"},
		{table: "container_lifecycle_events", name: "idx_container_lifecycle_pallet_id"},
		{table: "inventory_adjustment_lines", name: "idx_inventory_adjustment_lines_pallet_id"},
	}
	for _, idx := range legacyIndexes {
		if err := dropIndexIfExists(db, idx.table, idx.name); err != nil {
			return fmt.Errorf("drop legacy index %s on %s: %w", idx.name, idx.table, err)
		}
	}

	legacyColumns := []struct {
		table  string
		column string
	}{
		{table: "stock_ledger", column: "pallet_id"},
		{table: "stock_ledger", column: "pallet_item_id"},
		{table: "container_lifecycle_events", column: "pallet_id"},
		{table: "container_lifecycle_events", column: "pallet_item_id"},
		{table: "inventory_adjustment_lines", column: "pallet_id"},
		{table: "inventory_adjustment_lines", column: "pallet_code_snapshot"},
	}
	for _, col := range legacyColumns {
		if err := dropColumnIfExists(db, col.table, col.column); err != nil {
			return fmt.Errorf("drop legacy column %s on %s: %w", col.column, col.table, err)
		}
	}

	legacyTables := []string{
		"pallet_rework_event_pallets",
		"pallet_rework_events",
		"pallet_location_events",
		"pallet_items",
		"pallet_contents",
		"movement_lot_links",
		"outbound_picks",
		"receipt_lots",
		"pallets",
	}
	for _, table := range legacyTables {
		if err := dropTableIfExists(db, table); err != nil {
			return fmt.Errorf("drop legacy table %s: %w", table, err)
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

func dropIndexIfExists(db *sql.DB, tableName string, indexName string) error {
	hasIndex, err := indexExists(db, tableName, indexName)
	if err != nil {
		return err
	}
	if !hasIndex {
		return nil
	}
	_, err = db.Exec(fmt.Sprintf(
		"ALTER TABLE %s DROP INDEX %s",
		quoteIdentifier(tableName),
		quoteIdentifier(indexName),
	))
	return err
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

func dropColumnIfExists(db *sql.DB, tableName string, columnName string) error {
	hasColumn, err := columnExists(db, tableName, columnName)
	if err != nil {
		return err
	}
	if !hasColumn {
		return nil
	}
	_, err = db.Exec(fmt.Sprintf(
		"ALTER TABLE %s DROP COLUMN %s",
		quoteIdentifier(tableName),
		quoteIdentifier(columnName),
	))
	return err
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

func dropTableIfExists(db *sql.DB, tableName string) error {
	hasTable, err := tableExists(db, tableName)
	if err != nil {
		return err
	}
	if !hasTable {
		return nil
	}
	_, err = db.Exec(fmt.Sprintf("DROP TABLE %s", quoteIdentifier(tableName)))
	return err
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

func quoteIdentifier(identifier string) string {
	return "`" + strings.ReplaceAll(identifier, "`", "``") + "`"
}

func isDuplicateIndexError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "Duplicate key name") || strings.Contains(err.Error(), "already exists"))
}
