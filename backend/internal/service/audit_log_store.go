package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type AuditLog struct {
	ID            int64     `db:"id" json:"id"`
	ActorUserID   int64     `db:"actor_user_id" json:"actorUserId"`
	ActorEmail    string    `db:"actor_email" json:"actorEmail"`
	ActorName     string    `db:"actor_name" json:"actorName"`
	ActorRole     string    `db:"actor_role" json:"actorRole"`
	Action        string    `db:"action" json:"action"`
	EntityType    string    `db:"entity_type" json:"entityType"`
	EntityID      int64     `db:"entity_id" json:"entityId"`
	TargetLabel   string    `db:"target_label" json:"targetLabel"`
	Summary       string    `db:"summary" json:"summary"`
	DetailsJSON   string    `db:"details_json" json:"detailsJson"`
	RequestMethod string    `db:"request_method" json:"requestMethod"`
	RequestPath   string    `db:"request_path" json:"requestPath"`
	CreatedAt     time.Time `db:"created_at" json:"createdAt"`
}

type CreateAuditLogInput struct {
	ActorUserID   int64
	ActorEmail    string
	ActorName     string
	ActorRole     string
	Action        string
	EntityType    string
	EntityID      int64
	TargetLabel   string
	Summary       string
	RequestMethod string
	RequestPath   string
	Details       any
}

func (s *Store) ListAuditLogs(ctx context.Context, limit int) ([]AuditLog, error) {
	if limit <= 0 {
		limit = 100
	}

	logs := make([]AuditLog, 0)
	if err := s.db.SelectContext(ctx, &logs, `
		SELECT
			id,
			actor_user_id,
			COALESCE(actor_email, '') AS actor_email,
			COALESCE(actor_name, '') AS actor_name,
			COALESCE(actor_role, '') AS actor_role,
			action,
			entity_type,
			COALESCE(entity_id, 0) AS entity_id,
			COALESCE(target_label, '') AS target_label,
			COALESCE(summary, '') AS summary,
			COALESCE(details_json, '') AS details_json,
			COALESCE(request_method, '') AS request_method,
			COALESCE(request_path, '') AS request_path,
			created_at
		FROM audit_logs
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, limit); err != nil {
		return nil, fmt.Errorf("load audit logs: %w", err)
	}

	return logs, nil
}

func (s *Store) CreateAuditLog(ctx context.Context, input CreateAuditLogInput) error {
	input = sanitizeAuditLogInput(input)
	if err := validateAuditLogInput(input); err != nil {
		return err
	}

	detailsJSON := ""
	if input.Details != nil {
		encoded, err := json.Marshal(input.Details)
		if err != nil {
			return fmt.Errorf("encode audit log details: %w", err)
		}
		detailsJSON = string(encoded)
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO audit_logs (
			actor_user_id,
			actor_email,
			actor_name,
			actor_role,
			action,
			entity_type,
			entity_id,
			target_label,
			summary,
			details_json,
			request_method,
			request_path
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		input.ActorUserID,
		nullableString(input.ActorEmail),
		nullableString(input.ActorName),
		nullableString(input.ActorRole),
		input.Action,
		input.EntityType,
		nullableInt64(input.EntityID),
		nullableString(input.TargetLabel),
		nullableString(input.Summary),
		nullableString(detailsJSON),
		nullableString(input.RequestMethod),
		nullableString(input.RequestPath),
	); err != nil {
		return mapDBError(fmt.Errorf("create audit log: %w", err))
	}

	return nil
}

func sanitizeAuditLogInput(input CreateAuditLogInput) CreateAuditLogInput {
	input.ActorEmail = strings.TrimSpace(strings.ToLower(input.ActorEmail))
	input.ActorName = strings.TrimSpace(input.ActorName)
	input.ActorRole = strings.TrimSpace(strings.ToLower(input.ActorRole))
	input.Action = strings.TrimSpace(strings.ToUpper(input.Action))
	input.EntityType = strings.TrimSpace(strings.ToLower(input.EntityType))
	input.TargetLabel = strings.TrimSpace(input.TargetLabel)
	input.Summary = strings.TrimSpace(input.Summary)
	input.RequestMethod = strings.TrimSpace(strings.ToUpper(input.RequestMethod))
	input.RequestPath = strings.TrimSpace(input.RequestPath)
	return input
}

func validateAuditLogInput(input CreateAuditLogInput) error {
	switch {
	case input.ActorUserID <= 0:
		return fmt.Errorf("%w: actor user is required", ErrInvalidInput)
	case input.Action == "":
		return fmt.Errorf("%w: action is required", ErrInvalidInput)
	case input.EntityType == "":
		return fmt.Errorf("%w: entity type is required", ErrInvalidInput)
	default:
		return nil
	}
}

func nullableInt64(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}
