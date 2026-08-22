package api

import (
	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) registerV2Routes(protected gin.IRouter) {
	v2 := protected.Group("/v2")

	staff := v2.Group("")
	staff.Use(s.requireRoles(service.RoleAdmin, service.RoleOperator, service.RoleViewer))
	staff.GET("/containers", s.handleV2ListContainers)
	staff.GET("/containers/:containerNo/lifecycle", s.handleV2GetContainerLifecycle)

	operator := v2.Group("")
	operator.Use(s.requireRoles(service.RoleAdmin, service.RoleOperator))
	operator.POST("/containers", s.handleV2CreateContainer)
	operator.PUT("/containers/:containerNo/metadata", s.handleV2UpdateContainerMetadata)
	operator.POST("/containers/:containerNo/tracking-events", s.handleV2CreateContainerTrackingEvent)
	operator.POST("/containers/:containerNo/pickup-assignments", s.handleV2CreateContainerPickupAssignment)
	operator.POST("/picking-orders", s.handleV2CreatePickingOrder)
	operator.POST("/deliveries", s.handleV2CreateDeliveryEvent)
	operator.POST("/deliveries/:id/bol", s.handleV2ReceiveBOL)

}
