package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"

	"speed-inventory-management/backend/internal/database"
)

func newIntegrationStore(t *testing.T) *Store {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		host := strings.TrimSpace(os.Getenv("TEST_MYSQL_HOST"))
		if host == "" {
			t.Skip("TEST_MYSQL_DSN or TEST_MYSQL_HOST is not set")
		}

		port := firstNonEmpty(strings.TrimSpace(os.Getenv("TEST_MYSQL_PORT")), "3306")
		databaseName := strings.TrimSpace(os.Getenv("TEST_MYSQL_DATABASE"))
		user := strings.TrimSpace(os.Getenv("TEST_MYSQL_USER"))
		password := os.Getenv("TEST_MYSQL_PASSWORD")
		if databaseName == "" || user == "" {
			t.Skip("TEST_MYSQL_DATABASE and TEST_MYSQL_USER are required when TEST_MYSQL_DSN is not set")
		}

		dsn = fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci",
			user,
			password,
			host,
			port,
			databaseName,
		)
	}

	db, err := sqlx.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open integration database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.Ping(); err != nil {
		t.Fatalf("ping integration database: %v", err)
	}
	if err := database.Migrate(db.DB); err != nil {
		t.Fatalf("migrate integration database: %v", err)
	}
	resetIntegrationDatabase(t, db)

	return NewStore(db)
}

func resetIntegrationDatabase(t *testing.T, db *sqlx.DB) {
	t.Helper()

	if _, err := db.Exec(`SET FOREIGN_KEY_CHECKS = 0`); err != nil {
		t.Fatalf("disable foreign key checks: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`SET FOREIGN_KEY_CHECKS = 1`)
	})

	tables := []string{
		"audit_logs",
		"ui_preferences",
		"user_sessions",
		"stock_movements",
		"cycle_count_lines",
		"cycle_counts",
		"inventory_transfer_lines",
		"inventory_transfers",
		"inventory_adjustment_lines",
		"inventory_adjustments",
		"outbound_pick_allocations",
		"outbound_document_lines",
		"outbound_documents",
		"inbound_document_lines",
		"inbound_documents",
		"inventory_items",
		"sku_master",
		"customers",
		"storage_locations",
		"users",
	}

	for _, table := range tables {
		if _, err := db.Exec(`TRUNCATE TABLE ` + table); err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}
}

func TestDocumentPostingLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		DeliveryDate:   "2026-03-22",
		ContainerNo:    "CONT-" + suffix,
		StorageSection: "A",
		UnitLabel:      "CTN",
		Status:         DocumentStatusDraft,
		DocumentNote:   "Inbound integration test",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:               item.SKU,
				Description:       item.Description,
				ExpectedQty:       10,
				ReceivedQty:       10,
				StorageSection:    "A",
				Pallets:           1,
				PalletsDetailCtns: "1*10",
			},
		},
	})
	if err != nil {
		t.Fatalf("create inbound document: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected inbound status DRAFT, got %q", inbound.Status)
	}
	itemAfterInboundDraft := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterInboundDraft.Quantity != 0 {
		t.Fatalf("expected on-hand 0 after inbound draft, got %d", itemAfterInboundDraft.Quantity)
	}

	inbound, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("confirm inbound document: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected inbound status CONFIRMED, got %q", inbound.Status)
	}

	_, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err == nil {
		t.Fatalf("expected second inbound confirmation to fail")
	}
	if inbound.TotalReceivedQty != 10 {
		t.Fatalf("expected total received qty 10, got %d", inbound.TotalReceivedQty)
	}

	itemAfterInbound := mustFindItemByContainer(t, ctx, store, location.ID, "A", "CONT-"+suffix, item.SKU)
	if itemAfterInbound.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after inbound, got %d", itemAfterInbound.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PL-" + suffix,
		OrderRef:      "SO-" + suffix,
		OutDate:       "2026-03-22",
		ShipToName:    "Receiver " + suffix,
		ShipToAddress: "123 Warehouse Ln",
		ShipToContact: "Dock 5",
		CarrierName:   "FedEx",
		Status:        DocumentStatusDraft,
		DocumentNote:  "Outbound integration test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				ItemID:       itemAfterInbound.ID,
				Quantity:     4,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create outbound document: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected outbound status DRAFT, got %q", outbound.Status)
	}
	if len(outbound.Lines) != 1 {
		t.Fatalf("expected 1 outbound line, got %d", len(outbound.Lines))
	}
	if len(outbound.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected 1 pick allocation, got %d", len(outbound.Lines[0].PickAllocations))
	}
	if outbound.Lines[0].PickAllocations[0].AllocatedQty != 4 {
		t.Fatalf("expected pick allocation qty 4, got %d", outbound.Lines[0].PickAllocations[0].AllocatedQty)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo == "" {
		t.Fatal("expected pick allocation to include source container")
	}

	itemAfterOutboundDraft := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterOutboundDraft.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after outbound draft, got %d", itemAfterOutboundDraft.Quantity)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm outbound document: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected outbound status CONFIRMED, got %q", outbound.Status)
	}

	_, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err == nil {
		t.Fatalf("expected second outbound confirmation to fail")
	}

	itemAfterOutbound := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterOutbound.Quantity != 6 {
		t.Fatalf("expected on-hand 6 after outbound, got %d", itemAfterOutbound.Quantity)
	}

	cancelled, err := store.CancelOutboundDocument(ctx, outbound.ID, CancelOutboundDocumentInput{Reason: "Customer changed order"})
	if err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	if !strings.EqualFold(cancelled.Status, "CANCELLED") {
		t.Fatalf("expected cancelled outbound status, got %q", cancelled.Status)
	}

	itemAfterReversal := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterReversal.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after reversal, got %d", itemAfterReversal.Quantity)
	}

	cancelledInbound, err := store.CancelInboundDocument(ctx, inbound.ID, CancelInboundDocumentInput{Reason: "Supplier return"})
	if err != nil {
		t.Fatalf("cancel inbound document: %v", err)
	}
	if !strings.EqualFold(cancelledInbound.Status, DocumentStatusCancelled) {
		t.Fatalf("expected cancelled inbound status, got %q", cancelledInbound.Status)
	}

	itemAfterInboundReversal := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterInboundReversal.Quantity != 0 {
		t.Fatalf("expected on-hand 0 after inbound reversal, got %d", itemAfterInboundReversal.Quantity)
	}

	movements, err := store.ListMovements(ctx, 50)
	if err != nil {
		t.Fatalf("list movements: %v", err)
	}

	assertMovementTypeCount(t, movements, itemAfterInbound.ID, "IN", 1)
	assertMovementTypeCount(t, movements, itemAfterInbound.ID, "OUT", 1)
	assertMovementTypeCount(t, movements, itemAfterInbound.ID, "REVERSAL", 2)
}

func TestGlobalUIPreferenceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()

	preference, err := store.GetGlobalUIPreference(ctx, "sku-master.column-order")
	if err != nil {
		t.Fatalf("get empty ui preference: %v", err)
	}
	if preference.PreferenceKey != "sku-master.column-order" {
		t.Fatalf("expected preference key to round-trip, got %q", preference.PreferenceKey)
	}

	preference, err = store.UpsertGlobalUIPreference(ctx, "sku-master.column-order", `["sku","itemNumber","description"]`, 42)
	if err != nil {
		t.Fatalf("upsert ui preference: %v", err)
	}
	if preference.ValueJSON == "" {
		t.Fatal("expected preference value json to be stored")
	}
	if preference.UpdatedByUserID != 42 {
		t.Fatalf("expected updated by user 42, got %d", preference.UpdatedByUserID)
	}

	loaded, err := store.GetGlobalUIPreference(ctx, "sku-master.column-order")
	if err != nil {
		t.Fatalf("reload ui preference: %v", err)
	}
	if loaded.ValueJSON != `["sku","itemNumber","description"]` {
		t.Fatalf("expected stored column order, got %q", loaded.ValueJSON)
	}
}

func TestInboundDocumentSupportsMultipleSectionsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		DeliveryDate:   "2026-03-24",
		ContainerNo:    "CONT-MULTI-" + suffix,
		StorageSection: "A",
		UnitLabel:      "CTN",
		Status:         DocumentStatusConfirmed,
		DocumentNote:   "Multi-section receipt",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				StorageSection: "A",
			},
			{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    7,
				ReceivedQty:    7,
				StorageSection: "B",
			},
		},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound with multiple sections: %v", err)
	}
	if inbound.TotalReceivedQty != 12 {
		t.Fatalf("expected total received qty 12, got %d", inbound.TotalReceivedQty)
	}
	if len(inbound.Lines) != 2 {
		t.Fatalf("expected 2 inbound lines, got %d", len(inbound.Lines))
	}

	itemSectionA := mustFindItemByContainer(t, ctx, store, location.ID, "A", "CONT-MULTI-"+suffix, item.SKU)
	if itemSectionA.Quantity != 5 {
		t.Fatalf("expected section A quantity 5, got %d", itemSectionA.Quantity)
	}
	itemSectionB := mustFindItemByContainer(t, ctx, store, location.ID, "B", "CONT-MULTI-"+suffix, item.SKU)
	if itemSectionB.Quantity != 7 {
		t.Fatalf("expected section B quantity 7, got %d", itemSectionB.Quantity)
	}
}

func TestDraftDocumentUpdateIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		DeliveryDate:   "2026-03-22",
		ContainerNo:    "CONT-OLD-" + suffix,
		StorageSection: "A",
		UnitLabel:      "CTN",
		Status:         DocumentStatusDraft,
		DocumentNote:   "Inbound draft before edit",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			StorageSection: "A",
		}},
	})
	if err != nil {
		t.Fatalf("create inbound draft: %v", err)
	}

	inbound, err = store.UpdateInboundDocument(ctx, inbound.ID, CreateInboundDocumentInput{
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		DeliveryDate:   "2026-03-23",
		ContainerNo:    "CONT-EDIT-" + suffix,
		StorageSection: "B",
		UnitLabel:      "CTN",
		Status:         DocumentStatusDraft,
		DocumentNote:   "Inbound draft edited",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			StorageSection:    "B",
			Pallets:           2,
			PalletsDetailCtns: "2*6",
			LineNote:          "Updated receipt line",
		}},
	})
	if err != nil {
		t.Fatalf("update inbound draft: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected updated inbound to remain draft, got %q", inbound.Status)
	}
	if inbound.ContainerNo != "CONT-EDIT-"+suffix {
		t.Fatalf("expected updated inbound container, got %q", inbound.ContainerNo)
	}
	if inbound.TotalReceivedQty != 12 {
		t.Fatalf("expected updated inbound received qty 12, got %d", inbound.TotalReceivedQty)
	}
	itemAfterInboundDraft := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterInboundDraft.Quantity != 0 {
		t.Fatalf("expected on-hand 0 after inbound draft edit, got %d", itemAfterInboundDraft.Quantity)
	}

	inbound, err = store.UpdateInboundDocument(ctx, inbound.ID, CreateInboundDocumentInput{
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		DeliveryDate:   "2026-03-23",
		ContainerNo:    "CONT-EDIT-" + suffix,
		StorageSection: "B",
		UnitLabel:      "CTN",
		Status:         DocumentStatusConfirmed,
		DocumentNote:   "Inbound draft confirmed from edit",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       8,
			ReceivedQty:       8,
			StorageSection:    "B",
			Pallets:           1,
			PalletsDetailCtns: "1*8",
			LineNote:          "Confirm edited receipt line",
		}},
	})
	if err != nil {
		t.Fatalf("confirm inbound via update: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected inbound confirmed via update, got %q", inbound.Status)
	}
	itemAfterInboundConfirm := mustFindItemByContainer(t, ctx, store, location.ID, "B", "CONT-EDIT-"+suffix, item.SKU)
	if itemAfterInboundConfirm.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after inbound confirm via update, got %d", itemAfterInboundConfirm.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PL-" + suffix,
		OrderRef:      "SO-" + suffix,
		OutDate:       "2026-03-23",
		ShipToName:    "Receiver " + suffix,
		ShipToAddress: "123 Dock Ln",
		ShipToContact: "Dock 3",
		CarrierName:   "Internal Fleet",
		Status:        DocumentStatusDraft,
		DocumentNote:  "Outbound draft before edit",
		Lines: []CreateOutboundDocumentLineInput{{
			ItemID:       itemAfterInboundConfirm.ID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft: %v", err)
	}

	outbound, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo: "PL-EDIT-" + suffix,
		OrderRef:      "SO-EDIT-" + suffix,
		OutDate:       "2026-03-23",
		ShipToName:    "Edited Receiver " + suffix,
		ShipToAddress: "456 Dock Ln",
		ShipToContact: "Dock 4",
		CarrierName:   "Internal Fleet",
		Status:        DocumentStatusDraft,
		DocumentNote:  "Outbound draft edited",
		Lines: []CreateOutboundDocumentLineInput{{
			ItemID:       itemAfterInboundConfirm.ID,
			Quantity:     5,
			UnitLabel:    "CTN",
			CartonSizeMM: "420*310*210",
			LineNote:     "Updated shipment line",
		}},
	})
	if err != nil {
		t.Fatalf("update outbound draft: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected updated outbound to remain draft, got %q", outbound.Status)
	}
	if outbound.PackingListNo != "PL-EDIT-"+suffix {
		t.Fatalf("expected updated outbound packing list no, got %q", outbound.PackingListNo)
	}
	if outbound.TotalQty != 5 {
		t.Fatalf("expected updated outbound qty 5, got %d", outbound.TotalQty)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) == 0 {
		t.Fatalf("expected edited outbound draft to retain pick allocations")
	}
	itemAfterOutboundDraft := mustFindItemByID(t, ctx, store, itemAfterInboundConfirm.ID)
	if itemAfterOutboundDraft.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after outbound draft edit, got %d", itemAfterOutboundDraft.Quantity)
	}

	outbound, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo: "PL-EDIT-" + suffix,
		OrderRef:      "SO-FINAL-" + suffix,
		OutDate:       "2026-03-23",
		ShipToName:    "Final Receiver " + suffix,
		ShipToAddress: "789 Dock Ln",
		ShipToContact: "Dock 8",
		CarrierName:   "Internal Fleet",
		Status:        DocumentStatusConfirmed,
		DocumentNote:  "Outbound draft confirmed from edit",
		Lines: []CreateOutboundDocumentLineInput{{
			ItemID:       itemAfterInboundConfirm.ID,
			Quantity:     4,
			UnitLabel:    "CTN",
			CartonSizeMM: "420*310*210",
			LineNote:     "Confirm edited shipment line",
		}},
	})
	if err != nil {
		t.Fatalf("confirm outbound via update: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected outbound confirmed via update, got %q", outbound.Status)
	}
	itemAfterOutboundConfirm := mustFindItemByID(t, ctx, store, itemAfterInboundConfirm.ID)
	if itemAfterOutboundConfirm.Quantity != 4 {
		t.Fatalf("expected on-hand 4 after outbound confirm via update, got %d", itemAfterOutboundConfirm.Quantity)
	}
}

func TestOutboundAutoAllocationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	itemA := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 5, "A")
	itemB := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 7, "B")

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PL-SPLIT-" + suffix,
		OrderRef:      "SO-SPLIT-" + suffix,
		OutDate:       "2026-03-22",
		ShipToName:    "Receiver " + suffix,
		ShipToAddress: "123 Warehouse Ln",
		ShipToContact: "Dock 5",
		CarrierName:   "Internal Fleet",
		Status:        DocumentStatusDraft,
		DocumentNote:  "Split allocation integration test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				ItemID:       itemA.ID,
				Quantity:     10,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create split outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 {
		t.Fatalf("expected 1 outbound line, got %d", len(outbound.Lines))
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}
	if outbound.Lines[0].PickAllocations[0].AllocatedQty != 5 {
		t.Fatalf("expected first allocation qty 5, got %d", outbound.Lines[0].PickAllocations[0].AllocatedQty)
	}
	if outbound.Lines[0].PickAllocations[1].AllocatedQty != 5 {
		t.Fatalf("expected second allocation qty 5, got %d", outbound.Lines[0].PickAllocations[1].AllocatedQty)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm split outbound document: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected outbound status CONFIRMED, got %q", outbound.Status)
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}

	itemAAfter := mustFindItemByID(t, ctx, store, itemA.ID)
	if itemAAfter.Quantity != 0 {
		t.Fatalf("expected source item A quantity 0, got %d", itemAAfter.Quantity)
	}

	itemBAfter := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemBAfter.Quantity != 2 {
		t.Fatalf("expected source item B quantity 2, got %d", itemBAfter.Quantity)
	}

	cancelled, err := store.CancelOutboundDocument(ctx, outbound.ID, CancelOutboundDocumentInput{Reason: "Split allocation cancelled"})
	if err != nil {
		t.Fatalf("cancel split outbound document: %v", err)
	}
	if !strings.EqualFold(cancelled.Status, DocumentStatusCancelled) {
		t.Fatalf("expected cancelled outbound status, got %q", cancelled.Status)
	}

	itemARestored := mustFindItemByID(t, ctx, store, itemA.ID)
	if itemARestored.Quantity != 5 {
		t.Fatalf("expected source item A restored to 5, got %d", itemARestored.Quantity)
	}

	itemBRestored := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemBRestored.Quantity != 7 {
		t.Fatalf("expected source item B restored to 7, got %d", itemBRestored.Quantity)
	}
}

func TestOutboundAutoAllocationFromMergedContainerLedgerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, "A")

	if _, err := store.CreateMovement(ctx, CreateMovementInput{
		ItemID:         item.ID,
		MovementType:   "IN",
		Quantity:       6,
		StorageSection: "A",
		ContainerNo:    "CONT-A-" + suffix,
		ExpectedQty:    6,
		ReceivedQty:    6,
		UnitLabel:      "CTN",
	}); err != nil {
		t.Fatalf("create first inbound movement: %v", err)
	}
	if _, err := store.CreateMovement(ctx, CreateMovementInput{
		ItemID:         item.ID,
		MovementType:   "IN",
		Quantity:       4,
		StorageSection: "A",
		ContainerNo:    "CONT-B-" + suffix,
		ExpectedQty:    4,
		ReceivedQty:    4,
		UnitLabel:      "CTN",
	}); err != nil {
		t.Fatalf("create second inbound movement: %v", err)
	}

	mergedItem := mustFindItemByID(t, ctx, store, item.ID)
	if mergedItem.Quantity != 10 {
		t.Fatalf("expected merged inventory row quantity 10, got %d", mergedItem.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PL-MERGED-" + suffix,
		OrderRef:      "SO-MERGED-" + suffix,
		OutDate:       "2026-03-23",
		ShipToName:    "Receiver " + suffix,
		ShipToAddress: "123 Warehouse Ln",
		ShipToContact: "Dock 5",
		CarrierName:   "Internal Fleet",
		Status:        DocumentStatusDraft,
		DocumentNote:  "Merged container allocation test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				ItemID:       item.ID,
				Quantity:     8,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create merged outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 {
		t.Fatalf("expected 1 outbound line, got %d", len(outbound.Lines))
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 pick allocations from merged ledger balances, got %d", len(outbound.Lines[0].PickAllocations))
	}

	allocationContainers := []string{
		outbound.Lines[0].PickAllocations[0].ContainerNo,
		outbound.Lines[0].PickAllocations[1].ContainerNo,
	}
	if !containsString(allocationContainers, "CONT-A-"+suffix) || !containsString(allocationContainers, "CONT-B-"+suffix) {
		t.Fatalf("expected pick allocations to include both source containers, got %v", allocationContainers)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm merged outbound document: %v", err)
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed pick allocations from merged ledger balances, got %d", len(outbound.Lines[0].PickAllocations))
	}

	itemAfterConfirm := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterConfirm.Quantity != 2 {
		t.Fatalf("expected merged inventory row quantity 2 after confirm, got %d", itemAfterConfirm.Quantity)
	}
}

func TestOutboundManualContainerAllocationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, "A")

	if _, err := store.CreateMovement(ctx, CreateMovementInput{
		ItemID:         item.ID,
		MovementType:   "IN",
		Quantity:       6,
		StorageSection: "A",
		ContainerNo:    "CONT-A-" + suffix,
		ExpectedQty:    6,
		ReceivedQty:    6,
		UnitLabel:      "CTN",
	}); err != nil {
		t.Fatalf("create first inbound movement: %v", err)
	}
	if _, err := store.CreateMovement(ctx, CreateMovementInput{
		ItemID:         item.ID,
		MovementType:   "IN",
		Quantity:       4,
		StorageSection: "A",
		ContainerNo:    "CONT-B-" + suffix,
		ExpectedQty:    4,
		ReceivedQty:    4,
		UnitLabel:      "CTN",
	}); err != nil {
		t.Fatalf("create second inbound movement: %v", err)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PL-MANUAL-" + suffix,
		OrderRef:      "SO-MANUAL-" + suffix,
		OutDate:       "2026-03-23",
		ShipToName:    "Receiver " + suffix,
		ShipToAddress: "123 Warehouse Ln",
		ShipToContact: "Dock 5",
		CarrierName:   "Internal Fleet",
		Status:        DocumentStatusDraft,
		DocumentNote:  "Manual container allocation test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				ItemID:       item.ID,
				Quantity:     5,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
				PickAllocations: []CreateOutboundLineAllocationInput{
					{StorageSection: "A", ContainerNo: "CONT-B-" + suffix, AllocatedQty: 4},
					{StorageSection: "A", ContainerNo: "CONT-A-" + suffix, AllocatedQty: 1},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("create manual outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 stored manual pick allocations, got %+v", outbound.Lines)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo != "CONT-B-"+suffix || outbound.Lines[0].PickAllocations[0].AllocatedQty != 4 {
		t.Fatalf("expected first manual allocation CONT-B qty 4, got %+v", outbound.Lines[0].PickAllocations[0])
	}
	if outbound.Lines[0].PickAllocations[1].ContainerNo != "CONT-A-"+suffix || outbound.Lines[0].PickAllocations[1].AllocatedQty != 1 {
		t.Fatalf("expected second manual allocation CONT-A qty 1, got %+v", outbound.Lines[0].PickAllocations[1])
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm manual outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed manual pick allocations, got %+v", outbound.Lines)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo != "CONT-B-"+suffix || outbound.Lines[0].PickAllocations[0].AllocatedQty != 4 {
		t.Fatalf("expected confirmed first manual allocation CONT-B qty 4, got %+v", outbound.Lines[0].PickAllocations[0])
	}
	if outbound.Lines[0].PickAllocations[1].ContainerNo != "CONT-A-"+suffix || outbound.Lines[0].PickAllocations[1].AllocatedQty != 1 {
		t.Fatalf("expected confirmed second manual allocation CONT-A qty 1, got %+v", outbound.Lines[0].PickAllocations[1])
	}

	itemAfterConfirm := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterConfirm.Quantity != 5 {
		t.Fatalf("expected merged inventory row quantity 5 after confirm, got %d", itemAfterConfirm.Quantity)
	}

	movements, err := store.ListMovements(ctx, 20)
	if err != nil {
		t.Fatalf("list movements after manual allocation confirm: %v", err)
	}

	var movementContainers []string
	for _, movement := range movements {
		if movement.OutboundDocumentID == outbound.ID && movement.MovementType == "OUT" {
			movementContainers = append(movementContainers, movement.ContainerNo)
		}
	}
	if !containsString(movementContainers, "CONT-A-"+suffix) || !containsString(movementContainers, "CONT-B-"+suffix) {
		t.Fatalf("expected outbound movements to preserve manual containers, got %v", movementContainers)
	}
}

func TestInventoryTransferIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "LA-"+suffix)
	sourceItem := mustCreateItem(t, ctx, store, customer.ID, sourceLocation.ID, "SKU-"+suffix, 12)

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TR-" + suffix,
		Notes:      "Transfer integration test",
		Lines: []CreateInventoryTransferLineInput{
			{
				SourceItemID:     sourceItem.ID,
				Quantity:         5,
				ToLocationID:     destinationLocation.ID,
				ToStorageSection: "B",
				LineNote:         "Move to west warehouse",
			},
		},
	})
	if err != nil {
		t.Fatalf("create inventory transfer: %v", err)
	}
	if !strings.EqualFold(transfer.Status, "POSTED") {
		t.Fatalf("expected transfer status POSTED, got %q", transfer.Status)
	}
	if len(transfer.Lines) != 1 {
		t.Fatalf("expected 1 transfer line, got %d", len(transfer.Lines))
	}

	sourceAfter := mustFindItemByID(t, ctx, store, sourceItem.ID)
	if sourceAfter.Quantity != 7 {
		t.Fatalf("expected source quantity 7, got %d", sourceAfter.Quantity)
	}

	destinationItem := mustFindItemByLocationAndSection(t, ctx, store, destinationLocation.ID, "B", sourceItem.SKU)
	if destinationItem.Quantity != 5 {
		t.Fatalf("expected destination quantity 5, got %d", destinationItem.Quantity)
	}

	movements, err := store.ListMovements(ctx, 50)
	if err != nil {
		t.Fatalf("list movements: %v", err)
	}

	assertMovementPresent(t, movements, transfer.Lines[0].TransferOutMovementID, "TRANSFER_OUT", -5)
	assertMovementPresent(t, movements, transfer.Lines[0].TransferInMovementID, "TRANSFER_IN", 5)
}

func TestCycleCountIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10)

	count, err := store.CreateCycleCount(ctx, CreateCycleCountInput{
		CountNo: "CC-" + suffix,
		Notes:   "Cycle count integration test",
		Lines: []CreateCycleCountLineInput{
			{
				ItemID:     item.ID,
				CountedQty: 7,
				LineNote:   "Three units missing",
			},
		},
	})
	if err != nil {
		t.Fatalf("create cycle count: %v", err)
	}
	if !strings.EqualFold(count.Status, "POSTED") {
		t.Fatalf("expected cycle count status POSTED, got %q", count.Status)
	}
	if len(count.Lines) != 1 {
		t.Fatalf("expected 1 cycle count line, got %d", len(count.Lines))
	}
	if count.Lines[0].VarianceQty != -3 {
		t.Fatalf("expected variance -3, got %d", count.Lines[0].VarianceQty)
	}

	itemAfterCount := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterCount.Quantity != 7 {
		t.Fatalf("expected on-hand 7 after cycle count, got %d", itemAfterCount.Quantity)
	}

	movements, err := store.ListMovements(ctx, 50)
	if err != nil {
		t.Fatalf("list movements: %v", err)
	}

	assertMovementPresent(t, movements, count.Lines[0].MovementID, "COUNT", -3)
}

func TestUserManagementIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	canSelfRegister, err := store.CanSelfRegister(ctx)
	if err != nil {
		t.Fatalf("check self register availability: %v", err)
	}
	if !canSelfRegister {
		t.Fatal("expected self registration to be allowed for an empty system")
	}

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "admin-" + suffix + "@example.com",
		FullName: "Admin " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register initial admin: %v", err)
	}
	if authPayload.User.Role != RoleAdmin {
		t.Fatalf("expected first user role admin, got %q", authPayload.User.Role)
	}
	if !authPayload.User.IsActive {
		t.Fatal("expected initial admin to be active")
	}

	canSelfRegister, err = store.CanSelfRegister(ctx)
	if err != nil {
		t.Fatalf("check self register availability after bootstrap: %v", err)
	}
	if canSelfRegister {
		t.Fatal("expected self registration to be disabled once a user exists")
	}

	managedUser, err := store.CreateManagedUser(ctx, CreateManagedUserInput{
		Email:    "viewer-" + suffix + "@example.com",
		FullName: "Viewer " + suffix,
		Password: "password123",
		Role:     RoleViewer,
		IsActive: true,
	})
	if err != nil {
		t.Fatalf("create managed user: %v", err)
	}
	if managedUser.Role != RoleViewer {
		t.Fatalf("expected viewer role, got %q", managedUser.Role)
	}

	users, err := store.ListUsers(ctx)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}

	updatedUser, err := store.UpdateUserAccess(ctx, authPayload.User.ID, managedUser.ID, UpdateUserAccessInput{
		Role:     RoleOperator,
		IsActive: false,
	})
	if err != nil {
		t.Fatalf("update user access: %v", err)
	}
	if updatedUser.Role != RoleOperator {
		t.Fatalf("expected operator role after update, got %q", updatedUser.Role)
	}
	if updatedUser.IsActive {
		t.Fatal("expected updated user to be inactive")
	}

	if _, err := store.UpdateUserAccess(ctx, authPayload.User.ID, authPayload.User.ID, UpdateUserAccessInput{
		Role:     RoleViewer,
		IsActive: true,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected self-demotion to fail with ErrInvalidInput, got %v", err)
	}

	if _, err := store.UpdateUserAccess(ctx, authPayload.User.ID, authPayload.User.ID, UpdateUserAccessInput{
		Role:     RoleAdmin,
		IsActive: false,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected self-deactivation to fail with ErrInvalidInput, got %v", err)
	}
}

func TestAuthSessionLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	adminPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "admin-" + suffix + "@example.com",
		FullName: "Admin " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}

	operator, err := store.CreateManagedUser(ctx, CreateManagedUserInput{
		Email:    "operator-" + suffix + "@example.com",
		FullName: "Operator " + suffix,
		Password: "password123",
		Role:     RoleOperator,
		IsActive: true,
	})
	if err != nil {
		t.Fatalf("create operator: %v", err)
	}

	loginPayload, sessionToken, err := store.Login(ctx, LoginInput{
		Email:    operator.Email,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("login operator: %v", err)
	}
	if loginPayload.User.Role != RoleOperator {
		t.Fatalf("expected operator role after login, got %q", loginPayload.User.Role)
	}
	if strings.TrimSpace(sessionToken) == "" {
		t.Fatal("expected non-empty session token")
	}

	resolvedPayload, err := store.GetUserBySessionToken(ctx, sessionToken)
	if err != nil {
		t.Fatalf("resolve session token: %v", err)
	}
	if resolvedPayload.User.Email != operator.Email {
		t.Fatalf("expected resolved session user %q, got %q", operator.Email, resolvedPayload.User.Email)
	}

	if err := store.Logout(ctx, sessionToken); err != nil {
		t.Fatalf("logout session: %v", err)
	}
	if _, err := store.GetUserBySessionToken(ctx, sessionToken); err == nil || !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected logged out session token to be invalid, got %v", err)
	}

	_, err = store.UpdateUserAccess(ctx, adminPayload.User.ID, operator.ID, UpdateUserAccessInput{
		Role:     RoleOperator,
		IsActive: false,
	})
	if err != nil {
		t.Fatalf("deactivate operator: %v", err)
	}

	if _, _, err := store.Login(ctx, LoginInput{
		Email:    operator.Email,
		Password: "password123",
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected inactive operator login to fail with ErrInvalidInput, got %v", err)
	}
}

func mustCreateCustomer(t *testing.T, ctx context.Context, store *Store, name string) Customer {
	t.Helper()
	customer, err := store.CreateCustomer(ctx, CreateCustomerInput{Name: name})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	return customer
}

func mustCreateLocation(t *testing.T, ctx context.Context, store *Store, name string) Location {
	t.Helper()
	location, err := store.CreateLocation(ctx, CreateLocationInput{
		Name:         name,
		Address:      name + " address",
		Zone:         "A1",
		Capacity:     100,
		SectionNames: []string{"A", "B"},
	})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}
	return location
}

func mustCreateItem(t *testing.T, ctx context.Context, store *Store, customerID int64, locationID int64, sku string, quantity int) Item {
	t.Helper()
	return mustCreateItemWithSection(t, ctx, store, customerID, locationID, sku, quantity, "A")
}

func mustCreateItemWithSection(t *testing.T, ctx context.Context, store *Store, customerID int64, locationID int64, sku string, quantity int, section string) Item {
	t.Helper()
	item, err := store.CreateItem(ctx, CreateItemInput{
		SKU:            sku,
		Description:    "Integration test item " + sku,
		Quantity:       quantity,
		ReorderLevel:   1,
		CustomerID:     customerID,
		LocationID:     locationID,
		StorageSection: section,
		ContainerNo:    "CONT-" + sku + "-" + section,
		Unit:           "pcs",
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	return item
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func mustFindItemByID(t *testing.T, ctx context.Context, store *Store, itemID int64) Item {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{})
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	for _, item := range items {
		if item.ID == itemID {
			return item
		}
	}
	t.Fatalf("item %d not found", itemID)
	return Item{}
}

func mustFindItemByLocationAndSection(t *testing.T, ctx context.Context, store *Store, locationID int64, section string, sku string) Item {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{LocationID: locationID})
	if err != nil {
		t.Fatalf("list items by location: %v", err)
	}
	for _, item := range items {
		if item.LocationID == locationID && strings.EqualFold(item.StorageSection, section) && item.SKU == sku {
			return item
		}
	}
	t.Fatalf("item %s at location %d section %s not found", sku, locationID, section)
	return Item{}
}

func mustFindItemByContainer(t *testing.T, ctx context.Context, store *Store, locationID int64, section string, containerNo string, sku string) Item {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{LocationID: locationID})
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	for _, item := range items {
		if item.SKU == sku && item.LocationID == locationID && item.StorageSection == section && item.ContainerNo == containerNo {
			return item
		}
	}
	t.Fatalf("item %s at location %d section %s container %s not found", sku, locationID, section, containerNo)
	return Item{}
}

func assertMovementTypeCount(t *testing.T, movements []Movement, itemID int64, movementType string, wantCount int) {
	t.Helper()
	count := 0
	for _, movement := range movements {
		if movement.ItemID == itemID && movement.MovementType == movementType {
			count++
		}
	}
	if count != wantCount {
		t.Fatalf("expected %d %s movements for item %d, got %d", wantCount, movementType, itemID, count)
	}
}

func assertMovementPresent(t *testing.T, movements []Movement, movementID int64, movementType string, quantityChange int) {
	t.Helper()
	for _, movement := range movements {
		if movement.ID == movementID {
			if movement.MovementType != movementType {
				t.Fatalf("expected movement %d type %s, got %s", movementID, movementType, movement.MovementType)
			}
			if movement.QuantityChange != quantityChange {
				t.Fatalf("expected movement %d quantity change %d, got %d", movementID, quantityChange, movement.QuantityChange)
			}
			return
		}
	}
	t.Fatalf("movement %d not found", movementID)
}

func integrationSuffix() string {
	return strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "")
}
