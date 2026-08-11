package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

func nullableIntPointer(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func outboundTrackingRequiresActiveReservation(status string) bool {
	switch normalizeOutboundTrackingStatus(status, DocumentStatusDraft) {
	case OutboundTrackingPicking, OutboundTrackingPacked:
		return true
	default:
		return false
	}
}

func resolveConfirmedOutboundTrackingStatus(existingTrackingStatus string, finalTrackingStatus ...string) string {
	trackingStatus := existingTrackingStatus
	if len(finalTrackingStatus) > 0 && strings.TrimSpace(finalTrackingStatus[0]) != "" {
		trackingStatus = finalTrackingStatus[0]
	}
	if normalizeOutboundTrackingStatus(trackingStatus, DocumentStatusConfirmed) == OutboundTrackingBOReceived {
		return OutboundTrackingBOReceived
	}
	return OutboundTrackingShipped
}

func outboundLineInputFromRow(customerID int64, lineRow outboundDocumentLineRow) CreateOutboundDocumentLineInput {
	return CreateOutboundDocumentLineInput{
		CustomerID:        customerID,
		LocationID:        lineRow.LocationID,
		SKUMasterID:       lineRow.SKUMasterID,
		Quantity:          lineRow.Quantity,
		PlannedQuantity:   lineRow.PlannedQuantity,
		ActualQuantity:    lineRow.Quantity,
		Pallets:           lineRow.Pallets,
		PalletsDetailCtns: lineRow.PalletsDetailCtns,
		UnitLabel:         lineRow.UnitLabel,
		CartonSizeMM:      lineRow.CartonSizeMM,
		NetWeightKgs:      lineRow.NetWeightKgs,
		GrossWeightKgs:    lineRow.GrossWeightKgs,
		LineNote:          lineRow.LineNote,
		PickAllocations:   normalizeOutboundPickAllocations(lineRow.PickAllocations),
	}
}

func (s *Store) persistOutboundDocumentLineReservationTx(
	ctx context.Context,
	tx *sql.Tx,
	lineID int64,
	line CreateOutboundDocumentLineInput,
) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE outbound_document_lines
		SET
			pallets = ?
		WHERE id = ?
	`,
		line.Pallets,
		lineID,
	); err != nil {
		return mapDBError(fmt.Errorf("persist outbound reservation snapshot: %w", err))
	}
	return nil
}

func (s *Store) persistOutboundPlannedAllocationsTx(ctx context.Context, tx *sql.Tx, outboundLineID, customerID, skuMasterID int64, allocations []OutboundPickAllocation) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_container_allocations WHERE outbound_line_id = ?`, outboundLineID); err != nil {
		return mapDBError(fmt.Errorf("replace planned outbound allocations: %w", err))
	}
	for _, allocation := range normalizeOutboundPickAllocations(allocations) {
		containerNo := normalizeContainerNo(allocation.ContainerNo)
		if containerNo == "" || allocation.AllocatedQty <= 0 {
			continue
		}
		sectionID, err := resolveStorageSectionIDTx(ctx, tx, allocation.LocationID, allocation.StorageSection)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO containers (customer_id, location_id, container_no, container_type, handling_mode, status, tracking_status, last_event_at)
			VALUES (?, ?, ?, 'NORMAL', 'PALLETIZED', 'IN_STOCK', 'RECEIVED', CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
		`, customerID, allocation.LocationID, containerNo)
		if err != nil {
			return mapDBError(fmt.Errorf("ensure planned allocation container: %w", err))
		}
		containerID, err := result.LastInsertId()
		if err != nil {
			return fmt.Errorf("resolve planned allocation container: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_container_allocations (
				outbound_line_id, container_id, customer_id, sku_master_id, location_id, section_id,
				storage_section, allocated_qty, inventory_pallets_used,
				starting_pallets, remaining_pallets, source_location_id, source_transfer_id,
				source_storage_section, source_starting_pallets, source_remaining_pallets,
				auto_transfer_to_main, status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED')
		`, outboundLineID, containerID, customerID, skuMasterID, allocation.LocationID, sectionID,
			fallbackSection(allocation.StorageSection), allocation.AllocatedQty,
			allocation.InventoryPalletsUsed, nullableIntPointer(allocation.StartingPallets), nullableIntPointer(allocation.RemainingPallets),
			nullableInt64(allocation.SourceLocationID), nullableInt64(allocation.SourceTransferID), nullableString(allocation.SourceStorageSection),
			nullableIntPointer(allocation.SourceStartingPallets), nullableIntPointer(allocation.SourceRemainingPallets), allocation.AutoTransferToMain,
		); err != nil {
			return mapDBError(fmt.Errorf("store planned outbound allocation: %w", err))
		}
	}
	return nil
}

func (s *Store) reserveOutboundLineTx(
	ctx context.Context,
	tx *sql.Tx,
	source lockedOutboundSource,
	line *CreateOutboundDocumentLineInput,
) error {
	if line == nil {
		return fmt.Errorf("%w: outbound line is required", ErrInvalidInput)
	}
	reservationQuantity := outboundLineReservationQuantity(*line)
	if reservationQuantity == 0 {
		line.PickAllocations = nil
		return nil
	}

	plannedAllocations := normalizeOutboundPickAllocations(line.PickAllocations)
	if len(plannedAllocations) == 0 {
		allocations, err := s.resolveOutboundLineAllocationsTx(ctx, tx, source, reservationQuantity, newOutboundAllocationReservationState())
		if err != nil {
			return err
		}
		plannedAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
	}
	if totalOutboundPickAllocationQuantity(plannedAllocations) != reservationQuantity {
		return fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
	}
	line.PickAllocations = plannedAllocations
	return nil
}
func (s *Store) reserveOutboundDocumentLinesTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	lineRows []outboundDocumentLineRow,
) ([]outboundDocumentLineRow, error) {
	lockedSources := make(map[string]lockedOutboundSource)
	for index := range lineRows {
		lineRow := &lineRows[index]
		lineInput := outboundLineInputFromRow(customerID, *lineRow)
		if outboundLineReservationQuantity(lineInput) == 0 {
			lineInput.PickAllocations = nil
			if err := s.persistOutboundDocumentLineReservationTx(ctx, tx, lineRow.ID, lineInput); err != nil {
				return nil, err
			}
			if err := s.replaceOutboundContainerAllocationsTx(ctx, tx, lineRow.ID, customerID, lineRow.SKUMasterID, nil); err != nil {
				return nil, err
			}
			lineRow.PickAllocations = normalizeOutboundPickAllocations(lineInput.PickAllocations)
			continue
		}
		sourceKey := buildOutboundSourceKey(customerID, lineRow.LocationID, lineRow.SKUMasterID)
		lockedSource, exists := lockedSources[sourceKey]
		if !exists {
			var err error
			lockedSource, err = s.loadLockedOutboundSourceTx(ctx, tx, customerID, lineRow.LocationID, lineRow.SKUMasterID)
			if err != nil {
				return nil, err
			}
			lockedSources[sourceKey] = lockedSource
		}

		if err := s.reserveOutboundLineTx(ctx, tx, lockedSource, &lineInput); err != nil {
			return nil, err
		}
		if err := s.persistOutboundDocumentLineReservationTx(ctx, tx, lineRow.ID, lineInput); err != nil {
			return nil, err
		}
		if err := s.replaceOutboundContainerAllocationsTx(ctx, tx, lineRow.ID, customerID, lineRow.SKUMasterID, lineInput.PickAllocations); err != nil {
			return nil, err
		}

		lineRow.Pallets = lineInput.Pallets
		lineRow.PickAllocations = normalizeOutboundPickAllocations(lineInput.PickAllocations)
	}

	return lineRows, nil
}

func (s *Store) releaseOutboundDocumentReservationsTx(ctx context.Context, tx *sql.Tx, lineRows []outboundDocumentLineRow) error {
	for _, lineRow := range lineRows {
		if err := s.releaseOutboundContainerAllocationBalancesTx(ctx, tx, lineRow.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_container_allocations WHERE outbound_line_id = ?`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("delete released container allocations: %w", err))
		}
	}
	return nil
}

func (s *Store) cancelOutboundDocumentReservationsTx(ctx context.Context, tx *sql.Tx, lineRows []outboundDocumentLineRow) error {
	for _, lineRow := range lineRows {
		if err := s.releaseOutboundContainerAllocationBalancesTx(ctx, tx, lineRow.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_container_allocations
			SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
			WHERE outbound_line_id = ?
		`, lineRow.ID); err != nil {
			return mapDBError(fmt.Errorf("cancel released container allocations: %w", err))
		}
	}
	return nil
}

func (s *Store) replaceOutboundContainerAllocationsTx(
	ctx context.Context,
	tx *sql.Tx,
	outboundLineID int64,
	customerID int64,
	skuMasterID int64,
	allocations []OutboundPickAllocation,
) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_container_allocations WHERE outbound_line_id = ?`, outboundLineID); err != nil {
		return mapDBError(fmt.Errorf("replace outbound container allocations: %w", err))
	}
	for _, allocation := range normalizeOutboundPickAllocations(allocations) {
		containerNo := normalizeContainerNo(allocation.ContainerNo)
		if containerNo == "" || allocation.AllocatedQty <= 0 {
			return fmt.Errorf("%w: every outbound allocation requires a source container and quantity", ErrInvalidInput)
		}
		sectionID, err := resolveStorageSectionIDTx(ctx, tx, allocation.LocationID, allocation.StorageSection)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO containers (
				customer_id, location_id, container_no, container_type,
				handling_mode, status, tracking_status, last_event_at
			) VALUES (?, ?, ?, 'NORMAL', 'PALLETIZED', 'IN_STOCK', 'RECEIVED', CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
				id = LAST_INSERT_ID(id)
		`, customerID, allocation.LocationID, containerNo)
		if err != nil {
			return mapDBError(fmt.Errorf("ensure outbound allocation container: %w", err))
		}
		containerID, err := result.LastInsertId()
		if err != nil {
			return fmt.Errorf("resolve outbound allocation container: %w", err)
		}
		reserveResult, err := tx.ExecContext(ctx, `
			UPDATE inventory_items
			SET
				allocated_qty = allocated_qty + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE customer_id = ?
			  AND sku_master_id = ?
			  AND location_id = ?
			  AND storage_section = ?
			  AND container_no = ?
			  AND quantity - allocated_qty - damaged_qty - hold_qty >= ?
		`,
			allocation.AllocatedQty,
			customerID,
			skuMasterID,
			allocation.LocationID,
			fallbackSection(allocation.StorageSection),
			containerNo,
			allocation.AllocatedQty,
		)
		if err != nil {
			return mapDBError(fmt.Errorf("reserve outbound container inventory: %w", err))
		}
		reservedRows, err := reserveResult.RowsAffected()
		if err != nil {
			return fmt.Errorf("resolve outbound container reservation: %w", err)
		}
		if reservedRows != 1 {
			return ErrInsufficientStock
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_container_allocations (
				outbound_line_id,
				container_id,
				customer_id,
				sku_master_id,
				location_id,
				section_id,
				storage_section,
				allocated_qty,
				inventory_pallets_used,
				starting_pallets,
				remaining_pallets,
				source_location_id,
				source_transfer_id,
				source_storage_section,
				source_starting_pallets,
				source_remaining_pallets,
				auto_transfer_to_main,
				status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED')
		`,
			outboundLineID,
			containerID,
			customerID,
			skuMasterID,
			allocation.LocationID,
			sectionID,
			fallbackSection(allocation.StorageSection),
			allocation.AllocatedQty,
			allocation.InventoryPalletsUsed,
			nullableIntPointer(allocation.StartingPallets),
			nullableIntPointer(allocation.RemainingPallets),
			nullableInt64(allocation.SourceLocationID),
			nullableInt64(allocation.SourceTransferID),
			nullableString(allocation.SourceStorageSection),
			nullableIntPointer(allocation.SourceStartingPallets),
			nullableIntPointer(allocation.SourceRemainingPallets),
			allocation.AutoTransferToMain,
		); err != nil {
			return mapDBError(fmt.Errorf("insert outbound container allocation: %w", err))
		}
	}
	return nil
}

func (s *Store) releaseOutboundContainerAllocationBalancesTx(ctx context.Context, tx *sql.Tx, outboundLineID int64) error {
	allocations, err := s.loadOutboundContainerAllocationsForUpdateTx(ctx, tx, outboundLineID)
	if err != nil {
		return err
	}
	for _, allocation := range allocations {
		if allocation.Status != "RESERVED" {
			continue
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE inventory_items i
			JOIN containers c ON c.id = ?
			SET
				i.allocated_qty = GREATEST(i.allocated_qty - ?, 0),
				i.updated_at = CURRENT_TIMESTAMP
			WHERE i.customer_id = ?
			  AND i.sku_master_id = ?
			  AND i.location_id = ?
			  AND i.storage_section = ?
			  AND i.container_no = c.container_no
		`, allocation.ContainerID, allocation.AllocatedQty, allocation.CustomerID, allocation.SKUMasterID, allocation.LocationID, allocation.StorageSection)
		if err != nil {
			return mapDBError(fmt.Errorf("release outbound container inventory: %w", err))
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("resolve released outbound container inventory: %w", err)
		}
		if rows != 1 {
			return fmt.Errorf("%w: reserved container inventory no longer exists", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Store) loadOutboundContainerAllocationsForUpdateTx(ctx context.Context, tx *sql.Tx, outboundLineID int64) ([]outboundContainerAllocationRow, error) {
	rows := make([]outboundContainerAllocationRow, 0)
	result, err := tx.QueryContext(ctx, `
		SELECT
			oca.id,
			oca.outbound_line_id,
			oca.container_id,
			c.container_no,
			oca.customer_id,
			oca.sku_master_id,
			oca.location_id,
			oca.storage_section,
			oca.allocated_qty,
			oca.inventory_pallets_used,
			oca.status
		FROM outbound_container_allocations oca
		JOIN containers c ON c.id = oca.container_id
		WHERE oca.outbound_line_id = ?
		ORDER BY oca.id
		FOR UPDATE
	`, outboundLineID)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("load outbound container allocations: %w", err))
	}
	defer result.Close()
	for result.Next() {
		var row outboundContainerAllocationRow
		if err := result.Scan(
			&row.ID,
			&row.OutboundLineID,
			&row.ContainerID,
			&row.ContainerNo,
			&row.CustomerID,
			&row.SKUMasterID,
			&row.LocationID,
			&row.StorageSection,
			&row.AllocatedQty,
			&row.InventoryPalletsUsed,
			&row.Status,
		); err != nil {
			return nil, fmt.Errorf("scan outbound container allocation: %w", err)
		}
		rows = append(rows, row)
	}
	if err := result.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound container allocations: %w", err)
	}
	return rows, nil
}

func (s *Store) loadAvailableOutboundPalletBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	skuMasterID int64,
	locationID int64,
	storageSection string,
	containerNo string,
) (int, error) {
	var onHandPallets int
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(pallets), 0)
		FROM inventory_items
		WHERE customer_id = ?
		  AND sku_master_id = ?
		  AND location_id = ?
		  AND storage_section = ?
		  AND container_no = ?
	`, customerID, skuMasterID, locationID, fallbackSection(storageSection), normalizeContainerNo(containerNo)).Scan(&onHandPallets); err != nil {
		return 0, fmt.Errorf("load outbound container pallet balance: %w", err)
	}

	return maxInt(onHandPallets, 0), nil
}

func (s *Store) CopyOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("begin outbound copy transaction: %w", err)
	}
	defer tx.Rollback()

	documentRow, err := s.loadOutboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if normalizeDocumentStatus(documentRow.Status) == DocumentStatusDeleted {
		return OutboundDocument{}, fmt.Errorf("%w: deleted shipment cannot be copied", ErrInvalidInput)
	}

	lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, documentID)
	if err != nil {
		return OutboundDocument{}, err
	}
	if len(lineRows) == 0 {
		return OutboundDocument{}, fmt.Errorf("%w: shipment must contain at least one line", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO outbound_documents (
			picking_order_no,
			order_ref,
			customer_id,
			expected_ship_date,
			actual_ship_date,
			ship_to_name,
			ship_to_address,
			ship_to_contact,
			carrier_name,
			document_note,
			status,
			tracking_status,
			confirmed_at,
			posted_at,
			cancel_note,
			cancelled_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
	`,
		nullableString(documentRow.PickingOrderNo),
		nullableString(documentRow.OrderRef),
		documentRow.CustomerID,
		nullableTime(documentRow.ExpectedShipDate),
		nullableTime(documentRow.ActualShipDate),
		nullableString(documentRow.ShipToName),
		nullableString(documentRow.ShipToAddress),
		nullableString(documentRow.ShipToContact),
		nullableString(documentRow.CarrierName),
		nullableString(documentRow.DocumentNote),
		DocumentStatusDraft,
		OutboundTrackingScheduled,
	)
	if err != nil {
		return OutboundDocument{}, mapDBError(fmt.Errorf("copy outbound document: %w", err))
	}

	newDocumentID, err := result.LastInsertId()
	if err != nil {
		return OutboundDocument{}, fmt.Errorf("resolve copied outbound document id: %w", err)
	}

	for index, lineRow := range lineRows {
		lineResult, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_document_lines (
				document_id,
				sku_master_id,
				location_id,
				location_name_snapshot,
				storage_section,
				item_number_snapshot,
				sku_snapshot,
				description_snapshot,
				quantity,
				planned_quantity,
				pallets,
				pallets_detail_ctns,
				unit_label,
				carton_size_mm,
				net_weight_kgs,
				gross_weight_kgs,
				line_note,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			newDocumentID,
			lineRow.SKUMasterID,
			lineRow.LocationID,
			lineRow.LocationName,
			fallbackSection(lineRow.StorageSection),
			nullableString(lineRow.ItemNumberSnapshot),
			lineRow.SKUSnapshot,
			nullableString(lineRow.DescriptionSnapshot),
			lineRow.Quantity,
			lineRow.PlannedQuantity,
			lineRow.Pallets,
			nullableString(lineRow.PalletsDetailCtns),
			nullableString(lineRow.UnitLabel),
			nullableString(lineRow.CartonSizeMM),
			lineRow.NetWeightKgs,
			lineRow.GrossWeightKgs,
			nullableString(lineRow.LineNote),
			index+1,
		)
		if err != nil {
			return OutboundDocument{}, mapDBError(fmt.Errorf("copy outbound document line: %w", err))
		}

		if _, err := lineResult.LastInsertId(); err != nil {
			return OutboundDocument{}, fmt.Errorf("resolve copied outbound line id: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return OutboundDocument{}, fmt.Errorf("commit outbound copy: %w", err)
	}

	return s.getOutboundDocument(ctx, newDocumentID)
}

func loadOutboundDocumentCustomerIDTx(ctx context.Context, tx *sql.Tx, documentID int64) (int64, error) {
	var customerID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT customer_id
		FROM outbound_documents
		WHERE id = ?
	`, documentID).Scan(&customerID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("load outbound document customer: %w", err)
	}
	return customerID, nil
}

func (s *Store) loadOutboundDocumentForUpdateTx(ctx context.Context, tx *sql.Tx, documentID int64) (outboundDocumentRow, error) {
	var documentRow outboundDocumentRow
	if err := tx.QueryRowContext(ctx, `
		SELECT
			d.id,
			COALESCE(d.picking_order_no, '') AS picking_order_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.expected_ship_date,
			d.actual_ship_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			d.cancelled_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE d.id = ?
		FOR UPDATE
	`, documentID).Scan(
		&documentRow.ID,
		&documentRow.PickingOrderNo,
		&documentRow.OrderRef,
		&documentRow.CustomerID,
		&documentRow.CustomerName,
		&documentRow.ExpectedShipDate,
		&documentRow.ActualShipDate,
		&documentRow.ShipToName,
		&documentRow.ShipToAddress,
		&documentRow.ShipToContact,
		&documentRow.CarrierName,
		&documentRow.DocumentNote,
		&documentRow.Status,
		&documentRow.TrackingStatus,
		&documentRow.ConfirmedAt,
		&documentRow.DeletedAt,
		&documentRow.CreatedAt,
		&documentRow.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return outboundDocumentRow{}, ErrNotFound
		}
		return outboundDocumentRow{}, fmt.Errorf("load outbound document for update: %w", err)
	}

	return documentRow, nil
}

func (s *Store) loadOutboundDocumentLinesTx(ctx context.Context, tx *sql.Tx, documentID int64) ([]outboundDocumentLineRow, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			document_id,
			sku_master_id,
			COALESCE(item_number_snapshot, '') AS item_number_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			CASE WHEN planned_quantity > 0 THEN planned_quantity ELSE quantity END AS planned_quantity,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM outbound_document_lines
		WHERE document_id = ?
		ORDER BY sort_order ASC, id ASC
	`, documentID)
	if err != nil {
		return nil, fmt.Errorf("load outbound document lines: %w", err)
	}
	defer rows.Close()

	lineRows := make([]outboundDocumentLineRow, 0)
	for rows.Next() {
		var lineRow outboundDocumentLineRow
		if err := rows.Scan(
			&lineRow.ID,
			&lineRow.DocumentID,
			&lineRow.SKUMasterID,
			&lineRow.ItemNumberSnapshot,
			&lineRow.LocationID,
			&lineRow.LocationName,
			&lineRow.StorageSection,
			&lineRow.SKUSnapshot,
			&lineRow.DescriptionSnapshot,
			&lineRow.Quantity,
			&lineRow.PlannedQuantity,
			&lineRow.Pallets,
			&lineRow.PalletsDetailCtns,
			&lineRow.UnitLabel,
			&lineRow.CartonSizeMM,
			&lineRow.NetWeightKgs,
			&lineRow.GrossWeightKgs,
			&lineRow.LineNote,
			&lineRow.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan outbound document line: %w", err)
		}
		lineRows = append(lineRows, lineRow)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate outbound document lines: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close outbound document lines: %w", err)
	}
	for index := range lineRows {
		allocations, err := loadStoredOutboundPickAllocations(ctx, tx, lineRows[index].ID)
		if err != nil {
			return nil, err
		}
		lineRows[index].PickAllocations = normalizeOutboundPickAllocations(allocations)
	}

	return lineRows, nil
}

func (s *Store) getOutboundDocument(ctx context.Context, documentID int64) (OutboundDocument, error) {
	documents, err := s.listOutboundDocumentsByIDs(ctx, []int64{documentID})
	if err != nil {
		return OutboundDocument{}, err
	}
	if len(documents) == 0 {
		return OutboundDocument{}, ErrNotFound
	}
	return documents[0], nil
}

func (s *Store) listOutboundDocumentsByIDs(ctx context.Context, documentIDs []int64) ([]OutboundDocument, error) {
	if len(documentIDs) == 0 {
		return []OutboundDocument{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			d.id,
			COALESCE(d.picking_order_no, '') AS picking_order_no,
			COALESCE(d.order_ref, '') AS order_ref,
			d.customer_id,
			c.name AS customer_name,
			d.expected_ship_date,
			d.actual_ship_date,
			COALESCE(d.ship_to_name, '') AS ship_to_name,
			COALESCE(d.ship_to_address, '') AS ship_to_address,
			COALESCE(d.ship_to_contact, '') AS ship_to_contact,
			COALESCE(d.carrier_name, '') AS carrier_name,
			COALESCE(d.document_note, '') AS document_note,
			d.status,
			COALESCE(d.tracking_status, '') AS tracking_status,
			d.confirmed_at,
			d.cancelled_at,
			d.created_at,
			d.updated_at
		FROM outbound_documents d
		JOIN customers c ON c.id = d.customer_id
		WHERE d.id IN (?)
		ORDER BY COALESCE(d.actual_ship_date, d.expected_ship_date, d.created_at) DESC, d.id DESC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound document query: %w", err)
	}

	documentRows := make([]outboundDocumentRow, 0)
	if err := s.db.SelectContext(ctx, &documentRows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load outbound documents by id: %w", err)
	}
	if len(documentRows) == 0 {
		return []OutboundDocument{}, nil
	}

	documents := make([]OutboundDocument, 0, len(documentRows))
	documentsByID := make(map[int64]*OutboundDocument, len(documentRows))
	linesByID := make(map[int64]*OutboundDocumentLine)
	for _, row := range documentRows {
		document := OutboundDocument{
			ID:               row.ID,
			PickingOrderNo:   row.PickingOrderNo,
			OrderRef:         row.OrderRef,
			CustomerID:       row.CustomerID,
			CustomerName:     row.CustomerName,
			ExpectedShipDate: row.ExpectedShipDate,
			ActualShipDate:   row.ActualShipDate,
			ShipToName:       row.ShipToName,
			ShipToAddress:    row.ShipToAddress,
			ShipToContact:    row.ShipToContact,
			CarrierName:      row.CarrierName,
			DocumentNote:     row.DocumentNote,
			Status:           normalizeDocumentStatus(row.Status),
			TrackingStatus:   normalizeOutboundTrackingStatus(row.TrackingStatus, row.Status),
			ConfirmedAt:      row.ConfirmedAt,
			DeletedAt:        row.DeletedAt,
			Lines:            make([]OutboundDocumentLine, 0),
			Attachments:      make([]DocumentAttachment, 0),
			CreatedAt:        row.CreatedAt,
			UpdatedAt:        row.UpdatedAt,
		}
		documents = append(documents, document)
		documentsByID[row.ID] = &documents[len(documents)-1]
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			document_id,
			sku_master_id,
			COALESCE(item_number_snapshot, '') AS item_number_snapshot,
			location_id,
			location_name_snapshot,
			storage_section,
			sku_snapshot,
			COALESCE(description_snapshot, '') AS description_snapshot,
			quantity,
			CASE WHEN planned_quantity > 0 THEN planned_quantity ELSE quantity END AS planned_quantity,
			pallets,
			COALESCE(pallets_detail_ctns, '') AS pallets_detail_ctns,
			COALESCE(unit_label, '') AS unit_label,
			COALESCE(carton_size_mm, '') AS carton_size_mm,
			net_weight_kgs,
			gross_weight_kgs,
			COALESCE(line_note, '') AS line_note,
			created_at
		FROM outbound_document_lines
		WHERE document_id IN (?)
		ORDER BY document_id DESC, sort_order ASC, id ASC
	`, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound document line query by id: %w", err)
	}

	lineRows := make([]outboundDocumentLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load outbound document lines by id: %w", err)
	}

	for _, lineRow := range lineRows {
		document := documentsByID[lineRow.DocumentID]
		if document == nil {
			continue
		}
		storedPickAllocations := outboundStoredPickAllocations(lineRow.ID, lineRow.PickAllocations)
		document.Lines = append(document.Lines, OutboundDocumentLine{
			ID:                lineRow.ID,
			DocumentID:        lineRow.DocumentID,
			SKUMasterID:       lineRow.SKUMasterID,
			ItemNumber:        lineRow.ItemNumberSnapshot,
			LocationID:        lineRow.LocationID,
			LocationName:      lineRow.LocationName,
			StorageSection:    lineRow.StorageSection,
			SKU:               lineRow.SKUSnapshot,
			Description:       lineRow.DescriptionSnapshot,
			Quantity:          lineRow.Quantity,
			PlannedQuantity:   lineRow.PlannedQuantity,
			ActualQuantity:    lineRow.Quantity,
			Pallets:           lineRow.Pallets,
			PalletsDetailCtns: lineRow.PalletsDetailCtns,
			UnitLabel:         lineRow.UnitLabel,
			CartonSizeMM:      lineRow.CartonSizeMM,
			NetWeightKgs:      lineRow.NetWeightKgs,
			GrossWeightKgs:    lineRow.GrossWeightKgs,
			LineNote:          lineRow.LineNote,
			HasPickSnapshot:   len(storedPickAllocations) > 0,
			PickAllocations:   storedPickAllocations,
			CreatedAt:         lineRow.CreatedAt,
		})
		document.TotalLines += 1
		document.TotalQty += lineRow.Quantity
		document.TotalPlannedQty += lineRow.PlannedQuantity
		document.TotalActualQty += lineRow.Quantity
		document.TotalNetWeightKgs += lineRow.NetWeightKgs
		document.TotalGrossWeightKgs += lineRow.GrossWeightKgs
		document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", lineRow.LocationName, fallbackSection(lineRow.StorageSection)))
	}
	for documentIndex := range documents {
		for lineIndex := range documents[documentIndex].Lines {
			line := &documents[documentIndex].Lines[lineIndex]
			linesByID[line.ID] = line
		}
	}

	if err := s.attachOutboundPickAllocations(ctx, linesByID); err != nil {
		return nil, err
	}
	recalculateOutboundDocumentStorages(documents)

	if err := s.attachDocumentAttachments(ctx, DocumentAttachmentOutbound, documentIDs, func(documentID int64, attachments []DocumentAttachment) {
		if document := documentsByID[documentID]; document != nil {
			document.Attachments = attachments
		}
	}); err != nil {
		return nil, err
	}

	return documents, nil
}

func newOutboundAllocationReservationState() *outboundAllocationReservationState {
	return &outboundAllocationReservationState{
		ByBucketKey:        make(map[string]int),
		PalletsByBucketKey: make(map[string]int),
	}
}

func buildOutboundSourceKey(customerID int64, locationID int64, skuMasterID int64) string {
	return fmt.Sprintf("%d|%d|%d", customerID, locationID, skuMasterID)
}

func outboundAllocationBucketKey(customerID int64, locationID int64, skuMasterID int64, storageSection string, containerNo string) string {
	return fmt.Sprintf(
		"%d|%d|%d|%s|%s",
		customerID,
		locationID,
		skuMasterID,
		fallbackSection(storageSection),
		strings.TrimSpace(containerNo),
	)
}

func (s *Store) loadLockedOutboundSourceTx(ctx context.Context, tx *sql.Tx, customerID int64, locationID int64, skuMasterID int64) (lockedOutboundSource, error) {
	var source lockedOutboundSource
	if err := tx.QueryRowContext(ctx, `
		SELECT
			i.sku_master_id,
			i.customer_id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			i.location_id,
			l.name,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			COALESCE(SUM(i.quantity), 0) AS quantity,
			GREATEST(
				SUM(i.quantity) - SUM(i.allocated_qty) - SUM(i.damaged_qty) - SUM(i.hold_qty),
				0
			) AS available_qty,
			COALESCE(SUM(i.allocated_qty), 0) AS allocated_qty,
			COALESCE(SUM(i.damaged_qty), 0) AS damaged_qty,
			COALESCE(SUM(i.hold_qty), 0) AS hold_qty
		FROM inventory_items i
		JOIN sku_master sm ON sm.id = i.sku_master_id
		JOIN storage_locations l ON l.id = i.location_id
		WHERE i.sku_master_id = ?
		  AND i.customer_id = ?
		  AND i.location_id = ?
		  AND i.quantity > 0
		GROUP BY
			i.sku_master_id,
			i.customer_id,
			sm.item_number,
			i.location_id,
			l.name,
			sm.sku,
			sm.description,
			sm.name,
			sm.unit
	`,
		skuMasterID,
		customerID,
		locationID,
	).Scan(
		&source.SKUMasterID,
		&source.CustomerID,
		&source.ItemNumber,
		&source.LocationID,
		&source.LocationName,
		&source.SKU,
		&source.Description,
		&source.Unit,
		&source.Quantity,
		&source.AvailableQty,
		&source.AllocatedQty,
		&source.DamagedQty,
		&source.HoldQty,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return lockedOutboundSource{}, ErrInsufficientStock
		}
		return lockedOutboundSource{}, fmt.Errorf("load locked outbound source: %w", err)
	}

	return source, nil
}

func (s *Store) loadOutboundSourceReferenceTx(ctx context.Context, tx *sql.Tx, customerID int64, locationID int64, skuMasterID int64) (lockedOutboundSource, error) {
	var source lockedOutboundSource
	if err := tx.QueryRowContext(ctx, `
		SELECT
			sm.id,
			c.id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			l.id,
			l.name,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit
		FROM sku_master sm
		JOIN customers c ON c.id = ?
		JOIN storage_locations l ON l.id = ?
		WHERE sm.id = ?
	`, customerID, locationID, skuMasterID).Scan(
		&source.SKUMasterID,
		&source.CustomerID,
		&source.ItemNumber,
		&source.LocationID,
		&source.LocationName,
		&source.SKU,
		&source.Description,
		&source.Unit,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return lockedOutboundSource{}, ErrNotFound
		}
		return lockedOutboundSource{}, fmt.Errorf("load outbound source reference: %w", err)
	}
	return source, nil
}

func (s *Store) loadLockedOutboundAllocationCandidatesTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource) ([]outboundAllocationCandidate, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			i.sku_master_id,
			i.customer_id,
			COALESCE(NULLIF(sm.item_number, ''), '') AS item_number,
			i.location_id,
			l.name,
			COALESCE(NULLIF(i.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(i.container_no, '') AS container_no,
			sm.sku,
			COALESCE(sm.description, sm.name, '') AS description,
			COALESCE(sm.unit, 'pcs') AS unit,
			GREATEST(
				i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty,
				0
			) AS available_qty,
			GREATEST(i.pallets, 0) AS available_pallets,
			i.quantity AS on_hand_qty,
			i.pallets AS on_hand_pallets,
			i.delivery_date,
			i.created_at AS sort_at
		FROM inventory_items i
		JOIN sku_master sm ON sm.id = i.sku_master_id
		JOIN storage_locations l ON l.id = i.location_id
		WHERE
			i.customer_id = ?
			AND i.location_id = ?
			AND i.sku_master_id = ?
			AND GREATEST(i.quantity - i.allocated_qty - i.damaged_qty - i.hold_qty, 0) > 0
		ORDER BY
			CASE WHEN i.delivery_date IS NULL THEN 1 ELSE 0 END,
			i.delivery_date ASC,
			i.created_at ASC,
			storage_section ASC,
			container_no ASC
		FOR UPDATE
	`,
		source.CustomerID,
		source.LocationID,
		source.SKUMasterID,
	)
	if err != nil {
		return nil, fmt.Errorf("load locked outbound source rows: %w", err)
	}
	defer rows.Close()

	lockedRows := make([]lockedOutboundSourceRow, 0)

	for rows.Next() {
		var (
			row          lockedOutboundSourceRow
			deliveryDate sql.NullTime
		)
		if err := rows.Scan(
			&row.SKUMasterID,
			&row.CustomerID,
			&row.ItemNumber,
			&row.LocationID,
			&row.LocationName,
			&row.StorageSection,
			&row.ContainerNo,
			&row.SKU,
			&row.Description,
			&row.Unit,
			&row.AvailableQty,
			&row.AvailablePallets,
			&row.OnHandQty,
			&row.OnHandPallets,
			&deliveryDate,
			&row.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan locked outbound source row: %w", err)
		}
		if deliveryDate.Valid {
			deliveryTime := deliveryDate.Time
			row.DeliveryDate = &deliveryTime
		}
		row.BucketKey = outboundAllocationBucketKey(
			row.CustomerID,
			row.LocationID,
			row.SKUMasterID,
			row.StorageSection,
			row.ContainerNo,
		)

		lockedRows = append(lockedRows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate locked outbound source rows: %w", err)
	}
	if len(lockedRows) == 0 {
		return nil, ErrInsufficientStock
	}

	candidates := make([]outboundAllocationCandidate, 0, len(lockedRows))
	for _, lockedRow := range lockedRows {
		sortTime := lockedRow.CreatedAt
		if lockedRow.DeliveryDate != nil {
			sortTime = *lockedRow.DeliveryDate
		}
		candidates = append(candidates, outboundAllocationCandidate{
			BucketKey:        lockedRow.BucketKey,
			SKUMasterID:      lockedRow.SKUMasterID,
			CustomerID:       lockedRow.CustomerID,
			ItemNumber:       lockedRow.ItemNumber,
			LocationID:       lockedRow.LocationID,
			LocationName:     lockedRow.LocationName,
			StorageSection:   fallbackSection(lockedRow.StorageSection),
			ContainerNo:      lockedRow.ContainerNo,
			SKU:              lockedRow.SKU,
			Description:      lockedRow.Description,
			Unit:             lockedRow.Unit,
			AvailableQty:     lockedRow.AvailableQty,
			AvailablePallets: lockedRow.AvailablePallets,
			OnHandQty:        lockedRow.OnHandQty,
			OnHandPallets:    lockedRow.OnHandPallets,
			SortAt:           sortTime,
		})
	}

	sort.SliceStable(candidates, func(leftIndex, rightIndex int) bool {
		left := candidates[leftIndex]
		right := candidates[rightIndex]
		if !left.SortAt.Equal(right.SortAt) {
			return left.SortAt.Before(right.SortAt)
		}
		if left.LocationName != right.LocationName {
			return left.LocationName < right.LocationName
		}
		if fallbackSection(left.StorageSection) != fallbackSection(right.StorageSection) {
			return fallbackSection(left.StorageSection) < fallbackSection(right.StorageSection)
		}
		if left.ContainerNo != right.ContainerNo {
			return left.ContainerNo < right.ContainerNo
		}
		return left.BucketKey < right.BucketKey
	})

	return candidates, nil
}

func (s *Store) prepareOutboundDraftLineAllocationsTx(
	ctx context.Context,
	tx *sql.Tx,
	source lockedOutboundSource,
	line *CreateOutboundDocumentLineInput,
	reservationState *outboundAllocationReservationState,
) ([]outboundAllocationCandidate, error) {
	if line == nil {
		return nil, fmt.Errorf("%w: outbound line is required", ErrInvalidInput)
	}
	requestedQty := outboundLineReservationQuantity(*line)
	if requestedQty == 0 {
		line.PickAllocations = nil
		return nil, nil
	}

	if len(line.PickAllocations) > 0 {
		allocations, err := s.resolveOutboundDraftBucketAllocationsTx(ctx, tx, source, requestedQty, line.PickAllocations, reservationState)
		if err != nil {
			return nil, err
		}
		line.PickAllocations = toOutboundPickAllocationsFromCandidates(line, allocations)
		return allocations, nil
	}

	return s.resolveOutboundLineAllocationsTx(ctx, tx, source, requestedQty, reservationState)
}

func (s *Store) resolveOutboundDraftBucketAllocationsTx(
	ctx context.Context,
	tx *sql.Tx,
	source lockedOutboundSource,
	requestedQty int,
	draftAllocations []OutboundPickAllocation,
	reservationState *outboundAllocationReservationState,
) ([]outboundAllocationCandidate, error) {
	if requestedQty <= 0 {
		return nil, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
	}
	if reservationState.ByBucketKey == nil {
		reservationState.ByBucketKey = make(map[string]int)
	}
	if reservationState.PalletsByBucketKey == nil {
		reservationState.PalletsByBucketKey = make(map[string]int)
	}

	normalizedDraftAllocations := normalizeOutboundPickAllocations(draftAllocations)
	if totalOutboundPickAllocationQuantity(normalizedDraftAllocations) != requestedQty {
		return nil, fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
	}

	candidates, err := s.loadLockedOutboundAllocationCandidatesTx(ctx, tx, source)
	if err != nil {
		return nil, err
	}

	candidateByBucketKey := make(map[string]outboundAllocationCandidate, len(candidates))
	for _, candidate := range candidates {
		candidateByBucketKey[candidate.BucketKey] = candidate
	}

	allocations := make([]outboundAllocationCandidate, 0, len(normalizedDraftAllocations))
	appliedReservations := make([]struct {
		BucketKey            string
		AllocatedQty         int
		InventoryPalletsUsed int
	}, 0, len(normalizedDraftAllocations))

	for _, draftAllocation := range normalizedDraftAllocations {
		locationID := firstNonZeroInt64(draftAllocation.LocationID, source.LocationID)
		storageSection := fallbackSection(draftAllocation.StorageSection)
		containerNo := strings.TrimSpace(draftAllocation.ContainerNo)
		bucketKey := outboundAllocationBucketKey(source.CustomerID, locationID, source.SKUMasterID, storageSection, containerNo)
		candidate, exists := candidateByBucketKey[bucketKey]
		if !exists {
			for _, applied := range appliedReservations {
				reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
				reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.InventoryPalletsUsed
			}
			return nil, ErrInsufficientStock
		}

		effectiveAvailable := candidate.AvailableQty - reservationState.ByBucketKey[bucketKey]
		effectiveAvailablePallets := candidate.AvailablePallets - reservationState.PalletsByBucketKey[bucketKey]
		isStagedWarehouseTransfer := draftAllocation.SourceLocationID > 0 &&
			draftAllocation.SourceLocationID != locationID &&
			draftAllocation.StartingPallets == nil &&
			draftAllocation.RemainingPallets == nil
		startingPallets := maxInt(candidate.OnHandPallets-reservationState.PalletsByBucketKey[bucketKey], 0)
		physicalPalletRelease := maxInt(draftAllocation.InventoryPalletsUsed, 0)
		remainingPallets := maxInt(startingPallets-physicalPalletRelease, 0)
		if draftAllocation.AllocatedQty > effectiveAvailable || physicalPalletRelease > effectiveAvailablePallets {
			for _, applied := range appliedReservations {
				reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
				reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.InventoryPalletsUsed
			}
			return nil, ErrInsufficientStock
		}

		candidate.AllocatedQty = draftAllocation.AllocatedQty
		candidate.LocationID = locationID
		candidate.LocationName = firstNonEmpty(strings.TrimSpace(draftAllocation.LocationName), candidate.LocationName, source.LocationName)
		candidate.StorageSection = storageSection
		candidate.ContainerNo = containerNo
		candidate.ItemNumber = firstNonEmpty(strings.TrimSpace(draftAllocation.ItemNumber), candidate.ItemNumber, source.ItemNumber)
		candidate.Pallets = 0
		candidate.InventoryPalletsUsed = draftAllocation.InventoryPalletsUsed
		if isStagedWarehouseTransfer {
			candidate.StartingPallets = nil
			candidate.RemainingPallets = nil
		} else {
			candidate.StartingPallets = cloneIntPointer(&startingPallets)
			candidate.RemainingPallets = cloneIntPointer(&remainingPallets)
			if err := validateOutboundFinalPalletAllocation(OutboundPickAllocation{
				ContainerNo:          candidate.ContainerNo,
				AllocatedQty:         candidate.AllocatedQty,
				Pallets:              0,
				InventoryPalletsUsed: candidate.InventoryPalletsUsed,
				StartingPallets:      candidate.StartingPallets,
				RemainingPallets:     candidate.RemainingPallets,
			}); err != nil {
				for _, applied := range appliedReservations {
					reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
					reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.InventoryPalletsUsed
				}
				return nil, err
			}
		}
		candidate.SourceLocationID = draftAllocation.SourceLocationID
		candidate.SourceTransferID = draftAllocation.SourceTransferID
		candidate.SourceLocationName = draftAllocation.SourceLocationName
		candidate.SourceStorageSection = draftAllocation.SourceStorageSection
		candidate.SourceStartingPallets = cloneIntPointer(draftAllocation.SourceStartingPallets)
		candidate.SourceRemainingPallets = cloneIntPointer(draftAllocation.SourceRemainingPallets)
		candidate.AutoTransferToMain = draftAllocation.AutoTransferToMain

		allocations = append(allocations, candidate)
		reservationState.ByBucketKey[bucketKey] += draftAllocation.AllocatedQty
		reservationState.PalletsByBucketKey[bucketKey] += physicalPalletRelease
		appliedReservations = append(appliedReservations, struct {
			BucketKey            string
			AllocatedQty         int
			InventoryPalletsUsed int
		}{
			BucketKey:            bucketKey,
			AllocatedQty:         draftAllocation.AllocatedQty,
			InventoryPalletsUsed: physicalPalletRelease,
		})
	}

	return allocations, nil
}

func (s *Store) allocateOutboundLineTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	if requestedQty <= 0 {
		return nil, fmt.Errorf("%w: outbound quantity must be greater than zero", ErrInvalidInput)
	}
	if reservationState == nil {
		reservationState = newOutboundAllocationReservationState()
	}
	if reservationState.ByBucketKey == nil {
		reservationState.ByBucketKey = make(map[string]int)
	}
	if reservationState.PalletsByBucketKey == nil {
		reservationState.PalletsByBucketKey = make(map[string]int)
	}
	if requestedQty > source.AvailableQty {
		return nil, classifyReservedStockConflict(requestedQty, source.Quantity, source.AllocatedQty, source.DamagedQty, source.HoldQty)
	}

	candidates, err := s.loadLockedOutboundAllocationCandidatesTx(ctx, tx, source)
	if err != nil {
		return nil, err
	}

	allocations := make([]outboundAllocationCandidate, 0)
	remainingQty := requestedQty
	appliedReservations := make([]struct {
		BucketKey            string
		AllocatedQty         int
		InventoryPalletsUsed int
	}, 0)

	for _, candidate := range candidates {
		effectiveAvailable := candidate.AvailableQty - reservationState.ByBucketKey[candidate.BucketKey]
		if effectiveAvailable <= 0 {
			continue
		}

		allocatedQty := effectiveAvailable
		if allocatedQty > remainingQty {
			allocatedQty = remainingQty
		}
		if allocatedQty <= 0 {
			continue
		}

		startingPallets := maxInt(candidate.OnHandPallets-reservationState.PalletsByBucketKey[candidate.BucketKey], 0)
		candidate.AllocatedQty = allocatedQty
		candidate.InventoryPalletsUsed = automaticInventoryPalletsForAllocation(effectiveAvailable, startingPallets, allocatedQty)
		candidate.Pallets = 0
		remainingPallets := maxInt(startingPallets-candidate.InventoryPalletsUsed, 0)
		candidate.StartingPallets = cloneIntPointer(&startingPallets)
		candidate.RemainingPallets = cloneIntPointer(&remainingPallets)
		allocations = append(allocations, candidate)
		reservationState.ByBucketKey[candidate.BucketKey] += allocatedQty
		reservationState.PalletsByBucketKey[candidate.BucketKey] += candidate.InventoryPalletsUsed
		appliedReservations = append(appliedReservations, struct {
			BucketKey            string
			AllocatedQty         int
			InventoryPalletsUsed int
		}{
			BucketKey:            candidate.BucketKey,
			AllocatedQty:         allocatedQty,
			InventoryPalletsUsed: candidate.InventoryPalletsUsed,
		})
		remainingQty -= allocatedQty

		if remainingQty == 0 {
			break
		}
	}
	if remainingQty > 0 {
		for _, applied := range appliedReservations {
			reservationState.ByBucketKey[applied.BucketKey] -= applied.AllocatedQty
			reservationState.PalletsByBucketKey[applied.BucketKey] -= applied.InventoryPalletsUsed
		}
		return nil, classifyReservedStockConflict(requestedQty, source.Quantity, source.AllocatedQty, source.DamagedQty, source.HoldQty)
	}

	return allocations, nil
}

func automaticInventoryPalletsForAllocation(availableQty int, availablePallets int, allocatedQty int) int {
	if availableQty <= 0 || availablePallets <= 0 || allocatedQty <= 0 {
		return 0
	}
	if allocatedQty >= availableQty {
		return availablePallets
	}

	allocatedPallets := int(math.Ceil(float64(availablePallets) * float64(allocatedQty) / float64(availableQty)))
	if allocatedPallets < 0 {
		return 0
	}
	// A partial carton pick cannot release the last physical inventory pallet:
	// the remaining cartons still occupy that pallet. Operators can explicitly
	// enter zero when a pick only touches part of an existing pallet.
	maxReleasedPallets := availablePallets - 1
	if allocatedPallets > maxReleasedPallets {
		return maxReleasedPallets
	}
	if allocatedPallets > availablePallets {
		return availablePallets
	}
	return allocatedPallets
}

func (s *Store) resolveOutboundLineAllocationsTx(ctx context.Context, tx *sql.Tx, source lockedOutboundSource, requestedQty int, reservationState *outboundAllocationReservationState) ([]outboundAllocationCandidate, error) {
	return s.allocateOutboundLineTx(ctx, tx, source, requestedQty, reservationState)
}

func (s *Store) attachOutboundPickAllocations(ctx context.Context, linesByID map[int64]*OutboundDocumentLine) error {
	for lineID, line := range linesByID {
		allocations, err := loadStoredOutboundPickAllocations(ctx, s.db, lineID)
		if err != nil {
			return err
		}
		line.PickAllocations = allocations
		line.HasPickSnapshot = len(allocations) > 0
	}
	return nil
}

type outboundAllocationQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func loadStoredOutboundPickAllocations(ctx context.Context, queryer outboundAllocationQueryer, lineID int64) ([]OutboundPickAllocation, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT
			oca.id,
			oca.outbound_line_id,
			COALESCE(sm.item_number, ''),
			oca.location_id,
			l.name,
			COALESCE(NULLIF(oca.storage_section, ''), 'TEMP'),
			c.container_no,
			oca.allocated_qty,
			oca.inventory_pallets_used,
			oca.starting_pallets,
			oca.remaining_pallets,
			oca.source_location_id,
			oca.source_transfer_id,
			COALESCE(source_location.name, ''),
			COALESCE(oca.source_storage_section, ''),
			oca.source_starting_pallets,
			oca.source_remaining_pallets,
			oca.auto_transfer_to_main,
			oca.created_at
		FROM outbound_container_allocations oca
		JOIN containers c ON c.id = oca.container_id
		JOIN storage_locations l ON l.id = oca.location_id
		JOIN sku_master sm ON sm.id = oca.sku_master_id
		LEFT JOIN storage_locations source_location ON source_location.id = oca.source_location_id
		WHERE oca.outbound_line_id = ?
		  AND oca.status <> 'CANCELLED'
		ORDER BY oca.id
	`, lineID)
	if err != nil {
		return nil, fmt.Errorf("load stored outbound allocations: %w", err)
	}
	defer rows.Close()
	allocations := make([]OutboundPickAllocation, 0)
	for rows.Next() {
		var allocation OutboundPickAllocation
		var starting, remaining, sourceLocationID, sourceTransferID, sourceStarting, sourceRemaining sql.NullInt64
		if err := rows.Scan(
			&allocation.ID, &allocation.LineID, &allocation.ItemNumber,
			&allocation.LocationID, &allocation.LocationName, &allocation.StorageSection, &allocation.ContainerNo,
			&allocation.AllocatedQty, &allocation.InventoryPalletsUsed,
			&starting, &remaining, &sourceLocationID, &sourceTransferID,
			&allocation.SourceLocationName, &allocation.SourceStorageSection,
			&sourceStarting, &sourceRemaining, &allocation.AutoTransferToMain, &allocation.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan stored outbound allocation: %w", err)
		}
		allocation.StartingPallets = nullIntPointer(starting)
		allocation.RemainingPallets = nullIntPointer(remaining)
		if sourceLocationID.Valid {
			allocation.SourceLocationID = sourceLocationID.Int64
		}
		if sourceTransferID.Valid {
			allocation.SourceTransferID = sourceTransferID.Int64
		}
		allocation.SourceStartingPallets = nullIntPointer(sourceStarting)
		allocation.SourceRemainingPallets = nullIntPointer(sourceRemaining)
		allocations = append(allocations, allocation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stored outbound allocations: %w", err)
	}
	return allocations, nil
}

func nullIntPointer(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	resolved := int(value.Int64)
	return &resolved
}

func (s *Store) updateOutboundAllocationSnapshotsTx(ctx context.Context, tx *sql.Tx, lineID int64, allocations []OutboundPickAllocation) error {
	for _, allocation := range allocations {
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_container_allocations oca
			JOIN containers c ON c.id = oca.container_id
			SET oca.inventory_pallets_used = ?, oca.starting_pallets = ?, oca.remaining_pallets = ?,
				oca.source_location_id = ?, oca.source_transfer_id = ?, oca.source_storage_section = ?,
				oca.source_starting_pallets = ?, oca.source_remaining_pallets = ?, oca.auto_transfer_to_main = ?
			WHERE oca.outbound_line_id = ? AND oca.location_id = ?
			  AND oca.storage_section = ? AND UPPER(TRIM(c.container_no)) = ?
		`, allocation.InventoryPalletsUsed, nullableIntPointer(allocation.StartingPallets), nullableIntPointer(allocation.RemainingPallets),
			nullableInt64(allocation.SourceLocationID), nullableInt64(allocation.SourceTransferID), nullableString(allocation.SourceStorageSection),
			nullableIntPointer(allocation.SourceStartingPallets), nullableIntPointer(allocation.SourceRemainingPallets), allocation.AutoTransferToMain,
			lineID, allocation.LocationID, fallbackSection(allocation.StorageSection), normalizeContainerNo(allocation.ContainerNo)); err != nil {
			return mapDBError(fmt.Errorf("update outbound allocation snapshot: %w", err))
		}
	}
	return nil
}
func (s *Store) listOutboundLedgerAllocationRowsByLineIDs(ctx context.Context, lineIDs []int64) ([]outboundPickAllocationRow, error) {
	if len(lineIDs) == 0 {
		return []outboundPickAllocationRow{}, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			MIN(sl.id) AS id,
			sl.source_line_id AS line_id,
			COALESCE(NULLIF(sl.item_number_snapshot, ''), NULLIF(l.item_number_snapshot, ''), '') AS item_number,
			sl.location_id AS location_id,
			COALESCE(loc.name, l.location_name_snapshot) AS location_name_snapshot,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(sl.container_no_snapshot, '') AS container_no_snapshot,
			SUM(ABS(sl.quantity_change)) AS allocated_qty,
			ROUND(SUM(ABS(sl.pallet_change))) AS pallets,
			MIN(COALESCE(sl.occurred_at, sl.created_at)) AS created_at
		FROM stock_ledger sl
		JOIN outbound_document_lines l ON l.id = sl.source_line_id
		LEFT JOIN storage_locations loc ON loc.id = sl.location_id
		WHERE sl.source_document_type = ?
		  AND sl.event_type = ?
		  AND sl.source_line_id IN (?)
		GROUP BY
			sl.source_line_id,
			COALESCE(NULLIF(sl.item_number_snapshot, ''), NULLIF(l.item_number_snapshot, ''), ''),
			sl.location_id,
			COALESCE(loc.name, l.location_name_snapshot),
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP'),
			COALESCE(sl.container_no_snapshot, '')
		ORDER BY line_id ASC, id ASC
	`, StockLedgerSourceOutbound, StockLedgerEventShip, lineIDs)
	if err != nil {
		return nil, fmt.Errorf("build outbound ledger allocation query: %w", err)
	}

	rows := make([]outboundPickAllocationRow, 0)
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load outbound ledger allocations by line id: %w", err)
	}
	for index := range rows {
		rows[index].StorageSection = fallbackSection(rows[index].StorageSection)
		rows[index].ContainerNo = strings.TrimSpace(rows[index].ContainerNo)
	}
	return rows, nil
}

func splitProportionalFloat(total float64, totalQty int, allocations []outboundAllocationCandidate) []float64 {
	values := make([]float64, len(allocations))
	if len(allocations) == 0 || totalQty <= 0 || total == 0 {
		return values
	}

	remainingTotal := total
	remainingQty := totalQty
	for index, allocation := range allocations {
		if index == len(allocations)-1 || remainingQty <= 0 {
			values[index] = roundToTwoDecimals(remainingTotal)
			continue
		}

		share := roundToTwoDecimals(total * float64(allocation.AllocatedQty) / float64(totalQty))
		if share > remainingTotal {
			share = remainingTotal
		}
		values[index] = share
		remainingTotal = roundToTwoDecimals(remainingTotal - share)
		remainingQty -= allocation.AllocatedQty
	}

	return values
}

func roundToTwoDecimals(value float64) float64 {
	return math.Round(value*100) / 100
}

func recalculateOutboundDocumentStorages(documents []OutboundDocument) {
	for documentIndex := range documents {
		document := &documents[documentIndex]
		document.Storages = ""
		for _, line := range document.Lines {
			if len(line.PickAllocations) > 0 {
				for _, allocation := range line.PickAllocations {
					document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", allocation.LocationName, fallbackSection(allocation.StorageSection)))
				}
				continue
			}
			document.Storages = appendUniqueJoined(document.Storages, fmt.Sprintf("%s / %s", line.LocationName, fallbackSection(line.StorageSection)))
		}
	}
}

func sanitizeOutboundDocumentInput(input CreateOutboundDocumentInput) CreateOutboundDocumentInput {
	input.PickingOrderNo = strings.TrimSpace(strings.ToUpper(input.PickingOrderNo))
	input.OrderRef = strings.TrimSpace(strings.ToUpper(input.OrderRef))
	input.ExpectedShipDate = strings.TrimSpace(input.ExpectedShipDate)
	input.ActualShipDate = strings.TrimSpace(input.ActualShipDate)
	input.ShipToName = strings.TrimSpace(input.ShipToName)
	input.ShipToAddress = strings.TrimSpace(input.ShipToAddress)
	input.ShipToContact = strings.TrimSpace(input.ShipToContact)
	input.CarrierName = strings.TrimSpace(input.CarrierName)
	input.Status = strings.TrimSpace(strings.ToUpper(input.Status))
	input.TrackingStatus = strings.TrimSpace(strings.ToUpper(input.TrackingStatus))
	input.DocumentNote = strings.TrimSpace(input.DocumentNote)
	lines := make([]CreateOutboundDocumentLineInput, 0, len(input.Lines))
	for _, line := range input.Lines {
		line = normalizeOutboundLineQuantities(line)
		line.UnitLabel = strings.TrimSpace(strings.ToUpper(line.UnitLabel))
		line.CartonSizeMM = strings.TrimSpace(line.CartonSizeMM)
		line.PalletsDetailCtns = strings.TrimSpace(line.PalletsDetailCtns)
		line.LineNote = strings.TrimSpace(line.LineNote)
		line.PickAllocations = normalizeOutboundPickAllocations(line.PickAllocations)
		if line.CustomerID <= 0 || line.LocationID <= 0 || line.SKUMasterID <= 0 || (line.PlannedQuantity <= 0 && line.ActualQuantity <= 0) {
			continue
		}
		lines = append(lines, line)
	}
	input.Lines = lines
	return input
}

func validateOutboundDocumentInput(input CreateOutboundDocumentInput) error {
	coalescedStatus := coalesceDocumentStatus(input.Status)
	if err := validateCreatableDocumentStatus(coalescedStatus); err != nil {
		return err
	}
	if normalizedTracking := normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus); normalizedTracking == "" {
		return fmt.Errorf("%w: invalid outbound tracking status", ErrInvalidInput)
	}
	if coalescedStatus == DocumentStatusConfirmed {
		normalizedTracking := normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus)
		if normalizedTracking != OutboundTrackingShipped && normalizedTracking != OutboundTrackingBOReceived {
			return fmt.Errorf("%w: confirmed shipments must use the shipped or BO received tracking status", ErrInvalidInput)
		}
	}
	if err := validateOutboundTrackingTransition(OutboundTrackingScheduled, normalizeOutboundTrackingStatus(input.TrackingStatus, coalescedStatus)); err != nil {
		return err
	}
	if len(input.Lines) == 0 {
		return fmt.Errorf("%w: at least one outbound line is required", ErrInvalidInput)
	}

	for _, line := range input.Lines {
		line = normalizeOutboundLineQuantities(line)
		reservationQuantity := outboundLineReservationQuantity(line)
		switch {
		case line.CustomerID <= 0:
			return fmt.Errorf("%w: customer is required", ErrInvalidInput)
		case line.LocationID <= 0:
			return fmt.Errorf("%w: warehouse is required", ErrInvalidInput)
		case line.SKUMasterID <= 0:
			return fmt.Errorf("%w: UPC is required", ErrInvalidInput)
		case line.PlannedQuantity < 0 || line.ActualQuantity < 0:
			return fmt.Errorf("%w: planned and actual outbound quantities cannot be negative", ErrInvalidInput)
		case line.PlannedQuantity == 0 && line.ActualQuantity == 0:
			return fmt.Errorf("%w: planned or actual outbound quantity must be greater than zero", ErrInvalidInput)
		case line.ActualQuantity == 0 && line.Pallets != 0:
			return fmt.Errorf("%w: pallets must be zero when actual outbound quantity is zero", ErrInvalidInput)
		case line.Pallets < 0:
			return fmt.Errorf("%w: pallets cannot be negative", ErrInvalidInput)
		case line.NetWeightKgs < 0 || line.GrossWeightKgs < 0:
			return fmt.Errorf("%w: weights cannot be negative", ErrInvalidInput)
		case len(line.PickAllocations) > 0 && totalOutboundPickAllocationQuantity(line.PickAllocations) != reservationQuantity:
			return fmt.Errorf("%w: draft pick allocation quantity must equal outbound quantity", ErrInvalidInput)
		}
		for _, allocation := range line.PickAllocations {
			if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
				return err
			}
		}
	}

	return nil
}

func validateOutboundFinalPalletAllocation(allocation OutboundPickAllocation) error {
	if allocation.StartingPallets == nil && allocation.RemainingPallets == nil {
		return nil
	}
	containerNo := firstNonEmpty(strings.TrimSpace(allocation.ContainerNo), "selected container")
	if allocation.StartingPallets == nil || allocation.RemainingPallets == nil {
		return fmt.Errorf("%w: source container %s requires both starting and remaining inventory pallets", ErrInvalidInput, containerNo)
	}
	startingPallets := *allocation.StartingPallets
	remainingPallets := *allocation.RemainingPallets
	if startingPallets < 0 || remainingPallets < 0 || remainingPallets > startingPallets {
		return fmt.Errorf("%w: source container %s remaining inventory pallets must be between 0 and the starting balance of %d", ErrInvalidInput, containerNo, maxInt(startingPallets, 0))
	}
	if allocation.InventoryPalletsUsed < 0 || allocation.InventoryPalletsUsed > startingPallets {
		return fmt.Errorf("%w: source container %s inventory pallets used must be between 0 and the starting balance of %d", ErrInvalidInput, containerNo, startingPallets)
	}
	return nil
}

type outboundFinalPalletSnapshot struct {
	Quantity int
	Pallets  int
}

func (s *Store) refreshOutboundFinalPalletSnapshotsTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	lineRows []outboundDocumentLineRow,
) ([]outboundDocumentLineRow, error) {
	snapshots := make(map[string]outboundFinalPalletSnapshot)
	for lineIndex := range lineRows {
		lineRow := &lineRows[lineIndex]
		allocations := normalizeOutboundPickAllocations(lineRow.PickAllocations)
		if len(allocations) == 0 {
			continue
		}

		for allocationIndex := range allocations {
			allocation := &allocations[allocationIndex]
			locationID := firstNonZeroInt64(allocation.LocationID, lineRow.LocationID)
			storageSection := fallbackSection(allocation.StorageSection)
			containerNo := normalizeContainerNo(allocation.ContainerNo)
			bucketKey := outboundAllocationBucketKey(customerID, locationID, lineRow.SKUMasterID, storageSection, containerNo)
			snapshot, exists := snapshots[bucketKey]
			if !exists {
				rows, err := tx.QueryContext(ctx, `
					SELECT quantity, pallets
					FROM inventory_items
					WHERE customer_id = ?
					  AND sku_master_id = ?
					  AND location_id = ?
					  AND storage_section = ?
					  AND container_no = ?
					FOR UPDATE
				`, customerID, lineRow.SKUMasterID, locationID, storageSection, containerNo)
				if err != nil {
					return nil, mapDBError(fmt.Errorf("lock outbound pallet snapshot: %w", err))
				}
				matchedRows := 0
				for rows.Next() {
					var quantity int
					var pallets int
					if err := rows.Scan(&quantity, &pallets); err != nil {
						rows.Close()
						return nil, fmt.Errorf("scan outbound pallet snapshot: %w", err)
					}
					snapshot.Quantity += quantity
					snapshot.Pallets += pallets
					matchedRows++
				}
				if err := rows.Err(); err != nil {
					rows.Close()
					return nil, fmt.Errorf("iterate outbound pallet snapshot: %w", err)
				}
				if err := rows.Close(); err != nil {
					return nil, fmt.Errorf("close outbound pallet snapshot: %w", err)
				}
				if matchedRows == 0 {
					return nil, ErrInsufficientStock
				}
			}

			if allocation.AllocatedQty > snapshot.Quantity {
				return nil, ErrInsufficientStock
			}
			startingPallets := maxInt(snapshot.Pallets, 0)
			remainingQuantity := snapshot.Quantity - allocation.AllocatedQty
			releasedPallets := maxInt(allocation.InventoryPalletsUsed, 0)
			if releasedPallets > startingPallets {
				return nil, fmt.Errorf(
					"%w: source container %s inventory pallets used must be between 0 and the starting balance of %d",
					ErrInvalidInput,
					firstNonEmpty(containerNo, "selected container"),
					startingPallets,
				)
			}
			remainingPallets := startingPallets - releasedPallets
			allocation.LocationID = locationID
			allocation.StorageSection = storageSection
			allocation.ContainerNo = containerNo
			allocation.StartingPallets = cloneIntPointer(&startingPallets)
			allocation.RemainingPallets = cloneIntPointer(&remainingPallets)
			allocation.Pallets = 0
			snapshots[bucketKey] = outboundFinalPalletSnapshot{
				Quantity: remainingQuantity,
				Pallets:  remainingPallets,
			}
		}

		lineRow.PickAllocations = normalizeOutboundPickAllocations(allocations)
		if err := s.updateOutboundAllocationSnapshotsTx(ctx, tx, lineRow.ID, allocations); err != nil {
			return nil, err
		}
	}
	return lineRows, nil
}

func (s *Store) validateOutboundFinalPalletBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	skuMasterID int64,
	allocation OutboundPickAllocation,
) error {
	if allocation.StartingPallets == nil && allocation.RemainingPallets == nil {
		if allocation.SourceLocationID > 0 && allocation.SourceLocationID != allocation.LocationID && allocation.SourceStartingPallets != nil && allocation.SourceRemainingPallets != nil {
			return nil
		}
		return fmt.Errorf(
			"%w: source container %s has no derived pallet-balance snapshot; reopen or revalidate the shipment before confirmation",
			ErrInvalidInput,
			firstNonEmpty(normalizeContainerNo(allocation.ContainerNo), "selected container"),
		)
	}
	if err := validateOutboundFinalPalletAllocation(allocation); err != nil {
		return err
	}
	locationID := allocation.LocationID
	containerNo := normalizeContainerNo(allocation.ContainerNo)
	rows, err := tx.QueryContext(ctx, `
		SELECT quantity, pallets
		FROM inventory_items
		WHERE customer_id = ?
		  AND sku_master_id = ?
		  AND location_id = ?
		  AND storage_section = ?
		  AND container_no = ?
		FOR UPDATE
	`, customerID, skuMasterID, locationID, fallbackSection(allocation.StorageSection), containerNo)
	if err != nil {
		return mapDBError(fmt.Errorf("lock outbound final pallet balance: %w", err))
	}
	defer rows.Close()
	currentQuantity := 0
	currentPallets := 0
	matchedRows := 0
	for rows.Next() {
		var quantity int
		var pallets int
		if err := rows.Scan(&quantity, &pallets); err != nil {
			return fmt.Errorf("scan outbound final pallet balance: %w", err)
		}
		currentQuantity += quantity
		currentPallets += pallets
		matchedRows++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate outbound final pallet balance: %w", err)
	}
	if matchedRows == 0 {
		return ErrInsufficientStock
	}
	startingPallets := *allocation.StartingPallets
	remainingPallets := *allocation.RemainingPallets
	if allocation.InventoryPalletsUsed != startingPallets-remainingPallets {
		return fmt.Errorf("%w: source container %s inventory pallets used must equal starting pallets minus remaining pallets", ErrInvalidInput, containerNo)
	}
	if currentPallets != startingPallets {
		return fmt.Errorf("%w: source container %s pallet balance changed from %d to %d; reopen or revalidate the shipment before confirming", ErrInvalidInput, containerNo, startingPallets, currentPallets)
	}
	remainingQuantity := currentQuantity - allocation.AllocatedQty
	if remainingQuantity < 0 {
		return ErrInsufficientStock
	}
	if remainingQuantity == 0 && remainingPallets != 0 {
		return fmt.Errorf("%w: source container %s will have no quantity left, so remaining inventory pallets must be 0", ErrInvalidInput, containerNo)
	}
	if remainingQuantity > 0 && remainingPallets == 0 {
		return fmt.Errorf("%w: source container %s will still have %d CTN, so remaining inventory pallets must be at least 1", ErrInvalidInput, containerNo, remainingQuantity)
	}
	return nil
}

func outboundPickAllocationSnapshotKey(locationID int64, storageSection string, containerNo string) string {
	return fmt.Sprintf("%d|%s|%s", locationID, fallbackSection(storageSection), normalizeContainerNo(containerNo))
}

func outboundAllocationInventoryPalletsUsed(allocation OutboundPickAllocation) int {
	return maxInt(allocation.InventoryPalletsUsed, 0)
}

func normalizeOutboundLineQuantities(line CreateOutboundDocumentLineInput) CreateOutboundDocumentLineInput {
	if line.ActualQuantity == 0 && line.Quantity > 0 {
		line.ActualQuantity = line.Quantity
	}
	if line.Quantity == 0 && line.ActualQuantity > 0 {
		line.Quantity = line.ActualQuantity
	}
	if line.PlannedQuantity == 0 && line.ActualQuantity > 0 {
		line.PlannedQuantity = line.ActualQuantity
	}
	return line
}

func outboundLineReservationQuantity(line CreateOutboundDocumentLineInput) int {
	if line.ActualQuantity > 0 {
		return line.ActualQuantity
	}
	if line.Quantity > 0 {
		return line.Quantity
	}
	return 0
}

func resolveOutboundLedgerDate(expectedShipDate *time.Time, actualShipDate *time.Time) *time.Time {
	if actualShipDate != nil {
		return actualShipDate
	}
	return expectedShipDate
}

// earliestOutboundBillingMutationDateTx resolves the oldest billing source
// date that cancellation would invalidate for one outbound allocation. The
// header date drives the outbound fee, while the persisted SHIP date drives
// the container storage timeline. Historical rows can predate today's header
// values, so the locking read must be scoped to the exact line/allocation.
func earliestOutboundBillingMutationDateTx(
	ctx context.Context,
	tx *sql.Tx,
	documentRow outboundDocumentRow,
	lineID int64,
	locationID int64,
	containerNo string,
) (time.Time, error) {
	earliest := documentRow.CreatedAt
	if documentRow.ConfirmedAt != nil {
		earliest = *documentRow.ConfirmedAt
	}
	if documentRow.ActualShipDate != nil {
		earliest = *documentRow.ActualShipDate
	}
	if shipDate := resolveOutboundLedgerDate(documentRow.ExpectedShipDate, documentRow.ActualShipDate); shipDate != nil && shipDate.Before(earliest) {
		earliest = *shipDate
	}

	query := `
		SELECT COALESCE(out_date, occurred_at, created_at)
		FROM stock_ledger
		WHERE source_document_type = ?
		  AND source_document_id = ?
		  AND source_line_id = ?
		  AND event_type = ?`
	args := []any{StockLedgerSourceOutbound, documentRow.ID, lineID, StockLedgerEventShip}
	if locationID > 0 {
		query += " AND location_id = ?"
		args = append(args, locationID)
	}
	containerNo = normalizeContainerNo(containerNo)
	if containerNo != "" {
		query += " AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?"
		args = append(args, containerNo)
	}
	query += " ORDER BY COALESCE(out_date, occurred_at, created_at), id LIMIT 1 FOR UPDATE"

	var persistedShipAt time.Time
	err := tx.QueryRowContext(ctx, query, args...).Scan(&persistedShipAt)
	if err == nil {
		if persistedShipAt.Before(earliest) {
			earliest = persistedShipAt
		}
		return earliest, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, fmt.Errorf("load outbound SHIP billing date: %w", err)
	}
	return earliest, nil
}

func appendUniqueJoined(existing string, nextValue string) string {
	values := make([]string, 0)
	seen := make(map[string]struct{})
	for _, value := range strings.Split(existing, ",") {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		values = append(values, trimmed)
	}

	trimmedNext := strings.TrimSpace(nextValue)
	if trimmedNext != "" {
		if _, exists := seen[trimmedNext]; !exists {
			values = append(values, trimmedNext)
		}
	}

	return strings.Join(values, ", ")
}

func normalizeOutboundPickAllocations(entries []OutboundPickAllocation) []OutboundPickAllocation {
	if len(entries) == 0 {
		return []OutboundPickAllocation{}
	}

	type groupedAllocation struct {
		ID                     int64
		LineID                 int64
		ItemNumber             string
		LocationID             int64
		LocationName           string
		StorageSection         string
		ContainerNo            string
		AllocatedQty           int
		Pallets                int
		InventoryPalletsUsed   int
		StartingPallets        *int
		RemainingPallets       *int
		SourceLocationID       int64
		SourceTransferID       int64
		SourceLocationName     string
		SourceStorageSection   string
		SourceStartingPallets  *int
		SourceRemainingPallets *int
		AutoTransferToMain     bool
		CreatedAt              time.Time
	}

	order := make([]string, 0, len(entries))
	grouped := make(map[string]*groupedAllocation, len(entries))
	for _, entry := range entries {
		allocatedQty := entry.AllocatedQty
		if allocatedQty <= 0 {
			continue
		}

		locationID := entry.LocationID
		storageSection := fallbackSection(entry.StorageSection)
		containerNo := strings.TrimSpace(entry.ContainerNo)
		itemNumber := strings.TrimSpace(entry.ItemNumber)
		sourceStorageSection := strings.TrimSpace(entry.SourceStorageSection)
		key := fmt.Sprintf(
			"%d|%s|%s|%s|%t|%d|%d|%s",
			locationID,
			storageSection,
			containerNo,
			itemNumber,
			entry.AutoTransferToMain,
			entry.SourceLocationID,
			entry.SourceTransferID,
			sourceStorageSection,
		)
		pallets := maxInt(entry.Pallets, 0)
		if entry.StartingPallets != nil && entry.RemainingPallets != nil {
			pallets = maxInt(*entry.StartingPallets-*entry.RemainingPallets, 0)
		}
		inventoryPalletsUsed := maxInt(entry.InventoryPalletsUsed, 0)

		existing, exists := grouped[key]
		if !exists {
			order = append(order, key)
			grouped[key] = &groupedAllocation{
				ID:                     entry.ID,
				LineID:                 entry.LineID,
				ItemNumber:             itemNumber,
				LocationID:             locationID,
				LocationName:           strings.TrimSpace(entry.LocationName),
				StorageSection:         storageSection,
				ContainerNo:            containerNo,
				AllocatedQty:           allocatedQty,
				Pallets:                pallets,
				InventoryPalletsUsed:   inventoryPalletsUsed,
				StartingPallets:        cloneIntPointer(entry.StartingPallets),
				RemainingPallets:       cloneIntPointer(entry.RemainingPallets),
				SourceLocationID:       entry.SourceLocationID,
				SourceTransferID:       entry.SourceTransferID,
				SourceLocationName:     strings.TrimSpace(entry.SourceLocationName),
				SourceStorageSection:   sourceStorageSection,
				SourceStartingPallets:  cloneIntPointer(entry.SourceStartingPallets),
				SourceRemainingPallets: cloneIntPointer(entry.SourceRemainingPallets),
				AutoTransferToMain:     entry.AutoTransferToMain,
				CreatedAt:              entry.CreatedAt,
			}
			continue
		}

		existing.AllocatedQty += allocatedQty
		existing.Pallets += pallets
		existing.InventoryPalletsUsed += inventoryPalletsUsed
		if existing.StartingPallets == nil {
			existing.StartingPallets = cloneIntPointer(entry.StartingPallets)
		}
		if existing.RemainingPallets == nil {
			existing.RemainingPallets = cloneIntPointer(entry.RemainingPallets)
		}
		if existing.SourceLocationID == 0 {
			existing.SourceLocationID = entry.SourceLocationID
		}
		if existing.SourceTransferID == 0 {
			existing.SourceTransferID = entry.SourceTransferID
		}
		if existing.SourceLocationName == "" {
			existing.SourceLocationName = strings.TrimSpace(entry.SourceLocationName)
		}
		if existing.SourceStorageSection == "" {
			existing.SourceStorageSection = strings.TrimSpace(entry.SourceStorageSection)
		}
		if existing.SourceStartingPallets == nil {
			existing.SourceStartingPallets = cloneIntPointer(entry.SourceStartingPallets)
		}
		if existing.SourceRemainingPallets == nil {
			existing.SourceRemainingPallets = cloneIntPointer(entry.SourceRemainingPallets)
		}
		if existing.LocationName == "" {
			existing.LocationName = strings.TrimSpace(entry.LocationName)
		}
		if existing.CreatedAt.IsZero() && !entry.CreatedAt.IsZero() {
			existing.CreatedAt = entry.CreatedAt
		}
		if existing.ID == 0 {
			existing.ID = entry.ID
		}
		if existing.LineID == 0 {
			existing.LineID = entry.LineID
		}
	}

	normalized := make([]OutboundPickAllocation, 0, len(order))
	for _, key := range order {
		entry := grouped[key]
		if entry == nil || entry.AllocatedQty <= 0 {
			continue
		}
		normalized = append(normalized, OutboundPickAllocation{
			ID:                     entry.ID,
			LineID:                 entry.LineID,
			ItemNumber:             entry.ItemNumber,
			LocationID:             entry.LocationID,
			LocationName:           entry.LocationName,
			StorageSection:         entry.StorageSection,
			ContainerNo:            entry.ContainerNo,
			AllocatedQty:           entry.AllocatedQty,
			Pallets:                maxInt(entry.Pallets, 0),
			InventoryPalletsUsed:   maxInt(entry.InventoryPalletsUsed, 0),
			StartingPallets:        cloneIntPointer(entry.StartingPallets),
			RemainingPallets:       cloneIntPointer(entry.RemainingPallets),
			SourceLocationID:       entry.SourceLocationID,
			SourceTransferID:       entry.SourceTransferID,
			SourceLocationName:     entry.SourceLocationName,
			SourceStorageSection:   entry.SourceStorageSection,
			SourceStartingPallets:  cloneIntPointer(entry.SourceStartingPallets),
			SourceRemainingPallets: cloneIntPointer(entry.SourceRemainingPallets),
			AutoTransferToMain:     entry.AutoTransferToMain,
			CreatedAt:              entry.CreatedAt,
		})
	}
	return normalized
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func outboundStoredPickAllocations(lineID int64, allocations []OutboundPickAllocation) []OutboundPickAllocation {
	entries := normalizeOutboundPickAllocations(allocations)
	for index := range entries {
		entries[index].LineID = lineID
		if entries[index].ID <= 0 {
			entries[index].ID = -int64(index + 1)
		}
	}
	return entries
}

func totalOutboundPickAllocationQuantity(entries []OutboundPickAllocation) int {
	total := 0
	for _, entry := range entries {
		if entry.AllocatedQty > 0 {
			total += entry.AllocatedQty
		}
	}
	return total
}

func totalOutboundPickAllocationPallets(entries []OutboundPickAllocation) int {
	total := 0
	for _, entry := range entries {
		if entry.Pallets > 0 {
			total += entry.Pallets
		}
	}
	return total
}

func toOutboundAllocationCandidatesFromDraftPickAllocations(source lockedOutboundSource, entries []OutboundPickAllocation) []outboundAllocationCandidate {
	allocations := make([]outboundAllocationCandidate, 0, len(entries))
	for _, entry := range normalizeOutboundPickAllocations(entries) {
		allocations = append(allocations, outboundAllocationCandidate{
			BucketKey:              outboundAllocationBucketKey(source.CustomerID, firstNonZeroInt64(entry.LocationID, source.LocationID), source.SKUMasterID, entry.StorageSection, entry.ContainerNo),
			SKUMasterID:            source.SKUMasterID,
			CustomerID:             source.CustomerID,
			ItemNumber:             firstNonEmpty(strings.TrimSpace(entry.ItemNumber), source.ItemNumber),
			LocationID:             firstNonZeroInt64(entry.LocationID, source.LocationID),
			LocationName:           firstNonEmpty(strings.TrimSpace(entry.LocationName), source.LocationName),
			StorageSection:         fallbackSection(entry.StorageSection),
			ContainerNo:            strings.TrimSpace(entry.ContainerNo),
			SKU:                    source.SKU,
			Description:            source.Description,
			Unit:                   source.Unit,
			AllocatedQty:           entry.AllocatedQty,
			Pallets:                maxInt(entry.Pallets, 0),
			InventoryPalletsUsed:   maxInt(entry.InventoryPalletsUsed, 0),
			StartingPallets:        cloneIntPointer(entry.StartingPallets),
			RemainingPallets:       cloneIntPointer(entry.RemainingPallets),
			SourceLocationID:       entry.SourceLocationID,
			SourceTransferID:       entry.SourceTransferID,
			SourceLocationName:     entry.SourceLocationName,
			SourceStorageSection:   entry.SourceStorageSection,
			SourceStartingPallets:  cloneIntPointer(entry.SourceStartingPallets),
			SourceRemainingPallets: cloneIntPointer(entry.SourceRemainingPallets),
			AutoTransferToMain:     entry.AutoTransferToMain,
		})
	}
	return allocations
}

func toOutboundPickAllocationsFromCandidates(line *CreateOutboundDocumentLineInput, allocations []outboundAllocationCandidate) []OutboundPickAllocation {
	createdAt := time.Now().UTC()
	pickAllocations := make([]OutboundPickAllocation, 0, len(allocations))
	for _, allocation := range allocations {
		if allocation.AllocatedQty <= 0 {
			continue
		}
		pickAllocations = append(pickAllocations, OutboundPickAllocation{
			ItemNumber:             firstNonEmpty(strings.TrimSpace(allocation.ItemNumber)),
			LocationID:             allocation.LocationID,
			LocationName:           allocation.LocationName,
			StorageSection:         fallbackSection(allocation.StorageSection),
			ContainerNo:            strings.TrimSpace(allocation.ContainerNo),
			AllocatedQty:           allocation.AllocatedQty,
			Pallets:                maxInt(allocation.Pallets, 0),
			InventoryPalletsUsed:   maxInt(allocation.InventoryPalletsUsed, 0),
			StartingPallets:        cloneIntPointer(allocation.StartingPallets),
			RemainingPallets:       cloneIntPointer(allocation.RemainingPallets),
			SourceLocationID:       allocation.SourceLocationID,
			SourceTransferID:       allocation.SourceTransferID,
			SourceLocationName:     allocation.SourceLocationName,
			SourceStorageSection:   allocation.SourceStorageSection,
			SourceStartingPallets:  cloneIntPointer(allocation.SourceStartingPallets),
			SourceRemainingPallets: cloneIntPointer(allocation.SourceRemainingPallets),
			AutoTransferToMain:     allocation.AutoTransferToMain,
			CreatedAt:              createdAt,
		})
	}
	if line == nil {
		return normalizeOutboundPickAllocations(pickAllocations)
	}
	return normalizeOutboundPickAllocations(pickAllocations)
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func fallbackSection(value string) string {
	return normalizeStorageSection(value)
}

func safeOutboundDateInput(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.DateOnly)
}
