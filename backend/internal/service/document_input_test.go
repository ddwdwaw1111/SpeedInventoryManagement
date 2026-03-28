package service

import (
	"errors"
	"reflect"
	"testing"
)

func TestSanitizeInboundDocumentInput(t *testing.T) {
	input := sanitizeInboundDocumentInput(CreateInboundDocumentInput{
		ContainerNo:    " mrku123 ",
		StorageSection: " ",
		UnitLabel:      " ctn ",
		Status:         " confirmed ",
		DocumentNote:   "  inbound note ",
		Lines: []CreateInboundDocumentLineInput{
			{SKU: " sku-1 ", Description: "  Pan  ", StorageSection: " b ", LineNote: "  keep cold ", ExpectedQty: 10},
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
		t.Fatalf("expected uppercase unit label, got %q", input.UnitLabel)
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
	if input.Lines[0].StorageSection != "B" {
		t.Fatalf("expected uppercase line storage section, got %q", input.Lines[0].StorageSection)
	}
	if input.Lines[0].LineNote != "keep cold" {
		t.Fatalf("expected trimmed line note, got %q", input.Lines[0].LineNote)
	}
}

func TestValidateInboundDocumentInput(t *testing.T) {
	validInput := CreateInboundDocumentInput{
		CustomerID: 1,
		LocationID: 2,
		Lines: []CreateInboundDocumentLineInput{
			{SKU: "SKU-1", ExpectedQty: 10},
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
			{ItemID: 1, Quantity: 3, UnitLabel: " ctn ", CartonSizeMM: " 400*300*200 ", LineNote: "  fragile "},
			{ItemID: 0, Quantity: 1},
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
			{ItemID: 1, Quantity: 3},
		},
	}

	if err := validateOutboundDocumentInput(validInput); err != nil {
		t.Fatalf("expected valid outbound document, got %v", err)
	}

	testCases := []CreateOutboundDocumentInput{
		{},
		{Status: "UNKNOWN", Lines: []CreateOutboundDocumentLineInput{{ItemID: 1, Quantity: 3}}},
		{Lines: []CreateOutboundDocumentLineInput{{ItemID: 0, Quantity: 3}}},
		{Lines: []CreateOutboundDocumentLineInput{{ItemID: 1, Quantity: 0}}},
		{Lines: []CreateOutboundDocumentLineInput{{ItemID: 1, Quantity: 1, NetWeightKgs: -1}}},
	}

	for _, tc := range testCases {
		if err := validateOutboundDocumentInput(tc); err == nil || !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v for input %#v", err, tc)
		}
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
