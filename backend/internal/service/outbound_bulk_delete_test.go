package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestBulkDeleteOutboundDocumentsRejectsDuplicateIDs(t *testing.T) {
	store := &Store{}
	_, err := store.BulkDeleteOutboundDocuments(context.Background(), BulkDeleteOutboundDocumentsInput{
		DocumentIDs: []int64{7, 7},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate shipment IDs to fail with ErrInvalidInput, got %v", err)
	}
}

func TestBulkDeleteOutboundDocumentsReversesConfirmedAndReleasesDraftReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Bulk Delete Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Bulk Delete Warehouse "+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "BULK-DELETE-"+suffix, 0, DefaultStorageSection)
	containerNo := "BULK-DELETE-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-07-21",
		ContainerNo:       containerNo,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 10, ReceivedQty: 10,
			Pallets: 2, StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("seed bulk-delete inventory: %v", err)
	}

	confirmed, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "BULK-DELETE-CONFIRMED-" + suffix,
		Status:        DocumentStatusConfirmed,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID: customer.ID, LocationID: location.ID, SKUMasterID: item.SKUMasterID,
			Quantity: 4, Pallets: 1, UnitLabel: "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound for bulk deletion: %v", err)
	}
	draft, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo: "BULK-DELETE-DRAFT-" + suffix,
		Status:        DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID: customer.ID, LocationID: location.ID, SKUMasterID: item.SKUMasterID,
			Quantity: 2, Pallets: 1, UnitLabel: "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create draft outbound for bulk deletion: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, draft.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("reserve draft outbound before bulk deletion: %v", err)
	}

	response, err := store.BulkDeleteOutboundDocuments(ctx, BulkDeleteOutboundDocumentsInput{
		DocumentIDs: []int64{confirmed.ID, draft.ID},
	})
	if err != nil {
		t.Fatalf("bulk delete outbound documents: %v", err)
	}
	if response.DeletedDocuments != 2 || response.FailedDocuments != 0 || response.Interrupted {
		t.Fatalf("unexpected bulk delete response: %#v", response)
	}
	if len(response.Results) != 2 || !response.Results[0].Success || !response.Results[1].Success {
		t.Fatalf("expected both shipments to be deleted: %#v", response.Results)
	}
	if _, err := store.getOutboundDocument(ctx, confirmed.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected confirmed outbound to be deleted, got %v", err)
	}
	if _, err := store.getOutboundDocument(ctx, draft.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected draft outbound to be deleted, got %v", err)
	}

	restored := mustFindItemByID(t, ctx, store, item.ID)
	if restored.Quantity != 10 || restored.Pallets != 2 || restored.AllocatedQty != 0 || restored.AllocatedPallets != 0 {
		t.Fatalf("expected restored inventory 10 qty / 2 pallets with no reservations, got %+v", restored)
	}
}

func TestBulkDeleteOutboundDocumentsRetriesSelectedAutomaticTransferDependenciesIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Bulk Delete Transfer Customer "+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "Bulk Delete Overflow "+suffix)
	mainLocation := mustCreateLocation(t, ctx, store, MainOutboundWarehouseCode)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, sourceLocation.ID, "BULK-DELETE-TRANSFER-"+suffix, 0, DefaultStorageSection)
	containerNo := "BULK-DELETE-TRANSFER-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        sourceLocation.ID,
		ActualArrivalDate: "2026-07-01",
		ContainerNo:       containerNo,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 12, ReceivedQty: 12,
			Pallets: 2, StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("seed remote inventory for dependent bulk delete: %v", err)
	}

	createAndConfirm := func(pickingOrderNo string, importID string, quantity int) OutboundDocument {
		t.Helper()
		preview, err := store.buildOutboundBulkImportPreview(ctx, pickingOrderNo+".xlsx", customer.ID, []OutboundBulkImportDocumentPreview{{
			DocumentKey:    pickingOrderNo,
			PickingOrderNo: pickingOrderNo,
			ActualShipDate: "2026-07-15",
			RowNumbers:     []int{2},
			Lines: []OutboundBulkImportLinePreview{{
				RowNumber:        2,
				Warehouse:        mainLocation.Name,
				SourceContainer:  containerNo,
				StorageSection:   DefaultStorageSection,
				SKU:              item.SKU,
				Quantity:         quantity,
				InventoryPallets: 0,
				OutboundPallets:  1,
			}},
		}})
		if err != nil {
			t.Fatalf("preview dependent shipment %s: %v", pickingOrderNo, err)
		}
		if preview.ValidDocuments != 1 || len(preview.Documents) != 1 || !preview.Documents[0].Valid {
			t.Fatalf("expected valid dependent shipment preview for %s: %#v", pickingOrderNo, preview)
		}

		commit, err := store.CreateOutboundDocumentsBulkDraft(ctx, OutboundBulkImportCommitInput{
			ImportID:       importID,
			SourceFileName: pickingOrderNo + ".xlsx",
			CustomerID:     customer.ID,
			Documents: []OutboundBulkImportCommitDocument{{
				DocumentKey: preview.Documents[0].DocumentKey,
				Input:       preview.Documents[0].Input,
			}},
		})
		if err != nil {
			t.Fatalf("create dependent shipment %s: %v", pickingOrderNo, err)
		}
		if len(commit.Results) != 1 || commit.Results[0].Document == nil {
			t.Fatalf("expected committed dependent shipment %s: %#v", pickingOrderNo, commit)
		}
		confirmed, err := store.ConfirmOutboundDocument(ctx, commit.Results[0].Document.ID)
		if err != nil {
			t.Fatalf("confirm dependent shipment %s: %v", pickingOrderNo, err)
		}
		return confirmed
	}

	first := createAndConfirm("PO-BULK-DELETE-FIRST-"+suffix, strings.Repeat("a", 32), 4)
	second := createAndConfirm("PO-BULK-DELETE-SECOND-"+suffix, strings.Repeat("b", 32), 3)
	response, err := store.BulkDeleteOutboundDocuments(ctx, BulkDeleteOutboundDocumentsInput{
		DocumentIDs: []int64{first.ID, second.ID},
	})
	if err != nil {
		t.Fatalf("bulk delete dependent automatic transfers: %v", err)
	}
	if response.DeletedDocuments != 2 || response.FailedDocuments != 0 || response.Interrupted {
		t.Fatalf("expected both dependent shipments to be deleted: %#v", response)
	}
	if len(response.Results) != 2 || !response.Results[0].Success || !response.Results[1].Success {
		t.Fatalf("expected successful results for both dependent shipments: %#v", response.Results)
	}

	restored := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, containerNo, item.SKU)
	if restored.Quantity != 12 || restored.Pallets != 2 {
		t.Fatalf("expected original remote balance 12 CTN / 2 pallets, got %d / %d", restored.Quantity, restored.Pallets)
	}
	var remainingTransferLedgerRows int
	if err := store.db.GetContext(ctx, &remainingTransferLedgerRows, `
		SELECT COUNT(*)
		FROM stock_ledger
		WHERE source_document_type = ?
		  AND customer_id = ?
		  AND sku_master_id = ?
		  AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?
	`, StockLedgerSourceTransfer, customer.ID, item.SKUMasterID, normalizeContainerNo(containerNo)); err != nil {
		t.Fatalf("count remaining automatic transfer ledger rows: %v", err)
	}
	if remainingTransferLedgerRows != 0 {
		t.Fatalf("expected deleted shipments to leave no automatic transfer ledger rows, got %d", remainingTransferLedgerRows)
	}
}

func TestDeleteOutboundKeepsRestoredStockAtCurrentContainerLocationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Delete After Relocation Customer "+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "Delete After Relocation Source "+suffix)
	mainLocation := mustCreateLocation(t, ctx, store, MainOutboundWarehouseCode)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, sourceLocation.ID, "DELETE-AFTER-RELOCATION-"+suffix, 0, DefaultStorageSection)
	containerNo := "DELETE-AFTER-RELOCATION-CONT-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID: customer.ID, LocationID: sourceLocation.ID, ActualArrivalDate: "2026-07-01",
		ContainerNo: containerNo, StorageSection: DefaultStorageSection, Status: DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 10, ReceivedQty: 10,
			Pallets: 2, StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("seed inventory before relocation: %v", err)
	}

	pickingOrderNo := "PO-DELETE-AFTER-RELOCATION-" + suffix
	preview, err := store.buildOutboundBulkImportPreview(ctx, pickingOrderNo+".xlsx", customer.ID, []OutboundBulkImportDocumentPreview{{
		DocumentKey: pickingOrderNo, PickingOrderNo: pickingOrderNo, ActualShipDate: "2026-07-15", RowNumbers: []int{2},
		Lines: []OutboundBulkImportLinePreview{{
			RowNumber: 2, Warehouse: mainLocation.Name, SourceContainer: containerNo,
			StorageSection: DefaultStorageSection, SKU: item.SKU, Quantity: 4,
			InventoryPallets: 0, OutboundPallets: 1,
		}},
	}})
	if err != nil || preview.ValidDocuments != 1 || len(preview.Documents) != 1 {
		t.Fatalf("preview shipment before relocation: err=%v preview=%#v", err, preview)
	}
	commit, err := store.CreateOutboundDocumentsBulkDraft(ctx, OutboundBulkImportCommitInput{
		ImportID: strings.Repeat("c", 32), SourceFileName: pickingOrderNo + ".xlsx", CustomerID: customer.ID,
		Documents: []OutboundBulkImportCommitDocument{{DocumentKey: preview.Documents[0].DocumentKey, Input: preview.Documents[0].Input}},
	})
	if err != nil || len(commit.Results) != 1 || commit.Results[0].Document == nil {
		t.Fatalf("create shipment before relocation: err=%v commit=%#v", err, commit)
	}
	confirmed, err := store.ConfirmOutboundDocument(ctx, commit.Results[0].Document.ID)
	if err != nil {
		t.Fatalf("confirm shipment before relocation: %v", err)
	}

	if _, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TRN-WHOLE-AFTER-OUT-" + suffix,
		Lines: []CreateInventoryTransferLineInput{{
			CustomerID: customer.ID, LocationID: sourceLocation.ID, StorageSection: DefaultStorageSection,
			ContainerNo: containerNo, SKUMasterID: item.SKUMasterID, Quantity: 6,
			SourcePallets: 2, DestinationPallets: 2, ToLocationID: mainLocation.ID, ToStorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("move remaining whole container to current warehouse: %v", err)
	}
	if _, err := store.CancelOutboundDocument(ctx, confirmed.ID); err != nil {
		t.Fatalf("delete shipment after whole-container relocation: %v", err)
	}

	current := mustFindItemByContainer(t, ctx, store, mainLocation.ID, DefaultStorageSection, containerNo, item.SKU)
	if current.Quantity != 10 || current.Pallets != 2 {
		t.Fatalf("expected restored stock to remain at current warehouse with 10 CTN / 2 pallets, got %d / %d", current.Quantity, current.Pallets)
	}
	var sourceBalance int
	if err := store.db.GetContext(ctx, &sourceBalance, `
		SELECT COALESCE(SUM(quantity), 0)
		FROM inventory_items
		WHERE customer_id = ? AND sku_master_id = ? AND location_id = ? AND container_no = ?
	`, customer.ID, item.SKUMasterID, sourceLocation.ID, normalizeContainerNo(containerNo)); err != nil {
		t.Fatalf("load original source balance after deletion: %v", err)
	}
	if sourceBalance != 0 {
		t.Fatalf("expected no stock to be moved back to the original warehouse, got %d", sourceBalance)
	}
}
