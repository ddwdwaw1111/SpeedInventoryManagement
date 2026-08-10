package database

import (
	"database/sql"
	"fmt"
)

// applyBillingLineProvenanceMigration promotes operational source identifiers
// out of details_json so invoice lines can be queried and audited directly.
func applyBillingLineProvenanceMigration(db *sql.DB) error {
	columns := []struct {
		name       string
		definition string
	}{
		{"source_document_type", "VARCHAR(32) DEFAULT NULL AFTER source_type"},
		{"source_document_id", "BIGINT DEFAULT NULL AFTER source_document_type"},
		{"source_line_id", "BIGINT DEFAULT NULL AFTER source_document_id"},
	}
	for _, column := range columns {
		exists, err := columnExists(db, "billing_invoice_lines", column.name)
		if err != nil {
			return fmt.Errorf("check billing invoice line %s column: %w", column.name, err)
		}
		if exists {
			continue
		}
		if _, err := db.Exec(fmt.Sprintf(
			"ALTER TABLE billing_invoice_lines ADD COLUMN %s %s",
			column.name,
			column.definition,
		)); err != nil {
			return fmt.Errorf("add billing invoice line %s column: %w", column.name, err)
		}
	}
	if _, err := db.Exec(`
		UPDATE billing_invoice_lines
		SET
			source_document_type = NULLIF(UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.sourceType')))), ''),
			source_document_id = CAST(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.sourceId')), ''), '0') AS SIGNED),
			source_line_id = CAST(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.sourceLineId')), ''), '0') AS SIGNED)
		WHERE source_type = 'AUTO'
		  AND details_json IS NOT NULL
		  AND JSON_VALID(details_json)
		  AND source_document_type IS NULL
	`); err != nil {
		return fmt.Errorf("backfill billing invoice line provenance: %w", err)
	}

	hasIndex, err := indexExists(db, "billing_invoice_lines", "idx_billing_invoice_lines_source_document")
	if err != nil {
		return fmt.Errorf("check billing invoice line source index: %w", err)
	}
	if !hasIndex {
		if _, err := db.Exec(`
			CREATE INDEX idx_billing_invoice_lines_source_document
			ON billing_invoice_lines (source_document_type, source_document_id, source_line_id)
		`); err != nil {
			return fmt.Errorf("create billing invoice line source index: %w", err)
		}
	}
	return nil
}
