package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) handleCustomerPortalContainers(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	app := s.appServices()
	if app == nil {
		writeServerError(c, service.ErrNotImplemented)
		return
	}
	limit, ok := parseOptionalPositiveQuery(c, "limit")
	if !ok {
		return
	}

	containers, err := app.Container.ListContainers(c.Request.Context(), service.ListContainersInput{
		CustomerID: customerID,
		Search:     c.Query("search"),
		Limit:      limit,
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, containers)
}

func (s *Server) handleCustomerPortalContainerLifecycle(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}
	containerID, ok := parseRequiredPositiveInt64Param(c, "containerId")
	if !ok {
		return
	}

	app := s.appServices()
	if app == nil {
		writeServerError(c, service.ErrNotImplemented)
		return
	}

	lifecycle, err := app.Container.GetLifecycle(c.Request.Context(), service.GetContainerLifecycleInput{
		CustomerID:  customerID,
		ContainerID: containerID,
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, customerVisibleContainerLifecycle(lifecycle))
}
