package database

import (
	"strings"
	"testing"
)

func TestMigrationChecksumIsStableAndRevisionSensitive(t *testing.T) {
	migration := schemaMigration{Version: 1, Name: "v1", Revision: "1"}
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

func TestV1UsesOneCleanBaselineMigration(t *testing.T) {
	if len(schemaMigrations) != 1 {
		t.Fatalf("expected one pre-production baseline migration, got %d", len(schemaMigrations))
	}
	migration := schemaMigrations[0]
	if migration.Version != 1 || migration.Name != "v1_container_centric_baseline" || migration.Apply == nil {
		t.Fatalf("unexpected v1 baseline migration: %#v", migration)
	}
}

func TestV1SchemaContainsOnlyCurrentContainerCentricStructures(t *testing.T) {
	for _, required := range []string{
		"`expected_qty`",
		"`inbound_ctns_per_pallet`",
		"`carton_length_cm`",
		"`carton_width_cm`",
		"`carton_height_cm`",
		"`outbound_cartons_per_layer`",
		"`outbound_layer_count`",
		"CREATE TABLE IF NOT EXISTS `outbound_container_allocations`",
	} {
		if !strings.Contains(v1Schema, required) {
			t.Fatalf("v1 schema is missing %s", required)
		}
	}
	for _, legacy := range []string{
		"container_lifecycle_events",
		"container_visits",
		"customer_item_catalog",
		"pick_allocations_json",
		"pallet_items",
	} {
		if strings.Contains(v1Schema, legacy) {
			t.Fatalf("v1 schema still contains legacy structure %s", legacy)
		}
	}
}
