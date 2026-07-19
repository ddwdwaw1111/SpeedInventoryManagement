package database

import "database/sql"

// applyHardDeleteDocumentsMigration keeps the historical migration identity but
// only applies the schema required by the current outbound model. Existing
// operational data is deliberately left untouched; old rows are interpreted
// compatibly by the read path instead of being rewritten during startup.
func applyHardDeleteDocumentsMigration(db *sql.DB) error {
	_, err := db.Exec(`ALTER TABLE outbound_document_lines ADD COLUMN IF NOT EXISTS planned_quantity INT NOT NULL DEFAULT 0 AFTER quantity`)
	return err
}
