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
			COALESCE(ama_item_number, '') AS ama_item_number,
			sku,
			name,
			category,
			COALESCE(description, '') AS description,
			COALESCE(upc, '') AS upc,
			unit,
			default_units_per_pallet,
			COALESCE(case_size_mm, '') AS case_size_mm,
			cases_per_pallet,
			cartons_per_layer,
			layers_per_pallet,
			pallet_length_mm,
			pallet_width_mm,
			pallet_height_mm,
			COALESCE(picture_url, '') AS picture_url,
			COALESCE(full_face_photo_url, '') AS full_face_photo_url,
			COALESCE(side_photo_url, '') AS side_photo_url,
			created_at,
			updated_at
		FROM sku_master
		WHERE 1 = 1
	`

	args := make([]any, 0)
	if trimmedSearch := strings.TrimSpace(search); trimmedSearch != "" {
		likeValue := "%" + trimmedSearch + "%"
		query += " AND (item_number LIKE ? OR ama_item_number LIKE ? OR sku LIKE ? OR name LIKE ? OR description LIKE ? OR category LIKE ? OR upc LIKE ?)"
		args = append(args, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue)
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
			ama_item_number,
			sku,
			name,
			category,
			description,
			upc,
			unit,
			default_units_per_pallet,
			case_size_mm,
			cases_per_pallet,
			cartons_per_layer,
			layers_per_pallet,
			pallet_length_mm,
			pallet_width_mm,
			pallet_height_mm,
			picture_url,
			full_face_photo_url,
			side_photo_url
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		nullableString(input.ItemNumber),
		nullableString(input.AMAItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		nullableString(input.UPC),
		input.Unit,
		input.DefaultUnitsPerPallet,
		nullableString(input.CaseSizeMM),
		input.CasesPerPallet,
		input.CartonsPerLayer,
		input.LayersPerPallet,
		input.PalletLengthMM,
		input.PalletWidthMM,
		input.PalletHeightMM,
		nullableString(input.PictureURL),
		nullableString(input.FullFacePhotoURL),
		nullableString(input.SidePhotoURL),
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
			ama_item_number = ?,
			sku = ?,
			name = ?,
			category = ?,
			description = ?,
			upc = ?,
			unit = ?,
			default_units_per_pallet = ?,
			case_size_mm = ?,
			cases_per_pallet = ?,
			cartons_per_layer = ?,
			layers_per_pallet = ?,
			pallet_length_mm = ?,
			pallet_width_mm = ?,
			pallet_height_mm = ?,
			picture_url = ?,
			full_face_photo_url = ?,
			side_photo_url = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		nullableString(input.ItemNumber),
		nullableString(input.AMAItemNumber),
		input.SKU,
		input.Name,
		input.Category,
		input.Description,
		nullableString(input.UPC),
		input.Unit,
		input.DefaultUnitsPerPallet,
		nullableString(input.CaseSizeMM),
		input.CasesPerPallet,
		input.CartonsPerLayer,
		input.LayersPerPallet,
		input.PalletLengthMM,
		input.PalletWidthMM,
		input.PalletHeightMM,
		nullableString(input.PictureURL),
		nullableString(input.FullFacePhotoURL),
		nullableString(input.SidePhotoURL),
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
		SELECT COUNT(*) FROM inventory_items WHERE sku_master_id = ?
	`, skuMasterID).Scan(&linkedInventoryCount); err != nil {
		return fmt.Errorf("count linked projection rows for sku master delete: %w", err)
	}
	if linkedInventoryCount > 0 {
		return fmt.Errorf("%w: sku master is linked to inventory rows", ErrInvalidInput)
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
			COALESCE(ama_item_number, '') AS ama_item_number,
			sku,
			name,
			category,
			COALESCE(description, '') AS description,
			COALESCE(upc, '') AS upc,
			unit,
			default_units_per_pallet,
			COALESCE(case_size_mm, '') AS case_size_mm,
			cases_per_pallet,
			cartons_per_layer,
			layers_per_pallet,
			pallet_length_mm,
			pallet_width_mm,
			pallet_height_mm,
			COALESCE(picture_url, '') AS picture_url,
			COALESCE(full_face_photo_url, '') AS full_face_photo_url,
			COALESCE(side_photo_url, '') AS side_photo_url,
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
	input.AMAItemNumber = strings.TrimSpace(strings.ToUpper(input.AMAItemNumber))
	input.SKU = strings.TrimSpace(strings.ToUpper(input.SKU))
	input.Name = strings.TrimSpace(input.Name)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	input.UPC = strings.TrimSpace(input.UPC)
	input.Unit = strings.TrimSpace(strings.ToLower(input.Unit))
	input.CaseSizeMM = strings.TrimSpace(input.CaseSizeMM)
	input.PictureURL = strings.TrimSpace(input.PictureURL)
	input.FullFacePhotoURL = strings.TrimSpace(input.FullFacePhotoURL)
	input.SidePhotoURL = strings.TrimSpace(input.SidePhotoURL)

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
	case input.DefaultUnitsPerPallet < 0:
		return fmt.Errorf("%w: default units per pallet cannot be negative", ErrInvalidInput)
	case input.CasesPerPallet < 0 || input.CartonsPerLayer < 0 || input.LayersPerPallet < 0:
		return fmt.Errorf("%w: outbound pallet spec values cannot be negative", ErrInvalidInput)
	case input.PalletLengthMM < 0 || input.PalletWidthMM < 0 || input.PalletHeightMM < 0:
		return fmt.Errorf("%w: outbound pallet dimensions cannot be negative", ErrInvalidInput)
	default:
		return nil
	}
}
