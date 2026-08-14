package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleClearOperationalData(c *gin.Context) {
	var input service.ClearOperationalDataInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.store.ClearOperationalData(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "RESET", "operational_data", 0, "operational_data", "Cleared all operational data", result)
	writeJSON(c, http.StatusOK, result)
}
