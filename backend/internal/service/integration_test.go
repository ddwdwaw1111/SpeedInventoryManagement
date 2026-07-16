package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"

	"speed-inventory-management/backend/internal/database"
)

func newIntegrationStore(t *testing.T) *Store {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		host := strings.TrimSpace(os.Getenv("TEST_MYSQL_HOST"))
		if host == "" {
			t.Skip("TEST_MYSQL_DSN or TEST_MYSQL_HOST is not set")
		}

		port := firstNonEmpty(strings.TrimSpace(os.Getenv("TEST_MYSQL_PORT")), "3306")
		databaseName := strings.TrimSpace(os.Getenv("TEST_MYSQL_DATABASE"))
		user := strings.TrimSpace(os.Getenv("TEST_MYSQL_USER"))
		password := os.Getenv("TEST_MYSQL_PASSWORD")
		if databaseName == "" || user == "" {
			t.Skip("TEST_MYSQL_DATABASE and TEST_MYSQL_USER are required when TEST_MYSQL_DSN is not set")
		}

		dsn = fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci",
			user,
			password,
			host,
			port,
			databaseName,
		)
	}

	db, err := sqlx.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open integration database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.Ping(); err != nil {
		t.Fatalf("ping integration database: %v", err)
	}
	if err := database.Migrate(db.DB); err != nil {
		t.Fatalf("migrate integration database: %v", err)
	}
	resetIntegrationDatabase(t, db)

	store, err := NewStore(db)
	if err != nil {
		t.Fatalf("initialize integration store: %v", err)
	}
	return store
}

func resetIntegrationDatabase(t *testing.T, db *sqlx.DB) {
	t.Helper()

	if _, err := db.Exec(`SET FOREIGN_KEY_CHECKS = 0`); err != nil {
		t.Fatalf("disable foreign key checks: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`SET FOREIGN_KEY_CHECKS = 1`)
	})

	tables := []string{
		"audit_logs",
		"customer_item_catalog",
		"storage_sections",
		"ui_preferences",
		"billing_invoice_settings",
		"user_sessions",
		"billing_invoice_lines",
		"billing_invoices",
		"outbound_container_allocations",
		"container_lifecycle_events",
		"document_attachments",
		"delivery_events",
		"container_pickup_assignments",
		"container_tracking_events",
		"containers",
		"stock_ledger",
		"container_visits",
		"cycle_count_lines",
		"cycle_counts",
		"inventory_transfer_lines",
		"inventory_transfers",
		"inventory_adjustment_lines",
		"inventory_adjustments",
		"outbound_document_lines",
		"outbound_documents",
		"inbound_document_lines",
		"inbound_documents",
		"inventory_items",
		"sku_master",
		"customers",
		"storage_locations",
		"users",
	}

	for _, table := range tables {
		if _, err := db.Exec(`TRUNCATE TABLE ` + table); err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}
}

func TestDocumentPostingLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-22",
		ContainerNo:         "CONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		DocumentNote:        "Inbound integration test",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:               item.SKU,
				Description:       item.Description,
				ExpectedQty:       10,
				ReceivedQty:       10,
				StorageSection:    DefaultStorageSection,
				Pallets:           2,
				PalletsDetailCtns: "2*5",
				PalletBreakdown: []InboundPalletBreakdown{
					{Quantity: 5},
					{Quantity: 5},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("create inbound document: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected inbound status DRAFT, got %q", inbound.Status)
	}
	itemAfterInboundDraft := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterInboundDraft.Quantity != 0 {
		t.Fatalf("expected on-hand 0 after inbound draft, got %d", itemAfterInboundDraft.Quantity)
	}

	inbound, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("confirm inbound document: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected inbound status CONFIRMED, got %q", inbound.Status)
	}

	_, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err == nil {
		t.Fatalf("expected second inbound confirmation to fail")
	}
	if inbound.TotalReceivedQty != 10 {
		t.Fatalf("expected total received qty 10, got %d", inbound.TotalReceivedQty)
	}

	itemAfterInbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-"+suffix, item.SKU)
	if itemAfterInbound.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after inbound, got %d", itemAfterInbound.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-22",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "FedEx",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Outbound integration test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemAfterInbound.CustomerID,
				LocationID:   itemAfterInbound.LocationID,
				SKUMasterID:  itemAfterInbound.SKUMasterID,
				Quantity:     5,
				Pallets:      1,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create outbound document: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected outbound status DRAFT, got %q", outbound.Status)
	}
	if len(outbound.Lines) != 1 {
		t.Fatalf("expected 1 outbound line, got %d", len(outbound.Lines))
	}
	if len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound document to defer pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}

	itemAfterOutboundDraft := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterOutboundDraft.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after outbound draft, got %d", itemAfterOutboundDraft.Quantity)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm outbound document: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected outbound status CONFIRMED, got %q", outbound.Status)
	}

	_, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err == nil {
		t.Fatalf("expected second outbound confirmation to fail")
	}

	itemAfterOutbound := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterOutbound.Quantity != 5 {
		t.Fatalf("expected on-hand 5 after outbound, got %d", itemAfterOutbound.Quantity)
	}

	cancelled, err := store.CancelOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	if !strings.EqualFold(cancelled.Status, "DELETED") {
		t.Fatalf("expected deleted outbound status, got %q", cancelled.Status)
	}

	itemAfterReversal := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterReversal.Quantity != 10 {
		t.Fatalf("expected on-hand 10 after reversal, got %d", itemAfterReversal.Quantity)
	}

	if _, err := store.CancelInboundDocument(ctx, inbound.ID); err == nil || !strings.Contains(err.Error(), "container has later inventory activity") {
		t.Fatalf("expected inbound deletion to require manual correction after outbound activity, got %v", err)
	}

	itemAfterBlockedInboundDeletion := mustFindItemByID(t, ctx, store, itemAfterInbound.ID)
	if itemAfterBlockedInboundDeletion.Quantity != 10 {
		t.Fatalf("expected blocked inbound deletion to preserve on-hand 10, got %d", itemAfterBlockedInboundDeletion.Quantity)
	}
	inboundAfterBlockedDeletion, err := store.getInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("reload inbound after blocked deletion: %v", err)
	}
	if !strings.EqualFold(inboundAfterBlockedDeletion.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected blocked inbound deletion to keep confirmed status, got %q", inboundAfterBlockedDeletion.Status)
	}
}

func TestInboundCorrectionDraftReversesAndRepostsAtomicallyIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Correction Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Correction Warehouse-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-CORR-"+suffix, 0)
	containerNo := "CORR-" + suffix

	original, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-06-15",
		ActualArrivalDate:   "2026-06-15",
		ContainerNo:         containerNo,
		ContainerType:       "NORMAL",
		HandlingMode:        InboundHandlingModePalletized,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			Pallets:        2,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create original inbound receipt: %v", err)
	}
	original, err = store.ConfirmInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("confirm original inbound receipt: %v", err)
	}
	originalAttachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentInbound,
		DocumentID:       original.ID,
		DisplayName:      "Original receipt attachment",
		OriginalFileName: "original.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/inbound/correction-source-" + suffix + ".pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create original receipt attachment: %v", err)
	}

	correctionDraft, err := store.CreateInboundCorrectionDraft(ctx, original.ID)
	if err != nil {
		t.Fatalf("create inbound correction draft: %v", err)
	}
	if correctionDraft.CorrectsDocumentID == nil || *correctionDraft.CorrectsDocumentID != original.ID {
		t.Fatalf("expected correction draft to reference original receipt %d, got %v", original.ID, correctionDraft.CorrectsDocumentID)
	}
	if len(correctionDraft.Attachments) != 1 || correctionDraft.Attachments[0].ID != originalAttachment.ID || correctionDraft.Attachments[0].DocumentID != original.ID {
		t.Fatalf("expected correction draft to inherit the original attachment reference, got %+v", correctionDraft.Attachments)
	}
	if _, err := store.UpdateInboundDocumentNote(ctx, original.ID, UpdateInboundDocumentNoteInput{DocumentNote: "stale source edit"}); err == nil {
		t.Fatal("expected source receipt note update to be rejected while correction draft is open")
	}
	if _, err := store.UpdateInboundDocumentContainerType(ctx, original.ID, UpdateInboundDocumentContainerTypeInput{ContainerType: ContainerTypeWestCoastTransfer}); err == nil {
		t.Fatal("expected source receipt container type update to be rejected while correction draft is open")
	}
	if err := store.MarkDocumentAttachmentDeleted(ctx, DocumentAttachmentInbound, original.ID, originalAttachment.ID); err == nil {
		t.Fatal("expected inherited source attachment deletion to be rejected while correction draft is open")
	}
	originalWithDraft, err := store.getInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("reload original receipt with correction draft: %v", err)
	}
	if originalWithDraft.CorrectedByDocumentID == nil || *originalWithDraft.CorrectedByDocumentID != correctionDraft.ID {
		t.Fatalf("expected original receipt to reference correction draft %d, got %v", correctionDraft.ID, originalWithDraft.CorrectedByDocumentID)
	}
	if originalWithDraft.CorrectedAt != nil {
		t.Fatalf("expected original receipt to remain active while correction is a draft")
	}
	operationalWhileDraft, err := store.ListInboundDocumentsFiltered(ctx, 10, InboundDocumentFilters{
		ArchiveScope:    DocumentArchiveScopeAll,
		CustomerID:      customer.ID,
		OperationalOnly: true,
	})
	if err != nil {
		t.Fatalf("list operational receipts while correction is a draft: %v", err)
	}
	foundOriginalWhileDraft := false
	foundCorrectionWhileDraft := false
	for _, document := range operationalWhileDraft {
		foundOriginalWhileDraft = foundOriginalWhileDraft || document.ID == original.ID
		foundCorrectionWhileDraft = foundCorrectionWhileDraft || document.ID == correctionDraft.ID
	}
	if !foundOriginalWhileDraft || foundCorrectionWhileDraft {
		t.Fatalf("expected only original receipt in operational results while correction is a draft")
	}
	itemWhileDraft := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if itemWhileDraft.Quantity != 10 || itemWhileDraft.Pallets != 2 {
		t.Fatalf("expected inventory to remain 10 qty / 2 pallets while correction is draft, got %d / %d", itemWhileDraft.Quantity, itemWhileDraft.Pallets)
	}

	correctedContainerNo := containerNo + "-FIXED"
	correctionDraft, err = store.UpdateInboundDocument(ctx, correctionDraft.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-06-15",
		ActualArrivalDate:   "2026-06-15",
		ContainerNo:         correctedContainerNo,
		ContainerType:       "NORMAL",
		HandlingMode:        InboundHandlingModePalletized,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    8,
			ReceivedQty:    8,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("update inbound correction draft: %v", err)
	}
	correction, err := store.ConfirmInboundDocument(ctx, correctionDraft.ID)
	if err != nil {
		t.Fatalf("confirm inbound correction: %v", err)
	}
	if correction.CorrectsDocumentID == nil || *correction.CorrectsDocumentID != original.ID {
		t.Fatalf("expected confirmed correction to retain source receipt link")
	}

	correctedOriginal, err := store.getInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("reload corrected original receipt: %v", err)
	}
	if correctedOriginal.CorrectedAt == nil {
		t.Fatalf("expected original receipt to be marked corrected")
	}
	itemAfterCorrection := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, correctedContainerNo, item.SKU)
	if itemAfterCorrection.Quantity != 8 || itemAfterCorrection.Pallets != 1 {
		t.Fatalf("expected corrected inventory 8 qty / 1 pallet, got %d / %d", itemAfterCorrection.Quantity, itemAfterCorrection.Pallets)
	}
	assertItemHiddenByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)

	oldContainer, err := store.GetContainerByNo(ctx, customer.ID, containerNo)
	if err != nil {
		t.Fatalf("load corrected source container: %v", err)
	}
	if oldContainer.Status != ContainerStatusCorrected {
		t.Fatalf("expected old container status %s, got %s", ContainerStatusCorrected, oldContainer.Status)
	}
	containerSummaries, err := NewContainerService(store).ListContainers(ctx, ListContainersInput{CustomerID: customer.ID})
	if err != nil {
		t.Fatalf("list operational containers after correction: %v", err)
	}
	foundOldContainer := false
	foundCorrectedContainer := false
	for _, summary := range containerSummaries {
		foundOldContainer = foundOldContainer || summary.ContainerNo == containerNo
		foundCorrectedContainer = foundCorrectedContainer || summary.ContainerNo == correctedContainerNo
	}
	if foundOldContainer || !foundCorrectedContainer {
		t.Fatalf("expected operational container list to replace %s with %s", containerNo, correctedContainerNo)
	}
	if _, err := NewContainerService(store).GetLifecycle(ctx, GetContainerLifecycleInput{
		CustomerID:      customer.ID,
		ContainerNo:     containerNo,
		OperationalOnly: true,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected corrected source container to be hidden from customer lifecycle, got %v", err)
	}
	auditLifecycle, err := NewContainerService(store).GetLifecycle(ctx, GetContainerLifecycleInput{
		CustomerID:  customer.ID,
		ContainerNo: containerNo,
	})
	if err != nil {
		t.Fatalf("load corrected source lifecycle for staff audit: %v", err)
	}
	if len(auditLifecycle.LifecycleEvents) == 0 {
		t.Fatal("expected staff audit lifecycle to retain corrected source events")
	}
	foundOriginalPackingList := false
	for _, document := range auditLifecycle.PackingLists {
		if document.ID == original.ID {
			foundOriginalPackingList = true
			break
		}
	}
	if !foundOriginalPackingList {
		t.Fatalf("expected staff audit lifecycle to retain corrected source receipt %d", original.ID)
	}

	auditEvents, err := store.ListContainerLifecycleEvents(ctx, 20, ContainerLifecycleEventFilters{
		CustomerID:  customer.ID,
		ContainerNo: containerNo,
	})
	if err != nil {
		t.Fatalf("list corrected source lifecycle audit: %v", err)
	}
	var originalReceiveAt *time.Time
	var originalReversalAt *time.Time
	for index := range auditEvents {
		event := &auditEvents[index]
		if event.SourceDocumentType != StockLedgerSourceInbound || event.SourceDocumentID != original.ID {
			continue
		}
		if event.EventType == StockLedgerEventReceive && event.QuantityDelta == 10 {
			originalReceiveAt = &event.EventTime
		}
		if event.EventType == StockLedgerEventAdjust && event.QuantityDelta == -10 {
			originalReversalAt = &event.EventTime
		}
	}
	if originalReceiveAt == nil || originalReversalAt == nil || !originalReceiveAt.Equal(*originalReversalAt) {
		t.Fatalf("expected corrected source receipt and reversal to share the same effective timestamp")
	}
	operationalOldEvents, err := store.ListContainerLifecycleEvents(ctx, 20, ContainerLifecycleEventFilters{
		CustomerID:      customer.ID,
		ContainerNo:     containerNo,
		OperationalOnly: true,
	})
	if err != nil {
		t.Fatalf("list operational corrected source lifecycle: %v", err)
	}
	if len(operationalOldEvents) != 0 {
		t.Fatalf("expected corrected source lifecycle to be hidden from operational results, got %d events", len(operationalOldEvents))
	}
	operationalAfterConfirmation, err := store.ListInboundDocumentsFiltered(ctx, 10, InboundDocumentFilters{
		ArchiveScope:    DocumentArchiveScopeAll,
		CustomerID:      customer.ID,
		OperationalOnly: true,
	})
	if err != nil {
		t.Fatalf("list operational receipts after correction: %v", err)
	}
	foundOriginalAfterConfirmation := false
	foundCorrectionAfterConfirmation := false
	for _, document := range operationalAfterConfirmation {
		foundOriginalAfterConfirmation = foundOriginalAfterConfirmation || document.ID == original.ID
		foundCorrectionAfterConfirmation = foundCorrectionAfterConfirmation || document.ID == correction.ID
	}
	if foundOriginalAfterConfirmation || !foundCorrectionAfterConfirmation {
		t.Fatalf("expected confirmed correction to replace original receipt in operational results")
	}
	if _, err := store.CancelInboundDocument(ctx, original.ID); err == nil {
		t.Fatalf("expected corrected original receipt deletion to be blocked")
	}
	if _, err := store.CreateInboundCorrectionDraft(ctx, original.ID); err == nil {
		t.Fatalf("expected a second correction draft for the corrected original to be blocked")
	}

	reusedContainerReceipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        customer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-07-01",
		ContainerNo:       containerNo,
		HandlingMode:      InboundHandlingModePalletized,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    3,
			ReceivedQty:    3,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("receive reused corrected container: %v", err)
	}
	reusedContainer, err := store.GetContainerByNo(ctx, customer.ID, containerNo)
	if err != nil {
		t.Fatalf("load reused corrected container: %v", err)
	}
	if reusedContainer.InboundDocumentID != reusedContainerReceipt.ID || reusedContainer.Status != "IN_STOCK" || reusedContainer.TrackingStatus != "RECEIVED" {
		t.Fatalf("expected reused container to reactivate for receipt %d, got %+v", reusedContainerReceipt.ID, reusedContainer)
	}
}

func TestInboundCorrectionCustomerAccessRespectsTenantBoundaryIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	formerCustomer := mustCreateCustomer(t, ctx, store, "Correction Former Customer-"+suffix)
	activeCustomer := mustCreateCustomer(t, ctx, store, "Correction Active Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Correction Customer Warehouse-"+suffix)
	item := mustCreateItem(t, ctx, store, formerCustomer.ID, location.ID, "SKU-CORR-CUSTOMER-"+suffix, 0)

	original, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:        formerCustomer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-06-15",
		ContainerNo:       "CORR-CUSTOMER-" + suffix,
		HandlingMode:      InboundHandlingModePalletized,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    5,
			ReceivedQty:    5,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create original customer receipt: %v", err)
	}
	attachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentInbound,
		DocumentID:       original.ID,
		DisplayName:      "Inherited customer attachment",
		OriginalFileName: "customer-receipt.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/inbound/customer-correction-" + suffix + ".pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create customer correction attachment: %v", err)
	}

	correctionDraft, err := store.CreateInboundCorrectionDraft(ctx, original.ID)
	if err != nil {
		t.Fatalf("create customer correction draft: %v", err)
	}
	correctionDraft, err = store.UpdateInboundDocument(ctx, correctionDraft.ID, CreateInboundDocumentInput{
		CustomerID:        activeCustomer.ID,
		LocationID:        location.ID,
		ActualArrivalDate: "2026-06-15",
		ContainerNo:       "CORR-CUSTOMER-FIXED-" + suffix,
		HandlingMode:      InboundHandlingModePalletized,
		StorageSection:    DefaultStorageSection,
		Status:            DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    5,
			ReceivedQty:    5,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("move correction receipt to active customer: %v", err)
	}
	correction, err := store.ConfirmInboundDocument(ctx, correctionDraft.ID)
	if err != nil {
		t.Fatalf("confirm customer correction receipt: %v", err)
	}

	if len(correction.Attachments) != 0 {
		t.Fatalf("expected cross-customer correction not to inherit source attachments, got %+v", correction.Attachments)
	}
	if _, err := store.GetInboundDocumentForCustomer(ctx, original.ID, activeCustomer.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected active customer source access to be denied at the tenant boundary, got %v", err)
	}
	resolved, err := store.GetInboundDocumentForCustomer(ctx, correction.ID, activeCustomer.ID)
	if err != nil {
		t.Fatalf("authorize corrected receipt for active customer: %v", err)
	}
	if resolved.ID != correction.ID {
		t.Fatalf("expected corrected receipt %d, got %d", correction.ID, resolved.ID)
	}
	if len(resolved.Attachments) != 0 {
		t.Fatalf("expected active customer not to receive former customer attachments, got %+v", resolved.Attachments)
	}
	if _, err := store.GetInboundDocumentForCustomer(ctx, original.ID, formerCustomer.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected former customer source access to be denied, got %v", err)
	}
	originalForAudit, err := store.getInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("load original receipt for staff audit: %v", err)
	}
	if len(originalForAudit.Attachments) != 1 || originalForAudit.Attachments[0].ID != attachment.ID {
		t.Fatalf("expected original attachment to remain on its source receipt, got %+v", originalForAudit.Attachments)
	}
}

func TestInboundCorrectionRejectsAnyLaterContainerActivityIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Correction Shared Container Customer-"+suffix)
	originalLocation := mustCreateLocation(t, ctx, store, "Correction Shared Container Origin-"+suffix)
	laterLocation := mustCreateLocation(t, ctx, store, "Correction Shared Container Current-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, originalLocation.ID, "SKU-CORR-SHARED-"+suffix, 0)
	containerNo := "CORR-SHARED-" + suffix

	createConfirmedReceipt := func(locationID int64, receivedQty int, pallets int) InboundDocument {
		t.Helper()
		document, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:        customer.ID,
			LocationID:        locationID,
			ActualArrivalDate: "2026-06-15",
			ContainerNo:       containerNo,
			HandlingMode:      InboundHandlingModePalletized,
			StorageSection:    DefaultStorageSection,
			Status:            DocumentStatusConfirmed,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    receivedQty,
				ReceivedQty:    receivedQty,
				Pallets:        pallets,
				StorageSection: DefaultStorageSection,
			}},
		})
		if err != nil {
			t.Fatalf("create confirmed shared-container receipt: %v", err)
		}
		return document
	}

	original := createConfirmedReceipt(originalLocation.ID, 10, 2)
	correctionDraft, err := store.CreateInboundCorrectionDraft(ctx, original.ID)
	if err != nil {
		t.Fatalf("create correction draft before later container activity: %v", err)
	}

	createConfirmedReceipt(laterLocation.ID, 5, 1)
	if _, err := store.ConfirmInboundDocument(ctx, correctionDraft.ID); err == nil || !strings.Contains(err.Error(), "container has later inventory activity") {
		t.Fatalf("expected confirmation to require manual correction of later container activity, got %v", err)
	}

	if _, err := store.CancelInboundDocument(ctx, correctionDraft.ID); err != nil {
		t.Fatalf("delete blocked correction draft: %v", err)
	}
	if _, err := store.CreateInboundCorrectionDraft(ctx, original.ID); err == nil || !strings.Contains(err.Error(), "container has later inventory activity") {
		t.Fatalf("expected correction draft creation to reject existing later container activity, got %v", err)
	}

	originalAfterFailure, err := store.getInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("reload original after blocked correction: %v", err)
	}
	if originalAfterFailure.CorrectedAt != nil || originalAfterFailure.CorrectedByDocumentID != nil {
		t.Fatalf("expected blocked correction to leave original active without an open draft")
	}
}

func TestInboundCorrectionRejectsInventoryThatWasShippedAndReplenishedIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Correction Provenance Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "Correction Provenance Warehouse-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-CORR-PROV-"+suffix, 0)
	containerNo := "CORR-PROV-" + suffix

	createAndConfirmReceipt := func(actualArrivalDate string) InboundDocument {
		t.Helper()
		receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:        customer.ID,
			LocationID:        location.ID,
			ActualArrivalDate: actualArrivalDate,
			ContainerNo:       containerNo,
			ContainerType:     "NORMAL",
			HandlingMode:      InboundHandlingModePalletized,
			StorageSection:    DefaultStorageSection,
			UnitLabel:         "CTN",
			Status:            DocumentStatusDraft,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    10,
				ReceivedQty:    10,
				Pallets:        2,
				StorageSection: DefaultStorageSection,
			}},
		})
		if err != nil {
			t.Fatalf("create inbound receipt: %v", err)
		}
		receipt, err = store.ConfirmInboundDocument(ctx, receipt.ID)
		if err != nil {
			t.Fatalf("confirm inbound receipt: %v", err)
		}
		return receipt
	}

	original := createAndConfirmReceipt("2026-06-15")
	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "PICK-CORR-PROV-" + suffix,
		ActualShipDate: "2026-06-16",
		Status:         DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  customer.ID,
			LocationID:  location.ID,
			SKUMasterID: receivedItem.SKUMasterID,
			Quantity:    10,
			Pallets:     2,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound consuming original receipt: %v", err)
	}
	if _, err := store.ConfirmOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("confirm outbound consuming original receipt: %v", err)
	}

	createAndConfirmReceipt("2026-06-17")
	replenishedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if replenishedItem.Quantity != 10 || replenishedItem.Pallets != 2 {
		t.Fatalf("expected replenished inventory 10 qty / 2 pallets, got %d / %d", replenishedItem.Quantity, replenishedItem.Pallets)
	}

	if _, err := store.CreateInboundCorrectionDraft(ctx, original.ID); err == nil || !strings.Contains(err.Error(), "container has later inventory activity") {
		t.Fatalf("expected correction draft to reject shipped-and-replenished container activity, got %v", err)
	}
	if _, err := store.CancelInboundDocument(ctx, original.ID); err == nil || !strings.Contains(err.Error(), "container has later inventory activity") {
		t.Fatalf("expected confirmed receipt deletion to reject shipped-and-replenished container activity, got %v", err)
	}

	unchangedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if unchangedItem.Quantity != 10 || unchangedItem.Pallets != 2 {
		t.Fatalf("expected failed correction to preserve replenished inventory, got %d / %d", unchangedItem.Quantity, unchangedItem.Pallets)
	}
	originalAfterFailure, err := store.getInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("reload original after failed correction: %v", err)
	}
	if originalAfterFailure.CorrectedAt != nil {
		t.Fatalf("expected failed correction to leave original receipt uncorrected")
	}
	if normalizeDocumentStatus(originalAfterFailure.Status) != DocumentStatusConfirmed {
		t.Fatalf("expected failed deletion to leave original receipt confirmed, got %s", originalAfterFailure.Status)
	}
}

func TestBackfilledInboundUsesActualReceivedTimestampIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Backfill Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "BK-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-BK-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2025-12-15",
		ContainerNo:         "BKCONT-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:               item.SKU,
				Description:       item.Description,
				ExpectedQty:       12,
				ReceivedQty:       12,
				StorageSection:    DefaultStorageSection,
				Pallets:           1,
				PalletsDetailCtns: "1*12",
			},
		},
	})
	if err != nil {
		t.Fatalf("create backfilled inbound document: %v", err)
	}

	confirmedWindowStart := time.Now().UTC().Add(-1 * time.Minute)
	inbound, err = store.ConfirmInboundDocument(ctx, inbound.ID)
	if err != nil {
		t.Fatalf("confirm backfilled inbound document: %v", err)
	}
	if inbound.ConfirmedAt == nil {
		t.Fatalf("expected confirmedAt to be set")
	}

	var arrivalDate sql.NullTime
	var receivedAt sql.NullTime
	if err := store.db.QueryRowContext(ctx, `
		SELECT arrival_date, received_at
		FROM container_visits
		WHERE inbound_document_id = ?
	`, inbound.ID).Scan(&arrivalDate, &receivedAt); err != nil {
		t.Fatalf("load container visit timestamps: %v", err)
	}
	if !arrivalDate.Valid || arrivalDate.Time.Format("2006-01-02") != "2025-12-15" {
		t.Fatalf("expected arrival_date to remain business date 2025-12-15, got %v", arrivalDate.Time)
	}
	if !receivedAt.Valid {
		t.Fatalf("expected received_at to be set")
	}
	if receivedAt.Time.Before(confirmedWindowStart) {
		t.Fatalf("expected received_at to reflect actual confirmation time, got %v", receivedAt.Time)
	}

	itemAfterInbound := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "BKCONT-"+suffix, item.SKU)
	if itemAfterInbound.LastRestockedAt == nil {
		t.Fatalf("expected lastRestockedAt to be set")
	}
	if itemAfterInbound.LastRestockedAt.Before(confirmedWindowStart) {
		t.Fatalf("expected lastRestockedAt to reflect actual confirmation time, got %v", itemAfterInbound.LastRestockedAt)
	}
}

func TestInventoryAdjustmentUsesContainerBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10, DefaultStorageSection)
	adjustmentLine := adjustmentLineFromItem(item, -2, "reduce two units")

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Notes:      "Use container quantity",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
		},
	})
	if err != nil {
		t.Fatalf("create inventory adjustment with container quantity: %v", err)
	}
	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 adjustment line, got %d", len(adjustment.Lines))
	}
	if adjustment.Lines[0].BeforeQty != 10 {
		t.Fatalf("expected container before qty 10, got %d", adjustment.Lines[0].BeforeQty)
	}
	if adjustment.Lines[0].AfterQty != 8 {
		t.Fatalf("expected container after qty 8, got %d", adjustment.Lines[0].AfterQty)
	}

	itemAfterAdjustment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterAdjustment.Quantity != 8 {
		t.Fatalf("expected container on-hand 8 after adjustment, got %d", itemAfterAdjustment.Quantity)
	}
}

func TestInventoryAdjustmentDoesNotRequirePalletEntityIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AdjustmentPalletRequiredCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AdjustmentPalletRequiredLocation-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ADJ-PALLET-REQ-"+suffix, 10, DefaultStorageSection)

	if _, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLineFromItem(item, -2, "missing pallet"),
		},
	}); err != nil {
		t.Fatalf("expected adjustment without pallet entity to succeed, got %v", err)
	}
}

func TestInventoryAdjustmentFinalBalanceUsesLockedCurrentBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AdjustmentFinalCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AdjustmentFinalLocation-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ADJ-FINAL-"+suffix, 10, DefaultStorageSection)

	interimLine := adjustmentLineFromItem(item, 2, "interim stock change")
	interimLine.AdjustPallets = 1
	if _, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines:      []CreateInventoryAdjustmentLineInput{interimLine},
	}); err != nil {
		t.Fatalf("create interim inventory adjustment: %v", err)
	}

	finalQty := 7
	finalPallets := 2
	finalLine := adjustmentLineFromItem(item, 0, "set exact final balance")
	finalLine.FinalQty = &finalQty
	finalLine.FinalPallets = &finalPallets
	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines:      []CreateInventoryAdjustmentLineInput{finalLine},
	})
	if err != nil {
		t.Fatalf("create final-balance inventory adjustment: %v", err)
	}
	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected one final-balance line, got %d", len(adjustment.Lines))
	}
	line := adjustment.Lines[0]
	if line.BeforeQty != 12 || line.AdjustQty != -5 || line.AfterQty != finalQty {
		t.Fatalf("expected final quantity to be calculated from locked 12-unit balance, got %+v", line)
	}
	if line.BeforePallets != 1 || line.AdjustPallets != 1 || line.AfterPallets != finalPallets {
		t.Fatalf("expected final pallets to be calculated from locked 1-pallet balance, got %+v", line)
	}
}

func TestInventoryAdjustmentCanIncreaseContainerBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AdjustmentPositiveCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AdjustmentPositiveLocation-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ADJ-POS-"+suffix, 10, DefaultStorageSection)
	adjustmentLine := adjustmentLineFromItem(item, 3, "increase container balance")

	adjustment, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines: []CreateInventoryAdjustmentLineInput{
			adjustmentLine,
		},
	})
	if err != nil {
		t.Fatalf("create positive container adjustment: %v", err)
	}

	if len(adjustment.Lines) != 1 {
		t.Fatalf("expected 1 positive container adjustment line, got %d", len(adjustment.Lines))
	}
	if adjustment.Lines[0].BeforeQty != 10 || adjustment.Lines[0].AfterQty != 13 {
		t.Fatalf("expected before/after qty 10->13, got %+v", adjustment.Lines[0])
	}

	var ledgerQty int
	if err := store.db.GetContext(ctx, &ledgerQty, `
		SELECT COALESCE(SUM(quantity_change), 0)
		FROM stock_ledger
		WHERE source_document_type = 'ADJUSTMENT'
		  AND source_document_id = ?
	`, adjustment.ID); err != nil {
		t.Fatalf("load positive adjustment ledger quantity: %v", err)
	}
	if ledgerQty != 3 {
		t.Fatalf("expected positive adjustment ledger quantity 3, got %d", ledgerQty)
	}
}

func TestInventoryTransferUsesContainerBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	fromLocation := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	toLocation := mustCreateLocation(t, ctx, store, "LA-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, fromLocation.ID, "SKU-"+suffix, 10, DefaultStorageSection)

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		Notes: "Transfer with pallet-backed quantity",
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(item, 4, toLocation.ID, "B", "Move four units"),
		},
	})
	if err != nil {
		t.Fatalf("create transfer with pallet-backed quantity: %v", err)
	}
	if len(transfer.Lines) != 1 {
		t.Fatalf("expected 1 transfer line, got %d", len(transfer.Lines))
	}

	sourceAfterTransfer := mustFindItemByID(t, ctx, store, item.ID)
	if sourceAfterTransfer.Quantity != 6 {
		t.Fatalf("expected source pallet-backed on-hand 6 after transfer, got %d", sourceAfterTransfer.Quantity)
	}

	destinationAfterTransfer := mustFindItemByLocationAndSection(t, ctx, store, toLocation.ID, "B", item.SKU)
	if destinationAfterTransfer.Quantity != 4 {
		t.Fatalf("expected destination pallet-backed on-hand 4 after transfer, got %d", destinationAfterTransfer.Quantity)
	}
}

func TestInventoryTransferAllowsPalletOnlyBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "PalletOnlyTransferCustomer-"+suffix)
	fromLocation := mustCreateLocation(t, ctx, store, "PalletOnlyTransferFrom-"+suffix)
	toLocation := mustCreateLocation(t, ctx, store, "PalletOnlyTransferTo-"+suffix)
	item, err := store.CreateItem(ctx, CreateItemInput{
		SKU:            "PALLET-ONLY-" + suffix,
		Description:    "Pallet-only transfer item",
		Quantity:       0,
		Pallets:        2,
		CustomerID:     customer.ID,
		LocationID:     fromLocation.ID,
		StorageSection: DefaultStorageSection,
		ContainerNo:    "EMPTY-PALLETS-" + suffix,
		Unit:           "CTN",
	})
	if err != nil {
		t.Fatalf("create pallet-only inventory: %v", err)
	}

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		Lines: []CreateInventoryTransferLineInput{{
			CustomerID:       item.CustomerID,
			LocationID:       item.LocationID,
			StorageSection:   item.StorageSection,
			ContainerNo:      item.ContainerNo,
			SKUMasterID:      item.SKUMasterID,
			Quantity:         0,
			Pallets:          1,
			ToLocationID:     toLocation.ID,
			ToStorageSection: "B",
		}},
	})
	if err != nil {
		t.Fatalf("create pallet-only transfer: %v", err)
	}
	if len(transfer.Lines) != 1 || transfer.Lines[0].Quantity != 0 || transfer.Lines[0].Pallets != 1 {
		t.Fatalf("expected one pallet-only transfer line, got %+v", transfer.Lines)
	}

	source := mustFindItemByID(t, ctx, store, item.ID)
	if source.Quantity != 0 || source.Pallets != 1 {
		t.Fatalf("expected source balance 0 qty / 1 pallet, got %d / %d", source.Quantity, source.Pallets)
	}
	destination := mustFindItemByLocationAndSection(t, ctx, store, toLocation.ID, "B", item.SKU)
	if destination.Quantity != 0 || destination.Pallets != 1 {
		t.Fatalf("expected destination balance 0 qty / 1 pallet, got %d / %d", destination.Quantity, destination.Pallets)
	}
	report, err := store.GetSKUFlowReport(ctx, SKUFlowReportFilters{
		SKUMasterID: item.SKUMasterID,
		CustomerID:  customer.ID,
	})
	if err != nil {
		t.Fatalf("load pallet-only SKU flow report: %v", err)
	}
	if report.Summary.CurrentQty != 0 || report.Summary.CurrentPallets != 2 {
		t.Fatalf("expected report current balance 0 qty / 2 pallets, got %d / %d", report.Summary.CurrentQty, report.Summary.CurrentPallets)
	}
}

func TestEntireContainerTransferUsesLockedCurrentBalancesIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "EntireTransferCustomer-"+suffix)
	fromLocation := mustCreateLocation(t, ctx, store, "EntireTransferFrom-"+suffix)
	toLocation := mustCreateLocation(t, ctx, store, "EntireTransferTo-"+suffix)
	firstSKU := mustCreateItemWithSection(t, ctx, store, customer.ID, fromLocation.ID, "ENTIRE-A-"+suffix, 0, DefaultStorageSection)
	secondSKU := mustCreateItemWithSection(t, ctx, store, customer.ID, fromLocation.ID, "ENTIRE-B-"+suffix, 0, "B")
	containerNo := "ENTIRE-" + suffix
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:     customer.ID,
		LocationID:     fromLocation.ID,
		ContainerNo:    containerNo,
		HandlingMode:   InboundHandlingModePalletized,
		StorageSection: DefaultStorageSection,
		Status:         DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{
			{SKU: firstSKU.SKU, Description: firstSKU.Description, ReceivedQty: 10, ExpectedQty: 10, Pallets: 2, StorageSection: DefaultStorageSection},
			{SKU: secondSKU.SKU, Description: secondSKU.Description, ReceivedQty: 5, ExpectedQty: 5, Pallets: 1, StorageSection: "B"},
		},
	}); err != nil {
		t.Fatalf("create multi-SKU container receipt: %v", err)
	}
	firstSource := mustFindItemByContainer(t, ctx, store, fromLocation.ID, DefaultStorageSection, containerNo, firstSKU.SKU)
	secondSource := mustFindItemByContainer(t, ctx, store, fromLocation.ID, "B", containerNo, secondSKU.SKU)

	interimLine := adjustmentLineFromItem(firstSource, 2, "stock changed after transfer screen loaded")
	interimLine.AdjustPallets = 1
	if _, err := store.CreateInventoryAdjustment(ctx, CreateInventoryAdjustmentInput{
		ReasonCode: "CORRECTION",
		Lines:      []CreateInventoryAdjustmentLineInput{interimLine},
	}); err != nil {
		t.Fatalf("create interim container adjustment: %v", err)
	}

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		EntireContainer: &CreateEntireContainerTransferInput{
			CustomerID:       customer.ID,
			LocationID:       fromLocation.ID,
			ContainerNo:      containerNo,
			ToLocationID:     toLocation.ID,
			ToStorageSection: DefaultStorageSection,
		},
	})
	if err != nil {
		t.Fatalf("create atomic entire-container transfer: %v", err)
	}
	if len(transfer.Lines) != 2 {
		t.Fatalf("expected two server-expanded transfer lines, got %d", len(transfer.Lines))
	}
	if source := mustFindItemByID(t, ctx, store, firstSource.ID); source.Quantity != 0 || source.Pallets != 0 {
		t.Fatalf("expected latest first source balance to be fully transferred, got qty=%d pallets=%d", source.Quantity, source.Pallets)
	}
	if source := mustFindItemByID(t, ctx, store, secondSource.ID); source.Quantity != 0 || source.Pallets != 0 {
		t.Fatalf("expected second source balance to be fully transferred, got qty=%d pallets=%d", source.Quantity, source.Pallets)
	}
	firstDestination := mustFindItemByContainer(t, ctx, store, toLocation.ID, DefaultStorageSection, containerNo, firstSKU.SKU)
	secondDestination := mustFindItemByContainer(t, ctx, store, toLocation.ID, DefaultStorageSection, containerNo, secondSKU.SKU)
	if firstDestination.Quantity != 12 || firstDestination.Pallets != 3 {
		t.Fatalf("expected destination to receive latest first balance 12/3, got %d/%d", firstDestination.Quantity, firstDestination.Pallets)
	}
	if secondDestination.Quantity != 5 || secondDestination.Pallets != 1 {
		t.Fatalf("expected destination to receive second balance 5/1, got %d/%d", secondDestination.Quantity, secondDestination.Pallets)
	}
}

func TestConfirmedInboundDocumentIsImmutableIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "EDIT-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Original receipt",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*5",
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 5},
				{Quantity: 5},
			},
			LineNote: "Original line",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document: %v", err)
	}

	_, err = store.UpdateInboundDocument(ctx, receipt.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-27",
		ContainerNo:         "EDIT-NEW-" + suffix,
		StorageSection:      "B",
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Corrected receipt",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			StorageSection:    "B",
			Pallets:           2,
			PalletsDetailCtns: "2*6",
			LineNote:          "Corrected line",
		}},
	})
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected confirmed inbound update to fail with ErrInvalidInput, got %v", err)
	}

	reloadedReceipt, err := store.getInboundDocument(ctx, receipt.ID)
	if err != nil {
		t.Fatalf("reload confirmed inbound document: %v", err)
	}
	if reloadedReceipt.ContainerNo != "EDIT-OLD-"+suffix {
		t.Fatalf("expected confirmed inbound container to remain unchanged, got %q", reloadedReceipt.ContainerNo)
	}
	if len(reloadedReceipt.Lines) != 1 || reloadedReceipt.Lines[0].ReceivedQty != 10 {
		t.Fatalf("expected confirmed inbound line to remain unchanged, got %#v", reloadedReceipt.Lines)
	}

	unchangedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "EDIT-OLD-"+suffix, item.SKU)
	if unchangedItem.Quantity != 10 {
		t.Fatalf("expected confirmed inbound stock to remain at original quantity 10, got %d", unchangedItem.Quantity)
	}
}

func TestConfirmedInboundDocumentNoteCanBeUpdatedIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "NOTE-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Original receipt note",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*5",
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 5},
				{Quantity: 5},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document: %v", err)
	}

	updated, err := store.UpdateInboundDocumentNote(ctx, receipt.ID, UpdateInboundDocumentNoteInput{
		DocumentNote: "Updated receipt note",
	})
	if err != nil {
		t.Fatalf("update confirmed inbound note: %v", err)
	}
	if updated.DocumentNote != "Updated receipt note" {
		t.Fatalf("expected updated note %q, got %q", "Updated receipt note", updated.DocumentNote)
	}

	unchangedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "NOTE-"+suffix, item.SKU)
	if unchangedItem.Quantity != 10 {
		t.Fatalf("expected confirmed inbound stock to remain 10 after note update, got %d", unchangedItem.Quantity)
	}
}

func TestConfirmedInboundDocumentRemainsImmutableAfterPartialConsumptionIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "USED-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Original receipt",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*5",
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 5},
				{Quantity: 5},
			},
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound receipt: %v", err)
	}

	receivedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "USED-OLD-"+suffix, item.SKU)
	if _, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "USED-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-24",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 4",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Consume part of receipt",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  receivedItem.CustomerID,
			LocationID:  receivedItem.LocationID,
			SKUMasterID: receivedItem.SKUMasterID,
			Quantity:    5,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	}); err != nil {
		t.Fatalf("create consuming outbound document: %v", err)
	}

	_, err = store.UpdateInboundDocument(ctx, receipt.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-28",
		ContainerNo:         "USED-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Metadata only correction",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       10,
			ReceivedQty:       10,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*5",
			LineNote:          "Metadata correction",
		}},
	})
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected partially consumed confirmed inbound update to fail with ErrInvalidInput, got %v", err)
	}

	remainingItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "USED-OLD-"+suffix, item.SKU)
	if remainingItem.Quantity != 5 {
		t.Fatalf("expected remaining pallet-backed quantity 5 after whole-pallet outbound, got %d", remainingItem.Quantity)
	}
	if remainingItem.DeliveryDate == nil || remainingItem.DeliveryDate.Format("2006-01-02") != "2026-03-24" {
		t.Fatalf("expected original delivery date to remain unchanged, got %+v", remainingItem.DeliveryDate)
	}
}

func TestInboundConfirmationMatchesInventoryBySKUMasterIDIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)
	containerNo := "MASTER-" + suffix

	if _, err := store.db.ExecContext(ctx, `
		UPDATE inventory_items
		SET container_no = ?
		WHERE id = ?
	`, containerNo, item.ID); err != nil {
		t.Fatalf("prepare legacy inventory row: %v", err)
	}

	receipt, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-31",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    "Matched by SKU master",
			StorageSection: DefaultStorageSection,
			ExpectedQty:    5,
			ReceivedQty:    5,
			Pallets:        1,
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound document against legacy inventory row: %v", err)
	}

	if len(receipt.Lines) != 1 {
		t.Fatalf("expected one receipt line, got %d", len(receipt.Lines))
	}

	updatedItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if updatedItem.ID != item.ID {
		t.Fatalf("expected inbound confirmation to reuse existing inventory row %d, got %d", item.ID, updatedItem.ID)
	}
	if updatedItem.Quantity != 5 {
		t.Fatalf("expected quantity 5 after inbound confirmation, got %d", updatedItem.Quantity)
	}
}

func TestCustomerItemCodesAreScopedPerCustomerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customerA := mustCreateCustomer(t, ctx, store, "Customer-A-"+suffix)
	customerB := mustCreateCustomer(t, ctx, store, "Customer-B-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	sku := "SHARED-SKU-" + suffix

	createItem := func(customerID int64, itemNumber string, skuValue string) (Item, error) {
		return store.CreateItem(ctx, CreateItemInput{
			ItemNumber:     itemNumber,
			SKU:            skuValue,
			Name:           "Shared product",
			Category:       "General",
			Description:    "Shared product",
			Unit:           "ctn",
			CustomerID:     customerID,
			LocationID:     location.ID,
			StorageSection: DefaultStorageSection,
			ContainerNo:    fmt.Sprintf("CONT-%d-%s", customerID, suffix),
		})
	}

	itemA, err := createItem(customerA.ID, "ITEM-A-"+suffix, sku)
	if err != nil {
		t.Fatalf("create customer A item: %v", err)
	}
	itemB, err := createItem(customerB.ID, "ITEM-B-"+suffix, sku)
	if err != nil {
		t.Fatalf("create customer B item with shared SKU: %v", err)
	}
	if itemA.SKUMasterID != itemB.SKUMasterID {
		t.Fatalf("expected shared product master, got %d and %d", itemA.SKUMasterID, itemB.SKUMasterID)
	}
	if itemA.ItemNumber != "ITEM-A-"+suffix || itemB.ItemNumber != "ITEM-B-"+suffix {
		t.Fatalf("expected customer-scoped item codes, got %q and %q", itemA.ItemNumber, itemB.ItemNumber)
	}

	if _, err := createItem(customerA.ID, "ITEM-A-"+suffix, "OTHER-SKU-"+suffix); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate item code within one customer to fail, got %v", err)
	}
}

func TestInboundDocumentCopyAndArchiveIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	original, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-26",
		ContainerNo:         "COPY-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Inbound copy/archive test",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			StorageSection:    DefaultStorageSection,
			Pallets:           2,
			PalletsDetailCtns: "2*6",
			LineNote:          "keep this line",
		}},
	})
	if err != nil {
		t.Fatalf("create inbound document: %v", err)
	}
	if _, err := store.ArchiveInboundDocument(ctx, original.ID); err == nil {
		t.Fatal("expected archiving a confirmed inbound document to fail")
	}

	// Copy the confirmed document before deleting it.
	copied, err := store.CopyInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("copy confirmed inbound document: %v", err)
	}
	if copied.ID == original.ID {
		t.Fatal("expected copied inbound document to have a new id")
	}
	if copied.Status != DocumentStatusDraft {
		t.Fatalf("expected copied inbound status DRAFT, got %q", copied.Status)
	}
	if copied.TrackingStatus != InboundTrackingScheduled {
		t.Fatalf("expected copied inbound tracking status %q, got %q", InboundTrackingScheduled, copied.TrackingStatus)
	}
	if len(copied.Lines) != 1 || copied.Lines[0].SKU != item.SKU {
		t.Fatalf("expected copied inbound line for %q, got %#v", item.SKU, copied.Lines)
	}

	// Delete the original document while preserving its receipt history.
	cancelled, err := store.CancelInboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("cancel inbound document: %v", err)
	}
	if cancelled.Status != DocumentStatusDeleted {
		t.Fatalf("expected deleted inbound status, got %q", cancelled.Status)
	}
	voidedContainer, err := store.GetContainerByNo(ctx, customer.ID, original.ContainerNo)
	if err != nil {
		t.Fatalf("load container after deleting inbound receipt: %v", err)
	}
	if voidedContainer.Status != ContainerStatusVoided || voidedContainer.TrackingStatus != ContainerStatusVoided {
		t.Fatalf("expected deleted receipt container to be voided, got %#v", voidedContainer)
	}
	if _, err := store.GetOperationalContainerByNo(ctx, customer.ID, original.ContainerNo); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected voided container to disappear from operational lookup, got %v", err)
	}

	// Deleted receipts remain in the audit tables but disappear from operational lists.
	inboundDocuments, err := store.ListInboundDocuments(ctx, 20)
	if err != nil {
		t.Fatalf("list inbound documents: %v", err)
	}
	if len(inboundDocuments) != 1 {
		t.Fatalf("expected only the copied inbound document in active list, got %d", len(inboundDocuments))
	}
	if inboundDocuments[0].ID != copied.ID {
		t.Fatalf("expected copied inbound document %d, got %d", copied.ID, inboundDocuments[0].ID)
	}

	// No fourth archived state remains, and all-scope still excludes deleted records.
	archivedInboundDocuments, err := store.ListInboundDocuments(ctx, 20, DocumentArchiveScopeArchived)
	if err != nil {
		t.Fatalf("list archived inbound documents: %v", err)
	}
	if len(archivedInboundDocuments) != 0 {
		t.Fatalf("expected no archived inbound documents after soft deletion, got %d", len(archivedInboundDocuments))
	}

	allInboundDocuments, err := store.ListInboundDocuments(ctx, 20, DocumentArchiveScopeAll)
	if err != nil {
		t.Fatalf("list all inbound documents: %v", err)
	}
	if len(allInboundDocuments) != 1 || allInboundDocuments[0].ID != copied.ID {
		t.Fatalf("expected only copied inbound document in all list, got %#v", allInboundDocuments)
	}
}

func TestInboundStatusCanonicalizationMigrationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Status Migration Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Status Migration Warehouse "+suffix)

	postedResult, err := store.db.ExecContext(ctx, `
		INSERT INTO inbound_documents (
			customer_id, location_id, container_no, storage_section, unit_label,
			status, tracking_status, confirmed_at, posted_at
		) VALUES (?, ?, ?, ?, 'CTN', 'POSTED', 'RECEIVED', NULL, NULL)
	`, customer.ID, location.ID, "POSTED-"+suffix, DefaultStorageSection)
	if err != nil {
		t.Fatalf("insert legacy posted receipt: %v", err)
	}
	postedID, err := postedResult.LastInsertId()
	if err != nil {
		t.Fatalf("resolve legacy posted receipt ID: %v", err)
	}

	archived, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:   customer.ID,
		LocationID:   location.ID,
		ContainerNo:  "ARCHIVED-" + suffix,
		Status:       DocumentStatusDraft,
		HandlingMode: InboundHandlingModePalletized,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            "ARCHIVED-SKU-" + suffix,
			Description:    "Archived migration item",
			ExpectedQty:    1,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create archived migration receipt: %v", err)
	}
	attachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentInbound,
		DocumentID:       archived.ID,
		DisplayName:      "Archived attachment",
		OriginalFileName: "archived.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/inbound/archived-" + suffix + ".pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create archived receipt attachment: %v", err)
	}
	if _, err := store.ArchiveInboundDocument(ctx, archived.ID); err != nil {
		t.Fatalf("archive migration receipt: %v", err)
	}

	if err := database.Migrate(store.db.DB); err != nil {
		t.Fatalf("rerun status canonicalization migration: %v", err)
	}

	var postedStatus string
	var confirmedAt sql.NullTime
	if err := store.db.QueryRowContext(ctx, `SELECT status, confirmed_at FROM inbound_documents WHERE id = ?`, postedID).Scan(&postedStatus, &confirmedAt); err != nil {
		t.Fatalf("load migrated posted receipt: %v", err)
	}
	if postedStatus != DocumentStatusConfirmed || !confirmedAt.Valid {
		t.Fatalf("expected POSTED receipt to retain a confirmation timestamp, got status=%q confirmedAt=%#v", postedStatus, confirmedAt)
	}

	var archivedStatus string
	var archivedAt sql.NullTime
	if err := store.db.QueryRowContext(ctx, `SELECT status, archived_at FROM inbound_documents WHERE id = ?`, archived.ID).Scan(&archivedStatus, &archivedAt); err != nil {
		t.Fatalf("load migrated archived receipt: %v", err)
	}
	if archivedStatus != DocumentStatusDeleted || archivedAt.Valid {
		t.Fatalf("expected archived receipt to become deleted, got status=%q archivedAt=%#v", archivedStatus, archivedAt)
	}
	assertDocumentAttachmentSoftDeleted(t, ctx, store, attachment.ID, DocumentAttachmentInbound, archived.ID)
}

func TestBulkUpdateInboundDocumentStatusIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Bulk Status Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Bulk Status Warehouse "+suffix)

	documentIDs := make([]int64, 0, 2)
	for index := 1; index <= 2; index++ {
		document, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:        customer.ID,
			LocationID:        location.ID,
			ContainerNo:       fmt.Sprintf("BULK-STATUS-%s-%d", suffix, index),
			ActualArrivalDate: "2026-07-12",
			Status:            DocumentStatusDraft,
			HandlingMode:      InboundHandlingModePalletized,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            fmt.Sprintf("BULK-STATUS-SKU-%s-%d", suffix, index),
				Description:    "Bulk status item",
				ReceivedQty:    10,
				Pallets:        2,
				StorageSection: DefaultStorageSection,
			}},
		})
		if err != nil {
			t.Fatalf("create bulk status receipt %d: %v", index, err)
		}
		documentIDs = append(documentIDs, document.ID)
	}

	confirmed, err := store.BulkUpdateInboundDocumentStatus(ctx, BulkUpdateInboundDocumentStatusInput{
		DocumentIDs: documentIDs,
		Status:      DocumentStatusConfirmed,
	})
	if err != nil {
		t.Fatalf("bulk confirm inbound documents: %v", err)
	}
	if confirmed.UpdatedDocuments != 2 {
		t.Fatalf("expected two confirmed documents, got %#v", confirmed)
	}
	for _, document := range confirmed.Documents {
		if document.Status != DocumentStatusConfirmed || document.TrackingStatus != InboundTrackingReceived {
			t.Fatalf("expected confirmed receipt, got %#v", document)
		}
	}

	deleted, err := store.BulkUpdateInboundDocumentStatus(ctx, BulkUpdateInboundDocumentStatusInput{
		DocumentIDs: documentIDs,
		Status:      DocumentStatusDeleted,
	})
	if err != nil {
		t.Fatalf("bulk delete inbound documents: %v", err)
	}
	for _, document := range deleted.Documents {
		if document.Status != DocumentStatusDeleted || document.DeletedAt == nil {
			t.Fatalf("expected soft-deleted receipt, got %#v", document)
		}
	}
}

func TestOutboundDocumentCopyAndArchiveIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 5, 13)

	original, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "COPY-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-26",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "200 Export Rd",
		ShipToContact:    "Dock 8",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Outbound copy/archive test",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     5,
			Pallets:      1,
			UnitLabel:    "CTN",
			CartonSizeMM: "500*400*300",
			LineNote:     "copy this shipment",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound document: %v", err)
	}

	// Copy the confirmed document before cancelling (cancel now hard-deletes)
	copied, err := store.CopyOutboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("copy confirmed outbound document: %v", err)
	}
	if copied.ID == original.ID {
		t.Fatal("expected copied outbound document to have a new id")
	}
	if copied.Status != DocumentStatusDraft {
		t.Fatalf("expected copied outbound status DRAFT, got %q", copied.Status)
	}
	if copied.TrackingStatus != OutboundTrackingScheduled {
		t.Fatalf("expected copied outbound tracking status %q, got %q", OutboundTrackingScheduled, copied.TrackingStatus)
	}
	if len(copied.Lines) != 1 {
		t.Fatalf("expected copied outbound document to have 1 line, got %d", len(copied.Lines))
	}
	if len(copied.Lines[0].PickAllocations) != 0 {
		t.Fatal("expected copied outbound draft to recompute pick allocations on confirm, not retain them")
	}

	// Cancel (hard-delete) the original document and all related records
	cancelled, err := store.CancelOutboundDocument(ctx, original.ID)
	if err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	if cancelled.Status != DocumentStatusDeleted {
		t.Fatalf("expected deleted outbound status, got %q", cancelled.Status)
	}

	// After cancel/hard-delete, only the copied document should remain
	outboundDocuments, err := store.ListOutboundDocuments(ctx, 20)
	if err != nil {
		t.Fatalf("list outbound documents: %v", err)
	}
	if len(outboundDocuments) != 1 {
		t.Fatalf("expected only copied outbound document to remain in active list, got %d", len(outboundDocuments))
	}
	if outboundDocuments[0].ID != copied.ID {
		t.Fatalf("expected copied outbound document %d in active list, got %d", copied.ID, outboundDocuments[0].ID)
	}

	// Archived and all-scope lists should have only the copy
	archivedOutboundDocuments, err := store.ListOutboundDocuments(ctx, 20, DocumentArchiveScopeArchived)
	if err != nil {
		t.Fatalf("list archived outbound documents: %v", err)
	}
	if len(archivedOutboundDocuments) != 0 {
		t.Fatalf("expected no archived outbound documents after hard-delete, got %d", len(archivedOutboundDocuments))
	}

	allOutboundDocuments, err := store.ListOutboundDocuments(ctx, 20, DocumentArchiveScopeAll)
	if err != nil {
		t.Fatalf("list all outbound documents: %v", err)
	}
	if len(allOutboundDocuments) != 1 {
		t.Fatalf("expected only copied outbound document in all list, got %d", len(allOutboundDocuments))
	}
}

func TestCancelDocumentsSoftDeletesAttachmentsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "AttachmentCancelCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "AttachmentCancelLoc-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "ATTACH-CANCEL-"+suffix, 10, DefaultStorageSection)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-26",
		ContainerNo:         "ATTACH-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    3,
			ReceivedQty:    3,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound document: %v", err)
	}
	inboundAttachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentInbound,
		DocumentID:       inbound.ID,
		DisplayName:      "Inbound attachment",
		OriginalFileName: "inbound.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/inbound/test.pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create inbound attachment: %v", err)
	}
	if _, err := store.CancelInboundDocument(ctx, inbound.ID); err != nil {
		t.Fatalf("cancel inbound document: %v", err)
	}
	assertDocumentAttachmentSoftDeleted(t, ctx, store, inboundAttachment.ID, DocumentAttachmentInbound, inbound.ID)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "ATTACH-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-26",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "200 Export Rd",
		ShipToContact:    "Dock 8",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    2,
			Pallets:     1,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound document: %v", err)
	}
	outboundAttachment, err := store.CreateDocumentAttachment(ctx, CreateDocumentAttachmentInput{
		DocumentType:     DocumentAttachmentOutbound,
		DocumentID:       outbound.ID,
		DisplayName:      "Outbound attachment",
		OriginalFileName: "outbound.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "speedwin-uploads",
		StorageKey:       "documents/outbound/test.pdf",
		ContentType:      "application/pdf",
		SizeBytes:        10,
	})
	if err != nil {
		t.Fatalf("create outbound attachment: %v", err)
	}
	if _, err := store.CancelOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("cancel outbound document: %v", err)
	}
	assertDocumentAttachmentSoftDeleted(t, ctx, store, outboundAttachment.ID, DocumentAttachmentOutbound, outbound.ID)
}

func TestInboundTrackingLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-25",
		ContainerNo:         "TRACK-IN-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		TrackingStatus:      InboundTrackingScheduled,
		DocumentNote:        "Inbound tracking integration test",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    8,
			ReceivedQty:    8,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound tracking document: %v", err)
	}
	if inbound.TrackingStatus != InboundTrackingScheduled {
		t.Fatalf("expected inbound tracking status %q, got %q", InboundTrackingScheduled, inbound.TrackingStatus)
	}

	inbound, err = store.UpdateInboundDocumentTrackingStatus(ctx, inbound.ID, InboundTrackingArrived)
	if err != nil {
		t.Fatalf("mark inbound arrived: %v", err)
	}
	if inbound.Status != DocumentStatusDraft || inbound.TrackingStatus != InboundTrackingArrived {
		t.Fatalf("expected inbound draft/arrived, got %q/%q", inbound.Status, inbound.TrackingStatus)
	}

	inbound, err = store.UpdateInboundDocumentTrackingStatus(ctx, inbound.ID, InboundTrackingReceiving)
	if err != nil {
		t.Fatalf("mark inbound receiving: %v", err)
	}
	if inbound.Status != DocumentStatusDraft || inbound.TrackingStatus != InboundTrackingReceiving {
		t.Fatalf("expected inbound draft/receiving, got %q/%q", inbound.Status, inbound.TrackingStatus)
	}

	inbound, err = store.UpdateInboundDocumentTrackingStatus(ctx, inbound.ID, InboundTrackingReceived)
	if err != nil {
		t.Fatalf("complete inbound receipt: %v", err)
	}
	if inbound.Status != DocumentStatusConfirmed || inbound.TrackingStatus != InboundTrackingReceived {
		t.Fatalf("expected inbound confirmed/received, got %q/%q", inbound.Status, inbound.TrackingStatus)
	}

	itemAfterReceipt := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "TRACK-IN-"+suffix, item.SKU)
	if itemAfterReceipt.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after tracked inbound completion, got %d", itemAfterReceipt.Quantity)
	}
}

func TestOutboundTrackingLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 4, 6)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "TRACK-OUT-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-25",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Local Carrier",
		Status:           DocumentStatusDraft,
		TrackingStatus:   OutboundTrackingScheduled,
		DocumentNote:     "Outbound tracking integration test",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound tracking document: %v", err)
	}
	if outbound.TrackingStatus != OutboundTrackingScheduled {
		t.Fatalf("expected outbound tracking status %q, got %q", OutboundTrackingScheduled, outbound.TrackingStatus)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking)
	if err != nil {
		t.Fatalf("mark outbound picking: %v", err)
	}
	if outbound.Status != DocumentStatusDraft || outbound.TrackingStatus != OutboundTrackingPicking {
		t.Fatalf("expected outbound draft/picking, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}
	itemAfterPicking := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterPicking.Quantity != 10 || itemAfterPicking.AllocatedQty != 4 || itemAfterPicking.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 10/4/6 after picking, got %d/%d/%d", itemAfterPicking.Quantity, itemAfterPicking.AllocatedQty, itemAfterPicking.AvailableQty)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPacked)
	if err != nil {
		t.Fatalf("mark outbound packed: %v", err)
	}
	if outbound.Status != DocumentStatusDraft || outbound.TrackingStatus != OutboundTrackingPacked {
		t.Fatalf("expected outbound draft/packed, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}
	itemAfterPacked := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterPacked.Quantity != 10 || itemAfterPacked.AllocatedQty != 4 || itemAfterPacked.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 10/4/6 after packed, got %d/%d/%d", itemAfterPacked.Quantity, itemAfterPacked.AllocatedQty, itemAfterPacked.AvailableQty)
	}

	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingShipped)
	if err != nil {
		t.Fatalf("mark outbound shipped: %v", err)
	}
	if outbound.Status != DocumentStatusConfirmed || outbound.TrackingStatus != OutboundTrackingShipped {
		t.Fatalf("expected outbound confirmed/shipped, got %q/%q", outbound.Status, outbound.TrackingStatus)
	}

	itemAfterShipment := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterShipment.Quantity != 6 || itemAfterShipment.AllocatedQty != 0 || itemAfterShipment.AvailableQty != 6 {
		t.Fatalf("expected on-hand/allocated/available 6/0/6 after tracked outbound completion, got %d/%d/%d", itemAfterShipment.Quantity, itemAfterShipment.AllocatedQty, itemAfterShipment.AvailableQty)
	}
}

func TestOutboundPickingReservationConflictIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 4, 6)

	firstOutbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "RESERVE-1-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create first outbound: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, firstOutbound.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("start picking first outbound: %v", err)
	}

	_, err = store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "RESERVE-2-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    10,
			UnitLabel:   "CTN",
		}},
	})
	if err == nil || !errors.Is(err, ErrReservedStock) {
		t.Fatalf("expected a second draft requiring reserved stock to fail with ErrReservedStock, got %v", err)
	}
}

func TestUpdateOutboundDocumentReplacesPickingReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 4, 6)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "EDIT-RESERVE-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound for reservation replacement: %v", err)
	}
	outbound, err = store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking)
	if err != nil {
		t.Fatalf("start picking outbound for reservation replacement: %v", err)
	}

	updatedOutbound, err := store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:  outbound.PackingListNo,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingPicking,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    6,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("update outbound while picking: %v", err)
	}
	if updatedOutbound.TrackingStatus != OutboundTrackingPicking {
		t.Fatalf("expected updated outbound to remain picking, got %q", updatedOutbound.TrackingStatus)
	}

	itemAfterUpdate := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterUpdate.Quantity != 10 || itemAfterUpdate.AllocatedQty != 6 || itemAfterUpdate.AvailableQty != 4 {
		t.Fatalf("expected on-hand/allocated/available 10/6/4 after reservation replacement, got %d/%d/%d", itemAfterUpdate.Quantity, itemAfterUpdate.AllocatedQty, itemAfterUpdate.AvailableQty)
	}
}

func TestCancelOutboundDocumentReleasesPickingReservationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 4, 6)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:  "CANCEL-RESERVE-" + suffix,
		Status:         DocumentStatusDraft,
		TrackingStatus: OutboundTrackingScheduled,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    4,
			UnitLabel:   "CTN",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound for cancellation: %v", err)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, outbound.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("start picking outbound for cancellation: %v", err)
	}

	if _, err := store.CancelOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("cancel picking outbound: %v", err)
	}

	itemAfterCancel := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterCancel.Quantity != 10 || itemAfterCancel.AllocatedQty != 0 || itemAfterCancel.AvailableQty != 10 {
		t.Fatalf("expected on-hand/allocated/available 10/0/10 after cancellation, got %d/%d/%d", itemAfterCancel.Quantity, itemAfterCancel.AllocatedQty, itemAfterCancel.AvailableQty)
	}
}

func TestGlobalUIPreferenceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()

	preference, err := store.GetGlobalUIPreference(ctx, "sku-master.column-order")
	if err != nil {
		t.Fatalf("get empty ui preference: %v", err)
	}
	if preference.PreferenceKey != "sku-master.column-order" {
		t.Fatalf("expected preference key to round-trip, got %q", preference.PreferenceKey)
	}

	preference, err = store.UpsertGlobalUIPreference(ctx, "sku-master.column-order", `["sku","itemNumber","description"]`, 42)
	if err != nil {
		t.Fatalf("upsert ui preference: %v", err)
	}
	if preference.ValueJSON == "" {
		t.Fatal("expected preference value json to be stored")
	}
	if preference.UpdatedByUserID != 42 {
		t.Fatalf("expected updated by user 42, got %d", preference.UpdatedByUserID)
	}

	loaded, err := store.GetGlobalUIPreference(ctx, "sku-master.column-order")
	if err != nil {
		t.Fatalf("reload ui preference: %v", err)
	}
	if loaded.ValueJSON != `["sku","itemNumber","description"]` {
		t.Fatalf("expected stored column order, got %q", loaded.ValueJSON)
	}
}

func TestBillingInvoiceSettingsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()

	settings, err := store.GetBillingInvoiceSettings(ctx)
	if err != nil {
		t.Fatalf("get default billing invoice settings: %v", err)
	}
	if settings.Header.SellerName != "Speed Inventory Management" || settings.Header.Terms != "Net 30" || settings.Header.PaymentDueDays != 30 {
		t.Fatalf("expected default billing invoice settings, got %#v", settings.Header)
	}

	settings, err = store.UpdateBillingInvoiceSettings(ctx, UpdateBillingInvoiceSettingsInput{
		Header: BillingInvoiceHeader{
			SellerName:          "",
			Subtitle:            "",
			RemitTo:             "ACH Lockbox",
			Terms:               "",
			PaymentDueDays:      0,
			PaymentInstructions: "",
		},
	}, 42)
	if err != nil {
		t.Fatalf("update billing invoice settings: %v", err)
	}
	if settings.UpdatedByUserID != 42 {
		t.Fatalf("expected updated by user 42, got %d", settings.UpdatedByUserID)
	}
	if settings.Header.SellerName != "" || settings.Header.Subtitle != "" || settings.Header.RemitTo != "ACH Lockbox" || settings.Header.Terms != "" || settings.Header.PaymentDueDays != 0 || settings.Header.PaymentInstructions != "" {
		t.Fatalf("expected blank billing invoice settings to persist, got %#v", settings.Header)
	}

	loaded, err := store.GetBillingInvoiceSettings(ctx)
	if err != nil {
		t.Fatalf("reload billing invoice settings: %v", err)
	}
	if loaded.Header.RemitTo != "ACH Lockbox" || loaded.Header.PaymentDueDays != 0 {
		t.Fatalf("expected stored billing invoice settings, got %#v", loaded.Header)
	}
}

func TestInboundDocumentSupportsMultipleSectionsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-24",
		ContainerNo:         "CONT-MULTI-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Multi-section receipt",
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			},
			{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    7,
				ReceivedQty:    7,
				Pallets:        1,
				StorageSection: "B",
			},
		},
	})
	if err != nil {
		t.Fatalf("create confirmed inbound with multiple sections: %v", err)
	}
	if inbound.TotalReceivedQty != 12 {
		t.Fatalf("expected total received qty 12, got %d", inbound.TotalReceivedQty)
	}
	if len(inbound.Lines) != 2 {
		t.Fatalf("expected 2 inbound lines, got %d", len(inbound.Lines))
	}

	itemSectionTemp := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-MULTI-"+suffix, item.SKU)
	if itemSectionTemp.Quantity != 5 {
		t.Fatalf("expected temporary section quantity 5, got %d", itemSectionTemp.Quantity)
	}
	itemSectionB := mustFindItemByContainer(t, ctx, store, location.ID, "B", "CONT-MULTI-"+suffix, item.SKU)
	if itemSectionB.Quantity != 7 {
		t.Fatalf("expected section B quantity 7, got %d", itemSectionB.Quantity)
	}
}

func TestDraftDocumentUpdateIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0)

	inbound, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-22",
		ContainerNo:         "CONT-OLD-" + suffix,
		StorageSection:      DefaultStorageSection,
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		DocumentNote:        "Inbound draft before edit",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    10,
			ReceivedQty:    10,
			StorageSection: DefaultStorageSection,
		}},
	})
	if err != nil {
		t.Fatalf("create inbound draft: %v", err)
	}

	inbound, err = store.UpdateInboundDocument(ctx, inbound.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-EDIT-" + suffix,
		StorageSection:      "B",
		UnitLabel:           "CTN",
		Status:              DocumentStatusDraft,
		DocumentNote:        "Inbound draft edited",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       12,
			ReceivedQty:       12,
			StorageSection:    "B",
			Pallets:           2,
			PalletsDetailCtns: "2*6",
			LineNote:          "Updated receipt line",
		}},
	})
	if err != nil {
		t.Fatalf("update inbound draft: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected updated inbound to remain draft, got %q", inbound.Status)
	}
	if inbound.ContainerNo != "CONT-EDIT-"+suffix {
		t.Fatalf("expected updated inbound container, got %q", inbound.ContainerNo)
	}
	if inbound.TotalReceivedQty != 12 {
		t.Fatalf("expected updated inbound received qty 12, got %d", inbound.TotalReceivedQty)
	}
	itemAfterInboundDraft := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterInboundDraft.Quantity != 0 {
		t.Fatalf("expected on-hand 0 after inbound draft edit, got %d", itemAfterInboundDraft.Quantity)
	}

	inbound, err = store.UpdateInboundDocument(ctx, inbound.ID, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-EDIT-" + suffix,
		StorageSection:      "B",
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		DocumentNote:        "Inbound draft confirmed from edit",
		Lines: []CreateInboundDocumentLineInput{{
			SKU:               item.SKU,
			Description:       item.Description,
			ExpectedQty:       8,
			ReceivedQty:       8,
			StorageSection:    "B",
			Pallets:           2,
			PalletsDetailCtns: "2*4",
			PalletBreakdown: []InboundPalletBreakdown{
				{Quantity: 4},
				{Quantity: 4},
			},
			LineNote: "Confirm edited receipt line",
		}},
	})
	if err != nil {
		t.Fatalf("confirm inbound via update: %v", err)
	}
	if !strings.EqualFold(inbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected inbound confirmed via update, got %q", inbound.Status)
	}
	itemAfterInboundConfirm := mustFindItemByContainer(t, ctx, store, location.ID, "B", "CONT-EDIT-"+suffix, item.SKU)
	if itemAfterInboundConfirm.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after inbound confirm via update, got %d", itemAfterInboundConfirm.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Dock Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Outbound draft before edit",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   itemAfterInboundConfirm.CustomerID,
			LocationID:   itemAfterInboundConfirm.LocationID,
			SKUMasterID:  itemAfterInboundConfirm.SKUMasterID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft: %v", err)
	}

	outbound, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:    "PL-EDIT-" + suffix,
		OrderRef:         "SO-EDIT-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Edited Receiver " + suffix,
		ShipToAddress:    "456 Dock Ln",
		ShipToContact:    "Dock 4",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Outbound draft edited",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   itemAfterInboundConfirm.CustomerID,
			LocationID:   itemAfterInboundConfirm.LocationID,
			SKUMasterID:  itemAfterInboundConfirm.SKUMasterID,
			Quantity:     5,
			UnitLabel:    "CTN",
			CartonSizeMM: "420*310*210",
			LineNote:     "Updated shipment line",
		}},
	})
	if err != nil {
		t.Fatalf("update outbound draft: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusDraft) {
		t.Fatalf("expected updated outbound to remain draft, got %q", outbound.Status)
	}
	if outbound.PackingListNo != "PL-EDIT-"+suffix {
		t.Fatalf("expected updated outbound packing list no, got %q", outbound.PackingListNo)
	}
	if outbound.TotalQty != 5 {
		t.Fatalf("expected updated outbound qty 5, got %d", outbound.TotalQty)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected edited outbound draft to defer pick allocations until confirm")
	}
	itemAfterOutboundDraft := mustFindItemByID(t, ctx, store, itemAfterInboundConfirm.ID)
	if itemAfterOutboundDraft.Quantity != 8 {
		t.Fatalf("expected on-hand 8 after outbound draft edit, got %d", itemAfterOutboundDraft.Quantity)
	}

	outbound, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:    "PL-EDIT-" + suffix,
		OrderRef:         "SO-FINAL-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Final Receiver " + suffix,
		ShipToAddress:    "789 Dock Ln",
		ShipToContact:    "Dock 8",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Outbound draft confirmed from edit",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   itemAfterInboundConfirm.CustomerID,
			LocationID:   itemAfterInboundConfirm.LocationID,
			SKUMasterID:  itemAfterInboundConfirm.SKUMasterID,
			Quantity:     4,
			UnitLabel:    "CTN",
			CartonSizeMM: "420*310*210",
			LineNote:     "Confirm edited shipment line",
		}},
	})
	if err != nil {
		t.Fatalf("confirm outbound via update: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected outbound confirmed via update, got %q", outbound.Status)
	}
	itemAfterOutboundConfirm := mustFindItemByID(t, ctx, store, itemAfterInboundConfirm.ID)
	if itemAfterOutboundConfirm.Quantity != 4 {
		t.Fatalf("expected on-hand 4 after outbound confirm via update, got %d", itemAfterOutboundConfirm.Quantity)
	}
}

func TestOutboundAutoAllocationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	itemA := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 5, DefaultStorageSection)
	itemB := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 7, "B")

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-SPLIT-" + suffix,
		OrderRef:         "SO-SPLIT-" + suffix,
		ExpectedShipDate: "2026-03-22",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Split allocation integration test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
				Quantity:     12,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create split outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 {
		t.Fatalf("expected 1 outbound line, got %d", len(outbound.Lines))
	}
	if len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound to defer split pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm split outbound document: %v", err)
	}
	if !strings.EqualFold(outbound.Status, DocumentStatusConfirmed) {
		t.Fatalf("expected outbound status CONFIRMED, got %q", outbound.Status)
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}

	itemAAfter := mustFindItemByID(t, ctx, store, itemA.ID)
	itemBAfter := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemAAfter.Quantity+itemBAfter.Quantity != 0 {
		t.Fatalf("expected all allocated quantity to be shipped, got remaining quantity %d", itemAAfter.Quantity+itemBAfter.Quantity)
	}

	cancelled, err := store.CancelOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("cancel split outbound document: %v", err)
	}
	if !strings.EqualFold(cancelled.Status, DocumentStatusDeleted) {
		t.Fatalf("expected deleted outbound status, got %q", cancelled.Status)
	}

	itemARestored := mustFindItemByID(t, ctx, store, itemA.ID)
	if itemARestored.Quantity != 5 {
		t.Fatalf("expected source item A restored to 5, got %d", itemARestored.Quantity)
	}

	itemBRestored := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemBRestored.Quantity != 7 {
		t.Fatalf("expected source item B restored to 7, got %d", itemBRestored.Quantity)
	}
}

func TestConfirmedOutboundDocumentIsImmutableIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 3, 5)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Dock Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Immutable outbound baseline",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound: %v", err)
	}

	_, err = store.UpdateOutboundDocument(ctx, outbound.ID, CreateOutboundDocumentInput{
		PackingListNo:    "PL-EDIT-" + suffix,
		OrderRef:         "SO-EDIT-" + suffix,
		ExpectedShipDate: "2026-03-24",
		ShipToName:       "Edited Receiver " + suffix,
		ShipToAddress:    "456 Dock Ln",
		ShipToContact:    "Dock 4",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Should be rejected",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     1,
			UnitLabel:    "CTN",
			CartonSizeMM: "420*310*210",
		}},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput when editing confirmed outbound, got %v", err)
	}

	reloaded, err := store.getOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("reload confirmed outbound: %v", err)
	}
	if reloaded.PackingListNo != "PL-"+suffix {
		t.Fatalf("expected confirmed outbound packing list to remain unchanged, got %q", reloaded.PackingListNo)
	}
	if reloaded.TotalQty != 3 {
		t.Fatalf("expected confirmed outbound quantity to remain 3, got %d", reloaded.TotalQty)
	}

	itemAfter := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfter.Quantity != 5 {
		t.Fatalf("expected on-hand quantity 5 after immutable confirmed outbound, got %d", itemAfter.Quantity)
	}
}

func TestConfirmedOutboundDocumentNoteCanBeUpdatedIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, DefaultStorageSection, 3, 5)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-" + suffix,
		OrderRef:         "SO-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Dock Ln",
		ShipToContact:    "Dock 3",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Original note",
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:   item.CustomerID,
			LocationID:   item.LocationID,
			SKUMasterID:  item.SKUMasterID,
			Quantity:     3,
			UnitLabel:    "CTN",
			CartonSizeMM: "400*300*200",
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound: %v", err)
	}

	updated, err := store.UpdateOutboundDocumentNote(ctx, outbound.ID, UpdateOutboundDocumentNoteInput{
		DocumentNote: "Updated note",
	})
	if err != nil {
		t.Fatalf("update confirmed outbound note: %v", err)
	}
	if updated.DocumentNote != "Updated note" {
		t.Fatalf("expected updated note %q, got %q", "Updated note", updated.DocumentNote)
	}
	if updated.TotalQty != 3 {
		t.Fatalf("expected confirmed outbound quantity to remain 3, got %d", updated.TotalQty)
	}

	itemAfter := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfter.Quantity != 5 {
		t.Fatalf("expected on-hand quantity 5 after note update, got %d", itemAfter.Quantity)
	}
}

func TestOutboundAutoAllocationFromMergedContainerLedgerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-A-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    6,
			ReceivedQty:    6,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create first inbound receipt: %v", err)
	}
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-B-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    4,
			ReceivedQty:    4,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create second inbound receipt: %v", err)
	}

	itemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-A-"+suffix, item.SKU)
	itemB := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-B-"+suffix, item.SKU)
	if itemA.Quantity+itemB.Quantity != 10 {
		t.Fatalf("expected total pallet-backed quantity 10 across containers, got %d", itemA.Quantity+itemB.Quantity)
	}

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-MERGED-" + suffix,
		OrderRef:         "SO-MERGED-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Merged container allocation test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
				Quantity:     10,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create merged outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 {
		t.Fatalf("expected 1 outbound line, got %d", len(outbound.Lines))
	}
	if len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound to defer pallet-backed pick allocations, got %d", len(outbound.Lines[0].PickAllocations))
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm merged outbound document: %v", err)
	}
	if len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed pick allocations from pallet-backed container balances, got %d", len(outbound.Lines[0].PickAllocations))
	}

	itemAAfter := mustFindItemByID(t, ctx, store, itemA.ID)
	itemBAfter := mustFindItemByID(t, ctx, store, itemB.ID)
	if itemAAfter.Quantity+itemBAfter.Quantity != 0 {
		t.Fatalf("expected all allocated quantity to be shipped, got remaining quantity %d", itemAAfter.Quantity+itemBAfter.Quantity)
	}
}

func TestOutboundAutoContainerAllocationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-A-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    1,
			ReceivedQty:    1,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create first inbound receipt: %v", err)
	}
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         "CONT-B-" + suffix,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    9,
			ReceivedQty:    9,
			Pallets:        3,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create second inbound receipt: %v", err)
	}

	itemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-A-"+suffix, item.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-MANUAL-" + suffix,
		OrderRef:         "SO-MANUAL-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Automatic container allocation test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
				Quantity:     4,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create automatic outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 0 {
		t.Fatalf("expected draft outbound to defer pick allocations until confirm, got %+v", outbound.Lines)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm automatic outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 2 {
		t.Fatalf("expected 2 confirmed auto pick allocations, got %+v", outbound.Lines)
	}
	if outbound.Lines[0].PickAllocations[0].ContainerNo != "CONT-A-"+suffix || outbound.Lines[0].PickAllocations[0].AllocatedQty != 1 || outbound.Lines[0].PickAllocations[0].Pallets != 1 {
		t.Fatalf("expected confirmed first auto allocation CONT-A qty 1, got %+v", outbound.Lines[0].PickAllocations[0])
	}
	if outbound.Lines[0].PickAllocations[1].ContainerNo != "CONT-B-"+suffix || outbound.Lines[0].PickAllocations[1].AllocatedQty != 3 || outbound.Lines[0].PickAllocations[1].Pallets != 1 {
		t.Fatalf("expected confirmed second auto allocation CONT-B qty 3, got %+v", outbound.Lines[0].PickAllocations[1])
	}

	itemAfterConfirm := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterConfirm.Quantity != 0 {
		t.Fatalf("expected original seed row to stay empty in pallet-centric flow, got %d", itemAfterConfirm.Quantity)
	}

	itemBAfter := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-B-"+suffix, item.SKU)
	if itemBAfter.Quantity != 6 {
		t.Fatalf("expected CONT-B to retain 6 units after confirm, got %d", itemBAfter.Quantity)
	}

	itemsAfterConfirm, err := store.ListItems(ctx, ItemFilters{LocationID: location.ID})
	if err != nil {
		t.Fatalf("list items after auto allocation confirm: %v", err)
	}
	totalRemainingQty := 0
	for _, listedItem := range itemsAfterConfirm {
		if listedItem.SKU != item.SKU {
			continue
		}
		totalRemainingQty += listedItem.Quantity
	}
	if totalRemainingQty != 6 {
		t.Fatalf("expected total remaining pallet-backed quantity 6 after confirm, got %d", totalRemainingQty)
	}

	var containerStatus string
	if err := store.db.GetContext(ctx, &containerStatus, `
		SELECT status
		FROM containers
		WHERE customer_id = ? AND container_no = ?
	`, customer.ID, "CONT-B-"+suffix); err != nil {
		t.Fatalf("load partially outbound container status: %v", err)
	}
	if containerStatus != "PARTIALLY_OUTBOUND" {
		t.Fatalf("expected CONT-B status PARTIALLY_OUTBOUND, got %s", containerStatus)
	}

	movements, err := store.ListMovements(ctx, 20)
	if err != nil {
		t.Fatalf("list movements after auto allocation confirm: %v", err)
	}

	var movementContainers []string
	for _, movement := range movements {
		if movement.OutboundDocumentID == outbound.ID && movement.MovementType == "OUT" {
			movementContainers = append(movementContainers, movement.ContainerNo)
		}
	}
	if !containsString(movementContainers, "CONT-A-"+suffix) || !containsString(movementContainers, "CONT-B-"+suffix) {
		t.Fatalf("expected outbound movements to preserve auto-allocated containers, got %v", movementContainers)
	}
}

func TestBulkOutboundFindsRemoteContainerAndTransfersWhenDraftConfirmedIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Bulk 308 Customer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "Overflow-"+suffix)
	mainLocation := mustCreateLocation(t, ctx, store, MainOutboundWarehouseCode)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, sourceLocation.ID, "SKU-BULK-308-"+suffix, 0, DefaultStorageSection)
	containerNo := "CONT-BULK-308-" + suffix
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          sourceLocation.ID,
		ExpectedArrivalDate: "2026-07-01",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU: item.SKU, Description: item.Description, ExpectedQty: 10, ReceivedQty: 10, Pallets: 2, StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("seed remote inbound stock: %v", err)
	}
	pickingOrderNo := "PO-BULK-308-" + suffix
	preview, err := store.buildOutboundBulkImportPreview(ctx, "bulk-308.xlsx", customer.ID, []OutboundBulkImportDocumentPreview{{
		DocumentKey:    "ROW-2",
		PickingOrderNo: pickingOrderNo,
		ActualShipDate: "2026-07-15",
		RowNumbers:     []int{2},
		Lines: []OutboundBulkImportLinePreview{{
			RowNumber:        2,
			Warehouse:        mainLocation.Name,
			SourceContainer:  containerNo,
			StorageSection:   DefaultStorageSection,
			SKU:              item.SKU,
			Quantity:         4,
			InventoryPallets: 1,
			OutboundPallets:  3,
		}},
	}})
	if err != nil {
		t.Fatalf("preview remote inventory for warehouse 308: %v", err)
	}
	if preview.ValidDocuments != 1 || len(preview.Documents) != 1 || !preview.Documents[0].Valid {
		t.Fatalf("expected remote container to produce a valid 308 preview: %#v", preview)
	}
	previewDocument := preview.Documents[0]
	if previewDocument.TransferLines != 1 || !previewDocument.Lines[0].RequiresTransfer || len(previewDocument.Input.Lines) != 1 {
		t.Fatalf("expected preview to mark one pending automatic transfer: %#v", previewDocument)
	}
	previewAllocation := previewDocument.Input.Lines[0].PickAllocations[0]
	if previewAllocation.LocationID != sourceLocation.ID || !previewAllocation.AutoTransferToMain {
		t.Fatalf("expected preview to retain and mark the actual remote allocation: %#v", previewAllocation)
	}

	response, err := store.CreateOutboundDocumentsBulkDraft(ctx, OutboundBulkImportCommitInput{
		ImportID:       "0123456789abcdef0123456789abcdef",
		SourceFileName: "bulk-308.xlsx",
		CustomerID:     customer.ID,
		Documents: []OutboundBulkImportCommitDocument{{
			DocumentKey: previewDocument.DocumentKey,
			Input:       previewDocument.Input,
		}},
	})
	if err != nil {
		t.Fatalf("create bulk outbound draft with transfer: %v", err)
	}
	if response.CreatedDocuments != 1 || len(response.Results) != 1 || !response.Results[0].Success || response.Results[0].TransferLines != 1 {
		t.Fatalf("unexpected bulk outbound response: %#v", response)
	}
	document := response.Results[0].Document
	if document == nil || len(document.Lines) != 1 || document.Lines[0].LocationID != sourceLocation.ID || len(document.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected draft to retain its actual remote source: %#v", document)
	}
	allocation := document.Lines[0].PickAllocations[0]
	if allocation.LocationID != sourceLocation.ID || allocation.ContainerNo != containerNo || !allocation.AutoTransferToMain {
		t.Fatalf("unexpected pending remote outbound allocation: %#v", allocation)
	}

	editedInput := previewDocument.Input
	editedInput.Lines[0].PickAllocations[0].AutoTransferToMain = false
	editedDocument, err := store.UpdateOutboundDocument(ctx, document.ID, editedInput)
	if err != nil {
		t.Fatalf("save edited bulk outbound draft without transfer marker: %v", err)
	}
	if len(editedDocument.Lines) != 1 || len(editedDocument.Lines[0].PickAllocations) != 1 || !editedDocument.Lines[0].PickAllocations[0].AutoTransferToMain {
		t.Fatalf("expected draft edit to preserve the pending automatic transfer: %#v", editedDocument)
	}
	document = &editedDocument

	remainingSource := mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, containerNo, item.SKU)
	if remainingSource.Quantity != 10 || remainingSource.Pallets != 2 {
		t.Fatalf("expected draft creation to leave source balance at 10 CTN / 2 pallets, got %d / %d", remainingSource.Quantity, remainingSource.Pallets)
	}
	if _, err := store.UpdateOutboundDocumentTrackingStatus(ctx, document.ID, OutboundTrackingPicking); err != nil {
		t.Fatalf("reserve remote inventory before confirmation: %v", err)
	}
	var transferCountBeforeConfirm int
	if err := store.db.GetContext(ctx, &transferCountBeforeConfirm, `
		SELECT COUNT(*) FROM inventory_transfers WHERE notes LIKE ?
	`, "%"+pickingOrderNo+"%"); err != nil {
		t.Fatalf("count transfers before confirmation: %v", err)
	}
	if transferCountBeforeConfirm != 0 {
		t.Fatalf("expected no automatic transfer before confirmation, got %d", transferCountBeforeConfirm)
	}

	confirmed, err := store.ConfirmOutboundDocument(ctx, document.ID)
	if err != nil {
		t.Fatalf("confirm warehouse 308 outbound draft: %v", err)
	}
	if len(confirmed.Lines) != 1 || confirmed.Lines[0].LocationID != mainLocation.ID || len(confirmed.Lines[0].PickAllocations) != 1 {
		t.Fatalf("expected confirmed outbound to ship from warehouse 308: %#v", confirmed)
	}
	confirmedAllocation := confirmed.Lines[0].PickAllocations[0]
	if confirmedAllocation.LocationID != mainLocation.ID || confirmedAllocation.AutoTransferToMain {
		t.Fatalf("expected confirmed allocation to be staged at 308 with no pending marker: %#v", confirmedAllocation)
	}

	remainingSource = mustFindItemByContainer(t, ctx, store, sourceLocation.ID, DefaultStorageSection, containerNo, item.SKU)
	if remainingSource.Quantity != 6 || remainingSource.Pallets != 1 {
		t.Fatalf("expected confirmation to transfer and ship 4 CTN / 1 pallet, got source balance %d / %d", remainingSource.Quantity, remainingSource.Pallets)
	}
	var transferCountAfterConfirm int
	if err := store.db.GetContext(ctx, &transferCountAfterConfirm, `
		SELECT COUNT(*) FROM inventory_transfers WHERE notes LIKE ?
	`, "%"+pickingOrderNo+"%"); err != nil {
		t.Fatalf("count transfers after confirmation: %v", err)
	}
	if transferCountAfterConfirm != 1 {
		t.Fatalf("expected one automatic transfer during confirmation, got %d", transferCountAfterConfirm)
	}
}

func TestOutboundTracksQtyAndPalletsWithoutPerPalletQuantityIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)
	containerNo := "CONT-WHOLE-PALLET-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:            item.SKU,
			Description:    item.Description,
			ExpectedQty:    9,
			ReceivedQty:    9,
			Pallets:        1,
			StorageSection: DefaultStorageSection,
		}},
	}); err != nil {
		t.Fatalf("create inbound receipt: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-PARTIAL-PALLET-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		Status:           DocumentStatusDraft,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  sourceItem.CustomerID,
			LocationID:  sourceItem.LocationID,
			SKUMasterID: sourceItem.SKUMasterID,
			Quantity:    4,
			Pallets:     1,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{{
				LocationID:     sourceItem.LocationID,
				LocationName:   sourceItem.LocationName,
				StorageSection: sourceItem.StorageSection,
				ContainerNo:    sourceItem.ContainerNo,
				AllocatedQty:   4,
				Pallets:        1,
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create outbound draft: %v", err)
	}

	if _, err := store.ConfirmOutboundDocument(ctx, outbound.ID); err != nil {
		t.Fatalf("confirm outbound with independent Qty and Pallets: %v", err)
	}

	itemAfter := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if itemAfter.Quantity != 5 || itemAfter.Pallets != 0 || itemAfter.AllocatedQty != 0 {
		t.Fatalf("expected independent balances of 5 CTN and 0 pallets, got quantity=%d pallets=%d allocated=%d", itemAfter.Quantity, itemAfter.Pallets, itemAfter.AllocatedQty)
	}
}

func TestOutboundPreservesDeclaredPalletCountWithoutChoosingPalletCombinationIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithPalletQuantities(
		t,
		ctx,
		store,
		customer.ID,
		location.ID,
		"SKU-"+suffix,
		DefaultStorageSection,
		6,
		3,
		3,
	)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-QTY-PALLET-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		Status:           DocumentStatusConfirmed,
		TrackingStatus:   OutboundTrackingShipped,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  item.CustomerID,
			LocationID:  item.LocationID,
			SKUMasterID: item.SKUMasterID,
			Quantity:    6,
			Pallets:     2,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{{
				LocationID:     item.LocationID,
				LocationName:   item.LocationName,
				StorageSection: item.StorageSection,
				ContainerNo:    item.ContainerNo,
				AllocatedQty:   6,
				Pallets:        2,
			}},
		}},
	})
	if err != nil {
		t.Fatalf("create confirmed outbound with independent Qty and Pallets: %v", err)
	}
	if len(outbound.Lines) != 1 || outbound.Lines[0].Pallets != 2 {
		t.Fatalf("expected outbound to preserve the declared two-pallet selection, got %+v", outbound.Lines)
	}

	remaining := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, item.ContainerNo, item.SKU)
	if remaining.Quantity != 6 || remaining.Pallets != 1 {
		t.Fatalf("expected independent balances of 6 CTN and 1 pallet, got quantity=%d pallets=%d", remaining.Quantity, remaining.Pallets)
	}
}

func TestOutboundRejectsPalletCountAboveContainerBalanceIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)
	containerNo := "CONT-PALLET-LIMIT-" + suffix
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
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
		t.Fatalf("create inbound receipt: %v", err)
	}

	sourceItem := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	_, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-PALLET-LIMIT-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		Status:           DocumentStatusConfirmed,
		TrackingStatus:   OutboundTrackingShipped,
		Lines: []CreateOutboundDocumentLineInput{{
			CustomerID:  sourceItem.CustomerID,
			LocationID:  sourceItem.LocationID,
			SKUMasterID: sourceItem.SKUMasterID,
			Quantity:    1,
			Pallets:     3,
			UnitLabel:   "CTN",
			PickAllocations: []OutboundPickAllocation{{
				LocationID:     sourceItem.LocationID,
				LocationName:   sourceItem.LocationName,
				StorageSection: sourceItem.StorageSection,
				ContainerNo:    sourceItem.ContainerNo,
				AllocatedQty:   1,
				Pallets:        3,
			}},
		}},
	})
	if !errors.Is(err, ErrInsufficientStock) {
		t.Fatalf("expected pallet balance validation to return ErrInsufficientStock, got %v", err)
	}

	remaining := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, item.SKU)
	if remaining.Quantity != 10 || remaining.Pallets != 2 {
		t.Fatalf("expected rejected outbound to preserve 10 CTN and 2 pallets, got quantity=%d pallets=%d", remaining.Quantity, remaining.Pallets)
	}
}

func TestOutboundAutoContainerAllocationPreservesActualPalletCountsPerContainerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItemWithSection(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 0, DefaultStorageSection)

	seedInbound := func(containerNo string, receivedQty int, pallets int) {
		t.Helper()
		if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
			CustomerID:          customer.ID,
			LocationID:          location.ID,
			ExpectedArrivalDate: "2026-03-23",
			ContainerNo:         containerNo,
			StorageSection:      DefaultStorageSection,
			Status:              DocumentStatusConfirmed,
			Lines: []CreateInboundDocumentLineInput{{
				SKU:            item.SKU,
				Description:    item.Description,
				ExpectedQty:    receivedQty,
				ReceivedQty:    receivedQty,
				Pallets:        pallets,
				StorageSection: DefaultStorageSection,
			}},
		}); err != nil {
			t.Fatalf("create inbound receipt %s: %v", containerNo, err)
		}
	}

	seedInbound("CONT-1-"+suffix, 10, 1)
	seedInbound("CONT-2-"+suffix, 20, 2)
	seedInbound("CONT-3-"+suffix, 30, 3)

	itemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, "CONT-1-"+suffix, item.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-SPLIT-" + suffix,
		OrderRef:         "SO-SPLIT-" + suffix,
		ExpectedShipDate: "2026-03-23",
		ShipToName:       "Receiver " + suffix,
		ShipToAddress:    "123 Warehouse Ln",
		ShipToContact:    "Dock 5",
		CarrierName:      "Internal Fleet",
		Status:           DocumentStatusDraft,
		DocumentNote:     "Actual pallet counts per container test",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:   itemA.CustomerID,
				LocationID:   itemA.LocationID,
				SKUMasterID:  itemA.SKUMasterID,
				Quantity:     60,
				UnitLabel:    "CTN",
				CartonSizeMM: "400*300*200",
			},
		},
	})
	if err != nil {
		t.Fatalf("create split-container outbound document: %v", err)
	}

	outbound, err = store.ConfirmOutboundDocument(ctx, outbound.ID)
	if err != nil {
		t.Fatalf("confirm split-container outbound document: %v", err)
	}
	if len(outbound.Lines) != 1 || len(outbound.Lines[0].PickAllocations) != 3 {
		t.Fatalf("expected 3 confirmed split-container pick allocations, got %+v", outbound.Lines)
	}

	palletsByContainer := make(map[string]int, len(outbound.Lines[0].PickAllocations))
	for _, allocation := range outbound.Lines[0].PickAllocations {
		palletsByContainer[allocation.ContainerNo] = allocation.Pallets
	}

	if palletsByContainer["CONT-1-"+suffix] != 1 {
		t.Fatalf("expected CONT-1 pallet count 1, got %d", palletsByContainer["CONT-1-"+suffix])
	}
	if palletsByContainer["CONT-2-"+suffix] != 2 {
		t.Fatalf("expected CONT-2 pallet count 2, got %d", palletsByContainer["CONT-2-"+suffix])
	}
	if palletsByContainer["CONT-3-"+suffix] != 3 {
		t.Fatalf("expected CONT-3 pallet count 3, got %d", palletsByContainer["CONT-3-"+suffix])
	}
}

func TestOutboundConfirmedSubmissionAllowsDifferentSKUsFromSameContainerIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	itemA := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-A-"+suffix, 0)
	itemB := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-B-"+suffix, 0)
	containerNo := "CONT-MULTI-SKU-" + suffix

	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customer.ID,
		LocationID:          location.ID,
		ExpectedArrivalDate: "2026-03-23",
		ContainerNo:         containerNo,
		StorageSection:      DefaultStorageSection,
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{
			{
				SKU:            itemA.SKU,
				Description:    itemA.Description,
				ExpectedQty:    5,
				ReceivedQty:    5,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			},
			{
				SKU:            itemB.SKU,
				Description:    itemB.Description,
				ExpectedQty:    7,
				ReceivedQty:    7,
				Pallets:        1,
				StorageSection: DefaultStorageSection,
			},
		},
	}); err != nil {
		t.Fatalf("create inbound receipt for multi-sku container: %v", err)
	}

	sourceItemA := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, itemA.SKU)
	sourceItemB := mustFindItemByContainer(t, ctx, store, location.ID, DefaultStorageSection, containerNo, itemB.SKU)

	outbound, err := store.CreateOutboundDocument(ctx, CreateOutboundDocumentInput{
		PackingListNo:    "PL-MULTI-SKU-" + suffix,
		OrderRef:         "SO-MULTI-SKU-" + suffix,
		ExpectedShipDate: "2026-03-24",
		Status:           DocumentStatusConfirmed,
		DocumentNote:     "Ship two SKUs from the same container",
		Lines: []CreateOutboundDocumentLineInput{
			{
				CustomerID:  sourceItemA.CustomerID,
				LocationID:  sourceItemA.LocationID,
				SKUMasterID: sourceItemA.SKUMasterID,
				Quantity:    5,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
			{
				CustomerID:  sourceItemB.CustomerID,
				LocationID:  sourceItemB.LocationID,
				SKUMasterID: sourceItemB.SKUMasterID,
				Quantity:    7,
				Pallets:     1,
				UnitLabel:   "CTN",
			},
		},
	})
	if err != nil {
		t.Fatalf("confirm outbound shipment for multi-sku container: %v", err)
	}

	if normalizeDocumentStatus(outbound.Status) != DocumentStatusConfirmed {
		t.Fatalf("expected outbound document to be confirmed, got %s", outbound.Status)
	}
	if len(outbound.Lines) != 2 {
		t.Fatalf("expected 2 outbound lines, got %d", len(outbound.Lines))
	}

	for _, line := range outbound.Lines {
		if len(line.PickAllocations) != 1 {
			t.Fatalf("expected one pallet-backed pick allocation for line %d, got %+v", line.ID, line.PickAllocations)
		}
		allocation := line.PickAllocations[0]
		if allocation.ContainerNo != containerNo {
			t.Fatalf("expected allocation container %s, got %+v", containerNo, allocation)
		}
	}
}

func TestInventoryTransferIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	sourceLocation := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	destinationLocation := mustCreateLocation(t, ctx, store, "LA-"+suffix)
	sourceItem := mustCreateItem(t, ctx, store, customer.ID, sourceLocation.ID, "SKU-"+suffix, 12)

	transfer, err := store.CreateInventoryTransfer(ctx, CreateInventoryTransferInput{
		TransferNo: "TR-" + suffix,
		Notes:      "Transfer integration test",
		Lines: []CreateInventoryTransferLineInput{
			transferLineFromItem(sourceItem, 5, destinationLocation.ID, "B", "Move to west warehouse"),
		},
	})
	if err != nil {
		t.Fatalf("create inventory transfer: %v", err)
	}
	if !strings.EqualFold(transfer.Status, "POSTED") {
		t.Fatalf("expected transfer status POSTED, got %q", transfer.Status)
	}
	if len(transfer.Lines) != 1 {
		t.Fatalf("expected 1 transfer line, got %d", len(transfer.Lines))
	}

	sourceAfter := mustFindItemByID(t, ctx, store, sourceItem.ID)
	if sourceAfter.Quantity != 7 {
		t.Fatalf("expected source quantity 7, got %d", sourceAfter.Quantity)
	}

	destinationItem := mustFindItemByLocationAndSection(t, ctx, store, destinationLocation.ID, "B", sourceItem.SKU)
	if destinationItem.Quantity != 5 {
		t.Fatalf("expected destination quantity 5, got %d", destinationItem.Quantity)
	}

	movements, err := store.ListMovements(ctx, 50)
	if err != nil {
		t.Fatalf("list movements: %v", err)
	}
	var transferOutSeen bool
	var transferInSeen bool
	for _, movement := range movements {
		if movement.MovementType == "TRANSFER_OUT" {
			transferOutSeen = true
		}
		if movement.MovementType == "TRANSFER_IN" {
			transferInSeen = true
		}
	}
	if !transferOutSeen || !transferInSeen {
		t.Fatalf("expected pallet-centric transfer activity feed entries, got %+v", movements)
	}
}

func TestCycleCountIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "Customer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "NJ-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "SKU-"+suffix, 10)
	line := cycleCountLineFromItem(item, 7, "Three units missing")

	count, err := store.CreateCycleCount(ctx, CreateCycleCountInput{
		CountNo: "CC-" + suffix,
		Notes:   "Cycle count integration test",
		Lines: []CreateCycleCountLineInput{
			line,
		},
	})
	if err != nil {
		t.Fatalf("create cycle count: %v", err)
	}
	if !strings.EqualFold(count.Status, "POSTED") {
		t.Fatalf("expected cycle count status POSTED, got %q", count.Status)
	}
	if len(count.Lines) != 1 {
		t.Fatalf("expected 1 cycle count line, got %d", len(count.Lines))
	}
	if count.Lines[0].VarianceQty != -3 {
		t.Fatalf("expected variance -3, got %d", count.Lines[0].VarianceQty)
	}

	itemAfterCount := mustFindItemByID(t, ctx, store, item.ID)
	if itemAfterCount.Quantity != 7 {
		t.Fatalf("expected on-hand 7 after cycle count, got %d", itemAfterCount.Quantity)
	}

	movements, err := store.ListMovements(ctx, 50)
	if err != nil {
		t.Fatalf("list movements: %v", err)
	}
	var countSeen bool
	for _, movement := range movements {
		if movement.MovementType == "COUNT" {
			countSeen = true
			break
		}
	}
	if !countSeen {
		t.Fatalf("expected container-centric cycle count activity feed entry, got %+v", movements)
	}
}

func TestCycleCountDoesNotRequirePalletEntityIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	customer := mustCreateCustomer(t, ctx, store, "CountPalletRequiredCustomer-"+suffix)
	location := mustCreateLocation(t, ctx, store, "CountPalletRequiredLocation-"+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "COUNT-PALLET-REQ-"+suffix, 10)

	if _, err := store.CreateCycleCount(ctx, CreateCycleCountInput{
		CountNo: "CC-PALLET-REQ-" + suffix,
		Lines: []CreateCycleCountLineInput{
			cycleCountLineFromItem(item, 7, "missing pallet"),
		},
	}); err != nil {
		t.Fatalf("expected cycle count without pallet entity to succeed, got %v", err)
	}
}

func TestUserManagementIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	canSelfRegister, err := store.CanSelfRegister(ctx)
	if err != nil {
		t.Fatalf("check self register availability: %v", err)
	}
	if !canSelfRegister {
		t.Fatal("expected self registration to be allowed for an empty system")
	}

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "admin-" + suffix + "@example.com",
		FullName: "Admin " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register initial admin: %v", err)
	}
	if authPayload.User.Role != RoleAdmin {
		t.Fatalf("expected first user role admin, got %q", authPayload.User.Role)
	}
	if !authPayload.User.IsActive {
		t.Fatal("expected initial admin to be active")
	}

	canSelfRegister, err = store.CanSelfRegister(ctx)
	if err != nil {
		t.Fatalf("check self register availability after bootstrap: %v", err)
	}
	if canSelfRegister {
		t.Fatal("expected self registration to be disabled once a user exists")
	}

	managedUser, err := store.CreateManagedUser(ctx, CreateManagedUserInput{
		Email:    "viewer-" + suffix + "@example.com",
		FullName: "Viewer " + suffix,
		Password: "password123",
		Role:     RoleViewer,
		IsActive: true,
	})
	if err != nil {
		t.Fatalf("create managed user: %v", err)
	}
	if managedUser.Role != RoleViewer {
		t.Fatalf("expected viewer role, got %q", managedUser.Role)
	}

	users, err := store.ListUsers(ctx)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}

	updatedUser, err := store.UpdateUserAccess(ctx, authPayload.User.ID, managedUser.ID, UpdateUserAccessInput{
		Role:     RoleOperator,
		IsActive: false,
	})
	if err != nil {
		t.Fatalf("update user access: %v", err)
	}
	if updatedUser.Role != RoleOperator {
		t.Fatalf("expected operator role after update, got %q", updatedUser.Role)
	}
	if updatedUser.IsActive {
		t.Fatal("expected updated user to be inactive")
	}

	if _, err := store.UpdateUserAccess(ctx, authPayload.User.ID, authPayload.User.ID, UpdateUserAccessInput{
		Role:     RoleViewer,
		IsActive: true,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected self-demotion to fail with ErrInvalidInput, got %v", err)
	}

	if _, err := store.UpdateUserAccess(ctx, authPayload.User.ID, authPayload.User.ID, UpdateUserAccessInput{
		Role:     RoleAdmin,
		IsActive: false,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected self-deactivation to fail with ErrInvalidInput, got %v", err)
	}

	portalCustomer := mustCreateCustomer(t, ctx, store, "PortalUserCustomer-"+suffix)
	portalUser, err := store.CreateManagedUser(ctx, CreateManagedUserInput{
		Email:      "portal-" + suffix + "@example.com",
		FullName:   "Portal " + suffix,
		Password:   "password123",
		Role:       RoleCustomer,
		IsActive:   true,
		CustomerID: portalCustomer.ID,
	})
	if err != nil {
		t.Fatalf("create portal user: %v", err)
	}

	if err := store.DeleteCustomer(ctx, portalCustomer.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleting customer with portal users to fail with ErrInvalidInput, got %v", err)
	}

	if _, err := store.UpdateUserAccess(ctx, authPayload.User.ID, portalUser.ID, UpdateUserAccessInput{
		Role:     RoleViewer,
		IsActive: true,
	}); err != nil {
		t.Fatalf("unbind portal user from customer: %v", err)
	}

	if err := store.DeleteCustomer(ctx, portalCustomer.ID); err != nil {
		t.Fatalf("delete customer after unbinding portal user: %v", err)
	}
}

func TestAuthSessionLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	adminPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "admin-" + suffix + "@example.com",
		FullName: "Admin " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}

	operator, err := store.CreateManagedUser(ctx, CreateManagedUserInput{
		Email:    "operator-" + suffix + "@example.com",
		FullName: "Operator " + suffix,
		Password: "password123",
		Role:     RoleOperator,
		IsActive: true,
	})
	if err != nil {
		t.Fatalf("create operator: %v", err)
	}

	loginPayload, sessionToken, err := store.Login(ctx, LoginInput{
		Email:    operator.Email,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("login operator: %v", err)
	}
	if loginPayload.User.Role != RoleOperator {
		t.Fatalf("expected operator role after login, got %q", loginPayload.User.Role)
	}
	if strings.TrimSpace(sessionToken) == "" {
		t.Fatal("expected non-empty session token")
	}

	resolvedPayload, err := store.GetUserBySessionToken(ctx, sessionToken)
	if err != nil {
		t.Fatalf("resolve session token: %v", err)
	}
	if resolvedPayload.User.Email != operator.Email {
		t.Fatalf("expected resolved session user %q, got %q", operator.Email, resolvedPayload.User.Email)
	}

	if err := store.Logout(ctx, sessionToken); err != nil {
		t.Fatalf("logout session: %v", err)
	}
	if _, err := store.GetUserBySessionToken(ctx, sessionToken); err == nil || !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected logged out session token to be invalid, got %v", err)
	}

	_, err = store.UpdateUserAccess(ctx, adminPayload.User.ID, operator.ID, UpdateUserAccessInput{
		Role:     RoleOperator,
		IsActive: false,
	})
	if err != nil {
		t.Fatalf("deactivate operator: %v", err)
	}

	if _, _, err := store.Login(ctx, LoginInput{
		Email:    operator.Email,
		Password: "password123",
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected inactive operator login to fail with ErrInvalidInput, got %v", err)
	}
}

func TestStorageSettlementInvoiceLifecycleIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-" + suffix + "@example.com",
		FullName: "Billing " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing user: %v", err)
	}

	customerA := mustCreateCustomer(t, ctx, store, "Billing Customer A "+suffix)
	customerB := mustCreateCustomer(t, ctx, store, "Billing Customer B "+suffix)
	locationA := mustCreateLocation(t, ctx, store, "Billing NJ "+suffix)
	locationB := mustCreateLocation(t, ctx, store, "Billing LA "+suffix)

	input := CreateBillingInvoiceInput{
		InvoiceType:         BillingInvoiceTypeStorage,
		CustomerID:          customerA.ID,
		CustomerName:        customerA.Name,
		WarehouseLocationID: int64Ptr(locationA.ID),
		WarehouseName:       locationA.Name,
		ContainerType:       "NORMAL",
		PeriodStart:         "2026-03-01",
		PeriodEnd:           "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:         450,
			TransferInboundFeePerPallet: 10,
			WrappingFeePerPallet:        15,
			StorageFeePerPalletWeek:     7,
			OutboundFeePerPallet:        0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "STORAGE",
				Description: "Storage settlement for CONT-A",
				Reference:   "Storage | CONT-A",
				ContainerNo: "CONT-A",
				Warehouse:   locationA.Name,
				OccurredOn:  "2026-03-31",
				Quantity:    140,
				UnitRate:    1,
				Amount:      140,
				Notes:       "14 days x 10 pallets",
				SourceType:  "AUTO",
			},
		},
	}

	firstInvoice, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create first storage settlement invoice: %v", err)
	}
	if firstInvoice.InvoiceType != BillingInvoiceTypeStorage {
		t.Fatalf("expected storage settlement invoice type, got %q", firstInvoice.InvoiceType)
	}
	if firstInvoice.WarehouseLocationID == nil || *firstInvoice.WarehouseLocationID != locationA.ID {
		t.Fatalf("expected warehouse scope %d on first invoice, got %#v", locationA.ID, firstInvoice.WarehouseLocationID)
	}
	if firstInvoice.LineCount != 1 {
		t.Fatalf("expected 1 line on storage settlement invoice, got %d", firstInvoice.LineCount)
	}

	if _, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected duplicate storage settlement invoice to fail with ErrInvalidInput, got %v", err)
	}

	inputDifferentRange := input
	inputDifferentRange.PeriodEnd = "2026-04-30"
	if _, err := store.CreateBillingInvoice(ctx, inputDifferentRange, authPayload.User.ID); err != nil {
		t.Fatalf("create storage settlement invoice for different range: %v", err)
	}

	inputDifferentCustomer := input
	inputDifferentCustomer.CustomerID = customerB.ID
	inputDifferentCustomer.CustomerName = customerB.Name
	if _, err := store.CreateBillingInvoice(ctx, inputDifferentCustomer, authPayload.User.ID); err != nil {
		t.Fatalf("create storage settlement invoice for different customer: %v", err)
	}

	inputDifferentWarehouse := input
	inputDifferentWarehouse.WarehouseLocationID = int64Ptr(locationB.ID)
	inputDifferentWarehouse.WarehouseName = locationB.Name
	if _, err := store.CreateBillingInvoice(ctx, inputDifferentWarehouse, authPayload.User.ID); err != nil {
		t.Fatalf("create storage settlement invoice for different warehouse: %v", err)
	}

	voidedInvoice, err := store.VoidBillingInvoice(ctx, firstInvoice.ID)
	if err != nil {
		t.Fatalf("void first storage settlement invoice: %v", err)
	}
	if voidedInvoice.Status != BillingInvoiceStatusVoid {
		t.Fatalf("expected voided invoice status VOID, got %q", voidedInvoice.Status)
	}

	recreated, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID)
	if err != nil {
		t.Fatalf("recreate storage settlement invoice after void: %v", err)
	}
	if recreated.Status != BillingInvoiceStatusDraft {
		t.Fatalf("expected recreated invoice status DRAFT, got %q", recreated.Status)
	}
}

func TestBillingInvoiceDraftEditsRecalculateTotalsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-draft-" + suffix + "@example.com",
		FullName: "Billing Draft " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing draft user: %v", err)
	}

	customer := mustCreateCustomer(t, ctx, store, "Billing Draft Customer "+suffix)
	input := CreateBillingInvoiceInput{
		InvoiceType:  BillingInvoiceTypeMixed,
		CustomerID:   customer.ID,
		CustomerName: customer.Name,
		PeriodStart:  "2026-03-01",
		PeriodEnd:    "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:     450,
			WrappingFeePerPallet:    15,
			StorageFeePerPalletWeek: 7,
			OutboundFeePerPallet:    0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "INBOUND",
				Description: "Inbound fee",
				Quantity:    1,
				UnitRate:    450,
				Amount:      450,
				SourceType:  "AUTO",
			},
			{
				ChargeType:  "STORAGE",
				Description: "Storage fee",
				Quantity:    140,
				UnitRate:    1,
				Amount:      140,
				SourceType:  "AUTO",
			},
			{
				ChargeType:  "DISCOUNT",
				Description: "Courtesy discount",
				Quantity:    1,
				UnitRate:    -20,
				Amount:      -20,
				SourceType:  "MANUAL",
			},
		},
	}

	invoice, err := store.CreateBillingInvoice(ctx, input, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create mixed billing invoice: %v", err)
	}
	if invoice.Subtotal != 590 {
		t.Fatalf("expected subtotal 590 after create, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -20 {
		t.Fatalf("expected discount total -20 after create, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 570 {
		t.Fatalf("expected grand total 570 after create, got %.2f", invoice.GrandTotal)
	}
	if invoice.Rates.TransferInboundFeePerPallet != 10 {
		t.Fatalf("expected transfer inbound default 10, got %.2f", invoice.Rates.TransferInboundFeePerPallet)
	}
	if invoice.Rates.StorageFeePerPalletWeekNormal != 7 || invoice.Rates.StorageFeePerPalletWeekWestCoastTransfer != 7 {
		t.Fatalf("expected normalized storage rates of 7, got normal=%.2f west=%.2f", invoice.Rates.StorageFeePerPalletWeekNormal, invoice.Rates.StorageFeePerPalletWeekWestCoastTransfer)
	}

	updatedHeader := BillingInvoiceHeader{
		SellerName:          "SIM Logistics LLC",
		Subtitle:            "Warehouse services invoice",
		RemitTo:             "SIM Logistics LLC - ACH 1234",
		Terms:               "Net 15",
		PaymentDueDays:      15,
		PaymentInstructions: "Send ACH payment and reference the invoice number.",
	}
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Header: &updatedHeader})
	if err != nil {
		t.Fatalf("update invoice header: %v", err)
	}
	if invoice.Header.SellerName != "SIM Logistics LLC" || invoice.Header.Terms != "Net 15" || invoice.Header.PaymentDueDays != 15 {
		t.Fatalf("expected persisted invoice header update, got %#v", invoice.Header)
	}

	updatedCustomerName := "Imperial Bag & Paper - Billing"
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{CustomerName: &updatedCustomerName})
	if err != nil {
		t.Fatalf("update invoice customer name: %v", err)
	}
	if invoice.CustomerNameSnapshot != updatedCustomerName {
		t.Fatalf("expected persisted invoice customer name %q, got %q", updatedCustomerName, invoice.CustomerNameSnapshot)
	}

	blankHeader := BillingInvoiceHeader{}
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Header: &blankHeader})
	if err != nil {
		t.Fatalf("update invoice header with blank values: %v", err)
	}
	if invoice.Header.SellerName != "" || invoice.Header.Terms != "" || invoice.Header.PaymentDueDays != 0 || invoice.Header.PaymentInstructions != "" {
		t.Fatalf("expected blank invoice header fields to persist, got %#v", invoice.Header)
	}

	findLine := func(chargeType string) BillingInvoiceLine {
		t.Helper()
		for _, line := range invoice.Lines {
			if line.ChargeType == chargeType {
				return line
			}
		}
		t.Fatalf("find line %s: not found", chargeType)
		return BillingInvoiceLine{}
	}

	inboundLine := findLine("INBOUND")
	storageLine := findLine("STORAGE")
	discountLine := findLine("DISCOUNT")

	invoice, err = store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType:  "OUTBOUND",
		Description: "Outbound fee",
		Quantity:    1,
		UnitRate:    30.555,
		Amount:      30.555,
		Notes:       "Rounded outbound charge",
	})
	if err != nil {
		t.Fatalf("add outbound billing line: %v", err)
	}
	if invoice.Subtotal != 620.56 {
		t.Fatalf("expected subtotal 620.56 after add, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -20 {
		t.Fatalf("expected discount total -20 after add, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 600.56 {
		t.Fatalf("expected grand total 600.56 after add, got %.2f", invoice.GrandTotal)
	}

	var outboundLine BillingInvoiceLine
	foundOutbound := false
	for _, line := range invoice.Lines {
		if line.ChargeType == "OUTBOUND" {
			outboundLine = line
			foundOutbound = true
			break
		}
	}
	if !foundOutbound {
		t.Fatal("expected outbound line to be present after add")
	}
	if outboundLine.Amount != 30.56 {
		t.Fatalf("expected rounded outbound line amount 30.56, got %.2f", outboundLine.Amount)
	}

	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, storageLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "STORAGE",
		Description: "Storage fee revised",
		Quantity:    155.25,
		UnitRate:    1,
		Amount:      155.25,
	})
	if err != nil {
		t.Fatalf("update storage billing line: %v", err)
	}
	if invoice.Subtotal != 635.81 {
		t.Fatalf("expected subtotal 635.81 after storage update, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -20 {
		t.Fatalf("expected discount total -20 after storage update, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 615.81 {
		t.Fatalf("expected grand total 615.81 after storage update, got %.2f", invoice.GrandTotal)
	}

	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, discountLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "DISCOUNT",
		Description: "Courtesy discount revised",
		Quantity:    1,
		UnitRate:    -35.10,
		Amount:      -35.10,
	})
	if err != nil {
		t.Fatalf("update discount billing line: %v", err)
	}
	if invoice.Subtotal != 635.81 {
		t.Fatalf("expected subtotal 635.81 after discount update, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -35.10 {
		t.Fatalf("expected discount total -35.10 after discount update, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 600.71 {
		t.Fatalf("expected grand total 600.71 after discount update, got %.2f", invoice.GrandTotal)
	}

	invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, inboundLine.ID)
	if err != nil {
		t.Fatalf("delete inbound billing line: %v", err)
	}
	if invoice.LineCount != 3 {
		t.Fatalf("expected 3 lines after delete, got %d", invoice.LineCount)
	}
	if invoice.Subtotal != 185.81 {
		t.Fatalf("expected subtotal 185.81 after delete, got %.2f", invoice.Subtotal)
	}
	if invoice.DiscountTotal != -35.10 {
		t.Fatalf("expected discount total -35.10 after delete, got %.2f", invoice.DiscountTotal)
	}
	if invoice.GrandTotal != 150.71 {
		t.Fatalf("expected grand total 150.71 after delete, got %.2f", invoice.GrandTotal)
	}

	invoice, err = store.FinalizeBillingInvoice(ctx, invoice.ID, authPayload.User.ID)
	if err != nil {
		t.Fatalf("finalize billing invoice: %v", err)
	}
	if invoice.Status != BillingInvoiceStatusFinalized {
		t.Fatalf("expected finalized invoice status, got %q", invoice.Status)
	}

	blockedNotes := "blocked"
	if _, err := store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Notes: &blockedNotes}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected updating finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	blockedHeader := BillingInvoiceHeader{Terms: "Due on receipt", PaymentDueDays: 1}
	if _, err := store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{Header: &blockedHeader}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected updating finalized invoice header to fail with ErrInvalidInput, got %v", err)
	}
	if _, err := store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType:  "OUTBOUND",
		Description: "blocked",
		Quantity:    1,
		UnitRate:    1,
		Amount:      1,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected adding line to finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	if _, err := store.UpdateBillingInvoiceLine(ctx, invoice.ID, storageLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "STORAGE",
		Description: "blocked",
		Quantity:    1,
		UnitRate:    1,
		Amount:      1,
	}); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected updating line on finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	if _, err := store.DeleteBillingInvoiceLine(ctx, invoice.ID, storageLine.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleting line on finalized invoice to fail with ErrInvalidInput, got %v", err)
	}
	if err := store.DeleteBillingInvoice(ctx, invoice.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected deleting finalized invoice to fail with ErrInvalidInput, got %v", err)
	}

	paidInvoice, err := store.MarkBillingInvoicePaid(ctx, invoice.ID)
	if err != nil {
		t.Fatalf("mark billing invoice paid: %v", err)
	}
	if paidInvoice.Status != BillingInvoiceStatusPaid {
		t.Fatalf("expected paid invoice status, got %q", paidInvoice.Status)
	}
}

func TestBillingInvoiceTotalsRemainLineDerivedAcrossMutationsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-totals-" + suffix + "@example.com",
		FullName: "Billing Totals " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing totals user: %v", err)
	}

	customer := mustCreateCustomer(t, ctx, store, "Billing Totals Customer "+suffix)
	invoice, err := store.CreateBillingInvoice(ctx, CreateBillingInvoiceInput{
		InvoiceType:  BillingInvoiceTypeMixed,
		CustomerID:   customer.ID,
		CustomerName: customer.Name,
		PeriodStart:  "2026-03-01",
		PeriodEnd:    "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:                      450,
			TransferInboundFeePerPallet:              10,
			WrappingFeePerPallet:                     15,
			StorageFeePerPalletWeekNormal:            7,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
			OutboundFeePerPallet:                     0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "INBOUND",
				Description: "Inbound charge",
				Quantity:    1,
				UnitRate:    450,
				Amount:      450,
				SourceType:  "AUTO",
			},
			{
				ChargeType:  "MANUAL",
				Description: "Handling charge",
				Quantity:    2,
				UnitRate:    10,
				Amount:      20.005,
				SourceType:  "MANUAL",
			},
			{
				ChargeType:  "DISCOUNT",
				Description: "Opening discount",
				Quantity:    1,
				UnitRate:    -5.555,
				Amount:      -5.555,
				SourceType:  "MANUAL",
			},
		},
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create billing totals invoice: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	mustFindLine := func(description string) BillingInvoiceLine {
		t.Helper()
		for _, line := range invoice.Lines {
			if line.Description == description {
				return line
			}
		}
		t.Fatalf("billing invoice line %q not found", description)
		return BillingInvoiceLine{}
	}

	if _, err := store.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET subtotal = 999.99, discount_total = 888.88, grand_total = 777.77
		WHERE id = ?
	`, invoice.ID); err != nil {
		t.Fatalf("corrupt billing invoice totals before mutation: %v", err)
	}

	handlingLine := mustFindLine("Handling charge")
	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, handlingLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "MANUAL",
		Description: "Handling charge adjusted",
		Quantity:    3,
		UnitRate:    10.004,
		Amount:      30.012,
	})
	if err != nil {
		t.Fatalf("update handling charge after corrupt totals: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)
	if invoice.Subtotal == 999.99 || invoice.DiscountTotal == 888.88 || invoice.GrandTotal == 777.77 {
		t.Fatalf("expected line update to recalculate corrupted invoice totals, got subtotal=%.2f discount=%.2f grand=%.2f", invoice.Subtotal, invoice.DiscountTotal, invoice.GrandTotal)
	}

	handlingLine = mustFindLine("Handling charge adjusted")
	invoice, err = store.UpdateBillingInvoiceLine(ctx, invoice.ID, handlingLine.ID, UpdateBillingInvoiceLineInput{
		ChargeType:  "DISCOUNT",
		Description: "Handling charge converted to discount",
		Quantity:    1,
		UnitRate:    -12.345,
		Amount:      -12.345,
	})
	if err != nil {
		t.Fatalf("convert handling charge to discount: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	invoice, err = store.AddBillingInvoiceLine(ctx, invoice.ID, AddBillingInvoiceLineInput{
		ChargeType:  "MANUAL",
		Description: "Negative manual adjustment",
		Quantity:    1,
		UnitRate:    -1.235,
		Amount:      -1.235,
	})
	if err != nil {
		t.Fatalf("add negative manual adjustment: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	openingDiscountLine := mustFindLine("Opening discount")
	invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, openingDiscountLine.ID)
	if err != nil {
		t.Fatalf("delete opening discount: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	notes := "Totals invariant metadata update"
	customerName := "Billing Totals Customer Override"
	header := BillingInvoiceHeader{
		SellerName:          "SIM Billing",
		Subtitle:            "",
		RemitTo:             "SIM ACH",
		Terms:               "Due on receipt",
		PaymentDueDays:      0,
		PaymentInstructions: "",
	}
	invoice, err = store.UpdateBillingInvoice(ctx, invoice.ID, UpdateBillingInvoiceInput{
		CustomerName: &customerName,
		Notes:        &notes,
		Header:       &header,
	})
	if err != nil {
		t.Fatalf("update invoice metadata without changing totals: %v", err)
	}
	assertBillingInvoiceTotalsConsistent(t, invoice)

	for _, line := range append([]BillingInvoiceLine(nil), invoice.Lines...) {
		invoice, err = store.DeleteBillingInvoiceLine(ctx, invoice.ID, line.ID)
		if err != nil {
			t.Fatalf("delete line %d while clearing invoice: %v", line.ID, err)
		}
		assertBillingInvoiceTotalsConsistent(t, invoice)
	}
	if invoice.LineCount != 0 {
		t.Fatalf("expected cleared invoice line count 0, got %d", invoice.LineCount)
	}
	assertMoneyEqual(t, "cleared invoice subtotal", invoice.Subtotal, 0)
	assertMoneyEqual(t, "cleared invoice discount total", invoice.DiscountTotal, 0)
	assertMoneyEqual(t, "cleared invoice grand total", invoice.GrandTotal, 0)
}

func TestBillingInvoicePersistsStorageDetailSnapshotsIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	authPayload, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "billing-details-" + suffix + "@example.com",
		FullName: "Billing Details " + suffix,
		Password: "password123",
	})
	if err != nil {
		t.Fatalf("register billing details user: %v", err)
	}

	customer := mustCreateCustomer(t, ctx, store, "Billing Details Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Billing Details NJ "+suffix)

	details := json.RawMessage(`{
		"kind":"STORAGE_CONTAINER_SUMMARY",
		"warehouseLocationId":1,
		"warehouseName":"NJ",
		"warehousesTouched":["NJ"],
		"palletsTracked":2,
		"palletDays":31,
		"freePalletDays":7,
		"billablePalletDays":24,
		"grossAmount":31,
		"discountAmount":7,
		"segments":[
			{
				"startDate":"2026-03-01",
				"endDate":"2026-03-07",
				"dayEndPallets":1,
				"billedDays":7,
				"palletDays":7,
				"freePalletDays":7,
				"billablePalletDays":0,
				"grossAmount":7,
				"discountAmount":7,
				"amount":0
			},
			{
				"startDate":"2026-03-08",
				"endDate":"2026-03-31",
				"dayEndPallets":1,
				"billedDays":24,
				"palletDays":24,
				"freePalletDays":0,
				"billablePalletDays":24,
				"grossAmount":24,
				"discountAmount":0,
				"amount":24
			}
		]
	}`)

	invoice, err := store.CreateBillingInvoice(ctx, CreateBillingInvoiceInput{
		InvoiceType:         BillingInvoiceTypeStorage,
		CustomerID:          customer.ID,
		CustomerName:        customer.Name,
		WarehouseLocationID: int64Ptr(location.ID),
		WarehouseName:       location.Name,
		ContainerType:       ContainerTypeNormal,
		PeriodStart:         "2026-03-01",
		PeriodEnd:           "2026-03-31",
		Rates: BillingRatesSnapshot{
			InboundContainerFee:                      450,
			TransferInboundFeePerPallet:              10,
			WrappingFeePerPallet:                     15,
			StorageFeePerPalletWeekNormal:            7,
			StorageFeePerPalletWeekWestCoastTransfer: 7,
			OutboundFeePerPallet:                     0,
		},
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "STORAGE",
				Description: "Storage settlement for CONT-DETAIL",
				Reference:   "Storage | CONT-DETAIL",
				ContainerNo: "CONT-DETAIL",
				Warehouse:   location.Name,
				OccurredOn:  "2026-03-31",
				Quantity:    24,
				UnitRate:    1,
				Amount:      24,
				SourceType:  "AUTO",
				Details:     details,
			},
		},
	}, authPayload.User.ID)
	if err != nil {
		t.Fatalf("create storage invoice with details: %v", err)
	}

	if len(invoice.Lines) != 1 {
		t.Fatalf("expected 1 line on details invoice, got %d", len(invoice.Lines))
	}
	if len(invoice.Lines[0].Details) == 0 {
		t.Fatal("expected storage invoice line details to be persisted")
	}

	var decoded map[string]any
	if err := json.Unmarshal(invoice.Lines[0].Details, &decoded); err != nil {
		t.Fatalf("decode persisted storage line details: %v", err)
	}
	if decoded["kind"] != "STORAGE_CONTAINER_SUMMARY" {
		t.Fatalf("expected details kind STORAGE_CONTAINER_SUMMARY, got %#v", decoded["kind"])
	}
	if decoded["palletDays"] != float64(31) {
		t.Fatalf("expected palletDays 31 in stored details, got %#v", decoded["palletDays"])
	}
	if decoded["billablePalletDays"] != float64(24) {
		t.Fatalf("expected billablePalletDays 24 in stored details, got %#v", decoded["billablePalletDays"])
	}
	segments, ok := decoded["segments"].([]any)
	if !ok || len(segments) != 2 {
		t.Fatalf("expected 2 stored detail segments, got %#v", decoded["segments"])
	}

	invalidInput := CreateBillingInvoiceInput{
		InvoiceType:         BillingInvoiceTypeStorage,
		CustomerID:          customer.ID,
		CustomerName:        customer.Name,
		WarehouseLocationID: int64Ptr(location.ID),
		WarehouseName:       location.Name,
		ContainerType:       ContainerTypeNormal,
		PeriodStart:         "2026-04-01",
		PeriodEnd:           "2026-04-30",
		Rates:               invoice.Rates,
		Lines: []CreateBillingInvoiceLineInput{
			{
				ChargeType:  "STORAGE",
				Description: "Invalid details",
				Quantity:    1,
				UnitRate:    1,
				Amount:      1,
				SourceType:  "AUTO",
				Details:     json.RawMessage(`{"kind":`),
			},
		},
	}
	if _, err := store.CreateBillingInvoice(ctx, invalidInput, authPayload.User.ID); err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid details JSON to fail with ErrInvalidInput, got %v", err)
	}
}

func assertDocumentAttachmentSoftDeleted(t *testing.T, ctx context.Context, store *Store, attachmentID int64, documentType string, documentID int64) {
	t.Helper()

	attachments, err := store.ListDocumentAttachments(ctx, documentType, documentID)
	if err != nil {
		t.Fatalf("list document attachments after cancel: %v", err)
	}
	if len(attachments) != 0 {
		t.Fatalf("expected cancelled document attachments to be hidden, got %d", len(attachments))
	}

	var deletedAt sql.NullTime
	if err := store.db.QueryRowxContext(ctx, `
		SELECT deleted_at
		FROM document_attachments
		WHERE id = ?
	`, attachmentID).Scan(&deletedAt); err != nil {
		t.Fatalf("load cancelled document attachment %d: %v", attachmentID, err)
	}
	if !deletedAt.Valid {
		t.Fatalf("expected attachment %d to be soft deleted", attachmentID)
	}
}

func mustCreateCustomer(t *testing.T, ctx context.Context, store *Store, name string) Customer {
	t.Helper()
	customer, err := store.CreateCustomer(ctx, CreateCustomerInput{Name: name})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	return customer
}

func mustCreateLocation(t *testing.T, ctx context.Context, store *Store, name string) Location {
	t.Helper()
	location, err := store.CreateLocation(ctx, CreateLocationInput{
		Name:         name,
		Address:      name + " address",
		Capacity:     100,
		SectionNames: []string{DefaultStorageSection, "B"},
	})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}
	return location
}

func int64Ptr(value int64) *int64 {
	return &value
}

func mustCreateItem(t *testing.T, ctx context.Context, store *Store, customerID int64, locationID int64, sku string, quantity int) Item {
	t.Helper()
	return mustCreateItemWithSection(t, ctx, store, customerID, locationID, sku, quantity, DefaultStorageSection)
}

func mustCreateItemWithSection(t *testing.T, ctx context.Context, store *Store, customerID int64, locationID int64, sku string, quantity int, section string) Item {
	t.Helper()
	item, err := store.CreateItem(ctx, CreateItemInput{
		SKU:            sku,
		Description:    "Integration test item " + sku,
		Quantity:       quantity,
		ReorderLevel:   1,
		CustomerID:     customerID,
		LocationID:     locationID,
		StorageSection: section,
		ContainerNo:    "CONT-" + sku + "-" + section,
		Unit:           "pcs",
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	return item
}

func mustCreateItemWithPalletQuantities(
	t *testing.T,
	ctx context.Context,
	store *Store,
	customerID int64,
	locationID int64,
	sku string,
	section string,
	quantities ...int,
) Item {
	t.Helper()
	item := mustCreateItemWithSection(t, ctx, store, customerID, locationID, sku, 0, section)
	totalQty := 0
	breakdown := make([]InboundPalletBreakdown, 0, len(quantities))
	for _, quantity := range quantities {
		if quantity <= 0 {
			t.Fatalf("pallet quantity must be positive, got %d", quantity)
		}
		totalQty += quantity
		breakdown = append(breakdown, InboundPalletBreakdown{Quantity: quantity})
	}
	if len(breakdown) == 0 {
		t.Fatal("at least one pallet quantity is required")
	}
	containerNo := "PT-" + integrationSuffix()
	if _, err := store.CreateInboundDocument(ctx, CreateInboundDocumentInput{
		CustomerID:          customerID,
		LocationID:          locationID,
		ExpectedArrivalDate: "2026-03-20",
		ContainerNo:         containerNo,
		StorageSection:      section,
		UnitLabel:           "CTN",
		Status:              DocumentStatusConfirmed,
		Lines: []CreateInboundDocumentLineInput{{
			SKU:             item.SKU,
			Description:     item.Description,
			ExpectedQty:     totalQty,
			ReceivedQty:     totalQty,
			Pallets:         len(breakdown),
			StorageSection:  section,
			PalletBreakdown: breakdown,
		}},
	}); err != nil {
		t.Fatalf("create palletized item %s: %v", sku, err)
	}
	return mustFindItemByContainer(t, ctx, store, locationID, section, containerNo, sku)
}

func adjustmentLineFromItem(item Item, adjustQty int, lineNote string) CreateInventoryAdjustmentLineInput {
	return CreateInventoryAdjustmentLineInput{
		CustomerID:     item.CustomerID,
		LocationID:     item.LocationID,
		StorageSection: item.StorageSection,
		ContainerNo:    item.ContainerNo,
		SKUMasterID:    item.SKUMasterID,
		AdjustQty:      adjustQty,
		LineNote:       lineNote,
	}
}

func transferLineFromItem(item Item, quantity int, toLocationID int64, toStorageSection string, lineNote string) CreateInventoryTransferLineInput {
	return CreateInventoryTransferLineInput{
		CustomerID:       item.CustomerID,
		LocationID:       item.LocationID,
		StorageSection:   item.StorageSection,
		ContainerNo:      item.ContainerNo,
		SKUMasterID:      item.SKUMasterID,
		Quantity:         quantity,
		ToLocationID:     toLocationID,
		ToStorageSection: toStorageSection,
		LineNote:         lineNote,
	}
}

func cycleCountLineFromItem(item Item, countedQty int, lineNote string) CreateCycleCountLineInput {
	return CreateCycleCountLineInput{
		CustomerID:     item.CustomerID,
		LocationID:     item.LocationID,
		StorageSection: item.StorageSection,
		ContainerNo:    item.ContainerNo,
		SKUMasterID:    item.SKUMasterID,
		CountedQty:     countedQty,
		LineNote:       lineNote,
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func mustFindItemByID(t *testing.T, ctx context.Context, store *Store, itemID int64) Item {
	t.Helper()
	item, err := store.getItem(ctx, itemID)
	if err != nil {
		t.Fatalf("get item %d: %v", itemID, err)
	}
	return item
}

func mustFindItemByLocationAndSection(t *testing.T, ctx context.Context, store *Store, locationID int64, section string, sku string) Item {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{LocationID: locationID})
	if err != nil {
		t.Fatalf("list items by location: %v", err)
	}
	for _, item := range items {
		if item.LocationID == locationID && strings.EqualFold(item.StorageSection, section) && item.SKU == sku {
			return item
		}
	}
	t.Fatalf("item %s at location %d section %s not found", sku, locationID, section)
	return Item{}
}

func mustFindItemByContainer(t *testing.T, ctx context.Context, store *Store, locationID int64, section string, containerNo string, sku string) Item {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{LocationID: locationID})
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	for _, item := range items {
		if item.SKU == sku && item.LocationID == locationID && item.StorageSection == section && item.ContainerNo == containerNo {
			return item
		}
	}
	t.Fatalf("item %s at location %d section %s container %s not found", sku, locationID, section, containerNo)
	return Item{}
}

func assertItemHiddenByContainer(t *testing.T, ctx context.Context, store *Store, locationID int64, section string, containerNo string, sku string) {
	t.Helper()
	items, err := store.ListItems(ctx, ItemFilters{LocationID: locationID})
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	for _, item := range items {
		if item.SKU == sku && item.LocationID == locationID && item.StorageSection == section && item.ContainerNo == containerNo {
			t.Fatalf("expected item %s at location %d section %s container %s to be hidden from inventory list", sku, locationID, section, containerNo)
		}
	}
}

func assertMovementTypeCount(t *testing.T, movements []Movement, itemID int64, movementType string, wantCount int) {
	t.Helper()
	count := 0
	for _, movement := range movements {
		if movement.ItemID == itemID && movement.MovementType == movementType {
			count++
		}
	}
	if count != wantCount {
		t.Fatalf("expected %d %s movements for item %d, got %d", wantCount, movementType, itemID, count)
	}
}

func assertMovementContainers(t *testing.T, label string, movements []Movement, wantContainers ...string) {
	t.Helper()

	gotContainers := make([]string, 0, len(movements))
	for _, movement := range movements {
		gotContainers = append(gotContainers, movement.ContainerNo)
	}
	sort.Strings(gotContainers)
	sort.Strings(wantContainers)
	if !reflect.DeepEqual(gotContainers, wantContainers) {
		t.Fatalf("%s movement containers mismatch: got %v want %v", label, gotContainers, wantContainers)
	}
}

func assertMovementPresent(t *testing.T, movements []Movement, movementID int64, movementType string, quantityChange int) {
	t.Helper()
	for _, movement := range movements {
		if movement.ID == movementID {
			if movement.MovementType != movementType {
				t.Fatalf("expected movement %d type %s, got %s", movementID, movementType, movement.MovementType)
			}
			if movement.QuantityChange != quantityChange {
				t.Fatalf("expected movement %d quantity change %d, got %d", movementID, quantityChange, movement.QuantityChange)
			}
			return
		}
	}
	t.Fatalf("movement %d not found", movementID)
}

func assertBillingInvoiceTotalsConsistent(t *testing.T, invoice BillingInvoice) {
	t.Helper()

	var subtotal, discountTotal float64
	for _, line := range invoice.Lines {
		if strings.EqualFold(line.ChargeType, "DISCOUNT") {
			discountTotal += line.Amount
		} else {
			subtotal += line.Amount
		}
	}
	subtotal = roundCurrencyGo(subtotal)
	discountTotal = roundCurrencyGo(discountTotal)
	grandTotal := roundCurrencyGo(subtotal + discountTotal)

	if invoice.LineCount != len(invoice.Lines) {
		t.Fatalf("invoice %s line count mismatch: stored=%d loaded=%d", invoice.InvoiceNo, invoice.LineCount, len(invoice.Lines))
	}
	assertMoneyEqual(t, "invoice "+invoice.InvoiceNo+" subtotal", invoice.Subtotal, subtotal)
	assertMoneyEqual(t, "invoice "+invoice.InvoiceNo+" discount total", invoice.DiscountTotal, discountTotal)
	assertMoneyEqual(t, "invoice "+invoice.InvoiceNo+" grand total", invoice.GrandTotal, grandTotal)
}

func assertMoneyEqual(t *testing.T, label string, got float64, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.001 {
		t.Fatalf("%s mismatch: got %.4f want %.4f", label, got, want)
	}
}

func integrationSuffix() string {
	return strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "")
}
