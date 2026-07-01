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

func TestLegacyInventoryAdapterUsesInventoryMutationOnce(t *testing.T) {
	repo := &recordingInventoryMutationRepo{}
	adapter := NewLegacyInventoryAdapter(NewInventoryMutationService(repo))

	adjustment, err := adapter.CreateAdjustment(context.Background(), CreateInventoryAdjustmentInput{
		AdjustmentNo: "ADJ-LEGACY",
		ReasonCode:   "COUNT",
		Lines: []CreateInventoryAdjustmentLineInput{{
			CustomerID:  3,
			LocationID:  4,
			ContainerNo: "CONT-LEGACY",
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
		t.Fatalf("expected legacy adapter to perform one inventory mutation write, got %d", len(repo.adjustmentInputs))
	}
	if repo.adjustmentInputs[0].Lines[0].ContainerNo != "CONT-LEGACY" {
		t.Fatalf("expected legacy adapter to preserve container number, got %#v", repo.adjustmentInputs[0].Lines[0])
	}
}

func TestDeliveryServiceMapsBOLCommand(t *testing.T) {
	repo := &recordingDeliveryRepo{}
	service := NewDeliveryService(repo)

	event, err := service.ReceiveBOL(context.Background(), 99, DeliveryCommand{
		ContainerID:  42,
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
	if repo.bolInputs[0].ContainerID != 42 || repo.bolInputs[0].ContainerNo != "CONT-1" || repo.bolInputs[0].EventTime != "2026-06-15T12:00:00Z" {
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

	if !outboundDocumentReferencesContainer(document, 0, normalizeContainerNo(" cont-a ")) {
		t.Fatalf("expected outbound document to reference normalized container")
	}
}

func TestOutboundDocumentReferencesContainerPrefersContainerID(t *testing.T) {
	document := OutboundDocument{Lines: []OutboundDocumentLine{{
		PickAllocations: []OutboundPickAllocation{{ContainerID: 8, ContainerNo: "CONT-A"}},
	}}}

	if outboundDocumentReferencesContainer(document, 7, "CONT-A") {
		t.Fatalf("expected non-matching container id to override matching container number")
	}
	if !outboundDocumentReferencesContainer(document, 8, "CONT-RENAMED") {
		t.Fatalf("expected matching container id to survive container number rename")
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

func TestBuildContainerSummariesGroupsRenamedContainerByID(t *testing.T) {
	summaries := buildContainerSummaries([]Container{{
		ID:           42,
		CustomerID:   7,
		CustomerName: "Customer",
		ContainerNo:  "CONT-NEW",
	}}, []InboundDocument{{
		ID:               1,
		ContainerID:      42,
		CustomerID:       7,
		CustomerName:     "Customer",
		ContainerNo:      "CONT-OLD",
		TotalExpectedQty: 10,
	}}, []Item{{
		ContainerID:  42,
		CustomerID:   7,
		CustomerName: "Customer",
		ContainerNo:  "CONT-OLD",
		Quantity:     8,
	}}, nil)

	summary, ok := summaries[containerSummaryKey(7, "CONT-NEW")]
	if !ok {
		t.Fatalf("expected renamed container data to be keyed by current container number")
	}
	if summary.ContainerID != 42 || summary.TotalExpectedQty != 10 || summary.CurrentQty != 8 {
		t.Fatalf("expected data to be grouped by container id, got %#v", summary)
	}
	if _, ok := summaries[containerSummaryKey(7, "CONT-OLD")]; ok {
		t.Fatalf("expected old container number to be folded into current container")
	}
}
