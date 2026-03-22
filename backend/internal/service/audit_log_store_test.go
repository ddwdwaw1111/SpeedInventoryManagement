package service

import (
	"errors"
	"testing"
)

func TestSanitizeAuditLogInput(t *testing.T) {
	input := sanitizeAuditLogInput(CreateAuditLogInput{
		ActorUserID:   12,
		ActorEmail:    "  ADMIN@Example.com ",
		ActorName:     "  Jane Admin ",
		ActorRole:     "  ADMIN ",
		Action:        "  created ",
		EntityType:    "  Outbound_Document ",
		TargetLabel:   "  PL-001 ",
		Summary:       "  Created outbound document ",
		RequestMethod: "  post ",
		RequestPath:   "  /api/outbound-documents ",
	})

	if input.ActorEmail != "admin@example.com" {
		t.Fatalf("expected normalized email, got %q", input.ActorEmail)
	}
	if input.ActorName != "Jane Admin" {
		t.Fatalf("expected trimmed name, got %q", input.ActorName)
	}
	if input.ActorRole != "admin" {
		t.Fatalf("expected normalized role, got %q", input.ActorRole)
	}
	if input.Action != "CREATED" {
		t.Fatalf("expected normalized action, got %q", input.Action)
	}
	if input.EntityType != "outbound_document" {
		t.Fatalf("expected normalized entity type, got %q", input.EntityType)
	}
	if input.RequestMethod != "POST" {
		t.Fatalf("expected normalized request method, got %q", input.RequestMethod)
	}
}

func TestValidateAuditLogInput(t *testing.T) {
	validInput := CreateAuditLogInput{
		ActorUserID: 1,
		Action:      "CREATED",
		EntityType:  "outbound_document",
	}

	if err := validateAuditLogInput(validInput); err != nil {
		t.Fatalf("expected valid audit input, got %v", err)
	}

	testCases := []struct {
		name  string
		input CreateAuditLogInput
	}{
		{name: "missing actor", input: CreateAuditLogInput{Action: "CREATED", EntityType: "outbound_document"}},
		{name: "missing action", input: CreateAuditLogInput{ActorUserID: 1, EntityType: "outbound_document"}},
		{name: "missing entity type", input: CreateAuditLogInput{ActorUserID: 1, Action: "CREATED"}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAuditLogInput(tc.input)
			if err == nil {
				t.Fatal("expected validation error")
			}
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}
