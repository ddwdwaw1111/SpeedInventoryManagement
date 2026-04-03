package service

import (
	"fmt"
	"strings"
)

const (
	DocumentStatusDraft     = "DRAFT"
	DocumentStatusConfirmed = "CONFIRMED"
	DocumentStatusPosted    = "POSTED"
	DocumentStatusCancelled = "CANCELLED"
	DocumentStatusArchived  = "ARCHIVED"

	DocumentArchiveScopeActive   = "ACTIVE"
	DocumentArchiveScopeArchived = "ARCHIVED"
	DocumentArchiveScopeAll      = "ALL"

	InboundTrackingScheduled = "SCHEDULED"
	InboundTrackingArrived   = "ARRIVED"
	InboundTrackingReceiving = "RECEIVING"
	InboundTrackingReceived  = "RECEIVED"

	OutboundTrackingScheduled = "SCHEDULED"
	OutboundTrackingPicking   = "PICKING"
	OutboundTrackingPacked    = "PACKED"
	OutboundTrackingShipped   = "SHIPPED"

	InboundHandlingModePalletized   = "PALLETIZED"
	InboundHandlingModeSealedTransit = "SEALED_TRANSIT"
)

func normalizeDocumentStatus(raw string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case DocumentStatusDraft:
		return DocumentStatusDraft
	case DocumentStatusConfirmed:
		return DocumentStatusConfirmed
	case DocumentStatusPosted:
		return DocumentStatusConfirmed
	case DocumentStatusCancelled:
		return DocumentStatusCancelled
	default:
		return strings.TrimSpace(strings.ToUpper(raw))
	}
}

func validateCreatableDocumentStatus(status string) error {
	switch normalizeDocumentStatus(status) {
	case DocumentStatusDraft, DocumentStatusConfirmed:
		return nil
	default:
		return fmt.Errorf("%w: document status must be draft or confirmed", ErrInvalidInput)
	}
}

func validateTransitionStatus(status string) error {
	switch normalizeDocumentStatus(status) {
	case DocumentStatusConfirmed, DocumentStatusCancelled:
		return nil
	default:
		return fmt.Errorf("%w: invalid document transition status", ErrInvalidInput)
	}
}

func coalesceDocumentStatus(status string) string {
	normalized := normalizeDocumentStatus(status)
	if normalized == "" {
		return DocumentStatusConfirmed
	}
	return normalized
}

func normalizeDocumentArchiveScope(raw string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case DocumentArchiveScopeArchived:
		return DocumentArchiveScopeArchived
	case DocumentArchiveScopeAll:
		return DocumentArchiveScopeAll
	default:
		return DocumentArchiveScopeActive
	}
}

func buildDocumentArchiveFilterClause(alias string, scope string) string {
	archiveColumn := fmt.Sprintf("%s.archived_at", alias)
	switch normalizeDocumentArchiveScope(scope) {
	case DocumentArchiveScopeArchived:
		return fmt.Sprintf("%s IS NOT NULL", archiveColumn)
	case DocumentArchiveScopeAll:
		return "1 = 1"
	default:
		return fmt.Sprintf("%s IS NULL", archiveColumn)
	}
}

func normalizeInboundTrackingStatus(raw string, documentStatus string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case InboundTrackingScheduled:
		return InboundTrackingScheduled
	case InboundTrackingArrived:
		return InboundTrackingArrived
	case InboundTrackingReceiving:
		return InboundTrackingReceiving
	case InboundTrackingReceived:
		return InboundTrackingReceived
	default:
		if normalizeDocumentStatus(documentStatus) == DocumentStatusConfirmed {
			return InboundTrackingReceived
		}
		return InboundTrackingScheduled
	}
}

func normalizeOutboundTrackingStatus(raw string, documentStatus string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case OutboundTrackingScheduled:
		return OutboundTrackingScheduled
	case OutboundTrackingPicking:
		return OutboundTrackingPicking
	case OutboundTrackingPacked:
		return OutboundTrackingPacked
	case OutboundTrackingShipped:
		return OutboundTrackingShipped
	default:
		if normalizeDocumentStatus(documentStatus) == DocumentStatusConfirmed {
			return OutboundTrackingShipped
		}
		return OutboundTrackingScheduled
	}
}

func coalesceInboundTrackingStatus(raw string, documentStatus string) string {
	return normalizeInboundTrackingStatus(raw, documentStatus)
}

func coalesceOutboundTrackingStatus(raw string, documentStatus string) string {
	return normalizeOutboundTrackingStatus(raw, documentStatus)
}

func normalizeInboundHandlingMode(raw string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case InboundHandlingModePalletized:
		return InboundHandlingModePalletized
	case InboundHandlingModeSealedTransit:
		return InboundHandlingModeSealedTransit
	default:
		return strings.TrimSpace(strings.ToUpper(raw))
	}
}

func coalesceInboundHandlingMode(raw string) string {
	normalized := normalizeInboundHandlingMode(raw)
	if normalized == "" {
		return InboundHandlingModePalletized
	}
	return normalized
}

func validateInboundTrackingTransition(current string, target string) error {
	currentRank := inboundTrackingRank(normalizeInboundTrackingStatus(current, DocumentStatusDraft))
	targetRank := inboundTrackingRank(normalizeInboundTrackingStatus(target, DocumentStatusDraft))
	if targetRank < currentRank {
		return fmt.Errorf("%w: inbound tracking status cannot move backwards", ErrInvalidInput)
	}
	return nil
}

func validateOutboundTrackingTransition(current string, target string) error {
	currentRank := outboundTrackingRank(normalizeOutboundTrackingStatus(current, DocumentStatusDraft))
	targetRank := outboundTrackingRank(normalizeOutboundTrackingStatus(target, DocumentStatusDraft))
	if targetRank < currentRank {
		return fmt.Errorf("%w: outbound tracking status cannot move backwards", ErrInvalidInput)
	}
	return nil
}

func inboundTrackingRank(status string) int {
	switch normalizeInboundTrackingStatus(status, DocumentStatusDraft) {
	case InboundTrackingScheduled:
		return 1
	case InboundTrackingArrived:
		return 2
	case InboundTrackingReceiving:
		return 3
	case InboundTrackingReceived:
		return 4
	default:
		return 1
	}
}

func outboundTrackingRank(status string) int {
	switch normalizeOutboundTrackingStatus(status, DocumentStatusDraft) {
	case OutboundTrackingScheduled:
		return 1
	case OutboundTrackingPicking:
		return 2
	case OutboundTrackingPacked:
		return 3
	case OutboundTrackingShipped:
		return 4
	default:
		return 1
	}
}
