package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type ContainerLifecycleEvent struct {
	ID                 int64     `json:"id"`
	StockLedgerID      int64     `json:"stockLedgerId"`
	CustomerID         int64     `json:"customerId"`
	CustomerName       string    `json:"customerName"`
	LocationID         int64     `json:"locationId"`
	LocationName       string    `json:"locationName"`
	StorageSection     string    `json:"storageSection"`
	ContainerNo        string    `json:"containerNo"`
	EventType          string    `json:"eventType"`
	EventTime          time.Time `json:"eventTime"`
	QuantityDelta      int       `json:"quantityDelta"`
	PalletDelta        float64   `json:"palletDelta"`
	SKUMasterID        int64     `json:"skuMasterId"`
	SourceDocumentType string    `json:"sourceDocumentType"`
	SourceDocumentID   int64     `json:"sourceDocumentId"`
	SourceLineID       int64     `json:"sourceLineId"`
	PackingListNo      string    `json:"packingListNo"`
	OrderRef           string    `json:"orderRef"`
	ItemNumber         string    `json:"itemNumber"`
	Description        string    `json:"description"`
	ExpectedQty        int       `json:"expectedQty"`
	ReceivedQty        int       `json:"receivedQty"`
	Pallets            int       `json:"pallets"`
	DocumentNote       string    `json:"documentNote"`
	Reason             string    `json:"reason"`
	ReferenceCode      string    `json:"referenceCode"`
	CreatedAt          time.Time `json:"createdAt"`
}

type ContainerLifecycleEventFilters struct {
	CustomerID      int64
	ContainerNo     string
	OperationalOnly bool
}

func (s *Store) ListContainerLifecycleEvents(ctx context.Context, limit int, filters ...ContainerLifecycleEventFilters) ([]ContainerLifecycleEvent, error) {
	if limit <= 0 {
		limit = 1000
	}

	var filter ContainerLifecycleEventFilters
	if len(filters) > 0 {
		filter = filters[0]
	}

	whereClauses := []string{"1 = 1"}
	args := make([]any, 0)
	if filter.CustomerID > 0 {
		whereClauses = append(whereClauses, "cle.customer_id = ?")
		args = append(args, filter.CustomerID)
	}
	if containerNo := strings.TrimSpace(strings.ToUpper(filter.ContainerNo)); containerNo != "" {
		whereClauses = append(whereClauses, "UPPER(TRIM(cle.container_no)) = ?")
		args = append(args, containerNo)
	}
	if filter.OperationalOnly {
		whereClauses = append(whereClauses, `NOT EXISTS (
			SELECT 1
			FROM inbound_documents source_d
			WHERE UPPER(TRIM(cle.source_document_type)) = 'INBOUND'
			  AND source_d.id = cle.source_document_id
			  AND source_d.corrected_at IS NOT NULL
		)`)
	}

	query := fmt.Sprintf(`
		SELECT
			cle.id,
			COALESCE(cle.stock_ledger_id, 0) AS stock_ledger_id,
			cle.customer_id,
			c.name AS customer_name,
			cle.location_id,
			l.name AS location_name,
			COALESCE(NULLIF(cle.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(cle.container_no, '') AS container_no,
			cle.event_type,
			cle.event_time,
			cle.quantity_delta,
			cle.pallet_delta,
			COALESCE(cle.sku_master_id, 0) AS sku_master_id,
			COALESCE(cle.source_document_type, '') AS source_document_type,
			COALESCE(cle.source_document_id, 0) AS source_document_id,
			COALESCE(cle.source_line_id, 0) AS source_line_id,
			COALESCE(cle.packing_list_no, '') AS packing_list_no,
			COALESCE(cle.order_ref, '') AS order_ref,
			COALESCE(cle.item_number_snapshot, '') AS item_number,
			COALESCE(cle.description_snapshot, '') AS description,
			cle.expected_qty,
			cle.received_qty,
			cle.pallets,
			COALESCE(cle.document_note, '') AS document_note,
			COALESCE(cle.reason, '') AS reason,
			COALESCE(cle.reference_code, '') AS reference_code,
			cle.created_at
		FROM container_lifecycle_events cle
		JOIN customers c ON c.id = cle.customer_id
		JOIN storage_locations l ON l.id = cle.location_id
		WHERE %s
		ORDER BY cle.event_time DESC, cle.id DESC
		LIMIT ?
	`, strings.Join(whereClauses, "\n\t\tAND "))
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load container lifecycle events: %w", err)
	}
	defer rows.Close()

	events := make([]ContainerLifecycleEvent, 0)
	for rows.Next() {
		event, err := scanContainerLifecycleEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate container lifecycle events: %w", err)
	}
	return events, nil
}

func (s *Store) createContainerLifecycleEventTx(ctx context.Context, tx *sql.Tx, stockLedgerID int64, input createStockLedgerInput) error {
	containerNo := strings.TrimSpace(input.ContainerNo)
	if stockLedgerID <= 0 || containerNo == "" {
		return nil
	}

	_, err := tx.ExecContext(ctx, `
		INSERT INTO container_lifecycle_events (
			stock_ledger_id,
			customer_id,
			location_id,
			section_id,
			storage_section,
			container_no,
			event_type,
			event_time,
			quantity_delta,
			pallet_delta,
			sku_master_id,
			source_document_type,
			source_document_id,
			source_line_id,
			packing_list_no,
			order_ref,
			item_number_snapshot,
			description_snapshot,
			expected_qty,
			received_qty,
			pallets,
			document_note,
			reason,
			reference_code
		) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			customer_id = VALUES(customer_id),
			location_id = VALUES(location_id),
			section_id = VALUES(section_id),
			storage_section = VALUES(storage_section),
			container_no = VALUES(container_no),
			event_type = VALUES(event_type),
			event_time = VALUES(event_time),
			quantity_delta = VALUES(quantity_delta),
			pallet_delta = VALUES(pallet_delta),
			sku_master_id = VALUES(sku_master_id),
			source_document_type = VALUES(source_document_type),
			source_document_id = VALUES(source_document_id),
			source_line_id = VALUES(source_line_id),
			packing_list_no = VALUES(packing_list_no),
			order_ref = VALUES(order_ref),
			item_number_snapshot = VALUES(item_number_snapshot),
			description_snapshot = VALUES(description_snapshot),
			expected_qty = VALUES(expected_qty),
			received_qty = VALUES(received_qty),
			pallets = VALUES(pallets),
			document_note = VALUES(document_note),
			reason = VALUES(reason),
			reference_code = VALUES(reference_code)
	`,
		stockLedgerID,
		input.CustomerID,
		input.LocationID,
		nullableInt64(input.SectionID),
		fallbackSection(input.StorageSection),
		containerNo,
		firstNonEmpty(input.EventType, StockLedgerEventReceive),
		nullableTime(resolveContainerLifecycleEventTime(input)),
		input.QuantityChange,
		input.PalletChange,
		nullableInt64(input.SKUMasterID),
		nullableString(input.SourceDocumentType),
		nullableInt64(input.SourceDocumentID),
		nullableInt64(input.SourceLineID),
		nullableString(input.PackingListNo),
		nullableString(input.OrderRef),
		nullableString(input.ItemNumber),
		nullableString(input.DescriptionSnapshot),
		input.ExpectedQty,
		input.ReceivedQty,
		input.Pallets,
		nullableString(input.DocumentNote),
		nullableString(input.Reason),
		nullableString(input.ReferenceCode),
	)
	if err != nil {
		return mapDBError(fmt.Errorf("create container lifecycle event: %w", err))
	}
	return nil
}

func scanContainerLifecycleEvent(scanner itemScanner) (ContainerLifecycleEvent, error) {
	var event ContainerLifecycleEvent
	if err := scanner.Scan(
		&event.ID,
		&event.StockLedgerID,
		&event.CustomerID,
		&event.CustomerName,
		&event.LocationID,
		&event.LocationName,
		&event.StorageSection,
		&event.ContainerNo,
		&event.EventType,
		&event.EventTime,
		&event.QuantityDelta,
		&event.PalletDelta,
		&event.SKUMasterID,
		&event.SourceDocumentType,
		&event.SourceDocumentID,
		&event.SourceLineID,
		&event.PackingListNo,
		&event.OrderRef,
		&event.ItemNumber,
		&event.Description,
		&event.ExpectedQty,
		&event.ReceivedQty,
		&event.Pallets,
		&event.DocumentNote,
		&event.Reason,
		&event.ReferenceCode,
		&event.CreatedAt,
	); err != nil {
		return ContainerLifecycleEvent{}, fmt.Errorf("scan container lifecycle event: %w", err)
	}
	event.StorageSection = normalizeStorageSection(event.StorageSection)
	event.ContainerNo = strings.TrimSpace(event.ContainerNo)
	return event, nil
}

func resolveContainerLifecycleEventTime(input createStockLedgerInput) *time.Time {
	if input.OccurredAt != nil {
		return input.OccurredAt
	}
	switch firstNonEmpty(input.EventType, StockLedgerEventReceive) {
	case StockLedgerEventReceive:
		return input.DeliveryDate
	case StockLedgerEventShip, StockLedgerEventReversal:
		return input.OutDate
	default:
		return nil
	}
}
