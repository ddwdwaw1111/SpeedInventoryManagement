package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestInboundBulkImportKeysAreStableAndPayloadSensitive(t *testing.T) {
	importID := "0123456789abcdef0123456789abcdef"
	firstKey := inboundBulkImportDocumentKey(importID, " receipt-a ")
	secondKey := inboundBulkImportDocumentKey(importID, "RECEIPT-A")
	if firstKey != secondKey {
		t.Fatalf("expected normalized document keys to be stable: %q != %q", firstKey, secondKey)
	}
	if firstKey == inboundBulkImportDocumentKey(importID, "RECEIPT-B") {
		t.Fatal("different document keys must not share an idempotency key")
	}

	input := CreateInboundDocumentInput{
		CustomerID:     1,
		LocationID:     2,
		ContainerNo:    "CONT-A",
		Status:         DocumentStatusDraft,
		TrackingStatus: InboundTrackingScheduled,
		Lines:          []CreateInboundDocumentLineInput{{SKU: "SKU-1", Description: "Item", ExpectedQty: 10}},
	}
	firstHash, err := inboundBulkImportPayloadHash("RECEIPT-A", input)
	if err != nil {
		t.Fatalf("hash payload: %v", err)
	}
	input.Lines[0].ExpectedQty = 11
	secondHash, err := inboundBulkImportPayloadHash("RECEIPT-A", input)
	if err != nil {
		t.Fatalf("hash changed payload: %v", err)
	}
	if firstHash == secondHash {
		t.Fatal("changed receipt data must change the payload hash")
	}
}

func TestNormalizeInboundContainerNoRemovesMatchingLegacyArrivalSuffix(t *testing.T) {
	if got := normalizeInboundContainerNo(" shya1120-3608-20260115 ", "2026-01-15"); got != "SHYA1120-3608" {
		t.Fatalf("expected matching arrival suffix to be removed, got %q", got)
	}
	if got := normalizeInboundContainerNo("SHYA1120-3608-20260115", "2026-01-16"); got != "SHYA1120-3608-20260115" {
		t.Fatalf("non-matching date suffix must remain unchanged, got %q", got)
	}
	if got := normalizeInboundContainerNo("SHYA1120-3608", "2026-01-15"); got != "SHYA1120-3608" {
		t.Fatalf("ordinary container number must remain unchanged, got %q", got)
	}
}

func TestBulkImportedHistoricalReceiptUsesActualArrivalDateForLedgerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	historicalDate := "2024-02-03"

	customer, err := store.CreateCustomer(ctx, CreateCustomerInput{Name: "Historical Bulk Customer " + suffix})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	location, err := store.CreateLocation(ctx, CreateLocationInput{
		Name:         "Historical Bulk Warehouse " + suffix,
		Address:      "Test Address",
		Capacity:     1000,
		SectionNames: []string{DefaultStorageSection},
	})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}

	result, err := store.CreateInboundDocumentsBulkDraft(ctx, InboundBulkImportCommitInput{
		ImportID:       "abcdef0123456789abcdef0123456789",
		SourceFileName: "historical-receipts.xlsx",
		CustomerID:     customer.ID,
		Documents: []InboundBulkImportCommitDocument{{
			DocumentKey: "HISTORICAL-1",
			Input: CreateInboundDocumentInput{
				LocationID:        location.ID,
				ContainerNo:       "HIST-CONT-" + suffix,
				ActualArrivalDate: historicalDate,
				HandlingMode:      InboundHandlingModePalletized,
				Lines: []CreateInboundDocumentLineInput{{
					SKU:            "HIST-SKU-" + suffix,
					Description:    "Historical imported cartons",
					ExpectedQty:    10,
					ReceivedQty:    10,
					Pallets:        2,
					UnitsPerPallet: 5,
					StorageSection: DefaultStorageSection,
				}},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create historical bulk draft: %v", err)
	}
	if result.CreatedDocuments != 1 || len(result.Results) != 1 || result.Results[0].Document == nil {
		t.Fatalf("unexpected bulk import result: %#v", result)
	}
	documentID := result.Results[0].Document.ID
	if result.Results[0].Document.ActualArrivalDate == nil || result.Results[0].Document.ActualArrivalDate.Format("2006-01-02") != historicalDate {
		t.Fatalf("expected draft to preserve historical actual arrival date, got %#v", result.Results[0].Document.ActualArrivalDate)
	}

	if _, err := store.ConfirmInboundDocument(ctx, documentID); err != nil {
		t.Fatalf("confirm historical bulk receipt: %v", err)
	}

	var ledgerDate time.Time
	if err := store.db.GetContext(ctx, &ledgerDate, `
		SELECT MIN(delivery_date)
		FROM stock_ledger
		WHERE source_document_type = 'INBOUND' AND source_document_id = ?
	`, documentID); err != nil {
		t.Fatalf("load historical stock ledger date: %v", err)
	}
	if ledgerDate.Format("2006-01-02") != historicalDate {
		t.Fatalf("expected stock ledger date %s, got %s", historicalDate, ledgerDate.Format("2006-01-02"))
	}

	var lifecycleDate time.Time
	if err := store.db.GetContext(ctx, &lifecycleDate, `
		SELECT MIN(cle.event_time)
		FROM container_lifecycle_events cle
		JOIN stock_ledger sl ON sl.id = cle.stock_ledger_id
		WHERE sl.source_document_type = 'INBOUND' AND sl.source_document_id = ?
	`, documentID); err != nil {
		t.Fatalf("load historical container lifecycle date: %v", err)
	}
	if lifecycleDate.Format("2006-01-02") != historicalDate {
		t.Fatalf("expected container lifecycle date %s, got %s", historicalDate, lifecycleDate.Format("2006-01-02"))
	}
}

func TestValidateAndNormalizeInboundBulkCommitDocumentRechecksCurrentMasterData(t *testing.T) {
	validation := newInboundBulkValidationContext(
		Location{ID: 2, SectionNames: []string{"A"}},
		[]SKUMaster{{SKU: "SKU-1", ItemNumber: "ITEM-1", Description: "Known item", DefaultUnitsPerPallet: 48}},
	)
	input := CreateInboundDocumentInput{
		CustomerID:          1,
		LocationID:          2,
		ContainerNo:         "cont-a",
		ExpectedArrivalDate: "2026-07-14",
		ActualArrivalDate:   "2024-01-15",
		HandlingMode:        InboundHandlingModePalletized,
		Status:              DocumentStatusDraft,
		TrackingStatus:      InboundTrackingScheduled,
		DocumentNote:        "should not be imported",
		Lines:               []CreateInboundDocumentLineInput{{SKU: "sku-1", ExpectedQty: 930, Pallets: 20, StorageSection: "a"}},
	}
	normalized, err := validateAndNormalizeInboundBulkCommitDocument(input, validation)
	if err != nil {
		t.Fatalf("validate current master data: %v", err)
	}
	if normalized.ContainerNo != "CONT-A" || normalized.Lines[0].ItemNumber != "ITEM-1" || normalized.Lines[0].Description != "Known item" || normalized.Lines[0].UnitsPerPallet != 48 {
		t.Fatalf("unexpected normalized document: %#v", normalized)
	}
	if normalized.Lines[0].ExpectedQty != 930 || normalized.Lines[0].Pallets != 20 {
		t.Fatalf("quantity and pallets must remain independent: %#v", normalized.Lines[0])
	}
	if normalized.ExpectedArrivalDate != "" || normalized.ActualArrivalDate != "2024-01-15" || normalized.DocumentNote != "" {
		t.Fatalf("bulk import must keep only the actual arrival date: %#v", normalized)
	}

	invalidSection := input
	invalidSection.Lines = append([]CreateInboundDocumentLineInput(nil), input.Lines...)
	invalidSection.Lines[0].StorageSection = "MISSING"
	if _, err := validateAndNormalizeInboundBulkCommitDocument(invalidSection, validation); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected current warehouse section validation, got %v", err)
	}

	conflictingItemCode := input
	conflictingItemCode.Lines = append([]CreateInboundDocumentLineInput(nil), input.Lines...)
	conflictingItemCode.Lines[0].ItemNumber = "OTHER-CODE"
	if _, err := validateAndNormalizeInboundBulkCommitDocument(conflictingItemCode, validation); err == nil || !strings.Contains(err.Error(), "already uses item code") {
		t.Fatalf("expected current item-code validation, got %v", err)
	}
}

func TestCreateInboundDocumentsBulkDraftIsIdempotentIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer, err := store.CreateCustomer(ctx, CreateCustomerInput{Name: "Bulk Customer " + suffix})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	location, err := store.CreateLocation(ctx, CreateLocationInput{Name: "Bulk Warehouse " + suffix, Address: "Test Address", Capacity: 1000, SectionNames: []string{DefaultStorageSection}})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}
	secondLocation, err := store.CreateLocation(ctx, CreateLocationInput{Name: "Bulk Warehouse 2 " + suffix, Address: "Test Address 2", Capacity: 1000, SectionNames: []string{DefaultStorageSection}})
	if err != nil {
		t.Fatalf("create second location: %v", err)
	}
	input := InboundBulkImportCommitInput{
		ImportID:       "0123456789abcdef0123456789abcdef",
		SourceFileName: "receipts.xlsx",
		CustomerID:     customer.ID,
		Documents: []InboundBulkImportCommitDocument{
			{
				DocumentKey: "DOC-1",
				Input: CreateInboundDocumentInput{
					LocationID:        location.ID,
					ContainerNo:       "CONT-A-" + suffix,
					ActualArrivalDate: "2026-07-15",
					HandlingMode:      InboundHandlingModePalletized,
					Lines: []CreateInboundDocumentLineInput{{
						SKU:            "SKU-A-" + suffix,
						ItemNumber:     "ITEM-A-" + suffix,
						Description:    "Imported item A",
						ExpectedQty:    10,
						Pallets:        2,
						UnitsPerPallet: 6,
						StorageSection: DefaultStorageSection,
					}},
				},
			},
			{
				DocumentKey: "DOC-2",
				Input: CreateInboundDocumentInput{
					LocationID:        secondLocation.ID,
					ContainerNo:       "CONT-B-" + suffix,
					ActualArrivalDate: "2026-07-16",
					HandlingMode:      InboundHandlingModePalletized,
					Lines: []CreateInboundDocumentLineInput{{
						SKU:            "SKU-B-" + suffix,
						ItemNumber:     "ITEM-B-" + suffix,
						Description:    "Imported item B",
						ExpectedQty:    20,
						Pallets:        4,
						UnitsPerPallet: 5,
						StorageSection: DefaultStorageSection,
					}},
				},
			},
		},
	}

	first, err := store.CreateInboundDocumentsBulkDraft(ctx, input)
	if err != nil {
		t.Fatalf("first bulk import: %v", err)
	}
	second, err := store.CreateInboundDocumentsBulkDraft(ctx, input)
	if err != nil {
		t.Fatalf("retry bulk import: %v", err)
	}
	if first.CreatedDocuments != 2 || second.CreatedDocuments != 2 || first.Results[0].Document == nil || second.Results[0].Document == nil || first.Results[1].Document == nil || second.Results[1].Document == nil {
		t.Fatalf("unexpected idempotent responses: %#v %#v", first, second)
	}
	if first.Results[0].Document.ID != second.Results[0].Document.ID {
		t.Fatalf("retry created a duplicate receipt: %d != %d", first.Results[0].Document.ID, second.Results[0].Document.ID)
	}
	if first.Results[1].Document.ID != second.Results[1].Document.ID {
		t.Fatalf("retry created a duplicate receipt in second warehouse: %d != %d", first.Results[1].Document.ID, second.Results[1].Document.ID)
	}
	if first.Results[0].Document.LocationID != location.ID || first.Results[1].Document.LocationID != secondLocation.ID {
		t.Fatalf("receipts were not created in their selected warehouses: %#v", first.Results)
	}

	changed := input
	changed.Documents = append([]InboundBulkImportCommitDocument(nil), input.Documents...)
	changed.Documents[0].Input.Lines = append([]CreateInboundDocumentLineInput(nil), input.Documents[0].Input.Lines...)
	changed.Documents[0].Input.Lines[0].ExpectedQty = 11
	mismatch, err := store.CreateInboundDocumentsBulkDraft(ctx, changed)
	if err != nil {
		t.Fatalf("mismatched retry: %v", err)
	}
	if mismatch.FailedDocuments != 1 || mismatch.CreatedDocuments != 1 || !strings.Contains(mismatch.Results[0].Error, "different receipt data") {
		t.Fatalf("expected mismatched retry to fail: %#v", mismatch)
	}
}

func TestBulkInboundAllowsMultipleReceiptsForOneContainerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	containerNo := "SHARED-CONT-" + suffix

	customer, err := store.CreateCustomer(ctx, CreateCustomerInput{Name: "Shared Container Bulk Customer " + suffix})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	location, err := store.CreateLocation(ctx, CreateLocationInput{Name: "Shared Container Bulk Warehouse " + suffix, Address: "Test Address", Capacity: 1000, SectionNames: []string{DefaultStorageSection}})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}

	result, err := store.CreateInboundDocumentsBulkDraft(ctx, InboundBulkImportCommitInput{
		ImportID:       "fedcba9876543210fedcba9876543210",
		SourceFileName: "shared-container-receipts.xlsx",
		CustomerID:     customer.ID,
		Documents: []InboundBulkImportCommitDocument{
			{
				DocumentKey: inboundBulkReceiptIdentity(containerNo, "2026-01-15"),
				Input: CreateInboundDocumentInput{
					LocationID: location.ID, ContainerNo: containerNo + "-20260115", ActualArrivalDate: "2026-01-15", HandlingMode: InboundHandlingModePalletized,
					Lines: []CreateInboundDocumentLineInput{{SKU: "SHARED-SKU-" + suffix, Description: "Shared container item", ReceivedQty: 10, Pallets: 2, StorageSection: DefaultStorageSection}},
				},
			},
			{
				DocumentKey: inboundBulkReceiptIdentity(containerNo, "2026-01-16"),
				Input: CreateInboundDocumentInput{
					LocationID: location.ID, ContainerNo: containerNo + "-20260116", ActualArrivalDate: "2026-01-16", HandlingMode: InboundHandlingModePalletized,
					Lines: []CreateInboundDocumentLineInput{{SKU: "SHARED-SKU-" + suffix, Description: "Shared container item", ReceivedQty: 5, Pallets: 1, StorageSection: DefaultStorageSection}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("create shared-container receipts: %v", err)
	}
	if result.CreatedDocuments != 2 || result.FailedDocuments != 0 {
		t.Fatalf("expected two receipt drafts, got %#v", result)
	}
	confirmedReceiptIDs := make([]int64, 0, len(result.Results))
	for _, entry := range result.Results {
		if entry.Document == nil {
			t.Fatalf("missing created receipt: %#v", entry)
		}
		if entry.Document.ContainerNo != containerNo {
			t.Fatalf("expected canonical container number %q, got %q", containerNo, entry.Document.ContainerNo)
		}
		if _, err := store.ConfirmInboundDocument(ctx, entry.Document.ID); err != nil {
			t.Fatalf("confirm receipt %d: %v", entry.Document.ID, err)
		}
		confirmedReceiptIDs = append(confirmedReceiptIDs, entry.Document.ID)
	}

	var receiptCount, containerCount, visitCount int
	if err := store.db.GetContext(ctx, &receiptCount, `SELECT COUNT(*) FROM inbound_documents WHERE customer_id = ? AND container_no = ?`, customer.ID, containerNo); err != nil {
		t.Fatalf("count receipts: %v", err)
	}
	if err := store.db.GetContext(ctx, &containerCount, `SELECT COUNT(*) FROM containers WHERE customer_id = ? AND container_no = ?`, customer.ID, containerNo); err != nil {
		t.Fatalf("count container records: %v", err)
	}
	if err := store.db.GetContext(ctx, &visitCount, `SELECT COUNT(*) FROM container_visits WHERE customer_id = ? AND container_no = ?`, customer.ID, containerNo); err != nil {
		t.Fatalf("count container visits: %v", err)
	}
	if receiptCount != 2 || containerCount != 1 || visitCount != 2 {
		t.Fatalf("expected 2 receipts, 1 container, and 2 visits; got receipts=%d containers=%d visits=%d", receiptCount, containerCount, visitCount)
	}

	var balance struct {
		Quantity int `db:"quantity"`
		Pallets  int `db:"pallets"`
	}
	if err := store.db.GetContext(ctx, &balance, `SELECT quantity, pallets FROM inventory_items WHERE customer_id = ? AND container_no = ?`, customer.ID, containerNo); err != nil {
		t.Fatalf("load shared container balance: %v", err)
	}
	if balance.Quantity != 15 || balance.Pallets != 3 {
		t.Fatalf("expected combined balance 15 qty / 3 pallets, got %#v", balance)
	}

	if _, err := store.CancelInboundDocument(ctx, confirmedReceiptIDs[1]); err != nil {
		t.Fatalf("delete latest shared-container receipt: %v", err)
	}
	operationalContainer, err := store.GetOperationalContainerByNo(ctx, customer.ID, containerNo)
	if err != nil {
		t.Fatalf("load shared container after deleting latest receipt: %v", err)
	}
	if operationalContainer.InboundDocumentID != confirmedReceiptIDs[0] {
		t.Fatalf("expected container to inherit prior receipt %d, got %#v", confirmedReceiptIDs[0], operationalContainer)
	}
	if err := store.db.GetContext(ctx, &balance, `SELECT quantity, pallets FROM inventory_items WHERE customer_id = ? AND container_no = ?`, customer.ID, containerNo); err != nil {
		t.Fatalf("load shared container balance after deleting latest receipt: %v", err)
	}
	if balance.Quantity != 10 || balance.Pallets != 2 {
		t.Fatalf("expected prior receipt balance 10 qty / 2 pallets, got %#v", balance)
	}
}

func TestParseInboundBulkImportWorkbookGroupsRowsByContainerAndArrivalDate(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First item", 930, 900, 20, 48, "A", ""},
		{"CONT-A", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-2", "ITEM-2", "Second item", 100, 0, 3, 32, "A", "Inspect wrap"},
		{"CONT-B", "West Warehouse", "2026-07-16", "WEST_COAST_TRANSFER", "SEALED_TRANSIT", "SKU-3", "ITEM-3", "Third item", 250, 0, 0, 0, "TEMP", ""},
	})

	documents, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}
	if len(documents) != 2 {
		t.Fatalf("expected 2 grouped documents, got %d", len(documents))
	}
	first := documents[0].preview
	if first.DocumentKey != "CONT-A @ 2026-07-15" || first.Input.ContainerNo != "CONT-A" || first.LocationName != "WAREHOUSE" {
		t.Fatalf("unexpected first document: %#v", first)
	}
	if first.Input.ActualArrivalDate != "2026-07-15" || first.Input.ExpectedArrivalDate != "" || first.Input.DocumentNote != "" {
		t.Fatalf("expected only actual arrival date at document level: %#v", first.Input)
	}
	if len(first.Input.Lines) != 2 {
		t.Fatalf("expected 2 receipt lines, got %d", len(first.Input.Lines))
	}
	if first.Input.Lines[0].ExpectedQty != 930 || first.Input.Lines[0].ReceivedQty != 900 || first.Input.Lines[0].Pallets != 20 || first.Input.Lines[0].UnitsPerPallet != 48 {
		t.Fatalf("quantity and pallet fields were not preserved independently: %#v", first.Input.Lines[0])
	}
}

func TestParseInboundBulkImportWorkbookCreatesSeparateReceiptsForRepeatedContainer(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"SHYA1120-3608-20260115", "Warehouse", "2026-01-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First receipt", 10, 10, 2, 5, "A", ""},
		{"SHYA1120-3608-20260116", "Warehouse", "2026-01-16", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "Second receipt", 5, 5, 1, 5, "A", ""},
		{"SHYA1120-3608-20260130", "Warehouse", "2026-01-30", "NORMAL", "PALLETIZED", "SKU-2", "ITEM-2", "Third receipt", 8, 8, 1, 8, "A", ""},
	})

	documents, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}
	if len(documents) != 3 {
		t.Fatalf("expected three receipts, got %d", len(documents))
	}
	for _, document := range documents {
		if document.preview.Input.ContainerNo != "SHYA1120-3608" {
			t.Fatalf("expected canonical physical container, got %#v", document.preview)
		}
	}
	if documents[0].preview.DocumentKey == documents[1].preview.DocumentKey || documents[1].preview.DocumentKey == documents[2].preview.DocumentKey {
		t.Fatalf("receipt dates must produce distinct document keys: %#v", documents)
	}
}

func TestParseInboundBulkImportWorkbookRequiresActualArrivalDate(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "Warehouse", "", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First item", 10, 0, 1, 10, "A", ""},
	})

	documents, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}
	if len(documents) != 1 || !hasInboundBulkIssue(documents[0].preview.Issues, "MISSING_ACTUAL_DATE", InboundBulkIssueError) {
		t.Fatalf("expected missing actual arrival date issue: %#v", documents)
	}
}

func TestBuildInboundBulkImportPreviewWarnsWhenReceivedQtyOrPalletsAreBlank(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First item", 10, "", "", 10, "A", ""},
	})
	parsed, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	preview := buildInboundBulkImportPreview(
		"receipts.xlsx",
		Customer{ID: 1, Name: "Customer"},
		[]Location{{ID: 2, Name: "Warehouse", SectionNames: []string{"A"}}},
		[]SKUMaster{{ID: 1, SKU: "SKU-1", ItemNumber: "ITEM-1", Description: "First item", DefaultUnitsPerPallet: 10}},
		map[string]bool{},
		parsed,
	)

	issues := preview.Documents[0].Issues
	if !hasInboundBulkIssue(issues, "MISSING_RECEIVED_QTY", InboundBulkIssueWarning) {
		t.Fatalf("expected blank received quantity warning: %#v", issues)
	}
	if !hasInboundBulkIssue(issues, "MISSING_PALLETS", InboundBulkIssueWarning) {
		t.Fatalf("expected blank pallet count warning: %#v", issues)
	}
	if hasInboundBulkIssue(issues, "ZERO_PALLETS", InboundBulkIssueWarning) {
		t.Fatalf("blank pallets must not also produce the explicit zero warning: %#v", issues)
	}
	if !preview.Documents[0].Valid {
		t.Fatalf("blank quantity warnings should not block draft creation: %#v", issues)
	}
}

func TestParseInboundBulkImportWorkbookDoesNotTreatExplicitZeroAsBlank(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First item", 10, 0, 0, 10, "A", ""},
	})
	documents, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	issues := documents[0].preview.Issues
	if hasInboundBulkIssue(issues, "MISSING_RECEIVED_QTY", InboundBulkIssueWarning) || hasInboundBulkIssue(issues, "MISSING_PALLETS", InboundBulkIssueWarning) {
		t.Fatalf("explicit zero values must remain distinct from blank cells: %#v", issues)
	}
}

func TestParseInboundBulkImportWorkbookDoesNotRequirePalletsForSealedTransit(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "Warehouse", "2026-07-15", "NORMAL", "SEALED_TRANSIT", "SKU-1", "ITEM-1", "First item", 10, 10, "", "", "A", ""},
	})
	documents, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	if hasInboundBulkIssue(documents[0].preview.Issues, "MISSING_PALLETS", InboundBulkIssueWarning) {
		t.Fatalf("sealed-transit receipts do not require a pallet count: %#v", documents[0].preview.Issues)
	}
}

func TestParseInboundBulkImportWorkbookRejectsWarehouseConflictWithinDocument(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "East Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First item", 10, 0, 1, 10, "A", ""},
		{"CONT-A", "West Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-2", "ITEM-2", "Second item", 10, 0, 1, 10, "A", ""},
	})

	documents, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}
	if len(documents) != 1 || !hasInboundBulkIssue(documents[0].preview.Issues, "HEADER_CONFLICT", InboundBulkIssueError) {
		t.Fatalf("expected warehouse header conflict: %#v", documents)
	}
}

func TestBuildInboundBulkImportPreviewKeepsIndependentPalletValuesAndFlagsConflicts(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "", 930, 900, 20, 48, "A", ""},
		{"CONT-B", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-2", "ITEM-1", "Known item", 100, 0, 2, 50, "A", ""},
		{"CONT-B", "Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-3", "ITEM-3", "New item", 40, 0, 1, 40, "A", ""},
	})
	parsed, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	preview := buildInboundBulkImportPreview(
		"receipts.xlsx",
		Customer{ID: 1, Name: "Customer"},
		[]Location{{ID: 2, Name: "Warehouse", SectionNames: []string{"A"}}},
		[]SKUMaster{
			{ID: 1, SKU: "SKU-1", ItemNumber: "ITEM-1", Description: "Known one", DefaultUnitsPerPallet: 48},
			{ID: 2, SKU: "SKU-2", ItemNumber: "ITEM-2", Description: "Known two", DefaultUnitsPerPallet: 50},
		},
		map[string]bool{"CONT-A": true},
		parsed,
	)

	if preview.TotalDocuments != 2 || preview.ValidDocuments != 1 || preview.InvalidDocuments != 1 {
		t.Fatalf("unexpected preview totals: %#v", preview)
	}
	first := preview.Documents[0]
	if !first.Valid {
		t.Fatalf("expected independent quantity/pallet values to remain valid: %#v", first.Issues)
	}
	if first.TotalReceivedQty != 900 || first.TotalPallets != 20 || first.Input.Lines[0].UnitsPerPallet != 48 {
		t.Fatalf("unexpected independent totals: %#v", first)
	}
	if !hasInboundBulkIssue(first.Issues, "EXISTING_CONTAINER", InboundBulkIssueWarning) {
		t.Fatalf("expected existing container warning: %#v", first.Issues)
	}
	if !hasInboundBulkIssue(preview.Documents[1].Issues, "SKU_ITEM_CODE_MISMATCH", InboundBulkIssueError) {
		t.Fatalf("expected SKU/Item Code mismatch error: %#v", preview.Documents[1].Issues)
	}
	itemCodeConflict := findInboundBulkIssue(preview.Documents[1].Issues, "ITEM_CODE_SKU_CONFLICT", InboundBulkIssueError)
	if itemCodeConflict == nil || itemCodeConflict.CurrentSKU != "SKU-2" || itemCodeConflict.CurrentItemCode != "ITEM-1" || itemCodeConflict.ExistingSKU != "SKU-1" {
		t.Fatalf("expected concrete Item Code conflict context: %#v", itemCodeConflict)
	}
	skuMismatch := findInboundBulkIssue(preview.Documents[1].Issues, "SKU_ITEM_CODE_MISMATCH", InboundBulkIssueError)
	if skuMismatch == nil || skuMismatch.CurrentSKU != "SKU-2" || skuMismatch.CurrentItemCode != "ITEM-1" || skuMismatch.ExistingItemCode != "ITEM-2" {
		t.Fatalf("expected concrete SKU mismatch context: %#v", skuMismatch)
	}
}

func TestBuildInboundBulkImportPreviewResolvesMultipleWarehouses(t *testing.T) {
	data := buildInboundBulkImportWorkbook(t, [][]any{
		{"CONT-A", "East Warehouse", "2026-07-15", "NORMAL", "PALLETIZED", "SKU-1", "ITEM-1", "First item", 10, 0, 1, 10, "A", ""},
		{"CONT-B", "West Warehouse", "2026-07-16", "NORMAL", "PALLETIZED", "SKU-2", "ITEM-2", "Second item", 20, 0, 2, 10, "B", ""},
	})
	parsed, err := parseInboundBulkImportWorkbook("receipts.xlsx", data)
	if err != nil {
		t.Fatalf("parse workbook: %v", err)
	}

	preview := buildInboundBulkImportPreview(
		"receipts.xlsx",
		Customer{ID: 1, Name: "Customer"},
		[]Location{
			{ID: 2, Name: "East Warehouse", SectionNames: []string{"A"}},
			{ID: 3, Name: "West Warehouse", SectionNames: []string{"B"}},
		},
		nil,
		map[string]bool{},
		parsed,
	)

	if preview.LocationCount != 2 || preview.ValidDocuments != 2 {
		t.Fatalf("expected two valid warehouses: %#v", preview)
	}
	if preview.Documents[0].Input.LocationID != 2 || preview.Documents[0].LocationName != "East Warehouse" {
		t.Fatalf("unexpected first warehouse resolution: %#v", preview.Documents[0])
	}
	if preview.Documents[1].Input.LocationID != 3 || preview.Documents[1].LocationName != "West Warehouse" {
		t.Fatalf("unexpected second warehouse resolution: %#v", preview.Documents[1])
	}
}

func TestParsedInboundBulkDocumentFromInputPreservesIdentityAndEditedValues(t *testing.T) {
	document := parsedInboundBulkDocumentFromInput(InboundBulkImportRevalidateDocument{
		DocumentKey:  "ORIGINAL-CONTAINER",
		LocationName: "Old warehouse name",
		RowNumbers:   []int{4},
		Input: CreateInboundDocumentInput{
			LocationID:        2,
			ContainerNo:       " edited-container ",
			ActualArrivalDate: "2026-07-01",
			ContainerType:     ContainerTypeNormal,
			HandlingMode:      InboundHandlingModePalletized,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            " sku-edited ",
				Description:    "Edited item",
				ReceivedQty:    12,
				Pallets:        3,
				StorageSection: " a ",
			}},
		},
	}, 0, map[int64]Location{2: {ID: 2, Name: "East Warehouse"}})

	if document.preview.DocumentKey != "ORIGINAL-CONTAINER" {
		t.Fatalf("expected stable preview identity, got %q", document.preview.DocumentKey)
	}
	if document.preview.Input.ContainerNo != "EDITED-CONTAINER" || document.preview.Input.Lines[0].SKU != "SKU-EDITED" {
		t.Fatalf("expected edited values to be normalized: %#v", document.preview.Input)
	}
	if document.preview.LocationName != "East Warehouse" || len(document.preview.Issues) != 0 {
		t.Fatalf("expected selected warehouse and no parsing issues: %#v", document.preview)
	}
}

func buildInboundBulkImportWorkbook(t *testing.T, dataRows [][]any) []byte {
	t.Helper()
	workbook := excelize.NewFile()
	sheet := workbook.GetSheetName(0)
	rows := [][]any{
		{"Inbound Receipt Bulk Import Template"},
		{"Rows with the same Container No are grouped into one receipt"},
		{"Container No", "Warehouse", "Actual Arrival Date", "Container Type", "Handling Mode", "SKU", "Item Code", "Description", "Expected Qty", "Received Qty", "Pallets", "CTN per Pallet", "Storage Section", "Line Note"},
	}
	rows = append(rows, dataRows...)
	for index, row := range rows {
		cell, err := excelize.CoordinatesToCellName(1, index+1)
		if err != nil {
			t.Fatalf("resolve row cell: %v", err)
		}
		if err := workbook.SetSheetRow(sheet, cell, &row); err != nil {
			t.Fatalf("write workbook row: %v", err)
		}
	}
	buffer, err := workbook.WriteToBuffer()
	if err != nil {
		t.Fatalf("write workbook: %v", err)
	}
	if err := workbook.Close(); err != nil {
		t.Fatalf("close workbook: %v", err)
	}
	return buffer.Bytes()
}

func hasInboundBulkIssue(issues []InboundBulkImportIssue, code string, severity string) bool {
	return findInboundBulkIssue(issues, code, severity) != nil
}

func findInboundBulkIssue(issues []InboundBulkImportIssue, code string, severity string) *InboundBulkImportIssue {
	for _, issue := range issues {
		if issue.Code == code && issue.Severity == severity {
			matched := issue
			return &matched
		}
	}
	return nil
}
