package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO storage_locations (name, address, zone, description, capacity, section_count, section_names_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		input.Name,
		nullableString(input.Address),
		input.Zone,
		nullableString(input.Description),
		input.Capacity,
		len(input.SectionNames),
		sectionNamesJSON,
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

	result, err := s.db.ExecContext(ctx, `
		UPDATE storage_locations
		SET
			name = ?,
			address = ?,
			zone = ?,
			description = ?,
			capacity = ?,
			section_count = ?,
			section_names_json = ?
		WHERE id = ?
	`,
		input.Name,
		nullableString(input.Address),
		input.Zone,
		nullableString(input.Description),
		input.Capacity,
		len(input.SectionNames),
		sectionNamesJSON,
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
	sectionNames := make([]string, 0, len(input.SectionNames))
	for _, sectionName := range input.SectionNames {
		trimmed := strings.TrimSpace(sectionName)
		if trimmed == "" {
			continue
		}
		sectionNames = append(sectionNames, trimmed)
	}
	if len(sectionNames) == 0 {
		sectionNames = []string{"A"}
	}
	input.SectionNames = sectionNames
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

func parseSectionNames(sectionNamesJSON string, sectionCount int) []string {
	trimmed := strings.TrimSpace(sectionNamesJSON)
	if trimmed != "" {
		var parsed []string
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			sanitized := make([]string, 0, len(parsed))
			for _, sectionName := range parsed {
				cleaned := strings.TrimSpace(sectionName)
				if cleaned == "" {
					continue
				}
				sanitized = append(sanitized, cleaned)
			}
			if len(sanitized) > 0 {
				return sanitized
			}
		}
	}

	if sectionCount <= 0 {
		sectionCount = 1
	}

	labels := make([]string, 0, sectionCount)
	for index := 0; index < sectionCount; index++ {
		labels = append(labels, legacySectionLabel(index))
	}
	return labels
}

func legacySectionLabel(index int) string {
	if index < 0 {
		return "A"
	}

	return string(rune('A' + (index % 26)))
}
