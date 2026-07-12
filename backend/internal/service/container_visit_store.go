package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const ContainerVisitStatusOpen = "OPEN"

func firstNonEmptyTime(values ...*time.Time) *time.Time {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
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
			container_type,
			handling_mode,
			status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		documentRow.ID,
		documentRow.CustomerID,
		documentRow.LocationID,
		normalizedContainer,
		nullableTime(firstNonEmptyTime(documentRow.ActualArrivalDate, documentRow.ExpectedArrivalDate)),
		nullableTime(receivedAt),
		coalesceContainerType(documentRow.ContainerType),
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
