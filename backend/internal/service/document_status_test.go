package service

import (
	"reflect"
	"testing"
)

func TestBuildDocumentStatusFilterClause(t *testing.T) {
	testCases := []struct {
		name       string
		status     string
		wantClause string
		wantArgs   []any
	}{
		{
			name: "blank",
		},
		{
			name:       "confirmed includes posted legacy rows",
			status:     " confirmed ",
			wantClause: "UPPER(TRIM(d.status)) IN (?, ?)",
			wantArgs:   []any{DocumentStatusConfirmed, DocumentStatusPosted},
		},
		{
			name:       "deleted includes cancelled legacy rows",
			status:     DocumentStatusDeleted,
			wantClause: "UPPER(TRIM(d.status)) IN (?, ?)",
			wantArgs:   []any{DocumentStatusDeleted, "CANCELLED"},
		},
		{
			name:       "draft exact match",
			status:     DocumentStatusDraft,
			wantClause: "UPPER(TRIM(d.status)) = ?",
			wantArgs:   []any{DocumentStatusDraft},
		},
		{
			name:   "archived is handled by archive scope",
			status: DocumentStatusArchived,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			gotClause, gotArgs := buildDocumentStatusFilterClause("d", tc.status)
			if gotClause != tc.wantClause {
				t.Fatalf("expected clause %q, got %q", tc.wantClause, gotClause)
			}
			if !reflect.DeepEqual(gotArgs, tc.wantArgs) {
				t.Fatalf("expected args %#v, got %#v", tc.wantArgs, gotArgs)
			}
		})
	}
}
