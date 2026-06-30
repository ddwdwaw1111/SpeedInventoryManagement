package service

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

type recordingInventoryMutationRepo struct {
	adjustmentInputs []CreateInventoryAdjustmentInput
	transferInputs   []CreateInventoryTransferInput
}

func (r *recordingInventoryMutationRepo) CreateInventoryAdjustment(_ context.Context, input CreateInventoryAdjustmentInput) (InventoryAdjustment, error) {
	r.adjustmentInputs = append(r.adjustmentInputs, input)
	totalQty := 0
	for _, line := range input.Lines {
		totalQty += line.AdjustQty
	}
	return InventoryAdjustment{
		ID:             int64(len(r.adjustmentInputs)),
		AdjustmentNo:   firstNonEmpty(input.AdjustmentNo, "ADJ-TEST"),
		ReasonCode:     input.ReasonCode,
		Status:         "POSTED",
		TotalLines:     len(input.Lines),
		TotalAdjustQty: totalQty,
	}, nil
}

func (r *recordingInventoryMutationRepo) CreateInventoryTransfer(_ context.Context, input CreateInventoryTransferInput) (InventoryTransfer, error) {
	r.transferInputs = append(r.transferInputs, input)
	totalQty := 0
	for _, line := range input.Lines {
		totalQty += line.Quantity
	}
	return InventoryTransfer{
		ID:         int64(len(r.transferInputs)),
		TransferNo: firstNonEmpty(input.TransferNo, "TR-TEST"),
		Status:     "POSTED",
		TotalLines: len(input.Lines),
		TotalQty:   totalQty,
	}, nil
}

type recordingPalletReworkRepo struct {
	inputs []CreatePalletReworkEventInput
}

func (r *recordingPalletReworkRepo) CreatePalletReworkEvent(_ context.Context, input CreatePalletReworkEventInput) (PalletReworkEvent, error) {
	r.inputs = append(r.inputs, input)
	pallets := make([]PalletReworkEventPallet, 0, len(input.PalletIDs)+len(input.SourcePalletIDs)+len(input.TargetPalletIDs))
	for _, palletID := range input.PalletIDs {
		pallets = append(pallets, PalletReworkEventPallet{PalletID: palletID, Role: PalletReworkRoleRelated})
	}
	for _, palletID := range input.SourcePalletIDs {
		pallets = append(pallets, PalletReworkEventPallet{PalletID: palletID, Role: PalletReworkRoleSource})
	}
	for _, palletID := range input.TargetPalletIDs {
		pallets = append(pallets, PalletReworkEventPallet{PalletID: palletID, Role: PalletReworkRoleTarget})
	}
	return PalletReworkEvent{
		ID:          int64(len(r.inputs)),
		ReferenceNo: input.ReferenceNo,
		CustomerID:  input.CustomerID,
		ContainerNo: input.ContainerNo,
		EventType:   firstNonEmpty(input.EventType, "REWORK"),
		Pallets:     pallets,
	}, nil
}

type recordingDeliveryRepo struct {
	createInputs []CreateDeliveryEventInput
	bolInputs    []CreateDeliveryEventInput
}

func (r *recordingDeliveryRepo) CreateDeliveryEvent(_ context.Context, input CreateDeliveryEventInput) (DeliveryEvent, error) {
	r.createInputs = append(r.createInputs, input)
	return DeliveryEvent{ID: int64(len(r.createInputs)), EventType: firstNonEmpty(input.EventType, DeliveryEventDispatched), BOLNumber: input.BOLNumber}, nil
}

func (r *recordingDeliveryRepo) ReceiveDeliveryBOL(_ context.Context, deliveryEventID int64, input CreateDeliveryEventInput) (DeliveryEvent, error) {
	r.bolInputs = append(r.bolInputs, input)
	return DeliveryEvent{ID: deliveryEventID, EventType: DeliveryEventBOLReceived, BOLNumber: input.BOLNumber}, nil
}

type failingScanner struct {
	err error
}

func (s failingScanner) Scan(...any) error {
	return s.err
}

func TestPalletOperationAdjustMapsV2Command(t *testing.T) {
	repo := &recordingInventoryMutationRepo{}
	service := NewPalletOperationService(NewInventoryMutationService(repo), &recordingPalletReworkRepo{})

	result, err := service.Adjust(context.Background(), PalletAdjustCommand{
		ReferenceNo: "ADJ-100",
		ReasonCode:  "DAMAGE",
		OccurredAt:  "2026-06-15T10:00:00Z",
		Notes:       "broken case",
		Lines: []PalletAdjustLineCommand{{
			CustomerID:     7,
			LocationID:     2,
			StorageSection: "A1",
			ContainerNo:    "CONT-1",
			PalletID:       55,
			SKUMasterID:    8,
			AdjustQty:      -3,
			Note:           "short",
		}},
	})
	if err != nil {
		t.Fatalf("expected adjust command to succeed, got %v", err)
	}
	if result.OperationType != "PALLET_ADJUST" || result.ReferenceNo != "ADJ-100" || result.TotalQty != -3 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(repo.adjustmentInputs) != 1 {
		t.Fatalf("expected one adjustment write, got %d", len(repo.adjustmentInputs))
	}
	got := repo.adjustmentInputs[0]
	if got.AdjustmentNo != "ADJ-100" || got.ReasonCode != "DAMAGE" || got.ActualAdjustedAt != "2026-06-15T10:00:00Z" {
		t.Fatalf("unexpected adjustment header: %#v", got)
	}
	if len(got.Lines) != 1 {
		t.Fatalf("expected one adjustment line, got %d", len(got.Lines))
	}
	line := got.Lines[0]
	if line.ContainerNo != "CONT-1" || line.PalletID != 55 || line.SKUMasterID != 8 || line.AdjustQty != -3 || line.LineNote != "short" {
		t.Fatalf("unexpected adjustment line: %#v", line)
	}
}

func TestLegacyInventoryAdapterUsesPalletOperationsOnce(t *testing.T) {
	repo := &recordingInventoryMutationRepo{}
	palletOperations := NewPalletOperationService(NewInventoryMutationService(repo), &recordingPalletReworkRepo{})
	adapter := NewLegacyInventoryAdapter(palletOperations)

	adjustment, err := adapter.CreateAdjustment(context.Background(), CreateInventoryAdjustmentInput{
		AdjustmentNo: "ADJ-LEGACY",
		ReasonCode:   "COUNT",
		Lines: []CreateInventoryAdjustmentLineInput{{
			CustomerID:  3,
			LocationID:  4,
			ContainerNo: "CONT-LEGACY",
			PalletID:    9,
			SKUMasterID: 10,
			AdjustQty:   2,
			LineNote:    "legacy call",
		}},
	})
	if err != nil {
		t.Fatalf("expected legacy adjustment adapter to succeed, got %v", err)
	}
	if adjustment.AdjustmentNo != "ADJ-LEGACY" {
		t.Fatalf("expected legacy response to preserve adjustment number, got %q", adjustment.AdjustmentNo)
	}
	if len(repo.adjustmentInputs) != 1 {
		t.Fatalf("expected legacy adapter to perform one write through the new facade, got %d", len(repo.adjustmentInputs))
	}
	if repo.adjustmentInputs[0].Lines[0].ContainerNo != "CONT-LEGACY" {
		t.Fatalf("expected legacy adapter to preserve container number, got %#v", repo.adjustmentInputs[0].Lines[0])
	}
}

func TestPalletReworkMapsV2Command(t *testing.T) {
	repo := &recordingInventoryMutationRepo{}
	reworkRepo := &recordingPalletReworkRepo{}
	service := NewPalletOperationService(NewInventoryMutationService(repo), reworkRepo)

	result, err := service.Rework(context.Background(), PalletReworkCommand{
		ReferenceNo: "RW-100",
		CustomerID:  7,
		ContainerNo: "CONT-1",
		EventType:   "LOAD_CONSOLIDATION_NOTE",
		PalletIDs:   []int64{10, 11, 12},
		Notes:       "load consolidation",
	})
	if err != nil {
		t.Fatalf("expected rework command to succeed, got %v", err)
	}
	if result.OperationType != "PALLET_REWORK_EVENT" || result.Status != "RECORDED" || result.RecordID != 1 || result.TotalLines != 3 {
		t.Fatalf("unexpected rework result: %#v", result)
	}
	if len(reworkRepo.inputs) != 1 {
		t.Fatalf("expected one rework write, got %d", len(reworkRepo.inputs))
	}
	got := reworkRepo.inputs[0]
	if got.ReferenceNo != "RW-100" || got.ContainerNo != "CONT-1" || len(got.PalletIDs) != 3 || len(got.SourcePalletIDs) != 0 || len(got.TargetPalletIDs) != 0 {
		t.Fatalf("unexpected rework input: %#v", got)
	}
}

func TestPalletReworkRejectsQuantityAwareShapeUntilImplemented(t *testing.T) {
	reworkRepo := &recordingPalletReworkRepo{}
	service := NewPalletOperationService(NewInventoryMutationService(&recordingInventoryMutationRepo{}), reworkRepo)

	_, err := service.Rework(context.Background(), PalletReworkCommand{
		ReferenceNo:     "RW-SPLIT",
		CustomerID:      7,
		ContainerNo:     "CONT-1",
		EventType:       "SPLIT",
		SourcePalletIDs: []int64{10},
		TargetPalletIDs: []int64{11, 12},
	})
	if !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("expected ErrNotImplemented for quantity-aware rework, got %v", err)
	}
	if len(reworkRepo.inputs) != 0 {
		t.Fatalf("expected no rework event to be written, got %d", len(reworkRepo.inputs))
	}
}

func TestDeliveryServiceMapsBOLCommand(t *testing.T) {
	repo := &recordingDeliveryRepo{}
	service := NewDeliveryService(repo)

	event, err := service.ReceiveBOL(context.Background(), 99, DeliveryCommand{
		BOLNumber:   "BOL-123",
		ContainerNo: "CONT-1",
		EventTime:   "2026-06-15T12:00:00Z",
	})
	if err != nil {
		t.Fatalf("expected BOL command to succeed, got %v", err)
	}
	if event.ID != 99 || event.EventType != DeliveryEventBOLReceived || event.BOLNumber != "BOL-123" {
		t.Fatalf("unexpected BOL event: %#v", event)
	}
	if len(repo.bolInputs) != 1 {
		t.Fatalf("expected one BOL write, got %d", len(repo.bolInputs))
	}
	if repo.bolInputs[0].ContainerNo != "CONT-1" || repo.bolInputs[0].EventTime != "2026-06-15T12:00:00Z" {
		t.Fatalf("unexpected BOL input: %#v", repo.bolInputs[0])
	}
}

func TestScanDeliveryEventMapsNoRowsToNotFound(t *testing.T) {
	_, err := scanDeliveryEvent(failingScanner{err: sql.ErrNoRows})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestOutboundDocumentContainerNosDeduplicatesAndNormalizes(t *testing.T) {
	document := OutboundDocument{Lines: []OutboundDocumentLine{
		{PickAllocations: []OutboundPickAllocation{
			{ContainerNo: " cont-a "},
			{ContainerNo: "CONT-A"},
		}},
		{PickAllocations: []OutboundPickAllocation{
			{ContainerNo: "cont-b"},
			{ContainerNo: ""},
		}},
	}}

	containerNos := outboundDocumentContainerNos(document)
	if len(containerNos) != 2 || containerNos[0] != "CONT-A" || containerNos[1] != "CONT-B" {
		t.Fatalf("unexpected container numbers: %#v", containerNos)
	}
}

func TestOutboundDocumentReferencesContainerNormalizesInput(t *testing.T) {
	document := OutboundDocument{Lines: []OutboundDocumentLine{{
		PickAllocations: []OutboundPickAllocation{{ContainerNo: "CONT-A"}},
	}}}

	if !outboundDocumentReferencesContainer(document, normalizeContainerNo(" cont-a ")) {
		t.Fatalf("expected outbound document to reference normalized container")
	}
}

func TestBuildContainerSummariesIncludesContainerOnlyRecords(t *testing.T) {
	summaries := buildContainerSummaries([]Container{{
		ID:           1,
		CustomerID:   7,
		CustomerName: "Customer",
		ContainerNo:  "CONT-ONLY",
		Status:       ContainerStatusPickupAssigned,
	}}, nil, nil, nil)

	summary, ok := summaries[containerSummaryKey(7, "CONT-ONLY")]
	if !ok {
		t.Fatalf("expected container-only record to appear in summaries")
	}
	if summary.Status != ContainerStatusPickupAssigned {
		t.Fatalf("expected explicit container status to be preserved, got %q", summary.Status)
	}
}

func TestBuildContainerSummariesKeepsDuplicateContainerNumbersScopedByCustomer(t *testing.T) {
	summaries := buildContainerSummaries(nil, []InboundDocument{
		{
			ID:               1,
			CustomerID:       7,
			CustomerName:     "Customer A",
			ContainerNo:      "CONT-DUP",
			TotalExpectedQty: 10,
		},
		{
			ID:               2,
			CustomerID:       8,
			CustomerName:     "Customer B",
			ContainerNo:      "CONT-DUP",
			TotalExpectedQty: 20,
		},
	}, nil, nil)

	first := summaries[containerSummaryKey(7, "CONT-DUP")]
	second := summaries[containerSummaryKey(8, "CONT-DUP")]
	if len(summaries) != 2 || first.TotalExpectedQty != 10 || second.TotalExpectedQty != 20 {
		t.Fatalf("expected duplicate container numbers to stay separated by customer, got %#v", summaries)
	}
}
