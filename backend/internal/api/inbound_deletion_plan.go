package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handlePreviewInboundDeletion(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	impact, err := s.store.PreviewInboundDeletion(c.Request.Context(), documentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, impact)
}

func (s *Server) handleDeleteInboundWithDependencies(c *gin.Context) {
	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	var input service.DeleteInboundWithDependenciesInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	response, err := s.store.DeleteInboundWithDependencies(c.Request.Context(), documentID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	for _, dependency := range response.DeletedDependencies {
		entityType := strings.ToLower(strings.TrimSpace(dependency.SourceType))
		s.writeAuditLog(c, "DELETE", entityType, dependency.DocumentID, dependency.Reference, "Rolled back and deleted as an explicitly selected inbound-receipt dependency", map[string]any{
			"inboundDocumentId":  response.DocumentID,
			"containerNo":        response.ContainerNo,
			"sourceType":         dependency.SourceType,
			"lastLedgerId":       dependency.LastLedgerID,
			"affectedContainers": dependency.AffectedContainers,
		})
	}
	for _, dependency := range response.DeletedImplicitDependencies {
		entityType := strings.ToLower(strings.TrimSpace(dependency.SourceType))
		s.writeAuditLog(c, "DELETE", entityType, dependency.DocumentID, dependency.Reference, "Rolled back and deleted as an automatic transfer linked to an explicitly selected outbound dependency", map[string]any{
			"inboundDocumentId":  response.DocumentID,
			"containerNo":        response.ContainerNo,
			"sourceType":         dependency.SourceType,
			"lastLedgerId":       dependency.LastLedgerID,
			"affectedContainers": dependency.AffectedContainers,
		})
	}
	s.writeAuditLog(c, "DELETE", "inbound_document", response.DocumentID, firstNonEmptyString(response.ContainerNo, fmt.Sprintf("inbound:%d", response.DocumentID)), "Deleted inbound receipt after explicitly rolling back selected later activities", map[string]any{
		"containerNo":             response.ContainerNo,
		"deletedAt":               response.DeletedAt,
		"dependencyCount":         len(response.DeletedDependencies),
		"implicitDependencyCount": len(response.DeletedImplicitDependencies),
		"dependenciesSelected":    response.DeletedDependencies,
		"implicitDependencies":    response.DeletedImplicitDependencies,
	})
	s.cleanupPendingDocumentAttachmentObjects(context.Background())
	writeJSON(c, http.StatusOK, response)
}
