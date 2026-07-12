package database

import (
	"database/sql"
	"fmt"
)

type integrityCheck struct {
	name  string
	query string
}

type checkConstraint struct {
	table      string
	name       string
	expression string
}

func applyInventoryIntegrityConstraintsMigration(db *sql.DB) error {
	checks := []integrityCheck{
		{
			name: "inventory item balances",
			query: `SELECT COUNT(*) FROM inventory_items
				WHERE quantity < 0 OR allocated_qty < 0 OR damaged_qty < 0 OR hold_qty < 0
					OR pallets < 0 OR allocated_pallets < 0
					OR allocated_qty + damaged_qty + hold_qty > quantity
					OR allocated_pallets > pallets`,
		},
		{
			name: "outbound container allocations",
			query: `SELECT COUNT(*) FROM outbound_container_allocations
				WHERE allocated_qty < 0 OR allocated_pallets < 0 OR shipped_qty < 0 OR shipped_pallets < 0
					OR shipped_qty > allocated_qty OR shipped_pallets > allocated_pallets
					OR status NOT IN ('RESERVED', 'SHIPPED', 'CANCELLED')`,
		},
		{
			name:  "container lifecycle identifiers",
			query: `SELECT COUNT(*) FROM container_lifecycle_events WHERE TRIM(container_no) = ''`,
		},
	}
	for _, check := range checks {
		var invalidRows int64
		if err := db.QueryRow(check.query).Scan(&invalidRows); err != nil {
			return fmt.Errorf("validate %s: %w", check.name, err)
		}
		if invalidRows > 0 {
			return fmt.Errorf("cannot add database constraints: %s contains %d invalid rows", check.name, invalidRows)
		}
	}

	constraints := []checkConstraint{
		{table: "inventory_items", name: "chk_inventory_items_nonnegative", expression: "quantity >= 0 AND allocated_qty >= 0 AND damaged_qty >= 0 AND hold_qty >= 0 AND pallets >= 0 AND allocated_pallets >= 0"},
		{table: "inventory_items", name: "chk_inventory_items_quantity_capacity", expression: "allocated_qty + damaged_qty + hold_qty <= quantity"},
		{table: "inventory_items", name: "chk_inventory_items_pallet_capacity", expression: "allocated_pallets <= pallets"},
		{table: "outbound_container_allocations", name: "chk_outbound_container_allocations_nonnegative", expression: "allocated_qty >= 0 AND allocated_pallets >= 0 AND shipped_qty >= 0 AND shipped_pallets >= 0"},
		{table: "outbound_container_allocations", name: "chk_outbound_container_allocations_capacity", expression: "shipped_qty <= allocated_qty AND shipped_pallets <= allocated_pallets"},
		{table: "outbound_container_allocations", name: "chk_outbound_container_allocations_status", expression: "status IN ('RESERVED', 'SHIPPED', 'CANCELLED')"},
		{table: "container_lifecycle_events", name: "chk_container_lifecycle_container_no", expression: "TRIM(container_no) <> ''"},
	}
	for _, constraint := range constraints {
		exists, err := checkConstraintExists(db, constraint.table, constraint.name)
		if err != nil {
			return fmt.Errorf("check constraint %s: %w", constraint.name, err)
		}
		if exists {
			continue
		}
		statement := fmt.Sprintf(
			"ALTER TABLE `%s` ADD CONSTRAINT `%s` CHECK (%s)",
			constraint.table,
			constraint.name,
			constraint.expression,
		)
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("add constraint %s: %w", constraint.name, err)
		}
	}

	return nil
}

func checkConstraintExists(db *sql.DB, tableName string, constraintName string) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.TABLE_CONSTRAINTS
		WHERE CONSTRAINT_SCHEMA = DATABASE()
			AND TABLE_NAME = ?
			AND CONSTRAINT_NAME = ?
			AND CONSTRAINT_TYPE = 'CHECK'
	`, tableName, constraintName).Scan(&count)
	return count > 0, err
}
