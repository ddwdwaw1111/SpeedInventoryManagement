package api

import (
	"testing"

	"speed-inventory-management/backend/internal/service"
)

func TestCustomerVisibleContainerLifecycleSanitizesInternalFields(t *testing.T) {
	lifecycle := service.ContainerLifecycle{
		PackingLists: []service.InboundDocument{
			{
				DocumentNote: "internal inbound note",
				Lines: []service.InboundDocumentLine{
					{
						SKU:               "SKU-1",
						ExpectedQty:       12,
						Pallets:           2,
						PalletsDetailCtns: "2*6",
						LineNote:          "internal inbound line note",
					},
				},
			},
		},
		PickingOrders: []service.OutboundDocument{
			{
				DocumentNote: "internal outbound note",
				Lines: []service.OutboundDocumentLine{
					{
						SKU:               "SKU-1",
						Quantity:          6,
						Pallets:           1,
						PalletsDetailCtns: "1*6",
						LineNote:          "internal outbound line note",
						PickAllocations: []service.OutboundPickAllocation{
							{ContainerID: 10, ContainerNo: "CONT-1", AllocatedQty: 6, Pallets: 1},
						},
					},
				},
			},
		},
		LifecycleEvents: []service.ContainerLifecycleEvent{
			{
				ContainerID:   10,
				ContainerNo:   "CONT-1",
				PackingListNo: "PL-1",
				OrderRef:      "SO-1",
				Pallets:       1,
				DocumentNote:  "internal lifecycle note",
				Reason:        "internal reason",
			},
		},
		TrackingEvents: []service.ContainerTrackingEvent{
			{
				ID:              1,
				Visibility:      service.LifecycleEventVisibilityCustomer,
				PublicLabel:     "Arrived",
				InternalStatus:  "internal status",
				InternalLabel:   "internal label",
				Notes:           "internal tracking note",
				CreatedByUserID: 7,
			},
			{ID: 2, Visibility: service.LifecycleEventVisibilityInternal},
		},
		PickupAssignments: []service.ContainerPickupAssignment{
			{
				ID:              3,
				Visibility:      service.LifecycleEventVisibilityBoth,
				PublicLabel:     "Pickup scheduled",
				AssignmentType:  "drayage",
				DriverName:      "Driver",
				VendorName:      "Vendor",
				Phone:           "555-0000",
				Cost:            120,
				Notes:           "internal pickup note",
				InternalStatus:  "internal status",
				InternalLabel:   "internal label",
				CreatedByUserID: 8,
			},
			{ID: 4, Visibility: service.LifecycleEventVisibilityInternal},
		},
		DeliveryEvents: []service.DeliveryEvent{
			{
				ID:             5,
				Visibility:     "PUBLIC",
				PublicLabel:    "Delivered",
				DriverName:     "Driver",
				VendorName:     "Vendor",
				VehicleNo:      "TRUCK-1",
				Notes:          "internal delivery note",
				InternalStatus: "internal status",
				InternalLabel:  "internal label",
			},
			{ID: 6, Visibility: service.LifecycleEventVisibilityInternal},
		},
	}

	visible := customerVisibleContainerLifecycle(lifecycle)

	if got := visible.PackingLists[0].DocumentNote; got != "" {
		t.Fatalf("expected inbound document note to be hidden, got %q", got)
	}
	if got := visible.PackingLists[0].Lines[0].LineNote; got != "" {
		t.Fatalf("expected inbound line note to be hidden, got %q", got)
	}
	if got := visible.PackingLists[0].Lines[0].PalletsDetailCtns; got != "2*6" {
		t.Fatalf("expected inbound pallet detail to remain visible, got %q", got)
	}
	if got := visible.PickingOrders[0].DocumentNote; got != "" {
		t.Fatalf("expected outbound document note to be hidden, got %q", got)
	}
	if got := visible.PickingOrders[0].Lines[0].LineNote; got != "" {
		t.Fatalf("expected outbound line note to be hidden, got %q", got)
	}
	if got := visible.PickingOrders[0].Lines[0].PickAllocations[0].ContainerID; got != 10 {
		t.Fatalf("expected pick allocation container id to remain visible, got %d", got)
	}
	if got := visible.LifecycleEvents[0].DocumentNote; got != "" {
		t.Fatalf("expected lifecycle document note to be hidden, got %q", got)
	}
	if got := visible.LifecycleEvents[0].Reason; got != "" {
		t.Fatalf("expected lifecycle reason to be hidden, got %q", got)
	}
	if got := visible.LifecycleEvents[0].PackingListNo; got != "PL-1" {
		t.Fatalf("expected lifecycle document ref to remain visible, got %q", got)
	}

	if got := len(visible.TrackingEvents); got != 1 {
		t.Fatalf("expected only customer-visible tracking events, got %d", got)
	}
	if got := visible.TrackingEvents[0].DisplayLabel; got != "Arrived" {
		t.Fatalf("expected tracking display label from public label, got %q", got)
	}
	if visible.TrackingEvents[0].Notes != "" || visible.TrackingEvents[0].InternalStatus != "" || visible.TrackingEvents[0].CreatedByUserID != 0 {
		t.Fatalf("expected tracking internal fields to be hidden, got %#v", visible.TrackingEvents[0])
	}

	if got := len(visible.PickupAssignments); got != 1 {
		t.Fatalf("expected only customer-visible pickup assignments, got %d", got)
	}
	if visible.PickupAssignments[0].DriverName != "" || visible.PickupAssignments[0].VendorName != "" || visible.PickupAssignments[0].Cost != 0 {
		t.Fatalf("expected pickup internal fields to be hidden, got %#v", visible.PickupAssignments[0])
	}

	if got := len(visible.DeliveryEvents); got != 1 {
		t.Fatalf("expected only customer-visible delivery events, got %d", got)
	}
	if visible.DeliveryEvents[0].DriverName != "" || visible.DeliveryEvents[0].VehicleNo != "" || visible.DeliveryEvents[0].InternalLabel != "" {
		t.Fatalf("expected delivery internal fields to be hidden, got %#v", visible.DeliveryEvents[0])
	}
}
