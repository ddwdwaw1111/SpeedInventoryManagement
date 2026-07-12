package database

import (
	"database/sql"
	"fmt"
)

func applyRemovePalletEntitiesMigration(db *sql.DB) error {
	addColumnStatements := []string{
		`ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL DEFAULT '' AFTER storage_section`,
		`ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS before_pallets INT NOT NULL DEFAULT 0 AFTER after_qty`,
		`ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS adjust_pallets INT NOT NULL DEFAULT 0 AFTER before_pallets`,
		`ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS after_pallets INT NOT NULL DEFAULT 0 AFTER adjust_pallets`,
		`ALTER TABLE inventory_transfer_lines ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL DEFAULT '' AFTER from_storage_section`,
		`ALTER TABLE inventory_transfer_lines ADD COLUMN IF NOT EXISTS pallets INT NOT NULL DEFAULT 0 AFTER quantity`,
		`ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS container_no VARCHAR(120) NOT NULL DEFAULT '' AFTER storage_section`,
		`ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS system_pallets INT NOT NULL DEFAULT 0 AFTER variance_qty`,
		`ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS counted_pallets INT NOT NULL DEFAULT 0 AFTER system_pallets`,
		`ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS variance_pallets INT NOT NULL DEFAULT 0 AFTER counted_pallets`,
	}
	for _, statement := range addColumnStatements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("prepare pallet entity removal %q: %w", statement, err)
		}
	}

	backfills := []conditionalMigrationStatement{
		{
			name:   "stock ledger SKU from pallet entities",
			tables: []string{"stock_ledger", "pallet_items", "pallets"},
			columns: []migrationColumn{
				{table: "stock_ledger", name: "pallet_item_id"},
				{table: "stock_ledger", name: "pallet_id"},
				{table: "stock_ledger", name: "sku_master_id"},
			},
			statement: `UPDATE stock_ledger sl
		LEFT JOIN pallet_items pi ON pi.id = sl.pallet_item_id
		LEFT JOIN pallets p ON p.id = sl.pallet_id
		SET sl.sku_master_id = COALESCE(sl.sku_master_id, pi.sku_master_id, p.sku_master_id)
		WHERE sl.sku_master_id IS NULL`,
		},
		{
			name:   "container lifecycle SKU from stock ledger",
			tables: []string{"container_lifecycle_events", "stock_ledger"},
			columns: []migrationColumn{
				{table: "container_lifecycle_events", name: "stock_ledger_id"},
				{table: "container_lifecycle_events", name: "sku_master_id"},
				{table: "stock_ledger", name: "sku_master_id"},
			},
			statement: `UPDATE container_lifecycle_events cle
		JOIN stock_ledger sl ON sl.id = cle.stock_ledger_id
		SET cle.sku_master_id = COALESCE(cle.sku_master_id, sl.sku_master_id)
		WHERE cle.sku_master_id IS NULL`,
		},
		{
			name:   "inventory adjustment container and pallets",
			tables: []string{"inventory_adjustment_lines", "stock_ledger"},
			columns: []migrationColumn{
				{table: "inventory_adjustment_lines", name: "container_no"},
				{table: "inventory_adjustment_lines", name: "adjust_pallets"},
				{table: "stock_ledger", name: "source_line_id"},
				{table: "stock_ledger", name: "container_no_snapshot"},
				{table: "stock_ledger", name: "pallet_change"},
			},
			statement: `UPDATE inventory_adjustment_lines line
		JOIN (
			SELECT source_line_id, MAX(container_no_snapshot) AS container_no, ROUND(SUM(pallet_change)) AS pallet_delta
			FROM stock_ledger
			WHERE source_document_type = 'ADJUSTMENT'
			GROUP BY source_line_id
		) ledger ON ledger.source_line_id = line.id
		SET line.container_no = ledger.container_no,
			line.adjust_pallets = ledger.pallet_delta`,
		},
		{
			name:   "inventory transfer container and pallets",
			tables: []string{"inventory_transfer_lines", "stock_ledger"},
			columns: []migrationColumn{
				{table: "inventory_transfer_lines", name: "container_no"},
				{table: "inventory_transfer_lines", name: "pallets"},
				{table: "stock_ledger", name: "source_line_id"},
				{table: "stock_ledger", name: "container_no_snapshot"},
				{table: "stock_ledger", name: "pallet_change"},
			},
			statement: `UPDATE inventory_transfer_lines line
		JOIN (
			SELECT source_line_id, MAX(container_no_snapshot) AS container_no, ROUND(ABS(SUM(pallet_change))) AS pallets
			FROM stock_ledger
			WHERE source_document_type = 'TRANSFER' AND event_type = 'TRANSFER_OUT'
			GROUP BY source_line_id
		) ledger ON ledger.source_line_id = line.id
		SET line.container_no = ledger.container_no,
			line.pallets = ledger.pallets`,
		},
		{
			name:   "cycle count container and pallet balances",
			tables: []string{"cycle_count_lines", "stock_ledger"},
			columns: []migrationColumn{
				{table: "cycle_count_lines", name: "container_no"},
				{table: "cycle_count_lines", name: "system_pallets"},
				{table: "cycle_count_lines", name: "counted_pallets"},
				{table: "cycle_count_lines", name: "variance_pallets"},
				{table: "stock_ledger", name: "source_line_id"},
				{table: "stock_ledger", name: "sku_master_id"},
				{table: "stock_ledger", name: "container_no_snapshot"},
				{table: "stock_ledger", name: "pallet_change"},
			},
			statement: `UPDATE cycle_count_lines line
		JOIN (
			SELECT
				count_event.source_line_id,
				count_event.container_no,
				count_event.pallet_delta,
				(
					SELECT ROUND(COALESCE(SUM(prior.pallet_change), 0))
					FROM stock_ledger prior
					WHERE prior.id < count_event.first_ledger_id
						AND prior.sku_master_id <=> count_event.sku_master_id
						AND prior.customer_id = count_event.customer_id
						AND prior.location_id = count_event.location_id
						AND COALESCE(NULLIF(prior.storage_section, ''), 'TEMP') = count_event.storage_section
						AND COALESCE(prior.container_no_snapshot, '') = count_event.container_no
				) AS system_pallets
			FROM (
				SELECT
					source_line_id,
					MIN(id) AS first_ledger_id,
					MAX(sku_master_id) AS sku_master_id,
					MAX(customer_id) AS customer_id,
					MAX(location_id) AS location_id,
					COALESCE(NULLIF(MAX(storage_section), ''), 'TEMP') AS storage_section,
					COALESCE(MAX(container_no_snapshot), '') AS container_no,
					ROUND(SUM(pallet_change)) AS pallet_delta
				FROM stock_ledger
				WHERE source_document_type = 'CYCLE_COUNT'
				GROUP BY source_line_id
			) count_event
		) ledger ON ledger.source_line_id = line.id
		SET line.container_no = ledger.container_no,
			line.system_pallets = GREATEST(ledger.system_pallets, 0),
			line.variance_pallets = ledger.pallet_delta,
			line.counted_pallets = GREATEST(ledger.system_pallets + ledger.pallet_delta, 0)`,
		},
	}
	for _, backfill := range backfills {
		if err := executeConditionalMigrationStatement(db, backfill); err != nil {
			return err
		}
	}

	foreignKeys := []struct{ table, name string }{
		{"stock_ledger", "fk_stock_ledger_pallet"},
	}
	for _, key := range foreignKeys {
		if err := dropForeignKeyIfExists(db, key.table, key.name); err != nil {
			return err
		}
	}

	indexes := []struct{ table, name string }{
		{"stock_ledger", "idx_stock_ledger_pallet_id"},
		{"stock_ledger", "idx_stock_ledger_pallet_item_id"},
		{"container_lifecycle_events", "idx_container_lifecycle_pallet_id"},
		{"inventory_adjustment_lines", "idx_inventory_adjustment_lines_pallet_id"},
	}
	for _, index := range indexes {
		if err := dropIndexIfExists(db, index.table, index.name); err != nil {
			return err
		}
	}

	columns := []struct{ table, name string }{
		{"stock_ledger", "pallet_item_id"},
		{"stock_ledger", "pallet_id"},
		{"container_lifecycle_events", "pallet_item_id"},
		{"container_lifecycle_events", "pallet_id"},
		{"inventory_adjustment_lines", "pallet_code_snapshot"},
		{"inventory_adjustment_lines", "pallet_id"},
		{"inventory_adjustment_lines", "pallet_before_qty"},
		{"inventory_adjustment_lines", "pallet_after_qty"},
		{"outbound_document_lines", "pick_pallets_json"},
	}
	for _, column := range columns {
		if err := dropColumnIfExists(db, column.table, column.name); err != nil {
			return err
		}
	}

	for _, table := range []string{
		"outbound_picks",
		"pallet_location_events",
		"pallet_rework_event_pallets",
		"pallet_rework_events",
		"container_pallet_profiles",
		"pallet_items",
		"pallets",
	} {
		if _, err := db.Exec("DROP TABLE IF EXISTS " + table); err != nil {
			return fmt.Errorf("drop deprecated table %s: %w", table, err)
		}
	}

	return nil
}

type migrationColumn struct {
	table string
	name  string
}

type conditionalMigrationStatement struct {
	name      string
	tables    []string
	columns   []migrationColumn
	statement string
}

func executeConditionalMigrationStatement(db *sql.DB, input conditionalMigrationStatement) error {
	for _, table := range input.tables {
		exists, err := tableExists(db, table)
		if err != nil {
			return fmt.Errorf("check %s backfill table %s: %w", input.name, table, err)
		}
		if !exists {
			return nil
		}
	}
	for _, column := range input.columns {
		exists, err := columnExists(db, column.table, column.name)
		if err != nil {
			return fmt.Errorf("check %s backfill column %s.%s: %w", input.name, column.table, column.name, err)
		}
		if !exists {
			return nil
		}
	}
	if _, err := db.Exec(input.statement); err != nil {
		return fmt.Errorf("apply %s backfill: %w", input.name, err)
	}
	return nil
}

func dropForeignKeyIfExists(db *sql.DB, table string, name string) error {
	exists, err := foreignKeyExists(db, table, name)
	if err != nil {
		return fmt.Errorf("check foreign key %s.%s: %w", table, name, err)
	}
	if !exists {
		return nil
	}
	if _, err := db.Exec("ALTER TABLE " + table + " DROP FOREIGN KEY " + name); err != nil {
		return fmt.Errorf("drop foreign key %s.%s: %w", table, name, err)
	}
	return nil
}

func dropIndexIfExists(db *sql.DB, table string, name string) error {
	exists, err := indexExists(db, table, name)
	if err != nil {
		return fmt.Errorf("check index %s.%s: %w", table, name, err)
	}
	if !exists {
		return nil
	}
	if _, err := db.Exec("ALTER TABLE " + table + " DROP INDEX " + name); err != nil {
		return fmt.Errorf("drop index %s.%s: %w", table, name, err)
	}
	return nil
}

func dropColumnIfExists(db *sql.DB, table string, name string) error {
	exists, err := columnExists(db, table, name)
	if err != nil {
		return fmt.Errorf("check column %s.%s: %w", table, name, err)
	}
	if !exists {
		return nil
	}
	if _, err := db.Exec("ALTER TABLE " + table + " DROP COLUMN " + name); err != nil {
		return fmt.Errorf("drop column %s.%s: %w", table, name, err)
	}
	return nil
}
