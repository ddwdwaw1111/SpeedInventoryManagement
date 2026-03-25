package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

const UIPreferenceScopeGlobal = "global"

type UIPreference struct {
	ID              int64     `db:"id" json:"id"`
	ScopeType       string    `db:"scope_type" json:"scopeType"`
	ScopeID         int64     `db:"scope_id" json:"scopeId"`
	PreferenceKey   string    `db:"preference_key" json:"key"`
	ValueJSON       string    `db:"value_json" json:"-"`
	UpdatedByUserID int64     `db:"updated_by_user_id" json:"updatedByUserId"`
	CreatedAt       time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt       time.Time `db:"updated_at" json:"updatedAt"`
}

func normalizeUIPreferenceKey(key string) (string, error) {
	normalized := strings.TrimSpace(key)
	if normalized == "" || len(normalized) > 120 {
		return "", ErrInvalidInput
	}
	return normalized, nil
}

func (s *Store) GetGlobalUIPreference(ctx context.Context, key string) (UIPreference, error) {
	normalizedKey, err := normalizeUIPreferenceKey(key)
	if err != nil {
		return UIPreference{}, err
	}

	var preference UIPreference
	err = s.db.GetContext(ctx, &preference, `
		SELECT
			id,
			scope_type,
			scope_id,
			preference_key,
			COALESCE(value_json, '') AS value_json,
			COALESCE(updated_by_user_id, 0) AS updated_by_user_id,
			created_at,
			updated_at
		FROM ui_preferences
		WHERE scope_type = ? AND scope_id = 0 AND preference_key = ?
		LIMIT 1
	`, UIPreferenceScopeGlobal, normalizedKey)
	if err != nil {
		if err == sql.ErrNoRows {
			return UIPreference{
				ScopeType:     UIPreferenceScopeGlobal,
				ScopeID:       0,
				PreferenceKey: normalizedKey,
			}, nil
		}
		return UIPreference{}, err
	}

	return preference, nil
}

func (s *Store) UpsertGlobalUIPreference(ctx context.Context, key string, valueJSON string, updatedByUserID int64) (UIPreference, error) {
	normalizedKey, err := normalizeUIPreferenceKey(key)
	if err != nil {
		return UIPreference{}, err
	}

	normalizedValueJSON := strings.TrimSpace(valueJSON)
	if normalizedValueJSON == "" {
		normalizedValueJSON = "null"
	}
	if !json.Valid([]byte(normalizedValueJSON)) {
		return UIPreference{}, ErrInvalidInput
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO ui_preferences (
			scope_type,
			scope_id,
			preference_key,
			value_json,
			updated_by_user_id
		)
		VALUES (?, 0, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			value_json = VALUES(value_json),
			updated_by_user_id = VALUES(updated_by_user_id),
			updated_at = CURRENT_TIMESTAMP
	`, UIPreferenceScopeGlobal, normalizedKey, normalizedValueJSON, updatedByUserID); err != nil {
		return UIPreference{}, err
	}

	return s.GetGlobalUIPreference(ctx, normalizedKey)
}
