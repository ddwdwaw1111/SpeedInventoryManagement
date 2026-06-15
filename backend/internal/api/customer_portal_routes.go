package api

import (
	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func (s *Server) registerCustomerPortalRoutes(protected gin.IRouter) {
	customerPortal := protected.Group("/customer-portal")
	customerPortal.Use(s.requireRoles(service.RoleCustomer))
	s.registerCustomerPortalEndpoints(customerPortal)

	adminCustomerPortal := protected.Group("/admin/customer-portal/customers/:customerId")
	adminCustomerPortal.Use(s.requireRoles(service.RoleAdmin))
	s.registerCustomerPortalEndpoints(adminCustomerPortal)
}

func (s *Server) registerCustomerPortalEndpoints(router gin.IRoutes) {
	router.GET("/profile", s.handleCustomerPortalProfile)
	router.GET("/inventory", s.handleCustomerPortalInventory)
	router.GET("/containers", s.handleCustomerPortalContainers)
	router.GET("/containers/:containerNo/lifecycle", s.handleCustomerPortalContainerLifecycle)
	router.GET("/packing-lists", s.handleCustomerPortalPackingLists)
	router.GET("/packing-lists/:id/attachments/:attachmentId/download-url", s.handleGetCustomerPortalPackingListAttachmentDownloadURL)

	router.GET("/picking-orders", s.handleCustomerPortalPickingOrders)
	router.POST("/picking-orders", s.handleCustomerPortalCreatePickingOrder)
	router.POST("/picking-orders/:id/attachments", s.handleUploadCustomerPortalPickingOrderAttachment)
	router.GET("/picking-orders/:id/attachments/:attachmentId/download-url", s.handleGetCustomerPortalPickingOrderAttachmentDownloadURL)
	router.DELETE("/picking-orders/:id/attachments/:attachmentId", s.handleDeleteCustomerPortalPickingOrderAttachment)
}
