package database

import (
	"database/sql"
	"fmt"
)

// applyV1SchemaAlignmentMigration establishes the v1 aggregate relationship:
// a container has many inbound receipts, and every confirmed receipt points to
// its container. Historical migrations remain immutable for deployed databases.
func applyV1SchemaAlignmentMigration(db *sql.DB) error {
	if _, err := db.Exec(`
		ALTER TABLE inbound_documents
		ADD COLUMN IF NOT EXISTS container_id BIGINT DEFAULT NULL AFTER id
	`); err != nil {
		return fmt.Errorf("add inbound receipt container relation: %w", err)
	}

	// Retire legacy archived/corrected receipts before deriving container
	// aggregates. Otherwise a superseded receipt can leak its warehouse or
	// handling metadata into the surviving container projection.
	hasInboundArchive, err := columnExists(db, "inbound_documents", "archived_at")
	if err != nil {
		return fmt.Errorf("check inbound archive column: %w", err)
	}
	hasInboundCorrection, err := columnExists(db, "inbound_documents", "corrected_at")
	if err != nil {
		return fmt.Errorf("check inbound correction column: %w", err)
	}
	if hasInboundArchive && hasInboundCorrection {
		if _, err := db.Exec(`
			UPDATE inbound_documents
			SET
				status = 'DELETED',
				cancelled_at = COALESCE(cancelled_at, archived_at, corrected_at, updated_at),
				updated_at = CURRENT_TIMESTAMP
			WHERE archived_at IS NOT NULL OR corrected_at IS NOT NULL
		`); err != nil {
			return fmt.Errorf("retire archived or corrected inbound receipts: %w", err)
		}
	} else if hasInboundArchive {
		if _, err := db.Exec(`UPDATE inbound_documents SET status = 'DELETED', cancelled_at = COALESCE(cancelled_at, archived_at, updated_at) WHERE archived_at IS NOT NULL`); err != nil {
			return fmt.Errorf("retire archived inbound receipts: %w", err)
		}
	} else if hasInboundCorrection {
		if _, err := db.Exec(`UPDATE inbound_documents SET status = 'DELETED', cancelled_at = COALESCE(cancelled_at, corrected_at, updated_at) WHERE corrected_at IS NOT NULL`); err != nil {
			return fmt.Errorf("retire corrected inbound receipts: %w", err)
		}
	}

	if _, err := db.Exec(`
		INSERT INTO containers (
			customer_id,
			location_id,
			container_no,
			container_type,
			handling_mode,
			status,
			tracking_status,
			last_event_at
		)
		SELECT
			d.customer_id,
			CASE WHEN COUNT(DISTINCT d.location_id) = 1 THEN MIN(d.location_id) ELSE NULL END,
			UPPER(TRIM(d.container_no)),
			COALESCE(MAX(NULLIF(UPPER(TRIM(d.container_type)), '')), 'NORMAL'),
			COALESCE(MAX(NULLIF(UPPER(TRIM(d.handling_mode)), '')), 'PALLETIZED'),
			'IN_STOCK',
			COALESCE(MAX(NULLIF(UPPER(TRIM(d.tracking_status)), '')), 'RECEIVED'),
			MAX(COALESCE(d.actual_arrival_date, DATE(d.confirmed_at), DATE(d.created_at)))
		FROM inbound_documents d
		WHERE COALESCE(TRIM(d.container_no), '') <> ''
		  AND UPPER(TRIM(d.status)) IN ('CONFIRMED', 'POSTED')
		GROUP BY d.customer_id, UPPER(TRIM(d.container_no))
		ON DUPLICATE KEY UPDATE
			id = LAST_INSERT_ID(id),
			location_id = VALUES(location_id),
			container_type = VALUES(container_type),
			handling_mode = VALUES(handling_mode),
			updated_at = CURRENT_TIMESTAMP
	`); err != nil {
		return fmt.Errorf("ensure receipt containers: %w", err)
	}

	if _, err := db.Exec(`
		UPDATE inbound_documents d
		JOIN containers c
		  ON c.customer_id = d.customer_id
		 AND UPPER(TRIM(c.container_no)) = UPPER(TRIM(d.container_no))
		SET d.container_id = c.id
		WHERE COALESCE(TRIM(d.container_no), '') <> ''
	`); err != nil {
		return fmt.Errorf("backfill inbound receipt container relation: %w", err)
	}

	if hasIndex, err := indexExists(db, "inbound_documents", "idx_inbound_documents_container_id"); err != nil {
		return fmt.Errorf("check inbound receipt container index: %w", err)
	} else if !hasIndex {
		if _, err := db.Exec(`CREATE INDEX idx_inbound_documents_container_id ON inbound_documents (container_id)`); err != nil {
			return fmt.Errorf("create inbound receipt container index: %w", err)
		}
	}
	if hasFK, err := foreignKeyExists(db, "inbound_documents", "fk_inbound_documents_container"); err != nil {
		return fmt.Errorf("check inbound receipt container foreign key: %w", err)
	} else if !hasFK {
		if _, err := db.Exec(`
			ALTER TABLE inbound_documents
			ADD CONSTRAINT fk_inbound_documents_container
			FOREIGN KEY (container_id) REFERENCES containers (id)
			ON DELETE RESTRICT
		`); err != nil {
			return fmt.Errorf("create inbound receipt container foreign key: %w", err)
		}
	}

	if err := dropForeignKeyIfExists(db, "containers", "fk_containers_inbound_document"); err != nil {
		return err
	}
	if err := dropIndexIfExists(db, "containers", "idx_containers_inbound_document_id"); err != nil {
		return err
	}
	if err := dropColumnIfExists(db, "containers", "inbound_document_id"); err != nil {
		return err
	}

	// Archive and correction workflows were removed before v1. The rows were
	// retired above; now remove the columns so runtime code cannot revive them.
	hasOutboundArchive, err := columnExists(db, "outbound_documents", "archived_at")
	if err != nil {
		return fmt.Errorf("check outbound archive column: %w", err)
	}
	if hasOutboundArchive {
		if _, err := db.Exec(`
		UPDATE outbound_documents
		SET
			status = 'DELETED',
			cancelled_at = COALESCE(cancelled_at, archived_at, updated_at),
			updated_at = CURRENT_TIMESTAMP
		WHERE archived_at IS NOT NULL
		`); err != nil {
			return fmt.Errorf("retire archived outbound shipments: %w", err)
		}
	}
	for _, index := range []struct {
		table string
		name  string
	}{
		{"inbound_documents", "idx_inbound_documents_corrects_document_id"},
		{"inbound_documents", "idx_inbound_documents_corrected_by_document_id"},
	} {
		if err := dropIndexIfExists(db, index.table, index.name); err != nil {
			return err
		}
	}
	for _, column := range []struct {
		table string
		name  string
	}{
		{"inbound_documents", "corrects_document_id"},
		{"inbound_documents", "corrected_by_document_id"},
		{"inbound_documents", "corrected_at"},
		{"inbound_documents", "archived_at"},
		{"outbound_documents", "archived_at"},
	} {
		if err := dropColumnIfExists(db, column.table, column.name); err != nil {
			return err
		}
	}
	return nil
}
