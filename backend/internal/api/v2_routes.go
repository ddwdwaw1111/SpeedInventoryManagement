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
	operator.POST("/containers/:containerNo/tracking-events", s.handleV2CreateContainerTrackingEvent)
	operator.POST("/containers/:containerNo/pickup-assignments", s.handleV2CreateContainerPickupAssignment)
	operator.POST("/picking-orders", s.handleV2CreatePickingOrder)
	operator.POST("/deliveries", s.handleV2CreateDeliveryEvent)
	operator.POST("/deliveries/:id/bol", s.handleV2ReceiveBOL)

	customerPortal := v2.Group("/customer-portal")
	customerPortal.Use(s.requireRoles(service.RoleCustomer))
	s.registerV2CustomerPortalEndpoints(customerPortal)

	adminCustomerPortal := v2.Group("/admin/customer-portal/customers/:customerId")
	adminCustomerPortal.Use(s.requireRoles(service.RoleAdmin))
	s.registerV2CustomerPortalEndpoints(adminCustomerPortal)
}

func (s *Server) registerV2CustomerPortalEndpoints(router gin.IRoutes) {
	router.GET("/containers", s.handleV2CustomerPortalContainers)
	router.GET("/containers/:containerNo/lifecycle", s.handleV2CustomerPortalContainerLifecycle)
}
