CREATE DATABASE IF NOT EXISTS speed_inventory_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE speed_inventory_management;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  password_salt VARCHAR(32) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
);

CREATE TABLE IF NOT EXISTS user_sessions (
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
);

CREATE TABLE IF NOT EXISTS storage_locations (
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
);

CREATE TABLE IF NOT EXISTS customers (
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
);

CREATE TABLE IF NOT EXISTS sku_master (
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
);

CREATE TABLE IF NOT EXISTS ui_preferences (
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
);

CREATE TABLE IF NOT EXISTS inventory_items (
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
);

CREATE TABLE IF NOT EXISTS outbound_documents (
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
);

CREATE TABLE IF NOT EXISTS inbound_documents (
  id BIGINT NOT NULL AUTO_INCREMENT,
  customer_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  delivery_date DATE DEFAULT NULL,
  container_no VARCHAR(120) NOT NULL DEFAULT '',
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
);

CREATE TABLE IF NOT EXISTS container_visits (
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
);

CREATE TABLE IF NOT EXISTS inbound_document_lines (
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
);

CREATE TABLE IF NOT EXISTS outbound_document_lines (
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
);

CREATE TABLE IF NOT EXISTS pallets (
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
    ON DELETE SET NULL,
  CONSTRAINT fk_pallets_source_line
    FOREIGN KEY (source_inbound_line_id) REFERENCES inbound_document_lines (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_pallets_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_pallets_sku_master
    FOREIGN KEY (sku_master_id) REFERENCES sku_master (id),
  CONSTRAINT fk_pallets_current_location
    FOREIGN KEY (current_location_id) REFERENCES storage_locations (id)
);

CREATE TABLE IF NOT EXISTS pallet_items (
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
);

CREATE TABLE IF NOT EXISTS stock_ledger (
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
);

CREATE TABLE IF NOT EXISTS outbound_picks (
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
);

CREATE TABLE IF NOT EXISTS pallet_location_events (
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
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
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
);

CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
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
);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id BIGINT NOT NULL AUTO_INCREMENT,
  transfer_no VARCHAR(120) NOT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_transfers_transfer_no (transfer_no),
  KEY idx_inventory_transfers_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
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
);

CREATE TABLE IF NOT EXISTS cycle_counts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  count_no VARCHAR(120) NOT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cycle_counts_count_no (count_no),
  KEY idx_cycle_counts_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS cycle_count_lines (
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
);

CREATE TABLE IF NOT EXISTS audit_logs (
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
);
