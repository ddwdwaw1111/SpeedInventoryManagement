package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

var ErrNotImplemented = errors.New("operation is not implemented yet")

type AppServices struct {
	Container         *ContainerService
	InventoryMutation *InventoryMutationService
	PalletOperations  *PalletOperationService
	PickingOrders     *PickingOrderService
	Delivery          *DeliveryService
	Billing           *BillingService
	LegacyInventory   *LegacyInventoryAdapter
	LegacyDocuments   *LegacyDocumentAdapter
}

func NewAppServices(store *Store) *AppServices {
	inventoryMutation := NewInventoryMutationService(store)
	palletOperations := NewPalletOperationService(inventoryMutation, store)
	pickingOrders := NewPickingOrderService(store)
	delivery := NewDeliveryService(store)
	billing := NewBillingService(store)

	return &AppServices{
		Container:         NewContainerService(store),
		InventoryMutation: inventoryMutation,
		PalletOperations:  palletOperations,
		PickingOrders:     pickingOrders,
		Delivery:          delivery,
		Billing:           billing,
		LegacyInventory:   NewLegacyInventoryAdapter(palletOperations),
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

type PalletAdjustCommand struct {
	ReferenceNo string                    `json:"referenceNo"`
	ReasonCode  string                    `json:"reasonCode"`
	OccurredAt  string                    `json:"occurredAt"`
	Notes       string                    `json:"notes"`
	Lines       []PalletAdjustLineCommand `json:"lines"`
}

type PalletAdjustLineCommand struct {
	CustomerID     int64  `json:"customerId"`
	LocationID     int64  `json:"locationId"`
	StorageSection string `json:"storageSection"`
	ContainerNo    string `json:"containerNo"`
	PalletID       int64  `json:"palletId"`
	SKUMasterID    int64  `json:"skuMasterId"`
	AdjustQty      int    `json:"adjustQty"`
	Note           string `json:"note"`
}

type PalletMoveCommand struct {
	ReferenceNo string                  `json:"referenceNo"`
	OccurredAt  string                  `json:"occurredAt"`
	Notes       string                  `json:"notes"`
	Lines       []PalletMoveLineCommand `json:"lines"`
}

type PalletMoveLineCommand struct {
	CustomerID       int64  `json:"customerId"`
	LocationID       int64  `json:"locationId"`
	StorageSection   string `json:"storageSection"`
	ContainerNo      string `json:"containerNo"`
	PalletID         int64  `json:"palletId"`
	SKUMasterID      int64  `json:"skuMasterId"`
	Quantity         int    `json:"quantity"`
	ToLocationID     int64  `json:"toLocationId"`
	ToStorageSection string `json:"toStorageSection"`
	Note             string `json:"note"`
}

type PalletReworkCommand struct {
	ReferenceNo     string  `json:"referenceNo"`
	CustomerID      int64   `json:"customerId"`
	ContainerNo     string  `json:"containerNo"`
	EventType       string  `json:"eventType"`
	EventTime       string  `json:"eventTime"`
	PalletIDs       []int64 `json:"palletIds"`
	SourcePalletIDs []int64 `json:"sourcePalletIds"`
	TargetPalletIDs []int64 `json:"targetPalletIds"`
	Notes           string  `json:"notes"`
	Visibility      string  `json:"visibility"`
	DisplayLabel    string  `json:"displayLabel"`
	PublicStatus    string  `json:"publicStatus"`
	PublicLabel     string  `json:"publicLabel"`
	InternalStatus  string  `json:"internalStatus"`
	InternalLabel   string  `json:"internalLabel"`
}

type PalletOperationResult struct {
	OperationType string `json:"operationType"`
	ReferenceNo   string `json:"referenceNo"`
	RecordID      int64  `json:"recordId"`
	Status        string `json:"status"`
	TotalLines    int    `json:"totalLines"`
	TotalQty      int    `json:"totalQty"`
}

type PalletOperationService struct {
	inventoryMutation *InventoryMutationService
	reworkRepo        palletReworkRepository
}

type palletReworkRepository interface {
	CreatePalletReworkEvent(context.Context, CreatePalletReworkEventInput) (PalletReworkEvent, error)
}

func NewPalletOperationService(inventoryMutation *InventoryMutationService, reworkRepo palletReworkRepository) *PalletOperationService {
	return &PalletOperationService{inventoryMutation: inventoryMutation, reworkRepo: reworkRepo}
}

func (s *PalletOperationService) Adjust(ctx context.Context, command PalletAdjustCommand) (PalletOperationResult, error) {
	adjustment, err := s.createAdjustment(ctx, command)
	if err != nil {
		return PalletOperationResult{}, err
	}
	return PalletOperationResult{
		OperationType: "PALLET_ADJUST",
		ReferenceNo:   adjustment.AdjustmentNo,
		RecordID:      adjustment.ID,
		Status:        adjustment.Status,
		TotalLines:    adjustment.TotalLines,
		TotalQty:      adjustment.TotalAdjustQty,
	}, nil
}

func (s *PalletOperationService) createAdjustment(ctx context.Context, command PalletAdjustCommand) (InventoryAdjustment, error) {
	lines := make([]CreateInventoryAdjustmentLineInput, 0, len(command.Lines))
	for _, line := range command.Lines {
		lines = append(lines, CreateInventoryAdjustmentLineInput{
			CustomerID:     line.CustomerID,
			LocationID:     line.LocationID,
			StorageSection: line.StorageSection,
			ContainerNo:    line.ContainerNo,
			PalletID:       line.PalletID,
			SKUMasterID:    line.SKUMasterID,
			AdjustQty:      line.AdjustQty,
			LineNote:       line.Note,
		})
	}
	return s.inventoryMutation.CreateAdjustment(ctx, CreateInventoryAdjustmentInput{
		AdjustmentNo:     command.ReferenceNo,
		ReasonCode:       command.ReasonCode,
		ActualAdjustedAt: command.OccurredAt,
		Notes:            command.Notes,
		Lines:            lines,
	})
}

func (s *PalletOperationService) Move(ctx context.Context, command PalletMoveCommand) (PalletOperationResult, error) {
	transfer, err := s.createTransfer(ctx, command)
	if err != nil {
		return PalletOperationResult{}, err
	}
	return PalletOperationResult{
		OperationType: "PALLET_MOVE",
		ReferenceNo:   transfer.TransferNo,
		RecordID:      transfer.ID,
		Status:        transfer.Status,
		TotalLines:    transfer.TotalLines,
		TotalQty:      transfer.TotalQty,
	}, nil
}

func (s *PalletOperationService) createTransfer(ctx context.Context, command PalletMoveCommand) (InventoryTransfer, error) {
	lines := make([]CreateInventoryTransferLineInput, 0, len(command.Lines))
	for _, line := range command.Lines {
		lines = append(lines, CreateInventoryTransferLineInput{
			CustomerID:       line.CustomerID,
			LocationID:       line.LocationID,
			StorageSection:   line.StorageSection,
			ContainerNo:      line.ContainerNo,
			PalletID:         line.PalletID,
			SKUMasterID:      line.SKUMasterID,
			Quantity:         line.Quantity,
			ToLocationID:     line.ToLocationID,
			ToStorageSection: line.ToStorageSection,
			LineNote:         line.Note,
		})
	}
	return s.inventoryMutation.CreateTransfer(ctx, CreateInventoryTransferInput{
		TransferNo:          command.ReferenceNo,
		ActualTransferredAt: command.OccurredAt,
		Notes:               command.Notes,
		Lines:               lines,
	})
}

func (s *PalletOperationService) Rework(ctx context.Context, command PalletReworkCommand) (PalletOperationResult, error) {
	if err := validatePalletReworkAnnotationCommand(command); err != nil {
		return PalletOperationResult{}, err
	}
	event, err := s.reworkRepo.CreatePalletReworkEvent(ctx, CreatePalletReworkEventInput{
		ReferenceNo:     command.ReferenceNo,
		CustomerID:      command.CustomerID,
		ContainerNo:     command.ContainerNo,
		EventType:       command.EventType,
		EventTime:       command.EventTime,
		Notes:           command.Notes,
		Visibility:      command.Visibility,
		DisplayLabel:    command.DisplayLabel,
		PublicStatus:    command.PublicStatus,
		PublicLabel:     command.PublicLabel,
		InternalStatus:  command.InternalStatus,
		InternalLabel:   command.InternalLabel,
		PalletIDs:       command.PalletIDs,
		SourcePalletIDs: command.SourcePalletIDs,
		TargetPalletIDs: command.TargetPalletIDs,
	})
	if err != nil {
		return PalletOperationResult{}, err
	}
	return PalletOperationResult{
		OperationType: "PALLET_REWORK_EVENT",
		ReferenceNo:   event.ReferenceNo,
		RecordID:      event.ID,
		Status:        "RECORDED",
		TotalLines:    len(event.Pallets),
	}, nil
}

func validatePalletReworkAnnotationCommand(command PalletReworkCommand) error {
	if len(command.SourcePalletIDs) > 0 || len(command.TargetPalletIDs) > 0 {
		return fmt.Errorf("%w: quantity-aware pallet split/merge is not implemented", ErrNotImplemented)
	}
	switch strings.ToUpper(strings.TrimSpace(command.EventType)) {
	case "SPLIT", "MERGE", "CONSOLIDATE":
		return fmt.Errorf("%w: quantity-aware pallet %s is not implemented", ErrNotImplemented, strings.ToLower(strings.TrimSpace(command.EventType)))
	default:
		return nil
	}
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
