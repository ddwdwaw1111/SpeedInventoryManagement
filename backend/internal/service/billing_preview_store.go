package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

const (
	BillingPreviewCalculationVersion = "container-v3"
	BillingChargeInbound             = "INBOUND"
	BillingChargeWrapping            = "WRAPPING"
	BillingChargeStorage             = "STORAGE"
	BillingChargeOutbound            = "OUTBOUND"

	billingPreviewStorageGraceDays = 7
	billingPreviewUnassigned       = "UNASSIGNED"
	billingPreviewMaxQtyPerPallet  = 15
)

// BillingPreviewInput describes the complete, server-calculated billing scope.
// NormalPalletGracePeriodEnabled defaults to true when it is omitted.
type BillingPreviewInput struct {
	CustomerID                     int64                `json:"customerId"`
	WarehouseLocationID            *int64               `json:"warehouseLocationId,omitempty"`
	ContainerType                  string               `json:"containerType,omitempty"`
	PeriodStart                    string               `json:"periodStart"`
	PeriodEnd                      string               `json:"periodEnd"`
	NormalPalletGracePeriodEnabled *bool                `json:"normalPalletGracePeriodEnabled,omitempty"`
	Rates                          BillingRatesSnapshot `json:"rates"`
}

type BillingPreviewResult struct {
	CalculationVersion             string                       `json:"calculationVersion"`
	SourceFingerprint              string                       `json:"sourceFingerprint"`
	CustomerID                     int64                        `json:"customerId"`
	CustomerName                   string                       `json:"customerName"`
	WarehouseLocationID            *int64                       `json:"warehouseLocationId,omitempty"`
	ContainerType                  string                       `json:"containerType,omitempty"`
	PeriodStart                    string                       `json:"periodStart"`
	PeriodEnd                      string                       `json:"periodEnd"`
	NormalPalletGracePeriodEnabled bool                         `json:"normalPalletGracePeriodEnabled"`
	Rates                          BillingRatesSnapshot         `json:"rates"`
	Lines                          []BillingPreviewLine         `json:"lines"`
	StorageRows                    []BillingPreviewStorageRow   `json:"storageRows"`
	DailyBalances                  []BillingPreviewDailyBalance `json:"dailyBalances"`
	Summary                        BillingPreviewSummary        `json:"summary"`
	Warnings                       []string                     `json:"warnings"`
}

type BillingPreviewLine struct {
	ID            string  `json:"id"`
	ChargeType    string  `json:"chargeType"`
	SourceType    string  `json:"sourceType"`
	SourceID      int64   `json:"sourceId"`
	SourceLineID  int64   `json:"sourceLineId,omitempty"`
	Reference     string  `json:"reference"`
	ContainerNo   string  `json:"containerNo"`
	ContainerType string  `json:"containerType"`
	Warehouse     string  `json:"warehouse"`
	LocationID    *int64  `json:"locationId,omitempty"`
	OccurredOn    string  `json:"occurredOn"`
	Quantity      float64 `json:"quantity"`
	UnitRate      float64 `json:"unitRate"`
	Amount        float64 `json:"amount"`
	Description   string  `json:"description"`
}

type BillingPreviewStorageRow struct {
	CustomerID          int64                          `json:"customerId"`
	CustomerName        string                         `json:"customerName"`
	ContainerNo         string                         `json:"containerNo"`
	ContainerType       string                         `json:"containerType"`
	ReceivedOn          string                         `json:"receivedOn,omitempty"`
	LocationID          *int64                         `json:"locationId,omitempty"`
	WarehousesTouched   []string                       `json:"warehousesTouched"`
	OpeningPallets      float64                        `json:"openingPallets"`
	ClosingPallets      float64                        `json:"closingPallets"`
	PalletReleaseEvents []BillingPreviewPalletRelease  `json:"palletReleaseEvents"`
	PalletsTracked      float64                        `json:"palletsTracked"`
	PalletDays          float64                        `json:"palletDays"`
	FreePalletDays      float64                        `json:"freePalletDays"`
	BillablePalletDays  float64                        `json:"billablePalletDays"`
	AverageDailyPallets float64                        `json:"averageDailyPallets"`
	FirstActivityOn     string                         `json:"firstActivityOn,omitempty"`
	LastActivityOn      string                         `json:"lastActivityOn,omitempty"`
	GrossAmount         float64                        `json:"grossAmount"`
	DiscountAmount      float64                        `json:"discountAmount"`
	Amount              float64                        `json:"amount"`
	Segments            []BillingPreviewStorageSegment `json:"segments"`
}

type BillingPreviewPalletRelease struct {
	Date    string  `json:"date"`
	Pallets float64 `json:"pallets"`
}

type BillingPreviewStorageSegment struct {
	StartDate          string  `json:"startDate"`
	EndDate            string  `json:"endDate"`
	DayEndPallets      float64 `json:"dayEndPallets"`
	BilledDays         int     `json:"billedDays"`
	PalletDays         float64 `json:"palletDays"`
	FreePalletDays     float64 `json:"freePalletDays"`
	BillablePalletDays float64 `json:"billablePalletDays"`
	GrossAmount        float64 `json:"grossAmount"`
	DiscountAmount     float64 `json:"discountAmount"`
	Amount             float64 `json:"amount"`
}

type BillingPreviewDailyBalance struct {
	Date        string  `json:"date"`
	PalletCount float64 `json:"palletCount"`
}

type BillingPreviewSummary struct {
	ReceivedContainers    int     `json:"receivedContainers"`
	ReceivedPallets       float64 `json:"receivedPallets"`
	ShippedPallets        float64 `json:"shippedPallets"`
	PalletDays            float64 `json:"palletDays"`
	InboundAmount         float64 `json:"inboundAmount"`
	WrappingAmount        float64 `json:"wrappingAmount"`
	StorageGrossAmount    float64 `json:"storageGrossAmount"`
	StorageDiscountAmount float64 `json:"storageDiscountAmount"`
	StorageAmount         float64 `json:"storageAmount"`
	OutboundAmount        float64 `json:"outboundAmount"`
	GrandTotal            float64 `json:"grandTotal"`
}

type billingPreviewRange struct {
	Start        time.Time
	EndInclusive time.Time
	EndExclusive time.Time
}

type billingInboundSource struct {
	DocumentID    int64     `db:"document_id" json:"documentId"`
	LocationID    int64     `db:"location_id" json:"locationId"`
	LocationName  string    `db:"location_name" json:"locationName"`
	ContainerNo   string    `db:"container_no" json:"containerNo"`
	ContainerType string    `db:"container_type" json:"containerType"`
	OccurredOn    time.Time `db:"occurred_on" json:"occurredOn"`
	Pallets       float64   `db:"pallets" json:"pallets"`
}

type billingInboundLineSource struct {
	DocumentID     int64   `db:"document_id" json:"documentId"`
	LineID         int64   `db:"line_id" json:"lineId"`
	SKUMasterID    int64   `db:"sku_master_id" json:"skuMasterId"`
	StorageSection string  `db:"storage_section" json:"storageSection"`
	Quantity       float64 `db:"quantity" json:"quantity"`
	Pallets        float64 `db:"pallets" json:"pallets"`
}

type billingOutboundLineSource struct {
	DocumentID   int64     `db:"document_id" json:"documentId"`
	LineID       int64     `db:"line_id" json:"lineId"`
	SKUMasterID  int64     `db:"sku_master_id" json:"skuMasterId"`
	PickingNo    string    `db:"picking_no" json:"pickingNo"`
	LocationID   int64     `db:"location_id" json:"locationId"`
	LocationName string    `db:"location_name" json:"locationName"`
	OccurredOn   time.Time `db:"occurred_on" json:"occurredOn"`
	Quantity     int       `db:"quantity" json:"quantity"`
	Pallets      int       `db:"pallets" json:"pallets"`
}

type billingOutboundAllocationSource struct {
	AllocationID   int64  `db:"allocation_id" json:"allocationId"`
	LineID         int64  `db:"line_id" json:"lineId"`
	ContainerNo    string `db:"container_no" json:"containerNo"`
	LocationID     int64  `db:"location_id" json:"locationId"`
	LocationName   string `db:"location_name" json:"locationName"`
	StorageSection string `db:"storage_section" json:"storageSection"`
	AllocatedQty   int    `db:"allocated_qty" json:"allocatedQty"`
	Status         string `db:"status" json:"status"`
}

type billingLifecycleSource struct {
	EventID        int64     `db:"event_id" json:"eventId"`
	LocationID     int64     `db:"location_id" json:"locationId"`
	LocationName   string    `db:"location_name" json:"locationName"`
	StorageSection string    `db:"storage_section" json:"storageSection"`
	ContainerNo    string    `db:"container_no" json:"containerNo"`
	SKUMasterID    int64     `db:"sku_master_id" json:"skuMasterId"`
	EventType      string    `db:"event_type" json:"eventType"`
	EventDate      time.Time `db:"event_date" json:"eventDate"`
	QuantityDelta  float64   `db:"quantity_delta" json:"quantityDelta"`
	PalletDelta    float64   `db:"pallet_delta" json:"palletDelta"`
	SourceType     string    `db:"source_type" json:"sourceType"`
	SourceID       int64     `db:"source_id" json:"sourceId"`
	SourceLineID   int64     `db:"source_line_id" json:"sourceLineId"`
}

type billingContainerTypeSource struct {
	ContainerNo   string `db:"container_no" json:"containerNo"`
	ContainerType string `db:"container_type" json:"containerType"`
}

type billingPreviewSources struct {
	CustomerName   string                            `json:"customerName"`
	Inbound        []billingInboundSource            `json:"inbound"`
	InboundLines   []billingInboundLineSource        `json:"inboundLines"`
	OutboundLines  []billingOutboundLineSource       `json:"outboundLines"`
	Allocations    []billingOutboundAllocationSource `json:"allocations"`
	Lifecycle      []billingLifecycleSource          `json:"lifecycle"`
	ContainerTypes []billingContainerTypeSource      `json:"containerTypes"`
}

type billingPreviewScopeFingerprint struct {
	CalculationVersion             string                `json:"calculationVersion"`
	CustomerID                     int64                 `json:"customerId"`
	WarehouseLocationID            *int64                `json:"warehouseLocationId,omitempty"`
	ContainerType                  string                `json:"containerType,omitempty"`
	PeriodStart                    string                `json:"periodStart"`
	PeriodEnd                      string                `json:"periodEnd"`
	NormalPalletGracePeriodEnabled bool                  `json:"normalPalletGracePeriodEnabled"`
	Rates                          BillingRatesSnapshot  `json:"rates"`
	Sources                        billingPreviewSources `json:"sources"`
}

// CalculateBillingPreview reads operational source records directly from the
// database and produces the authoritative, container-level billing preview.
func (s *Store) CalculateBillingPreview(ctx context.Context, input BillingPreviewInput) (BillingPreviewResult, error) {
	normalized, billingRange, graceEnabled, err := normalizeBillingPreviewInput(input)
	if err != nil {
		return BillingPreviewResult{}, err
	}

	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return BillingPreviewResult{}, fmt.Errorf("begin billing preview snapshot: %w", err)
	}
	defer tx.Rollback()
	sources, err := s.loadBillingPreviewSourcesWithQueryer(ctx, tx, normalized.CustomerID, billingRange.EndExclusive)
	if err != nil {
		return BillingPreviewResult{}, err
	}
	preview, err := calculateBillingPreview(normalized, billingRange, graceEnabled, sources)
	if err != nil {
		return BillingPreviewResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return BillingPreviewResult{}, fmt.Errorf("commit billing preview snapshot: %w", err)
	}
	return preview, nil
}

// Preview exposes the same calculation through the application BillingService
// so an API handler does not need to depend on Store directly.
func (s *BillingService) Preview(ctx context.Context, input BillingPreviewInput) (BillingPreviewResult, error) {
	return s.store.CalculateBillingPreview(ctx, input)
}

func normalizeBillingPreviewInput(input BillingPreviewInput) (BillingPreviewInput, billingPreviewRange, bool, error) {
	if input.CustomerID <= 0 {
		return BillingPreviewInput{}, billingPreviewRange{}, false, fmt.Errorf("%w: billing customer is required", ErrInvalidInput)
	}
	if input.WarehouseLocationID != nil && *input.WarehouseLocationID <= 0 {
		return BillingPreviewInput{}, billingPreviewRange{}, false, fmt.Errorf("%w: warehouse location must be positive", ErrInvalidInput)
	}

	start, err := parseRequiredDate(input.PeriodStart)
	if err != nil {
		return BillingPreviewInput{}, billingPreviewRange{}, false, fmt.Errorf("%w: invalid billing period start: %v", ErrInvalidInput, err)
	}
	end, err := parseRequiredDate(input.PeriodEnd)
	if err != nil {
		return BillingPreviewInput{}, billingPreviewRange{}, false, fmt.Errorf("%w: invalid billing period end: %v", ErrInvalidInput, err)
	}
	start = dateOnly(start)
	end = dateOnly(end)
	if end.Before(start) {
		return BillingPreviewInput{}, billingPreviewRange{}, false, fmt.Errorf("%w: billing period end must be on or after the start date", ErrInvalidInput)
	}

	containerType := normalizeContainerType(input.ContainerType)
	if containerType != "" {
		if err := validateContainerType(containerType); err != nil {
			return BillingPreviewInput{}, billingPreviewRange{}, false, err
		}
	}
	rates, err := normalizeBillingPreviewRates(input.Rates)
	if err != nil {
		return BillingPreviewInput{}, billingPreviewRange{}, false, err
	}
	graceEnabled := true
	if input.NormalPalletGracePeriodEnabled != nil {
		graceEnabled = *input.NormalPalletGracePeriodEnabled
	}

	normalized := input
	normalized.PeriodStart = start.Format(time.DateOnly)
	normalized.PeriodEnd = end.Format(time.DateOnly)
	normalized.ContainerType = containerType
	normalized.Rates = rates
	return normalized, billingPreviewRange{Start: start, EndInclusive: end, EndExclusive: end.AddDate(0, 0, 1)}, graceEnabled, nil
}

func normalizeBillingPreviewRates(rates BillingRatesSnapshot) (BillingRatesSnapshot, error) {
	values := []struct {
		name  string
		value float64
	}{
		{"inbound container fee", rates.InboundContainerFee},
		{"transfer inbound fee", rates.TransferInboundFeePerPallet},
		{"wrapping fee", rates.WrappingFeePerPallet},
		{"legacy storage fee", rates.StorageFeePerPalletWeek},
		{"normal storage fee", rates.StorageFeePerPalletWeekNormal},
		{"transfer storage fee", rates.StorageFeePerPalletWeekWestCoastTransfer},
		{"outbound fee", rates.OutboundFeePerPallet},
		{"minimum qty per pallet", rates.MinimumQtyPerPallet},
	}
	if rates.ExcludeUnderfilledPallets && rates.MinimumQtyPerPallet <= 0 {
		return BillingRatesSnapshot{}, fmt.Errorf("%w: minimum qty per pallet must be greater than zero when underfilled-pallet exclusion is enabled", ErrInvalidInput)
	}
	if rates.MinimumQtyPerPallet > billingPreviewMaxQtyPerPallet {
		return BillingRatesSnapshot{}, fmt.Errorf("%w: minimum qty per pallet cannot exceed %d", ErrInvalidInput, billingPreviewMaxQtyPerPallet)
	}
	for _, value := range values {
		if math.IsNaN(value.value) || math.IsInf(value.value, 0) || value.value < 0 {
			return BillingRatesSnapshot{}, fmt.Errorf("%w: %s must be a finite non-negative number", ErrInvalidInput, value.name)
		}
	}
	if rates.StorageFeePerPalletWeekNormal <= 0 && rates.StorageFeePerPalletWeekWestCoastTransfer <= 0 && rates.StorageFeePerPalletWeek > 0 {
		rates.StorageFeePerPalletWeekNormal = rates.StorageFeePerPalletWeek
		rates.StorageFeePerPalletWeekWestCoastTransfer = rates.StorageFeePerPalletWeek
	}
	if rates.StorageFeePerPalletWeek == 0 {
		rates.StorageFeePerPalletWeek = rates.StorageFeePerPalletWeekNormal
	}
	return rates, nil
}

func dateOnly(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func (s *Store) loadBillingPreviewSourcesWithQueryer(
	ctx context.Context,
	queryer sqlx.QueryerContext,
	customerID int64,
	endExclusive time.Time,
) (billingPreviewSources, error) {
	sources := billingPreviewSources{
		Inbound:        make([]billingInboundSource, 0),
		InboundLines:   make([]billingInboundLineSource, 0),
		OutboundLines:  make([]billingOutboundLineSource, 0),
		Allocations:    make([]billingOutboundAllocationSource, 0),
		Lifecycle:      make([]billingLifecycleSource, 0),
		ContainerTypes: make([]billingContainerTypeSource, 0),
	}

	if err := sqlx.GetContext(ctx, queryer, &sources.CustomerName, `
		SELECT name
		FROM customers
		WHERE id = ?
	`, customerID); err != nil {
		return billingPreviewSources{}, mapDBError(fmt.Errorf("load billing customer: %w", err))
	}

	if err := sqlx.SelectContext(ctx, queryer, &sources.Inbound, `
		SELECT
			d.id AS document_id,
			d.location_id,
			l.name AS location_name,
			COALESCE(NULLIF(UPPER(TRIM(d.container_no)), ''), 'UNASSIGNED') AS container_no,
			COALESCE(NULLIF(UPPER(TRIM(d.container_type)), ''), 'NORMAL') AS container_type,
			COALESCE(d.actual_arrival_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_arrival_date) AS occurred_on,
			COALESCE(SUM(GREATEST(line.pallets, 0)), 0) AS pallets
		FROM inbound_documents d
		JOIN storage_locations l ON l.id = d.location_id
		LEFT JOIN inbound_document_lines line ON line.document_id = d.id
		WHERE d.customer_id = ?
		  AND UPPER(TRIM(d.status)) IN ('CONFIRMED', 'POSTED')
		  AND d.cancelled_at IS NULL
		  AND d.corrected_at IS NULL
		  AND COALESCE(d.actual_arrival_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_arrival_date) < ?
		GROUP BY
			d.id,
			d.location_id,
			l.name,
			COALESCE(NULLIF(UPPER(TRIM(d.container_no)), ''), 'UNASSIGNED'),
			COALESCE(NULLIF(UPPER(TRIM(d.container_type)), ''), 'NORMAL'),
			COALESCE(d.actual_arrival_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_arrival_date)
		ORDER BY occurred_on, d.id
	`, customerID, endExclusive); err != nil {
		return billingPreviewSources{}, fmt.Errorf("load billing inbound sources: %w", err)
	}

	if err := sqlx.SelectContext(ctx, queryer, &sources.InboundLines, `
		SELECT
			d.id AS document_id,
			line.id AS line_id,
			COALESCE((
				SELECT cle.sku_master_id
				FROM container_lifecycle_events cle
				WHERE cle.source_document_type = 'INBOUND'
				  AND cle.source_document_id = d.id
				  AND cle.source_line_id = line.id
				  AND cle.sku_master_id IS NOT NULL
				ORDER BY cle.id
				LIMIT 1
			), sm.id, 0) AS sku_master_id,
			COALESCE(NULLIF(UPPER(TRIM(line.storage_section)), ''), 'TEMP') AS storage_section,
			GREATEST(line.received_qty, 0) AS quantity,
			GREATEST(line.pallets, 0) AS pallets
		FROM inbound_documents d
		JOIN inbound_document_lines line ON line.document_id = d.id
		LEFT JOIN sku_master sm ON sm.sku = line.sku_snapshot
		WHERE d.customer_id = ?
		  AND UPPER(TRIM(d.status)) IN ('CONFIRMED', 'POSTED')
		  AND d.cancelled_at IS NULL
		  AND d.corrected_at IS NULL
		  AND COALESCE(d.actual_arrival_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_arrival_date) < ?
		ORDER BY d.id, line.sort_order, line.id
	`, customerID, endExclusive); err != nil {
		return billingPreviewSources{}, fmt.Errorf("load billing inbound line sources: %w", err)
	}

	if err := sqlx.SelectContext(ctx, queryer, &sources.OutboundLines, `
		SELECT
			d.id AS document_id,
			line.id AS line_id,
			COALESCE(line.sku_master_id, 0) AS sku_master_id,
			COALESCE(NULLIF(TRIM(d.packing_list_no), ''), CAST(d.id AS CHAR)) AS picking_no,
			line.location_id,
			COALESCE(NULLIF(line.location_name_snapshot, ''), l.name) AS location_name,
			COALESCE(d.actual_ship_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_ship_date) AS occurred_on,
			GREATEST(line.quantity, 0) AS quantity,
			GREATEST(line.pallets, 0) AS pallets
		FROM outbound_documents d
		JOIN outbound_document_lines line ON line.document_id = d.id
		JOIN storage_locations l ON l.id = line.location_id
		WHERE d.customer_id = ?
		  AND UPPER(TRIM(d.status)) IN ('CONFIRMED', 'POSTED')
		  AND d.cancelled_at IS NULL
		  AND COALESCE(d.actual_ship_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_ship_date) < ?
		ORDER BY occurred_on, d.id, line.sort_order, line.id
	`, customerID, endExclusive); err != nil {
		return billingPreviewSources{}, fmt.Errorf("load billing outbound sources: %w", err)
	}

	if err := sqlx.SelectContext(ctx, queryer, &sources.Allocations, `
		SELECT
			oca.id AS allocation_id,
			oca.outbound_line_id AS line_id,
			COALESCE(NULLIF(UPPER(TRIM(c.container_no)), ''), 'UNASSIGNED') AS container_no,
			oca.location_id,
			l.name AS location_name,
			COALESCE(NULLIF(UPPER(TRIM(oca.storage_section)), ''), 'TEMP') AS storage_section,
			GREATEST(oca.allocated_qty, 0) AS allocated_qty,
			UPPER(TRIM(oca.status)) AS status
		FROM outbound_container_allocations oca
		JOIN outbound_document_lines line ON line.id = oca.outbound_line_id
		JOIN outbound_documents d ON d.id = line.document_id
		JOIN containers c ON c.id = oca.container_id
		JOIN storage_locations l ON l.id = oca.location_id
		WHERE d.customer_id = ?
		  AND UPPER(TRIM(d.status)) IN ('CONFIRMED', 'POSTED')
		  AND d.cancelled_at IS NULL
		  AND UPPER(TRIM(oca.status)) IN ('RESERVED', 'SHIPPED')
		  AND COALESCE(d.actual_ship_date, DATE(d.confirmed_at), DATE(d.created_at), d.expected_ship_date) < ?
		ORDER BY oca.outbound_line_id, UPPER(TRIM(c.container_no)), oca.location_id, UPPER(TRIM(oca.storage_section)), oca.id
	`, customerID, endExclusive); err != nil {
		return billingPreviewSources{}, fmt.Errorf("load billing outbound allocation sources: %w", err)
	}

	if err := sqlx.SelectContext(ctx, queryer, &sources.Lifecycle, `
		SELECT
			cle.id AS event_id,
			cle.location_id,
			l.name AS location_name,
			COALESCE(NULLIF(UPPER(TRIM(cle.storage_section)), ''), 'TEMP') AS storage_section,
			COALESCE(NULLIF(UPPER(TRIM(cle.container_no)), ''), 'UNASSIGNED') AS container_no,
			COALESCE(cle.sku_master_id, 0) AS sku_master_id,
			UPPER(TRIM(cle.event_type)) AS event_type,
			DATE(cle.event_time) AS event_date,
			cle.quantity_delta,
			cle.pallet_delta,
			UPPER(TRIM(COALESCE(cle.source_document_type, ''))) AS source_type,
			COALESCE(cle.source_document_id, 0) AS source_id,
			COALESCE(cle.source_line_id, 0) AS source_line_id
		FROM container_lifecycle_events cle
		JOIN storage_locations l ON l.id = cle.location_id
		WHERE cle.customer_id = ?
		  AND cle.event_time < ?
		  AND (cle.quantity_delta <> 0 OR cle.pallet_delta <> 0)
		  AND (
			(
			  UPPER(TRIM(COALESCE(cle.source_document_type, ''))) = 'INBOUND'
			  AND EXISTS (
				SELECT 1
				FROM inbound_documents source_inbound
				WHERE source_inbound.id = cle.source_document_id
				  AND source_inbound.customer_id = cle.customer_id
				  AND UPPER(TRIM(source_inbound.status)) IN ('CONFIRMED', 'POSTED')
				  AND source_inbound.cancelled_at IS NULL
				  AND source_inbound.corrected_at IS NULL
			  )
			)
			OR (
			  UPPER(TRIM(COALESCE(cle.source_document_type, ''))) = 'OUTBOUND'
			  AND EXISTS (
				SELECT 1
				FROM outbound_documents source_outbound
				WHERE source_outbound.id = cle.source_document_id
				  AND source_outbound.customer_id = cle.customer_id
				  AND UPPER(TRIM(source_outbound.status)) IN ('CONFIRMED', 'POSTED')
				  AND source_outbound.cancelled_at IS NULL
			  )
			)
			OR UPPER(TRIM(COALESCE(cle.source_document_type, ''))) NOT IN ('INBOUND', 'OUTBOUND')
		  )
		ORDER BY UPPER(TRIM(cle.container_no)), cle.event_time, cle.id
	`, customerID, endExclusive); err != nil {
		return billingPreviewSources{}, fmt.Errorf("load billing lifecycle sources: %w", err)
	}

	if err := sqlx.SelectContext(ctx, queryer, &sources.ContainerTypes, `
		SELECT
			COALESCE(NULLIF(UPPER(TRIM(container_no)), ''), 'UNASSIGNED') AS container_no,
			COALESCE(NULLIF(UPPER(TRIM(container_type)), ''), 'NORMAL') AS container_type
		FROM containers
		WHERE customer_id = ?
		ORDER BY UPPER(TRIM(container_no)), id
	`, customerID); err != nil {
		return billingPreviewSources{}, fmt.Errorf("load billing container type sources: %w", err)
	}

	return sources, nil
}

func calculateBillingPreview(input BillingPreviewInput, billingRange billingPreviewRange, graceEnabled bool, sources billingPreviewSources) (BillingPreviewResult, error) {
	containerTypes := make(map[string]string)
	for _, source := range sources.Inbound {
		containerNo := billingPreviewContainerNo(source.ContainerNo)
		if _, exists := containerTypes[containerNo]; !exists {
			containerTypes[containerNo] = billingPreviewContainerType(source.ContainerType)
		}
	}
	for _, source := range sources.ContainerTypes {
		containerTypes[billingPreviewContainerNo(source.ContainerNo)] = billingPreviewContainerType(source.ContainerType)
	}
	initialNormalReceiptByContainer := initialNormalBillingReceiptIDs(sources.Inbound)
	type inboundBillingBucket struct {
		DocumentID     int64
		SKUMasterID    int64
		StorageSection string
	}
	type inboundBillingBucketTotals struct {
		Quantity float64
		Pallets  float64
	}
	inboundBuckets := make(map[inboundBillingBucket]inboundBillingBucketTotals)
	for _, sourceLine := range sources.InboundLines {
		key := inboundBillingBucket{
			DocumentID:     sourceLine.DocumentID,
			SKUMasterID:    sourceLine.SKUMasterID,
			StorageSection: normalizeStorageSection(sourceLine.StorageSection),
		}
		totals := inboundBuckets[key]
		totals.Quantity += sourceLine.Quantity
		totals.Pallets += sourceLine.Pallets
		inboundBuckets[key] = totals
	}
	billableInboundPalletsByDocument := make(map[int64]float64)
	for key, totals := range inboundBuckets {
		billableInboundPalletsByDocument[key.DocumentID] += billingPreviewBillablePallets(
			totals.Pallets,
			totals.Quantity,
			input.Rates,
		)
	}

	lines := make([]BillingPreviewLine, 0)
	warnings := make([]string, 0)
	for _, source := range sources.Inbound {
		containerNo := billingPreviewContainerNo(source.ContainerNo)
		containerType := billingPreviewContainerType(source.ContainerType)
		if !billingPreviewDateInRange(source.OccurredOn, billingRange) || !billingPreviewMatchesScope(input, source.LocationID, containerType) {
			continue
		}
		locationID := source.LocationID
		occurredOn := dateOnly(source.OccurredOn).Format(time.DateOnly)
		reference := fmt.Sprintf("Receipt %d | %s", source.DocumentID, containerNo)
		billableReceiptPallets := billingPreviewNonNegative(source.Pallets)
		if input.Rates.ExcludeUnderfilledPallets {
			billableReceiptPallets = billingPreviewRoundQuantity(billableInboundPalletsByDocument[source.DocumentID])
		}
		if containerType == ContainerTypeWestCoastTransfer {
			if billableReceiptPallets <= 0 {
				continue
			}
			lines = append(lines, BillingPreviewLine{
				ID: fmt.Sprintf("inbound-%d", source.DocumentID), ChargeType: BillingChargeInbound,
				SourceType: "INBOUND", SourceID: source.DocumentID, Reference: reference,
				ContainerNo: containerNo, ContainerType: containerType, Warehouse: source.LocationName,
				LocationID: &locationID, OccurredOn: occurredOn, Quantity: billableReceiptPallets,
				UnitRate:    input.Rates.TransferInboundFeePerPallet,
				Amount:      roundCurrencyGo(billableReceiptPallets * input.Rates.TransferInboundFeePerPallet),
				Description: "Transfer inbound pallets",
			})
			continue
		}

		// A container may have multiple receipt documents. The physical NORMAL
		// container is received once, while handling/wrapping remains receipt based.
		if initialNormalReceiptByContainer[containerNo] == source.DocumentID {
			lines = append(lines, BillingPreviewLine{
				ID: fmt.Sprintf("inbound-%d", source.DocumentID), ChargeType: BillingChargeInbound,
				SourceType: "INBOUND", SourceID: source.DocumentID, Reference: reference,
				ContainerNo: containerNo, ContainerType: containerType, Warehouse: source.LocationName,
				LocationID: &locationID, OccurredOn: occurredOn, Quantity: 1,
				UnitRate: input.Rates.InboundContainerFee, Amount: roundCurrencyGo(input.Rates.InboundContainerFee),
				Description: "Inbound container",
			})
		}
		if billableReceiptPallets > 0 {
			lines = append(lines, BillingPreviewLine{
				ID: fmt.Sprintf("wrapping-%d", source.DocumentID), ChargeType: BillingChargeWrapping,
				SourceType: "INBOUND", SourceID: source.DocumentID, Reference: reference,
				ContainerNo: containerNo, ContainerType: containerType, Warehouse: source.LocationName,
				LocationID: &locationID, OccurredOn: occurredOn, Quantity: billableReceiptPallets,
				UnitRate:    input.Rates.WrappingFeePerPallet,
				Amount:      roundCurrencyGo(billableReceiptPallets * input.Rates.WrappingFeePerPallet),
				Description: "Pallet wrapping",
			})
		}
	}

	allocationsByLine := make(map[int64][]billingOutboundAllocationSource)
	for _, allocation := range sources.Allocations {
		allocationsByLine[allocation.LineID] = append(allocationsByLine[allocation.LineID], allocation)
	}
	type outboundBillingBucket struct {
		DocumentID     int64
		SKUMasterID    int64
		ContainerNo    string
		LocationID     int64
		StorageSection string
	}
	type outboundBillingBucketTotals struct {
		SourceLineID int64
		PickingNo    string
		LocationName string
		OccurredOn   time.Time
		Quantity     int
		Pallets      int
	}
	outboundBuckets := make(map[outboundBillingBucket]outboundBillingBucketTotals)
	for _, source := range sources.OutboundLines {
		if !billingPreviewDateInRange(source.OccurredOn, billingRange) || (source.Quantity <= 0 && source.Pallets <= 0) {
			continue
		}
		allocatedGroups := groupBillingOutboundAllocations(allocationsByLine[source.LineID])
		if len(allocatedGroups) == 0 {
			containerType := billingPreviewContainerType(containerTypes[billingPreviewUnassigned])
			if !billingPreviewMatchesScope(input, source.LocationID, containerType) {
				continue
			}
			allocatedGroups = []billingOutboundAllocationGroup{{
				ContainerNo: billingPreviewUnassigned, LocationID: source.LocationID,
				LocationName: source.LocationName, AllocatedQty: source.Quantity,
			}}
			warnings = append(warnings, fmt.Sprintf("Outbound line %d has no source-container allocation; its shipping pallets are shown as UNASSIGNED.", source.LineID))
		}
		shares := allocateBillingPalletsLargestRemainder(source.Pallets, allocatedGroups)
		for index, group := range allocatedGroups {
			containerNo := billingPreviewContainerNo(group.ContainerNo)
			storageSection := normalizeStorageSection(group.StorageSection)
			key := outboundBillingBucket{
				DocumentID: source.DocumentID, SKUMasterID: source.SKUMasterID,
				ContainerNo: containerNo, LocationID: group.LocationID, StorageSection: storageSection,
			}
			totals := outboundBuckets[key]
			if totals.SourceLineID == 0 {
				totals.SourceLineID = source.LineID
			} else if totals.SourceLineID != source.LineID {
				totals.SourceLineID = -1
			}
			totals.PickingNo = source.PickingNo
			totals.LocationName = group.LocationName
			totals.OccurredOn = source.OccurredOn
			totals.Quantity += group.AllocatedQty
			totals.Pallets += shares[index]
			outboundBuckets[key] = totals
		}
	}
	outboundBucketKeys := make([]outboundBillingBucket, 0, len(outboundBuckets))
	for key := range outboundBuckets {
		outboundBucketKeys = append(outboundBucketKeys, key)
	}
	sort.Slice(outboundBucketKeys, func(left, right int) bool {
		leftKey := outboundBucketKeys[left]
		rightKey := outboundBucketKeys[right]
		if leftKey.DocumentID != rightKey.DocumentID {
			return leftKey.DocumentID < rightKey.DocumentID
		}
		if leftKey.SKUMasterID != rightKey.SKUMasterID {
			return leftKey.SKUMasterID < rightKey.SKUMasterID
		}
		if leftKey.ContainerNo != rightKey.ContainerNo {
			return leftKey.ContainerNo < rightKey.ContainerNo
		}
		if leftKey.LocationID != rightKey.LocationID {
			return leftKey.LocationID < rightKey.LocationID
		}
		return leftKey.StorageSection < rightKey.StorageSection
	})
	for _, key := range outboundBucketKeys {
		totals := outboundBuckets[key]
		containerType := billingPreviewContainerType(containerTypes[key.ContainerNo])
		billablePallets := billingPreviewBillablePallets(float64(totals.Pallets), float64(totals.Quantity), input.Rates)
		if billablePallets <= 0 || !billingPreviewMatchesScope(input, key.LocationID, containerType) {
			continue
		}
		sourceLineID := totals.SourceLineID
		if sourceLineID < 0 {
			sourceLineID = 0
		}
		locationID := key.LocationID
		lines = append(lines, BillingPreviewLine{
			ID:         fmt.Sprintf("outbound-%d-%d-%s-%d-%s", key.DocumentID, key.SKUMasterID, key.ContainerNo, key.LocationID, key.StorageSection),
			ChargeType: BillingChargeOutbound, SourceType: "OUTBOUND", SourceID: key.DocumentID,
			SourceLineID: sourceLineID, Reference: fmt.Sprintf("Picking order %s | %s", totals.PickingNo, key.ContainerNo),
			ContainerNo: key.ContainerNo, ContainerType: containerType, Warehouse: totals.LocationName,
			LocationID: &locationID, OccurredOn: dateOnly(totals.OccurredOn).Format(time.DateOnly),
			Quantity: billablePallets, UnitRate: input.Rates.OutboundFeePerPallet,
			Amount:      roundCurrencyGo(billablePallets * input.Rates.OutboundFeePerPallet),
			Description: "Outbound shipping pallets",
		})
	}

	storageRows, storageLines, dailyBalances := calculateBillingStorage(input, billingRange, graceEnabled, sources, containerTypes)
	lines = append(lines, storageLines...)
	sort.SliceStable(lines, func(left, right int) bool {
		if lines[left].OccurredOn != lines[right].OccurredOn {
			return lines[left].OccurredOn < lines[right].OccurredOn
		}
		if lines[left].ContainerNo != lines[right].ContainerNo {
			return lines[left].ContainerNo < lines[right].ContainerNo
		}
		if billingChargeSortRank(lines[left].ChargeType) != billingChargeSortRank(lines[right].ChargeType) {
			return billingChargeSortRank(lines[left].ChargeType) < billingChargeSortRank(lines[right].ChargeType)
		}
		return lines[left].ID < lines[right].ID
	})

	summary := summarizeBillingPreview(lines, storageRows)
	fingerprint, err := fingerprintBillingPreviewSources(input, graceEnabled, sources)
	if err != nil {
		return BillingPreviewResult{}, err
	}
	sort.Strings(warnings)
	return BillingPreviewResult{
		CalculationVersion: BillingPreviewCalculationVersion, SourceFingerprint: fingerprint,
		CustomerID: input.CustomerID, CustomerName: sources.CustomerName,
		WarehouseLocationID: input.WarehouseLocationID, ContainerType: input.ContainerType,
		PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd,
		NormalPalletGracePeriodEnabled: graceEnabled, Rates: input.Rates,
		Lines: lines, StorageRows: storageRows, DailyBalances: dailyBalances,
		Summary: summary, Warnings: warnings,
	}, nil
}

func initialNormalBillingReceiptIDs(sources []billingInboundSource) map[string]int64 {
	type initialReceipt struct {
		documentID int64
		occurredOn time.Time
	}
	initialByContainer := make(map[string]initialReceipt)
	for _, source := range sources {
		if billingPreviewContainerType(source.ContainerType) != ContainerTypeNormal {
			continue
		}
		containerNo := billingPreviewContainerNo(source.ContainerNo)
		current, exists := initialByContainer[containerNo]
		if !exists || source.OccurredOn.Before(current.occurredOn) ||
			(source.OccurredOn.Equal(current.occurredOn) && source.DocumentID < current.documentID) {
			initialByContainer[containerNo] = initialReceipt{
				documentID: source.DocumentID,
				occurredOn: source.OccurredOn,
			}
		}
	}

	result := make(map[string]int64, len(initialByContainer))
	for containerNo, receipt := range initialByContainer {
		result[containerNo] = receipt.documentID
	}
	return result
}

type billingOutboundAllocationGroup struct {
	ContainerNo    string
	LocationID     int64
	LocationName   string
	StorageSection string
	AllocatedQty   int
}

func groupBillingOutboundAllocations(allocations []billingOutboundAllocationSource) []billingOutboundAllocationGroup {
	groupsByKey := make(map[string]*billingOutboundAllocationGroup)
	for _, allocation := range allocations {
		if allocation.AllocatedQty <= 0 {
			continue
		}
		containerNo := billingPreviewContainerNo(allocation.ContainerNo)
		storageSection := normalizeStorageSection(allocation.StorageSection)
		key := fmt.Sprintf("%s|%020d|%s", containerNo, allocation.LocationID, storageSection)
		group := groupsByKey[key]
		if group == nil {
			group = &billingOutboundAllocationGroup{
				ContainerNo: containerNo, LocationID: allocation.LocationID,
				LocationName: allocation.LocationName, StorageSection: storageSection,
			}
			groupsByKey[key] = group
		}
		group.AllocatedQty += allocation.AllocatedQty
	}
	keys := make([]string, 0, len(groupsByKey))
	for key := range groupsByKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	groups := make([]billingOutboundAllocationGroup, 0, len(keys))
	for _, key := range keys {
		groups = append(groups, *groupsByKey[key])
	}
	return groups
}

func allocateBillingPalletsLargestRemainder(totalPallets int, groups []billingOutboundAllocationGroup) []int {
	result := make([]int, len(groups))
	if totalPallets <= 0 || len(groups) == 0 {
		return result
	}
	totalQty := 0
	for _, group := range groups {
		totalQty += max(group.AllocatedQty, 0)
	}
	if totalQty <= 0 {
		return result
	}
	type remainder struct {
		Index     int
		Remainder int
	}
	remainders := make([]remainder, 0, len(groups))
	assigned := 0
	for index, group := range groups {
		numerator := totalPallets * max(group.AllocatedQty, 0)
		result[index] = numerator / totalQty
		assigned += result[index]
		remainders = append(remainders, remainder{Index: index, Remainder: numerator % totalQty})
	}
	sort.SliceStable(remainders, func(left, right int) bool {
		if remainders[left].Remainder != remainders[right].Remainder {
			return remainders[left].Remainder > remainders[right].Remainder
		}
		return remainders[left].Index < remainders[right].Index
	})
	for offset := 0; assigned < totalPallets; offset++ {
		result[remainders[offset%len(remainders)].Index]++
		assigned++
	}
	return result
}

type billingStorageGroup struct {
	ContainerNo   string
	ContainerType string
	Events        []billingLifecycleSource
}

type billingStorageBalanceKey struct {
	LocationID     int64
	StorageSection string
	SKUMasterID    int64
}

func calculateBillingStorage(
	input BillingPreviewInput,
	billingRange billingPreviewRange,
	graceEnabled bool,
	sources billingPreviewSources,
	containerTypes map[string]string,
) ([]BillingPreviewStorageRow, []BillingPreviewLine, []BillingPreviewDailyBalance) {
	groupsByContainer := make(map[string]*billingStorageGroup)
	for _, event := range sources.Lifecycle {
		containerNo := billingPreviewContainerNo(event.ContainerNo)
		containerType := billingPreviewContainerType(containerTypes[containerNo])
		if input.ContainerType != "" && containerType != input.ContainerType {
			continue
		}
		group := groupsByContainer[containerNo]
		if group == nil {
			group = &billingStorageGroup{ContainerNo: containerNo, ContainerType: containerType, Events: make([]billingLifecycleSource, 0)}
			groupsByContainer[containerNo] = group
		}
		group.Events = append(group.Events, event)
	}

	containerNumbers := make([]string, 0, len(groupsByContainer))
	for containerNo := range groupsByContainer {
		containerNumbers = append(containerNumbers, containerNo)
	}
	sort.Strings(containerNumbers)

	totalDailyBalances := make(map[string]float64)
	rows := make([]BillingPreviewStorageRow, 0, len(containerNumbers))
	lines := make([]BillingPreviewLine, 0, len(containerNumbers))
	rangeDays := int(billingRange.EndExclusive.Sub(billingRange.Start).Hours() / 24)
	if rangeDays < 1 {
		rangeDays = 1
	}

	for _, containerNo := range containerNumbers {
		group := groupsByContainer[containerNo]
		sort.SliceStable(group.Events, func(left, right int) bool {
			leftDate := dateOnly(group.Events[left].EventDate)
			rightDate := dateOnly(group.Events[right].EventDate)
			if !leftDate.Equal(rightDate) {
				return leftDate.Before(rightDate)
			}
			return group.Events[left].EventID < group.Events[right].EventID
		})

		palletBalancesByPosition := make(map[billingStorageBalanceKey]float64)
		quantityBalancesByPosition := make(map[billingStorageBalanceKey]float64)
		locationNames := make(map[int64]string)
		dailyBalances := make(map[string]float64)
		freeDailyBalances := make(map[string]float64)
		warehousesTouched := make(map[string]struct{})
		var firstPositiveEvent *time.Time
		receivedOn := ""
		for _, event := range group.Events {
			if event.PalletDelta > 0 {
				value := dateOnly(event.EventDate)
				if firstPositiveEvent == nil {
					firstPositiveEvent = &value
				}
				if receivedOn == "" && strings.EqualFold(strings.TrimSpace(event.EventType), StockLedgerEventReceive) {
					receivedOn = value.Format(time.DateOnly)
				}
			}
		}
		if receivedOn == "" && firstPositiveEvent != nil {
			receivedOn = firstPositiveEvent.Format(time.DateOnly)
		}
		graceDays := 0
		if graceEnabled && group.ContainerType == ContainerTypeNormal {
			graceDays = billingPreviewStorageGraceDays
		}

		eventIndex := 0
		applyEvent := func(event billingLifecycleSource) {
			positionKey := billingStorageBalanceKey{
				LocationID:     event.LocationID,
				StorageSection: strings.ToUpper(strings.TrimSpace(event.StorageSection)),
				SKUMasterID:    event.SKUMasterID,
			}
			palletBalancesByPosition[positionKey] = billingPreviewRoundQuantity(
				palletBalancesByPosition[positionKey] + event.PalletDelta,
			)
			quantityBalancesByPosition[positionKey] = billingPreviewRoundQuantity(
				quantityBalancesByPosition[positionKey] + event.QuantityDelta,
			)
			locationNames[event.LocationID] = event.LocationName
			eventDay := dateOnly(event.EventDate)
			if event.PalletDelta != 0 &&
				!eventDay.Before(billingRange.Start) && eventDay.Before(billingRange.EndExclusive) &&
				(input.WarehouseLocationID == nil || event.LocationID == *input.WarehouseLocationID) {
				warehouse := strings.TrimSpace(event.LocationName)
				if warehouse == "" {
					warehouse = fmt.Sprintf("Warehouse #%d", event.LocationID)
				}
				warehousesTouched[warehouse] = struct{}{}
			}
		}
		billablePalletBalance := func(recordWarehouses bool) float64 {
			balance := 0.0
			for positionKey, palletBalance := range palletBalancesByPosition {
				if palletBalance <= 0 || (input.WarehouseLocationID != nil && positionKey.LocationID != *input.WarehouseLocationID) {
					continue
				}
				billablePallets := billingPreviewBillablePallets(
					palletBalance,
					quantityBalancesByPosition[positionKey],
					input.Rates,
				)
				if billablePallets <= 0 {
					continue
				}
				balance += billablePallets
				if recordWarehouses {
					warehouse := strings.TrimSpace(locationNames[positionKey.LocationID])
					if warehouse == "" {
						warehouse = fmt.Sprintf("Warehouse #%d", positionKey.LocationID)
					}
					warehousesTouched[warehouse] = struct{}{}
				}
			}
			return billingPreviewRoundQuantity(balance)
		}
		inventoryPalletBalance := func(recordWarehouses bool) float64 {
			balance := 0.0
			for positionKey, palletBalance := range palletBalancesByPosition {
				if palletBalance <= 0 || (input.WarehouseLocationID != nil && positionKey.LocationID != *input.WarehouseLocationID) {
					continue
				}
				balance += palletBalance
				if recordWarehouses {
					warehouse := strings.TrimSpace(locationNames[positionKey.LocationID])
					if warehouse == "" {
						warehouse = fmt.Sprintf("Warehouse #%d", positionKey.LocationID)
					}
					warehousesTouched[warehouse] = struct{}{}
				}
			}
			return billingPreviewRoundQuantity(balance)
		}
		for eventIndex < len(group.Events) && dateOnly(group.Events[eventIndex].EventDate).Before(billingRange.Start) {
			applyEvent(group.Events[eventIndex])
			eventIndex++
		}
		openingPallets := inventoryPalletBalance(true)
		closingPallets := openingPallets
		palletReleaseEvents := buildBillingPalletReleaseEvents(group.Events, input.WarehouseLocationID, billingRange)
		palletDays := 0.0
		freePalletDays := 0.0
		maximumPallets := 0.0
		for day := billingRange.Start; day.Before(billingRange.EndExclusive); day = day.AddDate(0, 0, 1) {
			for eventIndex < len(group.Events) && !dateOnly(group.Events[eventIndex].EventDate).After(day) {
				applyEvent(group.Events[eventIndex])
				eventIndex++
			}

			dayEndPallets := billablePalletBalance(true)
			closingPallets = inventoryPalletBalance(true)
			if dayEndPallets <= 0 {
				continue
			}
			dayKey := day.Format(time.DateOnly)
			dailyBalances[dayKey] = dayEndPallets
			totalDailyBalances[dayKey] = billingPreviewRoundQuantity(totalDailyBalances[dayKey] + dayEndPallets)
			palletDays += dayEndPallets
			maximumPallets = math.Max(maximumPallets, dayEndPallets)
			if graceDays > 0 && firstPositiveEvent != nil && day.Before(firstPositiveEvent.AddDate(0, 0, graceDays)) {
				freeDailyBalances[dayKey] = dayEndPallets
				freePalletDays += dayEndPallets
			}
		}

		palletDays = billingPreviewRoundQuantity(palletDays)
		freePalletDays = billingPreviewRoundQuantity(freePalletDays)
		if palletDays <= 0 && openingPallets <= 0 && closingPallets <= 0 && len(palletReleaseEvents) == 0 {
			continue
		}
		weeklyRate := input.Rates.StorageFeePerPalletWeekNormal
		if group.ContainerType == ContainerTypeWestCoastTransfer {
			weeklyRate = input.Rates.StorageFeePerPalletWeekWestCoastTransfer
		}
		dailyRate := weeklyRate / 7
		segments := buildBillingStorageSegments(dailyBalances, freeDailyBalances, billingRange, dailyRate)
		warehouseNames := make([]string, 0, len(warehousesTouched))
		for warehouse := range warehousesTouched {
			warehouseNames = append(warehouseNames, warehouse)
		}
		sort.Strings(warehouseNames)
		grossAmount := roundCurrencyGo(palletDays * dailyRate)
		discountAmount := roundCurrencyGo(freePalletDays * dailyRate)
		row := BillingPreviewStorageRow{
			CustomerID: input.CustomerID, CustomerName: sources.CustomerName,
			ContainerNo: group.ContainerNo, ContainerType: group.ContainerType, ReceivedOn: receivedOn,
			WarehousesTouched: warehouseNames, OpeningPallets: openingPallets, ClosingPallets: closingPallets,
			PalletReleaseEvents: palletReleaseEvents,
			PalletsTracked:      billingPreviewRoundQuantity(maximumPallets),
			PalletDays:          palletDays, FreePalletDays: freePalletDays,
			BillablePalletDays:  billingPreviewRoundQuantity(palletDays - freePalletDays),
			AverageDailyPallets: billingPreviewRoundQuantity(palletDays / float64(rangeDays)),
			GrossAmount:         grossAmount, DiscountAmount: discountAmount,
			Amount: roundCurrencyGo(grossAmount - discountAmount), Segments: segments,
		}
		if input.WarehouseLocationID != nil {
			locationID := *input.WarehouseLocationID
			row.LocationID = &locationID
		}
		if len(segments) > 0 {
			row.FirstActivityOn = segments[0].StartDate
			row.LastActivityOn = segments[len(segments)-1].EndDate
		}
		rows = append(rows, row)
		warehouse := strings.Join(warehouseNames, ", ")
		if warehouse == "" {
			warehouse = "-"
		}
		lines = append(lines, BillingPreviewLine{
			ID:         fmt.Sprintf("storage-%d-%s", input.CustomerID, group.ContainerNo),
			ChargeType: BillingChargeStorage, SourceType: "CONTAINER_LIFECYCLE",
			Reference:   fmt.Sprintf("Storage | %s", group.ContainerNo),
			ContainerNo: group.ContainerNo, ContainerType: group.ContainerType,
			Warehouse: warehouse, LocationID: row.LocationID, OccurredOn: row.LastActivityOn,
			Quantity: row.BillablePalletDays, UnitRate: billingPreviewRoundQuantity(dailyRate), Amount: row.Amount,
			Description: "Container storage pallet-days",
		})
	}

	dailyRows := make([]BillingPreviewDailyBalance, 0, rangeDays)
	for day := billingRange.Start; day.Before(billingRange.EndExclusive); day = day.AddDate(0, 0, 1) {
		dayKey := day.Format(time.DateOnly)
		dailyRows = append(dailyRows, BillingPreviewDailyBalance{Date: dayKey, PalletCount: totalDailyBalances[dayKey]})
	}
	return rows, lines, dailyRows
}

type billingTransferReleaseKey struct {
	Date         string
	SourceType   string
	SourceID     int64
	SourceLineID int64
}

// buildBillingPalletReleaseEvents records actual pallet reductions instead of
// inferring them from the net day-end balance. Positive activity on the same
// day therefore cannot hide an outbound or adjustment release. Transfers are
// netted within the selected billing scope so an internal move is not reported
// as a pallet release.
func buildBillingPalletReleaseEvents(
	events []billingLifecycleSource,
	warehouseLocationID *int64,
	billingRange billingPreviewRange,
) []BillingPreviewPalletRelease {
	releasedByDate := make(map[string]float64)
	transferNetBySource := make(map[billingTransferReleaseKey]float64)

	for _, event := range events {
		day := dateOnly(event.EventDate)
		if day.Before(billingRange.Start) || !day.Before(billingRange.EndExclusive) {
			continue
		}
		if warehouseLocationID != nil && event.LocationID != *warehouseLocationID {
			continue
		}
		date := day.Format(time.DateOnly)
		eventType := strings.ToUpper(strings.TrimSpace(event.EventType))
		if eventType == StockLedgerEventTransferOut || eventType == StockLedgerEventTransferIn {
			key := billingTransferReleaseKey{
				Date: date, SourceType: strings.ToUpper(strings.TrimSpace(event.SourceType)),
				SourceID: event.SourceID, SourceLineID: event.SourceLineID,
			}
			transferNetBySource[key] = billingPreviewRoundQuantity(transferNetBySource[key] + event.PalletDelta)
			continue
		}
		if event.PalletDelta < 0 {
			releasedByDate[date] = billingPreviewRoundQuantity(releasedByDate[date] - event.PalletDelta)
		}
	}

	for key, net := range transferNetBySource {
		if net < 0 {
			releasedByDate[key.Date] = billingPreviewRoundQuantity(releasedByDate[key.Date] - net)
		}
	}

	dates := make([]string, 0, len(releasedByDate))
	for date, pallets := range releasedByDate {
		if pallets > 0 {
			dates = append(dates, date)
		}
	}
	sort.Strings(dates)
	releases := make([]BillingPreviewPalletRelease, 0, len(dates))
	for _, date := range dates {
		releases = append(releases, BillingPreviewPalletRelease{
			Date: date, Pallets: billingPreviewRoundQuantity(releasedByDate[date]),
		})
	}
	return releases
}

func buildBillingStorageSegments(daily, free map[string]float64, billingRange billingPreviewRange, dailyRate float64) []BillingPreviewStorageSegment {
	type activeSegment struct {
		StartDate, EndDate string
		Pallets, Free      float64
		Days               int
	}
	segments := make([]BillingPreviewStorageSegment, 0)
	var active *activeSegment
	appendActive := func() {
		if active == nil {
			return
		}
		palletDays := billingPreviewRoundQuantity(active.Pallets * float64(active.Days))
		freePalletDays := billingPreviewRoundQuantity(active.Free * float64(active.Days))
		gross := roundCurrencyGo(palletDays * dailyRate)
		discount := roundCurrencyGo(freePalletDays * dailyRate)
		segments = append(segments, BillingPreviewStorageSegment{
			StartDate: active.StartDate, EndDate: active.EndDate, DayEndPallets: active.Pallets,
			BilledDays: active.Days, PalletDays: palletDays, FreePalletDays: freePalletDays,
			BillablePalletDays: billingPreviewRoundQuantity(palletDays - freePalletDays),
			GrossAmount:        gross, DiscountAmount: discount, Amount: roundCurrencyGo(gross - discount),
		})
		active = nil
	}
	for day := billingRange.Start; day.Before(billingRange.EndExclusive); day = day.AddDate(0, 0, 1) {
		dayKey := day.Format(time.DateOnly)
		pallets := daily[dayKey]
		freePallets := math.Min(free[dayKey], pallets)
		if pallets <= 0 {
			appendActive()
			continue
		}
		if active != nil && active.Pallets == pallets && active.Free == freePallets {
			active.EndDate = dayKey
			active.Days++
			continue
		}
		appendActive()
		active = &activeSegment{StartDate: dayKey, EndDate: dayKey, Pallets: pallets, Free: freePallets, Days: 1}
	}
	appendActive()

	var rawGrossTotal float64
	var rawDiscountTotal float64
	for _, segment := range segments {
		rawGrossTotal += segment.PalletDays * dailyRate
		rawDiscountTotal += segment.FreePalletDays * dailyRate
	}
	grossTotal := roundCurrencyGo(rawGrossTotal)
	discountTotal := roundCurrencyGo(rawDiscountTotal)
	discountAmounts := allocateBillingCurrencyAmounts(segments, func(segment BillingPreviewStorageSegment) float64 {
		return segment.FreePalletDays * dailyRate
	}, discountTotal)
	netAmounts := allocateBillingCurrencyAmounts(segments, func(segment BillingPreviewStorageSegment) float64 {
		return segment.BillablePalletDays * dailyRate
	}, roundCurrencyGo(grossTotal-discountTotal))
	for index := range segments {
		segments[index].GrossAmount = roundCurrencyGo(discountAmounts[index] + netAmounts[index])
		segments[index].DiscountAmount = discountAmounts[index]
		segments[index].Amount = netAmounts[index]
	}
	return segments
}

func allocateBillingCurrencyAmounts(
	segments []BillingPreviewStorageSegment,
	rawAmount func(BillingPreviewStorageSegment) float64,
	targetAmount float64,
) []float64 {
	amounts := make([]float64, len(segments))
	if len(segments) == 0 {
		return amounts
	}

	type currencyRemainder struct {
		Index     int
		Remainder float64
	}
	remainders := make([]currencyRemainder, 0, len(segments))
	baseCents := make([]int64, len(segments))
	var assignedCents int64
	for index, segment := range segments {
		raw := math.Max(rawAmount(segment), 0)
		rawCents := raw * 100
		base := int64(math.Floor(rawCents + 0.000000001))
		baseCents[index] = base
		assignedCents += base
		remainders = append(remainders, currencyRemainder{
			Index: index, Remainder: rawCents - float64(base),
		})
	}

	targetCents := int64(math.Round(math.Max(targetAmount, 0) * 100))
	sort.SliceStable(remainders, func(left, right int) bool {
		if remainders[left].Remainder != remainders[right].Remainder {
			return remainders[left].Remainder > remainders[right].Remainder
		}
		return remainders[left].Index < remainders[right].Index
	})
	for assignedCents < targetCents {
		for _, remainder := range remainders {
			if assignedCents >= targetCents {
				break
			}
			baseCents[remainder.Index]++
			assignedCents++
		}
	}
	for index, cents := range baseCents {
		amounts[index] = float64(cents) / 100
	}
	return amounts
}

func billingPreviewMatchesScope(input BillingPreviewInput, locationID int64, containerType string) bool {
	if input.WarehouseLocationID != nil && locationID != *input.WarehouseLocationID {
		return false
	}
	return input.ContainerType == "" || billingPreviewContainerType(containerType) == input.ContainerType
}

func billingPreviewDateInRange(value time.Time, billingRange billingPreviewRange) bool {
	value = dateOnly(value)
	return !value.Before(billingRange.Start) && value.Before(billingRange.EndExclusive)
}

func billingPreviewContainerNo(value string) string {
	normalized := normalizeContainerNo(value)
	if normalized == "" {
		return billingPreviewUnassigned
	}
	return normalized
}

func billingPreviewContainerType(value string) string {
	normalized := normalizeContainerType(value)
	if normalized != ContainerTypeWestCoastTransfer {
		return ContainerTypeNormal
	}
	return normalized
}

func billingPreviewNonNegative(value float64) float64 {
	if value <= 0 {
		return 0
	}
	return billingPreviewRoundQuantity(value)
}

// billingPreviewBillablePallets applies the optional minimum-fill rule without
// relying on the deprecated pallet-entity model. At a billing bucket level,
// every billed pallet must be backed by at least MinimumQtyPerPallet units.
func billingPreviewBillablePallets(pallets, quantity float64, rates BillingRatesSnapshot) float64 {
	physicalPallets := billingPreviewNonNegative(pallets)
	if physicalPallets <= 0 || !rates.ExcludeUnderfilledPallets {
		return physicalPallets
	}
	if rates.MinimumQtyPerPallet <= 0 {
		return physicalPallets
	}
	quantityBackedPallets := math.Floor((billingPreviewNonNegative(quantity) + 1e-9) / rates.MinimumQtyPerPallet)
	return billingPreviewRoundQuantity(math.Min(physicalPallets, quantityBackedPallets))
}

func billingPreviewRoundQuantity(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func billingChargeSortRank(chargeType string) int {
	switch chargeType {
	case BillingChargeInbound:
		return 1
	case BillingChargeWrapping:
		return 2
	case BillingChargeStorage:
		return 3
	case BillingChargeOutbound:
		return 4
	default:
		return 5
	}
}

func summarizeBillingPreview(lines []BillingPreviewLine, storageRows []BillingPreviewStorageRow) BillingPreviewSummary {
	var summary BillingPreviewSummary
	receivedContainers := make(map[string]struct{})
	for _, line := range lines {
		switch line.ChargeType {
		case BillingChargeInbound:
			containerNo := billingPreviewContainerNo(line.ContainerNo)
			if _, exists := receivedContainers[containerNo]; !exists {
				receivedContainers[containerNo] = struct{}{}
				summary.ReceivedContainers++
			}
			summary.InboundAmount += line.Amount
			if line.ContainerType == ContainerTypeWestCoastTransfer {
				summary.ReceivedPallets += line.Quantity
			}
		case BillingChargeWrapping:
			summary.ReceivedPallets += line.Quantity
			summary.WrappingAmount += line.Amount
		case BillingChargeStorage:
			summary.StorageAmount += line.Amount
		case BillingChargeOutbound:
			summary.ShippedPallets += line.Quantity
			summary.OutboundAmount += line.Amount
		}
	}
	for _, row := range storageRows {
		summary.PalletDays += row.PalletDays
		summary.StorageGrossAmount += row.GrossAmount
		summary.StorageDiscountAmount += row.DiscountAmount
	}
	summary.ReceivedPallets = billingPreviewRoundQuantity(summary.ReceivedPallets)
	summary.ShippedPallets = billingPreviewRoundQuantity(summary.ShippedPallets)
	summary.PalletDays = billingPreviewRoundQuantity(summary.PalletDays)
	summary.InboundAmount = roundCurrencyGo(summary.InboundAmount)
	summary.WrappingAmount = roundCurrencyGo(summary.WrappingAmount)
	summary.StorageGrossAmount = roundCurrencyGo(summary.StorageGrossAmount)
	summary.StorageDiscountAmount = roundCurrencyGo(summary.StorageDiscountAmount)
	summary.StorageAmount = roundCurrencyGo(summary.StorageAmount)
	summary.OutboundAmount = roundCurrencyGo(summary.OutboundAmount)
	summary.GrandTotal = roundCurrencyGo(summary.InboundAmount + summary.WrappingAmount + summary.StorageAmount + summary.OutboundAmount)
	return summary
}

func fingerprintBillingPreviewSources(input BillingPreviewInput, graceEnabled bool, sources billingPreviewSources) (string, error) {
	payload, err := json.Marshal(billingPreviewScopeFingerprint{
		CalculationVersion: BillingPreviewCalculationVersion,
		CustomerID:         input.CustomerID, WarehouseLocationID: input.WarehouseLocationID,
		ContainerType: input.ContainerType, PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd,
		NormalPalletGracePeriodEnabled: graceEnabled,
		Rates:                          input.Rates,
		Sources:                        sources,
	})
	if err != nil {
		return "", fmt.Errorf("encode billing source fingerprint: %w", err)
	}
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}
