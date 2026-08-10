-- Speed Inventory Management v1 bootstrap schema.
-- Generated table-by-table from the fully migrated MariaDB schema.
-- Runtime migrations remain authoritative for upgrades; this file keeps new
-- environments aligned with the current container-centric model at startup.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `actor_user_id` bigint(20) NOT NULL,
  `actor_email` varchar(190) DEFAULT NULL,
  `actor_name` varchar(160) DEFAULT NULL,
  `actor_role` varchar(32) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `entity_type` varchar(64) NOT NULL,
  `entity_id` bigint(20) DEFAULT NULL,
  `target_label` varchar(255) DEFAULT NULL,
  `summary` varchar(255) DEFAULT NULL,
  `details_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details_json`)),
  `request_method` varchar(16) DEFAULT NULL,
  `request_path` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_actor_user_id` (`actor_user_id`),
  KEY `idx_audit_logs_entity_type` (`entity_type`),
  KEY `idx_audit_logs_created_at` (`created_at`),
  CONSTRAINT `fk_audit_logs_actor_user` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `billing_invoice_lines` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `invoice_id` bigint(20) NOT NULL,
  `charge_type` varchar(32) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `reference` varchar(255) DEFAULT NULL,
  `container_no` varchar(120) DEFAULT NULL,
  `warehouse` varchar(160) DEFAULT NULL,
  `occurred_on` date DEFAULT NULL,
  `quantity` decimal(12,4) NOT NULL DEFAULT 0.0000,
  `unit_rate` decimal(12,4) NOT NULL DEFAULT 0.0000,
  `amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(255) DEFAULT NULL,
  `details_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details_json`)),
  `source_type` varchar(16) NOT NULL DEFAULT 'AUTO',
  `source_document_type` varchar(32) DEFAULT NULL,
  `source_document_id` bigint(20) DEFAULT NULL,
  `source_line_id` bigint(20) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_billing_invoice_lines_invoice_id` (`invoice_id`),
  KEY `idx_billing_invoice_lines_source_document` (`source_document_type`,`source_document_id`,`source_line_id`),
  CONSTRAINT `fk_billing_invoice_lines_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `billing_invoice_settings` (
  `id` tinyint(4) NOT NULL DEFAULT 1,
  `seller_name` varchar(160) NOT NULL DEFAULT '',
  `subtitle` varchar(160) NOT NULL DEFAULT '',
  `remit_to` text NOT NULL,
  `terms` varchar(64) NOT NULL DEFAULT '',
  `payment_due_days` int(11) NOT NULL DEFAULT 0,
  `payment_instructions` text NOT NULL,
  `updated_by_user_id` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `billing_invoices` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `invoice_no` varchar(64) NOT NULL,
  `invoice_type` varchar(32) NOT NULL DEFAULT 'MIXED',
  `customer_id` bigint(20) NOT NULL,
  `customer_name_snapshot` varchar(160) NOT NULL DEFAULT '',
  `warehouse_location_id` bigint(20) DEFAULT NULL,
  `warehouse_name_snapshot` varchar(160) DEFAULT NULL,
  `container_type` varchar(32) DEFAULT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `currency_code` varchar(8) NOT NULL DEFAULT 'USD',
  `rates_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`rates_json`)),
  `header_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`header_json`)),
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `grand_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` varchar(32) NOT NULL DEFAULT 'DRAFT',
  `notes` text DEFAULT NULL,
  `finalized_at` timestamp NULL DEFAULT NULL,
  `finalized_by_user_id` bigint(20) DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `voided_at` timestamp NULL DEFAULT NULL,
  `created_by_user_id` bigint(20) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_invoices_invoice_no` (`invoice_no`),
  KEY `idx_billing_invoices_customer_id` (`customer_id`),
  KEY `idx_billing_invoices_status` (`status`),
  KEY `idx_billing_invoices_period` (`period_start`,`period_end`),
  KEY `idx_billing_invoices_warehouse_location_id` (`warehouse_location_id`),
  KEY `idx_billing_invoices_container_type` (`container_type`),
  KEY `idx_billing_invoices_customer_period_type_status` (`customer_id`,`period_start`,`period_end`,`invoice_type`,`status`),
  KEY `fk_billing_invoices_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_billing_invoices_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_billing_invoices_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `bulk_import_batch_documents` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `batch_id` bigint(20) NOT NULL,
  `document_key` varchar(190) NOT NULL DEFAULT '',
  `document_id` bigint(20) DEFAULT NULL,
  `reference_code` varchar(190) NOT NULL DEFAULT '',
  `status` varchar(32) NOT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bulk_import_batch_documents_key` (`batch_id`,`document_key`),
  KEY `idx_bulk_import_batch_documents_batch` (`batch_id`,`id`),
  KEY `idx_bulk_import_batch_documents_document` (`document_id`),
  CONSTRAINT `fk_bulk_import_batch_documents_batch` FOREIGN KEY (`batch_id`) REFERENCES `bulk_import_batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `bulk_import_batches` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `import_id` char(32) NOT NULL,
  `import_type` varchar(16) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `customer_name_snapshot` varchar(160) NOT NULL DEFAULT '',
  `source_file_name` varchar(255) NOT NULL,
  `content_type` varchar(120) NOT NULL,
  `file_size_bytes` bigint(20) NOT NULL DEFAULT 0,
  `file_sha256` char(64) NOT NULL,
  `original_file` longblob NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'UPLOADED',
  `total_documents` int(11) NOT NULL DEFAULT 0,
  `valid_documents` int(11) NOT NULL DEFAULT 0,
  `invalid_documents` int(11) NOT NULL DEFAULT 0,
  `total_lines` int(11) NOT NULL DEFAULT 0,
  `created_documents` int(11) NOT NULL DEFAULT 0,
  `failed_documents` int(11) NOT NULL DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `created_by_user_id` bigint(20) NOT NULL,
  `created_by_name_snapshot` varchar(160) NOT NULL DEFAULT '',
  `created_by_email_snapshot` varchar(190) NOT NULL DEFAULT '',
  `committed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bulk_import_batches_import_id` (`import_id`),
  KEY `idx_bulk_import_batches_type_created` (`import_type`,`created_at`,`id`),
  KEY `idx_bulk_import_batches_customer_created` (`customer_id`,`created_at`,`id`),
  KEY `idx_bulk_import_batches_created_by` (`created_by_user_id`,`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `container_lifecycle_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `stock_ledger_id` bigint(20) DEFAULT NULL,
  `customer_id` bigint(20) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `section_id` bigint(20) DEFAULT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `container_no` varchar(120) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `event_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `quantity_delta` int(11) NOT NULL DEFAULT 0,
  `pallet_delta` decimal(12,4) NOT NULL DEFAULT 0.0000,
  `sku_master_id` bigint(20) DEFAULT NULL,
  `source_document_type` varchar(32) DEFAULT NULL,
  `source_document_id` bigint(20) DEFAULT NULL,
  `source_line_id` bigint(20) DEFAULT NULL,
  `packing_list_no` varchar(120) DEFAULT NULL,
  `order_ref` varchar(120) DEFAULT NULL,
  `item_number_snapshot` varchar(120) DEFAULT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `expected_qty` int(11) NOT NULL DEFAULT 0,
  `received_qty` int(11) NOT NULL DEFAULT 0,
  `pallets` int(11) NOT NULL DEFAULT 0,
  `document_note` varchar(255) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `reference_code` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `business_date` datetime GENERATED ALWAYS AS (CASE WHEN `event_type` in ('SHIP','REVERSAL') THEN coalesce(`out_date`,`occurred_at`,`created_at`) WHEN `event_type` = 'RECEIVE' THEN coalesce(`delivery_date`,`occurred_at`,`created_at`) ELSE coalesce(`occurred_at`,`created_at`) END) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_container_lifecycle_stock_ledger` (`stock_ledger_id`),
  KEY `idx_container_lifecycle_customer_container_time` (`customer_id`,`container_no`,`event_time`,`id`),
  KEY `idx_container_lifecycle_source` (`source_document_type`,`source_document_id`),
  KEY `idx_container_lifecycle_event_type` (`event_type`),
  KEY `fk_container_lifecycle_location` (`location_id`),
  KEY `fk_container_lifecycle_section` (`section_id`),
  CONSTRAINT `fk_container_lifecycle_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_container_lifecycle_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_container_lifecycle_section` FOREIGN KEY (`section_id`) REFERENCES `storage_sections` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_container_lifecycle_stock_ledger` FOREIGN KEY (`stock_ledger_id`) REFERENCES `stock_ledger` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_container_lifecycle_container_no` CHECK (trim(`container_no`) <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `container_pickup_assignments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `container_id` bigint(20) DEFAULT NULL,
  `customer_id` bigint(20) NOT NULL,
  `container_no` varchar(120) NOT NULL,
  `assignment_type` varchar(32) NOT NULL DEFAULT 'INTERNAL',
  `driver_name` varchar(160) DEFAULT NULL,
  `vendor_name` varchar(160) DEFAULT NULL,
  `phone` varchar(64) DEFAULT NULL,
  `scheduled_pickup_at` timestamp NULL DEFAULT NULL,
  `actual_pickup_at` timestamp NULL DEFAULT NULL,
  `cost` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` varchar(32) NOT NULL DEFAULT 'SCHEDULED',
  `notes` text DEFAULT NULL,
  `visibility` varchar(16) NOT NULL DEFAULT 'BOTH',
  `public_status` varchar(64) DEFAULT NULL,
  `public_label` varchar(190) DEFAULT NULL,
  `internal_status` varchar(64) DEFAULT NULL,
  `internal_label` varchar(255) DEFAULT NULL,
  `created_by_user_id` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_container_pickup_container_id` (`container_id`),
  KEY `idx_container_pickup_customer_container` (`customer_id`,`container_no`),
  KEY `idx_container_pickup_status` (`status`),
  KEY `fk_container_pickup_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_container_pickup_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_container_pickup_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_container_pickup_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `container_tracking_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `container_id` bigint(20) DEFAULT NULL,
  `customer_id` bigint(20) NOT NULL,
  `container_no` varchar(120) NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `event_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `location` varchar(160) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `visibility` varchar(16) NOT NULL DEFAULT 'BOTH',
  `public_status` varchar(64) DEFAULT NULL,
  `public_label` varchar(190) DEFAULT NULL,
  `internal_status` varchar(64) DEFAULT NULL,
  `internal_label` varchar(255) DEFAULT NULL,
  `created_by_user_id` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_container_tracking_container_id` (`container_id`),
  KEY `idx_container_tracking_customer_container_time` (`customer_id`,`container_no`,`event_time`,`id`),
  KEY `idx_container_tracking_event_type` (`event_type`),
  KEY `fk_container_tracking_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_container_tracking_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_container_tracking_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_container_tracking_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `container_visits` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `inbound_document_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `container_no` varchar(120) NOT NULL,
  `arrival_date` date DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT NULL,
  `container_type` varchar(32) NOT NULL DEFAULT 'NORMAL',
  `handling_mode` varchar(32) NOT NULL DEFAULT 'PALLETIZED',
  `closed_at` timestamp NULL DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'OPEN',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_container_visits_inbound_document_id` (`inbound_document_id`),
  KEY `idx_container_visits_container_no` (`container_no`),
  KEY `idx_container_visits_customer_id` (`customer_id`),
  KEY `idx_container_visits_location_id` (`location_id`),
  KEY `idx_container_visits_status` (`status`),
  CONSTRAINT `fk_container_visits_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_container_visits_inbound_document` FOREIGN KEY (`inbound_document_id`) REFERENCES `inbound_documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_container_visits_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `containers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `customer_id` bigint(20) NOT NULL,
  `location_id` bigint(20) DEFAULT NULL,
  `container_no` varchar(120) NOT NULL,
  `container_type` varchar(32) NOT NULL DEFAULT 'NORMAL',
  `handling_mode` varchar(32) NOT NULL DEFAULT 'PALLETIZED',
  `status` varchar(32) NOT NULL DEFAULT 'TRACKING_RECEIVED',
  `tracking_status` varchar(32) NOT NULL DEFAULT 'TRACKING_RECEIVED',
  `last_event_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_containers_customer_container_no` (`customer_id`,`container_no`),
  KEY `idx_containers_customer_id` (`customer_id`),
  KEY `idx_containers_location_id` (`location_id`),
  KEY `idx_containers_status` (`status`),
  CONSTRAINT `fk_containers_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_containers_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `customer_item_catalog` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `customer_id` bigint(20) NOT NULL,
  `sku_master_id` bigint(20) NOT NULL,
  `item_number` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_item_catalog_sku` (`customer_id`,`sku_master_id`),
  UNIQUE KEY `uq_customer_item_catalog_item_number` (`customer_id`,`item_number`),
  KEY `idx_customer_item_catalog_sku_master` (`sku_master_id`),
  CONSTRAINT `fk_customer_item_catalog_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_customer_item_catalog_sku_master` FOREIGN KEY (`sku_master_id`) REFERENCES `sku_master` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `customers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(160) NOT NULL,
  `contact_name` varchar(160) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `phone` varchar(64) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cycle_count_lines` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `cycle_count_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `customer_name_snapshot` varchar(160) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `location_name_snapshot` varchar(160) NOT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `container_no` varchar(120) NOT NULL DEFAULT '',
  `sku_snapshot` varchar(64) NOT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `system_qty` int(11) NOT NULL DEFAULT 0,
  `counted_qty` int(11) NOT NULL DEFAULT 0,
  `variance_qty` int(11) NOT NULL DEFAULT 0,
  `system_pallets` int(11) NOT NULL DEFAULT 0,
  `counted_pallets` int(11) NOT NULL DEFAULT 0,
  `variance_pallets` int(11) NOT NULL DEFAULT 0,
  `line_note` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cycle_count_lines_cycle_count_id` (`cycle_count_id`),
  KEY `fk_cycle_count_lines_customer` (`customer_id`),
  KEY `fk_cycle_count_lines_location` (`location_id`),
  CONSTRAINT `fk_cycle_count_lines_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_cycle_count_lines_cycle_count` FOREIGN KEY (`cycle_count_id`) REFERENCES `cycle_counts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cycle_count_lines_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cycle_counts` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `count_no` varchar(120) NOT NULL,
  `notes` text DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'POSTED',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cycle_counts_count_no` (`count_no`),
  KEY `idx_cycle_counts_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `delivery_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `outbound_document_id` bigint(20) DEFAULT NULL,
  `customer_id` bigint(20) DEFAULT NULL,
  `container_no` varchar(120) NOT NULL DEFAULT '',
  `event_type` varchar(64) NOT NULL,
  `event_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `driver_name` varchar(160) DEFAULT NULL,
  `vendor_name` varchar(160) DEFAULT NULL,
  `vehicle_no` varchar(64) DEFAULT NULL,
  `bol_number` varchar(120) DEFAULT NULL,
  `bol_received_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `visibility` varchar(16) NOT NULL DEFAULT 'BOTH',
  `public_status` varchar(64) DEFAULT NULL,
  `public_label` varchar(190) DEFAULT NULL,
  `internal_status` varchar(64) DEFAULT NULL,
  `internal_label` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_delivery_events_outbound_document_id` (`outbound_document_id`),
  KEY `idx_delivery_events_customer_container_time` (`customer_id`,`container_no`,`event_time`,`id`),
  KEY `idx_delivery_events_event_type` (`event_type`),
  KEY `idx_delivery_events_bol_number` (`bol_number`),
  CONSTRAINT `fk_delivery_events_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_delivery_events_outbound_document` FOREIGN KEY (`outbound_document_id`) REFERENCES `outbound_documents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `document_attachments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `document_type` varchar(16) NOT NULL,
  `document_id` bigint(20) NOT NULL,
  `display_name` varchar(190) NOT NULL,
  `original_file_name` varchar(255) DEFAULT NULL,
  `storage_provider` varchar(32) NOT NULL DEFAULT 'r2',
  `storage_bucket` varchar(255) NOT NULL,
  `storage_key` varchar(512) NOT NULL,
  `content_type` varchar(120) NOT NULL,
  `size_bytes` bigint(20) NOT NULL DEFAULT 0,
  `uploaded_by_user_id` bigint(20) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_attachments_storage_key` (`storage_provider`,`storage_bucket`,`storage_key`) USING HASH,
  KEY `idx_document_attachments_document` (`document_type`,`document_id`),
  KEY `idx_document_attachments_uploaded_by` (`uploaded_by_user_id`),
  CONSTRAINT `fk_document_attachments_user` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inbound_document_lines` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `document_id` bigint(20) NOT NULL,
  `sku_snapshot` varchar(64) NOT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `reorder_level` int(11) NOT NULL DEFAULT 0,
  `expected_qty` int(11) NOT NULL DEFAULT 0,
  `received_qty` int(11) NOT NULL DEFAULT 0,
  `pallets` int(11) NOT NULL DEFAULT 0,
  `units_per_pallet` int(11) NOT NULL DEFAULT 0,
  `pallets_detail_ctns` varchar(255) DEFAULT NULL,
  `pallet_breakdown_json` text DEFAULT NULL,
  `unit_label` varchar(32) DEFAULT NULL,
  `line_note` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inbound_document_lines_document_id` (`document_id`),
  CONSTRAINT `fk_inbound_document_lines_document` FOREIGN KEY (`document_id`) REFERENCES `inbound_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inbound_documents` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `container_id` bigint(20) DEFAULT NULL,
  `customer_id` bigint(20) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `expected_arrival_date` date DEFAULT NULL,
  `actual_arrival_date` date DEFAULT NULL,
  `container_no` varchar(120) DEFAULT NULL,
  `container_type` varchar(32) NOT NULL DEFAULT 'NORMAL',
  `handling_mode` varchar(32) NOT NULL DEFAULT 'PALLETIZED',
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `unit_label` varchar(32) DEFAULT NULL,
  `document_note` text DEFAULT NULL,
  `import_key` varchar(80) DEFAULT NULL,
  `import_payload_hash` char(64) DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'CONFIRMED',
  `tracking_status` varchar(32) NOT NULL DEFAULT 'SCHEDULED',
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `posted_at` timestamp NULL DEFAULT NULL,
  `cancel_note` text DEFAULT NULL,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inbound_documents_import_key` (`import_key`),
  KEY `idx_inbound_documents_customer_id` (`customer_id`),
  KEY `idx_inbound_documents_location_id` (`location_id`),
  KEY `idx_inbound_documents_expected_arrival_date` (`expected_arrival_date`),
  KEY `idx_inbound_documents_container_no` (`container_no`),
  KEY `idx_inbound_documents_container_id` (`container_id`),
  CONSTRAINT `fk_inbound_documents_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`),
  CONSTRAINT `fk_inbound_documents_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_inbound_documents_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_adjustment_lines` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `adjustment_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `customer_name_snapshot` varchar(160) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `location_name_snapshot` varchar(160) NOT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `container_no` varchar(120) NOT NULL DEFAULT '',
  `sku_snapshot` varchar(64) NOT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `before_qty` int(11) NOT NULL DEFAULT 0,
  `adjust_qty` int(11) NOT NULL DEFAULT 0,
  `after_qty` int(11) NOT NULL DEFAULT 0,
  `before_pallets` int(11) NOT NULL DEFAULT 0,
  `adjust_pallets` int(11) NOT NULL DEFAULT 0,
  `after_pallets` int(11) NOT NULL DEFAULT 0,
  `line_note` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_adjustment_lines_adjustment_id` (`adjustment_id`),
  KEY `fk_inventory_adjustment_lines_customer` (`customer_id`),
  KEY `fk_inventory_adjustment_lines_location` (`location_id`),
  CONSTRAINT `fk_inventory_adjustment_lines_adjustment` FOREIGN KEY (`adjustment_id`) REFERENCES `inventory_adjustments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inventory_adjustment_lines_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_inventory_adjustment_lines_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_adjustments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `adjustment_no` varchar(120) NOT NULL,
  `reason_code` varchar(64) NOT NULL,
  `actual_adjusted_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'POSTED',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_adjustments_adjustment_no` (`adjustment_no`),
  KEY `idx_inventory_adjustments_reason_code` (`reason_code`),
  KEY `idx_inventory_adjustments_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_items` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `sku_master_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `container_id` bigint(20) DEFAULT NULL,
  `location_id` bigint(20) NOT NULL,
  `section_id` bigint(20) DEFAULT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `delivery_date` date DEFAULT NULL,
  `container_no` varchar(120) NOT NULL DEFAULT '',
  `quantity` int(11) NOT NULL DEFAULT 0,
  `allocated_qty` int(11) NOT NULL DEFAULT 0,
  `damaged_qty` int(11) NOT NULL DEFAULT 0,
  `hold_qty` int(11) NOT NULL DEFAULT 0,
  `pallets` int(11) NOT NULL DEFAULT 0,
  `allocated_pallets` int(11) NOT NULL DEFAULT 0,
  `last_restocked_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_item_balance` (`sku_master_id`,`location_id`,`storage_section`,`customer_id`,`container_no`),
  KEY `idx_inventory_items_location_id` (`location_id`),
  KEY `idx_inventory_items_sku_master_id` (`sku_master_id`),
  KEY `idx_inventory_items_customer_id` (`customer_id`),
  KEY `idx_inventory_items_container_id` (`container_id`),
  KEY `fk_inventory_items_section` (`section_id`),
  CONSTRAINT `fk_inventory_items_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inventory_items_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_inventory_items_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_inventory_items_section` FOREIGN KEY (`section_id`) REFERENCES `storage_sections` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inventory_items_sku_master` FOREIGN KEY (`sku_master_id`) REFERENCES `sku_master` (`id`),
  CONSTRAINT `chk_inventory_items_nonnegative` CHECK (`quantity` >= 0 and `allocated_qty` >= 0 and `damaged_qty` >= 0 and `hold_qty` >= 0 and `pallets` >= 0 and `allocated_pallets` >= 0),
  CONSTRAINT `chk_inventory_items_quantity_capacity` CHECK (`allocated_qty` + `damaged_qty` + `hold_qty` <= `quantity`),
  CONSTRAINT `chk_inventory_items_pallet_capacity` CHECK (`allocated_pallets` <= `pallets`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_transfer_lines` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `transfer_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `customer_name_snapshot` varchar(160) NOT NULL,
  `from_location_id` bigint(20) NOT NULL,
  `from_location_name_snapshot` varchar(160) NOT NULL,
  `from_storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `container_no` varchar(120) NOT NULL DEFAULT '',
  `to_location_id` bigint(20) NOT NULL,
  `to_location_name_snapshot` varchar(160) NOT NULL,
  `to_storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `sku_snapshot` varchar(64) NOT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `pallets` int(11) NOT NULL DEFAULT 0,
  `source_pallets` int(11) DEFAULT NULL,
  `destination_pallets` int(11) DEFAULT NULL,
  `line_note` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_transfer_lines_transfer_id` (`transfer_id`),
  KEY `fk_inventory_transfer_lines_customer` (`customer_id`),
  KEY `fk_inventory_transfer_lines_from_location` (`from_location_id`),
  KEY `fk_inventory_transfer_lines_to_location` (`to_location_id`),
  CONSTRAINT `fk_inventory_transfer_lines_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_inventory_transfer_lines_from_location` FOREIGN KEY (`from_location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_inventory_transfer_lines_to_location` FOREIGN KEY (`to_location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_inventory_transfer_lines_transfer` FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_transfers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `transfer_no` varchar(120) NOT NULL,
  `actual_transferred_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'POSTED',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_transfers_transfer_no` (`transfer_no`),
  KEY `idx_inventory_transfers_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `outbound_container_allocations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `outbound_line_id` bigint(20) NOT NULL,
  `container_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) NOT NULL,
  `sku_master_id` bigint(20) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `section_id` bigint(20) DEFAULT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `allocated_qty` int(11) NOT NULL DEFAULT 0,
  `allocated_pallets` int(11) NOT NULL DEFAULT 0,
  `shipped_qty` int(11) NOT NULL DEFAULT 0,
  `shipped_pallets` int(11) NOT NULL DEFAULT 0,
  `status` varchar(32) NOT NULL DEFAULT 'RESERVED',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_outbound_container_allocation_bucket` (`outbound_line_id`,`container_id`,`sku_master_id`,`location_id`,`storage_section`),
  KEY `idx_outbound_container_allocations_container` (`container_id`),
  KEY `idx_outbound_container_allocations_customer` (`customer_id`),
  KEY `idx_outbound_container_allocations_sku` (`sku_master_id`),
  KEY `idx_outbound_container_allocations_location` (`location_id`),
  KEY `fk_outbound_container_allocations_section` (`section_id`),
  CONSTRAINT `fk_outbound_container_allocations_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`),
  CONSTRAINT `fk_outbound_container_allocations_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_outbound_container_allocations_line` FOREIGN KEY (`outbound_line_id`) REFERENCES `outbound_document_lines` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_outbound_container_allocations_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_outbound_container_allocations_section` FOREIGN KEY (`section_id`) REFERENCES `storage_sections` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_outbound_container_allocations_sku` FOREIGN KEY (`sku_master_id`) REFERENCES `sku_master` (`id`),
  CONSTRAINT `chk_outbound_container_allocations_nonnegative` CHECK (`allocated_qty` >= 0 and `allocated_pallets` >= 0 and `shipped_qty` >= 0 and `shipped_pallets` >= 0),
  CONSTRAINT `chk_outbound_container_allocations_capacity` CHECK (`shipped_qty` <= `allocated_qty` and `shipped_pallets` <= `allocated_pallets`),
  CONSTRAINT `chk_outbound_container_allocations_status` CHECK (`status` in ('RESERVED','SHIPPED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `outbound_document_lines` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `document_id` bigint(20) NOT NULL,
  `sku_master_id` bigint(20) NOT NULL,
  `location_id` bigint(20) NOT NULL,
  `location_name_snapshot` varchar(160) NOT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `item_number_snapshot` varchar(120) DEFAULT NULL,
  `sku_snapshot` varchar(64) NOT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `planned_quantity` int(11) NOT NULL DEFAULT 0,
  `pallets` int(11) NOT NULL DEFAULT 0,
  `pallets_detail_ctns` varchar(255) DEFAULT NULL,
  `pick_allocations_json` text DEFAULT NULL,
  `unit_label` varchar(32) DEFAULT NULL,
  `carton_size_mm` varchar(120) DEFAULT NULL,
  `net_weight_kgs` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gross_weight_kgs` decimal(12,2) NOT NULL DEFAULT 0.00,
  `line_note` varchar(255) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_outbound_document_lines_document_id` (`document_id`),
  KEY `idx_outbound_document_lines_sku_master_id` (`sku_master_id`),
  KEY `fk_outbound_document_lines_location` (`location_id`),
  CONSTRAINT `fk_outbound_document_lines_document` FOREIGN KEY (`document_id`) REFERENCES `outbound_documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_outbound_document_lines_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_outbound_document_lines_sku_master` FOREIGN KEY (`sku_master_id`) REFERENCES `sku_master` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `outbound_documents` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `packing_list_no` varchar(120) DEFAULT NULL,
  `order_ref` varchar(120) DEFAULT NULL,
  `customer_id` bigint(20) NOT NULL,
  `expected_ship_date` date DEFAULT NULL,
  `actual_ship_date` date DEFAULT NULL,
  `ship_to_name` varchar(160) DEFAULT NULL,
  `ship_to_address` varchar(255) DEFAULT NULL,
  `ship_to_contact` varchar(160) DEFAULT NULL,
  `carrier_name` varchar(160) DEFAULT NULL,
  `document_note` text DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'CONFIRMED',
  `tracking_status` varchar(32) NOT NULL DEFAULT 'SCHEDULED',
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `posted_at` timestamp NULL DEFAULT NULL,
  `cancel_note` text DEFAULT NULL,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_outbound_documents_customer_id` (`customer_id`),
  KEY `idx_outbound_documents_expected_ship_date` (`expected_ship_date`),
  KEY `idx_outbound_documents_packing_list_no` (`packing_list_no`),
  CONSTRAINT `fk_outbound_documents_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` bigint(20) NOT NULL,
  `name` varchar(190) NOT NULL,
  `checksum` char(64) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`version`),
  UNIQUE KEY `uq_schema_migrations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

-- This snapshot already contains the result of migrations 1-16. Recording
-- their exact identities prevents historical transformations from being
-- replayed over the final-form tables during a brand-new installation.
INSERT IGNORE INTO `schema_migrations` (`version`, `name`, `checksum`) VALUES
  (1, 'baseline_schema', '7d8d4da570f023b53e383668dd126a45802fb61d26b25df4109b1f77f3048327'),
  (2, 'container_centric_inventory', 'b950284f3ea6be729475b63249f0f8f4ccbcdd1dc03c89582824daaf4c1d378b'),
  (3, 'inventory_integrity_constraints', '620c822c282e1b664de78c4a60818f4ed5e22ef65edba9cf29ddfa11e8f924b1'),
  (4, 'customer_item_catalog', '9836db2d3a34863725b096c665380a13b66a94e1faae113c1df7cfd57c39f28b'),
  (5, 'stable_storage_sections', '9cc98d0f299e42dfe164553af098d363c01102132a17d281b5acd52798a1cbc2'),
  (6, 'container_pallet_profiles', '54f647b5ec647771566d0d6edca77a25fba6785e250ed4ee61f3a35421bcbe16'),
  (7, 'remove_pallet_entities', '16e144d27c607596fafc3b5a85e5d2e37e11d78320fbc49faec58bf22a28b6e7'),
  (8, 'inbound_correction_workflow', '88a67c13d9352924de09a59ba7532f5dd97b47609ebc9c6b0dde8fc21b1e2646'),
  (9, 'canonical_container_receipts', 'f802a3e95c7517a4d721de3d0d20de479ee351dc4daac93571f5e6c3c9f7812a'),
  (10, 'active_container_consistency', 'ee31edf6871fe2406c8e517148d7f3540cd92b96e8baf1c39833826cd40646d6'),
  (11, 'hard_delete_documents', '7acb53947a8c5ec94c123d25ae99fa1515e7ee0fc600ff3786a83befa3ef971f'),
  (12, 'bulk_import_retention', '9357dc8a2d451e0419f5078db32dab99562f705f8851ab7a3e838cdd0569e3ae'),
  (13, 'transfer_line_pallet_sides', 'ee96fd22ee33179d449f8a7739a86f9705959999f636f8e203ad38d147d63aff'),
  (14, 'sku_physical_profiles', 'f094ac396b00cf424d6178003ee7349e15dd57a2aec866c3b95b731adc703aa1'),
  (15, 'sku_cubes', '9861c173fb568c1fd893a8ef279565954acf27ede77567bea19a8de13ea4e9a0'),
  (16, 'v1_schema_alignment', '933ac13dc9ecb4619a0f853842a811e13a566246650ae68f12e351ed644cea79');


/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sku_master` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `item_number` varchar(120) DEFAULT NULL,
  `sku` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `category` varchar(120) NOT NULL,
  `description` text DEFAULT NULL,
  `unit` varchar(32) NOT NULL DEFAULT 'pcs',
  `reorder_level` int(11) NOT NULL DEFAULT 0,
  `default_units_per_pallet` int(11) NOT NULL DEFAULT 0,
  `carton_gross_weight_kg` decimal(12,3) NOT NULL DEFAULT 0.000,
  `cubes` decimal(12,4) NOT NULL DEFAULT 0.0000,
  `carton_length_cm` decimal(12,2) NOT NULL DEFAULT 0.00,
  `carton_width_cm` decimal(12,2) NOT NULL DEFAULT 0.00,
  `carton_height_cm` decimal(12,2) NOT NULL DEFAULT 0.00,
  `outbound_cartons_per_layer` int(11) NOT NULL DEFAULT 0,
  `outbound_layer_count` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sku_master_sku` (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `stock_ledger` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `event_type` varchar(32) NOT NULL,
  `occurred_at` timestamp NULL DEFAULT NULL,
  `sku_master_id` bigint(20) DEFAULT NULL,
  `customer_id` bigint(20) NOT NULL,
  `container_id` bigint(20) DEFAULT NULL,
  `location_id` bigint(20) NOT NULL,
  `section_id` bigint(20) DEFAULT NULL,
  `storage_section` varchar(16) NOT NULL DEFAULT 'TEMP',
  `quantity_change` int(11) NOT NULL DEFAULT 0,
  `pallet_change` decimal(12,4) NOT NULL DEFAULT 0.0000,
  `source_document_type` varchar(32) DEFAULT NULL,
  `source_document_id` bigint(20) DEFAULT NULL,
  `source_line_id` bigint(20) DEFAULT NULL,
  `container_no_snapshot` varchar(120) NOT NULL DEFAULT '',
  `delivery_date` date DEFAULT NULL,
  `out_date` date DEFAULT NULL,
  `packing_list_no` varchar(120) DEFAULT NULL,
  `order_ref` varchar(120) DEFAULT NULL,
  `item_number_snapshot` varchar(120) DEFAULT NULL,
  `description_snapshot` varchar(255) DEFAULT NULL,
  `expected_qty` int(11) NOT NULL DEFAULT 0,
  `received_qty` int(11) NOT NULL DEFAULT 0,
  `pallets` int(11) NOT NULL DEFAULT 0,
  `pallets_detail_ctns` varchar(255) DEFAULT NULL,
  `carton_size_mm` varchar(120) DEFAULT NULL,
  `carton_count` int(11) NOT NULL DEFAULT 0,
  `unit_label` varchar(32) DEFAULT NULL,
  `net_weight_kgs` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gross_weight_kgs` decimal(12,2) NOT NULL DEFAULT 0.00,
  `height_in` int(11) NOT NULL DEFAULT 0,
  `document_note` varchar(255) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `reference_code` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_stock_ledger_customer_id` (`customer_id`),
  KEY `idx_stock_ledger_event_type_created` (`event_type`,`created_at`),
  KEY `idx_stock_ledger_created_at` (`created_at`),
  KEY `idx_stock_ledger_source` (`source_document_type`,`source_document_id`),
  KEY `fk_stock_ledger_location` (`location_id`),
  KEY `idx_stock_ledger_container_id` (`container_id`),
  KEY `idx_stock_ledger_business_date` (`business_date`),
  KEY `idx_stock_ledger_customer_business_date` (`customer_id`,`business_date`),
  KEY `idx_stock_ledger_location_business_date` (`location_id`,`business_date`),
  KEY `fk_stock_ledger_section` (`section_id`),
  CONSTRAINT `fk_stock_ledger_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_stock_ledger_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_stock_ledger_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_stock_ledger_section` FOREIGN KEY (`section_id`) REFERENCES `storage_sections` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `storage_locations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `capacity` int(11) NOT NULL DEFAULT 0,
  `section_count` int(11) NOT NULL DEFAULT 1,
  `section_names_json` text DEFAULT NULL,
  `layout_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`layout_json`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_locations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `storage_sections` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `location_id` bigint(20) NOT NULL,
  `external_key` varchar(120) NOT NULL,
  `name` varchar(120) NOT NULL,
  `section_type` varchar(32) NOT NULL DEFAULT 'SECTION',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_sections_location_key` (`location_id`,`external_key`),
  UNIQUE KEY `uq_storage_sections_location_name` (`location_id`,`name`),
  UNIQUE KEY `uq_storage_sections_id_location` (`id`,`location_id`),
  CONSTRAINT `fk_storage_sections_location` FOREIGN KEY (`location_id`) REFERENCES `storage_locations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_storage_sections_name` CHECK (trim(`name`) <> ''),
  CONSTRAINT `chk_storage_sections_type` CHECK (`section_type` in ('TEMPORARY','SECTION'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `ui_preferences` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `scope_type` varchar(32) NOT NULL DEFAULT 'global',
  `scope_id` bigint(20) NOT NULL DEFAULT 0,
  `preference_key` varchar(120) NOT NULL,
  `value_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`value_json`)),
  `updated_by_user_id` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ui_preferences_scope_key` (`scope_type`,`scope_id`,`preference_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_sessions_token_hash` (`token_hash`),
  KEY `idx_user_sessions_user_id` (`user_id`),
  KEY `idx_user_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `email` varchar(190) NOT NULL,
  `full_name` varchar(160) NOT NULL,
  `role` varchar(32) NOT NULL DEFAULT 'admin',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `customer_id` bigint(20) DEFAULT NULL,
  `password_salt` varchar(32) NOT NULL DEFAULT '',
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_customer_id` (`customer_id`),
  CONSTRAINT `fk_users_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET FOREIGN_KEY_CHECKS = 1;
