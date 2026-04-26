package service

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	ReportGranularityDay   = "day"
	ReportGranularityMonth = "month"
	ReportGranularityYear  = "year"
)

type OperationsReportFilters struct {
	StartDate   string
	EndDate     string
	CustomerID  int64
	LocationID  int64
	Search      string
	Granularity string
}

type SKUFlowReportFilters struct {
	StartDate   string
	EndDate     string
	SKUMasterID int64
	CustomerID  int64
	LocationID  int64
}

type OperationsReport struct {
	StartDate             string                   `json:"startDate"`
	EndDate               string                   `json:"endDate"`
	Granularity           string                   `json:"granularity"`
	Summary               OperationsReportSummary  `json:"summary"`
	LocationInventoryRows []ReportLocationRow      `json:"locationInventoryRows"`
	TopSkuRows            []ReportSkuRow           `json:"topSkuRows"`
	LowStockRows          []ReportLowStockRow      `json:"lowStockRows"`
	PalletFlowRows        []ReportPalletFlowRow    `json:"palletFlowRows"`
	MovementTrendRows     []ReportMovementTrendRow `json:"movementTrendRows"`
}

type SKUFlowReport struct {
	StartDate   string               `json:"startDate"`
	EndDate     string               `json:"endDate"`
	SKUMasterID int64                `json:"skuMasterId"`
	SKU         string               `json:"sku"`
	ItemNumber  string               `json:"itemNumber"`
	Description string               `json:"description"`
	Summary     SKUFlowReportSummary `json:"summary"`
	Rows        []SKUFlowReportRow   `json:"rows"`
}

type OperationsReportSummary struct {
	OnHandUnits          int     `json:"onHandUnits"`
	ActiveContainers     int     `json:"activeContainers"`
	PalletsIn            int     `json:"palletsIn"`
	PalletsOut           int     `json:"palletsOut"`
	NetPalletFlow        int     `json:"netPalletFlow"`
	ActiveSkuCount       int     `json:"activeSkuCount"`
	ActiveWarehouseCount int     `json:"activeWarehouseCount"`
	LowStockCount        int     `json:"lowStockCount"`
	EndingBalance        int     `json:"endingBalance"`
	PeakBalance          int     `json:"peakBalance"`
	AverageBalance       float64 `json:"averageBalance"`
}

type SKUFlowReportSummary struct {
	InboundQty       int    `json:"inboundQty"`
	InboundPallets   int    `json:"inboundPallets"`
	OutboundQty      int    `json:"outboundQty"`
	OutboundPallets  int    `json:"outboundPallets"`
	NetQty           int    `json:"netQty"`
	CurrentQty       int    `json:"currentQty"`
	CurrentPallets   int    `json:"currentPallets"`
	LastOutboundDate string `json:"lastOutboundDate"`
}

type ReportLocationRow struct {
	Label    string `json:"label"`
	Value    int    `json:"value"`
	SKUCount int    `json:"skuCount"`
}

type ReportSkuRow struct {
	Label       string `json:"label"`
	Value       int    `json:"value"`
	Description string `json:"description"`
}

type ReportLowStockRow struct {
	Label     string `json:"label"`
	Value     int    `json:"value"`
	Available int    `json:"available"`
	Reorder   int    `json:"reorder"`
}

type ReportPalletFlowRow struct {
	DateKey         string `json:"dateKey"`
	Inbound         int    `json:"inbound"`
	Outbound        int    `json:"outbound"`
	AdjustmentDelta int    `json:"adjustmentDelta"`
	EndOfDay        int    `json:"endOfDay"`
}

type ReportMovementTrendRow struct {
	Key      string `json:"key"`
	Inbound  int    `json:"inbound"`
	Outbound int    `json:"outbound"`
}

type SKUFlowReportRow struct {
	Direction          string `json:"direction"`
	EventType          string `json:"eventType"`
	Date               string `json:"date"`
	Quantity           int    `json:"quantity"`
	Pallets            int    `json:"pallets"`
	CustomerName       string `json:"customerName"`
	LocationName       string `json:"locationName"`
	StorageSection     string `json:"storageSection"`
	ContainerNo        string `json:"containerNo"`
	PackingListNo      string `json:"packingListNo"`
	OrderRef           string `json:"orderRef"`
	SourceDocumentType string `json:"sourceDocumentType"`
	SourceDocumentID   int64  `json:"sourceDocumentId"`
	SourceLineID       int64  `json:"sourceLineId"`
}

type reportLocationBucket struct {
	Label string
	Value int
	SKUs  map[int64]struct{}
}

type reportSkuBucket struct {
	Label       string
	Value       int
	Description string
}

type reportLowStockBucket struct {
	Label     string
	Available int
	Reorder   int
}

type reportLedgerEntry struct {
	ID             int64        `db:"id"`
	PalletID       int64        `db:"pallet_id"`
	SKUMasterID    int64        `db:"sku_master_id"`
	CustomerID     int64        `db:"customer_id"`
	LocationID     int64        `db:"location_id"`
	StorageSection string       `db:"storage_section"`
	ContainerNo    string       `db:"container_no_snapshot"`
	ItemNumber     string       `db:"item_number_snapshot"`
	Description    string       `db:"description_snapshot"`
	PackingListNo  string       `db:"packing_list_no"`
	OrderRef       string       `db:"order_ref"`
	ReferenceCode  string       `db:"reference_code"`
	EventType      string       `db:"event_type"`
	QuantityChange int          `db:"quantity_change"`
	OccurredAt     sql.NullTime `db:"occurred_at"`
	DeliveryDate   sql.NullTime `db:"delivery_date"`
	OutDate        sql.NullTime `db:"out_date"`
	CreatedAt      time.Time    `db:"created_at"`
}

type reportLedgerEventRow struct {
	PalletID       int64
	BusinessDate   time.Time
	EventType      string
	QuantityChange int
}

type skuFlowReportGroupKey struct {
	Direction          string
	EventType          string
	Date               string
	CustomerName       string
	LocationName       string
	StorageSection     string
	ContainerNo        string
	PackingListNo      string
	OrderRef           string
	SourceDocumentType string
	SourceDocumentID   int64
	SourceLineID       int64
}

type skuFlowReportGroup struct {
	row       SKUFlowReportRow
	palletIDs map[int64]struct{}
}

type skuFlowLedgerRow struct {
	PalletID           int64        `db:"pallet_id"`
	SKUMasterID        int64        `db:"sku_master_id"`
	SKU                string       `db:"sku"`
	ItemNumber         string       `db:"item_number"`
	Description        string       `db:"description"`
	CustomerName       string       `db:"customer_name"`
	LocationName       string       `db:"location_name"`
	StorageSection     string       `db:"storage_section"`
	ContainerNo        string       `db:"container_no_snapshot"`
	PackingListNo      string       `db:"packing_list_no"`
	OrderRef           string       `db:"order_ref"`
	EventType          string       `db:"event_type"`
	QuantityChange     int          `db:"quantity_change"`
	SourceDocumentType string       `db:"source_document_type"`
	SourceDocumentID   int64        `db:"source_document_id"`
	SourceLineID       int64        `db:"source_line_id"`
	OccurredAt         sql.NullTime `db:"occurred_at"`
	DeliveryDate       sql.NullTime `db:"delivery_date"`
	OutDate            sql.NullTime `db:"out_date"`
	CreatedAt          time.Time    `db:"created_at"`
}

type reportSearchLookups struct {
	customers  map[int64]string
	locations  map[int64]string
	skuMasters map[int64]reportSKUSearchLookup
}

type reportSKUSearchLookup struct {
	ItemNumber  string `db:"item_number"`
	SKU         string `db:"sku"`
	Name        string `db:"name"`
	Description string `db:"description"`
}

var reportInboundEvents = map[string]struct{}{
	StockLedgerEventReceive:    {},
	StockLedgerEventReversal:   {},
	StockLedgerEventTransferIn: {},
}

var reportOutboundEvents = map[string]struct{}{
	StockLedgerEventShip:        {},
	StockLedgerEventTransferOut: {},
}

func (s *Store) GetOperationsReport(ctx context.Context, filters OperationsReportFilters) (OperationsReport, error) {
	normalizedFilters, start, end, err := normalizeOperationsReportFilters(filters)
	if err != nil {
		return OperationsReport{}, err
	}

	items, err := s.ListItems(ctx, ItemFilters{
		CustomerID:   normalizedFilters.CustomerID,
		LocationID:   normalizedFilters.LocationID,
		LowStockOnly: false,
	})
	if err != nil {
		return OperationsReport{}, err
	}
	items = filterReportItemsBySearch(items, normalizedFilters.Search)

	report := OperationsReport{
		StartDate:   normalizedFilters.StartDate,
		EndDate:     normalizedFilters.EndDate,
		Granularity: normalizedFilters.Granularity,
	}
	report.Summary, report.LocationInventoryRows, report.TopSkuRows, report.LowStockRows = buildReportInventorySections(items)

	ledgerEntries, err := s.loadReportLedgerEntries(ctx, normalizedFilters)
	if err != nil {
		return OperationsReport{}, err
	}
	searchLookups := reportSearchLookups{}
	if normalizedFilters.Search != "" {
		searchLookups, err = s.loadReportSearchLookups(ctx)
		if err != nil {
			return OperationsReport{}, err
		}
	}
	openingBalances, events := buildReportLedgerBuckets(ledgerEntries, searchLookups, normalizedFilters.Search, start, end)

	report.PalletFlowRows = buildReportPalletFlowRows(openingBalances, events, start, end)
	report.MovementTrendRows = buildReportMovementTrendRows(events, normalizedFilters.Granularity)

	report.Summary.PalletsIn = 0
	report.Summary.PalletsOut = 0
	report.Summary.PeakBalance = 0
	report.Summary.EndingBalance = 0
	var balanceTotal int
	for _, row := range report.PalletFlowRows {
		report.Summary.PalletsIn += row.Inbound
		report.Summary.PalletsOut += row.Outbound
		if row.EndOfDay > report.Summary.PeakBalance {
			report.Summary.PeakBalance = row.EndOfDay
		}
		report.Summary.EndingBalance = row.EndOfDay
		balanceTotal += row.EndOfDay
	}
	report.Summary.NetPalletFlow = report.Summary.PalletsIn - report.Summary.PalletsOut
	if len(report.PalletFlowRows) > 0 {
		report.Summary.AverageBalance = float64(balanceTotal) / float64(len(report.PalletFlowRows))
	}

	return report, nil
}

func (s *Store) GetSKUFlowReport(ctx context.Context, filters SKUFlowReportFilters) (SKUFlowReport, error) {
	normalizedFilters, start, end, err := normalizeSKUFlowReportFilters(filters)
	if err != nil {
		return SKUFlowReport{}, err
	}

	rows, err := s.loadSKUFlowLedgerRows(ctx, normalizedFilters, start, end)
	if err != nil {
		return SKUFlowReport{}, err
	}

	report := SKUFlowReport{
		StartDate:   normalizedFilters.StartDate,
		EndDate:     normalizedFilters.EndDate,
		SKUMasterID: normalizedFilters.SKUMasterID,
	}
	if len(rows) > 0 {
		report.SKU = rows[0].SKU
		report.ItemNumber = rows[0].ItemNumber
		report.Description = rows[0].Description
	} else {
		sku, err := s.loadSKUFlowReportSKU(ctx, normalizedFilters.SKUMasterID)
		if err != nil {
			return SKUFlowReport{}, err
		}
		report.SKU = sku.SKU
		report.ItemNumber = sku.ItemNumber
		report.Description = firstNonEmpty(sku.Description, sku.Name)
	}

	report.Summary, report.Rows = buildSKUFlowReportRows(rows)
	currentQty, currentPallets, err := s.loadSKUFlowCurrentInventory(ctx, normalizedFilters)
	if err != nil {
		return SKUFlowReport{}, err
	}
	report.Summary.CurrentQty = currentQty
	report.Summary.CurrentPallets = currentPallets
	return report, nil
}

func normalizeOperationsReportFilters(filters OperationsReportFilters) (OperationsReportFilters, time.Time, time.Time, error) {
	now := time.Now().UTC()
	defaultStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	defaultEnd := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	start := defaultStart
	if strings.TrimSpace(filters.StartDate) != "" {
		parsed, err := parseOptionalDate(filters.StartDate)
		if err != nil {
			return OperationsReportFilters{}, time.Time{}, time.Time{}, err
		}
		start = startOfUTCDate(*parsed)
	}

	end := defaultEnd
	if strings.TrimSpace(filters.EndDate) != "" {
		parsed, err := parseOptionalDate(filters.EndDate)
		if err != nil {
			return OperationsReportFilters{}, time.Time{}, time.Time{}, err
		}
		end = startOfUTCDate(*parsed)
	}

	if start.After(end) {
		start, end = end, start
	}

	granularity := strings.TrimSpace(strings.ToLower(filters.Granularity))
	switch granularity {
	case ReportGranularityMonth, ReportGranularityYear:
	default:
		granularity = ReportGranularityDay
	}

	return OperationsReportFilters{
		StartDate:   start.Format(time.DateOnly),
		EndDate:     end.Format(time.DateOnly),
		CustomerID:  filters.CustomerID,
		LocationID:  filters.LocationID,
		Search:      strings.TrimSpace(filters.Search),
		Granularity: granularity,
	}, start, end, nil
}

func normalizeSKUFlowReportFilters(filters SKUFlowReportFilters) (SKUFlowReportFilters, time.Time, time.Time, error) {
	if filters.SKUMasterID <= 0 {
		return SKUFlowReportFilters{}, time.Time{}, time.Time{}, fmt.Errorf("%w: skuMasterId is required", ErrInvalidInput)
	}

	normalizedDateFilters, start, end, err := normalizeOperationsReportFilters(OperationsReportFilters{
		StartDate: filters.StartDate,
		EndDate:   filters.EndDate,
	})
	if err != nil {
		return SKUFlowReportFilters{}, time.Time{}, time.Time{}, err
	}

	return SKUFlowReportFilters{
		StartDate:   normalizedDateFilters.StartDate,
		EndDate:     normalizedDateFilters.EndDate,
		SKUMasterID: filters.SKUMasterID,
		CustomerID:  filters.CustomerID,
		LocationID:  filters.LocationID,
	}, start, end, nil
}

func startOfUTCDate(value time.Time) time.Time {
	utc := value.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

func filterReportItemsBySearch(items []Item, search string) []Item {
	normalizedSearch := strings.ToLower(strings.TrimSpace(search))
	if normalizedSearch == "" {
		return items
	}

	filtered := make([]Item, 0, len(items))
	for _, item := range items {
		haystack := strings.ToLower(strings.Join([]string{
			item.ItemNumber,
			item.SKU,
			item.Name,
			item.Description,
			item.CustomerName,
			item.ContainerNo,
			item.LocationName,
			item.StorageSection,
		}, " "))
		if strings.Contains(haystack, normalizedSearch) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func buildReportInventorySections(items []Item) (OperationsReportSummary, []ReportLocationRow, []ReportSkuRow, []ReportLowStockRow) {
	var summary OperationsReportSummary
	locationBuckets := make(map[int64]reportLocationBucket)
	skuBuckets := make(map[int64]reportSkuBucket)
	lowStockBuckets := make(map[int64]reportLowStockBucket)
	activeContainers := make(map[string]struct{})
	activeSKUs := make(map[int64]struct{})
	activeWarehouses := make(map[int64]struct{})

	for _, item := range items {
		summary.OnHandUnits += item.Quantity

		if item.Quantity > 0 {
			activeSKUs[item.SKUMasterID] = struct{}{}
			activeWarehouses[item.LocationID] = struct{}{}
			if containerNo := strings.TrimSpace(strings.ToUpper(item.ContainerNo)); containerNo != "" {
				activeContainers[containerNo] = struct{}{}
			}

			locationBucket := locationBuckets[item.LocationID]
			if locationBucket.SKUs == nil {
				locationBucket = reportLocationBucket{
					Label: firstNonEmpty(item.LocationName, fmt.Sprintf("#%d", item.LocationID)),
					SKUs:  make(map[int64]struct{}),
				}
			}
			locationBucket.Value += item.Quantity
			locationBucket.SKUs[item.SKUMasterID] = struct{}{}
			locationBuckets[item.LocationID] = locationBucket

			skuBucket := skuBuckets[item.SKUMasterID]
			if skuBucket.Label == "" {
				skuBucket = reportSkuBucket{
					Label:       item.SKU,
					Description: firstNonEmpty(item.Description, item.Name),
				}
			}
			skuBucket.Value += item.Quantity
			skuBuckets[item.SKUMasterID] = skuBucket
		}

		lowStockBucket := lowStockBuckets[item.SKUMasterID]
		if lowStockBucket.Label == "" {
			lowStockBucket.Label = item.SKU
		}
		lowStockBucket.Available += item.AvailableQty
		if item.ReorderLevel > lowStockBucket.Reorder {
			lowStockBucket.Reorder = item.ReorderLevel
		}
		lowStockBuckets[item.SKUMasterID] = lowStockBucket
	}

	summary.ActiveContainers = len(activeContainers)
	summary.ActiveSkuCount = len(activeSKUs)
	summary.ActiveWarehouseCount = len(activeWarehouses)

	locationRows := make([]ReportLocationRow, 0, len(locationBuckets))
	for _, bucket := range locationBuckets {
		locationRows = append(locationRows, ReportLocationRow{
			Label:    bucket.Label,
			Value:    bucket.Value,
			SKUCount: len(bucket.SKUs),
		})
	}
	sort.Slice(locationRows, func(i, j int) bool {
		if locationRows[i].Value == locationRows[j].Value {
			return locationRows[i].Label < locationRows[j].Label
		}
		return locationRows[i].Value > locationRows[j].Value
	})
	if len(locationRows) > 8 {
		locationRows = locationRows[:8]
	}

	topSkuRows := make([]ReportSkuRow, 0, len(skuBuckets))
	for _, bucket := range skuBuckets {
		topSkuRows = append(topSkuRows, ReportSkuRow{
			Label:       bucket.Label,
			Value:       bucket.Value,
			Description: bucket.Description,
		})
	}
	sort.Slice(topSkuRows, func(i, j int) bool {
		if topSkuRows[i].Value == topSkuRows[j].Value {
			return topSkuRows[i].Label < topSkuRows[j].Label
		}
		return topSkuRows[i].Value > topSkuRows[j].Value
	})
	if len(topSkuRows) > 8 {
		topSkuRows = topSkuRows[:8]
	}

	lowStockRows := make([]ReportLowStockRow, 0, len(lowStockBuckets))
	for _, bucket := range lowStockBuckets {
		if bucket.Reorder <= 0 || bucket.Available > bucket.Reorder {
			continue
		}
		lowStockRows = append(lowStockRows, ReportLowStockRow{
			Label:     bucket.Label,
			Value:     maxInt(bucket.Reorder-bucket.Available, 0),
			Available: bucket.Available,
			Reorder:   bucket.Reorder,
		})
	}
	sort.Slice(lowStockRows, func(i, j int) bool {
		leftGap := lowStockRows[i].Reorder - lowStockRows[i].Available
		rightGap := lowStockRows[j].Reorder - lowStockRows[j].Available
		if leftGap == rightGap {
			return lowStockRows[i].Label < lowStockRows[j].Label
		}
		return leftGap > rightGap
	})
	summary.LowStockCount = len(lowStockRows)

	return summary, locationRows, topSkuRows, lowStockRows
}

func (s *Store) loadReportLedgerEntries(ctx context.Context, filters OperationsReportFilters) ([]reportLedgerEntry, error) {
	// Keep the SQL shallow and move report-specific business rules into Go.
	query := `
		SELECT
			sl.id,
			sl.pallet_id,
			COALESCE(sl.sku_master_id, 0) AS sku_master_id,
			sl.customer_id,
			sl.location_id,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(sl.container_no_snapshot, '') AS container_no_snapshot,
			COALESCE(sl.item_number_snapshot, '') AS item_number_snapshot,
			COALESCE(sl.description_snapshot, '') AS description_snapshot,
			COALESCE(sl.packing_list_no, '') AS packing_list_no,
			COALESCE(sl.order_ref, '') AS order_ref,
			COALESCE(sl.reference_code, '') AS reference_code,
			sl.event_type,
			sl.quantity_change,
			sl.occurred_at,
			sl.delivery_date,
			sl.out_date,
			sl.created_at
		FROM stock_ledger sl
		JOIN pallets p ON p.id = sl.pallet_id
		WHERE p.status <> ?
	`
	args := []any{PalletStatusCancelled}
	if filters.CustomerID > 0 {
		query += " AND sl.customer_id = ?"
		args = append(args, filters.CustomerID)
	}
	if filters.LocationID > 0 {
		query += " AND sl.location_id = ?"
		args = append(args, filters.LocationID)
	}
	query += " ORDER BY COALESCE(sl.occurred_at, sl.created_at) ASC, sl.id ASC"

	entries := make([]reportLedgerEntry, 0)
	if err := s.db.SelectContext(ctx, &entries, s.db.Rebind(query), args...); err != nil {
		return nil, mapDBError(fmt.Errorf("load report ledger entries: %w", err))
	}
	return entries, nil
}

func (s *Store) loadSKUFlowReportSKU(ctx context.Context, skuMasterID int64) (reportSKUSearchLookup, error) {
	var sku reportSKUSearchLookup
	err := s.db.GetContext(ctx, &sku, `
		SELECT
			COALESCE(item_number, '') AS item_number,
			COALESCE(sku, '') AS sku,
			COALESCE(name, '') AS name,
			COALESCE(description, '') AS description
		FROM sku_master
		WHERE id = ?
	`, skuMasterID)
	if err != nil {
		if err == sql.ErrNoRows {
			return reportSKUSearchLookup{}, ErrNotFound
		}
		return reportSKUSearchLookup{}, mapDBError(fmt.Errorf("load sku flow report sku: %w", err))
	}
	return sku, nil
}

func (s *Store) loadSKUFlowCurrentInventory(ctx context.Context, filters SKUFlowReportFilters) (int, int, error) {
	var row struct {
		Quantity int `db:"quantity"`
		Pallets  int `db:"pallets"`
	}
	query := `
		SELECT
			COALESCE(SUM(pi.quantity), 0) AS quantity,
			COUNT(DISTINCT CASE WHEN pi.quantity > 0 THEN p.id END) AS pallets
		FROM pallet_items pi
		JOIN pallets p ON p.id = pi.pallet_id
		WHERE pi.sku_master_id = ?
			AND pi.quantity > 0
			AND p.status <> ?
	`
	args := []any{filters.SKUMasterID, PalletStatusCancelled}
	if filters.CustomerID > 0 {
		query += " AND p.customer_id = ?"
		args = append(args, filters.CustomerID)
	}
	if filters.LocationID > 0 {
		query += " AND p.current_location_id = ?"
		args = append(args, filters.LocationID)
	}

	if err := s.db.GetContext(ctx, &row, s.db.Rebind(query), args...); err != nil {
		return 0, 0, mapDBError(fmt.Errorf("load sku flow current inventory: %w", err))
	}
	return row.Quantity, row.Pallets, nil
}

func (s *Store) loadSKUFlowLedgerRows(ctx context.Context, filters SKUFlowReportFilters, start time.Time, end time.Time) ([]skuFlowLedgerRow, error) {
	rows := make([]skuFlowLedgerRow, 0)
	query := `
		SELECT
			sl.pallet_id,
			sm.id AS sku_master_id,
			COALESCE(sm.sku, '') AS sku,
			COALESCE(sm.item_number, '') AS item_number,
			COALESCE(NULLIF(sl.description_snapshot, ''), NULLIF(sm.description, ''), sm.name, '') AS description,
			c.name AS customer_name,
			l.name AS location_name,
			COALESCE(NULLIF(sl.storage_section, ''), 'TEMP') AS storage_section,
			COALESCE(sl.container_no_snapshot, '') AS container_no_snapshot,
			COALESCE(NULLIF(sl.packing_list_no, ''), NULLIF(odoc.packing_list_no, ''), '') AS packing_list_no,
			COALESCE(NULLIF(sl.order_ref, ''), NULLIF(odoc.order_ref, ''), '') AS order_ref,
			sl.event_type,
			sl.quantity_change,
			COALESCE(sl.source_document_type, '') AS source_document_type,
			COALESCE(sl.source_document_id, 0) AS source_document_id,
			COALESCE(sl.source_line_id, 0) AS source_line_id,
			sl.occurred_at,
			sl.delivery_date,
			sl.out_date,
			sl.created_at
		FROM stock_ledger sl
		JOIN pallets p ON p.id = sl.pallet_id
		LEFT JOIN pallet_items pi ON pi.id = sl.pallet_item_id
		JOIN sku_master sm ON sm.id = COALESCE(sl.sku_master_id, pi.sku_master_id, p.sku_master_id)
		JOIN customers c ON c.id = sl.customer_id
		JOIN storage_locations l ON l.id = sl.location_id
		LEFT JOIN outbound_documents odoc
			ON sl.source_document_type = 'OUTBOUND' AND sl.source_document_id = odoc.id
		WHERE p.status <> ?
			AND sm.id = ?
			AND sl.event_type IN ('RECEIVE', 'SHIP')
			AND sl.quantity_change <> 0
			AND DATE(CASE
				WHEN sl.event_type = 'RECEIVE' THEN COALESCE(sl.delivery_date, sl.occurred_at, sl.created_at)
				WHEN sl.event_type = 'SHIP' THEN COALESCE(sl.out_date, sl.occurred_at, sl.created_at)
				ELSE COALESCE(sl.occurred_at, sl.created_at)
			END) BETWEEN ? AND ?
	`
	args := []any{PalletStatusCancelled, filters.SKUMasterID, start.Format(time.DateOnly), end.Format(time.DateOnly)}
	if filters.CustomerID > 0 {
		query += " AND sl.customer_id = ?"
		args = append(args, filters.CustomerID)
	}
	if filters.LocationID > 0 {
		query += " AND sl.location_id = ?"
		args = append(args, filters.LocationID)
	}
	query += `
		ORDER BY
			CASE
				WHEN sl.event_type = 'RECEIVE' THEN COALESCE(sl.delivery_date, sl.occurred_at, sl.created_at)
				WHEN sl.event_type = 'SHIP' THEN COALESCE(sl.out_date, sl.occurred_at, sl.created_at)
				ELSE COALESCE(sl.occurred_at, sl.created_at)
			END DESC,
			sl.id DESC
	`

	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, mapDBError(fmt.Errorf("load sku flow ledger rows: %w", err))
	}
	return rows, nil
}

func (s *Store) loadReportSearchLookups(ctx context.Context) (reportSearchLookups, error) {
	lookups := reportSearchLookups{
		customers:  make(map[int64]string),
		locations:  make(map[int64]string),
		skuMasters: make(map[int64]reportSKUSearchLookup),
	}

	customerRows := make([]struct {
		ID   int64  `db:"id"`
		Name string `db:"name"`
	}, 0)
	if err := s.db.SelectContext(ctx, &customerRows, `SELECT id, name FROM customers`); err != nil {
		return reportSearchLookups{}, mapDBError(fmt.Errorf("load report customer lookups: %w", err))
	}
	for _, row := range customerRows {
		lookups.customers[row.ID] = row.Name
	}

	locationRows := make([]struct {
		ID   int64  `db:"id"`
		Name string `db:"name"`
	}, 0)
	if err := s.db.SelectContext(ctx, &locationRows, `SELECT id, name FROM storage_locations`); err != nil {
		return reportSearchLookups{}, mapDBError(fmt.Errorf("load report location lookups: %w", err))
	}
	for _, row := range locationRows {
		lookups.locations[row.ID] = row.Name
	}

	skuRows := make([]struct {
		ID int64 `db:"id"`
		reportSKUSearchLookup
	}, 0)
	if err := s.db.SelectContext(ctx, &skuRows, `
		SELECT
			id,
			COALESCE(item_number, '') AS item_number,
			COALESCE(sku, '') AS sku,
			COALESCE(name, '') AS name,
			COALESCE(description, '') AS description
		FROM sku_master
	`); err != nil {
		return reportSearchLookups{}, mapDBError(fmt.Errorf("load report sku lookups: %w", err))
	}
	for _, row := range skuRows {
		lookups.skuMasters[row.ID] = row.reportSKUSearchLookup
	}

	return lookups, nil
}

func buildReportLedgerBuckets(
	entries []reportLedgerEntry,
	lookups reportSearchLookups,
	search string,
	start time.Time,
	end time.Time,
) (map[int64]int, []reportLedgerEventRow) {
	normalizedSearch := strings.ToLower(strings.TrimSpace(search))
	openingBalances := make(map[int64]int)
	events := make([]reportLedgerEventRow, 0, len(entries))

	for _, entry := range entries {
		if normalizedSearch != "" && !matchesReportLedgerSearch(entry, normalizedSearch, lookups) {
			continue
		}

		businessDate := startOfUTCDate(resolveReportLedgerBusinessDate(entry))
		if businessDate.Before(start) {
			openingBalances[entry.PalletID] += entry.QuantityChange
			continue
		}
		if businessDate.After(end) {
			continue
		}

		events = append(events, reportLedgerEventRow{
			PalletID:       entry.PalletID,
			BusinessDate:   businessDate,
			EventType:      entry.EventType,
			QuantityChange: entry.QuantityChange,
		})
	}

	return openingBalances, events
}

func buildSKUFlowReportRows(entries []skuFlowLedgerRow) (SKUFlowReportSummary, []SKUFlowReportRow) {
	var summary SKUFlowReportSummary
	groups := make(map[skuFlowReportGroupKey]*skuFlowReportGroup)

	for _, entry := range entries {
		direction, quantity, ok := resolveSKUFlowDirectionAndQuantity(entry)
		if !ok {
			continue
		}

		dateKey := startOfUTCDate(resolveSKUFlowBusinessDate(entry)).Format(time.DateOnly)
		key := skuFlowReportGroupKey{
			Direction:          direction,
			EventType:          entry.EventType,
			Date:               dateKey,
			CustomerName:       entry.CustomerName,
			LocationName:       entry.LocationName,
			StorageSection:     fallbackSection(entry.StorageSection),
			ContainerNo:        strings.TrimSpace(entry.ContainerNo),
			PackingListNo:      strings.TrimSpace(entry.PackingListNo),
			OrderRef:           strings.TrimSpace(entry.OrderRef),
			SourceDocumentType: strings.TrimSpace(entry.SourceDocumentType),
			SourceDocumentID:   entry.SourceDocumentID,
			SourceLineID:       entry.SourceLineID,
		}

		group := groups[key]
		if group == nil {
			group = &skuFlowReportGroup{
				row: SKUFlowReportRow{
					Direction:          key.Direction,
					EventType:          key.EventType,
					Date:               key.Date,
					CustomerName:       key.CustomerName,
					LocationName:       key.LocationName,
					StorageSection:     key.StorageSection,
					ContainerNo:        key.ContainerNo,
					PackingListNo:      key.PackingListNo,
					OrderRef:           key.OrderRef,
					SourceDocumentType: key.SourceDocumentType,
					SourceDocumentID:   key.SourceDocumentID,
					SourceLineID:       key.SourceLineID,
				},
				palletIDs: make(map[int64]struct{}),
			}
			groups[key] = group
		}

		group.row.Quantity += quantity
		group.palletIDs[entry.PalletID] = struct{}{}
		group.row.Pallets = len(group.palletIDs)

		if direction == "INBOUND" {
			summary.InboundQty += quantity
			continue
		}

		summary.OutboundQty += quantity
		if dateKey > summary.LastOutboundDate {
			summary.LastOutboundDate = dateKey
		}
	}

	summary.NetQty = summary.InboundQty - summary.OutboundQty

	rows := make([]SKUFlowReportRow, 0, len(groups))
	for _, group := range groups {
		if group.row.Direction == "INBOUND" {
			summary.InboundPallets += group.row.Pallets
		} else {
			summary.OutboundPallets += group.row.Pallets
		}
		rows = append(rows, group.row)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Date == rows[j].Date {
			if rows[i].Direction != rows[j].Direction {
				return rows[i].Direction == "OUTBOUND"
			}
			if rows[i].PackingListNo == rows[j].PackingListNo {
				return rows[i].ContainerNo < rows[j].ContainerNo
			}
			return rows[i].PackingListNo < rows[j].PackingListNo
		}
		return rows[i].Date > rows[j].Date
	})

	return summary, rows
}

func matchesReportLedgerSearch(entry reportLedgerEntry, normalizedSearch string, lookups reportSearchLookups) bool {
	skuLookup := lookups.skuMasters[entry.SKUMasterID]
	haystack := strings.ToLower(strings.Join([]string{
		entry.ItemNumber,
		skuLookup.ItemNumber,
		skuLookup.SKU,
		skuLookup.Name,
		entry.Description,
		skuLookup.Description,
		lookups.customers[entry.CustomerID],
		entry.ContainerNo,
		lookups.locations[entry.LocationID],
		entry.StorageSection,
		entry.PackingListNo,
		entry.OrderRef,
		entry.ReferenceCode,
	}, " "))
	return strings.Contains(haystack, normalizedSearch)
}

func resolveSKUFlowDirectionAndQuantity(entry skuFlowLedgerRow) (string, int, bool) {
	switch entry.EventType {
	case StockLedgerEventReceive:
		if entry.QuantityChange <= 0 {
			return "", 0, false
		}
		return "INBOUND", entry.QuantityChange, true
	case StockLedgerEventShip:
		if entry.QuantityChange >= 0 {
			return "", 0, false
		}
		return "OUTBOUND", -entry.QuantityChange, true
	default:
		return "", 0, false
	}
}

func resolveSKUFlowBusinessDate(entry skuFlowLedgerRow) time.Time {
	switch entry.EventType {
	case StockLedgerEventShip:
		return firstNonEmptyReportTime(entry.OutDate, entry.OccurredAt, entry.CreatedAt)
	case StockLedgerEventReceive:
		return firstNonEmptyReportTime(entry.DeliveryDate, entry.OccurredAt, entry.CreatedAt)
	default:
		return firstNonEmptyReportTime(entry.OccurredAt, sql.NullTime{}, entry.CreatedAt)
	}
}

func resolveReportLedgerBusinessDate(entry reportLedgerEntry) time.Time {
	switch entry.EventType {
	case StockLedgerEventShip, StockLedgerEventReversal:
		return firstNonEmptyReportTime(entry.OutDate, entry.OccurredAt, entry.CreatedAt)
	case StockLedgerEventReceive:
		return firstNonEmptyReportTime(entry.DeliveryDate, entry.OccurredAt, entry.CreatedAt)
	default:
		return firstNonEmptyReportTime(entry.OccurredAt, sql.NullTime{}, entry.CreatedAt)
	}
}

func firstNonEmptyReportTime(primary sql.NullTime, secondary sql.NullTime, fallback time.Time) time.Time {
	switch {
	case primary.Valid:
		return primary.Time.UTC()
	case secondary.Valid:
		return secondary.Time.UTC()
	default:
		return fallback.UTC()
	}
}

func buildReportPalletFlowRows(openingBalances map[int64]int, events []reportLedgerEventRow, start time.Time, end time.Time) []ReportPalletFlowRow {
	dayKeys := buildReportDayKeys(start, end)
	eventsByDay := make(map[string][]reportLedgerEventRow, len(dayKeys))
	inboundPallets := make(map[string]map[int64]struct{}, len(dayKeys))
	outboundPallets := make(map[string]map[int64]struct{}, len(dayKeys))

	for _, event := range events {
		dateKey := event.BusinessDate.Format(time.DateOnly)
		eventsByDay[dateKey] = append(eventsByDay[dateKey], event)

		if _, ok := reportInboundEvents[event.EventType]; ok && event.QuantityChange > 0 {
			if inboundPallets[dateKey] == nil {
				inboundPallets[dateKey] = make(map[int64]struct{})
			}
			inboundPallets[dateKey][event.PalletID] = struct{}{}
		}
		if _, ok := reportOutboundEvents[event.EventType]; ok && event.QuantityChange < 0 {
			if outboundPallets[dateKey] == nil {
				outboundPallets[dateKey] = make(map[int64]struct{})
			}
			outboundPallets[dateKey][event.PalletID] = struct{}{}
		}
	}

	balances := make(map[int64]int, len(openingBalances))
	for palletID, quantity := range openingBalances {
		if quantity > 0 {
			balances[palletID] = quantity
		}
	}

	rows := make([]ReportPalletFlowRow, 0, len(dayKeys))
	for _, dayKey := range dayKeys {
		adjustmentDelta := 0
		for _, event := range eventsByDay[dayKey] {
			wasActive := balances[event.PalletID] > 0
			balances[event.PalletID] += event.QuantityChange
			isActive := balances[event.PalletID] > 0
			if !isActive {
				delete(balances, event.PalletID)
			}

			if _, isInbound := reportInboundEvents[event.EventType]; isInbound {
				continue
			}
			if _, isOutbound := reportOutboundEvents[event.EventType]; isOutbound {
				continue
			}
			switch {
			case !wasActive && isActive:
				adjustmentDelta++
			case wasActive && !isActive:
				adjustmentDelta--
			}
		}

		inboundCount := len(inboundPallets[dayKey])
		outboundCount := len(outboundPallets[dayKey])
		endOfDay := countActiveReportPallets(balances)
		rows = append(rows, ReportPalletFlowRow{
			DateKey:         dayKey,
			Inbound:         inboundCount,
			Outbound:        outboundCount,
			AdjustmentDelta: adjustmentDelta,
			EndOfDay:        endOfDay,
		})
	}

	return rows
}

func buildReportMovementTrendRows(events []reportLedgerEventRow, granularity string) []ReportMovementTrendRow {
	rowsByKey := make(map[string]ReportMovementTrendRow)
	for _, event := range events {
		dateKey := event.BusinessDate.Format(time.DateOnly)
		bucketKey := reportTrendBucketKey(dateKey, granularity)
		row := rowsByKey[bucketKey]
		if row.Key == "" {
			row.Key = bucketKey
		}
		if _, ok := reportInboundEvents[event.EventType]; ok && event.QuantityChange > 0 {
			row.Inbound += event.QuantityChange
		}
		if _, ok := reportOutboundEvents[event.EventType]; ok && event.QuantityChange < 0 {
			row.Outbound += -event.QuantityChange
		}
		rowsByKey[bucketKey] = row
	}

	rows := make([]ReportMovementTrendRow, 0, len(rowsByKey))
	for _, row := range rowsByKey {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].Key < rows[j].Key
	})
	return rows
}

func buildReportDayKeys(start time.Time, end time.Time) []string {
	keys := make([]string, 0)
	for cursor := startOfUTCDate(start); !cursor.After(end); cursor = cursor.AddDate(0, 0, 1) {
		keys = append(keys, cursor.Format(time.DateOnly))
	}
	return keys
}

func countActiveReportPallets(balances map[int64]int) int {
	count := 0
	for _, quantity := range balances {
		if quantity > 0 {
			count++
		}
	}
	return count
}

func reportTrendBucketKey(dateKey string, granularity string) string {
	switch granularity {
	case ReportGranularityYear:
		if len(dateKey) >= 4 {
			return dateKey[:4]
		}
	case ReportGranularityMonth:
		if len(dateKey) >= 7 {
			return dateKey[:7]
		}
	}
	return dateKey
}
