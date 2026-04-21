package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"sort"
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
		"billing_invoice_lines",
		"billing_invoices",
		"pallet_location_events",
		"stock_ledger",
		"outbound_picks",
		"pallet_items",
		"pallets",
		"container_visits",
		"cycle_count_lines",
		"cycle_counts",
		"inventory_transfer_lines",
		"inventory_transfers",
		"inventory_adjustment_lines",
		"inventory_adjustments",
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
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-22",
		ContainerNo:         "CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		DocumentNote:        "Inbound integration test",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:               item.SKU,
				Description:       item.Description,
				ExpectedQty:       10,
				ReceivedQty:       10,
				StorageSection:    DefaultStorageSection,
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

	itemAfterInbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-"+suffix, item.SKU)
	if itemAfterInbound.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after inbound, got %d", itemAfterInbound.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-22",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "FedEx",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Outbound integration test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemAfterInbound.CustomerID,
				LocationID:   itemAfterInbound.LocationID,
				SKUMasterID:  itemAfterInbound.SKUMasterID,
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
	if len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound document to defer pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
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

	cancelled, err := store.CancelOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	if !strings.EqualFold(cancelled.Status, "DELETED") {
		t.Fatalf("expected deleted outbound status, got %q", cancelled.Status)
	}

	itemAfterReversal := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterReversal.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after reversal, got %d", itemAfterReversal.Quantity)
	}

	cancelledInbound, err := store.CancelInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("cancel inbound document: %v", err)
	}
	if !strings.EqualFold(cancelledInbound.Status, DocumentStatusDeleted) {
		t.Fatalf("expected deleted inbound status, got %q", cancelledInbound.Status)
	}

	itemAfterInboundReversal := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterInboundReversal.Quantity != 0 {
		t.Fatalf("expected on-hand 0 after inbound reversal, got %d", itemAfterInboundReversal.Quantity)
	}

	movements, err := store.ListMovements(ctx, 50)
	if err != nil {
		t.Fatalf("list movements: %v", err)
	}

	// After hard-delete cancel, all stock_ledger entries for the deleted
	// pallets and documents are removed, so no movements should remain.
	assertMovementTypeCount(t, movements, itemAfterInbound.ID, "IN", 0)
	assertMovementTypeCount(t, movements, itemAfterInbound.ID, "OUT", 0)
	assertMovementTypeCount(t, movements, itemAfterInbound.ID, "REVERSAL", 0)
}

func TestBackfilledInboundUsesActualReceivedTimestampIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Backfill Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "BK-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-BK-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2025-12-15",
		ContainerNo:         "BKCONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:               item.SKU,
				Description:       item.Description,
				ExpectedQty:       12,
				ReceivedQty:       12,
				StorageSection:    DefaultStorageSection,
				Pallets:           1,
				PalletsDetailCtns: "1*12",
			},
		},
	})
	if err != nil {
		t.Fatalf("create backfilled inbound document: %v", err)
	}

	confirmedWindowStart := time.Now().UTC().Add(-1 * time.Minute)
	inbound, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("confirm backfilled inbound document: %v", err)
	}
	if inbound.ConfirmedAt == nil {
		t.Fatalf("expected confirmedAt to be set")
	}

	var arrivalDate sql.NullTime
	var receivedAt sql.NullTime
	if err := store.db.QueryRowContext(ctx, `
		SELECT arrival_date, received_at
		FROM container_visits
		WHERE inbound_document_id = ?
	`, inbound.ID).Scan(&arrivalDate, &receivedAt); err != nil {
		t.Fatalf("load container visit timestamps: %v", err)
	}
	if !arrivalDate.Valid || arrivalDate.Time.Format("2006-01-02") != "2025-12-15" {
		t.Fatalf("expected arrival_date to remain business date 2025-12-15, got %v", arrivalDate.Time)
	}
	if !receivedAt.Valid {
		t.Fatalf("expected received_at to be set")
	}
	if receivedAt.Time.Before(confirmedWindowStart) {
		t.Fatalf("expected received_at to reflect actual confirmation time, got %v", receivedAt.Time)
	}

	itemAfterInbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "BKCONT-"+suffix, item.SKU)
	if itemAfterInbound.LastRestockedAt == nil {
		t.Fatalf("expected lastRestockedAt to be set")
	}
	if itemAfterInbound.LastRestockedAt.Before(confirmedWindowStart) {
		t.Fatalf("expected lastRestockedAt to reflect actual confirmation time, got %v", itemAfterInbound.LastRestockedAt)
	}
}

func TestInboundActualArrivalDateOverridesContainerArrivalDateIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	beforeConfirm := time.Now().UTC()

	customer := mustCreateCustomer(t, ctx, store, "Arrival Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AR-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-AR-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2025-12-15",
		ActualArrivalDate:   "2025-12-18",
		ContainerNo:         "ARCONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:               item.SKU,
				Description:       item.Description,
				ExpectedQty:       6,
				ReceivedQty:       6,
				StorageSection:    DefaultStorageSection,
				Pallets:           1,
				PalletsDetailCtns: "1*6",
			},
		},
	})
	if err != nil {
		t.Fatalf("create inbound with actual arrival date: %v", err)
	}

	inbound, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("confirm inbound with actual arrival date: %v", err)
	}
	afterConfirm := time.Now().UTC()
	if inbound.ActualArrivalDate == nil || inbound.ActualArrivalDate.Format("2006-01-02") != "2025-12-18" {
		t.Fatalf("expected actualArrivalDate to persist, got %+v", inbound.ActualArrivalDate)
	}

	var arrivalDate sql.NullTime
	if err := store.db.QueryRowContext(ctx, `
		SELECT arrival_date
		FROM container_visits
		WHERE inbound_document_id = ?
	`, inbound.ID).Scan(&arrivalDate); err != nil {
		t.Fatalf("load container visit arrival date: %v", err)
	}
	if !arrivalDate.Valid || arrivalDate.Time.Format("2006-01-02") != "2025-12-18" {
		t.Fatalf("expected container visit arrival_date to use actual arrival date, got %v", arrivalDate.Time)
	}

	var (
		palletActualArrival sql.NullTime
		palletCreatedAt     time.Time
	)
	if err := store.db.QueryRowContext(ctx, `
		SELECT actual_arrival_date, created_at
		FROM pallets
		WHERE source_inbound_document_id = ?
		ORDER BY id ASC
		LIMIT 1
	`, inbound.ID).Scan(&palletActualArrival, &palletCreatedAt); err != nil {
		t.Fatalf("load pallet arrival date: %v", err)
	}
	if !palletActualArrival.Valid || palletActualArrival.Time.Format("2006-01-02") != "2025-12-18" {
		t.Fatalf("expected pallet actual_arrival_date to use actual arrival date, got %v", palletActualArrival.Time)
	}
	if palletCreatedAt.Before(beforeConfirm.Add(-2*time.Second)) || palletCreatedAt.After(afterConfirm.Add(2*time.Second)) {
		t.Fatalf("expected pallet created_at to reflect real creation time, got %v", palletCreatedAt)
	}
}

func TestOutboundDocumentUsesPalletsWithoutReceiptLotsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PLT-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-04-02",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Seed pallet outbound",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound from seed pallet inventory: %v", err)
	}
	if outbound.Status != DocumentStatusConfirmed {
		t.Fatalf("expected confirmed outbound status, got %q", outbound.Status)
	}

	itemAfterOutbound := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterOutbound.Quantity != 6 {
		t.Fatalf("expected pallet-backed on-hand 6 after outbound, got %d", itemAfterOutbound.Quantity)
	}

	var outboundPickCount int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM outbound_picks
		WHERE outbound_line_id = ?
	`, outbound.Lines[0].ID).Scan(&outboundPickCount); err != nil {
		t.Fatalf("count outbound picks: %v", err)
	}
	if outboundPickCount == 0 {
		t.Fatal("expected outbound picks to be created for seed pallet outbound")
	}
}

func TestInventoryAdjustmentUsesPalletBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Notes:      "Use pallet-backed quantity",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLineFromItem(item, -2, "reduce two units"),
		},
	})
	if err != nil {
		t.Fatalf("create inventory adjustment with pallet-backed quantity: %v", err)
	}
	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 adjustment line, got %d", len(adjustment.Lines))
	}
	if adjustment.Lines[0].BeforeQty != 10 {
		t.Fatalf("expected pallet-backed before qty 10, got %d", adjustment.Lines[0].BeforeQty)
	}
	if adjustment.Lines[0].AfterQty != 8 {
		t.Fatalf("expected pallet-backed after qty 8, got %d", adjustment.Lines[0].AfterQty)
	}

	itemAfterAdjustment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterAdjustment.Quantity != 8 {
		t.Fatalf("expected pallet-backed on-hand 8 after adjustment, got %d", itemAfterAdjustment.Quantity)
	}
}

func TestInventoryTransferUsesPalletBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	fromLocation := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	toLocation := mustCreateLocation(t, ctx, store, "LA-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, fromLocation.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		Notes: "Transfer with pallet-backed quantity",
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(item, 4, toLocation.ID, "A-01", "Move four units"),
		},
	})
	if err != nil {
		t.Fatalf("create transfer with pallet-backed quantity: %v", err)
	}
	if len(transfer.Lines) != 1 {
		t.Fatalf("expected 1 transfer line, got %d", len(transfer.Lines))
	}

	sourceAfterTransfer := mustFindItemByID(t, ctx, store, item.ID)
	if sourceAfterTransfer.Quantity != 6 {
		t.Fatalf("expected source pallet-backed on-hand 6 after transfer, got %d", sourceAfterTransfer.Quantity)
	}

	destinationAfterTransfer := mustFindItemByLocationAndSection(t, ctx, store, toLocation.ID, "A-01", item.SKU)
	if destinationAfterTransfer.Quantity != 4 {
		t.Fatalf("expected destination pallet-backed on-hand 4 after transfer, got %d", destinationAfterTransfer.Quantity)
	}
}

func TestConfirmedInboundDocumentIsImmutableIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "EDIT-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Original receipt",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           1,
			PalletsDetailCtns: "1*10",
			LineNote:          "Original line",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document: %v", err)
	}

	_, err = store.UpdateInboundDocument(ctx, receipt.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-27",
		ContainerNo:         "EDIT-NEW-" + suffix,
		StorageSection:      "B",
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Corrected receipt",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			StorageSection:    "B",
			Pallets:           2,
			PalletsDetailCtns: "2*6",
			LineNote:          "Corrected line",
		}},
	})
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected confirmed inbound update to fail with ErrInvalidInput, got %v", err)
	}

	reloadedReceipt, err := store.getInboundDocument(ctx, receipt.ID)
	if err != nil {
		t.Fatalf("reload confirmed inbound document: %v", err)
	}
	if reloadedReceipt.ContainerNo != "EDIT-OLD-"+suffix {
		t.Fatalf("expected confirmed inbound container to remain unchanged, got %q", reloadedReceipt.ContainerNo)
	}
	if len(reloadedReceipt.Lines) != 1 || reloadedReceipt.Lines[0].ReceivedQty != 10 {
		t.Fatalf("expected confirmed inbound line to remain unchanged, got %#v", reloadedReceipt.Lines)
	}

	unchangedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "EDIT-OLD-"+suffix, item.SKU)
	if unchangedItem.Quantity != 10 {
		t.Fatalf("expected confirmed inbound stock to remain at original quantity 10, got %d", unchangedItem.Quantity)
	}
}

func TestConfirmedInboundDocumentNoteCanBeUpdatedIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "NOTE-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Original receipt note",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           1,
			PalletsDetailCtns: "1*10",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document: %v", err)
	}

	updated, err := store.UpdateInboundDocumentNote(ctx, receipt.ID, UpdateInboundDocumentNoteInput{
		DocumentNote: "Updated receipt note",
	})
	if err != nil {
		t.Fatalf("update confirmed inbound note: %v", err)
	}
	if updated.DocumentNote != "Updated receipt note" {
		t.Fatalf("expected updated note %q, got %q", "Updated receipt note", updated.DocumentNote)
	}

	unchangedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "NOTE-"+suffix, item.SKU)
	if unchangedItem.Quantity != 10 {
		t.Fatalf("expected confirmed inbound stock to remain 10 after note update, got %d", unchangedItem.Quantity)
	}
}

func TestConfirmedInboundDocumentRemainsImmutableAfterPartialConsumptionIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "USED-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Original receipt",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           1,
			PalletsDetailCtns: "1*10",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound receipt: %v", err)
	}

	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "USED-OLD-"+suffix, item.SKU)
	if _, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "USED-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-24",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 4",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Consume part of receipt",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  receivedItem.CustomerID,
			LocationID:  receivedItem.LocationID,
			SKUMasterID: receivedItem.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	}); err != nil {
		t.Fatalf("create consuming outbound document: %v", err)
	}

	_, err = store.UpdateInboundDocument(ctx, receipt.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-28",
		ContainerNo:         "USED-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Metadata only correction",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*5",
			LineNote:          "Metadata correction",
		}},
	})
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected partially consumed confirmed inbound update to fail with ErrInvalidInput, got %v", err)
	}

	remainingItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "USED-OLD-"+suffix, item.SKU)
	if remainingItem.Quantity != 6 {
		t.Fatalf("expected remaining pallet-backed quantity 6 after outbound, got %d", remainingItem.Quantity)
	}
	if remainingItem.DeliveryDate == nil || remainingItem.DeliveryDate.Format("2006-01-02") != "2026-03-24" {
		t.Fatalf("expected original delivery date to remain unchanged, got %+v", remainingItem.DeliveryDate)
	}
}

func TestInboundConfirmationMatchesInventoryBySKUMasterIDIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)
	containerNo := "MASTER-" + suffix

	if _, err := store.db.ExecContext(ctx, `
		UPDATE inventory_items
		SET container_no = ?
		WHERE id = ?
	`, containerNo, item.ID); err != nil {
		t.Fatalf("prepare legacy inventory row: %v", err)
	}

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-31",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    "Matched by SKU master",
			StorageSection: DefaultStorageSection,
			ExpectedQty:    5,
			ReceivedQty:    5,
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document against legacy inventory row: %v", err)
	}

	if len(receipt.Lines) != 1 {
		t.Fatalf("expected one receipt line, got %d", len(receipt.Lines))
	}

	updatedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if updatedItem.ID != item.ID {
		t.Fatalf("expected inbound confirmation to reuse existing inventory row %d, got %d", item.ID, updatedItem.ID)
	}
	if updatedItem.Quantity != 5 {
		t.Fatalf("expected quantity 5 after inbound confirmation, got %d", updatedItem.Quantity)
	}
}

func TestConfirmedInboundCreatesPalletEntities(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "PalletCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "PalletLoc-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "PLT-SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerNo:         "PLT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Create pallet entities",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    11,
			ReceivedQty:    11,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed receipt with pallets: %v", err)
	}

	pallets, err := store.ListPallets(ctx, 50, ListPalletFilters{Search: "PLT-" + suffix})
	if err != nil {
		t.Fatalf("list pallets: %v", err)
	}

	filtered := make([]PalletTrace, 0)
	for _, pallet := range pallets {
		if pallet.SourceInboundDocumentID == receipt.ID {
			filtered = append(filtered, pallet)
		}
	}
	if len(filtered) != 3 {
		t.Fatalf("expected 3 pallets for receipt %d, got %d", receipt.ID, len(filtered))
	}

	totalQuantity := 0
	for _, pallet := range filtered {
		if pallet.ContainerVisitID <= 0 {
			t.Fatalf("expected pallet %d to reference container visit, got %d", pallet.ID, pallet.ContainerVisitID)
		}
		if pallet.CurrentContainerNo != "PLT-"+suffix {
			t.Fatalf("expected pallet %d container PLT-%s, got %q", pallet.ID, suffix, pallet.CurrentContainerNo)
		}
		if pallet.Status != PalletStatusOpen {
			t.Fatalf("expected pallet %d status %s, got %s", pallet.ID, PalletStatusOpen, pallet.Status)
		}
		if len(pallet.Contents) != 1 {
			t.Fatalf("expected pallet %d to have 1 content row, got %d", pallet.ID, len(pallet.Contents))
		}
		totalQuantity += pallet.Contents[0].Quantity
	}

	if totalQuantity != 11 {
		t.Fatalf("expected pallet quantity total 11, got %d", totalQuantity)
	}

	var palletLocationEventCount int
	if err := store.db.GetContext(ctx, &palletLocationEventCount, `
		SELECT COUNT(*)
		FROM pallet_location_events
		WHERE pallet_id IS NOT NULL
		  AND container_no = ?
	`, "PLT-"+suffix); err != nil {
		t.Fatalf("count pallet-specific location events: %v", err)
	}
	if palletLocationEventCount != 3 {
		t.Fatalf("expected 3 pallet-specific location events, got %d", palletLocationEventCount)
	}
}

func TestPalletCentricDualWriteLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "DualWriteCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "DualWriteLoc-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "DUAL-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerNo:         "DUAL-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Dual write inbound",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    12,
			ReceivedQty:    12,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document: %v", err)
	}

	var palletItemCount int
	if err := store.db.GetContext(ctx, &palletItemCount, `
		SELECT COUNT(*)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.source_inbound_document_id = ?
	`, inbound.ID); err != nil {
		t.Fatalf("count pallet items: %v", err)
	}
	if palletItemCount != 3 {
		t.Fatalf("expected 3 pallet items after inbound confirmation, got %d", palletItemCount)
	}

	var palletItemQty int
	if err := store.db.GetContext(ctx, &palletItemQty, `
		SELECT COALESCE(SUM(pi.quantity), 0)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.source_inbound_document_id = ?
	`, inbound.ID); err != nil {
		t.Fatalf("sum pallet item quantities after inbound: %v", err)
	}
	if palletItemQty != 12 {
		t.Fatalf("expected pallet item quantity 12 after inbound, got %d", palletItemQty)
	}

	var inboundLedgerCount int
	if err := store.db.GetContext(ctx, &inboundLedgerCount, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		  AND event_type = 'RECEIVE'
	`, inbound.ID); err != nil {
		t.Fatalf("count inbound stock ledger rows: %v", err)
	}
	if inboundLedgerCount != 3 {
		t.Fatalf("expected 3 inbound stock ledger rows, got %d", inboundLedgerCount)
	}

	var inboundLedgerQty int
	if err := store.db.GetContext(ctx, &inboundLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		  AND event_type = 'RECEIVE'
	`, inbound.ID); err != nil {
		t.Fatalf("sum inbound stock ledger quantities: %v", err)
	}
	if inboundLedgerQty != 12 {
		t.Fatalf("expected inbound stock ledger quantity 12, got %d", inboundLedgerQty)
	}

	inboundItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "DUAL-CONT-"+suffix, item.SKU)
	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "DUAL-PL-" + suffix,
		OrderRef:         "DUAL-SO-" + suffix,
		ExpectedShipDate: "2026-04-03",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "456 Dock Rd",
		ShipToContact:    "Gate 2",
		CarrierName:      "UPS",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Dual write outbound",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   inboundItem.CustomerID,
			LocationID:   inboundItem.LocationID,
			SKUMasterID:  inboundItem.SKUMasterID,
			Quantity:     5,
			Pallets:      1,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound document: %v", err)
	}

	var outboundPickQty int
	if err := store.db.GetContext(ctx, &outboundPickQty, `
		SELECT COALESCE(SUM(picked_qty), 0)
		FROM outbound_picks op
		JOIN outbound_document_lines l ON l.id = op.outbound_line_id
		WHERE l.document_id = ?
	`, outbound.ID); err != nil {
		t.Fatalf("sum outbound picks: %v", err)
	}
	if outboundPickQty != 5 {
		t.Fatalf("expected outbound picks total 5, got %d", outboundPickQty)
	}

	if err := store.db.GetContext(ctx, &palletItemQty, `
		SELECT COALESCE(SUM(pi.quantity), 0)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.source_inbound_document_id = ?
	`, inbound.ID); err != nil {
		t.Fatalf("sum pallet item quantities after outbound: %v", err)
	}
	if palletItemQty != 7 {
		t.Fatalf("expected pallet item quantity 7 after outbound, got %d", palletItemQty)
	}

	var outboundLedgerQty int
	if err := store.db.GetContext(ctx, &outboundLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'OUTBOUND'
		  AND source_document_id = ?
		  AND event_type = 'SHIP'
	`, outbound.ID); err != nil {
		t.Fatalf("sum outbound stock ledger quantities: %v", err)
	}
	if outboundLedgerQty != -5 {
		t.Fatalf("expected outbound stock ledger quantity -5, got %d", outboundLedgerQty)
	}

	if _, err := store.CancelOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}

	if err := store.db.GetContext(ctx, &palletItemQty, `
		SELECT COALESCE(SUM(pi.quantity), 0)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.source_inbound_document_id = ?
	`, inbound.ID); err != nil {
		t.Fatalf("sum pallet item quantities after outbound reversal: %v", err)
	}
	if palletItemQty != 12 {
		t.Fatalf("expected pallet item quantity 12 after outbound reversal, got %d", palletItemQty)
	}

	// After hard-delete cancel, all outbound stock_ledger entries are removed
	var remainingOutboundLedgerCount int
	if err := store.db.GetContext(ctx, &remainingOutboundLedgerCount, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'OUTBOUND'
		  AND source_document_id = ?
	`, outbound.ID); err != nil {
		t.Fatalf("count remaining outbound stock ledger entries: %v", err)
	}
	if remainingOutboundLedgerCount != 0 {
		t.Fatalf("expected 0 outbound stock ledger entries after hard-delete cancel, got %d", remainingOutboundLedgerCount)
	}
}

func TestInboundDocumentCreatesPalletsFromExplicitBreakdownIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "BreakdownCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "BreakdownLoc-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "BREAK-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-03",
		ContainerNo:         "BREAK-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    295,
			ReceivedQty:    295,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 120},
				{Quantity: 95},
				{Quantity: 80},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document with explicit pallet breakdown: %v", err)
	}

	var quantities []int
	if err := store.db.SelectContext(ctx, &quantities, `
		SELECT pi.quantity
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE p.source_inbound_document_id = ?
		ORDER BY pi.id
	`, inbound.ID); err != nil {
		t.Fatalf("list pallet item quantities: %v", err)
	}

	expected := []int{120, 95, 80}
	if !reflect.DeepEqual(quantities, expected) {
		t.Fatalf("expected pallet quantities %v, got %v", expected, quantities)
	}
}

func TestPalletCentricOperationalLedgerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "OpsCustomer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "OpsSource-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "OpsDestination-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, sourceLocation.ID, "OPS-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerNo:         "OPS-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Operational ledger inbound",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    12,
			ReceivedQty:    12,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create palletized inbound: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo: "ADJ-" + suffix,
		ReasonCode:   "DAMAGE",
		Notes:        "Reduce pallet stock",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLineFromItem(sourceItem, -2, "Broken cartons"),
		},
	})
	if err != nil {
		t.Fatalf("create inventory adjustment: %v", err)
	}

	var adjustmentLedgerQty int
	if err := store.db.GetContext(ctx, &adjustmentLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
		  AND event_type = 'ADJUST'
	`, adjustment.ID); err != nil {
		t.Fatalf("sum adjustment stock ledger quantities: %v", err)
	}
	if adjustmentLedgerQty != -2 {
		t.Fatalf("expected adjustment stock ledger quantity -2, got %d", adjustmentLedgerQty)
	}

	if err := store.db.GetContext(ctx, &adjustmentLedgerQty, `
		SELECT COALESCE(SUM(pi.quantity), 0)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		JOIN inventory_items i
			ON i.sku_master_id = pi.sku_master_id
			AND i.customer_id = p.customer_id
			AND i.location_id = p.current_location_id
			AND i.storage_section = p.current_storage_section
			AND COALESCE(i.container_no, '') = COALESCE(p.current_container_no, '')
		WHERE i.id = ?
	`, sourceItem.ID); err != nil {
		t.Fatalf("sum source pallet items after adjustment: %v", err)
	}
	if adjustmentLedgerQty != 10 {
		t.Fatalf("expected source pallet item quantity 10 after adjustment, got %d", adjustmentLedgerQty)
	}

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TR-" + suffix,
		Notes:      "Move palletized stock west",
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(sourceItem, 4, destinationLocation.ID, "B", "Re-slot pallets"),
		},
	})
	if err != nil {
		t.Fatalf("create palletized transfer: %v", err)
	}

	var transferOutLedgerQty int
	if err := store.db.GetContext(ctx, &transferOutLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'TRANSFER'
		  AND source_document_id = ?
		  AND event_type = 'TRANSFER_OUT'
	`, transfer.ID); err != nil {
		t.Fatalf("sum transfer-out stock ledger quantities: %v", err)
	}
	if transferOutLedgerQty != -4 {
		t.Fatalf("expected transfer-out stock ledger quantity -4, got %d", transferOutLedgerQty)
	}

	var transferInLedgerQty int
	if err := store.db.GetContext(ctx, &transferInLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'TRANSFER'
		  AND source_document_id = ?
		  AND event_type = 'TRANSFER_IN'
	`, transfer.ID); err != nil {
		t.Fatalf("sum transfer-in stock ledger quantities: %v", err)
	}
	if transferInLedgerQty != 4 {
		t.Fatalf("expected transfer-in stock ledger quantity 4, got %d", transferInLedgerQty)
	}

	destinationItem := mustFindItemByLocationAndSection(t, ctx, store, destinationLocation.ID, "B", sourceItem.SKU)
	if err := store.db.GetContext(ctx, &transferInLedgerQty, `
		SELECT COALESCE(SUM(pi.quantity), 0)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		JOIN inventory_items i
			ON i.sku_master_id = pi.sku_master_id
			AND i.customer_id = p.customer_id
			AND i.location_id = p.current_location_id
			AND i.storage_section = p.current_storage_section
			AND COALESCE(i.container_no, '') = COALESCE(p.current_container_no, '')
		WHERE i.id = ?
	`, destinationItem.ID); err != nil {
		t.Fatalf("sum destination pallet items after transfer: %v", err)
	}
	if transferInLedgerQty != 4 {
		t.Fatalf("expected destination pallet item quantity 4 after transfer, got %d", transferInLedgerQty)
	}

	count, err := store.CreateCycleCount(ctx, CreateCycleCountInput{
		CountNo: "CC-" + suffix,
		Notes:   "Cycle count after transfer",
		Lines: []CreateCycleCountLineInput{
			cycleCountLineFromItem(sourceItem, 5, "One unit missing after check"),
		},
	})
	if err != nil {
		t.Fatalf("create palletized cycle count: %v", err)
	}

	var countLedgerQty int
	if err := store.db.GetContext(ctx, &countLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'CYCLE_COUNT'
		  AND source_document_id = ?
		  AND event_type = 'COUNT'
	`, count.ID); err != nil {
		t.Fatalf("sum cycle count stock ledger quantities: %v", err)
	}
	if countLedgerQty != -1 {
		t.Fatalf("expected cycle count stock ledger quantity -1, got %d", countLedgerQty)
	}

	if err := store.db.GetContext(ctx, &countLedgerQty, `
		SELECT COALESCE(SUM(pi.quantity), 0)
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		JOIN inventory_items i
			ON i.sku_master_id = pi.sku_master_id
			AND i.customer_id = p.customer_id
			AND i.location_id = p.current_location_id
			AND i.storage_section = p.current_storage_section
			AND COALESCE(i.container_no, '') = COALESCE(p.current_container_no, '')
		WHERE i.id = ?
	`, sourceItem.ID); err != nil {
		t.Fatalf("sum source pallet items after cycle count: %v", err)
	}
	if countLedgerQty != 5 {
		t.Fatalf("expected source pallet item quantity 5 after cycle count, got %d", countLedgerQty)
	}
}

func TestSelectedPalletInventoryActionsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "SelectedPalletCustomer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "SelectedPalletSource-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "SelectedPalletDestination-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, sourceLocation.ID, "SELECT-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         "SELECT-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Selected pallet actions",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    12,
			ReceivedQty:    12,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create selected-pallet inbound: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)
	pallets, err := store.ListPallets(ctx, 50, ListPalletFilters{SourceInboundDocumentID: inbound.ID})
	if err != nil {
		t.Fatalf("list source pallets: %v", err)
	}
	if len(pallets) < 2 {
		t.Fatalf("expected at least 2 pallets, got %d", len(pallets))
	}
	sort.Slice(pallets, func(left, right int) bool {
		return pallets[left].ID < pallets[right].ID
	})

	adjustmentPallet := pallets[0]
	transferPallet := pallets[1]
	adjustmentQty := adjustmentPallet.Contents[0].Quantity
	transferQty := transferPallet.Contents[0].Quantity

	adjustmentLine := adjustmentLineFromItem(sourceItem, -adjustmentQty, "Selected pallet adjustment")
	adjustmentLine.PalletID = adjustmentPallet.ID
	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo: "ADJ-SEL-" + suffix,
		ReasonCode:   "DAMAGE",
		Notes:        "Adjust one selected pallet",
		Lines:        []CreateInventoryAdjustmentLineInput{adjustmentLine},
	})
	if err != nil {
		t.Fatalf("create selected-pallet adjustment: %v", err)
	}

	var adjustmentSelectedLedgerQty int
	if err := store.db.GetContext(ctx, &adjustmentSelectedLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
		  AND event_type = 'ADJUST'
		  AND pallet_id = ?
	`, adjustment.ID, adjustmentPallet.ID); err != nil {
		t.Fatalf("sum selected adjustment ledger quantities: %v", err)
	}
	if adjustmentSelectedLedgerQty != -adjustmentQty {
		t.Fatalf("expected selected pallet adjustment quantity -%d, got %d", adjustmentQty, adjustmentSelectedLedgerQty)
	}

	var adjustmentOtherLedgerCount int
	if err := store.db.GetContext(ctx, &adjustmentOtherLedgerCount, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
		  AND pallet_id = ?
	`, adjustment.ID, transferPallet.ID); err != nil {
		t.Fatalf("count non-selected adjustment ledger rows: %v", err)
	}
	if adjustmentOtherLedgerCount != 0 {
		t.Fatalf("expected non-selected pallet to remain untouched by adjustment, got %d ledger rows", adjustmentOtherLedgerCount)
	}

	var adjustmentPalletQty int
	if err := store.db.GetContext(ctx, &adjustmentPalletQty, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM pallet_items
		WHERE pallet_id = ?
	`, adjustmentPallet.ID); err != nil {
		t.Fatalf("load selected adjustment pallet quantity: %v", err)
	}
	if adjustmentPalletQty != 0 {
		t.Fatalf("expected selected adjustment pallet quantity 0, got %d", adjustmentPalletQty)
	}

	transferLine := transferLineFromItem(sourceItem, transferQty, destinationLocation.ID, "B", "Selected pallet transfer")
	transferLine.PalletID = transferPallet.ID
	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TR-SEL-" + suffix,
		Notes:      "Transfer one selected pallet",
		Lines:      []CreateInventoryTransferLineInput{transferLine},
	})
	if err != nil {
		t.Fatalf("create selected-pallet transfer: %v", err)
	}

	var transferSelectedLedgerQty int
	if err := store.db.GetContext(ctx, &transferSelectedLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'TRANSFER'
		  AND source_document_id = ?
		  AND event_type = 'TRANSFER_OUT'
		  AND pallet_id = ?
	`, transfer.ID, transferPallet.ID); err != nil {
		t.Fatalf("sum selected transfer-out ledger quantities: %v", err)
	}
	if transferSelectedLedgerQty != -transferQty {
		t.Fatalf("expected selected pallet transfer-out quantity -%d, got %d", transferQty, transferSelectedLedgerQty)
	}

	var transferAdjustmentPalletLedgerCount int
	if err := store.db.GetContext(ctx, &transferAdjustmentPalletLedgerCount, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'TRANSFER'
		  AND source_document_id = ?
		  AND event_type = 'TRANSFER_OUT'
		  AND pallet_id = ?
	`, transfer.ID, adjustmentPallet.ID); err != nil {
		t.Fatalf("count transfer ledger rows on non-selected pallet: %v", err)
	}
	if transferAdjustmentPalletLedgerCount != 0 {
		t.Fatalf("expected transfer to leave the previously adjusted pallet untouched, got %d ledger rows", transferAdjustmentPalletLedgerCount)
	}

	var transferPalletQtyAfter int
	if err := store.db.GetContext(ctx, &transferPalletQtyAfter, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM pallet_items
		WHERE pallet_id = ?
	`, transferPallet.ID); err != nil {
		t.Fatalf("load selected transfer pallet quantity: %v", err)
	}
	if transferPalletQtyAfter != 0 {
		t.Fatalf("expected selected transfer pallet quantity 0 after transfer, got %d", transferPalletQtyAfter)
	}

	destinationItem := mustFindItemByLocationAndSection(t, ctx, store, destinationLocation.ID, "B", sourceItem.SKU)
	if destinationItem.Quantity != transferQty {
		t.Fatalf("expected destination quantity %d after selected pallet transfer, got %d", transferQty, destinationItem.Quantity)
	}
}

func TestConfirmedOutboundHonorsManualSelectedPalletsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "ManualPickCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "ManualPickLocation-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "MANUAL-PICK-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         "MANUAL-PICK-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Seed inbound for manual selected pallet outbound",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			Pallets:           2,
			PalletsDetailCtns: "5+7",
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 5},
				{Quantity: 7},
			},
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound for manual selected pallet outbound: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)
	pallets, err := store.ListPallets(ctx, 50, ListPalletFilters{SourceInboundDocumentID: inbound.ID})
	if err != nil {
		t.Fatalf("list inbound pallets for manual selected pallet outbound: %v", err)
	}
	if len(pallets) != 2 {
		t.Fatalf("expected 2 inbound pallets, got %d", len(pallets))
	}
	sort.Slice(pallets, func(left, right int) bool {
		return pallets[left].ID < pallets[right].ID
	})

	selectedPallet := pallets[1]
	selectedQty := selectedPallet.Contents[0].Quantity
	if selectedQty != 7 {
		t.Fatalf("expected second pallet quantity 7, got %d", selectedQty)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "MANUAL-PICK-PL-" + suffix,
		OrderRef:         "MANUAL-PICK-SO-" + suffix,
		ExpectedShipDate: "2026-04-11",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Manual selected pallet should be honored on confirm",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  sourceItem.CustomerID,
			LocationID:  sourceItem.LocationID,
			SKUMasterID: sourceItem.SKUMasterID,
			Quantity:    selectedQty,
			Pallets:     1,
			UnitLabel:   "CTN",
			PickPallets: []OutboundLinePalletPick{
				{PalletID: selectedPallet.ID, Quantity: selectedQty},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft with manual selected pallet: %v", err)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm outbound draft with manual selected pallet: %v", err)
	}

	var pickedPalletIDs []int64
	if err := store.db.SelectContext(ctx, &pickedPalletIDs, `
		SELECT op.pallet_id
		FROM outbound_picks op
		INNER JOIN outbound_document_lines ol ON ol.id = op.outbound_line_id
		WHERE ol.document_id = ?
		ORDER BY op.id ASC
	`, outbound.ID); err != nil {
		t.Fatalf("load outbound picked pallet ids: %v", err)
	}
	if len(pickedPalletIDs) != 1 {
		t.Fatalf("expected exactly 1 picked pallet row, got %d", len(pickedPalletIDs))
	}
	if pickedPalletIDs[0] != selectedPallet.ID {
		t.Fatalf("expected selected pallet %d to be picked, got %d", selectedPallet.ID, pickedPalletIDs[0])
	}

	var remainingSelectedQty int
	if err := store.db.GetContext(ctx, &remainingSelectedQty, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM pallet_items
		WHERE pallet_id = ?
	`, selectedPallet.ID); err != nil {
		t.Fatalf("load remaining selected pallet quantity: %v", err)
	}
	if remainingSelectedQty != 0 {
		t.Fatalf("expected selected pallet quantity 0 after confirm, got %d", remainingSelectedQty)
	}

	var firstPalletQty int
	if err := store.db.GetContext(ctx, &firstPalletQty, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM pallet_items
		WHERE pallet_id = ?
	`, pallets[0].ID); err != nil {
		t.Fatalf("load untouched first pallet quantity: %v", err)
	}
	if firstPalletQty != pallets[0].Contents[0].Quantity {
		t.Fatalf("expected first pallet quantity %d to remain untouched, got %d", pallets[0].Contents[0].Quantity, firstPalletQty)
	}
}

func TestAdjustmentAndTransferActualTimesIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "ActualTimeCustomer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "ActualTimeSource-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "ActualTimeDestination-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, sourceLocation.ID, "ACTUAL-TIME-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         "ACTUAL-TIME-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Actual-time seed inbound",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    12,
			ReceivedQty:    12,
			Pallets:        2,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create seed inbound for actual-time test: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)

	adjustmentActual := "2026-04-11T14:30:00Z"
	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo:     "ADJ-ACT-" + suffix,
		ReasonCode:       "CORRECTION",
		ActualAdjustedAt: adjustmentActual,
		Notes:            "Backfilled adjustment time",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLineFromItem(sourceItem, -2, "actual-time adjustment"),
		},
	})
	if err != nil {
		t.Fatalf("create actual-time adjustment: %v", err)
	}
	if adjustment.ActualAdjustedAt == nil || adjustment.ActualAdjustedAt.UTC().Format(time.RFC3339) != adjustmentActual {
		t.Fatalf("expected actualAdjustedAt %s, got %#v", adjustmentActual, adjustment.ActualAdjustedAt)
	}

	var adjustmentOccurredAt sql.NullTime
	if err := store.db.GetContext(ctx, &adjustmentOccurredAt, `
		SELECT occurred_at
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
		ORDER BY id ASC
		LIMIT 1
	`, adjustment.ID); err != nil {
		t.Fatalf("load adjustment stock ledger occurred_at: %v", err)
	}
	if !adjustmentOccurredAt.Valid || adjustmentOccurredAt.Time.UTC().Format(time.RFC3339) != adjustmentActual {
		t.Fatalf("expected adjustment ledger occurred_at %s, got %v", adjustmentActual, adjustmentOccurredAt)
	}

	transferActual := "2026-04-12T11:15:00Z"
	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo:          "TR-ACT-" + suffix,
		ActualTransferredAt: transferActual,
		Notes:               "Backfilled transfer time",
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(sourceItem, 3, destinationLocation.ID, "B", "actual-time transfer"),
		},
	})
	if err != nil {
		t.Fatalf("create actual-time transfer: %v", err)
	}
	if transfer.ActualTransferredAt == nil || transfer.ActualTransferredAt.UTC().Format(time.RFC3339) != transferActual {
		t.Fatalf("expected actualTransferredAt %s, got %#v", transferActual, transfer.ActualTransferredAt)
	}

	var transferOccurredAt sql.NullTime
	if err := store.db.GetContext(ctx, &transferOccurredAt, `
		SELECT occurred_at
		FROM stock_ledger
		WHERE source_document_type = 'TRANSFER'
		  AND source_document_id = ?
		  AND event_type = 'TRANSFER_OUT'
		ORDER BY id ASC
		LIMIT 1
	`, transfer.ID); err != nil {
		t.Fatalf("load transfer stock ledger occurred_at: %v", err)
	}
	if !transferOccurredAt.Valid || transferOccurredAt.Time.UTC().Format(time.RFC3339) != transferActual {
		t.Fatalf("expected transfer ledger occurred_at %s, got %v", transferActual, transferOccurredAt)
	}

	var transferEventTime sql.NullTime
	if err := store.db.GetContext(ctx, &transferEventTime, `
		SELECT event_time
		FROM pallet_location_events
		WHERE event_type = ?
		  AND container_no = ?
		ORDER BY id ASC
		LIMIT 1
	`, PalletEventTransferOut, inbound.ContainerNo); err != nil {
		t.Fatalf("load transfer pallet event_time: %v", err)
	}
	if !transferEventTime.Valid || transferEventTime.Time.UTC().Format(time.RFC3339) != transferActual {
		t.Fatalf("expected transfer pallet event_time %s, got %v", transferActual, transferEventTime)
	}
}

func TestInboundDocumentCopyAndArchiveIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	original, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-26",
		ContainerNo:         "COPY-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Inbound copy/archive test",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*6",
			LineNote:          "keep this line",
		}},
	})
	if err != nil {
		t.Fatalf("create inbound document: %v", err)
	}
	if _, err := store.ArchiveInboundDocument(ctx, original.ID); err == nil {
		t.Fatal("expected archiving a confirmed inbound document to fail")
	}

	// Copy the confirmed document before cancelling (cancel now hard-deletes)
	copied, err := store.CopyInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("copy confirmed inbound document: %v", err)
	}
	if copied.ID == original.ID {
		t.Fatal("expected copied inbound document to have a new id")
	}
	if copied.Status != DocumentStatusDraft {
		t.Fatalf("expected copied inbound status DRAFT, got %q", copied.Status)
	}
	if copied.TrackingStatus != InboundTrackingScheduled {
		t.Fatalf("expected copied inbound tracking status %q, got %q", InboundTrackingScheduled, copied.TrackingStatus)
	}
	if len(copied.Lines) != 1 || copied.Lines[0].SKU != item.SKU {
		t.Fatalf("expected copied inbound line for %q, got %#v", item.SKU, copied.Lines)
	}

	// Cancel (hard-delete) the original document and all related records
	cancelled, err := store.CancelInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("cancel inbound document: %v", err)
	}
	if cancelled.Status != DocumentStatusDeleted {
		t.Fatalf("expected deleted inbound status, got %q", cancelled.Status)
	}

	// After cancel/hard-delete, only the copied document should remain
	inboundDocuments, err := store.ListInboundDocuments(ctx, 20)
	if err != nil {
		t.Fatalf("list inbound documents: %v", err)
	}
	if len(inboundDocuments) != 1 {
		t.Fatalf("expected only copied inbound document to remain in active list, got %d", len(inboundDocuments))
	}
	if inboundDocuments[0].ID != copied.ID {
		t.Fatalf("expected copied inbound document %d in active list, got %d", copied.ID, inboundDocuments[0].ID)
	}

	// Archived and all-scope lists should also have only the copy
	archivedInboundDocuments, err := store.ListInboundDocuments(ctx, 20, DocumentArchiveScopeArchived)
	if err != nil {
		t.Fatalf("list archived inbound documents: %v", err)
	}
	if len(archivedInboundDocuments) != 0 {
		t.Fatalf("expected no archived inbound documents after hard-delete, got %d", len(archivedInboundDocuments))
	}

	allInboundDocuments, err := store.ListInboundDocuments(ctx, 20, DocumentArchiveScopeAll)
	if err != nil {
		t.Fatalf("list all inbound documents: %v", err)
	}
	if len(allInboundDocuments) != 1 {
		t.Fatalf("expected only copied inbound document in all list, got %d", len(allInboundDocuments))
	}
}

func TestOutboundDocumentCopyAndArchiveIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 18, DefaultStorageSection)

	original, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "COPY-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-26",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "200 Export Rd",
		ShipToContact:    "Dock 8",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Outbound copy/archive test",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     5,
			Pallets:      1,
			UnitLabel:    "CTN",
			CartonSizeMM: "500*400*300",
			LineNote:     "copy this shipment",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound document: %v", err)
	}

	// Copy the confirmed document before cancelling (cancel now hard-deletes)
	copied, err := store.CopyOutboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("copy confirmed outbound document: %v", err)
	}
	if copied.ID == original.ID {
		t.Fatal("expected copied outbound document to have a new id")
	}
	if copied.Status != DocumentStatusDraft {
		t.Fatalf("expected copied outbound status DRAFT, got %q", copied.Status)
	}
	if copied.TrackingStatus != OutboundTrackingScheduled {
		t.Fatalf("expected copied outbound tracking status %q, got %q", OutboundTrackingScheduled, copied.TrackingStatus)
	}
	if len(copied.Lines) != 1 {
		t.Fatalf("expected copied outbound document to have 1 line, got %d", len(copied.Lines))
	}
	if len(copied.Lines[0].PickAllocations) != 0 {
		t.Fatal("expected copied outbound draft to recompute pick allocations on confirm, not retain them")
	}

	// Cancel (hard-delete) the original document and all related records
	cancelled, err := store.CancelOutboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	if cancelled.Status != DocumentStatusDeleted {
		t.Fatalf("expected deleted outbound status, got %q", cancelled.Status)
	}

	// After cancel/hard-delete, only the copied document should remain
	outboundDocuments, err := store.ListOutboundDocuments(ctx, 20)
	if err != nil {
		t.Fatalf("list outbound documents: %v", err)
	}
	if len(outboundDocuments) != 1 {
		t.Fatalf("expected only copied outbound document to remain in active list, got %d", len(outboundDocuments))
	}
	if outboundDocuments[0].ID != copied.ID {
		t.Fatalf("expected copied outbound document %d in active list, got %d", copied.ID, outboundDocuments[0].ID)
	}

	// Archived and all-scope lists should have only the copy
	archivedOutboundDocuments, err := store.ListOutboundDocuments(ctx, 20, DocumentArchiveScopeArchived)
	if err != nil {
		t.Fatalf("list archived outbound documents: %v", err)
	}
	if len(archivedOutboundDocuments) != 0 {
		t.Fatalf("expected no archived outbound documents after hard-delete, got %d", len(archivedOutboundDocuments))
	}

	allOutboundDocuments, err := store.ListOutboundDocuments(ctx, 20, DocumentArchiveScopeAll)
	if err != nil {
		t.Fatalf("list all outbound documents: %v", err)
	}
	if len(allOutboundDocuments) != 1 {
		t.Fatalf("expected only copied outbound document in all list, got %d", len(allOutboundDocuments))
	}
}

func TestInboundTrackingLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-25",
		ContainerNo:         "TRACK-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		TrackingStatus:      InboundTrackingScheduled,
		DocumentNote:        "Inbound tracking integration test",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    8,
			ReceivedQty:    8,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound tracking document: %v", err)
	}
	if inbound.TrackingStatus != InboundTrackingScheduled {
		t.Fatalf("expected inbound tracking status %q, got %q", InboundTrackingScheduled, inbound.TrackingStatus)
	}

	inbound, err = store.UpdateInboundDocumentTrackingStatus(ctx, inbound.ID, InboundTrackingArrived)
	if err != nil {
		t.Fatalf("mark inbound arrived: %v", err)
	}
	if inbound.Status != DocumentStatusDraft || inbound.TrackingStatus != InboundTrackingArrived {
		t.Fatalf("expected inbound draft/arrived, got %q/%q", inbound.Status, inbound.TrackingStatus)
	}

	inbound, err = store.UpdateInboundDocumentTrackingStatus(ctx, inbound.ID, InboundTrackingReceiving)
	if err != nil {
		t.Fatalf("mark inbound receiving: %v", err)
	}
	if inbound.Status != DocumentStatusDraft || inbound.TrackingStatus != InboundTrackingReceiving {
		t.Fatalf("expected inbound draft/receiving, got %q/%q", inbound.Status, inbound.TrackingStatus)
	}

	inbound, err = store.UpdateInboundDocumentTrackingStatus(ctx, inbound.ID, InboundTrackingReceived)
	if err != nil {
		t.Fatalf("complete inbound receipt: %v", err)
	}
	if inbound.Status != DocumentStatusConfirmed || inbound.TrackingStatus != InboundTrackingReceived {
		t.Fatalf("expected inbound confirmed/received, got %q/%q", inbound.Status, inbound.TrackingStatus)
	}

	itemAfterReceipt := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "TRACK-IN-"+suffix, item.SKU)
	if itemAfterReceipt.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after tracked inbound completion, got %d", itemAfterReceipt.Quantity)
	}
}

func TestOutboundTrackingLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "TRACK-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-25",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusDraft,
		TrackingStatus:   OutboundTrackingScheduled,
		DocumentNote:     "Outbound tracking integration test",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound tracking document: %v", err)
	}
	if outbound.TrackingStatus != OutboundTrackingScheduled {
		t.Fatalf("expected outbound tracking status %q, got %q", OutboundTrackingScheduled, outbound.TrackingStatus)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking)
	if err != nil {
		t.Fatalf("mark outbound picking: %v", err)
	}
	if outbound.Status != DocumentStatusDraft || outbound.TrackingStatus != OutboundTrackingPicking {
		t.Fatalf("expected outbound draft/picking, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPacked)
	if err != nil {
		t.Fatalf("mark outbound packed: %v", err)
	}
	if outbound.Status != DocumentStatusDraft || outbound.TrackingStatus != OutboundTrackingPacked {
		t.Fatalf("expected outbound draft/packed, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingShipped)
	if err != nil {
		t.Fatalf("mark outbound shipped: %v", err)
	}
	if outbound.Status != DocumentStatusConfirmed || outbound.TrackingStatus != OutboundTrackingShipped {
		t.Fatalf("expected outbound confirmed/shipped, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}

	itemAfterShipment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterShipment.Quantity != 6 {
		t.Fatalf("expected on-hand 6 after tracked outbound completion, got %d", itemAfterShipment.Quantity)
	}
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
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "CONT-MULTI-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Multi-section receipt",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				StorageSection: DefaultStorageSection,
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

	itemSectionTemp := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-MULTI-"+suffix, item.SKU)
	if itemSectionTemp.Quantity != 5 {
		t.Fatalf("expected temporary section quantity 5, got %d", itemSectionTemp.Quantity)
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
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-22",
		ContainerNo:         "CONT-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		DocumentNote:        "Inbound draft before edit",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound draft: %v", err)
	}

	inbound, err = store.UpdateInboundDocument(ctx, inbound.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-EDIT-" + suffix,
		StorageSection:      "B",
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		DocumentNote:        "Inbound draft edited",
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
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-EDIT-" + suffix,
		StorageSection:      "B",
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Inbound draft confirmed from edit",
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
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Dock Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Outbound draft before edit",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   itemAfterInboundConfirm.CustomerID,
			LocationID:   itemAfterInboundConfirm.LocationID,
			SKUMasterID:  itemAfterInboundConfirm.SKUMasterID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft: %v", err)
	}

	outbound, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:    "PL-EDIT-" + suffix,
		OrderRef:         "SO-EDIT-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Edited Receiver " + suffix,
		ShipToAddress:    "456 Dock Ln",
		ShipToContact:    "Dock 4",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Outbound draft edited",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   itemAfterInboundConfirm.CustomerID,
			LocationID:   itemAfterInboundConfirm.LocationID,
			SKUMasterID:  itemAfterInboundConfirm.SKUMasterID,
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
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected edited outbound draft to defer pick allocations until confirm")
	}
	itemAfterOutboundDraft := mustFindItemByID(t, ctx, store, itemAfterInboundConfirm.ID)
	if itemAfterOutboundDraft.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after outbound draft edit, got %d", itemAfterOutboundDraft.Quantity)
	}

	outbound, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:    "PL-EDIT-" + suffix,
		OrderRef:         "SO-FINAL-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Final Receiver " + suffix,
		ShipToAddress:    "789 Dock Ln",
		ShipToContact:    "Dock 8",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Outbound draft confirmed from edit",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   itemAfterInboundConfirm.CustomerID,
			LocationID:   itemAfterInboundConfirm.LocationID,
			SKUMasterID:  itemAfterInboundConfirm.SKUMasterID,
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
	itemA := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 5, DefaultStorageSection)
	itemB := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 7, "B")

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-SPLIT-" + suffix,
		OrderRef:         "SO-SPLIT-" + suffix,
		ExpectedShipDate: "2026-03-22",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Split allocation integration test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
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
	if len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound to defer split pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
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
	itemBAfter := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemAAfter.Quantity+itemBAfter.Quantity != 2 {
		t.Fatalf("expected total remaining quantity 2 after split allocation, got %d", itemAAfter.Quantity+itemBAfter.Quantity)
	}

	cancelled, err := store.CancelOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("cancel split outbound document: %v", err)
	}
	if !strings.EqualFold(cancelled.Status, DocumentStatusDeleted) {
		t.Fatalf("expected deleted outbound status, got %q", cancelled.Status)
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

func TestConfirmedOutboundDocumentIsImmutableIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 8, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Dock Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Immutable outbound baseline",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound: %v", err)
	}

	_, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:    "PL-EDIT-" + suffix,
		OrderRef:         "SO-EDIT-" + suffix,
		ExpectedShipDate: "2026-03-24",
		ShipToName:       "Edited Receiver " + suffix,
		ShipToAddress:    "456 Dock Ln",
		ShipToContact:    "Dock 4",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Should be rejected",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     1,
			UnitLabel:    "CTN",
			CartonSizeMM: "420*310*210",
		}},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput when editing confirmed outbound, got %v", err)
	}

	reloaded, err := store.getOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("reload confirmed outbound: %v", err)
	}
	if reloaded.PackingListNo != "PL-"+suffix {
		t.Fatalf("expected confirmed outbound packing list to remain unchanged, got %q", reloaded.PackingListNo)
	}
	if reloaded.TotalQty != 3 {
		t.Fatalf("expected confirmed outbound quantity to remain 3, got %d", reloaded.TotalQty)
	}

	itemAfter := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfter.Quantity != 5 {
		t.Fatalf("expected on-hand quantity 5 after immutable confirmed outbound, got %d", itemAfter.Quantity)
	}
}

func TestConfirmedOutboundDocumentNoteCanBeUpdatedIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 8, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Dock Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Original note",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound: %v", err)
	}

	updated, err := store.UpdateOutboundDocumentNote(ctx, outbound.ID, UpdateOutboundDocumentNoteInput{
		DocumentNote: "Updated note",
	})
	if err != nil {
		t.Fatalf("update confirmed outbound note: %v", err)
	}
	if updated.DocumentNote != "Updated note" {
		t.Fatalf("expected updated note %q, got %q", "Updated note", updated.DocumentNote)
	}
	if updated.TotalQty != 3 {
		t.Fatalf("expected confirmed outbound quantity to remain 3, got %d", updated.TotalQty)
	}

	itemAfter := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfter.Quantity != 5 {
		t.Fatalf("expected on-hand quantity 5 after note update, got %d", itemAfter.Quantity)
	}
}

func TestSealedTransitDraftCanBeConvertedToPalletizedBeforeConfirmationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerNo:         "SEALED-" + suffix,
		HandlingMode:        InboundHandlingModeSealedTransit,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		TrackingStatus:      InboundTrackingArrived,
		DocumentNote:        "Sealed transit arrival",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            "SKU-" + suffix,
			Description:    "Sealed transit line",
			ExpectedQty:    12,
			ReceivedQty:    0,
			Pallets:        0,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create sealed transit draft: %v", err)
	}
	if inbound.HandlingMode != InboundHandlingModeSealedTransit {
		t.Fatalf("expected handling mode %s, got %s", InboundHandlingModeSealedTransit, inbound.HandlingMode)
	}
	if inbound.Status != DocumentStatusDraft {
		t.Fatalf("expected draft sealed transit receipt, got %s", inbound.Status)
	}

	if _, err := store.ConfirmInboundDocument(ctx, inbound.ID); err == nil {
		t.Fatalf("expected sealed transit receipt confirmation to be rejected")
	}

	converted, err := store.UpdateInboundDocument(ctx, inbound.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-03",
		ContainerNo:         "SEALED-" + suffix,
		HandlingMode:        InboundHandlingModePalletized,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		TrackingStatus:      InboundTrackingReceived,
		DocumentNote:        "Converted to palletized",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            "SKU-" + suffix,
			Description:    "Sealed transit line",
			ExpectedQty:    12,
			ReceivedQty:    12,
			Pallets:        2,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("convert sealed transit receipt to palletized: %v", err)
	}
	if converted.HandlingMode != InboundHandlingModePalletized {
		t.Fatalf("expected handling mode %s after conversion, got %s", InboundHandlingModePalletized, converted.HandlingMode)
	}
	if converted.Status != DocumentStatusConfirmed {
		t.Fatalf("expected converted receipt to be confirmed, got %s", converted.Status)
	}

	items, err := store.ListItems(ctx, ItemFilters{LocationID: location.ID})
	if err != nil {
		t.Fatalf("list items after conversion: %v", err)
	}
	found := false
	for _, item := range items {
		if item.ContainerNo == "SEALED-"+suffix && item.SKU == "SKU-"+suffix && item.Quantity == 12 {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected converted palletized receipt inventory to be present")
	}

	pallets, err := store.ListPallets(ctx, 50, ListPalletFilters{SourceInboundDocumentID: converted.ID})
	if err != nil {
		t.Fatalf("list pallets after conversion: %v", err)
	}
	if len(pallets) != 2 {
		t.Fatalf("expected 2 pallets after conversion, got %d", len(pallets))
	}
}

func TestOutboundAutoAllocationFromMergedContainerLedgerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-A-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    6,
			ReceivedQty:    6,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create first inbound receipt: %v", err)
	}
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-B-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    4,
			ReceivedQty:    4,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create second inbound receipt: %v", err)
	}

	itemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-A-"+suffix, item.SKU)
	itemB := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-B-"+suffix, item.SKU)
	if itemA.Quantity+itemB.Quantity != 10 {
		t.Fatalf("expected total pallet-backed quantity 10 across containers, got %d", itemA.Quantity+itemB.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-MERGED-" + suffix,
		OrderRef:         "SO-MERGED-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Merged container allocation test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
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
	if len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound to defer pallet-backed pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm merged outbound document: %v", err)
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed pick allocations from pallet-backed container balances, got %d", len(outbound.Lines[0].PickAllocations))
	}

	itemAAfter := mustFindItemByID(t, ctx, store, itemA.ID)
	itemBAfter := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemAAfter.Quantity+itemBAfter.Quantity != 2 {
		t.Fatalf("expected total remaining pallet-backed quantity 2 after confirm, got %d", itemAAfter.Quantity+itemBAfter.Quantity)
	}
}

func TestOutboundAutoContainerAllocationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-A-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    1,
			ReceivedQty:    1,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create first inbound receipt: %v", err)
	}
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-B-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    9,
			ReceivedQty:    9,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create second inbound receipt: %v", err)
	}

	itemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-A-"+suffix, item.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-MANUAL-" + suffix,
		OrderRef:         "SO-MANUAL-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Automatic container allocation test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
				Quantity:     5,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create automatic outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound to defer pick allocations until confirm, got %+v", outbound.Lines)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm automatic outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed auto pick allocations, got %+v", outbound.Lines)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo != "CONT-A-"+suffix || outbound.Lines[0].PickAllocations[0].AllocatedQty != 1 {
		t.Fatalf("expected confirmed first auto allocation CONT-A qty 1, got %+v", outbound.Lines[0].PickAllocations[0])
	}
	if outbound.Lines[0].PickAllocations[1].ContainerNo != "CONT-B-"+suffix || outbound.Lines[0].PickAllocations[1].AllocatedQty != 4 {
		t.Fatalf("expected confirmed second auto allocation CONT-B qty 4, got %+v", outbound.Lines[0].PickAllocations[1])
	}

	itemAfterConfirm := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterConfirm.Quantity != 0 {
		t.Fatalf("expected original seed row to stay empty in pallet-centric flow, got %d", itemAfterConfirm.Quantity)
	}

	itemBAfter := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-B-"+suffix, item.SKU)
	if itemBAfter.Quantity != 5 {
		t.Fatalf("expected CONT-B to retain 5 units after confirm, got %d", itemBAfter.Quantity)
	}

	itemsAfterConfirm, err := store.ListItems(ctx, ItemFilters{LocationID: location.ID})
	if err != nil {
		t.Fatalf("list items after auto allocation confirm: %v", err)
	}
	totalRemainingQty := 0
	for _, listedItem := range itemsAfterConfirm {
		if listedItem.SKU != item.SKU {
			continue
		}
		totalRemainingQty += listedItem.Quantity
	}
	if totalRemainingQty != 5 {
		t.Fatalf("expected total remaining pallet-backed quantity 5 after confirm, got %d", totalRemainingQty)
	}

	movements, err := store.ListMovements(ctx, 20)
	if err != nil {
		t.Fatalf("list movements after auto allocation confirm: %v", err)
	}

	var movementContainers []string
	for _, movement := range movements {
		if movement.OutboundDocumentID == outbound.ID && movement.MovementType == "OUT" {
			movementContainers = append(movementContainers, movement.ContainerNo)
		}
	}
	if !containsString(movementContainers, "CONT-A-"+suffix) || !containsString(movementContainers, "CONT-B-"+suffix) {
		t.Fatalf("expected outbound movements to preserve auto-allocated containers, got %v", movementContainers)
	}
}

func TestOutboundConfirmedSubmissionAllowsDifferentSKUsFromSameContainerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	itemA := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-A-"+suffix, 0)
	itemB := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-B-"+suffix, 0)
	containerNo := "CONT-MULTI-SKU-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:            itemA.SKU,
				Description:    itemA.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			},
			{
				SKU:            itemB.SKU,
				Description:    itemB.Description,
				ExpectedQty:    7,
				ReceivedQty:    7,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			},
		},
	}); err != nil {
		t.Fatalf("create inbound receipt for multi-sku container: %v", err)
	}

	sourceItemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, itemA.SKU)
	sourceItemB := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, itemB.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-MULTI-SKU-" + suffix,
		OrderRef:         "SO-MULTI-SKU-" + suffix,
		ExpectedShipDate: "2026-03-24",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Ship two SKUs from the same container",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:  sourceItemA.CustomerID,
				LocationID:  sourceItemA.LocationID,
				SKUMasterID: sourceItemA.SKUMasterID,
				Quantity:    5,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
			{
				CustomerID:  sourceItemB.CustomerID,
				LocationID:  sourceItemB.LocationID,
				SKUMasterID: sourceItemB.SKUMasterID,
				Quantity:    7,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
		},
	})
	if err != nil {
		t.Fatalf("confirm outbound shipment for multi-sku container: %v", err)
	}

	if normalizeDocumentStatus(outbound.Status) != DocumentStatusConfirmed {
		t.Fatalf("expected outbound document to be confirmed, got %s", outbound.Status)
	}
	if len(outbound.Lines) != 2 {
		t.Fatalf("expected 2 outbound lines, got %d", len(outbound.Lines))
	}

	for _, line := range outbound.Lines {
		if len(line.PickAllocations) != 1 {
			t.Fatalf("expected one pallet-backed pick allocation for line %d, got %+v", line.ID, line.PickAllocations)
		}
		allocation := line.PickAllocations[0]
		if allocation.ContainerNo != containerNo {
			t.Fatalf("expected allocation container %s, got %+v", containerNo, allocation)
		}
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
			transferLineFromItem(sourceItem, 5, destinationLocation.ID, "B", "Move to west warehouse"),
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
	var transferOutSeen bool
	var transferInSeen bool
	for _, movement := range movements {
		if movement.MovementType == "TRANSFER_OUT" {
			transferOutSeen = true
		}
		if movement.MovementType == "TRANSFER_IN" {
			transferInSeen = true
		}
	}
	if !transferOutSeen || !transferInSeen {
		t.Fatalf("expected pallet-centric transfer activity feed entries, got %+v", movements)
	}
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
			cycleCountLineFromItem(item, 7, "Three units missing"),
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
	var countSeen bool
	for _, movement := range movements {
		if movement.MovementType == "COUNT" {
			countSeen = true
			break
		}
	}
	if !countSeen {
		t.Fatalf("expected pallet-centric cycle count activity feed entry, got %+v", movements)
	}
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

func TestStorageSettlementInvoiceLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-" + suffix + "@example.com",
		FullName: "Billing " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing user: %v", err)
	}

	customerA := mustCreateCustomer(t, ctx, store, "Billing Customer A "+suffix)
	customerB := mustCreateCustomer(t, ctx, store, "Billing Customer B "+suffix)
	locationA := mustCreateLocation(t, ctx, store, "Billing NJ "+suffix)
	locationB := mustCreateLocation(t, ctx, store, "Billing LA "+suffix)

	input := CreateBillingInvoiceInput{
		InvoiceType:         BillingInvoiceTypeStorage,
		CustomerID:          customerA.ID,
		CustomerName:        customerA.Name,
		WarehouseLocationID: int64Ptr(locationA.ID),
		WarehouseName:       locationA.Name,
		PeriodStart:         "2026-03-01",
		PeriodEnd:           "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:         450,
			TransferInboundFeePerPallet: 10,
			WrappingFeePerPallet:        15,
			StorageFeePerPalletWeek:     7,
			OutboundFeePerPallet:        0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "STORAGE",
				Description: "Storage settlement for CONT-A",
				Reference:   "Storage | CONT-A",
				ContainerNo: "CONT-A",
				Warehouse:   locationA.Name,
				OccurredOn:  "2026-03-31",
				Quantity:    140,
				UnitRate:    1,
				Amount:      140,
				Notes:       "14 days x 10 pallets",
				SourceType:  "AUTO",
			},
		},
	}

	firstInvoice, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create first storage settlement invoice: %v", err)
	}
	if firstInvoice.InvoiceType != BillingInvoiceTypeStorage {
		t.Fatalf("expected storage settlement invoice type, got %q", firstInvoice.InvoiceType)
	}
	if firstInvoice.WarehouseLocationID == nil || *firstInvoice.WarehouseLocationID != locationA.ID {
		t.Fatalf("expected warehouse scope %d on first invoice, got %#v", locationA.ID, firstInvoice.WarehouseLocationID)
	}
	if firstInvoice.LineCount != 1 {
		t.Fatalf("expected 1 line on storage settlement invoice, got %d", firstInvoice.LineCount)
	}

	if _, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate storage settlement invoice to fail with ErrInvalidInput, got %v", err)
	}

	inputDifferentRange := input
	inputDifferentRange.PeriodEnd = "2026-04-30"
	if _, err := store.CreateBillingInvoice(ctx, inputDifferentRange, authPayload.User.ID); err != nil {
		t.Fatalf("create storage settlement invoice for different range: %v", err)
	}

	inputDifferentCustomer := input
	inputDifferentCustomer.CustomerID = customerB.ID
	inputDifferentCustomer.CustomerName = customerB.Name
	if _, err := store.CreateBillingInvoice(ctx, inputDifferentCustomer, authPayload.User.ID); err != nil {
		t.Fatalf("create storage settlement invoice for different customer: %v", err)
	}

	inputDifferentWarehouse := input
	inputDifferentWarehouse.WarehouseLocationID = int64Ptr(locationB.ID)
	inputDifferentWarehouse.WarehouseName = locationB.Name
	if _, err := store.CreateBillingInvoice(ctx, inputDifferentWarehouse, authPayload.User.ID); err != nil {
		t.Fatalf("create storage settlement invoice for different warehouse: %v", err)
	}

	voidedInvoice, err := store.VoidBillingInvoice(ctx, firstInvoice.ID)
	if err != nil {
		t.Fatalf("void first storage settlement invoice: %v", err)
	}
	if voidedInvoice.Status != BillingInvoiceStatusVoid {
		t.Fatalf("expected voided invoice status VOID, got %q", voidedInvoice.Status)
	}

	recreated, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID)
	if err != nil {
		t.Fatalf("recreate storage settlement invoice after void: %v", err)
	}
	if recreated.Status != BillingInvoiceStatusDraft {
		t.Fatalf("expected recreated invoice status DRAFT, got %q", recreated.Status)
	}
}

func TestUpdateLocationRenamesLiveSectionReferencesIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("RenameSection-%d", time.Now().UnixNano())

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 6, "B")

	updatedBlocks := make([]StorageLayoutBlock, len(location.LayoutBlocks))
	copy(updatedBlocks, location.LayoutBlocks)
	for index, block := range updatedBlocks {
		if block.Type == StorageLayoutBlockTypeSection && strings.EqualFold(block.Name, "B") {
			updatedBlocks[index].Name = "C"
		}
	}

	updatedLocation, err := store.UpdateLocation(ctx, location.ID, CreateLocationInput{
		Name:         location.Name,
		Address:      location.Address,
		Description:  location.Description,
		Capacity:     location.Capacity,
		SectionNames: []string{DefaultStorageSection, "C"},
		LayoutBlocks: updatedBlocks,
	})
	if err != nil {
		t.Fatalf("update location section rename: %v", err)
	}

	if !slices.Contains(updatedLocation.SectionNames, "C") {
		t.Fatalf("expected updated location sections to include C, got %#v", updatedLocation.SectionNames)
	}
	if slices.Contains(updatedLocation.SectionNames, "B") {
		t.Fatalf("expected updated location sections to exclude B, got %#v", updatedLocation.SectionNames)
	}

	renamedItem := mustFindItemByContainer(t, ctx, store, location.ID, "C", item.ContainerNo, item.SKU)
	if !strings.EqualFold(renamedItem.StorageSection, "C") {
		t.Fatalf("expected renamed item section C, got %q", renamedItem.StorageSection)
	}
	assertItemHiddenByContainer(t, ctx, store, location.ID, "B", item.ContainerNo, item.SKU)

	var palletCount int
	if err := store.db.GetContext(ctx, &palletCount, `
		SELECT COUNT(*)
		FROM pallets
		WHERE current_location_id = ?
		  AND COALESCE(NULLIF(current_storage_section, ''), ?) = ?
		  AND current_container_no = ?
	`, location.ID, DefaultStorageSection, "C", item.ContainerNo); err != nil {
		t.Fatalf("count renamed pallets by section: %v", err)
	}
	if palletCount == 0 {
		t.Fatalf("expected pallets to move into renamed section C")
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
		Capacity:     100,
		SectionNames: []string{DefaultStorageSection, "B"},
	})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}
	return location
}

func int64Ptr(value int64) *int64 {
	return &value
}

func mustCreateItem(t *testing.T, ctx context.Context, store *Store, customerID int64, locationID int64, sku string, quantity int) Item {
	t.Helper()
	return mustCreateItemWithSection(t, ctx, store, customerID, locationID, sku, quantity, DefaultStorageSection)
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

func adjustmentLineFromItem(item Item, adjustQty int, lineNote string) CreateInventoryAdjustmentLineInput {
	return CreateInventoryAdjustmentLineInput{
		CustomerID:     item.CustomerID,
		LocationID:     item.LocationID,
		StorageSection: item.StorageSection,
		ContainerNo:    item.ContainerNo,
		SKUMasterID:    item.SKUMasterID,
		AdjustQty:      adjustQty,
		LineNote:       lineNote,
	}
}

func transferLineFromItem(item Item, quantity int, toLocationID int64, toStorageSection string, lineNote string) CreateInventoryTransferLineInput {
	return CreateInventoryTransferLineInput{
		CustomerID:       item.CustomerID,
		LocationID:       item.LocationID,
		StorageSection:   item.StorageSection,
		ContainerNo:      item.ContainerNo,
		SKUMasterID:      item.SKUMasterID,
		Quantity:         quantity,
		ToLocationID:     toLocationID,
		ToStorageSection: toStorageSection,
		LineNote:         lineNote,
	}
}

func cycleCountLineFromItem(item Item, countedQty int, lineNote string) CreateCycleCountLineInput {
	return CreateCycleCountLineInput{
		CustomerID:     item.CustomerID,
		LocationID:     item.LocationID,
		StorageSection: item.StorageSection,
		ContainerNo:    item.ContainerNo,
		SKUMasterID:    item.SKUMasterID,
		CountedQty:     countedQty,
		LineNote:       lineNote,
	}
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
	item, err := store.getItem(ctx, itemID)
	if err != nil {
		t.Fatalf("get item %d: %v", itemID, err)
	}
	return item
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

func assertItemHiddenByContainer(t *testing.T, ctx context.Context, store *Store, locationID int64, section string, containerNo string, sku string) {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{LocationID: locationID})
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	for _, item := range items {
		if item.SKU == sku && item.LocationID == locationID && item.StorageSection == section && item.ContainerNo == containerNo {
			t.Fatalf("expected item %s at location %d section %s container %s to be hidden from inventory list", sku, locationID, section, containerNo)
		}
	}
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
