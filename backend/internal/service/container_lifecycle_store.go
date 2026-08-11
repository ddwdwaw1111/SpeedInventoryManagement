package service

import (
	"context"
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
	SKU                string    `json:"sku"`
	SourceDocumentType string    `json:"sourceDocumentType"`
	SourceDocumentID   int64     `json:"sourceDocumentId"`
	SourceLineID       int64     `json:"sourceLineId"`
	PickingOrderNo     string    `json:"pickingOrderNo"`
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
		whereClauses = append(whereClauses, "sl.customer_id = ?")
		args = append(args, filter.CustomerID)
	}
	if containerNo := strings.TrimSpace(strings.ToUpper(filter.ContainerNo)); containerNo != "" {
		whereClauses = append(whereClauses, "UPPER(TRIM(sl.container_no_snapshot)) = ?")
		args = append(args, containerNo)
	}
	query := fmt.Sprintf(`
		SELECT
			sl.id,
			sl.id AS stock_ledger_id,
			sl.customer_id,
			c.name AS customer_name,
			sl.location_id,
			l.name AS location_name,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(sl.container_no_snapshot, '') AS container_no,
			sl.event_type,
			COALESCE(sl.occurred_at, sl.created_at) AS event_time,
			sl.quantity_change,
			sl.pallet_change,
			COALESCE(sl.sku_master_id, 0) AS sku_master_id,
			COALESCE(sm.sku, '') AS sku,
			COALESCE(sl.source_document_type, '') AS source_document_type,
			COALESCE(sl.source_document_id, 0) AS source_document_id,
			COALESCE(sl.source_line_id, 0) AS source_line_id,
			COALESCE(odoc.picking_order_no, '') AS picking_order_no,
			COALESCE(odoc.order_ref, '') AS order_ref,
			COALESCE(sl.item_number_snapshot, '') AS item_number,
			COALESCE(sl.description_snapshot, '') AS description,
			sl.expected_qty,
			sl.received_qty,
			sl.pallets,
			COALESCE(sl.document_note, '') AS document_note,
			COALESCE(sl.reason, '') AS reason,
			COALESCE(sl.reference_code, '') AS reference_code,
			sl.created_at
		FROM stock_ledger sl
		JOIN customers c ON c.id = sl.customer_id
		JOIN storage_locations l ON l.id = sl.location_id
		LEFT JOIN sku_master sm ON sm.id = sl.sku_master_id
		LEFT JOIN outbound_documents odoc
			ON sl.source_document_type = 'OUTBOUND' AND sl.source_document_id = odoc.id
		WHERE %s
		ORDER BY COALESCE(sl.occurred_at, sl.created_at) DESC, sl.id DESC
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
		&event.SKU,
		&event.SourceDocumentType,
		&event.SourceDocumentID,
		&event.SourceLineID,
		&event.PickingOrderNo,
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
