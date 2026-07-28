package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
)

var ErrStaleBillingPreview = errors.New("billing preview is stale")

// GenerateBillingInvoiceInput intentionally has no line, quantity, unit-rate,
// or amount fields. Those values are always recalculated from operational data.
type GenerateBillingInvoiceInput struct {
	InvoiceType                    string                `json:"invoiceType"`
	CustomerID                     int64                 `json:"customerId"`
	WarehouseLocationID            *int64                `json:"warehouseLocationId,omitempty"`
	ContainerType                  string                `json:"containerType,omitempty"`
	PeriodStart                    string                `json:"periodStart"`
	PeriodEnd                      string                `json:"periodEnd"`
	NormalPalletGracePeriodEnabled *bool                 `json:"normalPalletGracePeriodEnabled,omitempty"`
	Rates                          BillingRatesSnapshot  `json:"rates"`
	Header                         *BillingInvoiceHeader `json:"header,omitempty"`
	Notes                          string                `json:"notes,omitempty"`
	SourceFingerprint              string                `json:"sourceFingerprint,omitempty"`
}

type GenerateBillingInvoiceResult struct {
	Invoice            BillingInvoice `json:"invoice"`
	SourceFingerprint  string         `json:"sourceFingerprint"`
	CalculationVersion string         `json:"calculationVersion"`
}

type billingStorageContainerSummaryDetails struct {
	Kind                           string                         `json:"kind"`
	ReceivedOn                     string                         `json:"receivedOn,omitempty"`
	WarehouseLocationID            *int64                         `json:"warehouseLocationId,omitempty"`
	WarehouseName                  string                         `json:"warehouseName,omitempty"`
	WarehousesTouched              []string                       `json:"warehousesTouched"`
	OpeningPallets                 float64                        `json:"openingPallets"`
	ClosingPallets                 float64                        `json:"closingPallets"`
	PalletReleaseEvents            []BillingPreviewPalletRelease  `json:"palletReleaseEvents"`
	PalletsTracked                 float64                        `json:"palletsTracked"`
	PalletDays                     float64                        `json:"palletDays"`
	NormalPalletGracePeriodEnabled bool                           `json:"normalPalletGracePeriodEnabled"`
	FreePalletDays                 float64                        `json:"freePalletDays"`
	BillablePalletDays             float64                        `json:"billablePalletDays"`
	GrossAmount                    float64                        `json:"grossAmount"`
	DiscountAmount                 float64                        `json:"discountAmount"`
	Segments                       []BillingPreviewStorageSegment `json:"segments"`
}

// GenerateInvoice reads a repeatable source snapshot, validates the preview
// fingerprint, checks the invoice scope, and persists the generated invoice in
// one transaction. The customer lock also serializes invoice generation and
// manual invoice creation for the same customer.
func (s *BillingService) GenerateInvoice(ctx context.Context, input GenerateBillingInvoiceInput, createdByUserID int64) (GenerateBillingInvoiceResult, error) {
	if createdByUserID <= 0 {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("%w: invoice creator is required", ErrInvalidInput)
	}
	invoiceType, err := normalizeBillingInvoiceType(input.InvoiceType, false)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	providedFingerprint := strings.TrimSpace(input.SourceFingerprint)
	if providedFingerprint == "" {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("%w: billing preview source fingerprint is required", ErrInvalidInput)
	}

	previewInput, billingRange, graceEnabled, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID:                     input.CustomerID,
		WarehouseLocationID:            input.WarehouseLocationID,
		ContainerType:                  input.ContainerType,
		PeriodStart:                    input.PeriodStart,
		PeriodEnd:                      input.PeriodEnd,
		NormalPalletGracePeriodEnabled: input.NormalPalletGracePeriodEnabled,
		Rates:                          input.Rates,
	})
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}

	tx, err := s.store.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("begin authoritative billing transaction: %w", err)
	}
	defer tx.Rollback()
	if err := lockBillingCustomerTx(ctx, tx, previewInput.CustomerID); err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	sources, err := s.store.loadBillingPreviewSourcesWithQueryer(ctx, tx, previewInput.CustomerID, billingRange.EndExclusive)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	preview, err := calculateBillingPreview(previewInput, billingRange, graceEnabled, sources)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	if providedFingerprint != preview.SourceFingerprint {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("%w: operational billing sources changed; refresh the preview before generating the invoice", ErrStaleBillingPreview)
	}

	if invoiceType == BillingInvoiceTypeStorage && preview.ContainerType == "" {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("%w: container type is required for storage settlement invoices", ErrInvalidInput)
	}
	warehouseName, err := resolveBillingWarehouseSnapshotTx(ctx, tx, preview.WarehouseLocationID)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	lines, err := buildAuthoritativeBillingInvoiceLines(invoiceType, preview, warehouseName)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	if len(lines) == 0 {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("%w: no server-calculated billing lines exist for this scope", ErrInvalidInput)
	}

	createInput := CreateBillingInvoiceInput{
		InvoiceType:         invoiceType,
		CustomerID:          preview.CustomerID,
		CustomerName:        preview.CustomerName,
		WarehouseLocationID: preview.WarehouseLocationID,
		WarehouseName:       warehouseName,
		ContainerType:       preview.ContainerType,
		PeriodStart:         preview.PeriodStart,
		PeriodEnd:           preview.PeriodEnd,
		Rates:               preview.Rates,
		Header:              input.Header,
		Notes:               strings.TrimSpace(input.Notes),
		Lines:               lines,
	}
	prepared, err := prepareBillingInvoiceCreate(createInput)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	invoiceID, err := createBillingInvoiceTx(ctx, tx, createInput, createdByUserID, prepared)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return GenerateBillingInvoiceResult{}, fmt.Errorf("commit authoritative billing invoice: %w", err)
	}
	invoice, err := s.store.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return GenerateBillingInvoiceResult{}, err
	}
	return GenerateBillingInvoiceResult{
		Invoice: invoice, SourceFingerprint: preview.SourceFingerprint,
		CalculationVersion: preview.CalculationVersion,
	}, nil
}

func resolveBillingWarehouseSnapshotTx(ctx context.Context, tx *sqlx.Tx, locationID *int64) (string, error) {
	if locationID == nil {
		return "", nil
	}
	var locationName string
	if err := tx.GetContext(ctx, &locationName, `
		SELECT name
		FROM storage_locations
		WHERE id = ?
	`, *locationID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("%w: billing warehouse was not found", ErrInvalidInput)
		}
		return "", fmt.Errorf("load billing warehouse snapshot: %w", err)
	}
	return locationName, nil
}

func buildAuthoritativeBillingInvoiceLines(invoiceType string, preview BillingPreviewResult, warehouseName string) ([]CreateBillingInvoiceLineInput, error) {
	storageRows := make(map[string]BillingPreviewStorageRow, len(preview.StorageRows))
	for _, row := range preview.StorageRows {
		storageRows[billingPreviewContainerNo(row.ContainerNo)] = row
	}

	lines := make([]CreateBillingInvoiceLineInput, 0, len(preview.Lines))
	for _, previewLine := range preview.Lines {
		if invoiceType == BillingInvoiceTypeStorage && previewLine.ChargeType != BillingChargeStorage {
			continue
		}
		containerNo := billingPreviewContainerNo(previewLine.ContainerNo)
		if containerNo == billingPreviewUnassigned {
			return nil, fmt.Errorf(
				"%w: %s cannot be billed by container because its source container is not assigned",
				ErrInvalidInput,
				firstNonEmpty(previewLine.Reference, previewLine.Description, "billing line"),
			)
		}
		line := CreateBillingInvoiceLineInput{
			ChargeType:  previewLine.ChargeType,
			Description: previewLine.Description,
			Reference:   previewLine.Reference,
			ContainerNo: containerNo,
			Warehouse:   previewLine.Warehouse,
			OccurredOn:  previewLine.OccurredOn,
			Quantity:    previewLine.Quantity,
			UnitRate:    previewLine.UnitRate,
			Amount:      previewLine.Amount,
			SourceType:  "AUTO",
		}
		details := map[string]any{
			"calculationVersion": preview.CalculationVersion,
			"sourceFingerprint":  preview.SourceFingerprint,
			"sourceType":         previewLine.SourceType,
			"sourceId":           previewLine.SourceID,
			"sourceLineId":       previewLine.SourceLineID,
		}
		if previewLine.ChargeType == BillingChargeStorage {
			row, exists := storageRows[billingPreviewContainerNo(previewLine.ContainerNo)]
			if !exists {
				return nil, fmt.Errorf("%w: storage detail for container %s is missing", ErrInvalidInput, previewLine.ContainerNo)
			}
			resolvedWarehouseName := warehouseName
			if resolvedWarehouseName == "" {
				resolvedWarehouseName = strings.Join(row.WarehousesTouched, ", ")
			}
			storageDetailsJSON, err := json.Marshal(billingStorageContainerSummaryDetails{
				Kind: "STORAGE_CONTAINER_SUMMARY", ReceivedOn: row.ReceivedOn, WarehouseLocationID: row.LocationID,
				WarehouseName: resolvedWarehouseName, WarehousesTouched: row.WarehousesTouched,
				OpeningPallets: row.OpeningPallets, ClosingPallets: row.ClosingPallets,
				PalletReleaseEvents: row.PalletReleaseEvents,
				PalletsTracked:      row.PalletsTracked, PalletDays: row.PalletDays,
				NormalPalletGracePeriodEnabled: preview.NormalPalletGracePeriodEnabled,
				FreePalletDays:                 row.FreePalletDays, BillablePalletDays: row.BillablePalletDays,
				GrossAmount: row.GrossAmount, DiscountAmount: row.DiscountAmount,
				Segments: row.Segments,
			})
			if err != nil {
				return nil, fmt.Errorf("encode storage invoice line details: %w", err)
			}
			var storageDetails map[string]any
			if err := json.Unmarshal(storageDetailsJSON, &storageDetails); err != nil {
				return nil, fmt.Errorf("decode storage invoice line details: %w", err)
			}
			for key, value := range storageDetails {
				details[key] = value
			}
		}
		detailsJSON, err := json.Marshal(details)
		if err != nil {
			return nil, fmt.Errorf("encode authoritative invoice line provenance: %w", err)
		}
		line.Details = detailsJSON
		lines = append(lines, line)
	}
	expectedTotal := preview.Summary.GrandTotal
	if invoiceType == BillingInvoiceTypeStorage {
		expectedTotal = preview.Summary.StorageAmount
	}
	actualTotal := 0.0
	for _, line := range lines {
		actualTotal += line.Amount
	}
	if roundCurrencyGo(actualTotal) != roundCurrencyGo(expectedTotal) {
		return nil, fmt.Errorf(
			"%w: container billing detail total %.2f does not match invoice total %.2f",
			ErrInvalidInput,
			roundCurrencyGo(actualTotal),
			roundCurrencyGo(expectedTotal),
		)
	}
	return lines, nil
}
