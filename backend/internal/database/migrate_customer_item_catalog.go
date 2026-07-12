package database

import (
	"database/sql"
	"fmt"
)

func applyCustomerItemCatalogMigration(db *sql.DB) error {
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS customer_item_catalog (
			id BIGINT NOT NULL AUTO_INCREMENT,
			customer_id BIGINT NOT NULL,
			sku_master_id BIGINT NOT NULL,
			item_number VARCHAR(120) DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_customer_item_catalog_sku (customer_id, sku_master_id),
			UNIQUE KEY uq_customer_item_catalog_item_number (customer_id, item_number),
			KEY idx_customer_item_catalog_sku_master (sku_master_id),
			CONSTRAINT fk_customer_item_catalog_customer
				FOREIGN KEY (customer_id) REFERENCES customers (id)
				ON DELETE CASCADE,
			CONSTRAINT fk_customer_item_catalog_sku_master
				FOREIGN KEY (sku_master_id) REFERENCES sku_master (id)
				ON DELETE CASCADE
		)
	`); err != nil {
		return fmt.Errorf("create customer item catalog: %w", err)
	}

	var conflicts int64
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM (
			SELECT i.customer_id, UPPER(TRIM(sm.item_number)) AS item_number
			FROM inventory_items i
			JOIN sku_master sm ON sm.id = i.sku_master_id
			WHERE COALESCE(TRIM(sm.item_number), '') <> ''
			GROUP BY i.customer_id, UPPER(TRIM(sm.item_number))
			HAVING COUNT(DISTINCT i.sku_master_id) > 1
		) conflicts
	`).Scan(&conflicts); err != nil {
		return fmt.Errorf("validate customer item codes: %w", err)
	}
	if conflicts > 0 {
		return fmt.Errorf("cannot build customer item catalog: %d customer item codes are assigned to multiple SKUs", conflicts)
	}

	if _, err := db.Exec(`
		INSERT INTO customer_item_catalog (customer_id, sku_master_id, item_number)
		SELECT DISTINCT
			i.customer_id,
			i.sku_master_id,
			NULLIF(UPPER(TRIM(sm.item_number)), '')
		FROM inventory_items i
		JOIN sku_master sm ON sm.id = i.sku_master_id
		ON DUPLICATE KEY UPDATE
			item_number = COALESCE(customer_item_catalog.item_number, VALUES(item_number))
	`); err != nil {
		return fmt.Errorf("backfill customer item catalog: %w", err)
	}

	return nil
}
