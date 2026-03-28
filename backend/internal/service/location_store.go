package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

const (
	StorageLayoutBlockTypeTemporary = "temporary"
	StorageLayoutBlockTypeSection   = "section"
	StorageLayoutBlockTypeSupport   = "support"
)

func (s *Store) ListLocations(ctx context.Context) ([]Location, error) {
	rows := make([]locationRow, 0)
	if err := s.db.SelectContext(ctx, &rows, `
		SELECT
			id,
			name,
			COALESCE(address, '') AS address,
			zone,
			COALESCE(description, '') AS description,
			capacity,
			section_count,
			COALESCE(section_names_json, '') AS section_names_json,
			COALESCE(layout_json, '') AS layout_json,
			created_at
		FROM storage_locations
		ORDER BY zone ASC, name ASC
	`); err != nil {
		return nil, fmt.Errorf("load locations: %w", err)
	}

	locations := make([]Location, 0, len(rows))
	for _, row := range rows {
		locations = append(locations, row.toLocation())
	}

	return locations, nil
}

func (s *Store) CreateLocation(ctx context.Context, input CreateLocationInput) (Location, error) {
	input = sanitizeLocationInput(input)
	if err := validateLocationInput(input); err != nil {
		return Location{}, err
	}
	sectionNamesJSON, err := marshalSectionNames(input.SectionNames)
	if err != nil {
		return Location{}, fmt.Errorf("marshal location section names: %w", err)
	}
	layoutJSON, err := marshalLayoutBlocks(input.LayoutBlocks)
	if err != nil {
		return Location{}, fmt.Errorf("marshal location layout blocks: %w", err)
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO storage_locations (name, address, zone, description, capacity, section_count, section_names_json, layout_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		input.Name,
		nullableString(input.Address),
		input.Zone,
		nullableString(input.Description),
		input.Capacity,
		len(input.SectionNames),
		sectionNamesJSON,
		layoutJSON,
	)
	if err != nil {
		return Location{}, mapDBError(fmt.Errorf("create location: %w", err))
	}

	locationID, err := result.LastInsertId()
	if err != nil {
		return Location{}, fmt.Errorf("resolve location id: %w", err)
	}

	return s.getLocation(ctx, locationID)
}

func (s *Store) UpdateLocation(ctx context.Context, locationID int64, input CreateLocationInput) (Location, error) {
	input = sanitizeLocationInput(input)
	if err := validateLocationInput(input); err != nil {
		return Location{}, err
	}
	sectionNamesJSON, err := marshalSectionNames(input.SectionNames)
	if err != nil {
		return Location{}, fmt.Errorf("marshal location section names: %w", err)
	}
	layoutJSON, err := marshalLayoutBlocks(input.LayoutBlocks)
	if err != nil {
		return Location{}, fmt.Errorf("marshal location layout blocks: %w", err)
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE storage_locations
		SET
			name = ?,
			address = ?,
			zone = ?,
			description = ?,
			capacity = ?,
			section_count = ?,
			section_names_json = ?,
			layout_json = ?
		WHERE id = ?
	`,
		input.Name,
		nullableString(input.Address),
		input.Zone,
		nullableString(input.Description),
		input.Capacity,
		len(input.SectionNames),
		sectionNamesJSON,
		layoutJSON,
		locationID,
	)
	if err != nil {
		return Location{}, mapDBError(fmt.Errorf("update location: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return Location{}, fmt.Errorf("resolve updated location rows: %w", err)
	}
	if rowsAffected == 0 {
		return Location{}, ErrNotFound
	}

	return s.getLocation(ctx, locationID)
}

func (s *Store) DeleteLocation(ctx context.Context, locationID int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM storage_locations WHERE id = ?`, locationID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete location: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted location rows: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	return nil
}

func (s *Store) getLocation(ctx context.Context, locationID int64) (Location, error) {
	var row locationRow
	if err := s.db.GetContext(ctx, &row, `
		SELECT
			id,
			name,
			COALESCE(address, '') AS address,
			zone,
			COALESCE(description, '') AS description,
			capacity,
			section_count,
			COALESCE(section_names_json, '') AS section_names_json,
			COALESCE(layout_json, '') AS layout_json,
			created_at
		FROM storage_locations
		WHERE id = ?
	`, locationID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Location{}, ErrNotFound
		}
		return Location{}, fmt.Errorf("load location: %w", err)
	}

	return row.toLocation(), nil
}

func sanitizeLocationInput(input CreateLocationInput) CreateLocationInput {
	input.Name = strings.TrimSpace(input.Name)
	input.Address = strings.TrimSpace(input.Address)
	input.Zone = strings.TrimSpace(input.Zone)
	input.Description = strings.TrimSpace(input.Description)
	input.LayoutBlocks = sanitizeLayoutBlocks(input.LayoutBlocks)
	if len(input.LayoutBlocks) == 0 {
		input.LayoutBlocks = buildDefaultLayoutBlocks(input.SectionNames)
	}
	input.SectionNames = deriveSectionNamesFromLayout(input.LayoutBlocks)
	return input
}

func validateLocationInput(input CreateLocationInput) error {
	switch {
	case input.Name == "":
		return fmt.Errorf("%w: storage name is required", ErrInvalidInput)
	case input.Address == "":
		return fmt.Errorf("%w: storage address is required", ErrInvalidInput)
	case input.Zone == "":
		return fmt.Errorf("%w: storage zone is required", ErrInvalidInput)
	case input.Capacity < 0:
		return fmt.Errorf("%w: capacity cannot be negative", ErrInvalidInput)
	case len(input.LayoutBlocks) == 0:
		return fmt.Errorf("%w: at least one warehouse area is required", ErrInvalidInput)
	case len(input.SectionNames) == 0:
		return fmt.Errorf("%w: at least one storage section is required", ErrInvalidInput)
	default:
		return nil
	}
}

func marshalSectionNames(sectionNames []string) (string, error) {
	payload, err := json.Marshal(sectionNames)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func marshalLayoutBlocks(blocks []StorageLayoutBlock) (string, error) {
	payload, err := json.Marshal(blocks)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func parseSectionNames(sectionNamesJSON string, sectionCount int) []string {
	trimmed := strings.TrimSpace(sectionNamesJSON)
	if trimmed != "" {
		var parsed []string
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			sanitized := ensureStorageSections(parsed)
			if len(sanitized) > 0 {
				return sanitized
			}
		}
	}

	return []string{DefaultStorageSection}
}

func parseLayoutBlocks(layoutJSON string, sectionNames []string) []StorageLayoutBlock {
	trimmed := strings.TrimSpace(layoutJSON)
	if trimmed != "" {
		var parsed []StorageLayoutBlock
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			sanitized := sanitizeLayoutBlocks(parsed)
			if len(sanitized) > 0 {
				return sanitized
			}
		}
	}

	return buildDefaultLayoutBlocks(sectionNames)
}

func sanitizeLayoutBlocks(blocks []StorageLayoutBlock) []StorageLayoutBlock {
	sanitized := make([]StorageLayoutBlock, 0, len(blocks))
	seenIDs := make(map[string]struct{}, len(blocks))
	temporaryCount := 0

	for index, block := range blocks {
		block.ID = strings.TrimSpace(block.ID)
		if block.ID == "" {
			block.ID = fmt.Sprintf("block-%d", index+1)
		}
		if _, exists := seenIDs[block.ID]; exists {
			continue
		}
		seenIDs[block.ID] = struct{}{}

		block.Type = strings.TrimSpace(strings.ToLower(block.Type))
		if !slices.Contains([]string{
			StorageLayoutBlockTypeTemporary,
			StorageLayoutBlockTypeSection,
			StorageLayoutBlockTypeSupport,
		}, block.Type) {
			block.Type = StorageLayoutBlockTypeSection
		}
		if block.Type == StorageLayoutBlockTypeTemporary {
			temporaryCount++
			if temporaryCount > 1 {
				continue
			}
		}

		block.Name = strings.TrimSpace(block.Name)
		switch block.Type {
		case StorageLayoutBlockTypeTemporary:
			if block.Name == "" {
				block.Name = "Temporary Area"
			}
		case StorageLayoutBlockTypeSection:
			if block.Name == "" {
				block.Name = fmt.Sprintf("S%d", index+1)
			} else {
				block.Name = strings.ToUpper(block.Name)
			}
		case StorageLayoutBlockTypeSupport:
			if block.Name == "" {
				block.Name = fmt.Sprintf("Support %d", index+1)
			}
		}

		if block.X < 0 {
			block.X = 0
		}
		if block.Y < 0 {
			block.Y = 0
		}
		if block.Width <= 0 {
			block.Width = 4
		}
		if block.Height <= 0 {
			block.Height = 3
		}

		sanitized = append(sanitized, block)
	}

	if len(sanitized) == 0 {
		return buildDefaultLayoutBlocks(nil)
	}

	if !hasTemporaryLayoutBlock(sanitized) {
		sanitized = append([]StorageLayoutBlock{{
			ID:     "temp-area",
			Name:   "Temporary Area",
			Type:   StorageLayoutBlockTypeTemporary,
			X:      0,
			Y:      0,
			Width:  5,
			Height: 4,
		}}, sanitized...)
	}

	return sanitized
}

func deriveSectionNamesFromLayout(blocks []StorageLayoutBlock) []string {
	sectionNames := make([]string, 0, len(blocks))
	seen := make(map[string]struct{}, len(blocks))

	addSection := func(sectionName string) {
		normalized := normalizeStorageSection(sectionName)
		if _, exists := seen[normalized]; exists {
			return
		}
		seen[normalized] = struct{}{}
		sectionNames = append(sectionNames, normalized)
	}

	for _, block := range blocks {
		switch block.Type {
		case StorageLayoutBlockTypeTemporary:
			addSection(DefaultStorageSection)
		case StorageLayoutBlockTypeSection:
			if strings.TrimSpace(block.Name) != "" {
				addSection(block.Name)
			}
		}
	}

	if len(sectionNames) == 0 {
		return []string{DefaultStorageSection}
	}

	if _, exists := seen[DefaultStorageSection]; !exists {
		sectionNames = append([]string{DefaultStorageSection}, sectionNames...)
	}

	return sectionNames
}

func hasTemporaryLayoutBlock(blocks []StorageLayoutBlock) bool {
	for _, block := range blocks {
		if block.Type == StorageLayoutBlockTypeTemporary {
			return true
		}
	}
	return false
}

func buildDefaultLayoutBlocks(sectionNames []string) []StorageLayoutBlock {
	sections := ensureStorageSections(sectionNames)
	blocks := make([]StorageLayoutBlock, 0, len(sections))

	for index, sectionName := range sections {
		block := StorageLayoutBlock{
			ID:     fmt.Sprintf("layout-%d", index+1),
			X:      index * 5,
			Y:      0,
			Width:  4,
			Height: 3,
		}
		if sectionName == DefaultStorageSection {
			block.Type = StorageLayoutBlockTypeTemporary
			block.Name = "Temporary Area"
		} else {
			block.Type = StorageLayoutBlockTypeSection
			block.Name = normalizeStorageSection(sectionName)
		}
		blocks = append(blocks, block)
	}

	if len(blocks) == 0 {
		return []StorageLayoutBlock{{
			ID:     "temp-area",
			Name:   "Temporary Area",
			Type:   StorageLayoutBlockTypeTemporary,
			X:      0,
			Y:      0,
			Width:  5,
			Height: 4,
		}}
	}

	return blocks
}
