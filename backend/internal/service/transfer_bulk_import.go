package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/xuri/excelize/v2"
)

const (
	MaxTransferBulkImportRows = 500

	transferBulkFieldTransferNo         = "transferNo"
	transferBulkFieldMode               = "transferMode"
	transferBulkFieldDate               = "transferDate"
	transferBulkFieldContainerNo        = "containerNo"
	transferBulkFieldFromWarehouse      = "fromWarehouse"
	transferBulkFieldFromStorageSection = "fromStorageSection"
	transferBulkFieldToWarehouse        = "toWarehouse"
	transferBulkFieldToStorageSection   = "toStorageSection"
	transferBulkFieldSKU                = "sku"
	transferBulkFieldItemCode           = "itemCode"
	transferBulkFieldQuantity           = "quantity"
	transferBulkFieldSourcePallets      = "sourcePallets"
	transferBulkFieldDestinationPallets = "destinationPallets"

	transferBulkModeFullContainer = "FULL_CONTAINER"
	transferBulkModePartial       = "PARTIAL"
)

type BulkTransferImportIssue struct {
	Severity  string `json:"severity"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	RowNumber int    `json:"rowNumber,omitempty"`
	Field     string `json:"field,omitempty"`
	Value     string `json:"value,omitempty"`
}

type BulkTransferImportInput struct {
	TransferNo         string `json:"transferNo"`
	TransferMode       string `json:"transferMode"`
	TransferDate       string `json:"transferDate"`
	ContainerNo        string `json:"containerNo"`
	FromLocationID     int64  `json:"fromLocationId"`
	FromStorageSection string `json:"fromStorageSection"`
	ToLocationID       int64  `json:"toLocationId"`
	ToStorageSection   string `json:"toStorageSection"`
	SKU                string `json:"sku"`
	ItemCode           string `json:"itemCode"`
	Quantity           *int   `json:"quantity"`
	SourcePallets      *int   `json:"sourcePallets"`
	DestinationPallets *int   `json:"destinationPallets"`
}

type BulkTransferImportPreviewRow struct {
	DocumentKey      string                    `json:"documentKey"`
	RowNumber        int                       `json:"rowNumber"`
	FromLocationName string                    `json:"fromLocationName"`
	ToLocationName   string                    `json:"toLocationName"`
	Input            BulkTransferImportInput   `json:"input"`
	TotalQuantity    int                       `json:"totalQuantity"`
	TotalPallets     int                       `json:"totalPallets"`
	Issues           []BulkTransferImportIssue `json:"issues"`
	Valid            bool                      `json:"valid"`
}

type BulkTransferImportPreview struct {
	ImportBatchID    int64                          `json:"importBatchId,omitempty"`
	ImportID         string                         `json:"importId"`
	SourceFileName   string                         `json:"sourceFileName"`
	CustomerID       int64                          `json:"customerId"`
	CustomerName     string                         `json:"customerName"`
	TotalTransfers   int                            `json:"totalTransfers"`
	ValidTransfers   int                            `json:"validTransfers"`
	InvalidTransfers int                            `json:"invalidTransfers"`
	Rows             []BulkTransferImportPreviewRow `json:"rows"`
}

type BulkTransferImportRevalidateInput struct {
	ImportID       string                         `json:"importId"`
	SourceFileName string                         `json:"sourceFileName"`
	CustomerID     int64                          `json:"customerId"`
	Rows           []BulkTransferImportPreviewRow `json:"rows"`
}

type BulkTransferImportCommitRow struct {
	DocumentKey string                  `json:"documentKey"`
	Input       BulkTransferImportInput `json:"input"`
}

type BulkTransferImportCommitInput struct {
	ImportID       string                        `json:"importId"`
	SourceFileName string                        `json:"sourceFileName"`
	CustomerID     int64                         `json:"customerId"`
	Rows           []BulkTransferImportCommitRow `json:"rows"`
	ImportBatchID  int64                         `json:"-"`
}

type BulkTransferImportCommitResult struct {
	DocumentKey  string             `json:"documentKey"`
	DocumentKeys []string           `json:"-"`
	ContainerNo  string             `json:"containerNo"`
	Success      bool               `json:"success"`
	Transfer     *InventoryTransfer `json:"transfer,omitempty"`
	Error        string             `json:"error,omitempty"`
}

type BulkTransferImportCommitResponse struct {
	ImportBatchID    int64                            `json:"importBatchId,omitempty"`
	SourceFileName   string                           `json:"sourceFileName"`
	TotalTransfers   int                              `json:"totalTransfers"`
	CreatedTransfers int                              `json:"createdTransfers"`
	FailedTransfers  int                              `json:"failedTransfers"`
	Results          []BulkTransferImportCommitResult `json:"results"`
	RetentionWarning string                           `json:"retentionWarning,omitempty"`
}

type parsedBulkTransferImportRow struct {
	documentKey string
	rowNumber   int
	input       BulkTransferImportInput
	fromName    string
	toName      string
	issues      []BulkTransferImportIssue
}

func (s *Store) PreviewBulkTransferImport(ctx context.Context, fileName string, data []byte, customerID int64) (BulkTransferImportPreview, error) {
	if customerID <= 0 {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if len(data) == 0 {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: Excel file is empty", ErrInvalidInput)
	}
	if len(data) > MaxInboundBulkImportFileSize {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: Excel file exceeds the 10 MB limit", ErrInvalidInput)
	}
	if strings.ToLower(filepath.Ext(fileName)) != ".xlsx" {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: only .xlsx files are supported", ErrInvalidInput)
	}
	rows, err := parseBulkTransferImportWorkbook(data)
	if err != nil {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
	}
	preview, err := s.buildBulkTransferImportPreview(ctx, fileName, customerID, rows)
	if err != nil {
		return BulkTransferImportPreview{}, err
	}
	preview.ImportID, err = newInboundBulkImportID()
	if err != nil {
		return BulkTransferImportPreview{}, err
	}
	return preview, nil
}

func (s *Store) RevalidateBulkTransferImport(ctx context.Context, input BulkTransferImportRevalidateInput) (BulkTransferImportPreview, error) {
	importID, err := normalizeInboundBulkImportID(input.ImportID)
	if err != nil {
		return BulkTransferImportPreview{}, err
	}
	if input.CustomerID <= 0 {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if len(input.Rows) == 0 || len(input.Rows) > MaxTransferBulkImportRows {
		return BulkTransferImportPreview{}, fmt.Errorf("%w: between 1 and %d container transfers are required", ErrInvalidInput, MaxTransferBulkImportRows)
	}
	rows := make([]parsedBulkTransferImportRow, 0, len(input.Rows))
	for index, entry := range input.Rows {
		rowNumber := entry.RowNumber
		if rowNumber <= 0 {
			rowNumber = index + 1
		}
		documentKey := strings.TrimSpace(entry.DocumentKey)
		if documentKey == "" {
			documentKey = fmt.Sprintf("ROW-%d", rowNumber)
		}
		rows = append(rows, parsedBulkTransferImportRow{
			documentKey: documentKey,
			rowNumber:   rowNumber,
			input:       entry.Input,
		})
	}
	preview, err := s.buildBulkTransferImportPreview(ctx, input.SourceFileName, input.CustomerID, rows)
	if err != nil {
		return BulkTransferImportPreview{}, err
	}
	preview.ImportID = importID
	return preview, nil
}

func (s *Store) CreateBulkTransfers(ctx context.Context, input BulkTransferImportCommitInput) (BulkTransferImportCommitResponse, error) {
	input.SourceFileName = strings.TrimSpace(filepath.Base(input.SourceFileName))
	if _, err := normalizeInboundBulkImportID(input.ImportID); err != nil {
		return BulkTransferImportCommitResponse{}, err
	}
	if input.CustomerID <= 0 {
		return BulkTransferImportCommitResponse{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if len(input.Rows) == 0 || len(input.Rows) > MaxTransferBulkImportRows {
		return BulkTransferImportCommitResponse{}, fmt.Errorf("%w: between 1 and %d container transfers are required", ErrInvalidInput, MaxTransferBulkImportRows)
	}
	if _, err := s.getCustomer(ctx, input.CustomerID); err != nil {
		return BulkTransferImportCommitResponse{}, err
	}

	response := BulkTransferImportCommitResponse{
		SourceFileName: input.SourceFileName,
		Results:        make([]BulkTransferImportCommitResult, 0, len(input.Rows)),
	}
	seenKeys := make(map[string]struct{}, len(input.Rows))
	groups := make(map[string]*bulkTransferImportCommitGroup)
	groupOrder := make([]string, 0, len(input.Rows))
	for index, entry := range input.Rows {
		documentKey := strings.TrimSpace(entry.DocumentKey)
		if documentKey == "" {
			documentKey = fmt.Sprintf("ROW-%d", index+1)
		}
		key := strings.ToUpper(documentKey)
		if _, exists := seenKeys[key]; exists {
			return BulkTransferImportCommitResponse{}, fmt.Errorf("%w: duplicate spreadsheet row key in import request", ErrInvalidInput)
		}
		seenKeys[key] = struct{}{}
		entry.Input.TransferNo = strings.TrimSpace(entry.Input.TransferNo)
		groupKey := bulkTransferImportCommitGroupKey(entry.Input.TransferNo, documentKey)
		group := groups[groupKey]
		if group == nil {
			group = &bulkTransferImportCommitGroup{key: groupKey, documentKey: documentKey, requestedTransferNo: entry.Input.TransferNo}
			groups[groupKey] = group
			groupOrder = append(groupOrder, groupKey)
		}
		group.rows = append(group.rows, BulkTransferImportCommitRow{DocumentKey: documentKey, Input: entry.Input})
	}
	response.TotalTransfers = len(groupOrder)
	itemsByLocation := make(map[int64][]Item)
	for _, groupKey := range groupOrder {
		group := groups[groupKey]
		result := BulkTransferImportCommitResult{DocumentKey: group.documentKey, DocumentKeys: bulkTransferImportGroupDocumentKeys(group.rows), ContainerNo: bulkTransferImportGroupContainerLabel(group.rows)}
		if group.requestedTransferNo != "" {
			result.DocumentKey = group.requestedTransferNo
		}

		if input.ImportBatchID > 0 {
			if transfer, found, err := s.getRecordedBulkTransferForRows(ctx, input.ImportBatchID, group.rows); err != nil {
				return BulkTransferImportCommitResponse{}, err
			} else if found {
				for _, row := range group.rows {
					if err := s.RecordBulkImportBatchDocument(ctx, input.ImportBatchID, BulkImportCommitRecord{
						DocumentKey: row.DocumentKey, DocumentID: transfer.ID, ReferenceCode: result.ContainerNo, Success: true,
					}); err != nil {
						return BulkTransferImportCommitResponse{}, err
					}
				}
				result.Success = true
				result.Transfer = &transfer
				response.CreatedTransfers++
				response.Results = append(response.Results, result)
				continue
			}
		}

		transferInput, err := s.buildBulkTransferImportCommitInput(ctx, input.CustomerID, input.ImportID, group, itemsByLocation)
		if err != nil {
			result.Error = err.Error()
			response.FailedTransfers++
			response.Results = append(response.Results, result)
			continue
		}
		transfer, err := s.CreateInventoryTransfer(ctx, transferInput)
		if err != nil {
			// Recover only a transfer created by this same retained import. A user
			// supplied Transfer No must not accidentally claim an unrelated record.
			if existing, found, lookupErr := s.getBulkTransferByNo(ctx, transferInput.TransferNo); lookupErr != nil {
				return BulkTransferImportCommitResponse{}, lookupErr
			} else if found && bulkTransferImportNoteMatches(existing.Notes, input.ImportID) {
				transfer = existing
			} else {
				result.Error = err.Error()
				response.FailedTransfers++
				response.Results = append(response.Results, result)
				continue
			}
		}
		result.Success = true
		result.Transfer = &transfer
		response.CreatedTransfers++
		response.Results = append(response.Results, result)
		if input.ImportBatchID > 0 {
			for _, row := range group.rows {
				if err := s.RecordBulkImportBatchDocument(ctx, input.ImportBatchID, BulkImportCommitRecord{
					DocumentKey: row.DocumentKey, DocumentID: transfer.ID, ReferenceCode: result.ContainerNo, Success: true,
				}); err != nil {
					return BulkTransferImportCommitResponse{}, err
				}
			}
		}
	}
	return response, nil
}

type bulkTransferImportCommitGroup struct {
	key                 string
	documentKey         string
	requestedTransferNo string
	rows                []BulkTransferImportCommitRow
}

func bulkTransferImportCommitGroupKey(transferNo string, documentKey string) string {
	if normalized := strings.ToUpper(strings.TrimSpace(transferNo)); normalized != "" {
		return "TRANSFER:" + normalized
	}
	return "ROW:" + strings.ToUpper(strings.TrimSpace(documentKey))
}

func bulkTransferImportGroupContainerLabel(rows []BulkTransferImportCommitRow) string {
	containers := make([]string, 0, len(rows))
	for _, row := range rows {
		containerNo := normalizeContainerNo(row.Input.ContainerNo)
		if containerNo == "" || bulkTransferStringInSlice(containers, containerNo) {
			continue
		}
		containers = append(containers, containerNo)
	}
	if len(containers) == 1 {
		return containers[0]
	}
	if len(containers) == 0 {
		return ""
	}
	return fmt.Sprintf("%d containers", len(containers))
}

func bulkTransferImportGroupDocumentKeys(rows []BulkTransferImportCommitRow) []string {
	keys := make([]string, 0, len(rows))
	for _, row := range rows {
		documentKey := strings.TrimSpace(row.DocumentKey)
		if documentKey != "" {
			keys = append(keys, documentKey)
		}
	}
	return keys
}

func bulkTransferStringInSlice(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (s *Store) getRecordedBulkTransferForRows(ctx context.Context, batchID int64, rows []BulkTransferImportCommitRow) (InventoryTransfer, bool, error) {
	for _, row := range rows {
		transfer, found, err := s.getRecordedBulkTransfer(ctx, batchID, row.DocumentKey)
		if err != nil || found {
			return transfer, found, err
		}
	}
	return InventoryTransfer{}, false, nil
}

func (s *Store) buildBulkTransferImportCommitInput(
	ctx context.Context,
	customerID int64,
	importID string,
	group *bulkTransferImportCommitGroup,
	itemsByLocation map[int64][]Item,
) (CreateInventoryTransferInput, error) {
	if group == nil || len(group.rows) == 0 {
		return CreateInventoryTransferInput{}, fmt.Errorf("%w: transfer group is required", ErrInvalidInput)
	}
	first := group.rows[0].Input
	mode, validMode := normalizeBulkTransferMode(first.TransferMode)
	if !validMode {
		return CreateInventoryTransferInput{}, fmt.Errorf("%w: Transfer Mode must be FULL_CONTAINER or PARTIAL", ErrInvalidInput)
	}
	transferDate, validDate := normalizeInboundBulkDate(first.TransferDate)
	if !validDate || transferDate == "" {
		return CreateInventoryTransferInput{}, fmt.Errorf("%w: Transfer Date is required and must use YYYY-MM-DD", ErrInvalidInput)
	}
	for _, row := range group.rows {
		rowMode, rowModeValid := normalizeBulkTransferMode(row.Input.TransferMode)
		rowDate, rowDateValid := normalizeInboundBulkDate(row.Input.TransferDate)
		if !rowModeValid || rowMode != mode || !rowDateValid || rowDate != transferDate {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: all rows with the same Transfer No must use the same transfer date and mode", ErrInvalidInput)
		}
	}
	transferInput := CreateInventoryTransferInput{
		TransferNo:          bulkTransferImportTransferNo(importID, group.key),
		ActualTransferredAt: transferDate,
	}
	if group.requestedTransferNo != "" {
		transferInput.TransferNo = strings.ToUpper(group.requestedTransferNo)
	}
	transferInput.Notes = bulkTransferImportNote(importID, group.requestedTransferNo)
	if group.requestedTransferNo == "" {
		transferInput.Notes = bulkTransferImportNote(importID, transferInput.TransferNo)
	}
	if mode == transferBulkModeFullContainer {
		if len(group.rows) != 1 {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: a Transfer No can contain only one full-container row", ErrInvalidInput)
		}
		row := group.rows[0].Input
		if normalizeContainerNo(row.ContainerNo) == "" || row.FromLocationID <= 0 || row.ToLocationID <= 0 {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: Container No, From Warehouse, and To Warehouse are required", ErrInvalidInput)
		}
		if row.FromLocationID == row.ToLocationID {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: From Warehouse and To Warehouse must be different", ErrInvalidInput)
		}
		if row.SKU != "" || row.Quantity != nil || row.SourcePallets != nil || row.DestinationPallets != nil {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: full-container transfers must leave SKU, quantity, and pallet fields blank", ErrInvalidInput)
		}
		transferInput.EntireContainer = &CreateEntireContainerTransferInput{
			CustomerID:       customerID,
			LocationID:       row.FromLocationID,
			ContainerNo:      normalizeContainerNo(row.ContainerNo),
			ToLocationID:     row.ToLocationID,
			ToStorageSection: fallbackSection(row.ToStorageSection),
		}
		return transferInput, nil
	}

	transferInput.Lines = make([]CreateInventoryTransferLineInput, 0, len(group.rows))
	for _, commitRow := range group.rows {
		row := commitRow.Input
		if normalizeContainerNo(row.ContainerNo) == "" || row.FromLocationID <= 0 || row.ToLocationID <= 0 || normalizeBulkTransferSKU(row.SKU) == "" {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: partial transfers require Container No, From Warehouse, To Warehouse, and SKU", ErrInvalidInput)
		}
		if row.FromLocationID == row.ToLocationID {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: From Warehouse and To Warehouse must be different", ErrInvalidInput)
		}
		if row.Quantity == nil || *row.Quantity <= 0 || row.SourcePallets == nil || row.DestinationPallets == nil {
			return CreateInventoryTransferInput{}, fmt.Errorf("%w: partial transfers require Transfer Qty and both pallet fields; enter 0 for a pallet field when applicable", ErrInvalidInput)
		}
		item, err := s.resolveBulkTransferImportSourceItem(ctx, customerID, row, itemsByLocation)
		if err != nil {
			return CreateInventoryTransferInput{}, err
		}
		transferInput.Lines = append(transferInput.Lines, CreateInventoryTransferLineInput{
			CustomerID:         customerID,
			LocationID:         row.FromLocationID,
			StorageSection:     fallbackSection(row.FromStorageSection),
			ContainerNo:        normalizeContainerNo(row.ContainerNo),
			SKUMasterID:        item.SKUMasterID,
			Quantity:           *row.Quantity,
			SourcePallets:      *row.SourcePallets,
			DestinationPallets: *row.DestinationPallets,
			ToLocationID:       row.ToLocationID,
			ToStorageSection:   fallbackSection(row.ToStorageSection),
			LineNote:           "Bulk partial transfer",
		})
	}
	return transferInput, nil
}

func bulkTransferImportNote(importID string, transferNo string) string {
	return fmt.Sprintf("Bulk transfer import %s; transfer group %s", strings.ToLower(strings.TrimSpace(importID)), strings.TrimSpace(transferNo))
}

func bulkTransferImportNoteMatches(notes string, importID string) bool {
	return strings.Contains(strings.ToLower(notes), "bulk transfer import "+strings.ToLower(strings.TrimSpace(importID))+";")
}

func (s *Store) resolveBulkTransferImportSourceItem(ctx context.Context, customerID int64, input BulkTransferImportInput, itemsByLocation map[int64][]Item) (Item, error) {
	items, loaded := itemsByLocation[input.FromLocationID]
	if !loaded {
		var err error
		items, err = s.ListItems(ctx, ItemFilters{CustomerID: customerID, LocationID: input.FromLocationID})
		if err != nil {
			return Item{}, err
		}
		itemsByLocation[input.FromLocationID] = items
	}
	containerNo := normalizeContainerNo(input.ContainerNo)
	sku := normalizeBulkTransferSKU(input.SKU)
	section := fallbackSection(input.FromStorageSection)
	for _, item := range items {
		if normalizeContainerNo(item.ContainerNo) == containerNo && normalizeBulkTransferSKU(item.SKU) == sku && fallbackSection(item.StorageSection) == section {
			return item, nil
		}
	}
	return Item{}, fmt.Errorf("%w: container %q has no inventory for SKU %q in source storage section %q", ErrInvalidInput, containerNo, sku, section)
}

func (s *Store) getRecordedBulkTransfer(ctx context.Context, batchID int64, documentKey string) (InventoryTransfer, bool, error) {
	var transferID int64
	err := s.db.QueryRowContext(ctx, `
		SELECT document_id
		FROM bulk_import_batch_documents
		WHERE batch_id = ? AND document_key = ? AND status = 'CREATED' AND document_id IS NOT NULL
	`, batchID, strings.TrimSpace(documentKey)).Scan(&transferID)
	if err != nil {
		if err == sql.ErrNoRows {
			return InventoryTransfer{}, false, nil
		}
		return InventoryTransfer{}, false, fmt.Errorf("load retained bulk transfer result: %w", err)
	}
	transfer, err := s.getInventoryTransfer(ctx, transferID)
	if err != nil {
		return InventoryTransfer{}, false, err
	}
	return transfer, true, nil
}

func (s *Store) getBulkTransferByNo(ctx context.Context, transferNo string) (InventoryTransfer, bool, error) {
	var transferID int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM inventory_transfers WHERE transfer_no = ?`, transferNo).Scan(&transferID)
	if err != nil {
		if err == sql.ErrNoRows {
			return InventoryTransfer{}, false, nil
		}
		return InventoryTransfer{}, false, fmt.Errorf("load retained bulk transfer: %w", err)
	}
	transfer, err := s.getInventoryTransfer(ctx, transferID)
	if err != nil {
		return InventoryTransfer{}, false, err
	}
	return transfer, true, nil
}

func bulkTransferImportTransferNo(importID string, documentKey string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(importID)) + "\x00" + strings.ToUpper(strings.TrimSpace(documentKey))))
	return fmt.Sprintf("BULK-TRN-%x", digest[:10])
}

func (s *Store) buildBulkTransferImportPreview(ctx context.Context, fileName string, customerID int64, parsedRows []parsedBulkTransferImportRow) (BulkTransferImportPreview, error) {
	customer, err := s.getCustomer(ctx, customerID)
	if err != nil {
		return BulkTransferImportPreview{}, err
	}
	locations, err := s.ListLocations(ctx)
	if err != nil {
		return BulkTransferImportPreview{}, err
	}
	locationsByID := make(map[int64]Location, len(locations))
	locationsByName := make(map[string]Location, len(locations))
	for _, location := range locations {
		locationsByID[location.ID] = location
		locationsByName[normalizeBulkTransferLocationName(location.Name)] = location
	}

	preview := BulkTransferImportPreview{
		SourceFileName: strings.TrimSpace(filepath.Base(fileName)),
		CustomerID:     customerID,
		CustomerName:   customer.Name,
		Rows:           make([]BulkTransferImportPreviewRow, 0, len(parsedRows)),
	}
	inventoryBySource := make(map[int64]map[string]bulkTransferInventoryTotals)
	availableBySource := make(map[int64]map[string]bulkTransferInventoryAvailability)
	fullContainerRows := make(map[string]int)
	containerRows := make(map[string][]int)
	for index := range parsedRows {
		parsed := parsedRows[index]
		row := BulkTransferImportPreviewRow{
			DocumentKey: parsed.documentKey,
			RowNumber:   parsed.rowNumber,
			Input:       parsed.input,
			Issues:      append([]BulkTransferImportIssue(nil), parsed.issues...),
		}
		if row.DocumentKey == "" {
			row.DocumentKey = fmt.Sprintf("ROW-%d", row.RowNumber)
		}
		if row.RowNumber <= 0 {
			row.RowNumber = index + 1
		}
		row.Input.TransferNo = strings.TrimSpace(row.Input.TransferNo)
		mode, validMode := normalizeBulkTransferMode(row.Input.TransferMode)
		if !validMode {
			row.Issues = append(row.Issues, bulkTransferIssue("INVALID_TRANSFER_MODE", "Transfer Mode must be FULL_CONTAINER or PARTIAL.", row.RowNumber, transferBulkFieldMode, row.Input.TransferMode))
		} else {
			row.Input.TransferMode = mode
		}
		row.Input.ContainerNo = normalizeContainerNo(row.Input.ContainerNo)
		row.Input.SKU = normalizeBulkTransferSKU(row.Input.SKU)
		row.Input.ItemCode = strings.TrimSpace(row.Input.ItemCode)
		if mode == transferBulkModePartial {
			row.Input.FromStorageSection = fallbackSection(row.Input.FromStorageSection)
		} else {
			row.Input.FromStorageSection = strings.TrimSpace(row.Input.FromStorageSection)
		}
		row.Input.ToStorageSection = fallbackSection(row.Input.ToStorageSection)

		date, validDate := normalizeInboundBulkDate(row.Input.TransferDate)
		if !validDate || date == "" {
			row.Issues = append(row.Issues, bulkTransferIssue("INVALID_TRANSFER_DATE", "Transfer Date is required and must use YYYY-MM-DD.", row.RowNumber, transferBulkFieldDate, row.Input.TransferDate))
		} else {
			row.Input.TransferDate = date
		}
		if row.Input.ContainerNo == "" {
			row.Issues = append(row.Issues, bulkTransferIssue("MISSING_CONTAINER_NO", "Container No is required.", row.RowNumber, transferBulkFieldContainerNo, ""))
		}
		from, fromOK := resolveBulkTransferLocation(parsed.input.FromLocationID, parsed.fromName, locationsByID, locationsByName)
		if !fromOK {
			row.Issues = append(row.Issues, bulkTransferIssue("INVALID_FROM_WAREHOUSE", "From Warehouse does not exist.", row.RowNumber, transferBulkFieldFromWarehouse, parsed.fromName))
		} else {
			row.Input.FromLocationID = from.ID
			row.FromLocationName = from.Name
		}
		to, toOK := resolveBulkTransferLocation(parsed.input.ToLocationID, parsed.toName, locationsByID, locationsByName)
		if !toOK {
			row.Issues = append(row.Issues, bulkTransferIssue("INVALID_TO_WAREHOUSE", "To Warehouse does not exist.", row.RowNumber, transferBulkFieldToWarehouse, parsed.toName))
		} else {
			row.Input.ToLocationID = to.ID
			row.ToLocationName = to.Name
		}
		if fromOK && toOK && from.ID == to.ID {
			row.Issues = append(row.Issues, bulkTransferIssue("SAME_WAREHOUSE", "From Warehouse and To Warehouse must be different.", row.RowNumber, transferBulkFieldToWarehouse, to.Name))
		}
		if fromOK && row.Input.ContainerNo != "" && validMode {
			containerKey := fmt.Sprintf("%d:%s", from.ID, row.Input.ContainerNo)
			if mode == transferBulkModeFullContainer {
				if previousRows := containerRows[containerKey]; len(previousRows) > 0 {
					row.Issues = append(row.Issues, bulkTransferIssue("CONFLICTING_CONTAINER_TRANSFER", fmt.Sprintf("This source container is also used on row %d. A full-container transfer cannot be combined with another transfer row.", previousRows[0]), row.RowNumber, transferBulkFieldContainerNo, row.Input.ContainerNo))
					for _, previousRow := range previousRows {
						appendBulkTransferIssueToPreviewRow(preview.Rows, previousRow, bulkTransferIssue("CONFLICTING_CONTAINER_TRANSFER", fmt.Sprintf("This source container is also used on row %d, which is a full-container transfer.", row.RowNumber), previousRow, transferBulkFieldContainerNo, row.Input.ContainerNo))
					}
				}
				fullContainerRows[containerKey] = row.RowNumber
			} else if fullRow, exists := fullContainerRows[containerKey]; exists {
				row.Issues = append(row.Issues, bulkTransferIssue("CONFLICTING_CONTAINER_TRANSFER", fmt.Sprintf("This source container is moved in full on row %d, so it cannot also have a partial transfer.", fullRow), row.RowNumber, transferBulkFieldContainerNo, row.Input.ContainerNo))
				appendBulkTransferIssueToPreviewRow(preview.Rows, fullRow, bulkTransferIssue("CONFLICTING_CONTAINER_TRANSFER", fmt.Sprintf("This full-container transfer conflicts with the partial transfer on row %d.", row.RowNumber), fullRow, transferBulkFieldContainerNo, row.Input.ContainerNo))
			}
			containerRows[containerKey] = append(containerRows[containerKey], row.RowNumber)
		}
		if fromOK && row.Input.ContainerNo != "" {
			if _, loaded := inventoryBySource[from.ID]; !loaded {
				items, itemErr := s.ListItems(ctx, ItemFilters{CustomerID: customerID, LocationID: from.ID})
				if itemErr != nil {
					return BulkTransferImportPreview{}, itemErr
				}
				inventoryBySource[from.ID] = summarizeBulkTransferInventory(items)
				availableBySource[from.ID] = summarizeBulkTransferInventoryAvailability(items)
			}
			if mode == transferBulkModeFullContainer {
				totals, exists := inventoryBySource[from.ID][row.Input.ContainerNo]
				if !exists {
					row.Issues = append(row.Issues, bulkTransferIssue("SOURCE_CONTAINER_NOT_FOUND", "This container has no inventory in the selected From Warehouse.", row.RowNumber, transferBulkFieldContainerNo, row.Input.ContainerNo))
				} else {
					row.TotalQuantity = totals.quantity
					row.TotalPallets = totals.pallets
					if totals.hasReservedStock {
						row.Issues = append(row.Issues, bulkTransferIssue("SOURCE_CONTAINER_RESERVED", "This container has inventory reserved or on hold. Release the related draft shipment or hold before moving the entire container.", row.RowNumber, transferBulkFieldContainerNo, row.Input.ContainerNo))
					}
				}
				if strings.TrimSpace(parsed.input.FromStorageSection) != "" {
					row.Issues = append(row.Issues, bulkTransferIssue("FULL_TRANSFER_SOURCE_SECTION", "Full-container transfers move every source storage section. Leave From Storage Section blank.", row.RowNumber, transferBulkFieldFromStorageSection, parsed.input.FromStorageSection))
				}
				if row.Input.SKU != "" || row.Input.Quantity != nil || row.Input.SourcePallets != nil || row.Input.DestinationPallets != nil {
					row.Issues = append(row.Issues, bulkTransferIssue("FULL_TRANSFER_LINE_VALUES", "Full-container transfers derive SKU, quantity, and pallet values from current inventory. Leave the line-level fields blank.", row.RowNumber, transferBulkFieldMode, row.Input.TransferMode))
				}
			} else if mode == transferBulkModePartial {
				validateBulkTransferPartialRow(&row, availableBySource[from.ID])
			}
		}
		preview.Rows = append(preview.Rows, row)
	}
	validateBulkTransferImportGroups(preview.Rows)
	preview.TotalTransfers, preview.ValidTransfers, preview.InvalidTransfers = summarizeBulkTransferPreviewGroups(preview.Rows)
	return preview, nil
}

func summarizeBulkTransferPreviewGroups(rows []BulkTransferImportPreviewRow) (total int, valid int, invalid int) {
	groupValidity := make(map[string]bool, len(rows))
	for index := range rows {
		rows[index].Valid = !bulkTransferHasErrors(rows[index].Issues)
		groupKey := bulkTransferGroupKey(rows[index])
		if _, exists := groupValidity[groupKey]; !exists {
			groupValidity[groupKey] = true
		}
		if !rows[index].Valid {
			groupValidity[groupKey] = false
		}
	}
	for _, groupIsValid := range groupValidity {
		total++
		if groupIsValid {
			valid++
		} else {
			invalid++
		}
	}
	return total, valid, invalid
}

func normalizeBulkTransferMode(value string) (string, bool) {
	switch normalizeBulkTransferHeader(value) {
	case "", "FULL", "FULLCONTAINER", "WHOLE", "WHOLECONTAINER":
		return transferBulkModeFullContainer, true
	case "PARTIAL":
		return transferBulkModePartial, true
	default:
		return "", false
	}
}

func normalizeBulkTransferSKU(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

type bulkTransferInventoryAvailability struct {
	quantity int
	pallets  int
}

func bulkTransferInventoryAvailabilityKey(containerNo string, sku string, storageSection string) string {
	return strings.Join([]string{normalizeContainerNo(containerNo), normalizeBulkTransferSKU(sku), fallbackSection(storageSection)}, "\x00")
}

func summarizeBulkTransferInventoryAvailability(items []Item) map[string]bulkTransferInventoryAvailability {
	availability := make(map[string]bulkTransferInventoryAvailability, len(items))
	for _, item := range items {
		key := bulkTransferInventoryAvailabilityKey(item.ContainerNo, item.SKU, item.StorageSection)
		if normalizeContainerNo(item.ContainerNo) == "" {
			continue
		}
		current := availability[key]
		current.quantity += item.AvailableQty
		current.pallets += item.AvailablePallets
		availability[key] = current
	}
	return availability
}

func validateBulkTransferPartialRow(row *BulkTransferImportPreviewRow, availability map[string]bulkTransferInventoryAvailability) {
	if row.Input.SKU == "" {
		row.Issues = append(row.Issues, bulkTransferIssue("MISSING_SKU", "SKU is required for a partial transfer.", row.RowNumber, transferBulkFieldSKU, ""))
	}
	if row.Input.Quantity == nil || *row.Input.Quantity <= 0 {
		row.Issues = append(row.Issues, bulkTransferIssue("INVALID_PARTIAL_QUANTITY", "Transfer Qty is required and must be greater than zero for a partial transfer.", row.RowNumber, transferBulkFieldQuantity, ""))
	}
	if row.Input.SourcePallets == nil {
		row.Issues = append(row.Issues, bulkTransferIssue("MISSING_SOURCE_PALLETS", "Source Inventory Pallets Released is required. Enter 0 when no whole source pallet was released.", row.RowNumber, transferBulkFieldSourcePallets, ""))
	}
	if row.Input.DestinationPallets == nil {
		row.Issues = append(row.Issues, bulkTransferIssue("MISSING_DESTINATION_PALLETS", "Destination Inventory Pallets Created is required. Enter 0 when no new destination pallet was created.", row.RowNumber, transferBulkFieldDestinationPallets, ""))
	}
	if row.Input.SKU == "" || row.Input.Quantity == nil || *row.Input.Quantity <= 0 || row.Input.SourcePallets == nil || row.Input.DestinationPallets == nil {
		return
	}
	key := bulkTransferInventoryAvailabilityKey(row.Input.ContainerNo, row.Input.SKU, row.Input.FromStorageSection)
	available, exists := availability[key]
	if !exists || available.quantity <= 0 && available.pallets <= 0 {
		row.Issues = append(row.Issues, bulkTransferIssue("SOURCE_SKU_NOT_FOUND", fmt.Sprintf("Container %q has no available inventory for SKU %q in storage section %q.", row.Input.ContainerNo, row.Input.SKU, row.Input.FromStorageSection), row.RowNumber, transferBulkFieldSKU, row.Input.SKU))
		return
	}
	row.TotalQuantity = available.quantity
	row.TotalPallets = available.pallets
	if *row.Input.Quantity > available.quantity {
		row.Issues = append(row.Issues, bulkTransferIssue("INSUFFICIENT_TRANSFER_QTY", fmt.Sprintf("Transfer Qty is %d CTN, but only %d CTN is available for this container/SKU after earlier workbook rows.", *row.Input.Quantity, available.quantity), row.RowNumber, transferBulkFieldQuantity, strconv.Itoa(*row.Input.Quantity)))
	}
	if *row.Input.SourcePallets > available.pallets {
		row.Issues = append(row.Issues, bulkTransferIssue("INSUFFICIENT_SOURCE_PALLETS", fmt.Sprintf("Source Inventory Pallets Released is %d, but only %d source pallets are available after earlier workbook rows.", *row.Input.SourcePallets, available.pallets), row.RowNumber, transferBulkFieldSourcePallets, strconv.Itoa(*row.Input.SourcePallets)))
	}
	if bulkTransferHasErrors(row.Issues) {
		return
	}
	available.quantity -= *row.Input.Quantity
	available.pallets -= *row.Input.SourcePallets
	availability[key] = available
}

func appendBulkTransferIssueToPreviewRow(rows []BulkTransferImportPreviewRow, rowNumber int, issue BulkTransferImportIssue) {
	if previous := findBulkTransferPreviewRow(rows, rowNumber); previous != nil {
		previous.Issues = append(previous.Issues, issue)
	}
}

func bulkTransferGroupKey(row BulkTransferImportPreviewRow) string {
	if transferNo := strings.ToUpper(strings.TrimSpace(row.Input.TransferNo)); transferNo != "" {
		return "TRANSFER:" + transferNo
	}
	return "ROW:" + strings.ToUpper(strings.TrimSpace(row.DocumentKey))
}

func validateBulkTransferImportGroups(rows []BulkTransferImportPreviewRow) {
	groups := make(map[string][]int)
	for index := range rows {
		groups[bulkTransferGroupKey(rows[index])] = append(groups[bulkTransferGroupKey(rows[index])], index)
	}
	for _, indexes := range groups {
		if len(indexes) == 0 {
			continue
		}
		first := rows[indexes[0]]
		groupHasError := false
		for _, index := range indexes {
			row := rows[index]
			if row.Input.TransferMode != first.Input.TransferMode {
				groupHasError = true
			}
			if row.Input.TransferDate != first.Input.TransferDate {
				groupHasError = true
			}
			if bulkTransferHasErrors(row.Issues) {
				groupHasError = true
			}
		}
		if first.Input.TransferMode == transferBulkModeFullContainer && len(indexes) > 1 {
			groupHasError = true
		}
		if !groupHasError {
			continue
		}
		for _, index := range indexes {
			message := "All rows with the same Transfer No must be valid and use the same transfer date and mode."
			if first.Input.TransferMode == transferBulkModeFullContainer && len(indexes) > 1 {
				message = "A Transfer No can contain only one full-container row. Use separate Transfer Nos for separate full-container transfers."
			}
			rows[index].Issues = append(rows[index].Issues, bulkTransferIssue("INVALID_TRANSFER_GROUP", message, rows[index].RowNumber, transferBulkFieldTransferNo, rows[index].Input.TransferNo))
		}
	}
}

type bulkTransferInventoryTotals struct {
	quantity         int
	pallets          int
	hasReservedStock bool
}

func summarizeBulkTransferInventory(items []Item) map[string]bulkTransferInventoryTotals {
	totals := make(map[string]bulkTransferInventoryTotals)
	for _, item := range items {
		containerNo := normalizeContainerNo(item.ContainerNo)
		if containerNo == "" {
			continue
		}
		current := totals[containerNo]
		current.quantity += item.Quantity
		current.pallets += item.Pallets
		current.hasReservedStock = current.hasReservedStock || item.AvailableQty != item.Quantity || item.AvailablePallets != item.Pallets
		totals[containerNo] = current
	}
	return totals
}

func findBulkTransferPreviewRow(rows []BulkTransferImportPreviewRow, rowNumber int) *BulkTransferImportPreviewRow {
	for index := range rows {
		if rows[index].RowNumber == rowNumber {
			return &rows[index]
		}
	}
	return nil
}

func resolveBulkTransferLocation(locationID int64, locationName string, locationsByID map[int64]Location, locationsByName map[string]Location) (Location, bool) {
	if locationID > 0 {
		location, exists := locationsByID[locationID]
		return location, exists
	}
	location, exists := locationsByName[normalizeBulkTransferLocationName(locationName)]
	return location, exists
}

func parseBulkTransferImportWorkbook(data []byte) ([]parsedBulkTransferImportRow, error) {
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
	headerRowIndex, columns, err := findBulkTransferImportHeader(rows)
	if err != nil {
		return nil, err
	}
	parsedRows := make([]parsedBulkTransferImportRow, 0)
	for rowIndex := headerRowIndex + 1; rowIndex < len(rows); rowIndex++ {
		row := rows[rowIndex]
		if bulkTransferRowIsEmpty(row) {
			continue
		}
		if len(parsedRows) >= MaxTransferBulkImportRows {
			return nil, fmt.Errorf("the workbook exceeds the %d transfer limit", MaxTransferBulkImportRows)
		}
		rowNumber := rowIndex + 1
		parsedRows = append(parsedRows, parsedBulkTransferImportRow{
			documentKey: fmt.Sprintf("ROW-%d", rowNumber),
			rowNumber:   rowNumber,
			input: BulkTransferImportInput{
				TransferNo:         bulkTransferColumnValue(row, columns, transferBulkFieldTransferNo),
				TransferMode:       bulkTransferColumnValue(row, columns, transferBulkFieldMode),
				TransferDate:       bulkTransferColumnValue(row, columns, transferBulkFieldDate),
				ContainerNo:        bulkTransferColumnValue(row, columns, transferBulkFieldContainerNo),
				FromStorageSection: bulkTransferColumnValue(row, columns, transferBulkFieldFromStorageSection),
				ToStorageSection:   bulkTransferColumnValue(row, columns, transferBulkFieldToStorageSection),
				SKU:                bulkTransferColumnValue(row, columns, transferBulkFieldSKU),
				ItemCode:           bulkTransferColumnValue(row, columns, transferBulkFieldItemCode),
			},
			fromName: bulkTransferColumnValue(row, columns, transferBulkFieldFromWarehouse),
			toName:   bulkTransferColumnValue(row, columns, transferBulkFieldToWarehouse),
		})
		parsed := &parsedRows[len(parsedRows)-1]
		var valid bool
		if parsed.input.Quantity, valid = parseBulkTransferOptionalNonNegativeInt(bulkTransferColumnValue(row, columns, transferBulkFieldQuantity)); !valid {
			parsed.issues = append(parsed.issues, bulkTransferIssue("INVALID_QUANTITY", "Transfer Qty must be a non-negative whole number.", rowNumber, transferBulkFieldQuantity, bulkTransferColumnValue(row, columns, transferBulkFieldQuantity)))
		}
		if parsed.input.SourcePallets, valid = parseBulkTransferOptionalNonNegativeInt(bulkTransferColumnValue(row, columns, transferBulkFieldSourcePallets)); !valid {
			parsed.issues = append(parsed.issues, bulkTransferIssue("INVALID_SOURCE_PALLETS", "Source Inventory Pallets Released must be a non-negative whole number.", rowNumber, transferBulkFieldSourcePallets, bulkTransferColumnValue(row, columns, transferBulkFieldSourcePallets)))
		}
		if parsed.input.DestinationPallets, valid = parseBulkTransferOptionalNonNegativeInt(bulkTransferColumnValue(row, columns, transferBulkFieldDestinationPallets)); !valid {
			parsed.issues = append(parsed.issues, bulkTransferIssue("INVALID_DESTINATION_PALLETS", "Destination Inventory Pallets Created must be a non-negative whole number.", rowNumber, transferBulkFieldDestinationPallets, bulkTransferColumnValue(row, columns, transferBulkFieldDestinationPallets)))
		}
	}
	if len(parsedRows) == 0 {
		return nil, fmt.Errorf("no importable container transfer rows were found")
	}
	return parsedRows, nil
}

func findBulkTransferImportHeader(rows [][]string) (int, map[string]int, error) {
	requiredFields := []string{transferBulkFieldDate, transferBulkFieldContainerNo, transferBulkFieldFromWarehouse, transferBulkFieldToWarehouse}
	maxRows := min(len(rows), 20)
	for rowIndex := 0; rowIndex < maxRows; rowIndex++ {
		columns := make(map[string]int)
		for columnIndex, value := range rows[rowIndex] {
			if field := canonicalBulkTransferHeader(value); field != "" {
				if _, exists := columns[field]; !exists {
					columns[field] = columnIndex
				}
			}
		}
		allFound := true
		for _, field := range requiredFields {
			if _, exists := columns[field]; !exists {
				allFound = false
				break
			}
		}
		if allFound {
			return rowIndex, columns, nil
		}
	}
	return -1, nil, fmt.Errorf("could not find the standard header row; download and use the latest batch transfer template")
}

func canonicalBulkTransferHeader(value string) string {
	aliases := map[string]string{
		"TRANSFERNO":                         transferBulkFieldTransferNo,
		"TRANSFERNUMBER":                     transferBulkFieldTransferNo,
		"TRANSFERMODE":                       transferBulkFieldMode,
		"MODE":                               transferBulkFieldMode,
		"TRANSFERDATE":                       transferBulkFieldDate,
		"ACTUALTRANSFERDATE":                 transferBulkFieldDate,
		"DATE":                               transferBulkFieldDate,
		"CONTAINERNO":                        transferBulkFieldContainerNo,
		"CONTAINERNUMBER":                    transferBulkFieldContainerNo,
		"FROMWAREHOUSE":                      transferBulkFieldFromWarehouse,
		"SOURCEWAREHOUSE":                    transferBulkFieldFromWarehouse,
		"FROMLOCATION":                       transferBulkFieldFromWarehouse,
		"FROMSTORAGESECTION":                 transferBulkFieldFromStorageSection,
		"SOURCESTORAGESECTION":               transferBulkFieldFromStorageSection,
		"TOWAREHOUSE":                        transferBulkFieldToWarehouse,
		"DESTINATIONWAREHOUSE":               transferBulkFieldToWarehouse,
		"TOLOCATION":                         transferBulkFieldToWarehouse,
		"TOSTORAGESECTION":                   transferBulkFieldToStorageSection,
		"DESTINATIONSTORAGESECTION":          transferBulkFieldToStorageSection,
		"SKU":                                transferBulkFieldSKU,
		"ITEMCODE":                           transferBulkFieldItemCode,
		"TRANSFERQTY":                        transferBulkFieldQuantity,
		"QTY":                                transferBulkFieldQuantity,
		"QUANTITY":                           transferBulkFieldQuantity,
		"SOURCEINVENTORYPALLETSRELEASED":     transferBulkFieldSourcePallets,
		"SOURCEPALLETS":                      transferBulkFieldSourcePallets,
		"INVENTORYPALLETSRELEASED":           transferBulkFieldSourcePallets,
		"DESTINATIONINVENTORYPALLETSCREATED": transferBulkFieldDestinationPallets,
		"DESTINATIONPALLETS":                 transferBulkFieldDestinationPallets,
		"INVENTORYPALLETSCREATED":            transferBulkFieldDestinationPallets,
	}
	return aliases[normalizeBulkTransferHeader(value)]
}

func normalizeBulkTransferHeader(value string) string {
	return strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			return unicode.ToUpper(character)
		}
		return -1
	}, strings.TrimSpace(value))
}

func normalizeBulkTransferLocationName(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func bulkTransferColumnValue(row []string, columns map[string]int, field string) string {
	index, exists := columns[field]
	if !exists || index >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[index])
}

func bulkTransferRowIsEmpty(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func parseBulkTransferOptionalNonNegativeInt(value string) (*int, bool) {
	trimmed := strings.TrimSpace(strings.ReplaceAll(value, ",", ""))
	if trimmed == "" {
		return nil, true
	}
	number, valid := parseInboundBulkNonNegativeInt(trimmed)
	if !valid {
		return nil, false
	}
	return &number, true
}

func bulkTransferIssue(code string, message string, rowNumber int, field string, value string) BulkTransferImportIssue {
	return BulkTransferImportIssue{Severity: InboundBulkIssueError, Code: code, Message: message, RowNumber: rowNumber, Field: field, Value: strings.TrimSpace(value)}
}

func bulkTransferHasErrors(issues []BulkTransferImportIssue) bool {
	for _, issue := range issues {
		if issue.Severity == InboundBulkIssueError {
			return true
		}
	}
	return false
}
