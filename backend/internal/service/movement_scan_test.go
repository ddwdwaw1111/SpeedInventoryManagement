package service

import (
	"database/sql"
	"fmt"
	"testing"
)

type nullMovementDocumentReferenceScanner struct{}

func (nullMovementDocumentReferenceScanner) Scan(dest ...any) error {
	if len(dest) != 38 {
		return fmt.Errorf("unexpected movement scan destination count: %d", len(dest))
	}
	for _, index := range []int{2, 3, 4, 5} {
		if _, ok := dest[index].(*sql.NullInt64); !ok {
			return fmt.Errorf("movement document reference %d must accept NULL, got %T", index, dest[index])
		}
	}
	return nil
}

func TestScanMovementAcceptsNullDocumentReferences(t *testing.T) {
	movement, err := scanMovement(nullMovementDocumentReferenceScanner{})
	if err != nil {
		t.Fatalf("scan movement with nullable document references: %v", err)
	}
	if movement.InboundDocumentID != 0 || movement.InboundDocumentLineID != 0 || movement.OutboundDocumentID != 0 || movement.OutboundDocumentLineID != 0 {
		t.Fatalf("expected NULL document references to normalize to zero, got %#v", movement)
	}
}
