package service

import "context"

type LegacyInventoryAdapter struct {
	inventoryMutation *InventoryMutationService
}

func NewLegacyInventoryAdapter(inventoryMutation *InventoryMutationService) *LegacyInventoryAdapter {
	return &LegacyInventoryAdapter{inventoryMutation: inventoryMutation}
}

func (a *LegacyInventoryAdapter) CreateAdjustment(ctx context.Context, input CreateInventoryAdjustmentInput) (InventoryAdjustment, error) {
	return a.inventoryMutation.CreateAdjustment(ctx, input)
}

func (a *LegacyInventoryAdapter) CreateTransfer(ctx context.Context, input CreateInventoryTransferInput) (InventoryTransfer, error) {
	return a.inventoryMutation.CreateTransfer(ctx, input)
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
