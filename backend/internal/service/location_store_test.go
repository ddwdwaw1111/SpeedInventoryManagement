package service

import (
	"reflect"
	"testing"
)

func TestSanitizeLocationInputDerivesSectionsFromLayout(t *testing.T) {
	input := sanitizeLocationInput(CreateLocationInput{
		Name:    " NJ Warehouse ",
		Address: " 100 Harbor Blvd ",
		LayoutBlocks: []StorageLayoutBlock{
			{ID: "temp", Type: StorageLayoutBlockTypeTemporary, Name: " "},
			{ID: "section-a", Type: StorageLayoutBlockTypeSection, Name: " a-01 ", X: -1, Y: 2, Width: 0, Height: -3},
			{ID: "support-1", Type: StorageLayoutBlockTypeSupport, Name: " "},
		},
	})

	if len(input.LayoutBlocks) != 3 {
		t.Fatalf("expected 3 layout blocks, got %d", len(input.LayoutBlocks))
	}

	if input.LayoutBlocks[0].Name != "Temporary Area" {
		t.Fatalf("expected temporary area name, got %q", input.LayoutBlocks[0].Name)
	}

	if input.LayoutBlocks[1].Name != "A-01" {
		t.Fatalf("expected section name A-01, got %q", input.LayoutBlocks[1].Name)
	}

	if input.LayoutBlocks[1].X != 0 || input.LayoutBlocks[1].Width != 4 || input.LayoutBlocks[1].Height != 3 {
		t.Fatalf("expected sanitized section geometry, got %#v", input.LayoutBlocks[1])
	}

	if input.LayoutBlocks[2].Name != "Support 3" {
		t.Fatalf("expected generated support name, got %q", input.LayoutBlocks[2].Name)
	}

	wantSections := []string{DefaultStorageSection, "A-01"}
	if !reflect.DeepEqual(input.SectionNames, wantSections) {
		t.Fatalf("expected derived sections %v, got %v", wantSections, input.SectionNames)
	}
}

func TestSanitizeLocationInputBuildsDefaultTemporaryLayout(t *testing.T) {
	input := sanitizeLocationInput(CreateLocationInput{
		Name:         "LA",
		Address:      "200 Main St",
		SectionNames: nil,
		LayoutBlocks: nil,
	})

	if len(input.LayoutBlocks) != 1 {
		t.Fatalf("expected 1 default layout block, got %d", len(input.LayoutBlocks))
	}

	if input.LayoutBlocks[0].Type != StorageLayoutBlockTypeTemporary {
		t.Fatalf("expected default block to be temporary, got %q", input.LayoutBlocks[0].Type)
	}

	wantSections := []string{DefaultStorageSection}
	if !reflect.DeepEqual(input.SectionNames, wantSections) {
		t.Fatalf("expected default sections %v, got %v", wantSections, input.SectionNames)
	}
}
