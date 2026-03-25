package service

import (
	"errors"
	"testing"
)

func TestSanitizeSKUMasterInput(t *testing.T) {
	input := sanitizeSKUMasterInput(CreateSKUMasterInput{
		ItemNumber:            " vb22gc ",
		SKU:                   " 608333 ",
		Name:                  " ",
		Category:              " ",
		Description:           "  kraft bag ",
		Unit:                  " ctn ",
		ReorderLevel:          200,
		DefaultUnitsPerPallet: 200,
	})

	if input.ItemNumber != "VB22GC" {
		t.Fatalf("expected uppercase item number, got %q", input.ItemNumber)
	}
	if input.SKU != "608333" {
		t.Fatalf("expected uppercase sku, got %q", input.SKU)
	}
	if input.Name != "kraft bag" {
		t.Fatalf("expected fallback name from description, got %q", input.Name)
	}
	if input.Category != "General" {
		t.Fatalf("expected default category General, got %q", input.Category)
	}
	if input.Unit != "ctn" {
		t.Fatalf("expected normalized unit, got %q", input.Unit)
	}
	if input.DefaultUnitsPerPallet != 200 {
		t.Fatalf("expected default units per pallet to be preserved, got %d", input.DefaultUnitsPerPallet)
	}
}

func TestValidateSKUMasterInput(t *testing.T) {
	validInput := CreateSKUMasterInput{
		SKU:                   "608333",
		Description:           "kraft bag",
		ReorderLevel:          200,
		DefaultUnitsPerPallet: 200,
	}

	if err := validateSKUMasterInput(validInput); err != nil {
		t.Fatalf("expected valid sku master input, got %v", err)
	}

	invalidInputs := []CreateSKUMasterInput{
		{Description: "kraft bag"},
		{SKU: "608333"},
		{SKU: "608333", Description: "kraft bag", ReorderLevel: -1},
		{SKU: "608333", Description: "kraft bag", DefaultUnitsPerPallet: -1},
	}

	for _, input := range invalidInputs {
		if err := validateSKUMasterInput(input); err == nil || !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v for input %#v", err, input)
		}
	}
}
