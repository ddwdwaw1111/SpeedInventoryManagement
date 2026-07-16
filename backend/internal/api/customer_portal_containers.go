package api

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

const customerPortalContainerLoadLimit = 5000

type customerPortalContainerSummary struct {
	ContainerNo        string     `json:"containerNo"`
	CustomerID         int64      `json:"customerId"`
	CustomerName       string     `json:"customerName"`
	Warehouses         []string   `json:"warehouses"`
	PackingListCount   int        `json:"packingListCount"`
	FirstPackingListID int64      `json:"firstPackingListId"`
	TotalExpectedQty   int        `json:"totalExpectedQty"`
	TotalReceivedQty   int        `json:"totalReceivedQty"`
	CurrentQty         int        `json:"currentQty"`
	AvailableQty       int        `json:"availableQty"`
	ShippedQty         int        `json:"shippedQty"`
	OutboundOrderCount int        `json:"outboundOrderCount"`
	PickingOrderRefs   []string   `json:"pickingOrderRefs"`
	TransferCount      int        `json:"transferCount"`
	PalletCount        int        `json:"palletCount"`
	Status             string     `json:"status"`
	FirstReceivedAt    *time.Time `json:"firstReceivedAt"`
	LastActivityAt     *time.Time `json:"lastActivityAt"`
}

type customerPortalContainerLifecycle struct {
	Summary         customerPortalContainerSummary    `json:"summary"`
	PackingLists    []service.InboundDocument         `json:"packingLists"`
	PickingOrders   []service.OutboundDocument        `json:"pickingOrders"`
	Movements       []service.Movement                `json:"movements"`
	LifecycleEvents []service.ContainerLifecycleEvent `json:"lifecycleEvents"`
}

type customerPortalContainerSummaryAccumulator struct {
	summary          customerPortalContainerSummary
	warehouseSet     map[string]struct{}
	pickingOrderRefs map[string]struct{}
	transferRefs     map[string]struct{}
	palletCount      int
}

func (s *Server) handleCustomerPortalContainers(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	limit := 0
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := parsePositiveInt(value, "limit must be a number")
		if err != nil {
			writeError(c, http.StatusBadRequest, err.Error())
			return
		}
		limit = parsed
	}

	summaries, err := s.loadCustomerPortalContainerSummaries(c.Request.Context(), customerID)
	if err != nil {
		writeServerError(c, err)
		return
	}

	search := strings.TrimSpace(strings.ToLower(c.Query("search")))
	filtered := make([]customerPortalContainerSummary, 0, len(summaries))
	for _, summary := range summaries {
		if customerPortalContainerSummaryMatchesSearch(summary, search) {
			filtered = append(filtered, summary)
		}
	}

	if limit > 0 && limit < len(filtered) {
		filtered = filtered[:limit]
	}

	writeJSON(c, http.StatusOK, filtered)
}

func (s *Server) handleCustomerPortalContainerLifecycle(c *gin.Context) {
	customerID, ok := customerIDFromContext(c)
	if !ok {
		return
	}

	containerNo := normalizeCustomerPortalContainerNo(c.Param("containerNo"))
	if containerNo == "" {
		writeError(c, http.StatusBadRequest, "containerNo is required")
		return
	}

	packingLists, err := s.loadCustomerPortalPackingListsForContainer(c.Request.Context(), customerID, containerNo)
	if err != nil {
		writeServerError(c, err)
		return
	}
	items, err := s.store.ListItems(c.Request.Context(), service.ItemFilters{CustomerID: customerID})
	if err != nil {
		writeServerError(c, err)
		return
	}
	items = filterCustomerPortalItemsByContainer(items, containerNo)

	movements, err := s.store.ListMovements(c.Request.Context(), customerPortalContainerLoadLimit, service.MovementFilters{
		CustomerID:  customerID,
		ContainerNo: containerNo,
	})
	if err != nil {
		writeDomainError(c, err)
		return
	}

	lifecycleEvents, err := s.store.ListContainerLifecycleEvents(c.Request.Context(), customerPortalContainerLoadLimit, service.ContainerLifecycleEventFilters{
		CustomerID:      customerID,
		ContainerNo:     containerNo,
		OperationalOnly: true,
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	pickingOrders, err := s.loadCustomerPortalPickingOrdersForContainer(c.Request.Context(), customerID, containerNo, lifecycleEvents)
	if err != nil {
		writeServerError(c, err)
		return
	}

	summaries := buildCustomerPortalContainerSummaries(packingLists, items, lifecycleEvents)
	summary, found := summaries[containerNo]
	if !found {
		writeDomainError(c, service.ErrNotFound)
		return
	}

	writeJSON(c, http.StatusOK, customerPortalContainerLifecycle{
		Summary:         summary,
		PackingLists:    packingLists,
		PickingOrders:   pickingOrders,
		Movements:       movements,
		LifecycleEvents: lifecycleEvents,
	})
}

func (s *Server) loadCustomerPortalContainerSummaries(ctx context.Context, customerID int64) ([]customerPortalContainerSummary, error) {
	packingLists, err := s.store.ListInboundDocumentsFiltered(ctx, customerPortalContainerLoadLimit, service.InboundDocumentFilters{
		ArchiveScope:    service.DocumentArchiveScopeAll,
		CustomerID:      customerID,
		OperationalOnly: true,
	})
	if err != nil {
		return nil, err
	}

	items, err := s.store.ListItems(ctx, service.ItemFilters{CustomerID: customerID})
	if err != nil {
		return nil, err
	}

	lifecycleEvents, err := s.store.ListContainerLifecycleEvents(ctx, customerPortalContainerLoadLimit, service.ContainerLifecycleEventFilters{
		CustomerID:      customerID,
		OperationalOnly: true,
	})
	if err != nil {
		return nil, err
	}

	summariesByContainer := buildCustomerPortalContainerSummaries(packingLists, items, lifecycleEvents)
	summaries := make([]customerPortalContainerSummary, 0, len(summariesByContainer))
	for _, summary := range summariesByContainer {
		summaries = append(summaries, summary)
	}
	sort.SliceStable(summaries, func(left, right int) bool {
		leftTime := summaries[left].LastActivityAt
		rightTime := summaries[right].LastActivityAt
		if leftTime == nil && rightTime == nil {
			return summaries[left].ContainerNo < summaries[right].ContainerNo
		}
		if leftTime == nil {
			return false
		}
		if rightTime == nil {
			return true
		}
		if leftTime.Equal(*rightTime) {
			return summaries[left].ContainerNo < summaries[right].ContainerNo
		}
		return leftTime.After(*rightTime)
	})
	return summaries, nil
}

func (s *Server) loadCustomerPortalPackingListsForContainer(ctx context.Context, customerID int64, containerNo string) ([]service.InboundDocument, error) {
	documents, err := s.store.ListInboundDocumentsFiltered(ctx, customerPortalContainerLoadLimit, service.InboundDocumentFilters{
		ArchiveScope:    service.DocumentArchiveScopeAll,
		CustomerID:      customerID,
		Search:          containerNo,
		OperationalOnly: true,
	})
	if err != nil {
		return nil, err
	}

	filtered := make([]service.InboundDocument, 0, len(documents))
	for _, document := range documents {
		if normalizeCustomerPortalContainerNo(document.ContainerNo) == containerNo {
			filtered = append(filtered, document)
		}
	}
	return filtered, nil
}

func (s *Server) loadCustomerPortalPickingOrdersForContainer(ctx context.Context, customerID int64, containerNo string, lifecycleEvents []service.ContainerLifecycleEvent) ([]service.OutboundDocument, error) {
	documentsByID := make(map[int64]service.OutboundDocument)
	for _, event := range lifecycleEvents {
		if event.EventType != service.StockLedgerEventShip && event.EventType != service.StockLedgerEventReversal {
			continue
		}
		if event.SourceDocumentType != service.StockLedgerSourceOutbound || event.SourceDocumentID <= 0 {
			continue
		}
		if _, exists := documentsByID[event.SourceDocumentID]; exists {
			continue
		}
		document, err := s.store.GetOutboundDocumentForCustomer(ctx, event.SourceDocumentID, customerID)
		if err != nil {
			if errors.Is(err, service.ErrNotFound) {
				continue
			}
			return nil, err
		}
		documentsByID[document.ID] = document
	}

	searchDocuments, err := s.store.ListOutboundDocumentsFiltered(ctx, customerPortalContainerLoadLimit, service.OutboundDocumentFilters{
		ArchiveScope: service.DocumentArchiveScopeAll,
		CustomerID:   customerID,
		Search:       containerNo,
	})
	if err != nil {
		return nil, err
	}
	for _, document := range searchDocuments {
		if customerPortalOutboundDocumentReferencesContainer(document, containerNo) {
			documentsByID[document.ID] = document
		}
	}

	documents := make([]service.OutboundDocument, 0, len(documentsByID))
	for _, document := range documentsByID {
		documents = append(documents, document)
	}
	sort.SliceStable(documents, func(left, right int) bool {
		leftTime := customerPortalOutboundDocumentActivityTime(documents[left])
		rightTime := customerPortalOutboundDocumentActivityTime(documents[right])
		if leftTime.Equal(rightTime) {
			return documents[left].ID > documents[right].ID
		}
		return leftTime.After(rightTime)
	})
	return documents, nil
}

func buildCustomerPortalContainerSummaries(
	packingLists []service.InboundDocument,
	items []service.Item,
	lifecycleEvents []service.ContainerLifecycleEvent,
) map[string]customerPortalContainerSummary {
	accumulators := make(map[string]*customerPortalContainerSummaryAccumulator)
	getAccumulator := func(containerNo string) *customerPortalContainerSummaryAccumulator {
		normalized := normalizeCustomerPortalContainerNo(containerNo)
		if normalized == "" {
			return nil
		}
		if existing := accumulators[normalized]; existing != nil {
			return existing
		}
		accumulator := &customerPortalContainerSummaryAccumulator{
			summary: customerPortalContainerSummary{
				ContainerNo: normalized,
				Warehouses:  []string{},
			},
			warehouseSet:     make(map[string]struct{}),
			pickingOrderRefs: make(map[string]struct{}),
			transferRefs:     make(map[string]struct{}),
		}
		accumulators[normalized] = accumulator
		return accumulator
	}

	for _, document := range packingLists {
		accumulator := getAccumulator(document.ContainerNo)
		if accumulator == nil {
			continue
		}
		if accumulator.summary.CustomerID == 0 {
			accumulator.summary.CustomerID = document.CustomerID
			accumulator.summary.CustomerName = document.CustomerName
		}
		if accumulator.summary.FirstPackingListID == 0 {
			accumulator.summary.FirstPackingListID = document.ID
		}
		accumulator.summary.PackingListCount++
		accumulator.summary.TotalExpectedQty += document.TotalExpectedQty
		accumulator.summary.TotalReceivedQty += document.TotalReceivedQty
		accumulator.addWarehouse(document.LocationName)
		accumulator.setFirstReceived(customerPortalInboundDocumentActivityTime(document))
		accumulator.setLastActivity(customerPortalInboundDocumentUpdatedTime(document))
	}

	for _, item := range items {
		accumulator := getAccumulator(item.ContainerNo)
		if accumulator == nil {
			continue
		}
		if accumulator.summary.CustomerID == 0 {
			accumulator.summary.CustomerID = item.CustomerID
			accumulator.summary.CustomerName = item.CustomerName
		}
		accumulator.summary.CurrentQty += item.Quantity
		accumulator.summary.AvailableQty += item.AvailableQty
		accumulator.palletCount += item.Pallets
		accumulator.addWarehouse(item.LocationName)
		accumulator.setLastActivity(&item.UpdatedAt)
	}

	for _, event := range lifecycleEvents {
		accumulator := getAccumulator(event.ContainerNo)
		if accumulator == nil {
			continue
		}
		if accumulator.summary.CustomerID == 0 {
			accumulator.summary.CustomerID = event.CustomerID
			accumulator.summary.CustomerName = event.CustomerName
		}
		if event.EventType == service.StockLedgerEventShip {
			accumulator.summary.ShippedQty += absInt(event.QuantityDelta)
			accumulator.addPickingOrderRef(customerPortalLifecycleEventPickingOrderRef(event))
		}
		if event.EventType == service.StockLedgerEventReversal {
			accumulator.summary.ShippedQty -= absInt(event.QuantityDelta)
			accumulator.addPickingOrderRef(customerPortalLifecycleEventPickingOrderRef(event))
		}
		if event.EventType == service.StockLedgerEventTransferIn || event.EventType == service.StockLedgerEventTransferOut {
			accumulator.addTransferRef(customerPortalLifecycleEventTransferRef(event))
		}
		if event.EventType == service.StockLedgerEventReceive {
			accumulator.setFirstReceived(customerPortalLifecycleEventActivityTime(event))
		}
		accumulator.addWarehouse(event.LocationName)
		accumulator.setLastActivity(customerPortalLifecycleEventActivityTime(event))
	}

	summaries := make(map[string]customerPortalContainerSummary, len(accumulators))
	for containerNo, accumulator := range accumulators {
		summary := accumulator.summary
		summary.Warehouses = sortedStringSet(accumulator.warehouseSet)
		summary.OutboundOrderCount = len(accumulator.pickingOrderRefs)
		summary.PickingOrderRefs = sortedStringSet(accumulator.pickingOrderRefs)
		summary.TransferCount = len(accumulator.transferRefs)
		summary.PalletCount = accumulator.palletCount
		if summary.ShippedQty < 0 {
			summary.ShippedQty = 0
		}
		summary.Status = customerPortalContainerStatus(summary)
		summaries[containerNo] = summary
	}
	return summaries
}

func (a *customerPortalContainerSummaryAccumulator) addWarehouse(value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	a.warehouseSet[trimmed] = struct{}{}
}

func (a *customerPortalContainerSummaryAccumulator) addPickingOrderRef(value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	a.pickingOrderRefs[trimmed] = struct{}{}
}

func (a *customerPortalContainerSummaryAccumulator) addTransferRef(value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	a.transferRefs[trimmed] = struct{}{}
}

func (a *customerPortalContainerSummaryAccumulator) setFirstReceived(value *time.Time) {
	if value == nil {
		return
	}
	if a.summary.FirstReceivedAt == nil || value.Before(*a.summary.FirstReceivedAt) {
		next := *value
		a.summary.FirstReceivedAt = &next
	}
}

func (a *customerPortalContainerSummaryAccumulator) setLastActivity(value *time.Time) {
	if value == nil {
		return
	}
	if a.summary.LastActivityAt == nil || value.After(*a.summary.LastActivityAt) {
		next := *value
		a.summary.LastActivityAt = &next
	}
}

func filterCustomerPortalItemsByContainer(items []service.Item, containerNo string) []service.Item {
	filtered := make([]service.Item, 0, len(items))
	for _, item := range items {
		if normalizeCustomerPortalContainerNo(item.ContainerNo) == containerNo {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func customerPortalOutboundDocumentReferencesContainer(document service.OutboundDocument, containerNo string) bool {
	for _, line := range document.Lines {
		for _, allocation := range line.PickAllocations {
			if normalizeCustomerPortalContainerNo(allocation.ContainerNo) == containerNo {
				return true
			}
		}
	}
	return false
}

func customerPortalContainerSummaryMatchesSearch(summary customerPortalContainerSummary, search string) bool {
	if search == "" {
		return true
	}
	searchable := strings.ToLower(strings.Join([]string{
		summary.ContainerNo,
		summary.CustomerName,
		strings.Join(summary.Warehouses, " "),
		strings.Join(summary.PickingOrderRefs, " "),
		summary.Status,
	}, " "))
	return strings.Contains(searchable, search)
}

func customerPortalContainerStatus(summary customerPortalContainerSummary) string {
	if summary.CurrentQty > 0 && summary.ShippedQty > 0 {
		return "PARTIAL"
	}
	if summary.CurrentQty > 0 {
		return "IN_STOCK"
	}
	if summary.ShippedQty > 0 && (summary.TotalReceivedQty == 0 || summary.ShippedQty >= summary.TotalReceivedQty) {
		return "SHIPPED"
	}
	if summary.TotalReceivedQty > 0 {
		return "DEPLETED"
	}
	return "PENDING"
}

func customerPortalInboundDocumentActivityTime(document service.InboundDocument) *time.Time {
	if document.ActualArrivalDate != nil {
		return document.ActualArrivalDate
	}
	if document.ConfirmedAt != nil {
		return document.ConfirmedAt
	}
	if document.ExpectedArrivalDate != nil {
		return document.ExpectedArrivalDate
	}
	return &document.CreatedAt
}

func customerPortalInboundDocumentUpdatedTime(document service.InboundDocument) *time.Time {
	if document.ConfirmedAt != nil {
		return document.ConfirmedAt
	}
	return &document.UpdatedAt
}

func customerPortalMovementActivityTime(movement service.Movement) *time.Time {
	if (movement.MovementType == "OUT" || movement.MovementType == "REVERSAL") && movement.OutDate != nil {
		return movement.OutDate
	}
	if movement.MovementType == "IN" && movement.DeliveryDate != nil {
		return movement.DeliveryDate
	}
	return &movement.CreatedAt
}

func customerPortalOutboundDocumentActivityTime(document service.OutboundDocument) time.Time {
	if document.ActualShipDate != nil {
		return *document.ActualShipDate
	}
	if document.ExpectedShipDate != nil {
		return *document.ExpectedShipDate
	}
	return document.UpdatedAt
}

func customerPortalLifecycleEventActivityTime(event service.ContainerLifecycleEvent) *time.Time {
	value := event.EventTime
	return &value
}

func customerPortalLifecycleEventPickingOrderRef(event service.ContainerLifecycleEvent) string {
	if strings.TrimSpace(event.PackingListNo) != "" && strings.TrimSpace(event.OrderRef) != "" {
		return strings.TrimSpace(event.PackingListNo) + " / " + strings.TrimSpace(event.OrderRef)
	}
	if strings.TrimSpace(event.PackingListNo) != "" {
		return strings.TrimSpace(event.PackingListNo)
	}
	if strings.TrimSpace(event.OrderRef) != "" {
		return strings.TrimSpace(event.OrderRef)
	}
	if event.SourceDocumentType == service.StockLedgerSourceOutbound && event.SourceDocumentID > 0 {
		return "#" + strconvFormatInt(event.SourceDocumentID)
	}
	return ""
}

func customerPortalLifecycleEventTransferRef(event service.ContainerLifecycleEvent) string {
	if strings.TrimSpace(event.ReferenceCode) != "" {
		return strings.TrimSpace(event.ReferenceCode)
	}
	if event.SourceDocumentType == service.StockLedgerSourceTransfer && event.SourceDocumentID > 0 {
		return "TRANSFER-" + strconvFormatInt(event.SourceDocumentID)
	}
	return strconvFormatInt(event.ID)
}

func customerPortalMovementPickingOrderRef(movement service.Movement) string {
	if strings.TrimSpace(movement.PackingListNo) != "" && strings.TrimSpace(movement.OrderRef) != "" {
		return strings.TrimSpace(movement.PackingListNo) + " / " + strings.TrimSpace(movement.OrderRef)
	}
	if strings.TrimSpace(movement.PackingListNo) != "" {
		return strings.TrimSpace(movement.PackingListNo)
	}
	if strings.TrimSpace(movement.OrderRef) != "" {
		return strings.TrimSpace(movement.OrderRef)
	}
	if movement.OutboundDocumentID > 0 {
		return "#" + strconvFormatInt(movement.OutboundDocumentID)
	}
	return ""
}

func customerPortalMovementTransferRef(movement service.Movement) string {
	if strings.TrimSpace(movement.ReferenceCode) != "" {
		return strings.TrimSpace(movement.ReferenceCode)
	}
	if movement.SourceDocumentType == service.StockLedgerSourceTransfer && movement.SourceDocumentID > 0 {
		return "TRANSFER-" + strconvFormatInt(movement.SourceDocumentID)
	}
	return strconvFormatInt(movement.ID)
}

func sortedStringSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func normalizeCustomerPortalContainerNo(value string) string {
	return strings.TrimSpace(strings.ToUpper(value))
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
