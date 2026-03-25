package api

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

type updateUIPreferenceInput struct {
	Value json.RawMessage `json:"value"`
}

func (s *Server) handleGetUIPreference(c *gin.Context) {
	key := c.Param("key")
	preference, err := s.store.GetGlobalUIPreference(c.Request.Context(), key)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	value, err := decodeUIPreferenceValue(preference.ValueJSON)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, gin.H{
		"id":              preference.ID,
		"scopeType":       preference.ScopeType,
		"scopeId":         preference.ScopeID,
		"key":             preference.PreferenceKey,
		"value":           value,
		"updatedByUserId": preference.UpdatedByUserID,
		"createdAt":       preference.CreatedAt,
		"updatedAt":       preference.UpdatedAt,
	})
}

func (s *Server) handleUpdateUIPreference(c *gin.Context) {
	var input updateUIPreferenceInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, ok := userFromContext(c)
	if !ok {
		writeError(c, http.StatusUnauthorized, "authentication required")
		return
	}

	preference, err := s.store.UpsertGlobalUIPreference(c.Request.Context(), c.Param("key"), string(input.Value), authPayload.User.ID)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	value, err := decodeUIPreferenceValue(preference.ValueJSON)
	if err != nil {
		writeServerError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "ui_preference", preference.ID, preference.PreferenceKey, "Updated UI preference", map[string]any{
		"scopeType": preference.ScopeType,
		"scopeId":   preference.ScopeID,
		"key":       preference.PreferenceKey,
		"value":     value,
	})

	writeJSON(c, http.StatusOK, gin.H{
		"id":              preference.ID,
		"scopeType":       preference.ScopeType,
		"scopeId":         preference.ScopeID,
		"key":             preference.PreferenceKey,
		"value":           value,
		"updatedByUserId": preference.UpdatedByUserID,
		"createdAt":       preference.CreatedAt,
		"updatedAt":       preference.UpdatedAt,
	})
}

func decodeUIPreferenceValue(valueJSON string) (any, error) {
	if valueJSON == "" {
		return nil, nil
	}

	var value any
	if err := json.Unmarshal([]byte(valueJSON), &value); err != nil {
		return nil, err
	}

	return value, nil
}
