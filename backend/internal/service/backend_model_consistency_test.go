package service

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

func TestNonInventoryContainerUpdatesPreserveInventoryProjectionIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Metadata Customer-"+suffix)
	inventoryLocation := mustCreateLocation(t, ctx, store, "Container Inventory Warehouse-"+suffix)
	otherLocation := mustCreateLocation(t, ctx, store, "Container Metadata Warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, inventoryLocation.ID, "CONTAINER-METADATA-"+suffix, 0, DefaultStorageSection)
	containerNo := "CONTAINER-METADATA-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          inventoryLocation.ID,
		ActualArrivalDate:   "2026-07-17",
		ExpectedArrivalDate: "2026-07-17",
		ContainerNo:         containerNo,
		ContainerType:       ContainerTypeNormal,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			Pallets:        2,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create inventory receipt: %v", err)
	}

	if _, err := store.CreateContainer(ctx, CreateContainerInput{
		CustomerID:     customer.ID,
		LocationID:     otherLocation.ID,
		ContainerNo:    containerNo,
		Status:         ContainerStatusPickedUp,
		TrackingStatus: ContainerStatusPickedUp,
		LastEventAt:    "2026-07-18T09:00:00Z",
	}); err != nil {
		t.Fatalf("update container metadata: %v", err)
	}
	assertContainerInventoryProjection(t, ctx, store, customer.ID, containerNo, inventoryLocation.ID, ContainerStatusInStock)

	if _, err := store.CreateContainerTrackingEvent(ctx, CreateContainerTrackingEventInput{
		CustomerID:  customer.ID,
		ContainerNo: containerNo,
		EventType:   "CUSTOMS_RELEASED",
		EventTime:   "2026-07-18T10:00:00Z",
	}); err != nil {
		t.Fatalf("create container tracking event: %v", err)
	}
	assertContainerInventoryProjection(t, ctx, store, customer.ID, containerNo, inventoryLocation.ID, ContainerStatusInStock)

	if _, err := store.CreateContainerPickupAssignment(ctx, CreateContainerPickupAssignmentInput{
		CustomerID:     customer.ID,
		ContainerNo:    containerNo,
		AssignmentType: "INTERNAL",
		ActualPickupAt: "2026-07-18T11:00:00Z",
	}); err != nil {
		t.Fatalf("create container pickup assignment: %v", err)
	}
	assertContainerInventoryProjection(t, ctx, store, customer.ID, containerNo, inventoryLocation.ID, ContainerStatusInStock)

	container, err := store.GetContainerByNo(ctx, customer.ID, containerNo)
	if err != nil {
		t.Fatalf("load container after metadata updates: %v", err)
	}
	if container.TrackingStatus != ContainerStatusPickedUp {
		t.Fatalf("tracking status = %q, want %q", container.TrackingStatus, ContainerStatusPickedUp)
	}
}

func TestTransferDestinationIdentifiersAndOutboundAllocationProjectionIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Transfer Projection Customer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "Transfer Source Warehouse-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "Transfer Destination Warehouse-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, sourceLocation.ID, "TRANSFER-PROJECTION-"+suffix, 0, DefaultStorageSection)
	containerNo := "TRANSFER-PROJECTION-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-07-17",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			Pallets:        2,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create transfer source receipt: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, containerNo, item.SKU)
	if _, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TRANSFER-PROJECTION-" + suffix,
		Lines: []CreateInventoryTransferLineInput{{
			CustomerID:         customer.ID,
			LocationID:         sourceLocation.ID,
			StorageSection:     DefaultStorageSection,
			ContainerNo:        containerNo,
			SKUMasterID:        sourceItem.SKUMasterID,
			Quantity:           4,
			SourcePallets:      1,
			DestinationPallets: 1,
			ToLocationID:       destinationLocation.ID,
			ToStorageSection:   "B",
		}},
	}); err != nil {
		t.Fatalf("create partial container transfer: %v", err)
	}

	var sectionID sql.NullInt64
	var containerID sql.NullInt64
	if err := store.db.QueryRowxContext(ctx, `
		SELECT section_id, container_id
		FROM inventory_items
		WHERE customer_id = ?
		  AND sku_master_id = ?
		  AND location_id = ?
		  AND storage_section = 'B'
		  AND UPPER(TRIM(container_no)) = ?
	`, customer.ID, sourceItem.SKUMasterID, destinationLocation.ID, normalizeContainerNo(containerNo)).Scan(&sectionID, &containerID); err != nil {
		t.Fatalf("load transfer destination identifiers: %v", err)
	}
	if !sectionID.Valid || !containerID.Valid {
		t.Fatalf("transfer destination identifiers must be persisted, got section_id=%v container_id=%v", sectionID, containerID)
	}

	var expectedSectionID int64
	if err := store.db.QueryRowxContext(ctx, `
		SELECT id FROM storage_sections WHERE location_id = ? AND name = 'B'
	`, destinationLocation.ID).Scan(&expectedSectionID); err != nil {
		t.Fatalf("load expected destination section: %v", err)
	}
	var expectedContainerID int64
	if err := store.db.QueryRowxContext(ctx, `
		SELECT id FROM containers WHERE customer_id = ? AND UPPER(TRIM(container_no)) = ?
	`, customer.ID, normalizeContainerNo(containerNo)).Scan(&expectedContainerID); err != nil {
		t.Fatalf("load expected shared container: %v", err)
	}
	if sectionID.Int64 != expectedSectionID || containerID.Int64 != expectedContainerID {
		t.Fatalf("destination identifiers = (%d, %d), want (%d, %d)", sectionID.Int64, containerID.Int64, expectedSectionID, expectedContainerID)
	}

	projection := loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if projection.LocationID.Valid {
		t.Fatalf("split container should not project one warehouse before outbound allocation: %+v", projection)
	}

	destinationItem := mustFindItemByContainer(t, ctx, store, destinationLocation.ID, "B", containerNo, item.SKU)
	if _, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PickingOrderNo: "TRANSFER-PROJECTION-OUT-" + suffix,
		Status:         DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  customer.ID,
			LocationID:  destinationLocation.ID,
			SKUMasterID: destinationItem.SKUMasterID,
			Quantity:    1,
			Pallets:     1,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{{
				LocationID:     destinationLocation.ID,
				StorageSection: "B",
				ContainerNo:    containerNo,
				AllocatedQty:   1,
				Pallets:        1,
			}},
		}},
	}); err != nil {
		t.Fatalf("create outbound draft from split container: %v", err)
	}
	projection = loadContainerProjectionState(t, ctx, store, customer.ID, containerNo)
	if projection.LocationID.Valid {
		t.Fatalf("outbound allocation must not overwrite the split container projection: %+v", projection)
	}
}

func TestUpdateItemRejectsPalletOnlyBucketRekeyIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Pallet-only Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Pallet-only Warehouse-"+suffix)
	item, err := store.CreateItem(ctx, CreateItemInput{
		SKU:            "PALLET-ONLY-" + suffix,
		Description:    "Pallet-only active bucket",
		Quantity:       0,
		Pallets:        2,
		CustomerID:     customer.ID,
		LocationID:     location.ID,
		StorageSection: DefaultStorageSection,
		ContainerNo:    "PALLET-ONLY-CONT-" + suffix,
		Unit:           "pcs",
	})
	if err != nil {
		t.Fatalf("create pallet-only inventory bucket: %v", err)
	}

	_, err = store.UpdateItem(ctx, item.ID, CreateItemInput{
		ItemNumber:     item.ItemNumber,
		SKU:            item.SKU,
		Name:           item.Name,
		Category:       item.Category,
		Description:    item.Description,
		Unit:           item.Unit,
		Quantity:       item.Quantity,
		AllocatedQty:   item.AllocatedQty,
		DamagedQty:     item.DamagedQty,
		HoldQty:        item.HoldQty,
		Pallets:        item.Pallets,
		ReorderLevel:   item.ReorderLevel,
		CustomerID:     item.CustomerID,
		LocationID:     item.LocationID,
		StorageSection: item.StorageSection,
		ContainerNo:    item.ContainerNo + "-REKEYED",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("pallet-only bucket rekey error = %v, want ErrInvalidInput", err)
	}
}

func TestConfirmedInboundPropagatesContainerTypeToSharedContainerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Type Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Container Type Warehouse-"+suffix)
	containerNo := "CONTAINER-TYPE-" + suffix
	if _, err := store.CreateContainer(ctx, CreateContainerInput{
		CustomerID:    customer.ID,
		ContainerNo:   containerNo,
		ContainerType: ContainerTypeNormal,
		Status:        ContainerStatusTrackingReceived,
	}); err != nil {
		t.Fatalf("create pre-receipt shared container: %v", err)
	}
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "CONTAINER-TYPE-"+suffix, 0, DefaultStorageSection)

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-07-17",
		ContainerNo:         containerNo,
		ContainerType:       ContainerTypeWestCoastTransfer,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    5,
			ReceivedQty:    5,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create confirmed receipt with container type: %v", err)
	}

	var count int
	var containerType string
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*), MAX(container_type)
		FROM containers
		WHERE customer_id = ? AND UPPER(TRIM(container_no)) = ?
	`, customer.ID, normalizeContainerNo(containerNo)).Scan(&count, &containerType); err != nil {
		t.Fatalf("load shared container type: %v", err)
	}
	if count != 1 {
		t.Fatalf("shared container count = %d, want 1", count)
	}
	if containerType != ContainerTypeWestCoastTransfer {
		t.Fatalf("shared container type = %q, want %q", containerType, ContainerTypeWestCoastTransfer)
	}
}

func TestConfirmedInboundSynchronizesCanonicalContainerHandlingModeIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Handling Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Container Handling Warehouse-"+suffix)
	containerNo := "CONTAINER-HANDLING-" + suffix
	if _, err := store.CreateContainer(ctx, CreateContainerInput{
		CustomerID:    customer.ID,
		LocationID:    location.ID,
		ContainerNo:   strings.ToLower(containerNo),
		ContainerType: ContainerTypeNormal,
		HandlingMode:  InboundHandlingModeSealedTransit,
		Status:        ContainerStatusTrackingReceived,
	}); err != nil {
		t.Fatalf("create pre-receipt sealed-transit container: %v", err)
	}
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "CONTAINER-HANDLING-"+suffix, 0, DefaultStorageSection)

	createConfirmedReceipt := func(actualArrivalDate string, receivedQty int) {
		t.Helper()
		if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:        customer.ID,
			LocationID:        location.ID,
			ActualArrivalDate: actualArrivalDate,
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
		}); err != nil {
			t.Fatalf("create confirmed palletized receipt: %v", err)
		}
	}

	createConfirmedReceipt("2026-07-16", 5)
	createConfirmedReceipt("2026-07-17", 3)

	var containerCount int
	var handlingMode string
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*), MAX(handling_mode)
		FROM containers
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
	`, customer.ID, normalizeContainerNo(containerNo)).Scan(&containerCount, &handlingMode); err != nil {
		t.Fatalf("load canonical container handling mode: %v", err)
	}
	if containerCount != 1 || handlingMode != InboundHandlingModePalletized {
		t.Fatalf("canonical containers = %d with handling mode %q, want one PALLETIZED container", containerCount, handlingMode)
	}

	var receiptCount int
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*)
		FROM inbound_documents
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
		  AND UPPER(TRIM(status)) = ?
		  AND handling_mode = ?
	`, customer.ID, normalizeContainerNo(containerNo), DocumentStatusConfirmed, InboundHandlingModePalletized).Scan(&receiptCount); err != nil {
		t.Fatalf("load confirmed palletized receipts: %v", err)
	}
	if receiptCount != 2 {
		t.Fatalf("shared container receipts = %d, want 2", receiptCount)
	}
}

func TestConfirmedInboundRejectsConflictingSharedContainerTypeIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Container Type Conflict Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Container Type Conflict Warehouse-"+suffix)
	containerNo := "CONTAINER-TYPE-CONFLICT-" + suffix
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "CONTAINER-TYPE-CONFLICT-"+suffix, 0, DefaultStorageSection)

	createReceipt := func(containerType string, receivedQty int) (InboundDocument, error) {
		return store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:        customer.ID,
			LocationID:        location.ID,
			ActualArrivalDate: "2026-07-17",
			ContainerNo:       containerNo,
			ContainerType:     containerType,
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
	}

	firstReceipt, err := createReceipt(ContainerTypeNormal, 5)
	if err != nil {
		t.Fatalf("create canonical normal receipt: %v", err)
	}
	if _, err := createReceipt(ContainerTypeNormal, 3); err != nil {
		t.Fatalf("create matching shared-container receipt: %v", err)
	}
	if _, err := store.UpdateInboundDocumentContainerType(ctx, firstReceipt.ID, UpdateInboundDocumentContainerTypeInput{
		ContainerType: ContainerTypeWestCoastTransfer,
	}); err != nil {
		t.Fatalf("classify shared container type: %v", err)
	}
	if _, err := createReceipt(ContainerTypeNormal, 2); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("conflicting shared container type error = %v, want ErrInvalidInput", err)
	}

	var matchingReceiptTypes int
	if err := store.db.QueryRowxContext(ctx, `
		SELECT COUNT(*)
		FROM inbound_documents
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
		  AND UPPER(TRIM(status)) = ?
		  AND container_type = ?
	`, customer.ID, normalizeContainerNo(containerNo), DocumentStatusConfirmed, ContainerTypeWestCoastTransfer).Scan(&matchingReceiptTypes); err != nil {
		t.Fatalf("load shared receipt container types: %v", err)
	}
	if matchingReceiptTypes != 2 {
		t.Fatalf("matching shared receipt types = %d, want 2", matchingReceiptTypes)
	}

	var containerType string
	if err := store.db.QueryRowxContext(ctx, `
		SELECT container_type
		FROM containers
		WHERE customer_id = ? AND UPPER(TRIM(container_no)) = ?
	`, customer.ID, normalizeContainerNo(containerNo)).Scan(&containerType); err != nil {
		t.Fatalf("load canonical shared container type: %v", err)
	}
	if containerType != ContainerTypeWestCoastTransfer {
		t.Fatalf("shared container type changed to %q after conflicting receipt", containerType)
	}
}

func TestPostedInboundStillEstablishesSharedContainerMetadataIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Posted Container Metadata Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Posted Container Metadata Warehouse-"+suffix)
	containerNo := "POSTED-CONTAINER-METADATA-" + suffix
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "POSTED-CONTAINER-METADATA-"+suffix, 0, DefaultStorageSection)
	postedReceipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
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
			ReceivedQty:    5,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create receipt to mark POSTED: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE inbound_documents SET status = ? WHERE id = ?`, DocumentStatusPosted, postedReceipt.ID); err != nil {
		t.Fatalf("mark legacy receipt POSTED: %v", err)
	}

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-07-18",
		ContainerNo:       containerNo,
		ContainerType:     ContainerTypeWestCoastTransfer,
		HandlingMode:      InboundHandlingModePalletized,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ReceivedQty:    1,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("conflicting receipt after POSTED receipt error = %v, want ErrInvalidInput", err)
	}

	if _, err := store.UpdateContainerMetadata(ctx, UpdateContainerMetadataInput{
		CustomerID:    customer.ID,
		ContainerNo:   containerNo,
		ContainerType: ContainerTypeNormal,
		HandlingMode:  InboundHandlingModeSealedTransit,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("handling-mode change after POSTED receipt error = %v, want ErrInvalidInput", err)
	}
}

func assertContainerInventoryProjection(t *testing.T, ctx context.Context, store *Store, customerID int64, containerNo string, locationID int64, status string) {
	t.Helper()
	projection := loadContainerProjectionState(t, ctx, store, customerID, containerNo)
	if !projection.LocationID.Valid || projection.LocationID.Int64 != locationID || projection.Status != status {
		t.Fatalf("container inventory projection = %+v, want location %d and status %q", projection, locationID, status)
	}
}
