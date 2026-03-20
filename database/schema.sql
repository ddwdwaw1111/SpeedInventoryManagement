CREATE DATABASE IF NOT EXISTS speed_inventory_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE speed_inventory_management;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(64) NOT NULL,
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
  zone VARCHAR(80) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  capacity INT NOT NULL DEFAULT 0,
  section_count INT NOT NULL DEFAULT 1,
  section_names_json TEXT DEFAULT NULL,
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
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGINT NOT NULL AUTO_INCREMENT,
  sku_master_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT DEFAULT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 0,
  location_id BIGINT NOT NULL,
  storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
  delivery_date DATE DEFAULT NULL,
  container_no VARCHAR(120) DEFAULT NULL,
  expected_qty INT NOT NULL DEFAULT 0,
  received_qty INT NOT NULL DEFAULT 0,
  pallets INT NOT NULL DEFAULT 0,
  pallets_detail_ctns VARCHAR(255) DEFAULT NULL,
  height_in INT NOT NULL DEFAULT 0,
  out_date DATE DEFAULT NULL,
  last_restocked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_item_balance (sku_master_id, location_id, storage_section, customer_id),
  KEY idx_inventory_items_category (category),
  KEY idx_inventory_items_location_id (location_id),
  KEY idx_inventory_items_sku (sku),
  KEY idx_inventory_items_sku_master_id (sku_master_id),
  KEY idx_inventory_items_customer_id (customer_id),
  CONSTRAINT fk_inventory_items_sku_master
    FOREIGN KEY (sku_master_id) REFERENCES sku_master (id),
  CONSTRAINT fk_inventory_items_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_inventory_items_location
    FOREIGN KEY (location_id) REFERENCES storage_locations (id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT NOT NULL AUTO_INCREMENT,
  item_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  storage_section VARCHAR(16) NOT NULL DEFAULT 'A',
  movement_type ENUM('IN', 'OUT', 'ADJUST') NOT NULL,
  quantity_change INT NOT NULL,
  delivery_date DATE DEFAULT NULL,
  container_no VARCHAR(120) DEFAULT NULL,
  packing_list_no VARCHAR(120) DEFAULT NULL,
  order_ref VARCHAR(120) DEFAULT NULL,
  item_number VARCHAR(120) DEFAULT NULL,
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
  out_date DATE DEFAULT NULL,
  reason VARCHAR(255) NOT NULL,
  reference_code VARCHAR(120) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_stock_movements_item_id (item_id),
  KEY idx_stock_movements_customer_id (customer_id),
  KEY idx_stock_movements_location_id (location_id),
  KEY idx_stock_movements_created_at (created_at),
  CONSTRAINT fk_stock_movements_item
    FOREIGN KEY (item_id) REFERENCES inventory_items (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_movements_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_stock_movements_location
    FOREIGN KEY (location_id) REFERENCES storage_locations (id)
);
