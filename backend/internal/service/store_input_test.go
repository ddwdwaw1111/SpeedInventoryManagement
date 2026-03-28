package service

import (
	"errors"
	"testing"
)

func TestSanitizeItemInput(t *testing.T) {
	input := sanitizeItemInput(CreateItemInput{
		SKU:            "  sku-1001 ",
		Description:    "  Disposable Pan ",
		ContainerNo:    "  mrku123 ",
		StorageSection: " ",
	})

	if input.SKU != "SKU-1001" {
		t.Fatalf("expected uppercase SKU, got %q", input.SKU)
	}
	if input.Name != "Disposable Pan" {
		t.Fatalf("expected name to default to description, got %q", input.Name)
	}
	if input.Category != "General" {
		t.Fatalf("expected default category, got %q", input.Category)
	}
	if input.Unit != "pcs" {
		t.Fatalf("expected default unit, got %q", input.Unit)
	}
	if input.ContainerNo != "MRKU123" {
		t.Fatalf("expected uppercase container number, got %q", input.ContainerNo)
	}
	if input.StorageSection != DefaultStorageSection {
		t.Fatalf("expected default storage section %s, got %q", DefaultStorageSection, input.StorageSection)
	}
}

func TestValidateItemInput(t *testing.T) {
	validInput := CreateItemInput{
		SKU:          "SKU-1001",
		Description:  "Disposable Pan",
		CustomerID:   1,
		LocationID:   2,
		Quantity:     10,
		AllocatedQty: 2,
		DamagedQty:   1,
		HoldQty:      1,
		ReorderLevel: 2,
	}

	if err := validateItemInput(validInput); err != nil {
		t.Fatalf("expected valid item input, got %v", err)
	}

	testCases := []CreateItemInput{
		{Description: "Disposable Pan", CustomerID: 1, LocationID: 2},
		{SKU: "SKU-1001", CustomerID: 1, LocationID: 2},
		{SKU: "SKU-1001", Description: "Disposable Pan", CustomerID: 0, LocationID: 2},
		{SKU: "SKU-1001", Description: "Disposable Pan", CustomerID: 1, LocationID: 0},
		{SKU: "SKU-1001", Description: "Disposable Pan", CustomerID: 1, LocationID: 2, Quantity: -1},
		{SKU: "SKU-1001", Description: "Disposable Pan", CustomerID: 1, LocationID: 2, Quantity: 10, AllocatedQty: -1},
		{SKU: "SKU-1001", Description: "Disposable Pan", CustomerID: 1, LocationID: 2, Quantity: 5, AllocatedQty: 2, DamagedQty: 2, HoldQty: 2},
	}

	for _, tc := range testCases {
		if err := validateItemInput(tc); err == nil || !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v for input %#v", err, tc)
		}
	}
}

func TestSanitizeMovementInput(t *testing.T) {
	input := sanitizeMovementInput(CreateMovementInput{
		MovementType:   " out ",
		ContainerNo:    " mrku123 ",
		PackingListNo:  " pl-001 ",
		OrderRef:       " so-123 ",
		ItemNumber:     " item-1 ",
		StorageSection: " b ",
		ReferenceCode:  " ref-1 ",
		DocumentNote:   "  external note ",
		Reason:         "  internal note ",
	})

	if input.MovementType != "OUT" {
		t.Fatalf("expected uppercase movement type, got %q", input.MovementType)
	}
	if input.ContainerNo != "MRKU123" {
		t.Fatalf("expected uppercase container number, got %q", input.ContainerNo)
	}
	if input.PackingListNo != "PL-001" {
		t.Fatalf("expected uppercase packing list number, got %q", input.PackingListNo)
	}
	if input.StorageSection != "B" {
		t.Fatalf("expected uppercase storage section, got %q", input.StorageSection)
	}
	if input.ReferenceCode != "REF-1" {
		t.Fatalf("expected uppercase reference code, got %q", input.ReferenceCode)
	}
	if input.DocumentNote != "external note" {
		t.Fatalf("expected trimmed document note, got %q", input.DocumentNote)
	}
	if input.Reason != "internal note" {
		t.Fatalf("expected trimmed reason, got %q", input.Reason)
	}
}

func TestResolveMovementDelta(t *testing.T) {
	testCases := []struct {
		name         string
		movementType string
		quantity     int
		wantDelta    int
		wantErr      bool
	}{
		{name: "inbound", movementType: "IN", quantity: 10, wantDelta: 10},
		{name: "outbound", movementType: "OUT", quantity: 4, wantDelta: -4},
		{name: "adjustment", movementType: "ADJUST", quantity: -2, wantDelta: -2},
		{name: "reversal", movementType: "REVERSAL", quantity: 5, wantDelta: 5},
		{name: "transfer in", movementType: "TRANSFER_IN", quantity: 3, wantDelta: 3},
		{name: "transfer out", movementType: "TRANSFER_OUT", quantity: 3, wantDelta: -3},
		{name: "count", movementType: "COUNT", quantity: -1, wantDelta: -1},
		{name: "invalid type", movementType: "OTHER", quantity: 1, wantErr: true},
		{name: "zero outbound", movementType: "OUT", quantity: 0, wantErr: true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveMovementDelta(tc.movementType, tc.quantity)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("expected ErrInvalidInput, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveMovementDelta returned error: %v", err)
			}
			if got != tc.wantDelta {
				t.Fatalf("expected delta %d, got %d", tc.wantDelta, got)
			}
		})
	}
}

func TestParseOptionalDate(t *testing.T) {
	testCases := []struct {
		name    string
		value   string
		wantNil bool
		want    string
		wantErr bool
	}{
		{name: "blank", value: " ", wantNil: true},
		{name: "iso date", value: "2026-03-22", want: "2026-03-22"},
		{name: "slash date", value: "2026/3/22", want: "2026-03-22"},
		{name: "us date", value: "03/22/2026", want: "2026-03-22"},
		{name: "invalid", value: "2026-99-99", wantErr: true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := parseOptionalDate(tc.value)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("expected ErrInvalidInput, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseOptionalDate returned error: %v", err)
			}
			if tc.wantNil {
				if parsed != nil {
					t.Fatalf("expected nil date, got %v", parsed)
				}
				return
			}
			if parsed == nil {
				t.Fatal("expected parsed date")
			}
			if got := parsed.Format("2006-01-02"); got != tc.want {
				t.Fatalf("expected %s, got %s", tc.want, got)
			}
		})
	}
}

func TestDefaultMovementReason(t *testing.T) {
	testCases := map[string]string{
		"IN":           "Inbound shipment recorded",
		"OUT":          "Outbound shipment recorded",
		"REVERSAL":     "Outbound shipment reversed",
		"TRANSFER_IN":  "Inventory transfer received",
		"TRANSFER_OUT": "Inventory transfer shipped",
		"COUNT":        "Cycle count variance recorded",
		"ADJUST":       "Inventory adjustment recorded",
	}

	for movementType, want := range testCases {
		if got := defaultMovementReason(movementType); got != want {
			t.Fatalf("expected %q for %s, got %q", want, movementType, got)
		}
	}
}
