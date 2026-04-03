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

	receivedAt := firstNonEmptyTime(documentRow.ConfirmedAt, documentRow.DeliveryDate)
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
		nullableTime(documentRow.DeliveryDate),
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
