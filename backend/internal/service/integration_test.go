package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
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

	store, err := NewStore(db)
	if err != nil {
		t.Fatalf("initialize integration store: %v", err)
	}
	return store
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
		"billing_invoice_settings",
		"user_sessions",
		"billing_invoice_lines",
		"billing_invoices",
		"document_attachments",
		"delivery_events",
		"container_pickup_assignments",
		"container_tracking_events",
		"containers",
		"stock_ledger",
		"container_visits",
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

func TestListMovementsFiltersBySearchCustomerLocationTypeAndDate(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customerA := mustCreateCustomer(t, ctx, store, "MovementFilterCustomerA-"+suffix)
	customerB := mustCreateCustomer(t, ctx, store, "MovementFilterCustomerB-"+suffix)
	locationA := mustCreateLocation(t, ctx, store, "MovementFilterLocA-"+suffix)
	locationB := mustCreateLocation(t, ctx, store, "MovementFilterLocB-"+suffix)
	itemA := mustCreateItem(t, ctx, store, customerA.ID, locationA.ID, "MF-A-"+suffix, 0)
	itemB := mustCreateItem(t, ctx, store, customerB.ID, locationB.ID, "MF-B-"+suffix, 0)

	createReceipt := func(customer Customer, location Location, item Item, containerNo string, actualArrivalDate string) {
		t.Helper()
		_, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:          customer.ID,
			LocationID:          location.ID,
			ExpectedArrivalDate: actualArrivalDate,
			ActualArrivalDate:   actualArrivalDate,
			ContainerNo:         containerNo,
			StorageSection:      DefaultStorageSection,
			UnitLabel:           "CTN",
			Status:              DocumentStatusConfirmed,
			DocumentNote:        "Movement filter test",
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    8,
				ReceivedQty:    8,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			}},
		})
		if err != nil {
			t.Fatalf("create confirmed movement filter receipt: %v", err)
		}
	}

	containerA := "MF-A-CONT-" + suffix
	containerB := "MF-B-CONT-" + suffix
	createReceipt(customerA, locationA, itemA, containerA, "2026-04-04")
	createReceipt(customerB, locationB, itemB, containerB, "2026-04-20")

	searchFiltered, err := store.ListMovements(ctx, 50, MovementFilters{Search: containerA})
	if err != nil {
		t.Fatalf("list movements by search: %v", err)
	}
	assertMovementContainers(t, "search filter", searchFiltered, containerA)

	customerFiltered, err := store.ListMovements(ctx, 50, MovementFilters{CustomerID: customerA.ID})
	if err != nil {
		t.Fatalf("list movements by customer: %v", err)
	}
	assertMovementContainers(t, "customer filter", customerFiltered, containerA)

	locationFiltered, err := store.ListMovements(ctx, 50, MovementFilters{LocationID: locationB.ID})
	if err != nil {
		t.Fatalf("list movements by location: %v", err)
	}
	assertMovementContainers(t, "location filter", locationFiltered, containerB)

	typeFiltered, err := store.ListMovements(ctx, 50, MovementFilters{MovementType: "IN"})
	if err != nil {
		t.Fatalf("list movements by type: %v", err)
	}
	assertMovementContainers(t, "type filter", typeFiltered, containerA, containerB)

	dateFiltered, err := store.ListMovements(ctx, 50, MovementFilters{StartDate: "2026-04-10", EndDate: "2026-04-30"})
	if err != nil {
		t.Fatalf("list movements by date range: %v", err)
	}
	assertMovementContainers(t, "date filter", dateFiltered, containerB)

	combinedFiltered, err := store.ListMovements(ctx, 50, MovementFilters{
		Search:       "mf-a-cont",
		CustomerID:   customerA.ID,
		LocationID:   locationA.ID,
		MovementType: "in",
		StartDate:    "2026-04-01",
		EndDate:      "2026-04-10",
	})
	if err != nil {
		t.Fatalf("list movements by combined filters: %v", err)
	}
	assertMovementContainers(t, "combined filter", combinedFiltered, containerA)

	itemC := mustCreateItem(t, ctx, store, customerA.ID, locationA.ID, "MF-C-"+suffix, 5)
	adjustmentLine := adjustmentLineFromItem(itemC, 1, "Timezone boundary adjustment")
	_, err = store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode:       "COUNT_DIFF",
		ActualAdjustedAt: "2026-04-11T02:00:00Z",
		Lines:            []CreateInventoryAdjustmentLineInput{adjustmentLine},
	})
	if err != nil {
		t.Fatalf("create timezone boundary adjustment: %v", err)
	}

	timestampFiltered, err := store.ListMovements(ctx, 50, MovementFilters{
		MovementType: "ADJUST",
		StartDate:    "2026-04-10",
		EndDate:      "2026-04-10",
		StartAt:      "2026-04-10T04:00:00Z",
		EndBefore:    "2026-04-11T04:00:00Z",
	})
	if err != nil {
		t.Fatalf("list timestamp movements by local day bounds: %v", err)
	}
	assertMovementContainers(t, "timestamp local day filter", timestampFiltered, itemC.ContainerNo)
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

	var ledgerDeliveryDate sql.NullTime
	var ledgerOccurredAt sql.NullTime
	if err := store.db.QueryRowContext(ctx, `
		SELECT delivery_date, occurred_at
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		ORDER BY id ASC
		LIMIT 1
	`, inbound.ID).Scan(&ledgerDeliveryDate, &ledgerOccurredAt); err != nil {
		t.Fatalf("load inbound ledger arrival date: %v", err)
	}
	if !ledgerDeliveryDate.Valid || ledgerDeliveryDate.Time.Format("2006-01-02") != "2025-12-18" {
		t.Fatalf("expected inbound ledger delivery_date to use actual arrival date, got %v", ledgerDeliveryDate.Time)
	}
	if !ledgerOccurredAt.Valid || ledgerOccurredAt.Time.Format("2006-01-02") != "2025-12-18" {
		t.Fatalf("expected inbound ledger occurred_at to use actual arrival date, got %v", ledgerOccurredAt.Time)
	}

	itemAfterInbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "ARCONT-"+suffix, item.SKU)
	if itemAfterInbound.LastRestockedAt == nil {
		t.Fatalf("expected lastRestockedAt to be set")
	}
	if itemAfterInbound.LastRestockedAt.Before(beforeConfirm.Add(-2*time.Second)) || itemAfterInbound.LastRestockedAt.After(afterConfirm.Add(2*time.Second)) {
		t.Fatalf("expected lastRestockedAt to reflect real confirmation time, got %v", itemAfterInbound.LastRestockedAt)
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

	var outboundLedgerCount int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = 'OUTBOUND'
		  AND source_document_id = ?
		  AND source_line_id = ?
		  AND event_type = 'SHIP'
	`, outbound.ID, outbound.Lines[0].ID).Scan(&outboundLedgerCount); err != nil {
		t.Fatalf("count outbound stock ledger entries: %v", err)
	}
	if outboundLedgerCount == 0 {
		t.Fatal("expected outbound stock ledger entries for seed inventory outbound")
	}
}

func TestOutboundDocumentRequiresPositivePalletCountIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	_, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PLT-ZERO-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-04-02",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusConfirmed,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			Pallets:     0,
			UnitLabel:   "CTN",
		}},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for zero outbound pallets, got %v", err)
	}
}

func TestInventoryAdjustmentUsesAggregateBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)
	adjustmentLine := adjustmentLineFromItem(item, -2, "reduce two units")

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Notes:      "Use aggregate quantity",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
		},
	})
	if err != nil {
		t.Fatalf("create inventory adjustment with aggregate quantity: %v", err)
	}
	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 adjustment line, got %d", len(adjustment.Lines))
	}
	if adjustment.Lines[0].BeforeQty != 10 {
		t.Fatalf("expected aggregate before qty 10, got %d", adjustment.Lines[0].BeforeQty)
	}
	if adjustment.Lines[0].AfterQty != 8 {
		t.Fatalf("expected aggregate after qty 8, got %d", adjustment.Lines[0].AfterQty)
	}

	itemAfterAdjustment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterAdjustment.Quantity != 8 {
		t.Fatalf("expected aggregate on-hand 8 after adjustment, got %d", itemAfterAdjustment.Quantity)
	}
}

func TestInventoryAdjustmentAllowsAggregateAdjustmentWithoutPalletIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AdjustmentAggregateCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AdjustmentAggregateLocation-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ADJ-AGG-"+suffix, 10, DefaultStorageSection)

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLineFromItem(item, -2, "aggregate adjustment"),
		},
	})
	if err != nil {
		t.Fatalf("create aggregate adjustment without pallet: %v", err)
	}
	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 aggregate adjustment line, got %d", len(adjustment.Lines))
	}

	itemAfterAdjustment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterAdjustment.Quantity != 8 {
		t.Fatalf("expected aggregate on-hand 8 after adjustment, got %d", itemAfterAdjustment.Quantity)
	}
}

func TestInventoryAdjustmentCanIncreaseAggregateInventoryIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AdjustmentPositiveCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AdjustmentPositiveLocation-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ADJ-POS-"+suffix, 10, DefaultStorageSection)
	adjustmentLine := adjustmentLineFromItem(item, 3, "increase aggregate inventory")

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
		},
	})
	if err != nil {
		t.Fatalf("create positive aggregate adjustment: %v", err)
	}

	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 positive aggregate adjustment line, got %d", len(adjustment.Lines))
	}
	if adjustment.Lines[0].BeforeQty != 10 || adjustment.Lines[0].AfterQty != 13 {
		t.Fatalf("expected before/after qty 10->13, got %+v", adjustment.Lines[0])
	}

	itemAfterAdjustment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterAdjustment.Quantity != 13 {
		t.Fatalf("expected aggregate on-hand 13 after positive adjustment, got %d", itemAfterAdjustment.Quantity)
	}

	var ledgerQty int
	if err := store.db.GetContext(ctx, &ledgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
		  AND event_type = 'ADJUST'
	`, adjustment.ID); err != nil {
		t.Fatalf("load positive adjustment ledger quantity: %v", err)
	}
	if ledgerQty != 3 {
		t.Fatalf("expected positive adjustment ledger quantity 3, got %d", ledgerQty)
	}
}

func TestInventoryTransferUsesAggregateBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	fromLocation := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	toLocation := mustCreateLocation(t, ctx, store, "LA-"+suffix)
	item, err := store.CreateItem(ctx, CreateItemInput{
		SKU:            "SKU-" + suffix,
		Description:    "Direct transfer item " + suffix,
		Quantity:       10,
		Pallets:        2,
		CustomerID:     customer.ID,
		LocationID:     fromLocation.ID,
		StorageSection: DefaultStorageSection,
		ContainerNo:    "CONT-DIRECT-" + suffix,
		Unit:           "pcs",
	})
	if err != nil {
		t.Fatalf("create direct transfer item: %v", err)
	}

	transferLine := transferLineFromItem(item, 4, toLocation.ID, "A-01", "Move four units")
	transferLine.Pallets = 1
	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		Notes: "Transfer with direct inventory quantity",
		Lines: []CreateInventoryTransferLineInput{transferLine},
	})
	if err != nil {
		t.Fatalf("create transfer with aggregate quantity: %v", err)
	}
	if len(transfer.Lines) != 1 {
		t.Fatalf("expected 1 transfer line, got %d", len(transfer.Lines))
	}
	if transfer.Lines[0].Pallets != 1 {
		t.Fatalf("expected transfer line pallets 1, got %d", transfer.Lines[0].Pallets)
	}

	sourceAfterTransfer := mustFindItemByID(t, ctx, store, item.ID)
	if sourceAfterTransfer.Quantity != 6 {
		t.Fatalf("expected source direct on-hand 6 after transfer, got %d", sourceAfterTransfer.Quantity)
	}
	if sourceAfterTransfer.Pallets != 1 {
		t.Fatalf("expected source direct pallets 1 after transfer, got %d", sourceAfterTransfer.Pallets)
	}

	destinationAfterTransfer := mustFindItemByLocationAndSection(t, ctx, store, toLocation.ID, "A-01", item.SKU)
	if destinationAfterTransfer.Quantity != 4 {
		t.Fatalf("expected destination direct on-hand 4 after transfer, got %d", destinationAfterTransfer.Quantity)
	}
	if destinationAfterTransfer.Pallets != 1 {
		t.Fatalf("expected destination direct pallets 1 after transfer, got %d", destinationAfterTransfer.Pallets)
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

func TestInboundDocumentIgnoresForeignContainerIDIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customerA := mustCreateCustomer(t, ctx, store, "ForeignContainerCustomerA-"+suffix)
	customerB := mustCreateCustomer(t, ctx, store, "ForeignContainerCustomerB-"+suffix)
	location := mustCreateLocation(t, ctx, store, "ForeignContainerLoc-"+suffix)
	itemA := mustCreateItem(t, ctx, store, customerA.ID, location.ID, "FOREIGN-CONTAINER-A-"+suffix, 0)
	itemB := mustCreateItem(t, ctx, store, customerB.ID, location.ID, "FOREIGN-CONTAINER-B-"+suffix, 0)

	foreignInbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customerA.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-01",
		ContainerNo:         "FOREIGN-ID-A-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            itemA.SKU,
			Description:    itemA.Description,
			ExpectedQty:    1,
			ReceivedQty:    1,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create foreign inbound document: %v", err)
	}
	if foreignInbound.ContainerID <= 0 {
		t.Fatalf("expected foreign inbound to create a container id, got %d", foreignInbound.ContainerID)
	}

	ownInbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customerB.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerID:         foreignInbound.ContainerID,
		ContainerNo:         "FOREIGN-ID-B-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            itemB.SKU,
			Description:    itemB.Description,
			ExpectedQty:    5,
			ReceivedQty:    5,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound document with foreign container id: %v", err)
	}
	if ownInbound.ContainerID == foreignInbound.ContainerID {
		t.Fatalf("expected inbound to ignore foreign container id %d", foreignInbound.ContainerID)
	}

	var ownerID int64
	if err := store.db.GetContext(ctx, &ownerID, `SELECT customer_id FROM containers WHERE id = ?`, ownInbound.ContainerID); err != nil {
		t.Fatalf("load owner for new inbound container: %v", err)
	}
	if ownerID != customerB.ID {
		t.Fatalf("expected new container owner %d, got %d", customerB.ID, ownerID)
	}

	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, ownInbound.ContainerNo, itemB.SKU)
	if receivedItem.ContainerID != ownInbound.ContainerID {
		t.Fatalf("expected received inventory to use container id %d, got %d", ownInbound.ContainerID, receivedItem.ContainerID)
	}
}

func TestConfirmedInboundRecordsAggregateInventoryOnly(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AggregateInboundCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AggregateInboundLoc-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "AGG-IN-SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerNo:         "AGG-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Aggregate inbound only",
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

	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "AGG-IN-"+suffix, item.SKU)
	if receivedItem.Quantity != 11 {
		t.Fatalf("expected aggregate quantity 11 after inbound, got %d", receivedItem.Quantity)
	}
	if receivedItem.Pallets != 3 {
		t.Fatalf("expected aggregate pallet count 3 after inbound, got %d", receivedItem.Pallets)
	}
	if receivedItem.ContainerID != receipt.ContainerID {
		t.Fatalf("expected inventory to use container id %d, got %d", receipt.ContainerID, receivedItem.ContainerID)
	}

	var ledgerCount, ledgerQty, ledgerPallets int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(quantity_change), 0), COALESCE(SUM(pallets), 0)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		  AND event_type = 'RECEIVE'
	`, receipt.ID).Scan(&ledgerCount, &ledgerQty, &ledgerPallets); err != nil {
		t.Fatalf("load inbound aggregate ledger: %v", err)
	}
	if ledgerCount != 1 || ledgerQty != 11 || ledgerPallets != 3 {
		t.Fatalf("expected one inbound ledger row with qty/pallets 11/3, got count=%d qty=%d pallets=%d", ledgerCount, ledgerQty, ledgerPallets)
	}
}

func TestAggregateInventoryDocumentLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AggregateLifecycleCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AggregateLifecycleLoc-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "AGG-LIFE-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-02",
		ContainerNo:         "AGG-LIFE-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Aggregate inbound",
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
	if inboundLedgerCount != 1 {
		t.Fatalf("expected 1 inbound stock ledger row, got %d", inboundLedgerCount)
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

	inboundItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "AGG-LIFE-CONT-"+suffix, item.SKU)
	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "AGG-LIFE-PL-" + suffix,
		OrderRef:         "AGG-LIFE-SO-" + suffix,
		ExpectedShipDate: "2026-04-03",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "456 Dock Rd",
		ShipToContact:    "Gate 2",
		CarrierName:      "UPS",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Aggregate outbound",
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

	inboundItemAfterOutbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "AGG-LIFE-CONT-"+suffix, item.SKU)
	if inboundItemAfterOutbound.Quantity != 7 {
		t.Fatalf("expected inventory item quantity 7 after outbound, got %d", inboundItemAfterOutbound.Quantity)
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

	inboundItemAfterCancel := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "AGG-LIFE-CONT-"+suffix, item.SKU)
	if inboundItemAfterCancel.Quantity != 12 {
		t.Fatalf("expected inventory item quantity 12 after outbound reversal, got %d", inboundItemAfterCancel.Quantity)
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

func TestInboundDocumentRecordsExplicitBreakdownAsLineMetadataIntegration(t *testing.T) {
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

	if len(inbound.Lines) != 1 {
		t.Fatalf("expected one inbound line, got %d", len(inbound.Lines))
	}
	expectedBreakdown := []InboundPalletBreakdown{{Quantity: 120}, {Quantity: 95}, {Quantity: 80}}
	if !reflect.DeepEqual(inbound.Lines[0].PalletBreakdown, expectedBreakdown) {
		t.Fatalf("expected line pallet breakdown %v, got %v", expectedBreakdown, inbound.Lines[0].PalletBreakdown)
	}
	if inbound.Lines[0].Pallets != 3 || inbound.Lines[0].PalletsDetailCtns != "120+95+80" {
		t.Fatalf("expected line pallet metadata 3 / 120+95+80, got pallets=%d detail=%q", inbound.Lines[0].Pallets, inbound.Lines[0].PalletsDetailCtns)
	}

	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "BREAK-CONT-"+suffix, item.SKU)
	if receivedItem.Quantity != 295 || receivedItem.Pallets != 3 {
		t.Fatalf("expected aggregate inventory qty/pallets 295/3, got %d/%d", receivedItem.Quantity, receivedItem.Pallets)
	}

	var ledgerQty, ledgerPallets int
	var ledgerDetail sql.NullString
	if err := store.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(quantity_change), 0), COALESCE(SUM(pallets), 0), MAX(pallets_detail_ctns)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND'
		  AND source_document_id = ?
		  AND event_type = 'RECEIVE'
	`, inbound.ID).Scan(&ledgerQty, &ledgerPallets, &ledgerDetail); err != nil {
		t.Fatalf("load inbound breakdown ledger: %v", err)
	}
	if ledgerQty != 295 || ledgerPallets != 3 || !ledgerDetail.Valid || ledgerDetail.String != "120+95+80" {
		t.Fatalf("expected ledger qty/pallets/detail 295/3/120+95+80, got %d/%d/%q", ledgerQty, ledgerPallets, ledgerDetail.String)
	}
}

func TestAggregateOperationalLedgerIntegration(t *testing.T) {
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
	adjustmentLine := adjustmentLineFromItem(sourceItem, -2, "Broken cartons")

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo: "ADJ-" + suffix,
		ReasonCode:   "DAMAGE",
		Notes:        "Reduce aggregate stock",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
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

	sourceItemAfterAdjustment := mustFindItemByID(t, ctx, store, sourceItem.ID)
	if sourceItemAfterAdjustment.Quantity != 10 {
		t.Fatalf("expected source aggregate quantity 10 after adjustment, got %d", sourceItemAfterAdjustment.Quantity)
	}

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TR-" + suffix,
		Notes:      "Move aggregate stock west",
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(sourceItem, 4, destinationLocation.ID, "B", "Re-slot pallets"),
		},
	})
	if err != nil {
		t.Fatalf("create aggregate transfer: %v", err)
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
	if destinationItem.Quantity != 4 {
		t.Fatalf("expected destination aggregate quantity 4 after transfer, got %d", destinationItem.Quantity)
	}
}

func TestAggregateInventoryActionsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AggregateActionsCustomer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "AggregateActionsSource-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "AggregateActionsDestination-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, sourceLocation.ID, "AGG-ACTION-SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         "AGG-ACTION-CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Aggregate inventory actions",
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
		t.Fatalf("create aggregate actions inbound: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)
	adjustmentQty := 4
	adjustmentLine := adjustmentLineFromItem(sourceItem, -adjustmentQty, "Aggregate adjustment")
	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo: "ADJ-AGG-" + suffix,
		ReasonCode:   "DAMAGE",
		Notes:        "Adjust aggregate stock",
		Lines:        []CreateInventoryAdjustmentLineInput{adjustmentLine},
	})
	if err != nil {
		t.Fatalf("create aggregate adjustment: %v", err)
	}
	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 aggregate adjustment line, got %d", len(adjustment.Lines))
	}
	if adjustment.Lines[0].BeforeQty != 12 || adjustment.Lines[0].AfterQty != 8 {
		t.Fatalf("expected aggregate adjustment qty 12->8, got %d->%d", adjustment.Lines[0].BeforeQty, adjustment.Lines[0].AfterQty)
	}

	var adjustmentLedgerQty int
	if err := store.db.GetContext(ctx, &adjustmentLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
		  AND event_type = 'ADJUST'
	`, adjustment.ID); err != nil {
		t.Fatalf("sum aggregate adjustment ledger quantities: %v", err)
	}
	if adjustmentLedgerQty != -adjustmentQty {
		t.Fatalf("expected aggregate adjustment quantity -%d, got %d", adjustmentQty, adjustmentLedgerQty)
	}

	sourceItemAfterAdjustment := mustFindItemByID(t, ctx, store, sourceItem.ID)
	if sourceItemAfterAdjustment.Quantity != 8 {
		t.Fatalf("expected source aggregate quantity 8 after adjustment, got %d", sourceItemAfterAdjustment.Quantity)
	}

	transferQty := 5
	transferLine := transferLineFromItem(sourceItemAfterAdjustment, transferQty, destinationLocation.ID, "B", "Aggregate transfer")
	transferLine.Pallets = 1
	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TR-AGG-" + suffix,
		Notes:      "Transfer aggregate stock",
		Lines:      []CreateInventoryTransferLineInput{transferLine},
	})
	if err != nil {
		t.Fatalf("create aggregate transfer: %v", err)
	}

	var transferOutLedgerQty int
	if err := store.db.GetContext(ctx, &transferOutLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'TRANSFER'
		  AND source_document_id = ?
		  AND event_type = 'TRANSFER_OUT'
	`, transfer.ID); err != nil {
		t.Fatalf("sum aggregate transfer-out ledger quantities: %v", err)
	}
	if transferOutLedgerQty != -transferQty {
		t.Fatalf("expected aggregate transfer-out quantity -%d, got %d", transferQty, transferOutLedgerQty)
	}

	sourceItemAfterTransfer := mustFindItemByID(t, ctx, store, sourceItem.ID)
	if sourceItemAfterTransfer.Quantity != 3 {
		t.Fatalf("expected source aggregate quantity 3 after transfer, got %d", sourceItemAfterTransfer.Quantity)
	}
	destinationItem := mustFindItemByLocationAndSection(t, ctx, store, destinationLocation.ID, "B", sourceItem.SKU)
	if destinationItem.Quantity != transferQty {
		t.Fatalf("expected destination quantity %d after aggregate transfer, got %d", transferQty, destinationItem.Quantity)
	}
}

func TestConfirmedOutboundUsesAggregateInventoryWithoutPalletEntitiesIntegration(t *testing.T) {
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
	selectedQty := 7

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "MANUAL-PICK-PL-" + suffix,
		OrderRef:         "MANUAL-PICK-SO-" + suffix,
		ExpectedShipDate: "2026-04-11",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Manual selected pallet should be ignored on confirm",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  sourceItem.CustomerID,
			LocationID:  sourceItem.LocationID,
			SKUMasterID: sourceItem.SKUMasterID,
			Quantity:    selectedQty,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft with manual selected pallet: %v", err)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm outbound draft with manual selected pallet: %v", err)
	}

	var outboundLedgerQty int
	if err := store.db.GetContext(ctx, &outboundLedgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'OUTBOUND'
		  AND source_document_id = ?
		  AND event_type = 'SHIP'
	`, outbound.ID); err != nil {
		t.Fatalf("sum outbound stock ledger quantity: %v", err)
	}
	if outboundLedgerQty != -selectedQty {
		t.Fatalf("expected outbound stock ledger quantity %d, got %d", -selectedQty, outboundLedgerQty)
	}

	sourceItemAfterOutbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)
	if sourceItemAfterOutbound.Quantity != 5 {
		t.Fatalf("expected aggregate inventory quantity 5 after outbound, got %d", sourceItemAfterOutbound.Quantity)
	}

}

func TestDraftOutboundReloadPreservesSharedContainerManualPickAllocationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "DraftManualPickCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "DraftManualPickLocation-"+suffix)
	itemA := mustCreateItem(t, ctx, store, customer.ID, location.ID, "DRAFT-MANUAL-SKU-A-"+suffix, 0)
	itemB := mustCreateItem(t, ctx, store, customer.ID, location.ID, "DRAFT-MANUAL-SKU-B-"+suffix, 0)
	containerNo := "DRAFT-MANUAL-CONT-" + suffix

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Seed inbound for shared-container manual pick draft",
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
	})
	if err != nil {
		t.Fatalf("create inbound for shared-container manual pick draft: %v", err)
	}

	sourceItemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, itemA.SKU)
	sourceItemB := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, itemB.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "DRAFT-MANUAL-PL-" + suffix,
		OrderRef:         "DRAFT-MANUAL-SO-" + suffix,
		ExpectedShipDate: "2026-04-11",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Shared-container manual picks should survive draft reload",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:  sourceItemA.CustomerID,
				LocationID:  sourceItemA.LocationID,
				SKUMasterID: sourceItemA.SKUMasterID,
				Quantity:    sourceItemA.Quantity,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
			{
				CustomerID:  sourceItemB.CustomerID,
				LocationID:  sourceItemB.LocationID,
				SKUMasterID: sourceItemB.SKUMasterID,
				Quantity:    sourceItemB.Quantity,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
		},
	})
	if err != nil {
		t.Fatalf("create outbound draft with shared-container manual picks: %v", err)
	}

	reloaded, err := store.getOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("reload outbound draft with shared-container manual picks: %v", err)
	}

	assertSharedContainerAllocations := func(doc OutboundDocument) {
		t.Helper()
		if len(doc.Lines) != 2 {
			t.Fatalf("expected 2 outbound lines, got %d", len(doc.Lines))
		}
		for _, line := range doc.Lines {
			if len(line.PickAllocations) != 1 {
				t.Fatalf("expected one pick allocation for line %d, got %+v", line.ID, line.PickAllocations)
			}
			if line.PickAllocations[0].ContainerNo != containerNo {
				t.Fatalf("expected shared container %s for line %d, got %+v", containerNo, line.ID, line.PickAllocations[0])
			}
		}
	}

	assertSharedContainerAllocations(outbound)
	assertSharedContainerAllocations(reloaded)
}

func TestDraftOutboundReloadWithoutStoredPickAllocationsDoesNotRehydrateFromCurrentPalletsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "DraftNoFallbackCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "DraftNoFallbackLocation-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "DRAFT-NO-FALLBACK-SKU-"+suffix, 0)
	containerNo := "DRAFT-NO-FALLBACK-CONT-" + suffix

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Seed inbound for legacy draft pick allocation fallback removal",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			},
		},
	})
	if err != nil {
		t.Fatalf("create inbound for draft no-fallback reload: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "DRAFT-NO-FALLBACK-PL-" + suffix,
		OrderRef:         "DRAFT-NO-FALLBACK-SO-" + suffix,
		ExpectedShipDate: "2026-04-11",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Legacy drafts without stored pick allocations should not be rehydrated",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:  sourceItem.CustomerID,
				LocationID:  sourceItem.LocationID,
				SKUMasterID: sourceItem.SKUMasterID,
				Quantity:    sourceItem.Quantity,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
		},
	})
	if err != nil {
		t.Fatalf("create outbound draft with selected pallet: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected one stored draft pick allocation before manual clearing, got %+v", outbound.Lines)
	}

	if _, err := store.db.ExecContext(ctx, `
		UPDATE outbound_document_lines
		SET pick_allocations_json = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE document_id = ?
	`, outbound.ID); err != nil {
		t.Fatalf("clear stored draft pick allocations: %v", err)
	}

	reloaded, err := store.getOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("reload outbound draft without stored pick allocations: %v", err)
	}

	if len(reloaded.Lines) != 1 {
		t.Fatalf("expected 1 outbound line after reload, got %d", len(reloaded.Lines))
	}
	if len(reloaded.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected no pick allocations to be synthesized from current pallet state, got %+v", reloaded.Lines[0].PickAllocations)
	}
}

func TestDraftOutboundPickAllocationsPersistAndConfirmAgainstStoredContainerPlanIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "DraftPlanCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "DraftPlanLocation-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "DRAFT-PLAN-SKU-"+suffix, 0)

	seedInbound := func(containerNo string, expectedDate string) {
		t.Helper()
		if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:          customer.ID,
			LocationID:          location.ID,
			ExpectedArrivalDate: expectedDate,
			ContainerNo:         containerNo,
			StorageSection:      DefaultStorageSection,
			Status:              DocumentStatusConfirmed,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			}},
		}); err != nil {
			t.Fatalf("create inbound %s: %v", containerNo, err)
		}
	}

	containerA := "DRAFT-PLAN-A-" + suffix
	containerB := "DRAFT-PLAN-B-" + suffix
	seedInbound(containerA, "2026-04-10")
	seedInbound(containerB, "2026-04-11")

	sourceItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerA, item.SKU)
	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "DRAFT-PLAN-PL-" + suffix,
		OrderRef:         "DRAFT-PLAN-SO-" + suffix,
		ExpectedShipDate: "2026-04-12",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Stored draft container plan should drive confirm",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  sourceItem.CustomerID,
			LocationID:  sourceItem.LocationID,
			SKUMasterID: sourceItem.SKUMasterID,
			Quantity:    5,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{
				{
					ItemNumber:     item.ItemNumber,
					LocationID:     location.ID,
					LocationName:   location.Name,
					StorageSection: DefaultStorageSection,
					ContainerNo:    containerB,
					AllocatedQty:   5,
				},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft with stored pick allocations: %v", err)
	}

	if outbound.TrackingStatus != OutboundTrackingPicking {
		t.Fatalf("expected draft outbound tracking status %q, got %q", OutboundTrackingPicking, outbound.TrackingStatus)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected one persisted draft pick allocation, got %+v", outbound.Lines)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo != containerB {
		t.Fatalf("expected persisted draft pick allocation container %s, got %+v", containerB, outbound.Lines[0].PickAllocations[0])
	}
	if outbound.Lines[0].PickAllocations[0].Pallets != 1 {
		t.Fatalf("expected persisted draft pallet count 1, got %+v", outbound.Lines[0].PickAllocations[0])
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm outbound draft with stored pick allocations: %v", err)
	}

	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected one confirmed pick allocation, got %+v", outbound.Lines)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo != containerB {
		t.Fatalf("expected confirmed pick allocation container %s, got %+v", containerB, outbound.Lines[0].PickAllocations[0])
	}

	remainingInContainerA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerA, item.SKU)
	if remainingInContainerA.Quantity != 5 {
		t.Fatalf("expected container %s to remain untouched with 5 units, got %d", containerA, remainingInContainerA.Quantity)
	}

	var remainingInContainerB int
	if err := store.db.GetContext(ctx, &remainingInContainerB, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM inventory_items
		WHERE sku_master_id = ?
		  AND customer_id = ?
		  AND location_id = ?
		  AND COALESCE(storage_section, 'TEMP') = ?
		  AND COALESCE(container_no, '') = ?
	`, item.SKUMasterID, customer.ID, location.ID, DefaultStorageSection, containerB); err != nil {
		t.Fatalf("load remaining quantity in stored-plan container: %v", err)
	}
	if remainingInContainerB != 0 {
		t.Fatalf("expected container %s to be fully shipped, got %d", containerB, remainingInContainerB)
	}
}

func TestConfirmedOutboundReloadUsesLedgerContainerSnapshotsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "LedgerSnapshotCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "LedgerSnapshotLocation-"+suffix)
	itemA := mustCreateItem(t, ctx, store, customer.ID, location.ID, "LEDGER-SKU-A-"+suffix, 0)
	itemB := mustCreateItem(t, ctx, store, customer.ID, location.ID, "LEDGER-SKU-B-"+suffix, 0)
	containerNo := "LEDGER-CONT-" + suffix

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Seed inbound for outbound ledger snapshot reload",
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
	})
	if err != nil {
		t.Fatalf("create inbound for outbound ledger snapshot reload: %v", err)
	}

	sourceItemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, itemA.SKU)
	sourceItemB := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, itemB.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "LEDGER-PL-" + suffix,
		OrderRef:         "LEDGER-SO-" + suffix,
		ExpectedShipDate: "2026-04-11",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Confirmed outbound should retain original container snapshots",
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
		t.Fatalf("create confirmed outbound for ledger snapshot reload: %v", err)
	}

	if _, err := store.db.ExecContext(ctx, `
		UPDATE inventory_items
		SET container_no = ?
		WHERE container_id = ?
	`, "MOVED-"+suffix, inbound.ContainerID); err != nil {
		t.Fatalf("mutate current inventory containers after outbound confirmation: %v", err)
	}

	reloaded, err := store.getOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("reload confirmed outbound after pallet container mutation: %v", err)
	}
	if len(reloaded.Lines) != 2 {
		t.Fatalf("expected 2 confirmed outbound lines, got %d", len(reloaded.Lines))
	}
	for _, line := range reloaded.Lines {
		if len(line.PickAllocations) != 1 {
			t.Fatalf("expected one confirmed allocation for line %d, got %+v", line.ID, line.PickAllocations)
		}
		if line.PickAllocations[0].ContainerNo != containerNo {
			t.Fatalf("expected ledger snapshot container %s for line %d, got %+v", containerNo, line.ID, line.PickAllocations[0])
		}
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
	adjustmentLine := adjustmentLineFromItem(sourceItem, -2, "actual-time adjustment")
	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo:     "ADJ-ACT-" + suffix,
		ReasonCode:       "CORRECTION",
		ActualAdjustedAt: adjustmentActual,
		Notes:            "Backfilled adjustment time",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
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

func TestCancelDocumentsSoftDeletesAttachmentsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AttachmentCancelCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AttachmentCancelLoc-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ATTACH-CANCEL-"+suffix, 10, DefaultStorageSection)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-26",
		ContainerNo:         "ATTACH-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    3,
			ReceivedQty:    3,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound document: %v", err)
	}
	inboundAttachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentInbound,
		DocumentID:       inbound.ID,
		DisplayName:      "Inbound attachment",
		OriginalFileName: "inbound.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/inbound/test.pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create inbound attachment: %v", err)
	}
	if _, err := store.CancelInboundDocument(ctx, inbound.ID); err != nil {
		t.Fatalf("cancel inbound document: %v", err)
	}
	assertDocumentAttachmentSoftDeleted(t, ctx, store, inboundAttachment.ID, DocumentAttachmentInbound, inbound.ID)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "ATTACH-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-26",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "200 Export Rd",
		ShipToContact:    "Dock 8",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    2,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound document: %v", err)
	}
	outboundAttachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentOutbound,
		DocumentID:       outbound.ID,
		DisplayName:      "Outbound attachment",
		OriginalFileName: "outbound.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/outbound/test.pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create outbound attachment: %v", err)
	}
	if _, err := store.CancelOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	assertDocumentAttachmentSoftDeleted(t, ctx, store, outboundAttachment.ID, DocumentAttachmentOutbound, outbound.ID)
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
	itemAfterPicking := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterPicking.Quantity != 10 || itemAfterPicking.AllocatedQty != 4 || itemAfterPicking.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 10/4/6 after picking, got %d/%d/%d", itemAfterPicking.Quantity, itemAfterPicking.AllocatedQty, itemAfterPicking.AvailableQty)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPacked)
	if err != nil {
		t.Fatalf("mark outbound packed: %v", err)
	}
	if outbound.Status != DocumentStatusDraft || outbound.TrackingStatus != OutboundTrackingPacked {
		t.Fatalf("expected outbound draft/packed, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}
	itemAfterPacked := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterPacked.Quantity != 10 || itemAfterPacked.AllocatedQty != 4 || itemAfterPacked.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 10/4/6 after packed, got %d/%d/%d", itemAfterPacked.Quantity, itemAfterPacked.AllocatedQty, itemAfterPacked.AvailableQty)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingShipped)
	if err != nil {
		t.Fatalf("mark outbound shipped: %v", err)
	}
	if outbound.Status != DocumentStatusConfirmed || outbound.TrackingStatus != OutboundTrackingShipped {
		t.Fatalf("expected outbound confirmed/shipped, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}

	itemAfterShipment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterShipment.Quantity != 6 || itemAfterShipment.AllocatedQty != 0 || itemAfterShipment.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 6/0/6 after tracked outbound completion, got %d/%d/%d", itemAfterShipment.Quantity, itemAfterShipment.AllocatedQty, itemAfterShipment.AvailableQty)
	}
}

func TestOutboundPickingReservationConflictIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	firstOutbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "RESERVE-1-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create first outbound: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, firstOutbound.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("start picking first outbound: %v", err)
	}

	secondOutbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "RESERVE-2-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    7,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create second outbound: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, secondOutbound.ID, OutboundTrackingPicking); err == nil || !errors.Is(err, ErrReservedStock) {
		t.Fatalf("expected second outbound picking to fail with ErrReservedStock, got %v", err)
	}
}

func TestUpdateOutboundDocumentReplacesPickingReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "EDIT-RESERVE-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound for reservation replacement: %v", err)
	}
	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking)
	if err != nil {
		t.Fatalf("start picking outbound for reservation replacement: %v", err)
	}

	updatedOutbound, err := store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:  outbound.PackingListNo,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingPicking,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    5,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("update outbound while picking: %v", err)
	}
	if updatedOutbound.TrackingStatus != OutboundTrackingPicking {
		t.Fatalf("expected updated outbound to remain picking, got %q", updatedOutbound.TrackingStatus)
	}

	itemAfterUpdate := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterUpdate.Quantity != 10 || itemAfterUpdate.AllocatedQty != 5 || itemAfterUpdate.AvailableQty != 5 {
		t.Fatalf("expected on-hand/allocated/available 10/5/5 after reservation replacement, got %d/%d/%d", itemAfterUpdate.Quantity, itemAfterUpdate.AllocatedQty, itemAfterUpdate.AvailableQty)
	}
}

func TestCancelOutboundDocumentReleasesPickingReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "CANCEL-RESERVE-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound for cancellation: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("start picking outbound for cancellation: %v", err)
	}

	if _, err := store.CancelOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("cancel picking outbound: %v", err)
	}

	itemAfterCancel := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterCancel.Quantity != 10 || itemAfterCancel.AllocatedQty != 0 || itemAfterCancel.AvailableQty != 10 {
		t.Fatalf("expected on-hand/allocated/available 10/0/10 after cancellation, got %d/%d/%d", itemAfterCancel.Quantity, itemAfterCancel.AllocatedQty, itemAfterCancel.AvailableQty)
	}
}

func TestOutboundReservationsBlockOtherInventoryMutationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "CA-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, sourceLocation.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "BLOCK-RESERVE-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    8,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound for reservation conflict checks: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("start picking outbound for reservation conflict checks: %v", err)
	}

	adjustmentLine := adjustmentLineFromItem(item, -3, "adjust reserved stock")
	if _, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "COUNT_DIFF",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
		},
	}); err == nil || !errors.Is(err, ErrReservedStock) {
		t.Fatalf("expected adjustment to fail with ErrReservedStock, got %v", err)
	}

	if _, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(item, 3, destinationLocation.ID, DefaultStorageSection, "transfer reserved stock"),
		},
	}); err == nil || !errors.Is(err, ErrReservedStock) {
		t.Fatalf("expected transfer to fail with ErrReservedStock, got %v", err)
	}
}

func TestRepairOutboundDraftReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	firstOutbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "REPAIR-1-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create first outbound for repair: %v", err)
	}
	secondOutbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "REPAIR-2-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    7,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create second outbound for repair: %v", err)
	}

	if _, err := store.db.ExecContext(ctx, `UPDATE outbound_documents SET tracking_status = ? WHERE id IN (?, ?)`, OutboundTrackingPicking, firstOutbound.ID, secondOutbound.ID); err != nil {
		t.Fatalf("mark old outbound drafts as picking: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `
		UPDATE inventory_items
		SET allocated_qty = ?
		WHERE id = ?
	`, 4, item.ID); err != nil {
		t.Fatalf("seed stale bucket reservation: %v", err)
	}
	unrelatedItem, err := store.CreateItem(ctx, CreateItemInput{
		SKU:            "UNRELATED-" + suffix,
		Description:    "Unrelated allocated item " + suffix,
		Quantity:       5,
		Pallets:        1,
		AllocatedQty:   2,
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		StorageSection: DefaultStorageSection,
		ContainerNo:    "UNRELATED-" + suffix,
		Unit:           "CTN",
	})
	if err != nil {
		t.Fatalf("create unrelated allocated item: %v", err)
	}

	if err := store.repairOutboundDraftReservations(ctx); err != nil {
		t.Fatalf("repair outbound draft reservations: %v", err)
	}

	repairedFirst := mustGetOutboundDocument(t, ctx, store, firstOutbound.ID)
	if repairedFirst.TrackingStatus != OutboundTrackingPicking {
		t.Fatalf("expected first repaired outbound to remain picking, got %q", repairedFirst.TrackingStatus)
	}
	if len(repairedFirst.Lines[0].PickAllocations) != 1 || repairedFirst.Lines[0].PickAllocations[0].AllocatedQty != 4 {
		t.Fatalf("expected first repaired outbound to keep a bucket allocation for 4 units, got %+v", repairedFirst.Lines)
	}

	repairedSecond := mustGetOutboundDocument(t, ctx, store, secondOutbound.ID)
	if repairedSecond.TrackingStatus != OutboundTrackingScheduled {
		t.Fatalf("expected second repaired outbound to downgrade to scheduled, got %q", repairedSecond.TrackingStatus)
	}

	itemAfterRepair := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterRepair.Quantity != 10 || itemAfterRepair.AllocatedQty != 4 || itemAfterRepair.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 10/4/6 after repair, got %d/%d/%d", itemAfterRepair.Quantity, itemAfterRepair.AllocatedQty, itemAfterRepair.AvailableQty)
	}
	unrelatedAfterRepair := mustFindItemByID(t, ctx, store, unrelatedItem.ID)
	if unrelatedAfterRepair.AllocatedQty != 2 || unrelatedAfterRepair.AvailableQty != 3 {
		t.Fatalf("expected unrelated allocation to remain 2/3 allocated/available, got %d/%d", unrelatedAfterRepair.AllocatedQty, unrelatedAfterRepair.AvailableQty)
	}
}

func TestRepairOutboundDraftReservationsUsesContainerIDAfterRenameIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "RepairRenameCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "RepairRenameLoc-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "REPAIR-RENAME-SKU-"+suffix, 0)
	oldContainerNo := "REPAIR-RENAME-OLD-" + suffix
	newContainerNo := "REPAIR-RENAME-NEW-" + suffix

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-04-10",
		ContainerNo:         oldContainerNo,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound for renamed container repair: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, inbound.ContainerNo, item.SKU)
	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "REPAIR-RENAME-PL-" + suffix,
		OrderRef:         "REPAIR-RENAME-SO-" + suffix,
		ExpectedShipDate: "2026-04-11",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  sourceItem.CustomerID,
			LocationID:  sourceItem.LocationID,
			SKUMasterID: sourceItem.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{{
				ItemNumber:     sourceItem.ItemNumber,
				LocationID:     sourceItem.LocationID,
				LocationName:   sourceItem.LocationName,
				StorageSection: sourceItem.StorageSection,
				ContainerID:    sourceItem.ContainerID,
				ContainerNo:    sourceItem.ContainerNo,
				AllocatedQty:   4,
				Pallets:        1,
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft for renamed container repair: %v", err)
	}

	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("reserve outbound draft before container rename: %v", err)
	}

	if _, err := store.db.ExecContext(ctx, `UPDATE containers SET container_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, newContainerNo, sourceItem.ContainerID); err != nil {
		t.Fatalf("rename container record: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE inbound_documents SET container_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, newContainerNo, inbound.ID); err != nil {
		t.Fatalf("rename inbound document container snapshot: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE inventory_items SET container_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, newContainerNo, sourceItem.ID); err != nil {
		t.Fatalf("rename inventory container projection: %v", err)
	}

	if err := store.repairOutboundDraftReservations(ctx); err != nil {
		t.Fatalf("repair outbound draft reservations after container rename: %v", err)
	}

	repairedOutbound := mustGetOutboundDocument(t, ctx, store, outbound.ID)
	if len(repairedOutbound.Lines) != 1 || len(repairedOutbound.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected one repaired pick allocation, got %+v", repairedOutbound.Lines)
	}
	repairedAllocation := repairedOutbound.Lines[0].PickAllocations[0]
	if repairedAllocation.ContainerID != sourceItem.ContainerID {
		t.Fatalf("expected repaired allocation container id %d, got %d", sourceItem.ContainerID, repairedAllocation.ContainerID)
	}
	if repairedAllocation.ContainerNo != newContainerNo {
		t.Fatalf("expected repaired allocation container no %s, got %q", newContainerNo, repairedAllocation.ContainerNo)
	}
	if repairedAllocation.AllocatedQty != 4 {
		t.Fatalf("expected repaired allocation quantity 4, got %d", repairedAllocation.AllocatedQty)
	}

	repairedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, newContainerNo, item.SKU)
	if repairedItem.AllocatedQty != 4 || repairedItem.AvailableQty != 6 {
		t.Fatalf("expected renamed inventory allocated/available 4/6, got %d/%d", repairedItem.AllocatedQty, repairedItem.AvailableQty)
	}
	assertItemHiddenByContainer(t, ctx, store, location.ID, DefaultStorageSection, oldContainerNo, item.SKU)
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

func TestBillingInvoiceSettingsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()

	settings, err := store.GetBillingInvoiceSettings(ctx)
	if err != nil {
		t.Fatalf("get default billing invoice settings: %v", err)
	}
	if settings.Header.SellerName != "Speed Inventory Management" || settings.Header.Terms != "Net 30" || settings.Header.PaymentDueDays != 30 {
		t.Fatalf("expected default billing invoice settings, got %#v", settings.Header)
	}

	settings, err = store.UpdateBillingInvoiceSettings(ctx, UpdateBillingInvoiceSettingsInput{
		Header: BillingInvoiceHeader{
			SellerName:          "",
			Subtitle:            "",
			RemitTo:             "ACH Lockbox",
			Terms:               "",
			PaymentDueDays:      0,
			PaymentInstructions: "",
		},
	}, 42)
	if err != nil {
		t.Fatalf("update billing invoice settings: %v", err)
	}
	if settings.UpdatedByUserID != 42 {
		t.Fatalf("expected updated by user 42, got %d", settings.UpdatedByUserID)
	}
	if settings.Header.SellerName != "" || settings.Header.Subtitle != "" || settings.Header.RemitTo != "ACH Lockbox" || settings.Header.Terms != "" || settings.Header.PaymentDueDays != 0 || settings.Header.PaymentInstructions != "" {
		t.Fatalf("expected blank billing invoice settings to persist, got %#v", settings.Header)
	}

	loaded, err := store.GetBillingInvoiceSettings(ctx)
	if err != nil {
		t.Fatalf("reload billing invoice settings: %v", err)
	}
	if loaded.Header.RemitTo != "ACH Lockbox" || loaded.Header.PaymentDueDays != 0 {
		t.Fatalf("expected stored billing invoice settings, got %#v", loaded.Header)
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
	if outbound.Lines[0].PickAllocations[0].ContainerNo != "CONT-A-"+suffix || outbound.Lines[0].PickAllocations[0].AllocatedQty != 1 || outbound.Lines[0].PickAllocations[0].Pallets != 1 {
		t.Fatalf("expected confirmed first auto allocation CONT-A qty 1, got %+v", outbound.Lines[0].PickAllocations[0])
	}
	if outbound.Lines[0].PickAllocations[1].ContainerNo != "CONT-B-"+suffix || outbound.Lines[0].PickAllocations[1].AllocatedQty != 4 || outbound.Lines[0].PickAllocations[1].Pallets != 1 {
		t.Fatalf("expected confirmed second auto allocation CONT-B qty 4, got %+v", outbound.Lines[0].PickAllocations[1])
	}

	itemAfterConfirm := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterConfirm.Quantity != 0 {
		t.Fatalf("expected original seed row to stay empty in container allocation flow, got %d", itemAfterConfirm.Quantity)
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

func TestOutboundAutoContainerAllocationPreservesActualPalletCountsPerContainerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)

	seedInbound := func(containerNo string, receivedQty int, pallets int) {
		t.Helper()
		if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:          customer.ID,
			LocationID:          location.ID,
			ExpectedArrivalDate: "2026-03-23",
			ContainerNo:         containerNo,
			StorageSection:      DefaultStorageSection,
			Status:              DocumentStatusConfirmed,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    receivedQty,
				ReceivedQty:    receivedQty,
				Pallets:        pallets,
				StorageSection: DefaultStorageSection,
			}},
		}); err != nil {
			t.Fatalf("create inbound receipt %s: %v", containerNo, err)
		}
	}

	seedInbound("CONT-1-"+suffix, 10, 1)
	seedInbound("CONT-2-"+suffix, 20, 2)
	seedInbound("CONT-3-"+suffix, 30, 3)

	itemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-1-"+suffix, item.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-SPLIT-" + suffix,
		OrderRef:         "SO-SPLIT-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Actual pallet counts per container test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
				Quantity:     60,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create split-container outbound document: %v", err)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm split-container outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 3 {
		t.Fatalf("expected 3 confirmed split-container pick allocations, got %+v", outbound.Lines)
	}

	palletsByContainer := make(map[string]int, len(outbound.Lines[0].PickAllocations))
	for _, allocation := range outbound.Lines[0].PickAllocations {
		palletsByContainer[allocation.ContainerNo] = allocation.Pallets
	}

	if palletsByContainer["CONT-1-"+suffix] != 1 {
		t.Fatalf("expected CONT-1 pallet count 1, got %d", palletsByContainer["CONT-1-"+suffix])
	}
	if palletsByContainer["CONT-2-"+suffix] != 2 {
		t.Fatalf("expected CONT-2 pallet count 2, got %d", palletsByContainer["CONT-2-"+suffix])
	}
	if palletsByContainer["CONT-3-"+suffix] != 3 {
		t.Fatalf("expected CONT-3 pallet count 3, got %d", palletsByContainer["CONT-3-"+suffix])
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
		t.Fatalf("expected aggregate transfer activity feed entries, got %+v", movements)
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

	portalCustomer := mustCreateCustomer(t, ctx, store, "PortalUserCustomer-"+suffix)
	portalUser, err := store.CreateManagedUser(ctx, CreateManagedUserInput{
		Email:      "portal-" + suffix + "@example.com",
		FullName:   "Portal " + suffix,
		Password:   "password123",
		Role:       RoleCustomer,
		IsActive:   true,
		CustomerID: portalCustomer.ID,
	})
	if err != nil {
		t.Fatalf("create portal user: %v", err)
	}

	if err := store.DeleteCustomer(ctx, portalCustomer.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleting customer with portal users to fail with ErrInvalidInput, got %v", err)
	}

	if _, err := store.UpdateUserAccess(ctx, authPayload.User.ID, portalUser.ID, UpdateUserAccessInput{
		Role:     RoleViewer,
		IsActive: true,
	}); err != nil {
		t.Fatalf("unbind portal user from customer: %v", err)
	}

	if err := store.DeleteCustomer(ctx, portalCustomer.ID); err != nil {
		t.Fatalf("delete customer after unbinding portal user: %v", err)
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

func TestBillingInvoiceDraftEditsRecalculateTotalsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-draft-" + suffix + "@example.com",
		FullName: "Billing Draft " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing draft user: %v", err)
	}

	customer := mustCreateCustomer(t, ctx, store, "Billing Draft Customer "+suffix)
	input := CreateBillingInvoiceInput{
		InvoiceType:  BillingInvoiceTypeMixed,
		CustomerID:   customer.ID,
		CustomerName: customer.Name,
		PeriodStart:  "2026-03-01",
		PeriodEnd:    "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:     450,
			WrappingFeePerPallet:    15,
			StorageFeePerPalletWeek: 7,
			OutboundFeePerPallet:    0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "INBOUND",
				Description: "Inbound fee",
				Quantity:    1,
				UnitRate:    450,
				Amount:      450,
				SourceType:  "AUTO",
			},
			{
				ChargeType:  "STORAGE",
				Description: "Storage fee",
				Quantity:    140,
				UnitRate:    1,
				Amount:      140,
				SourceType:  "AUTO",
			},
			{
				ChargeType:  "DISCOUNT",
				Description: "Courtesy discount",
				Quantity:    1,
				UnitRate:    -20,
				Amount:      -20,
				SourceType:  "MANUAL",
			},
		},
	}

	invoice, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create mixed billing invoice: %v", err)
	}
	if invoice.Subtotal != 590 {
		t.Fatalf("expected subtotal 590 after create, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -20 {
		t.Fatalf("expected discount total -20 after create, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 570 {
		t.Fatalf("expected grand total 570 after create, got %.2f", invoice.GrandTotal)
	}
	if invoice.Rates.TransferInboundFeePerPallet != 10 {
		t.Fatalf("expected transfer inbound default 10, got %.2f", invoice.Rates.TransferInboundFeePerPallet)
	}
	if invoice.Rates.StorageFeePerPalletWeekNormal != 7 || invoice.Rates.StorageFeePerPalletWeekWestCoastTransfer != 7 {
		t.Fatalf("expected normalized storage rates of 7, got normal=%.2f west=%.2f", invoice.Rates.StorageFeePerPalletWeekNormal, invoice.Rates.StorageFeePerPalletWeekWestCoastTransfer)
	}

	updatedHeader := BillingInvoiceHeader{
		SellerName:          "SIM Logistics LLC",
		Subtitle:            "Warehouse services invoice",
		RemitTo:             "SIM Logistics LLC - ACH 1234",
		Terms:               "Net 15",
		PaymentDueDays:      15,
		PaymentInstructions: "Send ACH payment and reference the invoice number.",
	}
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Header: &updatedHeader})
	if err != nil {
		t.Fatalf("update invoice header: %v", err)
	}
	if invoice.Header.SellerName != "SIM Logistics LLC" || invoice.Header.Terms != "Net 15" || invoice.Header.PaymentDueDays != 15 {
		t.Fatalf("expected persisted invoice header update, got %#v", invoice.Header)
	}

	updatedCustomerName := "Imperial Bag & Paper - Billing"
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{CustomerName: &updatedCustomerName})
	if err != nil {
		t.Fatalf("update invoice customer name: %v", err)
	}
	if invoice.CustomerNameSnapshot != updatedCustomerName {
		t.Fatalf("expected persisted invoice customer name %q, got %q", updatedCustomerName, invoice.CustomerNameSnapshot)
	}

	blankHeader := BillingInvoiceHeader{}
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Header: &blankHeader})
	if err != nil {
		t.Fatalf("update invoice header with blank values: %v", err)
	}
	if invoice.Header.SellerName != "" || invoice.Header.Terms != "" || invoice.Header.PaymentDueDays != 0 || invoice.Header.PaymentInstructions != "" {
		t.Fatalf("expected blank invoice header fields to persist, got %#v", invoice.Header)
	}

	findLine := func(chargeType string) BillingInvoiceLine {
		t.Helper()
		for _, line := range invoice.Lines {
			if line.ChargeType == chargeType {
				return line
			}
		}
		t.Fatalf("find line %s: not found", chargeType)
		return BillingInvoiceLine{}
	}

	inboundLine := findLine("INBOUND")
	storageLine := findLine("STORAGE")
	discountLine := findLine("DISCOUNT")

	invoice, err = store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType:  "OUTBOUND",
		Description: "Outbound fee",
		Quantity:    1,
		UnitRate:    30.555,
		Amount:      30.555,
		Notes:       "Rounded outbound charge",
	})
	if err != nil {
		t.Fatalf("add outbound billing line: %v", err)
	}
	if invoice.Subtotal != 620.56 {
		t.Fatalf("expected subtotal 620.56 after add, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -20 {
		t.Fatalf("expected discount total -20 after add, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 600.56 {
		t.Fatalf("expected grand total 600.56 after add, got %.2f", invoice.GrandTotal)
	}

	var outboundLine BillingInvoiceLine
	foundOutbound := false
	for _, line := range invoice.Lines {
		if line.ChargeType == "OUTBOUND" {
			outboundLine = line
			foundOutbound = true
			break
		}
	}
	if !foundOutbound {
		t.Fatal("expected outbound line to be present after add")
	}
	if outboundLine.Amount != 30.56 {
		t.Fatalf("expected rounded outbound line amount 30.56, got %.2f", outboundLine.Amount)
	}

	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, storageLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "STORAGE",
		Description: "Storage fee revised",
		Quantity:    155.25,
		UnitRate:    1,
		Amount:      155.25,
	})
	if err != nil {
		t.Fatalf("update storage billing line: %v", err)
	}
	if invoice.Subtotal != 635.81 {
		t.Fatalf("expected subtotal 635.81 after storage update, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -20 {
		t.Fatalf("expected discount total -20 after storage update, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 615.81 {
		t.Fatalf("expected grand total 615.81 after storage update, got %.2f", invoice.GrandTotal)
	}

	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, discountLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "DISCOUNT",
		Description: "Courtesy discount revised",
		Quantity:    1,
		UnitRate:    -35.10,
		Amount:      -35.10,
	})
	if err != nil {
		t.Fatalf("update discount billing line: %v", err)
	}
	if invoice.Subtotal != 635.81 {
		t.Fatalf("expected subtotal 635.81 after discount update, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -35.10 {
		t.Fatalf("expected discount total -35.10 after discount update, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 600.71 {
		t.Fatalf("expected grand total 600.71 after discount update, got %.2f", invoice.GrandTotal)
	}

	invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, inboundLine.ID)
	if err != nil {
		t.Fatalf("delete inbound billing line: %v", err)
	}
	if invoice.LineCount != 3 {
		t.Fatalf("expected 3 lines after delete, got %d", invoice.LineCount)
	}
	if invoice.Subtotal != 185.81 {
		t.Fatalf("expected subtotal 185.81 after delete, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -35.10 {
		t.Fatalf("expected discount total -35.10 after delete, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 150.71 {
		t.Fatalf("expected grand total 150.71 after delete, got %.2f", invoice.GrandTotal)
	}

	invoice, err = store.FinalizeBillingInvoice(ctx, invoice.ID, authPayload.User.ID)
	if err != nil {
		t.Fatalf("finalize billing invoice: %v", err)
	}
	if invoice.Status != BillingInvoiceStatusFinalized {
		t.Fatalf("expected finalized invoice status, got %q", invoice.Status)
	}

	blockedNotes := "blocked"
	if _, err := store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Notes: &blockedNotes}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected updating finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	blockedHeader := BillingInvoiceHeader{Terms: "Due on receipt", PaymentDueDays: 1}
	if _, err := store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Header: &blockedHeader}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected updating finalized invoice header to fail with ErrInvalidInput, got %v", err)
	}
	if _, err := store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType:  "OUTBOUND",
		Description: "blocked",
		Quantity:    1,
		UnitRate:    1,
		Amount:      1,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected adding line to finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	if _, err := store.UpdateBillingInvoiceLine(ctx, invoice.ID, storageLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "STORAGE",
		Description: "blocked",
		Quantity:    1,
		UnitRate:    1,
		Amount:      1,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected updating line on finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	if _, err := store.DeleteBillingInvoiceLine(ctx, invoice.ID, storageLine.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleting line on finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	if err := store.DeleteBillingInvoice(ctx, invoice.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleting finalized invoice to fail with ErrInvalidInput, got %v", err)
	}

	paidInvoice, err := store.MarkBillingInvoicePaid(ctx, invoice.ID)
	if err != nil {
		t.Fatalf("mark billing invoice paid: %v", err)
	}
	if paidInvoice.Status != BillingInvoiceStatusPaid {
		t.Fatalf("expected paid invoice status, got %q", paidInvoice.Status)
	}
}

func TestBillingInvoiceTotalsRemainLineDerivedAcrossMutationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-totals-" + suffix + "@example.com",
		FullName: "Billing Totals " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing totals user: %v", err)
	}

	customer := mustCreateCustomer(t, ctx, store, "Billing Totals Customer "+suffix)
	invoice, err := store.CreateBillingInvoice(ctx, CreateBillingInvoiceInput{
		InvoiceType:  BillingInvoiceTypeMixed,
		CustomerID:   customer.ID,
		CustomerName: customer.Name,
		PeriodStart:  "2026-03-01",
		PeriodEnd:    "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:                      450,
			TransferInboundFeePerPallet:              10,
			WrappingFeePerPallet:                     15,
			StorageFeePerPalletWeekNormal:            7,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
			OutboundFeePerPallet:                     0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "INBOUND",
				Description: "Inbound charge",
				Quantity:    1,
				UnitRate:    450,
				Amount:      450,
				SourceType:  "AUTO",
			},
			{
				ChargeType:  "MANUAL",
				Description: "Handling charge",
				Quantity:    2,
				UnitRate:    10,
				Amount:      20.005,
				SourceType:  "MANUAL",
			},
			{
				ChargeType:  "DISCOUNT",
				Description: "Opening discount",
				Quantity:    1,
				UnitRate:    -5.555,
				Amount:      -5.555,
				SourceType:  "MANUAL",
			},
		},
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create billing totals invoice: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	mustFindLine := func(description string) BillingInvoiceLine {
		t.Helper()
		for _, line := range invoice.Lines {
			if line.Description == description {
				return line
			}
		}
		t.Fatalf("billing invoice line %q not found", description)
		return BillingInvoiceLine{}
	}

	if _, err := store.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET subtotal = 999.99, discount_total = 888.88, grand_total = 777.77
		WHERE id = ?
	`, invoice.ID); err != nil {
		t.Fatalf("corrupt billing invoice totals before mutation: %v", err)
	}

	handlingLine := mustFindLine("Handling charge")
	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, handlingLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "MANUAL",
		Description: "Handling charge adjusted",
		Quantity:    3,
		UnitRate:    10.004,
		Amount:      30.012,
	})
	if err != nil {
		t.Fatalf("update handling charge after corrupt totals: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)
	if invoice.Subtotal == 999.99 || invoice.DiscountTotal == 888.88 || invoice.GrandTotal == 777.77 {
		t.Fatalf("expected line update to recalculate corrupted invoice totals, got subtotal=%.2f discount=%.2f grand=%.2f", invoice.Subtotal, invoice.DiscountTotal, invoice.GrandTotal)
	}

	handlingLine = mustFindLine("Handling charge adjusted")
	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, handlingLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "DISCOUNT",
		Description: "Handling charge converted to discount",
		Quantity:    1,
		UnitRate:    -12.345,
		Amount:      -12.345,
	})
	if err != nil {
		t.Fatalf("convert handling charge to discount: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	invoice, err = store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType:  "MANUAL",
		Description: "Negative manual adjustment",
		Quantity:    1,
		UnitRate:    -1.235,
		Amount:      -1.235,
	})
	if err != nil {
		t.Fatalf("add negative manual adjustment: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	openingDiscountLine := mustFindLine("Opening discount")
	invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, openingDiscountLine.ID)
	if err != nil {
		t.Fatalf("delete opening discount: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	notes := "Totals invariant metadata update"
	customerName := "Billing Totals Customer Override"
	header := BillingInvoiceHeader{
		SellerName:          "SIM Billing",
		Subtitle:            "",
		RemitTo:             "SIM ACH",
		Terms:               "Due on receipt",
		PaymentDueDays:      0,
		PaymentInstructions: "",
	}
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{
		CustomerName: &customerName,
		Notes:        &notes,
		Header:       &header,
	})
	if err != nil {
		t.Fatalf("update invoice metadata without changing totals: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	for _, line := range append([]BillingInvoiceLine(nil), invoice.Lines...) {
		invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, line.ID)
		if err != nil {
			t.Fatalf("delete line %d while clearing invoice: %v", line.ID, err)
		}
		assertBillingInvoiceTotalsConsistent(t, invoice)
	}
	if invoice.LineCount != 0 {
		t.Fatalf("expected cleared invoice line count 0, got %d", invoice.LineCount)
	}
	assertMoneyEqual(t, "cleared invoice subtotal", invoice.Subtotal, 0)
	assertMoneyEqual(t, "cleared invoice discount total", invoice.DiscountTotal, 0)
	assertMoneyEqual(t, "cleared invoice grand total", invoice.GrandTotal, 0)
}

func TestBillingInvoicePersistsStorageDetailSnapshotsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-details-" + suffix + "@example.com",
		FullName: "Billing Details " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing details user: %v", err)
	}

	customer := mustCreateCustomer(t, ctx, store, "Billing Details Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Billing Details NJ "+suffix)

	details := json.RawMessage(`{
		"kind":"STORAGE_CONTAINER_SUMMARY",
		"warehouseLocationId":1,
		"warehouseName":"NJ",
		"warehousesTouched":["NJ"],
		"palletsTracked":2,
		"palletDays":31,
		"freePalletDays":7,
		"billablePalletDays":24,
		"grossAmount":31,
		"discountAmount":7,
		"segments":[
			{
				"startDate":"2026-03-01",
				"endDate":"2026-03-07",
				"dayEndPallets":1,
				"billedDays":7,
				"palletDays":7,
				"freePalletDays":7,
				"billablePalletDays":0,
				"grossAmount":7,
				"discountAmount":7,
				"amount":0
			},
			{
				"startDate":"2026-03-08",
				"endDate":"2026-03-31",
				"dayEndPallets":1,
				"billedDays":24,
				"palletDays":24,
				"freePalletDays":0,
				"billablePalletDays":24,
				"grossAmount":24,
				"discountAmount":0,
				"amount":24
			}
		]
	}`)

	invoice, err := store.CreateBillingInvoice(ctx, CreateBillingInvoiceInput{
		InvoiceType:         BillingInvoiceTypeStorage,
		CustomerID:          customer.ID,
		CustomerName:        customer.Name,
		WarehouseLocationID: int64Ptr(location.ID),
		WarehouseName:       location.Name,
		ContainerType:       ContainerTypeNormal,
		PeriodStart:         "2026-03-01",
		PeriodEnd:           "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:                      450,
			TransferInboundFeePerPallet:              10,
			WrappingFeePerPallet:                     15,
			StorageFeePerPalletWeekNormal:            7,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
			OutboundFeePerPallet:                     0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "STORAGE",
				Description: "Storage settlement for CONT-DETAIL",
				Reference:   "Storage | CONT-DETAIL",
				ContainerNo: "CONT-DETAIL",
				Warehouse:   location.Name,
				OccurredOn:  "2026-03-31",
				Quantity:    24,
				UnitRate:    1,
				Amount:      24,
				SourceType:  "AUTO",
				Details:     details,
			},
		},
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create storage invoice with details: %v", err)
	}

	if len(invoice.Lines) != 1 {
		t.Fatalf("expected 1 line on details invoice, got %d", len(invoice.Lines))
	}
	if len(invoice.Lines[0].Details) == 0 {
		t.Fatal("expected storage invoice line details to be persisted")
	}

	var decoded map[string]any
	if err := json.Unmarshal(invoice.Lines[0].Details, &decoded); err != nil {
		t.Fatalf("decode persisted storage line details: %v", err)
	}
	if decoded["kind"] != "STORAGE_CONTAINER_SUMMARY" {
		t.Fatalf("expected details kind STORAGE_CONTAINER_SUMMARY, got %#v", decoded["kind"])
	}
	if decoded["palletDays"] != float64(31) {
		t.Fatalf("expected palletDays 31 in stored details, got %#v", decoded["palletDays"])
	}
	if decoded["billablePalletDays"] != float64(24) {
		t.Fatalf("expected billablePalletDays 24 in stored details, got %#v", decoded["billablePalletDays"])
	}
	segments, ok := decoded["segments"].([]any)
	if !ok || len(segments) != 2 {
		t.Fatalf("expected 2 stored detail segments, got %#v", decoded["segments"])
	}

	invalidInput := CreateBillingInvoiceInput{
		InvoiceType:         BillingInvoiceTypeStorage,
		CustomerID:          customer.ID,
		CustomerName:        customer.Name,
		WarehouseLocationID: int64Ptr(location.ID),
		WarehouseName:       location.Name,
		ContainerType:       ContainerTypeNormal,
		PeriodStart:         "2026-04-01",
		PeriodEnd:           "2026-04-30",
		Rates:               invoice.Rates,
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "STORAGE",
				Description: "Invalid details",
				Quantity:    1,
				UnitRate:    1,
				Amount:      1,
				SourceType:  "AUTO",
				Details:     json.RawMessage(`{"kind":`),
			},
		},
	}
	if _, err := store.CreateBillingInvoice(ctx, invalidInput, authPayload.User.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid details JSON to fail with ErrInvalidInput, got %v", err)
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

}

func assertDocumentAttachmentSoftDeleted(t *testing.T, ctx context.Context, store *Store, attachmentID int64, documentType string, documentID int64) {
	t.Helper()

	attachments, err := store.ListDocumentAttachments(ctx, documentType, documentID)
	if err != nil {
		t.Fatalf("list document attachments after cancel: %v", err)
	}
	if len(attachments) != 0 {
		t.Fatalf("expected cancelled document attachments to be hidden, got %d", len(attachments))
	}

	var deletedAt sql.NullTime
	if err := store.db.QueryRowxContext(ctx, `
		SELECT deleted_at
		FROM document_attachments
		WHERE id = ?
	`, attachmentID).Scan(&deletedAt); err != nil {
		t.Fatalf("load cancelled document attachment %d: %v", attachmentID, err)
	}
	if !deletedAt.Valid {
		t.Fatalf("expected attachment %d to be soft deleted", attachmentID)
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
		ContainerID:    item.ContainerID,
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
		ContainerID:      item.ContainerID,
		ContainerNo:      item.ContainerNo,
		SKUMasterID:      item.SKUMasterID,
		Quantity:         quantity,
		ToLocationID:     toLocationID,
		ToStorageSection: toStorageSection,
		LineNote:         lineNote,
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

func mustGetOutboundDocument(t *testing.T, ctx context.Context, store *Store, documentID int64) OutboundDocument {
	t.Helper()
	document, err := store.getOutboundDocument(ctx, documentID)
	if err != nil {
		t.Fatalf("get outbound document %d: %v", documentID, err)
	}
	return document
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

func assertMovementContainers(t *testing.T, label string, movements []Movement, wantContainers ...string) {
	t.Helper()

	gotContainers := make([]string, 0, len(movements))
	for _, movement := range movements {
		gotContainers = append(gotContainers, movement.ContainerNo)
	}
	sort.Strings(gotContainers)
	sort.Strings(wantContainers)
	if !reflect.DeepEqual(gotContainers, wantContainers) {
		t.Fatalf("%s movement containers mismatch: got %v want %v", label, gotContainers, wantContainers)
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

func assertBillingInvoiceTotalsConsistent(t *testing.T, invoice BillingInvoice) {
	t.Helper()

	var subtotal, discountTotal float64
	for _, line := range invoice.Lines {
		if strings.EqualFold(line.ChargeType, "DISCOUNT") {
			discountTotal += line.Amount
		} else {
			subtotal += line.Amount
		}
	}
	subtotal = roundCurrencyGo(subtotal)
	discountTotal = roundCurrencyGo(discountTotal)
	grandTotal := roundCurrencyGo(subtotal + discountTotal)

	if invoice.LineCount != len(invoice.Lines) {
		t.Fatalf("invoice %s line count mismatch: stored=%d loaded=%d", invoice.InvoiceNo, invoice.LineCount, len(invoice.Lines))
	}
	assertMoneyEqual(t, "invoice "+invoice.InvoiceNo+" subtotal", invoice.Subtotal, subtotal)
	assertMoneyEqual(t, "invoice "+invoice.InvoiceNo+" discount total", invoice.DiscountTotal, discountTotal)
	assertMoneyEqual(t, "invoice "+invoice.InvoiceNo+" grand total", invoice.GrandTotal, grandTotal)
}

func assertMoneyEqual(t *testing.T, label string, got float64, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.001 {
		t.Fatalf("%s mismatch: got %.4f want %.4f", label, got, want)
	}
}

func integrationSuffix() string {
	return strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "")
}
