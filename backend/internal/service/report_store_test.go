package service

import (
	"database/sql"
	"testing"
	"time"
)

func TestBuildReportPalletFlowRowsUsesLedgerBalances(t *testing.T) {
	start := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 4, 3, 0, 0, 0, 0, time.UTC)
	events := []reportLedgerEventRow{
		{
			PalletID:       1,
			BusinessDate:   start,
			EventType:      StockLedgerEventShip,
			QuantityChange: -4,
		},
		{
			PalletID:       2,
			BusinessDate:   start,
			EventType:      StockLedgerEventReceive,
			QuantityChange: 12,
		},
		{
			PalletID:       2,
			BusinessDate:   start.AddDate(0, 0, 1),
			EventType:      StockLedgerEventShip,
			QuantityChange: -12,
		},
		{
			PalletID:       3,
			BusinessDate:   start.AddDate(0, 0, 1),
			EventType:      StockLedgerEventCount,
			QuantityChange: 5,
		},
	}

	rows := buildReportPalletFlowRows(map[int64]int{1: 10}, events, start, end)

	if len(rows) != 3 {
		t.Fatalf("expected 3 daily rows, got %d", len(rows))
	}
	assertReportPalletFlowRow(t, rows[0], "2026-04-01", 1, 1, 0, 2)
	assertReportPalletFlowRow(t, rows[1], "2026-04-02", 0, 1, 1, 2)
	assertReportPalletFlowRow(t, rows[2], "2026-04-03", 0, 0, 0, 2)
}

func TestBuildReportMovementTrendRowsUsesQuantityMovement(t *testing.T) {
	start := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	events := []reportLedgerEventRow{
		{
			PalletID:       1,
			BusinessDate:   start,
			EventType:      StockLedgerEventReceive,
			QuantityChange: 20,
		},
		{
			PalletID:       2,
			BusinessDate:   start.AddDate(0, 0, 4),
			EventType:      StockLedgerEventShip,
			QuantityChange: -8,
		},
		{
			PalletID:       3,
			BusinessDate:   start.AddDate(0, 0, 9),
			EventType:      StockLedgerEventTransferIn,
			QuantityChange: 5,
		},
	}

	rows := buildReportMovementTrendRows(events, ReportGranularityMonth)

	if len(rows) != 1 {
		t.Fatalf("expected 1 monthly row, got %d", len(rows))
	}
	if rows[0].Key != "2026-04" || rows[0].Inbound != 25 || rows[0].Outbound != 8 {
		t.Fatalf("unexpected monthly trend row: %#v", rows[0])
	}
}

func TestBuildReportLedgerBucketsUsesBusinessDateAndSearchLookups(t *testing.T) {
	start := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 4, 11, 0, 0, 0, 0, time.UTC)
	entries := []reportLedgerEntry{
		{
			PalletID:       7,
			SKUMasterID:    42,
			CustomerID:     3,
			LocationID:     5,
			EventType:      StockLedgerEventReceive,
			QuantityChange: 9,
			DeliveryDate:   sql.NullTime{Valid: true, Time: start},
			CreatedAt:      start.Add(-12 * time.Hour),
		},
		{
			PalletID:       7,
			SKUMasterID:    42,
			CustomerID:     3,
			LocationID:     5,
			EventType:      StockLedgerEventShip,
			QuantityChange: -9,
			OutDate:        sql.NullTime{Valid: true, Time: end},
			CreatedAt:      end,
		},
	}
	lookups := reportSearchLookups{
		customers: map[int64]string{3: "Acme Retail"},
		locations: map[int64]string{5: "North Dock"},
		skuMasters: map[int64]reportSKUSearchLookup{
			42: {
				SKU:         "SKU-42",
				Name:        "Widget",
				Description: "Blue Widget",
			},
		},
	}

	openingBalances, events := buildReportLedgerBuckets(entries, lookups, "north dock", start, end)

	if len(openingBalances) != 0 {
		t.Fatalf("expected no opening balances, got %#v", openingBalances)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 matching events, got %d", len(events))
	}
	if events[0].BusinessDate.Format(time.DateOnly) != "2026-04-10" {
		t.Fatalf("expected receive business date 2026-04-10, got %s", events[0].BusinessDate.Format(time.DateOnly))
	}
	if events[1].BusinessDate.Format(time.DateOnly) != "2026-04-11" {
		t.Fatalf("expected ship business date 2026-04-11, got %s", events[1].BusinessDate.Format(time.DateOnly))
	}
}

func assertReportPalletFlowRow(
	t *testing.T,
	row ReportPalletFlowRow,
	dateKey string,
	inbound int,
	outbound int,
	adjustmentDelta int,
	endOfDay int,
) {
	t.Helper()

	if row.DateKey != dateKey ||
		row.Inbound != inbound ||
		row.Outbound != outbound ||
		row.AdjustmentDelta != adjustmentDelta ||
		row.EndOfDay != endOfDay {
		t.Fatalf(
			"unexpected pallet flow row: got %#v, want date=%s inbound=%d outbound=%d adjustment=%d end=%d",
			row,
			dateKey,
			inbound,
			outbound,
			adjustmentDelta,
			endOfDay,
		)
	}
}
