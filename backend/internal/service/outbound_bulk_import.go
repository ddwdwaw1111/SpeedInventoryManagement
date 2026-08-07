package service

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

const (
	MaxOutboundBulkImportFileSize       = 10 << 20
	MaxOutboundBulkImportRequestSize    = MaxOutboundBulkImportFileSize + (1 << 20)
	MaxOutboundBulkImportCommitBodySize = 20 << 20
	MaxOutboundBulkImportRows           = 5000
	MaxOutboundBulkImportDocuments      = 500
	MainOutboundWarehouseCode           = "308"
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
	outboundBulkPlannedQuantity  = "plannedQuantity"
	outboundBulkQuantity         = "quantity"
	outboundBulkInventoryPallets = "inventoryPallets"
	outboundBulkOutboundPallets  = "outboundPallets"
	outboundBulkLineNote         = "lineNote"
)

type OutboundBulkImportIssue struct {
	Severity         string `json:"severity"`
	Code             string `json:"code"`
	Message          string `json:"message"`
	RowNumber        int    `json:"rowNumber,omitempty"`
	Field            string `json:"field,omitempty"`
	Value            string `json:"value,omitempty"`
	SKU              string `json:"sku,omitempty"`
	Warehouse        string `json:"warehouse,omitempty"`
	SourceContainer  string `json:"sourceContainer,omitempty"`
	StorageSection   string `json:"storageSection,omitempty"`
	RequestedQty     int    `json:"requestedQty,omitempty"`
	AvailableQty     int    `json:"availableQty"`
	RequestedPallets int    `json:"requestedPallets,omitempty"`
	AvailablePallets int    `json:"availablePallets"`
}

type OutboundBulkImportLinePreview struct {
	RowNumber         int    `json:"rowNumber"`
	Warehouse         string `json:"warehouse"`
	SourceContainer   string `json:"sourceContainer"`
	StorageSection    string `json:"storageSection"`
	SKU               string `json:"sku"`
	ItemNumber        string `json:"itemNumber"`
	Quantity          int    `json:"quantity"` // Backward-compatible alias for actualQuantity.
	PlannedQuantity   int    `json:"plannedQuantity"`
	ActualQuantity    int    `json:"actualQuantity"`
	InventoryPallets  int    `json:"inventoryPallets"` // Inventory pallet units assigned to the pick; may be zero for partial-pallet carton picks.
	OutboundPallets   int    `json:"outboundPallets"`  // Pallets after repalletization, persisted on the shipment line.
	LineNote          string `json:"lineNote"`
	RequiresTransfer  bool   `json:"requiresTransfer"`
	OutboundWarehouse string `json:"outboundWarehouse"`
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
	TotalPlannedQty       int                             `json:"totalPlannedQty"`
	TotalActualQty        int                             `json:"totalActualQty"`
	TotalInventoryPallets int                             `json:"totalInventoryPallets"`
	TotalOutboundPallets  int                             `json:"totalOutboundPallets"`
	TransferLines         int                             `json:"transferLines"`
}

type OutboundBulkImportPreview struct {
	ImportBatchID    int64                               `json:"importBatchId,omitempty"`
	ImportID         string                              `json:"importId"`
	SourceFileName   string                              `json:"sourceFileName"`
	CustomerID       int64                               `json:"customerId"`
	CustomerName     string                              `json:"customerName"`
	MainWarehouse    string                              `json:"mainWarehouse"`
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
	ImportBatchID  int64                              `json:"-"`
}

type OutboundBulkImportCommitResult struct {
	DocumentKey    string            `json:"documentKey"`
	PickingOrderNo string            `json:"pickingOrderNo"`
	Success        bool              `json:"success"`
	Document       *OutboundDocument `json:"document,omitempty"`
	TransferLines  int               `json:"transferLines"`
	Error          string            `json:"error,omitempty"`
}

type OutboundBulkImportCommitResponse struct {
	ImportBatchID    int64                            `json:"importBatchId,omitempty"`
	SourceFileName   string                           `json:"sourceFileName"`
	TotalDocuments   int                              `json:"totalDocuments"`
	CreatedDocuments int                              `json:"createdDocuments"`
	FailedDocuments  int                              `json:"failedDocuments"`
	Results          []OutboundBulkImportCommitResult `json:"results"`
	RetentionWarning string                           `json:"retentionWarning,omitempty"`
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
		normalizedDocumentKey := strings.ToUpper(document.DocumentKey)
		if document.DocumentKey == "" || seenDocumentKeys[normalizedDocumentKey] {
			baseKey := fmt.Sprintf("DOCUMENT-%d", index+1)
			document.DocumentKey = baseKey
			for suffix := 2; seenDocumentKeys[strings.ToUpper(document.DocumentKey)]; suffix++ {
				document.DocumentKey = fmt.Sprintf("%s-%d", baseKey, suffix)
			}
		}
		seenDocumentKeys[strings.ToUpper(document.DocumentKey)] = true
		document.Issues = make([]OutboundBulkImportIssue, 0)
		document.Input = CreateOutboundDocumentInput{}
		document.Valid = false
		document.TotalLines = 0
		document.TotalQty = 0
		document.TotalInventoryPallets = 0
		document.TotalOutboundPallets = 0
		document.TransferLines = 0
		for lineIndex := range document.Lines {
			line := &document.Lines[lineIndex]
			line.RequiresTransfer = false
			line.OutboundWarehouse = ""
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
	documentKeys := make([]string, len(input.Documents))
	seenDocumentKeys := make(map[string]struct{}, len(input.Documents))
	for index, entry := range input.Documents {
		documentKey := strings.TrimSpace(entry.DocumentKey)
		if documentKey == "" {
			documentKey = fmt.Sprintf("DOCUMENT-%d", index+1)
		}
		normalizedDocumentKey := strings.ToUpper(documentKey)
		if _, exists := seenDocumentKeys[normalizedDocumentKey]; exists {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: duplicate document key %q in import request", ErrInvalidInput, documentKey)
		}
		seenDocumentKeys[normalizedDocumentKey] = struct{}{}
		documentKeys[index] = documentKey
	}
	locations, err := s.ListLocations(ctx)
	if err != nil {
		return OutboundBulkImportCommitResponse{}, err
	}
	mainLocation, err := resolveMainOutboundLocation(locations)
	if err != nil {
		return OutboundBulkImportCommitResponse{}, err
	}
	// Serialize the existence check and create sequence so concurrent bulk
	// commits cannot both create the same customer/Picking Order draft.
	s.outboundBulkImportMu.Lock()
	defer s.outboundBulkImportMu.Unlock()

	type preparedBulkOutboundDocument struct {
		documentKey             string
		pickingOrderNo          string
		input                   CreateOutboundDocumentInput
		expectedShipDate        *time.Time
		actualShipDate          *time.Time
		requestedStatus         string
		requestedTrackingStatus string
		transferLines           int
	}
	preparedDocuments := make([]preparedBulkOutboundDocument, 0, len(input.Documents))
	seen := make(map[string]bool)
	for index, entry := range input.Documents {
		pickingOrderNo := strings.TrimSpace(strings.ToUpper(entry.Input.PackingListNo))
		if pickingOrderNo == "" {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: shipment %d requires a Picking Order No", ErrInvalidInput, index+1)
		} else if seen[pickingOrderNo] {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: duplicate Picking Order No %s in import request", ErrInvalidInput, pickingOrderNo)
		} else if exists, err := s.outboundPickingOrderExists(ctx, input.CustomerID, pickingOrderNo); err != nil {
			return OutboundBulkImportCommitResponse{}, err
		} else if exists {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: Picking Order No %s already exists", ErrInvalidInput, pickingOrderNo)
		}
		seen[pickingOrderNo] = true

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
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("%w: shipment %s requires at least one outbound line", ErrInvalidInput, pickingOrderNo)
		}
		preparedInput, expectedShipDate, actualShipDate, requestedStatus, requestedTrackingStatus, err := prepareOutboundDocumentCreation(documentInput)
		if err != nil {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("prepare shipment %s: %w", pickingOrderNo, err)
		}
		preparedDocuments = append(preparedDocuments, preparedBulkOutboundDocument{
			documentKey:             documentKeys[index],
			pickingOrderNo:          pickingOrderNo,
			input:                   preparedInput,
			expectedShipDate:        expectedShipDate,
			actualShipDate:          actualShipDate,
			requestedStatus:         requestedStatus,
			requestedTrackingStatus: requestedTrackingStatus,
			transferLines:           countOutboundAllocationsOutsideLocation(preparedInput, mainLocation.ID),
		})
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundBulkImportCommitResponse{}, fmt.Errorf("begin outbound bulk import transaction: %w", err)
	}
	defer tx.Rollback()
	if err := lockBillingSourceCustomersTx(ctx, tx, []int64{input.CustomerID}); err != nil {
		return OutboundBulkImportCommitResponse{}, err
	}
	documentIDs := make([]int64, 0, len(preparedDocuments))
	for _, prepared := range preparedDocuments {
		documentID, err := s.createOutboundDocumentTx(
			ctx,
			tx,
			prepared.input,
			prepared.expectedShipDate,
			prepared.actualShipDate,
			prepared.requestedStatus,
			prepared.requestedTrackingStatus,
		)
		if err != nil {
			return OutboundBulkImportCommitResponse{}, fmt.Errorf("create shipment %s: %w", prepared.pickingOrderNo, err)
		}
		documentIDs = append(documentIDs, documentID)
	}
	if input.ImportBatchID > 0 {
		records := make([]BulkImportCommitRecord, 0, len(preparedDocuments))
		for index, prepared := range preparedDocuments {
			records = append(records, BulkImportCommitRecord{
				DocumentKey:   prepared.documentKey,
				DocumentID:    documentIDs[index],
				ReferenceCode: prepared.pickingOrderNo,
				Success:       true,
			})
		}
		if err := completeBulkImportBatchTx(ctx, tx, input.ImportBatchID, BulkImportStatusCompleted, len(preparedDocuments), 0, records); err != nil {
			return OutboundBulkImportCommitResponse{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return OutboundBulkImportCommitResponse{}, fmt.Errorf("commit outbound bulk import: %w", err)
	}

	response := OutboundBulkImportCommitResponse{
		SourceFileName:   strings.TrimSpace(filepath.Base(input.SourceFileName)),
		TotalDocuments:   len(preparedDocuments),
		CreatedDocuments: len(preparedDocuments),
		Results:          make([]OutboundBulkImportCommitResult, 0, len(preparedDocuments)),
	}
	for index, prepared := range preparedDocuments {
		document, err := s.getOutboundDocument(ctx, documentIDs[index])
		if err != nil {
			return OutboundBulkImportCommitResponse{}, err
		}
		response.Results = append(response.Results, OutboundBulkImportCommitResult{
			DocumentKey:    prepared.documentKey,
			PickingOrderNo: prepared.pickingOrderNo,
			Success:        true,
			Document:       &document,
			TransferLines:  prepared.transferLines,
		})
	}
	return response, nil
}

func buildOutboundBulkMainWarehousePlan(
	input CreateOutboundDocumentInput,
	mainLocation Location,
) (CreateOutboundDocumentInput, CreateInventoryTransferInput, error) {
	transferToken, err := newInboundBulkImportID()
	if err != nil {
		return CreateOutboundDocumentInput{}, CreateInventoryTransferInput{}, fmt.Errorf("generate bulk outbound transfer number: %w", err)
	}
	transferInput := CreateInventoryTransferInput{
		TransferNo:          "TRN-BULK-" + strings.ToUpper(transferToken),
		ActualTransferredAt: firstNonEmpty(input.ActualShipDate, input.ExpectedShipDate),
		Notes:               fmt.Sprintf("Automatic transfer to %s for bulk outbound %s", mainLocation.Name, input.PackingListNo),
		Lines:               make([]CreateInventoryTransferLineInput, 0),
	}
	for lineIndex := range input.Lines {
		line := &input.Lines[lineIndex]
		if len(line.PickAllocations) == 0 {
			continue
		}
		for allocationIndex := range line.PickAllocations {
			allocation := &line.PickAllocations[allocationIndex]
			sourceLocationID := firstNonZeroInt64(allocation.LocationID, line.LocationID)
			if sourceLocationID != mainLocation.ID && allocation.AutoTransferToMain {
				if allocation.SourceLocationID == 0 {
					allocation.SourceLocationID = sourceLocationID
					allocation.SourceLocationName = allocation.LocationName
					allocation.SourceStorageSection = fallbackSection(allocation.StorageSection)
					allocation.SourceStartingPallets = cloneIntPointer(allocation.StartingPallets)
					allocation.SourceRemainingPallets = cloneIntPointer(allocation.RemainingPallets)
				}
				transferInput.Lines = append(transferInput.Lines, CreateInventoryTransferLineInput{
					CustomerID:         line.CustomerID,
					LocationID:         sourceLocationID,
					StorageSection:     fallbackSection(allocation.StorageSection),
					ContainerNo:        allocation.ContainerNo,
					SKUMasterID:        line.SKUMasterID,
					Quantity:           allocation.AllocatedQty,
					SourcePallets:      allocation.Pallets,
					DestinationPallets: allocation.Pallets,
					ToLocationID:       mainLocation.ID,
					ToStorageSection:   DefaultStorageSection,
					LineNote:           fmt.Sprintf("Bulk outbound %s", input.PackingListNo),
				})
				allocation.StorageSection = DefaultStorageSection
				allocation.LocationID = mainLocation.ID
				allocation.LocationName = mainLocation.Name
				// The final-balance snapshot belongs to the source bucket and was
				// validated before this transfer. The temporary main-warehouse bucket
				// may merge with existing stock, so it must not reuse that snapshot.
				allocation.StartingPallets = nil
				allocation.RemainingPallets = nil
				allocation.AutoTransferToMain = false
			}
		}
		allAtMainLocation := true
		for _, allocation := range line.PickAllocations {
			if firstNonZeroInt64(allocation.LocationID, line.LocationID) != mainLocation.ID {
				allAtMainLocation = false
				break
			}
		}
		if allAtMainLocation {
			line.LocationID = mainLocation.ID
		}
	}
	return input, transferInput, nil
}

func countOutboundAllocationsOutsideLocation(input CreateOutboundDocumentInput, locationID int64) int {
	count := 0
	for _, line := range input.Lines {
		for _, allocation := range line.PickAllocations {
			if allocation.AutoTransferToMain && firstNonZeroInt64(allocation.LocationID, line.LocationID) != locationID {
				count++
			}
		}
	}
	return count
}

func hasPendingOutboundMainWarehouseTransfer(input CreateOutboundDocumentInput) bool {
	for _, line := range input.Lines {
		for _, allocation := range line.PickAllocations {
			if allocation.AutoTransferToMain {
				return true
			}
		}
	}
	return false
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
		"SKU": outboundBulkSKU, "UPC": outboundBulkSKU, "ITEMCODE": outboundBulkItemNumber, "ITEMNUMBER": outboundBulkItemNumber,
		"PLANNEDQTY": outboundBulkPlannedQuantity, "PLANNEDQUANTITY": outboundBulkPlannedQuantity,
		"ACTUALQTY": outboundBulkQuantity, "ACTUALQUANTITY": outboundBulkQuantity,
		"QTY": outboundBulkQuantity, "QUANTITY": outboundBulkQuantity,
		"INVENTORYPALLETS": outboundBulkInventoryPallets, "INVENTORYPALLETSUSED": outboundBulkInventoryPallets, "INVENTORYPALLETCOUNT": outboundBulkInventoryPallets,
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
	actualQuantityValue := inboundBulkColumnValue(row, columns, outboundBulkQuantity)
	if actualQuantityValue != "" {
		line.Quantity, valid = parseInboundBulkNonNegativeInt(actualQuantityValue)
	} else {
		valid = true
	}
	line.ActualQuantity = line.Quantity
	if !valid {
		issues = append(issues, outboundBulkIssue("INVALID_QUANTITY", "Actual Qty must be a non-negative whole number.", rowNumber, outboundBulkQuantity, actualQuantityValue))
	}
	plannedQuantityValue := inboundBulkColumnValue(row, columns, outboundBulkPlannedQuantity)
	if plannedQuantityValue == "" {
		line.PlannedQuantity = line.ActualQuantity
	} else {
		line.PlannedQuantity, valid = parseInboundBulkNonNegativeInt(plannedQuantityValue)
		if !valid {
			issues = append(issues, outboundBulkIssue("INVALID_PLANNED_QUANTITY", "Planned Qty must be a non-negative whole number.", rowNumber, outboundBulkPlannedQuantity, plannedQuantityValue))
		}
	}
	if line.PlannedQuantity == 0 && line.ActualQuantity == 0 {
		issues = append(issues, outboundBulkIssue("INVALID_QUANTITY", "Planned Qty or Actual Qty must be greater than zero.", rowNumber, outboundBulkQuantity, actualQuantityValue))
	}
	inventoryPalletsValue := inboundBulkColumnValue(row, columns, outboundBulkInventoryPallets)
	line.InventoryPallets, valid = parseInboundBulkNonNegativeInt(inventoryPalletsValue)
	if inventoryPalletsValue == "" || !valid {
		issues = append(issues, outboundBulkIssue("INVALID_INVENTORY_PALLETS", "Inventory Pallets Used must be a non-negative whole number.", rowNumber, outboundBulkInventoryPallets, inboundBulkColumnValue(row, columns, outboundBulkInventoryPallets)))
	}
	outboundPalletsValue := inboundBulkColumnValue(row, columns, outboundBulkOutboundPallets)
	line.OutboundPallets, valid = parseInboundBulkNonNegativeInt(outboundPalletsValue)
	if outboundPalletsValue == "" || !valid {
		issues = append(issues, outboundBulkIssue("INVALID_OUTBOUND_PALLETS", "Outbound Pallets must be a non-negative whole number.", rowNumber, outboundBulkOutboundPallets, inboundBulkColumnValue(row, columns, outboundBulkOutboundPallets)))
	}
	if line.ActualQuantity == 0 && line.OutboundPallets != 0 {
		issues = append(issues, outboundBulkIssue("INVALID_OUTBOUND_PALLETS", "Outbound Pallets must be zero when Actual Qty is zero.", rowNumber, outboundBulkOutboundPallets, outboundPalletsValue))
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
	mainLocation, err := resolveMainOutboundLocation(locations)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	masters, err := s.ListSKUMasters(ctx, "", customerID)
	if err != nil {
		return OutboundBulkImportPreview{}, err
	}
	sourceReferences, err := s.ListOutboundSourceReferences(ctx)
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
	catalogSKUMasterIDs := make(map[int64]struct{})
	for _, reference := range sourceReferences {
		if reference.CustomerID == customerID {
			catalogSKUMasterIDs[reference.SKUMasterID] = struct{}{}
		}
	}
	for _, master := range masters {
		if _, exists := catalogSKUMasterIDs[master.ID]; !exists {
			continue
		}
		mastersBySKU[normalizeOutboundBulkValue(master.SKU)] = master
	}
	remaining, remainingPallets, physicalQuantity, physicalPallets := initializeOutboundBulkBalances(items)
	usedLocations := make(map[int64]bool)
	preview := OutboundBulkImportPreview{SourceFileName: strings.TrimSpace(filepath.Base(fileName)), CustomerID: customerID, CustomerName: customer.Name, MainWarehouse: mainLocation.Name, Documents: make([]OutboundBulkImportDocumentPreview, 0, len(documents))}
	pickingOrderCounts := make(map[string]int)
	for _, document := range documents {
		if key := normalizeOutboundBulkValue(document.PickingOrderNo); key != "" {
			pickingOrderCounts[key]++
		}
	}

	for documentIndex := range documents {
		document := documents[documentIndex]
		if document.Issues == nil {
			document.Issues = make([]OutboundBulkImportIssue, 0)
		}
		if document.Lines == nil {
			document.Lines = make([]OutboundBulkImportLinePreview, 0)
		}
		if document.RowNumbers == nil {
			document.RowNumbers = make([]int, 0)
		}
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
		documentPhysicalQuantity := make(map[int64]int, len(physicalQuantity))
		for itemID, quantity := range physicalQuantity {
			documentPhysicalQuantity[itemID] = quantity
		}
		documentPhysicalPallets := make(map[int64]int, len(physicalPallets))
		for itemID, pallets := range physicalPallets {
			documentPhysicalPallets[itemID] = pallets
		}
		resolvedPreviewLines := 0
		for lineIndex := range document.Lines {
			line := &document.Lines[lineIndex]
			line.Warehouse = strings.TrimSpace(strings.ToUpper(line.Warehouse))
			line.SourceContainer = strings.TrimSpace(strings.ToUpper(line.SourceContainer))
			line.StorageSection = strings.TrimSpace(strings.ToUpper(line.StorageSection))
			line.SKU = strings.TrimSpace(strings.ToUpper(line.SKU))
			line.ItemNumber = strings.TrimSpace(strings.ToUpper(line.ItemNumber))
			if line.ActualQuantity == 0 && line.Quantity > 0 {
				line.ActualQuantity = line.Quantity
			}
			line.Quantity = line.ActualQuantity
			if line.PlannedQuantity == 0 && line.ActualQuantity > 0 {
				line.PlannedQuantity = line.ActualQuantity
			}
			fulfillmentQuantity := outboundBulkFulfillmentQuantity(*line)
			if line.PlannedQuantity < 0 || line.ActualQuantity < 0 || (line.PlannedQuantity == 0 && line.ActualQuantity == 0) {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_QUANTITY", "Planned Qty or Actual Qty must be greater than zero and neither may be negative.", line.RowNumber, outboundBulkQuantity, fmt.Sprint(line.ActualQuantity)))
			}
			if line.InventoryPallets < 0 {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_INVENTORY_PALLETS", "Inventory Pallets Used cannot be negative.", line.RowNumber, outboundBulkInventoryPallets, fmt.Sprint(line.InventoryPallets)))
			}
			if line.OutboundPallets < 0 {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_OUTBOUND_PALLETS", "Outbound Pallets cannot be negative.", line.RowNumber, outboundBulkOutboundPallets, fmt.Sprint(line.OutboundPallets)))
			}
			if line.ActualQuantity == 0 && line.OutboundPallets != 0 {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_OUTBOUND_PALLETS", "Outbound Pallets must be zero when Actual Qty is zero.", line.RowNumber, outboundBulkOutboundPallets, fmt.Sprint(line.OutboundPallets)))
			}
			location, locationExists := locationsByName[normalizeOutboundBulkValue(line.Warehouse)]
			if !locationExists {
				document.Issues = append(document.Issues, outboundBulkIssue("INVALID_WAREHOUSE", "Warehouse does not exist.", line.RowNumber, outboundBulkWarehouse, line.Warehouse))
				continue
			}
			usedLocations[location.ID] = true
			line.OutboundWarehouse = mainLocation.Name
			master, issueCode, issueMessage := resolveOutboundBulkMaster(*line, mastersBySKU)
			if issueCode != "" {
				document.Issues = append(document.Issues, outboundBulkIssue(issueCode, issueMessage, line.RowNumber, outboundBulkSKU, line.SKU))
				continue
			}
			line.SKU = master.SKU
			if line.ItemNumber == "" {
				line.ItemNumber = master.ItemNumber
			}
			if fulfillmentQuantity == 0 {
				document.Input.Lines = append(document.Input.Lines, buildOutboundBulkDocumentLines(customerID, master, *line, nil, location.ID)...)
				resolvedPreviewLines++
				document.TotalQty += line.Quantity
				document.TotalPlannedQty += line.PlannedQuantity
				document.TotalActualQty += line.ActualQuantity
				document.TotalInventoryPallets += line.InventoryPallets
				document.TotalOutboundPallets += line.OutboundPallets
				continue
			}
			if fulfillmentQuantity > 0 && line.SourceContainer == "" {
				document.Issues = append(document.Issues, outboundBulkIssue("MISSING_SOURCE_CONTAINER", "Source Container is required so the final pallet balance can be applied to one physical container.", line.RowNumber, outboundBulkSourceContainer, ""))
				continue
			}
			candidates := make([]Item, 0)
			allowMainWarehouseTransfer := location.ID == mainLocation.ID && line.SourceContainer != ""
			for _, item := range items {
				if item.SKUMasterID != master.ID || documentRemaining[item.ID] <= 0 {
					continue
				}
				if item.LocationID != location.ID && !allowMainWarehouseTransfer {
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
			if allowMainWarehouseTransfer {
				prioritizeOutboundBulkMainWarehouseCandidates(candidates, mainLocation.ID)
			}
			if len(candidates) > 1 {
				document.Issues = append(document.Issues, outboundBulkIssue("AMBIGUOUS_SOURCE_CONTAINER", "Source Container resolves to more than one inventory balance. Specify the exact source warehouse and storage section, or split the row.", line.RowNumber, outboundBulkSourceContainer, line.SourceContainer))
				continue
			}
			if len(candidates) == 0 || totalOutboundBulkAvailableQuantity(candidates, documentRemaining) < fulfillmentQuantity {
				document.Issues = append(document.Issues, outboundBulkInsufficientStockIssue(*line, totalOutboundBulkAvailableQuantity(candidates, documentRemaining)))
				continue
			}
			item := candidates[0]
			startingQuantity := maxInt(documentPhysicalQuantity[item.ID], 0)
			startingPallets := maxInt(documentPhysicalPallets[item.ID], 0)
			availablePallets := maxInt(documentRemainingPallets[item.ID], 0)
			if line.InventoryPallets > startingPallets {
				document.Issues = append(document.Issues, outboundBulkInventoryPalletsExceedSourceIssue(*line, startingPallets))
				continue
			}
			remainingQuantity := startingQuantity - fulfillmentQuantity
			releasedPallets := line.InventoryPallets
			if fulfillmentQuantity >= startingQuantity {
				releasedPallets = startingPallets
			}
			remainingPallets := startingPallets - releasedPallets
			if releasedPallets < 0 || releasedPallets > availablePallets {
				document.Issues = append(document.Issues, outboundBulkPalletReleaseConflictIssue(*line, releasedPallets, availablePallets))
				continue
			}
			documentRemaining[item.ID] -= fulfillmentQuantity
			documentRemainingPallets[item.ID] -= releasedPallets
			documentPhysicalQuantity[item.ID] = remainingQuantity
			documentPhysicalPallets[item.ID] = remainingPallets
			startingPalletsSnapshot := startingPallets
			remainingPalletsSnapshot := remainingPallets
			allocations := []OutboundPickAllocation{{
				ItemNumber: item.ItemNumber, LocationID: item.LocationID, LocationName: item.LocationName,
				StorageSection: fallbackSection(item.StorageSection), ContainerNo: item.ContainerNo,
				AllocatedQty: fulfillmentQuantity, Pallets: releasedPallets,
				InventoryPalletsUsed: line.InventoryPallets,
				StartingPallets:      &startingPalletsSnapshot, RemainingPallets: &remainingPalletsSnapshot,
			}}
			line.RequiresTransfer = false
			for allocationIndex := range allocations {
				allocation := &allocations[allocationIndex]
				usedLocations[allocation.LocationID] = true
				if allocation.LocationID != mainLocation.ID {
					allocation.AutoTransferToMain = true
					line.RequiresTransfer = true
					document.TransferLines++
				}
			}
			document.Input.Lines = append(document.Input.Lines, buildOutboundBulkDocumentLines(customerID, master, *line, allocations, location.ID)...)
			resolvedPreviewLines++
			document.TotalQty += line.Quantity
			document.TotalPlannedQty += line.PlannedQuantity
			document.TotalActualQty += line.ActualQuantity
			document.TotalInventoryPallets += line.InventoryPallets
			document.TotalOutboundPallets += line.OutboundPallets
		}
		document.TotalLines = len(document.Lines)
		document.Valid = !outboundBulkHasErrors(document.Issues) && resolvedPreviewLines == len(document.Lines) && len(document.Lines) > 0
		if document.Valid {
			remaining = documentRemaining
			remainingPallets = documentRemainingPallets
			physicalQuantity = documentPhysicalQuantity
			physicalPallets = documentPhysicalPallets
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

func initializeOutboundBulkBalances(items []Item) (map[int64]int, map[int64]int, map[int64]int, map[int64]int) {
	remainingQty := make(map[int64]int, len(items))
	remainingPallets := make(map[int64]int, len(items))
	physicalQty := make(map[int64]int, len(items))
	physicalPallets := make(map[int64]int, len(items))
	for _, item := range items {
		remainingQty[item.ID] = maxInt(item.AvailableQty, 0)
		remainingPallets[item.ID] = maxInt(item.AvailablePallets, 0)
		physicalQty[item.ID] = maxInt(item.Quantity, 0)
		physicalPallets[item.ID] = maxInt(item.Pallets, 0)
	}
	return remainingQty, remainingPallets, physicalQty, physicalPallets
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
		return SKUMaster{}, "INVALID_SKU", "UPC is required; Item Code is reference-only."
	}
	return SKUMaster{}, "INVALID_SKU", "UPC does not exist for this customer."
}

type outboundBulkSelectedAllocation struct {
	ItemID     int64
	Allocation OutboundPickAllocation
}

func outboundBulkInsufficientStockIssue(line OutboundBulkImportLinePreview, availableQty int) OutboundBulkImportIssue {
	requestedQuantity := outboundBulkFulfillmentQuantity(line)
	issue := outboundBulkIssue(
		"INSUFFICIENT_STOCK",
		fmt.Sprintf("UPC %s has %d CTN available in the selected source scope, but this row requests %d CTN.", line.SKU, availableQty, requestedQuantity),
		line.RowNumber,
		outboundBulkQuantity,
		fmt.Sprint(requestedQuantity),
	)
	issue.SKU = line.SKU
	issue.Warehouse = line.Warehouse
	issue.SourceContainer = line.SourceContainer
	issue.StorageSection = line.StorageSection
	issue.RequestedQty = requestedQuantity
	issue.AvailableQty = maxInt(availableQty, 0)
	return issue
}

func outboundBulkInsufficientPalletsIssue(line OutboundBulkImportLinePreview, availablePallets int) OutboundBulkImportIssue {
	issue := outboundBulkIssue(
		"INSUFFICIENT_INVENTORY_PALLETS",
		fmt.Sprintf("UPC %s can deduct at most %d inventory pallets for this row after earlier workbook rows, but this row requests %d.", line.SKU, availablePallets, line.InventoryPallets),
		line.RowNumber,
		outboundBulkInventoryPallets,
		fmt.Sprint(line.InventoryPallets),
	)
	issue.SKU = line.SKU
	issue.Warehouse = line.Warehouse
	issue.SourceContainer = line.SourceContainer
	issue.StorageSection = line.StorageSection
	issue.RequestedPallets = maxInt(line.InventoryPallets, 0)
	issue.AvailablePallets = maxInt(availablePallets, 0)
	return issue
}

func outboundBulkInventoryPalletsExceedSourceIssue(line OutboundBulkImportLinePreview, startingPallets int) OutboundBulkImportIssue {
	issue := outboundBulkIssue(
		"INVENTORY_PALLETS_EXCEED_SOURCE",
		fmt.Sprintf(
			"Inventory Pallets Used is %d, but source container %s currently has only %d physical pallet(s).",
			maxInt(line.InventoryPallets, 0),
			firstNonEmpty(line.SourceContainer, "(blank)"),
			maxInt(startingPallets, 0),
		),
		line.RowNumber,
		outboundBulkInventoryPallets,
		fmt.Sprint(line.InventoryPallets),
	)
	issue.SKU = line.SKU
	issue.Warehouse = line.Warehouse
	issue.SourceContainer = line.SourceContainer
	issue.StorageSection = line.StorageSection
	issue.RequestedPallets = maxInt(line.InventoryPallets, 0)
	issue.AvailablePallets = maxInt(startingPallets, 0)
	return issue
}

func outboundBulkPalletReleaseConflictIssue(line OutboundBulkImportLinePreview, releasedPallets int, availablePallets int) OutboundBulkImportIssue {
	issue := outboundBulkIssue(
		"INVENTORY_PALLET_RELEASE_CONFLICT",
		fmt.Sprintf(
			"This row depletes source container %s and must release %d physical pallet(s), but only %d pallet(s) are currently unreserved. Check other outbound drafts using this container, then revalidate.",
			firstNonEmpty(line.SourceContainer, "(blank)"),
			maxInt(releasedPallets, 0),
			maxInt(availablePallets, 0),
		),
		line.RowNumber,
		outboundBulkInventoryPallets,
		fmt.Sprint(line.InventoryPallets),
	)
	issue.SKU = line.SKU
	issue.Warehouse = line.Warehouse
	issue.SourceContainer = line.SourceContainer
	issue.StorageSection = line.StorageSection
	issue.RequestedPallets = maxInt(releasedPallets, 0)
	issue.AvailablePallets = maxInt(availablePallets, 0)
	return issue
}

func outboundBulkFulfillmentQuantity(line OutboundBulkImportLinePreview) int {
	if line.ActualQuantity > 0 {
		return line.ActualQuantity
	}
	if line.Quantity > 0 {
		return line.Quantity
	}
	return 0
}

func totalOutboundBulkAvailableQuantity(candidates []Item, remainingQtyByItemID map[int64]int) int {
	total := 0
	for _, item := range candidates {
		total += maxInt(remainingQtyByItemID[item.ID], 0)
	}
	return total
}

func selectOutboundBulkAllocations(
	candidates []Item,
	requestedQty int,
	requestedPallets int,
	remainingQtyByItemID map[int64]int,
	remainingPalletsByItemID map[int64]int,
) ([]outboundBulkSelectedAllocation, bool, bool, int) {
	if requestedQty <= 0 {
		return nil, true, requestedPallets == 0, 0
	}

	totalQty := totalOutboundBulkAvailableQuantity(candidates, remainingQtyByItemID)
	if totalQty < requestedQty {
		return nil, false, false, 0
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
		return nil, true, false, availableFromSelectableSources
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
		return nil, false, false, availableFromSelectableSources
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
	return selected, true, true, availableFromSelectableSources
}

func totalOutboundBulkSelectedAvailablePallets(selected []outboundBulkSelectedAllocation, remainingByItemID map[int64]int) int {
	total := 0
	for _, selectedAllocation := range selected {
		total += maxInt(remainingByItemID[selectedAllocation.ItemID], 0)
	}
	return total
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

func prioritizeOutboundBulkMainWarehouseCandidates(candidates []Item, mainLocationID int64) {
	sort.SliceStable(candidates, func(left, right int) bool {
		leftIsMain := candidates[left].LocationID == mainLocationID
		rightIsMain := candidates[right].LocationID == mainLocationID
		return leftIsMain && !rightIsMain
	})
}

func buildOutboundBulkDocumentLines(
	customerID int64,
	master SKUMaster,
	previewLine OutboundBulkImportLinePreview,
	allocations []OutboundPickAllocation,
	fallbackLocationID int64,
) []CreateOutboundDocumentLineInput {
	if previewLine.ActualQuantity == 0 && previewLine.Quantity == 0 && previewLine.PlannedQuantity == 0 {
		previewLine.Quantity = totalOutboundPickAllocationQuantity(allocations)
	}
	if previewLine.ActualQuantity == 0 && previewLine.Quantity > 0 {
		previewLine.ActualQuantity = previewLine.Quantity
	}
	if previewLine.PlannedQuantity == 0 && previewLine.ActualQuantity > 0 {
		previewLine.PlannedQuantity = previewLine.ActualQuantity
	}
	if previewLine.ActualQuantity == 0 {
		return []CreateOutboundDocumentLineInput{{
			CustomerID:      customerID,
			LocationID:      fallbackLocationID,
			SKUMasterID:     master.ID,
			Quantity:        0,
			PlannedQuantity: previewLine.PlannedQuantity,
			ActualQuantity:  0,
			Pallets:         previewLine.OutboundPallets,
			UnitLabel:       firstNonEmpty(master.Unit, "PCS"),
			LineNote:        strings.TrimSpace(previewLine.LineNote),
			PickAllocations: nil,
		}}
	}
	locationOrder := make([]int64, 0)
	allocationsByLocation := make(map[int64][]OutboundPickAllocation)
	for _, allocation := range allocations {
		locationID := allocation.LocationID
		if _, exists := allocationsByLocation[locationID]; !exists {
			locationOrder = append(locationOrder, locationID)
		}
		allocationsByLocation[locationID] = append(allocationsByLocation[locationID], allocation)
	}

	quantitiesByLocation := make([]int, 0, len(locationOrder))
	for _, locationID := range locationOrder {
		quantitiesByLocation = append(quantitiesByLocation, totalOutboundPickAllocationQuantity(allocationsByLocation[locationID]))
	}
	outboundPalletsByLocation := allocateOutboundBulkShippingPallets(previewLine.OutboundPallets, quantitiesByLocation)
	plannedQuantitiesByLocation := allocateOutboundBulkShippingPallets(previewLine.PlannedQuantity, quantitiesByLocation)
	actualQuantitiesByLocation := allocateOutboundBulkShippingPallets(previewLine.ActualQuantity, quantitiesByLocation)

	lines := make([]CreateOutboundDocumentLineInput, 0, len(locationOrder))
	for locationIndex, locationID := range locationOrder {
		locationAllocations := allocationsByLocation[locationID]
		lines = append(lines, CreateOutboundDocumentLineInput{
			CustomerID:      customerID,
			LocationID:      locationID,
			SKUMasterID:     master.ID,
			Quantity:        actualQuantitiesByLocation[locationIndex],
			PlannedQuantity: plannedQuantitiesByLocation[locationIndex],
			ActualQuantity:  actualQuantitiesByLocation[locationIndex],
			Pallets:         outboundPalletsByLocation[locationIndex],
			UnitLabel:       firstNonEmpty(master.Unit, "PCS"),
			LineNote:        strings.TrimSpace(previewLine.LineNote),
			PickAllocations: locationAllocations,
		})
	}
	return lines
}

func allocateOutboundBulkShippingPallets(totalPallets int, quantities []int) []int {
	shares := make([]int, len(quantities))
	if totalPallets <= 0 || len(quantities) == 0 {
		return shares
	}

	totalQuantity := 0
	for _, quantity := range quantities {
		totalQuantity += max(quantity, 0)
	}
	if totalQuantity <= 0 {
		return shares
	}

	type palletRemainder struct {
		index     int
		remainder int
	}
	remainders := make([]palletRemainder, 0, len(quantities))
	assigned := 0
	for index, quantity := range quantities {
		numerator := totalPallets * max(quantity, 0)
		shares[index] = numerator / totalQuantity
		assigned += shares[index]
		remainders = append(remainders, palletRemainder{index: index, remainder: numerator % totalQuantity})
	}
	sort.SliceStable(remainders, func(left, right int) bool {
		if remainders[left].remainder != remainders[right].remainder {
			return remainders[left].remainder > remainders[right].remainder
		}
		return remainders[left].index < remainders[right].index
	})
	for offset := 0; assigned < totalPallets; offset++ {
		shares[remainders[offset%len(remainders)].index]++
		assigned++
	}
	return shares
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

func resolveMainOutboundLocation(locations []Location) (Location, error) {
	matching := make([]Location, 0, 1)
	for _, location := range locations {
		name := normalizeOutboundBulkValue(location.Name)
		if name == MainOutboundWarehouseCode || isOutboundWarehouseCodePrefix(name, MainOutboundWarehouseCode) {
			matching = append(matching, location)
		}
	}
	if len(matching) == 0 {
		return Location{}, fmt.Errorf("%w: main outbound warehouse %s was not found", ErrInvalidInput, MainOutboundWarehouseCode)
	}
	if len(matching) > 1 {
		return Location{}, fmt.Errorf("%w: more than one warehouse uses main outbound code %s", ErrInvalidInput, MainOutboundWarehouseCode)
	}
	return matching[0], nil
}

func isOutboundWarehouseCodePrefix(name string, code string) bool {
	if !strings.HasPrefix(name, code) || len(name) <= len(code) {
		return false
	}
	next := name[len(code)]
	return next < '0' || next > '9'
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
