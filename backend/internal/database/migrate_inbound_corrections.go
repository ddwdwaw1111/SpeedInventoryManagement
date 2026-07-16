package database

import (
	"database/sql"
	"fmt"
)

func applyInboundCorrectionWorkflowMigration(db *sql.DB) error {
	statements := []string{
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS corrects_document_id BIGINT DEFAULT NULL AFTER archived_at`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS corrected_by_document_id BIGINT DEFAULT NULL AFTER corrects_document_id`,
		`ALTER TABLE inbound_documents ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMP NULL DEFAULT NULL AFTER corrected_by_document_id`,
		`CREATE INDEX IF NOT EXISTS idx_inbound_documents_corrects_document_id ON inbound_documents (corrects_document_id)`,
		`CREATE INDEX IF NOT EXISTS idx_inbound_documents_corrected_by_document_id ON inbound_documents (corrected_by_document_id)`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply inbound correction workflow migration %q: %w", statement, err)
		}
	}
	return nil
}
