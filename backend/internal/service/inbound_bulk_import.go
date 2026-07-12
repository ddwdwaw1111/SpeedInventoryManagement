package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jmoiron/sqlx"
	"github.com/xuri/excelize/v2"
)

const (
	MaxInboundBulkImportFileSize       = 10 << 20
	MaxInboundBulkImportRequestSize    = MaxInboundBulkImportFileSize + (1 << 20)
	MaxInboundBulkImportCommitBodySize = 20 << 20
	MaxInboundBulkImportRows           = 5000
	MaxInboundBulkImportDocuments      = 500

	InboundBulkIssueError   = "ERROR"
	InboundBulkIssueWarning = "WARNING"
)

const (
	bulkFieldDocumentKey       = "documentKey"
	bulkFieldContainerNo       = "containerNo"
	bulkFieldWarehouse         = "warehouse"
	bulkFieldActualArrivalDate = "actualArrivalDate"
	bulkFieldContainerType     = "containerType"
	bulkFieldHandlingMode      = "handlingMode"
	bulkFieldSKU               = "sku"
	bulkFieldItemNumber        = "itemNumber"
	bulkFieldDescription       = "description"
	bulkFieldExpectedQty       = "expectedQty"
	bulkFieldReceivedQty       = "receivedQty"
	bulkFieldPallets           = "pallets"
	bulkFieldUnitsPerPallet    = "unitsPerPallet"
	bulkFieldStorageSection    = "storageSection"
	bulkFieldLineNote          = "lineNote"
)

type InboundBulkImportIssue struct {
	Severity  string `json:"severity"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	RowNumber int    `json:"rowNumber,omitempty"`
	Field     string `json:"field,omitempty"`
	Value     string `json:"value,omitempty"`
}

type InboundBulkImportDocumentPreview struct {
	DocumentKey      string                     `json:"documentKey"`
	LocationName     string                     `json:"locationName"`
	RowNumbers       []int                      `json:"rowNumbers"`
	Input            CreateInboundDocumentInput `json:"input"`
	Issues           []InboundBulkImportIssue   `json:"issues"`
	Valid            bool                       `json:"valid"`
	TotalLines       int                        `json:"totalLines"`
	TotalExpectedQty int                        `json:"totalExpectedQty"`
	TotalReceivedQty int                        `json:"totalReceivedQty"`
	TotalPallets     int                        `json:"totalPallets"`
}

type InboundBulkImportPreview struct {
	ImportID         string                             `json:"importId"`
	SourceFileName   string                             `json:"sourceFileName"`
	CustomerID       int64                              `json:"customerId"`
	CustomerName     string                             `json:"customerName"`
	LocationCount    int                                `json:"locationCount"`
	TotalDocuments   int                                `json:"totalDocuments"`
	ValidDocuments   int                                `json:"validDocuments"`
	InvalidDocuments int                                `json:"invalidDocuments"`
	TotalLines       int                                `json:"totalLines"`
	Documents        []InboundBulkImportDocumentPreview `json:"documents"`
}

type InboundBulkImportCommitDocument struct {
	DocumentKey string                     `json:"documentKey"`
	Input       CreateInboundDocumentInput `json:"input"`
}

type InboundBulkImportCommitInput struct {
	ImportID       string                            `json:"importId"`
	SourceFileName string                            `json:"sourceFileName"`
	CustomerID     int64                             `json:"customerId"`
	Documents      []InboundBulkImportCommitDocument `json:"documents"`
}

type InboundBulkImportCommitResult struct {
	DocumentKey string           `json:"documentKey"`
	ContainerNo string           `json:"containerNo"`
	Success     bool             `json:"success"`
	Document    *InboundDocument `json:"document,omitempty"`
	Error       string           `json:"error,omitempty"`
}

type InboundBulkImportCommitResponse struct {
	SourceFileName   string                          `json:"sourceFileName"`
	TotalDocuments   int                             `json:"totalDocuments"`
	CreatedDocuments int                             `json:"createdDocuments"`
	FailedDocuments  int                             `json:"failedDocuments"`
	Results          []InboundBulkImportCommitResult `json:"results"`
}

type parsedInboundBulkDocument struct {
	preview  InboundBulkImportDocumentPreview
	lineRows []int
}

type inboundBulkHeaderValues struct {
	ContainerNo       string
	Warehouse         string
	ActualArrivalDate string
	ContainerType     string
	HandlingMode      string
}

type inboundBulkValidationContext struct {
	skuBySKU        map[string]SKUMaster
	skuByItemNumber map[string]SKUMaster
	validSections   map[string]bool
}

type inboundBulkImportRecord struct {
	DocumentID  int64
	PayloadHash string
}

func (s *Store) PreviewInboundBulkImport(ctx context.Context, fileName string, data []byte, customerID int64) (InboundBulkImportPreview, error) {
	if customerID <= 0 {
		return InboundBulkImportPreview{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if len(data) == 0 {
		return InboundBulkImportPreview{}, fmt.Errorf("%w: Excel file is empty", ErrInvalidInput)
	}
	if len(data) > MaxInboundBulkImportFileSize {
		return InboundBulkImportPreview{}, fmt.Errorf("%w: Excel file exceeds the 10 MB limit", ErrInvalidInput)
	}
	if strings.ToLower(filepath.Ext(fileName)) != ".xlsx" {
		return InboundBulkImportPreview{}, fmt.Errorf("%w: only .xlsx files are supported", ErrInvalidInput)
	}

	customer, err := s.getCustomer(ctx, customerID)
	if err != nil {
		return InboundBulkImportPreview{}, err
	}
	locations, err := s.ListLocations(ctx)
	if err != nil {
		return InboundBulkImportPreview{}, err
	}

	parsedDocuments, err := parseInboundBulkImportWorkbook(fileName, data)
	if err != nil {
		return InboundBulkImportPreview{}, fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
	}

	skuMasters, err := s.ListSKUMasters(ctx, "", customerID)
	if err != nil {
		return InboundBulkImportPreview{}, err
	}
	containerNos := make([]string, 0, len(parsedDocuments))
	for _, document := range parsedDocuments {
		if document.preview.Input.ContainerNo != "" {
			containerNos = append(containerNos, document.preview.Input.ContainerNo)
		}
	}
	existingContainers, err := s.loadExistingInboundContainerNumbers(ctx, customerID, containerNos)
	if err != nil {
		return InboundBulkImportPreview{}, err
	}

	preview := buildInboundBulkImportPreview(fileName, customer, locations, skuMasters, existingContainers, parsedDocuments)
	preview.ImportID, err = newInboundBulkImportID()
	if err != nil {
		return InboundBulkImportPreview{}, err
	}
	return preview, nil
}

func (s *Store) CreateInboundDocumentsBulkDraft(ctx context.Context, input InboundBulkImportCommitInput) (InboundBulkImportCommitResponse, error) {
	input.SourceFileName = strings.TrimSpace(filepath.Base(input.SourceFileName))
	importID, err := normalizeInboundBulkImportID(input.ImportID)
	if err != nil {
		return InboundBulkImportCommitResponse{}, err
	}
	if input.CustomerID <= 0 {
		return InboundBulkImportCommitResponse{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if len(input.Documents) == 0 {
		return InboundBulkImportCommitResponse{}, fmt.Errorf("%w: at least one valid receipt is required", ErrInvalidInput)
	}
	if len(input.Documents) > MaxInboundBulkImportDocuments {
		return InboundBulkImportCommitResponse{}, fmt.Errorf("%w: no more than %d receipts can be imported at once", ErrInvalidInput, MaxInboundBulkImportDocuments)
	}
	totalLines := 0
	for _, document := range input.Documents {
		totalLines += len(document.Input.Lines)
		if totalLines > MaxInboundBulkImportRows {
			return InboundBulkImportCommitResponse{}, fmt.Errorf("%w: no more than %d receipt lines can be imported at once", ErrInvalidInput, MaxInboundBulkImportRows)
		}
	}
	if _, err := s.getCustomer(ctx, input.CustomerID); err != nil {
		return InboundBulkImportCommitResponse{}, err
	}
	skuMasters, err := s.ListSKUMasters(ctx, "", input.CustomerID)
	if err != nil {
		return InboundBulkImportCommitResponse{}, err
	}
	validationContexts := make(map[int64]inboundBulkValidationContext)

	response := InboundBulkImportCommitResponse{
		SourceFileName: input.SourceFileName,
		TotalDocuments: len(input.Documents),
		Results:        make([]InboundBulkImportCommitResult, 0, len(input.Documents)),
	}
	seenDocumentKeys := make(map[string]struct{}, len(input.Documents))
	seenContainerNos := make(map[string]struct{}, len(input.Documents))

	for index, entry := range input.Documents {
		documentKey := strings.TrimSpace(strings.ToUpper(entry.DocumentKey))
		if documentKey == "" {
			documentKey = fmt.Sprintf("DOCUMENT-%d", index+1)
		}
		result := InboundBulkImportCommitResult{
			DocumentKey: documentKey,
			ContainerNo: strings.TrimSpace(strings.ToUpper(entry.Input.ContainerNo)),
		}

		if _, exists := seenDocumentKeys[documentKey]; exists {
			result.Error = "duplicate Document Key in import request"
			response.FailedDocuments++
			response.Results = append(response.Results, result)
			continue
		}
		seenDocumentKeys[documentKey] = struct{}{}

		documentInput := entry.Input
		documentInput.CustomerID = input.CustomerID
		documentInput.Status = DocumentStatusDraft
		documentInput.TrackingStatus = InboundTrackingScheduled
		documentInput.UnitLabel = "CTN"
		documentInput.ContainerNo = strings.TrimSpace(strings.ToUpper(documentInput.ContainerNo))
		if documentInput.ContainerNo == "" {
			result.Error = "container number is required"
			response.FailedDocuments++
			response.Results = append(response.Results, result)
			continue
		}
		if _, exists := seenContainerNos[documentInput.ContainerNo]; exists {
			result.Error = "duplicate Container No in import request"
			response.FailedDocuments++
			response.Results = append(response.Results, result)
			continue
		}
		seenContainerNos[documentInput.ContainerNo] = struct{}{}
		if documentInput.LocationID <= 0 {
			result.Error = "warehouse is required"
			response.FailedDocuments++
			response.Results = append(response.Results, result)
			continue
		}
		validationContext, exists := validationContexts[documentInput.LocationID]
		if !exists {
			location, locationErr := s.getLocation(ctx, documentInput.LocationID)
			if locationErr != nil {
				if !errors.Is(locationErr, ErrNotFound) {
					return InboundBulkImportCommitResponse{}, locationErr
				}
				result.Error = "warehouse does not exist"
				response.FailedDocuments++
				response.Results = append(response.Results, result)
				continue
			}
			validationContext = newInboundBulkValidationContext(location, skuMasters)
			validationContexts[documentInput.LocationID] = validationContext
		}
		for lineIndex := range documentInput.Lines {
			// Excel import records aggregate pallet counts only. It must never create
			// or accept individual pallet breakdown entities.
			documentInput.Lines[lineIndex].ReorderLevel = 0
			documentInput.Lines[lineIndex].PalletsDetailCtns = ""
			documentInput.Lines[lineIndex].PalletBreakdown = nil
		}
		documentInput, err = validateAndNormalizeInboundBulkCommitDocument(documentInput, validationContext)
		if err != nil {
			result.Error = err.Error()
			response.FailedDocuments++
			response.Results = append(response.Results, result)
			continue
		}
		result.ContainerNo = documentInput.ContainerNo
		payloadHash, err := inboundBulkImportPayloadHash(documentKey, documentInput)
		if err != nil {
			return InboundBulkImportCommitResponse{}, err
		}
		importKey := inboundBulkImportDocumentKey(importID, documentKey)
		if existing, found, err := s.getInboundBulkImportRecord(ctx, importKey); err != nil {
			return InboundBulkImportCommitResponse{}, err
		} else if found {
			if existing.PayloadHash != payloadHash {
				result.Error = "import Document Key was already used with different receipt data"
				response.FailedDocuments++
				response.Results = append(response.Results, result)
				continue
			}
			document, err := s.getInboundDocument(ctx, existing.DocumentID)
			if err != nil {
				return InboundBulkImportCommitResponse{}, err
			}
			result.Success = true
			result.ContainerNo = document.ContainerNo
			result.Document = &document
			response.CreatedDocuments++
			response.Results = append(response.Results, result)
			continue
		}
		documentInput.ImportKey = importKey
		documentInput.ImportPayloadHash = payloadHash

		document, err := s.CreateInboundDocument(ctx, documentInput)
		if err != nil {
			// A concurrent retry may have won the unique import-key insert. Resolve
			// that document after the insert conflict instead of creating a duplicate.
			if existing, found, lookupErr := s.getInboundBulkImportRecord(ctx, importKey); lookupErr != nil {
				return InboundBulkImportCommitResponse{}, lookupErr
			} else if found && existing.PayloadHash == payloadHash {
				document, lookupErr := s.getInboundDocument(ctx, existing.DocumentID)
				if lookupErr != nil {
					return InboundBulkImportCommitResponse{}, lookupErr
				}
				result.Success = true
				result.ContainerNo = document.ContainerNo
				result.Document = &document
				response.CreatedDocuments++
				response.Results = append(response.Results, result)
				continue
			}
			result.Error = err.Error()
			response.FailedDocuments++
			response.Results = append(response.Results, result)
			continue
		}

		result.Success = true
		result.ContainerNo = document.ContainerNo
		result.Document = &document
		response.CreatedDocuments++
		response.Results = append(response.Results, result)
	}

	return response, nil
}

func newInboundBulkImportID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate inbound bulk import id: %w", err)
	}
	return hex.EncodeToString(buffer), nil
}

func normalizeInboundBulkImportID(raw string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if len(normalized) != 32 {
		return "", fmt.Errorf("%w: a valid import id from the preview is required", ErrInvalidInput)
	}
	if _, err := hex.DecodeString(normalized); err != nil {
		return "", fmt.Errorf("%w: a valid import id from the preview is required", ErrInvalidInput)
	}
	return normalized, nil
}

func inboundBulkImportDocumentKey(importID string, documentKey string) string {
	digest := sha256.Sum256([]byte(importID + "\x00" + strings.ToUpper(strings.TrimSpace(documentKey))))
	return "bulk:" + hex.EncodeToString(digest[:])
}

func inboundBulkImportPayloadHash(documentKey string, input CreateInboundDocumentInput) (string, error) {
	payload := struct {
		DocumentKey string                     `json:"documentKey"`
		Input       CreateInboundDocumentInput `json:"input"`
	}{
		DocumentKey: strings.ToUpper(strings.TrimSpace(documentKey)),
		Input:       input,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode inbound bulk import payload: %w", err)
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func (s *Store) getInboundBulkImportRecord(ctx context.Context, importKey string) (inboundBulkImportRecord, bool, error) {
	var record inboundBulkImportRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT id, COALESCE(import_payload_hash, '')
		FROM inbound_documents
		WHERE import_key = ?
		LIMIT 1
	`, importKey).Scan(&record.DocumentID, &record.PayloadHash)
	if errors.Is(err, sql.ErrNoRows) {
		return inboundBulkImportRecord{}, false, nil
	}
	if err != nil {
		return inboundBulkImportRecord{}, false, fmt.Errorf("load inbound bulk import result: %w", err)
	}
	return record, true, nil
}

func newInboundBulkValidationContext(location Location, skuMasters []SKUMaster) inboundBulkValidationContext {
	context := inboundBulkValidationContext{
		skuBySKU:        make(map[string]SKUMaster, len(skuMasters)),
		skuByItemNumber: make(map[string]SKUMaster, len(skuMasters)),
		validSections:   map[string]bool{DefaultStorageSection: true},
	}
	for _, skuMaster := range skuMasters {
		context.skuBySKU[strings.ToUpper(strings.TrimSpace(skuMaster.SKU))] = skuMaster
		if itemNumber := strings.ToUpper(strings.TrimSpace(skuMaster.ItemNumber)); itemNumber != "" {
			context.skuByItemNumber[itemNumber] = skuMaster
		}
	}
	for _, section := range location.SectionNames {
		context.validSections[fallbackSection(strings.ToUpper(strings.TrimSpace(section)))] = true
	}
	return context
}

func validateAndNormalizeInboundBulkCommitDocument(input CreateInboundDocumentInput, validation inboundBulkValidationContext) (CreateInboundDocumentInput, error) {
	// Bulk receiving uses the actual arrival date as its only document date and
	// intentionally does not import document-level notes.
	input.ExpectedArrivalDate = ""
	input.DocumentNote = ""
	originalLineCount := len(input.Lines)
	input = sanitizeInboundDocumentInput(input)
	if len(input.Lines) != originalLineCount {
		return CreateInboundDocumentInput{}, fmt.Errorf("%w: every receipt line requires a SKU", ErrInvalidInput)
	}
	if input.ContainerNo == "" {
		return CreateInboundDocumentInput{}, fmt.Errorf("%w: container number is required", ErrInvalidInput)
	}
	if input.ActualArrivalDate == "" {
		return CreateInboundDocumentInput{}, fmt.Errorf("%w: actual arrival date is required", ErrInvalidInput)
	}
	if _, err := parseOptionalDate(input.ActualArrivalDate); err != nil {
		return CreateInboundDocumentInput{}, fmt.Errorf("%w: actual arrival date must use YYYY-MM-DD", ErrInvalidInput)
	}
	for index := range input.Lines {
		line := &input.Lines[index]
		if !validation.validSections[fallbackSection(line.StorageSection)] {
			return CreateInboundDocumentInput{}, fmt.Errorf("%w: storage section %s does not exist in the selected warehouse", ErrInvalidInput, line.StorageSection)
		}
		master, skuExists := validation.skuBySKU[line.SKU]
		if line.ItemNumber != "" {
			if itemMaster, itemExists := validation.skuByItemNumber[line.ItemNumber]; itemExists && !strings.EqualFold(itemMaster.SKU, line.SKU) {
				return CreateInboundDocumentInput{}, fmt.Errorf("%w: item code %s already belongs to sku %s", ErrInvalidInput, line.ItemNumber, itemMaster.SKU)
			}
		}
		if skuExists {
			masterItemNumber := strings.ToUpper(strings.TrimSpace(master.ItemNumber))
			if line.ItemNumber == "" {
				line.ItemNumber = masterItemNumber
			} else if masterItemNumber != "" && line.ItemNumber != masterItemNumber {
				return CreateInboundDocumentInput{}, fmt.Errorf("%w: sku %s already uses item code %s", ErrInvalidInput, line.SKU, masterItemNumber)
			}
			if line.Description == "" {
				line.Description = firstNonEmpty(master.Description, master.Name, master.SKU)
			}
			if line.UnitsPerPallet == 0 && master.DefaultUnitsPerPallet > 0 {
				line.UnitsPerPallet = master.DefaultUnitsPerPallet
			}
		} else if line.Description == "" {
			return CreateInboundDocumentInput{}, fmt.Errorf("%w: new sku %s requires a description", ErrInvalidInput, line.SKU)
		}
		if coalesceInboundHandlingMode(input.HandlingMode) == InboundHandlingModeSealedTransit {
			line.Pallets = 0
			line.UnitsPerPallet = 0
		}
	}
	if len(input.Lines) > 0 {
		input.StorageSection = input.Lines[0].StorageSection
	}
	if err := validateInboundDocumentInput(input); err != nil {
		return CreateInboundDocumentInput{}, err
	}
	return input, nil
}

func parseInboundBulkImportWorkbook(fileName string, data []byte) ([]parsedInboundBulkDocument, error) {
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
		return nil, fmt.Errorf("read worksheet %s: %w", sheets[0], err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("the first worksheet is empty")
	}
	if len(rows) > MaxInboundBulkImportRows+20 {
		return nil, fmt.Errorf("the workbook exceeds the %d row limit", MaxInboundBulkImportRows)
	}

	headerRowIndex, columns, err := findInboundBulkImportHeader(rows)
	if err != nil {
		return nil, err
	}

	documents := make([]parsedInboundBulkDocument, 0)
	documentIndexes := make(map[string]int)
	importedRowCount := 0
	for rowIndex := headerRowIndex + 1; rowIndex < len(rows); rowIndex++ {
		row := rows[rowIndex]
		if inboundBulkRowIsEmpty(row) {
			continue
		}
		importedRowCount++
		if importedRowCount > MaxInboundBulkImportRows {
			return nil, fmt.Errorf("the workbook exceeds the %d row limit", MaxInboundBulkImportRows)
		}
		rowNumber := rowIndex + 1
		documentKey := strings.TrimSpace(strings.ToUpper(inboundBulkCell(row, columns[bulkFieldDocumentKey])))
		missingDocumentKey := documentKey == ""
		if missingDocumentKey {
			documentKey = fmt.Sprintf("ROW-%d", rowNumber)
		}

		documentIndex, exists := documentIndexes[documentKey]
		if !exists {
			if len(documents) >= MaxInboundBulkImportDocuments {
				return nil, fmt.Errorf("the workbook exceeds the %d receipt limit", MaxInboundBulkImportDocuments)
			}
			headerValues, headerIssues := parseInboundBulkHeaderValues(row, rowNumber, columns)
			documents = append(documents, parsedInboundBulkDocument{
				preview: InboundBulkImportDocumentPreview{
					DocumentKey:  documentKey,
					LocationName: headerValues.Warehouse,
					RowNumbers:   []int{rowNumber},
					Input: CreateInboundDocumentInput{
						ContainerNo:       headerValues.ContainerNo,
						ActualArrivalDate: headerValues.ActualArrivalDate,
						ContainerType:     headerValues.ContainerType,
						HandlingMode:      headerValues.HandlingMode,
						Status:            DocumentStatusDraft,
						TrackingStatus:    InboundTrackingScheduled,
						UnitLabel:         "CTN",
						Lines:             make([]CreateInboundDocumentLineInput, 0),
					},
					Issues: headerIssues,
				},
				lineRows: make([]int, 0),
			})
			documentIndex = len(documents) - 1
			documentIndexes[documentKey] = documentIndex
		} else {
			documents[documentIndex].preview.RowNumbers = append(documents[documentIndex].preview.RowNumbers, rowNumber)
			applyInboundBulkHeaderValues(&documents[documentIndex].preview, row, rowNumber, columns)
		}

		document := &documents[documentIndex]
		if missingDocumentKey {
			document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
				InboundBulkIssueError,
				"MISSING_DOCUMENT_KEY",
				"Document Key is required.",
				rowNumber,
				bulkFieldDocumentKey,
				"",
			))
		}
		line, lineIssues := parseInboundBulkLine(row, rowNumber, columns)
		document.preview.Issues = append(document.preview.Issues, lineIssues...)
		document.preview.Input.Lines = append(document.preview.Input.Lines, line)
		document.lineRows = append(document.lineRows, rowNumber)
	}

	if len(documents) == 0 {
		return nil, fmt.Errorf("no importable receipt rows were found")
	}
	return documents, nil
}

func findInboundBulkImportHeader(rows [][]string) (int, map[string]int, error) {
	requiredFields := []string{
		bulkFieldDocumentKey,
		bulkFieldContainerNo,
		bulkFieldWarehouse,
		bulkFieldActualArrivalDate,
		bulkFieldSKU,
		bulkFieldExpectedQty,
		bulkFieldReceivedQty,
		bulkFieldPallets,
		bulkFieldUnitsPerPallet,
	}
	maxRows := min(len(rows), 20)
	for rowIndex := 0; rowIndex < maxRows; rowIndex++ {
		columns := make(map[string]int)
		for columnIndex, value := range rows[rowIndex] {
			if field := canonicalInboundBulkHeader(value); field != "" {
				if _, exists := columns[field]; !exists {
					columns[field] = columnIndex
				}
			}
		}
		missing := make([]string, 0)
		for _, field := range requiredFields {
			if _, exists := columns[field]; !exists {
				missing = append(missing, inboundBulkTemplateHeader(field))
			}
		}
		if len(missing) == 0 {
			return rowIndex, columns, nil
		}
	}

	return -1, nil, fmt.Errorf("could not find the standard header row; download and use the latest batch receipt template")
}

func canonicalInboundBulkHeader(value string) string {
	normalized := normalizeInboundBulkHeader(value)
	aliases := map[string]string{
		"DOCUMENTKEY":       bulkFieldDocumentKey,
		"RECEIPTKEY":        bulkFieldDocumentKey,
		"CONTAINERNO":       bulkFieldContainerNo,
		"CONTAINERNUMBER":   bulkFieldContainerNo,
		"WAREHOUSE":         bulkFieldWarehouse,
		"WAREHOUSENAME":     bulkFieldWarehouse,
		"LOCATION":          bulkFieldWarehouse,
		"ACTUALARRIVALDATE": bulkFieldActualArrivalDate,
		"ARRIVALDATE":       bulkFieldActualArrivalDate,
		"CONTAINERTYPE":     bulkFieldContainerType,
		"HANDLINGMODE":      bulkFieldHandlingMode,
		"SKU":               bulkFieldSKU,
		"ITEMCODE":          bulkFieldItemNumber,
		"ITEMNUMBER":        bulkFieldItemNumber,
		"DESCRIPTION":       bulkFieldDescription,
		"EXPECTEDQTY":       bulkFieldExpectedQty,
		"EXPECTEDQUANTITY":  bulkFieldExpectedQty,
		"RECEIVEDQTY":       bulkFieldReceivedQty,
		"RECEIVEDQUANTITY":  bulkFieldReceivedQty,
		"PALLETS":           bulkFieldPallets,
		"PALLETQTY":         bulkFieldPallets,
		"PALLETCOUNT":       bulkFieldPallets,
		"CTNPERPALLET":      bulkFieldUnitsPerPallet,
		"CARTONSPERPALLET":  bulkFieldUnitsPerPallet,
		"STORAGESECTION":    bulkFieldStorageSection,
		"SECTION":           bulkFieldStorageSection,
		"LINENOTE":          bulkFieldLineNote,
	}
	return aliases[normalized]
}

func normalizeInboundBulkHeader(value string) string {
	return strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			return unicode.ToUpper(character)
		}
		return -1
	}, strings.TrimSpace(value))
}

func inboundBulkTemplateHeader(field string) string {
	headers := map[string]string{
		bulkFieldDocumentKey:       "Document Key",
		bulkFieldContainerNo:       "Container No",
		bulkFieldWarehouse:         "Warehouse",
		bulkFieldActualArrivalDate: "Actual Arrival Date",
		bulkFieldContainerType:     "Container Type",
		bulkFieldHandlingMode:      "Handling Mode",
		bulkFieldSKU:               "SKU",
		bulkFieldItemNumber:        "Item Code",
		bulkFieldDescription:       "Description",
		bulkFieldExpectedQty:       "Expected Qty",
		bulkFieldReceivedQty:       "Received Qty",
		bulkFieldPallets:           "Pallets",
		bulkFieldUnitsPerPallet:    "CTN per Pallet",
		bulkFieldStorageSection:    "Storage Section",
		bulkFieldLineNote:          "Line Note",
	}
	return headers[field]
}

func parseInboundBulkHeaderValues(row []string, rowNumber int, columns map[string]int) (inboundBulkHeaderValues, []InboundBulkImportIssue) {
	issues := make([]InboundBulkImportIssue, 0)
	containerNo := strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, bulkFieldContainerNo)))
	if containerNo == "" {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "MISSING_CONTAINER_NO", "Container No is required.", rowNumber, bulkFieldContainerNo, ""))
	}
	warehouse := strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, bulkFieldWarehouse)))
	if warehouse == "" {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "MISSING_WAREHOUSE", "Warehouse is required.", rowNumber, bulkFieldWarehouse, ""))
	}
	actualDate, validActualDate := normalizeInboundBulkDate(inboundBulkColumnValue(row, columns, bulkFieldActualArrivalDate))
	if !validActualDate {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_ACTUAL_DATE", "Actual Arrival Date must use YYYY-MM-DD.", rowNumber, bulkFieldActualArrivalDate, inboundBulkColumnValue(row, columns, bulkFieldActualArrivalDate)))
	} else if actualDate == "" {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "MISSING_ACTUAL_DATE", "Actual Arrival Date is required.", rowNumber, bulkFieldActualArrivalDate, ""))
	}
	containerType, validContainerType := normalizeInboundBulkContainerType(inboundBulkColumnValue(row, columns, bulkFieldContainerType))
	if !validContainerType {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_CONTAINER_TYPE", "Container Type must be NORMAL or WEST_COAST_TRANSFER.", rowNumber, bulkFieldContainerType, inboundBulkColumnValue(row, columns, bulkFieldContainerType)))
	}
	handlingMode, validHandlingMode := normalizeInboundBulkHandlingMode(inboundBulkColumnValue(row, columns, bulkFieldHandlingMode))
	if !validHandlingMode {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_HANDLING_MODE", "Handling Mode must be PALLETIZED or SEALED_TRANSIT.", rowNumber, bulkFieldHandlingMode, inboundBulkColumnValue(row, columns, bulkFieldHandlingMode)))
	}

	return inboundBulkHeaderValues{
		ContainerNo:       containerNo,
		Warehouse:         warehouse,
		ActualArrivalDate: actualDate,
		ContainerType:     containerType,
		HandlingMode:      handlingMode,
	}, issues
}

func applyInboundBulkHeaderValues(document *InboundBulkImportDocumentPreview, row []string, rowNumber int, columns map[string]int) {
	next, issues := parseInboundBulkHeaderValues(row, rowNumber, columns)
	document.Issues = append(document.Issues, issues...)

	conflicts := []struct {
		field    string
		current  string
		next     string
		required bool
	}{
		{bulkFieldContainerNo, document.Input.ContainerNo, next.ContainerNo, true},
		{bulkFieldWarehouse, document.LocationName, next.Warehouse, true},
		{bulkFieldActualArrivalDate, document.Input.ActualArrivalDate, next.ActualArrivalDate, true},
		{bulkFieldContainerType, document.Input.ContainerType, next.ContainerType, false},
		{bulkFieldHandlingMode, document.Input.HandlingMode, next.HandlingMode, false},
	}
	for _, candidate := range conflicts {
		if inboundBulkColumnValue(row, columns, candidate.field) == "" && !candidate.required {
			continue
		}
		if candidate.current != candidate.next {
			document.Issues = append(document.Issues, inboundBulkIssue(
				InboundBulkIssueError,
				"HEADER_CONFLICT",
				fmt.Sprintf("Rows with the same Document Key have conflicting %s values.", inboundBulkTemplateHeader(candidate.field)),
				rowNumber,
				candidate.field,
				candidate.next,
			))
		}
	}
}

func parseInboundBulkLine(row []string, rowNumber int, columns map[string]int) (CreateInboundDocumentLineInput, []InboundBulkImportIssue) {
	issues := make([]InboundBulkImportIssue, 0)
	line := CreateInboundDocumentLineInput{
		ItemNumber:     strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, bulkFieldItemNumber))),
		SKU:            strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, bulkFieldSKU))),
		Description:    strings.TrimSpace(inboundBulkColumnValue(row, columns, bulkFieldDescription)),
		StorageSection: fallbackSection(strings.TrimSpace(strings.ToUpper(inboundBulkColumnValue(row, columns, bulkFieldStorageSection)))),
		LineNote:       strings.TrimSpace(inboundBulkColumnValue(row, columns, bulkFieldLineNote)),
	}
	if line.SKU == "" {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "MISSING_SKU", "SKU is required.", rowNumber, bulkFieldSKU, ""))
	}

	var valid bool
	line.ExpectedQty, valid = parseInboundBulkNonNegativeInt(inboundBulkColumnValue(row, columns, bulkFieldExpectedQty))
	if !valid {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_EXPECTED_QTY", "Expected Qty must be a non-negative whole number.", rowNumber, bulkFieldExpectedQty, inboundBulkColumnValue(row, columns, bulkFieldExpectedQty)))
	}
	line.ReceivedQty, valid = parseInboundBulkNonNegativeInt(inboundBulkColumnValue(row, columns, bulkFieldReceivedQty))
	if !valid {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_RECEIVED_QTY", "Received Qty must be a non-negative whole number.", rowNumber, bulkFieldReceivedQty, inboundBulkColumnValue(row, columns, bulkFieldReceivedQty)))
	}
	line.Pallets, valid = parseInboundBulkNonNegativeInt(inboundBulkColumnValue(row, columns, bulkFieldPallets))
	if !valid {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_PALLETS", "Pallets must be a non-negative whole number.", rowNumber, bulkFieldPallets, inboundBulkColumnValue(row, columns, bulkFieldPallets)))
	}
	line.UnitsPerPallet, valid = parseInboundBulkNonNegativeInt(inboundBulkColumnValue(row, columns, bulkFieldUnitsPerPallet))
	if !valid {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "INVALID_CTN_PER_PALLET", "CTN per Pallet must be a non-negative whole number.", rowNumber, bulkFieldUnitsPerPallet, inboundBulkColumnValue(row, columns, bulkFieldUnitsPerPallet)))
	}
	if line.ExpectedQty == 0 && line.ReceivedQty == 0 {
		issues = append(issues, inboundBulkIssue(InboundBulkIssueError, "QUANTITY_REQUIRED", "Expected Qty or Received Qty is required.", rowNumber, bulkFieldReceivedQty, ""))
	}

	return line, issues
}

func buildInboundBulkImportPreview(
	fileName string,
	customer Customer,
	locations []Location,
	skuMasters []SKUMaster,
	existingContainers map[string]bool,
	parsedDocuments []parsedInboundBulkDocument,
) InboundBulkImportPreview {
	preview := InboundBulkImportPreview{
		SourceFileName: strings.TrimSpace(filepath.Base(fileName)),
		CustomerID:     customer.ID,
		CustomerName:   customer.Name,
		Documents:      make([]InboundBulkImportDocumentPreview, 0, len(parsedDocuments)),
	}

	skuBySKU := make(map[string]SKUMaster, len(skuMasters))
	skuByItemNumber := make(map[string]SKUMaster, len(skuMasters))
	for _, skuMaster := range skuMasters {
		skuBySKU[strings.TrimSpace(strings.ToUpper(skuMaster.SKU))] = skuMaster
		if itemNumber := strings.TrimSpace(strings.ToUpper(skuMaster.ItemNumber)); itemNumber != "" {
			skuByItemNumber[itemNumber] = skuMaster
		}
	}
	locationsByName := make(map[string]Location, len(locations))
	for _, location := range locations {
		locationsByName[strings.TrimSpace(strings.ToUpper(location.Name))] = location
	}
	usedLocations := make(map[int64]struct{})

	containerDocuments := make(map[string][]int)
	for index := range parsedDocuments {
		document := &parsedDocuments[index]
		document.preview.Input.CustomerID = customer.ID
		document.preview.Input.Status = DocumentStatusDraft
		document.preview.Input.TrackingStatus = InboundTrackingScheduled
		document.preview.Input.UnitLabel = "CTN"
		if len(document.preview.Input.Lines) > 0 {
			document.preview.Input.StorageSection = document.preview.Input.Lines[0].StorageSection
		}
		validSections := map[string]bool{DefaultStorageSection: true}
		location, locationExists := locationsByName[strings.TrimSpace(strings.ToUpper(document.preview.LocationName))]
		if !locationExists && document.preview.LocationName != "" {
			document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
				InboundBulkIssueError,
				"INVALID_WAREHOUSE",
				"Warehouse does not exist.",
				firstInboundBulkRowNumber(document.preview.RowNumbers),
				bulkFieldWarehouse,
				document.preview.LocationName,
			))
		} else {
			document.preview.Input.LocationID = location.ID
			document.preview.LocationName = location.Name
			usedLocations[location.ID] = struct{}{}
			for _, section := range location.SectionNames {
				validSections[fallbackSection(strings.TrimSpace(strings.ToUpper(section)))] = true
			}
		}

		for lineIndex := range document.preview.Input.Lines {
			line := &document.preview.Input.Lines[lineIndex]
			rowNumber := document.lineRows[lineIndex]
			if !validSections[fallbackSection(line.StorageSection)] {
				document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
					InboundBulkIssueError,
					"INVALID_STORAGE_SECTION",
					"Storage Section does not exist in the selected warehouse.",
					rowNumber,
					bulkFieldStorageSection,
					line.StorageSection,
				))
			}

			master, skuExists := skuBySKU[line.SKU]
			if itemMaster, itemExists := skuByItemNumber[line.ItemNumber]; line.ItemNumber != "" && itemExists && itemMaster.SKU != line.SKU {
				document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
					InboundBulkIssueError,
					"ITEM_CODE_SKU_CONFLICT",
					fmt.Sprintf("Item Code %s is already linked to SKU %s.", line.ItemNumber, itemMaster.SKU),
					rowNumber,
					bulkFieldItemNumber,
					line.ItemNumber,
				))
			}
			if skuExists {
				masterItemNumber := strings.TrimSpace(strings.ToUpper(master.ItemNumber))
				if line.ItemNumber == "" {
					line.ItemNumber = masterItemNumber
				} else if masterItemNumber != "" && line.ItemNumber != masterItemNumber {
					document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
						InboundBulkIssueError,
						"SKU_ITEM_CODE_MISMATCH",
						fmt.Sprintf("SKU %s already uses Item Code %s.", line.SKU, masterItemNumber),
						rowNumber,
						bulkFieldItemNumber,
						line.ItemNumber,
					))
				}
				if line.Description == "" {
					line.Description = firstNonEmpty(master.Description, master.Name, master.SKU)
				}
				if line.UnitsPerPallet == 0 && master.DefaultUnitsPerPallet > 0 {
					line.UnitsPerPallet = master.DefaultUnitsPerPallet
				} else if line.UnitsPerPallet > 0 && master.DefaultUnitsPerPallet > 0 && line.UnitsPerPallet != master.DefaultUnitsPerPallet {
					document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
						InboundBulkIssueWarning,
						"CTN_PER_PALLET_DEFAULT_MISMATCH",
						fmt.Sprintf("CTN per Pallet differs from the SKU default of %d.", master.DefaultUnitsPerPallet),
						rowNumber,
						bulkFieldUnitsPerPallet,
						strconv.Itoa(line.UnitsPerPallet),
					))
				}
			} else if line.SKU != "" && line.Description == "" {
				document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
					InboundBulkIssueError,
					"NEW_SKU_DESCRIPTION_REQUIRED",
					fmt.Sprintf("New SKU %s requires a description.", line.SKU),
					rowNumber,
					bulkFieldDescription,
					line.SKU,
				))
			}

			quantity := line.ReceivedQty
			if quantity == 0 {
				quantity = line.ExpectedQty
			}
			if document.preview.Input.HandlingMode == InboundHandlingModeSealedTransit {
				if line.Pallets > 0 || line.UnitsPerPallet > 0 {
					document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
						InboundBulkIssueWarning,
						"SEALED_TRANSIT_PALLET_VALUES_IGNORED",
						"Pallet values are ignored for sealed-transit receipts.",
						rowNumber,
						bulkFieldPallets,
						"",
					))
				}
				line.Pallets = 0
				line.UnitsPerPallet = 0
			} else if quantity > 0 && line.Pallets == 0 {
				document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
					InboundBulkIssueWarning,
					"ZERO_PALLETS",
					"Quantity is present but Pallets is 0.",
					rowNumber,
					bulkFieldPallets,
					"0",
				))
			}

			document.preview.TotalExpectedQty += line.ExpectedQty
			document.preview.TotalReceivedQty += line.ReceivedQty
			document.preview.TotalPallets += line.Pallets
		}

		document.preview.TotalLines = len(document.preview.Input.Lines)
		containerNo := strings.TrimSpace(strings.ToUpper(document.preview.Input.ContainerNo))
		if existingContainers[containerNo] {
			document.preview.Issues = append(document.preview.Issues, inboundBulkIssue(
				InboundBulkIssueWarning,
				"EXISTING_CONTAINER",
				"An active receipt already uses this Container No.",
				0,
				bulkFieldContainerNo,
				containerNo,
			))
		}
		if containerNo != "" {
			containerDocuments[containerNo] = append(containerDocuments[containerNo], index)
		}
	}

	for containerNo, indexes := range containerDocuments {
		if len(indexes) < 2 {
			continue
		}
		for _, index := range indexes {
			parsedDocuments[index].preview.Issues = append(parsedDocuments[index].preview.Issues, inboundBulkIssue(
				InboundBulkIssueError,
				"DUPLICATE_CONTAINER_IN_FILE",
				"The same Container No is assigned to multiple Document Keys in this file.",
				0,
				bulkFieldContainerNo,
				containerNo,
			))
		}
	}

	for index := range parsedDocuments {
		document := parsedDocuments[index].preview
		sort.SliceStable(document.Issues, func(left, right int) bool {
			if document.Issues[left].Severity != document.Issues[right].Severity {
				return document.Issues[left].Severity == InboundBulkIssueError
			}
			return document.Issues[left].RowNumber < document.Issues[right].RowNumber
		})
		document.Valid = true
		for _, issue := range document.Issues {
			if issue.Severity == InboundBulkIssueError {
				document.Valid = false
				break
			}
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
	return preview
}

func firstInboundBulkRowNumber(rowNumbers []int) int {
	if len(rowNumbers) == 0 {
		return 0
	}
	return rowNumbers[0]
}

func (s *Store) loadExistingInboundContainerNumbers(ctx context.Context, customerID int64, containerNos []string) (map[string]bool, error) {
	result := make(map[string]bool)
	seen := make(map[string]bool)
	unique := make([]string, 0, len(containerNos))
	for _, containerNo := range containerNos {
		normalized := strings.TrimSpace(strings.ToUpper(containerNo))
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		result[normalized] = false
		unique = append(unique, normalized)
	}
	if len(unique) == 0 {
		return result, nil
	}

	query, args, err := sqlx.In(`
		SELECT DISTINCT UPPER(TRIM(container_no))
		FROM inbound_documents
		WHERE customer_id = ?
			AND cancelled_at IS NULL
			AND archived_at IS NULL
			AND UPPER(TRIM(container_no)) IN (?)
	`, customerID, unique)
	if err != nil {
		return nil, fmt.Errorf("build existing inbound container query: %w", err)
	}
	rows, err := s.db.QueryxContext(ctx, s.db.Rebind(query), args...)
	if err != nil {
		return nil, fmt.Errorf("load existing inbound containers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var containerNo string
		if err := rows.Scan(&containerNo); err != nil {
			return nil, fmt.Errorf("scan existing inbound container: %w", err)
		}
		result[strings.TrimSpace(strings.ToUpper(containerNo))] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing inbound containers: %w", err)
	}
	return result, nil
}

func inboundBulkIssue(severity string, code string, message string, rowNumber int, field string, value string) InboundBulkImportIssue {
	return InboundBulkImportIssue{
		Severity:  severity,
		Code:      code,
		Message:   message,
		RowNumber: rowNumber,
		Field:     field,
		Value:     strings.TrimSpace(value),
	}
}

func inboundBulkRowIsEmpty(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func inboundBulkCell(row []string, columnIndex int) string {
	if columnIndex < 0 || columnIndex >= len(row) {
		return ""
	}
	return row[columnIndex]
}

func inboundBulkColumnValue(row []string, columns map[string]int, field string) string {
	columnIndex, exists := columns[field]
	if !exists {
		return ""
	}
	return strings.TrimSpace(inboundBulkCell(row, columnIndex))
}

func parseInboundBulkNonNegativeInt(value string) (int, bool) {
	trimmed := strings.TrimSpace(strings.ReplaceAll(value, ",", ""))
	if trimmed == "" {
		return 0, true
	}
	number, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || math.Trunc(number) != number || number > math.MaxInt32 {
		return 0, false
	}
	return int(number), true
}

func normalizeInboundBulkDate(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", true
	}
	if serial, err := strconv.ParseFloat(trimmed, 64); err == nil && serial > 0 {
		date, err := excelize.ExcelDateToTime(serial, false)
		if err == nil {
			return date.Format("2006-01-02"), true
		}
	}
	for _, layout := range []string{"2006-01-02", "1/2/2006", "01/02/2006", "1/2/06", "Jan 2, 2006", "January 2, 2006"} {
		if date, err := time.Parse(layout, trimmed); err == nil {
			return date.Format("2006-01-02"), true
		}
	}
	return "", false
}

func normalizeInboundBulkContainerType(value string) (string, bool) {
	normalized := normalizeInboundBulkHeader(value)
	switch normalized {
	case "", "NORMAL":
		return ContainerTypeNormal, true
	case "WESTCOASTTRANSFER", "TRANSFER":
		return ContainerTypeWestCoastTransfer, true
	default:
		return ContainerTypeNormal, false
	}
}

func normalizeInboundBulkHandlingMode(value string) (string, bool) {
	normalized := normalizeInboundBulkHeader(value)
	switch normalized {
	case "", "PALLETIZED", "PALLETISED":
		return InboundHandlingModePalletized, true
	case "SEALEDTRANSIT", "SEALED":
		return InboundHandlingModeSealedTransit, true
	default:
		return InboundHandlingModePalletized, false
	}
}
