package service

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	ContainerVisitStatusOpen      = "OPEN"
	ContainerVisitStatusCancelled = "CANCELLED"

	PalletEventReceived    = "RECEIVED"
	PalletEventOutbound    = "OUTBOUND"
	PalletEventReversal    = "REVERSAL"
	PalletEventTransferOut = "TRANSFER_OUT"
	PalletEventTransferIn  = "TRANSFER_IN"
	PalletEventAdjust      = "ADJUST"
	PalletEventCancelled   = "CANCELLED"
)

type createPalletLocationEventInput struct {
	PalletID         int64
	ContainerVisitID int64
	CustomerID       int64
	LocationID       int64
	StorageSection   string
	ContainerNo      string
	EventType        string
	QuantityDelta    int
	PalletDelta      float64
	EventTime        *time.Time
}

type ListPalletLocationEventFilters struct {
	ContainerNo string
}

type PalletLocationEvent struct {
	ID               int64     `json:"id"`
	PalletID         int64     `json:"palletId"`
	PalletCode       string    `json:"palletCode"`
	ContainerVisitID int64     `json:"containerVisitId"`
	CustomerID       int64     `json:"customerId"`
	CustomerName     string    `json:"customerName"`
	LocationID       int64     `json:"locationId"`
	LocationName     string    `json:"locationName"`
	StorageSection   string    `json:"storageSection"`
	ContainerNo      string    `json:"containerNo"`
	EventType        string    `json:"eventType"`
	QuantityDelta    int       `json:"quantityDelta"`
	PalletDelta      float64   `json:"palletDelta"`
	EventTime        time.Time `json:"eventTime"`
	CreatedAt        time.Time `json:"createdAt"`
}

type palletLocationEventRow struct {
	ID               int64     `db:"id"`
	PalletID         int64     `db:"pallet_id"`
	PalletCode       string    `db:"pallet_code"`
	ContainerVisitID int64     `db:"container_visit_id"`
	CustomerID       int64     `db:"customer_id"`
	CustomerName     string    `db:"customer_name"`
	LocationID       int64     `db:"location_id"`
	LocationName     string    `db:"location_name"`
	StorageSection   string    `db:"storage_section"`
	ContainerNo      string    `db:"container_no"`
	EventType        string    `db:"event_type"`
	QuantityDelta    int       `db:"quantity_delta"`
	PalletDelta      float64   `db:"pallet_delta"`
	EventTime        time.Time `db:"event_time"`
	CreatedAt        time.Time `db:"created_at"`
}

func normalizePalletCount(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func roundedPalletInt(value float64) int {
	return int(math.Round(normalizePalletCount(value)))
}

func firstNonEmptyTime(values ...*time.Time) *time.Time {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

type palletLocationEventTarget struct {
	PalletID         int64
	ContainerVisitID int64
	CustomerID       int64
	LocationID       int64
	StorageSection   string
	ContainerNo      string
	Quantity         int
}

func ensureContainerVisitForInboundDocumentTx(ctx context.Context, tx *sql.Tx, documentRow inboundDocumentRow) (int64, error) {
	normalizedContainer := strings.TrimSpace(documentRow.ContainerNo)
	if normalizedContainer == "" {
		return 0, nil
	}

	var visitID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM container_visits
		WHERE inbound_document_id = ?
		FOR UPDATE
	`, documentRow.ID).Scan(&visitID); err == nil {
		return visitID, nil
	} else if err != sql.ErrNoRows {
		return 0, fmt.Errorf("load container visit: %w", err)
	}

	receivedAt := firstNonEmptyTime(documentRow.ConfirmedAt)
	if receivedAt == nil {
		now := time.Now().UTC()
		receivedAt = &now
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO container_visits (
			inbound_document_id,
			customer_id,
			location_id,
			container_no,
			arrival_date,
			received_at,
			handling_mode,
			status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		documentRow.ID,
		documentRow.CustomerID,
		documentRow.LocationID,
		normalizedContainer,
		nullableTime(firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate)),
		nullableTime(receivedAt),
		coalesceInboundHandlingMode(documentRow.HandlingMode),
		ContainerVisitStatusOpen,
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("create container visit: %w", err))
	}

	visitID, err = result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve container visit id: %w", err)
	}
	return visitID, nil
}

func (s *Store) closeContainerVisitForInboundDocumentTx(ctx context.Context, tx *sql.Tx, inboundDocumentID int64, status string) error {
	if inboundDocumentID <= 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE container_visits
		SET
			status = ?,
			closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
			updated_at = CURRENT_TIMESTAMP
		WHERE inbound_document_id = ?
	`, firstNonEmpty(status, ContainerVisitStatusCancelled), inboundDocumentID); err != nil {
		return mapDBError(fmt.Errorf("close container visit: %w", err))
	}
	return nil
}

func weightedIntSplits(total int, weights []int) []int {
	result := make([]int, len(weights))
	if total <= 0 || len(weights) == 0 {
		return result
	}

	totalWeight := 0
	lastPositiveIndex := -1
	for index, weight := range weights {
		if weight > 0 {
			totalWeight += weight
			lastPositiveIndex = index
		}
	}
	if totalWeight <= 0 || lastPositiveIndex < 0 {
		return splitQuantityEvenly(total, len(weights))
	}

	remainingTotal := total
	remainingWeight := totalWeight
	for index, weight := range weights {
		if weight <= 0 {
			continue
		}
		if index == lastPositiveIndex || remainingWeight <= 0 {
			result[index] = remainingTotal
			break
		}
		share := int(math.Round(float64(remainingTotal) * float64(weight) / float64(remainingWeight)))
		if share > remainingTotal {
			share = remainingTotal
		}
		result[index] = share
		remainingTotal -= share
		remainingWeight -= weight
	}

	return result
}

func (s *Store) insertPalletLocationEventTx(ctx context.Context, tx *sql.Tx, input createPalletLocationEventInput) error {
	if input.PalletID <= 0 || input.CustomerID <= 0 || input.LocationID <= 0 {
		return fmt.Errorf("%w: invalid pallet location event input", ErrInvalidInput)
	}
	eventTime := input.EventTime
	if eventTime == nil {
		now := time.Now().UTC()
		eventTime = &now
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO pallet_location_events (
			pallet_id,
			container_visit_id,
			customer_id,
			location_id,
			storage_section,
			container_no,
			event_type,
			quantity_delta,
			pallet_delta,
			event_time
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		input.PalletID,
		nullableInt64(input.ContainerVisitID),
		input.CustomerID,
		input.LocationID,
		fallbackSection(input.StorageSection),
		strings.TrimSpace(input.ContainerNo),
		firstNonEmpty(strings.TrimSpace(input.EventType), PalletEventAdjust),
		input.QuantityDelta,
		normalizePalletCount(input.PalletDelta),
		nullableTime(eventTime),
	); err != nil {
		return mapDBError(fmt.Errorf("create pallet location event: %w", err))
	}
	return nil
}

func (s *Store) createPalletLocationEventTx(ctx context.Context, tx *sql.Tx, input createPalletLocationEventInput) error {
	if input.PalletID <= 0 {
		return fmt.Errorf("%w: invalid pallet location event input", ErrInvalidInput)
	}
	return s.insertPalletLocationEventTx(ctx, tx, input)
}

func (s *Store) ListPalletLocationEvents(ctx context.Context, limit int, filters ListPalletLocationEventFilters) ([]PalletLocationEvent, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}

	query := `
		SELECT
			ple.id,
			ple.pallet_id,
			p.pallet_code,
			COALESCE(ple.container_visit_id, 0) AS container_visit_id,
			ple.customer_id,
			c.name AS customer_name,
			ple.location_id,
			l.name AS location_name,
			ple.storage_section,
			ple.container_no,
			ple.event_type,
			ple.quantity_delta,
			ple.pallet_delta,
			ple.event_time,
			ple.created_at
		FROM pallet_location_events ple
		INNER JOIN pallets p ON p.id = ple.pallet_id
		INNER JOIN customers c ON c.id = ple.customer_id
		INNER JOIN storage_locations l ON l.id = ple.location_id
		WHERE 1 = 1
	`

	args := make([]any, 0, 2)
	if normalizedContainerNo := strings.TrimSpace(strings.ToUpper(filters.ContainerNo)); normalizedContainerNo != "" {
		query += ` AND UPPER(TRIM(ple.container_no)) = ?`
		args = append(args, normalizedContainerNo)
	}

	query += ` ORDER BY ple.event_time DESC, ple.id DESC LIMIT ?`
	args = append(args, limit)

	rows := make([]palletLocationEventRow, 0)
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, mapDBError(fmt.Errorf("list pallet location events: %w", err))
	}

	events := make([]PalletLocationEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, PalletLocationEvent{
			ID:               row.ID,
			PalletID:         row.PalletID,
			PalletCode:       row.PalletCode,
			ContainerVisitID: row.ContainerVisitID,
			CustomerID:       row.CustomerID,
			CustomerName:     row.CustomerName,
			LocationID:       row.LocationID,
			LocationName:     row.LocationName,
			StorageSection:   row.StorageSection,
			ContainerNo:      row.ContainerNo,
			EventType:        row.EventType,
			QuantityDelta:    row.QuantityDelta,
			PalletDelta:      normalizePalletCount(row.PalletDelta),
			EventTime:        row.EventTime,
			CreatedAt:        row.CreatedAt,
		})
	}

	return events, nil
}

func splitPalletsByQuantities(total float64, quantities []int) []float64 {
	result := make([]float64, len(quantities))
	if len(quantities) == 0 || total == 0 {
		return result
	}

	totalQty := 0
	for _, quantity := range quantities {
		if quantity > 0 {
			totalQty += quantity
		}
	}
	if totalQty <= 0 {
		return result
	}

	remainingTotal := normalizePalletCount(total)
	remainingQty := totalQty
	for index, quantity := range quantities {
		if quantity <= 0 {
			continue
		}
		if index == len(quantities)-1 || remainingQty <= 0 {
			result[index] = normalizePalletCount(remainingTotal)
			continue
		}
		share := normalizePalletCount(total * float64(quantity) / float64(totalQty))
		if share > remainingTotal {
			share = remainingTotal
		}
		result[index] = share
		remainingTotal = normalizePalletCount(remainingTotal - share)
		remainingQty -= quantity
	}

	return result
}
