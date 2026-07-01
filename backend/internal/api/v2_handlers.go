package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

type v2PickingOrderResponse struct {
	ID             int64     `json:"id"`
	PackingListNo  string    `json:"packingListNo"`
	OrderRef       string    `json:"orderRef"`
	CustomerID     int64     `json:"customerId"`
	CustomerName   string    `json:"customerName"`
	Status         string    `json:"status"`
	TrackingStatus string    `json:"trackingStatus"`
	TotalLines     int       `json:"totalLines"`
	TotalQty       int       `json:"totalQty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (s *Server) appServices() *service.AppServices {
	if s.app == nil && s.store != nil {
		s.app = service.NewAppServices(s.store)
	}
	return s.app
}

func (s *Server) handleV2ListContainers(c *gin.Context) {
	app := s.appServices()
	if app == nil {
		writeServerError(c, service.ErrNotImplemented)
		return
	}

	limit, ok := parseOptionalPositiveQuery(c, "limit")
	if !ok {
		return
	}
	customerID, ok := parseOptionalPositiveInt64Query(c, "customerId")
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

func (s *Server) handleV2GetContainerLifecycle(c *gin.Context) {
	app := s.appServices()
	if app == nil {
		writeServerError(c, service.ErrNotImplemented)
		return
	}
	containerRef := strings.TrimSpace(c.Param("containerId"))
	if containerID, parseErr := strconv.ParseInt(containerRef, 10, 64); parseErr == nil && containerID > 0 {
		lifecycle, err := app.Container.GetLifecycle(c.Request.Context(), service.GetContainerLifecycleInput{
			ContainerID: containerID,
		})
		if err != nil {
			writeDomainError(c, err)
			return
		}
		writeJSON(c, http.StatusOK, lifecycle)
		return
	}

	customerID, ok := parseRequiredPositiveInt64Query(c, "customerId")
	if !ok {
		return
	}
	lifecycle, err := app.Container.GetLifecycle(c.Request.Context(), service.GetContainerLifecycleInput{
		CustomerID:  customerID,
		ContainerNo: containerRef,
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, lifecycle)
}

func (s *Server) handleV2CreateContainer(c *gin.Context) {
	var input service.CreateContainerInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	container, err := s.appServices().Container.CreateContainer(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, container)
}

func (s *Server) handleV2CustomerPortalContainers(c *gin.Context) {
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

func (s *Server) handleV2CustomerPortalContainerLifecycle(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
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
		ContainerNo: c.Param("containerNo"),
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, customerVisibleContainerLifecycle(lifecycle))
}

func (s *Server) handleV2CreateContainerTrackingEvent(c *gin.Context) {
	var input service.CreateContainerTrackingEventInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	applyContainerRefToTrackingInput(c.Param("containerId"), &input)
	if authPayload, ok := userFromContext(c); ok {
		input.CreatedByUserID = authPayload.User.ID
	}
	event, err := s.appServices().Container.CreateTrackingEvent(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, event)
}

func (s *Server) handleV2CreateContainerPickupAssignment(c *gin.Context) {
	var input service.CreateContainerPickupAssignmentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	applyContainerRefToPickupInput(c.Param("containerId"), &input)
	if authPayload, ok := userFromContext(c); ok {
		input.CreatedByUserID = authPayload.User.ID
	}
	assignment, err := s.appServices().Container.CreatePickupAssignment(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, assignment)
}

func applyContainerRefToTrackingInput(containerRef string, input *service.CreateContainerTrackingEventInput) {
	if containerID, containerNo := parseContainerRef(containerRef); containerID > 0 {
		input.ContainerID = containerID
	} else if containerNo != "" {
		input.ContainerNo = containerNo
	}
}

func applyContainerRefToPickupInput(containerRef string, input *service.CreateContainerPickupAssignmentInput) {
	if containerID, containerNo := parseContainerRef(containerRef); containerID > 0 {
		input.ContainerID = containerID
	} else if containerNo != "" {
		input.ContainerNo = containerNo
	}
}

func parseContainerRef(containerRef string) (int64, string) {
	trimmed := strings.TrimSpace(containerRef)
	if containerID, err := strconv.ParseInt(trimmed, 10, 64); err == nil && containerID > 0 {
		return containerID, ""
	}
	return 0, trimmed
}

func (s *Server) handleV2CreatePickingOrder(c *gin.Context) {
	var input service.CreateOutboundDocumentInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	document, err := s.appServices().PickingOrders.Create(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, v2PickingOrderResponse{
		ID:             document.ID,
		PackingListNo:  document.PackingListNo,
		OrderRef:       document.OrderRef,
		CustomerID:     document.CustomerID,
		CustomerName:   document.CustomerName,
		Status:         document.Status,
		TrackingStatus: document.TrackingStatus,
		TotalLines:     document.TotalLines,
		TotalQty:       document.TotalQty,
		CreatedAt:      document.CreatedAt,
		UpdatedAt:      document.UpdatedAt,
	})
}

func (s *Server) handleV2CreateDeliveryEvent(c *gin.Context) {
	var command service.DeliveryCommand
	if err := bindJSON(c, &command); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.appServices().Delivery.CreateEvent(c.Request.Context(), command)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, result)
}

func (s *Server) handleV2ReceiveBOL(c *gin.Context) {
	deliveryID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	var command service.DeliveryCommand
	if err := bindJSON(c, &command); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.appServices().Delivery.ReceiveBOL(c.Request.Context(), deliveryID, command)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, result)
}

func parseOptionalPositiveQuery(c *gin.Context, key string) (int, bool) {
	value := strings.TrimSpace(c.Query(key))
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		writeError(c, http.StatusBadRequest, key+" must be a positive number")
		return 0, false
	}
	return parsed, true
}

func parseOptionalPositiveInt64Query(c *gin.Context, key string) (int64, bool) {
	value := strings.TrimSpace(c.Query(key))
	if value == "" || strings.EqualFold(value, "all") {
		return 0, true
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		writeError(c, http.StatusBadRequest, key+" must be a positive number")
		return 0, false
	}
	return parsed, true
}

func parseRequiredPositiveInt64Query(c *gin.Context, key string) (int64, bool) {
	value := strings.TrimSpace(c.Query(key))
	if value == "" {
		writeError(c, http.StatusBadRequest, key+" is required")
		return 0, false
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		writeError(c, http.StatusBadRequest, key+" must be a positive number")
		return 0, false
	}
	return parsed, true
}

func customerVisibleContainerLifecycle(lifecycle service.ContainerLifecycle) service.ContainerLifecycle {
	trackingEvents := make([]service.ContainerTrackingEvent, 0, len(lifecycle.TrackingEvents))
	for _, event := range lifecycle.TrackingEvents {
		if !isCustomerVisibleLifecycleEvent(event.Visibility) {
			continue
		}
		event.InternalStatus = ""
		event.InternalLabel = ""
		event.DisplayLabel = strings.TrimSpace(event.PublicLabel)
		event.CreatedByUserID = 0
		event.Notes = ""
		trackingEvents = append(trackingEvents, event)
	}
	lifecycle.TrackingEvents = trackingEvents

	pickupAssignments := make([]service.ContainerPickupAssignment, 0, len(lifecycle.PickupAssignments))
	for _, assignment := range lifecycle.PickupAssignments {
		if !isCustomerVisibleLifecycleEvent(assignment.Visibility) {
			continue
		}
		assignment.AssignmentType = ""
		assignment.DriverName = ""
		assignment.VendorName = ""
		assignment.Phone = ""
		assignment.Cost = 0
		assignment.Notes = ""
		assignment.InternalStatus = ""
		assignment.InternalLabel = ""
		assignment.DisplayLabel = strings.TrimSpace(assignment.PublicLabel)
		assignment.CreatedByUserID = 0
		pickupAssignments = append(pickupAssignments, assignment)
	}
	lifecycle.PickupAssignments = pickupAssignments

	deliveryEvents := make([]service.DeliveryEvent, 0, len(lifecycle.DeliveryEvents))
	for _, event := range lifecycle.DeliveryEvents {
		if !isCustomerVisibleLifecycleEvent(event.Visibility) {
			continue
		}
		event.DriverName = ""
		event.VendorName = ""
		event.VehicleNo = ""
		event.Notes = ""
		event.InternalStatus = ""
		event.InternalLabel = ""
		event.DisplayLabel = strings.TrimSpace(event.PublicLabel)
		deliveryEvents = append(deliveryEvents, event)
	}
	lifecycle.DeliveryEvents = deliveryEvents
	return lifecycle
}

func isCustomerVisibleLifecycleEvent(visibility string) bool {
	switch strings.ToUpper(strings.TrimSpace(visibility)) {
	case "", service.LifecycleEventVisibilityBoth, service.LifecycleEventVisibilityCustomer, "PUBLIC":
		return true
	default:
		return false
	}
}
