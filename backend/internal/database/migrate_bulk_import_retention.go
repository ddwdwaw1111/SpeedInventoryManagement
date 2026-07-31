package database

import (
	"database/sql"
	"fmt"
)

// applyBulkImportRetentionMigration creates the import provenance tables for
// databases whose baseline migration was journaled before these tables were
// added to the fresh-install schema.
func applyBulkImportRetentionMigration(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS bulk_import_batches (
			id BIGINT NOT NULL AUTO_INCREMENT,
			import_id CHAR(32) NOT NULL,
			import_type VARCHAR(16) NOT NULL,
			customer_id BIGINT NOT NULL,
			customer_name_snapshot VARCHAR(160) NOT NULL DEFAULT '',
			source_file_name VARCHAR(255) NOT NULL,
			content_type VARCHAR(120) NOT NULL,
			file_size_bytes BIGINT NOT NULL DEFAULT 0,
			file_sha256 CHAR(64) NOT NULL,
			original_file LONGBLOB NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'UPLOADED',
			total_documents INT NOT NULL DEFAULT 0,
			valid_documents INT NOT NULL DEFAULT 0,
			invalid_documents INT NOT NULL DEFAULT 0,
			total_lines INT NOT NULL DEFAULT 0,
			created_documents INT NOT NULL DEFAULT 0,
			failed_documents INT NOT NULL DEFAULT 0,
			error_message TEXT DEFAULT NULL,
			created_by_user_id BIGINT NOT NULL,
			created_by_name_snapshot VARCHAR(160) NOT NULL DEFAULT '',
			created_by_email_snapshot VARCHAR(190) NOT NULL DEFAULT '',
			committed_at TIMESTAMP NULL DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_bulk_import_batches_import_id (import_id),
			KEY idx_bulk_import_batches_type_created (import_type, created_at, id),
			KEY idx_bulk_import_batches_customer_created (customer_id, created_at, id),
			KEY idx_bulk_import_batches_created_by (created_by_user_id, created_at, id)
		)`,
		`CREATE TABLE IF NOT EXISTS bulk_import_batch_documents (
			id BIGINT NOT NULL AUTO_INCREMENT,
			batch_id BIGINT NOT NULL,
			document_key VARCHAR(190) NOT NULL DEFAULT '',
			document_id BIGINT DEFAULT NULL,
			reference_code VARCHAR(190) NOT NULL DEFAULT '',
			status VARCHAR(32) NOT NULL,
			error_message TEXT DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_bulk_import_batch_documents_batch (batch_id, id),
			KEY idx_bulk_import_batch_documents_document (document_id),
			UNIQUE KEY uq_bulk_import_batch_documents_key (batch_id, document_key),
			CONSTRAINT fk_bulk_import_batch_documents_batch
				FOREIGN KEY (batch_id) REFERENCES bulk_import_batches (id)
				ON DELETE CASCADE
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_import_batch_documents_key
			ON bulk_import_batch_documents (batch_id, document_key)`,
	}

	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("apply bulk import retention migration %q: %w", statement, err)
		}
	}
	return nil
}
