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
