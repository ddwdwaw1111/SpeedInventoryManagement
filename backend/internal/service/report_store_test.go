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

func TestBuildSKUFlowReportRowsAggregatesReceiveAndShip(t *testing.T) {
	receiveDate := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	shipDate := time.Date(2026, 4, 12, 0, 0, 0, 0, time.UTC)
	entries := []skuFlowLedgerRow{
		{
			PalletID:           1,
			EventType:          StockLedgerEventReceive,
			QuantityChange:     10,
			DeliveryDate:       sql.NullTime{Valid: true, Time: receiveDate},
			CustomerName:       "Acme Retail",
			LocationName:       "North Dock",
			StorageSection:     "A",
			ContainerNo:        "CONT-1",
			SourceDocumentType: StockLedgerSourceInbound,
			SourceDocumentID:   7,
			SourceLineID:       70,
			CreatedAt:          receiveDate,
		},
		{
			PalletID:           2,
			EventType:          StockLedgerEventReceive,
			QuantityChange:     15,
			DeliveryDate:       sql.NullTime{Valid: true, Time: receiveDate},
			CustomerName:       "Acme Retail",
			LocationName:       "North Dock",
			StorageSection:     "A",
			ContainerNo:        "CONT-1",
			SourceDocumentType: StockLedgerSourceInbound,
			SourceDocumentID:   7,
			SourceLineID:       70,
			CreatedAt:          receiveDate,
		},
		{
			PalletID:           1,
			EventType:          StockLedgerEventShip,
			QuantityChange:     -6,
			OutDate:            sql.NullTime{Valid: true, Time: shipDate},
			CustomerName:       "Acme Retail",
			LocationName:       "North Dock",
			StorageSection:     "A",
			ContainerNo:        "CONT-1",
			PackingListNo:      "PL-1",
			OrderRef:           "SO-1",
			SourceDocumentType: StockLedgerSourceOutbound,
			SourceDocumentID:   8,
			SourceLineID:       80,
			CreatedAt:          shipDate,
		},
		{
			PalletID:           1,
			EventType:          StockLedgerEventShip,
			QuantityChange:     -4,
			OutDate:            sql.NullTime{Valid: true, Time: shipDate},
			CustomerName:       "Acme Retail",
			LocationName:       "North Dock",
			StorageSection:     "A",
			ContainerNo:        "CONT-1",
			PackingListNo:      "PL-1",
			OrderRef:           "SO-1",
			SourceDocumentType: StockLedgerSourceOutbound,
			SourceDocumentID:   8,
			SourceLineID:       80,
			CreatedAt:          shipDate,
		},
		{
			PalletID:       3,
			EventType:      StockLedgerEventTransferIn,
			QuantityChange: 99,
			CreatedAt:      shipDate,
		},
	}

	summary, rows := buildSKUFlowReportRows(entries)

	if summary.InboundQty != 25 || summary.InboundPallets != 2 {
		t.Fatalf("unexpected inbound summary: %#v", summary)
	}
	if summary.OutboundQty != 10 || summary.OutboundPallets != 1 || summary.LastOutboundDate != "2026-04-12" {
		t.Fatalf("unexpected outbound summary: %#v", summary)
	}
	if summary.NetQty != 15 {
		t.Fatalf("expected net qty 15, got %d", summary.NetQty)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 grouped rows, got %d: %#v", len(rows), rows)
	}
	if rows[0].Direction != "OUTBOUND" || rows[0].Quantity != 10 || rows[0].Pallets != 1 || rows[0].Date != "2026-04-12" {
		t.Fatalf("unexpected outbound row: %#v", rows[0])
	}
	if rows[1].Direction != "INBOUND" || rows[1].Quantity != 25 || rows[1].Pallets != 2 || rows[1].Date != "2026-04-10" {
		t.Fatalf("unexpected inbound row: %#v", rows[1])
	}
}

func TestNormalizeSKUFlowReportFiltersRequiresSKU(t *testing.T) {
	_, _, _, err := normalizeSKUFlowReportFilters(SKUFlowReportFilters{
		StartDate: "2026-04-01",
		EndDate:   "2026-04-30",
	})
	if err == nil {
		t.Fatal("expected skuMasterId validation error")
	}
}

func TestNormalizeSKUFlowReportFiltersPreservesScope(t *testing.T) {
	filters, _, _, err := normalizeSKUFlowReportFilters(SKUFlowReportFilters{
		StartDate:   "2026-04-01",
		EndDate:     "2026-04-30",
		SKUMasterID: 42,
		CustomerID:  7,
		LocationID:  3,
	})
	if err != nil {
		t.Fatalf("unexpected normalize error: %v", err)
	}
	if filters.CustomerID != 7 || filters.LocationID != 3 {
		t.Fatalf("expected customer/location scope to be preserved, got %#v", filters)
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
