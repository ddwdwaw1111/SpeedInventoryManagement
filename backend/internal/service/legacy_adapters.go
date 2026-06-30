package service

import "context"

type LegacyInventoryAdapter struct {
	palletOperations *PalletOperationService
}

func NewLegacyInventoryAdapter(palletOperations *PalletOperationService) *LegacyInventoryAdapter {
	return &LegacyInventoryAdapter{palletOperations: palletOperations}
}

func (a *LegacyInventoryAdapter) CreateAdjustment(ctx context.Context, input CreateInventoryAdjustmentInput) (InventoryAdjustment, error) {
	command := PalletAdjustCommand{
		ReferenceNo: input.AdjustmentNo,
		ReasonCode:  input.ReasonCode,
		OccurredAt:  input.ActualAdjustedAt,
		Notes:       input.Notes,
		Lines:       make([]PalletAdjustLineCommand, 0, len(input.Lines)),
	}
	for _, line := range input.Lines {
		command.Lines = append(command.Lines, PalletAdjustLineCommand{
			CustomerID:     line.CustomerID,
			LocationID:     line.LocationID,
			StorageSection: line.StorageSection,
			ContainerNo:    line.ContainerNo,
			PalletID:       line.PalletID,
			SKUMasterID:    line.SKUMasterID,
			AdjustQty:      line.AdjustQty,
			Note:           line.LineNote,
		})
	}
	return a.palletOperations.createAdjustment(ctx, command)
}

func (a *LegacyInventoryAdapter) CreateTransfer(ctx context.Context, input CreateInventoryTransferInput) (InventoryTransfer, error) {
	command := PalletMoveCommand{
		ReferenceNo: input.TransferNo,
		OccurredAt:  input.ActualTransferredAt,
		Notes:       input.Notes,
		Lines:       make([]PalletMoveLineCommand, 0, len(input.Lines)),
	}
	for _, line := range input.Lines {
		command.Lines = append(command.Lines, PalletMoveLineCommand{
			CustomerID:       line.CustomerID,
			LocationID:       line.LocationID,
			StorageSection:   line.StorageSection,
			ContainerNo:      line.ContainerNo,
			SKUMasterID:      line.SKUMasterID,
			Quantity:         line.Quantity,
			ToLocationID:     line.ToLocationID,
			ToStorageSection: line.ToStorageSection,
			Note:             line.LineNote,
		})
	}
	return a.palletOperations.createTransfer(ctx, command)
}

type inboundDocumentRepository interface {
	CreateInboundDocument(context.Context, CreateInboundDocumentInput) (InboundDocument, error)
}

type LegacyDocumentAdapter struct {
	pickingOrders *PickingOrderService
	inboundRepo   inboundDocumentRepository
}

func NewLegacyDocumentAdapter(pickingOrders *PickingOrderService, inboundRepo inboundDocumentRepository) *LegacyDocumentAdapter {
	return &LegacyDocumentAdapter{pickingOrders: pickingOrders, inboundRepo: inboundRepo}
}

func (a *LegacyDocumentAdapter) CreateInboundDocument(ctx context.Context, input CreateInboundDocumentInput) (InboundDocument, error) {
	return a.inboundRepo.CreateInboundDocument(ctx, input)
}

func (a *LegacyDocumentAdapter) CreateOutboundDocument(ctx context.Context, input CreateOutboundDocumentInput) (OutboundDocument, error) {
	return a.pickingOrders.Create(ctx, input)
}
