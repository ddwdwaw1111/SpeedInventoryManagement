package service

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/xuri/excelize/v2"
)

const (
	MaxOutboundBulkImportFileSize       = 10 << 20
	MaxOutboundBulkImportRequestSize    = MaxOutboundBulkImportFileSize + (1 << 20)
	MaxOutboundBulkImportCommitBodySize = 20 << 20
	MaxOutboundBulkImportRows           = 5000
	MaxOutboundBulkImportDocuments      = 500
)

const (
	outboundBulkPickingOrderNo   = "pickingOrderNo"
	outboundBulkExpectedShipDate = "expectedShipDate"
	outboundBulkActualShipDate   = "actualShipDate"
	outboundBulkShipToName       = "shipToName"
	outboundBulkShipToAddress    = "shipToAddress"
	outboundBulkShipToContact    = "shipToContact"
	outboundBulkWarehouse        = "warehouse"
	outboundBulkSourceContainer  = "sourceContainer"
	outboundBulkStorageSection   = "storageSection"
	outboundBulkSKU              = "sku"
	outboundBulkItemNumber       = "itemNumber"
	outboundBulkQuantity         = "quantity"
	outboundBulkInventoryPallets = "inventoryPallets"
	outboundBulkOutboundPallets  = "outboundPallets"
	outboundBulkLineNote         = "lineNote"
)

type OutboundBulkImportIssue struct {
	Severity  string `json:"severity"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	RowNumber int    `json:"rowNumber,omitempty"`
	Field     string `json:"field,omitempty"`
	Value     string `json:"value,omitempty"`
}

type OutboundBulkImportLinePreview struct {
	RowNumber        int    `json:"rowNumber"`
	Warehouse        string `json:"warehouse"`
	SourceContainer  string `json:"sourceContainer"`
	StorageSection   string `json:"storageSection"`
	SKU              string `json:"sku"`
	ItemNumber       string `json:"itemNumber"`
	Quantity         int    `json:"quantity"`
	InventoryPallets int    `json:"inventoryPallets"` // Pallets deducted from the selected container inventory.
	OutboundPallets  int    `json:"outboundPallets"`  // Pallets after repalletization, persisted on the shipment line.
	LineNote         string `json:"lineNote"`
}

type OutboundBulkImportDocumentPreview struct {
	DocumentKey           string                          `json:"documentKey"`
	PickingOrderNo        string                          `json:"pickingOrderNo"`
	ExpectedShipDate      string                          `json:"expectedShipDate"`
	ActualShipDate        string                          `json:"actualShipDate"`
	ShipToName            string                          `json:"shipToName"`
	ShipToAddress         string                          `json:"shipToAddress"`
	ShipToContact         string                          `json:"shipToContact"`
	RowNumbers            []int                           `json:"rowNumbers"`
	Lines                 []OutboundBulkImportLinePreview `json:"lines"`
	Input                 CreateOutboundDocumentInput     `json:"input"`
	Issues                []OutboundBulkImportIssue       `json:"issues"`
	Valid                 bool                            `json:"valid"`
	TotalLines            int                             `json:"totalLines"`
	TotalQty              int                             `json:"totalQty"`
	TotalInventoryPallets int                             `json:"totalInventoryPallets"`
	TotalOutboundPallets  int                             `json:"totalOutboundPallets"`
}

type OutboundBulkImportPreview struct {
	ImportID         string                              `json:"importId"`
	SourceFileName   string                              `json:"sourceFileName"`
	CustomerID       int64                               `json:"customerId"`
	CustomerName     string                              `json:"customerName"`
	LocationCount    int                                 `json:"locationCount"`
	TotalDocuments   int                                 `json:"totalDocuments"`
	ValidDocuments   int                                 `json:"validDocuments"`
	InvalidDocuments int                                 `json:"invalidDocuments"`
	TotalLines       int                                 `json:"totalLines"`
	Documents        []OutboundBulkImportDocumentPreview `json:"documents"`
}

type OutboundBulkImportRevalidateInput struct {
	ImportID       string                              `json:"importId"`
	SourceFileName string                              `json:"sourceFileName"`
	CustomerID     int64                               `json:"customerId"`
	Documents      []OutboundBulkImportDocumentPreview `json:"documents"`
}

type OutboundBulkImportCommitDocument struct {
	DocumentKey string                      `json:"documentKey"`
	Input       CreateOutboundDocumentInput `json:"input"`
}

type OutboundBulkImportCommitInput struct {
	ImportID       string                             `json:"importId"`
	SourceFileName string                             `json:"sourceFileName"`
	CustomerID     int64                              `json:"customerId"`
	Documents      []OutboundBulkImportCommitDocument `json:"documents"`
}

type OutboundBulkImportCommitResult struct {
	DocumentKey    string            `json:"documentKey"`
	PickingOrderNo string            `json:"pickingOrderNo"`
	Success        bool              `json:"success"`
	Document       *OutboundDocument `json:"document,omitempty"`
	Error          string            `json:"error,omitempty"`
}

type OutboundBulkImportCommitResponse struct {
	SourceFileName   string                           `json:"sourceFileName"`
	TotalDocuments   int                              `json:"totalDocuments"`
	CreatedDocuments int                              `json:"createdDocuments"`
	FailedDocuments  int                              `json:"failedDocuments"`
	Results          []OutboundBulkImportCommitResult `json:"results"`
}

func (s *Store) PreviewOutboundBulkImport(ctx context.Context, fileName string, data []byte, customerID int64) (OutboundBulkImportPreview, error) {
	if customerID <= 0 {
		return OutboundBulkImportPreview{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if len(data) == 0 || len(data) > MaxOutboundBulkImportFileSize {
		return OutboundBulkImportPreview{}, fmt.Errorf("%w: Excel file must be between 1 byte and 10 MB", ErrInvalidInput)
	}
	if strings.ToLower(filepath.Ext(fileName)) != ".xlsx" {
		return OutboundBulkImportPreview{}, fmt.Errorf("%w: only .xlsx files are supported", ErrInvalidInput)
	}
	documents, err := parseOutboundBulkImportWorkbook(data)
	if err != nil {
		return OutboundBulkImportPreview{}, fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
	}
	preview, err := s.buildOutboundBulkImportPreview(ctx, fileName, customerID, documents)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	preview.ImportID, err = newInboundBulkImportID()
	return preview, err
}

func (s *Store) RevalidateOutboundBulkImport(ctx context.Context, input OutboundBulkImportRevalidateInput) (OutboundBulkImportPreview, error) {
	importID, err := normalizeInboundBulkImportID(input.ImportID)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	if input.CustomerID <= 0 || len(input.Documents) == 0 || len(input.Documents) > MaxOutboundBulkImportDocuments {
		return OutboundBulkImportPreview{}, fmt.Errorf("%w: customer and 1-%d shipments are required", ErrInvalidInput, MaxOutboundBulkImportDocuments)
	}
	totalLines := 0
	documents := make([]OutboundBulkImportDocumentPreview, 0, len(input.Documents))
	seenDocumentKeys := make(map[string]bool, len(input.Documents))
	for index, document := range input.Documents {
		document.DocumentKey = strings.TrimSpace(document.DocumentKey)
		if document.DocumentKey == "" || seenDocumentKeys[document.DocumentKey] {
			baseKey := fmt.Sprintf("DOCUMENT-%d", index+1)
			document.DocumentKey = baseKey
			for suffix := 2; seenDocumentKeys[document.DocumentKey]; suffix++ {
				document.DocumentKey = fmt.Sprintf("%s-%d", baseKey, suffix)
			}
		}
		seenDocumentKeys[document.DocumentKey] = true
		document.Issues = nil
		document.Input = CreateOutboundDocumentInput{}
		document.Valid = false
		document.TotalLines = 0
		document.TotalQty = 0
		document.TotalInventoryPallets = 0
		document.TotalOutboundPallets = 0
		for lineIndex := range document.Lines {
			line := &document.Lines[lineIndex]
			if line.RowNumber <= 0 {
				line.RowNumber = lineIndex + 2
			}
			if !containsInt(document.RowNumbers, line.RowNumber) {
				document.RowNumbers = append(document.RowNumbers, line.RowNumber)
			}
		}
		totalLines += len(document.Lines)
		if totalLines > MaxOutboundBulkImportRows {
			return OutboundBulkImportPreview{}, fmt.Errorf("%w: no more than %d shipment lines can be imported", ErrInvalidInput, MaxOutboundBulkImportRows)
		}
		documents = append(documents, document)
	}
	preview, err := s.buildOutboundBulkImportPreview(ctx, input.SourceFileName, input.CustomerID, documents)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	preview.ImportID = importID
	return preview, nil
}

func (s *Store) CreateOutboundDocumentsBulkDraft(ctx context.Context, input OutboundBulkImportCommitInput) (OutboundBulkImportCommitResponse, error) {
	if _, err := normalizeInboundBulkImportID(input.ImportID); err != nil {
		return OutboundBulkImportCommitResponse{}, err
	}
	if input.CustomerID <= 0 || len(input.Documents) == 0 || len(input.Documents) > MaxOutboundBulkImportDocuments {
		return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: customer and 1-%d valid shipments are required", ErrInvalidInput, MaxOutboundBulkImportDocuments)
	}
	totalLines := 0
	for _, document := range input.Documents {
		totalLines += len(document.Input.Lines)
		if totalLines > MaxOutboundBulkImportRows {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: no more than %d shipment lines can be imported", ErrInvalidInput, MaxOutboundBulkImportRows)
		}
	}
	// Serialize the existence check and create sequence so concurrent bulk
	// commits cannot both create the same customer/Picking Order draft.
	s.outboundBulkImportMu.Lock()
	defer s.outboundBulkImportMu.Unlock()

	response := OutboundBulkImportCommitResponse{
		SourceFileName: strings.TrimSpace(filepath.Base(input.SourceFileName)),
		TotalDocuments: len(input.Documents),
		Results:        make([]OutboundBulkImportCommitResult, 0, len(input.Documents)),
	}
	seen := make(map[string]bool)
	for index, entry := range input.Documents {
		pickingOrderNo := strings.TrimSpace(strings.ToUpper(entry.Input.PackingListNo))
		result := OutboundBulkImportCommitResult{DocumentKey: entry.DocumentKey, PickingOrderNo: pickingOrderNo}
		if pickingOrderNo == "" {
			result.Error = "Picking Order No is required"
		} else if seen[pickingOrderNo] {
			result.Error = "duplicate Picking Order No in import request"
		} else if exists, err := s.outboundPickingOrderExists(ctx, input.CustomerID, pickingOrderNo); err != nil {
			return OutboundBulkImportCommitResponse{}, err
		} else if exists {
			result.Error = "Picking Order No already exists"
		}
		seen[pickingOrderNo] = true
		if result.Error == "" {
			documentInput := entry.Input
			documentInput.PackingListNo = pickingOrderNo
			documentInput.OrderRef = ""
			documentInput.CarrierName = ""
			documentInput.Status = DocumentStatusDraft
			documentInput.TrackingStatus = OutboundTrackingScheduled
			for lineIndex := range documentInput.Lines {
				documentInput.Lines[lineIndex].CustomerID = input.CustomerID
				documentInput.Lines[lineIndex].PalletsDetailCtns = ""
			}
			if len(documentInput.Lines) == 0 {
				result.Error = "at least one outbound line is required"
			} else if document, err := s.CreateOutboundDocument(ctx, documentInput); err != nil {
				result.Error = err.Error()
			} else {
				result.Success = true
				result.Document = &document
				response.CreatedDocuments++
			}
		}
		if !result.Success {
			response.FailedDocuments++
		}
		if result.DocumentKey == "" {
			result.DocumentKey = fmt.Sprintf("DOCUMENT-%d", index+1)
		}
		response.Results = append(response.Results, result)
	}
	return response, nil
}

func parseOutboundBulkImportWorkbook(data []byte) ([]OutboundBulkImportDocumentPreview, error) {
	workbook, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("open Excel workbook: %w", err)
	}
	defer workbook.Close()
	sheets := workbook.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("the workbook has no worksheets")
	}
	rows, err := workbook.GetRows(sheets[0])
	if err != nil {
		return nil, fmt.Errorf("read worksheet: %w", err)
	}
	headerRow, columns, err := findOutboundBulkHeader(rows)
	if err != nil {
		return nil, err
	}
	documents := make([]OutboundBulkImportDocumentPreview, 0)
	indexes := make(map[string]int)
	for rowIndex := headerRow + 1; rowIndex < len(rows); rowIndex++ {
		row := rows[rowIndex]
		if inboundBulkRowIsEmpty(row) {
			continue
		}
		if rowIndex-headerRow > MaxOutboundBulkImportRows {
			return nil, fmt.Errorf("the workbook exceeds the import limits")
		}
		rowNumber := rowIndex + 1
		pickingOrderNo := strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, outboundBulkPickingOrderNo)))
		groupKey := pickingOrderNo
		if groupKey == "" {
			groupKey = fmt.Sprintf("ROW-%d", rowNumber)
		}
		index, exists := indexes[groupKey]
		if !exists {
			if len(documents) >= MaxOutboundBulkImportDocuments {
				return nil, fmt.Errorf("the workbook exceeds the %d shipment limit", MaxOutboundBulkImportDocuments)
			}
			document := OutboundBulkImportDocumentPreview{
				DocumentKey:    fmt.Sprintf("ROW-%d", rowNumber),
				PickingOrderNo: pickingOrderNo,
				ShipToName:     strings.TrimSpace(inboundBulkColumnValue(row, columns, outboundBulkShipToName)),
				ShipToAddress:  strings.TrimSpace(inboundBulkColumnValue(row, columns, outboundBulkShipToAddress)),
				ShipToContact:  strings.TrimSpace(inboundBulkColumnValue(row, columns, outboundBulkShipToContact)),
				RowNumbers:     []int{rowNumber}, Lines: make([]OutboundBulkImportLinePreview, 0), Issues: make([]OutboundBulkImportIssue, 0),
			}
			document.ExpectedShipDate, _ = normalizeInboundBulkDate(inboundBulkColumnValue(row, columns, outboundBulkExpectedShipDate))
			document.ActualShipDate, _ = normalizeInboundBulkDate(inboundBulkColumnValue(row, columns, outboundBulkActualShipDate))
			documents = append(documents, document)
			index = len(documents) - 1
			indexes[groupKey] = index
		} else {
			documents[index].RowNumbers = append(documents[index].RowNumbers, rowNumber)
			validateOutboundBulkHeaderConsistency(&documents[index], row, rowNumber, columns)
		}
		document := &documents[index]
		if pickingOrderNo == "" {
			document.Issues = append(document.Issues, outboundBulkIssue("MISSING_PICKING_ORDER", "Picking Order No is required.", rowNumber, outboundBulkPickingOrderNo, ""))
		}
		dateValue := inboundBulkColumnValue(row, columns, outboundBulkActualShipDate)
		if _, valid := normalizeInboundBulkDate(dateValue); !valid {
			document.Issues = append(document.Issues, outboundBulkIssue("INVALID_SHIP_DATE", "Actual Ship Date must use YYYY-MM-DD.", rowNumber, outboundBulkActualShipDate, dateValue))
		}
		expectedDateValue := inboundBulkColumnValue(row, columns, outboundBulkExpectedShipDate)
		if _, valid := normalizeInboundBulkDate(expectedDateValue); !valid {
			document.Issues = append(document.Issues, outboundBulkIssue("INVALID_EXPECTED_SHIP_DATE", "Expected Ship Date must use YYYY-MM-DD.", rowNumber, outboundBulkExpectedShipDate, expectedDateValue))
		}
		line, issues := parseOutboundBulkLine(row, rowNumber, columns)
		document.Lines = append(document.Lines, line)
		document.Issues = append(document.Issues, issues...)
	}
	if len(documents) == 0 {
		return nil, fmt.Errorf("no importable shipment rows were found")
	}
	return documents, nil
}

func findOutboundBulkHeader(rows [][]string) (int, map[string]int, error) {
	required := []string{outboundBulkPickingOrderNo, outboundBulkWarehouse, outboundBulkSKU, outboundBulkQuantity, outboundBulkInventoryPallets, outboundBulkOutboundPallets}
	for rowIndex := 0; rowIndex < len(rows) && rowIndex < 20; rowIndex++ {
		columns := make(map[string]int)
		for columnIndex, value := range rows[rowIndex] {
			if field := canonicalOutboundBulkHeader(value); field != "" {
				columns[field] = columnIndex
			}
		}
		complete := true
		for _, field := range required {
			if _, exists := columns[field]; !exists {
				complete = false
			}
		}
		if complete {
			return rowIndex, columns, nil
		}
	}
	return -1, nil, fmt.Errorf("could not find the standard header row; download the latest outbound template")
}

func canonicalOutboundBulkHeader(value string) string {
	aliases := map[string]string{
		"PICKINGORDERNO": outboundBulkPickingOrderNo, "PICKINGORDERNUMBER": outboundBulkPickingOrderNo,
		"EXPECTEDSHIPDATE": outboundBulkExpectedShipDate,
		"ACTUALSHIPDATE":   outboundBulkActualShipDate, "SHIPDATE": outboundBulkActualShipDate,
		"SHIPTONAME": outboundBulkShipToName, "SHIPTOADDRESS": outboundBulkShipToAddress,
		"SHIPTOCONTACT": outboundBulkShipToContact,
		"WAREHOUSE":     outboundBulkWarehouse, "LOCATION": outboundBulkWarehouse,
		"SOURCECONTAINER": outboundBulkSourceContainer, "CONTAINERNO": outboundBulkSourceContainer,
		"STORAGESECTION": outboundBulkStorageSection, "SECTION": outboundBulkStorageSection,
		"SKU": outboundBulkSKU, "ITEMCODE": outboundBulkItemNumber, "ITEMNUMBER": outboundBulkItemNumber,
		"QTY": outboundBulkQuantity, "QUANTITY": outboundBulkQuantity,
		"INVENTORYPALLETS": outboundBulkInventoryPallets, "INVENTORYPALLETCOUNT": outboundBulkInventoryPallets,
		"OUTBOUNDPALLETS": outboundBulkOutboundPallets, "OUTBOUNDPALLETCOUNT": outboundBulkOutboundPallets,
		"LINENOTE": outboundBulkLineNote,
	}
	return aliases[normalizeInboundBulkHeader(value)]
}

func parseOutboundBulkLine(row []string, rowNumber int, columns map[string]int) (OutboundBulkImportLinePreview, []OutboundBulkImportIssue) {
	line := OutboundBulkImportLinePreview{
		RowNumber:       rowNumber,
		Warehouse:       strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, outboundBulkWarehouse))),
		SourceContainer: strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, outboundBulkSourceContainer))),
		StorageSection:  strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, outboundBulkStorageSection))),
		SKU:             strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, outboundBulkSKU))),
		ItemNumber:      strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, outboundBulkItemNumber))),
		LineNote:        strings.TrimSpace(inboundBulkColumnValue(row, columns, outboundBulkLineNote)),
	}
	issues := make([]OutboundBulkImportIssue, 0)
	var valid bool
	line.Quantity, valid = parseInboundBulkNonNegativeInt(inboundBulkColumnValue(row, columns, outboundBulkQuantity))
	if !valid || line.Quantity <= 0 {
		issues = append(issues, outboundBulkIssue("INVALID_QUANTITY", "Qty must be a positive whole number.", rowNumber, outboundBulkQuantity, inboundBulkColumnValue(row, columns, outboundBulkQuantity)))
	}
	inventoryPalletsValue := inboundBulkColumnValue(row, columns, outboundBulkInventoryPallets)
	line.InventoryPallets, valid = parseInboundBulkNonNegativeInt(inventoryPalletsValue)
	if inventoryPalletsValue == "" || !valid {
		issues = append(issues, outboundBulkIssue("INVALID_INVENTORY_PALLETS", "Inventory Pallets must be a non-negative whole number.", rowNumber, outboundBulkInventoryPallets, inboundBulkColumnValue(row, columns, outboundBulkInventoryPallets)))
	}
	outboundPalletsValue := inboundBulkColumnValue(row, columns, outboundBulkOutboundPallets)
	line.OutboundPallets, valid = parseInboundBulkNonNegativeInt(outboundPalletsValue)
	if outboundPalletsValue == "" || !valid {
		issues = append(issues, outboundBulkIssue("INVALID_OUTBOUND_PALLETS", "Outbound Pallets must be a non-negative whole number.", rowNumber, outboundBulkOutboundPallets, inboundBulkColumnValue(row, columns, outboundBulkOutboundPallets)))
	}
	return line, issues
}

func validateOutboundBulkHeaderConsistency(document *OutboundBulkImportDocumentPreview, row []string, rowNumber int, columns map[string]int) {
	values := []struct {
		field   string
		current *string
	}{
		{outboundBulkShipToName, &document.ShipToName},
		{outboundBulkShipToAddress, &document.ShipToAddress}, {outboundBulkShipToContact, &document.ShipToContact},
	}
	for _, value := range values {
		next := strings.TrimSpace(inboundBulkColumnValue(row, columns, value.field))
		if next == "" {
			continue
		}
		if *value.current == "" {
			*value.current = next
			continue
		}
		if next != *value.current {
			document.Issues = append(document.Issues, outboundBulkIssue("HEADER_CONFLICT", "Rows in the same Picking Order have conflicting document values.", rowNumber, value.field, next))
		}
	}
	dates := []struct {
		field   string
		label   string
		current *string
	}{
		{outboundBulkActualShipDate, "Actual Ship Date", &document.ActualShipDate},
		{outboundBulkExpectedShipDate, "Expected Ship Date", &document.ExpectedShipDate},
	}
	for _, date := range dates {
		raw := inboundBulkColumnValue(row, columns, date.field)
		if strings.TrimSpace(raw) == "" {
			continue
		}
		next, valid := normalizeInboundBulkDate(raw)
		if !valid {
			continue
		}
		if *date.current == "" {
			*date.current = next
			continue
		}
		if next != *date.current {
			document.Issues = append(document.Issues, outboundBulkIssue("HEADER_CONFLICT", fmt.Sprintf("Rows in the same Picking Order have conflicting %s values.", date.label), rowNumber, date.field, next))
		}
	}
}

func (s *Store) buildOutboundBulkImportPreview(ctx context.Context, fileName string, customerID int64, documents []OutboundBulkImportDocumentPreview) (OutboundBulkImportPreview, error) {
	customer, err := s.getCustomer(ctx, customerID)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	locations, err := s.ListLocations(ctx)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	masters, err := s.ListSKUMasters(ctx, "", customerID)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	items, err := s.ListItems(ctx, ItemFilters{CustomerID: customerID})
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}

	locationsByName := make(map[string]Location)
	for _, location := range locations {
		locationsByName[normalizeOutboundBulkValue(location.Name)] = location
	}
	mastersBySKU := make(map[string]SKUMaster)
	for _, master := range masters {
		mastersBySKU[normalizeOutboundBulkValue(master.SKU)] = master
	}
	remaining, remainingPallets := initializeOutboundBulkBalances(items)
	usedLocations := make(map[int64]bool)
	preview := OutboundBulkImportPreview{SourceFileName: strings.TrimSpace(filepath.Base(fileName)), CustomerID: customerID, CustomerName: customer.Name, Documents: make([]OutboundBulkImportDocumentPreview, 0, len(documents))}
	pickingOrderCounts := make(map[string]int)
	for _, document := range documents {
		if key := normalizeOutboundBulkValue(document.PickingOrderNo); key != "" {
			pickingOrderCounts[key]++
		}
	}

	for documentIndex := range documents {
		document := documents[documentIndex]
		document.PickingOrderNo = strings.TrimSpace(strings.ToUpper(document.PickingOrderNo))
		if document.PickingOrderNo == "" {
			document.Issues = append(document.Issues, outboundBulkIssue("MISSING_PICKING_ORDER", "Picking Order No is required.", firstInboundBulkRowNumber(document.RowNumbers), outboundBulkPickingOrderNo, ""))
		} else if pickingOrderCounts[document.PickingOrderNo] > 1 {
			document.Issues = append(document.Issues, outboundBulkIssue("DUPLICATE_PICKING_ORDER_IN_IMPORT", "Picking Order No is used by more than one edited shipment.", firstInboundBulkRowNumber(document.RowNumbers), outboundBulkPickingOrderNo, document.PickingOrderNo))
		}
		if exists, lookupErr := s.outboundPickingOrderExists(ctx, customerID, document.PickingOrderNo); lookupErr != nil {
			return OutboundBulkImportPreview{}, lookupErr
		} else if exists {
			document.Issues = append(document.Issues, outboundBulkIssue("DUPLICATE_PICKING_ORDER", "Picking Order No already exists.", firstInboundBulkRowNumber(document.RowNumbers), outboundBulkPickingOrderNo, document.PickingOrderNo))
		}
		if normalized, valid := normalizeInboundBulkDate(document.ActualShipDate); !valid {
			document.Issues = append(document.Issues, outboundBulkIssue("INVALID_SHIP_DATE", "Actual Ship Date must use YYYY-MM-DD.", firstInboundBulkRowNumber(document.RowNumbers), outboundBulkActualShipDate, document.ActualShipDate))
		} else {
			document.ActualShipDate = normalized
		}
		if normalized, valid := normalizeInboundBulkDate(document.ExpectedShipDate); !valid {
			document.Issues = append(document.Issues, outboundBulkIssue("INVALID_EXPECTED_SHIP_DATE", "Expected Ship Date must use YYYY-MM-DD.", firstInboundBulkRowNumber(document.RowNumbers), outboundBulkExpectedShipDate, document.ExpectedShipDate))
		} else {
			document.ExpectedShipDate = normalized
		}
		document.Input = CreateOutboundDocumentInput{
			PackingListNo: document.PickingOrderNo, ExpectedShipDate: document.ExpectedShipDate, ActualShipDate: document.ActualShipDate,
			ShipToName: strings.TrimSpace(document.ShipToName), ShipToAddress: strings.TrimSpace(document.ShipToAddress),
			ShipToContact: strings.TrimSpace(document.ShipToContact),
			Status:        DocumentStatusDraft, TrackingStatus: OutboundTrackingScheduled, Lines: make([]CreateOutboundDocumentLineInput, 0, len(document.Lines)),
		}
		documentRemaining := make(map[int64]int, len(remaining))
		for itemID, quantity := range remaining {
			documentRemaining[itemID] = quantity
		}
		documentRemainingPallets := make(map[int64]int, len(remainingPallets))
		for itemID, pallets := range remainingPallets {
			documentRemainingPallets[itemID] = pallets
		}
		for lineIndex := range document.Lines {
			line := &document.Lines[lineIndex]
			line.Warehouse = strings.TrimSpace(strings.ToUpper(line.Warehouse))
			line.SourceContainer = strings.TrimSpace(strings.ToUpper(line.SourceContainer))
			line.StorageSection = strings.TrimSpace(strings.ToUpper(line.StorageSection))
			line.SKU = strings.TrimSpace(strings.ToUpper(line.SKU))
			line.ItemNumber = strings.TrimSpace(strings.ToUpper(line.ItemNumber))
			if line.Quantity <= 0 {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_QUANTITY", "Qty must be greater than zero.", line.RowNumber, outboundBulkQuantity, fmt.Sprint(line.Quantity)))
			}
			if line.InventoryPallets < 0 {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_INVENTORY_PALLETS", "Inventory Pallets cannot be negative.", line.RowNumber, outboundBulkInventoryPallets, fmt.Sprint(line.InventoryPallets)))
			}
			if line.OutboundPallets < 0 {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_OUTBOUND_PALLETS", "Outbound Pallets cannot be negative.", line.RowNumber, outboundBulkOutboundPallets, fmt.Sprint(line.OutboundPallets)))
			}
			location, locationExists := locationsByName[normalizeOutboundBulkValue(line.Warehouse)]
			if !locationExists {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_WAREHOUSE", "Warehouse does not exist.", line.RowNumber, outboundBulkWarehouse, line.Warehouse))
				continue
			}
			usedLocations[location.ID] = true
			master, issueCode, issueMessage := resolveOutboundBulkMaster(*line, mastersBySKU)
			if issueCode != "" {
				document.Issues = append(document.Issues, outboundBulkIssue(issueCode, issueMessage, line.RowNumber, outboundBulkSKU, line.SKU))
				continue
			}
			line.SKU = master.SKU
			if line.ItemNumber == "" {
				line.ItemNumber = master.ItemNumber
			}
			candidates := make([]Item, 0)
			for _, item := range items {
				if item.LocationID != location.ID || item.SKUMasterID != master.ID || documentRemaining[item.ID] <= 0 {
					continue
				}
				if line.SourceContainer != "" && normalizeOutboundBulkValue(item.ContainerNo) != normalizeOutboundBulkValue(line.SourceContainer) {
					continue
				}
				if line.StorageSection != "" && normalizeOutboundBulkValue(item.StorageSection) != normalizeOutboundBulkValue(line.StorageSection) {
					continue
				}
				candidates = append(candidates, item)
			}
			sortOutboundBulkCandidates(candidates)
			selectedAllocations, stockAvailable, palletsAvailable := selectOutboundBulkAllocations(
				candidates,
				line.Quantity,
				line.InventoryPallets,
				documentRemaining,
				documentRemainingPallets,
			)
			if !stockAvailable {
				document.Issues = append(document.Issues, outboundBulkIssue("INSUFFICIENT_STOCK", "Available stock is insufficient for this row and earlier rows in the workbook.", line.RowNumber, outboundBulkQuantity, fmt.Sprint(line.Quantity)))
				continue
			}
			if !palletsAvailable {
				document.Issues = append(document.Issues, outboundBulkIssue("INSUFFICIENT_INVENTORY_PALLETS", "Available inventory pallets are insufficient for this row and earlier rows in the workbook.", line.RowNumber, outboundBulkInventoryPallets, fmt.Sprint(line.InventoryPallets)))
				continue
			}
			allocations, palletsAvailable := assignOutboundBulkInventoryPallets(selectedAllocations, line.InventoryPallets, documentRemainingPallets)
			if !palletsAvailable {
				document.Issues = append(document.Issues, outboundBulkIssue("INSUFFICIENT_INVENTORY_PALLETS", "Available inventory pallets are insufficient for this row and earlier rows in the workbook.", line.RowNumber, outboundBulkInventoryPallets, fmt.Sprint(line.InventoryPallets)))
				continue
			}
			document.Input.Lines = append(document.Input.Lines, CreateOutboundDocumentLineInput{CustomerID: customerID, LocationID: location.ID, SKUMasterID: master.ID, Quantity: line.Quantity, Pallets: line.OutboundPallets, UnitLabel: firstNonEmpty(master.Unit, "PCS"), LineNote: strings.TrimSpace(line.LineNote), PickAllocations: allocations})
			document.TotalQty += line.Quantity
			document.TotalInventoryPallets += line.InventoryPallets
			document.TotalOutboundPallets += line.OutboundPallets
		}
		document.TotalLines = len(document.Lines)
		document.Valid = !outboundBulkHasErrors(document.Issues) && len(document.Input.Lines) == len(document.Lines) && len(document.Lines) > 0
		if document.Valid {
			remaining = documentRemaining
			remainingPallets = documentRemainingPallets
		}
		preview.TotalLines += document.TotalLines
		if document.Valid {
			preview.ValidDocuments++
		} else {
			preview.InvalidDocuments++
		}
		preview.Documents = append(preview.Documents, document)
	}
	preview.TotalDocuments = len(preview.Documents)
	preview.LocationCount = len(usedLocations)
	return preview, nil
}

func initializeOutboundBulkBalances(items []Item) (map[int64]int, map[int64]int) {
	remainingQty := make(map[int64]int, len(items))
	remainingPallets := make(map[int64]int, len(items))
	for _, item := range items {
		remainingQty[item.ID] = maxInt(item.AvailableQty, 0)
		remainingPallets[item.ID] = maxInt(item.AvailablePallets, 0)
	}
	return remainingQty, remainingPallets
}

func resolveOutboundBulkMaster(
	line OutboundBulkImportLinePreview,
	mastersBySKU map[string]SKUMaster,
) (SKUMaster, string, string) {
	sku := normalizeOutboundBulkValue(line.SKU)
	skuMaster, skuExists := mastersBySKU[sku]
	if skuExists {
		return skuMaster, "", ""
	}
	if sku == "" {
		return SKUMaster{}, "INVALID_SKU", "SKU is required; Item Code is reference-only."
	}
	return SKUMaster{}, "INVALID_SKU", "SKU does not exist for this customer."
}

type outboundBulkSelectedAllocation struct {
	ItemID     int64
	Allocation OutboundPickAllocation
}

func selectOutboundBulkAllocations(
	candidates []Item,
	requestedQty int,
	requestedPallets int,
	remainingQtyByItemID map[int64]int,
	remainingPalletsByItemID map[int64]int,
) ([]outboundBulkSelectedAllocation, bool, bool) {
	if requestedQty <= 0 {
		return nil, true, requestedPallets == 0
	}

	totalQty := 0
	for _, item := range candidates {
		totalQty += maxInt(remainingQtyByItemID[item.ID], 0)
	}
	if totalQty < requestedQty {
		return nil, false, false
	}

	type palletSource struct {
		candidateIndex int
		available      int
	}
	palletSources := make([]palletSource, 0, len(candidates))
	for index, item := range candidates {
		palletSources = append(palletSources, palletSource{
			candidateIndex: index,
			available:      maxInt(remainingPalletsByItemID[item.ID], 0),
		})
	}
	sort.SliceStable(palletSources, func(i, j int) bool {
		return palletSources[i].available > palletSources[j].available
	})

	maxPalletSources := min(requestedQty, len(palletSources))
	availableFromSelectableSources := 0
	for index := 0; index < maxPalletSources; index++ {
		availableFromSelectableSources += palletSources[index].available
	}
	if requestedPallets < 0 || requestedPallets > availableFromSelectableSources {
		return nil, true, false
	}

	selectedQty := make([]int, len(candidates))
	coveredPallets := 0
	for index := 0; index < maxPalletSources && coveredPallets < requestedPallets; index++ {
		source := palletSources[index]
		if source.available <= 0 {
			continue
		}
		selectedQty[source.candidateIndex] = 1
		coveredPallets += source.available
	}

	remainingRequestedQty := requestedQty
	for _, quantity := range selectedQty {
		remainingRequestedQty -= quantity
	}
	for index, item := range candidates {
		if remainingRequestedQty == 0 {
			break
		}
		available := maxInt(remainingQtyByItemID[item.ID]-selectedQty[index], 0)
		assigned := min(available, remainingRequestedQty)
		selectedQty[index] += assigned
		remainingRequestedQty -= assigned
	}
	if remainingRequestedQty > 0 {
		return nil, false, false
	}

	selected := make([]outboundBulkSelectedAllocation, 0, len(candidates))
	for index, item := range candidates {
		quantity := selectedQty[index]
		if quantity <= 0 {
			continue
		}
		remainingQtyByItemID[item.ID] -= quantity
		selected = append(selected, outboundBulkSelectedAllocation{
			ItemID: item.ID,
			Allocation: OutboundPickAllocation{
				ItemNumber: item.ItemNumber, LocationID: item.LocationID, LocationName: item.LocationName,
				StorageSection: fallbackSection(item.StorageSection), ContainerNo: item.ContainerNo, AllocatedQty: quantity,
			},
		})
	}
	return selected, true, true
}

func assignOutboundBulkInventoryPallets(
	selected []outboundBulkSelectedAllocation,
	requestedPallets int,
	remainingByItemID map[int64]int,
) ([]OutboundPickAllocation, bool) {
	allocations := make([]OutboundPickAllocation, len(selected))
	availablePallets := 0
	for index, selectedAllocation := range selected {
		allocations[index] = selectedAllocation.Allocation
		availablePallets += maxInt(remainingByItemID[selectedAllocation.ItemID], 0)
	}
	if requestedPallets < 0 || requestedPallets > availablePallets {
		return allocations, false
	}

	remainingRequested := requestedPallets
	for index, selectedAllocation := range selected {
		if remainingRequested == 0 {
			break
		}
		available := maxInt(remainingByItemID[selectedAllocation.ItemID], 0)
		assigned := available
		if assigned > remainingRequested {
			assigned = remainingRequested
		}
		allocations[index].Pallets = assigned
		remainingByItemID[selectedAllocation.ItemID] = available - assigned
		remainingRequested -= assigned
	}
	return allocations, remainingRequested == 0
}

func sortOutboundBulkCandidates(candidates []Item) {
	sort.SliceStable(candidates, func(i, j int) bool {
		leftSortAt := candidates[i].CreatedAt
		if candidates[i].DeliveryDate != nil {
			leftSortAt = *candidates[i].DeliveryDate
		}
		rightSortAt := candidates[j].CreatedAt
		if candidates[j].DeliveryDate != nil {
			rightSortAt = *candidates[j].DeliveryDate
		}
		if !leftSortAt.Equal(rightSortAt) {
			return leftSortAt.Before(rightSortAt)
		}
		if candidates[i].LocationName != candidates[j].LocationName {
			return candidates[i].LocationName < candidates[j].LocationName
		}
		if fallbackSection(candidates[i].StorageSection) != fallbackSection(candidates[j].StorageSection) {
			return fallbackSection(candidates[i].StorageSection) < fallbackSection(candidates[j].StorageSection)
		}
		if candidates[i].ContainerNo != candidates[j].ContainerNo {
			return candidates[i].ContainerNo < candidates[j].ContainerNo
		}
		return candidates[i].ID < candidates[j].ID
	})
}

func (s *Store) outboundPickingOrderExists(ctx context.Context, customerID int64, pickingOrderNo string) (bool, error) {
	if customerID <= 0 || strings.TrimSpace(pickingOrderNo) == "" {
		return false, nil
	}
	var count int
	// packing_list_no remains the compatibility storage column for the
	// user-facing Picking Order No.; no schema migration is required.
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbound_documents WHERE customer_id = ? AND cancelled_at IS NULL AND archived_at IS NULL AND UPPER(TRIM(COALESCE(packing_list_no, ''))) = UPPER(TRIM(?))`, customerID, pickingOrderNo).Scan(&count); err != nil {
		return false, fmt.Errorf("check outbound picking order: %w", err)
	}
	return count > 0, nil
}

func outboundBulkIssue(code, message string, rowNumber int, field, value string) OutboundBulkImportIssue {
	return OutboundBulkImportIssue{Severity: InboundBulkIssueError, Code: code, Message: message, RowNumber: rowNumber, Field: field, Value: strings.TrimSpace(value)}
}

func outboundBulkHasErrors(issues []OutboundBulkImportIssue) bool {
	for _, issue := range issues {
		if issue.Severity == InboundBulkIssueError {
			return true
		}
	}
	return false
}

func normalizeOutboundBulkValue(value string) string {
	return strings.TrimSpace(strings.ToUpper(value))
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
