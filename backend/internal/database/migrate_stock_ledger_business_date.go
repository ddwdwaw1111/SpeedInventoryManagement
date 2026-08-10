package database

import (
	"database/sql"
	"fmt"
)

// applyStockLedgerBusinessDateMigration materializes the date semantics used by
// operational reports. Keeping the expression in one generated column lets the
// database use range indexes instead of evaluating CASE/COALESCE for every row.
func applyStockLedgerBusinessDateMigration(db *sql.DB) error {
	exists, err := columnExists(db, "stock_ledger", "business_date")
	if err != nil {
		return fmt.Errorf("check stock ledger business date column: %w", err)
	}
	if !exists {
		if _, err := db.Exec(`
			ALTER TABLE stock_ledger
			ADD COLUMN business_date DATETIME
			GENERATED ALWAYS AS (
				CASE
					WHEN event_type IN ('SHIP', 'REVERSAL') THEN COALESCE(out_date, occurred_at, created_at)
					WHEN event_type = 'RECEIVE' THEN COALESCE(delivery_date, occurred_at, created_at)
					ELSE COALESCE(occurred_at, created_at)
				END
			) STORED
		`); err != nil {
			return fmt.Errorf("add stock ledger business date column: %w", err)
		}
	}

	indexes := []struct {
		name    string
		columns string
	}{
		{"idx_stock_ledger_business_date", "business_date"},
		{"idx_stock_ledger_customer_business_date", "customer_id, business_date"},
		{"idx_stock_ledger_location_business_date", "location_id, business_date"},
	}
	for _, index := range indexes {
		hasIndex, err := indexExists(db, "stock_ledger", index.name)
		if err != nil {
			return fmt.Errorf("check stock ledger %s index: %w", index.name, err)
		}
		if hasIndex {
			continue
		}
		if _, err := db.Exec(fmt.Sprintf("CREATE INDEX %s ON stock_ledger (%s)", index.name, index.columns)); err != nil {
			return fmt.Errorf("create stock ledger %s index: %w", index.name, err)
		}
	}
	return nil
}
