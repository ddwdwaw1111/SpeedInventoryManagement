package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleListUsers(c *gin.Context) {
	users, err := s.store.ListUsers(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, users)
}

func (s *Server) handleCreateUser(c *gin.Context) {
	var input service.CreateManagedUserInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	user, err := s.store.CreateManagedUser(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "CREATE", "user", user.ID, user.Email, "Created user", map[string]any{
		"email":    user.Email,
		"fullName": user.FullName,
		"role":     user.Role,
		"isActive": user.IsActive,
	})

	writeJSON(c, http.StatusCreated, user)
}

func (s *Server) handleUpdateUserAccess(c *gin.Context) {
	userID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, ok := userFromContext(c)
	if !ok {
		writeError(c, http.StatusUnauthorized, "authentication required")
		return
	}

	var input service.UpdateUserAccessInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	user, err := s.store.UpdateUserAccess(c.Request.Context(), authPayload.User.ID, userID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "UPDATE", "user", user.ID, user.Email, "Updated user access", map[string]any{
		"email":    user.Email,
		"role":     user.Role,
		"isActive": user.IsActive,
		"actorId":  authPayload.User.ID,
	})

	writeJSON(c, http.StatusOK, user)
}
