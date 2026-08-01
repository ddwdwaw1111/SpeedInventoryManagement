package database

import (
	"fmt"
	"testing"
)

func TestMigrationChecksumIsStableAndRevisionSensitive(t *testing.T) {
	migration := schemaMigration{Version: 2, Name: "container_balances", Revision: "1"}
	first := migrationChecksum(migration)
	second := migrationChecksum(migration)
	if first != second || len(first) != 64 {
		t.Fatalf("expected stable sha256 checksum, got %q and %q", first, second)
	}

	migration.Revision = "2"
	if first == migrationChecksum(migration) {
		t.Fatal("changing a migration revision must change its checksum")
	}
}

func TestPreviouslyDeployedMigrationChecksumsRemainCompatible(t *testing.T) {
	expectedChecksums := map[int64]string{
		9:  "f802a3e95c7517a4d721de3d0d20de479ee351dc4daac93571f5e6c3c9f7812a",
		10: "ee31edf6871fe2406c8e517148d7f3540cd92b96e8baf1c39833826cd40646d6",
	}

	for version, expectedChecksum := range expectedChecksums {
		var found *schemaMigration
		for index := range schemaMigrations {
			if schemaMigrations[index].Version == version {
				found = &schemaMigrations[index]
				break
			}
		}
		if found == nil {
			t.Fatalf("migration %d is missing", version)
		}
		if actualChecksum := migrationChecksum(*found); actualChecksum != expectedChecksum {
			t.Fatalf(
				"migration %d checksum = %s, want deployed checksum %s (%s)",
				version,
				actualChecksum,
				expectedChecksum,
				fmt.Sprintf("%s/%s", found.Name, found.Revision),
			)
		}
	}
}

func TestBulkImportRetentionHasDedicatedMigration(t *testing.T) {
	for _, migration := range schemaMigrations {
		if migration.Version == 12 {
			if migration.Name != "bulk_import_retention" || migration.Apply == nil {
				t.Fatalf("unexpected bulk import retention migration: %#v", migration)
			}
			return
		}
	}
	t.Fatal("bulk import retention migration is missing")
}

func TestTransferLinePalletSidesHasDedicatedMigration(t *testing.T) {
	for _, migration := range schemaMigrations {
		if migration.Version == 13 {
			if migration.Name != "transfer_line_pallet_sides" || migration.Apply == nil {
				t.Fatalf("unexpected transfer pallet-side migration: %#v", migration)
			}
			return
		}
	}
	t.Fatal("transfer pallet-side migration is missing")
}

func TestSKUPhysicalProfilesHasDedicatedMigration(t *testing.T) {
	for _, migration := range schemaMigrations {
		if migration.Version == 14 {
			if migration.Name != "sku_physical_profiles" || migration.Apply == nil {
				t.Fatalf("unexpected UPC physical-profile migration: %#v", migration)
			}
			return
		}
	}
	t.Fatal("UPC physical-profile migration is missing")
}
