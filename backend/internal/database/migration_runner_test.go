package database

import "testing"

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
