package service

import (
	"context"
	"errors"
	"testing"
)

func TestUpdateContainerMetadataSynchronizesSharedReceiptsAndPreservesInventoryProjectionIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Metadata Sync Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Container Metadata Sync Warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "CONTAINER-METADATA-SYNC-"+suffix, 0, DefaultStorageSection)
	containerNo := "CONTAINER-METADATA-SYNC-" + suffix

	createReceipt := func(receivedQty int) InboundDocument {
		document, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:        customer.ID,
			LocationID:        location.ID,
			ActualArrivalDate: "2026-07-17",
			ContainerNo:       containerNo,
			ContainerType:     ContainerTypeNormal,
			HandlingMode:      InboundHandlingModePalletized,
			StorageSection:    DefaultStorageSection,
			Status:            DocumentStatusConfirmed,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ReceivedQty:    receivedQty,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			}},
		})
		if err != nil {
			t.Fatalf("create shared-container receipt: %v", err)
		}
		return document
	}

	firstReceipt := createReceipt(5)
	createReceipt(3)
	before := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)

	updated, err := store.UpdateContainerMetadata(ctx, UpdateContainerMetadataInput{
		CustomerID:    customer.ID,
		ContainerNo:   containerNo,
		ContainerType: ContainerTypeWestCoastTransfer,
		HandlingMode:  InboundHandlingModePalletized,
	})
	if err != nil {
		t.Fatalf("update canonical container metadata: %v", err)
	}
	if updated.ContainerType != ContainerTypeWestCoastTransfer || updated.HandlingMode != InboundHandlingModePalletized {
		t.Fatalf("updated container metadata = type %q mode %q", updated.ContainerType, updated.HandlingMode)
	}
	if updated.LocationID != before.LocationID.Int64 || updated.Status != before.Status || updated.TrackingStatus != before.TrackingStatus {
		t.Fatalf("metadata update changed inventory/tracking projection: before=%+v updated=%+v", before, updated)
	}

	var receiptCount int
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*)
		FROM inbound_documents
		WHERE customer_id = ?
		  AND UPPER(TRIM(COALESCE(container_no, ''))) = ?
		  AND UPPER(TRIM(status)) NOT IN ('DELETED', 'CANCELLED')
		  AND corrected_at IS NULL
		  AND container_type = ?
	`, customer.ID, normalizeContainerNo(containerNo), ContainerTypeWestCoastTransfer).Scan(&receiptCount); err != nil {
		t.Fatalf("load synchronized receipt types: %v", err)
	}
	if receiptCount != 2 {
		t.Fatalf("synchronized receipt count = %d, want 2", receiptCount)
	}

	var visitCount int
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*)
		FROM container_visits cv
		JOIN inbound_documents d ON d.id = cv.inbound_document_id
		WHERE d.customer_id = ?
		  AND UPPER(TRIM(COALESCE(d.container_no, ''))) = ?
		  AND cv.container_type = ?
	`, customer.ID, normalizeContainerNo(containerNo), ContainerTypeWestCoastTransfer).Scan(&visitCount); err != nil {
		t.Fatalf("load synchronized container visit types: %v", err)
	}
	if visitCount != 2 {
		t.Fatalf("synchronized visit count = %d, want 2", visitCount)
	}

	if _, err := store.UpdateContainerMetadata(ctx, UpdateContainerMetadataInput{
		CustomerID:    customer.ID,
		ContainerNo:   containerNo,
		ContainerType: ContainerTypeNormal,
		HandlingMode:  InboundHandlingModeSealedTransit,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("conflicting confirmed handling mode error = %v, want ErrInvalidInput", err)
	}

	afterRollback, err := store.GetContainerByNo(ctx, customer.ID, containerNo)
	if err != nil {
		t.Fatalf("load container after rejected metadata update: %v", err)
	}
	if afterRollback.ContainerType != ContainerTypeWestCoastTransfer || afterRollback.HandlingMode != InboundHandlingModePalletized {
		t.Fatalf("rejected atomic update left metadata = type %q mode %q", afterRollback.ContainerType, afterRollback.HandlingMode)
	}
	refreshedReceipt, err := store.getInboundDocument(ctx, firstReceipt.ID)
	if err != nil {
		t.Fatalf("reload receipt after rejected metadata update: %v", err)
	}
	if refreshedReceipt.ContainerType != ContainerTypeWestCoastTransfer {
		t.Fatalf("rejected atomic update left receipt type = %q", refreshedReceipt.ContainerType)
	}
}

func TestUpdateContainerMetadataSynchronizesDraftHandlingModeIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Draft Metadata Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Container Draft Metadata Warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "CONTAINER-DRAFT-METADATA-"+suffix, 0, DefaultStorageSection)
	containerNo := "CONTAINER-DRAFT-METADATA-" + suffix

	if _, err := store.CreateContainer(ctx, CreateContainerInput{
		CustomerID:    customer.ID,
		LocationID:    location.ID,
		ContainerNo:   containerNo,
		ContainerType: ContainerTypeNormal,
		HandlingMode:  InboundHandlingModeSealedTransit,
		Status:        ContainerStatusTrackingReceived,
	}); err != nil {
		t.Fatalf("create tracked container: %v", err)
	}
	draft, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-07-17",
		ContainerNo:       containerNo,
		ContainerType:     ContainerTypeNormal,
		HandlingMode:      InboundHandlingModeSealedTransit,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    4,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create sealed-transit draft: %v", err)
	}

	if _, err := store.UpdateContainerMetadata(ctx, UpdateContainerMetadataInput{
		CustomerID:    customer.ID,
		ContainerNo:   containerNo,
		ContainerType: ContainerTypeWestCoastTransfer,
		HandlingMode:  InboundHandlingModePalletized,
	}); err != nil {
		t.Fatalf("update draft container metadata: %v", err)
	}
	refreshedDraft, err := store.getInboundDocument(ctx, draft.ID)
	if err != nil {
		t.Fatalf("reload synchronized draft: %v", err)
	}
	if refreshedDraft.ContainerType != ContainerTypeWestCoastTransfer || refreshedDraft.HandlingMode != InboundHandlingModePalletized {
		t.Fatalf("draft metadata = type %q mode %q", refreshedDraft.ContainerType, refreshedDraft.HandlingMode)
	}
}

func TestCreateContainerWithoutTrackingStatusPreservesExistingTrackingStateIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Tracking Preserve Customer-"+suffix)
	containerNo := "CONTAINER-TRACKING-PRESERVE-" + suffix
	if _, err := store.CreateContainer(ctx, CreateContainerInput{
		CustomerID:     customer.ID,
		ContainerNo:    containerNo,
		Status:         ContainerStatusPickedUp,
		TrackingStatus: ContainerStatusPickedUp,
	}); err != nil {
		t.Fatalf("create picked-up container: %v", err)
	}

	container, err := store.CreateContainer(ctx, CreateContainerInput{
		CustomerID:  customer.ID,
		ContainerNo: containerNo,
	})
	if err != nil {
		t.Fatalf("reuse container without tracking status: %v", err)
	}
	if container.TrackingStatus != ContainerStatusPickedUp {
		t.Fatalf("tracking status = %q, want preserved %q", container.TrackingStatus, ContainerStatusPickedUp)
	}
}
