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
	router.GET("/packing-lists", s.handleCustomerPortalPackingLists)
	router.POST("/packing-lists", s.handleCustomerPortalCreatePackingList)
	router.POST("/packing-lists/:id/attachments", s.handleUploadCustomerPortalPackingListAttachment)
	router.GET("/packing-lists/:id/attachments/:attachmentId/download-url", s.handleGetCustomerPortalPackingListAttachmentDownloadURL)
	router.DELETE("/packing-lists/:id/attachments/:attachmentId", s.handleDeleteCustomerPortalPackingListAttachment)
}
