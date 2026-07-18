package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAllocateBillingPalletsLargestRemainder(t *testing.T) {
	groups := []billingOutboundAllocationGroup{
		{ContainerNo: "A", AllocatedQty: 5},
		{ContainerNo: "B", AllocatedQty: 3},
		{ContainerNo: "C", AllocatedQty: 2},
	}

	got := allocateBillingPalletsLargestRemainder(7, groups)
	want := []int{4, 2, 1}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("allocation %d: got %d, want %d (all=%v)", index, got[index], want[index], got)
		}
	}
}

func TestCalculateBillingPreviewUsesContainerLevelPalletSources(t *testing.T) {
	graceEnabled := false
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID:                     1,
		PeriodStart:                    "2026-04-01",
		PeriodEnd:                      "2026-04-03",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates: BillingRatesSnapshot{
			InboundContainerFee:                      450,
			TransferInboundFeePerPallet:              10,
			WrappingFeePerPallet:                     15,
			StorageFeePerPalletWeekNormal:            7,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
			OutboundFeePerPallet:                     10,
		},
	})
	if err != nil {
		t.Fatalf("normalize input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "SpeedWin",
		Inbound: []billingInboundSource{{
			DocumentID: 11, LocationID: 1, LocationName: "308", ContainerNo: "CONT-A",
			ContainerType: ContainerTypeNormal, OccurredOn: billingTestDate(2026, 4, 1), Pallets: 3,
		}},
		OutboundLines: []billingOutboundLineSource{{
			DocumentID: 21, LineID: 22, PickingNo: "PO-21", LocationID: 1,
			LocationName: "308", OccurredOn: billingTestDate(2026, 4, 3), Pallets: 5,
		}},
		Allocations: []billingOutboundAllocationSource{
			{AllocationID: 31, LineID: 22, ContainerNo: "CONT-A", LocationID: 1, LocationName: "308", AllocatedQty: 7, Status: "SHIPPED"},
			{AllocationID: 32, LineID: 22, ContainerNo: "CONT-B", LocationID: 1, LocationName: "308", AllocatedQty: 3, Status: "SHIPPED"},
		},
		Lifecycle: []billingLifecycleSource{
			{EventID: 41, LocationID: 1, LocationName: "308", ContainerNo: "CONT-A", EventType: "RECEIVE", EventDate: billingTestDate(2026, 4, 1), PalletDelta: 3, SourceType: "INBOUND", SourceID: 11},
			{EventID: 42, LocationID: 1, LocationName: "308", ContainerNo: "CONT-B", EventType: "RECEIVE", EventDate: billingTestDate(2026, 4, 1), PalletDelta: 2, SourceType: "INBOUND", SourceID: 12},
		},
		ContainerTypes: []billingContainerTypeSource{
			{ContainerNo: "CONT-A", ContainerType: ContainerTypeNormal},
			{ContainerNo: "CONT-B", ContainerType: ContainerTypeNormal},
		},
	}

	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	if preview.Summary.ReceivedContainers != 1 || preview.Summary.ReceivedPallets != 3 {
		t.Fatalf("unexpected inbound summary: %#v", preview.Summary)
	}
	if preview.Summary.ShippedPallets != 5 {
		t.Fatalf("shipping pallet total must come from outbound line pallets, got %v", preview.Summary.ShippedPallets)
	}
	if preview.Summary.PalletDays != 15 || preview.Summary.StorageAmount != 15 {
		t.Fatalf("unexpected storage summary: %#v", preview.Summary)
	}
	if preview.Summary.GrandTotal != 560 {
		t.Fatalf("grand total: got %.2f, want 560.00", preview.Summary.GrandTotal)
	}

	outboundByContainer := map[string]float64{}
	for _, line := range preview.Lines {
		if strings.TrimSpace(line.ContainerNo) == "" {
			t.Fatalf("line %q lost its container number", line.ID)
		}
		if line.ChargeType == BillingChargeOutbound {
			outboundByContainer[line.ContainerNo] += line.Quantity
		}
	}
	if outboundByContainer["CONT-A"] != 4 || outboundByContainer["CONT-B"] != 1 {
		t.Fatalf("unexpected largest-remainder outbound split: %#v", outboundByContainer)
	}

	repeated, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("repeat preview: %v", err)
	}
	if preview.SourceFingerprint != repeated.SourceFingerprint {
		t.Fatalf("fingerprint is not deterministic: %q != %q", preview.SourceFingerprint, repeated.SourceFingerprint)
	}
}

func TestCalculateBillingStorageUsesOpeningBalanceAndWarehouseScope(t *testing.T) {
	graceEnabled := false
	locationID := int64(2)
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, WarehouseLocationID: &locationID,
		PeriodStart: "2026-04-02", PeriodEnd: "2026-04-03",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates:                          BillingRatesSnapshot{StorageFeePerPalletWeekNormal: 7},
	})
	if err != nil {
		t.Fatalf("normalize input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "Customer",
		Lifecycle: []billingLifecycleSource{
			{EventID: 1, LocationID: 1, LocationName: "Other", ContainerNo: "CONT-A", EventDate: billingTestDate(2026, 3, 30), PalletDelta: 4},
			{EventID: 2, LocationID: 1, LocationName: "Other", ContainerNo: "CONT-A", EventDate: billingTestDate(2026, 4, 3), PalletDelta: -2},
			{EventID: 3, LocationID: 2, LocationName: "308", ContainerNo: "CONT-A", EventDate: billingTestDate(2026, 4, 3), PalletDelta: 2},
		},
		ContainerTypes: []billingContainerTypeSource{{ContainerNo: "CONT-A", ContainerType: ContainerTypeNormal}},
	}

	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	if len(preview.StorageRows) != 1 || preview.StorageRows[0].PalletDays != 2 {
		t.Fatalf("warehouse-scoped opening balance was not applied correctly: %#v", preview.StorageRows)
	}
	if preview.DailyBalances[0].PalletCount != 0 || preview.DailyBalances[1].PalletCount != 2 {
		t.Fatalf("unexpected daily balances: %#v", preview.DailyBalances)
	}
}

func TestCalculateBillingStoragePreservesSignedLocationBalanceForBackdatedTransfers(t *testing.T) {
	graceEnabled := false
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-10", PeriodEnd: "2026-04-10",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates:                          BillingRatesSnapshot{StorageFeePerPalletWeekNormal: 7},
	})
	if err != nil {
		t.Fatalf("normalize input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "Customer",
		Lifecycle: []billingLifecycleSource{
			{EventID: 1, LocationID: 1, LocationName: "Origin", ContainerNo: "CONT-A", EventType: "TRANSFER_OUT", EventDate: billingTestDate(2026, 4, 5), PalletDelta: -10},
			{EventID: 2, LocationID: 2, LocationName: "308", ContainerNo: "CONT-A", EventType: "TRANSFER_IN", EventDate: billingTestDate(2026, 4, 5), PalletDelta: 10},
			{EventID: 3, LocationID: 1, LocationName: "Origin", ContainerNo: "CONT-A", EventType: "RECEIVE", EventDate: billingTestDate(2026, 4, 10), PalletDelta: 10},
		},
		ContainerTypes: []billingContainerTypeSource{{ContainerNo: "CONT-A", ContainerType: ContainerTypeNormal}},
	}

	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	if len(preview.StorageRows) != 1 || preview.StorageRows[0].PalletDays != 10 {
		t.Fatalf("backdated transfer created phantom pallet-days: %#v", preview.StorageRows)
	}
	if len(preview.DailyBalances) != 1 || preview.DailyBalances[0].PalletCount != 10 {
		t.Fatalf("backdated transfer created a phantom daily balance: %#v", preview.DailyBalances)
	}
}

func TestBillingSourceFingerprintIncludesBusinessDates(t *testing.T) {
	input := BillingPreviewInput{CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-30"}
	base := billingPreviewSources{
		CustomerName:  "Customer",
		Inbound:       []billingInboundSource{{DocumentID: 1, OccurredOn: billingTestDate(2026, 4, 1)}},
		OutboundLines: []billingOutboundLineSource{{DocumentID: 2, LineID: 3, OccurredOn: billingTestDate(2026, 4, 2)}},
		Lifecycle:     []billingLifecycleSource{{EventID: 4, EventDate: billingTestDate(2026, 4, 3), PalletDelta: 1}},
	}
	baseFingerprint, err := fingerprintBillingPreviewSources(input, true, base)
	if err != nil {
		t.Fatalf("fingerprint base: %v", err)
	}

	tests := []struct {
		name   string
		change func(*billingPreviewSources)
	}{
		{"inbound date", func(sources *billingPreviewSources) { sources.Inbound[0].OccurredOn = billingTestDate(2026, 4, 4) }},
		{"outbound date", func(sources *billingPreviewSources) {
			sources.OutboundLines[0].OccurredOn = billingTestDate(2026, 4, 5)
		}},
		{"lifecycle date", func(sources *billingPreviewSources) { sources.Lifecycle[0].EventDate = billingTestDate(2026, 4, 6) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed := base
			changed.Inbound = append([]billingInboundSource(nil), base.Inbound...)
			changed.OutboundLines = append([]billingOutboundLineSource(nil), base.OutboundLines...)
			changed.Lifecycle = append([]billingLifecycleSource(nil), base.Lifecycle...)
			test.change(&changed)
			fingerprint, err := fingerprintBillingPreviewSources(input, true, changed)
			if err != nil {
				t.Fatalf("fingerprint changed: %v", err)
			}
			if fingerprint == baseFingerprint {
				t.Fatalf("%s did not change source fingerprint", test.name)
			}
		})
	}
}

func TestBillingSourceFingerprintIncludesNormalizedRatesAndGracePolicy(t *testing.T) {
	legacyInput, _, legacyGrace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-30",
		Rates: BillingRatesSnapshot{StorageFeePerPalletWeek: 7, OutboundFeePerPallet: 10},
	})
	if err != nil {
		t.Fatalf("normalize legacy rates: %v", err)
	}
	explicitInput, _, explicitGrace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-30",
		Rates: BillingRatesSnapshot{
			StorageFeePerPalletWeekNormal:            7,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
			OutboundFeePerPallet:                     10,
		},
	})
	if err != nil {
		t.Fatalf("normalize explicit rates: %v", err)
	}
	sources := billingPreviewSources{CustomerName: "Customer"}
	legacyFingerprint, err := fingerprintBillingPreviewSources(legacyInput, legacyGrace, sources)
	if err != nil {
		t.Fatalf("fingerprint legacy rates: %v", err)
	}
	explicitFingerprint, err := fingerprintBillingPreviewSources(explicitInput, explicitGrace, sources)
	if err != nil {
		t.Fatalf("fingerprint explicit rates: %v", err)
	}
	if legacyFingerprint != explicitFingerprint {
		t.Fatalf("semantically equivalent normalized rates produced different fingerprints: %q != %q", legacyFingerprint, explicitFingerprint)
	}

	changedRate := explicitInput
	changedRate.Rates.OutboundFeePerPallet = 11
	changedRateFingerprint, err := fingerprintBillingPreviewSources(changedRate, explicitGrace, sources)
	if err != nil {
		t.Fatalf("fingerprint changed rates: %v", err)
	}
	if changedRateFingerprint == explicitFingerprint {
		t.Fatal("changing a normalized billing rate did not change the fingerprint")
	}

	graceDisabledFingerprint, err := fingerprintBillingPreviewSources(explicitInput, false, sources)
	if err != nil {
		t.Fatalf("fingerprint disabled grace policy: %v", err)
	}
	if graceDisabledFingerprint == explicitFingerprint {
		t.Fatal("changing the normal pallet grace policy did not change the fingerprint")
	}
}

func TestCalculateBillingPreviewDeduplicatesNormalContainerInboundFeeAcrossReceipts(t *testing.T) {
	graceEnabled := false
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-03",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates: BillingRatesSnapshot{
			InboundContainerFee:  450,
			WrappingFeePerPallet: 15,
		},
	})
	if err != nil {
		t.Fatalf("normalize input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "Customer",
		Inbound: []billingInboundSource{
			{DocumentID: 12, LocationID: 1, LocationName: "308", ContainerNo: "CONT-A", ContainerType: ContainerTypeNormal, OccurredOn: billingTestDate(2026, 4, 2), Pallets: 2},
			{DocumentID: 11, LocationID: 1, LocationName: "308", ContainerNo: " cont-a ", ContainerType: ContainerTypeNormal, OccurredOn: billingTestDate(2026, 4, 1), Pallets: 3},
		},
	}

	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	var inboundLines, wrappingLines int
	var inboundSourceID int64
	for _, line := range preview.Lines {
		switch line.ChargeType {
		case BillingChargeInbound:
			inboundLines++
			inboundSourceID = line.SourceID
		case BillingChargeWrapping:
			wrappingLines++
		}
	}
	if inboundLines != 1 || inboundSourceID != 11 {
		t.Fatalf("expected only the initial normalized container receipt to carry the inbound fee, lines=%d source=%d", inboundLines, inboundSourceID)
	}
	if wrappingLines != 2 {
		t.Fatalf("wrapping must remain receipt based, got %d lines", wrappingLines)
	}
	if preview.Summary.ReceivedContainers != 1 || preview.Summary.ReceivedPallets != 5 {
		t.Fatalf("unexpected deduplicated receipt summary: %#v", preview.Summary)
	}
	if preview.Summary.InboundAmount != 450 || preview.Summary.WrappingAmount != 75 {
		t.Fatalf("unexpected receipt charges: %#v", preview.Summary)
	}
}

func TestCalculateBillingPreviewDoesNotRechargeContainerWhoseInitialReceiptPredatesScope(t *testing.T) {
	graceEnabled := false
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-30",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates:                          BillingRatesSnapshot{InboundContainerFee: 450, WrappingFeePerPallet: 15},
	})
	if err != nil {
		t.Fatalf("normalize input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "Customer",
		Inbound: []billingInboundSource{
			{DocumentID: 1, LocationID: 1, LocationName: "308", ContainerNo: "CONT-A", ContainerType: ContainerTypeNormal, OccurredOn: billingTestDate(2026, 3, 31), Pallets: 3},
			{DocumentID: 2, LocationID: 1, LocationName: "308", ContainerNo: "cont-a", ContainerType: ContainerTypeNormal, OccurredOn: billingTestDate(2026, 4, 2), Pallets: 2},
		},
	}

	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	var inboundLines, wrappingLines int
	for _, line := range preview.Lines {
		if line.ChargeType == BillingChargeInbound {
			inboundLines++
		}
		if line.ChargeType == BillingChargeWrapping {
			wrappingLines++
		}
	}
	if inboundLines != 0 || preview.Summary.ReceivedContainers != 0 {
		t.Fatalf("later partial receipt recharged the existing container: lines=%d summary=%#v", inboundLines, preview.Summary)
	}
	if wrappingLines != 1 || preview.Summary.ReceivedPallets != 2 || preview.Summary.WrappingAmount != 30 {
		t.Fatalf("in-period receipt wrapping was not retained: lines=%d summary=%#v", wrappingLines, preview.Summary)
	}
}

func TestCalculateBillingStorageKeepsFourDecimalDailyRate(t *testing.T) {
	graceEnabled := false
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-07",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates:                          BillingRatesSnapshot{StorageFeePerPalletWeekNormal: 10},
	})
	if err != nil {
		t.Fatalf("normalize input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "Customer",
		Lifecycle: []billingLifecycleSource{{
			EventID: 1, LocationID: 1, LocationName: "308", ContainerNo: "CONT-A",
			EventType: "RECEIVE", EventDate: billingTestDate(2026, 4, 1), PalletDelta: 1,
		}},
		ContainerTypes: []billingContainerTypeSource{{ContainerNo: "CONT-A", ContainerType: ContainerTypeNormal}},
	}

	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	if len(preview.Lines) != 1 || preview.Lines[0].ChargeType != BillingChargeStorage {
		t.Fatalf("unexpected storage lines: %#v", preview.Lines)
	}
	line := preview.Lines[0]
	if line.UnitRate != 1.4286 {
		t.Fatalf("daily rate was not retained to four decimals: %.8f", line.UnitRate)
	}
	if roundCurrencyGo(line.Quantity*line.UnitRate) != line.Amount {
		t.Fatalf("displayed quantity x rate does not reconcile: %.4f x %.4f != %.2f", line.Quantity, line.UnitRate, line.Amount)
	}
}

func TestSummarizeBillingPreviewCountsUniqueReceivedContainerIdentity(t *testing.T) {
	summary := summarizeBillingPreview([]BillingPreviewLine{
		{ChargeType: BillingChargeInbound, ContainerNo: " transfer-a ", ContainerType: ContainerTypeWestCoastTransfer, Quantity: 2, Amount: 20},
		{ChargeType: BillingChargeInbound, ContainerNo: "TRANSFER-A", ContainerType: ContainerTypeWestCoastTransfer, Quantity: 3, Amount: 30},
	}, nil)

	if summary.ReceivedContainers != 1 {
		t.Fatalf("received container count was not deduplicated: %#v", summary)
	}
	if summary.ReceivedPallets != 5 || summary.InboundAmount != 50 {
		t.Fatalf("transfer receipt pallet quantities or fees were incorrectly deduplicated: %#v", summary)
	}
}

func TestExplicitZeroTransferInboundRateSurvivesPreviewFingerprintAndInvoicePreparation(t *testing.T) {
	graceEnabled := false
	input, billingRange, grace, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-01",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates: BillingRatesSnapshot{
			TransferInboundFeePerPallet:              0,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
		},
	})
	if err != nil {
		t.Fatalf("normalize preview input: %v", err)
	}
	sources := billingPreviewSources{
		CustomerName: "Transfer Customer",
		Inbound: []billingInboundSource{{
			DocumentID: 1, LocationID: 2, LocationName: "Transfer Hub",
			ContainerNo: "TRANSFER-ZERO", ContainerType: ContainerTypeWestCoastTransfer,
			OccurredOn: billingTestDate(2026, 4, 1), Pallets: 3,
		}},
	}
	preview, err := calculateBillingPreview(input, billingRange, grace, sources)
	if err != nil {
		t.Fatalf("calculate preview: %v", err)
	}
	if len(preview.Lines) != 1 || preview.Lines[0].UnitRate != 0 || preview.Lines[0].Amount != 0 {
		t.Fatalf("explicit zero transfer rate changed in preview: %#v", preview.Lines)
	}
	changedRateInput := input
	changedRateInput.Rates.TransferInboundFeePerPallet = 10
	changedFingerprint, err := fingerprintBillingPreviewSources(changedRateInput, grace, sources)
	if err != nil {
		t.Fatalf("fingerprint changed transfer rate: %v", err)
	}
	if changedFingerprint == preview.SourceFingerprint {
		t.Fatal("transfer inbound rate was not included in the fingerprint")
	}

	lines, err := buildAuthoritativeBillingInvoiceLines(BillingInvoiceTypeMixed, preview, "Transfer Hub")
	if err != nil {
		t.Fatalf("build generated lines: %v", err)
	}
	if len(lines) != 1 || lines[0].UnitRate != 0 || lines[0].Amount != 0 {
		t.Fatalf("explicit zero transfer rate changed in generated lines: %#v", lines)
	}
	prepared, err := prepareBillingInvoiceCreate(CreateBillingInvoiceInput{
		InvoiceType: BillingInvoiceTypeMixed, CustomerID: 1, CustomerName: "Transfer Customer",
		PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd, Rates: preview.Rates, Lines: lines,
	})
	if err != nil {
		t.Fatalf("prepare generated invoice: %v", err)
	}
	var persistedRates BillingRatesSnapshot
	if err := json.Unmarshal([]byte(prepared.ratesJSON), &persistedRates); err != nil {
		t.Fatalf("decode prepared rates_json: %v", err)
	}
	if persistedRates.TransferInboundFeePerPallet != 0 {
		t.Fatalf("explicit zero transfer rate changed in rates_json: %#v", persistedRates)
	}
}

func TestNormalizeBillingPreviewInputRejectsInvalidScope(t *testing.T) {
	_, _, _, err := normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-02", PeriodEnd: "2026-04-01",
	})
	if err == nil {
		t.Fatal("expected inverted billing period to fail")
	}
	_, _, _, err = normalizeBillingPreviewInput(BillingPreviewInput{
		CustomerID: 1, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-02",
		Rates: BillingRatesSnapshot{OutboundFeePerPallet: -1},
	})
	if err == nil {
		t.Fatal("expected negative billing rate to fail")
	}
}

func TestCalculateBillingPreviewIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Billing Preview "+suffix)
	location := mustCreateLocation(t, ctx, store, "308 "+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "BILL-"+suffix, 0)
	containerNo := "BILL-CONT-" + suffix

	_, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID: customer.ID, LocationID: location.ID,
		ActualArrivalDate: "2026-04-01", ContainerNo: containerNo,
		ContainerType: ContainerTypeNormal, StorageSection: DefaultStorageSection,
		Status: DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 10, ReceivedQty: 10,
			Pallets: 3, StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound: %v", err)
	}
	_, err = store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID: customer.ID, LocationID: location.ID,
		ActualArrivalDate: "2026-04-02", ContainerNo: "DRAFT-" + suffix,
		ContainerType: ContainerTypeNormal, StorageSection: DefaultStorageSection,
		Status: DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 99, ReceivedQty: 99,
			Pallets: 9, StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create draft inbound: %v", err)
	}
	stock := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	_, err = store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "PO-" + suffix, ActualShipDate: "2026-04-03", Status: DocumentStatusConfirmed,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID: customer.ID, LocationID: location.ID, SKUMasterID: stock.SKUMasterID,
			Quantity: 4, Pallets: 2,
			PickAllocations: []OutboundPickAllocation{{
				LocationID: location.ID, StorageSection: DefaultStorageSection,
				ContainerNo: containerNo, AllocatedQty: 4, Pallets: 1,
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound: %v", err)
	}

	graceEnabled := false
	preview, err := store.CalculateBillingPreview(ctx, BillingPreviewInput{
		CustomerID: customer.ID, PeriodStart: "2026-04-01", PeriodEnd: "2026-04-03",
		NormalPalletGracePeriodEnabled: &graceEnabled,
		Rates: BillingRatesSnapshot{
			InboundContainerFee: 450, WrappingFeePerPallet: 15,
			StorageFeePerPalletWeekNormal: 7, OutboundFeePerPallet: 10,
		},
	})
	if err != nil {
		t.Fatalf("calculate billing preview: %v", err)
	}
	if preview.Summary.ReceivedContainers != 1 || preview.Summary.ReceivedPallets != 3 {
		t.Fatalf("draft receipt leaked into billing: %#v", preview.Summary)
	}
	if preview.Summary.ShippedPallets != 2 {
		t.Fatalf("outbound shipping pallets must remain independent from the one inventory pallet removed: %#v", preview.Summary)
	}
	if preview.Summary.PalletDays != 8 {
		t.Fatalf("storage should use lifecycle pallet deltas (3 + 3 + 2), got %#v", preview.Summary)
	}
	for _, line := range preview.Lines {
		if line.ContainerNo != containerNo {
			t.Fatalf("unexpected or missing container on billing line %#v", line)
		}
	}
}

func billingTestDate(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
