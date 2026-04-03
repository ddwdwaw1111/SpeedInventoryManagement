package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func (s *Store) ListSKUMasters(ctx context.Context, search string) ([]SKUMaster, error) {
	query := `
		SELECT
			id,
			COALESCE(item_number, '') AS item_number,
			sku,
			name,
			category,
			COALESCE(description, '') AS description,
			unit,
			reorder_level,
			default_units_per_pallet,
			created_at,
			updated_at
		FROM sku_master
		WHERE 1 = 1
	`

	args := make([]any, 0)
	if trimmedSearch := strings.TrimSpace(search); trimmedSearch != "" {
		likeValue := "%" + trimmedSearch + "%"
		query += " AND (item_number LIKE ? OR sku LIKE ? OR name LIKE ? OR description LIKE ? OR category LIKE ?)"
		args = append(args, likeValue, likeValue, likeValue, likeValue, likeValue)
	}

	query += " ORDER BY updated_at DESC, sku ASC"

	masters := make([]SKUMaster, 0)
	if err := s.db.SelectContext(ctx, &masters, query, args...); err != nil {
		return nil, fmt.Errorf("load sku masters: %w", err)
	}

	return masters, nil
}

func (s *Store) CreateSKUMaster(ctx context.Context, input CreateSKUMasterInput) (SKUMaster, error) {
	input = sanitizeSKUMasterInput(input)
	if err := validateSKUMasterInput(input); err != nil {
		return SKUMaster{}, err
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO sku_master (
			item_number,
			sku,
			name,
			category,
			description,
			unit,
			reorder_level,
			default_units_per_pallet
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		nullableString(input.ItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.ReorderLevel,
		input.DefaultUnitsPerPallet,
	)
	if err != nil {
		return SKUMaster{}, mapDBError(fmt.Errorf("create sku master: %w", err))
	}

	skuMasterID, err := result.LastInsertId()
	if err != nil {
		return SKUMaster{}, fmt.Errorf("resolve sku master id: %w", err)
	}

	return s.getSKUMaster(ctx, skuMasterID)
}

func (s *Store) UpdateSKUMaster(ctx context.Context, skuMasterID int64, input CreateSKUMasterInput) (SKUMaster, error) {
	input = sanitizeSKUMasterInput(input)
	if err := validateSKUMasterInput(input); err != nil {
		return SKUMaster{}, err
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE sku_master
		SET
			item_number = ?,
			sku = ?,
			name = ?,
			category = ?,
			description = ?,
			unit = ?,
			reorder_level = ?,
			default_units_per_pallet = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableString(input.ItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		input.Unit,
		input.ReorderLevel,
		input.DefaultUnitsPerPallet,
		skuMasterID,
	)
	if err != nil {
		return SKUMaster{}, mapDBError(fmt.Errorf("update sku master: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return SKUMaster{}, fmt.Errorf("resolve updated sku master rows: %w", err)
	}
	if rowsAffected == 0 {
		return SKUMaster{}, ErrNotFound
	}

	return s.getSKUMaster(ctx, skuMasterID)
}

func (s *Store) DeleteSKUMaster(ctx context.Context, skuMasterID int64) error {
	var linkedInventoryCount int
	if err := s.db.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM inventory_items WHERE sku_master_id = ?)
			+
			(SELECT COUNT(*) FROM pallet_items WHERE sku_master_id = ?)
	`, skuMasterID, skuMasterID).Scan(&linkedInventoryCount); err != nil {
		return fmt.Errorf("count linked projection rows for sku master delete: %w", err)
	}
	if linkedInventoryCount > 0 {
		return fmt.Errorf("%w: sku master is linked to pallet or bucket rows", ErrInvalidInput)
	}

	result, err := s.db.ExecContext(ctx, `DELETE FROM sku_master WHERE id = ?`, skuMasterID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete sku master: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted sku master rows: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	return nil
}

func (s *Store) getSKUMaster(ctx context.Context, skuMasterID int64) (SKUMaster, error) {
	var skuMaster SKUMaster
	if err := s.db.GetContext(ctx, &skuMaster, `
		SELECT
			id,
			COALESCE(item_number, '') AS item_number,
			sku,
			name,
			category,
			COALESCE(description, '') AS description,
			unit,
			reorder_level,
			default_units_per_pallet,
			created_at,
			updated_at
		FROM sku_master
		WHERE id = ?
	`, skuMasterID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SKUMaster{}, ErrNotFound
		}
		return SKUMaster{}, fmt.Errorf("load sku master: %w", err)
	}

	return skuMaster, nil
}

func sanitizeSKUMasterInput(input CreateSKUMasterInput) CreateSKUMasterInput {
	input.ItemNumber = strings.TrimSpace(strings.ToUpper(input.ItemNumber))
	input.SKU = strings.TrimSpace(strings.ToUpper(input.SKU))
	input.Name = strings.TrimSpace(input.Name)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	input.Unit = strings.TrimSpace(strings.ToLower(input.Unit))

	if input.Name == "" {
		input.Name = input.Description
	}
	if input.Category == "" {
		input.Category = "General"
	}
	if input.Unit == "" {
		input.Unit = "pcs"
	}

	return input
}

func validateSKUMasterInput(input CreateSKUMasterInput) error {
	switch {
	case input.SKU == "":
		return fmt.Errorf("%w: sku is required", ErrInvalidInput)
	case input.Description == "":
		return fmt.Errorf("%w: description is required", ErrInvalidInput)
	case input.ReorderLevel < 0:
		return fmt.Errorf("%w: reorder level cannot be negative", ErrInvalidInput)
	case input.DefaultUnitsPerPallet < 0:
		return fmt.Errorf("%w: default units per pallet cannot be negative", ErrInvalidInput)
	default:
		return nil
	}
}
