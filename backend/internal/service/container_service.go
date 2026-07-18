package service

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"
)

const ContainerLifecycleLoadLimit = 5000

type ContainerSummary struct {
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

type ContainerLifecycle struct {
	Container         *Container                  `json:"container,omitempty"`
	Summary           ContainerSummary            `json:"summary"`
	PackingLists      []InboundDocument           `json:"packingLists"`
	PickingOrders     []OutboundDocument          `json:"pickingOrders"`
	LifecycleEvents   []ContainerLifecycleEvent   `json:"lifecycleEvents"`
	TrackingEvents    []ContainerTrackingEvent    `json:"trackingEvents"`
	PickupAssignments []ContainerPickupAssignment `json:"pickupAssignments"`
	DeliveryEvents    []DeliveryEvent             `json:"deliveryEvents"`
}

type ListContainersInput struct {
	CustomerID int64
	Search     string
	Limit      int
}

type GetContainerLifecycleInput struct {
	CustomerID      int64
	ContainerNo     string
	OperationalOnly bool
}

type containerRepository interface {
	ListInboundDocumentsFiltered(context.Context, int, InboundDocumentFilters) ([]InboundDocument, error)
	ListItems(context.Context, ItemFilters) ([]Item, error)
	ListContainerLifecycleEvents(context.Context, int, ...ContainerLifecycleEventFilters) ([]ContainerLifecycleEvent, error)
	ListOutboundDocumentsFiltered(context.Context, int, OutboundDocumentFilters) ([]OutboundDocument, error)
	GetOutboundDocumentForCustomer(context.Context, int64, int64) (OutboundDocument, error)
	ListContainerRecords(context.Context, int, ContainerFilters) ([]Container, error)
	GetContainerByNo(context.Context, int64, string) (Container, error)
	GetOperationalContainerByNo(context.Context, int64, string) (Container, error)
	CreateContainer(context.Context, CreateContainerInput) (Container, error)
	UpdateContainerMetadata(context.Context, UpdateContainerMetadataInput) (Container, error)
	CreateContainerTrackingEvent(context.Context, CreateContainerTrackingEventInput) (ContainerTrackingEvent, error)
	CreateContainerPickupAssignment(context.Context, CreateContainerPickupAssignmentInput) (ContainerPickupAssignment, error)
	ListContainerTrackingEvents(context.Context, int, ContainerTrackingEventFilters) ([]ContainerTrackingEvent, error)
	ListContainerPickupAssignments(context.Context, int, ContainerPickupAssignmentFilters) ([]ContainerPickupAssignment, error)
	ListDeliveryEvents(context.Context, int, DeliveryEventFilters) ([]DeliveryEvent, error)
}

type ContainerService struct {
	repo containerRepository
}

func NewContainerService(repo containerRepository) *ContainerService {
	return &ContainerService{repo: repo}
}

func (s *ContainerService) CreateContainer(ctx context.Context, input CreateContainerInput) (Container, error) {
	return s.repo.CreateContainer(ctx, input)
}

func (s *ContainerService) UpdateMetadata(ctx context.Context, input UpdateContainerMetadataInput) (Container, error) {
	return s.repo.UpdateContainerMetadata(ctx, input)
}

func (s *ContainerService) CreateTrackingEvent(ctx context.Context, input CreateContainerTrackingEventInput) (ContainerTrackingEvent, error) {
	return s.repo.CreateContainerTrackingEvent(ctx, input)
}

func (s *ContainerService) CreatePickupAssignment(ctx context.Context, input CreateContainerPickupAssignmentInput) (ContainerPickupAssignment, error) {
	return s.repo.CreateContainerPickupAssignment(ctx, input)
}

func (s *ContainerService) ListContainers(ctx context.Context, input ListContainersInput) ([]ContainerSummary, error) {
	summaries, err := s.loadContainerSummaries(ctx, input.CustomerID)
	if err != nil {
		return nil, err
	}
	search := strings.TrimSpace(strings.ToLower(input.Search))
	filtered := make([]ContainerSummary, 0, len(summaries))
	for _, summary := range summaries {
		if containerSummaryMatchesSearch(summary, search) {
			filtered = append(filtered, summary)
		}
	}

	if input.Limit > 0 && input.Limit < len(filtered) {
		filtered = filtered[:input.Limit]
	}
	return filtered, nil
}

func (s *ContainerService) GetLifecycle(ctx context.Context, input GetContainerLifecycleInput) (ContainerLifecycle, error) {
	containerNo := normalizeContainerNo(input.ContainerNo)
	if input.CustomerID <= 0 || containerNo == "" {
		return ContainerLifecycle{}, ErrInvalidInput
	}
	var containers []Container
	var containerPtr *Container
	var container Container
	var err error
	if input.OperationalOnly {
		container, err = s.repo.GetOperationalContainerByNo(ctx, input.CustomerID, containerNo)
	} else {
		container, err = s.repo.GetContainerByNo(ctx, input.CustomerID, containerNo)
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return ContainerLifecycle{}, err
	}
	if err == nil {
		containers = []Container{container}
		containerPtr = &container
	}

	packingLists, err := s.loadPackingListsForContainer(ctx, input.CustomerID, containerNo, input.OperationalOnly)
	if err != nil {
		return ContainerLifecycle{}, err
	}
	items, err := s.repo.ListItems(ctx, ItemFilters{CustomerID: input.CustomerID})
	if err != nil {
		return ContainerLifecycle{}, err
	}
	items = filterItemsByContainer(items, containerNo)

	lifecycleEvents, err := s.repo.ListContainerLifecycleEvents(ctx, ContainerLifecycleLoadLimit, ContainerLifecycleEventFilters{
		CustomerID:      input.CustomerID,
		ContainerNo:     containerNo,
		OperationalOnly: input.OperationalOnly,
	})
	if err != nil {
		return ContainerLifecycle{}, err
	}
	trackingEvents, err := s.repo.ListContainerTrackingEvents(ctx, ContainerLifecycleLoadLimit, ContainerTrackingEventFilters{
		CustomerID:  input.CustomerID,
		ContainerNo: containerNo,
	})
	if err != nil {
		return ContainerLifecycle{}, err
	}
	pickupAssignments, err := s.repo.ListContainerPickupAssignments(ctx, ContainerLifecycleLoadLimit, ContainerPickupAssignmentFilters{
		CustomerID:  input.CustomerID,
		ContainerNo: containerNo,
	})
	if err != nil {
		return ContainerLifecycle{}, err
	}

	pickingOrders, err := s.loadPickingOrdersForContainer(ctx, input.CustomerID, containerNo, lifecycleEvents)
	if err != nil {
		return ContainerLifecycle{}, err
	}
	deliveryEvents, err := s.repo.ListDeliveryEvents(ctx, ContainerLifecycleLoadLimit, DeliveryEventFilters{
		CustomerID:  input.CustomerID,
		ContainerNo: containerNo,
	})
	if err != nil {
		return ContainerLifecycle{}, err
	}

	summaries := buildContainerSummaries(containers, packingLists, items, lifecycleEvents)
	summary, found := summaries[containerSummaryKey(input.CustomerID, containerNo)]
	if !found {
		return ContainerLifecycle{}, ErrNotFound
	}

	return ContainerLifecycle{
		Container:         containerPtr,
		Summary:           summary,
		PackingLists:      packingLists,
		PickingOrders:     pickingOrders,
		LifecycleEvents:   lifecycleEvents,
		TrackingEvents:    trackingEvents,
		PickupAssignments: pickupAssignments,
		DeliveryEvents:    deliveryEvents,
	}, nil
}

func (s *ContainerService) loadContainerSummaries(ctx context.Context, customerID int64) ([]ContainerSummary, error) {
	containerRecords, err := s.repo.ListContainerRecords(ctx, ContainerLifecycleLoadLimit, ContainerFilters{
		CustomerID:      customerID,
		OperationalOnly: true,
	})
	if err != nil {
		return nil, err
	}

	packingLists, err := s.repo.ListInboundDocumentsFiltered(ctx, ContainerLifecycleLoadLimit, InboundDocumentFilters{
		ArchiveScope:    DocumentArchiveScopeAll,
		CustomerID:      customerID,
		OperationalOnly: true,
	})
	if err != nil {
		return nil, err
	}
	items, err := s.repo.ListItems(ctx, ItemFilters{CustomerID: customerID})
	if err != nil {
		return nil, err
	}

	lifecycleEvents, err := s.repo.ListContainerLifecycleEvents(ctx, ContainerLifecycleLoadLimit, ContainerLifecycleEventFilters{
		CustomerID:      customerID,
		OperationalOnly: true,
	})
	if err != nil {
		return nil, err
	}

	summariesByContainer := buildContainerSummaries(containerRecords, packingLists, items, lifecycleEvents)
	summaries := make([]ContainerSummary, 0, len(summariesByContainer))
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

func (s *ContainerService) loadPackingListsForContainer(ctx context.Context, customerID int64, containerNo string, operationalOnly bool) ([]InboundDocument, error) {
	documents, err := s.repo.ListInboundDocumentsFiltered(ctx, ContainerLifecycleLoadLimit, InboundDocumentFilters{
		ArchiveScope:    DocumentArchiveScopeAll,
		CustomerID:      customerID,
		Search:          containerNo,
		OperationalOnly: operationalOnly,
	})
	if err != nil {
		return nil, err
	}

	filtered := make([]InboundDocument, 0, len(documents))
	for _, document := range documents {
		if normalizeContainerNo(document.ContainerNo) == containerNo {
			filtered = append(filtered, document)
		}
	}
	return filtered, nil
}

func (s *ContainerService) loadPickingOrdersForContainer(ctx context.Context, customerID int64, containerNo string, lifecycleEvents []ContainerLifecycleEvent) ([]OutboundDocument, error) {
	documentsByID := make(map[int64]OutboundDocument)
	if customerID > 0 {
		for _, event := range lifecycleEvents {
			if event.EventType != StockLedgerEventShip && event.EventType != StockLedgerEventReversal {
				continue
			}
			if event.SourceDocumentType != StockLedgerSourceOutbound || event.SourceDocumentID <= 0 {
				continue
			}
			if _, exists := documentsByID[event.SourceDocumentID]; exists {
				continue
			}
			document, err := s.repo.GetOutboundDocumentForCustomer(ctx, event.SourceDocumentID, customerID)
			if err != nil {
				if errors.Is(err, ErrNotFound) {
					continue
				}
				return nil, err
			}
			documentsByID[document.ID] = document
		}
	}

	searchDocuments, err := s.repo.ListOutboundDocumentsFiltered(ctx, ContainerLifecycleLoadLimit, OutboundDocumentFilters{
		ArchiveScope: DocumentArchiveScopeAll,
		CustomerID:   customerID,
		Search:       containerNo,
	})
	if err != nil {
		return nil, err
	}
	for _, document := range searchDocuments {
		if outboundDocumentReferencesContainer(document, containerNo) {
			documentsByID[document.ID] = document
		}
	}

	documents := make([]OutboundDocument, 0, len(documentsByID))
	for _, document := range documentsByID {
		documents = append(documents, document)
	}
	sort.SliceStable(documents, func(left, right int) bool {
		leftTime := outboundDocumentActivityTime(documents[left])
		rightTime := outboundDocumentActivityTime(documents[right])
		if leftTime.Equal(rightTime) {
			return documents[left].ID > documents[right].ID
		}
		return leftTime.After(rightTime)
	})
	return documents, nil
}

type containerSummaryAccumulator struct {
	summary          ContainerSummary
	warehouseSet     map[string]struct{}
	pickingOrderRefs map[string]struct{}
	transferRefs     map[string]struct{}
	palletCount      int
}

func buildContainerSummaries(
	containers []Container,
	packingLists []InboundDocument,
	items []Item,
	lifecycleEvents []ContainerLifecycleEvent,
) map[string]ContainerSummary {
	accumulators := make(map[string]*containerSummaryAccumulator)
	getAccumulator := func(customerID int64, customerName string, containerNo string) *containerSummaryAccumulator {
		normalized := normalizeContainerNo(containerNo)
		if normalized == "" {
			return nil
		}
		key := containerSummaryKey(customerID, normalized)
		if existing := accumulators[key]; existing != nil {
			return existing
		}
		accumulator := &containerSummaryAccumulator{
			summary: ContainerSummary{
				ContainerNo:  normalized,
				CustomerID:   customerID,
				CustomerName: customerName,
				Warehouses:   []string{},
			},
			warehouseSet:     make(map[string]struct{}),
			pickingOrderRefs: make(map[string]struct{}),
			transferRefs:     make(map[string]struct{}),
		}
		accumulators[key] = accumulator
		return accumulator
	}

	for _, container := range containers {
		accumulator := getAccumulator(container.CustomerID, container.CustomerName, container.ContainerNo)
		if accumulator == nil {
			continue
		}
		if accumulator.summary.CustomerID == 0 {
			accumulator.summary.CustomerID = container.CustomerID
			accumulator.summary.CustomerName = container.CustomerName
		}
		accumulator.summary.Status = normalizeContainerSummaryProjectionStatus(container.Status)
		if container.LocationName != "" {
			accumulator.addWarehouse(container.LocationName)
		}
		accumulator.setLastActivity(container.LastEventAt)
		accumulator.setLastActivity(&container.UpdatedAt)
	}

	for _, document := range packingLists {
		accumulator := getAccumulator(document.CustomerID, document.CustomerName, document.ContainerNo)
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
		accumulator.setFirstReceived(inboundDocumentActivityTime(document))
		accumulator.setLastActivity(inboundDocumentUpdatedTime(document))
	}

	for _, item := range items {
		accumulator := getAccumulator(item.CustomerID, item.CustomerName, item.ContainerNo)
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
		accumulator := getAccumulator(event.CustomerID, event.CustomerName, event.ContainerNo)
		if accumulator == nil {
			continue
		}
		if accumulator.summary.CustomerID == 0 {
			accumulator.summary.CustomerID = event.CustomerID
			accumulator.summary.CustomerName = event.CustomerName
		}
		if event.EventType == StockLedgerEventShip {
			accumulator.summary.ShippedQty += containerAbsInt(event.QuantityDelta)
			accumulator.addPickingOrderRef(lifecycleEventPickingOrderRef(event))
		}
		if event.EventType == StockLedgerEventReversal {
			accumulator.summary.ShippedQty -= containerAbsInt(event.QuantityDelta)
			accumulator.addPickingOrderRef(lifecycleEventPickingOrderRef(event))
		}
		if event.EventType == StockLedgerEventTransferIn || event.EventType == StockLedgerEventTransferOut {
			accumulator.addTransferRef(lifecycleEventTransferRef(event))
		}
		if event.EventType == StockLedgerEventReceive {
			accumulator.setFirstReceived(lifecycleEventActivityTime(event))
		}
		accumulator.addWarehouse(event.LocationName)
		accumulator.setLastActivity(lifecycleEventActivityTime(event))
	}

	summaries := make(map[string]ContainerSummary, len(accumulators))
	for key, accumulator := range accumulators {
		summary := accumulator.summary
		summary.Warehouses = containerSortedStringSet(accumulator.warehouseSet)
		summary.OutboundOrderCount = len(accumulator.pickingOrderRefs)
		summary.PickingOrderRefs = containerSortedStringSet(accumulator.pickingOrderRefs)
		summary.TransferCount = len(accumulator.transferRefs)
		summary.PalletCount = accumulator.palletCount
		if summary.ShippedQty < 0 {
			summary.ShippedQty = 0
		}
		if strings.TrimSpace(summary.Status) == "" {
			summary.Status = containerStatus(summary)
		}
		summaries[key] = summary
	}
	return summaries
}

func containerSummaryKey(customerID int64, containerNo string) string {
	return strconv.FormatInt(customerID, 10) + "|" + normalizeContainerNo(containerNo)
}

func (a *containerSummaryAccumulator) addWarehouse(value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	a.warehouseSet[trimmed] = struct{}{}
}

func (a *containerSummaryAccumulator) addPickingOrderRef(value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	a.pickingOrderRefs[trimmed] = struct{}{}
}

func (a *containerSummaryAccumulator) addTransferRef(value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	a.transferRefs[trimmed] = struct{}{}
}

func (a *containerSummaryAccumulator) setFirstReceived(value *time.Time) {
	if value == nil {
		return
	}
	if a.summary.FirstReceivedAt == nil || value.Before(*a.summary.FirstReceivedAt) {
		next := *value
		a.summary.FirstReceivedAt = &next
	}
}

func (a *containerSummaryAccumulator) setLastActivity(value *time.Time) {
	if value == nil {
		return
	}
	if a.summary.LastActivityAt == nil || value.After(*a.summary.LastActivityAt) {
		next := *value
		a.summary.LastActivityAt = &next
	}
}

func filterItemsByContainer(items []Item, containerNo string) []Item {
	filtered := make([]Item, 0, len(items))
	for _, item := range items {
		if normalizeContainerNo(item.ContainerNo) == containerNo {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func outboundDocumentReferencesContainer(document OutboundDocument, containerNo string) bool {
	for _, line := range document.Lines {
		for _, allocation := range line.PickAllocations {
			if normalizeContainerNo(allocation.ContainerNo) == containerNo {
				return true
			}
		}
	}
	return false
}

func outboundDocumentContainerNos(document OutboundDocument) []string {
	seen := make(map[string]struct{})
	for _, line := range document.Lines {
		for _, allocation := range line.PickAllocations {
			containerNo := normalizeContainerNo(allocation.ContainerNo)
			if containerNo == "" {
				continue
			}
			seen[containerNo] = struct{}{}
		}
	}
	containerNos := make([]string, 0, len(seen))
	for containerNo := range seen {
		containerNos = append(containerNos, containerNo)
	}
	sort.Strings(containerNos)
	return containerNos
}

func containerSummaryMatchesSearch(summary ContainerSummary, search string) bool {
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

func containerStatus(summary ContainerSummary) string {
	hasActiveInventory := summary.CurrentQty > 0 || summary.PalletCount > 0
	if hasActiveInventory && summary.ShippedQty > 0 {
		return "PARTIAL"
	}
	if hasActiveInventory {
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

func normalizeContainerSummaryProjectionStatus(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	if normalized == ContainerStatusPartiallyOutbound {
		return "PARTIAL"
	}
	return normalized
}

func inboundDocumentActivityTime(document InboundDocument) *time.Time {
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

func inboundDocumentUpdatedTime(document InboundDocument) *time.Time {
	if document.ConfirmedAt != nil {
		return document.ConfirmedAt
	}
	return &document.UpdatedAt
}

func outboundDocumentActivityTime(document OutboundDocument) time.Time {
	if document.ActualShipDate != nil {
		return *document.ActualShipDate
	}
	if document.ExpectedShipDate != nil {
		return *document.ExpectedShipDate
	}
	return document.UpdatedAt
}

func lifecycleEventActivityTime(event ContainerLifecycleEvent) *time.Time {
	value := event.EventTime
	return &value
}

func lifecycleEventPickingOrderRef(event ContainerLifecycleEvent) string {
	if strings.TrimSpace(event.PackingListNo) != "" && strings.TrimSpace(event.OrderRef) != "" {
		return strings.TrimSpace(event.PackingListNo) + " / " + strings.TrimSpace(event.OrderRef)
	}
	if strings.TrimSpace(event.PackingListNo) != "" {
		return strings.TrimSpace(event.PackingListNo)
	}
	if strings.TrimSpace(event.OrderRef) != "" {
		return strings.TrimSpace(event.OrderRef)
	}
	if event.SourceDocumentType == StockLedgerSourceOutbound && event.SourceDocumentID > 0 {
		return "#" + strconv.FormatInt(event.SourceDocumentID, 10)
	}
	return ""
}

func lifecycleEventTransferRef(event ContainerLifecycleEvent) string {
	if strings.TrimSpace(event.ReferenceCode) != "" {
		return strings.TrimSpace(event.ReferenceCode)
	}
	if event.SourceDocumentType == StockLedgerSourceTransfer && event.SourceDocumentID > 0 {
		return "TRANSFER-" + strconv.FormatInt(event.SourceDocumentID, 10)
	}
	return strconv.FormatInt(event.ID, 10)
}

func containerSortedStringSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func normalizeContainerNo(value string) string {
	return strings.TrimSpace(strings.ToUpper(value))
}

func containerAbsInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
