package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestParseOutboundBulkImportWorkbookGroupsPickingOrdersAndKeepsPalletCountsIndependent(t *testing.T) {
	data := buildOutboundBulkWorkbook(t, [][]any{
		{"Picking Order No", "Actual Ship Date", "Warehouse", "Source Container", "Storage Section", "SKU", "Item Code", "Qty", "Inventory Pallets", "Outbound Pallets", "Line Note"},
		{"PO-100", "2026-07-01", "EAST", "CONT-A", "A1", "SKU-1", "ITEM-1", 25, 2, 3, "first"},
		{"PO-100", "2026-07-01", "WEST", "CONT-B", "B2", "SKU-2", "ITEM-2", 7, 4, 2, "second"},
		{"PO-200", "", "EAST", "", "TEMP", "SKU-3", "", 12, 0, 1, "auto allocate"},
	})

	documents, err := parseOutboundBulkImportWorkbook(data)
	if err != nil {
		t.Fatalf("parse outbound workbook: %v", err)
	}
	if len(documents) != 2 {
		t.Fatalf("expected 2 shipments, got %d", len(documents))
	}
	first := documents[0]
	if first.PickingOrderNo != "PO-100" || len(first.Lines) != 2 {
		t.Fatalf("unexpected first shipment: %#v", first)
	}
	if first.DocumentKey != "ROW-2" {
		t.Fatalf("expected immutable row-based document key, got %q", first.DocumentKey)
	}
	if first.Lines[0].Quantity != 25 || first.Lines[0].InventoryPallets != 2 || first.Lines[0].OutboundPallets != 3 {
		t.Fatalf("quantity, inventory pallets, and outbound pallets were not parsed independently: %#v", first.Lines[0])
	}
	if first.Lines[1].Warehouse != "WEST" || first.Lines[1].SourceContainer != "CONT-B" {
		t.Fatalf("different warehouse/container source was not preserved: %#v", first.Lines[1])
	}
	if documents[1].Lines[0].SourceContainer != "" || documents[1].Lines[0].InventoryPallets != 0 || documents[1].Lines[0].OutboundPallets != 1 {
		t.Fatalf("optional container or zero pallets changed unexpectedly: %#v", documents[1].Lines[0])
	}
}

func TestParseOutboundBulkImportWorkbookInheritsBlankDocumentFields(t *testing.T) {
	data := buildOutboundBulkWorkbook(t, [][]any{
		{"Picking Order No", "Expected Ship Date", "Ship To Name", "Warehouse", "SKU", "Qty", "Inventory Pallets", "Outbound Pallets"},
		{"PO-100", "2026-07-20", "Buyer", "EAST", "SKU-1", 10, 1, 2},
		{"PO-100", "", "", "EAST", "SKU-2", 5, 1, 1},
	})

	documents, err := parseOutboundBulkImportWorkbook(data)
	if err != nil {
		t.Fatalf("parse outbound workbook: %v", err)
	}
	if len(documents) != 1 {
		t.Fatalf("expected one shipment, got %d", len(documents))
	}
	document := documents[0]
	if document.ExpectedShipDate != "2026-07-20" || document.ShipToName != "Buyer" {
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
				PackingListNo: "PO-100",
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
		{"Picking Order No", "Warehouse", "SKU", "Qty", "Inventory Pallets"},
		{"PO-100", "EAST", "SKU-1", 5, 1},
	})

	if _, err := parseOutboundBulkImportWorkbook(data); err == nil {
		t.Fatal("expected missing Outbound Pallets column to fail")
	}
}

func TestParseOutboundBulkImportWorkbookRequiresExplicitPalletValues(t *testing.T) {
	data := buildOutboundBulkWorkbook(t, [][]any{
		{"Picking Order No", "Warehouse", "SKU", "Qty", "Inventory Pallets", "Outbound Pallets"},
		{"PO-BLANK", "EAST", "SKU-1", 5, "", ""},
		{"PO-ZERO", "EAST", "SKU-1", 5, 0, 0},
	})

	documents, err := parseOutboundBulkImportWorkbook(data)
	if err != nil {
		t.Fatalf("parse outbound workbook: %v", err)
	}
	if len(documents) != 2 {
		t.Fatalf("expected two shipments, got %d", len(documents))
	}
	blankIssueCodes := make(map[string]bool)
	for _, issue := range documents[0].Issues {
		blankIssueCodes[issue.Code] = true
	}
	if !blankIssueCodes["INVALID_INVENTORY_PALLETS"] || !blankIssueCodes["INVALID_OUTBOUND_PALLETS"] {
		t.Fatalf("blank pallet values must be reported separately: %#v", documents[0].Issues)
	}
	for _, issue := range documents[1].Issues {
		if issue.Code == "INVALID_INVENTORY_PALLETS" || issue.Code == "INVALID_OUTBOUND_PALLETS" {
			t.Fatalf("explicit zero pallet values must remain valid: %#v", documents[1].Issues)
		}
	}
}

func TestSelectOutboundBulkAllocationsUsesLaterContainerForAvailablePallets(t *testing.T) {
	candidates := []Item{
		{ID: 1, ItemNumber: "ITEM-1", ContainerNo: "FIFO-NO-PALLETS", LocationID: 1, LocationName: "EAST", StorageSection: "A1"},
		{ID: 2, ItemNumber: "ITEM-1", ContainerNo: "LATER-WITH-PALLETS", LocationID: 1, LocationName: "EAST", StorageSection: "A1"},
	}
	remainingQty := map[int64]int{1: 10, 2: 10}
	remainingPallets := map[int64]int{1: 0, 2: 1}

	selected, stockAvailable, palletsAvailable := selectOutboundBulkAllocations(candidates, 5, 1, remainingQty, remainingPallets)
	if !stockAvailable || !palletsAvailable {
		t.Fatalf("expected a feasible quantity and pallet plan, got stock=%v pallets=%v", stockAvailable, palletsAvailable)
	}
	if len(selected) != 2 || selected[0].Allocation.AllocatedQty != 4 || selected[1].Allocation.AllocatedQty != 1 {
		t.Fatalf("expected FIFO quantity with one unit moved to the pallet-capable container: %#v", selected)
	}
	allocations, valid := assignOutboundBulkInventoryPallets(selected, 1, remainingPallets)
	if !valid || allocations[0].Pallets != 0 || allocations[1].Pallets != 1 {
		t.Fatalf("expected the inventory pallet to come from the later container: %#v", allocations)
	}
}

func TestOutboundBulkInsufficientStockIssueExplainsRequestedAndAvailableScope(t *testing.T) {
	line := OutboundBulkImportLinePreview{
		RowNumber: 4, Warehouse: "NJ", SourceContainer: "CONT-A", StorageSection: "A1", SKU: "SKU-1", Quantity: 12,
	}
	issue := outboundBulkInsufficientStockIssue(line, 5)

	if issue.Code != "INSUFFICIENT_STOCK" || issue.SKU != "SKU-1" || issue.RequestedQty != 12 || issue.AvailableQty != 5 {
		t.Fatalf("unexpected stock issue quantities: %#v", issue)
	}
	if issue.Warehouse != "NJ" || issue.SourceContainer != "CONT-A" || issue.StorageSection != "A1" {
		t.Fatalf("stock issue must retain its source scope: %#v", issue)
	}
}

func TestAssignOutboundBulkInventoryPalletsKeepsOutboundCountIndependent(t *testing.T) {
	remaining := map[int64]int{1: 1, 2: 2}
	allocations, valid := assignOutboundBulkInventoryPallets([]outboundBulkSelectedAllocation{
		{ItemID: 1, Allocation: OutboundPickAllocation{ContainerNo: "CONT-A", AllocatedQty: 10}},
		{ItemID: 2, Allocation: OutboundPickAllocation{ContainerNo: "CONT-B", AllocatedQty: 20}},
	}, 2, remaining)
	if !valid {
		t.Fatal("expected two inventory pallets to be available")
	}
	if allocations[0].Pallets != 1 || allocations[1].Pallets != 1 {
		t.Fatalf("unexpected FIFO inventory pallet allocation: %#v", allocations)
	}
	if remaining[1] != 0 || remaining[2] != 1 {
		t.Fatalf("unexpected remaining pallet balances: %#v", remaining)
	}
}

func TestAssignOutboundBulkInventoryPalletsRejectsUnavailableCountWithoutMutation(t *testing.T) {
	remaining := map[int64]int{1: 1}
	_, valid := assignOutboundBulkInventoryPallets([]outboundBulkSelectedAllocation{
		{ItemID: 1, Allocation: OutboundPickAllocation{ContainerNo: "CONT-A", AllocatedQty: 10}},
	}, 2, remaining)
	if valid || remaining[1] != 1 {
		t.Fatalf("unavailable inventory pallets must be rejected without changing balances: %#v", remaining)
	}
}

func TestInitializeOutboundBulkBalancesExcludesReservedPallets(t *testing.T) {
	remainingQty, remainingPallets := initializeOutboundBulkBalances([]Item{
		{ID: 1, Quantity: 20, AvailableQty: 12, Pallets: 5, AvailablePallets: 2, AllocatedPallets: 3},
	})

	if remainingQty[1] != 12 {
		t.Fatalf("expected available quantity balance, got %d", remainingQty[1])
	}
	if remainingPallets[1] != 2 {
		t.Fatalf("reserved pallets must be excluded from the import balance, got %d", remainingPallets[1])
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

func TestResolveMainOutboundLocationUsesWarehouse308(t *testing.T) {
	location, err := resolveMainOutboundLocation([]Location{
		{ID: 1, Name: "NJ Overflow"},
		{ID: 2, Name: "308 Herrod Blvd"},
	})
	if err != nil {
		t.Fatalf("resolve main outbound warehouse: %v", err)
	}
	if location.ID != 2 {
		t.Fatalf("expected warehouse 308, got %#v", location)
	}
}

func TestResolveMainOutboundLocationRejectsAmbiguous308Warehouses(t *testing.T) {
	_, err := resolveMainOutboundLocation([]Location{
		{ID: 1, Name: "308 Herrod Blvd"},
		{ID: 2, Name: "308 Overflow"},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ambiguous warehouse configuration error, got %v", err)
	}
}

func TestBuildOutboundBulkMainWarehousePlanTransfersRemoteAllocations(t *testing.T) {
	input, transfer, err := buildOutboundBulkMainWarehousePlan(CreateOutboundDocumentInput{
		PackingListNo:    "PO-308",
		ExpectedShipDate: "2026-07-15",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID: 1, LocationID: 9, SKUMasterID: 7, Quantity: 8, Pallets: 3,
			PickAllocations: []OutboundPickAllocation{
				{LocationID: 9, LocationName: "Overflow", StorageSection: "A1", ContainerNo: "CONT-A", AllocatedQty: 5, Pallets: 2},
				{LocationID: 3, LocationName: "308 Herrod Blvd", StorageSection: "B2", ContainerNo: "CONT-B", AllocatedQty: 3, Pallets: 1},
			},
		}},
	}, Location{ID: 3, Name: "308 Herrod Blvd"})
	if err != nil {
		t.Fatalf("build main warehouse plan: %v", err)
	}
	if len(transfer.Lines) != 1 {
		t.Fatalf("expected only the remote allocation to transfer, got %#v", transfer.Lines)
	}
	line := transfer.Lines[0]
	if line.LocationID != 9 || line.ToLocationID != 3 || line.Quantity != 5 || line.Pallets != 2 || line.ToStorageSection != DefaultStorageSection {
		t.Fatalf("unexpected transfer line: %#v", line)
	}
	if input.Lines[0].LocationID != 3 {
		t.Fatalf("expected outbound line to use warehouse 308, got %#v", input.Lines[0])
	}
	for _, allocation := range input.Lines[0].PickAllocations {
		if allocation.LocationID != 3 || allocation.LocationName != "308 Herrod Blvd" {
			t.Fatalf("expected rewritten 308 allocation, got %#v", allocation)
		}
	}
	if input.Lines[0].PickAllocations[0].StorageSection != DefaultStorageSection || input.Lines[0].PickAllocations[1].StorageSection != "B2" {
		t.Fatalf("expected only transferred stock to stage in TEMP, got %#v", input.Lines[0].PickAllocations)
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
