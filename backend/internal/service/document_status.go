package service

import (
	"fmt"
	"strings"
)

const (
	DocumentStatusDraft     = "DRAFT"
	DocumentStatusConfirmed = "CONFIRMED"
	DocumentStatusPosted    = "POSTED"
	DocumentStatusDeleted   = "DELETED"
	DocumentStatusArchived  = "ARCHIVED"

	DocumentArchiveScopeActive   = "ACTIVE"
	DocumentArchiveScopeArchived = "ARCHIVED"
	DocumentArchiveScopeAll      = "ALL"

	InboundTrackingScheduled = "SCHEDULED"
	InboundTrackingArrived   = "ARRIVED"
	InboundTrackingReceiving = "RECEIVING"
	InboundTrackingReceived  = "RECEIVED"

	OutboundTrackingScheduled  = "SCHEDULED"
	OutboundTrackingPicking    = "PICKING"
	OutboundTrackingPacked     = "PACKED"
	OutboundTrackingShipped    = "SHIPPED"
	OutboundTrackingBOReceived = "BO_RECEIVED"

	InboundHandlingModePalletized    = "PALLETIZED"
	InboundHandlingModeSealedTransit = "SEALED_TRANSIT"

	ContainerTypeNormal            = "NORMAL"
	ContainerTypeWestCoastTransfer = "WEST_COAST_TRANSFER"
)

func normalizeDocumentStatus(raw string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case DocumentStatusDraft:
		return DocumentStatusDraft
	case DocumentStatusConfirmed:
		return DocumentStatusConfirmed
	case DocumentStatusPosted:
		return DocumentStatusConfirmed
	case DocumentStatusDeleted, "CANCELLED":
		return DocumentStatusDeleted
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
	case DocumentStatusConfirmed, DocumentStatusDeleted:
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

func buildDocumentStatusFilterClause(alias string, status string) (string, []any) {
	normalized := normalizeDocumentStatus(status)
	statusColumn := fmt.Sprintf("UPPER(TRIM(%s.status))", alias)
	switch normalized {
	case "":
		return "", nil
	case DocumentStatusArchived:
		return "", nil
	case DocumentStatusConfirmed:
		return fmt.Sprintf("%s IN (?, ?)", statusColumn), []any{DocumentStatusConfirmed, DocumentStatusPosted}
	case DocumentStatusDeleted:
		return fmt.Sprintf("%s IN (?, ?)", statusColumn), []any{DocumentStatusDeleted, "CANCELLED"}
	default:
		return fmt.Sprintf("%s = ?", statusColumn), []any{normalized}
	}
}

func buildOutboundTrackingStatusFilterClause(alias string, status string) (string, []any) {
	normalized := strings.TrimSpace(strings.ToUpper(status))
	if normalized == "" || normalized == "ALL" {
		return "", nil
	}
	statusColumn := fmt.Sprintf("UPPER(TRIM(COALESCE(%s.tracking_status, '')))", alias)
	switch normalized {
	case OutboundTrackingScheduled, OutboundTrackingPicking, OutboundTrackingPacked, OutboundTrackingShipped, OutboundTrackingBOReceived:
		return fmt.Sprintf("%s = ?", statusColumn), []any{normalized}
	default:
		return "1 = 0", nil
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
	case OutboundTrackingBOReceived:
		return OutboundTrackingBOReceived
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

func normalizeContainerType(raw string) string {
	switch strings.TrimSpace(strings.ToUpper(raw)) {
	case ContainerTypeNormal:
		return ContainerTypeNormal
	case ContainerTypeWestCoastTransfer:
		return ContainerTypeWestCoastTransfer
	default:
		return strings.TrimSpace(strings.ToUpper(raw))
	}
}

func coalesceContainerType(raw string) string {
	normalized := normalizeContainerType(raw)
	if normalized == "" {
		return ContainerTypeNormal
	}
	return normalized
}

func validateContainerType(raw string) error {
	switch coalesceContainerType(raw) {
	case ContainerTypeNormal, ContainerTypeWestCoastTransfer:
		return nil
	default:
		return fmt.Errorf("%w: container type must be NORMAL or WEST_COAST_TRANSFER", ErrInvalidInput)
	}
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
	case OutboundTrackingBOReceived:
		return 5
	default:
		return 1
	}
}
