package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestBuildAuthoritativeBillingInvoiceLinesFiltersStorageAndAddsDetails(t *testing.T) {
	locationID := int64(7)
	preview := BillingPreviewResult{
		CalculationVersion:             BillingPreviewCalculationVersion,
		SourceFingerprint:              "sha256:test-source",
		NormalPalletGracePeriodEnabled: true,
		Lines: []BillingPreviewLine{
			{ID: "inbound", ChargeType: BillingChargeInbound, ContainerNo: "CONT-A", Amount: 450},
			{
				ID: "storage", ChargeType: BillingChargeStorage, Description: "Container storage pallet-days",
				Reference: "Storage | CONT-A", ContainerNo: "CONT-A", Warehouse: "308",
				SourceType: "CONTAINER_LIFECYCLE", SourceID: 55, SourceLineID: 66,
				OccurredOn: "2026-04-30", Quantity: 24, UnitRate: 1, Amount: 24,
			},
			{ID: "outbound", ChargeType: BillingChargeOutbound, ContainerNo: "CONT-A", Amount: 10},
		},
		StorageRows: []BillingPreviewStorageRow{{
			ContainerNo: "CONT-A", ReceivedOn: "2026-03-15", LocationID: &locationID, WarehousesTouched: []string{"308"},
			OpeningPallets: 2, ClosingPallets: 1,
			PalletReleaseEvents: []BillingPreviewPalletRelease{{Date: "2026-04-15", Pallets: 1}},
			PalletsTracked:      2, PalletDays: 31, FreePalletDays: 7, BillablePalletDays: 24,
			GrossAmount: 31, DiscountAmount: 7,
			Segments: []BillingPreviewStorageSegment{{
				StartDate: "2026-04-01", EndDate: "2026-04-30", DayEndPallets: 1,
				BilledDays: 30, PalletDays: 30, FreePalletDays: 7, BillablePalletDays: 23,
				GrossAmount: 30, DiscountAmount: 7, Amount: 23,
			}},
		}},
		Summary: BillingPreviewSummary{StorageAmount: 24, GrandTotal: 484},
	}

	lines, err := buildAuthoritativeBillingInvoiceLines(BillingInvoiceTypeStorage, preview, "308")
	if err != nil {
		t.Fatalf("build storage invoice lines: %v", err)
	}
	if len(lines) != 1 || lines[0].ChargeType != BillingChargeStorage || lines[0].Amount != 24 {
		t.Fatalf("storage settlement did not use only the server storage line: %#v", lines)
	}
	if lines[0].SourceType != "AUTO" {
		t.Fatalf("authoritative line must be AUTO, got %q", lines[0].SourceType)
	}
	var details billingStorageContainerSummaryDetails
	if err := json.Unmarshal(lines[0].Details, &details); err != nil {
		t.Fatalf("decode storage details: %v", err)
	}
	if details.Kind != "STORAGE_CONTAINER_SUMMARY" || details.PalletDays != 31 || details.BillablePalletDays != 24 {
		t.Fatalf("unexpected storage detail snapshot: %#v", details)
	}
	if details.ReceivedOn != "2026-03-15" || details.OpeningPallets != 2 || details.ClosingPallets != 1 || len(details.PalletReleaseEvents) != 1 {
		t.Fatalf("period boundary detail snapshot missing: %#v", details)
	}
	if details.WarehouseLocationID == nil || *details.WarehouseLocationID != locationID || details.WarehouseName != "308" {
		t.Fatalf("warehouse snapshot missing from storage details: %#v", details)
	}
	var provenance map[string]any
	if err := json.Unmarshal(lines[0].Details, &provenance); err != nil {
		t.Fatalf("decode authoritative provenance: %v", err)
	}
	if provenance["calculationVersion"] != BillingPreviewCalculationVersion || provenance["sourceFingerprint"] != "sha256:test-source" || provenance["sourceType"] != "CONTAINER_LIFECYCLE" {
		t.Fatalf("authoritative provenance missing from line details: %#v", provenance)
	}
	if provenance["sourceId"] != float64(55) || provenance["sourceLineId"] != float64(66) {
		t.Fatalf("source identifiers missing from line details: %#v", provenance)
	}
}

func TestBuildBillingInvoiceContainerDetailsReconcilesEveryInvoiceLine(t *testing.T) {
	storageDetails, err := json.Marshal(billingStorageContainerSummaryDetails{
		Kind: "STORAGE_CONTAINER_SUMMARY", PalletsTracked: 4, PalletDays: 40,
		FreePalletDays: 5, BillablePalletDays: 35, GrossAmount: 40, DiscountAmount: 5,
	})
	if err != nil {
		t.Fatalf("marshal storage details: %v", err)
	}
	lines := []BillingInvoiceLine{
		{ID: 1, ChargeType: BillingChargeInbound, ContainerNo: " cont-a ", Warehouse: "308", Reference: "Receipt 10", Quantity: 1, Amount: 450},
		{ID: 2, ChargeType: BillingChargeWrapping, ContainerNo: "CONT-A", Warehouse: "308", Reference: "Receipt 10", Quantity: 4, Amount: 60},
		{ID: 3, ChargeType: BillingChargeStorage, ContainerNo: "CONT-A", Warehouse: "308", Reference: "Storage | CONT-A", Quantity: 35, Amount: 35, Details: storageDetails},
		{ID: 4, ChargeType: BillingChargeOutbound, ContainerNo: "CONT-A", Warehouse: "308", Reference: "Picking order PO-1", Quantity: 2, Amount: 20},
		{ID: 5, ChargeType: "DISCOUNT", Amount: -10},
	}

	details := buildBillingInvoiceContainerDetails(lines)
	if len(details) != 2 {
		t.Fatalf("container detail count = %d, want 2: %#v", len(details), details)
	}
	container := details[0]
	if container.ContainerNo != "CONT-A" || container.LineCount != 4 || container.TotalAmount != 565 {
		t.Fatalf("unexpected container total: %#v", container)
	}
	if container.InboundUnits != 1 || container.WrappingPallets != 4 || container.OutboundPallets != 2 {
		t.Fatalf("unexpected container activity basis: %#v", container)
	}
	if container.PalletsTracked != 4 || container.PalletDays != 40 || container.FreePalletDays != 5 || container.BillablePalletDays != 35 {
		t.Fatalf("unexpected storage basis: %#v", container)
	}
	if container.StorageGrossAmount != 40 || container.StorageDiscountAmount != 5 || container.StorageAmount != 35 {
		t.Fatalf("unexpected storage amounts: %#v", container)
	}
	if len(container.Warehouses) != 1 || container.Warehouses[0] != "308" || len(container.References) != 3 {
		t.Fatalf("container provenance was not deduplicated: %#v", container)
	}
	invoiceLevel := details[1]
	if invoiceLevel.ContainerNo != "" || invoiceLevel.AdjustmentAmount != -10 || invoiceLevel.TotalAmount != -10 {
		t.Fatalf("invoice-level adjustment was not retained: %#v", invoiceLevel)
	}
	combinedTotal := roundCurrencyGo(container.TotalAmount + invoiceLevel.TotalAmount)
	if combinedTotal != 555 {
		t.Fatalf("container details do not reconcile: got %.2f, want 555.00", combinedTotal)
	}
}

func TestUnreconciledBillingPalletMovementContainers(t *testing.T) {
	reconciledDetails, err := json.Marshal(billingStorageContainerSummaryDetails{
		Kind: "STORAGE_CONTAINER_SUMMARY", OpeningPallets: 10, ClosingPallets: 4,
		PalletReleaseEvents: []BillingPreviewPalletRelease{{Date: "2026-04-15", Pallets: 6}},
	})
	if err != nil {
		t.Fatalf("marshal reconciled storage details: %v", err)
	}
	unreconciledDetails, err := json.Marshal(billingStorageContainerSummaryDetails{
		Kind: "STORAGE_CONTAINER_SUMMARY", OpeningPallets: 10, ClosingPallets: 2,
		PalletReleaseEvents: []BillingPreviewPalletRelease{{Date: "2026-04-15", Pallets: 3}},
	})
	if err != nil {
		t.Fatalf("marshal unreconciled storage details: %v", err)
	}

	containers := unreconciledBillingPalletMovementContainers([]BillingInvoiceLine{
		{ChargeType: BillingChargeStorage, ContainerNo: "CONT-A", Details: reconciledDetails},
		{ChargeType: BillingChargeStorage, ContainerNo: " cont-b ", Details: unreconciledDetails},
	})

	if len(containers) != 1 || containers[0] != "CONT-B" {
		t.Fatalf("unexpected unreconciled containers: %#v", containers)
	}
}

func TestBuildAuthoritativeBillingInvoiceLinesRejectsUnassignedContainer(t *testing.T) {
	preview := BillingPreviewResult{
		Lines: []BillingPreviewLine{{
			ChargeType: BillingChargeOutbound, ContainerNo: billingPreviewUnassigned,
			Reference: "Picking order PO-7", Amount: 10,
		}},
		Summary: BillingPreviewSummary{GrandTotal: 10},
	}

	_, err := buildAuthoritativeBillingInvoiceLines(BillingInvoiceTypeMixed, preview, "308")
	if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "Picking order PO-7") {
		t.Fatalf("unassigned container error = %v, want a reference-specific invalid input", err)
	}
}

func TestBuildAuthoritativeBillingInvoiceLinesRejectsContainerTotalMismatch(t *testing.T) {
	preview := BillingPreviewResult{
		Lines: []BillingPreviewLine{{
			ChargeType: BillingChargeInbound, ContainerNo: "CONT-A", Amount: 450,
		}},
		Summary: BillingPreviewSummary{GrandTotal: 451},
	}

	_, err := buildAuthoritativeBillingInvoiceLines(BillingInvoiceTypeMixed, preview, "308")
	if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "does not match invoice total") {
		t.Fatalf("container total mismatch error = %v", err)
	}
}

func TestGenerateBillingInvoiceRequiresPreviewFingerprintBeforeDatabaseWork(t *testing.T) {
	billing := NewBillingService(&Store{})
	_, err := billing.GenerateInvoice(context.Background(), GenerateBillingInvoiceInput{
		InvoiceType:       BillingInvoiceTypeMixed,
		SourceFingerprint: "  ",
	}, 1)
	if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "source fingerprint is required") {
		t.Fatalf("missing fingerprint error = %v, want ErrInvalidInput", err)
	}
}

func TestGenerateAuthoritativeBillingInvoiceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email: "billing-generate-" + suffix + "@example.com", FullName: "Billing Generator", Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing user: %v", err)
	}
	customer := mustCreateCustomer(t, ctx, store, "Authoritative Billing "+suffix)
	location := mustCreateLocation(t, ctx, store, "308 "+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "AUTH-BILL-"+suffix, 0)
	containerNo := "AUTH-CONT-" + suffix

	createConfirmedBillingReceipt(t, ctx, store, customer.ID, location.ID, item, containerNo, "2026-04-01", 10, 3)
	createConfirmedBillingReceipt(t, ctx, store, customer.ID, location.ID, item, strings.ToLower(containerNo), "2026-04-01", 2, 1)
	graceEnabled := false
	rates := BillingRatesSnapshot{
		InboundContainerFee: 450, WrappingFeePerPallet: 15,
		StorageFeePerPalletWeekNormal: 7, StorageFeePerPalletWeekWestCoastTransfer: 7,
		OutboundFeePerPallet: 10,
	}
	locationID := location.ID
	previewInput := BillingPreviewInput{
		CustomerID: customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: rates,
	}
	preview, err := store.CalculateBillingPreview(ctx, previewInput)
	if err != nil {
		t.Fatalf("calculate authoritative preview: %v", err)
	}

	billing := NewBillingService(store)
	header := BillingInvoiceHeader{SellerName: "Server Seller", Terms: "Net 15", PaymentDueDays: 15}
	generated, err := billing.GenerateInvoice(ctx, GenerateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeMixed,
		CustomerID:  customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: rates,
		Header: &header, Notes: "server generated", SourceFingerprint: preview.SourceFingerprint,
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("generate mixed invoice: %v", err)
	}
	invoice := generated.Invoice
	if invoice.CustomerNameSnapshot != customer.Name || invoice.WarehouseLocationID == nil || *invoice.WarehouseLocationID != location.ID || invoice.WarehouseNameSnapshot != location.Name {
		t.Fatalf("customer/warehouse snapshots were not resolved server-side: %#v", invoice)
	}
	if invoice.GrandTotal != 514 || invoice.LineCount != 4 {
		t.Fatalf("unexpected server-calculated mixed invoice: %#v", invoice)
	}
	var inboundLines, wrappingLines int
	for _, line := range invoice.Lines {
		if line.SourceType != "AUTO" || line.ContainerNo != containerNo {
			t.Fatalf("invoice contains a non-authoritative or containerless line: %#v", line)
		}
		if line.ChargeType == BillingChargeInbound {
			inboundLines++
		}
		if line.ChargeType == BillingChargeWrapping {
			wrappingLines++
		}
		var provenance map[string]any
		if err := json.Unmarshal(line.Details, &provenance); err != nil {
			t.Fatalf("decode generated line provenance: %v", err)
		}
		if provenance["calculationVersion"] != BillingPreviewCalculationVersion || provenance["sourceFingerprint"] != preview.SourceFingerprint {
			t.Fatalf("generated line lost source snapshot provenance: %#v", provenance)
		}
		if line.SourceDocumentType == "" {
			t.Fatalf("generated line lost relational source provenance: %#v", line)
		}
		if line.ChargeType != BillingChargeStorage && line.SourceDocumentID <= 0 {
			t.Fatalf("document charge line must retain its source document id: %#v", line)
		}
	}
	if inboundLines != 1 || wrappingLines != 2 {
		t.Fatalf("container 1:N receipts were not billed correctly: inbound=%d wrapping=%d", inboundLines, wrappingLines)
	}
	if len(invoice.ContainerDetails) != 1 || invoice.ContainerDetails[0].ContainerNo != containerNo || invoice.ContainerDetails[0].TotalAmount != invoice.GrandTotal {
		t.Fatalf("generated invoice container ledger does not reconcile: %#v", invoice.ContainerDetails)
	}
	_, err = billing.GenerateInvoice(ctx, GenerateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeMixed,
		CustomerID:  customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: rates,
		SourceFingerprint: preview.SourceFingerprint,
	}, authPayload.User.ID)
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate mixed invoice scope to fail, got %v", err)
	}

	_, err = billing.GenerateInvoice(ctx, GenerateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeStorage,
		CustomerID:  customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: rates,
		SourceFingerprint: preview.SourceFingerprint,
	}, authPayload.User.ID)
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected mixed invoice to block overlapping storage settlement, got %v", err)
	}

	autoLineID := invoice.Lines[0].ID
	deletedAutoLineID := invoice.Lines[1].ID
	invoice, err = store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType: BillingChargeStorage, Description: "manual replacement", Quantity: 1, UnitRate: 1, Amount: 1,
	})
	if err != nil {
		t.Fatalf("add manual line to generated draft invoice: %v", err)
	}
	if invoice.LineCount != 5 {
		t.Fatalf("generated draft line count after manual add = %d, want 5", invoice.LineCount)
	}

	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, autoLineID, UpdateBillingInvoiceLineInput{
		ChargeType: BillingChargeStorage, Description: "mutated", ContainerNo: containerNo,
		Quantity: 1, UnitRate: 1, Amount: 1,
	})
	if err != nil {
		t.Fatalf("edit generated draft invoice line: %v", err)
	}
	var editedLine *BillingInvoiceLine
	for index := range invoice.Lines {
		if invoice.Lines[index].ID == autoLineID {
			editedLine = &invoice.Lines[index]
			break
		}
	}
	if editedLine == nil {
		t.Fatalf("edited generated line %d was not returned", autoLineID)
	}
	if editedLine.SourceType != "MANUAL" || editedLine.SourceDocumentType != "" || editedLine.SourceDocumentID != 0 || editedLine.SourceLineID != 0 || len(editedLine.Details) != 0 {
		t.Fatalf("edited generated line retained stale automatic provenance: %#v", editedLine)
	}

	invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, deletedAutoLineID)
	if err != nil {
		t.Fatalf("delete generated draft invoice line: %v", err)
	}
	if invoice.LineCount != 4 {
		t.Fatalf("generated draft line count after delete = %d, want 4", invoice.LineCount)
	}
	if _, err := store.DeleteBillingInvoiceLine(ctx, invoice.ID, deletedAutoLineID); err == nil || !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting the same generated draft line twice should return not found, got %v", err)
	}
	if err := store.DeleteBillingInvoice(ctx, invoice.ID); err != nil {
		t.Fatalf("delete authoritative draft invoice: %v", err)
	}

	storageGenerated, err := billing.GenerateInvoice(ctx, GenerateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeStorage,
		CustomerID:  customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: rates,
		SourceFingerprint: preview.SourceFingerprint,
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("generate storage settlement after deleting mixed draft: %v", err)
	}
	if storageGenerated.Invoice.LineCount != 1 || storageGenerated.Invoice.Lines[0].ChargeType != BillingChargeStorage {
		t.Fatalf("storage settlement included non-storage lines: %#v", storageGenerated.Invoice.Lines)
	}
	var details map[string]any
	if err := json.Unmarshal(storageGenerated.Invoice.Lines[0].Details, &details); err != nil {
		t.Fatalf("decode persisted generated storage details: %v", err)
	}
	if details["kind"] != "STORAGE_CONTAINER_SUMMARY" {
		t.Fatalf("generated storage detail kind missing: %#v", details)
	}

	_, err = store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID: customer.ID, LocationID: location.ID, ActualArrivalDate: "2026-04-01",
		ContainerNo: containerNo, ContainerType: ContainerTypeNormal,
		StorageSection: DefaultStorageSection, Status: DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 2, ReceivedQty: 2,
			Pallets: 1, StorageSection: DefaultStorageSection,
		}},
	})
	if err == nil || !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "already covers this source date") {
		t.Fatalf("expected generated invoice to block a backdated receipt, got %v", err)
	}
}

func TestGenerateBillingInvoiceRejectsChangedFingerprintWithoutPartialInvoiceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email: "billing-atomic-" + suffix + "@example.com", FullName: "Atomic Billing", Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing user: %v", err)
	}
	customer := mustCreateCustomer(t, ctx, store, "Atomic Billing "+suffix)
	location := mustCreateLocation(t, ctx, store, "Atomic 308 "+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "ATOMIC-BILL-"+suffix, 0)
	createConfirmedBillingReceipt(t, ctx, store, customer.ID, location.ID, item, "ATOMIC-CONT-"+suffix, "2026-04-01", 5, 2)

	graceEnabled := false
	locationID := location.ID
	baseRates := BillingRatesSnapshot{
		InboundContainerFee: 450, WrappingFeePerPallet: 15,
		StorageFeePerPalletWeekNormal: 7, OutboundFeePerPallet: 10,
	}
	preview, err := store.CalculateBillingPreview(ctx, BillingPreviewInput{
		CustomerID: customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: baseRates,
	})
	if err != nil {
		t.Fatalf("calculate original preview: %v", err)
	}
	changedRates := baseRates
	changedRates.InboundContainerFee = 500
	billing := NewBillingService(store)
	_, err = billing.GenerateInvoice(ctx, GenerateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeMixed,
		CustomerID:  customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: changedRates,
		SourceFingerprint: preview.SourceFingerprint,
	}, authPayload.User.ID)
	if err == nil || !errors.Is(err, ErrStaleBillingPreview) {
		t.Fatalf("expected changed rates to invalidate the preview, got %v", err)
	}
	invoices, err := store.ListBillingInvoices(ctx, customer.ID, "", "")
	if err != nil {
		t.Fatalf("list invoices after stale rejection: %v", err)
	}
	if len(invoices) != 0 {
		t.Fatalf("stale generation left a partial invoice behind: %#v", invoices)
	}

	refreshed, err := store.CalculateBillingPreview(ctx, BillingPreviewInput{
		CustomerID: customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: changedRates,
	})
	if err != nil {
		t.Fatalf("calculate refreshed preview: %v", err)
	}
	generated, err := billing.GenerateInvoice(ctx, GenerateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeMixed,
		CustomerID:  customer.ID, WarehouseLocationID: &locationID, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled, Rates: changedRates,
		SourceFingerprint: refreshed.SourceFingerprint,
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("generate after refreshed preview: %v", err)
	}
	if generated.Invoice.LineCount == 0 || generated.Invoice.GrandTotal != refreshed.Summary.GrandTotal {
		t.Fatalf("refreshed generation did not persist the authoritative snapshot: %#v", generated.Invoice)
	}
}

func TestBillingCustomerLockSerializesBackdatedSourceMutationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email: "billing-source-lock-" + suffix + "@example.com", FullName: "Billing Source Lock", Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing source lock user: %v", err)
	}
	customer := mustCreateCustomer(t, ctx, store, "Billing Source Lock "+suffix)
	location := mustCreateLocation(t, ctx, store, "Billing Source Lock Warehouse "+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "BILL-SOURCE-LOCK-"+suffix, 0)
	containerNo := "BILL-SOURCE-CONT-" + suffix
	createConfirmedBillingReceipt(t, ctx, store, customer.ID, location.ID, item, containerNo, "2026-04-01", 8, 2)
	stockItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)

	invoiceInput := CreateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeMixed, CustomerID: customer.ID, CustomerName: customer.Name,
		WarehouseLocationID: &location.ID, WarehouseName: location.Name, ContainerType: ContainerTypeNormal,
		PeriodStart: "2026-04-01", PeriodEnd: "2026-04-30",
		Lines: []CreateBillingInvoiceLineInput{{
			ChargeType: BillingChargeStorage, Description: "Locked source snapshot",
			ContainerNo: containerNo, Warehouse: location.Name, OccurredOn: "2026-04-01",
			Quantity: 2, UnitRate: 1, Amount: 2, SourceType: "AUTO",
		}},
	}
	prepared, err := prepareBillingInvoiceCreate(invoiceInput)
	if err != nil {
		t.Fatalf("prepare billing source lock invoice: %v", err)
	}
	billingTx, err := store.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatalf("begin billing source lock transaction: %v", err)
	}
	defer billingTx.Rollback()
	if err := lockBillingCustomerTx(ctx, billingTx, customer.ID); err != nil {
		t.Fatalf("lock billing customer: %v", err)
	}

	mutationStarted := make(chan struct{})
	mutationResult := make(chan error, 1)
	mutationCtx, cancelMutation := context.WithTimeout(ctx, 5*time.Second)
	defer cancelMutation()
	go func() {
		close(mutationStarted)
		_, mutationErr := store.CreateInventoryAdjustment(mutationCtx, CreateInventoryAdjustmentInput{
			ReasonCode: "CORRECTION", ActualAdjustedAt: "2026-04-15",
			Lines: []CreateInventoryAdjustmentLineInput{{
				CustomerID: stockItem.CustomerID, LocationID: stockItem.LocationID,
				StorageSection: stockItem.StorageSection, ContainerNo: stockItem.ContainerNo,
				SKUMasterID: stockItem.SKUMasterID, AdjustPallets: 1,
			}},
		})
		mutationResult <- mutationErr
	}()
	<-mutationStarted
	select {
	case mutationErr := <-mutationResult:
		t.Fatalf("source mutation bypassed the held billing customer lock: %v", mutationErr)
	case <-time.After(150 * time.Millisecond):
	}

	if _, err := createBillingInvoiceTx(ctx, billingTx, invoiceInput, authPayload.User.ID, prepared); err != nil {
		t.Fatalf("create invoice while holding source lock: %v", err)
	}
	if err := billingTx.Commit(); err != nil {
		t.Fatalf("commit invoice while holding source lock: %v", err)
	}

	select {
	case mutationErr := <-mutationResult:
		if mutationErr == nil || !errors.Is(mutationErr, ErrInvalidInput) {
			t.Fatalf("backdated mutation was not rejected after invoice commit: %v", mutationErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("source mutation did not resume after billing commit")
	}
	unchanged := mustFindItemByID(t, ctx, store, stockItem.ID)
	if unchanged.Pallets != stockItem.Pallets {
		t.Fatalf("rejected source mutation changed pallet balance: before=%d after=%d", stockItem.Pallets, unchanged.Pallets)
	}
}

func createConfirmedBillingReceipt(
	t *testing.T,
	ctx context.Context,
	store *Store,
	customerID int64,
	locationID int64,
	item Item,
	containerNo string,
	arrivalDate string,
	quantity int,
	pallets int,
) {
	t.Helper()
	_, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID: customerID, LocationID: locationID, ActualArrivalDate: arrivalDate,
		ContainerNo: containerNo, ContainerType: ContainerTypeNormal,
		StorageSection: DefaultStorageSection, Status: DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: quantity, ReceivedQty: quantity,
			Pallets: pallets, StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed billing receipt: %v", err)
	}
}
