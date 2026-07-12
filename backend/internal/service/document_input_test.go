package service

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestSanitizeInboundDocumentInput(t *testing.T) {
	input := sanitizeInboundDocumentInput(CreateInboundDocumentInput{
		ContainerNo:    " mrku123 ",
		StorageSection: " ",
		UnitLabel:      " pcs ",
		Status:         " confirmed ",
		DocumentNote:   "  inbound note ",
		Lines: []CreateInboundDocumentLineInput{
			{ItemNumber: " item-100 ", SKU: " sku-1 ", Description: "  Pan  ", StorageSection: " b ", LineNote: "  keep cold ", ExpectedQty: 10, ReorderLevel: 9, UnitsPerPallet: 4},
			{SKU: " ", Description: "ignored"},
		},
	})

	if input.ContainerNo != "MRKU123" {
		t.Fatalf("expected uppercase container number, got %q", input.ContainerNo)
	}
	if input.StorageSection != DefaultStorageSection {
		t.Fatalf("expected default storage section %s, got %q", DefaultStorageSection, input.StorageSection)
	}
	if input.UnitLabel != "CTN" {
		t.Fatalf("expected receiving to force the legacy unit label to CTN, got %q", input.UnitLabel)
	}
	if input.Status != "CONFIRMED" {
		t.Fatalf("expected uppercase status, got %q", input.Status)
	}
	if input.DocumentNote != "inbound note" {
		t.Fatalf("expected trimmed document note, got %q", input.DocumentNote)
	}
	if len(input.Lines) != 1 {
		t.Fatalf("expected 1 sanitized line, got %d", len(input.Lines))
	}
	if input.Lines[0].SKU != "SKU-1" {
		t.Fatalf("expected uppercase line SKU, got %q", input.Lines[0].SKU)
	}
	if input.Lines[0].ItemNumber != "ITEM-100" {
		t.Fatalf("expected uppercase line item code, got %q", input.Lines[0].ItemNumber)
	}
	if input.Lines[0].StorageSection != "B" {
		t.Fatalf("expected uppercase line storage section, got %q", input.Lines[0].StorageSection)
	}
	if input.Lines[0].LineNote != "keep cold" {
		t.Fatalf("expected trimmed line note, got %q", input.Lines[0].LineNote)
	}
	if input.Lines[0].ReorderLevel != 0 {
		t.Fatalf("expected receiving to ignore the deprecated reorder level, got %d", input.Lines[0].ReorderLevel)
	}
	if input.Lines[0].UnitsPerPallet != 4 {
		t.Fatalf("expected CTN per pallet to be preserved as receipt metadata, got %d", input.Lines[0].UnitsPerPallet)
	}
}

func TestValidateInboundDocumentInput(t *testing.T) {
	validInput := CreateInboundDocumentInput{
		CustomerID: 1,
		LocationID: 2,
		Lines: []CreateInboundDocumentLineInput{
			{SKU: "SKU-1", ExpectedQty: 10, Pallets: 1},
		},
	}

	if err := validateInboundDocumentInput(validInput); err != nil {
		t.Fatalf("expected valid inbound document, got %v", err)
	}

	testCases := []CreateInboundDocumentInput{
		{LocationID: 1, Lines: []CreateInboundDocumentLineInput{{SKU: "SKU-1", ExpectedQty: 10}}},
		{CustomerID: 1, Lines: []CreateInboundDocumentLineInput{{SKU: "SKU-1", ExpectedQty: 10}}},
		{CustomerID: 1, LocationID: 2},
		{CustomerID: 1, LocationID: 2, Status: "INVALID", Lines: []CreateInboundDocumentLineInput{{SKU: "SKU-1", ExpectedQty: 10}}},
		{CustomerID: 1, LocationID: 2, Lines: []CreateInboundDocumentLineInput{{SKU: "", ExpectedQty: 10}}},
		{CustomerID: 1, LocationID: 2, Lines: []CreateInboundDocumentLineInput{{SKU: "SKU-1"}}},
	}

	for _, tc := range testCases {
		if err := validateInboundDocumentInput(tc); err == nil || !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v for input %#v", err, tc)
		}
	}
}

func TestConfirmedInboundKeepsQuantityAndPalletCountIndependent(t *testing.T) {
	input := CreateInboundDocumentInput{
		CustomerID:     1,
		LocationID:     2,
		HandlingMode:   InboundHandlingModePalletized,
		Status:         DocumentStatusConfirmed,
		TrackingStatus: InboundTrackingReceived,
		Lines: []CreateInboundDocumentLineInput{
			{SKU: "SKU-1", ExpectedQty: 10, ReceivedQty: 10, Pallets: 3, UnitsPerPallet: 4},
		},
	}

	if err := validateInboundDocumentInput(input); err != nil {
		t.Fatalf("expected independent inbound quantity and pallet count to be valid, got %v", err)
	}
	if len(input.Lines[0].PalletBreakdown) != 0 {
		t.Fatal("expected no pallet breakdown to be required")
	}

	input.Lines[0].Pallets = 0
	if err := validateInboundDocumentInput(input); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected confirmed receipt without pallets to be invalid, got %v", err)
	}
}

func TestSanitizeOutboundDocumentInput(t *testing.T) {
	input := sanitizeOutboundDocumentInput(CreateOutboundDocumentInput{
		PackingListNo: " pl-001 ",
		OrderRef:      " so-100 ",
		ShipToName:    " receiver ",
		ShipToAddress: " 123 main st ",
		ShipToContact: " alex ",
		CarrierName:   " fedex ",
		Status:        " draft ",
		DocumentNote:  "  urgent shipment ",
		Lines: []CreateOutboundDocumentLineInput{
			{CustomerID: 1, LocationID: 2, SKUMasterID: 3, Quantity: 3, UnitLabel: " ctn ", CartonSizeMM: " 400*300*200 ", LineNote: "  fragile "},
			{CustomerID: 0, LocationID: 2, SKUMasterID: 3, Quantity: 1},
		},
	})

	if input.PackingListNo != "PL-001" {
		t.Fatalf("expected uppercase packing list number, got %q", input.PackingListNo)
	}
	if input.OrderRef != "SO-100" {
		t.Fatalf("expected uppercase order ref, got %q", input.OrderRef)
	}
	if input.ShipToName != "receiver" || input.ShipToAddress != "123 main st" || input.ShipToContact != "alex" {
		t.Fatalf("expected trimmed ship-to fields, got %#v", input)
	}
	if input.CarrierName != "fedex" {
		t.Fatalf("expected normalized shipment fields, got %#v", input)
	}
	if input.Status != "DRAFT" {
		t.Fatalf("expected uppercase document status, got %q", input.Status)
	}
	if input.DocumentNote != "urgent shipment" {
		t.Fatalf("expected trimmed document note, got %q", input.DocumentNote)
	}
	if len(input.Lines) != 1 {
		t.Fatalf("expected 1 valid outbound line, got %d", len(input.Lines))
	}
	if input.Lines[0].UnitLabel != "CTN" {
		t.Fatalf("expected uppercase unit label, got %q", input.Lines[0].UnitLabel)
	}
	if input.Lines[0].LineNote != "fragile" {
		t.Fatalf("expected trimmed line note, got %q", input.Lines[0].LineNote)
	}
}

func TestValidateOutboundDocumentInput(t *testing.T) {
	validInput := CreateOutboundDocumentInput{
		Lines: []CreateOutboundDocumentLineInput{
			{CustomerID: 1, LocationID: 2, SKUMasterID: 3, Quantity: 3, Pallets: 1},
		},
	}

	if err := validateOutboundDocumentInput(validInput); err != nil {
		t.Fatalf("expected valid outbound document, got %v", err)
	}

	testCases := []CreateOutboundDocumentInput{
		{},
		{Status: "UNKNOWN", Lines: []CreateOutboundDocumentLineInput{{CustomerID: 1, LocationID: 2, SKUMasterID: 3, Quantity: 3}}},
		{Lines: []CreateOutboundDocumentLineInput{{CustomerID: 0, LocationID: 2, SKUMasterID: 3, Quantity: 3}}},
		{Lines: []CreateOutboundDocumentLineInput{{CustomerID: 1, LocationID: 0, SKUMasterID: 3, Quantity: 3}}},
		{Lines: []CreateOutboundDocumentLineInput{{CustomerID: 1, LocationID: 2, SKUMasterID: 0, Quantity: 3}}},
		{Lines: []CreateOutboundDocumentLineInput{{CustomerID: 1, LocationID: 2, SKUMasterID: 3, Quantity: 0}}},
		{Lines: []CreateOutboundDocumentLineInput{{CustomerID: 1, LocationID: 2, SKUMasterID: 3, Quantity: 1, NetWeightKgs: -1}}},
	}

	for _, tc := range testCases {
		if err := validateOutboundDocumentInput(tc); err == nil || !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v for input %#v", err, tc)
		}
	}
}

func TestConfirmedOutboundAcceptsIndependentQtyAndPalletCountWhenAllocationMatches(t *testing.T) {
	input := CreateOutboundDocumentInput{
		Status:         DocumentStatusConfirmed,
		TrackingStatus: OutboundTrackingShipped,
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:  1,
				LocationID:  2,
				SKUMasterID: 3,
				Quantity:    10,
				Pallets:     3,
				PickAllocations: []OutboundPickAllocation{
					{LocationID: 2, StorageSection: "TEMP", ContainerNo: "CONT-A", AllocatedQty: 10, Pallets: 3},
				},
			},
		},
	}

	if err := validateOutboundDocumentInput(input); err != nil {
		t.Fatalf("expected independent outbound quantity and pallet count to be valid, got %v", err)
	}
	input.Lines[0].PickAllocations[0].Pallets = 2
	if err := validateOutboundDocumentInput(input); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected mismatched declared and allocation pallet counts to be rejected, got %v", err)
	}
}

func TestOutboundTrackingBOReceivedIsTerminal(t *testing.T) {
	if got := normalizeOutboundTrackingStatus(" bo_received ", DocumentStatusConfirmed); got != OutboundTrackingBOReceived {
		t.Fatalf("expected BO received tracking status, got %q", got)
	}
	if err := validateOutboundTrackingTransition(OutboundTrackingShipped, OutboundTrackingBOReceived); err != nil {
		t.Fatalf("expected shipped to BO received transition to be valid, got %v", err)
	}
	if err := validateOutboundTrackingTransition(OutboundTrackingBOReceived, OutboundTrackingShipped); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected BO received to shipped transition to be invalid, got %v", err)
	}

	input := CreateOutboundDocumentInput{
		Status:         DocumentStatusConfirmed,
		TrackingStatus: OutboundTrackingBOReceived,
		Lines: []CreateOutboundDocumentLineInput{
			{CustomerID: 1, LocationID: 2, SKUMasterID: 3, Quantity: 3, Pallets: 1},
		},
	}
	if err := validateOutboundDocumentInput(input); err != nil {
		t.Fatalf("expected confirmed BO received outbound document to be valid, got %v", err)
	}
}

func TestResolveConfirmedOutboundTrackingStatus(t *testing.T) {
	testCases := []struct {
		name     string
		existing string
		override string
		want     string
	}{
		{name: "defaults to shipped", existing: OutboundTrackingScheduled, want: OutboundTrackingShipped},
		{name: "keeps existing bo received", existing: OutboundTrackingBOReceived, want: OutboundTrackingBOReceived},
		{name: "uses requested bo received", existing: OutboundTrackingScheduled, override: OutboundTrackingBOReceived, want: OutboundTrackingBOReceived},
		{name: "coerces non-terminal override to shipped", existing: OutboundTrackingScheduled, override: OutboundTrackingPacked, want: OutboundTrackingShipped},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			if tc.override == "" {
				got = resolveConfirmedOutboundTrackingStatus(tc.existing)
			} else {
				got = resolveConfirmedOutboundTrackingStatus(tc.existing, tc.override)
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

func TestBuildOutboundTrackingStatusFilterClause(t *testing.T) {
	clause, args := buildOutboundTrackingStatusFilterClause("d", " bo_received ")
	if clause == "" {
		t.Fatal("expected BO received tracking filter clause")
	}
	if len(args) != 1 || args[0] != OutboundTrackingBOReceived {
		t.Fatalf("expected BO received tracking filter arg, got %#v", args)
	}

	clause, args = buildOutboundTrackingStatusFilterClause("d", "all")
	if clause != "" || len(args) != 0 {
		t.Fatalf("expected all tracking status to skip filter, got clause=%q args=%#v", clause, args)
	}

	clause, args = buildOutboundTrackingStatusFilterClause("d", "not-a-status")
	if clause != "1 = 0" || len(args) != 0 {
		t.Fatalf("expected unknown tracking status to match no rows, got clause=%q args=%#v", clause, args)
	}
}

func TestBuildInboundTrackingStatusFilterClause(t *testing.T) {
	clause, args := buildInboundTrackingStatusFilterClause("d", " receiving ")
	if clause == "" {
		t.Fatal("expected receiving tracking filter clause")
	}
	if len(args) != 1 || args[0] != InboundTrackingReceiving {
		t.Fatalf("expected receiving tracking filter arg, got %#v", args)
	}

	clause, args = buildInboundTrackingStatusFilterClause("d", InboundTrackingReceivingReceived)
	if clause == "" || !strings.Contains(clause, "IN") {
		t.Fatalf("expected combined receiving/received tracking filter clause, got %q", clause)
	}
	if len(args) != 2 || args[0] != InboundTrackingReceiving || args[1] != InboundTrackingReceived {
		t.Fatalf("expected combined receiving/received tracking filter args, got %#v", args)
	}

	clause, args = buildInboundTrackingStatusFilterClause("d", "all")
	if clause != "" || len(args) != 0 {
		t.Fatalf("expected all tracking status to skip filter, got clause=%q args=%#v", clause, args)
	}

	clause, args = buildInboundTrackingStatusFilterClause("d", "not-a-status")
	if clause != "1 = 0" || len(args) != 0 {
		t.Fatalf("expected unknown tracking status to match no rows, got clause=%q args=%#v", clause, args)
	}
}

func TestParseSectionNames(t *testing.T) {
	got := parseSectionNames(`[" A ", "", "B"]`, 0)
	want := []string{DefaultStorageSection, "A", "B"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected parsed section names %v, got %v", want, got)
	}

	fallback := parseSectionNames("", 3)
	wantFallback := []string{DefaultStorageSection}
	if !reflect.DeepEqual(fallback, wantFallback) {
		t.Fatalf("expected fallback section names %v, got %v", wantFallback, fallback)
	}
}
