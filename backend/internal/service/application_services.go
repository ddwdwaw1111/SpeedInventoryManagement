package service

import (
	"context"
	"errors"
)

var ErrNotImplemented = errors.New("operation is not implemented yet")

type AppServices struct {
	Container         *ContainerService
	InventoryMutation *InventoryMutationService
	PickingOrders     *PickingOrderService
	Delivery          *DeliveryService
	Billing           *BillingService
	LegacyInventory   *LegacyInventoryAdapter
	LegacyDocuments   *LegacyDocumentAdapter
}

func NewAppServices(store *Store) *AppServices {
	inventoryMutation := NewInventoryMutationService(store)
	pickingOrders := NewPickingOrderService(store)
	delivery := NewDeliveryService(store)
	billing := NewBillingService(store)

	return &AppServices{
		Container:         NewContainerService(store),
		InventoryMutation: inventoryMutation,
		PickingOrders:     pickingOrders,
		Delivery:          delivery,
		Billing:           billing,
		LegacyInventory:   NewLegacyInventoryAdapter(inventoryMutation),
		LegacyDocuments:   NewLegacyDocumentAdapter(pickingOrders, store),
	}
}

type inventoryMutationRepository interface {
	CreateInventoryAdjustment(context.Context, CreateInventoryAdjustmentInput) (InventoryAdjustment, error)
	CreateInventoryTransfer(context.Context, CreateInventoryTransferInput) (InventoryTransfer, error)
}

type InventoryMutationService struct {
	repo inventoryMutationRepository
}

func NewInventoryMutationService(repo inventoryMutationRepository) *InventoryMutationService {
	return &InventoryMutationService{repo: repo}
}

func (s *InventoryMutationService) CreateAdjustment(ctx context.Context, input CreateInventoryAdjustmentInput) (InventoryAdjustment, error) {
	return s.repo.CreateInventoryAdjustment(ctx, input)
}

func (s *InventoryMutationService) CreateTransfer(ctx context.Context, input CreateInventoryTransferInput) (InventoryTransfer, error) {
	return s.repo.CreateInventoryTransfer(ctx, input)
}

type pickingOrderRepository interface {
	CreateOutboundDocument(context.Context, CreateOutboundDocumentInput) (OutboundDocument, error)
}

type PickingOrderService struct {
	repo pickingOrderRepository
}

func NewPickingOrderService(repo pickingOrderRepository) *PickingOrderService {
	return &PickingOrderService{repo: repo}
}

func (s *PickingOrderService) Create(ctx context.Context, input CreateOutboundDocumentInput) (OutboundDocument, error) {
	return s.repo.CreateOutboundDocument(ctx, input)
}

type DeliveryCommand struct {
	OutboundDocumentID int64  `json:"outboundDocumentId"`
	CustomerID         int64  `json:"customerId"`
	ContainerNo        string `json:"containerNo"`
	EventType          string `json:"eventType"`
	EventTime          string `json:"eventTime"`
	DriverName         string `json:"driverName"`
	VendorName         string `json:"vendorName"`
	VehicleNo          string `json:"vehicleNo"`
	BOLNumber          string `json:"bolNumber"`
	Notes              string `json:"notes"`
	Visibility         string `json:"visibility"`
	DisplayLabel       string `json:"displayLabel"`
	PublicStatus       string `json:"publicStatus"`
	PublicLabel        string `json:"publicLabel"`
	InternalStatus     string `json:"internalStatus"`
	InternalLabel      string `json:"internalLabel"`
}

type deliveryRepository interface {
	CreateDeliveryEvent(context.Context, CreateDeliveryEventInput) (DeliveryEvent, error)
	ReceiveDeliveryBOL(context.Context, int64, CreateDeliveryEventInput) (DeliveryEvent, error)
}

type DeliveryService struct {
	repo deliveryRepository
}

func NewDeliveryService(repo deliveryRepository) *DeliveryService {
	return &DeliveryService{repo: repo}
}

func (s *DeliveryService) CreateEvent(ctx context.Context, command DeliveryCommand) (DeliveryEvent, error) {
	return s.repo.CreateDeliveryEvent(ctx, CreateDeliveryEventInput{
		OutboundDocumentID: command.OutboundDocumentID,
		CustomerID:         command.CustomerID,
		ContainerNo:        command.ContainerNo,
		EventType:          command.EventType,
		EventTime:          command.EventTime,
		DriverName:         command.DriverName,
		VendorName:         command.VendorName,
		VehicleNo:          command.VehicleNo,
		BOLNumber:          command.BOLNumber,
		Notes:              command.Notes,
		Visibility:         command.Visibility,
		DisplayLabel:       command.DisplayLabel,
		PublicStatus:       command.PublicStatus,
		PublicLabel:        command.PublicLabel,
		InternalStatus:     command.InternalStatus,
		InternalLabel:      command.InternalLabel,
	})
}

func (s *DeliveryService) ReceiveBOL(ctx context.Context, deliveryEventID int64, command DeliveryCommand) (DeliveryEvent, error) {
	return s.repo.ReceiveDeliveryBOL(ctx, deliveryEventID, CreateDeliveryEventInput{
		OutboundDocumentID: command.OutboundDocumentID,
		CustomerID:         command.CustomerID,
		ContainerNo:        command.ContainerNo,
		EventType:          command.EventType,
		EventTime:          command.EventTime,
		DriverName:         command.DriverName,
		VendorName:         command.VendorName,
		VehicleNo:          command.VehicleNo,
		BOLNumber:          command.BOLNumber,
		Notes:              command.Notes,
		Visibility:         command.Visibility,
		DisplayLabel:       command.DisplayLabel,
		PublicStatus:       command.PublicStatus,
		PublicLabel:        command.PublicLabel,
		InternalStatus:     command.InternalStatus,
		InternalLabel:      command.InternalLabel,
	})
}

type BillingService struct {
	store *Store
}

func NewBillingService(store *Store) *BillingService {
	return &BillingService{store: store}
}
