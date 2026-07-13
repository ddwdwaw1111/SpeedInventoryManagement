package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestParseOutboundBulkImportWorkbookGroupsPackingListsAndKeepsUnitsIndependent(t *testing.T) {
	data := buildOutboundBulkWorkbook(t, [][]any{
		{"Packing List No", "Order Ref", "Actual Ship Date", "Warehouse", "Source Container", "Storage Section", "SKU", "Item Code", "Qty", "Pallets", "Line Note"},
		{"PL-100", "ORDER-1", "2026-07-01", "EAST", "CONT-A", "A1", "SKU-1", "ITEM-1", 25, 2, "first"},
		{"PL-100", "ORDER-1", "2026-07-01", "WEST", "CONT-B", "B2", "SKU-2", "ITEM-2", 7, 4, "second"},
		{"PL-200", "ORDER-2", "", "EAST", "", "TEMP", "SKU-3", "", 12, 0, "auto allocate"},
	})

	documents, err := parseOutboundBulkImportWorkbook(data)
	if err != nil {
		t.Fatalf("parse outbound workbook: %v", err)
	}
	if len(documents) != 2 {
		t.Fatalf("expected 2 shipments, got %d", len(documents))
	}
	first := documents[0]
	if first.PackingListNo != "PL-100" || len(first.Lines) != 2 {
		t.Fatalf("unexpected first shipment: %#v", first)
	}
	if first.DocumentKey != "ROW-2" {
		t.Fatalf("expected immutable row-based document key, got %q", first.DocumentKey)
	}
	if first.Lines[0].Quantity != 25 || first.Lines[0].Pallets != 2 {
		t.Fatalf("qty and pallets were not parsed independently: %#v", first.Lines[0])
	}
	if first.Lines[1].Warehouse != "WEST" || first.Lines[1].SourceContainer != "CONT-B" {
		t.Fatalf("different warehouse/container source was not preserved: %#v", first.Lines[1])
	}
	if documents[1].Lines[0].SourceContainer != "" || documents[1].Lines[0].Pallets != 0 {
		t.Fatalf("optional container or zero pallets changed unexpectedly: %#v", documents[1].Lines[0])
	}
}

func TestParseOutboundBulkImportWorkbookInheritsBlankDocumentFields(t *testing.T) {
	data := buildOutboundBulkWorkbook(t, [][]any{
		{"Packing List No", "Order Ref", "Expected Ship Date", "Ship To Name", "Carrier Name", "Warehouse", "SKU", "Qty", "Pallets"},
		{"PL-100", "ORDER-1", "2026-07-20", "Buyer", "Carrier", "EAST", "SKU-1", 10, 1},
		{"PL-100", "", "", "", "", "EAST", "SKU-2", 5, 1},
	})

	documents, err := parseOutboundBulkImportWorkbook(data)
	if err != nil {
		t.Fatalf("parse outbound workbook: %v", err)
	}
	if len(documents) != 1 {
		t.Fatalf("expected one shipment, got %d", len(documents))
	}
	document := documents[0]
	if document.OrderRef != "ORDER-1" || document.ExpectedShipDate != "2026-07-20" || document.ShipToName != "Buyer" || document.CarrierName != "Carrier" {
		t.Fatalf("document fields were not inherited: %#v", document)
	}
	for _, issue := range document.Issues {
		if issue.Code == "HEADER_CONFLICT" {
			t.Fatalf("blank repeated document fields must not conflict: %#v", issue)
		}
	}
}

func TestCreateOutboundDocumentsBulkDraftEnforcesLineLimitBeforeDatabaseWork(t *testing.T) {
	store := &Store{}
	_, err := store.CreateOutboundDocumentsBulkDraft(context.Background(), OutboundBulkImportCommitInput{
		ImportID:   "0123456789abcdef0123456789abcdef",
		CustomerID: 1,
		Documents: []OutboundBulkImportCommitDocument{{
			DocumentKey: "ROW-2",
			Input: CreateOutboundDocumentInput{
				PackingListNo: "PL-100",
				Lines:         make([]CreateOutboundDocumentLineInput, MaxOutboundBulkImportRows+1),
			},
		}},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected line limit validation error, got %v", err)
	}
}

func TestParseOutboundBulkImportWorkbookRequiresStandardColumns(t *testing.T) {
	data := buildOutboundBulkWorkbook(t, [][]any{
		{"Packing List No", "Warehouse", "SKU", "Qty"},
		{"PL-100", "EAST", "SKU-1", 5},
	})

	if _, err := parseOutboundBulkImportWorkbook(data); err == nil {
		t.Fatal("expected missing Pallets column to fail")
	}
}

func TestResolveOutboundBulkMasterTreatsItemCodeAsReferenceOnly(t *testing.T) {
	first := SKUMaster{ID: 1, SKU: "SKU-A", ItemNumber: "ITEM-A"}
	mastersBySKU := map[string]SKUMaster{"SKU-A": first}

	resolved, code, _ := resolveOutboundBulkMaster(
		OutboundBulkImportLinePreview{SKU: "SKU-A", ItemNumber: "ITEM-B"},
		mastersBySKU,
	)
	if code != "" || resolved.ID != first.ID {
		t.Fatalf("expected SKU to remain authoritative, got master=%#v code=%q", resolved, code)
	}

	_, code, _ = resolveOutboundBulkMaster(
		OutboundBulkImportLinePreview{ItemNumber: "ITEM-B"},
		mastersBySKU,
	)
	if code != "INVALID_SKU" {
		t.Fatalf("expected Item-Code-only row to require SKU, got code=%q", code)
	}
}

func TestSortOutboundBulkCandidatesMatchesOutboundFIFO(t *testing.T) {
	createdAt := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	firstDelivery := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	secondDelivery := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	candidates := []Item{
		{ID: 1, ContainerNo: "NO-DATE", StorageSection: "A", CreatedAt: createdAt},
		{ID: 2, ContainerNo: "SECOND", StorageSection: "A", DeliveryDate: &secondDelivery, CreatedAt: createdAt},
		{ID: 3, ContainerNo: "FIRST", StorageSection: "B", DeliveryDate: &firstDelivery, CreatedAt: createdAt},
	}

	sortOutboundBulkCandidates(candidates)
	got := []int64{candidates[0].ID, candidates[1].ID, candidates[2].ID}
	want := []int64{3, 2, 1}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("unexpected FIFO order: got %v want %v", got, want)
		}
	}
}

func buildOutboundBulkWorkbook(t *testing.T, rows [][]any) []byte {
	t.Helper()
	workbook := excelize.NewFile()
	defer workbook.Close()
	for rowIndex, row := range rows {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				t.Fatalf("resolve cell: %v", err)
			}
			if err := workbook.SetCellValue("Sheet1", cell, value); err != nil {
				t.Fatalf("write cell: %v", err)
			}
		}
	}
	buffer, err := workbook.WriteToBuffer()
	if err != nil {
		t.Fatalf("write workbook: %v", err)
	}
	return buffer.Bytes()
}
