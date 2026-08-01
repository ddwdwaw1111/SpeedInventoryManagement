package service

import (
	"bytes"
	"context"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseBulkTransferImportWorkbook(t *testing.T) {
	workbook := excelize.NewFile()
	defer workbook.Close()
	sheet := workbook.GetSheetName(0)
	values := [][]string{
		{"Transfer Date", "Container No", "From Warehouse", "To Warehouse"},
		{"2026-07-31", "MSKU1234567", "Warehouse 99", "Warehouse 308"},
	}
	for rowIndex, row := range values {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				t.Fatalf("resolve cell: %v", err)
			}
			if err := workbook.SetCellValue(sheet, cell, value); err != nil {
				t.Fatalf("write workbook: %v", err)
			}
		}
	}
	var buffer bytes.Buffer
	if err := workbook.Write(&buffer); err != nil {
		t.Fatalf("encode workbook: %v", err)
	}

	rows, err := parseBulkTransferImportWorkbook(buffer.Bytes())
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one transfer row, got %d", len(rows))
	}
	if rows[0].documentKey != "ROW-2" || rows[0].input.ContainerNo != "MSKU1234567" || rows[0].fromName != "Warehouse 99" || rows[0].toName != "Warehouse 308" {
		t.Fatalf("unexpected parsed row: %#v", rows[0])
	}
}

func TestParseBulkTransferImportWorkbookParsesPartialTransferFields(t *testing.T) {
	workbook := excelize.NewFile()
	defer workbook.Close()
	sheet := workbook.GetSheetName(0)
	values := [][]string{
		{"Transfer No", "Transfer Mode", "Transfer Date", "Container No", "From Warehouse", "From Storage Section", "To Warehouse", "To Storage Section", "SKU", "Item Code", "Transfer Qty", "Source Inventory Pallets Released", "Destination Inventory Pallets Created"},
		{"MOVE-42", "PARTIAL", "2026-07-31", "MSKU1234567", "Warehouse 99", "TEMP", "Warehouse 308", "TEMP", "SKU-001", "ITEM-001", "245", "0", "1"},
	}
	for rowIndex, row := range values {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				t.Fatalf("resolve cell: %v", err)
			}
			if err := workbook.SetCellValue(sheet, cell, value); err != nil {
				t.Fatalf("write workbook: %v", err)
			}
		}
	}
	var buffer bytes.Buffer
	if err := workbook.Write(&buffer); err != nil {
		t.Fatalf("encode workbook: %v", err)
	}

	rows, err := parseBulkTransferImportWorkbook(buffer.Bytes())
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one transfer row, got %d", len(rows))
	}
	input := rows[0].input
	if input.TransferNo != "MOVE-42" || input.TransferMode != "PARTIAL" || input.SKU != "SKU-001" || input.ItemCode != "ITEM-001" {
		t.Fatalf("unexpected parsed partial transfer fields: %#v", input)
	}
	if input.Quantity == nil || *input.Quantity != 245 || input.SourcePallets == nil || *input.SourcePallets != 0 || input.DestinationPallets == nil || *input.DestinationPallets != 1 {
		t.Fatalf("unexpected parsed partial transfer balances: %#v", input)
	}
}

func TestBulkTransferImportUsesSuppliedTransferNoForAFullContainerGroup(t *testing.T) {
	input, err := (&Store{}).buildBulkTransferImportCommitInput(
		context.Background(),
		1,
		"0123456789abcdef0123456789abcdef",
		&bulkTransferImportCommitGroup{
			key:                 "TRANSFER:MOVE-42",
			requestedTransferNo: "move-42",
			rows: []BulkTransferImportCommitRow{{
				DocumentKey: "ROW-2",
				Input: BulkTransferImportInput{
					TransferNo:       "move-42",
					TransferMode:     transferBulkModeFullContainer,
					TransferDate:     "2026-07-31",
					ContainerNo:      "MSKU1234567",
					FromLocationID:   1,
					ToLocationID:     2,
					ToStorageSection: DefaultStorageSection,
				},
			}},
		},
		map[int64][]Item{},
	)
	if err != nil {
		t.Fatalf("build transfer input: %v", err)
	}
	if input.TransferNo != "MOVE-42" {
		t.Fatalf("transfer number = %q, want supplied value", input.TransferNo)
	}
	if input.EntireContainer == nil || input.EntireContainer.ContainerNo != "MSKU1234567" {
		t.Fatalf("unexpected entire-container transfer: %#v", input.EntireContainer)
	}
}

func TestBulkTransferImportTransferNoIsStablePerImportRow(t *testing.T) {
	first := bulkTransferImportTransferNo("0123456789abcdef0123456789abcdef", "ROW-2")
	if first != bulkTransferImportTransferNo("0123456789abcdef0123456789abcdef", "row-2") {
		t.Fatal("expected document-key case to produce the same deterministic transfer number")
	}
	if first == bulkTransferImportTransferNo("0123456789abcdef0123456789abcdef", "ROW-3") {
		t.Fatal("expected different import rows to produce distinct transfer numbers")
	}
}

func TestSummarizeBulkTransferPreviewGroupsCountsTransferNumbers(t *testing.T) {
	rows := []BulkTransferImportPreviewRow{
		{DocumentKey: "ROW-2", Input: BulkTransferImportInput{TransferNo: "MOVE-42"}},
		{DocumentKey: "ROW-3", Input: BulkTransferImportInput{TransferNo: "MOVE-42"}},
		{DocumentKey: "ROW-4", Input: BulkTransferImportInput{}},
		{DocumentKey: "ROW-5", Input: BulkTransferImportInput{TransferNo: "MOVE-99"}},
		{DocumentKey: "ROW-6", Input: BulkTransferImportInput{TransferNo: "MOVE-99"}, Issues: []BulkTransferImportIssue{{Severity: InboundBulkIssueError}}},
	}

	total, valid, invalid := summarizeBulkTransferPreviewGroups(rows)
	if total != 3 || valid != 2 || invalid != 1 {
		t.Fatalf("unexpected transfer group summary: total=%d valid=%d invalid=%d", total, valid, invalid)
	}
	if !rows[0].Valid || !rows[1].Valid || !rows[2].Valid || !rows[3].Valid || rows[4].Valid {
		t.Fatalf("unexpected row validity: %#v", rows)
	}
}
