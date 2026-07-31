package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// --- constants ---

const (
	BillingInvoiceStatusDraft     = "DRAFT"
	BillingInvoiceStatusFinalized = "FINALIZED"
	BillingInvoiceStatusPaid      = "PAID"
	BillingInvoiceStatusVoid      = "VOID"
	BillingInvoiceTypeMixed       = "MIXED"
	BillingInvoiceTypeStorage     = "STORAGE_SETTLEMENT"
)

// --- public types ---

type BillingInvoice struct {
	ID                    int64                           `json:"id"`
	InvoiceNo             string                          `json:"invoiceNo"`
	InvoiceType           string                          `json:"invoiceType"`
	CustomerID            int64                           `json:"customerId"`
	CustomerNameSnapshot  string                          `json:"customerNameSnapshot"`
	WarehouseLocationID   *int64                          `json:"warehouseLocationId"`
	WarehouseNameSnapshot string                          `json:"warehouseNameSnapshot"`
	ContainerType         string                          `json:"containerType"`
	PeriodStart           string                          `json:"periodStart"`
	PeriodEnd             string                          `json:"periodEnd"`
	CurrencyCode          string                          `json:"currencyCode"`
	Rates                 BillingRatesSnapshot            `json:"rates"`
	Header                BillingInvoiceHeader            `json:"header"`
	Subtotal              float64                         `json:"subtotal"`
	DiscountTotal         float64                         `json:"discountTotal"`
	GrandTotal            float64                         `json:"grandTotal"`
	Status                string                          `json:"status"`
	Notes                 string                          `json:"notes"`
	FinalizedAt           *time.Time                      `json:"finalizedAt"`
	FinalizedByUserID     *int64                          `json:"finalizedByUserId"`
	PaidAt                *time.Time                      `json:"paidAt"`
	VoidedAt              *time.Time                      `json:"voidedAt"`
	CreatedByUserID       int64                           `json:"createdByUserId"`
	CreatedAt             time.Time                       `json:"createdAt"`
	UpdatedAt             time.Time                       `json:"updatedAt"`
	LineCount             int                             `json:"lineCount"`
	Lines                 []BillingInvoiceLine            `json:"lines"`
	ContainerDetails      []BillingInvoiceContainerDetail `json:"containerDetails"`
}

// BillingInvoiceContainerDetail is a read model built from the persisted
// invoice-line snapshots. It gives every container an independently
// reconcilable sub-ledger without introducing a second source of truth.
type BillingInvoiceContainerDetail struct {
	ContainerNo           string   `json:"containerNo"`
	Warehouses            []string `json:"warehouses"`
	References            []string `json:"references"`
	InboundUnits          float64  `json:"inboundUnits"`
	WrappingPallets       float64  `json:"wrappingPallets"`
	PalletsTracked        float64  `json:"palletsTracked"`
	PalletDays            float64  `json:"palletDays"`
	FreePalletDays        float64  `json:"freePalletDays"`
	BillablePalletDays    float64  `json:"billablePalletDays"`
	OutboundPallets       float64  `json:"outboundPallets"`
	InboundAmount         float64  `json:"inboundAmount"`
	WrappingAmount        float64  `json:"wrappingAmount"`
	StorageGrossAmount    float64  `json:"storageGrossAmount"`
	StorageDiscountAmount float64  `json:"storageDiscountAmount"`
	StorageAmount         float64  `json:"storageAmount"`
	OutboundAmount        float64  `json:"outboundAmount"`
	AdjustmentAmount      float64  `json:"adjustmentAmount"`
	TotalAmount           float64  `json:"totalAmount"`
	LineCount             int      `json:"lineCount"`
}

type BillingInvoiceHeader struct {
	SellerName          string `json:"sellerName"`
	Subtitle            string `json:"subtitle"`
	RemitTo             string `json:"remitTo"`
	Terms               string `json:"terms"`
	PaymentDueDays      int    `json:"paymentDueDays"`
	PaymentInstructions string `json:"paymentInstructions"`
}

type BillingInvoiceLine struct {
	ID          int64           `json:"id"`
	InvoiceID   int64           `json:"invoiceId"`
	ChargeType  string          `json:"chargeType"`
	Description string          `json:"description"`
	Reference   string          `json:"reference"`
	ContainerNo string          `json:"containerNo"`
	Warehouse   string          `json:"warehouse"`
	OccurredOn  string          `json:"occurredOn"`
	Quantity    float64         `json:"quantity"`
	UnitRate    float64         `json:"unitRate"`
	Amount      float64         `json:"amount"`
	Notes       string          `json:"notes"`
	SourceType  string          `json:"sourceType"`
	SortOrder   int             `json:"sortOrder"`
	CreatedAt   string          `json:"createdAt"`
	Details     json.RawMessage `json:"details,omitempty"`
}

type BillingRatesSnapshot struct {
	InboundContainerFee                      float64 `json:"inboundContainerFee"`
	TransferInboundFeePerPallet              float64 `json:"transferInboundFeePerPallet"`
	WrappingFeePerPallet                     float64 `json:"wrappingFeePerPallet"`
	StorageFeePerPalletWeek                  float64 `json:"storageFeePerPalletPerWeek,omitempty"`
	StorageFeePerPalletWeekNormal            float64 `json:"storageFeePerPalletPerWeekNormal"`
	StorageFeePerPalletWeekWestCoastTransfer float64 `json:"storageFeePerPalletPerWeekWestCoastTransfer"`
	OutboundFeePerPallet                     float64 `json:"outboundFeePerPallet"`
	ExcludeUnderfilledPallets                bool    `json:"excludeUnderfilledPallets,omitempty"`
	MinimumQtyPerPallet                      float64 `json:"minimumQtyPerPallet,omitempty"`
}

// --- input types ---

type CreateBillingInvoiceInput struct {
	InvoiceType         string                          `json:"invoiceType"`
	CustomerID          int64                           `json:"customerId"`
	CustomerName        string                          `json:"customerName"`
	WarehouseLocationID *int64                          `json:"warehouseLocationId"`
	WarehouseName       string                          `json:"warehouseName"`
	ContainerType       string                          `json:"containerType"`
	PeriodStart         string                          `json:"periodStart"`
	PeriodEnd           string                          `json:"periodEnd"`
	Rates               BillingRatesSnapshot            `json:"rates"`
	Header              *BillingInvoiceHeader           `json:"header"`
	Notes               string                          `json:"notes"`
	Lines               []CreateBillingInvoiceLineInput `json:"lines"`
}

type CreateBillingInvoiceLineInput struct {
	ChargeType  string          `json:"chargeType"`
	Description string          `json:"description"`
	Reference   string          `json:"reference"`
	ContainerNo string          `json:"containerNo"`
	Warehouse   string          `json:"warehouse"`
	OccurredOn  string          `json:"occurredOn"`
	Quantity    float64         `json:"quantity"`
	UnitRate    float64         `json:"unitRate"`
	Amount      float64         `json:"amount"`
	Notes       string          `json:"notes"`
	SourceType  string          `json:"sourceType"`
	Details     json.RawMessage `json:"details,omitempty"`
}

type UpdateBillingInvoiceInput struct {
	CustomerName *string               `json:"customerName,omitempty"`
	Notes        *string               `json:"notes,omitempty"`
	Header       *BillingInvoiceHeader `json:"header,omitempty"`
}

type AddBillingInvoiceLineInput struct {
	ChargeType  string  `json:"chargeType"`
	Description string  `json:"description"`
	Reference   string  `json:"reference"`
	ContainerNo string  `json:"containerNo"`
	Warehouse   string  `json:"warehouse"`
	OccurredOn  string  `json:"occurredOn"`
	Quantity    float64 `json:"quantity"`
	UnitRate    float64 `json:"unitRate"`
	Amount      float64 `json:"amount"`
	Notes       string  `json:"notes"`
}

type UpdateBillingInvoiceLineInput struct {
	ChargeType  string  `json:"chargeType"`
	Description string  `json:"description"`
	Reference   string  `json:"reference"`
	ContainerNo string  `json:"containerNo"`
	Warehouse   string  `json:"warehouse"`
	OccurredOn  string  `json:"occurredOn"`
	Quantity    float64 `json:"quantity"`
	UnitRate    float64 `json:"unitRate"`
	Amount      float64 `json:"amount"`
	Notes       string  `json:"notes"`
}

// --- row types ---

type billingInvoiceRow struct {
	ID                    int64          `db:"id"`
	InvoiceNo             string         `db:"invoice_no"`
	InvoiceType           string         `db:"invoice_type"`
	CustomerID            int64          `db:"customer_id"`
	CustomerNameSnapshot  string         `db:"customer_name_snapshot"`
	WarehouseLocationID   sql.NullInt64  `db:"warehouse_location_id"`
	WarehouseNameSnapshot sql.NullString `db:"warehouse_name_snapshot"`
	ContainerType         sql.NullString `db:"container_type"`
	PeriodStart           time.Time      `db:"period_start"`
	PeriodEnd             time.Time      `db:"period_end"`
	CurrencyCode          string         `db:"currency_code"`
	RatesJSON             string         `db:"rates_json"`
	HeaderJSON            sql.NullString `db:"header_json"`
	Subtotal              float64        `db:"subtotal"`
	DiscountTotal         float64        `db:"discount_total"`
	GrandTotal            float64        `db:"grand_total"`
	Status                string         `db:"status"`
	Notes                 sql.NullString `db:"notes"`
	FinalizedAt           sql.NullTime   `db:"finalized_at"`
	FinalizedByUserID     sql.NullInt64  `db:"finalized_by_user_id"`
	PaidAt                sql.NullTime   `db:"paid_at"`
	VoidedAt              sql.NullTime   `db:"voided_at"`
	CreatedByUserID       int64          `db:"created_by_user_id"`
	CreatedAt             time.Time      `db:"created_at"`
	UpdatedAt             time.Time      `db:"updated_at"`
	LineCount             int            `db:"line_count"`
}

type billingInvoiceLineRow struct {
	ID          int64          `db:"id"`
	InvoiceID   int64          `db:"invoice_id"`
	ChargeType  string         `db:"charge_type"`
	Description string         `db:"description"`
	Reference   sql.NullString `db:"reference"`
	ContainerNo sql.NullString `db:"container_no"`
	Warehouse   sql.NullString `db:"warehouse"`
	OccurredOn  sql.NullTime   `db:"occurred_on"`
	Quantity    float64        `db:"quantity"`
	UnitRate    float64        `db:"unit_rate"`
	Amount      float64        `db:"amount"`
	Notes       sql.NullString `db:"notes"`
	SourceType  string         `db:"source_type"`
	SortOrder   int            `db:"sort_order"`
	CreatedAt   time.Time      `db:"created_at"`
	DetailsJSON sql.NullString `db:"details_json"`
}

// --- store methods ---

func (s *Store) ListBillingInvoices(ctx context.Context, customerID int64, status string, invoiceType string) ([]BillingInvoice, error) {
	normalizedInvoiceType, err := normalizeBillingInvoiceType(invoiceType, true)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			id, invoice_no, invoice_type, customer_id, customer_name_snapshot,
			warehouse_location_id, warehouse_name_snapshot, container_type,
			period_start, period_end, currency_code, rates_json, header_json,
			subtotal, discount_total, grand_total, status, notes,
			finalized_at, finalized_by_user_id, paid_at, voided_at,
			created_by_user_id, created_at, updated_at,
			(SELECT COUNT(*) FROM billing_invoice_lines WHERE invoice_id = billing_invoices.id) AS line_count
		FROM billing_invoices
		WHERE 1=1`
	args := make([]any, 0)

	if customerID > 0 {
		query += ` AND customer_id = ?`
		args = append(args, customerID)
	}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, strings.ToUpper(strings.TrimSpace(status)))
	}
	if normalizedInvoiceType != "" {
		query += ` AND invoice_type = ?`
		args = append(args, normalizedInvoiceType)
	}
	query += ` ORDER BY created_at DESC LIMIT 200`

	var rows []billingInvoiceRow
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("list billing invoices: %w", err)
	}

	invoices := make([]BillingInvoice, 0, len(rows))
	for _, row := range rows {
		invoice := toBillingInvoice(row)
		invoice.Lines = []BillingInvoiceLine{}
		invoice.ContainerDetails = []BillingInvoiceContainerDetail{}
		invoices = append(invoices, invoice)
	}
	return invoices, nil
}

func (s *Store) GetBillingInvoice(ctx context.Context, invoiceID int64) (BillingInvoice, error) {
	var row billingInvoiceRow
	if err := s.db.GetContext(ctx, &row, `
		SELECT
			id, invoice_no, invoice_type, customer_id, customer_name_snapshot,
			warehouse_location_id, warehouse_name_snapshot, container_type,
			period_start, period_end, currency_code, rates_json, header_json,
			subtotal, discount_total, grand_total, status, notes,
			finalized_at, finalized_by_user_id, paid_at, voided_at,
			created_by_user_id, created_at, updated_at,
			(SELECT COUNT(*) FROM billing_invoice_lines WHERE invoice_id = billing_invoices.id) AS line_count
		FROM billing_invoices
		WHERE id = ?
	`, invoiceID); err != nil {
		if err == sql.ErrNoRows {
			return BillingInvoice{}, fmt.Errorf("%w: billing invoice not found", ErrNotFound)
		}
		return BillingInvoice{}, fmt.Errorf("get billing invoice: %w", err)
	}

	invoice := toBillingInvoice(row)

	var lineRows []billingInvoiceLineRow
	if err := s.db.SelectContext(ctx, &lineRows, `
		SELECT
			id, invoice_id, charge_type, description, reference,
			container_no, warehouse, occurred_on, quantity, unit_rate,
			amount, notes, source_type, sort_order, created_at, details_json
		FROM billing_invoice_lines
		WHERE invoice_id = ?
		ORDER BY sort_order ASC, id ASC
	`, invoiceID); err != nil {
		return BillingInvoice{}, fmt.Errorf("load billing invoice lines: %w", err)
	}

	invoice.Lines = make([]BillingInvoiceLine, 0, len(lineRows))
	for _, lineRow := range lineRows {
		invoice.Lines = append(invoice.Lines, toBillingInvoiceLine(lineRow))
	}
	invoice.ContainerDetails = buildBillingInvoiceContainerDetails(invoice.Lines)

	return invoice, nil
}

type preparedBillingInvoiceCreate struct {
	invoiceType             string
	normalizedContainerType string
	periodStart             time.Time
	periodEnd               time.Time
	ratesJSON               string
	headerJSON              string
	invoiceNo               string
	customerName            string
}

type billingCustomerLockTx interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type billingSourceMutationScope struct {
	CustomerID    int64
	OccurredAt    time.Time
	LocationIDs   []int64
	ContainerNo   string
	ContainerType string
}

func prepareBillingInvoiceCreate(input CreateBillingInvoiceInput) (preparedBillingInvoiceCreate, error) {
	if input.CustomerID <= 0 {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if input.WarehouseLocationID != nil && *input.WarehouseLocationID <= 0 {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: warehouse scope must be a valid location", ErrInvalidInput)
	}
	if strings.TrimSpace(input.PeriodStart) == "" || strings.TrimSpace(input.PeriodEnd) == "" {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: billing period start and end are required", ErrInvalidInput)
	}
	invoiceType, err := normalizeBillingInvoiceType(input.InvoiceType, false)
	if err != nil {
		return preparedBillingInvoiceCreate{}, err
	}
	normalizedContainerType := strings.TrimSpace(strings.ToUpper(input.ContainerType))
	if invoiceType == BillingInvoiceTypeStorage && normalizedContainerType == "" {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: container type is required for storage settlement invoices", ErrInvalidInput)
	}
	if normalizedContainerType != "" {
		if err := validateContainerType(normalizedContainerType); err != nil {
			return preparedBillingInvoiceCreate{}, err
		}
		normalizedContainerType = coalesceContainerType(normalizedContainerType)
	}

	periodStart, err := parseRequiredDate(input.PeriodStart)
	if err != nil {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: invalid period start date", ErrInvalidInput)
	}
	periodEnd, err := parseRequiredDate(input.PeriodEnd)
	if err != nil {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: invalid period end date", ErrInvalidInput)
	}
	if periodEnd.Before(periodStart) {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("%w: billing period end must be on or after the start date", ErrInvalidInput)
	}

	normalizedRates := normalizeBillingRatesSnapshot(input.Rates)
	ratesJSON, err := json.Marshal(normalizedRates)
	if err != nil {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("marshal rates: %w", err)
	}
	normalizedHeader := defaultBillingInvoiceHeader()
	if input.Header != nil {
		normalizedHeader = normalizeBillingInvoiceHeader(*input.Header)
	}
	headerJSON, err := json.Marshal(normalizedHeader)
	if err != nil {
		return preparedBillingInvoiceCreate{}, fmt.Errorf("marshal invoice header: %w", err)
	}

	invoiceNo := generateBillingInvoiceNo(periodStart, input.CustomerID)
	customerName := strings.TrimSpace(input.CustomerName)
	if customerName == "" {
		customerName = fmt.Sprintf("Customer #%d", input.CustomerID)
	}
	return preparedBillingInvoiceCreate{
		invoiceType: invoiceType, normalizedContainerType: normalizedContainerType,
		periodStart: periodStart, periodEnd: periodEnd,
		ratesJSON: string(ratesJSON), headerJSON: string(headerJSON),
		invoiceNo: invoiceNo, customerName: customerName,
	}, nil
}

func (s *Store) CreateBillingInvoice(ctx context.Context, input CreateBillingInvoiceInput, createdByUserID int64) (BillingInvoice, error) {
	prepared, err := prepareBillingInvoiceCreate(input)
	if err != nil {
		return BillingInvoice{}, err
	}
	tx, err := s.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin billing invoice transaction: %w", err)
	}
	defer tx.Rollback()
	if err := lockBillingCustomerTx(ctx, tx, input.CustomerID); err != nil {
		return BillingInvoice{}, err
	}
	invoiceID, err := createBillingInvoiceTx(ctx, tx, input, createdByUserID, prepared)
	if err != nil {
		return BillingInvoice{}, err
	}
	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit billing invoice: %w", err)
	}
	return s.GetBillingInvoice(ctx, invoiceID)
}

func lockBillingCustomerTx(ctx context.Context, tx billingCustomerLockTx, customerID int64) error {
	return lockBillingSourceCustomersTx(ctx, tx, []int64{customerID})
}

func lockBillingSourceCustomersTx(ctx context.Context, tx billingCustomerLockTx, customerIDs []int64) error {
	unique := make(map[int64]struct{}, len(customerIDs))
	ordered := make([]int64, 0, len(customerIDs))
	for _, customerID := range customerIDs {
		if customerID <= 0 {
			return fmt.Errorf("%w: billing source customer is required", ErrInvalidInput)
		}
		if _, exists := unique[customerID]; exists {
			continue
		}
		unique[customerID] = struct{}{}
		ordered = append(ordered, customerID)
	}
	sort.Slice(ordered, func(left, right int) bool { return ordered[left] < ordered[right] })
	for _, customerID := range ordered {
		var lockedCustomerID int64
		if err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM customers
			WHERE id = ?
			FOR UPDATE
		`, customerID).Scan(&lockedCustomerID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("%w: billing customer was not found", ErrInvalidInput)
			}
			return fmt.Errorf("lock billing customer %d: %w", customerID, err)
		}
	}
	return nil
}

// ensureBillingSourceMutationsAllowedTx protects already-generated invoice
// scopes from later back-dated operational changes. The invoice lookup is a
// locking/current read so it still observes an invoice that committed while
// this transaction was waiting for the shared customer row lock, even under
// REPEATABLE READ.
func ensureBillingSourceMutationsAllowedTx(
	ctx context.Context,
	tx billingCustomerLockTx,
	scopes ...billingSourceMutationScope,
) error {
	customerIDs := make([]int64, 0, len(scopes))
	for _, scope := range scopes {
		customerIDs = append(customerIDs, scope.CustomerID)
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, customerIDs); err != nil {
		return err
	}

	for _, scope := range scopes {
		effectiveAt := scope.OccurredAt
		if effectiveAt.IsZero() {
			effectiveAt = time.Now().UTC()
		}
		containerNo := normalizeContainerNo(scope.ContainerNo)
		containerType := normalizeContainerType(scope.ContainerType)
		if containerType == "" && containerNo != "" {
			var storedContainerType string
			err := tx.QueryRowContext(ctx, `
				SELECT COALESCE(NULLIF(UPPER(TRIM(container_type)), ''), ?)
				FROM containers
				WHERE customer_id = ?
				  AND UPPER(TRIM(container_no)) = ?
				LIMIT 1
				FOR UPDATE
			`, ContainerTypeNormal, scope.CustomerID, containerNo).Scan(&storedContainerType)
			if err == nil {
				containerType = normalizeContainerType(storedContainerType)
			} else if !errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("resolve billing source container type: %w", err)
			}
		}
		locations := make([]int64, 0, len(scope.LocationIDs))
		seenLocations := make(map[int64]struct{}, len(scope.LocationIDs))
		for _, locationID := range scope.LocationIDs {
			if locationID <= 0 {
				continue
			}
			if _, exists := seenLocations[locationID]; exists {
				continue
			}
			seenLocations[locationID] = struct{}{}
			locations = append(locations, locationID)
		}
		sort.Slice(locations, func(left, right int) bool { return locations[left] < locations[right] })

		query := `
			SELECT invoice_no
			FROM billing_invoices
			WHERE customer_id = ?
			  AND status <> ?
			  AND period_end >= ?`
		args := []any{scope.CustomerID, BillingInvoiceStatusVoid, dateOnly(effectiveAt)}
		if len(locations) > 0 {
			placeholders := make([]string, len(locations))
			for index, locationID := range locations {
				placeholders[index] = "?"
				args = append(args, locationID)
			}
			query += fmt.Sprintf(" AND (warehouse_location_id IS NULL OR warehouse_location_id IN (%s)", strings.Join(placeholders, ","))
			if containerNo != "" {
				query += ` OR EXISTS (
					SELECT 1
					FROM billing_invoice_lines source_line
					WHERE source_line.invoice_id = billing_invoices.id
					  AND UPPER(TRIM(COALESCE(source_line.container_no, ''))) = ?
				)`
				args = append(args, containerNo)
			}
			query += ")"
		} else if containerNo != "" {
			query += ` AND EXISTS (
				SELECT 1
				FROM billing_invoice_lines source_line
				WHERE source_line.invoice_id = billing_invoices.id
				  AND UPPER(TRIM(COALESCE(source_line.container_no, ''))) = ?
			)`
			args = append(args, containerNo)
		}
		if containerType != "" {
			query += " AND (container_type IS NULL OR UPPER(TRIM(container_type)) = ?)"
			args = append(args, containerType)
		}
		query += " ORDER BY period_end DESC, id DESC LIMIT 1 FOR UPDATE"

		var invoiceNo string
		err := tx.QueryRowContext(ctx, query, args...).Scan(&invoiceNo)
		if err == nil {
			return fmt.Errorf(
				"%w: billing invoice %s already covers this source date or a later inventory balance; void that invoice before changing operational history",
				ErrInvalidInput,
				invoiceNo,
			)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check invoiced billing source scope: %w", err)
		}
	}
	return nil
}

func ensureContainerBillingTypeMutationAllowedTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	containerNo string,
	currentType string,
	nextType string,
) error {
	containerNo = normalizeContainerNo(containerNo)
	currentType = billingPreviewContainerType(currentType)
	nextType = billingPreviewContainerType(nextType)
	if containerNo == "" || currentType == nextType {
		return nil
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, []int64{customerID}); err != nil {
		return err
	}

	var earliest *time.Time
	var lifecycleAt time.Time
	err := tx.QueryRowContext(ctx, `
		SELECT event_time
		FROM container_lifecycle_events
		WHERE customer_id = ?
		  AND UPPER(TRIM(container_no)) = ?
		ORDER BY event_time, id
		LIMIT 1
		FOR UPDATE
	`, customerID, containerNo).Scan(&lifecycleAt)
	if err == nil {
		earliest = &lifecycleAt
	} else if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("load container billing lifecycle for type change: %w", err)
	}

	var receiptAt time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT COALESCE(actual_arrival_date, DATE(confirmed_at), DATE(created_at), expected_arrival_date)
		FROM inbound_documents
		WHERE customer_id = ?
		  AND UPPER(TRIM(COALESCE(container_no, ''))) = ?
		  AND UPPER(TRIM(status)) IN ('CONFIRMED', 'POSTED')
		  AND cancelled_at IS NULL
		  AND corrected_at IS NULL
		ORDER BY COALESCE(actual_arrival_date, DATE(confirmed_at), DATE(created_at), expected_arrival_date), id
		LIMIT 1
		FOR UPDATE
	`, customerID, containerNo).Scan(&receiptAt)
	if err == nil {
		if earliest == nil || receiptAt.Before(*earliest) {
			earliest = &receiptAt
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("load container billing receipts for type change: %w", err)
	}
	if earliest == nil {
		return nil
	}

	return ensureBillingSourceMutationsAllowedTx(ctx, tx,
		billingSourceMutationScope{
			CustomerID: customerID, OccurredAt: *earliest,
			ContainerNo: containerNo, ContainerType: currentType,
		},
		billingSourceMutationScope{
			CustomerID: customerID, OccurredAt: *earliest,
			ContainerNo: containerNo, ContainerType: nextType,
		},
	)
}

func createBillingInvoiceTx(
	ctx context.Context,
	tx *sqlx.Tx,
	input CreateBillingInvoiceInput,
	createdByUserID int64,
	prepared preparedBillingInvoiceCreate,
) (int64, error) {
	var existingInvoiceID int64
	warehouseScope := nullableInt64Ptr(input.WarehouseLocationID)
	containerTypeScope := nullableString(prepared.normalizedContainerType)
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM billing_invoices
		WHERE customer_id = ?
			AND (warehouse_location_id IS NULL OR ? IS NULL OR warehouse_location_id = ?)
			AND (container_type IS NULL OR ? IS NULL OR container_type = ?)
			AND period_start <= ?
			AND period_end >= ?
			AND status <> ?
		ORDER BY id DESC
		LIMIT 1
	`, input.CustomerID,
		warehouseScope, warehouseScope,
		containerTypeScope, containerTypeScope,
		prepared.periodEnd, prepared.periodStart,
		BillingInvoiceStatusVoid,
	).Scan(&existingInvoiceID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("check billing invoice duplicates: %w", err)
	}
	if err == nil && existingInvoiceID > 0 {
		return 0, fmt.Errorf("%w: a non-void invoice already overlaps this customer, warehouse scope, container type, and billing period", ErrInvalidInput)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO billing_invoices (
			invoice_no, invoice_type, customer_id, customer_name_snapshot,
			warehouse_location_id, warehouse_name_snapshot, container_type,
			period_start, period_end, currency_code, rates_json, header_json,
			subtotal, discount_total, grand_total,
			status, notes, created_by_user_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, 0, 0, 0, ?, ?, ?)
	`, prepared.invoiceNo, prepared.invoiceType, input.CustomerID, prepared.customerName,
		nullableInt64Ptr(input.WarehouseLocationID), nullableString(strings.TrimSpace(input.WarehouseName)),
		nullableString(prepared.normalizedContainerType),
		prepared.periodStart, prepared.periodEnd, prepared.ratesJSON, prepared.headerJSON,
		BillingInvoiceStatusDraft, nullableString(strings.TrimSpace(input.Notes)), createdByUserID)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("create billing invoice: %w", err))
	}

	invoiceID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve billing invoice id: %w", err)
	}

	for index, line := range input.Lines {
		sourceType := strings.TrimSpace(strings.ToUpper(line.SourceType))
		if sourceType == "" {
			sourceType = "AUTO"
		}
		occurredOn, _ := parseOptionalDate(line.OccurredOn)
		detailsJSON, err := normalizeBillingInvoiceLineDetails(line.Details)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO billing_invoice_lines (
				invoice_id, charge_type, description, reference,
				container_no, warehouse, occurred_on,
				quantity, unit_rate, amount, notes,
				source_type, sort_order, details_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, invoiceID,
			strings.TrimSpace(strings.ToUpper(line.ChargeType)),
			strings.TrimSpace(line.Description),
			nullableString(strings.TrimSpace(line.Reference)),
			nullableString(strings.TrimSpace(line.ContainerNo)),
			nullableString(strings.TrimSpace(line.Warehouse)),
			nullableTime(occurredOn),
			line.Quantity,
			line.UnitRate,
			roundCurrencyGo(line.Amount),
			nullableString(strings.TrimSpace(line.Notes)),
			sourceType,
			index+1,
			nullableJSONString(detailsJSON),
		); err != nil {
			return 0, mapDBError(fmt.Errorf("insert billing invoice line: %w", err))
		}
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx.Tx, invoiceID); err != nil {
		return 0, err
	}
	return invoiceID, nil
}

func (s *Store) UpdateBillingInvoice(ctx context.Context, invoiceID int64, input UpdateBillingInvoiceInput) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}

	updates := make([]string, 0, 4)
	args := make([]any, 0, 4)
	if input.CustomerName != nil {
		customerName := strings.TrimSpace(*input.CustomerName)
		if customerName == "" {
			return BillingInvoice{}, fmt.Errorf("%w: customer name is required", ErrInvalidInput)
		}
		updates = append(updates, "customer_name_snapshot = ?")
		args = append(args, customerName)
	}
	if input.Notes != nil {
		updates = append(updates, "notes = ?")
		args = append(args, nullableString(strings.TrimSpace(*input.Notes)))
	}
	if input.Header != nil {
		normalizedHeader := normalizeBillingInvoiceHeader(*input.Header)
		headerJSON, err := json.Marshal(normalizedHeader)
		if err != nil {
			return BillingInvoice{}, fmt.Errorf("marshal invoice header: %w", err)
		}
		updates = append(updates, "header_json = ?")
		args = append(args, string(headerJSON))
	}
	if len(updates) == 0 {
		return invoice, nil
	}
	updates = append(updates, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, invoiceID)

	if _, err := s.db.ExecContext(ctx, fmt.Sprintf(`
		UPDATE billing_invoices
		SET %s
		WHERE id = ?
	`, strings.Join(updates, ", ")), args...); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("update billing invoice: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) AddBillingInvoiceLine(ctx context.Context, invoiceID int64, input AddBillingInvoiceLineInput) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}
	if isAuthoritativeGeneratedBillingInvoice(invoice) {
		return BillingInvoice{}, fmt.Errorf("%w: server-generated invoice lines are immutable; delete and regenerate the draft to change calculated charges", ErrInvalidInput)
	}

	chargeType := strings.TrimSpace(strings.ToUpper(input.ChargeType))
	if chargeType == "" {
		return BillingInvoice{}, fmt.Errorf("%w: charge type is required", ErrInvalidInput)
	}

	maxSort := 0
	for _, line := range invoice.Lines {
		if line.SortOrder > maxSort {
			maxSort = line.SortOrder
		}
	}

	occurredOn, _ := parseOptionalDate(input.OccurredOn)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin add line transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO billing_invoice_lines (
			invoice_id, charge_type, description, reference,
			container_no, warehouse, occurred_on,
			quantity, unit_rate, amount, notes,
			source_type, sort_order, details_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, NULL)
	`, invoiceID, chargeType,
		strings.TrimSpace(input.Description),
		nullableString(strings.TrimSpace(input.Reference)),
		nullableString(strings.TrimSpace(input.ContainerNo)),
		nullableString(strings.TrimSpace(input.Warehouse)),
		nullableTime(occurredOn),
		input.Quantity, input.UnitRate, roundCurrencyGo(input.Amount),
		nullableString(strings.TrimSpace(input.Notes)),
		maxSort+1,
	); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("add billing invoice line: %w", err))
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit add line: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) UpdateBillingInvoiceLine(ctx context.Context, invoiceID int64, lineID int64, input UpdateBillingInvoiceLineInput) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}
	if isAuthoritativeGeneratedBillingInvoice(invoice) {
		return BillingInvoice{}, fmt.Errorf("%w: server-generated invoice lines are immutable; delete and regenerate the draft to change calculated charges", ErrInvalidInput)
	}

	found := false
	for _, line := range invoice.Lines {
		if line.ID == lineID {
			found = true
			break
		}
	}
	if !found {
		return BillingInvoice{}, fmt.Errorf("%w: invoice line not found", ErrNotFound)
	}

	chargeType := strings.TrimSpace(strings.ToUpper(input.ChargeType))
	if chargeType == "" {
		return BillingInvoice{}, fmt.Errorf("%w: charge type is required", ErrInvalidInput)
	}

	occurredOn, _ := parseOptionalDate(input.OccurredOn)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin update line transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE billing_invoice_lines
		SET
			charge_type = ?,
			description = ?,
			reference = ?,
			container_no = ?,
			warehouse = ?,
			occurred_on = ?,
			quantity = ?,
			unit_rate = ?,
			amount = ?,
			notes = ?
		WHERE id = ? AND invoice_id = ?
	`, chargeType,
		strings.TrimSpace(input.Description),
		nullableString(strings.TrimSpace(input.Reference)),
		nullableString(strings.TrimSpace(input.ContainerNo)),
		nullableString(strings.TrimSpace(input.Warehouse)),
		nullableTime(occurredOn),
		input.Quantity, input.UnitRate, roundCurrencyGo(input.Amount),
		nullableString(strings.TrimSpace(input.Notes)),
		lineID, invoiceID,
	); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("update billing invoice line: %w", err))
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit update line: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) DeleteBillingInvoiceLine(ctx context.Context, invoiceID int64, lineID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}
	if isAuthoritativeGeneratedBillingInvoice(invoice) {
		return BillingInvoice{}, fmt.Errorf("%w: server-generated invoice lines are immutable; delete and regenerate the draft to change calculated charges", ErrInvalidInput)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin delete line transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM billing_invoice_lines WHERE id = ? AND invoice_id = ?
	`, lineID, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("delete billing invoice line: %w", err))
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit delete line: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func isAuthoritativeGeneratedBillingInvoice(invoice BillingInvoice) bool {
	for _, line := range invoice.Lines {
		if !strings.EqualFold(strings.TrimSpace(line.SourceType), "AUTO") || len(line.Details) == 0 {
			continue
		}
		var provenance struct {
			CalculationVersion string `json:"calculationVersion"`
			SourceFingerprint  string `json:"sourceFingerprint"`
		}
		if err := json.Unmarshal(line.Details, &provenance); err != nil {
			continue
		}
		if strings.TrimSpace(provenance.CalculationVersion) != "" && strings.TrimSpace(provenance.SourceFingerprint) != "" {
			return true
		}
	}
	return false
}

func (s *Store) FinalizeBillingInvoice(ctx context.Context, invoiceID int64, userID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be finalized", ErrInvalidInput)
	}
	if containers := unreconciledBillingPalletMovementContainers(invoice.Lines); len(containers) > 0 {
		return BillingInvoice{}, fmt.Errorf(
			"%w: pallet movement does not reconcile for container(s): %s",
			ErrInvalidInput,
			strings.Join(containers, ", "),
		)
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET status = ?, finalized_at = ?, finalized_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, BillingInvoiceStatusFinalized, now, userID, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("finalize billing invoice: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) MarkBillingInvoicePaid(ctx context.Context, invoiceID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusFinalized {
		return BillingInvoice{}, fmt.Errorf("%w: only finalized invoices can be marked as paid", ErrInvalidInput)
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, BillingInvoiceStatusPaid, now, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("mark billing invoice paid: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) VoidBillingInvoice(ctx context.Context, invoiceID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status == BillingInvoiceStatusVoid {
		return BillingInvoice{}, fmt.Errorf("%w: invoice is already voided", ErrInvalidInput)
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET status = ?, voided_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, BillingInvoiceStatusVoid, now, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("void billing invoice: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) DeleteBillingInvoice(ctx context.Context, invoiceID int64) error {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return fmt.Errorf("%w: only draft invoices can be deleted", ErrInvalidInput)
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM billing_invoices WHERE id = ?`, invoiceID); err != nil {
		return mapDBError(fmt.Errorf("delete billing invoice: %w", err))
	}

	return nil
}

// --- helpers ---

func recalcBillingInvoiceTotalsTx(ctx context.Context, tx *sql.Tx, invoiceID int64) error {
	var subtotal, discountTotal float64
	rows, err := tx.QueryContext(ctx, `
		SELECT charge_type, amount FROM billing_invoice_lines WHERE invoice_id = ?
	`, invoiceID)
	if err != nil {
		return fmt.Errorf("load invoice lines for recalc: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var chargeType string
		var amount float64
		if err := rows.Scan(&chargeType, &amount); err != nil {
			return fmt.Errorf("scan invoice line for recalc: %w", err)
		}
		if chargeType == "DISCOUNT" {
			discountTotal += amount
		} else {
			subtotal += amount
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate invoice lines for recalc: %w", err)
	}

	grandTotal := roundCurrencyGo(subtotal + discountTotal)
	subtotal = roundCurrencyGo(subtotal)
	discountTotal = roundCurrencyGo(discountTotal)

	if _, err := tx.ExecContext(ctx, `
		UPDATE billing_invoices
		SET subtotal = ?, discount_total = ?, grand_total = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, subtotal, discountTotal, grandTotal, invoiceID); err != nil {
		return mapDBError(fmt.Errorf("recalc billing invoice totals: %w", err))
	}

	return nil
}

func toBillingInvoice(row billingInvoiceRow) BillingInvoice {
	var rates BillingRatesSnapshot
	_ = json.Unmarshal([]byte(row.RatesJSON), &rates)
	rates = normalizeBillingRatesSnapshot(rates)

	containerType := ""
	if row.ContainerType.Valid && strings.TrimSpace(row.ContainerType.String) != "" {
		containerType = coalesceContainerType(row.ContainerType.String)
	} else if row.InvoiceType == BillingInvoiceTypeStorage {
		containerType = ContainerTypeNormal
	}

	invoice := BillingInvoice{
		ID:                    row.ID,
		InvoiceNo:             row.InvoiceNo,
		InvoiceType:           row.InvoiceType,
		CustomerID:            row.CustomerID,
		CustomerNameSnapshot:  row.CustomerNameSnapshot,
		WarehouseNameSnapshot: coalesceNullString(row.WarehouseNameSnapshot),
		ContainerType:         containerType,
		PeriodStart:           row.PeriodStart.Format(time.DateOnly),
		PeriodEnd:             row.PeriodEnd.Format(time.DateOnly),
		CurrencyCode:          row.CurrencyCode,
		Rates:                 rates,
		Header:                parseBillingInvoiceHeader(row.HeaderJSON),
		Subtotal:              row.Subtotal,
		DiscountTotal:         row.DiscountTotal,
		GrandTotal:            row.GrandTotal,
		Status:                row.Status,
		Notes:                 coalesceNullString(row.Notes),
		CreatedByUserID:       row.CreatedByUserID,
		CreatedAt:             row.CreatedAt,
		UpdatedAt:             row.UpdatedAt,
		LineCount:             row.LineCount,
	}
	if row.WarehouseLocationID.Valid {
		invoice.WarehouseLocationID = &row.WarehouseLocationID.Int64
	}
	if row.FinalizedAt.Valid {
		invoice.FinalizedAt = &row.FinalizedAt.Time
	}
	if row.FinalizedByUserID.Valid {
		invoice.FinalizedByUserID = &row.FinalizedByUserID.Int64
	}
	if row.PaidAt.Valid {
		invoice.PaidAt = &row.PaidAt.Time
	}
	if row.VoidedAt.Valid {
		invoice.VoidedAt = &row.VoidedAt.Time
	}
	return invoice
}

func toBillingInvoiceLine(row billingInvoiceLineRow) BillingInvoiceLine {
	occurredOn := ""
	if row.OccurredOn.Valid {
		occurredOn = row.OccurredOn.Time.Format(time.DateOnly)
	}
	return BillingInvoiceLine{
		ID:          row.ID,
		InvoiceID:   row.InvoiceID,
		ChargeType:  row.ChargeType,
		Description: row.Description,
		Reference:   coalesceNullString(row.Reference),
		ContainerNo: coalesceNullString(row.ContainerNo),
		Warehouse:   coalesceNullString(row.Warehouse),
		OccurredOn:  occurredOn,
		Quantity:    row.Quantity,
		UnitRate:    row.UnitRate,
		Amount:      row.Amount,
		Notes:       coalesceNullString(row.Notes),
		SourceType:  row.SourceType,
		SortOrder:   row.SortOrder,
		CreatedAt:   row.CreatedAt.Format(time.RFC3339),
		Details:     detailsJSON(row.DetailsJSON),
	}
}

type billingInvoiceContainerDetailAccumulator struct {
	detail     BillingInvoiceContainerDetail
	warehouses map[string]struct{}
	references map[string]struct{}
}

type billingInvoiceStorageLineDetails struct {
	Kind                string                        `json:"kind"`
	OpeningPallets      float64                       `json:"openingPallets"`
	ClosingPallets      float64                       `json:"closingPallets"`
	PalletReleaseEvents []BillingPreviewPalletRelease `json:"palletReleaseEvents"`
	PalletsTracked      float64                       `json:"palletsTracked"`
	PalletDays          float64                       `json:"palletDays"`
	FreePalletDays      float64                       `json:"freePalletDays"`
	BillablePalletDays  float64                       `json:"billablePalletDays"`
	GrossAmount         float64                       `json:"grossAmount"`
	DiscountAmount      float64                       `json:"discountAmount"`
}

func unreconciledBillingPalletMovementContainers(lines []BillingInvoiceLine) []string {
	detailsByContainer := make(map[string]billingInvoiceStorageLineDetails)
	for _, line := range lines {
		if !strings.EqualFold(strings.TrimSpace(line.ChargeType), BillingChargeStorage) || len(line.Details) == 0 {
			continue
		}
		details := billingInvoiceStorageLineDetails{}
		if err := json.Unmarshal(line.Details, &details); err != nil || details.Kind != "STORAGE_CONTAINER_SUMMARY" {
			continue
		}
		containerNo := normalizeContainerNo(line.ContainerNo)
		if containerNo != "" {
			detailsByContainer[containerNo] = details
		}
	}

	containers := make([]string, 0)
	for containerNo, details := range detailsByContainer {
		releasedPallets := 0.0
		for _, event := range details.PalletReleaseEvents {
			releasedPallets += event.Pallets
		}
		impliedReceivedPallets := billingPreviewRoundQuantity(
			details.ClosingPallets + releasedPallets - details.OpeningPallets,
		)
		if impliedReceivedPallets < 0 {
			containers = append(containers, containerNo)
		}
	}
	sort.Strings(containers)
	return containers
}

func buildBillingInvoiceContainerDetails(lines []BillingInvoiceLine) []BillingInvoiceContainerDetail {
	byContainer := make(map[string]*billingInvoiceContainerDetailAccumulator)
	for _, line := range lines {
		containerNo := normalizeContainerNo(line.ContainerNo)
		key := containerNo
		if key == "" {
			key = "\x00INVOICE_LEVEL"
		}
		entry := byContainer[key]
		if entry == nil {
			entry = &billingInvoiceContainerDetailAccumulator{
				detail:     BillingInvoiceContainerDetail{ContainerNo: containerNo},
				warehouses: make(map[string]struct{}),
				references: make(map[string]struct{}),
			}
			byContainer[key] = entry
		}

		if warehouse := strings.TrimSpace(line.Warehouse); warehouse != "" {
			entry.warehouses[warehouse] = struct{}{}
		}
		if reference := strings.TrimSpace(line.Reference); reference != "" {
			entry.references[reference] = struct{}{}
		}
		entry.detail.LineCount++
		entry.detail.TotalAmount += line.Amount

		switch strings.ToUpper(strings.TrimSpace(line.ChargeType)) {
		case BillingChargeInbound:
			entry.detail.InboundUnits += line.Quantity
			entry.detail.InboundAmount += line.Amount
		case BillingChargeWrapping:
			entry.detail.WrappingPallets += line.Quantity
			entry.detail.WrappingAmount += line.Amount
		case BillingChargeStorage:
			entry.detail.StorageAmount += line.Amount
			storageDetails := billingInvoiceStorageLineDetails{}
			if len(line.Details) > 0 && json.Unmarshal(line.Details, &storageDetails) == nil && storageDetails.Kind == "STORAGE_CONTAINER_SUMMARY" {
				palletDays := storageDetails.PalletDays
				if palletDays == 0 && line.Quantity != 0 {
					palletDays = line.Quantity
				}
				billablePalletDays := storageDetails.BillablePalletDays
				if billablePalletDays == 0 && line.Quantity != 0 {
					billablePalletDays = line.Quantity
				}
				grossAmount := storageDetails.GrossAmount
				if grossAmount == 0 && (line.Amount != 0 || storageDetails.DiscountAmount != 0) {
					grossAmount = line.Amount + storageDetails.DiscountAmount
				}
				entry.detail.PalletsTracked = math.Max(entry.detail.PalletsTracked, storageDetails.PalletsTracked)
				entry.detail.PalletDays += palletDays
				entry.detail.FreePalletDays += storageDetails.FreePalletDays
				entry.detail.BillablePalletDays += billablePalletDays
				entry.detail.StorageGrossAmount += grossAmount
				entry.detail.StorageDiscountAmount += storageDetails.DiscountAmount
			} else {
				entry.detail.BillablePalletDays += line.Quantity
				entry.detail.PalletDays += line.Quantity
				entry.detail.StorageGrossAmount += line.Amount
			}
		case BillingChargeOutbound:
			entry.detail.OutboundPallets += line.Quantity
			entry.detail.OutboundAmount += line.Amount
		default:
			entry.detail.AdjustmentAmount += line.Amount
		}
	}

	details := make([]BillingInvoiceContainerDetail, 0, len(byContainer))
	for _, entry := range byContainer {
		entry.detail.Warehouses = sortedBillingDetailValues(entry.warehouses)
		entry.detail.References = sortedBillingDetailValues(entry.references)
		entry.detail.InboundUnits = billingPreviewRoundQuantity(entry.detail.InboundUnits)
		entry.detail.WrappingPallets = billingPreviewRoundQuantity(entry.detail.WrappingPallets)
		entry.detail.PalletsTracked = billingPreviewRoundQuantity(entry.detail.PalletsTracked)
		entry.detail.PalletDays = billingPreviewRoundQuantity(entry.detail.PalletDays)
		entry.detail.FreePalletDays = billingPreviewRoundQuantity(entry.detail.FreePalletDays)
		entry.detail.BillablePalletDays = billingPreviewRoundQuantity(entry.detail.BillablePalletDays)
		entry.detail.OutboundPallets = billingPreviewRoundQuantity(entry.detail.OutboundPallets)
		entry.detail.InboundAmount = roundCurrencyGo(entry.detail.InboundAmount)
		entry.detail.WrappingAmount = roundCurrencyGo(entry.detail.WrappingAmount)
		entry.detail.StorageGrossAmount = roundCurrencyGo(entry.detail.StorageGrossAmount)
		entry.detail.StorageDiscountAmount = roundCurrencyGo(entry.detail.StorageDiscountAmount)
		entry.detail.StorageAmount = roundCurrencyGo(entry.detail.StorageAmount)
		entry.detail.OutboundAmount = roundCurrencyGo(entry.detail.OutboundAmount)
		entry.detail.AdjustmentAmount = roundCurrencyGo(entry.detail.AdjustmentAmount)
		entry.detail.TotalAmount = roundCurrencyGo(entry.detail.TotalAmount)
		details = append(details, entry.detail)
	}
	sort.Slice(details, func(left, right int) bool {
		if details[left].ContainerNo == "" || details[right].ContainerNo == "" {
			return details[left].ContainerNo != ""
		}
		return details[left].ContainerNo < details[right].ContainerNo
	})
	return details
}

func sortedBillingDetailValues(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func coalesceNullString(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func generateBillingInvoiceNo(periodStart time.Time, customerID int64) string {
	return fmt.Sprintf("INV-%s-%d-%d", periodStart.Format("200601"), customerID, time.Now().UnixMilli()%100000)
}

func detailsJSON(value sql.NullString) json.RawMessage {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	return json.RawMessage(value.String)
}

func nullableJSONString(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func nullableInt64Ptr(value *int64) any {
	if value == nil || *value <= 0 {
		return nil
	}
	return *value
}

func normalizeBillingRatesSnapshot(rates BillingRatesSnapshot) BillingRatesSnapshot {
	if rates.StorageFeePerPalletWeekNormal <= 0 && rates.StorageFeePerPalletWeekWestCoastTransfer <= 0 && rates.StorageFeePerPalletWeek > 0 {
		rates.StorageFeePerPalletWeekNormal = rates.StorageFeePerPalletWeek
		rates.StorageFeePerPalletWeekWestCoastTransfer = rates.StorageFeePerPalletWeek
	}
	if rates.StorageFeePerPalletWeek <= 0 {
		rates.StorageFeePerPalletWeek = rates.StorageFeePerPalletWeekNormal
	}
	return rates
}

func defaultBillingInvoiceHeader() BillingInvoiceHeader {
	return BillingInvoiceHeader{
		SellerName:          "Speed Inventory Management",
		Subtitle:            "Business services invoice",
		RemitTo:             "Speed Inventory Management",
		Terms:               "Net 30",
		PaymentDueDays:      30,
		PaymentInstructions: "Payment due within 30 days of invoice date. Please reference the invoice number with payment. Amounts are in USD.",
	}
}

func normalizeBillingInvoiceHeader(header BillingInvoiceHeader) BillingInvoiceHeader {
	normalized := BillingInvoiceHeader{
		SellerName:          strings.TrimSpace(header.SellerName),
		Subtitle:            strings.TrimSpace(header.Subtitle),
		RemitTo:             strings.TrimSpace(header.RemitTo),
		Terms:               strings.TrimSpace(header.Terms),
		PaymentDueDays:      header.PaymentDueDays,
		PaymentInstructions: strings.TrimSpace(header.PaymentInstructions),
	}
	if normalized.PaymentDueDays < 0 {
		normalized.PaymentDueDays = 0
	}
	return normalized
}

func parseBillingInvoiceHeader(value sql.NullString) BillingInvoiceHeader {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return defaultBillingInvoiceHeader()
	}
	var header BillingInvoiceHeader
	if err := json.Unmarshal([]byte(value.String), &header); err != nil {
		return defaultBillingInvoiceHeader()
	}
	return normalizeBillingInvoiceHeader(header)
}

func normalizeBillingInvoiceType(value string, allowEmpty bool) (string, error) {
	normalized := strings.TrimSpace(strings.ToUpper(value))
	if normalized == "" {
		if allowEmpty {
			return "", nil
		}
		return BillingInvoiceTypeMixed, nil
	}
	switch normalized {
	case BillingInvoiceTypeMixed, BillingInvoiceTypeStorage:
		return normalized, nil
	default:
		return "", fmt.Errorf("%w: billing invoice type must be MIXED or STORAGE_SETTLEMENT", ErrInvalidInput)
	}
}

func normalizeBillingInvoiceLineDetails(value json.RawMessage) (json.RawMessage, error) {
	if len(value) == 0 {
		return nil, nil
	}
	if !json.Valid(value) {
		return nil, fmt.Errorf("%w: billing invoice line details must be valid JSON", ErrInvalidInput)
	}
	return json.RawMessage(append([]byte(nil), value...)), nil
}

func roundCurrencyGo(value float64) float64 {
	return math.Round(value*100) / 100
}

func parseRequiredDate(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, fmt.Errorf("date is required")
	}
	for _, layout := range acceptedDateLayouts {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("could not parse date: %s", trimmed)
}
