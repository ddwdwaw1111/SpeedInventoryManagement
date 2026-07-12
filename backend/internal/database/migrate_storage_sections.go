package database

import (
	"database/sql"
	"fmt"
)

func applyStableStorageSectionsMigration(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS storage_sections (
			id BIGINT NOT NULL AUTO_INCREMENT,
			location_id BIGINT NOT NULL,
			external_key VARCHAR(120) NOT NULL,
			name VARCHAR(120) NOT NULL,
			section_type VARCHAR(32) NOT NULL DEFAULT 'SECTION',
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_storage_sections_location_key (location_id, external_key),
			UNIQUE KEY uq_storage_sections_location_name (location_id, name),
			UNIQUE KEY uq_storage_sections_id_location (id, location_id),
			CONSTRAINT fk_storage_sections_location
				FOREIGN KEY (location_id) REFERENCES storage_locations (id)
				ON DELETE CASCADE,
			CONSTRAINT chk_storage_sections_name CHECK (TRIM(name) <> ''),
			CONSTRAINT chk_storage_sections_type CHECK (section_type IN ('TEMPORARY', 'SECTION'))
		)`,
		`INSERT INTO storage_sections (location_id, external_key, name, section_type)
		SELECT
			l.id,
			COALESCE(NULLIF(TRIM(jt.external_key), ''), CONCAT('legacy-', LOWER(TRIM(jt.block_name)))),
			CASE WHEN LOWER(TRIM(jt.block_type)) = 'temporary' THEN 'TEMP' ELSE UPPER(TRIM(jt.block_name)) END,
			CASE WHEN LOWER(TRIM(jt.block_type)) = 'temporary' THEN 'TEMPORARY' ELSE 'SECTION' END
		FROM storage_locations l
		JOIN JSON_TABLE(
			COALESCE(l.layout_json, JSON_ARRAY()),
			'$[*]' COLUMNS (
				external_key VARCHAR(120) PATH '$.id',
				block_name VARCHAR(120) PATH '$.name',
				block_type VARCHAR(32) PATH '$.type'
			)
		) jt
		WHERE LOWER(TRIM(jt.block_type)) IN ('temporary', 'section')
			AND COALESCE(TRIM(jt.block_name), '') <> ''
		ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			section_type = VALUES(section_type),
			is_active = TRUE`,
		`INSERT INTO storage_sections (location_id, external_key, name, section_type)
		SELECT id, 'temp-area', 'TEMP', 'TEMPORARY'
		FROM storage_locations
		ON DUPLICATE KEY UPDATE is_active = TRUE`,
		`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS section_id BIGINT DEFAULT NULL AFTER location_id`,
		`ALTER TABLE pallets ADD COLUMN IF NOT EXISTS current_section_id BIGINT DEFAULT NULL AFTER current_location_id`,
		`ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS section_id BIGINT DEFAULT NULL AFTER location_id`,
		`ALTER TABLE container_lifecycle_events ADD COLUMN IF NOT EXISTS section_id BIGINT DEFAULT NULL AFTER location_id`,
		`ALTER TABLE outbound_container_allocations ADD COLUMN IF NOT EXISTS section_id BIGINT DEFAULT NULL AFTER location_id`,
		`UPDATE inventory_items i
		JOIN storage_sections ss ON ss.location_id = i.location_id AND ss.name = COALESCE(NULLIF(UPPER(TRIM(i.storage_section)), ''), 'TEMP')
		SET i.section_id = ss.id
		WHERE i.section_id IS NULL`,
		`UPDATE pallets p
		JOIN storage_sections ss ON ss.location_id = p.current_location_id AND ss.name = COALESCE(NULLIF(UPPER(TRIM(p.current_storage_section)), ''), 'TEMP')
		SET p.current_section_id = ss.id
		WHERE p.current_section_id IS NULL`,
		`UPDATE stock_ledger sl
		JOIN storage_sections ss ON ss.location_id = sl.location_id AND ss.name = COALESCE(NULLIF(UPPER(TRIM(sl.storage_section)), ''), 'TEMP')
		SET sl.section_id = ss.id
		WHERE sl.section_id IS NULL`,
		`UPDATE container_lifecycle_events cle
		JOIN storage_sections ss ON ss.location_id = cle.location_id AND ss.name = COALESCE(NULLIF(UPPER(TRIM(cle.storage_section)), ''), 'TEMP')
		SET cle.section_id = ss.id
		WHERE cle.section_id IS NULL`,
		`UPDATE outbound_container_allocations oca
		JOIN storage_sections ss ON ss.location_id = oca.location_id AND ss.name = COALESCE(NULLIF(UPPER(TRIM(oca.storage_section)), ''), 'TEMP')
		SET oca.section_id = ss.id
		WHERE oca.section_id IS NULL`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply stable storage sections migration %q: %w", statement, err)
		}
	}

	foreignKeys := []struct {
		table  string
		name   string
		column string
	}{
		{table: "inventory_items", name: "fk_inventory_items_section", column: "section_id"},
		{table: "pallets", name: "fk_pallets_current_section", column: "current_section_id"},
		{table: "stock_ledger", name: "fk_stock_ledger_section", column: "section_id"},
		{table: "container_lifecycle_events", name: "fk_container_lifecycle_section", column: "section_id"},
		{table: "outbound_container_allocations", name: "fk_outbound_container_allocations_section", column: "section_id"},
	}
	for _, foreignKey := range foreignKeys {
		exists, err := foreignKeyExists(db, foreignKey.table, foreignKey.name)
		if err != nil {
			return fmt.Errorf("check %s: %w", foreignKey.name, err)
		}
		if exists {
			continue
		}
		statement := fmt.Sprintf(
			"ALTER TABLE `%s` ADD CONSTRAINT `%s` FOREIGN KEY (`%s`) REFERENCES storage_sections (`id`) ON DELETE SET NULL",
			foreignKey.table,
			foreignKey.name,
			foreignKey.column,
		)
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("add %s: %w", foreignKey.name, err)
		}
	}

	return nil
}
