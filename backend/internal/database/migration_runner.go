package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

const migrationLockName = "speed_inventory_schema_migrations"

type schemaMigration struct {
	Version  int64
	Name     string
	Revision string
	Apply    func(*sql.DB) error
}

var schemaMigrations = []schemaMigration{
	{
		Version:  1,
		Name:     "baseline_schema",
		Revision: "2026-07-11.1",
		Apply:    applyBaselineSchemaMigration,
	},
	{
		Version:  2,
		Name:     "container_centric_inventory",
		Revision: "2026-07-11.1",
		Apply:    applyContainerCentricInventoryMigration,
	},
	{
		Version:  3,
		Name:     "inventory_integrity_constraints",
		Revision: "2026-07-11.1",
		Apply:    applyInventoryIntegrityConstraintsMigration,
	},
	{
		Version:  4,
		Name:     "customer_item_catalog",
		Revision: "2026-07-11.1",
		Apply:    applyCustomerItemCatalogMigration,
	},
	{
		Version:  5,
		Name:     "stable_storage_sections",
		Revision: "2026-07-11.1",
		Apply:    applyStableStorageSectionsMigration,
	},
	{
		Version:  6,
		Name:     "container_pallet_profiles",
		Revision: "2026-07-11.1",
		Apply:    applyContainerPalletProfilesMigration,
	},
	{
		Version:  7,
		Name:     "remove_pallet_entities",
		Revision: "2026-07-11.2",
		Apply:    applyRemovePalletEntitiesMigration,
	},
	{
		Version:  8,
		Name:     "inbound_correction_workflow",
		Revision: "2026-07-15.1",
		Apply:    applyInboundCorrectionWorkflowMigration,
	},
	{
		Version:  9,
		Name:     "canonical_container_receipts",
		Revision: "2026-07-16.1",
		Apply:    applyPreviouslyDeployedMigration,
	},
	{
		Version:  10,
		Name:     "active_container_consistency",
		Revision: "2026-07-16.1",
		Apply:    applyPreviouslyDeployedMigration,
	},
	{
		Version:  11,
		Name:     "hard_delete_documents",
		Revision: "2026-07-18.1",
		Apply:    applyHardDeleteDocumentsMigration,
	},
	{
		Version:  12,
		Name:     "bulk_import_retention",
		Revision: "2026-07-30.1",
		Apply:    applyBulkImportRetentionMigration,
	},
	{
		Version:  13,
		Name:     "transfer_line_pallet_sides",
		Revision: "2026-07-31.1",
		Apply:    applyTransferLinePalletSidesMigration,
	},
}

// Versions 9 and 10 were deployed before their source migrations were merged.
// Keep their original journal identities so existing databases can continue
// upgrading. Their final schema is already represented by the baseline and the
// later idempotent migrations.
func applyPreviouslyDeployedMigration(_ *sql.DB) error {
	return nil
}

// Migrate applies each schema migration exactly once. MariaDB DDL auto-commits,
// so migrations remain individually idempotent and are journaled only after the
// complete migration succeeds. The advisory lock serializes concurrent app
// instances during production startup.
func Migrate(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}

	lockCtx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	lockConn, err := db.Conn(lockCtx)
	if err != nil {
		return fmt.Errorf("open migration lock connection: %w", err)
	}
	defer lockConn.Close()

	var acquired sql.NullInt64
	if err := lockConn.QueryRowContext(lockCtx, `SELECT GET_LOCK(?, 60)`, migrationLockName).Scan(&acquired); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	if !acquired.Valid || acquired.Int64 != 1 {
		return fmt.Errorf("migration lock was not acquired")
	}
	defer func() {
		_, _ = lockConn.ExecContext(context.Background(), `SELECT RELEASE_LOCK(?)`, migrationLockName)
	}()
	ctx := context.Background()

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT NOT NULL,
			name VARCHAR(190) NOT NULL,
			checksum CHAR(64) NOT NULL,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (version),
			UNIQUE KEY uq_schema_migrations_name (name)
		)
	`); err != nil {
		return fmt.Errorf("create migration journal: %w", err)
	}

	for _, migration := range schemaMigrations {
		checksum := migrationChecksum(migration)
		var storedChecksum string
		err := db.QueryRowContext(ctx, `
			SELECT checksum
			FROM schema_migrations
			WHERE version = ?
		`, migration.Version).Scan(&storedChecksum)
		switch {
		case err == nil:
			if storedChecksum != checksum {
				return fmt.Errorf("migration %d %s checksum mismatch", migration.Version, migration.Name)
			}
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return fmt.Errorf("check migration %d %s: %w", migration.Version, migration.Name, err)
		}

		if err := migration.Apply(db); err != nil {
			return fmt.Errorf("migration %d %s failed: %w", migration.Version, migration.Name, err)
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO schema_migrations (version, name, checksum)
			VALUES (?, ?, ?)
		`, migration.Version, migration.Name, checksum); err != nil {
			return fmt.Errorf("record migration %d %s: %w", migration.Version, migration.Name, err)
		}
	}

	return nil
}

func migrationChecksum(migration schemaMigration) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%s:%s", migration.Version, migration.Name, migration.Revision)))
	return hex.EncodeToString(digest[:])
}
