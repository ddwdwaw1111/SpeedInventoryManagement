package api

import (
	"testing"
	"time"

	"speed-inventory-management/backend/internal/service"
)

func TestBuildCustomerPortalContainerSummariesNetsReversals(t *testing.T) {
	now := time.Date(2026, 6, 14, 10, 0, 0, 0, time.UTC)

	summaries := buildCustomerPortalContainerSummaries(
		[]service.InboundDocument{{
			ID:               1,
			CustomerID:       7,
			CustomerName:     "Customer",
			LocationName:     "NJ",
			ContainerNo:      "CNT-REV",
			TotalExpectedQty: 10,
			TotalReceivedQty: 10,
			CreatedAt:        now,
			UpdatedAt:        now,
		}},
		[]service.Item{{
			CustomerID:   7,
			CustomerName: "Customer",
			LocationName: "NJ",
			ContainerNo:  "CNT-REV",
			Quantity:     10,
			AvailableQty: 10,
			Pallets:      3,
			UpdatedAt:    now,
		}},
		[]service.ContainerLifecycleEvent{
			{
				ID:                 1,
				CustomerID:         7,
				CustomerName:       "Customer",
				LocationName:       "NJ",
				ContainerNo:        "CNT-REV",
				EventType:          service.StockLedgerEventShip,
				EventTime:          now,
				QuantityDelta:      -10,
				SourceDocumentType: service.StockLedgerSourceOutbound,
				SourceDocumentID:   11,
				PackingListNo:      "PO-11",
				CreatedAt:          now,
			},
			{
				ID:                 2,
				CustomerID:         7,
				CustomerName:       "Customer",
				LocationName:       "NJ",
				ContainerNo:        "CNT-REV",
				EventType:          service.StockLedgerEventReversal,
				EventTime:          now,
				QuantityDelta:      10,
				SourceDocumentType: service.StockLedgerSourceOutbound,
				SourceDocumentID:   11,
				PackingListNo:      "PO-11",
				CreatedAt:          now,
			},
		},
	)

	summary := summaries["CNT-REV"]
	if summary.ShippedQty != 0 {
		t.Fatalf("expected reversed shipment to net shipped qty to 0, got %d", summary.ShippedQty)
	}
	if summary.Status != "IN_STOCK" {
		t.Fatalf("expected reversed shipment with current stock to remain in stock, got %q", summary.Status)
	}
	if summary.PalletCount != 3 {
		t.Fatalf("expected pallet count from aggregate inventory, got %d", summary.PalletCount)
	}
}

func TestBuildCustomerPortalContainerSummariesCountsTransferDocumentOnce(t *testing.T) {
	now := time.Date(2026, 6, 14, 10, 0, 0, 0, time.UTC)

	summaries := buildCustomerPortalContainerSummaries(nil, nil, []service.ContainerLifecycleEvent{
		{
			ID:                 20,
			CustomerID:         7,
			CustomerName:       "Customer",
			LocationName:       "NJ",
			ContainerNo:        "CNT-MOVE",
			EventType:          service.StockLedgerEventTransferOut,
			EventTime:          now,
			QuantityDelta:      -4,
			SourceDocumentType: service.StockLedgerSourceTransfer,
			SourceDocumentID:   12,
			SourceLineID:       120,
			CreatedAt:          now,
		},
		{
			ID:                 21,
			CustomerID:         7,
			CustomerName:       "Customer",
			LocationName:       "LA",
			ContainerNo:        "CNT-MOVE",
			EventType:          service.StockLedgerEventTransferIn,
			EventTime:          now,
			QuantityDelta:      4,
			SourceDocumentType: service.StockLedgerSourceTransfer,
			SourceDocumentID:   12,
			SourceLineID:       120,
			CreatedAt:          now,
		},
	})

	if got := summaries["CNT-MOVE"].TransferCount; got != 1 {
		t.Fatalf("expected transfer out/in pair from one transfer document to count once, got %d", got)
	}
}

func TestBuildCustomerPortalContainerSummariesSeparatesDepletedFromShipped(t *testing.T) {
	now := time.Date(2026, 6, 14, 10, 0, 0, 0, time.UTC)

	summaries := buildCustomerPortalContainerSummaries(
		[]service.InboundDocument{{
			ID:               1,
			CustomerID:       7,
			CustomerName:     "Customer",
			LocationName:     "NJ",
			ContainerNo:      "CNT-ADJ",
			TotalExpectedQty: 10,
			TotalReceivedQty: 10,
			CreatedAt:        now,
			UpdatedAt:        now,
		}},
		nil,
		[]service.ContainerLifecycleEvent{{
			ID:            30,
			CustomerID:    7,
			CustomerName:  "Customer",
			LocationName:  "NJ",
			ContainerNo:   "CNT-ADJ",
			EventType:     service.StockLedgerEventAdjust,
			EventTime:     now,
			QuantityDelta: -10,
			CreatedAt:     now,
		}},
	)

	summary := summaries["CNT-ADJ"]
	if summary.ShippedQty != 0 {
		t.Fatalf("expected adjustment depletion not to count as shipped, got %d", summary.ShippedQty)
	}
	if summary.Status != "DEPLETED" {
		t.Fatalf("expected adjustment-depleted container status DEPLETED, got %q", summary.Status)
	}
}
